// ===== combo counter: Tekken-style hit count on the attacker's side =====
// Wraps R.hud (71_hud.js) and draws after it. Visual only: reads fighter.combo (23_combo.js), never
// writes fight state, never uses the seeded fight RNG. Ended combos go into ComboHUD.log for Clip It.
(function () {
  if (typeof R === 'undefined') return;
  const DISP = '"Barlow Condensed", Impact, sans-serif', MONO = '"JetBrains Mono", ui-monospace, monospace';
  const HOLD = 1300;   // ms an ended combo stays up
  const recs = new Map();   // combo id -> display record
  // ids of combos already shown and ended. fighter.combo is not cleared when a combo drops, so a deleted
  // record used to be re-created from the same stale combo the next frame and the counter stayed up (and
  // re-popped) for the rest of the stock: "2 Hits 23% damage" on screen for 10+ s (audit 9/22).
  const done = new Set();
  const ComboHUD = window.ComboHUD = { log: [] };
  const word = n => (n >= 12 ? 'Legendary' : n >= 8 ? 'Brutal' : n >= 5 ? 'Great' : 'Combo');

  function track(now) {
    for (const v of Game.fighters) {
      const c = v.combo;
      if (!c || c.n < 2) continue;
      let r = recs.get(c.id);
      if (!r) { if (done.has(c.id)) continue; r = { id: c.id, v, by: c.by, n: 0, dmg: 0, pop: 0, end: 0 }; recs.set(c.id, r); }
      if (c.n > r.n) { r.n = c.n; r.dmg = c.dmg; r.pop = now; }
    }
    for (const r of recs.values()) {
      const v = r.v, live = v.combo && v.combo.id === r.id && (v.state === 'hitstun' || v.state === 'grabbed');
      if (!live && !r.end) {
        r.end = now;
        if (r.n >= 3) {
          ComboHUD.log.push({ n: r.n, dmg: Math.round(r.dmg), name: r.by.c.name, color: r.by.color, at: now });
          if (ComboHUD.log.length > 30) ComboHUD.log.shift();
        }
      }
      if (r.end && now - r.end > HOLD) { recs.delete(r.id); done.add(r.id); if (done.size > 400) done.clear(); }
    }
  }

  function chrome(ctx, txt, x, y, size, glow) {
    ctx.font = `italic 900 ${size}px ${DISP}`;
    const g = ctx.createLinearGradient(0, y - size * 0.82, 0, y);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.42, '#eef0f5'); g.addColorStop(0.52, '#8f96a8'); g.addColorStop(0.6, '#ffffff'); g.addColorStop(1, '#c9ced9');
    ctx.lineWidth = Math.max(3, size / 9); ctx.strokeStyle = 'rgba(5,5,7,.85)'; ctx.lineJoin = 'round'; ctx.strokeText(txt, x, y);
    ctx.shadowColor = glow; ctx.shadowBlur = size * 0.3; ctx.fillStyle = g; ctx.fillText(txt, x, y); ctx.shadowBlur = 0;
  }

  function draw(ctx, W, H) {
    if (Game.state !== 'match' || !Game.fighters.length) { recs.clear(); return; }
    if (window.FINV && FINV.quiet) return;   // the finish cinematic and the GAME! frame stay clean (99_v3_finish)
    const now = performance.now();
    track(now);
    // one counter per side: the newest record whose attacker sits on that side
    const side = {};
    for (const r of recs.values()) {
      if (r.n < 2) continue;
      const s = r.by.idx % 2 ? 'r' : 'l';
      if (!side[s] || r.id > side[s].id) side[s] = r;
    }
    const y0 = Game.fighters.length <= 2 ? Math.max(150, H * 0.24) : Math.max(110, H * 0.16);
    for (const s of ['l', 'r']) {
      const r = side[s]; if (!r) continue;
      const right = s === 'r', x = right ? W - 26 : 26, al = right ? 'right' : 'left';
      const out = r.end ? Math.min(1, (now - r.end) / HOLD) : 0;
      const fade = out > 0.75 ? 1 - (out - 0.75) / 0.25 : 1;
      // it used to slide 60 px outward on the way out, i.e. straight off the screen edge, and the
      // counter finished as "28% damag" (runs/banner/b520.jpg). Audit #6: never past the edge - it
      // drifts up instead.
      const slide = 0, rise = out > 0.75 ? (out - 0.75) / 0.25 * -18 : 0;
      const pk = Math.max(0, 1 - (now - r.pop) / 160), size = Math.round(Math.min(96, W * 0.075) * (1 + pk * 0.35));
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(slide, rise); ctx.textAlign = al; ctx.textBaseline = 'alphabetic';
      const num = String(r.n);
      chrome(ctx, num, x, y0 + size * 0.8, size, r.by.color);
      ctx.font = `italic 900 ${size}px ${DISP}`;
      const nw = ctx.measureText(num).width, lx = right ? x - nw - 10 : x + nw + 10;
      ctx.font = `italic 900 ${Math.round(size * 0.36)}px ${DISP}`; ctx.fillStyle = r.by.color;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,5,7,.85)';
      ctx.strokeText('Hits', lx, y0 + size * 0.8); ctx.fillText('Hits', lx, y0 + size * 0.8);
      ctx.font = `700 ${Math.round(Math.max(12, size * 0.17))}px ${MONO}`; ctx.fillStyle = '#f4f5f8';
      ctx.strokeText(Math.round(r.dmg) + '% damage', x, y0 + size * 0.8 + size * 0.28); ctx.fillText(Math.round(r.dmg) + '% damage', x, y0 + size * 0.8 + size * 0.28);
      if (r.end && r.n >= 3) {
        ctx.font = `italic 900 ${Math.round(size * 0.42)}px ${DISP}`; ctx.fillStyle = r.n >= 8 ? '#ff2a4a' : r.n >= 5 ? '#ffc83d' : '#27e1ff';
        const wy = y0 + size * 0.8 + size * 0.72;
        ctx.strokeText(word(r.n), x, wy); ctx.fillText(word(r.n), x, wy);
      }
      ctx.restore();
    }
  }

  const base = R.hud;
  R.hud = function (ctx, W, H) { base.call(this, ctx, W, H); try { draw(ctx, W, H); } catch (e) { /* never break the frame */ } };
})();
