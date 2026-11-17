@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo Instale Node.js 22 ou superior em https://nodejs.org/ & pause & exit /b 1)
start "" "http://localhost:8000"
node backend\server.js
pause
