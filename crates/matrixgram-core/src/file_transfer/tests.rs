use super::*;

#[test]
fn size_boundary_accepts_exactly_five_hundred_mib() {
    assert!(check_size(MAX_FILE_BYTES).is_ok());
    assert!(check_size(MAX_FILE_BYTES + 1).is_err());
    assert!(check_size(0).is_err());
    assert_eq!(MAX_FILE_BYTES, 524_288_000);
}

#[test]
fn staging_uses_sdk_ciphertext_and_removes_an_incomplete_file() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = b"PRIVATE-FILE-STAGING-MARKER";
    let token = CancellationToken::new();
    let staged = PreparedFile::from_reader(
        &bytes[..],
        dir.path(),
        Some(bytes.len() as u64),
        &token,
        quiet_progress(),
    )
    .unwrap();
    let ciphertext = std::fs::read(staged.file.path()).unwrap();
    assert_ne!(ciphertext, bytes);
    let mut reader = std::io::Cursor::new(ciphertext);
    let mut decoded = Vec::new();
    AttachmentDecryptor::new(&mut reader, copy_info(&staged.info))
        .unwrap()
        .read_to_end(&mut decoded)
        .unwrap();
    assert_eq!(decoded, bytes);
    drop(staged);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    assert!(
        PreparedFile::from_reader(
            &bytes[..],
            dir.path(),
            Some(bytes.len() as u64 + 1),
            &token,
            quiet_progress()
        )
        .is_err()
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "manual read-only media/config check; no SDK store is opened and no device keys are changed"]
async fn saved_server_upload_limit_readonly() {
    let Ok(path) = std::env::var("MATRIXGRAM_REAL_PROFILE") else {
        return;
    };
    crate::install_tls();
    let data = crate::vault::load(&std::path::PathBuf::from(path).join("session.dpapi"))
        .expect("Cannot read protected session")
        .expect("No saved session");
    let saved: crate::SavedSession = serde_json::from_slice(&data).expect("Invalid saved session");
    let mut url =
        crate::policy::validate_homeserver(&saved.homeserver).expect("Invalid HTTPS homeserver");
    url.set_path("/_matrix/client/v1/media/config");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .expect("TLS client unavailable");
    let mut response = client
        .get(url)
        .bearer_auth(saved.session.tokens.access_token)
        .send()
        .await
        .expect("Media config request failed");
    assert!(
        response.status().is_success(),
        "Media config HTTP {}",
        response.status().as_u16()
    );
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.expect("Media config read failed") {
        assert!(body.len() + chunk.len() <= 64 * 1024);
        body.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&body).expect("Invalid media config");
    let size = value["m.upload.size"].as_u64().expect("No upload limit");
    println!(
        "SERVER_MEDIA_LIMIT_JSON {}",
        json!({"uploadBytes":size,"uploadMiB":size/1024/1024,"readOnly":true})
    );
}

// A streaming loopback server deliberately avoids wiremock's in-memory request
// collection. The load test really transfers the configured maximum file size; only fixed-size buffers and
// ciphertext files are retained on either side.
struct StreamServer {
    state: Arc<StreamState>,
    task: tokio::task::JoinHandle<()>,
}
struct StreamState {
    folder: tempfile::TempDir,
    received: std::sync::atomic::AtomicU64,
    tamper: std::sync::atomic::AtomicBool,
    stop: CancellationToken,
}
impl Drop for StreamServer {
    fn drop(&mut self) {
        self.state.stop.cancel();
        self.task.abort();
    }
}
async fn reply(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    mime: &str,
    body: &[u8],
) -> std::io::Result<()> {
    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await
}
async fn serve_stream(
    stream: tokio::net::TcpStream,
    state: Arc<StreamState>,
) -> std::io::Result<()> {
    use std::sync::atomic::Ordering;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt};
    let mut input = tokio::io::BufReader::new(stream);
    let mut header = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        if input.read_line(&mut line).await? == 0 {
            return Ok(());
        }
        header.push_str(&line);
        if header.len() > 16 * 1024 {
            return Err(std::io::Error::other("request header too large"));
        }
        if line == "\r\n" {
            break;
        }
    }
    let first = header.lines().next().unwrap_or_default();
    if first.contains("/_matrix/client/versions") {
        return reply(
            input.get_mut(),
            "200 OK",
            "application/json",
            br#"{"versions":["v1.12"],"unstable_features":{}}"#,
        )
        .await;
    }
    if first.contains("/login") {
        return reply(input.get_mut(),"200 OK","application/json",br#"{"user_id":"@alice:example.org","device_id":"TEST","access_token":"not-a-real-token"}"#).await;
    }
    if !header
        .to_ascii_lowercase()
        .contains("authorization: bearer not-a-real-token")
    {
        return reply(
            input.get_mut(),
            "401 Unauthorized",
            "application/json",
            b"{}",
        )
        .await;
    }
    if first.contains("/config") {
        return reply(
            input.get_mut(),
            "200 OK",
            "application/json",
            br#"{"m.upload.size":2147483648}"#,
        )
        .await;
    }
    if first.starts_with("POST ") && first.contains("/upload") {
        let length: u64 = header
            .lines()
            .find_map(|line| {
                let (key, value) = line.split_once(':')?;
                key.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse().ok())
                    .flatten()
            })
            .ok_or_else(|| std::io::Error::other("missing content length"))?;
        let mut file = tokio::fs::File::create(state.folder.path().join("received.bin")).await?;
        let mut buffer = vec![0; IO_CHUNK_BYTES];
        let mut received = 0;
        while received < length {
            let size = ((length - received) as usize).min(buffer.len());
            let count = tokio::select! {_=state.stop.cancelled()=>return Ok(()),value=input.read(&mut buffer[..size])=>value?};
            if count == 0 {
                return Err(std::io::Error::other("truncated upload"));
            }
            file.write_all(&buffer[..count]).await?;
            received += count as u64;
        }
        file.flush().await?;
        drop(file);
        state.received.store(received, Ordering::SeqCst);
        return reply(
            input.get_mut(),
            "200 OK",
            "application/json",
            br#"{"content_uri":"mxc://example.org/content"}"#,
        )
        .await;
    }
    if first.contains("/download/") {
        if first.contains("oversize") {
            input
                .get_mut()
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        MAX_FILE_BYTES + 1
                    )
                    .as_bytes(),
                )
                .await?;
            return Ok(());
        }
        if first.contains("chunked") {
            input.get_mut().write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n20\r\n01234567890123456789012345678901\r\n0\r\n\r\n").await?;
            return Ok(());
        }
        if first.contains("slow") {
            input
                .get_mut()
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 104857600\r\nConnection: close\r\n\r\n",
                )
                .await?;
            input.get_mut().write_all(&vec![0; 64 * 1024]).await?;
            state.stop.cancelled().await;
            return Ok(());
        }
        let mut file = tokio::fs::File::open(state.folder.path().join("received.bin")).await?;
        let size = file.metadata().await?.len();
        input
            .get_mut()
            .write_all(
                format!("HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await?;
        let mut buffer = vec![0; IO_CHUNK_BYTES];
        let mut first = true;
        loop {
            let count = file.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            if first && state.tamper.load(Ordering::SeqCst) {
                buffer[0] ^= 1;
            }
            first = false;
            tokio::select! {_=state.stop.cancelled()=>return Ok(()),value=input.get_mut().write_all(&buffer[..count])=>value?};
        }
        return Ok(());
    }
    reply(input.get_mut(), "404 Not Found", "application/json", b"{}").await
}
async fn stream_fixture() -> (StreamServer, Client) {
    crate::install_tls();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let state = Arc::new(StreamState {
        folder: tempfile::tempdir().unwrap(),
        received: 0.into(),
        tamper: false.into(),
        stop: CancellationToken::new(),
    });
    let current = state.clone();
    let task = tokio::spawn(async move {
        loop {
            let accepted =
                tokio::select! {_=current.stop.cancelled()=>break,value=listener.accept()=>value};
            let Ok((stream, _)) = accepted else { break };
            let state = current.clone();
            tokio::spawn(async move {
                let _ = serve_stream(stream, state).await;
            });
        }
    });
    let client = Client::builder()
        .homeserver_url(&url)
        .request_config(matrix_sdk::config::RequestConfig::new().retry_limit(0))
        .build()
        .await
        .unwrap();
    client
        .matrix_auth()
        .login_username("alice", "test-password")
        .send()
        .await
        .unwrap();
    (StreamServer { state, task }, client)
}
async fn transferred_file(
    size: u64,
    encrypted: bool,
) -> (StreamServer, Client, MediaSource, tempfile::TempDir) {
    use std::sync::atomic::Ordering;
    let (server, client) = stream_fixture().await;
    let folder = tempfile::tempdir().unwrap();
    let stage_folder = folder.path().to_path_buf();
    let token = CancellationToken::new();
    let staging_token = token.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        PreparedFile::from_reader(
            std::io::repeat(0x5a).take(size),
            &stage_folder,
            Some(size),
            &staging_token,
            quiet_progress(),
        )
    })
    .await
    .unwrap()
    .unwrap();
    let metadata = FileUpload {
        caption: None,
        reply_to: None,
        room_id: "!test:example.org".into(),
        name: "large.bin".into(),
        mime: "application/octet-stream".into(),
        txn: "stream-test".into(),
        size,
    };
    let uri = upload_content(
        &client,
        &prepared,
        &metadata,
        encrypted,
        token.clone(),
        quiet_progress(),
    )
    .await
    .unwrap();
    assert_eq!(server.state.received.load(Ordering::SeqCst), size);
    let source = if encrypted {
        let mut file = serde_json::to_value(&prepared.info).unwrap();
        file["url"] = json!(uri);
        serde_json::from_value(json!({"file":file})).unwrap()
    } else {
        MediaSource::Plain(uri)
    };
    drop(prepared);
    assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 0);
    (server, client, source, folder)
}
#[tokio::test]
async fn plaintext_and_e2ee_streams_roundtrip_without_base64() {
    for encrypted in [false, true] {
        let size = 3 * 1024 * 1024 + 17;
        let (_server, client, source, folder) = transferred_file(size, encrypted).await;
        let path = folder.path().join("saved.bin");
        download_to_path(
            &client,
            source,
            path.clone(),
            CancellationToken::new(),
            quiet_progress(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.iter().all(|byte| *byte == 0x5a));
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}
#[tokio::test]
async fn tampered_encrypted_download_does_not_replace_existing_file() {
    let (server, client, source, folder) = transferred_file(2 * 1024 * 1024, true).await;
    server
        .state
        .tamper
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let path = folder.path().join("existing.txt");
    std::fs::write(&path, b"keep existing file").unwrap();
    assert!(
        download_to_path(
            &client,
            source,
            path.clone(),
            CancellationToken::new(),
            quiet_progress()
        )
        .await
        .is_err()
    );
    assert_eq!(std::fs::read(path).unwrap(), b"keep existing file");
    assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
}
#[tokio::test]
async fn header_and_chunked_size_limits_do_not_leave_partial_files() {
    let (_server, client) = stream_fixture().await;
    let folder = tempfile::tempdir().unwrap();
    for (name, limit) in [("oversize", MAX_FILE_BYTES), ("chunked", 16)] {
        let source = MediaSource::Plain(format!("mxc://example.org/{name}").into());
        assert!(
            download_ciphertext(
                &client,
                &source,
                folder.path(),
                limit,
                CancellationToken::new(),
                quiet_progress()
            )
            .await
            .is_err()
        );
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 0);
    }
}
#[tokio::test]
async fn cancel_download_preserves_existing_file_and_removes_staging() {
    let (_server, client) = stream_fixture().await;
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("existing.bin");
    std::fs::write(&path, b"keep").unwrap();
    let token = CancellationToken::new();
    let cancel = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        cancel.cancel();
    });
    let source = MediaSource::Plain("mxc://example.org/slow".into());
    let result = tokio::time::timeout(
        Duration::from_secs(3),
        download_to_path(&client, source, path.clone(), token, quiet_progress()),
    )
    .await
    .expect("cancellation hung");
    assert!(result.is_err());
    assert_eq!(std::fs::read(path).unwrap(), b"keep");
    assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
}
#[tokio::test]
#[ignore = "actual 500 MiB encrypted upload/download over loopback; requires approximately 1.5 GiB free disk"]
async fn large_file_maximum_streaming_load() {
    let started = Instant::now();
    let size = MAX_FILE_BYTES;
    let (_server, client, source, folder) = transferred_file(size, true).await;
    let path = folder.path().join("maximum-file.bin");
    download_to_path(
        &client,
        source,
        path.clone(),
        CancellationToken::new(),
        quiet_progress(),
    )
    .await
    .unwrap();
    let expected = vec![0x5a; IO_CHUNK_BYTES];
    let mut buffer = vec![0; IO_CHUNK_BYTES];
    let mut file = std::fs::File::open(&path).unwrap();
    let mut count = 0u64;
    loop {
        let read = file.read(&mut buffer).unwrap();
        if read == 0 {
            break;
        }
        assert_eq!(&buffer[..read], &expected[..read]);
        count += read as u64;
    }
    assert_eq!(count, size);
    assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    println!(
        "LARGE_FILE_LOAD_JSON {}",
        json!({"bytes":size,"encrypted":true,"uploadAndDownloadVerified":true,"ioChunkBytes":IO_CHUNK_BYTES,"ipcChunkBytes":IPC_CHUNK_BYTES,"elapsedMs":started.elapsed().as_millis(),"fixture":"streaming loopback, SDK attachment cipher, actual 500 MiB; no real homeserver upload"})
    );
}
