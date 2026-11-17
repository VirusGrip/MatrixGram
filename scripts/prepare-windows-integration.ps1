$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$windows=Join-Path $project 'apps\client\src-tauri\windows'
$assets=Join-Path $windows 'identity'
$definition=Get-Content -LiteralPath (Join-Path $assets 'identity.json') -Raw | ConvertFrom-Json
if ($definition.schema -ne 1 -or $definition.packageName -ne 'MadFrog.MatrixGram' -or $definition.publisher -ne 'CN=MatrixGram' -or $definition.identityVersion -ne '1.0.0.0' -or $definition.privateKeyRetained -ne $false) { throw 'Invalid immutable identity definition' }
$package=Join-Path $assets 'MatrixGram.identity.msix'
$certificate=Join-Path $assets 'publisher.cer'
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $definition.packageSha256 -or (Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash -ne $definition.certificateSha256) { throw 'Identity asset hash mismatch' }
$cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate)
if ($cert.HasPrivateKey -or $cert.Thumbprint -ne $definition.certificateThumbprint -or $cert.Subject -ne $definition.publisher) { throw 'Identity publisher mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not ('Security.Cryptography.Pkcs.SignedCms' -as [type])) {
    try { Add-Type -AssemblyName System.Security.Cryptography.Pkcs } catch { Add-Type -AssemblyName System.Security }
}
$zip=[IO.Compression.ZipFile]::OpenRead($package)
try {
    $entry=$zip.GetEntry('AppxSignature.p7x')
    if (-not $entry) { throw 'Identity package is unsigned' }
    $stream=$entry.Open()
    $memory=[IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); $bytes=$memory.ToArray() } finally { $stream.Dispose();$memory.Dispose() }
    if ([Text.Encoding]::ASCII.GetString($bytes,0,4) -ne 'PKCX') { throw 'Invalid MSIX signature header' }
    $cms=[Security.Cryptography.Pkcs.SignedCms]::new()
    $cms.Decode($bytes[4..($bytes.Length-1)])
    # Cryptographic signature + pinned public signer. Does NOT install trust.
    $cms.CheckSignature($true)
    if ($cms.SignerInfos.Count -ne 1 -or $cms.SignerInfos[0].Certificate.Thumbprint -ne $cert.Thumbprint) { throw 'Unexpected identity signer' }
    if ($definition.timestamped -and @($cms.SignerInfos[0].UnsignedAttributes | Where-Object { $_.Oid.Value -in @('1.3.6.1.4.1.311.3.3.1','1.2.840.113549.1.9.16.2.14','1.2.840.113549.1.9.6') }).Count -eq 0) { throw 'Identity timestamp missing' }
    $manifestStream=$zip.GetEntry('AppxManifest.xml').Open()
    $reader=[IO.StreamReader]::new($manifestStream)
    try { $manifest=[xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($manifest.Package.Identity.Name -ne $definition.packageName -or $manifest.Package.Identity.Publisher -ne $definition.publisher -or $manifest.Package.Identity.Version -ne $definition.identityVersion -or $manifest.Package.Applications.Application.Id -ne $definition.applicationId) { throw 'Signed identity manifest mismatch' }
} finally { $zip.Dispose();$cert.Dispose() }
$generated=Join-Path $windows 'generated'
New-Item -ItemType Directory -Path $generated -Force | Out-Null
$binary=Join-Path $generated 'IdentityTrust.exe'
$source=Join-Path $windows 'IdentityTrust.cs'
$manifestFile=Join-Path $windows 'setup.manifest'
$inputs=@($source,$manifestFile,$certificate)
$stale=-not (Test-Path -LiteralPath $binary)
if (-not $stale) {
    $built=(Get-Item -LiteralPath $binary).LastWriteTimeUtc
    $stale=@($inputs | Where-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $built }).Count -gt 0
}
if ($stale) {
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    & $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 "/win32manifest:$manifestFile" "/resource:$certificate,MatrixGram.Publisher" "/out:$binary" $source
    if ($LASTEXITCODE -ne 0) { throw 'Windows identity helper compilation failed' }
}
Write-Output 'Verified immutable MSIX, public signer and timestamp; Windows helper ready. No certificate trust changed.'
