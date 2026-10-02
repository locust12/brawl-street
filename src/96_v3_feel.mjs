// ===== 3D game feel: parry / lethal / finish / burst / pump flashes, Finish Zoom camera, lethal launch trails,
// hitlag shake by axis, knockdown pose, fast-fall glint =====
// Visual only: reads Game, fighters and FEEL.ev (25_feel.js), never writes fight state, never touches the
// seeded Rng (jitter is Math.random). Hooks: wraps V3.fxFrame (after the avatars pose) and the composer's
// render (after the stock camera), both installed lazily so load order and boot timing don't matter.
const feelV = { last: 0, flash: null, flashTex: null, flashK: 0, flashC: new THREE.Color(), zoom: null, trail: null,
  tp: [], ff: new WeakMap(), knockK: new WeakMap(), crouchK: new WeakMap(), camWrapped: false, rings: [],
  lagPeak: new WeakMap(), blob: new WeakMap() };

// ---- full-screen vignette flash in front of the camera (colour per event) ----
function feelFlashTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 40, 128, 128, 182);
  gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function feelFlash(color, k) {
  feelV.flashC.set(color); feelV.flashK = Math.max(feelV.flashK, k);
}
function feelSyncFlash() {
  if (!feelV.flash) {
    feelV.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: feelFlashTex(), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    feelV.flash.renderOrder = 30; feelV.flash.frustumCulled = false; V3.scene.add(feelV.flash);
  }
  const m = feelV.flash, cam = V3.camera;
  feelV.flashK *= 0.86;
  if (feelV.flashK < 0.02) { m.visible = false; return; }
  const d = 1, h = 2 * d * Math.tan(cam.fov * Math.PI / 360);
  m.visible = true; m.material.color.copy(feelV.flashC); m.material.opacity = Math.min(1, feelV.flashK);
  m.position.copy(cam.position).add(new THREE.Vector3(0, 0, -d).applyQuaternion(cam.quaternion));
  m.quaternion.copy(cam.quaternion); m.scale.set(h * cam.aspect * 1.02, h * 1.02, 1);
}

// ---- expanding shock rings (burst / pump / KO line) ----
function feelRing(x, y, color, size, life, flat) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(x * SC, -y * SC, 0.5); if (flat) m.rotation.x = -Math.PI / 2;
  m.userData = { t: 0, life, size }; V3.scene.add(m); feelV.rings.push(m);
}
function feelSyncRings() {
  for (const m of feelV.rings) { const u = m.userData; u.t++; const k = u.t / u.life; m.scale.setScalar(Math.max(0.01, u.size * (0.15 + 0.85 * (1 - (1 - k) * (1 - k))))); m.material.opacity = Math.max(0, 1 - k); }
  feelV.rings = feelV.rings.filter(m => { if (m.userData.t < m.userData.life) return true; V3.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; });
}

// ---- lethal launch trail: hot sparks behind a fighter that was hit hard enough to die ----
const FEEL_TP = 500;
let feelTP, feelTPos, feelTCol, feelTSize;
function feelMakeTrail() {
  const g = new THREE.BufferGeometry();
  feelTPos = new Float32Array(FEEL_TP * 3); feelTCol = new Float32Array(FEEL_TP * 3); feelTSize = new Float32Array(FEEL_TP);
  g.setAttribute('position', new THREE.BufferAttribute(feelTPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(feelTCol, 3)); g.setAttribute('size', new THREE.BufferAttribute(feelTSize, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, uniforms: { scale: { value: 400 } },
    vertexShader: 'attribute float size; varying vec3 vc; uniform float scale; void main(){ vc = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vc; void main(){ vec2 d = gl_PointCoord - .5; float r = dot(d,d); if (r > .25) discard; float a = smoothstep(.25, 0., r); gl_FragColor = vec4(vc * a * 1.8, a); }',
  });
  feelTP = new THREE.Points(g, m); feelTP.frustumCulled = false; V3.scene.add(feelTP);
}
const feelCT = new THREE.Color();
function feelSyncTrail(scale) {
  if (!feelTP) feelMakeTrail();
  for (const f of Game.fighters) {
    if (f.state !== 'hitstun' || f.fLethalT == null || Game.frame - f.fLethalT > 110 || f.hitlag > 0) continue;
    for (let i = 0; i < 3; i++) feelV.tp.push({ x: f.x + (Math.random() - 0.5) * 20, y: f.y - f.h * 0.5 + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 1.5 - f.vx * 0.08, vy: (Math.random() - 0.5) * 1.5 - f.vy * 0.08,
      life: 26, max: 26, c: i === 0 ? '#ffffff' : Math.random() < 0.5 ? '#ff3b30' : '#ffb020', s: 7 + Math.random() * 9 });
  }
  if (feelV.tp.length > FEEL_TP) feelV.tp.splice(0, feelV.tp.length - FEEL_TP);
  let n = 0;
  for (const p of feelV.tp) {
    p.x += p.vx; p.y += p.vy; p.life--;
    const k = p.life / p.max;
    feelTPos[n * 3] = p.x * SC; feelTPos[n * 3 + 1] = -p.y * SC; feelTPos[n * 3 + 2] = 0.45;
    feelCT.set(p.c); feelTCol[n * 3] = feelCT.r * k; feelTCol[n * 3 + 1] = feelCT.g * k; feelTCol[n * 3 + 2] = feelCT.b * k;
    feelTSize[n] = p.s * (0.4 + k) * SC * 1.6; n++;
  }
  feelV.tp = feelV.tp.filter(p => p.life > 0);
  for (let i = n; i < FEEL_TP; i++) feelTSize[i] = 0;
  const g = feelTP.geometry; for (const a of ['position', 'color', 'size']) g.attributes[a].needsUpdate = true;
  g.setDrawRange(0, n); feelTP.material.uniforms.scale.value = scale;
}

// ---- contact shadow: the tight dark blob directly under a fighter ----
// The stage's directional shadow grounds a fighter softly and from an angle; Smash puts a second,
// tight, high-contrast blob straight under the feet, which is what actually reads at a glance and
// what tells you where you are about to land. It finds the real surface below (main floor or any
// soft platform the fighter is over), then fades and spreads with height, so it doubles as an
// altimeter while you are in the air. Visual only. V3.noContactShadow = off.
// Every blob is added to V3.scene, which holds a STRONG reference, while feelV.blob is a WeakMap
// keyed by fighter. So when a match ends and new Fighter objects are made, the map entry goes but the
// MESH stays in the scene forever, frozen at its last position and opacity. Measured mid-match on
// 9/27: four blobs in the scene for two fighters, two of them stale leftovers at full strength.
// This set is the hard reference the sweep needs.
const ALL_BLOBS = new Set();
let blobTex = null;
function contactTex() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  // A HARDER CORE, 9/27. The old ramp (0.85 -> 0.45 at 45% -> 0 at the rim) spent most of its radius
  // almost transparent, so at the size a fighter's blob is actually drawn it read as a faint smudge
  // and the fighters looked pasted onto the floor. Measured on a 1920x1080 frame: nothing legible
  // under either fighter. A grounding shadow has to have an opaque middle -- Smash's does.
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.98)'); gr.addColorStop(0.34, 'rgba(0,0,0,0.88)');
  gr.addColorStop(0.62, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c); blobTex.userData.shared = true;
  return blobTex;
}
// 90_v3_core's prop grounding reuses this exact texture rather than making a second one: one canvas,
// one upload, and the props and the fighters then read as the same kind of shadow.
V3.contactTex = contactTex;

function groundUnder(f) {
  // sim y grows DOWNWARD, so a surface is "below" the fighter when its y is >= the fighter's, and the
  // NEAREST one below is the smallest such y -- the soft platform you are about to land on, not the
  // main floor two screens under it.
  const st = Game.stage; if (!st || !st.main) return null;
  let best = null;
  const m = st.main;
  if (f.x >= m.x0 && f.x <= m.x1 && f.y <= m.top + 1) best = m.top;
  for (const p of st.plats || []) {
    if (f.x < p.x0 || f.x > p.x1) continue;
    if (f.y > p.y + 1) continue;                       // we are under it: not our floor
    if (best === null || p.y < best) best = p.y;
  }
  return best;
}
function feelContact(f, a) {
  if (V3.noContactShadow) return;
  let s = feelV.blob.get(f);
  const gy = groundUnder(f);
  if (gy === null) { if (s) s.visible = false; return; }
  if (!s) {
    // polygonOffset, not a bigger lift: the blob sits a hair above a surface it is coplanar with, and
    // at 0.002 world units that is inside depth precision -- the floor was depth-rejecting most of it.
    // Offsetting in depth space keeps the blob visually ON the floor at every camera distance instead
    // of floating when the camera pulls back for a Finish Zoom.
    s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: contactTex(), transparent: true, depthWrite: false, opacity: 0.5, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    s.rotation.x = -Math.PI / 2; s.renderOrder = 2; V3.scene.add(s); feelV.blob.set(f, s); ALL_BLOBS.add(s);
  }
  const h = Math.max(0, gy - f.y);                     // px above that surface
  const k = Math.max(0, 1 - h / 260);                  // gone by ~2.5 fighter heights up
  if (k <= 0.02 || f.state === 'dead') { s.visible = false; return; }
  // Wider than the fighter, and it fades with height on a gentler curve. k*k dropped the blob to a
  // quarter strength at half a fighter-height up, which is exactly the range you spend most of a
  // match in, so the altimeter it is meant to be was invisible for most of the jump.
  const w = (f.c.w || 56) * SC * (1.45 + (1 - k) * 1.25);
  s.visible = true;
  s.position.set(f.x * SC, -gy * SC + 0.014, 0.02);
  s.scale.set(w, w * 0.5, 1);
  s.material.opacity = 0.9 * Math.pow(k, 1.45);
}

// ---- PHASE 5: hitbox / hurtbox debug view ----
// Press B in a match, or load with #hitboxes, to see exactly what the sim is testing: every ACTIVE
// hitbox as a green wireframe sphere at its real radius, and every fighter's hurtbox as a red box at
// its real width and height. This is the only way to check the claim that the visuals reach where the
// hitbox is -- the model is drawn 1.32x taller than its hurtbox, so the two genuinely differ.
// Meshes are pooled and hidden when unused: the view costs nothing while it is off.
const DBG = { on: false, hit: [], hurt: [], hitGeo: null, hurtGeo: null };
try { if (/(^|[#:&])hitboxes/.test(location.hash)) DBG.on = true; } catch (e) {}
// training mode (8g_training) is a plain global-scope file and cannot see this module's bindings,
// so the toggle is published rather than duplicated -- one debug view, two ways in.
V3.hitboxes = v => { DBG.on = v === undefined ? !DBG.on : !!v;
  if (!DBG.on) { for (const m of DBG.hit) m.visible = false; for (const m of DBG.hurt) m.visible = false; }
  return DBG.on; };
// a PURE read. Without it the only way to ask the state was to call the toggle, which changes it --
// a probe that "checked" the flag twice per assertion was flipping it under itself and reported
// nonsense until I noticed the reader was the thing moving.
V3.hitboxesOn = () => DBG.on;
try {
  addEventListener('keydown', e => {
    // B, NOT H. H is player 1's SHIELD (10_core KEYMAPS kb1.shield = ['KeyH']), so binding the debug
    // view to it meant the hitbox wireframes flickered on and off every time anyone put their guard up
    // -- in every match, for every player, shipped. Checked the whole of GAME_KEYS before choosing:
    // B, X and Z are the only sensible letters no control uses (C is taken by Clip It, 81_clip).
    if (e.key !== 'b' && e.key !== 'B') return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    DBG.on = !DBG.on;
    if (!DBG.on) { for (const m of DBG.hit) m.visible = false; for (const m of DBG.hurt) m.visible = false; }
  });
} catch (e) {}
function dbgSphere(i) {
  if (!DBG.hitGeo) DBG.hitGeo = new THREE.SphereGeometry(1, 14, 8);
  let m = DBG.hit[i];
  if (!m) { m = new THREE.Mesh(DBG.hitGeo, new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.55, depthTest: false, fog: false }));
    m.renderOrder = 998; V3.scene.add(m); DBG.hit[i] = m; }
  return m;
}
function dbgBox(i) {
  if (!DBG.hurtGeo) DBG.hurtGeo = new THREE.BoxGeometry(1, 1, 1);
  let m = DBG.hurt[i];
  if (!m) { m = new THREE.Mesh(DBG.hurtGeo, new THREE.MeshBasicMaterial({ color: 0xff3b6a, wireframe: true, transparent: true, opacity: 0.5, depthTest: false, fog: false }));
    m.renderOrder = 997; V3.scene.add(m); DBG.hurt[i] = m; }
  return m;
}
function feelDebugBoxes() {
  if (!DBG.on) return;
  let hi = 0, ui = 0;
  for (const f of Game.fighters) {
    if (f.state === 'dead') continue;
    const b = dbgBox(ui++);
    b.visible = true;
    b.position.set(f.x * SC, -(f.y - f.h * 0.5) * SC, 0.3);
    b.scale.set(f.w * SC, f.h * SC, f.w * SC);
    if (f.state !== 'move' || !f.activeHits) continue;
    let hits = [];
    try { hits = f.activeHits() || []; } catch (e) { hits = []; }
    for (const h of hits) {
      const m = dbgSphere(hi++);
      m.visible = true;
      m.position.set(h.x * SC, -h.y * SC, 0.32);
      m.scale.setScalar(Math.max(0.01, h.r * SC));
    }
  }
  for (let i = hi; i < DBG.hit.length; i++) DBG.hit[i].visible = false;
  for (let i = ui; i < DBG.hurt.length; i++) DBG.hurt[i].visible = false;
}

// ---- per-avatar touches: hitlag shake along the launch axis, knockdown pose, fast-fall glint ----
function feelAvatars() {
  const av = V3._avatars; if (!av) return;
  // hide any blob that no fighter on the stage owns any more (see ALL_BLOBS)
  if (ALL_BLOBS.size) {
    const live = new Set();
    for (const f of Game.fighters) { const b = feelV.blob.get(f); if (b) live.add(b); }
    for (const b of ALL_BLOBS) if (!live.has(b)) b.visible = false;
  }
  for (const f of Game.fighters) {
    const a = av.get(f); if (!a || !a.root) continue;
    try { feelContact(f, a); } catch (e) { V3.fxErr(e, '96 contact'); }
    if (f.state === 'dead') continue;
    // Sakurai's hitstop shake, from his Famitsu column (vol. 490) and the "Eight Hit Stop Techniques"
    // episode. We already did two of the eight: shake the VICTIM, and grounded sideways / airborne up
    // and down. The other three that are ours to do:
    //   * the ATTACKER shakes too, but only a little ("normally only the character that takes damage
    //     vibrates, but in Smash the attacker also vibrates slightly")
    //   * the amplitude STARTS LARGE AND CONVERGES ("the distance is not set, starting out large and
    //     growing much smaller by the end... by calculating the freeze frames beforehand and dividing")
    //   * it SCALES WITH CAMERA DISTANCE ("when the camera is far away the characters are actually
    //     vibrating quite a lot, but you might not be able to tell so easily")
    // The hurtbox never moves: this is the renderer, and the sim never sees it.
    if (f.hitlag > 0) {
      const victim = f.state === 'hitstun' || f.state === 'grabbed';
      let peak = feelV.lagPeak.get(f) || 0;
      if (f.hitlag >= peak) { peak = f.hitlag; feelV.lagPeak.set(f, peak); }
      const decay = peak > 1 ? f.hitlag / peak : 1;              // 1 on the frame of contact, ~0 at the end
      const far = Math.max(0.85, Math.min(2.2, (V3.camera ? V3.camera.position.z : 12) / 11));
      const amp = Math.min(0.075, 0.0032 * peak) * decay * far * (victim ? 1 : 0.3)
        * (Math.random() < 0.5 ? -1 : 1);
      if (f.air) a.root.position.y += amp; else a.root.position.x += amp;
    } else if (feelV.lagPeak.has(f)) feelV.lagPeak.delete(f);
    // duck: squash the fighter so holding Down reads as a crouch (the hurtbox drops to 60%, 25_feel)
    let ck = feelV.crouchK.get(f) || 0;
    ck += ((f.crouch && !f.air ? 1 : 0) - ck) * 0.4; feelV.crouchK.set(f, ck);
    if (ck > 0.01) { const sy = 1 - 0.34 * ck, sx = 1 + 0.16 * ck; a.root.scale.set(a.root.scale.x * sx, a.root.scale.y * sy, a.root.scale.z * sx); }
    let k = feelV.knockK.get(f) || 0;
    k += ((f.fKnock ? 1 : 0) - k) * 0.35; feelV.knockK.set(f, k);
    if (k > 0.01) { a.root.rotation.z = -f.face * 1.4 * k; a.root.position.y += 0.06 * k; }
    const was = feelV.ff.get(f);
    if (f.fastFall && !was && f.air && typeof burstAt === 'function') burstAt(f.x, f.y - 6, 0.35, '#e8f6ff');
    feelV.ff.set(f, !!f.fastFall);
  }
}

// ---- events from the fight (25_feel FEEL.ev) ----
function feelEvents() {
  if (typeof FEEL === 'undefined') return;
  for (const e of FEEL.ev) {
    if (e.id <= feelV.last) continue;
    feelV.last = e.id;
    const star = (s, c) => { if (typeof burstAt === 'function') burstAt(e.x, e.y, s, c); };
    switch (e.k) {
      case 'parry': star(1.4, '#9ff4ff'); feelRing(e.x, e.y, '#7ff0ff', 1.5, 18); feelFlash('#3ad8ff', 0.55); break;
      case 'tech': star(0.6, '#dff6ff'); feelRing(e.x, e.y - 4, '#9fe8ff', 0.9, 14, true); break;
      case 'clean': star(0.4, '#bff4ff'); break;
      case 'counter': star(1.1, '#ffb050'); break;
      case 'lethal': feelRing(e.x, e.y, '#ff5a3a', 1.6, 16); feelFlash('#ff2a1a', 0.45);   // the stock impact burst (93) already fires feelV.zoom = { f: e.f, t0: performance.now(), dur: 520, k: 0.14 }; break;
      case 'finish': feelRing(e.x, e.y, '#ff3a2a', 2.4, 24); feelFlash('#ff1a10', 0.75); feelV.zoom = { f: e.f, t0: performance.now(), dur: 1500, k: 0.5 }; break;
      case 'burst': star(2.2, '#ffffff'); feelRing(e.x, e.y, '#ffffff', 3.2, 22); feelRing(e.x, e.y, e.c || '#ffffff', 2.2, 28); feelFlash('#ffffff', 0.5); break;
      case 'pump': star(2.6, '#ffe27a'); feelRing(e.x, e.y, '#ffd23f', 3.4, 30); feelRing(e.x, e.y, '#7dff8a', 2, 24); feelRing(e.x, e.y + 40, '#ffd23f', 2.6, 26, true); feelFlash('#ffb020', 0.6); break;
      case 'meter': if (e.f) feelRing(e.f.x, e.f.y - e.f.h * 0.5, e.lvl === 2 ? '#ffd23f' : '#9fe8ff', 1.1, 16); break;
      case 'ko': feelRing(e.x, e.y, e.c || '#ffffff', 4, 26); feelFlash(e.c || '#ffffff', e.last ? 0.6 : 0.35); break;
    }
  }
}

// ---- Finish Zoom / lethal punch-in: runs after the stock camera, just before the frame is rendered ----
function feelCamera() {
  const z = feelV.zoom; if (!z || !z.f) return;
  const e = (performance.now() - z.t0) / z.dur;
  if (e >= 1) { feelV.zoom = null; return; }
  const f = z.f, cam = V3.camera;
  const k = z.k * (e < 0.12 ? e / 0.12 : e > 0.7 ? (1 - e) / 0.3 : 1);
  const tx = f.x * SC, ty = -(f.y - f.h * 0.55) * SC;
  const want = new THREE.Vector3(tx, ty + 0.25, Math.max(3.2, cam.position.z * (1 - k * 0.9)));
  cam.position.lerp(want, Math.min(1, k * 1.6));
  const look = new THREE.Vector3(tx, ty, 0);
  const cur = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(cam.position.z).add(cam.position);
  cam.lookAt(cur.lerp(look, Math.min(1, k * 1.8)));
}
function feelWrapCamera() {
  if (feelV.camWrapped) return;
  const I = V3.internals && V3.internals(), comp = I && I.composer;
  if (!comp || !comp.render) return;
  const base = comp.render.bind(comp);
  comp.render = function (dt) { try { feelCamera(); feelSyncFlash(); } catch (e) { V3.fxErr(e, '96_v3_feel:145'); /* never break the frame */ } return base(dt); };
  feelV.camWrapped = true;
}

// ---- frame hook ----
(function () {
  const base = V3.fxFrame;
  if (typeof base !== 'function') return;
  V3.fxFrame = function (pointScale) {
    base.call(this, pointScale);
    try {
      // 9/23: this whole module used to early-out unless `Game.feel` was on -- and Game.feel is FALSE
      // in every normal match (it is the 25_feel local-rules flag, which nothing turns on by default).
      // So the hitlag shake, the crouch squash, the knockdown pose, the fast-fall glint and the contact
      // shadow were all dead in normal play and had only ever been verified with the flag forced on.
      // The per-avatar touches are a loop over at most four fighters and the module is visual-only
      // (it never writes fight state and never touches the seeded Rng), so they now always run. The
      // heavier trail/ring passes keep the original early-out.
      feelWrapCamera(); feelAvatars(); feelDebugBoxes();
      if (!Game.feel && !feelV.tp.length && !feelV.rings.length) return;
      feelEvents(); feelSyncTrail(pointScale); feelSyncRings();
    } catch (e) { V3.fxErr(e, '96_v3_feel:158'); /* visual layer never breaks the frame */ }
  };
})();
