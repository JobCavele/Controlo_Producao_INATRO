(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CartasCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const rows=['Máquina 1','Máquina 2','Total de cartas produzidas','Total de cartas aprovadas (QC)','Total de cartas reprovadas (QC)'];
  const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1900-01-01'&&s<='2200-12-31'&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  const days=r=>Math.round((Date.parse(r.end)-Date.parse(r.start))/86400000)+1;
  const iso=d=>d.toISOString().slice(0,10);
  function validate(data){
    if(!data||data.version!==2||!Array.isArray(data.records)||data.records.length>10000)throw Error('A cópia não tem um formato válido (versão 2).');
    const ids=new Set(),daily=new Set();
    for(const r of data.records){
      if(!r||typeof r.id!=='string'||!r.id||r.id.length>100||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>100||!['report','daily'].includes(r.kind)||!validDate(r.start)||!validDate(r.end)||r.start>r.end||!Array.isArray(r.values)||r.values.length!==5||r.values.some(v=>!v||['p','r'].some(k=>v[k]!==null&&(!Number.isSafeInteger(v[k])||v[k]<0||v[k]>1e9)))||(r.notes!==undefined&&(typeof r.notes!=='string'||r.notes.length>1000)))throw Error('Existem registos inválidos. Usa datas entre 1900 e 2200 e números inteiros entre 0 e 1 000 000 000.');
      if(r.machineQC!==undefined&&(!Array.isArray(r.machineQC)||r.machineQC.length!==2||r.machineQC.some(v=>!v||['approved','rejected'].some(k=>v[k]!==null&&(!Number.isSafeInteger(v[k])||v[k]<0||v[k]>1e9)))))throw Error('QC por máquina inválido. Usa inteiros não negativos ou campos em branco.');
      if(r.kind==='daily'){if(r.start!==r.end||daily.has(r.start))throw Error('Já existe um registo para este dia. Edita o registo existente.');daily.add(r.start)}ids.add(r.id);
    }
    return data;
  }
  function range(type,anchor){
    if(!validDate(anchor))throw Error('Selecciona uma data válida.');
    const start=new Date(anchor+'T00:00:00Z'),end=new Date(start);
    if(type==='weekly'){start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));end.setTime(start.getTime());end.setUTCDate(end.getUTCDate()+6)}
    else if(type==='monthly'){start.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1,0)}
    else if(type!=='daily')throw Error('Periodicidade inválida.');
    return {start:iso(start),end:iso(end)};
  }
  function dateList(start,end){const list=[];for(let d=new Date(start+'T00:00:00Z');iso(d)<=end;d.setUTCDate(d.getUTCDate()+1))list.push(iso(d));return list}
  function generate(state,type,anchor,source,end){
    if(type==='custom'&&(!validDate(anchor)||!validDate(end)||anchor>end))throw Error('Escolhe datas válidas: a data final deve ser igual ou posterior à inicial.');
    const period=type==='custom'?{start:anchor,end}:range(type,anchor),kind=source==='daily'?'daily':'report';
    const selected=state.records.filter(r=>r.kind===kind&&r.start>=period.start&&r.end<=period.end).sort((a,b)=>a.start.localeCompare(b.start));
    const excluded=state.records.filter(r=>r.kind===kind&&r.start<=period.end&&r.end>=period.start&&!selected.includes(r));
    const covered=new Set(),overlaps=new Set();
    selected.forEach(r=>dateList(r.start,r.end).forEach(d=>{if(covered.has(d))overlaps.add(d);covered.add(d)}));
    const missing=dateList(period.start,period.end).filter(d=>!covered.has(d));
    const values=rows.map((_,i)=>Object.fromEntries(['p','r'].map(k=>[k,selected.length&&!overlaps.size&&selected.every(r=>r.values[i][k]!==null)?selected.reduce((sum,r)=>sum+r.values[i][k],0):null])));
    const machineQC=[0,1].map(i=>Object.fromEntries(['approved','rejected'].map(k=>[k,selected.length&&!overlaps.size&&selected.every(r=>r.machineQC?.[i]?.[k]!=null)?selected.reduce((sum,r)=>sum+r.machineQC[i][k],0):null])));
    return {...period,source,type,selected,excluded,missing,covered:covered.size,overlaps:[...overlaps],values,machineQC,complete:missing.length===0};
  }
  function calculateMachines(machines){
    if(!Array.isArray(machines)||machines.length!==2)throw Error('Preenche as duas máquinas.');
    machines.forEach((m,i)=>{
      for(const key of ['p','r'])if(m[key]!==null&&(!Number.isSafeInteger(m[key])||m[key]<0||m[key]>1e9))throw Error(`Máquina ${i+1}: usa quantidades inteiras não negativas.`);
      if(m.p!==null&&m.r!==null&&m.r>m.p)throw Error(`Máquina ${i+1}: as rejeitadas não podem ultrapassar as produzidas.`);
    });
    const machineQC=machines.map(m=>({approved:m.p===null||m.r===null?null:m.p-m.r,rejected:m.r}));
    const sum=list=>list.every(n=>n!==null)?list.reduce((a,b)=>a+b,0):null;
    const values=[...machines.map(m=>({p:m.p,r:m.r})),{p:sum(machines.map(m=>m.p)),r:sum(machines.map(m=>m.r))},{p:sum(machineQC.map(m=>m.approved)),r:null},{p:null,r:sum(machineQC.map(m=>m.rejected))}];
    return {values,machineQC};
  }
  function findings(r){
    const out=[],v=r.values;
    for(const k of ['p','r'])if(v[0][k]!==null&&v[1][k]!==null&&v[2][k]!==null&&v[0][k]+v[1][k]!==v[2][k])out.push(`A soma das máquinas (${k==='p'?'produzidas':'rejeitadas'}) difere do total declarado; os valores foram mantidos.`);
    if(v[3].p!==null&&v[4].r!==null&&v[2].p!==null&&v[3].p+v[4].r!==v[2].p)out.push(`QC: ${v[3].p+v[4].r} cartas avaliadas; produção: ${v[2].p}. Diferença entre os totais registados; conferir os dados de origem.`);
    return out;
  }
  return {rows,validDate,days,validate,range,dateList,generate,findings,calculateMachines};
});
