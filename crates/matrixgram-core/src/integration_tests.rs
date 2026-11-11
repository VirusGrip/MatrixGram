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

#[tokio::test]
async fn direct_chat_uses_peer_avatar_and_two_member_group_keeps_room_avatar() {
    let f = fixture(false).await;
    let mut response = sync_response(false);
    response["next_batch"] = json!("group-avatar");
    response["rooms"]["join"]["!test:example.org"]["summary"]["m.joined_member_count"] = json!(2);
    let state = response["rooms"]["join"]["!test:example.org"]["state"]["events"]
        .as_array_mut()
        .unwrap();
    state.push(json!({"type":"m.room.member","state_key":"@bob:example.org","sender":"@bob:example.org","event_id":"$bob","origin_server_ts":12,"content":{"membership":"join","displayname":"Bob","avatar_url":"mxc://example.org/bob-photo"}}));
    state.push(json!({"type":"m.room.avatar","state_key":"","sender":"@alice:example.org","event_id":"$avatar","origin_server_ts":13,"content":{"url":"mxc://example.org/group-photo"}}));
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/sync"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response.clone()))
        .with_priority(2)
        .mount(&f.server)
        .await;
    f.account.sync_once().await.unwrap();
    let group = f.account.rooms().await.unwrap().remove(0);
    assert!(group.direct_user_id.is_none());
    assert_eq!(
        group.avatar_url.as_deref(),
        Some("mxc://example.org/group-photo")
    );
    response["next_batch"] = json!("dm-avatar");
    response["account_data"]["events"] =
        json!([{"type":"m.direct","content":{"@bob:example.org":["!test:example.org"]}}]);
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/sync"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .with_priority(1)
        .mount(&f.server)
        .await;
    f.account.sync_once().await.unwrap();
    let direct = f.account.rooms().await.unwrap().remove(0);
    assert_eq!(direct.direct_user_id.as_deref(), Some("@bob:example.org"));
    assert_eq!(
        direct.avatar_url.as_deref(),
        Some("mxc://example.org/bob-photo")
    );
}

#[tokio::test]
async fn forwards_drop_reply_links_and_do_not_repeat_mentions() {
    use crate::operations::Operation;
    let f = fixture(false).await;
    unencrypted_state(&f.server).await;
    Mock::given(method("GET")).and(path_regex(r"/_matrix/client/v3/rooms/.*/event/.*$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$original","room_id":"!test:example.org","sender":"@bob:example.org","type":"m.room.message","origin_server_ts":20,"content":{"msgtype":"m.text","body":"Hello @carol:example.org","m.mentions":{"user_ids":["@carol:example.org"]},"m.relates_to":{"m.in_reply_to":{"event_id":"$other"}}}}))).mount(&f.server).await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.room.message/forward-stable$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$forward"})))
        .mount(&f.server)
        .await;
    f.account
        .operation(Operation::Forward {
            room_id: "!test:example.org".into(),
            source_room: "!test:example.org".into(),
            event_id: "$original".into(),
            txn: "forward-stable".into(),
        })
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    let sent = requests
        .iter()
        .find(|r| r.url.path().ends_with("/forward-stable"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(sent["body"], "Hello @carol:example.org");
    assert_eq!(sent["m.mentions"], json!({}));
    assert!(sent.get("m.relates_to").is_none());
}

#[tokio::test]
async fn edits_notify_only_new_mentions_and_reject_other_authors() {
    let f = fixture(false).await;
    unencrypted_state(&f.server).await;
    Mock::given(method("GET")).and(path_regex(r"/_matrix/client/v3/rooms/.*/event/.*$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$original","room_id":"!test:example.org","sender":"@alice:example.org","type":"m.room.message","origin_server_ts":20,"content":{"msgtype":"m.text","body":"@bob:example.org"}}))).mount(&f.server).await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.room.message/.*$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$edit"})))
        .mount(&f.server)
        .await;
    f.account
        .edit(
            "!test:example.org",
            "$original",
            "@bob:example.org @carol:example.org",
        )
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    let sent = requests
        .iter()
        .find(|r| r.url.path().contains("/send/m.room.message/"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(
        sent["m.mentions"]["user_ids"],
        json!(["@carol:example.org"])
    );
    assert_eq!(
        sent["m.new_content"]["m.mentions"]["user_ids"],
        json!(["@bob:example.org", "@carol:example.org"])
    );
    Mock::given(method("GET")).and(path_regex(r"/_matrix/client/v3/rooms/.*/event/.*$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$foreign","sender":"@bob:example.org","type":"m.room.message","origin_server_ts":20,"content":{"msgtype":"m.text","body":"foreign"}}))).with_priority(1).mount(&f.server).await;
    assert!(
        f.account
            .edit("!test:example.org", "$foreign", "bad edit")
            .await
            .is_err()
    );
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

#[tokio::test]
async fn cached_page_includes_known_sender_and_permissions_without_network_requests() {
    let f = fixture(false).await;
    let before = f.server.received_requests().await.unwrap().len();
    let page = f.account.cached_page("!test:example.org").await.unwrap();
    assert_eq!(page.events[0]["sender"], "@alice:example.org");
    assert_eq!(page.profiles[0].user_id, "@alice:example.org");
    assert_eq!(page.profiles[0].name, "Alice");
    assert!(page.can_send);
    let requests = f.server.received_requests().await.unwrap();
    assert!(!requests[before..].iter().any(|request| {
        request.url.path().contains("/rooms/") || request.url.path().contains("/profile/")
    }));
}

#[tokio::test]
async fn state_only_sync_updates_sender_name_and_permissions_without_a_new_message() {
    let f = fixture(false).await;
    let mut response = sync_response(false);
    response["next_batch"] = json!("profile-change");
    response["rooms"]["join"]["!test:example.org"]["timeline"]["events"] = json!([]);
    response["rooms"]["join"]["!test:example.org"]["state"]["events"] = json!([
        {"type":"m.room.member","state_key":"@alice:example.org","sender":"@alice:example.org","event_id":"$renamed","origin_server_ts":20,"content":{"membership":"join","displayname":"Алиса Новая","avatar_url":"mxc://example.org/new"}},
        {"type":"m.room.power_levels","state_key":"","sender":"@alice:example.org","event_id":"$powers","origin_server_ts":21,"content":{"users":{"@alice:example.org":0},"events":{"m.room.message":50}}}
    ]);
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/sync"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .with_priority(1)
        .mount(&f.server)
        .await;
    let update = f.account.sync_once().await.unwrap();
    assert_eq!(update.timelines.len(), 1);
    let page = &update.timelines[0];
    assert!(page.events.is_empty());
    assert_eq!(page.profiles[0].name, "Алиса Новая");
    assert_eq!(
        page.profiles[0].avatar_url.as_deref(),
        Some("mxc://example.org/new")
    );
    assert!(!page.can_send);
    assert_eq!(
        f.account
            .cached_page("!test:example.org")
            .await
            .unwrap()
            .profiles[0]
            .name,
        "Алиса Новая"
    );
}

#[tokio::test]
async fn stripped_invitation_without_messages_is_visible_with_inviter_profile() {
    let f = fixture(false).await;
    let response = json!({"next_batch":"invited", "rooms":{"invite":{"!invite:example.org":{"invite_state":{"events":[
        {"type":"m.room.create","state_key":"","sender":"@bob:example.org","content":{"creator":"@bob:example.org","room_version":"10"}},
        {"type":"m.room.name","state_key":"","sender":"@bob:example.org","content":{"name":"Новая комната"}},
        {"type":"m.room.member","state_key":"@bob:example.org","sender":"@bob:example.org","content":{"membership":"join","displayname":"Борис","avatar_url":"mxc://example.org/bob"}},
        {"type":"m.room.member","state_key":"@alice:example.org","sender":"@bob:example.org","content":{"membership":"invite","displayname":"Alice"}}
    ]}}}}});
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/sync"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .with_priority(1)
        .mount(&f.server)
        .await;
    let update = f.account.sync_once().await.unwrap();
    assert!(update.timelines.is_empty());
    let room = update
        .rooms
        .iter()
        .find(|room| room.id == "!invite:example.org")
        .unwrap();
    assert_eq!(room.membership, "invited");
    assert_eq!(room.unread, 0);
    assert_eq!(room.name, "Новая комната");
    let inviter = room.inviter.as_ref().unwrap();
    assert_eq!(inviter.user_id, "@bob:example.org");
    assert_eq!(inviter.name, "Борис");
    assert_eq!(inviter.avatar_url.as_deref(), Some("mxc://example.org/bob"));
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
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"start":"older","end":"oldest","chunk":[{"type":"m.room.message","event_id":"$old","sender":"@bob:example.org","origin_server_ts":5,"content":{"msgtype":"m.text","body":"earlier"}}],"state":[{"type":"m.room.member","state_key":"@bob:example.org","room_id":"!test:example.org","sender":"@bob:example.org","event_id":"$historical-profile","origin_server_ts":4,"content":{"membership":"leave","displayname":"Борис Исторический"}}]})))
        .mount(&f.server).await;
    let page = f
        .account
        .history("!test:example.org", Some("older".into()))
        .await
        .unwrap();
    assert_eq!(page.next.as_deref(), Some("oldest"));
    assert_eq!(page.events[0]["content"]["body"], "earlier");
    assert_eq!(page.profiles[0].name, "Борис Исторический");
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
    let filter = history
        .url
        .query_pairs()
        .find(|(key, _)| key == "filter")
        .unwrap()
        .1
        .into_owned();
    let filter: Value = serde_json::from_str(&filter).unwrap();
    assert_eq!(filter["lazy_load_members"], true);
    assert_eq!(filter["include_redundant_members"], true);
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
async fn profile_read_and_update_use_matrix_profile_endpoints() {
    use crate::operations::Operation;
    let f = fixture(false).await;
    Mock::given(method("GET"))
        .and(path_regex(r"/_matrix/client/v3/profile/.*$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"displayname":"Alice Smith","avatar_url":"mxc://example.org/avatar"}),
        ))
        .mount(&f.server)
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(r"/_matrix/client/v3/profile/.*/displayname$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .expect(1)
        .mount(&f.server)
        .await;
    let profile = f
        .account
        .operation(Operation::Profile { user_id: None })
        .await
        .unwrap();
    assert_eq!(profile["displayName"], "Alice Smith");
    assert_eq!(profile["avatarUrl"], "mxc://example.org/avatar");
    f.account
        .operation(Operation::SetProfile {
            name: "Alice New".into(),
        })
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    assert_eq!(
        requests
            .iter()
            .find(|r| r.method == "PUT")
            .unwrap()
            .body_json::<Value>()
            .unwrap()["displayname"],
        "Alice New"
    );
}

#[tokio::test]
async fn attachment_upload_and_download_do_not_expose_access_tokens_to_ui() {
    use crate::operations::Upload;
    use base64::Engine;
    let f = fixture(false).await;
    unencrypted_state(&f.server).await;
    Mock::given(method("GET"))
        .and(path_regex(r"/_matrix/(media/v3|client/v1/media)/config$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"m.upload.size":26214400})))
        .mount(&f.server)
        .await;
    Mock::given(method("POST"))
        .and(path_regex(r"/_matrix/(media/v3|client/v1/media)/upload$"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"content_uri":"mxc://example.org/document"})),
        )
        .mount(&f.server)
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.room.message/file-txn$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$file"})))
        .mount(&f.server)
        .await;
    let bytes = b"REAL FILE CONTENT";
    let result = f
        .account
        .upload(
            Upload {
                room_id: Some("!test:example.org".into()),
                name: "notes.txt".into(),
                mime: "text/plain".into(),
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
                voice: false,
                duration_ms: None,
                txn: "file-txn".into(),
                target: "message".into(),
            },
            |_, _| {},
        )
        .await
        .unwrap();
    assert_eq!(result, "$file");
    let requests = f.server.received_requests().await.unwrap();
    let upload = requests
        .iter()
        .find(|r| {
            r.method == "POST"
                && r.url.path().contains("/media/")
                && r.url.path().ends_with("/upload")
        })
        .unwrap();
    assert_eq!(upload.body, bytes);
    assert_eq!(
        upload.headers.get("authorization").unwrap(),
        "Bearer not-a-real-token"
    );
    let send = requests
        .iter()
        .find(|r| r.url.path().contains("/send/m.room.message/"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(send["url"], "mxc://example.org/document");
    assert_eq!(send["msgtype"], "m.file");
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v1/media/download/example.org/document$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(bytes.to_vec()))
        .mount(&f.server)
        .await;
    let downloaded = f
        .account
        .media_content(json!({"url":"mxc://example.org/document"}))
        .await
        .unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(downloaded.data)
            .unwrap(),
        bytes
    );
}

#[tokio::test]
async fn encrypted_attachment_upload_is_ciphertext_and_sends_encrypted_event() {
    use crate::operations::Upload;
    use base64::Engine;
    let f = fixture(true).await;
    f.account.enable_encryption().await.unwrap();
    Mock::given(method("GET"))
        .and(path_regex(r"/_matrix/(media/v3|client/v1/media)/config$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"m.upload.size":26214400})))
        .mount(&f.server)
        .await;
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
    Mock::given(method("POST"))
        .and(path_regex(r"/_matrix/(media/v3|client/v1/media)/upload$"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"content_uri":"mxc://example.org/encrypted"})),
        )
        .mount(&f.server)
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.room.encrypted/voice-txn$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$voice"})))
        .mount(&f.server)
        .await;
    let bytes = b"PRIVATE AUDIO DATA DO NOT LEAK";
    f.account
        .upload(
            Upload {
                room_id: Some("!test:example.org".into()),
                name: "voice.webm".into(),
                mime: "audio/webm".into(),
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
                voice: true,
                duration_ms: Some(2500),
                txn: "voice-txn".into(),
                target: "message".into(),
            },
            |_, _| {},
        )
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    let upload = requests
        .iter()
        .find(|r| {
            r.method == "POST"
                && r.url.path().contains("/media/")
                && r.url.path().ends_with("/upload")
        })
        .unwrap();
    assert_ne!(upload.body, bytes);
    assert!(!upload.body.windows(bytes.len()).any(|slice| slice == bytes));
    let send = requests
        .iter()
        .find(|r| r.url.path().contains("/send/m.room.encrypted/"))
        .unwrap();
    assert!(send.body_json::<Value>().unwrap()["ciphertext"].is_string());
    assert!(!String::from_utf8_lossy(&send.body).contains("PRIVATE AUDIO"));
    assert!(
        !std::fs::read(f.account.store_path.join("timeline.sqlite3"))
            .unwrap()
            .windows(bytes.len())
            .any(|slice| slice == bytes)
    );
}

#[tokio::test]
async fn locked_encrypted_room_and_invalid_media_are_rejected_before_upload() {
    use crate::operations::Upload;
    use base64::Engine;
    let f = fixture(true).await;
    assert!(
        f.account
            .upload(
                Upload {
                    room_id: Some("!test:example.org".into()),
                    name: "secret.txt".into(),
                    mime: "text/plain".into(),
                    data: base64::engine::general_purpose::STANDARD.encode(b"private"),
                    voice: false,
                    duration_ms: None,
                    txn: "blocked".into(),
                    target: "message".into()
                },
                |_, _| {}
            )
            .await
            .is_err()
    );
    assert!(
        f.account
            .media_content(json!({"url":"https://example.org/anything"}))
            .await
            .is_err()
    );
    assert!(
        !f.server.received_requests().await.unwrap().iter().any(|r| r
            .url
            .path()
            .contains("/media/")
            && r.url.path().ends_with("/upload")
            && r.method == "POST")
    );
}

#[tokio::test]
async fn channels_and_opt_in_encryption_are_created_in_initial_state() {
    use crate::operations::Operation;
    let f = fixture(false).await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/createRoom"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"room_id":"!new:example.org"})),
        )
        .mount(&f.server)
        .await;
    f.account
        .operation(Operation::CreateRoom {
            name: "News".into(),
            topic: "Updates".into(),
            invite: vec![],
            public: false,
            channel: true,
            encrypted: true,
        })
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    let request = requests
        .iter()
        .find(|r| r.url.path().ends_with("/createRoom"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(
        request["power_level_content_override"]["events_default"],
        100
    );
    assert_eq!(
        request["power_level_content_override"]["users"]["@alice:example.org"],
        100
    );
    assert_eq!(request["initial_state"][0]["type"], "m.room.encryption");
    assert!(f.account.encryption_status().await.enabled);
}

#[tokio::test]
async fn call_signals_use_room_send_and_reject_unrelated_event_types() {
    use crate::operations::Operation;
    let f = fixture(false).await;
    unencrypted_state(&f.server).await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/_matrix/client/v3/rooms/.*/send/m.call.invite/.*$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$call"})))
        .expect(1)
        .mount(&f.server)
        .await;
    let signal = json!({"call_id":"call-123","party_id":"TEST","version":"1","lifetime":60000,"offer":{"type":"offer","sdp":"v=0"}});
    f.account
        .operation(Operation::Call {
            room_id: "!test:example.org".into(),
            event_type: "m.call.invite".into(),
            content: signal.clone(),
        })
        .await
        .unwrap();
    assert!(
        f.account
            .operation(Operation::Call {
                room_id: "!test:example.org".into(),
                event_type: "m.room.message".into(),
                content: signal
            })
            .await
            .is_err()
    );
    let requests = f.server.received_requests().await.unwrap();
    let sent = requests
        .iter()
        .find(|r| r.url.path().contains("/send/m.call.invite/"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(sent["offer"]["sdp"], "v=0");
}

#[tokio::test]
async fn encrypted_media_download_decrypts_and_rejects_tampered_bytes() {
    use base64::Engine;
    let f = fixture(false).await;
    Mock::given(method("GET"))
        .and(path_regex(r"/_matrix/(media/v3|client/v1/media)/config$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"m.upload.size":26214400})))
        .mount(&f.server)
        .await;
    Mock::given(method("POST"))
        .and(path_regex(r"/_matrix/(media/v3|client/v1/media)/upload$"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"content_uri":"mxc://example.org/encrypted-download"})),
        )
        .mount(&f.server)
        .await;
    let plaintext = b"ACTUAL ENCRYPTED ATTACHMENT";
    let mut reader = std::io::Cursor::new(plaintext);
    let file = f
        .account
        .client
        .upload_encrypted_file(&mut reader)
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    let upload = requests
        .iter()
        .find(|r| {
            r.method == "POST"
                && r.url.path().contains("/media/")
                && r.url.path().ends_with("/upload")
        })
        .unwrap();
    let ciphertext = upload.body.clone();
    assert_ne!(ciphertext, plaintext);
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v1/media/download/example.org/encrypted-download$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(ciphertext.clone()))
        .mount(&f.server)
        .await;
    let source = json!({"file":file});
    let result = f.account.media_content(source.clone()).await.unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(result.data)
            .unwrap(),
        plaintext
    );
    let mut corrupted = ciphertext;
    corrupted[0] ^= 1;
    Mock::given(method("GET"))
        .and(path_regex(
            r"/_matrix/client/v1/media/download/example.org/encrypted-download$",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(corrupted))
        .with_priority(1)
        .mount(&f.server)
        .await;
    assert!(f.account.media_content(source).await.is_err());
}

#[tokio::test]
async fn device_removal_preserves_interactive_authentication_instead_of_bypassing_it() {
    use crate::operations::Operation;
    let f = fixture(false).await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/delete_devices"))
        .respond_with(ResponseTemplate::new(401).set_body_json(
            json!({"flows":[{"stages":["m.login.password"]}],"params":{},"session":"auth-session"}),
        ))
        .mount(&f.server)
        .await;
    let challenge = f
        .account
        .operation(Operation::RemoveDevice {
            device_id: "OTHER".into(),
            password: None,
            auth_session: None,
        })
        .await
        .unwrap();
    assert_eq!(challenge["requiresPassword"], true);
    assert_eq!(challenge["session"], "auth-session");
    assert!(
        f.account
            .operation(Operation::RemoveDevice {
                device_id: "TEST".into(),
                password: None,
                auth_session: None
            })
            .await
            .is_err()
    );
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/delete_devices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .with_priority(1)
        .mount(&f.server)
        .await;
    f.account
        .operation(Operation::RemoveDevice {
            device_id: "OTHER".into(),
            password: Some("test-device-password".into()),
            auth_session: Some("auth-session".into()),
        })
        .await
        .unwrap();
    let requests = f.server.received_requests().await.unwrap();
    let last = requests
        .iter()
        .rev()
        .find(|r| r.url.path().ends_with("/delete_devices"))
        .unwrap()
        .body_json::<Value>()
        .unwrap();
    assert_eq!(last["auth"]["session"], "auth-session");
    assert_eq!(last["auth"]["type"], "m.login.password");
    assert_eq!(last["devices"], json!(["OTHER"]));
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
