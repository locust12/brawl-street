// ===== Your fighter: build, name and save one custom fighter (look only, never gameplay) =====
// The body is any roster fighter, whose moves and stats stay exactly the same. The look adds a recolour, a finish
// and procedural gear (hat, eyes, neck, aura) attached to the shared 24-bone rig. 91_v3_render calls
// CustomLook.apply(id, root, THREE, f) for every avatar. A slot opts in with slot.custom (this device's saved
// look) or slot.customLook (a look object, e.g. an online opponent's). Never touches fight state or rand().
(function () {
  const $c = id => document.getElementById(id);
  const sfx = () => { try { Sfx.ui(); } catch (e) { /* audio locked */ } };
  const KEY = 'customLook';
  const TINTS = [['orig', 'Original', null], ['crimson', 'Crimson', '#ff3048'], ['ember', 'Ember', '#ff7a2a'], ['gold', 'Gold', '#ffc83d'],
    ['toxic', 'Toxic', '#8dff3a'], ['cyan', 'Cyan', '#27e1ff'], ['cobalt', 'Cobalt', '#3a6bff'], ['violet', 'Violet', '#9b5cff'],
    ['pink', 'Pink', '#ff4fd8'], ['shadow', 'Shadow', '#5a5070'], ['ghost', 'Ghost', '#dfe9ff']];
  const FINISH = [['orig', 'Original'], ['matte', 'Matte'], ['gloss', 'Gloss'], ['chrome', 'Chrome'], ['gold', 'Gold plated']];
  // HATS and HAIR are deliberately empty. 9/21: Duane, on hats for the fifth time — "all the caps are
  // fucking fucked. just remove caps cus i asked you 5 times already and it just keeps getting worse" —
  // and on hair — "dreads and hair are disproportionate just remove them".
  //
  // Nothing is commented out or hidden behind a flag: the entries are gone from the list, which is the only
  // thing that makes them unpickable AND retires them from an existing save. `sanitize()` walks GROUPS and
  // falls any value it no longer recognises back to DEF, so a fighter saved with `hat:'cap'` loads as
  // `hat:'none'`, renders with no hat and is re-saved that way. No throw, no missing-mesh gap.
  //
  // The mesh builders in buildHat/buildHair are left where they are. They are unreachable while these lists
  // are empty, and if a piece is ever brought back it has to be re-added here deliberately, with the
  // per-fighter measurement to back it up. The bar he set: a few pieces that sit perfectly beats a lot that
  // look wrong.
  const HATS = [['none', 'None']];
  const EYES = [['none', 'None'], ['rayban', 'Thick rims'], ['aviator', 'Aviators'], ['mafia', 'Mafia shades'],
    // Shutter shades removed 9/21 as well: it survived the first cut by accident (the edit only replaced the
    // second line of this list) and the proof run caught it floating on cheems, trump, bling and moodeng.
    // Monocle removed the same day: floating off KAIJU's face by 0.423 head-heights.
    // Same rule as the hats — a piece that cannot be shown to sit right on every fighter does not ship.
    ['goggles', 'Ski goggles'], ['shades', 'Pixel shades']];
  // Trimmed 9/21 from ten styles to five, on measurement, not taste. `SLOTS=eyes dev/gearcheck.mjs` over the
  // whole roster scored 417/460 with only 24 of 46 fighters clean: `laser` floated on ten bodies, `visor` on
  // eight, `shutter` on six, `monocle` on four and `round` on three. The five left are 44/46 each, and the
  // only two they miss are the bodies below. He has asked for glasses on the eyes more than once and been
  // given floating ones each time, so the rule is the same as the hats: it ships when it is measured.
  //
  // OMEN and FARTCOIN fail every style (omen 0/10, fartcoin 1/10): the face measurement finds no usable eye
  // frame on those two heads, so there is nowhere correct to put a pair. They render with no glasses rather
  // than with a floating pair. Re-measure before ever taking a body off this list.
  const EYES_UNFIT = ['omen', 'fartcoin'];
  const HAIR = [['none', 'None']];
  const HAIRCOL = [['black', 'Black', '#140f16'], ['darkbrown', 'Dark brown', '#2e1b10'], ['brown', 'Brown', '#57331b'], ['auburn', 'Auburn', '#7a3418'],
    ['ginger', 'Ginger', '#c4521c'], ['blonde', 'Blonde', '#e3b75e'], ['platinum', 'Platinum', '#ece6d6'], ['grey', 'Grey', '#9aa0ad'],
    ['white', 'White', '#e6e8f0'], ['red', 'Red', '#d8203c'], ['pink', 'Pink', '#ff4fd8'], ['violet', 'Violet', '#9b5cff'],
    ['cyan', 'Cyan', '#27e1ff'], ['lime', 'Lime', '#8dff3a'], ['gold', 'Gold', '#ffc83d'], ['blue', 'Blue', '#3a6bff']];
  // hats get their own swatch row; 'auto' keeps each hat's signature colour
  const HATCOL = [['auto', 'Default', null], ['black', 'Black', '#15151b'], ['white', 'White', '#eef0f6'], ['red', 'Red', '#d8203c'],
    ['orange', 'Orange', '#ff7a2a'], ['gold', 'Gold', '#ffc83d'], ['lime', 'Lime', '#8dff3a'], ['green', 'Green', '#1f8f4e'],
    ['cyan', 'Cyan', '#27e1ff'], ['blue', 'Blue', '#2a5cff'], ['violet', 'Violet', '#9b5cff'], ['pink', 'Pink', '#ff4fd8'],
    ['brown', 'Brown', '#6b4526'], ['grey', 'Grey', '#8b93a3']];
  // skin / fur tone: recolours only the skin-coloured texels, so clothes, eyes and logos keep their colour
  const SKIN = [['orig', 'Original', null], ['deep', 'Deep', '#3a2318'], ['ebony', 'Ebony', '#4e3122'], ['brown', 'Brown', '#7a4c2e'],
    ['tan', 'Tan', '#a9714a'], ['olive', 'Olive', '#c08f5e'], ['light', 'Light', '#e0b088'], ['fair', 'Fair', '#f0cfb0'],
    ['grey', 'Stone', '#8b93a3'], ['green', 'Green', '#5fa04a'], ['blue', 'Blue', '#4f7fd8']];
  // 'scarf' REMOVED, 9/28. It was a flat slab that read as a necktie; reshaped into a band and a
  // knot, it then rode up onto doge's muzzle as a thick red sausage. Two attempts, still wrong on the
  // first body I checked, while none/gold/ice/bowtie are good on every body I rendered. Duane's call,
  // stated plainly: "id rather u leave out what looks shit before we ship to newgrounds then keeping
  // something that lowers the value of our product." The builder branch stays, so re-adding it later
  // is one word in this list.
  const NECK = [['none', 'None'], ['gold', 'Gold chain'], ['ice', 'Diamond chain'], ['bowtie', 'Bow tie']];
  const SHOES = [['none', 'None'], ['sneak', 'Sneakers'], ['boots', 'Boots'], ['sandal', 'Sandals'], ['kicks', 'Gold kicks']];
  // ---- MATERIALS, 9/26 --------------------------------------------------------------------------
  // Duane: "can u also step up the character edit section. thats always been the WEAKEST worst quality
  // complete bullshit from the game every time... like check other games and copy what they do."
  //
  // He is right, and the reason it is weak is written into this file's own history: hats and hair were
  // both pulled because procedural gear cannot be made to sit correctly on 46 different heads, so what
  // was left is a recolour and four small accessories. Two custom fighters still read as the same
  // fighter.
  //
  // What other games actually do for this is not more hats. Rocket League decals, Call of Duty camos,
  // Forza liveries, FIFA kits, Fortnite styles -- the thing that makes a character read as YOURS is the
  // MATERIAL, and every one of those is painted in texture space. That matters here for a specific
  // reason: a pattern lives in UV space, on the skin the artist already fitted, so it cannot float,
  // cannot clip, cannot be the wrong size on KAIJU and right on SPARK. It is the one kind of
  // customisation this rig can carry perfectly on all 46 bodies.
  //
  // Each pattern is a small GLSL snippet generated for the chosen kind only (no uber-shader branch) and
  // injected at <map_fragment> exactly like the tint above, so it keeps the texel's own lighting and
  // composes with the tint and the skin tone. Carbon and the tech patterns also drive roughness and
  // metalness, because a woven carbon panel that is as matte as fur does not read as carbon.
  const PATTERN = [['none', 'None'], ['carbon', 'Carbon fibre'], ['hex', 'Hex tech'], ['circuit', 'Circuit'],
    ['camo', 'Camo'], ['digi', 'Digital camo'], ['tiger', 'Tiger'], ['scale', 'Scales'],
    ['stripe', 'Racing stripes'], ['dots', 'Halftone'], ['grid', 'Wireframe grid'], ['splat', 'Splatter']];
  // 'auto' keeps each pattern's own signature colour, so one tap gives a look that already works
  const PATCOL = [['auto', 'Default', null], ['black', 'Black', '#14141a'], ['white', 'White', '#eef0f6'],
    ['steel', 'Steel', '#8b93a3'], ['red', 'Red', '#d8203c'], ['orange', 'Orange', '#ff7a2a'],
    ['gold', 'Gold', '#ffc83d'], ['lime', 'Lime', '#8dff3a'], ['green', 'Green', '#1f8f4e'],
    ['cyan', 'Cyan', '#27e1ff'], ['blue', 'Blue', '#2a5cff'], ['violet', 'Violet', '#9b5cff'],
    ['pink', 'Pink', '#ff4fd8'], ['sand', 'Sand', '#c8b487']];
  // the colour each pattern picks when PATCOL is 'auto'
  // Brighter than the first pass on purpose. A near-black pattern colour multiplied by a shading term
  // that only moves +/-25 % is crushed to a flat wash by ACES tone mapping -- looked at on DOGE, carbon,
  // hex, circuit, camo, digi and scale all came out as "the dog, but muddier". The weave has to be
  // readable at the size a fighter is actually drawn, which means a mid-tone base and real contrast.
  const PAT_AUTO = { carbon: '#3a3e47', hex: '#4a5c74', circuit: '#1d5c46', camo: '#6f7a54', digi: '#5d6a7e',
    tiger: '#1a1510', scale: '#54798f', stripe: '#eef0f6', dots: '#14141a', grid: '#27e1ff', splat: '#d8203c' };
  // patterns that should also look like a hard surface rather than fur
  const PAT_MAT = { carbon: [0.26, 0.55], hex: [0.32, 0.65], circuit: [0.38, 0.5], grid: [0.3, 0.4], scale: [0.35, 0.3] };
  // how strongly the pattern takes over the body. Tiger and camo are markings, carbon is a shell.
  // `stripe` was 0.85 of a near-white (#eef0f6) over the whole body, which turned doge from orange to
  // WHITE with pale grey stripes -- it erased the character instead of marking it. Racing stripes are
  // an accent, so it sits with dots and grid at 0.5 and the fighter's own colour shows between them.
  // `digi` at 0.9 of a grey-blue washed the whole fighter out the same way; 0.72 keeps the pattern
  // readable while leaving the body underneath recognisable.
  const PAT_AMT = { carbon: 0.92, hex: 0.82, circuit: 0.88, camo: 0.86, digi: 0.72, tiger: 0.72,
    scale: 0.82, stripe: 0.5, dots: 0.6, grid: 0.6, splat: 0.7 };

  const AURA = [['none', 'None'], ['flame', 'Super flame'], ['fire', 'Fire'], ['volt', 'Electric'], ['frost', 'Frost'], ['void', 'Void'], ['holy', 'Holy'], ['cash', 'Cash']];
  const AURA_COL = { fire: '#ff6a1a', volt: '#27e1ff', cash: '#3dff8a', void: '#9b5cff' };
  // ---- presets ------------------------------------------------------------------------------------
  // The other half of what good creators do: a row of finished looks, one tap each. "Randomise" gives
  // chaos -- eleven controls rolled independently almost never land on something that looks designed --
  // so the first thing a player sees is twelve looks that already work, and the controls become the
  // place they go to adjust one instead of the place they have to start from nothing.
  // The body is deliberately NOT part of a preset: the preset is the look, the body stays whoever they
  // picked, so every one of these works on all 46.
  const PRESETS = [
    ['carbon',  'Carbon',      { pattern: 'carbon', patcol: 'auto',   finish: 'gloss',  tint: 'shadow', neck: 'none',  eyes: 'shades',  aura: 'none' }],
    ['neon',    'Neon Wolf',   { pattern: 'hex',    patcol: 'cyan',   finish: 'gloss',  tint: 'cobalt', neck: 'none',  eyes: 'goggles', aura: 'volt' }],
    ['gold',    'Gold Standard', { pattern: 'none', patcol: 'auto',   finish: 'gold',   tint: 'gold',   neck: 'ice',   eyes: 'aviator', aura: 'holy' }],
    ['ronin',   'Street Ronin', { pattern: 'scale', patcol: 'red',    finish: 'matte',  tint: 'crimson',neck: 'none',  eyes: 'none',    aura: 'flame' }],
    ['ghostop', 'Ghost Op',    { pattern: 'digi',   patcol: 'steel',  finish: 'matte',  tint: 'ghost',  neck: 'none',  eyes: 'goggles', aura: 'frost' }],
    ['jungle',  'Jungle',      { pattern: 'camo',   patcol: 'green',  finish: 'matte',  tint: 'orig',   neck: 'none',  eyes: 'rayban',  aura: 'none' }],
    ['circuit', 'Mainframe',   { pattern: 'circuit',patcol: 'lime',   finish: 'gloss',  tint: 'shadow', neck: 'none',  eyes: 'shades',  aura: 'volt' }],
    ['tiger',   'Tiger',       { pattern: 'tiger',  patcol: 'auto',   finish: 'orig',   tint: 'ember',  neck: 'gold',  eyes: 'none',    aura: 'fire' }],
    ['chrome',  'Chrome',      { pattern: 'grid',   patcol: 'white',  finish: 'chrome', tint: 'orig',   neck: 'none',  eyes: 'mafia',   aura: 'none' }],
    ['racer',   'Racer',       { pattern: 'stripe', patcol: 'white',  finish: 'gloss',  tint: 'crimson',neck: 'none',  eyes: 'aviator', aura: 'none' }],
    ['ink',     'Ink',         { pattern: 'dots',   patcol: 'black',  finish: 'matte',  tint: 'ghost',  neck: 'bowtie',eyes: 'shades',  aura: 'none' }],
    ['void',    'Void',        { pattern: 'splat',  patcol: 'violet', finish: 'gloss',  tint: 'shadow', neck: 'none',  eyes: 'none',    aura: 'void' }],
  ];

  const TITLES = ['Street Legend', 'Diamond Hands', 'Degen', 'Whale Hunter', 'Rug Survivor', 'Chart Wizard', 'Bag Holder', 'Moon Walker'];
  const CSS_TINT = { crimson: 'sepia(1) saturate(5) hue-rotate(-45deg)', ember: 'sepia(1) saturate(4) hue-rotate(-15deg)', gold: 'sepia(1) saturate(3) hue-rotate(5deg)',
    toxic: 'sepia(1) saturate(4) hue-rotate(60deg)', cyan: 'sepia(1) saturate(4) hue-rotate(150deg)', cobalt: 'sepia(1) saturate(5) hue-rotate(185deg)',
    violet: 'sepia(1) saturate(4) hue-rotate(225deg)', pink: 'sepia(1) saturate(4) hue-rotate(275deg)', shadow: 'brightness(.45) saturate(.6)', ghost: 'grayscale(1) brightness(1.4)' };
  const GROUPS = [['tint', TINTS], ['skin', SKIN], ['finish', FINISH], ['pattern', PATTERN], ['patcol', PATCOL], ['hair', HAIR], ['haircol', HAIRCOL], ['hat', HATS], ['hatcol', HATCOL], ['eyes', EYES], ['neck', NECK], ['shoes', SHOES], ['aura', AURA]];
  const DEF = { v: 1, base: 'doge', tint: 'orig', skin: 'orig', finish: 'orig', pattern: 'none', patcol: 'auto', hair: 'none', haircol: 'black', hat: 'none', hatcol: 'auto', eyes: 'shades', neck: 'gold', shoes: 'none', aura: 'none', name: 'Rookie', title: 'Street Legend' };
  const cleanTxt = s => String(s || '').replace(/[^\w .\-]/g, '').replace(/\s+/g, ' ').trim();
  const cleanHandle = s => String(s == null ? '' : s).replace(/^\s*@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // sanitize MIGRATES, it never rejects: every field it recognises is kept and only the unknown ones fall back
  // to a default. Adding gear, renaming an option or bumping the version can never reset someone's fighter.
  function sanitize(lk) {
    const o = Object.assign({}, DEF, lk && typeof lk === 'object' ? lk : {});
    if (typeof CHAR_BY_ID === 'undefined' || !CHAR_BY_ID[o.base]) o.base = DEF.base;
    for (const [k, list] of GROUPS) if (!list.some(x => x[0] === o[k])) o[k] = DEF[k];
    o.name = cleanTxt(o.name).slice(0, 16) || DEF.name;
    o.title = cleanTxt(o.title).slice(0, 22);
    o.x = cleanHandle(o.x);
    o.v = 1;
    return { v: o.v, base: o.base, tint: o.tint, skin: o.skin, finish: o.finish, pattern: o.pattern, patcol: o.patcol, hair: o.hair, haircol: o.haircol, hat: o.hat, hatcol: o.hatcol, eyes: o.eyes, neck: o.neck, shoes: o.shoes, aura: o.aura, name: o.name, title: o.title, x: o.x };
  }

  // ---------------------------------------------------------------- keeping the fighter, whatever happens
  // A saved fighter is written to THREE places on every change (debounced): the normal store key, a raw
  // backup key, and a second backup under a fixed name. Nothing here ever writes defaults over a stored
  // look: if a read fails we fall back, and if every read fails we leave the slot empty rather than stamp
  // DEF over the top. Export / Import give a paste-able code so a wiped browser is still recoverable.
  const BAK_KEY = 'tb_customLook_bak', BAK2_KEY = 'tb_customLook_bak2';
  const rawGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const rawSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* quota or private mode */ } };
  function parseLook(s) { if (!s) return null; try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
  function loadSaved() {
    const tries = [store.get(KEY, null), parseLook(rawGet(BAK_KEY)), parseLook(rawGet(BAK2_KEY))];
    for (const t of tries) if (t) return sanitize(t);
    return null;
  }
  function backupExists() { return !!(parseLook(rawGet(BAK_KEY)) || parseLook(rawGet(BAK2_KEY))); }
  function writeSaved(lk) {
    const s = JSON.stringify(lk);
    store.set(KEY, lk); rawSet(BAK_KEY, s); rawSet(BAK2_KEY, s);
  }
  const b64 = {
    enc(o) { try { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, ''); } catch (e) { return ''; } },
    dec(s) { try { return JSON.parse(decodeURIComponent(escape(atob(String(s).trim().replace(/\s+/g, ''))))); } catch (e) { return null; } },
  };
  let saved = loadSaved();
  // A portrait of the player's own fighter, rendered from the live 3D preview whenever the look is saved.
  // Kept out of the look blob (which travels to online opponents) and out of `store` (dataURLs are big).
  const SHOT_KEY = 'tb_customShot';
  let shot = null, shotImg = null;
  try { shot = localStorage.getItem(SHOT_KEY) || null; } catch (e) { shot = null; }
  function setShot(url) {
    shot = url || null;
    try { if (shot) localStorage.setItem(SHOT_KEY, shot); else localStorage.removeItem(SHOT_KEY); } catch (e) { /* quota or private mode: the picture is optional */ }
    if (shot) { shotImg = new Image(); shotImg.src = shot; } else shotImg = null;
  }
  if (shot) { shotImg = new Image(); shotImg.src = shot; }

  // ---------------------------------------------------------------- 3D look
  // Avatar.update rewrites emissive / opacity on every material each frame (hit flash, invulnerability),
  // so glowing and see-through gear puts its own values back right before it is drawn.
  function keep(mesh, want) {
    mesh.userData.cfWant = want;
    mesh.onBeforeRender = function () {
      const m = this.material, w = this.userData.cfWant;
      if (w.emissive && m.emissive) { m.emissive.copy(w.emissive); m.emissiveIntensity = w.ei; }
      if (w.opacity != null) { m.opacity = w.opacity; m.transparent = true; }
      if (w.depthWrite != null) m.depthWrite = w.depthWrite;
      if (w.tick) w.tick(m, performance.now() / 1000, this);
    };
  }
  // Tinting used to flatten the art: every texel became luminance x tint, so the highlights clipped to white
  // and all the painted detail (eyes, logos, fur bands) washed out. Now the texel keeps its own brightness AND
  // a share of its own hue; only the overall colour cast moves to the tint.
  function recolor(m, color, amt, keepChroma) {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uCfTint = { value: color }; sh.uniforms.uCfAmt = { value: amt }; sh.uniforms.uCfKeep = { value: keepChroma == null ? 0.42 : keepChroma };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCfTint; uniform float uCfAmt; uniform float uCfKeep;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float cfL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 cfChroma = clamp(diffuseColor.rgb / max(cfL, 0.004), 0.0, 2.0);   // the texel's own colour, brightness removed
  vec3 cfBase = uCfTint * (0.14 + 1.28 * cfL);                            // the tint, shaded by the texel's brightness
  vec3 cfOut = mix(cfBase, cfBase * cfChroma, uCfKeep);                   // put some of the art's own colour back
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(cfOut, 0.0, 1.6), uCfAmt);
}`);
    };
    m.customProgramCacheKey = () => prevKey + '|cftint';
    m.needsUpdate = true;
  }
  // ---- the pattern shader ------------------------------------------------------------------------
  // One snippet per pattern, generated for the chosen kind only, so a fighter wearing carbon compiles
  // the carbon maths and nothing else. Every snippet sets three values and nothing more:
  //   pm  0..1  where the pattern colour goes (coverage)
  //   ps  ~0.6..1.3  a shading multiplier, so a weave or a scale edge catches the light
  //   pg  0..1  an edge/glow term, used for emissive on the tech patterns
  // Everything runs in vMapUv, the same UVs the artist painted on, so the pattern is the right size on
  // every body automatically -- which is the whole reason this works where hats did not.
  const PAT_NOISE = `
float cfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float cfNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cfHash(i), cfHash(i + vec2(1.0, 0.0)), f.x),
             mix(cfHash(i + vec2(0.0, 1.0)), cfHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float cfFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * cfNoise(p); p *= 2.03; a *= 0.5; } return v; }
float cfHex(vec2 p){ p = abs(p); return max(p.x * 0.866 + p.y * 0.5, p.y); }`;

  // WHY THESE ARE PROJECTED, NOT UV-MAPPED. The first cut of this read the patterns straight off
  // vMapUv and it was wrong on the model: a UV atlas is cut into islands and each island is rotated
  // and scaled however the unwrap wanted, so "stripes" came out as short streaks running in a
  // different direction on the arm, the leg and the gi, and the hex lattice broke at every seam.
  // Looked at on DOGE, tiger read as orange noise.
  //
  // So anything with a direction or a lattice is projected TRIPLANAR in the model's own object space
  // (bind pose, before skinning), which fixes all of it at once:
  //   - stripes run around the body, scales flow down it, the weave keeps one direction
  //   - the lattice crosses UV seams without breaking
  //   - it is the bind pose, so the pattern stays painted ON the fighter as he animates instead of
  //     swimming across him
  //   - divided by the model's own height, so one setting is the same size on WISP and on KAIJU
  // The three noise patterns (camo, digital, splatter) stay in UV space: noise is noise in any
  // projection, and UV costs one evaluation instead of three.
  const PAT_SRC = {
    // a 2x2 twill: alternating cells whose threads run at right angles, each thread rounded so it
    // catches a highlight down its middle, with a dark gap between the tows
    carbon: { tri: 1, scale: 30.0, src: `vec2 q = uv; vec2 ci = floor(q), cf = fract(q);
      float dir = mod(ci.x + ci.y, 2.0);
      float w = dir > 0.5 ? cf.x : cf.y;
      float thread = 0.46 + 1.16 * sin(w * 3.14159);
      float gap = smoothstep(0.0, 0.12, min(min(cf.x, cf.y), min(1.0 - cf.x, 1.0 - cf.y)));
      pm = 1.0; ps = mix(0.30, thread, gap); pg = 0.0;` },
    // hex cells with a bright rim
    hex: { tri: 1, scale: 12.0, src: `vec2 q = uv; q.x *= 1.1547;
      vec2 a = mod(q, vec2(1.0, 1.7320)) - vec2(0.5, 0.8660);
      vec2 b = mod(q + vec2(0.5, 0.8660), vec2(1.0, 1.7320)) - vec2(0.5, 0.8660);
      float d = cfHex(dot(a, a) < dot(b, b) ? a : b);
      float rim = smoothstep(0.39, 0.49, d);
      pm = 1.0; ps = mix(0.58, 1.62, rim); pg = rim;` },
    // PCB: traces on a grid that stop at random, with solder pads on the junctions
    circuit: { tri: 1, scale: 13.0, src: `vec2 q = uv; vec2 ci = floor(q), cf = fract(q);
      float r = cfHash(ci);
      float trace = max(smoothstep(0.105, 0.065, abs(cf.y - 0.5)) * step(0.5, r),
                        smoothstep(0.105, 0.065, abs(cf.x - 0.5)) * step(r, 0.5));
      float pad = smoothstep(0.19, 0.13, length(cf - 0.5)) * step(0.74, cfHash(ci + 7.3));
      float on = clamp(trace + pad, 0.0, 1.0);
      pm = 1.0; ps = mix(0.50, 1.80, on); pg = on;` },
    // three-band woodland: soft blobs, hard edges
    camo: { tri: 1, scale: 3.4, src: `vec2 q = uv;
      float n = cfFbm(q), n2 = cfFbm(q * 2.1 + 11.0);
      float band = step(0.46, n) + step(0.58, n2);
      pm = 1.0; ps = 0.52 + 0.44 * band; pg = 0.0;` },
    // the same idea quantised to a pixel grid
    digi: { tri: 1, scale: 26.0, src: `vec2 q = floor(uv) / 26.0;
      float n = cfFbm(q * 9.0), n2 = cfFbm(q * 18.0 + 4.0);
      float band = step(0.47, n) + step(0.57, n2);
      pm = 1.0; ps = 0.50 + 0.46 * band; pg = 0.0;` },
    // stripes that wander around the body, thin out at the ends, and cover only part of it
    tiger: { tri: 1, scale: 9.0, src: `float wob = cfFbm(uv * vec2(0.9, 2.6)) * 0.8;
      float st = sin(uv.x * 3.05 + wob * 5.0);
      float edge = smoothstep(0.42, 0.80, abs(st));
      float thin = smoothstep(0.18, 0.44, cfFbm(uv * 0.75 + 3.0));
      pm = edge * thin; ps = 1.0; pg = 0.0;` },
    // overlapping rounded scales, each lit along its lower edge, flowing down the body
    scale: { tri: 1, scale: 15.0, src: `vec2 q = uv * vec2(1.0, 0.78);
      float row = floor(q.y); q.x += mod(row, 2.0) * 0.5;
      vec2 cf = fract(q) - vec2(0.5, 0.25);
      float d = length(cf * vec2(1.0, 1.35));
      float body = smoothstep(0.52, 0.42, d);
      float lip = smoothstep(0.50, 0.44, d) - smoothstep(0.44, 0.34, d);
      pm = 1.0; ps = mix(0.44, 1.10, body) + lip * 0.72; pg = lip;` },
    // two stripes up the front and back centre line -- object space, so they actually run up the body
    stripe: { tri: 1, scale: 1.0, src: `float c = abs(uv.x);
      float s1 = smoothstep(0.075, 0.055, abs(c - 0.085));
      float s2 = smoothstep(0.075, 0.055, abs(c - 0.235));
      pm = clamp(s1 + s2, 0.0, 1.0); ps = 1.0; pg = 0.0;` },
    // halftone: dots that grow where the art is dark
    dots: { tri: 1, scale: 34.0, src: `vec2 cf = fract(uv) - 0.5;
      float rad = mix(0.12, 0.46, 1.0 - clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0));
      pm = smoothstep(rad, rad - 0.08, length(cf)); ps = 1.0; pg = 0.0;` },
    // a thin wireframe over the whole body
    grid: { tri: 1, scale: 20.0, src: `vec2 cf = abs(fract(uv) - 0.5);
      float line = smoothstep(0.44, 0.49, max(cf.x, cf.y));
      pm = line; ps = 1.0; pg = line;` },
    // paint thrown at it
    splat: { tri: 1, scale: 4.2, src: `float n = cfFbm(uv + 21.0);
      float n2 = cfFbm(uv * 2.4 + 5.0);
      pm = smoothstep(0.50, 0.58, n) * smoothstep(0.28, 0.50, n2); ps = 1.0; pg = 0.0;` },
  };

  // Injected at <map_fragment> like recolor/reskin. cfPatM is declared at file scope so the roughness
  // and emissive chunks further down the standard shader can read the coverage this computed -- three.js
  // runs map_fragment before roughnessmap_fragment and emissivemap_fragment, so the value is there.
  function patternize(m, kind, color, amt, rough, metal, glow, sizeK) {
    const P = PAT_SRC[kind]; if (!P) return;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    // one evaluation in UV space, or three blended by the object-space normal
    const evalBlock = P.tri ? `
  vec3 bn = normalize(abs(vCfNrm) + 1e-4); bn = bn * bn; bn = bn * bn; bn /= (bn.x + bn.y + bn.z);
  vec3 wp = vCfPos * uPatSize * ${P.scale.toFixed(2)};
  float pm = 0.0, ps = 0.0, pg = 0.0, tm, tsv, tg;
  { vec2 uv = wp.zy; float pm = 0.0, ps = 1.0, pg = 0.0; ${P.src} tm = pm; tsv = ps; tg = pg; }
  pm += tm * bn.x; ps += tsv * bn.x; pg += tg * bn.x;
  { vec2 uv = wp.xz; float pm = 0.0, ps = 1.0, pg = 0.0; ${P.src} tm = pm; tsv = ps; tg = pg; }
  pm += tm * bn.y; ps += tsv * bn.y; pg += tg * bn.y;
  { vec2 uv = wp.xy; float pm = 0.0, ps = 1.0, pg = 0.0; ${P.src} tm = pm; tsv = ps; tg = pg; }
  pm += tm * bn.z; ps += tsv * bn.z; pg += tg * bn.z;` : `
  vec2 uv = vMapUv * ${P.scale.toFixed(2)};
  float pm = 0.0, ps = 1.0, pg = 0.0;
  ${P.src}`;
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uPatCol = { value: color }; sh.uniforms.uPatAmt = { value: amt };
      sh.uniforms.uPatRough = { value: rough }; sh.uniforms.uPatMetal = { value: metal };
      sh.uniforms.uPatGlow = { value: glow }; sh.uniforms.uPatSize = { value: sizeK };
      if (P.tri) sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCfPos; varying vec3 vCfNrm;')
        // BIND POSE on purpose: `position` and `normal` before the skinning chunks, so the pattern is
        // painted on the fighter and moves with him instead of sliding over him as he animates.
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCfPos = position; vCfNrm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uPatCol; uniform float uPatAmt; uniform float uPatRough; uniform float uPatMetal; uniform float uPatGlow; uniform float uPatSize;
${P.tri ? 'varying vec3 vCfPos; varying vec3 vCfNrm;' : ''}
float cfPatM = 0.0; float cfPatG = 0.0;${PAT_NOISE}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{${evalBlock}
  cfPatM = clamp(pm, 0.0, 1.0) * uPatAmt; cfPatG = clamp(pg, 0.0, 1.0) * cfPatM;
  float pL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 pCol = uPatCol * (0.30 + 1.05 * pL);                       // relit by the texel, so the art's shading survives
  vec3 pOut = mix(diffuseColor.rgb * ps, pCol * ps, clamp(pm, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(pOut, 0.0, 1.6), uPatAmt);
}`);
      // a carbon panel is not as rough as fur, and a wireframe is not metal: only the patterns in
      // PAT_MAT ask for this, the rest pass -1 and the chunk is left alone
      if (rough >= 0) sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uPatRough, cfPatM);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, uPatMetal, cfPatM);`);
      if (glow > 0) sh.fragmentShader = sh.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uPatCol * (cfPatG * uPatGlow);`);
    };
    m.customProgramCacheKey = () => prevKey + '|cfpat' + kind + (rough >= 0 ? 'm' : '') + (glow > 0 ? 'g' : '');
    m.needsUpdate = true;
  }

  // Skin tone. The whole-body tint above recolours everything, which is no use for "make him black or brown":
  // clothes, eyes and logos have to stay put. So we find THIS fighter's actual skin colour by reading the base
  // texture at the UVs of the vertices nearest the rig's `headfront` marker (i.e. the middle of the face), and
  // the shader only moves texels whose colour sits near that one, keeping each texel's own shading.
  const skinRefCache = new Map();
  // THE FIGHTER'S ACTUAL COAT COLOUR.
  //
  // This used to take the 80 vertices nearest the rig's `headfront` marker -- the middle of the face
  // -- and use their median texel. On a cartoon animal the middle of the face is the MUZZLE, which is
  // cream or white, and white has no hue: `skC = rgb / luminance` comes out near (1,1,1), so the
  // shader's "is this texel skin" test then matched every pale, desaturated texel in the atlas and
  // missed the orange fur entirely. The visible result was Duane's, 9/28: "Skin/fur tone doesnt
  // change anything" -- picking `green` turned doge's CHAIN green and left the dog orange.
  //
  // Now it samples the whole head and upper body, throws away texels too dark or too bright to carry
  // a hue (eyes, nostrils, specular highlights), buckets what is left by hue, and takes the biggest
  // bucket. That is the coat, by definition: the colour most of the fighter is actually painted.
  function skinReference(root, T, id) {
    if (id && skinRefCache.has(id)) return skinRefCache.get(id);
    let out = null;
    try {
      let mesh = null; root.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
      const tex = mesh && mesh.material && mesh.material.map, img = tex && tex.image;
      const uv = mesh && mesh.geometry && mesh.geometry.attributes.uv;
      const marker = root.getObjectByName('headfront') || root.getObjectByName('Head');
      if (mesh && uv && img && img.width && marker) {
        if (mesh.skeleton) mesh.skeleton.update();
        const hp = marker.getWorldPosition(new T.Vector3()), v = new T.Vector3();
        // a generous ball around the head: the head itself plus the shoulders, which on almost every
        // fighter here is coat rather than clothing
        let far = 0; const n = mesh.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 4000));
        const pts = [];
        for (let i = 0; i < n; i += step) { mesh.getVertexPosition(i, v); mesh.localToWorld(v); pts.push([v.distanceToSquared(hp), i]); }
        pts.sort((a, b) => a[0] - b[0]);
        far = pts.length ? pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.45))][0] : 0;
        const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
        const g2 = c.getContext('2d', { willReadFrequently: true }); g2.drawImage(img, 0, 0, S, S);
        const data = g2.getImageData(0, 0, S, S).data;
        const sample = minSat => {
          const buckets = new Map();
          for (let q = 0; q < pts.length; q++) {
            if (pts[q][0] > far) break;
            const i = pts[q][1];
            const u = uv.getX(i), vv = tex.flipY === false ? uv.getY(i) : 1 - uv.getY(i);
            const x = Math.max(0, Math.min(S - 1, Math.floor(u * S))), y = Math.max(0, Math.min(S - 1, Math.floor(vv * S)));
            const o2 = (y * S + x) * 4;
            const r = data[o2] / 255, gg = data[o2 + 1] / 255, b = data[o2 + 2] / 255;
            const L = 0.299 * r + 0.587 * gg + 0.114 * b;
            if (L < 0.10 || L > 0.94) continue;                // an eye, a nostril, a blown highlight
            const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
            if ((mx - mn) / Math.max(mx, 0.004) < minSat) continue;
            const k = Math.round(r / L * 6) + ',' + Math.round(gg / L * 6) + ',' + Math.round(b / L * 6);
            let e = buckets.get(k); if (!e) { e = []; buckets.set(k, e); }
            e.push([r, gg, b]);
          }
          let b2 = null; for (const e of buckets.values()) if (!b2 || e.length > b2.length) b2 = e;
          return b2;
        };
        // CHROMATIC FIRST. Bucketing every texel picked doge's WHITE -- the muzzle, chest and paws
        // together outnumber the orange -- and a white reference has no hue, so the shader's
        // "is this skin" test then matched every pale texel in the atlas (the gold chain) and none of
        // the coat. Requiring some saturation makes the dominant bucket the coat itself. A genuinely
        // pale fighter (mochi, wojak) has no chromatic bucket, so it falls back to the old behaviour.
        let best = sample(0.22);
        if (!best || best.length < 12) best = sample(0);
        if (best && best.length >= 6) {
          const med = j => { const a = best.map(p => p[j]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
          out = new T.Color(med(0), med(1), med(2));
        }
      }
    } catch (e) { out = null; }
    if (id) skinRefCache.set(id, out);
    return out;
  }
  function reskin(m, ref, to, amt) {
    // UPDATE IN PLACE IF IT IS ALREADY PATCHED. onBeforeCompile runs once per PROGRAM, and the cache
    // key here ('|cfskin') does not mention the colour -- so on a material that has already been
    // through this, three.js reuses the compiled program, never calls onBeforeCompile again, and the
    // fresh `{ value: to }` objects assigned inside it are simply dropped. Picking a new tone then
    // changed nothing at all, which is exactly what Duane reported: "Skin/fur tone doesnt change
    // anything. colour only works." Holding the uniform objects and writing into them makes a tone
    // change take effect with no recompile.
    const U = m.userData && m.userData.cfSkinU;
    if (U) { U.uSkRef.value.copy(ref); U.uSkTo.value.copy(to); U.uSkAmt.value = amt; return; }
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      const uu = { uSkRef: { value: ref.clone() }, uSkTo: { value: to.clone() }, uSkAmt: { value: amt } };
      sh.uniforms.uSkRef = uu.uSkRef; sh.uniforms.uSkTo = uu.uSkTo; sh.uniforms.uSkAmt = uu.uSkAmt;
      if (!m.userData) m.userData = {};
      m.userData.cfSkinU = uu;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkRef; uniform vec3 uSkTo; uniform float uSkAmt;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float skL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float skRL = max(dot(uSkRef, vec3(0.299, 0.587, 0.114)), 0.004);
  vec3 skC = diffuseColor.rgb / max(skL, 0.004);           // this texel's hue, brightness removed
  vec3 skR = uSkRef / skRL;                                 // the face's hue, brightness removed
  float d = distance(skC, skR);                             // 0 on skin, large on clothes, eyes and logos
  // WIDE ON PURPOSE. This was smoothstep(0.40, 0.13, d) -- a texel had to be within a whisker of the
  // reference hue to count as skin. A coat is not one hue: doge runs orange through cream to white,
  // and a white texel has no hue at all, so the tight band matched almost none of the fur and the
  // control appeared dead. Forcing mask to 1.0 recoloured the whole fighter correctly, which proved
  // the reference and the uniforms were fine and the band was the thing rejecting the coat.
  //
  // It cannot be made perfect: doge's gi is the same orange as doge, and no hue test can separate a
  // coat from clothing painted the same colour. Wide is the right trade -- picking a tone visibly
  // changes the fighter, which is what the control promises, and strongly contrasting clothing
  // (a blue shirt, a red scarf) still keeps its own colour.
  float mask = smoothstep(0.78, 0.24, d) * smoothstep(0.02, 0.10, skL);
  vec3 toned = uSkTo * (skL / skRL);                        // the new tone, relit by this texel's own shading
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(toned, 0.0, 1.5), mask * uSkAmt);
}`);
    };
    m.customProgramCacheKey = () => prevKey + '|cfskin';
    m.needsUpdate = true;
  }
  // The triplanar patterns are measured in the model's OWN units, and the models are not the same
  // size, so a fixed scale would give KAIJU a fine weave and SPARK a tarpaulin. Divide by the mesh's
  // bind-pose height and one setting means the same thing on all 46. Cached on the geometry.
  function patSize(mesh, T) {
    const g = mesh.geometry; if (!g) return 1;
    if (g.userData.cfSize == null) {
      let h = 0;
      try { if (!g.boundingBox) g.computeBoundingBox(); h = g.boundingBox.max.y - g.boundingBox.min.y; } catch (e) { h = 0; }
      g.userData.cfSize = h > 0.01 ? 1 / h : 1;
    }
    return g.userData.cfSize;
  }

  function paintBody(root, T, lk, id) {
    const tint = (TINTS.find(t => t[0] === lk.tint) || [])[2];
    const skinTo = (SKIN.find(t => t[0] === lk.skin) || [])[2];
    const ref = skinTo ? skinReference(root, T, id) : null;
    const pat = lk.pattern && lk.pattern !== 'none' ? lk.pattern : null;
    const patCol = pat ? ((PATCOL.find(c => c[0] === lk.patcol) || [])[2] || PAT_AUTO[pat] || '#14141a') : null;
    root.traverse(o => {
      if (!o.isMesh || o.userData.cfGear) return;
      const m = o.material; if (!m || !m.isMeshStandardMaterial) return;
      if (lk.finish === 'matte') { m.roughness = 0.92; m.metalness = 0; }
      else if (lk.finish === 'gloss') { m.roughness = 0.2; m.metalness = 0.05; m.envMapIntensity = 1.3; }
      else if (lk.finish === 'chrome') { m.roughness = 0.14; m.metalness = 0.95; m.envMapIntensity = 1.7; }
      else if (lk.finish === 'gold') { m.roughness = 0.28; m.metalness = 0.9; m.envMapIntensity = 1.6; }
      // Chrome needs a neutral albedo the way gold needs a gold one. Metalness 0.95 over doge's ORANGE
      // texture just reads as darker, more saturated orange -- a metal's colour comes from its albedo,
      // so a chrome finish over a coloured coat looks like tinted plastic. Gold already forced its own
      // albedo on this line and that is exactly why gold was the only finish that read.
      const col = tint || (lk.finish === 'gold' ? '#ffc83d' : lk.finish === 'chrome' ? '#cfd6e2' : null);
      // ORDER MATTERS: each of these wraps the previous onBeforeCompile and the LAST one applied ends up
      // FIRST in the shader. Skin has to run before tint -- its mask compares against the texture's own
      // colour, and a tinted texel would no longer look like skin. The pattern goes BETWEEN them for the
      // same reason in reverse: applied after the skin tone (so the tone still finds real skin under it)
      // and before the tint (so a crimson fighter gets crimson carbon rather than carbon over crimson).
      if (col) recolor(m, new T.Color(col), lk.tint === 'shadow' || lk.tint === 'ghost' ? 0.9 : 0.78, lk.tint === 'shadow' || lk.tint === 'ghost' ? 0.25 : 0.46);
      // m.map is required: the snippets read vMapUv, which three.js only declares under USE_MAP, so a
      // mesh with no texture would fail to compile and render the fighter black.
      if (pat && m.map) {
        const mt = PAT_MAT[pat];
        patternize(m, pat, new T.Color(patCol), PAT_AMT[pat] == null ? 0.8 : PAT_AMT[pat],
          mt ? mt[0] : -1, mt ? mt[1] : 0, pat === 'circuit' ? 1.15 : (pat === 'grid' ? 0.75 : (pat === 'hex' ? 0.5 : 0)), patSize(o, T));
      }
      if (skinTo && ref) reskin(m, ref, new T.Color(skinTo), 0.95);
    });
  }

  // ---------------------------------------------------------------- measuring the body
  // Everything is measured in BONE-LOCAL space from the rig's own markers (head_end = crown,
  // headfront = face). World space was the old bug: the avatar is rotated in a match, so "front"
  // came out along the wrong axis and the glasses landed on top of the head.
  // The skin is sampled once and split by its DOMINANT SKIN BONE, so the head profile is the head and
  // the foot profile is that foot -- a radius filter used to drag in shoulders, chins and the other leg.
  const HB = 36, HA = 24;          // head profile: height bands x azimuth bins
  const EYE_K = 0.52;              // eye line, as a fraction of head height above the headfront marker
  // Per-fighter eye-line nudge, in head heights. THIS WAS AN EMPTY OBJECT until 9/28 -- the comment
  // said "filled from dev/gearcheck" and it never was, so all 46 fighters got the same 0.52 and the
  // glasses sat on the forehead of anything with a snout and under the eyes of anything with a tall
  // skull. Duane: "a lot are disproportionate, dont fit... or dont go on the right place."
  //
  // gearcheck could not have caught it: its eye rule compares the glasses against CustomLook's OWN
  // reported eyeY, so it only ever asked "did they land where we aimed", never "is that the eyes".
  // Measured instead by dev/eyeline.mjs, which finds the eyes in the TEXTURE -- the one dark feature
  // that comes in a symmetric pair, so noses and mouths (on the centre line) are excluded. 36 of the
  // 43 it could measure were more than 0.09 head-heights out.
  //
  // Clamped to +/-0.30: a masked face (bogdanoff, clanker, gwei, sin) has no painted eyes at all, so
  // its "dark pair" is a coat or a visor and the reading should not be trusted to the clamp edge.
  // Per-fighter eye-line nudge, in head heights. THIS WAS AN EMPTY OBJECT until 9/28 -- the comment
  // said "filled from dev/gearcheck" and it never was, so all 46 fighters shared one 0.52 guess.
  // gearcheck could not have caught it: its eye rule compares the glasses against CustomLook's OWN
  // reported eyeY, so it only ever asked "did they land where we aimed", never "is that the eyes".
  //
  // Measured by dev/eyeline.mjs, which finds the eyes in the TEXTURE. Two wrong answers first, both
  // worth keeping written down: darkness alone picks a black nose or a shadowed jaw, and local
  // CONTRAST alone still picks a cartoon mouth, which on a muzzle has more texels than the eyes do
  // and dragged doge's glasses onto its snout. Eyes are the high-contrast pair ABOVE the mouth, so
  // it takes the median of the upper half of the contrast points.
  //
  // Clamped: a masked face (bogdanoff, clanker, gwei, sin) has no painted eyes, so its reading is a
  // visor or a coat and must not be trusted to the edge of the face band.
  const EYE_ADJ = { ape: -0.280, bear: -0.118, bling: -0.261, bogdanoff: -0.280, bonk: -0.040, brett: 0.104,
    bull: 0.277, cashcat: -0.206, cheems: -0.075, chop: -0.280, clanker: -0.130, ember: 0.128, fartcoin: -0.173,
    floki: -0.166, giga: 0.340, gigachad: 0.128, ginga: 0.272, gwei: -0.105, hoodie: 0.211, kaiju: 0.340,
    lobster: 0.057, mochi: -0.153, moodeng: 0.063, mystic: 0.093, omen: 0.340, pengu: -0.100, pepe: -0.057,
    popcat: 0.035, shib: 0.137, shroom: -0.280, sifu: -0.280, sin: 0.199, spark: 0.248, techno: 0.310,
    topg: -0.080, trump: 0.062, turbo: -0.100, tyrant: -0.100, whale: -0.263, wif: 0.138, wisp: 0.277,
    wojak: 0.054 };

  function fillGaps(arr, seen) {
    const n = arr.length; let prev = -1;
    for (let i = 0; i < n; i++) {
      if (!seen[i]) continue;
      if (prev >= 0 && i - prev > 1) for (let k = prev + 1; k < i; k++) { const t = (k - prev) / (i - prev); arr[k] = arr[prev] * (1 - t) + arr[i] * t; }
      prev = i;
    }
    let first = -1; for (let i = 0; i < n; i++) if (seen[i]) { first = i; break; }
    if (first < 0) return;
    for (let i = 0; i < first; i++) arr[i] = arr[first];
    for (let i = prev + 1; i < n; i++) arr[i] = arr[prev];
  }
  // Half-width / half-depth / radius of a point cloud, band by band up the axis, plus a per-azimuth
  // radius map. Every gear builder sizes itself off this instead of one global "head width".
  function bandProfile(pts, y0, y1, nb, na) {
    const W = new Float64Array(nb), D = new Float64Array(nb), R = new Float64Array(nb), F = new Float64Array(nb), A = new Float64Array(nb * na);
    const seen = new Array(nb).fill(false), span = (y1 - y0) || 1, k = nb / span;
    const idx = y => Math.max(0, Math.min(nb - 1, Math.floor((y - y0) * k)));
    for (const p of pts) {
      if (p.y < y0 || p.y > y1) continue;
      const b = idx(p.y), ax = Math.abs(p.x), az = Math.abs(p.z), r = Math.hypot(p.x, p.z);
      seen[b] = true;
      if (ax > W[b]) W[b] = ax;
      if (az > D[b]) D[b] = az;
      if (r > R[b]) R[b] = r;
      let ai = Math.floor((Math.atan2(p.x, p.z) / (Math.PI * 2) + 0.5) * na); ai = ((ai % na) + na) % na;
      if (r > A[b * na + ai]) A[b * na + ai] = r;
    }
    for (const p of pts) { if (p.y < y0 || p.y > y1) continue; const b = idx(p.y); if (Math.abs(p.x) <= W[b] * 0.45 + 1e-9 && p.z > F[b]) F[b] = p.z; }
    fillGaps(W, seen); fillGaps(D, seen); fillGaps(R, seen); fillGaps(F, seen);
    const at = (arr, y) => { const t = Math.max(0, Math.min(nb - 1, (y - y0) * k - 0.5)); const i = Math.floor(t), f = t - i; return arr[i] * (1 - f) + arr[Math.min(nb - 1, i + 1)] * f; };
    const top = (arr, a, b) => { let m = 0; for (let i = idx(Math.min(a, b)), e = idx(Math.max(a, b)); i <= e; i++) if (arr[i] > m) m = arr[i]; return m; };
    return {
      y0, y1, nb, na, W, D, R, F, A, seen, idx,
      w: y => at(W, y), d: y => at(D, y), r: y => at(R, y), f: y => at(F, y),
      fitW: (a, b) => top(W, a, b), fitD: (a, b) => top(D, a, b), fitR: (a, b) => top(R, a, b),
      rad: (y, ang) => { const b = idx(y); let ai = Math.floor((ang / (Math.PI * 2) + 0.5) * na); ai = ((ai % na) + na) % na; return A[b * na + ai] || at(R, y); },
      cov: (b, thr) => { let c = 0; for (let a = 0; a < na; a++) if (A[b * na + a] >= thr) c++; return c; },
    };
  }

  function measure(root, T, id) {
    let top = root; while (top.parent) top = top.parent;
    top.updateMatrixWorld(true);
    const V = () => new T.Vector3();
    const bone = n => root.getObjectByName(n);
    const B = { head: bone('Head') || bone('head'), neck: bone('neck') || bone('Neck'), spine: bone('Spine02') || bone('Spine'),
      footL: bone('LeftFoot'), footR: bone('RightFoot'), toeL: bone('LeftToeBase'), toeR: bone('RightToeBase') };
    if (!B.head) return null;
    const headEnd = bone('head_end') || bone('HeadTop_End'), headFront = bone('headfront');
    const invHead = new T.Matrix4().copy(B.head.matrixWorld).invert();
    const invRoot = new T.Matrix4().copy(root.matrixWorld).invert();
    const toHead = o => o.getWorldPosition(V()).applyMatrix4(invHead);
    // up: toward the crown. front: toward the face, squared off against up.
    const up = V();
    if (headEnd) up.copy(toHead(headEnd));
    if (up.lengthSq() < 1e-9 && B.neck) up.copy(toHead(B.neck)).negate();
    if (up.lengthSq() < 1e-9) up.set(0, 1, 0);
    const H = up.length() || 1;
    up.normalize();
    const face = headFront ? toHead(headFront) : V().set(0, 0, H * 0.5);
    const faceUp = face.dot(up);
    const front = V().copy(face).addScaledVector(up, -faceUp);
    if (front.lengthSq() < 1e-9) front.set(0, 0, 1);
    front.normalize();
    const right = V().crossVectors(up, front).normalize();
    front.crossVectors(right, up).normalize();

    // one skin sample, world space, tagged with the bone that owns each vertex
    let mesh = null; root.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
    const WV = [], WB = [];
    if (mesh && mesh.geometry && mesh.geometry.attributes.position) {
      if (mesh.skeleton) mesh.skeleton.update();
      const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      const bones = (mesh.skeleton && mesh.skeleton.bones) || [];
      const n = pos.count, step = Math.max(1, Math.floor(n / 7000)), v = V();
      for (let i = 0; i < n; i += step) {
        mesh.getVertexPosition(i, v); mesh.localToWorld(v); WV.push(v.clone());
        let nm = '';
        if (si && sw) {
          let bi = -1, bw = -1;
          for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
          const bn = bones[bi]; nm = bn ? bn.name : '';
        }
        WB.push(nm);
      }
    }
    // Spine is deliberately NOT here. Adding it to widen the profile on round-bodied fighters made
    // things worse, not better -- 8 of 24 neck checks passing became 6, and it broke pepe, which had
    // been clean. The extra vertices move `nw`/`nd` and the profile in ways that cost more than the
    // round bodies gain, so this stays as it was and the round-body case is left alone.
    const HEADB = { Head: 1, head_end: 1, headfront: 1 }, NECKB = { neck: 1, Head: 1, Spine02: 1, Spine01: 1 };
    const weighted = WB.some(Boolean);

    // ---- head, in head-bone space
    const hv = [], v1 = V();
    for (let i = 0; i < WV.length; i++) {
      v1.copy(WV[i]).applyMatrix4(invHead);
      const x = v1.dot(right), y = v1.dot(up), z = v1.dot(front);
      if (weighted) { if (!HEADB[WB[i]]) continue; } else if (y < -0.9 * H || y > 2.4 * H || Math.hypot(x, z) > 2.8 * H) continue;
      if (y < -1.3 * H || y > 2.6 * H) continue;
      hv.push({ x, y, z });
    }
    const P = bandProfile(hv, -1.3 * H, 2.6 * H, HB, HA);
    const maxW = P.fitW(-0.2 * H, 1.9 * H) || H * 0.5;
    // crown: the top of the SKULL, not the tip of an ear, horn or crest. Width alone is not enough --
    // a pair of wide ears is as wide as the head. A skull band fills most of its azimuth bins; ears,
    // horns and crests fill two or three. head_end is the rig's own crown marker, so it anchors the result.
    let skullTop = -1e9; for (const p of hv) if (p.y > skullTop) skullTop = p.y;
    if (!isFinite(skullTop)) skullTop = H;
    let det = H;
    for (let i = HB - 1; i >= 0; i--) {
      const yTop = -1.3 * H + (i + 1) * (3.9 * H) / HB;
      if (yTop > 1.7 * H) continue;
      if (P.seen[i] && P.W[i] >= maxW * 0.4 && P.cov(i, maxW * 0.36) >= HA * 0.6) { det = yTop; break; }
    }
    let capY = Math.min(Math.max(det, H * 0.98), H * 1.25, skullTop);
    capY = Math.max(capY, H * 0.7);
    const hw = Math.max(H * 0.22, P.fitW(capY - H * 0.55, capY));
    const hd = Math.max(H * 0.22, P.fitD(capY - H * 0.55, capY));

    // eye line: the headfront marker sits on the face plane, the eyes a little above it
    const eyeY = Math.max(faceUp + H * 0.05, Math.min(faceUp + H * (EYE_K + (EYE_ADJ[id] || 0)), capY - H * 0.24));
    // face depth on a grid, so each lens can sit on the surface under it instead of one flat plane
    const GX = 15, GY = 22, gx0 = -maxW * 1.1, gx1 = maxW * 1.1, gy0 = -0.6 * H, gy1 = 1.9 * H;
    const FG = new Float64Array(GX * GY).fill(-1e9);
    for (const p of hv) {
      const i = Math.floor((p.x - gx0) / (gx1 - gx0) * GX), j = Math.floor((p.y - gy0) / (gy1 - gy0) * GY);
      if (i < 0 || i >= GX || j < 0 || j >= GY) continue;
      const q = j * GX + i; if (p.z > FG[q]) FG[q] = p.z;
    }
    const faceZAt = (x, y) => {
      const i = Math.max(0, Math.min(GX - 1, Math.floor((x - gx0) / (gx1 - gx0) * GX)));
      const j = Math.max(0, Math.min(GY - 1, Math.floor((y - gy0) / (gy1 - gy0) * GY)));
      let best = FG[j * GX + i];
      if (best < -1e8) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || a >= GX || b < 0 || b >= GY) continue; if (FG[b * GX + a] > best) best = FG[b * GX + a]; }
      return best < -1e8 ? P.f(y) : best;
    };
    const fz = Math.max(faceZAt(0, eyeY), P.f(eyeY), H * 0.1);
    let ew = 0;
    for (const p of hv) { if (Math.abs(p.y - eyeY) < H * 0.2 && p.z > fz * 0.35 && Math.abs(p.x) > ew) ew = Math.abs(p.x); }
    ew = Math.max(hw * 0.42, Math.min(ew || hw * 0.75, hw * 0.96));
    const sideW = Math.max(ew, P.w(eyeY)), sideD = Math.max(hd * 0.7, P.d(eyeY));

    // ---- neck, in the neck bone's own space
    const nb = B.neck || B.spine || B.head;
    const invNeck = new T.Matrix4().copy(nb.matrixWorld).invert();
    const qNeck = nb.getWorldQuaternion(new T.Quaternion()).invert();
    const qHead = B.head.getWorldQuaternion(new T.Quaternion());
    const wDir = v => v.clone().applyQuaternion(qHead);            // head-local direction -> world
    const headInNeck = B.head.getWorldPosition(V()).applyMatrix4(invNeck);
    // The neck's own axis is the line from the neck joint to the head joint -- THE rig's definition of a
    // neck. Using the head's up vector instead tilts the whole collar on any fighter whose head sits
    // forward of the neck, which is why several of them wore the chain on the chest.
    const nUp = headInNeck.lengthSq() > 1e-12 ? headInNeck.clone().normalize() : wDir(up).applyQuaternion(qNeck).normalize();
    const nFront = wDir(front).applyQuaternion(qNeck);
    nFront.addScaledVector(nUp, -nFront.dot(nUp));
    if (nFront.lengthSq() < 1e-12) nFront.set(0, 0, 1);
    nFront.normalize();
    const nRight = V().crossVectors(nUp, nFront).normalize();
    nFront.crossVectors(nRight, nUp).normalize();
    // every bone on this rig carries its own scale, so head-bone units are NOT neck-bone units. nH is the
    // head height expressed in NECK space -- mixing the two is what dropped the bow tie onto the chest.
    const nH = headEnd ? headEnd.getWorldPosition(V()).applyMatrix4(invNeck).distanceTo(headInNeck) || H : H;
    const nl = Math.max(nH * 0.14, headInNeck.dot(nUp));           // the neck joint up to the jaw
    const nv = [];
    for (let i = 0; i < WV.length; i++) {
      if (weighted && !NECKB[WB[i]]) continue;
      v1.copy(WV[i]).applyMatrix4(invNeck);
      const y = v1.dot(nUp); if (y < -nH * 0.95 || y > nl * 1.1) continue;
      const x = v1.dot(nRight), z = v1.dot(nFront);
      if (Math.hypot(x, z) > nH * 1.8) continue;
      nv.push({ x, y, z });
    }
    const NP = bandProfile(nv, -nH * 0.95, nl * 1.1, 20, HA);
    // the collar ring is sized at MID neck, where nothing else is in the way, then flared a little
    let nw = 0, nd = 0;
    for (const p of nv) { if (Math.abs(p.y - nl * 0.5) > nl * 0.32) continue; const ax = Math.abs(p.x), az = Math.abs(p.z); if (ax > nw) nw = ax; if (az > nd) nd = az; }
    nw = Math.max(nH * 0.1, Math.min(nw || nH * 0.4, nH * 0.9));
    nd = Math.max(nw * 0.55, Math.min(nd || nw, nw * 1.4));
    let chestZ = 0;
    const dropY = -nH * 0.34;
    for (const p of nv) { if (Math.abs(p.y - dropY) > nH * 0.14 || Math.abs(p.x) > nw * 0.85) continue; if (p.z > chestZ) chestZ = p.z; }
    if (!chestZ) chestZ = nd * 1.15;

    // ---- feet, each in its own foot-bone space
    const qRoot = root.getWorldQuaternion(new T.Quaternion());
    const feet = [];
    for (const [key, fb, tb] of [['footL', B.footL, B.toeL], ['footR', B.footR, B.toeR]]) {
      if (!fb) continue;
      const fo = fb.getWorldPosition(V()), to = tb ? tb.getWorldPosition(V()) : null;
      const invF = new T.Matrix4().copy(fb.matrixWorld).invert();
      const qF = fb.getWorldQuaternion(new T.Quaternion()).invert();
      const toeLen = to ? Math.max(fo.distanceTo(to), H * 0.15) : H * 0.55;
      const wFront = to ? V().copy(to).sub(fo) : wDir(front).applyQuaternion(qRoot);
      wFront.y = 0;
      if (wFront.lengthSq() < 1e-9) { wFront.copy(wDir(front)); wFront.y = 0; }
      if (wFront.lengthSq() < 1e-9) wFront.set(0, 0, 1);
      wFront.normalize();
      const fUp = V().set(0, 1, 0).applyQuaternion(qF).normalize();
      const fFront = wFront.clone().applyQuaternion(qF).normalize();
      const fRight = V().crossVectors(fUp, fFront).normalize();
      fFront.crossVectors(fRight, fUp).normalize();
      const own = { [fb.name]: 1 }; if (tb) own[tb.name] = 1;
      const fv = [];
      for (let i = 0; i < WV.length; i++) {
        if (weighted) { if (!own[WB[i]]) continue; } else if (WV[i].distanceTo(fo) > toeLen * 2.2) continue;
        v1.copy(WV[i]).applyMatrix4(invF);
        const x = v1.dot(fRight), y = v1.dot(fUp), z = v1.dot(fFront);
        if (y > toeLen * 1.4) continue;
        fv.push({ x, y, z });
      }
      if (fv.length < 8) continue;
      let soleY = Infinity, toeZ = -Infinity, heelZ = Infinity, xMin = Infinity, xMax = -Infinity, topY = -Infinity;
      for (const p of fv) {
        if (p.y < soleY) soleY = p.y; if (p.y > topY) topY = p.y;
        if (p.z > toeZ) toeZ = p.z; if (p.z < heelZ) heelZ = p.z;
        if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
      }
      const len = Math.max(toeLen * 0.9, toeZ - heelZ);
      feet.push({ key, b: fb, len, halfW: Math.max(len * 0.16, (xMax - xMin) / 2), cx: (xMin + xMax) / 2, soleY, topY, heelZ, toeZ, cz: (heelZ + toeZ) / 2,
        right: fRight, up: fUp, front: fFront });
    }

    // whole body, in the model's own space, for the aura
    let minY = Infinity, maxY = -Infinity, bw = 0;
    for (const w of WV) { const p = v1.copy(w).applyMatrix4(invRoot); if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; const r = Math.hypot(p.x, p.z); if (r > bw) bw = r; }
    if (!isFinite(minY)) { minY = 0; maxY = H * 5; }
    const S = maxY - minY;

    const basis = (r2, u2, f2) => new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r2, u2, f2));
    const rootFront = wDir(front).applyQuaternion(qRoot.clone().invert());
    rootFront.y = 0; if (rootFront.lengthSq() < 1e-9) rootFront.set(0, 0, 1); rootFront.normalize();
    const rootUp = V().set(0, 1, 0), rootRight = V().crossVectors(rootUp, rootFront).normalize();
    const span = Math.max(capY - eyeY, H * 0.26);
    const M = {
      B, root, id, H, S, hw, hd, ew, fz, capY, eyeY, faceUp, minY, bw: bw || S * 0.3, maxW, sideW, sideD, span,
      P, NP, faceZAt, nl, nw, nd, nH, chestZ, dropY, feet, made: [],
      cx: 0, zc: 0, neckY: 0, nzc: 0,
      // where a hat sits: k = 0 is the eye line, k = 1 the crown
      hatY: k => capY - span * (1 - k),
      // the ellipse a piece of headwear needs to clear the skull between two heights. Pure width x depth
      // cuts the corners on a head that is not an ellipse, so it is also floored against the max radius.
      fit: (a, b) => {
        const lo = Math.min(a, b), hi = Math.max(a, b), rr = P.fitR(lo, hi);
        return { rx: Math.max(P.fitW(lo, hi), rr * 0.88, H * 0.18), rz: Math.max(P.fitD(lo, hi), rr * 0.88, H * 0.18) };
      },
      ax: {
        head: { b: B.head, q: basis(right, up, front), right, up, front },
        neck: { b: nb, q: basis(nRight, nUp, nFront), right: nRight, up: nUp, front: nFront },
        root: { b: root, q: basis(rootRight, rootUp, rootFront), right: rootRight, up: rootUp, front: rootFront },
      },
    };
    for (const f of feet) M.ax[f.key] = { b: f.b, q: basis(f.right, f.up, f.front), right: f.right, up: f.up, front: f.front };
    return M;
  }

  // ---------------------------------------------------------------- gear building blocks
  function mat(T, o) { return new T.MeshStandardMaterial(o); }
  function glowMat(T, hex, ei, extra) {
    const col = new T.Color(hex);
    return { m: mat(T, Object.assign({ color: 0x000000, emissive: col, emissiveIntensity: ei, roughness: 0.4 }, extra || {})), want: { emissive: col.clone(), ei, opacity: extra && extra.opacity } };
  }
  // Avatar.update (91_v3_render) walks every material on the model each frame and writes emissive / opacity.
  // A ShaderMaterial has no .emissive, so anything custom carries a dummy one for that write to land on.
  function fxMat(T, o) {
    const m = new T.ShaderMaterial(o);
    m.emissive = new T.Color(); m.emissiveIntensity = 1;
    return m;
  }
  function part(T, g, geo, m, want, tag) {
    const me = new T.Mesh(geo, m); me.castShadow = true; me.userData.cfGear = true; me.userData.cfPart = tag || '';
    if (want) keep(me, want);
    g.add(me); return me;
  }
  function gearGroup(T, slot) { const g = new T.Group(); g.userData.T = T; g.userData.cfGear = true; g.userData.cfSlot = slot; return g; }
  function mount(M, which, g, x, y, z) {
    const ax = M.ax[which]; if (!ax || !ax.b) return null;
    g.quaternion.copy(ax.q);
    g.position.copy(ax.right.clone().multiplyScalar(x)).addScaledVector(ax.up, y).addScaledVector(ax.front, z);
    ax.b.add(g);
    const slot = g.userData.cfSlot, foot = g.userData.cfFoot;
    g.traverse(o => { o.userData.cfGear = true; if (slot && !o.userData.cfSlot) o.userData.cfSlot = slot; if (foot && !o.userData.cfFoot) o.userData.cfFoot = foot; });
    M.made.push(g);
    return g;
  }
  // a cylinder laid between two points: temple arms, chains, straps, dread segments
  function strut(T, g, a, b, r, m, tag, seg) {
    const d = new T.Vector3().subVectors(b, a), L = d.length() || 1e-4;
    const c = part(T, g, new T.CylinderGeometry(r, r, L, seg || 8), m, null, tag);
    c.position.copy(a).addScaledVector(d, 0.5);
    c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
    return c;
  }
  function roundedRect(T, w, h, r) {
    const s = new T.Shape(), x = w / 2, y = h / 2, k = Math.min(r, x * 0.98, y * 0.98);
    s.moveTo(-x + k, -y);
    s.lineTo(x - k, -y); s.quadraticCurveTo(x, -y, x, -y + k);
    s.lineTo(x, y - k); s.quadraticCurveTo(x, y, x - k, y);
    s.lineTo(-x + k, y); s.quadraticCurveTo(-x, y, -x, y - k);
    s.lineTo(-x, -y + k); s.quadraticCurveTo(-x, -y, -x + k, -y);
    return s;
  }
  function ringPlate(T, w, h, r, t, thick) {   // a rounded-rect frame with the middle cut out
    const s = roundedRect(T, w, h, r);
    const hole = roundedRect(T, Math.max(w - t * 2, w * 0.15), Math.max(h - t * 2, h * 0.15), Math.max(r - t, r * 0.2));
    s.holes.push(new T.Path(hole.getPoints(40).reverse()));
    const geo = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.28, bevelSize: thick * 0.28, bevelSegments: 2, curveSegments: 14 });
    geo.translate(0, 0, -thick / 2);
    return geo;
  }
  function slab(T, w, h, r, thick, bevel) {    // a solid rounded-rect plate (soles, plates, brims)
    const geo = new T.ExtrudeGeometry(roundedRect(T, w, h, r), { depth: thick, bevelEnabled: bevel !== false, bevelThickness: thick * 0.3, bevelSize: thick * 0.3, bevelSegments: 2, curveSegments: 14 });
    geo.translate(0, 0, -thick / 2);
    return geo;
  }
  // a flat ring (or ring sector) lying in the horizontal plane: hat brims. Built as an annulus so no part
  // of it ever passes through the skull -- a solid disc would.  angle 0 = +x, pi/2 = front.
  function arcPlate(T, r0, r1, a0, a1, thick) {
    const s = new T.Shape();
    s.absarc(0, 0, r1, a0, a1, false);
    s.absarc(0, 0, r0, a1, a0, true);
    s.closePath();
    const geo = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.25, bevelSize: thick * 0.25, bevelSegments: 1, curveSegments: 40 });
    geo.translate(0, 0, -thick / 2); geo.rotateX(Math.PI / 2);
    return geo;
  }
  function dome(T, g, m, rx, ry, rz, tag, phiLen, phiStart) {
    const d = part(T, g, new T.SphereGeometry(1, 34, 18, phiStart == null ? 0 : phiStart, phiLen == null ? Math.PI * 2 : phiLen, 0, Math.PI / 2), m, null, tag);
    d.scale.set(rx, ry, rz); return d;
  }
  function ellipseRing(T, g, m, rx, rz, tube, tag, arc) {
    const r = part(T, g, new T.TorusGeometry(1, tube / Math.max(rx, 1e-6), 12, 48, arc || Math.PI * 2), m, null, tag);
    r.rotation.x = Math.PI / 2; r.scale.set(rx, rx, 1); r.scale.y = rz;
    return r;
  }

  // THE piece that makes hats fit. A scaled hemisphere cuts into any head that is not a ball -- that is what
  // "the skull pokes through the hat" was. This builds a shell whose radius at every (height, direction) comes
  // from the measured skull profile, so a cap hugs a flat top, a snout, a crest or a dome alike.
  function skullShell(T, M, yb, pad, opt) {
    const o = opt || {}, P = M.P, NA2 = o.na || 34, NJ = o.nj || 12;
    let yTop = o.top == null ? M.capY : o.top;
    const org = o.org == null ? yb : o.org;   // y that becomes 0 in the geometry (normally the group's mount height)
    if (yTop - yb < M.H * 0.02) yTop = yb + M.H * 0.02;   // never collapse to a zero-height ring
    const KD = o.dome === false ? 0 : (o.domeSegs || 6);
    const Rmax = M.fit(yb, yTop).rx;
    const arc = o.arc == null ? Math.PI * 2 : o.arc, a0 = o.arcStart == null ? -Math.PI : o.arcStart;
    const step = Math.PI * 2 / NA2;
    const rAt = (y, ang) => {
      let r = 0;
      for (let d = -1; d <= 1; d++) r = Math.max(r, P.rad(y, ang + d * step));
      return Math.min(Math.max(r, Rmax * 0.28), Rmax * 1.22) + pad;
    };
    const rings = [];
    for (let j = 0; j <= NJ; j++) {
      const y = yb + (yTop - yb) * (j / NJ), row = [];
      for (let i = 0; i <= NA2; i++) row.push(rAt(y, a0 + arc * (i / NA2)));
      rings.push({ y, row });
    }
    const top = rings[rings.length - 1];
    let mean = 0; for (const r of top.row) mean += r; mean /= top.row.length;
    const domeH = mean * (o.domeH == null ? 0.66 : o.domeH);
    for (let k = 1; k <= KD; k++) {
      const a = (k / KD) * Math.PI / 2, f = Math.cos(a) * (k === KD ? 0 : 1) || 1e-3;
      rings.push({ y: yTop + domeH * Math.sin(a), row: top.row.map(r => Math.max(r * Math.cos(a), 1e-4)) });
    }
    const pos = [], idx = [], NR = rings.length, W2 = NA2 + 1;
    for (let j = 0; j < NR; j++) {
      const R = rings[j];
      for (let i = 0; i <= NA2; i++) {
        const ang = a0 + arc * (i / NA2), r = R.row[i];
        pos.push(Math.sin(ang) * r, R.y - org, Math.cos(ang) * r);
      }
    }
    for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NA2; i++) {
      const a = j * W2 + i, b = a + 1, c = a + W2, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // a band that follows the skull between two heights: headbands, hat bands, crown bands
  function skullBand(T, M, y0, y1, pad, org) {
    return skullShell(T, M, y0, pad, { top: y1, nj: 3, dome: false, org: org == null ? y0 : org });
  }
  const hexCol = (T, list, key, fallback) => { const e = list.find(x => x[0] === key); return new T.Color(e && e[2] ? e[2] : fallback); };
  const shade = (T, c, k) => new T.Color(c).multiplyScalar(k);

  // ---------------------------------------------------------------- hats
  function buildHat(T, M, kind, colKey) {
    const g = gearGroup(T, 'hat'), H = M.H;
    const custom = colKey && colKey !== 'auto' ? hexCol(T, HATCOL, colKey, '#ffffff') : null;
    const main = def => custom || new T.Color(def);
    const gold = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.2, envMapIntensity: 1.9 });
    const goldD = mat(T, { color: 0xc99a22, metalness: 1, roughness: 0.32, envMapIntensity: 1.5 });
    const line = y => M.fit(y, M.capY);

    if (kind === 'cap' || kind === 'trucker' || kind === 'backcap') {
      const back = kind === 'backcap';
      const yb = M.hatY(back ? 0.5 : 0.42);
      const col = main(kind === 'trucker' ? 0x16305c : back ? 0x1b1d26 : 0xcf2038);
      const cloth = mat(T, { color: col, roughness: 0.74 });
      const rx = M.fit(yb, M.capY).rx;
      part(T, g, skullShell(T, M, yb, H * 0.018, { domeH: 0.72 }), cloth, null, 'crown');
      if (kind === 'trucker') {
        const fr = part(T, g, skullShell(T, M, yb, H * 0.026, { domeH: 0.72, arc: Math.PI * 0.86, arcStart: -Math.PI * 0.43 }), mat(T, { color: shade(T, col, 2.4).lerp(new T.Color(0xf2f3f7), 0.7), roughness: 0.88 }), null, 'panel');
        fr.position.y = 0;
      }
      const arc = Math.PI * (kind === 'trucker' ? 1.0 : 0.96);
      const dir = back ? -1 : 1;
      const br = part(T, g, arcPlate(T, rx * 0.72, rx * 1.05, Math.PI / 2 - arc / 2, Math.PI / 2 + arc / 2, H * 0.036), cloth, null, 'brim');
      br.scale.z = 1.75 * dir; br.position.y = H * 0.022; br.rotation.x = (kind === 'trucker' ? 0.03 : 0.14) * dir;
      if (back) {   // snapback strap, now at the front
        part(T, g, skullBand(T, M, yb, yb + H * 0.07, H * 0.026, yb), mat(T, { color: shade(T, col, 1.7), roughness: 0.7 }), null, 'strap');
        for (let i = 0; i < 5; i++) { const stud = part(T, g, new T.SphereGeometry(rx * 0.045, 8, 6), mat(T, { color: 0xdfe3ec, metalness: 0.9, roughness: 0.3 }), null, 'stud'); stud.position.set((i - 2) * rx * 0.13, H * 0.035, rx * 1.0); }
      }
      const btn = part(T, g, new T.SphereGeometry(rx * 0.08, 12, 10), cloth, null, 'button'); btn.position.y = (M.capY - yb) + rx * 0.62;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'beanie') {
      const yb = M.hatY(0.1), col = main(0xe23a4e);
      const knit = mat(T, { color: col, roughness: 0.96 });
      const rx = M.fit(yb, M.capY).rx;
      part(T, g, skullShell(T, M, yb, H * 0.04, { domeH: 0.9 }), knit, null, 'crown');
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI + i / 12 * Math.PI * 2;
        const rib = part(T, g, skullShell(T, M, yb, H * 0.052, { domeH: 0.9, arc: 0.1, arcStart: a, na: 3 }), mat(T, { color: shade(T, col, 0.78), roughness: 0.96 }), null, 'rib');
      }
      const cuff = part(T, g, skullBand(T, M, yb - H * 0.02, yb + H * 0.11, H * 0.055, yb), mat(T, { color: shade(T, col, 1.35).lerp(new T.Color(0xffffff), 0.45), roughness: 0.96 }), null, 'cuff');
      const pom = part(T, g, new T.SphereGeometry(rx * 0.3, 16, 12), mat(T, { color: shade(T, col, 1.35).lerp(new T.Color(0xffffff), 0.45), roughness: 1 }), null, 'pom');
      pom.position.y = (M.capY - yb) + rx * 0.82;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'bucket') {
      const yb = M.hatY(0.36), col = main(0x2f7a4a), rx = M.fit(yb, M.capY).rx, rz = M.fit(yb, M.capY).rz;
      const cloth = mat(T, { color: col, roughness: 0.9 });
      part(T, g, skullShell(T, M, yb, H * 0.022, { domeH: 0.55 }), cloth, null, 'crown');
      const brimM = new T.MeshStandardMaterial({ color: col, roughness: 0.9, side: T.DoubleSide });
      const br = part(T, g, new T.CylinderGeometry(rx * 1.02, rx * 1.62, H * 0.11, 44, 1, true), brimM, null, 'brim');
      br.scale.z = rz / rx; br.position.y = -H * 0.05;
      const lip = ellipseRing(T, g, cloth, rx * 1.6, rz * 1.6, rx * 0.06, 'lip'); lip.position.y = -H * 0.105;
      part(T, g, skullBand(T, M, yb + H * 0.04, yb + H * 0.13, H * 0.03, yb), mat(T, { color: shade(T, col, 0.55), roughness: 0.85 }), null, 'band');
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'cowboy') {
      const yb = M.hatY(0.46), f = line(yb), rx = f.rx * 1.05, rz = f.rz * 1.05, col = main(0x6b4526);
      const felt = mat(T, { color: col, roughness: 0.84 });
      const hc = (M.capY - yb) * 1.45 + H * 0.16;
      const pts = [[0.0, hc], [0.42, hc * 0.99], [0.7, hc * 0.9], [0.86, hc * 0.58], [0.97, hc * 0.22], [1.0, 0]];
      const crown = part(T, g, new T.LatheGeometry(pts.map(p => new T.Vector2(Math.max(p[0] * rx, 1e-4), p[1])), 40), felt, null, 'crown');
      crown.scale.z = rz / rx;
      const bp = [[0.35, 0.02], [0.8, -0.03], [1.25, -0.07], [1.62, -0.05], [1.74, 0.06], [1.72, 0.1], [1.58, 0.02], [1.2, -0.02], [0.78, 0.02], [0.35, 0.06]];
      const brimM = new T.MeshStandardMaterial({ color: col, roughness: 0.84, side: T.DoubleSide });
      const br = part(T, g, new T.LatheGeometry(bp.map(p => new T.Vector2(Math.max(p[0] * rx, 1e-4), p[1] * H * 2.2)), 48), brimM, null, 'brim');
      br.scale.z = (rz / rx) * 1.06;
      const band = ellipseRing(T, g, mat(T, { color: shade(T, col, 0.35), roughness: 0.7 }), rx * 1.02, rz * 1.02, rx * 0.13, 'band'); band.position.y = hc * 0.16;
      const buck = part(T, g, new T.BoxGeometry(rx * 0.3, rx * 0.22, rx * 0.08), gold, null, 'buckle'); buck.position.set(0, hc * 0.16, rz * 1.06);
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'tophat') {
      const yb = M.hatY(0.4), f = line(yb), rx = f.rx * 1.03, rz = f.rz * 1.03, col = main(0x0e0e13);
      const black = mat(T, { color: col, roughness: 0.42 });
      const br = part(T, g, arcPlate(T, rx * 0.99, rx * 1.62, 0, Math.PI * 2, H * 0.05), black, null, 'brim'); br.scale.z = rz / rx;
      const hollow = new T.MeshStandardMaterial({ color: col, roughness: 0.42, side: T.DoubleSide });
      const hgt = (M.capY - yb) + H * 1.05;
      const crown = part(T, g, new T.CylinderGeometry(rx * 0.99, rx * 1.03, hgt, 44, 1, true), hollow, null, 'crown'); crown.scale.z = rz / rx; crown.position.y = hgt / 2;
      const lid = part(T, g, new T.CylinderGeometry(rx * 0.99, rx * 0.99, H * 0.03, 44), black, null, 'lid'); lid.scale.z = rz / rx; lid.position.y = hgt;
      const band = part(T, g, new T.CylinderGeometry(rx * 1.05, rx * 1.05, H * 0.2, 44, 1, true), new T.MeshStandardMaterial({ color: custom ? shade(T, col, 0.4) : new T.Color(0xd22a42), roughness: 0.5, side: T.DoubleSide }), null, 'band');
      band.scale.z = rz / rx; band.position.y = H * 0.14;
      g.rotation.z = -0.1;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'crown') {
      // A British-style royal crown: jewelled gold band, ermine trim, a velvet cap, four dipped arches
      // meeting under a monde and cross pattee. Sized off the skull so it never floats or cuts in.
      const yb = M.hatY(0.66), f = M.fit(yb, M.capY), rx = f.rx * 1.0, rz = f.rz * 1.0;
      const bandH = Math.min(Math.max((M.capY - yb) * 0.5, H * 0.1), H * 0.17);
      const velvet = mat(T, { color: 0x6b0f2a, roughness: 0.95, metalness: 0 });
      const erm = mat(T, { color: 0xf6f4ef, roughness: 1 });
      const gem1 = mat(T, { color: 0xd4143c, roughness: 0.06, metalness: 0.25, emissive: 0x4a0010, emissiveIntensity: 0.6 });
      const gem2 = mat(T, { color: 0x1f4fd8, roughness: 0.06, metalness: 0.25, emissive: 0x001a4a, emissiveIntensity: 0.6 });
      const pearl = mat(T, { color: 0xfdfcf8, roughness: 0.18, metalness: 0.1 });
      // velvet cap inside
      part(T, g, skullShell(T, M, yb + bandH * 0.1, H * 0.03, { domeH: 0.95, org: yb }), velvet, null, 'velvet');
      // ermine trim + gold band
      part(T, g, skullBand(T, M, yb - H * 0.02, yb + bandH * 0.3, H * 0.055, yb), erm, null, 'ermine');
      for (let i = 0; i < 10; i++) { const fl = part(T, g, new T.BoxGeometry(rx * 0.07, rx * 0.11, rx * 0.04), mat(T, { color: 0x14141a, roughness: 0.9 }), null, 'ermine'); const a = i / 10 * Math.PI * 2; fl.position.set(Math.sin(a) * rx * 1.05, bandH * 0.1, Math.cos(a) * rz * 1.05); fl.lookAt(0, bandH * 0.1, 0); }
      const bandM = new T.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.16, envMapIntensity: 2.0, side: T.DoubleSide });
      part(T, g, skullBand(T, M, yb + bandH * 0.3, yb + bandH * 1.05, H * 0.05, yb), bandM, null, 'band');
      // jewelled course on the band
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, R = Math.max(M.P.rad(yb + bandH * 0.68, a), rx * 0.6) + H * 0.055;
        const big = i % 3 === 0;
        const gm = part(T, g, big ? new T.OctahedronGeometry(rx * 0.085, 0) : new T.SphereGeometry(rx * 0.042, 12, 10), big ? (i % 2 ? gem1 : gem2) : pearl, null, 'gem');
        gm.position.set(Math.sin(a) * R * 1.02, bandH * 0.68, Math.cos(a) * R * 1.02);
        if (big) gm.scale.set(1, 1.25, 0.6);
      }
      // four cross-pattee / fleur uprights, then the arches
      const top = bandH * 1.05, archH = Math.max((M.capY - yb) * 0.7, H * 0.16) + H * 0.1;
      const goldM = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.16, envMapIntensity: 2.0 });
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, R = Math.max(M.P.rad(yb + bandH, a), rx * 0.6) + H * 0.05;
        const x = Math.sin(a) * R, z = Math.cos(a) * R;
        if (k % 2 === 0) {   // cross pattee
          const v = part(T, g, new T.BoxGeometry(rx * 0.055, rx * 0.2, rx * 0.045), goldM, null, 'cross'); v.position.set(x, top + rx * 0.1, z); v.lookAt(0, top + rx * 0.1, 0); v.rotateY(Math.PI);
          const h2 = part(T, g, new T.BoxGeometry(rx * 0.15, rx * 0.06, rx * 0.045), goldM, null, 'cross'); h2.position.set(x, top + rx * 0.11, z); h2.lookAt(0, top + rx * 0.11, 0); h2.rotateY(Math.PI);
        } else {             // fleur-de-lis, three petals
          for (const t2 of [-1, 0, 1]) {
            const p = part(T, g, new T.ConeGeometry(rx * 0.038, rx * 0.19, 6), goldM, null, 'fleur');
            p.position.set(x, top + rx * 0.1, z);
            p.lookAt(0, top, 0); p.rotateX(-Math.PI / 2); p.rotateZ(t2 * 0.7); p.translateY(rx * 0.045);
          }
        }
        if (k % 2 === 0) {   // an arch springs from every cross
          const p0 = new T.Vector3(x, top + rx * 0.3, z);
          const p1 = new T.Vector3(x * 0.86, top + archH * 0.72, z * 0.86);
          const p2 = new T.Vector3(x * 0.34, top + archH * 0.8, z * 0.34);
          const p3 = new T.Vector3(0, top + archH * 0.97, 0);
          const curve = new T.CatmullRomCurve3([p0, p1, p2, p3]);
          part(T, g, new T.TubeGeometry(curve, 18, rx * 0.038, 8, false), goldM, null, 'arch');
          for (let q = 1; q <= 4; q++) { const pr = part(T, g, new T.SphereGeometry(rx * 0.032, 10, 8), pearl, null, 'pearl'); pr.position.copy(curve.getPoint(q / 5)); }
        }
      }
      const monde = part(T, g, new T.SphereGeometry(rx * 0.15, 20, 14), goldM, null, 'monde'); monde.position.y = top + archH * 1.04;
      for (const rot of [0, Math.PI / 2]) { const bandR = part(T, g, new T.TorusGeometry(rx * 0.155, rx * 0.018, 8, 28), goldM, null, 'monde'); bandR.position.y = top + archH * 1.04; bandR.rotation.y = rot; }
      const cv = part(T, g, new T.BoxGeometry(rx * 0.045, rx * 0.2, rx * 0.045), goldM, null, 'cross'); cv.position.y = top + archH * 1.22;
      const ch2 = part(T, g, new T.BoxGeometry(rx * 0.15, rx * 0.05, rx * 0.045), goldM, null, 'cross'); ch2.position.y = top + archH * 1.22;
      const tip = part(T, g, new T.OctahedronGeometry(rx * 0.045, 0), gem1, null, 'gem'); tip.position.y = top + archH * 1.22;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'kabuto') {
      const yb = M.hatY(0.3), f = line(yb), rx = f.rx * 1.07, rz = f.rz * 1.07, col = main(0x232733);
      const iron = mat(T, { color: col, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.3 });
      part(T, g, skullShell(T, M, yb, H * 0.03, { domeH: 0.8 }), iron, null, 'crown');
      for (let i = 0; i < 7; i++) {
        const a = (i - 3) / 7 * Math.PI * 1.1;
        part(T, g, skullShell(T, M, yb, H * 0.042, { domeH: 0.8, arc: 0.08, arcStart: a, na: 3 }), gold, null, 'rib');
      }
      for (let k = 0; k < 4; k++) {
        const rr = 1 + k * 0.22, sh = part(T, g, new T.CylinderGeometry(rx * rr, rx * (rr + 0.26), H * 0.15, 34, 1, true, Math.PI * 0.32, Math.PI * 1.36), iron, null, 'shikoro');
        sh.material = new T.MeshStandardMaterial({ color: k % 2 ? shade(T, col, 1.2) : col, metalness: 0.8, roughness: 0.4, side: T.DoubleSide });
        sh.scale.z = rz / rx; sh.position.y = -H * 0.06 - k * H * 0.11;
      }
      const cres = part(T, g, new T.TorusGeometry(rx * 0.72, rx * 0.11, 10, 28, Math.PI), gold, null, 'maedate');
      cres.position.set(0, (M.capY - yb) * 0.5 + H * 0.1, rz * 0.86); cres.rotation.set(0.3, 0, 0);
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'ninja' || kind === 'band') {
      // a real kung-fu headband: around the FOREHEAD, above the brow and below the crown, knot and tails at the back
      // the forehead: above the brow, well below the crown. Never the chin -- y is anchored on the eye line.
      const y0 = M.hatY(kind === 'ninja' ? 0.26 : 0.24), y1 = M.hatY(kind === 'ninja' ? 0.62 : 0.54);
      const col = custom || new T.Color(kind === 'ninja' ? 0xf4f5f8 : 0xf2f3f7);
      const cloth = mat(T, { color: col, roughness: 0.88 });
      part(T, g, skullBand(T, M, y0, y1, H * 0.016), cloth, null, 'band');
      const ymid = (y0 + y1) / 2, rF = Math.max(M.P.rad(ymid, 0), M.hw * 0.5), rB = Math.max(M.P.rad(ymid, Math.PI), M.hw * 0.5), rx = M.fit(y0, y1).rx;
      // the fold lines that make cloth read as cloth
      part(T, g, skullBand(T, M, y0 + (y1 - y0) * 0.34, y0 + (y1 - y0) * 0.42, H * 0.022, y0), mat(T, { color: shade(T, col, 0.86), roughness: 0.9 }), null, 'fold');
      if (kind === 'ninja') {
        const plate = part(T, g, new T.CylinderGeometry(rx * 0.34, rx * 0.34, H * 0.022, 26), mat(T, { color: 0xb9c0cc, metalness: 0.95, roughness: 0.28, envMapIntensity: 1.6 }), null, 'plate');
        plate.rotation.x = Math.PI / 2; plate.scale.set(1, 1, 0.62); plate.position.set(0, ymid - y0, rF * 1.02);
        const mark = part(T, g, new T.TorusGeometry(rx * 0.17, rx * 0.032, 6, 22), mat(T, { color: 0xd22a42, roughness: 0.6 }), null, 'mark'); mark.position.set(0, ymid - y0, rF * 1.05);
      }
      // knot: two crossed lobes at the back, then the tails
      for (const s2 of [-1, 1]) {
        const lobe = part(T, g, new T.SphereGeometry(rx * 0.15, 12, 10), cloth, null, 'knot');
        lobe.position.set(s2 * rx * 0.1, ymid - y0 + rx * 0.05, -rB * 1.06); lobe.scale.set(1.1, 0.75, 0.8); lobe.rotation.z = s2 * 0.5;
      }
      const cinch = part(T, g, new T.CylinderGeometry(rx * 0.07, rx * 0.07, rx * 0.2, 10), mat(T, { color: shade(T, col, 0.88), roughness: 0.9 }), null, 'knot');
      cinch.rotation.z = Math.PI / 2; cinch.position.set(0, ymid - y0, -rB * 1.06);
      for (const s2 of [-1, 1]) {
        const L = H * (kind === 'ninja' ? 0.95 : 0.55);
        const tail = part(T, g, new T.BoxGeometry(rx * 0.17, L, rx * 0.025), cloth, null, 'tail');
        tail.position.set(s2 * rx * 0.16, ymid - y0 - L * 0.48, -rB * 1.16); tail.rotation.set(-0.2, 0, s2 * 0.22);
        const tip = part(T, g, new T.BoxGeometry(rx * 0.17, L * 0.2, rx * 0.025), mat(T, { color: shade(T, col, 0.8), roughness: 0.9 }), null, 'tail');
        tip.position.set(s2 * rx * 0.2, ymid - y0 - L * 0.98, -rB * 1.2); tip.rotation.set(-0.3, 0, s2 * 0.3);
      }
      mount(M, 'head', g, 0, y0, 0);
    } else if (kind === 'bandana') {
      const yb = M.hatY(0.3), col = main(0xd22a42), rx = M.fit(yb, M.capY).rx;
      const cloth = mat(T, { color: col, roughness: 0.92 });
      part(T, g, skullShell(T, M, yb, H * 0.02, { domeH: 0.55 }), cloth, null, 'crown');
      for (let i = 0; i < 6; i++) { const a = -Math.PI * 0.8 + i / 6 * Math.PI * 1.6; part(T, g, skullShell(T, M, yb, H * 0.028, { domeH: 0.55, arc: 0.08, arcStart: a, na: 3 }), mat(T, { color: shade(T, col, 0.8), roughness: 0.92 }), null, 'fold'); }
      part(T, g, skullBand(T, M, yb - H * 0.01, yb + H * 0.06, H * 0.03, yb), cloth, null, 'rim');
      const rB = Math.max(M.P.rad(yb + H * 0.04, Math.PI), rx * 0.6);
      const knot = part(T, g, new T.SphereGeometry(rx * 0.2, 12, 10), cloth, null, 'knot'); knot.position.set(-rx * 0.34, H * 0.03, -rB * 0.98); knot.scale.set(1, 0.85, 0.9);
      for (const k of [0, 1]) {
        const tail = part(T, g, new T.BoxGeometry(rx * 0.2, H * 0.5, rx * 0.035), cloth, null, 'tail');
        tail.position.set(-rx * (0.46 + k * 0.1), -H * 0.2, -rB * (1.0 + k * 0.08)); tail.rotation.set(-0.2, 0, 0.35 + k * 0.2);
      }
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'halo') {
      const r = M.hw * 0.9;
      const gm = glowMat(T, custom ? '#' + custom.getHexString() : 0xffd36a, 3.2, { metalness: 0.4 });
      const ring = part(T, g, new T.TorusGeometry(r, r * 0.085, 12, 48), gm.m, gm.want, 'ring'); ring.rotation.x = Math.PI / 2;
      mount(M, 'head', g, 0, M.capY + H * 0.3, 0);
    } else if (kind === 'horns') {
      // Devil horns: rooted INTO the skull (the base sits 12% inside the surface), thick at the base,
      // curving up and back, ridged, dark red-black through to a glossy tip.
      const base = custom || new T.Color(0x1a0409);
      const yRoot = M.hatY(0.66);
      for (const sx of [-1, 1]) {
        const a = sx * 0.95;                                    // ~55 degrees off the front, over the temples
        const rr = Math.max(M.P.rad(yRoot, a), M.hw * 0.5);
        const ox = Math.sin(a) * rr * 0.88, oz = Math.cos(a) * rr * 0.88;
        const L = M.H * 0.92, segs = 9;
        const outDir = new T.Vector3(Math.sin(a), 0, Math.cos(a)).normalize();
        const pts = [];
        for (let k = 0; k <= segs; k++) {
          const t = k / segs;
          const up = L * (0.18 + t * 0.95);
          const out = L * (0.24 * Math.sin(t * 1.5)) - L * 0.05 * t;
          const backAmt = -L * 0.42 * t * t;
          pts.push(new T.Vector3(ox + outDir.x * out + 0, yRoot - M.hatY(0.66) + up * 0.0 + up, oz + outDir.z * out + backAmt));
        }
        const curve = new T.CatmullRomCurve3(pts);
        for (let k = 0; k < segs; k++) {
          const t = k / segs, t2 = (k + 1) / segs;
          const p = curve.getPoint(t), q = curve.getPoint(t2);
          const r0 = L * 0.26 * Math.pow(1 - t, 0.85) + L * 0.012, r1 = L * 0.26 * Math.pow(1 - t2, 0.85) + L * 0.012;
          const col = new T.Color(base).lerp(new T.Color(0x6e0d1c), t * 0.8);
          const m = mat(T, { color: col, roughness: 0.62 - t * 0.5, metalness: 0.12 + t * 0.2, envMapIntensity: 1.2 });
          const d = new T.Vector3().subVectors(q, p);
          const seg = part(T, g, new T.CylinderGeometry(Math.max(r1, 1e-4), Math.max(r0, 1e-4), d.length() * 1.04, 14), m, null, 'horn');
          seg.position.copy(p).addScaledVector(d, 0.5);
          seg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
          if (k < segs - 2) {   // ridge ring
            const ring = part(T, g, new T.TorusGeometry(r0 * 1.06, r0 * 0.16, 6, 16), mat(T, { color: shade(T, col, 0.6), roughness: 0.5 }), null, 'ridge');
            ring.position.copy(p); ring.quaternion.copy(seg.quaternion); ring.rotateX(Math.PI / 2);
          }
        }
        const tipP = curve.getPoint(1), tipD = new T.Vector3().subVectors(curve.getPoint(1), curve.getPoint(0.93)).normalize();
        const tip = part(T, g, new T.ConeGeometry(L * 0.032, L * 0.18, 12), mat(T, { color: 0x2b0409, roughness: 0.06, metalness: 0.45, envMapIntensity: 1.9 }), null, 'horn');
        tip.position.copy(tipP).addScaledVector(tipD, L * 0.07);
        tip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), tipD);
      }
      mount(M, 'head', g, 0, yRoot, 0);
    }
  }

  // ---------------------------------------------------------------- glasses
  // The temple arms. They used to run out to `M.sideW` -- the head's WIDEST half-width, measured over
  // the whole skull -- and then back past `-M.sideD`. On any head that is narrower at the eye line
  // than at its widest point (a snout, a muzzle, a tapered jaw) that put the arm outside the
  // silhouette, so instead of disappearing behind the head it hung in the air as a thin bright line
  // with a visible end. That is what reads as "glitchy, the graphic is half missing".
  //
  // Now they stay on the lens line (x0, which is derived from the eye width) and run BACK, which is
  // where a real temple arm goes -- so the head itself occludes almost all of it. Slightly thicker
  // too: at the old radius they rendered as a wire rather than a part of the glasses.
  function eyeArms(T, M, g, x0, z0, m, r, tag) {
    const V3v = (a, b, c) => new T.Vector3(a, b, c);
    const xw = Math.min(x0, M.sideW * 0.98);          // never outside the head at this height
    const back = Math.max(M.sideD * 0.85, M.H * 0.18);
    const rr = r * 1.45;
    for (const sx of [-1, 1]) {
      const a = V3v(sx * x0, 0, z0);
      const b = V3v(sx * xw, M.H * 0.01, z0 - back * 0.45);
      const c = V3v(sx * xw * 0.94, -M.H * 0.035, z0 - back);
      strut(T, g, a, b, rr, m, tag || 'arm', 6);
      strut(T, g, b, c, rr, m, tag || 'arm', 6);
    }
  }
  function buildEyes(T, M, kind) {
    const g = gearGroup(T, 'eyes'), H = M.H, w = M.ew;
    const cl = H * 0.014 + (M.hairOn ? H * 0.02 : 0);          // hair worn: stand the glasses off it, never inside it
    const ex = w * 0.46, lw = w * 0.36, lh = w * 0.25;
    const zAt = x => Math.max(M.faceZAt(x, M.eyeY), M.fz * 0.72) + cl;
    const zAvg = () => (zAt(ex) + zAt(-ex) + zAt(0)) / 3;
    const darkGlass = m => Object.assign({ roughness: 0.06, metalness: 0.35, envMapIntensity: 1.6 }, m || {});

    if (kind === 'rayban') {
      const frame = mat(T, { color: 0x14141a, roughness: 0.3, metalness: 0.12, envMapIntensity: 1.1 });
      const glass = mat(T, darkGlass({ color: 0x0a1018, transparent: true, opacity: 0.86 }));
      const t = lw * 0.26, th = w * 0.09;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const rim = part(T, g, ringPlate(T, lw * 2, lh * 2, lh * 0.55, t, th), frame, null, 'rim');
        rim.position.set(sx * ex, 0, z); rim.rotation.y = -sx * 0.16;
        const lens = part(T, g, slab(T, lw * 2 - t * 1.6, lh * 2 - t * 1.6, lh * 0.4, th * 0.4), glass, { opacity: 0.86 }, 'lens');
        lens.position.set(sx * ex, 0, z - th * 0.1); lens.rotation.y = -sx * 0.16; lens.castShadow = false;
      }
      const bz = zAt(0);
      const br = part(T, g, new T.BoxGeometry(Math.max(ex * 2 - lw * 1.7, w * 0.08), lh * 0.5, th * 0.8), frame, null, 'bridge'); br.position.set(0, lh * 0.5, bz);
      const bar = part(T, g, new T.BoxGeometry(ex * 2 + lw * 1.6, th * 0.9, th * 0.7), frame, null, 'browbar'); bar.position.set(0, lh * 0.94, bz - th * 0.1);
      eyeArms(T, M, g, ex + lw * 0.92, zAt(ex + lw * 0.8), frame, th * 0.28);
    } else if (kind === 'aviator') {
      const gold = mat(T, { color: 0xe8c463, metalness: 1, roughness: 0.2, envMapIntensity: 1.8 });
      const glass = mat(T, darkGlass({ color: 0x2a1c10, transparent: true, opacity: 0.68 }));
      const alw = w * 0.38, alh = w * 0.3;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const rim = part(T, g, new T.TorusGeometry(1, w * 0.028, 10, 40), gold, null, 'rim');
        rim.scale.set(alw, alh, 1); rim.position.set(sx * ex, -alh * 0.12, z); rim.rotation.set(0, -sx * 0.18, sx * 0.1);
        const lens = part(T, g, new T.CircleGeometry(1, 34), glass, { opacity: 0.68 }, 'lens');
        lens.scale.set(alw * 0.99, alh * 0.99, 1); lens.position.set(sx * ex, -alh * 0.12, z - w * 0.006); lens.rotation.set(0, -sx * 0.18, sx * 0.1); lens.castShadow = false;
      }
      const bz = zAt(0);
      for (const dy of [0.18, 0.4]) { const b = part(T, g, new T.CylinderGeometry(w * 0.02, w * 0.02, Math.max(ex * 2 - alw * 1.8, w * 0.06), 8), gold, null, 'bridge'); b.rotation.z = Math.PI / 2; b.position.set(0, alh * dy, bz); }
      const bar = part(T, g, new T.CylinderGeometry(w * 0.022, w * 0.022, ex * 2 + alw * 1.5, 8), gold, null, 'browbar'); bar.rotation.z = Math.PI / 2; bar.position.set(0, alh * 0.66, bz - w * 0.01);
      eyeArms(T, M, g, ex + alw * 0.9, zAt(ex + alw * 0.8), gold, w * 0.022);
    } else if (kind === 'mafia') {
      const frame = mat(T, { color: 0x101014, roughness: 0.25, metalness: 0.5, envMapIntensity: 1.4 });
      const glass = mat(T, darkGlass({ color: 0x05070a, transparent: true, opacity: 0.94 }));
      const mlw = w * 0.42, mlh = w * 0.13, th = w * 0.045;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const rim = part(T, g, ringPlate(T, mlw * 2, mlh * 2, mlh * 0.7, th * 1.1, th * 0.9), frame, null, 'rim');
        rim.position.set(sx * ex * 0.98, mlh * 0.1, z); rim.rotation.set(0.05, -sx * 0.3, sx * 0.06);
        const lens = part(T, g, slab(T, mlw * 2 - th, mlh * 2 - th, mlh * 0.6, th * 0.4), glass, { opacity: 0.94 }, 'lens');
        lens.position.set(sx * ex * 0.98, mlh * 0.1, z - th * 0.2); lens.rotation.set(0.05, -sx * 0.3, sx * 0.06); lens.castShadow = false;
      }
      const br = part(T, g, new T.BoxGeometry(Math.max(ex * 2 - mlw * 1.85, w * 0.05), th * 1.1, th * 0.9), frame, null, 'bridge'); br.position.set(0, mlh * 0.35, zAt(0));
      eyeArms(T, M, g, ex * 0.98 + mlw * 0.95, zAt(ex + mlw * 0.8), frame, th * 0.3);
    } else if (kind === 'shutter') {
      const frame = mat(T, { color: 0xe8203c, roughness: 0.35, metalness: 0.2 });
      const plw = w * 0.88, plh = w * 0.27, th = w * 0.06, z = zAvg() + w * 0.012;
      const rim = part(T, g, ringPlate(T, plw * 2, plh * 2, plh * 0.32, w * 0.09, th), frame, null, 'rim'); rim.position.set(0, 0, z);
      for (let i = 0; i < 6; i++) {
        const sl = part(T, g, new T.BoxGeometry(plw * 1.86, plh * 0.14, th * 0.85), frame, null, 'slat');
        sl.position.set(0, plh * (0.72 - i * 0.29), z); sl.rotation.x = -0.22;
      }
      const back = part(T, g, slab(T, plw * 1.9, plh * 1.9, plh * 0.3, th * 0.3), mat(T, { color: 0x08080c, roughness: 0.5 }), null, 'backing'); back.position.set(0, 0, z - th * 0.55); back.castShadow = false;
      eyeArms(T, M, g, plw * 0.96, z - w * 0.02, frame, w * 0.026);
    } else if (kind === 'goggles') {
      const rubber = mat(T, { color: 0x14161d, roughness: 0.9 });
      const strapM = mat(T, { color: 0xe8203c, roughness: 0.8 });
      // was w*0.92 x w*0.34 with the strap standing off the head at sideW*1.03: on the preview that
      // covered most of the face and the strap's two ends hung outside the silhouette as red stubs.
      // Sized to the eye band like every other pair here, and the strap hugs the skull so the head
      // occludes all of it but the sides, which is where a strap is actually visible.
      const glw = w * 0.66, glh = w * 0.25, th = w * 0.09, z = zAvg();
      const foam = part(T, g, ringPlate(T, glw * 2, glh * 2, glh * 0.72, w * 0.13, th), rubber, null, 'frame'); foam.position.set(0, 0, z + th * 0.3);
      const lm = glowMat(T, 0x27e1ff, 0.35, { color: 0x101820, metalness: 0.95, roughness: 0.06, envMapIntensity: 2.0, transparent: true, opacity: 0.9, side: T.DoubleSide });
      const R = glw * 1.25;
      const lens = part(T, g, new T.CylinderGeometry(R, R, glh * 1.75, 44, 1, true, -Math.PI * 0.3, Math.PI * 0.6), lm.m, lm.want, 'lens');
      lens.position.set(0, 0, z + th * 0.25 - R); lens.castShadow = false;
      const band = ellipseRing(T, g, strapM, M.sideW * 0.99, M.sideD * 0.99, w * 0.07, 'strap');
      const buck = part(T, g, new T.BoxGeometry(w * 0.13, w * 0.10, w * 0.05), rubber, null, 'buckle'); buck.position.set(M.sideW * 0.93, 0, -M.sideD * 0.25);
      mount(M, 'head', g, 0, M.eyeY, 0); return;
    } else if (kind === 'round' || kind === 'monocle') {
      const gold = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.22, envMapIntensity: 1.8 });
      const glass = mat(T, { color: 0xbfe8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25 });
      const rr = w * 0.26, sides = kind === 'monocle' ? [1] : [-1, 1];
      for (const sx of sides) {
        const z = zAt(sx * ex);
        const ring = part(T, g, new T.TorusGeometry(rr, w * 0.035, 10, 34), gold, null, 'rim'); ring.position.set(sx * ex, 0, z); ring.rotation.y = -sx * 0.14;
        const lens = part(T, g, new T.CircleGeometry(rr * 0.98, 30), glass, { opacity: 0.25 }, 'lens'); lens.position.set(sx * ex, 0, z - w * 0.008); lens.rotation.y = -sx * 0.14; lens.castShadow = false;
      }
      if (kind === 'round') {
        const br = part(T, g, new T.CylinderGeometry(w * 0.022, w * 0.022, Math.max(ex * 2 - rr * 2, w * 0.05), 8), gold, null, 'bridge'); br.rotation.z = Math.PI / 2; br.position.set(0, 0, zAt(0));
        eyeArms(T, M, g, ex + rr, zAt(ex + rr * 0.8), gold, w * 0.02);
      } else {
        const ch = part(T, g, new T.CylinderGeometry(w * 0.013, w * 0.013, H * 0.75, 6), gold, null, 'chain'); ch.position.set(ex + rr * 0.6, -H * 0.4, zAt(ex) - w * 0.05); ch.rotation.z = 0.22;
      }
    } else if (kind === 'shades') {
      const black = mat(T, { color: 0x050507, roughness: 0.3, metalness: 0.3 }), white = mat(T, { color: 0xffffff, roughness: 0.4 });
      const px = w * 0.1, t = px * 0.95, z = zAvg();
      const bar = part(T, g, new T.BoxGeometry(w * 1.9, px, t), black, null, 'browbar'); bar.position.set(0, px, z);
      for (const sx of [-1, 1]) {
        const a = part(T, g, new T.BoxGeometry(px * 5, px, t), black, null, 'lens'); a.position.set(sx * ex * 1.1, 0, z);
        const b = part(T, g, new T.BoxGeometry(px * 3, px, t), black, null, 'lens'); b.position.set(sx * ex * 1.1, -px, z);
        const hi = part(T, g, new T.BoxGeometry(px * 0.9, px * 0.9, t * 0.35), white, null, 'glint'); hi.position.set(sx * ex * 1.1 - px * 1.4, px * 0.05, z + t * 0.6);
      }
      eyeArms(T, M, g, w * 0.95, z, black, px * 0.3);
    } else if (kind === 'visor') {
      const R = M.sideW * 1.1;
      const vm = glowMat(T, 0x27e1ff, 1.2, { opacity: 0.6, transparent: true, metalness: 0.6, roughness: 0.1, side: T.DoubleSide });
      const z = zAvg() + w * 0.02;
      const v = part(T, g, new T.CylinderGeometry(R, R, w * 0.42, 40, 1, true, -Math.PI * 0.42, Math.PI * 0.84), vm.m, vm.want, 'lens');
      v.position.z = z - R; v.castShadow = false;
      const rim = part(T, g, new T.TorusGeometry(R, w * 0.03, 8, 44, Math.PI * 0.84), mat(T, { color: 0xdfe3ec, metalness: 1, roughness: 0.25 }), null, 'rim');
      rim.rotation.set(Math.PI / 2, 0, Math.PI * 0.08); rim.position.set(0, w * 0.2, z - R);
    } else if (kind === 'laser') {
      const L = M.S * 0.9;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const core = glowMat(T, 0xff1020, 3);
        const eye = part(T, g, new T.SphereGeometry(w * 0.11, 14, 10), core.m, core.want, 'eye'); eye.position.set(sx * ex, 0, z);
        const bm = glowMat(T, 0xff0818, 2.2, { opacity: 0.85, transparent: true, depthWrite: false });
        const beam = part(T, g, new T.CylinderGeometry(w * 0.025, w * 0.075, L, 10, 1, true), bm.m, bm.want, 'beam');
        beam.rotation.x = Math.PI / 2; beam.position.set(sx * ex, 0, z + L / 2); beam.castShadow = false;
      }
    } else return;
    mount(M, 'head', g, 0, M.eyeY, 0);
  }

  // ---------------------------------------------------------------- hair
  function buildHair(T, M, kind, colKey) {
    const g = gearGroup(T, 'hair'), H = M.H;
    const col = hexCol(T, HAIRCOL, colKey, '#191320');
    const hairM = mat(T, { color: col, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.8 });
    const darkM = mat(T, { color: shade(T, col, 0.66), roughness: 0.7 });
    const yb = M.hatY(0.46);                                  // above the ears and clear of the eye line
    const hf = M.fit(yb, M.capY), rx = hf.rx, rz = hf.rz;
    const h = Math.max(M.capY - yb, H * 0.12);
    const cap = (pad, domeH, m) => part(T, g, skullShell(T, M, yb, pad, { domeH: domeH == null ? 0.66 : domeH }), m || hairM, null, 'cap');

    if (kind === 'buzz') {
      cap(H * 0.012, 0.62);
      for (let i = 0; i < 14; i++) { const n = part(T, g, new T.SphereGeometry(rx * 0.1, 8, 6), darkM, null, 'tuft'); const a = i / 14 * Math.PI * 2, t = 0.35 + (i % 3) * 0.16; n.position.set(Math.sin(a) * rx * Math.sin(t) * 1.0, Math.cos(t) * h * 1.02 + h * 0.1, Math.cos(a) * rz * Math.sin(t) * 1.0); n.scale.set(1, 0.5, 1); }
    } else if (kind === 'afro') {
      cap(H * 0.012, 0.62);
      const R = Math.max(rx, rz) * 1.42, n = 30;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, ang = i * 2.399963;
        const y = 1 - t * 1.55, rr = Math.sqrt(Math.max(0, 1 - y * y));
        if (y < -0.42) continue;
        if (Math.sin(ang) * rr > 0.15 && y < 0.14) continue;   // never hang a puff in front of the eyes
        const b = part(T, g, new T.IcosahedronGeometry(R * (0.3 + (i % 3) * 0.045), 1), i % 4 ? hairM : darkM, null, 'puff');
        b.position.set(Math.cos(ang) * rr * R * 1.02, y * R * 0.96 + h * 0.4, Math.sin(ang) * rr * R * (rz / rx) * 1.02);
        b.scale.setScalar(1 + ((i * 7) % 5) * 0.045);
      }
    } else if (kind === 'dreads') {
      cap(H * 0.012, 0.62);
      const N = 16, len = H * 1.35;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + 0.2, tilt = 0.62 + ((i * 5) % 3) * 0.12;
        if (Math.cos(a) > 0.42) continue;                      // locs fall at the sides and back, never over the face
        const sx = Math.sin(a) * Math.sin(tilt), sz = Math.cos(a) * Math.sin(tilt), sy = Math.cos(tilt);
        const p0 = new T.Vector3(sx * rx * 1.02, h * sy * 1.02 + h * 0.2, sz * rz * 1.02);
        const out = new T.Vector3(sx, 0, sz).normalize().multiplyScalar(rx * 0.3);
        const drop = len * (0.78 + ((i * 3) % 4) * 0.13);
        const pts = [p0,
          p0.clone().add(out.clone().multiplyScalar(0.7)).add(new T.Vector3(0, -drop * 0.22, 0)),
          p0.clone().add(out.clone().multiplyScalar(1.05)).add(new T.Vector3(0, -drop * 0.58, 0)),
          p0.clone().add(out.clone().multiplyScalar(0.92)).add(new T.Vector3(0, -drop, 0))];
        const curve = new T.CatmullRomCurve3(pts);
        part(T, g, new T.TubeGeometry(curve, 12, rx * 0.085, 7, false), i % 3 ? hairM : darkM, null, 'loc');
        const tip = part(T, g, new T.SphereGeometry(rx * 0.085, 8, 6), hairM, null, 'loc'); tip.position.copy(pts[3]);
        if (i % 4 === 0) { const bead = part(T, g, new T.TorusGeometry(rx * 0.1, rx * 0.028, 6, 14), mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.28 }), null, 'bead'); bead.position.copy(curve.getPoint(0.72)); bead.rotation.x = Math.PI / 2; }
      }
    } else if (kind === 'long') {
      cap(H * 0.014, 0.66);
      const len = H * 1.7, R = Math.max(rx, rz) * 1.06;
      const curtainM = new T.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.05, side: T.DoubleSide });
      const cur = part(T, g, new T.CylinderGeometry(R * 1.0, R * 1.16, len, 40, 1, true, Math.PI * 0.26, Math.PI * 1.48), curtainM, null, 'curtain');
      cur.scale.z = rz / rx; cur.position.set(0, -len / 2 + h * 0.5, 0);
      for (let i = 0; i < 10; i++) { const st = part(T, g, new T.BoxGeometry(rx * 0.1, len * 0.96, rx * 0.05), darkM, null, 'strand'); const a = Math.PI * 0.3 + (i / 9) * Math.PI * 1.4; st.position.set(Math.sin(a) * R * 1.05, -len * 0.48 + h * 0.5, Math.cos(a) * R * 1.05 * (rz / rx)); st.rotation.y = a; }
      for (const sx of [-1, 1]) { const fr = part(T, g, new T.BoxGeometry(rx * 0.2, H * 0.95, rz * 0.34), hairM, null, 'front'); fr.position.set(sx * rx * 1.0, -H * 0.3, rz * 0.3); fr.rotation.set(0, -sx * 0.4, sx * 0.05); }
    } else if (kind === 'pony') {
      cap(H * 0.014, 0.66);
      const rB = Math.max(M.P.rad(M.capY - h * 0.3, Math.PI), rz * 0.7);
      const tie = part(T, g, new T.TorusGeometry(rx * 0.26, rx * 0.07, 8, 20), mat(T, { color: 0x1a1a22, roughness: 0.8 }), null, 'tie'); tie.position.set(0, h * 0.62, -rB * 0.94); tie.rotation.set(0.5, 0, 0);
      let p = new T.Vector3(0, h * 0.62, -rB * 0.98);
      const segs = 7, len = H * 1.5;
      for (let i = 0; i < segs; i++) {
        const t = i / segs, r0 = rx * 0.3 * (1 - t * 0.72), r1 = rx * 0.3 * (1 - (t + 1 / segs) * 0.72);
        const dir = new T.Vector3(0, -0.45 - t * 0.55, -0.9 + t * 0.55).normalize().multiplyScalar(len / segs);
        const seg = part(T, g, new T.CylinderGeometry(Math.max(r1, 1e-4), Math.max(r0, 1e-4), dir.length() * 1.06, 10), i % 2 ? hairM : darkM, null, 'tail');
        seg.position.copy(p).addScaledVector(dir, 0.5);
        seg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
        p = p.clone().add(dir);
      }
    } else if (kind === 'mohawk') {
      cap(H * 0.01, 0.6, darkM);
      const N = 11;
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N, ang = (t - 0.5) * Math.PI * 1.15;
        const z = Math.sin(ang) * rz * 1.0, y = Math.cos(ang) * h * 1.0 + h * 0.3;
        const hgt = H * (0.36 + 0.34 * Math.sin(t * Math.PI));
        const fin = part(T, g, new T.ConeGeometry(rx * 0.13, hgt, 8), hairM, null, 'spike');
        fin.position.set(0, y + hgt * 0.4, z); fin.rotation.x = -ang * 0.45;
        fin.scale.z = 1.9;
      }
    } else return;
    mount(M, 'head', g, 0, yb, 0);
  }

  // ---------------------------------------------------------------- neck
  // NOTE: everything here is in NECK-bone units. M.H is head-bone units and must not appear -- every bone on
  // this rig carries its own scale, and mixing the two is what dropped the bow tie onto the chest.
  function buildNeck(T, M, kind) {
    const g = gearGroup(T, 'neck'), H = M.nH;
    const ringY = M.nl * 0.24, tieY = M.nl * 0.55;
    // SIZE THE COLLAR WHERE IT ACTUALLY SITS. `M.nw`/`M.nd` are measured at MID neck (see the
    // measure block: `Math.abs(p.y - nl * 0.5) > nl * 0.32` skips everything else), but the ring
    // hangs at nl * 0.24 -- down at the base, where the neck is already flaring into the shoulders.
    // A ring sized for the narrow part and hung on the wide part ends up INSIDE the body, which is
    // what dev/gearcheck reported on 85 of 184 neck checks: "collar inside the neck", "clipping into
    // the body". Ask the neck profile how wide the body is at the ring's own height instead.
    const pw = (M.NP && M.NP.w(ringY)) || 0, pd = (M.NP && M.NP.d(ringY)) || 0;
    const rx = Math.max(M.nw, pw * 0.5) * 1.10, rz = Math.max(M.nd, pd * 0.5) * 1.10;
    const sag = Math.min(M.nl * 0.5, H * 0.16);
    const front = Math.max(M.NP.f(ringY), rz) * 1.02;
    // the closed path a necklace follows: round the neck, dipping at the front under its own weight
    const path = (a, lift) => {
      const s = Math.max(0, Math.cos(a));
      return new T.Vector3(Math.sin(a) * rx, ringY - sag * s * s + (lift || 0), Math.cos(a) * rz * (1 + 0.1 * s));
    };
    if (kind === 'gold' || kind === 'ice') {
      const ice = kind === 'ice';
      const metal = mat(T, ice
        ? { color: 0xeaf0fa, metalness: 1, roughness: 0.1, envMapIntensity: 2.0 }
        : { color: 0xffc83d, metalness: 1, roughness: 0.17, envMapIntensity: 2.0 });
      const metalD = mat(T, ice
        ? { color: 0xb9c6da, metalness: 1, roughness: 0.2, envMapIntensity: 1.7 }
        : { color: 0xd8a126, metalness: 1, roughness: 0.26, envMapIntensity: 1.7 });
      // real link geometry: flattened ovals, every other one turned 90 degrees -- a Cuban link chain
      const N = 30, lr = Math.max(rx * 0.115, H * 0.018), tube = lr * 0.34;
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2, a2 = (i + 1) / N * Math.PI * 2;
        const p = path(a), q = path(a2);
        const dir = new T.Vector3().subVectors(q, p).normalize();
        const link = part(T, g, new T.TorusGeometry(lr, tube, 7, 16), i % 2 ? metal : metalD, null, 'link');
        link.position.copy(p).addScaledVector(dir, 0.5 * p.distanceTo(q));
        link.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
        link.rotateZ(i % 2 ? Math.PI / 2 : 0);
        link.scale.set(1, 0.68, 1);
        if (ice && i % 3 === 0) { const st = part(T, g, new T.OctahedronGeometry(tube * 1.5, 0), mat(T, { color: 0xffffff, roughness: 0.02, metalness: 0.1, emissive: 0x8fd8ff, emissiveIntensity: 0.55 }), null, 'stone'); st.position.copy(link.position); st.position.y += tube * 0.5; }
      }
      // the pendant hangs in FRONT and below, on a short bail
      const py = ringY - sag - H * 0.16, pz = Math.max(M.chestZ, front) * 1.0;
      const bail = part(T, g, new T.TorusGeometry(lr * 0.7, tube * 0.8, 6, 14), metal, null, 'droop');
      bail.position.set(0, ringY - sag - lr * 0.5, front); bail.rotation.y = Math.PI / 2;
      strut(T, g, new T.Vector3(0, ringY - sag - lr * 0.6, front), new T.Vector3(0, py + H * 0.05, pz), tube * 0.8, metal, 'droop', 6);
      if (!ice) {
        const coin = part(T, g, new T.CylinderGeometry(rx * 0.36, rx * 0.36, rx * 0.09, 32), metal, null, 'pendant');
        coin.rotation.x = Math.PI / 2; coin.position.set(0, py, pz);
        const rim = part(T, g, new T.TorusGeometry(rx * 0.35, rx * 0.035, 8, 30), metalD, null, 'pendant'); rim.position.set(0, py, pz);
        const mark = part(T, g, new T.TorusGeometry(rx * 0.18, rx * 0.04, 6, 24), mat(T, { color: 0xffe9a0, metalness: 1, roughness: 0.35 }), null, 'pendant'); mark.position.set(0, py, pz + rx * 0.05);
      } else {
        const claw = part(T, g, new T.OctahedronGeometry(rx * 0.3, 1), mat(T, { color: 0xffffff, roughness: 0.02, metalness: 0.05, envMapIntensity: 2.2, emissive: 0x9fe6ff, emissiveIntensity: 0.5 }), null, 'pendant');
        claw.scale.set(0.85, 1.3, 0.85); claw.position.set(0, py, pz);
        const setting = part(T, g, new T.TorusGeometry(rx * 0.2, rx * 0.04, 8, 22), metalD, null, 'pendant'); setting.position.set(0, py + rx * 0.16, pz); setting.rotation.x = Math.PI / 2;
      }
    } else if (kind === 'scarf') {
      const red = mat(T, { color: 0xd22a42, roughness: 0.9 });
      const wrap = part(T, g, new T.TorusGeometry(1, Math.max(rx * 0.3, H * 0.055) / Math.max(rx, 1e-6), 12, 44), red, null, 'ring');
      // scale.z was left at 1 while x and y were scaled to the neck. The torus is rotated a quarter
      // turn, so its local Z is the world VERTICAL -- leaving it at 1 squashed the tube into a flat
      // bar that cut straight across the chest and both arms and read as a rendering glitch. All
      // three axes have to be scaled together for the band to stay round.
      wrap.rotation.x = Math.PI / 2 - 0.1;
      wrap.scale.set(rx * 1.08, rz * 1.08, rx * 1.08);
      wrap.position.y = ringY + H * 0.02;
      const knot = part(T, g, new T.SphereGeometry(rx * 0.34, 14, 10), red, null, 'knot'); knot.position.set(rx * 0.34, ringY - H * 0.03, front * 0.94); knot.scale.set(1, 0.9, 0.85);
      // The tail was a rx*0.5 x H*0.72 x rx*0.1 slab -- half the fighter's height, a tenth as thick,
      // hanging flat down the chest. On every body it read as a necktie, not a scarf, and it was the
      // one neck option that looked wrong on all four fighters I rendered. Shorter, thicker, tapered
      // and turned off the chest so it has some form to catch the light.
      const tail = part(T, g, new T.CylinderGeometry(rx * 0.30, rx * 0.20, H * 0.40, 8, 1), red, null, 'tail');
      tail.scale.set(1, 1, 0.55);
      tail.position.set(rx * 0.46, ringY - H * 0.22, Math.max(M.chestZ, front) * 0.92);
      tail.rotation.set(0.18, 0, 0.20);
      const tip = part(T, g, new T.CylinderGeometry(rx * 0.20, rx * 0.16, H * 0.16, 8, 1), red, null, 'tail');
      tip.scale.set(1, 1, 0.55);
      tip.position.set(rx * 0.58, ringY - H * 0.46, Math.max(M.chestZ, front) * 0.86);
      tip.rotation.set(0.30, 0, 0.34);
    } else if (kind === 'bowtie') {
      const red = mat(T, { color: 0xd22a42, roughness: 0.42 }), dark = mat(T, { color: 0x9e1b30, roughness: 0.5 });
      const z = Math.max(M.NP.f(tieY), M.nd) * 1.02;
      const band = ellipseRing(T, g, dark, M.nw * 1.03, M.nd * 1.03, Math.max(rx * 0.11, H * 0.018), 'collar'); band.position.y = tieY;
      const w = rx * 0.62, hgt = rx * 0.5;
      for (const sx of [-1, 1]) {
        const wing = part(T, g, new T.CylinderGeometry(hgt * 0.24, hgt, w, 4, 1), red, null, 'wing');
        wing.rotation.set(0, Math.PI / 4, sx * Math.PI / 2); wing.position.set(sx * (w * 0.5 + rx * 0.1), tieY, z);
      }
      const knot = part(T, g, new T.BoxGeometry(rx * 0.24, rx * 0.3, rx * 0.2), dark, null, 'knot'); knot.position.set(0, tieY, z + rx * 0.02);
    } else return;
    mount(M, 'neck', g, 0, 0, 0);
  }

  // ---------------------------------------------------------------- shoes
  function buildShoes(T, M, kind) {
    for (const f of M.feet) {
      const g = gearGroup(T, 'shoes'); g.userData.cfFoot = f.key;
      const L = f.len, Wd = Math.max(f.halfW, L * 0.17), sole = L * 0.12;
      const y0 = f.soleY - L * 0.035;
      const cz = f.cz, cx = f.cx;
      const white = mat(T, { color: 0xf3f4f8, roughness: 0.55 });
      const rubber = mat(T, { color: 0x14161d, roughness: 0.85 });
      const goldM = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.22, envMapIntensity: 1.9 });
      const goldD = mat(T, { color: 0xb8892a, metalness: 1, roughness: 0.35, envMapIntensity: 1.6 });
      const leather = mat(T, { color: 0x5a3418, roughness: 0.7 });
      const accent = mat(T, { color: 0xe8203c, roughness: 0.5 });
      const isKick = kind === 'kicks';
      const body = isKick ? goldM : kind === 'boots' ? leather : kind === 'sandal' ? leather : white;
      const base = isKick ? goldD : rubber;

      const sm = part(T, g, slab(T, Wd * 2.16, L * 1.06, Wd * 0.55, sole), base, null, 'sole');
      sm.rotation.x = -Math.PI / 2; sm.position.set(cx, y0 + sole * 0.5, cz);
      if (kind !== 'sandal') {
        const mid = part(T, g, slab(T, Wd * 2.06, L * 1.0, Wd * 0.52, sole * 0.55), isKick ? goldM : white, null, 'midsole');
        mid.rotation.x = -Math.PI / 2; mid.position.set(cx, y0 + sole * 1.05, cz);
      }
      if (kind === 'sandal') {
        for (const [t, wdt] of [[0.18, 0.5], [-0.12, 0.42]]) {
          const st = part(T, g, new T.TorusGeometry(Wd * 0.98, Wd * 0.13, 8, 22, Math.PI), leather, null, 'strap');
          st.position.set(cx, y0 + sole, cz + L * t); st.scale.set(1, wdt * 1.7, 1);
        }
        const toe = part(T, g, new T.CylinderGeometry(Wd * 0.09, Wd * 0.09, L * 0.3, 8), leather, null, 'strap');
        toe.position.set(cx, y0 + sole * 1.3, cz + L * 0.33); toe.rotation.x = 1.2;
      } else {
        const up = dome(T, g, body, Wd * 1.1, L * (kind === 'boots' ? 0.42 : 0.46), L * 0.55, 'upper');
        up.position.set(cx, y0 + sole * 1.1, cz - L * 0.02);
        const heel = dome(T, g, isKick ? goldD : kind === 'boots' ? leather : accent, Wd * 1.06, L * (kind === 'boots' ? 0.5 : 0.44), L * 0.3, 'heel');
        heel.position.set(cx, y0 + sole * 1.1, cz - L * 0.3);
        const collar = part(T, g, new T.TorusGeometry(Wd * 0.8, Wd * 0.17, 8, 22), isKick ? goldD : rubber, null, 'collar');
        collar.rotation.x = Math.PI / 2; collar.scale.y = 1.15;
        collar.position.set(cx, y0 + sole * 1.1 + L * (kind === 'boots' ? 0.46 : 0.4), cz - L * 0.28);
        if (kind === 'boots') {
          const shaft = part(T, g, new T.CylinderGeometry(Wd * 0.94, Wd * 1.02, L * 0.62, 20, 1, true), new T.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.7, side: T.DoubleSide }), null, 'shaft');
          shaft.position.set(cx, y0 + sole + L * 0.66, cz - L * 0.22);
          const cuff = part(T, g, new T.TorusGeometry(Wd * 1.0, Wd * 0.13, 8, 22), mat(T, { color: 0x3a2110, roughness: 0.7 }), null, 'cuff');
          cuff.rotation.x = Math.PI / 2; cuff.position.set(cx, y0 + sole + L * 0.96, cz - L * 0.22);
          for (const s of [-1, 1]) { const bk = part(T, g, new T.BoxGeometry(Wd * 0.12, Wd * 0.3, Wd * 0.3), goldM, null, 'buckle'); bk.position.set(cx + s * Wd * 0.96, y0 + sole + L * 0.7, cz - L * 0.22); }
        } else {
          for (let i = 0; i < 3; i++) {
            const lace = part(T, g, new T.CylinderGeometry(Wd * 0.055, Wd * 0.055, Wd * 1.1, 6), isKick ? goldD : white, null, 'lace');
            lace.rotation.z = Math.PI / 2; lace.position.set(cx, y0 + sole * 1.1 + L * (0.36 - i * 0.05), cz + L * (0.02 + i * 0.1));
          }
          for (const s of [-1, 1]) {
            const sw = part(T, g, new T.BoxGeometry(Wd * 0.1, L * 0.12, L * 0.42), isKick ? goldD : accent, null, 'stripe');
            sw.position.set(cx + s * Wd * 1.08, y0 + sole * 1.1 + L * 0.13, cz - L * 0.02); sw.rotation.x = 0.16;
          }
        }
        const toe = part(T, g, new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), isKick ? goldD : rubber, null, 'toecap');
        toe.scale.set(Wd * 1.06, L * 0.2, L * 0.2); toe.position.set(cx, y0 + sole * 1.05, cz + L * 0.34);
      }
      if (isKick) { const gm = glowMat(T, 0xffd36a, 1.3, { metalness: 0.6, roughness: 0.2 }); const gl = part(T, g, new T.TorusGeometry(Wd * 1.02, Wd * 0.045, 6, 26), gm.m, gm.want, 'glow'); gl.rotation.x = Math.PI / 2; gl.scale.y = (L * 0.53) / Math.max(Wd, 1e-6); gl.position.set(cx, y0 + sole * 0.55, cz); }
      mount(M, f.key, g, 0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- auras
  // Each aura is a shader shell (cheap: 2-3 draw calls) plus a light that actually falls on the fighter, all
  // driven from one mesh's onBeforeRender so there is a single tick per aura per frame.
  const FX_NOISE = `
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }`;
  const FX_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  function flameMat(T, cA, cB, opt) {
    const o = opt || {};
    return fxMat(T, {
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      uniforms: { t: { value: 0 }, cA: { value: new T.Color(cA) }, cB: { value: new T.Color(cB) }, uInt: { value: o.int == null ? 1.0 : o.int }, uSpd: { value: o.spd == null ? 1.15 : o.spd }, uSharp: { value: o.sharp == null ? 0.32 : o.sharp } },
      vertexShader: FX_VERT,
      fragmentShader: FX_NOISE + `
        uniform float t, uInt, uSpd, uSharp; uniform vec3 cA, cB; varying vec2 vUv;
        void main(){
          float y = vUv.y;
          vec2 q = vec2(vUv.x * 7.0, vUv.y * 2.6 - t * uSpd);
          float n = fbm(q + fbm(q * 1.7));
          float lick = smoothstep(uSharp, 0.94, n + (1.0 - y) * 0.6);
          float body = lick * pow(1.0 - y, 0.5) * smoothstep(0.0, 0.1, y);
          vec3 c = mix(cA, cB, clamp(n * 1.35 - y * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(c * body * uInt, body);
        }`,
    });
  }
  function smokeMat(T, cA, cB, opt) {
    const o = opt || {};
    return fxMat(T, {
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: o.additive === false ? T.NormalBlending : T.AdditiveBlending,
      uniforms: { t: { value: 0 }, cA: { value: new T.Color(cA) }, cB: { value: new T.Color(cB) }, uInt: { value: o.int == null ? 1.0 : o.int }, uSpd: { value: o.spd == null ? 0.22 : o.spd } },
      vertexShader: FX_VERT,
      fragmentShader: FX_NOISE + `
        uniform float t, uInt, uSpd; uniform vec3 cA, cB; varying vec2 vUv;
        void main(){
          vec2 q = vec2(vUv.x * 4.0 + t * 0.06, vUv.y * 2.0 - t * uSpd);
          float n = fbm(q + fbm(q * 2.1));
          float body = smoothstep(0.38, 0.86, n) * pow(1.0 - vUv.y, 0.7) * smoothstep(0.0, 0.16, vUv.y);
          vec3 c = mix(cA, cB, clamp(n * 1.4, 0.0, 1.0));
          gl_FragColor = vec4(c * body * uInt, body * 0.9);
        }`,
    });
  }
  function auraDriver(T, g, tick) {
    // one invisible-ish quad that is always drawn: it owns the per-frame update for the whole aura
    const m = fxMat(T, { transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: {}, vertexShader: FX_VERT, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }' });
    const d = part(T, g, new T.PlaneGeometry(0.001, 0.001), m, { tick }, 'driver');
    d.frustumCulled = false; d.castShadow = false; d.renderOrder = -1;
    return d;
  }
  // WHY volt, void and holy used to look like plastic: flame and fire are shader SHELLS -- soft noise
  // blended additively, so they read as light. The other three drew solid geometry (tubes, rings,
  // planes) through `glowMat` with NORMAL blending at 0.55-0.95 opacity, which on a dark stage is an
  // opaque white noodle, a purple bar and a grey slab. Duane, 9/28, on the volt preview: the white
  // spaghetti in his screenshot. They are additive and thinner now, so the same shapes read as arcs
  // of light instead of objects. `fxAdd` is the one place that treatment is expressed.
  const fxAdd = (T, me, op) => { const m = me.material; if (m) { m.blending = T.AdditiveBlending; m.transparent = true; m.opacity = op; m.depthWrite = false; } if (me.userData) me.userData.cfWant = Object.assign({}, me.userData.cfWant, { opacity: op, depthWrite: false }); return me; };
  function buildAura(T, M, kind) {
    const g = gearGroup(T, 'aura');
    const S = M.S, R = Math.max(S * 0.3, M.bw * 1.06), mats = [];   // outside the silhouette, not through it
    const light = new T.PointLight(0xffffff, 0, S * 2.6, 2);
    light.position.set(0, S * 0.55, 0); light.userData.cfGear = true; g.add(light);
    const SOFT_FX = { opacity: 1, depthWrite: false };
    const shell = (rTop, rBot, h, m, yOff) => {
      const s = part(T, g, new T.CylinderGeometry(rTop, rBot, h, 44, 1, true), m, Object.assign({}, SOFT_FX), 'shell');
      s.position.y = h / 2 + (yOff || 0); s.castShadow = false; s.frustumCulled = false; mats.push(m); return s;
    };
    const ground = (rr, m, op) => { const r2 = part(T, g, new T.RingGeometry(rr * 0.82, rr, 48), m, { opacity: op == null ? 0.42 : op, depthWrite: false }, 'ring'); r2.rotation.x = -Math.PI / 2; r2.position.y = S * 0.004; r2.castShadow = false; r2.frustumCulled = false; return r2; };
    const soft = me => { keep(me, Object.assign({}, SOFT_FX, me.userData.cfWant || {})); me.castShadow = false; me.frustumCulled = false; return me; };

    if (kind === 'flame' || kind === 'fire') {
      const ssj = kind === 'flame';
      const cA = ssj ? 0xfff3a0 : 0xffd06a, cB = ssj ? 0xffb020 : 0xff3a08;
      const outer = flameMat(T, cA, cB, { int: ssj ? 0.85 : 0.7, spd: ssj ? 1.5 : 1.1, sharp: ssj ? 0.52 : 0.56 });
      const inner = flameMat(T, 0xffffff, cA, { int: ssj ? 0.7 : 0.5, spd: ssj ? 1.9 : 1.35, sharp: 0.66 });
      shell(R * (ssj ? 0.5 : 0.66), R * 1.1, S * (ssj ? 1.3 : 1.0), outer);
      shell(R * 0.62, R * 0.98, S * (ssj ? 1.05 : 0.8), inner);
      const gm = glowMat(T, cB, 2.4, { transparent: true, opacity: 0.75, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.25, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(ssj ? 0xffd75e : 0xff7a20);
      auraDriver(T, g, (m, t) => {
        outer.uniforms.t.value = t; inner.uniforms.t.value = t;
        const p = 0.8 + Math.sin(t * 7.0) * 0.12 + Math.sin(t * 13.3) * 0.06;
        outer.uniforms.uInt.value = (ssj ? 0.85 : 0.7) * p; inner.uniforms.uInt.value = (ssj ? 0.7 : 0.5) * p;
        light.color.copy(lc); light.intensity = (ssj ? 1.5 : 1.1) * p;
      });
    } else if (kind === 'volt') {
      const glow = flameMat(T, 0xcdf3ff, 0x2a6cff, { int: 0.55, spd: 2.4, sharp: 0.68 });
      shell(R * 0.82, R * 1.05, S * 1.0, glow);
      const boltM = glowMat(T, 0xd8f4ff, 3.6, { transparent: true, opacity: 0.95, depthWrite: false });
      const bolts = [];
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2, rr = R * (0.85 + (i % 3) * 0.12);
        const pts = [];
        const n = 6;
        for (let k = 0; k <= n; k++) {
          const t = k / n, wob = Math.sin(i * 3.7 + k * 2.1) * R * 0.3 * (1 - t);
          pts.push(new T.Vector3(Math.sin(a) * rr * (1 - t * 0.35) + wob, S * (0.92 - t * 0.92), Math.cos(a) * rr * (1 - t * 0.35) + Math.cos(i * 2.3 + k) * R * 0.22 * (1 - t)));
        }
        const b = part(T, g, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 14, S * 0.0045, 5, false), boltM.m, { emissive: boltM.want.emissive, ei: boltM.want.ei, opacity: 0.5, depthWrite: false }, 'bolt');
        soft(b); fxAdd(T, b, 0.5); bolts.push(b);
      }
      for (let k = 0; k < 2; k++) {
        const arc = part(T, g, new T.TorusGeometry(R * (1.0 + k * 0.18), S * 0.0032, 6, 60), boltM.m, { emissive: boltM.want.emissive, ei: boltM.want.ei, opacity: 0.35, depthWrite: false }, 'arc');
        arc.rotation.x = Math.PI / 2; arc.position.y = S * (0.35 + k * 0.4); soft(arc); fxAdd(T, arc, 0.35); bolts.push(arc);
      }
      const gm = glowMat(T, 0x27e1ff, 2.6, { transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.3, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0x6fd0ff);
      auraDriver(T, g, (m, t) => {
        glow.uniforms.t.value = t;
        const seed = Math.floor(t * 22);
        for (let i = 0; i < bolts.length; i++) {
          const h = Math.abs(Math.sin((seed + i * 7.31) * 12.9898) * 43758.5453) % 1;
          bolts[i].visible = h > 0.42;
        }
        g.rotation.y = t * 0.6;
        const flick = 0.35 + (Math.abs(Math.sin(seed * 78.233) * 43758.5) % 1) * 0.9;
        light.color.copy(lc); light.intensity = 1.6 * flick;
        boltM.want.ei = 2.6 + flick * 2.2;
      });
    } else if (kind === 'frost') {
      const mist = smokeMat(T, 0xdff4ff, 0x4aa8ff, { int: 0.45, spd: 0.16 });
      shell(R * 0.98, R * 1.15, S * 0.85, mist);
      // 0.8 opaque pale-grey octahedra read as chipped polystyrene rather than ice, and the eight
      // ground spikes looked like scenery a fighter would trip over. Glassier and more transparent,
      // with the emissive carrying the colour instead of the albedo.
      const ice = mat(T, { color: 0xbfe6ff, roughness: 0.02, metalness: 0.05, transparent: true, opacity: 0.42, envMapIntensity: 2.6, emissive: 0x3f9fe8, emissiveIntensity: 1.1 });
      const shards = [];
      for (let i = 0; i < 12; i++) {
        const sd = part(T, g, new T.OctahedronGeometry(S * (0.028 + (i % 3) * 0.010), 0), ice, { emissive: new T.Color(0x3f9fe8), ei: 1.1, opacity: 0.42 }, 'shard');
        sd.scale.set(0.5, 1.7, 0.5); sd.castShadow = false; shards.push(sd);
      }
      for (let i = 0; i < 8; i++) {
        const sp = part(T, g, new T.ConeGeometry(S * 0.013, S * 0.085, 5), ice, { opacity: 0.42 }, 'spike');
        const a = i / 8 * Math.PI * 2; sp.position.set(Math.sin(a) * R * 1.02, S * 0.035, Math.cos(a) * R * 1.02);
        sp.rotation.set(0.28 * Math.cos(a), 0, -0.28 * Math.sin(a)); sp.castShadow = false;
      }
      const gm = glowMat(T, 0x8fd8ff, 1.6, { transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.25, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0x8fd0ff);
      auraDriver(T, g, (m, t) => {
        mist.uniforms.t.value = t;
        for (let i = 0; i < shards.length; i++) {
          const a = t * 0.5 + i / shards.length * Math.PI * 2, rr = R * (0.85 + Math.sin(t * 0.8 + i) * 0.14);
          shards[i].position.set(Math.sin(a) * rr, S * (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.7 + i * 1.9))), Math.cos(a) * rr);
          shards[i].rotation.set(t * 0.6 + i, t * 0.4, 0);
        }
        light.color.copy(lc); light.intensity = 1.1 + Math.sin(t * 2.0) * 0.2;
      });
    } else if (kind === 'void') {
      const smoke = smokeMat(T, 0x1a0a28, 0x08040e, { int: 0.8, spd: 0.3, additive: false });
      shell(R * 0.92, R * 1.2, S * 1.0, smoke);
      const rim = flameMat(T, 0xc07bff, 0x5a10b0, { int: 0.75, spd: 0.75, sharp: 0.6 });
      shell(R * 0.86, R * 1.26, S * 1.05, rim);
      const gm = glowMat(T, 0x9b5cff, 2.4, { transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.3, gm.m).material.blending = T.AdditiveBlending;
      const wisps = [];
      for (let i = 0; i < 7; i++) {
        const wm = glowMat(T, 0x8a3cff, 2.0, { transparent: true, opacity: 0.6, depthWrite: false });
        const w = part(T, g, new T.TorusGeometry(R * (0.55 + (i % 3) * 0.2), S * 0.006, 6, 40, Math.PI * 1.2), wm.m, { emissive: wm.want.emissive, ei: 2.0, opacity: 0.3, depthWrite: false }, 'wisp');
        soft(w); fxAdd(T, w, 0.3); wisps.push(w);
      }
      const lc = new T.Color(0x9b5cff);
      auraDriver(T, g, (m, t) => {
        smoke.uniforms.t.value = t; rim.uniforms.t.value = t;
        for (let i = 0; i < wisps.length; i++) { wisps[i].position.y = S * (0.1 + ((t * 0.28 + i / wisps.length) % 1) * 0.95); wisps[i].rotation.set(Math.PI / 2, t * (0.5 + i * 0.13), 0); }
        light.color.copy(lc); light.intensity = 1.2 + Math.sin(t * 1.7) * 0.3;
      });
    } else if (kind === 'holy') {
      const glow = flameMat(T, 0xffffff, 0xffe9a8, { int: 0.5, spd: 0.5, sharp: 0.68 });
      shell(R * 0.92, R * 1.05, S * 0.9, glow);
      const beamM = glowMat(T, 0xfff4cf, 2.2, { transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide });
      const shafts = [];
      for (let i = 0; i < 12; i++) {
        const sf = part(T, g, new T.PlaneGeometry(S * 0.032, S * 0.75), beamM.m, { emissive: beamM.want.emissive, ei: 2.2, opacity: 0.22, depthWrite: false }, 'shaft');
        const a = i / 12 * Math.PI * 2; sf.position.set(Math.sin(a) * R * 0.95, S * 0.45, Math.cos(a) * R * 0.95);
        sf.rotation.y = a; soft(sf); fxAdd(T, sf, 0.22); shafts.push(sf);
      }
      const hm2 = glowMat(T, 0xffe9a8, 3.0, { transparent: true, opacity: 0.9, depthWrite: false });
      const halo = part(T, g, new T.TorusGeometry(R * 0.6, S * 0.0075, 8, 60), hm2.m, { emissive: hm2.want.emissive, ei: 3.0, opacity: 0.6, depthWrite: false }, 'halo');
      halo.rotation.x = Math.PI / 2; halo.position.y = S * 1.12; soft(halo); fxAdd(T, halo, 0.6);
      const gm = glowMat(T, 0xffe9a8, 2.2, { transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.3, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0xfff0c8);
      auraDriver(T, g, (m, t) => {
        glow.uniforms.t.value = t;
        for (let i = 0; i < shafts.length; i++) { const k = (t * 0.3 + i / shafts.length) % 1; shafts[i].position.y = S * (0.1 + k * 1.0); shafts[i].scale.y = 0.3 + (1 - k) * 0.9; }
        halo.rotation.z = t * 0.5; halo.position.y = S * (1.12 + Math.sin(t * 1.2) * 0.02);
        light.color.copy(lc); light.intensity = 1.4 + Math.sin(t * 2.6) * 0.3;
      });
    } else if (kind === 'cash') {
      const green = flameMat(T, 0xd8ffe2, 0x16c95a, { int: 0.6, spd: 0.9, sharp: 0.62 });
      shell(R * 0.86, R * 1.1, S * 0.9, green);
      const noteM = mat(T, { color: 0x3ec46d, roughness: 0.6, emissive: 0x0a3a18, emissiveIntensity: 0.6 });
      const notes = [];
      for (let i = 0; i < 10; i++) { const nt = part(T, g, new T.PlaneGeometry(S * 0.07, S * 0.035), noteM, null, 'note'); nt.castShadow = false; notes.push(nt); }
      const gm = glowMat(T, 0x3dff8a, 2.2, { transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.25, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0x5cffa0);
      auraDriver(T, g, (m, t) => {
        green.uniforms.t.value = t;
        for (let i = 0; i < notes.length; i++) {
          const k = (t * 0.22 + i / notes.length) % 1, a = i * 2.4 + t * 0.7;
          notes[i].position.set(Math.sin(a) * R * 1.0, S * (0.05 + k * 1.1), Math.cos(a) * R * 1.0);
          notes[i].rotation.set(t * 1.6 + i, a, t * 0.9);
        }
        light.color.copy(lc); light.intensity = 1.0 + Math.sin(t * 3.1) * 0.25;
      });
    } else return;
    mount(M, 'root', g, 0, M.minY, 0);
  }

  function buildGear(T, M, lk) {
    M.hairOn = lk.hair !== 'none';
    if (lk.hair !== 'none') buildHair(T, M, lk.hair, lk.haircol);
    if (lk.hat !== 'none') buildHat(T, M, lk.hat, lk.hatcol);
    if (lk.eyes !== 'none' && EYES_UNFIT.indexOf(M.id || lk.base) < 0) buildEyes(T, M, lk.eyes);
    if (lk.neck !== 'none') buildNeck(T, M, lk.neck);
    if (lk.shoes !== 'none') buildShoes(T, M, lk.shoes);
    if (lk.aura !== 'none') buildAura(T, M, lk.aura);
    return M.made;
  }
  function applyLook(lk, root, T, id) {
    lk = sanitize(lk);
    paintBody(root, T, lk, id || lk.base);
    const M = measure(root, T, id || lk.base); if (!M) return null;
    buildGear(T, M, lk);
    return M;
  }

  function lookFor(f) {
    if (!f || !f.slot) return null;
    if (f.slot.customLook) return sanitize(f.slot.customLook);
    if (f.slot.custom && saved) return saved;
    return null;
  }

  window.CustomLook = {
    get: () => saved ? Object.assign({}, saved) : null,
    set(lk) { saved = sanitize(lk); writeSaved(saved); paintEntryPoints(); return Object.assign({}, saved); },
    code: () => (saved ? b64.enc(saved) : ''),
    fromCode(s) { const o = b64.dec(s); return o ? this.set(o) : null; },
    sanitize,
    lookFor,
    thumb, thumbFor, hudArt, hudTag, dressHero,
    apply(id, root, T, f) { const lk = lookFor(f); if (lk && lk.base === id) applyLook(lk, root, T, id); },
    applyLook,
    open: () => openCreator(),
    _pv: () => PV,   // dev inspection
    // dev/gearcheck.mjs drives these: the SAME measure + build path the match and the preview use,
    // minus the body recolour, so a harness can fit one piece at a time and take it off again.
    _dev: {
      lists: { HATS, EYES, HAIR, HAIRCOL, NECK, SHOES, AURA, TINTS, FINISH },
      // bodies a slot is deliberately suppressed on, so a measuring harness can tell "nothing was built
      // on purpose" apart from "the piece failed to land" — they look identical from outside
      unfit: { eyes: EYES_UNFIT.slice() },
      measure,
      // dev/skinref probe: what colour did the coat detector actually land on? Without this the only
      // way to tell a bad reference from a bad shader mask is to guess.
      skinRef(root, T, id) { const c = skinReference(root, T, id); return c ? { r: +c.r.toFixed(3), g: +c.g.toFixed(3), b: +c.b.toFixed(3) } : null; },
      fit(root, T, lk, id) { const M = measure(root, T, id || (lk && lk.base)); if (!M) return null; buildGear(T, M, sanitize(Object.assign({ base: id }, lk))); return M; },
      strip(M) { for (const g of (M && M.made) || []) if (g.parent) g.parent.remove(g); if (M) M.made = []; },
    },
  };

  // Custom names on the HUD and results: a per-match view of the base fighter, gameplay fields untouched.
  if (typeof Game !== 'undefined' && Game.start) {
    const origStart = Game.start;
    Game.start = function () {
      const r = origStart.apply(this, arguments);
      try {
        for (const f of this.fighters || []) {
          const lk = lookFor(f);
          if (lk && lk.base === f.c.id) f.c = Object.create(f.c, { name: { value: lk.name, enumerable: true }, title: { value: lk.title || f.c.title, enumerable: true } });
        }
      } catch (e) { /* names are cosmetic */ }
      return r;
    };
  }

  // ---------------------------------------------------------------- creator screen
  const css = `
  #scCustom{align-items:stretch;padding:0;background:radial-gradient(60% 70% at 18% 40%,rgba(255,42,74,.22),transparent 62%),radial-gradient(50% 70% at 100% 10%,rgba(39,225,255,.14),transparent 60%),#050507}
  #scCustom .cf{width:100%;min-height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:12px;box-sizing:border-box;
    padding:max(16px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left))}
  #scCustom .cf-top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
  #scCustom .cf-top .row{display:flex;gap:8px;flex-wrap:wrap}
  #scCustom .cf-mid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,460px);gap:16px;min-height:0}
  #scCustom .cf-stage{position:relative;min-height:360px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0));
    box-shadow:inset 0 0 0 1px var(--line);clip-path:polygon(0 0,calc(100% - var(--cut)) 0,100% var(--cut),100% 100%,var(--cut) 100%,0 calc(100% - var(--cut)))}
  #scCustom #cfCanvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
  #scCustom #cfCanvas:active{cursor:grabbing}
  #scCustom #cfFallback{position:absolute;left:50%;bottom:90px;height:70%;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 20px 30px rgba(0,0,0,.6))}
  #scCustom .cf-plate{position:absolute;left:0;bottom:0;display:flex;flex-direction:column;gap:3px;padding:12px 18px 14px;background:linear-gradient(90deg,rgba(5,5,7,.9),rgba(5,5,7,.25));box-shadow:inset 3px 0 0 var(--red);max-width:calc(100% - 20px);pointer-events:none}
  #scCustom .cf-plate b{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(38px,5vw,70px);line-height:.86;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;overflow-wrap:anywhere}
  #scCustom .cf-plate span{font-family:var(--display);font-style:italic;font-weight:700;font-size:18px;letter-spacing:.04em;text-transform:uppercase;color:var(--red)}
  #scCustom .cf-plate small{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--muted)}
  #scCustom .cf-hint{position:absolute;right:14px;top:12px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;pointer-events:none}
  #scCustom .cf-msg{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font-family:var(--mono);font-size:12px;color:var(--muted);text-align:center;max-width:80%}
  #scCustom .cf-panel{display:flex;flex-direction:column;gap:16px;overflow-y:auto;min-height:0;padding:4px 6px 4px 2px;touch-action:pan-y;overscroll-behavior:contain}
  #scCustom .cf-grp{display:flex;flex-direction:column;gap:8px}
  #scCustom .cf-lbl{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--red);display:flex;justify-content:space-between;gap:8px}
  #scCustom .cf-lbl em{font-style:normal;color:var(--muted);font-weight:500;letter-spacing:.04em;text-transform:none}
  #scCustom .cf-in{width:100%;box-sizing:border-box;height:46px;padding:0 14px;border:0;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2);color:var(--text);
    font-family:var(--display);font-style:italic;font-weight:900;font-size:24px;letter-spacing:.01em;-webkit-user-select:text;user-select:text;border-radius:0}
  #scCustom .cf-in.sm{font-size:18px;height:40px;font-weight:700}
  #scCustom .cf-in:focus{outline:none;box-shadow:inset 0 0 0 2px var(--cyan)}
  #scCustom .cf-at{display:flex;align-items:center;gap:0}
  #scCustom .cf-at span{height:40px;display:flex;align-items:center;padding:0 10px;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2);font-family:var(--display);font-style:italic;font-weight:900;font-size:18px;color:var(--muted)}
  #scCustom .cf-at .cf-in{flex:1}
  #scCustom .cf-plate #cfShowX{color:var(--cyan);font-weight:700}
  #scCustom .cf-chips{display:flex;flex-wrap:wrap;gap:6px}
  #scCustom .cf-chip{min-height:34px;padding:0 12px;border:0;cursor:pointer;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2);color:var(--text);font-size:13px;font-weight:600;
    clip-path:polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%);transition:background .15s}
  #scCustom .cf-chip:hover{background:rgba(255,255,255,.12)}
  #scCustom .cf-chip.on{background:var(--red);box-shadow:none;color:#fff}
  #scCustom .cf-sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:6px}
  #scCustom .cf-sw button{aspect-ratio:1;border:0;cursor:pointer;background:var(--c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px))}
  #scCustom .cf-sw button.orig{background:conic-gradient(from 45deg,#ffc83d,#ff2a4a,#9b5cff,#27e1ff,#8dff3a,#ffc83d)}
  #scCustom .cf-sw button.on{box-shadow:inset 0 0 0 3px #fff,0 0 12px var(--c)}
  #scCustom .cf-bodies{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:5px}
  #scCustom .cf-body{position:relative;aspect-ratio:1;border:0;padding:0;cursor:pointer;background:#0a0b11 no-repeat 50% 8%/180% auto;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);
    clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px));transition:transform .12s}
  #scCustom .cf-body:hover{transform:translateY(-2px)}
  #scCustom .cf-body.on{box-shadow:inset 0 0 0 3px var(--red)}
  #scCustom .cf-body span{position:absolute;left:0;right:0;bottom:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:11px;padding:2px 4px;background:linear-gradient(0deg,rgba(5,5,7,.9),transparent);text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
  #scCustom .cf-foot{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;position:sticky;bottom:0;z-index:3;padding:10px 0 max(4px,env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(5,5,7,0),rgba(5,5,7,.92) 35%)}
  #scCustom .cf-foot .cf-saved{font-family:var(--mono);font-size:12px;color:var(--lime);margin-right:auto;opacity:0;transition:opacity .3s}
  #scCustom .cf-foot .cf-saved.on{opacity:1}
  @media (max-width:820px){
    #scCustom .cf{grid-template-rows:auto auto auto}
    #scCustom .cf-mid{grid-template-columns:1fr;grid-template-rows:min(46vh,420px) auto;min-height:auto}
    #scCustom .cf-stage{min-height:0}
    #scCustom .cf-panel{overflow:visible}
    #scCustom .cf-plate b{font-size:36px}
    #scCustom .cf-foot .btn{flex:1}
  }
  #scSelect .cf-mine{background:linear-gradient(90deg,rgba(255,42,74,.9),rgba(255,106,61,.8));box-shadow:none}
  /* the player's own fighter, first tile in the select grid */
  #roster .cf-pick{position:relative;display:block;padding:0;border:0;cursor:pointer;background:linear-gradient(180deg,#2a1020,#0a0b11);
    box-shadow:inset 0 0 0 2px var(--red),0 0 18px rgba(255,42,74,.35);overflow:hidden;
    clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px));transition:transform .12s}
  #roster .cf-pick:hover{transform:translateY(-3px)}
  /* keyboard/pad highlight, matched to .pick.cur so the grid reads as one list */
  #roster .cf-pick.cf-cur{transform:translateY(-2px);box-shadow:inset 0 0 0 2px #fff,0 0 18px rgba(255,255,255,.5)}
  #roster .cf-pick.on{box-shadow:inset 0 0 0 3px var(--gold),0 0 22px rgba(255,200,61,.45)}
  #roster .cf-pick .face{position:absolute;inset:0;background:#0a0b11 no-repeat 50% 6%/185% auto}
  #roster .cf-pick .face.cf-shot{background-size:contain;background-position:50% 100%}
  #roster .cf-pick .badge{position:absolute;left:0;top:0;z-index:2;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.09em;padding:2px 4px;background:var(--red);color:#fff}
  #roster .cf-pick .nm{position:absolute;left:0;right:0;bottom:0;z-index:2;font-family:var(--display);font-style:italic;font-weight:900;font-size:11px;padding:2px 4px;
    background:linear-gradient(0deg,rgba(5,5,7,.95),transparent);text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;color:#fff}
  #scSelect .hero.cf-hero .art img,#scSelect #heroP1.cf-hero img,#scSelect #heroP2.cf-hero img{object-fit:contain}
  #scSelect .cf-hero .nm{color:var(--red)}
  #scSelect .cf-x{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--cyan);margin-top:2px}
  #scResults .cf-x{font-family:var(--mono);font-size:13px;letter-spacing:.06em;color:var(--cyan);margin-top:4px;text-align:center}
  #slots .slot.cf-slot .nm{color:var(--red)}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const sec = document.createElement('section');
  sec.className = 'screen solid'; sec.id = 'scCustom'; sec.hidden = true;
  const chips = (key, list) => `<div class="cf-chips" data-k="${key}">${list.map(([v, l]) => `<button class="cf-chip" data-v="${v}" id="cf_${key}_${v}">${l}</button>`).join('')}</div>`;
  sec.innerHTML = `<div class="cf">
    <header class="cf-top">
      <div><div class="eyebrow">Your fighter</div><h2 class="h2">Build your fighter</h2></div>
      <div class="row"><button class="btn small" id="cfRandom">Randomise</button><button class="btn small" id="cfBack">Back</button></div>
    </header>
    <div class="cf-mid">
      <div class="cf-stage">
        <canvas id="cfCanvas"></canvas><img id="cfFallback" alt="" hidden><div class="cf-msg" id="cfMsg" hidden></div>
        <div class="cf-hint">Drag to spin</div>
        <div class="cf-plate"><b id="cfShowName"></b><span id="cfShowTitle"></span><small id="cfShowX"></small><small id="cfShowBase"></small></div>
      </div>
      <div class="cf-panel">
        <div class="cf-grp"><div class="cf-lbl">Looks <em>one tap, then adjust anything below</em></div>
          <div class="cf-chips cf-pre" id="cfPresets">${PRESETS.map(([v, l]) => `<button class="cf-chip" data-p="${v}">${esc(l)}</button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">Name <em>up to 16 letters</em></div><input class="cf-in" id="cfName" maxlength="16" autocomplete="off" spellcheck="false"></div>
        <div class="cf-grp"><div class="cf-lbl">Title</div><input class="cf-in sm" id="cfTitle" maxlength="22" autocomplete="off" spellcheck="false">
          <div class="cf-chips" id="cfTitles">${TITLES.map(t => `<button class="cf-chip" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">X / Twitter <em>optional, shown under your name</em></div>
          <div class="cf-at"><span>@</span><input class="cf-in sm" id="cfX" maxlength="15" autocomplete="off" spellcheck="false" placeholder="yourhandle"></div></div>
        <div class="cf-grp"><div class="cf-lbl">Body <em id="cfBodyNote">moves and stats come from the body</em></div><div class="cf-bodies" id="cfBodies"></div></div>
        <div class="cf-grp"><div class="cf-lbl">Colour</div><div class="cf-sw" data-k="tint">${TINTS.map(([v, l, h]) => `<button class="${v === 'orig' ? 'orig' : ''}" data-v="${v}" id="cf_tint_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">Skin / fur tone</div><div class="cf-sw" data-k="skin">${SKIN.map(([v, l, h]) => `<button class="${v === 'orig' ? 'orig' : ''}" data-v="${v}" id="cf_skin_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">Finish</div>${chips('finish', FINISH)}</div>
        <div class="cf-grp"><div class="cf-lbl">Material <em>painted into the skin, so it fits every body</em></div>${chips('pattern', PATTERN)}</div>
        <div class="cf-grp" id="cfPatColGrp"><div class="cf-lbl">Material colour</div><div class="cf-sw" data-k="patcol">${PATCOL.map(([v, l, h]) => `<button class="${v === 'auto' ? 'orig' : ''}" data-v="${v}" id="cf_patcol_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        ${HAIR.length > 1 ? `<div class="cf-grp"><div class="cf-lbl">Hair</div>${chips('hair', HAIR)}</div>
        <div class="cf-grp"><div class="cf-lbl">Hair colour</div><div class="cf-sw" data-k="haircol">${HAIRCOL.map(([v, l, h]) => `<button data-v="${v}" id="cf_haircol_${v}" title="${l}" aria-label="${l}" style="--c:${h}"></button>`).join('')}</div></div>` : ''}
        ${HATS.length > 1 ? `<div class="cf-grp"><div class="cf-lbl">Hat</div>${chips('hat', HATS)}</div>
        <div class="cf-grp"><div class="cf-lbl">Hat colour</div><div class="cf-sw" data-k="hatcol">${HATCOL.map(([v, l, h]) => `<button class="${v === 'auto' ? 'orig' : ''}" data-v="${v}" id="cf_hatcol_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>` : ''}
        <div class="cf-grp"><div class="cf-lbl">Eyes</div>${chips('eyes', EYES)}</div>
        <div class="cf-grp"><div class="cf-lbl">Neck</div>${chips('neck', NECK)}</div>
        <div class="cf-grp"><div class="cf-lbl">Shoes</div>${chips('shoes', SHOES)}</div>
        <div class="cf-grp"><div class="cf-lbl">Aura</div>${chips('aura', AURA)}</div>
      </div>
    </div>
    <footer class="cf-foot"><span class="cf-saved" id="cfSaved">Saved</span>
      <button class="btn small" id="cfRestore" hidden>Restore last fighter</button>
      <button class="btn small" id="cfExport">Export code</button><button class="btn small" id="cfImport">Import code</button>
      <button class="btn" id="cfSave">Save</button><button class="btn primary" id="cfFight">Save + fight ▶</button></footer>
  </div>`;
  // The creator's screen STAYS IN THE DOM even though every way into it was pulled (see the
  // entry-points note below). Detaching it looked tidy and broke the Store and the Profile outright
  // -- both came back with zero text and zero buttons, and errsweep went from 0 errors to 1, because
  // they are built relative to this node. A hidden, unreachable section costs nothing; the screens
  // the player actually uses cost everything. Left attached on purpose.
  document.body.appendChild(sec);

  let draft = null, backTo = 'scTitle';
  const art = id => 'assets/' + ASSET_ID(id) + '_cut.webp';

  function paintForm() {
    $c('cfName').value = draft.name; $c('cfTitle').value = draft.title; $c('cfX').value = draft.x || '';
    for (const [k] of GROUPS) sec.querySelectorAll(`[data-k="${k}"] [data-v]`).forEach(b => b.classList.toggle('on', b.dataset.v === draft[k]));
    sec.querySelectorAll('#cfTitles .cf-chip').forEach(b => b.classList.toggle('on', b.dataset.t === draft.title));
    sec.querySelectorAll('#cfPresets .cf-chip').forEach(b => {
      const pr = PRESETS.find(x => x[0] === b.dataset.p);
      b.classList.toggle('on', !!pr && Object.keys(pr[2]).every(k => draft[k] === pr[2][k]));
    });
    { const g = $c('cfPatColGrp'); if (g) g.hidden = draft.pattern === 'none'; }
    sec.querySelectorAll('.cf-body').forEach(b => b.classList.toggle('on', b.dataset.id === draft.base));
    paintPlate();
  }
  function paintPlate() {
    $c('cfShowName').textContent = draft.name || 'Rookie';
    $c('cfShowTitle').textContent = draft.title;
    $c('cfShowX').textContent = draft.x ? '@' + draft.x : '';
    const c = CHAR_BY_ID[draft.base];
    $c('cfShowBase').textContent = c ? 'Body: ' + c.name + (c.title ? ' · ' + c.title : '') : '';
  }
  // Every change is saved, debounced -- there is no way to build a fighter and then lose it by not pressing Save.
  let autoT = 0;
  function autoSave() {
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      if (!draft) return;
      draft.name = cleanTxt($c('cfName').value).slice(0, 16) || 'Rookie';
      draft.title = cleanTxt($c('cfTitle').value).slice(0, 22);
      draft.x = cleanHandle($c('cfX').value);
      CustomLook.set(draft);
      const s = $c('cfSaved'); s.textContent = 'Saved'; s.classList.add('on'); clearTimeout(autoSave.t); autoSave.t = setTimeout(() => s.classList.remove('on'), 1200);
    }, 450);
  }
  function buildBodies() {
    const box = $c('cfBodies'); if (box.childElementCount === coreChars().length) return;   // 79_core
    box.innerHTML = '';
    for (const c of coreChars()) {
      const b = document.createElement('button'); b.className = 'cf-body'; b.dataset.id = c.id; b.id = 'cf_body_' + c.id; b.title = c.name;
      b.innerHTML = `<span>${esc(c.name)}</span>`;
      const im = new Image(); im.onload = () => { b.style.backgroundImage = `url(${im.src})`; }; im.onerror = () => { b.style.backgroundImage = `url(assets/${c.id}.jpg)`; }; im.src = art(c.id);
      b.addEventListener('click', () => { draft.base = c.id; sfx(); paintForm(); refresh(); autoSave(); });
      box.appendChild(b);
    }
  }
  sec.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const grp = b.closest('[data-k]'); if (!grp) return;
    draft[grp.dataset.k] = b.dataset.v; sfx(); paintForm(); refresh(); autoSave();
  });
  $c('cfPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const pr = PRESETS.find(x => x[0] === b.dataset.p); if (!pr) return;
    // a preset is the LOOK only: body, name, title and handle are the player's and are never touched
    Object.assign(draft, pr[2]);
    sfx(); paintForm(); refresh(); autoSave();
  });
  $c('cfTitles').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; draft.title = b.dataset.t; sfx(); paintForm(); autoSave(); });
  $c('cfName').addEventListener('input', e => { draft.name = cleanTxt(e.target.value).slice(0, 16); paintPlate(); autoSave(); });
  $c('cfX').addEventListener('input', e => { const v = cleanHandle(e.target.value); if (e.target.value !== v) e.target.value = v; draft.x = v; paintPlate(); autoSave(); });
  $c('cfTitle').addEventListener('input', e => { draft.title = cleanTxt(e.target.value).slice(0, 22); sec.querySelectorAll('#cfTitles .cf-chip').forEach(b => b.classList.toggle('on', b.dataset.t === draft.title)); paintPlate(); autoSave(); });
  $c('cfRandom').addEventListener('click', () => {
    const pick = list => list[Math.floor(Math.random() * list.length)][0];
    { const CC = coreChars(); draft.base = CC[Math.floor(Math.random() * CC.length)].id; }
    // Rolling all eleven controls independently is how Randomise used to produce a mess -- gold chrome
    // with jungle camo and a bow tie. Most of the time it now starts from a look that works and varies
    // two or three things off it, which is what a random button is actually for.
    if (Math.random() < 0.72) {
      Object.assign(draft, PRESETS[Math.floor(Math.random() * PRESETS.length)][2]);
      const vary = [['tint', TINTS], ['patcol', PATCOL], ['aura', AURA], ['eyes', EYES], ['neck', NECK], ['shoes', SHOES]];
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) { const v = vary[Math.floor(Math.random() * vary.length)]; draft[v[0]] = pick(v[1]); }
    } else {
      for (const [k, list] of GROUPS) draft[k] = pick(list);
    }
    if (Math.random() < 0.5) draft.title = TITLES[Math.floor(Math.random() * TITLES.length)];
    sfx(); paintForm(); refresh(); autoSave();
  });
  // export / import / restore: a wiped browser is no longer the end of a fighter
  $c('cfExport').addEventListener('click', async () => {
    sfx();
    draft.name = cleanTxt($c('cfName').value).slice(0, 16) || 'Rookie'; draft.title = cleanTxt($c('cfTitle').value).slice(0, 22); draft.x = cleanHandle($c('cfX').value);
    const code = b64.enc(sanitize(draft));
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch (e) { /* no clipboard permission */ }
    const s2 = $c('cfSaved'); s2.textContent = copied ? 'Code copied' : 'Code: ' + code.slice(0, 28) + '…'; s2.classList.add('on');
    if (!copied) window.prompt('Your fighter code — copy this:', code);
    clearTimeout(commit.t); commit.t = setTimeout(() => { s2.textContent = 'Saved'; s2.classList.remove('on'); }, 3000);
  });
  $c('cfImport').addEventListener('click', () => {
    sfx();
    const code = window.prompt('Paste a fighter code:', '');
    if (!code) return;
    const o = b64.dec(code);
    const s2 = $c('cfSaved');
    if (!o) { s2.textContent = 'That code did not read'; s2.classList.add('on'); clearTimeout(commit.t); commit.t = setTimeout(() => { s2.textContent = 'Saved'; s2.classList.remove('on'); }, 2500); return; }
    draft = sanitize(o); CustomLook.set(draft); draft = CustomLook.get();
    paintForm(); refresh(); setTimeout(grabThumb, 900);
    s2.textContent = 'Fighter loaded'; s2.classList.add('on'); clearTimeout(commit.t); commit.t = setTimeout(() => { s2.textContent = 'Saved'; s2.classList.remove('on'); }, 2500);
  });
  $c('cfRestore').addEventListener('click', () => {
    sfx();
    const o = loadSaved(); if (!o) return;
    draft = o; CustomLook.set(draft); draft = CustomLook.get(); paintForm(); refresh(); setTimeout(grabThumb, 900);
    $c('cfRestore').hidden = true;
  });
  function commit() {
    draft.name = cleanTxt($c('cfName').value).slice(0, 16) || 'Rookie';
    draft.title = cleanTxt($c('cfTitle').value).slice(0, 22);
    CustomLook.set(draft); draft = CustomLook.get(); paintForm();
    grabThumb();
    const s = $c('cfSaved'); s.classList.add('on'); clearTimeout(commit.t); commit.t = setTimeout(() => s.classList.remove('on'), 1800);
  }
  // A roster portrait of the fighter, taken off the preview canvas: same framing as assets/<id>_cut.webp
  // (full body, head near the top, transparent behind) so it drops into the tiles and plates unchanged.
  const SHOT_W = 376, SHOT_H = 560;
  function grabThumb() {
    if (!PV.r || !PV.model) { if (!shot) setShot(null); return; }
    const T = V3.THREE, r = PV.r, cv = r.domElement;
    const oldW = cv.width, oldH = cv.height, oldPR = r.getPixelRatio(), oldYaw = PV.holder.rotation.y;
    const oldAsp = PV.cam.aspect, oldPos = PV.cam.position.clone();
    const floor = PV.scene.children.find(o => o.isMesh && o.geometry && o.geometry.type === 'CircleGeometry');
    const floorVis = floor ? floor.visible : null;
    try {
      if (floor) floor.visible = false;
      r.setPixelRatio(1); r.setSize(SHOT_W, SHOT_H, false);
      PV.cam.aspect = SHOT_W / SHOT_H; PV.cam.position.set(0, 1.02, 4.35); PV.cam.updateProjectionMatrix(); PV.cam.lookAt(0, 0.93, 0);
      PV.holder.rotation.y = 0.38;
      r.render(PV.scene, PV.cam);
      setShot(cv.toDataURL('image/png'));
    } catch (e) { /* tainted canvas or lost context: the base art stands in */ }
    if (floor && floorVis != null) floor.visible = floorVis;
    r.setPixelRatio(oldPR); r.setSize(oldW / oldPR, oldH / oldPR, false);
    PV.cam.aspect = oldAsp; PV.cam.position.copy(oldPos); PV.cam.updateProjectionMatrix();
    PV.holder.rotation.y = oldYaw;
    try { paintEntryPoints(); } catch (e) { /* cosmetic */ }
  }
  $c('cfSave').addEventListener('click', () => { sfx(); commit(); });
  $c('cfFight').addEventListener('click', () => {
    sfx(); commit(); closeCreator(true);
    if (backTo === 'scSelect' && UI.slots && UI.slots.length) { useMine(UI.active || 0); UI.show('scSelect'); UI.renderSelect(); return; }
    UI.toSelect('cpu'); useMine(0); UI.renderSelect();
  });
  $c('cfBack').addEventListener('click', () => { sfx(); closeCreator(false); UI.show(backTo); if (backTo === 'scSelect') UI.renderSelect(); });

  function openCreator(from) {
    backTo = from || 'scTitle';
    draft = saved ? Object.assign({}, saved) : Object.assign({}, DEF);
    $c('cfRestore').hidden = !!saved || !backupExists();
    buildBodies(); paintForm();
    UI.show('scCustom');
    refresh(); pvLoop();
  }
  function closeCreator() { PV.running = false; }

  // The creator covers the whole screen, so the match behind it doesn't need drawing: skip the main
  // render pass while it is open (the preview canvas keeps its own loop). Composes with any other wrap.
  if (typeof R !== 'undefined' && typeof R.frame === 'function') {
    const origFrame = R.frame.bind(R);
    R.frame = function () { if (!sec.hidden) return; return origFrame(); };
  }

  // ---------------------------------------------------------------- live 3D preview
  const PV = { r: null, scene: null, cam: null, holder: null, model: null, mixer: null, act: null, yaw: 0.35, spin: 1, t: 0, drag: null, token: 0, running: false, last: 0 };
  function pvInit() {
    if (PV.r) return true;
    const T = window.V3 && V3.THREE; if (!T) return false;
    const cv = $c('cfCanvas');
    try { PV.r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { PV.r = null; return false; }   // preserve: the saved portrait is read back off this canvas
    PV.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    PV.r.toneMapping = T.ACESFilmicToneMapping; PV.r.toneMappingExposure = 1.05;
    PV.scene = new T.Scene();
    PV.cam = new T.PerspectiveCamera(26, 1, 0.05, 60);
    // a small studio for chrome and gold to reflect
    const ec = document.createElement('canvas'); ec.width = 256; ec.height = 128; const e2 = ec.getContext('2d');
    const gr = e2.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#6a7088'); gr.addColorStop(0.55, '#1a1c26'); gr.addColorStop(1, '#050507');
    e2.fillStyle = gr; e2.fillRect(0, 0, 256, 128);
    e2.fillStyle = '#ffffff'; e2.fillRect(100, 6, 60, 18); e2.fillRect(20, 44, 30, 20); e2.fillRect(190, 40, 36, 24);
    const et = new T.CanvasTexture(ec); et.colorSpace = T.SRGBColorSpace; et.mapping = T.EquirectangularReflectionMapping;
    const pm = new T.PMREMGenerator(PV.r); PV.scene.environment = pm.fromEquirectangular(et).texture; pm.dispose();
    PV.scene.environmentIntensity = 0.6;
    PV.scene.add(new T.HemisphereLight(0xdfe6ff, 0x20121a, 0.9));
    const key = new T.DirectionalLight(0xffffff, 2.4); key.position.set(-2, 4, 5); PV.scene.add(key);
    const rr = new T.DirectionalLight(0xff2a4a, 2.4); rr.position.set(4, 2, -3); PV.scene.add(rr);
    const rc = new T.DirectionalLight(0x27e1ff, 2.0); rc.position.set(-4, 1.5, -3); PV.scene.add(rc);
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const f2 = fc.getContext('2d');
    const fg = f2.createRadialGradient(64, 64, 0, 64, 64, 64); fg.addColorStop(0, 'rgba(255,42,74,.55)'); fg.addColorStop(0.45, 'rgba(255,42,74,.18)'); fg.addColorStop(1, 'rgba(255,42,74,0)');
    f2.fillStyle = fg; f2.fillRect(0, 0, 128, 128);
    const floor = new T.Mesh(new T.CircleGeometry(1.3, 48), new T.MeshBasicMaterial({ map: new T.CanvasTexture(fc), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; PV.scene.add(floor);
    PV.holder = new T.Group(); PV.scene.add(PV.holder);
    cv.addEventListener('pointerdown', e => { PV.drag = { x: e.clientX, yaw: PV.yaw + Math.sin(PV.t * 0.6) * 0.5 }; PV.t = 0; PV.yaw = PV.drag.yaw; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* old browser */ } });
    cv.addEventListener('pointermove', e => { if (PV.drag) PV.yaw = PV.drag.yaw + (e.clientX - PV.drag.x) * 0.012; });
    const up = () => { if (PV.drag) { PV.drag = null; PV.t = 0; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    return true;
  }
  function pvMsg(t) { const m = $c('cfMsg'); m.hidden = !t; m.textContent = t || ''; }
  function fallback2D(lk, note) {
    const im = $c('cfFallback'); im.hidden = false; $c('cfCanvas').style.visibility = 'hidden';
    im.onerror = () => { im.onerror = null; im.src = 'assets/' + lk.base + '.jpg'; };
    im.src = art(lk.base); im.style.filter = (CSS_TINT[lk.tint] || '') + ' drop-shadow(0 20px 30px rgba(0,0,0,.6))';
    pvMsg(note || '');
  }
  function disposeGear(o) { o.traverse(x => { if (x.userData && x.userData.cfGear && x.geometry) x.geometry.dispose(); }); }
  async function refresh() {
    if (!draft) return;
    const lk = sanitize(draft), tok = ++PV.token;
    if (window.V3 && V3.failed) return fallback2D(lk, '3D is off on this device. Your look still saves.');
    if (!window.V3 || !V3.ready || !pvInit()) {
      fallback2D(lk, 'Loading 3D…');
      const wait = () => { if (tok !== PV.token || sec.hidden) return; if (window.V3 && (V3.ready || V3.failed)) refresh(); else setTimeout(wait, 400); };
      setTimeout(wait, 400); return;
    }
    try { await V3.loadChar(lk.base); } catch (e) { if (tok === PV.token) fallback2D(lk, 'This body has no 3D model yet.'); return; }
    if (tok !== PV.token) return;
    const T = V3.THREE, mk = V3.makeModel(lk.base); if (!mk) return;
    $c('cfFallback').hidden = true; $c('cfCanvas').style.visibility = ''; pvMsg('');
    if (PV.model) { PV.holder.remove(PV.model); disposeGear(PV.model); }
    if (PV.mixer) PV.mixer.stopAllAction();
    const s = 1.7 / mk.height;
    mk.root.scale.setScalar(s); mk.root.position.y = -mk.minY * s;
    PV.holder.add(mk.root);
    try { applyLook(lk, mk.root, T, lk.base); } catch (e) { console.warn('custom look', e); }
    let hips = null; mk.root.traverse(o => { if (o.isBone && o.name === 'Hips' && !hips) hips = o; });
    const clips = V3.clipsFor(lk.base, hips ? hips.position.clone() : null);
    PV.mixer = new T.AnimationMixer(mk.root);
    const clip = clips.guard || clips.idle; PV.act = null;
    if (clip) { PV.act = PV.mixer.clipAction(clip); PV.act.play(); PV.range = (window.CLIP_RANGE || {})[clip.name] || null; }
    PV.model = mk.root;
  }
  function pvLoop() {
    if (PV.running) return;
    PV.running = true; PV.last = performance.now();
    const step = now => {
      if (!PV.running || sec.hidden) { PV.running = false; return; }
      requestAnimationFrame(step);
      if (!PV.r) return;
      const dt = Math.min(0.05, (now - PV.last) / 1000); PV.last = now;
      const cv = PV.r.domElement, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
      if (cv.width !== Math.round(w * PV.r.getPixelRatio()) || cv.height !== Math.round(h * PV.r.getPixelRatio())) { PV.r.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); }
      const narrow = w / h < 0.9;
      PV.cam.position.set(0, 1.0, narrow ? 6.2 : 5.0); PV.cam.lookAt(0, 0.95, 0);
      // a slow sway around a front three-quarter view; dragging takes over
      if (!PV.drag) PV.t += dt * PV.spin;
      PV.holder.rotation.y = PV.yaw + (PV.drag ? 0 : Math.sin(PV.t * 0.6) * 0.5);
      if (PV.mixer) {
        PV.mixer.update(dt);
        if (PV.act && PV.range) { const [a, b] = PV.range; if (PV.act.time < a || PV.act.time > b) PV.act.time = a; }
      }
      PV.r.render(PV.scene, PV.cam);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- entry points: title menu + fighter select
  //
  // PULLED 2026-09-29 on Duane's call ("remove the create character option"). Everything above this
  // line stays: `window.CustomLook` is still defined, so 91_v3_render can still paint a look onto an
  // avatar and 77_net can still show an ONLINE opponent who built one. What is gone is every way to
  // reach the creator from this build -- the title menu item, the two fighter-select buttons, the
  // roster tile, its keyboard handling and the #custom route, all of which live below.
  //
  // To put it back, delete this return.
  return;

  const tmenu = document.querySelector('#scTitle .tb-menu');
  let titleBtn = null;
  if (tmenu) {
    titleBtn = document.createElement('button'); titleBtn.id = 'bMyFighter'; titleBtn.className = 'tb-item';
    titleBtn.style.animationDelay = '0.31s';
    titleBtn.addEventListener('mouseenter', sfx);
    titleBtn.addEventListener('click', () => { sfx(); openCreator('scTitle'); });
    const first = tmenu.querySelector('.tb-item');
    if (first && first.nextSibling) tmenu.insertBefore(titleBtn, first.nextSibling); else tmenu.appendChild(titleBtn);
  }
  const selRow = document.querySelector('#scSelect .sel-top .row');
  let selMine = null, selEdit = null;
  if (selRow) {
    selMine = document.createElement('button'); selMine.className = 'btn small cf-mine'; selMine.id = 'bPlayMine';
    selEdit = document.createElement('button'); selEdit.className = 'btn small'; selEdit.id = 'bEditMine'; selEdit.textContent = 'Edit your fighter';
    selMine.addEventListener('click', () => {
      sfx();
      if (!saved) return openCreator('scSelect');
      const i = UI.active || 0; useMine(i);
      UI.active = (i + 1) % UI.slots.length; UI.renderSelect();
    });
    selEdit.addEventListener('click', () => { sfx(); openCreator('scSelect'); });
    selRow.prepend(selMine, selEdit);
  }
  function useMine(i) { const s = UI.slots && UI.slots[i]; if (!s || !saved) return; s.char = saved.base; s.custom = true; }
  function pickMine() {
    if (!saved) return openCreator('scSelect');
    const i = UI.active || 0; useMine(i);
    UI.active = (i + 1) % UI.slots.length; UI.renderSelect();
  }

  // ---------------------------------------------------------------- "Your fighter" everywhere it is shown
  // The select screen used to show the stock cutout, so the gear, hair, colours and name only appeared once
  // the match started. The creator now renders the live 3D preview to a portrait and every screen uses it.
  function thumb() { return shot; }
  function thumbFor(f) {   // f is a Fighter or a slot
    if (!shot || !saved) return null;
    const s = f && (f.slot || f);
    if (s && s.custom) return shot;
    if (f && f.slot && f.slot.customLook) return null;      // an online opponent's look: no picture of it here
    return null;
  }
  function hudArt(f) { const u = thumbFor(f); return u && shotImg && shotImg.complete && shotImg.naturalWidth ? shotImg : null; }
  function hudTag(f) { const lk = lookFor(f); return lk && lk.x ? '@' + lk.x : ''; }
  const setTxt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  function dressHero(el, s, c) {
    const img = el.querySelector('img'); if (!img) return;
    const mine = s && s.custom && shot;
    if (mine) {
      if (img.getAttribute('src') !== shot) img.setAttribute('src', shot);
      if (img.dataset.cfMine !== '1') img.dataset.cfMine = '1';
      const nm = el.querySelector('.nm'), tt = el.querySelector('.ttl');
      setTxt(nm, saved.name);
      setTxt(tt, saved.title || (c && c.title) || '');
      let xa = el.querySelector('.cf-x');
      if (saved.x) { if (!xa) { xa = document.createElement('div'); xa.className = 'cf-x'; (tt || nm).after(xa); } setTxt(xa, '@' + saved.x); if (xa.hidden) xa.hidden = false; }
      else if (xa && !xa.hidden) xa.hidden = true;
      el.classList.add('cf-hero');
    } else if (img.dataset.cfMine) { delete img.dataset.cfMine; el.classList.remove('cf-hero'); const xa = el.querySelector('.cf-x'); if (xa) xa.hidden = true; if (c) art2(c.id, u => { if (img.getAttribute('src') !== u) img.setAttribute('src', u); }); }
  }
  const ART2 = {};
  function art2(id, cb) {                                   // same cutout-or-jpg fallback 85_menu uses
    if (ART2[id]) return cb(ART2[id]);
    const im = new Image();
    im.onload = () => { ART2[id] = im.src; cb(im.src); };
    im.onerror = () => { ART2[id] = 'assets/' + id + '.jpg'; cb(ART2[id]); };
    im.src = art(id);
  }
  // the player's own tile, first in the select grid
  function ensureRosterTile() {
    const ro = $c('roster'); if (!ro) return;
    let tile = ro.querySelector('.cf-pick');
    if (!tile) {
      tile = document.createElement('button'); tile.className = 'cf-pick'; tile.id = 'pick_mine';
      tile.innerHTML = '<span class="face"></span><span class="badge">YOUR FIGHTER</span><span class="nm"></span>';
      tile.addEventListener('click', () => { sfx(); if (!saved) openCreator('scSelect'); else pickMine(); });
      tile.addEventListener('dblclick', () => { sfx(); openCreator('scSelect'); });
    }
    if (ro.firstElementChild !== tile) ro.prepend(tile);
    tile.title = saved ? saved.name + ' · your fighter (double-click to edit)' : 'Build your fighter';
    setTxt(tile.querySelector('.nm'), saved ? saved.name : 'BUILD ONE');
    const face = tile.querySelector('.face');
    if (saved && shot) { face.style.backgroundImage = `url(${shot})`; face.classList.add('cf-shot'); }
    else if (saved) { face.classList.remove('cf-shot'); art2(saved.base, u => { face.style.backgroundImage = `url(${u})`; }); }
    else { face.style.backgroundImage = 'none'; face.classList.remove('cf-shot'); }
    tile.classList.toggle('on', !!(UI.slots || []).some(s => s.custom));
  }
  function paintEntryPoints() {
    if (titleBtn) {
      titleBtn.innerHTML = `<i>02</i><b>Your fighter</b><em>▶</em><small>${saved ? esc(saved.name) + (saved.title ? ' · ' + esc(saved.title) : '') : 'Build, colour and name your own fighter'}</small><span class="tb-badge">NEW</span>`;
      if (tmenu) [...tmenu.querySelectorAll('.tb-item')].forEach((b, k) => { const n = b.querySelector('i'); if (n) n.textContent = String(k + 1).padStart(2, '0'); });
    }
    if (selMine) { selMine.textContent = saved ? '★ Play as ' + saved.name : '★ Build your fighter'; selEdit.hidden = !saved; }
  }
  paintEntryPoints();

  // fighter select: name + picture wherever a slot plays as your fighter
  let fixing = false;
  function fixSelectNames() {
    if (fixing || !UI.slots) return;
    fixing = true;
    try { fixSelectNamesInner(); } finally { fixing = false; }
  }
  function fixSelectNamesInner() {
    ensureRosterTile();
    if (!saved) return;
    const base = CHAR_BY_ID[saved.base];
    const slotEls = $c('slots') ? [...$c('slots').children] : [];
    UI.slots.forEach((s, i) => {
      const el = slotEls[i]; if (!el) return;
      el.classList.toggle('cf-slot', !!s.custom);
      if (!s.custom) return;
      setTxt(el.querySelector('.nm'), saved.name);
      const face = el.querySelector('.face'); if (face && shot && face.dataset.cfMine !== '1') { face.style.backgroundImage = `url(${shot})`; face.style.backgroundSize = 'contain'; face.style.backgroundPosition = '50% 100%'; face.dataset.cfMine = '1'; }
    });
    [['heroP1', 0], ['heroP2', 1]].forEach(([id, i]) => {
      const el = $c(id), s = UI.slots[i]; if (!el || !s || !base) return;
      if (!s.custom) return;
      try { dressHero(el, s, base); } catch (e) { /* cosmetic */ }
    });
    // wager screen portraits
    const wg = $c('wagers');
    if (wg) [...wg.querySelectorAll('.wcard')].forEach((el, i) => {
      const s = UI.slots[i]; if (!s || !s.custom) return;
      setTxt(el.querySelector('.pn'), (s.ctrl === 'cpu' ? 'CPU' : 'P' + (i + 1)) + ' · ' + saved.name);
      const cv = el.querySelector('canvas');
      if (cv && shot && shotImg && shotImg.complete && shotImg.naturalWidth) {
        const g2 = cv.getContext('2d'); g2.clearRect(0, 0, cv.width, cv.height);
        const sc = Math.min(cv.width / shotImg.naturalWidth, cv.height / shotImg.naturalHeight);
        const w2 = shotImg.naturalWidth * sc, h2 = shotImg.naturalHeight * sc;
        g2.drawImage(shotImg, (cv.width - w2) / 2, cv.height - h2, w2, h2);
      }
    });
  }
  if (typeof UI !== 'undefined' && UI.renderSelect) {
    const origRS = UI.renderSelect;
    UI.renderSelect = function () {
      for (const s of this.slots || []) if (s.custom && (!saved || s.char !== saved.base)) s.custom = false;
      const r = origRS.apply(this, arguments);
      try { fixSelectNames(); } catch (e) { /* cosmetic */ }
      return r;
    };
    for (const id of ['heroP1', 'heroP2']) { const el = $c(id); if (el) new MutationObserver(() => { try { fixSelectNames(); } catch (e) { /* cosmetic */ } }).observe(el, { childList: true, subtree: true, characterData: true }); }
    const origW = UI.renderWagers;
    if (origW) UI.renderWagers = function () { const r = origW.apply(this, arguments); try { fixSelectNames(); } catch (e) { /* cosmetic */ } return r; };
  }
  // results screen: the winner's own handle under the name
  if (typeof UI !== 'undefined' && UI.showResults) {
    const origShow = UI.showResults;
    UI.showResults = function (w) {
      const r = origShow.apply(this, arguments);
      try {
        const lk = lookFor(w), box = $c('winName');
        if (box) {
          let xa = box.parentNode.querySelector('.cf-x');
          if (lk && lk.x) { if (!xa) { xa = document.createElement('div'); xa.className = 'cf-x'; box.after(xa); } setTxt(xa, '@' + lk.x); if (xa.hidden) xa.hidden = false; }
          else if (xa && !xa.hidden) xa.hidden = true;
        }
      } catch (e) { /* cosmetic */ }
      return r;
    };
  }
  // ---------------------------------------------------------------- keyboard / pad reach the tile
  // 85_menu drives the grid off `.pick` and picks with `CHARS[cursor].id`, so the custom tile — which is
  // deliberately NOT a `.pick` (adding the class makes the roster length test rebuild the grid every frame
  // and knocks every CHARS index off by one) — was unreachable by anything except a mouse. Anyone playing
  // on a keyboard or a pad simply never saw their own fighter.
  //
  // This is a capture-phase listener, so it gets each key before 85_menu's own. It only ever swallows a key
  // when the cursor is actually parked on the tile, or when Left would wrap off the first column onto it;
  // every other key falls through untouched.
  let kbOnMine = false;
  const mineTile = () => { const ro = $c('roster'); return ro && ro.querySelector('.cf-pick'); };
  function paintMineCursor() {
    const t = mineTile(); if (t) t.classList.toggle('cf-cur', kbOnMine);
    if (kbOnMine) { const ro = $c('roster'); if (ro) [...ro.querySelectorAll('.pick.cur')].forEach(b => b.classList.remove('cur')); }
  }
  function leaveMine() { if (kbOnMine) { kbOnMine = false; paintMineCursor(); } }
  addEventListener('keydown', e => {
    const S = $c('scSelect'); if (!S || S.hidden) { kbOnMine = false; return; }
    const ro = $c('roster'), t = mineTile(); if (!ro || !t) return;
    const code = e.code;
    if (kbOnMine) {
      if (code === 'Enter' || code === 'KeyF' || code === 'KeyK') {
        e.preventDefault(); e.stopImmediatePropagation(); sfx();
        leaveMine(); pickMine(); return;                          // no fighter saved yet -> pickMine opens the creator
      }
      // any move off the tile hands the grid back to 85_menu, which resumes from its own cursor
      if (/^(Arrow(Right|Left|Up|Down)|Key[WASD])$/.test(code)) { leaveMine(); return; }
      return;
    }
    // Left from the first tile in the grid steps onto the custom tile instead of wrapping to the last fighter.
    // `at === -1` is the case that actually matters most: arriving at the select screen and pressing Left
    // before the grid has a cursor at all, which is exactly what a pad player does first.
    if (code === 'ArrowLeft' || code === 'KeyA') {
      const picks = [...ro.querySelectorAll('.pick')];
      const at = picks.findIndex(b => b.classList.contains('cur'));
      if (at === 0 || at === -1) {
        e.preventDefault(); e.stopImmediatePropagation(); sfx();
        kbOnMine = true; paintMineCursor();
      }
    }
  }, true);
  // a mouse anywhere in the grid takes the keyboard highlight back off the tile
  addEventListener('mouseover', e => { if (kbOnMine && e.target && e.target.closest && e.target.closest('#roster .pick')) leaveMine(); }, true);

  if (/^#custom\b/.test(location.hash)) setTimeout(() => openCreator('scTitle'), 60);
})();
