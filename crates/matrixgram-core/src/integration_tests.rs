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
