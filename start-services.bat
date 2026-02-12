@echo off
setlocal

powershell -ExecutionPolicy Bypass -File "%~dp0start-services.ps1" %*
exit /b %errorlevel%
