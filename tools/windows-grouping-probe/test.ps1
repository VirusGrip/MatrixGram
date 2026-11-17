param([Parameter(Mandatory=$true)][string]$Binary)
$ErrorActionPreference='Stop'
$binaryPath=(Resolve-Path -LiteralPath $Binary).Path
$results=@()
foreach ($mode in @('baseline','process-id','window-id','native-grouping')) {
    $child=Start-Process -FilePath $binaryPath -ArgumentList @("--$mode",'--smoke') -PassThru -WindowStyle Hidden
    if (-not $child.WaitForExit(25000)) {
        Stop-Process -Id $child.Id -Force
        throw "Probe timeout: $mode"
    }
    $child.Refresh()
    if ($child.ExitCode -ne 0) { throw "Probe failed: $mode, exit=$($child.ExitCode). See LOCALAPPDATA/MatrixGramGroupingProbe/error.txt" }
    $reportPath=Join-Path $env:LOCALAPPDATA "MatrixGramGroupingProbe\$mode-$($child.Id)\report.json"
    $report=Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if (-not $report.documentReady -or $report.taskManagerGroupingVerified -ne $false -or $report.pid -ne $child.Id) {
        throw "Invalid smoke result: $mode"
    }
    $identity='ru.madfrog.matrixgram.groupingprobe'
    if ($mode -in @('process-id','window-id')) {
        if ($report.processAppUserModelId -ne $identity) { throw 'Process ID readback failed' }
    } elseif ($null -ne $report.processAppUserModelId) { throw 'Unexpected explicit process ID' }
    if ($mode -eq 'window-id' -and ($report.windowAppUserModelIdBeforeWebview -ne $identity -or $report.windowAppUserModelIdAfterWebview -ne $identity)) {
        throw 'Window ID readback failed'
    }
    if ($mode -eq 'native-grouping' -and $report.diagnosticBrowserArguments -ne '--disable-features=msWindowsTaskManager') {
        throw 'Diagnostic runtime argument missing'
    }
    $results += $report
}
$results | Select-Object mode,pid,documentReady,taskManagerGroupingVerified | Format-Table
Write-Output 'PASS: four native smoke checks. Task Manager grouping still needs a manual check.'
