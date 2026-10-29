use matrixgram_core::{
    Account,
    models::{RoomSummary, SessionInfo, TimelinePage},
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager, State};
use tokio::sync::{Mutex, RwLock};

#[derive(Default)]
struct Backend {
    account: RwLock<Option<Arc<Account>>>,
    lifecycle: Mutex<()>,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Backend {
    async fn account(&self) -> Result<Arc<Account>, String> {
        self.account
            .read()
            .await
            .clone()
            .ok_or("Выполните вход".into())
    }

    async fn activate(&self, app: tauri::AppHandle, account: Account) -> SessionInfo {
        if let Some(worker) = self.worker.lock().await.take() {
            worker.abort();
        }
        let account = Arc::new(account);
        let info = account.info.clone();
        *self.account.write().await = Some(account.clone());
        let session_key = format!("{}|{}", info.user_id, info.device_id);
        let worker = tauri::async_runtime::spawn(async move {
            let mut delay = 2;
            loop {
                match account.sync_once().await {
                    Ok(update) => {
                        delay = 2;
                        let _ = app.emit(
                            "matrix-update",
                            json!({"sessionKey":session_key,"update":update}),
                        );
                    }
                    Err(error) => {
                        let _ = app.emit("matrix-connection", json!({"sessionKey":session_key,"connection":"reconnecting","error":error.to_string()}));
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                        delay = (delay * 2).min(30);
                    }
                }
            }
        });
        *self.worker.lock().await = Some(worker);
        info
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "Нет доступа к папке приложения".into())
}

#[tauri::command]
async fn bootstrap(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<Option<SessionInfo>, String> {
    let _guard = state.lifecycle.lock().await;
    if let Some(account) = state.account.read().await.as_ref() {
        return Ok(Some(account.info.clone()));
    }
    let account = Account::restore(&data_dir(&app)?)
        .await
        .map_err(|e| e.to_string())?;
    match account {
        Some(account) => Ok(Some(state.activate(app, account).await)),
        None => Ok(None),
    }
}

#[tauri::command]
async fn login(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    homeserver: String,
    username: String,
    password: String,
) -> Result<SessionInfo, String> {
    let _guard = state.lifecycle.lock().await;
    if state.account.read().await.is_some() {
        return Err("Сначала выйдите из текущего аккаунта".into());
    }
    let account = Account::login(&data_dir(&app)?, &homeserver, &username, &password)
        .await
        .map_err(|e| e.to_string())?;
    Ok(state.activate(app, account).await)
}

#[tauri::command]
async fn logout(state: State<'_, Backend>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    state
        .account()
        .await?
        .logout()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(worker) = state.worker.lock().await.take() {
        worker.abort();
    }
    *state.account.write().await = None;
    Ok(())
}

#[tauri::command]
async fn forget_session(app: tauri::AppHandle, state: State<'_, Backend>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    if state.account.read().await.is_some() {
        return Err("Используйте выход из аккаунта".into());
    }
    Account::forget_local(&data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rooms(state: State<'_, Backend>) -> Result<Vec<RoomSummary>, String> {
    state
        .account()
        .await?
        .rooms()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cached_timeline(state: State<'_, Backend>, room_id: String) -> Result<Vec<Value>, String> {
    state
        .account()
        .await?
        .cache
        .events(&room_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn history(
    state: State<'_, Backend>,
    room_id: String,
    from: Option<String>,
) -> Result<TimelinePage, String> {
    state
        .account()
        .await?
        .history(&room_id, from)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_text(
    state: State<'_, Backend>,
    room_id: String,
    body: String,
    txn: String,
    reply_to: Option<String>,
) -> Result<String, String> {
    state
        .account()
        .await?
        .send_text(&room_id, &body, &txn, reply_to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn edit_message(
    state: State<'_, Backend>,
    room_id: String,
    event_id: String,
    body: String,
) -> Result<(), String> {
    state
        .account()
        .await?
        .edit(&room_id, &event_id, &body)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn react(
    state: State<'_, Backend>,
    room_id: String,
    event_id: String,
    key: String,
) -> Result<(), String> {
    state
        .account()
        .await?
        .react(&room_id, &event_id, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn redact(
    state: State<'_, Backend>,
    room_id: String,
    event_id: String,
) -> Result<(), String> {
    state
        .account()
        .await?
        .redact(&room_id, &event_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_room(
    state: State<'_, Backend>,
    name: String,
    invite: Vec<String>,
    public: bool,
) -> Result<String, String> {
    state
        .account()
        .await?
        .create_room(&name, invite, public)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn join_room(state: State<'_, Backend>, room_id: String) -> Result<(), String> {
    state
        .account()
        .await?
        .join(&room_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn mark_read(
    state: State<'_, Backend>,
    room_id: String,
    event_id: String,
) -> Result<(), String> {
    state
        .account()
        .await?
        .read(&room_id, &event_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn draft(state: State<'_, Backend>, room_id: String) -> Result<String, String> {
    state
        .account()
        .await?
        .cache
        .draft(&room_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_draft(
    state: State<'_, Backend>,
    room_id: String,
    body: String,
) -> Result<(), String> {
    if body.len() > 16000 {
        return Err("Черновик превышает 16000 байт".into());
    }
    state
        .account()
        .await?
        .cache
        .save_draft(&room_id, &body)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn typing(state: State<'_, Backend>, room_id: String, active: bool) -> Result<(), String> {
    let account = state.account().await?;
    let room = account
        .writable_room(&room_id)
        .await
        .map_err(|e| e.to_string())?;
    room.typing_notice(active)
        .await
        .map_err(|_| "Не удалось отправить статус набора".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            login,
            logout,
            forget_session,
            rooms,
            cached_timeline,
            history,
            send_text,
            edit_message,
            react,
            redact,
            create_room,
            join_room,
            mark_read,
            draft,
            save_draft,
            typing
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить MatrixGram");
}
