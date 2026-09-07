@echo off
setlocal

cd /d "%~dp0\..\.." || exit /b 1

call pnpm release:upload %*
exit /b %errorlevel%
