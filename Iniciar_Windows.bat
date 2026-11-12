@echo off
rem Arranca o Conta Carta e abre o navegador.
cd /d "%~dp0"
start "" "http://localhost:8000"
if exist "%~dp0python\python.exe" (
  "%~dp0python\python.exe" "%~dp0server.py"
) else (
  py -3 server.py
)
pause
