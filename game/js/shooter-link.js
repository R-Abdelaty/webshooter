(function(root){'use strict';
 // Where the shooter is. "webshooter.local" only resolves on machines with
 // mDNS, which plenty of Windows installs don't have, and on the ESP32's own
 // hotspot it is 192.168.4.1 - so the address is a setting you can type, and
 // it is remembered. That is usually the whole difference between the page
 // connecting and it sitting on DISCONNECTED forever.
 var KEY='ws.shooter.host.v1', FALLBACK='webshooter.local';
 function clean(h){return String(h==null?'':h).trim().replace(/^wss?:\/\//i,'').replace(/\/+$/,'');}
 function stored(){try{return clean(localStorage.getItem(KEY));}catch(_){return '';}}
 function fromQuery(){try{return clean(new URLSearchParams(location.search).get('host'));}catch(_){return '';}}
 function Link(host){this.capabilities=[];this.ws=null;this.retry=1000;this.timer=null;this.handlers={};this.wanted=false;this.status='disconnected';this.host=clean(host)||fromQuery()||stored()||FALLBACK;}
 Link.prototype.on=function(k,f){this.handlers[k]=f;};
 Link.prototype.emit=function(k,v){if(this.handlers[k])this.handlers[k](v);};
 // Port 81 unless you typed one, so "192.168.4.1" is enough to enter.
 Link.prototype.url=function(){return 'ws://'+(/:\d+$/.test(this.host)?this.host:this.host+':81');};
 Link.prototype.setStatus=function(s){this.status=s;this.emit('status',s);};
 // Text to the shooter - how the page tells it which axis is the forearm.
 Link.prototype.send=function(t){if(this.ws&&this.ws.readyState===1)try{this.ws.send(t);}catch(_){}};
 Link.prototype.drop=function(){if(!this.ws)return;this.ws.onopen=this.ws.onmessage=this.ws.onclose=this.ws.onerror=null;try{this.ws.close();}catch(_){}this.ws=null;};
 // Retry from scratch against a new address. Dropping the old socket silently
 // matters: its onclose would otherwise queue a retry to the old host.
 Link.prototype.setHost=function(h){this.host=clean(h)||FALLBACK;try{localStorage.setItem(KEY,this.host);}catch(_){}clearTimeout(this.timer);this.retry=1000;this.drop();this.connect();};
 // Stop trying altogether - the USB link has taken over.
 Link.prototype.stop=function(){this.wanted=false;clearTimeout(this.timer);this.drop();this.setStatus('disconnected');};
 Link.prototype.schedule=function(){var self=this;if(!self.wanted)return;clearTimeout(self.timer);self.timer=setTimeout(function(){self.connect();},self.retry);self.retry=Math.min(15000,self.retry*1.6);};
 Link.prototype.connect=function(){var self=this;self.wanted=true;clearTimeout(self.timer);if(self.ws&&self.ws.readyState<2)return;
  // A page served over https cannot open a plain ws:// socket - the browser
  // blocks it before the script sees anything. Retrying never helps, so say so.
  if(location.protocol==='https:'){self.setStatus('blocked');return;}
  self.setStatus('connecting');
  try{self.ws=new WebSocket(self.url());}catch(e){self.setStatus('disconnected');self.schedule();return;}
  self.ws.onopen=function(){self.retry=1000;self.setStatus('connected');self.emit('reconnect');};
  self.ws.onmessage=function(e){var m;try{m=JSON.parse(e.data);}catch(_){return;}
   // When it got here, on the page's clock: the reticle is drawn from the
   // device's own timestamps, and this is how the two clocks are lined up.
   if(m&&typeof m==='object')m.rx=performance.now();
   if(m.event==='hello'){self.capabilities=Array.isArray(m.capabilities)?m.capabilities:[];self.setStatus(Array.isArray(m.capabilities)&&m.capabilities.indexOf('aim')>=0?'aiming':'legacy');}
   else if(m.event==='aim')self.emit('aim',m);
   else if(m.event==='shoot')self.emit('shoot',m);
   else if(m.event==='shot_info')self.emit('shot_info',m);};
  self.ws.onclose=function(){self.ws=null;self.setStatus('disconnected');self.schedule();};
  self.ws.onerror=function(){if(self.ws)try{self.ws.close();}catch(_){}};};
 root.ShooterLink=Link;})(window);
