param([Parameter(Mandatory=$true)][string]$BundleFolder,[switch]$UseMachineTrust)
# Run only after explicit approval to temporarily trust this test publisher.
$ErrorActionPreference='Stop'
$bundle=(Resolve-Path -LiteralPath $BundleFolder).Path
if (-not (Test-Path -LiteralPath (Join-Path $bundle '.matrixgram-sparse-grouping-probe'))) { throw 'Diagnostic marker missing' }
$facts=Get-Content -LiteralPath (Join-Path $bundle 'test-package.json') -Raw | ConvertFrom-Json
$name='MadFrog.MatrixGram.GroupingProbe.Signed'
$subject='CN=MatrixGramGroupingProbe.Test'
if ($facts.PackageName -ne $name -or $facts.Subject -ne $subject -or $facts.Thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Unexpected diagnostic identity' }
$certPath=Join-Path $bundle 'MatrixGramGroupingProbe.Test.cer'
$certificate=[Security.Cryptography.X509Certificates.X509Certificate2]::new($certPath)
if ($certificate.Thumbprint -ne $facts.Thumbprint -or $certificate.Subject -ne $subject -or $certificate.NotAfter -le (Get-Date)) { throw 'Invalid/expired test certificate' }
$packagePath=Join-Path $bundle 'MatrixGramGroupingProbe.identity.msix'
$exePath=Join-Path $bundle 'external\MatrixGramPackageProbe.exe'
if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $facts.PackageSha256 -or (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash -ne $facts.ExecutableSha256) { throw 'Diagnostic package/executable hash mismatch' }
$trustedPath='Cert:\CurrentUser\TrustedPeople\'+$facts.Thumbprint
# The logical CurrentUser store can expose machine certificates as well.
# In machine-lease mode that inherited entry is expected and is verified below.
if ((-not $UseMachineTrust -and (Test-Path -LiteralPath $trustedPath)) -or @(Get-AppxPackage -Name $name).Count) { throw 'Test trust/package already exists; refusing to overwrite existing state' }
if ($UseMachineTrust) {
    $machinePath='Cert:\LocalMachine\TrustedPeople\'+$facts.Thumbprint
    $leasePath=Join-Path $bundle 'machine-trust-state.json'
    if (-not (Test-Path -LiteralPath $machinePath) -or -not (Test-Path -LiteralPath $leasePath)) { throw 'Approved temporary machine trust helper is not ready' }
    $lease=Get-Content -LiteralPath $leasePath -Raw | ConvertFrom-Json
    if ($lease.status -ne 'ready' -or $lease.thumbprint -ne $facts.Thumbprint -or (Get-Item -LiteralPath $machinePath).Subject -ne $subject) { throw 'Unexpected machine trust state' }
}
$imported=$false
try {
    if (-not $UseMachineTrust) {
        Import-Certificate -FilePath $certPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople' | Out-Null
        $imported=$true
    }
    Add-AppxPackage -Path $packagePath -ExternalLocation (Join-Path $bundle 'external') -ErrorAction Stop
    $registered=@(Get-AppxPackage -Name $name)
    if ($registered.Count -ne 1 -or $registered[0].Publisher -ne $subject) { throw 'Package identity registration did not match' }
    [ordered]@{Thumbprint=$facts.Thumbprint;PackageFullName=$registered[0].PackageFullName;Publisher=$subject;MachineTrustLease=[bool]$UseMachineTrust} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'installed-by-test.json') -Encoding utf8
    Write-Output 'Registered isolated test package; remove-sparse-test.ps1 rolls back package and test trust.'
} catch {
    $created=@(Get-AppxPackage -Name $name | Where-Object Publisher -eq $subject)
    foreach ($item in $created) { Remove-AppxPackage -Package $item.PackageFullName -ErrorAction SilentlyContinue }
    if ($imported -and (Test-Path -LiteralPath $trustedPath)) { Remove-Item -LiteralPath $trustedPath -Force }
    if ($UseMachineTrust) { [IO.File]::WriteAllText((Join-Path $bundle 'finish-machine-trust.request'),'installation failed') }
    throw
}
