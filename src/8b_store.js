// ===== ECONOMY UI: the store, the arsenal panel, the profile / bragging screen =====
// Reads Econ (89_econ.js) and Items3 (57_items3.js). UI only: never touches fight state, never the
// seeded Rng. Design + reasoning: docs/ECONOMY.md.
//
// Where the arsenal button sits: top-left, BELOW the 1v1 HUD bars (they run y 12..126 on the left),
// so it never covers a damage meter. `window.TB_ARSENAL_RECT` publishes the box it takes, and it
// honours `window.TB_HUD_SAFE_TOP` if the HUD session sets one — that is the handshake between us.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined') return;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const byId = id => document.getElementById(id);
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const M = Econ.money;

  const css = `
  #scStore .wrap,#scProfile .wrap{width:min(1240px,100%)}
  .st-top{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
  .st-tabs{display:flex;gap:2px;flex-wrap:wrap}
  .st-tabs button{min-height:38px;padding:0 16px;font:700 13px var(--ui);color:var(--muted);background:rgba(255,255,255,.04);border:0;box-shadow:inset 0 0 0 1px var(--line);cursor:pointer}
  .st-tabs button.on{color:#fff;background:var(--red);box-shadow:none}
  .st-note{font-size:13px;color:var(--muted);max-width:74ch;line-height:1.5}
  .st-note b{color:var(--gold)}
  .shelf{display:flex;flex-direction:column;gap:10px}
  .shelf h3{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;line-height:.9;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .shelf .sub{font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:10px}
  .card{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px;min-height:168px;background:var(--glass);box-shadow:inset 0 0 0 1px var(--line);
    cursor:pointer;transition:transform .15s,box-shadow .2s;overflow:hidden;text-align:left}
  .card:hover{transform:translateY(-2px);box-shadow:inset 0 0 0 1px var(--line2)}
  .card .ic{font-size:30px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
  .card .nm{font-family:var(--display);font-style:italic;font-weight:900;font-size:22px;line-height:.95;text-transform:uppercase;color:var(--text)}
  .card .bl{font-size:12.5px;color:var(--muted);line-height:1.45;flex:1}
  .card .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:auto}
  .card .pr{font:800 16px var(--mono);color:var(--gold)}
  .card .tag{font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;background:rgba(255,255,255,.08);color:var(--muted)}
  .card.owned{box-shadow:inset 0 0 0 1px rgba(61,255,138,.4)}
  .card.owned .pr{color:var(--lime);font-size:13px}
  .card.eq{box-shadow:inset 0 0 0 2px var(--cyan)}
  .card.load{box-shadow:inset 0 0 0 2px var(--gold)}
  /* locked = a blacked-out silhouette with a rim of light: you see the SHAPE, never the detail.
     Greyscale alone just made a muddy blob, so the icon is crushed to pure black and given an
     outline instead, and the name stays readable so you know what you are buying. */
  .card.lock .ic{filter:brightness(0) saturate(0)
    drop-shadow(0 0 1px rgba(255,255,255,.75)) drop-shadow(0 0 3px rgba(255,255,255,.35)) drop-shadow(0 0 14px rgba(39,225,255,.22));
    opacity:.95}
  .card.lock .nm{color:var(--muted)}
  .card.lock .bl{color:var(--dim)}
  .card.lock::after{content:"";position:absolute;inset:0;background:linear-gradient(160deg,rgba(5,5,7,.34),rgba(5,5,7,.6));pointer-events:none}
  .card.lock .ft,.card.lock .lk{position:relative;z-index:2}
  .card .lk{position:absolute;right:10px;top:10px;font-size:15px;opacity:.8;z-index:2}
  .card .how{display:none;font-size:12px;color:var(--text);line-height:1.5;border-top:1px solid var(--line);padding-top:6px;margin-top:2px}
  .card.open .how{display:block}
  .card .how i{display:block;color:var(--cyan);font-style:normal;font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;margin-top:5px}
  .card .how i + span{color:var(--muted)}
  .st-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;background:rgba(5,5,7,.55);box-shadow:inset 0 0 0 1px var(--line)}
  .st-xp{flex:1;min-width:180px;height:8px;background:rgba(255,255,255,.08);position:relative;overflow:hidden}
  .st-xp i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--red),var(--gold));box-shadow:0 0 12px rgba(255,200,61,.5)}
  .st-lv{font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;color:var(--gold);line-height:1}
  /* ---- the in-match arsenal rail ---- */
  #arsBtn{position:fixed;left:16px;z-index:40;width:52px;height:52px;display:none;align-items:center;justify-content:center;
    font-size:23px;background:rgba(10,11,16,.82);box-shadow:inset 0 0 0 1px var(--line2),0 6px 18px rgba(0,0,0,.5);border:0;cursor:pointer;
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px)}
  #arsBtn.on{display:flex}
  #arsBtn:active{transform:scale(.94)}
  #arsBtn i{position:absolute;right:-3px;top:-3px;font:800 10px var(--mono);background:var(--red);padding:2px 4px;font-style:normal}
  #arsRail{position:fixed;left:16px;z-index:40;display:none;flex-direction:column;gap:6px;width:186px}
  #arsRail.on{display:flex}
  #arsRail .hd{font:700 10px var(--mono);letter-spacing:.11em;text-transform:uppercase;color:var(--dim);padding-left:2px}
  .ars-i{position:relative;display:flex;align-items:center;gap:9px;padding:8px 10px;background:rgba(10,11,16,.86);box-shadow:inset 0 0 0 1px var(--line2);
    cursor:pointer;text-align:left;border:0;color:#fff;overflow:hidden;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  .ars-i:hover{background:rgba(26,28,40,.92)}
  .ars-i .ic{font-size:21px}
  .ars-i .tx{min-width:0;flex:1}
  .ars-i .tx b{display:block;font:800 12.5px var(--ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ars-i .tx span{font:700 10px var(--mono);letter-spacing:.07em;color:var(--muted)}
  .ars-i .key{font:800 11px var(--mono);color:var(--dim);padding:2px 5px;box-shadow:inset 0 0 0 1px var(--line)}
  .ars-i.off{opacity:.42;pointer-events:none}
  .ars-i .cdf{position:absolute;inset:auto 0 0 0;height:2px;background:var(--cyan)}
  .ars-empty{padding:9px 10px;font-size:12px;color:var(--muted);background:rgba(10,11,16,.86);box-shadow:inset 0 0 0 1px var(--line)}
  /* ---- profile ---- */
  .pf{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:12px;align-items:start}
  .pf .panel{display:flex;flex-direction:column;gap:10px}
  .pf-big{font-family:var(--display);font-style:italic;font-weight:900;font-size:56px;line-height:.86;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px}
  .pf-stat{padding:9px 10px;background:rgba(5,5,7,.5);box-shadow:inset 0 0 0 1px var(--line)}
  .pf-stat b{display:block;font-family:var(--display);font-style:italic;font-weight:900;font-size:27px;line-height:1;color:var(--text)}
  .pf-stat span{font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .pf-bad{display:flex;flex-wrap:wrap;gap:6px}
  .pf-bad .b{display:flex;align-items:center;gap:6px;padding:5px 10px;font:700 12px var(--ui);background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2)}
  .pf-show{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:6px}
  .pf-show div{padding:9px;background:rgba(5,5,7,.5);box-shadow:inset 0 0 0 1px var(--line);text-align:center}
  .pf-show div .i{font-size:23px}
  .pf-show div b{display:block;font:800 12px var(--ui);margin-top:3px}
  .pf-show div span{font:700 9px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  /* ---- level-up / unlock toast ---- */
  #econToast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:60;display:none;flex-direction:column;gap:5px;align-items:center;
    padding:13px 24px;background:rgba(10,11,16,.93);box-shadow:inset 0 0 0 1px var(--gold),0 10px 30px rgba(0,0,0,.6);pointer-events:none}
  #econToast.on{display:flex;animation:etIn .4s}
  #econToast b{font-family:var(--display);font-style:italic;font-weight:900;font-size:30px;line-height:.9;color:var(--gold);text-transform:uppercase}
  #econToast span{font:700 12px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
  @keyframes etIn{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}
  @media (max-width:760px){.pf{grid-template-columns:1fr}#arsRail{width:158px}}
  `;

  const S = { tab: store.get('storeTab', 'weapons'), open: null, rail: false, built: false };

  function build() {
    if (S.built) return; S.built = true;
    const st = el('style'); st.textContent = css; document.head.appendChild(st);

    // ---- store screen
    const sc = el('section', 'screen solid'); sc.id = 'scStore'; sc.hidden = true;
    sc.innerHTML = `<div class="wrap">
      <div class="st-top">
        <div><div class="eyebrow">Armoury</div><h2 class="h2">The Store</h2></div>
        <div class="row"><button class="btn small" id="stProfile">Profile</button><button class="btn small" id="stBack">Back</button></div>
      </div>
      <div class="st-bar"><span class="st-lv" id="stLv">1</span><span class="sub" style="font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)">Level</span>
        <div class="st-xp"><i id="stXp"></i></div><span id="stXpT" style="font:700 11px var(--mono);color:var(--muted)"></span>
        <span id="stLoad" style="font:700 11px var(--mono);color:var(--gold)"></span></div>
      <p class="st-note" id="stRule"></p>
      <div class="st-tabs" id="stTabs"></div>
      <div id="stBody" style="display:flex;flex-direction:column;gap:22px"></div>
    </div>`;
    document.body.appendChild(sc);

    // ---- profile screen
    const pf = el('section', 'screen solid'); pf.id = 'scProfile'; pf.hidden = true;
    pf.innerHTML = `<div class="wrap">
      <div class="st-top"><div><div class="eyebrow">Record</div><h2 class="h2">Your Profile</h2></div>
        <div class="row"><button class="btn small" id="pfShare">Share a win card</button><button class="btn small" id="pfStore">Store</button><button class="btn small" id="pfBack">Back</button></div></div>
      <div class="pf" id="pfBody"></div>
    </div>`;
    document.body.appendChild(pf);

    // ---- in-match arsenal
    const btn = el('button'); btn.id = 'arsBtn'; btn.title = 'Arsenal (Tab)'; btn.setAttribute('aria-label', 'Arsenal');
    btn.textContent = '🎒'; document.body.appendChild(btn);
    const rail = el('div'); rail.id = 'arsRail'; document.body.appendChild(rail);
    const toast = el('div'); toast.id = 'econToast'; document.body.appendChild(toast);

    byId('stBack').onclick = () => { sfx(); closeStore(); };
    byId('stProfile').onclick = () => { sfx(); showProfile(); };
    byId('pfBack').onclick = () => { sfx(); closeStore(); };
    byId('pfStore').onclick = () => { sfx(); showStore(); };
    byId('pfShare').onclick = () => { sfx(); shareCard(); };
    btn.onclick = e => { e.stopPropagation(); sfx(); toggleRail(); };

    const TABS = [['weapons', 'Weapons'], ['looks', 'Cosmetics'], ['bundles', 'Bundles'], ['arsenal', 'My arsenal']];
    const tb = byId('stTabs');
    for (const [id, label] of TABS) { const b = el('button', S.tab === id ? 'on' : '', label); b.onclick = () => { S.tab = id; store.set('storeTab', id); sfx(); render(); }; b.dataset.t = id; tb.appendChild(b); }

    Econ.on(() => { if (!sc.hidden) render(); if (!pf.hidden) renderProfile(); renderRail(); });
  }

  // ---------------- the store ----------------
  function shelves() {
    const W = Econ.CAT.weapons;
    return [
      { h: 'The $15 shelf', s: 'Cheap, loud, and almost no raw power', items: W.filter(w => w.tier === 15) },
      { h: 'The shadowed shelf', s: '$20 to $50 · unlock one at a time', items: W.filter(w => w.tier > 15 && w.tier < 100) },
      { h: 'The finishers', s: '$100 · one per match, and everyone will know', items: W.filter(w => w.tier === 100) },
    ];
  }
  function priceLine(d) {
    // `unlock` is null for anything the account level never grants for free (89_econ.js:18), so this
    // concatenation printed "UNLOCKED · LVL null" on the Store for five weapons -- Homing Missile,
    // Mole Bomb, Freeze Ray, Sentry Turret and Gravity Well. The card right below already guards the
    // same field; this one did not.
    if (Econ.owns(d.id)) return Econ.S.own[d.id] ? 'OWNED' : (d.unlock != null ? 'UNLOCKED · LVL ' + d.unlock : 'UNLOCKED');
    return M(d.price);
  }
  function card(d, kind) {
    const owned = Econ.owns(d.id);
    const c = el('button', 'card' + (owned ? ' owned' : ' lock') + (S.open === d.id ? ' open' : ''));
    if (kind === 'weapon' && Econ.inLoadout(d.id)) c.classList.add('load');
    if (kind === 'cosmetic' && Econ.equipped(d.slot) === d.id) c.classList.add('eq');
    c.appendChild(el('div', 'ic', d.icon || '❔'));
    c.appendChild(el('div', 'nm', d.name));
    c.appendChild(el('div', 'bl', d.blurb || ''));
    if (d.how) {
      const h = el('div', 'how');
      h.appendChild(el('i', '', 'How it works')); h.appendChild(el('span', '', d.how));
      const wait = kind === 'weapon' ? Econ.delayOf(d.id) : 0;
      if (wait) { h.appendChild(el('i', '', 'Locked at the start')); h.appendChild(el('span', '', 'Cannot be deployed for the first ' + wait + ' seconds of a match.')); }
      if (d.counter) { h.appendChild(el('i', '', 'What beats it')); h.appendChild(el('span', '', d.counter)); }
      c.appendChild(h);
    }
    const ft = el('div', 'ft');
    ft.appendChild(el('span', 'pr', priceLine(d)));
    let act = null;
    if (!owned) act = el('span', 'tag', d.unlock != null ? 'Buy or reach lvl ' + d.unlock : 'Locked');
    else if (kind === 'weapon') act = el('span', 'tag', Econ.inLoadout(d.id) ? 'In your arsenal' : 'Add to arsenal');
    else if (kind === 'cosmetic') act = el('span', 'tag', Econ.equipped(d.slot) === d.id ? 'Equipped' : 'Equip');
    else act = el('span', 'tag', 'Owned');
    ft.appendChild(act);
    c.appendChild(ft);
    if (!owned) c.appendChild(el('div', 'lk', '🔒'));
    // a live swatch of the actual effect on every cosmetic card (8c_cosm.js). An emoji is not a
    // preview, and "I bought it and it does nothing" is the single worst thing this shelf can do.
    if (kind === 'cosmetic' && window.Cosm) { try { Cosm.swatch(c, d); } catch (e) { /* preview only */ } }
    c.onclick = ev => {
      sfx();
      if (ev.shiftKey || !owned) { S.open = S.open === d.id ? null : d.id; if (!owned) return buy(d); render(); return; }
      if (kind === 'weapon') { if (!Econ.toggleLoadout(d.id)) note('Three weapons in the arsenal at a time. Take one out first.'); }
      else if (kind === 'cosmetic') Econ.equip(d.id);
      render();
    };
    return c;
  }
  function buy(d) {
    if (d.price == null) return note('That one is a season prize. It is not for sale.');
    note('Checking out ' + d.name + '…');
    Econ.buy(d.id, r => note(r.msg));
  }
  function render() {
    const body = byId('stBody'); if (!body) return;
    for (const b of byId('stTabs').children) b.className = b.dataset.t === S.tab ? 'on' : '';
    const bar = Econ.xpBar();
    byId('stLv').textContent = String(bar.level);
    byId('stXp').style.width = (bar.pct * 100).toFixed(1) + '%';
    byId('stXpT').textContent = bar.into + ' / ' + bar.need + ' XP';
    byId('stLoad').textContent = 'Arsenal ' + Econ.loadout().length + '/3';
    byId('stRule').innerHTML = Econ.S.synced
      ? 'Everything you own lives on your account, not on this device. <b>Weapons are for casual and party matches only</b> — wagered and ranked matches are items-off or a shared pool both players agreed to, so nobody can buy a win off you. <b>Cosmetics work everywhere, including money matches.</b>'
      : 'Not signed in to online play, so this is the last list your account gave this device. <b>Connect to buy.</b> Weapons are casual-only; cosmetics work everywhere.';
    body.textContent = '';
    if (S.tab === 'weapons') {
      for (const sh of shelves()) {
        const w = el('div', 'shelf');
        w.appendChild(el('h3', '', sh.h)); w.appendChild(el('div', 'sub', sh.s));
        const g = el('div', 'grid'); for (const d of sh.items) g.appendChild(card(d, 'weapon')); w.appendChild(g);
        body.appendChild(w);
      }
      const tip = el('p', 'st-note', 'Tap a locked weapon to buy it. Tap one you own to put it in your arsenal (three at a time). Shift-tap any card for the full breakdown — every weapon in here has something that beats it, and it is printed on the card.');
      body.appendChild(tip);
    } else if (S.tab === 'looks') {
      const names = { finish: ['Weapon finishes', 'Every weapon you pick up, recoloured'], aura: ['Auras', 'A light that follows you'], trail: ['Launch trails', 'The streak you leave when you get sent'], ko: ['KO effects', 'What the screen does when you send someone'], pose: ['Victory poses', 'The thing they have to watch'], plate: ['Name plates', 'Your name, on the HUD and the board'] };
      for (const slot of Econ.SLOTS) {
        const items = Econ.CAT.cosmetics.filter(c => c.slot === slot);
        if (!items.length) continue;
        const w = el('div', 'shelf');
        w.appendChild(el('h3', '', names[slot][0])); w.appendChild(el('div', 'sub', names[slot][1]));
        const g = el('div', 'grid'); for (const d of items) g.appendChild(card(Econ.BYID[d.id], 'cosmetic')); w.appendChild(g);
        body.appendChild(w);
      }
      body.appendChild(el('p', 'st-note', 'None of this changes a hitbox, so all of it is legal in a money match. That is the point: show off all you like, and let the fight stay a fight.'));
    } else if (S.tab === 'bundles') {
      const w = el('div', 'shelf');
      w.appendChild(el('h3', '', 'Bundles')); w.appendChild(el('div', 'sub', 'The same items, cheaper together'));
      const g = el('div', 'grid');
      for (const d of Econ.CAT.bundles) {
        const c = card(Econ.BYID[d.id], 'bundle');
        const list = d.grants.map(id => id === 'ALL_WEAPONS' ? 'every weapon' : (Econ.BYID[id] ? Econ.BYID[id].name : id)).join(', ');
        c.querySelector('.bl').textContent = d.blurb + ' — ' + list + '.';
        g.appendChild(c);
      }
      w.appendChild(g); body.appendChild(w);
    } else {
      body.appendChild(arsenalEditor());
    }
  }

  // ---------------- the arsenal editor (store tab + the lobby button) ----------------
  function arsenalEditor() {
    const w = el('div', 'shelf');
    w.appendChild(el('h3', '', 'My arsenal'));
    w.appendChild(el('div', 'sub', 'Three weapons. Casual and party matches only'));
    const owned = Econ.ownedWeapons();
    if (!owned.length) {
      w.appendChild(el('p', 'st-note', 'You do not own a weapon yet. Play a few matches — Banana Peel unlocks at level 2 and the whole $15 shelf is free by level 10 — or buy one from the Weapons tab.'));
      return w;
    }
    const g = el('div', 'grid');
    for (const d of owned) g.appendChild(card(d, 'weapon'));
    w.appendChild(g);
    w.appendChild(el('p', 'st-note', 'In a local or casual match the arsenal button sits in the top-left corner. Tap it (or press Tab) and pick one — it goes straight into your hands. Seven seconds between deploys, and each weapon has a fixed number of charges per match.'));
    const mode = el('p', 'st-note');
    mode.innerHTML = 'In a <b>wagered or ranked</b> match the button is gone and nothing here is loaded. That rule is enforced by the server, not by this screen.';
    w.appendChild(mode);
    return w;
  }

  // ---------------- the in-match rail ----------------
  function hudSafeTop() { return (typeof window.TB_HUD_SAFE_TOP === 'number' ? window.TB_HUD_SAFE_TOP : 0) || (Game.fighters && Game.fighters.length > 2 ? 16 : 140); }
  function railVisible() {
    if (typeof Game === 'undefined') return false;
    if (Game.state !== 'match' || Game.paused || Game.endT) return false;
    return !!Game.arsenalOn && !!(Game.fighters && Game.fighters[0] && Game.fighters[0].arsenal);
  }
  function toggleRail() { S.rail = !S.rail; renderRail(); }
  function renderRail() {
    const btn = byId('arsBtn'), rail = byId('arsRail');
    if (!btn) return;
    const on = railVisible();
    const top = hudSafeTop();
    btn.style.top = top + 'px';
    rail.style.top = (top + 60) + 'px';
    btn.classList.toggle('on', on);
    if (!on) { rail.classList.remove('on'); S.rail = false; window.TB_ARSENAL_RECT = null; return; }
    window.TB_ARSENAL_RECT = { x: 16, y: top, w: S.rail ? 186 : 52, h: S.rail ? 60 + 52 * 3 : 52 };
    const st = Econ.arsenalState(0);
    const left = st.reduce((a, s) => a + s.left, 0);
    btn.textContent = '🎒';
    if (left) { const i = el('i', '', String(left)); btn.appendChild(i); }
    rail.classList.toggle('on', S.rail);
    if (!S.rail) return;
    rail.textContent = '';
    rail.appendChild(el('div', 'hd', 'Arsenal · 1 2 3'));
    if (!st.length) { rail.appendChild(el('div', 'ars-empty', 'Nothing equipped. Open the Store and put up to three weapons in your arsenal.')); return; }
    st.forEach((s, i) => {
      const b = el('button', 'ars-i' + (s.ready ? '' : ' off'));
      b.appendChild(el('div', 'ic', s.def.icon));
      const tx = el('div', 'tx'); tx.appendChild(el('b', '', s.def.name));
      tx.appendChild(el('span', '', s.wait > 0 ? 'in ' + Math.ceil(s.wait / 60) + 's' : s.left > 0 ? s.left + ' left' : 'spent'));
      b.appendChild(tx);
      b.appendChild(el('div', 'key', String(i + 1)));
      if (s.cd > 0) { const f = el('div', 'cdf'); f.style.width = (100 - s.cd / 420 * 100).toFixed(0) + '%'; b.appendChild(f); }
      b.onclick = ev => { ev.stopPropagation(); deploy(i, 0); };
      rail.appendChild(b);
    });
  }
  function deploy(i, slot) {
    const idx = slot || 0, st = Econ.arsenalState(idx), s = st[i];
    if (!s) return;
    if (!s.ready) { sfx(); return; }
    if (Econ.deploy(s.id, idx)) { sfx('coin'); if (!idx) S.rail = false; }
    renderRail();
  }

  // ---------------- profile ----------------
  function showStore() { build(); byId('scProfile').hidden = true; byId('scStore').hidden = false; if (typeof Game !== 'undefined' && Game.state === 'title') Game.state = 'menu'; render(); }
  function showProfile() { build(); byId('scStore').hidden = true; byId('scProfile').hidden = false; renderProfile(); }
  function closeStore() {
    byId('scStore').hidden = true; byId('scProfile').hidden = true;
    if (typeof UI !== 'undefined' && UI.title && (typeof Game === 'undefined' || Game.state !== 'match')) UI.title();
  }
  function renderProfile() {
    const body = byId('pfBody'); if (!body) return;
    body.textContent = '';
    const N = (typeof Net !== 'undefined' && Net.state) ? Net.state : null;
    const me = N && N.me, prof = me && me.profile;
    const S2 = Econ.S, bar = Econ.xpBar();
    const left = el('div', 'panel');
    left.appendChild(el('div', 'eyebrow', 'Fighter'));
    // the same chain the share card uses (cardName), not a second copy of it. This screen kept its
    // own `|| 'Unnamed'` fallback, so a player with no account -- which is EVERY player on the portal
    // and desktop builds, where there is no online -- opened their profile and read "Unnamed" in
    // 56px chrome type, while the card beside it had already learned to say their fighter's name.
    left.appendChild(el('div', 'pf-big', cardName()));
    const stats = el('div', 'pf-stats');
    const rec = (prof && prof.record) || S2.record;
    // Rating and Season rank are ONLINE numbers, and the portal and desktop builds have no online at
    // all -- so on every one of them this row showed two permanent em dashes, which is the same dead
    // cell the share card used to have. Show what is actually known instead, and drop the season cell
    // entirely rather than print a placeholder. Losses stay here (this is the player's own record
    // screen, not the card they post).
    const rows = [
      [String(bar.level), 'Level'],
      prof && prof.elo != null ? [String(prof.elo), 'Rating'] : [String(((rec && rec.w) || 0) + ((rec && rec.l) || 0)), 'Matches'],
      [String((rec && rec.w) || 0), 'Wins'],
      [String((rec && rec.l) || 0), 'Losses'],
      [String((rec && rec.ko) || 0), 'KOs'],
    ];
    if (S2.season && S2.season.rank) rows.push(['#' + S2.season.rank, 'Season rank']);
    for (const [v, k] of rows) { const d = el('div', 'pf-stat'); d.appendChild(el('b', '', v)); d.appendChild(el('span', '', k)); stats.appendChild(d); }
    left.appendChild(stats);
    const xw = el('div', 'st-bar');
    xw.appendChild(el('span', 'st-lv', String(bar.level)));
    const xb = el('div', 'st-xp'); const xi = el('i'); xi.style.width = (bar.pct * 100).toFixed(1) + '%'; xb.appendChild(xi); xw.appendChild(xb);
    xw.appendChild(el('span', '', bar.into + ' / ' + bar.need + ' XP'));
    left.appendChild(xw);
    left.appendChild(el('div', 'eyebrow', 'Badges'));
    const bd = el('div', 'pf-bad');
    const badges = (S2.badges || []).slice();
    if (bar.level >= 10) badges.push({ icon: '🎖️', name: 'Level ' + bar.level });
    if (S2.season && S2.season.rank && S2.season.rank <= 10) badges.push({ icon: '🔟', name: 'Top 10 · ' + S2.season.id });
    if (!badges.length) bd.appendChild(el('div', 'b', 'No badges yet. Finish a season in the top 100.'));
    for (const b of badges) { const e = el('div', 'b'); e.appendChild(el('span', '', b.icon || '🏅')); e.appendChild(el('span', '', b.name || b.id)); bd.appendChild(e); }
    left.appendChild(bd);

    const right = el('div', 'panel');
    right.appendChild(el('div', 'eyebrow', 'Equipped'));
    const show = el('div', 'pf-show');
    const LBL = { finish: 'Finish', aura: 'Aura', trail: 'Trail', ko: 'KO effect', pose: 'Victory', plate: 'Plate' };
    for (const slot of Econ.SLOTS) {
      const id = Econ.equipped(slot), d = id && Econ.BYID[id];
      const box = el('div');
      box.appendChild(el('div', 'i', d ? d.icon : '·'));
      box.appendChild(el('b', '', d ? d.name : 'None'));
      box.appendChild(el('span', '', LBL[slot]));
      show.appendChild(box);
    }
    right.appendChild(show);
    right.appendChild(el('div', 'eyebrow', 'Arsenal'));
    const ar = el('div', 'pf-show');
    const lo = Econ.loadout();
    if (!lo.length) ar.appendChild(el('div', '', 'Nothing equipped'));
    for (const id of lo) { const d = Econ.BYID[id], box = el('div'); box.appendChild(el('div', 'i', d.icon)); box.appendChild(el('b', '', d.name)); box.appendChild(el('span', '', (d.charges || 1) + ' per match')); ar.appendChild(box); }
    right.appendChild(ar);
    const owned = Econ.ownedWeapons().length, all = Econ.CAT.weapons.length;
    right.appendChild(el('p', 'st-note', `You own ${owned} of ${all} weapons and ${Econ.CAT.cosmetics.filter(c => Econ.owns(c.id)).length} of ${Econ.CAT.cosmetics.length} cosmetics.`));
    const cl = el('div', 'row'); cl.style.justifyContent = 'flex-start';
    const b1 = el('button', 'btn small', 'Clip the last 10 s');
    b1.onclick = () => { sfx(); if (window.Clip && Clip.take) Clip.take(); else note('Clips need a match on screen. Press C during a fight.'); };
    cl.appendChild(b1);
    right.appendChild(cl);
    body.append(left, right);
  }

  // ---------------- share a win card ----------------
  // A 1200x675 PNG with the name, the record, the rank and the game's branding — the thing people
  // actually post. The MP4 clip (81_clip.js, key C) is the other half of the same marketing loop.
  // account name -> the name typed locally -> the name on the fighter they built -> BRAWLER
  function cardName() {
    const N = (typeof Net !== 'undefined' && Net.state) ? Net.state : null, me = N && N.me;
    if (me && me.name) return me.name;
    const local = store.get('netName', '');
    if (local) return local;
    try { const c = store.get('customLook', null); if (c && c.name) return c.name; } catch (e) { /* storage blocked */ }
    return 'BRAWLER';
  }
  // The player's own fighter, for the card. Same source the select screen uses: the transparent
  // cutout when there is one, the portrait jpg otherwise, and null if neither loads — the card then
  // falls back to the flat layout rather than leaving a hole. `lastChar` is written by UI.fight().
  function cardArt(cb) {
    let id = null;
    try { id = store.get('lastChar', null); } catch (e) { /* storage blocked */ }
    if (!id) return cb(null);
    const base = 'assets/' + (typeof ASSET_ID === 'function' ? ASSET_ID(id) : id);
    // one callback, whatever happens: a cached image can be `complete` before onload is attached, and
    // calling back twice would draw and download the card twice.
    let fired = false;
    const hand = im => { if (!fired) { fired = true; cb(im && im.naturalWidth ? im : null); } };
    const jpg = () => { const j = new Image(); j.onload = () => hand(j); j.onerror = () => hand(null); j.src = base + '.jpg'; if (j.complete) hand(j); };
    const im = new Image();
    im.onload = () => hand(im);
    im.onerror = jpg;
    im.src = base + '_cut.webp';
    if (im.complete) hand(im);
    setTimeout(() => hand(null), 4000);   // never leave the button doing nothing
  }
  function shareCard() { cardArt(img => drawCard(img)); }
  function drawCard(img) {
    const N = (typeof Net !== 'undefined' && Net.state) ? Net.state : null, me = N && N.me;
    const W = 1200, H = 675, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#12040a'); bg.addColorStop(0.5, '#05050a'); bg.addColorStop(1, '#04101c');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const r1 = g.createRadialGradient(140, 200, 10, 140, 200, 620); r1.addColorStop(0, 'rgba(255,42,74,.42)'); r1.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r1; g.fillRect(0, 0, W, H);
    const r2 = g.createRadialGradient(W - 140, H - 160, 10, W - 140, H - 160, 620); r2.addColorStop(0, 'rgba(42,107,255,.4)'); r2.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r2; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.strokeRect(30, 30, W - 60, H - 60);
    const chrome = (txt, x, y, size, align) => {
      g.font = `italic 900 ${size}px "Barlow Condensed", Impact, sans-serif`; g.textAlign = align || 'left';
      const gr = g.createLinearGradient(0, y - size * 0.82, 0, y);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.42, '#eef0f5'); gr.addColorStop(0.52, '#8f96a8'); gr.addColorStop(0.6, '#fff'); gr.addColorStop(1, '#c9ced9');
      g.lineWidth = Math.max(3, size / 9); g.strokeStyle = 'rgba(5,5,7,.85)'; g.lineJoin = 'round'; g.strokeText(txt, x, y);
      g.fillStyle = gr; g.fillText(txt, x, y);
    };
    g.font = '700 18px "JetBrains Mono", monospace'; g.fillStyle = '#ff2a4a'; g.textAlign = 'left';
    g.fillText('BRAWL STREET', 70, 110);
    // The name is the biggest thing on the card, and it only ever read `me.name` -- which exists only
    // with an online account. On the portal builds there is no account at all, so EVERY player's card
    // said UNNAMED in 104px type. The profile screen beside it already falls back to `netName`; this
    // uses the same chain and then the creator's fighter name, which is the most personal thing a
    // player who never signed in has. Last resort is BRAWLER, not UNNAMED: this is the one asset that
    // leaves the game, and it should not lead with a blank.
    // WITH the player's fighter, the card becomes two columns: name and a 2x2 of stats on the left,
    // the fighter filling the right. Without it, the original single row across the full width, so a
    // missing asset degrades to exactly what shipped before instead of leaving a hole.
    const art = !!img, LW = art ? 620 : W - 140;
    if (art) {
      // contain inside the right column, anchored to the bottom edge of the frame so the fighter
      // stands on it. Cutouts are portrait, portraits are square; both read correctly this way.
      const bx = 600, by = 78, bw = 1170 - bx, bh = H - 60 - by;
      const s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const dx = bx + (bw - dw) / 2, dy = by + (bh - dh);
      g.save();
      // a soft pool of light under the figure, so it sits on the card instead of floating on it
      const gl = g.createRadialGradient(dx + dw / 2, dy + dh - 10, 6, dx + dw / 2, dy + dh - 10, dw * 0.62);
      gl.addColorStop(0, 'rgba(255,42,74,.34)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gl; g.fillRect(bx - 40, by, bw + 80, bh + 30);
      g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 26; g.shadowOffsetY = 10;
      g.drawImage(img, dx, dy, dw, dh);
      g.restore();
    }
    // the name is the biggest thing here and it has a column to fit in now, so it is measured and
    // stepped down rather than allowed to run under the fighter. 16 characters is the name cap.
    const nm = cardName().toUpperCase();
    let nsz = 104;
    g.font = `italic 900 ${nsz}px "Barlow Condensed", Impact, sans-serif`;
    while (nsz > 44 && g.measureText(nm).width > LW - 70) { nsz -= 4; g.font = `italic 900 ${nsz}px "Barlow Condensed", Impact, sans-serif`; }
    chrome(nm, 70, 230, nsz);
    const bar = Econ.xpBar(), rec = Econ.S.record;
    const elo = me && me.profile && me.profile.elo != null ? String(me.profile.elo) : null;
    // RATING is an online Elo. With no account it drew an em dash -- an empty cell on a card people
    // post. Matches played is local, always real, and never a number to be embarrassed by (losses
    // deliberately do not appear on a shareable card).
    const cells = [['LEVEL', String(bar.level)], elo ? ['RATING', elo] : ['MATCHES', String((rec.w || 0) + (rec.l || 0))],
      ['WINS', String(rec.w || 0)], ['KOS', String(rec.ko || 0)]];
    cells.forEach(([k, v], i) => {
      const x = art ? 70 + (i % 2) * 250 : 70 + i * 250;
      const y = art ? 300 + Math.floor(i / 2) * 140 : 300;
      g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, y, 220, 120);
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.strokeRect(x, y, 220, 120);
      g.font = '700 13px "JetBrains Mono", monospace'; g.fillStyle = '#5d6272'; g.textAlign = 'left'; g.fillText(k, x + 18, y + 32);
      chrome(v, x + 18, y + 100, 58);
    });
    const eq = Econ.SLOTS.map(s => Econ.equipped(s)).filter(Boolean).map(id => Econ.BYID[id]);
    g.font = '700 14px "JetBrains Mono", monospace'; g.fillStyle = '#9398a8'; g.textAlign = 'left';
    g.fillText(eq.length ? eq.map(d => d.icon + ' ' + d.name.toUpperCase()).join('   ') : 'NO COSMETICS EQUIPPED', 70, art ? 596 : 486);
    // bottom RIGHT is where the fighter's feet are now, so with art the mark goes under the left
    // column instead. It read straight across the shoes the first time this was rendered.
    g.font = '700 16px "JetBrains Mono", monospace'; g.fillStyle = '#ffc83d'; g.textAlign = art ? 'left' : 'right';
    g.fillText('brawlstreet.lol/play', art ? 70 : W - 70, art ? 632 : H - 70);
    c.toBlob(b => {
      if (!b) return note('Could not make the card here.');
      const f = new File([b], 'brawl-street-card.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
        navigator.share({ files: [f], title: 'Brawl Street', text: 'My Brawl Street record' }).catch(() => {});
        return;
      }
      const u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = 'brawl-street-card.png'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      note('Card saved. Post it.');
    }, 'image/png');
  }

  // ---------------- toasts + XP ----------------
  let noteT = null;
  function note(msg, big) {
    build();
    const t = byId('econToast'); if (!t) return;
    t.textContent = '';
    if (big) { t.appendChild(el('b', '', big)); t.appendChild(el('span', '', msg)); }
    else t.appendChild(el('span', '', msg));
    t.classList.add('on');
    clearTimeout(noteT); noteT = setTimeout(() => t.classList.remove('on'), big ? 4200 : 2800);
  }
  // XP is awarded from the results screen. Local XP is provisional; the server recomputes it from its
  // own replay and overwrites this the next time the account syncs.
  function awardXp(won) {
    if (typeof Game === 'undefined' || !Game.fighters || !Game.fighters.length) return;
    const me = Game.fighters[0];
    if (!me || me.cpu) return;
    const r = Econ.addXp(Econ.matchXp(me, won), 'match');
    if (!r) return;
    const R = Econ.S.record; R.w = (R.w || 0) + (won ? 1 : 0); R.l = (R.l || 0) + (won ? 0 : 1);
    R.ko = (R.ko || 0) + ((me.stats && me.stats.kos) || 0);
    if (r.levelled) {
      const got = r.unlocked.map(w => w.name).join(', ');
      note(got ? 'Unlocked: ' + got : '+' + r.xp + ' XP', 'Level ' + r.level);
      sfx('coin');
    } else note('+' + r.xp + ' XP');
  }

  // ---------------- wiring ----------------
  function wire() {
    build();
    // title-screen buttons, beside the existing ones
    const row = document.querySelector('#scTitle .row:nth-of-type(2)') || document.querySelector('#scTitle .row');
    const host = byId('bHelp') ? byId('bHelp').parentElement : row;
    if (host && !byId('bStore')) {
      const b = el('button', 'btn', 'Store'); b.id = 'bStore'; b.onclick = () => { sfx(); showStore(); };
      const p = el('button', 'btn', 'Profile'); p.id = 'bProfile'; p.onclick = () => { sfx(); showProfile(); };
      host.insertBefore(b, byId('bHelp')); host.insertBefore(p, byId('bHelp'));
    }
    // results screen: a Store button beside Rematch
    const rr = byId('bRematch');
    if (rr && rr.parentElement && !byId('bResStore')) {
      const b = el('button', 'btn', 'Store'); b.id = 'bResStore'; b.onclick = () => { sfx(); showStore(); };
      rr.parentElement.appendChild(b);
    }
    // keys: Tab opens the rail, 1/2/3 deploy
    addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!byId('scStore').hidden || !byId('scProfile').hidden) { if (e.code === 'Escape') { e.preventDefault(); closeStore(); } return; }
      if (!railVisible()) return;
      if (e.code === 'Tab') { e.preventDefault(); sfx(); toggleRail(); return; }
      const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (n >= 0) { e.preventDefault(); deploy(n, 0); return; }
      // local 2-player on one keyboard: player 2 deploys with 7 8 9
      const n2 = ['Digit7', 'Digit8', 'Digit9'].indexOf(e.code);
      if (n2 >= 0 && Game.fighters[1] && !Game.fighters[1].cpu) { e.preventDefault(); deploy(n2, 1); }
    }, true);
    // close the rail when the fight is clicked
    addEventListener('pointerdown', e => { if (S.rail && !e.target.closest('#arsRail') && !e.target.closest('#arsBtn')) { S.rail = false; renderRail(); } }, true);

    // the arsenal is armed for LOCAL matches here. Online is armed by the server's room state in
    // 77_net.js -> Econ.arm('casual'|'ranked'|'wager'), never by this file.
    if (typeof UI !== 'undefined' && UI.fight) {
      const f0 = UI.fight;
      UI.fight = function () { const r = f0.apply(this, arguments); try { Econ.clearMatchCosmetics(); Econ.arm('local'); renderRail(); } catch (e) { /* never block the fight */ } return r; };
    }
    if (typeof UI !== 'undefined' && UI.showResults) {
      const s0 = UI.showResults;
      UI.showResults = function (w) {
        const r = s0.apply(this, arguments);
        try { if (!Game.arena && !Game.demo) awardXp(!!(w && w === Game.fighters[0])); } catch (e) { /* never block results */ }
        return r;
      };
    }
    setInterval(renderRail, 200);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', wire, { once: true }); else setTimeout(wire, 0);

  window.EconUI = { showStore, showProfile, note, renderRail, shareCard, awardXp };
})();
