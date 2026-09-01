@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0\..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%" || (
  echo Error: could not open the project root: "%PROJECT_ROOT%" 1>&2
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo Error: pnpm is required but was not found in PATH. 1>&2
  echo Install pnpm and run this script again. 1>&2
  exit /b 1
)

echo ^> Synchronizing dependencies from pnpm-lock.yaml
call pnpm install --frozen-lockfile --prod=false
if errorlevel 1 exit /b !errorlevel!

if /i "%~1"=="web-dev" (
  echo ^> Starting Web development server
  call pnpm dev
  exit /b !errorlevel!
)

if /i "%~1"=="web-build" (
  echo ^> Building Web application
  call pnpm build
  if errorlevel 1 exit /b !errorlevel!
  if not defined PORT set "PORT=3000"
  echo ^> Starting production Web application on port !PORT!
  set "NODE_ENV=production"
  call pnpm start
  exit /b !errorlevel!
)

if /i "%~1"=="electron-dev" (
  set "WORKBENCH_OPEN_DEVTOOLS=1"
  if defined WORKBENCH_DESKTOP_RENDERER_ORIGIN (
    echo ^> Connecting Electron to an existing Desktop renderer
    call pnpm electron:dev:connect
    exit /b !errorlevel!
  )
  echo ^> Starting the Desktop renderer and Electron; Electron owns Runtime
  call pnpm electron:dev
  exit /b !errorlevel!
)

if /i "%~1"=="electron-build" (
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

  echo ^> Starting packaged Electron application
  start "" /wait "!ELECTRON_EXE!"
  exit /b !errorlevel!
)

echo Usage: %~nx0 ^{web-dev^|web-build^|electron-dev^|electron-build^} 1>&2
exit /b 2
