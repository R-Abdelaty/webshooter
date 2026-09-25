const test=require('node:test'),assert=require('node:assert/strict');
const Combat=require('../js/combat.js'),Controller=require('../js/controller.js');
const levels=require('../js/levels.js'),Training=require('../js/training.js');
const target={x:50,y:50,radius:20};

test('every encounter is a thirty second round against its villain',()=>{
  assert.deepEqual(levels.map(level=>level.timeLimit),[30,30,30]);
  levels.forEach((level,index)=>{const state=Combat.start(index,levels);assert.equal(state.health,level.health);assert.equal(state.timeLimit,30);assert.equal(state.elapsed,0);assert.equal(state.mode,'intro');});
});
test('hit damages twenty and advances target; miss does not',()=>{
  const state=Combat.play(Combat.start(0,levels));
  assert.deepEqual(Combat.fire(state,{x:0,y:0},target),{accepted:true,hit:false});
  assert.equal(state.health,100);assert.equal(state.targetIndex,0);
  Combat.tick(state,.35);Combat.fire(state,{x:50,y:50},target);
  assert.equal(state.health,80);assert.equal(state.targetIndex,1);
});
test('the clock runs through hits and running it out loses the round',()=>{
  const state=Combat.play(Combat.start(0,levels));
  Combat.tick(state,3);Combat.fire(state,{x:50,y:50},target);
  assert.equal(state.elapsed,3);assert.equal(state.health,80);
  Combat.tick(state,26.99);assert.equal(state.mode,'playing');
  Combat.tick(state,.01);assert.equal(state.mode,'lost');assert.equal(state.health,80);
  assert.equal(Combat.fire(state,{x:50,y:50},target).accepted,false);
});
test('pause freezes the clock and cooldown; retry resets both',()=>{
  const state=Combat.play(Combat.start(0,levels));Combat.fire(state,{x:50,y:50},target);Combat.tick(state,3);Combat.pause(state);Combat.tick(state,100);
  assert.equal(state.elapsed,3);assert.equal(state.cooldownRemaining,0);
  const retry=Combat.start(0,levels);assert.equal(retry.health,100);assert.equal(retry.elapsed,0);assert.equal(retry.targetIndex,0);assert.equal(retry.hits,0);assert.equal(retry.shots,0);
});
test('five hits defeat the first villain inside the time limit',()=>{
  const state=Combat.play(Combat.start(0,levels));for(let i=0;i<5;i++){Combat.tick(state,.35);Combat.fire(state,{x:50,y:50},target);}assert.equal(state.mode,'won');Combat.tick(state,100);assert.equal(state.mode,'won');
});
test('controller validates packets and integrates configured axes',()=>{let c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false});Controller.markCentre(c);c.source='wrist';Controller.aim(c,{seq:1,ms:0,gx:0,gy:0,gz:10,armed:true});Controller.aim(c,{seq:2,ms:100,gx:0,gy:0,gz:10,armed:true});assert.ok(c.pos.x>.5);let x=c.pos.x;assert.equal(Controller.aim(c,{seq:2,ms:101,gx:0,gy:0,gz:10,armed:true}),false);assert.equal(c.pos.x,x)});
test('dead zone, center, gaps, and pre-flick aim are stable',()=>{let c=Controller.create();Controller.markCentre(c);c.source='wrist';Controller.aim(c,{seq:1,ms:0,gx:0,gy:0,gz:.5,armed:true});Controller.aim(c,{seq:2,ms:100,gx:0,gy:0,gz:.5,armed:true});assert.ok(Math.abs(c.pos.x-.5)<1e-4);let x=c.pos.x;Controller.aim(c,{seq:3,ms:500,gx:0,gy:0,gz:100,armed:true});assert.equal(c.pos.x,x);c.history=[{ms:900,x:.2,y:.3},{ms:950,x:.7,y:.8}];assert.deepEqual(Controller.shot(c,{ms:1030}),{x:.7,y:.8});Controller.center(c);assert.deepEqual(c.pos,{x:.5,y:.5})});

test('the villain stays inside the arena box while it moves',()=>{
  const state=Combat.play(Combat.start(2,levels));
  for(let i=0;i<600;i++){
    Combat.tick(state,.05);
    if(state.mode!=='playing')break;
    assert.ok(state.pos.x>=Combat.BOX.x0-1e-9&&state.pos.x<=Combat.BOX.x1+1e-9,'x escaped: '+state.pos.x);
    assert.ok(state.pos.y>=Combat.BOX.y0-1e-9&&state.pos.y<=Combat.BOX.y1+1e-9,'y escaped: '+state.pos.y);
  }
});
test('it actually travels, and a shot makes it break for somewhere else',()=>{
  const state=Combat.play(Combat.start(0,levels));
  const from={x:state.pos.x,y:state.pos.y};
  for(let i=0;i<20;i++)Combat.tick(state,.05);
  assert.ok(Math.hypot(state.pos.x-from.x,state.pos.y-from.y)>.05,'villain never moved');
  const way={x:state.way.x,y:state.way.y};
  Combat.fire(state,{x:999,y:999},target);                      // a clean miss
  assert.notDeepEqual({x:state.way.x,y:state.way.y},way,'missing it did not make it dodge');
  assert.equal(state.dodgeRemaining,Combat.DODGE_SECONDS);
});
test('a dodging villain covers more ground than a drifting one',()=>{
  const drift=Combat.play(Combat.start(0,levels));
  const dodge=Combat.play(Combat.start(0,levels));
  dodge.dodgeRemaining=Combat.DODGE_SECONDS;
  const step=d=>{const a={x:d.pos.x,y:d.pos.y};Combat.tick(d,.1);return Math.hypot(d.pos.x-a.x,d.pos.y-a.y);};
  assert.ok(step(dodge)>step(drift),'dodging was not faster than drifting');
});

// Which way a gyro reads when you tilt up depends on how the board is strapped
// on, so there is no universally right direction to assert. What must hold is
// that INVERT VERTICAL is the single thing that decides it - no hidden sign
// multiplying with it, and it has to bite in both aiming modes.
test('INVERT VERTICAL is the only thing that flips vertical in motion mode',()=>{
  const aim=(invert)=>{
    const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:invert});
    Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
    for(let i=0;i<16;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:120,gy:0,gz:0,armed:true});}
    return c.pos.y;
  };
  const off=aim(false),on=aim(true);
  assert.ok(Math.abs(off-.5)>.02&&Math.abs(on-.5)>.02,'the reticle barely moved either way');
  assert.ok((off-.5)*(on-.5)<0,'ticking INVERT VERTICAL must reverse the direction, got '+off.toFixed(3)+' and '+on.toFixed(3));
});

test('training starts with one target inside the field',()=>{
  const s=Training.start(1);
  assert.equal(s.hits,0);assert.equal(s.shots,0);assert.equal(s.streak,0);
  assert.ok(s.target.x>=Training.FIELD.x0&&s.target.x<=Training.FIELD.x1);
  assert.ok(s.target.y>=Training.FIELD.y0&&s.target.y<=Training.FIELD.y1);
});

test('hitting a target pops the next one somewhere else',()=>{
  const s=Training.start(7);
  for(let i=0;i<40;i++){
    const was={x:s.target.x,y:s.target.y};
    s.cooldownRemaining=0;
    const mark={x:was.x*1000,y:was.y*1000,radius:30};
    const r=Training.fire(s,{x:mark.x,y:mark.y},mark);
    assert.deepEqual(r,{accepted:true,hit:true});
    assert.notDeepEqual({x:s.target.x,y:s.target.y},was,'target did not move');
    assert.ok(Math.hypot(s.target.x-was.x,s.target.y-was.y)>=Training.MIN_JUMP-1e-9,'next target was too close to the last');
    assert.ok(s.target.x>=Training.FIELD.x0&&s.target.x<=Training.FIELD.x1,'target left the field');
    assert.ok(s.target.y>=Training.FIELD.y0&&s.target.y<=Training.FIELD.y1,'target left the field');
  }
  assert.equal(s.hits,40);assert.equal(s.streak,40);assert.equal(s.best,40);
  assert.equal(Training.accuracy(s),1);
});

test('a miss keeps the target, breaks the streak, and counts against accuracy',()=>{
  const s=Training.start(3);
  const was={x:s.target.x,y:s.target.y};
  const mark={x:was.x*1000,y:was.y*1000,radius:30};
  Training.fire(s,{x:mark.x,y:mark.y},mark);          // hit
  s.cooldownRemaining=0;
  const now={x:s.target.x*1000,y:s.target.y*1000,radius:30};
  const r=Training.fire(s,{x:now.x+400,y:now.y+400},now);
  assert.deepEqual(r,{accepted:true,hit:false});
  assert.equal(s.streak,0);assert.equal(s.best,1);
  assert.equal(s.hits,1);assert.equal(s.shots,2);
  assert.equal(Training.accuracy(s),.5);
});

test('training has a firing cooldown that ticking clears',()=>{
  const s=Training.start(5);
  const mark={x:s.target.x*1000,y:s.target.y*1000,radius:30};
  assert.equal(Training.fire(s,{x:mark.x,y:mark.y},mark).accepted,true);
  assert.deepEqual(Training.fire(s,{x:mark.x,y:mark.y},mark),{accepted:false});
  Training.tick(s,Training.COOLDOWN);
  const next={x:s.target.x*1000,y:s.target.y*1000,radius:30};
  assert.equal(Training.fire(s,{x:next.x,y:next.y},next).accepted,true);
});

// Old firmware (rates only). The resting reading taken at the centre prompt is
// the zero; after that the trim only follows slow creep, a couple of deg/s.
test('a gyro bias that creeps after the centre is set does not walk the reticle off',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false});
  c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40*2;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:4,armed:true});}   // resting, 4 deg/s off
  Controller.markCentre(c);
  // then it creeps from 4 to 6 deg/s over 30 s with a perfectly still wrist
  for(let i=0;i<40*30;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:4+2*i/(40*30),armed:true});}
  assert.ok(Math.abs(c.pos.x-.5)<.05,'drifted to '+c.pos.x.toFixed(3)+' with nobody touching it');
});
test('trimming drift does not eat a real turn',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false});
  c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40*2;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:4,armed:true});}
  Controller.markCentre(c);
  for(let i=0;i<40*20;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:4,armed:true});}   // settle the bias
  const from=c.pos.x;
  for(let i=0;i<20;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:180,armed:true});}    // deliberate sweep
  assert.ok(c.pos.x-from>.3,'a real turn only moved '+(c.pos.x-from).toFixed(3));
});

// This is the failure that stalled calibration on real hardware: the stillness
// test used raw gyro rates, so a board whose zero point sits above the threshold
// could never be "still" and the step waited for ever.
// After a shot the shooter reports armed:false for at least its whole cooldown,
// and you are already swinging at the next target during it. The reticle must
// not sit out that window, or it ends up pointing somewhere your wrist left.

// The reticle freezing after a shot was never about the flick itself - it was
// about "armed". The shooter reports unarmed for its whole 350 ms cooldown, and
// swinging to the next target happens inside that window, so gating on it threw
// away the very movement being aimed with.
test('the flick itself is left out of the aim',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  const feed=(gz,n,armed)=>{for(let i=0;i<n;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz,armed});}};
  feed(0,40,true);
  const before=c.pos.x;
  feed(1500,5,false);                       // a real flick: 1500 deg/s
  assert.ok(Math.abs(c.pos.x-before)<.02,'the flick hurled the reticle by '+(c.pos.x-before).toFixed(3));
});

test('aiming keeps working while the shooter is still unarmed',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  const feed=(gz,n,armed)=>{for(let i=0;i<n;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz,armed});}};
  feed(0,40,true);
  feed(1500,3,false);                       // the flick
  const after=c.pos.x;
  feed(250,14,false);                       // the swing to the next target - 350 ms, still unarmed
  assert.ok(c.pos.x-after>.1,'the reticle sat frozen through the cooldown, moved only '+(c.pos.x-after).toFixed(3));
});

test('armed is not what decides it: a slow reading is aimed with either way',()=>{
  const run=(armed)=>{
    const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
    Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
    for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
    const from=c.pos.x;
    for(let i=0;i<20;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:200,armed});}
    return c.pos.x-from;
  };
  assert.ok(Math.abs(run(true)-run(false))<1e-9,'armed changed how the same movement was aimed with');
  assert.ok(run(false)>.05,'the movement was not aimed with at all');
});

test('a shot is placed from before the flick and leaves the reticle alone',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  const feed=(gz,n,armed)=>{for(let i=0;i<n;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz,armed});}};
  feed(0,40,true);
  feed(300,8,true);                         // sweep part-way off to one side
  feed(0,8,true);                           // settle on the target, as you would before firing
  const aimed=c.pos.x;
  const flickMs=ms;
  feed(1500,3,false);                       // flick
  const shot=Controller.shot(c,{ms:flickMs});
  assert.ok(Math.abs(shot.x-aimed)<.05,'the shot did not land where you were aiming');
  // Swing back the other way, which is what you do when the next target is
  // elsewhere - and it keeps the reticle off the screen edge, where a clamp
  // would mask whether it was still tracking at all.
  const beforeSwing=c.pos.x;
  feed(-250,10,false);                      // still unarmed, swinging to the next target
  assert.ok(c.pos.x<beforeSwing-.01,'the reticle stopped following after the shot');
});

// The menu reticle is DOM-bound, so this stubs just enough of a page to check
// the part that matters: a flick must press what it is resting on, and must not
// press a disabled button - CONTINUE is disabled until there is a save.
test('a flick presses the button under the menu reticle, but not a disabled one',()=>{
  const clicked=[];
  const button=(disabled)=>({tagName:'BUTTON',disabled,parentElement:null,
    click(){clicked.push(disabled?'disabled':'enabled');}});
  let beneath=null;
  const saved={window:global.window,document:global.document,raf:global.requestAnimationFrame};
  global.window=global; global.innerWidth=1000; global.innerHeight=500;
  global.document={
    getElementById:()=>({classList:{contains:()=>true}}),   // #game hidden => menu is up
    elementFromPoint:()=>beneath,
    body:{classList:{add(){},remove(){}}},
    createElement:()=>({setAttribute(){},classList:{add(){},remove(){}},style:{}}),
    addEventListener(){}
  };
  global.requestAnimationFrame=()=>{};
  const MenuAim=require('../js/menu-aim.js');
  try{
    beneath=button(false);
    assert.equal(MenuAim.press({x:.5,y:.5}),true,'an enabled button was not pressed');
    beneath=button(true);
    assert.equal(MenuAim.press({x:.5,y:.5}),false,'a disabled button was pressed anyway');
    beneath=null;
    assert.equal(MenuAim.press({x:.5,y:.5}),false,'pressing empty space did something');
    assert.deepEqual(clicked,['enabled']);
  } finally {
    global.window=saved.window;global.document=saved.document;global.requestAnimationFrame=saved.raf;
  }
});

// The code itself must treat up and down identically - the only reason up used
// to fall short is that a wrist has less extension than flexion, and that is
// what VERTICAL_GAIN compensates for, not a bias in the maths.
test('up and down travel exactly the same distance for the same rotation',()=>{
  const go=(gx)=>{
    const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
    Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
    for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
    for(let i=0;i<24;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx,gy:0,gz:0,armed:true});}
    return c.pos.y-.5;
  };
  const up=go(-200),down=go(200);
  assert.ok(Math.abs(up+down)<1e-9,'up moved '+up.toFixed(4)+' but down moved '+down.toFixed(4));
});

test('a reachable amount of wrist tilt gets the reticle to the top of the screen',()=>{
  // Feed a fixed number of DEGREES, not a fixed time, so this asserts the thing
  // that actually matters: how far the joint has to travel.
  const reach=(degrees)=>{
    const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
    Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
    for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
    const rate=-150, packets=Math.round(degrees/(150*.025));
    for(let i=0;i<packets;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:rate,gy:0,gz:0,armed:true});}
    return c.pos.y;
  };
  assert.ok(reach(65)<=0.001,'65 degrees of wrist extension only reached y='+reach(65).toFixed(3));
  // and it must not be so hot that a small tilt pins it to the top
  assert.ok(reach(20)>0.2,'20 degrees already slammed it to y='+reach(20).toFixed(3));
});

test('horizontal keeps its own gain - only vertical is boosted',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
  // Keep well short of the edges: a clamped axis would flatten the ratio and
  // the test would pass or fail for the wrong reason.
  for(let i=0;i<10;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:-150,gy:0,gz:150,armed:true});}
  const vertical=.5-c.pos.y, horizontal=c.pos.x-.5;
  assert.ok(vertical<.49&&horizontal<.49,'an axis clamped, so the ratio means nothing');
  assert.ok(Math.abs(vertical/horizontal-Controller.VERTICAL_GAIN)<.02,
    'vertical/horizontal came out '+(vertical/horizontal).toFixed(2)+', expected '+Controller.VERTICAL_GAIN);
});

// A flick ramps up through the drop threshold, peaks, and ramps back down. The
// ramps are integrated and are not symmetric, so before this every shot nudged
// the aim in the direction of the flick's slow tail - the wrist ended up high
// and the reticle a little low, a bit more with each shot.
function flickThrough(c,startMs,startSeq){
  let ms=startMs,seq=startSeq;
  const profile=[120,380,900,1500,1400,700,260,90,-60,-40];
  const flickMs=ms+25;
  profile.forEach((r,i)=>{ms+=25;seq++;Controller.aim(c,{seq,ms,gx:-r,gy:0,gz:0,armed:i<2});});
  return {ms,seq,flickMs};
}
test('a whole flick leaves the aim exactly where it was',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
  const before={x:c.pos.x,y:c.pos.y};
  const f=flickThrough(c,ms,seq);ms=f.ms;seq=f.seq;
  Controller.shot(c,{ms:f.flickMs});                     // the shoot packet the device sends
  assert.ok(Math.abs(c.pos.y-before.y)<.005,'the flick moved the aim by '+((c.pos.y-before.y)*100).toFixed(1)+'% of the screen');
  assert.ok(Math.abs(c.pos.x-before.x)<.005,'the flick moved the aim sideways');
});

test('ten shots in a row do not walk the aim anywhere',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
  const before=c.pos.y;
  for(let n=0;n<10;n++){
    const f=flickThrough(c,ms,seq);ms=f.ms;seq=f.seq;
    Controller.shot(c,{ms:f.flickMs});
    for(let i=0;i<12;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
  }
  assert.ok(Math.abs(c.pos.y-before)<.01,'ten shots walked the aim '+((c.pos.y-before)*100).toFixed(1)+'% down the screen');
});

test('aiming comes back quickly after the shot, not after the whole cooldown',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
  const f=flickThrough(c,ms,seq);ms=f.ms;seq=f.seq;
  Controller.shot(c,{ms:f.flickMs});
  const resumed=c.pos.x;
  // swing on to the next target - still inside the device's 350 ms unarmed window
  let dropped=0;
  for(let i=0;i<10;i++){ms+=25;seq++;if(!Controller.aim(c,{seq,ms,gx:0,gy:0,gz:250,armed:false}))dropped++;}
  assert.ok(dropped<=2,dropped+' of 10 aiming packets were swallowed after the shot');
  assert.ok(c.pos.x-resumed>.05,'the reticle did not follow the swing, moved '+(c.pos.x-resumed).toFixed(3));
});

// Starting a round used to rebuild the controller, which threw away the gyro
// zero point it had spent seconds measuring. The raw bias then drove the reticle
// while the trim re-learned - and an INTRO card can sit there long enough for
// that to pin the reticle in a corner before the round begins.
test('starting a round keeps what was learned about the hardware',()=>{
  const settings={horizontalAxis:'z',verticalAxis:'x',sensitivity:1};
  const c=Controller.create(settings);c.source='wrist';
  let ms=0,seq=0;
  const still=(n)=>{for(let i=0;i<n;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:8,gy:0,gz:20,armed:true});}};
  still(40*2);Controller.markCentre(c);           // the centre prompt takes the resting zero
  still(40*10);                                   // play a while
  assert.ok(c.bias.gz>15,'the zero was never learned, got '+c.bias.gz.toFixed(1));
  Controller.reset(c);                            // what start() does now
  assert.ok(c.bias.gz>15,'reset threw the learned bias away');
  assert.equal(c.source,'wrist','reset threw the input source away');
  assert.deepEqual(c.pos,{x:.5,y:.5},'reset did not recentre the reticle');
  still(40*14);                                   // a long intro card, wrist dead still
  assert.ok(Math.abs(c.pos.x-.5)<.03,'drifted to x='+c.pos.x.toFixed(3)+' across a 14 s intro');
  assert.ok(Math.abs(c.pos.y-.5)<.03,'drifted to y='+c.pos.y.toFixed(3)+' across a 14 s intro');
});

// The trim used to learn anything within 25 deg/s of the zero, so slow careful
// tracking (5-20 deg/s) was absorbed as "drift" and the reticle slowed down
// under you while you held a slow turn.
test('the drift trim does not eat slow, deliberate aiming',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  c.source='wrist';let ms=0,seq=0;
  for(let i=0;i<40*2;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:0,armed:true});}
  Controller.markCentre(c);
  const from=c.pos.x;
  for(let i=0;i<40*6;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:8,armed:true});}   // 8 deg/s for 6 s
  const ideal=8*6*Controller.SCREENS_PER_DEG;
  assert.ok(c.pos.x-from>.9*ideal,'a slow 48 degree turn only moved '+((c.pos.x-from)/ideal*100).toFixed(0)+'% of the way');
  assert.ok(Math.abs(c.bias.gz)<.5,'the trim learned the slow turn as drift: '+c.bias.gz.toFixed(2));
});


// Aiming is relative, so "the middle of the screen" cannot be measured - it is
// declared by holding the wrist there and confirming. Everything afterwards is
// measured from that pose.
function stream(c,gz,packets,from){
  let ms=(from&&from.ms)||0,seq=(from&&from.seq)||0;
  for(let i=0;i<packets;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz,armed:true});}
  return {ms,seq};
}
test('nothing moves until the centre has been set',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  c.source='wrist';
  assert.equal(c.calibrated,false);
  let at=stream(c,200,40);                       // a big deliberate turn
  assert.deepEqual(c.pos,{x:.5,y:.5},'the reticle moved before an origin existed');
  at=stream(c,15,120,at);                        // then hold the wrist at the middle
  Controller.markCentre(c);
  stream(c,215,20,at);                           // and turn again, from that origin
  assert.ok(c.pos.x>.6,'after confirming, a turn should move it (got '+c.pos.x.toFixed(3)+')');
});

test('confirming takes the resting reading as the zero, so that pose stays put',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  c.source='wrist';
  let at=stream(c,200,40);                       // waving it about
  at=stream(c,18,120,at);                        // then settling on the centre
  assert.ok(Controller.steady(c),'three seconds of holding should count as steady');
  Controller.markCentre(c);
  assert.ok(Math.abs(c.bias.gz-18)<1,'the zero was taken as '+c.bias.gz.toFixed(1)+', not the resting 18');
  stream(c,18,40*20,at);                         // twenty seconds in that same pose
  assert.ok(Math.abs(c.pos.x-.5)<1e-3,'the centre pose drifted to '+c.pos.x.toFixed(4));
  assert.ok(Math.abs(c.pos.y-.5)<1e-3);
});

test('a moving reading is never baked in as the zero',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  c.source='wrist';
  stream(c,300,8);                               // still swinging
  assert.ok(!Controller.steady(c),'a wrist mid-swing must not count as steady');
  Controller.markCentre(c);
  assert.equal(c.bias.gz,0,'it took a moving reading as the zero: '+c.bias.gz.toFixed(1));
  assert.equal(c.calibrated,true,'it should still accept the centre itself');
});

test('starting a round keeps the centre - it is set once per visit',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  c.source='wrist';
  let at=stream(c,20,120);
  Controller.markCentre(c);
  const zero=c.bias.gz;
  stream(c,200,20,at);
  assert.ok(c.pos.x>.6);
  Controller.reset(c);                           // a round begins
  assert.equal(c.calibrated,true,'the round asked for the centre all over again');
  assert.equal(c.bias.gz,zero,'the round threw away the measured zero');
  assert.deepEqual(c.pos,{x:.5,y:.5},'a round should still start aiming at the middle');
});

// Pinning the aim to the screen edge destroyed the overshoot: the wrist kept
// turning, the number could not, and the way back started from the edge instead
// of from where the wrist actually was. Every touch of an edge shifted the
// middle a little further. Letting it overflow keeps wrist and screen in step.
test('running past an edge does not shift the centre',()=>{
  const sweep=(overshootDegrees)=>{
    const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
    Controller.markCentre(c);c.source='wrist';
    let ms=0,seq=0;
    const turn=(dps,deg)=>{
      const n=Math.round(deg/(Math.abs(dps)*.025));
      for(let i=0;i<n;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:dps,armed:true});}
    };
    const total=125+overshootDegrees;      // 125 deg is centre to edge
    turn(200,total);turn(-200,total);      // out past the edge, then back the same
    return c.pos.x;
  };
  const base=sweep(0);
  [20,40,80,120].forEach(d=>{
    assert.ok(Math.abs(sweep(d)-base)<.005,
      'overshooting by '+d+' degrees moved the centre to '+sweep(d).toFixed(3)+' instead of '+base.toFixed(3));
  });
});

test('the aim reports which edge it has gone off, and where along it',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);
  c.pos={x:.5,y:.5};
  assert.equal(Controller.offscreen(c).out,false,'dead centre counted as off screen');
  c.pos={x:1.3,y:.25};
  let off=Controller.offscreen(c);
  assert.equal(off.out,true);
  assert.equal(off.right,1,'well past the right edge should be at full strength');
  assert.equal(off.left,0);assert.equal(off.top,0);assert.equal(off.bottom,0);
  assert.equal(off.along.y,.25,'the marker should sit at the aim\'s height on that edge');
  c.pos={x:.4,y:-.1};
  off=Controller.offscreen(c);
  assert.ok(off.top>0&&off.top<1,'just off the top should be part strength, got '+off.top);
  assert.equal(off.along.x,.4);
});

test('the aim cannot run so far off that it takes for ever to bring back',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';
  let ms=0,seq=0;
  for(let i=0;i<40*20;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:300,armed:true});}
  assert.ok(c.pos.x<=1+Controller.OVERFLOW+1e-9,'ran to '+c.pos.x.toFixed(2)+', past the allowance');
  assert.ok(c.pos.x>1,'it should still be off the screen after spinning that long');
});

// The reticle used to be snapped back to the middle vertically after every
// shot, to hide what the flick left in the integrated aim. That broke the
// mapping between wrist and screen. Now it goes back to where you were aiming
// before the flick, both ways.
test('after a shot the reticle goes back to the pre-flick aim, not to the middle',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  const feed=(gx,gz,armed)=>{ms+=25;seq++;Controller.aim(c,{seq,ms,gx,gy:0,gz,armed:armed!==false});};
  for(let i=0;i<40;i++)feed(0,0);
  for(let i=0;i<20;i++)feed(-150,150);            // aim up and to the right
  for(let i=0;i<8;i++)feed(0,0);                  // and settle on it
  assert.ok(c.pos.y<.4,'the aim should have gone up first, got '+c.pos.y.toFixed(3));
  const aimed={x:c.pos.x,y:c.pos.y};
  const flickMs=ms+25;
  [120,380,900,1500,1400,700,260,90].forEach((r,i)=>feed(-r,0,i<2));
  const at=Controller.shot(c,{ms:flickMs});
  assert.ok(Math.abs(at.y-aimed.y)<.005,'the shot should land at the height you aimed at, got '+at.y.toFixed(3));
  assert.ok(Math.abs(c.pos.y-aimed.y)<.005,'the reticle should go back to your aim, it is at '+c.pos.y.toFixed(3));
  assert.ok(Math.abs(c.pos.x-aimed.x)<.005,'horizontal should be kept, moved from '+aimed.x.toFixed(3)+' to '+c.pos.x.toFixed(3));
});

test('repeated shots cannot walk the aim down the screen',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';let ms=0,seq=0;
  const feed=(gx,armed)=>{ms+=25;seq++;Controller.aim(c,{seq,ms,gx,gy:0,gz:0,armed:armed!==false});};
  for(let i=0;i<40;i++)feed(0);
  const before=c.pos.y;
  for(let n=0;n<10;n++){
    const flickMs=ms+25;
    [120,380,900,1500,1400,700,260,90].forEach((r,i)=>feed(-r,i<2));
    Controller.shot(c,{ms:flickMs});
    for(let i=0;i<12;i++)feed(0);
    assert.ok(Math.abs(c.pos.y-before)<.005,'after shot '+(n+1)+' the reticle sat at '+c.pos.y.toFixed(3)+' instead of '+before.toFixed(3));
  }
});

// ---------------------------------------------------------------------------
// Current firmware: angle packets. The device fuses gyro and accelerometer and
// sends dyaw/dpitch (degrees since the last packet) plus running yaw and an
// absolute, gravity-referenced pitch, at 100 Hz.
function angleRig(settings){
  const c=Controller.create(Object.assign({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false},settings||{}));
  const st={ms:1000,seq:0,yaw:0,pitch:0};
  // one 10 ms packet; the gyro fields are the matching average rates
  const send=(dyaw,dpitch,extra)=>{
    st.ms+=10;st.seq++;st.yaw+=dyaw;st.pitch+=dpitch;
    const p=Object.assign({event:'aim',seq:st.seq,ms:st.ms,dyaw,dpitch,yaw:st.yaw,pitch:st.pitch,gx:dpitch*100,gy:0,gz:dyaw*100},extra||{});
    return Controller.aim(c,p,extra&&extra.now);
  };
  const still=(n)=>{for(let i=0;i<n;i++)send(0,0);};
  const centre=(pitch)=>{st.pitch=pitch||0;still(100);Controller.markCentre(c);c.source='wrist';};
  return {c,st,send,still,centre};
}

test('angle packets: horizontal aim follows the running yaw in degrees',()=>{
  const r=angleRig();r.centre();
  for(let i=0;i<50;i++)r.send(.3,0);             // 15 degrees right at 30 deg/s
  const ideal=15*Controller.SCREENS_PER_DEG;
  assert.ok(Math.abs((r.c.pos.x-.5)-ideal)<ideal*.01,'15 degrees moved '+(r.c.pos.x-.5).toFixed(4)+', expected '+ideal.toFixed(4));
  assert.equal(r.c.pos.y,.5,'a sideways turn moved the reticle vertically');
  const inv=angleRig({invertHorizontal:true});inv.centre();
  for(let i=0;i<50;i++)inv.send(.3,0);
  assert.ok(Math.abs((inv.c.pos.x-.5)+(r.c.pos.x-.5))<1e-9,'INVERT HORIZONTAL did not mirror it');
});

test('angle packets: dropped packets and gaps lose no movement',()=>{
  const all=angleRig(),lossy=angleRig();all.centre();lossy.centre();
  for(let i=0;i<60;i++){
    all.send(.4,0);
    // the lossy link only delivers every third packet - the rest never arrive
    if(i%3===2)lossy.send(.4,0);
    else{lossy.st.ms+=10;lossy.st.seq++;lossy.st.yaw+=.4;}
  }
  assert.ok(Math.abs(all.c.pos.x-lossy.c.pos.x)<1e-3,'dropped packets lost '+((all.c.pos.x-lossy.c.pos.x)*100).toFixed(2)+'% of the screen');
  // a 600 ms stall: the device kept counting, so the page catches up at once
  const x=lossy.c.pos.x;
  lossy.st.ms+=600;lossy.st.yaw+=10;lossy.send(.4,0);
  assert.ok(Math.abs(lossy.c.pos.x-x-10.4*Controller.SCREENS_PER_DEG)<1e-3,'the gap threw the movement away');
});

test('angle packets: vertical is absolute pitch and never drifts',()=>{
  const r=angleRig();r.centre(3);                    // the centre is held 3 degrees up
  assert.equal(r.c.pos.y,.5);
  for(let i=0;i<20;i++)r.send(0,.5);                 // 10 degrees higher
  const expect=.5-10*Controller.SCREENS_PER_DEG*Controller.VERTICAL_GAIN;
  assert.ok(Math.abs(r.c.pos.y-expect)<1e-9,'10 degrees up put it at '+r.c.pos.y.toFixed(4)+' not '+expect.toFixed(4));
  // a minute of holding still, with sensor noise on every packet
  let seed=7;const noise=()=>{seed=(seed*16807)%2147483647;return (seed/2147483647-.5)*.02;};
  for(let i=0;i<6000;i++)r.send(noise(),0);
  assert.ok(Math.abs(r.c.pos.y-expect)<1e-9,'the vertical moved while the wrist held still');
  for(let i=0;i<100;i++)r.send(i<50?1:-1,0);          // swing sideways and back
  assert.ok(Math.abs(r.c.pos.y-expect)<1e-9,'swinging sideways moved the vertical');
  for(let i=0;i<20;i++)r.send(0,-.5);                // back down to the centre pitch
  assert.ok(Math.abs(r.c.pos.y-.5)<1e-9,'back at the centre pitch the reticle is at '+r.c.pos.y.toFixed(4));
  const inv=angleRig({invertVertical:true});inv.centre(3);
  for(let i=0;i<20;i++)inv.send(0,.5);
  assert.ok(Math.abs((inv.c.pos.y-.5)+(expect-.5))<1e-9,'INVERT VERTICAL did not flip it');
});

test('angle packets: holding still for a minute barely moves it sideways',()=>{
  const r=angleRig();r.centre();
  // residual drift of 0.05 deg/s plus noise - what the device's bias tracking leaves
  let seed=3;const noise=()=>{seed=(seed*16807)%2147483647;return (seed/2147483647-.5)*.01;};
  for(let i=0;i<6000;i++)r.send(.0005+noise(),0);
  assert.ok(Math.abs(r.c.pos.x-.5)<.02,'60 s of stillness moved it '+((r.c.pos.x-.5)*100).toFixed(2)+'% of the screen');
});

test('the soft dead zone is smooth: no step between slow and fast',()=>{
  const k=Controller.SOFT_DEAD_DPS;
  assert.equal(Controller.soft(0),0);
  let prev=0;
  for(let v=.1;v<40;v+=.1){const s=Controller.soft(v);assert.ok(s>=prev&&s-prev<.08,'jump at '+v.toFixed(1)+' deg/s');prev=s;}
  assert.ok(Math.abs(Controller.soft(k)-.5)<1e-12,'half strength at SOFT_DEAD_DPS');
  assert.ok(Controller.soft(10)>.97,'slow deliberate aiming at 10 deg/s is scaled to '+Controller.soft(10).toFixed(2));
  // micro-adjustments are not swallowed: 2 degrees at 4 deg/s still moves 85%+
  const r=angleRig();r.centre();
  for(let i=0;i<50;i++)r.send(.04,0);
  assert.ok((r.c.pos.x-.5)/(2*Controller.SCREENS_PER_DEG)>.85,'a small, slow correction was swallowed');
});

test('a flick is left out of the aim and the shot lands where you aimed before it',()=>{
  const r=angleRig();r.centre();
  for(let i=0;i<40;i++)r.send(.5,.25);               // aim right and up
  r.still(10);
  const aimed={x:r.c.pos.x,y:r.c.pos.y},preYaw=r.st.yaw,prePitch=r.st.pitch;
  // the start of the snap, before the device has decided it is one: unflagged
  r.send(.2,-2);r.send(.3,-5);
  // the device detects it and sends the shot, with its angles from before
  const at=Controller.shot(r.c,{event:'shoot',seq:1,ms:r.st.ms-20,preYaw,prePitch});
  assert.ok(Math.abs(at.x-aimed.x)<1e-4&&Math.abs(at.y-aimed.y)<1e-9,'the shot missed the pre-flick aim');
  assert.deepEqual(r.c.pos,at,'the reticle was not put back at the pre-flick aim');
  // the rest of the snap is flagged and must not move the aim
  [-12,-10,-6,4,8,10,8,5].forEach(d=>r.send(.4,d,{flick:true}));
  assert.deepEqual(r.c.pos,at,'flagged flick packets moved the aim');
  const returnStep=(preYaw-r.st.yaw)/10;
  for(let i=0;i<10;i++)r.send(returnStep,0);         // the wrist returns after the flag clears
  r.send(0,0);                                       // settled: aiming again, pitch absolute
  assert.ok(Math.abs(r.c.pos.x-aimed.x)<1e-4,'horizontal did not resume from the pre-flick aim');
 assert.ok(Math.abs(r.c.pos.y-(.5-r.st.pitch*Controller.SCREENS_PER_DEG*Controller.VERTICAL_GAIN))<1e-9,'vertical is not the wrist pitch after the flick');
});

test('repeated flicks return to the same horizontal aim when yaw returns',()=>{
  const r=angleRig();r.centre();
  const before=r.c.pos.x;
  for(let shot=0;shot<8;shot++){
    const preYaw=r.st.yaw,prePitch=r.st.pitch;
    Controller.shot(r.c,{event:'shoot',ms:r.st.ms,preYaw,prePitch});
    r.send(-3,0,{flick:true});                 // the snap is excluded
    for(let i=0;i<100;i++)r.send(.03,0);     // slow return after the flick flag clears
    assert.ok(Math.abs(r.st.yaw-preYaw)<1e-10,'the sensor did not return to its original yaw');
    assert.ok(Math.abs(r.c.pos.x-before)<1e-10,'shot '+(shot+1)+' shifted the reticle right');
  }
});

test('confirming the centre with a flick takes the pitch from before the snap',()=>{
  const r=angleRig();r.st.pitch=4;r.still(100);
  r.send(0,-9);                                      // the snap has begun
  Controller.markCentre(r.c,{event:'shoot',ms:r.st.ms,preYaw:0,prePitch:4});
  assert.equal(r.c.centrePitch,4,'the centre was taken mid-flick');
});

test('starting a round keeps the centre pitch, and pitch stays absolute',()=>{
  const r=angleRig();r.centre(2);
  for(let i=0;i<10;i++)r.send(.5,-1);                // flicking at GO: pitched well down
  Controller.reset(r.c);
  assert.equal(r.c.centrePitch,2,'reset re-took the centre pitch mid-flick');
  assert.equal(r.c.pos.x,.5,'reset should recentre sideways');
  assert.ok(r.c.pos.y>.5,'the reticle should show the wrist is pointing low');
});

test('the reticle is drawn smoothly between packets, from the device clock',()=>{
  const r=angleRig();r.centre();
  // a steady 50 deg/s turn; the packets are 10 ms apart on the device but the
  // WiFi delivers them in clumps of three
  // Packets and ~144 Hz frames are interleaved in time order, as the browser runs them.
  const xs=[];let i=0,last=0;
  for(let t=5000;t<=5700;t++){
    while(i<70&&5000+Math.ceil((i+1)/3)*30<=t){last=t;r.send(.5,0,{now:t});i++;}
    if(t>=5200&&t<=5600&&t%7===0)xs.push(Controller.display(r.c,t).x);
  }
  const steps=xs.slice(1).map((x,i)=>x-xs[i]);
  const mean=steps.reduce((a,b)=>a+b,0)/steps.length;
  assert.ok(mean>0,'the drawn reticle did not move');
  steps.forEach(s=>assert.ok(Math.abs(s-mean)<mean*.35,'uneven frame step '+s.toExponential(2)+' vs '+mean.toExponential(2)));
  // drawing lags a little; the true aim, which shots use, does not
  const shown=Controller.display(r.c,last);
  assert.ok(shown.x<r.c.pos.x,'the drawn reticle should trail the true aim slightly');
  assert.ok(r.c.pos.x-shown.x<50*.06*Controller.SCREENS_PER_DEG,'the drawn reticle lags more than 60 ms');
  r.c.source='mouse';
  assert.deepEqual(Controller.display(r.c,9999),r.c.pos,'the mouse should be drawn exactly where it is');
});

test('the firmware is told which board axis points along the forearm',()=>{
  assert.equal(Controller.forwardAxis({horizontalAxis:'z',verticalAxis:'x'}),'y');
  assert.equal(Controller.forwardAxis({horizontalAxis:'y',verticalAxis:'x'}),'z');
  assert.equal(Controller.forwardAxis({horizontalAxis:'z',verticalAxis:'y'}),'x');
  assert.equal(Controller.forwardAxis({horizontalAxis:'nope',verticalAxis:undefined}),'y');
});

test('old firmware packets still aim with rates',()=>{
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1});
  Controller.markCentre(c);c.source='wrist';
  let ms=0,seq=0;for(let i=0;i<40;i++){ms+=25;seq++;Controller.aim(c,{seq,ms,gx:0,gy:0,gz:100,armed:true});}
  assert.equal(c.angles,false);
  assert.ok(c.pos.x>.6,'a legacy turn did not move the reticle');
});

// ---------------------------------------------------------------------------
// USB: the page reads the shooter over the cable with Web Serial. The shooter
// prints the same JSON packets as over WiFi, one per line, between log lines.
const SerialLink=require('../js/serial-link.js');

test('USB: packets are pulled out of the serial stream, whatever the chunking',()=>{
  const p=new SerialLink.LineParser();
  assert.deepEqual(p.push('Web Shooter booting\r\n  probing SDA=GPIO23 ... yes\r\n'),[],'log lines are not packets');
  assert.deepEqual(p.push('{"event":"hel'),[],'half a line is not a packet yet');
  const got=p.push('lo","capabilities":["aim"]}\r\n{"event":"aim","seq":1}\r\n{"event":"aim","se');
  assert.deepEqual(got.map(m=>m.event),['hello','aim']);
  assert.equal(p.push('q":2}\n')[0].seq,2,'the packet split across chunks was lost');
  assert.deepEqual(p.push('{not json}\r\n{"no":"event"}\r\n'),[],'junk that starts with { is skipped');
  p.push('ÿ'.repeat(5000));                       // the wrong baud rate: noise, no line ends
  assert.equal(p.push('{"event":"aim","seq":3}\n').length,1,'it never recovered from noise');
});

test('USB: the page and the sketch agree on the baud rate',()=>{
  const ino=require('fs').readFileSync(require('path').join(__dirname,'../../web_shooter/web_shooter.ino'),'utf8');
  const m=/SERIAL_BAUD\s*=\s*(\d+)/.exec(ino);
  assert.ok(m,'SERIAL_BAUD not found in the sketch');
  assert.equal(SerialLink.BAUD,+m[1]);
});

// A stand-in for navigator.serial and one port on it.
function fakeSerial(){
  const chunks=[],written=[];let pending=null;
  const port={opened:null,signals:null,closed:false,
    async open(o){this.opened=o;},async setSignals(s){this.signals=s;},async close(){this.closed=true;},
    readable:{getReader(){return{
      read(){if(chunks.length)return Promise.resolve({value:chunks.shift(),done:false});return new Promise((ok,bad)=>{pending={ok,bad};});},
      cancel(){if(pending){pending.ok({done:true});pending=null;}return Promise.resolve();},
      releaseLock(){}};}},
    writable:{getWriter(){return{write(b){written.push(new TextDecoder().decode(b));return Promise.resolve();},releaseLock(){}};}}};
  const feed=t=>{const b=new TextEncoder().encode(t);if(pending){const p=pending;pending=null;p.ok({value:b,done:false});}else chunks.push(b);};
  const unplug=()=>{port.readable=null;if(pending){const p=pending;pending=null;p.bad(new Error('NetworkError'));}};
  const serial={async requestPort(){return port;},async getPorts(){return [port];},addEventListener(){}};
  return {serial,port,feed,unplug,written};
}
const settle=()=>new Promise(r=>setTimeout(r,5));

test('USB: connecting says hello, streams aim, and notices the cable coming out',async()=>{
  const f=fakeSerial(),link=new SerialLink(f.serial),seen=[],statuses=[];
  link.on('status',s=>statuses.push(s));link.on('aim',p=>seen.push(p));
  assert.equal(await link.choose(),true);
  assert.equal(f.port.opened.baudRate,SerialLink.BAUD);
  assert.deepEqual(f.port.signals,{dataTerminalReady:false,requestToSend:false},'DTR/RTS left asserted: that resets most ESP32 boards');
  assert.ok(f.written.includes('hello\n'),'the page never asked the shooter to stream');
  assert.equal(link.status,'connected');
  f.feed('link: clients=0 usb=0\r\n{"event":"hello","device":"webshooter","capabilities":["aim","shoot","angles"]}\r\n');
  await settle();
  assert.equal(link.status,'aiming');
  f.feed('{"event":"aim","seq":1,"ms":10,"dyaw":0.1,"dpitch":0,"yaw":0.1,"pitch":0,"gx":0,"gy":0,"gz":10}\r\n');
  await settle();
  assert.equal(seen.length,1);assert.ok(Number.isFinite(seen[0].rx),'no arrival time for the reticle to draw from');
  link.send('fwd=y');assert.ok(f.written.includes('fwd=y\n'));
  f.unplug();await settle();
  assert.equal(link.status,'disconnected');
  assert.equal(link.wanted,true,'it gave up on the port - plugging back in would not reconnect');
  await link.disconnect();
  assert.equal(link.wanted,false);
});

test('USB: a port that is already open elsewhere says so',async()=>{
  const f=fakeSerial();f.port.open=async()=>{throw new Error('InvalidStateError');};
  const link=new SerialLink(f.serial);
  assert.equal(await link.choose(),false);
  assert.equal(link.status,'busy');
});

test('USB: without Web Serial it says so instead of failing',async()=>{
  const link=new SerialLink(null);
  assert.equal(link.status,'unsupported');
  assert.equal(await link.choose(),false);
});
