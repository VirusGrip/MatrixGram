use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub active: Option<String>,
    pub entries: Vec<Entry>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub user_id: String,
    pub homeserver: String,
}

pub fn restore_id(catalog: &Catalog, has_catalog: bool) -> Option<&str> {
    catalog
        .active
        .as_deref()
        .or((!has_catalog).then_some("legacy"))
}
pub fn read(root: &Path) -> Result<Catalog, String> {
    match std::fs::read(root.join("profiles.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Не удалось прочитать список аккаунтов".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Catalog::default()),
        Err(_) => Err("Не удалось прочитать список аккаунтов".into()),
    }
}
pub fn write(root: &Path, catalog: &Catalog) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|_| "Нет доступа к папке аккаунтов")?;
    let temporary = root.join("profiles.json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(catalog).map_err(|_| "Не удалось сохранить список аккаунтов")?,
    )
    .map_err(|_| "Не удалось сохранить список аккаунтов")?;
    std::fs::rename(temporary, root.join("profiles.json"))
        .map_err(|_| "Не удалось обновить список аккаунтов".into())
}
pub fn directory(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id == "legacy" {
        return Ok(root.to_owned());
    }
    // IDs are filenames, never caller-provided paths. Legacy sessions remain in place.
    if uuid::Uuid::parse_str(id)
        .map(|value| value.hyphenated().to_string() != id)
        .unwrap_or(true)
    {
        return Err("Некорректный аккаунт".into());
    }
    Ok(root.join("profiles").join(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logging_out_does_not_silently_restore_another_saved_account() {
        let mut catalog = Catalog::default();
        assert_eq!(restore_id(&catalog, false), Some("legacy"));
        assert_eq!(restore_id(&catalog, true), None);
        catalog.active = Some("selected-profile".into());
        assert_eq!(restore_id(&catalog, true), Some("selected-profile"));
        catalog.active = None;
        assert_eq!(restore_id(&catalog, true), None);
    }
    #[test]
    fn profiles_cannot_escape_root_and_legacy_does_not_move() {
        let root = Path::new("matrixgram-test-root");
        assert_eq!(directory(root, "legacy").unwrap(), root);
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            directory(root, &id).unwrap(),
            root.join("profiles").join(id)
        );
        for invalid in [
            "../legacy",
            "..\\legacy",
            "C:\\Windows",
            "------------------------------------",
            "00000000-0000-0000-0000-00000000000Z",
            "",
        ] {
            assert!(directory(root, invalid).is_err());
        }
    }
}
