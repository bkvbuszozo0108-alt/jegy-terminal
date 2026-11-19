/*  Járműnapló – szerver Google Táblázatban (Apps Script)
    - lekérdezi a BKK FUTÁR nyílt adatait (a BKK API-kulcs itt marad, nem kerül a nyilvános oldalra),
    - gyűjti a forgalomban látott járműveket (Jarmuvek lap),
    - tárolja a szolgálatokat és a járművenkénti bejegyzéseket (Szolgalat, Bejegyzesek lap),
    - a fotókat a Google Drive-od „Járműnapló fotók” mappájába menti (nem nyilvánosak).
    Telepítés: README.md ebben a mappában.                                                      */

var KULCS     = 'VALTOZTASD-MEG';             // ← az app kulcsa (ezt írod be a telefonon)
var BKK_KULCS = 'IDE-A-BKK-API-KULCS';        // ← a BKK opendata API-kulcsod

var API  = 'https://futar.bkk.hu/api/query/v1/ws/otp/api/where/';
var BBOX = {lat: 47.4925, lon: 19.0513, latSpan: 0.42, lonSpan: 0.70};   // Budapest + agglomeráció
var FOLDER = 'Járműnapló fotók';

/* ---------------- BKK FUTÁR ---------------- */
function bkk_(path, params){
  params = params || {};
  params.key = BKK_KULCS; params.version = '3'; params.appVersion = 'jarmunaplo-1.0';
  var q = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');
  var r = UrlFetchApp.fetch(API + path + '.json?' + q, {muteHttpExceptions: true, headers: {'Accept': 'application/json'}});
  var code = r.getResponseCode(), txt = r.getContentText();
  if (code !== 200) throw new Error('BKK ' + code + ': ' + txt.slice(0, 200));
  var j = JSON.parse(txt);
  if (j.status && j.status !== 'OK') throw new Error('BKK ' + j.status + ': ' + (j.text || ''));
  return j;
}
function cat_(t){
  t = String(t || '').toUpperCase();
  if (t === 'TRAM') return 'villamos';
  if (t === 'TROLLEYBUS') return 'troli';
  if (t === 'SUBWAY') return 'metro';
  if (t === 'RAIL' || t === 'SUBURBAN_RAILWAY') return 'hev';
  if (t === 'FERRY') return 'hajo';
  if (t === 'BUS' || t === 'COACH') return 'busz';
  return 'egyeb';
}
function normVeh_(v, routes, trips){
  var r = routes[v.routeId] || {}, t = trips[v.tripId] || {};
  var loc = v.location || {};
  return {
    id: v.vehicleId || '', plate: v.licensePlate || '', label: v.label || '', model: v.model || '',
    type: cat_(v.vehicleRouteType || r.type), route: r.shortName || '', routeId: v.routeId || '',
    color: r.color || '', textColor: r.textColor || '', headsign: t.tripHeadsign || r.description || '',
    tripId: v.tripId || '', lat: loc.lat, lon: loc.lon, bearing: v.bearing, status: v.status || '',
    stopId: v.stopId || '', deviated: !!v.deviated, upd: v.lastUpdateTime || 0
  };
}
function liveFetch_(){
  var j = bkk_('vehicles-for-location', {lat: BBOX.lat, lon: BBOX.lon, latSpan: BBOX.latSpan, lonSpan: BBOX.lonSpan, includeReferences: 'true'});
  var d = j.data || {}, refs = d.references || {};
  var list = d.list || (d.entry && d.entry.list) || [];
  return list.map(function(v){ return normVeh_(v, refs.routes || {}, refs.trips || {}); });
}
/* rövid gyorsítótár (a Cache 100 KB-os darabokban tárol) */
function putBig_(key, str, sec){ var c = CacheService.getScriptCache(), n = Math.ceil(str.length / 90000), o = {}; for (var i = 0; i < n; i++) o[key + i] = str.slice(i * 90000, (i + 1) * 90000); o[key + 'n'] = String(n); c.putAll(o, sec); }
function getBig_(key){ var c = CacheService.getScriptCache(), n = +(c.get(key + 'n') || 0); if (!n) return null; var ks = []; for (var i = 0; i < n; i++) ks.push(key + i); var g = c.getAll(ks), s = ''; for (var i2 = 0; i2 < n; i2++){ if (g[key + i2] == null) return null; s += g[key + i2]; } return s; }
function live_(){
  var s = getBig_('live');
  if (s) return JSON.parse(s);
  var out = {ts: Date.now(), list: liveFetch_()};
  try { putBig_('live', JSON.stringify(out), 15); } catch (e) {}
  return out;
}
function trip_(tripId, vehicleId){
  var p = {tripId: tripId, includeReferences: 'true'}; if (vehicleId) p.vehicleId = vehicleId;
  var j = bkk_('trip-details', p);
  var d = j.data || {}, e = d.entry || {}, refs = d.references || {}, stops = refs.stops || {}, routes = refs.routes || {}, trips = refs.trips || {};
  var tr = trips[e.tripId || tripId] || {}, r = routes[tr.routeId] || {};
  return {
    tripId: e.tripId || tripId, route: r.shortName || '', color: r.color || '', textColor: r.textColor || '',
    type: cat_(r.type), headsign: tr.tripHeadsign || '', serviceDate: e.serviceDate || '',
    vehicle: e.vehicle ? normVeh_(e.vehicle, routes, trips) : null,
    polyline: (e.polyline && e.polyline.points) || '',
    stops: (e.stopTimes || []).map(function(s){ var st = stops[s.stopId] || {};
      return {id: s.stopId, name: st.name || s.stopHeadsign || s.stopId, lat: st.lat, lon: st.lon,
              arr: s.arrivalTime || 0, dep: s.departureTime || 0, parr: s.predictedArrivalTime || 0, pdep: s.predictedDepartureTime || 0}; })
  };
}

/* ---------------- Táblázat ---------------- */
var SH = {
  Jarmuvek:    ['id','plate','label','model','type','firstSeen','lastSeen','lastRoute','palyaszam','megjegyzes'],
  Bejegyzesek: ['id','ts','veh','plate','kind','text','by','byId','shift','photos'],
  Szolgalat:   ['id','start','end','by','byId','note','device']
};
var HEAD = {
  Jarmuvek:    ['Jármű azonosító','Rendszám','Felirat','Típus','Kategória','Először látva','Utoljára látva','Utolsó járat','Pályaszám (kézi)','Megjegyzés'],
  Bejegyzesek: ['Azonosító','Idő','Jármű','Rendszám','Fajta','Szöveg','Ki','Szolgálati azonosító','Szolgálat','Fotók (Drive ID)'],
  Szolgalat:   ['Azonosító','Kezdés','Befejezés','Név','Szolgálati azonosító','Megjegyzés','Eszköz']
};
function sh_(name){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = ss.getSheetByName(name);
  if (!s){ s = ss.insertSheet(name); s.appendRow(HEAD[name]); s.setFrozenRows(1); s.getRange('A:A').setNumberFormat('@'); if (name === 'Jarmuvek') s.getRange('B:B').setNumberFormat('@'); }
  return s;
}
function rows_(name){
  var s = sh_(name), n = s.getLastRow(), cols = SH[name]; if (n < 2) return [];
  return s.getRange(2, 1, n - 1, cols.length).getValues().map(function(v, i){
    var o = {_row: i + 2}; cols.forEach(function(c, k){ var x = v[k]; o[c] = (x instanceof Date) ? x.getTime() : x; }); return o; });
}
function append_(name, obj){ var s = sh_(name); s.appendRow(SH[name].map(function(c){ var v = obj[c]; return v == null ? '' : v; })); }
function uid_(){ return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }

/* járművek gyűjtése – időzítő hívja 10 percenként (telepites() kapcsolja be) */
function gyujtes(){
  var list = liveFetch_(), now = Date.now();
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var s = sh_('Jarmuvek'), all = rows_('Jarmuvek'), by = {};
    all.forEach(function(r){ by[r.id] = r; });
    var add = [];
    list.forEach(function(v){
      if (!v.id) return;
      var r = by[v.id];
      if (r){
        var row = r._row;
        s.getRange(row, 2, 1, 7).setValues([[v.plate || r.plate, v.label || r.label, v.model || r.model, v.type || r.type, r.firstSeen || now, now, v.route || r.lastRoute]]);
      } else {
        add.push([v.id, v.plate, v.label, v.model, v.type, now, now, v.route, '', '']); by[v.id] = {};
      }
    });
    if (add.length) s.getRange(s.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
  } finally { lock.releaseLock(); }
}
function telepites(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'gyujtes') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('gyujtes').timeBased().everyMinutes(10).create();
  ['Jarmuvek','Bejegyzesek','Szolgalat'].forEach(sh_);
  gyujtes();
}

/* ---------------- fotók ---------------- */
function folder_(){ var it = DriveApp.getFoldersByName(FOLDER); return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER); }
function savePhoto_(p, name){
  var bytes = Utilities.base64Decode(String(p.b64 || '').replace(/^data:[^,]+,/, ''));
  var f = folder_().createFile(Utilities.newBlob(bytes, p.mime || 'image/jpeg', name));
  return f.getId();
}

/* ---------------- HTTP ---------------- */
function out_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function ok_(e, body){ var k = (e.parameter && e.parameter.key) || (body && body.key) || ''; return k === KULCS; }

function doGet(e){
  var p = e.parameter || {};
  if (!ok_(e)) return out_({error: 'Hibás kulcs'});
  try {
    switch (p.op){
      case 'ping':
        var t = {ok: true, script: true, time: Date.now()};
        try { var l = liveFetch_(); t.bkk = 'ok'; t.vehicles = l.length; t.sample = l[0] || null; } catch (x){ t.bkk = String(x.message || x); }
        return out_(t);
      case 'live':    return out_(live_());
      case 'catalog': return out_({ts: Date.now(), list: rows_('Jarmuvek').map(function(r){ delete r._row; return r; })});
      case 'trip':    return out_(trip_(p.tripId, p.vehicleId));
      case 'notes':
        var ns = rows_('Bejegyzesek').filter(function(r){ return !p.veh || r.veh === p.veh; });
        ns.sort(function(a, b){ return b.ts - a.ts; });
        return out_({list: ns.slice(0, +(p.limit || 200)).map(function(r){ delete r._row; r.photos = String(r.photos || '').split(',').filter(String); return r; })});
      case 'shifts':
        var ss = rows_('Szolgalat'); ss.sort(function(a, b){ return b.start - a.start; });
        return out_({list: ss.slice(0, 100).map(function(r){ delete r._row; return r; })});
      case 'photo':
        var f = DriveApp.getFileById(p.id), b = f.getBlob();
        if (f.getParents().next().getName() !== FOLDER) return out_({error: 'nincs ilyen fotó'});
        return out_({mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes())});
      default: return out_({error: 'ismeretlen művelet'});
    }
  } catch (x){ return out_({error: String(x.message || x)}); }
}

function doPost(e){
  var body; try { body = JSON.parse(e.postData.contents); } catch (x){ return out_({error: 'rossz JSON'}); }
  if (!ok_(e, body)) return out_({error: 'Hibás kulcs'});
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var now = Date.now();
    switch (body.op){
      case 'shift_start':
        var sid = uid_();
        append_('Szolgalat', {id: sid, start: now, end: '', by: body.by, byId: body.byId, note: body.note || '', device: body.device || ''});
        return out_({ok: true, id: sid, start: now});
      case 'shift_end':
        var r = rows_('Szolgalat').filter(function(x){ return x.id === body.id; })[0];
        if (!r) return out_({error: 'nincs ilyen szolgálat'});
        sh_('Szolgalat').getRange(r._row, 3).setValue(now);
        return out_({ok: true, end: now});
      case 'note':
        var id = uid_(), ids = [];
        (body.photos || []).slice(0, 8).forEach(function(p, i){ ids.push(savePhoto_(p, (body.plate || body.veh) + '_' + id + '_' + (i + 1) + '.jpg')); });
        append_('Bejegyzesek', {id: id, ts: now, veh: body.veh, plate: body.plate || '', kind: body.kind || 'jegyzet', text: body.text || '',
                                by: body.by || '', byId: body.byId || '', shift: body.shift || '', photos: ids.join(',')});
        return out_({ok: true, id: id, ts: now, photos: ids});
      case 'note_del':
        var n = rows_('Bejegyzesek').filter(function(x){ return x.id === body.id; })[0];
        if (!n) return out_({ok: true});
        String(n.photos || '').split(',').filter(String).forEach(function(pid){ try { DriveApp.getFileById(pid).setTrashed(true); } catch (x){} });
        sh_('Bejegyzesek').deleteRow(n._row);
        return out_({ok: true});
      case 'veh_set':
        var v = rows_('Jarmuvek').filter(function(x){ return x.id === body.veh; })[0], s = sh_('Jarmuvek');
        if (!v){ append_('Jarmuvek', {id: body.veh, plate: body.plate || '', type: body.type || 'egyeb', firstSeen: now, lastSeen: '', palyaszam: body.palyaszam || '', megjegyzes: body.megjegyzes || ''}); return out_({ok: true}); }
        if (body.palyaszam !== undefined) s.getRange(v._row, 9).setValue(body.palyaszam);
        if (body.megjegyzes !== undefined) s.getRange(v._row, 10).setValue(body.megjegyzes);
        return out_({ok: true});
      default: return out_({error: 'ismeretlen művelet'});
    }
  } catch (x){ return out_({error: String(x.message || x)}); }
  finally { lock.releaseLock(); }
}
