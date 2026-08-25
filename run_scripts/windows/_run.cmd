@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%" || (
  echo Error: could not open the project root: "%PROJECT_ROOT%" 1>&2
  exit /b 1
)

set "APP_PORT=%PORT%"
if not defined APP_PORT set "APP_PORT=3000"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo Error: pnpm is required but was not found in PATH. 1>&2
  echo Install pnpm and run this script again. 1>&2
  exit /b 1
)

if not exist "node_modules\" (
  echo ^> Dependencies are missing; running pnpm install
  call pnpm install
  if errorlevel 1 exit /b !errorlevel!
)

if /i "%~1"=="web-dev" (
  echo ^> Starting Web development server
  call pnpm dev
  exit /b !errorlevel!
)

if /i "%~1"=="web-build" (
  call :release_port
  if errorlevel 1 exit /b !errorlevel!
  echo ^> Building Web application
  call pnpm build
  if errorlevel 1 exit /b !errorlevel!
  echo ^> Starting production Web application on port !APP_PORT!
  set "NODE_ENV=production"
  set "PORT=!APP_PORT!"
  call pnpm start
  exit /b !errorlevel!
)

if /i "%~1"=="electron-dev" (
  echo ^> Synchronizing Electron development assets
  call pnpm predev
  if errorlevel 1 exit /b !errorlevel!
  echo ^> Starting Electron development application
  call pnpm electron:dev
  exit /b !errorlevel!
)

if /i "%~1"=="electron-build" (
  call :release_port
  if errorlevel 1 exit /b !errorlevel!
  echo ^> Building Electron installer for Windows
  call pnpm electron:dist
  if errorlevel 1 exit /b !errorlevel!

  set "ELECTRON_EXE="
  for %%F in ("%PROJECT_ROOT%\dist-electron\win-unpacked\*.exe") do (
    if exist "%%~fF" if not defined ELECTRON_EXE set "ELECTRON_EXE=%%~fF"
  )
  if not defined ELECTRON_EXE (
    echo Error: packaged Electron executable was not found in "%PROJECT_ROOT%\dist-electron\win-unpacked". 1>&2
    exit /b 1
  )

  echo ^> Starting packaged Electron application on port !APP_PORT!
  set "PORT=!APP_PORT!"
  start "" /wait "!ELECTRON_EXE!"
  exit /b !errorlevel!
)

echo Usage: %~nx0 ^{web-dev^|web-build^|electron-dev^|electron-build^} 1>&2
exit /b 2

:release_port
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo Error: PowerShell is required to release port !APP_PORT!. 1>&2
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$portValue = 0; if (-not [int]::TryParse($env:APP_PORT, [ref]$portValue) -or $portValue -lt 1 -or $portValue -gt 65535) { Write-Error ('PORT must be an integer from 1 to 65535; received ''{0}''.' -f $env:APP_PORT); exit 2 }; for ($attempt = 0; $attempt -lt 30; $attempt++) { $listeners = @(Get-NetTCPConnection -LocalPort $portValue -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($listeners.Count -eq 0) { if ($attempt -eq 0) { Write-Host ('> Port {0} is already available' -f $portValue) }; exit 0 }; if ($attempt -eq 0) { Write-Host ('> Releasing port {0} from process(es): {1}' -f $portValue, ($listeners -join ', ')) }; foreach ($processId in $listeners) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 100 }; Write-Error ('Port {0} could not be released.' -f $portValue); exit 1"
exit /b !errorlevel!
