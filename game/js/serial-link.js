(function(root){'use strict';
 // The shooter over the USB cable, with no network at all: Web Serial, in
 // Chrome and Edge. Same events and statuses as ShooterLink (the WiFi link), so
 // the menu can use either one the same way.
 //
 // The shooter prints the same JSON packets it sends over WiFi, one per line,
 // mixed in with its ordinary log lines - but only after we say "hello", and
 // only while we keep pinging, so the serial monitor isn't flooded otherwise.
 var BAUD=460800;            // must match SERIAL_BAUD in web_shooter.ino
 var TICK_MS=500;            // "hello" until it answers, then "ping" (it stops after 3 s of silence)

 // Bytes arrive in arbitrary chunks. Keep the partial line, hand back every
 // complete JSON packet, and skip the log lines in between.
 function LineParser(){this.buf='';}
 LineParser.prototype.push=function(text){
  this.buf+=text;var out=[],i;
  while((i=this.buf.indexOf('\n'))>=0){
   var line=this.buf.slice(0,i).replace(/\r$/,'');this.buf=this.buf.slice(i+1);
   if(line.charAt(0)!=='{')continue;
   try{var m=JSON.parse(line);if(m&&typeof m.event==='string')out.push(m);}catch(_){}
  }
  if(this.buf.length>4096)this.buf='';     // garbage at the wrong baud rate: never a line end
  return out;
 };

 function now(){return typeof performance!=='undefined'?performance.now():Date.now();}

 function SerialLink(serial){
  var self=this;
  this.serial=serial||(typeof navigator!=='undefined'&&navigator.serial)||null;
  this.port=this.reader=this.writer=this.timer=null;
  this.handlers={};this.status=this.serial?'disconnected':'unsupported';this.host='USB';
  this.capabilities=[];this.wanted=false;
  // Plugged back in: pick up where we left off, no click needed.
  if(this.serial&&this.serial.addEventListener)this.serial.addEventListener('connect',function(e){
   if(self.wanted&&!self.port&&e&&e.target)self.open(e.target);
  });
 }
 SerialLink.supported=function(){return typeof navigator!=='undefined'&&!!navigator.serial;};
 SerialLink.LineParser=LineParser;SerialLink.BAUD=BAUD;
 SerialLink.prototype.on=function(k,f){this.handlers[k]=f;};
 SerialLink.prototype.emit=function(k,v){if(this.handlers[k])this.handlers[k](v);};
 SerialLink.prototype.setStatus=function(s){this.status=s;this.emit('status',s);};

 // The browser's port picker. Has to be called from a click.
 SerialLink.prototype.choose=async function(){
  if(!this.serial){this.setStatus('unsupported');return false;}
  var port;
  try{port=await this.serial.requestPort();}catch(_){return false;}   // closed the picker
  return this.open(port);
 };
 // A port this page was given before: reopened on load without asking.
 SerialLink.prototype.resume=async function(){
  if(!this.serial)return false;
  var ports=[];try{ports=await this.serial.getPorts();}catch(_){}
  return ports.length?this.open(ports[0]):false;
 };

 SerialLink.prototype.open=async function(port){
  await this.close();
  this.wanted=true;this.port=port;this.setStatus('connecting');
  try{await port.open({baudRate:BAUD,bufferSize:8192});}
  catch(_){if(this.port===port)this.port=null;this.setStatus('busy');return false;}   // usually the serial monitor has it
  // On most ESP32 boards DTR/RTS drive the reset and boot pins. Leave both
  // released so opening the port doesn't restart the shooter. (If it does
  // restart anyway, the hellos below just wait for it to boot.)
  try{if(port.setSignals)await port.setSignals({dataTerminalReady:false,requestToSend:false});}catch(_){}
  if(this.port!==port)return false;
  this.writer=port.writable.getWriter();
  this.setStatus('connected');this.emit('reconnect');
  this.readLoop(port);
  var self=this;
  this.send('hello');
  this.timer=setInterval(function(){self.send(self.status==='aiming'||self.status==='legacy'?'ping':'hello');},TICK_MS);
  return true;
 };

 SerialLink.prototype.dispatch=function(m){
  if(m.event==='hello'){this.capabilities=Array.isArray(m.capabilities)?m.capabilities:[];this.setStatus(this.capabilities.indexOf('aim')>=0?'aiming':'legacy');}
  else if(m.event==='aim')this.emit('aim',m);
  else if(m.event==='shoot')this.emit('shoot',m);
  else if(m.event==='shot_info')this.emit('shot_info',m);
 };

 SerialLink.prototype.readLoop=async function(port){
  var parser=new LineParser(),dec=new TextDecoder(),self=this;
  while(port===this.port&&port.readable){
   var reader=port.readable.getReader();this.reader=reader;
   try{
    for(;;){
     var r=await reader.read();
     if(r.done)break;
     // One arrival time for the whole chunk. The reticle is drawn from the
     // device's own timestamps, so chunking doesn't make it step.
     var t=now();
     parser.push(dec.decode(r.value,{stream:true})).forEach(function(m){m.rx=t;self.dispatch(m);});
    }
   }catch(_){/* a framing or overrun error: carry on reading; unplugging also lands here */}
   finally{try{reader.releaseLock();}catch(_){}}
  }
  if(port===this.port)this.lost();
 };

 // The cable came out. Stay wanted: the 'connect' event reopens it.
 SerialLink.prototype.lost=function(){this.close();this.setStatus('disconnected');};

 SerialLink.prototype.close=async function(){
  var port=this.port,reader=this.reader,writer=this.writer;
  clearInterval(this.timer);this.timer=null;
  this.port=this.reader=this.writer=null;
  if(!port)return;
  try{if(reader)await reader.cancel();}catch(_){}
  try{if(writer)writer.releaseLock();}catch(_){}
  try{await port.close();}catch(_){}
 };
 // Let go of the port for good (switching back to WiFi).
 SerialLink.prototype.disconnect=async function(){this.wanted=false;await this.close();this.setStatus('disconnected');};

 SerialLink.prototype.send=function(t){
  if(!this.writer)return;
  this.writer.write(new TextEncoder().encode(t+'\n')).catch(function(){});
 };

 if(typeof module!=='undefined')module.exports=SerialLink;
 root.SerialLink=SerialLink;
})(typeof window==='undefined'?globalThis:window);
