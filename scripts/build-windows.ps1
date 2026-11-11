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
Push-Location -LiteralPath $project
try {
    [IO.File]::WriteAllText($manifest, $desktopText, (New-Object Text.UTF8Encoding $false))
    & npm.cmd run tauri -- build --bundles nsis --ci
    $buildExit = $LASTEXITCODE
} finally {
    [IO.File]::WriteAllBytes($manifest, $originalBytes)
    Pop-Location
}
exit $buildExit
