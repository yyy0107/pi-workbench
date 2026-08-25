@echo off
call "%~dp0_run.cmd" web-build
exit /b %errorlevel%
