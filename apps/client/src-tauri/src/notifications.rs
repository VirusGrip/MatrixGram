use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(desktop)]
use tauri::Emitter;
use tauri::{Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    Room {
        #[serde(rename = "roomId")]
        room_id: String,
        #[serde(rename = "sessionKey")]
        session_key: String,
    },
    Updates,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Activation {
    pub id: String,
    pub target: Target,
}
#[derive(Clone, Serialize, Deserialize)]
struct Route {
    activation: Activation,
    created: u64,
}
#[derive(Default)]
struct Routes {
    entries: Vec<Route>,
    pending: Option<Activation>,
}
#[derive(Default)]
pub struct Notifications(Mutex<Routes>);
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(super::data_dir(app)?.join("notification-routes.json"))
}
fn read(app: &tauri::AppHandle) -> Result<Vec<Route>, String> {
    let path = path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Err("Повреждён список уведомлений".into());
    }
    let entries: Vec<Route> =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    Ok(entries
        .into_iter()
        .filter(|r| now().saturating_sub(r.created) < 7 * 24 * 3600)
        .collect())
}
fn token(url: &url::Url) -> Option<String> {
    if url.scheme() != "matrixgram"
        || url.host_str() != Some("notification")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let id = url.path().strip_prefix('/')?;
    let uuid = uuid::Uuid::parse_str(id).ok()?;
    (uuid.to_string() == id).then(|| id.to_owned())
}
#[cfg(desktop)]
pub fn focus(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
#[cfg(desktop)]
pub fn activate(app: &tauri::AppHandle, url: &url::Url) {
    let Some(id) = token(url) else { return };
    let state = app.state::<Notifications>();
    let Ok(mut routes) = state.0.lock() else {
        return;
    };
    // Read on activation too: this also covers a completely new process.
    if routes.entries.is_empty() {
        routes.entries = read(app).unwrap_or_default();
    }
    let Some(route) = routes
        .entries
        .iter()
        .find(|r| r.activation.id == id && now().saturating_sub(r.created) < 7 * 24 * 3600)
        .cloned()
    else {
        return;
    };
    routes.pending = Some(route.activation.clone());
    drop(routes);
    focus(app);
    let _ = app.emit("notification-open", route.activation);
}
fn register(app: &tauri::AppHandle, target: Target) -> Result<String, String> {
    let state = app.state::<Notifications>();
    let mut routes = state.0.lock().map_err(|_| "Ошибка списка уведомлений")?;
    if routes.entries.is_empty() {
        routes.entries = read(app).unwrap_or_default();
    }
    routes
        .entries
        .retain(|r| now().saturating_sub(r.created) < 7 * 24 * 3600);
    if routes.entries.len() >= 256 {
        let count = routes.entries.len() - 255;
        routes.entries.drain(..count);
    }
    let id = uuid::Uuid::new_v4().to_string();
    routes.entries.push(Route {
        activation: Activation {
            id: id.clone(),
            target,
        },
        created: now(),
    });
    let file = path(app)?;
    std::fs::create_dir_all(file.parent().ok_or("Нет папки уведомлений")?)
        .map_err(|e| e.to_string())?;
    let temporary = file.with_extension("pending");
    std::fs::write(
        &temporary,
        serde_json::to_vec(&routes.entries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, file).map_err(|e| e.to_string())?;
    Ok(format!("matrixgram://notification/{id}"))
}
#[tauri::command]
pub fn pending_notification(state: State<'_, Notifications>) -> Option<Activation> {
    state.0.lock().ok()?.pending.clone()
}
#[tauri::command]
pub fn acknowledge_notification(state: State<'_, Notifications>, id: String) {
    if let Ok(mut routes) = state.0.lock()
        && routes.pending.as_ref().is_some_and(|a| a.id == id)
    {
        routes.pending = None;
    }
}
#[tauri::command]
pub async fn native_notify(
    app: tauri::AppHandle,
    state: State<'_, super::Backend>,
    title: String,
    body: String,
    target: Option<Target>,
) -> Result<(), String> {
    if let Some(Target::Room {
        room_id,
        session_key,
    }) = &target
    {
        let account = state.account().await?;
        if format!("{}|{}", account.info.user_id, account.info.device_id) != *session_key
            || account.room(room_id).is_err()
                && !account
                    .cache
                    .rooms()
                    .map_err(|e| e.to_string())?
                    .iter()
                    .any(|r| r.id == *room_id)
        {
            return Err("Аккаунт уведомления изменился".into());
        }
    }
    let title = title.chars().take(100).collect::<String>();
    let body = body.chars().take(240).collect::<String>();
    #[cfg(windows)]
    {
        let launch = target.map(|target| register(&app, target)).transpose()?;
        windows_toast(&app.config().identifier, &title, &body, launch.as_deref())
            .map_err(|e| format!("Не удалось показать уведомление: {e}"))
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = target;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|_| "Не удалось показать уведомление".into())
    }
}
#[cfg(windows)]
fn xml_escape(value: &str) -> String {
    value
        .chars()
        .filter(|&c| c == '\n' || c == '\r' || c == '\t' || c >= ' ')
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
#[cfg(windows)]
fn toast_xml(title: &str, body: &str, launch: Option<&str>) -> String {
    let activation = launch
        .map(|url| {
            format!(
                " activationType=\"protocol\" launch=\"{}\"",
                xml_escape(url)
            )
        })
        .unwrap_or_default();
    format!(
        "<toast{activation}><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        xml_escape(title),
        xml_escape(body)
    )
}
#[cfg(windows)]
fn windows_toast(
    app_id: &str,
    title: &str,
    body: &str,
    launch: Option<&str>,
) -> windows::core::Result<()> {
    use windows::{
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
        core::HSTRING,
    };
    let xml = XmlDocument::new()?;
    xml.LoadXml(&HSTRING::from(toast_xml(title, body, launch)))?;
    let toast = ToastNotification::CreateToastNotification(&xml)?;
    let notifier = if super::windows_identity::is_packaged()? {
        ToastNotificationManager::CreateToastNotifier()?
    } else {
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?
    };
    notifier.Show(&toast)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_local_notification_tokens() {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            token(&url::Url::parse(&format!("matrixgram://notification/{id}")).unwrap()),
            Some(id.clone())
        );
        for value in [
            format!("https://notification/{id}"),
            format!("matrixgram://evil/{id}"),
            format!("matrixgram://notification/{id}?room=!x:t"),
            "matrixgram://notification/../../file".into(),
            format!("matrixgram://u@notification/{id}"),
        ] {
            assert!(token(&url::Url::parse(&value).unwrap()).is_none());
        }
    }
    #[cfg(windows)]
    #[test]
    fn protocol_toast_escapes_untrusted_message_text() {
        let xml = toast_xml(
            "A & B",
            "<script>\"'\u{0}",
            Some("matrixgram://notification/test"),
        );
        assert!(xml.contains("activationType=\"protocol\""));
        assert!(xml.contains("A &amp; B"));
        assert!(!xml.contains("<script>"));
        assert!(!xml.contains('\u{0}'));
    }
}
