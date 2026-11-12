(function(){
  var port = browser.runtime.connectNative("jt");
  function page(){ return window.wrappedJSObject || window; }
  window.addEventListener("message", function(e){ try{ if (e.data && e.data.jt === "trigger") port.postMessage({trigger:true}); }catch(x){} });
  port.onMessage.addListener(function(m){
    try{
      var w = page();
      if (m && typeof m.hw !== 'undefined') { if (typeof w.jegyHw === 'function') w.jegyHw(!!m.hw, m.dev || ''); else { var n=0; var t=setInterval(function(){ var ww=page(); if (typeof ww.jegyHw === 'function' || ++n>40){ clearInterval(t); if (typeof ww.jegyHw === 'function') ww.jegyHw(!!m.hw, m.dev || ''); } }, 250); } }
      if (m && m.code) { if (typeof w.jegyScan === 'function') w.jegyScan(m.code); }
    }catch(e){}
  });
})();
