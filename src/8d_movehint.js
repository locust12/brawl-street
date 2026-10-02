// ===== fighter select: each fighter's four specials, with the input for each =====
// Duane, 9/22: "i didnt see any car with top g". The car was there the whole time: it is TOP G's side
// special (hold a direction + Special). Nothing in the game said so, so a player pressing Special on its
// own got the charged punch and never found it. This strip sits under the roster and shows, for the
// fighter you are pointing at, what Special does on its own and in each direction, before you pick them.
//
// Page-only: not in build.py's SIM_FILES, reads the fighter data and never writes it.
//
// Names come from the move data, never from a list in here, so this stays right for every fighter and
// across the roster swap (2f_origins remaps the shouts in place, and we read them after it has run):
//   the move's own call-out (shout, then sigText) -> its effect name (fx) -> what the move does (a slam,
//   a recovery, a dash, a projectile) -> the plain slot name.
(function () {
  if (typeof UI === 'undefined' || !UI.renderSelect) return;
  const $m = id => document.getElementById(id);

  const SLOTS = [['nb', ''], ['sb', '◀▶'], ['ub', '▲'], ['db', '▼']];
  const FALLBACK = { nb: 'Special', sb: 'Side special', ub: 'Recovery', db: 'Down special' };
  // effect ids that read badly as a name
  const FX_NAME = { bugatti: 'Supercar', iaido: 'Quick draw', stone: 'Stone', breath: 'Fire breath', thunder: 'Thunder' };

  const title = s => String(s).toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const tickSrc = d => { try { return d && typeof d.tick === 'function' ? String(d.tick) : ''; } catch (e) { return ''; } };

  function nameOf(d, slot) {
    if (!d) return FALLBACK[slot];
    // a slam is {ground, air}: its call-out lives on the halves
    const parts = [d, d.ground, d.air].filter(Boolean);
    for (const k of ['shout', 'sigText']) for (const p of parts) if (typeof p[k] === 'string' && p[k].trim()) return title(p[k]);
    for (const p of parts) if (typeof p.fx === 'string' && p.fx) return FX_NAME[p.fx] || title(p.fx.replace(/[_-]+/g, ' '));
    if (d.ground && d.air) return 'Slam';
    if (d.helpless || d.airOnce === 'up') return 'Recovery';
    const src = tickSrc(d);
    if (/spawnProj|projs\.push/.test(src)) return 'Projectile';
    if (d.airOnce === 'side' && /vx\s*=\s*f\.face/.test(src)) return 'Dash';
    if (/counter|parry/i.test(src)) return 'Counter';
    return FALLBACK[slot];
  }

  // the Special key for whoever is picking right now
  function specialKey() {
    const s = (UI.slots || [])[UI.active || 0];
    const ctrl = s && s.ctrl !== 'cpu' ? s.ctrl : 'kb1';
    try {
      if (typeof KEYMAPS !== 'undefined' && KEYMAPS[ctrl] && KEYMAPS[ctrl].special) return KEYMAPS[ctrl].special[0].replace(/^Key/, '').replace(/^Numpad/, 'Num ');
    } catch (e) { /* not a keyboard */ }
    if (/^pad/.test(ctrl)) return 'B';
    if (ctrl === 'touch') return 'SP';
    return 'G';
  }

  // ---- styles ----
  const css = document.createElement('style');
  css.textContent = `
  #mvHint{display:grid;grid-template-columns:auto repeat(4,minmax(0,1fr));align-items:stretch;gap:6px;padding:8px;margin-top:4px;
    background:linear-gradient(180deg,rgba(10,11,17,.82),rgba(5,5,7,.72));box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
    clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))}
  #mvHint[hidden]{display:none}
  #mvHint .mvh-who{display:flex;flex-direction:column;justify-content:center;padding:0 8px 0 4px;min-width:0;max-width:130px}
  #mvHint .mvh-who small{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--red);text-transform:uppercase}
  #mvHint .mvh-who b{font-family:var(--display);font-style:italic;font-weight:900;font-size:17px;line-height:1;color:#fff;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #mvHint .mvh-m{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 9px;background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
  #mvHint .mvh-m.hot{background:rgba(255,42,74,.12);box-shadow:inset 0 0 0 1px rgba(255,42,74,.45)}
  #mvHint .mvh-k{flex:none;display:inline-flex;align-items:center;gap:3px;font-family:var(--mono);font-size:11px;font-weight:700;color:#050507;
    background:#f4f5f8;padding:3px 6px;border-radius:2px;line-height:1;white-space:nowrap}
  #mvHint .mvh-k i{font-style:normal;font-size:9px;letter-spacing:-.05em}
  /* same face and case as the roster tile names, so the game's own shout spelling ("EMP", "YES.") reads right */
  #mvHint .mvh-n{min-width:0;font-family:var(--display);font-style:italic;font-weight:800;font-size:14px;letter-spacing:.02em;line-height:1;
    text-transform:uppercase;color:#e8e9ee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media (max-width:760px){
    /* margin-bottom: it is the last thing on the screen, and the fixed sound button sits bottom-right */
    #mvHint{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;padding:7px;margin-bottom:48px}
    #mvHint .mvh-who{grid-column:1 / -1;flex-direction:row;align-items:baseline;gap:8px;max-width:none;padding:0 2px 2px}
    #mvHint .mvh-n{font-size:13px}
  }`;
  document.head.appendChild(css);

  // ---- which fighter to describe: the tile under the pointer, else the keyboard cursor, else the active slot
  // 85_menu ALWAYS has a `.cur` tile (its cursor starts at index 0 whether or not a key was pressed), so
  // trusting it showed DOGE's moves to a mouse player who had just picked TOP G. The cursor only counts
  // once the arrows have actually been used, and the mouse takes that back.
  let pointed = null, kbNav = false;
  function focusId() {
    if (pointed) return pointed;
    const ro = $m('roster');
    const cur = kbNav && ro && ro.querySelector('.pick.cur');
    if (cur && cur.id && cur.id.indexOf('pick_') === 0) return cur.id.slice(5);
    const s = (UI.slots || [])[UI.active || 0];
    return s ? s.char : null;
  }
  function baseOf(id) {
    if (id === 'mine') { try { const lk = window.CustomLook && CustomLook.get && CustomLook.get(); return lk ? lk.base : null; } catch (e) { return null; } }
    return id;
  }

  let shown = '';
  function paint() {
    const wrap = document.querySelector('#scSelect .grid-wrap'); if (!wrap) return;
    let box = $m('mvHint');
    if (!box) { box = document.createElement('div'); box.id = 'mvHint'; box.setAttribute('aria-live', 'polite'); wrap.appendChild(box); }
    const raw = focusId(), id = baseOf(raw);
    const c = id && typeof CHAR_BY_ID !== 'undefined' ? CHAR_BY_ID[id] : null;
    if (!c) { box.hidden = true; shown = ''; return; }
    const key = specialKey();
    const sig = c.id + '|' + key + '|' + (raw === 'mine' ? 'mine' : '');
    if (sig === shown && !box.hidden) return;
    shown = sig;
    // local and online both play with signature specials on (Game.sigs), so moves2 is what the player gets
    const m = c.moves2 || c.moves || {};
    let label = c.name;
    if (raw === 'mine') { try { label = (CustomLook.get() || {}).name || c.name; } catch (e) { /* keep the body's name */ } }
    const cells = SLOTS.map(([slot, dir]) => {
      const d = m[slot], nm = nameOf(d, slot);
      const hot = !!(d && (d.fx || d.sigText));       // the showpiece ones get the accent
      return `<div class="mvh-m${hot ? ' hot' : ''}" title="${nm}"><span class="mvh-k">${dir ? `<i>${dir}</i>` : ''}${key}</span><span class="mvh-n">${nm}</span></div>`;
    }).join('');
    box.innerHTML = `<div class="mvh-who"><small>Specials</small><b>${label.replace(/[<>&]/g, '')}</b></div>${cells}`;
    box.hidden = false;
  }

  // ---- when to repaint ----
  const origRS = UI.renderSelect;
  UI.renderSelect = function () { const r = origRS.apply(this, arguments); try { paint(); } catch (e) { /* cosmetic */ } return r; };
  document.addEventListener('mouseover', e => {
    const t = e.target && e.target.closest && e.target.closest('#roster .pick, #roster .cf-pick');
    const id = t ? (t.id === 'pick_mine' ? 'mine' : (t.id || '').replace(/^pick_/, '')) : null;
    if (t) kbNav = false;
    if (id !== pointed && (t || pointed)) { pointed = id; try { paint(); } catch (er) { /* cosmetic */ } }
  });
  document.addEventListener('mouseout', e => {
    if (pointed && e.target && e.target.closest && e.target.closest('#roster') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#roster'))) { pointed = null; try { paint(); } catch (er) { /* cosmetic */ } }
  });
  // arrows / pad: 85_menu moves its cursor on keydown, so read it after that handler has run
  addEventListener('keydown', e => {
    const S = $m('scSelect'); if (!S || S.hidden) return;
    if (/^(Arrow(Left|Right|Up|Down)|Key[WASD])$/.test(e.code)) kbNav = true;
    setTimeout(() => { pointed = null; try { paint(); } catch (er) { /* cosmetic */ } }, 0);
  });

  window.MoveHint = { paint, nameOf, _names: id => { const c = CHAR_BY_ID[id]; const m = c && (c.moves2 || c.moves) || {}; return SLOTS.map(([s]) => nameOf(m[s], s)); } };
})();
