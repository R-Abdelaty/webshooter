# Vendored libraries

- `three.min.js` — Three.js **r159** (`three@0.159.0`, `build/three.min.js`), the last release that ships the
  classic non-module build. Loaded with a plain `<script>` tag so the page works from `file://`.
  Source: https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js
  SHA-256: `7b1c5d75b28d9de15042e2b374f83566d8c7146697af8fdeb4558b0fb528a585`
  Licence: MIT, see `three.LICENSE`. The file is unmodified; its first line logs a deprecation warning
  about the classic build, which is expected.

- `three-addons.js` — the r159 addons that ship only as ES modules, bundled into one classic script that
  attaches them to the `window.THREE` above (so there is a single Three.js instance): `GLTFLoader`,
  `SkeletonUtils`, `MeshoptDecoder` (its WASM is inlined, so nothing is fetched), `RoomEnvironment`,
  `EffectComposer`, `RenderPass`, `ShaderPass`, `OutputPass`, `UnrealBloomPass`, `SMAAPass`, `SSAOPass` and
  `FXAAShader`. `GLTFLoader` reads `EXT_texture_webp` and `EXT_meshopt_compression` itself.
  Built from `three@0.159.0` with `esbuild@0.28.2` (both pinned in the root `package.json`) by:

      npm install
      node game/tools/build-addons.cjs

  The entry point is `game/tools/three-addons/entry.js`; `shim.cjs` stands in for the `three` package and
  returns `window.THREE`. Load it right after `three.min.js`. Licence: MIT, as `three.LICENSE`.
  `game/tests/addons.test.cjs` checks it attaches to the page's own `THREE`.
