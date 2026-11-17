use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    supported: bool,
    active: bool,
    setup_available: bool,
    configured: bool,
}

#[tauri::command]
pub fn windows_integration() -> Result<IntegrationStatus, String> {
    status()
}

#[tauri::command]
pub async fn configure_windows_integration() -> Result<IntegrationStatus, String> {
    tauri::async_runtime::spawn_blocking(configure)
        .await
        .map_err(|_| "Не удалось завершить настройку Windows".to_owned())?
}

#[cfg(not(windows))]
fn status() -> Result<IntegrationStatus, String> {
    Ok(IntegrationStatus {
        supported: false,
        active: false,
        setup_available: false,
        configured: false,
    })
}

#[cfg(not(windows))]
fn configure() -> Result<IntegrationStatus, String> {
    Err("Настройка доступна только в Windows".into())
}

#[cfg(windows)]
fn installation() -> Result<std::path::PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    executable
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| "Не найдена папка MatrixGram".into())
}

#[cfg(windows)]
fn marker(directory: &std::path::Path) -> Option<serde_json::Value> {
    let file = directory.join(".matrixgram-identity.json");
    if std::fs::metadata(&file).ok()?.len() > 16 * 1024 {
        return None;
    }
    let bytes = std::fs::read(file).ok()?;
    // Windows PowerShell 5 writes UTF-8 with a BOM.
    serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes)).ok()
}

#[cfg(windows)]
fn status() -> Result<IntegrationStatus, String> {
    let directory = installation()?;
    Ok(IntegrationStatus {
        supported: true,
        active: super::windows_identity::is_packaged().map_err(|e| e.to_string())?,
        setup_available: directory.join("identity/RegisterIdentity.ps1").is_file(),
        configured: marker(&directory).is_some_and(|value| value["status"] == "configured"),
    })
}

#[cfg(windows)]
fn configure() -> Result<IntegrationStatus, String> {
    use std::os::windows::process::CommandExt;
    static SETUP: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SETUP.try_lock().map_err(|_| "Настройка уже выполняется")?;
    let current = status()?;
    if current.active {
        return Ok(current);
    }
    if !current.setup_available {
        return Err("Установите MatrixGram с помощью установщика Windows".into());
    }
    let directory = installation()?;
    let powershell =
        std::path::PathBuf::from(std::env::var_os("WINDIR").ok_or("Не найдена папка Windows")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let result = std::process::Command::new(powershell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(directory.join("identity/RegisterIdentity.ps1"))
        .arg("-InstallDirectory")
        .arg(&directory)
        .arg("-Retry")
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("Не удалось запустить настройку Windows: {e}"))?;
    let saved = marker(&directory).ok_or("Настройка Windows не вернула результат")?;
    if !result.success() {
        return Err(saved["reason"]
            .as_str()
            .unwrap_or("Ошибка настройки Windows")
            .to_owned());
    }
    if saved["status"] == "unsupported" {
        return Err("Для группировки нужна Windows 10 версии 2004 или новее".into());
    }
    status()
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn developer_test_process_does_not_offer_installer_setup() {
        let status = super::status().expect("Windows identity status failed");
        assert!(status.supported);
        assert!(!status.active);
        assert!(!status.setup_available);
        assert!(!status.configured);
        // The command refuses before launching PowerShell or requesting UAC.
        assert!(super::configure().is_err());
    }
}
