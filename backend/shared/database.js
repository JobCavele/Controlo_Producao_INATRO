const { DatabaseSync } = require('node:sqlite');
const path=require('node:path');const fs=require('node:fs');
const dir=path.resolve(__dirname,'../../dados');fs.mkdirSync(dir,{recursive:true});
const db=new DatabaseSync(process.env.CONTACARTA_DB || path.join(dir,'contacarta.sqlite3'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, type TEXT NOT NULL, batch_id TEXT, delegation TEXT, event_date TEXT NOT NULL, quantity INTEGER NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_operations_batch ON operations(batch_id,event_date);
CREATE INDEX IF NOT EXISTS idx_operations_date ON operations(event_date,type);
CREATE TABLE IF NOT EXISTS delegations (code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, province TEXT NOT NULL, lat REAL, lng REAL);
`);
if(!db.prepare('SELECT id FROM app_state WHERE id=1').get()){
 const seed=JSON.parse(fs.readFileSync(path.join(dir,'../app/seed.json'),'utf8'));
 db.prepare('INSERT INTO app_state(id,revision,document,updated_at) VALUES(1,1,?,?)').run(JSON.stringify(seed),new Date().toISOString());
}
module.exports=db;
