'use strict';
const $=id=>document.getElementById(id),{rows,days,validate,validDate,range,dateList,generate,findings}=CartasCore,KEY='cartas-painel-v2';
const fmt=n=>n===null||n===undefined?'—':new Intl.NumberFormat('pt-PT',{maximumFractionDigits:Number.isInteger(n)?0:1}).format(n),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s.split('-').reverse().join('.'),scaled=(n,d)=>n===null?null:n/d;
let state={version:2,records:[]},revision=0,mode='total',currentTab='overview',editing=null,confirmAction=null,ready=false,saving=false,generated=null;
const onServer=window.CARTAS_CONFIG.storage==='sqlite';
function toast(t){$('toast').textContent=t;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',6000)}
async function persist(next){
  if(!ready||saving)return false;
  saving=true;
  try{
    validate(next);
    if(onServer){const res=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,state:next})});const body=await res.json();if(!res.ok)throw Error(body.error||'Não foi possível guardar.');revision=body.revision;}
    else{const current=localStorage.getItem(KEY);if(current!==browserSnapshot)throw Error('Os dados mudaram noutra janela. Exporta uma cópia antes de recarregar.');localStorage.setItem(KEY,JSON.stringify(next));browserSnapshot=JSON.stringify(next);}
    state=next;return true;
  }catch(e){toast(e.message);$('formError').textContent=e.message;return false}finally{saving=false}
}
let browserSnapshot=null;
async function initialize(){
  try{
    if(onServer){const res=await fetch('/api/state',{cache:'no-store'});if(!res.ok)throw Error('Não foi possível abrir a base de dados. Mantém o servidor aberto e recarrega.');const body=await res.json();state=validate(body.state);revision=body.revision;}
    else{browserSnapshot=localStorage.getItem(KEY);if(browserSnapshot)state=validate(JSON.parse(browserSnapshot));else{
      const response=await fetch('seed.json');if(!response.ok)throw Error('Não foi possível carregar os relatórios iniciais.');state=validate(await response.json());
      const old=localStorage.getItem('cartas-painel-v1');if(old){const previous=JSON.parse(old);if(previous.version===1&&previous.demo===false&&Array.isArray(previous.records)){state.records=[...previous.records.filter(r=>!state.records.some(x=>x.id===r.id||(x.kind===r.kind&&x.start===r.start&&x.end===r.end))),...state.records];validate(state);}}
      localStorage.setItem(KEY,JSON.stringify(state));browserSnapshot=JSON.stringify(state);
    }}
    ready=true;$('storageStatus').textContent=onServer?'● Guardado em SQLite · neste computador':'● Guardado neste navegador';$('storageHelp').textContent=onServer?'Os dados ficam no ficheiro dados/cartas.sqlite3 e permanecem ao reiniciar o programa. Exporta uma cópia regularmente.':'Nesta página online, os dados ficam neste navegador. Usa a versão para localhost para guardar em SQLite.';
    configureDashboard();
    render();
  }catch(e){$('loadError').hidden=false;$('loadError').textContent=e.message+' Os dados existentes não foram substituídos.';$('storageStatus').textContent='Armazenamento indisponível';document.querySelectorAll('main button,.side-note button').forEach(b=>b.disabled=true)}
}
function configureDashboard(record=null){
  const source=record?.kind||(state.records.some(r=>r.kind==='daily')?'daily':'report');
  const records=state.records.filter(r=>r.kind===source).sort((a,b)=>a.start.localeCompare(b.start));
  $('dashboardView').value='period';$('dashboardSource').value=source;
  $('dashboardStart').value=record?.start||records[0]?.start||today();
  $('dashboardEnd').value=record?.end||records.reduce((end,r)=>r.end>end?r.end:end,records[0]?.end||today());
  $('reportSource').value=source;$('reportAnchor').value=record?.start||records.at(-1)?.start||today();
  $('dailyMonth').value=(record?.start||state.records.filter(r=>r.kind==='daily').sort((a,b)=>a.start.localeCompare(b.start)).at(-1)?.start||today()).slice(0,7);
  $('dashboardMonth').value=$('dashboardStart').value.slice(0,7);
  syncDashboardControls();
}
const reports=()=>state.records.filter(r=>r.kind==='report').sort((a,b)=>a.start.localeCompare(b.start));
function showTab(tab){currentTab=tab;document.querySelectorAll('.tab-panel').forEach(x=>x.hidden=x.id!==tab);document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));const t={overview:['Visão geral','Produção de cartas de condução','Acompanhamento da produção, rejeições e controlo de qualidade.'],reports:['Relatórios','O histórico da produção','Consulta e actualiza os relatórios de cada período.'],daily:['Registo diário','Um dia de cada vez','Regista a produção e acompanha a sua evolução.']}[tab];$('breadcrumb').textContent=t[0];$('pageTitle').textContent=t[1];$('pageSubtitle').textContent=t[2]}
function render(){$('reportCount').textContent=reports().length;renderComparison();renderReports();renderDaily();renderGenerated()}
function empty(text){return `<div class="empty"><strong>Sem resultados para esta selecção</strong>${text}</div>`}
function renderComparison(){$('dashboardIssues').hidden=true;$('dashboardIssues').innerHTML='';renderPeriodDashboard()}
function barChart(a,b,av){
  const keys=$('machineMetric').value==='both'?['p','approved','rejected']:[$('machineMetric').value],periods=b?[a,b]:[a];
  const value=(r,i,k)=>scaled(k==='p'?r.values[i].p:(r.machineQC?.[i]?.[k]??null),av?days(r):1);
  const peak=Math.max(1,...periods.flatMap(r=>[0,1].flatMap(i=>keys.map(k=>value(r,i,k)??0))));
  const magnitude=10**Math.floor(Math.log10(peak/4)),step=Math.ceil(peak/4/magnitude)*magnitude,max=step*4;
  const colors={p:'#375f83',approved:'#147d65',rejected:'#c43d3d'},baseline=242,plotHeight=190;
  let svg=`<svg viewBox="0 0 640 320" role="img" aria-labelledby="machineChartTitle machineChartDesc"><title id="machineChartTitle">Produção e qualidade por máquina</title><desc id="machineChartDesc">Colunas agrupadas, em ${av?'média diária':'quantidade de cartas'}. ${periods.map(r=>esc(r.name)).join('; ')}. Valores não informados são identificados como N/I.</desc><text x="62" y="22" font-size="11" fill="#647c6d">${av?'Cartas / dia':'Quantidade de cartas'}</text>`;
  for(let i=0;i<=4;i++){const y=baseline-i*plotHeight/4;svg+=`<line x1="62" y1="${y}" x2="622" y2="${y}" stroke="#e7eceb" ${i?'stroke-dasharray="3 4"':''}/><text x="52" y="${y+4}" text-anchor="end" font-size="11" fill="#718078">${fmt(step*i)}</text>`}
  [0,1].forEach(machine=>{
    const center=202+machine*280,periodWidth=b?112:160;
    periods.forEach((r,j)=>{
      const groupCenter=center+(b?(j-.5)*periodWidth:0),barWidth=keys.length===3?(b?23:38):44,gap=7;
      keys.forEach((k,index)=>{
        const n=value(r,machine,k),h=n===null?0:n/max*plotHeight,x=groupCenter+(index-(keys.length-1)/2)*(barWidth+gap)-barWidth/2,label=k==='p'?'Produzidas':k==='approved'?'Aprovadas':'Reprovadas';
        svg+=`<g><title>Máquina ${machine+1} · ${esc(r.name)} · ${label}: ${n===null?'Não informado':fmt(n)}</title>${n===null?`<text x="${x+barWidth/2}" y="${baseline-9}" text-anchor="middle" font-size="11" fill="#718078">N/I</text>`:`<rect x="${x}" y="${baseline-h}" width="${barWidth}" height="${h}" rx="3" fill="${colors[k]}"/><text x="${x+barWidth/2}" y="${baseline-h-9}" text-anchor="middle" font-size="${b?10:12}" font-weight="600" fill="#314e41">${fmt(n)}</text>`}</g>`;
      });
      if(b)svg+=`<text x="${groupCenter}" y="264" text-anchor="middle" font-size="11" fill="#6a8073">Período ${j?'B':'A'}</text>`;
    });
    svg+=`<text x="${center}" y="${b?293:277}" text-anchor="middle" font-size="13" font-weight="600" fill="#385847">Máquina ${machine+1}</text>`;
  });
  $('machineChart').innerHTML=svg+'</svg>';
  $('machineLegend').innerHTML=keys.map(k=>`<span><i style="background:${colors[k]}"></i> ${k==='p'?'Produzidas':k==='approved'?'Aprovadas':'Reprovadas'}</span>`).join('');
  $('machineSubtitle').textContent=`${av?'Média por dia de calendário':'Totais do período'} · colunas na mesma escala · N/I = não informado`;
}
function qualityMetrics(r){
  const approved=r.values[3].p,rejected=r.values[4].r;
  const total=approved===null||rejected===null?null:approved+rejected;
  const produced=r.values[2].p;
  return {approved,rejected,total,produced,approval:produced>0&&approved!==null?approved/produced*100:null,rejection:produced>0&&rejected!==null?rejected/produced*100:null};
}
function qualityBar(q){
  const percent=n=>new Intl.NumberFormat('pt-PT',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n)+'%';
  if(q.produced===null||q.approved===null||q.rejected===null)return '<div class="quality-bar-status" role="status">Percentagem global indisponível: há registos com quantidades em falta. Completa os registos indicados acima ou selecciona um período completo.</div>';
  if(q.produced===0)return '<div class="quality-bar-status" role="status">Sem produção neste período: não há percentagem para representar.</div>';
  if(q.total!==q.produced)return `<div class="quality-bar-divergent"><p>Percentagens sobre a produção — totais a conferir</p>${[['Aprovadas',q.approval,'approved'],['Reprovadas',q.rejection,'rejected']].map(([label,rate,kind])=>`<div class="quality-meter-label"><span>${label}</span><strong>${percent(rate)}</strong></div><div class="quality-meter" role="img" aria-label="${label}: ${percent(rate)} da produção"><span class="${kind}" style="width:${Math.min(100,Math.max(0,rate))}%"></span></div>`).join('')}</div>`;
  return `<div class="quality-bar-labels"><span>Aprovadas <strong>${percent(q.approval)}</strong></span><span>Reprovadas <strong>${percent(q.rejection)}</strong></span></div><div class="quality-stacked-bar" role="img" aria-label="${percent(q.approval)} aprovadas e ${percent(q.rejection)} reprovadas"><span class="approved" style="width:${q.approval}%"></span><span class="rejected" style="width:${q.rejection}%"></span></div>`;
}
function qualityPanel(r,label,previous=null){
  const q=qualityMetrics(r),before=previous?qualityMetrics(previous):null;
  const percent=n=>n===null?'—':new Intl.NumberFormat('pt-PT',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n)+'%';
  const delta=before?.approval!==null&&before?.approval!==undefined&&q.approval!==null?q.approval-before.approval:null;
  const difference=q.total!==null&&r.values[2].p!==null?q.total-r.values[2].p:null;
  const deltaText=delta===null?'':Math.abs(delta)<0.05?'Sem alteração na taxa de aprovação':`${delta>0?'+':''}${fmt(delta)} p.p. na aprovação face ao período A`;
  return `<section class="quality-result" aria-label="${esc(label)}"><div class="quality-period"><strong>${esc(label)}</strong><span>${date(r.start)} — ${date(r.end)}</span></div>
    <div class="quality-rates"><div><span>Taxa de aprovação</span><strong>${percent(q.approval)}</strong></div><div class="quality-rejection"><span>Taxa de reprovação</span><strong>${percent(q.rejection)}</strong></div></div>
    ${qualityBar(q)}
    <dl class="quality-counts"><div><dt>Produzidas</dt><dd>${fmt(q.produced)}</dd></div><div><dt>Aprovadas</dt><dd>${fmt(q.approved)}</dd></div><div><dt>Reprovadas</dt><dd>${fmt(q.rejected)}</dd></div><div><dt>Rejeitadas nas máquinas</dt><dd>${fmt(r.values[2].r)}</dd></div></dl>
    ${deltaText?`<p class="quality-trend">${deltaText}</p>`:''}
    ${q.total===null||q.produced===null?'<p class="quality-notice">Dados insuficientes: preenche as quantidades produzidas, aprovadas e reprovadas para calcular as taxas.</p>':q.produced===0?'<p class="quality-notice">Nenhuma carta produzida neste período. As taxas não se aplicam.</p>':''}
    ${difference!==null&&difference!==0?`<p class="quality-notice">Conferir dados: ${fmt(q.total)} cartas avaliadas no QC e ${fmt(r.values[2].p)} produzidas. Os totais registados diferem em ${fmt(Math.abs(difference))} cartas.</p>`:''}
  </section>`;
}
function renderPeriodDashboard(){
  let g;
  try{g=generate(state,'custom',$('dashboardStart').value,$('dashboardSource').value,$('dashboardEnd').value)}catch(e){clearDashboard(e.message);return}
  const source=g.source==='daily'?'registos diários':'relatórios de período';
  $('comparisonNote').textContent=`${date(g.start)} · ${date(g.end)} · ${g.covered} de ${days(g)} dias com cobertura · ${source}. Dias sem registo não equivalem a zero.${g.excluded.length?' Há relatórios que atravessam as datas escolhidas e foram excluídos; os seus totais não podem ser repartidos por dia.':''}`;
  if(g.overlaps.length||!g.selected.length){clearDashboard(g.overlaps.length?'Existem relatórios sobrepostos. Corrige os períodos ou escolhe registos diários.':'Não existem registos inteiramente contidos neste intervalo. Ajusta as datas ou a origem.',false);return}
  const incomplete=g.selected.filter(r=>r.values.slice(0,2).some(m=>m.p===null||m.r===null));
  $('dashboardHelp').textContent=`A mostrar ${g.selected.length} ${g.source==='daily'?'registo(s) diário(s)':'relatório(s) de período'}. Os dois tipos de registo são consultados separadamente para evitar duplicações.`;
  $('dashboardIssues').innerHTML=incomplete.length?`<strong>Registos incompletos</strong><p>Há registos antigos com campos em branco. Abre e guarda o registo para assumir zero nesses campos e recalcular os totais.</p>${incomplete.map(r=>`<button type="button" class="text-button" data-edit="${esc(r.id)}">Completar ${date(r.start)} — ${esc(r.name)}</button>`).join('')}`:'';
  $('dashboardIssues').hidden=!incomplete.length;
  const r={...g,name:'Período seleccionado'};
  $('kpis').innerHTML=[['Cartas produzidas',2,'p'],['Cartas rejeitadas',2,'r'],['Aprovadas no QC',3,'p'],['Reprovadas no QC',4,'r']].map(([title,i,k])=>`<article class="kpi"><div class="kpi-top">${title}</div><div class="kpi-value">${fmt(r.values[i][k])}</div><p>Período seleccionado</p></article>`).join('');
  barChart(r,null,false);
  $('qualityChart').innerHTML=qualityPanel(r,'Período seleccionado');
  $('comparisonTable').innerHTML=matrix(r);
}
function clearDashboard(message,replaceNote=true){
  if(replaceNote)$('comparisonNote').textContent=message;
  $('machineLegend').innerHTML='';$('kpis').innerHTML='';['machineChart','qualityChart','comparisonTable'].forEach(id=>$(id).innerHTML=empty(esc(message)));
}
function syncDashboardControls(){
  const monthly=$('dashboardView').value==='monthly';
  $('dashboardMonthLabel').hidden=!monthly;
  $('dashboardStartLabel').hidden=monthly;$('dashboardEndLabel').hidden=monthly;
  $('dashboardSource').disabled=false;
  ['dashboardStart','dashboardEnd'].forEach(id=>$(id).disabled=monthly);
  $('dashboardMonth').disabled=!monthly;
  $('dashboardHelp').textContent=monthly?'Selecciona o mês para consultar os resultados.':'Os indicadores abaixo usam o intervalo e a origem escolhidos.';
}
function updateDashboardView(){
  if($('dashboardView').value==='monthly'){
    if(!$('dashboardMonth').value)$('dashboardMonth').value=($('dashboardStart').value||today()).slice(0,7);
    try{const period=range('monthly',$('dashboardMonth').value+'-01');$('dashboardStart').value=period.start;$('dashboardEnd').value=period.end}catch(error){clearDashboard(error.message);return}
  }
  syncDashboardControls();renderComparison();
}
function reportTableRows(r){
  const machines=[0,1].map(i=>{
    const p=r.values[i].p??0,rejected=r.machineQC?.[i]?.rejected??r.values[i].r??0;
    return {label:`Máquina ${i+1}`,p,approved:r.machineQC?.[i]?.approved??Math.max(0,p-rejected),rejected};
  });
  return [...machines,{label:'Total',p:r.values[2].p??machines.reduce((sum,m)=>sum+m.p,0),approved:r.values[3].p??machines.reduce((sum,m)=>sum+m.approved,0),rejected:r.values[4].r??machines.reduce((sum,m)=>sum+m.rejected,0)}];
}
function matrix(r){return `<table><thead><tr><th>Origem</th><th class="number">Produzidas</th><th class="number">Aprovadas</th><th class="number">Rejeitadas / reprovadas</th></tr></thead><tbody>${reportTableRows(r).map((row,i)=>`<tr class="${i===2?'total-row':''}"><td>${row.label}</td><td class="number">${fmt(row.p)}</td><td class="number">${fmt(row.approved)}</td><td class="number">${fmt(row.rejected)}</td></tr>`).join('')}</tbody></table>`}
function renderReports(){$('reportsList').innerHTML=reports().map(r=>`<article class="panel report-card"><div class="panel-heading"><div><h2>${esc(r.name)}</h2><p>${date(r.start)} — ${date(r.end)} · ${days(r)} dias</p></div><div class="report-actions"><button class="text-button" data-edit="${esc(r.id)}">Editar</button><button class="text-button delete" data-delete="${esc(r.id)}">Eliminar</button></div></div><div class="table-scroll">${matrix(r)}</div><p class="footnote">${esc(r.notes||'')} ${findings(r).map(esc).join(' ')}</p></article>`).join('')||`<article class="panel">${empty('Adiciona um relatório de período para começar.')}</article>`}
function renderDaily(){
  if(!$('dailyMonth').value)$('dailyMonth').value=today().slice(0,7);
  renderCalendar();
  const records=state.records.filter(r=>r.kind==='daily'&&r.start.startsWith($('dailyMonth').value)).sort((a,b)=>a.start.localeCompare(b.start));
  if(!records.length){$('dailyTable').innerHTML=empty('Não existem registos neste mês. Escolhe uma data no calendário para registar a produção.');return}
  $('dailyTable').innerHTML=`<table><thead><tr><th>Data</th><th class="number">Produzidas</th><th class="number">Rejeitadas</th><th class="number">Aprovadas QC</th><th class="number">Reprovadas QC</th><th></th></tr></thead><tbody>${records.map(r=>`<tr><td>${date(r.start)}</td><td class="number">${fmt(r.values[2].p)}</td><td class="number">${fmt(r.values[2].r)}</td><td class="number">${fmt(r.values[3].p)}</td><td class="number">${fmt(r.values[4].r)}</td><td class="number"><button class="text-button" data-edit="${esc(r.id)}">Editar</button><button class="text-button delete" data-delete="${esc(r.id)}">Eliminar</button></td></tr>`).join('')}</tbody></table>`}

function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Maputo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function openForm(kind='daily',id=null,presetDate=null){if(!ready)return;editing=id;const r=state.records.find(r=>r.id===id);$('recordForm').reset();$('formError').textContent='';$('recordType').value=r?.kind||kind;$('recordType').disabled=!!id;$('recordName').value=r?.name||'';$('recordNotes').value=r?.notes||'';$('formFindings').textContent='';$('startDate').value=r?.start||presetDate||today();$('endDate').value=r?.end||presetDate||today();$('inputRows').innerHTML=rows.slice(0,2).map((l,i)=>`<tr><td>${l}</td>${['p','r'].map(k=>`<td><input aria-label="${l} — ${k==='p'?'Cartas produzidas':'Cartas rejeitadas'}" id="v${i}${k}" type="number" inputmode="numeric" min="0" max="1000000000" step="1" value="${r?(r.values[i][k]??''):''}" placeholder="0"></td>`).join('')}</tr>`).join('');updateCalculatedSummary();typeChange();$('recordDialog').showModal()}
function typeChange(){const daily=$('recordType').value==='daily';$('endLabel').hidden=daily;$('endDate').required=!daily;$('recordName').required=!daily;$('formTitle').textContent=(editing?'Editar ':'Novo ')+(daily?'registo diário':'relatório');if(daily)$('endDate').value=$('startDate').value}
function confirm(title,text,action){$('confirmTitle').textContent=title;$('confirmText').textContent=text;confirmAction=action;$('confirmDialog').showModal()}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));$('goReports').onclick=()=>showTab('reports');$('newRecord').onclick=()=>openForm('daily');$('addReport').onclick=()=>openForm('report');$('addDaily').onclick=()=>openForm('daily');$('recordType').onchange=typeChange;$('startDate').onchange=typeChange;['closeDialog','cancelDialog'].forEach(id=>$(id).onclick=()=>$('recordDialog').close());$('confirmCancel').onclick=()=>$('confirmDialog').close();$('confirmYes').onclick=()=>{const fn=confirmAction;$('confirmDialog').close();fn?.()};['machineMetric'].forEach(id=>$(id).onchange=renderComparison);$('dailyMonth').onchange=renderDaily;
$('recordForm').onsubmit=async e=>{e.preventDefault();try{readMachineCalculation()}catch(error){$('formError').textContent=error.message;return}const r={id:editing||crypto.randomUUID(),name:$('recordName').value.trim()||('Registo de '+date($('startDate').value)),notes:$('recordNotes').value.trim(),kind:$('recordType').value,start:$('startDate').value,end:$('recordType').value==='daily'?$('startDate').value:$('endDate').value,...readMachineCalculation()};if(r.start>r.end){$('formError').textContent='A data final deve ser igual ou posterior à data inicial.';return}if(r.kind==='daily'&&state.records.some(x=>x.kind==='daily'&&x.start===r.start&&x.id!==r.id)){$('formError').textContent='Já existe um registo para este dia. Edita o registo existente.';return}const next={...state,records:[...state.records.filter(x=>x.id!==r.id),r]};try{validate(next)}catch(err){$('formError').textContent=err.message;return}if(await persist(next)){$('recordDialog').close();configureDashboard(r);render();showTab('overview');toast('Registo guardado. A visão geral mostra o período deste registo.')}};
document.addEventListener('click',e=>{const day=e.target.closest('[data-date]');if(day){const existing=state.records.find(r=>r.kind==='daily'&&r.start===day.dataset.date);openForm('daily',existing?.id||null,day.dataset.date);return}const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openForm('report',edit.dataset.edit);if(del){const r=state.records.find(r=>r.id===del.dataset.delete);confirm('Eliminar registo?',`O registo «${r.name}» será removido. Exporta primeiro uma cópia se precisares de o conservar.`,async()=>{if(await persist({...state,records:state.records.filter(x=>x.id!==r.id)})){render();toast('Registo eliminado.')}})}});
function download(name,data,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('backup').onclick=()=>download('cartas-dados-'+today()+'.json',JSON.stringify(state,null,2),'application/json');$('restore').onclick=()=>$('file').click();$('file').onchange=async()=>{const f=$('file').files[0];if(!f)return;try{if(f.size>5e6)throw Error('O ficheiro excede o limite de 5 MB.');const parsed=JSON.parse(await f.text());if(parsed.version===1){if(parsed.demo)throw Error('Esta é uma cópia de demonstração. Importa apenas os teus dados reais.');parsed.version=2;delete parsed.demo;}const data=validate(parsed);confirm('Importar cópia de dados?',`Esta cópia contém ${data.records.length} registos e substituirá os dados actuais. Exporta primeiro uma cópia se os quiseres conservar.`,async()=>{if(await persist(data)){configureDashboard();render();toast('Cópia importada.')}})}catch(e){toast(e instanceof SyntaxError?'O ficheiro não contém JSON válido.':e.message)}$('file').value=''};
function readNumber(id){return $(id).value.trim()===''?null:Number($(id).value)}
function renderCalendar(){
  const period=range('monthly',$('dailyMonth').value+'-01'),offset=(new Date(period.start).getUTCDay()+6)%7;
  $('dailyCalendar').innerHTML=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d=>`<span class="calendar-label">${d}</span>`).join('')+'<span></span>'.repeat(offset)+dateList(period.start,period.end).map(d=>{const exists=state.records.some(r=>r.kind==='daily'&&r.start===d);return `<button class="calendar-day ${exists?'filled':''}" data-date="${d}" title="${exists?'Editar':'Registar'} ${date(d)}" aria-label="${exists?'Editar':'Registar'} ${date(d)}">${Number(d.slice(-2))}<small>${exists?'Registado':'＋'}</small></button>`}).join('');
}
function renderGenerated(){
  try{generated=generate(state,$('reportFrequency').value,$('reportAnchor').value,$('reportSource').value)}catch(e){$('reportOutput').innerHTML=`<div class="empty">${esc(e.message)}</div>`;generated=null;$('exportReport').disabled=$('printReport').disabled=true;return}
  const g=generated,total=days(g),label={daily:'Relatório diário',weekly:'Relatório semanal',monthly:'Relatório mensal'}[g.type],source=g.source==='daily'?'Registos diários':'Relatórios de período';
  const blocked=!!g.overlaps.length||!g.selected.length;$('exportReport').disabled=$('printReport').disabled=blocked;
  $('reportOutput').innerHTML=`<div class="report-summary"><div class="eyebrow">CARTAS · PRODUÇÃO & QUALIDADE</div><h2>${label}</h2><p>${date(g.start)} — ${date(g.end)} · ${source}</p><span class="coverage ${g.complete?'complete':''}">${g.covered} de ${total} dias com cobertura · ${g.complete?'período completo':'período incompleto'}</span><p>Base de cálculo: ${g.selected.length} ${g.source==='daily'?(g.selected.length===1?'dia registado':'dias registados'):(g.selected.length===1?'relatório inteiramente contido no intervalo':'relatórios inteiramente contidos no intervalo')}. ${g.missing.length?'Os dias em falta não são considerados zero.':''}</p>${g.excluded.length?`<p class="warning">${g.excluded.length} relatório(s) atravessam os limites deste intervalo e foram excluídos: não é possível repartir os seus totais por dia.</p>`:''}${g.overlaps.length?'<p class="warning">Existem relatórios sobrepostos. A soma e a exportação estão bloqueadas para evitar duplicações. Corrige os períodos ou usa registos diários.</p>':''}</div>${!blocked?`<div class="table-scroll">${matrix(g)}</div><p class="footnote">Campos de quantidade vazios são apresentados como 0. Quando não há QC por máquina, aprovadas = produzidas − rejeitadas. Os totais históricos declarados são preservados. ${findings(g).map(esc).join(' ')}</p>`:empty(g.overlaps.length?'Resolve a sobreposição dos relatórios.':'Não existem dados desta origem no intervalo escolhido.')}<div class="report-summary">${g.missing.length?`<details><summary>Dias sem cobertura (${g.missing.length})</summary><p>${g.missing.map(date).join(' · ')}</p></details>`:''}${g.selected.length?`<details><summary>Registos incluídos (${g.selected.length})</summary><ul>${g.selected.map(r=>`<li>${date(r.start)}${r.end!==r.start?' a '+date(r.end):''} · ${esc(r.name)}</li>`).join('')}</ul></details>`:''}</div>`;
}
$('generateReport').onclick=renderGenerated;['reportFrequency','reportAnchor','reportSource'].forEach(id=>$(id).onchange=renderGenerated);
function csvCell(v){const s=v===null||v===undefined?'':String(v);return '"'+(/^[=+@\-\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"'}
function buildReportCSV(g){
  const lines=[['Relatório',g.type],['Data inicial',g.start],['Data final',g.end],['Origem',g.source==='daily'?'Registos diários':'Relatórios de período'],['Dias com cobertura',g.covered],['Dias no período',days(g)],['Dias sem cobertura',g.missing.join(', ')],['Nota','Campos vazios de quantidade assumem zero. Aprovadas calculadas por máquina quando não existe QC detalhado. Totais históricos declarados preservados.'],[],['Secção','Início','Fim','Designação','Origem','Produzidas','Aprovadas','Rejeitadas / reprovadas']];
  [g,...g.selected].forEach(r=>reportTableRows(r).forEach(row=>lines.push([r===g?'Resumo':'Registo',r.start,r.end,r.name||'Totais do período',row.label,row.p,row.approved,row.rejected])));
  return '\uFEFF'+lines.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
$('exportReport').onclick=()=>{const g=generated;if(!g||!g.selected.length||g.overlaps.length)return;download(`relatorio-${g.type}-${g.start}-${g.end}.csv`,buildReportCSV(g),'text/csv;charset=utf-8')};
$('printReport').onclick=()=>{if(generated?.selected.length&&!generated.overlaps.length)window.print()};
function readMachineCalculation(){return CartasCore.calculateMachines([0,1].map(i=>({p:readNumber('v'+i+'p')??0,r:readNumber('v'+i+'r')??0})))}
function updateCalculatedSummary(){
  try{
    const result=readMachineCalculation();
    $('calculatedSummary').innerHTML=`<table><thead><tr><th>Origem</th><th class="number">Produzidas</th><th class="number">Rejeitadas / reprovadas</th><th class="number">Aprovadas</th></tr></thead><tbody>${[0,1].map(i=>`<tr><td>Máquina ${i+1}</td><td class="number">${fmt(result.values[i].p)}</td><td class="number">${fmt(result.values[i].r)}</td><td class="number">${fmt(result.machineQC[i].approved)}</td></tr>`).join('')}<tr class="total-row"><td>Total</td><td class="number">${fmt(result.values[2].p)}</td><td class="number">${fmt(result.values[2].r)}</td><td class="number">${fmt(result.values[3].p)}</td></tr></tbody></table>`;
    $('formError').textContent='';
    const old=state.records.find(r=>r.id===editing);
    const changedHistory=old&&JSON.stringify(old.values)!==JSON.stringify(result.values);
    $('formFindings').textContent=changedHistory?'Ao guardar esta edição, os totais anteriores serão substituídos pelos resultados calculados a partir das máquinas.':'';
  }catch(error){$('calculatedSummary').textContent='Corrige os valores para calcular o resumo.';$('formError').textContent=error.message}
}
$('inputRows').addEventListener('input',updateCalculatedSummary);
$('dashboardView').onchange=updateDashboardView;
$('dashboardMonth').onchange=updateDashboardView;
['dashboardStart','dashboardEnd','dashboardSource'].forEach(id=>$(id).onchange=renderComparison);
initialize();
