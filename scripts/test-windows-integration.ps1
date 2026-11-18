param([string]$MakeNsis)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $PSScriptRoot 'prepare-windows-integration.ps1')
$windows=Join-Path $project 'apps\client\src-tauri\windows'
$assets=Join-Path $windows 'identity'
$definition=Get-Content -LiteralPath (Join-Path $assets 'identity.json') -Raw | ConvertFrom-Json
$helper=Join-Path $windows 'generated\IdentityTrust.exe'
$assembly=[Reflection.Assembly]::LoadFile($helper)
$resource=$assembly.GetManifestResourceStream('MatrixGram.Publisher')
$bytes=[IO.MemoryStream]::new()
try { $resource.CopyTo($bytes); $embedded=[Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes.ToArray()) } finally { $resource.Dispose();$bytes.Dispose() }
if ($embedded.Thumbprint -ne $definition.certificateThumbprint -or $embedded.HasPrivateKey) { throw 'Wrong certificate embedded in setup helper' }
$embedded.Dispose()
$manifest=[xml](Get-Content -LiteralPath (Join-Path $windows 'client.manifest') -Raw)
$binding=@($manifest.assembly.ChildNodes | Where-Object LocalName -eq 'msix')
if ($binding.Count -ne 1 -or $binding[0].publisher -ne $definition.publisher -or $binding[0].packageName -ne $definition.packageName -or $binding[0].applicationId -ne $definition.applicationId) { throw 'Executable/package identity mismatch' }
if (-not $MakeNsis) {
    $candidates=@((Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe'))
    if (${env:ProgramFiles(x86)}) { $candidates+=Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe' }
    if ($env:ProgramFiles) { $candidates+=Join-Path $env:ProgramFiles 'NSIS\makensis.exe' }
    $MakeNsis=$candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $MakeNsis) { $MakeNsis=(Get-Command makensis.exe -ErrorAction Stop).Source }
}
$work=Join-Path ([IO.Path]::GetTempPath()) ('MatrixGramHooks-'+[guid]::NewGuid().ToString('N'))
$fixture=Join-Path $work 'fixture'
New-Item -ItemType Directory -Path $work,$fixture -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $work 'owned-test-folder'),'MatrixGram hook tests')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MatrixGramDirectoryId {
 [StructLayout(LayoutKind.Sequential)] private struct Info { public uint Attr; public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written; public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 public static string Get(string path) { using(SafeFileHandle handle=CreateFile(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) { Info info; if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info)) throw new System.ComponentModel.Win32Exception(); return info.Volume+":"+info.IndexHigh+":"+info.IndexLow; } }
}
'@
function Copy-FixturePayload {
    New-Item -ItemType Directory -Path (Join-Path $fixture 'identity') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture 'matrixgram.exe'),'not-executed test payload')
    foreach ($file in @('IdentityCommon.ps1','RegisterIdentity.ps1','UnregisterIdentity.ps1')) { Copy-Item -LiteralPath (Join-Path $windows $file) -Destination (Join-Path $fixture "identity\$file") -Force }
    foreach ($file in @('MatrixGram.identity.msix','publisher.cer','identity.json')) { Copy-Item -LiteralPath (Join-Path $assets $file) -Destination (Join-Path $fixture "identity\$file") -Force }
    Copy-Item -LiteralPath $helper -Destination (Join-Path $fixture 'identity\IdentityTrust.exe') -Force
    Copy-Item -LiteralPath (Join-Path $project 'apps\client\src-tauri\icons\icon.png') -Destination (Join-Path $fixture 'identity\logo.png') -Force
}
Copy-FixturePayload
$originalId=[MatrixGramDirectoryId]::Get($fixture)
$installer=Join-Path $work 'hooks-test.exe'
$hook=Join-Path $windows 'hooks.nsh'
$script=Join-Path $PSScriptRoot 'tests\windows-identity-hooks.nsi'
& $MakeNsis /V2 "/DHOOK_FILE=$hook" "/DOUTPUT_FILE=$installer" "/DFIXTURE_ROOT=$fixture" $script
if ($LASTEXITCODE -ne 0) { throw 'NSIS hook harness compilation failed' }
foreach ($mode in @('update','uninstall')) {
    if ($mode -eq 'uninstall') { Copy-FixturePayload }
    $child=Start-Process -FilePath $installer -ArgumentList @('/S',"/MODE=$mode") -PassThru -WindowStyle Hidden
    if (-not $child.WaitForExit(60000)) { Stop-Process -Id $child.Id -Force; throw 'Hook harness timed out' }
    $child.Refresh()
    if ($child.ExitCode -ne 0) { throw "Hook harness failed: $mode" }
    if ($mode -eq 'update') {
        if (-not (Test-Path -LiteralPath $fixture) -or [MatrixGramDirectoryId]::Get($fixture) -ne $originalId) { throw 'Updater replaced the registered directory node' }
        $state=Get-Content -LiteralPath (Join-Path $fixture '.matrixgram-identity.json') -Raw | ConvertFrom-Json
        if ($state.status -notin @('not-configured','configured')) { throw 'Quiet setup did not execute correctly' }
    } elseif (Test-Path -LiteralPath $fixture) { throw 'Uninstall left its own marker/directory behind' }
}
if (Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPeople\'+$definition.certificateThumbprint)) { throw 'Quiet hook test unexpectedly installed certificate trust' }
Write-Output 'PASS: signed identity assets, embedded publisher, executable binding, real NSIS hooks, directory ID preserved on update, own directory removed on uninstall. No UAC or registration requested.'
