// The Rhino and Venom hunt you (docs/PLAYER_PLAN.md, Session P8): the Rhino
// along the streets, throwing debris and ramming with a quake that grows the
// longer you stay put; Venom across the roofs and up the walls. The ways
// there (hunt.js), their moves, their clips, and the rules: never through a
// building, never stood about with you near.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),Attacks=require('../js/world/attacks.js'),Difficulty=require('../js/world/difficulty.js');
const Hunt=require('../js/world/hunt.js'),Traffic=require('../js/world/traffic.js');
const VillainAnim=require('../js/world/villain-anim.js'),SoundCues=require('../js/world/sound-cues.js'),Hud=require('../js/world/hud.js');
const Combat=require('../js/combat.js'),levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[,rhino,venom]=spots.fights;
const H=Difficulty.HARD,A=Attacks.constants,F=Fight.constants,DT=1/60;
const d3=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),d2=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function aimAt(o,p){const d=d3(o,p);return{x:(p.x-o.x)/d,y:(p.y-o.y)/d,z:(p.z-o.z)/d};}
function clipsOf(file){
  const b=fs.readFileSync(path.join(__dirname,'../assets/models',file)),j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
  const c={};(j.animations||[]).forEach(a=>{c[a.name]=Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));});return c;
}
const MANIFEST=require('../assets/models/characters.json'),CLIPS={charge:clipsOf('rhino.glb'),leap:clipsOf('venom.glb')};
const EVENTS={charge:MANIFEST.villains.rhino.events,leap:MANIFEST.villains.venom.events};
// Inside a building, at his middle (not on a roof: standing on top is fine).
const inside=p=>City.query(city,p.x,p.z,p.x,p.z).some(c=>c.y1>p.y+1&&c.y0<p.y+1.5&&p.x>c.x0+.2&&p.x<c.x1-.2&&p.z>c.z0+.2&&p.z<c.z1-.2);
function pose(s){if(!s.at){s.body=null;return;}const a=s.at;s.body={spots:[],capsules:[{a:{x:a.x,y:a.y+.9,z:a.z},b:{x:a.x,y:a.y+1.8,z:a.z},r:.35,bones:['a','b']}]};}
// A fight with you in it, as fightback.test.cjs has it: you stay where the
// test puts you; `immortal` keeps you standing so he goes on hunting.
function fightWith(enc,you,o){
  o=o||{};
  const s=Fight.play(Fight.start(enc,levels,o.diff));
  const r={s,you:Object.assign({vx:0,vy:0,vz:0},you),ev:[],state:o.state||'ground',anim:null,plays:[],
    ctx(){return{you:r.you,body:Attacks.standIn(r.you,r.state==='perch'),state:r.state,onScreen:true,city};},
    tick(){Fight.tick(s,DT,r.ctx());pose(s);if(o.immortal){s.you.hp=100;s.you.safeUntil=0;}
      r.ev.push(...Fight.drain(s).map(e=>({...e,t:s.time})));
      if(r.anim){const out=VillainAnim.step(r.anim,s,DT);out.play.forEach(([c,opts])=>r.plays.push({c,opts,t:s.time,clock:s.attack.clock,phase:s.attack.phase,move:s.attack.move,state:s.m.state,wall:!!s.m.wall}));}
      return r;},
    until(fn,max,each){for(let n=0;n<(max||60*60)&&!fn();n++){if(each)each();r.tick();}assert.ok(fn(),'never happened: '+fn);return r;},
    for(sec,each){for(let n=0;n<Math.round(sec/DT);n++){if(each)each();r.tick();}return r;},
    events(type){return r.ev.filter(e=>e.type===type);}};
  if(o.anim)r.anim=VillainAnim.create(enc.kind,CLIPS[enc.kind],EVENTS[enc.kind]);
  r.until(()=>s.phase==='villain');
  return r;
}
const RV=rhino.vantage,VV=venom.vantage;
const roofAt=(x,z)=>({x,y:Encounters.groundAt(city,x,z,400),z});

// --- the streets (hunt.js) ------------------------------------------------------------
test('streets: a node at every junction off the park, and every way along them clear of the buildings',()=>{
  const g=Hunt.roads(city),L=city.layout;
  assert.equal(g.nodes.length,(L.BLOCKS_X+1)*(L.BLOCKS_Z+1)-2*5,'junctions (the park has 2 x 5 inside it)');
  const P=City.PARK_RECT;
  g.nodes.forEach(n=>assert.ok(!(n.x>P.x0&&n.x<P.x1&&n.z>P.z0&&n.z<P.z1),'a junction in the park'));
  const places=[{x:rhino.path.x,z:216},{x:0,z:0},{x:300,z:214},{x:-100,z:-300},{x:250,z:400},{x:-560,z:-500},{x:RV.x,z:RV.z}];
  let n=0;
  for(const a of places)for(const b of places){
    if(a===b)continue;
    const pts=Hunt.route(g,a,b);let at=Hunt.onRoad(g,a)?a:Hunt.snap(g,a);
    assert.ok(Hunt.onRoad(g,at));
    for(const q of pts){
      assert.ok(Hunt.share(g,at,q),'a leg off the roads');
      const k=Math.ceil(d2(at,q)/.5);
      for(let i=0;i<=k;i++){const x=at.x+(q.x-at.x)*i/k,z=at.z+(q.z-at.z)*i/k;assert.ok(!Attacks.blocked(city,x,z,0),'a building in the way at '+x.toFixed(1)+','+z.toFixed(1));}
      at=q;n++;
    }
    const end=Hunt.snap(g,b);assert.ok(d2(pts[pts.length-1],end)<1e-9,'it ends by you');
    // Round the grid, not the long way round: within the park's detour of going straight along the streets.
    assert.ok(Hunt.length(a,pts)<=Math.abs(a.x-b.x)+Math.abs(a.z-b.z)+2*(P.z1-P.z0)+60,'a long way round');
  }
  assert.ok(n>60);
});
test('streets: the nearest spot to you is on a road, off the pavement\'s far side (the buildings stand back from it)',()=>{
  const g=Hunt.roads(city);
  for(const p of [roofAt(RV.x-10,RV.z),{x:VV.x,y:VV.y,z:VV.z},{x:0,y:0,z:0}]){
    const q=Hunt.snap(g,p);assert.ok(Hunt.onRoad(g,q));
    assert.ok(!Attacks.blocked(city,q.x,q.z,0),'snapped into a building');
  }
});

// --- the rhino ----------------------------------------------------------------------
test('rhino: he leaves his avenue and follows you along the streets at a jog - never through a building',()=>{
  const far={x:-250,y:0,z:-100},r=fightWith(rhino,far,{immortal:true});
  const d0=d2(r.s.at,far);let top=0;
  r.for(20,()=>{assert.ok(!inside(r.s.at),'inside a building at '+JSON.stringify(r.s.at));if(r.s.m.state==='hunt')top=Math.max(top,r.s.m.v);});
  assert.ok(r.s.m.free&&r.s.m.hunting,'still on his patrol');
  assert.ok(Math.abs(top-F.HUNT_V)<1e-6,'his jog '+top);
  assert.ok(d0-d2(r.s.at,far)>60,'he hardly came after you: '+(d0-d2(r.s.at,far)).toFixed(1)+' m');
  assert.ok(Hunt.onRoad(Hunt.roads(city),r.s.at),'off the streets');
});
test('rhino: he charges you on the street only with a clear line - round a corner he comes for you first',()=>{
  // Round the corner from his avenue, down a street: no line at first.
  const g=Hunt.roads(city),you={x:-420,y:0,z:Hunt.snap(g,{x:-420,z:180}).z};
  const r=fightWith(rhino,you,{immortal:true});
  r.until(()=>r.events('telegraph').length>0,60*20);
  const t=r.events('telegraph')[0];
  assert.equal(t.move,'charge');
  const s=Fight.start(rhino,levels);   // (the clear-line sum, from where he wound up)
  assert.ok(Attacks.clearRun(city,t.at,{x:you.x-(you.x-t.at.x)*.1,z:you.z-(you.z-t.at.z)*.1},0,null),'he charged with a building in the way');
  assert.ok(d2(t.at,{x:rhino.path.x,z:216})>5,'he never left his avenue');
});
test('rhino: up high he tears up debris and throws it - a longer wind-up, his hands on it early, an arc at you with a lead, a blast',()=>{
  // On a roof across the avenue, moving: he throws (rams too, but wait for a throw).
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z},{immortal:true});
  r.until(()=>r.s.attack.phase==='telegraph'&&r.s.attack.move==='throw',60*30);
  const a=r.s.attack,t0=r.s.time;
  assert.ok(Math.abs(Attacks.windup(a)-(H.telegraph+A.THROW_TELE))<1e-9,'the throw\'s wind-up');
  assert.equal(r.s.m.state,'heave');
  r.until(()=>r.events('grab').length>0);
  assert.ok(Math.abs(r.s.time-t0-Attacks.windup(a)*A.GRAB_AT)<DT*1.5,'he has it in his hands GRAB_AT into the wind-up');
  assert.ok(a.held);
  r.you.vx=3;                                   // moving along the roof as he lets go
  r.until(()=>r.events('throw').length>0);
  const th=r.events('throw')[0],b=r.s.bombs.find(q=>q.id===th.id);
  assert.ok(th.debris&&b&&b.kind==='debris'&&b.r===A.DEBRIS_R,'debris in the air');
  assert.ok(b.to.x>r.you.x+.5,'it leads you');
  assert.ok(!a.held);r.you.vx=0;
  assert.equal(r.s.m.state,'rest','he stands through the throw');
  r.until(()=>r.events('blast').some(e=>e.id===th.id),60*3);
  assert.ok(r.events('blast').find(e=>e.id===th.id).debris);
});
test('rhino: a web shoots his debris to pieces in the air - no damage, not a shot at him',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z});
  r.until(()=>r.events('throw').length>0,60*30);
  const id=r.events('throw')[0].id,b=r.s.bombs.find(q=>q.id===id),eye={x:r.you.x,y:r.you.y+1.7,z:r.you.z};
  Fight.tick(r.s,Combat.COOLDOWN*0);r.s.cooldownRemaining=0;
  const hits=r.s.hits,hp=r.s.you.hp;
  assert.equal(Fight.aimBomb(r.s,{origin:eye,dir:aimAt(eye,b),blocked:Infinity}),id,'aimed at it');
  assert.ok(Fight.shootBomb(r.s,id,0).accepted);
  r.tick();
  const bl=r.events('blast').find(e=>e.id===id);assert.ok(bl&&bl.why==='shot'&&bl.damage===0);
  assert.equal(r.s.you.hp,hp);assert.equal(r.s.hits,hits);
});
test('rhino: staggered while he heaves, he drops it - nothing is thrown',()=>{
  const LONG=Object.assign(Difficulty.get('HARD'),{telegraph:2});
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z},{diff:LONG,immortal:true});
  r.until(()=>r.s.attack.phase==='telegraph'&&r.s.attack.move==='throw'&&r.s.attack.held,60*40);
  const eye={x:r.you.x,y:r.you.y+1.7,z:r.you.z};
  for(let k=0;k<H.stagger;k++){r.s.cooldownRemaining=0;Fight.fire(r.s,villains,{origin:eye,dir:aimAt(eye,{x:r.s.at.x,y:r.s.at.y+1.3,z:r.s.at.z}),blocked:Infinity});}
  r.tick();
  assert.equal(r.events('stagger').length,1);assert.equal(r.events('drop').length,1);assert.ok(!r.s.attack.held);
  const n=r.events('throw').length;r.for(1);assert.equal(r.events('throw').length,n,'he threw it anyway');
});
test('rhino: the longer you stay on the building, the further his quake reaches - and he rams it every other attack',()=>{
  // The reach: QUAKE_R, growing QUAKE_GROW a second, capped.
  assert.equal(Attacks.quakeReach(0),A.QUAKE_R);
  assert.equal(Attacks.quakeReach(4),A.QUAKE_R+4*A.QUAKE_GROW);
  assert.equal(Attacks.quakeReach(1e3),A.QUAKE_R+A.QUAKE_GROW_MAX);
  assert.equal(Attacks.quakeDamage(A.QUAKE_R+5,H),0);assert.ok(Attacks.quakeDamage(A.QUAKE_R+5,H,A.QUAKE_R+6)>0,'the grown reach hurts further off');
  // Stood on his roof: the rings grow, and a throw is never followed by a throw.
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z},{immortal:true}),rams=[];
  r.for(30,()=>{if(r.s.attack.phase==='telegraph'&&r.s.attack.t===0&&r.s.attack.move==='ram')rams.push(r.s.attack.zone.r);});
  const seq=r.events('telegraph').map(e=>e.move);
  assert.ok(rams.length>=3,'rams: '+seq.join(' '));
  assert.ok(rams[rams.length-1]>rams[0]&&rams[rams.length-1]<=A.QUAKE_R+A.QUAKE_GROW_MAX,'the rings '+rams.join(' '));
  for(let i=1;i<seq.length;i++)if(r.s.stay.t>F.STAY_T+30)assert.ok(!(seq[i]==='throw'&&seq[i-1]==='throw'));
  assert.ok(seq.includes('throw'),'he never threw: '+seq.join(' '));
  // Step off onto another building and it starts again.
  const other=city.buildings.find(b=>!b.filler&&b.tiers.length===1&&b.tiers[0]!==Attacks.under(city,r.you)&&d2({x:(b.x0+b.x1)/2,z:(b.z0+b.z1)/2},RV)<60);
  Object.assign(r.you,roofAt((other.x0+other.x1)/2,(other.z0+other.z1)/2));r.tick();
  assert.ok(r.s.stay.t<DT*2,'the time on the building carried over');
});
test('rhino: within 80 m he is never stood about for more than 2 s - on the street, on a roof, on a tall roof, in the air',()=>{
  const tall=city.buildings.filter(b=>!b.filler&&b.tiers.length===1&&d2({x:(b.x0+b.x1)/2,z:(b.z0+b.z1)/2},{x:rhino.path.x,z:216})<80).sort((p,q)=>q.tiers[0].y1-p.tiers[0].y1)[0];
  const cases=[[{x:-492,y:0,z:216},'ground'],[{x:RV.x,y:RV.y,z:RV.z},'ground'],[roofAt((tall.x0+tall.x1)/2,(tall.z0+tall.z1)/2),'ground'],[{x:-470,y:12,z:260},'swing']];
  for(const [you,state] of cases){
    const r=fightWith(rhino,you,{immortal:true,state});
    r.for(25,()=>assert.ok(!inside(r.s.at),'inside a building'));
    assert.ok(r.s.idleMost<=2,'stood about '+r.s.idleMost.toFixed(2)+' s with you at '+JSON.stringify(you)+' ('+state+')');
    assert.ok(r.events('telegraph').length>=4,'hardly attacked: '+r.events('telegraph').map(e=>e.move).join(' '));
  }
});

// --- venom --------------------------------------------------------------------------
test('venom: within HUNT_R he never waits on his beams - he leaves them at once and comes to you across the street',()=>{
  const you={x:250,y:0,z:160},r=fightWith(venom,you,{immortal:true});
  assert.ok(d2(r.s.at,you)<=F.HUNT_R);
  let left=null;
  r.until(()=>d2(r.s.at,you)<=Hunt.constants.NEAR+.5&&!r.s.m.flying,60*25,()=>{
    if(left===null&&r.s.m.flying&&r.s.m.hopping)left=r.s.time;
    assert.ok(!(r.s.m.flying&&r.s.m.hopping&&inside(r.s.at)),'a hop went through a building');
  });
  assert.ok(left!==null,'he never hopped');
  assert.ok(r.s.idleMost<1,'waited '+r.s.idleMost.toFixed(2)+' s');
});
test('venom: every hop he makes is along a clear arc, and never lands on top of you',()=>{
  const you={x:250,y:0,z:160},r=fightWith(venom,you,{immortal:true});let hops=0,was=false;
  r.for(15,()=>{
    if(r.s.m.flying&&!was&&r.s.m.hopping){hops++;const to=r.s.m.dest||venom.path.perches[r.s.m.to];
      assert.ok(Attacks.arcClear(city,r.s.m.from,to),'a hop through something');
      assert.ok(d3(to,you)>=A.POUNCE_GAP-.02,'on top of you');}
    was=r.s.m.flying;});
  assert.ok(hops>=3,'hops: '+hops);
});
test('venom: you up on a roof - he leaps onto its wall, faces into it, climbs it, and comes over the top at you',()=>{
  const you=roofAt(335,155),r=fightWith(venom,you,{immortal:true,anim:true});
  r.until(()=>r.s.m.wall&&!r.s.m.flying,60*20);
  const w=r.s.m.wall;
  assert.ok(Math.abs(w.nx)+Math.abs(w.nz)===1,'a wall along the grid');
  r.tick();
  assert.ok(Math.abs(Math.atan2(Math.sin(r.s.face-Hunt.wallYaw(w)),Math.cos(r.s.face-Hunt.wallYaw(w))))<.3,'facing into the wall');
  // His root is WALL_OFF off it, outside the building.
  const qx=Math.max(w.box.x0,Math.min(r.s.at.x,w.box.x1)),qz=Math.max(w.box.z0,Math.min(r.s.at.z,w.box.z1));
  assert.ok(Math.abs(Math.hypot(r.s.at.x-qx,r.s.at.z-qz)-Hunt.constants.WALL_OFF)<.01);
  r.until(()=>r.s.m.wall&&r.s.m.wall.phase==='climb');
  const y0=r.s.at.y;r.for(.5);
  if(r.s.m.wall&&r.s.attack.phase!=='telegraph'&&r.s.attack.phase!=='active')assert.ok(Math.abs(r.s.at.y-y0-F.CLIMB_V*.5)<.2||r.s.at.y>=w.top-Hunt.constants.TOP_REACH-1e-6,'climbing '+(r.s.at.y-y0).toFixed(2));
  r.until(()=>!r.s.m.wall&&!r.s.m.flying&&r.s.at.y>=you.y-.3,60*15);
  assert.ok(d2(r.s.at,you)<20,'over the top, by you');
  // The clips: crawl_idle as he takes hold, crawl_move up it (sped to his climb).
  assert.ok(r.plays.some(p=>p.c==='crawl_idle'&&p.wall),'no crawl_idle');
  const cm=r.plays.find(p=>p.c==='crawl_move');assert.ok(cm&&Math.abs(cm.opts.speed-F.CLIMB_V/VillainAnim.constants.CRAWL_V)<1e-9,'no crawl_move');
  for(const p of r.plays)assert.ok(p.c==='loco'||p.c in CLIPS.leap,'no clip '+p.c);
});
test('venom: from a wall he pounces at you (cling_to_jump as he pushes off) and lashes, looking back at you as he winds up',()=>{
  const r=fightWith(venom,{x:0,y:0,z:0},{anim:true,immortal:true});
  // Put him on the north wall of the tower north of the site, you on the street below him.
  const c=City.query(city,310,270,315,275).filter(b=>b.y0<.5&&b.y1>50)[0];
  const w=Hunt.wallOf(city,c,{x:(c.x0+c.x1)/2,y:0,z:c.z0-6});
  Object.assign(r.s.m,{wall:Object.assign(w,{y:6,phase:'climb',t:1,check:99}),flying:false,crouch:0,spot:null,dash:null,rest:0});
  Object.assign(r.you,{x:w.x+w.nx*9,y:0,z:w.z+w.nz*9});
  r.s.attack.moves=['pounce'];r.s.attack.phase='wait';r.s.attack.wait=99;r.s.attack.quiet=-99;
  r.for(.5);r.s.m.wall.y=6;                 // (he takes hold and turns to the wall)
  r.s.attack.wait=0;
  r.until(()=>r.s.attack.phase==='telegraph',60*5);
  r.tick();assert.ok(Math.abs(Math.atan2(Math.sin(r.s.face-Hunt.wallYaw(w)),Math.cos(r.s.face-Hunt.wallYaw(w))))<.05,'he turned off the wall to wind up');
  assert.ok(r.plays.some(p=>p.c==='cling_idle'),'no cling_idle');
  r.until(()=>r.s.m.flying&&r.s.m.pounce,60*3);
  assert.ok(d3(r.s.m.from,w)<.01,'from the wall');assert.ok(!r.s.m.wall);
  assert.ok(r.plays.some(p=>p.c==='cling_to_jump'&&p.phase==='telegraph'),'no push off the wall');
  r.until(()=>r.events('slam').length>0,60*3);
  assert.ok(d2(r.s.at,r.you)<=A.POUNCE_GAP+.01);
  // The lash, from his chest out off the wall.
  const q=fightWith(venom,{x:0,y:0,z:0},{immortal:true,state:'swing'});
  Object.assign(q.s.m,{wall:Object.assign(Hunt.wallOf(city,c,{x:(c.x0+c.x1)/2,y:0,z:c.z0-6}),{y:6,phase:'climb',t:1,check:99}),flying:false,crouch:0,spot:null,dash:null,rest:0});
  Object.assign(q.you,{x:w.x+w.nx*10,y:6.5,z:w.z+w.nz*10});
  q.s.attack.moves=['lash'];q.s.attack.wait=0;
  q.until(()=>q.events('lash').length>0,60*5);
  const L=q.events('lash')[0];assert.ok((L.at.x-w.x)*w.nx+(L.at.z-w.z)*w.nz>-.4,'the tentacle came out of the wall');
});
test('venom: a combo\'s first swipe lunges in at you - back off a step in the wind-up and it still lands; he never lunges into anything',()=>{
  const r=fightWith(venom,{x:250,y:0,z:160},{immortal:true});
  r.until(()=>r.s.attack.phase==='telegraph'&&r.s.attack.move==='combo',60*30);
  const at0={...r.s.at},away={x:r.you.x-r.s.at.x,z:r.you.z-r.s.at.z},l=Math.hypot(away.x,away.z);
  r.you.x+=away.x/l*1;r.you.z+=away.z/l*1;          // a step back from him
  const n=r.events('swipe').length;r.until(()=>r.events('swipe').length>n,60*2);
  const moved=d2(r.s.at,at0);
  assert.ok(moved>.2&&moved<=A.LUNGE+1e-6,'lunged '+moved.toFixed(2));
  assert.ok(r.events('hurt').some(e=>e.kind==='swipe'&&e.t===r.events('swipe')[n].t),'the first swipe missed');
  assert.ok(!inside(r.s.at)&&Attacks.room(city,r.s.at.x,r.s.at.y,r.s.at.z,.45));
});
test('venom: the lash reaches further (P8), and he reaches for it more at range',()=>{
  assert.ok(A.LASH_REACH>=16);
  assert.ok(A.PREFER.leap.ground.lash>A.PREFER.leap.ground.pounce);
  const a=Attacks.create('leap',H,5);let lash=0;
  for(let n=0;n<200;n++)if(Attacks.pick(a,'ground',n/200,['lash','pounce'])==='lash')lash++;
  assert.ok(lash>100,'lash '+lash+'/200');
});
test('venom: out past HUNT_R, off his beams, he makes his way back to them',()=>{
  const r=fightWith(venom,{x:250,y:0,z:160},{immortal:true});
  r.until(()=>r.s.m.spot&&d2(r.s.at,venom.path.perches[0])>20,60*20);
  Object.assign(r.you,{x:VV.x-F.HUNT_R-60,y:0,z:VV.z});
  r.until(()=>!r.s.m.spot&&!r.s.m.flying&&!r.s.m.wall,60*30);
  assert.ok(venom.path.perches[r.s.m.at]&&d3(r.s.at,venom.path.perches[r.s.m.at])<.01,'not on a beam');
});

// --- the clips, sounds, HUD and cards ---------------------------------------------
test('anim: the rhino\'s throw clip spans the wind-up - its grab GRAB_AT in, its release at the end - and setting off cuts it',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z},{anim:true,immortal:true});
  r.until(()=>r.plays.some(p=>p.c==='throw'),60*30);
  const p=r.plays.find(q=>q.c==='throw'),e=EVENTS.charge.throw,tel=r.s.attack.tele;
  assert.ok(Math.abs((e.grab_seconds-p.opts.from)/p.opts.speed-A.GRAB_AT*tel)<1e-6,'the grab lands GRAB_AT in');
  assert.ok(Math.abs((e.release_seconds-p.opts.from)/p.opts.speed-tel)<1e-6,'the release at the strike');
  assert.ok(e.release_seconds<CLIPS.charge.throw&&e.grab_seconds<e.release_seconds);
  r.until(()=>r.plays.some(q=>q.c==='loco'&&q.t>p.t),60*5);
  assert.equal(r.plays.find(q=>q.c==='loco'&&q.t>p.t).opts.cut,true,'the follow-through slid along with him');
  for(const q of r.plays)assert.ok(q.c==='loco'||q.c in CLIPS.charge,'no clip '+q.c);
});
test('sounds and HUD: the heave grunts, a push off a wall whooshes, and a throw\'s wind-up warns you',()=>{
  const f={at:{x:0,y:0,z:0},mode:'playing',vel:{x:0,z:0}};
  assert.equal(SoundCues.step(SoundCues.create('charge'),f,[['throw',{}]],null,DT).cues[0].name,'grunt');
  assert.equal(SoundCues.step(SoundCues.create('leap'),f,[['cling_to_jump',{}]],null,DT).cues[0].name,'whoosh');
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z});
  r.until(()=>r.s.attack.phase==='telegraph'&&r.s.attack.move==='throw',60*30);
  const st=Hud.status({mode:'fight',fight:r.s,enc:rhino,villain:{name:'RHINO'},damage:20}).right;
  assert.equal(st.warn,true);assert.match(st.text,/throwing/);
});
test('traffic: a car he picks up leaves the traffic until the fight is over',()=>{
  const sim=Traffic.create(city),eye={x:0,y:1,z:0},out=[];
  const n=Traffic.near(sim,'cars',eye,{range:200},0,out),car=out[0].item;
  assert.ok(n>0&&Traffic.hideCar(sim,car));
  const again=[];Traffic.near(sim,'cars',eye,{range:200},0,again);
  assert.ok(!again.some(e=>e.item===car),'still in the traffic');assert.equal(again.length,n-1);
  Traffic.clear(sim,null);const back=[];Traffic.near(sim,'cars',eye,{range:200},0,back);assert.ok(back.some(e=>e.item===car));
});
test('intro cards: they hunt you - the rhino through the streets, throwing; venom over the roofs and up the walls',()=>{
  assert.match(rhino.intro,/hunts you/);assert.match(rhino.intro,/throws/);assert.match(rhino.intro,/grows/);
  assert.match(venom.intro,/climbs walls/);
  for(const e of [rhino,venom]){assert.match(e.intro,/out to kill you/);assert.match(e.intro,/No clock/);}
});
