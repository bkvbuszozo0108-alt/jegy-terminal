(function(){
  var port = browser.runtime.connectNative("jt");
  port.onMessage.addListener(function(m){
    try{
      var w = window.wrappedJSObject || window;
      if (m && m.code) { if (typeof w.jegyScan === 'function') w.jegyScan(m.code); }
    }catch(e){}
  });
})();
