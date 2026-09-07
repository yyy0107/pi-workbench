; Keep the native MUI pages, translations, elevation and update handling.
!macro customHeader
  SetFont "Segoe UI" 9
!macroend

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend
