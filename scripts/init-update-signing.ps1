param([string]$Repository = 'VirusGrip/MatrixGram', [string]$SecretDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MatrixGramReleaseSigning'))
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'This local setup stores the password with Windows DPAPI' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Force -Path $SecretDirectory | Out-Null
$privateKey = Join-Path $SecretDirectory 'updater.key'
$passwordFile = Join-Path $SecretDirectory 'updater.password.dpapi'
if (-not (Test-Path -LiteralPath $privateKey)) {
    if (Test-Path -LiteralPath $passwordFile) { throw 'Existing signing metadata found; restore its original private key' }
    $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    ConvertTo-SecureString -String $password -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile
    Push-Location -LiteralPath $project
    try {
        & npm.cmd run tauri -- signer generate --ci --write-keys $privateKey --password $password *> (Join-Path $SecretDirectory 'generation.private.log')
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed; inspect the private generation log locally' }
    } finally { $password = $null; Pop-Location }
}
if (-not (Test-Path -LiteralPath $passwordFile)) { throw 'Restore the DPAPI password file; existing keys are never overwritten' }
& node (Join-Path $PSScriptRoot 'configure-updates.mjs') --repository $Repository --public-key-file "$privateKey.pub"
if ($LASTEXITCODE -ne 0) { throw 'Cannot configure update public key' }
Write-Output 'Update public key configured. Keep the private key and DPAPI password file backed up outside Git.'
