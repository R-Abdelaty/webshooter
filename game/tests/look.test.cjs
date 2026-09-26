const test=require('node:test'),assert=require('node:assert/strict');
const Controller=require('../js/controller.js'),Look=require('../js/world/look.js');
const K=Look.constants,DEG=Math.PI/180;
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=(eps||1e-9),(msg||'')+' got '+a+', expected '+b);

// A controller position that puts the EDGE TURN crosshair at view point (vx, vy).
const posFor=(vx,vy)=>({x:.5+(vx-.5)/K.EDGE_GAIN_X,y:.5+(vy-.5)/K.EDGE_GAIN_Y});
const edge=(s,vx,vy,dt,extra)=>Look.step(s,Object.assign({pos:posFor(vx,vy),wrist:true,mode:'edge',speed:1,pitch:0},extra||{}),dt===undefined?1/60:dt);

// The same packet rig as game.test.cjs: 10 ms angle packets from current firmware.
function angleRig(){
  const c=Controller.create({horizontalAxis:'z',verticalAxis:'x',sensitivity:1,invertHorizontal:false,invertVertical:false});
  const st={ms:1000,seq:0,yaw:0,pitch:0};
  const send=(dyaw,dpitch,extra)=>{st.ms+=10;st.seq++;st.yaw+=dyaw;st.pitch+=dpitch;
    return Controller.aim(c,Object.assign({event:'aim',seq:st.seq,ms:st.ms,dyaw,dpitch,yaw:st.yaw,pitch:st.pitch,gx:dpitch*100,gy:0,gz:dyaw*100},extra||{}));};
  for(let i=0;i<100;i++)send(0,0);Controller.markCentre(c);c.source='wrist';
  return {c,st,send};
}

test('Look EDGE TURN: no turn anywhere inside the turn box',()=>{
  const s=Look.create();
  // Up to a hair inside the edge: at the edge itself the rate is continuous, so
  // rounding there gives 1e-33, not a turn.
  const steps=[-.999999,-.75,-.5,-.25,0,.25,.5,.75,.999999];
  for(const u of steps)for(const w of steps){const x=.5+u*K.BOX_X,y=.5+w*K.BOX_Y;
    const r=edge(s,x,y);
    assert.equal(r.dyaw,0,'turned sideways at '+x.toFixed(2)+','+y.toFixed(2));
    assert.equal(r.dpitch,0,'turned vertically at '+x.toFixed(2)+','+y.toFixed(2));
    assert.equal(r.turning,false);
  }
});

test('Look EDGE TURN: past the box edge the rate starts at zero and rises continuously to the maximum',()=>{
  let prev=0;
  for(let i=1;i<=200;i++){
    const off=K.BOX_X+(i/200)*K.RAMP_X,rate=-Look.turnRate(.5+off,.5,1).yaw;   // right: yaw goes negative
    assert.ok(rate>prev,'the rate did not rise at '+off.toFixed(3));
    assert.ok(rate-prev<K.MAX_YAW*.02,'the rate jumped at '+off.toFixed(3)+' ('+prev.toFixed(2)+' -> '+rate.toFixed(2)+')');
    prev=rate;
  }
  near(prev,K.MAX_YAW,1e-9,'full rate');
  assert.ok(-Look.turnRate(.5+K.BOX_X+1e-4,.5,1).yaw<.01,'there is a step at the box edge');
  near(Look.turnRate(5,.5,1).yaw,-K.MAX_YAW,1e-9,'far past the edge is not capped at full rate');
  near(Look.turnRate(-5,.5,1).yaw,K.MAX_YAW,1e-9,'left does not turn left at full rate');
  near(Look.turnRate(.5,-5,1).pitch,K.MAX_PITCH,1e-9,'above the box does not look up at full pitch rate');
  near(Look.turnRate(.5,5,1).pitch,-K.MAX_PITCH,1e-9,'below the box does not look down');
  near(Look.turnRate(5,.5,1.5).yaw,-K.MAX_YAW*1.5,1e-9,'TURN SPEED does not scale the rate');
  // And per frame: a full-rate second really is 140 degrees.
  const s=Look.create();let yaw=0;for(let i=0;i<60;i++)yaw+=edge(s,1.2,.5).dyaw;
  near(yaw/DEG,-K.MAX_YAW,1e-6,'a second at the right edge');
});

test('Look EDGE TURN: sweeping a full 360 needs only a wrist held past the edge, and stops when you come back',()=>{
  const s=Look.create();let yaw=0,t=0;
  while(yaw>-2*Math.PI&&t<10){yaw+=edge(s,.97,.5).dyaw;t+=1/60;}
  assert.ok(t<4,'a full turn took '+t.toFixed(1)+' s');
  const r=edge(s,.6,.5);
  assert.equal(r.dyaw,0,'still turning after coming back inside the box');assert.equal(r.turning,false);
});

test('Look EDGE TURN: the crosshair follows the wrist, is held on screen, and the mouse gets it in the middle',()=>{
  const s=Look.create();
  const r=Look.step(s,{pos:{x:.6,y:.45},wrist:true,mode:'edge'},1/60);
  near(r.crosshair.x,.5+.1*K.EDGE_GAIN_X);near(r.crosshair.y,.5-.05*K.EDGE_GAIN_Y);
  const off=Look.step(s,{pos:{x:1.4,y:-.4},wrist:true,mode:'edge'},1/60);
  near(off.crosshair.x,1-K.INSET);near(off.crosshair.y,K.INSET);
  const mouse=Look.step(s,{pos:{x:.9,y:.1},wrist:false,mode:'edge'},1/60);
  assert.deepEqual(mouse.crosshair,{x:.5,y:.5});assert.equal(mouse.dyaw,0);assert.equal(mouse.dpitch,0);
});

test('Look DIRECT: yaw follows the wrist with the gain, pitch is the wrist pitch, clamped to 75 degrees',()=>{
  const r=angleRig(),s=Look.create();
  let cam={yaw:0,pitch:0};
  const frame=()=>{const o=Look.step(s,{pos:{x:r.c.pos.x,y:r.c.pos.y},wrist:true,mode:'direct',pitch:cam.pitch},1/60);cam.yaw+=o.dyaw;cam.pitch+=o.dpitch;return o;};
  const first=frame();
  assert.deepEqual(first.crosshair,{x:.5,y:.5},'DIRECT does not keep the crosshair centred');
  for(let i=0;i<50;i++){r.send(.4,0);frame();}                  // 20 degrees of wrist to the right
  near(cam.yaw/DEG,-20*K.DIRECT_GAIN,1e-6,'yaw');
  for(let i=0;i<50;i++){r.send(-.4,0);frame();}                 // and back
  near(cam.yaw,0,1e-9,'coming back to the same wrist heading did not come back to the same view');
  for(let i=0;i<30;i++){r.send(0,1);frame();}                   // 30 degrees up
  near(cam.pitch/DEG,30*K.DIRECT_PITCH_GAIN,1e-6,'pitch');
  for(let i=0;i<100;i++){r.send(0,-1);frame();}                 // 70 degrees down from level
  near(cam.pitch/DEG,-70*K.DIRECT_PITCH_GAIN,1e-6,'pitch down');
  near(Look.directPitch(-5)/1,75,1e-9,'pitch above the clamp');near(Look.directPitch(5),-75,1e-9,'pitch below the clamp');
  // Sensitivity scales the yaw gain.
  const hi=angleRig();hi.c.settings.sensitivity=2;const s2=Look.create();let yaw2=0;
  Look.step(s2,{pos:hi.c.pos,wrist:true,mode:'direct'},1/60);
  for(let i=0;i<25;i++){hi.send(.4,0);yaw2+=Look.step(s2,{pos:{x:hi.c.pos.x,y:hi.c.pos.y},wrist:true,mode:'direct'},1/60).dyaw;}
  near(yaw2/DEG,-10*K.DIRECT_GAIN*2,1e-6,'sensitivity 2');
});

test('Look DIRECT: a recentre, a hold or the mouse taking over is not a turn',()=>{
  const s=Look.create();
  Look.step(s,{pos:{x:.7,y:.5},wrist:true,mode:'direct'},1/60);
  assert.equal(Look.step(s,{pos:{x:.5,y:.5},wrist:true,mode:'direct',rebase:true},1/60).dyaw,0,'the recentre jump turned the view');
  assert.equal(Look.step(s,{pos:{x:.8,y:.5},wrist:true,mode:'direct',hold:true},1/60).dyaw,0,'turned while paused');
  assert.equal(Look.step(s,{pos:{x:.8,y:.5},wrist:true,mode:'direct'},1/60).dyaw,0,'the move made while paused was applied on resume');
  Look.step(s,{pos:{x:.1,y:.5},wrist:false,mode:'direct'},1/60);
  assert.equal(Look.step(s,{pos:{x:.3,y:.5},wrist:true,mode:'direct'},1/60).dyaw,0,'the wrist taking back over turned the view');
});

test('Look: a flick never changes the camera, in either mode',()=>{
  for(const mode of ['edge','direct']){
    const r=angleRig(),s=Look.create();let yaw=0,pitch=0;
    const frame=()=>{const o=Look.step(s,{pos:{x:r.c.pos.x,y:r.c.pos.y},wrist:true,mode,pitch,frozen:!!(r.c.last&&r.c.last.flick)},1/60);yaw+=o.dyaw;pitch+=o.dpitch;};
    for(let i=0;i<40;i++){r.send(.2,.1);frame();}
    for(let i=0;i<20;i++){r.send(0,0);frame();}
    const before={yaw,pitch},preYaw=r.st.yaw,prePitch=r.st.pitch;
    // The device flags the snap. However wild it is, nothing may turn.
    [-12,-30,40,-60,25].forEach(d=>{r.send(d,d/2,{flick:true});frame();
      assert.equal(yaw,before.yaw,mode+': a flick packet turned the view');assert.equal(pitch,before.pitch,mode+': a flick packet pitched the view');});
    Controller.shot(r.c,{event:'shoot',seq:1,ms:r.st.ms,preYaw,prePitch});
    r.send(-6,-3,{flick:true});frame();                                        // still flagged: wrist on its way back
    r.send(preYaw-r.st.yaw,prePitch-r.st.pitch);frame();                       // settled at the pre-flick heading
    near(yaw,before.yaw,1e-9,mode+' yaw after the flick');near(pitch,before.pitch,1e-9,mode+' pitch after the flick');
  }
  // EDGE TURN past the box: a turn in progress is held, not continued, while the snap runs.
  const s=Look.create();
  assert.ok(edge(s,.99,.5).dyaw<0);
  const r=edge(s,.99,.5,1/60,{frozen:true});assert.equal(r.dyaw,0);assert.equal(r.dpitch,0);
});

test('Look: the shot ray uses the camera from just before the flick, though the view has turned since',()=>{
  const s=Look.create(),eye={x:0,y:10,z:0};
  // Frames every 10 ms of device time. The view looks north, level, until
  // t=1500, then turns hard left.
  for(let t=1000;t<=1800;t+=10){
    const yaw=t<1500?0:(t-1500)/300*Math.PI/2;
    Look.record(s,t,{yaw,pitch:t<1500?0:.3,eye});
  }
  const flick={event:'shoot',seq:1,ms:1540,preYaw:0,prePitch:0};             // aimed at t=1460
  const cam=Look.cameraAt(s,Look.shotTime(flick));
  assert.equal(cam.yaw,0);assert.equal(cam.pitch,0);
  const d=Look.ray(cam,{x:.5,y:.5},75,16/9);
  near(d.x,0);near(d.y,0);near(d.z,-1);
  const now=Look.ray({yaw:Math.PI/2,pitch:.3},{x:.5,y:.5},75,16/9);
  assert.ok(Math.hypot(d.x-now.x,d.y-now.y,d.z-now.z)>1,'the test view did not really turn');
  // Too old for the history: the oldest camera kept, never a later one.
  assert.equal(Look.cameraAt(s,0).yaw,0);
  assert.equal(Look.cameraAt(Look.create(),1000),null);
});

test('Look: rays through the view point where the camera looks',()=>{
  const fov=75,aspect=16/9,th=Math.tan(fov/2*DEG)*aspect,tv=Math.tan(fov/2*DEG);
  const west=Look.ray({yaw:Math.PI/2,pitch:0},{x:.5,y:.5},fov,aspect);near(west.x,-1);near(west.z,0);
  const up=Look.ray({yaw:0,pitch:30*DEG},{x:.5,y:.5},fov,aspect);near(Math.asin(up.y)/DEG,30,1e-9);near(up.x,0);
  const right=Look.ray({yaw:0,pitch:0},{x:1,y:.5},fov,aspect);near(Math.atan2(right.x,-right.z),Math.atan(th),1e-12);
  const top=Look.ray({yaw:0,pitch:0},{x:.5,y:0},fov,aspect);near(Math.atan2(top.y,-top.z),Math.atan(tv),1e-12);
  // A wrist turned right puts the EDGE TURN ray right of centre, on the horizon.
  const c=Look.crosshair({x:.55,y:.5},'edge',true),r=Look.ray({yaw:0,pitch:0},c,fov,aspect);
  assert.ok(r.x>0);near(r.y,0);
});
