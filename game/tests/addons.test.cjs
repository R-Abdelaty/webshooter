const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');

// Load the two vendored scripts the way the page does - plain scripts sharing
// one global - and check the addons hang on the page's own THREE.
function page(){
  const g={console:{warn(){},log(){},error(){}},self:null};g.self=g;g.window=g;g.globalThis=g;
  const ctx=vm.createContext(g);
  for(const f of ['three.min.js','three-addons.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor',f),'utf8'),ctx,{filename:f});
  return g;
}

test('addons: vendor/three-addons.js attaches the loaders to the one THREE from three.min.js',()=>{
  const {THREE}=page();
  assert.equal(THREE.REVISION,'159');
  assert.equal(THREE.ADDONS_REVISION,'159','built against the same revision');
  for(const k of ['GLTFLoader','MeshoptDecoder','RoomEnvironment','EffectComposer','RenderPass','OutputPass','UnrealBloomPass','SMAAPass'])
    assert.ok(THREE[k],k+' is attached');
  assert.equal(typeof THREE.SkeletonUtils.clone,'function');
  // One THREE: what the addons build is an instance of the page's classes.
  const loader=new THREE.GLTFLoader();
  assert.ok(loader instanceof THREE.Loader,'GLTFLoader extends the page\'s Loader');
  assert.ok(new THREE.RenderPass(new THREE.Scene(),new THREE.PerspectiveCamera()).scene instanceof THREE.Object3D);
});
