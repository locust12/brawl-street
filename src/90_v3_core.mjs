// ===== 3D renderer: setup, loading, arenas =====
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const SC = 0.01;                       // world px -> 3D units
const ASSET = 'assets/';
const FOV = 30;
const V3 = window.V3 = { ready: false, failed: false, progress: 0 };
// every cosmetic try/catch in the 3D layer reports here (never rethrows): window.TB_FXERR = { 'file:line message': count }.
// These were silent, which hid MOCHI's inhale throwing on every frame (an unscaled cone pointing at the sky).
V3.fxErr = (e, at) => { try { const s = window.TB_FXERR || (window.TB_FXERR = {}); const k = at + ' ' + String(e && e.message || e).slice(0, 140); s[k] = (s[k] || 0) + 1; } catch (_) {} };
let renderer, scene, camera, composer, bloom, clock, arena = null, arenaId = null, roomEnv = null;
// Per-stage ambient trim, applied to the stage's own sky probe. A night stage's sky carries very
// little light, so it needs more of it than a stage standing under a bright one; the white studio
// probe used to paper over exactly this difference, which is why every stage looked equally flat.
const ENVK = { chart: 0.8, isle: 0.8, dojo: 0.9, roof: 1.5, keep: 1.6, moon: 1.1, city: 1.5, ship: 1.6,
  street: 0.9, arena: 1.4, swamp: 1.2, floor: 1.3, train: 1.4, peak: 0.9, lunar: 2.0, casino: 1.5,
  shibuya: 2.6, baghdad: 0.8, miami: 0.55 };
const models = {}, texCache = {};
let baseClips = {};

// ---------- small helpers ----------
const W3 = (x, y, z = 0) => new THREE.Vector3(x * SC, -y * SC, z);
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QUAL.aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// A 1x1 neutral image to stand in for anything still downloading. `TextureLoader.load()` hands back a
// texture with NO image, and three binds that as an all-black 1x1 -- so every surface using it is a
// black hole until the jpg lands. That is the "half the screen is black" report on a cold load. Every
// loader in the 3D layer goes through here or through `loadAsync`.
//
// OPAQUE mid-grey, deliberately. A transparent placeholder looks like the tidier answer -- cut-out
// cards would stay invisible instead of flashing a slab -- but a canvas stores its pixels
// premultiplied, so alpha 0 unpacks as (0,0,0) and the "transparent grey" placeholder is BLACK,
// which is the exact bug being fixed. Never black beats never visible.
function placeholderImg() {
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.fillStyle = '#8d8d8d'; g.fillRect(0, 0, 1, 1);
  return c;
}
V3.placeholderImg = placeholderImg;
// Swapping the image INSIDE a live texture does not work, and this is the trap the placeholder idea
// falls into. On WebGL2 three allocates the GL texture with `texStorage2D`, which is IMMUTABLE, and
// it only allocates on the FIRST upload -- so a 1x1 placeholder can never grow into a 1024x1024 jpg.
// Writing `source.data = img; source.needsUpdate = true` leaves the GPU holding the 1x1 forever, and
// since a canvas filled with alpha 0 unpacks as (0,0,0), that 1x1 is BLACK. Every stage atlas was
// coming back black from `dev/perf_bench.mjs --tex`, which renders each texture through a real draw
// and reads the pixels back -- the only way to see what the GPU has rather than what JS thinks.
//
// The fix is to hand the texture a BRAND NEW Source, which three has no allocation for yet, so it
// allocates again at the right size. Every texture handed out for a url is kept in `kin` because a
// clone taken before the image landed still points at the old placeholder Source.
V3.swapImage = function (kin, image) {
  // A new Source is necessary but NOT sufficient. On WebGL2 three allocates a texture's storage
  // with the immutable texStorage2D, on the FIRST upload only, and it keeps __webglTexture on the
  // texture. Hand the same texture object a bigger image later and three takes the "already
  // allocated" path (texSubImage2D) against 1x1 immutable storage: the upload cannot fit, and the
  // GPU keeps the 1 px placeholder forever while `texture.image` reports 1024 on the CPU side.
  // That is why every tile-atlas surface in the game rendered as flat untextured colour - Brawl
  // Street's road, kerb and cross-section were a blank pink box (adjacent-pixel detail 0.04) when
  // the art underneath is gravel, soil layers and buried pipes. Verified 9/21 by swapping in a
  // fresh THREE.Texture over the same image, which fixed it instantly.
  // dispose() drops __webglTexture so the next render reallocates at the real size. The image is
  // untouched, so nothing else about the texture changes.
  const src = new THREE.Source(image);
  for (const t of kin) { if (t) { t.dispose(); t.source = src; t.needsUpdate = true; } }
};
function loadTex(url, opt) {
  let e = texCache[url];
  if (!e) {
    const base = new THREE.Texture(placeholderImg());
    base.needsUpdate = true;
    base.userData.shared = true;   // cached across arenas: V3.disposeArena leaves it uploaded
    base.colorSpace = THREE.SRGBColorSpace; base.anisotropy = QUAL.aniso;
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    e = texCache[url] = { base, kin: [base] };
    new THREE.TextureLoader().load(url, t => V3.swapImage(e.kin, t.image));
  }
  if (!opt || (opt.rx === 1 && opt.ry === 1)) return e.base;
  const t = e.base.clone(); t.repeat.set(opt.rx, opt.ry); t.needsUpdate = true; e.kin.push(t); return t;
}
V3.loadTex = loadTex;
function stageTex(name, rx = 1, ry = 1) { return loadTex(ASSET + 'tex_' + name + '.jpg', { rx, ry }); }
// sculpted rock underside (generated mesh) placed under a platform; falls back to whatever is already there
function islandUnder(g, cx, topY, width, depth, hideOnLoad) {
  if (!gltf) return;
  Promise.all([gltf.loadAsync(ASSET + 'stage_island_glb.wasm'), texL.loadAsync(ASSET + 'stage_island_tex.jpg')]).then(([m, tex]) => {
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    m.scene.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }); o.receiveShadow = true; } });
    const sx = width * 1.08, sy = width * 0.62, sz = depth / 0.81;
    m.scene.scale.set(sx, sy, sz); m.scene.position.set(cx, topY - 0.335 * sy + 0.06, -0.05);
    g.add(m.scene);
    for (const o of hideOnLoad || []) o.visible = false;
  }).catch(() => {});
}
const NOISE = `
float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n2(p);p*=2.03;a*=.5;}return v;}`;

// The last sky a builder asked for. V3.setArena reads it straight after the build so the ambient
// probe can be made of the same three colours as the dome (see skyEnvTex).
let lastSky = null;
function skyDome(top, mid, bottom) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { a: { value: new THREE.Color(top) }, b: { value: new THREE.Color(mid) }, c: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 a,b,c; varying vec3 vp; void main(){ float y = vp.y; vec3 col = y > 0. ? mix(b, a, pow(y, .6)) : mix(b, c, pow(-y, .5)); gl_FragColor = vec4(col, 1.); }',
  });
  lastSky = [top, mid, bottom];
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), m);
  mesh.userData.sky = lastSky;
  return mesh;
}
// ---------- ambient probe ----------
// Every stage was lit by the same neutral white RoomEnvironment studio probe. Measured on a matte
// wall it was handing over MORE light than all of that stage's directional lights combined, and
// because it is white it desaturated whatever colour the surface was painted: a sea-green wall came
// out warm grey no matter what was done to the key. Outdoors the ambient IS the sky, so each stage
// now gets a probe built from the same three colours its dome uses. Cheap: a 128 px equirect canvas,
// PMREMed once by three's own CubeUV path, cached forever and never disposed.
const envCache = {};
function skyEnvTex(top, mid, bottom) {
  const key = top + '/' + mid + '/' + bottom;
  if (envCache[key]) return envCache[key];
  const W = 128, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), hex = v => '#' + new THREE.Color(v).getHexString();
  // flipY is on for a canvas texture, so row 0 is the zenith and the middle row is the horizon
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, hex(top)); gr.addColorStop(0.42, hex(mid)); gr.addColorStop(0.5, hex(mid));
  gr.addColorStop(0.62, hex(bottom)); gr.addColorStop(1, hex(bottom));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // a soft bright spot just above the horizon: without one, chrome and glass reflect a flat wash and
  // lose the highlight the white studio probe used to give them
  const sunC = new THREE.Color(mid).lerp(new THREE.Color(0xffffff), 0.55);
  const sg = g.createRadialGradient(W * 0.72, H * 0.4, 0, W * 0.72, H * 0.4, H * 0.32);
  sg.addColorStop(0, '#' + sunC.getHexString()); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sg; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;   // cached across arenas: V3.disposeArena leaves it uploaded
  return envCache[key] = t;
}

// ---------- quality ----------
// A phone used to get the desktop settings with the resolution turned down, which is backwards: at
// phone size nobody can see a 2048 shadow map or soft PCF, but everybody sees a soft, aliased image.
// Touch now keeps the sharp buffer and real MSAA and pays for it in shadow resolution instead.
// `ceil` is the pixel-ratio ceiling; the scaler below moves between `floor` and `ceil` to hold 60.
const QUAL = {
  ceil: 2, floor: 1, samples: 4,     // `floor` is per-tier (floorPR below) once a tier is in force
  shadow: IS_TOUCH ? 1024 : 2048,
  soft: !IS_TOUCH,
  aniso: 4,             // replaced with the device maximum once the renderer exists
  // The OPENING pixel ratio is picked so the drawing buffer starts around this many pixels, rather
  // than at the device maximum. A 1600x900 window on a Retina screen is a 3200x1800 buffer -- 5.8 M
  // pixels through an MSAA half-float scene pass, a bloom pyramid, a tone-map and a grade -- and that
  // is not a frame anything holds at 60. The scaler climbs back up to the device ratio within a few
  // seconds when the machine can take it; the other way round the player watches it stutter first.
  // It is a ceiling on the START only: `top` is still the ceiling the scaler may climb to.
  maxPixels: 2.6e6,
  // --- detail tier (set by DETAIL below; never edit these by hand) ---
  tier: 'high',         // the tier in force right now
  mode: 'auto',         // what the player picked: auto | high | medium | low
  bloom: true,          // bloom pass on
  bloomScale: 1,        // bloom pyramid resolution as a fraction of the frame
  parts: 1,             // particle budget multiplier (91/93/94 read this)
  decor: 2,             // decorative-layer level still drawn: 2 = all, 1 = trim, 0 = only the fight
  prCap: 2,             // this tier's ceiling on the pixel ratio
  msaaCap: 4,           // this tier's ceiling on MSAA samples (see wantSamples below)
  msaaNow: 4,           // what the composer targets are actually carrying right now
  ao: true,             // ambient occlusion pass on
  aoSamples: 8,         // GTAO samples per pixel
};
V3.QUAL = QUAL;

// Three tiers. Resolution is the FIRST thing given up and the LAST thing restored (see qualityTick);
// these are what goes after it. Nothing here touches the fighters: they keep their models, their
// materials, their shadow and their share of the screen at every tier. What steps down is the stuff
// behind and below the fight plane — shadow map resolution, the bloom pyramid, particle counts and
// decorative stage layers.
//
// `soft` (PCF filter) and `samples` (MSAA) are deliberately NOT in here: changing either recompiles
// every material in the scene or reallocates the MSAA target, which is a visible stall mid-fight.
// They are chosen once at boot from the player's saved setting.
const DETAIL = {
  high:   { shadow: IS_TOUCH ? 1024 : 2048, bloom: true,  bloomScale: 1,    parts: 1,    decor: 2, prCap: 2,   msaaCap: 4, floorPR: 1, ao: true,  aoSamples: 8 },
  medium: { shadow: IS_TOUCH ? 512 : 1024,  bloom: true,  bloomScale: 0.55, parts: 0.6,  decor: 1, prCap: 1.5, msaaCap: 2, floorPR: 1, ao: true,  aoSamples: 5 },
  // Low is the only tier allowed BELOW native resolution. High and Medium never render softer than
  // the CSS pixels the fighters are drawn in; Low is where the machine has already said it cannot
  // cope, and 0.75 is the difference between 42 fps and 60 on a GPU four times slower than this one
  // (measured, `--slow 4`). It is the last rung and nothing goes below it.
  low:    { shadow: 512,                    bloom: false, bloomScale: 0.5,  parts: 0.3,  decor: 0, prCap: 1,   msaaCap: 0, floorPR: 0.75, ao: false, aoSamples: 4 },
};
const TIER_ORDER = ['low', 'medium', 'high'];
V3.DETAIL = DETAIL;

// Decorative objects tag themselves: `o.userData.decor = 1` (trim: signs, props, foliage, crowd) or
// `2` (the heaviest background dressing). Anything untagged is always drawn. Stage authors: tag your
// heavy dressing and the scaler can pay for your geometry; leave it untagged and it is on the budget
// at every tier. V3.decor(obj, level) is the tagger, and it tags the whole subtree.
V3.decor = function (o, level = 1) { if (o) o.traverse(c => { c.userData.decor = level; }); return o; };
// Anything the stage did not tag still gets classified, so a new stage is never worse than the old
// ones by default: glow sprites are trim (gone at Low), and nothing else is touched. Never tags the
// fight plane -- z >= -0.5 is where fighters, platforms and items live and it stays untouched.
function autoDecor(root) {
  if (!root) return;
  root.traverse(o => {
    if (o.userData.decor !== undefined) return;         // the stage said what it wants: leave it
    const m = o.material;
    const glow = o.isSprite || (o.isMesh && m && !Array.isArray(m) && m.blending === THREE.AdditiveBlending && m.depthWrite === false);
    if (!glow) return;
    let z = o.position.z, p = o.parent;
    while (p && p !== root) { z += p.position.z; p = p.parent; }
    // Behind the fight plane, but in FRONT of z = -4.8: past that the painted backdrop in 93 hides
    // everything itself once it loads, and tagging there would fight its visibility bookkeeping.
    if (z < -0.5 && z > -4.8) o.userData.decor = 1;
  });
}
function applyDecor() {
  if (!arena) return;
  arena.traverse(o => {
    const d = o.userData && o.userData.decor;
    if (!d) return;
    const want = d <= QUAL.decor;
    if (want === !o.userData.decorHidden) return;              // already in that state
    // Never fight the stage's own visibility logic: remember what it wanted, restore exactly that.
    if (want) { o.visible = o.userData.decorWas !== false; o.userData.decorHidden = false; }
    else { o.userData.decorWas = o.visible; o.visible = false; o.userData.decorHidden = true; }
  });
}
// Shadow map size is the cheapest real lever after resolution: it is a straight reallocation, no
// shader recompile, and a 2048 map costs 4x a 1024 one for every caster in the scene.
function applyShadows() {
  if (!scene) return;
  scene.traverse(o => {
    if (!o.isLight || !o.castShadow || !o.shadow) return;
    if (o.shadow.mapSize.x === QUAL.shadow) return;
    o.shadow.mapSize.set(QUAL.shadow, QUAL.shadow);
    if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
  });
}
V3.setDetail = function (name) {
  const t = DETAIL[name] || DETAIL.high;
  const same = QUAL.tier === name && QUAL.shadow === t.shadow && QUAL.bloomScale === t.bloomScale && QUAL.decor === t.decor && QUAL.msaaCap === t.msaaCap && QUAL.floor === t.floorPR;
  QUAL.tier = name;
  Object.assign(QUAL, { shadow: t.shadow, bloom: t.bloom, bloomScale: t.bloomScale, parts: t.parts, decor: t.decor, prCap: t.prCap, msaaCap: t.msaaCap, floor: t.floorPR });
  QUAL.top = Math.min(window.devicePixelRatio || 1, QUAL.ceil, t.prCap);
  // Keep the ratio inside the new tier's range in BOTH directions. Coming up out of Low, the ratio
  // may be 0.75 -- below native -- and High and Medium are never allowed to render softer than the
  // CSS pixels, so the climb snaps back to the floor before the expensive detail comes back on.
  if (renderer) {
    const cur = renderer.getPixelRatio(), want = Math.min(QUAL.top, Math.max(QUAL.floor, cur));
    if (want !== cur) { renderer.setPixelRatio(want); composer.setPixelRatio(want); V3.refit(); }
  }
  if (same) return;    // nothing to reallocate: setting canvas.width again would clear the frame
  if (bloom) bloom.enabled = t.bloom;
  applyShadows(); applyDecor();
  if (V3.refit) V3.refit();
  try { V3.onDetail && V3.onDetail(name); } catch (e) {}
};
// Auto / High / Medium / Low, from the options screen. Auto hands the tier back to the scaler.
V3.setDetailMode = function (mode) {
  QUAL.mode = mode = (mode === 'high' || mode === 'medium' || mode === 'low') ? mode : 'auto';
  try { localStorage.setItem('tb_detail', mode); } catch (e) {}
  if (mode !== 'auto') V3.setDetail(mode);
  else V3.setDetail(QUAL.tier);     // keep what we have; the scaler moves from here
  return mode;
};
try { QUAL.mode = localStorage.getItem('tb_detail') || 'auto'; } catch (e) {}
if (QUAL.mode !== 'auto' && DETAIL[QUAL.mode]) Object.assign(QUAL, DETAIL[QUAL.mode], { tier: QUAL.mode, floor: DETAIL[QUAL.mode].floorPR });

// ---------- init ----------
function init() {
  const cv = document.createElement('canvas'); cv.id = 'g3d';
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.prepend(cv);
  // antialias:false on purpose: every frame goes through the composer, so the renderer's own MSAA
  // buffer would be allocated and never drawn to. The real MSAA is on the composer target below.
  // alpha:false on purpose as well as antialias:false — the canvas is opaque, so a texture that is
  // still downloading can use a transparent placeholder without punching a hole in the frame.
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: /demo|grab/.test(location.hash) });
  QUAL.top = Math.min(window.devicePixelRatio || 1, QUAL.ceil, QUAL.prCap);
  QUAL.aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy() || 4);
  renderer.setPixelRatio(QUAL.top);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = QUAL.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
  const pmrem = new THREE.PMREMGenerator(renderer);
  roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();      // the generator's scratch targets are not needed once the probe is baked
  scene.environment = roomEnv;        // the fallback; setArena swaps in the stage's own sky probe
  scene.environmentIntensity = 0.35;
  // RenderPass draws into this target rather than the canvas, so this is the only place MSAA can
  // live. Tile-based mobile GPUs resolve it in tile memory, which is why 4x is affordable on a phone.
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: QUAL.samples });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // AMBIENT OCCLUSION: TRIED AND REJECTED 9/23. three's GTAOPass, inserted here (before bloom, so the
  // occlusion is part of the image bloom sees), renders a LARGE BLACK RECTANGLE over part of the frame
  // in this pipeline -- the same failure class as the 9/22 bloom NaN rectangles. Cause not chased;
  // most likely the MSAA half-float scene target vs GTAO's own depth/normal pass. Evidence:
  // runs/gfx/ao1_mv_ftilt_0_hit_t.png (mean abs diff 7.05 vs the no-AO frame, max 216). Cost was also
  // real: 60.2 -> 58.9 fps. Grounding is done instead with the contact shadows in 96_v3_feel and the
  // stage receiveShadow pass in 93_v3_fx. Do not re-add without a full-frame black-pixel sweep.
  bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.4, 0.95);
  // The bloom pyramid is five downsample + five upsample passes over the whole frame; at half
  // resolution it costs a quarter and, because every level is a blur anyway, it is very hard to see.
  // composer.setSize() drives this, so V3.refit() is what re-applies a changed bloomScale.
  const bloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSize(Math.max(64, Math.round(w * QUAL.bloomScale)), Math.max(64, Math.round(h * QUAL.bloomScale)));
  bloom.enabled = QUAL.bloom;
  // THE BLACK RECTANGLES (9/22 night): a single non-finite pixel in the half-float scene target (NaN, or an additive
  // glow stack past half-float's 65504 = Inf) went into the bloom pyramid, and its blur smeared it across the mip
  // blocks: a pure-black rectangle over half the screen for a fraction of a second (the "half-black frames" seen on
  // Bayou, Street and Dojo, which looked like a capture glitch; dev/aaa in-frame readPixels proved them real, and
  // they vanish with bloom off). The high-pass input is now sanitised: non-finite -> 0, and HDR clamped to 64.
  try {
    const hp = bloom.materialHighPassFilter;
    if (hp && !location.hash.includes('rawbloom') && hp.fragmentShader.includes('vec4 texel = texture2D( tDiffuse, vUv );')) {   // #...:rawbloom = dev A/B
      hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = texture2D( tDiffuse, vUv ); if ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 ); texel.rgb = clamp( texel.rgb, 0.0, 64.0 );');
      hp.needsUpdate = true;
      V3.bloomSanitised = true;
    }
  } catch (e) { /* bloom still runs unsanitised */ }
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  V3.ShaderPass = ShaderPass;
  if (V3.postSetup) V3.postSetup(composer, renderer);
  clock = new THREE.Clock();
  // Size off the canvas's own box, not innerWidth/innerHeight: on a phone the two disagree while the
  // URL bar slides, and a buffer that disagrees with its CSS box is what tears and stretches frames.
  const fit = () => {
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === V3.vw && h === V3.vh) return;
    const wasArea = (V3.vw || 0) * (V3.vh || 0);
    V3.vw = w; V3.vh = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // First fit, or the window changed size by more than 40% (fullscreen, rotation, a dragged corner):
    // re-pick the opening ratio, because the old one was chosen for a different number of pixels.
    if (!wasArea || Math.abs(w * h - wasArea) / wasArea > 0.4) setPR(V3.startRatio());
  };
  // Re-apply the CURRENT size without the "nothing changed" shortcut above. Changing the pixel ratio
  // does not resize the drawing buffer on its own, so the quality scaler has to call this or the
  // buffer keeps its old dimensions and part of the canvas is simply never drawn — that is the
  // "half the screen is black" bug (9/21).
  V3.refit = () => {
    if (!V3.vw || !V3.vh) return;
    renderer.setSize(V3.vw, V3.vh, false); composer.setSize(V3.vw, V3.vh);
    camera.aspect = V3.vw / V3.vh; camera.updateProjectionMatrix();
    applyMSAA();
  };
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 250));   // iOS reports the old size for a beat
  if (window.visualViewport) visualViewport.addEventListener('resize', fit);
  try { new ResizeObserver(fit).observe(cv); } catch (e) { V3.fxErr(e, '90_v3_core:348'); /* older browsers: the resize event covers it */ }
  fit();
  V3.scene = scene; V3.camera = camera; V3.THREE = THREE; V3.SC = SC;
}

// ONE ladder, two rungs of different kinds. Going down: resolution first (instant, reversible, and
// the composer hides a lot of it), then the detail tier. Coming back up: the tier first, then the
// resolution — last thing cut is the first thing restored.
// Down needs one bad window, up needs `qUpNeed` good ones in a row, and a tier change is followed by
// a two-window cooldown because reallocating the shadow maps costs a frame on its own.
let qAcc = 0, qFrames = 0, qGood = 0, qBad = 0, qCool = 0, qUpNeed = 2, qWentUp = false;
// The target is 60, so the step-down threshold has to be near 60 and not near "playable". At 50 the
// ladder was content to sit at 52 fps forever: measured with `dev/perf_bench.mjs --slow 2` (a GPU
// braked to half speed) it settled at 52.7 fps and stopped, because 52.7 > 50 and nothing asked it
// for more.
const DOWN_FPS = 55, UP_FPS = 58;
// ...but 55/58 is only a three-frame dead band, and a machine sitting exactly on the line reads
// ±8 fps window to window. Measured with `--slow 0`: it flipped between ratio 1.75 and 2.0 nine times
// in 32 seconds, and every flip is a canvas resize the player sees. So the CLIMB backs off: each
// step down doubles the number of consecutive good windows an up-step needs, up to 8 (12 s). The
// first oscillation is free, the second costs 6 s, the third 12, and it settles one rung low instead
// of hunting — which is the right trade, because a stable 1.75 looks better than a 2.0 that stutters.
// Reset when the stage changes, since the new arena has a different cost.
const UP_NEED_MAX = 8;
V3.resetLadder = () => { qGood = 0; qBad = 0; qUpNeed = 2; qCool = 0; qWentUp = false; };
// ---------- anisotropic filtering, applied to EVERYTHING ----------
// It was off on most of the scene. Measured live with dev/gfxaudit.mjs during a match on dojo:
//   maxAniso 16,  anisotropy actually in use: { 1: 27 textures, 16: 9 }
// Three's default is 1, and the per-texture `anisotropy = QUAL.aniso` assignments scattered through
// 90/93/94/95 only cover the paths that build a texture BY HAND -- anything a loader produces, and
// anything created before init() filled QUAL.aniso in from the GPU, keeps the default.
// That matters more here than in most games: this is a 2.5D fighter, the ground plane is a large
// share of every frame, and it is always seen at a grazing angle, which is the exact case anisotropic
// filtering exists to fix. It is a sampler setting, so it costs essentially nothing.
// Self-limiting: only textures BELOW the target are touched, so the second pass over the same scene
// does no work and nothing is re-uploaded twice.
const TEX_SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'specularMap'];
V3.sharpenTextures = function () {
  if (!scene) return 0;
  const want = QUAL.aniso || 1;
  let n = 0;
  scene.traverse(o => {
    const ms = !o.material ? null : (Array.isArray(o.material) ? o.material : [o.material]);
    if (!ms) return;
    for (const m of ms) {
      if (!m) continue;
      for (const k of TEX_SLOTS) {
        const t = m[k];
        if (t && t.isTexture && (t.anisotropy || 1) < want) { t.anisotropy = want; t.needsUpdate = true; n++; }
      }
    }
  });
  return n;
};

V3.qualityTick = function (dt) {
  if (!renderer || !composer) return;
  qAcc += dt; qFrames++;
  if (qAcc < 1.5) return;
  const fps = qFrames / qAcc; qAcc = 0; qFrames = 0;
  V3.fps = Math.round(fps);
  if (qCool > 0) { qCool--; return; }
  const cur = renderer.getPixelRatio();
  const ti = TIER_ORDER.indexOf(QUAL.tier);
  const auto = QUAL.mode === 'auto';

  // 9/22: NEVER RESIZE MID-FIGHT. Every pixel-ratio or tier change reallocates the composer's render
  // targets (up to ~184 MB of half-float MSAA at 3200x1800), which is a visible stall and a visible
  // resize. On a machine hovering near the threshold this fired every few seconds: the owner saw it
  // as "laggy as fuck" and "flickering". So during live fighting the ladder may only step DOWN, and
  // only after sustained trouble; climbing back, and any fine-tuning, waits for a menu, the results
  // screen or the countdown, where a resize costs nothing anyone can see.
  let fighting = false, warming = false;
  try { fighting = Game.state === 'match' && !Game.paused && !Game.demo && !(Game.countdown > 0) && !Game.endT; } catch (e) {}
  // THE COUNTDOWN IS THE WORST POSSIBLE PLACE TO JUDGE THE MACHINE. It is when the warm-up runs --
  // programs compiling, textures uploading, the cast finishing its load -- so frames there are the
  // least representative of the match, and the ladder was reading them as evidence the GPU is slow.
  // Measured (dev/prtrace.mjs at dpr 2): it sat at 1.75, took ONE 55 fps window during the countdown,
  // stepped down to 1.5, and then could never climb back, because climbing is forbidden once fighting
  // starts. One bad window at the noisiest moment pinned the entire match at 75% of native.
  // So the countdown may still climb, but it may not step down.
  // ...and it is unrepresentative in BOTH directions, which the first version of this fix got wrong.
  // Blocking only the down-step meant a good countdown window -- where almost nothing is on screen --
  // promoted the buffer to full native 3200x1800, and the real fight that followed then ran at 51-57
  // fps and could not climb back down because in-fight steps need sustained trouble. Judge the machine
  // on frames from an actual fight, not from the quietest two seconds of the match.
  try { warming = Game.state === 'match' && (Game.countdown > 0 || Game.frame < 120); } catch (e) {}
  if (warming) { qGood = 0; qBad = 0; return; }
  if (fighting) {
    if (fps >= DOWN_FPS) { qBad = 0; qGood = 0; return; }       // fine, or recovering: hold still
    if (fps > 40 || ++qBad < 3) return;                          // only real, sustained trouble (~4.5 s under 40)
    qBad = 0; qCool = 6;                                         // then at most one step per ~9 s
  }

  if (fps < DOWN_FPS) {
    qGood = 0;
    // Only a REVERSAL costs the climb: if this step down is undoing a step up we just made, that is
    // the hunt signal and coming back costs twice as many good windows next time. Walking down from
    // the opening settings is not a hunt and must not make recovery sticky.
    if (qWentUp) { qUpNeed = Math.min(UP_NEED_MAX, qUpNeed * 2); qWentUp = false; }
    if (cur > QUAL.floor) return setPR(Math.max(QUAL.floor, cur - 0.25));
    if (auto && ti > 0) { V3.setDetail(TIER_ORDER[ti - 1]); qCool = 2; }
    return;
  }
  if (fps > UP_FPS) {
    if (++qGood < qUpNeed) return;
    qGood = 0;
    if (auto && ti < TIER_ORDER.length - 1) { qWentUp = true; V3.setDetail(TIER_ORDER[ti + 1]); qCool = 2; return; }
    if (cur < QUAL.top) { qWentUp = true; return setPR(Math.min(QUAL.top, cur + 0.25)); }
    return;
  }
  qGood = 0;
};
// ---------- MSAA, by how many pixels there already are ----------
// MEASURED (dev/perf_bench.mjs --ablate, miami, 4 fighters, 3200x1800): 4x MSAA on the half-float
// scene target cost **43 ms of a 98 ms frame**, and 2x cost 26 ms. It is by a long way the most
// expensive thing in the renderer, and the reason is bandwidth, not shading: at 3200x1800 a 4-sample
// half-float target is 184 MB, there are two of them, and every pass that reads one resolves it.
//
// It is also the least necessary thing on a big buffer. Past about 2.8 M pixels the frame is already
// supersampled relative to the CSS box, which antialiases edges AND shading, so MSAA on top buys
// almost nothing for that 43 ms. Under it, 2x is cheap and still cleans up the hard silhouettes.
// So: supersample when there are pixels to spare, multisample when there are not.
//
// Touch is the exception and keeps the full sample count: tile-based mobile GPUs resolve MSAA inside
// tile memory, where it is close to free, and their buffers are small anyway.
//
// `msaaCap` is the tier's ceiling on top of this. Changing it reallocates the composer targets, so it
// only ever runs from refit() -- on a resize or a pixel-ratio change, both of which already hitch.
function wantSamples() {
  const pr = renderer ? renderer.getPixelRatio() : 1;
  const px = (V3.vw || 1) * (V3.vh || 1) * pr * pr;
  // THE CUT-OFF HAS TO BE RELATIVE TO NATIVE, NOT AN ABSOLUTE PIXEL COUNT.
  // The argument above -- "past about 2.8 M pixels the frame is already supersampled relative to the
  // CSS box, so MSAA buys almost nothing" -- is only true if the buffer is at or above the DEVICE
  // ratio. On a Retina panel it is routinely neither. Measured (dev/prtrace.mjs, 1600x900 at dpr 2):
  // the whole match ran at pixel ratio 1.5, a 2400x1350 buffer -- 3.24 M pixels, so over the absolute
  // threshold and MSAA switched itself OFF, while being only 56% of the 3200x1800 native area.
  // Below native AND unantialiased, which is exactly the "not crisp" everyone was looking at.
  // Supersampling only counts when there is actually more buffer than screen.
  // BOTH conditions, and dropping either one costs something real:
  //   * px > 2.8e6 alone (what shipped) turns MSAA off on a buffer that is merely LARGE, even when it
  //     is well below native -- the 2400x1350-on-a-3200x1800-panel case that started all this.
  //   * pr >= dpr alone (what I tried next) turns MSAA back ON at 2800x1575, and 2x multisampling on a
  //     4.4 M pixel half-float target costs about 12 ms a frame: measured 44-49 fps against 60.
  // So: skip MSAA when the frame is genuinely supersampled, and skip it when it is too big to afford.
  // Everything else gets 2x.
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const by = IS_TOUCH ? QUAL.samples : (pr >= dpr || px > 2.8e6) ? 0 : 2;
  return Math.max(0, Math.min(by, QUAL.msaaCap));
}
function applyMSAA() {
  if (!composer) return;
  const n = wantSamples();
  QUAL.msaaNow = n;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (!rt || rt.samples === n) continue;
    rt.samples = n;
    rt.dispose();     // three rebuilds the framebuffer with the new sample count on the next bind
  }
}
V3.startRatio = function () {
  const top = QUAL.top || 1;
  if (!V3.vw || !V3.vh || !QUAL.maxPixels) return top;
  const byArea = Math.sqrt(QUAL.maxPixels / (V3.vw * V3.vh));
  // never below 1: the buffer stays at least as sharp as the CSS pixels the fighters are drawn in
  return Math.round(Math.max(QUAL.floor, Math.min(top, byArea)) * 4) / 4;
};
function setPR(next) {
  if (!renderer || !composer || next === renderer.getPixelRatio()) return;
  renderer.setPixelRatio(next); composer.setPixelRatio(next);
  // A pixel-ratio change has to be followed by a resize or the drawing buffer, the composer targets
  // and the bloom pyramid can disagree about how big the frame is, and the part nobody drew stays
  // black. refit() re-applies the CURRENT size to all three.
  V3.refit();
}

// ---------- loading ----------
// Fighters load on demand: the match countdown covers the download, and the rest preload quietly.
const retry = async (fn, n = 4) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } };
let gltf, texL;
const charP = {};
V3.hasChar = id => !!models[id];
V3.missing = new Set();   // fighter ids whose model failed to load
const rtRigged = scene => { let skin = false, hips = false; scene.traverse(o => { if (o.isSkinnedMesh) skin = true; if (o.isBone && o.name === 'Hips') hips = true; }); return skin && hips; };
V3.loadChar = function (id) {
  if (charP[id]) return charP[id];
  // ASSET_ID (10_core.js, swapped by 2f_origins.js) picks which art set this fighter loads. The model
  // is still cached and keyed under the plain id, so nothing else in the renderer has to know.
  const a = typeof ASSET_ID === 'function' ? ASSET_ID(id) : id;
  const get = name => Promise.all([retry(() => gltf.loadAsync(ASSET + name + '_glb.wasm')), retry(() => texL.loadAsync(ASSET + name + '_tex.jpg'))]);
  return charP[id] = (async () => {
    const [g, tex] = await get(a);
    // A model with no skinned rig can play no clip, take no pose and hold no weapon (9/22 audit A3:
    // shroom_v2 THISTLE and mochi_v2 BLOAT shipped like that — Meshy could not rig those shapes). Falling
    // back to the older rigged art is NOT an option: those are the Toad / Kirby look-alikes the originals
    // replaced (2f_origins.js), and the HUD portrait would no longer match the fighter. So the new model
    // stays, flagged static, and 99_v3_finish.mjs moves it procedurally until a rigged one ships.
    const rigged = rtRigged(g.scene);
    if (!rigged) console.warn('[loadChar] ' + a + '_glb.wasm has no skinned rig: ' + id + ' uses procedural motion until a rigged model ships');
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = QUAL.aniso;
    // SkeletonUtils.clone shares geometry with this model, and every avatar's material clone keeps
    // this one texture, so both must survive an Avatar.dispose() (which disposes everything else it
    // owns). See V3.disposeArena.
    tex.userData.shared = true;
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.geometry.userData.shared = true;
        o.castShadow = true; o.receiveShadow = !V3.noFighterShade; o.frustumCulled = false;   // shade under platforms + self-shadow (audit A14, 9/22 night)
        o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: id === 'clanker' ? 0.3 : 0.7, metalness: id === 'clanker' ? 0.75 : 0.0, envMapIntensity: id === 'clanker' ? 1.4 : 0.6 });
      }
    });
    const box = new THREE.Box3().setFromObject(g.scene);
    models[id] = { scene: g.scene, height: box.max.y - box.min.y, minY: box.min.y, static: !rigged };
    // bake this rig's retargeted clips now, off the frame that first draws the fighter (cached per id)
    if (Object.keys(baseClips).length) try { V3.clipsFor(id); } catch (e) { console.warn('[retarget] ' + id, e); }
  })().catch(e => { delete charP[id]; V3.missing.add(id); throw e; });   // no model yet: the renderer stands in a placeholder (94)
};
async function loadAll() {
  gltf = new GLTFLoader(); gltf.setMeshoptDecoder(MeshoptDecoder); texL = new THREE.TextureLoader();
  const first = [...new Set(Game.fighters.map(f => f.c.id))];
  let done = 0; const total = first.length + 2;
  const tick = () => { V3.progress = ++done / total; try { UI.loading && UI.loading(V3.progress); } catch (e) {} };
  const animP = (async () => { for (let i = 0; i < 4; i++) { try { const r = await fetch(ASSET + 'anims.json'); if (r.ok) { baseClips = await r.json(); tick(); return; } } catch (e) {} await new Promise(r => setTimeout(r, 400 * (i + 1))); } throw new Error('anims.json failed'); })();
  // a fighter whose model is missing must not take the whole 3D view down with it
  await Promise.all([animP, V3.loadProps(gltf, texL).then(tick), ...first.map(id => V3.loadChar(id).then(tick, tick))]);
  // models that landed before anims.json get their retargeted clips here, still behind the loading chip
  for (const id of Object.keys(models)) { try { V3.clipsFor(id); } catch (e) { console.warn('[retarget] ' + id, e); } }
  // background preload of everyone else, one at a time
  // #nopreload: dev harnesses (dev/gearcheck.mjs, dev/gearsheet.mjs) load only the fighters they ask for
  // ...but never while a real match is being played: each load decodes a GLB, uploads a texture and bakes
  // retargeted clips on the main thread, and the whole roster is ~24 MB — during the first fight that was
  // 200-600 ms hitches (audit 9/22). It runs on the title/menus (and the attract demo), in idle time.
  const quiet = () => new Promise(res => {
    const go = () => { if (Game.state === 'match' && !Game.demo) return setTimeout(go, 800); if (window.requestIdleCallback) requestIdleCallback(() => res(), { timeout: 1200 }); else setTimeout(res, 40); };
    go();
  });
  // only the fighters the menus offer (79_core: the core 12), not all 46: a phone was downloading ~34 models nobody could pick
  if (!location.hash.includes('nopreload')) setTimeout(async () => { for (const c of (typeof coreChars === 'function' ? coreChars() : CHARS)) { await quiet(); try { await V3.loadChar(c.id); } catch (e) {} } }, 2500);
}

// >>> RETARGET (dev/aaa2/rt_harness.mjs extracts everything between these two markers and runs it in Node
// against the shipped GLBs, so keep this block self-contained: it may only use THREE)
//
// Why this exists (9/22 audit, REKT-FIGHTER-AUDIT/code-audit.md A1/A2): every clip in anims.json was
// authored on DOGE's rig, and the old clipsFor copied DOGE's LOCAL bone rotations straight onto the other
// 45 rigs. Each Meshy auto-rig bakes its own rest orientations (the Hips alone differ from DOGE's by up
// to 173 deg), and skinning applies boneWorld * bindWorld^-1, so every bone was rotated by exactly that
// difference: crossed legs, flipped pelvises, crumpled torsos, feet 20-26% of the body height through the
// deck. This bakes one clip set per rig instead:
//   * rotations: the same WORLD rotation DOGE makes from its rest pose, applied to this rig's rest pose
//       Tw(t)[b] = Dw(t)[b] * DrestW[b]^-1 * TrestW[b]      then back to locals in hierarchy order
//   * hips height: this rig's rest + DOGE's height change from ITS REST (not from the clip's first frame),
//     scaled by the ratio of the two hip heights; FLAT_Y clips keep the rest height as before
//   * grounding: for every clip that touches the floor, one constant per rig per clip moves the hips so the
//     lowest toe over the whole clip sits exactly where the toes sit in the bind pose (the renderer grounds
//     the model on its bind-pose minimum, 91_v3_render.mjs Avatar). Authored bounce is kept: only the
//     clip's LOWEST foot contact is pinned to the floor.
// DOGE comes out with its authored rotations unchanged (the delta is the identity).
function makeRetarget(THREE) {
  // DOGE's rest pose, generated from assets/doge_glb.wasm: [bone, parent bone, rest local quat x y z w],
  // in hierarchy order, and the Hips rest translation. Embedded so no match waits on DOGE's download.
  const DOGE = { hips: [0.06662, 53.9544, -4.2951], bones: [
    ['Hips', null, -0.3135732, -0.0154887, -0.0154887, 0.9493114], ['LeftUpLeg', 'Hips', -0.9495891, -0.1592121, 0.0864236, 0.2558576],
    ['LeftLeg', 'LeftUpLeg', 0.2215051, 0.038288, -0.0110973, 0.9743441], ['LeftFoot', 'LeftLeg', -0.4864177, -0.0805138, 0.0268808, 0.8695934],
    ['LeftToeBase', 'LeftFoot', -0.4039374, -0.0973777, -0.0432936, 0.9085581], ['RightUpLeg', 'Hips', -0.956297, 0.129508, -0.0589289, 0.2554431],
    ['RightLeg', 'RightUpLeg', 0.2225879, -0.0350524, 0.0159769, 0.9741513], ['RightFoot', 'RightLeg', -0.4706247, 0.067743, -0.0382544, 0.878897],
    ['RightToeBase', 'RightFoot', -0.4219509, 0.100623, 0.0471873, 0.899781], ['Spine02', 'Hips', 0.3451678, 0.0151702, 0.0153787, 0.9382924],
    ['Spine01', 'Spine02', 1e-7, 0, 0, 1], ['Spine', 'Spine01', -0.0537544, -0.0005963, 0.0007106, 0.9985538],
    ['LeftShoulder', 'Spine', 0.4997019, 0.520211, -0.5007619, 0.4784518], ['LeftArm', 'LeftShoulder', 0.4118392, 0.4287424, 0.1053627, 0.7971619],
    ['LeftForeArm', 'LeftArm', -0.2290796, -0.0118358, 0.1808936, 0.9563786], ['LeftHand', 'LeftForeArm', 0.0477887, 0.0745146, 0.1046957, 0.9905568],
    ['RightShoulder', 'Spine', 0.4997868, -0.5201294, 0.4981177, 0.4812041], ['RightArm', 'RightShoulder', 0.4148083, -0.431692, -0.1112076, 0.7932269],
    ['RightForeArm', 'RightArm', -0.2289383, 0.0115675, -0.1770883, 0.9571276], ['RightHand', 'RightForeArm', 0.0018841, -0.0851939, -0.1649745, 0.9826097],
    ['neck', 'Spine', 0.0489141, -0.0000689, -0.0000594, 0.998803], ['Head', 'neck', 0.263276, -0.0000016, -0.0007109, 0.9647203],
    ['head_end', 'Head', -0.2562794, 0, 0.0006949, 0.9666025], ['headfront', 'Head', 0.4709574, 0, -0.0012769, 0.8821551]] };
  // clips whose vertical hip motion is deliberately flattened (gameplay owns the height in the air)
  const FLAT_Y = new Set(['jump', 'fall', 'hit', 'flykick', 'spin', 'hang', 'hit2', 'launch2', 'flykick2']);
  // clips that never stand on the floor: no grounding constant (hang is placed by the ledge code)
  const AIR = new Set(['jump', 'fall', 'flykick', 'hang', 'launch2', 'flykick2']);
  const LEGS = [['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'], ['Hips', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']];
  const qa = new THREE.Quaternion(), va = new THREE.Vector3();
  let src = null, srcOf = null;

  // one track sampled at `times` (the union of the clip's key times), three's own interpolation
  function sample(t, v, s, times, quat) {
    const n = times.length, m = t.length, out = new Float64Array(n * s);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const T = times[k];
      while (j < m - 2 && t[j + 1] <= T) j++;
      if (m === 1 || T <= t[0]) { for (let c = 0; c < s; c++) out[k * s + c] = v[c]; continue; }
      if (T >= t[m - 1]) { for (let c = 0; c < s; c++) out[k * s + c] = v[(m - 1) * s + c]; continue; }
      const u = (T - t[j]) / (t[j + 1] - t[j]);
      if (quat) THREE.Quaternion.slerpFlat(out, k * 4, v, j * 4, v, (j + 1) * 4, u);
      else for (let c = 0; c < s; c++) out[k * s + c] = v[j * s + c] + (v[(j + 1) * s + c] - v[j * s + c]) * u;
    }
    return out;
  }
  // quaternion maths on flat arrays (the bake runs ~1000 keys x 24 bones per rig: no allocations in here)
  // out = a * b (three's Quaternion.multiply), or conj(a) * b when `ca` (a unit quaternion's inverse)
  function qmul(o, oi, a, ai, b, bi, ca) {
    const s = ca ? -1 : 1, ax = a[ai] * s, ay = a[ai + 1] * s, az = a[ai + 2] * s, aw = a[ai + 3];
    const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
    o[oi] = ax * bw + aw * bx + ay * bz - az * by;
    o[oi + 1] = ay * bw + aw * by + az * bx - ax * bz;
    o[oi + 2] = az * bw + aw * bz + ax * by - ay * bx;
    o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
  }
  // DOGE's world rotations for every clip, once per session (shared by every rig)
  function source(baseClips) {
    if (src && srcOf === baseClips) return src;
    const names = DOGE.bones.map(b => b[0]), pi = DOGE.bones.map(b => names.indexOf(b[1]));
    const restL = Float64Array.from(DOGE.bones.flatMap(b => b.slice(2)));
    const rw = new Float64Array(names.length * 4);
    for (let i = 0; i < names.length; i++) { if (pi[i] < 0) rw.set(restL.subarray(i * 4, i * 4 + 4), i * 4); else qmul(rw, i * 4, rw, pi[i] * 4, restL, i * 4); }
    const restW = {}; names.forEach((n, i) => { restW[n] = new THREE.Quaternion().fromArray(rw, i * 4); });
    const clips = {};
    for (const [name, data] of Object.entries(baseClips)) {
      const set = new Set(); for (const tr of data.tracks) for (const t of tr.t) set.add(t);
      const times = Float64Array.from([...set].sort((a, b) => a - b)), n = times.length, loc = {};
      let hip = null;
      for (const tr of data.tracks) {
        if (tr.p === 'rotation') loc[tr.n] = sample(tr.t, tr.v, 4, times, true);
        else if (tr.p === 'translation' && tr.n === 'Hips') hip = sample(tr.t, tr.v, 3, times, false);
      }
      const W = {}, arr = [];
      for (let i = 0; i < names.length; i++) {
        const out = new Float64Array(n * 4), L = loc[names[i]];
        for (let k = 0; k < n; k++) {
          const La = L || restL, li = L ? k * 4 : i * 4;
          if (pi[i] < 0) { out[k * 4] = La[li]; out[k * 4 + 1] = La[li + 1]; out[k * 4 + 2] = La[li + 2]; out[k * 4 + 3] = La[li + 3]; }
          else qmul(out, k * 4, arr[pi[i]], k * 4, La, li);
        }
        arr[i] = W[names[i]] = out;
      }
      clips[name] = { times, W, hip, tracked: new Set(Object.keys(loc)) };
    }
    srcOf = baseClips;
    return (src = { restW, clips });
  }

  // one clip set for this rig. `scene` is the loaded (never rendered) model: its root carries no transform.
  function bake(scene, baseClips) {
    const S = source(baseClips);
    scene.updateMatrixWorld(true);
    const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
    const hips = bones.find(b => b.name === 'Hips');
    if (!hips || !hips.parent) return null;
    const N = bones.length, idx = new Map(bones.map((b, i) => [b, i])), byName = new Map(bones.map((b, i) => [b.name, i]));
    const par = bones.map(b => (b.parent && b.parent.isBone && idx.has(b.parent) ? idx.get(b.parent) : -1));
    const Pq = hips.parent.getWorldQuaternion(new THREE.Quaternion()), P = Pq.toArray(), Pi = Pq.clone().invert().toArray();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(Pq.clone().invert()).normalize();   // world up, in the hips' parent space
    // per bone: the fixed delta DrestW^-1 * TrestW that carries DOGE's motion onto this rig
    const off = new Float64Array(N * 4), has = bones.map(b => !!S.restW[b.name]), restL = new Float64Array(N * 4);
    bones.forEach((b, i) => {
      b.quaternion.toArray(restL, i * 4);
      if (has[i]) S.restW[b.name].clone().invert().multiply(b.getWorldQuaternion(qa)).toArray(off, i * 4);
    });
    const hipRest = hips.position.clone(), ratio = hipRest.y / DOGE.hips[1];
    // the floor: where the toes sit in the bind pose, in the hips' parent space along `up`
    const legs = LEGS.map(ch => ch.map(n => byName.get(n)));
    const canGround = legs.every(ch => ch.every(i => i != null));
    const tl = bones.map(b => b.position.toArray());   // rest local translations (bone scales are 1)
    let floor = Infinity;
    if (canGround) for (const ch of legs) { bones[ch[4]].getWorldPosition(va); hips.parent.worldToLocal(va); floor = Math.min(floor, va.dot(up)); }
    const Tw = new Float64Array(N * 4), R = [0, 0, 0, 1], p = [0, 0, 0];
    const ux = up.x, uy = up.y, uz = up.z, identP = Math.abs(P[3]) > 0.999999;
    const out = {};
    for (const [name, C] of Object.entries(S.clips)) {
      const n = C.times.length, flat = FLAT_Y.has(name), ground = canGround && !AIR.has(name);
      const Wb = bones.map(b => C.W[b.name] || null);
      const rot = bones.map((b, i) => (has[i] && C.tracked.has(b.name) ? new Float32Array(n * 4) : null));
      const hp = new Float32Array(n * 3);
      let low = Infinity;
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < N; i++) {
          if (has[i]) qmul(Tw, i * 4, Wb[i], k * 4, off, i * 4);
          else if (par[i] >= 0) qmul(Tw, i * 4, Tw, par[i] * 4, restL, i * 4);   // a bone DOGE does not have follows its parent
          else qmul(Tw, i * 4, P, 0, restL, i * 4);
          const r = rot[i];
          if (r) {
            if (par[i] >= 0) qmul(r, k * 4, Tw, par[i] * 4, Tw, i * 4, true); else qmul(r, k * 4, P, 0, Tw, i * 4, true);
            const o = k * 4, l = Math.sqrt(r[o] * r[o] + r[o + 1] * r[o + 1] + r[o + 2] * r[o + 2] + r[o + 3] * r[o + 3]) || 1;
            r[o] /= l; r[o + 1] /= l; r[o + 2] /= l; r[o + 3] /= l;
          }
        }
        const y = flat || !C.hip ? hipRest.y : hipRest.y + (C.hip[k * 3 + 1] - DOGE.hips[1]) * ratio;
        hp[k * 3] = hipRest.x; hp[k * 3 + 1] = y; hp[k * 3 + 2] = hipRest.z;
        if (!ground) continue;
        // forward kinematics down both legs in the hips' parent space: pos(child) = pos(parent) + R(parent) * t
        for (const ch of legs) {
          p[0] = hipRest.x; p[1] = y; p[2] = hipRest.z;
          for (let c = 1; c < ch.length; c++) {
            const q = ch[c - 1];
            if (identP) { R[0] = Tw[q * 4]; R[1] = Tw[q * 4 + 1]; R[2] = Tw[q * 4 + 2]; R[3] = Tw[q * 4 + 3]; } else qmul(R, 0, Pi, 0, Tw, q * 4);
            const t = tl[ch[c]], qx = R[0], qy = R[1], qz = R[2], qw = R[3], vx = t[0], vy = t[1], vz = t[2];
            const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
            p[0] += vx + qw * tx + qy * tz - qz * ty; p[1] += vy + qw * ty + qz * tx - qx * tz; p[2] += vz + qw * tz + qx * ty - qy * tx;
          }
          const h = p[0] * ux + p[1] * uy + p[2] * uz; if (h < low) low = h;
        }
      }
      if (low !== Infinity) {                      // pin this clip's lowest toe contact to the floor
        const d = low - floor;
        for (let k = 0; k < n; k++) { hp[k * 3] -= ux * d; hp[k * 3 + 1] -= uy * d; hp[k * 3 + 2] -= uz * d; }
      }
      const times = Float32Array.from(C.times), tracks = [new THREE.VectorKeyframeTrack('Hips.position', times, hp)];
      for (let i = 0; i < N; i++) if (rot[i]) tracks.push(new THREE.QuaternionKeyframeTrack(bones[i].name + '.quaternion', times, rot[i]));
      out[name] = new THREE.AnimationClip(name, -1, tracks);
    }
    return out;
  }
  return { bake, DOGE };
}
// <<< RETARGET

const rtBaker = makeRetarget(THREE);
V3.rtMs = {};   // retarget bake cost per model id, ms (dev/aaa2 reads it)
// The pre-9/22 path, kept verbatim: DOGE's LOCAL rotations copied onto the rig. Used only for a rig the
// retarget cannot read (no Hips bone) and for the A/B switch `#...:noretarget`. Root motion is stripped so
// gameplay owns position.
const FLAT_Y = new Set(['jump', 'fall', 'hit', 'flykick', 'spin', 'hang']);
function rtLegacyClips(hipsRestY) {
  const out = {};
  for (const [name, data] of Object.entries(baseClips)) {
    const tracks = [];
    for (const tr of data.tracks) {
      if (tr.p === 'scale') continue;
      if (tr.p === 'translation') {
        if (tr.n !== 'Hips') continue;
        const v = tr.v.slice(), x0 = v[0], y0 = v[1], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0 * 0 + (hipsRestY ? hipsRestY.x : x0); v[i + 2] = hipsRestY ? hipsRestY.z : z0; v[i + 1] = (FLAT_Y.has(name) ? 0 : v[i + 1] - y0) + (hipsRestY ? hipsRestY.y : y0); }
        tracks.push(new THREE.VectorKeyframeTrack('Hips.position', tr.t, v));
      } else tracks.push(new THREE.QuaternionKeyframeTrack(tr.n + '.quaternion', tr.t, tr.v));
    }
    out[name] = new THREE.AnimationClip(name, -1, tracks);
  }
  return out;
}
function rtHipsOf(scene) { let h = null; scene.traverse(o => { if (!h && o.isBone && o.name === 'Hips') h = o; }); return h ? h.position.clone() : null; }
V3.hasClip = name => !!(baseClips && baseClips[name]);   // 91_v3_render NEWCLIP: only switch to a clip that shipped
V3.clipsFor = function (id, hipsRestY) {
  const m = models[id]; if (m.clips) return m.clips;
  if (m.static) {   // no skeleton: empty clips so the mixer binds nothing; the body moves procedurally (99)
    const out = {}; for (const n of Object.keys(baseClips).concat(['idle'])) out[n] = new THREE.AnimationClip(n, 1, []);
    return (m.clips = out);
  }
  if (!Object.keys(baseClips).length) return rtLegacyClips(null);   // anims.json not in yet: never cache an empty set
  let out = null;
  if (!location.hash.includes('noretarget')) {
    const t0 = performance.now();
    try { out = rtBaker.bake(m.scene, baseClips); } catch (e) { console.warn('[retarget] ' + id + ': falling back to the shared clips', e); }
    V3.rtMs[id] = Math.round((performance.now() - t0) * 10) / 10;
  }
  m.clips = out || rtLegacyClips(hipsRestY || rtHipsOf(m.scene));
  return m.clips;
};
V3.makeModel = function (id) {
  const m = models[id]; if (!m) return null;
  const root = SkeletonUtils.clone(m.scene);
  root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); if (V3.rimify) V3.rimify(o.material); o.castShadow = true; o.frustumCulled = false; } });
  return { root, height: m.height, minY: m.minY };
};

// ---------- arenas ----------
function stoneTex(dark) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = dark ? '#2b1f1d' : '#5a4a44'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${dark ? 20 : 40},${dark ? 12 : 30},${dark ? 10 : 28},${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6); }
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4;
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 64) % 2 ? 0 : 64; x <= w; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } }
  }, [6, 1]);
}
function lavaCrackTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff7a1a'; g.shadowColor = '#ffb040'; g.shadowBlur = 8; g.lineWidth = 2.5;
    for (let k = 0; k < 18; k++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 60; y += Math.random() * 30; g.lineTo(x, y); } g.stroke(); }
  }, [4, 1]);
}

function lavaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } }, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: NOISE + `uniform float t; varying vec2 vUv;
      void main(){ vec2 p = vUv*vec2(16.,8.); float f = fbm(p + vec2(t*.04, t*.025) + fbm(p*1.3 - t*.03));
        float crust = smoothstep(.42,.58,f);
        vec3 hot = vec3(1.2,.33,.05), dark = vec3(.08,.015,.01), core = vec3(1.7,.95,.3);
        vec3 c = mix(hot, dark, crust); c = mix(c, core, smoothstep(.3,.12,f));
        float fade = smoothstep(0., .25, vUv.y); gl_FragColor = vec4(c * (.35 + .65*fade), 1.); }`,
  });
}
function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } }, fog: false, transparent: false,
    vertexShader: 'varying vec2 vUv; varying vec3 wp; uniform float t; void main(){ vUv = uv; vec3 p = position; p.z += sin(p.x*.8+t*1.4)*.05 + cos(p.y*1.1+t)*.05; wp=(modelMatrix*vec4(p,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(wp,1.); }',
    fragmentShader: NOISE + `uniform float t; varying vec2 vUv; varying vec3 wp;
      void main(){ vec2 p = vUv*vec2(40.,20.); float n = fbm(p + vec2(t*.15, t*.08)); float n2v = fbm(p*2.1 - vec2(t*.2, 0.));
        float d = clamp(-wp.z / 40., 0., 1.);
        vec3 shallow = vec3(.10,.78,.80), deep = vec3(.03,.33,.55), sky = vec3(.75,.93,1.);
        vec3 c = mix(shallow, deep, d*.9 + n*.25);
        c = mix(c, sky, pow(d, 2.) * .55);
        float spark = smoothstep(.78,.86, n2v) * (1.-d*.6); c += vec3(1.4,1.35,1.2) * spark;
        gl_FragColor = vec4(c, 1.); }`,
  });
}

function buildLava(st) {
  const g = new THREE.Group(); const M = st.main, w = (M.x1 - M.x0) * SC, depth = 2.2;
  scene.fog = new THREE.Fog(0x3b1208, 12, 42);
  g.add(skyDome(0x12040a, 0x5a1a0c, 0xff6a1a));
  const stoneTop = new THREE.MeshStandardMaterial({ map: stageTex('temple', w / 1.7, depth / 1.7), roughness: 0.6, metalness: 0.15 });
  const stoneDark = new THREE.MeshStandardMaterial({ map: stoneTex(true), roughness: 0.9, emissive: 0xff5a10, emissiveMap: lavaCrackTex(), emissiveIntensity: 1.5 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, depth), [stoneDark, stoneDark, stoneTop, stoneDark, stoneDark, stoneDark]);
  top.position.set((M.x0 + M.x1) / 2 * SC, -0.14, 0); top.receiveShadow = true; g.add(top);
  const shape = new THREE.Shape(); const hb = (M.bot * SC);
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2 - 0.7, -hb - 1.2); shape.lineTo(0.2, -hb - 2.6); shape.lineTo(-0.2, -hb - 2.6); shape.lineTo(-w / 2 + 0.7, -hb - 1.2); shape.closePath();
  const under = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: depth * 0.9, bevelEnabled: false }), stoneDark);
  under.position.set((M.x0 + M.x1) / 2 * SC, -0.28, -depth * 0.45); g.add(under);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a0c05, emissive: 0xffb347, emissiveIntensity: 2.4 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, 0.05), trimMat); trim.position.set(top.position.x, -0.02, depth / 2); g.add(trim);
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.12, 1.3), [stoneDark, stoneDark, stoneTop, stoneDark, stoneDark, stoneDark]);
    slab.position.set((p.x0 + p.x1) / 2 * SC, -p.y * SC - 0.06, 0); slab.receiveShadow = true; slab.castShadow = true; g.add(slab);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.02, 0.04), trimMat); glow.position.set(slab.position.x, -p.y * SC - 0.005, 0.65); g.add(glow);
    for (const sx of [-1, 1]) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a302a, metalness: 0.8, roughness: 0.4 }));
      ch.position.set(slab.position.x + sx * (pw / 2 - 0.1), -p.y * SC + 4, 0); g.add(ch);
    }
  }
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), lavaMaterial());
  lava.rotation.x = -Math.PI / 2; lava.position.set(0, -4.6, -20); g.add(lava); g.userData.anim = [lava.material];
  // temple pillars + back wall with a giant coin emblem
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3d2a24, roughness: 0.8, map: stoneTex(false) });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc34a, metalness: 1, roughness: 0.3, emissive: 0x6a3a00, emissiveIntensity: 0.6 });
  for (const z of [-5.5, -10]) for (let x = -14; x <= 14; x += 3.6) {
    if (Math.abs(x) < 1.5 && z > -6) continue;
    const pl = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 16, 12), pillarMat); col.position.y = 3; pl.add(col);
    for (const y of [-4.2, 1.5, 7]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 24), goldMat); ring.rotation.x = Math.PI / 2; ring.position.y = y; pl.add(ring); }
    pl.position.set(x + (z < -6 ? 1.8 : 0), 0, z); g.add(pl);
  }
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ map: stoneTex(true), color: 0x6a4a40, roughness: 1 }));
  wall.position.set(0, 4, -16); g.add(wall);
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.MeshStandardMaterial({ color: 0x2a1500, emissive: 0xffa21a, emissiveIntensity: 0.9,
    emissiveMap: canvasTex(512, 512, (c, W, H) => { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.strokeStyle = '#fff'; c.lineWidth = 18; c.beginPath(); c.arc(W / 2, H / 2, W * 0.42, 0, 7); c.stroke(); c.fillStyle = '#fff'; c.font = 'bold 300px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Ð', W / 2, H / 2 + 20); }) }));
  emblem.position.set(0, 6.4, -15.9); g.add(emblem);
  // lights
  g.add(new THREE.HemisphereLight(0xffc9a0, 0x401206, 0.45));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.7); key.position.set(-4, 8, 7); key.castShadow = true;
  key.shadow.mapSize.set(QUAL.shadow, QUAL.shadow); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  g.add(key); g.add(key.target);
  const rim = new THREE.DirectionalLight(0xff6a20, 1.3); rim.position.set(3, 2, -8); g.add(rim);
  const under1 = new THREE.PointLight(0xff5a10, 14, 14, 1.6); under1.position.set(0, -3.2, 2); g.add(under1);
  const fire = []; for (const x of [-6.2, 6.2]) { const l = new THREE.PointLight(0xff9a30, 12, 9, 1.8); l.position.set(x, 3.2, -4.6); g.add(l); fire.push(l);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 0.35, 12), goldMat); bowl.position.set(x, 2.8, -4.6); g.add(bowl); }
  g.userData.fire = fire; g.userData.embers = 0xff8a2a;
  return g;
}

function palm(x, z, h, lean) {
  const g = new THREE.Group(); const trunk = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.7, side: THREE.DoubleSide });
  let px = 0, py = 0; const segs = 9;
  for (let i = 0; i < segs; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.14 - i * 0.008, 0.17 - i * 0.008, h / segs + 0.02, 8), trunk); px += lean * i * 0.02; py += h / segs; s.position.set(px, py - h / segs / 2, 0); s.rotation.z = -lean * 0.12 * i / segs; g.add(s); }
  for (let k = 0; k < 8; k++) {
    const geo = new THREE.PlaneGeometry(2.4, 0.5, 8, 1); const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = (pos.getX(i) + 1.2) / 2.4; pos.setY(i, pos.getY(i) * (1 - u * 0.8) - u * u * 0.9); }
    geo.computeVertexNormals(); const l = new THREE.Mesh(geo, leaf); l.position.set(px + 1.2 * Math.cos(k / 8 * 6.28) * 0.5, py, 1.2 * Math.sin(k / 8 * 6.28) * 0.5);
    l.rotation.y = -k / 8 * 6.28; l.geometry.translate(1.2, 0, 0); l.position.set(px, py, 0); l.castShadow = true; g.add(l);
  }
  g.position.set(x, 0, z); return g;
}
function buildDock(st) {
  const g = new THREE.Group(); const M = st.main, w = (M.x1 - M.x0) * SC, depth = 2.4;
  scene.fog = new THREE.Fog(0xbfe8ff, 20, 70);
  g.add(skyDome(0x2c8fe6, 0xbfeaff, 0x9fd8f0));
  const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.8), fog: false }));
  sun.position.set(28, 22, -120); sun.lookAt(0, 0, 0); g.add(sun);
  const wood = canvasTex(512, 512, (c, W, H) => {
    for (let i = 0; i < 8; i++) { const y = i * H / 8; c.fillStyle = `hsl(${28 + Math.random() * 8},${40 + Math.random() * 12}%,${34 + Math.random() * 10}%)`; c.fillRect(0, y, W, H / 8 - 5);
      for (let k = 0; k < 60; k++) { c.strokeStyle = `rgba(60,30,10,${Math.random() * 0.3})`; c.lineWidth = 1 + Math.random() * 2; const yy = y + Math.random() * (H / 8 - 6); c.beginPath(); c.moveTo(0, yy); c.bezierCurveTo(W / 3, yy + Math.random() * 4 - 2, W * 2 / 3, yy + Math.random() * 4 - 2, W, yy); c.stroke(); }
      c.fillStyle = 'rgba(20,10,5,.8)'; c.fillRect(0, y + H / 8 - 5, W, 5); }
  }, [w / 2.4, 1]);
  wood.rotation = Math.PI / 2;
  // (9/22 night, core map) warmer, deeper planks: the stock plank texture read washed-out against the bright water
  const woodMat = new THREE.MeshStandardMaterial({ map: stageTex('planks', w / 2.2, depth / 2.2), color: 0xd8b48a, roughness: 0.72 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, depth), woodMat); deck.position.set((M.x0 + M.x1) / 2 * SC, -0.09, 0); deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
  // piles with vertical grain and a darker wet band at the waterline (were flat untextured brown cylinders). The front
  // row stops at the deck: its bollards rose 0.35 above the planks BETWEEN the camera and the fighters and hid their
  // feet. Bollards + mooring rope now run along the back edge, behind the fight.
  const grain = canvasTex(128, 512, (c, W, H) => {
    c.fillStyle = '#7a5634'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = Math.random() * W; c.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,24,10' : '150,110,70'},${0.15 + Math.random() * 0.3})`; c.lineWidth = 1 + Math.random() * 3; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + Math.random() * 6 - 3, H / 3, x + Math.random() * 6 - 3, H * 2 / 3, x + Math.random() * 4 - 2, H); c.stroke(); }
    const wet = c.createLinearGradient(0, H * 0.55, 0, H); wet.addColorStop(0, 'rgba(20,30,28,0)'); wet.addColorStop(0.35, 'rgba(20,30,28,.55)'); wet.addColorStop(1, 'rgba(12,22,20,.8)'); c.fillStyle = wet; c.fillRect(0, H * 0.55, W, H * 0.45);
  });
  const postMat = new THREE.MeshStandardMaterial({ map: grain, roughness: 0.82 });
  const zF = depth / 2 - 0.15, zB = -depth / 2 + 0.15;
  for (let x = M.x0 * SC + 0.2; x <= M.x1 * SC - 0.1; x += 1.05) {
    const pf = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.0, 12), postMat); pf.position.set(x, -0.18 - 1.5, zF); pf.castShadow = true; g.add(pf);
    const pb = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.6, 12), postMat); pb.position.set(x, -1.45, zB); pb.castShadow = true; g.add(pb);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.08, 12), postMat); cap.position.set(x, 0.39, zB); g.add(cap);
  }
  // a stringer under the front edge ties the piles together
  const stringer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.16, 0.12), postMat); stringer.position.set((M.x0 + M.x1) / 2 * SC, -0.28, zF + 0.02); stringer.castShadow = true; g.add(stringer);
  const rope = new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 1 });
  for (let x = M.x0 * SC + 0.2; x < M.x1 * SC - 1; x += 1.05) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0.3, zB), new THREE.Vector3(x + 0.52, 0.14, zB - 0.04), new THREE.Vector3(x + 1.05, 0.3, zB));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 6), rope));
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(160, 80, 80, 40), waterMaterial()); water.rotation.x = -Math.PI / 2; water.position.set(0, -1.1, -30); g.add(water);
  g.userData.anim = [water.material];
  const sand = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ color: 0xf1d9a0, roughness: 1 }));
  sand.scale.set(16, 1.4, 5); sand.position.set(-3, -1.2, -16); g.add(sand);
  const sand2 = sand.clone(); sand2.scale.set(10, 1.1, 4); sand2.position.set(14, -1.2, -22); g.add(sand2);
  for (const [x, z, h, l] of [[-9, -15, 4.6, 1], [-6, -17, 5.2, -0.6], [-1, -15.5, 4.2, 0.8], [5, -16.5, 5, -1], [12, -21, 4.4, 0.7], [16, -22, 5.2, -0.8], [-14, -14, 4, 0.9]]) g.add(palm(x, z, h, l));
  const hutMat = new THREE.MeshStandardMaterial({ color: 0xc9a27a, roughness: 0.9 }), roofMat = new THREE.MeshStandardMaterial({ color: 0x9a7b45, roughness: 1 });
  for (const [x, z] of [[-4, -18.5], [2, -19], [9, -23]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.6), hutMat); b.position.set(x, 0.5, z); g.add(b); const r = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.2, 4), roofMat); r.rotation.y = Math.PI / 4; r.position.set(x, 1.8, z); g.add(r); }
  const mtn = new THREE.MeshStandardMaterial({ color: 0x4f8f6a, roughness: 1, flatShading: true });
  for (const [x, z, s] of [[-30, -60, 14], [-8, -70, 18], [22, -64, 15], [40, -75, 20]]) { const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.8, s, 7), mtn); m.position.set(x, s / 2 - 2, z); g.add(m); }
  g.add(new THREE.HemisphereLight(0xd6f0ff, 0xe0c080, 0.7));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.2); key.position.set(-5, 9, 6); key.castShadow = true;
  key.shadow.mapSize.set(QUAL.shadow, QUAL.shadow); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  g.add(key); g.add(key.target);
  const rim = new THREE.DirectionalLight(0x9fe0ff, 1.4); rim.position.set(4, 3, -8); g.add(rim);
  g.userData.embers = null;
  return g;
}

function buildKeep(st) {
  const g = new THREE.Group(); const M = st.main, w = (M.x1 - M.x0) * SC, depth = 2.2;
  scene.fog = new THREE.Fog(0x0b0c18, 10, 40);
  g.add(skyDome(0x04050b, 0x191232, 0x2a0a18));
  const moon = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 2.0), fog: false }));
  moon.position.set(-30, 26, -120); moon.lookAt(0, 0, 0); g.add(moon);
  const rock = new THREE.MeshStandardMaterial({ map: stageTex('basalt', w / 1.8, depth / 1.8), roughness: 0.85 });
  const rune = new THREE.MeshStandardMaterial({ map: stoneTex(true), color: 0x6a6a80, roughness: 0.9, emissive: 0xff1a3c, emissiveMap: lavaCrackTex(), emissiveIntensity: 1.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, depth), [rune, rune, rock, rune, rune, rune]);
  top.position.set(0, -0.15, 0); top.receiveShadow = true; g.add(top);
  const shape = new THREE.Shape(); const hb = M.bot * SC;
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2 - 0.9, -hb - 1.6); shape.lineTo(-w / 2 + 0.9, -hb - 1.6); shape.closePath();
  const under = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: depth * 0.9, bevelEnabled: false }), rune); under.position.set(0, -0.3, -depth * 0.45); g.add(under);
  const neon = new THREE.MeshStandardMaterial({ color: 0x100008, emissive: 0xff2a4a, emissiveIntensity: 3.5 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, 0.05), neon); trim.position.set(0, -0.02, depth / 2); g.add(trim);
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.14, 1.3), [rune, rune, rock, rune, rune, rune]);
    slab.position.set((p.x0 + p.x1) / 2 * SC, -p.y * SC - 0.07, 0); slab.receiveShadow = true; slab.castShadow = true; g.add(slab);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.02, 0.04), neon); gl.position.set(slab.position.x, -p.y * SC - 0.005, 0.65); g.add(gl);
  }
  // waterfall + mist
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(5, 26), new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } }, transparent: true, depthWrite: false, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: NOISE + 'uniform float t; varying vec2 vUv; void main(){ float n = fbm(vec2(vUv.x*8., vUv.y*3. + t*1.6)); float edge = smoothstep(0.,.2,vUv.x)*smoothstep(1.,.8,vUv.x); vec3 c = mix(vec3(.35,.45,.7), vec3(1.2,1.3,1.5), n); gl_FragColor = vec4(c, (.35+.5*n)*edge); }',
  }));
  fall.position.set(6, 5, -12); g.add(fall);
  const mistTex = canvasTex(256, 256, (c, W, H) => { const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); });
  const mists = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.35, color: 0xb8c4ff }));
    m.position.set(-14 + i * 1.9, -2.2 + Math.random() * 0.8, -2 - Math.random() * 10); g.add(m); mists.push(m);
  }
  g.userData.mists = mists;
  // rock spires with red lanterns
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x200008, emissive: 0xff2a4a, emissiveIntensity: 4 });
  const lights = [];
  for (const [x, z, h] of [[-9, -6, 10], [-5.5, -9, 13], [9.5, -7, 11], [13, -11, 15], [-13, -12, 14]]) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.3, h, 7), rock); sp.position.set(x, h / 2 - 4, z); g.add(sp);
    const lan = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.35), lanternMat); lan.position.set(x + 0.6, h - 5.5, z + 0.6); g.add(lan);
  }
  for (const x of [-7, 7]) { const l = new THREE.PointLight(0xff2a4a, 16, 12, 1.6); l.position.set(x, 3, -3); g.add(l); lights.push(l); }
  g.add(new THREE.HemisphereLight(0x9aa8ff, 0x1a0810, 0.5));
  const key = new THREE.DirectionalLight(0xc8d4ff, 1.8); key.position.set(-5, 9, 7); key.castShadow = true;
  key.shadow.mapSize.set(QUAL.shadow, QUAL.shadow); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  g.add(key); g.add(key.target);
  const rim = new THREE.DirectionalLight(0xff3050, 1.5); rim.position.set(4, 2, -8); g.add(rim);
  g.userData.anim = [fall.material]; g.userData.fire = lights; g.userData.embers = 0xff3a5a;
  return g;
}

function windowTex() {
  return canvasTex(256, 512, (c, W, H) => {
    c.fillStyle = '#07061a'; c.fillRect(0, 0, W, H);
    for (let y = 8; y < H; y += 16) for (let x = 6; x < W; x += 14) { const r = Math.random(); if (r < 0.42) { c.fillStyle = r < 0.08 ? '#7fd8ff' : r < 0.14 ? '#ff9ae0' : '#ffd79a'; c.globalAlpha = 0.5 + Math.random() * 0.5; c.fillRect(x, y, 8, 9); } }
    c.globalAlpha = 1;
  });
}
function neonSign(text, color) {
  const t = canvasTex(512, 160, (c, W, H) => { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.font = 'bold 110px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#fff'; c.shadowBlur = 20; c.fillStyle = '#fff'; c.fillText(text, W / 2, H / 2 + 6); });
  return new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
}
function rockGeo(r, detail, jitter, seed) {
  const g = new THREE.DodecahedronGeometry(r, detail), p = g.attributes.position;
  // jitter by position (not index) so faces that share a corner move together and the rock stays closed
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.abs(Math.sin(Math.round(x * 97) * 12.9898 + Math.round(y * 97) * 78.233 + Math.round(z * 97) * 37.719 + seed) * 43758.5453) % 1;
    const k = 1 + h * jitter; p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals(); return g;
}
function runeTex() {
  return canvasTex(256, 512, (c, W, H) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 16; c.lineCap = 'round'; c.shadowColor = '#fff'; c.shadowBlur = 16;
    c.beginPath(); c.moveTo(W / 2, 90); c.lineTo(W / 2, 250); c.stroke();
    c.beginPath(); c.moveTo(W / 2 - 50, 140); c.lineTo(W / 2, 80); c.lineTo(W / 2 + 50, 140); c.stroke();
    c.beginPath(); c.moveTo(W / 2 - 60, 190); c.lineTo(W / 2 + 60, 190); c.stroke();
    c.beginPath(); c.moveTo(W / 2 - 55, 280); c.lineTo(W / 2, 340); c.lineTo(W / 2 + 55, 280); c.stroke();
    c.beginPath(); c.moveTo(W / 2, 380); c.lineTo(W / 2 + 34, 414); c.lineTo(W / 2, 448); c.lineTo(W / 2 - 34, 414); c.closePath(); c.stroke();
  });
}
function buildIsle(st) {
  const g = new THREE.Group(); const M = st.main, w = (M.x1 - M.x0) * SC, depth = 2.8;
  scene.fog = new THREE.Fog(0xcfe6ff, 22, 90);
  g.add(skyDome(0x2f6fd0, 0xbfe3ff, 0xdfeeff));
  const sun = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 2.0), fog: false })); sun.position.set(-30, 30, -120); sun.lookAt(0, 0, 0); g.add(sun);
  const grassT = canvasTex(512, 256, (c, W, H) => { c.fillStyle = '#5fa83a'; c.fillRect(0, 0, W, H); for (let i = 0; i < 2600; i++) { c.fillStyle = `hsl(${88 + Math.random() * 30},${45 + Math.random() * 25}%,${28 + Math.random() * 22}%)`; c.fillRect(Math.random() * W, Math.random() * H, 2, 4 + Math.random() * 5); } }, [6, 1]);
  const rockT = canvasTex(512, 512, (c, W, H) => { c.fillStyle = '#8a7058'; c.fillRect(0, 0, W, H); for (let i = 0; i < 2200; i++) { const v = 70 + Math.random() * 70; c.fillStyle = `rgba(${v + 20},${v},${v - 20},${0.25 + Math.random() * 0.35})`; c.fillRect(Math.random() * W, Math.random() * H, 3 + Math.random() * 14, 2 + Math.random() * 8); } c.strokeStyle = 'rgba(40,28,20,.5)'; c.lineWidth = 3; for (let i = 0; i < 26; i++) { c.beginPath(); let x = Math.random() * W, y = Math.random() * H; c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 60; y += Math.random() * 40; c.lineTo(x, y); } c.stroke(); } }, [3, 2]);
  const grass = new THREE.MeshStandardMaterial({ map: stageTex('plaza', w / 1.25, depth / 1.25), roughness: 0.85 });
  const cliff = new THREE.MeshStandardMaterial({ map: stageTex('cliff', w / 2.4, 0.62), roughness: 0.9 });
  const rock = new THREE.MeshStandardMaterial({ map: rockT, roughness: 0.9, flatShading: true });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8b0c0, roughness: 0.85, flatShading: true, map: stoneTex(false) });
  // (9/22 night, core map) the stage's front face and sides were a cartoon brick-and-vine tile that read as flat 2D
  // wallpaper against the painted island; they are now the mossy natural rock the floating islands in the painting are
  // made of (95's tile atlas, tiled at ~1.3 units so it keeps its scale on the long face)
  const isleRock = (V3.tileMat && !V3.oldIsle) ? V3.tileMat('mossrock', { m: { roughness: 0.88, color: 0xd8d0c0 } }) : cliff;
  const topGeo = new THREE.BoxGeometry(w, 0.7, depth);
  if (isleRock !== cliff) { const uv = topGeo.attributes.uv, T = 1.3, faces = [[depth, 0.7], [depth, 0.7], [w, depth], [w, depth], [w, 0.7], [w, 0.7]];
    for (let f = 0; f < 6; f++) if (f !== 2) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * faces[f][0] / T, uv.getY(i) * faces[f][1] / T); } }   // face 2 = the grass top, tiled by its own texture
  const top = new THREE.Mesh(topGeo, [isleRock, isleRock, grass, isleRock, isleRock, isleRock]); top.position.set(0, -0.35, 0); top.receiveShadow = true; g.add(top);
  // STONE TRIM (9/23). The stage was one BoxGeometry slab with a tiled face -- the single strongest
  // "amateur" read in the whole frame, because nothing real is a rectangle that long with no profile.
  // Three cheap pieces fix it, and they are what any built stone edge actually has:
  //   * a LIP COURSE that projects past the wall under the walking surface, so the top edge catches a
  //     highlight and throws a shadow line down the face instead of the two meeting at a bare corner
  //   * a lower STRING COURSE, which gives the wall a horizontal rhythm and a second shadow line
  // Pilasters every 1.7 units were tried too and REMOVED: at this camera distance a 0.11-deep box in
  // the same texture reads as a seam in the wall, not as a buttress -- it added noise, not structure
  // (runs/gfx/tr2). Two horizontal courses that throw real shadow lines is the whole win here.
  // V3.noTrim = the bare slab.
  if (!V3.noTrim) {
    const trimMat = isleRock;
    // Every trim box needs the SAME world tile size as the slab or the texture stretches across each
    // little piece and the trim reads as a smear instead of as stone (first attempt did exactly that).
    // Box face order is +X, -X, +Y, -Y, +Z, -Z; their sizes are DxH, DxH, WxD, WxD, WxH, WxH.
    const uvTile = (geo, W, H, D, T = 1.3) => {
      const uv = geo.attributes.uv, f = [[D, H], [D, H], [W, D], [W, D], [W, H], [W, H]];
      for (let i = 0; i < 6; i++) for (let k = 0; k < 4; k++) { const j = i * 4 + k; uv.setXY(j, uv.getX(j) * f[i][0] / T, uv.getY(j) * f[i][1] / T); }
      uv.needsUpdate = true; return geo;
    };
    const lip = new THREE.Mesh(uvTile(new THREE.BoxGeometry(w + 0.30, 0.15, depth + 0.30), w + 0.30, 0.15, depth + 0.30), trimMat);
    lip.position.set(0, -0.13, 0); lip.castShadow = true; lip.receiveShadow = true; g.add(lip);
    const band = new THREE.Mesh(uvTile(new THREE.BoxGeometry(w + 0.14, 0.09, depth + 0.14), w + 0.14, 0.09, depth + 0.14), trimMat);
    band.position.set(0, -0.46, 0); band.castShadow = true; band.receiveShadow = true; g.add(band);
  }
  const boulders = [];
  // craggy underside built from jittered boulders
  for (let i = 0; i < 16; i++) {
    const t = i / 15, x = (t - 0.5) * (w - 0.6), taper = 1 - Math.abs(t - 0.5) * 1.3;
    const r = 0.5 + taper * 0.35, sy = 1.1 + taper * 0.7;
    const b = new THREE.Mesh(rockGeo(r, 1, 0.3, i), rock); b.position.set(x, -0.4 - r * sy * 1.1, -0.25 + (i % 3 - 1) * 0.3); b.scale.set(1.25, sy, 0.95); b.receiveShadow = true; g.add(b); boulders.push(b);
  }
  const tip = new THREE.Mesh(rockGeo(0.8, 1, 0.3, 99), rock); tip.position.set(0.3, -2.9, -0.2); tip.scale.set(1.3, 1.6, 1); g.add(tip); boulders.push(tip);
  islandUnder(g, 0, -0.72, w * 0.98, depth * 0.95, boulders);
  // moss draping over the front lip and grass tufts
  // dripping moss: an alpha-cut strip along the front lip
  const mossT = canvasTex(1024, 128, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    for (let x = 0; x < W; x += 3) {
      const len = 10 + Math.pow(Math.random(), 2.2) * (H - 14) * (0.5 + 0.5 * Math.sin(x * 0.02)); const hue = 90 + Math.random() * 25;
      c.fillStyle = `hsl(${hue},${50 + Math.random() * 20}%,${22 + Math.random() * 18}%)`; c.fillRect(x, 0, 4, len);
      c.beginPath(); c.arc(x + 2, len, 3, 0, 7); c.fill();
    }
  });
  const mossStrip = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.1, 0.55), new THREE.MeshStandardMaterial({ map: mossT, transparent: true, alphaTest: 0.35, roughness: 1, side: THREE.DoubleSide }));
  mossStrip.position.set(0, -0.3, depth / 2 + 0.02);   // superseded by the sculpted underside's own moss
  const tuft = new THREE.MeshStandardMaterial({ color: 0x6fc83a, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 0; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), tuft); t.position.set((Math.random() - 0.5) * w, 0.08, depth / 2 - Math.random() * 0.4); t.rotation.z = (Math.random() - 0.5) * 0.5; g.add(t); }
  // crystals. 9/22 night: these were four stretched octahedra in hot pink and teal, emissive and flat-shaded,
  // and they read as party hats / traffic cones (audit evidence 10), one of them standing IN FRONT of the
  // fighters. Now: clusters of six-sided shards with pointed tips fanning out of a rock seat, glassy, in the
  // stage's rune colours, and only along the back edge where they frame the fight instead of covering it.
  const shardGeo = new THREE.CylinderGeometry(1, 1.08, 1, 6, 1), tipGeo = new THREE.ConeGeometry(1, 1, 6, 1);
  const crystalMats = {};
  // 9/23: a MeshStandardMaterial at roughness .06 / metalness .08 has almost nothing to shade with --
  // it relies entirely on the env probe for specular, so the shards read as flat pastel paper cut-outs
  // (runs/gfx/a_live420.png). Real crystal needs REFRACTION. MeshPhysicalMaterial with transmission
  // bends the backdrop through the shard and `dispersion` splits it, which is the whole look; a thin
  // clearcoat puts a hard highlight back on the facets. There are only ~6 clusters on the stage, so the
  // transmission render target is affordable -- measured below. V3.flatCrystals = the old material.
  const crystalMat = hex => crystalMats[hex] || (crystalMats[hex] = V3.flatCrystals
    ? new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.38, roughness: 0.06, metalness: 0.08, flatShading: true, transparent: true, opacity: 0.9 })
    : new THREE.MeshPhysicalMaterial({
        color: hex, emissive: hex, emissiveIntensity: 0.22,
        roughness: 0.08, metalness: 0,
        transmission: 0.92, thickness: 0.55, ior: 1.8, dispersion: 3.2,
        clearcoat: 1, clearcoatRoughness: 0.08,
        flatShading: true, transparent: true, opacity: 1,
      }));
  let cSeed = 7; const cr = () => ((cSeed = (cSeed * 16807) % 2147483647) / 2147483647);
  const crystal = (x, y, z, hex, s) => {
    const cg = new THREE.Group(), m = crystalMat(hex), n = 5 + Math.floor(cr() * 3);
    for (let k = 0; k < n; k++) {
      const len = (k === 0 ? 0.62 : 0.22 + cr() * 0.34), r = len * (0.16 + cr() * 0.05);
      const sh = new THREE.Group();
      const body = new THREE.Mesh(shardGeo, m); body.scale.set(r, len, r); body.position.y = len / 2; sh.add(body);
      const tp = new THREE.Mesh(tipGeo, m); tp.scale.set(r, r * 2.4, r); tp.position.y = len + r * 1.2; sh.add(tp);
      const a = k === 0 ? 0 : (k / n) * Math.PI * 2 + cr() * 0.6;
      sh.rotation.set(Math.sin(a) * (0.25 + cr() * 0.35), cr() * 3, Math.cos(a) * (0.25 + cr() * 0.35));
      sh.position.set(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.05);
      sh.traverse(o => { if (o.isMesh) o.castShadow = true; });
      cg.add(sh);
    }
    const seat = new THREE.Mesh(rockGeo(0.16, 1, 0.3, x * 7 + z), rock); seat.scale.set(1.4, 0.5, 1.1); seat.position.y = 0.02; cg.add(seat);
    cg.position.set(x, y, z); cg.scale.setScalar(s); return cg;
  };
  g.add(crystal(-2.6, 0, -1.15, 0x6a7cff, 0.9), crystal(2.9, 0, -1.2, 0xa56aff, 0.85), crystal(-3.95, 0, -1.1, 0x3fe0d0, 0.7));
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC, cx = (p.x0 + p.x1) / 2 * SC, cy = -p.y * SC;
    const sg = new THREE.BoxGeometry(pw, 0.16, 1.2); if (isleRock !== cliff) { const uv = sg.attributes.uv, fz = [[1.2, 0.16], [1.2, 0.16], null, [pw, 1.2], [pw, 0.16], [pw, 0.16]]; for (let f = 0; f < 6; f++) if (fz[f]) for (let k = 0; k < 4; k++) { const j = f * 4 + k; uv.setXY(j, uv.getX(j) * fz[f][0] / 1.3, uv.getY(j) * fz[f][1] / 1.3); } }
    const slab = new THREE.Mesh(sg, [isleRock, isleRock, grass, isleRock, isleRock, isleRock]); slab.position.set(cx, cy - 0.08, 0); slab.receiveShadow = slab.castShadow = true; g.add(slab);
    const under = new THREE.Mesh(rockGeo(0.55, 1, 0.3, cx * 10), rock); under.position.set(cx, cy - 0.5, 0); under.scale.set(pw * 0.9, 0.9, 1); g.add(under);
    islandUnder(g, cx, cy - 0.16, pw, 1.2, [under]);
    g.add(crystal(cx + pw * 0.35, cy, -0.42, [0x6a7cff, 0x3fe0d0, 0xa56aff][Math.abs(Math.round(cx)) % 3], 0.55));
  }
  // rune monoliths flanking the arena
  const rt = runeTex();
  for (const [x, z, h, s] of [[-9.5, -7, 8, 1], [9.8, -7.5, 8.6, 1.05], [-15, -13, 7, 0.9], [16, -14, 7.5, 0.9]]) {
    const m = new THREE.Mesh(rockGeo(1, 1, 0.18, x), stone); m.scale.set(1.1 * s, h / 2, 0.8 * s); m.position.set(x, h / 2 - 3.5, z); m.castShadow = true; g.add(m);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * s, 2.4 * s), new THREE.MeshBasicMaterial({ map: rt, color: new THREE.Color(2.4, 1.7, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    rune.position.set(x, h * 0.55 - 3.3, z + 0.95 * s); g.add(rune);
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 12), new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.9, roughness: 0.4 })); chain.position.set(x + 0.9, h * 0.3 - 3.5, z + 0.3); g.add(chain);
  }
  // distant floating islets, castle and mountains
  for (const [x, y, z, s] of [[-18, 4, -28, 2.2], [20, 6, -34, 2.6], [-6, 9, -46, 1.8], [30, 1, -50, 3]]) {
    const is = new THREE.Group(); const b = new THREE.Mesh(rockGeo(1, 1, 0.3, x), rock); b.scale.set(1.4, 1.1, 1.2); is.add(b);
    const tp = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.2, 0.3, 10), grass); tp.position.y = 0.95; is.add(tp); is.position.set(x, y, z); is.scale.setScalar(s); g.add(is);
  }
  const wall = new THREE.MeshStandardMaterial({ color: 0xb8b0a8, roughness: 0.9 }), roof = new THREE.MeshStandardMaterial({ color: 0xb8302a, roughness: 0.7 });
  for (const [x, h] of [[-26, 7], [-23, 9], [-20.5, 6], [-17.8, 8]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1, h, 10), wall); t.position.set(x, h / 2 - 2, -40); g.add(t); const r = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.4, 10), roof); r.position.set(x, h - 0.8, -40); g.add(r); }
  const mtn = new THREE.MeshStandardMaterial({ color: 0x8a98b8, roughness: 1, flatShading: true });
  for (const [x, z, s] of [[-40, -85, 30], [-8, -95, 38], [30, -88, 32], [58, -100, 40]]) { const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.8, s, 7), mtn); m.position.set(x, s / 2 - 10, z); g.add(m); }
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(220, 120, 60, 30), waterMaterial()); lake.rotation.x = -Math.PI / 2; lake.position.set(0, -10, -40); g.add(lake);
  const cloudT = canvasTex(256, 128, (c, W, H) => { for (let i = 0; i < 14; i++) { const gr = c.createRadialGradient(40 + Math.random() * 176, 50 + Math.random() * 40, 0, 40 + Math.random() * 176, 64, 50); gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); } });
  const clouds = [];
  for (let i = 0; i < 9; i++) { const cl = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: cloudT, transparent: true, depthWrite: false, opacity: 0.85, fog: false })); cl.position.set(-50 + i * 13, 10 + Math.random() * 10, -60 - Math.random() * 20); g.add(cl); clouds.push(cl); }
  g.userData.clouds = clouds; g.userData.anim = [lake.material];
  g.add(new THREE.HemisphereLight(0xcfe6ff, 0x6a8a3a, 0.75));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.4); key.position.set(-6, 10, 7); key.castShadow = true;
  key.shadow.mapSize.set(QUAL.shadow, QUAL.shadow); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  g.add(key); g.add(key.target);
  const rim = new THREE.DirectionalLight(0xa8d8ff, 1.2); rim.position.set(5, 4, -8); g.add(rim);
  g.userData.embers = null;
  // PHASE 8: birds. The isle had drifting cloud planes and animated lake water but nothing ALIVE in
  // the sky, which on a floating-island stage is the one thing you expect. Six silhouettes glide in a
  // slow loop at three depths, each flapping on its own phase (the wing is a scale on Y, which on a
  // flat chevron reads as a flap from any angle and costs nothing). They live well behind the fight
  // plane so they can never be mistaken for a fighter or a platform. V3.noBirds = off.
  if (!V3.noBirds) {
    const birdT = canvasTex(64, 32, (c, W, H) => {
      c.clearRect(0, 0, W, H);
      c.strokeStyle = 'rgba(28,34,48,.85)'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(6, 20); c.quadraticCurveTo(20, 6, 32, 16); c.quadraticCurveTo(44, 6, 58, 20); c.stroke();
    });
    const birdMat = new THREE.MeshBasicMaterial({ map: birdT, transparent: true, depthWrite: false, fog: false, opacity: 0.75 });
    const birdGeo = new THREE.PlaneGeometry(1.5, 0.75);
    const birds = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(birdGeo, birdMat);
      // 93_v3_fx HIDES every direct arena child behind z -4.8 when the painted plate loads (the painting
      // replaces the far procedural scenery), so anything further back than that is invisible no matter
      // how well it is placed -- measured: visible=false on all six while their NDC was on screen.
      const z = -7 - (i % 3) * 3.5, sc = 0.9 - (i % 3) * 0.18;
      b.scale.setScalar(sc);
      b.position.set(-16 + i * 6, 2.6 + (i % 4) * 1.0, z);
      b.userData.keep = true;   // 93's backdrop pass hides arena children behind z -4.8 unless they ask to stay   // low enough to sit in the framed view, not above it
      g.add(b);
      birds.push({ m: b, sp: 1.5 + (i % 3) * 0.7, ph: i * 1.7, y0: b.position.y, sc });
    }
    let bt = 0;
    g.userData.tick = t => {
      bt = t;
      for (const b of birds) {
        b.m.position.x += b.sp * 0.010;
        if (b.m.position.x > 19) b.m.position.x = -19;
        b.m.position.y = b.y0 + Math.sin(t * 0.35 + b.ph) * 0.5;
        b.m.scale.y = b.sc * (0.55 + 0.45 * Math.abs(Math.sin(t * 5.2 + b.ph)));   // the flap
      }
    };
  }
  return g;
}
function buildRoof(st) {
  const g = new THREE.Group(); const M = st.main, w = (M.x1 - M.x0) * SC, depth = 2.6;
  scene.fog = new THREE.Fog(0x120a2a, 14, 60);
  g.add(skyDome(0x03020a, 0x1a0c3a, 0x3a0a4a));
  const moon = new THREE.Mesh(new THREE.CircleGeometry(3, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.7, 2.2), fog: false })); moon.position.set(22, 20, -110); moon.lookAt(0, 0, 0); g.add(moon);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3a46, roughness: 0.85, map: stoneTex(false) });
  const pad = canvasTex(1024, 256, (c, W, H) => { c.fillStyle = '#2c2c36'; c.fillRect(0, 0, W, H); c.strokeStyle = '#ffd23f'; c.lineWidth = 10; c.beginPath(); c.arc(W / 2, H / 2, 100, 0, 7); c.stroke(); c.fillStyle = '#ffd23f'; c.font = 'bold 150px Impact'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', W / 2, H / 2 + 8); c.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 300; i++) c.fillRect(Math.random() * W, Math.random() * H, 3, 3); });
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, depth), [concrete, concrete, new THREE.MeshStandardMaterial({ map: stageTex('helipad', w / 2.6, depth / 2.6), roughness: 0.45, metalness: 0.3 }), concrete, concrete, concrete]);
  top.position.set(0, -0.15, 0); top.receiveShadow = true; g.add(top);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 30, depth - 0.2), new THREE.MeshStandardMaterial({ map: windowTex(), emissive: 0xffffff, emissiveMap: windowTex(), emissiveIntensity: 0.28, color: 0x14141e }));
  tower.position.set(0, -15.3, -0.1); g.add(tower);
  const edge = new THREE.MeshStandardMaterial({ color: 0x100010, emissive: 0xff4fd8, emissiveIntensity: 1.6 });
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, 0.05), edge); e1.position.set(0, -0.02, depth / 2); g.add(e1);
  for (let x = -w / 2 + 0.4; x < w / 2; x += 1.1) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.6) })); l.position.set(x, 0.05, depth / 2 - 0.05); g.add(l); }
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x55556a, metalness: 0.8, roughness: 0.35 }));
    slab.position.set((p.x0 + p.x1) / 2 * SC, -p.y * SC - 0.05, 0); slab.receiveShadow = slab.castShadow = true; g.add(slab);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.02, 0.04), new THREE.MeshStandardMaterial({ color: 0x001018, emissive: 0x22e6ff, emissiveIntensity: 3 })); gl.position.set(slab.position.x, -p.y * SC - 0.005, 0.6); g.add(gl);
  }
  const wt = windowTex(), bmat = new THREE.MeshStandardMaterial({ map: wt, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 0.8, color: 0x1a1a2a, roughness: 0.6 });
  for (let i = 0; i < 26; i++) {
    const bw = 2 + Math.random() * 3, bh = 8 + Math.random() * 26, z = -8 - Math.random() * 30, x = -30 + i * 2.4 + Math.random();
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), bmat); b.position.set(x, bh / 2 - 14, z); g.add(b);
  }
  const s1 = neonSign('PUMP', '#ff4fd8'); s1.position.set(-6.5, 5.5, -9); g.add(s1);
  const s2 = neonSign('HODL', '#22e6ff'); s2.position.set(7, 7, -12); g.add(s2);
  const s3 = neonSign('Ð 1$', '#ffd23f'); s3.position.set(1, 9.5, -20); s3.scale.setScalar(1.5); g.add(s3);
  g.add(new THREE.HemisphereLight(0x8a7aff, 0x201028, 0.55));
  const key = new THREE.DirectionalLight(0xd8d0ff, 1.8); key.position.set(-5, 9, 7); key.castShadow = true;
  key.shadow.mapSize.set(QUAL.shadow, QUAL.shadow); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  g.add(key); g.add(key.target);
  const rimA = new THREE.DirectionalLight(0xff4fd8, 1.4); rimA.position.set(6, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0x22e6ff, 1.2); rimB.position.set(-6, 3, -6); g.add(rimB);
  g.userData.rain = true; g.userData.embers = null;
  return g;
}
function buildDojo(st) {
  const g = new THREE.Group(); const M = st.main, w = (M.x1 - M.x0) * SC, depth = 2.4;
  scene.fog = new THREE.Fog(0xf0a888, 16, 70);
  g.add(skyDome(0x6a5aa8, 0xffb07a, 0xffd8b0));
  const sun = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.6, 1.0), fog: false })); sun.position.set(-18, 8, -120); sun.lookAt(0, 0, 0); g.add(sun);
  const plank = canvasTex(512, 512, (c, W, H) => { for (let i = 0; i < 10; i++) { c.fillStyle = `hsl(${24 + Math.random() * 6},${45 + Math.random() * 10}%,${36 + Math.random() * 8}%)`; c.fillRect(0, i * H / 10, W, H / 10 - 3); c.fillStyle = 'rgba(40,20,10,.7)'; c.fillRect(0, i * H / 10 + H / 10 - 3, W, 3); } }, [w / 3, 1]);
  plank.rotation = Math.PI / 2;
  const wood = new THREE.MeshStandardMaterial({ map: stageTex('dojo', w / 2.2, depth / 2.2), roughness: 0.45, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2014, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, depth), [dark, dark, wood, dark, dark, dark]); floor.position.set(0, -0.12, 0); floor.receiveShadow = true; g.add(floor);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 1.2, depth - 0.3), new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.85 })); base.position.set(0, -0.84, 0); g.add(base);
  const red = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.6 }), black = new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 0.7 });
  for (let x = -w / 2 + 0.2; x <= w / 2 - 0.1; x += (w - 0.4) / 6) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 10), red); p.position.set(x, -0.84, depth / 2 - 0.12); g.add(p); }
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.12, 1.1), wood); slab.position.set((p.x0 + p.x1) / 2 * SC, -p.y * SC - 0.06, 0); slab.castShadow = slab.receiveShadow = true; g.add(slab);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffa040, emissiveIntensity: 2 })); lantern.position.set(slab.position.x, -p.y * SC - 0.28, 0.3); g.add(lantern);
  }
  const torii = (x, z, s) => { const t = new THREE.Group(); for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5, 12), red); c.position.set(sx * 2, 2.5, 0); t.add(c); } const top = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.35, 0.5), black); top.position.y = 5.1; t.add(top); const mid = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.25, 0.3), red); mid.position.y = 4.3; t.add(mid); t.position.set(x, -1.4, z); t.scale.setScalar(s); return t; };
  g.add(torii(-6.5, -8, 1), torii(7.5, -14, 1.3));
  const mtn = new THREE.MeshStandardMaterial({ color: 0x6a4a7a, roughness: 1, flatShading: true });
  for (const [x, z, s] of [[-26, -60, 18], [0, -75, 26], [26, -62, 20], [45, -80, 24]]) { const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.8, s, 8), mtn); m.position.set(x, s / 2 - 4, z); g.add(m); }
  const blossom = new THREE.MeshStandardMaterial({ color: 0xffa8d0, roughness: 0.8, emissive: 0x6a2040, emissiveIntensity: 0.3 }), trunk = new THREE.MeshStandardMaterial({ color: 0x4a2a1a });
  for (const [x, z] of [[-10, -6], [11, -7], [-15, -12], [15, -13]]) { const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 4, 8), trunk); tr.position.set(x, 0.5, z); g.add(tr); for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + Math.random() * 0.6, 1), blossom); b.position.set(x + (Math.random() - 0.5) * 2.4, 3 + Math.random() * 1.4, z + (Math.random() - 0.5) * 1.6); g.add(b); } }
  g.add(new THREE.HemisphereLight(0xffd0b0, 0x5a3a5a, 0.8));
  const key = new THREE.DirectionalLight(0xffd0a0, 2.2); key.position.set(-6, 8, 6); key.castShadow = true;
  key.shadow.mapSize.set(QUAL.shadow, QUAL.shadow); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  g.add(key); g.add(key.target);
  g.userData.petals = true; g.userData.embers = null;
  return g;
}

// ---------- tearing an arena down ----------
// THE LEAK (found 9/21, and it is what "the whole thing slowed down" was): leaving a stage disposed
// its GEOMETRY and nothing else. Every material, every canvas texture and every 2048x2048 shadow map
// the stage built stayed resident, and its compiled shader program stayed alive with it, because
// three only releases a program when the last material referencing it is disposed. Measured over one
// page load: after 19 stage switches `renderer.info` went from 54 textures / 66 programs to 571 / 555
// and the SAME stage with the SAME cast went from 21.9 ms a frame to 49.9 ms. Play five matches on
// five stages and the game is half the speed it was, permanently, until you reload.
//
// Everything here is recoverable: three keeps the CPU-side image/canvas and re-uploads on next use,
// so coming back to a stage costs one upload instead of keeping every stage resident forever. The
// shared atlases and loaded GLBs opt out with `userData.shared` so even that upload is skipped.
const TEXKEYS = ['map', 'emissiveMap', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'lightMap',
  'displacementMap', 'specularMap', 'envMap', 'matcap', 'gradientMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'transmissionMap', 'thicknessMap'];
function disposeTex(t, seen) {
  if (!t || !t.isTexture || seen.has(t)) return;
  seen.add(t);
  if (t.isRenderTargetTexture) return;                      // owned by a render target, not by us
  if (t.userData && t.userData.shared) return;              // a cached atlas: keep it uploaded
  t.dispose();
}
function disposeMat(m, seen) {
  if (!m || seen.has(m)) return;
  seen.add(m);
  if (m.userData && m.userData.shared) return;              // belongs to a cached GLB
  for (const k of TEXKEYS) disposeTex(m[k], seen);
  if (m.uniforms) for (const k in m.uniforms) { const u = m.uniforms[k]; if (u) disposeTex(u.value, seen); }
  m.dispose();
}
V3.disposeArena = function (root) {
  if (!root) return;
  const seen = new Set();
  root.traverse(o => {
    const g = o.geometry;
    if (g && !seen.has(g) && !(g.userData && g.userData.shared)) { seen.add(g); g.dispose(); }
    const m = o.material;
    if (m) { if (Array.isArray(m)) for (const mm of m) disposeMat(mm, seen); else disposeMat(m, seen); }
    // a stage key light holds a shadow map of QUAL.shadow^2 x 4 bytes -- 16 MB at 2048 -- and it is
    // never freed by removing the light from the scene
    if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
  });
};

// ---- the playfield floor: put it UNDER the fighters, and give it form ----
// 93_v3_fx states the rule this enforces: "the fighters are the brightest, most saturated,
// highest-contrast object, always". Measured on a 1920x1080 Rune Isle frame on 9/27, they were not:
//
//     fighters  lum 131.5      main floor  lum 171.3      backdrop  lum 131.9
//
// The floor was the brightest thing on screen by 40, and the backdrop tied with the fighters, so
// nothing separated from anything. The floor is also the single largest surface in frame and it was
// evenly lit end to end, which is what made it read as a flat slab with a tiled photo on it rather
// than as ground.
//
// This darkens the big horizontal play surfaces and adds the falloff a real floor has: dimmer toward
// the outer edges and toward the back. It is a shader multiply on the albedo, so it costs nothing and
// it keeps every stage's own texture and palette -- no stage art is replaced.
//
// Applied by heuristic (wide, flat, receives shadow) rather than by name, because all 18 stages build
// their own floor and none of them are named. V3.noFloorTone = off, for the A/B.
function floorTone(mesh, k) {
  const g = mesh.geometry; if (!g) return;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  const hx = Math.max(0.001, (bb.max.x - bb.min.x) / 2), hz = Math.max(0.001, (bb.max.z - bb.min.z) / 2);
  // Remember the shape. Assigning a ONE-ELEMENT ARRAY back to a single-material mesh makes three
  // treat it as multi-material, and the faces with no matching group lose their material entirely --
  // which is how the textured rock band under Rune Isle turned into a flat grey gradient on the first
  // run of this pass.
  const wasArray = Array.isArray(mesh.material);
  const list = wasArray ? mesh.material : [mesh.material];
  // ONLY THE UPWARD FACE. A stage floor is a BoxGeometry with six materials, and three's face order
  // is +x, -x, +y, -y, +z, -z -- so index 2 is the top. Toning all six ran the falloff maths (which is
  // written in the slab's x/z) across the SIDE faces too, and the layered rock band under Rune Isle
  // came out as flat grey strips. A single-material slab has nothing but its top worth toning.
  const topIdx = wasArray ? 2 : 0;
  const toned = list.map((m0, i) => {
    if (i !== topIdx) return m0;
    if (!m0 || !m0.isMeshStandardMaterial || m0.userData.floorToned) return m0;
    const m = m0.clone(); m.userData.floorToned = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uFloorK = { value: k };
      sh.uniforms.uFloorHalf = { value: new THREE.Vector2(hx, hz) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFloorP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFloorK; uniform vec2 uFloorHalf; varying vec3 vFloorP;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  // 0 at the middle of the slab, 1 at its outer edge, along the length and into the depth
  float ex = clamp(abs(vFloorP.x) / uFloorHalf.x, 0.0, 1.0);
  float ez = clamp((vFloorP.z + uFloorHalf.y) / (2.0 * uFloorHalf.y), 0.0, 1.0);
  // darker toward the ends, and toward the BACK of the slab, which is what gives a flat plane depth
  float fall = 1.0 - 0.30 * smoothstep(0.45, 1.0, ex) - 0.22 * (1.0 - ez);
  diffuseColor.rgb *= uFloorK * clamp(fall, 0.35, 1.2);
}`);
    };
    m.customProgramCacheKey = () => prevKey + '|floorTone';
    m.needsUpdate = true;
    return m;
  });
  mesh.material = wasArray ? toned : toned[0];
}
// The surface fighters STAND on, not every wide flat thing. "wide + flat + receives shadow" also
// matches the decorative rock strips under the stage lip, and toning those turned Rune Isle's layered
// rock band into a flat grey slab. So: the mesh has to be wide, flat, a shadow receiver AND have its
// top face at the play plane -- which is where the stage's own collision says the floor is.
function toneFloors(root, st) {
  if (!root || V3.noFloorTone) return 0;
  // Every surface a fighter can stand on, not just the main floor. The soft platforms are where half
  // a match is spent and they had the same problem -- bright even slabs -- but they are ~2 units wide
  // so the main-floor test (>= 6) never saw them. They get a gentler tone: a small platform read
  // against the sky, not against the fighters, and taking it as far down as the main floor made the
  // stage look like it was under a cloud.
  const planes = [];
  if (st && st.main) planes.push([-st.main.top * SC, 6, 0.55]);
  for (const p of (st && st.plats) || []) planes.push([-p.y * SC, 1.1, 0.78]);
  let n = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.receiveShadow) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y;
    if (sy > 3 || sy < 0.2) return;             // sy < 0.2 is decorative trim, not a floor
    o.updateWorldMatrix(true, false);
    const topY = o.getWorldPosition(new THREE.Vector3()).y + bb.max.y * (o.scale ? o.scale.y : 1);
    for (const [py, minW, k] of planes) {
      if (sx < minW) continue;
      if (Math.abs(topY - py) > 0.3) continue;  // not this surface: a lip, a strip, an underside
      floorTone(o, k); n++; break;
    }
  });
  return n;
}

// ---- ground the stage's props ----
// The fighters got their contact shadow in 96_v3_feel; everything else on the stage was still
// floating. Zoomed 3x on Rune Isle, the crystal clusters sit on the tiles with the texture running
// unbroken up to their base -- the same "pasted on" tell the fighters had, on every prop of every
// stage. Rather than hand-place a shadow per prop across 18 stages, find anything small enough to be
// a prop whose base is at the play plane, and drop the SAME blob 96_v3_feel uses under it.
// Static: built once with the arena, never touched per frame. V3.noPropShade = off.
function groundProps(root, st) {
  if (!root || V3.noPropShade || !V3.contactTex) return 0;
  // The arena was added to the scene one line ago and its world matrices are stale, so
  // Box3.setFromObject returns every mesh's LOCAL bounds -- i.e. everything reads as sitting at the
  // origin. That put 24 of 28 prop shadows in one stack at the centre of the stage, which showed up
  // as a dark ellipse hovering on the floor with nothing above it.
  root.updateMatrixWorld(true);
  const planeY = st && st.main ? -st.main.top * SC : 0;
  const tex = V3.contactTex();
  const box = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3();
  const found = [];
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || o.userData.propShade) return;
    if (!o.visible) return;
    box.setFromObject(o);
    box.getSize(size);
    if (size.x < 0.12 || size.x > 4 || size.y > 5) return;      // too small to matter, or too big to be a prop
    if (Math.abs(box.min.y - planeY) > 0.18) return;            // its base is not on the floor
    box.getCenter(mid);
    // a pooled, parked mesh sits exactly on the stage's centre line with zero depth offset; a real
    // prop practically never does. Cheap guard against re-introducing the stack if a matrix is stale.
    if (Math.abs(mid.x) < 0.02 && Math.abs(mid.z) < 0.02) return;
    found.push([mid.x, mid.z, size.x, size.z]);
  });
  if (!found.length) return 0;
  // one merged group, and a hard cap: a stage with a hundred pebbles should not add a hundred draws
  const g = new THREE.Group(); g.name = 'propShade';
  for (const [x, z, sx, sz] of found.slice(0, 48)) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0.62, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, planeY + 0.012, z);
    const w = Math.max(0.22, sx * 1.5);
    m.scale.set(w, Math.max(0.16, Math.max(sz, sx * 0.5) * 1.5), 1);
    m.renderOrder = 1;                 // under the fighters' own blobs, which are 2
    m.userData.propShade = true;
    g.add(m);
  }
  root.add(g);
  return g.children.length;
}

V3.setArena = function (st) {
  if (arenaId === st.id && arena) return;
  if (arena) { scene.remove(arena); V3.disposeArena(arena); }
  lastSky = null;
  arena = (V3.buildExtra && V3.buildExtra(st)) || (st.theme === 'isle' ? buildIsle(st) : st.theme === 'chart' ? buildDock(st) : st.theme === 'keep' ? buildKeep(st) : st.theme === 'roof' ? buildRoof(st) : st.theme === 'dojo' ? buildDojo(st) : buildLava(st));
  arenaId = st.id; scene.add(arena);
  // the stage's own sky becomes its ambient (see skyEnvTex). ENVK is the per-stage trim: a stage
  // with a dark sky needs a little more of it than one standing under a bright one.
  scene.environment = lastSky ? skyEnvTex(lastSky[0], lastSky[1], lastSky[2]) : roomEnv;
  scene.environmentIntensity = (lastSky ? ENVK[st.theme] : null) ?? (lastSky ? 0.85 : 0.35);
  if (V3.onArena) V3.onArena(st, arena);
  V3.floorsToned = toneFloors(arena, st);
  V3.propsShaded = groundProps(arena, st);
  autoDecor(arena); applyShadows(); applyDecor();   // a freshly built stage joins the tier in force
  V3.resetLadder();   // a different arena costs something different: let the climb start fresh
  bloom.strength = { chart: 0.3, keep: 0.22, roof: 0.5, dojo: 0.3, isle: 0.32, city: 0.5, ship: 0.46, street: 0.26, arena: 0.55, swamp: 0.34, floor: 0.26, train: 0.38, peak: 0.26, lunar: 0.3, casino: 0.46, shibuya: 0.5, baghdad: 0.24, miami: 0.3 }[st.theme] ?? 0.45;
  renderer.toneMappingExposure = st.theme === 'chart' ? 1.0 : 1.05;
};
V3.arenaTick = function (t) {
  if (!arena) return;
  for (const m of arena.userData.anim || []) m.uniforms.t.value = t;
  for (const [i, l] of (arena.userData.fire || []).entries()) l.intensity = 7 + Math.sin(t * 13 + i * 2) * 1.5 + Math.sin(t * 7.3 + i) * 1.5;
  for (const c of arena.userData.clouds || []) { c.position.x += 0.01; if (c.position.x > 70) c.position.x = -70; }
  for (const [i, m] of (arena.userData.mists || []).entries()) { m.position.x += 0.004 + (i % 3) * 0.002; if (m.position.x > 16) m.position.x = -16; m.lookAt(V3.camera.position); }
};
V3.internals = () => ({ renderer, scene, camera, composer, clock, bloom, arena: () => arena });
V3.applyDecor = applyDecor;     // stage authors: call after adding decor to a live arena

V3.boot = async function () {
  try {
    init();
    await loadAll();
    V3.ready = true;
    try { UI.loading && UI.loading(1); } catch (e) { V3.fxErr(e, '90_v3_core:1230'); /* the loading chip is cosmetic */ }
  } catch (e) {
    console.warn('3D disabled:', e); V3.failed = true;
    const cv = document.getElementById('g3d'); if (cv) cv.remove();
    UI.loading && UI.loading(-1);
  }
};
