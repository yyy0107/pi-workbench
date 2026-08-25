@echo off
call "%~dp0_run.cmd" electron-build
exit /b %errorlevel%
