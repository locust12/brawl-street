// ===== stage name card at the start of a match =====
// Wraps R.hud (71_hud.js) and draws after it, the same pattern as 82_combo_hud.js / 83_feel_hud.js.
// 9/20, Duane: "you need to put the map name somewhere in the game while u are playing otherwise u
// dont know and forget." Two halves: this card rides in with the countdown and fades a second after
// BRAWL!, and the small permanent label under the clock plate (71_hud.js `clock`) carries it for the
// rest of the match.
// Visual only: reads Game, never writes it, and never draws from the seeded fight RNG — it uses no
// randomness at all, so arena replays stay bit-identical. It lives in its own file so the HUD
// rewrite in 71_hud.js and this can land in the same build without stepping on each other.
(function () {
  if (typeof R === 'undefined' || typeof R.hud !== 'function') return;
  const DISP = '"Barlow Condensed", Impact, sans-serif', MONO = '"JetBrains Mono", ui-monospace, monospace';
  const IN = 14, OUT = 60;          // frames to fade in with the countdown / out after it
  let lastStage = null, age = 0, endAge = 0;

  function chrome(ctx, txt, x, y, size) {
    ctx.font = `italic 900 ${size}px ${DISP}`; ctx.textAlign = 'center';
    const g = ctx.createLinearGradient(0, y - size * 0.82, 0, y);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.42, '#eef0f5'); g.addColorStop(0.52, '#8f96a8');
    g.addColorStop(0.6, '#ffffff'); g.addColorStop(1, '#c9ced9');
    ctx.lineWidth = Math.max(3, size / 9); ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,5,7,.9)';
    ctx.strokeText(txt, x, y);
    ctx.shadowColor = 'rgba(39,225,255,.45)'; ctx.shadowBlur = size * 0.3;
    ctx.fillStyle = g; ctx.fillText(txt, x, y); ctx.shadowBlur = 0;
    return ctx.measureText(txt).width;
  }

  function draw(ctx, W, H) {
    const G = Game;
    if (!G || G.demo || G.state !== 'match' || !G.stage || !G.stage.name) { lastStage = null; return; }
    if (G.stage !== lastStage) { lastStage = G.stage; age = 0; endAge = 0; }
    age++;
    if (G.countdown > 0) endAge = age;                       // still counting in
    // a match that starts with no countdown (the bet arena fast-forwards) never shows the card
    const a = G.countdown > 0 ? Math.min(1, age / IN) : Math.max(0, 1 - (age - endAge) / OUT);
    if (a <= 0.01) return;

    const name = G.stage.name.toUpperCase();
    const size = Math.round(Math.min(54, Math.max(22, W / 15)));
    const y = Math.round(Math.min(H * 0.3, H / 2 - 110));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textBaseline = 'alphabetic';
    // kicker
    ctx.font = `700 ${Math.max(9, Math.round(size * 0.21))}px ${MONO}`; ctx.textAlign = 'center';
    try { ctx.letterSpacing = '0.34em'; } catch (e) {}
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,5,7,.9)';
    ctx.strokeText('STAGE', W / 2, y - size * 0.82); ctx.fillStyle = '#9398a8'; ctx.fillText('STAGE', W / 2, y - size * 0.82);
    try { ctx.letterSpacing = '0px'; } catch (e) {}
    const tw = chrome(ctx, name, W / 2, y, size);
    // the red -> cyan rule from the clock plate, sliding open under the name
    const rw = Math.min(W - 40, tw + 70) * Math.min(1, a * 1.25);
    const g = ctx.createLinearGradient(W / 2 - rw / 2, 0, W / 2 + rw / 2, 0);
    g.addColorStop(0, 'rgba(255,42,74,0)'); g.addColorStop(0.2, '#ff2a4a');
    g.addColorStop(0.8, '#27e1ff'); g.addColorStop(1, 'rgba(39,225,255,0)');
    ctx.fillStyle = g; ctx.fillRect(W / 2 - rw / 2, y + Math.round(size * 0.24), rw, 2);
    ctx.restore();
  }

  const base = R.hud;
  R.hud = function (ctx, W, H) { base.call(this, ctx, W, H); try { draw(ctx, W, H); } catch (e) { /* never break the frame */ } };
})();
