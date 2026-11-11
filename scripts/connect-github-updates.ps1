param(
    [string]$Repository = 'VirusGrip/MatrixGram',
    [string]$GitHubCli = 'gh',
    [string]$SecretDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MatrixGramReleaseSigning'),
    [string]$AndroidKeystore = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.android\debug.keystore'),
    [string]$AndroidStorePassword = 'android',
    [string]$AndroidKeyAlias = 'androiddebugkey',
    [string]$AndroidKeyPassword = 'android'
)
$ErrorActionPreference = 'Stop'
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Expected OWNER/REPO' }
& $GitHubCli auth status *> $null
if ($LASTEXITCODE -ne 0) { throw 'Sign in once using gh auth login --web --git-protocol https --scopes workflow; never paste tokens into chat' }
$login = (& $GitHubCli api user --jq .login).Trim()
if ($LASTEXITCODE -ne 0 -or $login -ne 'VirusGrip') { throw 'Use the GitHub account VirusGrip selected for this project' }
foreach ($file in @((Join-Path $SecretDirectory 'updater.key'), (Join-Path $SecretDirectory 'updater.password.dpapi'), $AndroidKeystore)) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing existing signing file: $file" }
}
function Set-ReleaseSecret([string]$Name, [string]$Value) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command $GitHubCli).Source
    foreach ($argument in @('secret','set',$Name,'--repo',$Repository)) { $start.ArgumentList.Add($argument) }
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $failure = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Cannot store GitHub Actions secret $Name. Verify repository permissions. $failure" }
    Write-Output "Configured Actions secret: $Name"
}
$key = [IO.File]::ReadAllText((Join-Path $SecretDirectory 'updater.key')).Trim()
$secure = (Get-Content -LiteralPath (Join-Path $SecretDirectory 'updater.password.dpapi') -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
try {
    Set-ReleaseSecret 'TAURI_SIGNING_PRIVATE_KEY' $key
    Set-ReleaseSecret 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' $password
    Set-ReleaseSecret 'ANDROID_KEYSTORE_BASE64' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($AndroidKeystore)))
    Set-ReleaseSecret 'ANDROID_KEYSTORE_PASSWORD' $AndroidStorePassword
    Set-ReleaseSecret 'ANDROID_KEY_ALIAS' $AndroidKeyAlias
    Set-ReleaseSecret 'ANDROID_KEY_PASSWORD' $AndroidKeyPassword
} finally { $key = $null; $password = $null }
Write-Output 'Release signing configured. Keys were sent only to this repository Actions secrets, not to source files.'
