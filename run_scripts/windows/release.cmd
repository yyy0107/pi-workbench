@echo off
setlocal

cd /d "%~dp0\..\.." || exit /b 1

call pnpm release:build
if errorlevel 1 exit /b %errorlevel%

call pnpm release:upload %*
exit /b %errorlevel%
