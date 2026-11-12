const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('../dist/data-core.js');
const seed=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/synthetic.json'),'utf8'));
C.validate(seed);
assert.deepEqual(seed.records[0].values,[{"p": 120, "r": 4}, {"p": 480, "r": 6}, {"p": 600, "r": 10}, {"p": 580, "r": null}, {"p": null, "r": 12}]);
assert.deepEqual(seed.records[1].values,[{"p": null, "r": null}, {"p": 240, "r": 8}, {"p": 240, "r": 8}, {"p": 220, "r": null}, {"p": null, "r": 4}]);
assert.equal(C.days(seed.records[0]),31);assert.equal(C.days(seed.records[1]),4);
assert.deepEqual(C.range('weekly','2026-11-01'),{start:'2026-10-26',end:'2026-11-01'});
assert.deepEqual(C.range('weekly','2026-12-31'),{start:'2026-12-28',end:'2027-01-03'});
assert.deepEqual(C.range('monthly','2024-02-20'),{start:'2024-02-01',end:'2024-02-29'});
assert.equal(C.validDate('2026-02-29'),false);
const day=(id,d,p)=>({id,name:id,kind:'daily',start:d,end:d,values:[{p,r:0},{p:0,r:0},{p,r:0},{p,r:null},{p:null,r:0}]});
const state={version:2,records:[...seed.records,day('a','2026-10-01',100),day('b','2026-10-02',200),day('zero','2026-10-03',0),day('nov-day','2026-11-01',900)]};
C.validate(state);
let report=C.generate(state,'monthly','2026-10-12','daily');
assert.equal(report.values[2].p,300);assert.equal(report.covered,3);assert.equal(report.missing.length,28);assert.equal(report.complete,false);
assert.equal(report.values[3].r,null);assert.equal(report.values[1].p,0);
report=C.generate(state,'monthly','2026-10-12','report');assert.equal(report.values[2].p,600);assert.equal(report.complete,true);assert.equal(report.selected.length,1);
report=C.generate(state,'weekly','2026-10-02','report');assert.equal(report.selected.length,0);assert.equal(report.excluded.length,1);assert.equal(report.values[2].p,null);
report=C.generate(state,'monthly','2026-11-12','report');assert.equal(report.covered,4);assert.equal(report.missing.length,26);assert.equal(report.values[0].p,null);
report=C.generate(state,'daily','2026-10-01','daily');assert.equal(report.values[2].p,100);assert.equal(report.complete,true);
report=C.generate(state,'daily','2026-10-04','daily');assert.equal(report.values[2].p,null);assert.equal(report.covered,0);
const overlap=JSON.parse(JSON.stringify(state));overlap.records.push({...seed.records[0],id:'overlap',start:'2026-10-05',end:'2026-10-10'});
report=C.generate(overlap,'monthly','2026-10-12','report');assert.equal(report.overlaps.length,6);assert.equal(report.values[2].p,null);
const duplicate=JSON.parse(JSON.stringify(state));duplicate.records.push(day('dup','2026-10-01',1));assert.throws(()=>C.validate(duplicate),/Já existe/);
const negative=JSON.parse(JSON.stringify(state));negative.records[0].values[0].p=-1;assert.throws(()=>C.validate(negative));
const missing=JSON.parse(JSON.stringify(state));missing.records.find(r=>r.id==='b').values[2].p=null;report=C.generate(missing,'monthly','2026-10-12','daily');assert.equal(report.values[2].p,null);
assert.match(C.findings(seed.records[0]).join(' '),/592/);assert.match(C.findings(seed.records[1]).join(' '),/224/);
console.log('Cálculos verificados: dados fictícios, datas, cobertura, zero versus desconhecido, não duplicação, sobreposições e validação.');

// Production entry: only machine quantities are entered; everything else is derived.
const calculated=C.calculateMachines([{p:100,r:5},{p:200,r:10}]);
assert.deepEqual(calculated.machineQC,[{approved:95,rejected:5},{approved:190,rejected:10}]);
assert.deepEqual(calculated.values,[{p:100,r:5},{p:200,r:10},{p:300,r:15},{p:285,r:null},{p:null,r:15}]);
assert.deepEqual(C.calculateMachines([{p:0,r:0},{p:0,r:0}]).machineQC,[{approved:0,rejected:0},{approved:0,rejected:0}]);
assert.equal(C.calculateMachines([{p:100,r:null},{p:200,r:10}]).values[3].p,null);
assert.equal(C.calculateMachines([{p:null,r:null},{p:200,r:10}]).values[2].p,null);
assert.throws(()=>C.calculateMachines([{p:10,r:11},{p:0,r:0}]),/ultrapassar/);
assert.throws(()=>C.calculateMachines([{p:10,r:-1},{p:0,r:0}]));
assert.throws(()=>C.calculateMachines([{p:10.5,r:1},{p:0,r:0}]));
C.validate({version:2,records:[{...seed.records[0],...calculated}]});
console.log('Registo simplificado: aprovadas, totais, zero, campos em falta e rejeições inválidas verificados.');

assert.deepEqual(JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../dist/seed.json'),'utf8')),{version:2,records:[]});

