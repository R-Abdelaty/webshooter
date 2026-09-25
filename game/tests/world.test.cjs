const test=require('node:test'),assert=require('node:assert/strict');
const Move=require('../js/world/move.js');

// --- Move -----------------------------------------------------------------
test('Move: keyboard keys map to strafe and forward, and diagonals are clamped to length 1',()=>{
  const m=Move.create(),kb=m.addSource(Move.keyboard());
  assert.deepEqual(m.vector(),{x:0,z:0});
  kb.press('KeyW',true);assert.deepEqual(m.vector(),{x:0,z:1});
  kb.press('KeyD',true);
  const v=m.vector();
  assert.ok(Math.abs(Math.hypot(v.x,v.z)-1)<1e-12,'diagonal is not length 1');
  assert.ok(v.x>0&&v.z>0);
  kb.press('KeyW',false);kb.press('KeyD',false);kb.press('ArrowLeft',true);kb.press('ArrowDown',true);
  const w=m.vector();assert.ok(w.x<0&&w.z<0);
  kb.release();assert.deepEqual(m.vector(),{x:0,z:0});
});
test('Move: opposite keys cancel and unknown keys are ignored',()=>{
  const m=Move.create(),kb=m.addSource(Move.keyboard());
  kb.press('KeyA',true);kb.press('KeyD',true);assert.deepEqual(m.vector(),{x:0,z:0});
  assert.equal(kb.press('KeyQ',true),false);
});
test('Move: several sources are summed, then clamped to length 1',()=>{
  const m=Move.create();
  m.addSource({vector:()=>({x:.3,z:.4})});
  assert.deepEqual(m.vector(),{x:.3,z:.4});
  const stick={vector:()=>({x:.9,z:.8})};m.addSource(stick);
  const v=m.vector();
  assert.ok(Math.abs(Math.hypot(v.x,v.z)-1)<1e-12);
  assert.ok(Math.abs(v.x/v.z-1.2/1.2)<1e-12,'the direction of the sum was not kept');
  m.removeSource(stick);assert.deepEqual(m.vector(),{x:.3,z:.4});
  // A source reporting nonsense cannot poison the others.
  m.addSource({vector:()=>({x:NaN,z:undefined})});assert.deepEqual(m.vector(),{x:.3,z:.4});
});
test('Move: buttons are OR-ed across sources',()=>{
  const m=Move.create(),kb=m.addSource(Move.keyboard());
  assert.deepEqual(m.buttons(),{jump:false,sprint:false});
  m.addSource({vector:()=>({x:0,z:0}),buttons:()=>({jump:true})});
  kb.press('ShiftLeft',true);
  assert.deepEqual(m.buttons(),{jump:true,sprint:true});
});
test('Move: the keyboard follows real key events and lets go on blur',()=>{
  const handlers={},target={addEventListener:(t,f)=>{handlers[t]=f;}};
  const m=Move.create();m.addSource(Move.keyboard(target));
  handlers.keydown({code:'KeyW',target:{tagName:'CANVAS'}});assert.deepEqual(m.vector(),{x:0,z:1});
  handlers.keyup({code:'KeyW'});assert.deepEqual(m.vector(),{x:0,z:0});
  // Typing the shooter address in settings must not walk you anywhere.
  handlers.keydown({code:'KeyW',target:{tagName:'INPUT'}});assert.deepEqual(m.vector(),{x:0,z:0});
  handlers.keydown({code:'Space',target:{tagName:'CANVAS'}});assert.equal(m.buttons().jump,true);
  handlers.blur();assert.equal(m.buttons().jump,false);
});

// --- City -----------------------------------------------------------------
const City=require('../js/world/city.js'),Player=require('../js/world/player.js');
const city=City.generate(1337);
const solidAt=(c,x,z,y0,y1,r)=>c.colliders.filter(b=>b.y1>y0+1e-6&&b.y0<y1-1e-6&&x+r>b.x0&&x-r<b.x1&&z+r>b.z0&&z-r<b.z1);

test('City: the same seed always builds the same city, and a different seed a different one',()=>{
  assert.equal(JSON.stringify(City.generate(1337)),JSON.stringify(city));
  assert.notEqual(JSON.stringify(City.generate(1338).buildings),JSON.stringify(city.buildings));
});
test('City: it is about 1.2 km square with a real mix of buildings',()=>{
  const b=city.bounds;
  assert.ok(b.x1-b.x0>1150&&b.x1-b.x0<1300);assert.ok(b.z1-b.z0>1150&&b.z1-b.z0<1300);
  const types=new Set(city.buildings.map(x=>x.type));
  ['brick','sandstone','office','glass'].forEach(t=>assert.ok(types.has(t),'no '+t+' buildings'));
  assert.ok(city.buildings.filter(x=>x.landmark).length>=3,'missing the landmark supertalls');
  assert.ok(city.buildings.some(x=>x.tiers.length>1),'no setbacks anywhere');
  assert.ok(city.props.some(p=>p.kind==='tank')&&city.props.some(p=>p.kind==='ac'),'no roof details');
});
test('City: no building, roof prop or site part overlaps a road',()=>{
  const solid=[];
  city.buildings.forEach(b=>b.tiers.forEach(t=>solid.push(['building '+b.id,t])));
  city.props.forEach(p=>solid.push([p.kind,p]));
  city.site.parts.forEach(p=>solid.push(['site '+p.kind,p]));
  city.parapets.forEach(p=>solid.push(['parapet',p]));
  for(const [name,s] of solid)for(const r of city.roads)
    assert.ok(!City.overlaps(s,r),name+' overlaps the '+r.kind+' at '+r.x0+','+r.z0);
});
test('City: every building stands inside its block, off the sidewalk',()=>{
  const L=City.layout;
  city.buildings.forEach(b=>{
    const blk=city.blocks.find(k=>b.x0>=k.x0&&b.x1<=k.x1&&b.z0>=k.z0&&b.z1<=k.z1);
    assert.ok(blk,'building '+b.id+' is not on a block');
    b.tiers.forEach(t=>assert.ok(t.x0>=blk.x0+L.SIDEWALK-1e-6&&t.x1<=blk.x1-L.SIDEWALK+1e-6&&t.z0>=blk.z0+L.SIDEWALK-1e-6&&t.z1<=blk.z1-L.SIDEWALK+1e-6,'building '+b.id+' is on the sidewalk'));
  });
});
test('City: the spawn point is on a tall open roof',()=>{
  const s=city.spawn,b=city.buildings.find(x=>x.id===s.building),top=b.tiers[b.tiers.length-1];
  assert.ok(s.x>top.x0+2&&s.x<top.x1-2&&s.z>top.z0+2&&s.z<top.z1-2,'spawn is not over the roof');
  assert.equal(s.y,top.y1);assert.ok(s.y>150,'the spawn roof is not tall');
  assert.deepEqual(solidAt(city,s.x,s.z,s.y,s.y+1.8,.5),[],'something is in the way on the spawn spot');
  // And you stay there: gravity puts you on the roof, not through it.
  const p=Player.create(s);for(let i=0;i<120;i++)Player.step(p,{},1/60,city);
  assert.equal(p.y,s.y);assert.equal(p.grounded,true);
});
test('City: a park of about 3 x 6 blocks with trees and a pond, and a construction site',()=>{
  const L=City.layout,pk=city.park;
  assert.equal(L.PARK.i1-L.PARK.i0+1,3);assert.equal(L.PARK.j1-L.PARK.j0+1,6);
  assert.ok(pk.trees.length>300,'too few park trees');
  pk.trees.forEach(t=>assert.ok(Math.pow((t.x-pk.pond.x)/pk.pond.rx,2)+Math.pow((t.z-pk.pond.z)/pk.pond.rz,2)>1,'a tree is in the pond'));
  assert.ok(!city.roads.some(r=>City.inside(r,pk.rect)),'a road runs through the park');
  const kinds=new Set(city.site.parts.map(p=>p.kind));
  ['steel','slab','scaffold','brick','pallet','tarp','fence','crane'].forEach(k=>assert.ok(kinds.has(k),'the site has no '+k));
  city.site.parts.forEach(p=>assert.ok(City.inside(p,city.site.rect),'a site part leaves its block'));
  assert.ok(city.water.x1<=city.bounds.x0,'the water is not along the edge');
});

// --- Player -----------------------------------------------------------------
const boxCity=(boxes,walk)=>({colliders:boxes,walk:walk||{x0:-100,x1:100,z0:-100,z1:100}});
test('Player: push-out keeps you out of a box from every side, even sprinting',()=>{
  const wall={x0:-2,x1:2,y0:0,y1:10,z0:-2,z1:2},c=boxCity([wall]),R=Player.constants.RADIUS;
  for(let a=0;a<16;a++){
    const ang=a/16*Math.PI*2,p=Player.create({x:Math.cos(ang)*8,z:Math.sin(ang)*8});
    // Face the box's centre and run at it for three seconds.
    p.yaw=Math.atan2(Math.cos(ang),Math.sin(ang));
    let closest=Infinity;
    for(let i=0;i<180;i++){
      Player.step(p,{move:{x:0,z:1},buttons:{sprint:true}},1/60,c);
      const cx=Math.max(wall.x0,Math.min(p.x,wall.x1)),cz=Math.max(wall.z0,Math.min(p.z,wall.z1));
      const gap=Math.hypot(p.x-cx,p.z-cz);closest=Math.min(closest,gap);
      assert.ok(gap>=R-1e-9,'inside the box at angle '+a+' step '+i);
    }
    // Pressed right up against it (and then, off-centre, slid along it).
    assert.ok(closest<R+.05,'never reached the box from angle '+a);
  }
});
test('Player: push-out alone moves a circle out of a box, including from inside it',()=>{
  const b={x0:0,x1:4,y0:0,y1:3,z0:0,z1:4};
  const p={x:3.9,z:2};assert.equal(Player.pushOut(p,.5,b),true);assert.ok(Math.abs(p.x-4.5)<1e-9);
  const q={x:-.2,z:2};Player.pushOut(q,.5,b);assert.ok(Math.abs(q.x+.5)<1e-9);
  const far={x:10,z:10};assert.equal(Player.pushOut(far,.5,b),false);
});
test('Player: kerbs are stepped onto, walls are not, and big drops are fallen down',()=>{
  const kerb={x0:2,x1:20,y0:0,y1:.15,z0:-20,z1:20},wall={x0:30,x1:31,y0:0,y1:3,z0:-20,z1:20};
  const c=boxCity([kerb,wall]),p=Player.create({x:0,z:0,yaw:-Math.PI/2});   // facing east
  for(let i=0;i<60;i++)Player.step(p,{move:{x:0,z:1}},1/60,c);
  assert.equal(p.y,.15);assert.ok(p.x>2);
  for(let i=0;i<300;i++)Player.step(p,{move:{x:0,z:1}},1/60,c);
  assert.ok(p.x<=30-Player.constants.RADIUS+1e-9,'walked through the wall');
  const roof={x0:-5,x1:5,y0:0,y1:50,z0:-5,z1:5},fall=Player.create({x:0,y:50,z:0,yaw:0});
  for(let i=0;i<300;i++)Player.step(fall,{move:{x:0,z:1}},1/60,boxCity([roof]));
  assert.equal(fall.y,0,'did not fall off the roof');assert.equal(fall.grounded,true);
});
test('Player: jumping clears a parapet, and walk and sprint speeds are right',()=>{
  const c=boxCity([]),p=Player.create({});
  let top=0;Player.step(p,{buttons:{jump:true}},1/60,c);
  for(let i=0;i<120;i++){Player.step(p,{},1/60,c);top=Math.max(top,p.y);}
  assert.ok(top>.8&&top<1.3,'jump height '+top);assert.equal(p.y,0);
  for(let i=0;i<120;i++)Player.step(p,{move:{x:0,z:1}},1/60,c);
  assert.ok(Math.abs(p.speed-6)<1e-6,'walk '+p.speed);
  for(let i=0;i<120;i++)Player.step(p,{move:{x:0,z:1},buttons:{sprint:true}},1/60,c);
  assert.ok(Math.abs(p.speed-14)<1e-6,'sprint '+p.speed);
});
test('Player: forward follows yaw, and pitch is clamped to 75 degrees',()=>{
  const f=Player.forward(0);assert.ok(Math.abs(f.x)<1e-12&&f.z===-1);
  const e=Player.forward(-Math.PI/2);assert.ok(Math.abs(e.x-1)<1e-12,'yaw -90 should face east');
  const p=Player.create({});Player.look(p,0,5);assert.ok(Math.abs(p.pitch-75*Math.PI/180)<1e-12);
  Player.look(p,0,-10);assert.ok(Math.abs(p.pitch+75*Math.PI/180)<1e-12);
  Player.look(p,7*Math.PI,0);assert.ok(p.yaw<=Math.PI&&p.yaw>-Math.PI);
});
test('Player: you cannot walk off the edge of the city or into the river',()=>{
  const p=Player.create({x:city.walk.x0+1,y:.4,z:0,yaw:Math.PI/2});   // facing west, on the promenade
  for(let i=0;i<300;i++)Player.step(p,{move:{x:0,z:1},buttons:{sprint:true}},1/60,city);
  assert.ok(p.x>=city.walk.x0,'went into the river');
});
