fn main() {
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        for file in [
            "windows/IdentityTrust.cs",
            "windows/setup.manifest",
            "windows/identity/identity.json",
            "windows/identity/MatrixGram.identity.msix",
            "windows/identity/publisher.cer",
            "../../../scripts/prepare-windows-integration.ps1",
        ] {
            println!("cargo:rerun-if-changed={file}");
        }
        let powershell = std::path::PathBuf::from(
            std::env::var_os("WINDIR").expect("Windows directory is missing"),
        )
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").expect("Manifest directory is missing"),
        )
        .join("../../../scripts/prepare-windows-integration.ps1");
        let modules = powershell
            .parent()
            .expect("PowerShell directory missing")
            .join("Modules");
        let mut command = std::process::Command::new(powershell);
        // Cargo can inherit PowerShell 7's PSModulePath. Windows PowerShell 5
        // must resolve its own inbox modules when launched from a build script.
        command.env("PSModulePath", modules);
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        command.arg(script);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command
            .output()
            .expect("Windows integration preparation failed");
        assert!(
            output.status.success(),
            "Windows integration preparation failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        println!("cargo:rerun-if-changed=windows/client.manifest");
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows/client.manifest")),
        );
    }
    tauri_build::try_build(attributes).expect("Failed to build MatrixGram metadata");
}
