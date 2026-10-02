// ===== 3D: command throws read like a cinematic =====
// A camera punch-in for as long as a grapple hold is running, a white flash on the catch, a shrinking
// ring at the victim's feet for as long as the throw-break window is open, and a coloured burst when
// the throw lets go or gets broken.
// Visual only: it reads Game, the fighters and the GRAPPLE / TK state (24_grapple.js, 27_tekken.js),
// never writes fight state and never touches the seeded Rng (jitter is Math.random). Hooks: wraps
// V3.fxFrame (after the avatars pose) and the composer's render (after the stock camera), both
// installed lazily so load order and boot timing do not matter.

const tbg = { k: 0, last: null, catches: -1, ring: null, esc: null, bursts: [], camWrapped: false, breaks: new WeakMap() };

// the fighter currently running a grapple hold stage, if any
function tbgHolder() {
  try {
    for (const f of Game.fighters) {
      if (f.state !== 'move' || !f.move || !f.move.def.gStage) continue;
      return f;
    }
  } catch (e) { V3.fxErr(e, '97_v3_grapple:19'); /* between matches */ }
  return null;
}

function tbgGlow(color, power, opacity) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
}
function tbgBurst(x, y, color, size, life, flat) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), tbgGlow(color, 2.4, 1));
  m.position.set(x * SC, -y * SC, 0.5); if (flat) m.rotation.x = -Math.PI / 2;
  m.userData = { t: 0, life, size }; V3.scene.add(m); tbg.bursts.push(m);
}
function tbgSyncBursts() {
  for (let i = tbg.bursts.length - 1; i >= 0; i--) {
    const m = tbg.bursts[i], u = m.userData, k = ++u.t / u.life;
    if (k >= 1) { V3.scene.remove(m); m.geometry.dispose(); m.material.dispose(); tbg.bursts.splice(i, 1); continue; }
    m.scale.setScalar(u.size * (0.25 + k * 1.05));
    m.material.opacity = (1 - k) * (1 - k);
  }
}

// the escape window, drawn as a ring at the victim's feet that closes as the window runs out
function tbgEscRing(g) {
  if (!tbg.esc) {
    tbg.esc = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), tbgGlow('#ffffff', 2, 1));
    tbg.esc.rotation.x = -Math.PI / 2; V3.scene.add(tbg.esc);
  }
  const m = tbg.esc, st = g && g.tkEsc, v = g && g.grabbed;
  if (!st || st.off || !v || st.t >= st.win) { m.visible = false; return; }
  const left = 1 - st.t / st.win;
  m.visible = true;
  m.position.set(v.x * SC, -v.y * SC + 0.02, 0);
  m.scale.setScalar(0.22 + left * 0.5);
  m.material.color.set(left > 0.45 ? '#7ff0ff' : '#ffd45c').multiplyScalar(2);
  m.material.opacity = 0.35 + 0.35 * left;
}

function tbgFrame() {
  // the catch: GRAPPLE counts every one it makes
  let n = -1; try { n = GRAPPLE.n.catches; } catch (e) { return; }
  const g = tbgHolder();
  if (tbg.catches < 0) tbg.catches = n;
  if (n !== tbg.catches) {
    tbg.catches = n;
    const src = g || tbg.last;
    const back = src && src.tkEsc && src.tkEsc.back;
    if (src) {
      tbgBurst(src.x, src.y - src.h * 0.5, back ? '#ffe27a' : '#ffffff', back ? 3.4 : 2.2, back ? 24 : 16, false);
      // caught from behind: the ultra. A second gold ring on the floor sells the finisher.
      if (back) tbgBurst(src.x, src.y, '#ffe27a', 5, 30, true);
    }
  }
  // the release, and a break
  try {
    for (const f of Game.fighters) {
      const mv = f.move;
      if (f.state === 'move' && mv && mv.def === TK.BREAKLAG && !tbg.breaks.get(mv)) {
        tbg.breaks.set(mv, 1);
        tbgBurst(f.x, f.y - f.h * 0.6, '#9fe8ff', 2.6, 20, false);
        tbgBurst(f.x, f.y, '#9fe8ff', 3.2, 22, true);
      }
      if (f.gpl && f.gpl.thrown && !tbg.breaks.get(f.gpl)) {
        tbg.breaks.set(f.gpl, 1);
        const ult = f.tkEsc && f.tkEsc.back;
        tbgBurst(f.x, f.y, ult ? '#ffe27a' : f.color, ult ? 6 : 4.2, ult ? 34 : 26, true);
        if (ult) tbgBurst(f.x, f.y - f.h * 0.5, '#fff6c8', 4, 22, false);
      }
    }
  } catch (e) { V3.fxErr(e, '97_v3_grapple:88'); /* cosmetic */ }
  if (g) tbg.last = g;
  tbgEscRing(g || tbg.last);
  tbgSyncBursts();
  tbg.k += ((g ? 1 : 0) - tbg.k) * (g ? 0.1 : 0.09);
}

// after the stock camera has been placed: pull it in toward the clinch
function tbgCamera() {
  if (tbg.k < 0.03) return;
  const g = tbgHolder() || tbg.last;
  if (!g || g.state === 'dead') return;
  const v = g.grabbed, cam = V3.camera;
  const cx = (v ? (g.x + v.x) / 2 : g.x), cy = (v ? Math.min(g.y, v.y) : g.y) - g.h * 0.55;
  const tx = cx * SC, ty = -cy * SC;
  const k = tbg.k * ((g.tkEsc && g.tkEsc.back) ? 0.72 : 0.5);   // a back throw pulls in harder: it is the finisher
  const want = new THREE.Vector3(tx, ty + 0.22, Math.max(3.6, cam.position.z * (1 - k * 0.5)));
  cam.position.lerp(want, Math.min(1, k * 1.2));
  const look = new THREE.Vector3(tx, ty, 0);
  const cur = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(cam.position.z).add(cam.position);
  cam.lookAt(cur.lerp(look, Math.min(1, k * 1.4)));
}
function tbgWrapCamera() {
  if (tbg.camWrapped) return;
  const I = V3.internals && V3.internals(), comp = I && I.composer;
  if (!comp || !comp.render) return;
  const base = comp.render.bind(comp);
  comp.render = function (dt) { try { tbgCamera(); } catch (e) { V3.fxErr(e, '97_v3_grapple:115'); /* never break the frame */ } return base(dt); };
  tbg.camWrapped = true;
}

// ---- frame hook ----
(function () {
  const base = V3.fxFrame;
  if (typeof base !== 'function') return;
  V3.fxFrame = function (pointScale) {
    base.call(this, pointScale);
    try { tbgWrapCamera(); tbgFrame(); } catch (e) { V3.fxErr(e, '97_v3_grapple:125'); /* the visual layer never breaks the frame */ }
  };
})();
