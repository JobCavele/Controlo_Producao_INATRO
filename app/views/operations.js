/* Operações autónomas de quantidade — sem dependências externas. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const TYPES={stock_in:'Entrada no armazém',stock_out:'Saída do armazém',personalized:'Personalização',printed:'Impressão',print_rejected:'Rejeição na impressão',qc_approved:'Aprovação de qualidade',qc_rejected:'Reprovação de qualidade',transfer:'Movido para despacho',dispatch:'Despacho',batch_error:'Erro de lote',batch_error_resolved:'Erro resolvido'};
 const REASONS={ 'bio-foto':'INCAPE — foto ou assinatura', 'bio-outra':'INCAPE — dados biográficos', 'scan-foto':'INCAPE — qualidade da fotografia', 'material-lamina':'INCAPE — laminado defeituoso', 'material-riscos':'INCAPE — riscos', 'cartao-reutilizado':'INCAPE — cartão reutilizado', 'outro':'Outro (a validar com INCAPE)', 'delegacao-incorrecta':'Delegação incorrecta', 'quantidade-incorrecta':'Quantidade incorrecta','documentacao':'Documentação incompleta'};
 let delegations=[],selected='';const fmt=n=>Number(n||0).toLocaleString('pt-PT');
 const REQUEST=async(url,options)=>{const response=await fetch(url,{cache:'no-store',...options});const payload=await response.json();if(!response.ok)throw Error(payload.error||'Falha ao comunicar com servidor.');return payload};
 const isStock=()=>['stock_in','stock_out'].includes($('opsType').value);
 const fieldVisibility=()=>{const type=$('opsType').value;for(const [id,show] of Object.entries({opsReferenceWrap:isStock()||type==='dispatch',opsMaterialWrap:isStock(),opsStartWrap:isStock(),opsEndWrap:isStock(),opsMachineWrap:type==='printed',opsReasonWrap:type==='qc_rejected'||type==='batch_error'}))$(id).hidden=!show;$('opsBatch').disabled=isStock();};
 const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const provinceKey=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 const provinceFeatures=window.MOZAMBIQUE_PROVINCES;
 function provinceTotals(stats){
  return provinceFeatures.map(feature=>{
   const branches=delegations.filter(item=>provinceKey(item.province)===provinceKey(feature.name)).map(item=>{
    const total=stats.find(row=>row.delegation===item.name);
    return {...item,dispatched:total?.dispatched||0};
   });
   return {...feature,branches,dispatched:branches.reduce((sum,item)=>sum+item.dispatched,0)};
  });
 }
 function mapSvg(provinces){
  const maximum=Math.max(0,...provinces.map(item=>item.dispatched));
  const shades=['#f1f6f1','#e1eee3','#c9e0cd','#a8cfae','#82b88b','#5b9b69'];
  const color=value=>value?shades[Math.min(shades.length-1,Math.ceil(value/maximum*shades.length)-1)]:shades[0];
  const shapes=provinces.map(feature=>{
   const active=feature.name===selected;
   const label=fmt(feature.dispatched);
   const radius=Math.max(12,label.length*3.1);
   if(feature.city){
    return `<g class="province-city" data-province="${escapeHtml(feature.name)}" tabindex="0" role="button" aria-label="${escapeHtml(feature.name)}: ${label} cartões despachados"><path d="M 75 539 L ${feature.x} ${feature.y}" fill="none" stroke="#0e7a2e" stroke-width="1.5"/><circle class="province-city-marker${active?' is-selected':''}" cx="75" cy="539" r="7"/><g class="province-count" transform="translate(48 539)"><circle r="${radius}"/><text y=".5">${label}</text></g></g>`;
   }
   return `<g class="province-hit" data-province="${escapeHtml(feature.name)}" tabindex="0" role="button" aria-label="${escapeHtml(feature.name)}: ${label} cartões despachados"><path class="province-shape${active?' is-selected':''}" d="${feature.path}" fill="${color(feature.dispatched)}"/><g class="province-count" transform="translate(${feature.x} ${feature.y})" aria-hidden="true"><circle r="${radius}"/><text y=".5">${label}</text></g></g>`;
  }).join('');
  return `<svg viewBox="0 0 430 590" role="img" aria-label="Mapa das províncias de Moçambique com cartões despachados"><text x="215" y="18" text-anchor="middle" fill="#335447" font-size="13" font-weight="700">Moçambique</text>${shapes}</svg>`;
 }
 function drawMap(stats){
  const provinces=provinceTotals(stats);
  $('mozambiqueMap').innerHTML=mapSvg(provinces);
  const selectedProvince=provinces.find(item=>item.name===selected);
  if(selectedProvince){
   $('delegationTotals').innerHTML=`<h3>${escapeHtml(selectedProvince.name)} · ${fmt(selectedProvince.dispatched)} despachados</h3><button type="button" id="opsShowAll" class="btn btn-quiet">Todas as províncias</button><div class="ops-list-scroll">${selectedProvince.branches.length?selectedProvince.branches.map(item=>`<div class="ops-delegation"><strong>${escapeHtml(item.name)}</strong><span>${fmt(item.dispatched)} cartões despachados</span></div>`).join(''):'<p>Sem delegações identificadas nesta província.</p>'}</div>`;
  }else{
   const unassigned=stats.filter(item=>item.dispatched&&!delegations.some(branch=>branch.name===item.delegation));
   $('delegationTotals').innerHTML=`<h3>Cartões despachados por província</h3><div class="ops-province-list">${provinces.map(item=>`<button class="ops-province-row" type="button" data-province="${escapeHtml(item.name)}"><strong>${escapeHtml(item.name)}</strong><span>${fmt(item.dispatched)} cartões</span></button>`).join('')}</div>${unassigned.length?`<h3>Delegações sem província associada</h3>${unassigned.map(item=>`<div class="ops-delegation"><strong>${escapeHtml(item.delegation)}</strong><span>${fmt(item.dispatched)} cartões despachados</span></div>`).join('')}`:''}`;
  }
  const showAll=$('opsShowAll');
  if(showAll)showAll.onclick=()=>{selected='';drawMap(stats)};
  document.querySelectorAll('#mozambiqueMap [data-province], #delegationTotals [data-province]').forEach(node=>{
   const select=()=>{selected=node.dataset.province;drawMap(stats)};
   node.addEventListener('click',select);
   node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
  });
 }
 async function refresh(){const s=await REQUEST('/api/state'),query=new URLSearchParams();if($('opsFilterStart').value)query.set('start',$('opsFilterStart').value);if($('opsFilterEnd').value)query.set('end',$('opsFilterEnd').value);const data=await REQUEST('/api/operations?'+query.toString());const lots=s.state.lots||[];
 const opts=['<option value="">Escolher lote</option>',...lots.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.reference)} — ${escapeHtml(l.delegation)}</option>`)];const current=$('opsBatch').value;$('opsBatch').innerHTML=opts.join('');$('opsBatch').value=current;
 $('opsBalances').innerHTML='<h3>Saldos por lote</h3><div class="ops-list-scroll">'+data.batches.map(l=>`<div class="ops-delegation"><strong>${escapeHtml(l.reference)} — ${escapeHtml(l.delegation)}</strong><span>Por imprimir: ${fmt(l.toPrint)} · Aguardam QC: ${fmt(l.toQC)} · Por mover: ${fmt(l.toTransfer)} · Por despachar: ${fmt(l.toDispatch)} · Despachadas: ${fmt(l.dispatch)} · Erros: ${fmt(l.unresolvedErrors)}</span></div>`).join('')+'</div>';
 $('opsHistory').innerHTML=`<table><thead><tr><th>Data</th><th>Operação</th><th>Lote</th><th>Quantidade</th></tr></thead><tbody>${data.operations.slice(-35).reverse().map(o=>`<tr><td>${escapeHtml(o.date)}</td><td>${escapeHtml(TYPES[o.type])}</td><td>${escapeHtml(lots.find(l=>l.id===o.batchId)?.reference||o.metadata.material||'—')}</td><td>${fmt(o.quantity)}</td></tr>`).join('')}</tbody></table>`;
 drawMap(data.delegations);
 }
 async function init(){try{
 if(!Array.isArray(provinceFeatures)||!provinceFeatures.length)throw Error('O mapa das províncias não foi carregado.');
 delegations=await REQUEST('/api/delegations');for(const id of ['lotDelegation','entryDelegation']){const e=$(id);if(!e)continue;const current=e.value;e.innerHTML='<option value="">Escolher delegação</option>'+delegations.map(d=>`<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)} (${escapeHtml(d.province)})</option>`).join('');if(current&&!delegations.some(d=>d.name===current)){const opt=document.createElement('option');opt.value=current;opt.textContent=current+' (registo anterior)';e.append(opt)}e.value=current;}
 $('opsType').innerHTML=Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');$('opsReason').innerHTML=Object.entries(REASONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');const now=new Date();$('opsDate').value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');$('opsFilterApply').onclick=()=>refresh().catch(err=>$('opsMessage').textContent=err.message);$('opsFilterClear').onclick=()=>{$('opsFilterStart').value='';$('opsFilterEnd').value='';refresh().catch(()=>{})};$('opsType').onchange=fieldVisibility;fieldVisibility();await refresh();
 $('operationForm').addEventListener('submit',async e=>{e.preventDefault();const type=$('opsType').value;const payload={type,batchId:$('opsBatch').value,date:$('opsDate').value,quantity:Number($('opsQuantity').value),reference:$('opsReference').value,material:$('opsMaterial').value,serialStart:$('opsStart').value,serialEnd:$('opsEnd').value,machine:$('opsMachine').value,reason:$('opsReason').value};try{await REQUEST('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('opsMessage').textContent='Movimento registado com sucesso.';$('opsQuantity').value='';await refresh();}catch(err){$('opsMessage').textContent=err.message;}});
 // Sincronizar com alterações do quadro principal, feitas sem recarregar a página.
 document.addEventListener('click',e=>{if(e.target.closest('[id="lotSave"], [id="recordSave"]'))setTimeout(()=>refresh().catch(()=>{}),600)});
 }catch(err){$('opsMessage').textContent='Não foi possível carregar o módulo operacional: '+err.message;}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
