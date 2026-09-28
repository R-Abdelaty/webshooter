// Session P9 (docs/PLAYER_PLAN.md): arms alive in the air - the first-person air clips PlayerAnim
// picks, the body's air blend and lean, and ArmMotion's procedural layer.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const Rig=require('../js/world/rig.js'),PlayerAnim=require('../js/world/player-anim.js'),ArmMotion=require('../js/world/arm-motion.js');
const MODELS=path.join(__dirname,'../assets/models');
const manifest=JSON.parse(fs.readFileSync(path.join(MODELS,'characters.json'),'utf8'));
const BODY=manifest.player.spiderman,ARMS=manifest.player.spiderman_arms,K=ArmMotion.constants,A=PlayerAnim.constants;
function clipsOf(file){
  const b=fs.readFileSync(path.join(MODELS,file)),j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)).toString());
  const c={};(j.animations||[]).forEach(a=>{c[a.name]=Math.max(...a.samplers.map(s=>j.accessors[s.input].max[0]));});return c;
}
const bodyClips=clipsOf(BODY.file),armsClips=clipsOf(ARMS.file);
const armsMachine=()=>Rig.machine({clips:armsClips,loops:ARMS.loops,events:ARMS.events,layers:ARMS.layers,base:'fp_idle'});
const bodyMachine=()=>Rig.machine({clips:bodyClips,loops:BODY.loops,speeds:BODY.speeds,events:BODY.events,layers:BODY.layers,blends:BODY.blends});
const DT=1/60,near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=(eps||1e-9),(msg||'')+' got '+a+', expected '+b);
const P=(o)=>Object.assign({x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,speed:0},o);
// frames: [[player, seconds, extra]] -> the states, every clip command, and the last out
function run(frames,a){
  a=a||PlayerAnim.create();const out={states:[],arms:[],body:[],log:[],a:a};
  for(const [p,t,x] of frames)for(let s=0;s<t-1e-9;s+=DT){
    const o=PlayerAnim.step(a,p,DT,x);out.log.push(o);out.last=o;
    if(out.states[out.states.length-1]!==o.state)out.states.push(o.state);
    o.arms.forEach(c=>out.arms.push(c));o.body.forEach(c=>out.body.push(c));
  }
  return out;
}
const names=l=>l.map(c=>c[0]);

// --- the new clips are in the arms model, where the manifest says --------------------------------
test('clips: the six air clips are built, the loops loop, and the reaches are layer clips on their own arm',()=>{
  for(const c of ['fp_air','fp_fall_fast','fp_jump','fp_land','fp_release_reach_l','fp_release_reach_r','fp_perch_idle'])assert.ok(armsClips[c]>0,c);
  for(const c of ['fp_air','fp_fall_fast','fp_perch_idle'])assert.ok(ARMS.loops.includes(c),c+' loops');
  assert.ok(ARMS.layers.arm_l.clips.includes('fp_release_reach_l')&&ARMS.layers.arm_r.clips.includes('fp_release_reach_r'));
  assert.deepEqual(Rig.check(ARMS,ARMS.layers.arm_l.bones.concat(ARMS.layers.arm_r.bones,[ARMS.wrists.l.bone]),Object.keys(armsClips)),[]);
  assert.deepEqual(Rig.validate(manifest),[]);
});

// --- PlayerAnim: which arms clip in the air -------------------------------------------------------
test('anim: in the air the arms hold out (fp_air), sweep back past FAST_VY (fp_fall_fast), and stay back until SLOW_VY',()=>{
  const r=run([[P(),.1],[P({grounded:false,vy:-5}),.4],[P({grounded:false,vy:-15}),.3],[P({grounded:false,vy:-11}),.3],[P({grounded:false,vy:-8}),.3]]);
  assert.deepEqual(r.states,['idle','fall']);
  assert.deepEqual(names(r.arms),['fp_idle','fp_air','fp_fall_fast','fp_air'],'-11 m/s is still fast (between SLOW_VY and FAST_VY); -8 is not');
  assert.ok(A.SLOW_VY>A.FAST_VY,'the margin runs the right way');
  const slow=run([[P(),.1],[P({grounded:false,vy:-11}),.5]]);
  assert.deepEqual(names(slow.arms),['fp_idle','fp_air'],'never fast, -11 is not enough to sweep them back');
});
test('anim: a jump pushes off (fp_jump over fp_air), a landing is taken on the palms (fp_land), quicker running on',()=>{
  const j=run([[P(),.2],[P({grounded:false,vy:6.4}),.2],[P({grounded:false,vy:-3}),.3],[P(),.5]]);
  assert.deepEqual(j.states,['idle','jump','land','idle']);
  const i=names(j.arms);
  assert.deepEqual(i.slice(1,3),['fp_air','fp_jump'],'the base first, the one-shot over it');
  assert.equal(i.filter(c=>c==='fp_jump').length,1,'once');
  assert.ok(i.includes('fp_land')&&i.indexOf('fp_land')>i.indexOf('fp_jump'));
  const run1=run([[P({grounded:false,vy:-9}),.8],[P({vz:-6}),.1]]).arms.find(c=>c[0]==='fp_land');
  near(run1[1].speed,A.FP_LAND_RUN,1e-9,'running on');
  const still=run([[P({grounded:false,vy:-9}),.8],[P(),.1]]).arms.find(c=>c[0]==='fp_land');
  assert.equal(still[1].speed,undefined,'standing, at its own pace');
  // Through real machines: the jump is a one-shot handing back to fp_air, the landing to idle.
  const m=armsMachine();j.arms.forEach(c=>Rig.play(m,c[0],c[1]));assert.deepEqual(m.missing,[]);
});
test('anim: letting go, the held hand opens and the free one reaches ahead; taking a line with it stops the reach',()=>{
  const a=PlayerAnim.create();
  const r=run([[P({grounded:false}),.3,{swing:'r'}],[P({grounded:false,vy:3}),.2,{}]],a);
  assert.deepEqual(r.arms.filter(c=>/release/.test(c[0])&&!c[1].stop).map(c=>c[0]),['fp_release_r','fp_release_reach_l']);
  const again=run([[P({grounded:false}),.1,{swing:'l'}]],a);
  const stop=again.arms.find(c=>c[0]==='fp_release_reach_l');
  assert.ok(stop&&stop[1].stop,'the reaching hand takes the line: its reach is stopped');
  // Through a machine: the reach plays on arm_l, and the stop fades it out while the right arm's release goes on.
  const m=armsMachine();Rig.play(m,'fp_swing_hold_r');
  r.arms.forEach(c=>Rig.play(m,c[0],c[1]));Rig.step(m,.2);
  assert.deepEqual(Rig.layers(m),{arm_r:'fp_release_r',arm_l:'fp_release_reach_l'});
  again.arms.forEach(c=>Rig.play(m,c[0],c[1]));
  assert.equal(Rig.layers(m).arm_l,undefined,'the reach is gone from the left arm');
  for(let t=0;t<.1;t+=DT)Rig.step(m,DT);
  assert.ok(!m.layers.some(l=>l.name==='fp_release_reach_l'),'faded out and dropped');
  assert.equal(Rig.stop(m,'fp_release_reach_l'),null,'stopping what isn\'t playing does nothing');
  assert.equal(Rig.play(m,'fp_release_reach_r',{stop:true}),'fp_release_reach_r','...and play() still names the clip, so the view logs no missing clip');
  // Let go into a zip or onto a perch, nothing reaches.
  const z=run([[P({grounded:false}),.2,{swing:'r'}],[P({grounded:false}),.2,{zip:true}]]);
  assert.ok(!z.arms.some(c=>/reach/.test(c[0])&&!c[1].stop));
});
test('anim: perched, the hands are on the ledge (fp_perch_idle)',()=>{
  assert.deepEqual(names(run([[P(),.3,{perched:true}]]).arms),['fp_perch_idle']);
});
test('anim: the body in the air is the air blend - all rising at RISE_VY[1], all falling at RISE_VY[0] - and leans the way he flies',()=>{
  const up=run([[P(),.1],[P({grounded:false,vy:6,vx:10}),.25]]),dn=run([[P({grounded:false,vy:-6,vx:10}),1]]);
  assert.ok(names(up.body).includes('air')&&names(dn.body).includes('air'));
  near(up.last.rise,1);near(dn.last.rise,0);
  near(run([[P({grounded:false,vy:(A.RISE_VY[0]+A.RISE_VY[1])/2}),.5]]).last.rise,.5,1e-9,'halfway');
  // The lean: toward +x (his velocity), eased, capped.
  const L=dn.last.lean;assert.ok(L.x>0&&Math.abs(L.z)<1e-9);
  near(L.x,Math.min(A.LEAN_MAX,A.LEAN_PER*10),.01,'eased in by 1 s');
  near(run([[P({grounded:false,vz:-40}),2]]).last.lean.z,-A.LEAN_MAX,1e-3,'never past LEAN_MAX');
  const back=run([[P({grounded:false,vx:10}),1],[P(),1]]);near(Math.hypot(back.last.lean.x,back.last.lean.z),0,.005,'upright again on the ground');
  const line=run([[P({grounded:false,vx:10}),1,{swing:'r'}]]);near(line.last.lean.x,0,1e-9,'on a line the hang tilts him instead');
  // Rig: the blend is a base state of both clips, a held at its time.
  const m=bodyMachine();Rig.play(m,'air',{fade:0});Rig.setBlend(m,'air',.3);Rig.step(m,.4);
  const pose=Rig.pose(m),j=pose.find(p=>p.clip==='jump'),f=pose.find(p=>p.clip==='fall');
  near(j.w,.3);near(f.w,.7);near(j.t,BODY.blends.air.at,1e-9,'the rising pose is held');
  near(f.t,.4%bodyClips.fall,1e-9,'the fall runs');
  assert.equal(Rig.state(m).base,'air');
  Rig.setBlend(m,'air',7);near(Rig.pose(m).find(p=>p.clip==='jump').w,1,1e-9,'clamped');
});

// --- ArmMotion ----------------------------------------------------------------------------------
const F=(o)=>Object.assign({yaw:0,pitch:0,vel:{x:0,y:0,z:0},land:0,idle:false,line:null,motion:'full'},o);
test('arm motion: the arms lag a turn on the spring, and settle when it stops',()=>{
  const s=ArmMotion.create();let o,yaw=0;
  ArmMotion.step(s,F({yaw}),DT);
  for(let t=0;t<.5;t+=DT){yaw+=2*DT;o=ArmMotion.step(s,F({yaw}),DT);}
  assert.ok(o.rot[1]<-.02,'turning left, they trail to the right: '+o.rot[1]);
  near(o.rot[1],-K.TURN_LAG*2,.004,'held at the lag for that rate');
  assert.ok(o.rot[2]<0,'and roll into it');
  const after=[];for(let t=0;t<2;t+=DT)after.push(ArmMotion.step(s,F({yaw}),DT).rot[1]);
  assert.ok(Math.max(...after.map(Math.abs))<=Math.abs(o.rot[1])+1e-9,'the settle never swings past where it started');
  assert.ok(Math.abs(after[after.length-1])<1e-4,'settled: '+after[after.length-1]);
  assert.ok(Math.abs(after[Math.round(.5/DT)])<.25*Math.abs(o.rot[1]),'most of the way back within half a second');
  // Pitching up, they trail down; speeding up forward, they trail back.
  const q=ArmMotion.create();let pp=0,oo;ArmMotion.step(q,F(),DT);
  for(let t=0;t<.3;t+=DT){pp+=1*DT;oo=ArmMotion.step(q,F({pitch:pp,vel:{x:0,y:0,z:-t*10}}),DT);}
  assert.ok(oo.rot[0]<0,'pitch lag');assert.ok(oo.pos[2]>0,'forward acceleration pushes them back (+z)');
  // The same whatever the frame rate.
  const at=(dt)=>{const r=ArmMotion.create();let y=0,x;ArmMotion.step(r,F(),dt);for(let t=0;t<.6-1e-9;t+=dt){y+=2*dt;x=ArmMotion.step(r,F({yaw:y}),dt);}return x.rot[1];};
  near(at(1/30),at(1/144),.002,'30 vs 144 fps');
});
test('arm motion: everything stays bounded, however wild the input (and whatever REDUCED does, it only shrinks it)',()=>{
  let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const full=ArmMotion.create(),red=ArmMotion.create();let mf=0,mr=0,yaw=0,pitch=0;
  const lim={pos:K.POS_MAX+K.DIP_MAX+K.BREATH+1e-9,rot:K.ROT_MAX+K.BREATH_ROT+1e-9,hand:K.COUNTER*1.2+1e-9};
  for(let i=0;i<2400;i++){
    yaw+=(rnd()-.5)*2;pitch=(rnd()-.5)*2.6;
    const vel={x:(rnd()-.5)*80,y:(rnd()-.5)*80,z:(rnd()-.5)*80},line=rnd()<.5?{hand:rnd()<.5?'l':'r',anchor:{x:0,y:40,z:0},grip:{x:(rnd()-.5)*40,y:10,z:(rnd()-.5)*40}}:null;
    const f=F({yaw,pitch,vel,land:rnd()<.05?rnd()*60:0,idle:rnd()<.3,line}),dt=rnd()<.1?.1:1/(30+rnd()*120);
    const a=ArmMotion.step(full,f,dt),b=ArmMotion.step(red,Object.assign({},f,{motion:'reduced'}),dt);
    for(const o of [a,b]){
      o.pos.forEach(v=>assert.ok(Math.abs(v)<=lim.pos,'pos '+v));
      o.rot.forEach(v=>assert.ok(Math.abs(v)<=lim.rot,'rot '+v));
      ['l','r'].forEach(h=>{assert.ok(Math.hypot(...o.hands[h])<=lim.hand,'hand '+o.hands[h]);
        assert.ok(Math.abs(o.flutter[h].fore)<=K.FLUTTER+1e-9);assert.ok(Math.abs(o.flutter[h].fingers)<=K.FINGERS+1e-9);});
    }
    const size=o=>Math.max(...o.pos.map(Math.abs),...o.rot.map(Math.abs));
    mf=Math.max(mf,size(a));mr=Math.max(mr,size(b));
  }
  assert.ok(mr<=K.REDUCED*mf+1e-9,'REDUCED: '+mr+' vs full '+mf);
});
test('arm motion: REDUCED scales every part by the same REDUCED share',()=>{
  const drive=(motion)=>{const s=ArmMotion.create(),out=[];let y=0;ArmMotion.step(s,F({motion}),DT);
    for(let i=0;i<120;i++){y+=.03;out.push(ArmMotion.step(s,F({yaw:y,vel:{x:20,y:-5,z:0},land:i===30?18:0,motion,
      line:{hand:'r',anchor:{x:0,y:30,z:0},grip:{x:6,y:10,z:0}}}),DT));}return out;};
  const f=drive('full'),r=drive('reduced');
  f.forEach((o,i)=>{
    o.pos.forEach((v,k)=>near(r[i].pos[k],v*K.REDUCED,1e-12));o.rot.forEach((v,k)=>near(r[i].rot[k],v*K.REDUCED,1e-12));
    near(r[i].hands.l[2],o.hands.l[2]*K.REDUCED,1e-12);near(r[i].flutter.r.fore,o.flutter.r.fore*K.REDUCED,1e-12);
  });
});
test('arm motion: a landing dips the arms by how hard it was, up to DIP_MAX, and they come back up',()=>{
  const dip=(v)=>{const s=ArmMotion.create();ArmMotion.step(s,F(),DT);let lo=0,o;
    for(let i=0;i<120;i++){o=ArmMotion.step(s,F({land:i===0?v:0}),DT);lo=Math.min(lo,o.pos[1]);}return {lo,end:o.pos[1]};};
  const a=dip(6),b=dip(12),c=dip(20),d=dip(80);
  assert.ok(a.lo<0&&b.lo<a.lo&&c.lo<b.lo,'deeper the harder: '+[a.lo,b.lo,c.lo]);
  near(b.lo,-(12-K.DIP_MIN_V)*K.DIP_PER,.012,'about DIP_PER a m/s');
  assert.ok(d.lo>=-K.DIP_MAX-1e-9,'capped');
  near(dip(2).lo,0,1e-9,'a step down is nothing');
  assert.ok(Math.abs(d.end)<.004,'back up within 2 s');
});
test('arm motion: the wind flutters them with speed; still air leaves them be',()=>{
  const amp=(v)=>{const s=ArmMotion.create();let m=0;for(let i=0;i<300;i++){const o=ArmMotion.step(s,F({vel:{x:v,y:0,z:0}}),DT);if(i>150)m=Math.max(m,Math.abs(o.flutter.l.fore),Math.abs(o.flutter.r.fingers)/K.FINGERS*K.FLUTTER);}return m;};
  near(amp(3),0,1e-9,'walking pace: none');
  const mid=amp(15),top=amp(35);
  assert.ok(mid>0&&top>mid,'more with speed: '+mid+' '+top);assert.ok(top>.5*K.FLUTTER,'near full at swinging speed');
});
test('arm motion: on a line the free arm swings against the pendulum - back and down into the arc, ahead and up out of it',()=>{
  const at=(gx)=>{const s=ArmMotion.create();let o;
    for(let i=0;i<120;i++)o=ArmMotion.step(s,F({vel:{x:20,y:0,z:0},line:{hand:'r',anchor:{x:0,y:40,z:0},grip:{x:gx,y:12,z:0}}}),DT);return o;};
  const before=at(-15),after=at(15),bottom=at(0);
  assert.ok(before.hands.l[2]>.02&&before.hands.l[1]<0,'behind the anchor: back and down '+before.hands.l);
  assert.ok(after.hands.l[2]<-.02&&after.hands.l[1]>0,'past it: ahead and up '+after.hands.l);
  near(Math.hypot(...bottom.hands.l),0,1e-6,'at the bottom, neither');
  near(Math.hypot(...after.hands.r),0,1e-9,'the hand on the line is the IK\'s');
  near(ArmMotion.phase({anchor:{x:0,y:40,z:0},grip:{x:0,y:12,z:15}},{x:20,y:0,z:0}),0,1e-9,'across the travel is no phase');
});
test('arm motion: breathing only while you stand still',()=>{
  const sway=(idle)=>{const s=ArmMotion.create();let lo=1,hi=-1;for(let i=0;i<600;i++){const o=ArmMotion.step(s,F({idle}),DT);if(i>300){lo=Math.min(lo,o.pos[1]);hi=Math.max(hi,o.pos[1]);}}return hi-lo;};
  assert.ok(sway(true)>1.2*K.BREATH,'a breath: '+sway(true));near(sway(false),0,1e-9);
});
test('arm motion: keepClear never lets the layer bring a hand near the crosshair, and leaves the clip\'s own pose alone',()=>{
  const idle={l:[-.27,-.24,-.3],r:[.27,-.24,-.3]};
  const base={pos:[0,0,0],rot:[0,0,0],hands:{l:[0,0,0],r:[0,0,0]},flutter:{l:{fore:0,fingers:0},r:{fore:0,fingers:0}}};
  // Harmless offsets pass untouched (the same object).
  const small=Object.assign({},base,{pos:[.02,.01,.01]});assert.equal(ArmMotion.keepClear(small,idle),small);
  // A hand pushed right into the middle: scaled back to CLEAR.
  const hand={r:[.12,-.09,-.34],l:null},wild=Object.assign({},base,{hands:{l:[0,0,0],r:[-.08,.06,0]}});
  const k=ArmMotion.keepClear(wild,hand),p=ArmMotion.apply(hand.r,k.rot,[k.pos[0]+k.hands.r[0],k.pos[1]+k.hands.r[1],k.pos[2]+k.hands.r[2]]);
  assert.ok(ArmMotion.offAxis(p)>=K.CLEAR-1e-3,'held at CLEAR: '+ArmMotion.offAxis(p));
  assert.ok(Math.abs(k.hands.r[0])<.08,'scaled down');
  assert.ok(ArmMotion.offAxis(hand.r)>K.CLEAR,'(the hand started outside CLEAR)');
  // The thwip puts a hand inside CLEAR by itself: the layer may move it, but never further in.
  const thwip={r:[.05,-.06,-.34],l:null},toward=Object.assign({},base,{rot:[.05,0,0]});
  const k2=ArmMotion.keepClear(toward,thwip),p2=ArmMotion.apply(thwip.r,k2.rot,k2.pos);
  assert.ok(ArmMotion.offAxis(p2)>=ArmMotion.offAxis(thwip.r)-1e-3);
  // Through step at its worst, with the hands where fp_air holds them, the offsets always clear.
  const s=ArmMotion.create(),air={l:[-.29,-.13,-.28],r:[.29,-.13,-.28]};let y=0;
  for(let i=0;i<600;i++){y+=(i%120<60?1:-1)*.07;const o=ArmMotion.keepClear(ArmMotion.step(s,F({yaw:y,pitch:Math.sin(i/9),vel:{x:30*Math.sin(i/13),y:-20,z:0},land:i%97===0?30:0,
    line:{hand:'l',anchor:{x:0,y:40,z:0},grip:{x:20*Math.sin(i/20),y:10,z:0}}}),DT),air);
    ['l','r'].forEach(h=>assert.ok(ArmMotion.offAxis(ArmMotion.apply(air[h],o.rot,[o.pos[0]+o.hands[h][0],o.pos[1]+o.hands[h][1],o.pos[2]+o.hands[h][2]]))>=K.CLEAR-1e-3));}
});
test('arm motion: reset is a still start - no lag carried over a teleport',()=>{
  const s=ArmMotion.create();ArmMotion.step(s,F(),DT);ArmMotion.step(s,F({yaw:1,vel:{x:50,y:0,z:0}}),DT);
  ArmMotion.reset(s);const o=ArmMotion.step(s,F({yaw:3,vel:{x:-40,y:0,z:0}}),DT);
  assert.deepEqual(o.pos.concat(o.rot).map(v=>Math.abs(v)<1e-12),[true,true,true,true,true,true],'the first step after a reset has nothing to lag behind');
});
