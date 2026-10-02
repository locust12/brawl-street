// ===== page only: the touch GRAB button, the one-tap DROP button, and the "you are holding
// something" hint =====
// 24_grapple.js already adds THROW (the `grapple` action, i.e. the R key). This adds its neighbour
// GRAB (the `grab` action, E) and a DROP chip that only appears while the touch player is carrying
// something. Pure page code: it writes Touch.held / Touch.tap, which 10_core.readInput reads, and
// never touches fight state or the seeded Rng.
(function () {
  if (typeof document === 'undefined' || typeof Touch === 'undefined') return;
  const box = document.getElementById('tbtns');
  const pad = document.getElementById('touch');
  if (!box || !pad) return;

  const css = document.createElement('style');
  css.textContent = `
  #tbtns{width:268px}
  #tbtns .tb.tkGrab{right:212px;bottom:108px;width:54px;height:54px;font-size:13px;border-color:#7ff0ff;color:#7ff0ff}
  #tbDrop{position:absolute;left:max(20px,env(safe-area-inset-left));bottom:calc(max(20px,env(safe-area-inset-bottom)) + 160px);
    width:96px;height:44px;border-radius:22px;border:1px solid #ffd45c;background:rgba(10,11,16,.6);color:#ffd45c;
    font-family:var(--display,"Barlow Condensed",Impact,sans-serif);font-style:italic;font-weight:900;font-size:15px;letter-spacing:.04em;
    pointer-events:auto;touch-action:none;display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  #tbDrop.on{background:rgba(255,212,92,.35)}
  #tbDrop.show{display:flex}
  /* the same hint for keyboard and pad players: a small chip over the bottom of the screen */
  #dropHint{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(max(14px,env(safe-area-inset-bottom)) + 8px);z-index:6;
    display:none;gap:7px;align-items:center;padding:5px 11px;background:rgba(8,9,14,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px));
    font-family:"Space Grotesk",system-ui,sans-serif;font-size:12px;color:#c6cad6;pointer-events:none}
  #dropHint.on{display:flex}
  #dropHint kbd{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:#0a0a0c;background:#ffd45c;padding:2px 6px;display:inline-block}
  #dropHint b{color:#f4f5f8;font-weight:700}
  `;
  document.head.appendChild(css);

  // --- a .tb-style button that presses one action ---
  function mkBtn(el, action) {
    const on = e => {
      e.preventDefault(); e.stopImmediatePropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      Touch.tap = Touch.tap || {};
      Touch.held[action] = true; Touch.tap[action] = true;
      el.classList.add('on'); try { Sfx.unlock(); } catch (err) { /* sound is optional */ }
    };
    const off = e => {
      e.stopImmediatePropagation();
      if (!el.classList.contains('on')) return;
      el.classList.remove('on'); Touch.held[action] = false;
    };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  }

  const grab = document.createElement('button');
  grab.type = 'button'; grab.className = 'tb tkGrab'; grab.textContent = 'GRAB';
  grab.setAttribute('aria-label', 'Grab: the generic throw, then a direction throws them');
  mkBtn(grab, 'grab'); box.appendChild(grab);

  const drop = document.createElement('button');
  drop.type = 'button'; drop.id = 'tbDrop'; drop.textContent = 'DROP';
  drop.setAttribute('aria-label', 'Drop the item you are holding');
  mkBtn(drop, 'drop'); pad.appendChild(drop);

  const hint = document.createElement('div');
  hint.id = 'dropHint';
  document.body.appendChild(hint);

  // --- which fighter is the local player, and are they carrying anything? ---
  const KEYNAME = { kb1: 'Q', kb2: 'U', touch: 'DROP', pad0: 'L3', pad1: 'L3', pad2: 'L3', pad3: 'L3' };
  function mine() {
    let G; try { G = Game; } catch (e) { return null; }
    if (!G || G.state !== 'match' || G.demo || !G.fighters) return null;
    if (!G.combos) return null;                                  // seeded fights have no drop button
    for (const f of G.fighters) if (f.ctrl && f.ctrl !== 'cpu' && !String(f.ctrl).startsWith('net')) return f;
    for (const f of G.fighters) if (f.ctrl && f.ctrl !== 'cpu') return f;
    return null;
  }
  let lastKey = '', lastItem = '';
  setInterval(() => {
    let touchOn = false; try { touchOn = !!Touch.visible; } catch (e) {}
    const f = mine();
    const held = f && f.item && typeof ITEM_DEFS !== 'undefined' && ITEM_DEFS[f.item.kind] ? ITEM_DEFS[f.item.kind] : null;
    drop.classList.toggle('show', !!(touchOn && held));
    let show = !!held && !touchOn;
    if (show) {
      const key = KEYNAME[f.ctrl] || 'DROP', name = held.name;
      if (key !== lastKey || name !== lastItem) {
        lastKey = key; lastItem = name;
        hint.innerHTML = `<span>${held.icon} <b>${name}</b></span><kbd>${key}</kbd><span>drop</span>`;
      }
    }
    hint.classList.toggle('on', show);
  }, 220);
})();
