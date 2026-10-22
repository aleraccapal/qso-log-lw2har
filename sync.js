/* QSO Log v1.4.1 – sincronización autorizada con Drive/Sheets.
 * Un archivo de Google Sheets por cuenta Google y señal distintiva.
 * EVENTOS contiene el registro append-only; QSO/RUEDAS/PARTICIPANTES son vistas.
 * No utiliza API_KEY de Apps Script ni contraseñas. Token OAuth sólo en RAM.
 */
'use strict';
(function () {
  const AUTH_SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
  const GOOGLE_SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const GOOGLE_DRIVE = 'https://www.googleapis.com/drive/v3/files';
  const tabNames = ['QSO', 'RUEDAS', 'PARTICIPANTES', 'CONFIGURACION', 'EVENTOS'];
  const headers = {
    QSO: ['QSO_ID','Fecha_local','Hora_local','Fecha_UTC','Hora_UTC','Frecuencia_kHz','Banda','Modo','Indicativo_propio','SD_corresponsal','Nombre','Localidad','Provincia_region','Pais','Locator','Observaciones','Rueda_numero','RST_SENT','RST_RCVD','Origen','Archivo_importacion','Fecha_importacion_UTC','Actualizado_UTC'],
    RUEDAS: ['Rueda_ID','Numero','Fecha_local','Hora_local','Frecuencia_kHz','Banda','Modo','Estado','Observaciones','Actualizado_UTC'],
    PARTICIPANTES: ['Participante_ID','Rueda_ID','Numero_rueda','Orden','SD','Nombre','Localidad','Provincia_region','Pais','Locator','RST_SENT','RST_RCVD','Estado','Observaciones','QSO_ID','Actualizado_UTC'],
    CONFIGURACION: ['Campo','Valor'],
    EVENTOS: ['Evento_ID','Coleccion','Registro_ID','Actualizado_UTC','Eliminado','Datos_JSON','Indicativo_propio']
  };
  // Solo en la pestaña activa: la autorización vence y no queda en localStorage.
  const AUTH_SESSION_KEY = `qso-google-oauth-session-${OWN_CALL}`;
  let token = null;
  let expires = 0;
  function discardSession(){ token=null;expires=0;try{sessionStorage.removeItem(AUTH_SESSION_KEY);}catch{}}
  function saveSession(){
    try {sessionStorage.setItem(AUTH_SESSION_KEY,JSON.stringify({accessToken:token,expires,email}));} catch{}
  }

  let client = null;
  let email = '';
  let bookId = '';
  let syncing = false;
  let syncAgain = false;
  let timer = 0;
  let applyingRemote = false;
  const ownerKey = `qso-sync-owner-${OWN_CALL}`;
  const docKey = address => `qso-sync-sheet-${address.toLowerCase()}-${OWN_CALL}`;
  const byId = arr => new Map(arr.map(x => [String(x.id), x]));
  const updateLabel = (msg, error = false) => message('syncMsg', msg, error);
  const cleanTime = obj => String(obj.updated || obj.created || '1970-01-01T00:00:00.000Z');

  async function api(url, options = {}) {
    if (!navigator.onLine) throw Error('No hay conexión a Internet. Los cambios siguen guardados localmente.');
    if (!token || Date.now() > expires - 60000) {
      discardSession();
      throw Error('La autorización de Google caducó. Pulsá «Conectar Google» para renovarla.');
    }
    const response = await fetch(url, {
      ...options,
      headers: {Authorization:`Bearer ${token}`, ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {})}
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch {data = {};}
    if (!response.ok) {
      if (response.status === 401) {discardSession();showStatus();}
      const reason = data?.error?.message || data?.error_description || raw.slice(0,220) || response.statusText;
      throw Error(`Google (${response.status}): ${reason}`);
    }
    return data;
  }
  function range(tab, cells) { return `'${tab}'!${cells}`; }
  function valuesUrl(tab, cells) { return `${GOOGLE_SHEETS}/${encodeURIComponent(bookId)}/values/${encodeURIComponent(range(tab,cells))}`; }
  function showStatus() {
    const status = $('syncStatus');
    const ready = Boolean(token && Date.now() < expires - 60000 && email);
    status.textContent = !navigator.onLine ? 'Sin Internet · cambios guardados localmente'
      : ready ? `Conectado: ${email}` : (localStorage.getItem(ownerKey) ? `Cuenta vinculada: ${localStorage.getItem(ownerKey)} · renová el acceso si caducó` : 'Google Drive sin conectar · guardado local');
    $('syncNow').disabled = !navigator.onLine;
    $('syncConnect').textContent = ready ? 'Renovar acceso Google' : 'Conectar Google';
    $('syncSheet').classList.toggle('hidden', !bookId);
    if (bookId) $('syncSheet').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(bookId)}/edit`;
  }
  async function currentEmail() {
    const res = await api('https://www.googleapis.com/oauth2/v3/userinfo');
    if (!res.email || !res.email_verified) throw Error('Google no pudo verificar tu correo electrónico.');
    const identity = String(res.email).toLowerCase();
    const linked = localStorage.getItem(ownerKey);
    if (linked && linked !== identity) {
      discardSession();
      throw Error(`El libro local ${OWN_CALL} ya está vinculado con ${linked}. No se mezclarán los datos de otra cuenta.`);
    }
    // Never bind an account until Google confirms its identity.
    localStorage.setItem(ownerKey, identity);
    email = identity;
    bookId = localStorage.getItem(docKey(identity)) || '';
    saveSession();
    showStatus();
  }
  function getClient() {
    const clientId = String(window.QSO_GOOGLE_CLIENT_ID || '').trim();
    if (!clientId || !/\.apps\.googleusercontent\.com$/.test(clientId))
      throw Error('Falta configurar el ID de cliente OAuth de Google.');
    if (!window.google?.accounts?.oauth2)
      throw Error('No se pudo cargar Google Identity Services. Comprobá Internet y recargá la aplicación.');
    if (!client) {
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: AUTH_SCOPE,
        callback: async response => {
          try {
            if (response.error) throw Error(response.error_description || response.error);
            if (!response.access_token) throw Error('Google no devolvió un token de autorización.');
            token = response.access_token;
            expires = Date.now() + Number(response.expires_in || 3600) * 1000;
            await currentEmail();
            await synchronize();
          } catch (err) {updateLabel(err.message, true);showStatus();}
        },
        error_callback: err => updateLabel(err.type === 'popup_closed' ? 'Se cerró la ventana de Google sin autorizar.' : 'No pudo abrirse la autorización de Google.', true)
      });
    }
    return client;
  }
  $('syncConnect').addEventListener('click', () => {
    try {getClient().requestAccessToken({prompt:''});updateLabel('Autorizá el acceso en la ventana de Google.');}
    catch (err) {updateLabel(err.message,true);}
  });
  $('syncNow').addEventListener('click', async () => {
    if (!token || Date.now() > expires - 60000) {
      try {getClient().requestAccessToken({prompt:''});updateLabel('Autorizá la cuenta Google para sincronizar.');}
      catch (err) {updateLabel(err.message,true);}
    } else await synchronize();
  });

  async function getOrCreateSheet() {
    if (bookId) {
      try {
        const b = await api(`${GOOGLE_SHEETS}/${encodeURIComponent(bookId)}?fields=spreadsheetId`);
        if (b.spreadsheetId) return bookId;
      } catch (error) {
        // A stale/deleted link is an error; don't create another book silently.
        throw Error(`No se pudo abrir tu planilla vinculada: ${error.message}`);
      }
    }
    const title = `QSO Log - ${OWN_CALL}`;
    const q = `name = '${title.replace(/'/g,"\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
    const params = new URLSearchParams({q, fields:'nextPageToken,files(id,name,createdTime)',pageSize:'100',orderBy:'createdTime'});
    const list = await api(`${GOOGLE_DRIVE}?${params}`);
    if (list.files?.length) {
      bookId = list.files[0].id;
      if (list.files.length > 1) updateLabel('Hay varias planillas con el mismo nombre; se usará la más antigua.');
    } else {
      const body = {
        properties:{title},
        sheets:tabNames.map(name=>({properties:{title:name,gridProperties:{frozenRowCount:1}}}))
      };
      const sheet = await api(GOOGLE_SHEETS, {method:'POST',body:JSON.stringify(body)});
      bookId = sheet.spreadsheetId;
      const head = Object.entries(headers).map(([tab,columns])=>({range:range(tab,'A1'),values:[columns]}));
      await api(`${GOOGLE_SHEETS}/${encodeURIComponent(bookId)}/values:batchUpdate`,{
        method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:head})
      });
    }
    if (!bookId) throw Error('No se pudo identificar la planilla de Google Sheets.');
    localStorage.setItem(docKey(email),bookId);
    showStatus();
    return bookId;
  }

  function parseEvents(rows) {
    const versions = new Map();
    for (const row of rows) {
      const [eventId,collection,id,updated,deleted,json,sourceCall] = row;
      if (!['qsos','wheels'].includes(collection) || !id || !updated || sourceCall !== OWN_CALL) continue;
      const version = {eventId:String(eventId||''),store:collection,id:String(id),updated:String(updated),deleted:deleted==='SI',raw:json||''};
      const previous = versions.get(`${collection}:${id}`);
      if (!previous || version.updated > previous.updated || (version.updated===previous.updated && version.eventId>previous.eventId))
        versions.set(`${collection}:${id}`,version);
    }
    return versions;
  }
  async function readRemoteEvents() {
    const data = await api(valuesUrl('EVENTOS','A2:G')); // 5-7 values per event; JSON is column F.
    return parseEvents(data.values || []);
  }
  async function remoteUpsert(remote) {
    if (remote.deleted) {
      await rawRemove(remote.store,remote.id);
      await rawPut('deletions',{id:`${remote.store}:${remote.id}`,store:remote.store,recordId:remote.id,updated:remote.updated});
      return;
    }
    let obj;
    try {obj=JSON.parse(remote.raw);} catch {throw Error(`Datos JSON dañados en el registro ${remote.id} de la planilla.`);}
    if (!obj || obj.id!==remote.id || obj.ownCall!==OWN_CALL)
      throw Error(`El registro ${remote.id} no pertenece a ${OWN_CALL}.`);
    await rawPut(remote.store,obj);
    await rawRemove('deletions',`${remote.store}:${remote.id}`);
  }
  async function readLocalVersions() {
    const qsos = await all('qsos');
    const wheels = await all('wheels');
    const dels = await all('deletions');
    const result = new Map();
    for (const [store,arr] of [['qsos',qsos],['wheels',wheels]]) {
      for (const obj of arr) result.set(`${store}:${obj.id}`,{store,id:obj.id,updated:cleanTime(obj),deleted:false,obj});
    }
    for (const deletion of dels) {
      const key = `${deletion.store}:${deletion.recordId}`;
      const existing = result.get(key);
      if (!existing || deletion.updated > existing.updated)
        result.set(key,{store:deletion.store,id:deletion.recordId,updated:deletion.updated,deleted:true,obj:null});
    }
    return result;
  }
  const makeEvent = item => [uid(),item.store,item.id,item.updated,item.deleted?'SI':'NO',item.deleted?'':JSON.stringify(item.obj),OWN_CALL];
  async function sendEvents(rows) {
    if (!rows.length) return;
    // Divided batches avoid an oversized API request on large imported ADIF files.
    for (let i=0; i<rows.length; i+=100) {
      const batch=rows.slice(i,i+100);
      await api(`${valuesUrl('EVENTOS','A:G')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method:'POST',body:JSON.stringify({values:batch})
      });
    }
  }
  function qsoRow(q) {
    const utc=String(q.utc||'');
    return [q.id,q.date||'',q.time||'',utc.slice(0,10),utc.slice(11,19),q.freq||'',q.band||'',q.mode||'',q.ownCall||OWN_CALL,q.call||'',q.name||'',q.city||'',q.region||'',q.country||'',q.locator||'',q.notes||'',q.wheelNumber||'',q.adifRstSent||q.rstSent||'',q.adifRstRcvd||q.rstRcvd||'',q.source||'APP',q.importFile||'',q.importedAt||'',q.updated||''];
  }
  function wheelRow(w) {return [w.id,w.number,w.date,w.time,w.freq,w.band,w.mode,w.state,w.notes||'',w.updated||''];}
  function personRows(w) {return (w.people||[]).map((p,i)=>[p.id,w.id,w.number,i+1,p.call,p.name,p.city,p.region,p.country,p.locator,p.rstSent||'',p.rstRcvd||'',p.state,p.notes||'',p.qsoId,p.updated||w.updated]);}
  async function refreshReadableTabs() {
    const qs=(await all('qsos')).sort((a,b)=>String(a.utc).localeCompare(String(b.utc)));
    const ws=(await all('wheels')).sort((a,b)=>a.number-b.number);
    const data={
      QSO:[headers.QSO,...qs.map(qsoRow)],
      RUEDAS:[headers.RUEDAS,...ws.map(wheelRow)],
      PARTICIPANTES:[headers.PARTICIPANTES,...ws.flatMap(personRows)],
      CONFIGURACION:[headers.CONFIGURACION,['Indicativo',OWN_CALL],['Usuario_Google',email],['Version','QSO Log v1.5'],['Ultima_sincronizacion',nowIso()]]
    };
    // Views are only projections; EVENTOS is the authoritative append-only log.
    // Avoid deleting user data from EVENTOS, and don't rewrite it at all.
    for (const tab of Object.keys(data)) {
      await api(`${valuesUrl(tab,'A:W')}:clear`,{method:'POST',body:'{}'});
      const values=data[tab];
      for(let i=0;i<values.length;i+=500){
        const part=values.slice(i,i+500);
        await api(`${valuesUrl(tab,`A${i+1}`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:part})});
      }
    }
  }
  async function synchronize() {
    if (syncing) {syncAgain=true;return;}
    if (!navigator.onLine) {showStatus();return;}
    if (!token || Date.now() >= expires-60000 || !email) {showStatus();return;}
    syncing = true;
    try {
      updateLabel('Sincronizando QSO y ruedas…');
      await getOrCreateSheet();
      const remote=await readRemoteEvents();
      const local=await readLocalVersions();
      const push=[];
      applyingRemote=true;
      try {
        for (const [key,item] of local) {
          const r=remote.get(key);
          if (!r || item.updated > r.updated) push.push(makeEvent(item));
          else if (r.updated > item.updated) await remoteUpsert(r);
        }
        for (const [key,r] of remote) if (!local.has(key)) await remoteUpsert(r);
      } finally {applyingRemote=false;}
      await sendEvents(push);
      // Reload after appending to merge concurrent activity on other devices.
      const newest = await readRemoteEvents();
      const again = await readLocalVersions();
      applyingRemote=true;
      try {
        for (const [key,r] of newest) {
          const own=again.get(key);
          if (!own || r.updated>own.updated) await remoteUpsert(r);
        }
      } finally {applyingRemote=false;}
      await refreshReadableTabs();
      await updateStats();
      if ($('historial').classList.contains('active')) await renderHistory();
      if ($('rueda').classList.contains('active')) await renderWheels();
      if ($('mapa').classList.contains('active')) await renderMap();
      updateLabel(`✓ Sincronizado ${new Date().toLocaleString('es-AR')} · ${push.length} cambio(s) enviados.`);
    } catch (error) {updateLabel(`No se pudo sincronizar: ${error.message}`,true);}
    finally {syncing=false;showStatus();if(syncAgain){syncAgain=false;setTimeout(synchronize,1500);}}
  }
  function schedule() {
    if (applyingRemote || !navigator.onLine || !token || !email) return;
    clearTimeout(timer);
    timer=setTimeout(synchronize,1200);
  }
  window.qsoSyncLocalChange=schedule;
  window.addEventListener('online',()=>{showStatus();schedule();});
  window.addEventListener('offline',showStatus);
  window.addEventListener('focus',()=>{if(token && email && Date.now()<expires-60000) schedule();});
  // Recupera la misma autorización de corta duración cuando se recarga esta pestaña.
  // Google sigue exigiendo una nueva autorización al caducar o cerrar la sesión del navegador.
  try {
    const saved=JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY)||'null');
    const linked=localStorage.getItem(ownerKey);
    if(saved && saved.accessToken && saved.expires > Date.now()+60000 && saved.email === linked){
      token=String(saved.accessToken);expires=Number(saved.expires);email=String(saved.email);
      bookId=localStorage.getItem(docKey(email)) || '';
      setTimeout(async()=>{try {await currentEmail();await synchronize();} catch(error){discardSession();updateLabel(`Requiere reconectar Google: ${error.message}`,true);showStatus();}},350);
    }else if(saved)discardSession();
  } catch {discardSession();}
  showStatus();
})();
