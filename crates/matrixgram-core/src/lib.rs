pub mod cache;
#[cfg(test)]
mod integration_tests;
pub mod models;
pub mod policy;
mod vault;

use cache::Cache;
use matrix_sdk::{
    Client, Room, RoomState,
    authentication::matrix::MatrixSession,
    config::SyncSettings,
    ruma::{
        OwnedEventId, OwnedRoomId, RoomId, TransactionId,
        api::client::{
            message::get_message_events, receipt::create_receipt::v3::ReceiptType,
            room::create_room, state::get_state_event_for_key, voip::get_turn_server_info,
        },
        events::StateEventType,
        uint,
    },
};
use models::*;
use policy::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Serialize, Deserialize)]
struct SavedSession {
    homeserver: String,
    store_id: String,
    session: MatrixSession,
}

pub struct Account {
    pub client: Client,
    pub cache: Cache,
    pub info: SessionInfo,
    data_dir: PathBuf,
    sync_lock: tokio::sync::Mutex<()>,
}

fn install_tls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

async fn build_client(homeserver: &str, store_path: &Path) -> Result<Client> {
    install_tls();
    Client::builder()
        .homeserver_url(homeserver)
        .sqlite_store(store_path, None)
        .user_agent("MatrixGram/0.1.0")
        .respect_login_well_known(false)
        .build()
        .await
        .map_err(network_error)
}

impl Account {
    pub async fn login(
        data_dir: &Path,
        homeserver: &str,
        username: &str,
        password: &str,
    ) -> Result<Self> {
        let server = validate_homeserver(homeserver)?.to_string();
        if username.trim().is_empty() || password.is_empty() {
            return Err(CoreError::User("Введите логин и пароль".into()));
        }
        std::fs::create_dir_all(data_dir)?;
        let store_id = uuid::Uuid::new_v4().to_string();
        let store_path = data_dir.join("accounts").join(&store_id);
        let client = build_client(&server, &store_path).await?;
        client.matrix_auth().login_username(username.trim(), password)
            .initial_device_display_name("MatrixGram")
            .send().await.map_err(|_| CoreError::User("Не удалось войти. Проверьте логин и пароль. Сервер должен поддерживать вход по паролю; SSO и дополнительные этапы пока не поддерживаются.".into()))?;
        let session = client
            .matrix_auth()
            .session()
            .ok_or_else(|| CoreError::User("Сервер не вернул сессию".into()))?;
        let saved = SavedSession {
            homeserver: server.clone(),
            store_id,
            session,
        };
        let persisted = match vault::save(
            &data_dir.join("session.dpapi"),
            &serde_json::to_vec(&saved)?,
        ) {
            Ok(value) => value,
            Err(error) => {
                let _ = client.matrix_auth().logout().await;
                return Err(error);
            }
        };
        Self::from_client(client, data_dir, store_path, server, persisted)
    }

    pub async fn restore(data_dir: &Path) -> Result<Option<Self>> {
        let Some(bytes) = vault::load(&data_dir.join("session.dpapi"))? else {
            return Ok(None);
        };
        let saved: SavedSession = serde_json::from_slice(&bytes)?;
        validate_homeserver(&saved.homeserver)?;
        uuid::Uuid::parse_str(&saved.store_id)
            .map_err(|_| CoreError::User("Повреждён путь сессии".into()))?;
        let store_path = data_dir.join("accounts").join(&saved.store_id);
        let client = build_client(&saved.homeserver, &store_path).await?;
        client
            .matrix_auth()
            .restore_session(saved.session, Default::default())
            .await
            .map_err(network_error)?;
        Ok(Some(Self::from_client(
            client,
            data_dir,
            store_path,
            saved.homeserver,
            true,
        )?))
    }

    fn from_client(
        client: Client,
        data_dir: &Path,
        store_path: PathBuf,
        server: String,
        persisted: bool,
    ) -> Result<Self> {
        let info = SessionInfo {
            user_id: client
                .user_id()
                .map(ToString::to_string)
                .unwrap_or_default(),
            device_id: client
                .device_id()
                .map(ToString::to_string)
                .unwrap_or_default(),
            homeserver: server,
            persisted,
        };
        Ok(Self {
            client,
            info,
            cache: Cache::open(&store_path.join("timeline.sqlite3"))?,
            data_dir: data_dir.to_owned(),
            sync_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn room(&self, room_id: &str) -> Result<Room> {
        let id = RoomId::parse(room_id)
            .map_err(|_| CoreError::User("Некорректный ID комнаты".into()))?;
        self.client
            .get_room(&id)
            .ok_or_else(|| CoreError::User("Комната ещё не синхронизирована".into()))
    }

    // Fetch current encryption state from the server on EVERY content write. A stale
    // cache or a disabled SDK crypto feature must never cause plaintext in E2EE rooms.
    pub async fn writable_room(&self, room_id: &str) -> Result<Room> {
        let room = self.room(room_id)?;
        if room.state() != RoomState::Joined {
            return Err(CoreError::User("Сначала вступите в комнату".into()));
        }
        if room.encryption_state().is_encrypted() {
            allow_plaintext("encrypted")?;
        }
        let request = get_state_event_for_key::v3::Request::new(
            room.room_id().to_owned(),
            StateEventType::RoomEncryption,
            String::new(),
        );
        match self.client.send(request).await {
            Ok(_) => allow_plaintext("encrypted")?,
            Err(error)
                if error.client_api_error_kind()
                    == Some(&matrix_sdk::ruma::api::error::ErrorKind::NotFound) => {}
            Err(_) => allow_plaintext("unknown")?,
        }
        Ok(room)
    }

    pub async fn rooms(&self) -> Result<Vec<RoomSummary>> {
        let mut result = Vec::new();
        for room in self.client.rooms() {
            if room.state() == RoomState::Left || room.state() == RoomState::Banned {
                continue;
            }
            let encryption = match room.encryption_state() {
                matrix_sdk::EncryptionState::Encrypted => "encrypted",
                matrix_sdk::EncryptionState::NotEncrypted => "unencrypted",
                _ => "unknown",
            };
            let (last_body, last_ts) = self.cache.last_message(room.room_id().as_str())?;
            result.push(RoomSummary {
                id: room.room_id().to_string(),
                name: room.name().unwrap_or_else(|| room.room_id().to_string()),
                topic: room.topic(),
                membership: if room.state() == RoomState::Invited {
                    "invited"
                } else {
                    "joined"
                }
                .into(),
                encryption: encryption.into(),
                unread: room.unread_notification_counts().notification_count,
                members: room.joined_members_count(),
                last_body,
                last_ts,
            });
        }
        result.sort_by(|a, b| b.last_ts.cmp(&a.last_ts).then_with(|| a.name.cmp(&b.name)));
        self.cache.save_rooms(&result)?;
        Ok(result)
    }

    pub async fn sync_once(&self) -> Result<Update> {
        let _guard = self.sync_lock.lock().await;
        let response = self
            .client
            .sync_once(SyncSettings::default().timeout(Duration::from_secs(25)))
            .await
            .map_err(|error| {
                use matrix_sdk::ruma::api::error::ErrorKind;
                if matches!(
                    error.client_api_error_kind(),
                    Some(ErrorKind::UnknownToken(_) | ErrorKind::MissingToken)
                ) {
                    CoreError::User(
                        "Сессия отозвана или истекла. Выйдите через настройки и войдите заново."
                            .into(),
                    )
                } else {
                    network_error(error)
                }
            })?;
        let mut timelines = Vec::new();
        for (id, room) in response.rooms.joined {
            let events: Vec<Value> = room
                .timeline
                .events
                .iter()
                .filter_map(|event| serde_json::from_str(event.raw().json().get()).ok())
                .collect();
            self.cache.save_events(id.as_str(), &events)?;
            if !events.is_empty() {
                timelines.push(TimelinePage {
                    room_id: id.to_string(),
                    events,
                    next: room.timeline.prev_batch,
                });
            }
        }
        Ok(Update {
            rooms: self.rooms().await?,
            timelines,
            connection: "online".into(),
            error: None,
        })
    }

    pub async fn history(&self, room_id: &str, from: Option<String>) -> Result<TimelinePage> {
        let room = self.room(room_id)?;
        let mut request = get_message_events::v3::Request::new(
            room.room_id().to_owned(),
            matrix_sdk::ruma::api::Direction::Backward,
        );
        request.from = from;
        request.limit = uint!(50);
        let response = self.client.send(request).await.map_err(network_error)?;
        let mut events = response
            .chunk
            .iter()
            .filter_map(|event| serde_json::from_str(event.json().get()).ok())
            .collect::<Vec<Value>>();
        events.reverse();
        self.cache.save_events(room_id, &events)?;
        Ok(TimelinePage {
            room_id: room_id.into(),
            events,
            next: response.end,
        })
    }

    pub async fn send_text(
        &self,
        room_id: &str,
        body: &str,
        txn: &str,
        reply_to: Option<String>,
    ) -> Result<String> {
        validate_body(body)?;
        if txn.is_empty() || txn.len() > 128 {
            return Err(CoreError::User("Некорректный ID отправки".into()));
        }
        let room = self.writable_room(room_id).await?;
        let content = if let Some(reply) = reply_to {
            let id = OwnedEventId::try_from(reply)
                .map_err(|_| CoreError::User("Некорректный ID сообщения".into()))?;
            json!({"msgtype":"m.text","body":body,"m.relates_to":{"m.in_reply_to":{"event_id":id}}})
        } else {
            json!({"msgtype":"m.text","body":body})
        };
        let transaction: &TransactionId = txn.into();
        let response = room
            .send_raw("m.room.message", content)
            .with_transaction_id(transaction)
            .await
            .map_err(network_error)?;
        Ok(response.response.event_id.to_string())
    }

    pub async fn edit(&self, room_id: &str, event_id: &str, body: &str) -> Result<()> {
        validate_body(body)?;
        let room = self.writable_room(room_id).await?;
        let id = OwnedEventId::try_from(event_id.to_owned())
            .map_err(|_| CoreError::User("Некорректный ID сообщения".into()))?;
        room.send_raw("m.room.message", json!({"msgtype":"m.text","body":format!("* {body}"),"m.new_content":{"msgtype":"m.text","body":body},"m.relates_to":{"rel_type":"m.replace","event_id":id}})).await.map_err(network_error)?;
        Ok(())
    }

    pub async fn react(&self, room_id: &str, event_id: &str, key: &str) -> Result<()> {
        if key.is_empty() || key.len() > 64 {
            return Err(CoreError::User("Некорректная реакция".into()));
        }
        let room = self.writable_room(room_id).await?;
        let id = OwnedEventId::try_from(event_id.to_owned())
            .map_err(|_| CoreError::User("Некорректный ID сообщения".into()))?;
        room.send_raw(
            "m.reaction",
            json!({"m.relates_to":{"rel_type":"m.annotation","event_id":id,"key":key}}),
        )
        .await
        .map_err(network_error)?;
        Ok(())
    }

    pub async fn redact(&self, room_id: &str, event_id: &str) -> Result<()> {
        let room = self.writable_room(room_id).await?;
        let id = OwnedEventId::try_from(event_id.to_owned())
            .map_err(|_| CoreError::User("Некорректный ID сообщения".into()))?;
        room.redact(&id, None, None).await.map_err(network_error)?;
        Ok(())
    }

    pub async fn create_room(
        &self,
        name: &str,
        invite: Vec<String>,
        public: bool,
    ) -> Result<String> {
        if name.trim().is_empty() || name.len() > 255 {
            return Err(CoreError::User("Введите название до 255 байт".into()));
        }
        let mut request = create_room::v3::Request::new();
        request.name = Some(name.trim().into());
        request.invite = invite
            .into_iter()
            .filter(|s| !s.trim().is_empty())
            .map(|s| {
                matrix_sdk::ruma::UserId::parse(s.trim()).map_err(|_| {
                    CoreError::User("Участник должен быть указан полным Matrix ID".into())
                })
            })
            .collect::<Result<Vec<_>>>()?;
        request.visibility = if public {
            matrix_sdk::ruma::api::client::room::Visibility::Public
        } else {
            matrix_sdk::ruma::api::client::room::Visibility::Private
        };
        request.preset = Some(if public {
            create_room::v3::RoomPreset::PublicChat
        } else {
            create_room::v3::RoomPreset::PrivateChat
        });
        // No m.room.encryption initial state: rooms are deliberately unencrypted.
        let room = self
            .client
            .create_room(request)
            .await
            .map_err(network_error)?;
        Ok(room.room_id().to_string())
    }

    pub async fn join(&self, room_id: &str) -> Result<()> {
        let id = OwnedRoomId::try_from(room_id.to_owned())
            .map_err(|_| CoreError::User("Некорректный ID комнаты".into()))?;
        self.client
            .join_room_by_id(&id)
            .await
            .map_err(network_error)?;
        Ok(())
    }

    pub async fn read(&self, room_id: &str, event_id: &str) -> Result<()> {
        let room = self.room(room_id)?;
        let id = OwnedEventId::try_from(event_id.to_owned())
            .map_err(|_| CoreError::User("Некорректный ID сообщения".into()))?;
        room.send_single_receipt(
            ReceiptType::Read,
            matrix_sdk::ruma::events::receipt::ReceiptThread::Unthreaded,
            id,
        )
        .await
        .map_err(network_error)?;
        Ok(())
    }

    pub async fn turn_servers(&self) -> Result<Value> {
        let response = self
            .client
            .send(get_turn_server_info::v3::Request::new())
            .await
            .map_err(network_error)?;
        // Short-lived credentials only; no server configuration or installation.
        Ok(
            json!({"urls":response.uris,"username":response.username,"credential":response.password,"ttl":response.ttl.as_secs()}),
        )
    }

    pub async fn logout(&self) -> Result<()> {
        if let Err(error) = self.client.matrix_auth().logout().await {
            use matrix_sdk::ruma::api::error::ErrorKind;
            if !matches!(
                error.client_api_error_kind(),
                Some(ErrorKind::UnknownToken(_) | ErrorKind::MissingToken)
            ) {
                return Err(network_error(error));
            }
        }
        vault::clear(&self.data_dir.join("session.dpapi"))?;
        Ok(())
    }

    pub fn forget_local(data_dir: &Path) -> Result<()> {
        vault::clear(&data_dir.join("session.dpapi"))
    }
}
