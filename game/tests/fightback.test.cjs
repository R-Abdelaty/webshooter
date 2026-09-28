// The Rhino and Venom fight back (docs/PLAYER_PLAN.md, Session P5): each
// villain's attack state machine, the ram's quake and its area, the dazed
// double-damage window, staggers, fairness, and both fights won and lost.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),Attacks=require('../js/world/attacks.js'),Difficulty=require('../js/world/difficulty.js');
const VillainAnim=require('../js/world/villain-anim.js'),SoundCues=require('../js/world/sound-cues.js'),Hud=require('../js/world/hud.js');
const Combat=require('../js/combat.js'),levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
const H=Difficulty.HARD,A=Attacks.constants,DT=1/60;
const d3=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),d2=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function aimAt(o,p){const d=d3(o,p);return{x:(p.x-o.x)/d,y:(p.y-o.y)/d,z:(p.z-o.z)/d};}
function clipsOf(file){
  const b=fs.readFileSync(path.join(__dirname,'../assets/models',file)),j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
  const c={};(j.animations||[]).forEach(a=>{c[a.name]=Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));});return c;
}
const MANIFEST=require('../assets/models/characters.json'),CLIPS={charge:clipsOf('rhino.glb'),leap:clipsOf('venom.glb')};
const EVENTS={charge:MANIFEST.villains.rhino.events,leap:MANIFEST.villains.venom.events};

// A fight with you in it, standing (or hanging) where the test puts you, a
// stand-in body round you; every event logged with the fight time, and
// optionally the villain's animation run alongside.
function fightWith(enc,you,o){
  o=o||{};
  const s=Fight.play(Fight.start(enc,levels,o.diff));
  const r={s,you:Object.assign({vx:0,vy:0,vz:0},you),ev:[],state:o.state||'ground',onScreen:true,anchor:null,anim:null,plays:[],
    ctx(){return{you:r.you,body:Attacks.standIn(r.you,r.state==='perch'),state:r.state,onScreen:r.onScreen,city,anchor:r.anchor};},
    tick(dt){
      Fight.tick(s,dt||DT,r.ctx());pose(s);
      r.ev.push(...Fight.drain(s).map(e=>({...e,t:s.time})));
      if(r.anim){const out=VillainAnim.step(r.anim,s,dt||DT);out.play.forEach(([c,opts])=>r.plays.push({c,opts,t:s.time,clock:s.attack.clock,phase:s.attack.phase,move:s.attack.move,state:s.m.state}));}
      return r;},
    until(fn,max,each){for(let n=0;n<(max||60*60)&&!fn();n++){if(each)each();r.tick();}assert.ok(fn(),'never happened: '+fn);return r;},
    for(sec,each){for(let n=0;n<Math.round(sec/DT);n++){if(each)each();r.tick();}return r;},
    events(type){return r.ev.filter(e=>e.type===type);},
    shoot(){Fight.tick(s,0);pose(s);const eye={x:r.you.x,y:r.you.y+1.7,z:r.you.z},m={x:s.at.x,y:s.at.y+1.3,z:s.at.z};
      return Fight.fire(s,villains,{origin:eye,dir:aimAt(eye,m),blocked:Infinity});}};
  if(o.anim)r.anim=VillainAnim.create(enc.kind,CLIPS[enc.kind],EVENTS[enc.kind]);
  r.until(()=>s.phase==='villain');
  return r;
}
// A body for the villain where it stands, for shots (villain-view.js samples real ones).
function pose(s){if(!s.at){s.body=null;return;}const a=s.at;s.body={spots:[],capsules:[{a:{x:a.x,y:a.y+.9,z:a.z},b:{x:a.x,y:a.y+1.8,z:a.z},r:.35,bones:['a','b']}]};}
function roof(x,z){return{x,y:Encounters.groundAt(city,x,z,300),z};}
const RV=rhino.vantage,VV=venom.vantage;
const onStreet={x:-492,y:0,z:216};                 // down on the Rhino's avenue
const inside=(p,pad)=>City.query(city,p.x,p.z,p.x,p.z).some(c=>c.y1>1&&c.y0<2&&p.x>c.x0+(pad||0)&&p.x<c.x1-(pad||0)&&p.z>c.z0+(pad||0)&&p.z<c.z1-(pad||0));

// --- the framework's additions ------------------------------------------------------
test('framework: only the moves open to him are picked, and with none he waits; a long move is followed by a breather',()=>{
  const a=Attacks.create('leap',H,3);a.wait=0;
  for(let n=0;n<50;n++){const u=n/50;assert.equal(Attacks.pick(a,'ground',u,['lash']),'lash');assert.ok(['lash','pounce'].includes(Attacks.pick(a,'ground',u,['lash','pounce'])));}
  assert.equal(Attacks.pick(a,'swing',.5,[]),null);
  // On a line Venom has only the lash (the air weights), and never three the same in a row - unless it's all there is.
  a.twice=true;a.last='lash';assert.equal(Attacks.pick(a,'swing',.9,['lash']),'lash');
  const b=Attacks.create('charge',H,1);
  let ev=[];for(let n=0;n<600;n++)ev.push(...Attacks.step(b,DT,{onScreen:true,allow:[]}));
  assert.deepEqual(ev,[],'attacked with nothing open to him');
  ev=Attacks.step(b,DT,{onScreen:true,allow:['charge']});assert.deepEqual(ev.map(e=>e.type+':'+e.move),['telegraph:charge'],'the moment one opens, it comes');
  // A charge's strike lasts until the fight says it's over.
  for(let n=0;n<60*5;n++)Attacks.step(b,DT,{onScreen:true});
  assert.equal(b.phase,'active');assert.equal(Attacks.activeFor('charge'),null);
  assert.equal(Attacks.finish(b,2),true);assert.equal(b.phase,'recover');
  for(let n=0;n<Math.round(1.9/DT);n++)Attacks.step(b,DT,{onScreen:true});assert.equal(b.phase,'recover','the rest it was given');
  for(let n=0;n<12&&b.phase!=='wait';n++)Attacks.step(b,DT,{onScreen:true});assert.equal(b.phase,'wait');
  assert.ok(b.wait>=H.breather-DT,'no breather: '+b.wait);
});

// --- the rhino ----------------------------------------------------------------------
test('rhino: you on the street - a wind-up facing you, then a straight charge that runs you over and skids on past',()=>{
  const r=fightWith(rhino,onStreet);
  r.until(()=>r.s.attack.phase==='telegraph');
  assert.equal(r.s.attack.move,'charge');assert.equal(r.s.m.state,'brace');
  const t0=r.s.time;r.for(.6);
  assert.ok(r.s.m.v<.5,'he pulls up for the wind-up');
  const toYou=Math.atan2(r.you.x-r.s.at.x,r.you.z-r.s.at.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(r.s.face-toYou),Math.cos(r.s.face-toYou)))<.2,'he faces you as he winds up');
  r.until(()=>r.s.m.state==='charge');
  assert.ok(Math.abs(r.s.time-t0-H.telegraph)<DT*1.5,'the wind-up is HARD\'s');
  r.until(()=>r.events('hurt').length>0,60*4);
  const h=r.events('hurt')[0];
  assert.equal(h.kind,'charge');assert.equal(h.damage,Attacks.damage(A.CHARGE_SHARE,H));assert.ok(h.big&&h.knock,'heavy, and off a line');
  assert.ok(h.push&&Math.hypot(h.push.x,h.push.z)>=A.KNOCK_V-1e-6&&h.push.y>0,'it throws you');
  r.until(()=>r.s.m.state==='overrun');
  const past=(r.s.m.x-r.you.x)*r.s.m.hx+(r.s.m.z-r.you.z)*r.s.m.hz;assert.ok(past>=0,'he skids on past you');
  r.until(()=>r.s.m.state==='rest');assert.equal(r.s.attack.phase,'recover');assert.equal(r.s.m.v,0);
  // Then back to his avenue and his patrol.
  r.until(()=>!r.s.m.free,60*10);assert.equal(r.s.m.state,'turn');
  assert.ok(Math.abs(r.s.at.x-rhino.path.x)<=rhino.path.lane+1e-6&&r.s.at.z>=rhino.path.z0-1e-6&&r.s.at.z<=rhino.path.z1+1e-6);
});
test('rhino: step out of the charge\'s line as it comes and it misses',()=>{
  const r=fightWith(rhino,onStreet);
  r.until(()=>r.s.m.state==='charge');
  const hp=r.s.you.hp;r.you.z+=7;                      // sidestep as he sets off
  r.until(()=>r.s.m.state==='rest'||r.s.m.state==='stun',60*6);
  assert.equal(r.s.you.hp,hp,'it hit you out of its line');
});
test('rhino: a charge that runs into a wall leaves him dazed - and never inside the building',()=>{
  // Against the wall of the building across the pavement: you step aside, he carries on into it.
  const r=fightWith(rhino,{x:-501.2,y:.15,z:216});
  r.until(()=>r.s.m.state==='charge');r.you.z+=7;
  r.until(()=>r.s.m.state==='stun',60*6,()=>assert.ok(!inside(r.s.at),'inside a building at '+JSON.stringify(r.s.at)));
  assert.ok(r.events('crash').length===1&&!r.events('quake').length,'a crash, not a ram');
  assert.ok(Fight.dazed(r.s));assert.ok(Math.abs(r.s.dazedUntil-r.s.time-H.dazed)<1e-9);
  assert.equal(r.s.attack.phase,'recover');
  assert.ok(!inside(r.s.at),'he stopped inside it');
});
test('rhino: you up on his roof - he rams the building under you, a ring shows the quake\'s reach, and it hurts',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z});
  r.until(()=>r.s.attack.phase==='telegraph');
  const a=r.s.attack,box=Attacks.under(city,r.you);
  assert.equal(a.move,'ram');assert.equal(a.box,box,'the building under you');
  assert.ok(a.zone&&a.zone.r===A.QUAKE_R&&a.zone.clip,'the ring');
  assert.ok(Math.abs(a.zone.y-box.y1)<1e-9,'on its roof');
  r.until(()=>r.events('quake').length>0,60*6);
  const q=r.events('quake')[0],h=r.events('hurt')[0];
  assert.ok(h&&h.kind==='quake'&&Math.abs(h.t-q.t)<1e-9,'the quake hurt you');
  assert.equal(h.damage,Attacks.quakeDamage(d2(r.you,a.wall),H));
  assert.equal(r.s.m.state,'stun');assert.ok(Fight.dazed(r.s),'dazed after a ram');
  assert.ok(!inside(r.s.at),'he went into the building');
  assert.ok(d2(r.s.at,a.wall)<=A.RHINO_R+.3,'he stopped at its wall');
});
test('rhino: the quake\'s area - that building, near where he hit, standing on it or hanging from it',()=>{
  // The falloff.
  assert.equal(Attacks.quakeDamage(0,H),H.damage[1]);assert.equal(Attacks.quakeDamage(A.QUAKE_INNER,H),H.damage[1]);
  assert.equal(Attacks.quakeDamage(A.QUAKE_R,H),H.damage[0]);assert.equal(Attacks.quakeDamage(A.QUAKE_R+.01,H),0);
  let last=Infinity;for(let d=0;d<=A.QUAKE_R;d+=.5){const k=Attacks.quakeDamage(d,H);assert.ok(k<=last);last=k;}
  // Run a ram to its impact, then put you somewhere else as it lands.
  function ram(move,state,anchor){
    const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z});
    r.until(()=>r.s.m.state==='charge'&&r.s.m.ram,60*10);
    move(r);if(state)r.state=state;if(anchor)r.anchor=anchor(r);
    const hp=r.s.you.hp;r.until(()=>r.events('quake').length>0,60*6);
    return{r,lost:hp-r.s.you.hp,hurt:r.events('hurt')[0]};
  }
  const box=Attacks.under(city,{x:RV.x,y:RV.y,z:RV.z});
  // The far end of the same roof: out of reach.
  const far=roof(box.x0+2,box.z0+2);
  let o=ram(r=>Object.assign(r.you,far));assert.ok(d2(far,o.r.s.attack.wall)>A.QUAKE_R);assert.equal(o.lost,0,'hurt from the far end of the roof');
  // In the air over it (you jumped, or let go): nothing.
  o=ram(r=>{r.you.y+=3;},'fly');assert.equal(o.lost,0,'hurt in the air');
  // On another building's roof: nothing.
  const other=city.buildings.find(b=>!b.filler&&b.tiers[0]!==box&&b.tiers.length===1&&b.tiers[0].x1<box.x0-10&&Math.abs(b.tiers[0].z0-box.z0)<60);
  const ot=other.tiers[0],there=roof((ot.x0+ot.x1)/2,(ot.z0+ot.z1)/2);
  o=ram(r=>Object.assign(r.you,there));assert.equal(o.lost,0,'hurt on another building');
  // Hanging from a line anchored to its wall, near where he hits: shaken off.
  o=ram(r=>{r.you.y=8;r.you.x=RV.x+6;},'swing',r=>({x:box.x1,y:14,z:r.s.attack.wall.z+2}));
  assert.ok(o.lost>0,'a line on that building was not shaken');assert.equal(o.hurt.knock,true,'and it knocks you off it');
});
test('rhino: dazed, your hits do double - for HARD\'s window, then single again',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z});
  r.until(()=>r.s.m.state==='stun',60*10);
  let hp=r.s.health,out=r.shoot();
  assert.ok(out.hit&&out.dazed);assert.equal(hp-r.s.health,H.shotDamage*H.dazedDamage,'double');
  assert.equal(r.s.m.state,'stun','a dazed rhino does not dodge');
  r.for(H.dazed);
  assert.ok(!Fight.dazed(r.s));
  hp=r.s.health;Fight.tick(r.s,Combat.COOLDOWN);out=r.shoot();
  assert.ok(out.hit&&!out.dazed);assert.equal(hp-r.s.health,H.shotDamage,'back to single');
  assert.match(Hud.status({mode:'fight',fight:Object.assign({},r.s,{dazedUntil:r.s.time+1}),enc:rhino,villain:{name:'RHINO'},damage:20}).right.text,/dazed/i);
});
// HARD's stagger (P7) takes more hits than the web's cooldown lets you land in
// an on-screen wind-up, so these run on a level with a longer one.
const LONG=Object.assign(Difficulty.get('HARD'),{telegraph:2});
test('stagger: HARD takes more hits in a wind-up than the cooldown allows on screen - only a long, off-screen one can be called off',()=>{
  const most=w=>Math.floor(w/Combat.COOLDOWN)+1;
  assert.ok(most(H.telegraph)<H.stagger,'an on-screen wind-up can be staggered');
  assert.ok(most(H.telegraph+H.offScreen)>=H.stagger,'not even an off-screen one can');
});
test('rhino: HARD\'s stagger of hits during his wind-up staggers him and calls the charge off',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z},{anim:true,diff:LONG});
  r.until(()=>r.s.attack.phase==='telegraph');
  const n=r.s.attack.n;
  for(let k=1;k<H.stagger;k++){assert.ok(r.shoot().hit);r.tick();assert.equal(r.s.attack.phase,'telegraph',k+' hits are not enough');Fight.tick(r.s,Combat.COOLDOWN,r.ctx());}
  assert.ok(r.shoot().hit);r.tick();
  assert.equal(r.s.attack.phase,'recover');assert.equal(r.s.staggers,1);assert.equal(r.s.m.state,'rest');
  assert.equal(r.events('stagger').length,1);
  assert.ok(r.plays.some(p=>p.c==='hit_big'),'he reels (hit_big)');
  r.for(H.recover-.05);assert.ok(!r.events('charge').length&&!r.events('quake').length,'the charge went ahead anyway');
  assert.equal(r.s.attack.n,n);
});

// --- venom --------------------------------------------------------------------------
test('venom: in reach, he pounces - a ring where he\'ll land, a leap that comes down next to you, and it hurts if you stay',()=>{
  const r=fightWith(venom,{x:VV.x,y:VV.y,z:VV.z});
  r.until(()=>r.s.attack.phase==='telegraph');
  assert.equal(r.s.attack.move,'pounce');
  r.for(.1);const z=r.s.attack.zone;assert.ok(z&&d2(z,r.you)<=A.POUNCE_GAP+.01,'the ring by you');
  r.until(()=>r.s.m.flying&&r.s.m.pounce);
  const L=r.s.m.dest;
  assert.ok(Math.abs(d2(L,r.you)-A.POUNCE_GAP)<.01,'he comes down next to you');
  assert.ok(Attacks.room(city,L.x,L.y,L.z,.45),'into something');
  r.until(()=>r.events('slam').length>0,60*3);
  assert.ok(r.s.m.spot&&!r.s.m.flying);
  const h=r.events('hurt')[0];assert.ok(h&&h.kind==='pounce'&&h.knock,'the pounce missed you standing still');
  assert.equal(h.damage,Attacks.damage(A.POUNCE_SHARE,H));
  // Down by you, he faces you.
  r.for(.5);const toYou=Math.atan2(r.you.x-r.s.at.x,r.you.z-r.s.at.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(r.s.face-toYou),Math.cos(r.s.face-toYou)))<.2);
  // Moving off while he's in the air: he misses.
  const q=fightWith(venom,{x:VV.x,y:VV.y,z:VV.z});
  q.until(()=>q.s.m.flying&&q.s.m.pounce);
  const hp=q.s.you.hp,away={x:q.you.x-q.s.m.dest.x,z:q.you.z-q.s.m.dest.z},l=Math.hypot(away.x,away.z);
  q.you.x+=away.x/l*2.5;q.you.z+=away.z/l*2.5;
  q.until(()=>q.events('slam').length>0,60*3);assert.equal(q.s.you.hp,hp,'it hit you after you moved off');
});
test('venom: close in, a combo of three swipes COMBO_GAP apart - and it ends when you get out of reach',()=>{
  const r=fightWith(venom,{x:VV.x,y:VV.y,z:VV.z});
  r.until(()=>r.events('slam').length>0,60*20);
  r.until(()=>r.s.attack.phase==='telegraph',60*10);
  assert.equal(r.s.attack.move,'combo','close in, it is a combo');
  r.until(()=>r.s.attack.phase==='recover',60*5);
  const sw=r.events('swipe');assert.equal(sw.length,A.COMBO_N);
  for(let i=1;i<sw.length;i++)assert.ok(Math.abs(sw[i].t-sw[i-1].t-A.COMBO_GAP)<DT*1.5,'swipe gap '+(sw[i].t-sw[i-1].t));
  const hurt=r.events('hurt').filter(e=>e.kind==='swipe');
  assert.equal(hurt.length,A.COMBO_N,'each swipe lands on someone standing there (invulnerability is shorter than the gap)');
  hurt.forEach(e=>assert.equal(e.damage,Attacks.damage(A.SWIPE_SHARE,H)));
  // Get away after the first swipe and the rest don't come.
  const q=fightWith(venom,{x:VV.x,y:VV.y,z:VV.z});
  q.until(()=>q.events('slam').length>0,60*20);
  q.until(()=>q.events('swipe').length>0,60*10);
  q.you.x-=8;q.you.y=0;
  q.until(()=>q.s.attack.phase!=='active',60*3);
  assert.equal(q.events('swipe').length,1,'he kept swiping at nothing');
});
test('venom: at mid range - you on a line - the tentacle lash follows you through the wind-up, and pulls you off',()=>{
  let r=fightWith(venom,{x:0,y:0,z:0},{state:'swing'});
  // Hang 8 m off him, level with him, until he winds up.
  const off=()=>{if(r.s.attack.phase!=='wait')return;Object.assign(r.you,{x:r.s.at.x-8,y:r.s.at.y+.1,z:r.s.at.z});};
  r.until(()=>r.s.attack.phase==='telegraph',60*20,off);
  assert.equal(r.s.attack.move,'lash','on a line, it is the lash');
  const a0={...r.s.attack.aim};r.you.z+=2;r.for(.2);
  assert.ok(r.s.attack.aim.z>a0.z&&r.s.attack.aim.z<a0.z+2,'the aim eases after you');
  r.you.z-=2;
  r.until(()=>r.events('lash').length>0);
  r.until(()=>r.events('hurt').length>0||r.s.attack.phase!=='active',60*2);
  const h=r.events('hurt')[0];assert.ok(h&&h.kind==='lash','the lash missed');
  assert.equal(h.knock,true,'off the line');assert.equal(h.damage,Attacks.damage(A.LASH_SHARE,H));
  assert.ok((r.s.at.x-r.you.x)*h.push.x+(r.s.at.z-r.you.z)*h.push.z>0,'it pulls you towards him');
  // Out of its line when it comes: it misses.
  r=fightWith(venom,{x:0,y:0,z:0},{state:'swing'});
  r.until(()=>r.s.attack.phase==='telegraph',60*20,off);
  r.until(()=>r.s.attack.phase==='active');r.you.z+=3;
  r.until(()=>r.s.attack.phase!=='active',60*2);assert.equal(r.events('hurt').length,0,'it hit you out of its line');
});
test('venom: HARD\'s stagger of hits during a wind-up interrupts him (hit_big), and he doesn\'t dodge while committed',()=>{
  const r=fightWith(venom,{x:VV.x,y:VV.y,z:VV.z},{anim:true,diff:LONG});
  r.until(()=>r.s.attack.phase==='telegraph');
  const dodges=r.s.dodge.n;
  assert.ok(r.shoot().hit);assert.equal(r.s.dodge.n,dodges,'he dodged mid wind-up');
  for(let k=1;k<H.stagger;k++){Fight.tick(r.s,Combat.COOLDOWN,r.ctx());assert.ok(r.shoot().hit);}
  r.tick();
  assert.equal(r.s.attack.phase,'recover');assert.equal(r.s.staggers,1);
  assert.ok(r.plays.some(p=>p.c==='hit_big'));
  r.for(1.5);assert.ok(!r.events('pounce').length,'the pounce went ahead');
});
test('venom: out of reach he keeps to his beams and never attacks',()=>{
  const far={x:VV.x-60,y:0,z:VV.z};
  const r=fightWith(venom,far),perched=new Set();
  r.for(20,()=>{if(!r.s.m.flying)perched.add(r.s.m.at);});
  assert.equal(r.events('telegraph').length,0);assert.ok(perched.size>=3,'he stopped leaping: '+perched.size);
  assert.ok(!r.s.m.spot);
});

// --- all three: fairness, winning and losing ------------------------------------------
test('fairness: every attack of theirs is telegraphed for HARD\'s wind-up before it can hurt you, and none in the entrance',()=>{
  for(const [enc,you,st] of [[rhino,onStreet,'ground'],[rhino,{x:RV.x,y:RV.y,z:RV.z},'ground'],[venom,{x:VV.x,y:VV.y,z:VV.z},'ground']]){
    const s=Fight.play(Fight.start(enc,levels)),ev=[];let n=0;
    const ctx={you:{...you,vx:0,vy:0,vz:0},body:Attacks.standIn(you),state:st,onScreen:true,city};
    while(s.phase==='arrive'){Fight.tick(s,DT,ctx);ev.push(...Fight.drain(s));}
    assert.deepEqual(ev,[],enc.id+' attacked in his entrance');
    const log=[];
    for(n=0;n<60*40&&s.mode==='playing';n++){Fight.tick(s,DT,ctx);log.push(...Fight.drain(s).map(e=>({...e,t:s.time})));s.you.safeUntil=0;s.you.hp=100;}
    const hurts=log.filter(e=>e.type==='hurt');assert.ok(hurts.length>=3,enc.id+' hardly attacked: '+hurts.length);
    hurts.forEach(h=>{const tel=log.filter(e=>e.type==='telegraph'&&e.t<=h.t).pop();assert.ok(tel&&h.t-tel.t>=H.telegraph-DT,enc.id+' hurt you '+(tel?(h.t-tel.t).toFixed(2)+' s after a wind-up':'with no wind-up'));});
  }
});
test('the rhino and venom can each be won and lost',()=>{
  for(const [enc,you] of [[rhino,{x:RV.x,y:RV.y,z:RV.z}],[venom,{x:VV.x,y:VV.y,z:VV.z}]]){
    // Lost: stand there.
    const l=fightWith(enc,you);l.until(()=>l.s.mode!=='playing',60*120);
    assert.equal(l.s.mode,'lost',enc.id);assert.ok(l.events('hurt').some(e=>e.dead));
    // Won: hit him at a steady pace - whatever he does to you meanwhile.
    const w=fightWith(enc,you);let hits=0;
    w.until(()=>w.s.mode!=='playing',60*120,()=>{if(w.s.cooldownRemaining===0&&!w.s.m.flying&&w.shoot().hit)hits++;});
    assert.equal(w.s.mode,'won',enc.id+' was not beaten ('+w.s.you.hp+' hp left, him '+w.s.health+')');
    assert.ok(hits<=H.villainHp/H.shotDamage&&hits>=H.villainHp/(H.shotDamage*H.dazedDamage),enc.id+' took '+hits+' hits');
    assert.ok(!w.s.attack.lash&&!w.s.attack.zone,'his attack outlived him');
  }
});

// --- the clips and sounds -------------------------------------------------------------
test('anim: the rhino winds up his charge to fit the wind-up, runs by speed, skids past, and is stunned for as long as he\'s dazed',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z},{anim:true});
  r.until(()=>r.s.m.state==='stun',60*10);r.for(.1);
  const brace=r.plays.find(p=>p.c==='attack'&&p.state==='brace');
  assert.ok(brace&&Math.abs(brace.opts.speed*H.telegraph-CLIPS.charge.attack)<1e-9,'the wind-up clip spans the wind-up');
  const stun=r.plays.find(p=>p.c==='stun');assert.ok(stun&&Math.abs(stun.opts.speed*H.dazed-CLIPS.charge.stun)<1e-9,'stunned for the dazed window');
  const q=fightWith(rhino,onStreet,{anim:true});q.until(()=>q.s.m.state==='rest',60*10);
  assert.ok(q.plays.some(p=>p.c==='skid'&&p.state==='overrun'),'skid past');
  assert.ok(q.plays.some(p=>p.c==='loco'&&p.state==='charge'));
  for(const p of r.plays.concat(q.plays))assert.ok(p.c==='loco'||p.c in CLIPS.charge,'no clip '+p.c);
});
test('anim: venom\'s swipes and lash strike as the attack does, the pounce roars and crouches, and lands hard',()=>{
  const r=fightWith(venom,{x:VV.x,y:VV.y,z:VV.z},{anim:true});
  r.until(()=>r.events('swipe').length>=A.COMBO_N,60*30);r.for(.5);
  const E=EVENTS.leap,tel=H.telegraph,ev=r.events('telegraph'),combo=ev.find(e=>e.move==='combo'),pnc=ev.find(e=>e.move==='pounce');
  // The pounce: a roar as it begins, the crouch so its take-off ends the wind-up, and land_heavy.
  const roar=r.plays.find(p=>p.c==='roar'&&p.move==='pounce');assert.ok(roar&&roar.clock<2*DT,'no roar');
  const ls=r.plays.find(p=>p.c==='leap_start'&&p.move==='pounce');
  assert.ok(ls&&Math.abs(ls.clock+VillainAnim.constants.TAKEOFF/ls.opts.speed-tel)<.03,'the take-off at the end of the wind-up');
  assert.ok(r.plays.some(p=>p.c==='land_heavy'),'a pounce lands hard');
  // The combo: attack's strike frame at the strike, attack2's and attack3's at theirs.
  const c=r.plays.filter(p=>p.move==='combo'&&/attack/.test(p.c));
  const first=c.find(p=>p.c==='attack'&&p.phase==='telegraph');
  assert.ok(Math.abs(first.clock+E.attack.release_seconds/first.opts.speed-tel)<DT+1e-6,'the first swipe lands at the strike');
  assert.ok(c.find(p=>p.c==='attack'&&p.opts.from===E.attack.release_seconds),'and carries on at its own speed');
  const sw=r.events('swipe');
  [['attack2',1],['attack3',2]].forEach(([k,i])=>{const p=c.find(q=>q.c===k);assert.ok(p,'no '+k);
    assert.ok(Math.abs(p.t+E[k].release_seconds-sw[i].t)<DT*1.5,k+' strikes '+(p.t+E[k].release_seconds-sw[i].t).toFixed(3)+' s off its swipe');});
  for(const p of r.plays)assert.ok(p.c==='loco'||p.c in CLIPS.leap,'no clip '+p.c);
  // The lash: its tentacles' strike frame at the strike.
  const L=fightWith(venom,{x:0,y:0,z:0},{state:'swing',anim:true});
  L.until(()=>L.events('lash').length>0,60*20,()=>{if(L.s.attack.phase==='wait')Object.assign(L.you,{x:L.s.at.x-8,y:L.s.at.y+.1,z:L.s.at.z});});
  const t=L.plays.find(p=>p.c==='tentacles'&&p.phase==='telegraph');
  assert.ok(t&&Math.abs(t.clock+E.tentacles.release_seconds/t.opts.speed-tel)<DT+1e-6,'the lash\'s strike frame at the strike');
  assert.ok(t.opts.speed>=VillainAnim.constants.MIN_WIND);
});
test('sounds: venom\'s swipes and lash are heard from their strikes, not their wind-ups; the rhino grunts when stunned',()=>{
  const c=SoundCues.create('leap'),f={at:{x:0,y:0,z:0},mode:'playing',vel:{x:0,z:0}};
  assert.deepEqual(SoundCues.step(c,f,[['attack',{}],['attack2',{}],['attack3',{}],['tentacles',{}]],null,DT).cues,[]);
  assert.equal(SoundCues.step(c,f,[['land_heavy',{}]],null,DT).cues[0].name,'thud');
  assert.equal(SoundCues.step(SoundCues.create('charge'),f,[['stun',{}]],null,DT).cues[0].name,'grunt');
  assert.equal(SoundCues.step(SoundCues.create('charge'),f,[['attack',{}]],null,DT).cues[0].name,'snort','the rhino still snorts as he winds up');
});
test('intro cards: the rhino and venom say they fight back, and there is no clock',()=>{
  for(const enc of [rhino,venom]){assert.match(enc.intro,/fights back/);assert.match(enc.intro,/No clock/);assert.doesNotMatch(enc.intro,/thirty|seconds/i);}
  // P7: they try to kill you, and every card says so; the Goblin's says how to beat his laser.
  for(const enc of [goblin,rhino,venom])assert.match(enc.intro,/out to kill you/,enc.id);
  assert.match(goblin.intro,/laser locks/);assert.doesNotMatch(rhino.intro+venom.intro,/two hits/);
});
test('HUD: a wind-up turns the objective line into a red warning of what\'s coming - a ram\'s and a pounce\'s until they land',()=>{
  const r=fightWith(rhino,{x:RV.x,y:RV.y,z:RV.z}),st=()=>Hud.status({mode:'fight',fight:r.s,enc:rhino,villain:{name:'RHINO'},damage:20}).right;
  assert.equal(st().warn,false);
  r.until(()=>r.s.attack.phase==='telegraph');assert.equal(st().warn,true);assert.match(st().text,/ramming/);
  r.until(()=>r.s.attack.phase==='active');assert.equal(st().warn,true,'a ram warns until it lands');
  r.until(()=>r.s.attack.phase==='recover',60*6);assert.equal(st().warn,false);assert.match(st().text,/dazed/);
});
test('venom: the column of the beam node he stands on doesn\'t block his lash - he lashes at you on a line by the frame',()=>{
  // Hanging in the yard beside the frame: from his beams the line to you starts inside a column.
  const r=fightWith(venom,{x:297,y:9,z:214},{state:'swing'});
  r.until(()=>r.events('lash').length>0,60*40);
  assert.ok(r.s.attack.lash||r.events('lash').length,'no lash');
  assert.ok(Attacks.lashReach(city,{x:305,y:5.8,z:210},aimAt({x:305,y:5.8,z:210},{x:297,y:10.1,z:214}))>8,'the column stops it');
});
