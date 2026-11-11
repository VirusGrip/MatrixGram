param([switch]$Unsigned)
# Desktop needs only the Rust rlib. Avoid producing unused mobile static/CDylib outputs.
# The original cross-platform manifest is restored byte for byte, including on failure.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Use this script on Windows' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $project 'apps\client\src-tauri\Cargo.toml'
$originalBytes = [IO.File]::ReadAllBytes($manifest)
$originalText = [Text.Encoding]::UTF8.GetString($originalBytes)
$pattern = 'crate-type\s*=\s*\["staticlib",\s*"cdylib",\s*"rlib"\]'
if ($originalText -notmatch $pattern) { throw 'Unexpected library output configuration' }
$desktopText = [regex]::Replace($originalText, $pattern, 'crate-type = ["rlib"]')
$buildExit = 1
$oldKey = $env:TAURI_SIGNING_PRIVATE_KEY
$oldPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$overlay = $null
if (-not $Unsigned) {
    . (Join-Path $PSScriptRoot 'update-signing-env.ps1')
    Set-MatrixGramUpdateSigning
} else {
    $overlay = Join-Path ([IO.Path]::GetTempPath()) ("matrixgram-unsigned-" + [guid]::NewGuid().ToString('N') + '.json')
    [IO.File]::WriteAllText($overlay, '{"bundle":{"createUpdaterArtifacts":false}}', (New-Object Text.UTF8Encoding $false))
}
Push-Location -LiteralPath $project
try {
    [IO.File]::WriteAllText($manifest, $desktopText, (New-Object Text.UTF8Encoding $false))
    if ($overlay) { & npm.cmd run tauri -- build --bundles nsis --ci --config $overlay } else { & npm.cmd run tauri -- build --bundles nsis --ci }
    $buildExit = $LASTEXITCODE
} finally {
    [IO.File]::WriteAllBytes($manifest, $originalBytes)
    $env:TAURI_SIGNING_PRIVATE_KEY = $oldKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $oldPassword
    if ($overlay -and (Test-Path -LiteralPath $overlay)) { Remove-Item -LiteralPath $overlay }
    Pop-Location
}
exit $buildExit
