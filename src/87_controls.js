// ===== on-screen control card: what every button does, without leaving the match =====
// Shows itself for the first few seconds of a match, and on demand from the "?" button or the H key.
// Visual only: never touches fight state or the seeded RNG.
(function () {
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const IS_TOUCH_UI = () => { try { return typeof Touch !== 'undefined' && Touch.visible; } catch (e) { return false; } };

  const css = `
  #ctrlCard{position:fixed;left:max(14px,env(safe-area-inset-left));bottom:calc(max(14px,env(safe-area-inset-bottom)) + 30px);z-index:6;
    display:none;gap:10px;padding:10px 12px;max-width:min(390px,54vw);max-height:56vh;overflow:auto;background:rgba(8,9,14,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));
    font-family:"Space Grotesk",system-ui,sans-serif;animation:ctrlIn .25s ease-out both}
  #ctrlCard.on{display:block}
  @keyframes ctrlIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  #ctrlCard h4{margin:0 0 8px;font-family:"Barlow Condensed",Impact,sans-serif;font-style:italic;font-weight:900;font-size:18px;letter-spacing:.02em;
    color:#f4f5f8;display:flex;justify-content:space-between;align-items:center;gap:10px}
  #ctrlCard h4 span{font-family:"JetBrains Mono",monospace;font-style:normal;font-size:9px;font-weight:700;letter-spacing:.1em;color:#9398a8}
  #ctrlCard dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:12px;align-items:center}
  #ctrlCard dt{display:flex;gap:3px}
  #ctrlCard dd{margin:0;color:#c6cad6}
  #ctrlCard kbd{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:#fff;background:rgba(255,255,255,.1);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);padding:2px 5px;min-width:16px;text-align:center;display:inline-block}
  #ctrlCard kbd.hot{background:#ff2a4a;box-shadow:none}
  #ctrlBtn{position:fixed;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));z-index:7;
    width:auto;padding:0 10px;height:26px;border:0;cursor:pointer;background:rgba(5,5,7,.6);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);color:#f4f5f8;
    font-family:"JetBrains Mono",monospace;font-weight:700;font-size:13px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px));display:none}
  #ctrlBtn.on{display:block}
  #ctrlBtn.open{background:rgba(255,42,74,.85)}
  #ctrlBtn:hover{background:rgba(255,42,74,.75)}
  @media (max-width:760px){#ctrlCard{max-width:min(320px,74vw);font-size:11px}#ctrlCard dl{font-size:11px}}
  /* Touch: the bottom-left corner belongs to the stick, so the tab becomes a "?" in the utility row
     under the clock (--util-y is published by the HUD, 71_hud.js) and the card opens full width. */
  #ctrlBtn.mini{left:calc(50% + 46px);bottom:auto;top:var(--util-y,96px);width:30px;padding:0;height:28px;font-size:15px}
  #ctrlCard.mini{left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));
    bottom:auto;top:calc(var(--util-y,96px) + 34px);max-width:none;max-height:52vh}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // one place for every in-match input, so the card, the pause screen and the help screen agree
  const KEYS = [
    [['A', 'D'], 'Move', ['◀ ▶', 'Stick']],
    [['S'], 'Duck — hold. Beats every throw. Tap on a platform to drop through', ['▼', 'Stick down']],
    [['W'], 'Jump — tap is a hop, hold is high. Two air jumps', ['▲', 'JUMP']],
    [['F'], 'Attack — add a direction for tilts and aerials', ['K', 'HIT']],
    [['S', 'F'], 'In the air: down kick. Down-forward / back: diagonal kick', ['▼ K', '▼ HIT']],
    [['T'], 'Smash — hold to charge (it moved off R)', ['I', 'SMASH']],
    [['G'], 'Special — add up, down or side', ['L', 'SPEC']],
    [['H'], 'Shield. On the hit: PARRY. On landing: clean. Tumbling: TECH', [';', 'GUARD']],
    [['E'], 'GRAB — the plain throw. Then a direction picks the throw', ['O', 'GRAB']],
    [['R'], 'THROW — your fighter’s own command throw', ['P', 'THROW']],
    [['E', 'R'], 'Both together: the command throw as well', ['O + P', 'GRAB + THROW']],
    [['R'], 'BACK THROW — get behind them and R is their ultra. No escape', ['P', 'THROW']],
    [['E', 'R'], 'Caught? Tap the button shown over your head to break out (20 frames)', ['O / P', 'GRAB / THROW']],
    [['Q'], 'Drop the item you are holding — one button', ['U', 'DROP']],
    [['H', 'F'], 'Throw the item you are holding (E throws it too)', ['; K', 'GUARD + HIT']],
    [['S', 'F'], 'Holding a gun: Down aims the shot down, Down + a direction is a diagonal', ['▼ K', '▼ HIT']],
    [['H', 'W'], 'Taunt', ['; ▲', 'GUARD + ▲']],
    [['H', 'G'], 'BURST out of a combo (half pump) · PUMP MODE (full)', ['; L', 'GUARD + SPEC']],
    [['C'], 'Clip the last 10 seconds', ['—', '—']],
  ];

  const card = document.createElement('div'); card.id = 'ctrlCard';
  const btn = document.createElement('button'); btn.id = 'ctrlBtn'; btn.type = 'button'; btn.textContent = 'Controls ▾'; btn.title = 'Controls (/)';
  function paint() {
    const p2 = IS_TOUCH_UI() ? 1 : 0;
    const rows = KEYS.map(([keys, what, alt]) => {
      const k = IS_TOUCH_UI() ? [alt[1]] : keys;
      return `<dt>${k.map((x, i) => `<kbd class="${i === 0 && keys.length > 1 ? 'hot' : ''}">${x}</kbd>`).join('')}</dt><dd>${what}</dd>`;
    }).join('');
    card.innerHTML = `<h4>Controls <span>${IS_TOUCH_UI() ? 'TOUCH' : 'PLAYER 1 · P2 USES THE ARROWS, U I O P, K L ;'}</span></h4><dl>${rows}</dl>`;
    void p2;
  }
  document.body.appendChild(card); document.body.appendChild(btn);

  // ---- open/closed state ----
  // 9/20, Duane: "i click controls off and it doesn't go away". Two bugs caused it:
  //   1. the open/closed state lived in a CSS class on one element and the button's label in another,
  //      so anything that touched one of them left the pair out of step;
  //   2. the 400ms watchdog re-opened the card whenever the game was paused -- so closing it while
  //      paused made it pop straight back a moment later.
  // Now there is ONE boolean, `open`. Everything else is painted from it, and a click, tap or key
  // press anywhere on the screen closes it.
  let open = false, hideAt = 0, autoShown = false;
  const inMatch = () => { try { return Game.state === 'match' && !Game.demo && document.querySelectorAll('.screen:not([hidden])').length === 0; } catch (e) { return false; } };
  function apply() {
    const mini = IS_TOUCH_UI();
    card.classList.toggle('mini', mini); btn.classList.toggle('mini', mini);
    card.classList.toggle('on', open);
    btn.classList.toggle('open', open);
    btn.textContent = mini ? '?' : open ? 'Controls ▴' : 'Controls ▾';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function show(secs) { paint(); open = true; hideAt = secs ? performance.now() + secs * 1000 : 0; apply(); }
  function hide() { open = false; hideAt = 0; apply(); }
  function toggle() { if (open) hide(); else show(0); }
  btn.addEventListener('pointerdown', e => e.stopPropagation());
  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  // "make it so if i click anywhere on the screen controls go away": a tap anywhere dismisses it.
  // Closing on pointerUP (and only when the finger barely moved) so you can still scroll the list.
  let dx = 0, dy = 0;
  addEventListener('pointerdown', e => { dx = e.clientX; dy = e.clientY; }, true);
  addEventListener('pointerup', e => {
    if (!open) return;
    if (btn.contains(e.target)) return;                                   // the button toggles itself
    if (Math.hypot(e.clientX - dx, e.clientY - dy) > 12) return;          // that was a scroll, not a tap
    hide();
  }, true);
  addEventListener('pointercancel', () => { if (open) hide(); }, true);
  addEventListener('keydown', e => {
    if (e.code === 'Slash') { if (inMatch()) { toggle(); e.preventDefault(); } return; }
    if (open) hide();                                                     // any other key dismisses it
  });
  addEventListener('blur', () => { if (open) hide(); });

  // the button only exists during a match; the card never opens on its own except once per pause
  let wasIn = false;
  setInterval(() => {
    const now = inMatch();
    btn.classList.toggle('on', now);
    apply();                                   // keeps the touch/desktop placement in step
    if (!now && (wasIn || open)) hide();
    wasIn = now;
    if (hideAt && performance.now() > hideAt) hide();
    // Pause is just pause. It used to pop the move list open, which he asked to stop: the card only
    // ever opens when you ask for it, from the tab or the / key.
    autoShown = false;
  }, 400);
  apply();

  window.TB_CONTROLS = { show, hide, toggle, KEYS, get open() { return open; } };
})();
