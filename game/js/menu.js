(function () {
  'use strict'; var $=id=>document.getElementById(id), SETTINGS_KEY='ws.settings.v2';
  var settings={music:60,sfx:80,muted:false,input:'mouse',sensitivity:1,horizontalAxis:'z',verticalAxis:'x',invertHorizontal:false,invertVertical:false,aimMode:'track',lookMode:'edge',turnSpeed:1,fov:75}; $('btn-new').disabled=true;$('btn-classic').disabled=true;
  try{Object.assign(settings,JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'));}catch(_){}
  function apply(){WSAudio.setMusicVolume(settings.music/100);WSAudio.setSfxVolume(settings.sfx/100);WSAudio.setMuted(settings.muted);$('vol-music').value=settings.music;$('vol-sfx').value=settings.sfx;$('chk-mute').checked=settings.muted;$('input-source').value=settings.input;$('sensitivity').value=settings.sensitivity;$('horizontal-axis').value=settings.horizontalAxis;$('vertical-axis').value=settings.verticalAxis;$('invert-horizontal').checked=settings.invertHorizontal;$('invert-vertical').checked=settings.invertVertical;$('aim-mode').value=settings.aimMode;$('look-mode').value=settings.lookMode;$('turn-speed').value=settings.turnSpeed;$('fov').value=settings.fov;$('fov-value').textContent=settings.fov+'°';try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch(_){}}
  // The fusing firmware aims with the board axis that points along the forearm;
  // the axis settings name the other two, so it follows from them.
  function tellForward(){if(link)link.send('fwd='+Controller.forwardAxis(settings));}
  function write(){settings.music=+$('vol-music').value;settings.sfx=+$('vol-sfx').value;settings.muted=$('chk-mute').checked;settings.input=$('input-source').value;settings.sensitivity=+$('sensitivity').value;settings.horizontalAxis=$('horizontal-axis').value;settings.verticalAxis=$('vertical-axis').value;settings.invertHorizontal=$('invert-horizontal').checked;settings.invertVertical=$('invert-vertical').checked;settings.aimMode=$('aim-mode').value;settings.lookMode=$('look-mode').value;settings.turnSpeed=+$('turn-speed').value;settings.fov=+$('fov').value;var c=WebShooterGame.getController();c.settings=settings;c.source=settings.input;apply();tellForward();}
  // Two ways to reach the shooter: WiFi, and the USB cable. "link" is the one in
  // use; only one is connected at a time, since the same packets on both
  // would arrive twice.
  var rx={aim:0,used:0,shoot:0}, link=null, wifi=null, usb=null;
  // The centre has to be set before the wrist can move anything, and it is set
  // once per visit - deliberately not stored, because the board is picked up at
  // a different angle every time and a remembered origin would be wrong.
  // p is the shoot packet when a flick confirmed it, so the centre is taken
  // from before the snap.
  function calConfirm(p){
    var c=WebShooterGame.getController();
    Controller.markCentre(c,p);
    c.source=link&&link.status==='aiming'?'wrist':settings.input;
    $('centre-cal').classList.add('is-hidden');
  }
  function calTick(){
    var c=WebShooterGame.getController();
    if(c.calibrated){$('centre-cal').classList.add('is-hidden');return;}
    $('centre-cal').classList.remove('is-hidden');
    // With no shooter attached there is no wrist to hold still, so the button
    // is offered straight away rather than waiting for a stillness that can
    // never arrive - otherwise the page is unusable on a mouse alone.
    var wrist=link&&link.status==='aiming', ok=!wrist||Controller.steady(c);
    $('btn-cal').disabled=!ok;
    $('btn-cal').textContent=ok?'CONFIRM CENTRE':'HOLD STILL\u2026';
    $('cal-text').textContent=wrist
      ?'Point your wrist at the dot in the middle of the screen, hold it still, then confirm.'
      :'No shooter connected. Confirm to use the mouse, or connect the shooter and hold it at the dot.';
  }
  $('centre-cal').classList.remove('is-hidden');
  function tally(){return rx.aim||rx.shoot?' — aim '+rx.aim+' received, '+rx.used+' used; '+rx.shoot+' shots':'';}
  // Says what to do next, not just what went wrong - "disconnected" alone
  // gives you nothing to try, and the address is the thing to try.
  function linkText(s,host){
    if(host==='USB')return usbText(s);
    if(s==='aiming')return 'Connected to '+host+'. Aiming and shooting.';
    if(s==='connected')return 'Connected to '+host+'...';
    if(s==='legacy')return 'Connected to '+host+', but this firmware cannot aim - reflash web_shooter.ino.';
    if(s==='connecting')return 'Looking for the shooter at '+host+'...';
    if(s==='blocked')return 'A page served over https cannot reach the shooter over WiFi. Open index.html from disk or over http, or use CONNECT USB.';
    return 'No shooter at '+host+'. Check the address the serial monitor printed, then RECONNECT - or plug in the cable and CONNECT USB.';
  }
  function usbText(s){
    if(s==='aiming')return 'Connected over USB. Aiming and shooting.';
    if(s==='legacy')return 'Connected over USB, but this firmware cannot aim - reflash web_shooter.ino.';
    if(s==='connecting')return 'Opening the USB port...';
    // Opening the port can restart the board, and then it calibrates first.
    if(s==='connected')return 'USB port open, waiting for the shooter to answer - if it just restarted, hold it still while it calibrates. Nothing after a minute? Reflash web_shooter.ino: older firmware cannot talk over USB.';
    if(s==='busy')return 'That USB port is in use. Close the Arduino serial monitor (or anything else using it), then CONNECT USB again.';
    if(s==='unsupported')return 'This browser cannot use USB devices. Use Chrome or Edge, with the page opened from disk or localhost.';
    return 'USB cable unplugged - plug it back in and it reconnects, or press RECONNECT to use WiFi.';
  }
  function showStatus(){
    $('menu-status').textContent='CONTROLLER: '+link.status.toUpperCase()+(link===usb?' (USB)':'');
    $('controller-status').textContent=linkText(link.status,link.host)+tally();
  }
  // Switch which link is in use. The other is shut, not just ignored.
  function use(next){
    if(next===link)return;
    if(link===usb)usb.disconnect();else if(link===wifi)wifi.stop();
    link=next;
    // A different link is a different packet stream: start its numbering afresh.
    Controller.resync(WebShooterGame.getController());rx.aim=rx.used=rx.shoot=0;
    showStatus();if(next.status==='aiming')tellForward();
  }
  // Both links report the same events; only the one in use is listened to.
  function wire(l){
    // A shooter that is connected and streaming is the input you meant to use,
    // so hand it the aim without making it fight for it first. Moving the mouse
    // still takes it straight back.
    l.on('status',s=>{if(l!==link)return;showStatus();if(s==='aiming'){tellForward();if(WebShooterGame.getController().calibrated)WebShooterGame.getController().source='wrist';}});
    // A fresh connection restarts the shooter's packet numbering, so forget the
    // old sequence or every packet looks like a stale duplicate.
    l.on('reconnect',()=>{if(l!==link)return;Controller.resync(WebShooterGame.getController());rx.aim=rx.used=rx.shoot=0;});
    // Counted separately on purpose. "Arrived" and "used" being far apart means
    // the packets are being rejected as invalid or stale, which is a completely
    // different problem from no packets arriving at all.
    l.on('aim',p=>{if(l!==link)return;rx.aim++;if(Controller.aim(WebShooterGame.getController(),p,p.rx))rx.used++;});
    // On the menu a flick presses the button under the reticle; in a round it
    // shoots. Same gesture, and the aim comes from the same place either way.
    l.on('shoot',p=>{if(l!==link)return;rx.shoot++;
      var c=WebShooterGame.getController();
      // Before the centre is set a flick means "that is the middle", not "shoot".
      if(!c.calibrated){if(Controller.steady(c))calConfirm(p);return;}
      var at=Controller.shot(c,p);
      if(MenuAim.active())MenuAim.press(at);else if(WorldGame.active())WorldGame.fire(at,p);else WebShooterGame.fire(at);});
  }
  document.addEventListener('webshooter:ready',async()=>{apply();$('btn-new').disabled=false;$('btn-classic').disabled=false;MenuAim.mount({getController:()=>WebShooterGame.getController()});var c=WebShooterGame.getController();c.settings=settings;c.source=settings.input;
    wifi=new ShooterLink();$('shooter-host').value=wifi.host;wire(wifi);
    usb=new SerialLink();wire(usb);
    link=wifi;
    calTick();setInterval(calTick,150);
    setInterval(()=>{if(!$('settings').classList.contains('is-hidden'))$('controller-status').textContent=linkText(link.status,link.host)+tally();},400);
    // RECONNECT (or a new address) means WiFi.
    var retarget=()=>{use(wifi);$('shooter-host').value=$('shooter-host').value.trim();wifi.setHost($('shooter-host').value);$('shooter-host').value=wifi.host;};
    $('shooter-host').onchange=retarget;$('btn-reconnect').onclick=retarget;
    // The browser asks which port the first time; after that it is remembered.
    $('btn-usb').disabled=!SerialLink.supported();
    if(!SerialLink.supported())$('btn-usb').title='Needs Chrome or Edge';
    // WiFi is only let go once a port has actually been picked; closing the
    // picker changes nothing. A busy port is switched to anyway, so its
    // message ("close the serial monitor") is what you see.
    $('btn-usb').onclick=async()=>{var ok=await usb.choose();if(ok||usb.status==='busy')use(usb);};
    // A cable this page was given before is picked up straight away, and WiFi
    // is not tried at all.
    if(SerialLink.supported()){use(usb);if(await usb.resume())return;use(wifi);}
    wifi.connect();});
  // START, CONTINUE and TRAINING are the 3D city: START opens the first
  // encounter (its card also offers free roam), CONTINUE the furthest one
  // reached, TRAINING the range. CLASSIC is the original 2D game, whose own
  // intro card leads to its training.
  var refreshContinue=()=>{$('btn-continue').disabled=!WorldGame.saved();};
  document.addEventListener('webshooter:quit',refreshContinue);
  $('btn-new').onclick=()=>{WSAudio.init();WSAudio.startMusic();WorldGame.start({fight:0});};
  $('btn-classic').onclick=()=>{WSAudio.init();WSAudio.startMusic();WebShooterGame.start(0);};$('btn-continue').onclick=()=>{WSAudio.init();WSAudio.startMusic();WorldGame.start({fight:Math.max(0,Math.min(2,WorldGame.saved()-1))});};$('btn-training').onclick=()=>{WSAudio.init();WorldGame.start({training:true});};$('btn-settings').onclick=()=>{WebShooterGame.pause();$('settings').classList.remove('is-hidden');};$('btn-close').onclick=()=>$('settings').classList.add('is-hidden');$('btn-center').onclick=()=>Controller.center(WebShooterGame.getController());$('btn-cal').onclick=()=>{if(!$('btn-cal').disabled)calConfirm();};window.addEventListener('keydown',e=>{if(!WebShooterGame.getController().calibrated){if(e.code==='Space'||e.key==='Enter'){e.preventDefault();if(!$('btn-cal').disabled)calConfirm();}return;}if(e.key==='c'||e.key==='C')Controller.center(WebShooterGame.getController());});['vol-music','vol-sfx','input-source','sensitivity','horizontal-axis','vertical-axis','chk-mute','invert-horizontal','invert-vertical','aim-mode','look-mode','turn-speed','fov'].forEach(id=>$(id).onchange=write);$('fov').oninput=()=>{$('fov-value').textContent=$('fov').value+'°';};refreshContinue();
})();
