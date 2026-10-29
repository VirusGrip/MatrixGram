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

// Android Keystore bridge is pending. Never fall back to plaintext tokens.
#[cfg(not(windows))]
pub fn save(_path: &Path, _plaintext: &[u8]) -> Result<bool> {
    Ok(false)
}

#[cfg(not(windows))]
pub fn load(_path: &Path) -> Result<Option<Vec<u8>>> {
    Ok(None)
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
