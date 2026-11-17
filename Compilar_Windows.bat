@echo off
rem Compila o executavel Windows (.exe) nativamente no Windows com PyInstaller
cd /d "%~dp0"
rem 1. Garante que o PyInstaller esta instalado no ambiente Python do Windows
echo A verificar/instalar PyInstaller...
python -m pip install --upgrade pyinstaller

rem 2. Compila para executavel unico com icone oficial e interface web embutida
echo A compilar ContaCarta.exe...
pyinstaller --noconfirm --clean --onefile --name "ContaCarta" --icon "assets\icons\ContaCarta.ico" --distpath release_windows --workpath build_pyinstaller --add-data "app;app" server.py
if exist build_pyinstaller rd /s /q build_pyinstaller
echo.
echo Executavel gerado em: release_windows\ContaCarta.exe
pause
