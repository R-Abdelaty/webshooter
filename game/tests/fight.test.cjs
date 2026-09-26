const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),AimAssist=require('../js/world/aim-assist.js');
const Training3D=require('../js/world/training3d.js'),Combat=require('../js/combat.js');
const levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
const EYE=1.7,DEG=Math.PI/180;
const eyeAt=v=>({x:v.x,y:v.y+EYE,z:v.z});
function aimAt(from,to){const d=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);return{x:(to.x-from.x)/d,y:(to.y-from.y)/d,z:(to.z-from.z)/d};}
// A direction `deg` degrees off `dir`, turned about the vertical.
function turned(dir,deg){const a=deg*DEG,c=Math.cos(a),s=Math.sin(a);return{x:dir.x*c+dir.z*s,y:dir.y,z:-dir.x*s+dir.z*c};}
function shotAt(origin,point){return{origin,dir:aimAt(origin,point),blocked:Infinity};}
const current=(s,eye)=>Fight.weakSpots(s,villains,eye).find(w=>w.current);
const playing=enc=>Fight.play(Fight.start(enc,levels));
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
  assert.equal(venom.thugs.length,Encounters.constants.THUGS.COUNT);
  assert.deepEqual([...new Set(venom.thugs.map(t=>t.hp))].sort(),[1,2],'thugs should take one or two hits');
  for(const t of venom.thugs)assert.ok(Encounters.sightClear(city,ve,Fight.thugSphere(t),.8),'thug hidden');
});

// --- the fight rules -------------------------------------------------------------
test('fight: each encounter keeps its 2D health, 20 damage, cooldown and 30 second clock',()=>{
  spots.fights.forEach((enc,i)=>{
    const s=Fight.start(enc,levels);
    assert.equal(s.mode,'intro');assert.equal(s.health,levels[i].health);assert.equal(s.timeLimit,30);
    Fight.tick(s,5);assert.equal(s.elapsed,0,'the clock ran before GO');
  });
  const s=playing(goblin),eye=eyeAt(goblin.vantage);
  Fight.tick(s,29.99);assert.equal(s.mode,'playing');
  Fight.tick(s,.02);assert.equal(s.mode,'lost');
  assert.equal(Fight.fire(s,villains,shotAt(eye,s.at)).accepted,false);
});
test('fight: a hit on the current weak spot does 20 damage and advances to the next',()=>{
  const s=playing(goblin),eye=eyeAt(goblin.vantage);
  Fight.tick(s,.5);
  const names=[];
  for(let n=0;n<3;n++){
    const w=current(s,eye);names.push(w.name);
    const r=Fight.fire(s,villains,shotAt(eye,w));
    assert.equal(r.accepted,true);assert.equal(r.hit,true,'hit '+n);assert.equal(r.kind,'villain');
    assert.equal(s.health,100-20*(n+1));assert.equal(s.targetIndex,n+1);
    assert.ok(r.point&&Math.hypot(r.point.x-w.x,r.point.y-w.y,r.point.z-w.z)<w.r+1e-9,'the web lands on the spot');
    Fight.tick(s,Combat.COOLDOWN);
  }
  assert.deepEqual(names,villains[0].targets.map(t=>t.name),'weak spots go in the 2D order');
  assert.equal(Fight.fire(s,villains,shotAt(eye,current(s,eye))).hit,true);
  assert.deepEqual(Fight.fire(s,villains,shotAt(eye,current(s,eye))),{accepted:false},'no cooldown between shots');
});
test('fight: hitting a weak spot that is not the current one, or missing, does no damage',()=>{
  // Up close, so the other weak spots are well outside the current one's cone.
  const s=playing(rhino);
  Fight.tick(s,1);
  const bb=Fight.billboard(s,villains,eyeAt(rhino.vantage)),eye={x:bb.centre.x+bb.normal.x*6,y:bb.centre.y,z:bb.centre.z+bb.normal.z*6};
  const other=Fight.weakSpots(s,villains,eye).find(w=>!w.current&&w.name==='SHOULDER');
  let r=Fight.fire(s,villains,shotAt(eye,other));
  assert.deepEqual([r.accepted,r.hit],[true,false]);assert.equal(s.health,140);assert.equal(s.targetIndex,0);
  Fight.tick(s,Combat.COOLDOWN);
  const w=current(s,eye),miss=aimAt(eye,w),edge=Math.asin(w.r/Math.hypot(w.x-eye.x,w.y-eye.y,w.z-eye.z))/DEG;
  r=Fight.fire(s,villains,{origin:eye,dir:turned(miss,edge+AimAssist.TOLERANCE_DEG+.3),blocked:Infinity});
  assert.deepEqual([r.accepted,r.hit],[true,false]);assert.equal(s.health,140);
  assert.equal(s.shots,2);assert.equal(s.hits,0);
});
test('fight: the sprite faces you square on, even from a roof, and its weak spots are on it',()=>{
  const s=playing(rhino),eye=eyeAt(rhino.vantage);
  for(let n=0;n<30;n++){
    Fight.tick(s,.25);
    const bb=Fight.billboard(s,villains,eye),to=aimAt(bb.centre,eye);
    const off=Math.acos(Math.min(1,to.x*bb.normal.x+to.y*bb.normal.y+to.z*bb.normal.z))/DEG;
    assert.ok(off<3,'the sprite is '+off.toFixed(1)+' degrees off facing the eye');
    assert.ok(Math.abs(bb.at.y-s.at.y)<1e-12,'its feet left the ground');
    Fight.weakSpots(s,villains,eye).forEach((w,k)=>{
      const p=Fight.bodyHit(bb,eye,aimAt(eye,w)),t=villains[1].targets[k];
      assert.ok(p&&Math.abs(p.u-t.x)<1e-9&&Math.abs(p.v-t.y)<1e-9,'weak spot '+t.name+' is off the sprite');
    });
  }
  assert.ok(Fight.billboard(s,villains,eye).tilt>.6,'from the roof the sprite should tip back');
});
test('fight: a weak spot behind a wall cannot be hit through it',()=>{
  const s=playing(goblin),eye=eyeAt(goblin.vantage),w=current(s,eye);
  const d=Math.hypot(w.x-eye.x,w.y-eye.y,w.z-eye.z);
  const r=Fight.fire(s,villains,{origin:eye,dir:aimAt(eye,w),blocked:d/2});
  assert.deepEqual([r.accepted,r.hit],[true,false]);assert.equal(s.health,100);
});
test('fight: being shot at makes it dodge, faster than it drifts',()=>{
  for(const enc of [goblin,rhino]){
    const drift=playing(enc),dodge=playing(enc),eye=eyeAt(enc.vantage);
    Fight.tick(drift,.7);Fight.tick(dodge,.7);            // past the rhino's first turn-round, if any
    Fight.fire(dodge,villains,shotAt(eye,{x:0,y:-1e4,z:0}));  // a clean miss
    assert.equal(dodge.dodgeRemaining,Combat.DODGE_SECONDS);
    const step=s=>{const a={...s.at};Fight.tick(s,.1);return Math.hypot(s.at.x-a.x,s.at.y-a.y,s.at.z-a.z);};
    assert.ok(step(dodge)>step(drift),enc.id+' did not speed up');
  }
});
test('fight: the goblin circles you, the rhino keeps to his avenue, venom to his beams',()=>{
  const g=playing(goblin),gp=goblin.path;let turned=0,last=Math.atan2(g.at.z-gp.cz,g.at.x-gp.cx);
  for(let n=0;n<290;n++){
    Fight.tick(g,.1);
    const r=Math.hypot(g.at.x-gp.cx,g.at.z-gp.cz),h=g.at.y-gp.y,a=Math.atan2(g.at.z-gp.cz,g.at.x-gp.cx);
    assert.ok(r>=gp.r0-1e-6&&r<=gp.r1+1e-6,'radius '+r);assert.ok(h>=gp.h0-1e-6&&h<=gp.h1+1e-6,'height '+h);
    turned+=Math.abs(Math.atan2(Math.sin(a-last),Math.cos(a-last)));last=a;
  }
  assert.ok(turned>Math.PI*1.5,'the goblin only went '+(turned/DEG).toFixed(0)+' degrees round');
  const r=playing(rhino),rp=rhino.path;let zs=[];
  for(let n=0;n<290;n++){
    Fight.tick(r,.1);zs.push(r.at.z);
    assert.ok(Math.abs(r.at.x-rp.x)<=rp.lane+1e-6);assert.ok(r.at.z>=rp.z0-1e-6&&r.at.z<=rp.z1+1e-6);assert.equal(r.at.y,rp.y);
  }
  assert.ok(Math.min(...zs)<rp.z0+1&&Math.max(...zs)>rp.z1-1,'the rhino did not charge the whole way');
  const v=playing(venom),ve=eyeAt(venom.vantage);clearThugs(v,ve);
  const perched=new Set();
  for(let n=0;n<290&&v.mode==='playing';n++){
    Fight.tick(v,.1);
    if(!v.m.flying)perched.add(v.m.at);
    assert.ok(v.at.y>=Math.min(...venom.path.perches.map(q=>q.y))-1e-6,'venom went through the floor');
  }
  assert.ok(perched.size>=4,'venom only used '+perched.size+' beams');
  for(const i of perched)assert.ok(venom.path.perches[i]);
});
test('fight: pausing holds everything exactly where it was, and resuming carries on',()=>{
  for(const enc of spots.fights){
    const s=playing(enc),eye=eyeAt(enc.vantage);
    Fight.tick(s,1.3);
    if(enc.thugs)Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(s.thugs[1])));
    else Fight.fire(s,villains,shotAt(eye,current(s,eye)));
    Fight.tick(s,2.1);
    Fight.pause(s);assert.equal(s.mode,'paused');
    const held=JSON.stringify(s);
    for(let n=0;n<100;n++)Fight.tick(s,.1);
    assert.equal(JSON.stringify(s),held,enc.id+' changed while paused');
    assert.deepEqual(Fight.fire(s,villains,shotAt(eye,{x:0,y:0,z:0})),{accepted:false},'a paused fight took a shot');
    Fight.play(s);assert.equal(s.mode,'playing');
    const before=JSON.parse(held);
    assert.equal(s.health,before.health);assert.equal(s.targetIndex,before.targetIndex);assert.equal(s.elapsed,before.elapsed);
    Fight.tick(s,.5);
    assert.ok(s.time>before.time,enc.id+' did not resume');
  }
});
test('fight: the thugs have to be cleared before venom shows, and his clock starts then',()=>{
  const s=playing(venom),eye=eyeAt(venom.vantage);
  assert.equal(s.phase,'thugs');assert.equal(s.at,null,'venom is there before the thugs are down');
  assert.equal(Fight.weakSpots(s,villains,eye).length,0);
  // Shooting where venom will perch does nothing to him.
  const q=venom.path.perches[0];
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
  assert.equal(s.phase,'villain');assert.ok(s.thugs.every(t=>t.down));assert.ok(s.at,'venom did not show');
  assert.equal(s.health,180);
  Fight.tick(s,2);
  assert.ok(s.elapsed>1.9&&s.elapsed<2.01,'the clock did not start with venom');
  r=Fight.fire(s,villains,shotAt(eye,current(s,eye)));
  assert.equal(r.hit,true);assert.equal(s.health,160);
});
test('fight: a shot is judged against where things were when you aimed, not where they are now',()=>{
  const s=playing(goblin),eye=eyeAt(goblin.vantage);
  Fight.tick(s,1);
  const seen=Fight.snapshot(s),w=current(s,eye);
  Fight.tick(s,.25);                                   // it has moved on since
  assert.ok(Math.hypot(s.at.x-seen.villain.x,s.at.z-seen.villain.z)>.8);
  assert.equal(Fight.fire(playing(goblin),villains,shotAt(eye,w)).hit,false,'moved on, the old aim should miss');
  const r=Fight.fire(s,villains,shotAt(eye,w),seen);
  assert.equal(r.hit,true);assert.equal(s.health,80);
});
test('fight: five hits beat the goblin, and the rest of the fights need their 2D number of hits',()=>{
  spots.fights.forEach((enc,i)=>{
    const s=playing(enc),eye=eyeAt(enc.vantage);
    clearThugs(s,eye);
    let n=0;
    while(s.mode==='playing'&&n<50){Fight.tick(s,Combat.COOLDOWN);if(Fight.fire(s,villains,shotAt(eye,current(s,eye))).hit)n++;}
    assert.equal(s.mode,'won',enc.id);assert.equal(n,levels[i].health/20);assert.equal(s.health,0);
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
