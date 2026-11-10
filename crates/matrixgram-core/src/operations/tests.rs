use super::*;

#[test]
fn room_links_preserve_routing_and_reject_other_urls_and_user_links() {
    let (id, via) =
        room_address("https://matrix.to/#/%23news%3Aexample.org?via=example.org").unwrap();
    assert_eq!(id.as_str(), "#news:example.org");
    assert_eq!(via[0].as_str(), "example.org");
    assert_eq!(
        room_address(" !room:example.org ").unwrap().0.as_str(),
        "!room:example.org"
    );
    assert_eq!(
        room_address("matrix:r/news:example.org")
            .unwrap()
            .0
            .as_str(),
        "#news:example.org"
    );
    for bad in [
        "https://example.org/#/!room:example.org",
        "https://matrix.to/#/@user:example.org",
        "file:///etc/passwd",
        "",
    ] {
        assert!(room_address(bad).is_err(), "{bad}");
    }
}
