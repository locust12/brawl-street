// ===== CPU difficulty: a visible Easy / Medium / Hard choice =====
// Difficulty used to be buried in the controller button — you had to click it to cycle through
// Keys, Touch, Gamepad and only then CPU easy / normal / hard. Nobody found it, and the default
// ("normal", level 5) got much stronger once the CPU learned to block and combo (9/21), so the
// game opened on a CPU players could not beat.
//
// This puts the choice on the fighter-select screen and applies it to every CPU slot at once.
//
// It only chooses WHICH level a CPU slot gets. It never changes what a level does: the level ->
// behaviour formulas in 50_ai.js / 51_ai2.js also drive the seeded bet arena, which must stay
// bit-identical, and the arena sets its own levels. UI only; never touches fight state.
(function () {
  if (typeof document === 'undefined' || typeof UI === 'undefined') return;

  // level each option maps to. The AI scales linearly with level, so the gaps are what matter.
  const LEVELS = [['easy', 'Easy', 1], ['medium', 'Medium', 3], ['hard', 'Hard', 6], ['brutal', 'Brutal', 9]];
  const DEFAULT = 'easy';                       // first impression: a CPU a new player can beat
  const KEY = 'rf_cpu_difficulty';
  const levelOf = id => (LEVELS.find(l => l[0] === id) || LEVELS[0])[2];

  let cur = DEFAULT;
  try { const s = localStorage.getItem(KEY); if (LEVELS.some(l => l[0] === s)) cur = s; } catch (e) {}

  // keep the controller cycle and its labels in step with the new levels, so the two never disagree
  try {
    CTRL_LABEL.cpu1 = 'CPU easy'; CTRL_LABEL.cpu3 = 'CPU medium'; CTRL_LABEL.cpu6 = 'CPU hard'; CTRL_LABEL.cpu9 = 'CPU brutal';
    for (let i = CTRL_CYCLE.length - 1; i >= 0; i--) if (/^cpu\d+$/.test(CTRL_CYCLE[i])) CTRL_CYCLE.splice(i, 1);
    CTRL_CYCLE.push('cpu1', 'cpu3', 'cpu6', 'cpu9');
  } catch (e) {}

  function apply() {
    const lv = levelOf(cur);
    try { for (const s of UI.slots || []) if (s.ctrl === 'cpu') s.level = lv; } catch (e) {}
  }

  const css = `
  #rfDiff{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  #rfDiff .lb{font:700 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  #rfDiff .seg{display:inline-flex;box-shadow:inset 0 0 0 1px var(--line2);background:rgba(5,5,7,.55)}
  #rfDiff button{min-height:38px;padding:0 16px;border:0;cursor:pointer;background:transparent;color:var(--muted);
    font-family:var(--display);font-style:italic;font-weight:900;font-size:17px;letter-spacing:.02em;text-transform:uppercase}
  #rfDiff button:hover{color:#fff;background:rgba(255,255,255,.06)}
  #rfDiff button.on{background:var(--red);color:#fff}
  #rfDiff button[data-d=brutal].on{background:#7a0f22}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function paint(box) {
    box.innerHTML = '<span class="lb">Computer</span><span class="seg">' +
      LEVELS.map(([id, name]) => `<button type="button" data-d="${id}" class="${id === cur ? 'on' : ''}">${name}</button>`).join('') + '</span>';
    box.querySelectorAll('button').forEach(b => b.onclick = e => {
      e.stopPropagation();
      cur = b.dataset.d;
      try { localStorage.setItem(KEY, cur); } catch (err) {}
      apply();
      try { Sfx.ui(); } catch (err) {}
      try { UI.renderSelect(); } catch (err) { paint(box); }
    });
  }

  // re-attach after every select-screen render (renderSelect rebuilds its markup)
  const orig = UI.renderSelect.bind(UI);
  UI.renderSelect = function () {
    apply();                                           // new CPU slots pick up the chosen level
    const r = orig.apply(this, arguments);
    const sc = document.getElementById('scSelect');
    if (sc) {
      const hasCpu = (UI.slots || []).some(s => s.ctrl === 'cpu');
      let box = document.getElementById('rfDiff');
      if (!box) {
        box = document.createElement('div'); box.id = 'rfDiff';
        // 9/22 FIX: this used to look for .selbar / .wrap, which live on the wager screen, not here —
        // so the picker was built detached and never appeared at all. The select screen's top bar is
        // .sel-top .row (beside "+ Add fighter" / "Back"): clear of the heroes, the roster, the specials
        // strip and the footer. Caught by another session measuring the live DOM.
        const bar = sc.querySelector('.sel-top .row') || sc.querySelector('.sel-top');
        if (bar) bar.prepend(box);
      }
      box.hidden = !hasCpu;                            // only shown when there is a CPU to set
      paint(box);
    }
    return r;
  };

  // a CPU added any other way (the + button, quick match, free-for-all) also gets the chosen level
  const origStart = Game.start && Game.start.bind(Game);
  if (origStart) Game.start = function (slots, stageId, stocks, demo, itemsOn, seed) {
    if (!seed && !demo && Array.isArray(slots)) {
      const lv = levelOf(cur);
      for (const s of slots) if (s && s.ctrl === 'cpu' && !s.fixedLevel) s.level = lv;
    }
    return origStart(slots, stageId, stocks, demo, itemsOn, seed);
  };

  window.RF_DIFFICULTY = { get: () => cur, level: () => levelOf(cur), LEVELS };
})();
