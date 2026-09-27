const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const Rig=require('../js/world/rig.js'),PlayerAnim=require('../js/world/player-anim.js'),PlayerCamera=require('../js/world/player-camera.js');
const City=require('../js/world/city.js'),Player=require('../js/world/player.js'),Look=require('../js/world/look.js');
const MODELS=path.join(__dirname,'../assets/models');
const manifest=JSON.parse(fs.readFileSync(path.join(MODELS,'characters.json'),'utf8'));
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=(eps||1e-9),(msg||'')+' got '+a+', expected '+b);
function clipsOf(file){
  const b=fs.readFileSync(path.join(MODELS,file)),j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
  const c={};(j.animations||[]).forEach(a=>{c[a.name]=Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));});return c;
}
const BODY=manifest.player.spiderman,ARMS=manifest.player.spiderman_arms;
const bodyClips=Object.assign(clipsOf(BODY.file),{shoot_l:clipsOf(BODY.file).shoot});   // shoot_l is made at load (mirrors)
const armsClips=clipsOf(ARMS.file);
const bodyMachine=()=>Rig.machine({clips:bodyClips,loops:BODY.loops,speeds:BODY.speeds,events:BODY.events,layers:BODY.layers,mirrors:BODY.mirrors});
const armsMachine=()=>Rig.machine({clips:armsClips,loops:ARMS.loops,events:ARMS.events,layers:ARMS.layers,base:'fp_idle'});
const DT=1/60;

// --- Rig: layers, a start offset, mirrors (for the player's shots) ------------------------
test('layers: a layer clip plays over the base and a one-shot, on its own weight, without touching them',()=>{
  const m=armsMachine();
  Rig.play(m,'fp_run');Rig.step(m,1);
  Rig.play(m,'fp_hit');Rig.step(m,.05);
  assert.equal(Rig.play(m,'fp_shoot_r',{fade:.04}),'fp_shoot_r');
  assert.deepEqual(Rig.layers(m),{arm_r:'fp_shoot_r'});
  assert.equal(Rig.state(m).shot,'fp_hit','the one-shot under it goes on');
  Rig.step(m,.05);
  const p=Rig.pose(m),lay=p.filter(x=>x.layer),rest=p.filter(x=>!x.layer&&!x.additive);
  assert.equal(lay.length,1);assert.equal(lay[0].layer,'arm_r');near(lay[0].w,1,1e-9,'faded in');
  near(rest.reduce((s,x)=>s+x.w,0),1,1e-9,'the rest still adds up to one, the layer not counted in it');
});
test('layers: from/to play a stretch of the clip; it fades out by its end, reports end, and is gone',()=>{
  const m=bodyMachine(),ev=[];
  Rig.layer(m,'shoot',{from:1.2,to:1.95,speed:1.8,fade:.06,fadeOut:.12});
  near(m.layers[0].t,1.2);
  let t=0;
  while(m.layers.length&&t<2){ev.push(...Rig.step(m,DT));t+=DT;}
  near(t,(1.95-1.2)/1.8,DT*1.01,'lasts its stretch at its speed');
  assert.deepEqual(ev.map(e=>e.type),['release','end'],'the snap (events.shoot, 1.45 s) then the end');
  assert.equal(ev[0].layer,'upper');
});
test('layers: a new clip on a layer replaces the old; the other layer is left alone',()=>{
  const m=armsMachine();
  Rig.play(m,'fp_shoot_r');Rig.step(m,.1);
  Rig.play(m,'fp_shoot_l');Rig.step(m,.02);
  assert.deepEqual(Rig.layers(m),{arm_r:'fp_shoot_r',arm_l:'fp_shoot_l'});
  Rig.play(m,'fp_shoot_r',{fade:.05});
  assert.equal(m.layers.filter(l=>l.key==='arm_r'&&!l.gone).length,1,'one live clip per layer');
  let ended=[];for(let i=0;i<5;i++)ended.push(...Rig.step(m,.02));
  assert.ok(!ended.some(e=>e.type==='end'&&e.clip==='fp_shoot_r'),'the replaced one never reports its end');
});
test('layers: the mixer weight takes a layer\'s share of its bones out of a base weighing one',()=>{
  for(const w of [.1,.5,.8,.95]){const k=Rig.layerWeight(w);near(k/(1+k),w,1e-12);}
  assert.equal(Rig.layerWeight(0),0);assert.ok(Rig.layerWeight(1)>=1e4);
  assert.equal(Rig.layer(armsMachine(),'fp_idle'),null,'a clip with no layer is refused');
});
test('one-shots: `from` starts a one-shot part of the way in (the jump without its long crouch)',()=>{
  const m=bodyMachine();
  Rig.play(m,'jump',{from:.35});
  near(m.slots.find(s=>s.kind==='shot').t,.35);
  const ev=[];for(let i=0;i<20;i++)ev.push(...Rig.step(m,DT));
  assert.ok(ev.some(e=>e.type==='release'&&e.clip==='jump'),'the take-off (0.6 s) still comes, 0.25 s later');
});
test('mirror: left and right swap, rotations reflect as (x, -y, -z, w) and positions as (-x, y, z)',()=>{
  const out=Rig.mirror([{name:'mixamorigLeftHand.quaternion',times:[0,1],values:[.1,.2,.3,.9,.4,.5,.6,.7]},
    {name:'mixamorigRightArm.position',times:[0],values:[1,2,3]},{name:'mixamorigSpine.quaternion',times:[0],values:[.1,.2,.3,.9]}]);
  assert.deepEqual(out.map(t=>t.name),['mixamorigRightHand.quaternion','mixamorigLeftArm.position','mixamorigSpine.quaternion']);
  assert.deepEqual(out[0].values,[.1,-.2,-.3,.9,.4,-.5,-.6,.7]);
  assert.deepEqual(out[1].values,[-1,2,3]);assert.deepEqual(out[2].values,[.1,-.2,-.3,.9]);
  assert.deepEqual(out[0].times,[0,1]);
});
test('mirror: the left-handed shoot plays on the upper-body layer with the snap event; the manifest checks it',()=>{
  assert.deepEqual(BODY.mirrors,{shoot_l:'shoot'});
  const m=bodyMachine();
  assert.equal(Rig.play(m,'shoot_l'),'shoot_l');assert.deepEqual(Rig.layers(m),{upper:'shoot_l'});
  assert.equal(m.events.shoot_l.release_seconds,BODY.events.shoot.release_seconds);
  assert.equal(Rig.resolve(Object.keys(clipsOf(BODY.file)),'shoot_l'),'shoot','a model without the mirror casts right-handed');
  assert.deepEqual(Rig.check(BODY,Rig.bonesOf(BODY),['idle']).filter(w=>/mirror/.test(w)),['no clip shoot to mirror as shoot_l']);
  const bad=JSON.parse(JSON.stringify(manifest));bad.player.spiderman.mirrors={shoot_l:3};
  assert.ok(Rig.validate(bad).some(e=>/mirrors\.shoot_l/.test(e)));
});

// --- PlayerAnim: what the player's models play ----------------------------------------------
// A player stand-in: Player's fields only.
const P=(o)=>Object.assign({x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,speed:0},o);
function run(frames){   // frames: [[player, seconds, extra]] -> every state and clip asked for
  const a=PlayerAnim.create(),log=[];
  for(const [p,sec,x] of frames) for(let t=0;t<sec-1e-9;t+=DT){const o=PlayerAnim.step(a,p,DT,x);log.push(o);}
  return {a,log,states:log.map(o=>o.state).filter((x,i,l)=>i===0||l[i-1]!==x),body:log.flatMap(o=>o.body.map(c=>c[0])),arms:log.flatMap(o=>o.arms.map(c=>c[0]))};
}
test('anim: standing, walking and running by ground speed; the body blends them by speed, the arms pump from a jog',()=>{
  const r=run([[P(),.5],[P({vz:-2}),.5],[P({vz:-6}),.5],[P(),.5]]);
  assert.deepEqual(r.states,['idle','walk','run','idle']);
  assert.deepEqual(r.body,['loco'],'loco once: it blends idle and run by speed itself');
  assert.deepEqual(r.arms,['fp_idle','fp_run','fp_idle']);
  const o=PlayerAnim.step(r.a,P({vz:-6}),DT);near(o.speed,6);near(o.armSpeed,6/5.7,1e-9,'the arms keep time with the body\'s stride');
  near(PlayerAnim.step(r.a,P({vz:-20}),DT).armSpeed,1.6,1e-9,'capped');
});
test('anim: a jump starts its clip past the crouch; stepping off a kerb is not a fall; a long drop falls and lands',()=>{
  const J=PlayerAnim.constants;
  const jump=run([[P(),.2],[P({grounded:false,vy:6.4}),.1],[P({grounded:false,vy:-3}),.4],[P(),.5]]);
  assert.deepEqual(jump.states,['idle','jump','land','idle']);
  const jc=jump.log.flatMap(o=>o.body).find(c=>c[0]==='jump');assert.equal(jc[1].from,J.JUMP_FROM);
  assert.ok(jump.body.includes('fall'),'the air pose waits under the jump');
  const kerb=run([[P({vz:-6}),.2],[P({grounded:false,vy:-1,vz:-6}),.1],[P({vz:-6}),.3]]);
  assert.deepEqual(kerb.states,['run'],'0.1 s in the air is nothing');
  const drop=run([[P(),.1],[P({grounded:false,vy:-8}),.8],[P(),.1]]);
  assert.ok(drop.states.includes('fall')&&drop.states.includes('land'));
  const land=run([[P({grounded:false,vy:-8}),.8],[P({vz:-6}),.1]]).log.flatMap(o=>o.body).find(c=>c[0]==='land');
  assert.ok(land[1].speed>1,'running on out of a landing, it is only a quick dip');
});
test('anim: perched, swinging, zipping, hit and dead each have their clips, in both models',()=>{
  const r=run([[P(),.1,{perched:true}],[P({grounded:false}),.3,{swing:'r'}],[P({grounded:false}),.1,{}],[P({grounded:false}),.2,{zip:true}],
    [P(),.1,{hits:1}],[P(),.1,{hits:2,big:true}],[P(),.5,{dead:true}]]);
  for(const s of ['perch','swing','zip','dead'])assert.ok(r.states.includes(s),s);
  for(const c of ['perch','hang','hit','hit_big','death'])assert.ok(r.body.includes(c),c);
  for(const c of ['fp_swing_hold_r','fp_release_r','fp_zip','fp_hit','fp_death'])assert.ok(r.arms.includes(c),c);
  assert.equal(r.arms.filter(c=>c==='fp_death').length,1,'death once, held');
  const d=r.log.flatMap(o=>o.arms).find(c=>c[0]==='fp_death');assert.equal(d[1].hold,true);
});
test('anim: every clip it asks for is one the models have (or, for shoot_l, make)',()=>{
  const r=run([[P(),.3],[P({vz:-6}),.3],[P({grounded:false,vy:6}),.3],[P({grounded:false,vy:-9}),.6],[P(),.5],[P(),.2,{perched:true}],
    [P({grounded:false}),.3,{swing:'l'}],[P({grounded:false}),.3,{swing:'r'}],[P({grounded:false}),.2],[P(),.2,{zip:true}],[P(),.1,{hits:1}],[P(),.1,{hits:2,big:true}],[P(),.2,{dead:true}]]);
  const a=PlayerAnim.create(),shots=[];for(let i=0;i<4;i++)shots.push(PlayerAnim.shoot(a));
  const body=new Set(r.body.concat(shots.flatMap(s=>s.body.map(c=>c[0])))),arms=new Set(r.arms.concat(shots.flatMap(s=>s.arms.map(c=>c[0]))));
  for(const c of body)assert.ok(c==='loco'||c in bodyClips,'body asked for '+c);
  for(const c of arms)assert.ok(c in armsClips,'arms asked for '+c);
  // Played through real machines, nothing is refused.
  const bm=bodyMachine(),am=armsMachine();
  for(const c of body)assert.ok(Rig.play(bm,c),c);for(const c of arms)assert.ok(Rig.play(am,c),c);
  assert.deepEqual(bm.missing,[]);assert.deepEqual(am.missing,[]);
});

// --- hands ---------------------------------------------------------------------------------------
test('hands: web shots alternate, right first; each is a layer clip, so it plays over whatever he is doing',()=>{
  const a=PlayerAnim.create(),s=[1,2,3,4].map(()=>PlayerAnim.shoot(a));
  assert.deepEqual(s.map(x=>x.hand),['r','l','r','l']);
  assert.deepEqual(s.map(x=>x.arms[0][0]),['fp_shoot_r','fp_shoot_l','fp_shoot_r','fp_shoot_l']);
  assert.deepEqual(s.map(x=>x.body[0][0]),['shoot','shoot_l','shoot','shoot_l']);
  const bm=bodyMachine(),am=armsMachine();Rig.play(bm,'loco');
  s[0].body.forEach(c=>Rig.play(bm,c[0],c[1]));s[0].arms.forEach(c=>Rig.play(am,c[0],c[1]));
  assert.equal(Rig.state(bm).base,'loco');assert.equal(Rig.state(bm).shot,null);
  assert.deepEqual(Rig.layers(bm),{upper:'shoot'});assert.deepEqual(Rig.layers(am),{arm_r:'fp_shoot_r'});
  // The arms' snap (0.133 s into fp_shoot) comes quickly: the clip starts in and runs fast.
  const f=s[0].arms[0][1];assert.ok((ARMS.events.fp_shoot_r.release_seconds-f.from)/f.speed<.07);
  const b=s[0].body[0][1];assert.ok(b.from<BODY.events.shoot.release_seconds&&b.to>BODY.events.shoot.release_seconds,'the body\'s stretch holds the snap');
});
test('hands: while one hand holds a swing line, the free one shoots every time',()=>{
  const a=PlayerAnim.create();
  PlayerAnim.step(a,P({grounded:false}),DT,{swing:'r'});
  assert.deepEqual([1,2,3].map(()=>PlayerAnim.shoot(a).hand),['l','l','l']);
  PlayerAnim.step(a,P({grounded:false}),DT,{swing:'l'});
  assert.deepEqual([1,2].map(()=>PlayerAnim.shoot(a).hand),['r','r']);
  const o=PlayerAnim.step(a,P({grounded:false}),DT,{});
  assert.ok(o.arms.some(c=>c[0]==='fp_release_l'),'letting go opens that hand');
  assert.equal(PlayerAnim.hand(a),'r','then they alternate again from where they were');
});
test('facing: the body turns to where he runs, to the aim after a shot, and stays put when still',()=>{
  const a=PlayerAnim.create(),K=PlayerAnim.constants;
  a.face=0;
  for(let i=0;i<120;i++)PlayerAnim.face(a,P({vx:6}),0,DT);
  near(a.face,-Math.PI/2,1e-3,'running east (+x) faces east');
  for(let i=0;i<60;i++)PlayerAnim.face(a,P(),1,DT);
  near(a.face,-Math.PI/2,1e-3,'standing still keeps the facing');
  PlayerAnim.shoot(a);
  for(let i=0;i<Math.round(K.AIM_HOLD*.9/DT);i++)PlayerAnim.face(a,P({vx:6}),1,DT);
  near(a.face,1,.02,'faces the aim while shooting, though running east');
  for(let i=0;i<120;i++)PlayerAnim.face(a,P({vx:6}),1,DT);
  near(a.face,-Math.PI/2,1e-3,'then back to the way he runs');
  a.face=3;for(let i=0;i<5;i++)PlayerAnim.face(a,P({vx:-6*Math.sin(-3),vz:-6*Math.cos(-3)}),0,DT);
  assert.ok(Math.abs(a.face)>3,'turns the short way round, through PI');
});

// --- the camera --------------------------------------------------------------------------------
test('camera settings: first person and full motion by default; saved into ws.settings.v2 without disturbing the rest',()=>{
  assert.deepEqual(PlayerCamera.settings({}),{camera:'first',cameraMotion:'full'});
  assert.deepEqual(PlayerCamera.settings({camera:'third',cameraMotion:'reduced'}),{camera:'third',cameraMotion:'reduced'});
  assert.deepEqual(PlayerCamera.settings({camera:'side',cameraMotion:9}),{camera:'first',cameraMotion:'full'});
  const store={},ls={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);}};
  assert.deepEqual(PlayerCamera.load(ls),{camera:'first',cameraMotion:'full'});
  store['ws.settings.v2']=JSON.stringify({fov:90,lookMode:'direct'});
  PlayerCamera.save(ls,{camera:'third'});
  assert.deepEqual(JSON.parse(store['ws.settings.v2']),{fov:90,lookMode:'direct',camera:'third',cameraMotion:'full'});
  PlayerCamera.save(ls,{cameraMotion:'reduced'});
  assert.deepEqual(PlayerCamera.load(ls),{camera:'third',cameraMotion:'reduced'},'each keeps the other');
  store['ws.settings.v2']='not json';assert.deepEqual(PlayerCamera.load(ls),{camera:'first',cameraMotion:'full'});
});
test('camera: third person sits behind, above and right of the neck, and turns with the view',()=>{
  const K=PlayerCamera.constants,s=PlayerCamera.create(),p=P({yaw:0,pitch:0});
  const e=PlayerCamera.third(s,p,null,DT).eye;   // no city: nothing in the way
  near(e.z,K.BACK,1e-9,'behind (looking north, -z)');near(e.y,K.PIVOT+K.UP);near(e.x,K.SIDE,1e-9,'right is +x');
  const w=PlayerCamera.third(PlayerCamera.create(),P({yaw:Math.PI/2}),null,DT).eye;   // looking west
  near(w.x,K.BACK,1e-9);near(w.z,-K.SIDE,1e-9);
  // The crosshair's ray from it passes over his shoulder, near the pivot's line of sight.
  const d=Look.ray({yaw:0,pitch:0},{x:.5,y:.5},75,16/9);near(d.z,-1);
});
test('camera: a wall behind pulls the boom in so the camera stays in front of it; clear, it eases back out',()=>{
  const K=PlayerCamera.constants,box={x0:-10,x1:10,y0:0,y1:40,z0:1.5,z1:20};
  const city={colliders:[box]};city.query=null;
  // A stand-in for City.query: the one box.
  const orig=City.query;City.query=()=>[box];
  try{
    const s=PlayerCamera.create(),p=P({yaw:0});
    const r=PlayerCamera.third(s,p,city,DT);
    assert.ok(r.eye.z<box.z0,'in front of the wall: '+r.eye.z);
    near(r.dist,Math.max(K.NEAR,(box.z0-0)/PlayerCamera.boom(0,0).dir.z-K.PAD),.05,'stops PAD short of it');
    assert.equal(r.hide,false);
    // Backed right up against it: as close as it goes, and he is hidden.
    const q=PlayerCamera.third(PlayerCamera.create(),P({z:1.2}),city,DT);
    near(q.dist,K.NEAR);assert.equal(q.hide,true);
    // The wall gone: it comes back out gradually, not in one jump.
    City.query=()=>[];
    const d0=s.dist,d1=PlayerCamera.third(s,p,city,DT).dist;
    assert.ok(d1>d0&&d1<PlayerCamera.boom(0,0).len,'eases out');
    for(let i=0;i<300;i++)PlayerCamera.third(s,p,city,DT);
    near(s.dist,PlayerCamera.boom(0,0).len,.01);
    // ...but a wall appearing pulls it straight in.
    City.query=()=>[box];
    assert.ok(PlayerCamera.third(s,p,city,DT).eye.z<box.z0);
  }finally{City.query=orig;}
});
test('camera: looking up from a roof, the boom stops above the roof, not under it',()=>{
  const roof={x0:-20,x1:20,y0:0,y1:30,z0:-20,z1:20},orig=City.query;City.query=()=>[roof];
  try{
    const r=PlayerCamera.third(PlayerCamera.create(),P({y:30,pitch:1.2}),{},DT);
    assert.ok(r.eye.y>30,'above the roof: '+r.eye.y);
  }finally{City.query=orig;}
  // And the street itself is a floor.
  const s=PlayerCamera.third(PlayerCamera.create(),P({pitch:1.3}),null,DT);
  assert.ok(s.eye.y>0,'above the street');
});
test('camera: the pull-in maths - rays against boxes, and the shortest ray less the pad',()=>{
  const b={x0:0,x1:1,y0:0,y1:1,z0:0,z1:1};
  near(PlayerCamera.rayBox({x:-2,y:.5,z:.5},{x:1,y:0,z:0},b,10),2);
  assert.equal(PlayerCamera.rayBox({x:-2,y:.5,z:.5},{x:-1,y:0,z:0},b,10),null,'behind');
  assert.equal(PlayerCamera.rayBox({x:-2,y:.5,z:.5},{x:1,y:0,z:0},b,1.5),null,'out of reach');
  assert.equal(PlayerCamera.rayBox({x:.5,y:.5,z:.5},{x:1,y:0,z:0},b,10),null,'from inside: not in the way');
  const K=PlayerCamera.constants;
  near(PlayerCamera.allowed(3.5,[null,2,null,3]),2-K.PAD);
  near(PlayerCamera.allowed(3.5,[null,null]),3.5);
  near(PlayerCamera.allowed(3.5,[.1]),K.NEAR);
  near(PlayerCamera.ease(3,1,DT),1,0,'in at once');
  const o=PlayerCamera.ease(1,3,.1);assert.ok(o>1&&o<3);
  // On the real city: from the spawn roof looking out, nothing is in the way.
  const city=City.generate(20180907),sp=city.spawn;
  const r=PlayerCamera.third(PlayerCamera.create(),Player.create(sp),city,DT);
  near(r.dist,PlayerCamera.boom(sp.yaw,0).len,1e-6);
});
test('camera: first person bobs a little at a run and dips on landing; REDUCED keeps it still',()=>{
  const K=PlayerCamera.constants,eye={x:0,y:1.7,z:0};
  const s=PlayerCamera.create();let lo=0,hi=0,side=0;
  for(let i=0;i<120;i++){const e=PlayerCamera.first(s,P({vz:-6}),eye,DT,false,'full');lo=Math.min(lo,e.y-1.7);hi=Math.max(hi,e.y-1.7);side=Math.max(side,Math.abs(e.x));}
  assert.ok(lo<-K.BOB*.5&&lo>=-K.BOB-1e-9&&hi<=1e-9,'bob within its cap: '+lo);
  assert.ok(side>0&&side<=K.BOB_SIDE+1e-9);
  const still=PlayerCamera.first(PlayerCamera.create(),P(),eye,DT,false,'full');assert.deepEqual(still,eye,'standing, no bob');
  const d=PlayerCamera.create();PlayerCamera.first(d,P(),eye,DT,true,'full');
  let min=0;for(let i=0;i<30;i++)min=Math.min(min,PlayerCamera.first(d,P(),eye,DT,false,'full').y-1.7);
  assert.ok(min<-K.DIP*.8&&min>=-K.DIP-1e-9,'a landing dips: '+min);
  const r=PlayerCamera.create();PlayerCamera.first(r,P({vz:-6}),eye,DT,true,'reduced');
  for(let i=0;i<30;i++)assert.deepEqual(PlayerCamera.first(r,P({vz:-6}),eye,DT,false,'reduced'),eye,'REDUCED: none of it');
});
