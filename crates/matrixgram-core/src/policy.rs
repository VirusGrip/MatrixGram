use crate::models::{CoreError, Result};
use url::Url;

pub fn validate_homeserver(value: &str) -> Result<Url> {
    let parsed = Url::parse(value.trim())
        .map_err(|_| CoreError::User("Укажите HTTPS-адрес сервера".into()))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
    {
        return Err(CoreError::User(
            "Нужен HTTPS-адрес сервера без пути, пароля и параметров".into(),
        ));
    }
    Ok(parsed)
}

pub fn allow_plaintext(encryption: &str) -> Result<()> {
    match encryption {
        "unencrypted" => Ok(()),
        "encrypted" => Err(CoreError::User(
            "Откройте зашифрованные комнаты кнопкой сбоку, чтобы использовать E2EE".into(),
        )),
        _ => Err(CoreError::User(
            "Состояние шифрования не подтверждено. Отправка заблокирована.".into(),
        )),
    }
}

pub fn validate_body(body: &str) -> Result<()> {
    if body.trim().is_empty() || body.len() > 16_000 {
        return Err(CoreError::User(
            "Сообщение должно содержать от 1 до 16000 байт текста".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn homeserver_requires_clean_https_origin() {
        assert!(validate_homeserver("https://matrix.mad-frog.ru").is_ok());
        for value in [
            "http://localhost",
            "https://user:pass@host",
            "https://host/path",
            "https://host?q=token",
            "https://host/#x",
            "file:///tmp",
        ] {
            assert!(validate_homeserver(value).is_err(), "{value}");
        }
    }

    #[test]
    fn fail_closed_on_encryption() {
        assert!(allow_plaintext("unencrypted").is_ok());
        for state in ["encrypted", "unknown", "", "false"] {
            assert!(allow_plaintext(state).is_err());
        }
    }

    #[test]
    fn body_limit_counts_utf8_bytes() {
        assert!(validate_body("   ").is_err());
        assert!(validate_body(&"я".repeat(8001)).is_err());
        assert!(validate_body("Привет 👋").is_ok());
    }
}
