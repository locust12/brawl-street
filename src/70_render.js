// ===== renderer =====
const R = {
  cv: null, ctx: null, w: 1280, h: 720, dpr: 1,
  init() {
    this.cv = document.getElementById('game'); this.ctx = this.cv.getContext('2d');
    // Cap 3, not 2: with the 3D view on, this canvas carries only the HUD -- bars, portraits and a
    // lot of small text -- so it is cheap to draw and it is the layer a phone screen shows off. At
    // the old cap of 2 every label on a DPR-3 phone was drawn at two thirds size and upscaled.
    // ...with a pixel budget on top, because a cap of 3 on a 1600x900 Retina window is a 4800x2700
    // canvas, cleared and redrawn with shadowed text every frame. MEASURED (dev/perf_bench.mjs
    // --ablate hudOff, 1600x900 at devicePixelRatio 2): the HUD layer cost 15 ms of the frame. At
    // ~2.6 M pixels it is still well above CSS resolution -- every label is drawn at 1.3-2x and
    // upscaled by nothing -- and the cost comes back under 6 ms. Phones keep their full ratio: their
    // buffers are small and the HUD is the layer a phone screen shows off.
    const fit = () => {
      this.w = innerWidth; this.h = innerHeight;
      const top = Math.min(3, window.devicePixelRatio || 1);
      const byArea = Math.sqrt(2.6e6 / Math.max(1, this.w * this.h));
      this.dpr = Math.max(1, Math.min(top, byArea));
      this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    };
    addEventListener('resize', fit); fit();
  },
  bg(ctx, W, H, theme, camx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (theme === 'chart') { g.addColorStop(0, '#03101f'); g.addColorStop(0.6, '#08244a'); g.addColorStop(1, '#170b3d'); }
    else { g.addColorStop(0, '#0a0524'); g.addColorStop(0.55, '#2a0f5c'); g.addColorStop(1, '#6a1b7c'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const t = performance.now() / 1000;
    for (const s of STARS) { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.4 + s.p); ctx.fillStyle = '#ffffff'; ctx.fillRect(((s.x * W - camx * 0.03) % W + W) % W, s.y * H, s.s, s.s); }
    ctx.globalAlpha = 1;
    if (theme === 'chart') {
      ctx.strokeStyle = 'rgba(34,230,255,.07)'; ctx.lineWidth = 1;
      for (let y = H * 0.2; y < H; y += H / 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const cw = W / 40, off = ((-camx * 0.12) % (cw * 70) + cw * 70) % (cw * 70);
      for (let i = 0; i < 70; i++) {
        const c = CANDLES[i], x = (i * cw + off) % (cw * 70) - cw * 10; if (x < -cw || x > W + cw) continue;
        const up = c.c >= c.o, col = up ? '#39ff9a' : '#ff4d6d', Y = v => H * (0.95 - v * 0.75);
        ctx.globalAlpha = 0.28; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x + cw * 0.3, Y(c.hi)); ctx.lineTo(x + cw * 0.3, Y(c.lo)); ctx.stroke();
        ctx.fillStyle = col; ctx.fillRect(x, Y(Math.max(c.o, c.c)), cw * 0.6, Math.max(2, Math.abs(Y(c.o) - Y(c.c))));
      }
      ctx.globalAlpha = 1;
    } else {
      const mx = W * 0.78 - camx * 0.02, my = H * 0.24, mr = Math.min(W, H) * 0.16;
      const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 2.6);
      halo.addColorStop(0, 'rgba(34,230,255,.35)'); halo.addColorStop(0.5, 'rgba(255,79,216,.12)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      const mg = ctx.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr);
      mg.addColorStop(0, '#e9fbff'); mg.addColorStop(0.5, '#b8a6ff'); mg.addColorStop(1, '#ff9be6');
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fillStyle = mg; ctx.fill();
      ctx.fillStyle = 'rgba(80,40,140,.18)';
      for (const [a, b, r] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12]]) { ctx.beginPath(); ctx.arc(mx + a * mr, my + b * mr, r * mr, 0, TAU); ctx.fill(); }
    }
  },
  stage(ctx, S) {
    const M = S.main, chart = S.theme === 'chart';
    ctx.beginPath(); ctx.moveTo(M.x0, M.top); ctx.lineTo(M.x1, M.top); ctx.lineTo(M.x1 - 60, M.bot); ctx.lineTo(M.x0 + 60, M.bot); ctx.closePath();
    const bg = ctx.createLinearGradient(0, M.top, 0, M.bot); bg.addColorStop(0, chart ? '#0c2d4f' : '#2a1466'); bg.addColorStop(1, '#0a0620');
    ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = chart ? 'rgba(57,255,154,.5)' : 'rgba(34,230,255,.45)'; ctx.stroke();
    const top = ctx.createLinearGradient(M.x0, 0, M.x1, 0);
    top.addColorStop(0, '#22e6ff'); top.addColorStop(0.4, '#8b5cf6'); top.addColorStop(0.7, '#ff4fd8'); top.addColorStop(1, '#ffd45c');
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 24; ctx.fillStyle = top; ctx.fillRect(M.x0, M.top, M.x1 - M.x0, 10); ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#ffffff'; ctx.fillRect(M.x0 + 10, M.top + 2, M.x1 - M.x0 - 20, 2); ctx.globalAlpha = 1;
    for (const p of S.plats) {
      const pg = ctx.createLinearGradient(p.x0, 0, p.x1, 0); pg.addColorStop(0, 'rgba(34,230,255,.9)'); pg.addColorStop(1, 'rgba(255,79,216,.9)');
      ctx.shadowColor = '#22e6ff'; ctx.shadowBlur = 16; ctx.fillStyle = pg; ctx.beginPath(); ctx.roundRect(p.x0, p.y, p.x1 - p.x0, 8, 4); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(139,92,246,.18)'; ctx.fillRect(p.x0 + 8, p.y + 8, p.x1 - p.x0 - 16, 14);
    }
  },
  fighter(ctx, f) {
    if (f.state === 'dead') return;
    const S = Game.stage;
    let gy = null;
    for (const s of [S.mainSurf, ...S.plats]) if (f.x >= s.x0 && f.x <= s.x1 && s.y >= f.y - 1 && (gy === null || s.y < gy)) gy = s.y;
    if (gy !== null) { const k = clamp(1 - (gy - f.y) / 400, 0.2, 1); ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`; ctx.beginPath(); ctx.ellipse(f.x, gy + 2, f.w * 0.45 * k, 7 * k, 0, 0, TAU); ctx.fill(); }
    if (f.state === 'respawn') {
      const g = ctx.createLinearGradient(f.x - 50, 0, f.x + 50, 0); g.addColorStop(0, '#22e6ff'); g.addColorStop(1, '#ff4fd8');
      ctx.fillStyle = g; ctx.shadowColor = f.color; ctx.shadowBlur = 20; ctx.beginPath(); ctx.ellipse(f.x, f.y + 4, 50, 9, 0, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    const P = f.pose();
    ctx.save();
    ctx.translate(f.x + (f.hitlag > 0 && f.state === 'hitstun' ? vrand(-3, 3) : 0), f.y);
    ctx.scale(f.face, 1);
    if ((f.invuln > 0 || f.intang) && Math.floor(f.t / 4) % 2) ctx.globalAlpha = 0.55;
    if (f.move && f.move.def.charge && f.move.t === f.move.def.charge.at && f.move.charge > 0) { ctx.shadowColor = '#ffd45c'; ctx.shadowBlur = 10 + f.move.charge / 2; }
    if (P.tongue) {
      const mv = f.move, hb = mv.def.hits[mv.def.hits.length - 1], k = clamp((mv.t - mv.def.tongue[0] + 3) / 5, 0, 1);
      ctx.strokeStyle = '#ff6f91'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(f.w * 0.5, -f.h * 0.6); ctx.lineTo(f.w * 0.5 + (hb.x - f.w * 0.5) * k, -f.h * 0.6); ctx.stroke();
    }
    drawMascot(ctx, f.c, P);
    ctx.restore(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (f.state === 'shield') {
      const r = f.h * 0.62 * (0.35 + 0.65 * f.shieldHP / 60);
      ctx.beginPath(); ctx.arc(f.x, f.y - f.h * 0.5, r, 0, TAU); ctx.fillStyle = f.color + '55'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = f.color; ctx.stroke();
    }
    ctx.fillStyle = f.color; ctx.font = '700 15px "Chakra Petch",sans-serif'; ctx.textAlign = 'center';
    const tag = f.cpu ? 'CPU' : 'P' + (f.idx + 1), ty = f.y - f.h - 24;
    ctx.fillText(tag, f.x, ty); ctx.beginPath(); ctx.moveTo(f.x - 6, ty + 4); ctx.lineTo(f.x + 6, ty + 4); ctx.lineTo(f.x, ty + 11); ctx.fill(); ctx.textAlign = 'left';
  },
  frame() {
    const ctx = this.ctx, W = this.w, H = this.h, G = Game, cam = G.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (window.V3 && V3.ready) return this.frame3d(ctx, W, H);
    this.bg(ctx, W, H, G.stage.theme, cam.x);
    ctx.save();
    const sx = G.shakeT ? vrand(-G.shakeT, G.shakeT) : 0, sy = G.shakeT ? vrand(-G.shakeT, G.shakeT) : 0;
    ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    this.stage(ctx, G.stage);
    for (const r of G.rings) {
      ctx.globalAlpha = r.life / 16; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (r.life / 20 + 0.2);
      ctx.beginPath(); if (r.flat) ctx.ellipse(r.x, r.y, r.r, r.r * 0.25, 0, 0, TAU); else ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of G.projs) drawProjectile(ctx, p);
    this.items2d(ctx);
    for (const f of G.fighters) this.fighter(ctx, f);
    if (G.finalBy && G.finalBy.state === 'final') { const f = G.finalBy, by = f.y - f.h * 0.55, k = Math.min(1, f.st / 20); const g = ctx.createLinearGradient(0, by - 80, 0, by + 80); g.addColorStop(0, 'rgba(34,230,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,79,216,0)'); ctx.fillStyle = g; ctx.fillRect(f.face > 0 ? f.x : f.x - 2000, by - 80 * k, 2000, 160 * k); }
    for (const p of G.parts) {
      const k = p.life / p.max; ctx.globalAlpha = p.soft ? k * 0.6 : k; ctx.fillStyle = p.color;
      if (p.streak) { ctx.strokeStyle = p.color; ctx.lineWidth = p.size * k; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.soft ? 1.6 - k : k), 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (const t of G.texts) {
      const k = t.life / t.max, s = t.scale * (k > 0.85 ? 1 + (k - 0.85) * 4 : 1);
      ctx.globalAlpha = Math.min(1, k * 2.5); ctx.font = `${Math.round(34 * s)}px Bungee,Impact,sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 7; ctx.strokeStyle = '#12072c'; ctx.strokeText(t.s, t.x, t.y); ctx.fillStyle = t.color; ctx.fillText(t.s, t.x, t.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    ctx.restore();
    this.speedLines(ctx, W, H); this.flash(ctx, W, H);
    if (G.state === 'match') this.hud(ctx, W, H);
  },
  items2d(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const it of Game.items) {
      const d = ITEM_DEFS[it.kind]; ctx.font = `${d.r * 1.6}px sans-serif`;
      if (!it.armed) { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(it.x, it.y - d.r * 0.6, d.r * 1.1, 0, TAU); ctx.fill(); }
      ctx.fillText(d.icon, it.x, it.y - d.r * 0.6);
    }
    for (const f of Game.fighters) if (f.item && f.state !== 'dead') { ctx.font = '22px sans-serif'; ctx.fillText(ITEM_DEFS[f.item.kind].icon, f.x + f.face * f.w * 0.5, f.y - f.h * 0.5); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  },
  flash(ctx, W, H) { if (Game.flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${Game.flashT / 10})`; ctx.fillRect(0, 0, W, H); } },
  // 3D mode: WebGL draws the world underneath; this canvas carries labels, pop-up text and the HUD
  frame3d(ctx, W, H) {
    const G = Game;
    ctx.clearRect(0, 0, W, H);
    V3.render();
    ctx.textAlign = 'center';
    // the finish cinematic (99_v3_finish) wants a clean frame: no tags, callouts or speed lines
    const quiet = !!(window.FINV && FINV.quiet);
    for (const f of G.fighters) {
      if (quiet || f.state === 'dead' || G.state !== 'match') continue;
      const p = V3.project(f.x, f.y - f.h * 1.62);
      ctx.font = 'italic 900 16px "Barlow Condensed",Impact,sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,5,7,.85)';
      const tag = G.arenaTags ? G.arenaTags[f.idx] : f.cpu ? 'CPU' : 'P' + (f.idx + 1);
      ctx.strokeText(tag, p.x, p.y - 12); ctx.fillStyle = f.color; ctx.fillText(tag, p.x, p.y - 12);
    }
    // GAME! / TIME! are drawn by the HUD's centre call (71_hud bigCall); drawing the world copy too put two
    // on screen at every match end. Callouts are kept inside the safe area: a KO "REKT" placed at the
    // blast line used to sit under the HUD bar, half off the screen.
    const top = (window.TB_HUD && TB_HUD.last && TB_HUD.last.top) || H * 0.14, bot = (window.TB_HUD && TB_HUD.last && TB_HUD.last.bottom) || 0;
    // newest first, one copy of each word: a multi-hit signature move pushed its callout once per hit, so
    // "RUN OVER" / "QUORUM" / "FLYING SLAM" stacked two or three deep at different sizes (audit 9/22)
    const seenTxt = new Set();
    for (let ti = G.texts.length - 1; ti >= 0; ti--) {
      const t = G.texts[ti];
      if (seenTxt.has(t.s)) continue; seenTxt.add(t.s);
      if (quiet || t.s === 'GAME!' || t.s === 'TIME!' || (t.s === 'REKT' && window.FINV && FINV.banner)) continue;
      const p = V3.project(t.x, t.y), k = t.life / t.max, s = t.scale * (k > 0.85 ? 1 + (k - 0.85) * 4 : 1), fs = Math.round(38 * s);
      const px = Math.max(W * 0.1 + fs, Math.min(W * 0.9 - fs, p.x)), py = Math.max(top + fs + 8, Math.min(H - bot - 16, p.y));
      ctx.globalAlpha = Math.min(1, k * 2.5); ctx.font = `italic 900 ${fs}px "Barlow Condensed",Impact,sans-serif`;
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(5,5,7,.9)'; ctx.lineJoin = 'round'; ctx.strokeText(t.s, px, py); ctx.fillStyle = t.color; ctx.fillText(t.s, px, py);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    if (!quiet) this.speedLines(ctx, W, H);
    this.flash(ctx, W, H);
    if (G.state === 'match') this.hud(ctx, W, H);
  },
  // radial speed lines from the last big impact (METABRAWL-style)
  speedLines(ctx, W, H) {
    const im = Game.impact; if (!im) return;
    let cx, cy;
    if (window.V3 && V3.ready) { const p = V3.project(im.x, im.y); cx = p.x; cy = p.y; }
    else { const c = Game.cam; cx = (im.x - c.x) * c.z + W / 2; cy = (im.y - c.y) * c.z + H / 2; }
    const a0 = im.t / 30, R = Math.hypot(W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * TAU, r0 = Math.min(W, H) * (0.18 + Math.random() * 0.25), wd = 2 + Math.random() * 7;
      const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0, x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R;
      const nx = -Math.sin(a) * wd, ny = Math.cos(a) * wd;
      ctx.fillStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.35) * a0})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 + nx, y1 + ny); ctx.lineTo(x1 - nx, y1 - ny); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },
  splash(ctx, cx, cy, color, seed, t) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(seed * 0.7 + Math.sin(t * 0.02) * 0.04);
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 56); g.addColorStop(0, color); g.addColorStop(1, 'rgba(10,6,30,.0)');
    ctx.fillStyle = g; ctx.beginPath();
    for (let i = 0; i < 26; i++) { const a = i / 26 * TAU, r = i % 2 ? 36 : 44 + ((i * 37 + seed * 11) % 12); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  },
  hud(ctx, W, H) {
    const G = Game, F = G.fighters, n = F.length, cw = Math.min(250, (W - 24) / n), x0 = (W - cw * n) / 2, y = H - 100 - (Touch.visible ? 150 : 0);
    F.forEach((f, i) => {
      const x = x0 + i * cw + 4, w = cw - 8, bx = x + 40, by = y + 44;
      // badge: spiky colour splash, round portrait, ring
      this.splash(ctx, bx, by, f.color, i + 1, f.t);
      ctx.save(); ctx.beginPath(); ctx.arc(bx, by, 32, 0, TAU); ctx.clip();
      ctx.fillStyle = '#1a1430'; ctx.fillRect(bx - 32, by - 32, 64, 64);
      if (!drawArt(ctx, f.c, bx - 32, by - 32, 64, 64, 0.4)) { ctx.translate(bx, by + 36); ctx.scale(0.5, 0.5); drawMascot(ctx, f.c, { t: f.t }); }
      ctx.restore();
      ctx.lineWidth = 3; ctx.strokeStyle = f.finalReady ? `hsl(${(f.t * 6) % 360},100%,65%)` : f.powerT > 0 ? '#ffd23f' : '#e8e6f2';
      ctx.beginPath(); ctx.arc(bx, by, 33, 0, TAU); ctx.stroke();
      // name plate: slanted metal bar
      const px = x + 70, pw = w - 72, py = y + 50;
      const pg = ctx.createLinearGradient(0, py, 0, py + 26); pg.addColorStop(0, '#2e2656'); pg.addColorStop(1, '#141028');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.moveTo(px + 10, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw - 8, py + 26); ctx.lineTo(px, py + 26); ctx.closePath(); ctx.fill();
      const mg = ctx.createLinearGradient(0, py, 0, py + 26); mg.addColorStop(0, '#f0f0f8'); mg.addColorStop(1, '#6a6a86'); ctx.strokeStyle = mg; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = f.color; ctx.fillRect(px + 12, py + 4, 4, 18);
      ctx.fillStyle = '#ffffff'; ctx.font = '13px Bungee,Impact,sans-serif'; ctx.fillText(f.c.name, px + 22, py + 18);
      ctx.font = '700 10px "Chakra Petch",sans-serif'; ctx.fillStyle = f.color; ctx.textAlign = 'right'; ctx.fillText(G.arenaTags ? G.arenaTags[i] : f.cpu ? 'CPU' : 'P' + (i + 1), px + pw - 12, py + 17); ctx.textAlign = 'left';
      // damage %
      const d = Math.floor(f.dmg), k = Math.min(1, d / 150), sh = f.hitlag > 0 && f.state === 'hitstun' ? vrand(-3, 3) : 0;
      ctx.font = '34px Bungee,Impact,sans-serif'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(10,6,28,.85)';
      const txt = f.state === 'dead' && f.stocks <= 0 ? 'OUT' : d + '%';
      ctx.strokeText(txt, px + 4 + sh, py - 6 + sh);
      ctx.fillStyle = d < 1 ? '#ffffff' : `hsl(${50 - 50 * k},100%,${88 - 28 * k}%)`; ctx.fillText(txt, px + 4 + sh, py - 6 + sh);
      // stock pips, numbered like the trailer
      for (let s = 0; s < f.stocks; s++) {
        const sx = px + 14 + s * 19, sy = py + 38;
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, TAU); ctx.fillStyle = '#c8102e'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '700 10px "Chakra Petch",sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(s + 1), sx, sy + 3.5); ctx.textAlign = 'left';
      }
      if (f.item) { ctx.font = '16px sans-serif'; ctx.fillText(ITEM_DEFS[f.item.kind].icon + (f.item.kind === 'raygun' ? ' ' + f.item.ammo : ''), px + pw - 40, py - 10); }
    });
    // top scoreboard: clock in the middle, pot on the right
    const tw = Math.min(420, W - 120), tx = (W - tw) / 2, ty = 10;
    const tg = ctx.createLinearGradient(0, ty, 0, ty + 40); tg.addColorStop(0, 'rgba(30,24,60,.92)'); tg.addColorStop(1, 'rgba(12,8,28,.92)');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + tw, ty); ctx.lineTo(tx + tw - 18, ty + 40); ctx.lineTo(tx + 18, ty + 40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(220,220,240,.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    const secs = Math.floor(G.frame / 60), clock = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = '22px Bungee,Impact,sans-serif'; ctx.fillText(clock, W / 2, ty + 28);
    ctx.font = '12px Bungee,Impact,sans-serif'; ctx.fillStyle = '#ffd45c';
    ctx.fillText(G.potLabel || (G.pot > 0 ? 'POT ' + G.pot.toFixed(3) + ' Ξ' : 'FREE PLAY'), tx + tw - 80, ty + 25);
    ctx.fillStyle = '#aca2da'; ctx.fillText(G.stage.name.toUpperCase(), tx + 88, ty + 25);
    ctx.textAlign = 'left';
    if (G.countdown > 0) {
      const c = Math.ceil(G.countdown / 50) - 1, s = c > 0 ? String(c) : 'BRAWL!';
      ctx.textAlign = 'center'; ctx.font = `${c > 0 ? 120 : 90}px Bungee,Impact,sans-serif`; ctx.lineWidth = 10; ctx.strokeStyle = '#12072c';
      ctx.strokeText(s, W / 2, H / 2); const g = ctx.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0); g.addColorStop(0, '#22e6ff'); g.addColorStop(0.5, '#ff4fd8'); g.addColorStop(1, '#ffd45c');
      ctx.fillStyle = g; ctx.fillText(s, W / 2, H / 2); ctx.textAlign = 'left';
    }
    if (G.paused) {
      ctx.fillStyle = 'rgba(7,5,26,.6)'; ctx.fillRect(0, 0, W, H); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '56px Bungee,Impact,sans-serif'; ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.font = '600 16px "Chakra Petch",sans-serif'; ctx.fillStyle = '#aca2da'; ctx.fillText('Esc or P to resume · Q to quit', W / 2, H / 2 + 36); ctx.textAlign = 'left';
    }
  },
};
