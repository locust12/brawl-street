// ===== mascot + projectile drawing (procedural, no image files) =====
// Draws facing right with origin at the feet. pose: {t, legs, hand:{x,y}, back:{x,y}, sq, flash, hatGone, crouch, batAng, spin, dizzy}
function drawMascot(ctx, c, pose) {
  const L = c.look, w = c.w, h = c.h, u = h / 76;
  const P = pose || {};
  if (P.hidden) return;   // teleport frames, swallowed (21_roster2)
  const col = v => (P.flash ? '#ffffff' : P.stone ? '#8e8c96' : v);
  const line = col(L.dark);
  ctx.save();
  const sq = P.sq || 0;
  ctx.scale(1 + sq * 0.5, 1 - sq);
  if (P.crouch) ctx.scale(1.14, 0.64);   // matches the 3D crouch pose / the ducked hurtbox (97_v3_pose, 60_game)
  if (P.spin) { ctx.translate(0, -h * 0.5); ctx.rotate(P.spin); ctx.translate(0, h * 0.5); }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 3 * u; ctx.strokeStyle = line;
  const blob = (x, y, rx, ry, fill, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fillStyle = col(fill); ctx.fill(); ctx.stroke(); };

  const lp = P.legs || 0;
  const bird = L.kind === 'bird', frog = L.kind === 'frog';
  // tail
  if (L.kind === 'dog') {
    ctx.beginPath(); ctx.lineWidth = 9 * u; ctx.strokeStyle = line;
    const tw = Math.sin((P.t || 0) * 0.3) * 4 * u;
    ctx.moveTo(-w * 0.36, -h * 0.34); ctx.quadraticCurveTo(-w * 0.72, -h * 0.5 + tw, -w * 0.45, -h * 0.66 + tw); ctx.stroke();
    ctx.lineWidth = 5 * u; ctx.strokeStyle = col(L.fur); ctx.stroke();
    ctx.lineWidth = 3 * u; ctx.strokeStyle = line;
  }
  // back arm
  const back = P.back || { x: -w * 0.12, y: -h * 0.3 };
  limb(ctx, -w * 0.05, -h * 0.42, back.x, back.y, 9 * u, col(L.ear), line);
  // legs
  const legY = -5 * u;
  blob(-w * 0.2 + Math.sin(lp) * 7 * u, legY - Math.max(0, Math.cos(lp)) * 4 * u, 11 * u, 7 * u, bird ? '#ff9b2f' : L.ear);
  blob(w * 0.2 - Math.sin(lp) * 7 * u, legY - Math.max(0, -Math.cos(lp)) * 4 * u, 11 * u, 7 * u, bird ? '#ff9b2f' : L.ear);

  if (bird) {
    blob(0, -h * 0.46, w * 0.47, h * 0.45, L.fur);
    blob(w * 0.1, -h * 0.4, w * 0.3, h * 0.33, L.belly);
    // flippers drawn as the hands
  } else {
    blob(0, -h * 0.33, w * 0.42, h * 0.27, L.fur);
    blob(w * 0.1, -h * 0.3, w * 0.25, h * 0.19, L.belly);
  }
  // accessories under the head
  if (L.acc === 'bandana' || L.acc === 'scarf') {
    ctx.beginPath();
    const ny = bird ? -h * 0.6 : -h * 0.5;
    ctx.moveTo(-w * 0.3, ny - 4 * u); ctx.quadraticCurveTo(0, ny + 10 * u, w * 0.34, ny - 4 * u); ctx.lineTo(w * 0.3, ny + 6 * u);
    ctx.quadraticCurveTo(0, ny + 20 * u, -w * 0.3, ny + 6 * u); ctx.closePath();
    ctx.fillStyle = col(L.acc === 'bandana' ? '#d11f3a' : '#ff4fd8'); ctx.fill(); ctx.stroke();
    if (L.acc === 'scarf') { ctx.beginPath(); ctx.moveTo(-w * 0.26, ny + 6 * u); ctx.lineTo(-w * 0.42, ny + 26 * u + Math.sin((P.t || 0) * 0.25) * 3); ctx.lineTo(-w * 0.28, ny + 24 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  if (L.acc === 'coin') {
    ctx.beginPath(); ctx.moveTo(-w * 0.18, -h * 0.52); ctx.quadraticCurveTo(w * 0.1, -h * 0.4, w * 0.3, -h * 0.5); ctx.lineWidth = 4 * u; ctx.strokeStyle = col('#c0392b'); ctx.stroke();
    ctx.lineWidth = 3 * u; ctx.strokeStyle = line;
    coinGlyph(ctx, w * 0.14, -h * 0.42, 9 * u, P.flash);
  }

  // head
  const hx = w * 0.1, hy = bird ? -h * 0.66 : -h * 0.68, hr = h * 0.27;
  if (L.kind === 'dog') {
    ear(ctx, hx - hr * 0.55, hy - hr * 0.6, -0.35, hr, col(L.ear), line, col(L.belly));
    blob(hx, hy, hr, hr * 0.92, L.fur);
    ear(ctx, hx + hr * 0.25, hy - hr * 0.72, 0.2, hr, col(L.ear), line, col(L.belly));
    blob(hx + hr * 0.3, hy + hr * 0.3, hr * 0.5, hr * 0.36, L.belly);
    blob(hx + hr * 0.72, hy + hr * 0.18, hr * 0.42, hr * 0.3, L.belly);
    ctx.beginPath(); ctx.ellipse(hx + hr * 1.08, hy + hr * 0.08, hr * 0.14, hr * 0.11, 0, 0, TAU); ctx.fillStyle = col('#1a0f08'); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + hr * 0.62, hy + hr * 0.42); ctx.quadraticCurveTo(hx + hr * 0.8, hy + hr * 0.52, hx + hr * 0.98, hy + hr * 0.38); ctx.stroke();
    eyes(ctx, L.eye, hx + hr * 0.42, hy - hr * 0.2, hr, u, col, line, P);
  } else if (frog) {
    blob(hx, hy + hr * 0.1, hr * 1.2, hr * 0.85, L.fur);
    blob(hx - hr * 0.35, hy - hr * 0.62, hr * 0.42, hr * 0.4, L.fur);
    blob(hx + hr * 0.5, hy - hr * 0.62, hr * 0.42, hr * 0.4, L.fur);
    // Pepe-style heavy lids
    for (const ex of [hx - hr * 0.35, hx + hr * 0.5]) {
      ctx.beginPath(); ctx.ellipse(ex + hr * 0.05, hy - hr * 0.6, hr * 0.3, hr * 0.26, 0, 0, TAU); ctx.fillStyle = col('#ffffff'); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex + hr * 0.14, hy - hr * 0.56, hr * 0.12, 0, TAU); ctx.fillStyle = col('#1b1b1b'); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex + hr * 0.05, hy - hr * 0.72, hr * 0.33, hr * 0.17, 0, Math.PI, TAU); ctx.fillStyle = col(L.fur); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(hx - hr * 0.4, hy + hr * 0.3); ctx.quadraticCurveTo(hx + hr * 0.4, hy + hr * 0.5, hx + hr * 1.15, hy + hr * 0.18);
    ctx.lineWidth = 7 * u; ctx.strokeStyle = col('#b8423c'); ctx.stroke(); ctx.lineWidth = 3 * u; ctx.strokeStyle = line; ctx.stroke();
  } else {
    // penguin face sits on the body egg
    ctx.beginPath(); ctx.ellipse(hx + hr * 0.25, hy + hr * 0.05, hr * 0.8, hr * 0.62, 0, 0, TAU); ctx.fillStyle = col(L.belly); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + hr * 0.7, hy + hr * 0.05); ctx.lineTo(hx + hr * 1.35, hy + hr * 0.22); ctx.lineTo(hx + hr * 0.7, hy + hr * 0.4); ctx.closePath();
    ctx.fillStyle = col('#ff9b2f'); ctx.fill(); ctx.stroke();
    eyes(ctx, 'dot', hx + hr * 0.3, hy - hr * 0.2, hr, u, col, line, P);
    ctx.beginPath(); ctx.arc(hx - hr * 0.05, hy + hr * 0.3, hr * 0.14, 0, TAU); ctx.fillStyle = col('rgba(255,120,160,.55)'); ctx.fill();
  }
  if (L.acc === 'hat' && !P.hatGone) beanie(ctx, hx + hr * 0.05, hy - hr * 0.62, hr, u, col, line);

  // front arm (+ bat)
  const hand = P.hand || { x: w * 0.36, y: -h * 0.28 };
  if (L.acc === 'bat') {
    ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(P.batAng != null ? P.batAng : -1.1);
    ctx.beginPath(); ctx.moveTo(-4 * u, 0); ctx.lineTo(8 * u, -4 * u); ctx.lineTo(56 * u, -9 * u); ctx.arc(56 * u, 0, 9 * u, -Math.PI / 2, Math.PI / 2); ctx.lineTo(8 * u, 4 * u); ctx.closePath();
    ctx.fillStyle = col('#c98a4b'); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4 * u, -3 * u); ctx.lineTo(4 * u, 3 * u); ctx.lineWidth = 5 * u; ctx.strokeStyle = col('#7b3f12'); ctx.stroke();
    ctx.restore(); ctx.lineWidth = 3 * u; ctx.strokeStyle = line;
  }
  limb(ctx, w * 0.12, -h * 0.42, hand.x, hand.y, 10 * u, col(bird ? L.ear : L.fur), line);
  if (P.dizzy) {
    for (let i = 0; i < 3; i++) {
      const a = (P.t || 0) * 0.12 + i * TAU / 3;
      ctx.fillStyle = '#ffd45c'; ctx.font = `${14 * u}px sans-serif`; ctx.fillText('★', hx + Math.cos(a) * hr * 1.1 - 6, hy - hr * 1.2 + Math.sin(a) * 6);
    }
  }
  ctx.restore();
}

function limb(ctx, x0, y0, x1, y1, r, fill, line) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineWidth = r * 1.3 + 3; ctx.strokeStyle = line; ctx.stroke();
  ctx.lineWidth = r * 1.3 - 2; ctx.strokeStyle = fill; ctx.stroke();
  ctx.beginPath(); ctx.arc(x1, y1, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = line; ctx.stroke();
}
function ear(ctx, x, y, rot, hr, fill, line, inner) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.beginPath(); ctx.moveTo(-hr * 0.32, hr * 0.28); ctx.lineTo(0, -hr * 0.55); ctx.lineTo(hr * 0.34, hr * 0.28); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-hr * 0.16, hr * 0.2); ctx.lineTo(0, -hr * 0.3); ctx.lineTo(hr * 0.18, hr * 0.2); ctx.closePath(); ctx.fillStyle = inner; ctx.fill();
  ctx.restore();
}
function eyes(ctx, kind, x, y, hr, u, col, line, P) {
  const blink = ((P.t || 0) % 190) < 6;
  if (kind === 'happy' || blink) {
    ctx.beginPath(); ctx.arc(x, y + hr * 0.08, hr * 0.13, Math.PI * 1.1, Math.PI * 1.9); ctx.lineWidth = 3.4 * u; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - hr * 0.42, y + hr * 0.08, hr * 0.11, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.lineWidth = 3 * u; return;
  }
  const white = (ex, ey, r) => { ctx.beginPath(); ctx.ellipse(ex, ey, r, r * 1.1, 0, 0, TAU); ctx.fillStyle = col('#ffffff'); ctx.fill(); ctx.lineWidth = 2 * u; ctx.stroke(); };
  const pupil = (ex, ey, r) => { ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.fillStyle = col('#140b04'); ctx.fill(); ctx.beginPath(); ctx.arc(ex + r * 0.3, ey - r * 0.35, r * 0.3, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); };
  if (kind === 'side') {
    // the famous side-eye: pupils pushed to the back corner, brows raised
    white(x, y, hr * 0.17); white(x - hr * 0.42, y + hr * 0.02, hr * 0.14);
    pupil(x - hr * 0.07, y + hr * 0.02, hr * 0.08); pupil(x - hr * 0.48, y + hr * 0.04, hr * 0.07);
    ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(x - hr * 0.12, y - hr * 0.26); ctx.quadraticCurveTo(x + hr * 0.05, y - hr * 0.36, x + hr * 0.2, y - hr * 0.24); ctx.stroke();
  } else if (kind === 'fierce') {
    white(x, y, hr * 0.15); pupil(x + hr * 0.04, y + hr * 0.02, hr * 0.08);
    white(x - hr * 0.42, y + hr * 0.02, hr * 0.12); pupil(x - hr * 0.38, y + hr * 0.04, hr * 0.07);
    ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(x - hr * 0.2, y - hr * 0.3); ctx.lineTo(x + hr * 0.2, y - hr * 0.14); ctx.stroke();
  } else {
    pupil(x, y, hr * 0.1); pupil(x - hr * 0.42, y + hr * 0.02, hr * 0.085);
  }
  ctx.lineWidth = 3 * u;
}
function beanie(ctx, x, y, hr, u, col, line) {
  ctx.beginPath(); ctx.moveTo(x - hr * 0.95, y + hr * 0.25); ctx.quadraticCurveTo(x - hr * 0.9, y - hr * 0.95, x, y - hr * 0.95);
  ctx.quadraticCurveTo(x + hr * 0.95, y - hr * 0.9, x + hr * 0.95, y + hr * 0.25); ctx.closePath();
  ctx.fillStyle = col('#ff8cc6'); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(x - hr * 1.02, y + hr * 0.05, hr * 2.04, hr * 0.34, hr * 0.14); ctx.fillStyle = col('#ff5fae'); ctx.fill(); ctx.stroke();
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x + i * hr * 0.27, y + hr * 0.1); ctx.lineTo(x + i * hr * 0.27, y + hr * 0.34); ctx.lineWidth = 1.5 * u; ctx.stroke(); }
  ctx.lineWidth = 3 * u;
}
function coinGlyph(ctx, x, y, r, flash) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, flash ? '#fff' : '#fff3b0'); g.addColorStop(1, flash ? '#fff' : '#e0a412');
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = Math.max(1.5, r * 0.18); ctx.strokeStyle = '#8a5a00'; ctx.stroke();
  ctx.fillStyle = '#8a5a00'; ctx.font = `bold ${r * 1.2}px "Bungee",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Ð', x, y + r * 0.08); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function drawProjectile(ctx, p) {
  ctx.save(); ctx.translate(p.x, p.y);
  const r = p.r;
  if (p.kind === 'coin') { ctx.scale(Math.cos(p.age * 0.35), 1); coinGlyph(ctx, 0, 0, r, false); }
  else if (p.kind === 'bone') {
    ctx.rotate(p.age * 0.45); ctx.fillStyle = '#fff8ea'; ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(-r * 1.1, -r * 0.25, r * 2.2, r * 0.5, r * 0.2); ctx.fill(); ctx.stroke();
    for (const s of [-1, 1]) for (const t of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 1.1, t * r * 0.3, r * 0.34, 0, TAU); ctx.fill(); ctx.stroke(); }
  } else if (p.kind === 'hat') {
    ctx.rotate(p.age * 0.5); beanie(ctx, 0, r * 0.3, r * 1.1, r / 18, v => v, '#3b2410');
  } else if (p.kind === 'snow') {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#a8d8ff');
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#4c7bb8'; ctx.lineWidth = 2; ctx.stroke();
  } else drawProj2(ctx, p);
  ctx.restore();
}
// 2D fallback for the roster-2 projectile kinds (the 3D look lives in 94_v3_moves.mjs)
function drawProj2(ctx, p) {
  const r = p.r, c = p.color || '#ffffff', k = p.kind;
  const glow = (rad, inner) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad); g.addColorStop(0, '#ffffff'); g.addColorStop(inner || 0.35, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill(); };
  ctx.globalCompositeOperation = 'lighter';
  if (k === 'kibeam') {
    const d = p.dir || 1, L = p.len || 0, g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, c); g.addColorStop(0.5, '#ffffff'); g.addColorStop(0.7, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(d > 0 ? 0 : -L, -r, L, r * 2); glow(r * 1.8, 0.4);
  } else if (k === 'mud') {                           // MOODENG's wallow: a flat puddle on the deck
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(70,48,28,0.75)'; ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 1.5, r * 0.42, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(120,88,52,0.6)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, r * 0.35, r * 0.7, r * 0.2, 0, 0, TAU); ctx.fill();
  } else if (k === 'arcbolt' || k === 'voltbolt') {   // SPARK's homing bolt / VOLT's thrown one: a head with lightning trailing it
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = -p.vx / sp * r, uy = -p.vy / sp * r;
    ctx.strokeStyle = c; ctx.lineWidth = 4;
    for (let s2 = 0; s2 < 3; s2++) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let i = 1; i <= 5; i++) ctx.lineTo(ux * i * 0.55 + vrand(-6, 6), uy * i * 0.55 + vrand(-6, 6));
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    glow(r * 1.5, 0.3);
  } else if (k === 'bolt') {
    ctx.strokeStyle = c; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, -420);
    for (let i = 1; i <= 12; i++) ctx.lineTo((i % 2 ? 1 : -1) * vrand(8, 22), -420 + i * 35);
    ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); glow(r * 1.4);
  } else if (k === 'wave') {
    const g = ctx.createLinearGradient(0, -r * 1.6, 0, r); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, c);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, r * 0.4, r * 1.2, r * 1.6, 0, Math.PI, TAU); ctx.fill();
  } else if (k === 'star') {
    ctx.rotate(p.age * 0.4); ctx.fillStyle = c; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  } else if (k === 'finger' || k === 'blaster' || k === 'ki' || k === 'volley' || k === 'bullet' || k === 'pellet' || k === 'snipe' || k === 'rocket') {
    const s = Math.sign(p.vx || 1), len = k === 'finger' || k === 'snipe' ? 70 : k === 'blaster' || k === 'rocket' ? 34 : 20;
    ctx.strokeStyle = c; ctx.lineWidth = r * 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-s * len, 0); ctx.lineTo(0, 0); ctx.stroke(); glow(r * 1.6);
  } else if (k === 'banana') {
    ctx.rotate(p.age * 0.5); ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = c; ctx.lineWidth = r * 0.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -r * 0.4, r, 0.4, Math.PI - 0.4); ctx.stroke();
  } else if (k === 'cashblast') {
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#3ec46d' : '#ffd45c'; ctx.save(); ctx.rotate(i + p.age * 0.3); ctx.fillRect(-r * 0.5 + i * 4 - 10, -r * 0.2, r * 0.6, r * 0.3); ctx.restore(); }
  } else if (k === 'spore' || k === 'flame') {
    ctx.globalAlpha = k === 'spore' ? 0.55 : Math.max(0.2, 1 - p.age / (p.life + 1)); glow(r * 1.2, 0.2);
  } else if (k === 'rake') {                          // WOLVERINU's CROSS RAKE: the cut hangs where it was made
    const fade = Math.min(1, (p.life - p.age) / 16) * Math.min(1, p.age / 3 + 0.4);
    ctx.globalAlpha = Math.max(0.15, fade);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.strokeStyle = c; ctx.lineWidth = r * 0.24;
      ctx.beginPath(); ctx.moveTo(-r * 0.95, -r * 0.8 * s); ctx.lineTo(r * 0.95, r * 0.8 * s); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = r * 0.07; ctx.stroke();
    }
    glow(r * 0.9, 0.12);
  } else glow(r * 1.3);   // fireball, jolt, shadow, bubble, supernova, anything new
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// menu portraits: the fighter's key art when loaded, the vector mascot until then
const PORTRAITS = {};
// 15 Oct: these go out at LOW priority on purpose. This loop fires one request per fighter — 36 of
// them, plus the cut-outs the HUD preloads, so ~86 images leave in the first second of the page.
// An <img> is born at Low priority too, which meant the Store's own renders queued BEHIND all of
// them and did not come back for twenty seconds: you opened the shop and looked at empty boxes.
// Nothing on screen needs a portrait until the select screen opens, and that screen redraws itself
// on each one's onload, so dropping these to the back of the queue costs nothing and lets whatever
// the player is actually looking at go first.
function loadPortraits(onload) {
  for (const c of CHARS) {
    const im = new Image();
    try { im.fetchPriority = 'low'; } catch (e) { /* older engines ignore it */ }
    im.onload = () => onload && onload(c.id);
    im.src = 'assets/' + ASSET_ID(c.id) + '.jpg';
    PORTRAITS[c.id] = im;
  }
}
function drawArt(ctx, c, x, y, w, h, focus) {
  const im = PORTRAITS[c.id]; if (!im || !im.complete || !im.naturalWidth) return false;
  const f = focus || 0.62, sw = im.naturalWidth, sh = im.naturalHeight * f, s = Math.max(w / sw, h / sh);
  const cw = w / s, ch = h / s;
  ctx.drawImage(im, (sw - cw) / 2, 0, cw, ch, x, y, w, h);
  return true;
}
function drawPortrait(cv, c, opts = {}) {
  const ctx = cv.getContext('2d'), W = cv.width, Hc = cv.height;
  ctx.clearRect(0, 0, W, Hc);
  if (!opts.vector && drawArt(ctx, c, 0, 0, W, Hc, opts.focus)) return;
  if (!opts.bare) {
    const g = ctx.createRadialGradient(W / 2, Hc * 0.55, 4, W / 2, Hc * 0.55, W * 0.6);
    g.addColorStop(0, c.look.fur + '66'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hc);
  }
  const s = Math.min(W, Hc) / (c.h * 1.35);
  ctx.save(); ctx.translate(W / 2 - c.w * 0.05 * s, Hc * 0.9); ctx.scale(s, s);
  drawMascot(ctx, c, { t: opts.t || 0, hand: { x: c.w * 0.42, y: -c.h * 0.36 }, batAng: -1.3 });
  ctx.restore();
}
