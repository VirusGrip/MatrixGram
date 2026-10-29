use crate::{Account, models::*};
use matrix_sdk::ruma::{
    RoomId, UserId,
    api::client::{room::create_room, user_directory::search_users},
    uint,
};
use std::{collections::HashSet, sync::atomic::Ordering};

pub fn validate_folders(folders: &mut [ChatFolder]) -> Result<()> {
    if folders.len() > 30 {
        return Err(CoreError::User("Можно создать до 30 папок".into()));
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for folder in folders {
        folder.name = folder.name.trim().to_owned();
        if folder.name.is_empty()
            || folder.name.chars().count() > 24
            || folder.id.len() > 64
            || folder.id.is_empty()
            || !ids.insert(folder.id.clone())
            || !names.insert(folder.name.to_lowercase())
            || folder.room_ids.len() > 5000
        {
            return Err(CoreError::User(
                "Названия папок должны быть уникальными, от 1 до 24 символов".into(),
            ));
        }
        let mut rooms = HashSet::new();
        for room_id in &folder.room_ids {
            RoomId::parse(room_id)
                .map_err(|_| CoreError::User("Некорректный ID комнаты в папке".into()))?;
        }
        folder.room_ids.retain(|id| rooms.insert(id.clone()));
    }
    Ok(())
}

impl Account {
    pub fn draft(&self, room_id: &str) -> Result<String> {
        let _guard = self.draft_lock.lock().expect("draft mutex poisoned");
        if !self.room(room_id)?.encryption_state().is_encrypted() {
            return self.cache.draft(room_id);
        }
        let ids: std::collections::HashMap<String, String> =
            self.cache.setting("private_draft_ids")?;
        let Some(id) = ids.get(room_id) else {
            return Ok(String::new());
        };
        uuid::Uuid::parse_str(id)
            .map_err(|_| CoreError::User("Повреждён путь черновика".into()))?;
        let bytes = crate::vault::load(&self.store_path.join("private-drafts").join(id))?
            .unwrap_or_default();
        String::from_utf8(bytes)
            .map_err(|_| CoreError::User("Не удалось прочитать защищённый черновик".into()))
    }

    pub fn save_draft(&self, room_id: &str, body: &str) -> Result<()> {
        let _guard = self.draft_lock.lock().expect("draft mutex poisoned");
        if body.len() > 16000 {
            return Err(CoreError::User("Черновик превышает 16000 байт".into()));
        }
        if !self.room(room_id)?.encryption_state().is_encrypted() {
            return self.cache.save_draft(room_id, body);
        }
        let mut ids: std::collections::HashMap<String, String> =
            self.cache.setting("private_draft_ids")?;
        let id = ids
            .entry(room_id.to_owned())
            .or_insert_with(|| uuid::Uuid::new_v4().to_string())
            .clone();
        uuid::Uuid::parse_str(&id)
            .map_err(|_| CoreError::User("Повреждён путь черновика".into()))?;
        self.cache.save_setting("private_draft_ids", &ids)?;
        let dir = self.store_path.join("private-drafts");
        std::fs::create_dir_all(&dir)?;
        crate::vault::save(&dir.join(id), body.as_bytes())?;
        // Remove any pre-encryption draft left by 0.1.0 / an encryption state change.
        self.cache.save_draft(room_id, "")?;
        Ok(())
    }

    pub fn folders(&self) -> Result<Vec<ChatFolder>> {
        self.cache.setting("folders")
    }

    pub fn save_folders(&self, mut folders: Vec<ChatFolder>) -> Result<Vec<ChatFolder>> {
        validate_folders(&mut folders)?;
        self.cache.save_setting("folders", &folders)?;
        Ok(folders)
    }

    pub async fn encryption_status(&self) -> EncryptionStatus {
        EncryptionStatus {
            enabled: self.e2ee_enabled.load(Ordering::Acquire),
            backup_ready: self.client.encryption().backups().are_enabled().await,
        }
    }

    pub async fn enable_encryption(&self) -> Result<EncryptionStatus> {
        self.cache.save_setting("e2ee_enabled", &true)?;
        self.e2ee_enabled.store(true, Ordering::Release);
        Ok(self.encryption_status().await)
    }

    pub async fn recover_encryption(&self, key: String) -> Result<EncryptionStatus> {
        let key = zeroize::Zeroizing::new(key);
        if key.trim().is_empty() || key.len() > 4096 {
            return Err(CoreError::User(
                "Введите ключ восстановления или пароль хранилища Matrix".into(),
            ));
        }
        self.client.encryption().recovery().recover(key.trim()).await
            .map_err(|_| CoreError::User("Не удалось подключить ключ. Проверьте ключ, доступ к сети и наличие резервной копии ключей на сервере.".into()))?;
        self.enable_encryption().await
    }

    pub async fn import_encryption_keys(
        &self,
        export: String,
        passphrase: String,
    ) -> Result<usize> {
        // Only an encrypted Matrix/Element key export is accepted. No plaintext key file is persisted.
        if export.len() > 10 * 1024 * 1024
            || !export.starts_with("-----BEGIN MEGOLM SESSION DATA-----")
        {
            return Err(CoreError::User(
                "Выберите зашифрованный файл ключей Matrix/Element до 10 МБ".into(),
            ));
        }
        let passphrase = zeroize::Zeroizing::new(passphrase);
        let path = self
            .store_path
            .join(format!("key-import-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, export.as_bytes())?;
        let result = self
            .client
            .encryption()
            .import_room_keys(path.clone(), &passphrase)
            .await;
        let _ = std::fs::remove_file(&path);
        let imported = result
            .map_err(|_| CoreError::User("Файл ключей повреждён или пароль не подходит".into()))?;
        self.enable_encryption().await?;
        Ok(imported.imported_count)
    }

    pub async fn search_users(&self, term: &str) -> Result<UserSearchResult> {
        let term = term.trim();
        if term.chars().count() < 2 {
            return Ok(UserSearchResult {
                users: vec![],
                limited: false,
            });
        }
        if term.chars().count() > 128 {
            return Err(CoreError::User("Введите до 128 символов для поиска".into()));
        }
        let mut request = search_users::v3::Request::new(term.into());
        request.limit = uint!(30);
        let response = self.client.send(request).await.map_err(network_error)?;
        let users = response
            .results
            .into_iter()
            .filter(|user| Some(user.user_id.as_ref()) != self.client.user_id())
            .map(|user| DirectoryUser {
                display_name: user
                    .display_name
                    .filter(|v| !v.trim().is_empty())
                    .unwrap_or_else(|| user.user_id.to_string()),
                user_id: user.user_id.to_string(),
            })
            .collect();
        Ok(UserSearchResult {
            users,
            limited: response.limited,
        })
    }

    pub async fn open_direct(&self, user_id: &str) -> Result<String> {
        let _guard = self.direct_lock.lock().await;
        let user =
            UserId::parse(user_id).map_err(|_| CoreError::User("Некорректный Matrix ID".into()))?;
        if let Some(room) = self.client.get_dm_room(&user) {
            return Ok(room.room_id().to_string());
        }
        let cached: std::collections::HashMap<String, String> =
            self.cache.setting("direct_rooms")?;
        if let Some(room) = cached.get(user_id).and_then(|id| self.room(id).ok())
            && matches!(
                room.state(),
                matrix_sdk::RoomState::Joined | matrix_sdk::RoomState::Invited
            )
        {
            return Ok(room.room_id().to_string());
        }
        let mut request = create_room::v3::Request::new();
        request.is_direct = true;
        request.invite = vec![user.clone()];
        request.preset = Some(create_room::v3::RoomPreset::PrivateChat);
        // Explicitly keep the default unencrypted; never use SDK create_dm's encrypted preset.
        let room = self
            .client
            .create_room(request)
            .await
            .map_err(network_error)?;
        let mut cached = cached;
        cached.insert(user_id.to_owned(), room.room_id().to_string());
        self.cache.save_setting("direct_rooms", &cached)?;
        let _ = self
            .client
            .account()
            .mark_as_dm(room.room_id(), &[user])
            .await;
        Ok(room.room_id().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folders_are_validated_deduplicated_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.sqlite3");
        let mut folders = vec![ChatFolder {
            id: "work".into(),
            name: "  Работа  ".into(),
            room_ids: vec!["!r:host".into(), "!r:host".into()],
            unread_only: true,
        }];
        validate_folders(&mut folders).unwrap();
        assert_eq!(folders[0].name, "Работа");
        assert_eq!(folders[0].room_ids.len(), 1);
        {
            crate::cache::Cache::open(&path)
                .unwrap()
                .save_setting("folders", &folders)
                .unwrap();
        }
        let restored: Vec<ChatFolder> = crate::cache::Cache::open(&path)
            .unwrap()
            .setting("folders")
            .unwrap();
        assert_eq!(restored[0].name, "Работа");
        assert!(restored[0].unread_only);
        folders.push(ChatFolder {
            id: "other".into(),
            name: "работа".into(),
            room_ids: vec![],
            unread_only: false,
        });
        assert!(validate_folders(&mut folders).is_err());
    }
}
