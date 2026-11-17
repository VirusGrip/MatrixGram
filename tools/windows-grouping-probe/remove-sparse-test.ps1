param([Parameter(Mandatory=$true)][string]$BundleFolder)
$ErrorActionPreference='Stop'
$bundle=(Resolve-Path -LiteralPath $BundleFolder).Path
if (-not (Test-Path -LiteralPath (Join-Path $bundle '.matrixgram-sparse-grouping-probe'))) { throw 'Diagnostic marker missing' }
$facts=Get-Content -LiteralPath (Join-Path $bundle 'test-package.json') -Raw | ConvertFrom-Json
if ($facts.PackageName -ne 'MadFrog.MatrixGram.GroupingProbe.Signed' -or $facts.Subject -ne 'CN=MatrixGramGroupingProbe.Test' -or $facts.Thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Unexpected diagnostic identity' }
if (Get-Process -Name MatrixGramPackageProbe -ErrorAction SilentlyContinue) { throw 'Close the package-identity test window first' }
$statePath=Join-Path $bundle 'installed-by-test.json'
if (Test-Path -LiteralPath $statePath) {
    $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.Thumbprint -ne $facts.Thumbprint -or $state.Publisher -ne $facts.Subject) { throw 'Unexpected install state' }
    $package=Get-AppxPackage -Name $facts.PackageName
    if ($package) {
        if ($package.PackageFullName -ne $state.PackageFullName -or $package.Publisher -ne $facts.Subject) { throw 'Package has changed; refusing removal' }
        Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
    }
    $trusted='Cert:\CurrentUser\TrustedPeople\'+$facts.Thumbprint
    if (Test-Path -LiteralPath $trusted) {
        if ((Get-Item -LiteralPath $trusted).Subject -ne $facts.Subject) { throw 'Unexpected trusted certificate' }
        Remove-Item -LiteralPath $trusted -Force
    }
    Remove-Item -LiteralPath $statePath
}
# The private signing key was generated only for this seven-day diagnostic.
$signer='Cert:\CurrentUser\My\'+$facts.Thumbprint
if (Test-Path -LiteralPath $signer) {
    if ((Get-Item -LiteralPath $signer).Subject -ne $facts.Subject) { throw 'Unexpected test signing certificate' }
    Remove-Item -LiteralPath $signer -DeleteKey -Force
}
Write-Output 'Removed test package, test trust and its private signing key.'
