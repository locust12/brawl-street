// ===== COSMETICS, the 2D half: character select, the results screen, and the store swatch =====
// Design + reasoning: docs/ECONOMY.md §8. Progress: dev/NOTES-economy.md.
// The 3D half (in-match) is src/98_v3_econ.mjs. The catalogue is src/89_econ.js.
//
// WHY THIS FILE EXISTS
//   Cosmetics are the shelf that is legal in a money match, so they are the shelf that has to pay
//   for the game. A cosmetic nobody ever SEES is not a cosmetic, it is a refund waiting to happen.
//   Before this file, a finish only appeared on a weapon while it was in your hands and an aura only
//   appeared in the fight itself — so a player bought Solid Gold, went to the character select, saw
//   nothing, went to the results screen, saw nothing, and reasonably concluded it was broken.
//   Every cosmetic now renders on all three surfaces plus a swatch in the store.
//
// THE READABILITY RULE STILL APPLIES (docs/ECONOMY.md §8). These are PORTRAITS and store swatches,
//   not fighters in a live match, so tinting the art here changes nothing a player has to read
//   under pressure. Nothing in this file runs during a fight, and nothing in it touches fight state.
//
// It never uses the seeded Rng — it is page code and uses Math.random / performance.now only.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined') return;

  // #rrggbb + alpha -> rgba()
  function rgba(hex, a) {
    if (!hex) return 'rgba(255,255,255,' + a + ')';
    // 15 Oct: `hueAt` returns an hsl() string and this only ever parsed HEX, so `parseInt('hsl(42,
    // 95%,62%)', 16)` came back NaN and every fill built from it was an invalid colour the canvas
    // silently dropped. That is the whole reason FULL SPECTRUM rendered as a few drifting dots on
    // black: its bloom, its pool and its rim were all painted in NaN and none of them ever appeared.
    // Every other aura has a hex colour, which is why only the rainbow one was affected.
    if (hex[0] !== '#' && hex.slice(0, 3) === 'hsl') return hex.replace(/^hsl\(/, 'hsla(').replace(/\)$/, ',' + a + ')');
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const hueAt = t => `hsl(${Math.round((t % 1) * 360)},95%,62%)`;

  // ---------------------------------------------------------------- the paint passes
  // A FINISH recolours metal. On a portrait that means two passes, both clipped to the pixels that
  // are already there (`source-atop`) so the transparent background is never filled in:
  //   1. a flat tint at half strength, which keeps the art's own shading readable underneath
  //   2. a diagonal specular sweep whose strength is the finish's own `metal` value, which is what
  //      actually sells Chrome as chrome and Carbon as matte
  function paintFinish(ctx, W, H, fin, t) {
    if (!fin) return;
    const metal = fin.metal == null ? 0.6 : fin.metal;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.52;
    ctx.fillStyle = fin.color || '#ffffff';
    ctx.fillRect(0, 0, W, H);
    // the sweep. A high-metal finish gets a tight, bright band; a matte one gets a wide, dim one.
    const tight = 0.06 + (1 - metal) * 0.22;
    const at = 0.5 + Math.sin(t * 0.7) * 0.16;
    const g = ctx.createLinearGradient(0, H, W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(Math.max(0, at - tight), 'rgba(255,255,255,0)');
    g.addColorStop(at, 'rgba(255,255,255,' + (0.3 + metal * 0.55).toFixed(2) + ')');
    g.addColorStop(Math.min(1, at + tight), 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // a `glow` finish (Toxic, Vaporwave, Liquidation Red) throws colour past its own edge
    if (fin.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 + Math.sin(t * 1.6) * 0.08;
      const r = ctx.createRadialGradient(W / 2, H * 0.55, W * 0.1, W / 2, H * 0.55, W * 0.62);
      r.addColorStop(0, rgba(fin.color, 0.5));
      r.addColorStop(1, rgba(fin.color, 0));
      ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ---- "behind the fighter", on a canvas that has no behind ------------------------------------
  // The first version of the aura, the trail and the throne all drew with `destination-over`, which
  // is the obvious way to get behind a character. It rendered NOTHING, every time: `drawPortrait`
  // paints full-bleed art, so there is not one transparent pixel left for a lower layer to show
  // through, and the passes were shipping invisible — the exact failure this file exists to stop.
  // (Caught by looking at dev/cosm_shots/sheet_aura.png, not by the code running without an error.)
  //
  // So anything that should read as "around you" is built on its own layer, has a soft hole punched
  // where the fighter is, and is then composited ON TOP. The fighter stays fully readable and the
  // effect is unmissable — which is also how it has to behave under the readability rule.
  const layers = new Map();
  function layer(W, H) {
    const k = W + 'x' + H;
    let c = layers.get(k);
    if (!c) { c = document.createElement('canvas'); c.width = W; c.height = H; layers.set(k, c); }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    return g;
  }
  // clear a soft oval where the fighter stands, so the effect frames them instead of covering them.
  //
  // 15 Oct: SOLO turns this off. The store's cosmetic cards are baked without a fighter in them
  // (dev/cosmbake.mjs) because 25 cards all showing the same doge is not a shop, and with nobody
  // standing there the punched hole is just a bite out of the middle of the effect.
  let SOLO = false;
  function punch(g, W, H, r0, r1) {
    if (SOLO) return;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const grd = g.createRadialGradient(W / 2, H * 0.54, W * r0, W / 2, H * 0.54, W * r1);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.72, 'rgba(0,0,0,.72)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.restore();
  }

  // An AURA is light AROUND you: a coloured rim on the frame, a pool at your feet, and live motes.
  function paintAura(ctx, W, H, aur, t) {
    if (!aur) return;
    const col = aur.rainbow ? hueAt(t * 0.14) : (aur.color || '#ffffff');
    const g = layer(W, H);
    const cx = W / 2, cy = H * 0.54, R = W * (0.72 + Math.sin(t * 1.1) * 0.03);
    const bloom = g.createRadialGradient(cx, cy, W * 0.1, cx, cy, R);
    bloom.addColorStop(0, rgba(col, 0.95));
    bloom.addColorStop(0.62, rgba(col, 0.5));
    bloom.addColorStop(1, rgba(col, 0.06));
    g.fillStyle = bloom; g.fillRect(0, 0, W, H);
    punch(g, W, H, 0.19, 0.47);          // the fighter's own space stays clear
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(g.canvas, 0, 0);
    // the pool at their feet, the same shape as the ring the 3D aura draws on the deck
    const fy = H * 0.93;
    const fg = ctx.createRadialGradient(cx, fy, 2, cx, fy, W * 0.46);
    fg.addColorStop(0, rgba(col, 0.85)); fg.addColorStop(0.5, rgba(col, 0.3)); fg.addColorStop(1, rgba(col, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(cx, fy, W * 0.46, H * 0.085, 0, 0, Math.PI * 2); ctx.fill();
    // motes, so the aura reads as alive rather than as a gradient
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t * 0.6, rr = W * (0.33 + 0.1 * Math.sin(t * 1.3 + i));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.86;
      ctx.fillStyle = aur.rainbow ? hueAt(t * 0.14 + i / 12) : col;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 2 + i);
      ctx.beginPath(); ctx.arc(x, y, W * 0.016 + W * 0.011 * Math.sin(t * 3 + i), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // A PLATE is the frame around your name, so on a portrait it is the frame around the portrait.
  function paintPlate(ctx, W, H, plate) {
    if (!plate) return;
    const col = plate.color || '#ffc83a';
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    ctx.globalAlpha = 0.28; ctx.lineWidth = 8;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    // corner ticks, so it reads as a plate and not as a border
    ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.beginPath();
    const k = Math.max(10, W * 0.11);
    for (const [x, sx] of [[2, 1], [W - 2, -1]]) for (const [y, sy] of [[2, 1], [H - 2, -1]]) {
      ctx.moveTo(x + sx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * k);
    }
    ctx.stroke();
    ctx.restore();
  }

  // A TRAIL is the streak you leave when you are launched: a comet tail out of the lower-left,
  // additive on top, with the fighter punched out of it so you can still see who is flying.
  function paintTrail(ctx, W, H, trl, t) {
    if (!trl) return;
    const col = trl.color || '#ffffff';
    const g = layer(W, H);
    for (let i = 0; i < 11; i++) {
      const k = i / 11;
      g.globalAlpha = (1 - k) * 0.85;
      g.fillStyle = col;
      const x = W * 0.52 - W * 0.115 * (i + 1), y = H * 0.54 + H * 0.055 * (i + 1) + Math.sin(t * 2 + i) * 3;
      g.beginPath();
      if (trl.id === 'trl_ice' || trl.id === 'trl_glitch') {   // shards / scanlines, not smoke
        g.save(); g.translate(x, y); g.rotate(-0.5 + (trl.id === 'trl_glitch' ? 0 : i * 0.2));
        g.fillRect(-W * 0.11 * (1 - k * 0.5), -H * 0.02, W * 0.22 * (1 - k * 0.5), H * 0.035);
        g.restore();
      } else {
        g.ellipse(x, y, W * 0.14 * (1 - k * 0.5), H * 0.075 * (1 - k * 0.5), -0.5, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    punch(g, W, H, 0.1, 0.34);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.95;
    ctx.drawImage(g.canvas, 0, 0);
    ctx.restore();
  }

  // A KO EFFECT is what the screen does when you send somebody off, so the still shows it going off.
  function paintKo(ctx, W, H, ko, t) {
    if (!ko) return;
    const col = ko.color || '#ffffff';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (ko.id === 'ko_nova') {
      const g = ctx.createRadialGradient(W / 2, H * 0.5, W * 0.05, W / 2, H * 0.5, W * 0.55);
      g.addColorStop(0, rgba(col, 0.85)); g.addColorStop(0.6, rgba(col, 0.12)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W / 2, H * 0.5, W * (0.3 + 0.05 * Math.sin(t * 2)), 0, Math.PI * 2); ctx.stroke();
    } else if (ko.id === 'ko_liq') {
      ctx.fillStyle = rgba(col, 0.75);
      ctx.fillRect(W * 0.44, H * 0.1, W * 0.12, H * 0.62);
      ctx.fillRect(W * 0.485, H * 0.04, W * 0.03, H * 0.8);
    } else if (ko.id === 'ko_rain') {
      for (let i = 0; i < 14; i++) {
        const x = (i * 97 % 100) / 100 * W, y = ((i * 53 + t * 40) % 100) / 100 * H;
        ctx.fillStyle = rgba(col, 0.8);
        ctx.beginPath(); ctx.ellipse(x, y, W * 0.022, W * 0.01, 0.4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (ko.id === 'ko_bell') {
      // the bell goes: concentric brass rings opening out of the middle
      for (let i = 0; i < 4; i++) {
        const r = W * (0.1 + 0.13 * i + 0.05 * Math.sin(t * 2));
        ctx.strokeStyle = rgba(col, 0.85 - i * 0.18); ctx.lineWidth = W * (0.022 - i * 0.004);
        ctx.beginPath(); ctx.arc(W / 2, H * 0.5, r, 0, Math.PI * 2); ctx.stroke();
      }
      const g = ctx.createRadialGradient(W / 2, H * 0.5, W * 0.02, W / 2, H * 0.5, W * 0.4);
      g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else if (ko.id === 'ko_cash') {
      // a wall of notes blowing across and still going
      for (let i = 0; i < 26; i++) {
        const x = ((i * 61 + t * 90) % 118 - 9) / 100 * W, y = ((i * 37) % 100) / 100 * H;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.5 + ((i * 29) % 100) / 100);
        ctx.fillStyle = rgba(col, 0.9); ctx.fillRect(0, 0, W * 0.07, W * 0.032);
        ctx.fillStyle = rgba('#0d2a18', 0.5); ctx.fillRect(W * 0.024, W * 0.009, W * 0.022, W * 0.014);
        ctx.restore();
      }
    } else if (ko.id === 'ko_lamp') {
      // every light on the stage cuts out for a beat: one failing lamp, everything else gone
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(2,3,5,.72)'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const flick = 0.35 + 0.65 * Math.abs(Math.sin(t * 9));
      const g = ctx.createRadialGradient(W / 2, H * 0.3, W * 0.01, W / 2, H * 0.3, W * 0.42);
      g.addColorStop(0, rgba(col, 0.95 * flick)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = rgba(col, 0.8 * flick);
      ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.3); ctx.lineTo(W * 0.3, H); ctx.lineTo(W * 0.7, H); ctx.fill();
    } else if (ko.id === 'ko_siren') {
      // red and blue over the whole stage: somebody called it in
      for (const [c, side] of [['#ff2a3a', -1], ['#2a6aff', 1]]) {
        const cx = W / 2 + side * W * 0.26 * (0.7 + 0.3 * Math.sin(t * 3 * side));
        const g = ctx.createRadialGradient(cx, H * 0.45, W * 0.02, cx, H * 0.45, W * 0.46);
        g.addColorStop(0, rgba(c, 0.85)); g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    } else if (ko.id === 'ko_chalk') {
      // the outline left on the floor, drawn as the chalk line it is
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = rgba(col, 0.92); ctx.lineWidth = Math.max(2, W * 0.012);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const cx = W / 2, cy = H * 0.56, u = W * 0.1;
      ctx.beginPath(); ctx.arc(cx, cy - u * 1.5, u * 0.5, 0, Math.PI * 2); ctx.stroke();        // head
      ctx.beginPath();
      ctx.moveTo(cx, cy - u); ctx.lineTo(cx, cy + u * 0.6);                                     // spine
      ctx.moveTo(cx, cy - u * 0.7); ctx.lineTo(cx - u * 1.5, cy - u * 0.1);                     // arms
      ctx.moveTo(cx, cy - u * 0.7); ctx.lineTo(cx + u * 1.5, cy - u * 0.5);
      ctx.moveTo(cx, cy + u * 0.6); ctx.lineTo(cx - u * 0.8, cy + u * 1.8);                     // legs
      ctx.moveTo(cx, cy + u * 0.6); ctx.lineTo(cx + u * 0.9, cy + u * 1.7);
      ctx.stroke();
    } else if (ko.id === 'ko_spark') {
      // grinder sparks: one source, warm, long falloff
      for (let i = 0; i < 30; i++) {
        const a = -Math.PI * 0.78 + (i % 11) / 11 * Math.PI * 0.56;
        const r = W * (0.06 + 0.34 * (((i * 13) % 10) / 10));
        const x = W * 0.5 + Math.cos(a) * r, y = H * 0.66 + Math.sin(a) * r;
        ctx.strokeStyle = rgba(i % 3 ? col : '#fff3d0', 0.9 - r / W);
        ctx.lineWidth = Math.max(1.5, W * 0.006);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * W * 0.035, y + Math.sin(a) * W * 0.035); ctx.stroke();
      }
    } else if (ko.id === 'ko_smoke') {
      // a thick column going up and off the top
      for (let i = 0; i < 9; i++) {
        const k = i / 9, y = H * (0.92 - k * 0.95), r = W * (0.07 + k * 0.17);
        const g = ctx.createRadialGradient(W / 2 + Math.sin(t + i) * W * 0.04, y, 1, W / 2, y, r);
        g.addColorStop(0, rgba(col, 0.42 * (1 - k * 0.6))); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    } else if (ko.id === 'ko_drop') {
      // the cover swings open and the street takes them
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3,4,7,.95)';
      ctx.beginPath(); ctx.ellipse(W / 2, H * 0.62, W * 0.2, H * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba('#8b8070', 0.9); ctx.lineWidth = Math.max(2, W * 0.01);
      ctx.beginPath(); ctx.ellipse(W / 2, H * 0.62, W * 0.2, H * 0.1, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.save();                                    // the cover, hinged open behind the hole
      ctx.translate(W * 0.68, H * 0.5); ctx.rotate(-0.5);
      ctx.fillStyle = rgba(col, 0.95);
      ctx.beginPath(); ctx.ellipse(0, 0, W * 0.19, H * 0.062, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = Math.max(1, W * 0.005);
      ctx.beginPath(); ctx.ellipse(0, 0, W * 0.13, H * 0.042, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else {
      const C = ['#ff4fd8', '#27e1ff', '#ffc83a', '#3dff8a'];
      for (let i = 0; i < 22; i++) {
        const a = i / 22 * Math.PI * 2 + t, r = W * (0.18 + 0.2 * ((i * 7 % 10) / 10));
        ctx.fillStyle = C[i % 4]; ctx.globalAlpha = 0.85;
        ctx.fillRect(W / 2 + Math.cos(a) * r, H * 0.5 + Math.sin(a) * r, W * 0.03, W * 0.02);
      }
    }
    ctx.restore();
  }

  // A VICTORY POSE is the thing the loser has to watch, so it belongs on the results screen and
  // nowhere else. Drawn as staging AROUND the winner rather than as a new character animation: a
  // throne behind them, a diamond above them, impact lines beside them.
  function paintPose(ctx, W, H, pose, t) {
    if (!pose) return;
    ctx.save();
    if (pose.id === 'vic_throne') {
      // solid wood, so it cannot be additive: drawn on its own layer, punched around the winner,
      // then laid over the top. Reads as a chair they are sitting in, and their face stays clear.
      const g = layer(W, H);
      const wood = g.createLinearGradient(0, H * 0.1, 0, H);
      wood.addColorStop(0, '#7a5616'); wood.addColorStop(1, '#2a1c06');
      g.fillStyle = wood;
      g.fillRect(W * 0.16, H * 0.14, W * 0.68, H * 0.7);          // back
      g.fillRect(W * 0.06, H * 0.56, W * 0.88, H * 0.3);          // seat + arms
      g.fillStyle = '#ffc83a';
      for (let i = 0; i < 6; i++) {                               // crown spikes along the top
        const x = W * (0.17 + i * 0.113);
        g.beginPath(); g.moveTo(x, H * 0.17); g.lineTo(x + W * 0.045, H * 0.03); g.lineTo(x + W * 0.09, H * 0.17); g.fill();
      }
      g.fillStyle = 'rgba(255,200,61,.8)'; g.fillRect(W * 0.06, H * 0.56, W * 0.88, 5);
      punch(g, W, H, 0.16, 0.4);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(g.canvas, 0, 0);
    } else if (pose.id === 'vic_diamond') {
      ctx.globalCompositeOperation = 'lighter';
      const cx = W / 2, cy = H * 0.15, s = W * (0.1 + 0.008 * Math.sin(t * 3));
      ctx.fillStyle = rgba('#9fe8ff', 0.95);
      ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.8, cy); ctx.lineTo(cx, cy + s * 1.2); ctx.lineTo(cx - s * 0.8, cy); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.7);
      ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.8, cy); ctx.lineTo(cx, cy); ctx.fill();
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, W * 0.3);
      g.addColorStop(0, rgba('#9fe8ff', 0.4)); g.addColorStop(1, rgba('#9fe8ff', 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      // Flex: hard impact rays out of the middle, the comic-book way of saying "look at this".
      // Additive and on top, starting outside the fighter, so they frame rather than cover.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * Math.PI * 2 + Math.sin(t) * 0.06;
        ctx.strokeStyle = i % 2 ? 'rgba(255,200,61,.75)' : 'rgba(255,90,60,.5)';
        ctx.lineWidth = i % 2 ? 4 : 9;
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(a) * W * 0.34, H * 0.52 + Math.sin(a) * H * 0.34);
        ctx.lineTo(W / 2 + Math.cos(a) * W * 0.9, H * 0.52 + Math.sin(a) * H * 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Everything, in the order a fight would layer it. `slots` picks which passes run, because the
  // character select is not the place to set off a KO effect.
  function paint(cv, look, opts) {
    if (!cv || !look) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const W = cv.width, H = cv.height, t = ((opts && opts.t) != null ? opts.t : performance.now() / 1000);
    const only = (opts && opts.only) || null;
    const on = s => !only || only.indexOf(s) >= 0;
    SOLO = !!(opts && opts.solo);
    if (on('ko')) paintKo(ctx, W, H, look.ko, t);
    if (on('pose')) paintPose(ctx, W, H, look.pose, t);
    if (on('finish')) paintFinish(ctx, W, H, look.finish, t);
    if (on('trail')) paintTrail(ctx, W, H, look.trail, t);
    if (on('aura')) paintAura(ctx, W, H, look.aura, t);
    if (on('plate')) paintPlate(ctx, W, H, look.plate);
    SOLO = false;
  }

  // ---------------------------------------------------------------- a chip row, for "what is on"
  function chipRow(look, cls) {
    const d = document.createElement('div');
    d.className = 'cosm-row ' + (cls || '');
    const order = ['finish', 'aura', 'trail', 'ko', 'pose', 'plate'];
    let n = 0;
    for (const s of order) {
      const c = look[s]; if (!c) continue;
      n++;
      const e = document.createElement('span'); e.className = 'cosm-chip';
      if (c.color) e.style.setProperty('--cc', c.color);
      e.innerHTML = '<i>' + (c.icon || '✦') + '</i>' + c.name;
      d.appendChild(e);
    }
    return n ? d : null;
  }

  // ================= the DOM half: the screens that draw the fighter as an <img> =================
  // The character select and the results screen were rebuilt (src/85_menu.js) around the painted
  // character art in an <img>, not the old <canvas> portrait — so a canvas pass reaches neither of
  // them. The art is a cut-out PNG, which is what makes this easy and exact:
  //   - the FINISH is a CSS filter on the image itself (so it follows the silhouette perfectly,
  //     down to the alpha edge) plus a masked specular sweep for the metals
  //   - the AURA is a blurred radial behind the image, which on a DOM node really can be behind
  // Nothing here reads or writes fight state, and it is all page CSS — zero cost in a match.
  function hsl(hex) {
    const h = (hex || '#ffffff').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return { h: 0, s: 0, l };
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const hh = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: hh * 60, s, l };
  }
  // A finish is a recolour of metal, so it is derived from the catalogue colour rather than hand
  // written per SKU — add a finish to ECON_CATALOG and it renders here with no code change.
  //   near-grey finishes (Chrome, Carbon) -> greyscale + a brightness set by their lightness
  //   coloured finishes (Gold, Toxic, Vaporwave, Liquidation Red) -> sepia, then rotated onto their
  //   own hue (sepia lands around 40 deg, so the rotation is hue - 40) and saturated hard
  function finFilter(fin) {
    if (!fin) return '';
    const c = hsl(fin.color), metal = fin.metal == null ? 0.6 : fin.metal;
    const glow = fin.glow ? ` drop-shadow(0 0 16px ${fin.color}) drop-shadow(0 0 40px ${fin.color}88)` : '';
    if (c.s < 0.45) return `grayscale(1) brightness(${(0.35 + c.l * 0.95).toFixed(2)}) contrast(${(1.05 + metal * 0.3).toFixed(2)})${glow}`;
    return `sepia(1) saturate(${(1 + c.s * 3.5).toFixed(2)}) hue-rotate(${Math.round(c.h - 40)}deg) brightness(${(0.6 + c.l * 0.9).toFixed(2)}) contrast(${(1 + metal * 0.25).toFixed(2)})${glow}`;
  }
  function auraBg(aur, t) {
    if (!aur) return '';
    const col = aur.rainbow ? hueAt(t * 0.14) : aur.color;
    return `radial-gradient(closest-side, ${rgba(col, 0.9)}, ${rgba(col, 0.42)} 48%, ${rgba(col, 0)} 78%)`;
  }
  // `host` is the element that holds the <img>. Idempotent: it only writes when something changed,
  // so the 120 ms repaint that animates the aura costs one style write and no DOM churn.
  function dressArt(host, look) {
    if (!host) return false;
    const img = host.querySelector('img');
    if (!img) return false;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const t = performance.now() / 1000;
    const sig = (look.finish ? look.finish.id : '-') + '|' + (look.aura ? look.aura.id : '-') + '|' + (img.getAttribute('src') || '').slice(-24);
    // --- aura: a blurred radial BEHIND the cut-out, PLUS a rim glow traced from the cut-out's own
    // alpha. The radial alone was almost invisible against the select screen's dark red backdrop —
    // a diffuse haze behind a character on a busy background reads as nothing. `drop-shadow`
    // follows the art's alpha exactly, so the light comes off the FIGHTER instead of off a box,
    // which is both unmissable and the thing that was actually bought.
    let a = host.querySelector(':scope > .cosm-glow');
    let rim = '';
    if (look.aura) {
      if (!a) { a = document.createElement('div'); a.className = 'cosm-glow'; host.prepend(a); }
      a.style.background = auraBg(look.aura, t);
      a.style.opacity = (0.82 + Math.sin(t * 1.6) * 0.14).toFixed(3);
      img.style.position = img.style.position || 'relative';
      img.style.zIndex = img.style.zIndex || '1';
      // The rim does NOT pulse. A changing drop-shadow radius re-runs the whole filter chain on a
      // large image every repaint, and this loop ticks 8x a second; the pulse lives on the .cosm-glow
      // div's opacity instead, which the compositor handles for free. Rainbow is the one exception,
      // and its hue is quantised to 24 steps so it re-filters a few times a second, not eight.
      const col = look.aura.rainbow ? hueAt(Math.floor(t * 0.14 * 24) / 24) : look.aura.color;
      rim = ` drop-shadow(0 0 11px ${col}) drop-shadow(0 0 30px ${col}) drop-shadow(0 0 70px ${rgba(col, 0.75)})`;
    } else if (a) { a.remove(); }
    // --- finish: a filter on the art, plus a moving specular band masked to the same art
    let s = host.querySelector(':scope > .cosm-sheen');
    if (look.finish) {
      const f = finFilter(look.finish) + rim;
      if (img.style.filter !== f) img.style.filter = f;   // only write when it actually changed
      const src = img.getAttribute('src');
      if (src && (look.finish.metal == null || look.finish.metal >= 0.4)) {
        if (!s) { s = document.createElement('div'); s.className = 'cosm-sheen'; host.appendChild(s); }
        if (s.dataset.sig !== sig) {
          s.dataset.sig = sig;
          s.style.webkitMaskImage = s.style.maskImage = `url("${src}")`;
        }
        const ir = img.getBoundingClientRect(), hr = host.getBoundingClientRect();
        if (ir.width) {
          s.style.left = (ir.left - hr.left) + 'px'; s.style.top = (ir.top - hr.top) + 'px';
          s.style.width = ir.width + 'px'; s.style.height = ir.height + 'px';
        }
        s.style.backgroundPosition = ((t * 40) % 300 - 100).toFixed(0) + '% 0';
      } else if (s) { s.remove(); }
    } else { if (img.style.filter !== rim) img.style.filter = rim; if (s) s.remove(); }
    return true;
  }
  function undressArt(host) {
    if (!host) return;
    const img = host.querySelector('img'); if (img) img.style.filter = '';
    const a = host.querySelector(':scope > .cosm-glow'); if (a) a.remove();
    const s = host.querySelector(':scope > .cosm-sheen'); if (s) s.remove();
  }
  // the small roster/slot faces are CSS background-images, so they get the aura as a rim light and
  // the finish as a filter on the tile — enough to read at 56 px, which is all they have to do
  function dressFace(face, look) {
    if (!face) return;
    face.style.filter = look.finish ? finFilter(look.finish) : '';
    face.style.boxShadow = look.aura
      ? `0 0 0 2px ${look.aura.rainbow ? hueAt(performance.now() / 7000) : look.aura.color}, 0 0 18px ${rgba(look.aura.rainbow ? '#ffffff' : look.aura.color, 0.8)}`
      : '';
  }

  const css = `
  .cosm-glow{position:absolute;inset:2% -6%;z-index:0;pointer-events:none;filter:blur(26px);mix-blend-mode:screen}
  .cosm-sheen{position:absolute;z-index:3;pointer-events:none;mix-blend-mode:screen;
    -webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
    -webkit-mask-position:center;mask-position:center;background-size:300% 100%;background-repeat:no-repeat;
    background-image:linear-gradient(108deg,transparent 40%,rgba(255,255,255,.1) 46%,rgba(255,255,255,.85) 50%,rgba(255,255,255,.1) 54%,transparent 60%)}
  .winart{position:relative}
  #scResults .winner{position:relative}
  #scResults .winner > *:not(.cosm-fx){position:relative;z-index:1}
  .cosm-row{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:8px}
  .cosm-chip{--cc:#ffc83a;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;font:700 11px var(--mono);
    letter-spacing:.05em;text-transform:uppercase;color:var(--cc);background:rgba(5,5,7,.55);box-shadow:inset 0 0 0 1px var(--cc)}
  .cosm-chip i{font-style:normal;font-size:13px}
  #heroP1 .cosm-row,#heroP2 .cosm-row{justify-content:flex-start;margin-top:10px}
  .cosm-row.sel .cosm-chip{font-size:10px;padding:2px 7px}
  /* 15 Oct, after Duane: "Cosmetics all the images are dark I cant even see what it is".
     Three causes, all here:
       1. the preview was a 54px chip in the corner while the card's 212x132 art box sat EMPTY, so
          the big dark rectangle was the rarity gradient with nothing on it;
       2. .card.lock dimmed it to brightness(.5) -- the one item you are deciding whether to buy was
          the one drawn darkest;
       3. nothing else ever filled .ic, because no cosmetic has a baked render.
     The swatch now IS the artwork: it fills the art box, and a locked card only desaturates slightly
     so you can still see exactly what you would be paying for. */
  .card .sw{position:absolute;inset:0;margin:auto;height:100%;width:auto;pointer-events:none;opacity:1;display:block}
  .card.lock .sw{filter:saturate(.82)}
  .card .ic{position:relative;z-index:2;overflow:hidden}
  `;
  let styled = false;
  function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  // ---------------------------------------------------------------- the three surfaces
  // Character select: the slots this account is actually playing get its look. A CPU slot gets
  // nothing, for the same reason `Econ.lookFor` gives a CPU nothing — it is not anybody's account.
  function onSelect() {
    style();
    const look = Econ.look();
    const UIslots = (typeof UI !== 'undefined' && UI.slots) || [];
    const mine = i => { const s = UIslots[i]; return !!s && s.ctrl !== 'cpu'; };
    // the two big hero panels (85_menu.js). A CPU seat is nobody's account, so it stays bare —
    // the same rule `Econ.lookFor` uses in a match.
    ['heroP1', 'heroP2'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      const art = el.querySelector('.art') || el;
      const old = el.querySelector('.cosm-row');
      if (!mine(i)) { undressArt(art); if (old) old.remove(); return; }
      dressArt(art, look);
      // the chips go under the hero's stat plate, which has the room for them — the slot card at
      // the bottom of the screen is 150 px wide and they just overflowed it
      const sig = Econ.SLOTS.map(s => (look[s] ? look[s].id : '-')).join(',');
      if (old && old.dataset.sig !== sig) old.remove();
      if (!old || old.dataset.sig !== sig) { const c = chipRow(look, 'sel'); if (c) { c.dataset.sig = sig; (el.querySelector('.plate') || el).appendChild(c); } }
    });
    // the slot strip along the bottom, and the old canvas layout if it is ever rendered again
    document.querySelectorAll('#slots .slot').forEach((el, i) => {
      if (!mine(i)) { dressFace(el.querySelector('.face'), {}); return; }
      dressFace(el.querySelector('.face'), look);
      const cv = el.querySelector('canvas');
      if (cv) paint(cv, look, { only: ['finish', 'aura', 'plate'] });
    });
  }
  // Results: the winner's own look, everything they own, including the KO effect and the pose —
  // this is the screenshot people post, so it is the one place that shows the whole set at once.
  function onResults(w) {
    style();
    if (!w) return;
    const look = (Econ.lookFor ? Econ.lookFor(w.idx) : Econ.look()) || {};
    // the painted winner art (85_menu.js) is the hero of this screen and the thing people clip
    dressArt(document.querySelector('#scResults .winart'), look);
    // the legacy canvas portrait, still drawn underneath by the base UI.showResults
    paint(document.getElementById('winCv'), look);
    const host = document.querySelector('#scResults .winner');
    if (!host) return;
    // the victory pose and the KO effect are staged around the winner, in their own layer over the
    // whole panel — this is the frame people screenshot, so it is the one place the full set shows
    let fx = host.querySelector('.cosm-fx');
    if (look.pose || look.ko) {
      if (!fx) {
        fx = document.createElement('canvas'); fx.className = 'cosm-fx';
        // INLINE, not in the stylesheet: a canvas here picks up other rules (#scResults sizes its
        // own portrait canvas) and a class selector loses to them, which left this drawing at its
        // intrinsic size in the top-left corner instead of over the winner.
        fx.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none';
        host.prepend(fx);
      }
      const wpx = Math.max(240, host.clientWidth || Math.round(host.getBoundingClientRect().width));
      const hpx = Math.max(240, host.clientHeight || Math.round(host.getBoundingClientRect().height));
      if (fx.width !== wpx || fx.height !== hpx) { fx.width = wpx; fx.height = hpx; }
      const g = fx.getContext('2d');
      g.clearRect(0, 0, wpx, hpx);
      const t = performance.now() / 1000;
      if (look.ko) paintKo(g, wpx, hpx, look.ko, t);
      if (look.pose) paintPose(g, wpx, hpx, look.pose, t);
    } else if (fx) { fx.remove(); }
    // rebuild the chip row when the equipped set changes — it used to be created once and then
    // kept showing the previous loadout's chips forever
    const sig = Econ.SLOTS.map(s => (look[s] ? look[s].id : '-')).join(',');
    let row = host.querySelector('.cosm-row');
    if (row && row.dataset.sig !== sig) { row.remove(); row = null; }
    if (!row) { const chips = chipRow(look, 'res'); if (chips) { chips.dataset.sig = sig; host.appendChild(chips); } }
  }
  // Store: a live swatch on every cosmetic card, so nobody buys a name.
  // The base is the account's own main fighter, so the swatch is what THEY will look like.
  function swatch(card, d) {
    style();
    if (!card || card.querySelector('.sw')) return;
    const cv = document.createElement('canvas');
    // drawn at 2x the box it fills, so it is sharp on a retina panel
    // drawPortrait draws SQUARE; a landscape canvas put it off the edge and the box came out black.
    cv.className = 'sw'; cv.width = 320; cv.height = 320;
    // ROOT CAUSE of "the cosmetics are all black", found 15 Oct by extracting the canvas: the swatch
    // painted ONCE, synchronously, at card-build time. drawArt() bails out when the portrait image
    // has not finished loading (`!im.complete`), so on a cold card the canvas stayed empty and
    // nothing ever came back to repaint it. Probing it later always looked fine, because by then the
    // image was cached -- which is exactly why this hid for so long.
    // So: draw now, and draw AGAIN when the portrait actually arrives.
    const id = (typeof store !== 'undefined' && store.get('lastChar', null)) || 'doge';
    const ch = (typeof CHAR_BY_ID !== 'undefined' && (CHAR_BY_ID[id] || CHAR_BY_ID.doge)) || null;
    const render = () => {
      try { if (ch && typeof drawPortrait === 'function') drawPortrait(cv, ch, { bare: true }); }
      catch (e) { /* the effect still paints over an empty plate */ }
      paint(cv, { [d.slot]: d }, { only: [d.slot] });
    };
    render();
    const im = (typeof PORTRAITS !== 'undefined' && ch) ? PORTRAITS[ch.id] : null;
    if (im && !(im.complete && im.naturalWidth)) {
      im.addEventListener('load', render, { once: true });
      im.addEventListener('error', render, { once: true });
    }
    (card.querySelector('.ic') || card).appendChild(cv);
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    style();
    if (typeof UI !== 'undefined' && UI.renderSelect) {
      const b = UI.renderSelect;
      UI.renderSelect = function () { const r = b.apply(this, arguments); try { onSelect(); } catch (e) { /* never block the menu */ } return r; };
    }
    if (typeof UI !== 'undefined' && UI.showResults) {
      const b = UI.showResults;
      UI.showResults = function (w) { const r = b.apply(this, arguments); try { onResults(w); } catch (e) { /* never block results */ } return r; };
    }
    // repaint while either screen is open, so an aura actually moves and a finish actually glints
    setInterval(() => {
      try {
        const sel = document.getElementById('scSelect'), res = document.getElementById('scResults');
        if (sel && !sel.hidden) onSelect();
        else if (res && !res.hidden) onResults(Game && Game.winner);
      } catch (e) { /* a cosmetic must never break a screen */ }
    }, 120);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', wire, { once: true }); else setTimeout(wire, 0);

  window.Cosm = { paint, swatch, chipRow, onSelect, onResults,
    passes: { finish: paintFinish, aura: paintAura, plate: paintPlate, trail: paintTrail, ko: paintKo, pose: paintPose } };
})();
