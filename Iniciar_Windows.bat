@echo off
cd /d "%~dp0"
start "" "http://localhost:8000"
"%~dp0python\python.exe" "%~dp0server.py"
pause
