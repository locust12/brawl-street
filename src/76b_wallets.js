// ===== wallets: every wallet, one door =====
// A browser wallet announces itself over EIP-6963, so one listener finds MetaMask, Rabby, Coinbase
// Wallet, OKX, Trust, Phantom, Brave, Zerion, Frame, Bitget and anything else installed -- no SDK,
// no per-wallet code, nothing to keep up to date as new wallets ship. Wallets older than 6963 only
// know window.ethereum, and when several of those are installed they queue up in
// window.ethereum.providers; both are folded into the same list. Phones have no extensions at all,
// so there the only way in is the wallet's own in-app browser: we hand it this exact URL by deep
// link, and offer the link itself for any wallet we do not name.
//
// Every page that wanted a wallet used to read window.ethereum directly, which meant: whichever
// extension won the race for that property was the only wallet anyone could use, a person with two
// wallets installed got the wrong one, a phone got "No wallet found", and a declined request died in
// a toast nobody reads. So this file also PUTS ITSELF IN window.ethereum's place: every existing
// `window.ethereum.request(...)` call site -- the arena's connect and bet, online play's sign-in,
// deposits, refunds and claims -- keeps working untouched and now opens the picker, switches the
// network and reports refusals in words. Nothing else in src/ needs to change, which is the point:
// the wallet layer can be fixed without touching fight code.
const WAL = (() => {
  // Robinhood Chain, used only when a caller does not spell the network out.
  const CHAIN = { id: 4663, name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' };
  const LAST = 'bs.wallet.last';
  const W = { p: null, info: null, addr: null };
  const found = new Map();   // key -> { info, provider }
  const subs = [];
  let sheet = null, pending = null, note = '', native = null;

  const phone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (matchMedia('(max-width:820px)').matches && 'ontouchstart' in window);
  const key = d => d.info.rdns || d.info.uuid || d.info.name;
  const rq = (p, method, params) => p.request(params ? { method, params } : { method });

  // what a wallet that predates EIP-6963 calls itself
  function legacyName(p) {
    return p.isRabby ? 'Rabby' : p.isMetaMask ? 'MetaMask' : p.isCoinbaseWallet || p.isCoinbaseBrowser ? 'Coinbase Wallet'
      : p.isTrust || p.isTrustWallet ? 'Trust Wallet' : p.isOkxWallet || p.isOKExWallet ? 'OKX Wallet'
      : p.isPhantom ? 'Phantom' : p.isBraveWallet ? 'Brave Wallet' : p.isZerion ? 'Zerion'
      : p.isFrame ? 'Frame' : p.isTokenPocket ? 'TokenPocket' : p.isBitKeep || p.isBitget ? 'Bitget Wallet'
      : p.isRainbow ? 'Rainbow' : p.isExodus ? 'Exodus' : 'Browser wallet';
  }
  function legacy() {
    const e = native; if (!e || e.isWAL) return [];
    const list = Array.isArray(e.providers) && e.providers.length ? e.providers : [e];
    return list.filter(p => p && !p.isWAL && typeof p.request === 'function')
      .map(p => ({ info: { rdns: 'injected:' + legacyName(p), name: legacyName(p) }, provider: p }));
  }
  function list() {
    const m = new Map(found);
    // only fall back to the injected property when nothing announced itself over 6963, or the
    // same wallet shows up twice in the picker
    if (!m.size) for (const d of legacy()) m.set(key(d), d);
    return [...m.values()];
  }

  // phone deep links: open this page inside the wallet app's own browser
  const url = () => location.href;
  const bare = () => location.href.replace(/^https?:\/\//, '');
  const APPS = [
    { name: 'MetaMask', link: () => 'https://metamask.app.link/dapp/' + bare() },
    { name: 'Coinbase Wallet', link: () => 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(url()) },
    { name: 'Trust Wallet', link: () => 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(url()) },
    { name: 'Phantom', link: () => 'https://phantom.app/ul/browse/' + encodeURIComponent(url()) + '?ref=' + encodeURIComponent(location.origin) },
    { name: 'OKX Wallet', link: () => 'okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(url()) },
    { name: 'Bitget Wallet', link: () => 'https://bkcode.vip?action=dapp&url=' + encodeURIComponent(url()) },
  ];

  const emit = () => subs.forEach(f => { try { f(W.addr); } catch (e) { } });

  function adopt(d, a) {
    W.p = d.provider; W.info = d.info; W.addr = a;
    try { localStorage.setItem(LAST, key(d)); } catch (e) { }
    if (!d.provider.__walBound && typeof d.provider.on === 'function') {
      d.provider.__walBound = 1;
      d.provider.on('accountsChanged', as => {
        W.addr = as && as[0] ? as[0] : null;
        if (!W.addr) { try { localStorage.removeItem(LAST); } catch (e) { } }
        emit();
      });
      d.provider.on('chainChanged', () => emit());
      d.provider.on('disconnect', () => { W.addr = null; emit(); });
    }
    emit();
  }

  // the message a person can act on, instead of a provider error code
  function say(e, who) {
    const c = e && e.code, m = (e && (e.message || (e.data && e.data.message))) || String(e || '');
    if (c === 4001 || /reject|denied|cancel/i.test(m)) return 'You turned the request down in ' + who + '.';
    if (c === -32002 || /already pending|already processing/i.test(m)) return 'Open ' + who + ' and finish the request already waiting there.';
    if (c === 4100) return who + ' has not unlocked this account yet. Unlock it and try again.';
    if (c === 4902) return who + ' does not have this network yet. Approve adding it.';
    return String(m).replace(/^Error:\s*/, '') || 'That wallet refused the request.';
  }

  async function ensureChain(c) {
    if (!c || !c.chainId || !W.p) return;
    const want = '0x' + Number(c.chainId).toString(16), who = (W.info && W.info.name) || 'your wallet';
    let have = null;
    try { have = await rq(W.p, 'eth_chainId'); } catch (e) { }
    if (have === want) return;
    const add = [{
      chainId: want, chainName: c.chainName || CHAIN.name,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: [c.rpc || CHAIN.rpc].filter(Boolean),
      blockExplorerUrls: [c.explorer || CHAIN.explorer].filter(Boolean),
    }];
    try {
      await rq(W.p, 'wallet_switchEthereumChain', [{ chainId: want }]);
    } catch (e) {
      const unknown = e && (e.code === 4902 || e.code === -32603 || /unrecognized|unsupported|not been added|add this network/i.test(e.message || ''));
      if (!unknown) throw new Error(say(e, who));
      try {
        await rq(W.p, 'wallet_addEthereumChain', add);
        await rq(W.p, 'wallet_switchEthereumChain', [{ chainId: want }]).catch(() => { });
      } catch (e2) { throw new Error(say(e2, who)); }
    }
  }

  // ---------------- the picker ----------------
  function css() {
    if (document.getElementById('walCss')) return;
    const s = document.createElement('style'); s.id = 'walCss';
    s.textContent = `
.wal-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;
  background:rgba(3,3,6,.82);backdrop-filter:blur(6px);font-family:'Space Grotesk',system-ui,sans-serif;color:#e8e9ee}
.wal-box{width:100%;max-width:420px;max-height:88vh;overflow:auto;background:#0b0b10;border:1px solid #23232c;border-radius:16px;
  box-shadow:0 30px 90px rgba(0,0,0,.7);padding:20px 20px 16px}
.wal-top{display:flex;align-items:baseline;gap:10px;margin:0 0 4px}
.wal-h{font-family:'Barlow Condensed',Impact,sans-serif;font-style:italic;font-weight:900;font-size:30px;letter-spacing:.5px;margin:0;flex:1}
.wal-x{background:none;border:0;color:#8b8d99;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}
.wal-x:hover{color:#fff}
.wal-sub{color:#9a9cab;font-size:13px;margin:0 0 14px}
.wal-list{display:flex;flex-direction:column;gap:8px}
.wal-w{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;color:#e8e9ee;text-decoration:none;
  background:#13131a;border:1px solid #23232c;border-radius:12px;padding:12px 14px;font:600 15px 'Space Grotesk',system-ui,sans-serif}
.wal-w:hover{border-color:#ff2a4a;background:#17171f}
.wal-w img{width:28px;height:28px;border-radius:7px;flex:none}
.wal-mono{width:28px;height:28px;border-radius:7px;flex:none;display:grid;place-items:center;background:#1d1d26;color:#27e1ff;
  font:800 13px 'JetBrains Mono',monospace}
.wal-w b{margin-left:auto;font-weight:500;font-size:12px;color:#6f7280}
.wal-sec{margin:16px 0 8px;font:700 11px 'JetBrains Mono',monospace;letter-spacing:1.4px;color:#6f7280;text-transform:uppercase}
.wal-err{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:rgba(255,42,74,.12);border:1px solid rgba(255,42,74,.4);
  color:#ff8a9c;font-size:13px;display:none}
.wal-foot{margin-top:14px;display:flex;gap:8px;align-items:center}
.wal-link{flex:1;font:500 12px 'JetBrains Mono',monospace;color:#6f7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wal-copy{background:#1d1d26;border:1px solid #2b2b36;color:#27e1ff;border-radius:9px;padding:8px 12px;cursor:pointer;
  font:700 12px 'Space Grotesk',system-ui,sans-serif}
.wal-copy:hover{border-color:#27e1ff}
.wal-busy{opacity:.55;pointer-events:none}
.wal-chip{position:fixed;top:12px;right:12px;z-index:2147482000;display:flex;align-items:center;gap:8px;cursor:pointer;
  background:rgba(19,19,26,.92);border:1px solid #2b2b36;color:#e8e9ee;border-radius:999px;padding:9px 15px;
  font:700 13px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.2px;backdrop-filter:blur(4px)}
.wal-chip:hover{border-color:#ff2a4a;background:rgba(23,23,31,.96)}
.wal-chip.on{color:#27e1ff;border-color:#214a55}
.wal-dot{width:7px;height:7px;border-radius:50%;background:#27e1ff;flex:none}
@media (max-width:820px){.wal-chip{top:8px;right:8px;padding:8px 12px;font-size:12px}}`;
    document.head.appendChild(s);
  }

  function close() {
    if (!sheet) return;
    sheet.remove(); sheet = null; note = '';
    removeEventListener('keydown', keys, true);
    if (pending) { const p = pending; pending = null; p.reject(new Error('No wallet chosen.')); }
  }
  function keys(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    e.stopPropagation();   // the fight reads the keyboard off window; it must not read it through the sheet
  }

  function row(name, icon, tag) {
    const el = document.createElement(tag === 'Open app' ? 'a' : 'button');
    el.className = 'wal-w';
    if (el.tagName === 'BUTTON') el.type = 'button'; else el.rel = 'noopener';
    el.innerHTML = (icon ? '<img alt="">' : `<span class="wal-mono">${(name || '?').slice(0, 1)}</span>`) + '<span class="wal-nm"></span><b></b>';
    if (icon) el.querySelector('img').src = icon;
    el.querySelector('.wal-nm').textContent = name || 'Browser wallet';
    el.querySelector('b').textContent = tag;
    return el;
  }

  function fill() {
    if (!sheet) return;
    const box = sheet.querySelector('.wal-list'), ext = list();
    box.innerHTML = '';
    if (W.addr) {
      const h = document.createElement('div'); h.className = 'wal-sec'; h.textContent = 'Connected';
      box.appendChild(h);
      const cur = row(short(W.addr) + ' in ' + ((W.info && W.info.name) || 'your wallet'), W.info && W.info.icon, 'Disconnect');
      cur.onclick = () => { disconnect(); fill(); };
      box.appendChild(cur);
      const sw = document.createElement('div'); sw.className = 'wal-sec'; sw.textContent = 'Switch to';
      box.appendChild(sw);
    }
    for (const d of ext) {
      const el = row(d.info.name, d.info.icon, 'Installed');
      el.onclick = () => take(d).catch(() => { });
      box.appendChild(el);
    }
    if (!ext.length) {
      const p = document.createElement('p'); p.className = 'wal-sub';
      p.textContent = phone() ? 'Pick your wallet app and this page opens inside it.'
        : 'No wallet extension answered in this browser. Open the page in your wallet app instead, or install one.';
      box.appendChild(p);
    }
    if (!ext.length || phone()) {
      const h = document.createElement('div'); h.className = 'wal-sec'; h.textContent = 'Wallet apps';
      box.appendChild(h);
      for (const a of APPS) {
        const el = row(a.name, null, 'Open app');
        el.href = a.link();
        box.appendChild(el);
      }
    }
    const err = sheet.querySelector('.wal-err');
    err.textContent = note; err.style.display = note ? 'block' : 'none';
  }

  function open() {
    css();
    if (sheet) { fill(); return; }
    sheet = document.createElement('div');
    sheet.className = 'wal-wrap';
    sheet.innerHTML = `<div class="wal-box" role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <div class="wal-top"><h2 class="wal-h">Connect a wallet</h2><button class="wal-x" type="button" aria-label="Close">&times;</button></div>
      <p class="wal-sub">Any wallet works. Nothing is signed until you approve it.</p>
      <div class="wal-list"></div>
      <div class="wal-err"></div>
      <div class="wal-foot"><span class="wal-link"></span><button class="wal-copy" type="button">Copy link</button></div>
    </div>`;
    sheet.querySelector('.wal-x').onclick = close;
    sheet.onclick = e => { if (e.target === sheet) close(); };
    sheet.querySelector('.wal-link').textContent = location.host + location.pathname;
    const cp = sheet.querySelector('.wal-copy');
    cp.onclick = () => {
      const done = () => { cp.textContent = 'Copied'; setTimeout(() => cp.textContent = 'Copy link', 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(url()).then(done, () => { }); else done();
    };
    addEventListener('keydown', keys, true);
    document.body.appendChild(sheet);
    announce();            // one more poke: a wallet that loaded late still gets listed
    fill();
  }

  async function take(d) {
    const who = (d.info && d.info.name) || 'that wallet';
    const box = sheet && sheet.querySelector('.wal-list');
    if (box) box.classList.add('wal-busy');
    try {
      const as = await rq(d.provider, 'eth_requestAccounts');
      if (!as || !as.length) throw new Error(who + ' returned no account. Unlock it and try again.');
      adopt(d, as[0]);
      const p = pending; pending = null;
      close();
      if (p) p.resolve(W.addr);
      return W.addr;
    } catch (e) {
      note = say(e, who);
      if (box) box.classList.remove('wal-busy');
      fill();
      throw new Error(note);
    }
  }

  function sheetPromise() {
    if (pending) { open(); return pending.promise; }
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    pending = { resolve, reject, promise };
    open();
    return promise;
  }

  // Settles when a wallet is connected, or when the person closes the picker. With exactly one
  // wallet in the browser there is nothing to pick, so the click goes straight to that wallet and
  // its own popup comes up; a menu in front of it would be a second click for no decision. The
  // picker is for the real cases: several wallets installed, or none, or one that just refused.
  function choose() {
    if (W.addr && W.p) return Promise.resolve(W.addr);
    if (pending) { open(); return pending.promise; }
    const ext = list();
    if (ext.length === 1) return take(ext[0]).catch(() => sheetPromise());
    return sheetPromise();
  }

  async function connect(chain) {
    const a = await choose();
    if (chain) await ensureChain(chain);
    return a;
  }

  // ---------------- standing in for window.ethereum ----------------
  // Methods that move money or identity must have a wallet first, so they open the picker. Reads
  // must never pop a dialog on their own.
  const NEEDS = /^(eth_requestAccounts|eth_sendTransaction|eth_signTransaction|personal_sign|eth_sign|eth_signTypedData|eth_signTypedData_v[34]|wallet_)/;
  const PROXY = {
    isWAL: true,
    get selectedAddress() { return W.addr; },
    get chainId() { return null; },
    async request(o) {
      const m = o && o.method, params = o && o.params;
      if (m === 'eth_accounts') return W.addr ? [W.addr] : [];
      if (m === 'eth_requestAccounts') { await choose(); return [W.addr]; }
      if (NEEDS.test(m || '')) await choose();
      if (!W.p) throw new Error('Connect a wallet first.');
      try { return await rq(W.p, m, params); }
      catch (e) { throw new Error(say(e, (W.info && W.info.name) || 'your wallet')); }
    },
    on(ev, fn) {
      if (ev === 'accountsChanged') subs.push(a => fn(a ? [a] : []));
      else if (W.p && typeof W.p.on === 'function') W.p.on(ev, fn);
      return PROXY;
    },
    removeListener() { return PROXY; },
    // a few wallets are probed by flag before use
    get isMetaMask() { return !!(W.p && W.p.isMetaMask); },
    enable() { return PROXY.request({ method: 'eth_requestAccounts' }); },
  };

  // ---------------- the button ----------------
  // Nothing in the page offered a way in. The arena's own Connect wallet only renders once a
  // contract is live (ARENA_LIVE), and online play hides its one behind a real-stakes room, so on
  // the build people actually open there is no way to connect at all. The layer brings its own
  // button: on the menus, out of the way, gone the moment a fight starts.
  const short = a => a.slice(0, 6) + '…' + a.slice(-4);
  function paintChip() {
    const b = document.getElementById('walChip'); if (!b) return;
    b.textContent = '';
    if (W.addr) {
      const d = document.createElement('i'); d.className = 'wal-dot'; b.appendChild(d);
      b.appendChild(document.createTextNode(short(W.addr)));
    } else b.appendChild(document.createTextNode('Connect wallet'));
    b.classList.toggle('on', !!W.addr);
    b.title = W.addr ? 'Connected with ' + ((W.info && W.info.name) || 'your wallet') : 'Connect any wallet';
  }
  // the same test the controls card uses (87_controls.js): a match is running and no menu is up
  const inMatch = () => { try { return Game.state === 'match' && !Game.demo && document.querySelectorAll('.screen:not([hidden])').length === 0; } catch (e) { return false; } };
  function mount() {
    css();
    if (document.getElementById('walChip')) return;
    const b = document.createElement('button');
    b.id = 'walChip'; b.type = 'button'; b.className = 'wal-chip';
    b.onclick = () => { if (W.addr) open(); else connect(null).catch(() => { }); };
    document.body.appendChild(b);
    subs.push(paintChip);
    paintChip();
    setInterval(() => { b.style.display = inMatch() ? 'none' : 'flex'; }, 500);
  }

  function install() {
    const cur = window.ethereum;
    if (cur && cur.isWAL) return;
    if (cur) native = cur;
    try {
      Object.defineProperty(window, 'ethereum', { value: PROXY, writable: true, configurable: true });
    } catch (e) {
      try { window.ethereum = PROXY; } catch (e2) { }   // locked down by the extension: leave it alone
    }
  }

  // ---------------- discovery ----------------
  addEventListener('eip6963:announceProvider', e => {
    const d = e.detail;
    if (!d || !d.info || !d.provider || d.provider.isWAL) return;
    found.set(key(d), d);
    if (sheet) fill();
  });
  const announce = () => dispatchEvent(new Event('eip6963:requestProvider'));

  // come back to the wallet the person used last, without prompting them
  async function restore() {
    let id = null; try { id = localStorage.getItem(LAST); } catch (e) { }
    if (!id) return;
    for (let i = 0; i < 20 && !found.size; i++) await new Promise(r => setTimeout(r, 100));
    const d = list().find(x => key(x) === id);
    if (!d) return;
    try { const as = await rq(d.provider, 'eth_accounts'); if (as && as[0]) adopt(d, as[0]); } catch (e) { }
  }

  install();
  announce();
  setTimeout(announce, 200);
  setTimeout(announce, 1200);
  addEventListener('ethereum#initialized', install);   // a wallet that injects late
  addEventListener('load', () => { install(); announce(); restore(); mount(); });
  if (document.readyState === 'complete') { restore(); mount(); }
  else if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount);

  return {
    connect, request: o => PROXY.request(o), req: (m, p) => PROXY.request(p ? { method: m, params: p } : { method: m }),
    ensureChain, open, close, list, onChange: f => subs.push(f),
    disconnect() { W.p = null; W.info = null; W.addr = null; try { localStorage.removeItem(LAST); } catch (e) { } emit(); },
    get addr() { return W.addr; },
    get p() { return W.p; },
    get name() { return (W.info && W.info.name) || null; },
    chain: CHAIN,
  };
})();
