/* QSO Log - ADIF 3.x reader. Works fully offline; ADIF field lengths count UTF-8 bytes. */
(function (global) {
  'use strict';
  const utf8 = new TextDecoder('utf-8');
  const headerFields = new Set(['ADIF_VER', 'PROGRAMID', 'PROGRAMVERSION', 'CREATED_TIMESTAMP', 'USERDEF1', 'USERDEF2']);
  const exportedFields = new Set(['CALL','STATION_CALLSIGN','OPERATOR','QSO_DATE','TIME_ON','QSO_DATE_OFF','TIME_OFF','FREQ','BAND','MODE','SUBMODE','RST_SENT','RST_RCVD','NAME','QTH','STATE','COUNTRY','GRIDSQUARE','COMMENT','NOTES','APP_QSOLOG_ORIGIN','APP_QSOLOG_IMPORTED_AT','APP_QSOLOG_IMPORT_FILE']);
  const MAX_RECORDS = 50000;
  const MAX_FIELD_BYTES = 300000;

  function parse(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const entries = [];
    let position = 0, fields = {}, header = true, fieldCount = 0;
    while (position < bytes.length) {
      while (position < bytes.length && bytes[position] !== 60) position++;
      if (position >= bytes.length) break;
      const start = position + 1;
      let close = start;
      while (close < bytes.length && close - start <= 180 && bytes[close] !== 62) close++;
      if (close >= bytes.length || bytes[close] !== 62) { position = start; continue; }
      const tag = new TextDecoder('ascii').decode(bytes.subarray(start, close)).trim().toUpperCase();
      position = close + 1;
      if (tag === 'EOH') { header = false; continue; }
      if (tag === 'EOR') {
        header = false;
        if (Object.keys(fields).length) {
          entries.push(fields);
          if (entries.length > MAX_RECORDS) throw Error('El archivo supera el máximo de 50.000 contactos por importación.');
        }
        fields = {};
        continue;
      }
      const m = /^([A-Z][A-Z0-9_]{0,63}):(\d{1,9})(?::([A-Z]))?$/.exec(tag);
      if (!m) continue;
      const size = Number(m[2]);
      if (size > MAX_FIELD_BYTES || position + size > bytes.length) throw Error('El archivo ADIF contiene un campo inválido o incompleto.');
      const name = m[1];
      let value = utf8.decode(bytes.subarray(position, position + size));
      if (value.includes('\uFFFD')) value = new TextDecoder('windows-1252').decode(bytes.subarray(position, position + size));
      position += size;
      if (header && !headerFields.has(name) && ['CALL', 'QSO_DATE', 'TIME_ON', 'FREQ', 'BAND'].includes(name)) header = false;
      if (!header) {
        fields[name] = value;
        fieldCount++;
        if (fieldCount > MAX_RECORDS * 200) throw Error('El archivo contiene demasiados campos ADIF.');
      }
    }
    if (Object.keys(fields).length) {
      // Some ADIF generators omit <EOR> on the final contact.
      entries.push(fields);
      if (entries.length > MAX_RECORDS) throw Error('El archivo supera el máximo de 50.000 contactos por importación.');
    }
    return entries;
  }

  function parseUtc(record) {
    const day = String(record.QSO_DATE || '').trim();
    const time = String(record.TIME_ON || '').trim();
    if (!/^\d{8}$/.test(day) || !/^\d{4}(\d{2})?$/.test(time)) throw Error('fecha u hora UTC ausente o inválida');
    const year = Number(day.slice(0,4)), month = Number(day.slice(4,6)), date = Number(day.slice(6,8));
    const hh = Number(time.slice(0,2)), mm = Number(time.slice(2,4)), ss = time.length === 6 ? Number(time.slice(4,6)) : 0;
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || hh > 23 || mm > 59 || ss > 59) throw Error('fecha u hora fuera de rango');
    const ms = Date.UTC(year, month - 1, date, hh, mm, ss);
    const d = new Date(ms);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month-1 || d.getUTCDate() !== date) throw Error('fecha UTC inexistente');
    return d;
  }

  function normalizeRs(input) {
    const original = String(input || '').trim().toUpperCase().replace(/\s+/g,'');
    if (!original) return {rs:'', original:''}; // Historical reports must not be invented.
    const clean = original.replace('/', '');
    if (/^[1-5](?:[1-9]|9\+)(?:[1-9])?$/.test(clean)) return {rs:clean.match(/^[1-5](?:9\+|[1-9])/)[0], original:original};
    return {rs:'', original:original}; // Keep unusual RST in original ADIF metadata.
  }

  function duplicateKey(q) {
    const utc = String(q.utc || '');
    return [String(q.call || '').trim().toUpperCase(), utc.slice(0,16), String(Math.round(Number(q.freq) || 0)), String(q.mode || '').trim().toUpperCase()].join('|');
  }

  function toQso(record, ownCall, fileName, importedAt, id, localDate) {
    const call = String(record.CALL || '').trim().toUpperCase();
    if (!/^[A-Z0-9/]{3,20}$/.test(call) || !/[A-Z]/.test(call) || !/[0-9]/.test(call)) throw Error('indicativo inválido');
    const utc = parseUtc(record);
    const mhz = Number(String(record.FREQ || '').trim().replace(',', '.'));
    if (!(mhz > 0) || !Number.isFinite(mhz) || mhz > 1300) throw Error('frecuencia ausente o inválida');
    const freq = Math.round(mhz * 1000);
    if (!(freq > 0)) throw Error('frecuencia inválida');
    const rawMode=String(record.MODE || '').trim().toUpperCase();
    const rawSubmode=String(record.SUBMODE || '').trim().toUpperCase();
    let mode = String(rawSubmode || rawMode || 'OTHER').slice(0,30);
    if (mode === 'SSB') mode = mhz < 10 ? 'LSB' : 'USB';
    if (!mode) mode = 'OTHER';
    // Normalize FT8/FT4 submodes while preserving any uncommon MODE/SUBMODE for later export.
    const bandMap = {'160M':'160m','80M':'80m','60M':'60m','40M':'40m','30M':'30m','20M':'20m','17M':'17m','15M':'15m','12M':'12m','10M':'10m','6M':'6m','2M':'2m','70CM':'70cm'};
    const band = bandMap[String(record.BAND || '').toUpperCase()] || localDate.bandMode(freq).band;
    const sent = normalizeRs(record.RST_SENT), received = normalizeRs(record.RST_RCVD);
    const date = [utc.getFullYear(), String(utc.getMonth()+1).padStart(2,'0'), String(utc.getDate()).padStart(2,'0')].join('-');
    const time = [String(utc.getHours()).padStart(2,'0'), String(utc.getMinutes()).padStart(2,'0')].join(':');
    const originalFields = {};
    for (const [key,value] of Object.entries(record)) {
      if (!exportedFields.has(key) && /^[A-Z][A-Z0-9_]{0,63}$/.test(key)) originalFields[key] = String(value).slice(0,300000);
    }
    return {
      id, ownCall, call, utc:utc.toISOString(), date, time, freq, band, mode,
      name:String(record.NAME || '').slice(0,250), city:String(record.QTH || '').slice(0,250),
      region:String(record.STATE || '').slice(0,250), country:String(record.COUNTRY || '').slice(0,250),
      locator:String(record.GRIDSQUARE || '').trim().toUpperCase().slice(0,12),
      notes:String(record.COMMENT || record.NOTES || '').slice(0,2000),
      rstSent:sent.rs, rstRcvd:received.rs, adifRstSent:sent.original, adifRstRcvd:received.original,
      adifMode:rawMode, adifSubmode:rawSubmode,
      adifFreq:String(record.FREQ || '').trim(), adifExtraFields:originalFields,
      source:'ADIF', importedAt, importFile:fileName.slice(0,180), importBatchId:localDate.batchId,
      sourceStationCall:String(record.STATION_CALLSIGN || '').trim().toUpperCase(),
      wheelId:null, wheelNumber:null, created:importedAt, updated:importedAt
    };
  }

  function formattedDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-AR', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  global.QSOAdif = {parse,parseUtc,normalizeRs,duplicateKey,toQso,formattedDate};
})(typeof window !== 'undefined' ? window : globalThis);
