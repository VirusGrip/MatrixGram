use crate::models::{CoreError, Result};
use std::path::Path;

// Session secrets never enter the WebView. Windows DPAPI binds ciphertext to the OS user.
#[cfg(windows)]
pub fn save(path: &Path, plaintext: &[u8]) -> Result<bool> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| CoreError::User("Windows не смог защитить сессию".into()))?;
        let data = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        let pending = path.with_extension("pending");
        std::fs::write(&pending, data)?;
        std::fs::rename(pending, path)?;
    }
    Ok(true)
}

#[cfg(windows)]
pub fn load(path: &Path) -> Result<Option<Vec<u8>>> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
    };
    if !path.exists() {
        return Ok(None);
    }
    let encrypted = std::fs::read(path)?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| {
            CoreError::User("Не удалось восстановить сессию Windows. Выполните вход заново.".into())
        })?;
        let data = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Ok(Some(data))
    }
}

// Unsupported platforms never fall back to plaintext tokens.
#[cfg(not(any(windows, target_os = "android")))]
pub fn save(_path: &Path, _plaintext: &[u8]) -> Result<bool> {
    Ok(false)
}

#[cfg(not(any(windows, target_os = "android")))]
pub fn load(_path: &Path) -> Result<Option<Vec<u8>>> {
    Ok(None)
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::{
        JNIEnv, JavaVM,
        objects::{GlobalRef, JByteArray, JObject, JValue},
    };
    use std::sync::{Arc, Mutex, OnceLock};
    type Bridge = (Arc<JavaVM>, GlobalRef);
    static BRIDGE: OnceLock<Mutex<Bridge>> = OnceLock::new();
    pub fn initialize(env: JNIEnv, activity: JObject) -> Result<()> {
        let vm = Arc::new(
            env.get_java_vm()
                .map_err(|_| CoreError::User("Android VM недоступна".into()))?,
        );
        let activity = env
            .new_global_ref(activity)
            .map_err(|_| CoreError::User("Android Activity недоступна".into()))?;
        if let Some(bridge) = BRIDGE.get() {
            *bridge
                .lock()
                .map_err(|_| CoreError::User("Хранилище занято".into()))? = (vm, activity);
        } else {
            let _ = BRIDGE.set(Mutex::new((vm, activity)));
        }
        Ok(())
    }
    fn bridge() -> Result<Bridge> {
        let guard = BRIDGE
            .get()
            .ok_or_else(|| CoreError::User("Android Keystore ещё запускается".into()))?
            .lock()
            .map_err(|_| CoreError::User("Хранилище занято".into()))?;
        Ok((guard.0.clone(), guard.1.clone()))
    }
    pub fn protect(data: &[u8], encrypt: bool) -> Result<Vec<u8>> {
        let (vm, activity) = bridge()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| CoreError::User("Keystore недоступен".into()))?;
        let input = env
            .byte_array_from_slice(data)
            .map_err(|_| CoreError::User("Не удалось передать данные Keystore".into()))?;
        let result = env.call_method(
            activity.as_obj(),
            "protectVault",
            "([BZ)[B",
            &[JValue::Object(input.as_ref()), JValue::Bool(encrypt.into())],
        );
        match result
            .and_then(|value| value.l())
            .and_then(|value| env.convert_byte_array(JByteArray::from(value)))
        {
            Ok(bytes) => Ok(bytes),
            Err(_) => {
                let _ = env.exception_clear();
                Err(CoreError::User("Android Keystore не смог открыть хранилище. Не удаляйте данные приложения; проверьте блокировку устройства.".into()))
            }
        }
    }
    pub fn permissions(video: bool) -> Result<bool> {
        let (vm, activity) = bridge()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| CoreError::User("Android недоступен".into()))?;
        let result = env.call_method(
            activity.as_obj(),
            "requestMediaPermissions",
            "(Z)Z",
            &[JValue::Bool(video.into())],
        );
        match result.and_then(|v| v.z()) {
            Ok(value) => Ok(value),
            Err(_) => {
                let _ = env.exception_clear();
                Err(CoreError::User(
                    "Не удалось запросить разрешения Android".into(),
                ))
            }
        }
    }
    pub fn notifications() -> Result<bool> {
        let (vm, activity) = bridge()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| CoreError::User("Android недоступен".into()))?;
        let result = env.call_method(activity.as_obj(), "requestNotifications", "()Z", &[]);
        match result.and_then(|v| v.z()) {
            Ok(value) => Ok(value),
            Err(_) => {
                let _ = env.exception_clear();
                Err(CoreError::User(
                    "Не удалось запросить уведомления Android".into(),
                ))
            }
        }
    }
    pub fn update_bridge(method: &str) -> Result<String> {
        let (vm, activity) = bridge()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| CoreError::User("Android недоступен".into()))?;
        let result = env.call_method(activity.as_obj(), method, "()Ljava/lang/String;", &[]);
        match result.and_then(|value| value.l()) {
            Ok(value) => {
                let value: jni::objects::JString = value.into();
                env.get_string(&value)
                    .map(|value| value.into())
                    .map_err(|_| CoreError::User("Не удалось получить ответ Android".into()))
            }
            Err(_) => {
                let _ = env.exception_clear();
                Err(CoreError::User("Android не смог подготовить обновление. Проверьте подпись APK и разрешение установки.".into()))
            }
        }
    }
    pub fn save_file(name: &str, bytes: &[u8]) -> Result<bool> {
        let (vm, activity) = bridge()?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| CoreError::User("Android недоступен".into()))?;
        let name = env
            .new_string(name)
            .map_err(|_| CoreError::User("Не удалось передать имя файла".into()))?;
        let bytes = env
            .byte_array_from_slice(bytes)
            .map_err(|_| CoreError::User("Не удалось передать файл".into()))?;
        let result = env.call_method(
            activity.as_obj(),
            "saveDownload",
            "(Ljava/lang/String;[B)Z",
            &[
                JValue::Object(name.as_ref()),
                JValue::Object(bytes.as_ref()),
            ],
        );
        match result.and_then(|v| v.z()) {
            Ok(value) => Ok(value),
            Err(_) => {
                let _ = env.exception_clear();
                Err(CoreError::User("Не удалось сохранить файл Android".into()))
            }
        }
    }
}
#[cfg(target_os = "android")]
pub use android::{
    initialize as initialize_android_vault, notifications as android_notification_permissions,
    permissions as android_media_permissions, save_file as android_save_file,
};
#[cfg(target_os = "android")]
pub fn save(path: &Path, plaintext: &[u8]) -> Result<bool> {
    let encrypted = android::protect(plaintext, true)?;
    let pending = path.with_extension("pending");
    std::fs::write(&pending, encrypted)?;
    std::fs::rename(pending, path)?;
    Ok(true)
}
#[cfg(target_os = "android")]
pub fn load(path: &Path) -> Result<Option<Vec<u8>>> {
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(android::protect(&std::fs::read(path)?, false)?))
}

pub fn clear(path: &Path) -> Result<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn dpapi_roundtrip_has_no_plaintext_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.dpapi");
        let secret = b"test-secret-access-token";
        assert!(save(&path, secret).unwrap());
        assert!(
            !std::fs::read(&path)
                .unwrap()
                .windows(secret.len())
                .any(|v| v == secret)
        );
        assert_eq!(load(&path).unwrap().unwrap(), secret);
        clear(&path).unwrap();
        assert!(load(&path).unwrap().is_none());
    }
}

#[cfg(target_os = "android")]
pub fn android_update_path() -> Result<String> {
    android::update_bridge("getUpdatePath")
}
#[cfg(target_os = "android")]
pub fn android_install_update() -> Result<String> {
    android::update_bridge("installUpdate")
}
