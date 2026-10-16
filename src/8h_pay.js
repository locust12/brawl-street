// ===== CHECKOUT: paying for a store item, topping up a wager balance, attaching a wallet =====
//
// The whole money surface the player ever sees. It renders from what the server sent and nothing
// else: the assets it offers, the amount on an invoice and the address it shows are the server's
// numbers (net/lib/paygate.js). This file never prices anything and never decides what is owned.
//
// It routes around `Econ.buy` rather than replacing it. If crypto payments are off on the server,
// the old behaviour is untouched and this file draws nothing at all.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined') return;

  const S = {
    assets: [], topups: [], tiers: {}, minWithdraw: {}, families: [],
    houseOffBps: 0, rakeBps: 300, houseRakeBps: 150,
    wallets: [], balances: [], withdrawals: [],
    inv: null, busy: false, tab: 'pay', target: null, poll: 0,
  };
  const on = () => S.assets.length > 0;

  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const byId = id => document.getElementById(id);
  const money = c => '$' + (c / 100).toFixed(2);
  const net = o => { try { Net.send(o); } catch (e) { /* not connected */ } };
  const say = (m, bad) => { try { Net.toast(m, !!bad); } catch (e) { /* no toast yet */ } };
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const famName = f => (f === 'sol' ? 'Solana' : 'EVM');

  // --------------------------------------------------------------------------------------- style
  const css = `
  /* This number has to sit in one specific gap, so it is written down rather than guessed at.
     76b_wallets.js puts a fixed "Connect wallet" chip at top:12px right:12px on z-index 2147482000
     and its own picker on 2147483000. At any lower z-index that chip floats over this modal and
     lands exactly on top of the close button (.x is also top right). So: ABOVE the chip, so the
     overlay covers it like a modal should, and BELOW the picker, because this modal is what opens
     that picker and it has to appear in front. */
  #payWrap{position:fixed;inset:0;z-index:2147482500;display:none;align-items:center;justify-content:center;padding:20px;
    background:rgba(3,3,5,.82);backdrop-filter:blur(7px)}
  #payWrap.on{display:flex}
  #payBox{position:relative;width:min(760px,100%);max-height:min(86vh,900px);overflow:auto;padding:22px;
    background:linear-gradient(170deg,rgba(18,18,24,.97),rgba(8,8,11,.98));box-shadow:inset 0 0 0 1px var(--line2),0 30px 90px rgba(0,0,0,.7);
    clip-path:polygon(0 14px,14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%)}
  #payBox h2{margin:0 0 2px;font-family:var(--display);font-style:italic;font-weight:900;font-size:36px;line-height:.9;
    text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  #payBox .kick{font:700 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin-bottom:12px}
  #payBox .x{position:absolute;right:14px;top:12px;width:34px;height:34px;border:0;background:rgba(255,255,255,.06);color:var(--muted);
    font-size:19px;cursor:pointer;line-height:1}
  #payBox .x:hover{background:var(--red);color:#fff}
  .pyTabs{display:flex;gap:2px;margin:0 0 14px;flex-wrap:wrap}
  .pyTabs button{min-height:36px;padding:0 15px;font:700 12px var(--ui);color:var(--muted);background:rgba(255,255,255,.04);
    border:0;box-shadow:inset 0 0 0 1px var(--line);cursor:pointer}
  .pyTabs button.on{color:#fff;background:var(--red);box-shadow:none}
  .pyNote{font-size:13px;color:var(--muted);line-height:1.55;max-width:74ch;margin:0 0 12px}
  .pyNote b{color:var(--gold)}
  .pyRow{display:grid;grid-template-columns:repeat(auto-fill,minmax(222px,1fr));gap:8px}
  .pyA{display:flex;flex-direction:column;gap:3px;padding:11px 13px;text-align:left;cursor:pointer;border:0;
    background:var(--glass);box-shadow:inset 0 0 0 1px var(--line);transition:transform .14s,box-shadow .2s}
  .pyA:hover:not(:disabled){transform:translateY(-2px);box-shadow:inset 0 0 0 1px var(--cyan)}
  .pyA:disabled{cursor:not-allowed;opacity:.45}
  .pyA .sym{font-family:var(--display);font-style:italic;font-weight:900;font-size:21px;line-height:1;text-transform:uppercase;color:var(--text)}
  .pyA .ch{font:600 10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  .pyA .amt{font:800 14px var(--mono);color:var(--gold);margin-top:3px}
  .pyA .bad{font-size:11.5px;color:var(--dim);line-height:1.4;margin-top:3px}
  .pyA.house{box-shadow:inset 0 0 0 1px rgba(255,200,61,.5)}
  .pyA .off{align-self:flex-start;font:800 9.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;
    padding:2px 6px;background:var(--gold);color:#140d00;margin-top:4px}
  .pyBtn{min-height:44px;padding:0 20px;font:800 13px var(--ui);letter-spacing:.04em;text-transform:uppercase;
    color:#fff;background:var(--red);border:0;cursor:pointer}
  .pyBtn:hover:not(:disabled){filter:brightness(1.15)}
  .pyBtn:disabled{opacity:.5;cursor:wait}
  .pyBtn.ghost{background:rgba(255,255,255,.05);color:var(--muted);box-shadow:inset 0 0 0 1px var(--line)}
  .pyFld{width:100%;min-height:42px;padding:0 12px;font:600 13px var(--mono);color:var(--text);
    background:rgba(0,0,0,.45);border:0;box-shadow:inset 0 0 0 1px var(--line)}
  .pyFld:focus{outline:0;box-shadow:inset 0 0 0 1px var(--cyan)}
  .pyAmt{display:flex;flex-direction:column;gap:6px;padding:14px;background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 1px var(--line);margin:0 0 12px}
  .pyAmt .big{font:800 25px var(--mono);color:var(--gold);line-height:1.1;word-break:break-all}
  .pyAmt .to{font:600 11.5px var(--mono);color:var(--muted);word-break:break-all;line-height:1.5}
  .pyAmt .to b{color:var(--cyan);font-weight:700}
  .pyList{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
  .pyIt{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;background:var(--glass);box-shadow:inset 0 0 0 1px var(--line)}
  .pyIt .g{flex:1;min-width:140px}
  .pyIt .t{font:700 12.5px var(--mono);color:var(--text);word-break:break-all}
  .pyIt .s{font-size:11.5px;color:var(--dim);margin-top:2px}
  .pyIt .tag{font:800 9.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;background:rgba(255,255,255,.08);color:var(--muted)}
  .pyIt .tag.ok{background:rgba(61,255,138,.18);color:var(--lime)}
  .pyIt .tag.wait{background:rgba(39,225,255,.16);color:var(--cyan)}
  .pyIt button{min-height:32px;padding:0 11px;font:700 11px var(--ui);text-transform:uppercase;border:0;cursor:pointer;
    background:rgba(255,255,255,.06);color:var(--muted);box-shadow:inset 0 0 0 1px var(--line)}
  .pyIt button:hover{color:#fff;background:var(--red);box-shadow:none}
  .pyFoot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}
  .pySpin{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.25);border-top-color:var(--cyan);
    border-radius:50%;animation:pySp .8s linear infinite;vertical-align:-2px;margin-right:7px}
  @keyframes pySp{to{transform:rotate(360deg)}}
  /* The way in. Stacked directly UNDER 76b_wallets.js's connect chip rather than beside it: the
     chip's width changes when it swaps "Connect wallet" for an address, so anything placed to its
     left would start overlapping the moment somebody connects. Vertically stacked cannot collide
     whatever the chip does. Same z-index band as that chip, one below it. */
  #payChip{position:fixed;top:58px;right:12px;z-index:2147481900;display:none;align-items:center;gap:7px;cursor:pointer;
    min-height:34px;padding:0 13px;border:0;font:800 12px var(--ui);letter-spacing:.03em;text-transform:uppercase;
    color:var(--text);background:rgba(12,12,16,.92);box-shadow:inset 0 0 0 1px var(--line2);backdrop-filter:blur(6px)}
  #payChip:hover{color:#fff;background:var(--red);box-shadow:none}
  #payChip i{font-style:normal;font:800 11px var(--mono);color:var(--gold)}
  @media (max-width:520px){#payBox{padding:16px}#payBox h2{font-size:28px}.pyRow{grid-template-columns:1fr}
    #payChip{top:52px;right:8px;font-size:11px;padding:0 10px}}
  `;

  let built = false;
  function build() {
    if (built) return;
    built = true;
    const st = el('style'); st.textContent = css; document.head.appendChild(st);
    const wrap = el('div'); wrap.id = 'payWrap';
    const box = el('div'); box.id = 'payBox';
    const x = el('button', 'x', '✕'); x.onclick = () => close();
    box.appendChild(x);
    const body = el('div'); body.id = 'payBody';
    box.appendChild(body);
    wrap.appendChild(box);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    mountChip();
  }

  // 76b_wallets.js learned this the hard way and it applies here too: a screen nobody can open may
  // as well not exist. The store's buy button reaches the checkout, but the balance and the wager
  // screens had no way in at all until this. It only appears when the server actually offers
  // payments, and it is gone the moment a fight starts (the same test 87_controls.js uses).
  function mountChip() {
    if (byId('payChip')) return;
    const b = el('button'); b.id = 'payChip'; b.type = 'button';
    b.onclick = () => { sfx(); open(S.balances.length ? 'bank' : 'wager'); };
    document.body.appendChild(b);
    paintChip();
    const inMatch = () => { try { return Game.state === 'match' && !Game.demo && document.querySelectorAll('.screen:not([hidden])').length === 0; } catch (e) { return false; } };
    setInterval(() => { b.style.display = (on() && !inMatch() && !isOpen()) ? 'flex' : 'none'; }, 500);
  }
  function paintChip() {
    const b = byId('payChip'); if (!b) return;
    b.textContent = '';
    // Show the balance once there is one: it is the thing a player wants to glance at.
    const first = S.balances[0];
    if (first) {
      b.appendChild(document.createTextNode('Wager'));
      const i = el('i', '', first.amount + ' ' + first.symbol);
      b.appendChild(i);
    } else b.appendChild(document.createTextNode('Wager a fight'));
    b.title = 'Balance, wagers and payments';
  }

  function open(tab, target) {
    build();
    S.tab = tab || 'pay'; S.target = target || null; S.inv = null;
    byId('payWrap').classList.add('on');
    net({ k: 'payassets' }); net({ k: 'wallets' }); net({ k: 'bank' });
    if (S.target) net({ k: 'payquote', purpose: S.target.purpose, item: S.target.item, cents: S.target.cents });
    render();
  }
  function close() {
    if (!built) return;
    byId('payWrap').classList.remove('on');
    S.inv = null; S.target = null;
    if (S.poll) { clearTimeout(S.poll); S.poll = 0; }
  }
  const isOpen = () => built && byId('payWrap').classList.contains('on');

  // ------------------------------------------------------------------------------------ rendering
  function render() {
    if (!isOpen()) return;
    const b = byId('payBody');
    b.textContent = '';
    if (S.inv) return renderInvoice(b);
    b.appendChild(el('div', 'kick', S.tab === 'wallet' ? 'Your wallets' : S.tab === 'bank' ? 'Wager balance' : 'Checkout'));
    b.appendChild(el('h2', '', S.tab === 'wallet' ? 'Wallets' : S.tab === 'bank' ? 'Balance' : (S.target && S.target.label) || 'Pay'));

    const tabs = el('div', 'pyTabs');
    const mk = (id, name) => { const t = el('button', S.tab === id ? 'on' : '', name); t.onclick = () => { sfx(); S.tab = id; S.inv = null; render(); }; return t; };
    if (S.target) tabs.appendChild(mk('pay', 'Pay'));
    tabs.appendChild(mk('bank', 'Balance'));
    tabs.appendChild(mk('wager', 'Wager a fight'));
    tabs.appendChild(mk('wallet', 'Wallets'));
    tabs.appendChild(mk('history', 'Payments'));
    b.appendChild(tabs);

    if (!on()) {
      b.appendChild(el('p', 'pyNote', 'Crypto payments are not switched on for this server yet. Weapons still unlock by level, and the whole $15 shelf is free by level 10.'));
      return;
    }
    if (S.tab === 'wallet') return renderWallets(b);
    if (S.tab === 'bank') return renderBank(b);
    if (S.tab === 'wager') return renderWager(b);
    if (S.tab === 'history') return renderHistory(b);
    renderPicker(b);
  }

  // ---- pick an asset -------------------------------------------------------------------------
  function renderPicker(b) {
    const t = S.target;
    if (!t) { b.appendChild(el('p', 'pyNote', 'Nothing is selected. Pick a weapon in the store, or top up a wager balance from the Balance tab.')); return; }
    b.appendChild(el('p', 'pyNote', 'Pay from your own wallet, straight through. Pick what you want to pay in and the exact amount is shown before anything is signed.'));
    const grid = el('div', 'pyRow');
    for (const q of (t.quotes || [])) {
      const btn = el('button', 'pyA' + (q.house ? ' house' : ''));
      btn.appendChild(el('div', 'sym', q.symbol));
      btn.appendChild(el('div', 'ch', q.chain));
      if (q.err) {
        btn.appendChild(el('div', 'bad', q.err));
        btn.disabled = true;
      } else {
        btn.appendChild(el('div', 'amt', q.send + ' ' + q.symbol));
        if (q.offBps) btn.appendChild(el('div', 'off', (q.offBps / 100) + '% off'));
        btn.onclick = () => startInvoice(q.asset);
      }
      grid.appendChild(btn);
    }
    b.appendChild(grid);
    if (S.houseOffBps) b.appendChild(el('p', 'pyNote', 'Paying in WOLVERINU takes ' + (S.houseOffBps / 100) + '% off the price, and it halves the cut on a wager.'));
  }

  function startInvoice(assetId) {
    if (S.busy) return;
    S.busy = true; sfx();
    const t = S.target;
    net({ k: 'payopen', purpose: t.purpose, item: t.item, cents: t.cents, asset: assetId });
    setTimeout(() => { S.busy = false; }, 1200);
  }

  // ---- an open invoice -----------------------------------------------------------------------
  function renderInvoice(b) {
    const inv = S.inv;
    b.appendChild(el('div', 'kick', inv.chainName + ' · ' + inv.symbol));
    b.appendChild(el('h2', '', inv.status === 'paid' ? 'Paid' : 'Send it'));

    if (inv.status === 'paid') {
      b.appendChild(el('p', 'pyNote', inv.purpose === 'deposit'
        ? 'Landed. Your wager balance is up to date.'
        : 'Landed. It is on your account, so it follows you to any device you sign in on.'));
      const f = el('div', 'pyFoot');
      const done = el('button', 'pyBtn', 'Done'); done.onclick = () => close();
      f.appendChild(done);
      b.appendChild(f);
      return;
    }

    const amt = el('div', 'pyAmt');
    amt.appendChild(el('div', 'big', inv.sendStr + ' ' + inv.symbol));
    const to = el('div', 'to');
    to.appendChild(document.createTextNode('to '));
    const bo = el('b', '', inv.payTo); to.appendChild(bo);
    to.appendChild(el('div', '', 'on ' + inv.chainName));
    amt.appendChild(to);
    if (inv.taxBps) amt.appendChild(el('div', 'to', 'This token takes a cut on every transfer, so the amount above already has the headroom added. ' + inv.needStr + ' has to land.'));
    b.appendChild(amt);

    if (inv.status === 'checking') {
      const p = el('p', 'pyNote');
      p.appendChild(el('span', 'pySpin'));
      p.appendChild(document.createTextNode(inv.err || 'Reading it off the chain. This finishes on its own, even if you close the page.'));
      b.appendChild(p);
    } else if (inv.err) {
      b.appendChild(el('p', 'pyNote', inv.err));
    } else {
      b.appendChild(el('p', 'pyNote', 'Your wallet will show the amount and the address before you approve anything. Nothing here can change either one.'));
    }

    const f = el('div', 'pyFoot');
    if (inv.status !== 'checking') {
      const fam = inv.family;
      const have = typeof Wallet !== 'undefined' && Wallet.available(fam);
      const pay = el('button', 'pyBtn', have ? 'Pay with wallet' : 'No ' + famName(fam) + ' wallet found');
      pay.disabled = !have || S.busy;
      pay.onclick = () => payNow(inv);
      f.appendChild(pay);
    }
    const man = el('button', 'pyBtn ghost', 'I sent it already');
    man.onclick = () => manual(inv);
    f.appendChild(man);
    const back = el('button', 'pyBtn ghost', 'Back');
    back.onclick = () => { net({ k: 'paycancel', id: inv.id }); S.inv = null; render(); };
    f.appendChild(back);
    b.appendChild(f);
  }

  async function payNow(inv) {
    if (S.busy) return;
    S.busy = true; render();
    try {
      const tx = await Wallet.pay(inv);
      if (!tx) throw new Error('The wallet did not return a transaction.');
      net({ k: 'paysubmit', id: inv.id, tx: String(tx) });
      S.inv = Object.assign({}, inv, { status: 'checking', err: null });
    } catch (e) {
      const m = String((e && e.message) || e);
      // A refusal in the wallet is a normal thing a person does, not a failure to shout about.
      S.inv = Object.assign({}, inv, { err: /reject|denied|cancel|User rejected/i.test(m) ? 'Cancelled in your wallet. Nothing was sent.' : m });
    }
    S.busy = false;
    render();
  }

  function manual(inv) {
    const tx = prompt('Paste the transaction ' + (inv.family === 'sol' ? 'signature' : 'hash') + '. It is checked on chain before anything unlocks.');
    if (!tx) return;
    net({ k: 'payrecover', id: inv.id, tx: String(tx).trim() });
    S.inv = Object.assign({}, inv, { status: 'checking', err: null });
    render();
  }

  // ---- wallets -------------------------------------------------------------------------------
  function renderWallets(b) {
    b.appendChild(el('p', 'pyNote', 'Attach a wallet and it is remembered on your account. The primary one of each kind is where a withdrawal is paid, so that is the one worth getting right. Attaching asks for a signature: it moves no money and approves nothing.'));
    if (!S.wallets.length) b.appendChild(el('p', 'pyNote', 'Nothing attached yet. Any wallet you pay with is attached on its own, so you may never need this screen.'));

    const list = el('div', 'pyList');
    for (const w of S.wallets) {
      const it = el('div', 'pyIt');
      const g = el('div', 'g');
      g.appendChild(el('div', 't', w.address));
      g.appendChild(el('div', 's', famName(w.family) + (w.how === 'paid' ? ', attached by paying with it' : ', signed')));
      it.appendChild(g);
      if (w.primary) it.appendChild(el('span', 'tag ok', 'Payout'));
      else { const p = el('button', '', 'Make payout'); p.onclick = () => { sfx(); net({ k: 'wal_primary', family: w.family, address: w.address }); }; it.appendChild(p); }
      const d = el('button', '', 'Detach'); d.onclick = () => { sfx(); net({ k: 'wal_detach', family: w.family, address: w.address }); };
      it.appendChild(d);
      list.appendChild(it);
    }
    b.appendChild(list);

    const f = el('div', 'pyFoot');
    for (const fam of (S.families.length ? S.families : ['evm'])) {
      const btn = el('button', 'pyBtn' + (fam === 'sol' ? ' ghost' : ''), 'Attach ' + famName(fam));
      btn.disabled = typeof Wallet === 'undefined' || !Wallet.available(fam);
      if (btn.disabled) btn.textContent = 'Install a ' + famName(fam) + ' wallet';
      btn.onclick = () => attach(fam);
      f.appendChild(btn);
    }
    b.appendChild(f);
  }

  let pendingAttach = null;
  function attach(fam) {
    if (S.busy) return;
    pendingAttach = { fam };
    net({ k: 'wal_nonce' });
  }
  async function doAttach(nonceMsg) {
    const p = pendingAttach; pendingAttach = null;
    if (!p) return;
    S.busy = true;
    try {
      await Wallet.connect(p.fam);
      const sig = await Wallet.sign(p.fam, nonceMsg.message);
      net({ k: 'wal_attach', family: p.fam, address: Wallet.addressFor(p.fam), signature: sig });
    } catch (e) {
      const m = String((e && e.message) || e);
      say(/reject|denied|cancel/i.test(m) ? 'Cancelled in your wallet.' : m, true);
    }
    S.busy = false;
    render();
  }

  // ---- balance and withdrawals ---------------------------------------------------------------
  function renderBank(b) {
    // The cut is spelled out here rather than buried. A player finding out about a rake after they
    // won is the one thing that loses them for good.
    const note = el('p', 'pyNote');
    note.innerHTML = 'A balance is what you wager with. Top it up in whatever you hold, fight as often as you like, and take out the same asset you wagered. The cut is <b>'
      + (S.rakeBps / 100) + '% of the pot</b> at the end of a match, and <b>' + (S.houseRakeBps / 100)
      + '% when the wager is in WOLVERINU</b>. Nothing is taken on a top-up or a withdrawal.';
    b.appendChild(note);

    if (!S.balances.length) b.appendChild(el('p', 'pyNote', 'Nothing on the books yet. Pick a top-up below.'));
    else {
      const list = el('div', 'pyList');
      for (const bal of S.balances) {
        const it = el('div', 'pyIt');
        const g = el('div', 'g');
        g.appendChild(el('div', 't', bal.amount + ' ' + bal.symbol));
        g.appendChild(el('div', 's', bal.chain));
        it.appendChild(g);
        const min = S.minWithdraw[bal.asset];
        const w = el('button', '', 'Withdraw');
        w.onclick = () => askWithdraw(bal, min);
        it.appendChild(w);
        list.appendChild(it);
      }
      b.appendChild(list);
    }

    b.appendChild(el('div', 'kick', 'Top up'));
    const grid = el('div', 'pyRow');
    for (const cents of S.topups) {
      const btn = el('button', 'pyA');
      btn.appendChild(el('div', 'sym', money(cents)));
      btn.appendChild(el('div', 'ch', 'Any asset'));
      btn.onclick = () => { sfx(); S.target = { purpose: 'deposit', cents, label: 'Top up ' + money(cents) }; S.tab = 'pay'; net({ k: 'payquote', purpose: 'deposit', cents }); render(); };
      grid.appendChild(btn);
    }
    b.appendChild(grid);

    if (S.withdrawals.length) {
      b.appendChild(el('div', 'kick', 'Withdrawals'));
      const list = el('div', 'pyList');
      for (const w of S.withdrawals) {
        const it = el('div', 'pyIt');
        const g = el('div', 'g');
        g.appendChild(el('div', 't', w.amount + ' ' + w.symbol));
        g.appendChild(el('div', 's', 'to ' + w.to));
        it.appendChild(g);
        it.appendChild(el('span', 'tag ' + (w.status === 'sent' ? 'ok' : w.status === 'pending' ? 'wait' : ''), w.status));
        list.appendChild(it);
      }
      b.appendChild(list);
      b.appendChild(el('p', 'pyNote', 'Withdrawals are sent by hand, so they are not instant. Yours goes to the payout wallet on your Wallets tab.'));
    }
  }

  function askWithdraw(bal, min) {
    const w = S.wallets.find(x => x.primary && x.family === (S.assets.find(a => a.id === bal.asset) || {}).family);
    if (!w) { say('Attach a wallet first. That is where it gets paid.', true); S.tab = 'wallet'; render(); return; }
    const want = prompt('How much ' + bal.symbol + ' to withdraw to ' + w.address + '?'
      + (min ? '\n\nSmallest withdrawal: ' + min.amount + ' ' + bal.symbol : '') + '\n\nYou have ' + bal.amount + '.', min ? min.amount : '');
    if (!want) return;
    const units = toUnits(want, bal.decimals);
    if (!units) { say('That is not an amount.', true); return; }
    net({ k: 'withdraw', asset: bal.asset, units });
  }
  // decimal string -> smallest units, as a string. Refuses anything that is not a plain number so
  // a typo never becomes a withdrawal for the wrong amount.
  function toUnits(s, dec) {
    const t = String(s).trim();
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const [i, f = ''] = t.split('.');
    if (f.length > dec) return null;
    return (BigInt(i) * 10n ** BigInt(dec) + BigInt(f.padEnd(dec, '0') || '0')).toString();
  }

  // ---- wager a fight -------------------------------------------------------------------------
  // Opening a wagered room, in the asset the player actually holds. It sends the same `create` the
  // lobby sends, with an asset and one of the tiers the server published, so the room that comes
  // back is an ordinary room screen with a wager on it. Nothing here decides a stake size: the
  // tiers come from the server (net/lib/bank.js) and a tier that is not on its list is refused.
  function renderWager(b) {
    b.appendChild(el('p', 'pyNote', 'A wagered match is 1v1, both sides put up the same stake in the same asset, and the winner takes the pot less the cut. Nothing anybody bought can enter a wagered fight: loadouts are off on both sides, which is the whole reason the wager is worth anything.'));
    const mine = S.balances.filter(x => BigInt(x.units) > 0n);
    if (!mine.length) {
      b.appendChild(el('p', 'pyNote', 'Top up a balance first and the stakes you can cover will show up here.'));
      const f = el('div', 'pyFoot');
      const go = el('button', 'pyBtn', 'Top up'); go.onclick = () => { sfx(); S.tab = 'bank'; render(); };
      f.appendChild(go); b.appendChild(f);
      return;
    }
    for (const bal of mine) {
      const tiers = (S.tiers[bal.asset] || []).filter(t => BigInt(t.units) <= BigInt(bal.units));
      b.appendChild(el('div', 'kick', bal.symbol + ' on ' + bal.chain + ' · you hold ' + bal.amount));
      if (!tiers.length) { b.appendChild(el('p', 'pyNote', 'Not quite enough for the smallest stake in ' + bal.symbol + ' yet.')); continue; }
      const grid = el('div', 'pyRow');
      const house = (S.assets.find(a => a.id === bal.asset) || {}).house;
      const bps = house ? S.houseRakeBps : S.rakeBps;
      for (const t of tiers) {
        const btn = el('button', 'pyA' + (house ? ' house' : ''));
        btn.appendChild(el('div', 'sym', t.amount));
        btn.appendChild(el('div', 'ch', bal.symbol + ' a side'));
        // What the winner actually takes, worked out here so nobody has to do it in their head.
        const pot = BigInt(t.units) * 2n;
        const win = pot - pot * BigInt(bps) / 10000n;
        btn.appendChild(el('div', 'amt', 'winner takes ' + fmtUnits(win, bal.decimals) + ' ' + bal.symbol));
        btn.appendChild(el('div', 'bad', (bps / 100) + '% cut on the pot'));
        btn.onclick = () => openWagerRoom(bal.asset, t.units, t.amount + ' ' + bal.symbol);
        grid.appendChild(btn);
      }
      b.appendChild(grid);
    }
  }
  function fmtUnits(units, dec) {
    const s = BigInt(units).toString().padStart(dec + 1, '0');
    const i = s.slice(0, s.length - dec), f = s.slice(s.length - dec).replace(/0+$/, '');
    return f ? i + '.' + f.slice(0, dec <= 6 ? 2 : 5) : i;
  }
  function openWagerRoom(asset, units, label) {
    sfx();
    net({ k: 'create', size: 2, stage: 'random', stocks: 3, items: false, asset, stakeUnits: String(units) });
    say('Wager room opening at ' + label + ' a side. Share the code and both of you ready up.');
    close();
  }

  // ---- payment history -----------------------------------------------------------------------
  function renderHistory(b) {
    b.appendChild(el('p', 'pyNote', 'Every payment this account has started. A payment that never confirmed can be picked back up here with its transaction hash.'));
    const list = el('div', 'pyList');
    for (const inv of (S.history || [])) {
      const it = el('div', 'pyIt');
      const g = el('div', 'g');
      g.appendChild(el('div', 't', inv.sendStr + ' ' + inv.symbol + ' · ' + (inv.label || inv.item || inv.purpose)));
      g.appendChild(el('div', 's', inv.chainName + (inv.tx ? ' · ' + inv.tx.slice(0, 14) + '…' : '')));
      it.appendChild(g);
      it.appendChild(el('span', 'tag ' + (inv.status === 'paid' ? 'ok' : inv.status === 'checking' ? 'wait' : ''), inv.status));
      if (inv.status !== 'paid' && inv.status !== 'cancelled') {
        const r = el('button', '', 'Pick up');
        r.onclick = () => { S.inv = inv; render(); };
        it.appendChild(r);
      }
      list.appendChild(it);
    }
    if (!(S.history || []).length) list.appendChild(el('p', 'pyNote', 'Nothing yet.'));
    b.appendChild(list);
  }

  // --------------------------------------------------------------------------- server messages
  function onNet(m) {
    switch (m.k) {
      case 'payassets':
        S.assets = m.assets || []; S.topups = m.topups || []; S.tiers = m.tiers || {};
        S.minWithdraw = m.minWithdraw || {}; S.families = m.families || [];
        S.houseOffBps = m.houseOffBps || 0; S.rakeBps = m.rakeBps || 300; S.houseRakeBps = m.houseRakeBps || 150;
        // The server has just said payments are on, so build the DOM now rather than waiting for
        // somebody to open something. This is what mounts the way in.
        if (on()) { build(); paintChip(); }
        render(); return;
      case 'wallets': S.wallets = m.wallets || []; render(); return;
      case 'walres':
        if (m.err) say(m.err, true); else { S.wallets = m.wallets || S.wallets; say('Wallet attached.'); }
        render(); return;
      case 'wal_nonce': doAttach(m); return;
      case 'bank':
        S.balances = m.balances || []; S.withdrawals = m.withdrawals || [];
        if (m.rakeBps) { S.rakeBps = m.rakeBps; S.houseRakeBps = m.houseRakeBps; }
        if (m.paid) say('Top-up landed.');
        paintChip(); render(); return;
      case 'bankres':
        if (m.err) say(m.err, true);
        else { S.balances = m.balances || S.balances; S.withdrawals = m.withdrawals || S.withdrawals; say(m.msg || 'Done.'); }
        render(); return;
      case 'payquote':
        if (m.err) { say(m.err, true); return; }
        if (S.target && (S.target.item === m.item || S.target.purpose === m.purpose)) {
          S.target = Object.assign({}, S.target, { quotes: m.quotes, cents: m.cents, label: S.target.label || m.label });
          render();
        }
        return;
      case 'payopen':
        if (m.err) { say(m.err, true); S.busy = false; return; }
        S.inv = m.invoice; S.busy = false; render(); return;
      case 'paystatus': {
        if (m.err) { if (S.inv) S.inv = Object.assign({}, S.inv, { err: m.err, status: m.invoice ? m.invoice.status : S.inv.status }); say(m.err, true); render(); return; }
        if (m.invoice && (!S.inv || S.inv.id === m.invoice.id)) S.inv = m.invoice;
        if (m.pending && m.invoice) {
          if (S.inv) S.inv = Object.assign({}, S.inv, { status: 'checking', err: m.msg || null });
          // Ask again until it lands. The server also finishes this on its own, so this is only
          // here to keep the screen honest about what is happening.
          if (S.poll) clearTimeout(S.poll);
          S.poll = setTimeout(() => { if (isOpen() && S.inv) net({ k: 'paystatus', id: S.inv.id }); }, 6000);
        }
        if (m.ok) { if (S.poll) { clearTimeout(S.poll); S.poll = 0; } sfx(); }
        render(); return;
      }
      case 'invoices': S.history = m.invoices || []; render(); return;
      case 'payres':
        if (m.err) say(m.err, true); else S.history = m.invoices || S.history;
        render(); return;
      case 'econ':
        if (m.bought) say('Unlocked.');
        return;
      default: return;
    }
  }

  // ------------------------------------------------------------------------------------- wiring
  // The store's buy button. With payments on it opens the checkout; with payments off the old
  // behaviour is left exactly as it was.
  const origBuy = Econ.buy.bind(Econ);
  Econ.buy = function (id, cb) {
    if (!on()) return origBuy(id, cb);
    const d = (Econ.BYID || {})[id];
    const cents = d && d.price != null ? d.price : null;
    if (cents == null) return origBuy(id, cb);
    open('pay', { purpose: 'item', item: id, cents, label: d.name });
    net({ k: 'payquote', purpose: 'item', item: id });
    if (cb) cb({ ok: true, quiet: true, msg: '' });
  };

  // Ask once as soon as online play is up, so the store knows whether to offer any of this.
  function hello() { net({ k: 'payassets' }); }
  if (typeof Net !== 'undefined' && Net.on) {
    Net.on(m => {
      if (m.k === 'welcome') { hello(); return; }
      onNet(m);
    });
  }

  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);

  // What the rest of the game calls. 77_net.js's room screen uses `tiers` to offer crypto stakes,
  // and the store uses `open`.
  window.PayUI = {
    open, close, isOpen, available: on,
    tiersFor: assetId => S.tiers[assetId] || [],
    assets: () => S.assets.slice(),
    balances: () => S.balances.slice(),
    balance: assetId => (S.balances.find(b => b.asset === assetId) || {}).units || '0',
    wallets: () => S.wallets.slice(),
    refresh: () => { net({ k: 'payassets' }); net({ k: 'bank' }); net({ k: 'wallets' }); net({ k: 'invoices' }); },
  };
})();
