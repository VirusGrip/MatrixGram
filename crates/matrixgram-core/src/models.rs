use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_HOMESERVER: &str = "https://matrix.mad-frog.ru";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub user_id: String,
    pub device_id: String,
    pub homeserver: String,
    pub persisted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSummary {
    pub id: String,
    pub name: String,
    pub topic: Option<String>,
    pub membership: String,
    pub encryption: String,
    pub unread: u64,
    pub members: u64,
    pub last_body: Option<String>,
    pub last_ts: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePage {
    pub room_id: String,
    pub events: Vec<Value>,
    pub next: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub rooms: Vec<RoomSummary>,
    pub timelines: Vec<TimelinePage>,
    pub connection: String,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    User(String),
    #[error("Ошибка локального хранилища")]
    Store(#[from] rusqlite::Error),
    #[error("Не удалось прочитать данные")]
    Json(#[from] serde_json::Error),
    #[error("Не удалось сохранить данные приложения")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, CoreError>;

// SDK errors can contain request details. Only fixed, non-secret messages cross IPC.
pub fn network_error<E>(_error: E) -> CoreError {
    CoreError::User("Запрос Matrix не выполнен. Проверьте сеть, доступ и права в комнате.".into())
}
