; Keep the native MUI pages, translations, elevation and update handling.
!macro customHeader
  SetFont "Segoe UI" 9
!macroend

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

; electron-builder retries a missing old uninstaller indefinitely. Only clear
; its stale command; retain installation location, shortcuts and all user files.
; GetInQuotes is provided by electron-builder's installUtil.nsh.
!macro clearMissingWorkbenchUninstaller ROOT_KEY KEY
  Push $R0
  Push $R1
  ReadRegStr $R0 ${ROOT_KEY} "${KEY}" "UninstallString"
  StrCpy $R1 $R0 1
  ${if} $R1 == '$\"'
    Push $R0
    Call GetInQuotes
    Pop $R0
    ${if} $R0 != ""
    ${andIfNot} ${FileExists} "$R0"
      DeleteRegValue ${ROOT_KEY} "${KEY}" "UninstallString"
    ${endif}
  ${endif}
  Pop $R1
  Pop $R0
  ClearErrors
!macroend

!macro customInit
  !insertmacro clearMissingWorkbenchUninstaller HKCU "${UNINSTALL_REGISTRY_KEY}"
  !insertmacro clearMissingWorkbenchUninstaller HKLM "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    !insertmacro clearMissingWorkbenchUninstaller HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    !insertmacro clearMissingWorkbenchUninstaller HKLM "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
!macroend
