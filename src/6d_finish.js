// ===== 6d_finish: the KO flow for local matches — Smash's rules instead of a slow-motion lottery =====
// Rebuild brief (~/Downloads/REKT-FIGHTER-AUDIT/PROMPT-AAA.md, phase 1 #1-2 and phase 2). Timings are
// Smash Ultimate's, frame-stepped from 60 fps footage (research-smash-tekken.md §1.2-1.4).
//
//  1. No slow motion on ordinary hits. Every hit with knockback > 150 used to drop the whole game to 1/3
//     speed for ~1 s (4-18 % of every measured match). Weight comes from hitlag (6b_hitstop) instead.
//  2. Strong-hit flash only at knockback >= 160, as Smash does: a short white flash + radial lines, no text.
//  3. The Finish Zoom. When the hit that ENDS the match lands, the victim's flight is replayed with the
//     exact hitstun physics (40_fighter physics/collide). Nobody can act in hitstun here (Game.feel is
//     off), so the answer is exact: the zoom only plays when the hit really kills. Smash's zoom "lies";
//     this one can't. The launch is already decided (takeHit set vx/vy); the cinematic only spaces the
//     sim frames out, it never changes them.
//  4. GAME! freezes the world solid on the KO frame, then the winner outro, then results.
//
// Local rules only: Game.combos is true for unseeded local matches and false for the seeded bet arena and
// online, so none of this runs there (dev/aaa/guard.sh proves the arena stays bit-identical). The page's
// 3D half is 99_v3_finish.mjs; it only READS FIN.
const FIN = (() => {
  const S = {
    cine: null,    // finishing-hit cinematic { t, v, a, x, y }
    fin: null,     // the match-ending KO { f, zoomed }
    zoomV: null,   // who the last Finish Zoom was for
    out: null,     // winner outro after GAME! { t, w }
    pend: [],      // fighters hit this tick: judged next tick, once every takeHit wrapper has shaped the launch
    ko: [],        // stock KO events for the renderer { f, x, y, color, final, at }
    banner: null,  // 1v1 stock score after a KO { t, s: [stocks...] }
    n: { zooms: 0, lies: 0, finishes: 0 },
  };
  // pacing of the sim during the zoom, in 60 Hz ticks from the finishing hit (research §1.2):
  // f1-5 medium shot at 1/4, f6-49 push-in + hold near-frozen at 1/10, f50-63 pull-back at 1/2
  S.CUT = 1; S.PUSH = 6; S.HOLD = 10; S.PULL = 50; S.FULL = 64;
  S.AFTER = 0;       // frames of uncontrolled flight trusted after hitstun ends (0 = only certain kills)
  S.GAME_T = 140;   // 71_hud draws GAME!/TIME! while 0 < endT < 140
  S.OUT_T = 150;    // winner outro (2.5 s), then results
  // Master switch. Shipped OFF on 9/22 03:50 after a visual review (winner hanging mid-air under GAME!,
  // GAME! across the fighter on a self-KO, beam 2/3 of the screen, UI dimmed not hidden, name card over the
  // winner). All five fixed in 99_v3_finish (every finish ends on the loser at the blast line, beam 3.5
  // long / 0.42 wide, UI visibility:hidden, winner framed in the upper two thirds, name slam lower) and
  // reviewed again 9/22 night (NOTES-aaa3). ON.
  S.ZOOM = true;
  S.on = () => !!(S.ZOOM && Game.combos && !Game.arena && !Game.demo && Game.state === 'match');

  // would this launch cross a blast line before the victim can act? exact replay of 40_fighter
  // update/physics/collide for a fighter in hitstun with no inputs
  // `after` > 0: keep flying for that many frames once hitstun ends, as if the victim did nothing (Smash's
  // own rule: knockback and angle only). Exact while in hitstun; after that it can be wrong if they recover.
  S.kills = function (v, after) {
    if (v.state !== 'hitstun' || Game.holes.length) return false;
    after = after || 0; let free = 0;
    const st = Game.stage, M = st.main, B = st.blast, c = v.c, h = v.h, w2 = v.w * 0.4;
    let x = v.x, y = v.y, vx = v.vx, vy = v.vy, air = v.air, tumble = v.tumble, t = v.st, lag = v.hitlag;
    for (let i = 0; i < 600; i++) {
      if (lag > 0) { lag--; continue; }
      t++;
      if (!air) return false;              // grounded hitstun slides; never a guaranteed KO
      const hs = t < v.hitstun;
      if (!hs && ++free > after) return false;   // control comes back before the blast line
      if (hs) { vy += c.grav * 0.6; const cap = c.fall * 1.5; if (vy > cap) vy = Math.max(cap, vy * 0.98); vx *= 0.975; }
      else { vy += c.grav; if (vy > c.fall) vy = c.fall; vx *= 0.97; }
      const px = x, py = y; x += vx; y += vy;
      let landed = null;
      if (vy >= 0) {
        if (py <= M.top + 0.01 && y >= M.top && x >= M.x0 - 2 && x <= M.x1 + 2) landed = M.top;
        else if (v.dropT <= 0) for (const p of st.plats) if (py <= p.y + 0.01 && y >= p.y && x >= p.x0 && x <= p.x1) { landed = p.y; break; }
      }
      if (landed !== null) {
        if (tumble && vy > 8) { y = landed; vy = -vy * 0.45; tumble = false; }
        else return false;
      }
      if (y > M.top + 1 && y - h < M.bot && x + w2 > M.x0 && x - w2 < M.x1) {
        if (py - h >= M.bot - 1) { y = M.bot + h; if (vy < 0) vy = -vy * 0.4; }
        else if (x < (M.x0 + M.x1) / 2) { x = M.x0 - w2; if (vx > 0) vx = -vx * 0.5; }
        else { x = M.x1 + w2; if (vx < 0) vx = -vx * 0.5; }
      }
      if (x < B.l || x > B.r || y > B.b || (hs && y - h < B.t)) return true;
    }
    return false;
  };
  // does a KO of v end the match?
  S.ends = v => v.stocks === 1 && Game.fighters.filter(g => g !== v && g.stocks > 0).length <= 1;

  S.begin = function (v) {
    const a = v.lastHitBy && v.lastHitBy !== v ? v.lastHitBy : null;
    S.cine = { t: 0, v, a, x: v.x, y: v.y - v.h * 0.55, frame: Game.frame };
    // the launch must start while the camera pulls back, not after it (hitlag runs at 1/10 in the hold)
    v.hitlag = Math.min(v.hitlag, 6); if (a) a.hitlag = Math.min(a.hitlag, 6);
    Game.impact = null; Game.flashT = Math.min(Game.flashT, 2);
    S.n.zooms++; S.zoomV = v;
    try { Sfx.hit(1.4); } catch (e) {}
  };
  // advance the sim this tick? (the zoom spaces frames out; it never changes what they compute)
  S.advance = function (c) {
    const t = c.t;
    if (t < S.PUSH) return t % 4 === 0;
    if (t < S.PULL) return t % 10 === 0;
    if (t < S.FULL) return t % 2 === 0;
    return true;
  };
  S.reset = function () { S.cine = null; S.out = null; S.pend.length = 0; S.ko.length = 0; S.banner = null; S.fin = null; S.zoomV = null; };

  // ---- install ----
  const start0 = Game.start;
  Game.start = function () { S.reset(); return start0.apply(this, arguments); };

  const onHit0 = Game.onHit;
  Game.onHit = function (v, att, hb, d, kb) {
    if (!S.on()) return onHit0.apply(this, arguments);
    const imp = this.impact, fl = this.flashT, sh = this.shakeT;
    const r = onHit0.apply(this, arguments);
    this.slowT = 0;
    if (kb >= 160 && !S.cine) { this.impact = { x: v.x, y: v.y - v.h / 2, t: 12 }; this.flashT = Math.max(fl, 5); }
    else { this.impact = imp; this.flashT = fl; }
    this.shakeT = Math.max(sh, Math.min(kb >= 160 ? 9 : 5, kb / 22));   // Smash: small, decaying; was up to 22
    if (!S.cine && !this.endT && S.ends(v)) S.pend.push(v);
    return r;
  };

  const ko0 = Game.ko;
  Game.ko = function (f) {
    if (!S.on()) return ko0.apply(this, arguments);
    const rings = this.rings.length, B = this.stage.blast;
    const r = ko0.apply(this, arguments);
    for (let i = rings; i < this.rings.length; i++) this.rings[i].max = Math.min(this.rings[i].max, 170);   // was a screen-wide 380 ring
    this.shakeT = Math.min(this.shakeT, 12);
    this.slowT = 0;
    const ex = clamp(f.x, B.l, B.r), ey = clamp(f.y - f.h / 2, B.t, B.b);
    S.ko.push({ f, x: ex, y: ey, color: f.color, final: !!this.endT, at: this.frame });
    if (S.ko.length > 8) S.ko.shift();
    // not in training: stocks there are endless, so every KO slammed a giant "99 - 99" across the
    // middle of the screen (runs/train3/04_boxes.jpg)
    if (!this.endT && this.fighters.length === 2 && !(window.TRAIN && TRAIN.on)) S.banner = { t: 0, s: this.fighters.map(g => g.stocks) };
    if (S.cine && S.cine.v === f) S.cine = null;
    // the match-ending KO: if the Finish Zoom did not call it at the hit (the victim got control back and
    // still died, a self-destruct, a hazard), the renderer cuts to a close-up at the blast line instead,
    // so every match ends on a zoom (99_v3_finish)
    if (this.endT) { S.n.finishes++; S.fin = { f, zoomed: S.zoomV === f }; }
    S.zoomV = null;
    return r;
  };

  const step0 = Game.step;
  Game.step = function () {
    if (!S.on() || this.paused) return step0.apply(this, arguments);
    if (S.banner && ++S.banner.t > 94) S.banner = null;
    // GAME! / TIME!: the world freezes solid on the KO frame (Smash), the call and the outro run on
    // their own clock, then results. 71_hud draws the call from endT.
    if (this.endT) {
      this.tick++;
      if (this.endT < S.GAME_T) this.endT++;
      else {
        if (!S.out) S.out = { t: 0, w: this.winner };
        if (++S.out.t > S.OUT_T) { S.out = null; this.finish(); }
      }
      endInputFrame(); return;
    }
    this.slowT = 0;   // no slow motion at all: the finish spaces frames out itself (21_roster2 / 27_tekken / ko() set it too)
    if (this.impact && this.impact.t > 12) this.impact.t = 12;   // grabs, Tekken moves, bombs: ~10 frames of speed lines, no camera punch
    if (S.pend.length) {
      if (!S.cine && !this.endT) for (const v of S.pend) if (S.ends(v) && S.kills(v, S.AFTER)) { S.begin(v); break; }
      S.pend.length = 0;
    }
    const c = S.cine;
    if (c) {
      c.t++;
      const v = c.v;
      if (c.t > S.FULL && v.state !== 'hitstun' && v.state !== 'dead') { S.n.lies++; S.cine = null; }   // survived: never expected
      else if (c.t > 900) S.cine = null;
      else if (!S.advance(c)) { this.tick++; endInputFrame(); return; }
    }
    return step0.apply(this, arguments);
  };
  return S;
})();
