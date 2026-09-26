const test=require('node:test'),assert=require('node:assert/strict');
const City=require('../js/world/city.js'),Encounters=require('../js/world/encounters.js'),Traffic=require('../js/world/traffic.js');
const Gfx=require('../js/world/gfx.js'),SoundCues=require('../js/world/sound-cues.js');

const city=City.generate(20180907),spots=Encounters.build(city),sim=Traffic.create(city);
const [goblin,rhino,venom]=spots.fights;
const within=(p,r,pad=0)=>p.x>=r.x0-pad&&p.x<=r.x1+pad&&p.z>=r.z0-pad&&p.z<=r.z1+pad;
const K=Traffic.constants,L=city.layout;
// Times spread over a few minutes of play.
const TIMES=[0,3.7,11.2,47.5,128.9,301.3];

// --- traffic --------------------------------------------------------------------------
test('traffic: the same city always gets the same cars and walkers',()=>{
  const b=Traffic.create(City.generate(20180907));
  assert.deepEqual(b.routes,sim.routes);assert.deepEqual(b.cars,sim.cars);assert.deepEqual(b.people,sim.people);
  assert.ok(sim.cars.length>800&&sim.people.length>2000,'a busy city');
  assert.ok(sim.cars.some(c=>c.cab)&&sim.cars.some(c=>!c.cab),'cabs and cars');
});
test('traffic: a loop is continuous and faces the way it goes, both ways round',()=>{
  const lp=Traffic.loop(0,40,0,20,5);
  for(const back of [false,true])for(let s=0;s<lp.len;s+=.25){
    const a=Traffic.pointOn(lp,s,back),b=Traffic.pointOn(lp,s+.25,back);
    assert.ok(Math.hypot(b.x-a.x,b.z-a.z)<.26,'no jump at '+s);
    // Facing (yaw 0 = -z, positive turns left): forward = (-sin, -cos).
    const fx=-Math.sin(a.yaw),fz=-Math.cos(a.yaw),mx=b.x-a.x,mz=b.z-a.z;
    assert.ok(fx*mx+fz*mz>.2,'faces its travel at '+s+(back?' (back)':''));
  }
  // Clockwise seen from above with north up: east along the north side.
  const p=Traffic.pointOn(lp,10);assert.equal(p.z,0);assert.ok(Math.abs(p.yaw+Math.PI/2)<1e-9);
});
test('traffic: the tilings cover every block but the park exactly once',()=>{
  const inPark=(i,j)=>i>=L.PARK.i0&&i<=L.PARK.i1&&j>=L.PARK.j0&&j<=L.PARK.j1;
  for(const [w,h,oi,oj] of [[2,2,0,0],[2,3,1,1]]){
    const seen={};
    Traffic.tiles(L.BLOCKS_X,L.BLOCKS_Z,inPark,w,h,oi,oj).forEach(t=>{
      assert.ok(t.i1-t.i0<w&&t.j1-t.j0<h,'too big');
      for(let i=t.i0;i<=t.i1;i++)for(let j=t.j0;j<=t.j1;j++){assert.ok(!inPark(i,j));assert.ok(!seen[i+','+j],'twice');seen[i+','+j]=1;}
    });
    assert.equal(Object.keys(seen).length,L.BLOCKS_X*L.BLOCKS_Z-3*6);
  }
});
test('traffic: cars are always on a road, never on a block or in the park, and keep to the right',()=>{
  const roads=city.roads,P=City.PARK_RECT;
  // The whole width of the car (1.9 m) is on tarmac, whichever way it faces.
  const onRoad=p=>[[.95,0],[-.95,0],[0,.95],[0,-.95]].every(o=>roads.some(r=>within({x:p.x+o[0],z:p.z+o[1]},r)));
  for(const t of TIMES)for(const car of sim.cars){
    const p=Traffic.carAt(sim,car,t);
    assert.ok(onRoad(p),'a car off the road at '+p.x.toFixed(1)+','+p.z.toFixed(1));
    assert.ok(!city.blocks.some(b=>within(p,b,1))&&!within(p,P,1),'on a pavement');
    // On a straight stretch of avenue: southbound west of the centre line, northbound east of it.
    const av=roads.find(r=>r.kind==='avenue'&&within(p,r,-.9));
    if(av&&Math.abs(Math.sin(p.yaw))<1e-6){const cx=(av.x0+av.x1)/2,south=Math.cos(p.yaw)<0;assert.ok(south?p.x<cx:p.x>cx,'wrong side of the avenue');}
  }
});
test('traffic: cars never run into each other outside a junction',()=>{
  const junctions=city.roads.filter(r=>r.kind==='intersection');
  // Two cars touch when the other is within a car's length ahead or behind
  // and within its width to the side (cars are 4.4 x 1.9 m). A junction
  // takes in its mouth, where cars round the corner.
  const touch=(p,q)=>{const dx=q.x-p.x,dz=q.z-p.z,fx=-Math.sin(p.yaw),fz=-Math.cos(p.yaw);return Math.abs(dx*fx+dz*fz)<4.6&&Math.abs(dx*-fz+dz*fx)<2.1;};
  for(const t of TIMES){
    const ps=sim.cars.map(c=>Traffic.carAt(sim,c,t));
    const cells={};ps.forEach((p,i)=>{const k=Math.floor(p.x/10)+','+Math.floor(p.z/10);(cells[k]=cells[k]||[]).push(i);});
    ps.forEach((p,i)=>{
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)(cells[(Math.floor(p.x/10)+dx)+','+(Math.floor(p.z/10)+dz)]||[]).forEach(j=>{
        if(j<=i)return;const q=ps[j];
        if(!touch(p,q)&&!touch(q,p))return;
        assert.ok(junctions.some(r=>within(p,r,K.CORNER+1))&&junctions.some(r=>within(q,r,K.CORNER+1)),'two cars '+Math.hypot(p.x-q.x,p.z-q.z).toFixed(2)+' m apart at t '+t);
      });
    });
  }
});
test('traffic: walkers stay on the pavement, off the road and out of the buildings',()=>{
  const S=L.SIDEWALK,P=City.PARK_RECT,pm=city.promenade;
  for(const t of TIMES)for(const w of sim.people){
    const p=Traffic.personAt(sim,w,t);
    assert.ok(p.phase>=0&&p.phase<1);
    const onBlock=[...city.blocks,P].some(b=>within(p,b)&&!within(p,{x0:b.x0+S-.5,x1:b.x1-S+.5,z0:b.z0+S-.5,z1:b.z1-S+.5}));
    const onPromenade=p.x>pm.x0+6.5&&p.x<pm.x1&&Math.abs(p.y-pm.top)<1e-9;
    assert.ok(onBlock||onPromenade,'a walker at '+p.x.toFixed(1)+','+p.z.toFixed(1));
    assert.ok(!city.roads.some(r=>within(p,r,-.2)),'on the road');
  }
});
test('traffic: near() gives the nearest, within range, at most max, only the density\'s share',()=>{
  const eye={x:city.spawn.x,y:2,z:city.spawn.z},out=[];
  const n=Traffic.near(sim,'cars',eye,{range:300,max:50,density:1},12,out);
  assert.equal(n,50);assert.equal(out.length,50);
  for(let i=1;i<n;i++)assert.ok(out[i].d>=out[i-1].d);
  assert.ok(out.every(e=>e.d<=300&&Math.abs(Math.hypot(e.x-eye.x,e.z-eye.z)-e.d)<1e-9));
  const all=[];Traffic.near(sim,'cars',eye,{range:300,density:1},12,all);
  assert.ok(all.length>50);assert.deepEqual(out.map(e=>e.item),all.slice(0,50).map(e=>e.item),'the nearest 50');
  const half=[];Traffic.near(sim,'cars',eye,{range:300,density:.5},12,half);
  assert.ok(half.length<all.length*.7&&half.length>all.length*.3);
  const kept=new Set(all.map(e=>e.item));assert.ok(half.every(e=>kept.has(e.item)&&e.item.rank<.5),'LOW is a subset of MED');
  assert.ok(Traffic.near(sim,'people',eye,{range:120,max:40},12,[])<=40);
});
test('traffic: the Rhino\'s avenue empties for his fight; the Goblin\'s rooftop fight empties nothing',()=>{
  const out=[],eye={x:rhino.vantage.x,y:rhino.vantage.y,z:rhino.vantage.z};
  Traffic.clear(sim,Encounters.focus(goblin));
  assert.equal(Object.keys(sim.hidden.routes).length+Object.keys(sim.hidden.walks).length,0);
  const f=Encounters.focus(rhino),p=rhino.path;
  Traffic.clear(sim,f);
  assert.ok(Object.keys(sim.hidden.routes).length>0);
  for(const t of TIMES){
    Traffic.near(sim,'cars',eye,{range:500},t,out);
    assert.ok(out.every(e=>!(Math.abs(e.x-p.x)<p.lane+4&&e.z>p.z0-8&&e.z<p.z1+8)),'a car in the Rhino\'s charge');
    Traffic.near(sim,'people',eye,{range:200},t,out);
    assert.ok(out.every(e=>Math.hypot(e.x-f.x,e.z-f.z)>f.r),'a walker in his way');
  }
  Traffic.clear(sim,null);assert.equal(Object.keys(sim.hidden.routes).length,0,'free roam brings them back');
});
test('traffic: the street is loud down among the cars and quiet up on a roof',()=>{
  const cars=[{d:3},{d:8},{d:15},{d:30}];
  const street=Traffic.noise(cars,{y:1.7}),roof=Traffic.noise(cars,{y:120});
  assert.ok(street>.5&&street<=1&&roof<street/3);
  assert.equal(Traffic.noise([],{y:1.7}),0);
});

// --- graphics tiers: draw distance and traffic ------------------------------------------
test('gfx: LOW draws less far and fewer cars and walkers, and the haze hides the far plane on both',()=>{
  const [lo,md]=Gfx.names().map(Gfx.tier);
  assert.ok(lo.far<md.far&&lo.fog>md.fog);
  for(const t of [lo,md]){
    assert.ok(Gfx.clarity(t.far,t.fog)<.05,t.name+': the far plane shows through the haze');
    assert.ok(Gfx.clarity(300,t.fog)>.75,t.name+': the near city is too hazy');
  }
  for(const k of ['cars','people'])assert.ok(lo[k].density<md[k].density&&lo[k].range<md[k].range&&lo[k].max<md[k].max,k);
  const t=Gfx.tier('med');t.cars.max=1;assert.equal(Gfx.tier('med').cars.max,md.cars.max,'tier() hands out deep copies');
});

// --- positional sound cues --------------------------------------------------------------
test('sound: clips become sounds at the villain, and nothing without him',()=>{
  const c=SoundCues.create('charge'),f={at:{x:1,y:0,z:2},mode:'playing'};
  const out=SoundCues.step(c,f,[['entrance',{}],['roar',{}],['idle',{}]],0,.016);
  assert.deepEqual(out.cues.map(q=>q.name),['thud','roar']);
  assert.ok(out.cues[0].delay>0,'the drop-in lands a moment after it starts');
  assert.deepEqual(out.cues[1].at,{x:1,y:1.2,z:2});
  assert.equal(SoundCues.step(c,{at:null},[['roar',{}]],0,.016).cues.length,0);
  assert.deepEqual(SoundCues.step(SoundCues.create('leap'),f,[['dodge_r',{}],['land',{}]],0,.016).cues.map(q=>q.name),['whoosh','thud']);
});
test('sound: the rhino\'s footfalls keep time with his speed, and stop when he does',()=>{
  const c=SoundCues.create('charge'),f={at:{x:0,y:0,z:0},mode:'playing'};
  const steps=(v,sec)=>{let n=0;for(let t=0;t<sec;t+=1/60)n+=SoundCues.step(c,f,[],v,1/60).cues.filter(q=>q.name==='step').length;return n;};
  const fast=steps(7.4,10),slow=steps(3,10);
  assert.ok(Math.abs(fast-7.4*10/SoundCues.constants.STRIDE)<=1,'fast '+fast);
  assert.ok(Math.abs(slow-3*10/SoundCues.constants.STRIDE)<=1,'slow '+slow);
  assert.equal(steps(0,5),0);
  assert.equal(steps(7.4,0),0);
  // A paused fight (dt 0) makes no footfalls.
  let n=0;for(let k=0;k<100;k++)n+=SoundCues.step(c,f,[],7.4,0).cues.length;assert.equal(n,0);
});
test('sound: the glider hums where the goblin is, until he is beaten',()=>{
  const c=SoundCues.create('glider');
  const out=SoundCues.step(c,{at:{x:3,y:200,z:4},vel:{x:3,y:0,z:4},mode:'playing'},[],null,.016);
  assert.deepEqual(out.hum.at,{x:3,y:201.2,z:4});assert.equal(out.hum.speed,5);
  assert.equal(SoundCues.step(c,{at:{x:3,y:200,z:4},mode:'won'},[],null,.016).hum,null);
  assert.equal(SoundCues.step(SoundCues.create('leap'),{at:{x:0,y:0,z:0},mode:'playing'},[],null,.016).hum,null);
});
