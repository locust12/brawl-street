// ===== 3D GUNPLAY: the guns themselves, muzzle flash, tracers, brass, impacts, the thrown gun, mouse aim =====
// Owner: the gunplay session (dev/NOTES-guns.md). Visual + input only: reads Game / GUNS state and the
// GUNS.ev event ring (6e_guns.js), never writes fight state, never touches the seeded Rng (Math.random
// only). The one thing it writes is GUNS.mouse — the LOCAL-ONLY mouse aim, quantised to the sim's 8 ways,
// which the sim ignores whenever any fighter is a network controller.
// Loads LAST of the .mjs files (9g sorts after 99), so it can wrap V3.decorate (92), V3.makeProp2 (94),
// V3.movesFrame (94) and V3.itemsFrame (92) instead of editing them. Everything is inside one block:
// the .mjs files share ONE module scope and a duplicate top-level name would break all 3D.
// Everything that can repeat per shot is pooled: instanced tracers / sparks / flashes / casings, one
// point cloud for smoke and dust. No allocation per shot.
{
  const gnV = new THREE.Vector3(), gnV2 = new THREE.Vector3(), gnV3 = new THREE.Vector3(), gnM4 = new THREE.Matrix4(), gnQ = new THREE.Quaternion();
  const gnS = new THREE.Vector3(), gnZ = new THREE.Vector3(0, 0, 1), gnC = new THREE.Color();
  const GN_KINDS = { pistol: 1, revolver: 1, smg: 1, shotgun: 1, sniper: 1, bazooka: 1 };
  const gnIsGun = k => !!GN_KINDS[k];
  const gnOn = () => typeof GUNS !== 'undefined' && GUNS.on();
  const gnCanvasT = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

  // ================= the guns (side view: +x = muzzle, +y = top, grip at the origin) =================
  // Each gun is merged into one mesh per material (+ one per moving part), geometry cached per kind, so a
  // held gun costs 3-6 draw calls, not 25.
  const gnMat = {};
  function gnMats() {
    if (gnMat.steel) return gnMat;
    const std = (c, m, r, o) => { const x = new THREE.MeshStandardMaterial(Object.assign({ color: c, metalness: m, roughness: r }, o || {})); if (V3.rimify) V3.rimify(x); x.userData.shared = true; return x; };
    gnMat.steel = std(0x4a5160, 0.85, 0.34);      // gunmetal, a touch light so the silhouette reads on dark stages
    gnMat.blued = std(0x252a34, 0.9, 0.3);
    gnMat.chrome = std(0xd4d9e2, 1, 0.16);
    gnMat.poly = std(0x1c1f25, 0.25, 0.62);
    gnMat.wood = std(0x8a4a24, 0.05, 0.55);
    gnMat.woodD = std(0x4e2c16, 0.05, 0.6);
    gnMat.dark = std(0x0e1014, 0.5, 0.5);
    gnMat.brass = std(0xd9a441, 1, 0.3);
    gnMat.lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.95, 1.4) }); gnMat.lens.userData.shared = true;
    return gnMat;
  }
  // geometry builder: add primitives with a transform, then merge per material
  function gnKit() {
    const parts = new Map();
    const add = (mat, geo, x, y, z, rz, ry, rx) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      gnM4.makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)); gnM4.setPosition(x || 0, y || 0, z || 0);
      g.applyMatrix4(gnM4); if (!g.attributes.normal) g.computeVertexNormals();
      (parts.get(mat) || parts.set(mat, []).get(mat)).push(g);
    };
    const box = (mat, w, h, d, x, y, z, rz) => add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rz);
    const cylX = (mat, r, len, x, y, z, seg) => add(mat, new THREE.CylinderGeometry(r, r, len, seg || 14), x, y, z, Math.PI / 2);
    const cone = (mat, r0, r1, len, x, y, z) => add(mat, new THREE.CylinderGeometry(r1, r0, len, 14), x, y, z, Math.PI / 2);
    const merge = () => {
      const out = [];
      for (const [mat, gs] of parts) {
        let n = 0; for (const g of gs) n += g.attributes.position.count;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
        for (const g of gs) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
        const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        G.computeBoundingSphere(); G.userData.shared = true; out.push([G, mat]);
      }
      return out;
    };
    return { box, cylX, cone, add, merge };
  }
  const gnGeo = {};   // kind -> { body: [[geo, mat]...], parts: {name: [[geo, mat]...]}, muzzle, port, len }
  function gnBuild(kind) {
    if (gnGeo[kind]) return gnGeo[kind];
    const M = gnMats(), B = gnKit(), P = {}, part = name => (P[name] = gnKit());
    let muzzle, port, len, grip = 0;
    if (kind === 'pistol') {
      const S = part('slide');
      S.box(M.steel, 0.3, 0.07, 0.056, 0.085, 0.066, 0);
      for (let i = 0; i < 5; i++) S.box(M.dark, 0.006, 0.062, 0.058, -0.035 + i * 0.012, 0.066, 0);
      S.box(M.dark, 0.014, 0.018, 0.02, 0.225, 0.108, 0); S.box(M.dark, 0.016, 0.018, 0.05, -0.052, 0.108, 0);
      S.box(M.dark, 0.06, 0.022, 0.058, 0.1, 0.086, 0.001);                              // ejection port
      B.box(M.poly, 0.25, 0.046, 0.05, 0.075, 0.016, 0);
      B.cylX(M.dark, 0.014, 0.02, 0.24, 0.066, 0);
      B.box(M.poly, 0.075, 0.16, 0.052, -0.012, -0.06, 0, -0.2);
      for (let i = 0; i < 4; i++) B.box(M.dark, 0.077, 0.006, 0.054, -0.006 - i * 0.008, -0.02 - i * 0.03, 0, -0.2);
      B.box(M.dark, 0.08, 0.014, 0.054, -0.03, -0.14, 0, -0.2);
      B.add(M.poly, new THREE.TorusGeometry(0.032, 0.007, 6, 12, Math.PI), 0.05, -0.012, 0, Math.PI);
      B.box(M.steel, 0.008, 0.028, 0.012, 0.048, -0.012, 0);
      muzzle = [0.25, 0.066, 0]; port = [0.1, 0.1, 0.03]; len = 0.3;
    } else if (kind === 'revolver') {
      B.cylX(M.chrome, 0.021, 0.25, 0.2, 0.072, 0, 16);
      B.box(M.chrome, 0.24, 0.016, 0.02, 0.2, 0.095, 0);                                // top rib
      B.box(M.dark, 0.012, 0.02, 0.008, 0.315, 0.104, 0);                                // front sight
      B.box(M.chrome, 0.12, 0.09, 0.045, 0.03, 0.058, 0);                                // frame
      const C = part('cyl');
      C.cylX(M.chrome, 0.043, 0.074, 0, 0, 0, 18);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; C.cylX(M.dark, 0.009, 0.076, 0, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 8); }
      const Hm = part('hammer'); Hm.box(M.blued, 0.03, 0.04, 0.014, 0, 0.018, 0, 0.5);
      B.box(M.wood, 0.066, 0.15, 0.052, -0.05, -0.05, 0, -0.38);
      B.box(M.woodD, 0.07, 0.02, 0.054, -0.085, -0.115, 0, -0.38);
      B.add(M.chrome, new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), 0.02, -0.004, 0, Math.PI);
      muzzle = [0.325, 0.072, 0]; port = null; len = 0.33;
      P.cyl.at = [0.03, 0.058, 0]; P.hammer.at = [-0.03, 0.09, 0];
    } else if (kind === 'smg') {
      const S = part('slide'); S.box(M.dark, 0.05, 0.02, 0.064, 0.09, 0.07, 0.002);        // the bolt, seen through the port
      B.box(M.steel, 0.27, 0.08, 0.06, 0.06, 0.05, 0);
      B.box(M.dark, 0.2, 0.012, 0.03, 0.06, 0.096, 0);                                   // rail
      B.box(M.dark, 0.02, 0.028, 0.02, 0.17, 0.108, 0); B.box(M.dark, 0.02, 0.028, 0.02, -0.04, 0.108, 0);
      B.cylX(M.blued, 0.024, 0.13, 0.26, 0.05, 0, 14);
      B.cylX(M.dark, 0.017, 0.03, 0.335, 0.05, 0, 12);
      B.box(M.blued, 0.042, 0.17, 0.036, 0.075, -0.07, 0, 0.12);                          // magazine
      B.box(M.poly, 0.06, 0.13, 0.05, -0.035, -0.045, 0, -0.25);
      B.box(M.steel, 0.2, 0.014, 0.012, -0.16, 0.06, 0.022); B.box(M.steel, 0.2, 0.014, 0.012, -0.16, 0.06, -0.022);
      B.box(M.poly, 0.02, 0.085, 0.058, -0.265, 0.045, 0);
      muzzle = [0.352, 0.05, 0]; port = [0.09, 0.095, 0.035]; len = 0.36;
    } else if (kind === 'shotgun') {
      B.cylX(M.blued, 0.021, 0.5, 0.29, 0.056, 0, 14);
      B.cylX(M.blued, 0.017, 0.36, 0.22, 0.016, 0, 12);
      B.add(M.chrome, new THREE.SphereGeometry(0.008, 8, 6), 0.53, 0.08, 0);
      const Pm = part('pump');
      Pm.cylX(M.wood, 0.03, 0.15, 0, 0, 0, 16);
      for (let i = 0; i < 4; i++) Pm.cylX(M.woodD, 0.031, 0.008, -0.05 + i * 0.033, 0, 0, 16);
      P.pump.at = [0.19, 0.022, 0];
      B.box(M.blued, 0.15, 0.08, 0.056, 0.0, 0.045, 0);
      B.box(M.dark, 0.05, 0.022, 0.058, 0.02, 0.06, 0.001);
      B.box(M.wood, 0.1, 0.075, 0.05, -0.09, 0.012, 0, 0.35);                             // wrist
      B.box(M.wood, 0.22, 0.09, 0.052, -0.22, -0.012, 0, 0.12);                           // stock
      B.box(M.dark, 0.022, 0.1, 0.054, -0.33, -0.026, 0, 0.12);                           // butt pad
      B.add(M.blued, new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), -0.01, 0.0, 0, Math.PI);
      muzzle = [0.545, 0.056, 0]; port = [0.02, 0.075, 0.035]; len = 0.55;
    } else if (kind === 'sniper') {
      B.cylX(M.blued, 0.015, 0.6, 0.44, 0.058, 0, 12);
      B.cylX(M.dark, 0.022, 0.06, 0.76, 0.058, 0, 12);                                   // muzzle brake
      B.cylX(M.steel, 0.028, 0.22, 0.05, 0.058, 0, 16);                                  // receiver
      B.cylX(M.dark, 0.022, 0.26, 0.07, 0.125, 0, 16);                                   // scope tube
      B.cone(M.dark, 0.031, 0.022, 0.05, 0.215, 0.125, 0); B.cone(M.dark, 0.022, 0.028, 0.04, -0.075, 0.125, 0);
      B.box(M.dark, 0.016, 0.04, 0.02, 0.13, 0.092, 0); B.box(M.dark, 0.016, 0.04, 0.02, 0.01, 0.092, 0);
      B.box(M.poly, 0.34, 0.075, 0.05, -0.2, 0.024, 0, 0.06);
      B.box(M.poly, 0.1, 0.035, 0.052, -0.2, 0.072, 0);                                   // cheek rest
      B.box(M.poly, 0.055, 0.12, 0.048, -0.03, -0.04, 0, -0.28);
      B.box(M.dark, 0.022, 0.1, 0.054, -0.37, 0.018, 0, 0.06);
      B.box(M.dark, 0.3, 0.01, 0.01, 0.46, 0.028, 0.012); B.box(M.dark, 0.3, 0.01, 0.01, 0.46, 0.028, -0.012);   // folded bipod
      const Bo = part('bolt'); Bo.cylX(M.steel, 0.006, 0.05, 0, 0, 0.026, 8); Bo.add(M.steel, new THREE.SphereGeometry(0.012, 10, 8), -0.004, -0.004, 0.05);
      P.bolt.at = [0.0, 0.06, 0];
      B.add(M.lens, new THREE.CircleGeometry(0.02, 16), 0.24, 0.125, 0, 0, Math.PI / 2);   // front lens (the glint)
      muzzle = [0.795, 0.058, 0]; port = [0.07, 0.09, 0.035]; len = 0.8;
    } else if (kind === 'bazooka') {
      const olive = new THREE.MeshStandardMaterial({ color: 0x566a3e, roughness: 0.6, metalness: 0.2 }); if (V3.rimify) V3.rimify(olive); olive.userData.shared = true;
      B.cylX(olive, 0.052, 0.8, 0.14, 0.09, 0, 18);
      B.cylX(M.dark, 0.062, 0.05, 0.54, 0.09, 0, 18); B.cylX(M.dark, 0.058, 0.08, -0.25, 0.09, 0, 18);
      B.cylX(M.brass, 0.056, 0.02, 0.2, 0.09, 0, 18);
      B.box(M.dark, 0.035, 0.1, 0.04, 0.02, 0.0, 0, -0.15); B.box(M.dark, 0.035, 0.09, 0.04, 0.2, 0.01, 0, -0.1);
      B.box(M.dark, 0.05, 0.04, 0.02, 0.05, 0.155, 0);
      muzzle = [0.57, 0.09, 0]; port = null; len = 0.8;
    }
    const out = { body: B.merge(), parts: {}, muzzle: new THREE.Vector3(...muzzle), port: port ? new THREE.Vector3(...port) : null, len };
    for (const [n, K] of Object.entries(P)) out.parts[n] = { mesh: K.merge(), at: K.at || [0, 0, 0] };
    return (gnGeo[kind] = out);
  }
  // an instance of a gun: side-view group turned so the muzzle is +Y and the grip is +X (92's prop convention)
  function gnMake(kind, inner, outer) {
    const G = gnBuild(kind), sv = new THREE.Group();
    sv.rotation.z = Math.PI / 2;
    for (const [geo, mat] of G.body) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; sv.add(m); }
    const parts = {};
    for (const [n, p] of Object.entries(G.parts)) {
      const g = new THREE.Group(); g.position.set(...p.at);
      for (const [geo, mat] of p.mesh) { const m = new THREE.Mesh(geo, mat); m.castShadow = false; g.add(m); }
      sv.add(g); parts[n] = g;
    }
    inner.add(sv);
    outer.userData.gn = { kind, sv, parts, muzzle: G.muzzle, port: G.port, len: G.len };
    return true;
  }
  if (V3.makeProp2) {
    const gnMP = V3.makeProp2;
    V3.makeProp2 = function (kind, inner, outer) {
      if (gnIsGun(kind)) { try { return gnMake(kind, inner, outer); } catch (e) { V3.fxErr(e, '9g_guns:169'); /* fall back to the old toy prop */ } }
      return gnMP.call(this, kind, inner, outer);
    };
  }

  // ================= pooled effects =================
  function gnGradT(fn, w, h) { return gnCanvasT(w, h, (c, W, H) => { const d = c.createImageData(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x / (W - 1), y / (H - 1)), i = (y * W + x) * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.max(0, Math.min(255, v * 255)); d.data[i + 3] = 255; } c.putImageData(d, 0, 0); }); }
  let gnFX = null;
  function gnInit() {
    if (gnFX) return gnFX;
    const PL = new THREE.PlaneGeometry(1, 1);
    const addMat = map => new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    const inst = (mat, n, order) => { const m = new THREE.InstancedMesh(PL, mat, n); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); m.count = 0; m.frustumCulled = false; m.renderOrder = order || 6; V3.scene.add(m); return m; };
    // tracer: bright hot head, fading tail, soft across
    const trT = gnGradT((u, v) => { const a = Math.pow(u, 1.6), c = Math.exp(-Math.pow((v - 0.5) * 5.2, 2)); return a * c * 1.1 + Math.pow(u, 8) * c * 0.6; }, 128, 16);
    // flash core: a hard white star with short spikes
    const stT = gnCanvasT(128, 128, (c, W) => {
      c.translate(W / 2, W / 2); const g = c.createRadialGradient(0, 0, 0, 0, 0, W / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,240,200,.95)'); g.addColorStop(0.5, 'rgba(255,170,60,.35)'); g.addColorStop(1, 'rgba(255,120,20,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, W / 2, 0, 7); c.fill(); c.fillStyle = 'rgba(255,250,230,.95)';
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + Math.random() * 0.4, L = W * (0.3 + Math.random() * 0.2); c.beginPath(); c.moveTo(Math.cos(a - 0.12) * 6, Math.sin(a - 0.12) * 6); c.lineTo(Math.cos(a) * L, Math.sin(a) * L); c.lineTo(Math.cos(a + 0.12) * 6, Math.sin(a + 0.12) * 6); c.fill(); }
    });
    // flash cone: a flame tongue along +x, white root to orange tip
    const coT = gnGradT((u, v) => { const w = 0.5 * (1 - u) * (1 - u * 0.4) + 0.02; const d = Math.abs(v - 0.5); return d > w ? 0 : Math.pow(1 - d / w, 1.3) * (1 - Math.pow(u, 2.2)) * 1.25; }, 128, 64);
    // spark streak
    const spT = gnGradT((u, v) => Math.pow(u, 0.7) * Math.exp(-Math.pow((v - 0.5) * 4.5, 2)) * 1.2, 64, 16);
    const F = gnFX = {
      tr: inst(addMat(trT), 96, 7), trN: 0, trs: [],
      core: inst(addMat(stT), 24, 8), cone: inst(addMat(coT), 32, 8), fl: [],
      sp: inst(addMat(spT), 240, 7), sps: [],
      cas: null, cass: [], smoke: null, sms: [],
    };
    // casings: one instanced brass cylinder, shotgun hulls tinted red
    const cg = new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10);
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.25, emissive: 0x3a2a0a, emissiveIntensity: 0.9 });
    F.cas = new THREE.InstancedMesh(cg, cm, 64); F.cas.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3); F.cas.count = 0; F.cas.frustumCulled = false; F.cas.castShadow = false; V3.scene.add(F.cas);
    // smoke + dust: one point cloud, normal blend, soft
    const N = 220, geo = new THREE.BufferGeometry();
    F.smP = new Float32Array(N * 3); F.smC = new Float32Array(N * 3); F.smS = new Float32Array(N); F.smA = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(F.smP, 3)); geo.setAttribute('color', new THREE.BufferAttribute(F.smC, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(F.smS, 1)); geo.setAttribute('alpha', new THREE.BufferAttribute(F.smA, 1));
    const smT = gnCanvasT(64, 64, (c, W) => { for (let i = 0; i < 5; i++) { const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 14 + Math.random() * 14, g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, W); } });
    smT.colorSpace = THREE.NoColorSpace;
    F.smoke = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true, uniforms: { map: { value: smT }, scale: { value: 800 } },
      vertexShader: 'attribute float size; attribute float alpha; varying vec3 vc; varying float va; uniform float scale; void main(){ vc = color; va = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vc; varying float va; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vc, t.a * va); }',
    }));
    F.smoke.frustumCulled = false; F.smoke.renderOrder = 5; V3.scene.add(F.smoke); F.smN = N;
    // the EMPTY - THROW IT hint, one per fighter slot
    F.hintT = gnCanvasT(512, 96, (c, W, H) => {
      c.font = 'italic 900 50px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 12; c.strokeStyle = 'rgba(10,6,4,.95)'; c.strokeText('EMPTY · THROW IT', W / 2, H / 2 + 2);
      c.fillStyle = '#ffd45c'; c.fillText('EMPTY · THROW IT', W / 2, H / 2 + 2);
    });
    F.hints = [0, 1, 2, 3].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: F.hintT, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); s.renderOrder = 19; s.visible = false; s.scale.set(1.0, 0.19, 1); V3.scene.add(s); return s; });
    // the sniper's laser sight (one per fighter slot)
    F.lasers = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(PL, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide })); m.visible = false; m.renderOrder = 7; V3.scene.add(m); return m; });
    return F;
  }

  // ---- per-kind looks
  const GN_LOOK = {
    //          flash core, cone len, cone w, light, tracer w, tracer life, smoke puffs, casing
    pistol:   { core: 0.24, cone: 0.32, cw: 0.14, light: 14, tw: 0.017, tl: 6, smoke: 2, cas: 'b', kick: 0.3, back: 0.035 },
    revolver: { core: 0.4, cone: 0.5, cw: 0.24, light: 22, tw: 0.022, tl: 8, smoke: 4, cas: null, kick: 0.62, back: 0.06 },
    shotgun:  { core: 0.46, cone: 0.62, cw: 0.34, light: 26, tw: 0.009, tl: 5, smoke: 6, cas: 'h', kick: 0.55, back: 0.08 },
    smg:      { core: 0.2, cone: 0.28, cw: 0.12, light: 10, tw: 0.014, tl: 4, smoke: 1, cas: 'b', kick: 0.14, back: 0.022 },
    sniper:   { core: 0.46, cone: 0.8, cw: 0.3, light: 28, tw: 0.03, tl: 22, smoke: 5, cas: 'B', kick: 0.5, back: 0.09 },
    bazooka:  { core: 0.5, cone: 0.5, cw: 0.34, light: 22, tw: 0, tl: 0, smoke: 10, cas: null, kick: 0.25, back: 0.05, backblast: true },
  };

  // ---- helpers
  const gnAv = f => (V3._avatars ? V3._avatars.get(f) : null);
  // side 1 = the akimbo off hand (6h_akimbo.js). The flash, the smoke and the ejected case all start
  // from the gun that fired, so they have to be able to ask for the left one.
  const gnGun = (f, side) => { const av = gnAv(f), it = f && f.item; if (!av || !av.held || !it) return null;
    const m = av.held[side && it.dual ? it.kind + '#L' : it.kind]; return m && m.visible && m.userData.gn ? m : null; };
  // which hand fired the shot being drawn: 6h_akimbo writes it onto the gun move as gnHand
  const gnHandOf = f => { const mv = f && f.move; return (f && f.item && f.item.dual && mv && mv.gnHand) ? 1 : 0; };
  function gnMuzzleWorld(f, out, side) {
    const m = gnGun(f, side); if (!m) return null;
    const u = m.userData.gn; m.updateMatrixWorld(true);
    return u.sv.localToWorld(out.copy(u.muzzle));
  }
  const gnFloorY = x => {   // world y of the highest walkable surface under world x (for casings)
    const st = Game.stage, px = x / SC; let best = -1e9;
    if (px >= st.main.x0 && px <= st.main.x1 && !(Game.holes.length && Items2.inHole(px))) best = -st.main.top * SC;
    return best;
  };
  function gnSurfBelow(x, y) {   // the first surface at or below world y
    const st = Game.stage, px = x / SC, py = -y / SC; let top = null;
    if (px >= st.main.x0 && px <= st.main.x1 && py <= st.main.top + 2 && !(Game.holes.length && Items2.inHole(px))) top = st.main.top;
    for (const p of st.plats) if (px >= p.x0 && px <= p.x1 && py <= p.y + 2 && (top == null || p.y < top)) top = p.y;
    return top == null ? null : -top * SC;
  }

  // ---- spawners (all reuse pool slots)
  function gnSpark(x, y, z, vx, vy, life, col, w) {
    const F = gnFX; if (F.sps.length >= 240) F.sps.shift();
    F.sps.push({ x, y, z, vx, vy, t: -gnDk, life, c: col, w: w || 1 });
  }
  function gnSmoke(x, y, z, vx, vy, size, life, grey, a) {
    const F = gnFX; if (F.sms.length >= F.smN) F.sms.shift();
    F.sms.push({ x, y, z, vx, vy, s: size, t: -gnDk, life, g: grey, a: a == null ? 0.55 : a });
  }
  function gnTracer(x0, y0, z, x1, y1, w, life, hot) {
    const F = gnFX; if (F.trs.length >= 90) F.trs.shift();
    F.trs.push({ x0, y0, z, x1, y1, w, life, t: -gnDk, hot: hot || 1 });
  }
  function gnFlash(x, y, z, ax, ay, L) {
    const F = gnFX; if (F.fl.length >= 20) F.fl.shift();
    F.fl.push({ x, y, z, ax, ay, L, t: -gnDk, rot: Math.random() * 6.28 });
  }
  function gnCasing(f, m, L) {
    const F = gnFX, u = m.userData.gn; if (!u.port || !L.cas) return;
    m.updateMatrixWorld(true); const p = u.sv.localToWorld(gnV3.copy(u.port));
    if (F.cass.length >= 64) F.cass.shift();
    const big = L.cas === 'B', hull = L.cas === 'h';
    F.cass.push({ x: p.x, y: p.y, z: p.z + 0.04, vx: -f.face * (0.012 + Math.random() * 0.012), vy: 0.036 + Math.random() * 0.016, vz: 0.016 + Math.random() * 0.012,
      rx: Math.random() * 6, rz: Math.random() * 6, sx: (Math.random() - 0.5) * 0.9, sz: (Math.random() - 0.5) * 0.9, t: 0, rest: 0, hops: 0,
      s: big ? 1.55 : hull ? 1.9 : 1, hull, col: hull ? [0.72, 0.13, 0.1] : [1, 0.72, 0.3] });
  }

  // ---- per-fighter shot memory (for the gun's kick, the slide, and matching tracers to the real muzzle)
  const gnShot = [{}, {}, {}, {}];
  let gnCur = -1, gnNow = 0, gnFrameN = 0, gnDk = 0;   // gnDk: this render's tick step (new effects start at t = -gnDk so they show at full strength first)
  function gnEvents() {
    if (typeof GUNS === 'undefined') return;
    const top = GUNS.seq; if (gnCur < 0) gnCur = top;
    if (top - gnCur > GUNS.N_EV - 1) gnCur = top - (GUNS.N_EV - 1);
    for (let s = gnCur + 1; s <= top; s++) { const e = GUNS.ev[s & (GUNS.N_EV - 1)]; if (e.seq === s) { try { gnEvent(e); } catch (err) { /* cosmetic */ } } }
    gnCur = top;
  }
  const gnW = (x, y) => [x * SC, -y * SC];
  function gnEvent(e) {
    const F = gnFX, f = e.f >= 0 ? Game.fighters[e.f] : null, L = GN_LOOK[e.k] || GN_LOOK.pistol;
    const z0 = f ? (f.idx - 1.5) * 0.06 + 0.32 : 0.35;
    switch (e.type) {
      case 'shot': {
        let [x, y] = gnW(e.x, e.y), z = z0;
        const hand = gnHandOf(f);
        const m = f && gnGun(f, hand);
        if (m && gnMuzzleWorld(f, gnV, hand)) { x = gnV.x; y = gnV.y; z = gnV.z; }
        const ax = e.ax, ay = -e.ay;                                   // world: y up
        gnFlash(x, y, z, ax, ay, L);
        if (L.backblast) { gnFlash(x - ax * 0.75, y - ay * 0.75, z, -ax, -ay, { core: 0.3, cone: 0.5, cw: 0.3 }); for (let i = 0; i < 6; i++) gnSmoke(x - ax * 0.8, y - ay * 0.8, z, -ax * 0.02 + (Math.random() - 0.5) * 0.01, 0.004 + Math.random() * 0.006, 0.3 + Math.random() * 0.2, 60 + Math.random() * 30, 0.8, 0.5); }
        for (let i = 0; i < L.smoke; i++) gnSmoke(x + ax * 0.04 * i, y + ay * 0.04 * i, z, ax * (0.002 + Math.random() * 0.004) + (Math.random() - 0.5) * 0.002, 0.002 + Math.random() * 0.003, 0.05 + Math.random() * 0.05 + (e.k === 'shotgun' ? 0.05 : 0), 40 + Math.random() * 30, 0.78, 0.3);
        if (m && !GN_ACTION_EJECT[e.k]) gnCasing(f, m, L);
        if (typeof hitLight !== 'undefined' && hitLight) { hitLight.position.set(x + ax * 0.2, y + ay * 0.2, z + 0.4); hitLight.color.setRGB(1, 0.78, 0.45); hitLight.intensity = Math.max(hitLight.intensity, L.light * 0.5); }   // halved with the hit light (white-outs)
        if (f) { const S = gnShot[f.idx]; S.t = gnNow; S.k = e.k; S.x = x; S.y = y; S.z = z; S.n = (S.n || 0) + 1; S.ax = ax; S.ay = ay; S.hand = hand; }
        break;
      }
      case 'trace': {
        if (!L.tw) break;
        let [x0, y0] = gnW(e.x, e.y), z = z0; const [x1, y1] = gnW(e.ax, e.ay);
        const S = f && gnShot[f.idx];
        if (S && gnNow - S.t < 90 && S.k === e.k) { x0 = S.x; y0 = S.y; z = S.z; }   // start at the gun's real muzzle
        const pel = e.v === 1;
        gnTracer(x0, y0, z, x1, y1, pel ? 0.007 : L.tw, pel ? 5 : L.tl, e.k === 'sniper' ? 1.6 : 1);
        if (e.k === 'sniper') { const n = 14; for (let i = 1; i <= n; i++) { const k = i / n; gnSmoke(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z, 0, 0.001, 0.07, 55 + i * 2, 0.9, 0.22); } }
        break;
      }
      case 'imp': {
        const [x, y] = gnW(e.x, e.y), nx = e.ax, ny = -e.ay, heavy = e.k === 'sniper' ? 2 : e.k === 'revolver' ? 1.4 : e.k === 'shotgun' ? 0.6 : 1;
        const n = Math.round(5 * heavy) + 2;
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.2, s = (0.02 + Math.random() * 0.045) * (0.7 + heavy * 0.3);
          gnSpark(x, y, 0.34, Math.cos(a) * s, Math.sin(a) * s, 8 + Math.random() * 10, Math.random() < 0.5 ? 0 : 1, 0.8);
        }
        for (let i = 0; i < Math.round(2 * heavy) + 1; i++) gnSmoke(x + (Math.random() - 0.5) * 0.04, y + 0.02, 0.36, nx * 0.004 + (Math.random() - 0.5) * 0.004, 0.003 + Math.random() * 0.004 + ny * 0.003, 0.08 + Math.random() * 0.06 * heavy, 30 + Math.random() * 25, 0.62, 0.6);
        gnFlash(x, y, 0.36, nx, ny, { core: 0.08 * heavy + 0.05, cone: 0, cw: 0 });
        break;
      }
      case 'hit': case 'shld': {
        const [x, y] = gnW(e.x, e.y), L2 = Math.hypot(e.ax, e.ay) || 1, dx = e.ax / L2, dy = -e.ay / L2;
        const heavy = e.k === 'sniper' ? 2.2 : e.k === 'revolver' ? 1.5 : e.k === 'shotgun' ? 1.3 : e.k === 'smg' ? 0.6 : 1;
        const n = Math.round(6 * heavy) + 2;
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * (e.type === 'shld' ? 2.8 : 1.3) + (e.type === 'shld' ? Math.PI : 0), s = (0.025 + Math.random() * 0.05) * (0.6 + heavy * 0.4);
          gnSpark(x, y, z0 + 0.1, Math.cos(a) * s, Math.sin(a) * s, 7 + Math.random() * 9, e.type === 'shld' ? 2 : Math.random() < 0.7 ? 0 : 1, 1);
        }
        gnFlash(x, y, z0 + 0.12, dx, dy, { core: 0.12 + 0.08 * heavy, cone: 0.1 * heavy, cw: 0.08 * heavy });
        break;
      }
      case 'blast': {
        const [x, y] = gnW(e.x, e.y);
        for (let i = 0; i < 22; i++) { const a = Math.atan2(0, e.ax) + (Math.random() - 0.5) * 1.8, s = 0.03 + Math.random() * 0.07; gnSpark(x, y, z0 + 0.1, Math.cos(a) * s, Math.sin(a) * s, 10 + Math.random() * 10, Math.random() < 0.6 ? 0 : 1, 1.2); }
        for (let i = 0; i < 6; i++) gnSmoke(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z0, e.ax * 0.006 + (Math.random() - 0.5) * 0.006, 0.004, 0.18 + Math.random() * 0.12, 50, 0.8, 0.5);
        break;
      }
      case 'bonk': {
        const [x, y] = gnW(e.x, e.y);
        for (let i = 0; i < 10; i++) { const a = Math.random() * 6.283, s = 0.02 + Math.random() * 0.03; gnSpark(x, y, 0.5, Math.cos(a) * s, Math.sin(a) * s + 0.01, 12 + Math.random() * 8, Math.random() < 0.5 ? 1 : 3, 1.1); }
        gnFlash(x, y, 0.5, 1, 0, { core: 0.32, cone: 0, cw: 0 });
        break;
      }
      case 'clat': {
        const [x, y] = gnW(e.x, e.y);
        for (let i = 0; i < 3; i++) gnSpark(x, y, 0.35, (Math.random() - 0.5) * 0.04, 0.01 + Math.random() * 0.02, 8, 1, 0.7);
        gnSmoke(x, y + 0.02, 0.36, 0, 0.003, 0.07, 30, 0.7, 0.4);
        break;
      }
      case 'mech': if (f) { const S = gnShot[f.idx]; S.mech = e.k; S.mt = gnNow; } break;
      case 'wind': if (f) { const S = gnShot[f.idx]; S.wind = gnNow; } break;
      case 'lock': if (f) { gnShot[f.idx].lock = gnNow; } break;
    }
  }

  // ---- per-frame updates of every pool
  const GN_SPC = [[1, 0.86, 0.5], [1, 0.97, 0.85], [0.55, 0.9, 1], [1, 0.8, 0.3]];   // spark colours: hot, white, shield blue, gold
  function gnPools(dk) {
    const F = gnFX, cam = V3.camera;
    // tracers
    let n = 0;
    for (let i = F.trs.length - 1; i >= 0; i--) { const r = F.trs[i]; r.t += dk; if (r.t >= r.life) F.trs.splice(i, 1); }
    for (const r of F.trs) {
      if (n >= 96) break;
      const dx = r.x1 - r.x0, dy = r.y1 - r.y0, L = Math.hypot(dx, dy); if (L < 1e-4) continue;
      const k = 1 - r.t / r.life, w = r.w * (0.55 + 0.45 * k);
      gnV.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.z); gnQ.setFromAxisAngle(gnZ, Math.atan2(dy, dx)); gnS.set(L, w, 1);
      gnM4.compose(gnV, gnQ, gnS); F.tr.setMatrixAt(n, gnM4);
      gnC.setRGB(2.2 * r.hot, 1.8 * r.hot, 1.05 * r.hot).multiplyScalar(k * (0.4 + 0.6 * k)); F.tr.setColorAt(n, gnC); n++;
    }
    // live rounds still in flight: the segment they covered last step, hot
    for (const p of Game.projs) {
      if (!p.gn || p.kind === 'rocket' || n >= 96) continue;
      // the fight's muzzle and the 3D gun's muzzle are a few cm apart: start the streak at the real
      // muzzle and fold that offset away over the first 2.5 m, so the line leaves the barrel
      let off = gnOff.get(p);
      if (!off) { const S = p.owner && gnShot[p.owner.idx]; off = S && S.k === p.gn && gnNow - S.t < 4 ? [S.x - p.x0 * SC, S.y + p.y0 * SC] : [0, 0]; gnOff.set(p, off); }
      const oa = (x, y) => Math.max(0, 1 - Math.hypot(x - p.x0, y - p.y0) * SC / 2.5);
      const qx0 = p.px != null ? p.px : p.x0, qy0 = p.py != null ? p.py : p.y0, k0 = oa(qx0, qy0), k1 = oa(p.x, p.y);
      const x0 = qx0 * SC + off[0] * k0, y0 = -qy0 * SC + off[1] * k0, x1 = p.x * SC + off[0] * k1, y1 = -p.y * SC + off[1] * k1, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L < 1e-4) continue;
      const lk = GN_LOOK[p.gn] || GN_LOOK.pistol, z = p.owner ? (p.owner.idx - 1.5) * 0.06 + 0.32 : 0.35;
      gnV.set((x0 + x1) / 2, (y0 + y1) / 2, z); gnQ.setFromAxisAngle(gnZ, Math.atan2(dy, dx)); gnS.set(L, (p.pellet ? 0.008 : lk.tw || 0.012) * 1.25, 1);
      gnM4.compose(gnV, gnQ, gnS); F.tr.setMatrixAt(n, gnM4); gnC.setRGB(2, 1.7, 1.1); F.tr.setColorAt(n, gnC); n++;
    }
    F.tr.count = n; F.tr.instanceMatrix.needsUpdate = true; if (F.tr.instanceColor) F.tr.instanceColor.needsUpdate = true;
    // muzzle flashes: frame 1 full, frame 2 bigger + dimmer, gone by 3
    let nc = 0, no = 0;
    for (let i = F.fl.length - 1; i >= 0; i--) { F.fl[i].t += dk; if (F.fl[i].t >= 3) F.fl.splice(i, 1); }
    for (const q of F.fl) {
      const k = q.t < 1 ? 1 : q.t < 2 ? 0.55 : 0.2, grow = 1 + q.t * 0.35, L = q.L;
      if (L.core && nc < 24) {
        gnV.set(q.x, q.y, q.z + 0.01); gnQ.copy(cam.quaternion); gnQ.multiply(gnQ2.setFromAxisAngle(gnZ, q.rot)); gnS.setScalar(L.core * grow);
        gnM4.compose(gnV, gnQ, gnS); F.core.setMatrixAt(nc, gnM4); gnC.setRGB(1.9 * k, 1.6 * k, 1.1 * k); F.core.setColorAt(nc, gnC); nc++;
      }
      if (L.cone && no < 32) {
        const a = Math.atan2(q.ay, q.ax), cl = L.cone * (q.t < 1 ? 1 : 1.25);
        gnV.set(q.x + q.ax * cl * 0.5, q.y + q.ay * cl * 0.5, q.z); gnQ.setFromAxisAngle(gnZ, a); gnS.set(cl, L.cw * (q.t < 1 ? 1 : 0.8), 1);
        gnM4.compose(gnV, gnQ, gnS); F.cone.setMatrixAt(no, gnM4); gnC.setRGB(1.8 * k, 1.3 * k, 0.6 * k); F.cone.setColorAt(no, gnC); no++;
        if (L.core >= 0.3 && no < 32) {                                  // big guns throw side petals
          for (const s of [-1, 1]) { if (no >= 32) break; const b = a + s * 1.1; gnV.set(q.x + Math.cos(b) * cl * 0.2, q.y + Math.sin(b) * cl * 0.2, q.z); gnQ.setFromAxisAngle(gnZ, b); gnS.set(cl * 0.4, L.cw * 0.45, 1); gnM4.compose(gnV, gnQ, gnS); F.cone.setMatrixAt(no, gnM4); gnC.setRGB(1.5 * k, 1 * k, 0.45 * k); F.cone.setColorAt(no, gnC); no++; }
        }
      }
    }
    F.core.count = nc; F.cone.count = no;
    for (const m of [F.core, F.cone]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // sparks: velocity-aligned streaks with a little gravity
    let ns = 0;
    for (let i = F.sps.length - 1; i >= 0; i--) { const p = F.sps[i]; p.t += dk; if (p.t >= p.life) F.sps.splice(i, 1); }
    for (const p of F.sps) {
      p.x += p.vx * dk; p.y += p.vy * dk; p.vy -= 0.0022 * dk; p.vx *= Math.pow(0.95, dk); p.vy *= Math.pow(0.97, dk);
      const k = 1 - p.t / p.life, sp = Math.hypot(p.vx, p.vy) || 0.001;
      gnV.set(p.x, p.y, p.z); gnQ.setFromAxisAngle(gnZ, Math.atan2(p.vy, p.vx)); gnS.set(Math.max(0.02, sp * 2.4) * p.w, 0.012 * p.w * (0.4 + k), 1);
      gnM4.compose(gnV, gnQ, gnS); F.sp.setMatrixAt(ns, gnM4);
      const c = GN_SPC[p.c] || GN_SPC[0]; gnC.setRGB(c[0] * 2 * k, c[1] * 2 * k, c[2] * 2 * k); F.sp.setColorAt(ns, gnC); ns++;
      if (ns >= 240) break;
    }
    F.sp.count = ns; F.sp.instanceMatrix.needsUpdate = true; if (F.sp.instanceColor) F.sp.instanceColor.needsUpdate = true;
    // casings: flip out, spin, bounce (with the tinkle), settle, then sink away
    let nk = 0;
    for (let i = F.cass.length - 1; i >= 0; i--) { const c = F.cass[i]; if (c.t > 240 || c.y < -9) F.cass.splice(i, 1); }
    for (const c of F.cass) {
      c.t += dk;
      if (!c.rest) {
        c.vy -= 0.0036 * dk; c.x += c.vx * dk; c.y += c.vy * dk; c.z += c.vz * dk; c.vz *= Math.pow(0.93, dk);
        c.rx += c.sx * dk; c.rz += c.sz * dk;
        const fy = gnSurfBelow(c.x, c.y + 0.05);
        if (fy != null && c.y < fy + 0.008 && c.vy < 0) {
          c.y = fy + 0.008; const hit = -c.vy;
          if (hit > 0.006 && typeof GunAudio !== 'undefined' && GunAudio) GunAudio.play(c.hull ? 'hull' : 'tink', { x: c.x / SC, vol: Math.min(0.55, 0.12 + hit * 9), limit: 0.018, key: 'tink' + (nk % 3) });
          c.vy = hit * (c.hull ? 0.25 : 0.42); c.vx *= 0.55; c.sx *= 0.5; c.sz *= 0.5; c.hops++;
          if (c.hops > 3 || hit < 0.008) { c.rest = 1; c.vy = 0; c.rz = Math.PI / 2 + (Math.random() - 0.5) * 0.3; c.rx = Math.random() * 6; }
        }
      }
      const fade = c.t > 200 ? Math.max(0.01, 1 - (c.t - 200) / 40) : 1;
      gnV.set(c.x, c.y, c.z); gnQ.setFromEuler(gnE.set(c.rx, 0, c.rz)); gnS.setScalar(c.s * fade);
      gnM4.compose(gnV, gnQ, gnS); F.cas.setMatrixAt(nk, gnM4); gnC.setRGB(c.col[0], c.col[1], c.col[2]); F.cas.setColorAt(nk, gnC); nk++;
    }
    F.cas.count = nk; F.cas.instanceMatrix.needsUpdate = true; if (F.cas.instanceColor) F.cas.instanceColor.needsUpdate = true;
    // smoke + dust
    let nm = 0;
    for (let i = F.sms.length - 1; i >= 0; i--) { const s = F.sms[i]; s.t += dk; if (s.t >= s.life) F.sms.splice(i, 1); }
    for (const s of F.sms) {
      s.x += s.vx * dk; s.y += s.vy * dk; s.vx *= Math.pow(0.97, dk);
      const k = s.t / s.life;
      F.smP[nm * 3] = s.x; F.smP[nm * 3 + 1] = s.y; F.smP[nm * 3 + 2] = s.z;
      F.smC[nm * 3] = s.g; F.smC[nm * 3 + 1] = s.g * 0.97; F.smC[nm * 3 + 2] = s.g * 0.94;
      F.smS[nm] = s.s * (1 + k * 2.2); F.smA[nm] = s.a * Math.min(1, k * 8) * (1 - k); nm++;
    }
    for (let i = nm; i < F.smN; i++) F.smS[i] = 0;
    const g = F.smoke.geometry; for (const a of ['position', 'color', 'size', 'alpha']) g.attributes[a].needsUpdate = true; g.setDrawRange(0, nm);
    try { F.smoke.material.uniforms.scale.value = V3.internals().renderer.getDrawingBufferSize(gnV2d).y / 2 / Math.tan(V3.camera.fov / 2 * Math.PI / 180); } catch (e) {}
  }
  const gnQ2 = new THREE.Quaternion(), gnE = new THREE.Euler(), gnV2d = new THREE.Vector2(), gnOff = new WeakMap();

  // ---- the held gun: point it where the fighter aims (grip down, never upside down), kick, cycle
  function gnAimOf(f) {
    const mv = f.move;
    if (f.state === 'move' && mv && mv.def && mv.def.gun && mv.gnAx != null) return [mv.gnAx, -mv.gnAy];
    if (gnOn() && (f.state === 'ground' || f.state === 'air' || f.state === 'land' || f.state === 'jumpsquat')) {
      const A = GUNS.aimVec(f);
      if (GUNS.mouseOk(f) || f.in.up || (f.in.down && f.air)) return [A[0], -A[1]];
    }
    return null;
  }
  function gnHeld(av) {
    const f = av.f, it = f.item; if (!it || !gnIsGun(it.kind) || f.state === 'dead' || f.state === 'hammer') return;
    gnPose(av, f, it, av.held && av.held[it.kind], 0);
    // AKIMBO (6h_akimbo.js): the off-hand gun gets the same treatment. Its kick is driven off the
    // SAME shot memory, but only when that shot came from this hand -- otherwise both guns buck on
    // every round and akimbo reads as one gun drawn twice.
    if (it.dual) gnPose(av, f, it, av.held && av.held[it.kind + '#L'], 1);
  }
  function gnPose(av, f, it, m, side) {
    if (!m || !m.visible || !m.userData.gn) return;
    const u = m.userData.gn, L = GN_LOOK[it.kind] || GN_LOOK.pistol, S = gnShot[f.idx];
    let a = gnAimOf(f), ax, ay;
    if (a) { ax = a[0]; ay = a[1]; } else if (f.state === 'move' && f.move && f.move.def && f.move.def.throwAnim) { ax = f.face; ay = 0.3; }
    else { ax = f.face * 0.93; ay = -0.36; }                           // low ready
    const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    // kick: the muzzle climbs and the gun comes back toward the hand, recovering over ~8 frames
    const mine = !it.dual || (S.hand | 0) === side;
    const since = mine && S.t != null ? gnNow - S.t : 99, kk = since < 1 ? 0.35 : since < 2 ? 1 : since < 12 ? Math.pow(1 - (since - 2) / 10, 2) : 0;
    if (kk > 0) { const r = L.kick * kk * (ax >= 0 ? 1 : -1), c = Math.cos(r), s = Math.sin(r); const nx = ax * c - ay * s, ny = ax * s + ay * c; ax = nx; ay = ny; }
    const face = ax >= 0 ? 1 : -1, gx = face > 0 ? ay : -ay, gy = face > 0 ? -ax : ax;   // grip: aim turned 90 deg toward the ground
    gnV.set(gx, gy, 0); gnV2.set(ax, ay, 0); gnV3.crossVectors(gnV, gnV2);
    gnM4.makeBasis(gnV, gnV2, gnV3); m.quaternion.setFromRotationMatrix(gnM4);
    if (kk > 0) m.position.addScaledVector(gnV2, -L.back * kk);
    // moving parts
    const P = u.parts;
    // this gun's own rounds: with two guns, `it.ammo` is the hand that fires NEXT (6h_akimbo's
    // invariant) and `it.ammo2` the other, so the wrong one would lock its slide back.
    const myAmmo = !it.dual ? it.ammo : ((it.hand | 0) === side ? it.ammo : it.ammo2);
    if (P.slide) { const back = since < 5 ? (1 - since / 5) : 0, locked = myAmmo <= 0 ? 1 : 0; P.slide.position.x = -(it.kind === 'smg' ? 0.03 : 0.07) * Math.max(back, locked * 0.8); }
    if (P.cyl) { P.cyl.rotation.x = -((S.n || 0) + Math.min(1, since / 6)) * (Math.PI / 3); }
    if (P.hammer) { const mt = S.mech === 'cock' && S.mt != null ? gnNow - S.mt : 99; P.hammer.rotation.z = since < 3 ? 0 : mt < 8 ? 0.6 * (mt / 8) : 0.6; }
    if (P.pump) { const mt = S.mech === 'pump' && S.mt != null ? gnNow - S.mt : 99; const k = mt < 6 ? mt / 6 : mt < 12 ? 1 - (mt - 6) / 6 : 0; P.pump.position.x = 0.19 - 0.09 * k; }
    if (P.bolt) { const mt = S.mech === 'bolt' && S.mt != null ? gnNow - S.mt : 99; const k = mt < 22 ? Math.sin(mt / 22 * Math.PI) : 0; P.bolt.position.x = -0.07 * k; P.bolt.rotation.x = k > 0.1 ? -0.9 : 0; }
    // the pump's ejected hull and the bolt's case come out on the action, not the shot
    if ((P.pump || P.bolt) && S.mech && S.mt != null && gnNow - S.mt >= 5 && S.ejected !== S.mt) { S.ejected = S.mt; gnCasing(f, m, L); }
  }
  // shotgun and sniper eject on the pump / bolt stroke: the shot itself does not (see gnEvent)
  const GN_ACTION_EJECT = { shotgun: 1, sniper: 1 };

  // ---- the gun on the floor / flying through the air
  function gnItems() {
    if (typeof itemMeshes === 'undefined') return;
    for (const it of Game.items) {
      if (!gnIsGun(it.kind)) continue;
      const m = itemMeshes.get(it); if (!m || !m.userData.gn) continue;
      if (it.gnThrow && it.armed) {                                    // spinning end over end, fast
        const ang = -gnNow * 0.55 * (it.spin || 1) - it.age * 0.05;
        m.quaternion.setFromAxisAngle(gnZ, ang);
        if (Math.random() < 0.6) gnSpark(m.position.x, m.position.y, 0.3, -it.vx * SC * 0.2, -it.vy * SC * 0.2, 5, 1, 0.5);
      } else {                                                         // lying on its side, facing the camera
        const face = (it.spin || (it.x > 0 ? -1 : 1)) >= 0 ? 1 : -1;
        gnV.set(0, -1, 0); gnV2.set(face, 0, 0); gnV3.crossVectors(gnV, gnV2);
        gnM4.makeBasis(gnV, gnV2, gnV3); m.quaternion.setFromRotationMatrix(gnM4);
        m.position.x -= face * (m.userData.gn.len * 0.35);
        m.position.y += 0.07;
        // spent guns blink out
        m.visible = !(it.restT > 240 && Math.floor(gnNow / 4) % 2);
      }
    }
  }

  // ---- hints + the sniper's laser sight
  function gnHints() {
    const F = gnFX;
    for (let i = 0; i < 4; i++) {
      const f = Game.fighters[i], h = F.hints[i], las = F.lasers[i];
      const ok = f && f.state !== 'dead' && f.item && gnIsGun(f.item.kind);
      h.visible = !!(ok && !f.cpu && f.item.ammo <= 0 && !Game.demo);
      if (h.visible) { h.position.set(f.x * SC, (-f.y + f.h * 1.62) * SC + Math.sin(gnNow * 0.12) * 0.015, 0.9); h.material.opacity = 0.75 + 0.25 * Math.sin(gnNow * 0.25); }
      // laser: from the scope-in to the shot
      const mv = f && f.move, winding = ok && f.item.kind === 'sniper' && f.state === 'move' && mv && mv.def && mv.def.gun === 'sniper' && mv.shotT < 0;
      las.visible = false;
      if (winding && gnMuzzleWorld(f, gnV)) {
        const ax = mv.gnAx, ay = -mv.gnAy, Lz = 14;
        las.visible = true; las.position.set(gnV.x + ax * Lz / 2, gnV.y + ay * Lz / 2, gnV.z); las.rotation.set(0, 0, Math.atan2(ay, ax));
        las.scale.set(Lz, 0.006 + Math.random() * 0.003, 1);
        las.material.opacity = 0.5 + 0.4 * Math.min(1, mv.t / 10);
        // and the lens glints at the victim: a flash on the scope every few frames
        if (mv.t % 5 === 0) gnFlash(gnV.x - ax * 0.55, gnV.y - ay * 0.55 + 0.07, gnV.z + 0.02, ax, ay, { core: 0.16, cone: 0, cw: 0 });
      }
    }
  }

  // ================= local-only mouse aim + crosshair =================
  const MOUSE_IDLE = 1100;   // ms of stillness after which the pointer stops owning the aim
  const gnMouse = { x: -1, y: -1, moved: 0, over: false, down: false, match: null };
  function gnP1() {
    if (!Game.fighters) return null;
    for (const f of Game.fighters) if (f.ctrl === 'kb1' && !f.cpu) return f;
    return null;
  }
  function gnMouseOk() {
    return typeof GUNS !== 'undefined' && Game.state === 'match' && !Game.demo && !Game.paused && gnOn() && GUNS.local(Game);
  }
  function gnMouseFrame() {
    if (typeof GUNS === 'undefined') return;
    if (gnMouse.match !== Game.fighters) { gnMouse.match = Game.fighters; gnMouse.moved = 0; }
    // THE MOUSE ONLY AIMS WHILE IT IS BEING USED.
    //
    // `gnMouse.moved` used to be a flag set by the FIRST mousemove over the canvas and never cleared,
    // so from that moment the pointer owned the aim for the rest of the match. A player who taps LEFT
    // to turn, lets go, and then shoots has dirX() == 0 at the moment of the shot -- and the aim
    // snapped back to wherever the mouse happened to be resting, which is why Duane kept seeing
    // "i point left to shoot and the body still points right" on every gun. Reproduced deterministically
    // by dev/bodyaim.mjs: tap, release, fire -> aim +1 on all three guns with the pointer to the right.
    //
    // It is a timestamp now. Move the mouse or click and it aims; leave it sitting and the keyboard
    // has the fighter back within MOUSE_IDLE.
    const fresh = gnMouse.moved && (performance.now() - gnMouse.moved) < MOUSE_IDLE;
    const f = gnP1(), ok = gnMouseOk() && f && f.state !== 'dead' && f.item && gnIsGun(f.item.kind) && fresh && gnMouse.over;
    if (!ok) { GUNS.mouse.on = false; return; }
    // FREE AIM, Madness-style: point the gun wherever the pointer is, not at one of 8 ways.
    //
    // Duane, 2026-10-14: *"you can literally like aim anywhere on the screen and shoot ... not just
    // left or down or diagnal but really like madness"*. The 8-way snap below was the whole reason it
    // felt stiff: every shot was forced onto a 45 degree spoke.
    //
    // The angle is quantised to AIM_STEPS (128) positions, 2.8 degrees apart, and the unit vector is
    // read out of the precomputed table in 10_core.js rather than computed from the float here. That
    // is not caution for its own sake: it is one byte if this ever goes on the wire for online play,
    // it is identical on every machine, and it keeps mouse and pad on the same footing instead of
    // handing a mouse player angles a stick cannot reach. At 2.8 degrees nobody can feel the steps.
    const s = V3.project(f.x, f.y - f.h * 0.6), dx = gnMouse.x - s.x, dy = gnMouse.y - s.y;
    if (dx * dx + dy * dy > 64) {
      const st = aimStep(dx, -dy);              // screen y grows down; the step table is math-convention
      GUNS.mouse.dx = AIM_COS[st]; GUNS.mouse.dy = -AIM_SIN[st];   // back to sim space, y down
    }
    GUNS.mouse.on = true;
    // No reticle. Duane, 2026-10-14: *"without the literal aiming circle"*. Madness does not draw one
    // either; the gun itself points where you are pointing and that is the feedback. The system
    // cursor stays visible (the old code hid it with `body.gn-aim canvas{cursor:none}`), because with
    // the crosshair gone, hiding the cursor too would leave nothing on screen to aim with.
  }
  const gnKey = k => { try { return KEYMAPS.kb1[k][0]; } catch (e) { return k === 'attack' ? 'KeyF' : 'KeyE'; } };
  const gnGameTarget = e => e.target && e.target.tagName === 'CANVAS';
  addEventListener('mousemove', e => { gnMouse.x = e.clientX; gnMouse.y = e.clientY; gnMouse.over = gnGameTarget(e); if (gnMouseOk()) gnMouse.moved = performance.now(); }, { passive: true });
  addEventListener('mouseleave', () => { gnMouse.over = false; });
  addEventListener('mousedown', e => {
    if (!gnMouseOk() || !gnGameTarget(e)) return;
    const f = gnP1(); if (!f || !f.item || !gnIsGun(f.item.kind)) return;
    // clicking IS using the mouse, so it refreshes the same timestamp a move does -- a player who
    // aims and fires entirely with the mouse never falls back to the keyboard mid-fight.
    gnMouse.moved = performance.now();
    const code = gnKey(e.button === 2 ? 'grab' : 'attack');
    keysHeld.add(code); keysTapped.add(code); gnMouse.down = code;
    e.preventDefault();
  });
  addEventListener('mouseup', () => { if (gnMouse.down) { keysHeld.delete(gnMouse.down); gnMouse.down = false; } });
  addEventListener('contextmenu', e => { if (gnMouseOk() && gnGameTarget(e)) e.preventDefault(); });

  // ================= hooks =================
  const gnDec = V3.decorate;
  V3.decorate = function (av) { gnDec.call(this, av); try { gnHeld(av); } catch (e) { V3.fxErr(e, '9g_guns:603'); /* cosmetic */ } };
  // Effect time runs on the fight's own clock (Game.tick): a pause freezes the tracers, the brass and the
  // smoke with everything else, and a screenshot of frame N is frame N whatever the display rate.
  let gnLastTick = -1;
  const gnMoves = V3.movesFrame;
  V3.movesFrame = function () {
    if (gnMoves) gnMoves.apply(this, arguments);
    try {
      const tk = Game.tick | 0, dk = gnLastTick < 0 || tk < gnLastTick ? 0 : Math.min(4, tk - gnLastTick); gnLastTick = tk;
      gnInit(); gnNow += dk; gnFrameN++; gnDk = dk;
      gnEvents(); gnPools(dk); gnHints(); gnMouseFrame();
      if (typeof GunAudio !== 'undefined' && GunAudio) GunAudio.G.casings3D = true;
    } catch (e) { V3.fxErr(e, '9g_guns:615'); /* effects are cosmetic */ }
  };
  // rounds are drawn by the tracer pool: tell 91 not to hang its default white ball on them
  if (V3.projMesh2) {
    const gnPM = V3.projMesh2;
    V3.projMesh2 = function (p, g) { if (p && p.gn && p.kind !== 'rocket') return true; return gnPM.call(this, p, g); };
  }
  // 97_v3_pose asks how hard the arm is kicking right now (0..1): a frame to climb, ~10 to settle
  V3.gnRecoil = f => {
    const S = f && gnShot[f.idx]; if (!S || S.t == null || !f.item || !gnIsGun(f.item.kind)) return 0;
    const since = gnNow - S.t, L = GN_LOOK[S.k] || GN_LOOK.pistol, kk = since < 1 ? 0.4 : since < 2 ? 1 : since < 12 ? Math.pow(1 - (since - 2) / 10, 2) : 0;
    return kk * Math.min(1, L.kick / 0.5);
  };
  V3.gnDbg = () => { const F = gnFX; return F ? { fl: F.fl.length, core: F.core.count, cone: F.cone.count, tr: F.tr.count, trs: F.trs.length, sp: F.sp.count, cas: F.cas.count, sm: F.sms.length, now: gnNow, cur: gnCur } : null; };
  const gnItemsF = V3.itemsFrame;
  V3.itemsFrame = function () { gnItemsF.apply(this, arguments); try { gnItems(); } catch (e) {} };
}
