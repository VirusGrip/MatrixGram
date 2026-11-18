Unicode true
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!include FileFunc.nsh
Var UpdateMode
!include "${HOOK_FILE}"
OutFile "${OUTPUT_FILE}"
InstallDir "${FIXTURE_ROOT}"
Section
  ${GetOptions} $CMDLINE "/MODE=" $0
  ${If} $0 == "update"
    StrCpy $UpdateMode 1
    !insertmacro NSIS_HOOK_POSTINSTALL
  ${Else}
    StrCpy $UpdateMode 0
  ${EndIf}
  !insertmacro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\matrixgram.exe"
  Delete "$INSTDIR\identity\MatrixGram.identity.msix"
  Delete "$INSTDIR\identity\publisher.cer"
  Delete "$INSTDIR\identity\identity.json"
  Delete "$INSTDIR\identity\IdentityCommon.ps1"
  Delete "$INSTDIR\identity\RegisterIdentity.ps1"
  Delete "$INSTDIR\identity\UnregisterIdentity.ps1"
  Delete "$INSTDIR\identity\IdentityTrust.exe"
  Delete "$INSTDIR\identity\logo.png"
  RMDir "$INSTDIR\identity"
  RMDir "$INSTDIR"
  ${If} $UpdateMode <> 1
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  ${EndIf}
SectionEnd
