"""
Testes do servidor local (server.py): arranque, gravação optimista, cópias,
limites, proteção de pastas e o registo de erros.

    python3 -m unittest discover -s tests -p "test_*.py"
"""
import importlib.util
import unittest
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing
from http.client import RemoteDisconnected
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('contacarta_server', ROOT / 'server.py')
server_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server_module)

PORT = 18764
FIXTURE = json.loads((ROOT / 'tests/fixtures/synthetic.json').read_text(encoding='utf-8'))


def record(identity, start, end, first, second=None, notes=''):
    machine = lambda row: {'produced': row.get('produced', 0), 'rejected': row.get('rejected', 0),
                           'qualityRejected': row.get('qualityRejected', 0)}
    return {'id': identity, 'period': 'day' if start == end else 'range', 'start': start, 'end': end,
            'machines': [machine(first), machine(second or {})], 'notes': notes}


class ServerTestCase(unittest.TestCase):
    """Sobe um servidor por teste, numa pasta temporária vazia."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='contacarta-teste-'))
        self.start()

    def tearDown(self):
        self.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ------------------------------------------------------- infraestrutura ---

    def start(self, extra_args=()):
        self.process = subprocess.Popen(
            [sys.executable, str(ROOT / 'server.py'), '--port', str(PORT),
             '--data-dir', str(self.tmp), *extra_args],
            cwd=str(self.tmp), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.url = f'http://127.0.0.1:{PORT}'
        for _ in range(120):
            if self.process.poll() is not None:
                self.fail('O servidor não arrancou: ' + self.process.stderr.read())
            try:
                self.call('/api/state')
                return
            except (OSError, RemoteDisconnected):
                time.sleep(0.05)
        self.fail('O servidor tardou demasiado a arrancar.')

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            self.process.communicate(timeout=10)

    def call(self, path, body=None, headers=None, method=None):
        data = None
        headers = {'Content-Type': 'application/json', **(headers or {})}
        if body is not None:
            data = body.encode() if isinstance(body, (str, bytes)) else json.dumps(body).encode()
        req = request.Request(self.url + path, data=data, headers=headers,
                              method=method or ('PUT' if body is not None else 'GET'))
        try:
            with request.urlopen(req, timeout=5) as response:
                return response.status, response.read(), response.headers
        except error.HTTPError as caught:
            return caught.code, caught.read(), caught.headers

    def state(self):
        return json.loads(self.call('/api/state')[1])

    def save(self, payload):
        status, body, _ = self.call('/api/state', payload)
        return status, json.loads(body)

    # ------------------------------------------------------------- testes ---

    def test_instalacao_nova_comeca_sem_registos(self):
        fresh = self.state()
        self.assertEqual(fresh['state'], {'version': 4, 'records': []}, 'instalação nova não traz dados')
        self.assertEqual(fresh['storage'], 'sqlite')
        self.assertEqual(fresh['fileName'], 'contacarta.sqlite3')
        self.assertIsInstance(fresh['revision'], int)
        self.assertTrue((self.tmp / 'contacarta.sqlite3').is_file())
        self.assertEqual(self.call('/config.js')[1],
                         b'window.CONTACARTA_CONFIG = {storage: "sqlite"};',
                         'o config diz à aplicação para guardar no servidor')

    def test_aplicacao_servida_como_esta(self):
        for path, marker in (('/', b'Conta Carta'), ('/index.html', b'class="app"'), ('/core.js', b'ContaCartaCore'),
                             ('/app.js', b'ContaCartaCore'), ('/pdf.js', b'ContaCartaPdf'), ('/style.css', b'--green'),
                             ('/sample.json', b'exemplo-'), ('/seed.json', b'"version": 4')):
            status, body, headers = self.call(path)
            self.assertEqual(status, 200, path)
            self.assertIn(marker, body, path)
            self.assertEqual(headers['Cache-Control'], 'no-store', 'nada fica em cache: os dados têm de ser actuais')
        self.assertEqual(self.call('/index.html')[0], 200)

    def test_gravar_e_recuperar(self):
        original = self.state()
        status, saved = self.save({'revision': original['revision'], 'state': FIXTURE})
        self.assertEqual(status, 200)
        self.assertEqual(saved['revision'], original['revision'] + 1)
        self.assertEqual(self.state()['state'], FIXTURE)

        self.stop()
        self.start()
        after_restart = self.state()
        self.assertEqual(after_restart['revision'], saved['revision'], 'a revisão sobrevive ao reinício')
        self.assertEqual(after_restart['state'], FIXTURE, 'os registos sobreviveram ao reinício')
        with closing(sqlite3.connect(self.tmp / 'contacarta.sqlite3')) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_edicao_e_eliminacao_sao_so_mudancas_de_estado(self):
        base = self.state()
        self.assertEqual(self.save({'revision': base['revision'], 'state': FIXTURE})[0], 200)

        edited = self.state()
        edited['state']['records'][0]['notes'] = 'Notas revistas na sala.'
        status, second = self.save(edited)
        self.assertEqual(status, 200)
        self.assertEqual(self.state()['state']['records'][0]['notes'], 'Notas revistas na sala.')

        deleted = self.state()
        deleted['state']['records'].pop()
        status, third = self.save(deleted)
        self.assertEqual(status, 200)
        self.assertEqual(len(self.state()['state']['records']), 1)

        restored = {'revision': third['revision'], 'state': FIXTURE}
        self.assertEqual(self.save(restored)[0], 200)
        self.assertEqual(self.state()['state'], FIXTURE, 'a cópia anterior volta a ser exacta')

    def test_revisao_antiga_e_recusada_sem_perder_nada(self):
        original = self.state()
        self.save({'revision': original['revision'], 'state': FIXTURE})
        stale = {'revision': original['revision'], 'state': {'version': 4, 'records': []}}
        status, body = self.save(stale)
        self.assertEqual(status, 409)
        self.assertIn('Outra janela guardou', body['error'])
        self.assertIn('Recarrega', body['error'])
        self.assertEqual(self.state()['state'], FIXTURE, 'o pedido velho não apagou nada')

    def test_validacao_do_servidor_fala_claro(self):
        base = self.state()
        cases = [
            ({'version': 4, 'records': 'muitas'}, 'lista de registos'),
            ({'version': 2, 'records': []}, 'versão 4'),
            ({'version': 3, 'records': []}, 'versão 4'),
            ({'version': 4, 'records': [record('a', '2026-11-05', '2026-11-05',
                                               {'produced': 10, 'rejected': 6, 'qualityRejected': 5})]}, 'rejeitou mais cartas'),
            ({'version': 4, 'records': [record('a', '2026-11-05', '2026-11-05',
                                               {'produced': 10, 'rejected': 0, 'qualityRejected': 11})]}, 'rejeitou mais cartas'),
            ({'version': 4, 'records': [{'id': 'a', 'period': 'day', 'start': '2026-11-05', 'end': '2026-11-05',
                                          'machines': [{'produced': 10, 'rejected': 0}, {'produced': 0, 'rejected': 0, 'qualityRejected': 0}],
                                          'notes': ''}]}, 'rejeição no teste de qualidade'),
            ({'version': 4, 'records': [record('a', '2026-02-30', '2026-02-30', {'produced': 1, 'rejected': 0})]}, 'datas fora do intervalo'),
            ({'version': 4, 'records': [record('a', '2026-11-05', '2026-11-05', {'produced': 1.5, 'rejected': 0})]}, 'inteiros a partir de zero'),
            ({'version': 4, 'records': [record('a', '2026-11-05', '2026-11-05', {'produced': True, 'rejected': 0})]}, 'inteiros a partir de zero'),
            ({'version': 4, 'records': [dict(record('a', '2026-11-05', '2026-11-06', {'produced': 1, 'rejected': 0}), period='day')]}, 'mesma data de início e fim'),
            ({'version': 4, 'records': [record('a', '2026-11-05', '2026-11-05', {'produced': 1, 'rejected': 0}),
                                        record('b', '2026-11-05', '2026-11-06', {'produced': 1, 'rejected': 0})]}, 'partilham dias'),
            ({'version': 4, 'records': [record('a', '2026-11-05', '2026-11-05', {'produced': 1, 'rejected': 0}, notes='x' * 501)]}, '500 caracteres'),
            ({'version': 4, 'records': [{'id': 'a', 'period': 'ano', 'start': '2026-11-05', 'end': '2026-11-05',
                                         'machines': [{'produced': 0, 'rejected': 0, 'qualityRejected': 0}, {'produced': 0, 'rejected': 0, 'qualityRejected': 0}]}]}, 'período desconhecido'),
        ]
        for state, marker in cases:
            status, body = self.save({'revision': base['revision'], 'state': state})
            self.assertEqual(status, 400, f'{state} devia ser recusado')
            self.assertIn(marker, body['error'], f'mensagem pouco específica para {state}: {body["error"]}')
            self.assertNotIn('Traceback', body['error'])
            self.assertNotIn('sqlite', body['error'].lower())
        self.assertEqual(self.state()['state'], base['state'], 'nenhum dos pedidos inválidos alterou os dados')

    def test_pedidos_mal_formados(self):
        base = self.state()
        self.assertEqual(self.call('/api/state', '{"revision": 1, "state": {', {'Content-Type': 'application/json'})[0], 415)
        self.assertIn(b'JSON', self.call('/api/state', 'nada de json', {'Content-Type': 'text/plain'})[1])
        status, body = self.save({'state': FIXTURE})
        self.assertEqual(status, 400)
        self.assertIn('revis', body['error'])
        self.assertEqual(self.call('/api/state', '', {'Content-Length': '0'})[0], 400)
        big = json.dumps({'revision': base['revision'], 'state': {'version': 4, 'records': []}}) + ' ' * 6_000_000
        status, raw, _ = self.call('/api/state', big)
        self.assertEqual(status, 413)
        self.assertIn('grande de mais', json.loads(raw)['error'])

    def test_sozinho_o_navegador_da_aplicacao_pode_escrever(self):
        base = self.state()
        payload = {'revision': base['revision'], 'state': FIXTURE}
        self.assertEqual(self.call('/api/state', payload, {'Origin': 'https://exemplo.org'})[0], 403, 'página de fora não escreve')
        self.assertEqual(self.call('/api/state', payload, {'Host': 'exemplo.org'})[0], 403, 'endereço emprestado não escreve')
        self.assertEqual(self.state()['state'], base['state'], 'as recusas não gravaram nada')
        self.assertEqual(self.call('/api/state', payload, {'Origin': self.url,
                                                         'Host': '127.0.0.1'})[0], 200, 'a origem da própria aplicação serve')

    def test_acesso_pela_rede_pedir_autorizacao_explicita(self):
        # sem --allow-host, só este computador fala com o servidor
        self.assertEqual(self.call('/api/state', None, {'Host': 'sala.inatro.gov.mz'})[0], 403)
        self.stop()
        self.start(['--allow-host', 'inatro.gov.mz'])
        allowed = request.Request(self.url + '/api/state', headers={'Host': 'sala.inatro.gov.mz'})
        with request.urlopen(allowed, timeout=5) as response:
            self.assertEqual(response.status, 200, 'subdomínios do domínio autorizado entram')
        refused = request.Request(self.url + '/api/state', headers={'Host': 'outra-casa.exemplo'})
        try:
            self.fail(f'esperava recusa, veio {request.urlopen(refused, timeout=5).status}')
        except error.HTTPError as caught:
            self.assertEqual(caught.code, 403)

    def test_nada_fora_da_pasta_publica(self):
        for path in ('/nao-existe.js', '/../server.py', '/../../etc/passwd', '/dados/contacarta.sqlite3',
                     '/dist/../server.py', '/%2e%2e/server.py'):
            status, _, _ = self.call(path)
            self.assertIn(status, (400, 404), f'{path} não pode ser lido')
        self.assertFalse(any(Path(self.tmp).glob('*.html')), 'a raiz dos dados não é servida')
        self.assertEqual(self.call('/api/nao-existe')[0], 404)
        self.assertEqual(self.call('/api/nao-existe', {'a': 1}, method='PUT')[0], 404)

    def test_registo_de_erros_e_curto_e_humano(self):
        status, _, _ = self.call('/api/log', {'message': 'O utilizador carregou em Exportar sem nada no período.'}, method='POST')
        self.assertIn(status, (200, 204))
        log = (self.tmp / 'contacarta.log').read_text(encoding='utf-8')
        self.assertIn('O utilizador carregou', log)
        self.assertNotIn('Traceback', log)

        self.save({'revision': self.state()['revision'], 'state': {'version': 9, 'records': []}})
        self.assertIn('400', (self.tmp / 'contacarta.log').read_text(encoding='utf-8'))

        self.call('/api/log', {'message': 'x' * 5000})
        line = (self.tmp / 'contacarta.log').read_text(encoding='utf-8').strip().splitlines()[-1]
        self.assertLessEqual(len(line), 400, 'cada linha do registo é cortada')

        self.assertEqual(self.call('/api/log', 'não é json', method='POST')[0], 400, 'o canal de erros não rebenta com lixo')
        self.assertEqual(self.call('/api/log', {}, method='POST')[0], 400, 'mensagem vazia não entra no registo')
        for _ in range(120):
            self.call('/api/log', {'message': 'y' * 300}, method='POST')
        after = len((self.tmp / 'contacarta.log').read_text(encoding='utf-8'))
        self.assertLessEqual(after, server_module.MAX_LOG_BYTES + 2_000, 'o ficheiro de erros tem teto')

    def test_base_ilegivel_nunca_e_substituida(self):
        path = self.tmp / 'contacarta.sqlite3'
        self.assertEqual(self.save({'revision': self.state()['revision'], 'state': FIXTURE})[0], 200)
        self.stop()
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('UPDATE app_state SET document=?', ('{{json partido',))

        with self.assertRaises(ValueError) as raised:
            server_module.initialize_db(path)
        self.assertIn('ilegível', str(raised.exception))
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute('SELECT document FROM app_state WHERE id=1').fetchone()[0], '{{json partido',
                             'o arranque não pode “reparar” apagando os registos')

        refused = subprocess.run([sys.executable, str(ROOT / 'server.py'), '--port', str(PORT),
                                  '--data-dir', str(self.tmp)], capture_output=True, text=True, timeout=20)
        self.assertNotEqual(refused.returncode, 0, 'arrancar com dados ilegíveis tem de parar')
        self.assertIn('Não foi possível abrir os dados', refused.stderr)
        self.assertIn('continuam no ficheiro original', refused.stderr)
        self.assertNotIn('Traceback', refused.stderr)

    def test_copia_da_versao_anterior_e_convertida_ao_ler(self):
        legacy_path = self.tmp / 'cartas.sqlite3'
        with closing(sqlite3.connect(legacy_path)) as db, db:
            db.execute('CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, '
                       'document TEXT NOT NULL)')
            legacy = {'version': 2, 'records': [
                {'id': 'velho', 'kind': 'report', 'name': 'Outubro', 'start': '2026-10-01', 'end': '2026-10-31',
                 'notes': 'apontado à mão', 'values': [{'p': 120, 'r': 4}, {'p': 480, 'r': 6}, {'p': 600, 'r': 10}]},
                {'id': 'velho2', 'kind': 'daily', 'start': '2026-10-02', 'end': '2026-10-02',
                 'values': [{'p': 90, 'r': 9}, {'p': 0, 'r': 0}]},
            ]}
            db.execute('INSERT INTO app_state VALUES(1, 4, ?)',
                       (json.dumps(legacy, ensure_ascii=False),))
        self.stop()
        for name in ('contacarta.sqlite3', 'contacarta.sqlite3-wal', 'contacarta.sqlite3-shm'):
            Path(self.tmp / name).unlink(missing_ok=True)
        self.start()
        stored = self.state()
        self.assertEqual(stored['state']['version'], 4)
        converted = stored['state']['records']
        self.assertEqual(len(converted), 1, 'o dia que caía dentro do mês ficou de fora')
        self.assertEqual(converted[0]['period'], 'month')
        self.assertEqual(converted[0]['machines'],
                         [{'produced': 120, 'rejected': 4, 'qualityRejected': 0}, {'produced': 480, 'rejected': 6, 'qualityRejected': 0}],
                         'as rejeições de qualidade entram a zero na conversão')
        self.assertIn('sobreposição', converted[0]['notes'])
        self.assertGreater(stored['revision'], 4, 'a conversão fica registada como uma gravação')

    def test_head_e_para_saber_se_esta_vivo(self):
        req = request.Request(self.url + '/', method='HEAD')
        with request.urlopen(req, timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertGreater(int(response.headers['Content-Length']), 1000)
            self.assertEqual(response.read(), b'', 'HEAD não devolve corpo')


if __name__ == '__main__':
    unittest.main()
