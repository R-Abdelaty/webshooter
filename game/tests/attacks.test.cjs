const test=require('node:test'),assert=require('node:assert/strict');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),Attacks=require('../js/world/attacks.js'),Difficulty=require('../js/world/difficulty.js');
const Swing=require('../js/world/swing.js'),PlayerCamera=require('../js/world/player-camera.js'),PlayerAnim=require('../js/world/player-anim.js');
const Combat=require('../js/combat.js'),levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
const H=Difficulty.HARD,A=Attacks.constants,DT=1/60;
const near=(a,b,e)=>Math.abs(a-b)<(e||1e-9);
const d3=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function aimAt(o,p){const d=d3(o,p);return{x:(p.x-o.x)/d,y:(p.y-o.y)/d,z:(p.z-o.z)/d};}

// --- the framework ------------------------------------------------------------------
// Run an attack state for `sec`, logging its events with the time they came.
function runAttack(a,sec,ctx){const log=[];let t=0;for(let n=0;n<Math.round(sec/DT);n++){t+=DT;Attacks.step(a,DT,typeof ctx==='function'?ctx(t):ctx).forEach(e=>log.push({...e,t}));}return log;}

test('attacks: every attack is telegraphed for HARD\'s wind-up, then lands, then he recovers',()=>{
  const a=Attacks.create('glider',Difficulty.get('HARD'),7),log=runAttack(a,60,{onScreen:true,state:'ground'});
  const tel=log.filter(e=>e.type==='telegraph'),hit=log.filter(e=>e.type==='strike');
  assert.ok(tel.length>=11,'about one every 3-5 s: '+tel.length);
  assert.ok(hit.length>=tel.length-1);
  hit.forEach((h,i)=>{
    // The strike before it is always its own telegraph, exactly one wind-up earlier.
    const before=log.filter(e=>e.t<=h.t&&e.type!=='ready').slice(-2);
    assert.equal(before[0].type,'telegraph','a strike without a wind-up');
    assert.ok(near(h.t-before[0].t,H.telegraph,DT+1e-6),'wind-up '+(h.t-before[0].t));
    assert.equal(before[0].move,h.move);
  });
  // Start to start: the cadence.
  for(let i=1;i<tel.length;i++){const g=tel[i].t-tel[i-1].t;assert.ok(g>=H.cadence[0]-DT&&g<=H.cadence[1]+DT,'gap '+g);}
  assert.equal(tel[0].t>=H.firstAttack-DT,true,'the first comes after firstAttack');
  // And the recovery follows each strike.
  const rec=log.filter(e=>e.type==='recover');assert.ok(rec.length>=hit.length-1);
});
test('attacks: never two in a row from off the screen - the next waits until he is in view',()=>{
  const a=Attacks.create('glider',H,3);
  // Off the screen for the first 20 s, then in view.
  const log=runAttack(a,30,t=>({onScreen:t>20,state:'ground'}));
  const tel=log.filter(e=>e.type==='telegraph');
  assert.equal(tel[0].off,true);
  assert.equal(tel.filter(e=>e.t<20).length,1,'a second one came from off the screen');
  assert.ok(tel[1].t>=20&&tel[1].off===false,'the next one waited for him to be in view');
  // Alternating in and out of view never gives two off-screen ones running.
  const b=Attacks.create('glider',H,11),l2=runAttack(b,120,t=>({onScreen:Math.floor(t/2.3)%2===0,state:'swing'})).filter(e=>e.type==='telegraph');
  for(let i=1;i<l2.length;i++)assert.ok(!(l2[i].off&&l2[i-1].off),'two in a row off-screen at '+l2[i].t);
});
test('attacks: the goblin mixes bombs and guns - more guns at you in the air - never three the same running',()=>{
  const count=(state)=>{const a=Attacks.create('glider',H,5),m=runAttack(a,400,{onScreen:true,state}).filter(e=>e.type==='telegraph').map(e=>e.move);
    for(let i=2;i<m.length;i++)assert.ok(!(m[i]===m[i-1]&&m[i]===m[i-2]),'three '+m[i]+' in a row');return m.filter(x=>x==='guns').length/m.length;};
  const air=count('swing'),ground=count('ground');
  assert.ok(air>ground,'guns in the air '+air.toFixed(2)+' vs on the ground '+ground.toFixed(2));
  assert.ok(ground>.15&&air<.85);
  // Since P5 the Rhino and Venom have moves too - but with none open to them (allow: []) they wait.
  assert.deepEqual(Attacks.MOVES.charge,['charge','ram']);assert.deepEqual(Attacks.MOVES.leap,['combo','lash','pounce']);
  assert.deepEqual(runAttack(Attacks.create('charge',H,1),30,{onScreen:true,allow:[]}),[]);
});
test('attacks: none during his entrance, and none in a fight without you in it',()=>{
  const s=Fight.play(Fight.start(goblin,levels)),you={x:goblin.vantage.x,y:goblin.vantage.y,z:goblin.vantage.z};
  const ctx={you,body:Attacks.standIn(you),state:'ground',onScreen:true,city};
  const ev=[];
  while(s.phase==='arrive'){Fight.tick(s,DT,ctx);ev.push(...Fight.drain(s));}
  assert.deepEqual(ev,[],'an attack during the entrance');
  assert.equal(s.attack.phase,'wait');
  for(let n=0;n<600;n++)Fight.tick(s,DT);
  assert.deepEqual(Fight.drain(s),[],'attacked with nobody there');
});

// --- bombs -----------------------------------------------------------------------------
test('bombs: a throw lands on you where you stand, leads you when you move, and flies longer the further it goes',()=>{
  const from={x:0,y:20,z:0},to={x:12,y:10,z:-5},b=Attacks.throwBomb(from,to,null,1);
  const land=Attacks.bombAt(b,b.T);assert.ok(d3(land,to)<1e-9,'it lands on the target');
  assert.ok(Attacks.bombAt(b,b.T/2).y>(from.y+to.y)/2,'it arcs');
  const far=Attacks.throwBomb(from,{x:40,y:10,z:0},null,2);assert.ok(far.T>b.T);
  assert.ok(b.T>=A.BOMB_T[0]&&far.T<=A.BOMB_T[1]);
  const led=Attacks.throwBomb(from,to,{x:5,z:0},3);
  assert.ok(near(led.to.x-to.x,5*led.T*A.LEAD),'it leads you');
  const capped=Attacks.throwBomb(from,to,{x:40,z:0},4);assert.ok(near(Math.hypot(capped.to.x-to.x,capped.to.z-to.z),A.LEAD_MAX,1e-6));
});
test('bombs: one goes off on you, on the city, when a web gets to it, or when its fuse runs out',()=>{
  const from={x:0,y:10,z:0},to={x:10,y:1,z:0};
  const you=Attacks.standIn({x:10,y:0,z:0});
  const fly=(b,city,caps,popAt)=>{if(popAt!==undefined)b.popAt=popAt;for(let t=DT;t<5;t+=DT){const r=Attacks.stepBomb(b,DT,t,city,caps);if(r)return{...r,t};}return null;};
  let r=fly(Attacks.throwBomb(from,to,null,1),null,you);assert.equal(r.why,'body');assert.ok(d3(r.at,to)<1.2);
  r=fly(Attacks.throwBomb(from,to,null,2),null,null);assert.equal(r.why,'city','the street');assert.ok(near(r.at.y,0,1e-6));
  r=fly(Attacks.throwBomb(from,to,null,3),null,null,.4);assert.equal(r.why,'shot');assert.ok(near(r.t,.4,DT+1e-9));
  // Thrown up and over nothing, the fuse ends it.
  r=fly(Attacks.throwBomb({x:0,y:500,z:0},{x:0,y:500,z:30},null,4),null,null);assert.equal(r.why,'fuse');assert.ok(near(r.t,A.FUSE,DT+1e-9));
  // Into a building's wall: it stops on the wall, never inside.
  const b=city.colliders.find(c=>c.y1>30&&c.x1-c.x0>10),mid={x:(b.x0+b.x1)/2,z:(b.z0+b.z1)/2};
  const src={x:b.x0-15,y:20,z:mid.z};r=fly(Attacks.throwBomb(src,{x:mid.x,y:12,z:mid.z},null,5),city,null);
  assert.equal(r.why,'city');assert.ok(r.at.x<=b.x0+1e-6,'inside the building: '+r.at.x+' vs its wall at '+b.x0);
});
test('bombs: the blast hurts most close in and falls off to nothing past its radius',()=>{
  const at={x:0,y:1,z:0},body=d=>Attacks.standIn({x:d+.3,y:0,z:0});
  assert.equal(Attacks.blastDamage(at,body(0),H),H.damage[1],'on top of you: the most');
  assert.equal(Attacks.blastDamage(at,body(A.BLAST_INNER),H),H.damage[1]);
  let last=Infinity;
  for(let d=A.BLAST_INNER;d<A.BLAST_R;d+=.25){const k=Attacks.blastDamage(at,body(d),H);assert.ok(k<=last,'it grows with distance at '+d);assert.ok(k>=H.damage[0]);last=k;}
  assert.equal(Attacks.blastDamage(at,body(A.BLAST_R+.01),H),0,'past the radius');
  assert.equal(Attacks.blastDamage(at,body(50),H,'body'),H.damage[1],'a bomb that hit you does the most');
  const p=Attacks.push(at,body(2),20,H);assert.ok(p.x>0&&p.y>0,'it throws you away from it, and up');
});
test('bombs: a web aimed near one in flight shoots it down - its own small cone, not through a wall',()=>{
  const o={x:0,y:0,z:0},bombs=[{x:0,y:0,z:-20},{x:3,y:0,z:-20}];
  assert.equal(Attacks.aimBomb(o,{x:0,y:0,z:-1},bombs),0);
  assert.equal(Attacks.aimBomb(o,aimAt(o,{x:2.9,y:0,z:-20}),bombs),1,'the one nearest the line');
  const off=A.BOMB_CONE+1,dir={x:Math.sin(off*Math.PI/180),y:0,z:-Math.cos(off*Math.PI/180)};
  assert.equal(Attacks.aimBomb(o,dir,[bombs[0]]),-1,'outside the cone');
  assert.equal(Attacks.aimBomb(o,{x:0,y:0,z:1},bombs),-1,'behind you');
  assert.equal(Attacks.aimBomb(o,{x:0,y:0,z:-1},bombs,A.BOMB_CONE,10),-1,'a wall in front of it');
  // And Swing.decide puts it before a villain in the aim, and before a wall to swing on.
  assert.deepEqual(Swing.decide({bomb:7,target:true,hit:null},Swing.create()),{act:'bomb',bomb:7});
  assert.equal(Swing.decide({bomb:null,target:true,hit:null},Swing.create()).act,'shot');
});

// --- a goblin fight, with you in it ---------------------------------------------------
// You, standing (or moving) at p; the fight ticked with you in it.
function fightWith(enc){
  const s=Fight.play(Fight.start(enc,levels)),v=enc.vantage;
  const you={x:v.x,y:v.y,z:v.z,vx:0,vy:0,vz:0};
  const r={s,you,ev:[],state:'ground',onScreen:true,
    tick(dt){Fight.tick(s,dt||DT,{you,body:Attacks.standIn(you),state:r.state,onScreen:r.onScreen,city});r.ev.push(...Fight.drain(s).map(e=>({...e,t:s.time})));return r;},
    until(fn,max){for(let n=0;n<(max||60*60)&&!fn();n++)r.tick();assert.ok(fn(),'never happened: '+fn);return r;}};
  r.until(()=>s.phase==='villain');
  return r;
}
test('bombs: shot down in flight, it goes off out there - no damage to you, and it is not a shot at him',()=>{
  const r=fightWith(goblin),s=r.s;
  r.until(()=>s.bombs.length>0);
  const b=s.bombs[0],eye={x:r.you.x,y:r.you.y+1.7,z:r.you.z},shot={origin:eye,dir:aimAt(eye,b),blocked:Infinity};
  const seen=Fight.snapshot(s);
  r.tick();r.tick();                                       // it flies on after you aimed
  assert.equal(Fight.aimBomb(s,shot,seen),b.id,'judged where it was when you aimed');
  const shots=s.shots,dodges=s.dodge.n,hp=s.you.hp;
  const out=Fight.shootBomb(s,b.id,.08);
  assert.deepEqual([out.accepted,out.kind],[true,'bomb']);
  assert.deepEqual(Fight.shootBomb(s,b.id,.08),{accepted:false},'twice');
  r.until(()=>r.ev.some(e=>e.type==='blast'));
  const bl=r.ev.find(e=>e.type==='blast');
  assert.equal(bl.why,'shot');assert.equal(bl.damage,0);assert.equal(s.you.hp,hp);
  assert.equal(s.shots,shots,'counted as a shot at him');assert.equal(s.dodge.n,dodges,'he dodged it');
  assert.ok(Fight.snapshot(s).bombs.every(q=>q.id!==b.id));
});
test('bombs: standing still, it hits you; moving away while it flies, it misses',()=>{
  const r=fightWith(goblin),s=r.s;
  r.until(()=>s.bombs.length>0);
  r.until(()=>r.ev.some(e=>e.type==='blast'));
  assert.ok(r.ev.some(e=>e.type==='hurt'&&e.kind==='bomb'),'a bomb at someone standing still missed');
  // Wait for the next bomb's wind-up, then walk off as it is thrown.
  const q=fightWith(goblin);
  q.until(()=>q.s.attack.phase==='telegraph'&&q.s.attack.move==='bomb');
  q.until(()=>q.s.bombs.length>0);
  const hp=q.s.you.hp,start={x:q.you.x,z:q.you.z};
  q.until(()=>{if(q.s.bombs.length){q.you.x+=7*DT;q.you.vx=7;}return !q.s.bombs.length;});
  assert.ok(Math.hypot(q.you.x-start.x,q.you.z-start.z)>A.BLAST_R,'you did not get far');
  assert.equal(q.s.you.hp,hp,'it hurt you after you got out of the way');
});
test('guns: the laser follows you through the wind-up, locks, and the burst hits you only if you stay on the line',()=>{
  // The line test itself.
  const body=Attacks.standIn({x:0,y:0,z:-20});
  assert.equal(Attacks.onLine({x:0,y:10,z:0},{x:0,y:1,z:-20},body),true);
  assert.equal(Attacks.onLine({x:0,y:10,z:0},{x:1.5,y:1,z:-20},body),false,'a metre and a half beside you');
  assert.ok(near(Attacks.segSeg({x:0,y:0,z:0},{x:10,y:0,z:0},{x:5,y:3,z:-1},{x:5,y:3,z:1}),3));
  assert.ok(near(Attacks.segSeg({x:0,y:0,z:0},{x:1,y:0,z:0},{x:3,y:0,z:0},{x:4,y:0,z:0}),2),'ends apart');
  // In a fight: stand still through a burst and it hits for its share.
  const r=fightWith(goblin),s=r.s;
  r.until(()=>s.attack.phase==='telegraph'&&s.attack.move==='guns',60*120);
  const a0=s.attack.aim&&{...s.attack.aim};
  r.you.x+=3;                                                // step aside while he winds up
  r.tick();r.tick();r.tick();
  assert.ok(s.attack.aim.x>a0.x&&s.attack.aim.x<a0.x+3,'the laser eases after you');
  r.you.x-=3;
  r.until(()=>s.attack.phase==='active');
  const hp=s.you.hp;
  r.until(()=>s.attack.phase==='recover');r.until(()=>!s.rounds.length);
  assert.equal(hp-s.you.hp,Attacks.gunDamage(H),'the burst');
  assert.equal(r.ev.filter(e=>e.type==='round').length>=A.GUN_ROUNDS-1,true,'its rounds');
  // Again, but move out of the line as it locks.
  const q=fightWith(goblin);
  q.until(()=>q.s.attack.phase==='telegraph'&&q.s.attack.move==='guns',60*120);
  q.until(()=>q.s.attack.phase==='active');
  const hp2=q.s.you.hp;q.you.x+=2.5;q.you.z+=1;
  q.until(()=>q.s.attack.phase==='recover');q.until(()=>!q.s.rounds.length);
  assert.equal(q.s.you.hp,hp2,'the burst hit you out of its line');
});
test('the goblin hunts you: his circuit follows you across the roofs, keeping his distance and clear of the buildings',()=>{
  const r=fightWith(goblin),s=r.s;
  // Swing off east, 150 m, across the city, over 10 s.
  for(let n=0;n<600;n++){r.you.x+=15*DT;r.you.vx=15;r.tick();
    const inside=City.query(city,s.at.x,s.at.z,s.at.x,s.at.z).some(c=>s.at.x>c.x0&&s.at.x<c.x1&&s.at.z>c.z0&&s.at.z<c.z1&&s.at.y<c.y1-.05);
    assert.ok(!inside,'he flew into a building at '+JSON.stringify(s.at));}
  r.you.vx=0;for(let n=0;n<300;n++)r.tick();
  // Too far off to reach you while he closes in, he doesn't wind up.
  const q=fightWith(goblin);q.you.x+=120;q.you.y-=100;
  for(let n=0;n<60*3;n++){q.tick();if(Math.hypot(q.s.at.x-q.you.x,q.s.at.y-q.you.y,q.s.at.z-q.you.z)>Fight.constants.ATTACK_RANGE)assert.notEqual(q.s.attack.phase,'telegraph','a wind-up from '+Math.round(Math.hypot(q.s.at.x-q.you.x,q.s.at.z-q.you.z))+' m away');}
  for(let n=0;n<60*20&&q.s.attack.n===0;n++)q.tick();
  assert.ok(q.s.attack.n>0,'he never attacked once he got to you');
  const d=Math.hypot(s.at.x-r.you.x,s.at.z-r.you.z);
  assert.ok(d>=goblin.path.r0-1&&d<=goblin.path.r1+2,'he keeps his stand-off: '+d.toFixed(1));
  // Without you in the fight (the old tests) he circles where it started.
  const t=Fight.play(Fight.start(goblin,levels));for(let n=0;n<60*20;n++)Fight.tick(t,DT);
  assert.ok(Math.hypot(t.at.x-goblin.path.cx,t.at.z-goblin.path.cz)<=goblin.path.r1+.01);
});
test('the goblin fight can be won and lost',()=>{
  // Lost: stand there.
  const l=fightWith(goblin);l.until(()=>l.s.mode!=='playing',60*120);
  assert.equal(l.s.mode,'lost');assert.equal(l.s.you.hp,0);assert.ok(l.ev.some(e=>e.type==='hurt'&&e.dead));
  assert.deepEqual([l.s.bombs,l.s.rounds],[[],[]],'his attacks went on after');
  // Won: hit him fifteen times, keeping clear of what he throws.
  const w=fightWith(goblin),s=w.s;let hits=0;
  const pose=()=>{const a=s.at;s.body={spots:[],capsules:[{a:{x:a.x,y:a.y+.9,z:a.z},b:{x:a.x,y:a.y+1.7,z:a.z},r:.3,bones:['a','b']}]};};
  for(let n=0;n<60*120&&s.mode==='playing';n++){
    if(s.attack.phase==='active')w.you.z+=6*DT;              // out of the way of each attack
    w.tick();pose();
    if(s.cooldownRemaining===0){const eye={x:w.you.x,y:w.you.y+1.7,z:w.you.z},m={x:s.at.x,y:s.at.y+1.3,z:s.at.z};
      if(Fight.fire(s,villains,{origin:eye,dir:aimAt(eye,m),blocked:Infinity}).hit)hits++;}
  }
  assert.equal(s.mode,'won');assert.equal(hits,H.villainHp/H.shotDamage);assert.ok(s.you.hp>0);
  assert.deepEqual([s.bombs,s.rounds],[[],[]],'his bombs outlived him');
});

// --- being hit ---------------------------------------------------------------------------
test('being hit: the flinch, the heavy hit and going down play on both models',()=>{
  const a=PlayerAnim.create(),p={grounded:true,vx:0,vy:0,vz:0};
  PlayerAnim.step(a,p,DT,{});
  let o=PlayerAnim.step(a,p,DT,{hits:1,big:false});
  assert.ok(o.body.some(c=>c[0]==='hit')&&o.arms.some(c=>c[0]==='fp_hit'));
  o=PlayerAnim.step(a,p,DT,{hits:2,big:true});assert.ok(o.body.some(c=>c[0]==='hit_big'));
  o=PlayerAnim.step(a,p,DT,{hits:2,dead:true});
  assert.equal(o.state,'dead');assert.ok(o.body.some(c=>c[0]==='death'&&c[1].hold)&&o.arms.some(c=>c[0]==='fp_death'));
});
test('being hit: the shake is capped (and halved by REDUCED), the vignette scales with damage and fades, and going down slumps without a spin',()=>{
  const K=PlayerCamera.constants;
  assert.ok(PlayerCamera.hurtShake(15).amp<PlayerCamera.hurtShake(30).amp);
  assert.equal(PlayerCamera.hurtShake(1000).amp,K.SHAKE_MAX);
  assert.equal(PlayerCamera.hurtShake(1000,'reduced').amp,K.SHAKE_MAX/2);
  assert.ok(PlayerCamera.vignette(30,0,1)>PlayerCamera.vignette(15,0,1));
  assert.ok(PlayerCamera.vignette(30,.4,1)<PlayerCamera.vignette(30,0,1));
  assert.equal(PlayerCamera.vignette(30,K.VIGNETTE_T,1),0);
  assert.ok(PlayerCamera.vignette(0,9,.1)>0,'a tinge while low');
  const end=PlayerCamera.slump(10,false),mid=PlayerCamera.slump(K.SLUMP_T/2,false);
  assert.ok(end.drop>mid.drop&&mid.drop>0&&end.pitch<0);
  assert.ok(Math.abs(end.roll)<.2&&Math.abs(end.pitch)<Math.PI/4,'no flips or spins');
  assert.deepEqual(PlayerCamera.slump(0,false),{drop:0,pitch:-0,roll:0});
});
test('HARD is one place, and every fight uses it',()=>{
  const d=Difficulty.get('HARD');d.villainHp=1;
  assert.equal(Difficulty.HARD.villainHp,300,'get() hands out a copy');
  const s=Fight.start(rhino,levels,d);assert.equal(s.health,1,'a fight takes the level it is given');
  for(const enc of [goblin,rhino,venom])assert.equal(Fight.start(enc,levels).health,Difficulty.HARD.villainHp);
  assert.equal(Combat.DAMAGE,H.shotDamage);
});
