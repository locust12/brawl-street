// ===== 3D: painted backdrops, colour grade, rim light, smoke, spark streaks, impact bursts, damage pops, super takeover =====
// Visual only: reads Game/fighter state, never writes it, and never touches the seeded fight RNG.
// uRimDir is VIEW SPACE, because the rim is computed against the view normal. Pointing up-and-behind
// and slightly to the camera's left is the standard three-quarter back light: it catches the top of
// the head, the shoulders and the outside of the limbs, and leaves the front and the underside alone.
const FX = { grade: null, rim: { color: { value: new THREE.Color(1, 0.85, 0.6) }, strength: { value: 0.55 },
  fill: { value: 0.06 }, dir: { value: new THREE.Vector3(-0.45, 0.78, -0.44).normalize() } } };

// ---- per-arena look: grade + rim + backdrop placement ----
const LOOK = {
  isle:  { sat: 1.2,  con: 1.08, tint: [1.04, 1.0, 0.94], vig: 0.34, rim: [1.0, 0.86, 0.62], rimK: 0.55, bgY: 3.2 },
  moon:  { sat: 1.22, con: 1.12, tint: [1.1, 0.96, 0.88], vig: 0.46, rim: [0.45, 0.82, 1.0], rimK: 1.0,  bgY: 2.8 },
  chart: { sat: 1.18, con: 1.06, tint: [1.0, 1.02, 1.02], vig: 0.28, rim: [0.9, 0.97, 1.0], rimK: 0.45, bgY: 2.4 },
  keep:  { sat: 0.86, con: 1.14, tint: [0.9, 0.97, 1.12], vig: 0.58, rim: [1.0, 0.78, 0.5], rimK: 0.85, bgY: 3.2 },
  roof:  { sat: 1.2,  con: 1.12, tint: [1.0, 0.95, 1.1], vig: 0.48, rim: [1.0, 0.86, 0.66], rimK: 0.85, bgY: 3.1 },
  dojo:  { sat: 1.08, con: 1.06, tint: [1.04, 0.98, 1.0], vig: 0.38, rim: [1.0, 0.74, 0.62], rimK: 0.6, bgY: 3.0 },
  city:  { sat: 1.18, con: 1.08, tint: [1.02, 0.96, 1.08], vig: 0.42, rim: [0.95, 0.45, 1.0], rimK: 0.75, bgY: 3.2 },
  ship:  { sat: 1.15, con: 1.02, tint: [1.02, 1.02, 1.12], vig: 0.30, rim: [0.55, 0.78, 1.0], rimK: 0.75, bgY: 3.0 },
  street: { sat: 1.14, con: 1.06, tint: [1.07, 0.99, 0.93], vig: 0.34, rim: [1.0, 0.72, 0.48], rimK: 0.7, bgY: 3.0 },
  arena: { sat: 1.15, con: 1.1,  tint: [1.0, 0.97, 1.06], vig: 0.46, rim: [1.0, 0.35, 0.4], rimK: 0.8, bgY: 3.0 },
  swamp: { sat: 1.08, con: 1.1,  tint: [0.96, 1.02, 0.97], vig: 0.52, rim: [1.0, 0.82, 0.5], rimK: 0.85, bgY: 3.0, plate: [0.82, 0.84, 0.8] },
  floor: { sat: 1.12, con: 1.06, tint: [1.05, 1.0, 0.94], vig: 0.38, rim: [1.0, 0.8, 0.55], rimK: 0.6, bgY: 3.2 },
  train: { sat: 1.18, con: 1.0,  tint: [1.04, 1.0, 1.12], vig: 0.28, rim: [0.9, 0.5, 1.0], rimK: 0.75, bgY: 3.0 },
  peak:  { sat: 1.1,  con: 1.08, tint: [0.96, 1.0, 1.08], vig: 0.4,  rim: [0.55, 1.0, 0.85], rimK: 0.7, bgY: 3.2 },
  lunar: { sat: 1.05, con: 1.14, tint: [1.0, 1.0, 1.04], vig: 0.46, rim: [0.6, 0.75, 1.0], rimK: 0.6, bgY: 3.4 },
  casino: { sat: 1.18, con: 1.08, tint: [1.06, 0.98, 0.98], vig: 0.42, rim: [1.0, 0.6, 0.4], rimK: 0.75, bgY: 3.0 },
  shibuya: { sat: 1.2,  con: 1.1,  tint: [1.0, 0.97, 1.08], vig: 0.44, rim: [1.0, 0.45, 0.95], rimK: 0.8, bgY: 3.0 },
  baghdad: { sat: 1.12, con: 1.05, tint: [1.08, 1.0, 0.9],  vig: 0.34, rim: [1.0, 0.78, 0.5], rimK: 0.62, bgY: 3.0 },
  miami:  { sat: 1.16, con: 1.15, tint: [1.05, 0.985, 1.01], vig: 0.44, rim: [1.0, 0.55, 0.8], rimK: 0.7, bgY: 3.0 },
};

// Colour grade, applied after tone mapping (sRGB space).
// 9/23: this was saturation, contrast, tint and a vignette -- an honest but "rendered" look. The four
// things below are what a film grade actually does, and together they are most of the difference
// between a WebGL frame and a shot:
//   * a FILM TOE AND SHOULDER. Straight contrast clips: it drives darks to pure 0 and brights to pure
//     1 and the image goes plastic. A toe lifts the deepest shadows slightly off black and a shoulder
//     rolls the highlights in, so nothing flatlines and the midtones get the range back.
//   * SPLIT TONING. Cool shadows, warm highlights. Every live-action grade does it and it reads as
//     depth for free, because the eye takes cool as further away.
//   * CHROMATIC ABERRATION, scaled by distance from the centre so it is zero where the fight is and
//     only touches the frame edge. A real lens does this; a renderer does not, and its absence is one
//     of the strongest "this is CG" signals.
//   * GRAIN, tied to the frame counter. Fine, cheap, and it hides the banding that a smooth gradient
//     in an 8-bit output always shows -- our skies band without it.
// All four are deliberately small. V3.flatGrade = the old look for A/B.
V3.postSetup = function (composer) {
  FX.grade = new V3.ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, sat: { value: 1.15 }, con: { value: 1.06 },
      tint: { value: new THREE.Vector3(1, 1, 1) }, vig: { value: 0.35 }, flash: { value: 0 },
      tone: { value: 1 }, ca: { value: 1 }, grain: { value: 1 }, t: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, con, vig, flash, tone, ca, grain, t; uniform vec3 tint; varying vec2 vUv;
      void main(){
        vec2 d = vUv - .5;
        float r2 = dot(d, d);
        // lens: the channels separate a little toward the edge of the frame, never in the middle
        vec3 c;
        if (ca > 0.001) {
          vec2 off = d * r2 * 0.0042 * ca;
          c = vec3(texture2D(tDiffuse, vUv + off).r,
                   texture2D(tDiffuse, vUv).g,
                   texture2D(tDiffuse, vUv - off).b);
        } else c = texture2D(tDiffuse, vUv).rgb;

        float l = dot(c, vec3(.2126,.7152,.0722));
        c = mix(vec3(l), c, sat);
        c = (c - .5) * con + .5;
        c *= tint;

        if (tone > 0.001) {
          // toe + shoulder: lift the floor off pure black, roll the ceiling in
          vec3 lifted = mix(vec3(0.016), vec3(0.992), clamp(c, 0., 1.));
          c = mix(c, lifted - 0.055 * lifted * lifted * (1.0 - lifted) * 4.0 + 0.012, tone);
          // split tone: cool the shadows, warm the highlights
          float lum = clamp(dot(c, vec3(.2126,.7152,.0722)), 0., 1.);
          vec3 cool = vec3(0.92, 0.97, 1.06), warm = vec3(1.05, 1.005, 0.95);
          c *= mix(cool, warm, smoothstep(0.18, 0.82, lum)) * tone + (1.0 - tone);
        }

        c *= 1. - vig * smoothstep(.25, .85, r2 * 2.2);
        c = mix(c, vec3(1.), flash);

        if (grain > 0.001) {
          float n = fract(sin(dot(vUv * vec2(1301.7, 941.3) + t, vec2(12.9898, 78.233))) * 43758.5453);
          c += (n - 0.5) * 0.020 * grain;
        }
        gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
      }`,
  });
  composer.addPass(FX.grade);
};

// Fresnel rim light on every fighter material: the "pop" the trailer characters have.
V3.rimify = function (mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRimColor = FX.rim.color; sh.uniforms.uRimStrength = FX.rim.strength; sh.uniforms.uFill = FX.rim.fill;
    sh.uniforms.uRimDir = FX.rim.dir;
    // uFill: a fighter-only fill light (the stage lights never see it). On a dark stage (Shadow Keep) the
    // fighters were lit only by the stage and came out as black silhouettes; 99_v3_finish sets it per stage.
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength; uniform float uFill; uniform vec3 uRimDir;')
      // DIRECTIONAL, 9/27. A bare fresnel rims the WHOLE silhouette evenly -- ears, the inside of the
      // legs, the underside of the feet -- and at the strength the fighters need to separate from a
      // stage it stops reading as light and starts reading as a sticker outline. Seen at 3x on both
      // DOGE and VAULT. Gating it on the angle to a back-light direction leaves the rim only where a
      // real one would fall, so the strength can stay high without the cutout look.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.6);\n float rimD = smoothstep(-0.15, 0.75, dot(normalize(normal), normalize(uRimDir)));\n totalEmissiveRadiance += uRimColor * rimF * rimD * uRimStrength + diffuseColor.rgb * uFill;');
  };
  mat.customProgramCacheKey = () => 'rim3';
};

// ---- painted backdrop plates ----
const bgTex = {};
function loadBackdrop(id) {
  if (bgTex[id]) return bgTex[id];
  // A failed download used to resolve null AND stay cached: that stage had no sky (black, or the bare procedural
  // wall) for every match of the session. Now: two retries with backoff (cache-busted), and a final failure is
  // not cached, so the next match on that stage tries again.
  let tries = 0;
  return bgTex[id] = new Promise(res => {
    const go = () => {
    const im = new Image();
    im.onload = () => {
      // ATMOSPHERIC PERSPECTIVE. The painted plates were as sharp, as bright and as saturated as the
      // fighters standing in front of them, so at 1920 the backdrop was the highest-contrast thing on
      // screen and the fighters sank into it (runs/gfx/a_live420.png). Smash's rule is the opposite:
      // the fighters are the brightest, most saturated, highest-contrast object, always. A far plate
      // is far, so it gets what distance does to it -- blur that scales with the source (1.6px was
      // nothing at this resolution), less saturation, less contrast, and a haze wash toward the sky.
      // Per-stage tinting still happens afterwards via LOOK.plate.
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d');
      const blurPx = V3.bgBlur != null ? V3.bgBlur : Math.max(1.6, c.width / 560);
      // 9/27: measured on a 1920x1080 Rune Isle frame, the plate was still landing at luminance 131.9
      // against fighters at 131.5 -- dead level, so the fighters had nothing to separate from. These
      // numbers are the rule three lines above turned into an actual gap rather than an intention.
      try { g.filter = `blur(${blurPx.toFixed(1)}px) saturate(${V3.bgSat != null ? V3.bgSat : 0.70}) brightness(${V3.bgBright != null ? V3.bgBright : 0.74}) contrast(0.86)`; } catch (e) {}
      g.drawImage(im, 0, 0);
      // haze: a soft wash of the plate's own upper colour, heaviest low down where depth reads most
      try {
        g.filter = 'none';
        const sky = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.08), 1, 1).data;
        const haze = g.createLinearGradient(0, 0, 0, c.height);
        haze.addColorStop(0, `rgba(${sky[0]},${sky[1]},${sky[2]},0.07)`);
        haze.addColorStop(0.55, `rgba(${sky[0]},${sky[1]},${sky[2]},0.15)`);
        haze.addColorStop(1, `rgba(${sky[0]},${sky[1]},${sky[2]},0.22)`);
        g.fillStyle = haze; g.fillRect(0, 0, c.width, c.height);
      } catch (e) { /* tainted canvas: the blur alone still helps */ }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QUAL.aniso;
      t.userData.shared = true;   // cached per stage: V3.disposeArena leaves it uploaded
      res(t);
    };
    im.onerror = () => { if (++tries < 3) setTimeout(go, 900 * tries); else { delete bgTex[id]; res(null); } };
    im.src = 'assets/bg_' + id + '.jpg' + (tries ? '?r=' + tries : '');
    };
    go();
  });
}
V3.onArena = function (st, arena) {
  const look = LOOK[st.id] || LOOK.isle;
  if (FX.grade) { const u = FX.grade.uniforms; u.sat.value = look.sat; u.con.value = look.con; u.tint.value.set(...look.tint); u.vig.value = look.vig;
    const flat = !!V3.flatGrade;
    u.tone.value = flat ? 0 : 1; u.ca.value = flat ? 0 : (look.ca != null ? look.ca : 1); u.grain.value = flat ? 0 : (look.grain != null ? look.grain : 1); }
  FX.rim.color.value.setRGB(...look.rim); FX.rim.strength.value = look.rimK;
  // GROUND THE FIGHTERS. 551 meshes cast shadows and only 26 received one, so the shadow map was
  // being rendered and then landing on almost nothing: the fighters, the crystals and the props all
  // floated on an evenly-lit floor (runs/gfx/c_*.png). Every opaque piece of stage geometry now
  // receives. Transparent / additive FX are skipped -- a shadow on a glow reads as a dirty smear.
  if (!V3.noStageShadows) {
    try {
      let n = 0;
      arena.traverse(o => {
        if (!o.isMesh || o.receiveShadow) return;
        const m = o.material;
        const mats = Array.isArray(m) ? m : [m];
        if (mats.some(x => x && (x.transparent || x.blending === THREE.AdditiveBlending || x.depthWrite === false))) return;
        o.receiveShadow = true; n++;
      });
      V3._shadowRecv = n;
    } catch (e) { V3.fxErr(e, '93 receiveShadow'); }
  }
  loadBackdrop(st.id).then(tex => {
    if (!tex || arena.parent !== V3.scene) return;
    // hide the far procedural scenery; the painting replaces it
    arena.traverse(o => { if (o === arena || o.isLight || o.userData.keep) return; if (o.parent === arena && o.position.z < -4.8) o.visible = false; if (o.geometry && o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius > 100) o.visible = false; });
    const W = 96, H = W * 1152 / 2688;
    // `plate` in LOOK tints the painted backdrop, which is otherwise untouchable: it is
    // toneMapped:false and fog:false on purpose, so a stage relit to dusk would keep a backdrop in
    // full sun. Gloom Bayou needed exactly that (9/21).
    const pm = new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false, depthWrite: false });
    if (look.plate) pm.color.setRGB(...look.plate);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(W, H), pm);
    plate.position.set(0, look.bgY, -46); plate.renderOrder = -10; plate.userData.keep = true;
    arena.add(plate);
    FX.plate = plate;
    // THE VOID (9/22 night): no scene background was ever set, so anywhere the camera saw past the painting (following a
    // fighter launched off the bottom, the Finish Zoom's pull-back, a tall stage) was a band of pure black. The background
    // is now a vertical gradient from the plate's own top-edge colour to its bottom-edge colour (same tint), so running
    // off the painting continues its sky and its water instead of a hole.
    try { V3.scene.background = edgeGradient(tex, look.plate); } catch (e) { V3.fxErr(e, '93 edgeGradient'); }
  });
  FX.plate = null;
  if (V3.scene.background && V3.scene.background.userData && V3.scene.background.userData.edge) V3.scene.background = null;   // until this stage's plate lands
};
const edgeCache = new WeakMap();
function edgeGradient(tex, tint) {
  if (edgeCache.has(tex)) return edgeCache.get(tex);
  const src = tex.image, w = src.width, h = src.height, g = src.getContext('2d');
  const avg = (y0, n) => { const d = g.getImageData(0, y0, w, n).data; let r = 0, gg = 0, b = 0; const k = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return [r / k, gg / k, b / k]; };
  const top = avg(0, Math.max(2, h >> 6)), bot = avg(h - Math.max(2, h >> 6), Math.max(2, h >> 6));
  const t = tint || [1, 1, 1], css = c => `rgb(${c.map((v, i) => Math.round(Math.min(255, v * t[i]))).join(',')})`;
  const c = document.createElement('canvas'); c.width = 2; c.height = 128; const cg = c.getContext('2d');
  const gr = cg.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, css(top)); gr.addColorStop(0.5, css(top.map((v, i) => (v + bot[i]) / 2))); gr.addColorStop(1, css(bot));
  cg.fillStyle = gr; cg.fillRect(0, 0, 2, 128);
  const out = new THREE.CanvasTexture(c); out.colorSpace = THREE.SRGBColorSpace; out.userData.edge = true; out.userData.shared = true;
  edgeCache.set(tex, out); return out;
}

// ---- smoke (normal-blended soft puffs) ----
const MAXS = 600;
let smoke, sPos, sCol, sSize, sAlpha;
function smokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) { const x = 40 + Math.random() * 48, y = 40 + Math.random() * 48, r = 26 + Math.random() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  // the blobs above reach past the canvas edge (centre 88 + radius 52 > 128), so every puff was a faintly visible
  // SQUARE, and a pile of big ones drew a hard-edged grey box over the stage. Mask it round: zero at the rim.
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(64, 64, 0, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.62, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, 128, 128); g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); return t;
}
function makeSmoke() {
  const geo = new THREE.BufferGeometry();
  sPos = new Float32Array(MAXS * 3); sCol = new Float32Array(MAXS * 3); sSize = new Float32Array(MAXS); sAlpha = new Float32Array(MAXS);
  geo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sSize, 1)); geo.setAttribute('alpha', new THREE.BufferAttribute(sAlpha, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true, uniforms: { map: { value: smokeTex() }, scale: { value: 1000 } },
    vertexShader: 'attribute float size; attribute float alpha; varying vec3 vc; varying float va; uniform float scale; void main(){ vc = color; va = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec3 vc; varying float va; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vc, t.a * va); }',
  });
  smoke = new THREE.Points(geo, m); smoke.frustumCulled = false; smoke.renderOrder = 5; V3.scene.add(smoke);
}
const cT = new THREE.Color(), SMOKE_GREY = new THREE.Color(0xd4d8e2), SMOKE_WHITE = new THREE.Color(0xffffff);
const trailPrev = new Map();
function syncSmoke(scale) {
  let n = 0; trailPrev.clear();
  // Soft smoke is the most expensive thing this layer draws: big additive quads that pile up over
  // each other, and `partsOff` was worth 17 ms of a 98 ms frame at 3200x1800. Below the top tier,
  // draw a fixed fraction of them. A STRIDE, not a random pick, so the ones that survive are the
  // same ones next frame and the cloud thins instead of flickering. Reads Game.parts, writes nothing.
  const step = QUAL.parts >= 1 ? 1 : Math.max(1, Math.round(1 / QUAL.parts));
  let idx = 0;
  for (const p of Game.parts) {
    if (!p.soft || n >= MAXS) continue;
    if (step > 1 && (idx++ % step)) continue;
    const k = p.life / p.max;
    sPos[n * 3] = p.x * SC; sPos[n * 3 + 1] = -p.y * SC; sPos[n * 3 + 2] = 0.3;
    cT.set(p.color);
    // 60_game's launch trail (a still puff in the victim's colour every 2nd frame) drew as a dotted line of solid
    // coloured disks. Smash's is smoke: it leaves the body tinted, then greys out, swells and thins as it hangs.
    if (p.max === 26 && p.size === 11 && !p.vx && !p.vy) {
      cT.lerp(SMOKE_GREY, 0.35 + (1 - k) * 0.5);
      sSize[n] = p.size * (0.9 + (1 - k) * 1.9) * SC * 2.2; sAlpha[n] = Math.min(1, k * 2.2) * 0.34;
      // a fast launch puts the puffs 20-40 px apart: fill the gap to the same fighter's previous puff (same colour),
      // so the trail is one streak of smoke, not a dotted line
      const q = trailPrev.get(p.color);
      if (q && p.life > q.life && p.life - q.life <= 3 && n + 2 < MAXS) {   // parts are oldest first: q is 2 frames older
        const d = Math.hypot(p.x - q.x, p.y - q.y), extra = Math.min(2, Math.floor(d / 12));
        for (let e = 1; e <= extra; e++) {
          const u = e / (extra + 1), m = n + e, kk = (q.life + (p.life - q.life) * u) / p.max;
          sPos[m * 3] = (q.x + (p.x - q.x) * u) * SC; sPos[m * 3 + 1] = -(q.y + (p.y - q.y) * u) * SC; sPos[m * 3 + 2] = 0.3;
          sCol[m * 3] = cT.r; sCol[m * 3 + 1] = cT.g; sCol[m * 3 + 2] = cT.b;
          sSize[m] = p.size * (0.9 + (1 - kk) * 1.9) * SC * 2.2; sAlpha[m] = Math.min(1, kk * 2.2) * 0.34;
        }
        trailPrev.set(p.color, p); sCol[n * 3] = cT.r; sCol[n * 3 + 1] = cT.g; sCol[n * 3 + 2] = cT.b; n += 1 + extra; continue;
      }
      trailPrev.set(p.color, p);
    } else if (p.max === 18 && p.vy >= 1 && (p.color === '#ffd45c' || p.color === '#ff4fd8')) {
      // Game.trail (rising specials): small hot motes, not big flat dots
      cT.lerp(SMOKE_WHITE, 0.25 * k);
      sSize[n] = p.size * (0.55 + k * 0.25) * SC * 2.2; sAlpha[n] = Math.min(1, k * 1.8) * 0.9;
    } else { sSize[n] = p.size * (2.6 - k * 1.4) * SC * 2.2; sAlpha[n] = Math.min(1, k * 1.6) * 0.8; }
    sCol[n * 3] = cT.r; sCol[n * 3 + 1] = cT.g; sCol[n * 3 + 2] = cT.b; n++;
  }
  for (let i = n; i < MAXS; i++) sSize[i] = 0;
  const g = smoke.geometry; for (const a of ['position', 'color', 'size', 'alpha']) g.attributes[a].needsUpdate = true;
  g.setDrawRange(0, n); smoke.material.uniforms.scale.value = scale;
}

// ---- spark streaks: velocity-aligned glowing quads ----
const MAXK = 400;
let streaks;
function makeStreaks() {
  const geo = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: false });
  streaks = new THREE.InstancedMesh(geo, m, MAXK); streaks.frustumCulled = false; streaks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXK * 3), 3);
  V3.scene.add(streaks);
}
const mtx = new THREE.Matrix4(), qz = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
function syncStreaks() {
  let n = 0;
  for (const p of Game.parts) {
    if (!p.streak || n >= MAXK) continue;
    const k = p.life / p.max, sp = Math.hypot(p.vx, p.vy) || 1;
    pv.set(p.x * SC, -p.y * SC, 0.4); qz.setFromAxisAngle(zAxis, Math.atan2(-p.vy, p.vx));
    sv.set(Math.max(0.05, sp * 3.2 * SC), p.size * 0.9 * k * SC, 1);
    mtx.compose(pv, qz, sv); streaks.setMatrixAt(n, mtx);
    cT.set(p.color).multiplyScalar(1.6 * k); streaks.setColorAt(n, cT); n++;
  }
  streaks.count = n; streaks.instanceMatrix.needsUpdate = true; if (streaks.instanceColor) streaks.instanceColor.needsUpdate = true;
}

// ---- impact starbursts ----
function starTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.translate(128, 128);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 90); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,240,200,.8)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 90, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.95)';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + Math.random() * 0.2, L = i % 2 ? 90 + Math.random() * 30 : 124; g.beginPath(); g.moveTo(Math.cos(a - 0.06) * 12, Math.sin(a - 0.06) * 12); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.lineTo(Math.cos(a + 0.06) * 12, Math.sin(a + 0.06) * 12); g.fill(); }
  return new THREE.CanvasTexture(c);
}
// A slash: the hit's direction, drawn as one hot tapered streak through the contact point (Smash puts a
// directional flare on every hit; the round star alone said "something happened here", not "which way").
function slashTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 512, 0);
  gr.addColorStop(0, 'rgba(255,200,120,0)'); gr.addColorStop(0.35, 'rgba(255,230,180,.55)'); gr.addColorStop(0.62, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, 32); g.quadraticCurveTo(300, 4, 512, 32); g.quadraticCurveTo(300, 60, 0, 32); g.fill();
  return new THREE.CanvasTexture(c);
}
// Pooled: every hit used to build a new mesh + material and dispose it 12 frames later (audit C9).
let starT, slashT, bursts = [];
const BURST_POOL = [];
function burstMesh(tex) {
  let m = BURST_POOL.find(b => !b.visible && b.userData.tex === tex);
  if (!m) {
    m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.userData = { tex, t: 0 }; m.renderOrder = 8; V3.scene.add(m); BURST_POOL.push(m);
  }
  m.visible = true; m.rotation.set(0, 0, 0); return m;
}
function burstAt(x, y, size, color) {
  if (!starT) starT = starTex();
  const m = burstMesh(starT);
  m.material.color.set(color).multiplyScalar(1.1);
  m.position.set(x * SC, -y * SC, 0.6); m.rotation.z = Math.random() * 6.28; Object.assign(m.userData, { t: 0, size, life: 12, slash: false }); bursts.push(m);
}
function slashAt(x, y, dx, dy, len, color) {
  if (!slashT) slashT = slashTex();
  const m = burstMesh(slashT);
  m.material.color.set(color).multiplyScalar(1.25);
  // centred a little behind the contact, pointing the way the victim is thrown
  m.position.set((x - dx * len * 18) * SC, -(y - dy * len * 18) * SC, 0.62); m.rotation.z = Math.atan2(-dy, dx);
  Object.assign(m.userData, { t: 0, size: len, life: 9, slash: true }); bursts.push(m);
}
function syncBursts() {
  for (const b of bursts) {
    const u = b.userData; u.t++; const k = u.t / u.life;
    if (u.slash) { b.scale.set(u.size * (0.55 + k * 0.9), u.size * 0.16 * (1 - k * 0.6), 1); b.material.opacity = Math.max(0, 1 - k * k); }
    else { b.scale.setScalar(u.size * (0.4 + k * 0.85)); b.material.opacity = Math.max(0, 1 - k) * 0.62; }
  }
  bursts = bursts.filter(b => { if (b.userData.t >= b.userData.life) { b.visible = false; return false; } return true; });
}

// ---- contact points: where the hit actually landed ----
// The burst used to sit on the victim's middle wherever the fist was. Now it sits where the live hitbox
// meets the victim's body, so the flash is on the fist, and a slash shows the launch direction. Page-only
// read of the sim (activeHits is pure, the velocities are already set when onHit runs); writes nothing.
const contact = new WeakMap();   // victim -> { x, y, dx, dy, kb, fr }
{
  const onHit0 = Game.onHit;
  Game.onHit = function (v, att, hb, d, kb) {
    const r = onHit0.apply(this, arguments);
    try {
      let cx = v.x, cy = v.y - v.h * 0.55, dx = att && att !== v ? (v.x >= att.x ? 1 : -1) : 1, dy = 0;
      const hs = att && att !== v && hb && att.activeHits ? att.activeHits() : [];
      const h = hs.find(q => q.hb === hb) || null;
      if (h) {
        const x0 = v.x - v.w * 0.4, x1 = v.x + v.w * 0.4, y0 = v.y - v.h, y1 = v.y;
        const bx = Math.min(x1, Math.max(x0, h.x)), by = Math.min(y1, Math.max(y0, h.y));
        cx = bx * 0.7 + h.x * 0.3; cy = by * 0.7 + h.y * 0.3;
      }
      const L = Math.hypot(v.vx, v.vy); if (L > 0.5) { dx = v.vx / L; dy = v.vy / L; }
      // Smash drives its whole impact language off ONE per-hitbox element enum (70 of them, mapping to
      // ~28 spark families in three size tiers, each with its own sound). We had one cream spark for
      // everything, so a 2 % jab and a 25 % smash looked identical apart from scale. Element is worked
      // out here, at contact, while the move and the hitbox are still in hand.
      const def = att && att.move && (att.move.def.base || att.move.def);
      const weapon = (att && att.move && att.move.def && att.move.def.weapon) || (hb && hb.weapon) || null;
      let el = 'normal';
      if (weapon) el = 'cut';
      else if (hb && hb.elec) el = 'elec';
      else if (hb && (hb.fire || (def && def.fire))) el = 'fire';
      else if (d >= 15) el = 'heavy';
      contact.set(v, { x: cx, y: cy, dx, dy, kb: kb || 0, fr: Game.frame, col: att && att.color, el, weapon, d });
    } catch (e) { V3.fxErr(e, '93_v3_fx:275'); /* cosmetic */ }
    return r;
  };
}

// The spark vocabulary. `core` is the burst colour per damage tier (S / M / L), `hot` the colour the
// slash and the heavy-tier ring take. A weapon overrides the colour with its own (the Beam Sword's
// red, the Hero Sword's blue) so you can see WHICH weapon just hit you.
const HIT_FX = {
  normal: { core: ['#ffffff', '#fff2c0', '#ffd98a'], hot: '#ffd27a', burst: 1,    slash: 1,    ring: false },
  heavy:  { core: ['#ffd98a', '#ffc46a', '#ffab4a'], hot: '#ff9a3a', burst: 1.08, slash: 1.15, ring: true, slashKb: 25 },
  cut:    { core: ['#eaf6ff', '#dff0ff', '#cfe8ff'], hot: '#bfe4ff', burst: 0.82, slash: 1.35, ring: false, slashKb: 0 },
  elec:   { core: ['#cfe6ff', '#9fd0ff', '#6ab8ff'], hot: '#6ab8ff', burst: 1.1,  slash: 0.9,  ring: true, slashKb: 30 },
  fire:   { core: ['#ffd9a0', '#ffb060', '#ff8a3a'], hot: '#ff7a2a', burst: 1.1,  slash: 1.05, ring: true, slashKb: 30 },
};

// ---- damage pops: "+14%" and "CRITICAL!!" ----
let pops = [];
// Pooled (audit #18): every "+N%" used to build a new 1024x180 canvas + texture + material + mesh and dispose
// it ~1 s later: GC churn and a GPU allocation in the middle of a fight. Now 8 slots are reused, each with
// its own half-size canvas that is redrawn in place.
const POP_POOL = [];
function popSlot() {
  let p = POP_POOL.find(q => !q.visible);
  if (!p && POP_POOL.length >= 8) p = POP_POOL.reduce((a, b) => (a.userData.t > b.userData.t ? a : b));   // recycle the oldest
  if (!p) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 90;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.42), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    p.renderOrder = 20; p.userData = { c, t: 0 }; V3.scene.add(p); POP_POOL.push(p);
  }
  return p;
}
function popText(x, y, text, color, big) {
  const m = popSlot(), c = m.userData.c, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = `italic 900 ${big ? 52 : 46}px Bungee, Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = 'rgba(40,10,0,.95)'; g.strokeText(text, 256, 47);
  const gr = g.createLinearGradient(0, 15, 0, 75); gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.5, color); gr.addColorStop(1, '#ff4a1a'); g.fillStyle = gr; g.fillText(text, 256, 47);
  m.material.map.needsUpdate = true; m.material.opacity = 1;
  m.position.set(x * SC + (Math.random() - 0.5) * 0.3, -y * SC, 1.2); m.visible = true;
  Object.assign(m.userData, { t: 0, big });
  if (!pops.includes(m)) pops.push(m);
}
function syncPops() {
  for (const p of pops) {
    const u = p.userData; u.t++;
    const pop = u.t < 6 ? 0.6 + u.t / 6 * 0.7 : u.t < 10 ? 1.3 - (u.t - 6) * 0.075 : 1;
    p.scale.setScalar(pop * (u.big ? 0.95 : 0.62)); p.position.y += 0.006; p.material.opacity = u.t > 40 ? Math.max(0, 1 - (u.t - 40) / 14) : 1;
    p.quaternion.copy(V3.camera.quaternion);
  }
  pops = pops.filter(p => { if (p.userData.t > 54) { p.visible = false; return false; } return true; });
}
// damage is summed per fighter and shown once the combo pauses, so rapid hits make one number, not a pile
const lastDmg = new WeakMap(), pend = new WeakMap();
let lastImpact = null, critT = 0;
function watchHits() {
  for (const f of Game.fighters) {
    const prev = lastDmg.get(f);
    let P = pend.get(f); if (!P) { P = { sum: 0, quiet: 0 }; pend.set(f, P); }
    if (prev != null && f.dmg > prev + 0.5 && f.state !== 'dead') {
      const d = f.dmg - prev, C = contact.get(f);
      if (C && Game.frame - C.fr <= 2) {
        // one spark family per element, three size tiers by damage (Smash's S / M / L)
        const E = HIT_FX[C.el] || HIT_FX.normal;
        const tier = d >= 15 ? 2 : d >= 6 ? 1 : 0;
        burstAt(C.x, C.y, (0.3 + Math.min(0.5, d / 22)) * E.burst, C.weapon || E.core[tier]);
        // a blade draws its crescent from the first frame; fists need real knockback behind them
        if (C.kb > (E.slashKb || 40)) slashAt(C.x, C.y, C.dx, C.dy, (0.7 + Math.min(1.6, C.kb / 110)) * E.slash, C.weapon || (C.kb > 140 ? E.hot : E.core[tier]));
        // the heavy tier gets the extra beat: a flat shock ring on the contact point
        if (tier === 2 && E.ring) { try { Game.ring(C.x, C.y, E.hot, 60 + Math.min(70, d * 3)); } catch (e2) {} }
      } else burstAt(f.x, f.y - f.h * 0.55, 0.38 + Math.min(0.62, d / 20), '#fff2c0');
      P.sum += d; P.quiet = 0;
    } else if (P.sum > 0 && ++P.quiet > 14) {
      if (P.sum >= 4) popText(f.x, f.y - f.h * 1.4, '+' + Math.round(P.sum) + '%', '#ffb020', false);
      P.sum = 0;
    }
    lastDmg.set(f, f.dmg);
  }
  const im = Game.impact;
  if (critT > 0) critT--;
  if (im && im !== lastImpact) {
    burstAt(im.x, im.y, 2.2, '#ffe6a0');
    // no "CRITICAL!!" pop: it fired on almost every strong hit and buried the fight in text (audit 9/22).
    // Smash marks a strong hit with a short flash and speed lines only; the finish has its own cinematic (99).
  }
  lastImpact = im;
}

// ---- super takeover: anime speed-line backdrop during Final Smash and huge hits ----
let superPlane, superK = 0;
function superTex() {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d'); g.translate(512, 512);
  const bg = g.createRadialGradient(0, 0, 60, 0, 0, 720); bg.addColorStop(0, '#fff2a8'); bg.addColorStop(0.35, '#ffb22a'); bg.addColorStop(0.75, '#e0301e'); bg.addColorStop(1, '#6a0a14');
  g.fillStyle = bg; g.fillRect(-512, -512, 1024, 1024);
  for (let i = 0; i < 180; i++) { const a = Math.random() * 6.283, w = 0.004 + Math.random() * 0.018, r0 = 80 + Math.random() * 200; g.fillStyle = Math.random() < 0.6 ? 'rgba(255,255,255,.75)' : 'rgba(255,230,120,.6)'; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a - w) * 760, Math.sin(a - w) * 760); g.lineTo(Math.cos(a + w) * 760, Math.sin(a + w) * 760); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function syncSuper() {
  // Final Smash only. It also fired on every hit with knockback over 150 (slowT > 6 && impact) and covered
  // the whole stage with orange speed lines several times a match (audit 9/22, evidence 01/12/18).
  const f = Game.finalBy, on = !!(f && f.state === 'final' && f.st < 120);
  superK += ((on ? 1 : 0) - superK) * (on ? 0.25 : 0.12);
  if (superK < 0.01) { if (superPlane) superPlane.visible = false; return; }
  if (!superPlane) {
    superPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: superTex(), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    superPlane.renderOrder = -5; V3.scene.add(superPlane);
  }
  const cam = V3.camera, d = cam.position.z + 3, h = 2 * d * Math.tan(cam.fov * Math.PI / 360) * 1.3;
  superPlane.visible = true; superPlane.material.opacity = superK * 0.94;
  superPlane.position.set(cam.position.x, cam.position.y - 0.3, -3); superPlane.scale.set(h * cam.aspect, h, 1);
  superPlane.rotation.z += 0.01;
}

// ---- frame hook ----
V3.fxFrame = function (pointScale) {
  if (FX.grade) FX.grade.uniforms.t.value = (Game.frame || 0) * 0.017 % 100;   // grain walks per frame
  if (!smoke) { makeSmoke(); makeStreaks(); }
  syncSmoke(pointScale); syncStreaks(); watchHits(); syncBursts(); syncPops(); syncSuper();
  if (FX.grade) FX.grade.uniforms.flash.value = 0;   // the 2D overlay already flashes the screen
};

V3.boot();
