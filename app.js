'use strict';
const CALL_KEY='qso-log-own-call-v1';
let OWN_CALL=(localStorage.getItem(CALL_KEY)||'LW2HAR').trim().toUpperCase();
if(!/^[A-Z0-9/]{3,20}$/.test(OWN_CALL))OWN_CALL='LW2HAR';
// Keep LW2HAR's original IndexedDB database so all existing QSOs remain intact.
const DB_NAME=OWN_CALL==='LW2HAR'?'qso-log-lw2har-offline':`qso-log-user-${OWN_CALL.replace(/[^A-Z0-9]/g,'_')}-offline`;
function formatReport(report){return report&&/^[1-5](?:[1-9]|9\+)$/.test(report)?`${report[0]}/${report.slice(1)}`:'—'}
function reportSelectors(prefix){for(const suffix of ['R','S']){const el=$(prefix+suffix);el.innerHTML=['',...(suffix==='R'?[1,2,3,4,5]:[1,2,3,4,5,6,7,8,9,'9+'])].map(n=>`<option value="${n}">${n===''?'—':n}</option>`).join('')}setReport(prefix,'59')}
function setReport(prefix,value){const v=/^[1-5](?:[1-9]|9\+)$/.test(value||'')?value:'';$(prefix+'R').value=v?v[0]:'';$(prefix+'S').value=v?v.slice(1):'';if(typeof updateReportPreviews==='function')updateReportPreviews()}
function getReport(prefix){const r=$(prefix+'R').value,s=$(prefix+'S').value;return r&&s?r+s:''}
function updateReportPreviews(){
 const q=$('qsoReportPreview'),p=$('personReportPreview');
 if(q)q.textContent=`Enviado ${formatReport(getReport('sent'))} · Recibido ${formatReport(getReport('rcvd'))}`;
 if(p)p.textContent=`Enviado ${formatReport(getReport('pSent'))} · Recibido ${formatReport(getReport('pRcvd'))}`;
}

function renderOwnCall(){for(const id of ['headerCall','stationCall'])$(id).textContent=OWN_CALL;$('myCall').value=OWN_CALL}

const $=id=>document.getElementById(id);
const nowIso=()=>new Date().toISOString();
const uid=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():('qso-'+Date.now()+'-'+Math.random().toString(36).slice(2));
function localStamp(){const d=new Date();return {date:[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),time:[String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0')].join(':')}}
function localToUTC(date,time){const d=new Date(`${date}T${time}:00`);if(Number.isNaN(d.getTime()))throw Error('Fecha u hora inválida');return d.toISOString()}
function bandMode(khz){const f=Number(khz)/1000;const bands=[[1.8,2,'160m'],[3.5,4,'80m'],[5.3,5.4,'60m'],[7,7.3,'40m'],[10.1,10.15,'30m'],[14,14.35,'20m'],[18.068,18.168,'17m'],[21,21.45,'15m'],[24.89,24.99,'12m'],[28,29.7,'10m'],[50,54,'6m'],[144,148,'2m'],[430,440,'70cm']];const band=bands.find(([a,b])=>f>=a&&f<=b)?.[2]||'Fuera de banda';const mode=f>=144?'FM':f<10?'LSB':'USB';return {band,mode}}
function isValidCall(call){return /^[A-Z0-9/]{3,20}$/.test(call)&&/[A-Z]/.test(call)&&/[0-9]/.test(call)}
function isValidLocator(g){return !g||/^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/.test(g)}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function message(id,text,error=false){const el=$(id);el.textContent=text;el.classList.toggle('error',!!error)}
function download(name,text,mime){const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
const dbReady=new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,2);req.onupgradeneeded=()=>{const db=req.result;for(const store of ['qsos','wheels','deletions'])if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
async function all(store){const db=await dbReady;return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function rawPut(store,obj){const db=await dbReady;return new Promise((resolve,reject)=>{const req=db.transaction(store,'readwrite').objectStore(store).put(obj);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function rawRemove(store,id){const db=await dbReady;return new Promise((resolve,reject)=>{const req=db.transaction(store,'readwrite').objectStore(store).delete(id);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}
async function put(store,obj){
  if(['qsos','wheels'].includes(store)){
    obj.updated=obj.updated||nowIso();
    await rawRemove('deletions',`${store}:${obj.id}`);
  }
  const result=await rawPut(store,obj);
  if(['qsos','wheels'].includes(store))window.qsoSyncLocalChange?.();
  return result;
}
async function remove(store,id){
  if(['qsos','wheels'].includes(store))
    await rawPut('deletions',{id:`${store}:${id}`,store,recordId:id,updated:nowIso()});
  await rawRemove(store,id);
  if(['qsos','wheels'].includes(store))window.qsoSyncLocalChange?.();
}
let editingQsoId=null,activeWheelId=null,editingPersonId=null,currentSpeakerId=null;
function activateTab(id){document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active',page.id===id));document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('selected',b.dataset.tab===id));if(id==='historial')renderHistory();if(id==='rueda')renderWheels();if(id==='mapa')renderMap();if(id==='qso')updateStats()}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));
function setFrequency(prefix){let freq=$(prefix+'Freq');let band=$(prefix+'Band');let mode=$(prefix+'Mode');const {band:b,mode:m}=bandMode(freq.value);band.value=b;mode.value=m}
function updateSingleBand(){let v=bandMode($('freq').value);$('band').value=v.band;$('mode').value=v.mode}
function setModeOption(id,value){const el=$(id);const v=String(value||'OTHER');if(!Array.from(el.options).some(option=>option.value===v))el.add(new Option(v,v));el.value=v}
$('freq').addEventListener('input',updateSingleBand);
function clearQsoForm(){editingQsoId=null;const s=localStamp();$('date').value=s.date;$('time').value=s.time;setReport('sent','59');setReport('rcvd','59');for(const id of ['call','name','city','region','country','locator','notes'])$(id).value='';$('formTitle').textContent='Registrar QSO';$('saveQso').textContent='Guardar QSO';$('repeatInfo').classList.add('hidden');$('qsoReports').open=false;refreshQrzLinks();message('qsoMsg','')}
$('resetQso').addEventListener('click',clearQsoForm);
function singleForm(){return {call:$('call').value.trim().toUpperCase(),name:$('name').value.trim(),city:$('city').value.trim(),region:$('region').value.trim(),country:$('country').value.trim(),locator:$('locator').value.trim().toUpperCase(),notes:$('notes').value.trim(),rstSent:getReport('sent'),rstRcvd:getReport('rcvd'),date:$('date').value,time:$('time').value,freq:Number($('freq').value),band:$('band').value,mode:$('mode').value}}
$('qsoForm').addEventListener('submit',async event=>{event.preventDefault();try{const data=singleForm();if(!isValidCall(data.call))throw Error('Ingresá un indicativo válido.');if(!Number.isInteger(data.freq)||data.freq<=0)throw Error('La frecuencia debe ser un número entero en kHz.');if(!data.date||!data.time)throw Error('Ingresá fecha y hora.');if(!isValidLocator(data.locator))throw Error('Locator no válido; usá por ejemplo FF78 o FF78AB.');const prev=editingQsoId?(await all('qsos')).find(q=>q.id===editingQsoId):null;const qso={...(prev||{}),...data,id:editingQsoId||uid(),ownCall:OWN_CALL,utc:prev&&prev.date===data.date&&prev.time===data.time?prev.utc:localToUTC(data.date,data.time),wheelId:null,wheelNumber:null,created:prev?.created||nowIso(),updated:nowIso(),adifRstSent:prev?.rstSent===data.rstSent?prev?.adifRstSent||'':'',adifRstRcvd:prev?.rstRcvd===data.rstRcvd?prev?.adifRstRcvd||'':'',adifFreq:prev?.freq===data.freq?prev?.adifFreq||'':'',adifMode:prev?.mode===data.mode?prev?.adifMode||'':'',adifSubmode:prev?.mode===data.mode?prev?.adifSubmode||'':''};await put('qsos',qso);clearQsoForm();message('qsoMsg',`✓ QSO de ${data.call} guardado en este dispositivo.`);await updateStats()}catch(error){message('qsoMsg',error.message,true)}});
async function showRepeat(){const call=$('call').value.trim().toUpperCase();const matches=(await all('qsos')).filter(q=>q.call===call&&q.id!==editingQsoId);const box=$('repeatInfo');box.classList.toggle('hidden',!matches.length);if(matches.length){const latest=matches.slice().sort((a,b)=>b.utc.localeCompare(a.utc))[0];box.innerHTML=`🔁 <strong>Indicativo repetido: ${escapeHtml(call)}</strong>. ${matches.length} QSO anterior(es). Último: ${escapeHtml(latest.date)}, ${escapeHtml(latest.freq)} kHz. <button type="button" class="tiny" id="seeRepeats">Ver historial</button>`;$('seeRepeats').onclick=()=>{$('searchHistory').value=call;activateTab('historial')}}}
$('call').addEventListener('input',()=>{const pos=$('call').selectionStart;$('call').value=$('call').value.toUpperCase();try{$('call').setSelectionRange(pos,pos)}catch{}showRepeat()});
function refreshQrzLinks(){
 for(const [id,linkId] of [['call','qrzInfo'],['pCall','pQrzInfo']]){
   const call=$(id).value.trim().toUpperCase();const valid=isValidCall(call);
   $(linkId).href=valid?`https://www.qrz.com/db/${encodeURIComponent(call)}`:'https://www.qrz.com/';
   $(linkId).title=valid?`Abrir QRZ de ${call}`:'Abrir QRZ.com (indicativo no ingresado)';
 }
}
$('call').addEventListener('input',refreshQrzLinks);
$('pCall').addEventListener('input',refreshQrzLinks);

async function updateStats(){const [qs,ws]=await Promise.all([all('qsos'),all('wheels')]);$('nQsos').textContent=qs.length;$('nCalls').textContent=new Set(qs.map(q=>q.call)).size;$('nWheels').textContent=ws.length;$('nImports').textContent=qs.filter(q=>q.source==='ADIF').length;$('connection').textContent=`● ${navigator.onLine?'Con Internet':'Sin Internet'} · guardado local`}
async function wheelById(){return (await all('wheels')).find(w=>w.id===activeWheelId)}
async function renderWheels(){const ws=(await all('wheels')).sort((a,b)=>b.number-a.number);if(!activeWheelId||!ws.some(w=>w.id===activeWheelId))activeWheelId=ws[0]?.id||null;const selector=$('wheelSelect');selector.innerHTML=ws.map(w=>`<option value="${escapeHtml(w.id)}">Rueda ${String(w.number).padStart(4,'0')} · ${escapeHtml(w.state)}</option>`).join('');selector.value=activeWheelId||'';const w=ws.find(x=>x.id===activeWheelId);$('wheelContent').classList.toggle('hidden',!w);$('noWheel').classList.toggle('hidden',!!w);$('toggleFinish').disabled=!w;if(!w){$('wheelState').textContent='Sin rueda';return}const n=String(w.number).padStart(4,'0');$('wheelState').textContent=`Rueda ${n} · ${w.state}`;$('toggleFinish').textContent=w.state==='Finalizada'?'Reabrir rueda':'Finalizar rueda';for(const [id,val] of Object.entries({wDate:w.date,wTime:w.time,wFreq:w.freq,wBand:w.band,wMode:w.mode}))$(id).value=val;renderPeople(w)}
$('wheelSelect').addEventListener('change',()=>{activeWheelId=$('wheelSelect').value;currentSpeakerId=null;resetParticipant();renderWheels()});
$('newWheel').addEventListener('click',async()=>{const ws=await all('wheels');const number=Math.max(0,...ws.map(w=>Number(w.number)||0))+1;const s=localStamp();const freq=Number($('freq').value)||7125;const {band,mode}=bandMode(freq);const w={id:uid(),number,state:'Activa',date:s.date,time:s.time,freq,band,mode,people:[],created:nowIso(),updated:nowIso()};await put('wheels',w);activeWheelId=w.id;currentSpeakerId=null;resetParticipant();await renderWheels();await updateStats();message('wheelMsg',`✓ Rueda ${String(number).padStart(4,'0')} creada localmente.`)});
$('toggleFinish').addEventListener('click',async()=>{const w=await wheelById();if(!w)return;w.state=w.state==='Activa'?'Finalizada':'Activa';w.updated=nowIso();await put('wheels',w);renderWheels()});
async function saveWheelFields(){const w=await wheelById();if(!w)return;const freq=Number($('wFreq').value);if(!Number.isInteger(freq)||freq<=0||!$('wDate').value||!$('wTime').value){message('wheelMsg','Revisá la frecuencia, fecha y hora de la rueda.',true);return}w.date=$('wDate').value;w.time=$('wTime').value;w.freq=freq;w.band=$('wBand').value;w.mode=$('wMode').value;w.updated=nowIso();await put('wheels',w);for(const p of w.people){await savePersonQso(w,p)}message('wheelMsg','✓ Datos generales de la rueda guardados.')}
$('wFreq').addEventListener('change',async()=>{const {band,mode}=bandMode($('wFreq').value);$('wBand').value=band;$('wMode').value=mode;await saveWheelFields()});
for(const id of ['wDate','wTime','wMode'])$(id).addEventListener('change',saveWheelFields);
function participantForm(){return {rstSent:getReport('pSent'),rstRcvd:getReport('pRcvd'),call:$('pCall').value.trim().toUpperCase(),name:$('pName').value.trim(),city:$('pCity').value.trim(),region:$('pRegion').value.trim(),country:$('pCountry').value.trim(),locator:$('pLocator').value.trim().toUpperCase(),notes:$('pNotes').value.trim()}}
function resetParticipant(){editingPersonId=null;setReport('pSent','59');setReport('pRcvd','59');for(const id of ['pCall','pName','pCity','pRegion','pCountry','pLocator','pNotes'])$(id).value='';$('participantTitle').textContent='Agregar participante';$('savePerson').textContent='Agregar participante';$('personReports').open=false;refreshQrzLinks()}
$('cancelPerson').addEventListener('click',resetParticipant);
async function savePersonQso(w,p){const qs=await all('qsos');const previous=qs.find(q=>q.id===p.qsoId);const tag=`Rueda ${String(w.number).padStart(4,'0')}`;const notes=p.notes?`${p.notes} · ${tag}`:tag;const q={id:p.qsoId,ownCall:OWN_CALL,rstSent:p.rstSent||previous?.rstSent||'',rstRcvd:p.rstRcvd||previous?.rstRcvd||'',call:p.call,name:p.name,city:p.city,region:p.region,country:p.country,locator:p.locator,notes,date:w.date,time:w.time,utc:localToUTC(w.date,w.time),freq:Number(w.freq),band:w.band,mode:w.mode,wheelId:w.id,wheelNumber:w.number,created:previous?.created||nowIso(),updated:nowIso()};await put('qsos',q)}
$('personForm').addEventListener('submit',async e=>{e.preventDefault();const w=await wheelById();if(!w)return;try{const d=participantForm();if(!isValidCall(d.call))throw Error('Indicativo inválido.');if(!isValidLocator(d.locator))throw Error('Locator no válido.');if(w.people.some(p=>p.call===d.call&&p.id!==editingPersonId))throw Error('Ese indicativo ya está en esta rueda.');let p;if(editingPersonId){p=w.people.find(x=>x.id===editingPersonId);if(!p)throw Error('Participante no encontrado.');Object.assign(p,d)}else{p={...d,id:uid(),qsoId:uid(),state:'Activo'};w.people.push(p)}w.updated=nowIso();await put('wheels',w);await savePersonQso(w,p);const savedCall=p.call;resetParticipant();await renderWheels();await updateStats();message('wheelMsg',`✓ ${savedCall} guardado en Rueda ${String(w.number).padStart(4,'0')}.`)}catch(error){message('wheelMsg',error.message,true)}});
function renderPeople(w){const active=w.people.filter(p=>p.state==='Activo');if(!active.some(p=>p.id===currentSpeakerId))currentSpeakerId=active[0]?.id||null;const speaker=active.find(p=>p.id===currentSpeakerId);$('speakerName').textContent=speaker?`${speaker.call}${speaker.name?' · '+speaker.name:''}`:'—';$('nextSpeaker').disabled=!active.length;$('peopleRows').innerHTML=w.people.map((p,i)=>`<tr class="${p.state==='Retirado'?'retired':''} ${p.id===currentSpeakerId?'speaking':''}"><td>${i+1}</td><td><strong>${escapeHtml(p.call)}</strong></td><td>${escapeHtml(p.name)}</td><td>${escapeHtml([p.city,p.region,p.country].filter(Boolean).join(', '))}</td><td>${formatReport(p.rstSent)} / ${formatReport(p.rstRcvd)}</td><td>${escapeHtml(p.state)}</td><td><div class="row-actions"><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="up" aria-label="Subir">↑</button><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="down" aria-label="Bajar">↓</button><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="toggle">${p.state==='Activo'?'Retirar':'Reactivar'}</button><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="edit">Editar</button><button class="tiny danger" data-person="${escapeHtml(p.id)}" data-action="delete">Quitar</button></div></td></tr>`).join('');$('peopleRows').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>personAction(b.dataset.action,b.dataset.person)))}
$('nextSpeaker').addEventListener('click',async()=>{const w=await wheelById();if(!w)return;const ps=w.people.filter(p=>p.state==='Activo');if(!ps.length)return;const idx=ps.findIndex(p=>p.id===currentSpeakerId);currentSpeakerId=ps[(idx+1)%ps.length].id;renderPeople(w)});
async function personAction(action,id){const w=await wheelById();if(!w)return;const i=w.people.findIndex(p=>p.id===id),p=w.people[i];if(!p)return;if(action==='edit'){editingPersonId=id;setReport('pSent',p.rstSent);setReport('pRcvd',p.rstRcvd);for(const [key,val] of Object.entries({pCall:p.call,pName:p.name,pCity:p.city,pRegion:p.region,pCountry:p.country,pLocator:p.locator,pNotes:p.notes}))$(key).value=val||'';$('participantTitle').textContent=`Editar ${p.call}`;$('savePerson').textContent='Guardar cambios';$('personReports').open=false;refreshQrzLinks();$('pCall').focus();return}if(action==='delete'){if(!confirm(`¿Quitar a ${p.call} de esta rueda y borrar su QSO asociado?`))return;w.people.splice(i,1);await remove('qsos',p.qsoId);if(editingPersonId===id)resetParticipant()}if(action==='toggle')p.state=p.state==='Activo'?'Retirado':'Activo';if(action==='up'&&i>0)[w.people[i-1],w.people[i]]=[w.people[i],w.people[i-1]];if(action==='down'&&i<w.people.length-1)[w.people[i+1],w.people[i]]=[w.people[i],w.people[i+1]];w.updated=nowIso();await put('wheels',w);await renderWheels();await updateStats()}
async function renderHistory(){
  const allQ=await all('qsos');
  const search=$('searchHistory').value.trim().toUpperCase();
  const origin=$('historyOrigin').value;
  const qs=allQ.filter(q=>{
    if(origin==='ADIF'&&q.source!=='ADIF')return false;
    if(origin==='manual'&&q.source==='ADIF')return false;
    const searchable=[q.call,q.name,q.notes,q.city,q.region,q.importFile,q.importedAt,
      `Rueda ${String(q.wheelNumber||'').padStart(4,'0')}`].join(' ').toUpperCase();
    return searchable.includes(search);
  }).sort((a,b)=>String(b.utc||'').localeCompare(String(a.utc||'')));
  $('historyCount').textContent=`${qs.length} contacto(s) encontrados · ${allQ.filter(q=>q.source==='ADIF').length} importados en este libro`;
  const body=$('historyRows');
  body.innerHTML=qs.length?qs.map(q=>{
    const imported=q.source==='ADIF';
    const origen=imported?`<span class="import-tag">ADI importado</span><small class="origin-file" title="Archivo: ${escapeHtml(q.importFile||'')}
Lote: ${escapeHtml(q.importBatchId||'')}">${escapeHtml(q.importFile||'')}</small>`:(q.wheelId?`Rueda ${String(q.wheelNumber).padStart(4,'0')}`:'Individual');
    return `<tr><td>${escapeHtml(q.date)}<br>${escapeHtml(q.time)}</td><td><strong>${escapeHtml(q.call)}</strong></td><td>${(Number(q.freq)/1000).toFixed(3)} MHz</td><td>${escapeHtml(q.band)} / ${escapeHtml(q.mode)}</td><td>${formatReport(q.rstSent)} / ${formatReport(q.rstRcvd)}</td><td>${escapeHtml(q.name)}</td><td>${escapeHtml(q.notes)}</td><td>${origen}</td><td>${imported?`<time title="${escapeHtml(q.importedAt||'')}" datetime="${escapeHtml(q.importedAt||'')}">${escapeHtml(QSOAdif.formattedDate(q.importedAt))}</time>`:'—'}</td><td><div class="row-actions"><button class="tiny" data-qso="${escapeHtml(q.id)}" data-action="edit">Editar</button><button class="tiny danger" data-qso="${escapeHtml(q.id)}" data-action="delete">Borrar</button></div></td></tr>`;
  }).join(''):'<tr><td colspan="10">No hay contactos con esos criterios.</td></tr>';
  body.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>historyAction(b.dataset.action,b.dataset.qso)));
}
$('searchHistory').addEventListener('input',renderHistory);
$('historyOrigin').addEventListener('change',renderHistory);
async function historyAction(action,id){const qs=await all('qsos');const q=qs.find(x=>x.id===id);if(!q)return;if(action==='delete'){if(!confirm(`¿Borrar definitivamente el QSO de ${q.call}?`))return;await remove('qsos',id);if(q.wheelId){const w=(await all('wheels')).find(x=>x.id===q.wheelId);if(w){w.people=w.people.filter(p=>p.qsoId!==id);w.updated=nowIso();await put('wheels',w)}}await renderHistory();await updateStats();return}if(q.wheelId){activeWheelId=q.wheelId;activateTab('rueda');const w=await wheelById();const p=w?.people.find(p=>p.qsoId===q.id);if(p)personAction('edit',p.id);return}editingQsoId=q.id;setReport('sent',q.rstSent);setReport('rcvd',q.rstRcvd);for(const [id,val] of Object.entries({date:q.date,time:q.time,freq:q.freq,band:q.band,mode:q.mode,call:q.call,name:q.name,city:q.city,region:q.region,country:q.country,locator:q.locator,notes:q.notes}))$(id).value=val??'';setModeOption('mode',q.mode);$('formTitle').textContent=`Editar QSO · ${q.call}`;$('saveQso').textContent='Guardar cambios';$('qsoReports').open=false;refreshQrzLinks();activateTab('qso');showRepeat();message('qsoMsg','Editando un QSO existente.')}
function adifField(name,value){if(value===null||value===undefined||value==='')return '';const s=String(value);return `<${name}:${new TextEncoder().encode(s).length}>${s} `}
function qsoAdif(q){
  const date=q.utc.slice(0,10).replace(/-/g,''),time=q.utc.slice(11,19).replace(/:/g,'');
  const data={
    CALL:q.call,STATION_CALLSIGN:q.sourceStationCall||OWN_CALL,QSO_DATE:date,TIME_ON:time,
    FREQ:q.adifFreq||(Number(q.freq)/1000).toFixed(3),BAND:q.band,
    MODE:q.adifMode||(q.mode==='LSB'||q.mode==='USB'?'SSB':q.mode),SUBMODE:q.adifSubmode||(!q.adifMode&&(q.mode==='LSB'||q.mode==='USB')?q.mode:''),
    RST_SENT:q.adifRstSent||q.rstSent,RST_RCVD:q.adifRstRcvd||q.rstRcvd,
    NAME:q.name,QTH:q.city,STATE:q.region,COUNTRY:q.country,GRIDSQUARE:q.locator,COMMENT:q.notes
  };
  if(q.source==='ADIF'){
    data.APP_QSOLOG_ORIGIN='ADIF';data.APP_QSOLOG_IMPORTED_AT=q.importedAt;
    data.APP_QSOLOG_IMPORT_FILE=q.importFile;
  }
  if(q.adifExtraFields&&typeof q.adifExtraFields==='object')for(const [name,value] of Object.entries(q.adifExtraFields)){
    if(/^[A-Z][A-Z0-9_]{0,63}$/.test(name)&&!(name in data))data[name]=value;
  }
  return Object.entries(data).map(([name,value])=>adifField(name,value)).join('')+'<EOR>\r\n';
}
async function exportAdif(){const qs=(await all('qsos')).sort((a,b)=>a.utc.localeCompare(b.utc));const header=`ADIF Export de QSO Log ${OWN_CALL}\r\n<ADIF_VER:5>3.1.4 <PROGRAMID:12>QSOLOGLW2HAR <EOH>\r\n`;download(`${OWN_CALL}_QSO_${localStamp().date}.adi`,header+qs.map(qsoAdif).join(''),'text/plain;charset=utf-8')}
$('exportAdif').addEventListener('click',exportAdif);$('exportAdifHistory').addEventListener('click',exportAdif);
// Importation never replaces existing QSOs: equal contacts are skipped before one atomic IndexedDB write.
async function bulkPutQsos(qsos){
  const db=await dbReady;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('qsos','readwrite');
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||Error('Error al guardar los contactos importados.'));
    tx.onabort=()=>reject(tx.error||Error('La importación se canceló.'));
    const store=tx.objectStore('qsos');
    for(const q of qsos)store.put(q);
  });
}
$('importAdifBtn').addEventListener('click',()=>$('importAdifFile').click());
$('importAdifFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  $('importAdifBtn').disabled=true;
  try{
    if(!/\.(adi|adif)$/i.test(file.name))throw Error('Elegí un archivo con extensión .adi o .adif.');
    if(file.size>20*1024*1024)throw Error('El archivo supera el límite de 20 MB.');
    if(!file.size)throw Error('El archivo está vacío.');
    message('importAdifMsg','Leyendo el archivo ADIF…');
    // setTimeout yields one paint before synchronous byte parsing on mobile devices.
    await new Promise(resolve=>setTimeout(resolve,0));
    const records=QSOAdif.parse(new Uint8Array(await file.arrayBuffer()));
    if(!records.length)throw Error('No se encontraron registros ADIF en el archivo.');
    const current=await all('qsos');
    const existing=new Set(current.map(QSOAdif.duplicateKey));
    const importedAt=nowIso(),batchId=uid(),accepted=[];
    let duplicated=0,invalid=0,mismatched=0;
    const invalidExamples=[];
    const foreignCalls=new Set();
    for(const [index,record] of records.entries()){
      try{
        const q=QSOAdif.toQso(record,OWN_CALL,file.name,importedAt,uid(),{bandMode,batchId});
        if(q.sourceStationCall&&q.sourceStationCall!==OWN_CALL){mismatched++;foreignCalls.add(q.sourceStationCall)}
        const key=QSOAdif.duplicateKey(q);
        if(existing.has(key)){duplicated++;continue}
        existing.add(key);
        accepted.push(q);
      }catch(error){invalid++;if(invalidExamples.length<3)invalidExamples.push(`N.º ${index+1}: ${error.message}`)}
    }
    if(!accepted.length){
      message('importAdifMsg',`No se incorporaron contactos. ${duplicated} duplicados; ${invalid} inválidos.${invalidExamples.length?' '+invalidExamples.join(' · '):''}`,invalid>0);
      return;
    }
    const mismatchNotice=mismatched?`\nAtención: ${mismatched} registros indican otra estación propia (${[...foreignCalls].slice(0,3).join(', ')}); conservaremos esa información en sus registros.`:'';
    const summary=`Archivo: ${file.name}\nRegistros encontrados: ${records.length}\nNuevos a importar: ${accepted.length}\nDuplicados omitidos: ${duplicated}\nInválidos omitidos: ${invalid}${mismatchNotice}\n\n¿Incorporar ${accepted.length} QSO a tu libro ${OWN_CALL}?`;
    if(!confirm(summary)){message('importAdifMsg','Importación cancelada. No se modificaron los contactos.');return}
    await bulkPutQsos(accepted);
    window.qsoSyncLocalChange?.();
    await updateStats();
    message('importAdifMsg',`✓ Importados ${accepted.length} QSO de ${file.name}. Fecha de importación: ${QSOAdif.formattedDate(importedAt)}. Duplicados omitidos: ${duplicated}. Inválidos: ${invalid}.${invalidExamples.length?' '+invalidExamples.join(' · '):''}`);
    if($('historial').classList.contains('active'))await renderHistory();
  }catch(error){message('importAdifMsg',`Error al importar: ${error.message}`,true)}
  finally{$('importAdifFile').value='';$('importAdifBtn').disabled=false}
});
$('backupJson').addEventListener('click',async()=>{const qsos=await all('qsos'),wheels=await all('wheels'),deletions=await all('deletions');const data={format:'QSOLOG-LW2HAR-BACKUP',version:2,ownCall:OWN_CALL,exportedUTC:nowIso(),qsos,wheels,deletions};download(`${OWN_CALL}_respaldo_${localStamp().date}.json`,JSON.stringify(data,null,2),'application/json;charset=utf-8');message('dataMsg',`✓ Respaldo creado: ${qsos.length} QSO y ${wheels.length} ruedas.`)});
$('stationForm').addEventListener('submit',event=>{event.preventDefault();const proposed=$('myCall').value.trim().toUpperCase();if(!isValidCall(proposed)){message('stationMsg','Ingresá una señal distintiva válida.',true);return}if(proposed===OWN_CALL){message('stationMsg','El indicativo ya está configurado.');return}if(!confirm(`¿Cambiar a ${proposed}? Cada indicativo tiene un libro local independiente. El libro de ${OWN_CALL} se conservará en este dispositivo.`))return;localStorage.setItem(CALL_KEY,proposed);location.reload()});
$('restoreBtn').addEventListener('click',()=>$('restoreFile').click());
$('restoreFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{const obj=JSON.parse(await file.text());if(obj.format!=='QSOLOG-LW2HAR-BACKUP'||obj.ownCall!==OWN_CALL||!Array.isArray(obj.qsos)||!Array.isArray(obj.wheels))throw Error('Archivo no compatible con QSO Log LW2HAR.');if(obj.qsos.length>50000||obj.wheels.length>10000)throw Error('La copia excede los límites de importación.');if(!obj.qsos.every(q=>typeof q.id==='string'&&typeof q.call==='string'&&typeof q.utc==='string')||!obj.wheels.every(w=>typeof w.id==='string'&&Array.isArray(w.people)))throw Error('La estructura de la copia es inválida.');if(!confirm(`¿Importar ${obj.qsos.length} QSO y ${obj.wheels.length} ruedas? Los registros con el mismo ID se actualizarán.`))return;for(const q of obj.qsos)await put('qsos',q);for(const w of obj.wheels)await put('wheels',w);for(const tombstone of (obj.deletions||[]))if(tombstone.store&&tombstone.recordId)await rawPut('deletions',tombstone);window.qsoSyncLocalChange?.();await updateStats();message('dataMsg','✓ Respaldo restaurado. Revisá el historial y las ruedas.')}catch(e){message('dataMsg',`Error: ${e.message}`,true)}finally{event.target.value=''}});
function locatorCoords(grid){const g=String(grid||'').toUpperCase();if(!isValidLocator(g)||!g)return null;let lon=(g.charCodeAt(0)-65)*20-180+Number(g[2])*2,lat=(g.charCodeAt(1)-65)*10-90+Number(g[3]);let lonSize=2,latSize=1;if(g.length>=6){lon+=(g.charCodeAt(4)-65)/12;lat+=(g.charCodeAt(5)-65)/24;lonSize=1/12;latSize=1/24}if(g.length===8){lon+=Number(g[6])/120;lat+=Number(g[7])/240;lonSize=1/120;latSize=1/240}return {lon:lon+lonSize/2,lat:lat+latSize/2}}
/* Mapa v1.5. Leaflet/OpenStreetMap. Geocodificación por localidad usando
 * Open-Meteo/GeoNames, sin servicios de Nominatim públicos ni claves privadas.
 * Sólo se consulta al mostrar el mapa y se cachean los resultados locales.
 */
let qsoLeafletMap=null;
let qsoMapLayer=null;
let qsoMapRenderSerial=0;
let leafletLoadPromise=null;
function loadQsoLeaflet(){
  if(window.L)return Promise.resolve();
  if(!navigator.onLine)return Promise.reject(Error('El mapa político necesita Internet para cargar la cartografía.'));
  if(leafletLoadPromise)return leafletLoadPromise;
  leafletLoadPromise=new Promise((resolve,reject)=>{
    const css=document.createElement('link');css.rel='stylesheet';
    css.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
    document.head.append(css);
    const js=document.createElement('script');js.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
    js.async=true;
    js.onload=()=>window.L?resolve():reject(Error('El visor del mapa no pudo inicializarse.'));
    js.onerror=()=>reject(Error('No se pudo descargar el mapa. Comprobá Internet e intentá nuevamente.'));
    document.head.append(js);
  }).catch(err=>{leafletLoadPromise=null;throw err});
  return leafletLoadPromise;
}
const QSO_GEO_CACHE_KEY=`qso-log-geo-cache-v1-${OWN_CALL}`;
function geoNorm(t){return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()}
function geoMatch(a,b){const x=geoNorm(a),y=geoNorm(b);return !!(x&&y&&(x===y||(x.length>=5&&y.includes(x))||(y.length>=5&&x.includes(y))))}
const countryCodes={argentina:'ar',brasil:'br',brazil:'br',chile:'cl',uruguay:'uy',paraguay:'py',bolivia:'bo',peru:'pe',mexico:'mx',colombia:'co',venezuela:'ve',espana:'es',spain:'es',unitedstates:'us',estadosunidos:'us',usa:'us',unitedkingdom:'gb',reinounido:'gb'};
function geoCountryMatches(wanted,entry){const n=geoNorm(wanted);if(!n)return true;const code=countryCodes[n.replace(/ /g,'')];return (code&&code===String(entry.country_code||'').toLowerCase())||geoMatch(wanted,entry.country)||n===String(entry.country_code||'').toLowerCase()}
function geoKey(q){return [q.city,q.region,q.country].map(geoNorm).join('|')}
function getGeoCache(){try{const c=JSON.parse(localStorage.getItem(QSO_GEO_CACHE_KEY)||'{}');return c&&typeof c==='object'&&!Array.isArray(c)?c:{}}catch{return {}}}
function saveGeoCache(c){try{const keys=Object.keys(c);if(keys.length>350)for(const k of keys.slice(0,keys.length-350))delete c[k];localStorage.setItem(QSO_GEO_CACHE_KEY,JSON.stringify(c))}catch{}}
async function geoCity(q,cache){
  const key=geoKey(q);
  if(Object.prototype.hasOwnProperty.call(cache,key))return cache[key];
  if(!navigator.onLine)return null;
  const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search=new URLSearchParams({name:q.city.trim(),count:'10',language:'es',format:'json'}).toString();
  const controller=new AbortController();const wait=setTimeout(()=>controller.abort(),9000);
  let data;
  try{
    const res=await fetch(url,{signal:controller.signal,mode:'cors'});
    if(!res.ok)throw Error('Error al buscar localidad');
    data=await res.json();
  }finally{clearTimeout(wait)}
  const exact=(data.results||[]).filter(r=>geoNorm(r.name)===geoNorm(q.city));
  const country=exact.filter(r=>geoCountryMatches(q.country,r));
  const region=country.filter(r=>!geoNorm(q.region)||geoMatch(q.region,r.admin1)||geoMatch(q.region,r.admin2));
  let record;
  if(region.length===1){
    const r=region[0];record={point:{lat:Number(r.latitude),lon:Number(r.longitude)},label:[r.name,r.admin1,r.country].filter(Boolean).join(', '),reason:'localidad'};
  } else if(region.length>1){
    record={point:null,reason:'Localidad ambigua: agregá provincia y país o un locator Maidenhead.'};
  } else if(exact.length){
    record={point:null,reason:'Localidad no coincide con provincia o país; revisá los datos o ingresá Maidenhead.'};
  }else{
    record={point:null,reason:'No se encontró esa localidad; ingresá Maidenhead para marcar el QSO.'};
  }
  cache[key]=record;saveGeoCache(cache);
  return record;
}
function ensureQsoLeaflet(){
  if(qsoLeafletMap)return true;
  if(!window.L)return false;
  qsoLeafletMap=L.map('qsoMap',{preferCanvas:true,worldCopyJump:true,zoomControl:true}).setView([-31.4,-64.2],4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom:18
  }).addTo(qsoLeafletMap);
  qsoMapLayer=L.layerGroup().addTo(qsoLeafletMap);
  return true;
}
async function renderMap(){
  const serial=++qsoMapRenderSerial;
  const qs=await all('qsos');
  if(serial!==qsoMapRenderSerial)return;
  const box=$('qsoMap');
  if(!window.L) {
    box.textContent='Cargando cartografía…';
    try {await loadQsoLeaflet();}
    catch(e){if(serial===qsoMapRenderSerial){box.textContent=e.message;$('mapCount').textContent=`${qs.length} QSO en el libro; guardado local disponible.`;}return;}
  }
  if(serial!==qsoMapRenderSerial)return;
  if(!qsoLeafletMap)box.replaceChildren();
  if(!ensureQsoLeaflet())return;
  // Se crea el mapa después de hacer visible la pestaña.
  setTimeout(()=>qsoLeafletMap?.invalidateSize(),120);
  qsoMapLayer.clearLayers();
  const bounds=[];const unlocated=[];let located=0;let byGrid=0;let byCity=0;
  const cache=getGeoCache();
  const unresolved=[];const cityQueries=new Map();
  function addPoint(q,point,source,label){
    if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon))return;
    const marker=L.circleMarker([point.lat,point.lon],{radius:7,color:'#fff',weight:2,fillColor:'#de2838',fillOpacity:.94});
    marker.bindPopup(`<strong>${escapeHtml(q.call||'')}</strong><br>${escapeHtml(q.date||'')} · ${escapeHtml(q.freq||'')} kHz<br>${escapeHtml([q.city,q.region,q.country].filter(Boolean).join(', '))}<br><small>${source==='locator'?'Locator: '+escapeHtml(q.locator||''):'Localidad aproximada: '+escapeHtml(label||'')}</small>`);
    marker.addTo(qsoMapLayer);bounds.push([point.lat,point.lon]);located++;
    if(source==='locator')byGrid++;else byCity++;
  }
  function reportUnlocated(q,reason){unlocated.push({q,reason});}
  for(const q of qs){
    const pt=locatorCoords(q.locator);
    if(pt){addPoint(q,{lat:pt.lat,lon:pt.lon},'locator',q.locator);continue;}
    if(!String(q.city||'').trim()){reportUnlocated(q,'Sin Maidenhead ni localidad');continue;}
    const key=geoKey(q);
    if(Object.prototype.hasOwnProperty.call(cache,key)){
      const item=cache[key];if(item?.point)addPoint(q,item.point,'localidad',item.label);
      else reportUnlocated(q,item?.reason||'Localidad no localizada');
      continue;
    }
    unresolved.push(q);
    if(!cityQueries.has(key))cityQueries.set(key,q);
  }
  function showResults(pending=0){
    if(serial!==qsoMapRenderSerial)return;
    $('mapCount').textContent=`${located} QSO ubicados: ${byGrid} por Maidenhead, ${byCity} por localidad. ${unlocated.length} sin ubicar.${pending?` ${pending} búsquedas de localidad pendientes.`:''}`;
    $('mapContacts').innerHTML=unlocated.slice(0,30).map(({q,reason})=>`<span class="unlocated" title="${escapeHtml(reason)}">${escapeHtml(q.call)} · ${escapeHtml(reason)}</span>`).join('');
    qsoLeafletMap.invalidateSize();
    if(bounds.length){qsoLeafletMap.fitBounds(bounds,{padding:[25,25],maxZoom:9});}
  }
  showResults(cityQueries.size);
  // El mapa se carga en pantalla por acción del usuario; no se hacen búsquedas en segundo plano.
  if(!navigator.onLine){
    for(const q of unresolved)reportUnlocated(q,'Sin Internet para consultar localidad');showResults();return;
  }
  const entries=[...cityQueries.entries()];
  const limit=25; // Previene ráfagas sobre un servicio comunitario en importaciones masivas.
  for(let i=0;i<Math.min(entries.length,limit);i++){
    if(serial!==qsoMapRenderSerial)return;
    const [key,sample]=entries[i];
    let result;
    try{result=await geoCity(sample,cache)}catch{result={point:null,reason:'No se pudo consultar esta localidad (red o servicio no disponible)'}}
    if(serial!==qsoMapRenderSerial)return;
    for(const q of unresolved.filter(v=>geoKey(v)===key)){
      if(result?.point)addPoint(q,result.point,'localidad',result.label);
      else reportUnlocated(q,result?.reason||'Localidad no localizada');
    }
    showResults(entries.length-i-1);
    if(i<Math.min(entries.length,limit)-1)await new Promise(done=>setTimeout(done,320));
  }
  if(entries.length>limit){
    for(const [key] of entries.slice(limit))for(const q of unresolved.filter(v=>geoKey(v)===key))reportUnlocated(q,'Pendiente de localizar; volvé a abrir el mapa');
  }
  showResults();
}

window.addEventListener('online',updateStats);window.addEventListener('offline',updateStats);
async function init(){for(const prefix of ['sent','rcvd','pSent','pRcvd'])reportSelectors(prefix);for(const id of ['sentR','sentS','rcvdR','rcvdS','pSentR','pSentS','pRcvdR','pRcvdS'])$(id).addEventListener('change',updateReportPreviews);updateReportPreviews();refreshQrzLinks();renderOwnCall();const s=localStamp();$('date').value=s.date;$('time').value=s.time;updateSingleBand();await dbReady;await updateStats();await renderWheels();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service Worker no instalado:',err))}
init().catch(error=>{console.error(error);$('connection').textContent='Error de almacenamiento';message('qsoMsg','El navegador no permitió abrir el almacenamiento local. Abrí la aplicación desde HTTPS y habilitá almacenamiento del sitio.',true)});
