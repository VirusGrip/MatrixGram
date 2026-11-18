param([Parameter(Mandatory=$true)][string]$InstallDirectory,[switch]$Quiet,[switch]$Retry)
. (Join-Path $PSScriptRoot 'IdentityCommon.ps1')
$install=(Resolve-Path -LiteralPath $InstallDirectory).Path.TrimEnd('\')
$marker=Join-Path $install '.matrixgram-identity.json'
$lease=$null
$helper=$null
$ready=$null
$oldExternal=$null
$oldPackageRemoved=$false
function Save-IdentityStatus([string]$Status,[string]$Reason='') {
    [ordered]@{schema=1;status=$Status;reason=$Reason} | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding utf8
}
try {
    if ([Environment]::OSVersion.Version.Build -lt 19041) { Save-IdentityStatus 'unsupported'; exit 0 }
    if (-not (Test-Path -LiteralPath (Join-Path $install 'matrixgram.exe'))) { throw 'MatrixGram executable is missing' }
    $definition=Get-MatrixGramIdentityDefinition
    $packageFile=Join-Path $PSScriptRoot 'MatrixGram.identity.msix'
    $certificateFile=Join-Path $PSScriptRoot 'publisher.cer'
    if ((Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash -ne $definition.packageSha256 -or (Get-FileHash -LiteralPath $certificateFile -Algorithm SHA256).Hash -ne $definition.certificateSha256) { throw 'Windows identity asset hash mismatch' }
    $certificate=[Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateFile)
    if ($certificate.Thumbprint -ne $definition.certificateThumbprint -or $certificate.Subject -ne $definition.publisher) { throw 'Windows identity certificate mismatch' }
    $registered=Get-MatrixGramRegisteredIdentity $definition
    if ($registered) {
        $oldExternal=Get-MatrixGramExternalPath $registered.PackageFullName
        if ([String]::Equals($oldExternal,$install,[StringComparison]::OrdinalIgnoreCase)) { Save-IdentityStatus 'configured'; exit 0 }
    }
    if (-not $Retry -and (Test-Path -LiteralPath $marker)) {
        try { $previous=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { $previous=$null }
        if ($previous.status -eq 'declined') { exit 0 }
    }
    if ($Quiet) { Save-IdentityStatus 'not-configured' 'quiet-first-install'; exit 0 }
    Add-Type -AssemblyName System.Windows.Forms
    $text="Объединить процессы MatrixGram в диспетчере задач?`n`nДля первой настройки потребуется подтверждение администратора. Сертификат MatrixGram будет временно добавлен для регистрации компонента Windows, затем доверие будет удалено.`n`nОбычные обновления не требуют повторной настройки."
    $choice=[Windows.Forms.MessageBox]::Show($text,'MatrixGram — настройка Windows',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ($choice -ne [Windows.Forms.DialogResult]::Yes) { Save-IdentityStatus 'declined'; exit 0 }
    if ($registered) {
        foreach ($process in @(Get-Process -Name matrixgram -ErrorAction SilentlyContinue)) {
            if ($process.Path -and [String]::Equals((Split-Path -Parent $process.Path),$oldExternal,[StringComparison]::OrdinalIgnoreCase)) { throw 'Завершите MatrixGram из прежней папки перед изменением места установки.' }
        }
    }
    $lease=Join-Path ([IO.Path]::GetTempPath()) ('MatrixGramIdentity-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $lease | Out-Null
    [IO.File]::WriteAllText((Join-Path $lease 'owner.txt'),'MatrixGramIdentitySetup/v1')
    $helper=Start-Process -FilePath (Join-Path $PSScriptRoot 'IdentityTrust.exe') -ArgumentList @(('"'+$lease+'"'),[string]$PID) -Verb RunAs -WindowStyle Hidden -PassThru
    $deadline=(Get-Date).AddSeconds(70)
    $state=Join-Path $lease 'state.json'
    while (-not (Test-Path -LiteralPath $state) -and (Get-Date) -lt $deadline -and -not $helper.HasExited) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $state)) { throw 'Windows setup helper did not become ready' }
    $ready=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    if ($ready.status -ne 'ready' -or $ready.pid -ne $helper.Id) { throw 'Windows setup helper failed' }
    if ($registered) { Remove-AppxPackage -Package $registered.PackageFullName -ErrorAction Stop; $oldPackageRemoved=$true }
    Add-AppxPackage -Path $packageFile -ExternalLocation $install -ErrorAction Stop
    $result=Get-MatrixGramRegisteredIdentity $definition
    if (-not $result -or -not [String]::Equals((Get-MatrixGramExternalPath $result.PackageFullName),$install,[StringComparison]::OrdinalIgnoreCase)) { throw 'Windows package binding verification failed' }
    Save-IdentityStatus 'configured'
} catch {
    if ($oldPackageRemoved -and $oldExternal -and (Test-Path -LiteralPath $oldExternal)) {
        try { Add-AppxPackage -Path (Join-Path $PSScriptRoot 'MatrixGram.identity.msix') -ExternalLocation $oldExternal -ErrorAction Stop } catch { }
    }
    Save-IdentityStatus 'failed' $_.Exception.Message
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($lease) { [IO.File]::WriteAllText((Join-Path $lease 'finish.request'),'setup complete') }
    if ($helper) {
        if (-not $helper.WaitForExit(10000)) { throw 'Windows setup helper did not release temporary certificate trust' }
        if ($ready -and -not $ready.preexisting -and (Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPeople\'+$definition.certificateThumbprint))) { throw 'Temporary MatrixGram certificate trust was not removed' }
    }
}
