// ===== Graphics options: Auto / High / Medium / Low =====
// Page only. Writes nothing but a localStorage key and V3.QUAL; never touches fight state, never
// touches the seeded RNG. The tiers themselves live in 90_v3_core.mjs (DETAIL / V3.setDetail).
// Reachable from the title screen, from the V key, and from the pause overlay.
(function () {
  if (typeof document === 'undefined') return;

  const css = `
  #gfxCard{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:12;display:none;
    width:min(340px,92vw);padding:16px 16px 14px;background:rgba(8,9,14,.94);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 24px 60px rgba(0,0,0,.6);
    clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));
    font-family:"Space Grotesk",system-ui,sans-serif;color:#e9ecf4}
  #gfxCard.on{display:block}
  #gfxCard h4{margin:0 0 2px;font-family:"Barlow Condensed",Impact,sans-serif;font-style:italic;font-weight:900;
    font-size:22px;letter-spacing:.02em;color:#f4f5f8;display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  #gfxCard h4 b{font-family:"JetBrains Mono",monospace;font-style:normal;font-size:9px;font-weight:700;letter-spacing:.1em;color:#9398a8}
  #gfxCard p{margin:0 0 12px;font-size:11.5px;line-height:1.45;color:#a7adbd}
  #gfxSeg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
  #gfxSeg button{appearance:none;border:0;cursor:pointer;padding:9px 0;color:#c6cad6;background:rgba(255,255,255,.06);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.06em;
    clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px));transition:background .12s,color .12s}
  #gfxSeg button:hover{background:rgba(255,255,255,.13);color:#fff}
  #gfxSeg button.sel{background:#ff2a4a;color:#fff;box-shadow:none}
  #gfxNow{font-family:"JetBrains Mono",monospace;font-size:10px;line-height:1.7;color:#8e94a6;
    border-top:1px solid rgba(255,255,255,.1);padding-top:9px;display:grid;grid-template-columns:auto 1fr;gap:1px 12px}
  #gfxNow i{font-style:normal;color:#c6cad6}
  #gfxClose{margin-top:11px;width:100%;appearance:none;border:0;cursor:pointer;padding:9px 0;background:rgba(255,255,255,.08);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);color:#f4f5f8;font-family:"JetBrains Mono",monospace;font-weight:700;font-size:11px;letter-spacing:.08em;
    clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px))}
  #gfxClose:hover{background:rgba(255,42,74,.8)}
  #gfxPause{position:fixed;left:50%;top:calc(60% + 42px);transform:translateX(-50%);z-index:6;display:none}
  #gfxPause.on{display:block}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const MODES = [
    ['auto', 'AUTO', 'holds 60 fps by itself: resolution first, then detail'],
    ['high', 'HIGH', 'full shadows, full bloom, every decorative layer'],
    ['medium', 'MED', 'half-size shadow maps, half-resolution bloom, lighter particles'],
    ['low', 'LOW', 'small shadows, no bloom, decoration off, resolution capped'],
  ];

  const card = document.createElement('div'); card.id = 'gfxCard';
  card.innerHTML = `<h4>Graphics <b>DETAIL</b></h4><p id="gfxHint"></p><div id="gfxSeg"></div>
    <div id="gfxNow"></div><button id="gfxClose" type="button">CLOSE</button>`;
  document.body.appendChild(card);
  const seg = card.querySelector('#gfxSeg'), hint = card.querySelector('#gfxHint'), nowEl = card.querySelector('#gfxNow');
  const btns = MODES.map(([id, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = id; b.textContent = label;
    b.onclick = () => pick(id); seg.appendChild(b); return b;
  });

  const mode = () => { try { return (window.V3 && V3.QUAL && V3.QUAL.mode) || localStorage.getItem('tb_detail') || 'auto'; } catch (e) { return 'auto'; } };
  function pick(m) {
    if (window.V3 && V3.setDetailMode) V3.setDetailMode(m);
    else { try { localStorage.setItem('tb_detail', m); } catch (e) {} }
    paint();
  }
  function paint() {
    const m = mode();
    for (const b of btns) b.classList.toggle('sel', b.dataset.mode === m);
    hint.textContent = (MODES.find(x => x[0] === m) || MODES[0])[2];
    let rows = '<span>3D</span><i>off (2D fallback)</i>';
    try {
      if (window.V3 && V3.ready) {
        const I = V3.internals(), r = I.renderer, sz = r.getDrawingBufferSize(new V3.THREE.Vector2());
        rows = `<span>fps</span><i>${V3.fps || '-'}</i>`
          + `<span>tier</span><i>${V3.QUAL.tier}${m === 'auto' ? ' (auto)' : ' (locked)'}</i>`
          + `<span>buffer</span><i>${sz.x}x${sz.y} &middot; ratio ${r.getPixelRatio()}</i>`
          + `<span>shadows</span><i>${V3.QUAL.shadow}px${V3.QUAL.soft ? ' soft' : ''}</i>`
          + `<span>bloom</span><i>${I.bloom && I.bloom.enabled ? Math.round(V3.QUAL.bloomScale * 100) + '%' : 'off'}</i>`;
      }
    } catch (e) { /* the readout is cosmetic */ }
    nowEl.innerHTML = rows;
  }

  let open = false, timer = 0;
  function show() { open = true; card.classList.add('on'); paint(); clearInterval(timer); timer = setInterval(paint, 500); }
  function hide() { open = false; card.classList.remove('on'); clearInterval(timer); timer = 0; }
  function toggle() { open ? hide() : show(); }
  card.querySelector('#gfxClose').onclick = hide;
  card.addEventListener('pointerdown', e => e.stopPropagation(), true);
  card.addEventListener('pointerup', e => e.stopPropagation(), true);
  // No hotkey. It used to be V, with nothing checking whether a fight was on, and V sits between C
  // (Clip It) and B right beside the attack keys — so the panel kept opening mid-match. Duane, 9/22:
  // "the graphics menu kept popping up for no reason and disrupting the game". It is still one click
  // away: the Graphics button on the title screen and in the pause menu. Escape still closes it.
  addEventListener('keydown', e => { if (open && e.code === 'Escape') hide(); });

  // title screen: a button next to Controls
  function mount() {
    const row = document.querySelector('#scTitle .row:last-of-type') || (document.getElementById('bHelp') || {}).parentNode;
    if (row && !document.getElementById('bGfx')) {
      const b = document.createElement('button'); b.id = 'bGfx'; b.type = 'button'; b.className = 'btn'; b.textContent = 'Graphics';
      b.onclick = show; row.appendChild(b);
    }
    // pause overlay: under "Quit match", same place, same look
    if (!document.getElementById('gfxPause')) {
      const p = document.createElement('button'); p.id = 'gfxPause'; p.type = 'button'; p.className = 'btn small'; p.textContent = 'Graphics';
      p.onclick = show; document.body.appendChild(p);
      // same cadence and the same place as UI.quitBtn (80_ui.js), so the two sit together
      setInterval(() => {
        let paused = false; try { paused = !!(typeof Game !== 'undefined' && Game.paused); } catch (e) {}
        p.classList.toggle('on', paused);
      }, 400);
    }
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();

  window.TB_GFX = { show, hide, toggle, paint, get open() { return open; } };
})();
