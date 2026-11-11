# CI supplies these variables through repository secrets. Local Windows builds use DPAPI.
function Set-MatrixGramUpdateSigning {
    if ($env:TAURI_SIGNING_PRIVATE_KEY) { return }
    $directory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MatrixGramReleaseSigning'
    $privateKey = Join-Path $directory 'updater.key'
    $passwordFile = Join-Path $directory 'updater.password.dpapi'
    if (-not (Test-Path -LiteralPath $privateKey) -or -not (Test-Path -LiteralPath $passwordFile)) { throw 'Configure signing with scripts/init-update-signing.ps1 or provide TAURI_SIGNING_PRIVATE_KEY in CI' }
    $secure = (Get-Content -LiteralPath $passwordFile -Raw).Trim() | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($privateKey).Trim()
}
