from contextlib import closing
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib import request, error

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cartas_server',ROOT/'server.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.data=Path(self.tmp.name)
        self.port=18764
        self.start()
        # A fresh installation must have no production records.
        fresh=json.loads(self.call('/api/state')[1])
        self.assertEqual(fresh['state'],{'version':2,'records':[]})
        fixture=json.loads((ROOT/'tests/fixtures/synthetic.json').read_text(encoding='utf-8'))
        self.assertEqual(self.call('/api/state',{'revision':fresh['revision'],'state':fixture})[0],200)

    def start(self):
        self.process=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--port',str(self.port),'--data-dir',str(self.data)],cwd=self.tmp.name,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.url=f'http://127.0.0.1:{self.port}'
        for _ in range(80):
            if self.process.poll() is not None:
                self.fail('Servidor não iniciou: '+self.process.stderr.read())
            try:
                self.call('/api/state');return
            except OSError:
                time.sleep(.05)
        self.fail('Tempo de arranque excedido.')

    def stop(self):
        self.process.terminate()
        self.process.communicate(timeout=5)

    def tearDown(self):
        if self.process.poll() is None:self.stop()
        self.tmp.cleanup()

    def call(self,path,body=None,headers=None):
        headers={'Content-Type':'application/json',**(headers or {})}
        req=request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method='PUT' if body is not None else 'GET')
        try:
            with request.urlopen(req,timeout=3) as r:return r.status,r.read(),r.headers
        except error.HTTPError as e:return e.code,e.read(),e.headers

    def test_data_survives_restart_and_conflicts(self):
        status,data,_=self.call('/api/state');self.assertEqual(status,200)
        original=json.loads(data);self.assertEqual(len(original['state']['records']),2)
        self.assertEqual(original['state']['records'][1]['values'][0]['p'],None)
        record=copy.deepcopy(original['state']['records'][0]);record.update(id='backfill',kind='daily',name='Dia anterior',start='2026-10-15',end='2026-10-15')
        body=copy.deepcopy(original);body['state']['records'].append(record)
        status,data,_=self.call('/api/state',body);self.assertEqual(status,200);new_revision=json.loads(data)['revision']
        self.assertEqual(self.call('/api/state',original)[0],409)
        self.stop();self.start()
        stored=json.loads(self.call('/api/state')[1]);self.assertEqual(stored['revision'],new_revision);self.assertEqual(stored['state'],body['state'])
        db=self.data/'cartas.sqlite3';self.assertTrue(db.is_file())
        with closing(sqlite3.connect(db)) as c, c:self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_machine_record_survives_restart(self):
        original=json.loads(self.call('/api/state')[1])
        record={'id':'machine-entry','kind':'daily','name':'Production entry','start':'2026-11-14','end':'2026-11-14','notes':'',
                'values':[{'p':100,'r':5},{'p':200,'r':10},{'p':300,'r':15},{'p':285,'r':None},{'p':None,'r':15}],
                'machineQC':[{'approved':95,'rejected':5},{'approved':190,'rejected':10}]}
        original['state']['records'].append(record)
        self.assertEqual(self.call('/api/state',original)[0],200)
        self.stop();self.start()
        stored=json.loads(self.call('/api/state')[1])
        self.assertEqual(stored['state']['records'][-1],record)

    def test_edit_delete_and_restore_backup(self):
        snapshot=json.loads(self.call('/api/state')[1])
        backup=json.loads(json.dumps(snapshot['state']))
        edited=copy.deepcopy(snapshot)
        edited['state']['records'][0]['notes']='Edited in isolated test'
        status,data,_=self.call('/api/state',edited)
        self.assertEqual(status,200)
        revision=json.loads(data)['revision']
        self.assertEqual(json.loads(self.call('/api/state')[1])['state']['records'][0]['notes'],'Edited in isolated test')
        deleted=copy.deepcopy(edited);deleted['revision']=revision
        deleted['state']['records'].pop()
        status,data,_=self.call('/api/state',deleted);self.assertEqual(status,200)
        self.assertEqual(len(json.loads(self.call('/api/state')[1])['state']['records']),1)
        restored={'revision':json.loads(data)['revision'],'state':backup}
        self.assertEqual(self.call('/api/state',restored)[0],200)
        self.assertEqual(json.loads(self.call('/api/state')[1])['state'],backup)

    def test_validation_and_server_boundaries(self):
        original=json.loads(self.call('/api/state')[1]);body=copy.deepcopy(original);body['state']['records'][0]['values'][0]['p']=-1
        self.assertEqual(self.call('/api/state',body)[0],400)
        body=copy.deepcopy(original);body['state']['records'][0]['values'][0]['p']=True
        self.assertEqual(self.call('/api/state',body)[0],400)
        self.assertEqual(self.call('/api/state',original,{'Origin':'https://unrelated.example'})[0],403)
        self.assertEqual(self.call('/api/state',original,{'Host':'unrelated.example'})[0],403)
        self.assertEqual(self.call('/api/state',original,{'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.call('/../server.py')[0],404)
        self.assertEqual(self.call('/dados/cartas.sqlite3')[0],404)
        self.assertEqual(json.loads(self.call('/api/state')[1]),original)
        self.assertIn(b"'sqlite'",self.call('/config.js')[1])
        self.assertEqual(self.call('/')[0],200)

    def test_invalid_existing_data_is_not_reset(self):
        self.stop();path=self.data/'cartas.sqlite3'
        with closing(sqlite3.connect(path)) as db, db:db.execute("UPDATE app_state SET document='invalid JSON'")
        with self.assertRaises(ValueError):module.initialize_db(path)
        with closing(sqlite3.connect(path)) as db, db:self.assertEqual(db.execute('SELECT document FROM app_state').fetchone()[0],'invalid JSON')

if __name__=='__main__':unittest.main()
