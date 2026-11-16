use crate::{Account, models::*, vault};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

const MAX_PAGE_BYTES: u64 = 8 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
struct Snapshot {
    encrypted: bool,
    page: TimelinePage,
}

fn primary(event: &Value) -> bool {
    matches!(
        event["type"].as_str(),
        Some("m.room.message" | "m.room.encrypted")
    ) && event["content"]["m.relates_to"]["rel_type"] != "m.replace"
}
fn retained(existing: Vec<Value>, incoming: &[Value]) -> Vec<Value> {
    let mut events = BTreeMap::<String, Value>::new();
    for event in existing.into_iter().chain(incoming.iter().cloned()) {
        let Some(id) = event["event_id"].as_str().map(str::to_owned) else {
            continue;
        };
        if events.get(&id).is_some_and(|old| {
            old["unsigned"]["redacted_because"].is_object()
                || old["type"] == "m.room.message" && event["type"] == "m.room.encrypted"
        }) {
            continue;
        }
        events.insert(id, event);
    }
    let redactions = events
        .values()
        .filter(|event| event["type"] == "m.room.redaction")
        .filter_map(|event| {
            event["redacts"]
                .as_str()
                .or_else(|| event["content"]["redacts"].as_str())
                .map(|id| (id.to_owned(), event.clone()))
        })
        .collect::<Vec<_>>();
    for (id, redaction) in redactions {
        if let Some(event) = events.get_mut(&id) {
            event["content"] = json!({});
            event["unsigned"]["redacted_because"] = redaction;
        }
    }
    let mut ordered = events.into_values().collect::<Vec<_>>();
    ordered.sort_by(|a, b| {
        a["origin_server_ts"]
            .as_i64()
            .cmp(&b["origin_server_ts"].as_i64())
            .then_with(|| a["event_id"].as_str().cmp(&b["event_id"].as_str()))
    });
    let ids = ordered
        .iter()
        .rev()
        .filter(|event| primary(event))
        .take(50)
        .filter_map(|event| event["event_id"].as_str())
        .collect::<HashSet<_>>();
    let mut remaining_relations = 1950;
    let mut result = ordered
        .iter()
        .rev()
        .filter(|event| {
            if ids.contains(event["event_id"].as_str().unwrap_or("")) {
                return true;
            }
            let related = event["content"]["m.relates_to"]["event_id"]
                .as_str()
                .is_some_and(|id| ids.contains(id))
                || event["redacts"]
                    .as_str()
                    .or_else(|| event["content"]["redacts"].as_str())
                    .is_some_and(|id| ids.contains(id));
            if related && remaining_relations > 0 {
                remaining_relations -= 1;
                true
            } else {
                false
            }
        })
        .cloned()
        .collect::<Vec<_>>();
    result.reverse();
    result
}

impl Account {
    fn page_path(&self, room: &str) -> Result<std::path::PathBuf> {
        let id = matrix_sdk::ruma::RoomId::parse(room)
            .map_err(|_| CoreError::User("Некорректный ID комнаты".into()))?;
        // Fixed length, including rooms whose IDs exceed Windows' filename limit.
        use sha2::{Digest, Sha256};
        let name = format!("{:x}", Sha256::digest(id.as_bytes()));
        Ok(self.store_path.join("private-history").join(name))
    }
    fn read_snapshot(&self, room: &str) -> Result<Option<Snapshot>> {
        let path = self.page_path(room)?;
        if !path.exists() {
            return Ok(None);
        }
        if std::fs::metadata(&path)?.len() > MAX_PAGE_BYTES {
            return Err(CoreError::User("Кеш чата превышает лимит".into()));
        }
        let Some(bytes) = vault::load(&path)? else {
            return Ok(None);
        };
        let value: Snapshot = serde_json::from_slice(&bytes)?;
        if value.page.room_id != room {
            return Err(CoreError::User("Повреждён кеш чата".into()));
        }
        Ok(Some(value))
    }
    pub(crate) fn restore_page(&self, room: &str) -> Result<Option<TimelinePage>> {
        let _guard = self
            .page_cache_lock
            .lock()
            .expect("history cache mutex poisoned");
        Ok(self
            .read_snapshot(room)?
            .filter(|snapshot| {
                !snapshot.encrypted || self.e2ee_enabled.load(std::sync::atomic::Ordering::Acquire)
            })
            .map(|snapshot| snapshot.page))
    }
    pub(crate) fn remember_page(&self, page: &TimelinePage, refresh_cursor: bool) -> Result<()> {
        let _guard = self
            .page_cache_lock
            .lock()
            .expect("history cache mutex poisoned");
        let previous = self.read_snapshot(&page.room_id).ok().flatten();
        let encrypted = previous.as_ref().is_some_and(|snapshot| snapshot.encrypted)
            || self
                .client
                .get_room(
                    &matrix_sdk::ruma::RoomId::parse(&page.room_id)
                        .map_err(|_| CoreError::User("Некорректный ID комнаты".into()))?,
                )
                .is_some_and(|room| room.encryption_state().is_encrypted());
        if encrypted && !self.e2ee_enabled.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(());
        }
        let mut profiles = previous
            .as_ref()
            .map(|snapshot| snapshot.page.profiles.clone())
            .unwrap_or_default()
            .into_iter()
            .map(|profile| (profile.user_id.clone(), profile))
            .collect::<BTreeMap<_, _>>();
        profiles.extend(
            page.profiles
                .iter()
                .cloned()
                .map(|profile| (profile.user_id.clone(), profile)),
        );
        let next = if refresh_cursor {
            page.next.clone()
        } else {
            previous
                .as_ref()
                .map(|snapshot| snapshot.page.next.clone())
                .unwrap_or_else(|| page.next.clone())
        };
        let events = retained(
            previous
                .map(|snapshot| snapshot.page.events)
                .unwrap_or_default(),
            &page.events,
        );
        let senders = events
            .iter()
            .filter_map(|event| event["sender"].as_str())
            .collect::<HashSet<_>>();
        let snapshot = Snapshot {
            encrypted,
            page: TimelinePage {
                room_id: page.room_id.clone(),
                profiles: profiles
                    .into_values()
                    .filter(|profile| senders.contains(profile.user_id.as_str()))
                    .collect(),
                events,
                next,
                can_send: page.can_send,
                cache_warning: None,
            },
        };
        let bytes = serde_json::to_vec(&snapshot)?;
        if bytes.len() as u64 > MAX_PAGE_BYTES - 4096 {
            return Err(CoreError::User("Кеш чата превышает лимит".into()));
        }
        let path = self.page_path(&page.room_id)?;
        std::fs::create_dir_all(path.parent().expect("history directory"))?;
        vault::save(&path, &bytes)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_fifty_messages_with_edits_reactions_and_redactions() {
        let originals = (0..80).map(|i| json!({"event_id":format!("${i}"),"type":"m.room.message","sender":"@a:t","origin_server_ts":i,"content":{"body":format!("Message {i}")}})).collect::<Vec<_>>();
        let changes = vec![
            json!({"event_id":"$edit","type":"m.room.message","sender":"@a:t","origin_server_ts":90,"content":{"m.relates_to":{"rel_type":"m.replace","event_id":"$79"},"m.new_content":{"body":"edited"}}}),
            json!({"event_id":"$redact","type":"m.room.redaction","sender":"@a:t","origin_server_ts":91,"redacts":"$78","content":{}}),
        ];
        let result = retained(originals, &changes);
        assert_eq!(result.iter().filter(|event| primary(event)).count(), 50);
        assert!(result.iter().any(|event| event["event_id"] == "$edit"));
        let deleted = result
            .iter()
            .find(|event| event["event_id"] == "$78")
            .unwrap();
        assert_eq!(deleted["content"], json!({}));
        assert!(deleted["unsigned"]["redacted_because"].is_object());
        assert!(!result.iter().any(|event| event["event_id"] == "$29"));
    }
}
