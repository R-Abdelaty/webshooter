const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),AimAssist=require('../js/world/aim-assist.js');
const Training3D=require('../js/world/training3d.js'),Combat=require('../js/combat.js');
const levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
// The thug wave before Venom is switched off in the game for now (C3), but its
// code stays for Session H, so its tests run with the switch on.
function withThugs(fn){const T=Encounters.constants.THUGS,was=T.ENABLED;T.ENABLED=true;try{return fn();}finally{T.ENABLED=was;}}
const venomWave=withThugs(()=>Encounters.build(city).fights[2]);
const EYE=1.7,DEG=Math.PI/180;
const eyeAt=v=>({x:v.x,y:v.y+EYE,z:v.z});
function aimAt(from,to){const d=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);return{x:(to.x-from.x)/d,y:(to.y-from.y)/d,z:(to.z-from.z)/d};}
// A direction `deg` degrees off `dir`, turned about the vertical.
function turned(dir,deg){const a=deg*DEG,c=Math.cos(a),s=Math.sin(a);return{x:dir.x*c+dir.z*s,y:dir.y,z:-dir.x*s+dir.z*c};}
function shotAt(origin,point){return{origin,dir:aimAt(origin,point),blocked:Infinity};}
// Knock every thug down with direct hits, waiting out the cooldown between shots.
function clearThugs(s,eye){
  for(let n=0;n<40&&s.phase==='thugs';n++){
    const t=s.thugs.find(t=>!t.down);Fight.tick(s,Combat.COOLDOWN);
    Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(t)));
  }
}

// --- aim assist ---------------------------------------------------------------
test('aim assist: the cone accepts a shot inside the tolerance and rejects one outside it',()=>{
  const o={x:0,y:0,z:0},s={x:0,y:0,z:-40,r:.25},edge=Math.asin(.25/40)/DEG,tol=AimAssist.TOLERANCE_DEG;
  assert.equal(tol,1.5);
  assert.equal(AimAssist.test(o,{x:0,y:0,z:-1},s),true,'dead centre');
  assert.equal(AimAssist.miss(o,{x:0,y:0,z:-1},s).deg,0);
  assert.equal(AimAssist.test(o,turned({x:0,y:0,z:-1},edge+tol-.05),s),true,'just inside the cone');
  assert.equal(AimAssist.test(o,turned({x:0,y:0,z:-1},edge+tol+.05),s),false,'just outside the cone');
  assert.ok(Math.abs(AimAssist.miss(o,turned({x:0,y:0,z:-1},edge+1),s).deg-1)<1e-6,'the miss is measured from the sphere edge');
  assert.equal(AimAssist.test(o,{x:0,y:0,z:1},s),false,'a sphere behind you is never hit');
});
test('aim assist: the cone is angular, so it helps as much far away as near',()=>{
  const o={x:0,y:0,z:0};
  for(const d of [10,40,160]){
    const s={x:0,y:0,z:-d,r:.25},edge=Math.asin(.25/d)/DEG;
    assert.equal(AimAssist.test(o,turned({x:0,y:0,z:-1},edge+1.4),s),true,'at '+d+' m');
    assert.equal(AimAssist.test(o,turned({x:0,y:0,z:-1},edge+1.6),s),false,'at '+d+' m');
  }
});
test('aim assist: the closest target to the line wins, and a wall in front blocks it',()=>{
  const o={x:0,y:0,z:0},dir={x:0,y:0,z:-1};
  const a={x:.6,y:0,z:-30,r:.3},b={x:.1,y:0,z:-50,r:.3};
  assert.equal(AimAssist.pick(o,dir,[a,b]).index,1);
  assert.equal(AimAssist.pick(o,dir,[a,b],{blocked:40}).index,0,'b is behind a wall 40 m away');
  assert.equal(AimAssist.pick(o,dir,[b],{blocked:40}),null);
  assert.equal(AimAssist.pick(o,turned(dir,5),[a,b]),null);
});

// --- where the fights are ---------------------------------------------------------
test('encounters: the same city always gives the same places',()=>{
  const again=Encounters.build(City.generate(20180907));
  assert.deepEqual(JSON.parse(JSON.stringify(again)),JSON.parse(JSON.stringify(spots)));
  assert.deepEqual(spots.fights.map(f=>f.id),['goblin','rhino','venom']);
  assert.deepEqual(spots.fights.map(f=>f.level),[0,1,2]);
});
test('encounters: no intro card talks about weak spots - a hit anywhere on him counts',()=>{
  for(const enc of spots.fights.concat([venomWave])){
    assert.doesNotMatch(enc.intro,/weak/i,enc.id);assert.match(enc.intro,/anywhere|thugs/i,enc.id);
  }
});
test('encounters: every vantage is a clear place to stand, and every trigger is on the street',()=>{
  for(const s of spots.fights.concat([spots.training])){
    const v=s.vantage;
    assert.ok(Encounters.standable(city,v.x,v.y,v.z,.6),s.id+' vantage is not somewhere to stand');
    assert.ok(v.y>2,s.id+' vantage should be up off the street');
    const t=s.trigger;
    assert.ok(t,s.id+' has no trigger');
    assert.ok(Encounters.groundAt(city,t.x,t.z,1)<.2,s.id+' trigger is not on the street');
    assert.ok(Encounters.standable(city,t.x,Encounters.groundAt(city,t.x,t.z,1),t.z,.4),s.id+' trigger is inside something');
    assert.equal(Encounters.triggered(spots.fights.concat([spots.training]),{x:t.x,y:.15,z:t.z}),s);
    assert.equal(Encounters.triggered([s],{x:t.x,y:v.y,z:t.z}),null,'a roof above a trigger must not start it');
  }
  assert.equal(goblin.vantage.y,city.buildings.find(b=>b.spawn).height,'the goblin fight is on the spawn tower');
});
test('encounters: you can see the rhino\'s avenue, venom\'s beams and every thug from the vantage',()=>{
  const re=eyeAt(rhino.vantage),p=rhino.path;
  for(const z of [p.z0,(p.z0+p.z1)/2,p.z1])
    assert.ok(Encounters.sightClear(city,re,{x:p.x,y:1.5,z},.5),'rhino hidden at z '+z);
  const ve=eyeAt(venom.vantage);
  assert.ok(venom.path.perches.length>=8,'too few perches: '+venom.path.perches.length);
  for(const q of venom.path.perches){
    assert.ok(Encounters.sightClear(city,ve,{x:q.x,y:q.y+1.3,z:q.z},1.2),'perch hidden '+JSON.stringify(q));
    assert.ok(Math.hypot(q.x-ve.x,q.y-ve.y,q.z-ve.z)<=Encounters.constants.LEAP.RANGE);
  }
  assert.equal(venomWave.thugs.length,Encounters.constants.THUGS.COUNT);
  assert.deepEqual([...new Set(venomWave.thugs.map(t=>t.hp))].sort(),[1,2],'thugs should take one or two hits');
  for(const t of venomWave.thugs)assert.ok(Encounters.sightClear(city,ve,Fight.thugSphere(t),.8),'thug hidden');
});

// --- the fight rules -------------------------------------------------------------
// A stand-in for what villain-view.js samples off a model's bones each frame:
// a torso, a head and a leg capsule, placed from where the villain stands
// and which way it faces.
function pose(s){
  if(!s.at){s.body=null;return s;}
  const a=s.at,f={x:Math.sin(s.face),z:Math.cos(s.face)},L=Fight.left(s.face);
  const at=(up,fw,lf)=>({x:a.x+f.x*fw+L.x*lf,y:a.y+up,z:a.z+f.z*fw+L.z*lf});
  s.body={spots:[],capsules:[{a:at(.9,0,0),b:at(1.6,0,0),r:.3,bones:['pelvis','neck']},{a:at(1.75,0,0),b:at(2.1,0,0),r:.15,bones:['neck','head']},
    {a:at(.9,0,.15),b:at(.1,0,.2),r:.12,bones:['thigh_l','foot_l']}]};
  return s;
}
// The middle of a capsule of the villain's body (the torso by default), with its radius.
function middle(s,i){const c=s.body.capsules[i||0];return{x:(c.a.x+c.b.x)/2,y:(c.a.y+c.b.y)/2,z:(c.a.z+c.b.z)/2,r:c.r};}
function step(s,dt){Fight.tick(s,dt);return pose(s);}
// Tick through the villain's entrance, a frame at a time.
function arrived(s){for(let n=0;n<400&&s.phase==='arrive';n++)step(s,1/30);return pose(s);}
const playing=enc=>arrived(Fight.play(Fight.start(enc,levels)));
const ang=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const yawTo=(a,b)=>Math.atan2(b.x-a.x,b.z-a.z);
// Close in front of the villain, where the aim-assist cone is small.
function closeEye(s,d){const f={x:Math.sin(s.face),z:Math.cos(s.face)};return{x:s.at.x+f.x*(d||6),y:s.at.y+1.4,z:s.at.z+f.z*(d||6)};}

test('fight: each encounter keeps its 2D health, 20 damage, cooldown and 30 second clock',()=>{
  spots.fights.forEach((enc,i)=>{
    const s=Fight.start(enc,levels);
    assert.equal(s.mode,'intro');assert.equal(s.health,levels[i].health);assert.equal(s.timeLimit,30);
    Fight.tick(s,5);assert.equal(s.elapsed,0,'the clock ran before GO');
  });
  const s=playing(goblin),eye=eyeAt(goblin.vantage);
  assert.equal(s.elapsed,0,'the entrance is untimed');assert.equal(s.phase,'villain');
  Fight.tick(s,29.99);assert.equal(s.mode,'playing');
  Fight.tick(s,.02);assert.equal(s.mode,'lost');
  assert.equal(Fight.fire(s,villains,shotAt(eye,s.at)).accepted,false);
});
test('fight: the entrance is untimed and he can\'t be hurt in it, but a web still lands on him',()=>{
  for(const enc of [goblin,rhino]){
    const s=pose(Fight.play(Fight.start(enc,levels))),eye=eyeAt(enc.vantage);
    assert.equal(s.phase,'arrive');assert.ok(s.at,enc.id+' is not there for his entrance');
    const r=Fight.fire(s,villains,shotAt(eye,middle(s)));
    assert.deepEqual([r.accepted,r.hit,r.early],[true,false,true]);
    assert.equal(s.health,levels[enc.level].health);assert.equal(s.shots,0);
    assert.ok(r.body&&r.body.capsule===0,'the web sticks to his body');
    step(s,Fight.constants.ARRIVE[enc.kind]-.1);assert.equal(s.phase,'arrive');assert.equal(s.elapsed,0);
    step(s,.2);assert.equal(s.phase,'villain');
    step(s,.5);assert.ok(Math.abs(s.elapsed-.5)<.11,enc.id+' clock after the entrance: '+s.elapsed);
  }
});
test('fight: a hit anywhere on him does 20 damage - body, head or leg - and says where it landed',()=>{
  const s=playing(rhino);
  step(s,.2);
  const eye=closeEye(s);
  [0,1,2].forEach((i,n)=>{
    // High on the head and low on the leg: where they meet the torso, its
    // rounded ends come first.
    const c=s.body.capsules[i],tt=i===0?.5:.75,p={x:c.a.x+(c.b.x-c.a.x)*tt,y:c.a.y+(c.b.y-c.a.y)*tt,z:c.a.z+(c.b.z-c.a.z)*tt},r=Fight.fire(s,villains,shotAt(eye,p));
    assert.deepEqual([r.accepted,r.hit,r.kind],[true,true,'villain'],'capsule '+i);
    assert.equal(s.health,140-20*(n+1));
    assert.equal(r.body.capsule,i,'it knows which part it hit');
    assert.ok(Math.abs(r.body.t-tt)<.25,'where along it: '+r.body.t);
    assert.ok(Math.hypot(r.point.x-p.x,r.point.y-p.y,r.point.z-p.z)<c.r+.2,'the web lands on him');
    step(s,Combat.COOLDOWN);
  });
  assert.equal(Fight.fire(s,villains,shotAt(eye,middle(s))).hit,true);
  assert.deepEqual(Fight.fire(s,villains,shotAt(eye,middle(s))),{accepted:false},'no cooldown between shots');
});
test('fight: a shot just past his edge still counts (aim assist), one further off misses and does no damage',()=>{
  const s=playing(rhino);
  step(s,.2);
  // Beside his middle, at chest height, well clear of his head and legs.
  const eye=closeEye(s),mid=middle(s),to=aimAt(eye,mid),d=Math.hypot(mid.x-eye.x,mid.y-eye.y,mid.z-eye.z);
  const edge=Math.asin(mid.r/d)/DEG,tol=AimAssist.TOLERANCE_DEG;
  let r=Fight.fire(s,villains,{origin:eye,dir:turned(to,edge+tol+.4),blocked:Infinity});
  assert.deepEqual([r.accepted,r.hit],[true,false]);assert.equal(s.health,140);assert.equal(r.body,null);
  step(s,Combat.COOLDOWN);
  r=Fight.fire(s,villains,{origin:eye,dir:turned(aimAt(eye,middle(s)),edge+tol-.4),blocked:Infinity});
  assert.deepEqual([r.accepted,r.hit],[true,true]);assert.equal(s.health,120);
  step(s,Combat.COOLDOWN);
  assert.equal(Fight.fire(s,villains,shotAt(eye,{x:eye.x,y:eye.y+100,z:eye.z})).hit,false,'a clean miss');
  assert.equal(s.shots,3);assert.equal(s.hits,1);
});
test('fight: without a model (the fallback) the sprite faces you square on, and a shot anywhere on it hits',()=>{
  const s=playing(rhino),eye=eyeAt(rhino.vantage);
  s.body=null;
  assert.ok(Fight.billboard(s,villains,eye).tilt>.6,'from the roof the sprite should tip back');
  for(let n=0;n<30;n++){
    Fight.tick(s,.25);s.body=null;
    const bb=Fight.billboard(s,villains,eye),to=aimAt(bb.centre,eye);
    const off=Math.acos(Math.min(1,to.x*bb.normal.x+to.y*bb.normal.y+to.z*bb.normal.z))/DEG;
    assert.ok(off<3,'the sprite is '+off.toFixed(1)+' degrees off facing the eye');
    assert.ok(Math.abs(bb.at.y-s.at.y)<1e-12,'its feet left the ground');
  }
  const bb=Fight.billboard(s,villains,eye),low=Fight.onSprite(bb,.3,.85);
  let r=Fight.fire(s,villains,shotAt(eye,low));
  assert.equal(r.hit,true,'low on the sprite counts');
  assert.ok(Math.abs(r.body.u-.3)<.02&&Math.abs(r.body.v-.85)<.02,'and says where: '+r.body.u+', '+r.body.v);
  Fight.tick(s,Combat.COOLDOWN);s.body=null;
  const bb2=Fight.billboard(s,villains,eye),far=Fight.onSprite(bb2,2.5,.5);
  assert.equal(Fight.fire(s,villains,shotAt(eye,far)).hit,false,'well to the side of it misses');
});
test('fight: he cannot be hit through a wall',()=>{
  const s=playing(goblin),eye=eyeAt(goblin.vantage),w=middle(s);
  const d=Math.hypot(w.x-eye.x,w.y-eye.y,w.z-eye.z);
  const r=Fight.fire(s,villains,{origin:eye,dir:aimAt(eye,w),blocked:d/2});
  assert.deepEqual([r.accepted,r.hit],[true,false]);assert.equal(s.health,100);assert.equal(r.body,null);
});
test('fight: being shot at makes it dodge, faster than it drifts, and says which side it went',()=>{
  for(const enc of [goblin,rhino]){
    const drift=playing(enc),dodge=playing(enc),eye=eyeAt(enc.vantage);
    step(drift,.7);step(dodge,.7);
    const n=dodge.dodge.n;
    Fight.fire(dodge,villains,shotAt(eye,{x:0,y:-1e4,z:0}));  // a clean miss
    assert.equal(dodge.dodgeRemaining,Combat.DODGE_SECONDS);
    assert.equal(dodge.dodge.n,n+1);assert.ok(dodge.dodge.side==='l'||dodge.dodge.side==='r');
    const go=s=>{const a={...s.at};step(s,.1);return Math.hypot(s.at.x-a.x,s.at.y-a.y,s.at.z-a.z);};
    assert.ok(go(dodge)>go(drift),enc.id+' did not speed up');
  }
  // A shot passing on the goblin's right: he ducks left, and the other way round.
  for(const sideShot of [1,-1]){
    const s=playing(goblin),eye=eyeAt(goblin.vantage),L=Fight.left(s.face);
    const c={x:s.at.x-L.x*.8*sideShot,y:s.at.y+1.2,z:s.at.z-L.z*.8*sideShot};
    Fight.fire(s,villains,{origin:eye,dir:aimAt(eye,c),blocked:Infinity});
    assert.equal(s.dodge.side,sideShot>0?'l':'r');
  }
});
test('fight: the goblin circles you, the rhino keeps to his avenue, venom to his beams',()=>{
  const g=playing(goblin),gp=goblin.path;let turnedBy=0,last=Math.atan2(g.at.z-gp.cz,g.at.x-gp.cx);
  for(let n=0;n<290;n++){
    step(g,.1);
    const r=Math.hypot(g.at.x-gp.cx,g.at.z-gp.cz),h=g.at.y-gp.y,a=Math.atan2(g.at.z-gp.cz,g.at.x-gp.cx);
    assert.ok(r>=gp.r0-1e-6&&r<=gp.r1+1e-6,'radius '+r);assert.ok(h>=gp.h0-1e-6&&h<=gp.h1+1e-6,'height '+h);
    turnedBy+=ang(a,last);last=a;
  }
  assert.ok(turnedBy>Math.PI*1.5,'the goblin only went '+(turnedBy/DEG).toFixed(0)+' degrees round');
  const r=playing(rhino),rp=rhino.path;let zs=[];
  for(let n=0;n<290;n++){
    step(r,.1);zs.push(r.at.z);
    assert.ok(Math.abs(r.at.x-rp.x)<=rp.lane+1e-6);assert.ok(r.at.z>=rp.z0-1e-6&&r.at.z<=rp.z1+1e-6);assert.equal(r.at.y,rp.y);
  }
  assert.ok(Math.min(...zs)<rp.z0+1&&Math.max(...zs)>rp.z1-1,'the rhino did not charge the whole way');
  const v=playing(venom);
  const perched=new Set();
  for(let n=0;n<290&&v.mode==='playing';n++){
    step(v,.1);
    if(!v.m.flying)perched.add(v.m.at);
    assert.ok(v.at.y>=Math.min(...venom.path.perches.map(q=>q.y))-1e-6,'venom went through the floor');
  }
  assert.ok(perched.size>=4,'venom only used '+perched.size+' beams');
  for(const i of perched)assert.ok(venom.path.perches[i]);
});
test('fight: each villain faces where it is going, and you during its entrance',()=>{
  for(const enc of [goblin,rhino]){
    const s=Fight.play(Fight.start(enc,levels));
    for(let n=0;n<20;n++)step(s,1/30);
    assert.ok(ang(s.face,yawTo(s.at,eyeAt(enc.vantage)))<5*DEG,enc.id+' should face you while he makes his entrance');
  }
  const g=playing(goblin),off=[];
  for(let n=0;n<150;n++){step(g,1/30);if(n>60)off.push(ang(g.face,Math.atan2(g.vel.x,g.vel.z))/DEG);}
  assert.ok(Math.max(...off)<25,'the goblin should face along his circuit: '+Math.max(...off).toFixed(0));
  const r=playing(rhino),runOff=[];
  for(let n=0;n<300;n++){step(r,1/30);if(r.m.state==='run'&&Math.abs(r.vel.z)>3)runOff.push(ang(r.face,Math.atan2(r.vel.x,r.vel.z))/DEG);}
  assert.ok(runOff.length>30);
  assert.ok(Math.max(...runOff)<35&&runOff.reduce((a,b)=>a+b)/runOff.length<10,'the rhino should run facing the way he runs, swerves and all');
});
test('fight: the rhino turns, winds up once, runs, skids to a stop at each end and turns round past you',()=>{
  const s=playing(rhino),seen=[],eye=eyeAt(rhino.vantage);let last=null,maxV=0,ends=0,sweep=[];
  for(let n=0;n<30*20;n++){
    const was=s.m.state;step(s,1/30);maxV=Math.max(maxV,s.m.v);
    if(s.m.state!==last){seen.push(s.m.state);last=s.m.state;}
    if(was!=='turn'&&s.m.state==='turn'){ends++;sweep=[];}
    if(s.m.state==='turn')sweep.push({face:s.face,to:yawTo(s.at,eye)});
    if(was==='turn'&&s.m.state==='run'&&ends>0)
      assert.ok(sweep.some(q=>ang(q.face,q.to)<Math.PI/3),'he turned round with his back to you');
  }
  assert.deepEqual(seen.slice(0,5),['turn','windup','run','skid','turn']);
  assert.equal(seen.filter(x=>x==='windup').length,1,'only the first charge winds up');
  assert.ok(ends>=2,'only '+ends+' ends reached');
  assert.ok(Math.abs(maxV-levels[1].moveSpeed*rhino.path.scale)<.01,'top speed '+maxV);
});
test('fight: venom crouches before each leap and lands facing the beam he will leap to next',()=>{
  const s=playing(venom),eye=eyeAt(venom.vantage);
  let crouched=false,landings=0,wasFlying=false;
  for(let n=0;n<30*15;n++){
    if(s.m.crouch>0)crouched=true;
    if(!wasFlying&&s.m.flying){assert.ok(crouched,'leapt without crouching');crouched=false;}
    wasFlying=s.m.flying;step(s,1/30);
    if(wasFlying&&!s.m.flying){
      landings++;
      const q=venom.path.perches[s.m.next];
      step(s,.15);
      if(!s.m.flying&&!s.m.dash&&Math.hypot(q.x-s.at.x,q.z-s.at.z)>.5)assert.ok(ang(s.face,yawTo(s.at,q))<.25,'landed facing away from the next beam');
      wasFlying=s.m.flying;
    }
  }
  assert.ok(landings>=4,'only '+landings+' leaps');
});
test('fight: venom dodges by dashing along a beam across his view, and leaps soon after',()=>{
  const s=playing(venom),eye=eyeAt(venom.vantage);
  for(let n=0;n<300&&(s.m.flying||s.m.crouch>0||s.m.rest<.3);n++)step(s,1/30);
  assert.ok(!s.m.flying&&!(s.m.crouch>0),'venom never settled on a beam');
  const at={...s.at},L=Fight.left(s.face);
  Fight.fire(s,villains,shotAt(eye,{x:0,y:-1e4,z:0}));
  assert.ok(s.m.dash,'no dash');assert.ok(s.dodge.side==='l'||s.dodge.side==='r');
  for(let n=0;n<Math.ceil(Fight.constants.DASH_T*30)+1;n++)step(s,1/30);
  const moved={x:s.at.x-at.x,z:s.at.z-at.z},d=Math.hypot(moved.x,moved.z);
  assert.ok(Math.abs(d-Fight.constants.DASH)<.01,'dashed '+d);
  assert.ok(Math.abs(moved.x*L.x+moved.z*L.z)/d>.5,'the dash should go across his view');
  assert.equal((moved.x*L.x+moved.z*L.z)>0?'l':'r',s.dodge.side);
  assert.equal(s.at.y,at.y,'and stay on the beam');
  let t=0;while(!s.m.flying&&t<2){step(s,1/30);t+=1/30;}
  assert.ok(s.m.flying&&t<Fight.constants.RUSH_REST+Fight.constants.CROUCH+.1,'he should leap off soon after: '+t.toFixed(2));
  // In the air, a shot only makes him hurry; there is no dodge to see.
  Fight.tick(s,Combat.COOLDOWN);
  if(s.m.flying){Fight.fire(s,villains,shotAt(eye,{x:0,y:-1e4,z:0}));assert.equal(s.dodge.side,null);assert.equal(s.m.rush,true);}
});
test('fight: pausing holds everything exactly where it was, and resuming carries on',()=>{
  for(const enc of spots.fights.concat([venomWave])){
    const wave=enc.thugs&&enc.thugs.length,s=wave?Fight.play(Fight.start(enc,levels)):playing(enc),eye=eyeAt(enc.vantage);
    step(s,1.3);
    if(wave)Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(s.thugs[1])));
    else Fight.fire(s,villains,shotAt(eye,middle(s)));
    step(s,2.1);
    Fight.pause(s);assert.equal(s.mode,'paused');
    const held=JSON.stringify(s);
    for(let n=0;n<100;n++)Fight.tick(s,.1);
    assert.equal(JSON.stringify(s),held,enc.id+' changed while paused');
    assert.deepEqual(Fight.fire(s,villains,shotAt(eye,{x:0,y:0,z:0})),{accepted:false},'a paused fight took a shot');
    Fight.play(s);assert.equal(s.mode,'playing');
    const before=JSON.parse(held);
    assert.equal(s.health,before.health);assert.equal(s.targetIndex,before.targetIndex);assert.equal(s.elapsed,before.elapsed);
    step(s,.5);
    assert.ok(s.time>before.time,enc.id+' did not resume');
  }
});
test('fight: with the wave on, the thugs have to be cleared before venom shows, and his clock starts after his entrance',()=>{
  const s=Fight.play(Fight.start(venomWave,levels)),eye=eyeAt(venomWave.vantage);
  assert.equal(s.phase,'thugs');assert.equal(s.at,null,'venom is there before the thugs are down');
  // Shooting where venom will perch does nothing to him.
  const q=venomWave.path.perches[0];
  Fight.fire(s,villains,shotAt(eye,{x:q.x,y:q.y+1.3,z:q.z}));
  assert.equal(s.health,180);assert.equal(s.elapsed,0);
  Fight.tick(s,20);
  assert.equal(s.elapsed,0,'the 30 seconds ran during the thug wave');assert.equal(s.mode,'playing');
  // One- and two-hit thugs.
  const two=s.thugs.findIndex(t=>t.hp===2);
  let r=Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(s.thugs[two])));
  assert.deepEqual([r.hit,r.kind,r.down],[true,'thug',false]);
  Fight.tick(s,Combat.COOLDOWN);
  r=Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(s.thugs[two])));
  assert.deepEqual([r.hit,r.down],[true,true]);
  assert.equal(s.phase,'thugs');
  Fight.tick(s,Combat.COOLDOWN);
  assert.equal(Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(s.thugs[two]))).hit,false,'a thug who is down was hit again');
  clearThugs(s,eye);
  assert.equal(s.phase,'arrive');assert.ok(s.thugs.every(t=>t.down));assert.ok(s.at,'venom did not show');
  const perch=venomWave.path.perches[s.m.at];
  assert.ok(s.at.y>perch.y+10,'he drops in from high above his beam');
  step(s,Fight.constants.ENTRY);assert.equal(s.at.y,perch.y,'and lands on it');
  arrived(s);assert.equal(s.elapsed,0);assert.equal(s.health,180);
  step(s,2);
  assert.ok(s.elapsed>1.9&&s.elapsed<2.01,'the clock did not start after his entrance');
  r=Fight.fire(s,villains,shotAt(eye,middle(s)));
  assert.equal(r.hit,true);assert.equal(s.health,160);
});
test('thugs off: the switch is off, and venom\'s fight has no wave - it starts with his entrance',()=>{
  assert.equal(Encounters.constants.THUGS.ENABLED,false,'the game is the three villains only for now');
  for(const enc of spots.fights)assert.deepEqual(enc.thugs||[],[],enc.id+' has thugs');
  assert.doesNotMatch(venom.intro,/thug/i);
  const s=Fight.play(Fight.start(venom,levels)),eye=eyeAt(venom.vantage);
  assert.equal(s.phase,'arrive');assert.deepEqual(s.thugs,[]);assert.equal(Fight.standing(s),0);
  const perch=venom.path.perches[s.m.at];
  assert.ok(s.at&&s.at.y>perch.y+10,'he drops in from high above his beam straight away');
  assert.deepEqual(Fight.snapshot(s).thugs,[]);
  arrived(s);assert.equal(s.phase,'villain');assert.equal(s.elapsed,0);
  // Every shot is at venom: a hit is a villain hit, and so is a miss.
  const r=Fight.fire(s,villains,shotAt(eye,middle(s)));
  assert.deepEqual([r.hit,r.kind],[true,'villain']);assert.equal(s.health,160);
  step(s,Combat.COOLDOWN);
  assert.equal(Fight.fire(s,villains,shotAt(eye,{x:0,y:-1e4,z:0})).kind,'villain');
  assert.equal(s.thugHits,0);
});
test('thugs off: switching the wave on brings it back and changes nothing else',()=>{
  const {thugs:a,intro:ia,...on}=venomWave,{thugs:b,intro:ib,...off}=venom;
  assert.deepEqual(JSON.parse(JSON.stringify(on)),JSON.parse(JSON.stringify(off)),'the vantage, trigger or beams moved');
  assert.equal(a.length,Encounters.constants.THUGS.COUNT);assert.deepEqual(b,[]);
  assert.match(ia,/thugs/);assert.notEqual(ia,ib);
  assert.deepEqual(JSON.parse(JSON.stringify(withThugs(()=>Encounters.build(City.generate(20180907))).fights)),
    JSON.parse(JSON.stringify([goblin,rhino,venomWave])),'the wave is not the same every time');
  assert.equal(Fight.start(venomWave,levels).phase,'thugs');
  assert.equal(Encounters.constants.THUGS.ENABLED,false,'the override leaked');
});
test('fight: a shot is judged against the pose that was on screen when you aimed, not where it is now',()=>{
  const s=playing(goblin),eye=eyeAt(goblin.vantage);
  step(s,1);
  const seen=Fight.snapshot(s),w=middle(s);
  assert.equal(seen.body,s.body,'the snapshot keeps the sampled bones');
  step(s,.25);                                         // it has moved on since
  assert.ok(Math.hypot(s.at.x-seen.villain.x,s.at.z-seen.villain.z)>.8);
  const now=JSON.parse(JSON.stringify(s));
  assert.equal(Fight.fire(now,villains,shotAt(eye,w)).hit,false,'moved on, the old aim should miss');
  const r=Fight.fire(s,villains,shotAt(eye,w),seen);
  assert.equal(r.hit,true);assert.equal(s.health,80);
});
test('fight: five hits beat the goblin, and the rest of the fights need their 2D number of hits',()=>{
  spots.fights.concat([venomWave]).forEach(enc=>{
    const s=Fight.play(Fight.start(enc,levels)),eye=eyeAt(enc.vantage);
    clearThugs(s,eye);arrived(s);
    let n=0;
    while(s.mode==='playing'&&n<50){step(s,Combat.COOLDOWN);if(Fight.fire(s,villains,shotAt(eye,middle(s))).hit)n++;}
    assert.equal(s.mode,'won',enc.id);assert.equal(n,levels[enc.level].health/20);assert.equal(s.health,0);
  });
});

// --- training --------------------------------------------------------------------
test('training: targets are at mixed distances round the roof, in view',()=>{
  const T=spots.training.targets,eye=Training3D.eye(spots.training);
  assert.ok(T.length>=12,'only '+T.length+' targets');
  const d=T.map(t=>Math.hypot(t.x-eye.x,t.y-eye.y,t.z-eye.z));
  assert.ok(Math.min(...d)<30&&Math.max(...d)>50,'distances are not mixed: '+Math.min(...d)+'..'+Math.max(...d));
  for(const t of T)assert.ok(Encounters.sightClear(city,eye,t,.7));
});
test('training: each new target is at least 30 degrees from the last',()=>{
  const s=Training3D.start(spots.training,11),eye=Training3D.eye(spots.training);
  assert.equal(Training3D.MIN_DEG,30);
  for(let n=0;n<60;n++){
    const was=s.target3;
    const r=Training3D.fire(s,shotAt(eye,was));
    assert.deepEqual([r.accepted,r.hit],[true,true]);
    assert.ok(Training3D.apart(eye,was,s.target3)>=30,'only '+Training3D.apart(eye,was,s.target3).toFixed(1)+' degrees apart');
    Training3D.tick(s,.2);
  }
  assert.equal(s.hits,60);assert.equal(s.streak,60);assert.equal(Training3D.accuracy(s),1);
});
test('training: a miss keeps the target and breaks the streak',()=>{
  const s=Training3D.start(spots.training,4),eye=Training3D.eye(spots.training);
  Training3D.fire(s,shotAt(eye,s.target3));Training3D.tick(s,.2);
  const was=s.target3,r=Training3D.fire(s,{origin:eye,dir:turned(aimAt(eye,was),10),blocked:Infinity});
  assert.deepEqual([r.accepted,r.hit],[true,false]);
  assert.equal(s.target3,was);assert.equal(s.streak,0);assert.equal(s.best,1);assert.equal(Training3D.accuracy(s),.5);
});

// --- the sprites ---------------------------------------------------------------------
test('villains: the sprite aspect ratios match the PNGs the 3D sprites are made from',()=>{
  for(const v of villains){
    const b=fs.readFileSync(path.join(__dirname,'..',v.sprite));
    assert.ok(Math.abs(v.aspect-b.readUInt32BE(16)/b.readUInt32BE(20))<1e-9,v.id);
    assert.ok(v.height>1.5&&v.height<3.5,v.id+' is not human scale');
  }
});
