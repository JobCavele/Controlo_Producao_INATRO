#!/usr/bin/env python3
"""Cartas: servidor local sem dependências externas, com armazenamento SQLite."""
from contextlib import closing
import argparse
import datetime as dt
import json
import mimetypes
import os
from pathlib import Path
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'dist'
MAX_BODY = 5_000_000


def valid_date(value):
    if not isinstance(value, str) or len(value) != 10 or not '1900-01-01' <= value <= '2200-12-31':
        return False
    try:
        return dt.date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def validate_state(state):
    if not isinstance(state, dict) or state.get('version') != 2 or not isinstance(state.get('records'), list) or len(state['records']) > 10000:
        raise ValueError('Formato de dados inválido (versão 2).')
    ids, dates = set(), set()
    for r in state['records']:
        if not isinstance(r, dict):
            raise ValueError('Registo inválido.')
        identity, name = r.get('id'), r.get('name')
        if not isinstance(identity, str) or not 1 <= len(identity) <= 100 or identity in ids:
            raise ValueError('Identificador inválido ou repetido.')
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise ValueError('Designação inválida.')
        if r.get('kind') not in ('daily', 'report') or not valid_date(r.get('start')) or not valid_date(r.get('end')) or r['start'] > r['end']:
            raise ValueError('Período inválido. Usa datas entre 1900 e 2200.')
        if not isinstance(r.get('notes', ''), str) or len(r.get('notes', '')) > 1000:
            raise ValueError('As observações não podem exceder 1000 caracteres.')
        values = r.get('values')
        if not isinstance(values, list) or len(values) != 5:
            raise ValueError('São necessárias cinco linhas de valores.')
        for row in values:
            if not isinstance(row, dict) or any(k not in row for k in ('p', 'r')):
                raise ValueError('Valores inválidos.')
            for k in ('p', 'r'):
                n = row[k]
                if n is not None and (type(n) is not int or not 0 <= n <= 1_000_000_000):
                    raise ValueError('Usa inteiros não negativos ou campos não informados.')
        if 'machineQC' in r:
            qc = r['machineQC']
            if not isinstance(qc, list) or len(qc) != 2:
                raise ValueError('São necessários resultados QC das duas máquinas.')
            for machine in qc:
                if not isinstance(machine, dict) or any(k not in machine for k in ('approved', 'rejected')):
                    raise ValueError('QC por máquina inválido.')
                for value in machine.values():
                    if value is not None and (type(value) is not int or not 0 <= value <= 1_000_000_000):
                        raise ValueError('QC por máquina: usa inteiros não negativos.')
        if r['kind'] == 'daily':
            if r['start'] != r['end'] or r['start'] in dates:
                raise ValueError('Já existe um registo para este dia.')
            dates.add(r['start'])
        ids.add(identity)
    return state


def initialize_db(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL)')
        current = db.execute('SELECT document FROM app_state WHERE id=1').fetchone()
        if current is None:
            seed = validate_state(json.loads((WEB / 'seed.json').read_text(encoding='utf-8')))
            db.execute('INSERT INTO app_state VALUES(1, 1, ?)', (json.dumps(seed, ensure_ascii=False),))
        else:
            # Never replace an existing database, even if its contents are invalid.
            validate_state(json.loads(current[0]))
    return path


class Handler(BaseHTTPRequestHandler):
    server_version = 'Cartas/2.0'

    def allowed_host(self):
        port = self.server.server_port
        return self.headers.get('Host', '') in (f'127.0.0.1:{port}', f'localhost:{port}')

    def send_data(self, status, data, content_type='application/json; charset=utf-8'):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode('utf-8')
        elif isinstance(data, str):
            data = data.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed_host():
            return self.send_data(403, {'error': 'Este programa só aceita acesso local.'})
        path = unquote(urlsplit(self.path).path)
        if path == '/api/state':
            try:
                with closing(sqlite3.connect(self.server.db_path)) as db, db:
                    revision, document = db.execute('SELECT revision, document FROM app_state WHERE id=1').fetchone()
                return self.send_data(200, {'revision': revision, 'state': json.loads(document)})
            except (sqlite3.Error, ValueError, TypeError):
                return self.send_data(500, {'error': 'Não foi possível ler a base de dados. Os dados não foram reinicializados.'})
        if path == '/config.js':
            return self.send_data(200, "window.CARTAS_CONFIG = {storage: 'sqlite'};", 'application/javascript; charset=utf-8')
        file = (WEB / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
        if WEB.resolve() not in file.parents or not file.is_file():
            return self.send_data(404, {'error': 'Ficheiro não encontrado.'})
        try:
            mime = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
            return self.send_data(200, file.read_bytes(), mime + ('; charset=utf-8' if file.suffix in ('.html', '.css', '.js', '.json') else ''))
        except OSError:
            return self.send_data(500, {'error': 'Não foi possível ler o ficheiro.'})

    def do_PUT(self):
        if not self.allowed_host():
            return self.send_data(403, {'error': 'Acesso local obrigatório.'})
        origin = self.headers.get('Origin')
        if (origin and origin != 'http://' + self.headers.get('Host', '')) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.send_data(403, {'error': 'Origem não autorizada.'})
        if urlsplit(self.path).path != '/api/state':
            return self.send_data(404, {'error': 'Rota não encontrada.'})
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self.send_data(415, {'error': 'Usa o formato JSON.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                return self.send_data(413, {'error': 'O ficheiro excede o limite de 5 MB.'})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or type(payload.get('revision')) is not int:
                raise ValueError('Revisão inválida.')
            state = validate_state(payload.get('state'))
            document = json.dumps(state, ensure_ascii=False, allow_nan=False)
            with closing(sqlite3.connect(self.server.db_path, timeout=10)) as db, db:
                db.execute('BEGIN IMMEDIATE')
                revision = db.execute('SELECT revision FROM app_state WHERE id=1').fetchone()[0]
                if revision != payload['revision']:
                    return self.send_data(409, {'error': 'Os dados mudaram noutra janela. Exporta uma cópia antes de recarregar.'})
                db.execute('UPDATE app_state SET revision=?, document=? WHERE id=1', (revision + 1, document))
            return self.send_data(200, {'revision': revision + 1})
        except (ValueError, UnicodeDecodeError) as error:
            return self.send_data(400, {'error': str(error)})
        except sqlite3.Error:
            return self.send_data(500, {'error': 'Não foi possível gravar na base de dados. Nenhuma alteração foi confirmada.'})

    def log_message(self, format, *args):
        # Do not log data entered into forms.
        pass


def main():
    parser = argparse.ArgumentParser(description='Painel local de produção de cartas.')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'dados')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('A porta deve estar entre 1 e 65535.')
    try:
        db_path = initialize_db(args.data_dir.resolve() / 'cartas.sqlite3')
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
        server.db_path = db_path
        print(f'Cartas — http://localhost:{args.port}', flush=True)
        print(f'Dados: {db_path}', flush=True)
        print('Mantém esta janela aberta. Para encerrar: Ctrl+C.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nPrograma encerrado. Os dados continuam guardados.')
        finally:
            server.server_close()
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f'Não foi possível iniciar: {error}', file=sys.stderr)
        print('Se a porta estiver ocupada, usa: python server.py --port 8001', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
