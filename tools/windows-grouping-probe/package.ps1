param([Parameter(Mandatory=$true)][string]$Binary, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$binaryPath=(Resolve-Path -LiteralPath $Binary).Path
$outputPath=[IO.Path]::GetFullPath($OutputDirectory)
$marker=Join-Path $outputPath '.matrixgram-grouping-probe'
if ((Test-Path -LiteralPath $outputPath) -and -not (Test-Path -LiteralPath $marker)) {
    throw 'Choose a new folder or an existing MatrixGram grouping-probe folder'
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
[IO.File]::WriteAllText($marker,'MatrixGram isolated grouping diagnostic')
$destination=Join-Path $outputPath 'MatrixGram-ID-test.exe'
Copy-Item -LiteralPath $binaryPath -Destination $destination -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $outputPath 'README.md') -Force
$shell=New-Object -ComObject WScript.Shell
foreach ($mode in @(@('1 - обычный запуск','--baseline'),@('2 - ID процесса','--process-id'),@('3 - ID процесса и окна','--window-id'))) {
    $link=$shell.CreateShortcut((Join-Path $outputPath ($mode[0]+'.lnk')))
    $link.TargetPath=$destination
    $link.Arguments=$mode[1]
    $link.WorkingDirectory=$outputPath
    $link.Save()
}
$diagnostic=Join-Path $outputPath 'MatrixGram-Grouping-Diagnostic.exe'
Copy-Item -LiteralPath $binaryPath -Destination $diagnostic -Force
foreach ($mode in @(@('4 - проверка интеграции WebView2','--native-grouping'),@('5 - контроль без флага','--baseline'))) {
    $link=$shell.CreateShortcut((Join-Path $outputPath ($mode[0]+'.lnk')))
    $link.TargetPath=$diagnostic
    $link.Arguments=$mode[1]
    $link.WorkingDirectory=$outputPath
    $link.Save()
}
Get-FileHash -LiteralPath $destination -Algorithm SHA256 | Format-List
Write-Output $outputPath
