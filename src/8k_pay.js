// ===== THE CHECKOUT: pay for a store item in ETH, USDC, USDT or WOLVERINU =====
//
// Duane, 2026-10-16: *"COPY OTHER TOP PLAY2EARN GAMES THEIR PAYMENT SYSTEM. YOU need to make it so
// we accept ETH. AND OTHER CURRENCIES"* and *"I want you to be able to buy items with wolverinu
// token as well. thats important."*
//
// WHAT EACH PART IS COPIED FROM, because that is the rule:
//   - GODS UNCHAINED (Immutable) store checkout: the sheet is priced in DOLLARS and lists every
//     currency it takes with the converted amount already on the row, so nobody picks blind and
//     then discovers the number. Their guarantee is the one this copies exactly: a payment
//     guarantees delivery, and a failure grants nothing and charges nothing.
//   - MAVIS STORE (Axie): a tile per currency with YOUR balance on it, greyed when you are short.
//     That is also where "the ecosystem's own token sits in the same list as ETH" comes from --
//     they take RON, AXS, SLP, WETH and USDC side by side, so WOLVERINU is a row here, not a
//     separate shop.
//   - COINBASE COMMERCE: the rate is locked for a countdown, the exact amount and address are
//     shown while it is in flight, and the status moves waiting -> confirming -> paid with a link
//     to the transaction. A crypto checkout that does not show the countdown is one where the
//     player cannot tell whether their quote is still good.
//
// WHERE IT DIVERGES, and it is in the player's favour: the leaders route payment through a
// primary-sales CONTRACT, which costs an approve prompt and then a pay prompt on every token
// purchase. This takes a plain transfer to a receive-only treasury address, so a token payment is
// ONE prompt and there is no allowance to grant, nothing to revoke afterwards, and no contract to
// deploy before the shop can open. The binding a contract would get from an on-chain reference is
// done by the server instead (net/lib/pay.js: ref + payer + single-use tx hash).
//
// THIS FILE CANNOT GRANT ANYTHING AND CANNOT NAME A PRICE. It asks the server for a quote, hands
// the wallet exactly the amount the server put in it, and sends back a transaction hash. Every
// number on screen comes from that quote.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined') return;
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const byId = id => document.getElementById(id);
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const KEY = 'ckPending';     // a paid-but-unclaimed checkout survives a reload here

  const css = `
  .ck-wrap{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
    padding:16px;background:rgba(3,5,9,.82);backdrop-filter:blur(3px)}
  .ck{width:min(430px,100%);max-height:92vh;overflow:auto;background:#0a0d14;border-radius:14px;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.09),0 30px 70px -20px #000;padding:18px}
  .ck h3{margin:0;font:800 19px/1.15 var(--disp,inherit);letter-spacing:.01em}
  .ck .ck-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  /* the item's own picture, the way Immutable's and Mavis Store's checkouts both lead with it: the
     sheet has to be obviously about the thing on the card you just tapped */
  .ck .ck-head{display:flex;align-items:center;gap:11px;min-width:0}
  .ck .ck-art{flex:0 0 auto;width:54px;height:54px;border-radius:10px;display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);overflow:hidden}
  .ck .ck-art svg,.ck .ck-art img{width:100%;height:100%;object-fit:contain;display:block}
  .ck .ck-eye{font:800 9.5px var(--mono);letter-spacing:.17em;text-transform:uppercase;color:var(--dim)}
  .ck .ck-x{background:none;border:0;color:var(--dim);font:800 18px var(--mono);cursor:pointer;padding:2px 6px}
  .ck .ck-x:hover{color:#fff}
  .ck .ck-usd{margin:2px 0 14px;font:800 26px var(--mono);color:var(--gold)}
  .ck .ck-lab{font:800 9.5px var(--mono);letter-spacing:.15em;text-transform:uppercase;color:var(--dim);margin:0 0 7px}
  /* a currency row: symbol + chain on the left, the amount it costs on the right, your balance under it */
  .ck-way{display:flex;align-items:center;gap:10px;width:100%;text-align:left;cursor:pointer;
    padding:9px 11px;margin-bottom:6px;border:0;border-radius:10px;color:#e8edf5;
    background:rgba(255,255,255,.04);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
  .ck-way:hover{background:rgba(255,255,255,.07)}
  .ck-way.on{box-shadow:inset 0 0 0 1.5px var(--red);background:rgba(255,42,74,.10)}
  .ck-way.no{opacity:.46;cursor:not-allowed}
  .ck-way .sy{font:800 13px var(--mono);letter-spacing:.02em}
  .ck-way .ch{font:700 9.5px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .ck-way .amt{margin-left:auto;text-align:right;font:800 13px var(--mono);color:var(--lime);white-space:nowrap}
  .ck-way .bal{display:block;font:700 9.5px var(--mono);letter-spacing:.06em;color:var(--dim);text-transform:uppercase}
  .ck .ck-go{width:100%;margin-top:12px;padding:13px;border:0;border-radius:11px;cursor:pointer;
    font:800 15px var(--mono);letter-spacing:.02em;color:#fff;background:var(--red)}
  .ck .ck-go:disabled{opacity:.5;cursor:default}
  .ck .ck-go.done{background:var(--lime);color:#05070b}
  .ck .ck-stat{margin:11px 0 0;font:600 12.5px/1.5 var(--mono);color:var(--muted)}
  .ck .ck-stat b{color:#fff}
  .ck .ck-stat.bad b{color:var(--red)}
  .ck .ck-wal{display:flex;align-items:center;gap:8px;margin-top:11px;font:700 10.5px var(--mono);
    letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
  .ck .ck-wal b{color:var(--muted);text-transform:none;letter-spacing:0}
  .ck .ck-fine{margin:12px 0 0;font:500 11px/1.55 var(--mono);color:var(--dim)}
  .ck a{color:var(--cyan)}
  `;

  // state for one checkout. `q` is the server's quote and is never edited here.
  const S = { open: false, item: null, cents: 0, name: '', curs: [], pick: null, acct: null,
    q: null, tx: null, stat: '', bad: false, busy: false, done: false, bal: {}, built: false, tick: 0 };

  function build() {
    if (S.built) return; S.built = true;
    const st = el('style'); st.textContent = css; document.head.appendChild(st);
    const w = el('div', 'ck-wrap'); w.id = 'ckWrap'; w.hidden = true;
    w.innerHTML = `<div class="ck" id="ckBox">
      <div class="ck-top">
        <div class="ck-head"><div class="ck-art" id="ckArt" hidden></div>
          <div><div class="ck-eye">Checkout</div><h3 id="ckName">Item</h3></div></div>
        <button class="ck-x" id="ckX" aria-label="Close">&times;</button></div>
      <div class="ck-usd" id="ckUsd">$0.00</div>
      <p class="ck-lab">Pay with</p>
      <div id="ckWays"></div>
      <div class="ck-wal" id="ckWal"></div>
      <button class="ck-go" id="ckGo">Connect a wallet</button>
      <p class="ck-stat" id="ckStat"></p>
      <p class="ck-fine" id="ckFine"></p>
    </div>`;
    document.body.appendChild(w);
    byId('ckX').onclick = () => { sfx(); close(); };
    byId('ckGo').onclick = () => { sfx(); go(); };
    // The backdrop closes the sheet, but NEVER while a payment is in flight: one stray tap at the
    // wrong moment would hide the one screen that knows the reference for a payment already sent.
    w.onclick = e => { if (e.target === w && !S.busy && !S.tx) close(); };
    addEventListener('keydown', e => { if (S.open && e.code === 'Escape' && !S.busy && !S.tx) { e.preventDefault(); close(); } }, true);
    setInterval(() => { if (S.open && S.q && !S.done) { S.tick++; paintStat(); } }, 1000);
  }

  // ---------- the wallet ----------
  // One provider, picked once. A browser with several wallets installed puts them in
  // `ethereum.providers`, and whichever one happens to be `window.ethereum` is not reliably the one
  // the player uses, so MetaMask wins when it is there.
  function prov() {
    const e = window.ethereum;
    if (!e) return null;
    if (Array.isArray(e.providers) && e.providers.length) return e.providers.find(p => p.isMetaMask) || e.providers[0];
    return e;
  }
  const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
  async function rpc(url, method, params) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
  async function connect() {
    const p = prov();
    if (!p) throw new Error('No wallet in this browser. Open the game in MetaMask, Rabby, Coinbase Wallet or any wallet browser and the checkout will find it.');
    const [a] = await p.request({ method: 'eth_requestAccounts' });
    if (!a) throw new Error('No account came back from the wallet.');
    S.acct = a.toLowerCase();
    p.on && p.on('accountsChanged', as => { S.acct = as && as[0] ? as[0].toLowerCase() : null; S.q = null; S.bal = {}; render(); });
    readBalances();
    return S.acct;
  }
  // Balances come off each chain's own public RPC, not the wallet: a wallet that is connected to
  // Arbitrum cannot answer for Robinhood Chain, and asking it to switch chains just to draw a
  // number would throw a prompt at somebody who has not chosen anything yet.
  function readBalances() {
    if (!S.acct) return;
    for (const c of S.curs) {
      if (!c.rpc) continue;
      const done = v => { S.bal[c.key] = v; render(); };
      const p = c.token
        ? rpc(c.rpc, 'eth_call', [{ to: c.token, data: '0x70a08231' + S.acct.replace(/^0x/, '').padStart(64, '0') }, 'latest'])
        : rpc(c.rpc, 'eth_getBalance', [S.acct, 'latest']);
      p.then(v => done(Number(BigInt(v)) / 10 ** c.dec)).catch(() => done(null));
    }
  }
  // Put the wallet on the chain this currency lives on. `wallet_addEthereumChain` is the fallback
  // for 4902 (chain unknown), which is the normal case for Robinhood Chain in a fresh MetaMask.
  async function onChain(c) {
    const p = prov();
    const want = '0x' + Number(c.chainId).toString(16);
    const now = await p.request({ method: 'eth_chainId' });
    if (String(now).toLowerCase() === want) return;
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); }
    catch (e) {
      if (e && e.code !== 4902) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: want, chainName: c.chainName,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [c.rpc],
        blockExplorerUrls: c.explorer ? [c.explorer] : [] }] });
    }
  }

  // ---------- the flow ----------
  function open(item) {
    build();
    S.open = true; S.item = item.id; S.name = item.name; S.cents = item.cents;
    S.curs = []; S.pick = null; S.q = null; S.tx = null; S.done = false; S.busy = false; S.stat = ''; S.bad = false;
    byId('ckWrap').hidden = false;
    // The button's job changes with the state, and the DONE state repoints it at `close`. Reset it
    // on every open or the second checkout of a session closes instead of paying.
    byId('ckGo').onclick = () => { sfx(); go(); };
    render();
    say('Reading prices…');
    Econ.payMenu(item.id, m => {
      if (!m.ok) return say(m.msg || 'The store could not quote a price.', true);
      S.curs = (m.curs || []).filter(c => c.amount);
      if (!S.curs.length) return say('No currency is quotable right now. Try again in a moment.', true);
      // default to the first stable, which is the one with no price risk between here and the block
      S.pick = (S.curs.find(c => c.cur === 'USDC') || S.curs[0]).key;
      S.stat = '';
      render();
      if (S.acct) readBalances();
      resume();
    });
  }
  function close() {
    S.open = false;
    const w = byId('ckWrap'); if (w) w.hidden = true;
  }
  function say(msg, bad) { S.stat = msg || ''; S.bad = !!bad; paintStat(); }

  // THE PAY BUTTON, and it is one button with four jobs so there is never a second thing to find.
  function go() {
    if (S.busy || S.done) return;
    if (!S.acct) { S.busy = true; render(); return connect().then(() => { S.busy = false; say(''); render(); }).catch(e => { S.busy = false; say(e.message, true); render(); }); }
    if (!S.q) return quote();
    return pay();
  }
  function quote() {
    const c = cur(); if (!c) return say('Pick a currency.', true);
    S.busy = true; say('Locking the price…'); render();
    Econ.payQuote(S.item, c.key, S.acct, r => {
      S.busy = false;
      if (!r.ok) { say(r.msg || 'Could not get a quote.', true); return render(); }
      S.q = r; S.tick = 0; say('');
      render();
    });
  }
  async function pay() {
    const q = S.q, c = cur();
    if (!q || !c) return;
    // THE PINNED TREASURY. The address comes from the game server, so a server that has been
    // tampered with could point every purchase at somebody else's wallet. `STORE_PINS` is baked
    // into the page at build time from net/pay.json (build.py), and a quote that does not match it
    // is refused here rather than signed. Same rule, and the same reason, as ESCROW_LIVE.
    if (typeof STORE_PINS !== 'undefined' && STORE_PINS) {
      const pin = STORE_PINS[String(q.chainId)];
      if (!pin || String(pin).toLowerCase() !== String(q.to).toLowerCase()) {
        return say('This build will not pay that address. Reload the game; if it says this again, do not pay.', true);
      }
    }
    S.busy = true; say('Confirm it in your wallet…'); render();
    try {
      await onChain(c);
      const p = prov();
      const tx = q.token
        // A plain ERC20 transfer: transfer(address,uint256). One prompt, no allowance, nothing left
        // approved afterwards. The amount is `amountRaw` from the server, untouched.
        ? { from: S.acct, to: q.token, data: '0xa9059cbb' + q.to.replace(/^0x/, '').padStart(64, '0')
            + BigInt(q.amountRaw).toString(16).padStart(64, '0') }
        : { from: S.acct, to: q.to, value: '0x' + BigInt(q.amountRaw).toString(16) };
      const hash = await p.request({ method: 'eth_sendTransaction', params: [tx] });
      S.tx = hash;
      // Written down BEFORE anything else can go wrong: from here on the money is gone and the only
      // thing that matters is that this reference and this hash reach the server, even if the page
      // is reloaded or the socket drops in between.
      try { localStorage.setItem(KEY, JSON.stringify({ ref: q.ref, tx: hash, item: S.item, name: S.name, at: Date.now() })); } catch (e) { /* storage blocked */ }
      S.busy = false; render();
      claim(0);
    } catch (e) {
      S.busy = false;
      const m = String((e && e.message) || e);
      say(/denied|rejected|4001/i.test(m) ? 'Payment cancelled. Nothing was charged.' : m, true);
      render();
    }
  }
  // Ask the server to verify. `retry` means "not yet" (unmined, unconfirmed, RPC blipped), so this
  // keeps asking for two minutes before it tells the player to come back — it never gives up in a
  // way that loses the reference, because the reference is in localStorage until it is credited.
  function claim(n) {
    if (!S.tx) return;
    const ref = (S.q && S.q.ref) || (pending() || {}).ref;
    say('Payment sent. Confirming on-chain…');
    Econ.payClaim(ref, S.tx, r => {
      if (r.ok) {
        S.done = true; S.busy = false;
        try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
        say(r.msg || 'Paid. It is on your account.');
        sfx('coin');
        render();
        try { if (window.EconUI && EconUI.note) EconUI.note(r.msg || (S.name + ' is yours.'), 'Paid'); } catch (e) { /* toast is optional */ }
        return;
      }
      if (r.retry && n < 48) return setTimeout(() => claim(n + 1), 2500);
      say((r.msg || 'That payment did not verify.') + (r.retry ? ' Reopen the store and it will try again — the payment is saved on this device.' : ''), true);
      render();
    });
  }
  function pending() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  // A payment that was sent and never credited (tab closed, server restarted, laptop shut) is
  // picked up the next time the checkout opens. The server keeps its side of the quote for 48 h.
  function resume() {
    const p = pending();
    if (!p || !p.ref || !p.tx) return;
    if (Date.now() - (p.at || 0) > 48 * 3600e3) { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } return; }
    S.tx = p.tx; S.q = Object.assign({}, S.q || {}, { ref: p.ref });
    render();
    claim(0);
  }

  const cur = () => S.curs.find(c => c.key === S.pick) || null;

  // ---------- drawing ----------
  function render() {
    if (!S.built || !S.open) return;
    byId('ckName').textContent = S.name || 'Item';
    byId('ckUsd').textContent = Econ.money(S.cents);
    // The item's baked picture when it has one. A vault stage has a backdrop rather than item art,
    // and an empty plate reads worse than no plate, so the box hides itself instead of showing one.
    const art = byId('ckArt');
    const hasArt = !!(window.ItemArt && S.item && ItemArt.has(S.item));
    art.hidden = !hasArt;
    if (hasArt && art.dataset.of !== S.item) { art.innerHTML = ItemArt.html(S.item, '#fff', 54); art.dataset.of = S.item; }
    const ways = byId('ckWays');
    ways.textContent = '';
    for (const c of S.curs) {
      const b = el('button', 'ck-way' + (c.key === S.pick ? ' on' : ''));
      const left = el('div');
      left.appendChild(el('div', 'sy', c.symbol));
      left.appendChild(el('div', 'ch', c.chainName));
      // a long symbol (WOLVERINU) is already on the left of the row, so the amount stands alone
      const right = el('div', 'amt', c.symbol.length > 6 ? c.amount : c.amount + ' ' + c.symbol);
      const bal = S.bal[c.key];
      // Short balance greys the row the way Mavis Store does, and says so rather than failing in
      // the wallet. `null` means the balance read failed, which is not the same as zero.
      const shortOf = bal != null && bal < Number(c.amount);
      if (bal != null) right.appendChild(el('span', 'bal', shortOf ? 'you have ' + trim(bal) : 'balance ' + trim(bal)));
      if (shortOf) b.classList.add('no');
      b.appendChild(left); b.appendChild(right);
      b.onclick = () => {
        if (S.busy || S.tx) return;
        sfx();
        if (shortOf) return say('Not enough ' + c.symbol + ' in that wallet for this one. Pick another currency.', true);
        S.pick = c.key; S.q = null; say(''); render();
      };
      ways.appendChild(b);
    }
    const w = byId('ckWal');
    w.textContent = '';
    if (S.acct) { w.appendChild(el('span', '', 'Wallet')); w.appendChild(el('b', '', short(S.acct))); }
    const g = byId('ckGo');
    g.classList.toggle('done', S.done);
    g.disabled = S.busy || (!!S.tx && !S.done) || (!S.curs.length && !!S.acct);
    g.textContent = S.done ? 'Done' : S.tx ? 'Confirming…' : S.busy ? 'Working…'
      : !S.acct ? 'Connect a wallet'
        : !S.q ? 'Pay with ' + ((cur() || {}).symbol || '…')
          : 'Send ' + S.q.amount + ' ' + S.q.symbol;
    if (S.done) g.onclick = () => { sfx(); close(); };
    // The fine print says the two things a crypto checkout has to say: where the money goes, and
    // that the item is tied to the account rather than to the wallet that paid.
    const f = byId('ckFine');
    const q = S.q;
    f.innerHTML = q
      ? 'Sending <b>' + q.amount + ' ' + q.symbol + '</b> to <b>' + short(q.to) + '</b> on ' + q.chainName
        + '. It unlocks on your account, not on this wallet.'
      : 'Prices are in dollars and converted at the live rate. Whatever you pay with, the item unlocks on your Brawl Street account and follows you to any device.';
    paintStat();
  }
  const trim = n => (n >= 1000 ? Math.round(n).toLocaleString() : n >= 1 ? n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : n.toPrecision(3));
  function paintStat() {
    const s = byId('ckStat'); if (!s) return;
    s.classList.toggle('bad', S.bad);
    let msg = S.stat;
    // the locked-rate countdown, Coinbase Commerce's one: a quote the player cannot see expiring is
    // a quote that fails in the wallet for no visible reason
    if (S.q && !S.tx && !S.done && S.q.expires) {
      const left = Math.max(0, Math.round((S.q.expires - Date.now()) / 1000));
      if (left > 0) msg = (msg ? msg + ' ' : '') + 'This price is held for ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + '.';
      else { S.q = null; S.stat = 'That price expired. Tap to get a fresh one — nothing was charged.'; S.bad = true; render(); return; }
    }
    s.textContent = '';
    if (msg) s.appendChild(el('span', '', msg));
    if (S.tx) {
      const c = cur();
      if (c && c.explorer) {
        s.appendChild(document.createTextNode(' '));
        const a = el('a', '', 'View the transaction');
        a.href = c.explorer.replace(/\/$/, '') + '/tx/' + S.tx; a.target = '_blank'; a.rel = 'noopener';
        s.appendChild(a);
      }
    }
  }

  // The store calls this with the server's `checkout` block. It is the only entry point.
  window.Checkout = {
    open(item) { if (item && item.id) open(item); },
    // true when the server has said it is taking crypto, which is what the store checks before it
    // sends a click here rather than to a toast.
    live() { try { return Econ.payMode() === 'chain'; } catch (e) { return false; } },
    // on boot: a payment that was sent and never credited is claimed without opening anything
    sweep() {
      const p = pending();
      if (!p || !p.ref || !p.tx || !Econ.connected()) return;
      Econ.payClaim(p.ref, p.tx, r => {
        if (r.ok) {
          try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
          try { if (window.EconUI && EconUI.note) EconUI.note(r.msg || 'Your last payment came through.', 'Paid'); } catch (e) { /* ignore */ }
        }
      });
    },
  };
  // A payment that was sent and never credited is claimed on boot, but the socket only opens when
  // somebody goes online — so this waits for it rather than firing once into a disconnected page.
  // It does nothing at all unless there is a payment saved on this device.
  let tries = 0;
  const bootSweep = () => {
    try {
      if (!pending() || tries++ > 12) return;
      if (!Econ.connected()) return void setTimeout(bootSweep, 12000);
      Checkout.sweep();
    } catch (e) { /* never block boot */ }
  };
  setTimeout(bootSweep, 6000);
})();
