; The identity package is installed once and is NOT tied to app versions.
; Keep the external directory alive during updater uninstalls; never remove
; the identity on /UPDATE, otherwise every update would require UAC again.
!include LogicLib.nsh

!macro MATRIXGRAM_POWERSHELL target
  StrCpy ${target} "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy ${target} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  !insertmacro MATRIXGRAM_POWERSHELL $R0
  StrCpy $R1 ""
  ${If} ${Silent}
    StrCpy $R1 "-Quiet"
  ${EndIf}
  ${If} $UpdateMode <> 1
    StrCpy $R1 "$R1 -Retry"
  ${EndIf}
  ExecWait '"$R0" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\identity\RegisterIdentity.ps1" -InstallDirectory "$INSTDIR\." $R1' $R2
  ${If} $R2 <> 0
    DetailPrint "MatrixGram Windows integration failed; application remains installed."
    MessageBox MB_OK|MB_ICONEXCLAMATION "MatrixGram установлен, но настроить группировку процессов не удалось. Повторите запуск установщика для повторной настройки." /SD IDOK
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Push $R0
  ${If} $UpdateMode = 1
    ; Untracked marker prevents Tauri's RMDir from replacing the directory node.
    FileOpen $R0 "$INSTDIR\.matrixgram-identity.json" a
    FileClose $R0
  ${Else}
    InitPluginsDir
    CreateDirectory "$PLUGINSDIR\MatrixGramIdentity"
    CopyFiles /SILENT "$INSTDIR\identity\UnregisterIdentity.ps1" "$PLUGINSDIR\MatrixGramIdentity\UnregisterIdentity.ps1"
    CopyFiles /SILENT "$INSTDIR\identity\IdentityCommon.ps1" "$PLUGINSDIR\MatrixGramIdentity\IdentityCommon.ps1"
    CopyFiles /SILENT "$INSTDIR\identity\identity.json" "$PLUGINSDIR\MatrixGramIdentity\identity.json"
  ${EndIf}
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Push $R0
    Push $R1
    !insertmacro MATRIXGRAM_POWERSHELL $R0
    ExecWait '"$R0" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\MatrixGramIdentity\UnregisterIdentity.ps1" -InstallDirectory "$INSTDIR\."' $R1
    ${If} $R1 <> 0
      DetailPrint "MatrixGram package identity cleanup failed."
    ${EndIf}
    Delete "$INSTDIR\.matrixgram-identity.json"
    RMDir "$INSTDIR"
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend
