use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, path_regex},
};

struct Fixture {
    server: MockServer,
    account: Account,
    _dir: tempfile::TempDir,
}

fn sync_response(encrypted: bool) -> Value {
    let mut state = vec![
        json!({"type":"m.room.create","state_key":"","sender":"@alice:example.org","event_id":"$create","origin_server_ts":1,"content":{"creator":"@alice:example.org","room_version":"10"}}),
        json!({"type":"m.room.member","state_key":"@alice:example.org","sender":"@alice:example.org","event_id":"$member","origin_server_ts":2,"content":{"membership":"join","displayname":"Alice"}}),
        json!({"type":"m.room.name","state_key":"","sender":"@alice:example.org","event_id":"$name","origin_server_ts":3,"content":{"name":"Test room"}}),
    ];
    if encrypted {
        state.push(json!({"type":"m.room.encryption","state_key":"","sender":"@alice:example.org","event_id":"$enc","origin_server_ts":4,"content":{"algorithm":"m.megolm.v1.aes-sha2"}}));
    }
    json!({
        "next_batch":"next-batch",
        "rooms":{"join":{"!test:example.org":{
            "state":{"events":state},
            "timeline":{"events":[{"type":"m.room.message","event_id":"$hello","sender":"@alice:example.org","origin_server_ts":10,"content":{"msgtype":"m.text","body":"hello"}}],"limited":false,"prev_batch":"older"},
            "ephemeral":{"events":[]}, "account_data":{"events":[]},
            "summary":{"m.joined_member_count":1},
            "unread_notifications":{"notification_count":1,"highlight_count":0}
        }}},
        "account_data":{"events":[]}, "to_device":{"events":[]}, "presence":{"events":[]}
    })
}

async fn fixture(encrypted: bool) -> Fixture {
    install_tls();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_matrix/client/versions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"versions":["v1.12"],"unstable_features":{}})),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST")).and(path("/_matrix/client/v3/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"user_id":"@alice:example.org","device_id":"TEST","access_token":"not-a-real-token"}))).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/sync"))
        .respond_with(ResponseTemplate::new(200).set_body_json(sync_response(encrypted)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/keys/upload"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"one_time_key_counts":{"signed_curve25519":50}})),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/keys/query"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"device_keys":{},"failures":{}})),
        )
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("sdk");
    // HTTP is permitted only inside this test fixture, never through login IPC.
    let client = Client::builder()
        .homeserver_url(server.uri())
        .sqlite_store(&store, None)
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
    let account = Account::from_client(client, dir.path(), store, server.uri(), false).unwrap();
    account.sync_once().await.unwrap();
    Fixture {
        server,
        account,
        _dir: dir,
    }
}

async fn unencrypted_state(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/state/m.room.encryption/?$",
        ))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(json!({"errcode":"M_NOT_FOUND","error":"No encryption state"})),
        )
        .mount(server)
        .await;
}

#[tokio::test]
async fn sync_populates_rooms_and_persistent_timeline() {
    let fixture = fixture(false).await;
    let rooms = fixture.account.rooms().await.unwrap();
    assert_eq!(rooms.len(), 1);
    assert_eq!(rooms[0].name, "Test room");
    assert_eq!(
        fixture.account.cache.events("!test:example.org").unwrap()[0]["content"]["body"],
        "hello"
    );
}

#[tokio::test]
async fn plaintext_send_uses_matrix_transaction_id_and_authorization() {
    let f = fixture(false).await;
    unencrypted_state(&f.server).await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.room.message/retry-123$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$sent"})))
        .expect(2)
        .mount(&f.server)
        .await;
    for _ in 0..2 {
        assert_eq!(
            f.account
                .send_text("!test:example.org", "Привет 👋", "retry-123", None)
                .await
                .unwrap(),
            "$sent"
        );
    }
    let requests = f.server.received_requests().await.unwrap();
    let sends = requests
        .iter()
        .filter(|r| r.method == "PUT")
        .collect::<Vec<_>>();
    assert_eq!(sends.len(), 2);
    assert_eq!(sends[0].body_json::<Value>().unwrap()["body"], "Привет 👋");
    assert_eq!(
        sends[0].headers.get("authorization").unwrap(),
        "Bearer not-a-real-token"
    );
}

#[tokio::test]
async fn encrypted_room_refuses_all_content_writes() {
    let f = fixture(true).await;
    assert_eq!(f.account.rooms().await.unwrap()[0].encryption, "encrypted");
    assert!(
        f.account
            .send_text("!test:example.org", "must not leak", "txn", None)
            .await
            .is_err()
    );
    assert!(
        f.account
            .edit("!test:example.org", "$hello", "must not leak")
            .await
            .is_err()
    );
    assert!(
        f.account
            .react("!test:example.org", "$hello", "👍")
            .await
            .is_err()
    );
    assert!(
        !f.server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.method == "PUT")
    );
}

#[tokio::test]
async fn encryption_enabled_after_sync_blocks_send() {
    let f = fixture(false).await;
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/state/m.room.encryption/?$",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"algorithm":"m.megolm.v1.aes-sha2"})),
        )
        .mount(&f.server)
        .await;
    assert!(
        f.account
            .send_text("!test:example.org", "must not leak", "txn", None)
            .await
            .is_err()
    );
    assert!(
        !f.server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.method == "PUT")
    );
}

#[tokio::test]
async fn uncertain_encryption_state_is_not_treated_as_plaintext() {
    let f = fixture(false).await;
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/state/m.room.encryption/?$",
        ))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(json!({"errcode":"M_FORBIDDEN","error":"No access"})),
        )
        .mount(&f.server)
        .await;
    assert!(
        f.account
            .send_text("!test:example.org", "must not leak", "txn", None)
            .await
            .is_err()
    );
    assert!(
        !f.server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.method == "PUT")
    );
}

#[tokio::test]
async fn pagination_passes_cursor_and_caches_response_without_duplicate_events() {
    let f = fixture(false).await;
    unencrypted_state(&f.server).await;
    Mock::given(method("GET")).and(path_regex(r"/_matrix/client/v3/rooms/.*/messages$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"start":"older","end":"oldest","chunk":[{"type":"m.room.message","event_id":"$old","sender":"@bob:example.org","origin_server_ts":5,"content":{"msgtype":"m.text","body":"earlier"}}],"state":[]})))
        .mount(&f.server).await;
    let page = f
        .account
        .history("!test:example.org", Some("older".into()))
        .await
        .unwrap();
    assert_eq!(page.next.as_deref(), Some("oldest"));
    assert_eq!(page.events[0]["content"]["body"], "earlier");
    assert_eq!(
        f.account.cache.events("!test:example.org").unwrap().len(),
        2
    );
    let requests = f.server.received_requests().await.unwrap();
    let history = requests
        .iter()
        .find(|r| r.url.path().ends_with("/messages"))
        .unwrap();
    assert!(
        history
            .url
            .query_pairs()
            .any(|(k, v)| k == "from" && v == "older")
    );
}

#[tokio::test]
async fn directory_search_uses_display_name_and_returns_full_user_ids() {
    let f = fixture(false).await;
    Mock::given(method("POST")).and(path("/_matrix/client/v3/user_directory/search"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"results":[{"user_id":"@ivan:example.org","display_name":"Иван Иванов"}],"limited":true}))).mount(&f.server).await;
    let result = f.account.search_users("Иванов").await.unwrap();
    assert_eq!(result.users[0].display_name, "Иван Иванов");
    assert_eq!(result.users[0].user_id, "@ivan:example.org");
    assert!(result.limited);
    assert!(f.account.search_users("я").await.unwrap().users.is_empty());
    let request = f
        .server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.url.path().ends_with("/user_directory/search"))
        .unwrap();
    assert_eq!(
        request.body_json::<Value>().unwrap()["search_term"],
        "Иванов"
    );
}

#[tokio::test]
async fn opening_a_person_creates_one_unencrypted_direct_chat_and_reuses_it() {
    let f = fixture(false).await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/createRoom"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"room_id":"!dm:example.org"})),
        )
        .expect(1)
        .mount(&f.server)
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/user/.*/account_data/m.direct$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&f.server)
        .await;
    assert_eq!(
        f.account.open_direct("@ivan:example.org").await.unwrap(),
        "!dm:example.org"
    );
    assert_eq!(
        f.account.open_direct("@ivan:example.org").await.unwrap(),
        "!dm:example.org"
    );
    let request = f
        .server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.url.path().ends_with("/createRoom"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(request["is_direct"], true);
    assert!(!request.to_string().contains("m.room.encryption"));
}

async fn encrypted_export() -> (String, Value) {
    use matrix_sdk::ruma::{
        device_id, events::room::message::RoomMessageEventContent, room_id, user_id,
    };
    let machine =
        matrix_sdk_crypto::OlmMachine::new(user_id!("@bob:example.org"), device_id!("BOB")).await;
    let room = room_id!("!test:example.org");
    machine
        .share_room_key(
            room,
            std::iter::empty(),
            matrix_sdk_crypto::EncryptionSettings::default(),
        )
        .await
        .unwrap();
    let content = RoomMessageEventContent::text_plain("Секретное сообщение из Megolm");
    let encrypted = machine.encrypt_room_event(room, content).await.unwrap();
    let keys = machine
        .store()
        .export_room_keys(|session| session.room_id() == room)
        .await
        .unwrap();
    assert!(!keys.is_empty());
    let export = matrix_sdk_crypto::encrypt_room_key_export(&keys, "export-password", 1).unwrap();
    (
        export,
        json!({"event_id":"$encrypted","sender":"@bob:example.org","room_id":room,"origin_server_ts":100,"type":"m.room.encrypted","content":encrypted.content}),
    )
}

#[tokio::test]
async fn encrypted_export_import_decrypts_real_megolm_history_without_plaintext_cache() {
    let f = fixture(true).await;
    let (export, encrypted) = encrypted_export().await;
    Mock::given(method("GET"))
        .and(path_regex(r"/_matrix/client/v3/rooms/.*/messages$"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"start":"now","chunk":[encrypted],"state":[]})),
        )
        .mount(&f.server)
        .await;
    assert!(!f.account.encryption_status().await.enabled);
    assert!(f.account.history("!test:example.org", None).await.is_err());
    assert!(
        f.account
            .import_encryption_keys(export.clone(), "wrong-password".into())
            .await
            .is_err()
    );
    assert!(!f.account.encryption_status().await.enabled);
    assert_eq!(
        f.account
            .import_encryption_keys(export, "export-password".into())
            .await
            .unwrap(),
        1
    );
    assert!(f.account.encryption_status().await.enabled);
    let page = f.account.history("!test:example.org", None).await.unwrap();
    assert_eq!(
        page.events[0]["content"]["body"],
        "Секретное сообщение из Megolm"
    );
    assert_eq!(page.events[0]["type"], "m.room.message");
    assert!(
        f.account
            .cache
            .events("!test:example.org")
            .unwrap()
            .is_empty()
    );
    assert!(f.account.cache.setting::<bool>("e2ee_enabled").unwrap());
    f.account
        .save_draft("!test:example.org", "private draft")
        .unwrap();
    assert!(
        f.account
            .cache
            .draft("!test:example.org")
            .unwrap()
            .is_empty()
    );
    #[cfg(windows)]
    assert_eq!(
        f.account.draft("!test:example.org").unwrap(),
        "private draft"
    );
}

#[tokio::test]
async fn enabled_e2ee_sends_ciphertext_instead_of_plaintext() {
    let f = fixture(true).await;
    f.account.enable_encryption().await.unwrap();
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/state/m.room.encryption/?$",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"algorithm":"m.megolm.v1.aes-sha2"})),
        )
        .mount(&f.server)
        .await;
    Mock::given(method("GET")).and(path_regex(r"/_matrix/client/v3/rooms/.*/members$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"chunk":[{"type":"m.room.member","state_key":"@alice:example.org","sender":"@alice:example.org","event_id":"$m","origin_server_ts":2,"content":{"membership":"join"}}]}))).mount(&f.server).await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.room.encrypted/cipher-txn$",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"event_id":"$sent-encrypted"})),
        )
        .expect(1)
        .mount(&f.server)
        .await;
    assert_eq!(
        f.account
            .send_text(
                "!test:example.org",
                "PRIVATE DO NOT LEAK",
                "cipher-txn",
                None
            )
            .await
            .unwrap(),
        "$sent-encrypted"
    );
    let requests = f.server.received_requests().await.unwrap();
    let send = requests
        .iter()
        .find(|r| r.url.path().contains("/send/m.room.encrypted/"))
        .unwrap();
    let body = send.body_json::<Value>().unwrap();
    assert_eq!(body["algorithm"], "m.megolm.v1.aes-sha2");
    assert!(body["ciphertext"].is_string());
    assert!(!String::from_utf8_lossy(&send.body).contains("PRIVATE DO NOT LEAK"));
}

#[tokio::test]
async fn sdk_store_is_protected_by_its_passphrase() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("protected");
    drop(
        build_client("https://matrix.example.org", &path, "store-password")
            .await
            .unwrap(),
    );
    assert!(
        build_client("https://matrix.example.org", &path, "wrong-password")
            .await
            .is_err()
    );
    assert!(
        build_client("https://matrix.example.org", &path, "store-password")
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn legacy_session_format_loads_without_requiring_a_recovery_key() {
    let f = fixture(false).await;
    let value = json!({"homeserver":"https://matrix.example.org","store_id":uuid::Uuid::new_v4().to_string(),"session":f.account.client.matrix_auth().session().unwrap()});
    let saved: SavedSession = serde_json::from_value(value).unwrap();
    assert!(saved.store_passphrase.is_none());
    assert!(!f.account.encryption_status().await.enabled);
}

#[tokio::test]
async fn created_room_has_no_encryption_state_and_uses_standard_room_preset() {
    let f = fixture(false).await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/createRoom"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"room_id":"!new:example.org"})),
        )
        .mount(&f.server)
        .await;
    assert_eq!(
        f.account
            .create_room("New room", vec!["@bob:example.org".into()], false)
            .await
            .unwrap(),
        "!new:example.org"
    );
    let requests = f.server.received_requests().await.unwrap();
    let create = requests
        .iter()
        .find(|r| r.url.path().ends_with("/createRoom"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(create["preset"], "private_chat");
    assert!(!create.to_string().contains("m.room.encryption"));
}

#[tokio::test]
async fn existing_turn_is_discovered_via_client_api() {
    let f = fixture(false).await;
    Mock::given(method("GET")).and(path("/_matrix/client/v3/voip/turnServer"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"uris":["turn:turn.example.org:3478?transport=udp"],"username":"short-lived-user","password":"short-lived-password","ttl":3600}))).mount(&f.server).await;
    let result = f.account.turn_servers().await.unwrap();
    assert_eq!(
        result["urls"][0],
        "turn:turn.example.org:3478?transport=udp"
    );
    assert_eq!(result["ttl"], 3600);
}

#[tokio::test]
async fn already_revoked_session_can_still_be_logged_out_locally() {
    let f = fixture(false).await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/logout"))
        .respond_with(ResponseTemplate::new(401).set_body_json(
            json!({"errcode":"M_UNKNOWN_TOKEN","error":"Revoked","soft_logout":false}),
        ))
        .mount(&f.server)
        .await;
    f.account.logout().await.unwrap();
}
