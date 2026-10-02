// ===== install as an app =====
// The game is a normal web page, but with the manifest, the icons and a service worker it installs
// to the dock or the home screen and opens fullscreen with no browser chrome, which is what people
// mean by "the app". Chrome/Edge/Android get a real install prompt; iOS has no prompt API, so it
// gets the Share > Add to Home Screen hint instead.
// Visual/UI only: never touches fight state or the seeded RNG.
(function () {
  if (typeof document === 'undefined') return;

  const standalone = () => {
    try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; } catch (e) { return false; }
  };
  const iOS = () => { try { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; } catch (e) { return false; } };

  // ---- service worker: offline play + installability ----
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    addEventListener('load', () => {
      // The build stamp in the URL makes every deploy a NEW worker, which deletes all older caches
      // when it activates. Without it, a returning player stayed on stale assets indefinitely.
      const v = encodeURIComponent(window.TB_BUILD || 'dev');
      // 9/22: the worker must sit beside the page. A worker at assets/sw.js may only control
      // assets/, so registering it with scope './' was rejected by Chrome on every load ("scope
      // '/play/' is not under the max scope allowed") — it never ran at all. The deploy copies
      // assets/sw.js to /play/sw.js.
      navigator.serviceWorker.register('sw.js?v=' + v, { scope: './' }).catch(() => {});
    });
    // When a newer worker takes over, reload once so the player is on the new build immediately
    // instead of finding out mid-match. Guarded so it can never loop.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      try { if (typeof Game !== 'undefined' && Game.state === 'match' && !Game.demo) return; } catch (e) {}
      reloaded = true;
      location.reload();
    });
  }

  const css = `
  #instBtn{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:8;display:none;
    align-items:center;gap:8px;height:38px;padding:0 16px;border:0;cursor:pointer;color:#050507;background:linear-gradient(180deg,#fff,#c9ced8);
    font-family:"Barlow Condensed",Impact,sans-serif;font-style:italic;font-weight:900;font-size:15px;letter-spacing:.04em;text-transform:uppercase;
    clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));
    box-shadow:0 10px 26px rgba(0,0,0,.5);animation:instIn .4s .6s both}
  #instBtn.on{display:flex}
  #instBtn:hover{background:linear-gradient(180deg,#fff,#ff8a9c)}
  @keyframes instIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  #instTip{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 46px);z-index:8;display:none;
    max-width:min(300px,76vw);padding:12px 14px;background:rgba(8,9,14,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);color:#c6cad6;font-family:"Space Grotesk",system-ui,sans-serif;font-size:12px;line-height:1.5;
    clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
  #instTip.on{display:block}
  #instTip b{color:#fff}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const btn = document.createElement('button'); btn.id = 'instBtn'; btn.type = 'button';
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16"/></svg>Install the app';
  const tip = document.createElement('div'); tip.id = 'instTip';
  tip.innerHTML = 'Open the <b>Share</b> menu and pick <b>Add to Home Screen</b>. Brawl Street then opens fullscreen, like an app.';
  document.body.appendChild(tip); document.body.appendChild(btn);

  let prompt = null, dismissed = false;
  try { dismissed = localStorage.getItem('rf_install_off') === '1'; } catch (e) {}

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; refresh(); });
  addEventListener('appinstalled', () => { prompt = null; btn.classList.remove('on'); tip.classList.remove('on'); });

  btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (prompt) {
      const p = prompt; prompt = null; btn.classList.remove('on');
      try { p.prompt(); await p.userChoice; } catch (err) {}
      return;
    }
    tip.classList.toggle('on');                       // iOS: no prompt API, so show how to do it by hand
  });
  addEventListener('pointerdown', e => { if (!tip.contains(e.target) && e.target !== btn) tip.classList.remove('on'); }, true);

  // only on the title screen: it must never sit over a fight
  const onTitle = () => {
    try {
      if (Game && Game.state === 'match' && !Game.demo) return false;
      const sc = document.getElementById('scTitle');
      return !!(sc && !sc.hidden);
    } catch (e) { return false; }
  };
  function refresh() {
    const show = !dismissed && !standalone() && onTitle() && (prompt || iOS());
    btn.classList.toggle('on', show);
    if (!show) tip.classList.remove('on');
  }
  setInterval(refresh, 600);
  refresh();

  window.TB_INSTALL = { refresh, get available() { return !!prompt || iOS(); } };
})();
