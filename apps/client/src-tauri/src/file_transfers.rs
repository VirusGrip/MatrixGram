use super::Backend;
use matrixgram_core::{
    Account,
    file_transfer::{FileUpload, IPC_CHUNK_BYTES, PreparedFile, Progress},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;

struct Chunk {
    bytes: Vec<u8>,
    acknowledgement: oneshot::Sender<()>,
}
struct ChunkReader {
    receiver: mpsc::Receiver<Chunk>,
    current: Option<Chunk>,
    offset: usize,
    token: CancellationToken,
}
impl Read for ChunkReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        loop {
            if self.token.is_cancelled() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "cancelled",
                ));
            }
            if let Some(chunk) = &self.current
                && self.offset < chunk.bytes.len()
            {
                let count = buffer.len().min(chunk.bytes.len() - self.offset);
                buffer[..count].copy_from_slice(&chunk.bytes[self.offset..self.offset + count]);
                self.offset += count;
                return Ok(count);
            }
            if let Some(chunk) = self.current.take() {
                let _ = chunk.acknowledgement.send(());
            }
            let idle = Instant::now();
            loop {
                if self.token.is_cancelled() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "cancelled",
                    ));
                }
                match self.receiver.recv_timeout(Duration::from_millis(200)) {
                    Ok(chunk) => {
                        self.current = Some(chunk);
                        self.offset = 0;
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(0),
                    Err(mpsc::RecvTimeoutError::Timeout)
                        if idle.elapsed() > Duration::from_secs(120) =>
                    {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "staging timed out",
                        ));
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
        }
    }
}
struct StagedUpload {
    account: Arc<Account>,
    upload: FileUpload,
    session_key: String,
    token: CancellationToken,
    sender: Option<mpsc::SyncSender<Chunk>>,
    accepted: u64,
    result: Option<oneshot::Receiver<Result<PreparedFile, String>>>,
}
#[derive(Default)]
pub struct FileTransfers {
    stages: Mutex<HashMap<String, Arc<Mutex<StagedUpload>>>>,
}
impl FileTransfers {
    pub async fn clear(&self) {
        self.stages.lock().await.clear();
    }
    pub async fn cancel(&self, txn: &str) {
        if let Some(stage) = self.stages.lock().await.remove(txn) {
            stage.lock().await.token.cancel();
        }
    }
}
fn key(account: &Account) -> String {
    format!("{}|{}", account.info.user_id, account.info.device_id)
}
fn progress(app: tauri::AppHandle, txn: String, session_key: String) -> Progress {
    Arc::new(move |phase, current, total| {
        let _=app.emit("matrix-transfer",json!({"txn":txn,"sessionKey":session_key,"phase":phase,"current":current,"total":total.unwrap_or(0)}));
    })
}
fn directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Нет доступа к временной папке")?
        .join("large-transfers");
    std::fs::create_dir_all(&path).map_err(|_| "Не удалось создать папку передачи файлов")?;
    Ok(path)
}
async fn register(
    state: &Backend,
    txn: &str,
    session_key: &str,
) -> Result<(Arc<Account>, CancellationToken), String> {
    if txn.is_empty() || txn.len() > 128 {
        return Err("Некорректный ID передачи".into());
    }
    let _guard = state.lifecycle.lock().await;
    let account = state.account().await?;
    if key(&account) != session_key {
        return Err("Аккаунт изменился, передача отменена".into());
    }
    let mut active = state.transfers.lock().await;
    if let Some(token) = active.get(txn) {
        let cancelled = token.is_cancelled();
        if cancelled {
            active.remove(txn);
        }
        return Err(if cancelled {
            "Передача отменена"
        } else {
            "Передача уже выполняется"
        }
        .into());
    }
    active.retain(|_, token| !token.is_cancelled());
    if active.len() >= 100 {
        return Err("Слишком много передач файлов".into());
    }
    let token = CancellationToken::new();
    active.insert(txn.into(), token.clone());
    Ok((account, token))
}

#[tauri::command]
pub async fn file_transfer_limits(
    state: State<'_, Backend>,
) -> Result<matrixgram_core::file_transfer::TransferLimits, String> {
    state
        .account()
        .await?
        .transfer_limits()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn begin_file_upload(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    stages: State<'_, FileTransfers>,
    upload: FileUpload,
    session_key: String,
) -> Result<(), String> {
    upload.validate().map_err(|e| e.to_string())?;
    let (account, token) = register(&state, &upload.txn, &session_key).await?;
    let txn = upload.txn.clone();
    let result=async {
        tokio::select!{biased;_=token.cancelled()=>return Err("Передача отменена".into()),value=account.prepare_file_upload(&upload)=>value.map_err(|e|e.to_string())?};
        let folder=directory(&app)?;
        let mut all=stages.stages.lock().await;
        // Cancelled readers finish within 200 ms and delete their encrypted spool.
        let mut remove=Vec::new();for (id,stage) in all.iter(){if let Ok(guard)=stage.try_lock() && guard.token.is_cancelled(){remove.push(id.clone());}}
        for id in remove{all.remove(&id);}
        if all.len()>=4{return Err("Дождитесь подготовки других файлов".into());}
        let (sender,receiver)=mpsc::sync_channel(1);let (finished,result)=oneshot::channel();
        let reader=ChunkReader{receiver,current:None,offset:0,token:token.clone()};
        let worker_token=token.clone();let callback=progress(app.clone(),txn.clone(),session_key.clone());let size=upload.size;
        tauri::async_runtime::spawn_blocking(move||{
            let prepared=PreparedFile::from_reader(reader,&folder,Some(size),&worker_token,callback).map_err(|e|e.to_string());
            if prepared.is_err(){worker_token.cancel();}let _=finished.send(prepared);
        });
        all.insert(txn.clone(),Arc::new(Mutex::new(StagedUpload{account,upload,session_key,token:token.clone(),sender:Some(sender),accepted:0,result:Some(result)})));
        Ok(())
    }.await;
    if result.is_err() {
        token.cancel();
        state.transfers.lock().await.remove(&txn);
    }
    result
}

#[tauri::command]
pub async fn file_upload_chunk(
    stages: State<'_, FileTransfers>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let txn = request
        .headers()
        .get("x-matrixgram-transfer")
        .and_then(|v| v.to_str().ok())
        .ok_or("Нет ID передачи")?;
    let offset: u64 = request
        .headers()
        .get("x-matrixgram-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or("Нет позиции файла")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Ожидается двоичный блок файла".into());
    };
    if bytes.is_empty() || bytes.len() > IPC_CHUNK_BYTES {
        return Err("Некорректный размер блока файла".into());
    }
    let stage = stages
        .stages
        .lock()
        .await
        .get(txn)
        .cloned()
        .ok_or("Подготовка файла не найдена")?;
    let mut stage = stage.lock().await;
    if stage.token.is_cancelled() {
        return Err("Передача отменена".into());
    }
    if offset != stage.accepted || offset + bytes.len() as u64 > stage.upload.size {
        return Err("Нарушен порядок блоков файла".into());
    }
    let (acknowledgement, received) = oneshot::channel();
    stage
        .sender
        .as_ref()
        .ok_or("Подготовка уже завершена")?
        .try_send(Chunk {
            bytes: bytes.clone(),
            acknowledgement,
        })
        .map_err(|_| "Не удалось принять блок файла")?;
    tokio::select! {biased;_=stage.token.cancelled()=>return Err("Передача отменена".into()),value=received=>value.map_err(|_|"Не удалось записать блок файла")?};
    stage.accepted += bytes.len() as u64;
    Ok(())
}

#[tauri::command]
pub async fn finish_file_upload(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    stages: State<'_, FileTransfers>,
    txn: String,
) -> Result<Value, String> {
    let staged = stages
        .stages
        .lock()
        .await
        .remove(&txn)
        .ok_or("Подготовка файла не найдена")?;
    let mut stage = staged.lock().await;
    stage.sender.take();
    let result=async {
        if stage.token.is_cancelled()||stage.accepted!=stage.upload.size{return Err("Подготовка отменена или файл передан не полностью".into());}
        let receiver=stage.result.take().ok_or("Подготовка уже завершена")?;
        let prepared=tokio::select!{biased;_=stage.token.cancelled()=>return Err("Передача отменена".into()),value=receiver=>value.map_err(|_|"Не удалось подготовить файл")??};
        let callback=progress(app,txn.clone(),stage.session_key.clone());
        let result=stage.account.send_prepared_file(stage.upload.clone(),prepared,stage.token.clone(),callback).await.map_err(|e|e.to_string())?;
        Ok(json!(result))
    }.await;
    stage.token.cancel();
    state.transfers.lock().await.remove(&txn);
    result
}

#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    name: String,
    source: Value,
    txn: String,
    session_key: String,
) -> Result<bool, String> {
    let source: matrixgram_core::file_transfer::MediaSource =
        serde_json::from_value(source).map_err(|_| "Некорректное вложение")?;
    let (account, token) = register(&state, &txn, &session_key).await?;
    let callback = progress(app.clone(), txn.clone(), session_key);
    let result = async {
        #[cfg(not(target_os = "android"))]
        {
            use tauri_plugin_dialog::DialogExt;
            let safe = name
                .replace('\\', "/")
                .rsplit('/')
                .next()
                .unwrap_or("download.bin")
                .chars()
                .take(255)
                .collect::<String>();
            let path = tauri::async_runtime::spawn_blocking(move || {
                app.dialog().file().set_file_name(safe).blocking_save_file()
            })
            .await
            .map_err(|_| "Не удалось открыть сохранение")?;
            let Some(path) = path else {
                return Ok(false);
            };
            let path = path
                .into_path()
                .map_err(|_| "Папка сохранения недоступна")?;
            matrixgram_core::file_transfer::download_to_path(
                &account.client,
                source,
                path,
                token.clone(),
                callback,
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(true)
        }
        #[cfg(target_os = "android")]
        {
            let folder = directory(&app)?;
            let output = tauri::async_runtime::spawn_blocking(move || {
                matrixgram_core::android_create_download(&name)
            })
            .await
            .map_err(|_| "Не удалось открыть сохранение")?
            .map_err(|e| e.to_string())?;
            let Some(mut output) = output else {
                return Ok(false);
            };
            let file = output.take_file().map_err(|e| e.to_string())?;
            let result = matrixgram_core::file_transfer::download_to_writer(
                &account.client,
                source,
                &folder,
                file,
                token.clone(),
                callback,
            )
            .await
            .map_err(|e| e.to_string());
            output.finish(result.is_ok()).map_err(|e| e.to_string())?;
            result?;
            Ok(true)
        }
    }
    .await;
    token.cancel();
    state.transfers.lock().await.remove(&txn);
    result
}

#[tauri::command]
pub async fn upload_shared_file(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    upload: FileUpload,
    session_key: String,
    handle: String,
) -> Result<Value, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state, upload, session_key, handle);
        Err("Получение файла из Android недоступно на этой платформе".into())
    }
    #[cfg(target_os = "android")]
    {
        if uuid::Uuid::parse_str(&handle).is_err() {
            return Err("Некорректный файл Android".into());
        }
        let mut upload = upload;
        let known = (upload.size > 0).then_some(upload.size);
        if upload.size == 0 {
            upload.size = 1;
        }
        upload.validate().map_err(|e| e.to_string())?;
        let (account, token) = register(&state, &upload.txn, &session_key).await?;
        let txn = upload.txn.clone();
        let result = async {
            account
                .prepare_file_upload(&upload)
                .await
                .map_err(|e| e.to_string())?;
            let limit = account
                .transfer_limits()
                .await
                .map_err(|e| e.to_string())?
                .effective_bytes;
            let source_handle = handle.clone();
            let file = tauri::async_runtime::spawn_blocking(move || {
                matrixgram_core::android_open_shared_file(&source_handle)
            })
            .await
            .map_err(|_| "Не удалось открыть файл Android")?
            .map_err(|e| e.to_string())?;
            let folder = directory(&app)?;
            let callback = progress(app.clone(), txn.clone(), session_key.clone());
            let worker_token = token.clone();
            let prepared = tauri::async_runtime::spawn_blocking(move || {
                PreparedFile::from_reader(
                    file.take(limit + 1),
                    &folder,
                    known,
                    &worker_token,
                    callback,
                )
            })
            .await
            .map_err(|_| "Не удалось прочитать файл")?
            .map_err(|e| e.to_string())?;
            upload.size = prepared.size;
            let callback = progress(app, txn.clone(), session_key);
            let sent = account
                .send_prepared_file(upload, prepared, token.clone(), callback)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!(sent))
        }
        .await;
        token.cancel();
        state.transfers.lock().await.remove(&txn);
        if result.is_ok() {
            let _ = matrixgram_core::android_release_shared_file(&handle);
        }
        result
    }
}

#[tauri::command]
pub async fn release_shared_file(handle: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        matrixgram_core::android_release_shared_file(&handle).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = handle;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_chunk_reader_acknowledges_consumed_data_in_order() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let token = CancellationToken::new();
        let thread = std::thread::spawn(move || {
            let mut reader = ChunkReader {
                receiver,
                current: None,
                offset: 0,
                token,
            };
            let mut bytes = Vec::new();
            reader.read_to_end(&mut bytes).unwrap();
            bytes
        });
        for bytes in [b"first ".to_vec(), b"second".to_vec()] {
            let (acknowledgement, received) = oneshot::channel();
            sender
                .send(Chunk {
                    bytes,
                    acknowledgement,
                })
                .unwrap();
            received.blocking_recv().unwrap();
        }
        drop(sender);
        assert_eq!(thread.join().unwrap(), b"first second");
    }
    #[test]
    fn idle_chunk_reader_observes_cancellation_without_another_ipc_message() {
        let (_sender, receiver) = mpsc::sync_channel(1);
        let token = CancellationToken::new();
        let cancel = token.clone();
        let thread = std::thread::spawn(move || {
            let mut reader = ChunkReader {
                receiver,
                current: None,
                offset: 0,
                token,
            };
            reader.read(&mut [0; 1])
        });
        let started = Instant::now();
        cancel.cancel();
        assert!(thread.join().unwrap().is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
