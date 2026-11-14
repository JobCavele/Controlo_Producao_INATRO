#!/bin/sh
# Compila o executável Windows (.exe) a partir do Linux usando Wine + PyInstaller
set -e
cd "$(dirname "$0")"

WINE_PREFIX="${WINEPREFIX:-$HOME/.cache/wine_test}"
if ! command -v wine >/dev/null 2>&1; then
  echo "Erro: wine não encontrado." >&2
  exit 1
fi

echo "A compilar ContaCarta.exe..."
# Parâmetros do PyInstaller:
#   --noconfirm: Sobrescreve saídas existentes sem pedir confirmação interativa
#   --clean: Limpa a cache do PyInstaller antes de compilar
#   --onefile: Empacota num único executável binário (.exe) autónomo
#   --name: Nome do ficheiro de saída (ContaCarta.exe)
#   --icon: Incorpora o ícone oficial (.ico) nos recursos do executável
#   --distpath: Diretório de destino final do executável gerado
#   --workpath: Diretório temporário de construção (removido após término)
#   --add-data: Embutir ficheiros da interface web (pasta dist) dentro do .exe
WINEPREFIX="$WINE_PREFIX" wine pyinstaller --noconfirm --clean --onefile \
  --name "ContaCarta" \
  --icon "icons/ContaCarta.ico" \
  --distpath release_windows \
  --workpath build_pyinstaller \
  --add-data "dist;dist" \
  server.py

rm -rf build_pyinstaller
echo "Pronto! Executável gerado em: release_windows/ContaCarta.exe"
