// ===== 3D: the ARSENAL — props, projectiles and the airstrike showpiece (src/57_items3.js) =====
// Visual only: reads Game / Items3 state, never writes it, never touches the seeded fight RNG
// (Math.random is fine here). Wrapped in a block so its names can't collide: all .mjs share ONE
// module scope. It chains V3.makeProp2 / V3.projMesh2 / V3.movesFrame rather than editing 94, so the
// moves session and this one never touch the same file.
{
  const T = THREE;
  const cache = new Map();
  const std = (hex, o) => { const k = 's' + hex + JSON.stringify(o || 0); let m = cache.get(k); if (!m) cache.set(k, m = new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.55 }, o || {}))); return m; };
  const glow = (hex, k = 2, op = 1) => { const key = 'g' + hex + k + op; let m = cache.get(key); if (!m) cache.set(key, m = new T.MeshBasicMaterial({ color: new T.Color(hex).multiplyScalar(k * 0.62), transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, fog: false })); return m; };
  const SPH = new T.SphereGeometry(1, 18, 12), SPHL = new T.SphereGeometry(1, 10, 7);
  const CYL = new T.CylinderGeometry(1, 1, 1, 16), BOX = new T.BoxGeometry(1, 1, 1);
  const RING = new T.RingGeometry(0.82, 1, 40), PLANE = new T.PlaneGeometry(1, 1), CONE = new T.ConeGeometry(1, 1, 16);
  const cyl = (g, r0, r1, h, mat, y, x = 0, z = 0) => { const m = new T.Mesh(CYL, mat); m.scale.set(r0, h, r0); m.position.set(x, y, z); g.add(m); if (r1 !== r0) { m.geometry = new T.CylinderGeometry(r0, r1, 1, 16); m.scale.set(1, h, 1); } return m; };
  const box = (g, w, h, d, mat, x, y, z = 0) => { const m = new T.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y, z); g.add(m); return m; };
  const sph = (g, r, mat, x, y, z = 0) => { const m = new T.Mesh(SPH, mat); m.scale.setScalar(r); m.position.set(x, y, z); g.add(m); return m; };

  // ---------------- held / placed props (grip at the origin, business end along +Y) ----------------
  const STEEL = () => std(0x9aa0ac, { metalness: 0.9, roughness: 0.28 });
  const DARK = () => std(0x23262e, { metalness: 0.5, roughness: 0.5 });
  function peelMesh(g) {
    // four splayed skins around a squashed core: reads instantly from any angle
    const y = std(0xffd93a, { roughness: 0.4 }), y2 = std(0xf0b81a, { roughness: 0.45 });
    sph(g, 0.09, y2, 0, 0.035).scale.set(0.12, 0.045, 0.12);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const pts = [];
      for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push(new T.Vector3(Math.cos(a) * t * 0.26, 0.05 + Math.sin(t * 2.4) * 0.05 - t * t * 0.03, Math.sin(a) * t * 0.26)); }
      const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 10, 0.035, 6, false), i % 2 ? y : y2);
      g.add(tube);
    }
  }
  function panMesh(g) {
    const steel = std(0x3a3e46, { metalness: 0.85, roughness: 0.32 }), grip = std(0x1a1c22, { roughness: 0.7 });
    const bowl = new T.Mesh(new T.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    bowl.scale.set(0.23, 0.1, 0.23); bowl.rotation.x = Math.PI; bowl.position.y = 0.52; g.add(bowl);
    const rim = new T.Mesh(new T.TorusGeometry(0.23, 0.016, 8, 30), steel); rim.rotation.x = Math.PI / 2; rim.position.y = 0.52; g.add(rim);
    cyl(g, 0.026, 0.026, 0.46, grip, 0.24);
    box(g, 0.07, 0.05, 0.05, grip, 0, 0.03);
  }
  function prodMesh(g) {
    cyl(g, 0.018, 0.018, 0.5, std(0x8a5a2a, { roughness: 0.75 }), 0.25);
    const hand = new T.Mesh(SPH, std(0xffd9b0, { roughness: 0.6 })); hand.scale.set(0.07, 0.06, 0.05); hand.position.y = 0.54; g.add(hand);
    const fing = new T.Mesh(CYL, std(0xffd9b0, { roughness: 0.6 })); fing.scale.set(0.024, 0.14, 0.024); fing.position.y = 0.63; g.add(fing);
  }
  function dynaMesh(g) {
    const red = std(0xc0312a, { roughness: 0.6 }), fuse = std(0x2a2a2a);
    for (const x of [-0.055, 0, 0.055]) cyl(g, 0.048, 0.048, 0.34, red, 0.18, x);
    const band = new T.Mesh(BOX, std(0x6a4a2a)); band.scale.set(0.2, 0.05, 0.12); band.position.y = 0.18; g.add(band);
    const f = cyl(g, 0.009, 0.009, 0.14, fuse, 0.41, 0.02); f.rotation.z = -0.35;
    sph(g, 0.022, glow('#ffd45c', 3), 0.07, 0.48);
  }
  function girderMesh(g) {
    const steel = std(0xd05a2a, { metalness: 0.6, roughness: 0.5 });
    box(g, 0.5, 0.05, 0.16, steel, 0, 0.3); box(g, 0.5, 0.05, 0.16, steel, 0, 0.1);
    box(g, 0.05, 0.25, 0.1, steel, 0, 0.2);
    for (const x of [-0.2, 0, 0.2]) box(g, 0.03, 0.03, 0.18, std(0x2a2a30), x, 0.3);
  }
  function bouncerMesh(g) {
    const body = new T.Mesh(SPH, std(0x2a3a5a, { metalness: 0.6, roughness: 0.3 })); body.scale.set(0.2, 0.13, 0.2); body.position.y = 0.13; g.add(body);
    const ring = new T.Mesh(new T.TorusGeometry(0.21, 0.035, 10, 28), glow('#9fe8ff', 2.2)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring);
    sph(g, 0.055, glow('#ffffff', 2.6), 0, 0.22);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; cyl(g, 0.014, 0.014, 0.1, std(0x1a1c22), 0.05, Math.cos(a) * 0.15, Math.sin(a) * 0.15); }
  }
  function zipMesh(g) {
    const s = STEEL();
    box(g, 0.07, 0.2, 0.06, std(0x2a2e38, { metalness: 0.7 }), 0, 0.1);
    cyl(g, 0.03, 0.03, 0.26, s, 0.3);
    const hook = new T.Mesh(new T.TorusGeometry(0.07, 0.018, 8, 18, Math.PI * 1.35), s); hook.position.y = 0.48; hook.rotation.set(Math.PI / 2, 0, 0.6); g.add(hook);
    const spool = new T.Mesh(CYL, std(0xffc83a, { metalness: 0.5 })); spool.scale.set(0.06, 0.05, 0.06); spool.rotation.z = Math.PI / 2; spool.position.set(0.06, 0.12, 0); g.add(spool);
  }
  function bootsMesh(g) {
    const l = std(0xc03a2a, { roughness: 0.5 }), s = STEEL();
    for (const x of [-0.09, 0.09]) {
      box(g, 0.13, 0.22, 0.24, l, x, 0.2, 0.02);
      box(g, 0.14, 0.05, 0.3, std(0x1a1c22), x, 0.08, 0.04);
      cyl(g, 0.05, 0.065, 0.1, s, 0.05, x, -0.12);
      sph(g, 0.03, glow('#ff9a2a', 2.4), x, 0.0, -0.12);
    }
  }
  function clusterMesh(g, r = 1) {
    const sh = std(0x2f6a3a, { roughness: 0.5, metalness: 0.3 });
    const b = new T.Mesh(SPH, sh); b.scale.setScalar(0.15 * r); b.position.y = 0.15 * r; g.add(b);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; sph(g, 0.05 * r, std(0xffc83a, { roughness: 0.4 }), Math.cos(a) * 0.14 * r, 0.15 * r, Math.sin(a) * 0.14 * r); }
    cyl(g, 0.03 * r, 0.03 * r, 0.06 * r, std(0x1a1c22), 0.31 * r);
    sph(g, 0.022 * r, glow('#ff5a3a', 3), 0, 0.35 * r);
  }
  function sheepMesh(g) {
    const wool = std(0xf6f2ee, { roughness: 0.95 }), face = std(0x2a2a30, { roughness: 0.6 });
    for (const [x, y, z, r] of [[0, 0.2, 0, 0.16], [0.1, 0.24, 0.05, 0.11], [-0.1, 0.24, -0.04, 0.11], [0.03, 0.3, -0.06, 0.1]]) sph(g, r, wool, x, y, z);
    const head = sph(g, 0.08, face, 0.19, 0.2, 0); head.scale.set(0.08, 0.09, 0.07);
    for (const z of [-0.05, 0.05]) sph(g, 0.022, glow('#ffffff', 1.6), 0.24, 0.23, z);
    for (const [x, z] of [[0.08, 0.07], [0.08, -0.07], [-0.08, 0.07], [-0.08, -0.07]]) cyl(g, 0.02, 0.02, 0.12, face, 0.06, x, z);
    sph(g, 0.022, glow('#ff3a3a', 2.6), 0, 0.36);
  }
  function flamerMesh(g) {
    const tank = std(0xc03a2a, { metalness: 0.4, roughness: 0.45 }), s = STEEL();
    box(g, 0.09, 0.16, 0.08, DARK(), 0, 0.08);
    cyl(g, 0.03, 0.03, 0.4, s, 0.3);
    cyl(g, 0.05, 0.038, 0.09, DARK(), 0.53);
    for (const z of [-0.09, 0.09]) cyl(g, 0.055, 0.055, 0.26, tank, 0.14, -0.1, z);
    sph(g, 0.03, glow('#ff8a2a', 2.6), 0, 0.58);
  }
  function freezeMesh(g) {
    const body = std(0x2a4a6a, { metalness: 0.6, roughness: 0.3 });
    box(g, 0.09, 0.17, 0.08, DARK(), 0, 0.09);
    cyl(g, 0.038, 0.038, 0.4, body, 0.32);
    const em = new T.Mesh(CONE, glow('#9fe8ff', 2.2, 0.85)); em.scale.set(0.075, 0.13, 0.075); em.position.y = 0.58; g.add(em);
    const coil = new T.Mesh(new T.TorusGeometry(0.06, 0.012, 6, 20), glow('#cdf3ff', 2)); coil.rotation.x = Math.PI / 2; coil.position.y = 0.42; g.add(coil);
    sph(g, 0.038, glow('#ffffff', 2.4), 0, 0.2);
  }
  function homerMesh(g) {
    const tube = std(0x3a4250, { roughness: 0.4, metalness: 0.5 });
    cyl(g, 0.055, 0.055, 0.6, tube, 0.22);
    cyl(g, 0.07, 0.05, 0.08, DARK(), -0.14);
    box(g, 0.05, 0.11, 0.04, DARK(), 0.06, 0.03);
    const scope = box(g, 0.05, 0.05, 0.12, std(0xff3a6e, { emissive: 0x8a0020, emissiveIntensity: 1 }), -0.02, 0.5);
    sph(g, 0.03, glow('#ff5a8a', 3), 0, 0.56);
    return scope;
  }
  function drillMesh(g) {
    const s = STEEL();
    const body = new T.Mesh(SPH, std(0x8a6a3a, { roughness: 0.7 })); body.scale.set(0.12, 0.1, 0.12); body.position.y = 0.14; g.add(body);
    const nose = new T.Mesh(CONE, s); nose.scale.set(0.08, 0.2, 0.08); nose.position.y = 0.32; g.add(nose);
    for (let i = 0; i < 3; i++) { const t = new T.Mesh(new T.TorusGeometry(0.06 - i * 0.015, 0.012, 6, 16), s); t.rotation.x = Math.PI / 2; t.position.y = 0.26 + i * 0.05; g.add(t); }
    for (const z of [-0.06, 0.06]) sph(g, 0.02, glow('#ffd45c', 2), 0.09, 0.16, z);
  }
  function aegisMesh(g) {
    const body = new T.Mesh(SPH, std(0xcfd8e4, { metalness: 0.8, roughness: 0.25 })); body.scale.set(0.11, 0.08, 0.11); body.position.y = 0.18; g.add(body);
    const ring = new T.Mesh(new T.TorusGeometry(0.16, 0.016, 8, 26), glow('#9fe8ff', 2.2)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.18; g.add(ring);
    sph(g, 0.035, glow('#ffffff', 2.8), 0, 0.18, 0.1);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; cyl(g, 0.01, 0.01, 0.07, std(0x2a2e38), 0.24, Math.cos(a) * 0.08, Math.sin(a) * 0.08); }
  }
  function turretMesh(g) {
    const s = STEEL(), d = DARK();
    cyl(g, 0.16, 0.2, 0.06, d, 0.03);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; cyl(g, 0.016, 0.016, 0.16, d, 0.08, Math.cos(a) * 0.16, Math.sin(a) * 0.16); }
    const head = box(g, 0.16, 0.13, 0.14, std(0x3a4250, { metalness: 0.6 }), 0, 0.2);
    const bar = cyl(g, 0.022, 0.022, 0.24, s, 0.2, 0.15); bar.rotation.z = Math.PI / 2;
    sph(g, 0.028, glow('#ff3a3a', 2.8), 0, 0.28);
    g.userData.head = head;
  }
  function wellMesh(g) {
    const core = new T.Mesh(SPH, std(0x05060a, { roughness: 1 })); core.scale.setScalar(0.12); core.position.y = 0.2; g.add(core);
    const halo = new T.Mesh(SPH, glow('#9a6cff', 1.4, 0.45)); halo.scale.setScalar(0.2); halo.position.y = 0.2; g.add(halo);
    const disc = new T.Mesh(RING, glow('#c89aff', 2, 0.8)); disc.scale.setScalar(0.3); disc.position.y = 0.2; disc.rotation.x = -1.1; g.add(disc);
    g.userData.disc = disc;
  }
  function remoteMesh(g) {
    const d = DARK();
    box(g, 0.14, 0.24, 0.05, d, 0, 0.14);
    box(g, 0.1, 0.07, 0.02, glow('#4aff8a', 1.6), 0, 0.22, 0.032);
    for (let i = 0; i < 4; i++) box(g, 0.03, 0.03, 0.02, std(0xd03a3a), -0.035 + (i % 2) * 0.07, 0.1 - Math.floor(i / 2) * 0.045, 0.032);
    const ant = cyl(g, 0.007, 0.007, 0.26, STEEL(), 0.38, 0.05); ant.rotation.z = -0.18;
    sph(g, 0.018, glow('#ff3a3a', 3), 0.07, 0.5);
  }
  function donkeyRemote(g) { remoteMesh(g); box(g, 0.1, 0.04, 0.02, std(0xc8ccd4), 0, 0.045, 0.032); }
  function armageddonMesh(g) {
    const core = new T.Mesh(SPH, glow('#ff2a3a', 2.4, 0.9)); core.scale.setScalar(0.15); core.position.y = 0.2; g.add(core);
    const cage = new T.Mesh(new T.IcosahedronGeometry(0.21, 0), std(0x2a0a10, { metalness: 0.9, roughness: 0.3, emissive: 0x6a0010, emissiveIntensity: 1.4, wireframe: true }));
    cage.position.y = 0.2; g.add(cage); g.userData.cage = cage;
    const ring = new T.Mesh(new T.TorusGeometry(0.26, 0.015, 6, 30), glow('#ff8a3a', 2)); ring.rotation.x = 1.2; ring.position.y = 0.2; g.add(ring);
  }
  // a stylised concrete donkey: blocky on purpose, it has to read at 60 px
  function donkeyMesh() {
    const g = new T.Group(), c = std(0xa8a49c, { roughness: 0.95 }), c2 = std(0x8a8680, { roughness: 0.95 });
    box(g, 1.5, 0.85, 0.75, c, 0, 0.9);
    box(g, 0.55, 0.5, 0.5, c2, 0.85, 1.35);          // head
    box(g, 0.3, 0.42, 0.28, c2, 1.05, 1.0);          // muzzle
    for (const z of [-0.16, 0.16]) { const e = box(g, 0.14, 0.34, 0.1, c, 0.8, 1.72, z); e.rotation.z = z > 0 ? 0.2 : -0.2; }
    for (const [x, z] of [[0.5, 0.28], [0.5, -0.28], [-0.5, 0.28], [-0.5, -0.28]]) box(g, 0.24, 0.72, 0.24, c, x, 0.2, z);
    box(g, 0.12, 0.5, 0.12, c2, -0.78, 1.0);         // tail
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  const PROPS = {
    peel: peelMesh, pan: panMesh, prod: prodMesh, dyna: dynaMesh, girder: girderMesh, bouncer: bouncerMesh,
    zip: zipMesh, boots: bootsMesh, cluster: g => clusterMesh(g, 1), clustlet: g => clusterMesh(g, 0.5),
    sheep: sheepMesh, flamer: flamerMesh, freeze: freezeMesh, homer: homerMesh, drill: drillMesh,
    aegis: aegisMesh, turret: turretMesh, well: wellMesh, strike: remoteMesh, donkey: donkeyRemote,
    armageddon: armageddonMesh,
  };
  const prevProp = V3.makeProp2;
  V3.makeProp2 = function (kind, inner, outer) {
    if (prevProp && prevProp(kind, inner, outer)) return true;
    const mk = PROPS[kind];
    if (!mk) return false;
    mk(inner);
    inner.traverse(o => { if (o.isMesh && o.material && !o.material.transparent) o.castShadow = true; });
    return true;
  };

  // ---------------- projectiles ----------------
  const prevProj = V3.projMesh2;
  V3.projMesh2 = function (p, g) {
    if (prevProj && prevProj(p, g)) return true;
    if (p.kind === 'zipline') {
      const h = new T.Mesh(new T.TorusGeometry(0.08, 0.02, 6, 16, Math.PI * 1.4), std(0xcfd4e8, { metalness: 0.9, roughness: 0.25 }));
      h.rotation.set(Math.PI / 2, 0, 0); g.add(h);
      g.add(new T.Mesh(SPHL, glow('#ffffff', 2)).translateY(0.06));
      return true;
    }
    if (p.kind === 'frost') {
      const c = new T.Mesh(new T.IcosahedronGeometry(0.13, 0), std(0xcdf3ff, { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x2a7a9a, emissiveIntensity: 1.2 }));
      g.add(c);
      const h = new T.Mesh(SPH, glow('#9fe8ff', 1.4, 0.5)); h.scale.setScalar(0.2); g.add(h);
      return true;
    }
    if (p.kind === 'homer') {
      const b = new T.Mesh(CYL, std(0xe8eaf0, { metalness: 0.5, roughness: 0.35 })); b.scale.set(0.05, 0.3, 0.05); b.rotation.z = -Math.PI / 2; g.add(b);
      const n = new T.Mesh(CONE, std(0xff3a6e, { roughness: 0.4 })); n.scale.set(0.05, 0.12, 0.05); n.rotation.z = -Math.PI / 2; n.position.x = 0.2; g.add(n);
      for (const z of [-0.06, 0.06]) { const f = new T.Mesh(BOX, std(0xff3a6e)); f.scale.set(0.09, 0.02, 0.06); f.position.set(-0.13, 0, z); g.add(f); }
      const fl = new T.Mesh(CONE, glow('#ff9a2a', 2.4, 0.9)); fl.scale.set(0.05, 0.2, 0.05); fl.rotation.z = Math.PI / 2; fl.position.x = -0.26; g.add(fl);
      return true;
    }
    if (p.kind === 'meteor') {
      const r = new T.Mesh(new T.IcosahedronGeometry(0.16, 0), std(0x3a2a24, { roughness: 1, emissive: 0x8a2a00, emissiveIntensity: 1.1 })); g.add(r);
      const h = new T.Mesh(SPH, glow('#ff5a2a', 1.8, 0.6)); h.scale.setScalar(0.3); g.add(h);
      const tail = new T.Mesh(CONE, glow('#ff9a3a', 1.6, 0.55)); tail.scale.set(0.16, 0.6, 0.16); tail.position.y = 0.36; g.add(tail);
      return true;
    }
    return false;
  };

  // ---------------- per-frame extras ----------------
  const pool = new Map();          // key -> { obj, used }
  function get(key, make) {
    let e = pool.get(key);
    if (!e) { e = { obj: make() }; pool.set(key, e); V3.scene.add(e.obj); }
    e.used = true; e.obj.visible = true; return e.obj;
  }
  // anything nobody asked for this frame is hidden, and thrown away if it stays unused for 10 s
  function sweep() {
    for (const [k, e] of pool) {
      if (e.used) { e.idle = 0; e.used = false; continue; }
      e.obj.visible = false; e.idle = (e.idle || 0) + 1;
      if (e.idle > 600) { V3.scene.remove(e.obj); pool.delete(k); }
    }
  }

  // THE BUG THAT HID THIS WHOLE FILE'S BEST WORK.
  // `src/57_items3.js` declares `const Items3 = {...}` at the top level of a classic script. A
  // top-level `const` goes into the GLOBAL LEXICAL environment — a module can read it by name, but
  // it is NOT a property of `window`, and it never will be. Two functions below reached for it as
  // `window.Items3`, got `undefined`, and returned on their first line every frame since the day
  // they were written. Silently, with no error, forever.
  //
  // What was invisible as a result: the airstrike marker, the three jets, the three missiles, the
  // concrete donkey, every placed girder, and Armageddon's red sky. The sim was running all of it
  // correctly the whole time — `dev/weapon_test.js` passes 24 assertions on the airstrike — which
  // is exactly why nobody noticed. The feature worked; it just could not be seen.
  //
  // Read by name, with a guard so a missing 57_items3.js degrades instead of throwing.
  const items3 = () => (typeof Items3 !== 'undefined' ? Items3 : (typeof window !== 'undefined' ? window.Items3 : null)) || null;

  // --- the airstrike: marker on the deck, three jets, three missiles ---
  function jetMesh() {
    const g = new T.Group(), body = std(0x59606c, { metalness: 0.75, roughness: 0.3 }), dark = std(0x24272e);
    const f = new T.Mesh(CYL, body); f.scale.set(0.1, 1.5, 0.1); f.rotation.z = Math.PI / 2; g.add(f);
    const nose = new T.Mesh(CONE, body); nose.scale.set(0.1, 0.5, 0.1); nose.rotation.z = -Math.PI / 2; nose.position.x = 1.0; g.add(nose);
    const wing = new T.Mesh(BOX, body); wing.scale.set(0.7, 0.04, 1.6); wing.position.x = -0.1; g.add(wing);
    const sw = new T.Mesh(BOX, body); sw.scale.set(0.34, 0.04, 0.75); sw.position.x = -0.62; g.add(sw);
    const fin = new T.Mesh(BOX, body); fin.scale.set(0.3, 0.42, 0.04); fin.position.set(-0.6, 0.22, 0); g.add(fin);
    const can = new T.Mesh(SPH, std(0x0a1a2a, { metalness: 1, roughness: 0.05 })); can.scale.set(0.22, 0.09, 0.11); can.position.set(0.33, 0.08, 0); g.add(can);
    const burn = new T.Mesh(CONE, glow('#9fd4ff', 2.6, 0.9)); burn.scale.set(0.09, 0.55, 0.09); burn.rotation.z = Math.PI / 2; burn.position.x = -0.95; g.add(burn);
    g.userData.burn = burn;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function missileMesh() {
    const g = new T.Group(), s = std(0xd8dae0, { metalness: 0.5, roughness: 0.35 });
    const b = new T.Mesh(CYL, s); b.scale.set(0.055, 0.5, 0.055); g.add(b);
    const n = new T.Mesh(CONE, std(0xd0342a)); n.scale.set(0.055, 0.18, 0.055); n.position.y = -0.34; n.rotation.x = Math.PI; g.add(n);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const f = new T.Mesh(BOX, std(0xd0342a)); f.scale.set(0.02, 0.14, 0.11); f.position.set(Math.cos(a) * 0.05, 0.24, Math.sin(a) * 0.05); f.rotation.y = -a; g.add(f); }
    const fl = new T.Mesh(CONE, glow('#ffb347', 2.4, 0.85)); fl.scale.set(0.055, 0.3, 0.055); fl.position.y = 0.42; g.add(fl);
    return g;
  }
  function marker(x, top, hot, k) {
    const SCx = V3.SC;
    const r = get('mk' + k, () => {
      const g = new T.Group();
      const ring = new T.Mesh(RING, glow('#ff3a3a', 2.4, 0.9)); ring.rotation.x = -Math.PI / 2; g.add(ring);
      const ring2 = new T.Mesh(RING, glow('#ffd45c', 2, 0.7)); ring2.rotation.x = -Math.PI / 2; ring2.scale.setScalar(0.55); g.add(ring2);
      for (let i = 0; i < 4; i++) { const b = new T.Mesh(BOX, glow('#ff3a3a', 2.4, 0.9)); b.scale.set(i % 2 ? 0.9 : 0.06, 0.01, i % 2 ? 0.06 : 0.9); g.add(b); }
      const beam = new T.Mesh(CYL, glow('#ff3a3a', 1.2, 0.2)); beam.scale.set(0.45, 9, 0.45); beam.position.y = 4.5; g.add(beam);
      g.userData.flat = [ring, ring2]; g.userData.beam = beam;
      return g;
    });
    const t = performance.now() / 1000, pulse = 1 + Math.sin(t * (hot ? 16 : 7)) * 0.16;
    r.position.set(x * SCx, -top * SCx + 0.02, 0.15);
    r.scale.setScalar(0.7 * pulse);
    const col = hot ? '#ff1a2a' : '#ff9a3a';
    for (const p of r.userData.flat) p.material = glow(col, hot ? 3 : 2.2, 0.9);
    r.userData.beam.material = glow(col, 1.2, 0.22);
    r.rotation.y = t * (hot ? 3 : 1.2);
  }
  function strikeFrame() {
    const I = items3();
    if (!I) return;
    const SCx = V3.SC, top = Game.stage ? Game.stage.main.top : 0;
    // 1. someone is still choosing the spot
    let k = 0;
    for (const f of Game.fighters) if (I.aiming && I.aiming(f)) { marker(f.aimX, top, false, 'aim' + k); k++; }
    // 2. committed strikes
    for (let s = 0; s < I.strikes.length; s++) {
      const S = I.strikes[s], tt = S.t;
      marker(S.x, top, tt < 50, 'go' + s);
      if (S.kind === 'donkey') {
        // the donkey drops from the blast ceiling and lands exactly as the timer hits 0
        const d = get('dk' + s, donkeyMesh);
        const k2 = 1 - tt / 96, y = -( -560 + (top + 560) * k2 * k2 );
        d.position.set(S.x * SCx, y * SCx, 0.1);
        d.rotation.set(0, 0.5, Math.sin(k2 * 7) * 0.12);
        d.scale.setScalar(1.6);
        continue;
      }
      // Three jets sweep in from the side the strike was called from, missiles away at t=60.
      //
      // THEY USED TO FLY AT `top - 470`, WHICH IS ABOVE THE TOP OF THE SCREEN. The marker, the
      // beeping and the impact all worked, so the weapon "worked" — but the jets, which are the
      // half Duane actually asked for by name, had never been in frame. Caught by shooting the
      // telegraph frame by frame (dev/cosmshot.mjs strike) and looking at it.
      // JET_Y is now inside the camera's normal framing: at a 1v1 zoom the visible sky runs to
      // roughly 250 px above the main platform, so they cross the upper third of the screen.
      const dir = S.face || 1;
      const JET_Y = top - 215;
      for (let j = 0; j < 3; j++) {
        const jet = get('jt' + s + '_' + j, jetMesh);
        const lead = (150 - tt) / 150 + j * 0.055;
        const jx = (S.x - dir * 1500) + dir * 3000 * lead;
        const jy = JET_Y - j * 26 + Math.abs(j - 1) * 8;
        jet.position.set(jx * SCx, -jy * SCx, -0.9);
        jet.scale.setScalar(1.35);
        jet.rotation.set(0, dir > 0 ? 0 : Math.PI, dir > 0 ? -0.05 : 0.05);
        if (jet.userData.burn) jet.userData.burn.scale.y = 0.45 + Math.random() * 0.35;
        jet.visible = lead > -0.05 && lead < 1.35;
      }
      if (tt <= 60) for (let j = 0; j < 3; j++) {
        const ms = get('ms' + s + '_' + j, missileMesh);
        const k3 = 1 - tt / 60, mx = S.x + (j - 1) * 62 * k3, y0 = JET_Y - j * 26;
        const my = y0 + (top - 14 - y0) * (k3 * k3);
        ms.position.set(mx * SCx, -my * SCx, 0.05);
        ms.rotation.set(0, 0, Math.atan2((j - 1) * 62 * 0.02, 1) * 0.6);
        ms.scale.setScalar(1.5);
      }
    }
  }
  // --- ice, drones, wells, girders, the red sky ---
  function bodyFrame() {
    const SCx = V3.SC;
    for (const f of Game.fighters) {
      if (f.frozen > 0 && f.state !== 'dead') {
        const ice = get('ice' + f.idx, () => {
          const g = new T.Group();
          const b = new T.Mesh(new T.IcosahedronGeometry(1, 0), new T.MeshStandardMaterial({ color: 0xbfeaff, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.55, emissive: 0x1a5a7a, emissiveIntensity: 0.8 }));
          g.add(b);
          const r = new T.Mesh(new T.IcosahedronGeometry(1.04, 0), new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 })); g.add(r);
          return g;
        });
        ice.position.set(f.x * SCx, -(f.y - f.h * 0.5) * SCx, 0.1);
        ice.scale.set(f.w * SCx * 0.75, f.h * SCx * 0.68, f.w * SCx * 0.7);
        ice.rotation.y += 0.01;
      }
      if (f.aegis > 0 && f.state !== 'dead') {
        const d = get('aeg' + f.idx, () => { const g = new T.Group(); aegisMesh(g); return g; });
        const t = performance.now() / 420 + f.idx;
        d.position.set((f.x + Math.cos(t) * 46) * SCx, -(f.y - f.h * 1.15 + Math.sin(t * 1.7) * 8) * SCx, 0.25 + Math.sin(t) * 0.2);
        d.scale.setScalar(0.85); d.rotation.y = -t;
      }
    }
    const I = items3();
    if (I && I.girders) for (let i = 0; i < I.girders.length; i++) {
      const p = I.girders[i];
      const g = get('gd' + i + '_' + p.born, () => {
        const grp = new T.Group(), steel = std(0xd05a2a, { metalness: 0.6, roughness: 0.5 });
        const web = new T.Mesh(BOX, steel); web.scale.set(1, 0.1, 0.34); grp.add(web);
        for (const y of [-0.13, 0.13]) { const fl = new T.Mesh(BOX, steel); fl.scale.set(1, 0.07, 0.5); fl.position.y = y; grp.add(fl); }
        for (let d = 0; d < 9; d++) { const b = new T.Mesh(BOX, std(0x8a3a18)); b.scale.set(0.02, 0.26, 0.36); b.position.x = -0.45 + d * 0.11; b.rotation.z = d % 2 ? 0.5 : -0.5; grp.add(b); }
        grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
        return grp;
      });
      const w = (p.x1 - p.x0) * SCx;
      g.position.set((p.x0 + p.x1) / 2 * SCx, -p.y * SCx - 0.09, 0.05);
      g.scale.set(w, 1, 1);
      const left = (p.born + p.life) - Game.frame;
      g.visible = left > 90 || Math.floor(left / 5) % 2 === 0;    // blinks out in its last 1.5 s
    }
    if (I && I.rain) {
      const sky = get('doom', () => { const m = new T.Mesh(PLANE, glow('#ff2a1a', 1.1, 0.16)); m.scale.set(80, 50, 1); m.position.set(0, 0, -8); return m; });
      sky.material.opacity = 0.1 + Math.sin(performance.now() / 90) * 0.06;
    }
  }
  function itemExtras() {
    const SCx = V3.SC;
    for (const it of Game.items) {
      if (it.kind === 'well') {
        const w = get('wl' + (it.born || (it.born = Math.random())), () => { const g = new T.Group(); const d = new T.Mesh(RING, glow('#c89aff', 2, 0.85)); d.rotation.x = -1.15; g.add(d); const c = new T.Mesh(SPH, std(0x05060a, { roughness: 1 })); c.scale.setScalar(0.22); g.add(c); const h = new T.Mesh(SPH, glow('#9a6cff', 1.2, 0.35)); h.scale.setScalar(0.42); g.add(h); g.userData.d = d; return g; });
        w.position.set(it.x * SCx, -it.y * SCx, 0.12);
        const k = Math.min(1, it.age / 20) * (it.life < 30 ? it.life / 30 : 1);
        w.scale.setScalar(2.3 * k);
        w.userData.d.rotation.z += 0.09;
      }
      // the turret's laser dot sits on whoever it has locked, so you know to move
      if (it.kind === 'turret' && it.tgtX != null) {
        const dot = get('tt' + (it.born || (it.born = Math.random())), () => { const g = new T.Group(); const d = new T.Mesh(SPHL, glow('#ff3a3a', 2.8)); d.scale.setScalar(0.05); g.add(d); const h = new T.Mesh(SPH, glow('#ff3a3a', 1, 0.3)); h.scale.setScalar(0.13); g.add(h); return g; });
        dot.position.set(it.tgtX * SCx, -(it.y - 46) * SCx, 0.3);
        dot.scale.setScalar(1 + Math.sin(performance.now() / 70) * 0.2);
      }
    }
  }

  // ---------------- COSMETICS ----------------
  // Bragging rights, and the shelf that pays for the game. NOTHING here touches a hitbox, a
  // projectile or a frame of the sim — it is all material colour, lights and loose meshes on top of
  // a fight that has already been decided. That is exactly why cosmetics are legal in a money match
  // and bought weapons are not. docs/ECONOMY.md.
  //
  // THE READABILITY RULE (and it is a rule, not a preference):
  //   A cosmetic stops being a cosmetic the moment it changes how easily a player can be SEEN or
  //   how quickly a move can be READ. Valve shipped CS:GO agent skins in dark green camo, players
  //   genuinely vanished into foliage on Ancient, and Valve had to go back and brighten the models.
  //   Apex deleted Predator dive trails outright because the trail changed where people chose to
  //   land. Riot's internal constraint on skin VFX is not "same numbers", it is "recognisable at the
  //   same distance in the same time window as the base".
  //   So, here:
  //   - NOTHING tints the fighter's own body. Only held weapons, the ring at their feet, loose
  //     particles behind them, and the post-KO screen.
  //   - The aura is a capped point light (AURA_MAX) positioned at the torso, never a body emissive,
  //     so it can never wash a silhouette out or fake a flash of invulnerability.
  //   - Trails only exist in hitstun above launch speed, i.e. after the exchange is already decided.
  //   - KO effects only fire once the fighter is gone.
  //   If a cosmetic is ever asked for that would recolour a fighter, it has to be turned down or it
  //   has to be banned from money matches — and banning it defeats the point of the shelf.
  const AURA_MAX = 5.4;
  const FIN = new WeakMap();      // mesh -> its original { color, metalness, roughness }

  // --- the finish, made visible when your hands are empty -------------------------------------
  // A weapon finish that only shows on a held weapon is a thing people paid for and almost never
  // see: you hold an item for a few seconds a minute, and in a WAGERED match the arsenal is off
  // entirely. So every fighter with a finish equipped carries a holstered sidearm on their back, in
  // that finish. It is an attachment, not a recolour — it sits BEHIND the fight plane (z -0.12), it
  // is 0.3 units tall, and it never touches the body material — so it is still legal under the
  // readability rule above, and it is legal in a money match for the same reason.
  const finMats = new Map();
  function finMat(fin, dark) {
    const k = (fin ? fin.id : 'none') + (dark ? 'd' : '');
    let m = finMats.get(k);
    if (!m) {
      const c = new T.Color(fin && fin.color ? fin.color : 0x9aa0ac);
      if (dark) c.multiplyScalar(0.35);
      m = new T.MeshStandardMaterial({
        color: c,
        metalness: fin && fin.metal != null ? fin.metal : 0.8,
        roughness: fin && fin.metal >= 0.9 ? 0.16 : 0.42,
        // Every finish gets a little emissive, not just the `glow` ones. Without it the holster
        // reads as a dark blob on a busy stage — the shot that proved the piece was there also
        // showed it was barely worth having, which for a paid item is the same as missing.
        emissive: new T.Color(fin && fin.color ? fin.color : 0x9aa0ac).multiplyScalar(fin && fin.glow ? 0.34 : 0.16),
        emissiveIntensity: 1,
      });
      finMats.set(k, m);
    }
    return m;
  }
  function holsterMesh() {
    const g = new T.Group();
    g.userData.parts = [];
    const add = (mesh, dark) => { mesh.userData.dark = !!dark; g.userData.parts.push(mesh); return mesh; };
    // strap plate on the back
    add(box(g, 0.1, 0.34, 0.06, finMat(null, true), 0, 0, -0.02), true);
    // slide + barrel
    add(box(g, 0.1, 0.3, 0.09, finMat(null), 0.01, 0.06, 0.03));
    add(box(g, 0.07, 0.1, 0.07, finMat(null), 0.01, 0.24, 0.03));
    // grip, angled back
    const grip = add(box(g, 0.08, 0.2, 0.08, finMat(null, true), -0.02, -0.12, 0.03), true);
    grip.rotation.z = 0.32;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function finishFrame(f, look) {
    if (!look.finish || f.state === 'dead') return false;
    const SCx = V3.SC;
    const h = get('fin' + f.idx, holsterMesh);
    for (const p of h.userData.parts) p.material = finMat(look.finish, p.userData.dark);
    h.position.set((f.x - f.face * f.w * 0.36) * SCx, -(f.y - f.h * 0.66) * SCx, -0.12);
    h.rotation.set(0, f.face > 0 ? 0.3 : -0.3, f.face > 0 ? -0.18 : 0.18);
    h.scale.setScalar(Math.max(0.7, f.h * SCx * 0.42));
    return true;
  }
  function tintGroup(g, fin) {
    g.traverse(o => {
      if (!o.isMesh || !o.material || o.material.isMeshBasicMaterial) return;   // leave glow bits alone
      let orig = FIN.get(o);
      if (!orig) {
        // the base materials are shared and cached, so clone before touching anything
        o.material = o.material.clone();
        orig = { color: o.material.color.clone(), metalness: o.material.metalness, roughness: o.material.roughness };
        FIN.set(o, orig);
      }
      if (!fin) { o.material.color.copy(orig.color); o.material.metalness = orig.metalness; o.material.roughness = orig.roughness; return; }
      o.material.color.set(fin.color).multiplyScalar(0.55).add(orig.color.clone().multiplyScalar(0.45));
      o.material.metalness = fin.metal != null ? fin.metal : orig.metalness;
      o.material.roughness = fin.metal >= 0.9 ? 0.18 : orig.roughness;
      if (fin.glow && o.material.emissive) { o.material.emissive.set(fin.color).multiplyScalar(0.25); o.material.emissiveIntensity = 1; }
    });
  }
  const AURA = new Map();          // fighter idx -> { light, ring }
  const DEAD = new Map();          // fighter idx -> was it dead last frame
  function cosmeticsFrame() {
    const E = window.Econ;
    if (!E || !E.lookFor || !V3._avatars) return;
    const SCx = V3.SC, now = performance.now();
    for (const [f, av] of V3._avatars) {
      const look = E.lookFor(f.idx) || {};
      // --- weapon finish: recolour whatever is in hand, AND the holstered sidearm on their back,
      // which is the half that is visible when their hands are empty (i.e. nearly always)
      if (av.held) for (const [kind, m] of Object.entries(av.held)) { if (m.visible) tintGroup(m, look.finish || null); }
      finishFrame(f, look);
      const dead = f.state === 'dead';
      // --- aura: a coloured light and a slow ring at the feet
      if (look.aura && !dead) {
        let a = AURA.get(f.idx);
        if (!a) {
          const light = new T.PointLight(0xffffff, 0, 3.4, 2);
          // Its OWN material, never the shared glow cache: the rainbow aura writes a new colour into
          // this every frame, and the cache is handed to bumpers, markers and jets as well.
          const mat = () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, fog: false });
          // THE RING WAS INVISIBLE FOR ITS WHOLE LIFE. It was built with `rotation.x = -PI/2`, which
          // lays it flat in the XZ plane — correct for a top-down game and exactly edge-on to this
          // camera, which looks straight down -Z at a 2.5D fight. Tilted to -1.15 (the same angle
          // the gravity well's disc uses, which is the one disc in this file that always read) it
          // becomes the pool of light at their feet it was supposed to be.
          const ring = new T.Mesh(RING, mat());
          ring.rotation.x = -1.15;
          // and a soft halo behind the fighter, because a floor pool alone is easy to miss in a
          // busy stage — this is the part that makes an aura obvious from across the screen
          const halo = new T.Mesh(PLANE, mat());
          V3.scene.add(light, ring, halo); AURA.set(f.idx, a = { light, ring, halo });
        }
        const hue = look.aura.rainbow ? new T.Color().setHSL((now / 2600) % 1, 1, 0.6) : new T.Color(look.aura.color);
        a.light.color.copy(hue);
        a.light.intensity = Math.min(AURA_MAX, 4.2 + Math.sin(now / 240) * 1.1);   // capped: see the readability rule
        a.light.position.set(f.x * SCx, -(f.y - f.h * 0.6) * SCx, 0.7);
        a.ring.material.color.copy(hue).multiplyScalar(1.25);
        // The ring used to be hidden the moment you left the ground, which made the aura blink out
        // through every jump — most of a match. In the air it follows you and fades instead, so what
        // was paid for is on screen continuously without ever sitting under someone else's feet.
        a.ring.position.set(f.x * SCx, -f.y * SCx + 0.04, f.air ? 0.1 : 0.18);
        a.ring.scale.setScalar((f.air ? 0.62 : 0.95) + Math.sin(now / 420) * 0.06);
        a.ring.material.opacity = f.air ? 0.4 : 0.66;
        a.ring.visible = true;
        // the halo sits BEHIND the fight plane so it never sits on top of a silhouette
        a.halo.material.color.copy(hue).multiplyScalar(0.85);
        a.halo.material.opacity = 0.3 + Math.sin(now / 300) * 0.07;
        a.halo.position.set(f.x * SCx, -(f.y - f.h * 0.5) * SCx, -0.45);
        a.halo.scale.set(f.w * SCx * 4.2, f.h * SCx * 2.6, 1);
        a.halo.visible = true;
        a.light.visible = true;
      } else { const a = AURA.get(f.idx); if (a) { a.light.visible = false; a.ring.visible = false; a.halo.visible = false; a.light.intensity = 0; } }
      // --- launch trail: a streak while they are flying
      if (look.trail && f.state === 'hitstun' && (f.vx * f.vx + f.vy * f.vy) > 64 && Game.frame % 2 === 0) {
        const k = 'tr' + f.idx + '_' + (Game.frame % 24);
        const q = get(k, () => { const m = new T.Mesh(PLANE, glow('#ffffff', 2, 0.9)); return m; });
        q.material = glow(look.trail.color, 2.2, 0.85);
        q.position.set(f.x * SCx, -(f.y - f.h * 0.5) * SCx, 0.22);
        q.scale.set(0.34, 0.34, 1);
        q.rotation.z = Math.atan2(-f.vy, f.vx);
        q.userData.born = now;
      }
      // --- KO effect: fires once, on the frame they leave
      if (dead && !DEAD.get(f.idx)) { koEffect(f, look.ko); DEAD.set(f.idx, 1); }
      if (!dead) DEAD.set(f.idx, 0);
    }
    // trails fade out on their own
    for (const [k, e] of pool) if (k.indexOf('tr') === 0 && e.obj.userData.born) {
      const age = (now - e.obj.userData.born) / 520;
      e.obj.visible = age < 1;
      if (age < 1) { e.used = true; e.obj.scale.setScalar(0.34 * (1 - age * 0.6)); if (e.obj.material) e.obj.material.opacity = 0.85 * (1 - age); }
    }
  }
  const KOFX = [];
  function koEffect(f, ko) {
    if (!ko) return;
    const SCx = V3.SC, x = f.x * SCx, y = -(f.y - f.h * 0.5) * SCx;
    if (ko.id === 'ko_rain') {
      for (let i = 0; i < 22; i++) {
        const c = new T.Mesh(CYL, std(0xffc83a, { metalness: 1, roughness: 0.2, emissive: 0x6a4a00, emissiveIntensity: 1 }));
        c.scale.set(0.11, 0.02, 0.11); c.rotation.z = Math.PI / 2;
        c.position.set(x + (Math.random() - 0.5) * 3, y + 3 + Math.random() * 3, (Math.random() - 0.5) * 0.6);
        V3.scene.add(c); KOFX.push({ o: c, vy: -0.03 - Math.random() * 0.04, vx: (Math.random() - 0.5) * 0.02, spin: 0.2, t: 0, life: 150 });
      }
    } else if (ko.id === 'ko_liq') {
      const g = new T.Group();
      const body = new T.Mesh(BOX, glow('#ff1a3a', 2.2, 0.95)); body.scale.set(0.5, 2.4, 0.1); g.add(body);
      const wick = new T.Mesh(BOX, glow('#ff1a3a', 2.2, 0.8)); wick.scale.set(0.07, 3.4, 0.08); g.add(wick);
      g.position.set(x, y, 0.3); V3.scene.add(g);
      KOFX.push({ o: g, vy: -0.09, vx: 0, spin: 0, t: 0, life: 90, fade: 1 });
    } else if (ko.id === 'ko_nova') {
      const s = new T.Mesh(SPH, glow('#fff3b0', 3, 0.95)); s.scale.setScalar(0.3); s.position.set(x, y, 0.3); V3.scene.add(s);
      const r = new T.Mesh(RING, glow('#ffffff', 3, 0.9)); r.position.set(x, y, 0.28); V3.scene.add(r);
      KOFX.push({ o: s, grow: 0.22, t: 0, life: 40, fade: 1 });
      KOFX.push({ o: r, grow: 0.9, t: 0, life: 40, fade: 1 });
    } else if (ko.id === 'ko_conf') {
      for (let i = 0; i < 34; i++) {
        const c = new T.Mesh(PLANE, glow(['#ff4fd8', '#27e1ff', '#ffc83a', '#3dff8a'][i % 4], 2, 1));
        c.scale.setScalar(0.09);
        c.position.set(x, y, (Math.random() - 0.5) * 0.7);
        V3.scene.add(c);
        const a = Math.random() * Math.PI * 2, sp = 0.04 + Math.random() * 0.06;
        KOFX.push({ o: c, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.03, g: -0.0016, spin: 0.35, t: 0, life: 130, fade: 1 });
      }
    }
  }
  // A KO effect owns its materials so it can fade them, and disposes them when it is done.
  // This used to `material.clone()` every frame of every particle — 34 confetti x 130 frames was
  // ~4400 dead materials per KO, all of them still holding a GPU program. Clone ONCE, on the first
  // fading frame, and dispose on the way out.
  function fadeOwn(o) {
    if (o.userData.owned) return;
    o.userData.owned = 1;
    o.traverse(q => { if (q.isMesh && q.material) { q.material = q.material.clone(); q.material.transparent = true; } });
    if (o.isMesh && o.material && !o.material.__c) { /* covered by traverse */ }
  }
  function setOpacity(o, v) { o.traverse(q => { if (q.isMesh && q.material) q.material.opacity = v; }); }
  function disposeFx(o) {
    V3.scene.remove(o);
    if (!o.userData.owned) return;
    o.traverse(q => { if (q.isMesh && q.material && q.material.dispose) q.material.dispose(); });
  }
  function koFrame() {
    for (let i = KOFX.length - 1; i >= 0; i--) {
      const e = KOFX[i];
      e.t++;
      if (e.vx != null) { e.o.position.x += e.vx; e.o.position.y += e.vy; if (e.g) e.vy += e.g; }
      if (e.spin) e.o.rotation.z += e.spin;
      if (e.grow) e.o.scale.addScalar(e.grow);
      if (e.fade) { fadeOwn(e.o); setOpacity(e.o, Math.max(0, 1 - e.t / e.life)); }
      if (e.t > e.life) { disposeFx(e.o); KOFX.splice(i, 1); }
    }
  }

  const prevMoves = V3.movesFrame;
  V3.movesFrame = function () {
    if (prevMoves) prevMoves();
    try { strikeFrame(); bodyFrame(); itemExtras(); cosmeticsFrame(); koFrame(); sweep(); } catch (e) { V3.fxErr(e, '98_v3_econ:646'); /* cosmetic only: never break the frame */ }
  };
}
