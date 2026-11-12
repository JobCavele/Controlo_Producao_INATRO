const seed=require('./tests/fixtures/synthetic.json');
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,addEventListener(){},classList:{toggle(){}}});return nodes.get(id)};
for(const [id,value] of Object.entries({dashboardView:'period',dashboardStart:'2026-10-01',dashboardEnd:'2026-11-04',dashboardSource:'report',machineMetric:'both',periodA:'oct',periodB:'nov'}))el(id).value=value;
const context={CartasCore:require('./dist/data-core.js'),window:{CARTAS_CONFIG:{storage:'sqlite'}},document:{getElementById:el,querySelector:el,querySelectorAll:()=>[],addEventListener(){}},Intl,console};vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/initialize\(\);\s*$/,''),context);
vm.runInContext('state='+fs.readFileSync('tests/fixtures/synthetic.json','utf8')+';renderComparison()',context);
assert.match(el('machineChart').innerHTML,/<svg/);assert.match(el('machineChart').innerHTML,/<rect/);assert.match(el('machineLegend').innerHTML,/#147d65/);assert.match(el('machineLegend').innerHTML,/#c43d3d/);assert.match(el('machineChart').innerHTML,/Produzidas/);assert.match(el('machineLegend').innerHTML,/Reprovadas/);assert.match(el('kpis').innerHTML,/840/);
el('machineMetric').value='rejected';vm.runInContext('renderComparison()',context);assert.doesNotMatch(el('machineChart').innerHTML,/Produzidas/);
el('dashboardStart').value='2027-01-01';el('dashboardEnd').value='2027-01-31';vm.runInContext('renderComparison()',context);assert.match(el('machineChart').innerHTML,/Não existem registos/);
console.log('Dashboard: duas categorias, filtro individual, totais, intervalo vazio e comparação verificados.');


const sample=(produced,approved,rejected)=>({name:'Teste',start:'2026-11-01',end:'2026-11-01',values:[{p:0,r:0},{p:0,r:0},{p:produced,r:0},{p:approved,r:null},{p:null,r:rejected}]});
context.sample=sample;
assert.equal(vm.runInContext('qualityMetrics(sample(100,95,5)).approval',context),95);
assert.equal(vm.runInContext('qualityMetrics(sample(100,95,5)).rejection',context),5);
assert.equal(vm.runInContext('qualityMetrics(sample(100,95,5)).total',context),100);
assert.match(vm.runInContext("qualityPanel(sample(100,95,5),'Teste')",context),/95,0%/);
assert.match(vm.runInContext("qualityPanel(sample(0,0,0),'Teste')",context),/Nenhuma carta produzida/);
assert.match(vm.runInContext("qualityPanel(sample(100,null,5),'Teste')",context),/Dados insuficientes/);
assert.match(vm.runInContext("qualityPanel(sample(100,90,5),'Teste')",context),/Conferir dados/);
assert.doesNotMatch(vm.runInContext("qualityPanel(sample(100,95,5),'Teste')",context),/Conferir dados|pendente/i);
assert.match(vm.runInContext("qualityPanel(sample(100,97,3),'B',sample(100,95,5))",context),/\+2 p.p./);
assert.match(vm.runInContext("qualityPanel(sample(100,0,100),'Teste')",context),/100,0%/);
console.log('QC: taxas, zero, dados em falta, divergências e variação em pontos percentuais verificados.');

const core=require('./dist/data-core.js');
const record=structuredClone(seed.records[0]);record.machineQC=[{approved:2000,rejected:152},{approved:8800,rejected:228}];
core.validate({version:2,records:[record]});
const grouped=core.generate({version:2,records:[record]},'custom',record.start,'report',record.end);
assert.equal(grouped.machineQC[0].approved,2000);
assert.equal(grouped.machineQC[1].rejected,228);
assert.equal(core.generate(seed,'custom','2026-10-01','report','2026-11-04').machineQC[0].approved,null);
const bad=structuredClone(record);bad.machineQC[0].approved=-1;assert.throws(()=>core.validate({version:2,records:[bad]}));
context.machineRecord=record;el('machineMetric').value='both';vm.runInContext('barChart(machineRecord,null,false)',context);assert.equal((el('machineChart').innerHTML.match(/<rect /g)||[]).length,6);
assert.match(el('machineChart').innerHTML,/2.?000/);
assert.equal(vm.runInContext('qualityMetrics(sample(200,95,5)).approval',context),47.5);
console.log('QC por máquina: três colunas, agregação, históricos e validação verificados.');

for(const [id,value] of Object.entries({v0p:'100',v0r:'5',v1p:'200',v1r:'10'}))el(id).value=value;
vm.runInContext('updateCalculatedSummary()',context);
assert.match(el('calculatedSummary').innerHTML,/285/);
el('v0r').value='101';vm.runInContext('updateCalculatedSummary()',context);assert.match(el('formError').textContent,/ultrapassar/);
console.log('Resumo do formulário e rejeição superior à produção verificados.');

const dailyRecord={...structuredClone(seed.records[0]),...core.calculateMachines([{p:100,r:5},{p:200,r:10}]),id:'new-daily',kind:'daily',name:'Novo dia',start:'2026-11-12',end:'2026-11-12'};
context.dailyRecord=dailyRecord;
vm.runInContext('state={version:2,records:[...state.records,dailyRecord]};configureDashboard();renderComparison()',context);
assert.equal(el('dashboardSource').value,'daily');assert.equal(el('dashboardEnd').value,'2026-11-12');assert.match(el('kpis').innerHTML,/300/);assert.match(el('machineChart').innerHTML,/Aprovadas/);
vm.runInContext("configureDashboard({...dailyRecord,start:'2026-11-13',end:'2026-11-13'})",context);assert.equal(el('dashboardStart').value,'2026-11-13');assert.equal(el('reportSource').value,'daily');
console.log('Regressão: arranque escolhe registos diários e datas acompanham o registo guardado.');
// Exercise the actual submit handler using in-memory persistence; no real database changes.
context.crypto={randomUUID:()=> 'saved-through-form'};el('recordDialog').close=()=>{};
context.setTimeout=()=>0;context.clearTimeout=()=>{};el('toast').style={};
for(const [id,value] of Object.entries({recordType:'daily',recordName:'Novo registo',recordNotes:'',startDate:'2026-11-14',v0p:'100',v0r:'5',v1p:'200',v1r:'10'}))el(id).value=value;
vm.runInContext("ready=true;editing=null;persist=async next=>{state=next;return true};render=()=>renderComparison();showTab=tab=>{currentTab=tab}",context);
Promise.resolve(el('recordForm').onsubmit({preventDefault(){}})).then(()=>{
 assert.equal(el('dashboardSource').value,'daily');assert.equal(el('dashboardStart').value,'2026-11-14');assert.equal(el('dashboardEnd').value,'2026-11-14');assert.match(el('kpis').innerHTML,/300/);assert.match(el('qualityChart').innerHTML,/285/);assert.equal(vm.runInContext('currentTab',context),'overview');
 assert.equal(vm.runInContext("state.records.find(r=>r.id==='saved-through-form').values[3].p",context),285);
 console.log('Fluxo completo do formulário: guardar, calcular e mostrar na visão geral verificado.');
}).catch(error=>{console.error(error);process.exitCode=1});

const validBar=vm.runInContext('qualityBar(qualityMetrics(sample(100,95,5)))',context);
assert.match(validBar,/quality-stacked-bar/);assert.match(validBar,/width:95%/);assert.match(validBar,/width:5%/);
assert.match(vm.runInContext('qualityBar(qualityMetrics(sample(100,100,0)))',context),/width:100%/);
assert.match(vm.runInContext('qualityBar(qualityMetrics(sample(100,0,100)))',context),/width:100%/);
assert.match(vm.runInContext('qualityBar(qualityMetrics(sample(0,0,0)))',context),/Sem produção/);
assert.match(vm.runInContext('qualityBar(qualityMetrics(sample(null,null,null)))',context),/quantidades em falta/);
assert.match(vm.runInContext('qualityBar(qualityMetrics(sample(100,95,10)))',context),/quality-bar-divergent/);
assert.doesNotMatch(vm.runInContext('qualityBar(qualityMetrics(sample(100,95,10)))',context),/quality-stacked-bar/);
console.log('Barra global: segmentos, 0%, 100%, dados incompletos e divergências verificados.');

for(const [id,value] of Object.entries({v0p:'100',v0r:'',v1p:'',v1r:''}))el(id).value=value;
const blankResult=vm.runInContext('readMachineCalculation()',context);
assert.equal(blankResult.values[2].p,100);assert.equal(blankResult.values[2].r,0);assert.equal(blankResult.values[3].p,100);assert.equal(blankResult.machineQC[1].approved,0);
for(const id of ['v0p','v0r','v1p','v1r'])el(id).value='';
assert.equal(vm.runInContext('readMachineCalculation().values[2].p',context),0);
console.log('Campos em branco: máquina sem produção e rejeições vazias assumem zero.');

const compactTable=vm.runInContext('matrix(dailyRecord)',context);
assert.equal((compactTable.match(/<table>/g)||[]).length,1);
assert.equal((compactTable.match(/<tr/g)||[]).length,4);
assert.match(compactTable,/>Total</);assert.match(compactTable,/285/);
assert.doesNotMatch(compactTable,/Total de cartas aprovadas|Total de cartas reprovadas/);
console.log('Relatórios: tabela única com duas máquinas e uma linha Total verificada.');

const historicalTable=vm.runInContext('matrix('+JSON.stringify(seed.records[0])+')',context);
assert.doesNotMatch(historicalTable,/>—</);
const historicalRows=vm.runInContext('reportTableRows('+JSON.stringify(seed.records[0])+')',context);
assert.equal(historicalRows[0].approved,116);assert.equal(historicalRows[0].rejected,4);assert.equal(historicalRows[2].approved,580);
console.log('Relatórios históricos: campos vazios como zero, aprovadas calculadas e totais originais preservados.');

el('dashboardView').value='monthly';el('dashboardMonth').value='2026-11';vm.runInContext('updateDashboardView()',context);
assert.equal(el('dashboardStart').value,'2026-11-01');assert.equal(el('dashboardEnd').value,'2026-11-30');assert.equal(el('dashboardMonthLabel').hidden,false);assert.equal(el('dashboardStartLabel').hidden,true);
el('dashboardMonth').value='2024-02';vm.runInContext('updateDashboardView()',context);assert.equal(el('dashboardEnd').value,'2024-02-29');
el('dashboardView').value='period';vm.runInContext('updateDashboardView()',context);assert.equal(el('dashboardStartLabel').hidden,false);assert.equal(el('dashboardMonthLabel').hidden,true);assert.equal(el('dashboardStart').disabled,false);
console.log('Vista mensal: mês completo, ano bissexto e retorno ao período verificados.');


const csvGroup=core.generate({version:2,records:[dailyRecord]},'monthly','2026-11-01','daily');context.csvGroup=csvGroup;
const csvOutput=vm.runInContext('buildReportCSV(csvGroup)',context);
assert.ok(csvOutput.startsWith('\uFEFF'));assert.match(csvOutput, /"Produzidas";"Aprovadas";"Rejeitadas \/ reprovadas"/);assert.doesNotMatch(csvOutput,/Total de cartas aprovadas/);assert.match(csvOutput,/"Total";"300";"285";"15"/);
assert.equal(vm.runInContext('csvCell("=1+1")',context),'"\'=1+1"');
const uiHtml=fs.readFileSync('dist/index.html','utf8');
assert.doesNotMatch(uiHtml,/value="compare"|id="dailyChart"|id="machineQCInputs"/);
assert.ok(uiHtml.indexOf('id="machineChart"')<uiHtml.indexOf('id="machineLegend"'));
assert.match(uiHtml,/value="monthly"/);
console.log('CSV, estrutura da interface, legenda e remoção de controlos antigos verificados.');
