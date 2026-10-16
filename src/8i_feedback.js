// ===== feedback box (10/13) =====
// Players say what to change, add or fix; we read it and decide what goes into the next build. Two
// entry points, both quiet: a numbered row at the bottom of the title menu (beside Store and
// Graphics) and one row in the pause menu. Nothing pops up, nothing asks after a match, nothing
// nags -- the box only ever opens because somebody chose it.
//
// One POST to brawlstreet.lol/api/feedback, which writes a JSON record into the site's blob store.
// A send that cannot go through (offline, or a portal sandbox that blocks the host) is kept in
// localStorage and retried on the next boot or the next time the box opens, so the player never
// loses what they typed and never sees a failure they can do nothing about.
//
// Every class here is fb-prefixed: .chip, .row, .note and .eyebrow all exist globally in 01_head.html
// and this panel must not inherit them.
//
// Page only: it reads fight state for context and never writes to it, so the portal, desktop and
// clean builds carry it unchanged.
(function () {
  const ENDPOINT = 'https://brawlstreet.lol/api/feedback';
  const KINDS = [['idea', 'Idea'], ['balance', 'Balance'], ['fighter', 'Fighter'], ['stage', 'Stage'], ['bug', 'Bug'], ['other', 'Other']];
  const MAX = 1200, MIN = 4, CAP = 25;            // characters, characters, sends per browser per day
  const K = { id: 'bs_fb_id', q: 'bs_fb_queue', day: 'bs_fb_day', name: 'bs_fb_name' };

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const rid = () => Math.random().toString(36).slice(2, 10);   // det-ok: page only, never fight code
  const pid = (() => { let v = LS.get(K.id); if (!v) { v = 'p' + rid() + Date.now().toString(36).slice(-4); LS.set(K.id, v); } return v; })();
  const today = () => new Date().toISOString().slice(0, 10);
  const sentToday = () => { const [d, n] = String(LS.get(K.day, '')).split('|'); return d === today() ? (+n || 0) : 0; };
  const countSend = () => LS.set(K.day, today() + '|' + (sentToday() + 1));

  const css = `
  #fbBox{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;
    background:rgba(4,4,6,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  #fbBox[hidden]{display:none!important}
  #fbBox .fb-card{position:relative;width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:22px 24px 20px;
    background:linear-gradient(180deg,rgba(14,15,22,.97),rgba(9,10,15,.97));
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 24px 70px rgba(0,0,0,.65);
    clip-path:polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,18px 100%,0 calc(100% - 18px));
    animation:fbIn .18s cubic-bezier(.2,.9,.3,1) both}
  @keyframes fbIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){#fbBox .fb-card{animation:none}}
  #fbBox .fb-card::before{content:"";position:absolute;left:0;top:0;width:3px;height:56px;background:var(--red)}
  #fbBox .fb-eye{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--cyan)}
  #fbBox .fb-h{margin:3px 0 5px;font-family:var(--display);font-style:italic;font-weight:900;font-size:38px;line-height:.95;letter-spacing:-.01em;text-transform:none}
  #fbBox .fb-lede{font-size:13.5px;line-height:1.5;color:#c9cdda;margin:0 0 16px;max-width:44em}
  #fbBox .fb-lab{display:block;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 7px}
  #fbBox .fb-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
  #fbBox .fb-chip{padding:7px 12px;border:0;cursor:pointer;color:#c9cdda;background:rgba(255,255,255,.055);
    font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);transition:background .12s,color .12s,box-shadow .12s}
  #fbBox .fb-chip:hover{background:rgba(255,255,255,.1);color:var(--text)}
  #fbBox .fb-chip.on{background:var(--red);color:#fff;box-shadow:inset 0 0 0 1px var(--red)}
  #fbBox .fb-chip:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
  #fbBox textarea,#fbBox input{width:100%;box-sizing:border-box;color:var(--text);background:rgba(255,255,255,.04);border:0;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.13);padding:12px 13px;font-family:var(--ui);font-size:14px;line-height:1.5;
    transition:box-shadow .12s,background .12s}
  #fbBox textarea{min-height:132px;resize:vertical;display:block}
  #fbBox textarea:focus,#fbBox input:focus{outline:none;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px var(--cyan)}
  #fbBox textarea::placeholder,#fbBox input::placeholder{color:#6e7486}
  #fbBox .fb-count{display:flex;justify-content:space-between;gap:14px;margin:7px 0 15px;font-family:var(--mono);font-size:10.5px;line-height:1.4;letter-spacing:.05em;color:var(--dim)}
  #fbBox .fb-count i{font-style:normal;flex:1;min-width:0}
  #fbBox .fb-count em{font-style:normal;white-space:nowrap}
  #fbBox .fb-count b{font-weight:700;color:var(--muted)}
  #fbBox .fb-count.near b{color:var(--gold)}
  #fbBox .fb-ctx{margin:15px 0 0;padding-top:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07);
    font-family:var(--mono);font-size:10px;letter-spacing:.07em;color:var(--dim);text-transform:uppercase}
  #fbBox .fb-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}
  #fbBox .fb-act{min-height:44px;padding:0 20px;border:0;cursor:pointer;color:var(--text);background:rgba(255,255,255,.06);
    font-family:var(--display);font-style:italic;font-weight:900;font-size:19px;letter-spacing:.01em;
    clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px));transition:background .12s}
  #fbBox .fb-act:hover{background:rgba(255,255,255,.12)}
  #fbBox .fb-act.go{background:var(--red);color:#fff}
  #fbBox .fb-act.go:hover{background:#ff4463}
  #fbBox .fb-act[disabled]{opacity:.45;cursor:default}
  #fbBox .fb-act:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
  #fbBox .fb-sp{flex:1}
  #fbBox .fb-note{font-family:var(--mono);font-size:11px;line-height:1.5;letter-spacing:.04em;color:var(--muted)}
  #fbBox .fb-note.bad{color:var(--gold)}
  #fbBox .fb-x{position:absolute;right:9px;top:9px;width:30px;height:30px;border:0;cursor:pointer;background:transparent;color:var(--muted);font-family:var(--mono);font-size:15px;line-height:1}
  #fbBox .fb-x:hover{color:var(--text)}
  #fbBox .fb-tick{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--lime)}
  @media (max-width:520px){#fbBox .fb-card{padding:18px 18px 16px} #fbBox .fb-h{font-size:30px} #fbBox textarea{min-height:112px}}
  @media (max-height:620px){#fbBox .fb-card{padding:14px 18px} #fbBox .fb-h{font-size:26px} #fbBox .fb-lede{margin-bottom:10px;font-size:13px}
    #fbBox textarea{min-height:84px} #fbBox .fb-chips{margin-bottom:10px} #fbBox .fb-count{margin-bottom:9px} #fbBox .fb-row{margin-top:11px}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const el = document.createElement('div'); el.id = 'fbBox'; el.hidden = true;
  el.innerHTML = '<div class="fb-card" role="dialog" aria-modal="true" aria-label="Feedback"></div>';
  document.body.appendChild(el);
  const card = el.firstChild;
  let kind = 'idea', from = 'menu', busy = false, returnTo = null;

  const sfx = () => { try { if (window.Sfx && Sfx.ui) Sfx.ui(); } catch (e) {} };
  // typing must not drive the fighter or move the menu selection (78_net_social guards its fields the same way)
  const guard = inp => { for (const t of ['keydown', 'keyup', 'keypress']) inp.addEventListener(t, e => { e.stopPropagation(); if (e.key === 'Escape') close(); }); };
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function closeBtn() {
    const b = mk('button', 'fb-x', '✕'); b.type = 'button'; b.title = 'Close'; b.setAttribute('aria-label', 'Close');
    b.onclick = () => { sfx(); close(); }; return b;
  }

  function ctx() {
    let f = null, mode = 'menu', stage = '';
    try { f = (Game.fighters || []).find(x => x && !x.cpu && x.ctrl !== 'net') || null; } catch (e) {}
    try { stage = (Game.stage && Game.stage.name) || ''; } catch (e) {}
    try {
      if (window.Net && Net.active) mode = 'online';
      else if (window.Arena && Arena.active) mode = 'arena';
      else if (window.TRAIN && (TRAIN.on || TRAIN.active)) mode = 'training';
      else if (window.Game && Game.state === 'match') mode = Game.demo ? 'demo' : 'match';
    } catch (e) {}
    const scr = document.querySelector('.screen:not([hidden])');
    return {
      build: window.TB_BUILD || 'dev', host: location.hostname || 'local', mode, from,
      screen: scr ? scr.id : 'match', fighter: f && f.c ? f.c.name : '', stage,
      view: innerWidth + 'x' + innerHeight, touch: !!window.IS_TOUCH,
      lang: navigator.language || '', ua: (navigator.userAgent || '').slice(0, 180),
    };
  }
  const ctxLine = c => ['Build ' + c.build, c.fighter, c.stage, c.view].filter(Boolean).join('  ·  ');

  // ---- the queue: anything that could not be sent, kept until it can be
  const queue = () => { try { const q = JSON.parse(LS.get(K.q, '[]')); return Array.isArray(q) ? q : []; } catch (e) { return []; } };
  const setQueue = q => LS.set(K.q, JSON.stringify(q.slice(-25)));
  async function post(rec) {
    const r = await fetch(ENDPOINT, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
    if (!r.ok) throw new Error('http ' + r.status);
    return true;
  }
  let flushing = false;
  async function flush() {
    if (flushing) return;
    const q = queue(); if (!q.length) return;
    flushing = true;
    const left = [];
    for (const rec of q) { try { await post(rec); } catch (e) { left.push(rec); } }
    setQueue(left); flushing = false;
  }

  // ---- the form
  function paint() {
    card.innerHTML = '';
    card.append(closeBtn(), mk('div', 'fb-eye', 'Player feedback'), mk('div', 'fb-h', 'Shape the game'),
      mk('p', 'fb-lede', 'Tell us what to change, add or fix. Every note is read, and the ones we take go into the next build.'));

    const chips = mk('div', 'fb-chips');
    KINDS.forEach(([k, label]) => {
      const b = mk('button', 'fb-chip' + (k === kind ? ' on' : ''), label); b.type = 'button';
      b.setAttribute('aria-pressed', k === kind ? 'true' : 'false');
      b.onclick = () => {
        kind = k; sfx();
        [...chips.children].forEach(c => { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      };
      chips.appendChild(b);
    });
    card.append(mk('span', 'fb-lab', 'What is it about'), chips);

    const ta = mk('textarea'); ta.maxLength = MAX; ta.id = 'fbText';
    ta.placeholder = 'A move that needs a nerf, a fighter or stage you want, something that feels off, a bug you hit...';
    const count = mk('div', 'fb-count');
    const left = mk('em'); left.innerHTML = '<b>0</b> / ' + MAX;
    count.append(mk('i', null, 'The more specific, the more likely it ships.'), left);
    card.append(mk('span', 'fb-lab', 'Your note'), ta, count);

    const nm = mk('input'); nm.type = 'text'; nm.maxLength = 40; nm.placeholder = 'So we can credit the idea'; nm.value = LS.get(K.name, '');
    card.append(mk('span', 'fb-lab', 'Name or handle · optional'), nm);
    card.append(mk('div', 'fb-ctx', 'Sent with  ' + ctxLine(ctx())));

    const row = mk('div', 'fb-row');
    const send = mk('button', 'fb-act go', 'Send'); send.type = 'button'; send.disabled = true;
    const cancel = mk('button', 'fb-act', 'Cancel'); cancel.type = 'button';
    const msg = mk('span', 'fb-note');
    row.append(send, cancel, mk('span', 'fb-sp'), msg);
    card.append(row);

    const tick = () => {
      const n = ta.value.length;
      left.innerHTML = '<b>' + n + '</b> / ' + MAX;
      count.classList.toggle('near', n > MAX - 120);
      send.disabled = ta.value.trim().length < MIN || busy;
    };
    ta.addEventListener('input', tick);
    guard(ta); guard(nm);
    cancel.onclick = () => { sfx(); close(); };
    send.onclick = async () => {
      const text = ta.value.trim();
      if (text.length < MIN || busy) return;
      if (sentToday() >= CAP) { msg.className = 'fb-note bad'; msg.textContent = 'That is a lot of notes for one day. Come back tomorrow.'; return; }
      busy = true; send.disabled = true; send.textContent = 'Sending'; msg.className = 'fb-note'; msg.textContent = '';
      const handle = nm.value.trim(); LS.set(K.name, handle);
      const rec = { kind, text, handle, pid, at: new Date().toISOString(), ctx: ctx() };
      let queued = false;
      try { await post(rec); } catch (e) { const q = queue(); q.push(rec); setQueue(q); queued = true; }
      countSend(); busy = false; sfx(); thanks(queued);
    };
    tick();
    setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 30);
  }

  function thanks(queued) {
    card.innerHTML = '';
    card.append(closeBtn(), mk('div', 'fb-tick', queued ? 'Saved' : 'Sent'),
      mk('div', 'fb-h', queued ? 'Held for later' : 'Thank you'),
      mk('p', 'fb-lede', queued
        ? 'No connection right now, so your note is saved on this device and goes out the next time you play online.'
        : 'Your note is in. We read all of it before every build and pick what goes in next.'));
    const row = mk('div', 'fb-row');
    const shut = mk('button', 'fb-act go', 'Back to the game'); shut.type = 'button';
    const again = mk('button', 'fb-act', 'Send another'); again.type = 'button';
    shut.onclick = () => { sfx(); close(); };
    again.onclick = () => { sfx(); paint(); };
    row.append(shut, again);
    card.append(row);
    setTimeout(() => { try { shut.focus({ preventScroll: true }); } catch (e) {} }, 30);
  }

  function open(where) {
    from = where || 'menu';
    returnTo = document.activeElement;
    flush(); paint();
    el.hidden = false;
  }
  function close() {
    el.hidden = true; busy = false;
    try { if (returnTo && returnTo.focus) returnTo.focus({ preventScroll: true }); } catch (e) {}
    returnTo = null;
  }
  el.addEventListener('click', e => { if (e.target === el) close(); });
  addEventListener('keydown', e => {
    if (el.hidden) return;
    if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---- the quiet entry point on the title: one numbered row down in the utility half of the list,
  // under Store and Profile, right above How to play. 85_menu's tidyMenu renumbers whatever sits in
  // .tb-menu and forces How to play / Graphics to the end, so "immediately before How to play" is a
  // stable place to ask for -- but Store and Profile are adopted into the list LATER than this file
  // runs, so the position is re-asserted a few times rather than set once.
  function place() {
    const menu = document.querySelector('#scTitle .tb-menu'); if (!menu) return;
    let b = document.getElementById('bFeed');
    if (!b) {
      b = mk('button', 'tb-item tb-quiet'); b.id = 'bFeed'; b.type = 'button';
      b.innerHTML = '<i></i><b>Feedback</b><em>▶</em><small>Tell us what to change or add</small>';
      b.addEventListener('mouseenter', sfx);
      b.addEventListener('click', () => { sfx(); open('title'); });
    }
    const help = document.getElementById('bHelp');
    if (help && help.parentElement === menu) { if (b.nextElementSibling !== help) menu.insertBefore(b, help); }
    else if (b.parentElement !== menu) menu.appendChild(b);
  }
  place();
  // Store and Profile are adopted into the list later than this file runs, and on a slow load later
  // than any timeout worth waiting out -- which put Feedback above them on a fast machine and below
  // them on a slow one. Watch the list instead: every adoption re-asserts the position, and the move
  // itself settles on the next pass because place() only acts when the row is in the wrong seat.
  const menu0 = document.querySelector('#scTitle .tb-menu');
  if (menu0) new MutationObserver(place).observe(menu0, { childList: true });
  for (const ms of [0, 400, 1500]) setTimeout(place, ms);

  window.Feedback = { open, flush, queued: () => queue().length };
  // anything stuck from an offline session goes out on the next boot, quietly
  addEventListener('load', () => setTimeout(flush, 4000));
  addEventListener('online', () => setTimeout(flush, 1500));
})();
