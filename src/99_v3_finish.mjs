// ===== 99_v3_finish: the Finish Zoom, the frozen GAME! frame, the winner outro, KO beams =====
// The 3D half of 6d_finish.js. It only READS the fight (FIN, Game.fighters) and never writes fight
// state, so it is page-only (not in build.py SIM_FILES). Timings follow Smash Ultimate's Finish Zoom as
// frame-stepped in ~/Downloads/REKT-FIGHTER-AUDIT/research-smash-tekken.md §1.2-1.4:
//   f1      hard cut in ONE frame: HUD off, the stage replaced by a red/yellow/black radial burst
//   f1-5    medium shot on the impact, both fighters ~1/5 of the screen
//   f6-9    push-in to the victim's head and torso (~60-70 % of the screen)
//   f10-49  hold, near-frozen, slow drift + a little dutch roll
//   f50-63  pull back to the gameplay camera while the burst dissolves and the HUD returns
//   KO      a blast beam in the victim's colour; on the last KO the world freezes, GAME! slams in
//   outro   stripe wipe, the winner's victory pose, the name slam, then results
{
  const FV = window.FINV = { quiet: false, zoom: false, cineUI: false };
  { const st = document.createElement('style');
    st.textContent = 'body.tb-cine #pauseBtn,body.tb-cine #clipBtn,body.tb-cine #ctrlBtn,body.tb-cine #ctrlCard,body.tb-cine #musBar,body.tb-cine #sndBtn,body.tb-cine #muteBtn{visibility:hidden!important;pointer-events:none!important}';
    document.head.appendChild(st); }
  const on = () => typeof FIN !== 'undefined' && FIN.on();
  // A/B from the URL, so a headless run can measure the zoom's cost against itself
  try { if (/(^|[#:&])nocine/.test(location.hash)) { V3.noDeepBurst = true; V3.noCineSparks = true; } } catch (e) {}
  try { if (/(^|[#:&])nozoom/.test(location.hash)) { V3.noZoomAll = true; } } catch (e) {}
  const ease = k => k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
  const easeOut = k => { k = k < 0 ? 0 : k > 1 ? 1 : k; return 1 - (1 - k) * (1 - k) * (1 - k); };

  // ---- the burst backdrop ----
  // TWO layers, because the measurement calls for two (research §1.2): the BRIGHT yellow-white/red
  // burst on the cut (f45), then "the burst turns deep red with black crack and lightning shapes" on
  // the push-in (f50-f54) and holds there for the whole close-up -- 40 of the zoom's 63 frames.
  // One texture tinted toward red was NOT enough: multiplying a #fff6d8 core by (1, .65, .6) still
  // reads bright orange, which is what shipped and what the close-up actually looked like
  // (runs/p9fin k02, k03 -- flat orange for the entire hold). The deep layer is its own texture that
  // cross-fades in over the bright one and counter-rotates, so the two read as depth rather than a tint.
  let burst = null, burstD = null;
  function burstTex() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d'); g.translate(512, 512);
    // Same cropping trap as the deep layer, and it was here first: the plane covers ~2.2 screen
    // heights, so only the inner ~31 % of this gradient is ever on screen vertically. With the red at
    // 0.6 and the black at 1.0, NONE of the falloff was visible -- every cut frame was a white core
    // bleeding to orange, edge to edge. That is why the fighters looked stranded in an empty field and
    // why the hit spark could not be seen at all: additive white on a #fff6d8 background is nothing
    // (runs/p9pin2 t02, runs/p9pin3 t01, which reported 5 live sparks and showed none).
    const bg = g.createRadialGradient(0, 0, 8, 0, 0, 740);
    bg.addColorStop(0, '#fff6d8'); bg.addColorStop(0.035, '#ffe9a0'); bg.addColorStop(0.075, '#ffb022');
    bg.addColorStop(0.13, '#ff5a1e'); bg.addColorStop(0.22, '#c3101c'); bg.addColorStop(0.36, '#5e0810'); bg.addColorStop(1, '#2a0206');
    g.fillStyle = bg; g.fillRect(-512, -512, 1024, 1024);
    // black gaps between the rays, then thin white speed lines converging on the impact
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 38; i++) {
      const a = rnd() * Math.PI * 2, w = 0.035 + rnd() * 0.07, r0 = 150 + rnd() * 160;
      g.fillStyle = `rgba(8,0,2,${0.55 + rnd() * 0.35})`;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a - w) * 800, Math.sin(a - w) * 800); g.lineTo(Math.cos(a + w) * 800, Math.sin(a + w) * 800); g.fill();
    }
    for (let i = 0; i < 140; i++) {
      const a = rnd() * Math.PI * 2, w = 0.0025 + rnd() * 0.006, r0 = 90 + rnd() * 260;
      g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.5})`;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a - w) * 800, Math.sin(a - w) * 800); g.lineTo(Math.cos(a + w) * 800, Math.sin(a + w) * 800); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // the deep-red close-up layer: a dark red field, black cracks radiating from the impact, and
  // pink-white lightning over them. Far fewer speed lines than the bright layer -- the close-up in the
  // reference is a calmer, heavier frame than the cut, and 140 white rays over a red field just greys it.
  function burstDeepTex() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d'); g.translate(512, 512);
    // The falloff has to happen EARLY. The plane is scaled to about 2.2 screen heights, so only the
    // inner ~45 % of the texture radius is ever on screen vertically: a gradient that got dark at 0.55
    // put every visible pixel in the vivid #b80c18 band and the close-up read as one flat saturated red
    // (runs/p9pin t30). Pulling the dark stops in gives the frame its falloff back.
    const bg = g.createRadialGradient(0, 0, 8, 0, 0, 720);
    bg.addColorStop(0, '#ffd9a8'); bg.addColorStop(0.04, '#ff6a2a'); bg.addColorStop(0.11, '#c01020');
    bg.addColorStop(0.22, '#6d0410'); bg.addColorStop(0.38, '#2a0208'); bg.addColorStop(1, '#0d0007');
    g.fillStyle = bg; g.fillRect(-512, -512, 1024, 1024);
    let seed = 91; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // one jagged spine from the core outward; used for both the black cracks and the lightning
    const crack = (a, r0, r1, w, col, blur) => {
      g.save(); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
      if (blur) { g.shadowColor = col; g.shadowBlur = blur; }
      g.beginPath(); let r = r0; g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      while (r < r1) { r += 22 + rnd() * 38; const aa = a + (rnd() - 0.5) * 0.34; g.lineTo(Math.cos(aa) * r, Math.sin(aa) * r); }   // shorter steps + wider jitter = a jagged crack, not a bent pipe
      g.stroke(); g.restore();
    };
    // The black shapes are TAPERING RAYS, the same construction as the bright layer -- wide at the rim,
    // to a point at the core. Two earlier passes drew them as constant-width strokes: at 10-26 px they
    // were black tentacles, and at 2.5-7 px they were worse, reading as circuit-board traces because a
    // uniform width with sharp joints has no direction to it (runs/p9fin2 k00, runs/p9fin3 k00).
    // A taper is what makes a shape read as "cracked open" rather than "drawn on".
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, w = 0.018 + rnd() * 0.05, r0 = 110 + rnd() * 210;
      g.fillStyle = `rgba(6,0,3,${0.6 + rnd() * 0.32})`;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a - w) * 800, Math.sin(a - w) * 800); g.lineTo(Math.cos(a + w) * 800, Math.sin(a + w) * 800); g.fill();
    }
    // finer crack filaments over them, short and clustered near the core, then the lightning. Both kept
    // sparse on purpose: 18 filaments plus 8 bolts of roughly the same width read as one angular
    // scribble over the whole frame, like glowing wiring, rather than as two different things.
    for (let i = 0; i < 10; i++) crack(rnd() * Math.PI * 2, 60 + rnd() * 70, 280 + rnd() * 180, 1.6 + rnd() * 2.2, 'rgba(6,0,3,.85)', 0);
    for (let i = 0; i < 5; i++) crack(rnd() * Math.PI * 2, 40 + rnd() * 60, 300 + rnd() * 240, 1.4 + rnd() * 1.4, 'rgba(255,190,235,.75)', 7);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, w = 0.002 + rnd() * 0.004, r0 = 120 + rnd() * 300;
      g.fillStyle = `rgba(255,222,210,${0.18 + rnd() * 0.3})`;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a - w) * 800, Math.sin(a - w) * 800); g.lineTo(Math.cos(a + w) * 800, Math.sin(a + w) * 800); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function burstPlane() {
    if (burst) return burst;
    const mk = (tex, order) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
      m.renderOrder = order; m.visible = false; m.userData.shared = true; V3.scene.add(m); return m;
    };
    burst = mk(burstTex(), -6);          // neither writes depth, so the render order alone layers them
    burstD = mk(burstDeepTex(), -5);
    cineTextures();                      // in warm()'s reach, so the zoom's sparks never compile mid-KO
    return burst;
  }
  // ride the deep layer on the bright one's transform, counter-rotating so the cracks drift against the rays
  function burstDeepLayer(P, w, deep, t) {
    if (!burstD) return;
    burstD.visible = !!P.visible && deep > 0.02 && !V3.noDeepBurst;
    if (!burstD.visible) return;
    burstD.position.copy(P.position); burstD.quaternion.copy(P.quaternion);
    burstD.rotateZ(-t * 0.0062);
    burstD.scale.copy(P.scale);
    burstD.material.opacity = w * deep;
  }

  // ---- cinematic sparks ----
  // Two more measured things that were simply absent. f45: "a large green and white hit spark" at the
  // impact -- the shipped cut frame had NOTHING at the contact point, just two small figures on an
  // orange field (runs/p9fin k00). f50-f54: "pink and white electric sparks sit on the victim", held
  // through the close-up.
  // These cannot use the ordinary fx pool: fxShown() hides every burst from t=PUSH on (so nothing hangs
  // frozen in the outro), which is exactly the window the victim's sparks need. So the zoom carries its
  // own small pool. It lives on the scene, not the arena, so setArena(false) does not take it with it.
  let sparkT = null, boltT = null, lastCineT = -1, boltN = 0;
  const cineFx = [];
  function boltTex() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.translate(128, 128);
    const bolt = (w, col, blur) => {
      let seed = 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      g.save(); g.shadowColor = col; g.shadowBlur = blur; g.strokeStyle = col; g.lineWidth = w;
      g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(0, -118);
      for (let y = -118; y < 118; y += 26) g.lineTo((rnd() - 0.5) * 70, y + 26);
      g.stroke(); g.restore();
    };
    bolt(16, 'rgba(255,90,190,.75)', 26);   // pink halo and white core on the SAME path (the rnd reseeds)
    bolt(5, 'rgba(255,255,255,.98)', 10);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // one mesh per texture, pooled. These are `toneMapped: false` + `depthTest: false`, which is NOT the
  // burstAt keeper's program, so they must exist before the first KO or they compile during it --
  // cineTextures() builds one of each from burstPlane(), i.e. inside warm(), where compileAsync sees them.
  function cineMesh(tex) {
    let m = cineFx.find(o => !o.visible && o.userData.tex === tex);
    if (!m) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.renderOrder = 8; m.visible = false; m.userData = { tex, t: 0, life: 1, size: 1, shared: true };
      V3.scene.add(m); cineFx.push(m); V3._cineFx = cineFx;   // dev inspection
    }
    return m;
  }
  function cineTextures() {
    if (sparkT) return;
    sparkT = starTex(); boltT = boltTex();
    cineMesh(sparkT); cineMesh(boltT);   // warm one of each; both stay hidden until a KO
  }
  function cineSpark(tex, x, y, size, life, spin, col, peak) {
    const m = cineMesh(tex);
    m.visible = true; m.position.set(x * SC, -y * SC, 0.6); m.rotation.set(0, 0, spin);
    m.material.color.set(col); m.material.opacity = peak;
    Object.assign(m.userData, { t: 0, life, size, peak });
    return m;
  }
  function cineFxFrame(c) {
    for (const m of cineFx) {
      if (!m.visible) continue;
      const u = m.userData, k = ++u.t / u.life;
      if (k >= 1) { m.visible = false; continue; }
      m.scale.setScalar(u.size * (0.5 + k * 0.85));
      m.material.opacity = Math.max(0, 1 - k * k) * u.peak;
    }
    const t = c ? c.t : -1;
    if (c && !V3.noCineSparks) {
      cineTextures();
      const v = c.v, mh = v.h * SC;
      // f45, the cut frame only: one large spark at the contact, in the ATTACKER's port colour with a
      // white core on top of it (the reference's spark is the attacker's element -- green for a sword)
      if (t >= FIN.CUT && lastCineT < FIN.CUT) {
        // Sized and dimmed against the first attempt, which was mh*2.6 at full opacity: additive over
        // the fighters it washed both of them to near-white and tinted them the attacker's port colour
        // (runs/p9fin2 k00). A hit spark marks the contact; it does not light the whole frame.
        const col = (c.a && c.a.color) || '#ffffff';
        cineSpark(sparkT, c.x, c.y, mh * 1.15, 15, Math.random() * 6.28, col, 0.5);
        cineSpark(sparkT, c.x, c.y, mh * 0.55, 10, Math.random() * 6.28, '#ffffff', 0.62);
      }
      // f50-f54 onward: electric sparks on the victim, a couple alive at a time, each on a new spot.
      // The cadence counts RENDER frames, not cinematic t. Spawning every third t looked fine on paper
      // but the hold runs the sim at about 1/10, so one t unit is ~10 render frames: a 9-frame spark
      // every 3 units meant the victim was bare for two thirds of the close-up (runs/p9pin, sparks:0
      // at t=9,12,18,30,45). Render frames also keep the rate the same through the fast cut and pull-back.
      if (t >= FIN.PUSH && t < FIN.PULL && (++boltN % 7) === 0) {
        const a = Math.random() * 6.28, r = (0.18 + Math.random() * 0.3) * v.h;
        cineSpark(boltT, v.x + Math.cos(a) * r, v.y - v.h * (0.35 + Math.random() * 0.5) + Math.sin(a) * r,
          mh * (0.13 + Math.random() * 0.13), 9, Math.random() * 6.28, '#ffffff', 0.7);   // the close-up shows ~1 mh of height, so mh*0.4+ was a bolt across half the screen (runs/p9fin3 k00)
      }
    }
    lastCineT = t;
  }

  // ---- camera: runs right after the gameplay camera (91 updateCamera) and takes over during a cinematic ----
  const cinePos = new THREE.Vector3(), cineLook = new THREE.Vector3(), gPos = new THREE.Vector3(), gLook = new THREE.Vector3();
  let arenaHidden = false;
  function setArena(show) {
    const I = V3.internals(), a = I.arena && I.arena();
    if (a) a.visible = show;
    arenaHidden = !show;
  }
  function frameAt(x, y, visH, sideK, out) {   // camera that shows visH world-3D units of height around (x, y)
    const dist = visH / (2 * CAM_TANF);
    out.pos.set(x + dist * 0.1 * sideK, y + dist * CAM_TILT, dist);
    out.look.set(x, y, 0);
  }
  const A = { pos: new THREE.Vector3(), look: new THREE.Vector3() }, Bf = { pos: new THREE.Vector3(), look: new THREE.Vector3() }, burstDir = new THREE.Vector3();
  function cineCamera(cam) {
    const c = FIN.cine, v = c.v, t = c.t, mh = v.h * SC * 1.32;
    const side = c.a ? Math.sign(v.x - c.a.x) || 1 : 1;
    // medium: the impact, both fighters about a fifth of the screen
    frameAt(c.x * SC, -c.y * SC, mh / 0.2, -side, A);
    // close: head and torso fill ~65 % of the screen, drifting slowly in
    const hold = Math.max(0, Math.min(1, (t - FIN.HOLD) / (FIN.PULL - FIN.HOLD)));
    frameAt(v.x * SC, -(v.y - v.h * 1.06) * SC, mh * 0.95 * (1 - 0.08 * hold), -side, Bf);   // head + torso ~65 % of the frame
    // Tekken's finish hold (brief 4.4): a slow ~24 degree orbit round the victim instead of a static close-up
    if (!V3.noCineOrbit) {
      const orb = 0.42 * easeOut(hold) * -side, oc = Math.cos(orb), os = Math.sin(orb);
      const dx = Bf.pos.x - Bf.look.x, dz = Bf.pos.z - Bf.look.z;
      Bf.pos.x = Bf.look.x + dx * oc + dz * os; Bf.pos.z = Bf.look.z - dx * os + dz * oc;
    }
    const k = easeOut((t - FIN.PUSH) / (FIN.HOLD - FIN.PUSH));
    cinePos.lerpVectors(A.pos, Bf.pos, k); cineLook.lerpVectors(A.look, Bf.look, k);
    const w = t < FIN.PULL ? 1 : 1 - ease((t - FIN.PULL) / (FIN.FULL - FIN.PULL));
    cam.position.lerpVectors(gPos, cinePos, w);
    cam.lookAt(gLook.clone().lerp(cineLook, w));
    cam.rotateZ((0.05 + 0.03 * hold) * side * w * k);   // a little dutch roll away from the launch
    return w;
  }
  // Frame everyone still alive for the end-of-match tableau: their bounding box plus headroom, never
  // tighter than a comfortable two-fighter shot, and always on real ground so nobody floats.
  function endBox(cam) {
    V3._endBoxN = (V3._endBoxN || 0) + 1;
    if (V3.noEndFrame) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, tall = 0.9, any = false;
    for (const f of Game.fighters) {
      if (f.state === 'dead') continue;
      const sp = standAt(f);
      const a = (sp.x - f.w) * SC, b = (sp.x + f.w) * SC;
      const c2 = -(sp.y + 10) * SC, d2 = -(sp.y - f.h * 1.5) * SC;
      if (a < x0) x0 = a; if (b > x1) x1 = b; if (c2 < y0) y0 = c2; if (d2 > y1) y1 = d2;
      tall = Math.max(tall, f.h * 1.32 * SC); any = true;
    }
    if (!any) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const visH = Math.max(tall / 0.42, (y1 - y0) * 1.5, (x1 - x0) / Math.max(1, cam.aspect) * 1.25);
    frameAt(cx, cy, visH, 0, A);
    cam.position.copy(A.pos); cam.lookAt(A.look); camLook.copy(A.look);
  }
  function outroCamera(cam, o) {
    const f = o.w; if (!f) return;
    const mh = f.h * SC * 1.32, k = Math.min(1, o.t / 150);
    const sp = standAt(f), gy = sp.y;
    frameAt(sp.x * SC, -(gy - f.h * 0.35) * SC, mh * (1.45 - 0.2 * easeOut(k)) / 0.8, Math.sin(o.t * 0.012), A);   // winner in the upper 2/3: the name slam sits below the feet
    cam.position.copy(A.pos); cam.lookAt(A.look);
  }
  // the outro always stands the winner on real ground: the surface under them, or — if they finished
  // in the air past an edge — the nearest point of the main stage (never mid-air in front of a wall)
  function standAt(f) {
    const st = Game.stage, M = st.main;
    if (!f.air && f.state !== 'dead') return { x: f.x, y: f.y };
    let best = null;
    if (f.x >= M.x0 + 20 && f.x <= M.x1 - 20 && M.top >= f.y) best = M.top;
    for (const p of st.plats) if (f.x >= p.x0 + 10 && f.x <= p.x1 - 10 && p.y >= f.y && (best === null || p.y < best)) best = p.y;
    if (best !== null) return { x: f.x, y: best };
    return { x: clamp(f.x, M.x0 + 70, M.x1 - 70), y: M.top };
  }
  const groundY = f => standAt(f).y;

  // ---- shader warm-up: nothing compiles mid-fight (the 200-600 ms hitches in the audit) ----
  // three.js releases a program when its last material is disposed, and hit sparks / damage pops are
  // created and disposed per hit, so the first spark after a quiet spell recompiled. One hidden keeper
  // per effect material holds every program alive; compileAsync then runs each time the cast or the
  // stage changes (it visits hidden objects too), during the countdown rather than on the first hit.
  let keepers = null, warmKey = '', warmBusy = false;
  function warm() {
    if (!keepers) {
      keepers = new THREE.Group(); keepers.visible = false; keepers.userData.shared = true;
      const g = new THREE.PlaneGeometry(1, 1), tex = new THREE.CanvasTexture(document.createElement('canvas'));
      keepers.add(
        new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),                 // burstAt
        new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })),            // popText
        new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));  // rings
      V3._keepers = keepers;   // dev inspection
      V3.scene.add(keepers); burstPlane(); if (!beams.length) beams.push(beamMesh());
      // Item props too: the first bomb / crate / pistol to drop compiled its lit shader mid-fight, 180 ms each and
      // 1.9 s on a cold GPU cache (a CPU match on dojo: frames 436 / 843 / 961, dev probe proglog). One of every
      // item kind (46, 92_v3_items makeProp, the same builder the stage and the hand use) waits in the keepers.
      if (typeof ITEM_DEFS !== 'undefined') for (const k of Object.keys(ITEM_DEFS)) {
        try { const pr = makeProp(k); V3.scene.remove(pr); keepers.add(pr); } catch (e) { V3.fxErr(e, '99_v3_finish warm ' + k); }
      }
      for (const mk of V3.warmExtras || []) { try { keepers.add(mk()); } catch (e) { V3.fxErr(e, '99_v3_finish warm extra'); } }
      // textured additive points (MOCHI's inhale grit, 94): 271 ms the first time on a cold GPU, 9/22 1080p playtest
      keepers.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ map: tex, color: 0xffffff, size: 0.1, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })));
      // and one of every projectile (91 projMesh, roster-2 kinds from 94): PEPE's first tear compiled at GO (24 ms)
      const pk = ['axe', 'bone', 'cash', 'coin', 'goldbar', 'hat', 'laser', 'tear', '_'].concat(V3.projKinds2 ? V3.projKinds2() : []);
      for (const kind of pk) {
        try { const o = projMesh({ kind, r: 12, x: 0, y: 0, vx: 1, vy: 0, age: 0, t: 0, color: '#ffffff', dmg: 5, owner: null }); V3.scene.remove(o); keepers.add(o); } catch (e) { V3.fxErr(e, '99_v3_finish warm proj ' + kind); }
      }
    }
    const key = (Game.stage && Game.stage.id) + '|' + avatars.size + '|' + (Game.fighters || []).map(f => f.c && f.c.id).join(',');
    if (key === warmKey) return;
    warmKey = key;
    // this cast's special-move effects (94 V3.warmMoves): built hidden now so they compile with the rest
    if (V3.warmMoves && !V3.noWarmMoves) { try { for (const o of V3.warmMoves(Game.fighters || [])) keepers.add(o); } catch (e) { V3.fxErr(e, '99 warmMoves'); } }
    // Compile against the composer's target, which is what the RenderPass draws into. With no target bound, three
    // keyed every program for the canvas (sRGB output + ACES tone mapping) and the scene pass then asked for the
    // linear / untonemapped variant: nothing this warmed was ever used, and every first effect still compiled
    // mid-fight (measured 9/22 night: the warmed bomb material got a second program on its first frame on stage).
    try {
      const I = V3.internals(), r = I.renderer, rt = I.composer && (I.composer.readBuffer || I.composer.renderTarget1);
      if (r.compileAsync) {
        const prev = r.getRenderTarget();
        if (rt && !location.hash.includes('nobloom')) r.setRenderTarget(rt);
        // NOT gating this on visibility. I suspected three r169's compile() used traverseVisible and
        // was therefore skipping every hidden keeper, and briefly shipped a change that forced them
        // visible for the traversal. dev/compiletest.mjs settles it by experiment: adding a novel
        // ShaderMaterial to the scene HIDDEN and then VISIBLE both raise info.programs by exactly 1.
        // compile() does reach hidden objects, the header comment above was right, and the change made
        // no measurable difference either (141.6 / 141.3 ms against a 131-141 baseline). Reverted.
        // ONE AT A TIME. compileAsync captures a material set and then polls each one's currentProgram
        // until it reports ready; if a second compile starts while the first is still polling and the
        // cast has changed under it, a material in the older set no longer has a current program and
        // three throws "Cannot read properties of undefined (reading 'isReady')" from inside its own
        // Set.forEach, as an UNCAUGHT error rather than a rejection, so the .catch below never sees it.
        // Seen once in four training runs (a mode that restarts the match, so warmKey changes twice in
        // quick succession); 0/3 on re-runs, which is exactly the shape of a race.
        if (!warmBusy) {
          warmBusy = true;
          try { Promise.resolve(r.compileAsync(V3.scene, V3.camera)).catch(() => {}).finally(() => { warmBusy = false; }); }
          catch (e) { warmBusy = false; }
        }
        r.setRenderTarget(prev);
      }
      // compileAsync warms PROGRAMS (hidden objects included -- proven, see the note above) but does
      // NOT upload textures: a texture crosses to the GPU on the first frame that actually draws it.
      // The Finish Zoom's planes are hidden until the KO, so its two 1024x1024 burst canvases and the
      // spark/bolt ones all uploaded on the single frame the zoom cut in, with renderer.info showing
      // tex 44 -> 46 on exactly that frame (runs/pt1, bonk vs wif on chart).
      // initTexture pushes them across during the countdown instead.
      //
      // And the same applies to EVERYTHING in the keepers, which is the whole point of that group:
      // every item prop, projectile and warmed move effect sits there hidden, so none of them is ever
      // rendered and none of their textures is ever uploaded, however well their programs compiled.
      // dev/firstdraw.mjs traced this: the match kept taking on new GPU work mid-fight (frames 873,
      // 920, 1659 ...), and the cost tracked TEXTURES, not geometry -- +7 geometries on one frame cost
      // 5 ms, while the frame that added a single texture cost 38 ms.
      if (r.initTexture) {
        const push = o => {
          const mats = !o.material ? [] : (Array.isArray(o.material) ? o.material : [o.material]);
          for (const m of mats) {
            if (!m) continue;
            for (const k of ['map', 'emissiveMap', 'normalMap', 'alphaMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
              const t = m[k];
              if (t && t.isTexture) { try { r.initTexture(t); } catch (e) {} }
            }
          }
        };
        for (const o of [burst, burstD].concat(cineFx)) if (o) push(o);
        if (keepers) keepers.traverse(push);   // traverse, NOT traverseVisible: the group is hidden
      }
      // and give every texture in the scene the GPU's anisotropy (90_v3_core). Same moment as the
      // uploads above, because both are "get the GPU ready before the fight", and warm() already
      // fires exactly when the stage or the cast changes.
      if (V3.sharpenTextures && !V3.noAniso) V3.sharpenTextures();
    } catch (e) { V3.fxErr(e, '99_v3_finish warm'); /* warm-up is best effort */ }
  }
  // [fighter fill, rim strength] per stage. The default was raised 0.06 -> 0.17 and the rim 0.55 ->
  // 0.74 on 9/27, when pushing the backdrop back (93_v3_fx) also dimmed the fighters through the
  // scene environment and left them BELOW the floor again: fighters 118.0, floor 132.4. The rule is
  // that the fighters are the brightest thing in frame, so the fix is to lift the subject rather
  // than keep darkening everything around it. The rim is the other half -- it is what draws an edge
  // between a fighter and whatever is behind them.
  const FILL = { _: [0.26, 0.74], keep: [0.40, 0.95], ship: [0.38, 0.85], train: [0.38, 0.85], lunar: [0.26, 0.8], swamp: [0.18, 0.8], city: [0.1, 0.7], shibuya: [0.1, 0.7], casino: [0.12, 0.7], floor: [0.1, 0.65], moon: [0.12, 0.7] };
  // every KO finish ends on the loser at the blast line (after the Finish Zoom when there was one): the
  // winner is never shown frozen mid-jump past an edge under GAME!, and the call never covers anyone
  const blastShot = () => on() && Game.endT > 0 && FIN.fin && !Game.timeUpT;
  // no damage pops during the cinematic or the GAME! frame (the HUD % already says it)
  const pop0 = popText;
  popText = function () { if (on() && (FIN.cine || Game.endT > 0)) return; return pop0.apply(this, arguments); };
  const uc0 = updateCamera;
  updateCamera = function (dt) {
    uc0(dt);
    warm();
    // fighter fill + rim by how dark the stage is (93 rimify): fighters read on every stage
    const lit = FILL[Game.stage && Game.stage.id] || FILL._;
    FX.rim.fill.value = lit[0]; FX.rim.strength.value = lit[1];
    const cam = V3.camera, P = burstPlane();
    const c = on() && FIN.cine, o = on() && FIN.out;
    FV.zoom = !!(c && c.t >= FIN.CUT && c.t < FIN.PULL);
    FV.quiet = !!(on() && (FV.zoom || Game.endT > 0));
    FV.banner = !!(on() && FIN.banner && !Game.endT);   // 70_render drops the "REKT" callout while the 1v1 score banner says it
    if (c && c.t >= FIN.CUT && c.t < FIN.FULL) {
      gPos.copy(cam.position); gLook.copy(camLook);
      const w = cineCamera(cam);
      // HIDE THE ARENA ONLY ONCE THE BURST CAN CARRY THE FRAME. This used to hide it on the first
      // frame of the cut, but the burst's opacity is the camera's own cinematic weight `w`, which
      // starts at 0 and ramps -- so for ~55-100 ms there was no stage, no burst yet and nothing else
      // in shot, and the climax of every match played a black blink. Measured, not guessed:
      // dev/koshots sampling at 55 ms caught exactly one frame at luma 5.0 with 56.7 before it and
      // 32.0 after, in the same place on every run. Waiting for w keeps the effect (the stage still
      // vanishes behind the burst at the peak) and removes the empty frame.
      if (c.t < FIN.PULL) { if (!arenaHidden && w > 0.35) setArena(false); } else if (arenaHidden) setArena(true);
      // The burst has to clear FASTER than the camera. The arena comes back at PULL, but w (the camera's
      // own cinematic weight) only reaches 0 at FULL, 14 units later -- so the stage, the sky and the HUD
      // were all back while the burst still sat over them at ~80 %, reading as a glitched red sky with
      // neon lightning across it rather than as a dissolve (runs/p9pin4 t54). Gone by PULL+8 instead.
      const bw = c.t < FIN.PULL ? w : w * Math.max(0, 1 - (c.t - FIN.PULL) / 8);
      P.visible = bw > 0.02;
      if (P.visible) {
        // on the line of sight 2.5 behind what the camera looks at (the orbit swings the camera off the z axis)
        burstDir.subVectors(cineLook, cam.position).normalize();
        P.position.copy(cineLook).addScaledVector(burstDir, 2.5);
        const d = cam.position.distanceTo(P.position), h = 2 * d * CAM_TANF * 1.7;
        P.quaternion.copy(cam.quaternion); P.rotateZ(c.t * 0.004);
        P.scale.set(h * cam.aspect * 1.3, h * 1.3, 1);
        P.material.opacity = bw;
        // deepens to red on the push-in, then clears first on the pull-back so the sky is not red
        const deep = Math.min(1, Math.max(0, (c.t - FIN.PUSH) / 6)) * (c.t < FIN.PULL ? 1 : Math.max(0, 1 - (c.t - FIN.PULL) / 5));
        P.material.color.setRGB(1, 1 - 0.35 * deep, 1 - 0.4 * deep);
        burstDeepLayer(P, bw, deep, c.t);
      } else burstDeepLayer(P, 0, 0, 0);
    } else if (blastShot() && !o && V3.blastShot) {
      // OFF BY DEFAULT since 9/24. The idea was a hard cut to the loser at the blast line while GAME!
      // slams in. In practice the loser is not on screen for it -- measured on three separate KOs, the
      // frame is the empty spot they fell through: pure burst, with the WINNER off-frame and one glove
      // clipping the corner (runs/p0ko k11-k15, runs/gsplit2). The winner projected to y=1589 in a
      // 577-tall viewport and the camera sat frozen at z=3.6 for all 140 frames of the banner.
      // Smash's GAME! tableau shows the fighters who are still standing, which is what the else-branch
      // below now does. V3.blastShot = true brings this back.
      const f = FIN.fin.f, t = Game.endT, mh = f.h * SC * 1.32, side = Math.sign(f.x) || 1;
      const visH = mh / (0.46 + 0.08 * easeOut(Math.min(1, t / 70))), shift = visH * cam.aspect * 0.3 * side;
      frameAt(f.x * SC - shift, -(f.y - f.h * 0.62) * SC, visH, -side, A);   // loser ~30 % off centre, toward the side they flew
      cam.position.copy(A.pos); cam.lookAt(A.look); cam.rotateZ(0.05 * side);
      if (!arenaHidden) setArena(false);
      const d = cam.position.z + 2.5, h = 2 * d * CAM_TANF * 1.7;
      P.visible = true; P.position.set(A.look.x, A.look.y, -2.5); P.quaternion.copy(cam.quaternion); P.rotateZ(t * 0.004);
      P.scale.set(h * cam.aspect * 1.3, h * 1.3, 1); P.material.opacity = 1; P.material.color.setRGB(0.72, 0.42, 0.38);   // darker than the zoom: the loser must read against it, not bloom into it
    } else {
      if (arenaHidden) setArena(true);
      P.visible = false; burstDeepLayer(P, 0, 0, 0);
      if (o && o.t > 6) outroCamera(cam, o);
      else if (on() && Game.endT > 0 && !o) {
        // THE "GAME!" TABLEAU. This used to take whatever camera it inherited and only tilt it up a
        // little. But the camera it inherits has just spent the KO chasing the loser out to a blast
        // line, so on a KO where FIN.fin was never set (blastShot() false -- measured: fin null) the
        // banner played over the empty spot the loser fell through, with the WINNER off-screen and one
        // glove clipping the corner. Measured: survivor projected to y=1589 in a 577-tall viewport,
        // camera frozen at z=3.6 for all 140 frames of endT (runs/p0ko, runs/gsplit2).
        // It now frames whoever is still standing, the same way the outro does, and holds it.
        endBox(cam);
        // push the subject DOWN the frame so the centred GAME! call clears their head -- at 0.16 the
        // text sat straight over the winner's face (runs/p0ko4)
        const k = easeOut(Math.min(1, Game.endT / 12)), lift = 2 * cam.position.z * CAM_TANF * 0.30 * k;
        cam.position.y += lift; gLook.copy(camLook); gLook.y += lift; cam.lookAt(gLook);
      }
    }
    // the close-up is about the victim's face: every hit spark, streak, ring, damage pop and spark cloud
    // magnified by the zoom used to bury it (Smash keeps the frame clean). Back on the pull-back.
    fxShown(!((c && c.t >= FIN.PUSH && c.t < FIN.FULL) || (o && o.t > 6) || (blastShot() && !o)));   // and no frozen sparks hanging in the outro
    cineFxFrame(c || null);   // the zoom's own sparks, which fxShown must NOT reach (see cineFxFrame)
    // popText is already blocked for the whole cinematic, but a pop spawned on the hit itself outlives
    // the cut and floats in the medium shot next to the fighters (the "+11%" in runs/p9pin3 t01).
    // The reference has no readout of any kind on screen from the cut frame on, so hide them from CUT.
    if (c && c.t >= FIN.CUT) for (const p of pops) p.visible = false;
    // the DOM chips over the play area (pause, Clip It, Controls, now-playing, sound) step aside for the
    // cinematic and the outro, like the HUD
    const cineUI = !!(on() && (FV.zoom || o));
    if (cineUI !== FV.cineUI) { FV.cineUI = cineUI; document.body.classList.toggle('tb-cine', cineUI); }
    // 91 re-lights its white hit light (intensity 25) on any live ring every frame; the KO ring is frozen
    // with the GAME! frame, so the light sat on the loser at full strength and burned them into a white ghost
    if (on() && (Game.endT > 0 || FV.zoom) && typeof hitLight !== 'undefined' && hitLight) hitLight.intensity = 0;
    // expanding rings stay local: the KO ring and the signature-hit ring (max 210) grew across a third of
    // the screen (audit evidence 03/19)
    for (const m of ringPool) if (m.visible && m.scale.x > 0.78) { m.scale.setScalar(0.78); m.material.opacity *= 0.8; }   // 9/23: 1.5 was a shock ring taller than the fighter it hit
    syncBeams(); syncTwinkles();
  };
  let fxWasHidden = false;
  function fxShown(v) {
    if (v && !fxWasHidden) return;
    try {
      for (const p of pops) p.visible = v;
      for (const b of bursts) b.visible = v;
      if (streaks) streaks.visible = v;
      if (smoke) smoke.visible = v;
      if (pts) pts.visible = v;
      if (!v) for (const r of ringPool) r.visible = false;
    } catch (e) { V3.fxErr(e, '99_v3_finish:199'); /* fx not built yet */ }
    fxWasHidden = !v;
  }

  // ---- fighters: frozen on GAME!, near-frozen in the zoom, the winner poses in the outro ----
  const au0 = Avatar.prototype.update;
  Avatar.prototype.update = function (dt) {
    // a KO'd fighter's weapon trail used to hang in the air for the whole respawn (Avatar.update returns
    // before V3.decorate while dead)
    if (this.f.state === 'dead' && this.trail && this.trail.pts.length) { this.trail.pts.length = 0; this.trail.mesh.visible = false; }
    if (on()) {
      const o = FIN.out;
      if (o && o.w === this.f && o.t > 6) return winnerPose(this, dt, o);
      if (!o && blastShot() && this.f === FIN.fin.f) {
        this.root.visible = true; this.tag.visible = false; this.shield.visible = false; this.disc.visible = false;
        this.root.position.set(this.f.x * SC, -this.f.y * SC, 0);
        // the dead frame kept the last flash / invulnerability shimmer, so the loser read as a pale ghost
        for (const m of this.mats) { m.emissive.setRGB(0, 0, 0); m.opacity = 1; }
        return;   // keep the last pose: the frame the launch crossed the line
      }
      if (Game.endT > 0) dt = 0;
      else if (FIN.cine && FIN.cine.t < FIN.FULL) dt *= 0.12;
    }
    const r = au0.call(this, dt);
    if (FV.quiet) this.tag.visible = false;
    // the hit-flash flicker runs on sim frames, so the slowed zoom stretched it into seconds of a pale,
    // washed-out victim: after the cut, hold the true colours
    if (FV.zoom && FIN.cine && FIN.cine.t >= FIN.PUSH) for (const m of this.mats) m.emissive.setRGB(0, 0, 0);
    // the close-up is the loser's: anyone else stands back out of the shot (a short attacker at the loser's feet sat
    // between the camera and a tall loser's face, runs/fz5 keep). Eased with the zoom so nothing pops.
    if (!V3.noCineStepBack && FV.zoom && FIN.cine && FIN.cine.v && this.root.visible) {
      const c = FIN.cine, k = Math.min(1, Math.max(0, (c.t - FIN.PUSH) / 6)) * (c.t < FIN.PULL ? 1 : 0);
      if (this.f !== FIN.cine.v) this.root.position.z -= 1.4 * k;
      else if (k > 0) {
        // and the loser turns their face to the camera for it: at the fight's 61-degree stance we were looking at the
        // back of their head through the whole close-up (runs/fz5). Eased in with the push, visual only.
        const want = Math.sign(this.yaw || 1) * 0.42;
        this.yaw += (want - this.yaw) * (0.25 * k);
        this.root.rotation.y = this.yaw;
        this.mirror.scale.x = this.yaw < 0 ? -1 : 1;
      }
    }
    if (this.statMdl === undefined) this.statMdl = staticBody(this);
    if (this.statMdl) moveStatic(this);
    return r;
  };
  // ---- procedural motion for a model with no skeleton (THISTLE / BLOAT until rigged ones ship) ----
  // The whole body is one rigid mesh, so it moves the way a toy would: breathing, a running hop, a lean,
  // a lunge on the strike frames, a tumble when launched, a stretch in the air. Visual only.
  function staticBody(av) {
    let skinned = false; av.model.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
    if (skinned) return null;
    return { y0: av.model.position.y, s0: av.model.scale.x };
  }
  function moveStatic(av) {
    const f = av.f, M = av.model, S = av.statMdl, t = f.t || 0;
    if (f.state === 'dead') return;
    let rx = 0, rz = 0, sy = 1, sx = 1, oy = 0;
    const run = f.state === 'ground' && Math.abs(f.vx) > 0.8;
    if (f.state === 'ground' && !run) { const b = Math.sin(t * 0.09); sy = 1 + 0.035 * b; sx = 1 - 0.02 * b; }
    if (run) { const ph = Math.abs(Math.sin(t * 0.32)); oy = ph * 0.18; rz = -0.16; sy = 1 + 0.05 * (ph - 0.5); }
    if (f.air && f.state !== 'hitstun') { const k = Math.max(-1, Math.min(1, -f.vy / 14)); sy = 1 + 0.12 * k; sx = 1 - 0.07 * k; rz = -0.12 * Math.sign(f.vx || 0) * f.face; }
    if (f.state === 'move' && f.move) {
      const d = f.move.def, h0 = d.hits && d.hits[0], a = h0 ? h0.f[0] : 6, e = h0 ? h0.f[1] : 10, mt = f.move.t;
      if (mt < a) { const k = mt / Math.max(1, a); rz = 0.3 * k; sx = 1 - 0.08 * k; }                 // wind up: lean back
      else if (mt <= e + 3) { rz = -0.42; sx = 1.14; sy = 0.92; }                                        // strike: lunge through
      else { const k = Math.min(1, (mt - e - 3) / 10); rz = -0.42 * (1 - k); }                           // recover
    }
    if (f.state === 'hitstun') { rz = f.tumble ? f.st * 0.35 : 0.35; rx = f.tumble ? 0 : 0.15; sy = 0.94; }
    if (f.state === 'shield') { sy = 0.9; sx = 1.06; }
    if (f.state === 'ledge') { rz = -0.25; }
    if (f.state === 'dizzy') rz = Math.sin(t * 0.2) * 0.25;
    M.rotation.set(rx, 0, rz);
    M.scale.set(S.s0 * sx, S.s0 * sy, S.s0 * sx);
    M.position.y = S.y0 + oy * (f.h * SC * 1.32) / Math.max(0.001, M.scale.y);
  }
  function winnerPose(av, dt, o) {
    const f = av.f;
    av.root.visible = true; av.tag.visible = false; av.shield.visible = false; av.disc.visible = false;
    const sp = standAt(f); av.root.position.set(sp.x * SC, -sp.y * SC, 0);
    av.yaw += (f.face * 0.35 - av.yaw) * 0.08;   // turn to face the camera
    av.root.rotation.set(0, av.yaw, 0); av.root.scale.set(1, 1, 1);
    // a winner still flashing or invulnerable when GAME! landed kept that frame's half-transparent / flashed
    // materials through the whole victory pose (9/22 night, runs/perfect): the plain state 91 uses between hits
    for (const m of av.mats) { m.emissive.setRGB(0, 0, 0); m.transparent = false; m.opacity = 1; }
    // the imported Victory_Fist_Pump when it shipped (dev/anim_import.py), the generic taunt otherwise; played once, held on its last frame
    // body language (9/22 night): the heavies (weight >= 115: Whale, Moodeng...) pound their chest (taunt), everyone else
    // throws the fist pump; both played once and held on the last frame
    const heavy = f.c.weight >= 115;
    const vc = !heavy && !V3.oldClips && V3.hasClip && V3.hasClip('victory2') ? 'victory2' : 'taunt';
    const act = av.play(vc, 0.25);
    act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
    act.paused = false; act.timeScale = 1;
    av.mixer.update(dt);
    try { V3.decorate(av); } catch (e) { V3.fxErr(e, '99_v3_finish:273'); /* cosmetic */ }
  }

  // ---- STAR KO (brief 4.2, 9/22 night) ----
  // 12_audio has always played the star-KO twinkle on every KO off the top blast line, but nothing showed it. Now
  // it shows, the way Smash does it: 0.25 s after the KO the victim reappears small in the far sky, tumbling away
  // from the camera into the distance, and goes out in a twinkle. Visual only, never on the match-ending KO (that
  // one gets the Finish Zoom), and instead of the blast beam. Over by 1.1 s: the respawn comes at 70 frames.
  const stars = new Map();   // fighter -> { t0, a: Vector3, b: Vector3, spin, tw }
  const ndcV = new THREE.Vector3(), rayD = new THREE.Vector3();
  function atDepth(nx, ny, z, out) {   // the world point on the camera ray through NDC (nx, ny) at world depth z
    const cam = V3.camera; ndcV.set(nx, ny, 0.5).unproject(cam); rayD.subVectors(ndcV, cam.position);
    const t = (z - cam.position.z) / (Math.abs(rayD.z) > 1e-6 ? rayD.z : -1e-6);
    return out.copy(cam.position).addScaledVector(rayD, t);
  }
  function starStart(e) {
    const B = Game.stage && Game.stage.blast;
    if (V3.noStarKO || !B || e.final || e.y > B.t + 2 || !e.f) return false;
    ndcV.set(e.x * SC, -e.y * SC, 0).project(V3.camera);
    const nx = Math.max(-0.7, Math.min(0.7, ndcV.x)), side = nx >= 0 ? 1 : -1;
    stars.set(e.f, { t0: performance.now(), a: atDepth(nx * 0.85, 0.32, -3, new THREE.Vector3()), b: atDepth(nx * 0.55 + side * 0.1, 0.7, -38, new THREE.Vector3()), spin: side, tw: null });
    return true;
  }
  let twTex = null;
  function twinkle(pos) {
    if (!twTex) twTex = starTex();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: twTex, color: 0xfff2b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    m.position.copy(pos); m.renderOrder = 20; V3.scene.add(m);
    return { m, t0: performance.now() };
  }
  const twinkles = [];
  function syncTwinkles() {
    const now = performance.now();
    for (let i = twinkles.length - 1; i >= 0; i--) {
      const w = twinkles[i], k = (now - w.t0) / 520;
      if (k >= 1) { V3.scene.remove(w.m); w.m.geometry.dispose(); w.m.material.dispose(); twinkles.splice(i, 1); continue; }
      const s = (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75) * 7;
      w.m.scale.setScalar(Math.max(0.01, s)); w.m.rotation.z = k * 2.4; w.m.quaternion.copy(V3.camera.quaternion); w.m.rotateZ(k * 2.4);
    }
  }
  const auStar = Avatar.prototype.update;
  Avatar.prototype.update = function (dt) {
    const r = auStar.call(this, dt);
    const S = stars.get(this.f);
    if (!S) return r;
    if (this.f.state !== 'dead') { stars.delete(this.f); return r; }
    const k = (performance.now() - S.t0 - 250) / 850;
    if (k < 0) { this.root.visible = false; return r; }
    if (k >= 1) {
      if (!S.tw) { S.tw = true; twinkles.push(twinkle(S.b)); }
      this.root.visible = false; return r;
    }
    const e = k * k;   // accelerating away
    this.root.visible = true; this.tag.visible = false; this.shield.visible = false; this.disc.visible = false;
    this.root.position.lerpVectors(S.a, S.b, e);
    this.root.rotation.set(0, this.yaw, (S.rz = (S.rz || 0) + 0.32 * S.spin));
    this.root.scale.setScalar(Math.max(0.05, 1.05 - e * 0.6));
    for (const m of this.mats) { m.emissive.setRGB(0, 0, 0); m.opacity = 1; }
    return r;
  };

  // ---- PERFECT / COMEBACK (brief 4.4): a tag over the winner's name in the outro. PERFECT = never lost a stock and
  // finished under 30 %; COMEBACK = was two or more stocks behind the leader at some point. Tracked from the KO events
  // (a WeakMap on the fighters: the sim never sees it).
  const deficit = new WeakMap();
  function noteDeficits() {
    const F = Game.fighters || [];
    for (const f of F) { const lead = Math.max(0, ...F.filter(g => g !== f).map(g => g.stocks)); deficit.set(f, Math.max(deficit.get(f) || 0, lead - f.stocks)); }
  }
  function outroTag(f) {
    if (!f || V3.noOutroTag) return null;
    if ((f.stats && f.stats.falls === 0) && f.dmg < 30) return { txt: 'PERFECT', a: '#fff6c8', b: '#ffc62e', c: '#b87a00' };
    if ((deficit.get(f) || 0) >= 2) return { txt: 'COMEBACK', a: '#ffd0d6', b: '#ff4f6e', c: '#a0122e' };
    return null;
  }
  function drawTag(ctx, T, x, y, size, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.font = `italic 900 ${size}px ${DISP}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y); g.addColorStop(0, T.a); g.addColorStop(0.55, T.b); g.addColorStop(1, T.c);
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size / 7); ctx.strokeStyle = 'rgba(5,5,7,.92)'; ctx.strokeText(T.txt, x, y);
    ctx.fillStyle = g; ctx.shadowColor = T.b; ctx.shadowBlur = size * 0.35; ctx.fillText(T.txt, x, y);
    ctx.restore();
  }

  // ---- KO beams: a column in the victim's colour from the blast line back into the stage ----
  const beams = [], seen = new WeakSet(), Y = new THREE.Vector3(0, 1, 0), dirV = new THREE.Vector3();
  function beamMesh() {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.35, 1, 28, 1, true), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.12, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    g.add(outer, core); g.visible = false; g.userData.shared = true; g.userData.outer = outer; g.userData.core = core; V3.scene.add(g);
    return g;
  }
  function syncBeams() {
    if (typeof FIN === 'undefined') return;
    for (const e of FIN.ko) {
      if (seen.has(e)) continue; seen.add(e);
      noteDeficits();
      if (starStart(e)) continue;   // off the top: a star KO instead of a beam
      let b = beams.find(x => !x.visible); if (!b && beams.length < 6) { b = beamMesh(); beams.push(b); }
      if (!b) continue;
      const M = Game.stage.main, cx = (M.x0 + M.x1) / 2, cy = M.top - 160;
      dirV.set((cx - e.x) * SC, -(cy - e.y) * SC, 0);
      const L = Math.min(3.5, dirV.length() * 0.4); dirV.normalize();
      b.quaternion.setFromUnitVectors(Y, dirV);
      b.position.set(e.x * SC + dirV.x * L / 2, -e.y * SC + dirV.y * L / 2, 0.2);
      b.userData.L = L; b.userData.t0 = performance.now(); b.userData.dur = e.final ? 900 : 700; b.userData.w = e.final ? 0.42 : 0.32;
      b.userData.outer.material.color.set(e.color);   // additive + bloom: anything brighter blows out to a white wedge
      b.visible = true;
    }
    const now = performance.now();
    for (const b of beams) {
      if (!b.visible) continue;
      const u = b.userData, k = (now - u.t0) / u.dur;
      if (k >= 1 || (on() && (FIN.out || blastShot()))) { b.visible = false; continue; }   // not across the blast-line close-up
      const kk = Math.min(1, k), grow = easeOut(kk * 5), fade = kk < 0.55 ? 1 : 1 - (kk - 0.55) / 0.45;
      const w = u.w * (0.35 + 0.65 * grow) * (0.7 + 0.3 * fade);
      b.scale.set(w, u.L * (0.4 + 0.6 * grow), w);
      u.outer.material.opacity = 0.5 * fade; u.core.material.opacity = 0.25 * fade;
    }
  }

  // ---- 2D overlay: HUD off in the zoom and the outro, the 1v1 stock banner, the wipe + name slam ----
  const DISP = '"Barlow Condensed", Impact, sans-serif';
  function chrome(ctx, txt, x, y, size, glow) {
    ctx.font = `italic 900 ${size}px ${DISP}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const g = ctx.createLinearGradient(0, y - size * 0.82, 0, y);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.42, '#eef0f5'); g.addColorStop(0.52, '#8f96a8'); g.addColorStop(0.6, '#ffffff'); g.addColorStop(1, '#c9ced9');
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size / 8); ctx.strokeStyle = 'rgba(5,5,7,.9)'; ctx.strokeText(txt, x, y);
    ctx.shadowColor = glow; ctx.shadowBlur = size * 0.35; ctx.fillStyle = g; ctx.fillText(txt, x, y); ctx.shadowBlur = 0;
  }
  let banY = 0;
  function banner(ctx, W, H) {
    const b = FIN.banner; if (!b) return;
    // 110px digits at 36 % height sat right on top of the fight for 1.6 s (runs/menus2/08_match.jpg).
    // Same beat, smaller and lifted clear of the play area, and off the screen a third sooner.
    const k = Math.min(1, b.t / 6), out = b.t > 62 ? (b.t - 62) / 14 : 0, a = Math.max(0, 1 - out);
    const size = Math.min(86, W * 0.072) * (1.35 - 0.35 * easeOut(k));
    // sit just under the utility row the HUD reserves (--util-y), never on it: on a short viewport a
    // flat H * 0.29 put the score straight through the pause / Clip It chips.
    if (b.t < 3 || !banY) { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--util-y')); banY = v > 0 ? v + 34 : H * 0.12; }
    const y = Math.max(H * 0.29, banY + size * 0.95);
    ctx.save(); ctx.globalAlpha = a * Math.min(1, b.t / 3);
    ctx.fillStyle = 'rgba(5,5,7,.5)'; ctx.fillRect(0, y - size * 0.95, W, size * 1.25);
    const F = Game.fighters, gap = size * 0.9;
    chrome(ctx, String(b.s[0]), W / 2 - gap, y, size, F[0].color);
    chrome(ctx, '–', W / 2, y - size * 0.06, size * 0.8, '#ffffff');
    chrome(ctx, String(b.s[1]), W / 2 + gap, y, size, F[1].color);
    ctx.restore();
  }
  function outro(ctx, W, H) {
    const o = FIN.out; if (!o) return;
    // diagonal stripe wipe: covers by tick 6 (the camera cuts to the winner there), uncovers by 14
    if (o.t < 15) {
      const k = o.t < 7 ? o.t / 6 : 1 - (o.t - 7) / 7, n = 9, sw = (W + H) / n;
      ctx.save(); ctx.fillStyle = '#050507';
      for (let i = 0; i < n; i++) {
        const len = (W + H) * Math.max(0, Math.min(1, k * 1.6 - i * 0.06));
        ctx.beginPath(); ctx.moveTo(i * sw - H, H); ctx.lineTo(i * sw - H + sw, H); ctx.lineTo(i * sw - H + sw + len, H - len); ctx.lineTo(i * sw - H + len, H - len); ctx.fill();
      }
      ctx.restore();
    }
    const f = o.w; if (!f || o.t < 70) return;
    const t = o.t - 70, k = easeOut(t / 7), size = Math.min(140, W * 0.11) * (2.2 - 1.2 * k);
    ctx.save(); ctx.globalAlpha = Math.min(1, t / 3);
    const y = H * 0.9, g = ctx.createLinearGradient(0, y - size, 0, y + size * 0.2);
    g.addColorStop(0, 'rgba(5,5,7,0)'); g.addColorStop(0.5, 'rgba(5,5,7,.6)'); g.addColorStop(1, 'rgba(5,5,7,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - size, W, size * 1.2);
    chrome(ctx, f.c.name, W / 2, y, size, f.color);
    if (t < 5) { ctx.globalAlpha = 1 - t / 5; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    const T = outroTag(f);
    if (T && t >= 10) { const kk = easeOut((t - 10) / 8), ts = Math.min(64, W * 0.05) * (1.6 - 0.6 * kk); drawTag(ctx, T, W / 2 + (1 - kk) * W * 0.08, y - Math.min(140, W * 0.11) * 0.95, ts, Math.min(1, (t - 10) / 4)); }
  }
  const hud0 = R.hud;
  R.hud = function (ctx, W, H) {
    const hide = on() && (FV.zoom || !!FIN.out);
    if (!hide) hud0.call(this, ctx, W, H);
    if (!on()) return;
    try { if (!FV.zoom && !FIN.out && !Game.endT) banner(ctx, W, H); outro(ctx, W, H); } catch (e) { V3.fxErr(e, '99_v3_finish:360'); /* overlay only */ }
  };

  // ---- render interpolation (audit C1): the sim runs at a fixed 60 Hz and the renderer used to draw raw
  // sim positions, so on 120/144 Hz screens (ProMotion MacBooks, iPhone Pros) fighters stepped every other
  // frame against a smooth camera. Positions are saved before each step and each frame is drawn between
  // the last two, then the real values are put back. Visual only: nothing the sim reads is left changed.
  const stepI = Game.step;
  Game.step = function () {
    for (const f of this.fighters) { f._px = f.x; f._py = f.y; }
    for (const p of this.projs) { p._px = p.x; p._py = p.y; }
    return stepI.apply(this, arguments);
  };
  const frameI = R.frame;
  R.frame = function () {
    const a = window.TB_ALPHA;
    if (a == null || a >= 0.999 || !(Game.state === 'match' || Game.state === 'title') || location.hash.includes('nointerp')) return frameI.apply(this, arguments);
    const saved = [];
    const mix = o => {
      if (o._px == null) return;
      const dx = o.x - o._px, dy = o.y - o._py;
      if (dx * dx + dy * dy > 150 * 150) return;   // respawn / blast / teleport: never smear across the screen
      saved.push(o, o.x, o.y); o.x = o._px + dx * a; o.y = o._py + dy * a;
    };
    for (const f of Game.fighters) mix(f);
    for (const p of Game.projs) mix(p);
    try { return frameI.apply(this, arguments); }
    finally { for (let i = 0; i < saved.length; i += 3) { saved[i].x = saved[i + 1]; saved[i].y = saved[i + 2]; } }
  };

  // ---- skip: any fresh key or tap once GAME! has landed goes straight to results ----
  const skip = e => {
    if (e.repeat || !on() || Game.state !== 'match') return;
    if (Game.endT >= 40 || FIN.out) { FIN.out = null; Game.finish(); }
  };
  addEventListener('keydown', skip, true);
  addEventListener('pointerdown', skip, true);
}
