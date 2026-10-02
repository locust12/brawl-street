// ===== pause menu (9/22 night, audit #19) =====
// Pause used to be two loose buttons floating mid-screen (Quit match, Graphics) over a dimmed frame: no resume,
// no restart, no way to see a fighter's moves or the controls. This is a real pause screen: Resume, Restart,
// Moves (the paused player's specials, named from their own move data by 8d_movehint), Controls (their key
// map), Graphics and Quit. Page only: it reads fight state and calls UI; the fight code never sees it.
// Restart is local only — never in online, the bet arena or a demo.
(function () {
  const css = `
  #pzMenu{position:fixed;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;background:rgba(5,5,7,.55);backdrop-filter:blur(3px)}
  #pzMenu[hidden]{display:none}
  #pzMenu .pz{width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:20px 22px;background:rgba(10,11,17,.94);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 20px 60px rgba(0,0,0,.6);clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))}
  #pzMenu h2{margin:0 0 2px;font-family:var(--display);font-style:italic;font-weight:900;font-size:40px;line-height:1}
  #pzMenu .sub{font-family:var(--mono);font-size:11px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:14px}
  #pzMenu .it{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;margin:0 0 6px;padding:6px 14px;border:0;cursor:pointer;text-align:left;color:var(--text);
    background:rgba(255,255,255,.05);font-family:var(--display);font-style:italic;font-weight:900;font-size:22px;box-shadow:inset 3px 0 0 var(--c,var(--red))}
  #pzMenu .it:hover,#pzMenu .it:focus-visible{background:var(--c,var(--red));outline:none}
  #pzMenu .it i{font-family:var(--mono);font-style:normal;font-weight:700;font-size:11px;color:var(--c,var(--red));min-width:22px}
  #pzMenu .it:hover i,#pzMenu .it:focus-visible i{color:#fff}
  #pzMenu .it.hot{--c:var(--red);background:var(--red)} #pzMenu .it.hot i{color:#fff}
  #pzMenu .list{margin:4px 0 12px;font-size:14px}
  #pzMenu .list div{display:flex;justify-content:space-between;gap:10px;padding:6px 2px;border-bottom:1px solid rgba(255,255,255,.07)}
  #pzMenu .list b{font-family:var(--mono);font-size:12px;color:var(--cyan);white-space:nowrap}
  /* a phone held sideways: all six options on one screen (was a scroll, Quit match half cut off) */
  @media (max-height:640px){#pzMenu .pz{padding:12px 18px} #pzMenu h2{font-size:28px} #pzMenu .sub{margin-bottom:8px}
    #pzMenu .it{min-height:34px;margin-bottom:4px;font-size:18px} #pzMenu .list div{padding:4px 2px} #pzMenu .list{font-size:13px;margin:2px 0 8px}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'pzMenu'; el.hidden = true;
  el.innerHTML = '<div class="pz" role="dialog" aria-label="Paused"></div>';
  document.body.appendChild(el);
  const box = el.firstChild;
  let view = 'main';

  const local = () => !Game.arena && !Game.demo && !(typeof Net !== 'undefined' && Net.active);
  const me = () => (Game.fighters || []).find(f => !f.cpu && f.ctrl !== 'net') || (Game.fighters || [])[0];
  const keyName = c => (c || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace('Space', 'Space').replace('Semicolon', ';');
  const keys = f => { const K = (typeof KEYMAPS !== 'undefined' && KEYMAPS[f && f.ctrl]) || null; return a => (K && K[a] ? K[a].map(keyName).join(' / ') : a); };

  function resume() { if (Game.paused) Game.togglePause(); }
  function item(n, label, fn, cls) {
    const b = document.createElement('button'); b.className = 'it' + (cls ? ' ' + cls : ''); b.type = 'button';
    b.innerHTML = `<i>${n}</i>${label}`; b.onclick = () => { try { Sfx.ui(); } catch (e) {} fn(); }; return b;
  }
  function paint() {
    const f = me(); box.innerHTML = '';
    const h = document.createElement('h2'); h.textContent = view === 'moves' ? 'Moves' : view === 'keys' ? 'Controls' : 'Paused';
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = f ? (f.c.name + (Game.stage && Game.stage.name ? ' · ' + Game.stage.name : '')) : '';
    box.append(h, sub);
    if (view === 'moves' && f) {
      const L = document.createElement('div'); L.className = 'list'; const k = keys(f);
      const m = f.m || {}, nm = (d, s) => (window.MoveHint && MoveHint.nameOf ? MoveHint.nameOf(d, s) : s);
      const rows = [['Special', k('special'), nm(m.nb, 'nb')], ['Side + Special', '◀▶ ' + k('special'), nm(m.sb, 'sb')],
        ['Up + Special', '▲ ' + k('special'), nm(m.ub, 'ub')], ['Down + Special', '▼ ' + k('special'), nm(m.db, 'db')],
        ['hold to charge', k('smash') + ' or tap + ' + k('attack'), 'Smash attack'], ['then a direction to throw', k('shield') + ' + ' + k('attack'), 'Grab']];
      for (const [what, how, name] of rows) { const r = document.createElement('div'); r.innerHTML = `<span>${name} <small style="color:var(--muted)">${what}</small></span><b>${how}</b>`; L.appendChild(r); }
      box.append(L, item('◀', 'Back', () => { view = 'main'; paint(); }));
      return;
    }
    if (view === 'keys' && f) {
      const L = document.createElement('div'); L.className = 'list'; const k = keys(f);
      for (const [what, a] of [['Move', null], ['Jump', 'jump'], ['Attack', 'attack'], ['Special', 'special'], ['Shield / dodge', 'shield'], ['Smash', 'smash'], ['Grab', 'grab'], ['Drop item', 'drop']]) {
        const r = document.createElement('div'); r.innerHTML = `<span>${what}</span><b>${a ? k(a) : [k('left'), k('right'), k('up'), k('down')].join(' ')}</b>`; L.appendChild(r);
      }
      box.append(L, item('◀', 'Back', () => { view = 'main'; paint(); }));
      return;
    }
    const items = [item('01', 'Resume', resume, 'hot')];
    if (local()) items.push(item('02', 'Restart', () => { resume(); UI.fight(); }));
    items.push(item(String(items.length + 1).padStart(2, '0'), 'Moves', () => { view = 'moves'; paint(); }));
    items.push(item(String(items.length + 1).padStart(2, '0'), 'Controls', () => { view = 'keys'; paint(); }));
    const gfx = document.getElementById('gfxPause');
    // Graphics opens its own card; step the menu aside while it is up and come back when it closes
    if (gfx) items.push(item(String(items.length + 1).padStart(2, '0'), 'Graphics', () => {
      el.hidden = true; gfx.click();
      const card = document.getElementById('gfxCard');
      const back = setInterval(() => { if (!Game.paused || !card || !card.classList.contains('on')) { clearInterval(back); if (Game.paused && Game.state === 'match') { el.hidden = false; paint(); } } }, 200);
    }));
    items.push(item(String(items.length + 1).padStart(2, '0'), 'Quit match', () => UI.quit()));
    box.append(...items);
    setTimeout(() => { try { items[0].focus(); } catch (e) {} }, 0);
  }
  const on0 = UI.onPause;
  UI.onPause = function (p) {
    const r = on0.call(this, p);
    const show = !!p && Game.state === 'match';
    if (show) { view = 'main'; paint(); }
    el.hidden = !show;
    // the old loose buttons stay in the DOM (Graphics' own panel is opened through its button) but not on screen
    if (this.quitBtn) this.quitBtn.hidden = true;
    const g = document.getElementById('gfxPause'); if (g) g.style.visibility = show ? 'hidden' : '';
    return r;
  };
  // a click on the dimmed backdrop resumes, like every console pause screen
  el.addEventListener('click', e => { if (e.target === el) resume(); });
})();
