// ===== THE LOCKER: wear what you own, and browse what there is =====
//
// Duane, 2026-10-15: *"build this completely"*, then, pointing at Lord Nine x NEXT Market,
// *"dont copy it outright but just the ideas"*.
//
// The economy behind this is in src/89_econ.js (`CAT.locker`) and net/lib/economy.js. This file is
// the screen, and it is deliberately split in two the way every shop worth copying splits it:
//
//   LOCKER     what you own, on your fighter. Six body slots down the left, the item that is in each
//              one, and the inventory for whichever slot you are editing. This is Fortnite's locker
//              and Destiny's character sheet: the character IS the navigation.
//   CATALOGUE  everything that exists, whether you own it or not, with filters that stack. This is
//              Ronin Market and NEXT Market: category, then rarity, then a flag, with the count of
//              what survived the filters always on screen and a chip per active filter.
//
// WHAT IS NOT HERE, ON PURPOSE:
//   * No prices. Gear is not sold -- it drops free from crates, and the crate drops free from
//     playing. There is nothing in this screen to buy, so there is no checkout in it.
//   * No "trade" or "list for sale". There is no player-to-player market behind it, and a button
//     that opens a dialog that cannot complete is worse than no button.
//
// THE RULE THIS SCREEN ENFORCES: an item is only offered on a fighter the harness measured it clean
// on (dev/gearcheck.mjs -> the fit tables in 86_custom.js). `CustomLook.fitsBody()` is the single
// function that answers it, the card says so in words, and `Fits this fighter` is a filter. A player
// can own a piece their current fighter cannot wear -- that is Dota's model and it is fine -- but
// they can never EQUIP one, and they are told why rather than left wondering.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined' || !Econ.locker) return;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const byId = id => document.getElementById(id);
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = `
  #scLocker{background:#05070b}
  #scLocker::before{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(1100px 460px at 50% -10%,rgba(39,225,255,.09),transparent 70%),
               repeating-linear-gradient(0deg,rgba(255,255,255,.02) 0 1px,transparent 1px 3px)}
  #scLocker .wrap{width:min(1300px,100%);position:relative}
  .lk-top{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
  .lk-tabs{display:flex;gap:2px;flex-wrap:wrap}
  .lk-tabs button{min-height:38px;padding:0 18px;font:700 13px var(--ui);color:var(--muted);background:rgba(255,255,255,.04);border:0;box-shadow:inset 0 0 0 1px var(--line);cursor:pointer}
  .lk-tabs button.on{color:#fff;background:var(--red);box-shadow:none}
  /* ---- the crate bar ---- */
  .lk-crates{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:11px 15px;background:rgba(5,7,11,.6);box-shadow:inset 0 0 0 1px var(--line)}
  .lk-crates .cn{font-family:var(--display);font-style:italic;font-weight:900;font-size:30px;line-height:1;color:var(--gold)}
  .lk-crates .cl{font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
  .lk-crates .odds{display:flex;gap:9px;flex-wrap:wrap;margin-left:auto}
  .lk-crates .odds i{font:700 10px var(--mono);font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);
    padding:3px 7px;background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px var(--line)}
  .lk-crates .odds i b{color:var(--c)}
  /* ---- the two-column locker ---- */
  .lk-body{display:grid;grid-template-columns:276px minmax(0,1fr);gap:12px;align-items:start}
  .lk-slots{display:flex;flex-direction:column;gap:6px}
  .lk-slot{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.035);
    box-shadow:inset 0 0 0 1px var(--line);cursor:pointer;border:0;color:#fff;text-align:left;width:100%}
  .lk-slot:hover{background:rgba(255,255,255,.07)}
  .lk-slot.on{box-shadow:inset 0 0 0 2px var(--red)}
  .lk-slot .th{width:54px;height:54px;flex:0 0 54px;position:relative}
  .lk-slot .th .ia-tile{height:54px;border-radius:7px}
  .lk-slot .tx{min-width:0;flex:1}
  .lk-slot .tx b{display:block;font:800 13px var(--ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lk-slot .tx span{display:block;font:700 9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  .lk-slot .tx em{display:block;font-style:normal;font:700 10px var(--mono);color:var(--tc,#8d99a7)}
  .lk-fighter{padding:10px;background:rgba(5,7,11,.5);box-shadow:inset 0 0 0 1px var(--line)}
  .lk-fighter b{display:block;font:800 12px var(--ui)}
  .lk-fighter span{font:700 10px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--dim)}
  /* ---- filters ---- */
  .lk-filters{display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(5,7,11,.5);box-shadow:inset 0 0 0 1px var(--line)}
  .lk-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .lk-row > label{font:700 9.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim);min-width:62px}
  .lk-chip{font:700 11px var(--ui);padding:5px 10px;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line);
    color:var(--muted);border:0;cursor:pointer;border-radius:3px}
  .lk-chip:hover{color:#fff;background:rgba(255,255,255,.1)}
  .lk-chip.on{color:#fff;background:var(--red);box-shadow:none;font-weight:800}
  .lk-chip.tier.on{color:#05070b;background:var(--tc)}
  .lk-search{flex:1;min-width:140px;height:30px;padding:0 10px;font:600 12px var(--ui);color:#fff;
    background:rgba(255,255,255,.05);border:0;box-shadow:inset 0 0 0 1px var(--line)}
  .lk-active{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .lk-active .ac{display:inline-flex;align-items:center;gap:6px;font:700 10px var(--mono);letter-spacing:.06em;text-transform:uppercase;
    padding:4px 8px;background:rgba(39,225,255,.14);box-shadow:inset 0 0 0 1px rgba(39,225,255,.4);color:#bfefff;border:0;cursor:pointer}
  .lk-active .ac:after{content:"\\00d7";font-size:13px;line-height:1}
  .lk-count{margin-left:auto;font:700 10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  /* ---- the grid ---- */
  .lk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:9px}
  .lk-list .lk-card{display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:11px;padding:7px 10px}
  .lk-list .lk-card .ia-tile{height:52px}
  .lk-list .lk-card .bl,.lk-list .lk-card .meta{display:none}
  .lk-list{display:flex;flex-direction:column;gap:4px}
  .lk-card{position:relative;display:flex;flex-direction:column;gap:6px;padding:9px;text-align:left;border:0;cursor:pointer;
    background:var(--glass);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tc,#8d99a7) 34%,transparent);color:#fff;
    transition:transform .14s,box-shadow .18s;overflow:hidden}
  .lk-card:hover{transform:translateY(-2px);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tc,#8d99a7) 72%,transparent),0 14px 30px -16px #000}
  .lk-card.eq{box-shadow:inset 0 0 0 2px var(--lime)}
  .lk-card .nm{font:800 13.5px var(--ui);line-height:1.15;color:var(--tc,#e8ecf4)}
  .lk-card .bl{font:700 9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  .lk-card .meta{display:flex;justify-content:space-between;align-items:center;gap:6px}
  .lk-card .own{font:800 10px var(--mono);color:var(--lime)}
  .lk-card .no{font:800 10px var(--mono);color:var(--dim)}
  .lk-card .bad{font:700 9.5px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:#ff8c6b}
  .lk-empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:13px;background:rgba(5,7,11,.5);box-shadow:inset 0 0 0 1px var(--line)}
  /* ---- the item sheet ---- */
  .lk-sheet{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(3,4,7,.78)}
  .lk-sheet.on{display:flex}
  .lk-sheet .in{width:min(560px,100%);max-height:88vh;overflow:auto;background:#0a0d13;box-shadow:inset 0 0 0 1px var(--line2),0 30px 70px -20px #000;padding:16px;display:flex;flex-direction:column;gap:12px}
  .lk-sheet .hd{display:flex;gap:14px;align-items:flex-start}
  .lk-sheet .hd .art{width:170px;flex:0 0 170px}
  .lk-sheet .hd .art .ia-tile{height:170px}
  .lk-sheet h3{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:30px;line-height:.95;text-transform:uppercase;color:var(--tc,#fff)}
  .lk-sheet .sub{font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
  .lk-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px}
  .lk-facts div{padding:7px 9px;background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px var(--line)}
  .lk-facts div span{display:block;font:700 9px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .lk-facts div b{font:800 13px var(--ui);color:#fff}
  .lk-note{font-size:12.5px;line-height:1.5;color:var(--muted)}
  .lk-note.warn{color:#ffb79b}
  .lk-acts{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
  /* ---- the reveal ---- */
  #lkReveal{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;background:rgba(3,4,7,.86)}
  #lkReveal.on{display:flex}
  #lkReveal .rv{width:min(400px,92%);padding:22px;text-align:center;background:#0a0d13;
    box-shadow:inset 0 0 0 2px var(--tc,#8d99a7),0 0 60px -10px var(--tc,#8d99a7);display:flex;flex-direction:column;gap:12px;align-items:center}
  #lkReveal .rv .art{width:210px}
  #lkReveal .rv .art .ia-tile{height:210px}
  #lkReveal .rv h3{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:34px;line-height:.95;text-transform:uppercase;color:var(--tc,#fff)}
  #lkReveal .rv .tier{font:800 11px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:#05070b;background:var(--tc,#8d99a7);padding:4px 11px;border-radius:999px}
  #lkReveal .rv .unu{font:800 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#05070b;background:var(--uc,#ff6a2a);padding:4px 11px;border-radius:999px}
  @media (max-width:860px){.lk-body{grid-template-columns:1fr}.lk-sheet .hd{flex-direction:column}.lk-sheet .hd .art{width:100%;flex:none}}
  `;

  // what the filters are set to, kept across openings the way a shop remembers your last view
  const F = {
    tab: 'locker',               // 'locker' | 'catalogue'
    slot: null,                  // a locker slot id, or null for all
    tier: null,                  // a tier id, or null for all
    cond: null,                  // a condition id, or null for all (locker only: instances have one)
    coll: null,                  // a collection id, or null for all
    own: null,                   // 'yes' | 'no' | null
    fit: false,                  // only what THIS fighter can wear
    unusual: false,              // only Unusuals
    counter: false,              // only copies carrying a KO counter (the 1-in-10 variant)
    arena: false,                // only Arena Editions (dropped from a rated or staked match)
    q: '',                       // search
    view: 'grid',                // 'grid' | 'list'
    sort: 'tier',                // 'tier' | 'name' | 'new' | 'ko'
    editing: 'hat',              // which slot the locker column is editing
    open: null,                  // the uid or item id whose sheet is up
    built: false,
  };

  // Whose body the gear is being fitted to. This read ONLY the creator's saved base, so a player who
  // has never opened the creator -- which is most of them -- had the locker announce "WEARING ON
  // DOGE" about a fighter they do not play. `lastChar` is the one they actually picked last, written
  // by UI.fight(), so it comes first and doge is only the last resort.
  const base = () => {
    try { const l = CustomLook.get(); if (l && l.base) return l.base; } catch (e) { /* creator unused */ }
    try { const c = store.get('lastChar', null); if (c) return c; } catch (e) { /* storage blocked */ }
    return 'doge';
  };
  const tierCol = t => (Econ.tierOf(t) || {}).color || '#8d99a7';
  const tierName = t => (Econ.tierOf(t) || {}).name || t;
  const roster = () => { try { return CHARS.length; } catch (e) { return 48; } };

  function build() {
    if (F.built) return; F.built = true;
    if (window.ItemArt && ItemArt.styles) ItemArt.styles();
    const st = el('style'); st.textContent = css; document.head.appendChild(st);

    const sc = el('section', 'screen solid'); sc.id = 'scLocker'; sc.hidden = true;
    sc.innerHTML = `<div class="wrap">
      <div class="lk-top">
        <div><div class="eyebrow">Your fighter</div><h2 class="h2">The Locker</h2></div>
        <div class="row">
          <div class="lk-tabs" id="lkTabs"></div>
          <button class="btn small" id="lkBack">Back</button>
        </div>
      </div>
      <div class="lk-crates" id="lkCrates"></div>
      <div class="lk-body">
        <div class="lk-slots" id="lkSlots"></div>
        <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
          <div class="lk-filters" id="lkFilters"></div>
          <div id="lkItems"></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(sc);

    const sheet = el('div', 'lk-sheet'); sheet.id = 'lkSheet';
    sheet.innerHTML = '<div class="in" id="lkSheetIn"></div>';
    sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
    document.body.appendChild(sheet);

    const rv = el('div'); rv.id = 'lkReveal'; rv.innerHTML = '<div class="rv" id="lkRevealIn"></div>';
    rv.onclick = () => { rv.classList.remove('on'); render(); };
    document.body.appendChild(rv);

    byId('lkBack').onclick = () => { sfx(); close(); };
    const tb = byId('lkTabs');
    for (const [id, label] of [['locker', 'Locker'], ['catalogue', 'Catalogue'], ['worn', 'Most worn']]) {
      const b = el('button', F.tab === id ? 'on' : '', label);
      b.dataset.t = id;
      b.onclick = () => { F.tab = id; sfx(); render(); };
      tb.appendChild(b);
    }
    Econ.on(() => { if (!sc.hidden) render(); });
  }

  // ---------------------------------------------------------------- the crate bar
  function paintCrates() {
    const box = byId('lkCrates'); if (!box) return;
    const L = Econ.locker(), n = Econ.crates();
    box.innerHTML = '';
    // the crate has a studio render like everything else; a bare number next to a button was the
    // one place in this screen with no picture in it
    if (window.ItemArt && ItemArt.has('g_crate')) {
      const th = el('div');
      th.style.cssText = 'width:62px;flex:0 0 62px';
      th.innerHTML = ItemArt.tile({ id: 'g_crate', col: '#ffb020' });
      const t = th.querySelector('.ia-tile'); if (t) t.style.height = '62px';
      box.appendChild(th);
    }
    box.appendChild(el('span', 'cn', String(n)));
    const lab = el('div');
    lab.appendChild(el('div', 'cl', n === 1 ? 'Street crate' : 'Street crates'));
    lab.appendChild(el('div', 'cl', 'Free, one every ' + L.crate.every + ' matches'));
    box.appendChild(lab);
    const btn = el('button', 'btn small' + (n > 0 ? ' primary' : ''), n > 0 ? 'Open a crate' : 'Play to earn one');
    btn.disabled = n < 1;
    btn.onclick = () => { sfx(); doOpen(btn); };
    box.appendChild(btn);
    // ---- THE TRADE-UP CONTRACT, 2026-10-16 --------------------------------------------------
    // Ten spare copies of one grade become one of the grade above, and the new copy's float is the
    // AVERAGE of what went in -- CS2's actual rule, and the reason people hunt clean commons to
    // feed a contract. It is the duplicate sink: without one, the tenth Visor is worth nothing and
    // the floor of the whole market goes with it. The server picks which ten, so a page cannot
    // hand-pick its worst and keep its best.
    const ready = Econ.tradeReady();
    for (const r of ready) {
      const tb = el('button', 'btn small', 'Trade up ' + Econ.tradeNeed + ' ' + tierName(r.from) + ' → 1 ' + tierName(r.to));
      tb.onclick = () => {
        sfx(); tb.disabled = true; tb.textContent = 'Trading…';
        Econ.tradeUp(r.from, res => {
          if (!res || !res.ok) { note(res && res.msg ? res.msg : 'That did not go through.'); render(); return; }
          reveal(res.inst); render();
        });
      };
      box.appendChild(tb);
    }
    // the odds, published, because a market where the odds are hidden is a casino
    const od = el('div', 'odds');
    for (const o of L.odds) {
      const i = el('i'); i.style.setProperty('--c', o.color);
      i.innerHTML = `<b>${esc(o.name)}</b> ${(o.p * 100).toFixed(2)}%`;
      od.appendChild(i);
    }
    const u = el('i'); u.style.setProperty('--c', '#ff6a2a');
    u.innerHTML = `<b>Unusual</b> ${(L.unusualChance * 100).toFixed(0)}%`;
    od.appendChild(u);
    box.appendChild(od);
  }

  function doOpen(btn) {
    btn.disabled = true; btn.textContent = 'Opening…';
    Econ.openCase(r => {
      paintCrates();
      if (!r || !r.ok) { note(r && r.msg ? r.msg : 'That did not go through.'); return; }
      reveal(r.inst);
    });
  }

  function reveal(inst) {
    const g = Econ.gear(inst.id); if (!g) return;
    const box = byId('lkRevealIn'), wrap = byId('lkReveal');
    const un = inst.unusual ? Econ.unusualOf(inst.unusual) : null;
    box.style.setProperty('--tc', tierCol(inst.tier));
    if (un) box.style.setProperty('--uc', un.color);
    box.innerHTML = `<span class="tier">${esc(tierName(inst.tier))}</span>
      <div class="art">${ItemArt.tile({ id: g.id, icon: g.icon, col: tierCol(inst.tier), unusual: un, serial: inst.serial, mint: Econ.mintOf(g.id) })}</div>
      <h3>${esc(g.name)}</h3>
      ${un ? `<span class="unu">${esc(un.name)}</span>` : ''}
      <div class="sub" style="font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">
        ${esc(slotName(g.slot))} &middot; #${inst.serial} of ${Econ.mintOf(g.id)} ever opened</div>
      <div class="lk-note">Tap anywhere to close</div>`;
    wrap.classList.add('on');
    try { Sfx[un ? 'win' : 'ui'](); } catch (e) { /* audio locked */ }
  }

  const slotName = id => { const s = Econ.lockerSlots().find(x => x.id === id); return s ? s.name : id; };
  const slotIcon = id => { const s = Econ.lockerSlots().find(x => x.id === id); return s ? s.icon : '◆'; };

  // ---------------------------------------------------------------- the slot column
  function paintSlots() {
    const box = byId('lkSlots'); if (!box) return;
    box.innerHTML = '';
    const b = base();
    const fi = el('div', 'lk-fighter');
    let nm = b;
    try { const c = CHAR_BY_ID[b]; if (c) nm = c.name; } catch (e) { /* roster not loaded */ }
    fi.innerHTML = `<span>Wearing on</span><b>${esc(nm)}</b>`;
    box.appendChild(fi);
    for (const s of Econ.lockerSlots()) {
      const inst = Econ.worn(s.id), g = inst ? Econ.gear(inst.id) : null;
      const col = inst ? tierCol(inst.tier) : '#2a303a';
      const btn = el('button', 'lk-slot' + (F.editing === s.id ? ' on' : ''));
      btn.style.setProperty('--tc', col);
      const un = inst && inst.unusual ? Econ.unusualOf(inst.unusual) : null;
      const art = g ? ItemArt.tile({ id: g.id, icon: g.icon, col, unusual: un })
        : `<div class="ia-tile" style="--rc:#1a1e26"><div class="ia-field"></div><span class="ia-fb" style="opacity:.4">${s.icon}</span></div>`;
      btn.innerHTML = `<div class="th">${art}</div><div class="tx">
        <span>${esc(s.name)}</span>
        <b>${g ? esc(g.name) : 'Empty'}</b>
        ${inst ? `<em>${esc(tierName(inst.tier))}${un ? ' · ' + esc(un.name) : ''}${inst.ko ? ' · ' + inst.ko + ' KO' : ''}</em>` : ''}
      </div>`;
      btn.onclick = () => { F.editing = s.id; F.slot = s.id; F.tab = 'locker'; sfx(); render(); };
      box.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------- filters
  function chip(label, on, fn, cls, col) {
    const b = el('button', 'lk-chip' + (cls ? ' ' + cls : '') + (on ? ' on' : ''), label);
    if (col) b.style.setProperty('--tc', col);
    b.onclick = () => { fn(); sfx(); render(); };
    return b;
  }
  function paintFilters() {
    const box = byId('lkFilters'); if (!box) return;
    box.innerHTML = '';
    const L = Econ.locker();
    // category
    const r1 = el('div', 'lk-row'); r1.appendChild(el('label', '', 'Slot'));
    r1.appendChild(chip('All', !F.slot, () => { F.slot = null; }));
    for (const s of L.slots) r1.appendChild(chip(s.name, F.slot === s.id, () => { F.slot = F.slot === s.id ? null : s.id; }));
    box.appendChild(r1);
    // rarity
    const r2 = el('div', 'lk-row'); r2.appendChild(el('label', '', 'Grade'));
    r2.appendChild(chip('All', !F.tier, () => { F.tier = null; }));
    for (const o of L.odds) r2.appendChild(chip(o.name, F.tier === o.tier, () => { F.tier = F.tier === o.tier ? null : o.tier; }, 'tier', o.color));
    box.appendChild(r2);
    // ---- condition, 2026-10-16. The same filter CS2 calls Exterior, and the reason one item id
    // is five priced products. Only shown in the locker, where instances actually have one.
    if (F.tab === 'locker') {
      const rc = el('div', 'lk-row'); rc.appendChild(el('label', '', 'Condition'));
      rc.appendChild(chip('All', !F.cond, () => { F.cond = null; }));
      for (const c of Econ.conditions()) rc.appendChild(chip(c.name, F.cond === c.id, () => { F.cond = F.cond === c.id ? null : c.id; }, 'tier', c.color));
      box.appendChild(rc);
    }
    // ---- collection. Every item belongs to a named set and the set links to its other items.
    // This is the filter that turns one purchase into five.
    const rcl = el('div', 'lk-row'); rcl.appendChild(el('label', '', 'Collection'));
    rcl.appendChild(chip('All', !F.coll, () => { F.coll = null; }));
    for (const c of Econ.collections()) rcl.appendChild(chip(c.name.replace(/ Collection$/, ''), F.coll === c.id, () => { F.coll = F.coll === c.id ? null : c.id; }, 'tier', c.color));
    box.appendChild(rcl);
    // flags + search + view
    const r3 = el('div', 'lk-row'); r3.appendChild(el('label', '', 'Show'));
    r3.appendChild(chip('Owned', F.own === 'yes', () => { F.own = F.own === 'yes' ? null : 'yes'; }));
    r3.appendChild(chip('Not owned', F.own === 'no', () => { F.own = F.own === 'no' ? null : 'no'; }));
    r3.appendChild(chip('Fits this fighter', F.fit, () => { F.fit = !F.fit; }));
    r3.appendChild(chip('Unusual', F.unusual, () => { F.unusual = !F.unusual; }));
    r3.appendChild(chip('KO counter', F.counter, () => { F.counter = !F.counter; }));
    r3.appendChild(chip('Arena edition', F.arena, () => { F.arena = !F.arena; }));
    const q = el('input', 'lk-search'); q.type = 'search'; q.placeholder = 'Search gear'; q.value = F.q;
    q.oninput = () => { F.q = q.value; renderItems(); };
    r3.appendChild(q);
    r3.appendChild(chip(F.view === 'grid' ? 'List view' : 'Grid view', false, () => { F.view = F.view === 'grid' ? 'list' : 'grid'; }));
    // csgoskins offers nine sorts, not three. Past ~20 items a grid with no sort is a wall.
    const sorts = [['tier', 'Grade'], ['name', 'Name'], ['new', 'Newest'], ['old', 'Oldest'],
      ['ko', 'KOs'], ['cond', 'Condition'], ['float', 'Lowest float'], ['plus', 'Enhancement'], ['supply', 'Rarest supply']];
    const nextSort = () => { const i = sorts.findIndex(s => s[0] === F.sort); F.sort = sorts[(i + 1) % sorts.length][0]; };
    r3.appendChild(chip('Sort: ' + (sorts.find(s => s[0] === F.sort) || sorts[0])[1], false, nextSort));
    box.appendChild(r3);
    // the active chips + the count, which is the thing that tells you the filters did anything
    const r4 = el('div', 'lk-active');
    const act = [];
    if (F.slot) act.push([slotName(F.slot), () => { F.slot = null; }]);
    if (F.tier) act.push([tierName(F.tier), () => { F.tier = null; }]);
    if (F.cond) act.push([(Econ.condition(F.cond) || {}).name || F.cond, () => { F.cond = null; }]);
    if (F.coll) act.push([(Econ.collection(F.coll) || {}).name || F.coll, () => { F.coll = null; }]);
    if (F.own) act.push([F.own === 'yes' ? 'Owned' : 'Not owned', () => { F.own = null; }]);
    if (F.fit) act.push(['Fits this fighter', () => { F.fit = false; }]);
    if (F.unusual) act.push(['Unusual', () => { F.unusual = false; }]);
    if (F.counter) act.push(['KO counter', () => { F.counter = false; }]);
    if (F.arena) act.push(['Arena edition', () => { F.arena = false; }]);
    if (F.q) act.push(['"' + F.q + '"', () => { F.q = ''; }]);
    for (const [label, fn] of act) {
      const b = el('button', 'ac', label);
      b.onclick = () => { fn(); sfx(); render(); };
      r4.appendChild(b);
    }
    if (act.length > 1) {
      const c = el('button', 'lk-chip', 'Clear all');
      c.onclick = () => { F.slot = null; F.tier = null; F.cond = null; F.coll = null; F.own = null; F.fit = false; F.unusual = false; F.counter = false; F.arena = false; F.q = ''; sfx(); render(); };
      r4.appendChild(c);
    }
    r4.appendChild(el('span', 'lk-count', '', ''));
    box.appendChild(r4);
  }

  // ---------------------------------------------------------------- the item list
  // LOCKER rows are INSTANCES (a thing you own, with a serial and a KO count on it).
  // CATALOGUE rows are DEFINITIONS (a thing that exists). Keeping those apart is what lets the same
  // item appear three times in a locker, once per copy, and exactly once in the catalogue.
  function rows() {
    const b = base(), q = F.q.trim().toLowerCase();
    let out;
    if (F.tab === 'locker') {
      out = Econ.inv().map(inst => ({ inst, g: Econ.gear(inst.id) })).filter(r => r.g);
    } else {
      out = Econ.gearList().map(g => ({ g, inst: null }));
    }
    out = out.filter(r => {
      const g = r.g, t = r.inst ? r.inst.tier : g.tier;
      if (F.slot && g.slot !== F.slot) return false;
      if (F.tier && t !== F.tier) return false;
      if (F.cond && !(r.inst && r.inst.cond === F.cond)) return false;
      if (F.coll && g.collection !== F.coll) return false;
      if (F.unusual && !(r.inst && r.inst.unusual)) return false;
      if (F.counter && !(r.inst && r.inst.counter)) return false;
      if (F.arena && !(r.inst && r.inst.series === 'arena')) return false;
      if (F.fit && !Econ.fitsBody(g.id, b)) return false;
      if (F.own === 'yes' && !(r.inst || Econ.ownsGear(g.id))) return false;
      if (F.own === 'no' && (r.inst || Econ.ownsGear(g.id))) return false;
      if (q && g.name.toLowerCase().indexOf(q) < 0 && slotName(g.slot).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const tierIx = r => order.indexOf(r.inst ? r.inst.tier : r.g.tier);
    out.sort((a, c) => {
      if (F.sort === 'name') return a.g.name.localeCompare(c.g.name);
      if (F.sort === 'new') return ((c.inst && c.inst.at) || 0) - ((a.inst && a.inst.at) || 0);
      if (F.sort === 'old') return ((a.inst && a.inst.at) || 0) - ((c.inst && c.inst.at) || 0);
      if (F.sort === 'ko') return ((c.inst && c.inst.ko) || 0) - ((a.inst && a.inst.ko) || 0);
      if (F.sort === 'cond') return ((a.inst && a.inst.float) || 1) - ((c.inst && c.inst.float) || 1);
      if (F.sort === 'float') return ((a.inst && a.inst.float) || 1) - ((c.inst && c.inst.float) || 1);
      if (F.sort === 'plus') return ((c.inst && c.inst.plus) || 0) - ((a.inst && a.inst.plus) || 0);
      if (F.sort === 'supply') return (Econ.mintOf(a.g.id) || 0) - (Econ.mintOf(c.g.id) || 0);
      return tierIx(c) - tierIx(a) || a.g.name.localeCompare(c.g.name);
    });
    return out;
  }

  // How you GET it. Every one of the 27 catalogue tiles said "Not owned" and carried no price and no
  // button, so the catalogue read as a window display with no door — the one thing a shop must never
  // do. There is no key in this build: a crate is the only route, so the card states the route and
  // the published odds of pulling that grade, which is the honest version of a price.
  // How you GET it, now that there are two ways (2026-10-16). The free route stays on the card
  // because it costs nothing and it is the only one that can roll an Unusual; the price is the
  // shortcut for somebody who already knows which piece they want.
  const route = (tier, g) => {
    const o = Econ.tierOf(tier);
    const odds = o ? (o.p * 100).toFixed(2) + '%' : '';
    const price = g && g.price != null ? Econ.money(g.price) : null;
    if (price && odds) return price + ' · or ' + odds + ' from a crate';
    return price || (odds ? 'From crates · ' + odds : 'From crates');
  };
  function card(r) {
    const g = r.g, inst = r.inst, b = base();
    const tier = inst ? inst.tier : g.tier, col = tierCol(tier);
    const un = inst && inst.unusual ? Econ.unusualOf(inst.unusual) : null;
    const fits = Econ.fitsBody(g.id, b);
    const owned = !!inst || Econ.ownsGear(g.id);
    const eq = inst && Econ.wornUid(g.slot) === inst.uid;
    const c = el('button', 'lk-card' + (eq ? ' eq' : ''));
    c.style.setProperty('--tc', col);
    // CONDITION and the +N stamp, 2026-10-16. A copy is not just an item any more: it is an item in
    // a condition, with a float, possibly carrying an enhancement level from a trade-up. CS2 is
    // 15,718 "skins" and most of that number is the same paint in five wear steps.
    const cd = inst && inst.cond ? Econ.condition(inst.cond) : null;
    c.innerHTML = ItemArt.tile({ id: g.id, icon: g.icon, col, locked: !owned, unusual: un,
      serial: inst ? inst.serial : 0, mint: inst ? Econ.mintOf(g.id) : 0, ko: inst ? inst.ko : 0,
      plus: inst ? (inst.plus || 0) : 0 })
      + `<div class="nm">${inst && inst.plus ? '<i style="font-style:normal;color:#ffd36a">+' + inst.plus + '</i> ' : ''}${esc(g.name)}</div>`
      + `<div class="bl">${esc(tierName(tier))} · ${esc(slotName(g.slot))}${cd ? ' · <i style="font-style:normal;color:' + cd.color + '">' + esc(cd.name) + '</i>' : ''}`
        + `${inst && inst.counter ? ' · <i style="font-style:normal;color:#9fe8ff">Counter</i>' : ''}`
        + `${inst && inst.series === 'arena' ? ' · <i style="font-style:normal;color:#27e1ff">Arena</i>' : ''}</div>`
      + `<div class="meta">${eq ? '<span class="own">Equipped</span>'
        : owned ? `<span class="own">Owned${!inst && Econ.countOf(g.id) > 1 ? ' ×' + Econ.countOf(g.id) : ''}</span>`
        : `<span class="no">${esc(route(tier, g))}</span>`}
        ${fits ? '' : '<span class="bad">Not for this fighter</span>'}</div>`;
    c.onclick = () => { sfx(); openSheet(r); };
    return c;
  }

  // ---- MOST WORN, 2026-10-16 ----------------------------------------------------------------
  // fortnite.gg publishes a usage ranking for every cosmetic in the game ("1 BACKLASH 3.25% / 48M")
  // and it is the proof of the whole visibility argument, in public: a TF2 bobble hat is worth $440
  // because eight people stare at it all match, and a Gods Unchained shield is worth a cent because
  // one person sees it. Counted server-side from what was actually ON a fighter in a finished
  // match, never from what is owned -- owning a thing nobody sees is the case this tells apart.
  function renderWorn(box) {
    const list = Econ.mostWorn || [];
    box.className = 'lk-list';
    box.innerHTML = '';
    if (!list.length) {
      box.className = '';
      box.appendChild(el('div', 'lk-empty', 'No matches counted yet. This page fills in as people play with gear equipped — it ranks what is actually WORN, not what is owned.'));
      return;
    }
    for (const row of list) {
      const g = Econ.gear(row.id); if (!g) continue;
      const col = tierCol(g.tier);
      const c = el('button', 'lk-card');
      c.style.setProperty('--tc', col);
      c.innerHTML = ItemArt.tile({ id: g.id, icon: g.icon, col })
        + `<div class="nm"><i style="font-style:normal;color:var(--dim)">${row.rank}.</i> ${esc(g.name)}</div>`
        + `<div class="bl">${esc(tierName(g.tier))} · ${esc(slotName(g.slot))}</div>`
        + `<div class="meta"><span class="own">${row.pct}%</span><span class="no">${row.n} matches</span></div>`;
      c.onclick = () => { sfx(); openSheet({ g, inst: null }); };
      box.appendChild(c);
    }
  }

  function renderItems() {
    const box = byId('lkItems'); if (!box) return;
    if (F.tab === 'worn') return renderWorn(box);
    const list = rows();
    const cnt = document.querySelector('#lkFilters .lk-count');
    if (cnt) cnt.textContent = list.length + (F.tab === 'locker' ? (list.length === 1 ? ' item owned' : ' items owned') : (list.length === 1 ? ' item' : ' items'));
    box.className = F.view === 'grid' ? 'lk-grid' : 'lk-list';
    box.innerHTML = '';
    // A brand-new locker showed a full Slot / Grade / Show filter stack and a search box over a box
    // with nothing in it. Filtering nothing is not a feature, it is furniture. The stack stands down
    // until there is something to filter, and the empty state carries the route in instead.
    const bare = F.tab === 'locker' && !Econ.inv().length;
    const fil = byId('lkFilters'); if (fil) fil.hidden = bare;
    if (!list.length) {
      box.className = '';
      const why = F.tab === 'locker'
        ? (Econ.inv().length ? 'Nothing here matches those filters.' : 'Your locker is empty. Crates drop free for playing, one every ' + Econ.locker().crate.every + ' matches — then open one here.')
        : 'Nothing in the catalogue matches those filters.';
      const e = el('div', 'lk-empty', why);
      if (bare) {
        // one button, and it is the free route. Nothing in this screen costs money.
        const b = el('button', 'btn small primary', Econ.crates() > 0 ? 'Open a crate' : 'See what drops');
        b.onclick = () => { sfx(); if (Econ.crates() > 0) doOpen(b); else { F.tab = 'catalogue'; render(); } };
        e.appendChild(document.createElement('br'));
        e.appendChild(b);
      }
      box.appendChild(e);
      return;
    }
    for (const r of list) box.appendChild(card(r));
  }

  // ---------------------------------------------------------------- the item sheet
  function openSheet(r) {
    const g = r.g, inst = r.inst, b = base();
    const tier = inst ? inst.tier : g.tier, col = tierCol(tier);
    const un = inst && inst.unusual ? Econ.unusualOf(inst.unusual) : null;
    const fits = Econ.fitsBody(g.id, b);
    const fitN = Econ.fitCount(g.id);
    const owned = !!inst || Econ.ownsGear(g.id);
    const eq = inst && Econ.wornUid(g.slot) === inst.uid;
    const box = byId('lkSheetIn');
    box.style.setProperty('--tc', col);
    let bodyName = b;
    try { const c = CHAR_BY_ID[b]; if (c) bodyName = c.name; } catch (e) { /* roster not loaded */ }
    const facts = [];
    facts.push(['Grade', tierName(tier)]);
    facts.push(['Slot', slotName(g.slot)]);
    if (inst) facts.push(['Serial', '#' + inst.serial + ' / ' + Econ.mintOf(g.id)]);
    // The counter is a 1-in-10 VARIANT now, not a property of every copy: in CS2 the same gun with
    // a kill counter is worth 2.3x the plain one, and that only works while most copies lack it.
    if (inst && inst.counter) facts.push(['KO counter', String(inst.ko || 0) + ' KOs']);
    if (inst && inst.series === 'arena') facts.push(['Edition', 'Arena · dropped from a rated match']);
    if (un) facts.push(['Unusual', un.name]);
    if (fitN != null) facts.push(['Fits', fitN + ' of ' + roster() + ' fighters']);
    // ---- the summary rows csgoskins prints on every item page, 2026-10-16 -------------------
    // Category / Type / Finish / Designer / Released / Popularity, then Supply, then the drop
    // chance as a CHAIN. The chain is the important one: it is a legal requirement in several
    // markets, it makes us look honest, and the number itself is a better advert than copy.
    if (inst && inst.cond) {
      const cd = Econ.condition(inst.cond);
      if (cd) facts.push(['Condition', cd.name + ' (' + cd.lo.toFixed(2) + '–' + cd.hi.toFixed(2) + ')']);
      if (typeof inst.float === 'number') facts.push(['Float', inst.float.toFixed(4)]);
    }
    if (inst && inst.plus) facts.push(['Enhancement', '+' + inst.plus + ' (trade-up)']);
    if (g.collection) {
      const cl = Econ.collection(g.collection);
      if (cl) facts.push(['Collection', cl.name + ' · ' + Econ.inCollection(g.collection).length + ' items']);
    }
    const chain = Econ.oddsChain(g.id);
    if (chain) facts.push(['Drop chance', '1 in ' + chain.one + ' (' + (chain.total * 100).toFixed(3) + '%)']);
    const sup = Econ.supplyOf(g.id);
    if (sup.total) facts.push(['Supply', sup.total + ' minted · ' + sup.mine + ' yours']);
    box.innerHTML = `
      <div class="hd">
        <div class="art">${ItemArt.tile({ id: g.id, icon: g.icon, col, locked: !owned, unusual: un, size: 220 })}</div>
        <div style="min-width:0;flex:1">
          <div class="sub">${esc(tierName(tier))} · ${esc(slotName(g.slot))}</div>
          <h3>${esc(g.name)}</h3>
          <div class="lk-note" style="margin-top:7px">${owned ? 'In your locker.' : 'Not yours yet. It comes out of a Street Crate.'}</div>
        </div>
      </div>
      <div class="lk-facts">${facts.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="lk-note${fits ? '' : ' warn'}" id="lkFitNote"></div>
      <div class="lk-acts" id="lkActs"></div>`;
    // THE COMPATIBILITY LINE, in words. A player who cannot equip something is told why, with the
    // measurement behind it, instead of pressing a button that does nothing.
    const fn = byId('lkFitNote');
    fn.textContent = fits
      ? 'Measured clean on ' + bodyName + '. It will sit where it should.'
      : bodyName + ' is not one of the fighters this piece measured clean on, so it is not offered here. Switch fighter in the creator to wear it.';
    const acts = byId('lkActs');
    if (inst) {
      if (eq) {
        const b2 = el('button', 'btn small', 'Take off');
        b2.onclick = () => { sfx(); Econ.setWear(g.slot, null); closeSheet(); render(); };
        acts.appendChild(b2);
      } else {
        const b2 = el('button', 'btn small primary', fits ? 'Equip' : 'Cannot equip on this fighter');
        b2.disabled = !fits;
        b2.onclick = () => { sfx(); Econ.setWear(g.slot, inst.uid); closeSheet(); render(); };
        acts.appendChild(b2);
      }
    } else if (owned) {
      const b2 = el('button', 'btn small', 'Show my copies');
      b2.onclick = () => { F.tab = 'locker'; F.slot = g.slot; F.q = g.name; closeSheet(); sfx(); render(); };
      acts.appendChild(b2);
    }
    const cl = el('button', 'btn small', 'Close');
    cl.onclick = () => { sfx(); closeSheet(); };
    acts.appendChild(cl);
    byId('lkSheet').classList.add('on');
  }
  function closeSheet() { const s = byId('lkSheet'); if (s) s.classList.remove('on'); }

  function note(msg) {
    try { if (window.Store && Store.note) return Store.note(msg); } catch (e) { /* store not up */ }
    const t = byId('econToast');
    if (!t) return;
    t.innerHTML = ''; t.appendChild(el('span', '', msg)); t.classList.add('on');
    clearTimeout(note.t); note.t = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function render() {
    if (!F.built) return;
    for (const b of byId('lkTabs').children) b.className = b.dataset.t === F.tab ? 'on' : '';
    paintCrates(); paintSlots(); paintFilters(); renderItems();
  }

  let backTo = null;
  function open(from) {
    build();
    backTo = from || null;
    // every other screen is a `.screen`, and the menu shows one at a time
    for (const s of document.querySelectorAll('section.screen')) if (s.id !== 'scLocker') s.hidden = true;
    byId('scLocker').hidden = false;
    if (typeof Game !== 'undefined' && Game.state === 'title') Game.state = 'menu';
    try { Econ.pull(); } catch (e) { /* offline: the cache renders */ }
    // the Most Worn ranking is global, so it is asked for rather than cached per account
    try { if (Econ.connected()) Net.send({ k: 'worn' }); } catch (e) { /* offline */ }
    render();
  }
  function close() {
    byId('scLocker').hidden = true;
    closeSheet();
    const back = backTo && byId(backTo) ? backTo : 'scTitle';
    const t = byId(back); if (t) t.hidden = false;
    if (typeof UI !== 'undefined' && UI.show && !byId(back)) UI.show('scTitle');
  }

  window.Locker = { open, close, render, _F: F };
})();
