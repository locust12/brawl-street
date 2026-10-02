// ===== Brawl Street HUD: Tekken-style top bars for 1v1, high-tech plates for 3-4 fighters =====
// Replaces R.hud (canvas overlay drawn over the 3D view). Visual only: reads Game/fighter state, never writes it,
// and never uses the seeded fight RNG (shake uses Math.random).
(function () {
  if (typeof R === 'undefined') return;
  const DISP = '"Barlow Condensed", Impact, sans-serif', MONO = '"JetBrains Mono", ui-monospace, monospace';
  const HEAD = {};
  function head(id) {
    let h = HEAD[id];
    if (!h) { h = HEAD[id] = new Image(); h.src = 'assets/' + ASSET_ID(id) + '_cut.webp'; }
    return h.complete && h.naturalWidth ? h : null;
  }
  const vis = new WeakMap();   // per-fighter display state: smoothed %, ghost trail, shake
  function vstate(f) {
    let v = vis.get(f);
    if (!v) { v = { shown: f.dmg, ghost: f.dmg, hold: 0, shake: 0, last: f.dmg, stocks: f.stocks, lost: 0 }; vis.set(f, v); }
    if (f.dmg > v.last + 0.5) { v.shake = 10; v.hold = 40; }
    if (f.dmg < v.last - 0.5) { v.ghost = f.dmg; v.shown = f.dmg; }   // respawn resets
    if (f.stocks < v.stocks) v.lost = 50;
    v.stocks = f.stocks; v.last = f.dmg;
    v.shown += (f.dmg - v.shown) * 0.35;
    if (v.hold > 0) v.hold--; else v.ghost += (v.shown - v.ghost) * 0.08;
    if (v.shake > 0) v.shake--; if (v.lost > 0) v.lost--;
    return v;
  }
  // damage colour: white -> gold -> orange -> blood red, like Smash
  function dmgCol(d, a = 1) {
    const k = Math.min(1, d / 160);
    const h = 50 - 50 * k, l = 96 - 44 * k, s = 100;
    return `hsla(${h},${s}%,${l}%,${a})`;
  }
  const slant = (ctx, x, y, w, h, s) => { ctx.beginPath(); ctx.moveTo(x + s, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - s, y + h); ctx.lineTo(x, y + h); ctx.closePath(); };
  function chromeText(ctx, txt, x, y, size, align, glow) {
    ctx.font = `italic 900 ${size}px ${DISP}`; ctx.textAlign = align || 'left';
    const g = ctx.createLinearGradient(0, y - size * 0.82, 0, y);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.42, '#eef0f5'); g.addColorStop(0.52, '#8f96a8'); g.addColorStop(0.6, '#ffffff'); g.addColorStop(1, '#c9ced9');
    ctx.lineWidth = Math.max(3, size / 9); ctx.strokeStyle = 'rgba(5,5,7,.85)'; ctx.lineJoin = 'round'; ctx.strokeText(txt, x, y);
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * 0.35; }
    ctx.fillStyle = g; ctx.fillText(txt, x, y); ctx.shadowBlur = 0;
  }
  function portrait(ctx, f, x, y, s, flip) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(x + s, y); ctx.lineTo(x + s, y + s - 8); ctx.lineTo(x + s - 8, y + s); ctx.lineTo(x, y + s); ctx.lineTo(x, y + 8); ctx.closePath();
    const bg = ctx.createLinearGradient(x, y, x + s, y + s); bg.addColorStop(0, '#1a1c28'); bg.addColorStop(1, '#07080c');
    ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    const g = ctx.createRadialGradient(x + s / 2, y + s * 0.8, 2, x + s / 2, y + s * 0.8, s * 0.8); g.addColorStop(0, f.color + '88'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    const im = (window.CustomLook && CustomLook.hudArt && CustomLook.hudArt(f)) || head(f.c.id);   // "Your fighter" uses its own render
    // `naturalWidth` as well as `im`: the <img> exists from the first frame but is empty until it
    // downloads, and drawing it then left an empty dark plate where a face should be (caught in
    // dev/perf_shots, 9/21). Fall through to the procedural art instead, which is always ready.
    if (im && im.naturalWidth) {
      const cw = im.naturalWidth * 0.7, cx = (im.naturalWidth - cw) / 2;
      if (flip) { ctx.translate(x * 2 + s, 0); ctx.scale(-1, 1); }
      ctx.drawImage(im, cx, 0, cw, cw, x, y + 2, s, s);
    } else if (typeof drawArt === 'function') drawArt(ctx, f.c, x, y, s, s, 0.4);
    ctx.restore();
    ctx.strokeStyle = f.finalReady ? `hsl(${(f.t * 6) % 360},100%,65%)` : f.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(x + s, y); ctx.lineTo(x + s, y + s - 8); ctx.lineTo(x + s - 8, y + s); ctx.lineTo(x, y + s); ctx.lineTo(x, y + 8); ctx.closePath(); ctx.stroke();
  }
  // long segmented damage meter; fills toward danger (0-200%) with a ghost trail of the last combo
  function meter(ctx, f, v, x, y, w, h, flip) {
    const k = Math.min(1, v.shown / 200), kg = Math.min(1, v.ghost / 200);
    ctx.save();
    slant(ctx, x, y, w, h, h * 0.8);
    ctx.fillStyle = 'rgba(5,6,10,.82)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip();
    const fx = w * k, gx = w * kg, x0 = flip ? x + w : x, dir = flip ? -1 : 1;
    // ghost (recent damage), then the live fill
    if (gx < fx - 0.5) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(flip ? x0 - fx : x0 + gx, y, fx - gx, h); }
    const gr = ctx.createLinearGradient(x0, 0, x0 + dir * w, 0);
    gr.addColorStop(0, '#fff6d8'); gr.addColorStop(0.35, '#ffc83d'); gr.addColorStop(0.65, '#ff6a3d'); gr.addColorStop(1, '#ff1a3a');
    ctx.fillStyle = gr; ctx.fillRect(flip ? x0 - Math.min(fx, gx) : x0, y, Math.min(fx, gx), h);
    // gloss + segment ticks
    const gl = ctx.createLinearGradient(0, y, 0, y + h); gl.addColorStop(0, 'rgba(255,255,255,.35)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = gl; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(5,5,7,.55)';
    for (let i = 1; i < 20; i++) ctx.fillRect(x + (w * i) / 20, y, 1.5, h);
    // danger pulse past 120%
    if (v.shown > 120) { ctx.fillStyle = `rgba(255,40,60,${0.18 + 0.15 * Math.sin(performance.now() / 90)})`; ctx.fillRect(x, y, w, h); }
    ctx.restore();
  }
  function stocks(ctx, f, x, y, flip, v, pip) {
    const n = Math.max(0, f.stocks), step = pip || 16, r = step * 0.28;
    // one pip per stock is right for a 2-5 stock match and absurd above it: training runs 99, which
    // would have drawn 99 diamonds 16px apart, straight across the screen. Past six, draw one and count.
    if (n > 6) {
      const inf = window.TRAIN && TRAIN.on;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 8; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.2; ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = `700 ${Math.round(step * 0.78)}px ${MONO}`;
      ctx.textBaseline = 'middle'; ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText(inf ? '∞' : '×' + n, flip ? x - step * 0.9 : x + step * 0.9, y);
      ctx.restore();
      return;
    }
    for (let s = 0; s < n; s++) {
      const cx = flip ? x - s * step : x + s * step;
      ctx.save(); ctx.translate(cx, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 8; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.2; ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    if (v.lost > 0) { // the stock that just broke flies off
      const k = 1 - v.lost / 50, cx = flip ? x - n * step : x + n * step;
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(cx + (flip ? -1 : 1) * k * 30, y - k * 24); ctx.rotate(Math.PI / 4 + k * 4);
      ctx.fillStyle = '#fff'; ctx.fillRect(-r * 1.1, -r * 1.1, r * 2.2, r * 2.2); ctx.restore();
    }
  }
  // PUMP meter (25_feel): fills with damage dealt and taken; half = Burst, full = Pump Mode
  window.TB_PUMP_IN_HUD = true;
  function pumpBar(ctx, f, x, y, w, flip, noLabel) {
    if (!Game.feel) return;
    const pumped = f.powerT > 0, k = pumped ? f.powerT / (typeof FEEL !== 'undefined' ? FEEL.PUMP_T : 360) : Math.min(1, (f.pump || 0) / 100);
    const h = 5, t = performance.now();
    ctx.save();
    ctx.fillStyle = 'rgba(5,6,10,.8)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x, y, w, 1);
    const full = !pumped && k >= 1, half = !pumped && k >= 0.5;
    const col = pumped ? `hsl(${45 + 10 * Math.sin(t / 90)},100%,60%)` : full ? `hsl(${45 + 10 * Math.sin(t / 120)},100%,58%)` : half ? '#7ff0ff' : '#3a8fb0';
    if (full || pumped) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10; }
    ctx.fillStyle = col; ctx.fillRect(flip ? x + w - w * k : x, y, w * k, h); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(x + w / 2 - 0.5, y, 1, h);   // Burst notch
    if (!noLabel) {
      ctx.font = `700 8px ${MONO}`; ctx.textAlign = flip ? 'right' : 'left'; ctx.fillStyle = pumped || full ? '#ffd23f' : 'rgba(255,255,255,.45)';
      ctx.fillText(pumped ? 'PUMPED' : full ? 'PUMP READY' : 'PUMP', flip ? x + w : x, y + h + 9);
    }
    ctx.restore();
  }
  const tagOf = (G, f, i) => G.arenaTags ? (G.arenaTags[i] || '') : f.cpu ? 'CPU' : 'P' + (i + 1);

  // ---- ONE layout budget for the whole screen ----
  // Everything that sits over the arena is placed from this: the bars, the clock, the map name, the
  // now-playing label, the controls tab, and -- most of all -- the camera, which reads `TB_HUD.layout`
  // every frame so no fighter is ever framed underneath a HUD plate (91_v3_render.mjs).
  // `top`/`bottom` are the HARD insets in CSS px: opaque chrome the action must stay clear of.
  // The touch stick and buttons are NOT in here: they are translucent and sit in the corners, so the
  // camera is allowed to frame through them (that is how every phone action game does it).
  function layout(W, H, n, touch) {
    const s = clamp(W / 1180, 0.62, 1);                     // everything shrinks on a narrow screen
    const compact = !!touch || H < 560 || W < 820;
    let L;
    if (n <= 2) {
      const bs = compact ? s * 0.8 : s;                     // the Tekken bars' own scale
      L = { s, bs, n, compact, mode: 'bars', clockY: Math.round(10 * bs), clockS: bs,
        top: Math.round(128 * bs) + 8, bottom: compact ? 56 : 44 };
    } else if (compact) {
      // 3-4 on a phone: the plates move UP beside the clock, because the bottom belongs to the thumbs
      const bs = s * 0.9;
      L = { s, bs, n, compact, mode: 'topRow', clockY: Math.round(4 * bs), clockS: bs * 0.8,
        top: Math.round(56 * bs) + 16, bottom: 50 };
    } else {
      L = { s, bs: s, n, compact, mode: 'plates', clockY: 12, clockS: s,
        top: Math.round(96 * s), bottom: 104 };
    }
    L.left = 0; L.right = 0;
    // ---- the two chrome slots other files are allowed to use ----
    // `util`: the pause / sound / controls row, top centre, directly under the clock plate.
    // `np`:   the now-playing (and any transient) label, bottom centre, clear of the stick, the
    //         action buttons and the drop hint. `bottom` is px up from the bottom edge.
    L.util = { x: W / 2, y: L.clockY + Math.round(58 * L.clockS) + Math.round(20 * L.clockS), h: 28 };
    L.np = { x: W / 2, align: 'center', bottom: touch ? 52 : 46, maxW: Math.round(Math.min(W * 0.52, 420)) };
    L.npX = L.np.x; L.npY = H - L.np.bottom; L.npAlign = 'center';   // older callers
    return L;
  }
  window.TB_HUD = { layout };

  // ---- off-screen indicators ----
  // When the cast is too far apart to frame at a readable zoom (91_v3_render caps the zoom so nobody
  // becomes a dot), whoever fell off the edge gets an arrow in their own colour with their portrait,
  // their tag and how far out they are. Never for the local player: the camera guarantees them.
  function projF(f, dy, W, H) {
    if (window.V3 && V3.ready && V3.project) return V3.project(f.x, f.y + dy);
    const c = Game.cam; return { x: (f.x - c.x) * c.z + W / 2, y: (f.y + dy - c.y) * c.z + H / 2 };
  }
  function offArrows(ctx, W, H, G, L) {
    const r = Math.round(clamp(W * 0.019, 15, 23)), pad = r + 12;
    const x0 = pad, x1 = W - pad, y0 = L.top + pad, y1 = H - L.bottom - pad;
    if (x1 <= x0 || y1 <= y0) return;
    G.fighters.forEach((f, i) => {
      if (f.state === 'dead') return;
      const p = projF(f, -f.h * 0.66, W, H);
      const outX = p.x < x0 - 4 || p.x > x1 + 4, outY = p.y < y0 - 4 || p.y > y1 + 4;
      if (!outX && !outY) return;
      const cx = clamp(p.x, x0, x1), cy = clamp(p.y, y0, y1);
      const ang = Math.atan2(p.y - cy, p.x - cx);
      ctx.save();
      // the chip: portrait clipped into a disc, ringed in the fighter's colour
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = 'rgba(6,7,11,.86)'; ctx.fill();
      ctx.save(); ctx.clip();
      const im = (window.CustomLook && CustomLook.hudArt && CustomLook.hudArt(f)) || head(f.c.id);
      if (im && im.naturalWidth) { const cw = im.naturalWidth * 0.62, k = (im.naturalWidth - cw) / 2; ctx.drawImage(im, k, 0, cw, cw, cx - r, cy - r, r * 2, r * 2); }
      else if (typeof drawArt === 'function') drawArt(ctx, f.c, cx - r, cy - r, r * 2, r * 2, 0.4);
      else { ctx.fillStyle = f.color + '66'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
      ctx.restore();
      ctx.lineWidth = 2; ctx.strokeStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 9; ctx.stroke(); ctx.shadowBlur = 0;
      // the pointer, just outside the chip
      ctx.translate(cx + Math.cos(ang) * (r + 7), cy + Math.sin(ang) * (r + 7)); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -6.5); ctx.lineTo(-5, 6.5); ctx.closePath();
      ctx.fillStyle = f.color; ctx.fill();
      ctx.restore();
      // tag + how far out, tucked back toward the middle of the screen
      const bx = cx - Math.cos(ang) * (r + 12), by = cy - Math.sin(ang) * (r + 12);
      ctx.save(); ctx.font = `700 9px ${MONO}`; ctx.textAlign = Math.cos(ang) > 0.3 ? 'right' : Math.cos(ang) < -0.3 ? 'left' : 'center';
      ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,5,7,.85)';
      const txt = tagOf(G, f, i) + ' ' + Math.round(Math.hypot(p.x - cx, p.y - cy) / 12) + 'm';
      ctx.strokeText(txt, bx, by + 3); ctx.fillText(txt, bx, by + 3); ctx.restore();
    });
  }

  // ---- 1v1: Tekken-style bars across the top ----
  // Every offset is scaled by L.bs so the whole thing shrinks to fit the inset the camera was given
  // (a phone gets 80% of the desktop bar). Nothing here may grow past L.top.
  function topBars(ctx, W, H, G, L) {
    const F = G.fighters, S = L.bs;
    const ps = Math.round(clamp(W * 0.055, 38, 70) * (L.compact ? 0.86 : 1));
    const mg = Math.round(16 * S), top = Math.round(10 * S), gap = Math.round(12 * S);
    const clockW = Math.round(170 * L.clockS);
    const bw = Math.max(70, Math.min(Math.round(520 * S), W / 2 - mg - ps - gap - clockW / 2 - 14));
    F.slice(0, 2).forEach((f, i) => {
      const flip = i === 1, v = vstate(f), al = flip ? 'right' : 'left';
      const px = flip ? W - mg - ps : mg, py = top;
      portrait(ctx, f, px, py, ps, flip);
      const bx = flip ? W - mg - ps - gap - bw : mg + ps + gap, edge = flip ? bx + bw : bx;
      ctx.font = `700 ${Math.round(10 * S)}px ${MONO}`; ctx.fillStyle = f.color; ctx.textAlign = al;
      const cfTag = window.CustomLook && CustomLook.hudTag && CustomLook.hudTag(f);   // the player's own X handle
      ctx.fillText(tagOf(G, f, i) + (L.compact ? '' : (f.c.title ? ' · ' + f.c.title.toUpperCase() : '')) + (cfTag ? ' · ' + cfTag : ''), edge, py + 9 * S);
      chromeText(ctx, f.c.name, edge + (flip ? -2 : 2), py + 34 * S, Math.round(28 * S), al);
      meter(ctx, f, v, bx, py + 40 * S, bw, Math.round(16 * S), flip);
      // big damage % under the bar on the portrait side, stocks beside it
      const d = Math.floor(f.dmg), out = f.state === 'dead' && f.stocks <= 0, sh = v.shake ? (Math.random() - 0.5) * v.shake * 0.8 : 0;
      ctx.save(); ctx.font = `italic 900 ${Math.round((v.shake ? 44 : 40) * S)}px ${DISP}`; ctx.textAlign = al; ctx.lineJoin = 'round';
      ctx.lineWidth = 6 * S; ctx.strokeStyle = 'rgba(5,5,7,.9)';
      const txt = out ? 'OUT' : d + '%', ty = py + 92 * S;
      ctx.strokeText(txt, edge + sh, ty + sh);
      ctx.shadowColor = dmgCol(d, 0.9); ctx.shadowBlur = d > 100 ? 18 : 8;
      ctx.fillStyle = out ? '#6b7080' : dmgCol(d); ctx.fillText(txt, edge + sh, ty + sh);
      const tw = ctx.measureText(txt).width; ctx.restore();
      const pip = Math.round(16 * S);
      stocks(ctx, f, flip ? edge - tw - 20 * S : edge + tw + 20 * S, py + 78 * S, flip, v, pip);
      pumpBar(ctx, f, flip ? bx + bw - bw * 0.5 : bx, py + 102 * S, bw * 0.5, flip, L.compact);
      let ix = flip ? edge - tw - 20 * S - Math.max(1, f.stocks) * pip - 12 : edge + tw + 20 * S + Math.max(1, f.stocks) * pip + 12;
      if (f.item && typeof ITEM_DEFS !== 'undefined' && ITEM_DEFS[f.item.kind]) {
        // AKIMBO (6h_akimbo.js): `f.item.ammo` is only the hand that fires next, so a fighter holding
        // two loaded pistols read "10" with twenty rounds on him. Show the total, and the icon twice.
        const dual = typeof AKIMBO !== 'undefined' && AKIMBO.is(f.item);
        const rounds = dual ? AKIMBO.total(f.item) : f.item.ammo;
        const icon = ITEM_DEFS[f.item.kind].icon;
        ctx.font = `${Math.round(16 * S)}px sans-serif`; ctx.textAlign = al;
        ctx.fillText((dual ? icon + icon : icon) + (rounds ? ' ' + rounds : ''), ix, py + 84 * S);
        ix += flip ? -44 * S : 44 * S;
      }
      if (f.finalReady && !L.compact) { ctx.font = `italic 900 ${Math.round(14 * S)}px ${DISP}`; ctx.textAlign = al; ctx.fillStyle = `hsl(${(f.t * 6) % 360},100%,70%)`; ctx.fillText('FINAL SMASH READY', ix, py + 84 * S); }
    });
    clock(ctx, W, G, L.clockY, L);
  }

  // ---- 3-4 fighters ----
  // One plate per fighter. On a desktop they sit in a row along the bottom; on a phone (or any short
  // screen) that is where the thumbs are, so they move up beside the clock and shrink. Either way the
  // row height is exactly the inset the camera was handed, so a plate can never cover a fighter.
  function plate(ctx, f, i, x, y, w, h, G, L, tight) {
    const v = vstate(f), S = h / 84;
    ctx.save(); slant(ctx, x, y, w, h, Math.round(14 * S));
    const bg = ctx.createLinearGradient(x, 0, x + w, 0); bg.addColorStop(0, 'rgba(12,13,20,.9)'); bg.addColorStop(1, 'rgba(12,13,20,.6)');
    ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = f.color; ctx.fillRect(x + Math.round(10 * S), y, 3, h);
    ctx.restore();
    // a compact plate drops the portrait rather than squeeze the % into nothing
    const pad = Math.max(6, Math.round(16 * S)), showPic = !tight || w > h * 2.3;
    const ps = Math.round(h * (tight ? 0.72 : 0.72));
    let tx = x + pad + 4;
    if (showPic) { portrait(ctx, f, x + pad, y + Math.round((h - ps) / 2), ps, false); tx = x + pad + ps + Math.max(5, Math.round(10 * S)); }
    const rx = x + w - Math.max(7, Math.round(12 * S));
    const pip = Math.max(9, Math.round(14 * S));
    const stockW = Math.max(1, f.stocks) * pip + 6;
    const d = Math.floor(f.dmg), out = f.state === 'dead' && f.stocks <= 0, sh = v.shake ? (Math.random() - 0.5) * v.shake * 0.8 : 0;
    const txt = out ? 'OUT' : d + '%';
    // shrink the % until it fits the room that is actually left
    let dSize = Math.round(h * (tight ? 0.52 : 0.45)) + (v.shake ? 4 : 0);
    const room = Math.max(18, rx - tx - (tight ? stockW : 0));
    ctx.font = `italic 900 ${dSize}px ${DISP}`;
    const tw0 = ctx.measureText(txt).width;
    if (tw0 > room) dSize = Math.max(11, Math.floor(dSize * room / tw0));
    ctx.save(); ctx.font = `italic 900 ${dSize}px ${DISP}`; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, 6 * S); ctx.strokeStyle = 'rgba(5,5,7,.9)';
    const dy = y + (tight ? h - Math.round(7 * S) : Math.round(50 * S));
    ctx.strokeText(txt, tx + sh, dy + sh); ctx.shadowColor = dmgCol(d, 0.9); ctx.shadowBlur = d > 100 ? 16 : 6;
    ctx.fillStyle = out ? '#6b7080' : dmgCol(d); ctx.fillText(txt, tx + sh, dy + sh); ctx.restore();
    const cfTag2 = window.CustomLook && CustomLook.hudTag && CustomLook.hudTag(f);
    ctx.font = `700 ${Math.max(8, Math.round(10 * S))}px ${MONO}`; ctx.fillStyle = f.color; ctx.textAlign = 'left';
    ctx.fillText(tagOf(G, f, i) + (cfTag2 && !tight ? ' · ' + cfTag2 : ''), tx, y + Math.max(9, Math.round(15 * S)));
    stocks(ctx, f, rx, y + Math.max(9, Math.round(15 * S)), true, v, pip);
    if (tight) { ctx.textAlign = 'left'; return; }
    ctx.font = `italic 800 ${Math.round(16 * S)}px ${DISP}`; ctx.fillStyle = '#f4f5f8'; ctx.textAlign = 'left'; ctx.fillText(f.c.name, tx, y + 68 * S);
    meter(ctx, f, v, tx, y + 73 * S, rx - tx - 4, 6 * S, false);
    pumpBar(ctx, f, tx, y + 79 * S, (rx - tx - 4) * 0.7, false, true);
    if (f.item && typeof ITEM_DEFS !== 'undefined' && ITEM_DEFS[f.item.kind]) { ctx.font = `${Math.round(15 * S)}px sans-serif`; ctx.textAlign = 'right'; ctx.fillText(ITEM_DEFS[f.item.kind].icon, rx, y + 66 * S); }
    ctx.textAlign = 'left';
  }
  function plates(ctx, W, H, G, L) {
    const F = G.fighters, n = F.length;
    if (L.mode === 'plates') {
      const cw = Math.min(290, (W - 24) / n), x0 = (W - cw * n) / 2, y = H - L.bottom + 8;
      F.forEach((f, i) => plate(ctx, f, i, x0 + i * cw + 6, y, cw - 12, 84, G, L, false));
    } else {
      // compact: two plates to the left of the clock, the rest to the right
      const h = Math.max(32, L.top - 14), y = 4, half = Math.ceil(n / 2);
      const clockW = Math.round(170 * L.clockS), side = (W - clockW) / 2 - 14;
      const pw = Math.max(64, Math.min(Math.round(200 * L.bs), side / half - 5));
      F.forEach((f, i) => {
        const left = i < half, k = left ? i : i - half, cnt = left ? half : n - half;
        const x = left ? 8 + k * (pw + 5) : W - 8 - (cnt - k) * (pw + 5) + 5;
        plate(ctx, f, i, x, y, pw, h, G, L, true);
      });
    }
    clock(ctx, W, G, L.clockY, L);
  }

  // ---- center clock plate: timer, map name, pot ----
  function clock(ctx, W, G, y, L) {
    const sc = (L && L.clockS) || 1, w = Math.round(170 * sc), h = Math.round(58 * sc), x = (W - w) / 2;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 18 * sc, y + h); ctx.lineTo(x + 18 * sc, y + h); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(20,22,32,.94)'); g.addColorStop(1, 'rgba(6,6,10,.94)');
    ctx.fillStyle = g; ctx.fill();
    const e = ctx.createLinearGradient(x, 0, x + w, 0); e.addColorStop(0, '#ff2a4a'); e.addColorStop(0.5, 'rgba(255,255,255,.7)'); e.addColorStop(1, '#27e1ff');
    ctx.strokeStyle = e; ctx.lineWidth = 1.5; ctx.stroke();
    let secs;
    if (G.timeLimit) secs = Math.max(0, Math.ceil((G.timeLimit - G.frame) / 60)); else secs = Math.floor(G.frame / 60);
    const hot = G.timeLimit && secs <= 10;
    const txt = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    ctx.restore();
    chromeText(ctx, txt, W / 2, y + 36 * sc, Math.round(34 * sc), 'center', hot ? '#ff2a4a' : null);
    // the stage name lives under the clock for the whole match (9/20: "you need to put the map name
    // somewhere in the game while u are playing otherwise u dont know and forget"). It was 9px grey
    // and unreadable; the plate is the one spot on screen nothing else can reach.
    const stg = G.stage && G.stage.name ? G.stage.name.toUpperCase() : '';
    if (stg) {
      ctx.save();
      ctx.font = `700 ${Math.max(8, Math.round(11 * sc))}px ${MONO}`; ctx.textAlign = 'center';
      try { ctx.letterSpacing = '0.1em'; } catch (e) {}
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,5,7,.9)';
      ctx.strokeText(stg, W / 2, y + 51 * sc); ctx.fillStyle = '#cfd6e6'; ctx.fillText(stg, W / 2, y + 51 * sc);
      ctx.restore();
    }
    const pot = G.potLabel || (G.pot > 0 ? 'POT ' + G.pot.toFixed(3) + ' Ξ' : '');
    if (pot) { ctx.font = `italic 800 ${Math.round(15 * sc)}px ${DISP}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffc83d'; ctx.shadowColor = 'rgba(255,200,61,.6)'; ctx.shadowBlur = 10; ctx.fillText(pot, W / 2, y + h + 16 * sc); ctx.shadowBlur = 0; }
    ctx.textAlign = 'left';
  }

  // ---- big centre calls: countdown, GAME!, TIME! ----
  function bigCall(ctx, W, H, txt, t, color) {
    const k = Math.min(1, t / 8), s = 1.6 - 0.6 * k;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.globalAlpha = Math.min(1, t / 4);
    // light streak behind
    const g = ctx.createLinearGradient(-W / 2, 0, W / 2, 0); g.addColorStop(0, 'rgba(255,42,74,0)'); g.addColorStop(0.5, color || 'rgba(255,42,74,.55)'); g.addColorStop(1, 'rgba(42,107,255,0)');
    ctx.fillStyle = g; ctx.fillRect(-W / 2, -6, W, 12);
    ctx.restore();
    ctx.save(); ctx.translate(W / 2, H / 2 + 40); ctx.scale(s, s); ctx.globalAlpha = Math.min(1, t / 4);
    chromeText(ctx, txt, 0, 0, Math.min(150, W / 7), 'center', color || '#ff2a4a');
    ctx.restore();
  }
  let lastCount = -1, countT = 0;

  R.hud = function (ctx, W, H) {
    const G = Game; if (!G.fighters.length) return;
    let touch = false; try { touch = !!Touch.visible; } catch (e) {}
    const L = layout(W, H, G.fighters.length, touch);
    TB_HUD.last = L;   // the sound button and the now-playing label read this (12_audio.js)
    // ...and the DOM chrome reads it as CSS variables, so 01_head.html / 87_controls.js / 12_audio.js
    // never have to guess where the HUD ends. Written only when a number actually moves.
    if (TB_HUD._css !== L.top + ':' + L.bottom + ':' + L.util.y + ':' + L.np.bottom) {
      TB_HUD._css = L.top + ':' + L.bottom + ':' + L.util.y + ':' + L.np.bottom;
      const st = document.documentElement.style;
      st.setProperty('--hud-top', L.top + 'px'); st.setProperty('--hud-bottom', L.bottom + 'px');
      st.setProperty('--util-y', L.util.y + 'px'); st.setProperty('--np-bottom', L.np.bottom + 'px');
    }
    ctx.save(); ctx.textBaseline = 'alphabetic';
    if (L.mode === 'bars') topBars(ctx, W, H, G, L); else plates(ctx, W, H, G, L);
    ctx.restore();
    if (!G.paused && !G.countdown) { ctx.save(); ctx.textBaseline = 'alphabetic'; offArrows(ctx, W, H, G, L); ctx.restore(); }
    if (G.countdown > 0) {
      const c = Math.ceil(G.countdown / 50) - 1;
      if (c !== lastCount) { lastCount = c; countT = 0; } countT++;
      bigCall(ctx, W, H, c > 0 ? String(c) : 'BRAWL!', countT, c > 0 ? 'rgba(255,255,255,.5)' : null);
    } else lastCount = -1;
    if (G.endT > 0 && G.endT < 140 && G.state === 'match') bigCall(ctx, W, H, G.timeUpT ? 'TIME!' : 'GAME!', G.endT, 'rgba(255,200,61,.6)');
    if (G.paused) {
      ctx.save(); ctx.fillStyle = 'rgba(5,5,7,.62)'; ctx.fillRect(0, 0, W, H);
      chromeText(ctx, 'Paused', W / 2, H / 2, 72, 'center', '#ff2a4a');
      ctx.font = `600 14px "Space Grotesk", sans-serif`; ctx.fillStyle = '#9398a8'; ctx.textAlign = 'center';
      ctx.fillText('Esc or P to resume · Q to quit', W / 2, H / 2 + 34); ctx.restore();
    }
  };
})();
