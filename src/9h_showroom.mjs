// ===== character select: the fighter you are highlighting actually moves =====
//
// Duane, 9/28: "when you are selecting a character in the character selection, the character has to
// move while its highlighted. the same as EVERY OTHER GAME."
//
// He is right, and the hooks for it were already in the build with nothing behind them:
//   85_menu.js  calls `V3.showroom.set([...])` on every hover and every pick -- V3.showroom was
//               never written, so the call fell through to pointing the background attract fight at
//               the chosen fighters. The big panel stayed a static cutout.
//   01_head.html has `body.show3d .hero .art img{opacity:0}` -- a rule to hide that cutout once a
//               live view exists. Nothing ever set `show3d`.
//
// So this is the missing half. One small WebGL renderer draws the highlighted fighter with its idle
// clip running, and blits into a canvas in each hero panel. `body.show3d` goes on only once a frame
// has actually been drawn for a side, so a device that cannot make the context, or a model that has
// not finished loading, keeps the cutout instead of showing an empty panel.
//
// WHY ONE RENDERER AND NOT TWO: a second and third WebGL context alongside the match renderer is the
// kind of thing that works on this Mac and dies on a mid-range phone, where the context limit is
// real and losing one takes the GAME's canvas with it, not this one. One context renders side 0,
// blits it, renders side 1, blits it. The scenes are one character and three lights, so the cost is
// the two blits, and the loop stops dead the moment the select screen is hidden.
//
// NOT IN SIM_FILES and nothing here touches Game state, so the bet arena is unaffected; prove with
// dev/detcheck.js 1.
(function () {
  if (typeof V3 === 'undefined' || typeof THREE === 'undefined') return;

  const TMP_L = new THREE.Vector3(), TMP_R = new THREE.Vector3();
  // the hip line is the character's left-right axis, so its forward is a quarter turn off it. Which
  // quarter turn depends on the rig's handedness, and it is one of two values -- settled by rendering
  // six fighters and looking, not by reasoning about the exporter.
  // +, not -. Both are a quarter turn off the hip line and only one of them faces the player; the
  // wrong one shows all 46 fighters their own back, which is what a full-roster render caught after
  // the first version shipped. Settled by rendering, not by reasoning about the exporter.
  const FACE_OFF = Math.PI / 2;
  const W = 420, H = 620;              // offscreen render size; the panel scales it with CSS
  const FPS = 36;                      // the menu does not need 60, and the attract fight is behind it
  const S = {
    r: null, scene: null, cam: null, rig: null,
    sides: [null, null],               // { id, root, mixer, actions, cur, born }
    ids: [null, null],
    raf: 0, last: 0, t: 0, dead: false,
  };

  function css() {
    if (document.getElementById('showroomCss')) return;
    const s = document.createElement('style');
    s.id = 'showroomCss';
    // matches `.hero .art img` so the live view lands exactly where the cutout was
    // ABSOLUTE, not a flex child. The first version copied `.hero .art img`'s `position:relative`,
    // which made the canvas a SECOND item in the art box's flex row: the cutout kept its layout slot,
    // the two sat side by side, and together they were wider than the panel -- so the select screen
    // showed the fighter twice and spilled over the roster grid. Overlaying the same box instead
    // means the live view lands exactly where the cutout was and the cutout's own layout is untouched.
    // `object-position:bottom` so the fighter stands on the panel's baseline at any aspect.
    s.textContent = `.hero .art canvas.live{position:absolute;inset:0;width:100%;height:100%;
      object-fit:contain;object-position:center bottom;pointer-events:none;
      filter:drop-shadow(0 0 22px color-mix(in srgb,var(--c) 45%,transparent)) drop-shadow(0 20px 30px rgba(0,0,0,.6));
      animation:heroIn .45s cubic-bezier(.2,1,.3,1) both;opacity:0;transition:opacity .25s}
    .hero .art canvas.live.on{opacity:1}
    .hero.p2 .art canvas.live{animation-name:heroIn2}`;
    document.head.appendChild(s);
  }

  function boot() {
    if (S.r || S.dead) return !!S.r;
    try {
      S.r = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      S.r.setSize(W, H, false);
      S.r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      S.r.outputColorSpace = THREE.SRGBColorSpace;
      S.r.toneMapping = THREE.ACESFilmicToneMapping;
      S.r.toneMappingExposure = 1.15;
    } catch (e) { S.dead = true; return false; }   // no context to spare: the cutout stays
    S.scene = new THREE.Scene();
    // Framing, and the first version got this wrong in a way only a render showed: the camera sat at
    // y=1.05 looking at y=1.0, which is the TOP of a model whose 2.05 units run from -1.05 to +1.0.
    // The panel showed a head and shoulders in the bottom third with two thirds of empty canvas above.
    // Visible height here is 2*dist*tan(fov/2) = 2*5.4*tan(13 deg) = 2.49, against a 2.05 model, so
    // the whole fighter is in frame with a little headroom, and the eye line sits just above centre.
    S.cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 60);
    S.cam.position.set(0, 0.06, 5.4); S.cam.lookAt(0, -0.02, 0);
    // a portrait rig, not the stage's: strong key from the front-left, a cool fill to keep the dark
    // side readable, and a hot rim from behind so the silhouette separates from the panel.
    const key = new THREE.DirectionalLight(0xfff2e2, 3.1); key.position.set(-2.4, 3.4, 3.6);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.85); fill.position.set(3.0, 1.2, 2.2);
    const rim = new THREE.DirectionalLight(0xffd9a8, 2.6); rim.position.set(1.4, 2.6, -3.4);
    S.scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.42));
    S.rig = new THREE.Group(); S.scene.add(S.rig);
    css();
    return true;
  }

  function dispose(side) {
    const o = S.sides[side]; if (!o) return;
    S.sides[side] = null;
    try {
      S.rig.remove(o.root);
      // makeModel clones a material per mesh (see 91_v3_render's note on the same leak); hovering
      // across 46 tiles would otherwise leave 46 material sets on the GPU.
      o.root.traverse(m => {
        if (m.isMesh) { const mt = m.material; (Array.isArray(mt) ? mt : [mt]).forEach(x => x && x.dispose && x.dispose()); }
      });
      if (o.mixer) o.mixer.uncacheRoot(o.root);
    } catch (e) { /* teardown is best effort */ }
  }

  function build(side, id) {
    const mk = V3.makeModel && V3.makeModel(id);
    if (!mk) return null;
    const root = new THREE.Group();
    const inner = new THREE.Group(); root.add(inner); inner.add(mk.root);
    const scale = 2.05 / mk.height;
    mk.root.scale.setScalar(scale);
    mk.root.position.y = -mk.minY * scale;
    try { if (window.CustomLook && CustomLook.apply) CustomLook.apply(id, mk.root, THREE, null); } catch (e) { /* cosmetic */ }
    let hips = null, chest = null, lUp = null, rUp = null;
    mk.root.traverse(o => {
      if (!o.isBone) return;
      if (o.name === 'Hips' && !hips) hips = o;
      if (!chest && (o.name === 'Spine02' || o.name === 'Spine01' || o.name === 'Spine')) chest = o;
      if (o.name === 'LeftUpLeg' && !lUp) lUp = o;
      if (o.name === 'RightUpLeg' && !rUp) rUp = o;
    });
    // THE IDLE CLIP TURNS THE FIGHTER. Measured off assets/anims.json: the Hips quaternion swings
    // 70.7 degrees of yaw (-52.5 to +18.2) -- that is the bladed fighting stance 91_v3_render's note
    // describes, and in a match it is invisible because the fighter is small, side-on and far away.
    // In a head-to-toe portrait it reads as the character spinning on the spot, which is what the
    // first render of this showed: back, front, profile, front. So the yaw is cancelled at the group
    // every frame and everything else the clip does -- breathing, weight shift, arms -- is kept.
    const clips = V3.clipsFor(id, hips ? hips.position.clone() : null) || {};
    const mixer = new THREE.AnimationMixer(mk.root);
    const actions = {};
    for (const [n, c] of Object.entries(clips)) { const a = mixer.clipAction(c); a.enabled = true; actions[n] = a; }
    // the shared clips stand bladed; turn each side to face the middle of the screen
    inner.rotation.y = (side === 0 ? 1 : -1) * 0.34;
    root.position.y = -1.05;
    return { id, root, inner, mixer, actions, cur: null, born: 0, flour: 0, hips, chest, lUp, rUp,
             br: breathFor(id) };
  }

  // ── per-fighter select idle ────────────────────────────────────────────────
  // Every fighter used to throw the same punch on highlight and then settle into the same idle,
  // so the whole roster read as one character in different skins. No two fighters share a stance,
  // a breathing rate or a phase now, and all of it is derived from the fighter itself, so a new
  // one added to the roster gets its own without anybody authoring it.
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function charOf(id) {
    return (typeof CHAR_BY_ID !== 'undefined' && CHAR_BY_ID[id]) || null;
  }
  // a relaxed guard, never a move. Whichever real stance the rig actually carries.
  function stanceFor(o, id) {
    const pool = ['idle', 'guard', 'block2', 'block'].filter(n => o.actions[n]);
    if (!pool.length) return 'idle';
    const c = charOf(id), wt = c ? c.weight : 100;
    if (wt >= 118 && pool.indexOf('guard') >= 0) return 'guard';    // heavies plant and cover
    if (wt <= 88 && pool.indexOf('idle') >= 0) return 'idle';       // light ones stay loose
    return pool[Math.floor(hash(id) * pool.length) % pool.length];
  }
  // breathing: heavier fighters ride slower and deeper, quicker ones sit tighter and faster
  function breathFor(id) {
    const c = charOf(id), wt = c ? c.weight : 100, walk = c ? c.walk : 6.2, r = hash(id);
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    return {
      rate:  clamp(2.15 + (walk - 6.2) * 0.16 - (wt - 100) * 0.0045 + r * 0.45, 1.45, 3.15),
      rise:  clamp(0.030 + (wt - 100) * 0.00018 + (1 - r) * 0.013, 0.020, 0.050),
      chest: clamp(0.022 + (1 - r) * 0.016, 0.018, 0.040),
      phase: r * Math.PI * 2,
      sway:  0.028 + r * 0.034,
      swayRate: 0.30 + (1 - r) * 0.28,
    };
  }

  function play(o, name, fade) {
    if (!o.actions[name]) name = 'idle';
    if (!o.actions[name] || o.cur === name) return;
    const next = o.actions[name], prev = o.cur && o.actions[o.cur];
    next.reset(); next.setEffectiveWeight(1); next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) { prev.setEffectiveWeight(0); prev.stop(); }
    o.cur = name;
  }

  // the panel canvas the offscreen frame is blitted into
  function canvasFor(side) {
    const el = document.getElementById(side === 0 ? 'heroP1' : 'heroP2');
    const art = el && el.querySelector('.art');
    if (!art) return null;
    let c = art.querySelector('canvas.live');
    if (!c) {
      c = document.createElement('canvas'); c.className = 'live';
      c.width = W; c.height = H;
      art.appendChild(c);
    }
    return c;
  }

  function frame(now) {
    S.raf = 0;
    const sel = document.getElementById('scSelect');
    if (!sel || sel.hidden) { S.last = 0; document.body.classList.remove('show3d'); return; }   // loop stops with the screen
    const dt = S.last ? Math.min(0.05, (now - S.last) / 1000) : 0.016;
    if (S.last && now - S.last < 1000 / FPS) { S.raf = requestAnimationFrame(frame); return; }
    S.last = now; S.t += dt;
    let drew = 0;
    for (let i = 0; i < 2; i++) {
      const o = S.sides[i]; if (!o) continue;
      const cv = canvasFor(i); if (!cv) continue;
      o.born += dt;
      // a greeting on highlight, then settle into idle -- the beat every fighting game's select has
      if (o.flour && o.born > o.flour) { o.flour = 0; play(o, 'idle', 0.28); }
      o.mixer.update(dt);
      // and a slow sway, so even a dead-still idle clip is never a frozen image
      // FACE THE PLAYER, measured rather than guessed.
      //
      // The first version subtracted the hips' LOCAL yaw plus two thirds of the chest's. That was
      // tuned on doge and does not generalise: hovering bull, pengu, tyrant and wojak showed three
      // of the four their BACK, because each clip leaves a different residual down the spine chain.
      //
      // Exact instead. Zero the group, update the world matrix, read the yaw the animation has
      // actually put the hips at, then set the group to whatever cancels it and leaves the target.
      // Rig-agnostic -- it never needs to know which bones carry the turn or how much -- and it
      // costs one extra matrix update per fighter per frame.
      const br = o.br;
      const want = (i === 0 ? 1 : -1) * 0.34 + Math.sin(S.t * br.swayRate + br.phase) * br.sway;
      if (o.lUp && o.rUp) {
        o.inner.rotation.y = 0;
        o.root.updateMatrixWorld(true);
        o.lUp.getWorldPosition(TMP_L); o.rUp.getWorldPosition(TMP_R);
        // the HIP LINE, not a bone's own axes. Reading yaw off the hips bone matrix was the second
        // wrong answer here: a bone's local axes run along the bone, so its "forward" is whatever the
        // rigger happened to choose, and five of six fighters still showed the camera their back.
        // The vector between the two thigh joints is unambiguous -- it is the character's left-right
        // axis by construction -- and the hips twist far less than the shoulders do mid-punch.
        const side = Math.atan2(TMP_R.x - TMP_L.x, TMP_R.z - TMP_L.z);
        o.inner.rotation.y = want - (side + FACE_OFF);
      } else {
        o.inner.rotation.y = want;
      }
      // breathing: the body rides up and down on the breath, and the chest leads it slightly.
      // The mixer rewrites every bone each frame, so the chest delta is applied after
      // mixer.update and never accumulates.
      const b = Math.sin(S.t * br.rate + br.phase);
      o.root.position.y = -1.05 + b * br.rise + Math.sin(S.t * br.rate * 2 + br.phase) * br.rise * 0.16;
      if (o.chest) o.chest.rotation.x -= b * br.chest;
      S.rig.clear(); S.rig.add(o.root);
      try {
        S.r.render(S.scene, S.cam);
        const g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        g.drawImage(S.r.domElement, 0, 0, cv.width, cv.height);
        if (!cv.classList.contains('on')) {
          cv.classList.add('on');
          // and take the cutout out, per side, the moment THIS side has a real frame. The body-level
          // `show3d` rule cannot express "side 1 is live but side 2 is still loading".
          //
          // `display`, NOT `opacity`: `.hero .art img` carries `animation:heroIn .45s ... both`, and a
          // CSS animation with a fill mode beats an inline style, so `img.style.opacity='0'` was
          // silently ignored and the select screen drew the cutout ON TOP of the live fighter --
          // measured opacity 1 eight seconds in, with both figures visible in the capture.
          const im = cv.parentNode && cv.parentNode.querySelector('img');
          if (im) im.style.display = 'none';
        }
        drew++;
      } catch (e) { /* a lost context must not take the menu with it */ }
    }
    document.body.classList.toggle('show3d', drew > 0);
    S.raf = requestAnimationFrame(frame);
  }

  function kick() { if (!S.raf) S.raf = requestAnimationFrame(frame); }

  V3.showroom = {
    set(ids) {
      if (!ids || !ids.length || !boot()) return;
      for (let i = 0; i < 2; i++) {
        const id = ids[i] || null;
        if (id === S.ids[i]) continue;
        S.ids[i] = id;
        dispose(i);
        const cv = canvasFor(i);
        if (cv) { cv.classList.remove('on'); const im = cv.parentNode && cv.parentNode.querySelector('img'); if (im) im.style.display = ''; }
        if (!id) continue;
        const make = () => {
          if (S.ids[i] !== id) return;                 // hovered somewhere else while it loaded
          const o = build(i, id); if (!o) return;
          S.sides[i] = o; S.rig.add(o.root);
          // straight into that fighter's own stance. No greeting swing -- he wants them standing
          // there like a fighter waiting for the bell, not performing.
          play(o, stanceFor(o, id), 0);
          o.flour = 0;
          kick();
        };
        if (V3.makeModel && V3.makeModel(id)) make();
        else if (V3.loadChar) V3.loadChar(id).then(make, () => {});   // not loaded yet: cutout until it is
      }
      kick();
    },
    stop() { document.body.classList.remove('show3d'); if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } },
  };
})();
