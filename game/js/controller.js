(function(root){'use strict';
 function clamp(v,a,b){return Math.max(a,Math.min(b,v));} function delta(a,b){return (a-b)>>>0;}
 function create(settings){return {pos:{x:.5,y:.5},lastSeq:null,lastMs:null,rateX:0,rateY:0,history:[],bias:{gx:0,gy:0,gz:0},quietFor:0,calibrated:false,recent:null,steadyFor:0,blocked:false,settleUntil:null,last:null,
  // Angle mode: map each heading to a fixed screen position. Summing filtered
  // deltas made a fast flick and a slower return leave a permanent offset.
  angles:false,yaw:null,pitch:null,centrePitch:null,yawAnchor:null,xAnchor:.5,xGain:null,
  // What the reticle is drawn from - see display().
  trail:[],clockOff:null,jitter:0,interval:25,
  settings:settings||{horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false},source:'mouse'};}
 // Anything that moves the aim other than a packet drops the drawing trail, so
 // the reticle goes straight there instead of gliding from where it was.
 function center(c){c.pos={x:.5,y:.5};c.rateX=c.rateY=0;c.history=[];c.trail=[];c.yawAnchor=c.yaw;c.xAnchor=.5;c.xGain=yawGain(c);if(c.pitch!==null)c.centrePitch=c.pitch;}
 // Starting a round clears where you were aiming - but NOT what the controller
 // has learned about the hardware. The gyro's measured zero point took seconds
 // of stillness to establish, and rebuilding the controller threw it away, so
 // every round opened with the raw bias driving the reticle across the screen
 // while the trim worked it out again. On a long INTRO card that is enough to
 // pin the reticle in a corner before the round even starts.
 //
 // Nor the centre pitch. Pitch is absolute, and a round is usually started by
 // flicking at a button - taking the pitch then would take it mid-snap.
 function reset(c){
  var cp=c.centrePitch;
  center(c);
  c.centrePitch=cp;
  if(c.angles&&c.pitch!==null&&cp!==null)c.pos.y=pitchToY(c,c.pitch);
  c.blocked=false;c.settleUntil=null;c.last=null;
  c.lastSeq=c.lastMs=null;          // the device keeps streaming; resync on the next packet
  return c;                         // bias, centre, settings and source all survive
 }
 // A new socket: the device may have rebooted, so its sequence numbers and its
 // running yaw start again. Pitch is absolute, so the centre still holds.
 function resync(c){c.lastSeq=c.lastMs=null;c.yaw=null;c.yawAnchor=null;c.xAnchor=c.pos.x;c.xGain=yawGain(c);c.trail=[];c.clockOff=null;return c;}
 // gx/gy/gz arrive in deg/s straight from the shooter's gyro, and dyaw in
 // degrees. SCREENS_PER_DEG is how far a turn pushes the reticle - 250 degrees
 // of wrist turn is one screen, so a brisk 200-300 deg/s crosses it in about a
 // second at sensitivity 1.
 var SCREENS_PER_DEG=1/250, SCREENS_PER_DPS=SCREENS_PER_DEG;
 // Legacy rate packets only: slow movement is scaled down smoothly rather than cut off: a rate v is kept
 // in proportion v^2/(v^2+k^2). A hard dead zone made small corrections feel
 // sticky and then jumpy as they crossed it. At k=1.5, tremor and residual
 // drift (well under 1 deg/s) almost vanish, 3 deg/s keeps 80%, and slow
 // careful tracking at 5-20 deg/s keeps 92-99%. Fused angle packets use their
 // running yaw directly so a slow return cancels a fast outward movement.
 var SOFT_DEAD_DPS=1.5;
 function soft(v){return v*v/(v*v+SOFT_DEAD_DPS*SOFT_DEAD_DPS);}
 // The aim is allowed to run off the screen instead of stopping dead at the
 // edge. Clamping it to the screen destroys the overshoot: your wrist keeps
 // turning, the number cannot, and when you come back the middle of the screen
 // is no longer where the middle of your wrist range is. Every touch of an edge
 // shifted the centre a little further.
 //
 // Letting it overflow keeps the two in step. It is still bounded - half a
 // screen past each edge - so a long spin cannot leave you winding it back for
 // ever, but nothing you would do while aiming ever reaches that.
 var OVERFLOW=.5;
 // Vertical needs more gain than horizontal, because your wrist has far less of
 // it to give. SCREENS_PER_DEG asks for 125 degrees of rotation to get from the
 // centre of the screen to an edge. Sideways that is easy - forearm rotation
 // plus a little arm swing covers 150-180. Upwards it is not: the wrist only
 // extends about 55-70 degrees, so the top of the screen was simply out of
 // reach, and short by more than the bottom because extension has less range
 // than flexion. Same gain on both axes, very different joints.
 //
 // At 2.2 the centre-to-top trip is about 57 degrees, which is inside a
 // comfortable extension. Raise it if the top is still short, lower it if
 // vertical feels twitchy next to horizontal.
 var VERTICAL_GAIN=2.2;

 // "the middle of the screen" cannot be measured - it has to be declared. You
 // hold the wrist where the middle should be and say so, and that pose becomes
 // the origin: yaw is measured from it, and its pitch is the pitch the middle
 // of the screen sits at.
 //
 // Nothing moves before that happens. Without an origin the reticle would start
 // wherever it happened to be, which is the confusion this removes.
 var STEADY_DPS=12, STEADY_SECONDS=.6;
 function steady(c){return c.steadyFor>=STEADY_SECONDS;}
 // Take the resting reading as the zero as well (for firmware that only sends
 // rates). The wrist is being held still to do this, which is the best look at
 // the gyro's offset we will ever get.
 //
 // p is the shoot packet when a flick confirmed it: its prePitch is where the
 // wrist was before the snap, which is the pose that was meant.
 function markCentre(c,p){
  // Only trust the resting reading if the wrist really is resting. Called mid-
  // movement it would bake a moving reading in as the zero, and every later aim
  // would be measured from a lie - so leave the trimmed estimate alone instead.
  if(c.recent&&steady(c))c.bias={gx:c.recent.gx,gy:c.recent.gy,gz:c.recent.gz};
  center(c);
  if(p&&Number.isFinite(p.prePitch))c.centrePitch=p.prePitch;
  if(p&&Number.isFinite(p.preYaw))c.yawAnchor=p.preYaw;
  c.calibrated=true;c.blocked=false;c.settleUntil=null;c.steadyFor=0;c.quietFor=0;
  return c;
 }

 // Old firmware only: a gyro's zero point wanders with temperature and knocks,
 // and the boot calibration is only good for a minute or two. Current firmware
 // tracks it on the device, where it can see every sample and the
 // accelerometer, so the page does nothing.
 //
 // Learning here is kept to readings within BIAS_LEARN_LIMIT of the current
 // zero, and slow. Wider, it absorbed slow deliberate aiming - 5-20 deg/s of
 // fine tracking looked like "drift", and the reticle slowed down under you.
 var BIAS_LEARN_LIMIT=3, BIAS_SECONDS=20, BIAS_REST_DELAY=1;
 function trimBias(c,p,dt){
  // Learn only while EVERY axis is quiet. A wrist at rest is quiet on all three;
  // a deliberate turn shows up on at least one, and that suspends learning.
  if(!['gx','gy','gz'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k]-c.bias[k])<BIAS_LEARN_LIMIT)){c.quietFor=0;return;}
  c.quietFor+=dt;
  if(c.quietFor<BIAS_REST_DELAY)return;   // a momentary lull between movements is not rest
  var k=Math.min(1,dt/BIAS_SECONDS);
  ['gx','gy','gz'].forEach(function(axis){c.bias[axis]+=(p[axis]-c.bias[axis])*k;});
 }

 // Old firmware only. The flick has to be left out of the aim: the position is
 // the integral of rotation, so a 2000 deg/s snap would hurl the reticle across
 // the screen. That firmware doesn't say when a flick is happening, so it is
 // guessed from speed: a real flick runs 600-1500 deg/s, aiming 100-200. Only
 // the unmistakable ones are dropped. Current firmware marks flick packets
 // itself ("flick":true) and none of this applies.
 var FLICK_DPS=450;

 // Old firmware only. Dropping the fast packets is not enough on its own: the
 // ramps either side of the peak are integrated and are not symmetric. The
 // whole gesture is shooting, not aiming, so when the shot lands the aim goes
 // back to where it was just before the snap, which cancels both ramps at once.
 // Then aiming resumes as soon as the wrist settles - and at the latest after
 // SETTLE_MS, so that swinging straight on to the next target cannot be mistaken
 // for a flick still finishing and leave the reticle stranded.
 var SETTLE_DPS=120, SETTLE_MS=200;
 // How much of the aim's recent trail to keep for that rewind. It has to
 // comfortably outlast a flick, which can run 250 ms.
 var HISTORY_MS=500;
 // A packet more than this after the last one is a dropout, not a movement.
 var GAP_SECONDS=.2;

 // Read the settings defensively. A missing or misspelled axis makes p['gundefined']
 // undefined, and one undefined turns every number downstream into NaN: NaN>2 is
 // false so the wrist never takes over, and clamp(NaN) is NaN so the reticle stops
 // having a position at all. Both failures look identical from the outside - the
 // packet is accepted, nothing moves, nothing is logged. Fall back instead.
 function axisOf(v,fallback){return v==='x'||v==='y'||v==='z'?'g'+v:fallback;}
 function sensOf(v){v=+v;return Number.isFinite(v)&&v>0?v:1;}
 // The fusing firmware needs to know which board axis points along the forearm.
 // It is the one the HORIZONTAL and VERTICAL settings leave over: those name the
 // axes you turn about, and you turn about the two that are not the one you point
 // with.
 function forwardAxis(S){
  S=S||{};var h=axisOf(S.horizontalAxis,'gz')[1],v=axisOf(S.verticalAxis,'gx')[1];
  return ['y','x','z'].filter(a=>a!==h&&a!==v)[0];
 }
 function valid(c,p){if(!p||!Number.isInteger(p.seq)||!Number.isInteger(p.ms)||!['gx','gy','gz'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=2500))return false;if(c.lastSeq!==null&&(delta(p.seq,c.lastSeq)===0||delta(p.seq,c.lastSeq)>0x7fffffff))return false;if(c.lastMs!==null&&(delta(p.ms,c.lastMs)===0||delta(p.ms,c.lastMs)>0x7fffffff))return false;return true;}
 function hasAngles(p){return ['dyaw','dpitch','yaw','pitch'].every(k=>Number.isFinite(p[k]));}

 // How the wrist is resting, and how long it has rested there. The centre prompt
 // uses the second one to know when the centre is worth taking.
 function trackRest(c,p,dt){
  if(!c.recent)c.recent={gx:p.gx,gy:p.gy,gz:p.gz};
  var rk=dt?1-Math.exp(-dt/.4):1,moved=0;
  ['gx','gy','gz'].forEach(function(k){
   moved=Math.max(moved,Math.abs(p[k]-c.recent[k]));
   c.recent[k]+=(p[k]-c.recent[k])*rk;
  });
  c.steadyFor=moved<STEADY_DPS?c.steadyFor+dt:0;
 }

 // Pitch is gravity-referenced, so the height on screen is a function of it -
 // not a sum of movements - and cannot drift.
 function pitchToY(c,pitch){
  var S=c.settings||{},k=sensOf(S.sensitivity)*SCREENS_PER_DEG*VERTICAL_GAIN*(S.invertVertical?-1:1);
  return clamp(.5-(pitch-c.centrePitch)*k,-OVERFLOW,1+OVERFLOW);
 }
 function yawGain(c){var S=c.settings||{};return sensOf(S.sensitivity)*SCREENS_PER_DEG*(S.invertHorizontal?-1:1);}
 function yawToX(c,yaw){return clamp(c.xAnchor+(yaw-c.yawAnchor)*yawGain(c),-OVERFLOW,1+OVERFLOW);}

 // Current firmware: use the running yaw for position. A return to the same
 // heading must land at the same x, regardless of flick speed, packet gaps, or
 // which part of a flick was flagged. Deltas still identify wrist motion.
 var WRIST_TAKEOVER_DPS=5;
 function aimAngles(c,p,dt,prevSeq,now){
  trackRest(c,p,dt);
  // Consecutive packets use the delta for takeover. After a gap, recover the
  // motion rate from the running yaw.
  var previousYaw=c.yaw;
  var consecutive=prevSeq!==null&&delta(p.seq,prevSeq)===1&&dt<=GAP_SECONDS;
  var dyaw=consecutive?p.dyaw:(previousYaw===null?0:p.yaw-previousYaw);
  var prevPitch=c.pitch===null?p.pitch:c.pitch;
  c.yaw=p.yaw;c.pitch=p.pitch;c.angles=true;
  c.last={gx:p.gx,gy:p.gy,gz:p.gz,yaw:p.yaw,pitch:p.pitch,flick:!!p.flick};
  if(!c.calibrated)return true;   // no origin yet, so nothing to move relative to
  if(c.centrePitch===null)c.centrePitch=p.pitch;   // centre was confirmed before the shooter spoke
  if(c.yawAnchor===null){c.yawAnchor=p.yaw;c.xAnchor=c.pos.x;}
  var gain=yawGain(c);
  if(c.xGain!==gain){c.yawAnchor=previousYaw===null?p.yaw:previousYaw;c.xAnchor=c.pos.x;c.xGain=gain;}
  // The device marks the flick itself. The whole gesture is shooting, not
  // aiming; shot() puts the aim back where it was before it.
  if(p.flick){remember(c,p,now);return true;}
  var span=Math.max(dt,.001),yawRate=dyaw/span,pitchRate=(p.pitch-prevPitch)/span;
  if(c.source!=='wrist'&&Math.max(Math.abs(yawRate),Math.abs(pitchRate))>WRIST_TAKEOVER_DPS){
   c.yawAnchor=previousYaw===null?p.yaw:previousYaw;c.xAnchor=c.pos.x;c.source='wrist';
  }
  if(c.source==='wrist'){
   c.pos.x=yawToX(c,p.yaw);
   c.pos.y=pitchToY(c,p.pitch);
  }
  remember(c,p,now);
  return true;
 }

 function aim(c,p,now){
  if(!valid(c,p))return false;
  var prevSeq=c.lastSeq,dt=c.lastMs===null?0:delta(p.ms,c.lastMs)/1000;
  c.lastSeq=p.seq;c.lastMs=p.ms;
  if(hasAngles(p))return aimAngles(c,p,dt,prevSeq,now);

  // Old firmware: rates only, integrated here.
  if(dt>GAP_SECONDS){c.rateX=c.rateY=0;return false;}      // rates can't say what happened in a gap
  var S=c.settings||{},sens=sensOf(S.sensitivity);
  trimBias(c,p,dt);
  trackRest(c,p,dt);
  if(!c.calibrated)return true;

  var spin=Math.max(Math.abs(p.gx),Math.abs(p.gy),Math.abs(p.gz));
  if(c.settleUntil!==null){
   var left=delta(c.settleUntil,p.ms);
   if(spin>SETTLE_DPS&&left>0&&left<0x80000000){c.rateX=c.rateY=0;return false;}
   c.settleUntil=null;c.blocked=true;      // settled: one packet to resync, then aim
  }
  if(spin>FLICK_DPS){c.blocked=true;return false;}
  // One packet to shed the flick's tail out of the smoothed rate, then aim again.
  if(c.blocked){c.blocked=false;c.rateX=c.rateY=0;return false;}

  var hAx=axisOf(S.horizontalAxis,'gz'),vAx=axisOf(S.verticalAxis,'gx');
  var hx=p[hAx]-c.bias[hAx],vy=p[vAx]-c.bias[vAx];
  if(!Number.isFinite(hx))hx=0;
  if(!Number.isFinite(vy))vy=0;
  hx=(S.invertHorizontal?-1:1)*hx*soft(hx);
  vy=(S.invertVertical?-1:1)*vy*soft(vy);
  var a=dt?1-Math.exp(-dt/.04):1;
  c.rateX+=(hx-c.rateX)*a;c.rateY+=(vy-c.rateY)*a;
  if(Math.abs(c.rateX)+Math.abs(c.rateY)>2)c.source='wrist';
  if(c.source==='wrist'){
   c.pos.x=clamp(c.pos.x+c.rateX*dt*sens*SCREENS_PER_DEG,-OVERFLOW,1+OVERFLOW);
   c.pos.y=clamp(c.pos.y+c.rateY*dt*sens*SCREENS_PER_DEG*VERTICAL_GAIN,-OVERFLOW,1+OVERFLOW);
  }
  c.last={gx:p.gx,gy:p.gy,gz:p.gz,armed:!!p.armed};
  remember(c,p,now);
  return true;
 }

 // --- drawing ---------------------------------------------------------------
 // Packets arrive at 100 Hz (40 on old firmware), in WiFi-sized clumps, and the
 // display runs at 60-144. Drawing the aim as it stands makes the reticle step.
 // So every accepted packet is kept on a short trail stamped with the DEVICE's
 // clock, and the reticle is drawn a little behind real time, interpolated
 // between the two samples either side. Device timestamps are evenly spaced
 // however bunched the arrivals were, so the motion comes out even.
 //
 // Only the drawing lags. Shots and button presses use pos, the true aim.
 var RENDER_DELAY_MIN_MS=8, RENDER_DELAY_MAX_MS=60, TRAIL_LEN=12;
 function remember(c,p,now){
  c.history.push({ms:p.ms,x:c.pos.x,y:c.pos.y});
  while(c.history.length&&delta(p.ms,c.history[0].ms)>HISTORY_MS)c.history.shift();
  if(c.trail.length){var gap=delta(p.ms,c.trail[c.trail.length-1].ms);if(gap<250)c.interval+=(gap-c.interval)*.1;}
  c.trail.push({ms:p.ms,x:c.pos.x,y:c.pos.y});
  if(c.trail.length>TRAIL_LEN)c.trail.shift();
  if(!Number.isFinite(now))return;
  // The page and device clocks differ by an unknown offset plus the network
  // delay. The smallest difference seen is the best estimate of the offset;
  // it is allowed to creep up slowly in case the link gets permanently slower.
  var off=now-p.ms;
  if(c.clockOff===null||off<c.clockOff)c.clockOff=off;else c.clockOff+=(off-c.clockOff)*.002;
  // How late packets run beyond that, tracking the worst recently rather than
  // the average: drawing has to stay behind the LAST packet of a clump, or it
  // runs out of samples and the reticle stops for a frame.
  var late=off-c.clockOff;
  c.jitter+=(late-c.jitter)*(late>c.jitter?.3:.01);
 }
 function renderDelay(c){return clamp(c.interval*1.2+c.jitter,RENDER_DELAY_MIN_MS,RENDER_DELAY_MAX_MS);}
 function display(c,now){
  var t=c.trail,n=t.length;
  if(c.source!=='wrist'||n<2||c.clockOff===null||!Number.isFinite(now))return {x:c.pos.x,y:c.pos.y};
  var at=now-c.clockOff-renderDelay(c);          // on the device's clock
  if(at>=t[n-1].ms)return {x:t[n-1].x,y:t[n-1].y};
  if(at<=t[0].ms)return {x:t[0].x,y:t[0].y};
  for(var i=n-1;i>0&&t[i-1].ms>at;i--);
  var a=t[i-1],b=t[i],u=(at-a.ms)/Math.max(1,b.ms-a.ms);
  return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
 }

 // How far off the screen the aim has run, per edge, as 0..1 of the overflow
 // allowance. The reticle is genuinely out there - this is what tells you which
 // way, and how far, so it can be brought back.
 var OFF_FULL=.28;   // this far past an edge shows the marker at full strength
 function offscreen(c){
  return {
   left:clamp(-c.pos.x/OFF_FULL,0,1), right:clamp((c.pos.x-1)/OFF_FULL,0,1),
   top:clamp(-c.pos.y/OFF_FULL,0,1),  bottom:clamp((c.pos.y-1)/OFF_FULL,0,1),
   along:{x:clamp(c.pos.x,0,1),y:clamp(c.pos.y,0,1)},
   out:c.pos.x<0||c.pos.x>1||c.pos.y<0||c.pos.y>1
  };
 }

 // The shot is placed from just before the flick, so the snap cannot drag your
 // aim off target on its way past, and the reticle is put back to the same
 // place.
 //
 // Current firmware says exactly where that was: preYaw/prePitch are its own
 // angles from shortly before the flick began. Old firmware only has a time,
 // so the aim's own recent trail is searched for it instead.
 function shot(c,p){
  var at={x:c.pos.x,y:c.pos.y};
  if(c.source!=='wrist')return at;                // the mouse is aiming; the flick only fires
  if(p&&c.angles&&Number.isFinite(p.preYaw)&&Number.isFinite(p.prePitch)&&c.yaw!==null){
   at.x=c.yawAnchor===null?c.pos.x:yawToX(c,p.preYaw);
   if(c.centrePitch!==null)at.y=pitchToY(c,p.prePitch);
   c.pos={x:at.x,y:at.y};c.trail=[];
   return at;
  }
  if(Number.isInteger(p&&p.ms)){
   var wanted=(p.ms-80)>>>0,found=null;
   c.history.forEach(function(x){if(delta(wanted,x.ms)<0x80000000)found=x;});
   // Nothing that old left in the trail - a late packet, or a long flick. The
   // oldest entry we still have is closer to the pre-flick aim than the
   // displaced spot we are standing on, so it is the better answer.
   if(!found&&c.history.length)found=c.history[0];
   if(found)at={x:found.x,y:found.y};
   c.pos={x:at.x,y:at.y};c.trail=[];
   c.rateX=c.rateY=0;
   c.settleUntil=(p.ms+SETTLE_MS)>>>0;
  }
  return at;
 }

 var api={create:create,center:center,reset:reset,resync:resync,markCentre:markCentre,steady:steady,offscreen:offscreen,display:display,renderDelay:renderDelay,forwardAxis:forwardAxis,soft:soft,OVERFLOW:OVERFLOW,STEADY_SECONDS:STEADY_SECONDS,aim:aim,shot:shot,clamp:clamp,delta:delta,FLICK_DPS:FLICK_DPS,SETTLE_DPS:SETTLE_DPS,SETTLE_MS:SETTLE_MS,SCREENS_PER_DPS:SCREENS_PER_DPS,SCREENS_PER_DEG:SCREENS_PER_DEG,VERTICAL_GAIN:VERTICAL_GAIN,SOFT_DEAD_DPS:SOFT_DEAD_DPS,BIAS_LEARN_LIMIT:BIAS_LEARN_LIMIT};
 if(typeof module!=='undefined')module.exports=api;root.Controller=api;
})(typeof window==='undefined'?globalThis:window);
