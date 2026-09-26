// The Three.js addons the game uses, which r159 ships only as ES modules.
// build-addons.cjs bundles this into vendor/three-addons.js, an IIFE that
// hangs them on the window.THREE that vendor/three.min.js made. 'three' is
// aliased to shim.cjs, so every addon uses that one THREE.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// Onto window.THREE itself: an `import * as` of the shim would be a copy.
Object.assign(window.THREE, {
  GLTFLoader, SkeletonUtils, MeshoptDecoder, RoomEnvironment,
  EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, SMAAPass, SSAOPass, FXAAShader,
  // The three package these were built from, e.g. '159' (see build-addons.cjs).
  ADDONS_REVISION: __THREE_REVISION__
});
