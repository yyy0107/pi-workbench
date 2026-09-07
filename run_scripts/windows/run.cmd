@echo off
setlocal

cd /d "%~dp0\..\.." || exit /b 1

call pnpm start %*
exit /b %errorlevel%
