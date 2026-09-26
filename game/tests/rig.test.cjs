const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const Rig=require('../js/world/rig.js');
const MODELS=path.join(__dirname,'../assets/models');
const manifest=JSON.parse(fs.readFileSync(path.join(MODELS,'characters.json'),'utf8'));
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=(eps||1e-9),(msg||'')+' got '+a+', expected '+b);
const copy=x=>JSON.parse(JSON.stringify(x));

// Node names and clips (with lengths) straight from a GLB's JSON chunk.
function glb(file){
  const b=fs.readFileSync(path.join(MODELS,file)),j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
  const clips={};(j.animations||[]).forEach(a=>{clips[a.name]=Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));});
  return {bones:(j.nodes||[]).map(n=>n.name),clips};
}

// --- the manifest ---------------------------------------------------------------
test('manifest: characters.json is valid',()=>{
  assert.deepEqual(Rig.validate(manifest),[]);
  assert.deepEqual(Object.keys(manifest.villains),['goblin','rhino','venom']);
});
test('manifest: validation names what is wrong',()=>{
  assert.deepEqual(Rig.validate(null),['no "villains" object']);
  const m=copy(manifest);
  m.villains.goblin.height=0;m.villains.rhino.weakSpots[1].name='KNEE';m.villains.rhino.weakSpots[0].offset=[0,0];
  m.villains.venom.body.push(['pelvis',2]);m.villains.rhino.body.push(['a','b',.1,[0,1]]);m.villains.goblin.airborne={feet:[],ankle:.1,clips:[]};m.villains.venom.file='venom.fbx';m.villains.venom.speeds={walk:3,run:2};
  m.villains.goblin.weakSpots[2].name='CHEST';
  const e=Rig.validate(m).join('\n');
  for(const s of ['goblin: height','rhino: weakSpots[1] name','rhino: weakSpots[0] offset','venom: body['+manifest.villains.venom.body.length+']','rhino: body['+manifest.villains.rhino.body.length+']','goblin: airborne','venom: file','venom: speeds','goblin: weakSpots[2] CHEST twice'])
    assert.ok(e.includes(s),'reports '+s+'\n'+e);
});
test('manifest: every bone it names is in its model, and every loop and event clip exists',()=>{
  for(const [id,v] of Object.entries(manifest.villains)){
    const g=glb(v.file);
    assert.deepEqual(Rig.check(v,g.bones,Object.keys(g.clips)),[],id);
    for(const [p,pv] of Object.entries(v.props||{})){
      const pg=glb(pv.file);
      (pv.loops||[]).forEach(c=>assert.ok(c in pg.clips,p+' has '+c));
    }
  }
  assert.deepEqual(Rig.check(manifest.villains.rhino,['mixamorig:Head'],['idle']).slice(0,1),['no bone mixamorig:Spine2']);
});
test('manifest: the goblin releases his bomb inside his attack clip',()=>{
  const g=glb('goblin.glb'),e=manifest.villains.goblin.events.attack;
  assert.ok(e.release_seconds>0&&e.release_seconds<g.clips.attack);
  near(e.release_seconds,e.release_frame/e.fps,.01);
});

// --- clip names -------------------------------------------------------------------
test('clips: a model plays its own clip, else the first fallback it has, else nothing',()=>{
  assert.equal(Rig.resolve(['idle','hit'],'hit'),'hit');
  assert.equal(Rig.resolve(['idle','hit'],'hit_big'),'hit');
  assert.equal(Rig.resolve(['idle','hit_big','hit'],'defeat'),'hit_big');
  assert.equal(Rig.resolve(['idle','fly'],'fly_turn_l'),'fly');
  assert.equal(Rig.resolve(['idle'],'walk'),'idle');
  assert.equal(Rig.resolve(['idle'],'attack'),null);
  assert.equal(Rig.resolve([],'loco'),'loco');
});
test('clips: every villain can play every standard clip, using fallbacks only where planned',()=>{
  for(const [id,v] of Object.entries(manifest.villains)){
    const clips=Object.keys(glb(v.file).clips);
    assert.deepEqual(Rig.missing(clips),[],id);
  }
  // The goblin never leaves his glider: no walk or run of his own.
  const gob=Object.keys(glb('goblin.glb').clips);
  assert.equal(Rig.resolve(gob,'walk'),'idle');
  assert.equal(Rig.resolve(Object.keys(glb('rhino.glb').clips),'run'),'run');
});

// --- the state machine --------------------------------------------------------------
const CLIPS={idle:2,walk:1.6,run:.8,hit:.4,hit_big:1,attack:1.33,defeat:1.5,roar:1.6,fly:2};
function mk(extra){return Rig.machine(Object.assign({clips:CLIPS,loops:['idle','walk','run','fly'],speeds:{walk:1.5,run:6},events:{attack:{release_seconds:.7}}},extra));}
function weights(m){const o={};Rig.pose(m).forEach(p=>{o[p.clip+(p.additive?'+':'')]=p.w;});return o;}
function run(m,secs,dt){const ev=[];for(let t=0;t<secs-1e-9;t+=dt||1/60)ev.push(...Rig.step(m,dt||1/60));return ev;}
const sumFull=m=>Rig.pose(m).filter(p=>!p.additive).reduce((s,p)=>s+p.w,0);

test('machine: starts on idle, and a new loop cross-fades in over the base fade',()=>{
  const m=mk();
  assert.deepEqual(weights(m),{idle:1});
  assert.equal(Rig.play(m,'fly'),'fly');
  run(m,Rig.FADE.base/2);
  const w=weights(m);
  assert.ok(w.idle>.3&&w.idle<.7&&w.fly>.3&&w.fly<.7,JSON.stringify(w));
  near(sumFull(m),1,1e-9,'weights add to one mid-fade');
  run(m,Rig.FADE.base);
  assert.deepEqual(weights(m),{fly:1});
  assert.deepEqual(Rig.state(m),{base:'fly',shot:null,additive:[]});
});
test('machine: a one-shot fades in, the base keeps time under it, and it hands back at its end',()=>{
  const m=mk();Rig.play(m,'fly');run(m,1);
  const flyT=Rig.pose(m)[0].t,t0=m.time;
  Rig.play(m,'roar');run(m,.5);
  assert.deepEqual(weights(m),{roar:1});
  let ev=run(m,1.6-.5-Rig.FADE.shotOut/2);
  const w=weights(m);
  assert.ok(w.roar>0&&w.roar<1&&w.fly>0,'handing back before the end: '+JSON.stringify(w));
  near(sumFull(m),1,1e-9);
  ev=ev.concat(run(m,.5));
  assert.deepEqual(ev,[{type:'end',clip:'roar'}]);
  assert.deepEqual(weights(m),{fly:1});
  const t=Rig.pose(m)[0].t;
  near(t,(flyT+m.time-t0)%2,1e-6,'fly kept running under the roar');
});
test('machine: the bomb release fires once at its time in the attack',()=>{
  const m=mk();Rig.play(m,'attack');
  const ev=run(m,2,1/30);
  assert.deepEqual(ev.map(e=>e.type),['release','end']);
  const m2=mk();Rig.play(m2,'attack');
  assert.deepEqual(run(m2,.66,1/30),[],'not before .7 s');
});
test('machine: an additive hit doesn\'t stop a run',()=>{
  const m=mk();Rig.play(m,'loco');Rig.setSpeed(m,6);run(m,1);
  const before=weights(m);
  assert.deepEqual(Object.keys(before),['run']);
  assert.equal(Rig.play(m,'hit'),'hit');
  run(m,.2);
  const w=weights(m);
  near(w.run,1,1e-9,'the run keeps its full weight');
  assert.ok(w['hit+']>.5,'hit is layered on top: '+JSON.stringify(w));
  assert.deepEqual(Rig.state(m),{base:'loco',shot:null,additive:['hit']});
  run(m,.3);
  assert.deepEqual(weights(m),{run:1},'and is gone after it ends');
});
test('machine: a big hit replaces an attack, and the interrupted attack never reports its end',()=>{
  const m=mk();Rig.play(m,'attack');run(m,.3);
  Rig.play(m,'hit_big');
  const ev=run(m,2);
  assert.deepEqual(ev,[{type:'end',clip:'hit_big'}]);
  assert.deepEqual(weights(m),{idle:1});
});
test('machine: defeat holds its last frame until a new base state',()=>{
  const m=mk();Rig.play(m,'defeat',{hold:true});
  assert.deepEqual(run(m,3),[{type:'end',clip:'defeat'}]);
  assert.deepEqual(weights(m),{defeat:1});
  near(Rig.pose(m)[0].t,1.5,1e-9,'on the last frame');
  Rig.play(m,'idle');run(m,1);
  assert.deepEqual(weights(m),{idle:1});
});
test('machine: a new base state can cut a one-shot short',()=>{
  const m=mk();Rig.play(m,'roar');run(m,.3);
  Rig.play(m,'fly');run(m,.3);
  assert.equal(Rig.state(m).shot,'roar','without cut the roar plays on over the new base');
  Rig.play(m,'walk',{cut:true});
  assert.deepEqual(run(m,1),[],'a cut one-shot reports no end');
  assert.deepEqual(weights(m),{walk:1});
});
test('machine: a clip the model lacks is refused, and remembered for one warning',()=>{
  const m=Rig.machine({clips:{idle:1},loops:['idle']});
  assert.equal(Rig.play(m,'attack'),null);Rig.play(m,'attack');
  assert.deepEqual(m.missing,['attack']);
  assert.equal(Rig.play(m,'hit_big'),null);
  assert.equal(Rig.play(m,'walk'),'idle');
});
test('machine: a model with no idle starts on its first clip',()=>{
  const m=Rig.machine({clips:{glider_fly:2,glider_spin:1.5},loops:['glider_fly']});
  assert.deepEqual(Rig.state(m).base,'glider_fly');
  run(m,5);assert.deepEqual(weights(m),{glider_fly:1},'and loops it');
});

// --- walk/run blending ---------------------------------------------------------------
test('loco: idle, walk and run blend by speed, adding up to one',()=>{
  const m=mk();
  const at=v=>Rig.locoBlend(m,v);
  assert.equal(at(0).idle,1);
  assert.equal(at(1.5).walk,1);
  assert.equal(at(6).run,1);
  const mid=at(3.75);near(mid.walk,.5,1e-9);near(mid.run,.5,1e-9);
  let last=-1;
  for(let v=0;v<=8;v+=.25){const b=at(v);near(b.idle+b.walk+b.run,1,1e-9,'at '+v);const r=b.run+b.walk*.5;assert.ok(r>=last-1e-9,'monotonic at '+v);last=r;}
});
test('loco: the stride rate is continuous, so the feet don\'t jump between walk and run',()=>{
  const m=mk(),e=1e-6;
  near(Rig.locoBlend(m,1.5-e).cps,Rig.locoBlend(m,1.5+e).cps,1e-5,'at walk speed');
  near(Rig.locoBlend(m,6-e).cps,Rig.locoBlend(m,6+e).cps,1e-5,'at run speed');
  near(Rig.locoBlend(m,1.5).cps,1/1.6,1e-9,'a full walk turns once per walk cycle');
  near(Rig.locoBlend(m,6).cps,1/.8,1e-9);
});
test('loco: walk and run share one phase, so blending them keeps their strides in step',()=>{
  const m=mk();Rig.play(m,'loco',{fade:0});Rig.setSpeed(m,3.75);run(m,.77);
  const p={};Rig.pose(m).forEach(x=>p[x.clip]=x.t);
  near(p.walk/1.6,p.run/.8,1e-9);
});

test('update rate: full rate near and in view, less far away or off screen',()=>{
  assert.equal(Rig.updateEvery(10,true),1);
  assert.equal(Rig.updateEvery(60,true),2);
  assert.ok(Rig.updateEvery(200,true)>2);
  assert.equal(Rig.updateEvery(5,false),4);
});

// --- bones -> weak spots and capsules ---------------------------------------------------------
// Column-major world matrix: rotation about y by `a`, uniform scale s, then translation.
function mat(a,s,t){const c=Math.cos(a)*s,n=Math.sin(a)*s;return[c,0,-n,0, 0,s,0,0, n,0,c,0, t[0],t[1],t[2],1];}
test('spots: a weak spot sits at its bone, offset along the bone\'s own axes in metres',()=>{
  const entry={weakSpots:[{name:'CHEST',bone:'spine',offset:[0,.1,.2],radius:.3},{name:'HEAD',bone:'nope',offset:[0,0,0],radius:.2}],
    body:[['hips','spine',.4],['hips','gone',.1]]};
  const bones={spine:mat(Math.PI/2,2.1,[1,2,3]),hips:mat(0,1,[1,1,3])};
  const s=Rig.sample(entry,b=>bones[b]||null);
  assert.equal(s.spots.length,1,'a bone the model lacks is skipped');
  const c=s.spots[0];
  // Turned 90° about y, the bone's z axis points along world +x; the 2.1 scale doesn't stretch the offset.
  near(c.x,1.2,1e-9);near(c.y,2.1,1e-9);near(c.z,3,1e-9);assert.equal(c.r,.3);assert.equal(c.name,'CHEST');assert.equal(c.bone,'spine');
  assert.deepEqual(s.capsules,[{a:{x:1,y:1,z:3},b:{x:1,y:2,z:3},r:.4,bones:['hips','spine']}]);
});
test('spots: the result is plain data, so a fight snapshot can keep it',()=>{
  const s=Rig.sample(manifest.villains.venom,()=>mat(0,1,[0,1,0]));
  assert.equal(s.spots.length,3);assert.equal(s.capsules.length,manifest.villains.venom.body.length);
  assert.deepEqual(JSON.parse(JSON.stringify(s)),s);
});
test('capsules: one can reach past its second bone, along that bone\'s axes',()=>{
  const s=Rig.sample({weakSpots:[],body:[['neck','head',.15,[0,.2,0]]]},b=>({neck:mat(0,1,[0,1.5,0]),head:mat(Math.PI/2,2,[0,1.7,0])})[b]);
  const c=s.capsules[0];near(c.b.x,0,1e-9);near(c.b.y,1.9,1e-9,'the crown, 20 cm up the head bone, unscaled');near(c.b.z,0,1e-9);
});
test('body: a ray reports the first capsule it meets, how far along it, and where',()=>{
  const caps=[{a:{x:0,y:0,z:0},b:{x:0,y:2,z:0},r:.5},{a:{x:-3,y:0,z:0},b:{x:-3,y:2,z:0},r:.5}];
  const h=Rig.rayBody({x:-10,y:1.5,z:0},{x:1,y:0,z:0},caps);
  assert.equal(h.index,1,'the nearer one');near(h.distance,6.5,1e-9);near(h.t,.75,1e-9);near(h.point.x,-3.5,1e-9);
  assert.equal(Rig.rayBody({x:-10,y:1.5,z:2},{x:1,y:0,z:0},caps),null);
  assert.equal(Rig.rayBody({x:0,y:0,z:0},{x:1,y:0,z:0},[]),null);
});
test('capsules: a ray enters the side, an end, or misses',()=>{
  const cap={a:{x:0,y:0,z:0},b:{x:0,y:2,z:0},r:.5};
  near(Rig.rayCapsule({x:-5,y:1,z:0},{x:1,y:0,z:0},cap),4.5,1e-9,'side');
  near(Rig.rayCapsule({x:0,y:10,z:0},{x:0,y:-1,z:0},cap),7.5,1e-9,'top cap');
  near(Rig.rayCapsule({x:-5,y:2.3,z:0},{x:1,y:0,z:0},cap),5-Math.sqrt(.25-.09),1e-9,'the rounded end');
  assert.equal(Rig.rayCapsule({x:-5,y:1,z:.6},{x:1,y:0,z:0},cap),null,'passes beside');
  assert.equal(Rig.rayCapsule({x:5,y:1,z:0},{x:1,y:0,z:0},cap),null,'behind the shooter');
  assert.equal(Rig.rayCapsule({x:0,y:1,z:0},{x:1,y:0,z:0},cap),0,'from inside');
  near(Rig.rayCapsule({x:-5,y:0,z:0},{x:1,y:0,z:0},{a:{x:0,y:0,z:0},b:{x:0,y:0,z:0},r:1}),4,1e-9,'a capsule of zero length is a sphere');
});
