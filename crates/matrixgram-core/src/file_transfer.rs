//! Bounded file I/O. Only metadata and small chunks cross IPC. Staged uploads
//! are encrypted on disk even for plaintext rooms; ephemeral keys stay in Rust.
use crate::{
    Account,
    models::{CoreError, Result, network_error},
};
pub use matrix_sdk::ruma::events::room::MediaSource;
use matrix_sdk::{
    Client,
    bytes::Bytes,
    ruma::{
        OwnedMxcUri,
        api::{Metadata, client::authenticated_media},
        events::room::{EncryptedFileHash, EncryptedFileHashAlgorithm},
    },
};
use matrix_sdk_crypto::{AttachmentDecryptor, AttachmentEncryptor, MediaEncryptionInfo};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

pub const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024;
pub const IPC_CHUNK_BYTES: usize = 1024 * 1024;
pub const IO_CHUNK_BYTES: usize = 256 * 1024;
pub const PREVIEW_BYTES: u64 = 25 * 1024 * 1024;
pub type Progress = Arc<dyn Fn(&str, u64, Option<u64>) + Send + Sync>;
#[cfg(test)]
mod tests;

pub fn quiet_progress() -> Progress {
    Arc::new(|_, _, _| {})
}
fn cancelled() -> CoreError {
    CoreError::User("Передача файла отменена".into())
}
fn check_cancel(token: &CancellationToken) -> Result<()> {
    if token.is_cancelled() {
        Err(cancelled())
    } else {
        Ok(())
    }
}
pub fn check_size(size: u64) -> Result<()> {
    if size == 0 || size > MAX_FILE_BYTES {
        return Err(CoreError::User(
            "Размер файла должен быть от 1 байта до 500 МБ (524 288 000 байт)".into(),
        ));
    }
    Ok(())
}
fn copy_info(info: &MediaEncryptionInfo) -> MediaEncryptionInfo {
    MediaEncryptionInfo {
        encryption_info: info.encryption_info.clone(),
        hashes: info.hashes.clone(),
    }
}

struct Meter {
    callback: Progress,
    phase: &'static str,
    last: Instant,
    total: Option<u64>,
}
impl Meter {
    fn new(callback: Progress, phase: &'static str, total: Option<u64>) -> Self {
        callback(phase, 0, total);
        Self {
            callback,
            phase,
            last: Instant::now(),
            total,
        }
    }
    fn report(&mut self, current: u64, force: bool) {
        if force || self.last.elapsed() >= Duration::from_millis(100) {
            (self.callback)(self.phase, current, self.total);
            self.last = Instant::now();
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUpload {
    pub room_id: String,
    pub name: String,
    pub mime: String,
    pub txn: String,
    pub size: u64,
}
impl FileUpload {
    pub fn validate(&self) -> Result<()> {
        check_size(self.size)?;
        if self.name.is_empty()
            || self.name.chars().count() > 255
            || self.name.contains(['\0', '\r', '\n'])
            || self.txn.is_empty()
            || self.txn.len() > 128
        {
            return Err(CoreError::User(
                "Некорректное имя файла или ID отправки".into(),
            ));
        }
        self.mime
            .parse::<mime::Mime>()
            .map_err(|_| CoreError::User("Некорректный тип файла".into()))?;
        Ok(())
    }
}

/// RAII removes ciphertext on error/cancel. No plaintext or encryption key is
/// written to a staging metadata file; this is not a persistent upload outbox.
pub struct PreparedFile {
    pub file: NamedTempFile,
    pub size: u64,
    info: MediaEncryptionInfo,
}
impl PreparedFile {
    pub fn from_reader(
        mut reader: impl Read,
        directory: &Path,
        expected: Option<u64>,
        token: &CancellationToken,
        progress: Progress,
    ) -> Result<Self> {
        if let Some(size) = expected {
            check_size(size)?;
        }
        let mut file = tempfile::Builder::new()
            .prefix("matrixgram-transfer-")
            .tempfile_in(directory)?;
        let mut encryptor = AttachmentEncryptor::new(&mut reader);
        let mut buffer = vec![0; IO_CHUNK_BYTES];
        let mut size = 0u64;
        let mut meter = Meter::new(progress, "preparing", expected);
        loop {
            check_cancel(token)?;
            let count = encryptor.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            size = size
                .checked_add(count as u64)
                .ok_or_else(|| CoreError::User("Некорректный размер файла".into()))?;
            check_size(size)?;
            if expected.is_some_and(|total| size > total) {
                return Err(CoreError::User(
                    "Размер файла изменился во время чтения".into(),
                ));
            }
            file.write_all(&buffer[..count])?;
            meter.report(size, false);
        }
        check_size(size)?;
        if expected.is_some_and(|total| size != total) {
            return Err(CoreError::User("Файл прочитан не полностью".into()));
        }
        file.flush()?;
        meter.report(size, true);
        Ok(Self {
            file,
            size,
            info: encryptor.finish(),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferLimits {
    pub client_bytes: u64,
    pub server_bytes: u64,
    pub effective_bytes: u64,
}

impl Account {
    pub async fn transfer_limits(&self) -> Result<TransferLimits> {
        let versions = self
            .client
            .supported_versions()
            .await
            .map_err(network_error)?;
        let size = if authenticated_media::get_media_config::v1::Request::PATH_BUILDER
            .is_supported(&versions)
        {
            self.client
                .send(authenticated_media::get_media_config::v1::Request::default())
                .await
                .map_err(network_error)?
                .upload_size
        } else {
            #[allow(deprecated)]
            self.client
                .send(
                    matrix_sdk::ruma::api::client::media::get_media_config::v3::Request::default(),
                )
                .await
                .map_err(network_error)?
                .upload_size
        };
        let server = u64::from(size);
        Ok(TransferLimits {
            client_bytes: MAX_FILE_BYTES,
            server_bytes: server,
            effective_bytes: server.min(MAX_FILE_BYTES),
        })
    }
    pub async fn prepare_file_upload(&self, upload: &FileUpload) -> Result<()> {
        upload.validate()?;
        let room = self.writable_room(&upload.room_id).await?;
        let power = room.power_levels_or_default().await;
        let user = self
            .client
            .user_id()
            .ok_or_else(|| CoreError::User("Выполните вход".into()))?;
        if !power.user_can_send_message(
            user,
            matrix_sdk::ruma::events::MessageLikeEventType::RoomMessage,
        ) {
            return Err(CoreError::User(
                "В этой комнате нельзя отправлять сообщения".into(),
            ));
        }
        let limit = self.transfer_limits().await?;
        if upload.size > limit.server_bytes {
            return Err(CoreError::User(format!(
                "Сервер разрешает файлы до {} МБ. Лимит клиента — 500 МБ; настройки сервера не изменены.",
                limit.server_bytes / 1024 / 1024
            )));
        }
        Ok(())
    }
    pub async fn send_prepared_file(
        &self,
        upload: FileUpload,
        prepared: PreparedFile,
        token: CancellationToken,
        progress: Progress,
    ) -> Result<String> {
        self.prepare_file_upload(&upload).await?;
        check_cancel(&token)?;
        if prepared.size != upload.size {
            return Err(CoreError::User(
                "Размер подготовленного файла не совпал".into(),
            ));
        }
        let room = self.writable_room(&upload.room_id).await?;
        let encrypted = room.encryption_state().is_encrypted();
        let uri = upload_content(
            &self.client,
            &prepared,
            &upload,
            encrypted,
            token.clone(),
            progress,
        )
        .await?;
        check_cancel(&token)?;
        let room = self.writable_room(&upload.room_id).await?;
        if room.encryption_state().is_encrypted() != encrypted {
            return Err(CoreError::User(
                "Шифрование комнаты изменилось во время передачи. Повторите отправку.".into(),
            ));
        }
        let mime: mime::Mime = upload.mime.parse().map_err(network_error)?;
        let kind = if upload.size > PREVIEW_BYTES {
            "m.file"
        } else {
            match mime.type_().as_str() {
                "image" => "m.image",
                "audio" => "m.audio",
                "video" => "m.video",
                _ => "m.file",
            }
        };
        let mut content = json!({"msgtype":kind,"body":upload.name,"filename":upload.name,"info":{"mimetype":upload.mime,"size":upload.size},"m.mentions":{}});
        if encrypted {
            let mut file = serde_json::to_value(&prepared.info)?;
            file["url"] = json!(uri);
            content["file"] = file;
        } else {
            content["url"] = json!(uri);
        }
        let sending = room
            .send_raw("m.room.message", content)
            .with_transaction_id(upload.txn.as_str().into());
        let sent = tokio::select! {biased; _=token.cancelled()=>return Err(cancelled()), result=sending=>result.map_err(network_error)?};
        Ok(sent.response.event_id.to_string())
    }
}

fn endpoint(client: &Client, segments: &[&str]) -> Result<url::Url> {
    let mut url = client.homeserver();
    url.set_query(None);
    url.set_fragment(None);
    url.path_segments_mut()
        .map_err(|_| CoreError::User("Некорректный адрес сервера".into()))?
        .clear()
        .extend(segments);
    Ok(url)
}
fn authorize(client: &Client, request: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder> {
    let token = client
        .access_token()
        .ok_or_else(|| CoreError::User("Выполните вход заново".into()))?;
    Ok(request.bearer_auth(token).header(
        reqwest::header::USER_AGENT,
        concat!("MatrixGram/", env!("CARGO_PKG_VERSION")),
    ))
}
fn response_error(status: reqwest::StatusCode) -> CoreError {
    match status.as_u16() {
        413 => CoreError::User(
            "Сервер или reverse proxy отклонил размер файла (HTTP 413). Лимит клиента — 500 МБ."
                .into(),
        ),
        401 => CoreError::User("Сессия истекла. Выполните вход заново.".into()),
        403 => CoreError::User("Сервер запретил доступ к файлу".into()),
        404 => CoreError::User("Файл не найден на сервере".into()),
        429 => CoreError::User("Сервер ограничил частоту запросов. Повторите позже.".into()),
        _ => network_error(status),
    }
}

fn pump_reader(
    mut reader: impl Read,
    sender: tokio::sync::mpsc::Sender<std::io::Result<Bytes>>,
    size: u64,
    token: CancellationToken,
    progress: Progress,
) -> std::io::Result<()> {
    let mut current = 0u64;
    let mut meter = Meter::new(progress, "uploading", Some(size));
    loop {
        if token.is_cancelled() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "cancelled",
            ));
        }
        let mut buffer = vec![0; IO_CHUNK_BYTES];
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        buffer.truncate(count);
        current += count as u64;
        if current > size {
            return Err(std::io::Error::other("file size changed"));
        }
        if sender.blocking_send(Ok(Bytes::from(buffer))).is_err() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "upload interrupted",
            ));
        }
        meter.report(current, false);
    }
    if current != size {
        return Err(std::io::Error::other("incomplete file"));
    }
    meter.report(current, true);
    Ok(())
}

async fn upload_content(
    client: &Client,
    prepared: &PreparedFile,
    upload: &FileUpload,
    encrypted: bool,
    token: CancellationToken,
    progress: Progress,
) -> Result<OwnedMxcUri> {
    let file = prepared.file.reopen()?;
    let info = copy_info(&prepared.info);
    let size = prepared.size;
    let (sender, receiver) = tokio::sync::mpsc::channel(2);
    let (completed, completion) = tokio::sync::oneshot::channel();
    let worker_token = token.clone();
    tokio::task::spawn_blocking(move || {
        let errors = sender.clone();
        let mut file = file;
        let result = if encrypted {
            pump_reader(&mut file, sender, size, worker_token, progress)
        } else {
            match AttachmentDecryptor::new(&mut file, info) {
                Ok(reader) => pump_reader(reader, sender, size, worker_token, progress),
                Err(_) => Err(std::io::Error::other("invalid encryption descriptor")),
            }
        };
        let success = result.is_ok();
        if let Err(error) = result {
            let _ = errors.blocking_send(Err(error));
        }
        drop(file);
        let _ = completed.send(success);
    });
    let body = reqwest::Body::wrap_stream(tokio_stream::wrappers::ReceiverStream::new(receiver));
    let mut url = endpoint(client, &["_matrix", "media", "v3", "upload"])?;
    url.query_pairs_mut().append_pair("filename", &upload.name);
    let mime = if encrypted {
        "application/octet-stream"
    } else {
        &upload.mime
    };
    let request = authorize(client, client.http_client().post(url))?
        .header(reqwest::header::CONTENT_TYPE, mime)
        .header(reqwest::header::CONTENT_LENGTH, size)
        .timeout(Duration::from_secs(6 * 60 * 60))
        .body(body);
    let mut response = tokio::select! {biased; _=token.cancelled()=>return Err(cancelled()), value=request.send()=>value.map_err(network_error)?};
    if !response.status().is_success() {
        return Err(response_error(response.status()));
    }
    let complete = tokio::select! {biased;_=token.cancelled()=>return Err(cancelled()),value=completion=>value.unwrap_or(false)};
    if !complete {
        return Err(CoreError::User("Файл передан не полностью".into()));
    }
    // Upload responses are tiny. Never trust an unbounded JSON response body.
    let mut bytes = Vec::new();
    loop {
        let next = tokio::select! {biased;_=token.cancelled()=>return Err(cancelled()),value=tokio::time::timeout(Duration::from_secs(90),response.chunk())=>value.map_err(network_error)?.map_err(network_error)?};
        let Some(chunk) = next else { break };
        if bytes.len() + chunk.len() > 64 * 1024 {
            return Err(CoreError::User(
                "Некорректный ответ сервера загрузки".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    let uri: OwnedMxcUri = value["content_uri"]
        .as_str()
        .ok_or_else(|| CoreError::User("Сервер не вернул адрес файла".into()))?
        .into();
    if !uri.is_valid() {
        return Err(CoreError::User(
            "Сервер вернул некорректный адрес файла".into(),
        ));
    }
    Ok(uri)
}

fn source_info(source: &MediaSource) -> Result<Option<MediaEncryptionInfo>> {
    if let MediaSource::Encrypted(file) = source {
        let info: MediaEncryptionInfo = file.as_ref().clone().into();
        let mut empty = std::io::empty();
        AttachmentDecryptor::new(&mut empty, copy_info(&info))
            .map_err(|_| CoreError::User("Некорректные ключи вложения".into()))?;
        Ok(Some(info))
    } else {
        Ok(None)
    }
}

pub async fn download_ciphertext(
    client: &Client,
    source: &MediaSource,
    directory: &Path,
    limit: u64,
    token: CancellationToken,
    progress: Progress,
) -> Result<NamedTempFile> {
    check_cancel(&token)?;
    let info = source_info(source)?;
    let uri = match source {
        MediaSource::Plain(uri) => uri,
        MediaSource::Encrypted(file) => &file.url,
    };
    let (server, media) = uri
        .parts()
        .map_err(|_| CoreError::User("Некорректный адрес файла".into()))?;
    let versions = client.supported_versions().await.map_err(network_error)?;
    let authenticated =
        authenticated_media::get_content::v1::Request::PATH_BUILDER.is_supported(&versions);
    let url = if authenticated {
        endpoint(
            client,
            &[
                "_matrix",
                "client",
                "v1",
                "media",
                "download",
                server.as_str(),
                media,
            ],
        )?
    } else {
        endpoint(
            client,
            &["_matrix", "media", "v3", "download", server.as_str(), media],
        )?
    };
    let request =
        authorize(client, client.http_client().get(url))?.timeout(Duration::from_secs(6 * 60 * 60));
    let mut response = tokio::select! {biased;_=token.cancelled()=>return Err(cancelled()),value=tokio::time::timeout(Duration::from_secs(90),request.send())=>value.map_err(network_error)?.map_err(network_error)?};
    if !response.status().is_success() {
        return Err(response_error(response.status()));
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > limit) {
        return Err(CoreError::User(
            if limit == PREVIEW_BYTES {
                "Для большого файла нажмите «Сохранить»: предпросмотр ограничен 25 МБ"
            } else {
                "Файл превышает лимит клиента 500 МБ"
            }
            .into(),
        ));
    }
    let temporary = tempfile::Builder::new()
        .prefix("matrixgram-transfer-")
        .tempfile_in(directory)?;
    let mut output = tokio::fs::File::from_std(temporary.reopen()?);
    let mut current = 0u64;
    let mut hash = Sha256::new();
    let mut meter = Meter::new(progress, "downloading", total);
    loop {
        let next = tokio::select! {biased;_=token.cancelled()=>return Err(cancelled()),value=tokio::time::timeout(Duration::from_secs(90),response.chunk())=>value.map_err(network_error)?.map_err(network_error)?};
        let Some(chunk) = next else { break };
        current = current
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| CoreError::User("Некорректный размер файла".into()))?;
        if current > limit {
            return Err(CoreError::User(
                if limit == PREVIEW_BYTES {
                    "Для большого файла нажмите «Сохранить»: предпросмотр ограничен 25 МБ"
                } else {
                    "Файл превышает лимит клиента 500 МБ"
                }
                .into(),
            ));
        }
        hash.update(&chunk);
        output.write_all(&chunk).await?;
        meter.report(current, false);
    }
    if total.is_some_and(|size| size != current) {
        return Err(CoreError::User("Файл скачан не полностью".into()));
    }
    if let Some(info) = info {
        let Some(EncryptedFileHash::Sha256(expected)) =
            info.hashes.get(&EncryptedFileHashAlgorithm::Sha256)
        else {
            return Err(CoreError::User("Нет контрольной суммы вложения".into()));
        };
        let expected: [u8; 32] = expected.clone().into_inner();
        if hash.finalize().as_slice() != expected {
            return Err(CoreError::User(
                "Не совпала контрольная сумма зашифрованного файла. Файл не сохранён.".into(),
            ));
        }
    }
    output.flush().await?;
    drop(output);
    meter.report(current, true);
    Ok(temporary)
}

fn decode_to(
    source: &MediaSource,
    input: &mut std::fs::File,
    mut output: impl Write,
    token: &CancellationToken,
    progress: Progress,
    size: u64,
) -> Result<()> {
    let info = source_info(source)?;
    let mut meter = Meter::new(progress, "saving", Some(size));
    let mut reader: Box<dyn Read + '_> = match info {
        Some(info) => Box::new(AttachmentDecryptor::new(input, info).map_err(network_error)?),
        None => Box::new(input),
    };
    let mut buffer = vec![0; IO_CHUNK_BYTES];
    let mut current = 0;
    loop {
        check_cancel(token)?;
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count])?;
        current += count as u64;
        meter.report(current, false);
    }
    output.flush()?;
    meter.report(current, true);
    Ok(())
}

pub async fn download_to_path(
    client: &Client,
    source: MediaSource,
    path: std::path::PathBuf,
    token: CancellationToken,
    progress: Progress,
) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::User("Выберите папку сохранения".into()))?;
    let temporary = download_ciphertext(
        client,
        &source,
        parent,
        MAX_FILE_BYTES,
        token.clone(),
        progress.clone(),
    )
    .await?;
    tokio::task::spawn_blocking(move || {
        check_cancel(&token)?;
        if matches!(source, MediaSource::Plain(_)) {
            temporary.as_file().sync_all()?;
            check_cancel(&token)?;
            temporary
                .persist(path)
                .map_err(|error| CoreError::Io(error.error))?;
        } else {
            let mut decoded = tempfile::Builder::new()
                .prefix("matrixgram-transfer-")
                .tempfile_in(path.parent().unwrap())?;
            let mut input = temporary.reopen()?;
            let size = temporary.as_file().metadata()?.len();
            decode_to(&source, &mut input, &mut decoded, &token, progress, size)?;
            decoded.as_file().sync_all()?;
            check_cancel(&token)?;
            decoded
                .persist(path)
                .map_err(|error| CoreError::Io(error.error))?;
        }
        Ok(())
    })
    .await
    .map_err(network_error)?
}

/// SAF output handles cannot be renamed. Verify ciphertext first, then stream
/// to the explicitly created output document; never expose unauthenticated bytes.
pub async fn download_to_writer(
    client: &Client,
    source: MediaSource,
    directory: &Path,
    output: std::fs::File,
    token: CancellationToken,
    progress: Progress,
) -> Result<()> {
    let temporary = download_ciphertext(
        client,
        &source,
        directory,
        MAX_FILE_BYTES,
        token.clone(),
        progress.clone(),
    )
    .await?;
    tokio::task::spawn_blocking(move || {
        let mut input = temporary.reopen()?;
        let size = temporary.as_file().metadata()?.len();
        decode_to(&source, &mut input, output, &token, progress, size)
    })
    .await
    .map_err(network_error)?
}

pub async fn preview_bytes(
    client: &Client,
    source: MediaSource,
    directory: &Path,
) -> Result<Vec<u8>> {
    let token = CancellationToken::new();
    let temporary = download_ciphertext(
        client,
        &source,
        directory,
        PREVIEW_BYTES,
        token.clone(),
        quiet_progress(),
    )
    .await?;
    tokio::task::spawn_blocking(move || {
        let mut input = temporary.reopen()?;
        let size = temporary.as_file().metadata()?.len();
        let mut output = Vec::with_capacity(size as usize);
        decode_to(
            &source,
            &mut input,
            &mut output,
            &token,
            quiet_progress(),
            size,
        )?;
        Ok(output)
    })
    .await
    .map_err(network_error)?
}
