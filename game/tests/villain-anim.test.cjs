const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),Combat=require('../js/combat.js');
const VillainAnim=require('../js/world/villain-anim.js');
const levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
const DT=1/30;
// Every clip each model has, with its length, from the built GLBs.
function clipsOf(file){
  const b=fs.readFileSync(path.join(__dirname,'../assets/models',file)),j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
  const c={};(j.animations||[]).forEach(a=>{c[a.name]=Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));});return c;
}
const CLIPS={glider:clipsOf('goblin.glb'),charge:clipsOf('rhino.glb'),leap:clipsOf('venom.glb')};
const MANIFEST=require('../assets/models/characters.json'),GOBLIN_EVENTS=MANIFEST.villains.goblin.events;
const EVENTS={glider:GOBLIN_EVENTS,charge:MANIFEST.villains.rhino.events,leap:MANIFEST.villains.venom.events};
const eyeAt=v=>({x:v.x,y:v.y+1.7,z:v.z});
function aimAt(o,p){const d=Math.hypot(p.x-o.x,p.y-o.y,p.z-o.z);return{x:(p.x-o.x)/d,y:(p.y-o.y)/d,z:(p.z-o.z)/d};}
const shotAt=(o,p)=>({origin:o,dir:aimAt(o,p),blocked:Infinity});
// A fight and its animation, run a frame at a time; every clip asked for is
// logged with the fight time it was asked for at.
function run(enc){
  const s=Fight.play(Fight.start(enc,levels)),a=VillainAnim.create(enc.kind,CLIPS[enc.kind],EVENTS[enc.kind]),log=[],speeds=[];
  const r={s,a,log,speeds,out:null,
    frame(){Fight.tick(s,DT);const o=VillainAnim.step(a,s,DT);r.out=o;o.play.forEach(([c,opts])=>log.push({c,opts,t:s.time,arriveT:s.arriveT,state:s.m.state,m:{...s.m}}));if(o.speed!==null)speeds.push([o.speed,s.m.v]);return o;},
    until(fn,max){for(let n=0;n<(max||3000)&&!fn();n++)r.frame();assert.ok(fn(),'never happened: '+fn);return r;},
    for(sec){for(let n=0;n<Math.round(sec/DT);n++)r.frame();return r;},
    clips(){return log.map(e=>e.c);}};
  return r;
}
function clearThugs(s,eye){
  for(let n=0;n<40&&s.phase==='thugs';n++){const t=s.thugs.find(t=>!t.down);Fight.tick(s,Combat.COOLDOWN);Fight.fire(s,villains,shotAt(eye,Fight.thugSphere(t)));}
}
// A stand-in body, so the tests can land hits (villain-view.js samples real ones).
function pose(s){const a=s.at;s.body={spots:[],capsules:[{a:{x:a.x,y:a.y+.9,z:a.z},b:{x:a.x,y:a.y+1.8,z:a.z},r:.3,bones:['a','b']}]};}
function hitHim(r,eye){
  pose(r.s);const w={x:r.s.at.x,y:r.s.at.y+1.35,z:r.s.at.z};
  Fight.tick(r.s,Combat.COOLDOWN);return Fight.fire(r.s,villains,shotAt(eye,w));
}

test('anim: every clip asked for is one the model has',()=>{
  for(const enc of spots.fights){
    const r=run(enc),eye=eyeAt(enc.vantage);
    if(enc.thugs)clearThugs(r.s,eye);
    r.for(12);
    for(let n=0;n<3;n++){hitHim(r,eye);r.for(1);}
    Fight.fire(r.s,villains,shotAt(eye,{x:0,y:-1e4,z:0}));r.for(2);
    while(r.s.mode==='playing'){hitHim(r,eye);r.frame();}
    r.for(1);
    for(const c of new Set(r.clips()))assert.ok(c==='loco'||c in CLIPS[enc.kind],enc.id+' asked for '+c);
    assert.equal(r.clips().at(-1),'defeat',enc.id+' should end on defeat');
  }
});
test('anim: the goblin roars as he arrives, flies, leans into turns and banks with them',()=>{
  const r=run(goblin);r.frame();
  assert.deepEqual(r.clips().slice(0,2),['fly','roar']);
  r.until(()=>r.s.phase==='villain');
  // Make him circle hard left, then right: he leans that way and banks into it.
  let lean=null;
  for(const dir of [1,-1]){
    r.s.m.dir=dir;r.for(2.5);
    const want=r.s.turnRate>0?'fly_turn_l':'fly_turn_r';
    assert.equal(r.a.base,want,'turning '+(r.s.turnRate>0?'left':'right'));
    assert.ok(Math.sign(r.out.roll)===-Math.sign(r.s.turnRate)&&Math.abs(r.out.roll)>.05,'banks into the turn: roll '+r.out.roll.toFixed(3));
    assert.ok(Math.abs(r.out.roll)<=VillainAnim.constants.BANK_MAX+1e-9);
    lean=lean||want;
  }
  const opts=r.log.filter(e=>/fly_turn/.test(e.c)).map(e=>e.opts.fade);
  assert.ok(opts.every(f=>f>=.3),'the leans cross-fade slowly');
});
test('anim: the rhino drops in, flexes, turns, winds up once, runs by speed and skids at each end',()=>{
  const r=run(rhino);r.until(()=>r.s.phase==='villain');
  const L=r.log;
  assert.equal(L[0].c,'idle');assert.equal(L[1].c,'entrance');assert.ok(L[1].arriveT<.05,'entrance at once');
  const roar=L.find(e=>e.c==='roar');
  assert.ok(Math.abs(roar.arriveT-(CLIPS.charge.entrance-.1))<.05,'roar as the drop-in ends: '+roar.arriveT);
  r.for(16);
  const seq=r.clips().filter(c=>/turn_|attack|loco|skid/.test(c));
  assert.deepEqual(seq.slice(0,5).map(c=>c.replace(/turn_[lr]/,'turn')),['turn','attack','loco','skid','turn']);
  assert.equal(r.clips().filter(c=>c==='attack').length,1,'one wind-up');
  const turns=r.log.filter(e=>/turn_/.test(e.c));
  turns.forEach(e=>assert.equal(e.c,e.m.turn>0?'turn_l':'turn_r','the turn clip turns the way he turns'));
  assert.ok(r.speeds.length>50&&r.speeds.every(([v,m])=>v===m),'the run is blended by his real speed');
  assert.ok(r.speeds.some(([v])=>v>7),'up to his charge speed');
});
test('anim: venom falls, lands, roars, then crouches, leaps and lands in time with the arc',()=>{
  const r=run(venom),eye=eyeAt(venom.vantage);clearThugs(r.s,eye);
  r.until(()=>r.s.phase==='villain');
  const L=r.log,E=Fight.constants.ENTRY,K=VillainAnim.constants;
  assert.deepEqual(L.slice(0,2).map(e=>e.c),['descent_loop','descent_start']);
  const land=L.find(e=>e.c==='descent_end');
  assert.ok(Math.abs(land.arriveT-(E-K.DROP_LEAD))<DT+1e-9,'descent_end lands as he reaches the beam: '+land.arriveT);
  assert.ok(L.findIndex(e=>e.c==='roar')>L.indexOf(land),'then he roars');
  // leap_start, slowed, reaches its take-off frame as the crouch ends.
  assert.ok(Math.abs(K.TAKEOFF/K.LEAP_SPEED-Fight.constants.CROUCH)<.02,'take-off '+K.TAKEOFF/K.LEAP_SPEED+' vs crouch '+Fight.constants.CROUCH);
  const from=L.length;r.for(10);
  const after=L.slice(from),starts=after.filter(e=>e.c==='leap_start'),lands=after.filter(e=>e.c==='land');
  assert.ok(starts.length>=4,'only '+starts.length+' leaps');
  starts.forEach(e=>{assert.equal(e.opts.speed,K.LEAP_SPEED);assert.ok(e.m.crouch>0&&!e.m.flying,'leap_start plays in the crouch');});
  lands.forEach(e=>{assert.ok(e.m.flying,'land starts just before touching down');assert.ok(e.m.dur-e.m.t<=K.LAND_LEAD+1e-9);});
  assert.ok(lands.length>=starts.length-1,'every leap lands: '+starts.length+' leaps, '+lands.length+' landings');
  assert.ok(after.filter(e=>e.c==='leap_air').length>=starts.length-1,'and flies between');
});
test('anim: a dodge plays the side it went, a hit flinches, the last one before the end staggers',()=>{
  const r=run(goblin),eye=eyeAt(goblin.vantage);r.until(()=>r.s.phase==='villain');r.for(.5);
  let n=r.log.length;
  Fight.fire(r.s,villains,shotAt(eye,{x:0,y:-1e4,z:0}));r.frame();
  const d=r.log.slice(n).map(e=>e.c);
  assert.deepEqual(d.filter(c=>/dodge/.test(c)),[r.s.dodge.side==='l'?'dodge_l':'dodge_r']);
  const clips=[];
  while(r.s.mode==='playing'){n=r.log.length;const h=hitHim(r,eye);r.frame();if(h.hit)clips.push(r.log.slice(n).map(e=>e.c).filter(c=>/hit|defeat/.test(c)));}
  assert.deepEqual(clips,Array(r.s.maxHealth/20-2).fill(['hit']).concat([['hit_big'],['defeat']]));
  const def=r.log.find(e=>e.c==='defeat');assert.equal(def.opts.hold,true,'defeat holds its last frame');
});
test('anim: when you go down, he roars over you - and time alone never ends it',()=>{
  const r=run(rhino);r.until(()=>r.s.phase==='villain');
  r.for(40);assert.equal(r.s.mode,'playing','no clock');
  Fight.hurt(r.s,1000);r.for(.2);
  assert.equal(r.s.mode,'lost');assert.equal(r.clips().at(-1),'roar');
});
test('anim: the goblin winds up a bomb with his throw, timed so it leaves his hand as the wind-up ends',()=>{
  const r=run(goblin),you={x:goblin.vantage.x,y:goblin.vantage.y,z:goblin.vantage.z,vx:0,vy:0,vz:0};
  r.until(()=>r.s.phase==='villain');
  const ctx={you,body:null,state:'ground',onScreen:true};
  const start=r.log.length;
  for(let n=0;n<30*20&&!(r.s.attack.move==='bomb'&&r.s.attack.phase==='active');n++){Fight.tick(r.s,DT,ctx);r.out=VillainAnim.step(r.a,r.s,DT);r.out.play.forEach(([c,opts])=>r.log.push({c,opts,t:r.s.time}));}
  const throws=r.log.slice(start).filter(e=>e.c==='attack');
  assert.equal(throws.length,1,'one throw for the wind-up');
  const tel=r.s.attack.d.telegraph,rel=GOBLIN_EVENTS.attack.release_seconds;
  assert.ok(Math.abs(throws[0].opts.speed*tel-rel)<1e-9,'the release frame lands at the end of the wind-up: '+throws[0].opts.speed);
});
test('anim: which way each clip squares the chest is measured, so the root can take it back out',()=>{
  const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-9,m+': '+a+' vs '+b);
  // A stance held 53 degrees to the right, and a turn of 90 degrees to the left from it.
  const idle=VillainAnim.curve([-.92,-.93,-.92,-.91],2),turn=VillainAnim.curve([-.92,-.92,-.2,.5,.65],1);
  assert.equal(idle.turning,false);assert.ok(Math.abs(idle.mean+.92)<.01,'the stance: its average');
  assert.equal(turn.turning,true,'a clip that turns the body');
  const curves={idle,turn_l:turn};
  near(VillainAnim.bodyYaw([{clip:'idle',t:.7,w:1}],curves),idle.mean,'a stance counts as its average, whatever the time');
  near(VillainAnim.bodyYaw([{clip:'turn_l',t:0,w:1}],curves),-.92,'a turn starts from its stance');
  near(VillainAnim.bodyYaw([{clip:'turn_l',t:1,w:1}],curves),.65,'and follows the whole turn');
  near(VillainAnim.bodyYaw([{clip:'turn_l',t:.625,w:1}],curves),.15,'in between samples');
  near(VillainAnim.bodyYaw([{clip:'turn_l',t:1,w:.5},{clip:'idle',t:0,w:.5}],curves),(.65+idle.mean)/2,'weighted through a cross-fade');
  near(VillainAnim.bodyYaw([{clip:'turn_l',t:1,w:1,additive:true},{clip:'other',t:0,w:1}],curves),0,'additive and unmeasured clips count for nothing');
  const round=VillainAnim.curve([3,3.1,-3.1,-3],1);
  assert.ok(round.samples.every((s,i)=>!i||Math.abs(s-round.samples[i-1])<.3),'unwrapped across 180 degrees: '+round.samples);
  assert.equal(round.turning,false);
});
test('anim: a clip that lifts the feet is lowered to follow the arc, never raised',()=>{
  const clips=['leap_air','land'];
  assert.ok(Math.abs(VillainAnim.lift([{clip:'leap_air',t:0,w:1}],clips,1.5,.17)+1.33)<1e-9);
  assert.ok(Math.abs(VillainAnim.lift([{clip:'leap_air',t:0,w:.25},{clip:'idle',t:0,w:.75}],clips,1.5,.17)+.3325)<1e-9,'weighted by the pose');
  assert.equal(VillainAnim.lift([{clip:'idle',t:0,w:1}],clips,1.5,.17),0,'not for other clips');
  assert.equal(VillainAnim.lift([{clip:'land',t:0,w:1}],clips,.1,.17),0,'never raised');
});
