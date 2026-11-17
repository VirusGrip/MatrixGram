param(
    [Parameter(Mandatory=$true)][string]$Binary,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$Publisher='CN=MatrixGramGroupingProbe, OID.2.25.311729368913984317654407730594956997722=1',
    [ValidateSet('MadFrog.MatrixGram.GroupingProbe.Unsigned','MadFrog.MatrixGram.GroupingProbe.Signed')]
    [string]$IdentityName='MadFrog.MatrixGram.GroupingProbe.Unsigned'
)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $Binary).Path
$output=[IO.Path]::GetFullPath($OutputDirectory)
$marker=Join-Path $output '.matrixgram-sparse-grouping-probe'
if ((Test-Path -LiteralPath $output) -and -not (Test-Path -LiteralPath $marker)) { throw 'Choose a new diagnostic folder' }
$external=Join-Path $output 'external'
$content=Join-Path $output 'package'
New-Item -ItemType Directory -Path $external,$content,(Join-Path $external 'Assets') -Force | Out-Null
[IO.File]::WriteAllText($marker,'Isolated MatrixGram package-identity test')
$executable=Join-Path $external 'MatrixGramPackageProbe.exe'
Copy-Item -LiteralPath $source -Destination $executable -Force
$project=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Copy-Item -LiteralPath (Join-Path $project 'apps\client\src-tauri\icons\icon.png') -Destination (Join-Path $external 'Assets\Icon.png') -Force
$publisher=[Security.SecurityElement]::Escape($Publisher)
$fusion=@"
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="0.1.0.0" name="MatrixGramPackageProbe"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <msix xmlns="urn:schemas-microsoft-com:msix.v1" publisher="$publisher" packageName="$IdentityName" applicationId="Probe"/>
</assembly>
"@
$fusionPath=Join-Path $output 'application.manifest'
[IO.File]::WriteAllText($fusionPath,$fusion,(New-Object Text.UTF8Encoding $false))
& mt.exe -nologo -manifest $fusionPath "-outputresource:$executable;#1"
if ($LASTEXITCODE -ne 0) { throw 'Embedding diagnostic package identity failed' }
$manifest=@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="$IdentityName" Publisher="$publisher" Version="0.1.0.0" ProcessorArchitecture="neutral"/>
  <Properties><DisplayName>MatrixGram — тест package identity</DisplayName><PublisherDisplayName>MatrixGram diagnostic</PublisherDisplayName><Logo>Assets\Icon.png</Logo><uap10:AllowExternalContent>true</uap10:AllowExternalContent></Properties>
  <Resources><Resource Language="ru-ru"/></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
  <Applications><Application Id="Probe" Executable="MatrixGramPackageProbe.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App"><uap:VisualElements AppListEntry="none" DisplayName="MatrixGram — тест package identity" Description="Isolated WebView2 grouping diagnostic" BackgroundColor="transparent" Square150x150Logo="Assets\Icon.png" Square44x44Logo="Assets\Icon.png"/></Application></Applications>
  <Capabilities><rescap:Capability Name="runFullTrust"/><rescap:Capability Name="unvirtualizedResources"/></Capabilities>
</Package>
"@
[IO.File]::WriteAllText((Join-Path $content 'AppxManifest.xml'),$manifest,(New-Object Text.UTF8Encoding $false))
$package=Join-Path $output 'MatrixGramGroupingProbe.identity.msix'
& makeappx.exe pack /o /nv /d $content /p $package
if ($LASTEXITCODE -ne 0) { throw 'Sparse diagnostic package build failed' }
Write-Output 'Prepared test package. No registration or certificate trust has been changed.'
Write-Output $package
