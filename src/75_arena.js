// ===== bet arena: bots fight, people bet on who wins =====
// Parimutuel per currency: each currency's pool splits between the two sides, winners share the
// losing side pro rata. The round's fight is seeded, so every screen shows the same fight and
// anyone can replay it. Where the rounds come from is a "house": PracticeHouse runs them in the
// browser with a practice crowd; ChainHouse (76_chain.js) reads them from the contract.
// USDT is its own slot, not a relabel of the stable one: on Ethereum both USDC and USDT exist and
// people hold different ones, so a chain can offer either or both. A config that lists only one of
// them simply never shows the other (ChainHouse.curs(), 76_chain.js).
const CURS = ['ETH', 'USDC', 'USDT'];
const CUR_AMTS = { ETH: [0.005, 0.01, 0.05, 0.1], USDC: [5, 10, 50, 100], USDT: [5, 10, 50, 100] };
const FAST = typeof location !== 'undefined' && /fast/.test(location.hash);   // dev: #arena:fast shortens the windows for tests
// Round pacing. Measured 2026-10-13: the fight itself is ~74s (2 stocks, ARENA.limit 2:30 in
// 62_rules.js), and the old 30s betting window plus 9s results made the round ~121s, so under
// 60% of it was anyone actually fighting. Every round is a betting event, so rounds per hour is
// revenue: 15/5 takes the round to ~102s without touching the fight.
const BET_SECS = FAST ? 6 : 15, LOCK_SECS = 3, RESULT_SECS = FAST ? 4 : 5;
const SIDE_COL = [PCOLORS[0], PCOLORS[1]];

function fmtAmt(cur, v) {
  if (cur === 'ETH') return Math.abs(v) < 0.1 ? v.toFixed(4) : v.toFixed(3);
  return v.toFixed(2);
}
const CUR_NAME = { ETH: 'ETH', USDC: 'USDC', USDT: 'USDT' };   // the USDC slot is relabelled from live.json (e.g. USDG)
const withCur = (cur, v) => fmtAmt(cur, v) + ' ' + CUR_NAME[cur];
const signed = (cur, v) => (v > 0 ? '+' : v < 0 ? '−' : '') + withCur(cur, Math.abs(v));
const blankPools = () => ({ ETH: [0, 0], USDC: [0, 0], USDT: [0, 0] });
function hexSeed() {
  const b = new Uint8Array(32);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (let i = 0; i < 32; i++) b[i] = Math.random() * 256 | 0;
  return '0x' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
// What one wallet collects in one currency once the winner is known (mirrors RektArena.claim)
function claimAmount(pools, mine, w, cutBps) {
  const W = pools[w - 1], L = pools[2 - w], mw = mine[w - 1], ml = mine[2 - w];
  if (!W) return ml;
  return mw + mw * L * (10000 - cutBps) / 10000 / W;
}
function payMult(pools, side, cutBps) {
  const P = pools[side - 1], O = pools[2 - side];
  return P > 0 ? (P + O * (10000 - cutBps) / 10000) / P : 0;
}
// test-fight record from the headless sweep (arena/stats_v1.json, embedded at build time)
const formPct = i => (typeof ARENA_FORM !== 'undefined' && ARENA_FORM.pct[i]) || 50;
const h2h = (a, b) => (typeof ARENA_FORM !== 'undefined' ? [ARENA_FORM.h2h[a][b], ARENA_FORM.h2h[b][a]] : [0, 0]);

const PracticeHouse = {
  mode: 'practice', label: 'Practice', r: null,
  init() {
    this.bal = Object.assign({ ETH: 1, USDC: 500, USDT: 500 }, store.get('arenaBal', {}));
    this.n = store.get('arenaRound', 0);
  },
  save() { store.set('arenaBal', this.bal); store.set('arenaRound', this.n); },
  open(now) {
    const n = ARENA.roster.length, a = Math.floor(Math.random() * n);
    let b = Math.floor(Math.random() * (n - 1)); if (b >= a) b++;
    const r = { id: ++this.n, a, b, stage: Math.floor(Math.random() * ARENA.stages.length), version: ARENA.version,
      lockAt: now + BET_SECS * 1000, fightAt: 0, seed: null, status: 'open', cutBps: 0, pools: blankPools(), mine: blankPools(), crowd: [] };
    // the practice crowd leans toward whoever has the better test-fight record, with noise
    const lean = clamp(0.5 + (formPct(a) - formPct(b)) / 60 + (Math.random() - 0.5) * 0.35, 0.18, 0.82);
    const k = 14 + Math.floor(Math.random() * 20);
    for (let i = 0; i < k; i++) {
      const u = Math.random(), cur = u < 0.34 ? 'ETH' : u < 0.67 ? 'USDC' : 'USDT', [lo, , , hi] = CUR_AMTS[cur];
      const amt = lo * Math.pow(hi * 1.5 / lo, Math.pow(Math.random(), 1.6));
      r.crowd.push({ at: now + Math.random() * (BET_SECS - 1.5) * 1000, side: Math.random() < lean ? 1 : 2, cur, amt: +amt.toFixed(cur === 'ETH' ? 4 : 2) });
    }
    r.crowd.sort((x, y) => x.at - y.at);
    this.r = r; this.save();
    return r;
  },
  current() { return this.r; },
  poll(now) {
    const r = this.r; if (!r || r.status !== 'open') return;
    while (r.crowd.length && r.crowd[0].at <= now) { const c = r.crowd.shift(); r.pools[c.cur][c.side - 1] += c.amt; }
    if (now >= r.lockAt) { r.status = 'started'; r.seed = hexSeed(); r.fightAt = r.lockAt + LOCK_SECS * 1000; }
  },
  async bet(r, side, cur, amt) {
    if (r.status !== 'open' || Date.now() >= r.lockAt) throw new Error('Bets are closed');
    if (this.bal[cur] + 1e-9 < amt) throw new Error('Not enough practice ' + CUR_NAME[cur]);
    this.bal[cur] -= amt; r.pools[cur][side - 1] += amt; r.mine[cur][side - 1] += amt; this.save();
  },
  fightEnded(r, side) {
    if (r.status === 'settled') return;
    r.status = 'settled'; r.winner = side; r.result = {};
    for (const cur of CURS) {
      const staked = r.mine[cur][0] + r.mine[cur][1]; if (!staked) continue;
      const pay = claimAmount(r.pools[cur], r.mine[cur], side, r.cutBps);
      this.bal[cur] += pay; r.result[cur] = pay - staked;
    }
    this.save();
  },
  // leaving mid-betting hands the stake back; the round is dropped
  abandon(r) {
    if (r && r.status === 'open') for (const cur of CURS) this.bal[cur] += r.mine[cur][0] + r.mine[cur][1];
    this.r = null; this.save();
  },
  balances() { return this.bal; },
  refill() { this.bal = { ETH: 1, USDC: 500, USDT: 500 }; this.save(); },
};

const Arena = {
  active: false, house: PracticeHouse, r: null, phase: '', uiT: 0, resultUntil: 0,
  cur: store.get('arenaCur', 'USDC'), amt: store.get('arenaAmt', { ETH: 0.01, USDC: 10, USDT: 10 }),
  hist: store.get('arenaHist', []), rec: store.get('arenaRec', {}),

  async enter() {
    if (typeof ChainHouse !== 'undefined' && ChainHouse.ready) await ChainHouse.ready;
    this.house = typeof ChainHouse !== 'undefined' && ChainHouse.enabled() ? ChainHouse : PracticeHouse;
    this.house.init(); this.active = true; this.r = null; this.phase = '';
    $('aMode').textContent = this.house.label;
    if (!this.house.current()) { $('aRound').textContent = this.house.mode === 'live' ? 'Waiting for the next round' : 'Round'; $('aSide1').innerHTML = $('aSide2').innerHTML = ''; }
    this.renderSlip(); this.renderHist();
    UI.show('scArena');
  },
  leave() {
    if (this.house.mode === 'practice') {
      if (this.phase === 'bet' || !this.phase) this.house.abandon(this.r);
      else if (this.phase === 'locked' || this.phase === 'fight') {
        // bets are in: finish the fight instantly so they settle, then go
        Game.state = 'match'; const mute = Sfx.on; Sfx.on = false;
        while (this.phase !== 'result' && Game.tick < 60 * 60 * 10) Game.step();
        Sfx.on = mute;
      }
      this.house.r = null;
    }
    this.active = false; this.r = null; this.phase = '';
    Game.arena = null; Game.potLabel = null; Game.arenaTags = null;
    $('aLive').hidden = true; $('aLeaveLive').hidden = true;
    UI.title();
  },

  // called every animation frame from the main loop while the arena is open
  frame() {
    const now = Date.now(), H = this.house;
    // practice rounds open on the first live frame, so a slow page load never eats the betting window
    if (H.mode === 'practice' && !H.current()) H.open(now);
    H.poll(now);
    if (this.phase === 'result') {
      const left = Math.max(0, Math.ceil((this.resultUntil - now) / 1000));
      $('rNext').textContent = left > 0 ? 'Next fight in ' + left : H.mode === 'practice' ? '' : 'Waiting for the next round';
      if (now < this.resultUntil) return;
      if (H.mode === 'practice') H.open(now);
    }
    const r = H.current();
    if (!r) return;
    if (r !== this.r) this.enterRound(r);
    if (r.status === 'cancelled' && this.phase !== 'result') return this.onCancel(r);
    if (this.phase === 'bet') {
      if (r.seed) this.toLocked(r);
      else if (now - this.uiT > 120) { this.uiT = now; this.renderClock(now); this.renderPools(); }
    }
    if (this.phase === 'locked' && now >= r.fightAt) { this.phase = 'fight'; Game.state = 'match'; }
    if (this.phase === 'fight') this.catchUp(now);
    if ((this.phase === 'locked' || this.phase === 'fight') && now - this.uiT > 250) { this.uiT = now; this.renderLive(now); }
  },
  enterRound(r) {
    this.r = r; this.phase = 'bet';
    startFight(hexSeed(), r.a, r.b, r.stage); Game.state = 'arenaWait';   // fighters stand on the stage while bets come in
    $('aRound').textContent = 'Round ' + r.id; $('aStage').textContent = makeStage(ARENA.stages[r.stage]).name;
    $('aLive').hidden = true; $('aLeaveLive').hidden = true;
    this.renderCards(); this.renderPools(); this.renderClock(Date.now()); this.renderFair();
    UI.show('scArena');
  },
  toLocked(r) {
    this.phase = 'locked';
    startFight(r.seed, r.a, r.b, r.stage, w => this.onEnd(w)); Game.state = 'arenaWait';
    Game.arenaTags = [ARENA.roster[r.a], ARENA.roster[r.b]].map((id, i) => this.myStake(r, i + 1) ? 'YOUR BET' : '');
    UI.show(null); $('pauseBtn').hidden = true; $('touch').hidden = true; Touch.visible = false;
    $('aLive').hidden = false; $('aLeaveLive').hidden = false;
    this.renderFair(); this.renderLive(Date.now());
  },
  // every screen runs the same seeded fight against the wall clock, catching up if it fell behind
  catchUp(now) {
    let n = Math.floor((now - this.r.fightAt) / (1000 / 60)) - Game.tick;
    if (n <= 0) return;
    const fast = n > 4, mute = Sfx.on; if (fast) Sfx.on = false;
    n = Math.min(n, 1500);
    while (n-- > 0 && this.phase === 'fight') Game.step();
    if (fast) Sfx.on = mute;
  },
  onEnd(w) {
    const r = this.r, side = w.idx + 1;
    this.phase = 'result'; this.resultUntil = Date.now() + RESULT_SECS * 1000;
    this.house.fightEnded(r, side);
    const wid = ARENA.roster[side === 1 ? r.a : r.b], lid = ARENA.roster[side === 1 ? r.b : r.a];
    (this.rec[wid] = this.rec[wid] || [0, 0])[0]++; (this.rec[lid] = this.rec[lid] || [0, 0])[1]++;
    this.hist.unshift({ id: r.id, w: wid, side }); this.hist = this.hist.slice(0, 14);
    store.set('arenaRec', this.rec); store.set('arenaHist', this.hist);
    $('aLive').hidden = true; $('aLeaveLive').hidden = true; Game.potLabel = null;
    this.renderResult(r, side, w);
  },

  onCancel(r) {
    this.phase = 'result'; this.resultUntil = Date.now() + RESULT_SECS * 1000;
    $('aLive').hidden = true; $('aLeaveLive').hidden = true; Game.potLabel = null;
    $('rRound').textContent = 'Round ' + r.id; $('rName').textContent = 'Round cancelled';
    $('rPl').innerHTML = '<p class="note">Every bet in this round is refunded. Claim it from the arena screen.</p>';
    UI.show('scArenaRes');
  },
  myStake(r, side) { return CURS.some(c => r.mine[c][side - 1] > 0); },
  renderCards() {
    const r = this.r;
    [r.a, r.b].forEach((ci, i) => {
      const c = CHAR_BY_ID[ARENA.roster[ci]], el = $('aSide' + (i + 1)), side = i + 1;
      const other = i ? r.a : r.b, [hw, hl] = h2h(ci, other), rec = this.rec[c.id];
      el.style.setProperty('--c', SIDE_COL[i]);
      el.innerHTML = `<div class="hd"><canvas width="168" height="168"></canvas><div style="min-width:0"><div class="nm">${c.name}</div><div class="ttl">${c.title}</div>
        <div class="form">Test fights ${formPct(ci).toFixed(0)}% won${hw + hl ? ` · vs ${CHAR_BY_ID[ARENA.roster[other]].name} ${hw}–${hl}` : ''}${rec ? ` · here ${rec[0]}–${rec[1]}` : ''}</div></div></div>
        <div class="pool"><span><span class="lbl note" style="text-align:left">Pool</span> <span class="v" data-k="pool"></span></span><span class="mult" data-k="mult"></span></div>
        <div class="share"><i data-k="share"></i></div>
        <div class="yours" data-k="yours"></div>
        <button class="betbtn" data-k="btn"></button>`;
      drawPortrait(el.querySelector('canvas'), c);
      el.querySelector('[data-k=btn]').onclick = () => this.placeBet(side);
    });
  },
  renderPools() {
    const r = this.r; if (!r) return;
    const cur = this.cur, P = r.pools[cur], tot = P[0] + P[1], open = this.phase === 'bet' && !r.seed && Date.now() < r.lockAt;
    const bal = this.house.balances()[cur] || 0, amt = this.amt[cur];
    [1, 2].forEach(side => {
      const el = $('aSide' + side), c = CHAR_BY_ID[ARENA.roster[side === 1 ? r.a : r.b]], q = k => el.querySelector(`[data-k=${k}]`);
      if (!q('pool')) return;
      const m = payMult(P, side, r.cutBps);
      q('pool').textContent = withCur(cur, P[side - 1]);
      q('mult').textContent = m ? m.toFixed(2) + 'x' : '—';
      q('share').style.width = (tot ? 100 * P[side - 1] / tot : 50) + '%';
      const mine = CURS.filter(k => r.mine[k][side - 1] > 0).map(k => withCur(k, r.mine[k][side - 1]));
      q('yours').textContent = mine.length ? 'Your bet: ' + mine.join(' + ') : '';
      el.classList.toggle('mine', mine.length > 0);
      const b = q('btn'), needWallet = this.house.connect && !this.house.acct;
      b.textContent = !open ? 'Bets closed' : needWallet ? `Connect wallet to back ${c.name}` : `Bet ${withCur(cur, amt)} on ${c.name}`;
      b.disabled = !open || this.busy || (!needWallet && bal + 1e-9 < amt);
    });
    this.renderBals();
  },
  renderClock(now) {
    const r = this.r, s = Math.max(0, Math.ceil((r.lockAt - now) / 1000)), el = $('aClock');
    el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); el.classList.toggle('hot', s <= 5);
    $('aClockLbl').textContent = s > 0 ? 'Bets close in' : 'Locking bets';
  },
  renderBals() {
    const H = this.house;
    if (H.connect) {
      const cl = H.claimables || [];
      $('aBals').innerHTML = (H.acct ? CURS.map(c => `<span class="bal-chip">${fmtAmt(c, H.bal[c] || 0)}<b>${CUR_NAME[c]}</b></span>`).join('') : '<button class="btn small primary" id="aConnect">Connect wallet</button>') +
        (cl.length ? `<button class="btn small primary" id="aClaim">Claim ${cl.map(x => withCur(x.cur, x.amt)).join(' + ')}</button>` : '');
      const cb = $('aConnect'); if (cb) cb.onclick = () => this.walletAction(() => H.connect());
      const ck = $('aClaim'); if (ck) ck.onclick = () => this.walletAction(() => H.claimAll());
      return;
    }
    const b = H.balances(), low = CURS.every(c => (b[c] || 0) < CUR_AMTS[c][0]);
    $('aBals').innerHTML = CURS.map(c => `<span class="bal-chip">${fmtAmt(c, b[c] || 0)}<b>${CUR_NAME[c]}</b></span>`).join('') +
      (this.house.mode === 'practice' && low ? '<button class="btn small" id="aRefill">Refill practice balance</button>' : '');
    const rf = $('aRefill'); if (rf) rf.onclick = () => { this.house.refill(); this.renderPools(); };
  },
  renderSlip() {
    $('aCur').innerHTML = CURS.map(c => `<button class="${c === this.cur ? 'on' : ''}" data-c="${c}">${CUR_NAME[c]}</button>`).join('');
    $('aCur').querySelectorAll('button').forEach(b => b.onclick = () => { this.cur = b.dataset.c; store.set('arenaCur', this.cur); Sfx.ui(); this.renderSlip(); this.renderPools(); });
    $('aAmts').innerHTML = CUR_AMTS[this.cur].map(v => `<button class="stake${v === this.amt[this.cur] ? ' on' : ''}" data-v="${v}">${fmtAmt(this.cur, v)}</button>`).join('');
    $('aAmts').querySelectorAll('button').forEach(b => b.onclick = () => { this.amt[this.cur] = +b.dataset.v; store.set('arenaAmt', this.amt); Sfx.coin(); this.renderSlip(); this.renderPools(); });
  },
  renderHist() {
    $('aHist').innerHTML = this.hist.length ? '<span class="note">Last winners</span>' + this.hist.map(h => `<span class="h" style="--c:${SIDE_COL[h.side - 1]}">${CHAR_BY_ID[h.w].name}</span>`).join('') : '';
  },
  renderFair() {
    const r = this.r, H = this.house;
    const tail = r.seed ? ` Fight seed <code>${r.seed}</code>.` : '';
    $('aFair').innerHTML = H.mode === 'practice'
      ? `Practice balances, nothing leaves your wallet. The fight seed is drawn when bets close and the fight replays exactly from it.${tail}`
      : `Seed committed before betting: <code>${r.seedHash}</code>.${tail} Anyone can replay this fight from the seed.`;
  },
  renderLive(now) {
    const r = this.r, cur = this.cur, P = r.pools[cur], a = CHAR_BY_ID[ARENA.roster[r.a]], b = CHAR_BY_ID[ARENA.roster[r.b]];
    const bits = [`<span class="chip live">${this.phase === 'fight' ? 'Live' : 'Bets locked'} · Round ${r.id}</span>`,
      `<span class="chip"><span style="color:${SIDE_COL[0]}">${a.name} ${withCur(cur, P[0])}</span>&nbsp;·&nbsp;<span style="color:${SIDE_COL[1]}">${b.name} ${withCur(cur, P[1])}</span></span>`];
    for (const c of CURS) for (const side of [1, 2]) {
      const m = r.mine[c][side - 1]; if (!m) continue;
      const pay = claimAmount(r.pools[c], r.mine[c], side, r.cutBps);
      bits.push(`<span class="chip" style="color:${SIDE_COL[side - 1]}">You: ${withCur(c, m)} on ${(side === 1 ? a : b).name} → ${withCur(c, pay)}</span>`);
    }
    $('aLive').innerHTML = bits.join('');
    Game.potLabel = 'POOL ' + withCur(cur, P[0] + P[1]);
  },
  renderResult(r, side, w) {
    const c = w.c;
    $('rRound').textContent = 'Round ' + r.id + (Game.timeUpT ? ' · won on time' : '');
    drawPortrait($('rCv'), c); $('rCv').style.setProperty('--c', SIDE_COL[side - 1]);
    $('rName').innerHTML = `<span style="color:${SIDE_COL[side - 1]}">${c.name}</span> wins`;
    const res = r.result || {}, lines = CURS.filter(k => res[k] !== undefined).map(k => {
      const v = res[k], cls = v > 1e-12 ? 'win' : v < -1e-12 ? 'lose' : 'even';
      return `<div class="pl ${cls}">${cls === 'even' ? 'Stake back: ' + withCur(k, r.mine[k][0] + r.mine[k][1]) : signed(k, v)}</div>`;
    });
    $('rPl').innerHTML = lines.length ? lines.join('') + (this.house.connect ? '<p class="note">Paid out when the round settles on chain. Claim it on the arena screen.</p>' : '')
      : '<p class="note">No bets from you this round.</p>';
    this.renderHist();
    UI.show('scArenaRes');
  },
  async walletAction(fn) {
    if (this.busy) return;
    this.busy = true; this.renderPools();
    try { await fn(); } catch (e) { this.toast(e.message || String(e)); }
    this.busy = false; this.renderPools();
  },
  async placeBet(side) {
    const r = this.r, cur = this.cur, amt = this.amt[cur];
    if (this.busy) return;
    this.busy = true; this.renderPools();
    try { await this.house.bet(r, side, cur, amt); Sfx.coin(); }
    catch (e) { this.toast(e.message || String(e)); }
    this.busy = false; this.renderPools();
  },
  toast(msg) { $('aFair').textContent = msg; setTimeout(() => this.r && this.renderFair(), 4000); },
};
