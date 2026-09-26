const test=require('node:test'),assert=require('node:assert/strict');
const Hud=require('../js/world/hud.js'),City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),levels=require('../js/levels.js'),VILLAINS=require('../js/villains.js');

const near=(a,b,e=1e-9)=>Math.abs(a-b)<e;

// --- the minimap ------------------------------------------------------------------------
test('hud: the minimap turns with you - what is ahead is up, what is on your right is right',()=>{
  const eye={x:10,y:0,z:20};
  // Facing north (yaw 0): north is up, east is right.
  let p=Hud.toMap({x:10,z:10},eye,0,2);assert.ok(near(p.x,0)&&near(p.y,-20));
  p=Hud.toMap({x:15,z:20},eye,0,2);assert.ok(near(p.x,10)&&near(p.y,0));
  // Facing east (yaw -90 degrees): east is up, south is right.
  p=Hud.toMap({x:20,z:20},eye,-Math.PI/2,1);assert.ok(near(p.x,0)&&near(p.y,-10));
  p=Hud.toMap({x:10,z:30},eye,-Math.PI/2,1);assert.ok(near(p.x,10)&&near(p.y,0));
  // Facing west (yaw +90, turned left): north is right.
  p=Hud.toMap({x:10,z:0},eye,Math.PI/2,1);assert.ok(near(p.x,20)&&near(p.y,0));
  // Distances are kept.
  p=Hud.toMap({x:13,z:24},eye,.7,3);assert.ok(near(Math.hypot(p.x,p.y),15));
});
test('hud: markers off the minimap sit on its edge, pointing the right way',()=>{
  assert.deepEqual(Hud.edge({x:10,y:-20},50),{x:10,y:-20,clamped:false});
  const e=Hud.edge({x:300,y:-150},50);
  assert.ok(e.clamped&&near(e.x,50)&&near(e.y,-25));
  assert.ok(near(Math.atan2(e.y,e.x),Math.atan2(-150,300)));
});
test('hud: the minimap shows more of the city from a rooftop',()=>{
  assert.equal(Hud.range(1.7),Hud.constants.MAP_RANGE);
  assert.ok(Hud.range(200)>Hud.range(40)&&Hud.range(40)>Hud.range(1.7));
  assert.equal(Hud.range(1e4),Hud.constants.MAP_RANGE+Hud.constants.MAP_ROOF);
});

// --- the off-screen arrow ---------------------------------------------------------------------
test('hud: the off-screen arrow sits on the edge on the villain\'s side',()=>{
  const w=1280,h=720,m=40;
  let a=Hud.pointer({x:5,y:0,z:-1},w,h,m);assert.ok(near(a.x,w-m)&&near(a.y,h/2)&&near(a.angle,0),'right');
  a=Hud.pointer({x:-5,y:0,z:-1},w,h,m);assert.ok(near(a.x,m)&&near(a.y,h/2),'left');
  a=Hud.pointer({x:0,y:5,z:-1},w,h,m);assert.ok(near(a.y,m)&&near(a.x,w/2),'up');
  a=Hud.pointer({x:1,y:-1,z:1},w,h,m);assert.ok(a.x>w/2&&near(a.y,h-m),'behind, low right');
  a=Hud.pointer({x:0,y:0,z:4},w,h,m);assert.ok(near(a.y,h-m),'dead behind points down');
  for(const v of [{x:3,y:2,z:0},{x:-7,y:-1,z:2},{x:.1,y:9,z:-3}]){
    const q=Hud.pointer(v,w,h,m);assert.ok(q.x>=m-1e-9&&q.x<=w-m+1e-9&&q.y>=m-1e-9&&q.y<=h-m+1e-9);
  }
  // Wider margins top and bottom keep it off the HUD there.
  const M={t:190,r:40,b:110,l:40};
  a=Hud.pointer({x:1,y:1,z:-1},w,h,M);assert.ok(near(a.y,190)&&near(a.x,w/2+(h/2-190)),'up and right, under the top band');
  a=Hud.pointer({x:0,y:-3,z:-1},w,h,M);assert.ok(near(a.y,h-110)&&near(a.x,w/2));
  a=Hud.pointer({x:-9,y:.1,z:-1},w,h,M);assert.ok(near(a.x,40)&&a.y>190&&a.y<h-110);
  assert.ok(Hud.onScreen({x:.5,y:.5,front:true}));
  assert.ok(!Hud.onScreen({x:.5,y:.5,front:false})&&!Hud.onScreen({x:.99,y:.5,front:true})&&!Hud.onScreen(null));
});

// --- what it says -----------------------------------------------------------------------------
test('hud: the health bar has a segment per hit, lit for what is left',()=>{
  assert.deepEqual(Hud.segments(100,100,20),{count:5,lit:5,frac:1});
  assert.deepEqual(Hud.segments(60,100,20),{count:5,lit:3,frac:.6});
  assert.deepEqual(Hud.segments(0,100,20),{count:5,lit:0,frac:0});
  assert.equal(Hud.segments(10,100,20).lit,1,'a part-segment still shows');
  assert.equal(Hud.segments(1000,1000,20).count,Hud.constants.SEGMENTS_MAX);
});
test('hud: a fight shows the villain\'s health left and the clock right, red for the last ten seconds',()=>{
  const city=City.generate(20180907),enc=Encounters.build(city).fights[1],f=Fight.start(enc,levels);
  const g=()=>({mode:'fight',fight:f,enc:enc,villain:VILLAINS[enc.villain],damage:20});
  let s=Hud.status(g());
  assert.equal(s.left.title,VILLAINS[enc.villain].name);assert.equal(s.left.sub,'ENCOUNTER 2');
  assert.equal(s.left.health,1);assert.equal(s.left.segments.count,f.maxHealth/20);
  Fight.play(f);
  // Past his entrance, into the fight proper.
  for(let k=0;k<400&&f.phase!=='villain';k++)Fight.tick(f,1/30);
  s=Hud.status(g());assert.equal(s.right.timer,f.timeLimit.toFixed(1));assert.ok(!s.right.low&&s.right.frac===1);
  f.health-=20;f.elapsed=f.timeLimit-4;
  s=Hud.status(g());assert.equal(s.left.segments.lit,s.left.segments.count-1);assert.ok(s.right.low);assert.equal(s.right.timer,'4.0');
  assert.ok(near(s.right.frac,4/f.timeLimit));
});
test('hud: training and free roam have no health bar, and say what to do',()=>{
  const t=Hud.status({mode:'train',range:{hits:3,shots:4,best:2,streak:1},accuracy:.75});
  assert.equal(t.left.health,null);assert.match(t.right.text,/3 hit \/ 4 shot · 75%/);assert.equal(t.right.frac,.75);
  const r=Hud.status({mode:'roam'});
  assert.equal(r.left.title,'FREE ROAM');assert.equal(r.left.health,null);assert.equal(r.right.timer,'');assert.match(r.right.text,/light column/);
});
