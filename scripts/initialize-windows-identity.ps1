# Maintainer-only, ONE-TIME generation of the immutable identity package.
# No certificate is trusted. The non-exportable signing key is deleted in finally.
param([string]$TimestampUrl='http://timestamp.digicert.com')
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output=Join-Path $project 'apps\client\src-tauri\windows\identity'
if (Test-Path -LiteralPath (Join-Path $output 'identity.json')) { throw 'Identity already initialized. Rotation requires an explicit migration; do not regenerate for releases.' }
$work=Join-Path ([IO.Path]::GetTempPath()) ('matrixgram-identity-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work,$output -Force | Out-Null
$signer=$null
try {
    $signer=New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}') -Subject 'CN=MatrixGram' -FriendlyName 'MatrixGram immutable identity package ONLY' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -Provider 'Microsoft Software Key Storage Provider' -NotBefore (Get-Date).AddDays(-1) -NotAfter (Get-Date).AddYears(10)
    Copy-Item -LiteralPath (Join-Path $project 'apps\client\src-tauri\windows\identity.manifest.xml') -Destination (Join-Path $work 'AppxManifest.xml')
    $package=Join-Path $output 'MatrixGram.identity.msix'
    & makeappx.exe pack /o /nv /d $work /p $package
    if ($LASTEXITCODE -ne 0) { throw 'Identity package creation failed' }
    $arguments=@('sign','/fd','SHA256','/sha1',$signer.Thumbprint,'/s','My')
    if ($TimestampUrl) { $arguments+=@('/tr',$TimestampUrl,'/td','SHA256') }
    & signtool.exe @arguments $package
    if ($LASTEXITCODE -ne 0) { throw 'Identity signing failed' }
    $certificate=Join-Path $output 'publisher.cer'
    Export-Certificate -Cert $signer -FilePath $certificate -Type CERT | Out-Null
    [ordered]@{
        schema=1;packageName='MadFrog.MatrixGram';publisher='CN=MatrixGram';applicationId='MatrixGram';identityVersion='1.0.0.0';
        certificateThumbprint=$signer.Thumbprint;certificateSha256=(Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash;
        packageSha256=(Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash;certificateNotAfter=$signer.NotAfter.ToUniversalTime().ToString('o');
        timestamped=[bool]$TimestampUrl;privateKeyRetained=$false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'identity.json') -Encoding utf8
} finally {
    if ($signer) {
        $path='Cert:\CurrentUser\My\'+$signer.Thumbprint
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -DeleteKey -Force }
    }
    # Only the known temporary manifest is removed; never recursive workspace cleanup.
    $manifest=Join-Path $work 'AppxManifest.xml'
    if (Test-Path -LiteralPath $manifest) { Remove-Item -LiteralPath $manifest }
    if ((Get-ChildItem -LiteralPath $work -Force).Count -eq 0) { Remove-Item -LiteralPath $work }
}
Write-Output 'Created public, immutable identity assets. No trust installed; private signing key destroyed.'
