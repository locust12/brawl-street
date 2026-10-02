// ===== online social: profile + rating, friends + challenges, leaderboard, recovery code, room chat =====
// Rides on Net (77_net.js): listens to its server messages and view changes, sends through Net.send.
// UI only: never touches fight state or the seeded RNG. Chat text is always rendered with textContent.
// Portal builds without user text: set window.BS_CHAT_FREE = false before the game script (quick-chat stays).
(() => {
  if (typeof Net === 'undefined') return;
  const CHAT_FREE = typeof window.BS_CHAT_FREE === 'undefined' ? true : !!window.BS_CHAT_FREE;
  const byId = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const S = { social: null, board: null, tab: store.get('netBoardTab', 'week'), code: null, chatOpen: false, unread: 0, lines: [], roomCode: null,
    mute: new Set(store.get('chatMute', [])), hide: !!store.get('chatHide', false), view: null, boardAt: 0 };

  const css = `
  .ns3{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.1fr);gap:10px;align-items:start}
  .ns3 .panel{display:flex;flex-direction:column;gap:10px;min-width:0}
  .ns3 h3{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;line-height:.9;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .ns3 .hd{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
  .np-big{font-family:var(--display);font-style:italic;font-weight:900;font-size:40px;line-height:.9;color:var(--gold);text-shadow:0 0 20px rgba(255,200,61,.3)}
  .np-row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:13px;color:var(--muted)}
  .np-row b{color:var(--text)}
  .np-code{font:700 14px var(--mono);letter-spacing:.2em;color:#fff}
  .np-rec{font:700 15px var(--mono);letter-spacing:.12em;color:var(--lime);word-break:break-all}
  .nf-list,.nlb{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;padding-right:2px}
  .nf-i{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center;padding:6px 8px;background:rgba(5,5,7,.45);box-shadow:inset 0 0 0 1px var(--line)}
  .nf-i .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)} .nf-i .dot.on{background:var(--lime);box-shadow:0 0 8px var(--lime)} .nf-i .dot.busy{background:var(--gold)}
  .nf-i .nm{min-width:0;font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nf-i .nm small{display:block;font:500 11px var(--mono);letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
  .nf-i .acts{display:flex;gap:4px}
  .nf-i .btn.small{min-height:30px;padding:0 10px;font-size:12px}
  .nlb-r{display:grid;grid-template-columns:34px 1fr 54px 60px;gap:8px;align-items:center;padding:5px 8px;font-size:13px;background:rgba(5,5,7,.35)}
  .nlb-r:nth-child(-n+3) .rk{color:var(--gold)}
  .nlb-r.me{box-shadow:inset 3px 0 0 var(--red);background:rgba(255,42,74,.1)}
  .nlb-r .rk{font:700 12px var(--mono);color:var(--muted)} .nlb-r .nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nlb-r .nm i{font-style:normal;font-family:var(--mono);font-size:11px;font-weight:500;color:var(--cyan);margin-left:6px}
  .nlb-r .el{font:700 13px var(--mono);text-align:right} .nlb-r .wl{font:500 11px var(--mono);color:var(--muted);text-align:right}
  .nlb-empty{font-size:13px;color:var(--muted);padding:8px}
  #netChal{position:fixed;left:50%;top:max(18px,env(safe-area-inset-top));transform:translateX(-50%);z-index:40;width:min(420px,calc(100% - 32px));padding:16px 18px;
    background:rgba(10,11,16,.97);box-shadow:inset 0 0 0 1px var(--gold),0 20px 60px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:10px;animation:nbIn .25s both}
  #netChal b{font-family:var(--display);font-style:italic;font-weight:900;font-size:28px;line-height:.95;text-transform:uppercase}
  #netChal .row{justify-content:flex-start}
  #chatBtn{position:fixed;right:max(12px,env(safe-area-inset-right));top:calc(max(10px,env(safe-area-inset-top)) + 158px);z-index:8;min-height:36px}
  #chatBtn i{font-style:normal;font:700 11px var(--mono);background:var(--red);color:#fff;padding:1px 6px;margin-left:4px}
  #chatBox{position:fixed;right:max(12px,env(safe-area-inset-right));top:calc(max(10px,env(safe-area-inset-top)) + 200px);z-index:8;width:min(320px,calc(100% - 24px));
    max-height:min(46vh,380px);display:flex;flex-direction:column;background:rgba(8,9,14,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    box-shadow:inset 0 0 0 1px var(--line2),0 12px 40px rgba(0,0,0,.55);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
  #chatBox .ch-h{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)}
  #chatBox .ch-h span{font:700 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  #chatBox .ch-h label{display:flex;gap:6px;align-items:center;font:600 11px var(--mono);color:var(--muted);cursor:pointer}
  #chatBox .ch-x{border:0;background:none;color:var(--text);font-size:18px;cursor:pointer;padding:0 4px}
  #chatBox .ch-l{flex:1;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:4px;font-size:13px;min-height:60px}
  #chatBox .ch-l .ln{word-wrap:break-word;overflow-wrap:anywhere} #chatBox .ch-l .ln b{cursor:pointer;margin-right:6px} #chatBox .ch-l .ln.q span{color:var(--gold);font-weight:700}
  #chatBox .ch-l .sys{color:var(--dim);font:500 11px var(--mono)}
  #chatBox .ch-q{display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px;border-top:1px solid var(--line)}
  #chatBox .ch-q button{font:700 12px var(--ui);color:var(--text);background:rgba(255,255,255,.06);border:0;box-shadow:inset 0 0 0 1px var(--line2);padding:5px 9px;cursor:pointer}
  #chatBox .ch-q button:hover{background:rgba(255,42,74,.25)}
  #chatBox .ch-f{display:flex;gap:6px;padding:0 10px 10px}
  #chatBox .ch-f input{flex:1;min-width:0;font:500 13px var(--ui);color:var(--text);background:rgba(5,5,7,.7);border:0;box-shadow:inset 0 0 0 1px var(--line2);padding:8px 10px;outline:none}
  #chatBox .ch-f input:focus{box-shadow:inset 0 0 0 1px var(--red)}
  @media (max-width:980px){.ns3{grid-template-columns:1fr}}
  `;
  let built = false;
  function build() {
    if (built) return; built = true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  // ------------------------------------------------------------------ lobby: profile, friends, leaderboard
  function renderSocial() {
    const host = byId('nbSocial'); if (!host) return;
    build();
    const N = Net.state, me = N.me, P = me && me.profile;
    if (!me || N.conn !== 'open') { host.innerHTML = ''; return; }
    host.innerHTML = '';
    const grid = el('div', 'ns3');
    // profile
    const pr = el('div', 'panel');
    const se = P && P.season;
    pr.innerHTML = `<div class="hd"><h3>Profile</h3><span class="chip">${P && P.rank ? '#' + P.rank + ' all-time' : 'Unranked'}</span></div>
      <div class="np-row"><span class="np-big"></span><span>rating<br><b class="np-rec2"></b></span></div>
      <div class="np-row"><span>This week <b class="np-wk"></b></span><span>Ranked <b class="np-rw"></b></span><span>All games <b class="np-g"></b></span></div>
      <div class="np-row"><span>Friend code</span><span class="np-code"></span><button class="btn small" data-a="fc">Copy</button></div>
      <div class="np-row np-look"></div>
      <div class="np-row"><button class="btn small" data-a="rec">Get a recovery code</button><button class="btn small" data-a="use">Use a recovery code</button></div>
      <div class="np-recbox"></div>`;
    pr.querySelector('.np-big').textContent = P ? P.elo : '—';
    pr.querySelector('.np-rec2').textContent = P ? (P.rated ? P.rated + ' ranked games' : 'play ranked 1v1s') : '';
    pr.querySelector('.np-wk').textContent = se ? se.elo + ' (' + se.w + '–' + se.l + ')' : '—';
    pr.querySelector('.np-rw').textContent = P ? P.rw + '–' + P.rl : '—';
    pr.querySelector('.np-g').textContent = P ? P.games : '—';
    pr.querySelector('.np-code').textContent = P ? P.fc : '—';
    const lk = P && P.look, lr = pr.querySelector('.np-look');
    lr.appendChild(el('span', '', 'Custom fighter'));
    lr.appendChild(el('b', '', lk ? `${lk.name} (${Net.charName(lk.base)})` : 'none yet'));
    if (lk && lk.x) lr.appendChild(el('span', 'np-code', '@' + lk.x));
    if (typeof CustomLook !== 'undefined' && CustomLook.open) { const b = el('button', 'btn small', lk ? 'Edit' : 'Build one'); b.onclick = () => { sfx(); CustomLook.open(); }; lr.appendChild(b); }
    const box = pr.querySelector('.np-recbox');
    if (S.code) {
      box.appendChild(el('div', 'np-rec', S.code));
      box.appendChild(el('p', 'note', 'Write this down. Enter it on another device to move this account there (rating, friends, balance, fighter). Getting a new code cancels the old one.'));
      box.lastChild.style.textAlign = 'left';
      const cp = el('button', 'btn small', 'Copy code'); cp.onclick = () => copyText(S.code); box.appendChild(cp);
    }
    pr.querySelector('[data-a=fc]').onclick = () => P && copyText(P.fc);
    pr.querySelector('[data-a=rec]').onclick = () => { Net.send({ k: 'recovery_new' }); sfx(); };
    pr.querySelector('[data-a=use]').onclick = () => {
      box.innerHTML = '';
      const inp = el('input', 'nb-in'); inp.placeholder = 'XXXX-XXXX-XXXX-XXXX'; inp.maxLength = 19; inp.style.width = '100%'; guardKeys(inp);
      const go = el('button', 'btn primary small', 'Restore account');
      go.onclick = () => { if (inp.value.replace(/[^A-Za-z0-9]/g, '').length === 16) Net.send({ k: 'recover', code: inp.value }); else Net.toast('Recovery codes have 16 letters and digits', true); };
      box.append(inp, go); inp.focus();
    };
    // friends
    const fr = el('div', 'panel'), soc = S.social || { friends: [], reqIn: [], reqOut: [] };
    const online = soc.friends.filter(f => f.status !== 'offline').length;
    fr.innerHTML = `<div class="hd"><h3>Friends</h3><span class="chip">${online} online</span></div>
      <div class="nb-field" style="flex-wrap:nowrap"><input class="nb-in" style="flex:1;width:auto" placeholder="Name or friend code" maxlength="20"><button class="btn primary small">Add</button></div>
      <div class="nf-list"></div>`;
    const addIn = fr.querySelector('input'), addBtn = fr.querySelector('.btn'); guardKeys(addIn);
    addBtn.onclick = () => { const q = addIn.value.trim(); if (q) { Net.send({ k: 'friend_add', q }); addIn.value = ''; sfx(); } };
    addIn.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') addBtn.click(); };
    const list = fr.querySelector('.nf-list');
    const item = (f, sub, acts, dotCls) => {
      const r = el('div', 'nf-i'); r.appendChild(el('span', 'dot ' + (dotCls || '')));
      const nm = el('div', 'nm', f.name); nm.appendChild(el('small', '', (f.x ? '@' + f.x + ' · ' : '') + sub)); r.appendChild(nm);
      const a = el('div', 'acts'); for (const [label, fn, cls] of acts) { const b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label); b.onclick = () => { fn(); sfx(); }; a.appendChild(b); }
      r.appendChild(a); list.appendChild(r);
    };
    for (const f of soc.reqIn) item(f, 'wants to be friends', [['Accept', () => Net.send({ k: 'friend_accept', id: f.id }), 'primary'], ['✕', () => Net.send({ k: 'friend_decline', id: f.id })]], 'busy');
    for (const f of soc.friends) {
      const on = f.status !== 'offline', busy = f.status === 'in a match';
      item(f, f.status + (f.elo ? ' · ' + f.elo : ''), [
        ...(on && !busy ? [['Challenge', () => Net.send({ k: 'challenge', id: f.id, stake: Net.state.stake || 0 }), 'primary']] : []),
        ['✕', () => { if (confirmTwice('rm' + f.id)) Net.send({ k: 'friend_remove', id: f.id }); else Net.toast('Tap ✕ again to remove ' + f.name); }]], on ? (busy ? 'busy' : 'on') : '');
    }
    for (const f of soc.reqOut) item(f, 'request sent', [['Cancel', () => Net.send({ k: 'friend_remove', id: f.id })]]);
    if (!soc.friends.length && !soc.reqIn.length && !soc.reqOut.length) list.appendChild(el('div', 'nlb-empty', 'Add friends by name or friend code, then challenge them from here. Friends who don\'t play yet: send them a room link.'));
    // leaderboard
    const lb = el('div', 'panel'), B = S.board;
    lb.innerHTML = `<div class="hd"><h3>Leaderboard</h3><span class="nb-pills"><button class="nb-pill" data-t="week">This week</button><button class="nb-pill" data-t="all">All-time</button></span></div>
      <div class="np-row nlb-sub"></div><div class="nlb"></div>`;
    lb.querySelectorAll('[data-t]').forEach(b => { b.classList.toggle('on', b.dataset.t === S.tab); b.onclick = () => { S.tab = b.dataset.t; store.set('netBoardTab', S.tab); sfx(); renderSocial(); }; });
    const sub = lb.querySelector('.nlb-sub');
    if (B && B.season) {
      const left = Math.max(0, new Date(B.season.ends).getTime() - Date.now()), d = Math.floor(left / 864e5), h = Math.floor(left % 864e5 / 36e5);
      sub.textContent = S.tab === 'week' ? `Season ${B.season.id} · resets in ${d}d ${h}h · everyone starts at 1200` : 'Elo from ranked online 1v1s (quick match 1v1 is always ranked)';
    }
    const rows = B ? (S.tab === 'all' ? B.all : B.week) : [], lbl = lb.querySelector('.nlb');
    if (!rows.length) lbl.appendChild(el('div', 'nlb-empty', B ? 'No ranked games yet. Win a ranked 1v1 to get on the board.' : 'Loading…'));
    for (const r of rows) {
      const mine = B.mine && (S.tab === 'all' ? B.mine.all : B.mine.week);
      const row = el('div', 'nlb-r' + (mine === r.rank ? ' me' : ''));
      const nm = el('span', 'nm', r.name);
      if (r.x) nm.appendChild(el('i', '', '@' + r.x));   // plain text, never a link: it is just a display name
      row.append(el('span', 'rk', '#' + r.rank), nm, el('span', 'el', String(r.elo)), el('span', 'wl', r.wins + '–' + r.losses));
      lbl.appendChild(row);
    }
    grid.append(pr, fr, lb);
    host.appendChild(grid);
  }
  let armed = {};
  function confirmTwice(key) { const now = Date.now(); if (armed[key] && now - armed[key] < 3000) { delete armed[key]; return true; } armed[key] = now; return false; }
  function copyText(t) {
    const ok = () => Net.toast('Copied');
    try { navigator.clipboard.writeText(t).then(ok, () => legacy()); } catch (e) { legacy(); }
    function legacy() { const ta = el('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* no clipboard */ } ta.remove(); }
  }
  // typing in a text field must not move your fighter or trigger menu keys
  function guardKeys(inp) { for (const t of ['keydown', 'keyup']) inp.addEventListener(t, e => { e.stopPropagation(); if (e.key === 'Escape') inp.blur(); }); }

  // ------------------------------------------------------------------ challenges
  function showChallenge(m) {
    build();
    let c = byId('netChal'); if (c) c.remove();
    c = el('div'); c.id = 'netChal';
    c.appendChild(el('div', 'eyebrow', 'Challenge'));
    c.appendChild(el('b', '', m.from.name + ' wants to fight'));
    c.appendChild(el('div', 'note', `1v1${m.ranked ? ' · ranked' : ''} · ${m.stake ? 'stake ' + m.stake + ' ETH (practice)' : 'no stake'}${m.from.elo ? ' · rating ' + m.from.elo : ''}`));
    c.lastChild.style.textAlign = 'left';
    const row = el('div', 'row'), yes = el('button', 'btn primary small', 'Accept'), no = el('button', 'btn small', 'Decline');
    yes.onclick = () => { c.remove(); if (Net.active) return Net.toast('Finish your match first', true); if (!Net.state.view) Net.open(); Net.send({ k: 'challenge_reply', code: m.code, ok: true }); sfx('coin'); };
    no.onclick = () => { c.remove(); Net.send({ k: 'challenge_reply', code: m.code, ok: false }); };
    row.append(yes, no); c.appendChild(row);
    document.body.appendChild(c);
    sfx('coin');
    setTimeout(() => { if (c.isConnected) { c.remove(); Net.send({ k: 'challenge_reply', code: m.code, ok: false }); } }, 30000);
  }

  // ------------------------------------------------------------------ room chat
  function chatVisible() { const N = Net.state; return !!(N.room && (S.view === 'room' || S.view === 'match' || S.view === 'res')); }
  function renderChatButton() {
    build();
    let b = byId('chatBtn');
    if (!chatVisible()) { if (b) b.hidden = true; const bx = byId('chatBox'); if (bx) bx.hidden = true; return; }
    if (!b) { b = el('button', 'btn small'); b.id = 'chatBtn'; b.onclick = () => { S.chatOpen = !S.chatOpen; S.unread = 0; sfx(); renderChat(); renderChatButton(); }; document.body.appendChild(b); }
    b.hidden = false;
    b.textContent = S.chatOpen ? 'Close chat' : 'Chat';
    if (!S.chatOpen && S.unread && !S.hide) { const i = el('i', '', String(Math.min(99, S.unread))); b.appendChild(i); }
    renderChat();
  }
  function renderChat() {
    let bx = byId('chatBox');
    if (!chatVisible() || !S.chatOpen) { if (bx) bx.hidden = true; return; }
    const N = Net.state, freeOk = CHAT_FREE && N.me && N.me.chatFree !== false;
    if (!bx) {
      bx = el('div'); bx.id = 'chatBox';
      bx.innerHTML = `<div class="ch-h"><span>Room chat</span><label><input type="checkbox" class="ch-hide"> Hide chat</label><button class="ch-x" aria-label="Close">×</button></div>
        <div class="ch-l"></div><div class="ch-q"></div><div class="ch-f"><input maxlength="120" placeholder="Say something (120 max)"><button class="btn small">Send</button></div>`;
      document.body.appendChild(bx);
      bx.querySelector('.ch-x').onclick = () => { S.chatOpen = false; renderChatButton(); };
      bx.querySelector('.ch-hide').onchange = e => { S.hide = e.target.checked; store.set('chatHide', S.hide); renderChat(); };
      const inp = bx.querySelector('.ch-f input'), sendB = bx.querySelector('.ch-f .btn');
      guardKeys(inp);
      const go = () => { const t = inp.value.trim(); if (!t) return; Net.send({ k: 'chat', t }); inp.value = ''; inp.blur(); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      sendB.onclick = go;
      const QUICK = (N.me && N.me.quickChat) || { gg: 'GG', nice: 'Nice!', rematch: 'Rematch?', wow: 'Wow' };
      const q = bx.querySelector('.ch-q');
      for (const [id, label] of Object.entries(QUICK)) { const b = el('button', '', label); b.onclick = () => { Net.send({ k: 'chat', q: id }); sfx(); }; q.appendChild(b); }
    }
    bx.hidden = false;
    bx.querySelector('.ch-hide').checked = S.hide;
    bx.querySelector('.ch-f').hidden = !freeOk || S.hide;
    const L = bx.querySelector('.ch-l'); L.innerHTML = '';
    if (S.hide) L.appendChild(el('div', 'sys', 'Chat is hidden. Untick "Hide chat" to see it. Quick-chat still sends.'));
    else {
      if (!S.lines.length) L.appendChild(el('div', 'sys', freeOk ? 'Say hi. Tap a name to mute that player.' : 'Quick-chat only. Tap a name to mute that player.'));
      const QUICK = (N.me && N.me.quickChat) || {};
      for (const m of S.lines) {
        if (S.mute.has(m.acct)) continue;
        if (m.t != null && !freeOk && m.from !== (N.me && N.me.id)) continue;
        const ln = el('div', 'ln' + (m.q ? ' q' : ''));
        const who = el('b', '', m.name); who.style.color = m.from === (N.me && N.me.id) ? 'var(--cyan)' : 'var(--red)';
        who.title = 'Tap to mute';
        who.onclick = () => { if (m.from === (N.me && N.me.id)) return; S.mute.add(m.acct); store.set('chatMute', [...S.mute].slice(-200)); Net.toast(m.name + ' is muted. "Unmute" at the bottom of the chat brings them back.'); renderChat(); };
        ln.appendChild(who); ln.appendChild(el('span', '', m.q ? (QUICK[m.q] || m.q) : m.t));
        L.appendChild(ln);
      }
      if (S.mute.size) { const u = el('div', 'sys'); const a = el('a', '', `Unmute ${S.mute.size} player${S.mute.size > 1 ? 's' : ''}`); a.href = '#'; a.style.color = 'var(--cyan)';
        a.onclick = e => { e.preventDefault(); S.mute.clear(); store.set('chatMute', []); renderChat(); }; u.appendChild(a); L.appendChild(u); }
    }
    L.scrollTop = L.scrollHeight;
  }
  function onChat(m) {
    S.lines.push(m); if (S.lines.length > 80) S.lines.shift();
    if (!S.chatOpen && !S.mute.has(m.acct) && m.from !== (Net.state.me && Net.state.me.id)) S.unread++;
    renderChatButton();
  }

  // ------------------------------------------------------------------ wiring
  let boardT = null;
  Net.on(m => {
    switch (m.k) {
      case '_view':
        S.view = m.view;
        if (m.view === 'home') { Net.send({ k: 'board' }); Net.send({ k: 'social' }); renderSocial(); clearInterval(boardT); boardT = setInterval(() => { if (S.view === 'home') Net.send({ k: 'board' }); }, 30000); }
        else clearInterval(boardT);
        renderChatButton();
        return;
      case 'welcome': S.code = null; Net.send({ k: 'board' }); renderSocial(); return;
      case 'me': renderSocial(); return;
      case 'social': S.social = m; if (S.view === 'home') renderSocial(); return;
      case 'board': S.board = m; if (S.view === 'home') renderSocial(); return;
      case 'recovery': S.code = m.code; renderSocial(); return;
      case 'challenge': showChallenge(m); return;
      case 'room':
        if (S.roomCode !== m.code) { S.roomCode = m.code; S.lines = []; S.unread = 0; }
        renderChatButton(); return;
      case 'left': case 'kicked': S.roomCode = null; S.lines = []; renderChatButton(); return;
      case 'chat': onChat(m); return;
      case 'result': renderChatButton(); return;
    }
  });
})();
