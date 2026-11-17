$ErrorActionPreference='Stop'
# Use the host's inbox modules even when launched by a PowerShell 7 parent.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+(Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules')
function Get-MatrixGramIdentityDefinition {
    $definition=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'identity.json') -Raw | ConvertFrom-Json
    if ($definition.schema -ne 1 -or $definition.packageName -ne 'MadFrog.MatrixGram' -or $definition.publisher -ne 'CN=MatrixGram' -or $definition.applicationId -ne 'MatrixGram') { throw 'Unexpected MatrixGram identity definition' }
    return $definition
}
function Get-MatrixGramExternalPath([string]$FullName) {
    if (-not ('MatrixGramIdentityPaths' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MatrixGramIdentityPaths {
 [DllImport("api-ms-win-appmodel-runtime-l1-1-3.dll",CharSet=CharSet.Unicode,ExactSpelling=true)]
 private static extern int GetPackagePathByFullName2(string fullName,int type,ref uint length,StringBuilder path);
 public static string External(string fullName) {
  uint length=0; int code=GetPackagePathByFullName2(fullName,5,ref length,null);
  if(code!=122 || length==0 || length>32768) throw new InvalidOperationException("Package external path unavailable: "+code);
  StringBuilder path=new StringBuilder((int)length);
  code=GetPackagePathByFullName2(fullName,5,ref length,path);
  if(code!=0) throw new InvalidOperationException("Package external path failed: "+code);
  return path.ToString();
 }
}
'@
    }
    return [IO.Path]::GetFullPath([MatrixGramIdentityPaths]::External($FullName)).TrimEnd('\')
}
function Get-MatrixGramRegisteredIdentity($Definition) {
    $packages=@(Get-AppxPackage -Name $Definition.packageName)
    if ($packages.Count -gt 1) { throw 'Multiple MatrixGram package identities found; refusing to replace them' }
    if ($packages.Count) {
        if ($packages[0].Publisher -ne $Definition.publisher) { throw 'MatrixGram package publisher mismatch' }
        return $packages[0]
    }
    return $null
}
