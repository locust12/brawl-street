// ===== PUMP meter under each fighter's name tag, plus contextual input hints (local rules only) =====
// Wraps R.hud (after 71_hud.js and 82_combo_hud.js) and draws on top. Visual only: reads Game, fighters and
// FEEL (25_feel.js), never writes fight state, never uses the seeded Rng. The HUD owner can fold the meter
// into the player plates later (spec in docs/GAMEFEEL.md) and delete this file.
(function () {
  if (typeof R === 'undefined' || typeof FEEL === 'undefined') return;
  const DISP = '"Barlow Condensed", Impact, sans-serif';
  const seen = { burst: 0, pump: 0 };
  try { Object.assign(seen, JSON.parse(localStorage.getItem('tb_feelhints') || '{}')); } catch (e) { /* storage blocked */ }
  const saveSeen = () => { try { localStorage.setItem('tb_feelhints', JSON.stringify(seen)); } catch (e) { /* storage blocked */ } };
  const hintT = new WeakMap();

  function anchor(f, W, H) {
    if (window.V3 && V3.ready && V3.project) { const p = V3.project(f.x, f.y - f.h * 1.62); return { x: p.x, y: p.y }; }
    const c = Game.cam; return { x: (f.x - c.x) * c.z + W / 2, y: (f.y - f.h - 24 - c.y) * c.z + H / 2 };
  }
  function bar(ctx, x, y, w, h, k, col) {
    ctx.fillStyle = 'rgba(5,5,10,.72)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.max(0, Math.min(1, k)) * w, h);
  }
  function draw(ctx, W, H) {
    if (!Game.feel || Game.state !== 'match' || !Game.fighters.length) return;
    const now = performance.now();
    for (const f of Game.fighters) {
      if (f.state === 'dead' || f.state === 'respawn' || MV2.hidden(f)) continue;
      const p = anchor(f, W, H), w = 46, x = p.x - w / 2, y = p.y - 4;
      const pump = f.pump || 0;
      const bars = !window.TB_PUMP_IN_HUD;   // the Tekken plates draw the meter (71_hud.js); keep the hints here
      if (f.powerT > 0) {
        const glow = 0.6 + 0.4 * Math.sin(now / 90);
        if (bars) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10 * glow; bar(ctx, x, y, w, 5, f.powerT / FEEL.PUMP_T, '#ffd23f'); ctx.shadowBlur = 0; }
        continue;
      }
      if (pump < 1 && f.cpu) continue;
      const full = pump >= 100, half = pump >= FEEL.BURST_COST;
      const col = full ? `hsl(${45 + 10 * Math.sin(now / 120)},100%,58%)` : half ? '#7ff0ff' : '#3a8fb0';
      if (bars) {
        if (full) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 12; }
        bar(ctx, x, y, w, 5, pump / 100, col); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x + w / 2 - 0.5, y, 1, 5);   // the Burst notch
      }
      // hints for people: what the bar does, the first few times it matters
      if (f.cpu) continue;
      let hint = null;
      const inCombo = (f.state === 'hitstun' || f.state === 'grabbed') && f.combo && f.combo.n >= 2;
      if (half && inCombo && seen.burst < 6) hint = 'SHIELD + SPECIAL: BURST';
      else if (full && !inCombo && seen.pump < 6 && (f.state === 'ground' || f.state === 'air')) hint = 'SHIELD + SPECIAL: PUMP MODE';
      if (hint) {
        let h = hintT.get(f); if (!h || h.s !== hint) { h = { s: hint, t0: now }; hintT.set(f, h); }
        ctx.font = `italic 900 13px ${DISP}`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,5,7,.9)';
        ctx.strokeText(hint, p.x, y + 19); ctx.fillStyle = full ? '#ffd23f' : '#7ff0ff'; ctx.fillText(hint, p.x, y + 19); ctx.textAlign = 'left';
      }
    }
    // count a hint as learned once the player uses it; counter hits become a side tag (Tekken style)
    for (const e of FEEL.ev) {
      if (e.id <= (draw.last || 0)) continue; draw.last = e.id;
      if ((e.k === 'burst' || e.k === 'pump') && e.f && !e.f.cpu) { seen[e.k]++; saveSeen(); }
      if (e.k === 'counter' && e.a) tags.push({ s: 'COUNTER HIT', side: e.a.idx % 2, c: '#ff9a3a', t0: now });
      if (e.k === 'parry' && e.f) tags.push({ s: 'PARRY', side: e.f.idx % 2, c: '#7ff0ff', t0: now });
    }
    const y0 = Game.fighters.length <= 2 ? Math.max(128, H * 0.2) : Math.max(96, H * 0.13);
    const live = { 0: 0, 1: 0 };
    for (let i = tags.length - 1; i >= 0; i--) {
      const g = tags[i], age = now - g.t0;
      if (age > 900 || live[g.side] >= 1) { tags.splice(i, 1); continue; }
      live[g.side]++;
      const k = age < 90 ? age / 90 : age > 700 ? 1 - (age - 700) / 200 : 1, right = g.side === 1;
      ctx.save(); ctx.globalAlpha = Math.max(0, k); ctx.font = `italic 900 ${Math.round(Math.min(26, W * 0.022) * (1 + (age < 90 ? (1 - k) * 0.4 : 0)))}px ${DISP}`;
      ctx.textAlign = right ? 'right' : 'left'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(5,5,7,.9)';
      const x = right ? W - 26 - (1 - k) * 30 : 26 + (1 - k) * 30;
      ctx.strokeText(g.s, x, y0); ctx.fillStyle = g.c; ctx.fillText(g.s, x, y0); ctx.restore();
    }
  }
  const tags = [];
  const base = R.hud;
  R.hud = function (ctx, W, H) { base.call(this, ctx, W, H); try { draw(ctx, W, H); } catch (e) { /* never break the frame */ } };
})();
