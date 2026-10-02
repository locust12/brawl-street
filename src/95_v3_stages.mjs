// ===== 3D: more arenas (Neon City, Star Cruiser, Brawl Street, Grand Arena, Gloom Bayou) + the new dojo =====
// Visual only: builders read the stage layout (and Game.frame, for platforms that move), never write
// fight state, and use Math.random only. V3.setArena asks V3.buildExtra first (one hook in 90).
// Everything sits inside one root group at z = 0, so the backdrop swap in 93 keeps it all; far
// scenery is placed to sit in front of the painted plate.

{ // one block scope: none of these names leak into the shared module (other files define their own helpers)
// ---------- helpers ----------
const S2 = { tex: {}, glb: {} };
function sTex(file, rx = 1, ry = 1, clamp, lin) {
  const key = file + (clamp ? ':c' : '') + (lin ? ':l' : '');
  let e = S2.tex[key];
  if (!e) {
    // A texture whose image has not downloaded yet renders BLACK, and these stage plates are
    // 0.5-0.9 MB each: on a cold load the big facades came up as black walls over half the screen
    // (9/21). So start from the shared 1 px neutral placeholder (90_v3_core placeholderImg) and swap
    // the real one in when it lands.
    // The swap goes through V3.swapImage, which hands out a NEW Source: writing into the existing
    // one leaves the GPU holding the 1 px texture forever, because three allocates with the immutable
    // texStorage2D and only on the first upload. Read the comment on V3.swapImage -- every atlas in
    // here was black on the GPU until 9/21, verified with `dev/perf_bench.mjs --tex`.
    const base = new THREE.Texture(placeholderImg());
    base.needsUpdate = true;
    base.userData.shared = true;   // cached across arenas: V3.disposeArena leaves it uploaded
    base.colorSpace = lin ? THREE.NoColorSpace : THREE.SRGBColorSpace; base.anisotropy = QUAL.aniso;
    if (!clamp) base.wrapS = base.wrapT = THREE.RepeatWrapping;
    e = S2.tex[key] = { base, kin: [base] };
    new THREE.TextureLoader().load(ASSET + file, t => V3.swapImage(e.kin, t.image));
  }
  if (rx === 1 && ry === 1) return e.base;
  const t = e.base.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; e.kin.push(t); return t;
}
// tile atlases: 4 seamless textures per 1024 px file (480 px tiles, 16 px wrapped padding, see
// assets3d/stage_atlas.py). Materials repeat one cell with fract() + textureGrad.
const ATL = { a: 'stg_tiles_a.jpg', b: 'stg_tiles_b.jpg', c: 'stg_tiles_c.jpg', d: 'stg_tiles_d.jpg', e: 'stg_tiles_e.jpg' };
const CELL = { cityroof: ['a', 0], facade: ['a', 1], shipdeck: ['a', 2], hull: ['a', 3], asphalt: ['b', 0], sidewalk: ['b', 1], graffiti: ['b', 2], arenapanel: ['b', 3], bark: ['c', 0], granite: ['c', 1], streetcut: ['c', 2], dojofloor: ['c', 3],
  leaf: ['d', 0], cedar: ['d', 1], mossrock: ['d', 2], wetdeck: ['d', 3], carved: ['e', 0], crust: ['e', 1], mudbrick: ['e', 2] };
function tileMat(name, o = {}) {
  const [a, i] = CELL[name], tex = sTex(ATL[a], 1, 1, true), cx = i % 2, cy = i >> 1;
  const rect = new THREE.Vector4((cx * 512 + 16) / 1024, 1 - (cy * 512 + 16 + 480) / 1024, 480 / 1024, 480 / 1024);
  const m = std(Object.assign({ map: tex }, o.glow ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: o.glow } : {}, o.m || {}));
  m.onBeforeCompile = sh => {
    sh.uniforms.uCell = { value: rect };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uCell;\nvec4 cellTex(sampler2D t, vec2 uv) { vec2 g = uv * uCell.zw; return textureGrad(t, uCell.xy + fract(uv) * uCell.zw, dFdx(g), dFdy(g)); }')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor *= cellTex( map, vMapUv );\n#endif')
      .replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP\n totalEmissiveRadiance *= cellTex( emissiveMap, vEmissiveMapUv ).rgb;\n#endif');
  };
  // One key for every cell is correct and cheaper: `materialProperties.programs` is per MATERIAL,
  // so onBeforeCompile runs for each material and each gets its own uCell even when they share a
  // compiled program. (I briefly made the key per-cell chasing the flat-texture bug; that was not
  // the cause - see V3.swapImage in 90_v3_core - so it is back to one program for the lot.)
  m.customProgramCacheKey = () => 'stgcell';
  return m;
}
// card atlases: [u0, v0, u1, v1] rects (printed by stage_atlas.py)
const CARD = {
  lowrider: [0.0, 0.7285, 1.0, 1.0], muscle: [0.0, 0.4225, 1.0, 0.7233],
  palm0: [0.0, 0.0, 0.1354, 0.4147], palm1: [0.1406, 0.0, 0.3522, 0.4147], palm2: [0.3574, 0.0, 0.5872, 0.4147],
  market: [0.0, 0.4473, 1.0, 1.0], coinboard: [0.0, 0.0, 0.3311, 0.4434], trophy: [0.3369, 0.0, 0.5078, 0.4434],
};
function cardGeo(w, h, r) { const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); return g; }
// box with UVs in world units (one texture tile = `tile` units on every face)
function wbox(w, h, d, tile = 1, ox = 0, oy = 0) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i), x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i);
    if (Math.abs(nx) > 0.5) uv.setXY(i, -z * nx / tile, y / tile);
    else if (Math.abs(ny) > 0.5) uv.setXY(i, x / tile, -z * ny / tile);
    else uv.setXY(i, x * nz / tile, y / tile);
  }
  return g;
}
function scaleUV(g, k, ox = 0, oy = 0) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k + ox, uv.getY(i) * k + oy); return g; }
function put(parent, geo, mat, x, y, z, o) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (o) {
    if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
    if (o.s) typeof o.s === 'number' ? m.scale.setScalar(o.s) : m.scale.set(...o.s);
    if (o.cast) m.castShadow = true; if (o.recv) m.receiveShadow = true;
  }
  parent.add(m); return m;
}
const std = o => new THREE.MeshStandardMaterial(o);
const glow = (hex, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
const glowA = (hex, k = 1, op = 1, map) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), map: map || null, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
let haloT = null;
function halo() {
  if (!haloT) { haloT = canvasTex(128, 128, (c, W, H) => { const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); }); haloT.userData.shared = true; }
  return haloT;
}
function sprite(parent, hex, k, size, x, y, z, fog) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: new THREE.Color(hex).multiplyScalar(k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: !!fog }));
  s.scale.set(size, size, 1); s.position.set(x, y, z); parent.add(s); return s;
}
function sunKey(g, color, k, pos, box) {
  const L = new THREE.DirectionalLight(color, k); L.position.set(...pos); L.castShadow = true;
  L.shadow.mapSize.set(QUAL.shadow, QUAL.shadow);
  Object.assign(L.shadow.camera, box || { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  L.shadow.bias = -0.0004; L.shadow.normalBias = 0.02; g.add(L); g.add(L.target); return L;
}
function noiseTex(base, spots, n, size = 256) {
  return canvasTex(size, size, (c, W, H) => {
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) { c.fillStyle = spots[i % spots.length]; c.globalAlpha = 0.05 + Math.random() * 0.2; const s = 1 + Math.random() * 5; c.fillRect(Math.random() * W, Math.random() * H, s, s); }
    c.globalAlpha = 1;
  }, [1, 1]);
}
// a flat-ended beam between two points
function beam(parent, mat, a, b, r, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); parent.add(m); return m;
}
// sagging cable (catenary-ish) between two points
function cable(parent, mat, a, b, sag, r = 0.012) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5); mid.y -= sag;
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 24, r, 5), mat); parent.add(m); return m;
}
// generated models ship as .wasm (GLB bytes) + a separate jpg texture
function loadGlb(name, onReady, tries = 0) {
  let p = S2.glb[name];
  if (!p) {
    const L = gltf || new GLTFLoader(), TL = texL || new THREE.TextureLoader();
    p = S2.glb[name] = Promise.all([L.loadAsync(ASSET + name + '_glb.wasm'), TL.loadAsync(ASSET + name + '_tex.jpg')]).then(([m, tex]) => {
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = QUAL.aniso;
      tex.userData.shared = true;
      // Callers clone() this scene, and a clone SHARES geometry and material with it. Mark both so
      // V3.disposeArena (90_v3_core) leaves the cached original alone when the arena goes away.
      m.scene.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = std({ map: tex, roughness: 0.32, metalness: 0.55, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }); o.castShadow = true; o.material.userData.shared = true; o.geometry.userData.shared = true; } });
      return m.scene;
    });
  }
  // a failed download stayed cached (rejected) and the model never appeared that session: forget it and retry
  p.then(onReady).catch(() => { if (S2.glb[name] === p) delete S2.glb[name]; if (tries < 2) setTimeout(() => loadGlb(name, onReady, tries + 1), 700 * (tries + 1)); });
}
// stock underside for floating pieces: jittered boulders along the bottom of a slab
function rubble(g, mat, x0, x1, topY, zc, depth, seed) {
  const n = Math.max(3, Math.round((x1 - x0) / 0.6));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = x0 + (x1 - x0) * t, taper = 1 - Math.abs(t - 0.5) * 1.4, r = 0.35 + taper * 0.3;
    const b = put(g, rockGeo(r, 1, 0.3, seed + i), mat, x, topY - r * 0.9 * (0.8 + taper), zc + ((i % 3) - 1) * depth * 0.12);
    b.scale.set(1.3, 0.9 + taper * 0.8, depth / (2 * r) * 0.8);
  }
}

// ---------- Neon City ----------
function candleTex() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 320;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  let v = 0.5; const bars = Array.from({ length: 36 }, () => { const o = v; v = Math.min(0.9, Math.max(0.1, v + (Math.random() - 0.42) * 0.12)); return { o, c: v }; });
  t.userData = { cv, bars, step() { const last = bars[bars.length - 1].c; bars.shift(); const c = Math.min(0.92, Math.max(0.08, last + (Math.random() - 0.4) * 0.14)); bars.push({ o: last, c }); this.draw(); },
    draw() {
      const g = cv.getContext('2d'), W = cv.width, H = cv.height;
      g.fillStyle = '#040816'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(80,200,255,.14)'; g.lineWidth = 1; for (let y = 20; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      const bw = W / bars.length, Y = k => H - 16 - k * (H - 40);
      bars.forEach((b, i) => { const up = b.c >= b.o, col = up ? '#3dffa0' : '#ff4d7a'; g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 2;
        g.beginPath(); g.moveTo(i * bw + bw / 2, Y(Math.max(b.o, b.c) + 0.04)); g.lineTo(i * bw + bw / 2, Y(Math.min(b.o, b.c) - 0.04)); g.stroke();
        g.fillRect(i * bw + 2, Y(Math.max(b.o, b.c)), bw - 4, Math.max(3, Math.abs(Y(b.o) - Y(b.c)))); });
      g.strokeStyle = '#8ef6ff'; g.lineWidth = 3; g.beginPath(); bars.forEach((b, i) => { const x = i * bw + bw / 2, y = Y(b.c); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      g.strokeStyle = '#22e6ff'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
      t.needsUpdate = true;
    } };
  t.userData.draw(); return t;
}
function tickerTex() {
  return canvasTex(2048, 64, (c, W, H) => {
    c.fillStyle = '#020308'; c.fillRect(0, 0, W, H); c.font = 'bold 40px Bungee, Impact, sans-serif'; c.textBaseline = 'middle';
    const items = ['▲ 42.0%', '▼ 3.1%', '▲ 188%', '▲ 7.7%', '▼ 12.4%', '▲ 69.4%', '▲ 1,337%', '▼ 0.8%', '▲ 21%', '▲ 420%'];
    let x = 10; for (let k = 0; x < W; k++) { const s = items[k % items.length]; c.fillStyle = s[0] === '▲' ? '#3dffa0' : '#ff4d7a'; c.fillText(s, x, H / 2 + 2); x += c.measureText(s).width + 70; c.fillStyle = '#ffd23f'; c.fillText('◆', x - 45, H / 2); }
  });
}
function crownCoinTex() {
  return canvasTex(256, 256, (c, W, H) => {
    const gr = c.createRadialGradient(W * 0.4, H * 0.35, 10, W / 2, H / 2, W / 2); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#ffc230'); gr.addColorStop(1, '#b86a00');
    c.fillStyle = gr; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, 7); c.fill(); c.strokeStyle = '#8a4a00'; c.lineWidth = 10; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 22, 0, 7); c.stroke();
    c.fillStyle = '#8a4a00'; c.beginPath(); const cx = W / 2, cy = H / 2 + 8;
    c.moveTo(cx - 62, cy + 34); c.lineTo(cx - 70, cy - 30); c.lineTo(cx - 30, cy); c.lineTo(cx, cy - 52); c.lineTo(cx + 30, cy); c.lineTo(cx + 70, cy - 30); c.lineTo(cx + 62, cy + 34); c.closePath(); c.fill();
  });
}
function hoverCarPlaceholder() {
  const g = new THREE.Group();
  const body = std({ color: 0x2a1450, roughness: 0.3, metalness: 0.7 });
  put(g, new THREE.BoxGeometry(2.3, 0.34, 0.95), body, 0.1, -0.35, 0);
  put(g, new THREE.BoxGeometry(1.8, 0.24, 0.8), std({ color: 0x120a24, roughness: 0.15, metalness: 0.9 }), 0, -0.12, 0);
  put(g, new THREE.BoxGeometry(2.32, 0.03, 0.97), glow(0x22e6ff, 2.4), 0.1, -0.3, 0);
  return g;
}
function buildCity(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x1d0c40, 18, 85);
  g.add(skyDome(0x05030f, 0x28105a, 0x46125a));
  const roofMat = tileMat('cityroof', { glow: 0.05, m: { roughness: 0.72, metalness: 0.18, color: 0xb0aec4, envMapIntensity: 0.5 } });
  const facMat = tileMat('facade', { glow: 0.9, m: { roughness: 0.3, metalness: 0.55 } });
  const conc = std({ map: noiseTex('#34304a', ['#1a1828', '#4a4466', '#241f38'], 900), roughness: 0.85, metalness: 0.1 });
  const steel = std({ color: 0x2a2a3a, roughness: 0.35, metalness: 0.85 });
  const trimM = glow(0xff4fd8, 2.6), trimC = glow(0x22e6ff, 2.6), dark = std({ color: 0x0c0a16, roughness: 0.6, metalness: 0.6 });
  // main tower: roof deck + lit facade falling away into the city
  put(R, wbox(W, 0.3, 2.9, 2.2), [conc, conc, roofMat, conc, dark, conc], CX, -0.15, -0.25, { recv: true });
  put(R, wbox(W - 0.2, 40, 2.7, 2.6), [facMat, facMat, dark, dark, facMat, facMat], CX, -20.3, -0.3);
  put(R, new THREE.BoxGeometry(W + 0.02, 0.03, 0.04), glow(0xff4fd8, 1.8), CX, -0.02, 1.21);
  for (const s of [-1, 1]) put(R, new THREE.BoxGeometry(0.05, 40, 0.05), s < 0 ? trimM : trimC, CX + s * (W / 2 - 0.12), -20.3, 1.07);
  for (let y = -3.2; y > -30; y -= 3.1) put(R, new THREE.BoxGeometry(W - 0.18, 0.05, 0.02), glow(0x8a5aff, 1.1), CX, y, 1.06);
  // a parapet and coping along the FRONT edge as well: without one the deck is a bare slab face
  put(R, wbox(W, 0.2, 0.16, 0.8), conc, CX, 0.1, 1.12, { recv: true, cast: true });
  put(R, wbox(W + 0.06, 0.05, 0.26, 0.6), std({ color: 0x4a4660, roughness: 0.6, metalness: 0.3 }), CX, 0.22, 1.12, { cast: true });
  // roof relief: membrane seams, a drain, cable trays, standing water
  { const sm = [], jm = std({ color: 0x6a6684, roughness: 0.8 });
    for (let x = -3.6; x < 3.8; x += 1.05) sm.push([new THREE.BoxGeometry(0.035, 0.015, 2.6), x, 0.006, -0.3]);
    for (let z = -1.4; z < 1.0; z += 0.95) sm.push([new THREE.BoxGeometry(W - 0.1, 0.015, 0.035), CX, 0.006, z]);
    dfBatch(R, jm, sm, { cast: false }); }
  put(R, new THREE.CylinderGeometry(0.16, 0.16, 0.03, 14), std({ color: 0x3a3648, roughness: 0.7, metalness: 0.5 }), 1.25, 0.012, 0.55);
  { const tr = [];
    for (let x = -3.2; x < 3.4; x += 1.6) tr.push([new THREE.BoxGeometry(1.5, 0.07, 0.18), x, 0.05, -1.32]);
    dfBatch(R, std({ color: 0x3e3a52, roughness: 0.55, metalness: 0.6 }), tr); }
  { const pT = canvasTex(128, 64, (c, w2, h2) => { c.clearRect(0, 0, w2, h2); c.fillStyle = '#fff';
      for (let i = 0; i < 7; i++) { const cx2 = w2 * (0.15 + Math.random() * 0.7), cy2 = h2 * (0.3 + Math.random() * 0.4);
        const rx = w2 * (0.1 + Math.random() * 0.2), ry = h2 * (0.18 + Math.random() * 0.26);
        const gr = c.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.max(rx, ry));
        gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.62, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gr; c.save(); c.translate(cx2, cy2); c.scale(rx / ry, 1); c.beginPath(); c.arc(0, 0, ry, 0, 7); c.fill(); c.restore(); } });
    const pm = std({ color: 0x2a2840, roughness: 0.05, metalness: 0.5, envMapIntensity: 1.6, emissive: 0x6a3a9a, emissiveIntensity: 0.45, alphaMap: pT, transparent: true, depthWrite: false });
    for (const [x, z, w2, d2] of [[-2.4, 0.35, 2.6, 0.9], [1.6, -0.5, 2.2, 0.8], [3.4, 0.6, 1.6, 0.7]])
      put(R, new THREE.PlaneGeometry(w2, d2), pm, x, 0.014, z, { rx: -Math.PI / 2 }); }
  // back parapet + rooftop kit (all behind the fighters)
  put(R, wbox(W, 0.42, 0.22, 1), conc, CX, 0.21, -1.6, { recv: true });
  put(R, new THREE.BoxGeometry(W, 0.03, 0.06), trimC, CX, 0.435, -1.5);
  const fans = [];
  for (const x of [-2.75, 3.15]) {
    put(R, wbox(0.85, 0.5, 0.62, 0.6), std({ color: 0x4a4a5e, roughness: 0.5, metalness: 0.7, map: noiseTex('#5a5a70', ['#2a2a38', '#7a7a90'], 500) }), x, 0.25, -1.12, { cast: true });
    put(R, new THREE.CylinderGeometry(0.22, 0.22, 0.03, 24), dark, x, 0.515, -1.12);
    const fan = put(R, new THREE.BoxGeometry(0.4, 0.012, 0.06), steel, x, 0.535, -1.12); fans.push(fan);
    put(R, new THREE.BoxGeometry(0.7, 0.3, 0.012), std({ color: 0x0e0e14, roughness: 0.8, map: canvasTex(128, 64, (c, w, h) => { c.fillStyle = '#16161e'; c.fillRect(0, 0, w, h); c.fillStyle = '#05050a'; for (let i = 4; i < w; i += 8) c.fillRect(i, 4, 4, h - 8); }) }), x, 0.26, -0.805);
  }
  put(R, wbox(1.0, 1.15, 0.8, 1), conc, 2.05, 0.575, -1.3, { cast: true });
  put(R, new THREE.PlaneGeometry(0.44, 0.8), std({ color: 0x1a1824, roughness: 0.4, metalness: 0.8 }), 2.05, 0.4, -0.897); put(R, new THREE.PlaneGeometry(0.04, 0.7), glow(0xffb070, 1.6), 2.05, 0.4, -0.893);
  sprite(R, 0x3dffa0, 1.2, 0.35, 2.05, 0.95, -0.88);
  const beacons = [];
  const mast = (x, z, h, y0 = 0) => { put(R, new THREE.CylinderGeometry(0.03, 0.05, h, 8), steel, x, y0 + h / 2, z); for (let k = 1; k < 4; k++) put(R, new THREE.BoxGeometry(0.5 - k * 0.1, 0.02, 0.02), steel, x, y0 + h * k / 4, z); const b = put(R, new THREE.SphereGeometry(0.06, 12, 8), glow(0xff2a3a, 3), x, y0 + h, z); beacons.push(b); };
  mast(-3.45, -1.35, 4.2); mast(5.9, -3.0, 3.2, 0.75); mast(-6.1, -3.2, 3.6, 1.25);
  const dish = put(R, new THREE.SphereGeometry(0.34, 24, 8, 0, Math.PI * 2, 0, 0.75), std({ color: 0x8a8aa0, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide }), -1.9, 0.5, -1.3, { rx: 2.2, s: [1, 0.35, 1] });
  put(R, new THREE.CylinderGeometry(0.03, 0.05, 0.5, 8), steel, -1.9, 0.25, -1.35);
  // centre gantry (soft platform 2) with a live price ticker along its front edge
  const P2 = st.plats[2], gx = (P2.x0 + P2.x1) / 2 * SC, gw = (P2.x1 - P2.x0) * SC, gy = -P2.y * SC;
  for (const s of [-1, 1]) {
    put(R, new THREE.BoxGeometry(0.09, gy, 0.09), steel, gx + s * (gw / 2 - 0.07), gy / 2, -0.8, { cast: true });
    beam(R, steel, new THREE.Vector3(gx + s * (gw / 2 - 0.07), 0.2, -0.8), new THREE.Vector3(gx + s * (gw / 2 - 0.5), gy - 0.08, -0.8), 0.025);
  }
  const grate = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#24242e'; c.fillRect(0, 0, w, h); c.fillStyle = '#0a0a10'; for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 16) c.fillRect(x, y, 10, 10); });
  const grateM = std({ map: grate, roughness: 0.5, metalness: 0.8 });
  put(R, wbox(gw, 0.08, 1.38, 1), [steel, steel, grateM, steel, steel, steel], gx, gy - 0.04, -0.2, { cast: true, recv: true });
  const tick = tickerTex(); tick.wrapS = THREE.RepeatWrapping; tick.repeat.set(0.35, 1);
  put(R, new THREE.PlaneGeometry(gw, 0.075), new THREE.MeshBasicMaterial({ map: tick, color: new THREE.Color(1.6, 1.6, 1.6) }), gx, gy - 0.045, 0.495);
  put(R, new THREE.BoxGeometry(gw + 0.02, 0.018, 0.03), trimC, gx, gy - 0.004, 0.49);
  // left neighbour: taller tower, roof terrace cantilevered to the fight line, the coin billboard
  const nb = (P, top, bodyX0, bodyX1, trim, rot) => {
    const x0 = P.x0 * SC, x1 = P.x1 * SC, cx2 = (x0 + x1) / 2, bw2 = bodyX1 - bodyX0;
    const T = new THREE.Group(); T.position.set(cx2, 0, -1.5); T.rotation.y = rot; R.add(T);
    const c2 = Math.cos(rot);
    // body: cheap box for the part that falls away out of frame, a real holed face for the top
    put(T, wbox(bw2, 34, 2.8, 2.6), [facMat, facMat, dark, dark, facMat, facMat], (bodyX0 + bodyX1) / 2 - cx2, top - 0.15 - 17 - 7, -0.7);
    dfFace(T, { x: (bodyX0 + bodyX1) / 2 - cx2, y: top - 7.2, z: -0.7, w: bw2 - 0.3, h: 7.0, d: 2.8,
      cols: 4, rows: 5, px: 0.22, py: 0.3, mat: conc, trim: std({ color: 0x4a4660, roughness: 0.6 }),
      tile: 0.7, rev: 0.12, browD: 0.09, sillD: 0.07, litP: 0.6, litCol: 0xbfa8ff, litK: 2.2,
      ac: false, mull: false, brow: false, skyA: '#2a1f52', skyB: '#3a2470', skyC: '#150d2a' });
    // widened so the turn does not pull the walkable slab off the platform's world span
    const rw = (x1 - x0) / c2 + 0.5;
    put(T, wbox(rw, 0.15, 4.4, 2.2), [conc, conc, roofMat, conc, dark, conc], 0, top - 0.075, 0, { recv: true, cast: true });
    put(T, wbox(rw + 0.06, 0.2, 0.18, 0.8), conc, 0, top + 0.02, 2.12, { cast: true });
    put(T, new THREE.BoxGeometry(rw + 0.02, 0.035, 0.05), trim, 0, top + 0.13, 2.21);
    for (const x of [-rw / 2 + 0.2, rw / 2 - 0.2]) beam(T, steel, new THREE.Vector3(x, top - 1.1, 0.68), new THREE.Vector3(x, top - 0.16, 2.05), 0.035);
    dfBatch(T, steel, [[new THREE.CylinderGeometry(0.26, 0.22, 0.44, 10), rw * 0.22, top + 0.3, -0.6],
                       [new THREE.BoxGeometry(0.4, 0.3, 0.4), -rw * 0.26, top + 0.23, -0.2]]);
  };
  const P0 = st.plats[0], P1 = st.plats[1];
  nb(P0, -P0.y * SC, -6.55, -4.08, trimC, 0.17);
  nb(P1, -P1.y * SC, 4.25, 6.7, trimM, -0.15);
  const lt = -P0.y * SC;
  put(R, new THREE.BoxGeometry(2.3, 3.05, 0.12), dark, -5.25, lt + 1.75, -3.42);
  put(R, cardGeo(2.14, 2.86, CARD.coinboard), new THREE.MeshBasicMaterial({ map: sTex('stg_panels.jpg', 1, 1, true), color: new THREE.Color(1.25, 1.25, 1.25) }), -5.25, lt + 1.75, -3.35);
  for (const x of [-6.1, -4.4]) put(R, new THREE.BoxGeometry(0.08, 0.3, 0.08), steel, x, lt + 0.15, -3.42);
  const coinL = new THREE.PointLight(0xffb040, 7, 6, 1.8); coinL.position.set(-5.2, lt + 1.4, -2.4); R.add(coinL);
  const vs = neonSign('WAGMI', '#22e6ff'); vs.rotation.z = Math.PI / 2; vs.scale.setScalar(0.55); vs.position.set(-4.35, lt - 1.8, -0.76); R.add(vs);
  const vs2 = neonSign('HODL', '#ff4fd8'); vs2.rotation.z = -Math.PI / 2; vs2.scale.setScalar(0.5); vs2.position.set(4.55, -P1.y * SC - 1.6, -0.76); R.add(vs2);
  // right neighbour: water tank, live candle chart, a spinning hologram coin
  const rt = -P1.y * SC;
  const tank = new THREE.Group(); tank.position.set(6.2, rt, -2.75); R.add(tank);
  for (const [a, b] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) put(tank, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), steel, a, 0.4, b);
  put(tank, new THREE.CylinderGeometry(0.46, 0.46, 0.85, 24), std({ color: 0x3a3450, roughness: 0.4, metalness: 0.7 }), 0, 1.22, 0, { cast: true });
  put(tank, new THREE.ConeGeometry(0.5, 0.35, 24), std({ color: 0x2a2440, roughness: 0.4, metalness: 0.7 }), 0, 1.82, 0);
  put(tank, new THREE.TorusGeometry(0.465, 0.02, 6, 32), trimM, 0, 1.0, 0, { rx: Math.PI / 2 });
  const chart = candleTex();
  put(R, new THREE.BoxGeometry(2.0, 1.25, 0.1), dark, 4.95, rt + 1.05, -3.3);
  put(R, new THREE.PlaneGeometry(1.9, 1.15), new THREE.MeshBasicMaterial({ map: chart, color: new THREE.Color(1.3, 1.3, 1.3) }), 4.95, rt + 1.05, -3.24);
  for (const x of [4.2, 5.7]) put(R, new THREE.BoxGeometry(0.07, 0.45, 0.07), steel, x, rt + 0.22, -3.3);
  const chartL = new THREE.PointLight(0x3dffa0, 4, 5, 1.8); chartL.position.set(4.95, rt + 1.0, -2.4); R.add(chartL);
  const coin = new THREE.Group(); coin.position.set(4.95, rt + 2.55, -3.1); R.add(coin);
  const coinT = crownCoinTex();
  put(coin, new THREE.CylinderGeometry(0.42, 0.42, 0.07, 48), [std({ color: 0xffc230, metalness: 1, roughness: 0.25, emissive: 0x6a3a00, emissiveIntensity: 0.8 }), std({ map: coinT, metalness: 0.9, roughness: 0.3, emissive: 0xffffff, emissiveMap: coinT, emissiveIntensity: 0.5 }), std({ map: coinT, metalness: 0.9, roughness: 0.3, emissive: 0xffffff, emissiveMap: coinT, emissiveIntensity: 0.5 })], 0, 0, 0, { rx: Math.PI / 2 });
  sprite(coin, 0xffb030, 1.1, 1.8, 0, 0, -0.1);
  const beamC = put(R, new THREE.CylinderGeometry(0.12, 0.5, 1.4, 24, 1, true), glowA(0x22e6ff, 0.9, 0.18), 4.95, rt + 1.85 + 0.0, -3.1);
  // hover car (soft platform 3): generated model, placeholder until it loads
  const car = new THREE.Group(); R.add(car);
  const ph = hoverCarPlaceholder(); car.add(ph);
  const under = put(car, new THREE.PlaneGeometry(2.3, 1.1), glowA(0xff4fd8, 1.2, 0.55, halo()), 0, -0.62, 0, { rx: -Math.PI / 2 });
  const thr = [[-0.85, 0.35], [-0.85, -0.35], [0.95, 0.35], [0.95, -0.35]].map(([x, z]) => sprite(car, 0x22e6ff, 1.6, 0.55, x, -0.55, z));
  const carL = new THREE.PointLight(0xff4fd8, 6, 4.5, 1.6); carL.position.set(0, -0.8, 0.4); car.add(carL);
  loadGlb('stage_hovercar', scn => {
    if (!car.parent) return;
    const m = scn.clone(); const box = new THREE.Box3().setFromObject(m);
    // the flat roof runs from x = -0.43 to 0.92 of the 1.9 long model: scale it to the platform width
    const P3 = st.plats[3], s = (P3.x1 - P3.x0) * SC / 1.35;
    m.scale.setScalar(s); m.position.set(-0.245 * s, -box.max.y * s, 0); car.add(m); ph.visible = false;
  });
  // background towers (parallax in front of the plate) with beacons and signs
  const towers = [[-9.6, -6.5, 2.6, 7.5, 2.6], [-12.8, -9.5, 3, 11, 3], [-8.4, -13, 2.4, 9.5, 2.4], [-16.5, -14, 3.4, 14, 3], [9.5, -6.2, 2.8, 6.2, 2.6], [12.8, -9, 3, 12, 3], [8.6, -13.5, 2.4, 10.5, 2.4], [16.8, -13, 3.4, 15, 3]];
  const neonCols = ['#ff4fd8', '#22e6ff', '#ffd23f', '#8a5aff'], words = ['PUMP', 'GM', 'MOON', 'BULL', 'SEND', 'WAGMI', 'ATH', 'LFG'];
  towers.forEach(([x, z, w, h, d], i) => {
    put(R, wbox(w, h + 30, d, 2.6, i * 0.37), [facMat, facMat, dark, dark, facMat, facMat], x, (h - 30) / 2 - 0.2, z);
    put(R, new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.04), glow(neonCols[i % 4], 2.2), x, h - 0.2, z);
    const b = put(R, new THREE.SphereGeometry(0.08, 10, 8), glow(0xff2a3a, 3), x + w * 0.3, h + 0.6, z); beacons.push(b);
    put(R, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), steel, x + w * 0.3, h + 0.2, z);
    if (i % 2 === 0) { const s = neonSign(words[i], neonCols[(i + 1) % 4]); s.scale.setScalar(0.7 + (i % 3) * 0.15); s.position.set(x + (x < 0 ? 1 : -1) * 0.2, h - 1.6 - (i % 3), z + d / 2 + 0.05); R.add(s); }
  });
  // flying traffic lanes (visual only, wall clock)
  const traffic = [];
  const lanes = [{ z: -8.5, y: 4.3, v: 2.4, n: 3, L: 1.3 }, { z: -12.5, y: 6.1, v: -3.3, n: 3, L: 1.2 }, { z: -19, y: 3.3, v: 4.6, n: 4, L: 1.1 }, { z: -27, y: 7.6, v: -5.5, n: 4, L: 1.0 }];
  const trailT = canvasTex(256, 32, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); c.fillStyle = gr; c.fillRect(0, h * 0.3, w, h * 0.4); });
  for (const ln of lanes) for (let k = 0; k < ln.n; k++) {
    const v = new THREE.Group(), dir = Math.sign(ln.v); v.position.set(-30 + (60 / ln.n) * k + Math.random() * 4, ln.y + (Math.random() - 0.5) * 0.8, ln.z); R.add(v);
    const body = put(v, new THREE.CapsuleGeometry(0.16 * ln.L, ln.L * 0.9, 4, 10), std({ color: 0x1a1030, roughness: 0.3, metalness: 0.8 }), 0, 0, 0, { rz: Math.PI / 2 });
    sprite(v, 0xbfefff, 1.6, 0.5 * ln.L, dir * ln.L * 0.62, 0, 0); sprite(v, 0xff2a4a, 1.6, 0.4 * ln.L, -dir * ln.L * 0.62, 0, 0);
    const tr = put(v, new THREE.PlaneGeometry(ln.L * 2.6, 0.12 * ln.L), glowA(k % 2 ? 0xff4fd8 : 0x22e6ff, 1.2, 0.7, trailT), -dir * ln.L * 1.9, 0, 0); if (dir < 0) tr.rotation.z = Math.PI;
    if (ln.z > -15) loadGlb('stage_hovercar', scn => { if (!v.parent) return; const m = scn.clone(); m.scale.setScalar(ln.L / 1.9 * 1.25); if (dir > 0) m.rotation.y = Math.PI; v.add(m); body.visible = false; });
    traffic.push({ v, sp: ln.v });
    if (ln.z <= -15) v.visible = false;   // far lanes had no model, only black capsules that read as UI bars (9/22 night); the plate has traffic
  }
  // lights
  g.add(new THREE.HemisphereLight(0x8a70ff, 0x1a0830, 0.62));
  sunKey(g, 0xd8ccff, 1.75, [-5, 9, 7], { left: -10, right: 10, top: 7, bottom: -3, near: 1, far: 40 });
  const rimA = new THREE.DirectionalLight(0xff4fd8, 1.5); rimA.position.set(6, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0x22e6ff, 1.25); rimB.position.set(-6, 3, -6); g.add(rimB);
  g.userData.embers = null;
  let lastChart = 0, lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    const S = Game.stage, P = S && S.id === 'city' && S.plats[3];
    if (P) { const nx = (P.x0 + P.x1) / 2 * SC, vx = nx - car.position.x; car.position.set(nx, -P.y * SC, 0); car.rotation.z = Math.max(-0.02, Math.min(0.02, -vx * 0.4)); }
    const f = 0.75 + Math.sin(t * 23) * 0.12 + Math.sin(t * 7.1) * 0.1; for (const s of thr) s.material.opacity = f; under.material.opacity = 0.45 + Math.sin(t * 3) * 0.08; carL.intensity = 5 + Math.sin(t * 9) * 0.8;
    for (const fn of fans) fn.rotation.y = t * 9;
    beacons.forEach((b, i) => { b.visible = ((t + i * 0.37) % 1.6) < 0.55; });
    coin.rotation.y = t * 1.3; coin.position.y = rt + 2.55 + Math.sin(t * 1.7) * 0.06; beamC.material.opacity = 0.14 + Math.sin(t * 2.3) * 0.04;
    tick.offset.x = (t * 0.035) % 1;
    if (t - lastChart > 0.7) { lastChart = t; chart.userData.step(); }
    for (const c of traffic) { c.v.position.x += c.sp * dt; if (c.v.position.x > 32) c.v.position.x = -32; if (c.v.position.x < -32) c.v.position.x = 32; }
  };
  return g;
}

// ---------- Star Cruiser ----------
// lofted hull: open cross-section polyline (x, y) swept through z stations, world-unit UVs
function loft(sec, stations, tile) {
  const n = sec.length, pos = [], uv = [], idx = [], per = [0];
  for (let i = 1; i < n; i++) per.push(per[i - 1] + Math.hypot(sec[i][0] - sec[i - 1][0], sec[i][1] - sec[i - 1][1]));
  for (const S of stations) for (let i = 0; i < n; i++) { pos.push(sec[i][0] * S.sx, sec[i][1] * S.sy, S.z); uv.push(per[i] / tile, S.z / tile); }
  for (let s = 0; s < stations.length - 1; s++) for (let i = 0; i < n - 1; i++) { const a = s * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function hazardTex() {
  return canvasTex(256, 64, (c, w, h) => { c.fillStyle = '#e8b400'; c.fillRect(0, 0, w, h); c.fillStyle = '#141414'; for (let x = -h; x < w + h; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 24, 0); c.lineTo(x + 24 - h, h); c.lineTo(x - h, h); c.closePath(); c.fill(); } c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 300; i++) c.fillRect(Math.random() * w, Math.random() * h, 2, 2); });
}
function turret(parent, mat, dark, x, z, s, ry) {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); t.rotation.y = ry || 0; parent.add(t);
  put(t, new THREE.CylinderGeometry(0.95, 1.05, 0.28, 32), mat, 0, 0.14, 0);
  const head = new THREE.Group(); head.position.y = 0.28; t.add(head);
  put(head, wbox(1.5, 0.75, 1.9, 1.2), mat, 0, 0.37, 0, { cast: true });
  put(head, new THREE.BoxGeometry(1.52, 0.06, 1.92), dark, 0, 0.76, 0);
  for (const dz of [-0.28, 0.28]) put(head, new THREE.CylinderGeometry(0.07, 0.09, 2.6, 12), mat, -1.9, 0.5, dz, { rz: Math.PI / 2 - 0.25 });
  return head;
}
function buildShip(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, hw = (M.x1 - M.x0) * SC / 2, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x0a0620, 30, 120);
  g.add(skyDome(0x02010a, 0x140a36, 0x2a0a40));
  const hullMat = tileMat('hull', { glow: 0.35, m: { roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide } });
  const deckMat = tileMat('shipdeck', { glow: 0.12, m: { roughness: 0.4, metalness: 0.65 } });
  const hullSolid = tileMat('hull', { glow: 0.3, m: { roughness: 0.45, metalness: 0.7 } });
  const darkM = std({ color: 0x14161e, roughness: 0.5, metalness: 0.8 });
  const zS = 1.3, zMid = -22, zP = -34, zTip = -42;
  // deck plan: full beam to zMid, then the prow tapers to a point
  const plan = new THREE.Shape(); const pts = [[-hw, -zS], [hw, -zS], [hw, -zMid], [hw * 0.55, -zP], [hw * 0.12, -zTip], [-hw * 0.12, -zTip], [-hw * 0.55, -zP], [-hw, -zMid]];
  pts.forEach(([x, s], i) => i ? plan.lineTo(CX + x, s) : plan.moveTo(CX + x, s));
  const deckG = new THREE.ExtrudeGeometry(plan, { depth: 0.3, bevelEnabled: false });
  scaleUV(deckG, 1 / 2.4);
  const deck = put(R, deckG, [deckMat, hullSolid], 0, -0.3, 0, { rx: -Math.PI / 2, recv: true });
  // hull below the deck: a V section lofted to the prow
  const sec = [[hw, -0.25], [hw - 0.2, -1.3], [hw - 1.1, -2.9], [hw - 2.9, -4.2], [0, -4.7], [-hw + 2.9, -4.2], [-hw + 1.1, -2.9], [-hw + 0.2, -1.3], [-hw, -0.25]].map(([x, y]) => [x + CX, y]);
  put(R, loft(sec, [{ z: zS, sx: 1, sy: 1 }, { z: zMid, sx: 1, sy: 1 }, { z: zP, sx: 0.55, sy: 0.75 }, { z: zTip, sx: 0.12, sy: 0.4 }], 2.6), hullMat, 0, 0, 0);
  // stern face with the engines
  const sh = new THREE.Shape(); sec.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y)); sh.lineTo(sec[0][0], sec[0][1]);
  const stern = put(R, scaleUV(new THREE.ShapeGeometry(sh), 1 / 2.6), hullSolid, 0, 0, zS + 0.001);
  put(R, new THREE.BoxGeometry(hw * 2 + 0.02, 0.025, 0.04), glow(0x22e6ff, 1.5), CX, -0.02, zS + 0.02);
  const engines = [];
  const plumeT = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  for (const [x, y, r] of [[-3.0, -0.95, 0.55], [3.0, -0.95, 0.55], [-1.2, -1.25, 0.7], [1.2, -1.25, 0.7]]) {
    put(R, new THREE.CylinderGeometry(r * 0.92, r * 1.12, 0.8, 32, 1, true), std({ color: 0x3a3e4a, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide }), CX + x, y, zS + 0.4, { rx: Math.PI / 2 });
    put(R, new THREE.TorusGeometry(r * 1.1, 0.06, 8, 32), darkM, CX + x, y, zS + 0.8);
    put(R, new THREE.CircleGeometry(r * 0.9, 32), glow(0x7ac8ff, 1.15), CX + x, y, zS + 0.25);
    const hs = sprite(R, 0x4aa8ff, 0.5, r * 3.0, CX + x, y, zS + 1.0);
    const pl = put(R, new THREE.ConeGeometry(r * 0.85, 2.2, 24, 1, true), glowA(0x6ab8ff, 1.0, 0.18, plumeT), CX + x, y, zS + 1.9, { rx: Math.PI / 2 });
    engines.push({ hs, pl, r });
  }
  for (const s of [-1, 1]) { const l = new THREE.PointLight(0x5ab8ff, 6, 6, 1.8); l.position.set(CX + s * 2, -1.6, zS + 2.0); R.add(l); }
  // deck dressing: hazard edges, runway dashes, chasing edge lights
  const hz = hazardTex(); hz.wrapS = hz.wrapT = THREE.RepeatWrapping; hz.repeat.set((zS - zMid) / 1.2, 1);
  for (const s of [-1, 1]) { const m = put(R, new THREE.PlaneGeometry(zS - zMid, 0.32), std({ map: hz, roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }), CX + s * (hw - 0.22), 0.002, (zS + zMid) / 2, { rx: -Math.PI / 2, recv: true }); m.rotation.z = Math.PI / 2; }
  const dashM = glow(0x22e6ff, 2.2);
  for (let z = -1.2; z > zP; z -= 2.2) put(R, new THREE.PlaneGeometry(0.1, 0.9), dashM, CX, 0.004, z, { rx: -Math.PI / 2 });
  const lights = [], lightGeo = new THREE.SphereGeometry(0.055, 10, 8);
  const edgeL = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 64); R.add(edgeL);
  let li = 0; const mtx = new THREE.Matrix4(), col = new THREE.Color();
  for (let z = zS - 0.25; z > zMid - 8 && li < 64; z -= 1.3) for (const s of [-1, 1]) { if (li >= 64) break; const w = z < zMid ? hw - (zMid - z) / (zMid - zP) * hw * 0.45 : hw; mtx.makeTranslation(CX + s * (w - 0.05), 0.04, z); edgeL.setMatrixAt(li, mtx); lights.push(z); li++; }
  edgeL.count = li; for (let i = 0; i < li; i++) edgeL.setColorAt(i, col.setRGB(0.3, 0.9, 2.2));
  // left gun turret (soft platform 0): body behind the fight line, armoured top plate reaching over it
  const P0 = st.plats[0], t0x = (P0.x0 + P0.x1) / 2 * SC, t0w = (P0.x1 - P0.x0) * SC, t0y = -P0.y * SC;
  put(R, new THREE.CylinderGeometry(1.0, 1.1, 0.3, 36), hullSolid, t0x, 0.15, -1.75, { cast: true });
  put(R, wbox(t0w - 0.1, t0y - 0.4, 2.2, 1.2), hullSolid, t0x, 0.3 + (t0y - 0.4) / 2, -1.65, { cast: true });
  put(R, wbox(t0w, 0.1, 3.2, 2.4), [hullSolid, hullSolid, deckMat, hullSolid, darkM, hullSolid], t0x, t0y - 0.05, -1.2, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(t0w - 0.1, 0.06, 0.95), hullSolid, t0x, t0y - 0.28, -0.1, { rx: -0.32 });
  put(R, new THREE.BoxGeometry(t0w + 0.02, 0.025, 0.04), glow(0x22e6ff, 2.4), t0x, t0y - 0.01, 0.41);
  for (const dz of [-1.35, -1.95]) put(R, new THREE.CylinderGeometry(0.075, 0.1, 3.2, 14), hullSolid, t0x - 2.0, t0y - 0.62 + 0.45, dz, { rz: Math.PI / 2 - 0.28, cast: true });
  // bridge island (soft platforms 1 and 2) on the starboard side, antenna mast + radar on top
  const P1 = st.plats[1], bx = (P1.x0 + P1.x1) / 2 * SC, bw = (P1.x1 - P1.x0) * SC, by = -P1.y * SC, rx = bx + 0.1, rw = 1.2, ry = 2.85;   // the bridge top is scenery, not a platform
  // island blocks with raked armour fronts (profile in z/y, extruded across x)
  const block = (pts, x0, x1, mat) => { const sh = new THREE.Shape(); pts.forEach(([z, y], i) => i ? sh.lineTo(z, y) : sh.moveTo(z, y)); const gm = scaleUV(new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false }), 1 / 1.3); const m = put(R, gm, mat, x1, 0, 0, { ry: -Math.PI / 2, cast: true }); return m; };
  block([[-0.62, 0], [-3.6, 0], [-3.6, by - 0.1], [-1.05, by - 0.1], [-0.62, by * 0.5]], bx - bw / 2 - 0.15, bx + bw / 2 + 0.15, hullSolid);
  const winM = glow(0xffb060, 1.6), winC = glow(0x7ad8ff, 1.8);
  for (const k of [0.45]) { const y = by * 0.5 + (by - 0.1 - by * 0.5) * k, z = -0.62 - (1.05 - 0.62) * k; put(R, new THREE.BoxGeometry(bw - 0.3, 0.02, 0.02), winC, bx, y, z + 0.012, { rx: -0.75 }); }
  put(R, new THREE.BoxGeometry(bw - 0.3, 0.02, 0.02), glow(0xffb060, 1.1), bx, by * 0.25, -0.6);
  put(R, wbox(bw, 0.1, 1.6, 1.2), [hullSolid, hullSolid, deckMat, hullSolid, darkM, hullSolid], bx, by - 0.05, -0.3, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(bw + 0.02, 0.025, 0.04), glow(0x22e6ff, 2.0), bx, by - 0.01, 0.51);
  block([[-1.0, by], [-3.4, by], [-3.4, ry - 0.1], [-1.25, ry - 0.1], [-0.82, ry - 0.62]], rx - rw / 2 - 0.2, rx + rw / 2 + 0.2, hullSolid);
  const winT = canvasTex(512, 64, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#a8f4ff'); gr.addColorStop(1, '#1a6a9a'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = '#081018'; for (let x = 0; x < w; x += 42) c.fillRect(x, 0, 6, h); c.fillRect(0, 0, w, 5); c.fillRect(0, h - 5, w, 5); });
  { const ang = Math.atan2(0.52, 0.43), len = Math.hypot(0.52, 0.43); put(R, new THREE.PlaneGeometry(rw + 0.34, len * 0.8), new THREE.MeshBasicMaterial({ map: winT, color: new THREE.Color(1.4, 1.4, 1.4) }), rx, ry - 0.36, -1.03, { rx: -(Math.PI / 2 - ang) }); }
  for (const s2 of [-1, 1]) { put(R, new THREE.BoxGeometry(0.12, 0.5, 0.3), darkM, rx + s2 * (rw / 2 + 0.26), by + 0.4, -1.6); sprite(R, s2 < 0 ? 0xff3040 : 0x40ff90, 1.6, 0.25, rx + s2 * (rw / 2 + 0.3), by + 0.7, -1.45); }
  put(R, new THREE.ConeGeometry(rw * 0.85, 0.45, 4, 1), hullSolid, rx, ry + 0.18, -1.7, { ry: Math.PI / 4, s: [1, 1, 1.9], cast: true });
  put(R, new THREE.BoxGeometry(rw + 0.3, 0.06, 2.6), darkM, rx, ry - 0.03, -1.7);
  const bl = new THREE.PointLight(0x40e0ff, 4, 4, 1.8); bl.position.set(rx, ry - 0.4, 0.2); R.add(bl);
  const mastH = 3.2; put(R, new THREE.CylinderGeometry(0.05, 0.08, mastH, 10), darkM, rx, ry + mastH / 2, -2.6);
  for (let k = 1; k < 4; k++) put(R, new THREE.BoxGeometry(0.9 - k * 0.18, 0.03, 0.03), darkM, rx, ry + mastH * k / 4, -2.6);
  const radar = put(R, new THREE.BoxGeometry(1.3, 0.2, 0.05), std({ color: 0x8a90a8, roughness: 0.4, metalness: 0.8 }), rx, ry + mastH * 0.62, -2.6);
  const beacon = put(R, new THREE.SphereGeometry(0.07, 12, 8), glow(0xff2a3a, 3), rx, ry + mastH + 0.05, -2.6);
  // lower gun decks along the hull (soft platforms 3 and 4): the catch for a missed recovery
  for (const P of st.plats.slice(2)) {
    const x0 = P.x0 * SC, x1 = P.x1 * SC, w = x1 - x0, cx2 = (x0 + x1) / 2, y = -P.y * SC, out = Math.sign(cx2);
    put(R, wbox(w, 0.12, 2.0, 2.4), [hullSolid, hullSolid, deckMat, hullSolid, darkM, hullSolid], cx2, y - 0.06, -0.45, { cast: true, recv: true });
    put(R, new THREE.BoxGeometry(w, 0.03, 0.04), glow(0x22e6ff, 1.8), cx2, y - 0.01, 0.53);
    // brackets back to the hull, a rail along the outer edge and a light AA mount at the back
    for (const dz of [-1.3, -0.4, 0.45]) beam(R, hullSolid, new THREE.Vector3(cx2 + out * w * 0.45, y - 0.08, dz), new THREE.Vector3(out * hw * 0.99, y + 1.45, dz), 0.055, 8);
    put(R, wbox(w * 0.5, 0.5, 1.9, 1.2), hullSolid, cx2 - out * w * 0.26, y - 0.32, -0.45);
    for (let k = 0; k <= 4; k++) put(R, new THREE.BoxGeometry(0.05, 0.34, 0.05), darkM, x0 + 0.1 + k * (w - 0.2) / 4, y + 0.17, -1.4);
    put(R, new THREE.BoxGeometry(w, 0.05, 0.05), darkM, cx2, y + 0.34, -1.4);
    put(R, new THREE.BoxGeometry(0.05, 0.4, 2.0), darkM, cx2 + out * w / 2, y + 0.2, -0.45);
    const aa = new THREE.Group(); aa.position.set(cx2 + out * w * 0.3, y, -1.1); R.add(aa);
    put(aa, new THREE.CylinderGeometry(0.28, 0.32, 0.18, 16), hullSolid, 0, 0.09, 0);
    put(aa, wbox(0.45, 0.3, 0.5, 0.8), hullSolid, 0, 0.32, 0, { cast: true });
    for (const dz of [-0.1, 0.1]) put(aa, new THREE.CylinderGeometry(0.035, 0.045, 1.2, 10), hullSolid, out * 0.5, 0.5, dz, { rz: Math.PI / 2 - out * 0.35 });
    for (let k = 0; k < 3; k++) sprite(R, 0x22e6ff, 1.2, 0.3, x0 + 0.25 + k * (w - 0.5) / 2, y + 0.05, 0.5);
  }
  // more turrets and a radar dome down the deck
  const heads = [turret(R, hullSolid, darkM, CX - 2.3, -8.5, 1, 0.3), turret(R, hullSolid, darkM, CX + 2.4, -14, 1, -0.4), turret(R, hullSolid, darkM, CX, -20.5, 1.1, 0)];
  put(R, new THREE.SphereGeometry(1.1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0xb8bccb, roughness: 0.35, metalness: 0.5 }), CX - 3.0, 0, -17);
  // escorts flying alongside
  const escorts = [];
  for (const [x, y, z, s] of [[-24, 4, -48, 1.4], [27, -3, -62, 1.8]]) {
    const e = new THREE.Group(); e.position.set(x, y, z); e.scale.setScalar(s); R.add(e);
    put(e, wbox(1.4, 0.5, 6, 2.6), hullSolid, 0, 0, 0); put(e, new THREE.ConeGeometry(0.55, 2.2, 4), hullSolid, 0, 0, -4.1, { rx: -Math.PI / 2, ry: Math.PI / 4 }); put(e, wbox(0.6, 0.6, 1.4, 1.3), hullSolid, 0, 0.5, 0.8);
    sprite(e, 0x4aa8ff, 1.5, 1.6, -0.35, 0, 3.1); sprite(e, 0x4aa8ff, 1.5, 1.6, 0.35, 0, 3.1);
    escorts.push({ e, y, ph: Math.random() * 6 });
  }
  // star streaks, asteroids and far-off laser fire (visual only, wall clock)
  const NS = 360, sPos = new Float32Array(NS * 6), sCol = new Float32Array(NS * 6), stars = [];
  for (let i = 0; i < NS; i++) { const a = Math.random() * 6.283, r = 9 + Math.pow(Math.random(), 0.7) * 60; stars.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 + 2, z: -200 + Math.random() * 210, v: 40 + Math.random() * 60, L: 1 + Math.random() * 4, b: 0.4 + Math.random() * 0.8 }); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); streaks.frustumCulled = false; R.add(streaks);
  const rockM = std({ map: sTex('tex_basalt.jpg'), color: 0xb8a8d8, roughness: 0.9, flatShading: true, fog: false, emissive: 0x2a1c44, emissiveIntensity: 0.6 });
  const rocks = [];
  for (let i = 0; i < 14; i++) { const r = 0.6 + Math.random() * 2.2, m = put(R, rockGeo(r, 1, 0.35, i * 7), rockM, 0, 0, 0); const a = Math.random() * 6.283, d = 14 + Math.random() * 24; m.position.set(Math.cos(a) * d, Math.sin(a) * d * 0.55 + 1, -160 + Math.random() * 170); rocks.push({ m, a, d, v: 14 + Math.random() * 14, sx: Math.random() - 0.5, sy: Math.random() - 0.5 }); }
  const bolts = [], flashes = [];
  for (let i = 0; i < 6; i++) { const b = put(R, new THREE.CylinderGeometry(0.06, 0.06, 5, 6), glowA(i % 2 ? 0xff3050 : 0x40ff90, 3, 0.9), 0, -100, 0); b.visible = false; bolts.push({ b, t: 0, live: 0 }); }
  for (let i = 0; i < 3; i++) { const f = sprite(R, 0xffb060, 2, 4, 0, -100, 0); f.visible = false; flashes.push({ f, t: 0 }); }
  // lights
  g.add(new THREE.HemisphereLight(0x8090ff, 0x100818, 0.55));
  sunKey(g, 0xe2e8ff, 2.1, [7, 9, 6], { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  const rimA = new THREE.DirectionalLight(0xff4fd8, 1.3); rimA.position.set(-7, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0x40c8ff, 1.0); rimB.position.set(6, 2, -8); g.add(rimB);
  g.userData.embers = null;
  let lastT = 0, nextBolt = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (const e of engines) { const f = 1 + Math.sin(t * 31 + e.r * 9) * 0.06 + (Math.random() - 0.5) * 0.08; e.pl.scale.set(1, f, 1); e.pl.material.opacity = 0.15 + Math.random() * 0.05; e.hs.material.opacity = 0.75 + Math.sin(t * 17 + e.r) * 0.1; }
    for (let i = 0; i < edgeL.count; i++) { const k = ((lights[i] * 0.4 + t * 3.2) % 3 + 3) % 3; col.setRGB(0.3, 0.9, 2.2).multiplyScalar(k < 0.5 ? 1.6 : 0.35); edgeL.setColorAt(i, col); }
    if (edgeL.instanceColor) edgeL.instanceColor.needsUpdate = true;
    radar.rotation.y = t * 1.8; beacon.visible = (t % 1.4) < 0.5;
    heads.forEach((h, i) => { h.rotation.y = Math.sin(t * 0.25 + i * 2) * 0.6; });
    for (const e of escorts) e.e.position.y = e.y + Math.sin(t * 0.6 + e.ph) * 0.4;
    for (let i = 0; i < NS; i++) {
      const s = stars[i]; s.z += s.v * dt; if (s.z > 16) { s.z = -200; }
      const o = i * 6, k = Math.min(1, (s.z + 200) / 60) * s.b;
      sPos[o] = s.x; sPos[o + 1] = s.y; sPos[o + 2] = s.z; sPos[o + 3] = s.x; sPos[o + 4] = s.y; sPos[o + 5] = s.z - s.L * (1 + s.v / 40);
      sCol[o] = 0.75 * k; sCol[o + 1] = 0.85 * k; sCol[o + 2] = 1.2 * k; sCol[o + 3] = 0; sCol[o + 4] = 0; sCol[o + 5] = 0;
    }
    sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true;
    for (const r of rocks) { r.m.position.z += r.v * dt; r.m.rotation.x += r.sx * dt; r.m.rotation.y += r.sy * dt; if (r.m.position.z > 20) { r.m.position.z = -170; r.a = Math.random() * 6.283; r.d = 14 + Math.random() * 24; r.m.position.x = Math.cos(r.a) * r.d; r.m.position.y = Math.sin(r.a) * r.d * 0.55 + 1; } }
    if (t > nextBolt) {
      nextBolt = t + 0.5 + Math.random() * 1.4;
      const b = bolts.find(q => !q.live); if (b) { b.live = 1; b.t = 0; b.b.visible = true; b.x = (Math.random() - 0.5) * 70; b.y = 6 + Math.random() * 14; b.z = -60 - Math.random() * 40; b.vx = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 30); b.b.rotation.z = Math.PI / 2; b.b.position.set(b.x, b.y, b.z); }
      if (Math.random() < 0.45) { const f = flashes.find(q => q.t <= 0); if (f) { f.t = 1; f.f.visible = true; f.f.position.set((Math.random() - 0.5) * 80, 4 + Math.random() * 16, -70 - Math.random() * 30); } }
    }
    for (const b of bolts) if (b.live) { b.t += dt; b.b.position.x += b.vx * dt; if (b.t > 1.6) { b.live = 0; b.b.visible = false; } }
    for (const f of flashes) if (f.t > 0) { f.t -= dt * 1.6; const k = Math.max(0, f.t); f.f.scale.setScalar(2 + (1 - k) * 5); f.f.material.opacity = k; if (f.t <= 0) f.f.visible = false; }
  };
  return g;
}

// ---------- Brawl Street ----------
function lowriderTex() {
  // three car cards cut out of stg_cards.png: the lowrider, a muscle car, and a repainted lowrider
  const rects = [[0, 0, 1536, 417], [0, 425, 1536, 462], [0, 0, 1536, 417]], shifts = [0, 0, 150];
  // The canvases are sized to their final rect UP FRONT, empty. A canvas that is resized after its
  // texture has been uploaded can never grow on the GPU (three allocates with the immutable
  // texStorage2D -- see V3.swapImage in 90_v3_core), so the card would stay at the 300x150 default
  // forever. Empty is also the right placeholder here: these are alphaTest cut-outs, so a fully
  // transparent card is invisible until the png lands rather than a grey slab.
  const out = rects.map(([, , rw, rh]) => { const cv = document.createElement('canvas'); cv.width = rw; cv.height = rh; const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QUAL.aniso; t.userData.cv = cv; return t; });
  const im = new Image();
  im.onload = () => out.forEach((t, k) => {
    const [rx, ry, rw, rh] = rects[k], cv = t.userData.cv;
    const c = cv.getContext('2d'); c.drawImage(im, rx, ry, rw, rh, 0, 0, rw, rh);
    if (shifts[k]) {
      const d = c.getImageData(0, 0, rw, rh), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dd = mx - mn;
        if (dd < 0.1) continue;
        let h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60; if (h < 0) h += 360;
        if (h < 245 || h > 335) continue;
        h = (h + shifts[k]) % 360; const sat = dd / (1 - Math.abs(2 * l - 1)), C = (1 - Math.abs(2 * l - 1)) * sat, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2;
        const [R1, G1, B1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
        p[i] = (R1 + m) * 255; p[i + 1] = (G1 + m) * 255; p[i + 2] = (B1 + m) * 255;
      }
      c.putImageData(d, 0, 0);
    }
    t.needsUpdate = true;
  });
  im.src = ASSET + 'stg_cards.png';
  return out;
}
function signTex(lines, bg, fg, glowC, w = 1024, h = 512) {
  return canvasTex(w, h, (c, W, H) => {
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    lines.forEach(([txt, size, y, col]) => { c.font = `bold ${size}px Bungee, Impact, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = glowC || col || fg; c.shadowBlur = glowC ? 26 : 0; c.fillStyle = col || fg; c.fillText(txt, W / 2, y * H); });
  });
}
function billboardTex() {
  return canvasTex(1024, 512, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3a1a6a'); gr.addColorStop(0.45, '#ff5a8a'); gr.addColorStop(0.75, '#ffb14a'); gr.addColorStop(1, '#ffe08a'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff2b0'; c.beginPath(); c.arc(W * 0.72, H * 0.72, 120, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,120,80,.6)'; for (let y = H * 0.66; y < H * 0.86; y += 16) c.fillRect(W * 0.72 - 130, y, 260, 6);
    c.fillStyle = '#1a0a24';
    const palmS = (x, y, s) => { c.save(); c.translate(x, y); c.scale(s, s); c.fillRect(-5, -260, 10, 260); for (let k = 0; k < 9; k++) { c.save(); c.translate(0, -260); c.rotate(-1.4 + k * 0.35); c.beginPath(); c.ellipse(60, 0, 62, 10, 0.25, 0, 7); c.fill(); c.restore(); } c.restore(); };
    palmS(W * 0.52, H, 1.4); palmS(W * 0.9, H, 1.1); palmS(W * 0.97, H, 0.8);
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = 'italic 900 118px Bungee, Impact, sans-serif'; c.lineWidth = 14; c.strokeStyle = '#1a0a24'; c.strokeText('STAY', 50, 150); c.strokeText('GOLDEN', 50, 280);
    c.fillStyle = '#ffe27a'; c.fillText('STAY', 50, 150); c.fillText('GOLDEN', 50, 280);
    c.font = 'bold 38px Bungee, Impact, sans-serif'; c.fillStyle = '#fff'; c.fillText('CRUISE NIGHT  •  EVERY SATURDAY', 54, 390);
  });
}
function fenceTex() {
  const t = canvasTex(256, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(190,190,200,.95)'; c.lineWidth = 3; for (let i = -w; i < w * 2; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function courtTex() {
  return canvasTex(1024, 512, (c, W, H) => {
    c.fillStyle = '#b8483a'; c.fillRect(0, 0, W, H); c.fillStyle = '#2f7a5a'; c.fillRect(40, 40, W - 80, H - 80);
    for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
    c.strokeStyle = '#f4f0e0'; c.lineWidth = 8; c.strokeRect(40, 40, W - 80, H - 80); c.beginPath(); c.moveTo(W / 2, 40); c.lineTo(W / 2, H - 40); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 70, 0, 7); c.stroke(); c.strokeRect(40, H / 2 - 90, 190, 180); c.strokeRect(W - 230, H / 2 - 90, 190, 180);
    c.beginPath(); c.arc(40, H / 2, 230, -1.3, 1.3); c.stroke(); c.beginPath(); c.arc(W - 40, H / 2, 230, Math.PI - 1.3, Math.PI + 1.3); c.stroke();
  });
}
function buildStreet(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC, x0 = M.x0 * SC, x1 = M.x1 * SC;
  scene.fog = new THREE.Fog(0xf0a07a, 20, 75);
  g.add(skyDome(0x5a4aa8, 0xff9a7a, 0xffd0a0));
  const zF = 1.6, zB = -6.6, D = zF - zB;
  const asph = tileMat('asphalt', { m: { roughness: 0.52, metalness: 0.12, envMapIntensity: 0.8 } });
  const walk = tileMat('sidewalk', { m: { roughness: 0.82 } });
  const cut = tileMat('streetcut', { m: { roughness: 0.9 } });
  const concM = std({ map: noiseTex('#c9b8a4', ['#8a7a6a', '#e6d6c0', '#a89684'], 1200), roughness: 0.9 });
  const brick = tileMat('graffiti', { m: { roughness: 0.92 } });   // atlas cell now holds photoreal brick
  const wallArt = sTex('stg_wall.jpg', 1, 1, true), shopT = sTex('stg_shop.jpg', 1, 1, true);
  const dirt = std({ map: stageTex('cliff', 1, 1), color: 0xb89a80, roughness: 0.95, flatShading: true });
  // the block: street strip in front, curb, sidewalk, then the lot; sliced edges show the street's insides
  put(R, wbox(W, 0.2, D, 2.4), [cut, cut, asph, dirt, cut, cut], CX, -0.1, (zF + zB) / 2, { recv: true });
  // cross-section faces: stretch the section texture over the front and sides
  const secG = (w, h) => { const gm = new THREE.PlaneGeometry(w, h); gm.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 === 0 ? v * w / 2.6 : 0.004 + v * 0.992; }); return gm; };
  put(R, secG(W, 1.5), cut, CX, -0.75, zF + 0.002);
  for (const s of [-1, 1]) put(R, secG(D, 1.5), cut, CX + s * (W / 2 + 0.002), -0.75, (zF + zB) / 2, { ry: s * Math.PI / 2 });
  rubble(R, dirt, x0 + 0.4, x1 - 0.4, -1.45, (zF + zB) / 2, D * 0.9, 11);
  for (const [x, z] of [[-2.2, 1.0], [1.7, 0.9], [3.6, -3.5]]) put(R, new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8), std({ color: 0x5a4a3a, roughness: 0.9 }), x, -2.0, z, { rz: 0.1 });
  // road markings, curb, sidewalk
  const yl = glow(0xffc83a, 0.95);
  for (const dz of [0.74, 0.86]) put(R, new THREE.PlaneGeometry(W - 0.2, 0.05), yl, CX, 0.003, dz, { rx: -Math.PI / 2 });
  put(R, wbox(W, 0.06, 0.12, 1), [concM, concM, concM, concM, std({ color: 0xc8202a, roughness: 0.7 }), concM], CX, 0.01, -0.36);
  put(R, wbox(W, 0.05, 0.95, 1.4), [concM, concM, walk, concM, concM, concM], CX, 0.005, -0.9, { recv: true });
  put(R, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 28), std({ color: 0x2a2826, roughness: 0.6, metalness: 0.6, map: canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#3a3634'; c.fillRect(0, 0, w, h); c.strokeStyle = '#1a1816'; c.lineWidth = 5; for (let i = 12; i < 64; i += 14) { c.beginPath(); c.arc(64, 64, i, 0, 7); c.stroke(); } }) }), 1.0, 0.004, 1.15, { recv: true });
  // corner market (soft platform 0 is its roof, platform 1 the sign on top)
  const P0 = st.plats[0], P1 = st.plats[1], P2 = st.plats[2];
  const sx0 = P0.x0 * SC, sx1 = P0.x1 * SC, rY = -P0.y * SC, sw = sx1 - sx0, scx = (sx0 + sx1) / 2;
  const stucco = std({ map: noiseTex('#e0a882', ['#c88a68', '#f0c0a0', '#b87a5a'], 1500), roughness: 0.9 });
  put(R, wbox(sw, rY - 0.12, 3.3, 1.5), stucco, scx, (rY - 0.12) / 2, -2.35, { cast: true, recv: true });
  const facH = rY - 0.14, facW = Math.min(sw - 0.12, facH * 1.507), facX = sx0 + 0.06 + facW / 2;
  put(R, new THREE.PlaneGeometry(facW, facH), std({ map: shopT, roughness: 0.78, emissive: 0xffffff, emissiveMap: shopT, emissiveIntensity: 0.1 }), facX, facH / 2, -0.695);
  // brick return between the shop front and the wall, with a meter box and a pipe
  const retW = sx1 - (facX + facW / 2);
  if (retW > 0.05) {
    put(R, wbox(retW, facH, 0.06, 1.1), brick, sx1 - retW / 2, facH / 2, -0.7);
    put(R, new THREE.CylinderGeometry(0.045, 0.045, facH, 10), std({ color: 0x6a6258, roughness: 0.65, metalness: 0.45 }), sx1 - retW * 0.35, facH / 2, -0.63, { cast: true });
    put(R, new THREE.BoxGeometry(0.22, 0.3, 0.12), std({ color: 0x8a8a84, roughness: 0.6, metalness: 0.5 }), sx1 - retW * 0.75, facH * 0.55, -0.64);
  }
  // the neon sign only: a small emissive card plus its spill light
  put(R, new THREE.PlaneGeometry(facW * 0.24, facH * 0.085), glowA(0xff2a3a, 1.5, 0.75), facX - facW * 0.09, facH * 0.665, -0.688);
  const neonL = new THREE.PointLight(0xff3a44, 2.6, 3.2, 1.8); neonL.position.set(facX - facW * 0.09, facH * 0.66, -0.35); R.add(neonL);
  const winL = new THREE.PointLight(0xffd8a0, 2.2, 3.0, 1.8); winL.position.set(facX + facW * 0.02, facH * 0.42, -0.3); R.add(winL);
  const roofTop = std({ map: noiseTex('#5a5250', ['#3a3432', '#7a7270', '#2a2422'], 1600), roughness: 0.95 });
  put(R, wbox(sw + 0.06, 0.13, 4.45, 1.2), [stucco, stucco, roofTop, stucco, std({ color: 0x3aa8a0, roughness: 0.7 }), stucco], scx, rY - 0.065, -1.8, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(sw + 0.08, 0.05, 0.05), std({ color: 0xf0e6d0, roughness: 0.6 }), scx, rY - 0.14, 0.44);
  for (const x of [sx0 + 0.25, sx1 - 0.25]) beam(R, std({ color: 0x5a3a24, roughness: 0.8 }), new THREE.Vector3(x, rY - 0.9, -0.7), new THREE.Vector3(x, rY - 0.14, 0.3), 0.04);

  // rooftop sign with a catwalk (soft platform 1)
  const cx1 = (P1.x0 + P1.x1) / 2 * SC, cw1 = (P1.x1 - P1.x0) * SC, cY = -P1.y * SC, steelS = std({ color: 0x3a3a40, roughness: 0.5, metalness: 0.8 });
  for (const s of [-1, 1]) put(R, new THREE.BoxGeometry(0.07, cY - rY, 0.07), steelS, cx1 + s * (cw1 / 2 - 0.12), rY + (cY - rY) / 2, -0.45, { cast: true });
  put(R, wbox(cw1, 0.06, 1.0, 0.5), [steelS, steelS, std({ map: canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#4a4a50'; c.fillRect(0, 0, w, h); c.fillStyle = '#1a1a20'; for (let y = 4; y < h; y += 12) for (let x = 4; x < w; x += 12) c.fillRect(x, y, 7, 7); }), roughness: 0.5, metalness: 0.8 }), steelS, steelS, steelS], cx1, cY - 0.03, -0.05, { cast: true, recv: true });
  const signT = signTex([['OPEN', 150, 0.33, '#ff5a7a'], ['24 HRS', 170, 0.7, '#5af0ff']], '#12060e', '#fff', '#ff5a7a');
  put(R, new THREE.BoxGeometry(cw1 + 0.1, 1.05, 0.08), steelS, cx1, cY + 0.62, -0.58);
  put(R, new THREE.PlaneGeometry(cw1, 0.98), new THREE.MeshBasicMaterial({ map: signT, color: new THREE.Color(1.6, 1.6, 1.6) }), cx1, cY + 0.62, -0.535);
  const signBulbs = [];
  for (let i = 0; i < 18; i++) { const a = i / 18, px = cx1 - cw1 / 2 + 0.03 + (a < 0.5 ? a * 2 : 1) * (cw1 - 0.06), py = cY + 0.15 + (a < 0.5 ? 0.95 : (1 - (a - 0.5) * 2) * 0.95); signBulbs.push(put(R, new THREE.SphereGeometry(0.025, 8, 6), glow(0xffe27a, 2.5), px, py, -0.52)); }
  // centre: graffiti wall, the court behind it
  const wallX0 = sx1 + 0.05, wallX1 = P2.x0 * SC - 0.12, wallW = wallX1 - wallX0, wallH = Math.min(1.52, wallW / 2.096), wallC = (wallX0 + wallX1) / 2;
  put(R, wbox(wallW, wallH, 0.26, 1.1), brick, wallC, wallH / 2, -0.88, { cast: true, recv: true });
  put(R, new THREE.PlaneGeometry(wallW - 0.02, wallH - 0.02), std({ map: wallArt, roughness: 0.62, metalness: 0.02 }), wallC, wallH / 2, -0.748);
  put(R, wbox(wallW + 0.08, 0.09, 0.34, 1), std({ color: 0x9a9288, roughness: 0.85, map: noiseTex('#9a9288', ['#6a6258', '#b8b0a4'], 900) }), wallC, wallH + 0.04, -0.88, { cast: true });
  put(R, new THREE.CylinderGeometry(0.05, 0.05, wallH + 0.1, 10), std({ color: 0x7a6a58, roughness: 0.6, metalness: 0.45 }), wallX1 - 0.12, (wallH + 0.1) / 2, -0.735, { cast: true });
  for (let k = 0; k < 14; k++) { const wx = wallX0 + 0.1 + Math.random() * (wallW - 0.2), hgt = 0.08 + Math.random() * 0.14; put(R, new THREE.ConeGeometry(0.03, hgt, 5), std({ color: 0x5a6a2a, roughness: 0.9 }), wx, hgt / 2, -0.73 + Math.random() * 0.05, { rz: (Math.random() - 0.5) * 0.5 }); }
  put(R, new THREE.PlaneGeometry(4.6, 2.3), std({ map: courtTex(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 }), 0.3, 0.004, -3.9, { rx: -Math.PI / 2, recv: true });
  const hoop = new THREE.Group(); hoop.position.set(2.35, 0, -4.1); hoop.rotation.y = -1.05; hoop.scale.setScalar(0.8); R.add(hoop);
  put(hoop, new THREE.CylinderGeometry(0.05, 0.06, 2.2, 10), std({ color: 0x2a4a8a, roughness: 0.5, metalness: 0.6 }), 0, 1.1, -0.3);
  put(hoop, new THREE.BoxGeometry(0.06, 0.06, 0.34), steelS, 0, 2.0, -0.13);
  put(hoop, new THREE.BoxGeometry(0.95, 0.62, 0.03), std({ color: 0xf4f4f0, roughness: 0.4, map: canvasTex(128, 96, (c, w, h) => { c.fillStyle = '#f4f4ee'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d0302a'; c.lineWidth = 6; c.strokeRect(4, 4, w - 8, h - 8); c.strokeRect(w / 2 - 20, h / 2 - 6, 40, 30); }) }), 0, 2.15, 0.05, { cast: true });
  put(hoop, new THREE.TorusGeometry(0.16, 0.012, 6, 24), std({ color: 0xff6a1a, roughness: 0.5, metalness: 0.5 }), 0, 1.95, 0.24, { rx: Math.PI / 2 });
  put(hoop, new THREE.CylinderGeometry(0.16, 0.1, 0.25, 12, 1, true), std({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.55, side: THREE.DoubleSide, wireframe: true }), 0, 1.82, 0.24);
  put(R, new THREE.SphereGeometry(0.11, 16, 12), std({ color: 0xd8641a, roughness: 0.7 }), -0.6, 0.11, -2.9, { cast: true });
  // right: chain-link fence, the lot with the lowriders, billboard (soft platform 2)
  const fx0 = P2.x0 * SC - 0.1, ft = fenceTex(); ft.repeat.set((x1 - fx0) / 0.6, 1.6 / 0.6);
  put(R, new THREE.PlaneGeometry(x1 - fx0, 1.6), std({ map: ft, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.8, color: 0xcfd2da }), (fx0 + x1) / 2, 0.8, -0.92);
  for (let x = fx0; x <= x1 + 0.01; x += (x1 - fx0) / 3) put(R, new THREE.CylinderGeometry(0.025, 0.025, 1.65, 8), steelS, x, 0.82, -0.92);
  const bx = (P2.x0 + P2.x1) / 2 * SC, bw = (P2.x1 - P2.x0) * SC, bY = -P2.y * SC;
  for (const s of [-1, 1]) put(R, new THREE.BoxGeometry(0.12, bY + 1.9, 0.12), steelS, bx + s * (bw / 2 - 0.35), (bY + 1.9) / 2, -0.62, { cast: true });
  put(R, wbox(bw, 0.07, 1.1, 0.5), [steelS, steelS, steelS, steelS, steelS, steelS], bx, bY - 0.035, -0.1, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(bw + 0.2, 1.72, 0.1), steelS, bx, bY + 0.98, -0.68);
  put(R, new THREE.PlaneGeometry(bw + 0.1, 1.62), std({ map: billboardTex(), roughness: 0.7, emissive: 0xffffff, emissiveMap: billboardTex(), emissiveIntensity: 0.25 }), bx, bY + 0.98, -0.625);
  for (const s of [-0.6, 0, 0.6]) { put(R, new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), steelS, bx + s * bw * 0.7, bY + 0.12, -0.35, { rx: 0.5 }); put(R, new THREE.ConeGeometry(0.07, 0.09, 12), std({ color: 0x222, emissive: 0xffe2a0, emissiveIntensity: 1.5 }), bx + s * bw * 0.7, bY + 0.26, -0.28, { rx: Math.PI - 0.5 }); }
  // lowriders hopping in the lot (painted cards)
  const lr = lowriderTex(), cars = [];
  const CARDS = [CARD.lowrider, CARD.muscle, CARD.lowrider], CARL = [2.95, 2.8, 2.95], CARA = [3.683, 3.325, 3.683];
  const shadowT = canvasTex(128, 64, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  for (const [x, z, k, ph, dir] of [[3.25, -2.5, 0, 0, -1], [1.15, -3.6, 1, 0.45, 1], [-1.1, -6.0, 2, 0.2, 1]]) {
    const L = CARL[k], H = L / CARA[k], tex = lr[k];
    const pivot = new THREE.Group(); pivot.position.set(x - dir * L * 0.36, 0, z); R.add(pivot);
    const card = put(pivot, new THREE.PlaneGeometry(L, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: new THREE.Color(0.96, 0.92, 0.9) }), dir * L * 0.36, H / 2 - 0.01, 0);
    if (dir < 0) card.scale.x = -1;
    const sh = put(R, new THREE.PlaneGeometry(L * 1.05, 0.62), new THREE.MeshBasicMaterial({ map: shadowT, transparent: true, depthWrite: false }), x, 0.006, z + 0.05, { rx: -Math.PI / 2 });
    cars.push({ pivot, sh, ph, dir, per: 3.4 + ph });
  }
  // palms (painted cards)
  const palmT = sTex('stg_cards.png', 1, 1, true), palms = [], palmPx = [[208, 637], [325, 637], [353, 637]];
  for (const [x, z, h, k] of [[-1.25, -1.35, 7.4, 0], [1.25, -1.7, 6.2, 1], [-3.6, -4.8, 6.6, 2], [4.0, -5.6, 7.8, 0], [-0.4, -6.2, 5.8, 2]]) {
    const w = h * palmPx[k][0] / palmPx[k][1];
    const p = put(R, cardGeo(w, h, CARD['palm' + k]), new THREE.MeshBasicMaterial({ map: palmT, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, color: new THREE.Color(0.92, 0.86, 0.84) }), x, h / 2 - 0.05, z);
    palms.push({ p, ph: Math.random() * 6 });
  }
  // telephone poles, sagging wires, a street sign
  const wood = std({ color: 0x5a4030, roughness: 0.95, map: noiseTex('#5a4030', ['#3a2818', '#7a5a40'], 600) }), wireM = std({ color: 0x141416, roughness: 0.8 });
  const poleTop = [];
  for (const [x, z] of [[-1.45, -1.02], [4.25, -1.1]]) {
    put(R, new THREE.CylinderGeometry(0.07, 0.1, 5.6, 10), wood, x, 2.8, z, { cast: true });
    put(R, new THREE.BoxGeometry(1.3, 0.09, 0.09), wood, x, 5.2, z); put(R, new THREE.BoxGeometry(0.9, 0.08, 0.08), wood, x, 4.75, z);
    for (const dx of [-0.55, -0.2, 0.2, 0.55]) put(R, new THREE.CylinderGeometry(0.03, 0.035, 0.1, 8), std({ color: 0x6aa0a0, roughness: 0.3 }), x + dx, 5.29, z);
    put(R, new THREE.CylinderGeometry(0.16, 0.16, 0.42, 14), std({ color: 0x6a6a70, roughness: 0.5, metalness: 0.6 }), x + 0.22, 4.35, z - 0.12);
    poleTop.push([x, z]);
  }
  for (const dx of [-0.55, -0.2, 0.2, 0.55]) {
    const a = poleTop[0], b = poleTop[1];
    cable(R, wireM, new THREE.Vector3(a[0] + dx, 5.3, a[1]), new THREE.Vector3(b[0] + dx, 5.3, b[1]), 0.45 + Math.abs(dx) * 0.2);
    cable(R, wireM, new THREE.Vector3(a[0] + dx, 5.3, a[1]), new THREE.Vector3(-11, 5.6, -2.5), 0.9);
    cable(R, wireM, new THREE.Vector3(b[0] + dx, 5.3, b[1]), new THREE.Vector3(11, 5.4, -3), 0.8);
  }
  const ss = signTex([['BRAWL ST', 120, 0.5, '#ffffff']], '#1f7a3a', '#fff', null, 512, 160);
  put(R, new THREE.BoxGeometry(1.0, 0.3, 0.02), std({ map: ss, roughness: 0.5, metalness: 0.3 }), -1.45, 2.5, -0.95);
  put(R, new THREE.CylinderGeometry(0.1, 0.12, 0.34, 14), std({ color: 0xd8282a, roughness: 0.5 }), -1.9, 0.17, -0.55, { cast: true });
  put(R, new THREE.SphereGeometry(0.1, 12, 8, 0, 6.3, 0, 1.6), std({ color: 0xd8282a, roughness: 0.5 }), -1.9, 0.34, -0.55);
  put(R, new THREE.CylinderGeometry(0.17, 0.15, 0.42, 16), std({ color: 0x2a5a3a, roughness: 0.6, metalness: 0.4 }), 1.55, 0.21, -0.62, { cast: true });
  // back wall closing the lot
  put(R, wbox(W, 0.9, 0.2, 1.4), stucco, CX, 0.45, zB + 0.12);
  // warm dust motes in the low sun
  const NM = 90, mPos = new Float32Array(NM * 3), motes = [];
  for (let i = 0; i < NM; i++) motes.push({ x: (Math.random() - 0.5) * 16, y: Math.random() * 5, z: -Math.random() * 6 + 1, s: Math.random() * 6 });
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  const moteP = new THREE.Points(mg, new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.2, 0.7), size: 0.035, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); moteP.frustumCulled = false; R.add(moteP);
  // birds drifting across the sky
  const birdT = canvasTex(64, 32, (c, w, h) => { c.strokeStyle = '#2a1420'; c.lineWidth = 4; c.beginPath(); c.moveTo(4, 8); c.quadraticCurveTo(18, 20, 32, 16); c.quadraticCurveTo(46, 20, 60, 8); c.stroke(); });
  const birds = [];
  for (let i = 0; i < 7; i++) { const b = put(R, new THREE.PlaneGeometry(0.35, 0.17), new THREE.MeshBasicMaterial({ map: birdT, transparent: true, depthWrite: false }), -16 + i * 0.7, 7.5 + (i % 3) * 0.35, -12 - (i % 2)); birds.push({ b, ph: i * 0.9 }); }
  // streetlight with real falloff, a drain, weeds in the fence line, shoes over the wire
  const lampPost = std({ color: 0x4a4a46, roughness: 0.55, metalness: 0.7 });
  const lamp = new THREE.Group(); lamp.position.set(3.55, 0, -1.02); R.add(lamp);
  put(lamp, new THREE.CylinderGeometry(0.06, 0.085, 5.4, 12), lampPost, 0, 2.7, 0, { cast: true });
  put(lamp, new THREE.CylinderGeometry(0.16, 0.2, 0.25, 12), lampPost, 0, 0.12, 0);
  const armC = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 5.3, 0), new THREE.Vector3(-0.35, 5.62, 0.1), new THREE.Vector3(-1.0, 5.6, 0.25)]);
  lamp.add(new THREE.Mesh(new THREE.TubeGeometry(armC, 14, 0.045, 8), lampPost));
  put(lamp, new THREE.BoxGeometry(0.42, 0.1, 0.24), lampPost, -1.05, 5.52, 0.25, { rz: 0.06 });
  const lampGlass = put(lamp, new THREE.PlaneGeometry(0.36, 0.2), glowA(0xffd9a0, 1.2, 0.9), -1.05, 5.46, 0.25, { rx: -Math.PI / 2 });
  sprite(lamp, 0xffc880, 1.0, 1.6, -1.05, 5.45, 0.25, true);
  const lampL = new THREE.PointLight(0xffb870, 6, 7, 2); lampL.position.set(2.5, 5.2, -0.7); R.add(lampL);
  put(R, new THREE.BoxGeometry(0.42, 0.03, 0.22), std({ color: 0x2e2c2a, roughness: 0.5, metalness: 0.7, map: canvasTex(64, 32, (c, w, h) => { c.fillStyle = '#3a3634'; c.fillRect(0, 0, w, h); c.fillStyle = '#100e0c'; for (let x = 4; x < w; x += 8) c.fillRect(x, 3, 4, h - 6); }) }), -2.6, 0.02, -0.3);
  for (let k = 0; k < 22; k++) { const wx = 1.6 + Math.random() * 2.8, hgt = 0.09 + Math.random() * 0.16; put(R, new THREE.ConeGeometry(0.035, hgt, 5), std({ color: 0x6a7a30, roughness: 0.9 }), wx, hgt / 2, -0.95 + Math.random() * 0.12, { rz: (Math.random() - 0.5) * 0.6 }); }
  for (const [sx2, sz2] of [[0.35, -1.02], [0.52, -1.02]]) {
    const str = put(R, new THREE.CylinderGeometry(0.008, 0.008, 0.55, 5), std({ color: 0x2a2a2a, roughness: 0.9 }), sx2, 4.75, sz2);
    for (const o of [-0.05, 0.05]) put(R, new THREE.BoxGeometry(0.075, 0.05, 0.19), std({ color: o < 0 ? 0xe8e4d8 : 0xd84a3a, roughness: 0.8 }), sx2 + o, 4.46, sz2, { rz: o < 0 ? 0.2 : -0.15 });
  }
  // lights: low sun from the left, warm bounce off the asphalt, cool sky fill
  g.add(new THREE.HemisphereLight(0xbfd0ff, 0x8a5a34, 0.55));
  sunKey(g, 0xffb878, 2.3, [9, 4.5, 5], { left: -11, right: 11, top: 8, bottom: -3, near: 1, far: 44 });
  const rim = new THREE.DirectionalLight(0xff8a40, 1.6); rim.position.set(7, 2.5, -8); g.add(rim);
  const fill = new THREE.DirectionalLight(0x8aa8ff, 0.5); fill.position.set(-7, 4, 5); g.add(fill);
  const bounce = new THREE.DirectionalLight(0xffb070, 0.35); bounce.position.set(0, -4, 6); g.add(bounce);
  g.userData.embers = null;
  let lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (const c of cars) {
      const u = ((t + c.ph * c.per) % c.per) / c.per;
      let ang = 0, y = Math.sin(t * 5 + c.ph * 9) * 0.006;
      if (u > 0.55 && u < 0.8) { const k = (u - 0.55) / 0.25, s = Math.sin(k * Math.PI); ang = s * 0.42; y = s * s * 0.42; }
      else if (u >= 0.8) { const k = (u - 0.8) / 0.2; y = Math.abs(Math.sin(k * Math.PI * 3)) * 0.06 * (1 - k); ang = Math.sin(k * Math.PI * 3) * 0.04 * (1 - k); }
      c.pivot.position.y = y; c.pivot.rotation.z = ang * c.dir; c.sh.material.opacity = 1 - Math.min(0.7, y * 1.6); c.sh.scale.x = 1 - y * 0.3;
    }
    for (const p of palms) p.p.rotation.z = Math.sin(t * 0.7 + p.ph) * 0.012;
    signBulbs.forEach((b, i) => { b.visible = ((i + Math.floor(t * 6)) % 3) !== 0; });
    for (let i = 0; i < NM; i++) { const m = motes[i]; mPos[i * 3] = m.x + Math.sin(t * 0.3 + m.s) * 0.4; mPos[i * 3 + 1] = (m.y + t * 0.08 + m.s) % 5; mPos[i * 3 + 2] = m.z; }
    mg.attributes.position.needsUpdate = true;
    for (const b of birds) { b.b.position.x += dt * 0.9; if (b.b.position.x > 18) b.b.position.x = -18; b.b.scale.y = 0.6 + Math.abs(Math.sin(t * 6 + b.ph)) * 0.6; }
  };
  return g;
}

// ---------- Grand Arena ----------
function arenaFloorTex() {
  return canvasTex(1024, 1024, (c, W, H) => {
    c.fillStyle = '#07080d'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(${90 + Math.random() * 60},${100 + Math.random() * 60},${130 + Math.random() * 60},${Math.random() * 0.06})`; c.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 30, 1 + Math.random() * 2); }
    c.strokeStyle = 'rgba(40,46,60,.9)'; c.lineWidth = 3; for (let k = 64; k < W; k += 128) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, H); c.stroke(); c.beginPath(); c.moveTo(0, k); c.lineTo(W, k); c.stroke(); }
    const ring = (r, w, col, blur) => { c.shadowColor = col; c.shadowBlur = blur; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(W / 2, H / 2, r, 0, 7); c.stroke(); c.shadowBlur = 0; };
    ring(430, 10, '#ff2a4a', 30); ring(300, 6, '#27e1ff', 24); ring(160, 16, '#27e1ff', 30); ring(120, 3, '#ffffff', 10);
    c.save(); c.translate(W / 2, H / 2); c.strokeStyle = 'rgba(34,230,255,.55)'; c.lineWidth = 4; for (let k = 0; k < 24; k++) { c.rotate(Math.PI / 12); c.beginPath(); c.moveTo(310, 0); c.lineTo(k % 2 ? 350 : 390, 0); c.stroke(); } c.restore();
    c.font = 'bold 54px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffffff'; c.shadowColor = '#27e1ff'; c.shadowBlur = 20;
    c.fillText('BRAWL', W / 2, H / 2 + 225); c.save(); c.translate(W / 2, H / 2 - 225); c.rotate(Math.PI); c.fillText('BRAWL', 0, 0); c.restore();
    c.font = 'bold 96px Bungee, Impact, sans-serif'; c.fillStyle = '#ff2a4a'; c.shadowColor = '#ff2a4a'; c.fillText('STREET', W / 2, H / 2 + 6);
  });
}
function ledTex(text, colA, colB) {
  const t = canvasTex(2048, 128, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#0a0620'); gr.addColorStop(0.5, '#1a0a3a'); gr.addColorStop(1, '#0a0620'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.font = 'italic 900 84px Bungee, Impact, sans-serif'; c.textBaseline = 'middle'; let x = 20, k = 0;
    while (x < W) { c.fillStyle = k % 2 ? colB : colA; c.shadowColor = c.fillStyle; c.shadowBlur = 18; c.fillText(text[k % text.length], x, H / 2 + 4); x += c.measureText(text[k % text.length]).width + 90; k++; }
    c.shadowBlur = 0; c.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
  });
  t.wrapS = THREE.RepeatWrapping; return t;
}
function holoMat(tex, rect, tint) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, t: { value: 0 }, tint: { value: new THREE.Color(tint) }, rect: { value: new THREE.Vector4(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform sampler2D map; uniform float t; uniform vec3 tint; uniform vec4 rect; varying vec2 vUv;
      void main(){ float wob = sin(vUv.y*80. + t*6.)*.002 + (step(.97, fract(t*.7))*sin(vUv.y*300.)*.01);
        vec3 c = texture2D(map, rect.xy + vec2(vUv.x + wob, vUv.y) * rect.zw).rgb;
        float scan = .75 + .25*sin((vUv.y - t*.12)*420.); float flick = .9 + .1*sin(t*23.) * sin(t*7.);
        float l = dot(c, vec3(.3,.5,.2)); vec3 col = mix(c, tint * l * 1.7, .88) * scan * flick;
        float edge = smoothstep(0., .04, vUv.x) * smoothstep(1., .96, vUv.x);
        gl_FragColor = vec4(col * 1.35 * edge, 1.); }`,
  });
}
function buildArena(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, ap = (M.x1 - M.x0) * SC / 2, CX = (M.x0 + M.x1) / 2 * SC, zc = 0, rr = ap, hgt = M.bot * SC;
  scene.fog = new THREE.Fog(0x0a0a22, 22, 90);
  g.add(skyDome(0x02020a, 0x0a0a2a, 0x10061a));
  const panel = tileMat('arenapanel', { glow: 0.6, m: { roughness: 0.35, metalness: 0.85 } });
  const metal = std({ color: 0x1a1c24, roughness: 0.3, metalness: 0.9 });
  const redM = glow(0xff2a4a, 2.6), cyanM = glow(0x27e1ff, 2.4);
  // the platform: a round raised stage (squashed in depth), panelled sides, glowing floor, neon rims
  const plat = new THREE.Group(); plat.position.set(CX, 0, zc); plat.scale.z = 0.62; R.add(plat);
  const side = new THREE.CylinderGeometry(rr, rr, hgt, 96, 1, true);
  { const uv = side.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * rr / 1.3, uv.getY(i) * hgt / 1.3); }
  put(plat, side, panel, 0, -hgt / 2, 0);
  const floorT = arenaFloorTex();
  put(plat, new THREE.CircleGeometry(rr, 96), std({ map: floorT, emissive: 0xffffff, emissiveMap: floorT, emissiveIntensity: 0.9, roughness: 0.22, metalness: 0.7 }), 0, 0, 0, { rx: -Math.PI / 2, recv: true });
  put(plat, new THREE.TorusGeometry(rr, 0.028, 6, 128), redM, 0, -0.02, 0, { rx: Math.PI / 2 });
  put(plat, new THREE.TorusGeometry(rr * 1.002, 0.022, 6, 128), cyanM, 0, -hgt + 0.1, 0, { rx: Math.PI / 2 });
  // light posts round the rim (tall behind the fighters, low in front), a curved glass rail on the back half
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2 + Math.PI / 12, x = Math.sin(a) * rr, z = Math.cos(a) * rr, back = z < -0.5;
    put(plat, new THREE.CylinderGeometry(0.05, 0.06, back ? 0.62 : 0.16, 10), metal, x, back ? 0.31 : 0.08, z);
    put(plat, new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), glow(0x27e1ff, 3), x, back ? 0.64 : 0.18, z);
  }
  put(plat, new THREE.CylinderGeometry(rr, rr, 0.5, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76), std({ color: 0x9adfff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }), 0, 0.3, 0);
  put(plat, new THREE.TorusGeometry(rr, 0.02, 6, 64, Math.PI * 0.76), metal, 0, 0.57, 0, { rx: Math.PI / 2, rz: Math.PI * 0.62 - Math.PI / 2 });
  put(plat, new THREE.TorusGeometry(rr, 0.012, 6, 64, Math.PI * 0.76), cyanM, 0, 0.6, 0, { rx: Math.PI / 2, rz: Math.PI * 0.62 - Math.PI / 2 });
  // curved LED band across the front of the platform
  const led1 = ledTex(['BRAWL STREET', 'FIGHT NIGHT'], '#ffffff', '#ff2a4a'), led2 = ledTex(['BRAWL', 'STREET'], '#27e1ff', '#ffffff');
  led1.repeat.set(1.6, 1); led2.repeat.set(0.3, 1);
  put(plat, new THREE.CylinderGeometry(rr * 1.006, rr * 1.006, hgt * 0.42, 96, 1, true, -Math.PI * 0.45, Math.PI * 0.9), new THREE.MeshBasicMaterial({ map: led1, color: new THREE.Color(1.5, 1.5, 1.5) }), 0, -hgt * 0.5, 0);
  // pedestal into the dark with LED rings
  put(R, new THREE.CylinderGeometry(rr * 0.78, rr * 0.5, 7, 64, 1, true), metal, CX, -hgt - 3.5, zc, { s: [1, 1, 0.62] });
  const rings = [];
  for (const [y, r] of [[-hgt - 0.6, 0.76], [-hgt - 1.8, 0.7], [-hgt - 3.2, 0.62]]) rings.push(put(R, new THREE.TorusGeometry(rr * r, 0.035, 6, 96), glow(0xff2a4a, 2.4), CX, y, zc, { rx: Math.PI / 2, s: [1, 0.62, 1] }));
  // hovering glass panels (soft platforms) with emitter drones
  const hexT = canvasTex(256, 256, (c, w, h) => { c.fillStyle = 'rgba(39,225,255,.22)'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(160,240,255,.9)'; c.lineWidth = 2; const r = 18; for (let y = 0, row = 0; y < h + r; y += r * 1.5, row++) for (let x = (row % 2) * r * 0.866; x < w + r; x += r * 1.732) { c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); c.stroke(); } });
  const drones = [];
  for (const P of st.plats) {
    const x = (P.x0 + P.x1) / 2 * SC, w = (P.x1 - P.x0) * SC, y = -P.y * SC;
    put(R, new THREE.BoxGeometry(w, 0.05, 1.3), std({ map: hexT, transparent: true, opacity: 0.85, emissive: 0x27e1ff, emissiveMap: hexT, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.3, depthWrite: false }), x, y - 0.025, -0.1, { recv: true });
    for (const dz of [-0.75, 0.55]) put(R, new THREE.BoxGeometry(w + 0.02, 0.03, 0.03), cyanM, x, y - 0.012, dz);
    for (const dx of [-w / 2, w / 2]) put(R, new THREE.BoxGeometry(0.03, 0.03, 1.33), cyanM, x + dx, y - 0.012, -0.1);
    const d = new THREE.Group(); d.position.set(x, y - 0.55, -0.35); R.add(d);
    put(d, new THREE.CylinderGeometry(0.22, 0.28, 0.1, 20), metal, 0, 0, 0); put(d, new THREE.TorusGeometry(0.25, 0.02, 6, 24), cyanM, 0, 0.02, 0, { rx: Math.PI / 2 });
    put(d, new THREE.CylinderGeometry(w * 0.45, 0.2, 0.5, 24, 1, true), glowA(0x27e1ff, 0.8, 0.14), 0, 0.28, 0.2);
    sprite(d, 0x27e1ff, 1.6, 0.7, 0, -0.08, 0);
    drones.push({ d, y: y - 0.55 });
  }
  // glass light towers either side
  const towers = [];
  for (const s of [-1, 1]) {
    const tw = new THREE.Group(); tw.position.set(CX + s * 7.4, 0, -3.8); R.add(tw);
    put(tw, new THREE.CylinderGeometry(0.62, 0.62, 9, 32, 1, true), std({ color: 0x8ad8ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, emissive: 0x1a6aa0, emissiveIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false }), 0, -1.5, 0);
    const core = put(tw, new THREE.CylinderGeometry(0.16, 0.16, 9, 16), glow(0x27e1ff, 2.2), 0, -1.5, 0);
    for (let k = 0; k < 7; k++) put(tw, new THREE.TorusGeometry(0.63, 0.025, 6, 32), glow(k % 2 ? 0xff2a4a : 0x27e1ff, 2.2), 0, -5 + k * 1.3, 0, { rx: Math.PI / 2 });
    put(tw, new THREE.CylinderGeometry(0.95, 0.8, 0.14, 32), metal, 0, 3.05, 0);
    const disc = put(tw, new THREE.CylinderGeometry(0.85, 0.85, 0.06, 32), glow(0xbff4ff, 2.6), 0, 3.14, 0);
    sprite(tw, 0x5ad8ff, 1.3, 3.2, 0, 3.2, 0);
    const L = new THREE.PointLight(0x40c8ff, 8, 9, 1.6); L.position.set(0, 1.5, 0.9); tw.add(L);
    towers.push({ core, disc, L });
  }
  // lighting rig with sweeping spotlight beams
  const rig = new THREE.Group(); rig.position.set(CX, 7.4, -6.5); R.add(rig);
  const trussT = canvasTex(256, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = '#8a90a0'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6); for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 3); c.lineTo(x + 32, h - 3); c.stroke(); } });
  trussT.wrapS = THREE.RepeatWrapping; trussT.repeat.set(8, 1);
  const trussM = std({ map: trussT, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.9 });
  for (const dz of [-0.35, 0.35]) put(rig, new THREE.PlaneGeometry(18, 0.5), trussM, 0, 0, dz);
  const beamT = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.9)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const spots = [];
  for (let k = 0; k < 6; k++) {
    const sp = new THREE.Group(); sp.position.set(-7.5 + k * 3, -0.35, 0.3); rig.add(sp);
    put(sp, new THREE.CylinderGeometry(0.16, 0.22, 0.4, 14), metal, 0, 0, 0);
    const cone = put(sp, new THREE.ConeGeometry(1.5, 9, 24, 1, true), glowA(0x4a8aff, 0.9, 0.12, beamT), 0, -4.6, 0);
    sprite(sp, 0x9ac8ff, 1.8, 0.8, 0, -0.25, 0.1);
    spots.push({ sp, ph: k * 1.3 });
  }
  // lasers from the roof
  const lasers = [];
  // 9/22 night: 16 full-glow 34-unit beams swept the whole screen, across the fighters. 8, dimmer, shorter,
  // further back, and they sweep the crowd instead of the fight.
  for (let k = 0; k < 8; k++) {
    const l = new THREE.Group(); l.position.set(-14 + k * 4 + (Math.random() - 0.5), 10.5, -13 - Math.random() * 7); R.add(l);
    put(l, new THREE.CylinderGeometry(0.014, 0.014, 22, 5), glowA(0xff2030, 1.9, 0.5), 0, -11, 0);
    lasers.push({ l, ph: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.5, a: 0.18 + Math.random() * 0.22 });
    l.visible = false;   // even thinned out they drew vertical lines through the fight; the painted plate has its own lasers over the crowd
  }
  // hologram trophy: fist with the crown coin, over the far side
  const holo = new THREE.Group(); holo.position.set(CX, 1.9, -12); R.add(holo);
  const th = 4.3, tw = th * 175 / 454, hm = holoMat(sTex('stg_panels.jpg', 1, 1, true), CARD.trophy, 0x27e1ff);
  put(holo, new THREE.PlaneGeometry(tw, th), hm, 0, th / 2, 0);
  put(holo, new THREE.CylinderGeometry(0.9, 1.1, 0.18, 32), metal, 0, -0.2, 0);
  put(holo, new THREE.TorusGeometry(1.0, 0.04, 8, 40), cyanM, 0, -0.1, 0, { rx: Math.PI / 2 });
  const hcone = put(holo, new THREE.CylinderGeometry(tw * 0.55, 0.9, th * 0.9, 32, 1, true), glowA(0x27e1ff, 0.8, 0.1), 0, th * 0.45 - 0.1, 0);
  // crowd phone lights twinkling in the stands, LED boards on the barrier
  const NC = 520, cPos = new Float32Array(NC * 3), cCol = new Float32Array(NC * 3), crowd = [];
  for (let i = 0; i < NC; i++) { const tier = Math.random(); crowd.push({ x: (Math.random() - 0.5) * 70, y: -3 + tier * 9 + Math.random() * 0.6, z: -30 - tier * 8, ph: Math.random() * 6.28, sp: 1 + Math.random() * 3, c: Math.random() < 0.7 ? [1, 1, 1] : Math.random() < 0.5 ? [0.3, 0.9, 1.4] : [1.4, 0.4, 1.1] }); }
  crowd.forEach((p, i) => { cPos[i * 3] = p.x; cPos[i * 3 + 1] = p.y; cPos[i * 3 + 2] = p.z; });
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cPos, 3)); cg.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
  const crowdP = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); crowdP.frustumCulled = false; R.add(crowdP);
  const board = ledTex(['BRAWL STREET', 'PLAY FOR KEEPS', 'BRAWL STREET', 'FIGHT NIGHT'], '#ff2a4a', '#27e1ff'); board.repeat.set(-2.4, 1);
  const boardM = put(R, new THREE.CylinderGeometry(24, 24, 0.7, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76), new THREE.MeshBasicMaterial({ map: board, color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.BackSide }), CX, -3.2, 8);
  // haze around the pedestal
  const smokeT = canvasTex(256, 128, (c, w, h) => { for (let i = 0; i < 16; i++) { const x = 30 + Math.random() * 196, y = 40 + Math.random() * 50, r = 30 + Math.random() * 40, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); } });
  const hazes = [];
  for (let i = 0; i < 10; i++) { const m = put(R, new THREE.PlaneGeometry(9, 3.2), new THREE.MeshBasicMaterial({ map: smokeT, transparent: true, depthWrite: false, opacity: 0.22, color: i % 2 ? 0x5a6aff : 0xff5a8a, fog: false }), -18 + i * 4, -2.6 - Math.random() * 1.5, -3 - Math.random() * 8); hazes.push(m); }
  // lights
  g.add(new THREE.HemisphereLight(0x5060c0, 0x100510, 0.5));
  sunKey(g, 0xe8eeff, 2.0, [1, 10, 8], { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  const rimA = new THREE.DirectionalLight(0xff2a4a, 1.6); rimA.position.set(-7, 3, -5); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0x3a7aff, 1.5); rimB.position.set(7, 3, -5); g.add(rimB);
  const under = new THREE.PointLight(0xff2a4a, 10, 8, 1.6); under.position.set(CX, -2, 3.5); R.add(under);
  g.userData.embers = null;
  g.userData.tick = t => {
    for (const s of spots) { s.sp.rotation.z = Math.sin(t * 0.6 + s.ph) * 0.45; s.sp.rotation.x = Math.cos(t * 0.45 + s.ph) * 0.25; }
    for (const l of lasers) { l.l.rotation.z = Math.sin(t * l.sp + l.ph) * l.a; l.l.rotation.x = Math.cos(t * l.sp * 0.7 + l.ph) * 0.08; }
    hm.uniforms.t.value = t; holo.rotation.y = Math.sin(t * 0.4) * 0.28; holo.position.y = 1.9 + Math.sin(t * 1.1) * 0.08; hcone.material.opacity = 0.08 + Math.sin(t * 5) * 0.02;
    for (let i = 0; i < NC; i++) { const p = crowd[i], k = 0.25 + Math.max(0, Math.sin(t * p.sp + p.ph)) * 0.9; cCol[i * 3] = p.c[0] * k; cCol[i * 3 + 1] = p.c[1] * k; cCol[i * 3 + 2] = p.c[2] * k; }
    cg.attributes.color.needsUpdate = true;
    board.offset.x = (t * 0.02) % 1; led1.offset.x = (t * 0.04) % 1;
    for (const d of drones) d.d.position.y = d.y + Math.sin(t * 2 + d.y) * 0.03;
    towers.forEach((w, i) => { w.L.intensity = 7 + Math.sin(t * 3 + i * 2) * 1.5; w.disc.material.color.setRGB(1.4, 2.2, 2.6).multiplyScalar(0.9 + Math.sin(t * 4 + i) * 0.1); });
    rings.forEach((r, i) => r.material.color.setRGB(2.4, 0.3, 0.5).multiplyScalar(0.6 + 0.4 * Math.max(0, Math.sin(t * 3 - i * 1.2))));
    hazes.forEach((m, i) => { m.position.x += 0.004 + (i % 3) * 0.002; if (m.position.x > 20) m.position.x = -20; });
  };
  return g;
}

// ---------- Gloom Bayou ----------
function swampWater(P = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 },
      uDeep: { value: new THREE.Color(P.deep != null ? P.deep : 0x0d2919) },
      uMurk: { value: new THREE.Color(P.murk != null ? P.murk : 0x1f4d2e) },
      uGold: { value: new THREE.Color(P.gold != null ? P.gold : 0xffc76b) },
      uHaze: { value: new THREE.Color(P.haze != null ? P.haze : 0xb8bd80) },
      uWeed: { value: new THREE.Color(P.weed != null ? P.weed : 0x33611f) },
      uGoldK: { value: P.goldK != null ? P.goldK : 1 } },
    fog: false,
    vertexShader: 'varying vec2 vUv; varying vec3 wp; void main(){ vUv = uv; wp = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(wp,1.); }',
    fragmentShader: NOISE + `uniform float t; uniform vec3 uDeep, uMurk, uGold, uHaze, uWeed; uniform float uGoldK; varying vec2 vUv; varying vec3 wp;
      void main(){ vec2 p = wp.xz * vec2(.35, .9); float n = fbm(p + vec2(t*.05, t*.02)), n2 = fbm(p*2.3 - vec2(t*.08, 0.));
        float d = clamp(-wp.z / 45., 0., 1.);
        vec3 c = mix(uDeep, uMurk, n);
        c += uGold * smoothstep(.62,.8, n2) * (.25 + d*.8) * uGoldK;
        float weed = smoothstep(.55,.7, fbm(wp.xz*1.7)) * (1.-d); c = mix(c, uWeed, weed*.55);
        c = mix(c, uHaze, pow(d, 1.15) * .95);
        gl_FragColor = vec4(c, 1.); }`,
  });
}
function mossTex() {
  return canvasTex(256, 512, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = Math.random() * W, len = H * (0.3 + Math.random() * 0.7); c.strokeStyle = `hsla(${80 + Math.random() * 30},${25 + Math.random() * 20}%,${45 + Math.random() * 20}%,${0.6 + Math.random() * 0.4})`; c.lineWidth = 1.5 + Math.random() * 3; c.beginPath(); c.moveTo(x, 0); let xx = x; for (let y = 0; y < len; y += 20) { xx += (Math.random() - 0.5) * 8; c.lineTo(xx, y); } c.stroke(); }
  });
}
function padTex() {
  return canvasTex(512, 512, (c, W, H) => {
    const gr = c.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W / 2); gr.addColorStop(0, '#9ad04a'); gr.addColorStop(0.7, '#4f9a2a'); gr.addColorStop(1, '#2f6a1a'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(210,240,140,.55)'; c.lineWidth = 4; for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2; c.beginPath(); c.moveTo(W / 2, H / 2); c.quadraticCurveTo(W / 2 + Math.cos(a + 0.2) * 120, H / 2 + Math.sin(a + 0.2) * 120, W / 2 + Math.cos(a) * 250, H / 2 + Math.sin(a) * 250); c.stroke(); }
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '30,70,10' : '200,240,120'},${Math.random() * 0.12})`; c.fillRect(Math.random() * W, Math.random() * H, 4, 4); }
  });
}
function barkTube(curve, r, segs, rad, mat, tile = 1.2) {
  const gm = new THREE.TubeGeometry(curve, segs, r, rad || 10), L = curve.getLength(), uv = gm.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / tile, uv.getY(i) * 2 * Math.PI * r / tile);
  return new THREE.Mesh(gm, mat);
}
function mangrove(R, bark, leaf, moss, x, z, h, s, lean) {
  const t = new THREE.Group(); t.position.set(x, -1.6, z); t.scale.setScalar(s); R.add(t);
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  t.add(barkTube(new THREE.CatmullRomCurve3([V(0, -0.5, 0), V(0.2 * lean, h * 0.35, 0.1), V(-0.1 * lean, h * 0.7, -0.1), V(0.3 * lean, h, 0)]), 0.42, 24, 12, bark));
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + 0.3, R0 = 1.2 + (k % 3) * 0.35; t.add(barkTube(new THREE.CatmullRomCurve3([V(Math.cos(a) * 0.15, h * 0.28, Math.sin(a) * 0.15), V(Math.cos(a) * R0 * 0.5, h * 0.3 + 0.2, Math.sin(a) * R0 * 0.5), V(Math.cos(a) * R0, -0.6, Math.sin(a) * R0)]), 0.1, 14, 8, bark)); }
  const tops = [];
  for (let k = 0; k < 4; k++) { const a = k * 1.7 + 0.5, L = 1.6 + (k % 2) * 0.6, e = V(0.3 * lean + Math.cos(a) * L, h + 0.6 + (k % 2) * 0.5, Math.sin(a) * L * 0.6); t.add(barkTube(new THREE.CatmullRomCurve3([V(0.3 * lean, h * 0.92, 0), V((0.3 * lean + e.x) / 2, h + 0.5, e.z / 2), e]), 0.12, 12, 8, bark)); tops.push(e); }
  for (const e of tops) for (let k = 0; k < 4; k++) { const b = put(t, new THREE.IcosahedronGeometry(0.8 + Math.random() * 0.5, 1), leaf, e.x + (Math.random() - 0.5) * 1.2, e.y + Math.random() * 0.5, e.z + (Math.random() - 0.5) * 0.9); b.scale.y = 0.6; }
  const strands = [];
  for (const e of tops) for (let k = 0; k < 3; k++) { const m = put(t, new THREE.PlaneGeometry(0.7, 1.9), moss, e.x + (Math.random() - 0.5) * 1.2, e.y - 1.0, e.z + 0.3 + Math.random() * 0.3); strands.push(m); }
  return { t, strands, tops };
}
function buildSwamp(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC, WL = -1.6;
  scene.fog = new THREE.Fog(0x7f927a, 9, 46);
  g.add(skyDome(0x6a8aa0, 0xf0c890, 0x9ab080));
  const planks = std({ map: stageTex('planks', 1, 1), roughness: 0.8, color: 0xc8b8a0 });
  { const t = planks.map; t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  // 9/22 night: the painted plate (bg_swamp.jpg: a golden-hour bayou with mossy giants, a stilt hut and lilies) was
  // buried under a flat mustard water plane, flat-shaded green blob canopies and psychedelic tiled bark. Now: one
  // dark weathered wood for every trunk / post / root (the near trees read as silhouettes framing the fight, like
  // the painting's own), no canopy blobs (the moss still hangs), no far trees, no water plane, no box hut.
  const bark = std({ color: 0xb8a888, roughness: 0.9, metalness: 0.02, map: noiseTex('#6a5a44', ['#3e3426', '#8a7a60', '#4e5a36', '#7a6a50'], 1800), emissive: 0x1a1408, emissiveIntensity: 0.4 }), wetWood = std({ color: 0x3a2a1c, roughness: 0.75, map: noiseTex('#3a2a1c', ['#1a120a', '#5a4430'], 900) });
  const leaf = std({ color: 0x3e6826 }); leaf.visible = false;
  const moss = new THREE.MeshStandardMaterial({ map: mossTex(), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 1, color: 0xc0d0a0 });
  // boardwalk on log posts
  put(R, wbox(W, 0.16, 2.6, 2.2), [planks, planks, planks, wetWood, planks, wetWood], CX, -0.08, -0.1, { recv: true, cast: true });
  put(R, wbox(W + 0.1, 0.22, 0.16, 1.1), planks, CX, -0.26, 1.16);
  put(R, new THREE.BoxGeometry(W + 0.1, 0.22, 0.16), wetWood, CX, -0.24, -1.3);
  for (let x = M.x0 * SC + 0.25; x <= M.x1 * SC - 0.2; x += 1.32) for (const z of [1.08, -1.25]) { const p = put(R, new THREE.CylinderGeometry(0.13, 0.15, 2.6, 10), bark, x + (z > 0 ? 0 : 0.3), -1.25, z); p.rotation.z = (Math.random() - 0.5) * 0.08; }
  // rope railing and lanterns along the back edge
  const rope = std({ color: 0xc8b080, roughness: 1 });
  const postsX = []; for (let x = M.x0 * SC + 0.25; x <= M.x1 * SC - 0.2; x += 1.65) postsX.push(x);
  for (const x of postsX) put(R, new THREE.CylinderGeometry(0.05, 0.06, 0.9, 8), bark, x, 0.45, -1.2, { cast: true });
  for (let i = 0; i < postsX.length - 1; i++) cable(R, rope, new THREE.Vector3(postsX[i], 0.82, -1.2), new THREE.Vector3(postsX[i + 1], 0.82, -1.2), 0.16, 0.014);
  const lanterns = [];
  for (const x of [postsX[1], postsX[postsX.length - 2]]) {
    put(R, new THREE.BoxGeometry(0.12, 0.16, 0.12), std({ color: 0x2a1a0a, roughness: 0.6, metalness: 0.5, emissive: 0xffa040, emissiveIntensity: 1.6 }), x, 1.02, -1.2);
    sprite(R, 0xffb050, 1.3, 0.9, x, 1.02, -1.1, true);
    const L = new THREE.PointLight(0xffa850, 4.6, 5, 1.8); L.position.set(x, 1.05, -0.9); R.add(L); lanterns.push(L);
  }
  // water, mist and reeds
  const water = put(R, new THREE.PlaneGeometry(200, 110, 1, 1), swampWater({ deep: 0x071710, murk: 0x11291c, gold: 0x7a5c33, haze: 0x8a7638, weed: 0x152509, goldK: 0.45 }), 0, WL, -45, { rx: -Math.PI / 2 });
  water.visible = false;   // the painting's lagoon shows under the boardwalk instead
  const mistT = canvasTex(256, 128, (c, w, h) => { for (let i = 0; i < 12; i++) { const x = 40 + Math.random() * 176, y = 50 + Math.random() * 30, r = 30 + Math.random() * 40, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); } });
  const mists = [];
  for (let i = 0; i < 14; i++) { const m = put(R, new THREE.PlaneGeometry(7, 2.2), new THREE.MeshBasicMaterial({ map: mistT, transparent: true, depthWrite: false, opacity: 0.4, color: 0x8b9a86 }), -16 + i * 2.4, WL + 0.35 + Math.random() * 0.4, 2 - Math.random() * 12); mists.push(m); }
  const reedM = std({ color: 0x5a7a2a, roughness: 0.9 }), catM = std({ color: 0x5a3418, roughness: 0.9 });
  const reeds = new THREE.Group(); R.add(reeds);
  for (let k = 0; k < 46; k++) {
    const side = k % 3 === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    const x = side ? side * (4.8 + Math.random() * 3.5) : (Math.random() - 0.5) * 9, z = side ? 0.8 - Math.random() * 2.5 : 1.5 + Math.random() * 1.6, hh = side ? 1.0 + Math.random() * 1.2 : 0.35 + Math.random() * 0.4;
    const r = put(reeds, new THREE.CylinderGeometry(0.012, 0.018, hh, 5), reedM, x, WL + hh / 2, z); r.rotation.z = (Math.random() - 0.5) * 0.25;
    if (k % 2) put(reeds, new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), catM, x + r.rotation.z * -hh * 0.45, WL + hh - 0.05, z);
    if (k % 4 === 0) { const bl = put(reeds, new THREE.PlaneGeometry(0.06, hh * 1.1), reedM, x + 0.05, WL + hh * 0.5, z + 0.02); bl.rotation.z = 0.2; }
  }
  // the big mangroves; the left one carries the top branch (soft platform 2)
  const trees = [mangrove(R, bark, leaf, moss, -4.3, -3.0, 5.6, 1.0, 1), mangrove(R, bark, leaf, moss, 5.6, -3.6, 5.8, 1.0, -1), mangrove(R, bark, leaf, moss, -9.5, -6.5, 6.5, 1.2, 1), mangrove(R, bark, leaf, moss, 10.5, -7.5, 6.8, 1.2, -1)];
  trees[2].t.visible = false; trees[3].t.visible = false;   // the far pair stood in front of the painting's own giants
  const P2 = st.plats[2], by = -P2.y * SC - 0.17, V = (a, b, c) => new THREE.Vector3(a, b, c);
  const br = barkTube(new THREE.CatmullRomCurve3([V(-3.9, 2.0, -2.3), V(-2.2, 2.35, -0.9), V(-1.1, by, 0), V(0, by + 0.005, 0.05), V(1.1, by, 0), V(2.0, by + 0.25, -0.6), V(3.1, by + 0.9, -1.6)]), 0.17, 60, 10, bark);
  br.castShadow = true; br.receiveShadow = true; R.add(br);
  for (const x of [-0.7, 0.45, 1.6]) put(R, new THREE.PlaneGeometry(0.5, 1.3), moss, x, by - 0.75, -0.25);
  // giant lily pad on its stalk (soft platform 0, bobs) with a lotus
  const pad = new THREE.Group(); R.add(pad);
  const P0 = st.plats[0], pw = (P0.x1 - P0.x0) * SC, padT = padTex();
  put(pad, new THREE.CylinderGeometry(pw * 0.56, pw * 0.53, 0.07, 48, 1, false, 0.35, Math.PI * 2 - 0.45), [std({ color: 0x2c5c1a, roughness: 0.7 }), std({ map: padT, roughness: 0.6, metalness: 0.02, color: 0xa8bc9c }), std({ color: 0x1e4211, roughness: 0.85 })], 0, -0.035, -0.25, { cast: true, recv: true });
  pad.add(barkTube(new THREE.CatmullRomCurve3([V(0, -0.05, -0.3), V(0.1, -0.9, -0.5), V(-0.15, -2.2, -0.2)]), 0.07, 12, 8, std({ color: 0x4a7a2a, roughness: 0.7 })));
  put(pad, new THREE.TorusGeometry(pw * 0.55, 0.04, 8, 64), std({ color: 0x41701e, roughness: 0.7 }), 0, 0.005, -0.25, { rx: Math.PI / 2, cast: true });
  const lotus = new THREE.Group(); lotus.position.set(pw * 0.25, 0, -0.75); pad.add(lotus);
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, p = put(lotus, new THREE.SphereGeometry(0.1, 10, 8), std({ color: k % 2 ? 0xc98aa2 : 0xb86a8c, roughness: 0.65 }), Math.cos(a) * 0.08, 0.1, Math.sin(a) * 0.08); p.scale.set(0.5, 1.4, 0.8); p.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); }
  put(lotus, new THREE.SphereGeometry(0.06, 10, 8), std({ color: 0xffd040, emissive: 0x8a6000, emissiveIntensity: 0.6 }), 0, 0.1, 0);
  // hanging log (soft platform 1, bobs) on vines from the right mangrove
  const log = new THREE.Group(); R.add(log);
  const P1 = st.plats[1], lw = (P1.x1 - P1.x0) * SC;
  const logG = new THREE.CylinderGeometry(0.21, 0.23, lw + 0.2, 16); { const uv = logG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4 / 1.2, uv.getY(i) * (lw + 0.2) / 1.2); }
  const ringT = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#b89a6a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a5a34'; c.lineWidth = 3; for (let r = 6; r < 64; r += 7) { c.beginPath(); c.arc(64, 64, r, 0, 7); c.stroke(); } });
  put(log, logG, [bark, std({ map: ringT, roughness: 0.9 }), std({ map: ringT, roughness: 0.9 })], 0, -0.21, -0.1, { rz: Math.PI / 2, cast: true, recv: true });
  const vineM = std({ color: 0x3a5a1a, roughness: 0.9 });
  for (const dx of [-lw * 0.36, lw * 0.36]) log.add(barkTube(new THREE.CatmullRomCurve3([V(dx, -0.02, -0.1), V(dx + 0.08, 1.4, -0.3), V(dx - 0.05, 3.2, -0.8)]), 0.025, 16, 6, vineM));
  for (const dx of [-0.5, 0.3]) put(log, new THREE.PlaneGeometry(0.4, 0.9), moss, dx, -0.62, 0.05);
  // stilt hut on the right
  const hut = new THREE.Group(); hut.position.set(7.2, WL, -5.6); R.add(hut);
  hut.visible = false;   // a box hut in front of the painted one
  for (const [a, b] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) put(hut, new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), bark, a, 1.2, b);
  put(hut, wbox(2.2, 0.12, 1.8, 1.4), planks, 0, 2.3, 0.1);
  put(hut, wbox(1.7, 1.3, 1.3, 1.2), std({ map: stageTex('planks', 1, 1), color: 0x9a7a5a, roughness: 0.9 }), 0, 3.0, -0.1, { cast: true });
  const roofSh = new THREE.Shape(); roofSh.moveTo(-1.2, 0); roofSh.lineTo(1.2, 0); roofSh.lineTo(0, 1.0); roofSh.closePath();
  const thatch = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#6a5a2a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 700; i++) { c.strokeStyle = `hsla(${40 + Math.random() * 40},${30 + Math.random() * 20}%,${25 + Math.random() * 25}%,.8)`; c.lineWidth = 2; const x = Math.random() * w, y = Math.random() * h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 6, y + 18); c.stroke(); } });
  put(hut, new THREE.ExtrudeGeometry(roofSh, { depth: 1.7, bevelEnabled: false }), std({ map: thatch, roughness: 1, color: 0x9a9a6a }), 0, 3.62, -0.95);
  put(hut, new THREE.PlaneGeometry(0.42, 0.34), glow(0xffb060, 1.6), 0.35, 3.1, 0.555);
  sprite(hut, 0xffa040, 1.2, 1.1, 0.35, 3.1, 0.6, true);
  const hutL = new THREE.PointLight(0xffa850, 4, 5, 1.8); hutL.position.set(0.3, 3.0, 1.2); hut.add(hutL);
  // glowing mushrooms on the roots and posts
  const shrooms = [];
  const mush = (x, y, z, s, col) => { const m = new THREE.Group(); m.position.set(x, y, z); m.scale.setScalar(s); R.add(m); put(m, new THREE.CylinderGeometry(0.03, 0.045, 0.22, 8), std({ color: 0xe8e0d0, roughness: 0.7, emissive: col, emissiveIntensity: 0.2 }), 0, 0.11, 0); const cap = put(m, new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.4 }), 0, 0.2, 0); cap.scale.y = 0.7; shrooms.push(cap); return m; };
  for (const [x, y, z, n, col] of [[-4.0, 0.0, -1.0, 4, 0x3af0d0], [3.95, 0.0, -1.05, 3, 0xb070ff], [-5.3, -1.0, -1.9, 5, 0x3af0d0], [5.0, -0.8, -2.4, 4, 0xb070ff], [-2.2, 2.15, -1.2, 3, 0x3af0d0], [7.0, 0.8, -5.0, 3, 0x3af0d0]]) {
    for (let k = 0; k < n; k++) mush(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, col);
    sprite(R, col, 1.0, 1.0, x, y + 0.2, z + 0.1, true);
  }
  for (const [x, z, col] of [[-4.6, -1.4, 0x3af0d0], [4.6, -1.8, 0xb070ff]]) { const L = new THREE.PointLight(col, 3, 3.5, 1.8); L.position.set(x, 0.3, z + 0.6); R.add(L); }
  // god rays through the canopy
  const rayT = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,240,200,.0)'); gr.addColorStop(0.3, 'rgba(255,230,170,.55)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); const g2 = c.getImageData(0, 0, w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const e = Math.sin(x / w * Math.PI); g2.data[(y * w + x) * 4 + 3] *= e; } c.putImageData(g2, 0, 0); });
  const rays = [];
  for (const [x, z, wd, rot] of [[-3.5, -5, 1.6, -0.45], [-1.0, -7, 2.4, -0.42], [1.8, -6, 1.2, -0.5], [4.5, -9, 2.8, -0.4]]) { const m = put(R, new THREE.PlaneGeometry(wd, 14), new THREE.MeshBasicMaterial({ map: rayT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35, color: 0xffe0a0, fog: false }), x, 3.5, z, { rz: rot }); rays.push(m); }
  // fireflies and dragonflies
  const NF = 80, fPos = new Float32Array(NF * 3), fCol = new Float32Array(NF * 3), flies = [];
  for (let i = 0; i < NF; i++) flies.push({ x: (Math.random() - 0.5) * 18, y: -1 + Math.random() * 4.5, z: 1 - Math.random() * 8, ph: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.6 });
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); fg.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
  const fliesP = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); fliesP.frustumCulled = false; R.add(fliesP);
  const wingM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 1.0, 1.1), transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const dflies = [];
  for (let k = 0; k < 3; k++) {
    const d = new THREE.Group(); R.add(d);
    put(d, new THREE.CylinderGeometry(0.012, 0.008, 0.24, 6), std({ color: 0x1a8a9a, metalness: 0.8, roughness: 0.3, emissive: 0x0a4a5a }), 0, 0, 0, { rz: Math.PI / 2 });
    const wings = [-1, 1].map(s => { const w = new THREE.Group(); d.add(w); put(w, new THREE.PlaneGeometry(0.2, 0.05), wingM, 0.02, 0, s * 0.1, { rx: Math.PI / 2 }); return w; });
    dflies.push({ d, wings, ph: k * 2.1, cx: -2 + k * 2.5, cy: 1 + k * 0.5, cz: -1.5 - k });
    d.visible = false;   // at game scale two flat wing planes read as a floating '=' glyph (9/22 night)
  }
  // lights: golden hour through the canopy
  g.add(new THREE.HemisphereLight(0x8fa4b0, 0x28321f, 0.95));
  sunKey(g, 0xd8c6a0, 0.9, [-6, 6, 5], { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  const rim = new THREE.DirectionalLight(0xff9a48, 1.15); rim.position.set(-4, 2.4, -8); g.add(rim);
  const fill = new THREE.DirectionalLight(0x4a8a86, 0.32); fill.position.set(7, 2, 5); g.add(fill);
  g.userData.embers = null;
  // splashes when a fighter drops into the water (visual only)
  const splashT = canvasTex(128, 128, (c, w, h) => { c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 6; c.beginPath(); c.arc(64, 64, 52, 0, 7); c.stroke(); });
  const splashes = [], lastY = new WeakMap();
  let lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    water.material.uniforms.t.value = t;
    const S = Game.stage;
    if (S && S.id === 'swamp') {
      const a = S.plats[0], b = S.plats[1];
      pad.position.set((a.x0 + a.x1) / 2 * SC, -a.y * SC, 0); log.position.set((b.x0 + b.x1) / 2 * SC, -b.y * SC, 0);
      for (const f of Game.fighters) {
        const py = lastY.get(f); lastY.set(f, f.y);
        if (py != null && py <= -WL / SC && f.y > -WL / SC && f.state !== 'dead') {
          const ring = put(R, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: splashT, transparent: true, depthWrite: false, color: 0xe8fff0 }), f.x * SC, WL + 0.02, 0, { rx: -Math.PI / 2 });
          const plume = sprite(R, 0xffffff, 0.9, 0.8, f.x * SC, WL + 0.3, 0.1, true);
          splashes.push({ ring, plume, t: 0 });
        }
      }
    }
    for (const sp of splashes) { sp.t += dt; const k = sp.t / 0.9; sp.ring.scale.setScalar(0.3 + k * 2.2); sp.ring.material.opacity = Math.max(0, 1 - k); sp.plume.scale.set(0.8, 0.8 + Math.sin(Math.min(1, k * 2) * Math.PI) * 1.4, 1); sp.plume.position.y = WL + 0.3 + k * 0.4; sp.plume.material.opacity = Math.max(0, 1 - k * 1.3); }
    for (let i = splashes.length - 1; i >= 0; i--) if (splashes[i].t > 0.9) { R.remove(splashes[i].ring, splashes[i].plume); splashes[i].ring.geometry.dispose(); splashes.splice(i, 1); }
    for (const tr of trees) tr.strands.forEach((m, i) => { m.rotation.z = Math.sin(t * 0.8 + i) * 0.06; });
    for (const m of mists) { m.position.x += 0.004; if (m.position.x > 18) m.position.x = -18; }
    for (let i = 0; i < NF; i++) { const f = flies[i]; fPos[i * 3] = f.x + Math.sin(t * f.sp + f.ph) * 0.8; fPos[i * 3 + 1] = f.y + Math.sin(t * f.sp * 1.3 + f.ph * 2) * 0.4; fPos[i * 3 + 2] = f.z + Math.cos(t * f.sp * 0.7 + f.ph) * 0.5; const k = Math.max(0, Math.sin(t * 2.2 + f.ph * 3)); fCol[i * 3] = 1.6 * k; fCol[i * 3 + 1] = 1.8 * k; fCol[i * 3 + 2] = 0.5 * k; }
    fg.attributes.position.needsUpdate = true; fg.attributes.color.needsUpdate = true;
    for (const d of dflies) { const u = t * 0.5 + d.ph; d.d.position.set(d.cx + Math.sin(u) * 2.6, d.cy + Math.sin(u * 2.3) * 0.5, d.cz + Math.cos(u * 1.3) * 0.8); d.d.rotation.y = Math.cos(u) > 0 ? 0 : Math.PI; d.wings.forEach((w, i) => { w.rotation.x = Math.sin(t * 60 + i) * 0.5; }); }
    rays.forEach((m, i) => { m.material.opacity = 0.26 + Math.sin(t * 0.5 + i * 1.7) * 0.08; });
    shrooms.forEach((c, i) => { c.material.emissiveIntensity = 1.3 + Math.sin(t * 1.5 + i) * 0.35; });
    lanterns.forEach((L, i) => { L.intensity = 2.8 + Math.sin(t * 9 + i * 3) * 0.3 + Math.sin(t * 5.3 + i) * 0.3; });
  };
  return g;
}

// ---------- Sakura Dojo (photoreal rebuild; makeStage('dojo') is untouched) ----------
function blossomTex() {
  return canvasTex(128, 128, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    for (let k = 0; k < 7; k++) {
      const cx = 24 + Math.random() * 80, cy = 24 + Math.random() * 80, r = 9 + Math.random() * 8, hue = 330 + Math.random() * 20, l = 80 + Math.random() * 12;
      for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2 + Math.random(); c.fillStyle = `hsla(${hue},${60 + Math.random() * 25}%,${l}%,.95)`; c.beginPath(); c.ellipse(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.55, r * 0.38, a, 0, 7); c.fill(); }
      c.fillStyle = 'rgba(200,60,90,.9)'; c.beginPath(); c.arc(cx, cy, 2.5, 0, 7); c.fill();
    }
  });
}
function lantern(R, x, y, z, granite, s = 1) {
  const L = new THREE.Group(); L.position.set(x, y, z); L.scale.setScalar(s); R.add(L);
  put(L, new THREE.CylinderGeometry(0.34, 0.4, 0.14, 6), granite, 0, 0.07, 0, { cast: true });
  put(L, new THREE.CylinderGeometry(0.11, 0.14, 0.62, 8), granite, 0, 0.45, 0, { cast: true });
  put(L, new THREE.CylinderGeometry(0.3, 0.2, 0.12, 6), granite, 0, 0.82, 0);
  put(L, new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6), std({ color: 0x2a2420, roughness: 0.9, emissive: 0xffa040, emissiveIntensity: 0.9 }), 0, 1.03, 0);
  const fire = sprite(L, 0xffb050, 1.5, 0.7, 0, 1.03, 0.15, true);
  const roof = put(L, new THREE.ConeGeometry(0.46, 0.3, 6), granite, 0, 1.33, 0, { cast: true });
  put(L, new THREE.SphereGeometry(0.07, 10, 8), granite, 0, 1.52, 0);
  return fire;
}
function cherry(R, bark, bloomM, x, z, h, s, lean, N = 260) {
  const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); R.add(t);
  const V = (a, b, c) => new THREE.Vector3(a, b, c), ends = [];
  t.add(barkTube(new THREE.CatmullRomCurve3([V(0, -0.3, 0), V(0.25 * lean, h * 0.4, 0.05), V(0.1 * lean, h * 0.75, -0.1)]), 0.2, 16, 10, bark, 0.8));
  for (let k = 0; k < 5; k++) { const a = k * 1.3 + 0.4, L = 1.5 + (k % 3) * 0.5, e = V(0.1 * lean + Math.cos(a) * L * (k % 2 ? 1 : 0.7), h * 0.75 + 0.6 + (k % 3) * 0.35, Math.sin(a) * L * 0.5); t.add(barkTube(new THREE.CatmullRomCurve3([V(0.1 * lean, h * 0.62, -0.05), V((0.1 * lean + e.x) * 0.5, h * 0.75 + 0.5, e.z * 0.4), e]), 0.08, 12, 7, bark, 0.8)); ends.push(e); }
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.62), bloomM, N); im.castShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < N; i++) { const e = ends[i % ends.length], r = Math.pow(Math.random(), 0.6) * 1.3; const a = Math.random() * 6.28, b = Math.random() * 3.14; p.set(e.x + Math.cos(a) * Math.sin(b) * r * 1.3, e.y + Math.cos(b) * r * 0.6 + 0.15, e.z + Math.sin(a) * Math.sin(b) * r); e3.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, Math.random() * 6.28); q.setFromEuler(e3); const k = 0.6 + Math.random() * 0.8; sc.set(k, k, k); m4.compose(p, q, sc); im.setMatrixAt(i, m4); }
  t.add(im);
  return t;
}
function buildDojoNew(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC, zF = 1.35, zBk = -1.45;
  scene.fog = new THREE.Fog(0x7c6a98, 16, 72);
  g.add(skyDome(0x2a2a5a, 0xd89a8a, 0x9a8ab0));
  const floor = tileMat('dojofloor', { m: { roughness: 0.3, metalness: 0.0, envMapIntensity: 1.2 } });
  const granite = tileMat('granite', { m: { roughness: 0.85 } });
  // (9/22 night, core map) the keyaki beams read as black bands under the stage and over the platforms: warmer, lighter
  // wood with a faint lantern-lit glow so the grain shows at night
  const keyaki = std({ color: 0x9a6444, roughness: 0.62, map: noiseTex('#6a4430', ['#3a2216', '#8a5a3e', '#50301e'], 1200), emissive: 0x2a140a, emissiveIntensity: 0.6 });
  const lacquer = std({ color: 0x6a1e14, roughness: 0.45, metalness: 0.05 });
  const brass = std({ color: 0xc8a050, roughness: 0.35, metalness: 1 });
  const bark = tileMat('bark', { m: { roughness: 0.9, color: 0x6a5a58 } });
  // the stage: polished boards on a timber frame that juts out over the valley
  put(R, wbox(W, 0.14, zF - zBk, 2.0), [keyaki, keyaki, floor, keyaki, keyaki, keyaki], CX, -0.07, (zF + zBk) / 2, { recv: true });
  put(R, new THREE.BoxGeometry(W + 0.12, 0.3, 0.2), keyaki, CX, -0.29, zF - 0.02, { cast: true });
  for (let x = M.x0 * SC + W / 16; x < M.x1 * SC; x += W / 8) { put(R, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), brass, x, -0.29, zF + 0.09, { rx: Math.PI / 2 }); put(R, new THREE.TorusGeometry(0.07, 0.012, 6, 20), brass, x, -0.29, zF + 0.09); }
  put(R, new THREE.BoxGeometry(W + 0.12, 0.2, 0.18), keyaki, CX, -0.24, zBk + 0.1);
  // kakezukuri: a lattice of pillars and tie beams dropping into the mist
  for (let x = M.x0 * SC + 0.2; x <= M.x1 * SC - 0.1; x += (W - 0.4) / 6) for (const z of [zF - 0.2, (zF + zBk) / 2, zBk + 0.25]) put(R, new THREE.CylinderGeometry(0.13, 0.14, 11, 12), keyaki, x, -5.8, z, { cast: z > 0 });
  for (const y of [-1.3, -2.8, -4.3, -5.8]) for (const z of [zF - 0.2, (zF + zBk) / 2, zBk + 0.25]) put(R, new THREE.BoxGeometry(W - 0.1, 0.16, 0.09), keyaki, CX, y, z);
  // the terrace behind: granite retaining wall, paving, the back railing
  put(R, wbox(60, 12, 1.2, 1.6), granite, CX, -6.02, zBk - 0.62);
  put(R, wbox(60, 0.04, 14, 1.6), granite, CX, -0.02, zBk - 7, { recv: true });
  for (let x = M.x0 * SC; x <= M.x1 * SC + 0.01; x += W / 9) put(R, new THREE.BoxGeometry(0.08, 0.55, 0.08), lacquer, x, 0.275, zBk + 0.12, { cast: true });
  for (const y of [0.52, 0.3]) put(R, new THREE.BoxGeometry(W, 0.05, 0.06), lacquer, CX, y, zBk + 0.12);
  for (const x of [M.x0 * SC, M.x1 * SC]) put(R, new THREE.SphereGeometry(0.07, 12, 8), brass, x, 0.6, zBk + 0.12);
  // verandas (soft platforms) on posts, a red paper lantern under each
  const chochin = [];
  for (const P of st.plats) {
    const x = (P.x0 + P.x1) / 2 * SC, w = (P.x1 - P.x0) * SC, y = -P.y * SC;
    put(R, wbox(w, 0.1, 1.45, 2.0), [keyaki, keyaki, floor, keyaki, keyaki, keyaki], x, y - 0.05, -0.28, { cast: true, recv: true });
    put(R, new THREE.BoxGeometry(w + 0.06, 0.12, 0.1), keyaki, x, y - 0.12, 0.46);
    for (const s of [-1, 1]) { put(R, new THREE.BoxGeometry(0.1, y, 0.1), keyaki, x + s * (w / 2 - 0.12), y / 2, -0.9, { cast: true }); beam(R, keyaki, new THREE.Vector3(x + s * (w / 2 - 0.12), y - 0.6, -0.9), new THREE.Vector3(x + s * (w / 2 - 0.12), y - 0.1, -0.1), 0.035); }
    for (let k = 0; k <= 4; k++) put(R, new THREE.BoxGeometry(0.05, 0.3, 0.05), lacquer, x - w / 2 + 0.05 + k * (w - 0.1) / 4, y + 0.15, -0.95);
    put(R, new THREE.BoxGeometry(w, 0.04, 0.06), lacquer, x, y + 0.3, -0.95);
    const lan = new THREE.Group(); lan.position.set(x, y - 0.55, -0.55); R.add(lan);
    put(lan, new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), keyaki, 0, 0.3, 0);
    const pts = []; for (let k = 0; k <= 12; k++) { const a = k / 12; pts.push(new THREE.Vector2(0.05 + Math.sin(a * Math.PI) * 0.16, (a - 0.5) * 0.46)); }
    put(lan, new THREE.LatheGeometry(pts, 24), std({ color: 0xd8302a, roughness: 0.7, emissive: 0xff4020, emissiveIntensity: 0.9, side: THREE.DoubleSide }), 0, 0, 0);
    for (const yy of [-0.24, 0.24]) put(lan, new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16), std({ color: 0x141010, roughness: 0.6 }), 0, yy, 0);
    sprite(lan, 0xff7a40, 1.2, 1.1, 0, 0, 0.1, true);
    const L = new THREE.PointLight(0xff8a50, 2.4, 3.5, 1.8); L.position.set(0, -0.1, 0.4); lan.add(L);
    chochin.push({ lan, L, ph: x });
  }
  // stone lanterns and cherry trees on the terrace
  const fires = [lantern(R, CX - 3.5, 0, -2.4, granite), lantern(R, CX + 3.6, 0, -2.5, granite), lantern(R, CX - 7.2, 0, -4.2, granite, 1.1), lantern(R, CX + 7.6, 0, -4.6, granite, 1.1), lantern(R, CX - 1.4, 0, -8.5, granite, 1.2), lantern(R, CX + 2.8, 0, -9, granite, 1.2)];
  for (const [x, z] of [[-3.5, -2.4], [3.6, -2.5]]) { const L = new THREE.PointLight(0xffa050, 3, 3.5, 1.8); L.position.set(CX + x, 1.1, z + 0.5); R.add(L); }
  const bloomM = std({ map: blossomTex(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8, color: 0xffe0ea, emissive: 0x3a1020, emissiveIntensity: 0.35 });
  cherry(R, bark, bloomM, CX - 6.4, -2.6, 3.2, 1.05, 1, 320); cherry(R, bark, bloomM, CX + 6.8, -3.3, 3.4, 1.1, -1, 320); cherry(R, bark, bloomM, CX - 11, -6.5, 3.6, 1.3, 1, 260); cherry(R, bark, bloomM, CX + 12, -8, 3.6, 1.3, -1, 260);
  // mist in the valley under the stage
  const mistT = canvasTex(256, 128, (c, w, h) => { for (let i = 0; i < 14; i++) { const x = 30 + Math.random() * 196, y = 40 + Math.random() * 50, r = 30 + Math.random() * 45, gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); } });
  const mists = [];
  for (let i = 0; i < 18; i++) { const m = put(R, new THREE.PlaneGeometry(9, 3), new THREE.MeshBasicMaterial({ map: mistT, transparent: true, depthWrite: false, opacity: 0.4, color: 0xd8c8e8, fog: false }), -20 + i * 2.4, -2.6 - Math.random() * 2.5, 2.2 - Math.random() * 4); mists.push(m); }
  const veil = put(R, new THREE.PlaneGeometry(120, 30), new THREE.MeshBasicMaterial({ map: canvasTex(8, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(160,140,190,0)'); gr.addColorStop(0.35, 'rgba(150,130,180,.85)'); gr.addColorStop(1, 'rgba(110,95,140,1)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }), transparent: true, depthWrite: false, fog: false }), 0, -14, -12);
  // falling petals
  const NP = 180, petalIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0xffc8d8, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x401828, emissiveIntensity: 0.4 }), NP), petals = [];
  petalIM.frustumCulled = false; R.add(petalIM);
  for (let i = 0; i < NP; i++) petals.push({ x: (Math.random() - 0.5) * 20, y: Math.random() * 7, z: 1.5 - Math.random() * 7, s: 0.3 + Math.random() * 0.4, ph: Math.random() * 6.28, r: Math.random() * 6 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), pv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  // lights: dusk sky, low warm sun from the right, lantern glow
  g.add(new THREE.HemisphereLight(0xa0a8e0, 0x4a3020, 0.6));
  sunKey(g, 0xffc8a0, 1.5, [6, 6, 6], { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  const rim = new THREE.DirectionalLight(0xff9a6a, 1.5); rim.position.set(5, 3, -8); g.add(rim);
  const cool = new THREE.DirectionalLight(0x8a90ff, 0.35); cool.position.set(-6, 4, 4); g.add(cool);
  g.userData.embers = null;
  let lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (let i = 0; i < NP; i++) {
      const p = petals[i]; p.y -= p.s * dt; p.x += (0.25 + Math.sin(t * 0.7 + p.ph) * 0.3) * dt; if (p.y < -2.5) { p.y = 6.5 + Math.random(); p.x = (Math.random() - 0.5) * 20; }
      pv.set(p.x + Math.sin(t * 1.3 + p.ph) * 0.2, p.y, p.z); e3.set(t * 2 + p.r, t * 1.3 + p.ph, t * 1.7 + p.r); q.setFromEuler(e3); m4.compose(pv, q, one); petalIM.setMatrixAt(i, m4);
    }
    petalIM.instanceMatrix.needsUpdate = true;
    for (const c of chochin) { c.lan.rotation.z = Math.sin(t * 0.9 + c.ph) * 0.05; c.L.intensity = 2.2 + Math.sin(t * 7 + c.ph) * 0.3; }
    fires.forEach((f, i) => { f.material.opacity = 0.85 + Math.sin(t * 11 + i * 2) * 0.1; });
    for (const m of mists) { m.position.x += 0.003; if (m.position.x > 20) m.position.x = -20; }
  };
  return g;
}

// ---------- shared bits for the later stages ----------
function marbleTex(base, vein) {
  return canvasTex(512, 512, (c, W, H) => {
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * W, Math.random() * H, 6, 6); }
    for (let k = 0; k < 14; k++) { c.strokeStyle = vein; c.globalAlpha = 0.15 + Math.random() * 0.35; c.lineWidth = 0.6 + Math.random() * 2.2; let x = Math.random() * W, y = Math.random() * H; c.beginPath(); c.moveTo(x, y); for (let s = 0; s < 14; s++) { x += (Math.random() - 0.3) * 60; y += (Math.random() - 0.5) * 40; c.lineTo(x, y); } c.stroke(); }
    c.globalAlpha = 1; c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.strokeRect(0, 0, W, H);
  }, [1, 1]);
}
function confetti(R, n, cols, area) {
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.04), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, emissive: 0x202020 }), n); im.frustumCulled = false; R.add(im);
  const bits = [], col = new THREE.Color();
  for (let i = 0; i < n; i++) { bits.push({ x: (Math.random() - 0.5) * area[0], y: Math.random() * area[1], z: area[2] - Math.random() * area[3], s: 0.25 + Math.random() * 0.45, ph: Math.random() * 6.28 }); im.setColorAt(i, col.set(cols[i % cols.length])); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), pv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return (t, dt) => {
    for (let i = 0; i < n; i++) { const b = bits[i]; b.y -= b.s * dt; if (b.y < -3) { b.y = area[1]; b.x = (Math.random() - 0.5) * area[0]; } pv.set(b.x + Math.sin(t + b.ph) * 0.3, b.y, b.z); e3.set(t * 3 + b.ph, t * 2 + b.ph, t); q.setFromEuler(e3); m4.compose(pv, q, one); im.setMatrixAt(i, m4); }
    im.instanceMatrix.needsUpdate = true;
  };
}
function cableUp(R, mat, x, y, z, top = 9) { put(R, new THREE.CylinderGeometry(0.008, 0.008, top - y, 4), mat, x, (top + y) / 2, z); }

// ---------- Trading Floor ----------
function buildFloor(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x4a3a2a, 20, 80);
  g.add(skyDome(0x2a2018, 0x6a5038, 0x2a2018));
  const marble = std({ map: marbleTex('#cfc4b2', '#5a4a40'), roughness: 0.32, metalness: 0.05, envMapIntensity: 0.8 });
  const marbleDark = std({ map: marbleTex('#3a3430', '#b8a890'), roughness: 0.25 });
  const brass = std({ color: 0xd8a848, roughness: 0.28, metalness: 1 });
  // the balcony: marble floor, gilded fascia with a live ticker, balustrade at the back
  put(R, wbox(W, 0.2, 2.9, 1.6), [marbleDark, marbleDark, marble, marbleDark, marbleDark, marbleDark], CX, -0.1, -0.25, { recv: true });
  put(R, new THREE.BoxGeometry(W + 0.1, 0.06, 0.1), brass, CX, -0.03, 1.23);
  const tick = tickerTex(); tick.wrapS = THREE.RepeatWrapping; tick.repeat.set(1.2, 1);
  put(R, new THREE.PlaneGeometry(W, 0.26), new THREE.MeshBasicMaterial({ map: tick, color: new THREE.Color(1.5, 1.5, 1.5) }), CX, -0.26, 1.21);
  put(R, new THREE.BoxGeometry(W + 0.1, 0.05, 0.1), brass, CX, -0.42, 1.23);
  put(R, wbox(W - 0.1, 0.9, 2.6, 1.6), marbleDark, CX, -0.92, -0.3);
  for (let x = M.x0 * SC + 0.1; x <= M.x1 * SC; x += 0.22) { const b = put(R, new THREE.CylinderGeometry(0.035, 0.05, 0.5, 10), marble, x, 0.25, -1.55); }
  put(R, new THREE.BoxGeometry(W + 0.1, 0.1, 0.22), marble, CX, 0.55, -1.55, { cast: true });
  put(R, new THREE.BoxGeometry(W + 0.1, 0.06, 0.2), marble, CX, 0.03, -1.55);
  for (const x of [M.x0 * SC, M.x1 * SC]) { put(R, wbox(0.32, 0.8, 0.32, 1), marble, x, 0.4, -1.55, { cast: true }); put(R, new THREE.SphereGeometry(0.16, 16, 12), brass, x, 0.92, -1.55); }
  // hanging ticker boards (soft platforms 0, 1): stand on top, candle charts on the face
  const charts = [], chainM = std({ color: 0x8a7040, roughness: 0.4, metalness: 1 });
  for (const P of st.plats.slice(0, 2)) {
    const x = (P.x0 + P.x1) / 2 * SC, w = (P.x1 - P.x0) * SC, y = -P.y * SC;
    put(R, wbox(w, 0.5, 0.55, 0.6), [brass, brass, std({ color: 0x1a1a22, roughness: 0.4, metalness: 0.8 }), brass, brass, brass], x, y - 0.25, -0.1, { cast: true, recv: true });
    const ct = candleTex(); charts.push(ct);
    put(R, new THREE.PlaneGeometry(w - 0.1, 0.42), new THREE.MeshBasicMaterial({ map: ct, color: new THREE.Color(1.3, 1.3, 1.3) }), x, y - 0.25, 0.18);
    for (const s of [-1, 1]) cableUp(R, chainM, x + s * (w / 2 - 0.15), y, -0.1);
  }
  // the opening-bell gantry on top (soft platform 2)
  const P2 = st.plats[2], gx = (P2.x0 + P2.x1) / 2 * SC, gw = (P2.x1 - P2.x0) * SC, gy = -P2.y * SC;
  put(R, wbox(gw, 0.12, 1.3, 0.8), [brass, brass, marble, brass, brass, brass], gx, gy - 0.06, -0.3, { cast: true, recv: true });
  for (let k = 0; k <= 6; k++) put(R, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), brass, gx - gw / 2 + k * gw / 6, gy + 0.2, -0.92);
  put(R, new THREE.BoxGeometry(gw, 0.04, 0.04), brass, gx, gy + 0.4, -0.92);
  const bellPts = []; for (let k = 0; k <= 10; k++) { const a = k / 10; bellPts.push(new THREE.Vector2(0.08 + Math.pow(a, 2.2) * 0.24, 0.42 - a * 0.42)); }
  const bell = put(R, new THREE.LatheGeometry(bellPts, 28), std({ color: 0xc89838, roughness: 0.25, metalness: 1, side: THREE.DoubleSide }), gx, gy + 0.62, -0.75, { cast: true });
  put(R, new THREE.BoxGeometry(0.9, 0.05, 0.05), brass, gx, gy + 1.08, -0.75);
  for (const s of [-1, 1]) { put(R, new THREE.BoxGeometry(0.05, 1.08, 0.05), brass, gx + s * 0.45, gy + 0.54, -0.75); cableUp(R, chainM, gx + s * (gw / 2 - 0.1), gy, -0.3); }
  // a ring ticker around the hall (the painted plate carries the columns and the big chart walls)
  const walls = [];
  const ring = tickerTex(); ring.wrapS = THREE.RepeatWrapping; ring.repeat.set(-3, 1);
  put(R, new THREE.CylinderGeometry(22, 22, 0.55, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76), new THREE.MeshBasicMaterial({ map: ring, color: new THREE.Color(1.4, 1.4, 1.4), side: THREE.BackSide }), CX, 6.8, 6);
  const rain = confetti(R, 150, ['#ffffff', '#f4f0e0', '#3dffa0', '#ffd23f', '#ff4d7a'], [20, 9, 1.5, 9]);
  // chandeliers
  for (const [x, z] of [[-3.2, -5], [3.2, -5.5]]) {
    const ch = new THREE.Group(); ch.position.set(x, 6.4, z); R.add(ch);
    put(ch, new THREE.TorusGeometry(0.6, 0.04, 8, 32), brass, 0, 0, 0, { rx: Math.PI / 2 }); put(ch, new THREE.TorusGeometry(0.35, 0.03, 8, 24), brass, 0, 0.3, 0, { rx: Math.PI / 2 });
    for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; sprite(ch, 0xffd9a0, 1.4, 0.35, Math.cos(a) * 0.6, 0.08, Math.sin(a) * 0.6, true); }
    sprite(ch, 0xffc880, 1.0, 2.6, 0, 0.1, 0, true); cableUp(ch, chainM, 0, 0.3, 0, 4);
  }
  // lights: warm chandeliers above, cool screen glow
  g.add(new THREE.HemisphereLight(0xffe0b8, 0x2a2018, 0.45));
  sunKey(g, 0xffe2b8, 1.35, [-3, 10, 7]);
  const rimA = new THREE.DirectionalLight(0x6ab8ff, 1.0); rimA.position.set(6, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0xffb060, 0.9); rimB.position.set(-6, 3, -6); g.add(rimB);
  g.userData.embers = null;
  let lastT = 0, lastC = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    tick.offset.x = (t * 0.05) % 1; ring.offset.x = (t * 0.02) % 1; rain(t, dt);
    if (t - lastC > 0.6) { lastC = t; for (const c of charts.concat(walls)) c.userData.step(); }
    bell.rotation.z = Math.sin(t * 1.3) * 0.05;
  };
  return g;
}

// ---------- Bullet Express ----------
function trainCar(R, paint, glass, dark, stripe, x0, x1, scale) {
  const car = new THREE.Group(); R.add(car);
  const L = x1 - x0, cx = (x0 + x1) / 2;
  // profile across the car (z, y): flat roof, rounded shoulders, straight sides
  const sh = new THREE.Shape(), hw = 1.12, pts = [];
  for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI / 2; pts.push([hw - 0.45 + Math.sin(a) * 0.45, -0.45 + Math.cos(a) * 0.45]); }
  sh.moveTo(-hw + 0.45, 0); pts.slice().reverse().forEach(([z, y]) => sh.lineTo(-z, y)); sh.lineTo(-hw, -2.7); sh.lineTo(hw, -2.7); pts.forEach(([z, y]) => sh.lineTo(z, y));
  const gm = new THREE.ExtrudeGeometry(sh, { depth: L - 0.1, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3 });
  put(car, gm, paint, x1 - 0.05, 0, 0, { ry: -Math.PI / 2, cast: true, recv: true });
  put(car, new THREE.BoxGeometry(L - 0.3, 0.42, 0.02), glass, cx, -1.25, hw + 0.012);
  put(car, new THREE.BoxGeometry(L - 0.5, 0.012, 1.1), std({ color: 0x23262f, roughness: 0.8, metalness: 0.3 }), cx, 0.006, 0, { recv: true });
  for (let x = x0 + 0.7; x < x1 - 0.5; x += 1.1) put(car, new THREE.BoxGeometry(0.5, 0.05, 0.3), std({ color: 0x3a3e4a, roughness: 0.5, metalness: 0.8 }), x, 0.03, -0.72);
  put(car, new THREE.BoxGeometry(L - 0.2, 0.02, 0.02), stripe, cx, -0.2, hw - 0.12);
  put(car, new THREE.BoxGeometry(L - 0.1, 0.06, 0.02), stripe, cx, -1.62, hw + 0.012);
  put(car, new THREE.BoxGeometry(L - 0.1, 1.0, 0.02), std({ color: 0x141a30, roughness: 0.3, metalness: 0.7 }), cx, -2.18, hw + 0.01);
  put(car, new THREE.BoxGeometry(L - 0.1, 0.03, 0.02), stripe, cx, -0.92, hw + 0.012);
  for (const x of [x0 + 0.9, x1 - 0.9]) put(car, new THREE.BoxGeometry(0.6, 1.4, 0.02), dark, x, -1.85, hw + 0.014);
  // panel seams and door frames (9/22 night: the sides read as flat grey slabs)
  { const seamM = std({ color: 0x2a2e3a, roughness: 0.6, metalness: 0.5 }), fr = std({ color: 0xc8ccd8, roughness: 0.25, metalness: 0.9 });
    for (let x = x0 + 1.9; x < x1 - 1.6; x += 1.45) put(car, new THREE.BoxGeometry(0.018, 1.25, 0.02), seamM, x, -0.95, hw + 0.016);
    for (const x of [x0 + 0.9, x1 - 0.9]) for (const s of [-1, 1]) put(car, new THREE.BoxGeometry(0.035, 1.45, 0.03), fr, x + s * 0.32, -1.85, hw + 0.02);
    put(car, new THREE.BoxGeometry(L - 0.4, 0.035, 0.02), seamM, cx, -0.55, hw + 0.016); }
  for (const x of [x0 + 1.2, x1 - 1.2]) { put(car, new THREE.BoxGeometry(2.0, 0.5, 1.9), dark, x, -2.95, 0); for (const dx of [-0.6, 0.6]) for (const s of [-1, 1]) put(car, new THREE.CylinderGeometry(0.28, 0.28, 0.1, 18), std({ color: 0x3a3a40, roughness: 0.4, metalness: 0.9 }), x + dx, -3.05, s * 0.8, { rx: Math.PI / 2 }); }
  return car;
}
function buildTrain(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, speed = 34;
  scene.fog = new THREE.Fog(0x1a1040, 18, 90);
  g.add(skyDome(0x05030f, 0x1c0f48, 0x2a0a4a));
  const paint = std({ color: 0x9aa4bc, roughness: 0.22, metalness: 0.75, envMapIntensity: 1.1 });
  const winT = canvasTex(512, 64, (c, w, h) => { c.fillStyle = '#0a0c18'; c.fillRect(0, 0, w, h); for (let x = 6; x < w; x += 32) { const lit = Math.random() < 0.85; c.fillStyle = lit ? `rgba(255,${200 + Math.random() * 40},${140 + Math.random() * 60},.9)` : '#1a1c2a'; c.fillRect(x, 10, 24, h - 20); } });
  winT.wrapS = THREE.RepeatWrapping; winT.repeat.set(3, 1);
  const glass = std({ map: winT, emissive: 0xffffff, emissiveMap: winT, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.5 });
  const dark = std({ color: 0x1a1c26, roughness: 0.4, metalness: 0.7 }), stripe = glow(0xff4fd8, 2.4);
  // the middle car and its neighbours (their roofs are soft platforms 0 and 1)
  const cars = [[M.x0 * SC, M.x1 * SC], [st.plats[0].x0 * SC, st.plats[0].x1 * SC], [st.plats[1].x0 * SC, st.plats[1].x1 * SC], [-12.6, -8.3], [8.3, 12.6]];
  cars.forEach(([a, b]) => trainCar(R, paint, glass, dark, stripe, a, b));
  for (const x of [(M.x0 * SC + st.plats[0].x1 * SC) / 2, (M.x1 * SC + st.plats[1].x0 * SC) / 2, -8.05, 8.05]) put(R, new THREE.CylinderGeometry(0.85, 0.85, 0.7, 20, 6, true), std({ color: 0x14141a, roughness: 0.9, side: THREE.DoubleSide }), x, -1.5, 0, { rz: Math.PI / 2, s: [1, 1, 1.25] });
  // pantograph: its collector head is soft platform 2
  const P2 = st.plats[2], fx = (P2.x0 + P2.x1) / 2 * SC, fw = (P2.x1 - P2.x0) * SC, fy = -P2.y * SC;
  put(R, wbox(1.1, 0.16, 0.7, 1), dark, fx, 0.08, -0.75, { cast: true });
  for (const s2 of [-1, 1]) put(R, new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), std({ color: 0xc8c0a0, roughness: 0.4 }), fx + s2 * 0.4, 0.26, -0.75);
  const panto = new THREE.Group(); panto.position.set(fx, 0.18, -0.6); R.add(panto);
  const armM = std({ color: 0x2a2c34, roughness: 0.35, metalness: 0.9 });
  for (const dz of [-0.18, 0.18]) { beam(panto, armM, new THREE.Vector3(-0.42, 0, dz), new THREE.Vector3(0.18, fy * 0.5 - 0.1, dz), 0.03); beam(panto, armM, new THREE.Vector3(0.18, fy * 0.5 - 0.1, dz), new THREE.Vector3(-0.1, fy - 0.26, dz), 0.025); }
  put(R, wbox(fw, 0.06, 1.2, 0.5), [armM, armM, std({ map: canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#3a3c44'; c.fillRect(0, 0, w, h); c.fillStyle = '#1a1c22'; for (let y = 4; y < h; y += 12) for (let x = 4; x < w; x += 12) c.fillRect(x, y, 7, 7); }), roughness: 0.5, metalness: 0.8 }), armM, stripe, armM], fx, fy - 0.03, -0.25, { cast: true, recv: true });
  for (const s2 of [-1, 1]) put(R, new THREE.BoxGeometry(0.04, 0.14, 1.2), armM, fx + s2 * fw / 2, fy - 0.1, -0.25);
  const wireM = std({ color: 0x2a2a30, roughness: 0.6, metalness: 0.8 });
  put(R, new THREE.CylinderGeometry(0.012, 0.012, 80, 4), wireM, 0, fy + 0.05, -0.85, { rz: Math.PI / 2 });
  const spark = sprite(R, 0x9ad8ff, 2, 0.5, fx, fy + 0.03, -0.8);
  // track: rails, scrolling sleepers
  for (const z of [-0.7, 0.7]) put(R, new THREE.BoxGeometry(80, 0.08, 0.08), std({ color: 0x8a8a90, roughness: 0.3, metalness: 1 }), 0, -3.36, z);
  const NS = 70, sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.1, 2.0), std({ color: 0x3a3430, roughness: 0.9 }), NS); R.add(sleepers);
  const m4 = new THREE.Matrix4();
  // scrolling world: catenary masts, two layers of city blocks, light streaks
  const masts = [];
  for (let k = 0; k < 5; k++) { const m = new THREE.Group(); m.position.set(-40 + k * 18, 0, -3.2); R.add(m); put(m, new THREE.BoxGeometry(0.22, 7, 0.22), dark, 0, 0, 0); put(m, new THREE.BoxGeometry(0.1, 0.1, 2.4), dark, 0, fy + 0.12, 1.2); sprite(m, 0xff3040, 1.8, 0.3, 0, 3.55, 0.12); masts.push(m); }
  const facMat = tileMat('facade', { glow: 0.55, m: { roughness: 0.4, metalness: 0.5, color: 0x8a8aa8 } });
  const layers = [];
  for (const [z, n, spd, hmin, hmax] of []) {
    const L = []; for (let k = 0; k < n; k++) { const w = 2 + Math.random() * 3, h = hmin + Math.random() * (hmax - hmin); const b = put(R, wbox(w, h + 20, 2.5, 2.6, k * 0.3), facMat, -60 + k * (120 / n), h / 2 - 10 - 3, z); b.userData.w = w; L.push(b); if (k % 3 === 0) put(b, new THREE.BoxGeometry(w + 0.05, 0.08, 2.55), glow(['#ff4fd8', '#22e6ff', '#ffd23f'][k % 3], 2.2), 0, (h + 20) / 2 - 0.2, 0); }
    layers.push({ L, spd });
  }
  const streakT = canvasTex(256, 16, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.8, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 4, w, 8); });
  const streaks = [];
  for (let k = 0; k < 26; k++) { const m = put(R, new THREE.PlaneGeometry(6 + Math.random() * 8, 0.06), glowA([0xff4fd8, 0x22e6ff, 0xffd23f, 0xffffff][k % 4], 1.1, 0.6, streakT), (Math.random() - 0.5) * 60, k % 2 ? -3.2 + Math.random() * 1.6 : 4.2 + Math.random() * 3, -5 - Math.random() * 14); streaks.push({ m, v: 40 + Math.random() * 40 }); }
  // tunnel: every so often the world goes dark and tunnel lamps rip past
  const tun = new THREE.Group(); tun.position.set(200, 0, 0); R.add(tun);
  put(tun, new THREE.BoxGeometry(60, 14, 0.4), std({ color: 0x0c0c12, roughness: 0.9 }), 0, 1, -2.4);
  put(tun, new THREE.BoxGeometry(60, 0.4, 6), std({ color: 0x0c0c12, roughness: 0.9 }), 0, 4.6, 0.3);
  for (let k = 0; k < 20; k++) { put(tun, new THREE.BoxGeometry(0.8, 0.08, 0.05), glow(0xffc070, 3), -30 + k * 3, 3.2, -2.18); }
  const tunLight = new THREE.PointLight(0xffb060, 0, 10, 1.6); tunLight.position.set(0, 3, 1); R.add(tunLight);
  // lights
  g.add(new THREE.HemisphereLight(0x7a70d0, 0x100818, 0.55));
  const key = sunKey(g, 0xd0d8ff, 1.3, [-4, 9, 7], { left: -12, right: 12, top: 7, bottom: -4, near: 1, far: 40 });
  const rimA = new THREE.DirectionalLight(0xff4fd8, 1.3); rimA.position.set(6, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0x22e6ff, 1.2); rimB.position.set(-6, 3, -6); g.add(rimB);
  g.userData.embers = null;
  let lastT = 0, tunT = 9;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    const off = (t * speed) % 0.8;
    for (let i = 0; i < NS; i++) { m4.makeTranslation(-28 + i * 0.8 - off, -3.44, 0); sleepers.setMatrixAt(i, m4); }
    sleepers.instanceMatrix.needsUpdate = true;
    for (const m of masts) { m.position.x -= speed * dt; if (m.position.x < -45) m.position.x += 90; }
    for (const ly of layers) for (const b of ly.L) { b.position.x -= speed * ly.spd * dt; if (b.position.x < -62) b.position.x += 124; }
    for (const s of streaks) { s.m.position.x -= s.v * dt; if (s.m.position.x < -40) s.m.position.x = 40 + Math.random() * 20; }
    spark.material.opacity = Math.random() < 0.15 ? 1 : 0.35;
    tunT -= dt;
    if (tunT < 0) { tun.position.x -= speed * 1.4 * dt; if (tun.position.x < -110) { tun.position.x = 200; tunT = 12 + Math.random() * 6; } }
    else if (tun.position.x > 100) tun.position.x = 100;
    const inside = Math.abs(tun.position.x) < 30; key.intensity = inside ? 0.5 : 1.3; tunLight.intensity = inside ? 6 + Math.sin(t * 40) * 3 : 0;
  };
  return g;
}

// ---------- Frozen Peak ----------
function snowTex() {
  return canvasTex(512, 512, (c, W, H) => { c.fillStyle = '#e8f0fa'; c.fillRect(0, 0, W, H); for (let i = 0; i < 5000; i++) { const b = 200 + Math.random() * 55; c.fillStyle = `rgba(${b - 20},${b - 8},${b + 10},${Math.random() * 0.35})`; c.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 4); } for (let i = 0; i < 300; i++) { c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); } }, [1, 1]);
}
function auroraMat(c1, c2) {
  return new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, a: { value: new THREE.Color(c1) }, b: { value: new THREE.Color(c2) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; uniform float t; void main(){ vUv = uv; vec3 p = position; p.z += sin(p.x*.15 + t*.4)*3.; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.); }',
    fragmentShader: NOISE + `uniform float t; uniform vec3 a, b; varying vec2 vUv;
      void main(){ float n = fbm(vec2(vUv.x*8. + t*.08, t*.05)); float rays = fbm(vec2(vUv.x*40. + n*6., t*.2));
        float band = smoothstep(0., .25, vUv.y) * (1. - smoothstep(.4, 1., vUv.y)) * (.35 + .65*rays) * smoothstep(.2,.6,n + .2);
        band *= smoothstep(0., .18, vUv.x) * (1. - smoothstep(.82, 1., vUv.x));   // soft ends: the curtain was a rectangle with hard sides (9/22 night)
        vec3 col = mix(a, b, vUv.y*1.2 + n*.3); gl_FragColor = vec4(col * band * 1.05, 1.); }`,
  });
}
function buildPeak(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x2a3a5c, 16, 72);
  g.add(skyDome(0x040818, 0x1a2a50, 0x3a4a70));
  const snow = std({ map: snowTex(), roughness: 0.75, color: 0xd8e0ee }), granite = tileMat('granite', { m: { roughness: 0.85, color: 0x9aa8c0 } });
  const rock = std({ map: stageTex('basalt', 1, 1), color: 0x7a88a8, roughness: 0.9, flatShading: true });
  // the rocks you can see: welded + smooth-shaded, frost grey (were black low-poly facets, 9/22 night)
  const rockS = std({ color: 0x8a96ae, roughness: 0.82, metalness: 0.02 });
  const smoothRock = (r, d, j, sd) => { const gg = mergeVertices(rockGeo(r, 2, j, sd).deleteAttribute('normal').deleteAttribute('uv'), 1e-3); gg.computeVertexNormals(); return gg; };
  const ice = std({ color: 0x8ad8ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72, emissive: 0x2a8aff, emissiveIntensity: 0.9 });
  // summit slab: stone under a snow cap, a rounded drift along the front
  put(R, wbox(W, 0.5, 2.9, 1.6), [granite, granite, snow, granite, granite, granite], CX, -0.25, -0.2, { recv: true });
  put(R, new THREE.CylinderGeometry(0.16, 0.16, W + 0.2, 16), snow, CX, -0.06, 1.2, { rz: Math.PI / 2, s: [1, 1, 0.8] });
  for (const s of [-1, 1]) put(R, new THREE.SphereGeometry(0.3, 16, 12), snow, CX + s * (W / 2), -0.1, 0.2, { s: [0.6, 0.45, 3.2] });
  { const x0 = M.x0 * SC + 0.3, x1 = M.x1 * SC - 0.3, n = Math.max(3, Math.round((x1 - x0) / 0.6));   // rubble(), smooth
    for (let i = 0; i < n; i++) { const t = i / (n - 1), x = x0 + (x1 - x0) * t, taper = 1 - Math.abs(t - 0.5) * 1.4, r = 0.35 + taper * 0.3;
      const bb = put(R, smoothRock(r, 1, 0.3, 31 + i), rockS, x, -0.5 - r * 0.9 * (0.8 + taper), -0.2 + ((i % 3) - 1) * 2.8 * 0.12); bb.scale.set(1.3, 0.9 + taper * 0.8, 2.8 / (2 * r) * 0.8); } }
  put(R, smoothRock(2.2, 1, 0.25, 5), rockS, CX + 0.4, -3.6, -0.6, { s: [1.7, 1.4, 1.0] });
  for (let i = 0; i < 12; i++) put(R, new THREE.ConeGeometry(0.04 + Math.random() * 0.03, 0.2 + Math.random() * 0.35, 6), ice, M.x0 * SC + 0.4 + i * (W - 0.8) / 11, -0.62, 1.18, { rx: Math.PI });
  // ice crystal slabs (soft platforms 0, 1) with crystals hanging under them
  const shards = [];
  for (const P of st.plats.slice(0, 2)) {
    const x = (P.x0 + P.x1) / 2 * SC, w = (P.x1 - P.x0) * SC, y = -P.y * SC;
    put(R, new THREE.CylinderGeometry(w / 2, w / 2 * 0.92, 0.12, 6), [ice, snow, ice], x, y - 0.06, -0.15, { s: [1, 1, 0.8], cast: true, recv: true });
    for (let k = 0; k < 6; k++) { const c = put(R, new THREE.OctahedronGeometry(0.16, 0), ice, x + (k - 2.5) * w * 0.14, y - 0.35 - (k % 3) * 0.1, -0.15 + (k % 2 - 0.5) * 0.3, { s: [0.7, 2.4 + (k % 3), 0.7] }); shards.push(c); }
    sprite(R, 0x6ac8ff, 1.2, 1.6, x, y - 0.35, -0.1);
  }
  // shrine gate (soft platform 2 is its lintel), frozen pillars, blue-fire braziers
  const P2 = st.plats[2], gx = (P2.x0 + P2.x1) / 2 * SC, gw = (P2.x1 - P2.x0) * SC, gy = -P2.y * SC;
  for (const s of [-1, 1]) { put(R, wbox(0.34, gy - 0.2, 0.34, 1.2), granite, gx + s * (gw / 2 + 0.05), (gy - 0.2) / 2, -0.75, { cast: true }); put(R, new THREE.BoxGeometry(0.46, 0.14, 0.46), granite, gx + s * (gw / 2 + 0.05), 0.07, -0.75); }
  put(R, wbox(gw + 0.9, 0.2, 1.3, 1.2), [granite, granite, snow, granite, granite, granite], gx, gy - 0.1, -0.3, { cast: true, recv: true });
  put(R, wbox(gw + 1.3, 0.14, 0.6, 1.2), [granite, granite, snow, granite, granite, granite], gx, gy + 0.27, -0.75);
  for (let i = 0; i < 9; i++) put(R, new THREE.ConeGeometry(0.035, 0.18 + Math.random() * 0.3, 6), ice, gx - gw / 2 - 0.35 + i * (gw + 0.7) / 8, gy - 0.3, 0.3, { rx: Math.PI });
  const fires = [];
  for (const x of [M.x0 * SC + 0.35, M.x1 * SC - 0.35]) {
    put(R, new THREE.CylinderGeometry(0.2, 0.12, 0.5, 8), granite, x, 0.25, -1.3);
    put(R, new THREE.CylinderGeometry(0.28, 0.22, 0.14, 12), std({ color: 0x3a3a48, roughness: 0.5, metalness: 0.8 }), x, 0.55, -1.3);
    fires.push(sprite(R, 0x5ab8ff, 1.8, 0.9, x, 0.8, -1.25, true));
    const L = new THREE.PointLight(0x5ab8ff, 4, 5, 1.8); L.position.set(x, 0.9, -0.9); R.add(L); fires.push(L);
  }
  for (const [x, z, h] of [[-6.2, -3.5, 4.5], [6.5, -4.2, 3.4], [-9.5, -7, 6], [10, -8, 5]]) {
    put(R, wbox(0.7, h, 0.7, 1.2), granite, x, h / 2 - 0.5, z, { cast: true });
    put(R, wbox(0.8, 0.12, 0.8, 1.2), [granite, granite, snow, granite, granite, granite], x, h - 0.44, z);
    put(R, smoothRock(1.6, 1, 0.3, x), rockS, x, -1.6, z, { s: [1.4, 0.9, 1.2] });
    for (let k = 0; k < 3; k++) put(R, new THREE.OctahedronGeometry(0.25, 0), ice, x + (k - 1) * 0.3, 0.1 + k * 0.2, z + 0.4, { s: [0.6, 2 + k, 0.6], rz: (k - 1) * 0.3 });
  }
  // aurora curtains, blizzard
  const auroras = [];
  for (const [x, y, z, w, c1, c2] of [[-10, 9, -34, 44, 0x20ff90, 0x8a40ff], [12, 11, -38, 40, 0x30ffc0, 0xff40c0]]) { const m = put(R, new THREE.PlaneGeometry(w, 12, 40, 1), auroraMat(c1, c2), x, y, z); auroras.push(m); }
  const NB = 520, bPos = new Float32Array(NB * 3), flakes = [];
  for (let i = 0; i < NB; i++) flakes.push({ x: (Math.random() - 0.5) * 24, y: Math.random() * 12 - 3, z: 2 - Math.random() * 12, s: 0.8 + Math.random() * 1.6, ph: Math.random() * 6 });
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  const blizz = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xf4f8ff, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false })); blizz.frustumCulled = false; R.add(blizz);
  // lights: moonlight, aurora glow
  g.add(new THREE.HemisphereLight(0x9ab8ff, 0x203050, 0.5));
  sunKey(g, 0xc8dcff, 1.5, [-5, 9, 7]);
  const rim = new THREE.DirectionalLight(0x40ffb0, 1.1); rim.position.set(3, 4, -8); g.add(rim);
  const rim2 = new THREE.DirectionalLight(0x9a60ff, 0.7); rim2.position.set(-6, 3, -6); g.add(rim2);
  g.userData.embers = null;
  let lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (const a of auroras) a.material.uniforms.t.value = t;
    const wind = 2.2 + Math.sin(t * 0.3) * 1.2;
    for (let i = 0; i < NB; i++) { const f = flakes[i]; f.x += (wind * f.s * 0.6) * dt; f.y -= f.s * 0.9 * dt; if (f.x > 12) f.x -= 24; if (f.y < -3) f.y += 12; bPos[i * 3] = f.x + Math.sin(t * 2 + f.ph) * 0.1; bPos[i * 3 + 1] = f.y; bPos[i * 3 + 2] = f.z; }
    bg.attributes.position.needsUpdate = true;
    shards.forEach((c, i) => { c.material.emissiveIntensity = 0.8 + Math.sin(t * 1.5 + i) * 0.2; });
    fires.forEach((f, i) => { if (f.isPointLight) f.intensity = 3.5 + Math.sin(t * 9 + i) * 0.8; else f.material.opacity = 0.8 + Math.sin(t * 13 + i) * 0.15; });
  };
  return g;
}

// ---------- Lunar Base ----------
function foilTex() {
  return canvasTex(256, 256, (c, W, H) => { c.fillStyle = '#c8962a'; c.fillRect(0, 0, W, H); for (let i = 0; i < 260; i++) { const x = Math.random() * W, y = Math.random() * H, s = 8 + Math.random() * 30; c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,230,150' : '120,70,10'},${0.15 + Math.random() * 0.35})`; c.beginPath(); c.moveTo(x, y); c.lineTo(x + s, y + Math.random() * s * 0.4); c.lineTo(x + s * 0.3, y + s); c.closePath(); c.fill(); } });
}
function padMarkTex() {
  return canvasTex(1024, 512, (c, W, H) => {
    c.clearRect(0, 0, W, H); c.strokeStyle = '#ffc830'; c.lineWidth = 14; c.beginPath(); c.ellipse(W / 2, H / 2, 300, 150, 0, 0, 7); c.stroke();
    c.lineWidth = 6; c.beginPath(); c.ellipse(W / 2, H / 2, 250, 125, 0, 0, 7); c.stroke();
    c.fillStyle = '#ffc830'; c.font = 'bold 120px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.save(); c.translate(W / 2, H / 2); c.scale(1, 0.5); c.fillText('07', 0, 12); c.restore();
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { c.beginPath(); const x = W / 2 + s * (370 + k * 40); c.moveTo(x, H / 2 - 40); c.lineTo(x + s * 26, H / 2); c.lineTo(x, H / 2 + 40); c.lineWidth = 10; c.stroke(); }
  });
}
function buildLunar(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x06070c, 60, 200);
  g.add(skyDome(0x000000, 0x05060c, 0x0a0a10));
  const deck = tileMat('shipdeck', { glow: 0.15, m: { roughness: 0.5, metalness: 0.45, color: 0xe8ecf4 } }), white = std({ color: 0xaeb2be, roughness: 0.5, metalness: 0.35 });
  const dark = std({ color: 0x2a2c34, roughness: 0.5, metalness: 0.8 }), foil = std({ map: foilTex(), roughness: 0.25, metalness: 1 });
  const regolith = std({ map: noiseTex('#8a8a8c', ['#5a5a5e', '#a8a8aa', '#6a6a70'], 3000, 512), roughness: 1, color: 0xa8a8b0 });
  // pad on struts at the crater rim
  put(R, wbox(W, 0.3, 2.9, 2.4), [white, white, deck, dark, white, white], CX, -0.15, -0.25, { recv: true });
  put(R, new THREE.PlaneGeometry(W * 0.8, 2.3), new THREE.MeshBasicMaterial({ map: padMarkTex(), transparent: true, color: new THREE.Color(1.1, 1.0, 0.8), polygonOffset: true, polygonOffsetFactor: -2 }), CX, 0.004, -0.2, { rx: -Math.PI / 2 });
  const edge = [];
  for (let x = M.x0 * SC + 0.2; x <= M.x1 * SC - 0.1; x += 0.8) edge.push(put(R, new THREE.BoxGeometry(0.14, 0.04, 0.05), glow(0xff3a30, 3), x, 0.02, 1.22));
  for (const [x, z] of [[-3.8, 0.9], [3.8, 0.9], [-3.8, -1.4], [3.8, -1.4], [-1.3, 0.9], [1.3, 0.9]]) beam(R, dark, new THREE.Vector3(x, -0.3, z), new THREE.Vector3(x * 1.25, -6, z * 1.4), 0.09, 10);
  const fade = canvasTex(8, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#000'); gr.addColorStop(0.55, '#fff'); gr.addColorStop(1, '#fff'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  regolith.map.repeat.set(12, 3); regolith.map.wrapS = regolith.map.wrapT = THREE.RepeatWrapping; regolith.alphaMap = fade; regolith.transparent = true; regolith.depthWrite = false;
  put(R, new THREE.PlaneGeometry(70, 18), regolith, 0, -1.0, -11, { rx: -Math.PI / 2, recv: true });
  // boulders: were flat-shaded detail-1 rocks, one of them big enough and close enough behind the pad to read
  // as part of the stage (9/22 night). Now smooth, finer, regolith-textured, and kept clear of the space right
  // behind the pad so they sit in the plain with the painting.
  { const rockM = std({ map: regolith.map.clone(), roughness: 0.95, color: 0x9a9aa2 }); rockM.map.needsUpdate = true; rockM.map.repeat.set(2, 2);
    for (let i = 0, n = 0; i < 40 && n < 11; i++) {
      const x = (Math.random() - 0.5) * 32, z = -4 - Math.random() * 13;
      if (Math.abs(x) < 7 && z > -8) continue;
      const rg = mergeVertices(rockGeo(0.25 + Math.random() * 0.6, 2, 0.3, i * 3).deleteAttribute('normal').deleteAttribute('uv'), 1e-3); rg.computeVertexNormals();   // welded: smooth, not faceted
      put(R, rg, rockM, x, -1.05, z, { s: [1.3, 0.55, 1] }); n++;
    } }
  // comms tower with a catwalk (soft platform 0) and the crane arm on top (soft platform 2)
  const P0 = st.plats[0], P1 = st.plats[1], P2 = st.plats[2];
  const tx = (P0.x0 + P0.x1) / 2 * SC, tw = (P0.x1 - P0.x0) * SC, ty = -P0.y * SC;
  for (const [a, b] of [[-0.3, -0.9], [0.3, -0.9], [-0.3, -1.5], [0.3, -1.5]]) put(R, new THREE.BoxGeometry(0.06, 5.4, 0.06), dark, tx + a, 2.7, b);
  for (let y = 0.6; y < 5.4; y += 0.6) { put(R, new THREE.BoxGeometry(0.66, 0.04, 0.04), dark, tx, y, -0.9); put(R, new THREE.BoxGeometry(0.04, 0.04, 0.66), dark, tx - 0.3, y, -1.2); beam(R, dark, new THREE.Vector3(tx - 0.3, y - 0.6, -0.9), new THREE.Vector3(tx + 0.3, y, -0.9), 0.015, 4); }
  put(R, wbox(tw, 0.08, 1.4, 1.2), [dark, dark, deck, dark, dark, dark], tx, ty - 0.04, -0.3, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(tw + 0.02, 0.03, 0.04), glow(0xffc830, 2.2), tx, ty - 0.01, 0.41);
  const dish = put(R, new THREE.SphereGeometry(0.55, 24, 12, 0, 6.283, 0, 0.8), std({ color: 0xe8e8f0, roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }), tx, 5.1, -1.2, { rx: 1.1 });
  const bcn = put(R, new THREE.SphereGeometry(0.06, 10, 8), glow(0xff2a2a, 3), tx, 5.5, -1.2);
  const cx2 = (P2.x0 + P2.x1) / 2 * SC, cy = -P2.y * SC;
  put(R, wbox(P2.x1 * SC - tx + 0.3, 0.14, 0.9, 1), [dark, dark, deck, dark, dark, dark], (P2.x1 * SC + tx - 0.3) / 2, cy - 0.07, -0.35, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(P2.x1 * SC - tx + 0.3, 0.03, 0.04), glow(0xffc830, 2.0), (P2.x1 * SC + tx - 0.3) / 2, cy - 0.01, 0.11);
  cable(R, dark, new THREE.Vector3(P2.x1 * SC - 0.2, cy - 0.1, -0.35), new THREE.Vector3(P2.x1 * SC - 0.2, cy - 1.4, -0.35), 0.001, 0.012);
  put(R, new THREE.BoxGeometry(0.5, 0.35, 0.4), foil, P2.x1 * SC - 0.2, cy - 1.6, -0.35, { cast: true });
  // lander (soft platform 1 is its upper deck)
  const lx = (P1.x0 + P1.x1) / 2 * SC, lw = (P1.x1 - P1.x0) * SC, ly = -P1.y * SC;
  const lander = new THREE.Group(); lander.position.set(lx, 0, -1.3); R.add(lander);
  put(lander, new THREE.CylinderGeometry(0.85, 0.95, ly - 0.55, 8), foil, 0, 0.35 + (ly - 0.55) / 2, 0, { cast: true });
  for (let k = 0; k < 4; k++) { const a = k / 4 * 6.283 + 0.785; beam(lander, white, new THREE.Vector3(Math.cos(a) * 0.7, 0.9, Math.sin(a) * 0.7), new THREE.Vector3(Math.cos(a) * 1.3, 0.05, Math.sin(a) * 1.3), 0.04); put(lander, new THREE.CylinderGeometry(0.16, 0.2, 0.05, 12), white, Math.cos(a) * 1.3, 0.03, Math.sin(a) * 1.3); }
  put(R, wbox(lw, 0.1, 2.0, 1.2), [white, white, deck, dark, white, white], lx, ly - 0.05, -0.55, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(lw + 0.02, 0.03, 0.04), glow(0x22e6ff, 2.2), lx, ly - 0.01, 0.46);
  put(lander, new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), dark, 0.4, ly + 0.55, -0.1); put(lander, new THREE.SphereGeometry(0.2, 16, 8, 0, 6.283, 0, 1.2), white, -0.3, ly + 0.2, -0.3, { rx: 0.4 });
  // habitat dome and rovers on the plain behind
  const dome = new THREE.Group(); dome.position.set(8.5, -1.0, -9); R.add(dome);
  put(dome, new THREE.SphereGeometry(2.6, 32, 16, 0, 6.283, 0, Math.PI / 2), std({ color: 0xbfe8ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.3, emissive: 0x3a8aff, emissiveIntensity: 0.5, side: THREE.DoubleSide, depthWrite: false }), 0, 0, 0);
  put(dome, new THREE.SphereGeometry(1.4, 20, 12, 0, 6.283, 0, Math.PI / 2), std({ color: 0x3a5a3a, roughness: 0.8, emissive: 0x2a6a2a, emissiveIntensity: 0.6 }), 0, 0, 0);
  put(dome, new THREE.TorusGeometry(2.62, 0.08, 8, 48), white, 0, 0.05, 0, { rx: Math.PI / 2 });
  sprite(dome, 0x6ab8ff, 0.8, 5, 0, 1, 0);
  dome.visible = false;   // the painting has real domes; this one read as a toy
  const rovers = [];
  for (const [z, v, ph] of [[-6, 0.9, 0], [-12, -0.6, 10]]) {
    const r = new THREE.Group(); r.position.set(-14 + ph, -1.0, z); R.add(r);
    put(r, new THREE.BoxGeometry(1.1, 0.35, 0.7), white, 0, 0.45, 0, { cast: true }); put(r, new THREE.BoxGeometry(0.5, 0.25, 0.6), foil, -0.2, 0.75, 0);
    for (const dx of [-0.4, 0, 0.4]) for (const s of [-1, 1]) put(r, new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14), dark, dx, 0.16, s * 0.42, { rx: Math.PI / 2 });
    sprite(r, 0xfff4d0, 1.6, 0.6, Math.sign(v) * 0.6, 0.45, 0);
    rovers.push({ r, v }); r.visible = false;   // box-and-cylinder rovers read as toys against the photoreal plate
  }
  // lights: hard low sun, earthshine
  g.add(new THREE.HemisphereLight(0x8090b8, 0x101012, 0.45));
  sunKey(g, 0xfff8f0, 2.8, [-9, 5, 5], { left: -10, right: 10, top: 7, bottom: -3, near: 1, far: 40 });
  const earth = new THREE.DirectionalLight(0x6a9aff, 0.6); earth.position.set(2, 6, -10); g.add(earth);
  g.userData.embers = null;
  let lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    edge.forEach((e, i) => { e.visible = ((i + Math.floor(t * 4)) % 4) === 0 || (t % 2) < 1; });
    bcn.visible = (t % 1.5) < 0.4; dish.rotation.z = Math.sin(t * 0.3) * 0.4;
    for (const r of rovers) { r.r.position.x += r.v * dt; r.r.position.y = -1.0 + Math.abs(Math.sin(t * 3 + r.v)) * 0.02; if (r.r.position.x > 16) r.r.position.x = -16; if (r.r.position.x < -16) r.r.position.x = 16; }
  };
  return g;
}

// ---------- High Roller ----------
function reelTex() {
  const t = canvasTex(128, 1024, (c, W, H) => {
    const sym = ['7', 'BAR', '♥', '★', '♦', '7', '♣', 'BAR'];
    c.fillStyle = '#fff8ec'; c.fillRect(0, 0, W, H);
    sym.forEach((s, i) => { const y = (i + 0.5) * H / sym.length; c.font = `bold ${s.length > 1 ? 44 : 96}px Bungee, Impact, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = s === '7' ? '#e0202a' : s === 'BAR' ? '#1a1a1a' : ['#ff3a6a', '#ffb000', '#3a7aff', '#1a8a3a'][i % 4]; c.fillText(s, W / 2, y); c.strokeStyle = 'rgba(0,0,0,.12)'; c.beginPath(); c.moveTo(0, y + H / 16); c.lineTo(W, y + H / 16); c.stroke(); });
  });
  t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 0.34); return t;
}
function rouletteTex() {
  return canvasTex(1024, 1024, (c, W, H) => {
    c.translate(W / 2, H / 2); const n = 37;
    for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; c.fillStyle = i === 0 ? '#1a9a3a' : i % 2 ? '#c8101a' : '#141414'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 500, a0, a1); c.closePath(); c.fill();
      c.save(); c.rotate((a0 + a1) / 2); c.fillStyle = '#fff'; c.font = 'bold 36px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.fillText(String((i * 17) % 37), 440, 12); c.restore(); }
    c.fillStyle = '#6a3a14'; c.beginPath(); c.arc(0, 0, 360, 0, 7); c.fill();
    const gr = c.createRadialGradient(0, 0, 20, 0, 0, 330); gr.addColorStop(0, '#ffe8a0'); gr.addColorStop(1, '#b87a20'); c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 320, 0, 7); c.fill();
    c.strokeStyle = '#ffe8a0'; c.lineWidth = 16; for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 4); c.beginPath(); c.moveTo(-260, 0); c.lineTo(260, 0); c.stroke(); }
    c.strokeStyle = '#ffd040'; c.lineWidth = 18; c.beginPath(); c.arc(0, 0, 505, 0, 7); c.stroke();
  });
}
function chipTex(col) {
  return canvasTex(256, 256, (c, W, H) => { c.fillStyle = col; c.beginPath(); c.arc(128, 128, 126, 0, 7); c.fill(); c.fillStyle = '#fff'; for (let k = 0; k < 8; k++) { c.save(); c.translate(128, 128); c.rotate(k / 8 * 6.283); c.fillRect(-14, -126, 28, 34); c.restore(); } c.strokeStyle = '#fff'; c.lineWidth = 6; c.beginPath(); c.arc(128, 128, 76, 0, 7); c.stroke(); });
}
function buildCasino(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x2a0a30, 20, 80);
  g.add(skyDome(0x0a0318, 0x3a0a4a, 0x5a1030));
  const deckM = std({ map: marbleTex('#1a1016', '#c8a050'), roughness: 0.2, metalness: 0.3 }), gold = std({ color: 0xffc040, roughness: 0.22, metalness: 1, emissive: 0x6a3a00, emissiveIntensity: 0.75 });
  const redM = std({ color: 0x9a0a1a, roughness: 0.35, metalness: 0.4 }), dark = std({ color: 0x160a12, roughness: 0.4, metalness: 0.6 });
  // rooftop: black-gold marble, gold fascia with chasing marquee bulbs, the tower below
  put(R, wbox(W, 0.3, 2.9, 1.6), [dark, dark, deckM, dark, redM, dark], CX, -0.15, -0.25, { recv: true });
  put(R, new THREE.BoxGeometry(W + 0.08, 0.05, 0.08), gold, CX, -0.02, 1.22);
  // inlay: a double gold border set into the marble, a centre medallion, and a moulding all round
  { const inl = [];
    for (const [w2, d2] of [[W - 2.2, 2.0], [W - 2.5, 1.8]]) {
      inl.push([new THREE.BoxGeometry(w2, 0.014, 0.06), CX, 0.007, -0.25 - d2 / 2]);
      inl.push([new THREE.BoxGeometry(w2, 0.014, 0.06), CX, 0.007, -0.25 + d2 / 2]);
      inl.push([new THREE.BoxGeometry(0.06, 0.014, d2), CX - w2 / 2, 0.007, -0.25]);
      inl.push([new THREE.BoxGeometry(0.06, 0.014, d2), CX + w2 / 2, 0.007, -0.25]);
    }
    inl.push([new THREE.TorusGeometry(0.62, 0.022, 6, 28).rotateX(Math.PI / 2), CX, 0.006, -0.25]);
    inl.push([new THREE.TorusGeometry(0.44, 0.016, 6, 24).rotateX(Math.PI / 2), CX, 0.006, -0.25]);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2;
      inl.push([new THREE.BoxGeometry(0.03, 0.012, 0.18).rotateY(-a), CX + Math.sin(a) * 0.53, 0.006, -0.25 + Math.cos(a) * 0.53]); }
    dfBatch(R, gold, inl, { cast: false }); }

  const cfac = tileMat('facade', { glow: 0.8, m: { color: 0xffc8a0 } });
  put(R, wbox(W - 0.2, 30, 2.7, 2.6), [cfac, cfac, dark, dark, cfac, cfac], CX, -15.3, -0.3);
  const NB = Math.round(W / 0.2), bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), NB); R.add(bulbs);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < NB; i++) { m4.makeTranslation(M.x0 * SC + 0.1 + i * 0.2, -0.17, 1.23); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, col.setRGB(2.6, 1.9, 0.8)); }
  // slot machine sign (soft platform 0) with spinning reels
  const P0 = st.plats[0], P1 = st.plats[1], P2 = st.plats[2];
  const sx = (P0.x0 + P0.x1) / 2 * SC, sw = (P0.x1 - P0.x0) * SC, sy = -P0.y * SC;
  for (const s of [-1, 1]) put(R, new THREE.BoxGeometry(0.05, sy, 0.05), dark, sx + s * (sw / 2 - 0.15), sy / 2, -1.1);
  put(R, wbox(sw, 0.1, 1.4, 1), [gold, gold, deckM, gold, gold, gold], sx, sy - 0.05, -0.3, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(sw + 0.3, 1.9, 0.5), redM, sx, sy + 1.05, -1.25, { cast: true });
  put(R, new THREE.BoxGeometry(sw + 0.36, 0.1, 0.56), gold, sx, sy + 2.0, -1.25); put(R, new THREE.BoxGeometry(sw + 0.36, 0.1, 0.56), gold, sx, sy + 0.1, -1.25);
  const reels = [];
  for (let k = 0; k < 3; k++) { const rt = reelTex(); rt.offset.y = Math.random(); reels.push({ t: rt, sp: 0, stopAt: 0 }); put(R, new THREE.PlaneGeometry(sw * 0.27, 0.95), new THREE.MeshBasicMaterial({ map: rt, color: new THREE.Color(1.15, 1.15, 1.15) }), sx + (k - 1) * sw * 0.3, sy + 1.05, -0.99); }
  const jack = neonSign('777', '#ffd040'); jack.scale.setScalar(0.4); jack.position.set(sx, sy + 1.75, -0.98); R.add(jack);
  const lever = put(R, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), gold, sx + sw / 2 + 0.3, sy + 1.3, -1.2); const knob = put(R, new THREE.SphereGeometry(0.09, 12, 8), redM, sx + sw / 2 + 0.3, sy + 1.72, -1.2);
  // roulette wheel sign (soft platform 1 is the ledge of its cabinet)
  const rx = (P1.x0 + P1.x1) / 2 * SC, rw = (P1.x1 - P1.x0) * SC, ry = -P1.y * SC;
  put(R, wbox(rw, 0.12, 1.45, 1), [gold, gold, deckM, gold, gold, gold], rx, ry - 0.06, -0.3, { cast: true, recv: true });
  put(R, new THREE.CylinderGeometry(0.1, 0.18, ry + 0.3, 16), gold, rx, (ry + 0.3) / 2, -1.3);
  const wheel = put(R, new THREE.CylinderGeometry(1.05, 1.05, 0.12, 64), [gold, new THREE.MeshBasicMaterial({ map: rouletteTex(), color: new THREE.Color(1.1, 1.1, 1.1) }), gold], rx, ry + 1.25, -1.2, { rx: Math.PI / 2 });
  put(R, new THREE.TorusGeometry(1.12, 0.07, 10, 64), gold, rx, ry + 1.25, -1.13);
  const ball = put(R, new THREE.SphereGeometry(0.05, 12, 8), std({ color: 0xffffff, roughness: 0.1, metalness: 0.2, emissive: 0x404040 }), rx, ry + 1.25, -1.08);
  const wbulbs = [];
  for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; wbulbs.push(put(R, new THREE.SphereGeometry(0.04, 8, 6), glow(0xffe080, 2.6), rx + Math.cos(a) * 1.24, ry + 1.25 + Math.sin(a) * 1.24, -1.1)); }
  // dice sign on top (soft platform 2)
  const dx = (P2.x0 + P2.x1) / 2 * SC, dw = (P2.x1 - P2.x0) * SC, dy = -P2.y * SC;
  put(R, wbox(dw, 0.12, 1.2, 1), [gold, gold, deckM, gold, gold, gold], dx, dy - 0.06, -0.3, { cast: true, recv: true });
  const js = neonSign('JACKPOT', '#ff3a6a'); js.scale.setScalar(0.42); js.position.set(dx, dy - 0.32, 0.31); R.add(js);
  for (const s of [-1, 1]) cableUp(R, dark, dx + s * (dw / 2 - 0.1), dy, -0.3, 12);
  const pipT = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#fff4f4'; c.fillRect(0, 0, w, h); c.fillStyle = '#c8101a'; for (const [x, y] of [[32, 32], [96, 96], [64, 64], [96, 32], [32, 96]]) { c.beginPath(); c.arc(x, y, 12, 0, 7); c.fill(); } });
  const dice = [];
  for (const s of [-1, 1]) { const d = put(R, new THREE.BoxGeometry(0.36, 0.36, 0.36), std({ map: pipT, roughness: 0.3, emissive: 0xff4040, emissiveIntensity: 0.15 }), dx + s * 0.28, dy + 0.35, -0.6, { cast: true }); dice.push(d); }
  // chips and coins on the roof, sparkles
  const chipCols = ['#c8101a', '#1a1a1a', '#1a5aff', '#1a9a3a'];
  for (let k = 0; k < 7; k++) { const x = CX + (k < 4 ? -4 + k * 0.35 : 2.8 + k * 0.3), n = 3 + (k * 7) % 6, ct = chipTex(chipCols[k % 4]); for (let j = 0; j < n; j++) put(R, new THREE.CylinderGeometry(0.16, 0.16, 0.05, 24), [std({ color: chipCols[k % 4], roughness: 0.4 }), std({ map: ct, roughness: 0.4 }), std({ map: ct, roughness: 0.4 })], x, 0.025 + j * 0.052, -1.25 + (k % 2) * 0.2, { rz: (Math.random() - 0.5) * 0.08 }); }
  const coinT = crownCoinTex();
  for (let k = 0; k < 9; k++) put(R, new THREE.CylinderGeometry(0.13, 0.13, 0.025, 24), [gold, std({ map: coinT, metalness: 0.9, roughness: 0.3 }), gold], CX - 1.4 + k * 0.4 + Math.random() * 0.2, 0.013, -1.0 - Math.random() * 0.4, { rz: 0.02 });
  const sparkles = []; for (let k = 0; k < 10; k++) sparkles.push(sprite(R, 0xfff2c0, 2, 0.2, CX - 4 + Math.random() * 8, 0.1 + Math.random() * 0.2, -1.0 - Math.random() * 0.4));
  // neon signs, searchlights, fireworks
  const signs = [['WIN', '#22e6ff', -7.6, 3.4, -5], ['777', '#ffd040', 7.8, 4.2, -6], ['LUCKY', '#ff4fd8', 9.6, 1.6, -8], ['ALL IN', '#ff3a3a', -9.5, 1.2, -8]];
  for (const [w, c, x, y, z] of signs) { const s = neonSign(w, c); s.position.set(x, y, z); s.scale.setScalar(1.1); R.add(s); }
  const beamT = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.8)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const lights = [];
  for (const x of [-6.5, 6.5]) { const sp = new THREE.Group(); sp.position.set(x, -0.5, -4); R.add(sp); put(sp, new THREE.ConeGeometry(1.2, 16, 20, 1, true), glowA(0xfff0c0, 0.8, 0.14, beamT), 0, 8, 0, { rx: Math.PI }); lights.push(sp); }
  const fw = [];
  for (let k = 0; k < 4; k++) { const f = sprite(R, [0xffd040, 0xff4fd8, 0x22e6ff, 0xff5030][k], 2, 3, 0, -50, -30); f.visible = false; fw.push({ f, t: 0 }); }
  // lights
  g.add(new THREE.HemisphereLight(0xffb0d0, 0x1a0818, 0.55));
  sunKey(g, 0xffe0b0, 1.7, [-4, 9, 7]);
  const rimA = new THREE.DirectionalLight(0xff3a6a, 1.4); rimA.position.set(6, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0xffc040, 1.2); rimB.position.set(-6, 3, -6); g.add(rimB);
  const pl = new THREE.PointLight(0xff4060, 5, 5, 1.8); pl.position.set(rx, ry + 1.2, 0.2); R.add(pl);
  g.userData.embers = null;
  let lastT = 0, nextSpin = 1, nextFw = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (let i = 0; i < NB; i++) { const on = ((i + Math.floor(t * 8)) % 4) < 2; bulbs.setColorAt(i, col.setRGB(2.6, 1.9, 0.8).multiplyScalar(on ? 1 : 0.25)); }
    bulbs.instanceColor.needsUpdate = true;
    if (t > nextSpin) { nextSpin = t + 5; reels.forEach((r, k) => { r.sp = 4 + k; r.stopAt = t + 1.2 + k * 0.5; }); lever.rotation.x = 0.5; }
    lever.rotation.x *= 0.9;
    for (const r of reels) { if (t < r.stopAt) r.t.offset.y = (r.t.offset.y + r.sp * dt) % 1; else r.t.offset.y = Math.round(r.t.offset.y * 8) / 8; }
    wheel.rotation.y = t * 1.4; const ba = -t * 2.6; ball.position.set(rx + Math.cos(ba) * 0.85, ry + 1.25 + Math.sin(ba) * 0.85, -1.08);
    wbulbs.forEach((b, i) => { b.visible = ((i + Math.floor(t * 10)) % 3) !== 0; });
    dice.forEach((d, i) => { d.rotation.x = t * (0.6 + i * 0.2); d.rotation.y = t * 0.8; });
    sparkles.forEach((s, i) => { s.material.opacity = Math.max(0, Math.sin(t * 3 + i * 1.7)) ** 6; });
    lights.forEach((l, i) => { l.rotation.z = Math.sin(t * 0.5 + i * 2) * 0.5; });
    if (t > nextFw) { nextFw = t + 0.9 + Math.random() * 1.2; const f = fw.find(q => q.t <= 0); if (f) { f.t = 1; f.f.visible = true; f.f.position.set((Math.random() - 0.5) * 50, 6 + Math.random() * 8, -30 - Math.random() * 8); } }
    for (const f of fw) if (f.t > 0) { f.t -= dt * 0.9; const k = Math.max(0, f.t); f.f.scale.setScalar(3 + (1 - k) * 8); f.f.material.opacity = k; if (f.t <= 0) f.f.visible = false; }
  };
  return g;
}

// ---------- shared helpers for the rebuilt stock stages ----------
// a soft drifting volume of fog cards
function fogBank(R, n, box, col, op, size) {
  const t = canvasTex(256, 128, (c, w, h) => { for (let i = 0; i < 14; i++) { const x = 30 + Math.random() * 196, y = 40 + Math.random() * 50, r = Math.min(34 + Math.random() * 46, x - 2, w - x - 2, y - 2, h - y - 2), gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); } });
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = put(R, new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: op * (0.6 + Math.random() * 0.6), color: col, fog: false }),
      box[0] + Math.random() * box[1], box[2] + Math.random() * box[3], box[4] - Math.random() * box[5]);
    out.push({ m, v: 0.08 + Math.random() * 0.16, x0: box[0], w: box[1] });
  }
  return out;
}
// god rays / light shafts
function shafts(R, list, col, op) {
  const t = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); const d = c.getImageData(0, 0, w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.data[(y * w + x) * 4 + 3] *= Math.sin(x / w * Math.PI); c.putImageData(d, 0, 0); });
  return list.map(([x, y, z, wd, hg, rot]) => put(R, new THREE.PlaneGeometry(wd, hg), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op, color: col, fog: false }), x, y, z, { rz: rot }));
}
// a smoke column rising from a point
function smokeStack(R, x, y, z, w, h, col, op) {
  const t = canvasTex(128, 256, (c, ww, hh) => { for (let i = 0; i < 18; i++) { const cx = 20 + Math.random() * 88, cy = Math.random() * hh, r = 26 + Math.random() * 40, gr = c.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, ww, hh); } });
  t.wrapT = THREE.RepeatWrapping;
  // The puffs above run past the canvas sides and the texture scrolls (wrapT), so the plane's own edges were hard: every
  // steam plume drew as a pale RECTANGLE over the city (Neon Rooftop's three vents, Duane's "maps are fucked"). A fixed
  // alpha mask (its own UV transform, it does not scroll with the steam) fades all four sides: thin at the vent, gone at the top.
  if (!smokeStackMask) smokeStackMask = canvasTex(64, 128, (c, ww, hh) => {
    const im = c.createImageData(ww, hh);
    for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) {
      const u = Math.abs(i / (ww - 1) - 0.5) * 2, v = 1 - j / (hh - 1);   // v: 0 at the bottom (vent), 1 at the top
      const side = 1 - Math.min(1, Math.max(0, (u - 0.35) / 0.65)), up = Math.min(1, v / 0.14) * (1 - Math.min(1, Math.max(0, (v - 0.5) / 0.5)));
      const a = Math.round(255 * side * side * (3 - 2 * side) * up * up * (3 - 2 * up)), o = (j * ww + i) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = a; im.data[o + 3] = 255;
    }
    c.putImageData(im, 0, 0);
  });
  smokeStackMask.colorSpace = THREE.NoColorSpace;   // a mask, not a colour: no sRGB decode
  const m = put(R, new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, alphaMap: smokeStackMask, transparent: true, depthWrite: false, opacity: op, color: col, fog: false }), x, y, z);
  return m;
}
let smokeStackMask = null;

// (9/22 night, core map) the rooftop billboard was an abstract target of neon rings. It now runs an ad for the fight:
// the core fighters' cutouts one after another with their name, scanlines and a sweep, cycled every ~2.6 s.
function adTex() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const ids = (typeof coreChars === 'function' ? coreChars() : (typeof CHARS !== 'undefined' ? CHARS.slice(0, 12) : [])).map(c => c.id);
  const imgs = {};
  for (const id of ids) { const im = new Image(); im.src = 'assets/' + (typeof ASSET_ID === 'function' ? ASSET_ID(id) : id) + '_cut.webp'; imgs[id] = im; }
  const name = id => { const c = typeof CHAR_BY_ID !== 'undefined' && CHAR_BY_ID[id]; return c ? c.name : id.toUpperCase(); };
  t.userData = { draw(k) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const n = ids.length || 1, slot = k / 10.4, i = Math.floor(slot) % n, f = slot - Math.floor(slot);
    const hue = (i * 47) % 360;
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${hue},80%,18%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},85%,8%)`); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.18; c.strokeStyle = `hsl(${hue},90%,65%)`; c.lineWidth = 2; for (let x = -H; x < W; x += 28) { c.beginPath(); c.moveTo(x + (k * 6) % 28, H); c.lineTo(x + H + (k * 6) % 28, 0); c.stroke(); } c.globalAlpha = 1;
    const im = imgs[ids[i]], slide = f < 0.12 ? (1 - f / 0.12) : 0;
    if (im && im.complete && im.naturalWidth) { const h = H * 1.85, w = h * im.naturalWidth / im.naturalHeight; c.drawImage(im, W * 0.7 - w / 2 + slide * 160, 10, w, h); }   // head and shoulders
    c.font = 'italic 900 64px "Barlow Condensed", Impact, sans-serif'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
    c.shadowColor = `hsl(${hue},100%,60%)`; c.shadowBlur = 18; c.fillText(name(ids[i]).toUpperCase(), 26 - slide * 120, 118); c.shadowBlur = 0;
    c.font = '700 22px "JetBrains Mono", monospace'; c.fillStyle = `hsl(${hue},100%,72%)`; c.fillText('BRAWL STREET', 30, 156);
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(30, 172, 120, 4);
    c.globalAlpha = 0.12; c.fillStyle = '#000'; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1); c.globalAlpha = 1;
    const sw = ((k * 30) % (W * 2)) - W / 2; const sg = c.createLinearGradient(sw, 0, sw + 120, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.12)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = sg; c.fillRect(0, 0, W, H);
    t.needsUpdate = true;
  } };
  t.userData.draw(0); return t;
}
// ---------- Neon Rooftop (rebuild: a real cyberpunk city in depth) ----------
function holoTex(hue) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.userData = { cv, draw(k) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.fillStyle = '#04030c'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) { const y = ((i * 60 + k * 40) % (H + 120)) - 60; const g = c.createLinearGradient(0, y, 0, y + 90); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `hsla(${hue + i * 12},90%,62%,.85)`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, y, W, 90); }
    c.globalAlpha = 0.5; c.strokeStyle = '#fff'; c.lineWidth = 2;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(W / 2, H / 2, 20 + i * 26 + (k * 6) % 26, 0, 7); c.stroke(); }
    c.globalAlpha = 1; c.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
    t.needsUpdate = true;
  } };
  t.userData.draw(0); return t;
}
function buildRoof2(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x120a2c, 16, 95);
  g.add(skyDome(0x02010a, 0x160a34, 0x2e0a46));
  const deckM = tileMat('wetdeck', { glow: 0.12, m: { roughness: 0.28, metalness: 0.5, envMapIntensity: 1.1 } });
  const facMat = tileMat('facade', { glow: 0.5, m: { roughness: 0.35, metalness: 0.5, color: 0x8a90b8 } });
  // (9/22 night, core map) the parapet, AC boxes and the deck's front face were near-black (0x0e0e18) and read as black
  // holes against the lit city: now brushed dark steel panels that catch the neon (env reflections + panel seams)
  const panelT = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#3a3c4e'; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`; c.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h); } c.fillStyle = 'rgba(8,8,14,.85)'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h); c.fillStyle = 'rgba(140,150,190,.35)'; c.fillRect(0, 3, w, 1); c.fillRect(3, 0, 1, h); for (const [x, y] of [[12, 12], [w - 14, 12], [12, h - 14], [w - 14, h - 14]]) { c.fillStyle = 'rgba(180,190,220,.5)'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); } }, [2, 1]);
  const dark = std({ map: panelT, color: 0xdce0ff, roughness: 0.5, metalness: 0.3, envMapIntensity: 1.2, emissive: 0x1c1e36, emissiveMap: panelT, emissiveIntensity: 1.3 });
  const steel = std({ map: panelT, color: 0xe8ecff, roughness: 0.42, metalness: 0.4, envMapIntensity: 1.3, emissive: 0x20223c, emissiveMap: panelT, emissiveIntensity: 1.3 });
  const towerT = sTex('stg_tower.jpg', 1, 1, true);
  // the rooftop itself: wet deck, painted circle, neon lip, vents and kit
  put(R, wbox(W, 0.3, 2.9, 2.2), [dark, dark, deckM, dark, dark, dark], CX, -0.15, -0.25, { recv: true });
  put(R, new THREE.CircleGeometry(1.15, 48), std({ map: canvasTex(512, 512, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = '#ffd23f'; c.lineWidth = 16; c.beginPath(); c.arc(w / 2, h / 2, 190, 0, 7); c.stroke(); c.font = 'bold 250px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd23f'; c.fillText('H', w / 2, h / 2 + 10); }), transparent: true, roughness: 0.4, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }), CX - 0.3, 0.004, -0.3, { rx: -Math.PI / 2 });
  put(R, new THREE.BoxGeometry(W + 0.02, 0.035, 0.05), glow(0xff4fd8, 2.2), CX, -0.02, 1.21);
  put(R, wbox(W, 0.42, 0.22, 1), dark, CX, 0.21, -1.6);
  put(R, new THREE.BoxGeometry(W, 0.03, 0.06), glow(0x22e6ff, 2.2), CX, 0.435, -1.5);
  put(R, wbox(W - 0.2, 40, 2.7, 2.6), [facMat, facMat, dark, dark, facMat, facMat], CX, -20.3, -0.3);
  const fans = [], steamers = [];
  for (const x of [-3.0, 1.1, 3.4]) {
    put(R, wbox(0.8, 0.5, 0.6, 0.6), steel, x, 0.25, -1.15, { cast: true });
    put(R, new THREE.CylinderGeometry(0.2, 0.2, 0.03, 20), dark, x, 0.515, -1.15);
    fans.push(put(R, new THREE.BoxGeometry(0.36, 0.012, 0.06), steel, x, 0.535, -1.15));
    steamers.push(smokeStack(R, x, 1.5, -1.1, 0.9, 2.4, 0xbfc8ff, 0.16));
  }
  put(R, wbox(1.0, 1.15, 0.8, 1), dark, -1.5, 0.575, -1.3, { cast: true });
  put(R, new THREE.PlaneGeometry(0.44, 0.8), std({ color: 0x14121c, roughness: 0.5, metalness: 0.7 }), -1.5, 0.4, -0.897);
  put(R, new THREE.PlaneGeometry(0.05, 0.72), glow(0x9affd0, 1.4), -1.5, 0.4, -0.893);
  const beacons = [];
  const mast = (x, z, h, y0 = 0) => { put(R, new THREE.CylinderGeometry(0.03, 0.05, h, 8), steel, x, y0 + h / 2, z); for (let k = 1; k < 4; k++) put(R, new THREE.BoxGeometry(0.5 - k * 0.1, 0.02, 0.02), steel, x, y0 + h * k / 4, z); beacons.push(put(R, new THREE.SphereGeometry(0.06, 12, 8), glow(0xff2a3a, 3), x, y0 + h, z)); };
  mast(-3.9, -1.35, 4.6); mast(4.0, -1.4, 3.4);
  // the soft platform: a lit catwalk under a holo billboard
  const P0 = st.plats[0], px = (P0.x0 + P0.x1) / 2 * SC, pw = (P0.x1 - P0.x0) * SC, py = -P0.y * SC;
  for (const s2 of [-1, 1]) { put(R, new THREE.BoxGeometry(0.08, py, 0.08), steel, px + s2 * (pw / 2 - 0.08), py / 2, -0.8, { cast: true }); beam(R, steel, new THREE.Vector3(px + s2 * (pw / 2 - 0.08), 0.2, -0.8), new THREE.Vector3(px + s2 * (pw / 2 - 0.45), py - 0.08, -0.8), 0.025); }
  put(R, wbox(pw, 0.08, 1.35, 1), [steel, steel, deckM, steel, steel, steel], px, py - 0.04, -0.2, { cast: true, recv: true });
  put(R, new THREE.BoxGeometry(pw + 0.02, 0.02, 0.04), glow(0x22e6ff, 2.4), px, py - 0.01, 0.47);
  const holoA = V3.oldBillboard ? holoTex(300) : adTex();
  put(R, new THREE.BoxGeometry(pw + 0.5, 1.5, 0.08), dark, px, py + 0.95, -1.05);
  put(R, new THREE.PlaneGeometry(pw + 0.35, 1.35), new THREE.MeshBasicMaterial({ map: holoA, color: new THREE.Color(0.85, 0.85, 0.85) }), px, py + 0.95, -1.0);
  const holoL = new THREE.PointLight(0xff4fd8, 6, 6, 1.8); holoL.position.set(px, py + 0.9, -0.4); R.add(holoL);
  // the city in three parallax layers, with projections on the near towers
  const holos = [holoA], towers = [];
  // 9/22 night: these three layers of window-dotted boxes stood in front of the painted plate (assets/
  // bg_roof.jpg: a cyberpunk megacity with hologram billboards, flying traffic and an airship) and hid it
  // completely. Not built any more: the painting is the city; the craft, searchlights and smoke stay for motion.
  const LAY = [];
  LAY.forEach((L, li) => {
    for (let k = 0; k < L.n; k++) {
      const w = L.w[0] + Math.random() * (L.w[1] - L.w[0]), h = L.h[0] + Math.random() * (L.h[1] - L.h[0]);
      let x = -L.x / 2 + (L.x / L.n) * (k + 0.2 + Math.random() * 0.6);
      if (L.gap && Math.abs(x) < L.gap) x += Math.sign(x || 1) * L.gap;   // keep the middle open so the painted city and the fighters read
      const z = L.z - Math.random() * 4;
      const useTower = li === 0 && k % 2 === 0;
      const mat = useTower ? std({ map: towerT, emissive: 0xffffff, emissiveMap: towerT, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.5, color: 0xb0b4d0 }) : facMat;
      const b = put(R, useTower ? new THREE.BoxGeometry(w, h, w * 0.9) : wbox(w, h, w * 0.9, 2.6, k * 0.4), mat, x, h / 2 - 3.2, z);
      put(R, new THREE.BoxGeometry(w + 0.05, 0.06, w * 0.95), glow(['#ff4fd8', '#22e6ff', '#ffd23f', '#8a5aff'][k % 4], 1.8), x, h - 3.2, z);
      if (Math.random() < 0.6) { const bc = put(R, new THREE.SphereGeometry(0.09, 10, 8), glow(0xff2a3a, 3), x + w * 0.3, h - 2.9, z); beacons.push(bc); }
      if (li < 2 && k % 4 === 1) { const ht = holoTex(180 + k * 40); holos.push(ht); put(R, new THREE.PlaneGeometry(w * 0.62, h * 0.26), new THREE.MeshBasicMaterial({ map: ht, color: new THREE.Color(0.95, 0.95, 0.95), transparent: true, opacity: 0.8 }), x, h * 0.5 - 3.2, z + w * 0.46); }
      towers.push(b);
    }
  });
  // distant fire with smoke, and steam plumes between the towers
  const fireL = new THREE.PointLight(0xff6a20, 18, 26, 1.6); fireL.position.set(-13, 2.5, -20); R.add(fireL);
  const fireGlow = sprite(R, 0xff7a30, 1.6, 6, -13, 2.0, -20);
  const fireSmoke = smokeStack(R, -13, 9, -20.5, 7, 16, 0x2a2430, 0.5);
  const smokes = [smokeStack(R, 9, 7, -15, 5, 12, 0x3a3448, 0.3), smokeStack(R, -5, 8, -25, 6, 14, 0x322c40, 0.26), fireSmoke];
  // flying craft with light trails, and an airship
  const trailT = canvasTex(256, 32, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); c.fillStyle = gr; c.fillRect(0, h * 0.3, w, h * 0.4); });
  const craft = [];
  for (let k = 0; k < 9; k++) {
    const dir = k % 2 ? 1 : -1, lane = [-7, -12, -20, -26][k % 4], y = 3 + (k % 5) * 1.9, L = 1.5 - (k % 4) * 0.22;
    const v = new THREE.Group(); v.position.set(-30 + k * 7, y, lane); R.add(v);
    put(v, new THREE.CapsuleGeometry(0.13 * L, L, 4, 10), std({ color: 0x14101f, roughness: 0.3, metalness: 0.85 }), 0, 0, 0, { rz: Math.PI / 2 });
    put(v, new THREE.BoxGeometry(L * 0.7, 0.05, 0.5 * L), std({ color: 0x1a1428, roughness: 0.4, metalness: 0.8 }), 0, -0.04, 0);
    sprite(v, 0xbfefff, 1.6, 0.42 * L, dir * L * 0.6, 0, 0); sprite(v, 0xff2a4a, 1.5, 0.34 * L, -dir * L * 0.6, 0, 0);
    const tr = put(v, new THREE.PlaneGeometry(L * 3.4, 0.1 * L), glowA(k % 2 ? 0xff4fd8 : 0x22e6ff, 1.3, 0.75, trailT), -dir * L * 2.2, 0, 0); if (dir < 0) tr.rotation.z = Math.PI;
    craft.push({ v, sp: dir * (2.2 + (k % 5) * 1.4) });
    v.visible = false;   // black capsules read as UI bars against the painted traffic (9/22 night)
  }
  const ship = new THREE.Group(); ship.position.set(10, 12, -34); R.add(ship);
  put(ship, new THREE.CapsuleGeometry(1.1, 6, 6, 16), std({ color: 0x241c34, roughness: 0.5, metalness: 0.6 }), 0, 0, 0, { rz: Math.PI / 2 });
  put(ship, new THREE.BoxGeometry(2.6, 0.5, 1.2), std({ color: 0x150f22, roughness: 0.5 }), 0, -1.1, 0);
  for (const dx of [-1.6, 0, 1.6]) sprite(ship, 0xffd23f, 1.2, 0.8, dx, -1.2, 0.3);
  ship.visible = false;   // the painting has a real one
  fireGlow.visible = false;   // an orange blob in mid-air once the towers around it were gone
  // searchlights sweeping the haze
  const beamT = canvasTex(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
  const sweeps = [];
  for (const [x, z] of [[-9, -12], [11, -16]]) { const sp = new THREE.Group(); sp.position.set(x, 1.5, z); R.add(sp); put(sp, new THREE.ConeGeometry(1.6, 22, 24, 1, true), glowA(0xbfe0ff, 0.8, 0.09, beamT), 0, 11, 0); sweeps.push(sp); }
  g.add(new THREE.HemisphereLight(0x1c1648, 0x4a2a7a, 0.8));   // sky = night, GROUND = the city glow
  sunKey(g, 0x9a96d8, 0.5, [-5, 9, 7], { left: -10, right: 10, top: 7, bottom: -3, near: 1, far: 40 });
  const cityUp = new THREE.DirectionalLight(0x7a3ad0, 0.55); cityUp.position.set(0, -6, 3); g.add(cityUp);
  const rimA = new THREE.DirectionalLight(0xff4fd8, 1.6); rimA.position.set(6, 3, -6); g.add(rimA);
  const rimB = new THREE.DirectionalLight(0x22e6ff, 1.4); rimB.position.set(-6, 3, -6); g.add(rimB);
  g.userData.rain = true; g.userData.embers = null;
  let lastT = 0, k0 = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (const f of fans) f.rotation.y = t * 9;
    beacons.forEach((b, i) => { b.visible = ((t + i * 0.31) % 1.7) < 0.55; });
    for (const c of craft) { c.v.position.x += c.sp * dt; if (c.v.position.x > 34) c.v.position.x = -34; if (c.v.position.x < -34) c.v.position.x = 34; }
    ship.position.x -= dt * 0.35; if (ship.position.x < -26) ship.position.x = 26;
    for (const m of smokes.concat(steamers)) { m.material.map.offset.y = (m.material.map.offset.y - dt * 0.06) % 1; m.position.x += Math.sin(t * 0.2 + m.position.z) * dt * 0.1; }
    fireL.intensity = 14 + Math.sin(t * 7) * 3 + Math.sin(t * 3.3) * 3; fireGlow.material.opacity = 0.75 + Math.sin(t * 9) * 0.2;
    sweeps.forEach((sp, i) => { sp.rotation.z = Math.sin(t * 0.25 + i * 2) * 0.55; sp.rotation.x = Math.cos(t * 0.18 + i) * 0.2; });
    if (t - k0 > 0.12) { k0 = t; holos.forEach((h, i) => h.userData.draw(t * (4 + i % 3))); }
    holoL.intensity = 5 + Math.sin(t * 3) * 1.2;
  };
  return g;
}

// ---------- Lava Temple (rebuild: flowing lava, carved stone, embers) ----------
function lavaFlowMat(scaleX, scaleY, speed, gain = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, sx: { value: scaleX }, sy: { value: scaleY }, sp: { value: speed }, gn: { value: gain } }, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: NOISE + `uniform float t, sx, sy, sp, gn; varying vec2 vUv;
      void main(){
        vec2 p = vUv * vec2(sx, sy);
        float flow = t * sp;
        float f = fbm(p + vec2(flow * .35, -flow) + fbm(p * 1.7 - vec2(0., flow * .6)) * .8);
        float crust = smoothstep(.40, .62, f);
        float vein = smoothstep(.58, .30, f);
        vec3 hot = vec3(1.9, .55, .08), core = vec3(2.6, 1.5, .45), rock = vec3(.05, .035, .04), ash = vec3(.14, .12, .13);
        vec3 c = mix(hot, mix(rock, ash, smoothstep(.6, .95, f)), crust);
        c = mix(c, core, vein * .9);
        float shimmer = .9 + .1 * sin(vUv.x * 40. + t * 3.);
        gl_FragColor = vec4(c * shimmer * gn, 1.);
      }`,
  });
}
// basalt with lava in the cracks: albedo + an emissive map that only lights the veins
function lavaRockTex() {
  const N = 512, rnd = (() => { let a = 91; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const cracks = [];
  for (let i = 0; i < 14; i++) {
    let x = rnd() * N, y = rnd() * N, ang = rnd() * 6.28; const pts = [[x, y]];
    for (let k = 0; k < 9; k++) { ang += (rnd() - 0.5) * 1.1; x += Math.cos(ang) * (18 + rnd() * 26); y += Math.sin(ang) * (18 + rnd() * 26); pts.push([x, y]); }
    cracks.push({ pts, w: 1.2 + rnd() * 3.2 });
  }
  const stroke = (c, col, k, blur) => { c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round'; c.shadowColor = col; c.shadowBlur = blur;
    for (const cr of cracks) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { c.lineWidth = cr.w * k; c.beginPath(); cr.pts.forEach(([x, y], j) => (j ? c.lineTo(x + ox, y + oy) : c.moveTo(x + ox, y + oy))); c.stroke(); } };
  const map = canvasTex(N, N, (c, w, h) => {
    c.fillStyle = '#1b1412'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const r = 2 + rnd() * 16, v = 16 + rnd() * 26; c.fillStyle = `rgba(${v + 8},${v},${v - 2},${0.25 + rnd() * 0.4})`; c.beginPath(); c.arc(rnd() * w, rnd() * h, r, 0, 7); c.fill(); }
    stroke(c, '#080404', 2.2, 0); stroke(c, '#3a1206', 1.0, 0);
  });
  const emi = canvasTex(N, N, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); stroke(c, '#ff5a10', 1.6, 10); stroke(c, '#ffd070', 0.55, 4); });
  for (const t of [map, emi]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, emi };
}
function buildMoon2(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC, depth = 2.4;
  scene.fog = new THREE.Fog(0x2a0c08, 14, 60);
  g.add(skyDome(0x140404, 0x4a1206, 0xff5a10));
  const carved = tileMat('carved', { glow: 0.06, m: { roughness: 0.74, metalness: 0.28, color: 0x6a5346 } });
  const crust = tileMat('crust', { glow: 1.35, m: { roughness: 0.8, color: 0xc08050 } });
  const dark = std({ color: 0x120a0a, roughness: 0.85 });
  // the temple platform: basalt with lava in the cracks, a gold-inlaid lip and a glowing seam under it.
  // (9/22 night: the old front face was a strip of zig-zag rune glyphs that read as "Z Z Z Z" hazard tape.)
  const LR = lavaRockTex();
  const rock = (rx, ry, glow) => { const mp = LR.map.clone(), em = LR.emi.clone(); for (const t of [mp, em]) { t.needsUpdate = true; t.repeat.set(rx, ry); }
    return std({ map: mp, emissive: 0xff6a1a, emissiveMap: em, emissiveIntensity: glow, roughness: 0.62, metalness: 0.12, color: 0xb8a8a0 }); };
  // wbox / scaleUV already map UVs in world units (1 texture per 1.6 units), so no extra repeat
  const rockTop = rock(1, 1, 0.22), rockSide = rock(1, 1, 0.75), rockDeep = rock(1, 1, 0.5);
  const gold = std({ color: 0xffc860, metalness: 1, roughness: 0.28, emissive: 0x5a2800, emissiveIntensity: 0.5 });
  const seam = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.2), toneMapped: false });
  put(R, wbox(W, 0.34, depth, 1.6), [rockSide, rockSide, rockTop, crust, rockSide, rockSide], CX, -0.17, 0, { recv: true });
  put(R, new THREE.BoxGeometry(W + 0.06, 0.07, 0.08), gold, CX, -0.02, depth / 2, { cast: true });
  put(R, new THREE.BoxGeometry(W - 0.2, 0.022, 0.02), seam, CX, -0.3, depth / 2 + 0.005);
  const shape = new THREE.Shape(); const hb = M.bot * SC;
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2 - 0.7, -hb - 1.3); shape.lineTo(0.2, -hb - 2.8); shape.lineTo(-0.2, -hb - 2.8); shape.lineTo(-W / 2 + 0.7, -hb - 1.3); shape.closePath();
  put(R, scaleUV(new THREE.ExtrudeGeometry(shape, { depth: depth * 0.9, bevelEnabled: false }), 1 / 1.6), [rockDeep, crust], CX, -0.34, -depth * 0.45);
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC, cx2 = (p.x0 + p.x1) / 2 * SC, cy = -p.y * SC;
    put(R, wbox(pw, 0.16, 1.3, 1.4), [rockSide, rockSide, rockTop, crust, rockSide, rockSide], cx2, cy - 0.08, 0, { cast: true, recv: true });
    put(R, new THREE.BoxGeometry(pw + 0.04, 0.045, 0.05), gold, cx2, cy - 0.01, 0.66);
    put(R, new THREE.BoxGeometry(pw - 0.1, 0.016, 0.016), seam, cx2, cy - 0.15, 0.66);
    for (const sx2 of [-1, 1]) put(R, new THREE.CylinderGeometry(0.014, 0.014, 9, 6), std({ color: 0x3a302a, metalness: 0.9, roughness: 0.4 }), cx2 + sx2 * (pw / 2 - 0.1), cy + 4.4, 0);
  }
  // 9/22 night: the painted plate (assets/bg_moon.jpg, a volcanic temple city with lava falls) was hidden
  // behind a flat 46x26 red wall, a Doge-coin emblem and two rows of 17-unit columns, 5.5 units behind the
  // fighters: the stage read as a dark red box with pillars through the fight. The wall, emblem and far
  // falls are gone so the painting shows; the lake only runs under the near ground; four columns frame
  // the edges instead of crowding the middle.
  // (the far lava lake plane is gone too: seen edge-on it aliased to a flat near-white sheet under the stage)
  const falls = [];
  // (the near lava pit went the same way: at the camera's grazing angle it read as a pale sheet)
  // carved columns, idol wall and braziers
  for (const [x, z] of [[-11.8, -4.2], [11.8, -4.2], [-15.5, -9], [15.5, -9]]) {
    const pl = new THREE.Group(); pl.position.set(x, 0, z); R.add(pl);
    put(pl, new THREE.CylinderGeometry(0.55, 0.68, 17, 14), carved, 0, 3.5, 0);
    for (const y of [-4.0, 1.6, 7.4]) put(pl, new THREE.TorusGeometry(0.66, 0.09, 8, 20), std({ color: 0xffc34a, metalness: 1, roughness: 0.3, emissive: 0x7a3a00, emissiveIntensity: 0.9 }), 0, y, 0, { rx: Math.PI / 2 });
  }
  const fires = [];
  for (const x of [-6.6, 6.6]) {   // the braziers' light stays; their cups stood on the removed columns
    const l = new THREE.PointLight(0xff9a30, 12, 10, 1.8); l.position.set(x, 3.3, -4.6); R.add(l); fires.push(l);
  }
  const smokes = [smokeStack(R, -10, 6, -16, 7, 16, 0x1a1210, 0.4), smokeStack(R, 8, 7, -20, 8, 18, 0x160f0e, 0.34)];
  g.add(new THREE.HemisphereLight(0x2e1a34, 0xff5218, 1.15));   // sky = cave, GROUND = the lava lake
  sunKey(g, 0x8a7aa8, 0.42, [-4, 9, 7], { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  const under = new THREE.PointLight(0xff5a10, 19, 17, 1.6); under.position.set(0, -3.0, 1.5); R.add(under);
  const lavaUp = new THREE.DirectionalLight(0xff6a24, 0.85); lavaUp.position.set(0, -7, 4); g.add(lavaUp);
  const rim = new THREE.DirectionalLight(0xff5a20, 1.15); rim.position.set(3, 2, -8); g.add(rim);
  g.userData.embers = 0xff8a2a;
  let lastT = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (const f of falls) f.material.uniforms.t.value = t;
    for (const m of smokes) m.material.map.offset.y = (m.material.map.offset.y - dt * 0.05) % 1;
    fires.forEach((f, i) => { if (f.isPointLight) f.intensity = 9 + Math.sin(t * 13 + i) * 2.5 + Math.sin(t * 7.7 + i) * 1.5; else f.material.opacity = 0.8 + Math.sin(t * 17 + i) * 0.18; });
    under.intensity = 13 + Math.sin(t * 5) * 3;
  };
  return g;
}

// ---------- Shadow Keep (rebuild: Japanese horror forest) ----------
function shideTex() {
  return canvasTex(128, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#f2f0e8'; c.beginPath(); c.moveTo(40, 0); c.lineTo(96, 0); c.lineTo(96, 80); c.lineTo(60, 80); c.lineTo(60, 140); c.lineTo(100, 140); c.lineTo(100, 210); c.lineTo(44, 210); c.lineTo(44, 150); c.lineTo(82, 150); c.lineTo(82, 92); c.lineTo(40, 92); c.closePath(); c.fill(); });
}
function buildKeep2(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC, depth = 2.6;
  scene.fog = new THREE.Fog(0x0a1018, 12, 52);
  g.add(skyDome(0x02040a, 0x0a1622, 0x0c1410));
  const leaf = tileMat('leaf', { m: { roughness: 0.62, metalness: 0.05 } });
  const cedar = tileMat('cedar', { m: { roughness: 0.92 } });
  const mossrock = tileMat('mossrock', { m: { roughness: 0.8 } });
  const lacquer = std({ color: 0x5e1410, roughness: 0.62, metalness: 0.05 });
  const wetWood = std({ color: 0x241c18, roughness: 0.55, metalness: 0.1 });
  // forest floor slab: wet leaf litter on a mossy stone base, puddles that catch the moon
  put(R, wbox(W, 0.3, depth, 3.0), [mossrock, mossrock, leaf, mossrock, mossrock, mossrock], CX, -0.15, 0, { recv: true });
  put(R, new THREE.CylinderGeometry(0.1, 0.1, W + 0.1, 12), mossrock, CX, -0.02, depth / 2, { rz: Math.PI / 2 });
  // (9/22 night) the hanging roots along the front edge read as black hooks: removed
  // (9/22 night) the puddles read as black holes in the floor: removed
  const shape = new THREE.Shape(); const hb = M.bot * SC;
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2 - 0.9, -hb - 1.4); shape.lineTo(-W / 2 + 0.9, -hb - 1.4); shape.closePath();
  put(R, scaleUV(new THREE.ExtrudeGeometry(shape, { depth: depth * 0.9, bevelEnabled: false }), 1 / 1.9), mossrock, CX, -0.3, -depth * 0.45);
  rubble(R, mossrock, M.x0 * SC + 0.4, M.x1 * SC - 0.4, -1.5, 0, depth * 0.8, 21);
  // platforms (9/22 night): were black cedar logs that read as floating black slabs. Now lit shrine-stone ledges with
  // a moss lip and a red paper lantern hung under each ("two ledges in the mist, red lanterns")
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  const ledgeStone = mossrock;
  const mossLip = leaf;   // the forest floor's own leaf litter on the ledge tops (a flat green lid read as cheap)
  const paper = std({ color: 0xc8281c, roughness: 0.7, emissive: 0xff3a1c, emissiveIntensity: 1.6 });
  const ledgeFires = [];
  for (const p of st.plats) {
    const pw = (p.x1 - p.x0) * SC, cx2 = (p.x0 + p.x1) / 2 * SC, cy = -p.y * SC;
    put(R, wbox(pw + 0.2, 0.26, 1.1, 0.5), ledgeStone, cx2, cy - 0.13, -0.05, { cast: true, recv: true });
    put(R, wbox(pw + 0.24, 0.05, 1.14, 0.5), mossLip, cx2, cy - 0.005, -0.05, { recv: true });
    for (const s2 of [-1, 1]) put(R, new THREE.CylinderGeometry(0.1, 0.13, 0.55, 8), ledgeStone, cx2 + s2 * (pw / 2 - 0.12), cy - 0.52, -0.2, { cast: true });
    const lan = new THREE.Group(); lan.position.set(cx2, cy - 0.42, -0.55); R.add(lan);   // behind the fighters: never over a face
    put(lan, new THREE.CylinderGeometry(0.004, 0.004, 0.28, 4), std({ color: 0x222222 }), 0, 0.14, 0);
    put(lan, new THREE.SphereGeometry(0.15, 16, 12), paper, 0, -0.08, 0, { s: [1, 1.25, 1] });
    for (const dy of [0.1, -0.26]) put(lan, new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), std({ color: 0x1a1210, roughness: 0.6 }), 0, dy, 0);
    const pl = new THREE.PointLight(0xff4a28, 2.2, 3.4, 1.8); pl.position.set(0, -0.08, 0.2); lan.add(pl);
    ledgeFires.push({ lan, pl, ph: Math.random() * 6 });
  }
  // (9/22 night) the procedural cedars, bamboo, torii and shrine stood in front of the painted plate (93 hides only the
  // arena's direct children behind z -4.8 and all of these sit one group deeper), so the painting's moonlit shrine
  // forest was buried under unlit black silhouettes: the painting has all of them, so none are built now.
  const trunks = [];
  // torii gates receding, shimenawa with shide, stone lanterns
  const shideT = shideTex();
  const torii = (x, z, s, rot) => {
    const t = new THREE.Group(); t.position.set(x, -0.3, z); t.scale.setScalar(s); t.rotation.y = rot || 0; R.add(t);
    for (const sx2 of [-1, 1]) put(t, new THREE.CylinderGeometry(0.17, 0.22, 5.2, 12), lacquer, sx2 * 2.1, 2.6, 0, { cast: true });
    put(t, new THREE.BoxGeometry(5.8, 0.34, 0.5), lacquer, 0, 5.25, 0, { rz: 0.015, cast: true });
    put(t, new THREE.BoxGeometry(6.2, 0.18, 0.3), std({ color: 0x1a0e0c, roughness: 0.7 }), 0, 5.55, 0);
    put(t, new THREE.BoxGeometry(4.6, 0.26, 0.34), lacquer, 0, 4.4, 0);
    const rope = put(t, new THREE.CylinderGeometry(0.1, 0.1, 3.6, 10), std({ color: 0xa89878, roughness: 1 }), 0, 4.0, 0.2, { rz: Math.PI / 2 });
    const sh = [];
    for (let k = 0; k < 5; k++) sh.push(put(t, new THREE.PlaneGeometry(0.22, 0.45), new THREE.MeshBasicMaterial({ map: shideT, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, color: 0xbfc8d0 }), -1.4 + k * 0.7, 3.7, 0.22));
    return sh;
  };
  const shides = [];
  const lanternFires = [];
  for (const [x, z, s] of [[-4.6, -1.6, 1], [4.9, -1.9, 1]]) {
    const L = new THREE.Group(); L.position.set(x, -0.3, z); L.scale.setScalar(s); R.add(L);
    put(L, new THREE.CylinderGeometry(0.36, 0.44, 0.16, 6), mossrock, 0, 0.08, 0, { cast: true });
    put(L, new THREE.CylinderGeometry(0.13, 0.16, 0.9, 8), mossrock, 0, 0.6, 0, { cast: true });
    put(L, new THREE.CylinderGeometry(0.32, 0.2, 0.14, 6), mossrock, 0, 1.12, 0);
    put(L, new THREE.CylinderGeometry(0.22, 0.22, 0.34, 6), std({ color: 0x241e1a, roughness: 0.9, emissive: 0xff7a20, emissiveIntensity: 0.8 }), 0, 1.36, 0);
    put(L, new THREE.ConeGeometry(0.5, 0.32, 6), mossrock, 0, 1.68, 0, { cast: true });
    const fl = sprite(L, 0xff9a40, 1.3, 0.8, 0, 1.36, 0.12, true);
    const pl = new THREE.PointLight(0xff8a30, 3.4, 4.6, 1.8); pl.position.set(0, 1.4, 0.3); L.add(pl);
    lanternFires.push(fl, pl);
  }
  // fog banks, moon shafts, fireflies of ghost light, a figure in the far dark, crows
  // mist banks start BEHIND the fight plane: the ones at z up to +1.5 sat between camera and fighters and, zoomed in on a
  // phone, covered the whole stage floor (runs/core5p keep)
  // 22 planes at opacity .3 packed into a 0.9-unit tall band stacked up into a SOLID grey slab with a
  // hard top edge -- it read as a wall across the stage, not as mist (runs/gfx/s_keep_*). Spread over a
  // 3.4-unit band with bigger, fainter planes so the alpha can never saturate and there is no edge.
  const fogs = fogBank(R, 26, [-17, 34, -2.6, 3.4, -0.9, 13], 0xaab8c8, 0.16, [12, 4.6]);
  const rays = shafts(R, [[-2.5, 6, -9, 3.2, 20, 0.16], [2.2, 7, -13, 4.4, 22, -0.12], [-6.5, 6, -16, 3.6, 22, 0.2]], 0xbfd4e8, 0.16);
  const ghosts = [];
  for (let k = 0; k < 6; k++) { const s2 = sprite(R, 0x9affd8, 1.2, 0.55, -6 + k * 2.4, 1 + (k % 3), -3 - (k % 4) * 2, true); ghosts.push({ s: s2, ph: Math.random() * 6.28, x: -6 + k * 2.4, y: 1 + (k % 3) }); }
  const figT = canvasTex(128, 256, (c, w, h) => { c.clearRect(0, 0, w, h); const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(6,8,10,.92)'); gr.addColorStop(1, 'rgba(6,8,10,.25)'); c.fillStyle = gr; c.beginPath(); c.ellipse(64, 54, 22, 26, 0, 0, 7); c.fill(); c.beginPath(); c.moveTo(30, 96); c.quadraticCurveTo(64, 70, 98, 96); c.lineTo(104, 250); c.lineTo(24, 250); c.closePath(); c.fill(); });
  const figure = put(R, new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshBasicMaterial({ map: figT, transparent: true, opacity: 0, depthWrite: false, fog: false }), 1.2, 0.8, -13.5);
  const crowT = canvasTex(64, 32, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = '#0a0c10'; c.lineWidth = 5; c.beginPath(); c.moveTo(4, 10); c.quadraticCurveTo(18, 22, 32, 17); c.quadraticCurveTo(46, 22, 60, 10); c.stroke(); });
  const crows = [];
  for (let k = 0; k < 5; k++) crows.push({ m: put(R, new THREE.PlaneGeometry(0.42, 0.2), new THREE.MeshBasicMaterial({ map: crowT, transparent: true, depthWrite: false }), -8 + k * 3, 5 + k % 3, -7 - k), ph: k * 1.3 });
  // (9/22 night) relit: the stage read as black shapes. Moon key from the painting's moon (upper left), a cool sky fill
  // and a soft front fill so stone and fighters read; the red and lantern lights stay for colour.
  g.add(new THREE.HemisphereLight(0x7890b8, 0x141a22, 1.0));
  const moon = sunKey(g, 0xa8c0f0, 1.5, [-6, 10, 5], { left: -9, right: 9, top: 7, bottom: -3, near: 1, far: 40 });
  const rim = new THREE.DirectionalLight(0x7a9ad0, 1.0); rim.position.set(4, 3, -8); g.add(rim);
  const frontFill = new THREE.DirectionalLight(0x8aa4cc, 0.55); frontFill.position.set(0, 2, 9); g.add(frontFill);
  const red = new THREE.DirectionalLight(0xff5a30, 0.35); red.position.set(-5, 1.5, -4); g.add(red);
  g.userData.embers = null;
  let lastT = 0, nextThunder = 6, thunder = 0, nextCrow = 4;
  g.userData.tick = t => {
    const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t;
    for (const f of fogs) { f.m.position.x += f.v * dt; if (f.m.position.x > f.x0 + f.w) f.m.position.x = f.x0; }
    rays.forEach((r, i) => { r.material.opacity = 0.12 + Math.sin(t * 0.4 + i) * 0.04; });
    ghosts.forEach((q, i) => { q.s.position.set(q.x + Math.sin(t * 0.3 + q.ph) * 1.6, q.y + Math.sin(t * 0.5 + q.ph * 2) * 0.5, q.s.position.z); q.s.material.opacity = 0.35 + Math.max(0, Math.sin(t * 0.7 + q.ph)) * 0.5; });
    shides.forEach((sh, i) => { sh.rotation.z = Math.sin(t * 1.6 + i) * 0.12; });
    lanternFires.forEach((f, i) => { if (f.isPointLight) f.intensity = 2.8 + Math.sin(t * 11 + i * 3) * 0.7 + (Math.random() - 0.5) * 0.4; else f.material.opacity = 0.75 + Math.sin(t * 15 + i) * 0.2; });
    const fc = (Math.sin(t * 0.09) + 1) / 2; figure.material.opacity = Math.max(0, Math.pow(fc, 6) * 0.75);
    figure.position.x = 1.2 + Math.sin(t * 0.05) * 2.5;
    for (const c of crows) { c.m.position.x += dt * 1.1; c.m.position.y += Math.sin(t * 2 + c.ph) * dt * 0.4; c.m.scale.y = 0.55 + Math.abs(Math.sin(t * 7 + c.ph)) * 0.7; if (c.m.position.x > 12) c.m.position.x = -12; }
    if (t > nextThunder) { thunder = 0.35; nextThunder = t + 9 + Math.random() * 12; }
    if (thunder > 0) { thunder -= dt; const k = Math.max(0, thunder) * (Math.random() < 0.5 ? 1 : 0.4); moon.intensity = 1.3 + k * 9; }
    else moon.intensity = 1.5;
    ledgeFires.forEach(L => { L.pl.intensity = 2 + Math.sin(t * 9 + L.ph) * 0.35; L.lan.rotation.z = Math.sin(t * 0.9 + L.ph) * 0.06; });
  };
  return g;
}

// ---------- Shibuya Crossing ----------
// SIGNAGE IS ORIGINAL. The real crossing is wall-to-wall trademarks, so none of it is reproduced:
// the brand names below are invented, and the dense signage is abstract rectilinear glyph blocks
// that read as a writing system at a distance without being one. No real marks anywhere.
const SH_BRANDS = ['KOMORA', 'VELTRA', 'NIXO', 'ORUMI', 'ZULO', 'BRAVA 8', 'TOKA', 'KESSEN'];
function shGlyphTex(seed, bg, fg) {
  return canvasTex(128, 512, (c, W, H) => {
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.strokeStyle = fg; c.lineWidth = 5; c.strokeRect(9, 9, W - 18, H - 18);
    // abstract glyphs: a few strokes on a 5x5 grid, never a real character
    let y = 46;
    for (let k = 0; k < 6; k++) {
      const cx = W / 2, s = 30 + ((seed + k) % 3) * 5;
      c.strokeStyle = fg; c.lineWidth = 7; c.lineCap = 'square';
      const n = 3 + ((seed * 7 + k * 13) % 3);
      for (let i = 0; i < n; i++) {
        const h = (seed * 31 + k * 17 + i * 53) % 16;
        const x0 = cx - s + (h % 4) * (s / 2), y0 = y - s / 2 + ((h >> 2) % 4) * (s / 3);
        c.beginPath();
        if (h % 2) { c.moveTo(x0, y0); c.lineTo(x0 + s * 0.7, y0); } else { c.moveTo(x0, y0); c.lineTo(x0, y0 + s * 0.7); }
        c.stroke();
      }
      y += 76;
    }
  });
}
function shBrandTex(name, bg, fg) {
  return canvasTex(512, 128, (c, W, H) => {
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.strokeStyle = fg; c.lineWidth = 5; c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = fg; c.font = 'bold 66px Bungee, Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = fg; c.shadowBlur = 18;
    c.fillText(name, W / 2, H / 2 + 3);
  });
}
function buildShibuya(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0x0a0a20, 18, 80);
  g.add(skyDome(0x03030c, 0x120a2a, 0x1a0a20));

  // ---------- materials ----------
  const shWall = dfPlasterMat('#7c7c96', { n: 0.5, rough: 0.82 });
  const shWall2 = dfPlasterMat('#8a8098', { n: 0.5, rough: 0.8 });
  const shTrim = dfPlasterMat('#aaaac0', { fine: true, n: 0.45, rough: 0.7 });
  const shDark = std({ color: 0x14141e, roughness: 0.5, metalness: 0.6 });
  const shEdge = std({ color: 0x5c5c70, roughness: 0.5, metalness: 0.4 });   // the slab's own edge: black reads as a hole
  const shSteel = std({ color: 0x2c2c38, roughness: 0.42, metalness: 0.9 });
  const shChrome = std({ color: 0xd8dce6, roughness: 0.12, metalness: 1, envMapIntensity: 1.5 });
  const shRoad = tileMat('asphalt', { m: { roughness: 0.2, metalness: 0.3, color: 0xc2c2d8, envMapIntensity: 1.2 } });
  const shWalk = tileMat('sidewalk', { m: { roughness: 0.42, metalness: 0.18, color: 0xd0d0de, envMapIntensity: 0.5 } });

  // ---------- the crossing ----------
  // zFront was 6.2: six units of near-black road between the fighters and the camera. 1.7 is what the fight needs.
  const zBack = -3.0, zFront = 1.7;
  // 9/22 night: the painted plate (assets/bg_shibuya.jpg: a photoreal rainy Shibuya crossing with the big
  // screens, buses and the crowd) was hidden behind two flat plaster towers, four far plaster blocks, a box
  // bus and sprite umbrellas, and the stage read as purple cardboard. Those are gone (the far road, towers
  // and far blocks are not built; the bus, car and crowd still exist for the tick but are hidden), so the
  // painting is the city and the 3D is only what the fight touches: the crossing, kerb, signals, canopies.
  // the play slab: a lifted section of the crossing, with a real edge
  put(R, wbox(W + 1.0, 0.34, zFront - zBack, 1.6), [shEdge, shEdge, shRoad, shEdge, shEdge, shEdge], CX, -0.17, (zFront + zBack) / 2, { recv: true, cast: true });
  put(R, wbox(W + 1.06, 0.05, zFront - zBack + 0.06, 1.0), shSteel, CX, 0.005, (zFront + zBack) / 2);
  // a neon edge on the near lip, so the stage reads as a stage against the painted road
  put(R, new THREE.BoxGeometry(W + 1.0, 0.03, 0.03), glow(0x22e6ff, 1.6), CX, 0.02, zFront + 0.02);
  put(R, new THREE.BoxGeometry(W + 0.9, 0.02, 0.02), glow(0xff4fd8, 1.3), CX, -0.3, zFront + 0.02);
  // scramble stripes: one merged mesh for the straight bars, one for the diagonal
  { const gs = [], sm = std({ color: 0xe8ecf4, roughness: 0.42, metalness: 0.08, polygonOffset: true, polygonOffsetFactor: -3 });
    for (let x = -4.5; x < 4.6; x += 0.62) gs.push(new THREE.PlaneGeometry(0.3, 1.8).rotateX(-Math.PI / 2).translate(x, 0.014, 0.55));
    for (let i = 0; i < 7; i++) gs.push(new THREE.PlaneGeometry(0.26, 1.5).rotateX(-Math.PI / 2).rotateY(0.9).translate(-3.6 + i * 1.2, 0.014, -2.0));
    const m = new THREE.Mesh(mergeGeometries(gs, false), sm); m.receiveShadow = true; R.add(m); }
  // far kerb and sidewalk
  put(R, wbox(30, 0.16, 0.3, 1.0), shTrim, 0, -0.04, zBack - 0.5, { recv: true });
  put(R, wbox(30, 0.1, 2.0, 1.4), [shEdge, shEdge, shWalk, shEdge, shEdge, shEdge], 0, 0.01, zBack - 1.6, { recv: true });
  dfShadowOn(R, 22, 0.5, 0, zBack - 0.24, { op: 0.4 });
  // drains, manholes, puddles that carry the signs down onto the wet road
  { const fr = [], sl = [];
    for (const gx of [-3.4, 1.9]) { fr.push([new THREE.BoxGeometry(0.6, 0.1, 0.32), gx, 0.01, zBack - 0.3]);
      for (let i = 0; i < 6; i++) sl.push([new THREE.BoxGeometry(0.48, 0.04, 0.03), gx, 0.05, zBack - 0.42 + i * 0.04]); }
    dfBatch(R, shSteel, fr, { cast: false }); dfBatch(R, std({ color: 0x0a0a0e, roughness: 0.9 }), sl, { cast: false }); }
  put(R, new THREE.CylinderGeometry(0.26, 0.26, 0.03, 16), std({ color: 0x3a3a44, roughness: 0.7, metalness: 0.5 }), 0.7, 0.012, 1.0);
  const shPudT = canvasTex(128, 64, (c, w2, h2) => {
    c.clearRect(0, 0, w2, h2); c.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) { const cx2 = w2 * (0.15 + Math.random() * 0.7), cy2 = h2 * (0.3 + Math.random() * 0.4);
      const rx = w2 * (0.1 + Math.random() * 0.2), ry = h2 * (0.18 + Math.random() * 0.26);
      const gr = c.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.max(rx, ry));
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.save(); c.translate(cx2, cy2); c.scale(rx / ry, 1); c.beginPath(); c.arc(0, 0, ry, 0, 7); c.fill(); c.restore(); } });
  const shPud = std({ color: 0x2a2a3e, roughness: 0.04, metalness: 0.55, envMapIntensity: 1.4, emissive: 0x6a4a9a, emissiveIntensity: 0.4, alphaMap: shPudT, transparent: true, depthWrite: false });
  for (const [x, z, w2, d2] of [[-3.0, 0.8, 3.2, 1.0], [1.4, 0.2, 3.6, 1.1], [3.8, 1.0, 2.2, 0.8]])
    put(R, new THREE.PlaneGeometry(w2, d2), shPud, x, 0.012, z, { rx: -Math.PI / 2 });
  // the neon coming back off the wet road
  const shSmearT = canvasTex(64, 256, (c, w2, h2) => {
    c.clearRect(0, 0, w2, h2);
    const gr = c.createLinearGradient(0, h2, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.4, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,.85)');
    c.fillStyle = gr; c.fillRect(0, 0, w2, h2);
    const hg = c.createLinearGradient(0, 0, w2, 0);
    hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.2, 'rgba(0,0,0,0)'); hg.addColorStop(0.8, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = hg; c.fillRect(0, 0, w2, h2); c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 0.5; c.fillStyle = 'rgba(0,0,0,.7)';
    for (let i = 0; i < 26; i++) c.fillRect(0, Math.random() * h2, w2, 1 + Math.random() * 4); c.globalAlpha = 1; });
  const shSmear = [];
  for (const [x, w2, col] of [[-3.6, 2.2, 0xff4fd8], [-0.6, 1.8, 0x22e6ff], [2.6, 2.2, 0xffd23f], [4.6, 1.6, 0xff4fd8]])
    shSmear.push(put(R, new THREE.PlaneGeometry(w2, 4.4), new THREE.MeshBasicMaterial({ map: shSmearT, color: col, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), x, 0.016, -0.5, { rx: -Math.PI / 2 }));

  // ---------- the two towers, both turned off the camera axis ----------
  const screens = [], shSignIM = [];
  // one instanced sign box per tower carries its whole vertical stack
  const shTower = (x, rot, w, h, d, zf, mat, hue) => {
    const T = new THREE.Group(); T.position.set(x, 0, zf - d / 2); T.rotation.y = rot; R.add(T);
    put(T, wbox(w, h, d, 0.7), mat, 0, h / 2 - 0.1, 0, { cast: true, recv: true });
    dfFace(T, { x: 0, y: 1.9, z: 0, w: w - 0.5, h: h - 2.6, d: d, cols: 4, rows: Math.max(3, Math.round((h - 2.6) / 1.5)),
      px: 0.3, py: 0.4, mat: mat, trim: shTrim, tile: 0.7, rev: 0.14, browD: 0.1, sillD: 0.08,
      litP: 0.55, litCol: 0xfff0d0, litK: 2.0, ac: true, mull: false,
      skyA: '#2a2352', skyB: '#3a2a66', skyC: '#150f2a' });
    dfCornice(T, { x: 0, y: h - 0.1, z: 0, w: w + 0.12, d: d + 0.1, mat: shTrim, steps: [[0.12, 0.1], [0.12, 0.18]] });
    // ground-floor shopfront, glowing from inside
    put(T, new THREE.BoxGeometry(w - 0.7, 1.5, 0.06), std({ color: 0x1a2030, roughness: 0.08, metalness: 0.8, emissive: 0xffd8a0, emissiveIntensity: 0.55 }), 0, 0.85, d / 2 - 0.04);
    put(T, wbox(w + 0.2, 0.14, d + 0.3, 0.5), shTrim, 0, 1.72, 0, { cast: true });
    // the vertical sign stack: boxes instanced, faces instanced, two calls for the lot
    const nSign = 5, boxG = new THREE.BoxGeometry(0.86, 1.15, 0.24), m4 = new THREE.Matrix4();
    const boxIM = new THREE.InstancedMesh(boxG, shDark, nSign);
    for (let i = 0; i < nSign; i++) { m4.makeTranslation(-w / 2 + 0.62, 2.5 + i * 1.32, d / 2 + 0.12); boxIM.setMatrixAt(i, m4); }
    boxIM.instanceMatrix.needsUpdate = true; boxIM.castShadow = true; T.add(boxIM);
    for (let i = 0; i < nSign; i++) {
      const vertical = i % 2 === 0;
      const tex = vertical ? shGlyphTex(i + hue, '#12101e', ['#ff4fd8', '#22e6ff', '#ffd23f', '#9affa0'][(i + hue) % 4])
                           : shBrandTex(SH_BRANDS[(i + hue) % SH_BRANDS.length], '#12101e', ['#22e6ff', '#ff4fd8', '#ffd23f'][(i + hue) % 3]);
      const pm = put(T, new THREE.PlaneGeometry(0.78, 1.04), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) }), -w / 2 + 0.62, 2.5 + i * 1.32, d / 2 + 0.245);
      shSignIM.push(pm);
    }
    // a big screen on the upper face
    const sc = holoTex(140 + hue * 47); screens.push(sc);
    put(T, new THREE.BoxGeometry(w * 0.66, h * 0.2, 0.12), shDark, w * 0.12, h * 0.66, d / 2 + 0.08, { cast: true });
    put(T, new THREE.PlaneGeometry(w * 0.62, h * 0.18), new THREE.MeshBasicMaterial({ map: sc, color: new THREE.Color(1.5, 1.5, 1.5) }), w * 0.12, h * 0.66, d / 2 + 0.15);
    // roof clutter: tanks, vents, a mast
    dfBatch(T, shSteel, [[new THREE.CylinderGeometry(0.34, 0.34, 0.7, 10), -w * 0.2, h + 0.35, -0.4],
                         [new THREE.BoxGeometry(0.5, 0.4, 0.5), w * 0.22, h + 0.2, 0.3],
                         [new THREE.BoxGeometry(0.06, 2.2, 0.06), w * 0.3, h + 1.1, -0.6]]);
    return T;
  };
  void shTower;

  // ---------- platforms: two island canopies and a sign bridge ----------
  const P = st.plats;
  const shCanopy = (p, col, flip) => {
    const x = (p.x0 + p.x1) / 2 * SC, w = (p.x1 - p.x0) * SC, y = -p.y * SC;
    const C = new THREE.Group(); C.position.set(x, 0, -0.55); C.rotation.y = flip ? -0.16 : 0.16; R.add(C);
    put(C, wbox(w + 0.5, 0.1, 1.5, 0.5), shTrim, 0, y - 0.05, 0, { cast: true, recv: true });
    put(C, wbox(w + 0.34, 0.06, 1.3, 0.5), shDark, 0, y - 0.13, 0);
    put(C, new THREE.BoxGeometry(w + 0.52, 0.035, 0.045), glow(col, 1.5), 0, y - 0.1, 0.76);
    for (const s2 of [-1, 1]) for (const z2 of [0.55, -0.55])
      put(C, new THREE.CylinderGeometry(0.045, 0.055, y - 0.12, 10), shChrome, s2 * (w / 2 + 0.1), (y - 0.12) / 2, z2, { cast: true });
    // a lit board on the back, and a bench under it
    const bt = shBrandTex(SH_BRANDS[flip ? 5 : 2], '#101828', flip ? '#ffd23f' : '#22e6ff');
    put(C, new THREE.BoxGeometry(w - 0.1, 0.72, 0.05), std({ map: bt, emissive: 0xffffff, emissiveMap: bt, emissiveIntensity: 0.9, roughness: 0.4 }), 0, 0.95, -0.6);
    put(C, wbox(w - 0.3, 0.07, 0.36, 0.4), shTrim, 0, 0.44, -0.3, { cast: true, recv: true });
    for (const s2 of [-1, 1]) put(C, new THREE.BoxGeometry(0.07, 0.44, 0.3), shTrim, s2 * (w / 2 - 0.28), 0.22, -0.3);
    dfShadowOn(R, w + 0.8, 0.7, x, -0.55, { op: 0.5 });
    const sc = holoTex(flip ? 300 : 210); screens.push(sc);
    put(C, new THREE.PlaneGeometry(w * 0.85, 0.6), new THREE.MeshBasicMaterial({ map: sc, color: new THREE.Color(1.35, 1.35, 1.35) }), 0, y + 0.42, -0.5);
    return C;
  };
  shCanopy(P[0], 0x22e6ff, false);
  shCanopy(P[1], 0xff4fd8, true);
  { const p = P[2], x = (p.x0 + p.x1) / 2 * SC, w = (p.x1 - p.x0) * SC, y = -p.y * SC;
    const B = new THREE.Group(); R.add(B);
    put(B, wbox(w + 0.5, 0.14, 1.1, 0.5), shSteel, x, y - 0.07, -0.5, { cast: true, recv: true });
    put(B, new THREE.BoxGeometry(w + 0.52, 0.03, 0.045), glow(0xffd23f, 1.5), x, y - 0.015, 0.02);
    for (const s2 of [-1, 1]) {
      const cx2 = x + s2 * (w / 2 + 0.25);
      put(B, new THREE.CylinderGeometry(0.06, 0.075, y - 0.14, 12), shChrome, cx2, (y - 0.14) / 2, -0.5, { cast: true });
      beam(B, shChrome, new THREE.Vector3(cx2, y - 0.6, -0.5), new THREE.Vector3(cx2 - s2 * 0.3, y - 0.22, -0.5), 0.02);
      dfShadowOn(R, 0.5, 0.42, cx2, -0.5, { op: 0.5 });
    }
    const sc = holoTex(410); screens.push(sc);
    put(B, new THREE.BoxGeometry(w + 0.2, 0.78, 0.1), shDark, x, y - 0.55, -0.5);
    put(B, new THREE.PlaneGeometry(w + 0.04, 0.64), new THREE.MeshBasicMaterial({ map: sc, color: new THREE.Color(1.5, 1.5, 1.5) }), x, y - 0.55, -0.43); }

  // ---------- mid-ground: the far side of the intersection ----------
  const shFar = [[-10.5, -12, 5.2, 12.5, 0.34, '#4e4a62'], [-3.5, -19, 6.0, 15.5, 0.2, '#57506a'],
                 [4.0, -16, 5.6, 13.5, -0.22, '#514c66'], [11.5, -23, 6.4, 16.5, -0.36, '#4a4860']];
  for (const [x, z, w2, h2, ry, col] of []) {   // was shFar: flat plaster blocks in front of the painting
    const m2 = dfPlasterMat(col, { n: 0.35, rough: 0.85 });
    put(R, wbox(w2, h2, 4.4, 0.8), m2, x, h2 / 2 - 0.3, z, { cast: true, recv: true, ry: ry });
    dfFace(R, { x: x, y: 1.2, z: z, ry: ry, w: w2 - 0.6, h: h2 - 2.2, d: 4.5, cols: 5, rows: Math.max(3, Math.round((h2 - 2.2) / 1.6)),
      px: 0.26, py: 0.34, mat: m2, trim: shTrim, tile: 0.8, rev: 0.12, browD: 0.1, sillD: 0.08,
      litP: 0.6, litCol: 0xffe8c0, litK: 2.1, ac: false, mull: false, brow: false,
      skyA: '#2a2352', skyB: '#3a2a66', skyC: '#150f2a' });
    // a lit sign band, invented brand, instanced would not help at four
    const bt = shBrandTex(SH_BRANDS[(Math.abs(Math.round(x)) + 1) % SH_BRANDS.length], '#0e0c1a', ['#ff4fd8', '#22e6ff', '#ffd23f'][Math.abs(Math.round(x)) % 3]);
    const bm = put(R, new THREE.PlaneGeometry(w2 * 0.8, 1.0), new THREE.MeshBasicMaterial({ map: bt, color: new THREE.Color(1.4, 1.4, 1.4) }), x, h2 * 0.62, z, { ry: ry });
    bm.translateZ(2.28);
  }
  // traffic signals on the far kerb, vending machines, steam
  { const poles = [], heads = [];
    for (const x of [-5.0, 5.2]) { poles.push([new THREE.CylinderGeometry(0.055, 0.075, 3.4, 10), x, 1.6, zBack - 0.8]);
      heads.push([new THREE.BoxGeometry(0.2, 0.58, 0.18), x, 3.3, zBack - 0.8]); }
    dfBatch(R, shDark, poles.concat(heads)); }
  for (const x of [-5.0, 5.2]) for (let k = 0; k < 3; k++)
    put(R, new THREE.CircleGeometry(0.055, 12), glow([0xff2a2a, 0xffd23f, 0x2aff6a][k], k === 2 ? 1.8 : 0.35), x, 3.48 - k * 0.18, zBack - 0.7);
  { const vends = [], faces = [];
    for (let k = 0; k < 4; k++) { const x = -3.4 + k * 2.3;
      vends.push([wbox(0.62, 1.05, 0.52, 0.5), x, 0.58, zBack - 1.9]);
      faces.push([new THREE.PlaneGeometry(0.5, 0.8), x, 0.62, zBack - 1.63]); }
    dfBatch(R, shDark, vends);
    dfBatch(R, glowA(0x9ad8ff, 0.9, 0.8), faces, { cast: false, recv: false }); }
  const steamers = [smokeStack(R, -2.0, 1.4, zBack - 1.2, 0.9, 2.4, 0xcfd8ff, 0.13), smokeStack(R, 3.0, 1.6, zBack - 1.6, 1.1, 2.8, 0xcfd8ff, 0.11)];
  // a bus and a car crossing behind the far kerb
  const shBus = new THREE.Group(); shBus.position.set(-12, 0, zBack - 3.4); R.add(shBus);
  put(shBus, wbox(4.4, 1.6, 1.7, 1.2), std({ color: 0x8a8fa6, roughness: 0.38, metalness: 0.55 }), 0, 0.98, 0, { cast: true });
  put(shBus, new THREE.BoxGeometry(4.2, 0.52, 1.72), glowA(0xffe0b0, 0.9, 0.8), 0, 1.3, 0);
  { const wg = new THREE.CylinderGeometry(0.27, 0.27, 0.16, 12).rotateX(Math.PI / 2), wl = [];
    for (const dx of [-1.6, 1.6]) for (const dz of [0.78, -0.78]) wl.push([wg, dx, 0.27, dz]);
    dfBatch(shBus, shDark, wl); }
  const shCar = dfCar(R, { x: 10, z: zBack - 3.0, L: 3.0, w: 1.15, col: 0x22303e, ry: Math.PI, lampK: 2.2 });
  // far crowd: umbrellas, one instanced mesh, no faces and no readable marks
  const shUmbT = canvasTex(64, 64, (c, w2, h2) => { c.clearRect(0, 0, w2, h2); c.fillStyle = '#1a1a26'; c.beginPath(); c.arc(32, 34, 26, Math.PI, 0); c.fill(); c.fillRect(30, 34, 4, 26); });
  const shCrowdN = 22, shCrowd = [];
  const shCrowdIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.72, 0.72), new THREE.MeshBasicMaterial({ map: shUmbT, transparent: true, depthWrite: false, opacity: 0.85 }), shCrowdN);
  for (let k = 0; k < shCrowdN; k++) shCrowd.push({ x: -14 + Math.random() * 28, y: 0.62 + Math.random() * 0.2, z: zBack - 2.4 - Math.random() * 5, v: (Math.random() - 0.5) * 0.55 });
  shCrowdIM.frustumCulled = false; R.add(shCrowdIM);
  shBus.visible = false; shCar.visible = false; shCrowdIM.visible = false; void shFar;

  // ---------- light ----------
  // no sun on a crossing at midnight: the screens and the signs are the light, and the hemisphere's
  // GROUND term is the glow coming back off the wet road
  g.add(new THREE.HemisphereLight(0x5a5aa8, 0x7a4aa0, 2.0));
  sunKey(g, 0xa8b4ee, 0.95, [-5, 9, 7], { left: -11, right: 11, top: 8, bottom: -3, near: 1, far: 44 });
  const shUp = new THREE.DirectionalLight(0x9a5aff, 0.85); shUp.position.set(0, -6, 4); g.add(shUp);
  const shRimA = new THREE.DirectionalLight(0xff4fd8, 1.9); shRimA.position.set(6, 3, -6); g.add(shRimA);
  const shRimB = new THREE.DirectionalLight(0x22e6ff, 1.7); shRimB.position.set(-6, 3, -6); g.add(shRimB);
  const shSignL = new THREE.PointLight(0x22e6ff, 2.2, 7, 2); shSignL.position.set(-2.6, 3.2, 0.6); g.add(shSignL);
  const shSignR = new THREE.PointLight(0xff4fd8, 2.2, 7, 2); shSignR.position.set(2.8, 3.4, 0.6); g.add(shSignR);
  g.userData.rain = true; g.userData.embers = null;
  let shLast = 0, shK0 = 0;
  const shTmp = new THREE.Matrix4();
  g.userData.tick = t => {
    const dt = Math.min(0.1, shLast ? t - shLast : 0.016); shLast = t;
    if (t - shK0 > 0.12) { shK0 = t; screens.forEach((sc, i) => sc.userData.draw(t * (3 + i % 4))); }
    for (const m of steamers) m.material.map.offset.y = (m.material.map.offset.y - dt * 0.07) % 1;
    shBus.position.x += dt * 1.2; if (shBus.position.x > 15) shBus.position.x = -15;
    shCar.position.x -= dt * 1.9; if (shCar.position.x < -14) shCar.position.x = 14;
    for (let i = 0; i < shCrowdN; i++) {
      const c = shCrowd[i]; c.x += c.v * dt;
      if (c.x > 15) c.x = -15; if (c.x < -15) c.x = 15;
      shTmp.makeTranslation(c.x, c.y + Math.sin(t * 2.4 + i) * 0.035, c.z); shCrowdIM.setMatrixAt(i, shTmp);
    }
    shCrowdIM.instanceMatrix.needsUpdate = true;
    for (const s of shSmear) s.material.opacity = 0.14 + Math.sin(t * 1.9 + s.position.x) * 0.04;
    const fl = 1 + Math.sin(t * 3.3) * 0.12;
    shSignL.intensity = 2.2 * fl; shSignR.intensity = 2.2 * (2 - fl);
  };
  return g;
}

// ---------- Baghdad Bazaar ----------
// A market street, nothing else in it. Ornament only and no writing anywhere: the lattice and tile
// patterns are traditional vernacular geometry, which is not anyone's mark, and that sidesteps
// approximating a script as decoration. No conflict imagery.
function rugTex() {
  return canvasTex(256, 256, (c, w, h) => {
    const base = ['#8a2a20', '#1a4a58', '#7a5a18', '#3a2a5a'][Math.floor(Math.random() * 4)];
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8d8a8'; c.lineWidth = 6; c.strokeRect(12, 12, w - 24, h - 24); c.lineWidth = 3; c.strokeRect(26, 26, w - 52, h - 52);
    c.fillStyle = '#e8d8a8';
    for (let y = 44; y < h - 40; y += 34) for (let x = 44; x < w - 40; x += 34) { c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + 12, y); c.lineTo(x, y + 10); c.lineTo(x - 12, y); c.closePath(); c.fill(); }
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  });
}
// a wall panel with a pointed arch cut through it: real opening, real thickness, real reveal
function bgArchGeo(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  const ow = w * 0.6, spring = h * 0.46, hole = new THREE.Path();
  hole.moveTo(-ow / 2, 0); hole.lineTo(-ow / 2, spring);
  hole.quadraticCurveTo(-ow / 2, h * 0.84, 0, h * 0.9);
  hole.quadraticCurveTo(ow / 2, h * 0.84, ow / 2, spring);
  hole.lineTo(ow / 2, 0); hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 7 });
  g.translate(0, 0, -d / 2);
  return scaleUV(g, 1 / 1.4);
}
// carved wooden lattice, the signature of the street; drawn, never photographed
function bgLatticeTex() {
  return canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#2a1a0e'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#7a5227'; c.lineWidth = 7; c.lineCap = 'round';
    const s = 32;
    for (let y = 0; y <= h; y += s) for (let x = 0; x <= w; x += s) {
      c.beginPath(); c.moveTo(x, y - s / 2); c.lineTo(x + s / 2, y); c.lineTo(x, y + s / 2); c.lineTo(x - s / 2, y); c.closePath(); c.stroke();
    }
    c.strokeStyle = '#a6763a'; c.lineWidth = 3;
    for (let y = s / 2; y <= h; y += s) for (let x = s / 2; x <= w; x += s) { c.beginPath(); c.arc(x, y, 7, 0, 7); c.stroke(); }
  });
}
function buildBaghdad(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0xd8b184, 16, 68);
  g.add(skyDome(0x6a86c0, 0xf0d0a0, 0xe8c898));

  // ---------- materials ----------
  const bgMud = dfPlasterMat('#a4855e', { n: 0.75, rough: 0.94 });
  const bgMud2 = dfPlasterMat('#967a56', { n: 0.75, rough: 0.94 });
  const bgTrim = dfPlasterMat('#bfa87e', { fine: true, n: 0.5, rough: 0.9 });
  const bgShade = dfPlasterMat('#65503a', { fine: true, n: 0.5, rough: 0.92 });
  const bgStone = tileMat('sidewalk', { m: { roughness: 0.95, metalness: 0.05, color: 0xa89070, envMapIntensity: 0.3 } });
  const bgWood = std({ color: 0x5a3a1e, roughness: 0.78 });
  const bgLat = std({ map: bgLatticeTex(), roughness: 0.8, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02 });
  const bgBrass = std({ color: 0xc8a24a, roughness: 0.3, metalness: 1, envMapIntensity: 1.2 });

  // ---------- the street ----------
  // pushed well forward: Z costs nothing in gameplay terms, and it keeps the painted plate out of
  // the foreground at every framing the camera uses
  // 9/22 night: the painted plate (assets/bg_baghdad.jpg, a sunlit souk street with carpets, lamps and the
  // mosque) was hidden behind two giant blank plaster houses, a plaster arcade, palms and lamp strings: the
  // stage read as cardboard boxes. Those are not built any more; the painting is the city and the 3D is what
  // the fight touches. zFront was 6.2 (a big empty foreground of paving); 1.8 is what the fight needs.
  const zHouse = -2.4, zFront = 1.8;
  put(R, wbox(W + 2.4, 0.3, zFront - zHouse + 0.4, 1.5), [bgShade, bgShade, bgStone, bgShade, bgShade, bgShade], CX, -0.15, (zFront + zHouse) / 2, { recv: true, cast: true });
  // the drainage channel down the middle of the street, worn paving joints, loose stones
  put(R, wbox(0.42, 0.06, zFront - zHouse, 0.5), bgShade, 0.3, -0.005, (zFront + zHouse) / 2, { recv: true });
  { const js = [], jm = dfPlasterMat('#6d5b42', { fine: true, n: 0.5, rough: 0.96 });
    for (let z = zHouse + 0.7; z < zFront; z += 1.35) js.push([new THREE.BoxGeometry(W + 2.2, 0.02, 0.025), CX, 0.004, z]);
    for (let x = -5.0; x < 5.4; x += 1.65) js.push([new THREE.BoxGeometry(0.025, 0.02, zFront - zHouse), x, 0.004, (zFront + zHouse) / 2]);
    dfBatch(R, jm, js, { cast: false }); }
  // (the loose stones went: smooth beige spheres read as eggs on the street)
  dfShadowOn(R, W + 2.4, 0.8, CX, zHouse + 0.35, { op: 0.45 });

  // ---------- the two houses, both turned off the camera axis ----------
  const P = st.plats, p0 = P[0], p1 = P[1], p2 = P[2];
  const bgHouse = (x, rot, w, h, d, mat, opts) => {
    const H = new THREE.Group(); H.position.set(x, 0, zHouse - d / 2); H.rotation.y = rot; R.add(H);
    put(H, wbox(w, h, d, 0.9), mat, 0, h / 2 - 0.1, 0, { cast: true, recv: true });
    // small deep openings, which is what this vernacular actually has, and the raking sun loves them
    dfFace(H, { x: 0, y: 2.5, z: 0, w: w - 0.7, h: h - 3.2, d: d, cols: 3, rows: Math.max(2, Math.round((h - 3.2) / 1.5)),
      px: 0.52, py: 0.5, mat: mat, trim: bgTrim, tile: 0.9, rev: 0.26, browD: 0.16, sillD: 0.13,
      litP: 0.12, litCol: 0xffc070, litK: 0.6, ac: false, mull: false,
      skyA: '#3a3a44', skyB: '#2a2620', skyC: '#140f0a' });
    // parapet with crenellation: the roofline is most of the silhouette
    put(H, wbox(w + 0.16, 0.34, d + 0.14, 0.5), bgTrim, 0, h + 0.07, 0, { cast: true, recv: true });
    { const cr = [];
      for (let i = 0; i <= 7; i++) cr.push([wbox(w / 9, 0.3, d * 0.3, 0.4), -w / 2 + 0.1 + i * (w - 0.2) / 7, h + 0.38, d / 2 - d * 0.16]);
      dfBatch(H, mat, cr); }
    // roof clutter
    dfBatch(H, bgShade, [[new THREE.CylinderGeometry(0.3, 0.26, 0.5, 10), w * 0.22, h + 0.5, -0.3],
                         [new THREE.BoxGeometry(0.42, 0.34, 0.42), -w * 0.26, h + 0.4, 0.2]]);
    if (opts.arcade) {
      // ground-floor arcade: three real arched openings you can see into
      const aw = (w - 0.4) / 3;
      for (let i = 0; i < 3; i++) put(H, bgArchGeo(aw, 2.3, d * 0.55), mat, -w / 2 + 0.2 + aw * (i + 0.5), 0, d / 2 - d * 0.275, { cast: true, recv: true });
      put(H, new THREE.PlaneGeometry(w - 0.4, 2.3), std({ color: 0x241c14, roughness: 0.95 }), 0, 1.15, d / 2 - d * 0.56);
    } else {
      // a deep recessed doorway instead
      put(H, bgArchGeo(1.5, 2.2, d * 0.5), mat, -w * 0.18, 0, d / 2 - d * 0.25, { cast: true, recv: true });
      put(H, new THREE.PlaneGeometry(1.2, 2.2), std({ color: 0x241c14, roughness: 0.95 }), -w * 0.18, 1.1, d / 2 - d * 0.52);
    }
    return H;
  };
  void bgHouse;

  // ---------- the mashrabiya (soft platform 1) on the right house ----------
  { const bx = (p1.x0 + p1.x1) / 2 * SC, bw = (p1.x1 - p1.x0) * SC, by = -p1.y * SC;
    const B = new THREE.Group(); B.position.set(bx, 0, -0.55); B.rotation.y = 0.19; R.add(B);
    put(B, wbox(bw + 0.3, 0.12, 1.5, 0.5), bgWood, 0, by - 0.06, 0, { cast: true, recv: true });
    // an OPEN balcony: a low carved lattice rail (the full-height lattice box and its roof hid whoever
    // stood on it behind a screen, 9/22 night), a rail cap, and slim brackets under the floor
    put(B, new THREE.BoxGeometry(bw + 0.2, 0.3, 0.04), bgLat, 0, by + 0.15, 0.72);
    for (const s2 of [-1, 1]) put(B, new THREE.BoxGeometry(0.04, 0.3, 1.4), bgLat, s2 * (bw / 2 + 0.1), by + 0.15, 0.02);
    put(B, new THREE.BoxGeometry(bw + 0.26, 0.05, 0.08), bgWood, 0, by + 0.32, 0.72, { cast: true });
    { const cb = [];
      for (let k = 0; k < 4; k++) cb.push([new THREE.BoxGeometry(0.055, 0.3, 0.5), -bw / 2 + 0.12 + k * (bw - 0.24) / 3, by - 0.24, 0.3]);
      dfBatch(B, bgWood, cb); }
    // it hung off the right house; with the house gone it stands on its own carved posts
    { const po = [];
      for (const s2 of [-1, 1]) for (const z2 of [0.62, -0.62]) po.push([new THREE.CylinderGeometry(0.055, 0.07, by - 0.12, 8), s2 * (bw / 2 + 0.02), (by - 0.12) / 2, z2]);
      dfBatch(B, bgWood, po); } }

  // ---------- the hanging deck (soft platform 2) ----------
  // was the sabat, a covered bridge from house to house; the houses are gone, so it is a carved wooden deck
  // with a lattice apron, hung on ropes from above like a market sign
  { const tx = (p2.x0 + p2.x1) / 2 * SC, tw = (p2.x1 - p2.x0) * SC, ty = -p2.y * SC;
    const S = new THREE.Group(); S.position.set(tx, 0, -0.6); R.add(S);
    put(S, wbox(tw + 0.3, 0.14, 1.5, 0.5), bgWood, 0, ty - 0.07, 0, { cast: true, recv: true });
    put(S, wbox(tw + 0.4, 0.06, 1.6, 0.4), bgTrim, 0, ty - 0.17, 0, { cast: true });
    put(S, new THREE.BoxGeometry(tw * 0.9, 0.34, 0.04), bgLat, 0, ty - 0.38, 0.72);
    { const rp = [], rm = std({ color: 0x6a5238, roughness: 1 });
      for (const s2 of [-1, 1]) for (const z2 of [0.55, -0.55]) rp.push([new THREE.CylinderGeometry(0.014, 0.014, 9, 5), s2 * (tw / 2 + 0.05), ty + 4.5, z2]);
      dfBatch(S, rm, rp, { cast: false }); } }

  // ---------- the market stall (soft platform 0) ----------
  const awnT = canvasTex(256, 64, (c, w, h) => {
    for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? '#e8dcc0' : '#9a4a2a'; c.fillRect(i * w / 9, 0, w / 9, h); }
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(90,70,40,${Math.random() * 0.2})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } });
  const bgRugs = [], bgAwnM = std({ map: awnT, roughness: 0.92, side: THREE.DoubleSide });
  { const ax = (p0.x0 + p0.x1) / 2 * SC, aw = (p0.x1 - p0.x0) * SC, ay = -p0.y * SC;
    const A = new THREE.Group(); A.position.set(ax, 0, -0.35); A.rotation.y = -0.14; R.add(A);
    // a sagging fabric shade, not a flat board
    const sg = new THREE.PlaneGeometry(aw + 0.5, 1.7, 6, 3), sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) { const u = sp.getX(i) / (aw + 0.5), v = sp.getY(i) / 1.7;
      sp.setZ(i, Math.cos(u * Math.PI) * 0.1 + Math.cos(v * Math.PI) * 0.12 - 0.12); }
    sg.computeVertexNormals();
    put(A, sg, bgAwnM, 0, ay - 0.02, 0, { rx: -Math.PI / 2, cast: true, recv: true });
    put(A, new THREE.BoxGeometry(aw + 0.5, 0.14, 0.03), bgAwnM, 0, ay - 0.12, 0.86);
    { const pl = [];
      for (const s2 of [-1, 1]) for (const z2 of [0.78, -0.72]) pl.push([new THREE.CylinderGeometry(0.052, 0.06, ay - 0.04, 8), s2 * (aw / 2 + 0.16), (ay - 0.04) / 2, z2]);
      dfBatch(A, bgWood, pl); }
    for (let k = 0; k < 4; k++) bgRugs.push(put(A, new THREE.PlaneGeometry(0.78, 1.2), std({ map: rugTex(), roughness: 0.95, side: THREE.DoubleSide }), -aw / 2 + 0.36 + k * (aw - 0.7) / 3, ay - 0.72, -0.78));
    // sacks of spice, crates and jars under the shade
    { const sk = [], cr = [];
      for (let k = 0; k < 5; k++) sk.push([new THREE.CylinderGeometry(0.15, 0.22, 0.34, 9), -aw / 2 + 0.3 + k * (aw - 0.5) / 4, 0.17, 0.42]);
      for (let k = 0; k < 3; k++) cr.push([new THREE.BoxGeometry(0.44, 0.36, 0.38), -aw / 2 + 0.5 + k * 0.62, 0.18, -0.2]);
      dfBatch(A, dfPlasterMat('#b8a074', { n: 0.9, rough: 0.97 }), sk);
      dfBatch(A, bgWood, cr); }
    const spice = [0xd8571e, 0xe8a81e, 0x8a2a20, 0x5a6a20, 0xb0602a];
    for (let k = 0; k < 5; k++) put(A, new THREE.ConeGeometry(0.135, 0.15, 10), std({ color: spice[k], roughness: 1 }), -aw / 2 + 0.3 + k * (aw - 0.5) / 4, 0.4, 0.42);
    for (const [x2, z2] of [[-aw * 0.3, -0.5], [aw * 0.3, -0.56]])
      put(A, new THREE.LatheGeometry([new THREE.Vector2(0.02, 0), new THREE.Vector2(0.16, 0.08), new THREE.Vector2(0.2, 0.22), new THREE.Vector2(0.1, 0.34), new THREE.Vector2(0.13, 0.4)], 14), std({ color: 0xa8704a, roughness: 0.88 }), x2, 0, z2, { cast: true });
    dfShadowOn(R, aw + 1.2, 1.4, ax, -0.35, { op: 0.45 }); }

  // (the plaster arcade receding down the alley and its fabric shades are gone: the painting is the alley)
  const bgRays = shafts(R, [[-1.4, 5.4, -9, 2.2, 14, 0.3], [1.2, 5.6, -14, 2.6, 16, 0.26], [-0.6, 5.4, -20, 2.4, 15, 0.28]], 0xffe0a0, 0.15);
  // hanging brass lamps on two strung cables
  const bgLamps = [];
  { const cableM = std({ color: 0x2a2018, roughness: 0.9 });
    for (const [y, z] of []) {   // the strung lamps hung between the houses; the painting has its own
      cable(R, cableM, new THREE.Vector3(-6.2, y, z), new THREE.Vector3(6.2, y - 0.1, z), 0.5, 0.012);
      for (let k = 1; k < 7; k++) {
        const x = -6.2 + k * 12.4 / 7, sag = Math.sin(k / 7 * Math.PI) * 0.5;
        const L = new THREE.Group(); L.position.set(x, y - sag, z); R.add(L);
        put(L, new THREE.LatheGeometry([new THREE.Vector2(0.01, 0.2), new THREE.Vector2(0.12, 0.08), new THREE.Vector2(0.14, -0.05), new THREE.Vector2(0.05, -0.16)], 10), bgBrass, 0, 0, 0);
        bgLamps.push(sprite(L, 0xffc070, 1.0, 0.5, 0, -0.02, 0.02, true));
      }
    } }
  // palms over the rooftops, real trunks
  // (palms: the painting has them)
  // dust
  const NM = 90, mPos = new Float32Array(NM * 3), motes = [];
  for (let i = 0; i < NM; i++) motes.push({ x: (Math.random() - 0.5) * 16, y: Math.random() * 5, z: 1 - Math.random() * 9, s: Math.random() * 6 });
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  const moteP = new THREE.Points(mg, new THREE.PointsMaterial({ color: new THREE.Color(1.8, 1.4, 0.9), size: 0.03, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  moteP.frustumCulled = false; R.add(moteP);
  const bgHaze = smokeStack(R, 8, 8, -22, 11, 16, 0xd8c0a0, 0.18);

  // ---------- light ----------
  // late afternoon down a narrow street: the sun rakes in low from one end, everything else is
  // bounce off warm plaster, and the deep openings do the rest
  g.add(new THREE.HemisphereLight(0x9fc0e8, 0x8a6a44, 0.8));
  const bgSun = sunKey(g, 0xffdca4, 2.35, [9.5, 4.2, 5.0], { left: -12, right: 12, top: 9, bottom: -3, near: 1, far: 46 });
  const bgBack = new THREE.DirectionalLight(0xff8a42, 0.9); bgBack.position.set(10, 1.6, -7); g.add(bgBack);
  const bgFill = new THREE.DirectionalLight(0xa8c4ea, 0.3); bgFill.position.set(-5, 5, 9); g.add(bgFill);
  const bgBounce = new THREE.DirectionalLight(0xffc48c, 0.35); bgBounce.position.set(-1, -3, 6); g.add(bgBounce);
  g.userData.embers = null;
  let bgLast = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, bgLast ? t - bgLast : 0.016); bgLast = t;
    for (let i = 0; i < NM; i++) { const m = motes[i]; mPos[i * 3] = m.x + Math.sin(t * 0.25 + m.s) * 0.5; mPos[i * 3 + 1] = (m.y + t * 0.05 + m.s) % 5; mPos[i * 3 + 2] = m.z; }
    mg.attributes.position.needsUpdate = true;
    bgRays.forEach((r, i) => { r.material.opacity = 0.1 + Math.sin(t * 0.35 + i) * 0.03; });
    bgLamps.forEach((l, i) => { l.material.opacity = 0.7 + Math.sin(t * 4.5 + i * 1.7) * 0.14; });
    bgRugs.forEach((r, i) => { r.rotation.z = Math.sin(t * 0.9 + i) * 0.022; });
    bgHaze.material.map.offset.y = (bgHaze.material.map.offset.y - dt * 0.03) % 1;
  };
  return g;
}

// ================= dimensional facade kit (df*) =================
// Why this exists: a wall painted on a box reads as cardboard from any angle the camera moves to,
// and the camera here moves constantly. So a building is built as a VOLUME: the wall is a grid of
// piers and spandrels with real holes punched through it, which means every window has a reveal
// that self-shadows under a raking sun, and a brow, a sill and a pane that sit at different depths.
// Everything repeated (panes, brows, sills, balusters, treads, fronds, far-block windows) rides an
// InstancedMesh and everything static merges, so a 3-storey block costs ~6 draw calls, not 200.
// Visual only: Math.random only, never rand/irand/Rng, never touches fight state.
const dfC = { plaster: {}, frond: null, room: null, rust: null };
// tiling value noise -> a height field, used for both the mottle and the normal map so they agree
function dfLattice(size, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = Math.random();
  const out = new Float32Array(size * size), s = size / cells;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const i0 = (iy % cells) * cells, i1 = ((iy + 1) % cells) * cells, jx = ix % cells, jx1 = (ix + 1) % cells;
    const top = g[i0 + jx] + (g[i0 + jx1] - g[i0 + jx]) * tx, bot = g[i1 + jx] + (g[i1 + jx1] - g[i1 + jx]) * tx;
    out[y * size + x] = top + (bot - top) * ty;
  }
  return out;
}
function dfFbm(size, octaves, cells0) {
  const out = new Float32Array(size * size);
  let amp = 0.5, cells = cells0 || 4, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const n = dfLattice(size, cells);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
// height field -> tangent-space normal map. Stays linear on purpose (an sRGB normal map is wrong).
function dfNormal(size, h, k) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), im = g.createImageData(size, size), d = im.data;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k * 7, dy = (at(x, y + 1) - at(x, y - 1)) * k * 7;
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = QUAL.aniso;
  return t;
}
// stucco / plaster: mottled albedo + the matching normal, so a raking sun finds something to catch
function dfPlaster(hex, o = {}) {
  const key = hex + '|' + (o.k || 1) + '|' + (o.streak || 1);
  if (dfC.plaster[key]) return dfC.plaster[key];
  const S = 256, h = dfFbm(S, 5, o.coarse ? 4 : 24), col = new THREE.Color(hex);
  const map = canvasTex(S, S, (c, W, H) => {
    const im = c.createImageData(W, H), d = im.data;
    for (let i = 0; i < W * H; i++) {
      const v = 0.93 + h[i] * 0.15;
      d[i * 4] = Math.min(255, col.r * 255 * v); d[i * 4 + 1] = Math.min(255, col.g * 255 * v);
      d[i * 4 + 2] = Math.min(255, col.b * 255 * v); d[i * 4 + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    // trowel sweeps and a few hairline cracks: without them a wall is a gradient, and gradients read flat
    for (let i = 0; i < 70 * (o.streak || 1); i++) {
      c.globalAlpha = 0.02 + Math.random() * 0.03; c.strokeStyle = i % 2 ? '#ffffff' : '#000000';
      c.lineWidth = 1 + Math.random() * 3; const y = Math.random() * H;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(W / 3, y + (Math.random() - 0.5) * 12, 2 * W / 3, y + (Math.random() - 0.5) * 12, W, y); c.stroke();
    }
    c.globalAlpha = 0.1; c.strokeStyle = '#000'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) { let x = Math.random() * W, y = Math.random() * H; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (Math.random() - 0.5) * 22; y += Math.random() * 16; c.lineTo(x, y); } c.stroke(); }
    c.globalAlpha = 1;
  }, [1, 1]);
  const rough = canvasTex(S, S, (c, W, H) => {
    const im = c.createImageData(W, H), d = im.data;
    for (let i = 0; i < W * H; i++) { const v = (0.55 + h[i] * 0.45) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    c.putImageData(im, 0, 0);
  }, [1, 1]);
  rough.colorSpace = THREE.NoColorSpace;
  return dfC.plaster[key] = { map, normalMap: dfNormal(S, h, o.k || 1.6), roughnessMap: rough };
}
const dfMatC = {};
function dfPlasterMat(hex, o = {}) {
  // cached: without this every wall, band and bracket made its own material and the stage ended up
  // with 190+ of them, which is both draw calls and shader permutations for nothing
  const key = hex + '|' + (o.k || 1) + '|' + (o.n || 0) + '|' + (o.rough || 0) + '|' + (o.fine ? 1 : 0) + '|' + (o.proc ? 1 : 0) + '|' + JSON.stringify(o.m || 0);
  if (dfMatC[key]) return dfMatC[key];
  let m;
  if (o.proc) {
    const p = dfPlaster(hex, o);
    m = std(Object.assign({ map: p.map, normalMap: p.normalMap, roughnessMap: p.roughnessMap,
      normalScale: new THREE.Vector2(o.n || 0.18, o.n || 0.18), roughness: o.rough != null ? o.rough : 0.85,
      metalness: 0, envMapIntensity: 0.1 }, o.m || {}));
  } else {
    const f = o.fine ? 'stg_castst' : 'stg_plaster';
    const map = sTex(f + '.jpg'), nrm = sTex(f + '_n.jpg', 1, 1, false, true);
    m = std(Object.assign({ color: new THREE.Color(hex), map: map, normalMap: nrm, roughnessMap: map,
      normalScale: new THREE.Vector2(o.n != null ? o.n : 0.7, o.n != null ? o.n : 0.7),
      roughness: o.rough != null ? o.rough : 0.88, metalness: 0, envMapIntensity: 0.1 }, o.m || {}));
  }
  return dfMatC[key] = m;
}
// what you see through a window: a dark room with a warm bar of light at the back
function dfRoomTex() {
  return dfC.room || (dfC.room = canvasTex(64, 64, (c, W, H) => {
    c.fillStyle = '#17131a'; c.fillRect(0, 0, W, H);
    const gr = c.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, 'rgba(255,190,120,0)'); gr.addColorStop(0.55, 'rgba(255,170,110,.34)'); gr.addColorStop(1, 'rgba(140,160,255,.14)');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0, H * 0.62, W, H * 0.06);          // a blind, half drawn
  }));
}
// what a pane reflects: the sky it is facing. Painted, because the scene environment is a neutral
// studio probe and a real sunset would cost a cubemap per stage.
function dfSkyGlassTex(top, mid, bot) {
  const key = 'g' + top + mid + bot;
  return dfC[key] || (dfC[key] = canvasTex(32, 128, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, top); gr.addColorStop(0.42, mid); gr.addColorStop(0.62, bot); gr.addColorStop(1, '#141018');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.5; c.fillStyle = '#ffffff';
    for (let i = 0; i < 7; i++) c.fillRect(0, Math.random() * H * 0.5, W, 1 + Math.random() * 3);   // cloud bands
    c.globalAlpha = 1;
  }));
}
// ---- the wall itself: piers + spandrels with real holes, merged into one geometry ----
// Local origin: centre in x, BOTTOM in y, centre in z. Returns the merged geometry and the centre
// of every opening so brows, sills, panes and AC boxes can be hung off them.
function dfWall(o) {
  const w = o.w, h = o.h, d = o.d, cols = o.cols, rows = o.rows, px = o.px, py = o.py, tile = o.tile || 1.2;
  const ww = (w - (cols + 1) * px) / cols, wh = (h - (rows + 1) * py) / rows, gs = [], holes = [];
  for (let i = 0; i <= cols; i++) {
    const x = -w / 2 + i * (px + ww) + px / 2, g = wbox(px, h, d, tile, x, 0); g.translate(x, h / 2, 0); gs.push(g);
  }
  for (let j = 0; j <= rows; j++) {
    const y = j * (py + wh) + py / 2, g = wbox(w, py, d, tile, 0, y); g.translate(0, y, 0); gs.push(g);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++)
    holes.push([-w / 2 + px + i * (px + ww) + ww / 2, py + j * (py + wh) + wh / 2]);
  return { geo: mergeGeometries(gs, false), holes: holes, ww: ww, wh: wh };
}
// glazing for a wall's holes: two instanced meshes, dark panes and lit panes, so the lit ones bloom
function dfGlaze(parent, holes, ww, wh, o) {
  const lit = [], dark = [];
  for (const p of holes) (Math.random() < (o.litP != null ? o.litP : 0.35) ? lit : dark).push(p);
  const gg = new THREE.PlaneGeometry(ww * 0.98, wh * 0.98), out = {};
  const mk = (list, mat) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(gg, mat, list.length), m4 = new THREE.Matrix4();
    list.forEach((p, i) => { m4.makeTranslation(o.ox + p[0], o.oy + p[1], o.z); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; if (o.ry) im.rotation.y = o.ry; if (o.rx) im.rotation.x = o.rx;
    parent.add(im); return im;
  };
  const sky = dfSkyGlassTex(o.skyA || '#f6dcc0', o.skyB || '#d9a9ae', o.skyC || '#5d5a70');
  out.dark = mk(dark, std({ map: sky, color: 0xc8c8d0, emissive: 0xffffff, emissiveMap: sky, emissiveIntensity: 0.2, roughness: 0.07, metalness: 0.55, envMapIntensity: 1.4 }));
  out.lit = mk(lit, std({ map: dfRoomTex(), color: 0x9a8f96, emissive: o.litCol || 0xffb070, emissiveIntensity: o.litK || 1.5, roughness: 0.16, metalness: 0.45 }));
  if (out.lit) {
    out.lit.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lit.length * 3), 3);
    for (let i = 0; i < lit.length; i++) { const k = 0.7 + Math.random() * 0.6; out.lit.instanceColor.setXYZ(i, k, k * (0.82 + Math.random() * 0.3), k * 0.7); }
  }
  return out;
}
// one instanced box hung off every opening (brows, sills, AC units, flower boxes)
function dfPer(parent, holes, geo, mat, o) {
  const every = o.every || 1, list = holes.filter((_, i) => i % every === (o.phase || 0));
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4();
  list.forEach((p, i) => { m4.makeTranslation(o.ox + p[0] + (o.dx || 0), o.oy + p[1] + (o.dy || 0), o.z); im.setMatrixAt(i, m4); });
  im.instanceMatrix.needsUpdate = true;
  if (o.ry) im.rotation.y = o.ry;
  if (o.cast) im.castShadow = true; if (o.recv) im.receiveShadow = true;
  parent.add(im); return im;
}
// railing: rails + posts merge into one mesh, the balusters are one instanced mesh
function dfRail(parent, o) {
  const w = o.w, hgt = o.h || 0.4, r = o.r || 0.022, gs = [];
  for (const y of (o.rails || [hgt, hgt * 0.52])) { const g = new THREE.BoxGeometry(w, r * 2.2, r * 2.2); g.translate(0, y, 0); gs.push(g); }
  for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(r * 2.6, hgt, r * 2.6); g.translate(s * (w / 2 - r), hgt / 2, 0); gs.push(g); }
  const rail = new THREE.Mesh(mergeGeometries(gs, false), o.mat); rail.position.set(o.x, o.y, o.z); rail.castShadow = true; parent.add(rail);
  const n = Math.max(2, Math.round(w / (o.gap || 0.17))), bg = o.bal || new THREE.CylinderGeometry(r, r, hgt, 6);
  const im = new THREE.InstancedMesh(bg, o.mat, n), m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) m4.makeTranslation(o.x - w / 2 + (i + 0.5) * w / n, o.y + hgt / 2, o.z), im.setMatrixAt(i, m4);
  im.instanceMatrix.needsUpdate = true; im.castShadow = true; parent.add(im);
  return rail;
}
// a stepped cornice / eyebrow band: each step projects further, so the sun carves it
function dfCornice(parent, o) {
  const gs = [], steps = o.steps || [[0.14, 0.10], [0.16, 0.19], [0.12, 0.28]];
  let y = 0;
  for (const [sh, sz] of steps) { const g = wbox(o.w, sh, o.d + sz * 2, o.tile || 1.2, 0, y); g.translate(0, y + sh / 2, sz); gs.push(g); y += sh; }
  const m = new THREE.Mesh(mergeGeometries(gs, false), o.mat); m.position.set(o.x, o.y, o.z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  return { mesh: m, top: o.y + y };
}
// zig-zag fire escape: stringers + landings merge, treads and balusters instance. Pure silhouette.
function dfFireEscape(parent, o) {
  const steel = o.mat, gs = [], treads = [], n = o.floors || 3, fh = o.fh || 1.7, lw = o.w || 1.0, ld = o.d || 0.62;
  for (let f = 0; f < n; f++) {
    const y = o.y0 + f * fh, dir = f % 2 ? 1 : -1;
    const lg = new THREE.BoxGeometry(lw, 0.05, ld); lg.translate(0, y, 0); gs.push(lg);
    for (const s of [-1, 1]) { const b = new THREE.BoxGeometry(0.05, 0.05, ld); b.translate(s * (lw / 2 - 0.03), y - 0.06, 0); gs.push(b); }
    for (const s of [-1, 1]) { const p = new THREE.BoxGeometry(0.035, 0.85, 0.035); p.translate(s * (lw / 2 - 0.03), y + 0.42, s * (ld / 2 - 0.03)); gs.push(p); }
    const rr = new THREE.BoxGeometry(lw, 0.035, 0.035); rr.translate(0, y + 0.82, ld / 2 - 0.03); gs.push(rr);
    if (f < n - 1) {                                     // the flight up to the next landing
      const run = lw * 0.72, rise = fh - 0.05, steps = 7, x0 = dir * (-lw / 2 + 0.16);
      for (let t = 0; t < steps; t++) treads.push([x0 + dir * (t + 0.5) * run / steps, y + 0.06 + (t + 0.5) * rise / steps, 0]);
      for (const s of [-1, 1]) {
        const q = new THREE.BoxGeometry(Math.hypot(run, rise), 0.045, 0.045);
        q.rotateZ(Math.atan2(rise, run) * dir); q.translate(x0 + dir * run / 2, y + 0.06 + rise / 2, s * (ld / 2 - 0.08)); gs.push(q);
      }
    }
  }
  const grp = new THREE.Group(); grp.position.set(o.x, 0, o.z); if (o.ry) grp.rotation.y = o.ry; parent.add(grp);
  const body = new THREE.Mesh(mergeGeometries(gs, false), steel); body.castShadow = true; grp.add(body);
  if (treads.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.02, ld - 0.14), steel, treads.length), m4 = new THREE.Matrix4();
    treads.forEach((t, i) => { m4.makeTranslation(t[0], t[1], t[2]); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; im.castShadow = true; grp.add(im);
  }
  return grp;
}
// ---- palms with a real trunk and real fronds (not a photo card) ----
function dfFrondTex() {
  return dfC.frond || (dfC.frond = canvasTex(256, 128, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = '#6f8f3a'; c.lineWidth = 4; c.beginPath(); c.moveTo(4, H / 2); c.quadraticCurveTo(W * 0.6, H / 2 - 4, W - 6, H / 2 + 2); c.stroke();
    for (let i = 0; i < 46; i++) {
      const t = 0.04 + i / 46 * 0.94, x = 4 + t * (W - 12), y = H / 2 + (t - 0.5) * 6;
      const len = Math.sin(t * Math.PI) * H * 0.46 * (0.85 + Math.random() * 0.3), dropp = 6 + t * 16;
      for (const s of [-1, 1]) {
        c.strokeStyle = ['#8fb84a', '#7aa63c', '#6b9434', '#a8c95e'][i % 4]; c.lineWidth = 2.6;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 8, y + s * len * 0.6, x - dropp * 0.3, y + s * len); c.stroke();
      }
    }
  }));
}
function dfPalmTrunk(x, z, h, lean, seed) {
  const g = new THREE.CylinderGeometry(0.055, 0.105, h, 9, 14, true), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px2 = p.getX(i), py2 = p.getY(i), pz = p.getZ(i), t = (py2 + h / 2) / h;
    // scar rings, a thickened base and the flare where the old frond bases sit under the crown
    const bend = lean * t * t * (1.4 - t * 0.4), ring = 1 + Math.sin(t * h * 11 + seed) * 0.07;
    const flare = 1 + Math.max(0, 1 - t * 7) * 0.5 + Math.max(0, (t - 0.93) * 12) * 0.5;
    const k2 = ring * flare;
    p.setXYZ(i, px2 * k2 + bend, py2 + h / 2, pz * k2 + bend * 0.3);
  }
  g.computeVertexNormals(); g.translate(x, 0, z); return g;
}
// one merged trunk mesh + one instanced frond mesh for a whole row of palms
function dfPalmRow(parent, list, o) {
  const trunks = [], fronds = [], nuts = [];
  for (const [x, z, h, lean] of list) {
    trunks.push(dfPalmTrunk(x, z, h, lean, Math.random() * 9));
    const tipX = x + lean, tipZ = z + lean * 0.35, n = o.fronds || 11;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.random() * 0.4, droop = 0.35 + Math.random() * 0.75;
      fronds.push([tipX, h - 0.06, tipZ, a, droop, 0.9 + Math.random() * 0.45]);
    }
    for (let i = 0; i < 4; i++) nuts.push([tipX + (Math.random() - 0.5) * 0.24, h - 0.22, tipZ + (Math.random() - 0.5) * 0.2]);
  }
  const bark = dfPlasterMat('#a08c6e', { n: 1.4, rough: 0.95, m: { side: THREE.DoubleSide } });
  const tm = new THREE.Mesh(mergeGeometries(trunks, false), bark); tm.castShadow = true; tm.receiveShadow = true; parent.add(tm);
  const fg = new THREE.PlaneGeometry(1.35, 0.62, 6, 1), fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) { const t = (fp.getX(i) + 0.675) / 1.35; fp.setZ(i, -t * t * 0.55); fp.setY(i, fp.getY(i) * (0.35 + t * 0.9)); }
  fg.translate(0.675, 0, 0); fg.computeVertexNormals();
  const fm = std({ map: dfFrondTex(), transparent: true, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.78, color: o.tint || 0xffffff });
  const im = new THREE.InstancedMesh(fg, fm, fronds.length), m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  fronds.forEach((f, i) => {
    e.set(0, f[3], -f[4]); q.setFromEuler(e); v.set(f[0], f[1], f[2]); s3.setScalar(f[5]);
    m4.compose(v, q, s3); im.setMatrixAt(i, m4);
  });
  im.instanceMatrix.needsUpdate = true; im.castShadow = true; parent.add(im);
  if (nuts.length) {
    const ni = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 7, 5), std({ color: 0x6a5230, roughness: 0.9 }), nuts.length);
    nuts.forEach((n2, i) => { m4.makeTranslation(n2[0], n2[1], n2[2]); ni.setMatrixAt(i, m4); });
    ni.instanceMatrix.needsUpdate = true; parent.add(ni);
  }
  return { trunks: tm, fronds: im };
}
// ---- a car with volume: body, cabin, glass, wheels, lights ----
function dfCar(parent, o) {
  const g = new THREE.Group(); g.position.set(o.x, 0, o.z); if (o.ry) g.rotation.y = o.ry; parent.add(g);
  const L = o.L || 2.6, Wd = o.w || 1.05, paint = std({ color: o.col || 0xe85a8a, roughness: 0.16, metalness: 0.85, envMapIntensity: 1.7 });
  const chrome = std({ color: 0xdfe4ea, roughness: 0.12, metalness: 1 });
  const glassM = std({ color: 0x14202e, roughness: 0.06, metalness: 0.9, envMapIntensity: 2.1 });
  const gs = [];
  const lower = new THREE.BoxGeometry(L, 0.34, Wd); lower.translate(0, 0.40, 0); gs.push(lower);
  const sill = new THREE.BoxGeometry(L * 0.98, 0.14, Wd * 1.04); sill.translate(0, 0.25, 0); gs.push(sill);
  // the cabin is a tapered box: narrower and shorter at the top, which is what makes a car read as a car
  const cab = new THREE.BoxGeometry(L * 0.52, 0.34, Wd * 0.92), cp = cab.attributes.position;
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) cp.setXYZ(i, cp.getX(i) * 0.72, cp.getY(i), cp.getZ(i) * 0.9);
  cab.computeVertexNormals(); cab.translate(-L * 0.04, 0.74, 0); gs.push(cab);
  if (o.fins) for (const s of [-1, 1]) { const f = new THREE.BoxGeometry(L * 0.2, 0.26, 0.05); f.translate(L * 0.42, 0.66, s * (Wd / 2 - 0.05)); gs.push(f); }
  const body = new THREE.Mesh(mergeGeometries(gs, false), paint); body.castShadow = true; body.receiveShadow = true; g.add(body);
  put(g, new THREE.BoxGeometry(L * 0.44, 0.24, Wd * 0.94), glassM, -L * 0.04, 0.80, 0);
  const wg = new THREE.CylinderGeometry(0.23, 0.23, 0.14, 12), wm = std({ color: 0x14141a, roughness: 0.85 });
  const wi = new THREE.InstancedMesh(wg, wm, 4), m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
  let k = 0; for (const dx of [-L * 0.32, L * 0.32]) for (const s of [-1, 1]) { m4.compose(new THREE.Vector3(dx, 0.23, s * (Wd / 2 - 0.02)), q, one); wi.setMatrixAt(k++, m4); }
  wi.instanceMatrix.needsUpdate = true; wi.castShadow = true; g.add(wi);
  put(g, new THREE.BoxGeometry(0.06, 0.1, Wd * 0.9), chrome, L / 2 - 0.02, 0.42, 0);
  put(g, new THREE.BoxGeometry(0.06, 0.1, Wd * 0.9), chrome, -L / 2 + 0.02, 0.42, 0);
  for (const s of [-1, 1]) {
    put(g, new THREE.BoxGeometry(0.05, 0.1, 0.18), glow(o.tail || 0xff2a3a, 2.2), -L / 2 + 0.01, 0.5, s * (Wd / 2 - 0.17));
    put(g, new THREE.BoxGeometry(0.05, 0.12, 0.2), glow(0xfff0d0, o.lampK != null ? o.lampK : 1.6), L / 2 - 0.01, 0.5, s * (Wd / 2 - 0.18));
  }
  return g;
}
// A whole windowed face in its own group (so it can be rotated to be a side elevation or a far
// block) : holed wall + recessed panes + brows + sills, 5-6 draw calls whatever the window count.
// Local frame: x centred on the face, y = 0 at the bottom of the windowed zone, z = 0 at its middle.
function dfFace(parent, o) {
  const g = new THREE.Group(); g.position.set(o.x, o.y, o.z); if (o.ry) g.rotation.y = o.ry; parent.add(g);
  const wall = dfWall(o), zf = o.d / 2;
  const wm = new THREE.Mesh(wall.geo, o.mat); wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
  // the room behind the holes, set back far enough that the reveal actually has depth
  put(g, new THREE.PlaneGeometry(o.w, o.h), std({ map: dfRoomTex(), color: 0x6a5f68, roughness: 0.92, emissive: 0x3a2a20, emissiveIntensity: 0.7 }), 0, o.h / 2, zf - Math.min(o.d * 0.6, (o.rev != null ? o.rev : 0.13) + 0.55));
  const glz = dfGlaze(g, wall.holes, wall.ww, wall.wh, { ox: 0, oy: 0, z: zf - (o.rev != null ? o.rev : 0.13),
    litP: o.litP, litCol: o.litCol, litK: o.litK, skyA: o.skyA, skyB: o.skyB, skyC: o.skyC });
  const bd = o.browD || 0.14, sd = o.sillD || 0.1;
  if (o.brow !== false) dfPer(g, wall.holes, wbox(wall.ww + o.px * 0.45, 0.07, bd, 0.4), o.trim || o.mat,
    { ox: 0, oy: wall.wh / 2 + 0.035, z: zf + bd / 2, cast: true, recv: true });
  if (o.sill !== false) dfPer(g, wall.holes, wbox(wall.ww + o.px * 0.35, 0.05, sd, 0.4), o.trim || o.mat,
    { ox: 0, oy: -wall.wh / 2 - 0.025, z: zf + sd / 2, cast: true, recv: true });
  // a mullion down the middle of each opening: a bare hole is a cut-out, a divided light is a window
  if (o.mull !== false) dfPer(g, wall.holes, new THREE.BoxGeometry(0.035, wall.wh, 0.035), o.trim || o.mat,
    { ox: 0, oy: 0, z: zf - (o.rev != null ? o.rev : 0.13) + 0.03 });
  if (o.ac) dfPer(g, wall.holes, new THREE.BoxGeometry(0.28, 0.19, 0.24), std({ color: 0xa8acb2, roughness: 0.55, metalness: 0.5 }),
    { ox: 0, oy: -wall.wh / 2 + 0.1, dx: wall.ww * 0.22, z: zf + 0.09, every: 3, phase: 1, cast: true });
  g.userData.holes = wall.holes; g.userData.ww = wall.ww; g.userData.wh = wall.wh; g.userData.glaze = glz;
  return g;
}
// Collects pieces that share a material and ships them as ONE mesh. Static trim is the bulk of a
// facade's piece count and none of it needs its own draw call.
function dfBatch(parent, mat, parts, o = {}) {
  const gs = [];
  for (const [geo, x, y, z, ry, rz] of parts) {
    const g2 = geo.clone();
    if (ry) g2.rotateY(ry); if (rz) g2.rotateZ(rz);
    g2.translate(x, y, z); gs.push(g2);
  }
  if (!gs.length) return null;
  const m = new THREE.Mesh(mergeGeometries(gs, false), mat);
  if (o.cast !== false) m.castShadow = true; if (o.recv !== false) m.receiveShadow = true;
  parent.add(m); return m;
}
// ground quad shaped like the camera's view of the ground: narrow at the near edge, wide at the far
function dfGround(parent, nearW, farW, z0, z1, mat, o = {}) {
  const g = new THREE.PlaneGeometry(1, 1, o.seg || 1, o.seg || 1), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    // rotation.x = -PI/2 maps local +y to world -z, so the local y has to be negated or near and
    // far come out swapped (they did, first time round)
    const t = uv.getY(i);                                 // 0 at the near edge, 1 at the far edge
    p.setXYZ(i, p.getX(i) * (nearW + (farW - nearW) * t), -(z0 + (z1 - z0) * t), 0);
    uv.setXY(i, uv.getX(i) * (nearW + (farW - nearW) * t), uv.getY(i) * (z1 - z0));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(o.x || 0, o.y || 0, 0);
  if (o.recv) m.receiveShadow = true; if (o.order) m.renderOrder = o.order;
  parent.add(m); return m;
}
// ---- contact darkening: a soft multiply gradient where something meets the ground or a wall ----
// MultiplyBlending in three is (ZERO, SRC_COLOR): `opacity` does NOTHING to it. A gradient that
// reached black therefore multiplied the frame to black, and any such plane floating clear of its
// surface darkened everything visible THROUGH it. Strength is baked into the texture instead, one
// texture and one material per strength, and callers must hug the surface they are darkening.
const dfAoT = {}, dfAoM = {};
function dfAoTex(op) {
  const k = Math.round(op * 20);
  if (dfAoT[k]) return dfAoT[k];
  const lo = Math.round(255 * (1 - op)), mid = Math.round(255 * (1 - op * 0.55));
  const t = dfAoT[k] = canvasTex(8, 64, (c, W, H) => {
    const gr = c.createLinearGradient(0, H, 0, 0);
    gr.addColorStop(0, `rgb(${lo},${lo},${lo})`); gr.addColorStop(0.35, `rgb(${mid},${mid},${mid})`); gr.addColorStop(1, '#ffffff');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
  });
  t.userData.shared = true;   // cached across arenas: V3.disposeArena leaves it uploaded
  return t;
}
function dfContactRaw(parent, w, h, x, y, z, o = {}) {
  const op = Math.min(0.85, o.op != null ? o.op : 0.6), k = Math.round(op * 20);
  const mat = dfAoM[k] || (dfAoM[k] = new THREE.MeshBasicMaterial({ map: dfAoTex(op), blending: THREE.MultiplyBlending, depthWrite: false, fog: false }));
  if (!mat.userData) mat.userData = {};
  mat.userData.shared = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.renderOrder = 2;
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  parent.add(m); return m;
}
// ---- the three you should actually call ----
// Two mistakes are worth making impossible, because both were made here twice: building a GROUND
// shadow standing up, and floating a WALL darkening clear of its wall so it dims everything behind
// it. So none of these takes a rotation - the name fixes the orientation - and none takes the
// offset from the surface, which is applied internally and is always tiny.
const DF_HUG = 0.014;
// lies FLAT on the ground under something. Cannot be vertical.
function dfShadowOn(parent, w, d, x, z, o = {}) {
  const m = dfContactRaw(parent, w, d, x, (o.groundY || 0) + DF_HUG, z, { op: o.op, rx: -Math.PI / 2 });
  return m;
}
// on a WALL, darkest at the TOP: under a balcony, a ledge, a cornice.
function dfGrimeBelow(parent, w, h, x, yTop, wallZ, o = {}) {
  return dfContactRaw(parent, w, h, x, yTop - h / 2, wallZ + DF_HUG, { op: o.op, rz: Math.PI });
}
// on a WALL, darkest at the BOTTOM: where the wall meets the ground.
function dfGrimeAbove(parent, w, h, x, yBottom, wallZ, o = {}) {
  return dfContactRaw(parent, w, h, x, yBottom + h / 2, wallZ + DF_HUG, { op: o.op });
}
// the same two, on a wall that faces along X instead of Z (a side elevation). `face` is +1 or -1.
function dfGrimeBelowX(parent, w, h, z, yTop, wallX, face, o = {}) {
  return dfContactRaw(parent, w, h, wallX + DF_HUG * face, yTop - h / 2, z, { op: o.op, rz: Math.PI, ry: Math.PI / 2 * face });
}


// ================= curve kit (9/22): profiles swept along plan paths, soft-edged slabs =================
// Why this exists: every helper above builds from BOXES - a hard 90 degree edge on every side, flat
// faces, uniform extrusions - and however many of them a stage has, it reads cheap. Nothing at this
// scale has a sharp edge in the real world, and Streamline Moderne (Miami) is built out of curves:
// wrap-around corners, eyebrow ledges with a rounded nose, cove cornices, bullnose kerbs. So the
// primitive here is a 2D PROFILE SWEPT ALONG A PLAN PATH.
//   dfPlanRR  a rounded-rectangle plan (per-corner radii) as points with outward normals + arc length
//   dfCut     the stretch of a path the camera can actually see, by arc length (wraps past the start)
//   dfSweep   a profile [offset, y, flags, ao] swept along a path: walls with window recesses,
//             eyebrows, copings, kerbs, neon tubes. UVs follow the arc length, so a texture wraps a
//             curved corner with no seam, and `ao` goes into vertex colour - contact darkening under
//             every ledge at no cost (no transparent planes, no extra draw calls).
//   dfSlab    an ExtrudeGeometry of a plan shape with a real rounded bevel on every edge
//   dfRBox    a drop-in soft-edged box
//   dfCollector merges everything that shares a material into ONE mesh with its transform baked in,
//             so a street of curved buildings costs a handful of draw calls.
// Visual only: Math.random only, never rand/irand/Rng, never touches fight state.
const DF_CREASE = 1, DF_BREAK = 2;
// Plan of a rounded rectangle: front edge at z = 0, back at z = -d, x in [-w/2, w/2].
// rad = [frontLeft, frontRight, backRight, backLeft]. The path starts at the left end of the front
// straight and runs front (+x) -> front-right corner -> right side (-z) -> back -> left side, and ends
// where it started (the last point repeats the first, so a full loop is just an open path).
// Normal convention everywhere in this kit: n = (sin a, cos a), a measured from +z toward +x.
function dfPlanRR(w, d, rad) {
  const r = rad.map(v => Math.max(0.01, Math.min(v, w / 2 - 0.001, d / 2 - 0.001))), hw = w / 2, pts = [], marks = {};
  let s = 0, last = null;
  const push = (x, z, nx, nz) => { if (last) s += Math.hypot(x - last.x, z - last.z); last = { x, z, nx, nz, s }; pts.push(last); };
  const arc = (cx, cz, rr, a0, a1) => {
    const n = Math.max(2, Math.min(28, Math.ceil(rr * 16)));
    for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, nx = Math.sin(a), nz = Math.cos(a); push(cx + nx * rr, cz + nz * rr, nx, nz); }
  };
  push(-hw + r[0], 0, 0, 1); marks.front0 = s;
  push(hw - r[1], 0, 0, 1); marks.front1 = s;
  arc(hw - r[1], -r[1], r[1], 0, Math.PI / 2); marks.right0 = s;
  push(hw, -d + r[2], 1, 0); marks.right1 = s;
  arc(hw - r[2], -d + r[2], r[2], Math.PI / 2, Math.PI); marks.back0 = s;
  push(-hw + r[3], -d, 0, -1); marks.back1 = s;
  arc(-hw + r[3], -d + r[3], r[3], Math.PI, Math.PI * 1.5); marks.left0 = s;
  push(-hw, -r[0], -1, 0); marks.left1 = s;
  arc(-hw + r[0], -r[0], r[0], Math.PI * 1.5, Math.PI * 2);
  marks.total = s;
  return { pts, marks };
}
function dfLerpP(a, b, t) {
  const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t, l = Math.hypot(nx, nz) || 1;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / l, nz: nz / l, s: a.s + (b.s - a.s) * t };
}
// the part of a path between two arc lengths; s0 < 0 wraps back past the start of a closed loop
function dfCut(path, s0, s1) {
  const tot = path[path.length - 1].s;
  if (s0 < 0) {
    const a = dfCut(path, tot + s0, tot).map(p => Object.assign({}, p, { s: p.s - tot }));
    return a.concat(dfCut(path, 0, s1).slice(1));
  }
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (b.s <= s0 || a.s >= s1 || b.s === a.s) continue;
    if (!out.length) out.push(a.s < s0 ? dfLerpP(a, b, (s0 - a.s) / (b.s - a.s)) : a);
    if (b.s <= s1) out.push(b); else { out.push(dfLerpP(a, b, (s1 - a.s) / (b.s - a.s))); break; }
  }
  return out;
}
function dfAt(path, s) {
  for (let i = 0; i < path.length - 1; i++) if (path[i + 1].s >= s) return dfLerpP(path[i], path[i + 1], (s - path[i].s) / ((path[i + 1].s - path[i].s) || 1));
  return path[path.length - 1];
}
// an arbitrary polyline [[x, z], ...] as a path; normals point to the LEFT of travel (flip to swap)
function dfPath(pts, flip) {
  const out = []; let s = 0; const k = flip ? -1 : 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    out.push({ x: p[0], z: p[1], nx: -tz * k, nz: tx * k, s });
  }
  return out;
}
function dfArcPts(cx, cz, r, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); } return o; }
function dfShift(path, dx, dz) { return path.map(p => Object.assign({}, p, { x: p.x + dx, z: p.z + dz })); }
// a closed ring profile (for tubes: neon, pipe rails, speed-line beads)
function dfRing(o, y, r, n = 6) { const out = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; out.push([o + Math.cos(a) * r, y + Math.sin(a) * r]); } return out; }
// profile swept along a path. prof: [[offset, y, flags, ao], ...] bottom to top, solid on the LEFT of
// travel in (offset right, y up) - i.e. a wall is listed going up, an eyebrow out along its underside
// and back along its top. DF_CREASE splits the normal at a point, DF_BREAK leaves a gap after it (the
// hole a window's glass fills). o: tile | uk/vk/u0/v0 (UV scale), caps (close both ends).
function dfSweep(path, prof, o = {}) {
  const tile = o.tile || 1, uk = o.uk != null ? o.uk : 1 / tile, vk = o.vk != null ? o.vk : 1 / tile, u0 = o.u0 || 0, v0 = o.v0 || 0;
  const pr = []; let vl = 0;
  prof.forEach((p, j) => {
    if (j) vl += Math.hypot(p[0] - prof[j - 1][0], p[1] - prof[j - 1][1]);
    const f = p[2] || 0, e = { o: p[0], y: p[1], v: vl, ao: p[3] != null ? p[3] : 1, brk: !!(f & DF_BREAK) };
    if (f & DF_CREASE) pr.push(Object.assign({}, e, { brk: true }));
    pr.push(e);
  });
  const n = path.length, m = pr.length, P = [], UV = [], CO = [], I = [];
  for (let i = 0; i < n; i++) {
    const q = path[i];
    for (let j = 0; j < m; j++) { const e = pr[j]; P.push(q.x + q.nx * e.o, e.y, q.z + q.nz * e.o); UV.push(q.s * uk + u0, e.v * vk + v0); CO.push(e.ao, e.ao, e.ao); }
  }
  // winding: the first real quad's geometric normal against the profile's outward normal
  let flip = false;
  find: for (let j = 0; j < m - 1; j++) {
    if (pr[j].brk) continue;
    for (let i = 0; i < n - 1; i++) {
      const a = (i * m + j) * 3, b = ((i + 1) * m + j) * 3, c = ((i + 1) * m + j + 1) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
      const gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
      if (Math.hypot(gx, gy, gz) < 1e-10) continue;
      const q = path[i], dO = pr[j + 1].o - pr[j].o, dY = pr[j + 1].y - pr[j].y;
      flip = gx * q.nx * dY + gy * -dO + gz * q.nz * dY < 0; break find;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
    if (pr[j].brk) continue;
    const a = i * m + j, b = (i + 1) * m + j, c = (i + 1) * m + j + 1, d = i * m + j + 1;
    if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d);
  }
  if (o.caps && n > 1) {
    const tris = THREE.ShapeUtils.triangulateShape(prof.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const end of [0, n - 1]) {
      // outward at an end = away from its neighbour along the path
      const q = path[end], nb = path[end ? n - 2 : 1], bi = P.length / 3;
      let tx = q.x - nb.x, tz = q.z - nb.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      for (const p of prof) { P.push(q.x + q.nx * p[0], p[1], q.z + q.nz * p[0]); UV.push(p[0] / tile, p[1] / tile); CO.push(p[3] != null ? p[3] : 1, p[3] != null ? p[3] : 1, p[3] != null ? p[3] : 1); }
      if (!tris.length) continue;
      const [t0, t1, t2] = tris[0], A = (bi + t0) * 3, B = (bi + t1) * 3, C2 = (bi + t2) * 3;
      const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2], wx = P[C2] - P[A], wy = P[C2 + 1] - P[A + 1], wz = P[C2 + 2] - P[A + 2];
      const gx = uy * wz - uz * wy, gz = ux * wy - uy * wx, ok = gx * tx + gz * tz >= 0;
      for (const tr of tris) ok ? I.push(bi + tr[0], bi + tr[1], bi + tr[2]) : I.push(bi + tr[0], bi + tr[2], bi + tr[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(CO, 3));
  g.setIndex(I); g.computeVertexNormals();
  return g;
}
// plan shape for ExtrudeGeometry. Shape coordinates are (x, -z) so the extrusion lands the right way
// round after dfSlab's rotation. r = number or [frontLeft, frontRight, backRight, backLeft].
function dfShapeRR(x0, z0, x1, z1, r) {
  const R4 = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0.002, Math.min(v, (x1 - x0) / 2 - 0.001, (z1 - z0) / 2 - 0.001)));
  const Yf = -z1, Yb = -z0, s = new THREE.Shape();
  s.moveTo(x0 + R4[0], Yf); s.lineTo(x1 - R4[1], Yf); s.absarc(x1 - R4[1], Yf + R4[1], R4[1], -Math.PI / 2, 0, false);
  s.lineTo(x1, Yb - R4[2]); s.absarc(x1 - R4[2], Yb - R4[2], R4[2], 0, Math.PI / 2, false);
  s.lineTo(x0 + R4[3], Yb); s.absarc(x0 + R4[3], Yb - R4[3], R4[3], Math.PI / 2, Math.PI, false);
  s.lineTo(x0, Yf + R4[0]); s.absarc(x0 + R4[0], Yf + R4[0], R4[0], Math.PI, Math.PI * 1.5, false);
  return s;
}
// a plan shape extruded UP by h with a rounded bevel of `bev` on every edge, base at y = 0. The shape
// outline is the outer size (bevelOffset pulls the caps in by the bevel instead of growing the solid).
function dfSlab(shape, h, bev, o = {}) {
  const b = Math.max(0, Math.min(bev || 0, h * 0.45));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.002, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: o.bs || 3, curveSegments: o.cs || 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, b, 0);
  if (o.tile) scaleUV(g, 1 / o.tile);
  return g;
}
// soft-edged box, centred like BoxGeometry
function dfRBox(w, h, d, r = 0.04, tile = 1) {
  // the plan corners must be rounder than the bevel: at equal radii the bevel's inset collapses each
  // cap corner to a point and the box comes out crumpled (9/22, the Miami lamp base)
  const b = Math.min(r, h * 0.45, w * 0.3, d * 0.3), rp = Math.min(Math.max(r, b * 1.6), w / 2 - 0.002, d / 2 - 0.002);
  const g = dfSlab(dfShapeRR(-w / 2, -d / 2, w / 2, d / 2, rp), h, b, { tile, cs: 4, bs: 2 });
  return g.translate(0, -h / 2, 0);
}
// a copy of `geo` (built facing +z) standing on a path at arc length s, turned to face the normal
function dfOnPath(path, geo, s, off, y) {
  const p = dfAt(path, s), g = geo.clone();
  g.rotateY(Math.atan2(p.nx, p.nz)); g.translate(p.x + p.nx * off, y, p.z + p.nz * off);
  return g;
}
// merge-by-material. add() takes a geometry (copied, never mutated) and an optional Matrix4;
// flush() emits one mesh per material. flags: Map(material -> { cast, recv }).
function dfCollector() {
  const L = new Map(), keep = ['position', 'normal', 'uv', 'color'];
  return {
    add(mat, geo, m4) {
      if (!geo || !mat) return;
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      const nv = g.attributes.position.count;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(nv * 2), 2));
      if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nv * 3).fill(1), 3));
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      g.morphAttributes = {}; g.clearGroups();
      if (m4) g.applyMatrix4(m4);
      let e = L.get(mat); if (!e) L.set(mat, e = []); e.push(g);
    },
    flush(parent, flags) {
      const out = new Map();
      for (const [mat, gs] of L) {
        const merged = mergeGeometries(gs, false); gs.forEach(x => x.dispose());
        const mesh = new THREE.Mesh(merged, mat), f = (flags && flags.get(mat)) || {};
        mesh.castShadow = f.cast !== false; mesh.receiveShadow = f.recv !== false;
        parent.add(mesh); out.set(mat, mesh);
      }
      L.clear(); return out;
    },
  };
}


// ---------- Miami Strip ----------
// Ocean Drive at golden hour, rebuilt a second time (9/22) because the first rebuild was still made of
// boxes. Everything architectural here is a CURVE on the kit above: a Streamline Moderne hotel with a
// 1.5-unit wrap-around corner, ribbon windows, eyebrow ledges with rounded noses and neon under them,
// three speed lines, a cove coping, a fin that becomes a stepped tower with a spire; a balcony (p0)
// that follows the corner round; a flying stadium canopy with a neon marquee (p2); a cantilevered beach
// pavilion with a curved glass-block screen (p1); pastel Deco blocks down the street; generated models
// for the palms, the convertibles and the lifeguard tower. A low sun over the ocean rakes across the
// facade so every eyebrow throws a long horizontal shadow band. Detail stays behind and below the
// fight plane. Visual only; Math.random only; nothing here writes fight state.
function miGlassTex(kind) {
  const N = 16, PW = 64, H = 256, types = [];
  for (let i = 0; i < N; i++) { const r = Math.random(); types.push(kind === 'cafe' ? (r < 0.78 ? 'lit' : 'blind') : r < 0.44 ? 'sky' : r < 0.68 ? 'lit' : r < 0.84 ? 'blind' : 'dark'); }
  const draw = (c, emi) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, N * PW, H);
    for (let i = 0; i < N; i++) {
      const x = i * PW, t = types[i];
      if (t === 'sky') {
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#f6d8c6'); g.addColorStop(0.3, '#e2a4b2'); g.addColorStop(0.58, '#7a6a8c'); g.addColorStop(1, '#221c2c');
        c.globalAlpha = emi ? 0.2 : 1; c.fillStyle = g; c.fillRect(x, 0, PW, H);
        c.globalAlpha = emi ? 0.05 : 0.14; c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x + PW * 0.25, 0); c.lineTo(x + PW * 0.6, 0); c.lineTo(x + PW * 0.1, H); c.lineTo(x - PW * 0.25, H); c.fill();
        c.globalAlpha = 1;
      } else if (t === 'dark') {
        if (!emi) { c.fillStyle = '#19151e'; c.fillRect(x, 0, PW, H); }
      } else if (t === 'lit') {
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ffe0ae'); g.addColorStop(0.55, '#dd8e5c'); g.addColorStop(1, '#40200f');
        c.fillStyle = g; c.fillRect(x, 0, PW, H);
        c.fillStyle = emi ? '#0c0504' : '#2a1812'; c.fillRect(x + 6, H * 0.66, PW * 0.52, H * 0.34);
        c.fillStyle = '#fff2d4'; c.fillRect(x + 9, 12, PW - 18, 5);
        if (kind === 'cafe') for (let k = 0; k < 2; k++) { c.beginPath(); c.arc(x + 18 + k * 26, H * 0.34, 7, 0, 7); c.fill(); c.fillRect(x + 17 + k * 26, 0, 2, H * 0.32); }
        c.fillStyle = emi ? 'rgba(0,0,0,.6)' : 'rgba(128,64,56,.85)'; c.fillRect(x + PW - 15, 0, 11, H);
      } else {
        c.fillStyle = emi ? '#a85c30' : '#e8c8a0'; c.fillRect(x, 0, PW, H);
        c.fillStyle = emi ? 'rgba(0,0,0,.62)' : 'rgba(96,64,52,.45)'; for (let y = 0; y < H; y += 9) c.fillRect(x, y, PW, 3);
      }
      c.fillStyle = emi ? '#000' : '#2a2430'; c.fillRect(x, 0, 3, H); if (kind !== 'cafe') c.fillRect(x, H * 0.27, PW, 3);
    }
  };
  const map = canvasTex(N * PW, H, c => draw(c, false)), emi = canvasTex(N * PW, H, c => draw(c, true));
  map.wrapS = emi.wrapS = THREE.RepeatWrapping;
  return { map, emi };
}
// neon lettering sized to fit: one line, or stacked vertically (the classic Deco blade sign)
function miNeonText(text, hex, w, h, vertical, k = 2.0) {
  const n = text.length, W = vertical ? 160 : 1024, H = vertical ? 160 * n : Math.max(64, Math.round(1024 * h / w));
  const t = canvasTex(W, H, c => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.shadowColor = '#fff';
    if (vertical) { c.font = 'bold 128px Bungee, Impact, sans-serif'; c.shadowBlur = 16; for (let i = 0; i < n; i++) c.fillText(text[i], W / 2, 160 * i + 88); }
    else { let fs = H * 0.78; c.font = `bold ${fs}px Bungee, Impact, sans-serif`; const mw = c.measureText(text).width; if (mw > W * 0.94) { fs *= W * 0.94 / mw; c.font = `bold ${fs}px Bungee, Impact, sans-serif`; } c.shadowBlur = fs * 0.07; c.fillText(text, W / 2, H * 0.56); }
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(hex).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
}
// generated props: <name>_glb.wasm (quantized mesh) + <name>_tex.jpg, one mesh each. The node's
// transform is baked into a FLOAT copy of the positions: they arrive int16-normalised and writing a
// transform back through that attribute would clip. Normals were dropped at pack time; recomputed.
function miLoadProp(name, cb, tries = 0) {
  const key = 'mi:' + name;
  let p = S2.glb[key];
  if (!p) {
    const L = gltf || new GLTFLoader(), TL = texL || new THREE.TextureLoader();
    p = S2.glb[key] = Promise.all([L.loadAsync(ASSET + name + '_glb.wasm'), TL.loadAsync(ASSET + name + '_tex.jpg')]).then(([m, tex]) => {
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = QUAL.aniso; tex.userData.shared = true;
      m.scene.updateMatrixWorld(true);
      let geo = null;
      m.scene.traverse(o => {
        if (!o.isMesh || geo) return;
        const src = o.geometry.attributes.position, P = new Float32Array(src.count * 3), v = new THREE.Vector3();
        for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i).applyMatrix4(o.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
        geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
        geo.setAttribute('uv', o.geometry.attributes.uv); geo.setIndex(o.geometry.index); geo.computeVertexNormals(); geo.computeBoundingBox();
      });
      geo.userData.shared = true;
      // the base: the centre of the lowest 6% of the model (a palm's trunk foot, not its leaning crown)
      const bb = geo.boundingBox, P = geo.attributes.position, hgt = bb.max.y - bb.min.y; let bx = 0, bz = 0, bn = 0;
      for (let i = 0; i < P.count; i++) if (P.getY(i) < bb.min.y + hgt * 0.06) { bx += P.getX(i); bz += P.getZ(i); bn++; }
      return { geo, tex, bb, hgt, base: new THREE.Vector3(bn ? bx / bn : 0, bb.min.y, bn ? bz / bn : 0) };
    });
  }
  // a failed download used to stay cached as a rejected promise, so Miami lost that prop for the whole session
  // (dev/aaa/errsweep.mjs saw it). Forget the failure and try again, twice, with a short backoff.
  p.then(cb).catch(e => {
    if (S2.glb[key] === p) delete S2.glb[key];
    if (tries < 2) setTimeout(() => miLoadProp(name, cb, tries + 1), 700 * (tries + 1));
    else console.warn('miami prop', name, e && (e.message || e.type || e));
  });
}
// instances of one prop: list of [x, y, z, yaw, height]
function miPlaceProp(parent, prop, mat, list, o = {}) {
  const im = new THREE.InstancedMesh(prop.geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Matrix4();
  list.forEach(([x, y, z, yaw, h], i) => {
    const k = h / prop.hgt; e.set(o.tilt ? (Math.random() - 0.5) * o.tilt : 0, yaw, 0); q.setFromEuler(e); s.setScalar(k); v.set(x, y, z);
    m4.compose(v, q, s); c.makeTranslation(-prop.base.x, -prop.base.y, -prop.base.z); m4.multiply(c); im.setMatrixAt(i, m4);
  });
  im.instanceMatrix.needsUpdate = true; im.castShadow = o.cast !== false; im.receiveShadow = !!o.recv;
  parent.add(im); return im;
}
// One Streamline Moderne block built in its own frame and baked into collector C.
// Frame: x centred, front face at z = 0, back at z = -d, y = 0 at the pavement.
// o: m4, w, d, R (the wrap-around front-right corner), floors, fh, gf (ground floor top), sp (spandrel
//    under each window band), wh (window band), brow (eyebrow depth), par (parapet), pane, pierEvery,
//    mull, shop (cafe glass round the front and corner), ports (portholes on the side), neon (tube under
//    every eyebrow nose, or null), M { wall, trim, deep, glass, cafe, port }
function miBlock(C, o) {
  const w = o.w, d = o.d, R = o.R, M = o.M, add = (mat, geo) => C.add(mat, geo, o.m4);
  const plan = dfPlanRR(w, d, [o.r || 0.14, R, 0.12, 0.12]), mk = plan.marks;
  const s0 = -(mk.total - mk.left1) - 0.3, s1 = mk.back0 + 0.22;          // what the camera sees
  const vis = dfCut(plan.pts, s0, s1);
  const gIn = 0.16, D = o.brow || 0.4, gf = o.gf, pane = o.pane || 0.55;
  // plinth: dark terrazzo base with a bullnose top
  add(M.deep, dfSweep(vis, [[0.07, 0], [0.07, 0.22], [0.064, 0.262], [0.046, 0.296], [0.02, 0.316], [0, 0.322, DF_CREASE, 0.85]], { tile: 0.8, caps: true }));
  // ground floor: cafe glass across the front and round the corner, solid down the side
  const shopEnd = mk.right0 + 0.05, sp = dfCut(plan.pts, s0, shopEnd), side = dfCut(plan.pts, shopEnd, s1);
  if (o.shop) {
    add(M.wall, dfSweep(sp, [[0, 0.322, 0, 0.8], [0, 0.42, DF_CREASE], [0.04, 0.42, DF_CREASE], [0.04, 0.46, DF_CREASE], [-0.22, 0.46, DF_CREASE | DF_BREAK, 0.85],
      [-0.22, gf - 0.34, DF_CREASE, 0.45], [0, gf - 0.34, DF_CREASE, 0.7], [0, gf - 0.2, 0, 0.92], [0, gf - 0.14]], { tile: 1.1 }));
    add(M.cafe, dfSweep(sp, [[-0.22, 0.46, 0, 1], [-0.22, gf - 0.34, 0, 0.72]], { uk: 1 / (16 * 0.7), vk: 1 / (gf - 0.8), u0: Math.random() }));
    const mg = dfRBox(0.06, gf - 0.8, 0.06, 0.02);
    for (let s = s0 + 0.62; s < shopEnd - 0.2; s += 0.7) add(M.trim, dfOnPath(sp, mg, s, -0.19, (gf - 0.34 + 0.46) / 2));
    add(M.wall, dfSweep(side, [[0, 0.322, 0, 0.78], [0, 0.62, 0, 1], [0, gf - 0.14]], { tile: 1.1 }));
  } else add(M.wall, dfSweep(vis, [[0, 0.322, 0, 0.78], [0, 0.62, 0, 1], [0, gf - 0.14]], { tile: 1.1 }));
  // three speed lines round the corner at the head of the ground floor
  const cornerRun = dfCut(plan.pts, mk.front1 - 0.7, Math.min(mk.right0 + 0.7, s1));
  for (let i = 0; i < 3; i++) add(M.trim, dfSweep(cornerRun, dfRing(0, gf - 0.27 + i * 0.045, 0.014, 5)));
  // the upper wall: spandrels and ribbon-window recesses in ONE sweep, AO baked under every ledge
  const prof = [[0, gf - 0.14, 0, 1]], bands = [];
  for (let k = 0; k < o.floors; k++) {
    const yw0 = gf + k * o.fh + o.sp, yw1 = yw0 + o.wh; bands.push([yw0, yw1]);
    prof.push([0, yw0 - 0.32, 0, 1], [0, yw0 - 0.05, DF_CREASE, 0.88], [0.05, yw0 - 0.05, DF_CREASE], [0.05, yw0, DF_CREASE], [-gIn, yw0, DF_CREASE | DF_BREAK, 0.78],
      [-gIn, yw1, DF_CREASE, 0.48], [0, yw1, DF_CREASE, 0.7], [0, yw1 + 0.14, 0, 0.82], [0, yw1 + 0.4, 0, 1]);
  }
  const yTop = gf + o.floors * o.fh + (o.par || 0.55);
  prof.push([0, yTop - 0.1, 0, 1]);
  add(M.wall, dfSweep(vis, prof, { tile: 1.1 }));
  // glass: one strip per band, a different run of rooms on each floor
  for (const [yw0, yw1] of bands) add(M.glass, dfSweep(vis, [[-gIn, yw0, 0, 1], [-gIn, yw1, 0, 0.6]], { uk: 1 / (16 * pane), vk: 1 / (yw1 - yw0), u0: Math.random() }));
  // piers on the straights break the ribbon into window groups; the corner stays one sweep of glass
  const piers = [], step = pane * (o.pierEvery || 3);
  for (let s = mk.front0 + 0.2; s < mk.front1 - 0.15; s += step) piers.push(s);
  for (let s = mk.right0 + step * 0.7; s < mk.right1 - 0.15; s += step) piers.push(s);
  const pierG = dfRBox(0.24, o.wh, gIn + 0.05, 0.035, 1.1), mullG = new THREE.BoxGeometry(0.032, o.wh, 0.03);
  for (const [yw0, yw1] of bands) {
    for (const s of piers) add(M.wall, dfOnPath(vis, pierG, s, -gIn / 2 + 0.012, (yw0 + yw1) / 2));
    if (o.mull) for (let s = s0 + pane * 0.5; s < s1 - 0.1; s += pane) if (!piers.some(p => Math.abs(p - s) < 0.2)) add(M.trim, dfOnPath(vis, mullG, s, -gIn + 0.018, (yw0 + yw1) / 2));
  }
  // eyebrows: deep thin shades with a rounded nose and a drip, wrapped round the corner
  const brow = y => [[0, y - 0.006, DF_CREASE, 0.8], [D * 0.55, y - 0.02], [D - 0.032, y - 0.026], [D - 0.01, y - 0.016], [D, y + 0.008], [D - 0.01, y + 0.034], [D - 0.03, y + 0.046], [D * 0.55, y + 0.066], [0, y + 0.1, DF_CREASE, 0.86]];
  for (const [, yw1] of bands) {
    add(M.trim, dfSweep(vis, brow(yw1), { tile: 0.9, caps: true }));
    if (o.neon) add(o.neon, dfSweep(vis, dfRing(D - 0.035, yw1 - 0.042, 0.017, 5)));
  }
  // parapet: three speed lines, then a cove coping with a bead on top
  for (let i = 0; i < 3; i++) add(M.trim, dfSweep(vis, dfRing(0, yTop - 0.34 + i * 0.07, 0.019, 5)));
  const cr = 0.12, cov = [[0, yTop - cr - 0.05, DF_CREASE, 0.86]];
  for (let i = 1; i <= 5; i++) { const t = i / 5 * Math.PI / 2; cov.push([cr - cr * Math.cos(t), yTop - cr - 0.05 + cr * Math.sin(t)]); }
  cov.push([cr + 0.024, yTop - 0.04], [cr + 0.038, yTop - 0.012], [cr + 0.03, yTop + 0.018], [cr + 0.006, yTop + 0.034], [-0.4, yTop + 0.034]);
  add(M.trim, dfSweep(vis, cov, { tile: 0.9, caps: true }));
  // portholes down the side, one per spandrel
  if (o.ports && M.port) {
    const ring = new THREE.TorusGeometry(0.13, 0.034, 8, 20), disc = new THREE.CircleGeometry(0.125, 20);
    for (const [, yw1] of bands) for (let s = mk.right0 + 0.55; s < mk.right1 - 0.3; s += 1.1) {
      add(M.trim, dfOnPath(vis, ring, s, 0.01, yw1 + 0.34)); add(M.port, dfOnPath(vis, disc, s, -0.012, yw1 + 0.34));
    }
  }
  return { plan, vis, bands, yTop, D };
}
// the vertical fin on the facade that becomes a stepped tower with a spire above the roof
function miFinTower(C, o) {
  const add = (mat, geo) => C.add(mat, geo, o.m4), M = o.M, fx0 = o.x - o.fw / 2, fx1 = o.x + o.fw / 2, rr = Math.min(o.fw / 2 - 0.02, o.fp * 0.9);
  const hFin = o.yRoof + 0.5 - o.y0;
  add(M.wall, dfSlab(dfShapeRR(fx0, -0.4, fx1, o.fp, [rr, rr, 0.03, 0.03]), hFin, 0.06, { tile: 1.1, cs: 10 }).translate(0, o.y0, 0));
  // reeded edges: two slim rounded rods proud of the fin's flanks
  for (const s of [-1, 1]) add(M.trim, new THREE.CylinderGeometry(0.035, 0.035, hFin - 0.2, 10).translate(o.x + s * (o.fw / 2 - 0.02), o.y0 + hFin / 2, o.fp - rr * 0.6));
  // neon up the fin, on its rounded front (the surface there is an arc of radius rr, so work out z)
  if (o.neon) { const dx = o.fw / 2 - 0.13, cxA = o.fw / 2 - rr, zs = o.fp - rr + Math.sqrt(Math.max(0, rr * rr - Math.max(0, dx - cxA) ** 2));
    for (const s of [-1, 1]) add(o.neon, new THREE.CylinderGeometry(0.018, 0.018, hFin - 0.8, 6).translate(o.x + s * dx, o.y0 + hFin / 2 + 0.2, zs + 0.012)); }
  // stepped tiers, each smaller and rounder, each with a bullnose ledge (and neon) at its top; the
  // first one stands on the roof, not on the fin, or it reads as a box balanced on a stick
  let y = o.yRoof - 0.05, zF = o.fp + 0.05;
  const tiers = o.tiers || [[1.5, 1.3, 0.95], [1.12, 1.0, 0.8], [0.78, 0.72, 0.62]];
  for (const [tw, td, th] of tiers) {
    const r = Math.min(tw, td) * 0.34;
    add(M.wall, dfSlab(dfShapeRR(o.x - tw / 2, zF - td, o.x + tw / 2, zF, r), th, 0.05, { tile: 1.1, cs: 10 }).translate(0, y, 0));
    const loop = dfShift(dfPlanRR(tw, td, [r, r, r, r]).pts, o.x, zF);
    add(M.trim, dfSweep(loop, [[0, y + th - 0.1, DF_CREASE, 0.85], [0.05, y + th - 0.085], [0.07, y + th - 0.05], [0.06, y + th - 0.015], [0.03, y + th], [-0.2, y + th]]));
    if (o.neon2) add(o.neon2, dfSweep(loop, dfRing(0.05, y + th - 0.11, 0.016, 5)));
    if (tw > 1.3) for (let i = -1; i <= 1; i++) add(M.trim, dfRBox(0.09, th * 0.8, 0.14, 0.035).translate(o.x + i * 0.3, y + th * 0.45, zF + 0.04));
    y += th; zF -= 0.12;
  }
  // spire: drum, two discs, a tapered mast, a glowing tip
  const zc = zF - (tiers[tiers.length - 1][1] - 0.12) / 2 + 0.06;
  add(M.trim, new THREE.CylinderGeometry(0.2, 0.25, 0.22, 20).translate(o.x, y + 0.11, zc));
  add(M.chrome, new THREE.CylinderGeometry(0.02, 0.06, 1.5, 12).translate(o.x, y + 0.95, zc));
  for (const [dy, r] of [[0.45, 0.15], [0.75, 0.11], [1.02, 0.07]]) add(M.chrome, new THREE.CylinderGeometry(r, r, 0.03, 18).translate(o.x, y + dy, zc));
  if (o.tip) add(o.tip, new THREE.SphereGeometry(0.06, 12, 8).translate(o.x, y + 1.72, zc));
  return { top: y + 1.72, zc };
}
function miGlassBlockTex() {
  return canvasTex(128, 128, (c, W, H) => {
    // low contrast on purpose: it stands right behind a fighter on the main floor
    c.fillStyle = '#4c5e66'; c.fillRect(0, 0, W, H);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const g = c.createRadialGradient(x * 32 + 13, y * 32 + 12, 2, x * 32 + 16, y * 32 + 16, 20);
      g.addColorStop(0, '#9fbcc2'); g.addColorStop(0.6, '#7f9aa2'); g.addColorStop(1, '#63787f'); c.fillStyle = g; c.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
    }
  }, [1, 1]);
}
// the wet road's reflections of every neon line above it: one additive texture, stretched toward the
// camera the way a near-level eye sees a wet street. [u 0..1 across, width 0..1, 'r,g,b', strength]
function miStreakTex(list) {
  return canvasTex(512, 512, (c, W, H) => {
    // drawn sharp on a scratch canvas, then laid down through a blur: hard-edged rectangles read as
    // pixels, a soft broken line reads as light on water
    const o = document.createElement('canvas'); o.width = W; o.height = H; const x2 = o.getContext('2d');
    x2.fillStyle = '#000'; x2.fillRect(0, 0, W, H); x2.globalCompositeOperation = 'lighter';
    for (const [u, wu, rgb, k, wash] of list) {
      if (wash) {   // a broad soft column: the reflection of a whole lit facade, not of one tube
        const g = x2.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(${rgb},${k})`); g.addColorStop(0.55, `rgba(${rgb},${k * 0.35})`); g.addColorStop(1, `rgba(${rgb},0)`);
        x2.fillStyle = g; x2.fillRect((u - wu / 2) * W, 0, wu * W, H); continue;
      }
      const n = Math.max(3, Math.round(wu * W / 2.2));
      for (let l = 0; l < n; l++) {
        const x = u * W + (l / (n - 1) - 0.5) * wu * W, core = 1 - Math.abs(l / (n - 1) - 0.5) * 1.6;
        let y = Math.random() * 6;
        while (y < H) {
          const seg = 4 + Math.random() * 22, f0 = Math.pow(1 - y / H, 1.2), f1 = Math.pow(Math.max(0, 1 - (y + seg) / H), 1.2), a = Math.min(1, k * 1.25 * Math.max(0.2, core));
          const g = x2.createLinearGradient(0, y, 0, y + seg); g.addColorStop(0, `rgba(${rgb},${a * f0})`); g.addColorStop(1, `rgba(${rgb},${a * f1})`);
          x2.fillStyle = g; x2.fillRect(x + (Math.random() - 0.5) * 3, y, 2.6, seg); y += seg + 1 + Math.random() * 3;
        }
      }
    }
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.filter = 'blur(2.2px)'; c.drawImage(o, 0, 0); c.filter = 'none';
  });
}
function buildMiami(st) {
  const g = new THREE.Group(), R = new THREE.Group(); g.add(R);
  const M = st.main, W = (M.x1 - M.x0) * SC, CX = (M.x0 + M.x1) / 2 * SC;
  scene.fog = new THREE.Fog(0xf0a894, 34, 130);
  g.add(skyDome(0x3f63c8, 0xff9ab0, 0xffd0a8));
  const C = dfCollector(), CM = dfCollector(), flags = new Map();

  // ---------- materials ----------
  // stucco: the photographed plaster (stg_plaster, desaturated to near white) tinted by colour, with
  // its real normal map, and vertex colour carrying the baked AO from dfSweep
  const vc = { vertexColors: true };
  const miPink = dfPlasterMat('#d0909c', { n: 0.8, rough: 0.9, m: vc });
  const miTrim = dfPlasterMat('#dcd2c4', { fine: true, n: 0.55, rough: 0.72, m: vc });
  const miDeep = dfPlasterMat('#3a4550', { fine: true, n: 0.6, rough: 0.5, m: vc });           // sign panels, drains
  const miBase = dfPlasterMat('#86796f', { fine: true, n: 0.65, rough: 0.55, m: vc });         // the buildings' plinths
  const miMintW = dfPlasterMat('#84b9a9', { n: 0.7, rough: 0.9, m: vc });
  const miTeal = dfPlasterMat('#3d7f80', { fine: true, n: 0.5, rough: 0.6, m: vc });
  const miButter = dfPlasterMat('#d6bd7c', { n: 0.7, rough: 0.9, m: vc });
  const miLav = dfPlasterMat('#a798c2', { n: 0.7, rough: 0.9, m: vc });
  const miStone = dfPlasterMat('#7c7168', { fine: true, n: 0.85, rough: 0.92, m: vc });
  const miSand = dfPlasterMat('#b8a179', { n: 1.1, rough: 0.97 });
  const miSteel = std({ color: 0x3b3f46, roughness: 0.45, metalness: 0.9 });
  const miChrome = std({ color: 0xe6eaf0, roughness: 0.12, metalness: 1, envMapIntensity: 1.8 });
  const gl1 = miGlassTex('room'), gl2 = miGlassTex('cafe');
  const miGlass = std({ map: gl1.map, emissive: 0xffffff, emissiveMap: gl1.emi, emissiveIntensity: 1.15, roughness: 0.1, metalness: 0.4, envMapIntensity: 1.1, vertexColors: true });
  const miCafe = std({ map: gl2.map, emissive: 0xffffff, emissiveMap: gl2.emi, emissiveIntensity: 0.8, roughness: 0.12, metalness: 0.35, envMapIntensity: 0.9, vertexColors: true });
  const miPort = std({ color: 0x1c2330, roughness: 0.06, metalness: 0.8, envMapIntensity: 1.8 });
  const miNeonP = glow(0xff4f8f, 1.45), miNeonT = glow(0x3fe4ff, 1.4), miNeonG = glow(0xffd24a, 1.3), miNeonV = glow(0xb07cff, 1.4);
  const miWalk = tileMat('sidewalk', { m: { roughness: 0.55, metalness: 0.05, color: 0xc2b2a2, envMapIntensity: 0.3 } });
  const miRoad = tileMat('asphalt', { m: { roughness: 0.18, metalness: 0.35, color: 0x34303c, envMapIntensity: 0.7 } });
  for (const m of [miGlass, miCafe, miPort]) flags.set(m, { cast: false });
  for (const m of [miNeonP, miNeonT, miNeonG, miNeonV]) flags.set(m, { cast: false, recv: false });

  // ---------- ground: terrace, bullnose kerb, and the wet boulevard in front of and below the fight plane ----------
  const zKerb = 1.35, zWall = -1.45, yRoad = -0.34;
  dfGround(R, 19, 26, 12, -21, miRoad, { x: -0.5, y: yRoad, recv: true });
  // far road: warm sky sheen toward the horizon (additive, sized to what the camera sees)
  const miWetT = canvasTex(16, 256, (c, w2, h2) => {
    const gr = c.createLinearGradient(0, h2, 0, 0);
    gr.addColorStop(0, 'rgba(255,190,150,0)'); gr.addColorStop(0.45, 'rgba(255,172,146,.22)');
    gr.addColorStop(0.82, 'rgba(255,196,168,.60)'); gr.addColorStop(1, 'rgba(255,214,186,.80)');
    c.fillStyle = gr; c.fillRect(0, 0, w2, h2);
  });
  dfGround(R, 9, 17, -1, -15, new THREE.MeshBasicMaterial({ map: miWetT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), { x: -2, y: yRoad + 0.004 });
  // near road: every neon line above reflected as a broken vertical streak (ONE additive plane)
  const miStreak = miStreakTex([
    [0.272, 0.035, '255,80,150', 1.0], [0.24, 0.02, '255,80,150', 0.6], [0.31, 0.04, '255,90,160', 0.8], [0.36, 0.03, '255,90,160', 0.7], [0.41, 0.03, '255,110,170', 0.6], [0.455, 0.02, '255,150,190', 0.5],
    [0.475, 0.03, '255,210,90', 0.7], [0.5, 0.05, '80,230,255', 0.9], [0.54, 0.03, '255,210,90', 0.6], [0.6, 0.04, '80,230,255', 0.9], [0.66, 0.03, '80,230,255', 0.8],
    [0.185, 0.03, '255,220,170', 0.6], [0.945, 0.03, '255,220,170', 0.6], [0.08, 0.03, '120,230,255', 0.3], [0.9, 0.02, '255,120,180', 0.3],
    [0.33, 0.22, '235,120,150', 0.3, 1], [0.5, 0.1, '255,228,190', 0.22, 1], [0.63, 0.13, '205,240,240', 0.18, 1], [0.86, 0.26, '255,170,130', 0.14, 1], [0.09, 0.14, '140,210,200', 0.14, 1],
  ]);
  const miStreakM = new THREE.MeshBasicMaterial({ map: miStreak, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const miStreakP = put(R, new THREE.PlaneGeometry(20, 6.6), miStreakM, 0, yRoad + 0.008, zKerb + 3.75, { rx: -Math.PI / 2 });
  // the terrace the fight happens on, with a bullnose kerb along its front instead of a box edge
  // (a vertexColors material on geometry with no colour attribute reads the GL default (0,0,0) = BLACK)
  const zBack = -2.1;
  { const tg = wbox(36, 0.34, zKerb - zBack - 0.02, 0.6); tg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(tg.attributes.position.count * 3).fill(1), 3));
    put(R, tg, [miStone, miStone, miWalk, miStone, miStone, miStone], 0, -0.17, (zKerb + zBack) / 2 - 0.01, { recv: true }); }
  const kerbPath = dfPath([[-32, zKerb], [32, zKerb]]);
  C.add(miStone, dfSweep(kerbPath, [[0.02, yRoad, 0, 0.5], [0.02, -0.2, 0, 0.8], [0.02, -0.08, 0, 0.97], [0.012, -0.035], [-0.006, -0.008], [-0.03, 0.004], [-0.3, 0.006]], { tile: 0.6 }));
  C.add(miDeep, dfSweep(kerbPath, [[0.36, yRoad + 0.003], [0.02, yRoad + 0.003]], { tile: 0.6 }));   // gutter
  // drains with real slots, and a manhole
  { const fr = [], sl = [];
    for (const gx of [-2.6, 2.2]) { fr.push(dfRBox(0.66, 0.1, 0.34, 0.03).translate(gx, yRoad + 0.03, zKerb + 0.2)); for (let i = 0; i < 7; i++) sl.push(new THREE.BoxGeometry(0.5, 0.04, 0.026).translate(gx, yRoad + 0.07, zKerb + 0.08 + i * 0.038)); }
    fr.forEach(x => C.add(miSteel, x)); sl.forEach(x => C.add(miPort, x)); }
  C.add(miSteel, new THREE.CylinderGeometry(0.28, 0.28, 0.03, 20).translate(1.1, yRoad + 0.015, 3.1));
  // paving joints and hairline cracks: the camera punches in and the pavement fills half the frame
  { const gs = [];
    for (let x = -17.5; x < 17.6; x += 1.25) gs.push(new THREE.BoxGeometry(0.03, 0.012, zKerb - zBack - 0.4).translate(x, 0.004, (zKerb + zBack) / 2 - 0.1));
    for (let z = zBack + 0.3; z < zKerb - 0.3; z += 0.95) gs.push(new THREE.BoxGeometry(35.6, 0.012, 0.03).translate(0, 0.004, z));
    for (let x = -16.5; x < 16.6; x += 1.1) gs.push(new THREE.BoxGeometry(0.014, 0.3, 0.012).translate(x + (Math.random() - 0.5) * 0.2, yRoad + 0.17, zKerb + 0.024));   // kerb-stone joints
    for (let i = 0; i < 34; i++) { const x = -16 + Math.random() * 32, z = zBack + 0.2 + Math.random() * (zKerb - zBack - 0.6); gs.push(new THREE.BoxGeometry(0.018, 0.012, 0.2 + Math.random() * 0.5).rotateY((Math.random() - 0.5) * 1.6).translate(x, 0.005, z)); }
    const jm = std({ color: 0x70665c, roughness: 0.95 }); flags.set(jm, { cast: false }); gs.forEach(x => C.add(jm, x)); }
  // puddles: low-roughness metal so the sky and the neon land in them
  const miPudT = canvasTex(128, 64, (c, w2, h2) => {
    c.clearRect(0, 0, w2, h2);
    for (let i = 0; i < 9; i++) {
      const cx2 = w2 * (0.15 + Math.random() * 0.7), cy2 = h2 * (0.25 + Math.random() * 0.5), rx = w2 * (0.1 + Math.random() * 0.22), ry = h2 * (0.16 + Math.random() * 0.26);
      const gr = c.createRadialGradient(cx2, cy2, 0, cx2, cy2, Math.max(rx, ry));
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.62, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.save(); c.translate(cx2, cy2); c.scale(rx / ry, 1); c.beginPath(); c.arc(0, 0, ry, 0, 7); c.fill(); c.restore();
    }
  });
  const miPud = std({ color: 0x3a3442, roughness: 0.03, metalness: 0.65, envMapIntensity: 0.9, emissive: 0xffbe98, emissiveIntensity: 0.06, alphaMap: miPudT, transparent: true, depthWrite: false });
  for (const [x, z, w2, d2] of [[-3.4, 2.7, 3.4, 0.9], [1.2, 3.4, 4.2, 1.2], [4.6, 2.4, 2.6, 0.8]]) put(R, new THREE.PlaneGeometry(w2, d2), miPud, x, yRoad + 0.006, z, { rx: -Math.PI / 2 });

  // ---------- the hotel: a Streamline Moderne corner block, on the left ----------
  // Still turned 15 degrees off the camera axis (the fix for "cardboard", see 9/21), and now the
  // corner that faces the middle of the stage is a 1.5-unit curve: it wraps the eyebrows, the neon, the
  // ribbon windows and the speed lines round from the front to the sunlit side, which is the single
  // most Miami thing a building can do and the opposite of a box.
  const P = st.plats, p0 = P[0], p1 = P[1], p2 = P[2];
  const hcx = -3.085, hw = 4.73, hd = 4.3, miRot = -0.26, R0 = 1.5;
  const Hm = new THREE.Matrix4().compose(new THREE.Vector3(hcx, 0, zWall), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, miRot, 0)), new THREE.Vector3(1, 1, 1));
  const hW = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(Hm);
  const H = new THREE.Group(); H.position.set(hcx, 0, zWall); H.rotation.y = miRot; R.add(H);
  const HM = { wall: miPink, trim: miTrim, deep: miBase, glass: miGlass, cafe: miCafe, port: miPort, chrome: miChrome };
  const hot = miBlock(C, { m4: Hm, w: hw, d: hd, R: R0, floors: 3, fh: 1.62, gf: 1.5, sp: 0.44, wh: 0.86, brow: 0.42, par: 0.64, pane: 0.55, pierEvery: 3, mull: true, shop: true, ports: true, neon: miNeonP, M: HM });
  // the fin and its stepped tower + spire, left of centre on the front
  const finX = -1.35;
  miFinTower(C, { m4: Hm, x: finX, fw: 0.92, fp: 0.62, y0: 1.36, yRoof: hot.yTop, M: HM, neon: miNeonP, neon2: miNeonT, tip: miNeonP });
  // the name, stacked Deco letters down the fin on a dark rounded panel
  C.add(miDeep, dfSlab(dfShapeRR(finX - 0.25, 0.48, finX + 0.25, 0.665, 0.04), 3.9, 0.025).translate(0, 2.2, 0), Hm);
  const miName = miNeonText('CORAL', '#ffc4d8', 0.42, 3.55, true); miName.position.set(finX, 4.12, 0.672); H.add(miName);
  // entrance canopy under the fin: a stadium slab with a neon edge
  C.add(miTrim, dfSlab(dfShapeRR(finX - 0.85, -0.05, finX + 0.85, 0.95, [0.5, 0.5, 0.02, 0.02]), 0.1, 0.04).translate(0, 1.27, 0), Hm);
  { const ec = dfPlanRR(1.7, 1.0, [0.5, 0.5, 0.02, 0.02]); C.add(miNeonT, dfSweep(dfCut(dfShift(ec.pts, finX, 0.95), -(ec.marks.total - ec.marks.left1), ec.marks.right0 + 0.2), dfRing(0, 1.255, 0.014, 5)), Hm); }
  // ---- balcony (soft platform 0): a slab that follows the corner round, sized so its surface covers
  // the platform's world span on z = 0 and ENDS where the platform ends (a floor that runs past the
  // edge of the platform would drop a fighter through something that looks solid)
  const by = -p0.y * SC, bOut = 1.9, cxC = hw / 2 - R0, czC = -R0, Ro = R0 + bOut, cosR = Math.cos(miRot), sinR = Math.sin(miRot);
  let bL = 0, bPhi = 0.35;
  { let best = 1e9;
    for (let lx = -1.2; lx < 0.8; lx += 0.005) { const lz = (zWall * -1 + lx * sinR) / cosR, x = hcx + lx * cosR + lz * sinR, e = Math.abs(x - (p0.x0 * SC - 0.04)); if (e < best) { best = e; bL = lx; } }
    best = 1e9;
    for (let a = 0.02; a < 1.3; a += 0.004) {
      const A = hW(cxC + Math.sin(a) * R0, 0, czC + Math.cos(a) * R0), B = hW(cxC + Math.sin(a) * Ro, 0, czC + Math.cos(a) * Ro);
      if (A.z * B.z > 0) continue;
      const t = A.z / (A.z - B.z), x = A.x + (B.x - A.x) * t, e = Math.abs(x - (p0.x1 * SC + 0.04)); if (e < best) { best = e; bPhi = a; }
    } }
  { const s = new THREE.Shape(), Ri = R0 - 0.06;
    s.moveTo(bL, 0.06); s.lineTo(bL, -bOut); s.lineTo(cxC, -bOut);
    s.absarc(cxC, -czC, Ro, -Math.PI / 2, -Math.PI / 2 + bPhi, false);
    s.lineTo(cxC + Math.cos(-Math.PI / 2 + bPhi) * Ri, -czC + Math.sin(-Math.PI / 2 + bPhi) * Ri);
    s.absarc(cxC, -czC, Ri, -Math.PI / 2 + bPhi, -Math.PI / 2, true);
    s.lineTo(bL, 0.06);
    C.add(miTrim, dfSlab(s, 0.17, 0.06, { tile: 0.8, cs: 24 }).translate(0, by - 0.17, 0), Hm);
    // its outer edge as a path: neon under the fascia, two speed lines on it
    const edge = dfPath([[bL, bOut], ...dfArcPts(cxC, czC, Ro, 0, bPhi, 18)]);
    C.add(miNeonP, dfSweep(edge, dfRing(-0.05, by - 0.2, 0.016, 5)), Hm);
    for (const dy of [0.065, 0.11]) C.add(miTrim, dfSweep(edge, dfRing(0, by - dy, 0.012, 5)), Hm);
    // pipe rails only at the two ends: nothing crosses in front of a fighter standing on it
    const rails = [dfPath([[bL + 0.08, 0.15], [bL + 0.08, bOut - 0.08]]), dfPath([[cxC + Math.sin(bPhi) * (R0 + 0.1), czC + Math.cos(bPhi) * (R0 + 0.1)], [cxC + Math.sin(bPhi) * (Ro - 0.08), czC + Math.cos(bPhi) * (Ro - 0.08)]])];
    for (const rp of rails) {
      for (const hy of [0.24, 0.46]) C.add(miChrome, dfSweep(rp, dfRing(0, by + hy, 0.022, 7)), Hm);
      for (const q of [rp[0], rp[rp.length - 1], dfLerpP(rp[0], rp[rp.length - 1], 0.5)]) C.add(miChrome, new THREE.CylinderGeometry(0.02, 0.02, 0.46, 8).translate(q.x, by + 0.23, q.z), Hm);
    } }
  // cafe tables and bistro chairs under the balcony, every piece standing on the pavement and sized to
  // the fighters (9/22: legless chair seats read as sitting on the plinth a metre above the tables)
  { const tb = [], ch = [];
    for (const lx of [-1.9, 0.1, 1.0]) {
      tb.push(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 20).translate(lx, 0.5, 0.62), new THREE.CylinderGeometry(0.016, 0.022, 0.49, 8).translate(lx, 0.25, 0.62), new THREE.CylinderGeometry(0.11, 0.12, 0.02, 16).translate(lx, 0.01, 0.62));
      for (const s of [-1, 1]) { const cx2 = lx + s * 0.31;
        ch.push(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16).translate(cx2, 0.3, 0.66), new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6).translate(cx2, 0.15, 0.66),
          new THREE.CylinderGeometry(0.075, 0.08, 0.015, 14).translate(cx2, 0.008, 0.66), dfRBox(0.19, 0.2, 0.025, 0.012).translate(cx2, 0.43, 0.57));
      } }
    tb.forEach(x => C.add(miChrome, x, Hm)); ch.forEach(x => C.add(miTrim, x, Hm)); }

  // ---------- the flying canopy (soft platform 2): a stadium slab on two chrome columns ----------
  const tx = (p2.x0 + p2.x1) / 2 * SC, tw = (p2.x1 - p2.x0) * SC, ty = -p2.y * SC, cz0 = -1.05, cz1 = 0.22, cdep = cz1 - cz0;
  C.add(miTrim, dfSlab(dfShapeRR(tx - tw / 2 - 0.3, cz0, tx + tw / 2 + 0.3, cz1, cdep / 2 - 0.01), 0.16, 0.055, { tile: 0.8, cs: 16 }).translate(0, ty - 0.16, 0));
  // a marquee band all the way round under it, with three speed lines and neon along its foot
  const canLoop = dfShift(dfPlanRR(tw + 0.6, cdep, [cdep / 2 - 0.01, cdep / 2 - 0.01, cdep / 2 - 0.01, cdep / 2 - 0.01]).pts, tx, cz1);
  C.add(miTeal, dfSweep(canLoop, [[-0.24, ty - 0.44], [-0.1, ty - 0.44, DF_CREASE], [-0.08, ty - 0.425], [-0.07, ty - 0.4], [-0.07, ty - 0.16, DF_CREASE]], { tile: 0.8 }));
  // speed lines round the two rounded ends only: the front carries the lettering
  const cmk = dfPlanRR(tw + 0.6, cdep, [cdep / 2 - 0.01, cdep / 2 - 0.01, cdep / 2 - 0.01, cdep / 2 - 0.01]).marks, canEnds = dfCut(canLoop, cmk.front1 - cmk.total, cmk.front0);
  for (let i = 0; i < 3; i++) C.add(miTrim, dfSweep(canEnds, dfRing(-0.07, ty - 0.23 - i * 0.055, 0.011, 5)));
  C.add(miNeonT, dfSweep(canLoop, dfRing(-0.075, ty - 0.455, 0.016, 5)));
  C.add(miNeonG, dfSweep(canLoop, dfRing(-0.02, ty - 0.012, 0.012, 5)));
  // bright enough to read, dim enough that bloom does not melt it into a blob in a wide shot
  const miMarq = miNeonText('OCEAN DRIVE', '#ffe0a0', tw * 0.86, 0.17, false, 1.05); miMarq.position.set(tx, ty - 0.3, cz1 - 0.06); R.add(miMarq);
  for (const s of [-1, 1]) {
    const cxp = tx + s * (tw / 2 + 0.02), cz = -0.74;
    C.add(miChrome, new THREE.CylinderGeometry(0.06, 0.07, ty - 0.44, 16).translate(cxp, (ty - 0.44) / 2, cz));
    C.add(miTrim, dfSlab(dfShapeRR(cxp - 0.16, cz - 0.16, cxp + 0.16, cz + 0.16, 0.15), 0.14, 0.04));
    C.add(miChrome, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16).translate(cxp, ty - 0.46, cz));
    dfShadowOn(R, 0.5, 0.42, cxp, cz, { op: 0.5 });
  }

  // ---------- beach pavilion (soft platform 1): a cantilevered roof on a curved glass-block screen ----------
  const sx = (p1.x0 + p1.x1) / 2 * SC, sw = (p1.x1 - p1.x0) * SC, sy = -p1.y * SC, pz0 = -1.05, pz1 = 0.26, pd = pz1 - pz0;
  C.add(miTrim, dfSlab(dfShapeRR(sx - sw / 2 - 0.3, pz0, sx + sw / 2 + 0.3, pz1, [0.62, 0.62, 0.2, 0.2]), 0.15, 0.05, { tile: 0.8, cs: 16 }).translate(0, sy - 0.15, 0));
  const pavLoop = dfShift(dfPlanRR(sw + 0.6, pd, [0.62, 0.62, 0.2, 0.2]).pts, sx, pz1);
  C.add(miMintW, dfSweep(pavLoop, [[-0.24, sy - 0.33], [-0.095, sy - 0.33, DF_CREASE], [-0.075, sy - 0.322], [-0.06, sy - 0.3], [-0.06, sy - 0.15, DF_CREASE]], { tile: 0.8 }));
  for (let i = 0; i < 3; i++) C.add(miTrim, dfSweep(pavLoop, dfRing(-0.06, sy - 0.19 - i * 0.045, 0.01, 5)));
  C.add(miNeonT, dfSweep(pavLoop, dfRing(-0.07, sy - 0.345, 0.016, 5)));
  // the screen: glass block on a gentle curve, with a rounded cap
  const miGB = std({ map: miGlassBlockTex(), roughness: 0.25, metalness: 0.15, envMapIntensity: 0.6, emissive: 0x2a4a54, emissiveIntensity: 0.12 });
  const scrPts = []; for (let i = 0; i <= 16; i++) { const t = i / 16 * 2 - 1; scrPts.push([sx + t * (sw / 2 + 0.1), -0.86 - 0.22 * (1 - t * t)]); }
  const scr = dfPath(scrPts);
  C.add(miGB, dfSweep(scr, [[0.05, 0.04], [0.05, sy - 0.34]], { uk: 1 / 0.5, vk: 1 / 0.5 }));
  C.add(miTrim, dfSweep(scr, [[0.08, 0], [0.08, 0.05], [0.05, 0.07], [-0.05, 0.07], [-0.08, 0.05], [-0.08, 0]], { caps: true }));
  for (const s of [-1, 1]) C.add(miChrome, new THREE.CylinderGeometry(0.05, 0.06, sy - 0.34, 14).translate(sx + s * (sw / 2 + 0.16), (sy - 0.34) / 2, -0.84));
  C.add(miTrim, dfRBox(sw - 0.3, 0.07, 0.36, 0.03).translate(sx, 0.44, -0.62));
  for (const s of [-1, 1]) C.add(miTrim, dfRBox(0.08, 0.42, 0.3, 0.03).translate(sx + s * (sw / 2 - 0.35), 0.21, -0.62));
  dfShadowOn(R, sw + 0.7, 0.6, sx, -0.5, { op: 0.42 });

  // ---------- seawall with a bullnose coping and portholes, steps down, then the sand ----------
  const wallPath = dfPath([[-0.3, -2.06], [11.1, -2.06]]);
  C.add(miStone, dfSweep(wallPath, [[0, -0.1, 0, 0.8], [0, 0.5, 0, 1], [0.02, 0.53], [0.06, 0.55, DF_CREASE], [0.075, 0.575], [0.07, 0.61], [0.045, 0.64], [0, 0.65], [-0.45, 0.65]], { tile: 0.6 }));
  for (let i = 0; i <= 8; i++) { const x = -0.1 + i * 1.42; C.add(miStone, dfRBox(0.26, 0.84, 0.54, 0.06).translate(x, 0.42, -2.25)); C.add(miTrim, dfRBox(0.34, 0.1, 0.62, 0.04).translate(x, 0.89, -2.25)); }
  { const ring = new THREE.TorusGeometry(0.1, 0.022, 6, 16), disc = new THREE.CircleGeometry(0.095, 16);
    for (let i = 0; i < 14; i++) { const x = 0.1 + i * 0.82; if (i % 7 === 3) continue; C.add(miTrim, ring.clone().translate(x, 0.29, -2.045)); C.add(miPort, disc.clone().translate(x, 0.29, -2.052)); } }
  for (let k = 0; k < 4; k++) C.add(miStone, dfRBox(1.5, 0.16, 0.34, 0.05).translate(3.05, 0.46 - k * 0.15, -2.42 - k * 0.3));
  put(R, new THREE.PlaneGeometry(12, 0.9), new THREE.MeshBasicMaterial({ map: canvasTex(128, 32, (c, w2, h2) => { c.clearRect(0, 0, w2, h2); for (let i = 0; i < 260; i++) { const y = Math.random() * h2; c.fillStyle = `rgba(226,205,166,${(1 - y / h2) * 0.55})`; c.fillRect(Math.random() * w2, y, 2 + Math.random() * 7, 2); } }), transparent: true, depthWrite: false }), 5.4, 0.006, -1.72, { rx: -Math.PI / 2 });
  dfGround(R, 13, 16, -1.6, -15, miSand, { x: 10, y: -0.06, recv: true });
  dfGround(R, 15, 26, -13, -27, std({ color: 0x1f5f86, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.6 }), { x: 10, y: -0.1 });
  const miSurfT = canvasTex(256, 32, (c, w2, h2) => { c.clearRect(0, 0, w2, h2); for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`; const x = Math.random() * w2, ww2 = 6 + Math.random() * 30; c.fillRect(x, h2 * 0.3 + Math.random() * h2 * 0.4, ww2, 2 + Math.random() * 4); } }, [3, 1]);
  const miSurf = put(R, new THREE.PlaneGeometry(50, 1.4), new THREE.MeshBasicMaterial({ map: miSurfT, transparent: true, depthWrite: false, opacity: 0.85 }), 10, -0.09, -13.4, { rx: -Math.PI / 2 });
  for (let k = 0; k < 2; k++) put(R, new THREE.PlaneGeometry(0.9 + k * 0.7, 7 - k), glowA(0xffcf8a, 0.9, 0.3 - k * 0.07), 12 + k, -0.08, -18 - k * 1.6, { rx: -Math.PI / 2 });

  // ---------- mid-ground: pastel Deco blocks down the street, same kit, cheaper settings ----------
  const miRow = [
    { x: -9.4, z: -6.3, ry: 0.32, w: 5.0, d: 5.0, R: 1.3, floors: 4, wall: miMintW, neon: miNeonT, fin: true, name: 'SURF' },
    { x: -15.4, z: -12.6, ry: 0.44, w: 5.6, d: 5.2, R: 1.7, floors: 5, wall: miButter, neon: miNeonV, fin: false },
    { x: -21.8, z: -20.2, ry: 0.56, w: 6.2, d: 5.4, R: 1.9, floors: 5, wall: miLav, neon: miNeonP, fin: true },
  ];
  for (const b of miRow) {
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.ry, 0)), new THREE.Vector3(1, 1, 1));
    const BM = { wall: b.wall, trim: miTrim, deep: miBase, glass: miGlass, cafe: miCafe, port: miPort, chrome: miChrome };
    const blk = miBlock(CM, { m4, w: b.w, d: b.d, R: b.R, floors: b.floors, fh: 1.62, gf: 1.4, sp: 0.44, wh: 0.86, brow: 0.4, par: 0.6, pane: 0.6, pierEvery: 3, mull: false, shop: true, ports: false, neon: b.neon, M: BM });
    if (b.fin) miFinTower(CM, { m4, x: -b.w * 0.18, fw: 0.86, fp: 0.56, y0: 0.3, yRoof: blk.yTop, M: BM, neon: b.neon, neon2: b.neon, tip: b.neon, tiers: [[1.3, 1.1, 0.8], [0.9, 0.8, 0.6]] });
  }

  // ---------- generated props: palms, convertibles, the lifeguard tower ----------
  // nothing taller than the kerb ever goes in front of the fight plane (9/21): every palm is behind it
  // near palms cast (their shadows land on the hotel's corner and the terrace); far ones are outside the
  // shadow box anyway, and an InstancedMesh is never culled out of the shadow pass by itself
  miLoadProp('mi_palm_a', pr => { const m = std({ map: pr.tex, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
    miPlaceProp(R, pr, m, [[1.6, 0, -2.95, 0.4, 6.3], [7.4, 0, -3.7, 2.1, 6.7], [-7.0, 0, -4.2, 1.2, 6.9]], { tilt: 0.06 });
    miPlaceProp(R, pr, m, [[15.6, 0, -10.5, 3.6, 7.2], [-11.8, 0, -13.2, 0.8, 7.6], [10.8, 0, -8.6, 5.1, 7.0]], { tilt: 0.06, cast: false }); });
  miLoadProp('mi_palm_b', pr => { const m = std({ map: pr.tex, roughness: 0.74, metalness: 0, side: THREE.DoubleSide });
    miPlaceProp(R, pr, m, [[4.6, 0, -3.3, 1.7, 7.0], [9.9, 0, -5.4, 0.3, 7.4]]);
    miPlaceProp(R, pr, m, [[-5.6, 0, -8.8, 2.8, 7.8], [12.8, 0, -14.8, 4.4, 8.0], [18.6, 0, -17.2, 1.1, 8.2], [-17.6, 0, -16.0, 2.2, 8.4]], { cast: false }); });
  miLoadProp('mi_tower', pr => miPlaceProp(R, pr, std({ map: pr.tex, roughness: 0.6, metalness: 0.05 }), [[6.4, -0.06, -6.8, -0.9, 3.1]], { recv: true }));
  // parked at the frame edges on purpose (a car in the middle would cross the fighters' legs); the
  // models' noses point down -x, so a car facing +x is turned half round
  const miMove = [];
  miLoadProp('mi_car_a', pr => {
    const k = 3.05 / (pr.bb.max.x - pr.bb.min.x), mat = std({ map: pr.tex, roughness: 0.28, metalness: 0.35, envMapIntensity: 1.3 });
    miPlaceProp(R, pr, mat, [[-6.9, yRoad, 2.5, Math.PI, pr.hgt * k]]);
    const mv = miPlaceProp(R, pr, mat, [[0, 0, 0, Math.PI, pr.hgt * k]], { cast: false }); mv.position.set(-14, yRoad, -9.4); mv.frustumCulled = false; miMove[0] = mv;
  });
  miLoadProp('mi_car_b', pr => {
    const k = 3.0 / (pr.bb.max.x - pr.bb.min.x), mat = std({ map: pr.tex, roughness: 0.28, metalness: 0.35, envMapIntensity: 1.3 });
    miPlaceProp(R, pr, mat, [[7.1, yRoad, 2.65, 0, pr.hgt * k]]);
    const mv = miPlaceProp(R, pr, mat, [[0, 0, 0, 0, pr.hgt * k]], { cast: false }); mv.position.set(16, yRoad, -12.6); mv.frustumCulled = false; miMove[1] = mv;
  });
  for (const [x, z] of [[-6.9, 2.5], [7.1, 2.65]]) dfShadowOn(R, 3.2, 0.9, x, z, { groundY: yRoad, op: 0.5 });

  // ---------- beach dressing ----------
  const miUmbN = 8, miUmb = [];
  for (let i = 0; i < miUmbN; i++) miUmb.push([5.6 + Math.random() * 12, -5.0 - Math.random() * 7.5, 0.78 + Math.random() * 0.4, (Math.random() - 0.5) * 0.35]);
  const miUmbT = canvasTex(64, 64, (c, w2, h2) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f2e4cc' : ['#d8604e', '#3fb6c4', '#e8b84a'][i % 3]; c.beginPath(); c.moveTo(w2 / 2, h2 / 2); c.arc(w2 / 2, h2 / 2, w2 / 2, i * Math.PI / 4, (i + 1) * Math.PI / 4); c.fill(); } }, [1, 1]);
  const umbG = new THREE.ConeGeometry(0.62, 0.3, 16, 1, true); { const p = umbG.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, p.getY(i) + Math.abs(Math.sin(a * 4)) * 0.05); } umbG.computeVertexNormals(); }
  const miUmbM = new THREE.InstancedMesh(umbG, std({ map: miUmbT, roughness: 0.9, side: THREE.DoubleSide }), miUmbN);
  const miPoleM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 1.2, 6), std({ color: 0xe8e0d0, roughness: 0.6 }), miUmbN);
  { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    miUmb.forEach((u, i) => { e.set(u[3], Math.random() * 3, 0); q.setFromEuler(e); v.set(u[0], u[2] + 0.26, u[1]); m4.compose(v, q, one); miUmbM.setMatrixAt(i, m4); v.set(u[0], u[2] * 0.5 - 0.1, u[1]); m4.compose(v, q, one); miPoleM.setMatrixAt(i, m4); }); }
  miUmbM.instanceMatrix.needsUpdate = true; miPoleM.instanceMatrix.needsUpdate = true; miUmbM.castShadow = true; R.add(miUmbM); R.add(miPoleM);
  { const lm = std({ color: 0xe4dcc8, roughness: 0.78 });
    for (let i = 0; i < 7; i++) {
      const x = 2.2 + Math.random() * 15, z = -4.8 - Math.random() * 7.8, a = (Math.random() - 0.5) * 1.2;
      CM.add(lm, dfRBox(0.66, 0.05, 0.3, 0.02).rotateY(a).translate(x, 0.12, z));
      CM.add(lm, dfRBox(0.3, 0.05, 0.3, 0.02).rotateZ(-0.7).rotateY(a).translate(x - 0.36 * Math.cos(a), 0.24, z + 0.36 * Math.sin(a)));
    } }
  // a timber pier out over the water: one long receding horizontal is worth ten props
  { const pm = dfPlasterMat('#9a8672', { k: 1.4, n: 0.5, rough: 0.95 }), px0 = 12.5, pz0 = -8.5, pz1 = -25;
    for (let i = 0; i <= 16; i++) { const t = i / 16, z = pz0 + (pz1 - pz0) * t; for (const dx of [-1.15, 1.15]) CM.add(pm, new THREE.CylinderGeometry(0.075, 0.09, 1.5, 6).translate(px0 + dx + t * 1.8, -0.45, z)); }
    CM.add(pm, dfRBox(2.6, 0.12, pz0 - pz1, 0.04).translate(px0 + 0.9, 0.22, (pz0 + pz1) / 2));
    for (const dx of [-1.2, 1.2]) CM.add(pm, new THREE.CylinderGeometry(0.03, 0.03, pz0 - pz1, 6).rotateX(Math.PI / 2).translate(px0 + dx + 0.9, 0.66, (pz0 + pz1) / 2));
    for (let i = 0; i <= 14; i++) for (const dx of [-1.2, 1.2]) CM.add(pm, new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6).translate(px0 + dx + 0.9, 0.44, pz0 + (pz1 - pz0) * i / 14)); }
  const miGullT = canvasTex(64, 32, (c, w2, h2) => { c.clearRect(0, 0, w2, h2); c.strokeStyle = '#2a2430'; c.lineWidth = 3; c.beginPath(); c.moveTo(6, 22); c.quadraticCurveTo(20, 8, 32, 18); c.quadraticCurveTo(44, 8, 58, 22); c.stroke(); });
  const miGullN = 9, miGulls = [], miGullM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: miGullT, transparent: true, depthWrite: false, opacity: 0.55 }), miGullN);
  for (let i = 0; i < miGullN; i++) miGulls.push({ x: 2 + Math.random() * 18, y: 2.6 + Math.random() * 2.6, z: -7 - Math.random() * 14, v: 0.3 + Math.random() * 0.5, p: Math.random() * 7 });
  miGullM.frustumCulled = false; R.add(miGullM);
  C.add(std({ color: 0xd8d2c6, roughness: 0.7 }), dfRBox(3.4, 0.5, 0.9, 0.12).rotateY(-0.25).translate(19, 0.12, -30));
  // streamline lamp posts, all behind the fight plane: tapered pole, ribbed collar, glowing globe
  const miLampG = [];
  { const lpm = std({ color: 0xf2ece2, roughness: 0.45, metalness: 0.3 });
    for (const [x, z] of [[-6.7, -1.95], [8.9, -1.95], [-12.5, -9.2], [4.6, -7.4], [13.5, -13.5]]) {
      C.add(lpm, new THREE.CylinderGeometry(0.035, 0.07, 3.3, 12).translate(x, 1.65, z));
      C.add(lpm, new THREE.CylinderGeometry(0.1, 0.14, 0.26, 18).translate(x, 0.13, z));
      C.add(lpm, new THREE.TorusGeometry(0.105, 0.02, 6, 18).rotateX(Math.PI / 2).translate(x, 0.27, z));
      for (const dy of [3.28, 3.34]) C.add(lpm, new THREE.CylinderGeometry(0.09, 0.09, 0.03, 14).translate(x, dy, z));
      miLampG.push([x, 3.52, z]);
    } }
  const miGlobe = glow(0xffe0a8, 1.2); flags.set(miGlobe, { cast: false, recv: false });
  miLampG.forEach(p => C.add(miGlobe, new THREE.SphereGeometry(0.17, 16, 10).translate(p[0], p[1], p[2])));
  for (const p of miLampG.slice(0, 2)) sprite(R, 0xffc98a, 0.45, 0.9, p[0], p[1], p[2], true);
  // horizon haze so the real ground never shows a hard seam against the painted plate
  put(R, new THREE.PlaneGeometry(95, 6), new THREE.MeshBasicMaterial({ map: canvasTex(8, 128, (c, w2, h2) => { const gr = c.createLinearGradient(0, h2, 0, 0); gr.addColorStop(0, 'rgba(252,180,154,.34)'); gr.addColorStop(0.3, 'rgba(252,178,152,.2)'); gr.addColorStop(0.65, 'rgba(252,186,160,.05)'); gr.addColorStop(1, 'rgba(252,190,166,0)'); c.fillStyle = gr; c.fillRect(0, 0, w2, h2); }), transparent: true, depthWrite: false, fog: false, toneMapped: false }), 0, 1.2, -34);

  // every static piece that shares a material goes out as ONE mesh
  C.flush(R, flags);
  const mid = new THREE.Group(); R.add(mid); CM.flush(mid, flags); V3.decor(mid, 1);
  mid.traverse(o => { if (o.isMesh) o.castShadow = false; });   // far blocks: lit, not shadow casters

  // ---------- light ----------
  // the sun is LOW over the ocean on the right, so it rakes across the hotel: every eyebrow throws a
  // long horizontal shadow band down the facade, and the curved corner turns from lit to shade
  g.add(new THREE.HemisphereLight(0xb8cff0, 0x9a7460, 1.35));
  sunKey(g, 0xffd6a8, 3.9, [10.5, 3.0, 6.8], { left: -12, right: 12, top: 11, bottom: -3, near: 1, far: 50 });
  const miBack = new THREE.DirectionalLight(0xff8a52, 1.1); miBack.position.set(10, 1.4, -6); g.add(miBack);   // the sunset lives HERE, on the edges
  const miSkyFill = new THREE.DirectionalLight(0xb4c8f0, 0.55); miSkyFill.position.set(-4, 5, 9); g.add(miSkyFill);
  // no point lights: a forward renderer pays for every light on every lit pixel, and the emissive
  // tubes plus bloom already carry the neon (9/21 lesson: two point lights were worth ~2 ms here)

  g.userData.embers = null;
  const miGullTmp = new THREE.Matrix4(), cP = miNeonP.color.clone(), cT = miNeonT.color.clone();
  let miLast = 0;
  g.userData.tick = t => {
    const dt = Math.min(0.1, miLast ? t - miLast : 0.016); miLast = t;
    const flick = 1 + Math.sin(t * 2.1) * 0.08 + (Math.random() < 0.01 ? -0.4 : 0);
    miNeonP.color.copy(cP).multiplyScalar(flick); miNeonT.color.copy(cT).multiplyScalar(1 + Math.sin(t * 1.3 + 1) * 0.06);
    miStreakM.opacity = 0.72 + Math.sin(t * 1.7) * 0.05;
    miSurf.material.map.offset.x = (miSurf.material.map.offset.x + dt * 0.02) % 1;
    for (let i = 0; i < miGullN; i++) {
      const b = miGulls[i]; b.x -= b.v * dt; if (b.x < -4) b.x = 22;
      miGullTmp.makeTranslation(b.x, b.y + Math.sin(t * 0.8 + b.p) * 0.14, b.z); miGullM.setMatrixAt(i, miGullTmp);
    }
    miGullM.instanceMatrix.needsUpdate = true;
    if (miMove[0]) { miMove[0].position.x += dt * 3.1; if (miMove[0].position.x > 22) miMove[0].position.x = -22; }
    if (miMove[1]) { miMove[1].position.x -= dt * 2.6; if (miMove[1].position.x < -22) miMove[1].position.x = 22; }
  };
  return g;
}

// ---------- hook ----------
const STAGE_BUILDERS = { shibuya: buildShibuya, baghdad: buildBaghdad, miami: buildMiami, roof: buildRoof2, moon: buildMoon2, keep: buildKeep2, city: buildCity, ship: buildShip, street: buildStreet, arena: buildArena, swamp: buildSwamp, dojo: buildDojoNew, floor: buildFloor, train: buildTrain, peak: buildPeak, lunar: buildLunar, casino: buildCasino };
V3.buildExtra = st => { const b = STAGE_BUILDERS[st.theme]; return b ? b(st) : null; };
V3.tileMat = tileMat;   // 90's older builders (Rune Isle) use the same stage atlas
const _arenaTick0 = V3.arenaTick;
V3.arenaTick = function (t) {
  _arenaTick0(t);
  const a = V3.internals().arena();
  if (a && a.userData.tick) a.userData.tick(t);
};
} // end of stage block
