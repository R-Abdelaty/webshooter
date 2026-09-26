const test=require('node:test'),assert=require('node:assert/strict');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js');
const Fight=require('../js/world/fight.js'),Gfx=require('../js/world/gfx.js'),HitFx=require('../js/world/hitfx.js');
const levels=require('../js/levels.js');

const city=City.generate(20180907),spots=Encounters.build(city),[goblin,rhino,venom]=spots.fights;
// A seeded random source, so the bursts are the same every run.
function seeded(s){return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};}
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z,len=v=>Math.hypot(v.x,v.y,v.z);

// --- the graphics setting -------------------------------------------------------------
test('gfx: LOW and MED, LOW asking less of the GPU; anything else - a saved HIGH included - is MED',()=>{
  assert.deepEqual(Gfx.names(),['low','med'],'HIGH was removed by the user: too slow');
  const [lo,md]=Gfx.names().map(Gfx.tier);
  for(const n of ['nonsense',undefined,'high','HIGH'])assert.equal(Gfx.tier(n).name,'med',String(n));
  assert.equal(Gfx.tier('LOW').name,'low');
  assert.ok(lo.pixels<md.pixels&&lo.shadow<md.shadow&&lo.env<=md.env);
  assert.ok(lo.grade&&md.grade,'the grade is free, so both have it');
  assert.ok(!('post' in md)&&!('bloom' in md)&&!('ssao' in md),'no post chain');
  // LOW: the villains don't cast into the shadow map; a blob under them instead.
  assert.deepEqual([lo.cast,lo.blob,md.cast,md.blob],[false,true,true,false]);
  assert.ok(lo.particles<md.particles);
  const t=Gfx.tier('med');t.pixels=1;assert.equal(Gfx.tier('med').pixels,1920,'tier() hands out copies');
});
test('gfx: the pixel ratio renders at most the tier\'s width, never more than the screen has, never under half',()=>{
  const [lo,md]=Gfx.names().map(Gfx.tier);
  // A 1080p laptop at 150% scaling: 1280 CSS pixels across.
  assert.equal(Gfx.pixelRatio(md,1280,1.5),1.5);
  assert.ok(Math.abs(Gfx.pixelRatio(lo,1280,1.5)-1)<1e-9);
  assert.equal(Gfx.pixelRatio(md,1280,1),1,'capped by the screen');
  // A 1080p screen at 100%.
  assert.equal(Gfx.pixelRatio(md,1920,1),1);
  assert.ok(Math.abs(Gfx.pixelRatio(lo,1920,1)-2/3)<1e-9,'LOW renders 720p worth');
  assert.equal(Gfx.pixelRatio(lo,3840,1),.5,'but never under half');
  assert.equal(Gfx.pixelRatio(md,1920,0),1,'a missing dpr counts as 1');
});
test('gfx: in a fight the shadow box sits on the villain\'s stretch and is tighter than the roaming one',()=>{
  const md=Gfx.tier('med'),eye={x:1,y:2,z:3};
  const roam=Gfx.shadowBox(eye,null);
  assert.deepEqual(roam,{x:1,y:2,z:3,half:Gfx.SHADOW.ROAM});
  for(const enc of spots.fights){
    const f=Encounters.focus(enc),b=Gfx.shadowBox(eye,f);
    assert.equal(b.x,f.x);assert.equal(b.z,f.z);
    assert.ok(b.half>=f.r,enc.id+': the box must cover his whole stretch');
    assert.ok(b.half<=Gfx.SHADOW.MAX);
    assert.ok(Gfx.texel(b,md)<Gfx.texel(roam,md),enc.id+' shadow texels should shrink in a fight');
    assert.ok(Gfx.texel(b,md)<.05,enc.id+' shadow texel '+Gfx.texel(b,md).toFixed(3)+' m on MED');
  }
});

// --- where each fight happens ------------------------------------------------------------
test('focus: each villain stays inside his fight\'s focus once his entrance is over',()=>{
  for(const enc of spots.fights){
    const f=Encounters.focus(enc),s=Fight.play(Fight.start(enc,levels));
    for(let n=0;n<30*28&&s.mode==='playing';n++){
      Fight.tick(s,1/30);
      if(s.phase!=='villain')continue;
      const d=Math.hypot(s.at.x-f.x,s.at.y-f.y,s.at.z-f.z);
      assert.ok(d<=f.r,enc.id+' is '+d.toFixed(1)+' m from the centre, radius '+f.r);
    }
  }
  assert.deepEqual(Encounters.focus(rhino),Encounters.focus(Encounters.build(City.generate(20180907)).fights[1]),'the same every time');
});
test('ground: the floor under him for a contact shadow - the avenue, the beam, none for the goblin',()=>{
  const g=Fight.play(Fight.start(goblin,levels));Fight.tick(g,.5);
  assert.equal(Fight.ground(g),null,'the goblin flies');
  const r=Fight.play(Fight.start(rhino,levels));Fight.tick(r,.5);
  assert.equal(Fight.ground(r),rhino.path.y);
  const v=Fight.play(Fight.start(venom,levels));
  Fight.tick(v,.1);
  assert.equal(Fight.ground(v),venom.path.perches[v.m.at].y,'he drops in onto his beam');
  let seen=0;
  for(let n=0;n<30*12;n++){
    Fight.tick(v,1/30);
    const y=Fight.ground(v),m=v.m;
    if(v.phase!=='villain')continue;
    if(m.flying){
      const a=m.from.y,b=venom.path.perches[m.to].y;
      assert.ok(y>=Math.min(a,b)-1e-9&&y<=Math.max(a,b)+1e-9,'mid-leap, between the two beams');
      assert.ok(v.at.y>=y-1e-9,'never above him');seen++;
    }else assert.equal(y,venom.path.perches[m.at].y);
  }
  assert.ok(seen>10,'no leaps seen');
});

// --- the hit effects ------------------------------------------------------------------------
test('hitfx: a burst throws its particles out from the surface, within the cone round its normal',()=>{
  const rnd=seeded(7),p={x:1,y:2,z:3},n={x:0,y:0,z:1};
  for(const kind of Object.keys(HitFx.KINDS)){
    const k=HitFx.KINDS[kind],list=HitFx.burst(kind,p,n,{rnd});
    assert.equal(list.length,k.n,kind);
    for(const q of list){
      const v={x:q.vx,y:q.vy,z:q.vz},s=len(v),ang=Math.acos(Math.min(1,dot(v,n)/s))*180/Math.PI;
      assert.ok(ang<=k.cone+1e-6,kind+' left at '+ang.toFixed(1)+' degrees');
      assert.ok(s>=k.v0-1e-9&&s<=k.v1+1e-9);
      assert.deepEqual([q.x,q.y,q.z],[1,2,3]);
      assert.ok(q.life>=k.life0&&q.life<=k.life1&&q.size>=k.size0&&q.size<=k.size1);
    }
  }
  // The normal need not be tidy, or point along an axis.
  const odd={x:-3,y:4,z:.5};
  for(const q of HitFx.burst('sparks',p,odd,{rnd}))assert.ok(dot({x:q.vx,y:q.vy,z:q.vz},odd)>0);
  assert.equal(HitFx.burst('web',p,n,{rnd,scale:.5}).length,7,'LOW throws half');
  assert.equal(HitFx.burst('web',p,n,{rnd,scale:0}).length,1,'but always at least one');
  assert.deepEqual(HitFx.burst('nothing',p,n),[]);
});
test('hitfx: sparks off the rhino, symbiote off venom, web off all three',()=>{
  const kinds=id=>[...new Set(HitFx.hit(id,{x:0,y:0,z:0},{x:1,y:0,z:0},{rnd:seeded(3)}).map(q=>q.kind))].sort();
  assert.deepEqual(kinds('goblin'),['web']);
  assert.deepEqual(kinds('rhino'),['sparks','web']);
  assert.deepEqual(kinds('venom'),['symbiote','web']);
  for(const id of ['goblin','rhino','venom']){
    const s=HitFx.style(id);
    assert.ok(Math.max(...s.flash)>1,id+' flash must be bright enough to bloom');
  }
  assert.equal(HitFx.style('nobody'),HitFx.STYLES.goblin);
});
test('hitfx: particles fly, fall, fade and die; sparks fall, the wrap rises',()=>{
  let list=HitFx.burst('sparks',{x:0,y:10,z:0},{x:0,y:1,z:0},{rnd:seeded(5)});
  const n=list.length,life=Math.max(...list.map(q=>q.life));
  list=HitFx.step(list,.05);assert.equal(list.length,n);
  assert.ok(list.every(q=>q.y>10),'they leave upwards');
  assert.equal(HitFx.step(list,0),list,'no time, no change');
  for(let t=0;t<life;t+=.05)list=HitFx.step(list,.05);
  assert.equal(list.length,0,'all gone after their life');
  const q={age:0,life:1};assert.equal(HitFx.alpha(q),1);q.age=.8;assert.ok(Math.abs(HitFx.alpha(q)-.5)<1e-9);q.age=1;assert.equal(HitFx.alpha(q),0);
  // Sideways sparks come down; the wrap drifts up.
  let s=HitFx.burst('sparks',{x:0,y:0,z:0},{x:1,y:0,z:0},{rnd:seeded(9)});
  const vy0=s.reduce((a,q)=>a+q.vy,0)/s.length;
  for(let k=0;k<4;k++)s=HitFx.step(s,.05);
  assert.ok(s.reduce((a,q)=>a+q.vy,0)/s.length<vy0-1.5,'sparks should be pulled down');
  const still=k=>HitFx.step([{kind:k,x:0,y:0,z:0,vx:0,vy:0,vz:0,age:0,life:9,size:.1,drag:HitFx.KINDS[k].drag,g:HitFx.KINDS[k].g}],.2)[0].y;
  assert.ok(still('wrap')>0,'the wrap drifts up');assert.ok(still('symbiote')<0&&still('web')<0);
});
test('hitfx: the hit-stop holds a few frames and a second hit extends it rather than stacking',()=>{
  assert.ok(HitFx.HITSTOP_MS>=50&&HitFx.HITSTOP_MS<=100,'a few frames');
  const u=HitFx.stopUntil(1000,0);
  assert.equal(u,1000+HitFx.HITSTOP_MS);
  assert.ok(HitFx.stopped(1000,u)&&HitFx.stopped(u-1,u)&&!HitFx.stopped(u,u));
  assert.equal(HitFx.stopUntil(1030,u),1030+HitFx.HITSTOP_MS);
  assert.equal(HitFx.stopUntil(900,u),u,'an older hit never shortens it');
  assert.equal(HitFx.stopped(5,undefined),false);
});
test('hitfx: the defeat dissolve waits for his fall, then runs smoothly to gone before the VICTORY card',()=>{
  const D=HitFx.DISSOLVE;
  assert.equal(HitFx.dissolve(0),0);assert.equal(HitFx.dissolve(D.START),0);
  assert.equal(HitFx.dissolve(D.START+D.DUR),1);assert.equal(HitFx.dissolve(99),1);
  let last=0;
  for(let t=D.START;t<=D.START+D.DUR;t+=.01){const k=HitFx.dissolve(t);assert.ok(k>=last-1e-12);last=k;}
  assert.ok(Math.abs(HitFx.dissolve(D.START+D.DUR/2)-.5)<1e-9);
  // world-game.js shows VICTORY 1.8 s after the win.
  assert.ok(D.START+D.DUR<=1.8,'still dissolving when the card comes up');
});
