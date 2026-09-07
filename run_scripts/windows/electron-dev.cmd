@echo off
setlocal

cd /d "%~dp0\..\.." || exit /b 1

call pnpm install --frozen-lockfile --prod=false
if errorlevel 1 exit /b %errorlevel%

call pnpm electron:dev %*
exit /b %errorlevel%
