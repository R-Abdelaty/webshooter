const test=require('node:test'),assert=require('node:assert/strict');
const City=require('../js/world/city.js'),Player=require('../js/world/player.js'),Swing=require('../js/world/swing.js');
const PlayerAnim=require('../js/world/player-anim.js'),PlayerCamera=require('../js/world/player-camera.js'),Look=require('../js/world/look.js');
const WebShot=require('../js/world/web-shot.js');
const city=City.generate(20180907),K=Swing.constants,DT=1/60;
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=(eps||1e-9),(msg||'')+' got '+a+', expected '+b);
const unit=v=>{const l=Math.hypot(v.x,v.y,v.z);return {x:v.x/l,y:v.y/l,z:v.z/l};};
const hitAt=(p,d)=>Swing.cast(city,Player.eye(p),unit(d),400);
const still={move:{x:0,z:0},buttons:{},yaw:Math.PI};
// Is the player's middle inside any collision box?
function inside(p){
  return City.query(city,p.x-.3,p.z-.3,p.x+.3,p.z+.3).some(b=>p.x>b.x0+.02&&p.x<b.x1-.02&&p.z>b.z0+.02&&p.z<b.z1-.02&&p.y+.9>b.y0&&p.y+.9<b.y1);
}
function run(s,p,secs,input,each){
  const ev=[];
  for(let t=0;t<secs;t+=DT){const r=Swing.step(s,p,input||still,DT,city);ev.push(...r.events);if(!r.active)Player.step(p,input||still,DT,city);if(each)each(p,s,t);}
  return ev;
}
// The avenue at x -488 (walls at x -503 and -473), heading south (+z, yaw PI).
const AVE={x:-488,west:-503,east:-473};

// --- anchors: what the aim will take ---------------------------------------------------
test('anchors: a building wall in reach and above you takes a line',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-560});
  const h=hitAt(p,{x:.6,y:.4,z:1.3});
  assert.equal(h.normal.x,-1,'the east wall, facing the avenue');
  const c=Swing.classify(city,h,p);
  assert.equal(c.kind,'wall');
  const d=Swing.decide({target:false,hit:h,player:p,city},Swing.create());
  assert.equal(d.act,'attach');assert.deepEqual(d.anchor,h.point);
});
test('anchors: too far, below you, the street, a slope or thin air take nothing',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-560});
  // The 96 m tower 60.8 m away: just out of reach.
  const far=hitAt(p,{x:-.6,y:.8,z:1.3});
  assert.ok(far.distance>K.RANGE);assert.equal(Swing.classify(city,far,p).why,'far');
  assert.equal(Swing.classify(city,hitAt(p,{x:0,y:-1,z:.3}),p).why,'not a building','the street');
  assert.equal(Swing.classify(city,null,p).why,'nothing');
  // Up on a roof, a wall lower down across the street is below you.
  // (The east tower at z -212..-192 is 108 m tall.)
  const wall=y=>({point:{x:AVE.east,y,z:-200},normal:{x:-1,y:0,z:0},distance:20});
  assert.equal(Swing.classify(city,wall(40),Player.create({x:AVE.x,y:60,z:-210})).why,'below');
  assert.equal(Swing.classify(city,wall(40),Player.create({x:AVE.x,y:39,z:-210})).kind,'wall','a little below the hands is still fine');
  assert.equal(Swing.classify(city,{point:{x:AVE.east,y:30,z:-200},normal:{x:-.7,y:.7,z:0},distance:20},Player.create({x:AVE.x,y:0,z:-210})).why,'slope');
  assert.equal(Swing.decide({target:false,hit:null,player:p,city},Swing.create()).act,'none');
});
test('anchors: never inside a villain\'s body',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-560}),h=hitAt(p,{x:.6,y:.4,z:1.3}),a=h.point;
  const caps=[{a:{x:a.x-.3,y:a.y-1,z:a.z},b:{x:a.x-.3,y:a.y+1,z:a.z},r:.2}];
  assert.equal(Swing.classify(city,h,p,{villains:caps}).why,'villain');
  const away=[{a:{x:a.x-5,y:a.y-1,z:a.z},b:{x:a.x-5,y:a.y+1,z:a.z},r:.2}];
  assert.equal(Swing.classify(city,h,p,{villains:away}).kind,'wall');
});
test('anchors: a roof edge (the top of a wall) or a roof top is a zip, onto the parapet facing out',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-300});
  // The west building at z -312..-287 is 32.4 m, with a 1.1 m brick parapet (top 33.5).
  const b=City.query(city,AVE.west-1,-300,AVE.west-1,-300).filter(b=>b.x1===AVE.west&&b.y0===0)[0];
  const edge={point:{x:AVE.west,y:b.y1-1,z:-300},normal:{x:1,y:0,z:0},distance:30};
  const c=Swing.classify(city,edge,p);
  assert.equal(c.kind,'zip');assert.ok(c.perch.edge);
  assert.ok(c.perch.y>b.y1,'up on the parapet, not the roof inside it');
  near(Player.support(Object.assign(Player.create(c.perch),{}),city,c.perch.y+.01),c.perch.y,1e-9,'something to stand on');
  near(-Math.sin(c.perch.yaw),1,1e-9,'facing out, east over the avenue');
  // Aimed at the roof itself near its edge: the same edge. Mid-roof: where it landed.
  const top={point:{x:AVE.west-1.5,y:b.y1,z:-300},normal:{x:0,y:1,z:0},distance:30};
  const c2=Swing.classify(city,top,p);
  assert.equal(c2.kind,'zip');near(c2.perch.x,c.perch.x,1e-9);near(c2.perch.y,c.perch.y,1e-9);
  const mid={point:{x:(b.x0+b.x1)/2,y:b.y1,z:(b.z0+b.z1)/2},normal:{x:0,y:1,z:0},distance:40};
  const c3=Swing.classify(city,mid,p);
  assert.equal(c3.kind,'zip');assert.equal(c3.perch.edge,false);near(c3.perch.y,b.y1,1e-9);
});

// --- the rules for a flick or a click -----------------------------------------------------------
test('decide: a villain near the aim is a shot, even with a wall behind him; on a line, nothing valid lets go',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-560}),h=hitAt(p,{x:.6,y:.4,z:1.3});
  assert.equal(Swing.decide({target:true,hit:h,player:p,city},Swing.create()).act,'shot');
  const s=Swing.create();Swing.attach(s,p,h.point,'r');
  assert.equal(Swing.decide({target:true,hit:h,player:p,city},s).act,'shot','mid-swing too');
  assert.equal(Swing.decide({target:false,hit:null,player:p,city},s).act,'release');
  assert.equal(Swing.decide({target:false,hit:h,player:p,city},s).act,'attach','another wall: a new line');
});
test('decide: the shot cone - a capsule within SHOT_CONE degrees of the aim, in front and not behind a wall',()=>{
  const o={x:0,y:0,z:0},d={x:0,y:0,z:-1},cap=(x)=>[{a:{x,y:-1,z:-20},b:{x,y:1,z:-20},r:.3}];
  const at=deg=>20*Math.tan(deg*Math.PI/180)+.3;
  assert.ok(Swing.inCone(o,d,cap(0),K.SHOT_CONE));
  assert.ok(Swing.inCone(o,d,cap(at(K.SHOT_CONE-.3)),K.SHOT_CONE));
  assert.ok(!Swing.inCone(o,d,cap(at(K.SHOT_CONE+.5)),K.SHOT_CONE));
  assert.ok(!Swing.inCone(o,{x:0,y:0,z:1},cap(0),K.SHOT_CONE),'behind you');
  assert.ok(!Swing.inCone(o,d,cap(0),K.SHOT_CONE,10),'a wall 10 m off, in front of him');
});

// --- the physics ---------------------------------------------------------------------------------
test('swing: a line shot from standing throws you up off the street, and the rope holds you on its sphere',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-560}),s=Swing.create(),h=hitAt(p,{x:.6,y:.4,z:1.3});
  Swing.attach(s,p,h.point,'r');
  assert.equal(s.mode,'swing');assert.ok(p.vy>0&&!p.grounded);
  let over=0;
  run(s,p,1.2,still,()=>{if(s.mode==='swing'){const d=Math.hypot(p.x-h.point.x,p.y+K.GRIP-h.point.y,p.z-h.point.z);over=Math.max(over,d-s.len);}});
  assert.ok(over<.02,'never further from the anchor than the line: '+over);
  assert.ok(p.y>1,'off the ground');
});
test('swing: passing the bottom reels the line in, so the arc climbs higher than it started (and no higher without it)',()=>{
  function apex(shorten){
    const was=K.SHORTEN;K.SHORTEN=shorten;
    // High over the park (nothing in the way), dropped from rest 24 m out
    // from the anchor at the height of your hands... then how high the far
    // side of the arc climbs.
    const a={x:60,y:90,z:-250},p=Player.create({x:36,y:60,z:-250});p.grounded=false;
    const s=Swing.create();Swing.attach(s,p,a,'r');s.want=s.len;         // no reel toward a target: just the pump
    let top=-1e9;
    run(s,p,4,{move:{x:0,z:0},buttons:{}},()=>{if(p.x>a.x&&s.mode==='swing'&&p.vx>=0)top=Math.max(top,p.y);});
    K.SHORTEN=was;return top;
  }
  const pumped=apex(K.SHORTEN),plain=apex(0);
  assert.ok(pumped>60+1,'climbs past where it started: '+pumped.toFixed(2));
  assert.ok(plain<60+.1,'a plain pendulum doesn\'t: '+plain.toFixed(2));
});
test('swing: however far you fall into it, the speed is capped',()=>{
  const a={x:AVE.east,y:180,z:-80},p=Player.create({x:AVE.x,y:150,z:-80});p.grounded=false;p.vy=-60;
  const s=Swing.create();Swing.attach(s,p,a,'r');
  let top=0;run(s,p,5,still,()=>{top=Math.max(top,Swing.speed(p));});
  assert.ok(top<=K.MAX_SPEED+1e-6,'top speed '+top);
});
test('release: you keep your velocity at the bottom of the arc; near the top of the forward arc it throws you on',()=>{
  const a={x:0,y:50,z:0};
  // At the bottom, moving: nothing added.
  const p=Player.create({x:0,y:50-K.GRIP-20,z:0});p.vz=20;p.grounded=false;
  const s=Swing.create();Swing.attach(s,p,a,'r');
  const v0={x:p.vx,y:p.vy,z:p.vz};
  assert.equal(Swing.release(s,p),0);assert.deepEqual({x:p.vx,y:p.vy,z:p.vz},v0);assert.equal(s.mode,'fly');
  // Past the anchor, 55 degrees up the arc, still rising: boosted ahead and up.
  const q=Player.create({x:0,y:50-K.GRIP-20*Math.cos(.96),z:20*Math.sin(.96)});q.vz=10;q.vy=4;q.grounded=false;
  const s2=Swing.create();Swing.attach(s2,q,a,'r');
  const k=Swing.release(s2,q);
  assert.ok(k>.9,'the boost '+k);near(q.vz,10+K.BOOST*k,1e-9);near(q.vy,4+K.BOOST_UP*k,1e-9);
  // Flying on, you keep that speed (no air brakes) until you land.
  const vz=q.vz;Swing.step(s2,q,still,DT,city);near(q.vz,vz,1e-9,'no braking in flight');
});
test('chain: 30 seconds of swinging down the avenue - a long way, never inside a building, never over the cap',()=>{
  const p=Player.create({x:AVE.x,y:40,z:-450,yaw:Math.PI});p.grounded=false;
  const s=Swing.create();s.mode='fly';
  let lines=0,bad=0,top=0,maxY=0;
  function pick(){
    let best=null;
    for(const side of [-1.2,-.9,-.6,-.3,.3,.6,.9,1.2])for(const up of [.4,.6,.8,1,1.3,1.7]){
      const h=hitAt(p,{x:side,y:up,z:1.3});
      const d=Swing.decide({target:false,hit:h,player:p,city},s);
      if(d.act!=='attach'||Math.abs(h.normal.x)<.9||Math.min(Math.abs(d.anchor.x-AVE.east),Math.abs(d.anchor.x-AVE.west))>.1)continue;
      const g=Swing.grip(p),a=d.anchor,el=Math.atan2(a.y-g.y,Math.hypot(a.x-g.x,a.z-g.z)),ah=a.z-p.z;
      if(el<.35||ah<8)continue;
      const sc=-a.y+Math.max(0,Math.abs(ah-26)-8)*3;
      if(!best||sc<best.sc)best={a,sc};
    }
    return best;
  }
  for(let t=0;t<30;t+=DT){
    if(s.mode!=='swing'&&(s.mode==='none'||p.vy<0)){const b=pick();if(b){Swing.attach(s,p,b.a,b.a.x>p.x?'l':'r');lines++;}}
    else if(s.mode==='swing'&&((p.z>s.anchor.z&&p.vy>0&&p.vy<3)||s.t>3))Swing.release(s,p);
    const mx=Math.max(-1,Math.min(1,(p.x-AVE.x)/6));            // keep to the middle of the avenue
    const r=Swing.step(s,p,{move:{x:mx,z:0},buttons:{},yaw:Math.PI},DT,city);
    if(!r.active)Player.step(p,still,DT,city);
    if(inside(p))bad++;top=Math.max(top,Swing.speed(p));if(t>5)maxY=Math.max(maxY,p.y);
  }
  assert.equal(bad,0,'frames inside a building');
  assert.ok(p.z>-450+500,'down the avenue: to z '+p.z.toFixed(0));
  assert.ok(lines>=12,'lines: '+lines);
  assert.ok(top<=K.MAX_SPEED+1e-6);
  assert.ok(maxY>15,'up between the buildings, not along the street: '+maxY.toFixed(1));
});
test('collision: swung hard into a wall, you slide along it and end outside it, and land on the street',()=>{
  // Anchor high on the east wall; start out west, moving fast east, straight at it.
  const a={x:AVE.east,y:40,z:-446},p=Player.create({x:AVE.west+2,y:12,z:-446});p.vx=30;p.vz=3;p.grounded=false;
  const s=Swing.create();Swing.attach(s,p,a,'r');
  let bad=0;
  run(s,p,4,still,()=>{if(inside(p))bad++;});
  assert.equal(bad,0);
  assert.ok(p.x<=AVE.east-Player.constants.RADIUS+1e-6,'outside the wall: '+p.x);
  // Let go and drop to the street: landed, no damage, Player has you back.
  Swing.release(s,p);
  const ev=run(s,p,4);
  assert.ok(ev.some(e=>e.type==='land'));assert.equal(s.mode,'none');assert.ok(p.grounded);assert.ok(!inside(p));
});
test('zip: pulled up to the roof edge, ending perched on the parapet facing out, not inside anything',()=>{
  const p=Player.create({x:AVE.x,y:.15,z:-300}),s=Swing.create();
  const b=City.query(city,AVE.west-1,-300,AVE.west-1,-300).filter(b=>b.x1===AVE.west&&b.y0===0)[0];
  const c=Swing.classify(city,{point:{x:AVE.west,y:b.y1-1,z:-300},normal:{x:1,y:0,z:0},distance:30},p);
  Swing.zip(s,p,c.perch);
  assert.equal(s.mode,'zip');
  let maxT=0;const ev=run(s,p,c.perch&&K.ZIP_T[1]+.2,still,()=>{maxT+=DT;});
  assert.ok(ev.some(e=>e.type==='perch'));assert.equal(s.mode,'perch');
  near(p.x,c.perch.x,1e-9);near(p.y,c.perch.y,1e-9);near(p.z,c.perch.z,1e-9);
  assert.ok(p.grounded&&!inside(p));
  const q={x:p.x,y:p.y,z:p.z};Player.resolveWalls(q,city);near(q.x,p.x,1e-9,'no wall pushes him');
  assert.deepEqual(Swing.anim(s),{swing:null,zip:false,perched:true});
  // Perched, he stays put...
  run(s,p,1);near(p.y,c.perch.y,1e-9);assert.equal(s.mode,'perch');
  // ...until he jumps - a dive off, forward - or walks off.
  Swing.step(s,p,{move:{x:0,z:0},buttons:{jump:true},yaw:-Math.PI/2},DT,city);
  assert.equal(s.mode,'fly');assert.ok(p.vx>K.DIVE*.9&&p.vy>0,'dived east');
  const s2=Swing.create(),p2=Player.create(c.perch);s2.mode='perch';s2.perch=c.perch;
  assert.equal(Swing.step(s2,p2,{move:{x:0,z:1},buttons:{},yaw:0},DT,city).active,false);assert.equal(s2.mode,'none');
});
test('input: Space lets go of a line; a flick at nothing does too (decide), and the free hand has no line',()=>{
  const p=Player.create({x:AVE.x,y:0,z:-560}),s=Swing.create(),h=hitAt(p,{x:.6,y:.4,z:1.3});
  Swing.attach(s,p,h.point,'l');run(s,p,.3);
  assert.equal(s.mode,'swing');assert.deepEqual(Swing.anim(s),{swing:'l',zip:false,perched:false});
  const ev=run(s,p,DT,{move:{x:0,z:0},buttons:{jump:true},yaw:Math.PI});
  assert.equal(s.mode,'fly');assert.ok(ev.some(e=>e.type==='drop'));
});

// --- what shows it ---------------------------------------------------------------------------------
test('anim: a swing counts as time in the air, so touching down after one is a landing; releasing opens the hand',()=>{
  const a=PlayerAnim.create(),p={grounded:false,vx:10,vy:-2,vz:0};
  let o=PlayerAnim.step(a,p,.1,{swing:'r'});assert.equal(o.state,'swing');
  assert.ok(o.arms.some(c=>c[0]==='fp_swing_hold_r'));assert.ok(o.body.some(c=>c[0]==='hang'));
  for(let i=0;i<5;i++)PlayerAnim.step(a,p,.1,{swing:'r'});
  o=PlayerAnim.step(a,p,.1,{});assert.ok(o.arms.some(c=>c[0]==='fp_release_r'));
  o=PlayerAnim.step(a,{grounded:true,vx:0,vy:0,vz:0},.1,{});
  assert.equal(o.state,'land');
  // A perch is a perch, not a landing; diving off it is a jump.
  const b=PlayerAnim.create();
  assert.equal(PlayerAnim.step(b,{grounded:false,vx:0,vy:5,vz:0},.1,{zip:true}).state,'zip');
  assert.equal(PlayerAnim.step(b,{grounded:true,vx:0,vy:0,vz:0},.1,{perched:true}).state,'perch');
  assert.equal(PlayerAnim.step(b,{grounded:false,vx:7,vy:6.4,vz:0},.1,{}).state,'jump');
});
test('camera: speed widens the view (capped), first person rolls into the arc and shows lines; REDUCED halves the kick and drops the rest',()=>{
  const C=PlayerCamera.constants;
  function settle(o,motion){const s=PlayerCamera.create();let r;for(let i=0;i<300;i++)r=PlayerCamera.swingFx(s,o,DT,motion);return r;}
  const slow=settle({speed:5,swinging:true,lateral:1,first:true},'full');near(slow.fov,0,1e-6);
  const fast=settle({speed:60,swinging:true,lateral:1,first:true},'full');
  near(fast.fov,C.KICK,1e-3,'kick, capped');near(fast.roll,-C.ROLL,1e-3,'leaning right, into a line on the right');near(fast.lines,1,1e-3);
  const left=settle({speed:60,swinging:true,lateral:-1,first:true},'full');near(left.roll,C.ROLL,1e-3);
  const red=settle({speed:60,swinging:true,lateral:1,first:true},'reduced');
  near(red.fov,C.KICK/2,1e-3);assert.equal(red.roll,0);assert.equal(red.lines,0);
  const third=settle({speed:60,swinging:true,lateral:1,first:false},'full');
  near(third.fov,C.KICK,1e-3);assert.equal(third.roll,0,'third person doesn\'t roll');assert.equal(third.lines,0);
  assert.ok(Math.abs(fast.roll)<=.07+1e-9&&C.KICK<=12,'the comfort caps stay small');
});
test('camera: swinging in third person, the camera trails your travel and rises; it eases back when you stop',()=>{
  const s=PlayerCamera.create(),p={x:0,y:30,z:0,vx:0,vy:0,vz:25,yaw:Math.PI,pitch:0};
  let r;for(let i=0;i<120;i++)r=PlayerCamera.third(s,p,null,DT,{moving:true});
  const still0=PlayerCamera.third(PlayerCamera.create(),p,null,DT);
  assert.ok(r.eye.z<still0.eye.z-1.5,'further behind the way he\'s going: '+(still0.eye.z-r.eye.z).toFixed(2));
  assert.ok(r.eye.y>still0.eye.y+.5,'and higher');
  for(let i=0;i<240;i++)r=PlayerCamera.third(s,p,null,DT);
  near(r.eye.z,still0.eye.z,.02);near(r.eye.y,still0.eye.y,.02);
});
test('camera: perched in first person the eye comes down to the crouch',()=>{
  const s=PlayerCamera.create(),p={x:0,y:10,z:0,vx:0,vz:0,yaw:0,grounded:true},eye=Player.eye(p);
  let e;for(let i=0;i<120;i++)e=PlayerCamera.first(s,p,eye,DT,false,'reduced',true);
  near(e.y,eye.y-PlayerCamera.constants.CROUCH,.01);
});
test('aim: a camera rolled into the arc still aims through the crosshair it shows',()=>{
  const cam={yaw:.4,pitch:.2,roll:0},roll=Object.assign({},cam,{roll:.07});
  assert.deepEqual(Look.ray(roll,{x:.5,y:.5},75,16/9),Look.ray(cam,{x:.5,y:.5},75,16/9),'the middle is the middle');
  // A point right of centre, rolled: it moves as the view turns about its axis.
  const a=Look.ray(cam,{x:.8,y:.5},75,16/9),b=Look.ray(roll,{x:.8,y:.5},75,16/9);
  assert.ok(Math.abs(a.y-b.y)>.01,'the roll tilts where an off-centre crosshair points');
});
test('line: a held swing line flies out, snaps tight past straight once, stays taut, and fades when let go',()=>{
  const l=WebShot.line({from:{x:0,y:0,z:0},to:{x:0,y:20,z:-20},launch:1000,seed:3});
  assert.ok(l.held&&l.done===Infinity);
  assert.ok(WebShot.state(l,l.launch+5).tip<1);
  const snaps=[];for(let t=0;t<400;t+=5)snaps.push(WebShot.state(l,l.arrive+t).taut);
  assert.ok(Math.max(...snaps)>1,'overshoots straight');near(snaps[snaps.length-1],1,.01,'settles taut');
  assert.equal(WebShot.state(l,l.arrive+60000).k,1,'held as long as you like');
  WebShot.letGo(l,50000);
  assert.ok(WebShot.state(l,50100).k<1);assert.equal(WebShot.state(l,50000+WebShot.constants.LINE_FADE*1000+1),null);
  // A narrower bundle than a shot of the same length.
  const s=WebShot.shot({from:{x:0,y:0,z:0},to:{x:0,y:20,z:-20},launch:0,seed:3});
  assert.ok(WebShot.spread(l,1)<WebShot.spread(s,1)*.5);
});
