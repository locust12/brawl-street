// ===== Brawl Street menus: title, Tekken-style fighter select, stage extras, results (visual layer over 80_ui.js) =====
// Restyles the existing screens by id; the button wiring in 80_ui.js stays as is. Never touches fight state.
(function () {
  const q = id => document.getElementById(id);
  const ASSET = 'assets/';
  const PNUM = i => String(i + 1).padStart(2, '0');
  const safeSfx = () => { try { Sfx.ui(); } catch (e) {} };

  // ---------- fighter art: transparent cutout when it exists, the portrait jpg otherwise ----------
  const ART = {};
  function art(id, cb) {
    let a = ART[id];
    if (!a) {
      a = ART[id] = { url: ASSET + ASSET_ID(id) + '.jpg', cut: false, wait: [] };
      // one dropped request (flaky mobile data) left that fighter's tile blank for the session: when the cutout fails
      // the portrait jpg is preloaded, with two retries, before the tile is painted
      const done = () => { a.done = true; a.wait.splice(0).forEach(f => f(a)); };
      const jpg = () => { let jt = 0; const j = new Image(); try { j.fetchPriority = 'low'; } catch (e) {} j.onload = () => { a.url = j.src; done(); }; j.onerror = () => { if (++jt < 3) setTimeout(() => { j.src = a.url + '?r=' + jt; }, 700 * jt); else done(); }; j.src = a.url; };
      const im = new Image();
      // Low, for the same reason as loadPortraits (30_draw.js): the roster warms every fighter's
      // cut-out at once, and at the default Low-with-everything-else that queue is what the Store's
      // own art had to wait behind. A tile that paints a second later costs nothing; a shop full of
      // empty boxes for twenty seconds is the thing people were seeing.
      try { im.fetchPriority = 'low'; } catch (e) { /* older engines ignore it */ }
      im.onload = () => { a.url = im.src; a.cut = true; a.wait.splice(0).forEach(f => f(a)); };
      im.onerror = jpg;   // no cutout (or it failed): the portrait, retried, never a blank tile
      im.src = ASSET + ASSET_ID(id) + '_cut.webp';
    }
    if (cb) { if (a.cut || a.done) cb(a); else a.wait.push(cb); }
    return a;
  }

  const css = `
  /* title */
  #scTitle.tb-title{padding:0;background:#050507;display:block;overflow:hidden}
  #scTitle .tb-art,#scTitle .tb-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  #scTitle .tb-art{background:#0a0b10 center/cover no-repeat;transform:scale(1.04);animation:tbKen 30s ease-in-out infinite alternate;will-change:transform}
  #scTitle .tb-vid{opacity:0;transition:opacity .8s}
  #scTitle .tb-vid.on{opacity:1}
  @keyframes tbKen{from{transform:scale(1.04)}to{transform:scale(1.12) translate3d(-1.5%,-1%,0)}}
  #scTitle .tb-shade{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(90deg,rgba(5,5,7,.94) 0%,rgba(5,5,7,.82) 24%,rgba(5,5,7,.25) 50%,rgba(5,5,7,0) 70%),linear-gradient(0deg,rgba(5,5,7,.92) 0%,rgba(5,5,7,0) 30%),linear-gradient(180deg,rgba(5,5,7,.7) 0%,rgba(5,5,7,0) 16%)}
  #scTitle .tb-scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px);mix-blend-mode:overlay}
  #scTitle .tb-sweep{position:absolute;inset:0;pointer-events:none;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.07) 49%,transparent 56%);background-size:260% 100%;animation:tbSweep 8s linear infinite}
  @keyframes tbSweep{from{background-position:120% 0}to{background-position:-120% 0}}
  #scTitle .tb-top{position:absolute;left:0;right:0;top:0;z-index:3;display:flex;justify-content:space-between;align-items:flex-start;padding:max(20px,env(safe-area-inset-top)) max(26px,4vw) 0}
  #scTitle .tb-stats{display:flex;gap:26px}
  #scTitle .tb-stats div{display:flex;flex-direction:column;gap:2px}
  #scTitle .tb-stats b{font-family:var(--display);font-style:italic;font-weight:900;font-size:34px;line-height:.9}
  #scTitle .tb-stats span{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase}
  #scTitle .tb-chain{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--muted);display:flex;align-items:center;gap:8px;padding-top:8px}
  #scTitle .tb-chain::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 8px var(--lime)}
  #scTitle .tb-ui{position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;gap:clamp(10px,2vh,20px);min-height:100%;
    padding:max(96px,calc(env(safe-area-inset-top) + 86px)) 16px max(20px,env(safe-area-inset-bottom)) max(24px,4vw);width:min(560px,100%);box-sizing:border-box}
  #scTitle .tb-logo{width:min(420px,80vw);height:auto;align-self:flex-start;filter:drop-shadow(0 14px 30px rgba(0,0,0,.7));margin-left:-14px;animation:tbSlam .7s .1s cubic-bezier(.2,.9,.2,1) both}
  #scTitle .tb-logo.tb-text{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(56px,11vw,120px);line-height:.84;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;margin-left:0}
  #scTitle .tb-logo.tb-text em{display:block;font-style:italic;background:linear-gradient(180deg,#ff8a6a,#ff2a4a 60%,#b0102a);-webkit-background-clip:text;background-clip:text;color:transparent}
  @keyframes tbSlam{from{opacity:0;transform:scale(1.3);filter:blur(10px)}to{opacity:1;transform:none;filter:drop-shadow(0 14px 30px rgba(0,0,0,.7))}}
  #scTitle .tb-kicker{font-family:var(--mono);font-weight:500;letter-spacing:.3em;font-size:12px;color:#d9dce6;margin:-6px 0 4px;display:flex;gap:12px;align-items:center}
  #scTitle .tb-kicker::before{content:"";width:28px;height:2px;background:var(--red);box-shadow:0 0 10px var(--red)}
  #scTitle .tb-menu{display:flex;flex-direction:column;gap:6px}
  .tb-item{--c:var(--red);position:relative;display:grid;grid-template-columns:40px 1fr auto;align-items:center;column-gap:8px;width:min(430px,100%);min-height:54px;padding:6px 20px 6px 14px;border:0;cursor:pointer;text-align:left;color:var(--text);
    background:linear-gradient(90deg,rgba(12,13,20,.86),rgba(12,13,20,.55));box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));transition:transform .18s cubic-bezier(.2,1.3,.4,1),background .2s;animation:tbIn .5s both;overflow:hidden;isolation:isolate}
  .tb-item::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,var(--c),color-mix(in srgb,var(--c) 40%,transparent));transform:translateX(-101%);transition:transform .28s cubic-bezier(.7,0,.2,1)}
  .tb-item::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c);box-shadow:0 0 12px var(--c)}
  .tb-item i{font-family:var(--mono);font-style:normal;font-weight:700;font-size:12px;color:var(--c);letter-spacing:.06em;transition:color .2s}
  .tb-item b{font-family:var(--display);font-weight:900;font-style:italic;font-size:clamp(22px,2.6vw,28px);letter-spacing:.005em;line-height:.95}
  .tb-item small{grid-column:2;font-size:12px;color:var(--muted);margin-top:1px;font-weight:500;transition:color .2s}
  .tb-item em{grid-row:1/span 2;grid-column:3;font-style:normal;font-family:var(--mono);font-size:14px;color:#fff;opacity:0;transform:translateX(-8px);transition:.18s}
  .tb-item:hover,.tb-item:focus-visible,.tb-item.tb-on{transform:translateX(10px);outline:none}
  .tb-item:hover::before,.tb-item.tb-on::before{transform:none}
  .tb-item:hover i,.tb-item.tb-on i,.tb-item:hover small,.tb-item.tb-on small{color:#fff}
  .tb-item:hover em,.tb-item.tb-on em{opacity:1;transform:none}
  .tb-item.tb-hot{background:var(--red)}
  .tb-item.tb-hot i,.tb-item.tb-hot small{color:#fff}
  .tb-item.tb-hot::before{background:linear-gradient(90deg,#ff5a72,#ff2a4a)}
  .tb-item.tb-gold{--c:var(--gold)}
  .tb-item.tb-cyan{--c:var(--cyan)}
  .tb-item .tb-badge{position:absolute;right:14px;top:8px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;padding:2px 5px;background:#fff;color:#050507}
  @keyframes tbIn{from{opacity:0;transform:translateX(-34px)}to{opacity:1;transform:none}}
  #scTitle .tb-build{font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:#5d6272;margin-top:2px}
  #scTitle .tb-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
  #scTitle .tb-foot .note{text-align:left;color:var(--muted);font-family:var(--mono);font-size:11px;letter-spacing:.04em}
  #scTitle .tb-roster{position:absolute;right:max(20px,3vw);bottom:max(20px,env(safe-area-inset-bottom));z-index:2;display:grid;grid-template-columns:repeat(12,36px);gap:3px;padding:8px;
    background:linear-gradient(90deg,transparent,rgba(5,5,7,.72) 18%);direction:rtl}
  /* The tile used to be flat #0a0b11, which was fine for twelve bright animal mascots and stopped
     working the moment the roster opened up to 42: SIN, TYRANT, MYSTIC, OMEN, EMBER and GIGA are all
     near-black art, so on a near-black tile they read as EMPTY SQUARES on the title screen -- the
     first thing anyone sees (runs/portal/title_loaded.jpg, where the DOM reported all 42 filled while
     a third of them looked blank). A light slate wash behind the portrait separates dark silhouettes
     without touching the bright ones. */
  /* background-COLOR, not a gradient: line ~270 sets s.style.backgroundImage for the portrait, and a
     gradient lives in background-image, so it would be overwritten the moment the art loaded. */
  #scTitle .tb-roster span{width:36px;height:36px;background-color:#2b3244;background-repeat:no-repeat;background-position:50% 6%;background-size:185% auto;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px));transition:transform .15s}
  #scTitle .tb-roster span:hover{transform:translateY(-3px)}
  #scTitle .tb-toast{position:absolute;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:5;padding:12px 18px;background:rgba(5,5,7,.9);box-shadow:inset 0 0 0 1px var(--line2);font-size:14px;max-width:calc(100% - 32px);text-align:center}
  #scTitle .tb-toast a{color:var(--cyan)}
  @media (max-width:760px){
    #scTitle .tb-shade{background:linear-gradient(0deg,rgba(5,5,7,.96) 0%,rgba(5,5,7,.78) 55%,rgba(5,5,7,.25) 100%)}
    #scTitle .tb-roster,#scTitle .tb-chain{display:none}
    #scTitle .tb-ui{justify-content:flex-end;padding-top:90px}
    #scTitle .tb-stats{gap:16px} #scTitle .tb-stats b{font-size:26px}
    .tb-item{min-height:52px} .tb-item b{font-size:21px}
  }
  /* Short screens: the column ran past the bottom edge and cut off the last plates — on a 1440x900
     laptop "Store" and "Profile" were clipped off the screen entirely (9/21, seen in a screenshot).
     Everything scales down with the viewport height so the whole menu always fits. */
  @media (max-height:1000px){
    #scTitle .tb-ui{padding-top:max(60px,calc(env(safe-area-inset-top) + 54px));gap:clamp(6px,1.4vh,12px)}
    #scTitle .tb-logo{width:min(330px,62vw)}
    .tb-item{min-height:clamp(40px,5.2vh,54px);padding:4px 18px 4px 14px}
    .tb-item b{font-size:clamp(18px,2.2vh,24px)}
    .tb-item small{font-size:11px}
  }
  @media (max-height:820px){
    #scTitle .tb-ui{padding-top:max(46px,calc(env(safe-area-inset-top) + 40px))}
    #scTitle .tb-logo{width:min(270px,54vw)}
    #scTitle .tb-menu{gap:4px}
    .tb-item small{display:none}          /* the sub-line is the first thing to go, never a button */
  }
  /* 9/22 night: the stats row sat on top of the logo on every short screen (the column's padding shrinks, the
     stats do not). Stats + chain now stack on the right, over the art, where nothing else is. */
  #scTitle .tb-top{justify-content:flex-end;align-items:flex-end;flex-direction:column;gap:6px}
  .tb-item.tb-quiet{--c:#8a92b0}
  @media (max-height:820px){
    #scTitle .tb-logo.tb-text{font-size:clamp(40px,8vh,68px)}
    #scTitle .tb-stats b{font-size:26px}
  }
  @media (max-width:760px){ #scTitle .tb-top{align-items:flex-start;flex-direction:row;justify-content:space-between} }
  /* 9/22 night: at 1280x720 the Brawl button sat below the fold under two rows of stages (audit #16). It now
     rides the bottom edge of the screen while the stage list scrolls under it. */
  #scWager .row:has(> #bFight){position:sticky;bottom:0;z-index:6;margin:0 -16px;padding:14px 16px max(14px,env(safe-area-inset-bottom));
    background:linear-gradient(0deg,rgba(5,5,7,.97) 55%,rgba(5,5,7,0));justify-content:flex-end}
  #scWager #bFight{min-width:220px;font-size:20px}
  /* 9/22 night: a phone held sideways (<= 500 px tall). The logo took half the height, only 4 of the 10 plates were on
     screen and the portrait mosaic sat on top of them (runs/phone/ph.jpg). Logo + footer on the left, the menu as two
     columns on the right, the mosaic / stats / tagline / chain line (decoration) go. Everything is on one screen. */
  @media (max-height:640px) and (orientation:landscape){
    #scTitle .tb-roster,#scTitle .tb-top,#scTitle .tb-kicker,#scTitle .tb-build{display:none}
    #scTitle .tb-ui{display:grid;grid-template-columns:minmax(150px,26%) minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:18px;row-gap:8px;width:100%;
      align-content:center;padding:max(12px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
    #scTitle .tb-logo{grid-column:1;grid-row:1;width:100%;margin-left:0;align-self:end}
    #scTitle .tb-logo.tb-text{font-size:clamp(34px,7vw,56px)}
    #scTitle .tb-foot{grid-column:1;grid-row:2;align-self:start;margin-top:0}
    #scTitle .tb-menu{grid-column:2;grid-row:1 / span 2;display:grid;grid-template-columns:1fr 1fr;gap:5px;align-content:center}
    .tb-item{width:100%;min-height:clamp(34px,11.5vh,46px);padding:3px 14px 3px 10px;grid-template-columns:30px 1fr auto}
    .tb-item b{font-size:clamp(15px,5vh,20px)}
    .tb-item small{display:none}
    .tb-item:hover,.tb-item:focus-visible,.tb-item.tb-on{transform:translateX(4px)}
    .tb-item .tb-badge{top:4px;right:10px}
    body #instBtn{right:max(64px,calc(env(safe-area-inset-right) + 56px))}
    #scWager .row:has(> #bFight){padding:8px 64px max(8px,env(safe-area-inset-bottom)) 16px}
    #scWager #bFight{min-width:170px;font-size:18px}   /* clear of the sound chip in the corner (beats 88_install's own rule) */
  }
  /* The core set (79_core) used to be exactly 12 fighters + the Build-one tile, so this was hardcoded
     to two rows of seven big portraits. The set is now 42 (9/25), and seven fixed columns meant SIX
     rows that ran straight off the bottom of the screen -- the last row sat behind the slot bar and
     the "Next: stakes" button (runs/sel42/03_select.jpg).
     auto-fill sizes the grid to whatever the roster actually holds, and the scroll cap means it can
     never overflow again however many fighters get added. */
  #roster.core{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:7px;
    max-height:calc(100vh - 330px);overflow-y:auto;overscroll-behavior:contain;padding-right:2px;
    -webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 34px),transparent);
    mask-image:linear-gradient(to bottom,#000 calc(100% - 34px),transparent)}
  #roster.core.at-end{-webkit-mask-image:none;mask-image:none}
  #roster.core .pick .nm{font-size:12px;padding:10px 3px 4px}
  @media (max-height:640px){#roster.core{grid-template-columns:repeat(auto-fill,minmax(74px,1fr));max-height:calc(100vh - 250px)}
    #roster.core .pick .nm{font-size:10px;padding:8px 2px 3px}}
  #scTitle .tb-roster{grid-template-columns:repeat(12,40px)}
  @media (prefers-reduced-motion:reduce){#scTitle .tb-art,#scTitle .tb-sweep{animation:none}}
  /* results */
  #scResults .winart{position:relative;height:min(42vh,380px);display:flex;align-items:flex-end;justify-content:center;margin-bottom:-18px}
  #scResults .winart::before{content:"";position:absolute;left:-20%;right:-20%;bottom:0;height:40%;background:radial-gradient(50% 50% at 50% 60%,color-mix(in srgb,var(--wc,#ff2a4a) 60%,transparent),transparent 70%);filter:blur(14px)}
  #scResults .winart img{position:relative;height:100%;width:auto;filter:drop-shadow(0 0 26px color-mix(in srgb,var(--wc,#ff2a4a) 55%,transparent)) drop-shadow(0 18px 30px rgba(0,0,0,.6));animation:heroIn .6s cubic-bezier(.2,1,.3,1) both}
  #scResults .hilite{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
  #scResults .hchip{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 14px;background:rgba(12,13,20,.75);box-shadow:inset 0 0 0 1px var(--line2);clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))}
  #scResults .hchip b{font-family:var(--display);font-style:italic;font-weight:900;font-size:22px;line-height:1;color:var(--gold)}
  #scResults .hchip i{font-family:var(--mono);font-style:normal;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
    #scResults .wintag{position:relative;z-index:2;margin-top:24px;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.3em;color:var(--red)}
    /* the in-match Clip It chip stayed up over the winner's art; the results have their own "Clip the finish" (9/22 night) */
    body:has(#scResults:not([hidden])) #clipBtn{display:none!important}
  #scResults.has-art #winCv,#scResults.art-pending #winCv{display:none}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------- title ----------
  const T = q('scTitle'); if (!T) return;
  const bg = document.createElement('div'); bg.className = 'tb-art';
  const vid = document.createElement('video'); vid.className = 'tb-vid'; vid.muted = true; vid.loop = true; vid.playsInline = true; vid.autoplay = true; vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
  // fade the video in over the key art only once a frame has actually been presented: 'playing' can fire before the
  // decoder paints, and the title sat on a black video for seconds (9/22 night, a 1280x720 capture at 5 s)
  const vidOn = () => vid.classList.add('on');
  vid.addEventListener('playing', () => {
    if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(vidOn);
    else { const t = () => { if (vid.currentTime > 0.15) { vid.removeEventListener('timeupdate', t); vidOn(); } }; vid.addEventListener('timeupdate', t); }
  });
  vid.src = ASSET + 'hero.mp4';
  const shade = document.createElement('div'); shade.className = 'tb-shade';
  const scan = document.createElement('div'); scan.className = 'tb-scan';
  const sweep = document.createElement('div'); sweep.className = 'tb-sweep';
  const ui = document.createElement('div'); ui.className = 'tb-ui';
  const logo = document.createElement('div'); logo.className = 'tb-logo tb-text'; logo.innerHTML = 'Brawl<em>Street</em>';
  const logoImg = new Image(); logoImg.alt = 'Brawl Street'; logoImg.className = 'tb-logo';
  logoImg.onload = () => logo.replaceWith(logoImg); logoImg.src = ASSET + 'logo_bs.webp';
  const kick = document.createElement('div'); kick.className = 'tb-kicker'; kick.textContent = 'The meme coin platform fighter';
  const build = document.createElement('div'); build.className = 'tb-build'; build.textContent = 'BUILD ' + (window.TB_BUILD || 'dev');
  const menu = document.createElement('div'); menu.className = 'tb-menu';
  const mk = (id, text) => { const b = document.createElement('button'); b.id = id; b.textContent = text; return b; };
  const bOnline = mk('bOnline', 'Play online'), bFfa = mk('bFfa', 'Free-for-all'), bTrain = mk('bTrain', 'Training');
  const ITEMS = [
    [bOnline, 'Play online', 'Quick match or room code · stake against real players', 'tb-hot', 'LIVE'],
    ['bCpu', 'Fight the CPU', 'One on one against the bots'],
    [bFfa, 'Free-for-all', 'Four fighters, everyone against everyone'],
    ['bVs', 'Local versus', 'Two players on one keyboard or pads'],
    [bTrain, 'Training', 'Endless stocks, a dummy you set, hitboxes and frame data', 'tb-cyan'],
    ['bArena', 'Bet on the fights', 'Bots battle live · back a side', 'tb-gold'],
    ['bHelp', 'How to play', 'Controls, items and the Final Smash', 'tb-cyan'],
  ];
  ITEMS.forEach(([ref, label, sub, cls, badge], i) => {
    const b = typeof ref === 'string' ? q(ref) : ref; if (!b) return;
    b.className = 'tb-item' + (cls ? ' ' + cls : '');
    b.innerHTML = `<i>${PNUM(i)}</i><b>${label}</b><em>▶</em><small>${sub}</small>` + (badge ? `<span class="tb-badge">${badge}</span>` : '');
    b.style.animationDelay = (0.25 + i * 0.06) + 's';
    b.addEventListener('mouseenter', safeSfx);
    menu.appendChild(b);
  });
  const toast = msg => {
    let t = T.querySelector('.tb-toast'); if (!t) { t = document.createElement('div'); t.className = 'tb-toast'; T.appendChild(t); }
    t.innerHTML = msg; clearTimeout(toast.t); toast.t = setTimeout(() => t.remove(), 6000);
  };
  bOnline.addEventListener('click', () => {
    safeSfx();
    if (window.Net && typeof Net.open === 'function') return Net.open();
    toast('Online play is being switched on. Try again in a moment.');
  });
  bTrain.addEventListener('click', () => {
    safeSfx();
    if (window.TRAIN && typeof TRAIN.start === 'function') return TRAIN.start('doge', 'dojo');
    toast('Training is not available in this build.');
  });
  bFfa.addEventListener('click', () => {
    safeSfx();
    const pool = coreChars().map(c => c.id).filter(id => id !== 'doge');
    const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    UI.slots = [{ ctrl: IS_TOUCH ? 'touch' : 'kb1', char: 'doge', stake: 0.05 },
      { ctrl: 'cpu', level: 5, char: pick(), stake: 0.05 }, { ctrl: 'cpu', level: 5, char: pick(), stake: 0.05 }, { ctrl: 'cpu', level: 5, char: pick(), stake: 0.05 }];
    UI.toSelect();
  });
  const foot = document.createElement('div'); foot.className = 'tb-foot';
  for (const id of ['load3d', 'walletLine']) { const el = q(id); if (el) foot.appendChild(el); }
  ui.append(logo, kick, menu, foot, build);
  // Store / Profile (8b_store.js) and Graphics (89_graphics.js) arrive later as plain .btn buttons: the list
  // had two styles and, at 720p, Graphics fell off the bottom (9/22 night). Adopt them into the numbered
  // list, keep How to play and Graphics last, and renumber everything in order. Only touches the DOM when
  // something is actually out of place, so the observer never feeds itself.
  const ADOPT = { bStore: ['Store', 'Skins, finishes and gear'], bProfile: ['Profile', 'Your record, rank and win cards'], bGfx: ['Graphics', 'Quality and frame rate'] };
  const tidyMenu = () => {
    for (const [id, [label, sub]] of Object.entries(ADOPT)) {
      const b = q(id); if (!b || b.classList.contains('tb-item')) continue;
      b.className = 'tb-item tb-quiet'; b.innerHTML = `<i></i><b>${label}</b><em>▶</em><small>${sub}</small>`;
      b.addEventListener('mouseenter', safeSfx);
      if (b.parentElement !== menu) menu.appendChild(b);
    }
    const tail = [q('bHelp'), q('bGfx')].filter(b => b && b.parentElement === menu);
    const kids = [...menu.children];
    if (tail.some((b, i) => kids[kids.length - tail.length + i] !== b)) for (const b of tail) menu.appendChild(b);
    [...menu.children].filter(b => b.classList.contains('tb-item')).forEach((b, i) => { const n = b.querySelector('i'); if (n && n.textContent !== PNUM(i)) n.textContent = PNUM(i); });
  };
  new MutationObserver(tidyMenu).observe(menu, { childList: true });
  setTimeout(tidyMenu, 0);
  const top = document.createElement('div'); top.className = 'tb-top';
  const stats = document.createElement('div'); stats.className = 'tb-stats';
  const chain = document.createElement('div'); chain.className = 'tb-chain'; chain.textContent = 'Built on Robinhood Chain';
  top.append(stats, chain);
  const roster = document.createElement('div'); roster.className = 'tb-roster';
  const brk = ['tl', 'tr', 'bl', 'br'].map(k => { const d = document.createElement('i'); d.className = 'brk ' + k; return d; });
  T.classList.add('tb-title');
  const oldWrap = T.querySelector('.wrap');
  T.prepend(bg, vid, shade, scan, sweep); T.append(top, ui, roster, ...brk);
  if (oldWrap) oldWrap.remove();
  const stageCount = () => CORE_SET.on ? CORE_SET.stages.length : 6 + (typeof STAGES_MENU_EXTRA !== 'undefined' ? STAGES_MENU_EXTRA.length : 0);
  function paintTitleStats() {
    stats.innerHTML = [[coreChars().length, 'Fighters'], [stageCount(), 'Stages'], [4, 'Players']].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
    roster.innerHTML = '';
    coreChars().forEach(c => { const s = document.createElement('span'); s.title = c.name; art(c.id, a => { s.style.backgroundImage = `url(${a.url})`; }); roster.appendChild(s); });
  }
  paintTitleStats();
  const keyart = new Image();
  keyart.onload = () => { bg.style.backgroundImage = 'url(' + ASSET + 'keyart.jpg)'; document.documentElement.style.setProperty('--tb-art', 'url(' + ASSET + 'keyart.jpg)'); };
  keyart.src = ASSET + 'keyart.jpg';

  // keyboard / pad-style navigation on the title
  const items = () => [...menu.querySelectorAll('.tb-item')];
  let idx = 0;
  const mark = () => items().forEach((b, i) => b.classList.toggle('tb-on', i === idx));
  addEventListener('keydown', e => {
    if (T.hidden) return;
    const list = items(); if (!list.length) return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { idx = (idx + 1) % list.length; mark(); list[idx].focus({ preventScroll: true }); safeSfx(); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { idx = (idx + list.length - 1) % list.length; mark(); list[idx].focus({ preventScroll: true }); safeSfx(); e.preventDefault(); }
    else if ((e.code === 'Enter' || e.code === 'KeyF') && document.activeElement && !document.activeElement.classList.contains('tb-item')) { list[idx].click(); }
  });
  items().forEach((b, i) => b.addEventListener('focus', () => { idx = i; mark(); }));
  mark();
  // the title covers the whole screen: let the 3D view idle behind it
  window.TB_MENU_COVERS = () => !T.hidden && (!!bg.style.backgroundImage || vid.classList.contains('on'));
  // the video only plays while the title is up
  new MutationObserver(() => { try { if (T.hidden) vid.pause(); else vid.play().catch(() => {}); } catch (e) {} }).observe(T, { attributes: true, attributeFilter: ['hidden'] });

  if (typeof UI === 'undefined') return;

  // ---------- fighter select (Tekken layout) ----------
  // 10/15: the bars read the LOCAL stat line, not the base roster entry. 66_traits swaps a fighter's
  // profile in at the start of every unseeded match (Game.sigs), which is every match a player starts
  // from this screen -- so the card was quietly showing numbers nobody plays with. KAIJU's card said
  // weight 134 is walk 4.8 and WOLVERINU's said he walks at 7.0 when he walks at 7.3.
  const liveStats = c => (typeof PROFILE !== 'undefined' && PROFILE[c.id]) ? Object.assign({}, c, PROFILE[c.id]) : c;
  const statBars = c0 => { const c = liveStats(c0); return [['Speed', (c.walk - 4.5) / 3.4], ['Power', (c.power - 0.85) / 0.35], ['Weight', (c.weight - 75) / 50]]
    .map(([l, v]) => `<span>${l}</span><span class="bar"><i style="width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%"></i></span>`).join(''); };
  const heroState = {};
  function paintHero(elId, slotIdx, charId) {
    const el = q(elId); if (!el) return;
    const s = UI.slots[slotIdx];
    if (!s) { el.innerHTML = ''; el.style.visibility = 'hidden'; heroState[elId] = null; return; }
    el.style.visibility = ''; el.style.setProperty('--c', PCOLORS[slotIdx]);
    const c = CHAR_BY_ID[charId || s.char]; if (!c) return;
    const who = (s.ctrl === 'cpu' ? 'CPU ' + (s.level || 5) : 'P' + (slotIdx + 1)) + ' · ' + (CTRL_LABEL[UI.slotCtrl(s)] || '');
    if (heroState[elId] !== c.id) {
      heroState[elId] = c.id;
      el.innerHTML = `<div class="art"><img alt=""></div><div class="plate"><div class="who"></div><div class="nm"></div><div class="ttl"></div><div class="bl"></div><div class="stats"></div></div>`;
      const img = el.querySelector('img');
      art(c.id, a => { if (heroState[elId] === c.id) img.src = a.url; });
      el.querySelector('.nm').textContent = c.name; el.querySelector('.ttl').textContent = c.title || ''; el.querySelector('.bl').textContent = c.blurb || '';
      el.querySelector('.stats').innerHTML = statBars(c);
    }
    el.querySelector('.who').textContent = who;
    if (window.CustomLook && CustomLook.dressHero) try { CustomLook.dressHero(el, s, c); } catch (e) { /* cosmetic */ }
  }
  let cursor = 0, hoverId = null;
  UI.renderSelect = function () {
    const box = q('slots'); box.innerHTML = '';
    this.slots.forEach((s, i) => {
      const c = CHAR_BY_ID[s.char], el = document.createElement('div');
      el.className = 'slot' + (i === this.active ? ' active' : ''); el.style.setProperty('--c', PCOLORS[i]);
      el.innerHTML = `<span class="face"></span><div class="who"><span class="pn">${s.ctrl === 'cpu' ? 'CPU' : 'P' + (i + 1)}</span><button class="type" id="slotType${i}">${CTRL_LABEL[this.slotCtrl(s)]}</button></div><div class="nm">${c.name}</div>`;
      art(c.id, a => { el.querySelector('.face').style.backgroundImage = `url(${a.url})`; });
      el.addEventListener('click', e => {
        if (e.target.classList.contains('type')) {
          const k = CTRL_CYCLE.indexOf(this.slotCtrl(s)), nx = k + 1;
          if (nx >= CTRL_CYCLE.length) { if (i >= 2) { this.slots.splice(i, 1); this.active = 0; } else this.setCtrl(s, CTRL_CYCLE[0]); }
          else this.setCtrl(s, CTRL_CYCLE[nx]);
        } else this.active = i;
        safeSfx(); this.renderSelect();
      });
      box.appendChild(el);
      if (window.V3 && V3.loadChar && V3.ready) V3.loadChar(c.id).catch(() => {});
    });
    for (let i = this.slots.length; i < 4; i++) {
      const el = document.createElement('div'); el.className = 'slot empty'; el.textContent = '+ Add fighter';
      el.addEventListener('click', () => q('bAddSlot').click()); box.appendChild(el);
    }
    q('bAddSlot').disabled = this.slots.length >= 4;
    const ro = q('roster');
    ro.classList.toggle('core', CORE_SET.on);   // 12 fighters: two rows of seven big portraits (79_core)
    if (ro.querySelectorAll('.pick').length !== coreChars().length) {
      ro.innerHTML = '';
      coreChars().forEach((c, ci) => {
        const b = document.createElement('button'); b.className = 'pick'; b.id = 'pick_' + c.id; b.title = c.name + ' · ' + (c.title || '');
        b.innerHTML = `<span class="face"></span><span class="tags"></span><span class="nm">${c.name}</span>`;
        art(c.id, a => { b.querySelector('.face').style.backgroundImage = `url(${a.url})`; });
        b.addEventListener('mouseenter', () => { hoverId = c.id; cursor = ci; markCursor(); previewActive(); try { Sfx.ui(); } catch (e) {} });
        b.addEventListener('mouseleave', () => { hoverId = null; previewActive(); });
        b.addEventListener('click', () => pickChar(c.id));
        ro.appendChild(b);
      });
    }
    // The grid is capped and scrolls (see #roster.core above), which is right -- but at 1920x1080 it
    // cuts the seventh row through the name labels with nothing to say there is more below, and five
    // fighters read as broken tiles rather than as "scroll". A fade on the bottom edge says it
    // without taking space, and it is removed at the end of the scroll so the last row is never
    // dimmed. Measured: 47 tiles, 12 of them below the fold at 1080p.
    if (!ro._fadeWired) {
      ro._fadeWired = 1;
      const fade = () => ro.classList.toggle('at-end', ro.scrollTop + ro.clientHeight >= ro.scrollHeight - 2);
      ro.addEventListener('scroll', fade, { passive: true });
      ro._fade = fade;
    }
    requestAnimationFrame(ro._fade);
    // who picked what
    for (const b of ro.querySelectorAll('.pick')) { b.classList.remove('picked'); b.querySelector('.tags').innerHTML = ''; b.style.removeProperty('--c'); }
    this.slots.forEach((s, i) => {
      const b = q('pick_' + s.char); if (!b) return;
      b.classList.add('picked'); b.style.setProperty('--c', PCOLORS[i]);
      b.querySelector('.tags').insertAdjacentHTML('beforeend', `<b style="background:${PCOLORS[i]}">${s.ctrl === 'cpu' ? 'CPU' : i + 1 + 'P'}</b>`);
    });
    previewActive(); markCursor();
  };
  function previewActive() {
    const a = UI.active;
    paintHero('heroP1', 0, a === 0 && hoverId ? hoverId : null);
    paintHero('heroP2', 1, a === 1 && hoverId ? hoverId : null);
    showroomSet(UI.slots.map((s, i) => (i === a && hoverId) ? hoverId : s.char));
  }
  // PHASE 4: the live character-select preview. This call site already existed and asked for
  // `V3.showroom.set([...])` on every hover and every pick -- but V3.showroom was never written, so the
  // select screen showed a STATIC cutout of your fighter while two RANDOM fighters brawled behind it.
  // The attract fight is already a real 3D match, so the cheapest honest "live" is to point it at the
  // fighters you are actually choosing: hover Whale and Whale is the one moving behind the panel.
  // Debounced hard, because hovering across the roster would otherwise restart a match per tile.
  const SHOW = { t: 0, last: null };
  function showroomSet(ids) {
    // `window.V3`, never a bare V3. The 3D layer is a type="module" script, so it runs AFTER this
    // classic one -- touch the select screen before it has loaded (or on a build where it failed) and
    // a bare reference throws ReferenceError: V3 is not defined, out of a hover handler, which takes
    // the rest of the menu's click wiring with it. Caught on the portal build, but it was live here too.
    const V = typeof window !== 'undefined' ? window.V3 : null;
    if (!V) return;
    if (V.showroom && V.showroom.set) { try { V.showroom.set(ids); } catch (e) {} return; }   // a real showroom wins
    if (!ids || ids.length < 2 || V.noShowroom) return;
    const key = ids.slice(0, 2).join();
    if (key === SHOW.last) return;
    if (SHOW.t) clearTimeout(SHOW.t);
    SHOW.t = setTimeout(() => {
      SHOW.t = 0;
      const S = q('scSelect'); if (!S || S.hidden) return;        // left the screen while we waited
      if (key === SHOW.last) return;
      SHOW.last = key;
      try {
        Game.pot = 0; Game.state = 'title';
        Game.start(ids.slice(0, 2).map(id => ({ ctrl: 'cpu', char: id, level: 7 })), 'isle', 2, true);
        Game.state = 'menu';
      } catch (e) { /* cosmetic only: never let the preview break the select screen */ }
    }, 320);
  }
  function markCursor() { const ro = q('roster'); [...ro.querySelectorAll('.pick')].forEach((b, i) => b.classList.toggle('cur', i === cursor)); }
  function pickChar(id) {
    UI.slots[UI.active].char = id; hoverId = null;
    UI.active = (UI.active + 1) % UI.slots.length; safeSfx(); UI.renderSelect();
  }
  addEventListener('keydown', e => {
    const S = q('scSelect'); if (!S || S.hidden) return;
    const ro = q('roster'), picks = ro.querySelectorAll('.pick'), n = picks.length; if (!n) return;
    const cols = Math.max(1, Math.round(ro.clientWidth / (picks[0].getBoundingClientRect().width + 5)));
    const mv = { ArrowRight: 1, KeyD: 1, ArrowLeft: -1, KeyA: -1, ArrowDown: cols, KeyS: cols, ArrowUp: -cols, KeyW: -cols }[e.code];
    if (mv) { cursor = (cursor + mv + n) % n; hoverId = coreChars()[cursor].id; markCursor(); previewActive(); safeSfx(); e.preventDefault(); }
    else if (e.code === 'Enter' || e.code === 'KeyF' || e.code === 'KeyK') { pickChar(coreChars()[cursor].id); e.preventDefault(); }
  });

  // ---------- stage select: real backdrops + stages from other modules ----------
  if (UI.paintStage) {
    const orig = UI.paintStage.bind(UI), BG = {};
    // WARM THE BACKDROPS while the player is still on the character select. Each thumbnail draws the
    // stage's full 1920px backdrop, and cold (a fresh portal load, nothing cached) eighteen of those
    // do not decode before the picker paints -- the player gets a screen of flat procedural placeholder
    // cards that fill in a few seconds later. That flash is the first thing a portal reviewer sees of
    // the stage list. Kicking the loads off one screen earlier costs nothing and removes it.
    UI.warmStages = function () {
      const ids = (typeof CORE_SET !== 'undefined' && CORE_SET.stages) ? CORE_SET.stages.slice() : [];
      // the vault's stages are drawn in the picker too -- as a shadow when they are locked
      // (8f_vault.js) and as a normal card once they are owned -- so they want the same warm-up, or
      // the one card on the screen that is a procedural placeholder is the one being sold.
      try { for (const v of Econ.vault()) if (v.kind === 'stage') ids.push(v.unlocks); } catch (e) { /* no store */ }
      for (const id of ids) if (!BG[id]) BG[id] = Object.assign(new Image(), { src: ASSET + 'bg_' + id + '.jpg' });
    };
    UI.paintStage = function (cv, id) {
      const im = BG[id] || (BG[id] = Object.assign(new Image(), { src: ASSET + 'bg_' + id + '.jpg' }));
      const draw = () => { const c = cv.getContext('2d'), W = cv.width, H = cv.height, s = Math.max(W / im.naturalWidth, H / im.naturalHeight); c.drawImage(im, (W - im.naturalWidth * s) / 2, (H - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s); };
      if (im.complete && im.naturalWidth) draw(); else { orig(cv, id); im.addEventListener('load', draw, { once: true }); }
    };
  }
  // The Random card's thumbnail: four of the stages it can land on, as quadrants, so the card shows
  // what is in the pool instead of a question mark on a flat tile.
  // ---------- the Random card: IT FLICKERS THROUGH THE MAPS ----------
  // Duane, 2026-10-16: *"same as the random map that u select. you are supposed to copy other games.
  // usually it flickers btween the maps when u hover over random DO THAT"* / *"it should quickly
  // flicker between maps the random one"*.
  //
  // He is describing Smash's random panel, and it is the right call: a card that rolls through the
  // actual stages SHOWS you the pool instead of printing a question mark over a mosaic of it. The
  // old card was four quadrants with a big "?" sitting on top, which is the cheap version of
  // exactly this idea.
  //
  // It draws one real backdrop per tick through `UI.paintStage`, so it is the same picture the
  // stage's own card shows, already warmed and cached (UI.warmStages). One interval for the whole
  // picker, cleared on every re-render, so a card that is thrown away can never keep painting.
  const RAND_MS = 110;        // fast enough to read as a flicker, slow enough to see each place
  let randTimer = null, randAt = 0;
  function randomStop(cv, pool) {
    if (randTimer) { clearInterval(randTimer); randTimer = null; }
    if (cv) paintRandom(cv, pool);
  }
  UI.randomStop = () => { if (randTimer) { clearInterval(randTimer); randTimer = null; } };
  function randomFlicker(cv, pool) {
    if (!cv || pool.length < 2) return;
    UI.randomStop();
    const order = pool.slice().sort(() => Math.random() - 0.5);
    const tick = () => {
      if (!cv.isConnected) return UI.randomStop();     // the picker re-rendered under us
      randAt = (randAt + 1) % order.length;
      try { UI.paintStage(cv, order[randAt]); } catch (e) { /* mid-load */ }
      label(cv);
    };
    tick();
    randTimer = setInterval(tick, RAND_MS);
  }
  // the one thing the flicker must not lose: that this card is RANDOM and not the stage on it
  function label(cv) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const g = c.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(10,12,17,0)'); g.addColorStop(1, 'rgba(10,12,17,.86)');
    c.fillStyle = g; c.fillRect(0, H * 0.45, W, H * 0.55);
  }
  function paintRandom(cv, pool) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.fillStyle = '#0d1016'; c.fillRect(0, 0, W, H);
    const pick = pool.slice().sort(() => Math.random() - 0.5).slice(0, 4);
    pick.forEach((id, i) => {
      const x = (i % 2) * W / 2, y = (i < 2 ? 0 : 1) * H / 2;
      const im = Object.assign(new Image(), { src: ASSET + 'bg_' + id + '.jpg' });
      const draw = () => {
        const s = Math.max((W / 2) / im.naturalWidth, (H / 2) / im.naturalHeight);
        c.save(); c.beginPath(); c.rect(x, y, W / 2, H / 2); c.clip();
        c.drawImage(im, x + (W / 2 - im.naturalWidth * s) / 2, y + (H / 2 - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
        c.restore(); scrim();
      };
      if (im.complete && im.naturalWidth) draw(); else im.addEventListener('load', draw, { once: true });
    });
    // THE QUESTION MARK IS GONE. It was a 86px system-font "?" with a blur under it, over a mosaic,
    // and it is the single cheapest thing that was on this screen.
    function scrim() { label(cv); }
    scrim();
  }
  // item frequency (25_feel: Game.itemRate) — the old on/off toggle becomes off / normal / mayhem
  UI.itemRate = (() => { try { return localStorage.getItem('tb_itemRate') || 'normal'; } catch (e) { return 'normal'; } })();
  // Roll the stage at the moment the fight starts, never when the card is clicked, so a rematch
  // from the results screen lands somewhere new too. The pick avoids the stage just played when
  // there is anything else to pick, because two identical "random" stages in a row reads as broken.
  UI.rollStage = function () {
    const pool = (UI.stagePool && UI.stagePool.length ? UI.stagePool : ['isle', 'moon', 'chart', 'roof', 'dojo'])
      .filter(id => typeof coreStage !== 'function' || coreStage(id));
    const avoid = UI.lastRolled;
    const take = pool.length > 1 ? pool.filter(id => id !== avoid) : pool;
    const id = take[Math.floor(Math.random() * take.length)] || 'isle';
    UI.lastRolled = id;
    return id;
  };
  // Safety net: 'random' is a choice in the picker, never a stage. If any other path hands it to
  // the fight code (a rematch, a deep link, the portal build) roll it here instead of asking
  // makeStage for a stage that does not exist. UI file, so the seeded arena never sees this.
  try {
    const startR = Game.start.bind(Game);
    Game.start = function (slots, stageId, stocks, demo, itemsOn, seed) {
      if (stageId === 'random') stageId = UI.rollStage();
      return startR(slots, stageId, stocks, demo, itemsOn, seed);
    };
  } catch (e) { /* no Game yet: the picker guard above still covers the normal path */ }
  const origFight = UI.fight && UI.fight.bind(UI);
  if (origFight) UI.fight = function () {
    this.itemsOn = UI.itemRate !== 'off';
    const wasRandom = this.stageId === 'random';
    if (wasRandom) this.stageId = UI.rollStage();
    origFight();
    if (wasRandom) this.stageId = 'random';   // the picker keeps showing Random as the choice
    try { Game.itemRate = UI.itemRate; } catch (e) {}
  };
  // the select screen is the one screen that always precedes the picker, in every mode
  const origSelect = UI.renderSelect && UI.renderSelect.bind(UI);
  if (origSelect) UI.renderSelect = function () { origSelect(); try { UI.warmStages && UI.warmStages(); } catch (e) {} };

  const origWager = UI.renderWager && UI.renderWager.bind(UI);
  if (origWager) UI.renderWager = function () {
    origWager();
    const sb = q('stages');
    const extra = typeof STAGES_MENU_EXTRA !== 'undefined' ? STAGES_MENU_EXTRA : [];
    for (const [id, name, sub] of extra) {
      if (!coreStage(id)) continue;   // 79_core
      const b = document.createElement('button'); b.className = 'stagec' + (this.stageId === id ? ' on' : '');
      b.dataset.stage = id;
      b.innerHTML = `<canvas width="480" height="240"></canvas><div>${name}<small>${sub || ''}</small></div>`;
      b.addEventListener('click', () => { this.stageId = id; safeSfx(); this.renderWager(); });
      sb.appendChild(b); this.paintStage(b.querySelector('canvas'), id);
    }
    // ---------- RANDOM ----------
    // Duane, 15 Oct: *"add a random option where it switches between maps in the map choosing
    // step"*. It sits at the FRONT of the picker, the way Smash puts it first, and it rolls again
    // every match -- including a rematch from the results screen -- rather than locking one stage
    // in at the moment you click it. The pool is read off the cards that are actually on screen
    // (`data-stage`), so a stage added or gated later is in or out of the roll by itself.
    const pool = [...sb.querySelectorAll('.stagec[data-stage]')].map(el => el.dataset.stage);
    UI.stagePool = pool;
    UI.randomStop();   // the old card is about to be thrown away; never leave it painting
    if (pool.length > 1) {
      const rb = document.createElement('button');
      rb.className = 'stagec' + (this.stageId === 'random' ? ' on' : '');
      rb.dataset.stage = '';   // not itself a stage, so it never lands in the pool
      rb.innerHTML = `<canvas width="480" height="240"></canvas><div>Random<small>A different stage every match</small></div>`;
      rb.addEventListener('click', () => { this.stageId = 'random'; safeSfx(); this.renderWager(); });
      sb.insertBefore(rb, sb.firstChild);
      const rcv = rb.querySelector('canvas');
      paintRandom(rcv, pool);
      // hover flickers it through the real stages, and it keeps flickering while it is the one
      // selected, which is what Smash's random panel does
      rb.addEventListener('pointerenter', () => randomFlicker(rcv, pool));
      rb.addEventListener('pointerleave', () => { if (this.stageId !== 'random') randomStop(rcv, pool); else randomFlicker(rcv, pool); });
      if (this.stageId === 'random') randomFlicker(rcv, pool);
    }
    const ip = q('itemPick');
    if (ip) {
      ip.innerHTML = [['off', 'No items'], ['normal', 'Items on'], ['mayhem', 'Mayhem']].map(([k, l]) => `<button class="stake${k === UI.itemRate ? ' on' : ''}" data-r="${k}">${l}</button>`).join('');
      ip.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        UI.itemRate = b.dataset.r; this.itemsOn = UI.itemRate !== 'off';
        try { localStorage.setItem('tb_itemRate', UI.itemRate); } catch (e) {}
        safeSfx(); this.renderWager();
      }));
    }
    q('wagers').querySelectorAll('.wcard').forEach((el, i) => { const s = this.slots[i]; if (s && CHAR_BY_ID[s.char]) el.querySelector('.pn').textContent = (s.ctrl === 'cpu' ? 'CPU' : 'P' + (i + 1)) + ' · ' + CHAR_BY_ID[s.char].name; });
  };

  // ---------- difficulty labels + a brutal CPU ----------
  try {
    CTRL_LABEL.cpu3 = 'CPU easy'; CTRL_LABEL.cpu5 = 'CPU normal'; CTRL_LABEL.cpu8 = 'CPU hard'; CTRL_LABEL.cpu9 = 'CPU brutal';
    if (!CTRL_CYCLE.includes('cpu9')) CTRL_CYCLE.splice(CTRL_CYCLE.indexOf('cpu8') + 1, 0, 'cpu9');
  } catch (e) {}

  // ---------- results: the winner's art, match highlights, instant rematch ----------
  const origRes = UI.showResults && UI.showResults.bind(UI);
  if (origRes) UI.showResults = function (w) {
    origRes(w);
    const R = q('scResults'), box = R.querySelector('.winner');
    let wa = box.querySelector('.winart');
    if (!wa) { wa = document.createElement('div'); wa.className = 'winart'; wa.innerHTML = '<img alt="">'; box.prepend(wa); const t = document.createElement('div'); t.className = 'wintag'; t.textContent = 'WINNER'; wa.after(t); }
    box.style.setProperty('--wc', w.color);
    const img = wa.querySelector('img'); img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
    // The canvas portrait is the FALLBACK for a fighter with no transparent cutout, and `has-art`
    // hides it once one loads. Until that load finishes both were on screen -- the hero image and
    // the canvas, the same winner drawn twice, one above the other. On a fast local connection it
    // is a flicker; on phone data it sat there for a second and looked like a layout bug. Caught it
    // in a 390x844 results shot (dev/aaa/shots/mobile/results.jpg).
    // So hide the canvas while the decision is still pending, and only bring it back if the cutout
    // genuinely does not exist.
    R.classList.add('art-pending');
    const settle = cut => { R.classList.remove('art-pending'); R.classList.toggle('has-art', !!cut); };
    const mine = window.CustomLook && CustomLook.thumb && CustomLook.thumbFor(w);
    if (mine) { img.src = mine; settle(true); }
    else art(w.c.id, a => { img.src = a.url; settle(a.cut); });
    highlights(R, w);
    const btn = q('bRematch'); if (btn) setTimeout(() => btn.focus({ preventScroll: true }), 60);
  };

  // match highlights from the feel layer (25_feel.js), plus a local win streak
  function highlights(R, w) {
    let box = R.querySelector('.hilite');
    if (!box) { box = document.createElement('div'); box.className = 'hilite'; const t = R.querySelector('.tablewrap'); (t || R.querySelector('.wrap')).before(box); }
    let sum = null; try { sum = typeof FEEL !== 'undefined' && FEEL.summary ? FEEL.summary() : null; } catch (e) {}
    let streak = 0;
    try {
      const human = !w.cpu;
      streak = (+localStorage.getItem('tb_streak') || 0);
      streak = human ? streak + 1 : 0;
      localStorage.setItem('tb_streak', String(streak));
    } catch (e) {}
    const chips = [];
    if (streak > 1) chips.push(['Win streak', streak + ' in a row']);
    if (sum && sum.best && sum.best.n > 1) {
      const by = sum.fighters.find(f => f.idx === (sum.best.by && sum.best.by.idx !== undefined ? sum.best.by.idx : sum.best.by));
      chips.push(['Best combo', sum.best.n + ' hits · ' + sum.best.dmg + '%' + (by ? ' · ' + by.name : '')]);
    }
    if (sum) {
      const tot = k => sum.fighters.reduce((a, f) => a + (f[k] || 0), 0);
      if (tot('parries')) chips.push(['Parries', tot('parries')]);
      if (tot('techs')) chips.push(['Techs', tot('techs')]);
      if (tot('bursts')) chips.push(['Bursts', tot('bursts')]);
      if (tot('pumps')) chips.push(['Pump mode', tot('pumps')]);
    }
    box.innerHTML = chips.length ? chips.map(([k, v]) => `<span class="hchip"><b>${v}</b><i>${k}</i></span>`).join('') : '';
  }
  // R, Enter or pad A restarts instantly from the results screen
  addEventListener('keydown', e => {
    const R = q('scResults'); if (!R || R.hidden) return;
    if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'KeyF') { const b = q('bRematch'); if (b) { b.click(); e.preventDefault(); } }
  });
})();
