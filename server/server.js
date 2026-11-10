#!/usr/bin/env node
/* Jegyterminál – központi szerver
   Indítás:  node server.js            (alap port 8787, kulcs a config.json-ból)
   Vezérlőpult: http://<gép-ip>:8787/   Terminál (helyi): http://<gép-ip>:8787/terminal/
   Függőség nincs, csak Node 18+.  Adatok: data/scans.jsonl  */
'use strict';
const http=require('http'), fs=require('fs'), path=require('path'), os=require('os'), url=require('url');
const ROOT=__dirname, DATA=path.join(ROOT,'data'), FILE=path.join(DATA,'scans.jsonl'), CFGF=path.join(ROOT,'config.json');
fs.mkdirSync(DATA,{recursive:true});
let CFG={port:8787,key:'',title:'Jegyterminál – központ'};
try{ CFG=Object.assign(CFG,JSON.parse(fs.readFileSync(CFGF,'utf8'))); }catch(e){}
if(!CFG.key){ CFG.key=Math.random().toString(36).slice(2,8).toUpperCase(); fs.writeFileSync(CFGF,JSON.stringify(CFG,null,2)); }
const PORT=+process.env.PORT||CFG.port;

/* ---- storage: append-only JSONL, in-memory index by id ---- */
const scans=new Map(); const devices=new Map(); // device -> {last, inspector, place, ip}
const M3=['Újpest-központ','Újpest-városkapu','Gyöngyösi utca','Forgách utca','Göncz Árpád városközpont','Dózsa György út','Lehel tér','Nyugati pályaudvar','Arany János utca','Deák Ferenc tér','Ferenciek tere','Kálvin tér','Corvin-negyed','Semmelweis Klinikák','Nagyvárad tér','Népliget','Ecseri út','Pöttyös utca','Határ út','Kőbánya-Kispest'];
const CFGDATA=path.join(DATA,'config.json');
let CC={global:{title:'BKK Jegyellenőrzés',mode:'jegy',fine:8000,dateCheck:true,graceH:6,dateRequire:false,night:'auto',nightFrom:'20:00',nightTo:'06:00',dim:0,welcome:'A jegy érvényes. Belépés engedélyezve.',hwScan:false},lock:true,seq:0,devices:{}};
try{ CC=Object.assign(CC,JSON.parse(fs.readFileSync(CFGDATA,'utf8'))); }catch(e){}
function saveCC(){ fs.writeFileSync(CFGDATA,JSON.stringify(CC,null,1)); }
CC.meta=CC.meta||{tx:[],colors:[]};
function deviceCfg(dev,ip){ if(!dev) return null; let d=CC.devices[dev]; if(!d){ CC.seq=(CC.seq||0)+1; d=CC.devices[dev]={inspector:'BKK-'+String(CC.seq).padStart(4,'0'),place:M3[0],created:new Date().toISOString()}; saveCC(); } d.seen=new Date().toISOString(); d.ip=ip||d.ip||''; return d; }
function configFor(dev,ip){ const d=deviceCfg(dev,ip); const out=Object.assign({},CC.global,{sub:d.place,id:d.inspector,lock:CC.lock!==false,device:dev}); for(const k in d.override||{}) out[k]=d.override[k]; return out; }
if(fs.existsSync(FILE)) for(const line of fs.readFileSync(FILE,'utf8').split('\n')){ if(!line.trim()) continue; try{ applyEvent(JSON.parse(line),false); }catch(e){} }
for(const r of scans.values()){ if(!r.device) continue; const d=devices.get(r.device); if(!d||d.last<r.ts) devices.set(r.device,{device:r.device,inspector:r.inspector||'',place:r.place||'',last:r.ts,ip:''}); }
function applyEvent(ev,persist){
  if(!ev||!ev.id) return null; let rec;
  if(ev.update){ rec=scans.get(ev.id); if(!rec) return null; if(ev.fine){ rec.fine=true; rec.fineAmount=ev.fineAmount||rec.fineAmount; rec.fineTs=ev.ts; } if(ev.let){ rec.let=true; rec.letTs=ev.ts; } rec.updated=ev.ts||new Date().toISOString(); }
  else { rec=Object.assign(scans.get(ev.id)||{},ev); rec.received=rec.received||new Date().toISOString(); scans.set(ev.id,rec); }
  if(persist){ fs.appendFileSync(FILE,JSON.stringify(ev)+'\n'); broadcast(rec); }
  return rec;
}
function touchDevice(rec,ip){ if(!rec.device) return; devices.set(rec.device,{device:rec.device,inspector:rec.inspector||'',place:rec.place||'',last:new Date().toISOString(),ip}); }

/* ---- SSE ---- */
const clients=new Set();
function broadcast(rec){ const msg='data: '+JSON.stringify(rec)+'\n\n'; for(const res of clients){ try{ res.write(msg); }catch(e){ clients.delete(res); } } }

/* ---- helpers ---- */
const send=(res,code,body,type)=>{ res.writeHead(code,{'Content-Type':type||'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Key','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'}); res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)); };
const dayOf=iso=>{ const d=new Date(iso); if(isNaN(d)) return ''; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
function effDay(iso,grace){ const d=new Date(iso); if(d.getHours()<(grace||0)) d.setDate(d.getDate()-1); return dayOf(d.toISOString()); }
function list(q){ let arr=[...scans.values()]; if(q.device) arr=arr.filter(r=>r.device===q.device); if(q.day) arr=arr.filter(r=>dayOf(r.ts)===q.day); if(q.q){ const s=q.q.toLowerCase(); arr=arr.filter(r=>(r.code||'').toLowerCase().includes(s)||(r.name||'').toLowerCase().includes(s)||(r.type||'').toLowerCase().includes(s)); } if(q.test!=='1') arr=arr.filter(r=>!r.test); arr.sort((a,b)=>(b.ts||'').localeCompare(a.ts||'')); return arr.slice(0,+q.limit||500); }
function stats(){ const today=dayOf(new Date().toISOString()); const per={}; let tIn=0,tOut=0,tFine=0,tLet=0,all=0; for(const r of scans.values()){ if(r.test) continue; all++; const d=dayOf(r.ts), isIn=r.ok||r.let; per[d]=per[d]||{day:d,in:0,out:0,fine:0,let:0}; if(isIn) per[d].in++; else per[d].out++; if(r.fine) per[d].fine++; if(r.let) per[d].let++; if(d===today){ if(isIn) tIn++; else tOut++; if(r.fine) tFine++; if(r.let) tLet++; } }
  const byDev={}; for(const r of scans.values()){ if(r.test||dayOf(r.ts)!==today) continue; const k=r.device||'?'; byDev[k]=byDev[k]||{device:k,in:0,out:0}; if(r.ok||r.let) byDev[k].in++; else byDev[k].out++; }
  return {today:{day:today,in:tIn,out:tOut,fine:tFine,let:tLet},days:Object.values(per).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,60),devices:[...devices.values()].map(d=>Object.assign({},d,byDev[d.device]||{in:0,out:0})),total:all}; }
function csv(arr){ const cols=['ts','device','inspector','place','code','name','type','day','ok','verdict','why','fine','let','txn','test']; const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"'; return '﻿'+cols.join(';')+'\n'+arr.map(r=>cols.map(c=>esc(r[c]===true?'igen':r[c]===false?'':r[c])).join(';')).join('\n'); }
function body(req){ return new Promise((ok,err)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>5e6) req.destroy(); }); req.on('end',()=>{ try{ ok(b?JSON.parse(b):null); }catch(e){ err(e); } }); req.on('error',err); }); }
function ips(){ const out=[]; for(const [n,as] of Object.entries(os.networkInterfaces())) for(const a of as) if(a.family==='IPv4'&&!a.internal) out.push(a.address); return out; }

/* ---- server ---- */
http.createServer(async (req,res)=>{
  const u=url.parse(req.url,true), p=u.pathname, q=u.query, ip=(req.socket.remoteAddress||'').replace('::ffff:','');
  if(req.method==='OPTIONS') return send(res,204,'');
  if(p==='/'||p==='/index.html') return send(res,200,DASH(),'text/html; charset=utf-8');
  if(p==='/terminal'||p==='/terminal/'){ const f=path.join(ROOT,'..','index.html'); if(fs.existsSync(f)) return send(res,200,fs.readFileSync(f),'text/html; charset=utf-8'); return send(res,404,'index.html nincs a szerver mellett (a server mappa a jegy-terminal repóban legyen)','text/plain; charset=utf-8'); }
  if(p.startsWith('/terminal/')){ const f=path.join(ROOT,'..',path.basename(p)); if(fs.existsSync(f)&&fs.statSync(f).isFile()){ const ext=path.extname(f); const T={'.png':'image/png','.json':'application/json','.js':'text/javascript','.html':'text/html; charset=utf-8'}; return send(res,200,fs.readFileSync(f),T[ext]||'application/octet-stream'); } return send(res,404,'nincs','text/plain'); }
  if(p==='/api/info') return send(res,200,{title:CFG.title,ips:ips(),port:PORT,needKey:true});
  const key=req.headers['x-key']||q.key||'';
  const open=(p==='/api/scan'&&req.method==='POST')||p==='/api/used'||(p==='/api/config'&&req.method==='GET')||(p==='/api/meta'&&req.method==='POST');
  if(!open&&key!==CFG.key) return send(res,401,{error:'hibás kulcs'});
  try{
    if(p==='/api/scan'&&req.method==='POST'){ const b=await body(req); const arr=Array.isArray(b)?b:[b]; let n=0; for(const ev of arr){ const r=applyEvent(ev,true); if(r){ n++; touchDevice(r,ip); } } return send(res,200,{ok:true,n}); }
    if(p==='/api/used'){ const code=String(q.code||''); let hit=null; for(const r of scans.values()){ if(r.test||r.code!==code) continue; if(r.ok||r.let){ if(!hit||(r.ts>hit.ts)) hit=r; } } return send(res,200,{used:hit?{time:fmtHu(hit.ts),device:hit.device||'',name:hit.name||''}:null}); }
    if(p==='/api/config'&&req.method==='GET'){ const c=configFor(String(q.device||''),ip); if(!c) return send(res,400,{error:'device?'}); saveCC(); return send(res,200,c); }
    if(p==='/api/meta'&&req.method==='POST'){ const b=await body(req)||{}; if(Array.isArray(b.tx)) CC.meta.tx=b.tx; if(Array.isArray(b.colors)) CC.meta.colors=b.colors; saveCC(); return send(res,200,{ok:true}); }
    if(p==='/api/admin/config'&&req.method==='GET') return send(res,200,{global:CC.global,lock:CC.lock!==false,devices:CC.devices,M3,meta:CC.meta});
    if(p==='/api/admin/config'&&req.method==='POST'){ const b=await body(req)||{}; if(b.global) Object.assign(CC.global,b.global); if(typeof b.lock==='boolean') CC.lock=b.lock; if(b.devices) for(const k in b.devices){ CC.devices[k]=Object.assign(CC.devices[k]||{},b.devices[k]); if(CC.devices[k].place&&!M3.includes(CC.devices[k].place)) CC.devices[k].place=M3[0]; } if(b.remove) delete CC.devices[b.remove]; saveCC(); return send(res,200,{ok:true}); }
    if(p==='/api/scans') return send(res,200,list(q));
    if(p==='/api/stats') return send(res,200,stats());
    if(p==='/api/export.csv'){ res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="beolvasasok.csv"','Access-Control-Allow-Origin':'*'}); return res.end(csv(list(Object.assign({limit:1e9,test:'1'},q)))); }
    if(p==='/api/clear'&&req.method==='POST'){ scans.clear(); devices.clear(); fs.writeFileSync(FILE,''); return send(res,200,{ok:true}); }
    if(p==='/api/events'){ res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'}); res.write(':ok\n\n'); clients.add(res); req.on('close',()=>clients.delete(res)); return; }
  }catch(e){ return send(res,400,{error:String(e.message||e)}); }
  send(res,404,{error:'nincs ilyen'});
}).listen(PORT,()=>{ console.log('\n  Jegyterminál szerver fut.'); console.log('  Vezérlőpult:  http://localhost:'+PORT+'/'); for(const a of ips()) console.log('  Hálózaton:    http://'+a+':'+PORT+'/   (terminálba ezt írd: http://'+a+':'+PORT+')'); console.log('  Kulcs:        '+CFG.key+'   (config.json)\n'); });
function fmtHu(iso){ const d=new Date(iso); if(isNaN(d)) return iso||''; const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'.'+p(d.getMonth()+1)+'.'+p(d.getDate())+'. '+p(d.getHours())+':'+p(d.getMinutes()); }

/* ---- dashboard (single page) ---- */
function DASH(){ return `<!DOCTYPE html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${CFG.title}</title>
<style>
:root{--bg:#f3f3f7;--card:#fff;--fg:#1a1a1a;--muted:#6b6b7b;--line:#e3e3ea;--acc:#4a148c;--ok:#2e7d32;--bad:#c62828;--warn:#ef6c00}
@media(prefers-color-scheme:dark){:root{--bg:#121216;--card:#1c1c22;--fg:#ececf1;--muted:#9a9aa6;--line:#2c2c36}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{background:var(--acc);color:#fff;padding:12px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}header h1{font-size:1.1rem;margin:0;letter-spacing:.04em}header .sp{flex:1}
header input,header button,.bar input,.bar select,.bar button{font:inherit;border:1px solid var(--line);border-radius:6px;padding:7px 10px;background:var(--card);color:var(--fg)}
header .live{font-size:.75rem;background:#fff2;padding:4px 8px;border-radius:12px}header .live.on{background:#2e7d32}
main{padding:14px 18px;display:grid;gap:14px;max-width:1400px;margin:0 auto}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:1.9rem;font-weight:800}.tile span{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.tile.ok b{color:var(--ok)}.tile.bad b{color:var(--bad)}.tile.warn b{color:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card h2{font-size:.8rem;margin:0 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}.bar .sp{flex:1}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}th{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
tr.new td{animation:fl 1.5s}@keyframes fl{from{background:#ffe08266}to{background:transparent}}
.b{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75rem;font-weight:700;color:#fff}.b.ok{background:var(--ok)}.b.bad{background:var(--bad)}.b.warn{background:var(--warn)}.b.g{background:#777}
.wrap{overflow:auto;max-height:60vh}.dev{display:flex;gap:10px;flex-wrap:wrap}.dev div{border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:170px}.dev b{display:block}.dev small{color:var(--muted)}
.chart{display:flex;gap:4px;align-items:flex-end;height:110px;margin-top:6px}.chart div{flex:1;background:var(--ok);border-radius:3px 3px 0 0;position:relative;min-width:8px}.chart div i{position:absolute;left:0;right:0;bottom:0;background:var(--bad);border-radius:0}.chart div span{position:absolute;top:-16px;left:0;right:0;text-align:center;font-size:.6rem;color:var(--muted)}
.muted{color:var(--muted);font-size:.8rem}
</style></head><body>
<header><h1>${CFG.title}</h1><span class="live" id="live">kapcsolódás…</span><span class="sp"></span><label class="muted" style="color:#fff">Kulcs <input id="key" type="password" style="width:110px"></label><button id="csv">CSV export</button></header>
<main>
<div class="tiles"><div class="tile ok"><b id="tIn">–</b><span>Ma beléptetve</span></div><div class="tile bad"><b id="tOut">–</b><span>Ma elutasítva</span></div><div class="tile warn"><b id="tFine">–</b><span>Pótdíj ma</span></div><div class="tile"><b id="tLet">–</b><span>Kézi beengedés</span></div><div class="tile"><b id="tAll">–</b><span>Összes beolvasás</span></div></div>
<div class="card"><h2>Terminálok – beállítás (automatikus BKK-azonosító, állomás)</h2><div id="devcfg" class="muted">Még nem jelentkezett be terminál. A terminálon: Beállítások → Szerver címe + kulcs.</div><div class="dev" id="devs" style="margin-top:8px"></div><p class="muted" id="info"></p></div>
<div class="card"><h2>Központi beállítások (minden terminálra)</h2>
<div class="bar"><label class="muted">Rendezvény / fejléc <input id="gTitle" style="min-width:200px"></label><label class="muted">Mód <select id="gMode"><option value="jegy">Jegy</option><option value="berlet">Bérlet</option></select></label><label class="muted">Pótdíj (Ft) <input id="gFine" type="number" style="width:90px"></label></div>
<div class="bar"><label class="muted"><input type="checkbox" id="gDate"> dátum-ellenőrzés</label><label class="muted">türelmi óra <input id="gGrace" type="number" style="width:60px"></label><label class="muted"><input type="checkbox" id="gDateReq"> dátum nélküli = érvénytelen</label><label class="muted"><input type="checkbox" id="gHw"> hardveres szkenner (Zebra)</label></div>
<div class="bar"><label class="muted">Éjszakai mód <select id="gNight"><option value="off">ki</option><option value="on">mindig</option><option value="auto">időzítve</option><option value="system">rendszer</option></select></label><label class="muted">-tól <input id="gFrom" type="time"></label><label class="muted">-ig <input id="gTo" type="time"></label><label class="muted">tompítás % <input id="gDim" type="number" style="width:60px"></label></div>
<div class="bar"><label class="muted" style="flex:1">Üzenet érvényes jegynél <input id="gWelcome" style="width:100%"></label></div>
<div class="bar"><label class="muted"><input type="checkbox" id="gLock"> a terminálokon zárolva (csak innen állítható)</label><span class="sp"></span><button id="gSave" style="background:var(--acc);color:#fff;border-color:var(--acc)">Mentés – 1 percen belül minden terminálra</button></div></div>
<div class="card"><h2>Napok</h2><div class="chart" id="chart"></div></div>
<div class="card"><h2>Logók (minden terminálra)</h2><div class="bar" style="gap:18px;align-items:flex-start">
<div><img id="pLogo" style="height:56px;max-width:160px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px;display:none"><br><label class="muted">Nappali fejléc logó<br><input type="file" id="fLogo" accept="image/*"></label> <button data-del="logo">törlés</button></div>
<div><img id="pLogoN" style="height:56px;max-width:160px;object-fit:contain;background:#1c1c22;border:1px solid var(--line);border-radius:8px;padding:4px;display:none"><br><label class="muted">Éjszakai fejléc logó<br><input type="file" id="fLogoN" accept="image/*"></label> <button data-del="logoNight">törlés</button></div>
<div><img id="pIcon" style="width:48px;height:48px;border-radius:10px;display:none"><br><label class="muted">App ikon<br><input type="file" id="fIcon" accept="image/*"></label> <button data-del="icon">alap</button></div>
</div><p class="muted">Feltöltés után a „Mentés” gombbal (központi beállítások) kerül ki a terminálokra.</p></div>
<div class="card"><h2>Szövegek – minden felirat</h2><div class="bar"><input id="txq" placeholder="szűrés…" style="min-width:220px"><span class="muted">Üresen hagyva az alapérték érvényes.</span></div><div id="txlist" class="wrap" style="max-height:45vh"></div></div>
<div class="card"><h2>Színek – nappali és éjszakai</h2><div id="collist" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px"></div></div>
<div class="card"><h2>Előzmények</h2>
<div class="bar"><input id="q" placeholder="keresés: kód, név, típus" style="min-width:220px"><select id="fdev"><option value="">minden terminál</option></select><input id="fday" type="date"><label class="muted"><input type="checkbox" id="ftest"> teszt is</label><span class="sp"></span><button id="refresh">Frissít</button><button id="clear" style="color:var(--bad)">Összes törlése</button></div>
<div class="wrap"><table><thead><tr><th>Idő</th><th>Eredmény</th><th>Kód</th><th>Név</th><th>Típus</th><th>Jegy dátuma</th><th>Terminál</th><th>Ellenőr</th><th>Megjegyzés</th></tr></thead><tbody id="rows"></tbody></table></div></div>
</main>
<script>
const $=id=>document.getElementById(id); let key=localStorage.getItem('key')||''; $('key').value=key; $('key').addEventListener('change',()=>{ key=$('key').value.trim(); localStorage.setItem('key',key); load(); if(window._es){ try{ window._es.close(); }catch(e){} } sse(); });
const H=()=>({'X-Key':key}); const fmt=iso=>{ const d=new Date(iso); if(isNaN(d)) return iso||''; const p=n=>String(n).padStart(2,'0'); return p(d.getMonth()+1)+'.'+p(d.getDate())+'. '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); };
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function badge(r){ if(r.let) return '<span class="b warn">kézi beengedés</span>'; if(r.ok) return '<span class="b ok">érvényes</span>'; return '<span class="b bad">'+esc(r.verdict||'érvénytelen')+'</span>'+(r.fine?' <span class="b warn">pótdíj</span>':''); }
function row(r,isNew){ return '<tr class="'+(isNew?'new':'')+'" data-id="'+esc(r.id)+'"><td>'+fmt(r.ts)+'</td><td>'+badge(r)+'</td><td><code>'+esc(r.code)+'</code></td><td>'+esc(r.name)+'</td><td>'+esc(r.type)+(r.test?' <span class="b g">teszt</span>':'')+'</td><td>'+esc(r.day)+'</td><td>'+esc(r.device)+'</td><td>'+esc(r.inspector)+'</td><td class="muted">'+esc(r.why)+'</td></tr>'; }
async function api(p){ const r=await fetch(p,{headers:H()}); if(r.status===401){ $('live').textContent='hibás kulcs'; $('live').className='live'; throw 0; } return r.json(); }
async function load(){ try{ const st=await api('/api/stats'); $('tIn').textContent=st.today.in; $('tOut').textContent=st.today.out; $('tFine').textContent=st.today.fine; $('tLet').textContent=st.today.let; $('tAll').textContent=st.total;
  if(st.devices.length) $('devs').innerHTML=st.devices.map(d=>'<div><b>'+esc(d.device)+'</b><small>'+esc(d.inspector)+' · '+esc(d.place)+'</small><br><small>ma: <span style="color:var(--ok)">'+d.in+'</span> / <span style="color:var(--bad)">'+d.out+'</span> · utoljára '+fmt(d.last)+' · '+esc(d.ip)+'</small></div>').join('');
  const sel=$('fdev'); const cur=sel.value; sel.innerHTML='<option value="">minden terminál</option>'+st.devices.map(d=>'<option'+(d.device===cur?' selected':'')+'>'+esc(d.device)+'</option>').join('');
  const days=st.days.slice(0,30).reverse(), mx=Math.max(1,...days.map(d=>d.in+d.out)); $('chart').innerHTML=days.map(d=>'<div style="height:'+Math.round((d.in+d.out)/mx*100)+'%" title="'+d.day+': '+d.in+' be / '+d.out+' el"><i style="height:'+Math.round(d.out/Math.max(1,d.in+d.out)*100)+'%"></i><span>'+d.day.slice(5)+'</span></div>').join('')||'<span class="muted">még nincs adat</span>';
  const q=new URLSearchParams({q:$('q').value,device:$('fdev').value,day:$('fday').value,test:$('ftest').checked?'1':'',limit:500}); const rows=await api('/api/scans?'+q); $('rows').innerHTML=rows.map(r=>row(r)).join('')||'<tr><td colspan="9" class="muted">nincs találat</td></tr>'; }catch(e){} }
['q','fdev','fday','ftest'].forEach(id=>$(id).addEventListener(id==='q'?'input':'change',load)); $('refresh').addEventListener('click',load);
$('csv').addEventListener('click',()=>{ location.href='/api/export.csv?key='+encodeURIComponent(key); });
$('clear').addEventListener('click',async()=>{ if(!confirm('Minden beolvasás törlődik a szerveren. Biztos?')) return; await fetch('/api/clear',{method:'POST',headers:H()}); load(); });
async function loadCfg(){ try{ const c=await api('/api/admin/config'); const g=c.global; renderMeta(c); $('gTitle').value=g.title||''; $('gMode').value=g.mode||'jegy'; $('gFine').value=g.fine||0; $('gDate').checked=g.dateCheck!==false; $('gGrace').value=g.graceH==null?6:g.graceH; $('gDateReq').checked=!!g.dateRequire; $('gHw').checked=!!g.hwScan; $('gNight').value=g.night||'off'; $('gFrom').value=g.nightFrom||'20:00'; $('gTo').value=g.nightTo||'06:00'; $('gDim').value=g.dim||0; $('gWelcome').value=g.welcome||''; $('gLock').checked=c.lock!==false;
    const ks=Object.keys(c.devices); if(ks.length) $('devcfg').innerHTML='<table><thead><tr><th>Terminál</th><th>Jegyellenőr azonosító</th><th>Állomás</th><th>Utoljára</th><th></th></tr></thead><tbody>'+ks.map(k=>{ const d=c.devices[k]; return '<tr><td><b>'+esc(k)+'</b></td><td><input data-dev="'+esc(k)+'" data-f="inspector" value="'+esc(d.inspector)+'" style="width:110px"></td><td><select data-dev="'+esc(k)+'" data-f="place">'+c.M3.map(m=>'<option'+(m===d.place?' selected':'')+'>'+esc(m)+'</option>').join('')+'</select></td><td class="muted">'+fmt(d.seen||d.created)+'</td><td><button data-rm="'+esc(k)+'">törlés</button></td></tr>'; }).join('')+'</tbody></table>';
    $('devcfg').querySelectorAll('[data-dev]').forEach(i=>i.addEventListener('change',async()=>{ const b={devices:{}}; b.devices[i.dataset.dev]={}; b.devices[i.dataset.dev][i.dataset.f]=i.value; await fetch('/api/admin/config',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},H()),body:JSON.stringify(b)}); }));
    $('devcfg').querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',async()=>{ if(!confirm('Terminál törlése a listából? (újra bejelentkezéskor új azonosítót kap)')) return; await fetch('/api/admin/config',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},H()),body:JSON.stringify({remove:b.dataset.rm})}); loadCfg(); })); }catch(e){} }
$('gSave').addEventListener('click',async()=>{ const g=Object.assign(collectExtra(),{title:$('gTitle').value,mode:$('gMode').value,fine:+$('gFine').value||0,dateCheck:$('gDate').checked,graceH:+$('gGrace').value||0,dateRequire:$('gDateReq').checked,hwScan:$('gHw').checked,night:$('gNight').value,nightFrom:$('gFrom').value,nightTo:$('gTo').value,dim:+$('gDim').value||0,welcome:$('gWelcome').value}); const r=await fetch('/api/admin/config',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},H()),body:JSON.stringify({global:g,lock:$('gLock').checked})}); $('gSave').textContent=r.ok?'Mentve ✓':'Hiba'; if(r.ok){ LG={logo:null,logoNight:null,icon:null}; loadCfg(); } setTimeout(()=>$('gSave').textContent='Mentés – 1 percen belül minden terminálra',2000); });
loadCfg(); setInterval(loadCfg,60000);
fetch('/api/info').then(r=>r.json()).then(i=>{ $('info').textContent='Terminálba írandó szervercím: '+i.ips.map(a=>'http://'+a+':'+i.port).join('  vagy  ')+' · helyi terminál: /terminal/'; });
var LG={logo:null,logoNight:null,icon:null},LASTC={global:{}},META={tx:[],colors:[]};
function readImg(file,max,sq,cb){var img=new Image();var u=URL.createObjectURL(file);img.onload=function(){var c=document.createElement('canvas');if(sq){c.width=c.height=max;var x=c.getContext('2d');var s=Math.max(max/img.width,max/img.height);x.drawImage(img,(max-img.width*s)/2,(max-img.height*s)/2,img.width*s,img.height*s)}else{var sc=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height)}URL.revokeObjectURL(u);cb(c.toDataURL('image/png'))};img.src=u}
[['fLogo','logo','pLogo',400,false],['fLogoN','logoNight','pLogoN',400,false],['fIcon','icon','pIcon',192,true]].forEach(function(a){$(a[0]).addEventListener('change',function(){var f=$(a[0]).files[0];if(!f)return;readImg(f,a[3],a[4],function(d){LG[a[1]]=d;$(a[2]).src=d;$(a[2]).style.display=''})})});
document.querySelectorAll('[data-del]').forEach(function(b){b.addEventListener('click',function(){LG[b.dataset.del]='';var p={logo:'pLogo',logoNight:'pLogoN',icon:'pIcon'}[b.dataset.del];$(p).src='';$(p).style.display='none'})});
function pobj(v){if(v&&typeof v==='object')return v;if(typeof v==='string'&&v.trim().charAt(0)==='{'){try{return JSON.parse(v)}catch(e){}}return {}}
function renderMeta(c){LASTC=c;if(c.meta)META=c.meta;var g=c.global||{};var tx=pobj(g.tx);
 ['logo','logoNight','icon'].forEach(function(k,i){var p=$(['pLogo','pLogoN','pIcon'][i]);if(g[k]){p.src=g[k];p.style.display=''}else{p.style.display='none'}});
 $('txlist').innerHTML='<table><tbody>'+META.tx.map(function(t){return '<tr data-row="'+esc((t[1]+' '+t[2]).toLowerCase())+'"><td class="muted" style="white-space:normal;min-width:160px">'+esc(t[1])+'</td><td><input data-tx="'+esc(t[0])+'" value="'+esc(tx[t[0]]||'')+'" placeholder="'+esc(t[2])+'" style="width:100%;min-width:220px"></td></tr>'}).join('')+'</tbody></table>';
 var col=pobj(g.colors),ncol=pobj(g.ncolors);
 $('collist').innerHTML=META.colors.map(function(t){var n=t[0].indexOf('n-')===0;var v=(n?ncol:col)[t[0]]||t[2];return '<label class="muted" style="display:flex;align-items:center;gap:6px"><input type="color" data-col="'+esc(t[0])+'" value="'+esc(v)+'" data-def="'+esc(t[2])+'" style="width:40px;padding:0;height:28px">'+esc(t[1])+'</label>'}).join('')||'<span class="muted">A színek listája az első terminál bejelentkezése után jelenik meg.</span>';
 filterTx()}
function filterTx(){var q=($('txq').value||'').toLowerCase();document.querySelectorAll('[data-row]').forEach(function(r){r.style.display=(!q||r.dataset.row.indexOf(q)>=0)?'':'none'})}
$('txq').addEventListener('input',filterTx);
function collectExtra(){var tx={};document.querySelectorAll('[data-tx]').forEach(function(i){if(i.value.trim())tx[i.dataset.tx]=i.value.trim()});var col={},ncol={};document.querySelectorAll('[data-col]').forEach(function(i){if(i.value.toLowerCase()!==String(i.dataset.def).toLowerCase()){(i.dataset.col.indexOf('n-')===0?ncol:col)[i.dataset.col]=i.value}});var o={tx:tx,colors:col,ncolors:ncol};for(var k in LG){if(LG[k]!==null)o[k]=LG[k]}return o}
function sse(){ const es=new EventSource('/api/events?key='+encodeURIComponent(key)); window._es=es; es.onopen=()=>{ $('live').textContent='élő'; $('live').className='live on'; }; es.onerror=()=>{ $('live').textContent='újracsatlakozás…'; $('live').className='live'; es.close(); setTimeout(sse,3000); };
  es.onmessage=e=>{ try{ const r=JSON.parse(e.data); if(!r.id) return; const old=document.querySelector('tr[data-id="'+CSS.escape(r.id)+'"]'); const html=row(r,true); if(old) old.outerHTML=html; else if(!$('fdev').value||$('fdev').value===r.device){ if(!r.test||$('ftest').checked) $('rows').insertAdjacentHTML('afterbegin',html); } load(); }catch(x){} }; }
load(); sse(); setInterval(load,60000);
</script></body></html>`; }
