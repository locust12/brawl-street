// ===== menus + boot =====
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const CTRL_CYCLE = ['kb1', 'kb2', 'touch', 'pad0', 'pad1', 'cpu3', 'cpu5', 'cpu8'];
const CTRL_LABEL = { kb1: 'Keys: WASD', kb2: 'Keys: arrows', touch: 'Touch', pad0: 'Gamepad 1', pad1: 'Gamepad 2', cpu3: 'CPU easy', cpu5: 'CPU normal', cpu8: 'CPU hard' };
const STAKES = [0, 0.01, 0.05, 0.1, 0.25];
const $ = id => document.getElementById(id);

const UI = {
  slots: [], active: 0, stageId: 'isle', stocks: 3, itemsOn: store.get('items', true), wallets: store.get('wallets', [1, 1, 1, 1]),
  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    const inMatch = !id;
    $('pauseBtn').hidden = !inMatch;
    Touch.visible = inMatch && this.slots.some(s => s.ctrl === 'touch');
    $('touch').hidden = !Touch.visible;
  },
  slotCtrl(s) { return s.ctrl === 'cpu' ? 'cpu' + (s.level || 5) : s.ctrl; },
  setCtrl(s, key) { if (key.startsWith('cpu')) { s.ctrl = 'cpu'; s.level = +key.slice(3); } else { s.ctrl = key; s.level = 0; } },
  startDemo() {
    const CC = coreChars(), a = CC[irand(0, CC.length - 1)], b = CC[irand(0, CC.length - 1)];
    Game.pot = 0; Game.state = 'title';
    Game.start([{ ctrl: 'cpu', char: a.id, level: 7 }, { ctrl: 'cpu', char: b.id, level: 7 }], ['isle', 'isle', 'moon', 'chart', 'miami', 'roof', 'dojo'][irand(0, 6)], 2, true);
  },
  title() { this.startDemo(); this.show('scTitle'); $('walletLine').textContent = 'Your practice wallet: ' + this.wallets[0].toFixed(3) + ' ETH'; },
  toSelect(mode) {
    if (mode) this.slots = mode === 'cpu'
      ? [{ ctrl: IS_TOUCH ? 'touch' : 'kb1', char: 'doge', stake: 0.05 }, { ctrl: 'cpu', level: 5, char: 'pepe', stake: 0.05 }]
      : [{ ctrl: 'kb1', char: 'doge', stake: 0.05 }, { ctrl: 'kb2', char: 'shib', stake: 0.05 }];
    this.active = 0; Game.state = 'menu'; this.show('scSelect'); this.renderSelect();
  },
  renderSelect() {
    const box = $('slots'); box.innerHTML = '';
    this.slots.forEach((s, i) => {
      const c = CHAR_BY_ID[s.char], el = document.createElement('div');
      el.className = 'slot' + (i === this.active ? ' active' : ''); el.style.setProperty('--c', PCOLORS[i]);
      el.innerHTML = `<div class="who"><span class="pn">${s.ctrl === 'cpu' ? 'CPU' : 'P' + (i + 1)}</span><button class="type" id="slotType${i}">${CTRL_LABEL[this.slotCtrl(s)]}</button></div><canvas width="240" height="184"></canvas><div class="nm">${c.name}</div>`;
      el.addEventListener('click', e => {
        if (e.target.classList.contains('type')) {
          const k = CTRL_CYCLE.indexOf(this.slotCtrl(s)), nx = k + 1;
          if (nx >= CTRL_CYCLE.length) { if (i >= 2) { this.slots.splice(i, 1); this.active = 0; } else this.setCtrl(s, CTRL_CYCLE[0]); }
          else this.setCtrl(s, CTRL_CYCLE[nx]);
        } else this.active = i;
        Sfx.ui(); this.renderSelect();
      });
      box.appendChild(el); drawPortrait(el.querySelector('canvas'), c);
      if (window.V3 && V3.loadChar && V3.ready) V3.loadChar(c.id).catch(() => {});
    });
    $('bAddSlot').disabled = this.slots.length >= 4;
    const ro = $('roster');
    if (ro.childElementCount) coreChars().forEach(c => { const cv = ro.querySelector('#pick_' + c.id + ' canvas'); if (cv) drawPortrait(cv, c); });
    if (!ro.childElementCount) coreChars().forEach(c => {
      const b = document.createElement('button'); b.className = 'pick'; b.id = 'pick_' + c.id;
      const bar = v => `<span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
      b.innerHTML = `<canvas width="200" height="200"></canvas><span class="nm">${c.name}</span><span class="st">${c.blurb}</span>
        <span class="stats"><span>Speed</span>${bar((c.walk - 4.5) / 3.4)}<span>Power</span>${bar((c.power - 0.85) / 0.35)}<span>Weight</span>${bar((c.weight - 75) / 50)}</span>`;
      b.addEventListener('click', () => { this.slots[this.active].char = c.id; this.active = (this.active + 1) % this.slots.length; Sfx.ui(); this.renderSelect(); });
      ro.appendChild(b); drawPortrait(b.querySelector('canvas'), c);
    });
  },
  toWager() { this.show('scWager'); this.renderWager(); },
  renderWager() {
    const box = $('wagers'); box.innerHTML = '';
    const humanMax = Math.max(0, ...this.slots.filter(s => s.ctrl !== 'cpu').map(s => s.stake || 0));
    this.slots.forEach((s, i) => {
      const c = CHAR_BY_ID[s.char], cpu = s.ctrl === 'cpu', el = document.createElement('div');
      if (cpu) s.stake = humanMax;
      el.className = 'wcard'; el.style.setProperty('--c', PCOLORS[i]);
      const bal = cpu ? 'House bankroll, matches your stake' : 'Balance ' + this.wallets[i].toFixed(3) + ' ETH';
      el.innerHTML = `<div class="top"><canvas width="112" height="112"></canvas><div><div class="pn">${cpu ? 'CPU' : 'P' + (i + 1)} · ${c.name}</div><div class="bal">${bal}</div></div></div>
        <div class="stakes">${STAKES.map(v => `<button class="stake${s.stake === v ? ' on' : ''}" data-v="${v}" ${cpu || (!cpu && v > this.wallets[i] + 1e-9) ? 'disabled' : ''}>${v ? v + ' Ξ' : 'Free'}</button>`).join('')}</div>
        ${!cpu && this.wallets[i] < 0.01 ? '<button class="btn small refill">Refill 1 practice ETH</button>' : ''}`;
      el.querySelectorAll('.stake').forEach(b => b.addEventListener('click', () => { s.stake = +b.dataset.v; Sfx.coin(); this.renderWager(); }));
      const rf = el.querySelector('.refill'); if (rf) rf.addEventListener('click', () => { this.wallets[i] += 1; store.set('wallets', this.wallets); this.renderWager(); });
      box.appendChild(el); drawPortrait(el.querySelector('canvas'), c, { bare: true });
    });
    const pot = this.slots.reduce((a, s) => a + (s.stake || 0), 0);
    // GUARDED, and this one mattered: the portal build (build_portals.py make_clean) DELETES #potV
    // along with every other money element, so this line threw on null and took the whole rest of
    // renderWager with it -- the stage cards, the lives row and the items row all render BELOW it.
    // Every portal package ever built had an empty "Pick the stage" screen because of one line.
    // Same failure as the SIN Lab: one unguarded getElementById kills everything after it.
    { const pv = $('potV'); if (pv) pv.textContent = pot.toFixed(3) + ' ETH'; }
    const sb = $('stages');
    sb.innerHTML = '';
    // 'keep' was MISSING from this list, and it is one of the five stages CORE_SET ships. Shadow Keep
    // is finished -- it builds, it has its own music theme (12_audio), it errsweeps clean and runs a
    // full match to results -- and no player could ever pick it, because the only way into the stage
    // picker is this array and STAGES_MENU_EXTRA, and it is in neither. The picker showed four cards
    // while stageCount() reported five (runs/flowvis/04_wager_or_stage.jpg).
    for (const [id, name, sub] of [['isle', 'Rune Isle', 'Floating rock island, rune stones, crystals'], ['moon', 'Lava Temple', 'Three floating platforms over molten lava'], ['chart', 'Tropic Dock', 'One wide wooden dock, no hiding'], ['miami', 'Miami Strip', 'Art-deco beachfront at sunset'], ['roof', 'Neon Rooftop', 'Helipad over a city at night'], ['dojo', 'Sakura Dojo', 'Temple floor under falling blossoms'], ['keep', 'Shadow Keep', 'Two lantern-lit gates over fogged stone']]) {
      if (!coreStage(id)) continue;   // 79_core
      const b = document.createElement('button'); b.className = 'stagec' + (this.stageId === id ? ' on' : '');
      b.dataset.stage = id;   // the Random card (85_menu) rolls from whatever is actually on screen
      b.innerHTML = `<canvas width="480" height="240"></canvas><div>${name}<small>${sub}</small></div>`;
      b.addEventListener('click', () => { this.stageId = id; Sfx.ui(); this.renderWager(); });
      sb.appendChild(b);
      this.paintStage(b.querySelector('canvas'), id);
    }
    $('stockPick').innerHTML = [1, 2, 3, 4, 5].map(n => `<button class="stake${n === this.stocks ? ' on' : ''}" data-n="${n}">${n}</button>`).join('');
    $('stockPick').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this.stocks = +b.dataset.n; this.renderWager(); }));
    $('itemPick').innerHTML = [['on', 'Items on'], ['off', 'Items off']].map(([k, l]) => `<button class="stake${(k === 'on') === this.itemsOn ? ' on' : ''}" data-k="${k}">${l}</button>`).join('');
    $('itemPick').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this.itemsOn = b.dataset.k === 'on'; store.set('items', this.itemsOn); Sfx.ui(); this.renderWager(); }));
  },
  fight() {
    // a match with fewer than two fighters used to start anyway: an empty stage, no HUD, no way out (audit 9/22)
    if (this.slots.filter(s => s && s.char).length < 2) { try { Sfx.ui(); } catch (e) {} return; }
    Game.pot = this.slots.reduce((a, s) => a + (s.stake || 0), 0);
    Game.state = 'match';
    // Remember who the human actually plays. `lastChar` was READ in one place (8c_cosm.js:501, the
    // cosmetic preview swatch) and written in none, so every player in every build previewed their
    // auras and trails on DOGE -- including people who have never picked DOGE. One line, and it is
    // here rather than in Game.start because 60_game.js is a SIM file and the sim has no `store`.
    try { const h = this.slots.find(s => s && s.char && s.ctrl !== 'cpu'); if (h) store.set('lastChar', h.char); } catch (e) { /* storage blocked */ }
    Game.start(this.slots, this.stageId, this.stocks, false, this.itemsOn);
    this.show(null); Sfx.unlock();
  },
  showResults(w) {
    const pot = Game.pot;
    this.slots.forEach((s, i) => {
      if (s.ctrl === 'cpu') return;
      this.wallets[i] = Math.max(0, this.wallets[i] - (s.stake || 0) + (Game.fighters[i] === w ? pot : 0));
    });
    store.set('wallets', this.wallets);
    this.show('scResults');
    drawPortrait($('winCv'), w.c);
    $('winName').innerHTML = `<span style="color:${w.color}">${w.cpu ? 'CPU' : 'P' + (w.idx + 1)}</span> ${w.c.name} wins`;
    $('winPay').textContent = pot > 0 ? (w.cpu ? 'House keeps ' : '+') + pot.toFixed(3) + ' ETH (practice)' : '';
    const rows = Game.fighters.map(f => `<tr><td style="color:${f.color}">${f.cpu ? 'CPU' : 'P' + (f.idx + 1)} ${f.c.name}</td><td>${f.stats.kos}</td><td>${f.stats.falls}</td><td>${Math.round(f.stats.dealt)}%</td><td>${Math.round(f.stats.taken)}%</td></tr>`).join('');
    $('resTable').innerHTML = `<thead><tr><th>Player</th><th>KOs</th><th>Falls</th><th>Dealt</th><th>Taken</th></tr></thead><tbody>${rows}</tbody>`;
  },
  loading(p) {
    const chip = $('load3d'); if (!chip) return;
    if (p < 0) { chip.textContent = 'Classic 2D mode'; return; }
    const bar = $('load3dBar'); if (bar) bar.style.width = Math.round(p * 100) + '%';
    if (p >= 1 && bar) { chip.textContent = '3D fighters ready'; chip.style.color = 'var(--lime)'; }
  },
  paintStage(cv, id) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    if (id === 'isle') {
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3a7fd5'); g.addColorStop(0.6, '#bfe3ff'); g.addColorStop(1, '#6aa8d8'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#8a9ab8'; c.beginPath(); c.moveTo(0, H * 0.62); c.lineTo(W * 0.2, H * 0.4); c.lineTo(W * 0.4, H * 0.6); c.lineTo(W * 0.7, H * 0.35); c.lineTo(W, H * 0.6); c.lineTo(W, H); c.lineTo(0, H); c.fill();
      c.fillStyle = '#6a6470'; c.fillRect(W * 0.08, H * 0.22, 36, H * 0.5); c.fillRect(W * 0.86, H * 0.2, 36, H * 0.52);
      c.shadowColor = '#ffd23f'; c.shadowBlur = 12; c.fillStyle = '#ffd23f'; for (const x of [W * 0.08 + 12, W * 0.86 + 12]) { c.fillRect(x, H * 0.3, 10, 40); c.beginPath(); c.moveTo(x - 8, H * 0.32); c.lineTo(x + 5, H * 0.26); c.lineTo(x + 18, H * 0.32); c.fill(); } c.shadowBlur = 0;
      c.fillStyle = '#7a5a3a'; c.beginPath(); c.moveTo(W * 0.14, H * 0.66); c.lineTo(W * 0.86, H * 0.66); c.lineTo(W * 0.7, H * 0.95); c.lineTo(W * 0.3, H * 0.95); c.fill();
      c.fillStyle = '#6ab83a'; c.fillRect(W * 0.13, H * 0.63, W * 0.74, 12);
      for (const [x, col] of [[0.3, '#ff3a6e'], [0.5, '#b04fff'], [0.66, '#2fe6c8']]) { c.fillStyle = col; c.beginPath(); c.moveTo(W * x, H * 0.63); c.lineTo(W * x + 8, H * 0.5); c.lineTo(W * x + 16, H * 0.63); c.fill(); }
      c.fillStyle = '#6ab83a'; for (const x of [0.24, 0.62]) c.fillRect(W * x, H * 0.46, W * 0.14, 7);
    } else if (id === 'roof') {
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#05040f'); g.addColorStop(0.7, '#1a0a3a'); g.addColorStop(1, '#3a0a4a'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 14; i++) { const x = i * W / 14, h = H * (0.3 + ((i * 37) % 10) / 16); c.fillStyle = '#0c0a1e'; c.fillRect(x, H - h, W / 14 - 4, h); c.fillStyle = 'rgba(255,210,120,.5)'; for (let y = H - h + 6; y < H - 8; y += 10) for (let xx = x + 4; xx < x + W / 14 - 8; xx += 8) if ((xx * y) % 7 < 3) c.fillRect(xx, y, 3, 4); }
      c.shadowBlur = 18; c.shadowColor = '#ff4fd8'; c.fillStyle = '#ff4fd8'; c.font = 'bold 26px Bungee, Impact'; c.fillText('PUMP', W * 0.18, H * 0.3); c.shadowColor = '#22e6ff'; c.fillStyle = '#22e6ff'; c.fillText('HODL', W * 0.66, H * 0.24); c.shadowBlur = 0;
      c.fillStyle = '#2a2a34'; c.fillRect(W * 0.1, H * 0.7, W * 0.8, 18); c.fillStyle = '#ffd23f'; c.fillRect(W * 0.47, H * 0.7, 20, 4);
    } else if (id === 'dojo') {
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ff9a6a'); g.addColorStop(0.6, '#ffd0a0'); g.addColorStop(1, '#8a5a8a'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#6a4a7a'; c.beginPath(); c.moveTo(0, H * 0.7); c.lineTo(W * 0.25, H * 0.35); c.lineTo(W * 0.5, H * 0.65); c.lineTo(W * 0.75, H * 0.3); c.lineTo(W, H * 0.6); c.lineTo(W, H); c.lineTo(0, H); c.fill();
      c.fillStyle = '#c8202a'; c.fillRect(W * 0.2, H * 0.35, 10, H * 0.35); c.fillRect(W * 0.3, H * 0.35, 10, H * 0.35); c.fillRect(W * 0.17, H * 0.33, W * 0.16, 8);
      c.fillStyle = '#ff9ac8'; for (let i = 0; i < 40; i++) { c.beginPath(); c.arc((i * 97) % W, (i * 53) % H, 3, 0, 7); c.fill(); }
      c.fillStyle = '#7a4a2a'; c.fillRect(W * 0.12, H * 0.7, W * 0.76, 16);
    } else if (id === 'miami') {
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a1440'); g.addColorStop(0.45, '#ff5f6d'); g.addColorStop(0.7, '#ffb36b'); g.addColorStop(1, '#1b2a4a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#ffd98a'; c.beginPath(); c.arc(W * 0.5, H * 0.46, 38, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(0, H * 0.52, W, H * 0.06);
      c.fillStyle = '#f6efe4'; for (const [x, w, h] of [[0.08, 62, 0.34], [0.74, 70, 0.4], [0.3, 46, 0.26]]) c.fillRect(W * x, H * (0.62 - h), w, H * h);
      c.strokeStyle = '#4de3ff'; c.lineWidth = 3; c.shadowColor = '#4de3ff'; c.shadowBlur = 14;
      for (const [x, w, h] of [[0.08, 62, 0.34], [0.74, 70, 0.4], [0.3, 46, 0.26]]) { c.beginPath(); c.moveTo(W * x, H * (0.62 - h) + 6); c.lineTo(W * x + w, H * (0.62 - h) + 6); c.stroke(); }
      c.shadowColor = '#ff4fa3'; c.strokeStyle = '#ff4fa3';
      for (const [x, w, h] of [[0.08, 62, 0.34], [0.74, 70, 0.4]]) { c.beginPath(); c.moveTo(W * x, H * 0.6); c.lineTo(W * x + w, H * 0.6); c.stroke(); }
      c.shadowBlur = 0;
      c.strokeStyle = '#2f8f6a'; c.lineWidth = 5;
      for (const x of [0.2, 0.64]) { c.beginPath(); c.moveTo(W * x, H * 0.62); c.lineTo(W * x, H * 0.4); c.stroke();
        c.fillStyle = '#2f8f6a'; for (const d of [-1, 1]) { c.beginPath(); c.ellipse(W * x + d * 16, H * 0.4, 18, 7, d * 0.5, 0, 7); c.fill(); } }
      c.fillStyle = '#20263c'; c.fillRect(0, H * 0.64, W, H * 0.36);
      c.fillStyle = 'rgba(255,79,163,.35)'; c.fillRect(0, H * 0.66, W, 4);
    } else if (id === 'chart') {
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2c8fe6'); g.addColorStop(0.55, '#bfeaff'); g.addColorStop(0.56, '#17b3c0'); g.addColorStop(1, '#0a5a88');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#fff4c8'; c.beginPath(); c.arc(W * 0.82, H * 0.2, 22, 0, 7); c.fill();
      c.fillStyle = '#f1d9a0'; c.beginPath(); c.ellipse(W * 0.4, H * 0.56, W * 0.34, 16, 0, 0, 7); c.fill();
      c.strokeStyle = '#6b4a2b'; c.lineWidth = 5; for (const x of [W * 0.28, W * 0.36, W * 0.5]) { c.beginPath(); c.moveTo(x, H * 0.56); c.quadraticCurveTo(x + 10, H * 0.35, x + 26, H * 0.28); c.stroke(); c.fillStyle = '#2f9e44'; c.beginPath(); c.ellipse(x + 26, H * 0.28, 26, 8, 0.3, 0, 7); c.fill(); }
      c.fillStyle = '#8a5a32'; c.fillRect(W * 0.12, H * 0.66, W * 0.76, 14); c.fillStyle = '#5a3a1e'; for (let x = W * 0.14; x < W * 0.88; x += 42) c.fillRect(x, H * 0.66 + 14, 8, 50);
    } else {
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#12040a'); g.addColorStop(0.6, '#5a1a0c'); g.addColorStop(1, '#ff6a1a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(40,20,16,.9)'; for (let x = 20; x < W; x += 70) c.fillRect(x, 0, 26, H * 0.8);
      c.strokeStyle = '#ffa21a'; c.lineWidth = 6; c.shadowColor = '#ff8a1a'; c.shadowBlur = 20; c.beginPath(); c.arc(W / 2, H * 0.3, 34, 0, 7); c.stroke();
      c.fillStyle = '#ffa21a'; c.font = 'bold 40px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.fillText('Ð', W / 2, H * 0.3 + 15); c.shadowBlur = 0;
      c.fillStyle = '#4a3a34'; c.fillRect(W * 0.14, H * 0.66, W * 0.72, 16); c.fillStyle = '#ffb347'; c.fillRect(W * 0.14, H * 0.66 + 14, W * 0.72, 3);
      c.fillStyle = '#4a3a34'; for (const [x, y] of [[0.24, 0.48], [0.62, 0.48], [0.43, 0.34]]) c.fillRect(W * x, H * y, W * 0.14, 7);
    }
  },
  onPause(p) { $('pauseBtn').textContent = p ? '▶' : 'II'; if (this.quitBtn) this.quitBtn.hidden = !p; },
  quit() { Game.paused = false; this.onPause(false); this.title(); },
};

function boot() {
  R.init(); setupTouch();
  loadPortraits(() => { if (!$('scSelect').hidden) UI.renderSelect(); });
  const q = document.createElement('button'); q.id = 'quitBtn'; q.className = 'btn small'; q.textContent = 'Quit match'; q.hidden = true;
  q.style.cssText = 'position:fixed;left:50%;top:60%;transform:translateX(-50%);z-index:6'; document.body.appendChild(q); UI.quitBtn = q;
  q.addEventListener('click', () => UI.quit());
  addEventListener('keydown', e => { if (e.code === 'KeyQ' && Game.paused) UI.quit(); });
  $('bArena').onclick = () => { Sfx.ui(); Arena.enter(); };
  for (const id of ['aBack', 'aLeaveLive', 'rLeave']) $(id).onclick = () => Arena.leave();
  $('bCpu').onclick = () => { Sfx.ui(); UI.toSelect('cpu'); };
  $('bVs').onclick = () => { Sfx.ui(); UI.toSelect('vs'); };
  $('bHelp').onclick = () => UI.show('scHelp');
  $('bHelpBack').onclick = () => UI.show('scTitle');
  $('bSelBack').onclick = () => UI.title();
  $('bAddSlot').onclick = () => { if (UI.slots.length < 4) { UI.slots.push({ ctrl: 'cpu', level: 5, char: coreChars()[irand(0, Math.min(5, coreChars().length - 1))].id, stake: 0 }); UI.renderSelect(); } };
  $('bToWager').onclick = () => { Sfx.ui(); UI.toWager(); };
  $('bWagBack').onclick = () => UI.toSelect();
  $('bFight').onclick = () => UI.fight();
  $('bRematch').onclick = () => UI.fight();
  $('bReselect').onclick = () => UI.toSelect();
  $('bResTitle').onclick = () => UI.title();
  $('pauseBtn').onclick = () => Game.togglePause();
  UI.title();
  if (location.hash.startsWith('#arena')) Arena.enter();
  // dev: #demo:<stage> jumps straight into a CPU match (used for render checks)
  if (location.hash.startsWith('#demo')) {
    const st = location.hash.split(':')[1] || 'moon';
    const cast = (location.hash.split(':')[2] || 'doge,pepe,bonk,pengu').split(',');
    UI.slots = cast.map(c => ({ ctrl: 'cpu', char: c, level: 8 }));
    Game.state = 'match'; Game.start(UI.slots, st, 3, false); Game.countdown = 0; UI.show(null);
    if (location.hash.includes(':kit')) {
      const F = Game.fighters; F[0].item = { kind: 'blade' }; if (F[1]) F[1].item = { kind: 'raygun', ammo: 16 }; if (F[2]) { F[2].hammerT = 600; F[2].setState('hammer'); } if (F[3]) { F[3].powerT = 900; F[3].finalReady = true; }
      Items.spawn('moonball'); Items.spawn('bomb'); Items.spawn('pill'); Items.spawn('heart');
    }
  }
  let acc = 0, last = performance.now();
  // One exception used to stop this loop for good (the next frame was never scheduled): a frozen picture
  // with no error on screen. The frame is now scheduled first and each unique error is logged once.
  const seenErr = new Set();
  const loop = now => {
    requestAnimationFrame(loop);
    try {
      acc += Math.min(100, now - last); last = now;
      if (Arena.active) { Arena.frame(); acc = 0; }
      else if (typeof Net !== 'undefined' && Net.active) { Net.frame(now); acc = 0; }   // online lockstep (77_net.js)
      else { let n = 0; while (acc >= 1000 / 60 && n < 5) { Game.step(); acc -= 1000 / 60; n++; } }
      // how far between the last two sim steps this frame is drawn (99_v3_finish interpolates positions;
      // online and the arena step on their own clocks, so they draw the latest state as before)
      window.TB_ALPHA = (Arena.active || (typeof Net !== 'undefined' && Net.active)) ? 1 : Math.min(1, acc / (1000 / 60));
      R.frame();
    } catch (e) {
      const k = String(e && e.stack || e).slice(0, 300);
      if (!seenErr.has(k)) { seenErr.add(k); console.error('[loop]', e); (window.TB_ERRORS = window.TB_ERRORS || []).push(k); }
    }
  };
  requestAnimationFrame(loop);
}
boot();
