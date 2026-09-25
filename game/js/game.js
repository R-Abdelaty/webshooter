(function(){'use strict';var $=id=>document.getElementById(id),stage=$('stage'),ctx=stage.getContext('2d'),images={},state=null,training=null,controller=Controller.create(),last=0,effects=[],loadId=0,shownEnd=null,debug=false,lastDebugMs=0;
 // Everything the aim path depends on, on screen, while you are actually
 // holding the thing. The settings panel can't be opened mid-round, and the
 // numbers that matter - which axis, what rate, which source owns the reticle -
 // are exactly the ones you can't infer from a reticle that isn't moving.
 function drawDebug(now){
  if(!debug||now-lastDebugMs<120)return;lastDebugMs=now;
  var S=controller.settings||{},p=controller.last,f=n=>(n===undefined||n===null?'--':(+n).toFixed(1)),c=controller;
  $('hud-debug').textContent=[
   'source   '+c.source+(c.source==='wrist'?'':'   <- wrist is NOT driving the reticle'),
   'axes     horizontal=g'+S.horizontalAxis+'  vertical=g'+S.verticalAxis+'  sens='+S.sensitivity+(c.angles?'  forearm='+Controller.forwardAxis(S):''),
   'aim      '+(S.aimMode||'track')+(c.angles?'   (fused angles from the device)':'   (rates - old firmware, reflash for fused aiming)'),
   'invert   horizontal='+(S.invertHorizontal?'yes':'no')+'  vertical='+(S.invertVertical?'yes':'no'),
   'packet   gx='+f(p&&p.gx)+'  gy='+f(p&&p.gy)+'  gz='+f(p&&p.gz)+(p&&p.flick?'  FLICK':''),
   c.angles
     ?'angles   yaw='+f(c.yaw)+'  pitch='+f(c.pitch)+'  centre pitch='+f(c.centrePitch)+'   (absolute yaw mapping)'
    :'rate     x='+f(c.rateX)+'  y='+f(c.rateY)+'   (soft dead zone '+Controller.SOFT_DEAD_DPS+' deg/s)',
   c.angles
    ?'drift    tracked on the device'
    :'drift    trimmed gx='+f(c.bias.gx)+' gy='+f(c.bias.gy)+' gz='+f(c.bias.gz),
   'reticle  x='+(+c.pos.x).toFixed(3)+'  y='+(+c.pos.y).toFixed(3)
  ].join('\n');
 }
 function layout(){var r=stage.getBoundingClientRect(),w=r.width,h=r.height;stage.width=w*devicePixelRatio;stage.height=h*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);return {w:w,h:h};}
 // One size for the whole encounter. The villain dodges around the arena rather
 // than looming closer, so nothing about its size depends on the clock any more.
 // The cap on both axes keeps the sprite inside Combat.BOX, which is what stops
 // a dodge from parking it half off-screen.
 function rect(v,w,h){
  var arena={y:86,h:Math.max(1,h-170)},aspect=images[v.id].naturalWidth/images[v.id].naturalHeight;
  var height=Math.min(arena.h*.50,w*.42/aspect),width=height*aspect;
  return {x:state.pos.x*w-width/2,y:arena.y+state.pos.y*arena.h-height/2,width:width,height:height};
 }
 // --- web splat -----------------------------------------------------------
 // Webs stay stuck on screen the way they do in the reference clip, rather than
 // blinking out after half a second. They fade only near the end of their life,
 // and the oldest is dropped once there are too many to read.
 var WEB_LIFE=6000,MAX_WEBS=14;
 // An orb web: spokes out to a slightly ragged rim, with threads strung between
 // them that sag inwards the way a real one does. Perfect circles read as a
 // dartboard, which is why the rim length and the spoke angles are jittered and
 // the rings are curves rather than arcs.
 var SPOKES=12,RINGS=5;
 function webShape(seed){
  var r=seed*9301+49297,i,out=[];
  function rnd(){r=(r*9301+49297)%233280;return r/233280;}
  for(i=0;i<SPOKES;i++)out.push({ang:(i/SPOKES)*Math.PI*2+(rnd()-.5)*.28,len:.76+rnd()*.24});
  return out;
 }
 function drawWeb(x,y,radius,alpha,seed){
  var P=webShape(seed),i,j;
  ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';
  ctx.shadowColor='rgba(255,255,255,.55)';ctx.shadowBlur=radius*.28;
  ctx.lineWidth=Math.max(1,radius*.045);
  ctx.beginPath();
  for(i=0;i<SPOKES;i++)
   {ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(P[i].ang)*radius*P[i].len,y+Math.sin(P[i].ang)*radius*P[i].len);}
  ctx.stroke();
  ctx.lineWidth=Math.max(1,radius*.032);
  for(j=1;j<=RINGS;j++){
   var t=j/RINGS;
   ctx.beginPath();
   for(i=0;i<SPOKES;i++){
    var a=P[i],b=P[(i+1)%SPOKES],bAng=b.ang;
    if(bAng<a.ang)bAng+=Math.PI*2;                       // the wrap-around gap
    var r1=radius*a.len*t,r2=radius*b.len*t,mid=(a.ang+bAng)/2;
    // Pull the control point inside the rim so the thread hangs between spokes.
    var cr=(r1+r2)/2*(1-.16*(bAng-a.ang)*SPOKES/6);
    if(i===0)ctx.moveTo(x+Math.cos(a.ang)*r1,y+Math.sin(a.ang)*r1);
    ctx.quadraticCurveTo(x+Math.cos(mid)*cr,y+Math.sin(mid)*cr,
                         x+Math.cos(bAng)*r2,y+Math.sin(bAng)*r2);
   }
   ctx.closePath();ctx.stroke();
  }
  ctx.shadowBlur=0;ctx.fillStyle='#fff';
  ctx.beginPath();ctx.arc(x,y,Math.max(1.5,radius*.075),0,Math.PI*2);ctx.fill();
  ctx.restore();
 }
 // The strand is only there for the instant of the shot - it sells where the web
 // came from, then gets out of the way so the splat is what you actually read.
 function drawStrand(ox,oy,x,y,alpha){
  ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.lineCap='round';
  var mx=(ox+x)/2,my=(oy+y)/2+Math.abs(x-ox)*.06;
  ctx.beginPath();ctx.moveTo(ox,oy);ctx.quadraticCurveTo(mx,my,x,y);ctx.stroke();ctx.restore();
 }
 // Shared by both modes so practice looks exactly like play.
 function drawMark(t){
  ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(t.x,t.y,t.radius,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle='#d5222a';ctx.beginPath();
  ctx.moveTo(t.x-t.radius,t.y);ctx.lineTo(t.x+t.radius,t.y);
  ctx.moveTo(t.x,t.y-t.radius);ctx.lineTo(t.x,t.y+t.radius);ctx.stroke();
 }
 function drawReticle(z){
  // Flick-only mode deliberately shows nothing. The position still tracks your
  // wrist underneath, so the shot lands where you are pointing - you just have
  // to know where that is, which is the whole point of the mode.
  if((controller.settings||{}).aimMode==='flick')return;
  // Drawn from the eased position so it moves at the display's rate; shots
  // use controller.pos, the true aim.
  var d=Controller.display(controller,performance.now()),x=d.x*z.w,y=d.y*z.h;
  ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);
  ctx.moveTo(x-20,y);ctx.lineTo(x+20,y);ctx.moveTo(x,y-20);ctx.lineTo(x,y+20);ctx.stroke();
 }
 function drawWebs(now,z){
  effects=effects.filter(e=>now-e.time<WEB_LIFE);
  effects.forEach(e=>{
   var age=now-e.time,pop=Math.min(1,age/150),grow=1-Math.pow(1-pop,3),
       fade=age<WEB_LIFE-1200?1:Math.max(0,(WEB_LIFE-age)/1200);
   if(age<220)drawStrand(z.w/2,z.h-6,e.x,e.y,Math.max(0,1-age/220));
   drawWeb(e.x,e.y,e.radius*grow,fade,e.seed);
   if(age<260){ctx.save();ctx.globalAlpha=Math.max(0,1-age/260);ctx.strokeStyle='#fff';ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(e.x,e.y,e.radius*(1+age/260),0,Math.PI*2);ctx.stroke();ctx.restore();}
  });
  ctx.globalAlpha=1;
 }
 function splat(p,hit,z,n){
  var base=Math.min(z.w,z.h);
  effects.push({x:p.x,y:p.y,hit:hit,time:performance.now(),seed:(n*2654435761)%100000,radius:base*(hit?.085:.062)});
  while(effects.length>MAX_WEBS)effects.shift();
  WSAudio.thwip();if(hit)WSAudio.crunch();else WSAudio.thunk();
 }
 // --- training ------------------------------------------------------------
 // Targets on the menu artwork instead of a villain. Hitting one moves it
 // elsewhere; nothing can run out, so it is somewhere to get used to the wrist.
 function trainingMark(z){
  var t=training.target;
  return {x:t.x*z.w,y:t.y*z.h,radius:Math.max(24,Math.min(46,Math.min(z.w,z.h)*.045))};
 }
 var HINT_PLAY='Move to aim · Click / Space to shoot · Esc to pause · D for controller readout';
 var HINT_TRAIN='Move to aim · Click / Space to shoot · Esc or MENU to leave · D for controller readout';
 function drawTraining(now){
  var z=layout();ctx.clearRect(0,0,z.w,z.h);
  var t=trainingMark(z),pulse=1+.06*Math.sin(now/170);
  ctx.save();ctx.globalAlpha=.9;ctx.strokeStyle='#fff';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(t.x,t.y,t.radius*1.45*pulse,0,Math.PI*2);ctx.stroke();ctx.restore();
  drawMark(t);drawReticle(z);drawWebs(now,z);
  var acc=Math.round(Training.accuracy(training)*100);
  $('hud-level').textContent='TRAINING';
  $('hud-vname').textContent='TARGET PRACTICE';
  $('hud-timer').textContent='STREAK '+training.streak;
  $('hud-timer').classList.remove('is-low');
  $('hud-health').textContent=training.hits+' hit / '+training.shots+' shot  ·  '+acc+'%';
  $('hud-healthbar').style.width=acc+'%';
  $('hud-hint').textContent=HINT_TRAIN;
 }
 function startTraining(){
  state=null;training=Training.start();Controller.reset(controller);effects=[];shownEnd=null;
  document.body.classList.add('is-training');
  $('card').classList.add('is-hidden');
  $('game').classList.remove('is-hidden');$('menu').classList.add('is-hidden');
  layout();last=performance.now();
 }
 function target(v,sr){var p=v.targets[state.targetIndex%v.targets.length];return{name:p.name,x:sr.x+p.x*sr.width,y:sr.y+p.y*sr.height,radius:Math.max(22,Math.min(38,sr.height*.055))};}
 function draw(now){if(!state)return;var z=layout(),level=LEVELS[state.levelIndex],v=VILLAINS[level.villain],sr=rect(v,z.w,z.h),t=target(v,sr);ctx.clearRect(0,0,z.w,z.h);ctx.globalAlpha=state.mode==='won'?Math.max(0,1-(now-(effects.defeat||now))/800):1;ctx.drawImage(images[v.id],sr.x,sr.y,sr.width,sr.height);ctx.globalAlpha=1;if(state.mode==='playing'){drawMark(t);drawReticle(z);drawWebs(now,z);}
 var left=Math.max(0,state.timeLimit-state.elapsed);$('hud-timer').textContent=left.toFixed(1)+'s';$('hud-timer').classList.toggle('is-low',left<=10);$('hud-hint').textContent=HINT_PLAY;$('hud-level').textContent='ENCOUNTER '+level.n;$('hud-vname').textContent=v.name;$('hud-health').textContent=state.health+' / '+state.maxHealth;$('hud-healthbar').style.width=(state.health/state.maxHealth*100)+'%';}
 function frame(now){if(training){var td=last?Math.min(.1,(now-last)/1000):0;last=now;Training.tick(training,td);drawTraining(now);drawDebug(now);requestAnimationFrame(frame);return;}if(!state){last=now;requestAnimationFrame(frame);return;}var dt=last?Math.min(.1,(now-last)/1000):0;last=now;Combat.tick(state,dt);if(state.mode==='lost'&&shownEnd!=='lost'){shownEnd='lost';card('DEFEAT','Retry','retry');}if(state.mode==='won'&&shownEnd!=='won'){shownEnd='won';effects.defeat=now;card(state.levelIndex<2?'VICTORY':'CITY SAVED',state.levelIndex<2?'Next Encounter':'Replay','next');}draw(now);drawDebug(now);requestAnimationFrame(frame);}
 function card(title,button,action){
  var c=$('card'),i=$('card-inner');c.classList.remove('is-hidden');i.dataset.kind=title.toLowerCase().replace(/\s+/g,'-');
  var message=title==='INTRO'?'Thirty seconds. Hit the weak spots - it will dodge.':title==='PAUSED'?'The clock stops until you resume.':title==='DEFEAT'?'Out of time. The villain got away.':title==='VICTORY'?'One villain down. The city still needs you.':'The city is safe!';
  i.innerHTML='<h2>'+title+'</h2><p>'+message+'</p><div class="card-actions"><button data-action="'+action+'">'+button+'</button><button data-action="menu">MENU</button></div>';
  i.querySelectorAll('button').forEach(b=>b.onclick=()=>{var a=b.dataset.action;if(a==='menu')quit();else if(a==='retry')start(state.levelIndex);else if(a==='next')start(state.levelIndex<2?state.levelIndex+1:0);else{Combat.play(state);c.classList.add('is-hidden');last=performance.now();}});
 }
 function fire(pos){
  var z=layout();
  // A canvas with no area collapses the shot and the target onto the origin,
  // so every shot would score as a dead-centre hit. It happens for real when
  // the window is minimised, or if a shot lands before layout has settled.
  if(!(z.w>0&&z.h>0))return;
  var p={x:pos.x*z.w,y:pos.y*z.h};
  if(training){var r=Training.fire(training,p,trainingMark(z));if(r.accepted)splat(p,r.hit,z,training.shots);return;}
  if(!state||state.mode!=='playing')return;
  var v=VILLAINS[LEVELS[state.levelIndex].villain],t=target(v,rect(v,z.w,z.h)),c=Combat.fire(state,p,t);
  if(c.accepted)splat(p,c.hit,z,state.shots);
 }
 // The controller is reset, never rebuilt. Rebuilding lost everything it had
 // learned - first the input source, so the wrist had to re-win the handover on
 // every retry, and then the gyro bias, which drifted the reticle off the screen
 // during the intro. Round state is cleared; what was measured is kept.
 function start(index){training=null;document.body.classList.remove('is-training');state=Combat.start(index,LEVELS);Controller.reset(controller);effects=[];shownEnd=null;$('game').classList.remove('is-hidden');$('menu').classList.add('is-hidden');layout();card('INTRO','GO','go');}
 function quit(){$('game').classList.add('is-hidden');$('menu').classList.remove('is-hidden');$('card').classList.add('is-hidden');document.body.classList.remove('is-training');state=null;training=null;effects=[];document.dispatchEvent(new CustomEvent('webshooter:quit'));}
 function pointer(e){var r=stage.getBoundingClientRect();return{x:Controller.clamp((e.clientX-r.left)/r.width,0,1),y:Controller.clamp((e.clientY-r.top)/r.height,0,1)};}
 stage.addEventListener('pointermove',e=>{controller.pos=pointer(e);controller.source='mouse';});stage.addEventListener('pointerdown',e=>{if(e.button===0){controller.pos=pointer(e);fire(controller.pos);}});$('btn-quit').onclick=quit;window.addEventListener('keydown',e=>{if(training){if(e.key==='Escape')quit();if(e.code==='Space'){e.preventDefault();fire(controller.pos);}if(e.key==='d'||e.key==='D'){debug=!debug;$('hud-debug').classList.toggle('is-hidden',!debug);}return;}if(!state)return;if(e.code==='Space'){e.preventDefault();fire(controller.pos);}if(e.key==='d'||e.key==='D'){debug=!debug;$('hud-debug').classList.toggle('is-hidden',!debug);}if(e.key==='Escape'){if(state.mode==='playing'){Combat.pause(state);card('PAUSED','RESUME','go');}}});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state&&state.mode==='playing'){Combat.pause(state);card('PAUSED','RESUME','go');}});window.addEventListener('resize',layout);
 function preload(){var keys=VILLAINS.map(v=>v.id),n=++loadId;Promise.all(VILLAINS.map(v=>new Promise((ok,bad)=>{var im=new Image();im.onload=()=>im.decode?im.decode().then(()=>ok([v.id,im])).catch(bad):ok([v.id,im]);im.onerror=bad;im.src=v.sprite;}))).then(a=>{if(n!==loadId)return;a.forEach(x=>images[x[0]]=x[1]);window.Game={start:start,quit:quit,get state(){return state},controller:controller,fire:fire};
  // Cached images can finish before the rest of the page's scripts have run,
  // and menu.js must be listening when this goes out - so wait for the parse.
  var ready=()=>document.dispatchEvent(new CustomEvent('webshooter:ready'));if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();}).catch(()=>alert('Could not load a villain asset. Refresh to retry.'));}preload();requestAnimationFrame(frame);
 window.WebShooterGame={start:start,startTraining:startTraining,quit:quit,getController:()=>controller,fire:fire,pause:function(){if(state&&state.mode==='playing'){Combat.pause(state);card('PAUSED','RESUME','go');}},getState:function(){return state;},getTraining:function(){return training;}};})();
