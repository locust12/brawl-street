// ===== 3D: roster-2 special moves: projectile looks, move effects, stand-in fighters =====
// Visual only: reads Game / fighter state, never writes it, never touches the seeded fight RNG
// (Math.random is fine here). Projectile kinds and move `fx` names are set in src/21_roster2.js.
// Wrapped in a block so its names can't collide with the other .mjs files (one module).
{
  const col3 = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const HOT = 0.62;   // overall glow level: big additive shapes blow out under bloom otherwise
  // additive glow materials, cached by colour / brightness / opacity step (projectiles come and go fast)
  const matCache = new Map();
  const glowM = (hex, k = 2, op = 1, side) => {
    const key = hex + '|' + k + '|' + (Math.round(op * 10) / 10) + '|' + (side ? 1 : 0);
    let m = matCache.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: col3(hex, k * HOT), transparent: true, opacity: Math.round(op * 10) / 10, blending: THREE.AdditiveBlending, depthWrite: false, side: side ? THREE.DoubleSide : THREE.FrontSide, fog: false }); matCache.set(key, m); }
    return m;
  };
  // normally blended colour (keeps its hue over bright or blue backdrops, where additive glow turns white or pink)
  const solidCache = new Map();
  const solidM = (hex, op = 0.8, map) => {
    const key = hex + '|' + (Math.round(op * 10) / 10) + '|' + (map ? 1 : 0);
    let m = solidCache.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), map: map || null, transparent: true, opacity: Math.round(op * 10) / 10, depthWrite: false, side: THREE.DoubleSide, fog: false }); solidCache.set(key, m); }
    return m;
  };
  // fresnel rim: bright edge, see-through middle (orbs, bubbles, barriers)
  const rimCache = new Map();
  const rimM = (hex, k = 2, pw = 2.2, core = 0) => {
    const key = hex + '|' + k + '|' + pw + '|' + core;
    let m = rimCache.get(key);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { c: { value: col3(hex, k * HOT) }, core: { value: core }, pw: { value: pw } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); n = normalize(normalMatrix*normal); v = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 c; uniform float core, pw; varying vec3 n; varying vec3 v; void main(){ float f = pow(max(0., 1. - abs(dot(n, v))), pw); gl_FragColor = vec4(c * (f + core), 1.); }',
      });
      rimCache.set(key, m);
    }
    return m;
  };
  const SPH = new THREE.SphereGeometry(1, 20, 14), SPH_LO = new THREE.SphereGeometry(1, 10, 8);
  const CAPS = new THREE.CapsuleGeometry(0.5, 1, 4, 12); CAPS.rotateZ(Math.PI / 2);                // length 2 along x, radius 0.5
  const BEAM = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); BEAM.rotateZ(-Math.PI / 2); BEAM.translate(0.5, 0, 0);   // x 0..1
  const TORUS = new THREE.TorusGeometry(1, 0.06, 8, 48);
  const DOME = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const CONE = new THREE.ConeGeometry(1, 1, 18, 1, true); CONE.translate(0, -0.5, 0); CONE.rotateX(Math.PI);   // tip at the origin, open end at y=+1
  const JET = new THREE.ConeGeometry(1, 1, 18, 1, true); JET.rotateX(Math.PI); JET.translate(0, -0.5, 0);      // wide end at y=0, tip at y=-1 (points down)
  const CRESC = new THREE.RingGeometry(0.72, 1, 40, 1, -Math.PI * 0.45, Math.PI * 0.9);
  const PLANE = new THREE.PlaneGeometry(1, 1);
  const canvasT = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  // streaky energy texture, scrolled along beams and cones
  const streakT = canvasT(64, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { const x = Math.random() * w, l = 30 + Math.random() * 120, y = Math.random() * h; const gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + (0.4 + Math.random() * 0.6) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + Math.random() * 5, l); }
  });
  streakT.wrapS = streakT.wrapT = THREE.RepeatWrapping; streakT.colorSpace = THREE.NoColorSpace;
  const streakCache = new Map();
  const streakM = (hex, k = 2.4, op = 0.9) => {
    const key = hex + k + op; let m = streakCache.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: col3(hex, k * HOT), map: streakT, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); streakCache.set(key, m); }
    return m;
  };
  const noShadow = g => g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  // jagged electric line: n points from a to b with random side kicks
  const arcGeo = n => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return g; };
  function zap(line, x0, y0, x1, y1, amp) {
    const a = line.geometry.attributes.position, n = a.count, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (let i = 0; i < n; i++) { const k = i / (n - 1), j = i === 0 || i === n - 1 ? 0 : (Math.random() - 0.5) * 2 * amp; a.setXYZ(i, x0 + dx * k + nx * j, y0 + dy * k + ny * j, (Math.random() - 0.5) * amp * 0.5); }
    a.needsUpdate = true; line.geometry.computeBoundingSphere();
  }
  const lineCache = new Map();
  const lineM = (hex, k = 3) => { const key = hex + k; let m = lineCache.get(key); if (!m) { m = new THREE.LineBasicMaterial({ color: col3(hex, k * 0.75), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); lineCache.set(key, m); } return m; };
  const orb = (g, hex, core = 0.35) => {   // bright core, coloured body, fresnel rim
    const a = new THREE.Mesh(SPH, glowM('#ffffff', 2.6, 1)); a.scale.setScalar(core);
    const b = new THREE.Mesh(SPH, glowM(hex, 1.8, 0.75)); b.scale.setScalar(0.75);
    const c = new THREE.Mesh(SPH, rimM(hex, 2.6, 2, 0.08));
    g.add(a, b, c); return [a, b, c];
  };

  // ---------------- projectiles ----------------
  const SH = {};   // shared solid geometry / materials, made on first use
  const KIND = {
    kibeam(p, g) {
      const col = p.color || '#7ff0ff';
      const outer = new THREE.Mesh(BEAM, solidM('#1a6cff', 0.45)), mid = new THREE.Mesh(BEAM, solidM(col, 0.6)), core = new THREE.Mesh(BEAM, glowM('#c8faff', 1.3, 0.8));
      const str = new THREE.Mesh(BEAM, streakM(col, 1.3, 0.8)); g.add(str);
      const ball = new THREE.Group(); orb(ball, col, 0.5);
      const tipB = new THREE.Group(); orb(tipB, col, 0.5);
      const spin = new THREE.Mesh(TORUS, glowM(col, 2.4, 0.8)); spin.rotation.y = Math.PI / 2;
      g.add(outer, mid, core, ball, tipB, spin);
      return (p, m) => {
        const L = Math.max(0.01, p.len * V3.SC), r = p.r * V3.SC, w = 1 + Math.sin(p.age * 1.9) * 0.1;
        const k = p.age > p.life - 7 ? Math.max(0.05, (p.life - p.age) / 7) : Math.min(1, p.age / 3 + 0.3);
        m.rotation.set(0, (p.dir || 1) < 0 ? Math.PI : 0, 0); m.position.z = 0.25;
        outer.scale.set(L, r * 1.35 * w * k, r * 1.35 * w * k); mid.scale.set(L, r * 0.9 * k, r * 0.9 * k); str.scale.set(L, r * 0.95 * k, r * 0.95 * k); core.scale.set(L, r * 0.24 * k, r * 0.24 * k);
        ball.scale.setScalar(r * 2.1 * w); tipB.position.x = L; tipB.scale.setScalar(r * 1.7 * k * w);
        spin.position.x = 0.05; spin.scale.setScalar(r * (2.2 + Math.sin(p.age) * 0.3)); spin.rotation.x += 0.3;
        streakT.offset.y = (performance.now() / 1000 * -3) % 1;
      };
    },
    ki(p, g) { orb(g, p.color || '#9ff4ff', 0.4); return (p, m) => { m.scale.setScalar(p.r * V3.SC * (1.2 + Math.random() * 0.2)); }; },
    volley(p, g) {
      const c = new THREE.Mesh(CAPS, glowM('#ffffff', 2.6, 1)), o = new THREE.Mesh(CAPS, glowM(p.color || '#ffd45c', 2.2, 0.8)); o.scale.set(1.3, 1.8, 1.8);
      const h = new THREE.Mesh(SPH_LO, glowM(p.color || '#ffd45c', 1.2, 0.35)); h.scale.set(1.6, 1.4, 1.4); g.add(o, c, h);
      return (p, m) => { const r = p.r * V3.SC; m.scale.set(r * 1.6, r, r); m.rotation.set(0, 0, Math.atan2(-p.vy, p.vx)); };
    },
    finger(p, g) {
      const c = new THREE.Mesh(CAPS, glowM('#ffffff', 3, 1)), o = new THREE.Mesh(CAPS, glowM(p.color || '#ff3a6e', 2.6, 0.9)); o.scale.set(1.1, 2.4, 2.4); g.add(o, c);
      const tail = new THREE.Mesh(CAPS, glowM(p.color || '#ff3a6e', 1.4, 0.4)); tail.scale.set(2.2, 1.6, 1.6); tail.position.x = -1.6; g.add(tail);
      return (p, m) => { const r = p.r * V3.SC; m.scale.set(r * 4, r * 0.8, r * 0.8); m.rotation.set(0, 0, p.vx < 0 ? Math.PI : 0); };
    },
    supernova(p, g) {
      const col = p.color || '#ff5a3a';
      const dark = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0x1a0204, fog: false })); dark.scale.setScalar(0.72);
      const rim = new THREE.Mesh(SPH, rimM(col, 3.2, 1.6, 0.05));
      const halo = new THREE.Mesh(SPH, rimM('#ffb347', 1.6, 3, 0)); halo.scale.setScalar(1.35);
      const ring = new THREE.Mesh(TORUS, glowM('#ffd08a', 2.6, 0.9)); ring.scale.setScalar(1.25); ring.rotation.x = 1.2;
      const ring2 = new THREE.Mesh(TORUS, glowM(col, 2.2, 0.8)); ring2.scale.setScalar(1.5); ring2.rotation.x = -0.9;
      const arcs = []; for (let i = 0; i < 4; i++) { const l = new THREE.Line(arcGeo(8), lineM('#ffd08a', 3)); g.add(l); arcs.push(l); }
      g.add(dark, rim, halo, ring, ring2);
      return (p, m) => {
        const r = p.r * V3.SC * (1 + Math.sin(p.age * 0.5) * 0.04); m.scale.setScalar(r); m.position.z = 0.2;
        ring.rotation.z += 0.08; ring2.rotation.z -= 0.05; dark.rotation.y += 0.03;
        for (const l of arcs) { const a = Math.random() * 6.283; zap(l, Math.cos(a) * 0.3, Math.sin(a) * 0.3, Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.15); }
      };
    },
    shadow(p, g) {
      const col = p.color || '#9a6cff';
      const dark = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0x0a0418, fog: false })); dark.scale.setScalar(0.62);
      const rim = new THREE.Mesh(SPH, rimM(col, 3, 1.4, 0.05)), halo = new THREE.Mesh(SPH, rimM('#4ff0ff', 1.4, 3, 0)); halo.scale.setScalar(1.3);
      const arcs = []; for (let i = 0; i < 3; i++) { const l = new THREE.Line(arcGeo(7), lineM('#8ff4ff', 3)); g.add(l); arcs.push(l); }
      g.add(dark, rim, halo);
      return (p, m) => {
        m.scale.setScalar(p.r * V3.SC * (1 + Math.sin(p.age * 0.9) * 0.06)); m.position.z = 0.2;
        for (const l of arcs) { const a = Math.random() * 6.283, b = a + 1 + Math.random() * 2; zap(l, Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), 0.25); }
      };
    },
    bubble(p, g) {
      const col = p.color || '#ff9ae8';
      const body = new THREE.Mesh(SPH, rimM(col, 2.2, 1.8, 0.06));
      const hl = new THREE.Mesh(SPH_LO, glowM('#ffffff', 2, 0.8)); hl.scale.setScalar(0.18); hl.position.set(-0.35, 0.4, 0.6);
      const core = new THREE.Mesh(SPH, glowM(col, 1, 0.25)); core.scale.setScalar(0.6);
      g.add(body, hl, core);
      return (p, m) => { const w = Math.sin(p.age * 0.25) * 0.06; m.scale.set(p.r * V3.SC * (1 + w), p.r * V3.SC * (1 - w), p.r * V3.SC); };
    },
    fireball(p, g) {
      const col = p.color || '#ff8a1a';
      orb(g, col, 0.45);
      const tail = new THREE.Mesh(SPH_LO, glowM('#ff4a0a', 1.8, 0.6)); tail.scale.set(1.6, 0.7, 0.7); tail.position.x = -0.9; g.add(tail);
      return (p, m) => { const r = p.r * V3.SC * (1.25 + Math.random() * 0.15); m.scale.setScalar(r); m.rotation.set(0, 0, Math.atan2(-p.vy, p.vx)); };
    },
    flame(p, g) {
      if (!SH.soft) SH.soft = canvasT(64, 64, (c, W, H) => { const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); });
      const a = new THREE.Mesh(SPH_LO, glowM('#ffd070', 1.1, 0.8)), b = new THREE.Mesh(PLANE, solidM(p.color || '#ff7a1a', 0.6, SH.soft));
      a.scale.setScalar(0.45); b.scale.setScalar(2.4); g.add(b, a);
      return (p, m) => {
        const k = Math.min(1, p.age / Math.max(1, p.life)), r = p.r * V3.SC * (0.9 + Math.random() * 0.25);
        m.scale.setScalar(r); m.position.z = 0.25 + Math.random() * 0.05; m.quaternion.copy(V3.camera.quaternion);
        b.material = solidM(k < 0.3 ? '#ffb030' : k < 0.6 ? (p.color || '#ff7a1a') : '#b8200a', Math.max(0.1, 0.8 - k * 0.6), SH.soft);
        a.material = glowM('#ffd070', 1.1, Math.max(0, 0.8 - k * 1.4)); a.scale.setScalar(0.45 * (1 - k * 0.6));
      };
    },
    spore(p, g) {
      // AIRDROP's dropped smoke canister (was THISTLE's purple spores with yellow sparkles, 9/22)
      const col = p.color || '#6fffc8', puffs = [];
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(SPH_LO, glowM(i % 3 ? col : '#e6fff6', i % 3 ? 0.9 : 1.3, i % 3 ? 0.35 : 0.6));
        const a = i * 2.4, rr = i % 3 ? 0.45 : 0.6; s.userData.o = [Math.cos(a) * rr, Math.sin(a) * rr * 0.8, (Math.random() - 0.5) * 0.4, i % 3 ? 0.55 : 0.12, Math.random() * 6];
        g.add(s); puffs.push(s);
      }
      return (p, m) => {
        const k = Math.min(1, p.age / Math.max(1, p.life)), t = p.age * 0.05;
        m.scale.setScalar(p.r * V3.SC); m.rotation.set(0, 0, t * 0.5); m.position.z = 0.2;
        for (const s of puffs) { const o = s.userData.o; s.position.set(o[0] + Math.sin(t + o[4]) * 0.12, o[1] + Math.cos(t * 1.3 + o[4]) * 0.12, o[2]); s.scale.setScalar(o[3] * (1 + Math.sin(t * 2 + o[4]) * 0.15) * (k > 0.8 ? (1 - k) * 5 : 1)); }
      };
    },
    star(p, g) {
      if (!SH.star) {
        const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.45 : 1; sh[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
        SH.star = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }); SH.star.center();
        SH.starM = new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffb020, emissiveIntensity: 1.4, roughness: 0.3 });
      }
      const st = new THREE.Mesh(SH.star, SH.starM); const halo = new THREE.Mesh(SPH_LO, glowM(p.color || '#ffe066', 1.4, 0.5)); halo.scale.setScalar(1.3);
      const trail = new THREE.Mesh(CAPS, glowM('#fff3b0', 1.6, 0.5)); trail.scale.set(1.6, 0.7, 0.7); trail.position.x = -1.2;
      g.add(st, halo, trail);
      return (p, m) => {
        m.scale.setScalar(p.r * V3.SC); st.rotation.z = -p.age * 0.35 * Math.sign(p.vx || 1);
        const sp = Math.min(2.8, Math.abs(p.vx) / 9);                      // spat out hard: a longer streak
        trail.scale.set(1.2 + sp, 0.7, 0.7); trail.position.x = -(0.9 + sp * 0.55) * Math.sign(p.vx || 1);
      };
    },
    jolt(p, g) {
      orb(g, p.color || '#ffe84a', 0.5);
      const arcs = []; for (let i = 0; i < 4; i++) { const l = new THREE.Line(arcGeo(6), lineM(i % 2 ? '#8fd8ff' : '#fff6a0', 3)); g.add(l); arcs.push(l); }
      return (p, m) => { m.scale.setScalar(p.r * V3.SC * (1.1 + Math.random() * 0.25)); for (const l of arcs) { const a = Math.random() * 6.283; zap(l, 0, 0, Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0.35); } };
    },
    bolt(p, g) {
      const col = p.color || '#ffe84a', H = 5;
      const strands = []; for (let i = 0; i < 3; i++) { const l = new THREE.Line(arcGeo(16), lineM(i ? col : '#ffffff', i ? 3 : 4)); g.add(l); strands.push(l); }
      const col1 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), glowM(col, 1.4, 0.35)); col1.scale.set(0.12, H, 0.12); col1.position.y = H / 2; g.add(col1);
      const tipO = new THREE.Group(); orb(tipO, col, 0.5); tipO.scale.setScalar(0.25); g.add(tipO);
      return (p, m) => {
        m.position.z = 0.3; m.rotation.set(0, 0, 0);
        strands.forEach((l, i) => zap(l, (Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.3, H, 0.18 + i * 0.06));
        col1.scale.x = col1.scale.z = 0.1 + Math.random() * 0.05; tipO.scale.setScalar(0.22 + Math.random() * 0.08);
      };
    },
    // SPARK's arcing bolt: a bright head with lightning trailing behind it, banked along its flight
    // MOODENG's mud: a flat, wobbling puddle that sits on the deck
    mud(p, g) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 1, metalness: 0, transparent: true, opacity: 0.92 }));
      disc.rotation.x = -Math.PI / 2; g.add(disc);
      const sheen = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.6, transparent: true, opacity: 0.6 }));
      sheen.rotation.x = -Math.PI / 2; sheen.position.set(-0.25, 0.01, 0.1); g.add(sheen);
      return (p, m) => {
        const s = p.r * V3.SC * 1.6, k = 1 + Math.sin(performance.now() * 0.004 + p.x) * 0.04;
        m.scale.set(s * k, 1, s * 0.55 / k);
        const life = Math.min(1, (p.life - p.age) / 40);
        disc.material.opacity = 0.92 * life; sheen.material.opacity = 0.6 * life;
      };
    },
    arcbolt(p, g) {
      const col = p.color || '#ffe84a';
      const head = new THREE.Mesh(SPH, glowM('#ffffff', 2.8, 0.95)); head.scale.setScalar(0.5); g.add(head);
      const halo = new THREE.Mesh(SPH, glowM(col, 2, 0.5)); halo.scale.setScalar(1); g.add(halo);
      const strands = []; for (let i = 0; i < 4; i++) { const l = new THREE.Line(arcGeo(12), lineM(i % 2 ? col : '#ffffff', i % 2 ? 3 : 4)); g.add(l); strands.push(l); }
      return (p, m) => {
        const sp = Math.hypot(p.vx, p.vy) || 1, ux = -p.vx / sp, uy = p.vy / sp;   // backwards, screen space
        m.rotation.set(0, 0, 0);
        m.scale.setScalar(p.r * V3.SC * (1 + Math.random() * 0.12));
        head.scale.setScalar(0.42 + Math.random() * 0.12);
        halo.scale.setScalar(0.9 + Math.random() * 0.25);
        strands.forEach((l, i) => {
          const len = 1.6 + i * 0.5 + Math.random() * 0.6;
          zap(l, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, ux * len + (Math.random() - 0.5) * 0.5, uy * len + (Math.random() - 0.5) * 0.5, 0.3);
        });
        if (Math.random() < 0.5) sparks.push({ x: m.position.x, y: m.position.y, vx: (Math.random() - 0.5) * 0.05, vy: (Math.random() - 0.5) * 0.05, t: 0, life: 12 + Math.random() * 10, c: Math.random() < 0.5 ? '#fff6a0' : col });
      };
    },
    // VOLT's thrown bolt: five short bars laid end to end and kicked alternately off the travel
    // line, so it keeps a jagged silhouette under bloom, plus a hot head at the point. SPARK's
    // arcbolt is a round head with a tail and photographs as a white streak -- wrong for the thing
    // VOLT throws, and the two electric fighters have to read apart on sight.
    voltbolt(p, g) {
      const col = p.color || '#c6ff2e';
      const segs = []; for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(CAPS, glowM(col, 2.2, 1)); g.add(b); segs.push(b); }
      const head = new THREE.Mesh(SPH, glowM('#f2ffd0', 2.4, 0.95)); g.add(head);
      return (p, m) => {
        const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = -p.vy / sp;
        m.rotation.set(0, 0, 0);
        m.scale.setScalar(p.r * V3.SC * 1.9);    // the bolt draws bigger than its hitbox, like every arc in the game
        head.scale.setScalar(0.34 + Math.random() * 0.1);
        head.position.set(ux * 0.95, uy * 0.95, 0);
        const n = segs.length, L = 3.1, step = L / n;
        for (let i = 0; i < n; i++) {
          const t0 = -2.2 + i * step, t1 = t0 + step;
          const k0 = (i % 2 ? 1 : -1) * (0.2 + Math.random() * 0.2), k1 = (i % 2 ? -1 : 1) * (0.2 + Math.random() * 0.2);
          const x0 = ux * t0 - uy * k0, y0 = uy * t0 + ux * k0;
          const x1 = ux * t1 - uy * k1, y1 = uy * t1 + ux * k1;
          const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, b = segs[i];
          b.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
          b.rotation.z = Math.atan2(dy, dx);
          const w = (0.13 + 0.15 * (i / n)) * (0.85 + Math.random() * 0.3);
          b.scale.set(len * 0.52, w, w);
        }
        if (Math.random() < 0.7) sparks.push({ x: m.position.x, y: m.position.y, vx: (Math.random() - 0.5) * 0.05, vy: (Math.random() - 0.5) * 0.05, t: 0, life: 8 + Math.random() * 10, c: Math.random() < 0.75 ? col : '#eaffb0' });
      };
    },
    wave(p, g) {
      const col = p.color || '#ffffff';
      const dome = new THREE.Mesh(DOME, rimM(col, 2.4, 1.5, 0.12)); const core = new THREE.Mesh(DOME, glowM('#ffffff', 1.4, 0.35)); core.scale.setScalar(0.55);
      const base = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 32), glowM(col, 2.2, 0.7, true)); base.rotation.x = -Math.PI / 2;
      g.add(dome, core, base);
      return (p, m) => {
        const r = p.r * V3.SC, k = Math.max(0.2, 1 - p.age / Math.max(1, p.life)), w = 1 + Math.sin(p.age * 0.9) * 0.08;
        m.rotation.set(0, 0, 0); m.position.y -= r * 0.7; m.position.z = 0.2;
        dome.scale.set(r * 1.5 * w, r * 2.1 * k * w, r); core.scale.set(r * 0.8, r * 1.3 * k, r * 0.6); base.scale.setScalar(r * 1.7);
      };
    },
    blaster(p, g) {
      const col = p.color || '#6dff5a';
      const c = new THREE.Mesh(CAPS, glowM('#ffffff', 2.8, 1)), o = new THREE.Mesh(CAPS, glowM(col, 2.6, 0.9)); o.scale.set(1.2, 2, 2);
      const tail = new THREE.Mesh(CAPS, glowM(col, 1.4, 0.4)); tail.scale.set(1.8, 1.4, 1.4); tail.position.x = -1.3; g.add(o, c, tail);
      return (p, m) => { const r = p.r * V3.SC; m.scale.set(r * 2.2, r * 0.9, r * 0.9); m.rotation.set(0, 0, p.vx < 0 ? Math.PI : 0); };
    },
    cashblast(p, g) {
      if (!SH.bill) { SH.bill = new THREE.BoxGeometry(0.5, 0.24, 0.03); SH.coin = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 16); SH.billM = new THREE.MeshStandardMaterial({ color: 0x3ec46d, emissive: 0x0a4a1a, emissiveIntensity: 0.8, roughness: 0.6 }); SH.coinM = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.25, emissive: 0x6a4000, emissiveIntensity: 0.7 }); }
      const bills = [];
      for (let i = 0; i < 14; i++) {
        const b = i % 3 ? new THREE.Mesh(SH.bill, SH.billM) : new THREE.Mesh(SH.coin, SH.coinM);
        b.userData.v = [(Math.random() - 0.5) * 1.6, -0.6 - Math.random() * 1.2, (Math.random() - 0.5) * 0.8, Math.random() * 6]; g.add(b); bills.push(b);
      }
      const blast = new THREE.Mesh(JET, glowM('#8dffb0', 1.6, 0.45)); blast.scale.set(0.9, 1.6, 0.9); blast.position.y = 0.6; g.add(blast);
      return (p, m) => {
        const t = p.age / Math.max(1, p.life); m.scale.setScalar(p.r * V3.SC * 1.2); m.rotation.set(0, 0, 0);
        for (const b of bills) { const v = b.userData.v; b.position.set(v[0] * t, v[1] * t * 1.5, v[2] * t); b.rotation.set(v[3] + p.age * 0.3, v[3] * 2 + p.age * 0.2, 0); }
        blast.scale.set(0.9 + t, 1.6 * (1 - t) + 0.1, 0.9 + t);
      };
    },
    banana(p, g) {
      if (!SH.ban) { SH.ban = bananaGeo(40, 16); SH.banM = std(0xffe04a, { roughness: 0.45, emissive: 0x4a3600, emissiveIntensity: 0.4 }); SH.tip = new THREE.SphereGeometry(0.1, 10, 8); SH.tipM = std(0x4a2e10, { roughness: 0.8 }); }
      const b = new THREE.Mesh(SH.ban, SH.banM); b.rotation.z = Math.PI * 0.1;
      const t1 = new THREE.Mesh(SH.tip, SH.tipM), t2 = t1.clone();
      t1.position.set(Math.cos(Math.PI * 0.1) * 0.8, Math.sin(Math.PI * 0.1) * 0.8, 0); t2.position.set(Math.cos(Math.PI * 0.9) * 0.8, Math.sin(Math.PI * 0.9) * 0.8, 0);
      g.add(b, t1, t2);
      const tr = new THREE.Mesh(TORUS, glowM('#ffe04a', 1.4, 0.35)); tr.scale.setScalar(0.9); g.add(tr);
      return (p, m) => { m.scale.setScalar(p.r * V3.SC * 1.2); m.rotation.set(0, 0, -p.age * 0.5); tr.material = glowM('#ffe04a', 1.4, 0.35); };
    },
  };
  // weapon rounds (56_items2): bazooka rocket, shotgun pellet, machine-gun tracer, sniper tracer
  KIND.rocket = (p, g) => {
    if (!SH.rkt) { SH.rkt = new THREE.CapsuleGeometry(0.5, 1.6, 6, 14); SH.rkt.rotateZ(Math.PI / 2); SH.rktM = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, metalness: 0.4, roughness: 0.35 }); SH.rktN = new THREE.MeshStandardMaterial({ color: 0xe02a2a, roughness: 0.4, emissive: 0x3a0000 }); SH.fin = new THREE.BoxGeometry(0.5, 0.06, 1.3); }
    const body = new THREE.Mesh(SH.rkt, SH.rktM), nose = new THREE.Mesh(SPH_LO, SH.rktN); nose.scale.set(0.55, 0.5, 0.5); nose.position.x = 1.25;
    const f1 = new THREE.Mesh(SH.fin, SH.rktN), f2 = f1.clone(); f1.position.x = -1.05; f2.position.x = -1.05; f2.rotation.x = Math.PI / 2;
    const fl = new THREE.Group(); const fa = new THREE.Mesh(JET, glowM('#ff9a2a', 1.4, 0.8)), fb = new THREE.Mesh(JET, glowM('#fff0b0', 1.8, 1)); fb.scale.set(0.45, 0.6, 0.45); fl.add(fa, fb); fl.rotation.z = -Math.PI / 2; fl.position.x = -1.4; fl.scale.set(0.45, 1.6, 0.45);
    g.add(body, nose, f1, f2, fl);
    return (p, m) => { m.scale.setScalar(p.r * V3.SC * 1.3); m.rotation.set(p.age * 0.3, 0, Math.atan2(-p.vy, p.vx), 'ZYX'); fl.scale.set(0.45, 1.3 + Math.random() * 0.9, 0.45); body.castShadow = true; };
  };
  KIND.pellet = (p, g) => {
    const c = new THREE.Mesh(SPH_LO, glowM('#fff0b0', 1.8, 1)), o = new THREE.Mesh(CAPS, glowM(p.color || '#ffc04a', 1.4, 0.7)); o.scale.set(1.6, 1, 1); o.position.x = -0.6; g.add(o, c);
    return (p, m) => { m.scale.setScalar(p.r * V3.SC); m.rotation.set(0, 0, Math.atan2(-p.vy, p.vx)); };
  };
  KIND.bullet = (p, g) => {
    const c = new THREE.Mesh(CAPS, glowM('#fffbe0', 2, 1)), o = new THREE.Mesh(CAPS, glowM(p.color || '#ffe27a', 1.4, 0.6)); o.scale.set(1.4, 1.8, 1.8); o.position.x = -0.8; g.add(o, c);
    return (p, m) => { const r = p.r * V3.SC; m.scale.set(r * 2.4, r * 0.6, r * 0.6); m.rotation.set(0, 0, Math.atan2(-p.vy, p.vx)); };
  };
  KIND.snipe = (p, g) => {
    const c = new THREE.Mesh(CAPS, glowM('#ffffff', 2.2, 1)), o = new THREE.Mesh(CAPS, glowM(p.color || '#9ff4ff', 1.6, 0.7)); o.scale.set(1.1, 2.4, 2.4);
    const tr = new THREE.Mesh(CAPS, glowM(p.color || '#9ff4ff', 0.9, 0.35)); tr.scale.set(3, 1.4, 1.4); tr.position.x = -4; g.add(tr, o, c);
    return (p, m) => { const r = p.r * V3.SC; m.scale.set(r * 6, r * 0.55, r * 0.55); m.rotation.set(0, 0, Math.atan2(-p.vy, p.vx)); };
  };
  // WOLVERINU's CROSS RAKE (67_unique): the cut itself, left hanging in the air. Four blades make the
  // X -- two thick coloured ones and two thin white cores. glowM caches its materials by colour, so the
  // fade has to be on a CLONE or it would dim every other projectile sharing that key.
  KIND.rake = (p, g) => {
    const c = p.color || '#9bf000', blades = [];
    for (let i = 0; i < 4; i++) {
      const hot = i % 2 === 1;
      const b = new THREE.Mesh(CAPS, (hot ? glowM('#ffffff', 2.4, 0.9) : glowM(c, 1.9, 0.6)).clone());
      b.rotation.z = (i < 2 ? 1 : -1) * 0.7; b.position.z = hot ? 0.02 : 0;
      b.userData.op = hot ? 0.9 : 0.6; b.userData.hot = hot;
      blades.push(b); g.add(b);
    }
    return (p, m) => {
      const r = p.r * V3.SC, k = Math.min(1, (p.life - p.age) / 16) * Math.min(1, p.age / 3 + 0.4);
      for (const b of blades) {
        const t = b.userData.hot ? 0.05 : 0.11;
        b.scale.set(r * (b.userData.hot ? 1.5 : 1.75), r * t, r * t);
        b.material.opacity = b.userData.op * k;
      }
    };
  };
  KIND.shard = (p, g) => {
    if (!SH.shard) { SH.shard = new THREE.TetrahedronGeometry(0.55, 0); SH.shardM = std(0xffe04a, { roughness: 0.4, emissive: 0x6a5000, emissiveIntensity: 0.6, flatShading: true }); }
    const b = new THREE.Mesh(SH.shard, SH.shardM), gl = new THREE.Mesh(SPH_LO, glowM(p.color || '#ffe04a', 1.2, 0.5)); gl.scale.setScalar(1.1); g.add(gl, b);
    return (p, m) => { m.scale.setScalar(p.r * V3.SC * 1.5); b.rotation.set(p.age * 0.4, p.age * 0.3, p.age * 0.2); };
  };
  // TOP G bailed out: his car carries on by itself (21_roster2 TOPG_BAIL)
  KIND.topgcar = (p, g) => {
    const car = carMesh(); g.add(car);
    let swapped = !!car.userData.model;
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), solidM('#05070c', 0.4)); sh.rotation.x = -Math.PI / 2; g.add(sh);
    return (p, m) => {
      // the same size it was while he was driving it (21_roster2 TOPG_BAIL passes his height): the
      // runaway used to shrink to about half a car the moment he stepped out
      const S = (p.h || 80) * V3.SC * 1.45;
      if (!swapped && CARM.scene) { carFill(car); swapped = true; }
      car.scale.setScalar(S); car.rotation.set(0, p.vx < 0 ? Math.PI : 0, Math.sin(p.age * 0.4) * 0.015);
      car.position.y = 0;
      sh.position.set(0, 0.012, -0.28 * S); sh.scale.set(S * 1.02, S * 0.5, 1);
      for (const w of car.userData.wheels || []) w.rotation.z -= 1.1;
      m.scale.setScalar(1);
    };
  };
  // 91 asks us for a mesh; the returned animator runs every frame (see syncProjectiles)
  V3.projKinds2 = () => Object.keys(KIND);   // 99_v3_finish warms one of each
  V3.projMesh2 = function (p, g) {
    const make = KIND[p.kind]; if (!make) return false;
    const anim = make(p, g);
    let fixed = false;
    g.userData.anim2 = (p, m) => { if (!fixed) { fixed = true; if (!['star', 'banana', 'cashblast', 'rocket'].includes(p.kind)) noShadow(m); } anim(p, m); };
    return true;
  };

  // ---------------- move effects ----------------
  const FXR = new Map();   // fighter -> { name: Object3D }
  function fx(f, name, make) {
    let r = FXR.get(f); if (!r) FXR.set(f, r = {});
    let o = r[name];
    if (!o) { o = r[name] = make(); noShadow(o); V3.scene.add(o); }
    o.visible = true; o.userData.used = true;
    return o;
  }
  const P = (x, y) => [x * V3.SC, -y * V3.SC];
  const zOf = f => (f.idx - 1.5) * 0.06 + 0.3;
  const hbWin = (d, i = 0) => d.hits && d.hits[i] ? d.hits[i].f : null;
  // hitbox centre in world px
  const hbPos = (f, hb) => [f.x + f.face * hb.x, f.y + hb.y];

  function orbGroup(hex) {
    const g = new THREE.Group(); orb(g, hex, 0.42);
    const r1 = new THREE.Mesh(TORUS, glowM(hex, 2.6, 0.9)), r2 = new THREE.Mesh(TORUS, glowM('#ffffff', 2, 0.6));
    r1.scale.setScalar(1.3); r2.scale.setScalar(1.55); r2.rotation.x = 1.2; g.add(r1, r2); g.userData.rings = [r1, r2];
    const arcs = []; for (let i = 0; i < 3; i++) { const l = new THREE.Line(arcGeo(6), lineM('#ffffff', 2.5)); g.add(l); arcs.push(l); } g.userData.arcs = arcs;
    return g;
  }
  function chargeOrb(f, d, t, name, hex, over) {
    const fire = over ? 18 : 16;
    if (t > fire) return;
    const o = fx(f, name, () => orbGroup(hex));
    const ch = d.charge, k = f.move.charge / (ch.max || 60), grow = Math.min(1, t / Math.max(1, ch.at));
    const r = (over ? 0.22 + 0.26 * k : 0.06 + 0.12 * k) * (0.3 + 0.7 * grow) * (1 + Math.sin(performance.now() * 0.03) * 0.07);
    const [x, y] = P(f.x + f.face * (over ? f.w * 0.3 : f.w * 0.5 + 8), f.y - f.h * (over ? 1.3 : 0.55));
    o.position.set(x, y, zOf(f)); o.scale.setScalar(r);
    o.userData.rings[0].rotation.x += 0.12; o.userData.rings[1].rotation.y += 0.09; o.rotation.z += 0.04;
    for (const l of o.userData.arcs) { const a = Math.random() * 6.283; zap(l, Math.cos(a) * 0.4, Math.sin(a) * 0.4, Math.cos(a) * (2 + k), Math.sin(a) * (2 + k), 0.3); l.visible = k > 0.25; }
  }
  // flickering fire / electric aura around a point
  function aura(f, name, x, y, size, hex, elec) {
    const o = fx(f, name, () => {
      const g = new THREE.Group(); g.userData.b = [];
      for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(SPH_LO, glowM(i % 2 ? hex : '#ffe8a0', i % 2 ? 1.8 : 2.2, i % 2 ? 0.6 : 0.8)); g.add(s); g.userData.b.push(s); }
      if (elec) { g.userData.arcs = []; for (let i = 0; i < 4; i++) { const l = new THREE.Line(arcGeo(7), lineM(i % 2 ? '#8fd8ff' : '#fff6a0', 3)); g.add(l); g.userData.arcs.push(l); } }
      return g;
    });
    const [X, Y] = P(x, y); o.position.set(X, Y, zOf(f));
    const S = size * V3.SC;
    for (const s of o.userData.b) { s.position.set((Math.random() - 0.5) * S, (Math.random() - 0.3) * S, (Math.random() - 0.5) * S * 0.6); s.scale.setScalar(S * (0.25 + Math.random() * 0.3)); }
    if (o.userData.arcs) for (const l of o.userData.arcs) { const a = Math.random() * 6.283; zap(l, 0, 0, Math.cos(a) * S * 1.2, Math.sin(a) * S * 1.2, S * 0.2); }
  }
  // crescent slash at a hitbox
  function slash(f, name, x, y, r, hex, k, tilt) {
    const o = fx(f, name, () => { const g = new THREE.Group(); const a = new THREE.Mesh(CRESC, glowM('#ffffff', 1.4, 1, true)), b = new THREE.Mesh(CRESC, glowM(hex, 1.8, 0.8, true)); b.scale.setScalar(1.12); g.add(b, a); g.userData.m = [a, b]; return g; });
    const [X, Y] = P(x, y); o.position.set(X, Y, zOf(f) + 0.05);
    o.scale.set(r * V3.SC * 1.6 * f.face, r * V3.SC * 1.6, 1); o.rotation.set(0, 0, (tilt || -0.5) * f.face);
    o.userData.m[0].material = glowM('#ffffff', 1.4, Math.max(0, Math.min(1, k)), true); o.userData.m[1].material = glowM(hex, 1.8, Math.max(0, Math.min(0.8, k)), true);
  }
  function spinRing(f, name, y, r, hex, speed) {
    const o = fx(f, name, () => { const g = new THREE.Group(); const a = new THREE.Mesh(TORUS, glowM(hex, 2.4, 0.85)), b = new THREE.Mesh(TORUS, glowM('#ffffff', 2, 0.5)), c = new THREE.Mesh(new THREE.CircleGeometry(1, 40), glowM(hex, 1, 0.18, true)); a.rotation.x = Math.PI / 2; b.rotation.x = Math.PI / 2 - 0.5; b.scale.setScalar(0.8); c.rotation.x = -Math.PI / 2; g.add(a, b, c); return g; });
    const [X, Y] = P(f.x, y); o.position.set(X, Y, zOf(f)); o.scale.setScalar(r * V3.SC); o.rotation.y += speed || 0.5; o.rotation.z = Math.sin(performance.now() * 0.01) * 0.15;
  }
  function jet(f, name, len, width, hex) {
    const o = fx(f, name, () => { const g = new THREE.Group(); const a = new THREE.Mesh(JET, glowM(hex, 1.2, 0.55)), b = new THREE.Mesh(JET, glowM('#ffe0a0', 1.4, 0.8)); b.scale.set(0.4, 0.6, 0.4); const s = new THREE.Mesh(JET, streakM(hex, 1.5, 0.7)); s.scale.set(0.8, 1, 0.8); g.add(a, s, b); return g; });
    const [X, Y] = P(f.x, f.y - 6); o.position.set(X, Y, zOf(f));
    const L = len * V3.SC * (0.85 + Math.random() * 0.3); o.scale.set(width * V3.SC, L, width * V3.SC);
  }
  // cached flame-bird sprite per colour
  const birdTex = {};
  function birdT(hex) {
    return birdTex[hex] || (birdTex[hex] = canvasT(512, 512, (g, W, H) => {
      g.translate(W / 2, H / 2 + 20); g.shadowColor = hex; g.shadowBlur = 30;
      const fill = (x0, y0, r) => { const gr = g.createRadialGradient(x0, y0, 4, x0, y0, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, '#ffe27a'); gr.addColorStop(0.7, hex); gr.addColorStop(1, 'rgba(255,60,0,0)'); return gr; };
      // wings: swept up and back from the shoulders, scalloped trailing edge
      for (const s of [-1, 1]) {
        g.fillStyle = fill(20, -30, 260);
        g.beginPath(); g.moveTo(40, -10);
        g.bezierCurveTo(10, -90, -40, -170 - s * 10, -120, -215 - s * 12);
        for (let i = 0; i < 5; i++) { const x = -120 + i * 30, y = -215 - s * 12 + i * 42; g.quadraticCurveTo(x - 30, y + 10, x + 4, y + 36); }
        g.quadraticCurveTo(-10, -20, 40, -10); g.fill();
      }
      // body and neck
      g.fillStyle = fill(90, 0, 200);
      g.beginPath(); g.moveTo(170, -30); g.quadraticCurveTo(120, -60, 60, -20); g.quadraticCurveTo(-60, 10, -120, 30); g.quadraticCurveTo(-40, 50, 60, 30); g.quadraticCurveTo(130, 20, 170, -30); g.fill();
      // head with a beak and crest
      g.beginPath(); g.arc(170, -40, 26, 0, 7); g.fill();
      g.beginPath(); g.moveTo(190, -48); g.lineTo(232, -36); g.lineTo(190, -28); g.fill();
      g.beginPath(); g.moveTo(160, -62); g.quadraticCurveTo(130, -110, 96, -96); g.quadraticCurveTo(128, -84, 150, -52); g.fill();
      // tail flames
      g.fillStyle = fill(-100, 40, 180);
      for (const [a, l] of [[0.25, 190], [0.05, 230], [-0.18, 180]]) { g.beginPath(); g.moveTo(-100, 34); g.quadraticCurveTo(-170, 34 + a * 120, -100 - l, 60 + a * 260); g.quadraticCurveTo(-150, 50 + a * 60, -100, 20); g.fill(); }
      g.shadowBlur = 0; g.fillStyle = '#fffbe0'; g.beginPath(); g.arc(178, -46, 6, 0, 7); g.fill();
    }));
  }
  function truckMesh() {
    const g = new THREE.Group();
    const s = new THREE.Shape(); s.moveTo(-0.62, 0.08); s.lineTo(0.66, 0.08); s.lineTo(0.66, 0.26); s.lineTo(0.1, 0.52); s.lineTo(-0.62, 0.36); s.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.46, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 }), new THREE.MeshStandardMaterial({ color: 0xc4c8d0, metalness: 0.85, roughness: 0.34, flatShading: true, envMapIntensity: 1.6, emissive: 0x1a1e26, emissiveIntensity: 0.6 }));
    body.position.z = -0.23; g.add(body);
    // 9/22 night: pure metal with no environment on dark stages rendered as a flat grey slab; a lit panel-seam and a
    // lightbar along the roofline so it reads as a machine
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.012, 0.47), glowM('#9ad8ff', 1.6, 0.9)); seam.position.set(0.02, 0.2, 0); g.add(seam);
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.018, 0.4), glowM('#ffffff', 2.2, 1)); lb.position.set(-0.05, 0.47, 0); lb.rotation.z = -0.3; g.add(lb);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), new THREE.MeshStandardMaterial({ color: 0x0a0c14, metalness: 0.9, roughness: 0.1 })); glass.position.set(0.3, 0.42, 0.24); glass.rotation.z = -0.42; g.add(glass);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.44), glowM('#ffffff', 3, 1)); bar.position.set(0.665, 0.22, 0); g.add(bar);
    const wm = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.8 });
    for (const x of [-0.4, 0.42]) for (const z of [-0.22, 0.22]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16), wm); w.rotation.x = Math.PI / 2; w.position.set(x, 0.1, z); g.add(w); }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function vineMesh() {
    const g = new THREE.Group(); const v = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1, 6), new THREE.MeshStandardMaterial({ color: 0x3f8a2a, roughness: 0.9 })); v.position.y = 0.5; g.add(v);
    const lm = new THREE.MeshStandardMaterial({ color: 0x5ab83a, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.05, 6), lm); l.scale.set(1, 0.5, 1); l.position.set(0.03 * (i % 2 ? 1 : -1), 0.15 + i * 0.15, 0); l.rotation.z = i % 2 ? 0.6 : -0.6; v.add(l); }
    return g;
  }
  const flashes = [];   // teleport flashes
  function flashAt(x, y, hex) {
    const g = new THREE.Group();
    const s = new THREE.Mesh(PLANE, glowM(hex, 2.6, 0.9, true)); s.scale.set(0.12, 1.4, 1); g.add(s);
    const r = new THREE.Mesh(TORUS, glowM('#ffffff', 2.6, 0.9)); r.scale.setScalar(0.3); g.add(r);
    const [X, Y] = P(x, y); g.position.set(X, Y, 0.4); noShadow(g); V3.scene.add(g); flashes.push({ g, s, r, t: 0 });
  }
  const pops3 = [];   // little visual-only props (coins from the uppercut)
  let coinGeo = null, coinMat = null;
  function coinPop(x, y, face) {
    if (!coinGeo) { coinGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.015, 20); coinMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 1.1 }); }
    const m = new THREE.Mesh(coinGeo, coinMat); const [X, Y] = P(x, y); m.position.set(X, Y, 0.4); m.rotation.x = Math.PI / 2; V3.scene.add(m);
    pops3.push({ m, vx: (Math.random() * 0.02 + 0.01) * face + (Math.random() - 0.5) * 0.02, vy: 0.05 + Math.random() * 0.03, t: 0 });
  }
  const seen = new Map();   // fighter -> { hidden, mv, t, anchor } for edge-triggered effects

  const FXF = {
    kicharge(f, d, t) { chargeOrb(f, d, t, 'ki', d.color || '#7ff0ff', false); },
    orbcharge(f, d, t) { chargeOrb(f, d, t, 'orb', d.color || '#9a6cff', false); },
    novacharge(f, d, t) { chargeOrb(f, d, t, 'nova', d.color || '#ff5a3a', true); },
    firebird(f, d, t) {
      if (t >= 14 && t < 50) aura(f, 'fist', f.x + f.face * (f.w * 0.5 + 6), f.y - f.h * 0.55, 20 + t * 0.4, d.color || '#ff9a2a');
      if (t < 34 || t > 66) return;
      const o = fx(f, 'bird', () => new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: birdT(d.color || '#ff9a2a'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
      const s = t < 48 ? 0.35 + (t - 34) / 14 * 0.9 : 1.25 + (t - 48) * 0.035, a = t < 48 ? (t - 34) / 14 : Math.max(0, 1 - (t - 48) / 18);
      const [X, Y] = P(f.x + f.face * (f.w * 0.5 + 40 + (t >= 48 ? (t - 48) * 7 : 0)), f.y - f.h * 0.58);
      o.position.set(X, Y, zOf(f) + 0.1); o.scale.set(s * 1.5 * f.face, s * 1.5 * (1 + Math.sin(t * 0.8) * 0.05), 1); o.material.opacity = a;
    },
    flamefist(f, d, t) { const w = hbWin(d); if (w && t >= w[0] - 2 && t <= w[1] + 2) aura(f, 'ff', ...hbPos(f, d.hits[0]), 34, d.color || '#ff9a2a'); },
    flamekick(f, d, t) { const w = hbWin(d); if (w && t >= w[0] - 2 && t <= w[1] + 2) aura(f, 'fk', ...hbPos(f, d.hits[0]), 36, d.color || '#ff9a2a'); },
    blitz(f, d, t) { if (t >= 4 && t <= 32) aura(f, 'bz', f.x, f.y - f.h * 0.5, t < 12 ? 40 : 80, d.color || '#ff6a1a'); },
    dive(f, d, t) { if (t >= 6 && t <= 34) aura(f, 'dv', f.x + f.face * f.w * 0.4, f.y - f.h * 0.6, 30, d.color || '#ff9a2a'); },
    bash(f, d, t) { aura(f, 'bs', f.x + f.face * f.w * 0.2, f.y - f.h * 0.5, 44 + f.move.charge * 0.4, d.color || '#ffe84a', true); },
    // SPARK: arcs gather in while it winds up, the ball goes off, and a bolt snaps out to everyone
    // caught in it (the electrocuted state afterwards is drawn per fighter by zapped(), below).
    thunder(f, d, t) {
      const w = hbWin(d) || [20, 26];
      // the crackle takes the move's own colour (VOLT charges lime, SPARK stays yellow). It was
      // hardcoded to SPARK's #ffe84a, so every electric fighter wound up in the same colour.
      const EC = d.color || '#ffe84a';
      if (t < w[0] - 2) {                                   // charge: arcs crackling inward
        const k = Math.min(1, t / Math.max(1, w[0] - 2));
        const c = fx(f, 'tc', () => {
          const g = new THREE.Group(); g.userData.arcs = [];
          for (let i = 0; i < 6; i++) { const l = new THREE.Line(arcGeo(7), lineM(i % 2 ? EC : '#fff6a0', 2.6)); g.add(l); g.userData.arcs.push(l); }
          const gl = new THREE.Mesh(SPH, glowM(EC, 1.6, 0.5)); g.add(gl); g.userData.gl = gl;
          return g;
        });
        const [X, Y] = P(f.x, f.y - f.h * 0.55); c.position.set(X, Y, zOf(f));
        c.scale.setScalar(f.h * V3.SC);
        c.userData.gl.scale.setScalar(0.06 + k * 0.12); c.userData.gl.material = glowM(EC, 0.9 + k * 0.9, 0.14 + k * 0.2);
        for (const l of c.userData.arcs) {
          l.visible = Math.random() < 0.3 + k * 0.6;
          const a = Math.random() * 6.283, R = (1.5 - k) * (0.5 + Math.random() * 0.6);
          zap(l, Math.cos(a) * R, Math.sin(a) * R, 0, 0, 0.1 + 0.12 * (1 - k));
        }
        return;
      }
      if (t >= w[0] - 2 && t <= w[1] + 2) {
        const o = fx(f, 'tb', () => { const g = new THREE.Group(); g.add(new THREE.Mesh(SPH, rimM(EC, 3, 1.3, 0.15))); g.userData.arcs = []; for (let i = 0; i < 8; i++) { const l = new THREE.Line(arcGeo(8), lineM(i % 2 ? EC : '#fff6a0', 3.2)); g.add(l); g.userData.arcs.push(l); } return g; });
        const [X, Y] = P(f.x, f.y - f.h * 0.5); o.position.set(X, Y, zOf(f));
        const R = (d.hits && d.hits[0] ? d.hits[0].r : 72) * V3.SC * (0.7 + (t - (w[0] - 2)) * 0.05); o.scale.setScalar(R);
        for (const l of o.userData.arcs) { const a = Math.random() * 6.283; zap(l, 0, 0, Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0.25); }
        // and a bolt that snaps to whoever is in it
        const reach = (d.hits && d.hits[0] ? d.hits[0].r : 72) * 1.6;
        let n = 0;
        for (const g of Game.fighters) {
          if (g === f || g.state === 'dead' || n >= 3) continue;
          const dx = g.x - f.x, dy = (g.y - g.h * 0.5) - (f.y - f.h * 0.5);
          if (Math.hypot(dx, dy) > reach) continue;
          const b = fx(f, 'tz' + n, () => new THREE.Line(arcGeo(12), lineM('#fff6a0', 3.4)));
          b.position.set(X, Y, zOf(f) + 0.05); b.scale.setScalar(1);
          zap(b, 0, 0, dx * V3.SC, -dy * V3.SC, 0.06 + Math.random() * 0.05);
          b.material = lineM(n % 2 ? '#fff6a0' : EC, 3 + Math.random() * 1.5);
          b.visible = Math.random() < 0.85;
          n++;
        }
      }
    },
    rocket(f, d, t) { if (t >= 4 && t <= 38) jet(f, 'rk', 80 + (t < 36 ? 40 : 0), 18, d.color || '#ff9a2a'); },
    thrust(f, d, t) { jet(f, 'th', 60, 14, d.color || '#ff9a2a'); },
    stone(f) {
      const o = fx(f, 'stone', () => { const g = new THREE.Group(); const m = new THREE.Mesh(rockGeo(1, 1, 0.28, 7), new THREE.MeshStandardMaterial({ color: 0x8e8c96, roughness: 0.95, flatShading: true })); m.castShadow = true; g.add(m); return g; });
      const [X, Y] = P(f.x, f.y - f.h * 0.48); o.position.set(X, Y, zOf(f) - 0.3); o.scale.set(f.w * 0.72 * V3.SC, f.h * 0.6 * V3.SC, f.w * 0.62 * V3.SC);
      o.children[0].castShadow = true;
    },
    spin(f, d, t) { const w = hbWin(d); if (!w || (t >= w[0] - 1 && t <= (d.hits[d.hits.length - 1].f[1]) + 1)) spinRing(f, 'sp', f.y - f.h * 0.45, (d.hits && d.hits[0] ? d.hits[0].r : 50) * 1.05, d.color || d.weapon || f.color, 0.55); },
    shell(f, d, t) { spinRing(f, 'sh', f.y - f.h * 0.45, 58, d.color || '#ff7a1a', 0.7); },
    wings(f, d, t) { spinRing(f, 'wg', f.y - f.h * 0.5, 54, d.color || '#ff8a2a', 0.6); aura(f, 'wf', f.x, f.y - f.h * 0.5, 50, d.color || '#ff8a2a'); },
    wrench(f, d, t) { if (t >= 4 && t <= 22) spinRing(f, 'wr', f.y - f.h * 0.5, 44, '#d8e4f0', 0.7); },
    mallet(f, d, t) {
      const o = fx(f, 'ml', malletMesh);
      const [X, Y] = P(f.x + f.face * f.w * 0.26, f.y - f.h * 0.52);
      const air = !d.charge, s = f.h * V3.SC * (air ? 1.25 : 1.5);   // oversized on purpose: the head is about as wide as MOCHI
      const ang = V3.malletAng(f, d, t);
      const ch = d.charge ? Math.min(1, (f.move ? f.move.charge : 0) / (d.charge.max || 60)) : 0;
      const U = o.userData;
      // charging: the head heats up like a poker, shakes, and throws light on everything (Hammer Flip)
      const heat = ch * (0.75 + 0.25 * Math.sin(t * 0.9 + performance.now() * 0.02));
      U.head.emissive.setRGB(heat * 1.35, heat * 0.4, heat * 0.05); U.head.emissiveIntensity = 1 + heat * 2.2;
      U.glow.visible = ch > 0.03; U.glow.scale.setScalar(0.2 + ch * 0.17 + Math.sin(performance.now() * 0.03) * 0.02 * ch);   // a hot head, not a fireball
      U.glow.material = glowM('#ff8a1a', 1.2 + ch * 1.4, 0.2 + ch * 0.35);
      const shake = ch > 0.05 && d.charge && f.move && f.move.t === d.charge.at ? (Math.random() - 0.5) * 0.09 * ch : 0;
      o.position.set(X, Y, zOf(f) + 0.02);
      o.scale.setScalar(s); o.rotation.set(0, f.face < 0 ? Math.PI : 0, -(ang + shake));
      // the arc itself: a heavy crescent smear through the fast part of the swing
      const w = hbWin(d);
      if (!air && w && t > (d.charge ? d.charge.at : 8) && t <= w[1] + 3) {
        const k = t <= w[1] ? 1 : 1 - (t - w[1]) / 4;
        slash(f, 'mlarc', f.x + f.face * f.w * 0.5, f.y - f.h * (t < w[0] ? 0.85 : 0.45), f.h * 0.62, ch > 0.25 ? '#ffb347' : '#ffe8b0', k * 0.55, t < w[0] ? -1.5 : 1.35);
      }
      if (air) { const k = Math.min(1, t / 6); slash(f, 'mlarc', f.x, f.y - f.h * 0.5, f.h * 0.7, '#ffe8b0', k * 0.5, -t * 0.55); }
    },
    coins(f, d, t) {},   // coins pop on edge frames (see below)
    blink() {},          // flashes when the fighter vanishes / reappears (see below)
    zip(f, d, t) { const sp = Math.hypot(f.vx, f.vy); if (sp > 6) aura(f, 'zp', f.x, f.y - f.h * 0.5, 40, '#ffe84a', true); },
    hover(f, d, t) {
      const o = fx(f, 'hv', () => { const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), glowM('#ff3a6e', 2.2, 0.7, true)); r.rotation.x = -Math.PI / 2; const s = new THREE.Mesh(SPH, rimM('#b03aff', 1.6, 2.4, 0.02)); s.scale.set(0.7, 1, 0.7); s.position.y = 0.9; g.add(r, s); g.userData.r = r; return g; });
      const [X, Y] = P(f.x, f.y); o.position.set(X, Y, zOf(f)); o.scale.setScalar(f.h * V3.SC * 0.6 * (1 + Math.sin(t * 0.3) * 0.08)); o.userData.r.rotation.z += 0.05;
    },
    // MOCHI's inhale: a suction cone off the mouth, rings of air travelling in, and a spiral of dust and
    // grit dragged off the floor. The whole thing pulses while Special is held.
    inhale(f, d, t) {
      if (t < 6 || t > 60) return;
      // th: the cone's tilt off horizontal. It was never declared here (the flame jet's local of the same name), so this
      // threw on every frame after the cone was made: a unit cone pointing at the sky over MOCHI (V3.fxErr found it).
      const th = 0, REACH = 2.3, mx = f.x + f.face * f.w * 0.45, my = f.y - f.h * 0.5;
      const [X, Y] = P(mx, my), Z = zOf(f);
      const pulse = 1 + Math.sin(t * 0.55) * 0.1, fade = t > 52 ? Math.max(0, 1 - (t - 52) / 8) : Math.min(1, (t - 6) / 4);
      const o = fx(f, 'ih', () => {
        const g = new THREE.Group();
        const c = new THREE.Mesh(CONE, streakM('#e0f8ff', 1.5, 0.42)); const c2 = new THREE.Mesh(CONE, glowM('#9ee8c8', 0.7, 0.14, true)); c2.scale.set(1.14, 1, 1.14);
        g.add(c, c2); g.userData.c = c; return g;
      });
      o.position.set(X, Y, Z); o.rotation.set(0, 0, (f.face > 0 ? -Math.PI / 2 + th : Math.PI / 2 - th));
      o.scale.set(0.44 * pulse * fade, REACH, 0.44 * pulse * fade); o.userData.c.rotation.y += 0.3;
      streakT.offset.y = (performance.now() / 1000 * 3.4) % 1;
      // rings of air running down the cone into the mouth
      const rings = fx(f, 'ihr', () => {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(TORUS, glowM('#dff6ff', 2, 0.6)); r.rotation.y = Math.PI / 2; g.add(r); }
        return g;
      });
      rings.position.set(X, Y, Z); rings.visible = fade > 0.05;
      rings.children.forEach((r, i) => {
        const k = 1 - ((t * 0.045 + i / 3) % 1);              // 1 = far out, 0 = at the mouth
        r.position.x = f.face * k * REACH; r.scale.setScalar((0.1 + k * 0.5) * pulse);
        r.material = glowM('#dff6ff', 2, Math.max(0, 0.5 * (1 - k) * fade + 0.12));
        r.rotation.z += 0.12;
      });
      // dust, grit and leaves spiralling in, a third of it scraped off the floor
      const mo = fx(f, 'ihm', () => {
        const n = 30, geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        const tex = canvasT(32, 32, (c, W) => { const gr = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, W); });
        const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, color: 0xffe9c8, size: 0.1, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
        p.frustumCulled = false; p.userData.n = n; return p;
      });
      const arr = mo.geometry.attributes.position.array, n = mo.userData.n, floorY = -f.y * V3.SC;
      for (let i = 0; i < n; i++) {
        const k = 1 - ((t * 0.03 + i * 0.137) % 1);                     // travels in
        const ang = i * 2.399 + t * 0.22, rad = (0.06 + k * 0.5) * (0.4 + (i % 5) * 0.2);
        const ground = i % 3 === 0;                                      // scraped off the deck
        arr[i * 3] = X + f.face * k * REACH * (0.35 + (i % 7) * 0.11);
        arr[i * 3 + 1] = (ground ? floorY + (Y - floorY) * (1 - k) : Y) + Math.cos(ang) * rad;
        arr[i * 3 + 2] = Z + Math.sin(ang) * rad * 0.7;
      }
      mo.geometry.attributes.position.needsUpdate = true;
      mo.material.opacity = 0.85 * fade; mo.material.size = 0.085 * pulse;
      // the mouth itself
      const gl = fx(f, 'ihg', () => new THREE.Mesh(SPH, glowM('#08131a', 1, 0.9)));
      gl.position.set(X, Y, Z + 0.02); gl.scale.setScalar(f.w * V3.SC * (0.24 + 0.05 * Math.sin(t * 0.6)) * fade);
    },
    stance(f, d, t) {
      const c = d.counter; if (!c || t < c[0] - 2 || t > c[1]) return;
      const o = fx(f, 'st', () => new THREE.Mesh(SPH, rimM(d.color || '#ffd23f', 2.2, 2.6, 0)));
      const [X, Y] = P(f.x, f.y - f.h * 0.5); o.position.set(X, Y, zOf(f) - 0.2); const k = 1 + Math.sin(t * 0.5) * 0.05; o.scale.set(f.w * 0.75 * V3.SC * k, f.h * 0.62 * V3.SC * k, f.w * 0.6 * V3.SC * k);
    },
    iaido(f, d, t) {
      FXF.stance(f, Object.assign({}, d, { color: '#e8f4ff' }), t);
      if (t >= 4 && t < 30) { const o = fx(f, 'gl', () => new THREE.Mesh(PLANE, glowM('#ffffff', 3, 0.9, true))); const [X, Y] = P(f.x + f.face * f.w * 0.1, f.y - f.h * 0.45); o.position.set(X, Y, zOf(f) + 0.1); o.scale.set(0.5 * (0.6 + Math.random() * 0.4), 0.012, 1); }
      const w = hbWin(d); if (w && t >= w[0] - 1 && t <= w[1] + 5) slash(f, 'sl', ...hbPos(f, d.hits[0]), d.hits[0].r * 1.4, d.weapon || '#e8f4ff', 1 - (t - w[1]) / 6, -0.15);
    },
    iai(f, d, t) { if (t <= 10) slash(f, 'ia', f.x + f.face * f.w * 0.9, f.y - f.h * 0.5, 70, d.weapon || '#e8f4ff', 1 - t / 10, 0.1); },
    slash(f, d, t) { const w = hbWin(d); if (w && t >= w[0] - 1 && t <= w[1] + 5) slash(f, 'sl', ...hbPos(f, d.hits[0]), d.hits[0].r, d.weapon || f.color, 1 - Math.max(0, t - w[1]) / 6, -0.55); },
    tail(f, d, t) { const w = hbWin(d); if (w && t >= w[0] - 1 && t <= w[1] + 4) slash(f, 'tl', ...hbPos(f, d.hits[0]), d.hits[0].r * 1.2, '#ff3a6e', 1 - Math.max(0, t - w[1]) / 5, 0.9); },
    cutter(f, d, t) { slash(f, 'ct', f.x + f.face * f.w * 0.35, f.y - f.h * (t < 22 ? 0.9 : 0.35), 44, d.color || '#ffe066', 0.9, t < 22 ? -1.2 : 1.6); },
    barrier(f, d, t) {
      const c = d.counter; if (!c || t < c[0] - 2 || t > c[1] + 2) return;
      const o = fx(f, 'br', () => { const g = new THREE.Group(); g.add(new THREE.Mesh(SPH, rimM(d.color || '#ff9ae8', 2.4, 1.6, 0.05))); const w = new THREE.Mesh(new THREE.IcosahedronGeometry(1.02, 1), new THREE.MeshBasicMaterial({ color: col3(d.color || '#ff9ae8', 1.5), wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(w); return g; });
      const [X, Y] = P(f.x, f.y - f.h * 0.5); o.position.set(X, Y, zOf(f)); o.scale.setScalar(f.h * 0.72 * V3.SC * (1 + Math.sin(t * 0.6) * 0.03)); o.rotation.y += 0.03;
    },
    confuse(f, d, t) {
      const R = d.reflect; if (!R || t < R[0] - 2 || t > R[1] + 2) return;
      const o = fx(f, 'cf', () => { const g = new THREE.Group(); const a = new THREE.Mesh(TORUS, glowM('#9a6cff', 2.4, 0.9)), b = new THREE.Mesh(TORUS, glowM('#4ff0ff', 2.4, 0.9)); b.scale.setScalar(0.7); g.add(a, b); g.userData.m = [a, b]; return g; });
      const [X, Y] = P(f.x + f.face * f.w * 0.7, f.y - f.h * 0.5); o.position.set(X, Y, zOf(f)); o.scale.setScalar(0.4); o.rotation.y = Math.PI / 2 * 0.8;
      o.userData.m[0].rotation.z += 0.3; o.userData.m[1].rotation.z -= 0.4;
    },
    disable(f, d, t) {
      if (t < 8 || t > 18) return;
      const o = fx(f, 'ds', () => { const g = new THREE.Group(); const a = new THREE.Mesh(PLANE, glowM('#ffffff', 3, 1, true)), b = a.clone(); a.scale.set(0.9, 0.04, 1); b.scale.set(0.04, 0.5, 1); g.add(a, b, new THREE.Mesh(SPH_LO, glowM(d.color || '#c9a6ff', 2.4, 0.9))); g.children[2].scale.setScalar(0.06); return g; });
      const [X, Y] = P(f.x + f.face * (f.w * 0.5 + 30), f.y - f.h * 0.72); o.position.set(X, Y, zOf(f) + 0.1); const k = t <= 12 ? (t - 7) / 5 : Math.max(0, 1 - (t - 12) / 6); o.scale.setScalar(k * 1.2); o.rotation.z = t * 0.1;
    },
    truck(f, d, t) {
      if (t < 5 || t > 38) return;
      const o = fx(f, 'tr', truckMesh);
      const k = Math.min(1, (t - 5) / 4, (38 - t) / 4);
      const [X, Y] = P(f.x, f.y); o.position.set(X, Y + 0.02, zOf(f) - 0.1); o.rotation.set(0, f.face < 0 ? Math.PI : 0, 0); o.scale.setScalar(f.h * V3.SC * 1.25 * k);
      aura(f, 'trd', f.x - f.face * f.w * 0.9, f.y - 6, 26, '#d0c8b8');
    },
    vine(f, d, t) {
      const S = seen.get(f); if (!S || t > 34) return;
      if (!S.anchor || S.anchorMv !== f.move) { S.anchor = [f.x + f.face * 150, f.y - f.h - 320]; S.anchorMv = f.move; }
      const o = fx(f, 'vn', vineMesh);
      const hx = f.x + f.face * f.w * 0.3, hy = f.y - f.h * 0.95, [ax, ay] = S.anchor;
      const [X0, Y0] = P(hx, hy), [X1, Y1] = P(ax, ay), L = Math.hypot(X1 - X0, Y1 - Y0);
      o.position.set(X0, Y0, zOf(f)); o.scale.set(1, L, 1); o.rotation.set(0, 0, Math.atan2(X1 - X0, Y1 - Y0) * -1);
    },
    pound(f, d, t) { if (t >= 8 && t <= 18) aura(f, 'pd', f.x, f.y - f.h * 0.55, 46, d.color || '#ffb347'); },
    // KAIJU's fire breath: a real held cone of flame off the mouth, not a puff. Three nested cones
    // (white core, rolling orange body, smoky edge) that flicker and stretch with the fuel left
    // (MV2.fuel, 21_roster2), heat shimmer over the top of it, and embers peeling off the tip.
    breath(f, d, t) {
      if (!(t >= 10 && f.move.t < (d.total - 6))) return;
      const fuel = f.fuel == null ? 1 : f.fuel, L = 1.05 + fuel * 1.15;
      // origin: the MOUTH. The rigs carry a `headfront` joint on the face (86_custom.js uses it for the
      // eye line), so the cone leaves the head wherever the head actually is, at any body size.
      let X, Y, Z = zOf(f);
      const av0 = V3._avatars && V3._avatars.get(f);
      const mouth = av0 && av0.bones && (av0.bones.headfront || av0.bones.Head);
      if (mouth) { mouth.getWorldPosition(tmpP); X = tmpP.x + f.face * 0.04; Y = tmpP.y - 0.05; Z = tmpP.z + 0.03; }
      else { const p0 = P(f.x + f.face * (f.w * 0.5 + 2), f.y - f.h * 0.7); X = p0[0]; Y = p0[1]; }
      // tilt: follow the flame the move is actually spitting, so an aimed breath points where it burns
      let th = 0;
      for (const pr of Game.projs) if (pr.owner === f && pr.kind === 'flame' && pr.age < 4) { th = Math.atan2(-pr.vy, Math.abs(pr.vx) || 1); break; }
      const dirX = Math.cos(th) * f.face, dirY = Math.sin(th);
      const o = fx(f, 'br', () => {
        const g = new THREE.Group();
        const out = new THREE.Mesh(CONE, streakM('#ff4a10', 1.5, 0.5));
        const mid = new THREE.Mesh(CONE, streakM('#ff9a2a', 2.2, 0.75));
        const core = new THREE.Mesh(CONE, glowM('#fff3c0', 2.8, 0.9));
        g.add(out, mid, core); g.userData.m = [core, mid, out];
        return g;
      });
      const fl = 0.86 + Math.random() * 0.28;
      o.position.set(X, Y, Z); o.rotation.set(0, 0, f.face > 0 ? -Math.PI / 2 : Math.PI / 2);
      const [core, mid, out] = o.userData.m;
      core.scale.set(0.15 * fl, L * 0.7, 0.15 * fl);
      mid.scale.set(0.3 * fl, L * 0.92, 0.3 * fl); mid.rotation.y += 0.33;
      out.scale.set(0.46 * (2 - fl), L, 0.46 * (2 - fl)); out.rotation.y -= 0.21;
      streakT.offset.y = (performance.now() / 1000 * 5) % 1;
      // heat shimmer: a wobbling haze sheet over the flame
      const hz = fx(f, 'brh', () => new THREE.Mesh(PLANE, streakM('#ffd8a0', 0.5, 0.16, true)));
      hz.position.set(X + dirX * L * 0.5, Y + dirY * L * 0.5 + 0.12, Z + 0.12);
      hz.scale.set(L * 1.05, 0.7 + Math.sin(performance.now() * 0.011) * 0.06, 1);
      hz.material = streakM('#ffd8a0', 0.5, 0.1 + Math.random() * 0.06, true);
      // embers peeling off the far end
      if (t % 2 === 0) for (let i = 0; i < 2; i++) sparks.push({
        x: X + dirX * (L * (0.45 + Math.random() * 0.6)), y: Y + dirY * (L * (0.45 + Math.random() * 0.6)) + (Math.random() - 0.5) * 0.3 * L,
        vx: dirX * (0.01 + Math.random() * 0.03), vy: dirY * 0.02 + 0.012 + Math.random() * 0.02,
        t: 0, life: 22 + Math.random() * 22, c: Math.random() < 0.4 ? '#fff0b0' : '#ff8a2a' });
    },
    rock(f, d, t) {
      if (t > 22) return;
      const o = fx(f, 'rk2', () => { const m = new THREE.Mesh(rockGeo(1, 1, 0.3, 3), new THREE.MeshStandardMaterial({ color: 0x9a7a5a, roughness: 0.95, flatShading: true })); return m; });
      const [X, Y] = P(f.x + f.face * (f.w * 0.45 + Math.max(0, t - 12) * 3), f.y - f.h * 0.6); o.position.set(X, Y, zOf(f)); o.scale.setScalar(f.h * V3.SC * 0.2); o.rotation.x += 0.05;
      if (t < 16) aura(f, 'rka', f.x, f.y - f.h * 0.5, 60, '#d8b890');
    },
    rush(f, d, t) {
      const w = hbWin(d); if (!w || t < w[0] || t > w[1]) return;
      const o = fx(f, 'rs', () => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) g.add(new THREE.Mesh(SPH_LO, glowM(i % 2 ? (d.color || '#7ff0ff') : '#ffffff', 2.2, 0.8))); return g; });
      const [X, Y] = P(...hbPos(f, d.hits[0])); o.position.set(X, Y, zOf(f));
      for (const s of o.children) { s.position.set((Math.random() - 0.3) * 0.35 * f.face, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2); s.scale.setScalar(0.03 + Math.random() * 0.04); }
    },
    snake(f, d, t) { FXF.rush(f, Object.assign({}, d, { color: '#ffd23f' }), t); },
    // WOLVERINU's PROWL (67_unique): a held sprint, so this is not a hitbox effect -- it reads the
    // body's actual speed and lays horizontal streaks BEHIND him plus a low scrape at the claws.
    // `rush` would have put a clump of sparks at the shoulder and said nothing about running.
    // Materials are cloned because glowM caches by colour and these fade per frame.
    prowl(f, d, t) {
      const sp = Math.min(1, Math.abs(f.vx) / 19);
      if (t < 4 || sp < 0.15) return;
      const hex = f.feralT > 0 ? '#eaffb0' : (d.color || '#9bf000');
      const o = fx(f, 'pw', () => {
        const g = new THREE.Group();
        for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(PLANE, glowM(hex, i % 2 ? 2 : 2.6, 0.6, true).clone()); s.userData.i = i; g.add(s); }
        return g;
      });
      const [X, Y] = P(f.x, f.y - f.h * 0.45); o.position.set(X, Y, zOf(f) - 0.02);
      for (const s of o.children) {
        const i = s.userData.i, back = (0.3 + i * 0.22 + Math.random() * 0.25) * f.w * V3.SC;
        s.position.set(-back * f.face, (Math.random() - 0.5) * f.h * V3.SC * 0.72, (Math.random() - 0.5) * 0.14);
        s.scale.set(f.w * V3.SC * (0.45 + Math.random() * 0.95) * sp, f.h * V3.SC * (0.012 + Math.random() * 0.028), 1);
        s.material.color.set(col3(hex, (i % 2 ? 2 : 2.6) * HOT));
        s.material.opacity = sp * Math.max(0.05, 0.7 - i * 0.07);
      }
      aura(f, 'pwc', f.x - f.face * f.w * 0.3, f.y - 5, 20 * sp, hex);     // claws scraping the deck
    },
    nunchaku(f, d, t) {
      const w = hbWin(d); if (!w || t < w[0] - 2 || t > (d.hits[1] ? d.hits[1].f[1] : w[1]) + 2) return;
      const o = fx(f, 'nc', () => { const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.5 }); for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 8), m); c.position.x = s * 0.16; c.rotation.z = Math.PI / 2; g.add(c); } g.add(new THREE.Mesh(TORUS, glowM('#ffd23f', 1.6, 0.5))); g.children[2].scale.setScalar(0.3); return g; });
      const [X, Y] = P(f.x + f.face * (f.w * 0.5 + 16), f.y - f.h * 0.55); o.position.set(X, Y, zOf(f)); o.rotation.z = t * 1.3 * f.face; o.scale.setScalar(f.h * V3.SC * 1.2);
    },
    dragon(f, d, t) { const w = hbWin(d); if (w && t >= w[0] && t <= w[1]) aura(f, 'dg', f.x, f.y - f.h * 0.5, 60, d.color || '#ff3a3a'); },
    tiger(f, d, t) {
      const w = hbWin(d); if (!w || t < w[0] || t > w[1] + 4) return;
      const o = fx(f, 'tg', () => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(PLANE, glowM('#ffb347', 2.6, 0.9, true)); s.scale.set(0.5, 0.025, 1); s.position.y = (i - 1) * 0.08; g.add(s); } return g; });
      const [X, Y] = P(...hbPos(f, d.hits[0])); o.position.set(X, Y, zOf(f) + 0.1); o.rotation.z = -0.7 * f.face; o.scale.setScalar(Math.max(0.1, 1 - Math.max(0, t - w[1]) / 5));
    },
    knee(f, d, t) { const w = hbWin(d); if (w && t >= w[0] && t <= w[1]) aura(f, 'kn', ...hbPos(f, d.hits[0]), 26, '#ffffff'); },
    cap(f, d, t) {
      // 9/22: the shroom slot is AIRDROP now (2f_origins.js), so the glide is a real parachute — the purple
      // dome with yellow spots it used to draw was a mushroom cap. Orange/graphite gores, a mint hem, lines
      // down to the shoulders.
      if (t < 18) return;
      const o = fx(f, 'cp', () => {
        const g = new THREE.Group();
        const geo = DOME.clone(), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
        const A = new THREE.Color(0xff6a1a), B = new THREE.Color(0x2b2f36);
        for (let v = 0; v < pos.count; v++) { const gore = Math.floor((Math.atan2(pos.getZ(v), pos.getX(v)) + Math.PI) / (Math.PI / 4)) % 2; (gore ? A : B).toArray(col, v * 3); }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
        canopy.scale.set(1, 0.5, 1); g.add(canopy);
        const hem = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 40), new THREE.MeshStandardMaterial({ color: 0x5cffc2, emissive: 0x2cffa8, emissiveIntensity: 1.1 }));
        hem.rotation.x = Math.PI / 2; g.add(hem);
        const lineM = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.4 }), tip = new THREE.Vector3(0, -1.0, 0), up = new THREE.Vector3(0, 1, 0);
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, rim = new THREE.Vector3(Math.cos(a) * 0.96, 0, Math.sin(a) * 0.96), dir = rim.clone().sub(tip), len = dir.length();
          const ln = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), lineM);
          ln.position.copy(tip).addScaledVector(dir, 0.5); ln.quaternion.setFromUnitVectors(up, dir.normalize()); g.add(ln);
        }
        g.traverse(c => { if (c.isMesh) c.castShadow = true; });
        return g;
      });
      const [X, Y] = P(f.x, f.y - f.h * 1.9); o.position.set(X, Y, zOf(f) - 0.2); o.scale.setScalar(f.w * V3.SC * 1.25 * Math.min(1, (t - 18) / 6)); o.rotation.z = Math.sin(t * 0.08) * 0.12;
    },
    pistol(f, d, t) {
      // built with the grip at the group's origin so it can sit in the palm like the held props do
      const o = fx(f, 'gun', () => { const g = new THREE.Group(); const p = pistolMesh(); p.position.set(0.18, 0.28, 0); g.add(p); g.userData = p.userData; return g; });
      const shots = [8, 15, 22], shot = shots.find(sh => t >= sh && t <= sh + 3);
      const A = f.move.aimC || 0, s = f.move.aimS || 0;             // set below from the fight's aim
      const av = V3._avatars && V3._avatars.get(f);
      const hand = av && av.bones && (av.bones.RightHand || av.bones.RightForeArm);
      if (hand) { hand.getWorldPosition(o.position); o.position.z += 0.06; }
      else { const [X, Y] = P(f.x + f.face * (f.w * 0.5 + 2), f.y - f.h * 0.55); o.position.set(X, Y, zOf(f) + 0.02); }
      const tilt = Math.atan2(-(s || 0), 1) * (f.face > 0 ? 1 : -1);
      const kick = shot != null ? Math.max(0, 1 - (t - shot) / 3) : 0;
      o.rotation.set(0, f.face < 0 ? Math.PI : 0, tilt - kick * 0.35 * f.face);
      o.scale.setScalar(f.h * V3.SC * 0.62);
      const slide = o.userData.slide;
      if (slide) slide.position.x = -0.34 * kick;                   // the slide cycles straight back along the barrel
      o.userData.flash.visible = kick > 0.55;
      o.userData.flash.scale.setScalar((0.5 + Math.random() * 0.5) * (kick > 0.55 ? 1 : 0.01));
      if (shot != null && t === shot) {                             // one puff of smoke and one case per shot
        ejectShell(f, false);
        o.updateMatrixWorld(true);
        o.userData.flash.getWorldPosition(tmpP);                    // smoke leaves the real muzzle
        for (let i = 0; i < 3; i++) smokes.push({ x: tmpP.x + (Math.random() - 0.5) * 0.06, y0: tmpP.y, t: -i * 2, life: 40 + Math.random() * 20, small: true });
      }
    },
    cannon(f, d, t) { if (t >= 5 && t <= 14) aura(f, 'cn', f.x, f.y + 6, 40, '#3ec46d'); },
  };

  // ---- MOCHI's mallet: an oversized cartoon wooden hammer, head about as wide as MOCHI ----
  // Built grip-at-the-origin, shaft up +y, so the swing is one rotation about z.
  const MAL = {};
  function malletGrainTex() {
    return canvasT(256, 128, (c, W, Hh) => {
      c.fillStyle = '#c98a5e'; c.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 90; i++) {
        const y = Math.random() * Hh, a = 0.06 + Math.random() * 0.16;
        c.strokeStyle = `rgba(${90 + Math.random() * 40 | 0},${48 + Math.random() * 26 | 0},22,${a})`;
        c.lineWidth = 1 + Math.random() * 3.5; c.beginPath(); c.moveTo(0, y);
        for (let x = 0; x <= W; x += 24) c.lineTo(x, y + Math.sin(x * 0.05 + i) * 3.5);
        c.stroke();
      }
      for (let i = 0; i < 5; i++) { const x = Math.random() * W, y = Math.random() * Hh; c.strokeStyle = 'rgba(86,44,20,.5)'; c.lineWidth = 2; for (let r = 3; r < 16; r += 4) { c.beginPath(); c.ellipse(x, y, r, r * 0.6, 0.4, 0, 7); c.stroke(); } }
    });
  }
  function malletMesh() {
    if (!MAL.wood) {
      const tex = malletGrainTex(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 1);
      MAL.wood = new THREE.MeshStandardMaterial({ map: tex, color: 0xffe7d2, roughness: 0.62, metalness: 0.04 });
      MAL.shaft = new THREE.MeshStandardMaterial({ map: tex, color: 0xd8b48c, roughness: 0.7 });
      MAL.grip = new THREE.MeshStandardMaterial({ color: 0x5a2f22, roughness: 0.85 });
      MAL.band = new THREE.MeshStandardMaterial({ color: 0xe8b23a, metalness: 1, roughness: 0.22, envMapIntensity: 2 });
    }
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.062, 0.74, 14), MAL.shaft); shaft.position.y = 0.37; g.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.066, 0.26, 14), MAL.grip); grip.position.y = 0.13; g.add(grip);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), MAL.band); pom.position.y = 0.01; g.add(pom);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.62, 26), MAL.wood.clone());
    head.rotation.z = Math.PI / 2; head.position.y = 0.86; g.add(head);
    for (const x of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.30, 0.07, 26), MAL.wood); cap.rotation.z = Math.PI / 2; cap.position.set(x * 0.345, 0.86, 0); g.add(cap);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.303, 0.034, 8, 26), MAL.band); band.rotation.y = Math.PI / 2; band.position.set(x * 0.22, 0.86, 0); g.add(band);
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.035, 16), MAL.band); boss.rotation.z = Math.PI / 2; boss.position.set(x * 0.385, 0.86, 0); g.add(boss);
    }
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.09, 14), MAL.band); collar.position.y = 0.6; g.add(collar);
    const glow = new THREE.Mesh(SPH, glowM('#ff8a1a', 2, 0.4)); glow.position.y = 0.86; glow.visible = false; g.add(glow);
    g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    g.userData.head = head.material; g.userData.glow = glow;
    return g;
  }
  // The swing, shared with the fighter's arm pose (97_v3_pose reads this so the hands stay on the grip).
  // Negative = reared up and behind, positive = swung through to the front, so this is one 180+ degree arc.
  V3.malletAng = function (f, d, t) {
    if (!d.charge) return -t * 0.55;                                   // the air version is a spin
    const w = (d.hits && d.hits[0] && d.hits[0].f) || [16, 20];
    // 0 = STRAIGHT OVERHEAD, +90 degrees (1.57) = horizontal out front, +180 = straight down.
    //
    // 10/18, and this is the SHAPE, not the numbers: it swung from -0.55 (reared above the head) round
    // to 2.32, so contact landed 43 degrees BELOW horizontal after sweeping over the top. That is an
    // axe chop. Kirby's grounded Hammer Flip is a two-handed swing ACROSS, like a baseball bat: the
    // hammer cocks back over the rear shoulder, and the head meets the opponent out front at body
    // height. Nothing about it goes overhead.
    //
    // So: cock to -0.9 (52 degrees back off vertical, where a batter holds it) and make contact at
    // 1.57 — dead level, out front. The follow-through below then dips it to about 2.0 (25 degrees
    // under horizontal), which is where a bat finishes across the body.
    //
    // The arm pose does not need touching: pzMallet (97_v3_pose.mjs) reads this function and hands the
    // same angle to pzSwingArms, so the hands, the body lean and the hammer all come down together.
    const t0 = d.charge.at || 8, t1 = w[0], t2 = w[1], UP = -0.9, DOWN = 1.57;
    if (t <= t0) { const k = t0 ? t / t0 : 1; return UP * (1 - (1 - k) * (1 - k)); }        // wind-up, eases into the hold
    if (t < t1) { const k = (t - t0) / Math.max(1, t1 - t0); return UP + (DOWN - UP) * Math.pow(k, 1.75); }   // heavy, accelerating
    if (t <= t2) return DOWN + (t - t1) * 0.045;                                            // buried in the deck
    return Math.min(DOWN + 0.42, DOWN + (t2 - t1) * 0.045 + (t - t2) * 0.014);              // the weight drags it on
  };

  // ---- TOP G's ride ----
  // The real car is assets/car_glb.wasm: an ORIGINAL hypercar, no badges and no real manufacturer's
  // shape, modelled from a studio render of an invented design. It is fetched the first time the move
  // runs (one fighter's special should not cost every match a megabyte), and until it lands the
  // procedural car below stands in. Normalised on arrival: length along +x, wheels on y = 0, nose
  // forward, 2.5 units long.
  const CARM = { scene: null, started: false, fit: null };
  function carModelLoad() {
    if (CARM.started || typeof gltf === 'undefined' || !gltf || !texL) return;
    CARM.started = true;
    (async () => {
      try {
        const g = await gltf.loadAsync(ASSET + 'car_glb.wasm');
        const tex = await texL.loadAsync(ASSET + 'car_tex.jpg');
        tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        g.scene.traverse(o => {
          if (!o.isMesh) return;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          o.material = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.26, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.4 });
          o.castShadow = true; o.frustumCulled = false;
          // cached once and cloned per drive: keep V3.disposeArena (90_v3_core) off it
          o.material.userData.shared = true; o.geometry.userData.shared = true; tex.userData.shared = true;
        });
        // normalise: longest horizontal axis becomes the length, nose to +x, wheels on the floor
        const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
        const wrap = new THREE.Group(), inner = new THREE.Group();
        inner.add(g.scene); wrap.add(inner);
        if (size.z > size.x) { inner.rotation.y = Math.PI / 2; }                 // length was along z
        inner.position.set(-mid.x, -box.min.y, -mid.z);
        if (size.z > size.x) inner.position.set(-mid.z, -box.min.y, mid.x);      // rotated: swap the offsets
        const len = Math.max(size.x, size.z), s = 2.5 / len;
        wrap.scale.setScalar(s);
        CARM.scene = wrap; CARM.raw = g.scene; CARM.size = size; CARM.len = len;
        CARM.h = size.y * s; CARM.w = Math.min(size.x, size.z) * s;
      } catch (e) { V3.fxErr(e, '94_v3_moves:868'); /* the procedural car stays */ }
    })();
  }
  // Which way round is it? A hypercar's tall end is the one with the wing, so the taller half is the
  // TAIL. Measured once, on the normalised model.
  function carNoseFlip(wrap) {
    const raw = CARM.raw; if (!raw || CARM.flip != null) return CARM.flip || 0;
    let hiA = 0, hiB = 0;
    const b = new THREE.Box3().setFromObject(wrap), c = (b.min.x + b.max.x) / 2;
    const v = new THREE.Vector3();
    raw.traverse(o => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 7) {
        v.fromBufferAttribute(p, i); o.localToWorld(v); wrap.worldToLocal(v);
        if (v.x < c) { if (v.y > hiA) hiA = v.y; } else if (v.y > hiB) hiB = v.y;
      }
    });
    CARM.flip = hiB > hiA ? Math.PI : 0;   // the taller half sits at +x: turn it round so the nose leads
    return CARM.flip;
  }
  // The stand-in, and what the runaway car still uses if the model never arrives.
  // The body is LOFTED: a rounded cross-section (a squircle, flatter underneath) swept along a set of
  // stations, so the surface curves like real bodywork instead of reading as a flat extruded slab.
  // Built +x forward, y = 0 on the road, z across.
  function loftGeo(stations, segs = 28, capEnds = true) {
    const pos = [], idx = [], N = stations.length;
    const pt = (st, a) => {
      const s = Math.sin(a), c = Math.cos(a), n = c >= 0 ? st.n || 3.2 : st.nb || 5.5;   // rounder on top, flatter below
      const e = 2 / n, cy = (st.y0 + st.y1) / 2, ry = (st.y1 - st.y0) / 2;
      return [st.x, cy + ry * Math.sign(c) * Math.pow(Math.abs(c), e), st.w * Math.sign(s) * Math.pow(Math.abs(s), e)];
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < segs; j++) { const p = pt(stations[i], j / segs * Math.PI * 2); pos.push(p[0], p[1], p[2]); }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs;
      idx.push(a, b, a + segs, b, b + segs, a + segs);
    }
    if (capEnds) for (const [i, flip] of [[0, true], [N - 1, false]]) {
      const c = pos.length / 3, s = stations[i]; pos.push(s.x, (s.y0 + s.y1) / 2, 0);
      for (let j = 0; j < segs; j++) { const a = i * segs + j, b = i * segs + (j + 1) % segs; idx.push(flip ? b : a, flip ? a : b, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const CAR_PAINT = 0x1f4fe0;   // hypercar blue: bright enough that the clearcoat highlights read at match scale
  const CAR_LONG = 1.26;   // hypercar proportions: ~2.2 lengths to a width, wheels well under body height
  function carProcMesh() {
    const g = new THREE.Group();
    const body = new THREE.Group(); body.scale.x = CAR_LONG; g.add(body);   // stretched along the car only
    const phys = (o) => new THREE.MeshPhysicalMaterial(o);
    const paint = phys({ color: CAR_PAINT, metalness: 0.55, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3.2 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.45, roughness: 0.42, envMapIntensity: 1.2 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe4ee, metalness: 1, roughness: 0.06, envMapIntensity: 2.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.92, metalness: 0 });
    const glass = phys({ color: 0x0a1020, metalness: 0.4, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.72, envMapIntensity: 2.8 });
    // main body: wide haunches over each axle, a pinched waist, a pointed nose and a cut-off tail
    const shell = new THREE.Mesh(loftGeo([
      { x: -1.00, w: 0.40, y0: 0.17, y1: 0.34 }, { x: -0.93, w: 0.50, y0: 0.13, y1: 0.42 },
      { x: -0.80, w: 0.545, y0: 0.10, y1: 0.47 }, { x: -0.62, w: 0.56, y0: 0.09, y1: 0.48 },
      { x: -0.44, w: 0.52, y0: 0.09, y1: 0.45 }, { x: -0.24, w: 0.485, y0: 0.09, y1: 0.42 },
      { x: 0.00, w: 0.48, y0: 0.09, y1: 0.39 }, { x: 0.22, w: 0.49, y0: 0.09, y1: 0.35 },
      { x: 0.44, w: 0.535, y0: 0.09, y1: 0.32 }, { x: 0.62, w: 0.55, y0: 0.10, y1: 0.31 },
      { x: 0.80, w: 0.50, y0: 0.11, y1: 0.30 }, { x: 0.92, w: 0.41, y0: 0.13, y1: 0.28 },
      { x: 1.00, w: 0.28, y0: 0.16, y1: 0.25 },
    ]), paint);
    body.add(shell);
    // greenhouse: a tapered canopy, tinted
    const cab = new THREE.Mesh(loftGeo([
      { x: -0.56, w: 0.26, y0: 0.40, y1: 0.44, n: 2.6 }, { x: -0.40, w: 0.345, y0: 0.38, y1: 0.60, n: 2.6 },
      { x: -0.16, w: 0.375, y0: 0.38, y1: 0.655, n: 2.6 }, { x: 0.08, w: 0.35, y0: 0.36, y1: 0.61, n: 2.6 },
      { x: 0.30, w: 0.27, y0: 0.33, y1: 0.47, n: 2.6 },
    ], 24), glass);
    body.add(cab);
    // roof + A-pillars in body colour so the canopy reads as glass between them
    const roof = new THREE.Mesh(loftGeo([
      { x: -0.44, w: 0.30, y0: 0.60, y1: 0.63, n: 2.6 }, { x: -0.20, w: 0.325, y0: 0.645, y1: 0.675, n: 2.6 },
      { x: 0.02, w: 0.30, y0: 0.60, y1: 0.63, n: 2.6 },
    ], 20), paint);
    body.add(roof);
    const box = (w, h, d, m, x, y, z, rz) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (rz) b.rotation.z = rz; body.add(b); return b; };
    box(0.30, 0.035, 1.02, carbon, 0.90, 0.075, 0, -0.06);           // front splitter
    for (const z of [-0.52, 0.52]) box(0.95, 0.05, 0.10, carbon, 0.02, 0.085, z, 0.01);   // side skirts
    box(0.22, 0.14, 0.86, carbon, -0.94, 0.14, 0);                    // rear diffuser
    for (let i = -2; i <= 2; i++) box(0.2, 0.12, 0.022, chrome, -0.95, 0.14, i * 0.17);   // diffuser fins
    for (const z of [-0.5, 0.5]) box(0.34, 0.16, 0.06, carbon, -0.32, 0.30, z, 0.12);     // side intakes
    // detailing: two-tone rocker, the side blade, mirrors, roof scoop, engine deck slats and front vents
    const dark = phys({ color: 0x070d2a, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.6 });
    for (const z of [-1, 1]) {
      const rock = new THREE.Mesh(loftGeo([
        { x: -0.72, w: 0.13, y0: 0.10, y1: 0.24, n: 2.4 }, { x: -0.3, w: 0.145, y0: 0.095, y1: 0.26, n: 2.4 },
        { x: 0.2, w: 0.14, y0: 0.095, y1: 0.25, n: 2.4 }, { x: 0.66, w: 0.12, y0: 0.10, y1: 0.24, n: 2.4 },
      ], 14), dark);
      rock.position.z = z * 0.43; body.add(rock);                                     // two-tone lower body
      box(0.5, 0.02, 0.05, chrome, -0.22, 0.30, z * 0.53, 0.06);                   // chrome side blade
      const arm = box(0.05, 0.035, 0.1, carbon, 0.2, 0.47, z * 0.5);               // mirror stalk
      arm.rotation.y = z * 0.25;
      const mir = box(0.05, 0.09, 0.12, carbon, 0.18, 0.5, z * 0.58); mir.rotation.y = z * 0.3;
      const gl2 = box(0.012, 0.07, 0.1, glass, 0.155, 0.5, z * 0.585); gl2.rotation.y = z * 0.3;
      box(0.16, 0.03, 0.12, carbon, 0.62, 0.20, z * 0.36, -0.1);                   // front air-dam vents
    }
    const scoop = box(0.26, 0.08, 0.26, carbon, -0.42, 0.62, 0, -0.1);             // roof feed to the engine
    scoop.scale.set(1, 1, 1);
    for (let i = -3; i <= 3; i++) box(0.26, 0.015, 0.035, carbon, -0.62, 0.47 - Math.abs(i) * 0.004, i * 0.075, -0.16);   // engine deck slats
    for (const z of [-0.33, 0.33]) box(0.05, 0.012, 0.16, chrome, 0.88, 0.205, z);  // lower light bar trim
    // rear wing
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.035, 0.94), carbon); wing.position.set(-0.86, 0.60, 0); wing.rotation.z = 0.16; body.add(wing);
    for (const z of [-0.47, 0.47]) { const ep = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.17, 0.02), carbon); ep.position.set(-0.86, 0.56, z); body.add(ep); }
    for (const z of [-0.26, 0.26]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04), chrome); st.position.set(-0.82, 0.50, z); body.add(st); }
    // lights: slim headlight blades with a glow, and a full-width tail bar
    for (const z of [-0.36, 0.36]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.22), glowM('#eaf4ff', 3, 1)); hl.position.set(0.935, 0.26, z); hl.rotation.y = z > 0 ? -0.2 : 0.2; body.add(hl);
      const hb = new THREE.Mesh(PLANE, glowM('#cfe6ff', 1.5, 0.55, true)); hb.scale.set(0.5, 0.26, 1); hb.position.set(1.02, 0.26, z); hb.rotation.y = Math.PI / 2; body.add(hb);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.80), glowM('#ff2338', 2.6, 1)); tail.position.set(-0.985, 0.345, 0); body.add(tail);
    const tglow = new THREE.Mesh(PLANE, glowM('#ff2338', 1.2, 0.5, true)); tglow.scale.set(0.34, 1.0, 1); tglow.position.set(-1.06, 0.345, 0); tglow.rotation.y = Math.PI / 2; body.add(tglow);
    for (const z of [-0.14, 0.14]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 14), chrome); ex.rotation.z = Math.PI / 2; ex.position.set(-1.0, 0.18, z); body.add(ex); }
    // Wheels. The face of the rim has to sit PROUD of the tyre or the camera only ever sees black rubber
    // (which is exactly what made the first pass look like a toy): tread band, sidewall bulge, then the
    // dished rim, spokes, drilled disc and caliper all stacked outwards on the side facing the camera.
    const wheels = [];
    const discM = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 1, roughness: 0.3, envMapIntensity: 2 });
    const calM = new THREE.MeshStandardMaterial({ color: 0xd8232a, roughness: 0.3, metalness: 0.3, emissive: 0x3a0000 });
    for (const [wx, r] of [[0.78, 0.208], [-0.80, 0.228]]) for (const z of [-0.47, 0.47]) {
      const s = Math.sign(z), W = 0.105;                      // half width of the tyre
      const hub = new THREE.Group(); hub.position.set(wx, r, z); g.add(hub); wheels.push(hub);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, W * 2, 30), rubber); tyre.rotation.x = Math.PI / 2; hub.add(tyre);
      for (const t of [-1, 1]) { const sh = new THREE.Mesh(new THREE.TorusGeometry(r - 0.028, 0.03, 8, 26), rubber); sh.position.z = t * W; hub.add(sh); }
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.075, r - 0.075, 0.022, 26), discM);
      disc.rotation.x = Math.PI / 2; disc.position.z = s * (W - 0.03); hub.add(disc);      // brake disc, seen through the spokes
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.14, 0.055), calM);
      cal.position.set(-0.03, r - 0.13, s * (W - 0.005)); hub.add(cal);                    // caliper
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.055, r - 0.075, 0.05, 26), chrome);
      rim.rotation.x = Math.PI / 2; rim.position.z = s * (W + 0.012); hub.add(rim);        // dished rim lip, proud of the tyre
      for (let i = 0; i < 5; i++) {                                                        // five spokes across the face
        const sp = new THREE.Mesh(new THREE.BoxGeometry(r - 0.07, 0.05, 0.03), chrome);
        sp.position.set(Math.cos(i * 1.2566) * (r - 0.07) / 2, Math.sin(i * 1.2566) * (r - 0.07) / 2, s * (W + 0.03));
        sp.rotation.z = i * 1.2566; hub.add(sp);
      }
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 12), chrome);
      nut.rotation.x = Math.PI / 2; nut.position.z = s * (W + 0.045); hub.add(nut);        // centre lock
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.028, 6, 22, Math.PI), carbon);
      arch.position.set(0, 0, s * (W + 0.005)); hub.add(arch);                             // arch lip over the top
    }
    g.userData.wheels = wheels;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  // fills a group with whichever car we have: the real model once it has loaded, the built one until then
  function carFill(g) {
    for (let i = g.children.length - 1; i >= 0; i--) g.remove(g.children[i]);
    if (CARM.scene) {
      const m = CARM.scene.clone(true);
      m.rotation.y = carNoseFlip(CARM.scene);
      g.add(m); g.userData.model = true; g.userData.wheels = [];
      const H = CARM.h || 0.7, W = CARM.w || 1.1;
      for (const z of [-0.34, 0.34]) {                                  // headlights burning at night
        const hl = new THREE.Mesh(PLANE, glowM('#dfeeff', 1.8, 0.7, true));
        hl.scale.set(0.42, H * 0.2, 1); hl.position.set(1.2, H * 0.45, z * W); hl.rotation.y = Math.PI / 2; g.add(hl);
      }
      const tl = new THREE.Mesh(PLANE, glowM('#ff2338', 1.6, 0.65, true));
      tl.scale.set(0.34, H * 0.12, 1); tl.position.set(-1.24, H * 0.5, 0); tl.rotation.y = Math.PI / 2; g.add(tl);
      g.userData.lamps = [tl];
    } else {
      const p = carProcMesh(); g.add(p); g.userData.model = false; g.userData.wheels = p.userData.wheels || [];
    }
    return g;
  }
  function carMesh() { carModelLoad(); return carFill(new THREE.Group()); }
  // an unbranded modern polymer pistol: squared slide with serrations, sights, rail, textured grip.
  // Built pointing along +x, grip down, so it sits in the hand and points where the fighter aims.
  function pistolMesh() {
    const g = new THREE.Group();
    const poly = new THREE.MeshStandardMaterial({ color: 0x1c1e24, metalness: 0.25, roughness: 0.62 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f49, metalness: 0.9, roughness: 0.32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0d0f13, metalness: 0.5, roughness: 0.5 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.16), poly); frame.position.set(0.04, 0, 0); g.add(frame);
    const slide = new THREE.Group();
    const sl = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.17), steel); sl.position.set(0.06, 0.13, 0); slide.add(sl);
    for (let i = 0; i < 5; i++) { const sr = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.175), dark); sr.position.set(-0.18 + i * 0.03, 0.13, 0); slide.add(sr); }
    for (let i = 0; i < 3; i++) { const sr = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.175), dark); sr.position.set(0.2 + i * 0.03, 0.13, 0); slide.add(sr); }
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.02), dark); port.position.set(0.1, 0.16, 0.085); slide.add(port);
    const rs = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.16), dark); rs.position.set(-0.22, 0.23, 0); slide.add(rs);
    const fs = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.04), dark); fs.position.set(0.35, 0.23, 0); slide.add(fs);
    g.add(slide);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 14), steel); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.42, 0.13, 0); g.add(barrel);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.1), dark); rail.position.set(0.2, -0.07, 0); g.add(rail);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.44, 0.15), poly); grip.position.set(-0.16, -0.24, 0); grip.rotation.z = 0.22; g.add(grip);
    for (let i = 0; i < 4; i++) { const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.02, 0.155), dark); t2.position.set(-0.16 + i * 0.012, -0.12 - i * 0.09, 0); t2.rotation.z = 0.22; g.add(t2); }
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.16), steel); mag.position.set(-0.26, -0.46, 0); mag.rotation.z = 0.22; g.add(mag);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 8, 18, Math.PI * 1.15), poly); guard.position.set(-0.02, -0.14, 0); guard.rotation.z = -0.5; g.add(guard);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.04), steel); trig.position.set(-0.03, -0.1, 0); g.add(trig);
    const flash = new THREE.Group();
    const fa = new THREE.Mesh(PLANE, glowM('#fff3c0', 2.4, 1, true)), fb = fa.clone();
    fa.scale.set(0.38, 0.1, 1); fb.scale.set(0.1, 0.3, 1);
    const fc = new THREE.Mesh(SPH_LO, glowM('#ffd08a', 2, 0.9)); fc.scale.setScalar(0.07);
    flash.add(fa, fb, fc); flash.position.set(0.52, 0.13, 0); g.add(flash);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData.slide = slide; g.userData.flash = flash; flash.visible = false;
    return g;
  }
  // weapons: muzzle flashes and the sniper's laser sight
  const muzzleAt = f => [f.x + f.face * (f.w * 0.5 + 20), f.y - f.h * 0.6];
  function flash(f, name, size, hex) {
    const o = fx(f, name, () => { const g = new THREE.Group(); const a = new THREE.Mesh(PLANE, glowM('#fff4c0', 2.2, 1, true)), b = a.clone(); a.scale.set(1, 0.22, 1); b.scale.set(0.22, 1, 1); g.add(a, b, new THREE.Mesh(SPH_LO, glowM(hex, 1.6, 0.8))); g.children[2].scale.setScalar(0.3); return g; });
    const [X, Y] = P(...muzzleAt(f)); o.position.set(X, Y, zOf(f) + 0.1); o.scale.setScalar(size * (0.8 + Math.random() * 0.4)); o.rotation.z = Math.random() * 0.8;
  }
  FXF.muzzle = (f, d, t) => {
    if (t <= 4) flash(f, 'mz', 0.32, '#ffb347');
    if (t === 2) { const k = f.item && f.item.kind; ejectShell(f, k === 'shotgun'); const [MX, MY] = P(...muzzleAt(f)); for (let i = 0; i < 4; i++) smokes.push({ x: MX + (Math.random() - 0.5) * 0.1, y0: MY, t: -i * 2, life: 50 + Math.random() * 25, small: true }); }
  };
  FXF.burst = (f, d, t) => {
    if (t >= 6 && t <= 41 && (t - 6) % 7 < 2) flash(f, 'mz', 0.2, '#ffe27a');
    if (t >= 6 && t <= 41 && (t - 6) % 7 === 0) ejectShell(f, false);
  };
  FXF.scope = (f, d, t) => {
    if (t < 26) {
      const o = fx(f, 'ls', () => { const g = new THREE.Group(); const l = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), glowM('#ff2a3a', 1.8, 0.8)); l.rotation.z = -Math.PI / 2; l.position.x = 0.5; g.add(l); const dot = new THREE.Mesh(SPH_LO, glowM('#ff4a4a', 2, 1)); dot.position.x = 1; g.add(dot); g.userData.dot = dot; return g; });
      const [X, Y] = P(...muzzleAt(f)), L = 8, up = f.move.up || 0;
      o.position.set(X, Y, zOf(f) + 0.05); o.rotation.set(0, 0, (f.face > 0 ? 0 : Math.PI) + f.face * Math.atan2(up * 9, 58)); o.scale.set(L, 0.009 + Math.random() * 0.003, 0.009);
      o.userData.dot.scale.set(0.02 / L, 2.4, 2.4);
    } else if (t <= 30) { flash(f, 'mz', 0.45, '#9ff4ff'); if (t === 27) ejectShell(f, true); }
  };
  // TOP G's car: it carries him across the stage, headlights first
  FXF.bugatti = (f, d, t) => {
    if (t < 8 || t > 74) return;
    const o = fx(f, 'car', carMesh), k = Math.min(1, (t - 8) / 5, (74 - t) / 6);
    if (!o.userData.model && CARM.scene) carFill(o);   // the real car finished downloading mid-move
    const [X, Y] = P(f.x, f.y);
    const S = f.h * V3.SC * 1.45 * Math.max(0.05, k), driving = t > 13 && t < 68;
    o.position.set(X, Y, zOf(f) - 0.12);
    // launch squat, then a touch of body float, and it settles under braking
    const pitch = t < 16 ? -0.16 * (1 - (t - 8) / 8) : t > 66 ? 0.1 * Math.min(1, (t - 66) / 4) : Math.sin(t * 0.35) * 0.012;
    o.rotation.set(0, f.face < 0 ? Math.PI : 0, pitch * (f.face < 0 ? -1 : 1));
    o.scale.setScalar(S);
    for (const w of o.userData.wheels || []) w.rotation.z -= driving ? 1.15 : 0.15;   // wheels spin with the run
    if (driving) {
      // speed lines streaming off the tail, and dust kicked up under the wheels
      for (let i = 0; i < 3; i++) {
        const ln = fx(f, 'cl' + i, () => { const m = new THREE.Mesh(PLANE, glowM('#cfe4ff', 1.5, 0.5, true)); m.renderOrder = 4; return m; });
        const sp = 1.4 + Math.random() * 2.6;
        ln.position.set(X - f.face * (S * (0.9 + Math.random() * 1.9)), Y + S * (0.18 + Math.random() * 0.55), zOf(f) + 0.25);
        ln.scale.set(S * sp, S * 0.018, 1); ln.material.opacity = 0.25 + Math.random() * 0.3;
      }
      aura(f, 'carsmoke', f.x - f.face * f.w * 1.1, f.y - 8, 26, '#cfd4e8');
      aura(f, 'carsmoke2', f.x - f.face * f.w * 2.2, f.y - 4, 34, '#e8ecf4');
      const gl = fx(f, 'cglow', () => new THREE.Mesh(PLANE, glowM('#ffe6b0', 1.1, 0.4, true)));   // headlight wash on the road
      gl.position.set(X + f.face * S * 1.5, Y + 0.02, zOf(f) - 0.3); gl.rotation.set(-Math.PI / 2, 0, 0); gl.scale.set(S * 2.2, S * 1.3, 1);
      gl.material.opacity = 0.22 + Math.sin(t * 0.7) * 0.05;
      // contact shadow: fx objects never cast one, and without it the car reads as floating
      const sh = fx(f, 'cshadow', () => new THREE.Mesh(new THREE.CircleGeometry(1, 28), solidM('#05070c', 0.42)));
      sh.position.set(X - f.face * S * 0.05, Y + 0.012, zOf(f) - 0.28); sh.rotation.set(-Math.PI / 2, 0, 0); sh.scale.set(S * 1.02, S * 0.5, 1);
    }
  };
  // down attacks and the down-air spike: a boot-shaped arc so the kick reads
  FXF.downkick = (f, d, t) => {
    const w = hbWin(d); if (!w || t < w[0] - 1 || t > w[1] + 4) return;
    slash(f, 'dk', ...hbPos(f, d.hits[0]), (d.hits[0].r || 26) * 1.15, f.color, 1 - Math.max(0, t - w[1]) / 5, 1.9);
  };

  // ---------------- stand-in for fighters without a 3D model yet ----------------
  // a billboard with the 2D vector mascot (drawMascot) redrawn every frame from the fighter's pose
  class Standin {
    constructor(f) {
      this.f = f; this.placeholder = true;
      this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = 256; this.ctx = this.cv.getContext('2d');
      this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
      this.mesh = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: true, toneMapped: false }));
      this.shield = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: col3(f.color, 1.6), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.shield.visible = false; V3.scene.add(this.mesh, this.shield);
      this.s = 200 / (f.c.h * 1.35);   // canvas px per world px
    }
    update() {
      const f = this.f, dead = f.state === 'dead', g = this.ctx, s = this.s;
      this.mesh.visible = !dead; this.shield.visible = !dead && f.state === 'shield';
      if (dead) return;
      g.clearRect(0, 0, 256, 256);
      g.save(); g.translate(128, 236); g.scale(s, s);
      try { drawMascot(g, f.c, f.pose()); } catch (e) { V3.fxErr(e, '94_v3_moves:1147'); /* drawing is cosmetic */ }
      g.restore(); this.tex.needsUpdate = true;
      const W = 256 / s * V3.SC, z = (f.idx - 1.5) * 0.06;
      this.mesh.scale.set(W * f.face, W, 1);
      this.mesh.position.set(f.x * V3.SC + (f.hitlag > 0 && f.state === 'hitstun' ? (Math.random() - 0.5) * 0.05 : 0), -(f.y - 108 / s) * V3.SC, z + 0.05);
      this.mesh.material.opacity = (f.invuln > 0 || f.intang) && Math.floor(f.t / 4) % 2 ? 0.55 : 1;
      if (this.shield.visible) { const r = f.h * V3.SC * 0.8 * (0.35 + 0.65 * f.shieldHP / 60); this.shield.scale.setScalar(r); this.shield.position.set(f.x * V3.SC, -f.y * V3.SC + f.h * V3.SC * 0.6, z); }
    }
    dispose() { V3.scene.remove(this.mesh, this.shield); this.tex.dispose(); this.mesh.material.dispose(); this.shield.material.dispose(); }
  }
  V3.placeholder = f => new Standin(f);

  // ---------------- item set 2: props, item effects, craters (56_items2.js) ----------------
  const IP = {};   // shared prop geometry / materials
  // sweeps a circle along an arc with a tapered radius: a smooth banana, not a torus slice
  function bananaGeo(N = 48, M = 20, R = 0.8, rad = 0.23, a0 = 0.18, a1 = Math.PI * 0.92) {
    const pos = [], nor = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = a0 + (a1 - a0) * u, cx = Math.cos(a) * R, cy = Math.sin(a) * R;
      const rr = rad * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.55) * (0.55 + 0.45 * Math.sin(Math.PI * u));
      for (let j = 0; j <= M; j++) {
        const v = j / M * Math.PI * 2, nx = Math.cos(a) * Math.cos(v), ny = Math.sin(a) * Math.cos(v), nz = Math.sin(v);
        pos.push(cx + nx * rr, cy + ny * rr, nz * rr * 0.86);
        nor.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j, b = a + M + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5 }, o || {}));
  function bananaMesh(s) {
    if (!IP.ban) {
      IP.ban = bananaGeo();
      IP.banM = std(0xffd83a, { roughness: 0.42, emissive: 0x4a3600, emissiveIntensity: 0.35 });
      IP.tip = new THREE.SphereGeometry(0.1, 12, 10); IP.tipM = std(0x4a2e10, { roughness: 0.8 });
      IP.fuse = new THREE.CylinderGeometry(0.022, 0.026, 0.34, 8); IP.fuseM = std(0x2a2a2a, { roughness: 0.9 });
    }
    const g = new THREE.Group(), b = new THREE.Mesh(IP.ban, IP.banM); b.castShadow = true; g.add(b);
    for (const a of [0.18, Math.PI * 0.92]) { const t = new THREE.Mesh(IP.tip, IP.tipM); t.position.set(Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0); t.scale.set(0.9, 0.9, 0.8); g.add(t); }
    const fz = new THREE.Mesh(IP.fuse, IP.fuseM); fz.position.set(Math.cos(Math.PI * 0.92) * 0.8 - 0.04, Math.sin(Math.PI * 0.92) * 0.8 + 0.2, 0); fz.rotation.z = 0.5; g.add(fz);
    const sp = new THREE.Mesh(SPH_LO, glowM('#ffd08a', 2.6, 1)); sp.scale.setScalar(0.09); sp.position.set(fz.position.x - 0.1, fz.position.y + 0.18, 0); g.add(sp); g.userData.spark = sp;
    g.rotation.z = -0.35; g.scale.setScalar(s); g.position.y = 0.16 * s / 0.27;
    return g;
  }
  function labelTex(txt, bg, fg) { return canvasT(256, 128, (c, W, H) => { c.fillStyle = bg; c.fillRect(0, 0, W, H); c.fillStyle = fg; c.font = 'bold 84px Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, W / 2, H / 2 + 4); c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(8, 8, W - 16, H - 16); }); }
  function woodTex() { return canvasT(256, 256, (c, W, H) => { for (let i = 0; i < 6; i++) { c.fillStyle = `hsl(${30 + Math.random() * 6},${45 + Math.random() * 10}%,${34 + Math.random() * 8}%)`; c.fillRect(0, i * H / 6, W, H / 6 - 3); c.fillStyle = 'rgba(40,20,8,.8)'; c.fillRect(0, i * H / 6 + H / 6 - 3, W, 3); } c.strokeStyle = '#5a3414'; c.lineWidth = 18; c.strokeRect(9, 9, W - 18, H - 18); c.beginPath(); c.moveTo(14, 14); c.lineTo(W - 14, H - 14); c.stroke(); c.fillStyle = '#c8c8d0'; for (const [x, y] of [[20, 20], [W - 20, 20], [20, H - 20], [W - 20, H - 20]]) { c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); } }); }
  // a red rocket pack: glossy body, chrome trim, twin tanks with rounded caps, straps, control panel,
  // two nozzles with heat-blued tips. Built around the origin: +y up, +z the wearer's back, 1 unit tall.
  function jetpackMesh(targetW) {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xc41616, metalness: 0.3, roughness: 0.18 });
    const redDark = new THREE.MeshStandardMaterial({ color: 0x8c0d0d, metalness: 0.35, roughness: 0.25 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 1, roughness: 0.16 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.4, roughness: 0.55 });
    const blued = new THREE.MeshStandardMaterial({ color: 0x2a3550, metalness: 0.95, roughness: 0.3 });
    // back plate that sits flush against the spine
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.16), red); plate.position.set(0, 0.06, 0.1); g.add(plate);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 0.02), chrome); spine.position.set(0, 0.06, 0.02); g.add(spine);
    // twin tanks with rounded caps
    for (const x of [-0.2, 0.2]) {
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 8, 22), red); tank.position.set(x, 0.1, 0.3); g.add(tank);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.022, 10, 26), chrome); band.rotation.x = Math.PI / 2; band.position.set(x, 0.12, 0.3); g.add(band);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 12), chrome); cap.position.set(x, 0.42, 0.3); g.add(cap);
      // nozzle: cone down, heat-blued tip
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.16, 18), black); nz.position.set(x, -0.28, 0.3); g.add(nz);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.088, 0.06, 18), blued); tip.position.set(x, -0.38, 0.3); g.add(tip);
    }
    // shoulder straps, over the top and down the chest
    for (const x of [-0.26, 0.26]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.06), black); st.position.set(x, 0.42, -0.02); st.rotation.x = -0.5; g.add(st);
      const cl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.07), chrome); cl.position.set(x, 0.2, -0.24); g.add(cl);
    }
    // control panel with a live light
    const pan = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.05), redDark); pan.position.set(0.02, 0.3, 0.02); pan.rotation.x = 0.25; g.add(pan);
    const led = new THREE.Mesh(SPH_LO, glowM('#7dff9a', 2.4, 1)); led.scale.setScalar(0.028); led.position.set(0.02, 0.33, -0.02); g.add(led);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    g.userData.led = led;
     // Authored about 0.62 units across. Callers now ask for the width they want: on the ground
     // it was added unscaled (a jetpack bigger than the fighter), while the worn one was scaled
     // by a fraction meant for a 1-unit mesh, so it came out too small to see.
     if (targetW) {
       const bb = new THREE.Box3().setFromObject(g);
       const w = Math.max(1e-4, bb.max.x - bb.min.x);
       g.scale.setScalar(targetW / w);
     }
     return g;
  }
  V3.makeProp2 = function (kind, inner) {
    if (kind === 'banana') { inner.add(bananaMesh(0.27)); return true; }
    if (kind === 'banalet') { inner.add(bananaMesh(0.11)); return true; }
    if (kind === 'holy') {
      if (!IP.gold) { IP.gold = std(0xffc83a, { metalness: 1, roughness: 0.2, emissive: 0x6a4a00, emissiveIntensity: 0.9 }); }
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 18), IP.gold); b.position.y = 0.17; inner.add(b);
      for (const y of [0.1, 0.17, 0.24]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.165 * Math.cos((y - 0.17) * 6), 0.012, 6, 32), IP.gold); r.rotation.x = Math.PI / 2; r.position.y = y; inner.add(r); }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 12), std(0xe8e0c8, { metalness: 0.8, roughness: 0.3 })); cap.position.y = 0.36; inner.add(cap);
      const halo = new THREE.Mesh(TORUS, glowM('#fff3b0', 2.6, 1)); halo.scale.setScalar(0.15); halo.rotation.x = Math.PI / 2 - 0.25; halo.position.y = 0.5; inner.add(halo);
      const glow = new THREE.Mesh(SPH, glowM('#ffe27a', 0.9, 0.35)); glow.scale.setScalar(0.3); glow.position.y = 0.2; inner.add(glow);
      return true;
    }
    if (kind === 'tnt') {
      if (!IP.tntM) { const lab = labelTex('TNT', '#c81e1e', '#fff0d0'); IP.tntM = [std(0xb01818), std(0xb01818), std(0x8a1010), std(0x8a1010), new THREE.MeshStandardMaterial({ map: lab, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: lab, roughness: 0.6 })]; }
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.24), IP.tntM); box.position.y = 0.13; inner.add(box);
      for (const x of [-0.11, 0.11]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.265, 0.245), std(0x2a2020)); b.position.set(x, 0.13, 0); inner.add(b); }
      const fz = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), std(0x2a2a2a)); fz.position.set(0.08, 0.31, 0); fz.rotation.z = -0.4; inner.add(fz);
      return true;
    }
    if (kind === 'jetpack') { inner.add(jetpackMesh(0.34)); return true; }
    if (kind === 'bubble') {
      const b = new THREE.Mesh(SPH, rimM('#9fe8ff', 2.2, 1.6, 0.05)); b.scale.setScalar(0.16); b.position.y = 0.2; inner.add(b);
      const b2 = new THREE.Mesh(SPH, rimM('#ff9ae8', 1.4, 3, 0)); b2.scale.setScalar(0.165); b2.position.y = 0.2; inner.add(b2);
      const hl = new THREE.Mesh(SPH_LO, glowM('#ffffff', 2, 0.8)); hl.scale.setScalar(0.03); hl.position.set(-0.06, 0.28, 0.12); inner.add(hl);
      return true;
    }
    // The Detonator ('mine') USED to be built here, as a three-pronged landmine on a cylinder.
    // It is a shop weapon now and the forge has a full SLAM-style charge for it
    // (src/92a_v3_props.mjs M.mine), which is also the model on its store card -- but makeProp0
    // (92_v3_items.mjs) asks makeProp2 BEFORE the forge, so this branch won the lookup and the
    // weapon in your hand was never the weapon you were sold. Removed 15 Oct; dev/store_test.js
    // fails the build if any shop kind is claimed here again.
    if (kind === 'crate') {
      if (!IP.crateM) IP.crateM = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.85 });
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.4), IP.crateM); c.position.y = 0.2; inner.add(c);
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.07, 5), glowM('#ffd45c', 1.8, 1, true)); star.position.set(0, 0.2, 0.205); inner.add(star);
      return true;
    }
    // weapons: toy-bright, grip at the origin, muzzle along +Y (how 92 holds props)
    const cyl = (r0, r1, h, mat, y, x = 0, z = 0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 14), mat); m.position.set(x, y, z); inner.add(m); return m; };
    const box = (w, h, d, mat, x, y, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); inner.add(m); return m; };
    if (kind === 'bazooka') {
      const tube = std(0x2f8a5a, { roughness: 0.45 }), band = std(0xffc83a, { metalness: 0.6, roughness: 0.3 }), dark = std(0x1c1f26, { roughness: 0.5 });
      cyl(0.055, 0.055, 0.66, tube, 0.2);
      for (const y of [0.0, 0.4]) cyl(0.06, 0.06, 0.04, band, y);
      cyl(0.075, 0.055, 0.08, dark, 0.55); cyl(0.05, 0.07, 0.07, dark, -0.16);
      box(0.03, 0.12, 0.05, dark, 0.07, 0.05); box(0.02, 0.05, 0.05, band, -0.06, 0.26);
      const tip = new THREE.Mesh(SPH_LO, glowM('#ff8a2a', 1.4, 0.8)); tip.scale.setScalar(0.03); tip.position.y = 0.6; inner.add(tip);
      return true;
    }
    if (kind === 'shotgun') {
      const steel = std(0x9aa0ac, { metalness: 0.9, roughness: 0.3 }), wood = std(0xa0582a, { roughness: 0.7 });
      cyl(0.018, 0.018, 0.44, steel, 0.3, -0.02); cyl(0.018, 0.018, 0.44, steel, 0.3, 0.02);
      box(0.07, 0.1, 0.05, steel, 0, 0.05); box(0.06, 0.2, 0.045, wood, 0, -0.1); box(0.055, 0.1, 0.05, wood, 0, 0.2);
      return true;
    }
    if (kind === 'mgun') {
      const steel = std(0x5a606c, { metalness: 0.9, roughness: 0.3 }), neon = glowM('#22e6ff', 1.6, 1);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(0.012, 0.012, 0.36, steel, 0.34, Math.cos(a) * 0.03, Math.sin(a) * 0.03); }
      cyl(0.05, 0.05, 0.04, steel, 0.5); box(0.11, 0.16, 0.08, std(0x2a2e38, { metalness: 0.6, roughness: 0.4 }), 0, 0.08);
      cyl(0.06, 0.06, 0.05, std(0xffc83a, { metalness: 0.7, roughness: 0.3 }), 0.02, 0.1, 0).rotation.z = Math.PI / 2;
      box(0.012, 0.12, 0.085, neon, 0.056, 0.08);
      return true;
    }
    if (kind === 'sniper') {
      const steel = std(0x2a2e38, { metalness: 0.8, roughness: 0.3 }), wood = std(0x6a4a8a, { roughness: 0.6 });
      cyl(0.012, 0.012, 0.66, steel, 0.4); cyl(0.022, 0.022, 0.03, steel, 0.73);
      box(0.06, 0.22, 0.045, wood, 0, -0.04); box(0.05, 0.09, 0.04, steel, 0, 0.1);
      const sc = cyl(0.024, 0.024, 0.2, steel, 0.2, -0.05); const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), glowM('#9ff4ff', 1.6, 1, true)); lens.rotation.x = -Math.PI / 2; lens.position.set(-0.05, 0.301, 0); inner.add(lens);
      return true;
    }
    return false;
  };
  // per-item effects: countdowns, sparks, parachutes, holy light
  const IFX = new Map();   // item -> { name: Object3D }
  function ifx(it, name, make) { let r = IFX.get(it); if (!r) IFX.set(it, r = {}); let o = r[name]; if (!o) { o = r[name] = make(); noShadow(o); V3.scene.add(o); } o.visible = true; o.userData.used = true; return o; }
  function countTex(n) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
    g.font = '900 96px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 14; g.strokeStyle = 'rgba(30,0,0,.95)'; g.strokeText(String(n), 128, 70); g.fillStyle = n <= 5 ? '#ff4a3a' : '#ffe27a'; g.fillText(String(n), 128, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function chuteMesh() {
    const g = new THREE.Group();
    const can = new THREE.Mesh(DOME, new THREE.MeshStandardMaterial({ map: canvasT(256, 64, (c, W, H) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ff4f8b' : '#fff4e0'; c.fillRect(i * W / 8, 0, W / 8, H); } }), side: THREE.DoubleSide, roughness: 0.8 }));
    can.scale.set(0.42, 0.2, 0.42); can.position.y = 0.75; g.add(can);
    const lm = new THREE.LineBasicMaterial({ color: 0xe8e0d0 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, gg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * 0.4, 0.75, Math.sin(a) * 0.4), new THREE.Vector3(0, 0.38, 0)]); g.add(new THREE.Line(gg, lm)); }
    return g;
  }
  // 99_v3_finish's shader warm-up builds one of these too: the first crate's parachute compiled its lit, double-sided
  // canopy program mid-fight (435 ms in a 9/22 playtest, frame 843)
  (V3.warmExtras = V3.warmExtras || []).push(chuteMesh);
  function itemsFrame() {
    for (const [it, r] of IFX) { if (!Game.items.includes(it)) { for (const o of Object.values(r)) V3.scene.remove(o); IFX.delete(it); continue; } for (const o of Object.values(r)) o.userData.used = false; }
    for (const it of Game.items) {
      const X = it.x * V3.SC, Y = -it.y * V3.SC;
      if (it.kind === 'tnt' && it.armed && it.fuse != null) {
        const n = Math.max(0, Math.ceil(it.fuse / 60));
        const o = ifx(it, 'cd', () => new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false })));
        if (o.userData.n !== n) { if (o.material.map) o.material.map.dispose(); o.material.map = countTex(n); o.material.needsUpdate = true; o.userData.n = n; }
        const pulse = n <= 5 ? 1 + Math.sin(performance.now() * 0.02) * 0.12 : 1;
        o.position.set(X, Y + 0.62, 0.6); o.scale.set(0.62 * pulse, 0.31 * pulse, 1); o.quaternion.copy(V3.camera.quaternion); o.renderOrder = 18;
      }
      if ((it.kind === 'tnt' || it.kind === 'banana' || it.kind === 'banalet' || it.kind === 'holy') && it.armed && it.fuse != null) {
        const s = ifx(it, 'sp', () => { const g = new THREE.Group(); g.add(new THREE.Mesh(SPH_LO, glowM('#fff0b0', 2.6, 1)), new THREE.Mesh(SPH_LO, glowM('#ff8a1a', 2, 0.7))); g.children[1].scale.setScalar(1.8); return g; });
        s.position.set(X + (Math.random() - 0.5) * 0.02, Y + (it.kind === 'tnt' ? 0.34 : 0.2), 0.3); s.scale.setScalar(0.025 + Math.random() * 0.02);
      }
      if (it.kind === 'holy') {
        const k = it.holyT > 0 ? 1 - it.holyT / 54 : 0;
        const o = ifx(it, 'hl', () => { const g = new THREE.Group(); const sh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.8, 1, 24, 1, true), streakM('#fff3b0', 1.1, 0.35)); sh.position.y = 0.5; g.add(sh); const ring = new THREE.Mesh(TORUS, glowM('#ffe27a', 2.4, 0.9)); ring.rotation.x = Math.PI / 2; g.add(ring); const core = new THREE.Mesh(SPH, rimM('#fff3b0', 2.6, 1.5, 0.2)); g.add(core); g.userData.m = [sh, ring, core]; return g; });
        const [sh, ring, core] = o.userData.m;
        o.position.set(X, Y + 0.2, 0.2);
        sh.visible = it.holyT > 0; sh.scale.set(0.16 + k * 0.14, 9, 0.16 + k * 0.14); sh.rotation.y += 0.02;
        ring.scale.setScalar(it.holyT > 0 ? 0.3 + k * 0.7 : 0.25); ring.rotation.z += 0.05;
        core.scale.setScalar(it.holyT > 0 ? 0.25 + k * 0.35 + Math.sin(performance.now() * 0.03) * 0.03 : 0.22);
      }
      if (it.kind === 'mine') {
        const armed = !(it.armT > 0), trig = it.fuse != null;
        const blink = trig ? (Math.floor(performance.now() / (60 + it.fuse * 1.2)) % 2) : armed ? (Math.floor(performance.now() / 420) % 2) : 0;
        const o = ifx(it, 'led', () => { const g = new THREE.Group(); g.add(new THREE.Mesh(SPH_LO, glowM('#ff3a3a', 2.6, 1))); const h = new THREE.Mesh(SPH_LO, glowM('#ff3a3a', 1.1, 0.4)); h.scale.setScalar(2.6); g.add(h); return g; });
        o.position.set(X, Y + 0.17, 0.25); o.scale.setScalar(blink ? 0.035 : 0.012); o.visible = armed || it.age % 30 < 15;
      }
      if (it.kind === 'crate' && it.chute) { const o = ifx(it, 'ch', chuteMesh); o.position.set(X, Y, 0.15); o.rotation.z = Math.sin(it.age * 0.045) * -0.18; o.scale.setScalar(1); }
    }
    for (const r of IFX.values()) for (const o of Object.values(r)) if (!o.userData.used) o.visible = false;
  }
  // fighters: bubble shield, jetpack flames, worn jetpack on the back
  function fighterItems(f) {
    if (f.state === 'dead') return;
    if (f.bubbleHits > 0) {
      const o = fx(f, 'bb', () => { const g = new THREE.Group(); g.add(new THREE.Mesh(SPH, rimM('#9fe8ff', 2.2, 1.7, 0.04)), new THREE.Mesh(SPH, rimM('#ff9ae8', 1.3, 3.2, 0))); g.children[1].scale.setScalar(1.02); const hl = new THREE.Mesh(SPH_LO, glowM('#ffffff', 2, 0.8)); hl.scale.setScalar(0.08); hl.position.set(-0.4, 0.5, 0.75); g.add(hl); return g; });
      const [X, Y] = P(f.x, f.y - f.h * 0.5); o.position.set(X, Y, zOf(f)); const w = 1 + Math.sin(performance.now() * 0.006) * 0.03;
      o.scale.set(f.h * 0.7 * V3.SC * w, f.h * 0.72 * V3.SC / w, f.h * 0.7 * V3.SC); o.rotation.y += 0.02;
    }
    const av = V3._avatars && V3._avatars.get(f);
    if (av && av.held && av.held.jetpack) av.held.jetpack.visible = false;   // never in the hand: it's worn
    jetpack(f, av);
  }
  // ---- worn jetpack: parented to the upper-back bone, sized from the torso in bone space ----
  const packs = new WeakMap();   // fighter -> { group, bone, flames, light, empty }
  function backBone(av) {
    const B = av.bones || {};
    return B.Spine02 || B.Spine2 || B.Spine01 || B.Spine1 || B.Chest || B.Spine || B.spine || B.Hips || null;
  }
  // torso box around the bone, in the BONE's own space, measured off the posed skin (like 86_custom's measure())
  const TORSOB = { Spine: 1, Spine01: 1, Spine02: 1, spine: 1, Chest: 1, neck: 1, Neck: 1, Hips: 1 };
  function torsoFit(av, bone) {
    const model = av.model;
    let mesh = null; model.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
    model.updateMatrixWorld(true);
    if (mesh.skeleton) mesh.skeleton.update();
    const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
    // up = toward the head, back = away from the model's facing (its own +z), both in bone space
    const head = (av.bones.Head || av.bones.Neck || av.bones.head);
    const up = new THREE.Vector3(0, 1, 0);
    if (head) up.copy(head.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)).normalize();
    // back: away from the face. The rigs carry a 'headfront' marker (86_custom.js uses it); if it is
    // missing, fall back to the model's own -z.
    const hf = av.bones.headfront || av.bones.HeadFront;
    const back = new THREE.Vector3();
    if (hf && head) back.copy(head.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)).sub(hf.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)).normalize();
    if (back.lengthSq() < 1e-8) back.set(0, 0, -1).transformDirection(model.matrixWorld).transformDirection(inv).normalize();
    back.addScaledVector(up, -back.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, back).normalize();
    // sample the SKINNED vertices (the pose the fighter is actually in) and keep only the ones the
    // torso bones own, so arms and tails never widen the pack
    const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
    const bones = (mesh.skeleton && mesh.skeleton.bones) || [];
    const v = new THREE.Vector3(), step = Math.max(1, Math.floor(pos.count / 3500)), pts = [];
    let minU = 1e9, maxU = -1e9;
    for (let i = 0; i < pos.count; i += step) {
      if (si && sw && bones.length) {
        let bi = -1, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
        const bn = bones[bi];
        if (bn && !TORSOB[bn.name]) continue;
      }
      mesh.getVertexPosition(i, v); mesh.localToWorld(v); v.applyMatrix4(inv);
      const u = v.dot(up); if (u < minU) minU = u; if (u > maxU) maxU = u;
      pts.push(v.clone());
    }
    if (pts.length < 12) return null;
    let n = 0, sU = 0, sR = 0, maxB = -1e9, maxR = -1e9;
    const band = Math.max(0.05, (maxU - minU) * 0.22);
    for (const p of pts) {
      const u = p.dot(up); if (Math.abs(u) > band) continue;        // a slab around the bone: the upper back
      const b = p.dot(back), r = Math.abs(p.dot(right));
      if (b > maxB) maxB = b;
      if (r > maxR) maxR = r;
      sU += u; sR += p.dot(right); n++;
    }
    if (!n || maxB <= -1e8) return null;
    return { up, back, right, width: maxR * 2, backAt: maxB, midU: sU / n, midR: sR / n, torso: maxU - minU };
  }
  function jetpack(f, av) {
    let P0 = packs.get(f);
    const wearing = !!(f.item && f.item.kind === 'jetpack') && f.state !== 'dead';
    if (!wearing) {
      if (P0) {                                                    // ran out or dropped: puff and go
        if (P0.group.parent) P0.group.parent.remove(P0.group);
        if (P0.light) V3.scene.remove(P0.light);
        for (let i = 0; i < 10; i++) smokes.push({ x: f.x * V3.SC + (Math.random() - 0.5) * 0.12, y0: -f.y * V3.SC + f.h * V3.SC * 0.55, t: -i, life: 60 + Math.random() * 30 });
        packs.delete(f);
      }
      return;
    }
    if (!av || !av.bones) return;
    const bone = backBone(av);
    if (!bone) return;
    if (!P0 || P0.bone !== bone || P0.model !== av.model) {
      if (P0 && P0.group.parent) P0.group.parent.remove(P0.group);
      const fit = torsoFit(av, bone);
      const group = new THREE.Group(), pack = jetpackMesh(1);
      group.name = 'jetpackRig';                                     // so the dev probe can find it on the skeleton
      group.add(pack); bone.add(group);
      P0 = { group, pack, bone, model: av.model, flames: null, light: null };
      packs.set(f, P0);
      if (fit) {
        // face the pack: its +y along the torso's up, its +z out through the back
        const m = new THREE.Matrix4().makeBasis(fit.right, fit.up, fit.back);
        group.quaternion.setFromRotationMatrix(m);
        // pack width ~66% of the torso, with a floor tied to the torso's height so a broad-chested
        // body (doge) doesn't end up wearing a pack too small to read in silhouette
        const size = Math.max(0.05, Math.max(fit.width * 0.66, fit.torso * 0.34));
        group.scale.setScalar(size);
        // sit flush: origin at the back surface, centred between the shoulders, a touch above the bone
        const off = new THREE.Vector3()
          .addScaledVector(fit.back, fit.backAt + size * 0.2)
          .addScaledVector(fit.up, fit.midU + fit.torso * 0.06)
          .addScaledVector(fit.right, fit.midR);
        group.position.copy(off);
      } else { group.scale.setScalar(0.5); group.position.set(0, 0.1, -0.2); }
    }
    const thrusting = f.jetT != null && Game.frame - f.jetT <= 2;
    const it = f.item, lowFuel = it && it.ammo < 60;
    if (P0.pack.userData.led) P0.pack.userData.led.material = glowM(lowFuel ? '#ff5a3a' : '#7dff9a', 2.4, lowFuel && Math.floor(performance.now() / 150) % 2 ? 0.2 : 1);
    // thrust: blue-white cones at both nozzles, heat shimmer, sparks, smoke and a flicker light
    if (!P0.flames) {
      P0.flames = [];
      for (const x of [-0.2, 0.2]) {
        const fl = new THREE.Group();
        const core = new THREE.Mesh(JET, glowM('#e8fbff', 2.2, 0.95)), mid = new THREE.Mesh(JET, glowM('#6fd0ff', 1.6, 0.8)), out = new THREE.Mesh(JET, streakM('#2a8cff', 1.2, 0.55));
        core.scale.set(0.38, 0.7, 0.38); mid.scale.set(0.7, 0.9, 0.7);
        fl.add(out, mid, core); fl.position.set(x, -0.42, 0.3); P0.pack.add(fl); P0.flames.push(fl);
      }
      P0.light = new THREE.PointLight(0x7fd0ff, 0, 3.4, 2); V3.scene.add(P0.light);
    }
    const k = thrusting ? 1 : 0;
    for (const fl of P0.flames) {
      fl.visible = thrusting;
      if (!thrusting) continue;
      const L = 0.9 + Math.random() * 0.75;
      fl.scale.set(1 + Math.random() * 0.12, L, 1 + Math.random() * 0.12);
      fl.rotation.y += 0.4;
    }
    P0.light.intensity = thrusting ? 9 + Math.random() * 5 : 0;
    if (thrusting) {
      P0.group.getWorldPosition(tmpP); P0.light.position.copy(tmpP); P0.light.position.y -= 0.2;
      if (Math.random() < 0.7) smokes.push({ x: tmpP.x + (Math.random() - 0.5) * 0.1, y0: tmpP.y - 0.28, t: 0, life: 34 + Math.random() * 22, small: true });
      for (let i = 0; i < 2; i++) sparks.push({ x: tmpP.x + (Math.random() - 0.5) * 0.16, y: tmpP.y - 0.3, vx: (Math.random() - 0.5) * 0.03, vy: -0.03 - Math.random() * 0.03, t: 0, life: 14 + Math.random() * 10, c: '#bfe8ff' });
    }
  }
  const tmpP = new THREE.Vector3();
  // craters: stage-body materials get a world-space cut-out; charred walls and smoke fill in the look
  const holeU = { value: Array.from({ length: 6 }, () => new THREE.Vector4()) }, holeN = { value: 0 }, holeY = { value: new THREE.Vector2(0.4, -6) };
  const patched = new WeakSet();
  function patchMat(m) {
    if (!m || patched.has(m) || !m.isMeshStandardMaterial) return;
    patched.add(m);
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uHoles = holeU; sh.uniforms.uHoleN = holeN; sh.uniforms.uHoleY = holeY;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHoleW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHoleW; uniform vec4 uHoles[6]; uniform int uHoleN; uniform vec2 uHoleY;')
        .replace('void main() {', 'void main() {\n  for (int i = 0; i < 6; i++) { if (i >= uHoleN) break; if (vHoleW.x > uHoles[i].x && vHoleW.x < uHoles[i].y && vHoleW.y < uHoleY.x && vHoleW.y > uHoleY.y && abs(vHoleW.z) < uHoles[i].z) discard; }');
    };
    m.customProgramCacheKey = () => key + '|holes';
    m.needsUpdate = true;
  }
  // ---- WHY THE STAGE USED TO HITCH WHEN TNT WENT OFF (9/20: "it keeps glitching or pausing when a
  // bomb destroys the map") ----
  // Three things all happened on the single frame the crater appeared:
  //   1. `patchMat` was called then, which rewrites every stage-body material's shader and sets
  //      needsUpdate -> WebGL **recompiles and relinks a MeshStandard program per material** in the
  //      middle of the fight. That is the stall; everything else is noise next to it.
  //   2. `Box3.setFromObject` per mesh over the whole arena. setFromObject calls
  //      updateWorldMatrix(true, true) on every node, so it is quadratic in the scene graph.
  //   3. Three canvas textures were drawn and uploaded PER CRATER (one with 120 random rects), plus
  //      new geometries and materials, with the previous crater's meshes thrown away.
  // All three are now gone:
  //   1. the materials are patched when the ARENA IS BUILT, behind the loading screen, with
  //      uHoleN = 0 so the shader discards nothing. Detonation then only writes a uniform.
  //   2. the scan does one updateMatrixWorld for the arena and reuses each geometry's bounding box.
  //   3. crater geometry, materials and textures are built once and the groups are pooled.
  // `V3.holeProf` carries the measured cost; dev/hole_prof.js reads it.
  let holeSeen = '', holeArena = null, holeScans = 0, holeScanAt = 0, holeArenaAt = 0;
  const craters = [], smokes = [], craterPool = [];
  let smokeTexC = null, wallMat = null, sootMat = null, emberMat = null;
  let WALL_G = null, EMBER_G = null, SOOT_G = null;
  const LAZY_HOLES = typeof location !== 'undefined' && location.hash.includes('lazyholes');   // dev A/B: the old behaviour
  V3.holeProf = { scan: 0, scans: 0, build: 0, builds: 0, mats: 0, patched: 0 };

  // one set of crater textures / geometry / materials for the whole session
  function craterKit() {
    if (wallMat) return;
    const t0 = performance.now();
    wallMat = new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 1, side: THREE.DoubleSide, map: canvasT(64, 256, (c, W, Hh) => { const gr = c.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, '#6a2a10'); gr.addColorStop(0.08, '#2a1a12'); gr.addColorStop(1, '#050303'); c.fillStyle = gr; c.fillRect(0, 0, W, Hh); for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; c.fillRect(Math.random() * W, Math.random() * Hh, 3, 3 + Math.random() * 10); } }) });
    sootMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: canvasT(128, 16, (c, W, Hh) => { const gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(10,6,4,0.9)'); gr.addColorStop(1, 'rgba(10,6,4,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, Hh); }) });
    emberMat = glowM('#ff6a1a', 2.2, 0.9);
    WALL_G = new THREE.PlaneGeometry(1, 1); EMBER_G = new THREE.BoxGeometry(0.03, 0.05, 1); SOOT_G = new THREE.PlaneGeometry(0.5, 1);
    V3.holeProf.mats += performance.now() - t0;
  }
  function makeCrater() {
    craterKit();
    const g = new THREE.Group(), sides = [];
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(WALL_G, wallMat); w.rotation.y = s * Math.PI / 2;
      const e = new THREE.Mesh(EMBER_G, emberMat);
      const so = new THREE.Mesh(SOOT_G, sootMat); so.rotation.x = -Math.PI / 2; so.rotation.z = s > 0 ? Math.PI : 0;
      g.add(w, e, so); sides.push({ s, w, e, so });
    }
    g.userData.sides = sides; noShadow(g);
    return g;
  }
  function setCrater(g, q, hgt, depth) {
    for (const { s, w, e, so } of g.userData.sides) {
      const x = (s > 0 ? q.x0 : q.x1) * V3.SC;
      w.scale.set(depth, hgt, 1); w.position.set(x, -hgt / 2 + 0.02, 0);
      e.scale.set(1, 1, depth); e.position.set(x, -0.02, 0);
      so.scale.set(1, depth, 1); so.position.set(x - s * 0.25, 0.004, 0);
    }
  }
  // Patch the stage body's materials while the stage is being built, so the shader recompile lands on
  // the loading frame instead of the frame a bomb goes off. With uHoleN = 0 nothing is discarded.
  // The scan only QUEUES materials; `patchQueue` flags a couple per frame, so the recompiles spread
  // over the countdown instead of landing in one lump on the frame the stage first appears.
  const holeQ = [];
  function scanStage(ar) {
    if (!ar) return;
    const t0 = performance.now(), M = Game.stage.main, box = new THREE.Box3();
    ar.updateMatrixWorld(true);
    ar.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats[0] || patched.has(mats[0])) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (box.max.y > -(M.bot * V3.SC) - 4 && box.min.y < 0.3 && box.min.x < M.x1 * V3.SC && box.max.x > M.x0 * V3.SC && box.max.z > -1.8 && box.min.z < 1.8 && box.max.y - box.min.y < 12)
        for (const m of mats) if (m && !patched.has(m) && holeQ.indexOf(m) < 0) holeQ.push(m);
    });
    V3.holeProf.scan += performance.now() - t0; V3.holeProf.scans++;
  }
  // `urgent` empties the queue in one go: only when a bomb has already gone off and the cut has to be
  // correct this frame (it cannot happen in practice, because the queue drains during the countdown).
  function patchQueue(urgent) {
    let n = urgent ? holeQ.length : 2;
    while (n-- > 0 && holeQ.length) { const m = holeQ.shift(); if (!patched.has(m)) V3.holeProf.patched++; patchMat(m); }
  }
  function cratersFrame() {
    const H = Game.holes || [], ar = V3.internals().arena(), M = Game.stage.main;
    const sig = H.map(q => q.x0 + ':' + q.x1).join(',');
    if (ar !== holeArena) {
      holeArena = ar; holeSeen = ''; holeScans = 0; holeScanAt = 0; holeArenaAt = performance.now();
      for (const c of craters) { c.visible = false; craterPool.push(c); }
      craters.length = 0;
      if (!LAZY_HOLES) { scanStage(ar); holeScans = 1; holeScanAt = holeArenaAt; craterKit(); }
    }
    // keep the shader uniforms in step with the fight's hole list
    holeN.value = Math.min(6, H.length);
    for (let i = 0; i < holeN.value; i++) holeU.value[i].set(H[i].x0 * V3.SC, H[i].x1 * V3.SC, 3.2, 0);
    holeY.value.set(0.35, -(M.bot * V3.SC) - 6);
    const now = performance.now();
    // Late-loading rock (the island underside, gltf props) arrives after the stage is first shown, so
    // re-scan a few times over the first seconds of the match -- always long before a fuse can burn
    // down, and free when there is nothing new to patch.
    if (!LAZY_HOLES && holeScans < 5 && now - holeScanAt > 800 && now - holeArenaAt < 9000) { holeScans++; holeScanAt = now; scanStage(ar); }
    if (!LAZY_HOLES && holeQ.length) patchQueue(H.length > 0);   // a couple of recompiles a frame
    if (!H.length) return;
    if (LAZY_HOLES) {   // the old path, kept only so dev/hole_prof.js can measure the difference
      if (sig !== holeSeen) { holeScans = 0; holeScanAt = 0; }
      if (sig !== holeSeen || (holeScans < 4 && now - holeScanAt > 1500)) {
        holeScans++; holeScanAt = now;
        const t0 = performance.now(), box = new THREE.Box3();
        if (ar) ar.traverse(o => {
          if (!o.isMesh || patched.has(Array.isArray(o.material) ? o.material[0] : o.material)) return;
          box.setFromObject(o);
          if (box.max.y > -(M.bot * V3.SC) - 4 && box.min.y < 0.3 && box.min.x < M.x1 * V3.SC && box.max.x > M.x0 * V3.SC && box.max.z > -1.8 && box.min.z < 1.8 && box.max.y - box.min.y < 12)
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!patched.has(m)) V3.holeProf.patched++; patchMat(m); }
        });
        V3.holeProf.scan += performance.now() - t0; V3.holeProf.scans++;
      }
    }
    if (sig === holeSeen) return;
    holeSeen = sig;
    // --- the crater shells. Pooled: no new geometry, no new material, no new texture. ---
    const t1 = performance.now();
    const fresh = craters.length === 0, depth = 2.8, hgt = M.bot * V3.SC + 0.4;
    for (const c of craters) { c.visible = false; craterPool.push(c); }
    craters.length = 0;
    for (const q of H) {
      const g = craterPool.pop() || makeCrater();
      setCrater(g, q, hgt, depth);
      g.visible = true; if (!g.parent) V3.scene.add(g);
      craters.push(g);
      // only the crater that just opened puffs smoke (the fight can be several steps ahead of the frame)
      if (fresh || q.t > Game.frame - 15) for (let i = 0; i < 16; i++) smokes.push({ x: (q.x0 + Math.random() * (q.x1 - q.x0)) * V3.SC, t: -i * 6, life: 150 + Math.random() * 60 });
    }
    V3.holeProf.build += performance.now() - t1; V3.holeProf.builds++;
  }
  // tiny glowing sparks (jetpack, pellets hitting the stage): visual only
  const sparks = [];
  let sparkGeo = null;
  function sparkFrame() {
    if (!sparkGeo) sparkGeo = new THREE.SphereGeometry(1, 6, 4);
    for (const p of sparks) {
      p.t++;
      if (!p.m) { p.m = new THREE.Mesh(sparkGeo, glowM(p.c || '#ffd08a', 2.2, 1)); V3.scene.add(p.m); }
      p.x += p.vx; p.y += p.vy; p.vy -= 0.004;
      const k = 1 - p.t / p.life;
      p.m.position.set(p.x, p.y, 0.4); p.m.scale.setScalar(Math.max(0.004, 0.022 * k));
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].t > sparks[i].life) { V3.scene.remove(sparks[i].m); sparks.splice(i, 1); }
  }
  // brass: a shell spins out of the gun and bounces on the floor
  const shells = [];
  let shellGeo = null, shellMat = null;
  function ejectShell(f, big) {
    if (!shellGeo) { shellGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.07, 10); shellMat = new THREE.MeshStandardMaterial({ color: 0xd8a63a, metalness: 1, roughness: 0.28, emissive: 0x3a2600, emissiveIntensity: 0.4 }); }
    const m = new THREE.Mesh(shellGeo, shellMat); m.castShadow = true; V3.scene.add(m);
    const [X, Y] = P(f.x + f.face * (f.w * 0.4), f.y - f.h * 0.58);
    shells.push({ m, x: X, y: Y, vx: -f.face * (0.012 + Math.random() * 0.01), vy: 0.045 + Math.random() * 0.02, sp: (Math.random() - 0.5) * 0.7, t: 0, life: 90, big: !!big, floor: -Game.stage.main.top * V3.SC });
  }
  function shellFrame() {
    for (const s of shells) {
      s.t++; s.x += s.vx; s.y += s.vy; s.vy -= 0.0045;
      if (s.y < s.floor + 0.02 && s.vy < 0) { s.y = s.floor + 0.02; s.vy *= -0.35; s.vx *= 0.6; if (Math.abs(s.vy) > 0.012) Sfx.brass(0); }
      s.m.position.set(s.x, s.y, 0.42); s.m.rotation.z += s.sp; s.m.rotation.x += s.sp * 0.6;
      s.m.scale.setScalar(s.big ? 1.5 : 1);
      s.m.visible = s.t < s.life;
    }
    for (let i = shells.length - 1; i >= 0; i--) if (shells[i].t > shells[i].life) { V3.scene.remove(shells[i].m); shells.splice(i, 1); }
  }
  function smokeFrame() {
    if (!smokeTexC) smokeTexC = canvasT(128, 128, (c, W, H) => { const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); gr.addColorStop(0, 'rgba(90,80,76,.7)'); gr.addColorStop(1, 'rgba(90,80,76,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); });
    for (const s of smokes) {
      s.t++;
      if (!s.m) { s.m = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: smokeTexC, transparent: true, depthWrite: false, opacity: 0 })); V3.scene.add(s.m); }
      const k = Math.max(0, s.t) / s.life;
      const rise = s.small ? 0.7 : 3, base = s.y0 != null ? s.y0 : 0.1, sz = s.small ? 0.16 : 0.4, grow = s.small ? 0.5 : 1.6;
      s.m.visible = s.t > 0; s.m.position.set(s.x + Math.sin(s.t * 0.03) * (s.small ? 0.04 : 0.1), base + k * rise, 0.3);
      s.m.scale.setScalar(sz + k * grow); s.m.material.opacity = Math.min(1, k * 6) * (1 - k) * (s.small ? 0.5 : 0.8); s.m.quaternion.copy(V3.camera.quaternion);
    }
    for (let i = smokes.length - 1; i >= 0; i--) if (smokes[i].t > smokes[i].life) { V3.scene.remove(smokes[i].m); smokes[i].m.material.dispose(); smokes.splice(i, 1); }
  }

  // ---------------- per-frame ----------------
  // ---- electrocuted: anyone SPARK cooks keeps arcing and smoking for a couple of seconds ----
  // Visual only: it reads `lastHitBy` / `lastHitT` / `hitstun`, which the fight already keeps, and
  // remembers the moment here rather than writing anything onto the fighter.
  const zapAt = new WeakMap(), ZAP_T = 120;
  function zapped(f) {
    const by = f.lastHitBy;
    if (by && by !== f && by.c && by.c.id === 'spark' && f.lastHitT === Game.frame && f.hitstun >= 20) zapAt.set(f, Game.frame);
    const at = zapAt.get(f), age = at == null ? 1e9 : Game.frame - at;
    const on = f.state !== 'dead' && age >= 0 && age < ZAP_T;
    const o = fx(f, 'zap', () => {
      const g = new THREE.Group(); g.userData.arcs = [];
      for (let i = 0; i < 7; i++) { const l = new THREE.Line(arcGeo(7), lineM('#ffe84a', 3)); g.add(l); g.userData.arcs.push(l); }
      const gl = new THREE.Mesh(SPH, glowM('#ffe84a', 1.2, 0.3)); g.add(gl); g.userData.gl = gl;
      return g;
    });
    if (!on) { o.visible = false; return; }
    const k = 1 - age / ZAP_T;
    const [X, Y] = P(f.x, f.y - f.h * 0.5);
    o.position.set(X, Y, zOf(f) + 0.06);
    const w = f.w * V3.SC * 0.55, h = f.h * V3.SC * 0.5;
    for (const l of o.userData.arcs) {
      l.visible = Math.random() < 0.4 + 0.5 * k;
      const a = Math.random() * 6.283, b = a + 1.4 + Math.random() * 2.4;
      zap(l, Math.cos(a) * w, Math.sin(a) * h, Math.cos(b) * w, Math.sin(b) * h, 0.04 + 0.05 * Math.random());
      l.material = lineM(Math.random() < 0.5 ? '#ffe84a' : '#bfe8ff', 2.2 + Math.random() * 1.4);
    }
    o.userData.gl.scale.set(w * 1.25, h * 1.2, w * 1.25);
    o.userData.gl.material = glowM('#ffe84a', 1.3, 0.1 + 0.2 * k);
    // smoking silhouette
    if (Math.random() < 0.3 + 0.3 * k) sparks.push({ x: X + (Math.random() - 0.5) * w * 1.4, y: Y + (Math.random() - 0.5) * h, vx: (Math.random() - 0.5) * 0.01, vy: 0.015 + Math.random() * 0.015,
      t: 0, life: 26 + Math.random() * 20, c: Math.random() < 0.3 ? '#6a6a72' : '#3a3a42' });
  }

  // 99_v3_finish's shader warm-up calls this at the countdown: every special's effect builders run once for each fighter
  // in the match, so their meshes exist (hidden at once) and compile then, not on first use (SPARK's first zip stalled a
  // 9/22 playtest 233 ms; a gun's first shell casing is a lit metal material too). Whatever the builders spawn into the
  // loose effect lists comes back out and is handed to the caller to keep (hidden) so its programs stay compiled.
  V3.warmMoves = function (fighters) {
    const nf = flashes.length, np = pops3.length, ns = sparks.length, nsh = shells.length, keep = [];
    for (const f of fighters) {
      const M = f.m; if (!M) continue;
      const defs = new Set();
      for (const k of Object.keys(M)) { const d = M[k]; if (!d || typeof d !== 'object') continue; defs.add(d); for (const sd of ['ground', 'air']) if (d[sd] && typeof d[sd] === 'object') { defs.add(d[sd]); if (d[sd].land) defs.add(d[sd].land); } }
      for (const d of defs) { const fn = d.fx && FXF[d.fx]; if (!fn) continue; for (const t of [3, 8, 14, 22, 34]) { try { fn(f, d, t); } catch (e) { /* a builder that needs a live move: covered on first use */ } } }
      const r = FXR.get(f); if (r) for (const o of Object.values(r)) o.visible = false;
    }
    try { if (fighters[0]) ejectShell(fighters[0]); } catch (e) { V3.fxErr(e, '94 warm shell'); }
    for (const F of flashes.splice(nf)) { V3.scene.remove(F.g); keep.push(F.g); }
    for (const c of pops3.splice(np)) { V3.scene.remove(c.m); keep.push(c.m); }
    for (const p of sparks.splice(ns)) if (p.m) { V3.scene.remove(p.m); keep.push(p.m); }
    for (const sh of shells.splice(nsh)) { V3.scene.remove(sh.m); keep.push(sh.m); }
    return keep;
  };
  const pounds = [];
  const RINGF = new THREE.RingGeometry(0.8, 1, 48);
  V3._pounds = () => pounds.length + ' made ' + (V3._poundN || 0);
  function poundAt(f) {
    V3._poundN = (V3._poundN || 0) + 1;
    const [X, Y] = P(f.x, f.y), g = new THREE.Group(); g.position.set(X, Y + 0.03, zOf(f) - 0.3);
    // flat on the floor: the camera's low angle shows it as a thin bright ellipse running out along the ground (tilted
    // up, the floor cut it into half-arcs)
    const mk = (hex, k, op) => { const m = new THREE.Mesh(RINGF, glowM(hex, k, op, true)); m.rotation.x = -Math.PI / 2; g.add(m); return m; };
    const a = mk('#fff2d0', 2.6, 0.9), b = mk('#ffb04a', 1.8, 0.7), c = mk('#a07850', 1.0, 0.5);
    V3.scene.add(g); pounds.push({ g, a, b, c, t: 0, s: f.h * V3.SC * 1.25 });
  }
  function poundFrame() {
    for (const p of pounds) {
      p.t++; const k = p.t / 20, e = 1 - (1 - Math.min(1, k)) * (1 - Math.min(1, k));
      p.a.scale.setScalar(0.2 + p.s * e); p.b.scale.setScalar(0.1 + p.s * 0.72 * e); p.c.scale.setScalar(0.1 + p.s * 1.15 * Math.min(1, k * 0.8));
      const fade = Math.max(0, 1 - k);
      p.a.material = glowM('#fff2d0', 2.6, 0.9 * fade, true); p.b.material = glowM('#ffb04a', 1.8, 0.7 * fade, true); p.c.material = glowM('#a07850', 1.0, 0.5 * fade, true);
      if (p.t >= 20) V3.scene.remove(p.g);
    }
    for (let i = pounds.length - 1; i >= 0; i--) if (pounds[i].t >= 20) pounds.splice(i, 1);
  }
  V3.movesFrame = function () {
    try { poundFrame(); } catch (e) { V3.fxErr(e, '94 poundFrame'); }
    for (const [f, r] of FXR) {
      if (!Game.fighters.includes(f)) { for (const o of Object.values(r)) V3.scene.remove(o); FXR.delete(f); seen.delete(f); continue; }
      for (const o of Object.values(r)) o.userData.used = false;
    }
    try { itemsFrame(); cratersFrame(); smokeFrame(); sparkFrame(); shellFrame(); } catch (e) { V3.fxErr(e, '94_v3_moves:1738'); /* cosmetic */ }
    for (const f of Game.fighters) {
      try { fighterItems(f); zapped(f); } catch (e) { V3.fxErr(e, '94_v3_moves:1740'); /* cosmetic */ }
      let S = seen.get(f); if (!S) seen.set(f, S = { hidden: false, mv: null, t: -1 });
      const hid = f.state !== 'dead' && MV2.hidden(f);
      // teleport flashes on the way out and back in (not for swallowed fighters)
      if (hid !== S.hidden && f.state === 'move') flashAt(f.x, f.y - f.h * 0.5, f.color);
      S.hidden = hid;
      if (f.state !== 'move' || !f.move) { S.mv = null; continue; }
      const d = f.move.def, t = f.move.t;
      // coins burst out of the coin uppercut on its hit frames
      if (d.fx === 'coins' && (S.mv !== f.move || S.t !== t) && (t === 3 || t === 7 || t === 11 || t === 15)) for (let i = 0; i < 3; i++) coinPop(f.x + f.face * f.w * 0.3, f.y - f.h * 0.8, f.face);
      S.mv = f.move; S.t = t;
      // stock ground down special (a two-sided strike at the feet, no effect of its own): a ground-pound shockwave on
      // its first active frame, so the hit reads (9/22 night; it showed nothing but the generic spark)
      const dbase = d.base || d;
      if (!d.fx && !V3.noPound && f.m.db && (dbase === f.m.db.ground || dbase === f.m.db) && !f.air && d.hits && d.hits.length && S.pound !== f.move) {
        const lo = Math.min(...d.hits.map(h => h.f[0]));
        if (t >= lo) { S.pound = f.move; poundAt(f); }
      }
      const fn = d.fx && FXF[d.fx];
      if (fn) { try { fn(f, d, t); } catch (e) { V3.fxErr(e, '94_v3_moves:1752'); /* effects are cosmetic */ } }
    }
    for (const r of FXR.values()) for (const o of Object.values(r)) if (!o.userData.used) o.visible = false;
    for (const F of flashes) { F.t++; const k = F.t / 14; F.s.scale.set(0.12 * (1 - k), 1.4 * (1 + k * 0.4), 1); F.r.scale.setScalar(0.3 + k * 0.8); F.r.material = glowM('#ffffff', 2.6, Math.max(0, 1 - k)); if (F.t >= 14) V3.scene.remove(F.g); }
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].t >= 14) flashes.splice(i, 1);
    for (const c of pops3) { c.t++; c.m.position.x += c.vx; c.m.position.y += c.vy; c.vy -= 0.004; c.m.rotation.z += 0.3; c.m.rotation.x += 0.2; if (c.t > 40) V3.scene.remove(c.m); }
    for (let i = pops3.length - 1; i >= 0; i--) if (pops3[i].t > 40) pops3.splice(i, 1);
  };
}
