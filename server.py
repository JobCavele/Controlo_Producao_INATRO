#!/usr/bin/env python3
"""
Conta Carta · servidor local do registo de produção de cartas (INATRO, IP)

Um único ficheiro Python, sem pacotes externos. Serve a aplicação em `app/`,
guarda os registos em SQLite e trata dos erros com mensagens legíveis para
quem trabalha na sala de produção. Os dados nunca saem deste computador.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import mimetypes
import re
import sys
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from sqlite3 import connect
from urllib.parse import unquote, urlsplit
import uuid

if getattr(sys, 'frozen', False):
    ROOT = Path(sys.executable).resolve().parent
    WEB = Path(getattr(sys, '_MEIPASS', ROOT)) / 'app'
    if not WEB.exists():
        WEB = ROOT / 'app'
else:
    ROOT = Path(__file__).resolve().parent
    WEB = ROOT / 'app'
VERSION = 6
MAX_BODY = 5_000_000          # 5 MB de cópia JSON
MAX_RECORDS = 5000
MAX_ENTRIES = 300
MAX_LOG_BYTES = 200_000       # o registo de erros é um apoio, não um arquivo
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
MACHINE_COUNT = 2
PERIODS = ('day', 'month', 'range')
MACHINE_KEYS = ('m1', 'm2')
REASON_CODES = ('bio-foto', 'bio-outra', 'scan-foto', 'material-lamina', 'material-riscos', 'cartao-reutilizado')
LOT_STAGES = ('personalizacao', 'impressao', 'qualidade', 'despacho')
LOT_STAGE_LABELS = {'personalizacao': 'personalização', 'impressao': 'impressão',
                    'qualidade': 'qualidade', 'despacho': 'despacho'}
LOT_STATUS = ('pendente', 'em-curso', 'feito')
STOCK_KINDS = ('cartao', 'tonner', 'tinteiro', 'limpeza', 'manutencao', 'papel', 'outro')


# ------------------------------------------------------------------ datas ---

def parse_date(value) -> str | None:
    """Lê uma data escrita `dd/mm/yyyy` (ou em ISO `yyyy-mm-dd`) e devolve ISO, ou None.

    A base guarda sempre ISO; o que se escreve no sistema é dia/mês/ano.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    written = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', text)
    iso = f'{written.group(3)}-{written.group(2).zfill(2)}-{written.group(1).zfill(2)}' if written else text
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', iso):
        return None
    if not '1900-01-01' <= iso <= '2200-12-31':
        return None
    try:
        return iso if dt.date.fromisoformat(iso).isoformat() == iso else None
    except ValueError:
        return None


def valid_date(value) -> bool:
    """Data ISO completa, real e dentro do intervalo aceite pela aplicação."""
    return isinstance(value, str) and parse_date(value) == value


def month_range(month: str) -> tuple[str, str]:
    """Primeiro e último dia de «AAAA-MM»."""
    year, index = int(month[:4]), int(month[5:7])
    start = f'{month}-01'
    end_year, end_month = (year + 1, 1) if index == 12 else (year, index + 1)
    last = (dt.date(end_year, end_month, 1) - dt.timedelta(days=1)).isoformat()
    return start, last


def period_label(start: str, end: str) -> str:
    """Rótulo curto de um período, igual ao que a aplicação mostra."""
    if start == end:
        return f'{start[8:10]}/{start[5:7]}/{start[:4]}'
    if start[8:] == '01' and month_range(start[:7])[1] == end:
        return f'{start[5:7]}/{start[:4]}'
    return f'{period_label(start, start)} – {period_label(end, end)}'


# --------------------------------------------------------------- dados ---

def migrate(document):
    """Converte cópias das versões anteriores para o modelo actual (quantidades por máquina, lotes, material)."""
    if not isinstance(document, dict) or not isinstance(document.get('records'), list):
        raise ValueError('O ficheiro não tem registos para converter.')
    version = document.get('version')
    if version not in (1, 2, 3, 4, 5, 6):
        raise ValueError('Só se podem converter cópias das versões 1, 2, 3, 4 e 5 do Conta Carta.')
    lots = [_normalise_lot(lot) for lot in document.get('lots') or []] if isinstance(document.get('lots'), list) else []
    stock = [_normalise_stock(item) for item in document.get('stock') or []] if isinstance(document.get('stock'), list) else []
    if version in (3, 4, 5, 6):
        return {'version': VERSION, 'records': [_normalise(record) for record in document['records']],
                'lots': lots, 'stock': stock}

    kept = []
    for legacy in document['records']:
        if not isinstance(legacy, dict):
            raise ValueError('Existem registos que não são reconhecíveis.')
        values = legacy.get('values') if isinstance(legacy.get('values'), list) else []

        def machine(index):
            row = values[index] if index < len(values) and isinstance(values[index], dict) else {}
            def positive(key):
                value = row.get(key)
                return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0
            produced = positive('p')
            rejected = min(positive('r'), produced)
            return {'produced': produced, 'rejected': rejected, 'qualityRejected': min(positive('q'), produced - rejected)}

        start = parse_date(legacy.get('start')) or '1900-01-01'
        end = parse_date(legacy.get('end')) or start
        machines = [machine(0), machine(1)]
        declared = values[2] if len(values) > 2 and isinstance(values[2], dict) else {}
        notes = (legacy.get('notes') or '').strip()
        if not any(machines[0].values()) and not any(machines[1].values()) and isinstance(declared.get('p'), int) and declared['p'] > 0:
            declared_rejected = min(declared.get('r'), declared['p']) if isinstance(declared.get('r'), int) and not isinstance(declared.get('r'), bool) else 0
            machines[0] = {'produced': declared['p'], 'rejected': declared_rejected, 'qualityRejected': 0}
            notes = (notes + ' Convertido do total declarado; divide as quantidades pelas máquinas.').strip()
        kind = legacy.get('kind')
        period = 'day' if (kind == 'daily' or start == end) else (
            'month' if kind == 'report' and start[8:] == '01' and month_range(start[:7])[1] == end else 'range')
        kept.append(_normalise({'id': legacy.get('id'), 'period': period, 'start': start,
                                'end': end, 'machines': machines, 'notes': notes}))
    # Registos antigos podiam sobrepor-se: fica o primeiro, o resto é anotado.
    result = []
    for record in sorted(kept, key=lambda item: item['start']):
        clash = next((other for other in result if other['start'] <= record['end'] and record['start'] <= other['end']), None)
        if clash:
            clash['notes'] = (clash['notes'] + f" Tinha também «{period_label(record['start'], record['end'])}», "
                              'que ficou de fora por sobreposição.').strip()
            continue
        result.append(record)
    return {'version': VERSION, 'records': result, 'lots': lots, 'stock': stock}


def _normalise(record):
    """Forma interna garantida de um registo (usado na leitura e na migração)."""
    if not isinstance(record, dict):
        raise ValueError('Um dos registos não está em boa forma.')
    start = parse_date(record.get('start')) or '1900-01-01'
    end = parse_date(record.get('end')) or start
    if end < start:
        start, end = end, start
    entries = [_normalise_entry(entry, parse_date(record.get('start')) or '1900-01-01')
               for entry in record.get('entries') or []] if isinstance(record.get('entries'), list) else []
    # uma cópia antiga trazia só os totais por máquina: entram como um lote concluído cada
    if not entries and isinstance(record.get('machines'), list):
        for index in range(MACHINE_COUNT):
            machine = record['machines'][index] if len(record['machines']) > index else {}
            def integer(key):
                value = machine.get(key) if isinstance(machine, dict) else None
                return value if isinstance(value, int) and not isinstance(value, bool) else 0
            produced = max(0, min(integer('produced'), 1_000_000_000))
            rejected = max(0, min(integer('rejected'), produced))
            quality = max(0, min(integer('qualityRejected'), produced))
            if not produced and not rejected and not quality:
                continue
            entries.append({'id': _new_id(), 'lotId': '', 'reference': '', 'delegation': '', 'machine': index,
                            'planned': produced, 'produced': produced, 'rejected': rejected, 'qualityRejected': quality,
                            'reasons': [], 'done': True, 'updated': '', 'notes': ''})
    period = record.get('period')
    if period not in PERIODS:
        period = 'day' if start == end else 'range'
    if period == 'day' and start != end:
        period = 'range'
    if period == 'month' and (start[8:] != '01' or month_range(start[:7])[1] != end):
        period = 'range'
    identity = record.get('id')
    return {'id': identity[:64] if isinstance(identity, str) and identity else _new_id(),
            'period': period, 'start': start, 'end': end, 'entries': entries,
            'closed': record.get('closed') is True,
            'notes': (record.get('notes') or '')[:500] if isinstance(record.get('notes', ''), str) else ''}


def _normalise_entry(entry, day):
    """A forma interna de um lote dentro do dia: quantidades coerentes e motivos do INCAPE."""
    source = entry if isinstance(entry, dict) else {}
    produced = _count(source.get('produced'))
    planned = _count(source.get('planned')) or produced
    identity = source.get('id')
    return {'id': identity[:64] if isinstance(identity, str) and identity else _new_id(),
            'lotId': str(source.get('lotId') or '')[:64],
            'reference': str(source.get('reference') or '').strip()[:40],
            'delegation': str(source.get('delegation') or '').strip()[:80],
            'machine': 1 if source.get('machine') == 1 else 0,
            'planned': planned, 'produced': produced,
            'rejected': min(_count(source.get('rejected')), produced),
            'qualityRejected': min(_count(source.get('qualityRejected')), produced),
            'reasons': _normalise_entry_reasons(source.get('reasons')),
            'done': source.get('done') is not False,
            'updated': parse_date(source.get('updated')) or day,
            'notes': str(source.get('notes') or '')[:300]}


def _normalise_entry_reasons(entries):
    """Os motivos de um lote: só os do INCAPE e com alguma chumbada."""
    kept = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or entry.get('code') not in REASON_CODES:
            continue
        quantity = _count(entry.get('quantity'))
        if quantity:
            kept.append({'code': entry['code'], 'quantity': quantity})
    return kept


def _count(value) -> int:
    """Quantidade escrita à mão: inteiro não negativo, zero quando não se percebe."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, min(value, 1_000_000_000))
    if isinstance(value, str):
        digits = re.sub(r'[\s\u00a0.]', '', value.strip())
        return max(0, min(int(digits), 1_000_000_000)) if digits.isdigit() else 0
    return 0


def _normalise_reasons(entries):
    """Os motivos do INCAPE de um registo; só ficam os que têm chumbadas."""
    kept = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or entry.get('code') not in REASON_CODES:
            continue
        row = {'code': entry['code'], 'm1': _count(entry.get('m1')), 'm2': _count(entry.get('m2'))}
        if row['m1'] or row['m2']:
            kept.append(row)
    return kept


def _normalise_lot(lot):
    """Forma interna de um lote: fases na ordem certa, quantidades e datas legíveis."""
    if not isinstance(lot, dict):
        raise ValueError('Um dos lotes não está em boa forma.')
    quantity = _count(lot.get('quantity'))
    stages = {}
    for stage in LOT_STAGES:
        source = lot.get('stages', {}).get(stage) if isinstance(lot.get('stages'), dict) else None
        source = source if isinstance(source, dict) else {}
        stages[stage] = {
            'stage': stage,
            'state': source.get('state') if source.get('state') in LOT_STATUS else 'pendente',
            'quantity': _count(source['quantity']) if source.get('quantity') not in (None, '') else quantity,
            'updated': parse_date(source.get('updated')) or '',
            'note': re.sub(r'\s+', ' ', str(source.get('note') or ''))[:300],
        }
    reference = re.sub(r'\s+', ' ', str(lot.get('reference') or '')).strip()[:40]
    identity = lot.get('id')
    return {'id': identity[:64] if isinstance(identity, str) and identity else _new_id(),
            'reference': reference, 'delegation': str(lot.get('delegation') or '').strip()[:80],
            'quantity': quantity, 'start': parse_date(lot.get('start')) or '1900-01-01',
            'stages': stages,
            'notes': str(lot.get('notes') or '')[:500],
            'closed': stages['despacho']['state'] == 'feito' and bool(stages['despacho']['updated'])}


def _normalise_stock(item):
    """Forma interna de um artigo do armazém."""
    if not isinstance(item, dict):
        raise ValueError('Um dos artigos de material não está em boa forma.')
    identity = item.get('id')
    received = _count(item.get('received'))
    issued = min(_count(item.get('issued')), received)
    return {'id': identity[:64] if isinstance(identity, str) and identity else _new_id(),
            'name': re.sub(r'\s+', ' ', str(item.get('name') or '')).strip()[:120],
            'kind': item.get('kind') if item.get('kind') in STOCK_KINDS else 'outro',
            'unit': str(item.get('unit') or 'un.').strip()[:20],
            'contracted': _count(item.get('contracted')),
            'received': received, 'issued': issued, 'minimum': _count(item.get('minimum')),
            'delivered': parse_date(item.get('delivered')) or '',
            'updated': parse_date(item.get('updated')) or '',
            'notes': str(item.get('notes') or '')[:300]}


def _new_id() -> str:
    """Gera um identificador único (UUID v4) para novos registos."""
    return str(uuid.uuid4())


def validate_state(state):
    """Rejeita dados que a aplicação não consegue mostrar com correcção."""
    if not isinstance(state, dict):
        raise ValueError('Os dados não foram reconhecidos. Importa uma cópia exportada pelo Conta Carta.')
    if state.get('version') != VERSION:
        raise ValueError(f'A cópia tem de ser da versão {VERSION} do Conta Carta.')
    records = state.get('records')
    if not isinstance(records, list):
        raise ValueError('A cópia não tem uma lista de registos.')
    if len(records) > MAX_RECORDS:
        raise ValueError(f'Só se aceitam {MAX_RECORDS} registos por ficheiro.')

    ids, ordered = set(), []
    for index, record in enumerate(records):
        where = f'Registo {index + 1}'
        if not isinstance(record, dict):
            raise ValueError(f'{where}: formato inválido.')
        identity = record.get('id')
        if not isinstance(identity, str) or not 1 <= len(identity) <= 64:
            raise ValueError(f'{where}: identificador inválido.')
        if identity in ids:
            raise ValueError(f'{where}: o identificador está repetido na cópia.')
        ids.add(identity)
        if record.get('period') not in PERIODS:
            raise ValueError(f'{where}: tipo de período desconhecido.')
        start, end = parse_date(record.get('start')), parse_date(record.get('end'))
        if not start or not end:
            raise ValueError(f'{where}: datas fora do intervalo aceite (entre 01/01/1900 e 31/12/2200).')
        if end < start:
            raise ValueError(f'{where}: a data final é anterior à inicial.')
        # a base guarda sempre ISO, mesmo que a cópia traga dd/mm/yyyy
        record = {**record, 'start': start, 'end': end}
        if record['period'] == 'day' and start != end:
            raise ValueError(f'{where}: um registo diário tem de ter a mesma data de início e fim.')
        if record['period'] == 'month' and (start[8:] != '01' or month_range(start[:7])[1] != end):
            raise ValueError(f'{where}: um registo mensal tem de corresponder a um mês completo.')
        notes = record.get('notes', '')
        if not isinstance(notes, str) or len(notes) > 500:
            raise ValueError(f'{where}: as notas não podem ter mais de 500 caracteres.')
        entries = record.get('entries')
        if not isinstance(entries, list):
            raise ValueError(f'{where}: os lotes do dia não estão em lista.')
        if len(entries) > MAX_ENTRIES:
            raise ValueError(f'{where}: um dia tem no máximo {MAX_ENTRIES} lotes.')
        entry_ids = set()
        for entry_index, entry in enumerate(entries):
            label = f'lote {entry_index + 1}'
            if not isinstance(entry, dict):
                raise ValueError(f'{where}: o {label} está vazio.')
            identity_entry = entry.get('id')
            if not isinstance(identity_entry, str) or not 1 <= len(identity_entry) <= 64:
                raise ValueError(f'{where}: o {label} tem um identificador inválido.')
            if identity_entry in entry_ids:
                raise ValueError(f'{where}: o {label} está repetido.')
            entry_ids.add(identity_entry)
            if entry.get('machine') not in (0, 1):
                raise ValueError(f'{where}: o {label} tem de indicar a máquina (1 ou 2).')
            name = f'Máquina {entry["machine"] + 1}'
            for key, field_label in (('planned', 'as cartas planeadas'), ('produced', 'as cartas produzidas'),
                                     ('rejected', 'as rejeitadas pela máquina'), ('qualityRejected', 'as chumbadas no teste')):
                value = entry.get(key)
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise ValueError(f'{where}: {label}, {name}: {field_label} tem de ser inteiros a partir de zero.')
                if value > 1_000_000_000:
                    raise ValueError(f'{where}: {label}, {name}: ultrapassa o limite de 1 000 000 000 cartas.')
            if not entry.get('planned'):
                raise ValueError(f'{where}: {label}, {name}: diz quantas cartas tem o lote.')
            if entry['rejected'] > entry['produced']:
                raise ValueError(f'{where}: {label}, {name}: rejeitou mais cartas do que produziu.')
            if entry['qualityRejected'] > entry['produced']:
                raise ValueError(f'{where}: {label}, {name}: chumbou no teste mais cartas do que produziu.')
            if not isinstance(entry.get('done'), bool):
                raise ValueError(f'{where}: {label}: o estado do lote tem de dizer se está concluído.')
            if entry.get('updated'):
                updated = parse_date(entry['updated'])
                if not updated:
                    raise ValueError(f'{where}: {label}: a data do lote tem de estar entre 01/01/1900 e 31/12/2200.')
                entry = {**entry, 'updated': updated}
            reasons = entry.get('reasons')
            if not isinstance(reasons, list):
                raise ValueError(f'{where}: {label}: os motivos das chumbadas não estão em lista.')
            for reason_index, reason in enumerate(reasons):
                reason_label = f'motivo {reason_index + 1}'
                if not isinstance(reason, dict) or reason.get('code') not in REASON_CODES:
                    raise ValueError(f'{where}: {label}: {reason_label} não é um motivo de rejeição do INCAPE.')
                quantity = reason.get('quantity')
                if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
                    raise ValueError(f'{where}: {label}, {reason_label}: usa inteiros a partir de zero.')
        if not isinstance(record.get('closed', False), bool):
            raise ValueError(f'{where}: o fecho do dia não está em condições.')
        # as datas podem chegar escritas à mão (dd/mm/aaaa): guardam-se sempre em ISO
        ordered.append({**record, 'start': start, 'end': end, 'closed': record.get('closed') is True})

    sorted_records = sorted(ordered, key=lambda item: item['start'])
    for left, right in zip(sorted_records, sorted_records[1:]):
        if left['end'] >= right['start']:
            raise ValueError(f'«{period_label(left["start"], left["end"])}» e «{period_label(right["start"], right["end"])}» '
                             'partilham dias. Cada carta só pode ser contada uma vez.')
    lots = _validate_lots(state.get('lots'))
    stock = _validate_stock(state.get('stock'))
    result = {'version': VERSION, 'records': ordered}
    if isinstance(state.get('sideOpen'), bool):
        result['sideOpen'] = state['sideOpen']
    if lots is not None:
        result['lots'] = lots
    if stock is not None:
        result['stock'] = stock
    return result


def _validate_lots(lots):
    """Lotes: cada um com a sua referência, as quatro fases e datas legíveis."""
    if lots is None:
        return None
    if not isinstance(lots, list):
        raise ValueError('A cópia não traz a lista de lotes em condições.')
    if len(lots) > MAX_RECORDS:
        raise ValueError(f'Só se aceitam {MAX_RECORDS} lotes por ficheiro.')
    seen, ordered = set(), []
    for index, lot in enumerate(lots):
        where = f'Lote {index + 1}'
        if not isinstance(lot, dict):
            raise ValueError(f'{where}: formato inválido.')
        identity = lot.get('id')
        if not isinstance(identity, str) or not 1 <= len(identity) <= 64:
            raise ValueError(f'{where}: identificador inválido.')
        reference = re.sub(r'\s+', ' ', str(lot.get('reference') or '')).strip()
        if not reference:
            raise ValueError(f'{where}: sem referência. Cada lote tem de ter a sua.')
        if reference.lower() in seen:
            raise ValueError(f'{where}: a referência «{reference}» está repetida. Cada lote tem de ter a sua.')
        seen.add(reference.lower())
        if not isinstance(lot.get('delegation'), str) or len(lot['delegation']) > 80:
            raise ValueError(f'{where}: a delegação está inválida.')
        quantity = lot.get('quantity')
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise ValueError(f'{where}: as cartas do lote têm de ser um número inteiro maior do que zero.')
        start = parse_date(lot.get('start'))
        if not start:
            raise ValueError(f'{where}: a data de abertura tem de estar entre 01/01/1900 e 31/12/2200.')
        stages = lot.get('stages')
        if not isinstance(stages, dict):
            raise ValueError(f'{where}: faltam as fases do lote.')
        clean_stages = {}
        for stage in LOT_STAGES:
            entry = stages.get(stage)
            if not isinstance(entry, dict):
                raise ValueError(f'{where}: falta a fase de {LOT_STAGE_LABELS[stage]}.')
            if entry.get('state') not in LOT_STATUS:
                raise ValueError(f'{where}: estado desconhecido na fase de {LOT_STAGE_LABELS[stage]}.')
            updated = entry.get('updated') or ''
            if updated and not parse_date(updated):
                raise ValueError(f'{where}: a data da fase de {LOT_STAGE_LABELS[stage]} não é uma data válida.')
            stage_quantity = entry.get('quantity', 0)
            if isinstance(stage_quantity, bool) or not isinstance(stage_quantity, int) or stage_quantity < 0:
                raise ValueError(f'{where}: as cartas da fase de {LOT_STAGE_LABELS[stage]} têm de ser um número inteiro a partir de zero.')
            clean_stages[stage] = {'stage': stage, 'state': entry['state'], 'quantity': stage_quantity,
                                   'updated': parse_date(updated) if updated else '',
                                   'note': str(entry.get('note') or '')[:300]}
        ordered.append({**lot, 'reference': reference, 'start': start, 'stages': clean_stages,
                        'closed': clean_stages['despacho']['state'] == 'feito' and bool(clean_stages['despacho']['updated'])})
    return ordered


def _validate_stock(stock):
    """Material do armazém: nomes distintos e quantidades coerentes (não se dá o que não entrou)."""
    if stock is None:
        return None
    if not isinstance(stock, list):
        raise ValueError('A cópia não traz o material em condições.')
    if len(stock) > MAX_RECORDS:
        raise ValueError(f'Só se aceitam {MAX_RECORDS} artigos de material.')
    seen, ordered = set(), []
    for index, item in enumerate(stock):
        where = f'Material {index + 1}'
        if not isinstance(item, dict):
            raise ValueError(f'{where}: formato inválido.')
        identity = item.get('id')
        if not isinstance(identity, str) or not 1 <= len(identity) <= 64:
            raise ValueError(f'{where}: identificador inválido.')
        name = re.sub(r'\s+', ' ', str(item.get('name') or '')).strip()
        if not name:
            raise ValueError(f'{where}: sem nome.')
        if name.lower() in seen:
            raise ValueError(f'{where}: o material «{name}» está repetido. Actualiza o que já existe.')
        seen.add(name.lower())
        for key in ('contracted', 'received', 'issued', 'minimum'):
            value = item.get(key, 0)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f'{where}: as quantidades têm de ser números inteiros a partir de zero.')
        if item.get('issued', 0) > item.get('received', 0):
            raise ValueError(f'{where}: «{name}» deu mais do que recebeu. Corrige uma das quantidades.')
        if item.get('updated') and not parse_date(item['updated']):
            raise ValueError(f'{where}: a data do movimento não é uma data válida.')
        if item.get('delivered') and not parse_date(item['delivered']):
            raise ValueError(f'{where}: a data da entrega não é uma data válida.')
        ordered.append({**item, 'name': name,
                        'delivered': parse_date(item.get('delivered')) if item.get('delivered') else '',
                        'updated': parse_date(item.get('updated')) if item.get('updated') else ''})
    return ordered


# ------------------------------------------------------------- base de dados ---

def db_connect(path: Path):
    """Abre ligação à base SQLite com timeout de 10s e modo WAL para leitura/escrita concorrente."""
    connection = connect(path, timeout=10)
    connection.execute('PRAGMA journal_mode=WAL')
    return connection


def read_state(path: Path):
    """Lê o estado guardado, convertendo bases de versões anteriores."""
    with closing(db_connect(path)) as db:
        cols = {row[1] for row in db.execute('PRAGMA table_info(app_state)').fetchall()}
        if cols and 'updated_at' not in cols:
            db.execute('ALTER TABLE app_state ADD COLUMN updated_at TEXT')
            db.commit()
        row = db.execute('SELECT revision, document, updated_at FROM app_state WHERE id=1').fetchone()
        if row is None:
            raise ValueError('A base de dados ainda não tem registos.')
        revision, document, updated = row
        try:
            stored = json.loads(document)
        except (TypeError, ValueError) as error:
            raise ValueError('A base de dados está ilegível. Nenhum registo foi alterado.') from error
        migrated = migrate(stored) if isinstance(stored, dict) and stored.get('version') != VERSION else stored
        state = validate_state(migrated)
        if migrated is not stored:
            updated = _now()
            db.execute('UPDATE app_state SET revision=?, document=?, updated_at=? WHERE id=1',
                       (revision + 1, json.dumps(state, ensure_ascii=False), updated))
            db.commit()
            revision += 1
    return revision, state, updated


def initialize_db(path: Path):
    """Cria a base de dados SQLite se não existir; valida sem alterar dados se já existir."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(db_connect(path)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS app_state '
                   '(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT)')
        cols = {row[1] for row in db.execute('PRAGMA table_info(app_state)').fetchall()}
        if 'updated_at' not in cols:
            db.execute('ALTER TABLE app_state ADD COLUMN updated_at TEXT')
        if db.execute('SELECT COUNT(*) FROM app_state').fetchone()[0] == 0:
            seed = {'version': VERSION, 'records': []}
            try:
                seed = validate_state(json.loads((WEB / 'seed.json').read_text(encoding='utf-8')))
            except FileNotFoundError:
                pass  # Sem ficheiro de arranque, começa-se com a estrutura vazia.
            db.execute('INSERT INTO app_state VALUES(1, 1, ?, ?)', (json.dumps(seed, ensure_ascii=False), _now()))
        else:
            read_state(path)  # Valida e converte registos sem corromper se algo estiver anómalo.
    return path


def write_state(path: Path, revision: int, state: dict) -> int:
    """Grava atomicamente o novo estado com controlo de concorrência optimista (revisão)."""
    with closing(db_connect(path)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        current = db.execute('SELECT revision FROM app_state WHERE id=1').fetchone()[0]
        if current != revision:
            raise ConflictError()
        db.execute('UPDATE app_state SET revision=?, document=?, updated_at=? WHERE id=1',
                   (current + 1, json.dumps(state, ensure_ascii=False), _now()))
        return current + 1


def _now() -> str:
    """Carimbo de data e hora actual em «dd/mm/yyyy, HH:MM:SS» — o formato do resto do sistema."""
    return dt.datetime.now().strftime('%d/%m/%Y, %H:%M:%S')


class ConflictError(Exception):
    """Exceção levantada quando os dados mudaram concorrentemente noutra janela ou sessão."""


# ----------------------------------------------------------------- erros ---

def append_log(data_dir: Path, level: str, message: str):
    """Registo de erros curto, com limite de tamanho; nunca contém dados de produção."""
    try:
        line = f'{_now()} {level.upper():<5} {message[:280]}\n'
        path = data_dir / 'contacarta.log'
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = path.read_text(encoding='utf-8')[-MAX_LOG_BYTES:] if path.exists() else ''
        path.write_text(previous + line, encoding='utf-8')
    except OSError:
        pass  # Sem log, a aplicação continua a funcionar.


# -------------------------------------------------------------- servidor ---

class Handler(BaseHTTPRequestHandler):
    server_version = 'ContaCarta/4.0'
    protocol_version = 'HTTP/1.1'

    # -------------------------------------------------------- utilidades ---

    def host(self) -> str:
        """Extrai o nome do host do cabeçalho Host, normalizando portas e notação IPv6."""
        value = (self.headers.get('Host') or '').strip()
        if value.startswith('['):
            return value.split(']', 1)[0][1:].lower()
        return value.rsplit(':', 1)[0].lower() if ':' in value else value.lower()

    def host_allowed(self) -> bool:
        """Verifica se o pedido vem de localhost ou de um domínio explicitamente autorizado."""
        name = self.host()
        if name in LOCAL_HOSTS or not name:
            return True
        return any(name == pattern or name.endswith('.' + pattern) for pattern in self.server.allow_hosts)

    def same_origin(self) -> bool:
        """Proteção contra CSRF: valida se o cabeçalho Origin ou Sec-Fetch-Site tem origem local."""
        origin = self.headers.get('Origin')
        if not origin or self.headers.get('Sec-Fetch-Site') == 'none':
            return True
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return False
        match = re.match(r'https?://([^/:]+)', origin)
        host = match.group(1).lower() if match else ''
        return host == self.host() or host in LOCAL_HOSTS or any(
            host == pattern or host.endswith('.' + pattern) for pattern in self.server.allow_hosts)

    def do_HEAD(self):
        """Responde a pedidos HEAD com os mesmos cabeçalhos do GET mas sem corpo."""
        self._head = True
        try:
            self.do_GET()
        finally:
            self._head = False

    def send_data(self, status: int, data, content_type: str = 'application/json; charset=utf-8', extra: dict | None = None):
        """Envia resposta HTTP com cabeçalhos padrão de segurança, tipo MIME e no-cache."""
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode('utf-8')
        elif isinstance(data, str):
            data = data.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if getattr(self, '_head', False):
            return
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # O navegador fechou o pedido a meio; não há nada a recuperar

    def drain(self, length: int, limit: int = 25_000_000):
        """Despreza um corpo grande para a resposta não se perder pelo caminho."""
        if length > limit:
            self.close_connection = True
            return
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
        self._body_read = True

    def fail(self, status: int, message: str, level: str | None = 'warn'):
        """Envia resposta de erro em formato JSON e regista no log do servidor."""
        if not getattr(self, '_body_read', False):
            self.close_connection = True  # corpo por ler: a ligação não presta para mais nada
        if level:
            append_log(self.server.data_dir, level, f'{status} {self.command} {urlsplit(self.path).path} — {message}')
        self.send_data(status, {'error': message})

    def error(self, exception, context):
        """Mensagem para o ecrã (clara) e detalhe para o ficheiro de registo."""
        if isinstance(exception, ValueError):
            return self.fail(400, str(exception))
        append_log(self.server.data_dir, 'error', f'{context}: {type(exception).__name__}: {exception}')
        self.fail(500, 'Não foi possível concluir a operação. Nenhum registo foi alterado; tenta outra vez.', level=None)

    # ------------------------------------------------------------- GET ---

    def do_GET(self):
        """Processa pedidos GET: estado atual da base (/api/state), configuração (/config.js) ou ficheiros estáticos."""
        if not self.host_allowed():
            return self.fail(403, 'Esta aplicação só aceita acesso a partir deste computador ou do endereço autorizado.')
        path = unquote(urlsplit(self.path).path)
        if path == '/api/state':
            try:
                revision, state, updated = read_state(self.server.db_path)
                return self.send_data(200, {'revision': revision, 'state': state, 'savedAt': updated,
                                            'storage': 'sqlite', 'fileName': self.server.db_path.name})
            except Exception as error:  # noqa: BLE001 - o servidor nunca cai por causa de um pedido
                return self.error(error, 'Leitura do estado')
        if path == '/config.js':
            return self.send_data(200, 'window.CONTACARTA_CONFIG = {storage: "sqlite"};', 'application/javascript; charset=utf-8')
        return self.serve_file(path)

    def serve_file(self, path: str):
        """Entrega ficheiros estáticos da pasta app/ com verificação rigorosa contra path traversal."""
        relative = 'index.html' if path in ('/', '') else path.lstrip('/')
        target = (self.server.web / relative).resolve()
        if self.server.web.resolve() not in target.parents or not target.is_file():
            return self.fail(404, 'Não encontrámos essa página. Abre o endereço principal da aplicação.')
        try:
            body = target.read_bytes()
        except OSError:
            return self.error(OSError('leitura interrompida'), f'Leitura de {target.name}')
        mime = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        if target.suffix in ('.html', '.css', '.js', '.json', '.svg'):
            mime += '; charset=utf-8'
        headers = {'Content-Disposition': 'inline'} if target.suffix == '.pdf' else None
        return self.send_data(200, body, mime, headers)

    # ------------------------------------------------------------- PUT ---

    def do_PUT(self):
        """Atualiza atomicamente o estado dos registos no SQLite (/api/state) após validação rigorosa."""
        if not self.host_allowed():
            return self.fail(403, 'Guardação recusada: só este computador pode alterar os registos.')
        if not self.same_origin():
            return self.fail(403, 'Guardação recusada: o pedido não veio desta aplicação.')
        if urlsplit(self.path).path != '/api/state':
            return self.fail(404, 'Não encontrámos o destino pedido.')
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return self.fail(400, 'Não conseguimos saber o tamanho do ficheiro enviado.')
        if length <= 0:
            return self.fail(400, 'Recebeu-se um pedido vazio. Tenta guardar outra vez.')
        if length > MAX_BODY:
            self.drain(length)  # ler tudo antes de responder: a mensagem chega ao navegador
            return self.fail(413, f'A cópia é grande de mais (limite de {MAX_BODY // 1_000_000} MB). Exporta menos registos.')
        # o tipo declarado pode vir errado (extensões do navegador); o que vale é o conteúdo
        try:
            raw = self.rfile.read(length).decode('utf-8')
            self._body_read = True
            payload = json.loads(raw)
        except (UnicodeDecodeError, ValueError):
            return self.fail(415, 'A cópia tem de estar em formato JSON.')
        try:
            if not isinstance(payload, dict) or not isinstance(payload.get('revision'), int) or isinstance(payload.get('revision'), bool):
                raise ValueError('O pedido de gravação não traz a revisão dos dados.')
            state = validate_state(payload.get('state'))
            revision = write_state(self.server.db_path, payload['revision'], state)
            return self.send_data(200, {'revision': revision})
        except ConflictError:
            return self.fail(409, 'Outra janela guardou registos entretanto. Recarrega a página para ver os dados mais recentes.')
        except Exception as error:  # noqa: BLE001
            return self.error(error, 'Gravação do estado')

    # ------------------------------------------------------- POST /log ---

    def do_POST(self):
        """Recebe relatórios de diagnóstico e erros do cliente (/api/log) para auditoria interna."""
        if not self.host_allowed() or not self.same_origin():
            return self.fail(403, 'Pedido recusado.')
        if urlsplit(self.path).path != '/api/log':
            return self.fail(404, 'Não encontrámos o destino pedido.')
        try:
            length = min(int(self.headers.get('Content-Length') or 0), 4096)
            body = self.rfile.read(length)
            self._body_read = True
            payload = json.loads(body.decode('utf-8'))
            message = re.sub(r'\s+', ' ', str(payload.get('message', '')))[:280]
            if not message:
                raise ValueError('mensagem vazia')
            append_log(self.server.data_dir, 'client', message)
            return self.send_data(204, b'', 'text/plain; charset=utf-8')
        except Exception:  # noqa: BLE001 - o canal de diagnóstico não pode criar novos problemas
            return self.send_data(400, b'', 'text/plain; charset=utf-8')

    def log_message(self, format, *args):  # sem acessos no terminal: só erros
        """Silencia acessos rotineiros no terminal; os erros vão para dados/contacarta.log."""


# ------------------------------------------------------------------ main ---

def main(argv=None):
    """Ponto de entrada: processa parâmetros da linha de comandos, inicializa SQLite e executa o servidor."""
    parser = argparse.ArgumentParser(description='Conta Carta — registo de produção de cartas de condução (INATRO, IP)')
    parser.add_argument('--port', type=int, default=8000, help='porta de escuta (por omissão: 8000)')
    parser.add_argument('--host', default='127.0.0.1', help='endereço de escuta; usa 0.0.0.0 para aceder a partir da rede')
    parser.add_argument('--allow-host', action='append', default=[], metavar='DOMÍNIO',
                        help='autoriza ainda pedidos para este domínio ou subdomínios (repetível)')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'dados', help='pasta onde ficam os dados e o registo de erros')
    parser.add_argument('--no-browser', action='store_true', help='não abre o navegador automaticamente')
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 2
    if not 1 <= args.port <= 65535:
        print('A porta tem de estar entre 1 e 65535. Exemplo: python server.py --port 8001', file=sys.stderr)
        return 2

    data_dir = args.data_dir.resolve()
    db_path = data_dir / 'contacarta.sqlite3'
    if not db_path.exists() and (data_dir / 'cartas.sqlite3').exists():
        db_path = data_dir / 'cartas.sqlite3'  # instalações antigas continuam a ser lidas daqui
    try:
        initialize_db(db_path)
    except ValueError as error:
        print(f'Não foi possível abrir os dados: {error}', file=sys.stderr)
        print('Os teus registos continuam no ficheiro original. Recupera uma cópia exportada ou fala com o técnico.', file=sys.stderr)
        append_log(data_dir, 'error', f'arranque: {error}')
        return 1
    except OSError as error:
        print(f'Não foi possível criar a pasta dos dados em {data_dir}: {error}', file=sys.stderr)
        print('Escolhe outra pasta com: python server.py --data-dir "C:\\Conta Carta"', file=sys.stderr)
        return 1

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as error:
        print(f'A porta {args.port} está ocupada ({error.strerror or "indisponível"}).', file=sys.stderr)
        print('Abre a aplicação noutra porta: python server.py --port 8001', file=sys.stderr)
        append_log(data_dir, 'error', f'porta {args.port} indisponível: {error}')
        return 1

    server.db_path, server.data_dir, server.web = db_path, data_dir, WEB
    server.allow_hosts = [pattern.lower().lstrip('.') for pattern in args.allow_host if pattern.strip()]

    shown = 'localhost' if args.host in ('127.0.0.1', '0.0.0.0', '::1') else args.host
    print('Conta Carta · registo de produção de cartas — INATRO, IP')
    print(f'  Abrir no navegador: http://{shown}:{args.port}')
    print(f'  Dados: {db_path}')
    print(f'  Registo de erros: {data_dir / "contacarta.log"}')
    print('  Mantém esta janela aberta. Para fechar: Ctrl+C')
    if getattr(sys, 'frozen', False) and not args.no_browser:
        import threading
        import webbrowser
        threading.Timer(0.5, lambda: webbrowser.open(f'http://{shown}:{args.port}')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print('Encerrado. Os registos ficam guardados.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
