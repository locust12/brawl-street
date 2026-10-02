// ===== 3D: items on stage, held weapons, slash trails, Final Smash beam, power aura =====
// Prop models are normalised so the grip sits at the origin and the business end points along +Y.
const PROP_SPEC = {
  hammer:  { file: 'hammer',  axis: [0, 0, -1], grip: [0, 0, 0.42], len: 0.85, lay: true },
  raygun:  { file: 'raygun',  axis: [0, 0, 1],  grip: [0, -0.26, -0.12], len: 0.5, lay: true },
  bomb:    { file: 'bomb',    axis: [0, 1, 0],  grip: [0, 0, 0], len: 0.26 },
  grenade: { file: 'grenade', axis: [0, 1, 0],  grip: [0, 0, 0], len: 0.2 },
  // the Hero Sword GLB is modelled point-DOWN: its +Y end is the winged crossguard, which is why the
  // fighters kept holding it by the blade. -Y is the business end (9/20, verified in dev/anim/*sword*).
  blade:   { file: 'blade',   axis: [0, -1, 0], grip: [0, 0.34, 0], len: 1.05, lay: true },
};
const propModels = {};
V3.loadProps = async function (loader, texLoader) {
  // one dropped request used to leave that weapon as its procedural stand-in for the whole match
  const tries = async (fn, n = 3) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await new Promise(r => setTimeout(r, 350 * (i + 1))); } } };
  await Promise.all(Object.values(PROP_SPEC).map(async sp => {
    try {
      const g = await tries(() => loader.loadAsync('assets/item_' + sp.file + '_glb.wasm'));
      const tex = await tries(() => texLoader.loadAsync('assets/item_' + sp.file + '_tex.jpg'));
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
      // cached and cloned into every held prop: keep it out of V3.disposeArena's way (90_v3_core)
      tex.userData.shared = true;
      g.scene.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.15 }); o.castShadow = true; o.material.userData.shared = true; o.geometry.userData.shared = true; } });
      const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3());
      propModels[sp.file] = { scene: g.scene, size: Math.max(size.x, size.y, size.z) };
    } catch (e) { V3.fxErr(e, '92_v3_items:26'); /* a missing prop falls back to a procedural stand-in */ }
  }));
};

const glowMat = (hex, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
function heartShape() {
  const s = new THREE.Shape(); s.moveTo(0, -0.5); s.bezierCurveTo(-0.9, -0.1, -0.7, 0.6, 0, 0.25); s.bezierCurveTo(0.7, 0.6, 0.9, -0.1, 0, -0.5);
  return new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 4 });
}
// Every prop instance used to rebuild all of its own geometry -- 117 geometry constructors across this
// file and 94_v3_moves, run again for the second bomb, the third crate, every time. Spawning items
// mid-fight cost a 43 ms frame with +22 geometries allocated (measured, scratchpad/perfprobe).
// Now each KIND is built once and cloned: Object3D.clone() shares geometry AND materials, so the
// second one of anything is a handful of Object3D allocations and nothing on the GPU.
// V3.noPropCache = build every prop from scratch (A/B).
const propCache = {};
let ringGeo = null;   // one ring geometry for every item on the stage, not one each
function makeProp(kind) {
  if (!V3.noPropCache) {
    const tpl = propCache[kind];
    if (tpl) {
      const c = tpl.clone(true);
      // the clone needs its OWN blade meshes, not the template's, or every Beam Sword in the match
      // grows the same one
      if (tpl.userData.blade) {
        const parts = [];
        c.traverse(o => { if (o.userData && o.userData.bladePart) parts.push(o); });
        c.userData = Object.assign({}, tpl.userData, { blade: Object.assign({}, tpl.userData.blade, { parts }), bladeK: 1 });
      } else c.userData = Object.assign({}, tpl.userData);
      V3.scene.add(c);
      return c;
    }
  }
  const built = makeProp0(kind);
  if (!V3.noPropCache) { propCache[kind] = built; }
  return built;
}
function makeProp0(kind) {
  const outer = new THREE.Group(), inner = new THREE.Group(); outer.add(inner);
  const sp = PROP_SPEC[kind];
  if (sp && propModels[sp.file]) {
    const m = propModels[sp.file], mesh = m.scene.clone(true), s = sp.len / m.size;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...sp.axis).normalize(), new THREE.Vector3(0, 1, 0));
    mesh.quaternion.copy(q); mesh.scale.setScalar(s);
    mesh.position.copy(new THREE.Vector3(...sp.grip).applyQuaternion(q).multiplyScalar(-s));
    inner.add(mesh);
    // Hold a long weapon by its BUTT, whatever the GLB's own axis and origin turn out to be: point the
    // long end up, then drop the model so its low end sits just under the hand. The per-model `grip`
    // constant above kept getting this wrong and the fighters held the sword by the blade (9/20, four
    // reports); this measures the model instead of trusting a number.
    if (sp.len >= 0.4) {
      const bb = new THREE.Box3().setFromObject(inner);
      if (bb.max.y < -bb.min.y) { inner.rotateZ(Math.PI); bb.setFromObject(inner); }   // came out upside down
      inner.position.y -= bb.min.y + sp.len * 0.08;
    }
  } else if (kind === 'beam' || kind === 'blade') {
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.9, roughness: 0.3 }));
    hilt.position.y = 0.02; inner.add(hilt);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), new THREE.MeshStandardMaterial({ color: 0xc0c0c8, metalness: 1, roughness: 0.25 })); guard.position.y = 0.13; inner.add(guard);
    const col = kind === 'beam' ? '#ff3a6e' : '#5ab8ff', L = kind === 'beam' ? 0.72 : 0.9;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, L, 10), glowMat(col, 1.5)); core.position.y = 0.14 + L / 2; inner.add(core);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, L + 0.04, 14), glowMat(col, 0.7)); glow.material.opacity = 0.5; glow.position.y = core.position.y; inner.add(glow);
    // the Beam Sword's signature, straight out of Smash: "when doing a side smash attack, the beam
    // sword's blade grows to three times its normal length". The blade parts are tagged here so the
    // held-prop pass can grow them from the hilt with the smash charge.
    core.userData.bladePart = true; glow.userData.bladePart = true;
    outer.userData.blade = { parts: [core, glow], L, base: 0.14 };
  } else if (kind === 'heart') {
    const h = new THREE.Mesh(heartShape(), new THREE.MeshStandardMaterial({ color: 0xff4f9e, emissive: 0xff2a7a, emissiveIntensity: 0.9, roughness: 0.3 }));
    h.scale.setScalar(0.28); h.position.set(0, 0.12, -0.04); inner.add(h);
  } else if (kind === 'pill') {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.12, 8, 16), new THREE.MeshStandardMaterial({ color: 0x3bd46a, roughness: 0.25, emissive: 0x1a8a3a, emissiveIntensity: 0.6 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.072, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }));
    a.position.y = 0.12; cap.position.y = 0.18; inner.add(a, cap); inner.rotation.z = 0.5; inner.scale.setScalar(0.6);
  } else if (kind === 'moonball') {
    // the rim term is clamped: pow() of a hair-negative base (|n.z| rounding past 1 facing the camera) returned NaN, and
    // one NaN pixel through the bloom blur was a black rectangle over half the screen whenever a Moon Ball spawned
    const m = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec3 n; varying vec3 p; void main(){ n = normalize(normalMatrix*normal); p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float t; varying vec3 n; varying vec3 p; vec3 hsv(float h){ return clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); } void main(){ float f = pow(max(0., 1.-abs(n.z)), 1.6); vec3 c = hsv(fract(p.y*1.5 + t*.3)) * (1.4 + f*2.2) + vec3(1.2)*smoothstep(.55,.95,1.-f); gl_FragColor = vec4(c, 1.); }',
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 20), m); inner.add(ball); outer.userData.shader = m;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), glowMat('#ffe27a', 0.9)); halo.material.opacity = 0.35; inner.add(halo);
  } else if (V3.makeProp2 && V3.makeProp2(kind, inner, outer)) {
    // item set 2 props (procedural, 94_v3_moves.mjs)
  } else {
    inner.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0xcccccc })));
  }
  outer.traverse(o => { if (o.isMesh) o.castShadow = true; });
  V3.scene.add(outer);
  return outer;
}

// ---- stage items ----
const itemMeshes = new Map(), itemRings = new Map(), itemMarks = new Map();
V3._itemMeshes = itemMeshes;   // dev inspection only (dev/anim_probe itemsize)

// ---- the floating item marker (Smash's triangle) ----
// Colour-coded by what the item DOES, so the shape tells you where it is and the colour tells you
// whether it is worth running for: a weapon, a gun, a bomb, or healing.
const MARK_COL = { melee: '#ffe27a', shoot: '#8fd2ff', boom: '#ff7a5a', heal: '#7dfba0', other: '#ffffff' };
function markKind(kind) {
  const d = ITEM_DEFS[kind] || {};
  if (d.sword || kind === 'hammer' || kind === 'pan' || kind === 'blade' || kind === 'beam') return 'melee';
  if (d.ammo) return 'shoot';
  if (d.boom || d.fuse || d.impact) return 'boom';
  if (d.instant) return 'heal';
  return 'other';
}
let markGeo = null;
function makeMark(kind) {
  if (!markGeo) {
    // a flat down-pointing triangle, built once and shared
    const s = new THREE.Shape(); s.moveTo(-0.105, 0.105); s.lineTo(0.105, 0.105); s.lineTo(0, -0.095); s.closePath();
    markGeo = new THREE.ShapeGeometry(s);
  }
  const col = MARK_COL[markKind(kind)] || '#ffffff';
  const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
  m.renderOrder = 900;
  V3.scene.add(m);
  return m;
}
function syncMark(it, want, blink) {
  let k = itemMarks.get(it);
  if (!want) { if (k) { V3.scene.remove(k); itemMarks.delete(it); } return; }
  if (!k) { k = makeMark(it.kind); itemMarks.set(it, k); }
  const bob = Math.sin(it.age * 0.09) * 0.035;
  k.position.set(it.x * SC, -it.y * SC + 0.34 + bob, 0.16);
  k.material.opacity = blink ? 0.25 : 0.95;
}
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function syncItems() {
  const live = new Set(Game.items);
  for (const [it, m] of itemMeshes) if (!live.has(it)) { V3.scene.remove(m); itemMeshes.delete(it); const r = itemRings.get(it); if (r) { V3.scene.remove(r); itemRings.delete(it); } const k = itemMarks.get(it); if (k) { V3.scene.remove(k); itemMarks.delete(it); } }
  for (const it of Game.items) {
    let m = itemMeshes.get(it); if (!m) { m = makeProp(it.kind); itemMeshes.set(it, m); }
    const sp = PROP_SPEC[it.kind], lay = (sp && sp.lay) || it.kind === 'beam';
    const moving = Math.abs(it.vx) + Math.abs(it.vy) > 1;
    const bob = !moving && !it.armed ? 0.06 + Math.sin(it.age * 0.06) * 0.03 : 0.05;
    m.position.set(it.x * SC, -it.y * SC + bob, 0.15);
    if (moving && it.armed) { m.rotation.set(0, 0, -it.age * 0.35 * Math.sign(it.vx || 1)); }
    else {
      qa.setFromAxisAngle(Y, it.age * 0.035); qb.setFromAxisAngle(new THREE.Vector3(0, 0, 1), lay ? -Math.PI / 2 : 0);
      m.quaternion.copy(qa).multiply(qb);
      if (lay) m.position.x -= 0.0;
    }
    if (m.userData.shader) m.userData.shader.uniforms.t.value = performance.now() / 1000;
    // pulsing ring under items you can grab, and the marker above them
    let ring = itemRings.get(it);
    const grabbable = !it.armed && ITEM_DEFS[it.kind] && !ITEM_DEFS[it.kind].floating;
    const dying = it.age > 980;
    const blink = dying && Math.floor(it.age / 5) % 2;
    if (grabbable) {
      if (!ring) { if (!ringGeo) ringGeo = new THREE.RingGeometry(0.16, 0.2, 32); ring = new THREE.Mesh(ringGeo, glowMat('#ffffff', 1.4)); ring.rotation.x = -Math.PI / 2; V3.scene.add(ring); itemRings.set(it, ring); }
      ring.position.set(it.x * SC, -it.y * SC + 0.01, 0.15); const k = 1 + Math.sin(it.age * 0.1) * 0.15; ring.scale.setScalar(k);
      ring.material.opacity = dying ? (blink ? 0.2 : 0.9) : 0.8;
    } else if (ring) { V3.scene.remove(ring); itemRings.delete(it); }
    // Smash's flagship item-readability device: a small marker floating over every item. It shipped in
    // SSB64, was dropped in Melee, and was deliberately reinstated in Smash 4 and kept in Ultimate --
    // in a scramble the ring on the floor is hidden behind whoever is standing on it. Same exception
    // Nintendo makes: the things you are meant to scramble blindly for (a floating prize) get none.
    syncMark(it, grabbable && !V3.noItemMark, blink);
    // "it will eventually disappear, flashing briefly beforehand" -- the ITEM flashes, not just the
    // ring under it, so a weapon about to vanish is obvious while you are running at it
    m.visible = !blink;
  }
}

// ---- held items, trails, auras (called per avatar) ----
const hand = new THREE.Vector3(), fore = new THREE.Vector3(), dir = new THREE.Vector3(), tip = new THREE.Vector3();
// the akimbo off hand (6h_akimbo.js) gets its own scratch vectors rather than sharing the right
// hand's: the right-hand block is still using them when the left one runs.
const hand2 = new THREE.Vector3(), fore2 = new THREE.Vector3(), dir2 = new THREE.Vector3();
const TRAIL_N = 16;
function makeTrail() {
  const pos = new Float32Array(TRAIL_N * 2 * 3), col = new Float32Array(TRAIL_N * 2 * 3), idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.frustumCulled = false; V3.scene.add(m);
  return { mesh: m, pts: [], color: new THREE.Color() };
}
function updateTrail(tr, active, p, hex, width) {
  // The ribbon used to keep stale samples: when a strike ended it dropped ONE point a frame, and a new
  // strike (or a weapon-tip flip, or a launch) joined the old samples to the new position, so it
  // stretched into a pink/white arc across a third of the screen (audit 9/22, evidence 03/04). Now it
  // clears the moment the strike ends and restarts whenever the tip jumps further than a swing can move.
  if (active) {
    if (tr.pts.length && tr.pts[0].distanceTo(p) > 0.6) tr.pts.length = 0;
    tr.pts.unshift(p.clone()); if (tr.pts.length > TRAIL_N) tr.pts.pop(); tr.color.set(hex); tr.width = width;
  } else if (tr.pts.length) tr.pts.length = tr.pts.length > 3 ? tr.pts.length >> 1 : 0;   // gone in ~3 frames
  const pos = tr.mesh.geometry.attributes.position.array, col = tr.mesh.geometry.attributes.color.array, n = tr.pts.length;
  for (let i = 0; i < TRAIL_N; i++) {
    const a = tr.pts[Math.min(i, n - 1)] || p, b = tr.pts[Math.min(i + 1, n - 1)] || a, c = tr.pts[Math.max(i - 1, 0)] || a;
    let dx = c.x - b.x, dy = c.y - b.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const k = n ? Math.max(0, 1 - i / n) : 0, w = (tr.width || 0.08) * k;
    pos[i * 6] = a.x - dy * w; pos[i * 6 + 1] = a.y + dx * w; pos[i * 6 + 2] = a.z + 0.2;
    pos[i * 6 + 3] = a.x + dy * w; pos[i * 6 + 4] = a.y - dx * w; pos[i * 6 + 5] = a.z + 0.2;
    const br = k * k * 0.95;
    for (const o of [0, 3]) { col[i * 6 + o] = tr.color.r * br; col[i * 6 + o + 1] = tr.color.g * br; col[i * 6 + o + 2] = tr.color.b * br; }
  }
  tr.mesh.geometry.attributes.position.needsUpdate = true; tr.mesh.geometry.attributes.color.needsUpdate = true;
  tr.mesh.visible = n > 1;
}
const FOOT_CLIPS = new Set(['kick', 'sweep', 'flykick']);
// ---- where a long weapon points ----
// The forearm's own axis is the obvious answer and it is wrong half the time: the melee clips are shared
// across the roster (fsmash plays `kick`, nair plays `flykick`) and in those the sword arm is tucked, so
// following it aimed the blade DOWN AND BACKWARD THROUGH THE BODY on every attack. Measured with
// `dev/anim_probe.js` scene grip4 / grip8: "*** TIP IN HAND ***", both facings. That is the fifth report
// of "they hold it by the sharp end" waiting to happen, and it is the ATTACK that does it, not the carry.
//
// So a swung weapon is aimed at the hitbox the move is about to put out, swept through the window:
// raised behind on the way in, on the target at contact, followed through after. Anything without a live
// hitbox holds the readable carry pose instead.
const LONG_PROP = new Set(['blade', 'beam', 'hammer']);
const swingV = new THREE.Vector3(), swingQ = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);
function swingDir(f, hand) {
  const mv = f.move, d = mv && mv.def;
  if (f.state !== 'move' || !d || !d.hits) return null;
  const hb = d.hits.find(h => !h.grab && h.f);
  if (!hb) return null;
  const w0 = hb.f[0] - 5, w1 = hb.f[1] + 5;
  if (mv.t < w0 || mv.t > w1) return null;
  // at the hitbox the fight actually tests (activeHits: Game.reach x BAL x IDENT), via the strike pose;
  // the raw def offset left the blade 30-56 % short of the real hitbox (audit A5)
  const T = V3.strikeTarget && V3.strikeTarget(f);
  const hx = T ? T.x : (f.x + f.face * (hb.x || 0) * (Game.reach || 1)) * SC, hy = T ? T.y : -(f.y + (hb.y || 0)) * SC;
  swingV.set(hx - hand.x, hy - hand.y, 0);
  if (swingV.lengthSq() < 1e-6) return null;
  swingV.normalize();
  const k = (mv.t - w0) / Math.max(1, w1 - w0);
  swingQ.setFromAxisAngle(ZAX, (0.5 - k) * 1.45 * f.face);   // wind up behind -> through the target -> follow through
  return swingV.applyQuaternion(swingQ).normalize();
}
// and nothing swung on the ground sinks into the deck: the hammer windmill used to bury its head 0.2
// world units under the floor at the bottom of every revolution (scene ham6)
function floorClamp(f, hand, len) {
  if (f.air) return;
  const need = (-f.y * SC + 0.03 - hand.y) / Math.max(0.01, len);
  if (dir.y >= need || need >= 0.999) return;
  const sx = Math.abs(dir.x) > 1e-3 ? Math.sign(dir.x) : f.face;
  dir.set(sx * Math.sqrt(Math.max(0, 1 - need * need)), need, 0).normalize();
}
V3.decorate = function (av) {
  const f = av.f;
  if (!av.bones) {
    av.bones = {}; av.model.traverse(o => { if (o.isBone) av.bones[o.name] = o; });
    av.trail = makeTrail(); av.held = {};
    av.aura = new THREE.PointLight(0xffd23f, 0, 3, 2); V3.scene.add(av.aura);
  }
  // procedural poses over the clip (crouch, hammer windmill, gun aim: 97_v3_pose.mjs), before anything
  // reads a bone position, so the held prop and the trail follow the posed arm
  if (V3.poseFrame) V3.poseFrame(av);
  const B = av.bones, dead = f.state === 'dead';
  // which item is in hand this frame
  const kind = dead ? null : f.state === 'hammer' ? 'hammer' : f.item ? f.item.kind : null;
  // AKIMBO (6h_akimbo.js): a second gun of the same kind, in the LEFT hand. It is its own entry in
  // av.held under '<kind>#L' so the map stays one-mesh-per-key and nothing else in here has to know.
  const dualKey = (kind && f.item && f.item.dual) ? kind + '#L' : null;
  // a held prop is its own scene object: hide it with the fighter (teleport frames, swallowed; audit A13)
  for (const [k, m] of Object.entries(av.held)) m.visible = (k === kind || k === dualKey) && av.root.visible;
  let swordTip = null;
  if (kind && B.RightHand && B.RightForeArm) {
    let m = av.held[kind]; if (!m) { m = av.held[kind] = makeProp(kind); }
    B.RightHand.getWorldPosition(hand); B.RightForeArm.getWorldPosition(fore);
    dir.subVectors(hand, fore).normalize();
    // How the weapon is HELD. Following the forearm makes long weapons point backwards through the body in
    // half the poses, so at rest they sit in a readable carry pose (blade up and forward, hammer on the
    // shoulder) and only follow the arm while the swing is live.
    const carry = { blade: [0.5, 0.87], beam: [0.5, 0.87], hammer: [0.3, 0.95], raygun: [0.85, 0.2] }[kind];
    const aim = V3.aimCarry && V3.aimCarry(f, kind);   // a gun being aimed lies along the shot (97_v3_pose)
    const sp0 = PROP_SPEC[kind], L0 = kind === 'beam' ? 0.86 : kind === 'blade' ? 1.0 : sp0 ? sp0.len : 0.3;
    if (aim) dir.set(aim[0], aim[1], 0).normalize();
    else if (LONG_PROP.has(kind)) {
      const sw = f.state === 'hammer' ? null : swingDir(f, hand);   // the item hammer keeps its windmill
      if (sw) dir.copy(sw);
      else if (carry) dir.set(f.face * carry[0], carry[1], 0).normalize();
      floorClamp(f, hand, L0);
    } else if (f.state !== 'move' && carry) {
      dir.set(f.face * carry[0], carry[1], 0).normalize();
    }
    m.position.copy(hand); m.quaternion.setFromUnitVectors(Y, dir);
    // sized to the body holding it (audit A12): a 52 px wisp no longer carries a sword taller than itself
    // and a 90 px kaiju no longer a toy. 76 px is the height the props were modelled against.
    const bodyK = Math.max(0.75, Math.min(1.25, f.h / 76));
    m.scale.setScalar(bodyK);
    // Beam Sword: the blade extends with the smash charge and stays out for the swing, so the reach
    // you are about to get is visible to BOTH players before it lands (Smash's rule that every item
    // which can steal a stock announces itself first). Visual only - the hitbox is swordify()'s.
    const bl = m.userData.blade;
    if (bl) {
      const mv = f.move, isSmash = mv && mv.def && (mv.def.base || mv.def).smash;
      const ch = isSmash ? Math.min(1, (mv.charge || 0) / 60) : 0;
      const want = isSmash ? 1 + 1.6 * ch : 1;
      const k = (m.userData.bladeK = (m.userData.bladeK || 1) + (want - (m.userData.bladeK || 1)) * 0.35);
      for (const part of bl.parts) { part.scale.y = k; part.position.y = bl.base + bl.L * k / 2; }
    }
    const sp = sp0, len = L0 * bodyK;
    if (kind === 'hammer' || kind === 'beam' || kind === 'blade') swordTip = tip.copy(hand).addScaledVector(dir, len * 0.92);
    // the off-hand gun: same prop, same scale, same aim, on the LEFT hand and forearm. 9g_guns
    // re-poses both of them afterwards; this just has to exist and be in the right place.
    if (dualKey && B.LeftHand && B.LeftForeArm) {
      let m2 = av.held[dualKey]; if (!m2) { m2 = av.held[dualKey] = makeProp(kind); m2.visible = av.root.visible; }
      B.LeftHand.getWorldPosition(hand2); B.LeftForeArm.getWorldPosition(fore2);
      dir2.subVectors(hand2, fore2).normalize();
      if (aim) dir2.set(aim[0], aim[1], 0).normalize();
      m2.position.copy(hand2); m2.quaternion.setFromUnitVectors(Y, dir2);
      // sit the off-hand gun a little further from the camera. The rig's hands are close together in
      // the idle pose, and two long props (the SMG especially) landed on top of each other and read
      // as one gun with a doubled outline. The left hand IS the far hand in this side-on view, so
      // pushing it back is both the fix and the correct thing to draw.
      m2.position.z -= 0.085 * bodyK;
      m2.scale.setScalar(bodyK);
    }
  }
  // slash trail while a strike is live
  const mv = f.move, d = mv && mv.def, h0 = d && d.hits && d.hits.find(hb => !hb.grab);
  const live = !dead && h0 && mv.t >= h0.f[0] - 3 && mv.t <= h0.f[1] + 5 && (f.state === 'move' || f.state === 'hammer');
  let p = swordTip;
  if (!p && live && V3.strikeTip) { const st = V3.strikeTip(f); if (st) p = tip.copy(st); }   // the limb that actually swings (97_v3_pose)
  if (!p) {
    const bone = FOOT_CLIPS.has(av.cur) ? (B.RightToeBase || B.RightFoot) : B.RightHand;
    if (bone) { bone.getWorldPosition(tip); p = tip; }
  }
  if (p) updateTrail(av.trail, live, p, (d && d.weapon) || f.color, swordTip ? 0.1 : 0.07);
  // Pump Pill gold aura and Final Smash rainbow glow
  const pumped = f.powerT > 0 && !dead, final = f.finalReady && !dead;
  av.aura.intensity = pumped ? 6 + Math.sin(f.t * 0.4) * 2 : final ? 4 : 0;
  if (final) av.aura.color.setHSL((f.t * 0.01) % 1, 1, 0.6); else av.aura.color.set(0xffd23f);
  av.aura.position.set(f.x * SC, -f.y * SC + f.h * SC * 0.7, 0.6);
  if (pumped || final) for (const mt of av.mats) {
    if (f.flashT > 0) continue;
    if (pumped) mt.emissive.setRGB(0.16 + Math.sin(f.t * 0.3) * 0.06, 0.11 + Math.sin(f.t * 0.3) * 0.04, 0.0);
    else mt.emissive.setHSL((f.t * 0.01) % 1, 1, 0.06);
  }
};
V3.disposeDecor = function (av) {
  if (!av.bones) return;
  V3.scene.remove(av.trail.mesh, av.aura); for (const m of Object.values(av.held)) V3.scene.remove(m);
};

// ---- Final Smash beam ----
let beam = null;
function syncBeam() {
  const f = Game.finalBy;
  if (!beam) {
    beam = new THREE.Group();
    // 9/22 night: at glow 1.6 / 1.8 / 2.4 under bloom the beam was one solid white slab and nobody inside it could
    // be seen. Colour layers first, a thin hot core, so the victims read as silhouettes getting blasted.
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), glowMat('#22e6ff', 0.9)); outer.material.opacity = 0.42;
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 24, 1, true), glowMat('#ff4fd8', 1.0)); mid.material.opacity = 0.38;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 20), glowMat('#ffffff', 1.5));
    beam.add(outer, mid, core); beam.rotation.z = Math.PI / 2; V3.scene.add(beam);
  }
  const on = f && f.state === 'final' && f.st > 10;
  beam.visible = !!on; if (!on) return;
  const k = Math.min(1, (f.st - 10) / 14) * (f.st > 136 ? Math.max(0, 1 - (f.st - 136) / 14) : 1);
  const L = 30, r = 0.62 * k * (1 + Math.sin(f.st * 0.8) * 0.06);
  beam.scale.set(r, L, r);
  beam.position.set(f.x * SC + f.face * (L / 2 + 0.3), -f.y * SC + f.h * SC * 0.55, 0.3);
}

V3.itemsFrame = function () { syncItems(); syncBeam(); };

