param([Parameter(Mandatory=$true)][string]$InstallDirectory)
. (Join-Path $PSScriptRoot 'IdentityCommon.ps1')
if ([Environment]::OSVersion.Version.Build -lt 19041) { exit 0 }
$definition=Get-MatrixGramIdentityDefinition
$registered=Get-MatrixGramRegisteredIdentity $definition
if ($registered -and [String]::Equals((Get-MatrixGramExternalPath $registered.PackageFullName),[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {
    Remove-AppxPackage -Package $registered.PackageFullName -ErrorAction Stop
}
