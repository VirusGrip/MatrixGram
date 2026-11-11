use crate::update_policy::{self, Configuration};
use serde::Serialize;
use std::time::Duration;
use tauri::{Emitter, State};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    notes: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    current_version: String,
    configured: bool,
    platform: &'static str,
    repository: String,
    available: Option<Available>,
}
struct Candidate {
    info: Available,
    #[cfg(desktop)]
    update: tauri_plugin_updater::Update,
    #[cfg(target_os = "android")]
    asset: AndroidAsset,
}
#[derive(Default)]
struct Inner {
    candidate: Option<Candidate>,
    bytes: Option<Vec<u8>>,
    android_ready: bool,
}
#[derive(Default)]
pub struct Updates(Mutex<Inner>);
fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else {
        "windows"
    }
}
fn status(app: &tauri::AppHandle, config: &Configuration, available: Option<Available>) -> Status {
    Status {
        current_version: app.package_info().version.to_string(),
        configured: config.configured(),
        platform: platform(),
        repository: config.repository.clone(),
        available,
    }
}
fn progress(app: &tauri::AppHandle, phase: &str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "app-update-progress",
        serde_json::json!({"phase":phase,"downloaded":downloaded,"total":total}),
    );
}

#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> Status {
    status(&app, &Configuration::embedded(), None)
}
#[tauri::command]
pub async fn check_update(
    app: tauri::AppHandle,
    state: State<'_, Updates>,
) -> Result<Status, String> {
    let mut inner = state
        .0
        .try_lock()
        .map_err(|_| "Обновление уже выполняется")?;
    let config = Configuration::embedded();
    inner.candidate = None;
    inner.bytes = None;
    inner.android_ready = false;
    if !config.configured() {
        return Ok(status(&app, &config, None));
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app
            .updater_builder()
            .endpoints(vec![
                config
                    .endpoint()
                    .parse()
                    .map_err(|_| "Некорректный адрес релизов")?,
            ])
            .map_err(|_| "Некорректный адрес релизов")?
            .pubkey(config.public_key.clone())
            .timeout(Duration::from_secs(30))
            .version_comparator(|current, remote| {
                remote.version > current && remote.version.pre.is_empty()
            })
            .build()
            .map_err(|_| "Не удалось настроить обновления")?;
        if let Some(update) = updater.check().await.map_err(
            |_| "Не удалось проверить обновления. Возможно, первый релиз ещё не опубликован.",
        )? {
            update_policy::validate_asset(
                &config.repository,
                &update.version,
                update.download_url.as_str(),
            )?;
            let info = Available {
                version: update.version.clone(),
                notes: update
                    .body
                    .clone()
                    .unwrap_or_default()
                    .chars()
                    .take(8000)
                    .collect(),
            };
            inner.candidate = Some(Candidate { info, update });
        }
    }
    #[cfg(target_os = "android")]
    {
        if let Some((info, asset)) =
            check_android(&config, &app.package_info().version.to_string()).await?
        {
            inner.candidate = Some(Candidate { info, asset })
        }
    }
    Ok(status(
        &app,
        &config,
        inner
            .candidate
            .as_ref()
            .map(|candidate| candidate.info.clone()),
    ))
}
#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    state: State<'_, Updates>,
) -> Result<(), String> {
    let mut inner = state
        .0
        .try_lock()
        .map_err(|_| "Обновление уже выполняется")?;
    let candidate = inner
        .candidate
        .as_ref()
        .ok_or("Сначала проверьте обновления")?;
    progress(&app, "downloading", 0, None);
    #[cfg(desktop)]
    {
        let mut received = 0;
        let mut last_progress = std::time::Instant::now() - Duration::from_secs(1);
        let bytes = candidate
            .update
            .download(
                |chunk, total| {
                    received += chunk as u64;
                    if last_progress.elapsed() >= Duration::from_millis(100)
                        || total == Some(received)
                    {
                        progress(&app, "downloading", received, total);
                        last_progress = std::time::Instant::now();
                    }
                },
                || {},
            )
            .await
            .map_err(|_| "Не удалось скачать или проверить подпись обновления")?;
        inner.bytes = Some(bytes);
    }
    #[cfg(target_os = "android")]
    {
        let bytes = download_android(&candidate.asset, &app).await?;
        update_policy::verify(
            &bytes,
            &candidate.asset.signature,
            &Configuration::embedded().public_key,
            &candidate.info.version,
        )?;
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let path = std::path::PathBuf::from(
                matrixgram_core::android_update_path().map_err(|e| e.to_string())?,
            );
            let pending = path.with_extension("pending");
            std::fs::write(&pending, bytes).map_err(|_| "Не удалось сохранить APK")?;
            std::fs::rename(pending, path).map_err(|_| "Не удалось подготовить APK")?;
            Ok(())
        })
        .await
        .map_err(|_| "Не удалось подготовить APK")??;
        inner.android_ready = true;
    }
    progress(&app, "ready", 0, None);
    Ok(())
}
#[tauri::command]
pub async fn install_update(state: State<'_, Updates>) -> Result<String, String> {
    #[cfg_attr(target_os = "android", allow(unused_mut))]
    let mut inner = state
        .0
        .try_lock()
        .map_err(|_| "Обновление уже выполняется")?;
    #[cfg(desktop)]
    {
        let update = inner
            .candidate
            .as_ref()
            .ok_or("Сначала проверьте обновления")?
            .update
            .clone();
        let bytes = inner.bytes.take().ok_or("Сначала скачайте обновление")?;
        tauri::async_runtime::spawn_blocking(move || {
            update
                .install(bytes)
                .map_err(|_| "Не удалось запустить установщик. Скачайте обновление повторно.")
        })
        .await
        .map_err(|_| "Не удалось запустить установщик")??;
        Ok("started".into())
    }
    #[cfg(target_os = "android")]
    {
        if !inner.android_ready {
            return Err("Сначала скачайте обновление".into());
        }
        tauri::async_runtime::spawn_blocking(|| {
            matrixgram_core::android_install_update().map_err(|e| e.to_string())
        })
        .await
        .map_err(|_| "Не удалось открыть установщик Android")?
    }
}

#[cfg(target_os = "android")]
#[derive(Clone, serde::Deserialize)]
struct AndroidAsset {
    url: String,
    signature: String,
}
#[cfg(target_os = "android")]
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(300))
        .user_agent("MatrixGram updater")
        .build()
        .map_err(|_| "Не удалось настроить загрузку".into())
}
#[cfg(target_os = "android")]
async fn limited(
    mut response: reqwest::Response,
    limit: usize,
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err("Релиз недоступен. Проверьте сеть и публикацию GitHub Releases.".into());
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > limit as u64) {
        return Err("Слишком большой пакет обновления".into());
    }
    let mut bytes = Vec::with_capacity(total.unwrap_or(0).min(limit as u64) as usize);
    let mut last_progress = std::time::Instant::now() - Duration::from_secs(1);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Загрузка обновления прервалась")?
    {
        if bytes.len() + chunk.len() > limit {
            return Err("Слишком большой пакет обновления".into());
        }
        bytes.extend_from_slice(&chunk);
        if let Some(app) = app {
            if last_progress.elapsed() >= Duration::from_millis(100)
                || total == Some(bytes.len() as u64)
            {
                progress(app, "downloading", bytes.len() as u64, total);
                last_progress = std::time::Instant::now();
            }
        }
    }
    Ok(bytes)
}
#[cfg(target_os = "android")]
async fn check_android(
    config: &Configuration,
    current: &str,
) -> Result<Option<(Available, AndroidAsset)>, String> {
    let response = client()?
        .get(config.endpoint())
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Не удалось проверить обновления")?;
    let bytes = limited(response, 512 * 1024, None).await?;
    #[derive(serde::Deserialize)]
    struct Manifest {
        version: String,
        #[serde(default)]
        notes: String,
        platforms: std::collections::HashMap<String, AndroidAsset>,
    }
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| "Повреждён список обновлений")?;
    if !update_policy::newer(current, &manifest.version)? {
        return Ok(None);
    }
    let asset = manifest
        .platforms
        .get("android-aarch64")
        .ok_or("Для Android arm64 пакет пока не опубликован")?
        .clone();
    update_policy::validate_asset(&config.repository, &manifest.version, &asset.url)?;
    Ok(Some((
        Available {
            version: manifest.version,
            notes: manifest.notes.chars().take(8000).collect(),
        },
        asset,
    )))
}
#[cfg(target_os = "android")]
async fn download_android(asset: &AndroidAsset, app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    let response = client()?
        .get(&asset.url)
        .send()
        .await
        .map_err(|_| "Не удалось скачать APK")?;
    limited(response, 256 * 1024 * 1024, Some(app)).await
}
