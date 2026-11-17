const db=require('../shared/database');const {qty,day,failure}=require('../shared/http');const crypto=require('node:crypto');
const TYPES=['stock_in','stock_out','personalized','printed','print_rejected','qc_approved','qc_rejected','transfer','dispatch','batch_error','batch_error_resolved'];
function records(){return db.prepare('SELECT id,type,batch_id AS batchId,delegation,event_date AS date,quantity,metadata,created_at AS createdAt FROM operations ORDER BY event_date,id').all().map(o=>({...o,metadata:JSON.parse(o.metadata)}));}
function lotOf(state,id){return state.lots?.find(x=>x.id===id||x.reference===id)}
function values(all,id){const x={personalized:0,printed:0,print_rejected:0,qc_approved:0,qc_rejected:0,transfer:0,dispatch:0};for(const row of all)if(row.batchId===id&&x[row.type]!==undefined)x[row.type]+=row.quantity;return x;}
function available(v,lot){const effective=v.printed-v.print_rejected;return {toPersonalize:lot.quantity-v.personalized,toPrint:Math.min(v.personalized,lot.quantity)-(v.printed-v.print_rejected-v.qc_rejected),toQC:effective-v.qc_approved-v.qc_rejected,toTransfer:v.qc_approved-v.transfer,toDispatch:v.transfer-v.dispatch};}
function insert(data,state){if(!data||!TYPES.includes(data.type))failure(422,'Tipo de movimento desconhecido.');const type=data.type;const amount=qty(data.quantity);const eventDate=day(data.date);let lot=null;let delegation='';if(type!=='stock_in'&&type!=='stock_out'){
 lot=lotOf(state,data.batchId);if(!lot)failure(422,'Escolhe um lote existente.');delegation=lot.delegation||'';
}
const meta={};if(type==='stock_in'||type==='stock_out'){
 if(typeof data.reference!=='string'||!data.reference.trim())failure(422,'Referência obrigatória.');
 meta.reference=data.reference.trim();meta.material=(data.material||'Cartões em branco').slice(0,100);
 if(data.serialStart||data.serialEnd){if(!/^\d+$/.test(data.serialStart||'')||!/^\d+$/.test(data.serialEnd||''))failure(422,'As séries devem ser numéricas.');const a=BigInt(data.serialStart),b=BigInt(data.serialEnd);if(b<a||b-a+1n!==BigInt(amount))failure(422,'O intervalo não corresponde à quantidade.');meta.serialStart=data.serialStart;meta.serialEnd=data.serialEnd;}
 const balance=records().filter(o=>o.type.startsWith('stock_')&&o.metadata.material===meta.material).reduce((s,o)=>s+(o.type==='stock_in'?o.quantity:-o.quantity),0);
 if(type==='stock_out'&&amount>balance)failure(422,`Stock insuficiente: ${balance}.`);
 if(meta.serialStart){for(const o of records()){if(o.type!==type||o.metadata.material!==meta.material||!o.metadata.serialStart)continue;const a=BigInt(meta.serialStart),b=BigInt(meta.serialEnd),c=BigInt(o.metadata.serialStart),d=BigInt(o.metadata.serialEnd);if(a<=d&&c<=b)failure(422,'Intervalo de séries repetido neste tipo de movimento.');}}
} else {
 const previous=records().filter(x=>x.batchId===lot.id);
 // Não aceitar movimentos retroactivos posteriores a operações já confirmadas: evita saldos históricos impossíveis.
 if(previous.some(o=>o.date>eventDate))failure(422,'Registe os movimentos pela ordem das datas para preservar o histórico.');
 const v=values(previous,lot.id),a=available(v,lot);
 const limits={personalized:a.toPersonalize,printed:a.toPrint,print_rejected:v.printed-v.print_rejected-v.qc_approved-v.qc_rejected,qc_approved:a.toQC,qc_rejected:a.toQC,transfer:a.toTransfer,dispatch:a.toDispatch};
 if(type in limits&&amount>limits[type])failure(422,`Quantidade superior à disponível (${limits[type]}).`);
 if(type==='printed'&&data.machine!=='Máquina 1'&&data.machine!=='Máquina 2')failure(422,'Indica a máquina.');
 if(type==='printed')meta.machine=data.machine;
 if(type==='qc_rejected'){const accepted=['bio-foto','bio-outra','scan-foto','material-lamina','material-riscos','cartao-reutilizado','outro'];if(!accepted.includes(data.reason))failure(422,'Escolhe um motivo INCAPE válido.');meta.reason=data.reason;}
 if(type==='dispatch'&&(!data.reference||!String(data.reference).trim()))failure(422,'Referência da guia obrigatória.');
 if(type==='dispatch')meta.reference=String(data.reference).trim();
 if(type==='batch_error'&&(!data.reason||!String(data.reason).trim()))failure(422,'Indica o tipo de erro.');
 if(type==='batch_error')meta.reason=String(data.reason).slice(0,100);
 if(type==='batch_error_resolved'){
 const open=previous.filter(o=>o.type==='batch_error').reduce((s,o)=>s+o.quantity,0)-previous.filter(o=>o.type==='batch_error_resolved').reduce((s,o)=>s+o.quantity,0);
 if(amount>open)failure(422,`Apenas ${open} erros por resolver.`);
 }
 const unresolved=previous.filter(o=>o.type==='batch_error').reduce((s,o)=>s+o.quantity,0)-previous.filter(o=>o.type==='batch_error_resolved').reduce((s,o)=>s+o.quantity,0);
 if(type==='dispatch'&&unresolved>0)failure(422,'Este lote possui erros por resolver.');
}
const id=crypto.randomUUID();db.prepare('INSERT INTO operations(id,type,batch_id,delegation,event_date,quantity,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,type,lot?.id||null,delegation,eventDate,amount,JSON.stringify(meta),new Date().toISOString());return {id};}
function dashboard(state,start,end){const all=records();const filtered=all.filter(o=>(!start||o.date>=start)&&(!end||o.date<=end));const delegations=new Map();for(const lot of state.lots||[]){if(!delegations.has(lot.delegation))delegations.set(lot.delegation,{delegation:lot.delegation,produced:0,approved:0,dispatched:0});}
for(const o of filtered){if(!o.delegation)continue;if(!delegations.has(o.delegation))delegations.set(o.delegation,{delegation:o.delegation,produced:0,approved:0,dispatched:0});const v=delegations.get(o.delegation);if(o.type==='printed')v.produced+=o.quantity;if(o.type==='qc_approved')v.approved+=o.quantity;if(o.type==='dispatch')v.dispatched+=o.quantity;}
// Histórico anterior: registos de produção já existentes continuam visíveis.
// Não os transformamos automaticamente em movimentos de qualidade ou despacho.
for(const record of state.records||[]){if((start&&record.end<start)||(end&&record.start>end))continue;
 for(const entry of record.entries||[]){const delegation=entry.delegation||(state.lots||[]).find(l=>l.id===entry.lotId)?.delegation;
 if(!delegation)continue;
 if(!delegations.has(delegation))delegations.set(delegation,{delegation,produced:0,approved:0,dispatched:0});
 const target=delegations.get(delegation);const already=all.some(o=>o.type==='printed'&&o.batchId===entry.lotId&&o.date>=record.start&&o.date<=record.end);
 if(!already){target.produced+=entry.produced||0;}
 }}
const batches=(state.lots||[]).map(lot=>{const v=values(all,lot.id),a=available(v,lot);return {id:lot.id,reference:lot.reference,delegation:lot.delegation,quantity:lot.quantity,...v,...a,unresolvedErrors:all.filter(o=>o.batchId===lot.id).reduce((s,o)=>s+(o.type==='batch_error'?o.quantity:o.type==='batch_error_resolved'?-o.quantity:0),0)}});
return {delegations:[...delegations.values()].sort((a,b)=>b.produced-a.produced),batches,operations:filtered,summary:{produced:filtered.filter(o=>o.type==='printed').reduce((a,o)=>a+o.quantity,0),approved:filtered.filter(o=>o.type==='qc_approved').reduce((a,o)=>a+o.quantity,0),dispatched:filtered.filter(o=>o.type==='dispatch').reduce((a,o)=>a+o.quantity,0)}};}
module.exports={records,insert,dashboard};
