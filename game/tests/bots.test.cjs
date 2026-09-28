// Bots that play the 3D fights (docs/PLAYER_PLAN.md, Session P7): HARD is
// proved by who wins, not by its numbers. Each fight is run in node as the
// page runs it - Fight.tick with you in it, a stand-in body, your eye as the
// guns' target (first person) - and the bot decides what you do.
//   passive     stands where the fight put you and never shoots: he must
//               kill it within 30 s, in every fight.
//   human pace  a shot every 1.2 s, 30% of them missed; it moves only once
//               it has seen a wind-up (after a human's reaction time), a
//               sidestep of a random length, and stands still otherwise -
//               and when the laser locks (its beep) it changes what it's
//               doing, again after a reaction time: stops if moving, steps
//               aside if not. It never shoots a bomb down. It must win the
//               Goblin fight, but with under 60% of its health left, most
//               of the time.
// The measured numbers are printed as test diagnostics (and are in the
// P7 entry of PLAYER_PLAN.md's Status).
const test=require('node:test'),assert=require('node:assert/strict');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),Attacks=require('../js/world/attacks.js'),Difficulty=require('../js/world/difficulty.js');
const levels=require('../js/levels.js'),villains=require('../js/villains.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
const H=Difficulty.HARD,DT=1/60,WALK=6,EYE=1.7;
function rng(seed){return function(){seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// A body for the villain where he is (villain-view.js samples the model's in the page).
function pose(s){if(!s.at){s.body=null;return;}const a=s.at;s.body={spots:[],capsules:[{a:{x:a.x,y:a.y+.9,z:a.z},b:{x:a.x,y:a.y+1.7,z:a.z},r:.3,bones:['a','b']}]};}
function unit(v){const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l};}

// One fight to its end (or `max` seconds of the fight proper). bot(ctx) is
// called every frame with { s, you, events, t, u (random) } and moves you /
// fires. Returns { mode, hp, secs, hits, shots, hurts }.
function run(enc,bot,seed,max){
  const s=Fight.play(Fight.start(enc,levels)),v=enc.vantage,u=rng(seed);
  s.seed=(seed*7919+13)>>>0;s.attack.seed=(seed*104729+7)>>>0;           // his choices vary from run to run too
  const you={x:v.x,y:v.y,z:v.z,vx:0,vy:0,vz:0},hurts=[];
  let t=0,events=[];
  while(s.mode==='playing'&&t<(max||120)){
    pose(s);
    Fight.tick(s,DT,{you,body:Attacks.standIn(you),state:'ground',onScreen:true,city,target:{x:you.x,y:you.y+EYE,z:you.z}});
    events=Fight.drain(s);events.forEach(e=>{if(e.type==='hurt')hurts.push(e.damage+' '+e.kind);});
    if(s.phase==='villain')t+=DT;
    bot({s,you,events,t,u});
  }
  return {mode:s.mode,hp:s.you.hp,secs:+t.toFixed(1),hits:s.hits,shots:s.shots,hurts};
}

const passive=()=>{};
// The human-pace player. Shoots every SHOT seconds when it can, missing
// MISS of them; after a wind-up it reacts in REACT seconds and sidesteps
// (square to him, either way, back toward where it started if it has
// wandered) for DODGE seconds at a walk, then stands again.
function human(o){
  o=Object.assign({SHOT:1.2,MISS:.3,REACT:[.25,.45],DODGE:[.3,.9]},o);
  let next=0,dodge=null,home=null,lockAt=0,lockN=-1;
  const react=u=>o.REACT[0]+u()*(o.REACT[1]-o.REACT[0]);
  return function({s,you,events,t,u}){
    if(!home)home={x:you.x,z:you.z};
    // The lock: seen (heard) a reaction time later, it changes what it's doing.
    const L=s.attack.laser;
    if(L&&L.locked&&lockN!==s.attack.n){lockN=s.attack.n;lockAt=t+react(u);}
    if(lockAt&&t>=lockAt){
      lockAt=0;
      if(dodge&&t>=dodge.at&&t<dodge.until)dodge.until=t;
      else{const to={x:s.at.x-you.x,z:s.at.z-you.z},l=Math.hypot(to.x,to.z)||1,sg=u()<.5?1:-1;dodge={at:t,until:t+.4+u()*.4,dir:{x:-to.z/l*sg,z:to.x/l*sg}};}
    }
    events.filter(e=>e.type==='telegraph').forEach(()=>{
      const to={x:s.at.x-you.x,z:s.at.z-you.z},l=Math.hypot(to.x,to.z)||1;let side={x:-to.z/l,z:to.x/l};
      const back={x:home.x-you.x,z:home.z-you.z},sign=Math.hypot(back.x,back.z)>8?(side.x*back.x+side.z*back.z>0?1:-1):(u()<.5?1:-1);
      dodge={at:t+react(u),until:0,dir:{x:side.x*sign,z:side.z*sign}};
      dodge.until=dodge.at+o.DODGE[0]+u()*(o.DODGE[1]-o.DODGE[0]);
    });
    const moving=dodge&&t>=dodge.at&&t<dodge.until;
    you.vx=moving?dodge.dir.x*WALK:0;you.vz=moving?dodge.dir.z*WALK:0;
    you.x+=you.vx*DT;you.z+=you.vz*DT;
    if(s.phase!=='villain'||t<next||s.cooldownRemaining>0)return;
    next=t+o.SHOT;
    const eye={x:you.x,y:you.y+EYE,z:you.z},m={x:s.at.x,y:s.at.y+1.3,z:s.at.z};
    if(u()<o.MISS){m.y+=3+u()*2;m.x+=(u()-.5)*4;}
    Fight.fire(s,villains,{origin:eye,dir:unit({x:m.x-eye.x,y:m.y-eye.y,z:m.z-eye.z}),blocked:Infinity});
  };
}

test('bots: a passive player - standing still, never shooting - is killed within 30 s in every fight',t=>{
  for(const enc of [goblin,rhino,venom]){
    const secs=[];
    for(let seed=1;seed<=10;seed++){const r=run(enc,passive,seed,60);assert.equal(r.mode,'lost',['Goblin','Rhino','Venom'][enc.index]+' seed '+seed+': still alive after 60 s');secs.push(r.secs);}
    secs.sort((a,b)=>a-b);
    t.diagnostic(['Goblin','Rhino','Venom'][enc.index]+': passive dies in '+secs[0]+'-'+secs[secs.length-1]+' s (median '+secs[5]+')');
    assert.ok(secs[secs.length-1]<=30,['Goblin','Rhino','Venom'][enc.index]+': a passive player lived '+secs[secs.length-1]+' s');
  }
});
test('bots: a human-pace player wins the Goblin fight most of the time, with under 60% of its health left',t=>{
  const N=40,res=[];
  for(let seed=1;seed<=N;seed++)res.push(run(goblin,human(),seed,120));
  const won=res.filter(r=>r.mode==='won'),hp=won.map(r=>r.hp).sort((a,b)=>a-b),med=hp.length?hp[Math.floor(hp.length/2)]:null;
  const under=won.filter(r=>r.hp<60).length,secs=won.map(r=>r.secs).sort((a,b)=>a-b);
  t.diagnostic('goblin, human pace: won '+won.length+'/'+N+'; HP left in wins '+hp.join(' ')+' (median '+med+', under 60 in '+under+'/'+won.length+'); fights '+secs[0]+'-'+secs[secs.length-1]+' s');
  const kinds={};res.forEach(r=>r.hurts.forEach(h=>{const k=h.split(' ')[1];kinds[k]=(kinds[k]||0)+1;}));
  t.diagnostic('what hit it: '+JSON.stringify(kinds));
  assert.ok(won.length>N/2,'it won only '+won.length+' of '+N);
  assert.ok(under>won.length/2,'too easy: under 60% HP left in only '+under+' of '+won.length+' wins');
});
