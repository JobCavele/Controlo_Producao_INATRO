const test=require('node:test');const assert=require('node:assert/strict');const os=require('node:os');const fs=require('node:fs');const path=require('node:path');
process.env.CONTACARTA_DB=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'inatro-ops-')),'test.sqlite3');
const server=require('../backend/server.js');
let base;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));});
async function request(route,method='GET',data){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:response.status,body:await response.json()};}
test('conservação das quantidades e despacho parcial',async()=>{
 const state=await request('/api/state');const lot={id:'batch-1',reference:'LT-001',delegation:'Matola',quantity:100,start:'2026-11-01',stages:{},notes:'',closed:false};for(const stage of ['personalizacao','impressao','qualidade','despacho'])lot.stages[stage]={stage,state:'pendente',quantity:0,updated:'',note:''};
 state.body.state.lots.push(lot);assert.equal((await request('/api/state','PUT',{revision:state.body.revision,state:state.body.state})).status,200);
 const op=async(type,quantity,extra={})=>request('/api/operations','POST',{type,quantity,date:'2026-11-10',batchId:'batch-1',...extra});
 assert.equal((await op('printed',40,{machine:'Máquina 1'})).status,422);
 assert.equal((await op('personalized',100)).status,201);
 assert.equal((await op('printed',40,{machine:'Máquina 1'})).status,201);
 assert.equal((await op('qc_approved',30)).status,201);
 assert.equal((await op('transfer',30)).status,201);
 assert.equal((await op('dispatch',20,{reference:'GUIA-01'})).status,201);
 assert.equal((await op('dispatch',11,{reference:'GUIA-02'})).status,422);
 let d=(await request('/api/operations')).body.batches[0];assert.equal(d.toPrint,60);assert.equal(d.toQC,10);assert.equal(d.toDispatch,10);assert.equal(d.dispatch,20);
 assert.equal((await op('qc_rejected',10,{reason:'material-riscos'})).status,201);
 assert.equal((await op('printed',70,{machine:'Máquina 2'})).status,201);
 d=(await request('/api/operations')).body.batches[0];assert.equal(d.toPrint,0);assert.equal(d.toQC,70);
 assert.equal((await op('qc_approved',70)).status,201);
 assert.equal((await op('transfer',70)).status,201);
 assert.equal((await op('dispatch',80,{reference:'GUIA-03'})).status,201);
 d=(await request('/api/operations')).body.batches[0];assert.equal(d.dispatch,100);assert.equal(d.toDispatch,0);
 assert.equal((await op('dispatch',1,{reference:'GUIA-04'})).status,422);
});
test('stock não aceita saídas sem entrada nem intervalos repetidos',async()=>{
 const op=(type,quantity,extra={})=>request('/api/operations','POST',{type,quantity,date:'2026-11-10',reference:'REF001',material:'Cartões em branco',...extra});
 assert.equal((await op('stock_out',5)).status,422);
 assert.equal((await op('stock_in',10,{serialStart:'0001',serialEnd:'0010'})).status,201);
 assert.equal((await op('stock_in',5,{serialStart:'0008',serialEnd:'0012'})).status,422);
 assert.equal((await op('stock_out',5,{serialStart:'0001',serialEnd:'0005'})).status,201);
 assert.equal((await op('stock_out',6)).status,422);
});
