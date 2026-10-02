// ===== game music: his own playlist, chill in the menus, driving in a fight =====
// Separate from the built-in packs in 12_audio.js (MUSIC_OFF, 9/20). Tracks are files the owner has
// the right to use, dropped in assets/audio/music/ and listed in playlist.json:
//   [{ "file": "track1.mp4", "title": "Planes", "credit": "prod. PlayboyFlexx", "mood": "fight" }]
// mood is "fight" or "menu". **menu is everything that is not a live match** — title, character
// select, help, the bet screen, results, and the online lobby / waiting room / online results — so
// the waiting room always has music (9/20: "put music on, a chill one in the waiting room in the
// menu, that's essential, not just in the game").
//
// Each mood owns its own <audio> element and its own gain node, so starting a match cross-fades the
// menu track down and the fight track up, and coming back out picks the menu track up where it left
// off instead of restarting it. Everything runs through GameAudio's music bus, so the mute button,
// the volume sliders, the pause filter and the announcer duck all keep working.
//
// Autoplay: a browser will not start audio before the first gesture, so the first click / keypress /
// touch anywhere starts the menu track, and a rejected play() is retried on the next gesture. That
// is why "music isnt playing" used to be true on a cold load.
// No playlist file, or an empty one, and nothing here runs: no bar, no sound, no request beyond the
// one manifest fetch.
(function () {
  if (typeof GameAudio === 'undefined' || typeof document === 'undefined') return;
  const DIR = 'assets/audio/music/';
  const FADE = 1.1;            // cross-fade, seconds
  const SHOW_MS = 5200;        // how long the now-playing bar stays up before it fades out
  const M = {
    pools: { menu: [], fight: [] }, idx: { menu: 0, fight: 0 }, mood: 'menu', ch: {},
    ready: false, on: false, started: false, blocked: false,
    bar: null, name: null, showUntil: 0, shown: false, lastKey: '',
  };
  window.FightMusic = M;

  fetch(DIR + 'playlist.json', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(list => {
      if (!Array.isArray(list) || !list.length) return;          // no tracks: stay silent
      list.filter(t => t && t.file).forEach(t => {
        (M.pools[t.mood === 'menu' ? 'menu' : 'fight']).push(t);
      });
      // a pool with nothing of its own falls back to the other, so a one-mood playlist still plays
      if (!M.pools.fight.length) M.pools.fight = M.pools.menu;
      if (!M.pools.menu.length) M.pools.menu = M.pools.fight;
      if (!M.pools.fight.length) return;
      // a different order each session, so the first fight of the day is not always track 1
      ['menu', 'fight'].forEach(k => {
        const a = M.pools[k];
        if (k === 'menu' && a === M.pools.fight) return;          // same array, already shuffled
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));          // never the seeded fight RNG
          [a[i], a[j]] = [a[j], a[i]];
        }
      });
      M.ready = true;
      build();
      if (M.gesture) kick();          // they already clicked while the manifest was in flight
      else tryAuto();                 // no gesture yet: ask anyway, a refusal costs nothing
    })
    .catch(() => {});

  // ---------- one element + one gain per mood, both wired into the game's music bus ----------
  function chan(mood) {
    let c = M.ch[mood];
    if (c) return c;
    const A = GameAudio.A;
    if (!A || !A.ctx || !A.musBus) return null;                   // Sfx.unlock() has not run yet
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'none';
    el.volume = 1;                    // level lives on the bus, not here: setting both squares it
    el.addEventListener('ended', () => { if (M.mood === mood) next(); });
    el.addEventListener('error', () => { if (M.mood === mood) next(); });
    let g;
    try {
      const node = A.ctx.createMediaElementSource(el);
      g = A.ctx.createGain(); g.gain.value = 0;
      node.connect(g); g.connect(A.musBus);
    } catch (e) { return null; }      // no bus: better silent than a second uncontrolled output
    return (M.ch[mood] = { el, g, playing: false, pauseT: 0 });
  }
  function ramp(c, to, secs) {
    try {
      const t = GameAudio.A.ctx.currentTime, p = c.g.gain;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(to, t + secs);
    } catch (e) { try { c.g.gain.value = to; } catch (e2) {} }
  }
  function cur(mood) { const p = M.pools[mood]; return p.length ? p[M.idx[mood] % p.length] : null; }

  function start(mood) {
    const c = chan(mood), t = cur(mood);
    if (!c || !t) return;
    if (!c.el.getAttribute('src')) c.el.src = DIR + t.file;
    clearTimeout(c.pauseT);
    c.playing = true;
    const p = c.el.play();
    if (p && p.then) p.then(() => { M.started = true; M.blocked = false; }, () => { M.blocked = true; });
    ramp(c, 1, FADE);
    flash();
  }
  function stop(mood, fade) {
    const c = M.ch[mood];
    if (!c || !c.playing) return;
    c.playing = false;
    ramp(c, 0, fade);
    clearTimeout(c.pauseT);
    c.pauseT = setTimeout(() => { if (!c.playing) { try { c.el.pause(); } catch (e) {} } }, fade * 1000 + 150);
  }
  function next() {
    if (!M.ready) return;
    const mood = M.mood, p = M.pools[mood], c = M.ch[mood];
    if (p.length) M.idx[mood] = (M.idx[mood] + 1) % p.length;
    if (c) { try { c.el.pause(); } catch (e) {} c.el.removeAttribute('src'); }
    if (M.on) start(mood); else flash();
  }
  M.next = next;

  // a mood change cross-fades: the old pool rides down, the new one comes up and keeps its place
  function setMood(m) {
    if (m === M.mood) return;
    const prev = M.mood;
    M.mood = m;
    stop(prev, FADE);
    if (M.on) start(m);
  }

  // ---------- autoplay: the first gesture anywhere starts it ----------
  function kick() {
    M.gesture = true;
    try { Sfx.unlock(); } catch (e) {}                            // builds the graph on first use
    if (!M.ready) return;
    const A = GameAudio.A;
    if (A.muted || (typeof Sfx !== 'undefined' && !Sfx.on)) return;
    if (M.started && !M.blocked) return;                          // already running
    M.blocked = false;
    M.on = true;
    start(M.mood);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, kick, { capture: true, passive: true }));

  // Duane, 9/23: "no music playing on first lander - first impression - not good". The title screen
  // sat in silence because we only ever started the music on the first gesture. A browser will not
  // normally start audio before one, but Chrome DOES allow it once someone has used the site enough
  // (its Media Engagement Index) and Safari allows it for an already-unmuted tab -- and we never
  // asked. Now we ask the moment the playlist lands. A refusal costs nothing: start() flags
  // M.blocked and the gesture path above still starts it on the first click.
  function tryAuto() {
    if (M.started || M.gesture) return;
    try { Sfx.unlock(); } catch (e) {}
    const A = GameAudio.A;
    if (!A || !A.ctx || A.muted || (typeof Sfx !== 'undefined' && !Sfx.on)) return;
    try { const r = A.ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    M.on = true;
    start(M.mood);
    // if it was refused, say so quietly instead of looking broken: the sound chip breathes until
    // the first click, which is the same click that starts the music anyway.
    setTimeout(() => {
      try { document.documentElement.classList.toggle('muted-by-browser', !!M.blocked && !M.started); } catch (e) {}
    }, 900);
  }
  try {
    const hint = document.createElement('style');
    hint.textContent = 'html.muted-by-browser #sndBtn{animation:sndWake 2.2s ease-in-out infinite}'
      + '@keyframes sndWake{0%,100%{box-shadow:inset 0 0 0 1px var(--line2,rgba(255,255,255,.18))}'
      + '50%{box-shadow:inset 0 0 0 1px rgba(255,200,61,.9),0 0 14px rgba(255,200,61,.45)}}';
    document.head.appendChild(hint);
    addEventListener('pointerdown', () => document.documentElement.classList.remove('muted-by-browser'), { capture: true, passive: true, once: true });
  } catch (e) {}

  // ---------- the now-playing bar ----------
  // Small, bottom centre, and it fades out after a few seconds (9/20: "the song name and next is
  // covering the percent of the life, fix that so it doesn't overlap"). Placement comes from the HUD
  // layout budget in 71_hud.js, which publishes `--np-bottom` on <html> every frame and reserves
  // that strip for this label at every aspect ratio and fighter count. The other corners are taken:
  // bottom-left is the controls tab, bottom-right the touch action buttons, top centre the clock
  // plate, the map name and the utility row. Never place this by hand — read the variable.
  const css = document.createElement('style');
  css.textContent = `
/* On the menus the middle of the screen is the menu itself, so the strip lives in the bottom-left
   corner. Only in a match does it move to the centre slot the HUD reserves for it. */
#musBar{position:fixed;z-index:6;display:flex;align-items:center;gap:7px;height:26px;padding:0 6px 0 10px;
  left:max(14px,env(safe-area-inset-left));transform:none;box-sizing:border-box;max-width:min(42vw,340px);
  bottom:calc(max(8px,env(safe-area-inset-bottom)) + 10px);
  background:rgba(5,5,7,.55);box-shadow:inset 0 0 0 1px var(--line2,rgba(255,255,255,.16));color:#fff;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px));
  opacity:0;pointer-events:none;transition:opacity .45s ease}
#musBar.ingame{left:50%;transform:translateX(-50%);max-width:min(52vw,420px);
  bottom:calc(max(8px,env(safe-area-inset-bottom)) + var(--np-bottom, 46px))}
#musBar.show{opacity:.93;pointer-events:auto}
#musBar[hidden]{display:none}
#musBar .t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:600 10px var(--mono,"JetBrains Mono",ui-monospace,monospace);letter-spacing:.06em;color:var(--muted,#9398a8)}
#musBar button{flex:0 0 auto;height:19px;padding:0 7px;border:0;cursor:pointer;background:rgba(255,255,255,.08);color:#fff;
  font:italic 900 12px/1 var(--display,"Barlow Condensed",Impact,sans-serif);letter-spacing:.04em}
#musBar button:hover{background:rgba(255,42,74,.35)}`;
  document.head.appendChild(css);

  function build() {
    const bar = document.createElement('div');
    bar.id = 'musBar';
    bar.hidden = true;
    const name = document.createElement('span');
    name.className = 't';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'NEXT';
    btn.setAttribute('aria-label', 'Play the next track');
    btn.onclick = e => { e.stopPropagation(); next(); };
    bar.appendChild(name); bar.appendChild(btn);
    bar.addEventListener('pointerenter', () => flash(), { passive: true });
    document.body.appendChild(bar);
    M.bar = bar; M.name = name;
    label(); place();
  }
  function flash(ms) { M.showUntil = performance.now() + (ms || SHOW_MS); }
  // moving the pointer down into the strip the label lives in brings it back without a click
  addEventListener('pointermove', e => {
    if (M.bar && !M.bar.hidden && e.clientY > innerHeight - 170 && Math.abs(e.clientX - innerWidth / 2) < innerWidth * 0.3) flash(2600);
  }, { passive: true });

  function label() {
    if (!M.name) return;
    const t = cur(M.mood);
    const txt = t ? (t.title || t.file) + (t.credit ? ' · ' + t.credit : '') : '';
    if (txt !== M.lastKey) { M.name.textContent = txt; M.lastKey = txt; flash(); }
  }
  // in a match the strip the HUD reserved (--np-bottom); on the menus the bottom edge, where the
  // screens are panels and the sound button keeps to the right-hand corner
  function place() {
    const bar = M.bar; if (!bar || bar.hidden) return;
    let inGame = false;
    try { inGame = GameAudio.A.screen == null; } catch (e) {}
    if (bar.classList.contains('ingame') !== inGame) bar.classList.toggle('ingame', inGame);
  }

  // ---------- when it plays ----------
  // A live match gets the fight pool; everything else — every menu, the online lobby and waiting
  // room, results, and a paused match's own screen — gets the chill pool. The title and select
  // screens run an attract fight behind the art (UI.startDemo), so Game.demo is true while you look
  // at a menu: only a real match counts as fighting. A paused match keeps its fight track (12_audio
  // already drops it under a lowpass), so pausing doesn't yank the music out from under you.
  setInterval(function () {
    if (!M.ready || !M.bar) return;
    const A = GameAudio.A;
    let inMatch = false;
    try {
      inMatch = A.screen == null && !Game.demo && (Game.state === 'match' || Game.state === 'arenaEnd');
    } catch (e) {}
    const want = !A.muted && (typeof Sfx === 'undefined' || Sfx.on);
    setMood(inMatch ? 'fight' : 'menu');
    if (M.bar.hidden === want) { M.bar.hidden = !want; if (want) { place(); flash(); } }
    if (want && !M.on) { M.on = true; start(M.mood); }
    else if (!want && M.on) { M.on = false; stop('menu', 0.4); stop('fight', 0.4); }
    else if (want && M.on) {
      const c = M.ch[M.mood];                                     // a tab switch or an OS pause
      if (c && c.playing && c.el.paused) { const p = c.el.play(); if (p && p.catch) p.catch(() => { M.blocked = true; }); }
      if (!c) start(M.mood);                                      // the graph appeared after unlock
    }
    label(); place();
    const show = want && performance.now() < M.showUntil;
    if (show !== M.shown) { M.shown = show; M.bar.classList.toggle('show', show); }
  }, 400);
})();
