// ===== training mode (Duane's master directive, phase 26) =====
// There was no way to practise anything, and no way for ME to check a move without running a whole
// CPU match and hoping the situation came up. This is a real lab: you pick a fighter, the opponent is
// a dummy you configure, stocks never run out, and everything the sim knows about the current frame is
// on screen.
//
// Page only. It never joins SIM_FILES (build.py's literal list plus src/2x_*.js), it only ever writes
// fight state that a local unseeded match already allows, and every hook it installs checks TRAIN.on
// first -- so the bet arena and online cannot reach any of it. Proof: detcheck / guard stay green.
//
// The DI readout is the point of the panel as much as the dummy is. The directive asks for DI to be
// learnable and "not invisible magic": here you can see, live, the angle your hold actually bought.
(function () {
  const TRAIN = window.TRAIN = {
    on: false, dummy: 'stand', level: 5, dmg: 0, boxes: false, infinite: true,
    lastDI: null, lastKB: null,
  };
  const DUMMIES = [['stand', 'Stand still'], ['block', 'Hold shield'], ['dodge', 'Dodge'], ['jump', 'Jump'], ['cpu', 'Fight back']];

  const css = `
  /* top:60 sat straight on the P1 damage readout and cut it in half (runs/train2/02_training.jpg);
     the HUD's left block runs to about 115px, so the lab starts below it and is capped so a short
     laptop window scrolls the panel instead of pushing it off the bottom */
  #trPanel{position:fixed;left:10px;top:120px;z-index:6;width:212px;max-height:calc(100vh - 176px);overflow:auto;padding:10px 11px;background:rgba(10,11,17,.9);color:var(--text);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);font-family:var(--mono);font-size:11px;line-height:1.5;
    clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
  #trPanel[hidden]{display:none}
  #trPanel h3{margin:0 0 6px;font-family:var(--display);font-style:italic;font-weight:900;font-size:18px;letter-spacing:.02em}
  #trPanel .row{display:flex;justify-content:space-between;gap:8px;padding:2px 0}
  #trPanel .row b{color:var(--cyan);font-weight:700}
  #trPanel .seg{display:flex;flex-wrap:wrap;gap:3px;margin:4px 0 7px}
  #trPanel .seg button{flex:1 1 auto;padding:3px 5px;border:0;cursor:pointer;background:rgba(255,255,255,.07);color:var(--text);
    font-family:var(--mono);font-size:10px;letter-spacing:.04em}
  #trPanel .seg button.on{background:var(--red);color:#fff}
  #trPanel .lbl{color:var(--muted);letter-spacing:.1em;text-transform:uppercase;font-size:9px;margin-top:7px}
  #trPanel .keys{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.1);color:var(--muted);font-size:10px}
  #trPanel .di{color:var(--gold,#ffc83a)}
  #trToggle{position:fixed;left:10px;top:120px;z-index:6;padding:4px 9px;border:0;cursor:pointer;background:rgba(10,11,17,.85);
    color:var(--text);font-family:var(--mono);font-size:10px;letter-spacing:.1em}
  #trToggle[hidden]{display:none}
  @media (max-width:640px){#trPanel,#trToggle{width:auto;max-width:166px;font-size:10px;top:104px}
    #trPanel{padding:7px 9px} #trPanel h3{font-size:15px}}
  /* a phone held sideways is only ~390 tall: at the desktop sizes the panel ran off the bottom and the
     readouts, both option buttons and the key hints were all below the fold (runs/trmob). Everything
     tightens and the key hints go, so the whole lab fits above the Controls chip without scrolling. */
  @media (max-height:600px){#trPanel{top:70px;width:196px;max-height:calc(100vh - 136px);padding:6px 8px;font-size:10px;line-height:1.3}
    #trPanel h3{font-size:14px;margin-bottom:4px}
    /* the section labels go too: five buttons reading "Stand still / Hold shield / Dodge / Jump /
       Fight back" and a row of 0/50/100/150 need no captions, and the 20px they cost is what pushed
       the option row down onto the Controls chip */
    #trPanel .lbl{display:none}
    #trPanel .seg{margin:3px 0 5px} #trPanel .seg button{padding:2px 3px;font-size:8px}
    #trPanel #trDummy{flex-wrap:nowrap}
    /* the six readouts pair up two to a line: at one per line they alone were 100px of a 242px budget
       and Last KB, Last DI and both option buttons sat below the fold (runs/trmob2) */
    #trPanel .row{display:inline-flex;width:49%;padding:0 6px 0 0;box-sizing:border-box;vertical-align:top}
    #trPanel .keys{display:none}
    #trToggle{top:70px}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  let panel = null, btn = null, open = true;
  function build() {
    if (panel) return;
    panel = document.createElement('div'); panel.id = 'trPanel'; panel.hidden = true;
    panel.innerHTML =
      '<h3>Training</h3>' +
      '<div class="lbl">Dummy</div><div class="seg" id="trDummy"></div>' +
      '<div class="lbl">Dummy damage</div><div class="seg" id="trDmg"></div>' +
      '<div class="row"><span>Your %</span><b id="trP1">0</b></div>' +
      '<div class="row"><span>Dummy %</span><b id="trP2">0</b></div>' +
      '<div class="row"><span>State</span><b id="trSt">-</b></div>' +
      '<div class="row"><span>Combo</span><b id="trCb">0</b></div>' +
      '<div class="row"><span>Last KB</span><b id="trKb">-</b></div>' +
      '<div class="row"><span>Last DI</span><b class="di" id="trDi">-</b></div>' +
      '<div class="seg" id="trOpts"></div>' +
      '<div class="keys">Z reset · B hitboxes · X panel</div>';
    document.body.appendChild(panel);
    btn = document.createElement('button'); btn.id = 'trToggle'; btn.hidden = true; btn.textContent = 'TRAINING';
    btn.addEventListener('click', () => { open = true; sync(); });
    document.body.appendChild(btn);

    const seg = (host, list, get, set) => {
      const h = panel.querySelector(host);
      list.forEach(([v, label]) => {
        const b = document.createElement('button'); b.textContent = label; b.dataset.v = v;
        b.addEventListener('click', () => { set(v); paint(); });
        h.appendChild(b);
      });
      h._get = get;
    };
    seg('#trDummy', DUMMIES, () => TRAIN.dummy, v => { TRAIN.dummy = v; applyDummy(); });
    seg('#trDmg', [['0', '0%'], ['50', '50'], ['100', '100'], ['150', '150']], () => String(TRAIN.dmg), v => { TRAIN.dmg = +v; setDummyDmg(); });
    seg('#trOpts', [['boxes', 'Hitboxes'], ['close', 'Hide']], () => '', v => {
      if (v === 'boxes') { TRAIN.boxes = window.V3 && V3.hitboxes ? V3.hitboxes() : !TRAIN.boxes; }
      else { open = false; sync(); }
    });
  }
  function paint() {
    if (!panel) return;
    for (const host of ['#trDummy', '#trDmg']) {
      const h = panel.querySelector(host); if (!h || !h._get) continue;
      const cur = h._get();
      h.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === cur));
    }
    const o = panel.querySelector('#trOpts');
    if (o) o.querySelectorAll('button').forEach(b => { if (b.dataset.v === 'boxes') b.classList.toggle('on', !!TRAIN.boxes); });
  }
  function sync() {
    if (!panel) return;
    const show = TRAIN.on && Game.state === 'match';
    panel.hidden = !(show && open);
    btn.hidden = !(show && !open);
  }

  const me = () => Game.fighters && Game.fighters[0];
  const dummy = () => Game.fighters && Game.fighters[1];
  function setDummyDmg() { const d = dummy(); if (d) d.dmg = TRAIN.dmg; }
  function applyDummy() {
    const d = dummy(); if (!d) return;
    d.cpu = TRAIN.dummy === 'cpu';
    d.level = TRAIN.level;
    // the non-CPU behaviours are driven by feeding the dummy's own input object each frame, which is
    // exactly what a pad would do -- no special fighter states, so nothing here can desync the sim
  }
  function driveDummy() {
    const d = dummy(); if (!d || d.cpu) return;
    const i = d.in; if (!i) return;
    for (const k of ['left', 'right', 'up', 'down', 'a', 'b', 'shield', 'grab', 'jump']) if (k in i) i[k] = false;
    const m = me();
    if (TRAIN.dummy === 'block' && 'shield' in i) i.shield = true;
    else if (TRAIN.dummy === 'jump') { if (!d.air && (Game.frame % 40) === 0 && 'jump' in i) i.jump = true; }
    else if (TRAIN.dummy === 'dodge') {
      // roll away from you once a second, so spacing and whiff punishment can actually be practised
      if (!d.air && (Game.frame % 60) === 0 && 'shield' in i) { i.shield = true; if (m) { if (m.x < d.x) i.right = true; else i.left = true; } }
    }
  }
  function reset() {
    const st = Game.stage, M = st && st.main; if (!M) return;
    const mid = (M.x0 + M.x1) / 2, a = me(), d = dummy();
    for (const [f, dx] of [[a, -110], [d, 110]]) {
      if (!f) continue;
      f.x = mid + dx; f.y = M.top; f.vx = 0; f.vy = 0; f.air = false; f.plat = null;
      f.hitstun = 0; f.hitlag = 0; f.tumble = false; f.move = null; f.invuln = 0;
      f.face = dx < 0 ? 1 : -1;
      try { f.setState('ground'); } catch (e) {}
    }
    if (a) a.dmg = 0;
    setDummyDmg();
    TRAIN.lastDI = null; TRAIN.lastKB = null;
  }
  TRAIN.reset = reset;

  // ---- hooks. Every one returns immediately unless training is on. ----
  const step0 = Game.step;
  Game.step = function () {
    if (TRAIN.on && this.state === 'match') driveDummy();
    const r = step0.apply(this, arguments);
    if (TRAIN.on && this.state === 'match') readout();
    return r;
  };
  const ko0 = Game.ko;
  Game.ko = function (f) {
    if (!TRAIN.on || !TRAIN.infinite) return ko0.apply(this, arguments);
    f.stocks++;                       // give it straight back: a training match never ends
    const r = ko0.apply(this, arguments);
    return r;
  };
  // the DI readout: 41_combat sets diT on a launch it actually rotated
  const th0 = Fighter.prototype.takeHit;
  Fighter.prototype.takeHit = function (hb, att) {
    const before = this.dmg;
    const kb = th0.apply(this, arguments);
    if (TRAIN.on && this === dummy()) {
      TRAIN.lastKB = Math.round(kb);
      // the DEGREES the hold bought, not the resulting angle: that is the number you can learn from,
      // and it reads 0 when you held into the launch, which is the lesson
      TRAIN.lastDI = this.diDeg ? Math.round(this.diDeg * 10) / 10 : 0;
    }
    return kb;
  };

  let rT = 0;
  function readout() {
    if (!panel || panel.hidden) return;
    if (++rT % 4) return;                       // 15 Hz is plenty for a text panel
    const a = me(), d = dummy(); if (!a || !d) return;
    const q = id => panel.querySelector(id);
    q('#trP1').textContent = Math.round(a.dmg) + '%';
    q('#trP2').textContent = Math.round(d.dmg) + '%';
    q('#trSt').textContent = a.state + (a.move && a.move.def && a.move.def.name ? ' · ' + a.move.def.name : '');
    q('#trCb').textContent = (window.COMBO && COMBO.cur && COMBO.cur(a) != null) ? COMBO.cur(a) : (a.stats && a.stats.combo) || 0;
    q('#trKb').textContent = TRAIN.lastKB == null ? '-' : TRAIN.lastKB;
    q('#trDi').textContent = TRAIN.lastDI == null ? '-' : (TRAIN.lastDI > 0 ? '+' : '') + TRAIN.lastDI + '°';
  }

  addEventListener('keydown', e => {
    if (!TRAIN.on || Game.state !== 'match') return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    // Z / X / B, because R, T and H are all GAME controls for player 1 (10_core KEYMAPS kb1:
    // R = grapple, T = smash, H = shield). Binding the lab to them meant that in training -- the one
    // mode where you are deliberately mashing every button to see what it does -- grappling reset the
    // match, smashing hid the panel and shielding flipped the hitbox view.
    if (e.key === 'z' || e.key === 'Z') { reset(); e.preventDefault(); }
    else if (e.key === 'x' || e.key === 'X') { open = !open; sync(); }
    else if (e.key === 'b' || e.key === 'B') { TRAIN.boxes = window.V3 && V3.hitboxes ? true : TRAIN.boxes; setTimeout(paint, 0); }
  });

  TRAIN.start = function (charId, stage) {
    build();
    TRAIN.on = true; TRAIN.lastDI = null; TRAIN.lastKB = null;
    const slots = [
      { ctrl: (window.IS_TOUCH ? 'touch' : 'kb1'), char: charId || 'doge', stake: 0 },
      { ctrl: 'cpu', char: 'pepe', level: TRAIN.level, stake: 0 },
    ];
    // the order UI.fight() uses, and it matters: state first, then start, then hide the menu. Setting
    // only Game.start left the title screen up and the watchdog below tore training straight back down
    // (state read back as 'title', panel hidden, the ko hook never ran -- runs/train1).
    UI.slots = slots; Game.pot = 0;
    Game.state = 'match';
    Game.start(slots, stage || 'dojo', 99, false, false);
    Game.countdown = 0;
    Game.timeLimit = 0;                       // 0 = no clock (60_game line 89 guards on it)
    UI.show(null);
    try { Sfx.unlock(); } catch (e) {}
    applyDummy(); setDummyDmg();
    setTimeout(() => { reset(); paint(); sync(); }, 60);
  };
  TRAIN.stop = function () { TRAIN.on = false; sync(); };

  // leaving the match tears the panel down with it
  const end0 = UI.showResults;
  if (typeof end0 === 'function') UI.showResults = function () { if (TRAIN.on) TRAIN.stop(); return end0.apply(this, arguments); };
  setInterval(() => { if (TRAIN.on && Game.state !== 'match') TRAIN.stop(); }, 500);
})();
