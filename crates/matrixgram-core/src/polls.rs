use crate::{Account, models::*};
use matrix_sdk::{
    Room,
    room::RelationsOptions,
    ruma::{EventId, UserId, events::MessageLikeEventType, uint},
};
use serde_json::{Value, json};

const START: &str = "org.matrix.msc3381.poll.start";
fn definition(raw: &Value) -> Result<&Value> {
    if ![START, "m.poll.start"].contains(&raw["type"].as_str().unwrap_or_default())
        || raw["unsigned"]["redacted_because"].is_object()
    {
        return Err(CoreError::User("Опрос удалён или недоступен".into()));
    }
    let c = &raw["content"];
    ["m.poll", START, "m.poll.start"]
        .into_iter()
        .find_map(|key| c.get(key).filter(|v| v.is_object()))
        .ok_or_else(|| CoreError::User("Некорректный опрос".into()))
}
async fn root(room: &Room, id: &str) -> Result<Value> {
    let id = EventId::parse(id).map_err(|_| CoreError::User("Некорректный ID опроса".into()))?;
    let event = room.event(&id, None).await.map_err(crate::network_error)?;
    let raw = serde_json::from_str(event.raw().json().get())?;
    definition(&raw)?;
    Ok(raw)
}
fn response_type(raw: &Value) -> &'static str {
    if raw["type"] == START {
        "org.matrix.msc3381.poll.response"
    } else {
        "m.poll.response"
    }
}
fn valid_end(
    raw: &Value,
    owner: &Value,
    power: &matrix_sdk::ruma::events::room::power_levels::RoomPowerLevels,
) -> bool {
    ["org.matrix.msc3381.poll.end", "m.poll.end"]
        .contains(&raw["type"].as_str().unwrap_or_default())
        && !raw["unsigned"]["redacted_because"].is_object()
        && raw["content"]["m.relates_to"]["rel_type"] == "m.reference"
        && raw["content"]["m.relates_to"]["event_id"] == owner["event_id"]
        && (raw["sender"] == owner["sender"]
            || raw["sender"]
                .as_str()
                .and_then(|s| UserId::parse(s).ok())
                .is_some_and(|id| power.user_can_redact_event_of_other(&id)))
}
impl Account {
    pub(crate) async fn poll_page(
        &self,
        room_id: &str,
        event_id: &str,
        from: Option<String>,
    ) -> Result<Value> {
        if from.as_ref().is_some_and(|s| s.len() > 4096) {
            return Err(CoreError::User("Некорректная страница опроса".into()));
        }
        let room = self.writable_room(room_id).await?;
        let poll = root(&room, event_id).await?;
        let page = room
            .relations(
                EventId::parse(event_id).unwrap(),
                RelationsOptions {
                    from,
                    limit: Some(uint!(100)),
                    ..Default::default()
                },
            )
            .await
            .map_err(crate::network_error)?;
        let mut events = vec![poll.clone()];
        events.extend(
            page.chunk
                .iter()
                .filter_map(|event| serde_json::from_str::<Value>(event.raw().json().get()).ok()),
        );
        let power = room.power_levels_or_default().await;
        let ends = events
            .iter()
            .filter(|raw| valid_end(raw, &poll, &power))
            .map(|raw| raw["event_id"].clone())
            .collect::<Vec<_>>();
        let missing = events.iter().any(|raw| raw["type"] == "m.room.encrypted");
        let snapshot = self
            .timeline_page(room_id, events.clone(), None, Vec::new())
            .await?;
        let _ = self.remember_page(&snapshot, false);
        Ok(
            json!({"events":events,"next":page.next_batch_token,"authorizedEnds":ends,"missingKeys":missing,"canVote":power.user_can_send_message(room.own_user_id(),MessageLikeEventType::from(response_type(&poll)))}),
        )
    }
    pub(crate) async fn poll_vote(
        &self,
        room_id: &str,
        event_id: &str,
        answers: Vec<String>,
        txn: &str,
        revision: Option<&str>,
    ) -> Result<Value> {
        if txn.is_empty()
            || txn.len() > 128
            || answers.len() > 20
            || answers.iter().any(|s| s.is_empty() || s.len() > 512)
        {
            return Err(CoreError::User("Некорректный ответ на опрос".into()));
        }
        let room = self.writable_room(room_id).await?;
        let mut poll = root(&room, event_id).await?;
        if let Some(revision) = revision {
            let id = EventId::parse(revision)
                .map_err(|_| CoreError::User("Некорректная правка опроса".into()))?;
            let edit = room.event(&id, None).await.map_err(crate::network_error)?;
            let edit: Value = serde_json::from_str(edit.raw().json().get())?;
            if edit["sender"] != poll["sender"]
                || edit["type"] != poll["type"]
                || edit["content"]["m.relates_to"]["event_id"] != event_id
                || edit["content"]["m.relates_to"]["rel_type"] != "m.replace"
                || edit["unsigned"]["redacted_because"].is_object()
            {
                return Err(CoreError::User("Недействительная правка опроса".into()));
            }
            poll["content"] = edit["content"]["m.new_content"].clone();
        }
        let def = definition(&poll)?;
        let options = def["answers"]
            .as_array()
            .ok_or_else(|| CoreError::User("Нет вариантов ответа".into()))?;
        let max = def["max_selections"]
            .as_u64()
            .filter(|n| *n > 0)
            .unwrap_or(1)
            .min(20) as usize;
        let unique = answers.iter().collect::<std::collections::HashSet<_>>();
        if unique.len() != answers.len()
            || answers.len() > max
            || answers.iter().any(|answer| {
                !options
                    .iter()
                    .take(20)
                    .any(|option| option["id"] == *answer || option["m.id"] == *answer)
            })
        {
            return Err(CoreError::User("Проверьте выбранные варианты".into()));
        }
        let power = room.power_levels_or_default().await;
        if !power.user_can_send_message(
            room.own_user_id(),
            MessageLikeEventType::from(response_type(&poll)),
        ) {
            return Err(CoreError::User(
                "Нет права голосовать в этой комнате".into(),
            ));
        }
        let recent = room
            .relations(
                EventId::parse(event_id).unwrap(),
                RelationsOptions {
                    limit: Some(uint!(100)),
                    ..Default::default()
                },
            )
            .await
            .map_err(crate::network_error)?;
        if recent
            .chunk
            .iter()
            .filter_map(|e| serde_json::from_str::<Value>(e.raw().json().get()).ok())
            .any(|e| valid_end(&e, &poll, &power))
        {
            return Err(CoreError::User("Опрос уже завершён".into()));
        }
        let mut content = json!({"m.relates_to":{"rel_type":"m.reference","event_id":event_id}});
        if poll["type"] == START {
            content["org.matrix.msc3381.poll.response"] = json!({"answers":answers});
        } else if poll["content"]["m.poll"].is_object() {
            content["m.selections"] = json!(answers);
        } else {
            content["m.poll.response"] = json!({"answers":answers});
        }
        let result = room
            .send_raw(response_type(&poll), content)
            .with_transaction_id(txn.into())
            .await
            .map_err(crate::network_error)?;
        Ok(json!(result.response.event_id))
    }
}
