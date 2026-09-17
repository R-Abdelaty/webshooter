const test=require('node:test'),assert=require('node:assert/strict');
const Combat=require('../js/combat.js'),Controller=require('../js/controller.js');
const levels=require('../js/levels.js');
const target={x:50,y:50,radius:20};

test('each encounter starts with its villain health and approach window',()=>{
  assert.deepEqual(levels.map(level=>level.approachDuration),[8,6.5,5.5]);
  assert.deepEqual(levels.map(level=>level.lungeDuration),[.38,.34,.3]);
  levels.forEach((level,index)=>{const state=Combat.start(index,levels);assert.equal(state.health,level.health);assert.equal(state.approachDuration,level.approachDuration);assert.equal(state.approachElapsed,0);assert.equal(state.mode,'intro');});
});
test('hit damages twenty and advances target; miss does not',()=>{
  const state=Combat.play(Combat.start(0,levels));
  assert.deepEqual(Combat.fire(state,{x:0,y:0},target),{accepted:true,hit:false});
  assert.equal(state.health,100);assert.equal(state.targetIndex,0);
  Combat.tick(state,.35);Combat.fire(state,{x:50,y:50},target);
  assert.equal(state.health,80);assert.equal(state.targetIndex,1);
});
test('approach continues through hits and loss happens on contact',()=>{
  const state=Combat.play(Combat.start(0,levels));
  Combat.tick(state,3);Combat.fire(state,{x:50,y:50},target);
  assert.equal(state.approachElapsed,3);assert.equal(state.health,80);
  Combat.tick(state,4.99);assert.equal(state.mode,'playing');
  Combat.tick(state,.01);assert.equal(state.mode,'lost');assert.equal(state.health,80);
  assert.equal(Combat.fire(state,{x:50,y:50},target).accepted,false);
});
test('pause freezes approach and cooldown; retry resets both',()=>{
  const state=Combat.play(Combat.start(0,levels));Combat.fire(state,{x:50,y:50},target);Combat.tick(state,3);Combat.pause(state);Combat.tick(state,100);
  assert.equal(state.approachElapsed,3);assert.equal(state.cooldownRemaining,0);
  const retry=Combat.start(0,levels);assert.equal(retry.health,100);assert.equal(retry.approachElapsed,0);assert.equal(retry.targetIndex,0);assert.equal(retry.hits,0);assert.equal(retry.shots,0);
});
test('five hits defeat the first villain before contact',()=>{
  const state=Combat.play(Combat.start(0,levels));for(let i=0;i<5;i++){Combat.tick(state,.35);Combat.fire(state,{x:50,y:50},target);}assert.equal(state.mode,'won');Combat.tick(state,100);assert.equal(state.mode,'won');
});
test('controller validates packets and integrates configured axes',()=>{let c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false});c.source='wrist';Controller.aim(c,{seq:1,ms:0,gx:0,gy:0,gz:10,armed:true});Controller.aim(c,{seq:2,ms:100,gx:0,gy:0,gz:10,armed:true});assert.ok(c.pos.x>.5);let x=c.pos.x;assert.equal(Controller.aim(c,{seq:2,ms:101,gx:0,gy:0,gz:10,armed:true}),false);assert.equal(c.pos.x,x)});
test('dead zone, center, gaps, and pre-flick aim are stable',()=>{let c=Controller.create();c.source='wrist';Controller.aim(c,{seq:1,ms:0,gx:0,gy:0,gz:.5,armed:true});Controller.aim(c,{seq:2,ms:100,gx:0,gy:0,gz:.5,armed:true});assert.equal(c.pos.x,.5);Controller.aim(c,{seq:3,ms:500,gx:0,gy:0,gz:100,armed:true});assert.equal(c.pos.x,.5);c.history=[{ms:900,x:.2,y:.3},{ms:950,x:.7,y:.8}];assert.deepEqual(Controller.shot(c,{ms:1030}),{x:.7,y:.8});Controller.center(c);assert.deepEqual(c.pos,{x:.5,y:.5})});
