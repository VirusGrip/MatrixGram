param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$outputPath=[IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $outputPath '.matrixgram-grouping-probe'))) {
    throw 'Use the marked grouping diagnostic folder created by package.ps1'
}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler unavailable' }
$source=Join-Path $PSScriptRoot 'MatrixGramGroupingLauncher.cs'
$project=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$icon=Join-Path $project 'apps\client\src-tauri\icons\icon.ico'
$binary=Join-Path $outputPath 'MatrixGram - тест группировки.exe'
& $compiler /nologo /target:winexe /platform:anycpu /reference:System.Windows.Forms.dll /codepage:65001 "/win32icon:$icon" "/out:$binary" $source
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
Get-FileHash -LiteralPath $binary -Algorithm SHA256 | Format-List
