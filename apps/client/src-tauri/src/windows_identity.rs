//! Runtime identity is optional: direct developer runs and declined setup keep
//! the unpackaged behavior. Installer registration enables packaged Windows APIs.
pub fn is_packaged() -> windows::core::Result<bool> {
    use windows::Win32::{
        Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER},
        Storage::Packaging::Appx::GetCurrentPackageFullName,
    };
    let mut length = 0;
    match unsafe { GetCurrentPackageFullName(&mut length, None) } {
        ERROR_INSUFFICIENT_BUFFER => Ok(true),
        APPMODEL_ERROR_NO_PACKAGE => Ok(false),
        error => {
            error.ok()?;
            Ok(length > 0)
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_identity_query_handles_unregistered_test_process() {
        assert!(!super::is_packaged().expect("Windows package identity query failed"));
    }
}
