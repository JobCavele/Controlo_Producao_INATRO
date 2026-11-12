#!/bin/sh
# Arranca o Conta Carta nesta pasta e abre o navegador.
cd "$(dirname "$0")" || exit 1
python3 server.py "$@" &
server=$!
sleep 1
(open "http://localhost:8000" 2>/dev/null || xdg-open "http://localhost:8000" 2>/dev/null || true)
wait "$server"
