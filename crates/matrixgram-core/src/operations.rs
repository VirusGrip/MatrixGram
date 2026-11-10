//! Additional client operations. Credentials stay in the SDK; IPC contains no access token.
#[cfg(test)]
mod tests;
use crate::{Account, models::*, policy::validate_body};
use base64::{Engine, engine::general_purpose::STANDARD};
use matrix_sdk::{
    RoomMemberships,
    attachment::{
        AttachmentConfig, AttachmentInfo, BaseAudioInfo, BaseFileInfo, BaseImageInfo, BaseVideoInfo,
    },
    media::{MediaFormat, MediaRequestParameters},
    notification_settings::RoomNotificationMode,
    ruma::{
        EventId, UserId,
        api::client::{device::update_device, directory::get_public_rooms_filtered},
        events::receipt::{ReceiptThread, ReceiptType},
        events::room::{MediaSource, message::RoomMessageEventContent},
        int,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

pub const MAX_MEDIA: usize = 25 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Operation {
    Profile {
        user_id: Option<String>,
    },
    SetProfile {
        name: String,
    },
    RoomDetails {
        room_id: String,
    },
    RoomSettings {
        room_id: String,
        name: String,
        topic: String,
    },
    Member {
        room_id: String,
        user_id: String,
        action: String,
    },
    Leave {
        room_id: String,
    },
    Pin {
        room_id: String,
        event_id: String,
        pinned: bool,
    },
    ReadBy {
        room_id: String,
        event_id: String,
    },
    Notifications {
        room_id: String,
        mode: String,
    },
    Ignore {
        user_id: String,
        ignored: bool,
    },
    Devices,
    DeviceName {
        device_id: String,
        name: String,
    },
    RemoveDevice {
        device_id: String,
        password: Option<String>,
        auth_session: Option<String>,
    },
    PublicRooms {
        term: String,
        since: Option<String>,
    },
    CreateRoom {
        name: String,
        topic: String,
        invite: Vec<String>,
        public: bool,
        channel: bool,
        encrypted: bool,
    },
    Search {
        room_id: String,
        term: String,
        next: Option<String>,
    },
    Event {
        room_id: String,
        event_id: String,
    },
    Join {
        address: String,
    },
    Formatted {
        room_id: String,
        body: String,
        txn: String,
    },
    Forward {
        room_id: String,
        source_room: String,
        event_id: String,
        txn: String,
    },
    Call {
        room_id: String,
        event_type: String,
        content: Value,
    },
    Turn,
    ExportKeys {
        passphrase: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Upload {
    pub room_id: Option<String>,
    pub name: String,
    pub mime: String,
    pub data: String,
    #[serde(default)]
    pub voice: bool,
    pub duration_ms: Option<u64>,
    pub txn: String,
    /// "profile" and "roomAvatar" update the respective avatar; "message" sends a file.
    pub target: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaData {
    pub data: String,
}

fn user(value: &str) -> Result<matrix_sdk::ruma::OwnedUserId> {
    UserId::parse(value).map_err(|_| CoreError::User("Нужен полный Matrix ID".into()))
}
fn event(value: &str) -> Result<matrix_sdk::ruma::OwnedEventId> {
    EventId::parse(value).map_err(|_| CoreError::User("Некорректное сообщение".into()))
}
fn room_address(
    value: &str,
) -> Result<(
    matrix_sdk::ruma::OwnedRoomOrAliasId,
    Vec<matrix_sdk::ruma::OwnedServerName>,
)> {
    use matrix_sdk::ruma::{MatrixToUri, MatrixUri, RoomOrAliasId, matrix_uri::MatrixId};
    if let Ok(id) = RoomOrAliasId::parse(value.trim()) {
        return Ok((id, vec![]));
    }
    let (id, via) = if let Ok(uri) = MatrixToUri::parse(value.trim()) {
        (uri.id().clone(), uri.via().to_vec())
    } else if let Ok(uri) = MatrixUri::parse(value.trim()) {
        (uri.id().clone(), uri.via().to_vec())
    } else {
        return Err(CoreError::User(
            "Нужен #алиас:сервер, !ID:сервер или ссылка matrix.to".into(),
        ));
    };
    let room = match id {
        MatrixId::Room(id) => id.into(),
        MatrixId::RoomAlias(id) => id.into(),
        MatrixId::Event(room, _) => room,
        _ => return Err(CoreError::User("Это не ссылка на комнату".into())),
    };
    Ok((room, via))
}
fn power_number(value: matrix_sdk::ruma::events::room::power_levels::UserPowerLevel) -> i64 {
    match value {
        matrix_sdk::ruma::events::room::power_levels::UserPowerLevel::Infinite => i64::MAX,
        matrix_sdk::ruma::events::room::power_levels::UserPowerLevel::Int(value) => value.into(),
        _ => 0,
    }
}

impl Account {
    pub async fn operation(&self, operation: Operation) -> Result<Value> {
        match operation {
            Operation::Profile { user_id } => {
                let id = user(user_id.as_deref().unwrap_or(&self.info.user_id))?;
                let profile = self
                    .client
                    .account()
                    .fetch_user_profile_of(&id)
                    .await
                    .map_err(network_error)?;
                let ignored=self.client.account().account_data::<matrix_sdk::ruma::events::ignored_user_list::IgnoredUserListEventContent>().await.map_err(network_error)?
                    .and_then(|raw|raw.deserialize().ok()).is_some_and(|content|content.ignored_users.contains_key(&id));
                Ok(
                    json!({"userId":id,"displayName":profile.get("displayname"),"avatarUrl":profile.get("avatar_url"),"ignored":ignored}),
                )
            }
            Operation::SetProfile { name } => {
                if name.chars().count() > 100 {
                    return Err(CoreError::User("Имя — до 100 символов".into()));
                }
                self.client
                    .account()
                    .set_display_name(Some(name.trim()))
                    .await
                    .map_err(network_error)?;
                Ok(Value::Null)
            }
            Operation::RoomDetails { room_id } => {
                let room = self.room(&room_id)?;
                let members = room
                    .members(RoomMemberships::ACTIVE)
                    .await
                    .map_err(network_error)?;
                let power = room.power_levels().await.map_err(network_error)?;
                let members = members.iter().map(|m| json!({"userId":m.user_id(),"name":m.name(),
                    "avatarUrl":m.avatar_url(),"power":power_number(power.for_user(m.user_id())),"membership":m.membership().as_str()})).collect::<Vec<_>>();
                let pins = room
                    .load_pinned_events()
                    .await
                    .map_err(network_error)?
                    .unwrap_or_default();
                Ok(
                    json!({"members":members,"pinned":pins,"name":room.name(),"topic":room.topic(),
                    "myPower":power_number(power.for_user(self.client.user_id().expect("signed in"))),
                    "canSend":power.user_can_send_message(self.client.user_id().expect("signed in"), matrix_sdk::ruma::events::MessageLikeEventType::RoomMessage),
                    "notificationMode":format!("{:?}",room.notification_mode().await),"encrypted":room.encryption_state().is_encrypted()}),
                )
            }
            Operation::RoomSettings {
                room_id,
                name,
                topic,
            } => {
                if name.trim().is_empty() || name.len() > 255 || topic.len() > 4096 {
                    return Err(CoreError::User("Проверьте название и описание".into()));
                }
                let room = self.room(&room_id)?;
                room.set_name(name).await.map_err(network_error)?;
                room.set_room_topic(&topic).await.map_err(network_error)?;
                Ok(Value::Null)
            }
            Operation::Member {
                room_id,
                user_id,
                action,
            } => {
                let room = self.room(&room_id)?;
                let id = user(&user_id)?;
                match action.as_str() {
                    "invite" => room.invite_user_by_id(&id).await.map_err(network_error)?,
                    "kick" => room.kick_user(&id, None).await.map_err(network_error)?,
                    "ban" => room.ban_user(&id, None).await.map_err(network_error)?,
                    "unban" => room.unban_user(&id, None).await.map_err(network_error)?,
                    "admin" | "moderator" | "member" => {
                        let level = match action.as_str() {
                            "admin" => int!(100),
                            "moderator" => int!(50),
                            _ => int!(0),
                        };
                        room.update_power_levels(vec![(&id, level)])
                            .await
                            .map_err(network_error)?;
                    }
                    _ => return Err(CoreError::User("Неизвестное действие".into())),
                }
                Ok(Value::Null)
            }
            Operation::Leave { room_id } => {
                self.room(&room_id)?.leave().await.map_err(network_error)?;
                Ok(Value::Null)
            }
            Operation::Pin {
                room_id,
                event_id,
                pinned,
            } => {
                let room = self.room(&room_id)?;
                let id = event(&event_id)?;
                if pinned {
                    room.pin_event(&id).await.map_err(network_error)?;
                } else {
                    room.unpin_event(&id).await.map_err(network_error)?;
                }
                Ok(Value::Null)
            }
            Operation::ReadBy { room_id, event_id } => {
                let receipts = self
                    .room(&room_id)?
                    .load_event_receipts(
                        ReceiptType::Read,
                        &ReceiptThread::Unthreaded,
                        &event(&event_id)?,
                    )
                    .await
                    .map_err(network_error)?;
                Ok(json!(
                    receipts
                        .into_iter()
                        .map(|(id, _)| id.to_string())
                        .collect::<Vec<_>>()
                ))
            }
            Operation::Notifications { room_id, mode } => {
                let room = self.room(&room_id)?;
                let mode = match mode.as_str() {
                    "all" => RoomNotificationMode::AllMessages,
                    "mentions" => RoomNotificationMode::MentionsAndKeywordsOnly,
                    "mute" => RoomNotificationMode::Mute,
                    _ => return Err(CoreError::User("Неизвестный режим".into())),
                };
                self.client
                    .notification_settings()
                    .await
                    .set_room_notification_mode(room.room_id(), mode)
                    .await
                    .map_err(network_error)?;
                Ok(Value::Null)
            }
            Operation::Ignore { user_id, ignored } => {
                let id = user(&user_id)?;
                if ignored {
                    self.client
                        .account()
                        .ignore_user(&id)
                        .await
                        .map_err(network_error)?;
                } else {
                    self.client
                        .account()
                        .unignore_user(&id)
                        .await
                        .map_err(network_error)?;
                }
                Ok(Value::Null)
            }
            Operation::Devices => {
                let response = self.client.devices().await.map_err(network_error)?;
                Ok(json!(response.devices.iter().map(|d|json!({"id":d.device_id,"name":d.display_name,"lastIp":d.last_seen_ip,"lastSeen":d.last_seen_ts.map(|t|u64::from(t.get())),"current":d.device_id.as_str()==self.info.device_id})).collect::<Vec<_>>()))
            }
            Operation::DeviceName { device_id, name } => {
                let mut request = update_device::v3::Request::new(device_id.into());
                request.display_name = Some(name);
                self.client.send(request).await.map_err(network_error)?;
                Ok(Value::Null)
            }
            Operation::RemoveDevice {
                device_id,
                password,
                auth_session,
            } => {
                use matrix_sdk::ruma::api::client::uiaa;
                if device_id == self.info.device_id {
                    return Err(CoreError::User(
                        "Для текущего устройства используйте выход из аккаунта".into(),
                    ));
                }
                let auth = password.map(|password| {
                    let mut data = uiaa::Password::new(
                        uiaa::UserIdentifier::Matrix(uiaa::MatrixUserIdentifier::new(
                            self.info.user_id.clone(),
                        )),
                        password,
                    );
                    data.session = auth_session;
                    uiaa::AuthData::Password(data)
                });
                match self.client.delete_devices(&[device_id.into()], auth).await {
                    Ok(_) => Ok(json!({"removed":true})),
                    Err(error) => {
                        if let Some(info) = error.as_uiaa_response() {
                            if info.flows.iter().any(|flow| {
                                flow.stages.len() == 1
                                    && flow.stages[0].as_str() == "m.login.password"
                            }) {
                                return Ok(
                                    json!({"requiresPassword":true,"session":info.session,"error":info.auth_error.as_ref().map(|_|"Пароль не принят сервером")}),
                                );
                            }
                            return Err(CoreError::User("Сервер требует дополнительную авторизацию, которая пока недоступна в этом окне".into()));
                        }
                        Err(network_error(error))
                    }
                }
            }
            Operation::PublicRooms { term, since } => {
                let mut request = get_public_rooms_filtered::v3::Request::new();
                request.limit = Some(matrix_sdk::ruma::uint!(30));
                request.since = since;
                if !term.trim().is_empty() {
                    request.filter.generic_search_term = Some(term);
                }
                let response = self.client.send(request).await.map_err(network_error)?;
                Ok(json!({"rooms":response.chunk,"next":response.next_batch}))
            }
            Operation::Join { address } => {
                let (address, via) = room_address(&address)?;
                let room = self
                    .client
                    .join_room_by_id_or_alias(&address, &via)
                    .await
                    .map_err(network_error)?;
                Ok(json!(room.room_id()))
            }
            Operation::CreateRoom {
                name,
                topic,
                invite,
                public,
                channel,
                encrypted,
            } => {
                use matrix_sdk::ruma::api::client::{room::Visibility, room::create_room};
                if name.trim().is_empty() || name.len() > 255 || topic.len() > 4096 {
                    return Err(CoreError::User("Проверьте название и описание".into()));
                }
                let mut request = create_room::v3::Request::new();
                request.name = Some(name);
                request.topic = Some(topic);
                request.invite = invite
                    .iter()
                    .map(|id| user(id))
                    .collect::<Result<Vec<_>>>()?;
                request.visibility = if public {
                    Visibility::Public
                } else {
                    Visibility::Private
                };
                request.preset = Some(if public {
                    create_room::v3::RoomPreset::PublicChat
                } else {
                    create_room::v3::RoomPreset::PrivateChat
                });
                if channel {
                    request.power_level_content_override = Some(serde_json::from_value(
                        json!({"events_default":100,"users_default":0,"users":{self.info.user_id.clone():100}}),
                    )?);
                }
                if encrypted {
                    self.enable_encryption().await?;
                    request.initial_state.push(serde_json::from_value(json!({"type":"m.room.encryption","state_key":"","content":{"algorithm":"m.megolm.v1.aes-sha2"}}))?);
                }
                let room = self
                    .client
                    .create_room(request)
                    .await
                    .map_err(network_error)?;
                Ok(json!(room.room_id()))
            }
            Operation::Search {
                room_id,
                term,
                next,
            } => {
                use matrix_sdk::ruma::api::client::search::search_events::v3::{
                    Categories, Criteria, Request,
                };
                if term.trim().len() < 2 {
                    return Err(CoreError::User("Введите минимум два символа".into()));
                }
                let room = self.room(&room_id)?;
                if room.encryption_state().is_encrypted() {
                    return Err(CoreError::User(
                        "Зашифрованная история ищется локально среди загруженных сообщений".into(),
                    ));
                }
                let mut criteria = Criteria::new(term);
                criteria.filter.rooms = Some(vec![room.room_id().to_owned()]);
                criteria.filter.limit = Some(matrix_sdk::ruma::uint!(30));
                let mut categories = Categories::new();
                categories.room_events = Some(criteria);
                let mut request = Request::new(categories);
                request.next_batch = next;
                let response = self.client.send(request).await.map_err(network_error)?;
                Ok(json!(response.search_categories))
            }
            Operation::Formatted { room_id, body, txn } => {
                validate_body(&body)?;
                if txn.is_empty() || txn.len() > 128 {
                    return Err(CoreError::User("Некорректный ID отправки".into()));
                }
                let room = self.writable_room(&room_id).await?;
                let mut mentions = matrix_sdk::ruma::events::Mentions::new();
                mentions.user_ids = crate::mentioned_users(&body);
                let content = RoomMessageEventContent::text_markdown(body).add_mentions(mentions);
                let result = room
                    .send(content)
                    .with_transaction_id(txn.as_str().into())
                    .await
                    .map_err(network_error)?;
                Ok(json!(result.response.event_id))
            }
            Operation::Event { room_id, event_id } => {
                let room = self.writable_room(&room_id).await?;
                let value = room
                    .event(&event(&event_id)?, None)
                    .await
                    .map_err(network_error)?;
                Ok(serde_json::from_str(value.raw().json().get())?)
            }
            Operation::Forward {
                room_id,
                source_room,
                event_id,
                txn,
            } => {
                let source = self.writable_room(&source_room).await?;
                let original = source
                    .event(&event(&event_id)?, None)
                    .await
                    .map_err(network_error)?;
                let raw: Value = serde_json::from_str(original.raw().json().get())?;
                if raw["type"] != "m.room.message"
                    || raw["unsigned"]["redacted_because"].is_object()
                {
                    return Err(CoreError::User("Это сообщение нельзя переслать".into()));
                }
                let mut content = raw["content"].clone();
                content
                    .as_object_mut()
                    .ok_or_else(|| CoreError::User("Нет содержимого".into()))?
                    .remove("m.relates_to");
                content["m.mentions"] = json!({});
                // SDK decrypts and re-encrypts for the destination room; no plaintext HTTP send.
                let room = self.writable_room(&room_id).await?;
                let result = room
                    .send_raw("m.room.message", content)
                    .with_transaction_id(txn.as_str().into())
                    .await
                    .map_err(network_error)?;
                Ok(json!(result.response.event_id))
            }
            Operation::Call {
                room_id,
                event_type,
                content,
            } => {
                if ![
                    "m.call.invite",
                    "m.call.answer",
                    "m.call.candidates",
                    "m.call.hangup",
                    "m.call.reject",
                    "m.call.select_answer",
                    "m.call.negotiate",
                    "m.call.sdp_stream_metadata_changed",
                ]
                .contains(&event_type.as_str())
                    || content.to_string().len() > 128_000
                    || !content["call_id"].is_string()
                {
                    return Err(CoreError::User("Некорректный сигнал звонка".into()));
                }
                let room = self.writable_room(&room_id).await?;
                room.send_raw(&event_type, content)
                    .await
                    .map_err(network_error)?;
                Ok(Value::Null)
            }
            Operation::Turn => self.turn_servers().await,
            Operation::ExportKeys { passphrase } => {
                let passphrase = zeroize::Zeroizing::new(passphrase);
                if passphrase.chars().count() < 12 {
                    return Err(CoreError::User(
                        "Пароль экспорта — минимум 12 символов".into(),
                    ));
                }
                let path = self
                    .store_path
                    .join(format!("export-{}.tmp", uuid::Uuid::new_v4()));
                let result = self
                    .client
                    .encryption()
                    .export_room_keys(path.clone(), &passphrase, |_| true)
                    .await;
                let bytes = if result.is_ok() {
                    std::fs::read_to_string(&path).ok()
                } else {
                    None
                };
                let _ = std::fs::remove_file(path);
                result.map_err(network_error)?;
                Ok(json!(bytes.ok_or_else(|| CoreError::User(
                    "Не удалось прочитать экспорт".into()
                ))?))
            }
        }
    }

    pub async fn media_content(&self, source: Value) -> Result<MediaData> {
        let source: MediaSource = serde_json::from_value(source)?;
        let url = match &source {
            MediaSource::Plain(url) => url,
            MediaSource::Encrypted(file) => &file.url,
        };
        if !url.is_valid() {
            return Err(CoreError::User("Некорректный адрес медиа".into()));
        }
        let bytes = self
            .client
            .media()
            .get_media_content(
                &MediaRequestParameters {
                    source,
                    format: MediaFormat::File,
                },
                false,
            )
            .await
            .map_err(network_error)?;
        if bytes.len() > MAX_MEDIA {
            return Err(CoreError::User("Файл превышает лимит клиента 25 МБ".into()));
        }
        Ok(MediaData {
            data: STANDARD.encode(bytes),
        })
    }

    pub async fn upload(&self, upload: Upload, progress: impl Fn(usize, usize)) -> Result<Value> {
        if upload.data.len() > MAX_MEDIA * 4 / 3 + 8
            || upload.name.is_empty()
            || upload.name.len() > 255
        {
            return Err(CoreError::User(
                "Файл должен быть не больше 25 МБ, имя — до 255 байт".into(),
            ));
        }
        let bytes = STANDARD
            .decode(upload.data)
            .map_err(|_| CoreError::User("Некорректный файл".into()))?;
        if bytes.is_empty() || bytes.len() > MAX_MEDIA {
            return Err(CoreError::User("Пустой или слишком большой файл".into()));
        }
        let mime: mime::Mime = upload
            .mime
            .parse()
            .map_err(|_| CoreError::User("Некорректный тип файла".into()))?;
        match upload.target.as_str() {
            "profile" => {
                if mime.type_() != mime::IMAGE {
                    return Err(CoreError::User("Выберите изображение".into()));
                }
                let url = self
                    .client
                    .account()
                    .upload_avatar(&mime, bytes)
                    .await
                    .map_err(network_error)?;
                Ok(json!(url))
            }
            "roomAvatar" => {
                let room = self.room(upload.room_id.as_deref().unwrap_or(""))?;
                let response = room
                    .upload_avatar(&mime, bytes, None)
                    .await
                    .map_err(network_error)?;
                Ok(json!(response.event_id))
            }
            "message" => {
                let room = self
                    .writable_room(upload.room_id.as_deref().unwrap_or(""))
                    .await?;
                let mut config = AttachmentConfig::new();
                config.txn_id = Some(upload.txn.into());
                let size = matrix_sdk::ruma::UInt::new(bytes.len() as u64);
                config.info = Some(if upload.voice {
                    AttachmentInfo::Voice(BaseAudioInfo {
                        duration: upload.duration_ms.map(Duration::from_millis),
                        size,
                        waveform: None,
                    })
                } else if mime.type_() == mime::IMAGE {
                    AttachmentInfo::Image(BaseImageInfo {
                        size,
                        ..Default::default()
                    })
                } else if mime.type_() == mime::VIDEO {
                    AttachmentInfo::Video(BaseVideoInfo {
                        size,
                        ..Default::default()
                    })
                } else if mime.type_() == mime::AUDIO {
                    AttachmentInfo::Audio(BaseAudioInfo {
                        size,
                        duration: upload.duration_ms.map(Duration::from_millis),
                        waveform: None,
                    })
                } else {
                    AttachmentInfo::File(BaseFileInfo { size })
                });
                use std::future::IntoFuture;
                let observable: eyeball::SharedObservable<matrix_sdk::TransmissionProgress> =
                    eyeball::SharedObservable::default();
                let mut updates = observable.subscribe();
                let send = room
                    .send_attachment(upload.name, &mime, bytes, config)
                    .with_send_progress_observable(observable)
                    .into_future();
                tokio::pin!(send);
                let result = loop {
                    tokio::select! {result=&mut send=>break result.map_err(network_error)?,Some(value)=updates.next()=>progress(value.current,value.total)}
                };
                Ok(json!(result.event_id))
            }
            _ => Err(CoreError::User("Неизвестное назначение файла".into())),
        }
    }
}
