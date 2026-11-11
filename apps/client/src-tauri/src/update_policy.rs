#[cfg(any(test, target_os = "android"))]
use base64::{Engine, engine::general_purpose::STANDARD};
#[cfg(any(test, target_os = "android"))]
use minisign_verify::{PublicKey, Signature};
#[cfg(any(test, target_os = "android"))]
use semver::Version;
use serde::Deserialize;
use url::Url;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub repository: String,
    pub public_key: String,
}
impl Configuration {
    pub fn embedded() -> Self {
        serde_json::from_str(include_str!("../updates.json"))
            .expect("Invalid embedded updater configuration")
    }
    pub fn configured(&self) -> bool {
        valid_repository(&self.repository) && !self.public_key.trim().is_empty()
    }
    pub fn endpoint(&self) -> String {
        format!(
            "https://github.com/{}/releases/latest/download/latest.json",
            self.repository
        )
    }
}
pub fn valid_repository(value: &str) -> bool {
    let parts: Vec<_> = value.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && *part != "."
                && *part != ".."
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
}
#[cfg(any(test, target_os = "android"))]
pub fn newer(current: &str, candidate: &str) -> Result<bool, String> {
    let current = Version::parse(current.trim_start_matches('v'))
        .map_err(|_| "Некорректная текущая версия")?;
    let candidate = Version::parse(candidate.trim_start_matches('v'))
        .map_err(|_| "Некорректная версия обновления")?;
    Ok(candidate.pre.is_empty() && candidate > current)
}
pub fn validate_asset(repository: &str, version: &str, address: &str) -> Result<Url, String> {
    let url = Url::parse(address).map_err(|_| "Некорректный адрес обновления")?;
    let prefix = format!("/{repository}/releases/download/v{version}/");
    if !valid_repository(repository)
        || url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with(&prefix)
        || url.path()[prefix.len()..].is_empty()
        || url.path()[prefix.len()..].contains('/')
    {
        return Err("Пакет должен принадлежать выбранному релизу MatrixGram".into());
    }
    Ok(url)
}
#[cfg(any(test, target_os = "android"))]
pub fn verify(
    bytes: &[u8],
    signature: &str,
    public_key: &str,
    version: &str,
) -> Result<(), String> {
    let decode = |value: &str| -> Result<String, String> {
        if value.len() > 16384 {
            return Err("Слишком длинная подпись".into());
        }
        String::from_utf8(
            STANDARD
                .decode(value.trim())
                .map_err(|_| "Повреждена подпись")?,
        )
        .map_err(|_| "Повреждена подпись".into())
    };
    let key =
        PublicKey::decode(&decode(public_key)?).map_err(|_| "Некорректный ключ обновлений")?;
    let signature =
        Signature::decode(&decode(signature)?).map_err(|_| "Некорректная подпись обновления")?;
    key.verify(bytes, &signature, true)
        .map_err(|_| "Подпись обновления не прошла проверку")?;
    let signed = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"));
    if signed != Some(version) {
        return Err("Версия пакета не совпадает с подписанной версией".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_packages_reject_tampering_and_version_substitution() {
        let bytes = include_bytes!("../tests/fixtures/update-test.payload.txt");
        let key = include_str!("../tests/fixtures/update-test.pub.txt").trim();
        let signature = include_str!("../tests/fixtures/update-test.sig.txt").trim();
        verify(bytes, signature, key, "0.5.3").unwrap();
        assert!(verify(b"modified payload", signature, key, "0.5.3").is_err());
        assert!(verify(bytes, signature, key, "0.5.4").is_err());
        assert!(verify(bytes, "broken", key, "0.5.3").is_err());
    }
    #[test]
    fn only_new_stable_versions_are_offered() {
        assert!(newer("0.5.2", "0.5.3").unwrap());
        for version in ["0.5.2", "0.4.0", "1.0.0-beta.1"] {
            assert!(!newer("0.5.2", version).unwrap())
        }
        assert!(newer("0.5.2", "broken").is_err());
    }
    #[test]
    fn assets_cannot_escape_repository_or_release() {
        assert!(
            validate_asset(
                "VirusGrip/MatrixGram",
                "0.5.2",
                "https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/app.apk"
            )
            .is_ok()
        );
        for address in [
            "http://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/app.apk",
            "https://github.com/other/repo/releases/download/v0.5.2/app.apk",
            "https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.1/app.apk",
            "https://evil.test/app.apk",
            "https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.2/app.apk?redirect=x",
        ] {
            assert!(validate_asset("VirusGrip/MatrixGram", "0.5.2", address).is_err())
        }
    }
}
