// ===== page only: the phone touch layout =====
// 9/20, Duane: "just adjust the buttons so the controls are easier to use. they're kind of scattered
// on the phone. take example of other top games. check how they did it and fix it."
//
// What the good ones do (Brawlhalla Mobile, Skullgirls Mobile, CoD Mobile, Genshin, Brawl Stars):
//   1. The movement stick FLOATS. It appears centred on wherever your left thumb lands, so you never
//      have to look down and find it. A ghost ring shows its home while idle.
//   2. The action buttons sit on an ARC swept by the right thumb pivoting at the bottom-right corner,
//      not in a square grid. Nearest the pivot = pressed most.
//   3. Nothing sits under the thumb's resting spot; the very corner stays empty.
//   4. Targets are big (>= 48 CSS px; the primary is biggest) and everything scales with the SHORT
//      side of the viewport, so a 390px-tall landscape phone gets the same reachability as a tablet.
//   5. Pressing a button is visible: it scales down, lights up and rings in its own colour.
//   6. Nothing overlaps the HUD or the notch: the layout reads --hud-top / safe-area insets.
//
// This file owns every touch control's POSITION and SIZE. The buttons themselves (and what they do)
// still come from 01_head.html, 88_touch2.js and 24_grapple.js. Pure page code: it writes
// Touch.stickX / Touch.stickY, which 10_core.readInput reads, and never touches fight state or the Rng.
(function () {
  if (typeof document === 'undefined' || typeof Touch === 'undefined') return;
  const pad = document.getElementById('touch'), btns = document.getElementById('tbtns');
  const stick0 = document.getElementById('stick');
  if (!pad || !btns || !stick0) return;

  const st = document.createElement('style');
  st.textContent = `
  /* the anchor is a zero-size point in the safe bottom-right corner; every button is offset from it */
  #tbtns{position:fixed;left:auto;top:auto;right:max(10px,env(safe-area-inset-right));
    bottom:max(10px,env(safe-area-inset-bottom));width:0;height:0;pointer-events:none;z-index:4}
  .tb{border-width:2px;transition:transform .07s ease-out,background .07s,box-shadow .07s;will-change:transform;
    letter-spacing:.01em;text-shadow:0 1px 2px rgba(0,0,0,.6)}
  .tb.on{background:rgba(255,255,255,.34);transform:scale(.9);box-shadow:0 0 0 2px currentColor,0 0 20px currentColor}
  /* the movement zone: invisible, the whole lower-left of the screen */
  #stick{position:fixed;left:0;bottom:0;border:0;border-radius:0;background:none;pointer-events:auto;touch-action:none;z-index:4}
  #stickRing{position:fixed;border-radius:50%;border:2px solid rgba(255,255,255,.26);
    background:radial-gradient(circle,rgba(255,255,255,.08),rgba(255,255,255,.015));pointer-events:none;z-index:4;
    transform:translate(-50%,-50%);opacity:.5;transition:opacity .12s}
  #stickRing.live{opacity:1;border-color:rgba(255,255,255,.4)}
  #knob{position:absolute;left:50%;top:50%;margin:0;border-radius:50%;background:var(--irid,#ff2a4a);
    opacity:.92;box-shadow:0 0 22px rgba(255,42,74,.55);transform:translate(-50%,-50%);pointer-events:none}
  #tbDrop{left:auto!important}
  `;
  document.head.appendChild(st);

  // ---- rebuild the stick: a zone you can press anywhere in, plus a ring that follows your thumb ----
  const zone = stick0.cloneNode(false);     // cloneNode drops 10_core's fixed-centre listeners
  stick0.replaceWith(zone);
  const ring = document.createElement('div'); ring.id = 'stickRing';
  const knob = document.createElement('div'); knob.id = 'knob';
  ring.appendChild(knob); pad.appendChild(ring);

  // ---- the arc. angle 0 = straight along the bottom edge, 90 = straight up the right edge ----
  // r and size are in "u" (one button unit); the pivot sits just inside the corner.
  // The radii are not guesses: the buttons are round, and a round button is hit-tested on its circle,
  // so every neighbouring pair must satisfy  2*R*sin(dA/2) >= (sA+sB)/2 + gap  along a ring, and
  // R2 - R1 >= (s1+s2)/2 + gap between the rings. dev/touch_layout_test.mjs checks exactly that, and
  // the first pass at these numbers failed it with the circles overlapping by 13px.
  const PIV = { r: 0.28, b: 0.35 };
  const ARC = [
    // ring 1 - the three you press without thinking, closest to the thumb
    { q: '.tb[data-k=attack]',  a: 12, r: 2.20, s: 1.14 },
    { q: '.tb[data-k=shield]',  a: 45, r: 2.20, s: 0.98 },
    { q: '.tb[data-k=jump]',    a: 78, r: 2.20, s: 0.98 },
    // ring 2 - the modifiers, a thumb-stretch away
    { q: '.tb[data-k=special]', a: 8,  r: 3.36, s: 0.90 },
    { q: '.tb[data-k=smash]',   a: 30, r: 3.36, s: 0.90 },
    { q: '.tb.tkGrab',          a: 52, r: 3.36, s: 0.90 },
    { q: '.tb.gbtn',            a: 74, r: 3.36, s: 0.90 },
  ];

  let u = 60, travel = 56, homeX = 0, homeY = 0, ringR = 70;
  function place() {
    const W = innerWidth, H = innerHeight;
    // Scale off the SHORT side so a 390px-tall landscape phone stays reachable. The floor of 49 is
    // what keeps the smallest button (0.90u) at 44px, Apple's minimum target.
    u = Math.round(Math.max(49, Math.min(68, Math.min(W * 0.082, H * 0.128))));
    // how far left and how high the arc reaches, so the stick zone and the DROP chip can dodge it
    let far = 0, high = 0;
    for (const b of ARC) {
      const el = btns.querySelector(b.q); if (!el) continue;
      const sz = Math.round(b.s * u), rad = b.a * Math.PI / 180;
      const cr = PIV.r + b.r * Math.cos(rad), cb = PIV.b + b.r * Math.sin(rad);
      el.style.width = el.style.height = sz + 'px';
      el.style.right = Math.round((cr - b.s / 2) * u) + 'px';
      el.style.bottom = Math.round((cb - b.s / 2) * u) + 'px';
      el.style.fontSize = Math.max(10, Math.round(sz * 0.255)) + 'px';
      el.style.left = el.style.top = 'auto';
      far = Math.max(far, (cr + b.s / 2) * u); high = Math.max(high, (cb + b.s / 2) * u);
    }
    // the movement zone: the lower-left, stopping short of the arc and below the HUD
    const hudTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-top')) || 90;
    const zw = Math.max(140, Math.min(W * 0.48, W - far - 30));
    // the one-tap DROP chip (88_touch2.js) parks in the gap between the stick and the arc -- unless the
    // screen is too narrow for a gap (a phone held upright), in which case it goes above the arc
    const drop = document.getElementById('tbDrop');
    if (drop) {
      const dw = Math.round(u * 1.7), dh = Math.round(u * 0.9), gap = W - zw - far - 24;
      drop.style.width = dw + 'px'; drop.style.height = dh + 'px';
      drop.style.borderRadius = Math.round(dh / 2) + 'px'; drop.style.fontSize = Math.round(u * 0.28) + 'px';
      drop.style.top = 'auto'; drop.style.zIndex = 4;
      const fits = gap >= dw;
      drop.style.right = `calc(max(10px, env(safe-area-inset-right)) + ${Math.round(fits ? far + 14 : 8)}px)`;
      drop.style.bottom = `calc(max(10px, env(safe-area-inset-bottom)) + ${Math.round(fits ? 4 : high + 10)}px)`;
    }
    zone.style.width = zw + 'px';
    zone.style.height = Math.max(120, Math.min(H * 0.72, H - hudTop - 8)) + 'px';
    ringR = Math.round(u * 1.18); travel = Math.round(u * 0.95);
    ring.style.width = ring.style.height = ringR * 2 + 'px';
    knob.style.width = knob.style.height = Math.round(u * 0.62) + 'px';
    homeX = Math.round(Math.min(zw * 0.5, ringR + u * 0.55));
    homeY = Math.round(H - ringR - u * 0.5);
    if (sid === null) rest();
  }

  let sid = null, cx = 0, cy = 0;
  function put() { ring.style.left = cx + 'px'; ring.style.top = cy + 'px'; }
  function rest() { cx = homeX; cy = homeY; put(); knob.style.transform = 'translate(-50%,-50%)'; ring.classList.remove('live'); }
  function move(x, y) {
    let dx = x - cx, dy = y - cy; const m = Math.hypot(dx, dy);
    if (m > travel) { dx *= travel / m; dy *= travel / m; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    Touch.stickX = dx / travel; Touch.stickY = dy / travel;
  }
  zone.addEventListener('pointerdown', e => {
    if (sid !== null) return;
    e.preventDefault();
    sid = e.pointerId; try { zone.setPointerCapture(sid); } catch (err) { /* older browsers */ }
    // The ring re-centres on the thumb. It may clip at the screen edge (every game does this): what
    // must NOT happen is the CENTRE moving away from your thumb, because then a press with no drag
    // would already read as a direction. So it is clamped by half the travel, not by the ring radius.
    const r = zone.getBoundingClientRect(), m = travel * 0.5;
    cx = Math.max(r.left + m, Math.min(r.right - m, e.clientX));
    cy = Math.max(r.top + m, Math.min(innerHeight - m, e.clientY));
    put(); ring.classList.add('live'); move(e.clientX, e.clientY);
    try { Sfx.unlock(); } catch (err) { /* sound is optional */ }
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === sid) { e.preventDefault(); move(e.clientX, e.clientY); } });
  const end = e => {
    if (e.pointerId !== sid) return;
    sid = null; Touch.stickX = Touch.stickY = 0; rest();
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);

  place(); rest();
  addEventListener('resize', place);
  addEventListener('orientationchange', () => setTimeout(place, 120));
  // The HUD publishes --hud-top after the first match frame, its inset changes between 1v1 and 4P,
  // and 24_grapple / 88_touch2 show and hide their buttons with the ruleset. Re-place only when one
  // of those actually moves.
  let sig = '';
  setInterval(() => {
    const s = innerWidth + 'x' + innerHeight + ':' + (getComputedStyle(document.documentElement).getPropertyValue('--hud-top') || '')
      + ':' + btns.querySelectorAll('.tb').length;
    if (s !== sig) { sig = s; place(); }
  }, 600);
  window.TB_TOUCHPAD = { place, get unit() { return u; } };
})();
