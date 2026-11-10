/*  Jegyterminál – webes szerver Google Táblázatban (Apps Script)
    Telepítés: lásd README.md ebben a mappában. A KULCS-ot írd át, ugyanezt írod a terminálokba.  */
var KULCS = 'VALTOZTASD-MEG';          // ← saját kulcs (betűk/számok)
var SHEET = 'Beolvasasok';
var COLS = ['id','ts','device','inspector','place','code','name','type','day','ok','kind','verdict','why','fine','let','txn','test','mode'];

function sheet_(){ var ss=SpreadsheetApp.getActiveSpreadsheet(); var sh=ss.getSheetByName(SHEET); if(!sh){ sh=ss.insertSheet(SHEET); sh.appendRow(['Azonosító','Idő','Terminál','Ellenőr','Helyszín','Kód','Név','Típus','Jegy dátuma','Érvényes','Fajta','Eredmény','Indok','Pótdíj','Kézi beengedés','Tranzakció','Teszt','Mód']); sh.setFrozenRows(1); } return sh; }
function out_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function key_(e,body){ var k=(e.parameter&&e.parameter.key)||(body&&body.key)||''; return k===KULCS; }
function rows_(){ var sh=sheet_(); var n=sh.getLastRow(); if(n<2) return []; var v=sh.getRange(2,1,n-1,COLS.length).getValues(); var out=[]; for(var i=0;i<v.length;i++){ var r={}; for(var c=0;c<COLS.length;c++) r[COLS[c]]=v[i][c]; r._row=i+2; if(r.ts instanceof Date) r.ts=r.ts.toISOString(); out.push(r); } return out; }
function fmtHu_(iso){ var d=new Date(iso); if(isNaN(d)) return String(iso||''); return Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy.MM.dd. HH:mm'); }
function dayOf_(iso){ var d=new Date(iso); if(isNaN(d)) return ''; return Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd'); }

function doPost(e){
  var body; try{ body=JSON.parse(e.postData.contents); }catch(x){ return out_({error:'rossz JSON'}); }
  if(!key_(e,body)) return out_({error:'hibás kulcs'});
  var evs=body.events||body; if(!Array.isArray(evs)) evs=[evs];
  var lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    var sh=sheet_(), all=rows_(), byId={}; all.forEach(function(r){ byId[r.id]=r; });
    var n=0;
    evs.forEach(function(ev){ if(!ev||!ev.id) return;
      if(ev.update){ var r=byId[ev.id]; if(!r) return; if(ev.fine) sh.getRange(r._row,COLS.indexOf('fine')+1).setValue(true); if(ev.let) sh.getRange(r._row,COLS.indexOf('let')+1).setValue(true); n++; return; }
      if(byId[ev.id]) return;
      var row=COLS.map(function(c){ var v=ev[c]; if(c==='ts') return v?new Date(v):new Date(); if(v===true) return true; if(v===false||v==null) return v===false?false:''; return v; });
      sh.appendRow(row); byId[ev.id]={id:ev.id}; n++; });
    return out_({ok:true,n:n});
  } finally { lock.releaseLock(); }
}

function doGet(e){
  var p=e.parameter||{}; var a=p.a||'';
  if(!a) return HtmlService.createHtmlOutput(DASH_()).setTitle('Jegyterminál – központ').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return out_(handle_(a,p));
}
/* a vezérlőpult (google.script.run) és a terminál (GET) is ezt hívja */
function api(a,p){ return handle_(a,p||{}); }
function handle_(a,p){
  if(a==='info') return {title:SpreadsheetApp.getActiveSpreadsheet().getName(),needKey:true};
  if((p.key||'')!==KULCS) return {error:'hibás kulcs'};
  var all=rows_();
  if(a==='used'){ var code=String(p.code||''), hit=null; all.forEach(function(r){ if(r.test===true||String(r.code)!==code) return; if(r.ok===true||r.let===true){ if(!hit||r.ts>hit.ts) hit=r; } }); return {used:hit?{time:fmtHu_(hit.ts),device:hit.device||'',name:hit.name||''}:null}; }
  if(a==='scans'){ var arr=all; if(p.device) arr=arr.filter(function(r){return r.device===p.device;}); if(p.day) arr=arr.filter(function(r){return dayOf_(r.ts)===p.day;}); if(p.q){ var s=p.q.toLowerCase(); arr=arr.filter(function(r){ return String(r.code).toLowerCase().indexOf(s)>=0||String(r.name).toLowerCase().indexOf(s)>=0||String(r.type).toLowerCase().indexOf(s)>=0; }); } if(p.test!=='1') arr=arr.filter(function(r){return r.test!==true;}); arr.sort(function(x,y){ return String(y.ts).localeCompare(String(x.ts)); }); return arr.slice(0,+p.limit||500); }
  if(a==='stats'){ var today=dayOf_(new Date().toISOString()), per={}, t={day:today,in:0,out:0,fine:0,let:0}, byDev={}, devs={}, total=0;
    all.forEach(function(r){ if(r.test===true) return; total++; var d=dayOf_(r.ts), isIn=(r.ok===true||r.let===true); per[d]=per[d]||{day:d,in:0,out:0,fine:0,let:0}; if(isIn) per[d].in++; else per[d].out++; if(r.fine===true) per[d].fine++; if(r.let===true) per[d].let++;
      if(d===today){ if(isIn) t.in++; else t.out++; if(r.fine===true) t.fine++; if(r.let===true) t.let++; var k=r.device||'?'; byDev[k]=byDev[k]||{in:0,out:0}; if(isIn) byDev[k].in++; else byDev[k].out++; }
      var dv=devs[r.device]; if(r.device&&(!dv||dv.last<r.ts)) devs[r.device]={device:r.device,inspector:r.inspector||'',place:r.place||'',last:r.ts}; });
    var days=Object.keys(per).map(function(k){return per[k];}).sort(function(x,y){return y.day.localeCompare(x.day);}).slice(0,60);
    var devices=Object.keys(devs).map(function(k){ var d=devs[k]; d.in=(byDev[k]||{}).in||0; d.out=(byDev[k]||{}).out||0; d.ip=''; return d; });
    return {today:t,days:days,devices:devices,total:total}; }
  if(a==='clear'){ var sh=sheet_(); if(sh.getLastRow()>1) sh.deleteRows(2,sh.getLastRow()-1); return {ok:true}; }
  return {error:'nincs ilyen'};
}

function DASH_(){ return '<!DOCTYPE html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jegyterminál – központ</title>'+
'<style>:root{--bg:#f3f3f7;--card:#fff;--fg:#1a1a1a;--muted:#6b6b7b;--line:#e3e3ea;--acc:#4a148c;--ok:#2e7d32;--bad:#c62828;--warn:#ef6c00}*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}header{background:var(--acc);color:#fff;padding:12px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}header h1{font-size:1.1rem;margin:0}header .sp{flex:1}header input,header button,.bar input,.bar select,.bar button{font:inherit;border:1px solid var(--line);border-radius:6px;padding:7px 10px;background:var(--card);color:var(--fg)}main{padding:14px 18px;display:grid;gap:14px;max-width:1400px;margin:0 auto}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:1.9rem;font-weight:800}.tile span{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.tile.ok b{color:var(--ok)}.tile.bad b{color:var(--bad)}.tile.warn b{color:var(--warn)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card h2{font-size:.8rem;margin:0 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}.bar .sp{flex:1}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}th{font-size:.7rem;color:var(--muted);text-transform:uppercase}.b{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75rem;font-weight:700;color:#fff}.b.ok{background:var(--ok)}.b.bad{background:var(--bad)}.b.warn{background:var(--warn)}.b.g{background:#777}.wrap{overflow:auto;max-height:60vh}.dev{display:flex;gap:10px;flex-wrap:wrap}.dev div{border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:170px}.dev b{display:block}.dev small{color:var(--muted)}.muted{color:var(--muted);font-size:.8rem}</style></head><body>'+
'<header><h1>Jegyterminál – központ</h1><span class="muted" id="live" style="color:#fff">frissítés 10 mp-enként</span><span class="sp"></span><label style="color:#fff">Kulcs <input id="key" type="password" style="width:110px"></label><button id="refresh">Frissít</button></header>'+
'<main><div class="tiles"><div class="tile ok"><b id="tIn">–</b><span>Ma beléptetve</span></div><div class="tile bad"><b id="tOut">–</b><span>Ma elutasítva</span></div><div class="tile warn"><b id="tFine">–</b><span>Pótdíj ma</span></div><div class="tile"><b id="tLet">–</b><span>Kézi beengedés</span></div><div class="tile"><b id="tAll">–</b><span>Összes</span></div></div>'+
'<div class="card"><h2>Terminálok</h2><div class="dev" id="devs"><span class="muted">Még nem jelentkezett be terminál.</span></div></div>'+
'<div class="card"><h2>Előzmények</h2><div class="bar"><input id="q" placeholder="keresés: kód, név, típus" style="min-width:220px"><select id="fdev"><option value="">minden terminál</option></select><input id="fday" type="date"><label class="muted"><input type="checkbox" id="ftest"> teszt is</label><span class="sp"></span><span class="muted">Teljes lista + export: a Google Táblázatban</span></div>'+
'<div class="wrap"><table><thead><tr><th>Idő</th><th>Eredmény</th><th>Kód</th><th>Név</th><th>Típus</th><th>Jegy dátuma</th><th>Terminál</th><th>Ellenőr</th><th>Megjegyzés</th></tr></thead><tbody id="rows"></tbody></table></div></div></main>'+
'<script>var $=function(i){return document.getElementById(i)};var key=localStorage.getItem("jtkey")||"";$("key").value=key;$("key").addEventListener("change",function(){key=$("key").value.trim();localStorage.setItem("jtkey",key);load()});'+
'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}function fmt(iso){var d=new Date(iso);if(isNaN(d))return iso||"";var p=function(n){return String(n).padStart(2,"0")};return p(d.getMonth()+1)+"."+p(d.getDate())+". "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())}'+
'function badge(r){if(r.let===true)return "<span class=\\"b warn\\">kézi beengedés</span>";if(r.ok===true)return "<span class=\\"b ok\\">érvényes</span>";return "<span class=\\"b bad\\">"+esc(r.verdict||"érvénytelen")+"</span>"+(r.fine===true?" <span class=\\"b warn\\">pótdíj</span>":"")}'+
'function api(a,extra){var p=extra||{};p.key=key;return new Promise(function(ok,err){google.script.run.withSuccessHandler(ok).withFailureHandler(err).api(a,p)})}'+
'function load(){if(!key)return;api("stats").then(function(st){if(st.error){$("live").textContent=st.error;return}$("tIn").textContent=st.today.in;$("tOut").textContent=st.today.out;$("tFine").textContent=st.today.fine;$("tLet").textContent=st.today.let;$("tAll").textContent=st.total;if(st.devices.length)$("devs").innerHTML=st.devices.map(function(d){return "<div><b>"+esc(d.device)+"</b><small>"+esc(d.inspector)+" · "+esc(d.place)+"</small><br><small>ma: <span style=\\"color:var(--ok)\\">"+d.in+"</span> / <span style=\\"color:var(--bad)\\">"+d.out+"</span> · utoljára "+fmt(d.last)+"</small></div>"}).join("");var sel=$("fdev"),cur=sel.value;sel.innerHTML="<option value=\\"\\">minden terminál</option>"+st.devices.map(function(d){return "<option"+(d.device===cur?" selected":"")+">"+esc(d.device)+"</option>"}).join("");'+
'return api("scans",{q:$("q").value,device:$("fdev").value,day:$("fday").value,test:$("ftest").checked?"1":"",limit:300})}).then(function(rows){if(!rows||rows.error)return;$("rows").innerHTML=rows.map(function(r){return "<tr><td>"+fmt(r.ts)+"</td><td>"+badge(r)+"</td><td><code>"+esc(r.code)+"</code></td><td>"+esc(r.name)+"</td><td>"+esc(r.type)+(r.test===true?" <span class=\\"b g\\">teszt</span>":"")+"</td><td>"+esc(r.day)+"</td><td>"+esc(r.device)+"</td><td>"+esc(r.inspector)+"</td><td class=\\"muted\\">"+esc(r.why)+"</td></tr>"}).join("")||"<tr><td colspan=9 class=muted>nincs találat</td></tr>";$("live").textContent="frissítve "+fmt(new Date().toISOString())}).catch(function(){})}'+
'["q","fdev","fday","ftest"].forEach(function(id){$(id).addEventListener(id==="q"?"input":"change",load)});$("refresh").addEventListener("click",load);load();setInterval(load,10000);</script></body></html>'; }
