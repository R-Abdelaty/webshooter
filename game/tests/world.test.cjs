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
