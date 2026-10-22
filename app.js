'use strict';
const CALL_KEY='qso-log-own-call-v1';
let OWN_CALL=(localStorage.getItem(CALL_KEY)||'LW2HAR').trim().toUpperCase();
if(!/^[A-Z0-9/]{3,20}$/.test(OWN_CALL))OWN_CALL='LW2HAR';
// Keep LW2HAR's original IndexedDB database so all existing QSOs remain intact.
const DB_NAME=OWN_CALL==='LW2HAR'?'qso-log-lw2har-offline':`qso-log-user-${OWN_CALL.replace(/[^A-Z0-9]/g,'_')}-offline`;
function formatReport(report){return report&&/^[1-5](?:[1-9]|9\+)$/.test(report)?`${report[0]}/${report.slice(1)}`:'—'}
function reportSelectors(prefix){for(const suffix of ['R','S']){const el=$(prefix+suffix);el.innerHTML=['',...(suffix==='R'?[1,2,3,4,5]:[1,2,3,4,5,6,7,8,9,'9+'])].map(n=>`<option value="${n}">${n===''?'—':n}</option>`).join('')}setReport(prefix,'59')}
function setReport(prefix,value){const v=/^[1-5](?:[1-9]|9\+)$/.test(value||'')?value:'';$(prefix+'R').value=v?v[0]:'';$(prefix+'S').value=v?v.slice(1):''}
function getReport(prefix){const r=$(prefix+'R').value,s=$(prefix+'S').value;return r&&s?r+s:''}
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
function clearQsoForm(){editingQsoId=null;const s=localStamp();$('date').value=s.date;$('time').value=s.time;setReport('sent','59');setReport('rcvd','59');for(const id of ['call','name','city','region','country','locator','notes'])$(id).value='';$('formTitle').textContent='Registrar QSO';$('saveQso').textContent='Guardar QSO';$('repeatInfo').classList.add('hidden');message('qsoMsg','')}
$('resetQso').addEventListener('click',clearQsoForm);
function singleForm(){return {call:$('call').value.trim().toUpperCase(),name:$('name').value.trim(),city:$('city').value.trim(),region:$('region').value.trim(),country:$('country').value.trim(),locator:$('locator').value.trim().toUpperCase(),notes:$('notes').value.trim(),rstSent:getReport('sent'),rstRcvd:getReport('rcvd'),date:$('date').value,time:$('time').value,freq:Number($('freq').value),band:$('band').value,mode:$('mode').value}}
$('qsoForm').addEventListener('submit',async event=>{event.preventDefault();try{const data=singleForm();if(!isValidCall(data.call))throw Error('Ingresá un indicativo válido.');if(!Number.isInteger(data.freq)||data.freq<=0)throw Error('La frecuencia debe ser un número entero en kHz.');if(!data.date||!data.time)throw Error('Ingresá fecha y hora.');if(!isValidLocator(data.locator))throw Error('Locator no válido; usá por ejemplo FF78 o FF78AB.');const prev=editingQsoId?(await all('qsos')).find(q=>q.id===editingQsoId):null;const qso={...(prev||{}),...data,id:editingQsoId||uid(),ownCall:OWN_CALL,utc:prev&&prev.date===data.date&&prev.time===data.time?prev.utc:localToUTC(data.date,data.time),wheelId:null,wheelNumber:null,created:prev?.created||nowIso(),updated:nowIso(),adifRstSent:prev?.rstSent===data.rstSent?prev?.adifRstSent||'':'',adifRstRcvd:prev?.rstRcvd===data.rstRcvd?prev?.adifRstRcvd||'':'',adifFreq:prev?.freq===data.freq?prev?.adifFreq||'':'',adifMode:prev?.mode===data.mode?prev?.adifMode||'':'',adifSubmode:prev?.mode===data.mode?prev?.adifSubmode||'':''};await put('qsos',qso);clearQsoForm();message('qsoMsg',`✓ QSO de ${data.call} guardado en este dispositivo.`);await updateStats()}catch(error){message('qsoMsg',error.message,true)}});
async function showRepeat(){const call=$('call').value.trim().toUpperCase();const matches=(await all('qsos')).filter(q=>q.call===call&&q.id!==editingQsoId);const box=$('repeatInfo');box.classList.toggle('hidden',!matches.length);if(matches.length){const latest=matches.slice().sort((a,b)=>b.utc.localeCompare(a.utc))[0];box.innerHTML=`🔁 <strong>Indicativo repetido: ${escapeHtml(call)}</strong>. ${matches.length} QSO anterior(es). Último: ${escapeHtml(latest.date)}, ${escapeHtml(latest.freq)} kHz. <button type="button" class="tiny" id="seeRepeats">Ver historial</button>`;$('seeRepeats').onclick=()=>{$('searchHistory').value=call;activateTab('historial')}}}
$('call').addEventListener('input',()=>{const pos=$('call').selectionStart;$('call').value=$('call').value.toUpperCase();try{$('call').setSelectionRange(pos,pos)}catch{}showRepeat()});
$('qrzInfo').addEventListener('click',()=>message('qsoMsg','La consulta QRZ estará disponible cuando conectemos una integración autorizada. Por ahora completá los datos manualmente.'));
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
function resetParticipant(){editingPersonId=null;setReport('pSent','59');setReport('pRcvd','59');for(const id of ['pCall','pName','pCity','pRegion','pCountry','pLocator','pNotes'])$(id).value='';$('participantTitle').textContent='Agregar participante';$('savePerson').textContent='Agregar participante'}
$('cancelPerson').addEventListener('click',resetParticipant);
async function savePersonQso(w,p){const qs=await all('qsos');const previous=qs.find(q=>q.id===p.qsoId);const tag=`Rueda ${String(w.number).padStart(4,'0')}`;const notes=p.notes?`${p.notes} · ${tag}`:tag;const q={id:p.qsoId,ownCall:OWN_CALL,rstSent:p.rstSent||previous?.rstSent||'',rstRcvd:p.rstRcvd||previous?.rstRcvd||'',call:p.call,name:p.name,city:p.city,region:p.region,country:p.country,locator:p.locator,notes,date:w.date,time:w.time,utc:localToUTC(w.date,w.time),freq:Number(w.freq),band:w.band,mode:w.mode,wheelId:w.id,wheelNumber:w.number,created:previous?.created||nowIso(),updated:nowIso()};await put('qsos',q)}
$('personForm').addEventListener('submit',async e=>{e.preventDefault();const w=await wheelById();if(!w)return;try{const d=participantForm();if(!isValidCall(d.call))throw Error('Indicativo inválido.');if(!isValidLocator(d.locator))throw Error('Locator no válido.');if(w.people.some(p=>p.call===d.call&&p.id!==editingPersonId))throw Error('Ese indicativo ya está en esta rueda.');let p;if(editingPersonId){p=w.people.find(x=>x.id===editingPersonId);if(!p)throw Error('Participante no encontrado.');Object.assign(p,d)}else{p={...d,id:uid(),qsoId:uid(),state:'Activo'};w.people.push(p)}w.updated=nowIso();await put('wheels',w);await savePersonQso(w,p);const savedCall=p.call;resetParticipant();await renderWheels();await updateStats();message('wheelMsg',`✓ ${savedCall} guardado en Rueda ${String(w.number).padStart(4,'0')}.`)}catch(error){message('wheelMsg',error.message,true)}});
function renderPeople(w){const active=w.people.filter(p=>p.state==='Activo');if(!active.some(p=>p.id===currentSpeakerId))currentSpeakerId=active[0]?.id||null;const speaker=active.find(p=>p.id===currentSpeakerId);$('speakerName').textContent=speaker?`${speaker.call}${speaker.name?' · '+speaker.name:''}`:'—';$('nextSpeaker').disabled=!active.length;$('peopleRows').innerHTML=w.people.map((p,i)=>`<tr class="${p.state==='Retirado'?'retired':''} ${p.id===currentSpeakerId?'speaking':''}"><td>${i+1}</td><td><strong>${escapeHtml(p.call)}</strong></td><td>${escapeHtml(p.name)}</td><td>${escapeHtml([p.city,p.region,p.country].filter(Boolean).join(', '))}</td><td>${formatReport(p.rstSent)} / ${formatReport(p.rstRcvd)}</td><td>${escapeHtml(p.state)}</td><td><div class="row-actions"><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="up" aria-label="Subir">↑</button><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="down" aria-label="Bajar">↓</button><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="toggle">${p.state==='Activo'?'Retirar':'Reactivar'}</button><button class="tiny" data-person="${escapeHtml(p.id)}" data-action="edit">Editar</button><button class="tiny danger" data-person="${escapeHtml(p.id)}" data-action="delete">Quitar</button></div></td></tr>`).join('');$('peopleRows').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>personAction(b.dataset.action,b.dataset.person)))}
$('nextSpeaker').addEventListener('click',async()=>{const w=await wheelById();if(!w)return;const ps=w.people.filter(p=>p.state==='Activo');if(!ps.length)return;const idx=ps.findIndex(p=>p.id===currentSpeakerId);currentSpeakerId=ps[(idx+1)%ps.length].id;renderPeople(w)});
async function personAction(action,id){const w=await wheelById();if(!w)return;const i=w.people.findIndex(p=>p.id===id),p=w.people[i];if(!p)return;if(action==='edit'){editingPersonId=id;setReport('pSent',p.rstSent);setReport('pRcvd',p.rstRcvd);for(const [key,val] of Object.entries({pCall:p.call,pName:p.name,pCity:p.city,pRegion:p.region,pCountry:p.country,pLocator:p.locator,pNotes:p.notes}))$(key).value=val||'';$('participantTitle').textContent=`Editar ${p.call}`;$('savePerson').textContent='Guardar cambios';$('pCall').focus();return}if(action==='delete'){if(!confirm(`¿Quitar a ${p.call} de esta rueda y borrar su QSO asociado?`))return;w.people.splice(i,1);await remove('qsos',p.qsoId);if(editingPersonId===id)resetParticipant()}if(action==='toggle')p.state=p.state==='Activo'?'Retirado':'Activo';if(action==='up'&&i>0)[w.people[i-1],w.people[i]]=[w.people[i],w.people[i-1]];if(action==='down'&&i<w.people.length-1)[w.people[i+1],w.people[i]]=[w.people[i],w.people[i+1]];w.updated=nowIso();await put('wheels',w);await renderWheels();await updateStats()}
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
async function historyAction(action,id){const qs=await all('qsos');const q=qs.find(x=>x.id===id);if(!q)return;if(action==='delete'){if(!confirm(`¿Borrar definitivamente el QSO de ${q.call}?`))return;await remove('qsos',id);if(q.wheelId){const w=(await all('wheels')).find(x=>x.id===q.wheelId);if(w){w.people=w.people.filter(p=>p.qsoId!==id);w.updated=nowIso();await put('wheels',w)}}await renderHistory();await updateStats();return}if(q.wheelId){activeWheelId=q.wheelId;activateTab('rueda');const w=await wheelById();const p=w?.people.find(p=>p.qsoId===q.id);if(p)personAction('edit',p.id);return}editingQsoId=q.id;setReport('sent',q.rstSent);setReport('rcvd',q.rstRcvd);for(const [id,val] of Object.entries({date:q.date,time:q.time,freq:q.freq,band:q.band,mode:q.mode,call:q.call,name:q.name,city:q.city,region:q.region,country:q.country,locator:q.locator,notes:q.notes}))$(id).value=val??'';setModeOption('mode',q.mode);$('formTitle').textContent=`Editar QSO · ${q.call}`;$('saveQso').textContent='Guardar cambios';activateTab('qso');showRepeat();message('qsoMsg','Editando un QSO existente.')}
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
function svgEl(tag,attrs={},text=''){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,String(v)));if(text)node.textContent=text;return node}
async function renderMap(){const qs=(await all('qsos')).map(q=>({q,point:locatorCoords(q.locator)})).filter(v=>v.point);const svg=$('locatorMap');svg.replaceChildren();svg.append(svgEl('rect',{x:0,y:0,width:900,height:450,fill:'#0d2a3a'}));for(let x=0;x<=900;x+=90){svg.append(svgEl('line',{x1:x,y1:0,x2:x,y2:450,stroke:'#3b5868','stroke-width':.8}));svg.append(svgEl('text',{x:x+3,y:18,fill:'#779bab','font-size':11},`${Math.round(x/900*360-180)}°`))}for(let y=0;y<=450;y+=45){svg.append(svgEl('line',{x1:0,y1:y,x2:900,y2:y,stroke:'#3b5868','stroke-width':.8}));svg.append(svgEl('text',{x:6,y:y+13,fill:'#779bab','font-size':11},`${Math.round(90-y/450*180)}°`))}for(const {q,point} of qs){const x=(point.lon+180)/360*900,y=(90-point.lat)/180*450;const dot=svgEl('circle',{cx:x,cy:y,r:5,fill:'#58e5cd',stroke:'#092c35','stroke-width':2});dot.append(svgEl('title',{},`${q.call} · ${q.locator} · ${q.date}`));svg.append(dot)}$('mapCount').textContent=qs.length?`${qs.length} QSO con locator válido. Los puntos pueden superponerse.`:'Todavía no hay QSO con locator Maidenhead válido.';$('mapContacts').innerHTML=qs.slice(0,50).map(({q})=>`<span><strong>${escapeHtml(q.call)}</strong> · ${escapeHtml(q.locator)}</span>`).join('')}
window.addEventListener('online',updateStats);window.addEventListener('offline',updateStats);
async function init(){for(const prefix of ['sent','rcvd','pSent','pRcvd'])reportSelectors(prefix);renderOwnCall();const s=localStamp();$('date').value=s.date;$('time').value=s.time;updateSingleBand();await dbReady;await updateStats();await renderWheels();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service Worker no instalado:',err))}
init().catch(error=>{console.error(error);$('connection').textContent='Error de almacenamiento';message('qsoMsg','El navegador no permitió abrir el almacenamiento local. Abrí la aplicación desde HTTPS y habilitá almacenamiento del sitio.',true)});
