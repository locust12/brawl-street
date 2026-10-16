// ===== Connect X: link a real X account, the way every serious app does it =====
// Entry points: the title screen plate, the online lobby profile, the Profile screen, the fighter
// creator and the pause menu.
//
// The flow is "Sign in with X" in a POPUP WINDOW -- the same pattern Privy, Dynamic and thirdweb
// use. Pressing Connect X opens a small window on the verify origin (CONNECT), which sends the
// player to X's own authorise screen; X sends them back; the window posts the handle here and
// closes. No typing, no pasting, nothing to install, and the game never sees a password.
//
// The verify origin finishes the OAuth exchange because a browser cannot (X only talks OAuth to a
// server). When its X app isn't switched on yet, the popup says so instead of offering a worse way.
// A connected handle is the only one shown with a check and turned into a link.
(() => {
  const KEY = 'xlink';
  const CONNECT = (typeof window !== 'undefined' && window.BS_XCONNECT) || 'https://bs-xverify.vercel.app/connect.html';
  const st = () => { try { return store.get(KEY, null); } catch (e) { return null; } };
  const save = v => { try { store.set(KEY, v); } catch (e) { /* storage off */ } paint(); };
  const sfx = () => { try { Sfx.ui(); } catch (e) { /* audio locked */ } };
  const byId = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const handle = () => { const s = st(); return s && s.h ? s.h : ''; };

  const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  const css = `
  .xl-chip{display:inline-flex;align-items:center;gap:6px;font:700 12px var(--mono);letter-spacing:.06em;color:var(--lime)}
  .tb-item .xl-h{grid-column:3;grid-row:1/span 2;font:700 12px var(--mono);color:var(--lime);font-style:normal;opacity:1;transform:none}
  #xlTitleBtn b{display:flex;align-items:center;gap:8px}
  #xlTitleBtn b svg{width:19px;height:19px;fill:currentColor;flex:none}
  .xl-mini svg{width:13px;height:13px;fill:currentColor;vertical-align:-2px;margin-right:5px}
  `;
  let styled = false;
  function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
  function netOpen() { return !!(window.Net && Net.state && Net.state.conn === 'open'); }

  // ---------------------------------------------------------------- the popup
  let win = null, timer = null;
  function open() {
    style();
    // a one-time code ties this game account to the X sign-in, so the game server can confirm it too
    let code = '';
    try { code = store.get('xlinkCode', ''); if (!code) { code = 'BS-' + Math.random().toString(36).slice(2, 8).toUpperCase(); store.set('xlinkCode', code); } } catch (e) {}
    if (netOpen()) Net.send({ k: 'x_start' });   // server issues/confirms its own code when online

    const w = 460, h = 620;
    const y = Math.max(0, (screen.height - h) / 2 + (screen.availTop || 0));
    const x = Math.max(0, (screen.width - w) / 2 + (screen.availLeft || 0));
    const url = CONNECT + '?o=' + encodeURIComponent(location.origin) + '&code=' + encodeURIComponent(code);
    try { win = window.open(url, 'bs_connect_x', `popup=1,width=${w},height=${h},left=${x},top=${y}`); } catch (e) { win = null; }
    if (!win) { if (window.Net && Net.toast) Net.toast('Allow pop-ups for this site, then press Connect X again.', true); return; }
    try { win.focus(); } catch (e) {}
    clearInterval(timer);
    timer = setInterval(() => { if (!win || win.closed) { clearInterval(timer); win = null; } }, 600);
  }

  // the popup posts its result back here
  addEventListener('message', ev => {
    try { if (new URL(CONNECT).origin !== ev.origin) return; } catch (e) { return; }
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.bsx === 'linked' && m.h && /^[a-z0-9_]{1,15}$/.test(String(m.h))) {
      save({ h: String(m.h).toLowerCase(), id: m.id || '', at: Date.now(), v: true });
      pushToLook(m.h);
      if (netOpen()) Net.send({ k: 'x_claim', h: String(m.h).toLowerCase(), id: m.id || '', code: m.code || '', tok: m.tok || '' });
      try { Sfx.coin(); } catch (e) {}
      if (window.Net && Net.toast) Net.toast('X connected: @' + String(m.h).toLowerCase());
      try { if (win && !win.closed) win.close(); } catch (e) {}
    }
  });

  function disconnect() {
    try { store.set(KEY, null); } catch (e) {}
    if (netOpen()) Net.send({ k: 'x_unlink' });
    pushToLook('');
    paint();
    if (window.Net && Net.toast) Net.toast('X disconnected');
  }

  // the handle rides along on the saved fighter, which rooms, name tags and the board read
  function pushToLook(h) {
    try {
      if (!window.CustomLook || !CustomLook.get) return;
      const lk = CustomLook.get(); if (!lk) return;
      if ((lk.x || '') === (h || '')) return;
      lk.x = h || ''; CustomLook.set(lk);
    } catch (e) { /* creator not loaded in this build */ }
    const f = byId('cfX'); if (f && f.value !== (h || '')) { f.value = h || ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  // ---------------------------------------------------------------- entry points
  function titlePlate() {
    const menu = document.querySelector('#scTitle .tb-menu'); if (!menu) return null;
    let b = byId('xlTitleBtn');
    if (!b) {
      style();
      b = document.createElement('button'); b.id = 'xlTitleBtn'; b.className = 'tb-item tb-cyan';
      b.addEventListener('mouseenter', () => sfx());
      b.addEventListener('click', () => { sfx(); open(); });
      const help = byId('bHelp');
      menu.insertBefore(b, help && help.parentElement === menu ? help : null);
    }
    const h = handle();
    if (b.dataset.h === h) return b;          // 85_menu numbers the plates; don't trample it every repaint
    b.dataset.h = h;
    const n = (b.querySelector('i') || {}).textContent || '';
    b.innerHTML = `<i>${esc(n)}</i><b>${MARK}${h ? 'X connected' : 'Connect X'}</b>` +
      (h ? `<em class="xl-h">@${esc(h)}</em>` : '<em>▶</em>') +
      `<small>${h ? 'Your handle shows on your fighter, in rooms and on the leaderboard' : 'Sign in with X, with a check next to your name'}</small>`;
    return b;
  }
  function paint() {
    titlePlate();
    // the fighter creator's own slot
    for (const host of document.querySelectorAll('#xlSlot')) {
      let c = host.querySelector('.xl-mini');
      if (!c) { c = document.createElement('button'); c.className = 'btn small xl-mini'; c.onclick = () => { sfx(); open(); }; host.appendChild(c); }
      c.innerHTML = MARK + (handle() ? '@' + esc(handle()) : 'Connect X');
    }
    const show = byId('cfShowX'); if (show && handle()) show.textContent = '@' + handle();
  }

  // the title screen is rebuilt by 85_menu's own observer, so re-assert the plate when the menu changes
  const watch = () => {
    const menu = document.querySelector('#scTitle .tb-menu'); if (!menu) return setTimeout(watch, 300);
    paint();
    new MutationObserver(() => paint()).observe(menu, { childList: true });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watch); else setTimeout(watch, 0);
  setInterval(paint, 2000);

  // the game server's own confirmation sets the check wherever names are shown online
  if (window.Net && Net.on) Net.on(m => {
    if (m.k === 'x_linked' && m.h) { save({ h: m.h, at: Date.now(), v: true }); pushToLook(m.h); }
    else if (m.k === 'welcome') { const s = st(); if (s && s.h) pushToLook(s.h); }
  });

  window.XLink = { open, get: () => st(), handle, disconnect, paint };
})();
