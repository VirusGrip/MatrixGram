use matrixgram_core::{
    Account,
    models::{
        ChatFolder, EncryptionStatus, RoomSummary, SessionInfo, TimelinePage, UserSearchResult,
    },
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager, State};
use tokio::sync::{Mutex, RwLock};
mod accounts;
mod update_policy;
mod updates;

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_madfrog_matrixgram_MainActivity_nativeVaultInit(
    env: jni::JNIEnv,
    activity: jni::objects::JObject,
) {
    let _ = matrixgram_core::initialize_android_vault(env, activity);
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_ru_madfrog_matrixgram_MainActivity_nativeTlsInit(
    mut env: jni_tls::EnvUnowned,
    _activity: jni_tls::objects::JObject,
    context: jni_tls::objects::JObject,
) {
    use jni_tls::errors::ThrowRuntimeExAndDefault;
    env.with_env(|env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<ThrowRuntimeExAndDefault>();
}

#[derive(Default)]
struct Backend {
    account: RwLock<Option<Arc<Account>>>,
    lifecycle: Mutex<()>,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    transfers: Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>,
    profiles: Mutex<std::collections::HashMap<String, Arc<Account>>>,
    current_profile: Mutex<Option<String>>,
}

impl Backend {
    async fn account(&self) -> Result<Arc<Account>, String> {
        self.account
            .read()
            .await
            .clone()
            .ok_or("Выполните вход".into())
    }

    async fn activate_arc(&self, app: tauri::AppHandle, account: Arc<Account>) -> SessionInfo {
        if let Some(worker) = self.worker.lock().await.take() {
            worker.abort();
        }
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
    let root = data_dir(&app)?;
    let mut catalog = accounts::read(&root)?;
    let Some(id) =
        accounts::restore_id(&catalog, root.join("profiles.json").exists()).map(str::to_owned)
    else {
        return Ok(None);
    };
    let account = Account::restore(&accounts::directory(&root, &id)?)
        .await
        .map_err(|e| e.to_string())?;
    match account {
        Some(account) => {
            if !catalog.entries.iter().any(|e| e.id == id) {
                catalog.entries.push(accounts::Entry {
                    id: id.clone(),
                    user_id: account.info.user_id.clone(),
                    homeserver: account.info.homeserver.clone(),
                });
            }
            catalog.active = Some(id.clone());
            accounts::write(&root, &catalog)?;
            let account = Arc::new(account);
            state
                .profiles
                .lock()
                .await
                .insert(id.clone(), account.clone());
            *state.current_profile.lock().await = Some(id);
            Ok(Some(state.activate_arc(app, account).await))
        }
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
    let root = data_dir(&app)?;
    let mut catalog = accounts::read(&root)?;
    let id = if catalog.entries.is_empty() && !root.join("session.dpapi").exists() {
        "legacy".to_string()
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    let account = Account::login(
        &accounts::directory(&root, &id)?,
        &homeserver,
        &username,
        &password,
    )
    .await
    .map_err(|e| e.to_string())?;
    catalog.entries.retain(|e| e.id != id);
    catalog.entries.push(accounts::Entry {
        id: id.clone(),
        user_id: account.info.user_id.clone(),
        homeserver: account.info.homeserver.clone(),
    });
    catalog.active = Some(id.clone());
    accounts::write(&root, &catalog)?;
    let account = Arc::new(account);
    state
        .profiles
        .lock()
        .await
        .insert(id.clone(), account.clone());
    *state.current_profile.lock().await = Some(id);
    Ok(state.activate_arc(app, account).await)
}

#[tauri::command]
async fn logout(app: tauri::AppHandle, state: State<'_, Backend>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    for token in state.transfers.lock().await.values() {
        token.cancel();
    }
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
    if let Some(id) = state.current_profile.lock().await.take() {
        state.profiles.lock().await.remove(&id);
        let root = data_dir(&app)?;
        let mut catalog = accounts::read(&root)?;
        catalog.entries.retain(|entry| entry.id != id);
        catalog.active = None;
        accounts::write(&root, &catalog)?;
    }
    Ok(())
}

#[tauri::command]
async fn forget_session(app: tauri::AppHandle, state: State<'_, Backend>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    if state.account.read().await.is_some() {
        return Err("Используйте выход из аккаунта".into());
    }
    let root = data_dir(&app)?;
    let mut catalog = accounts::read(&root)?;
    let id = catalog.active.clone().unwrap_or_else(|| "legacy".into());
    Account::forget_local(&accounts::directory(&root, &id)?).map_err(|e| e.to_string())?;
    catalog.entries.retain(|entry| entry.id != id);
    catalog.active = None;
    accounts::write(&root, &catalog)
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
        .cached_timeline(&room_id)
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
        .save_draft(&room_id, &body)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn encryption_status(state: State<'_, Backend>) -> Result<EncryptionStatus, String> {
    Ok(state.account().await?.encryption_status().await)
}

#[tauri::command]
async fn enable_encryption(state: State<'_, Backend>) -> Result<EncryptionStatus, String> {
    state
        .account()
        .await?
        .enable_encryption()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn recover_encryption(
    state: State<'_, Backend>,
    key: String,
) -> Result<EncryptionStatus, String> {
    state
        .account()
        .await?
        .recover_encryption(key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_encryption_keys(
    state: State<'_, Backend>,
    export: String,
    passphrase: String,
) -> Result<usize, String> {
    state
        .account()
        .await?
        .import_encryption_keys(export, passphrase)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_folders(state: State<'_, Backend>) -> Result<Vec<ChatFolder>, String> {
    state.account().await?.folders().map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_folders(
    state: State<'_, Backend>,
    folders: Vec<ChatFolder>,
) -> Result<Vec<ChatFolder>, String> {
    state
        .account()
        .await?
        .save_folders(folders)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_users(state: State<'_, Backend>, term: String) -> Result<UserSearchResult, String> {
    state
        .account()
        .await?
        .search_users(&term)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_direct(state: State<'_, Backend>, user_id: String) -> Result<String, String> {
    state
        .account()
        .await?
        .open_direct(&user_id)
        .await
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

#[tauri::command]
async fn client_operation(
    state: State<'_, Backend>,
    operation: matrixgram_core::operations::Operation,
) -> Result<Value, String> {
    state
        .account()
        .await?
        .operation(operation)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn list_accounts(app: tauri::AppHandle) -> Result<Value, String> {
    let catalog = accounts::read(&data_dir(&app)?)?;
    Ok(json!({"entries":catalog.entries,"active":catalog.active}))
}
#[tauri::command]
async fn add_account(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    homeserver: String,
    username: String,
    password: String,
) -> Result<SessionInfo, String> {
    let _guard = state.lifecycle.lock().await;
    let root = data_dir(&app)?;
    let mut catalog = accounts::read(&root)?;
    if catalog.entries.len() >= 10 {
        return Err("Можно сохранить до 10 аккаунтов".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let directory = accounts::directory(&root, &id)?;
    let account = Account::login(&directory, &homeserver, &username, &password)
        .await
        .map_err(|e| e.to_string())?;
    catalog.entries.push(accounts::Entry {
        id: id.clone(),
        user_id: account.info.user_id.clone(),
        homeserver: account.info.homeserver.clone(),
    });
    catalog.active = Some(id.clone());
    if let Err(error) = accounts::write(&root, &catalog) {
        let _ = account.logout().await;
        return Err(error);
    }
    let account = Arc::new(account);
    state
        .profiles
        .lock()
        .await
        .insert(id.clone(), account.clone());
    *state.current_profile.lock().await = Some(id);
    for token in state.transfers.lock().await.values() {
        token.cancel();
    }
    Ok(state.activate_arc(app, account).await)
}
#[tauri::command]
async fn switch_account(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    id: String,
) -> Result<SessionInfo, String> {
    let _guard = state.lifecycle.lock().await;
    let root = data_dir(&app)?;
    let mut catalog = accounts::read(&root)?;
    if !catalog.entries.iter().any(|entry| entry.id == id) {
        return Err("Аккаунт не найден".into());
    }
    let cached = state.profiles.lock().await.get(&id).cloned();
    let account = if let Some(account) = cached {
        account
    } else {
        let restored = Account::restore(&accounts::directory(&root, &id)?)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Сессия не сохранена, войдите заново")?;
        let account = Arc::new(restored);
        state
            .profiles
            .lock()
            .await
            .insert(id.clone(), account.clone());
        account
    };
    catalog.active = Some(id.clone());
    accounts::write(&root, &catalog)?;
    *state.current_profile.lock().await = Some(id);
    for token in state.transfers.lock().await.values() {
        token.cancel();
    }
    Ok(state.activate_arc(app, account).await)
}
#[tauri::command]
async fn fetch_media(
    state: State<'_, Backend>,
    source: Value,
) -> Result<matrixgram_core::operations::MediaData, String> {
    state
        .account()
        .await?
        .media_content(source)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn upload_file(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    upload: matrixgram_core::operations::Upload,
    session_key: Option<String>,
) -> Result<Value, String> {
    // Register cancellation under the same lock as account switches.
    let registration = state.lifecycle.lock().await;
    let account = state.account().await?;
    let txn = upload.txn.clone();
    if session_key
        .as_deref()
        .is_some_and(|key| key != format!("{}|{}", account.info.user_id, account.info.device_id))
    {
        return Err("Аккаунт изменился, отправка отменена".into());
    }
    let token = state
        .transfers
        .lock()
        .await
        .entry(txn.clone())
        .or_default()
        .clone();
    drop(registration);
    let progress_txn = txn.clone();
    let key = format!("{}|{}", account.info.user_id, account.info.device_id);
    let result = tokio::select! {biased;_=token.cancelled()=>Err("Отправка отменена".into()),result=account.upload(upload,move|current,total|{let _=app.emit("matrix-transfer",json!({"txn":progress_txn,"current":current,"total":total,"sessionKey":key}));})=>result.map_err(|e|e.to_string())};
    state.transfers.lock().await.remove(&txn);
    result
}
#[tauri::command]
async fn cancel_upload(state: State<'_, Backend>, txn: String) -> Result<(), String> {
    let mut transfers = state.transfers.lock().await;
    if let Some(token) = transfers.get(&txn) {
        token.cancel();
    } else if transfers.len() < 100 {
        transfers.entry(txn).or_default().cancel();
    }
    Ok(())
}
#[tauri::command]
async fn save_download(app: tauri::AppHandle, name: String, data: String) -> Result<bool, String> {
    use base64::Engine;
    if data.len() > 36_000_000 {
        return Err("Файл превышает лимит сохранения".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Некорректный файл")?;
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return tauri::async_runtime::spawn_blocking(move || {
            matrixgram_core::android_save_file(&name, &bytes).map_err(|e| e.to_string())
        })
        .await
        .map_err(|_| "Не удалось открыть выбор файла".to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let safe_name = std::path::Path::new(&name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("download.bin");
        let Some(path) = app
            .dialog()
            .file()
            .set_file_name(safe_name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path
            .into_path()
            .map_err(|_| "Этот путь недоступен".to_string())?;
        std::fs::write(path, bytes).map_err(|_| "Не удалось сохранить файл".to_string())?;
        Ok(true)
    })
    .await
    .map_err(|_| "Не удалось открыть выбор файла".to_string())?
}
#[tauri::command]
async fn desktop_settings(app: tauri::AppHandle, autostart: Option<bool>) -> Result<Value, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        if let Some(enabled) = autostart {
            if enabled {
                manager.enable()
            } else {
                manager.disable()
            }
            .map_err(|_| "Не удалось настроить автозапуск")?;
        }
        Ok(
            json!({"autostart":manager.is_enabled().map_err(|_|"Не удалось прочитать автозапуск")?,"desktop":true}),
        )
    }
    #[cfg(mobile)]
    {
        let _ = (app, autostart);
        Ok(json!({"autostart":false,"desktop":false}))
    }
}
#[tauri::command]
fn minimize_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Окно не найдено")?;
    window
        .hide()
        .map_err(|_| "Не удалось свернуть приложение".into())
}
#[tauri::command]
fn native_notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title.chars().take(100).collect::<String>())
        .body(body.chars().take(240).collect::<String>())
        .show()
        .map_err(|_| "Не удалось показать уведомление".into())
}
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Разрешены только веб-ссылки".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Не удалось открыть ссылку".into())
}
#[tauri::command]
async fn media_permissions(video: bool) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            matrixgram_core::android_media_permissions(video).map_err(|e| e.to_string())
        })
        .await
        .map_err(|_| "Не удалось запросить разрешения".to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = video;
        Ok(true)
    }
}
#[tauri::command]
async fn request_notifications() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            matrixgram_core::android_notification_permissions().map_err(|e| e.to_string())
        })
        .await
        .map_err(|_| "Не удалось запросить разрешение".to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(true)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(mobile)]
            let _ = app;
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                use tauri::{
                    menu::{Menu, MenuItem},
                    tray::TrayIconBuilder,
                };
                app.handle()
                    .plugin(tauri_plugin_autostart::Builder::new().build())?;
                let show =
                    MenuItem::with_id(app, "show", "Открыть MatrixGram", true, None::<&str>)?;
                let quit =
                    MenuItem::with_id(app, "quit", "Завершить MatrixGram", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                let mut tray = TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("MatrixGram")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;
            }
            Ok(())
        })
        .manage(Backend::default())
        .manage(updates::Updates::default())
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
            typing,
            encryption_status,
            enable_encryption,
            recover_encryption,
            import_encryption_keys,
            get_folders,
            save_folders,
            search_users,
            open_direct,
            client_operation,
            fetch_media,
            upload_file,
            cancel_upload,
            save_download,
            desktop_settings,
            minimize_to_tray,
            native_notify,
            open_url,
            list_accounts,
            add_account,
            switch_account,
            media_permissions,
            request_notifications,
            updates::update_status,
            updates::check_update,
            updates::download_update,
            updates::install_update
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить MatrixGram");
}
