// ===== online play: lobby, rooms, lockstep matches, practice + real stakes (server: net/) =====
// "Play online" on the title calls Net.open(). #online opens the lobby, #room:CODE joins a room.
// The fight runs through NetLockstep (63_netsim.js): only inputs travel, and every page plus the
// server step the same seeded fight. The server replays it and pays the pot, so nobody can fake a win.
// UI only: this file never calls rand()/irand() and never writes fight state outside NetLockstep.
// The artifact host wraps the page with [hidden]{display:none!important}; served on its own (brawlstreet.lol/play,
// the lw copy) the page needs the same rule, or .screen/.btn display values beat the hidden attribute.
(() => {
  const st = document.createElement('style'); st.textContent = '[hidden]{display:none!important}'; document.head.appendChild(st);
  // same for the phone viewport the artifact wrapper adds: without it phones lay the page out 980 px wide
  if (!document.querySelector('meta[name=viewport]')) { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1,viewport-fit=cover'; document.head.appendChild(m); }
})();
const Net = (() => {
  const LW = 'brawlstreet.167-233-230-149.sslip.io';
  const DEFAULT_WS = 'wss://' + LW + '/ws';
  const PLAY_URL = 'https://brawlstreet.lol/play/';
  const BACKUP_URL = 'https://' + LW + '/';
  const PROTO = 1;
  const PSTAKES = [0, 0.01, 0.05, 0.1, 0.25];
  const SEL = { deposit: 'b214faa5', claim: 'bd66528a', refund: '7249fbb6' };
  const byId = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = v => { const a = Math.abs(v); return a > 0 && a < 0.01 ? v.toFixed(4) : v.toFixed(3); };
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const hex = n => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
  const charName = id => (CHAR_BY_ID[id] ? CHAR_BY_ID[id].name : String(id || '').toUpperCase());

  // ---- regions: one game server per region; the page measures the round trip to each and plays on the
  // closest one. Two players far from the server both pay for it (lockstep waits for the slower path), so
  // this is the single biggest thing for players in Asia while the only box is in Europe.
  const REGION_TTL = 10 * 60000;
  function regionList() {
    const fromServer = N.me && N.me.regions && N.me.regions.length ? N.me.regions : null;
    const saved = store.get('netRegions', null);
    const list = fromServer || saved || [];
    if (fromServer) store.set('netRegions', fromServer);
    return list;
  }
  function pings() { const p = store.get('netPings', null); return p && Date.now() - p.at < REGION_TTL ? p.ms : null; }
  async function probeRegions(force) {
    const list = regionList();
    if (!list.length || (!force && pings())) return pings();
    const ms = {};
    for (const r of list) {
      if (!r.http) continue;
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        try { await fetch(r.http + '/ping?t=' + t0, { cache: 'no-store', mode: 'cors' }); best = Math.min(best, performance.now() - t0); }
        catch (e) { /* region unreachable */ }
      }
      if (best < Infinity) ms[r.id] = Math.round(best);
    }
    if (Object.keys(ms).length) store.set('netPings', { at: Date.now(), ms });
    return ms;
  }
  // the region this page should use: the player's choice, or the fastest one measured
  function pickRegion() {
    const list = regionList(), want = store.get('netRegion', 'auto');
    if (want !== 'auto') { const r = list.find(x => x.id === want); if (r) return r; }
    const ms = pings(); if (!ms) return null;
    let best = null;
    for (const r of list) if (ms[r.id] != null && (!best || ms[r.id] < ms[best.id])) best = r;
    return best;
  }
  // after measuring, move to a closer region if there is one
  async function maybeSwitchRegion() {
    const before = N.me && N.me.region && N.me.region.id;
    await probeRegions(false);
    const r = pickRegion();
    if (!r || !r.ws || (before && r.id === before)) { renderHome(); return; }
    if (N.M || N.room) return;                       // never move mid-match or mid-room
    // never flap: a region whose address actually lands on another box would otherwise bounce forever
    if (N.ws && N.ws.url === r.ws) { renderHome(); return; }
    N.regionTry = N.regionTry || {};
    if ((N.regionTry[r.id] | 0) >= 2) { renderHome(); return; }
    N.regionTry[r.id] = (N.regionTry[r.id] | 0) + 1;
    N.regionUrl = r.ws; store.set('netRegionUrl', r.ws);
    toast('Switching to ' + r.label + ' (' + (pings() || {})[r.id] + ' ms)');
    try { if (N.ws) N.ws.close(4005, 'region'); } catch (e) { /* already gone */ }
    N.ws = null; N.everOpen = false; N.tries = 0; setTimeout(connect, 200);
  }

  function serverUrl() {
    if (N.regionUrl && /^wss?:\/\//.test(N.regionUrl)) return N.regionUrl;
    try { const q = new URLSearchParams(location.search).get('server'); if (q && /^wss?:\/\/[\w.:\-[\]]+\/ws$/.test(q)) return q; } catch (e) { /* no search */ }
    if (location.hostname === LW) return 'wss://' + LW + '/ws';
    return DEFAULT_WS;
  }
  // where invite links point: this page when it has a real web address, the public site otherwise
  function linkBase() {
    const h = location.hostname || '';
    if (/^https?:$/.test(location.protocol) && h && !/(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(h)) return location.origin + location.pathname + location.search;
    return PLAY_URL;
  }
  let TOKEN = null;
  function token() {
    if (TOKEN) return TOKEN;
    let t = store.get('netToken', '');
    if (!/^[0-9a-f]{64}$/.test(t)) { t = hex(32); store.set('netToken', t); }
    return (TOKEN = t);
  }

  // fighter art: transparent cutout, then the portrait, then the vector mascot
  function artImg(id, cls) {
    const im = new Image(); im.className = cls || ''; im.alt = charName(id); im.decoding = 'async';
    im.onerror = () => {
      if (im.src.endsWith('_cut.webp')) { im.src = 'assets/' + ASSET_ID(id) + '.jpg'; return; }
      const cv = document.createElement('canvas'); cv.width = 240; cv.height = 240; cv.className = im.className;
      try { if (CHAR_BY_ID[id]) drawPortrait(cv, CHAR_BY_ID[id], { vector: true }); } catch (e) { /* no art */ }
      im.replaceWith(cv);
    };
    im.src = 'assets/' + ASSET_ID(id) + '_cut.webp';
    return im;
  }

  // ------------------------------------------------------------------ styles
  const css = `
  .nb .wrap.nb-wrap{width:min(1180px,100%);gap:14px}
  .nb-top{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-end}
  .nb-status{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end}
  .nb-conn i{width:7px;height:7px;border-radius:50%;background:var(--dim)}
  .nb-conn.on{color:var(--text)} .nb-conn.on i{background:var(--lime);box-shadow:0 0 8px var(--lime)}
  .nb-conn.bad{color:var(--red)} .nb-conn.bad i{background:var(--red);box-shadow:0 0 8px var(--red)}
  .nb-bal{color:var(--gold)}
  .nb-row{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}
  .nb-lbl{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .nb-field{display:flex;gap:10px;align-items:center}
  .nb-in{font:600 15px var(--ui);color:var(--text);background:rgba(5,5,7,.6);border:0;box-shadow:inset 0 0 0 1px var(--line2);padding:10px 12px;min-height:42px;width:180px;border-radius:0;outline:none}
  .nb-in:focus{box-shadow:inset 0 0 0 1px var(--red),0 0 0 3px rgba(255,42,74,.18)}
  .nb-code-in{width:120px;font-family:var(--mono);font-weight:700;letter-spacing:.25em;text-transform:uppercase;text-align:center}
  .nb-pills{display:flex;flex-wrap:wrap;gap:5px}
  .nb-pill{font:700 13px var(--mono);letter-spacing:.04em;color:var(--text);background:rgba(5,5,7,.5);border:0;box-shadow:inset 0 0 0 1px var(--line2);padding:0 12px;min-height:36px;cursor:pointer;border-radius:0}
  .nb-pill:hover{background:rgba(255,255,255,.08)}
  .nb-pill.on{background:var(--red);box-shadow:none;color:#fff}
  .nb-pill[disabled]{opacity:.35;pointer-events:none}
  .nb-plates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .nb-plate{--c:var(--red);position:relative;display:grid;grid-template-columns:46px 1fr auto;grid-template-rows:auto auto;align-items:center;column-gap:12px;row-gap:4px;
    min-height:104px;padding:16px 20px 16px 16px;text-align:left;color:var(--text);border:0;cursor:pointer;overflow:hidden;
    background:linear-gradient(100deg,rgba(16,18,28,.9),rgba(10,11,16,.72));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));transition:transform .15s,filter .15s;animation:nbIn .45s both}
  .nb-plate::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(var(--c),var(--c)) left/3px 100% no-repeat,
    linear-gradient(90deg,var(--c),transparent 60%) top/100% 1px no-repeat,repeating-linear-gradient(0deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px)}
  .nb-plate::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-45%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.14),transparent)}
  button.nb-plate:hover{transform:translateY(-2px);filter:drop-shadow(0 0 14px color-mix(in srgb,var(--c) 55%,transparent))}
  button.nb-plate:hover::after{animation:nbScan .7s ease-out}
  @keyframes nbScan{from{left:-45%}to{left:110%}}
  @keyframes nbIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  .nb-plate i{grid-row:1/span 2;font:700 13px var(--mono);color:var(--c);font-style:normal;letter-spacing:.06em}
  .nb-plate b{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(26px,3vw,38px);line-height:.9;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .nb-plate b em{font-style:italic;color:var(--c);-webkit-text-fill-color:var(--c)}
  .nb-plate small{grid-column:2;font-size:13px;color:var(--muted)}
  .nb-plate .nb-side{grid-column:3;grid-row:1/span 2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
  .nb-plate.cy{--c:var(--cyan)} .nb-plate.gd{--c:var(--gold)} .nb-plate.bl{--c:var(--blue)}
  .nb-maps{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px;margin-top:8px}
  .nb-map{position:relative;aspect-ratio:16/9;border:0;padding:0;cursor:pointer;background:#0a0b10 center/cover no-repeat;box-shadow:inset 0 0 0 1px var(--line2);overflow:hidden}
  .nb-map span{position:absolute;left:0;right:0;bottom:0;padding:10px 4px 3px;font-family:var(--display);font-style:italic;font-weight:800;font-size:12px;text-transform:uppercase;
    background:linear-gradient(transparent,rgba(5,5,7,.92) 55%);text-align:center}
  .nb-map.on{box-shadow:inset 0 0 0 2px var(--red),0 0 14px rgba(255,42,74,.45)}
  .nb-map:not(.on){filter:saturate(.45) brightness(.6)}
  .nb-foot{text-align:left}
  .nb-fail{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
  .nb-fail a{color:var(--cyan);font-weight:700;word-break:break-all}
  .nb-fail .big{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(26px,3.4vw,40px);line-height:.95;text-transform:uppercase}
  .nb-real{--c:var(--gold)}
  /* room */
  .nr-players{display:grid;gap:10px;grid-template-columns:repeat(var(--n,2),minmax(0,1fr))}
  .nr-p{--c:var(--red);position:relative;min-height:230px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;
    background:radial-gradient(80% 60% at 50% 100%,color-mix(in srgb,var(--c) 30%,transparent),transparent 70%),linear-gradient(#11131c,#08090e);
    clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px));box-shadow:inset 0 0 0 1px var(--line)}
  .nr-p.me{box-shadow:inset 0 0 0 1px var(--c),inset 0 -40px 60px -30px color-mix(in srgb,var(--c) 40%,transparent)}
  .nr-p .art{position:absolute;inset:6px 0 64px;display:flex;align-items:flex-end;justify-content:center;pointer-events:none}
  .nr-p .art img,.nr-p .art canvas{max-height:100%;max-width:100%;object-fit:contain;filter:drop-shadow(0 12px 18px rgba(0,0,0,.6));animation:heroIn .4s cubic-bezier(.2,1,.3,1) both}
  .nr-p .pl{position:relative;padding:10px 12px 12px;background:linear-gradient(transparent,rgba(5,5,7,.92) 35%);display:flex;flex-direction:column;gap:2px}
  .nr-p .pn{font:700 11px var(--mono);letter-spacing:.1em;color:var(--c);display:flex;gap:8px;align-items:center}
  .nr-p .pn .tag{color:#050507;background:var(--c);padding:1px 5px;font-size:10px}
  .nr-p .who{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nr-p .fn{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(24px,2.6vw,34px);line-height:.9;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .nr-p .st{font:700 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between;gap:8px}
  .nr-p .st .ok{color:var(--lime);text-shadow:0 0 10px rgba(61,255,138,.5)}
  .nr-p.empty .art{inset:0;align-items:center;font:700 12px var(--mono);letter-spacing:.14em;color:var(--dim);text-transform:uppercase}
  .nr-p.empty{background:repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 10px,transparent 10px 20px),#08090e}
  .nr-vs{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);z-index:3;font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(44px,6vw,80px);
    color:#fff;text-shadow:0 0 30px rgba(255,42,74,.8),0 4px 0 #000;pointer-events:none}
  .nr-wrapp{position:relative}
  .nr-body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:10px;align-items:start}
  .nr-grid{grid-template-columns:repeat(auto-fill,minmax(58px,1fr));max-height:236px;overflow:auto;padding:2px}
  .nr-rules{display:flex;flex-direction:column;gap:10px}
  .nr-stages{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:5px;max-height:150px;overflow:auto;padding:2px}
  .nr-stage{position:relative;aspect-ratio:16/9;border:0;padding:0;cursor:pointer;background:#0a0b10 center/cover no-repeat;box-shadow:inset 0 0 0 1px var(--line2);overflow:hidden}
  .nr-stage span{position:absolute;left:0;right:0;bottom:0;padding:8px 4px 3px;font-family:var(--display);font-style:italic;font-weight:800;font-size:12px;text-transform:uppercase;background:linear-gradient(transparent,rgba(5,5,7,.9) 55%);text-align:center}
  .nr-stage.on{box-shadow:inset 0 0 0 2px var(--red),0 0 14px rgba(255,42,74,.5)}
  .nr-stage[disabled]{cursor:default}
  .nr-stage[disabled]:not(.on){filter:saturate(.3) brightness(.55)}
  .nr-bar{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
  .nr-pot b{display:block;font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(28px,3.4vw,42px);line-height:.95;color:var(--gold);text-shadow:0 0 22px rgba(255,200,61,.35)}
  .nr-pot small{font-size:12px;color:var(--muted)}
  .nr-note{font-size:13px;color:var(--muted);text-wrap:balance}
  .nr-acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .btn.primary.nb-ready-on{background:var(--lime);color:#050507}
  .nb-code{color:#fff;font-size:15px;letter-spacing:.3em}
  /* results */
  .ns-hero{display:grid;grid-template-columns:minmax(0,300px) 1fr;gap:18px;align-items:end}
  .ns-art{height:min(340px,42vh);display:flex;align-items:flex-end;justify-content:center}
  .ns-art img,.ns-art canvas{max-height:100%;max-width:100%;object-fit:contain;filter:drop-shadow(0 0 30px rgba(255,42,74,.45)) drop-shadow(0 20px 30px rgba(0,0,0,.6))}
  .ns-name{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(48px,7vw,104px);line-height:.86;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 0 rgba(0,0,0,.5))}
  .ns-sub{font-size:16px;color:var(--muted);margin-top:4px}
  .ns-pay{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(30px,4vw,48px);margin-top:8px}
  .ns-pay.win{color:var(--lime);text-shadow:0 0 24px rgba(61,255,138,.4)} .ns-pay.lose{color:var(--red)} .ns-pay.even{color:var(--muted)}
  .ns-ver{font:700 11px var(--mono);letter-spacing:.06em;color:var(--muted);margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .ns-ver .ok{color:var(--lime)} .ns-ver a{color:var(--cyan)}
  /* in-match overlay */
  #netHud{position:fixed;left:max(12px,env(safe-area-inset-left));top:calc(max(10px,env(safe-area-inset-top)) + 112px);z-index:6;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none;max-width:calc(100% - 180px)}
  #netHud .chip{background:rgba(5,5,7,.72)}
  #netHud .live{color:var(--red)} #netHud .live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--red);box-shadow:0 0 8px var(--red);animation:nbBlink 1s infinite}
  @keyframes nbBlink{50%{opacity:.25}}
  #netWait{position:fixed;left:50%;top:26%;transform:translateX(-50%);z-index:6;pointer-events:none;text-align:center;padding:12px 20px;background:rgba(5,5,7,.8);box-shadow:inset 0 0 0 1px var(--line2);
    font:700 13px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text);clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%)}
  #netWait b{display:block;font-family:var(--display);font-style:italic;font-weight:900;font-size:30px;letter-spacing:0;margin-bottom:2px}
  #netBanner{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;max-width:min(560px,calc(100% - 32px));padding:10px 16px;
    background:rgba(40,6,12,.9);box-shadow:inset 0 0 0 1px var(--red);font-size:13px;text-align:center;pointer-events:none}
  #netLeave{position:fixed;right:max(12px,env(safe-area-inset-right));top:calc(max(10px,env(safe-area-inset-top)) + 112px);z-index:7}
  .nr-p .lk{font:700 10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
  .nr-p .xh,.ns-x{font:500 11px var(--mono);letter-spacing:.04em;color:var(--cyan)}
  .nb-rk{display:inline-block;font:700 10px var(--mono);letter-spacing:.08em;padding:1px 6px;margin-left:6px;color:#050507;background:var(--gold);vertical-align:middle}
  .ns-elo{font:700 13px var(--mono);letter-spacing:.06em;margin-top:6px} .ns-elo .up{color:var(--lime)} .ns-elo .dn{color:var(--red)}
  /* unlocked-this-match badges. Only ever shown to the player who earned them: the server
     sends res.ach keyed by slot, so nobody sees anybody else's. */
  .ns-ach{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
  .ns-ach-h{width:100%;font:700 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;opacity:.75;margin-bottom:2px}
  /* Fixed width, not content width: a long description would otherwise make one badge three
     times the size of its neighbour and the row stops reading as a set. text-align is reset
     because the results panel centres everything above this. */
  .ns-badge{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:9px;width:236px;
    text-align:left;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
    animation:achIn .45s cubic-bezier(.2,.9,.3,1.3) both}
  .ns-badge .dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 10px currentColor}
  .ns-badge .bd{flex:1;min-width:0}
  .ns-badge .nm{font:700 12.5px var(--sans);line-height:1.2}
  .ns-badge .ds{font:500 10.5px var(--sans);opacity:.62;line-height:1.25;margin-top:1px}
  .ns-badge .xp{font:700 11px var(--mono);opacity:.55;flex:none;align-self:flex-start;margin-top:1px}
  .ns-badge.bronze{border-color:rgba(205,127,50,.5)}   .ns-badge.bronze   .dot{color:#cd7f32;background:#cd7f32}
  .ns-badge.silver{border-color:rgba(192,200,214,.5)}  .ns-badge.silver   .dot{color:#c0c8d6;background:#c0c8d6}
  .ns-badge.gold{border-color:rgba(255,196,60,.55)}    .ns-badge.gold     .dot{color:#ffc43c;background:#ffc43c}
  .ns-badge.platinum{border-color:rgba(110,231,255,.6)}.ns-badge.platinum .dot{color:#6ee7ff;background:#6ee7ff}
  @keyframes achIn{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.ns-badge{animation:none}}
  #netToast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);z-index:30;max-width:min(520px,calc(100% - 32px));padding:12px 18px;
    background:rgba(10,11,16,.95);box-shadow:inset 0 0 0 1px var(--line2),0 10px 40px rgba(0,0,0,.6);font-size:14px;text-align:center;animation:nbIn .25s both}
  #netToast.bad{box-shadow:inset 0 0 0 1px var(--red),0 10px 40px rgba(0,0,0,.6)}
  @media (max-width:760px){
    .nb-plates{grid-template-columns:1fr}
    .nb-plate{min-height:84px;grid-template-columns:34px 1fr}
    .nb-plate .nb-side{grid-column:2;grid-row:auto;justify-content:flex-start;margin-top:6px}
    .nr-body{grid-template-columns:1fr}
    .nr-players{grid-template-columns:repeat(2,minmax(0,1fr))}
    .nr-p{min-height:170px}
    .nr-bar{grid-template-columns:1fr;text-align:left}
    .nr-acts{justify-content:stretch} .nr-acts .btn{flex:1}
    .ns-hero{grid-template-columns:1fr} .ns-art{height:200px}
    .nb-in{width:100%}
    .nb-field{flex-wrap:wrap}
  }
  @media (prefers-reduced-motion:reduce){.nb-plate,.nr-p .art img{animation:none}}
  `;

  // ------------------------------------------------------------------ DOM
  let built = false;
  function build() {
    if (built) return; built = true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const home = document.createElement('section'); home.className = 'screen solid nb'; home.id = 'scNet'; home.hidden = true;
    home.innerHTML = `<div class="wrap nb-wrap">
      <div class="nb-top">
        <div><div class="eyebrow">Brawl Street online</div><h2 class="h2">Play online</h2></div>
        <div class="nb-status"><span class="chip nb-conn" id="nbConn"><i></i><span>Offline</span></span><button class="btn small" id="nbRegion">Region</button><span class="chip" id="nbPing">— ms</span>
          <span class="chip nb-bal" id="nbBal">— ETH</span><button class="btn small" id="nbRefill" hidden>Refill 1 ETH</button><button class="btn small" id="nbBack">Back</button></div>
      </div>
      <div class="panel nb-row">
        <label class="nb-field"><span class="nb-lbl">Name</span><input class="nb-in" id="nbName" maxlength="16" autocomplete="nickname" spellcheck="false"></label>
        <div class="nb-field"><span class="nb-lbl">Stake</span><div class="nb-pills" id="nbStakes"></div></div>
        <span class="note" id="nbStakeNote" style="text-align:left">Practice ETH. Winner takes the pot.</span>
        <div class="nb-field"><span class="nb-lbl">Maps</span><div class="nb-pills" id="nbMapMode"></div><button class="btn small" id="nbMapsBtn">Choose maps</button></div>
      </div>
      <div class="panel" id="nbRegionPanel" hidden><div class="nb-row" style="justify-content:space-between"><span class="nb-lbl">Server region</span>
        <button class="btn small" id="nbRegionTest">Measure again</button></div><div class="nb-pills" id="nbRegions"></div>
        <p class="note" style="text-align:left" id="nbRegionNote">Online fights wait for the slower connection, so both players want a server close to them.</p></div>
      <div class="panel" id="nbMapsPanel" hidden><div class="nb-row" style="justify-content:space-between"><span class="nb-lbl" id="nbMapsLbl">Quick match maps</span>
        <span class="nb-pills"><button class="nb-pill" id="nbMapsAll">Select all</button><button class="nb-pill" id="nbMapsNone">Clear</button></span></div>
        <div class="nb-maps" id="nbMaps"></div>
        <p class="note" style="text-align:left">Quick match pairs you with someone whose picks overlap, then plays a random map both of you chose. Fewer maps can mean a longer wait.</p></div>
      <div class="nb-plates">
        <button class="nb-plate" id="nbQuick2"><i>01</i><b>Quick match <em>1v1</em></b><small>Get paired with the next player at this stake</small><span class="nb-side"><span class="chip" id="nbWait2">—</span></span></button>
        <button class="nb-plate cy" id="nbQuick4"><i>02</i><b>Quick match <em>FFA</em></b><small>Four-player free-for-all. CPUs fill empty seats</small><span class="nb-side"><span class="chip" id="nbWait4">—</span></span></button>
        <div class="nb-plate gd"><i>03</i><b>Create room</b><small>Private room with a code and an invite link</small>
          <span class="nb-side"><span class="nb-pills" id="nbMode"><button class="nb-pill on" data-v="2">1v1</button><button class="nb-pill" data-v="4">4-player FFA</button></span><button class="btn primary small" id="nbCreate">Create</button></span></div>
        <div class="nb-plate bl"><i>04</i><b>Join by code</b><small>Type the five-letter code a friend sent you</small>
          <span class="nb-side"><input class="nb-in nb-code-in" id="nbCode" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false"><button class="btn primary small" id="nbJoin">Join</button></span></div>
      </div>
      <div class="nb-plate nb-real" id="nbReal" hidden><i>$</i><b>Real ETH room</b><small id="nbRealNote">Stakes held by an escrow contract on Robinhood Chain. Connect a wallet in the room.</small>
        <span class="nb-side"><span class="nb-pills" id="nbRealStakes"></span><button class="btn primary small" id="nbCreateReal">Create</button></span></div>
      <div class="panel nb-fail" id="nbFail" hidden></div>
      <div id="nbSocial"></div>
      <p class="note nb-foot" id="nbFoot">Every online match is replayed on the server from the inputs to decide the winner, so results can't be faked.</p>
    </div>`;
    const room = document.createElement('section'); room.className = 'screen solid nb'; room.id = 'scNetRoom'; room.hidden = true;
    room.innerHTML = `<div class="wrap nb-wrap">
      <div class="nb-top">
        <div><div class="eyebrow" id="nrKick">Room</div><h2 class="h2" id="nrTitle">Pick your fighter</h2></div>
        <div class="nb-status"><span class="chip nb-code" id="nrCode">—</span><button class="btn small" id="nrCopy">Copy invite link</button><span class="chip" id="nrPing">— ms</span><button class="btn small" id="nrLeave">Leave</button></div>
      </div>
      <div class="nr-wrapp"><div class="nr-players" id="nrPlayers"></div></div>
      <div class="nr-body">
        <div class="panel"><div class="nb-lbl" style="margin-bottom:8px">Your fighter</div><div class="roster nr-grid" id="nrRoster"></div></div>
        <div class="panel nr-rules">
          <div class="nb-lbl" id="nrRulesLbl">Rules</div>
          <div class="nr-stages" id="nrStages"></div>
          <div class="nb-row" style="gap:8px 16px"><div class="nb-field"><span class="nb-lbl">Lives</span><div class="nb-pills" id="nrStocks"></div></div>
            <div class="nb-field"><span class="nb-lbl">Items</span><div class="nb-pills" id="nrItems"></div></div></div>
          <div class="nb-row" style="gap:8px 16px"><div class="nb-field"><span class="nb-lbl">Stake</span><div class="nb-pills" id="nrStake"></div></div></div>
          <div class="nb-row" style="gap:8px 16px" id="nrModeRow"><div class="nb-field"><span class="nb-lbl">Mode</span><div class="nb-pills" id="nrMode"></div></div>
            <div class="nb-field" id="nrCpuF"><span class="nb-lbl">CPU fill</span><div class="nb-pills" id="nrCpu"></div></div>
            <div class="nb-field" id="nrRankF"><span class="nb-lbl">Ranked</span><div class="nb-pills" id="nrRanked"></div></div></div>
        </div>
      </div>
      <div class="panel nr-bar">
        <div class="nr-pot"><span class="nb-lbl">Winner takes</span><b id="nrPot">0.000 ETH</b><small id="nrBal"></small></div>
        <div class="nr-note" id="nrNote"></div>
        <div class="nr-acts"><button class="btn small" id="nrMine" hidden>Use my fighter</button><button class="btn small" id="nrWallet" hidden>Connect wallet</button><button class="btn" id="nrStart" hidden>Start now</button><button class="btn primary" id="nrReady">Ready</button></div>
      </div>
    </div>`;
    const res = document.createElement('section'); res.className = 'screen solid nb'; res.id = 'scNetRes'; res.hidden = true;
    res.innerHTML = `<div class="wrap nb-wrap">
      <div class="ns-hero"><div class="ns-art" id="nsArt"></div>
        <div><div class="eyebrow" id="nsKick">Match over</div><div class="ns-name" id="nsName"></div><div class="ns-sub" id="nsSub"></div>
          <div class="ns-pay" id="nsPay"></div><div class="ns-ver" id="nsVer"></div></div></div>
      <div class="panel tablewrap"><table class="res" id="nsTable"></table></div>
      <div class="row" style="justify-content:flex-start"><button class="btn primary" id="nsAgain">Rematch</button><button class="btn" id="nsRoom">Back to room</button>
        <button class="btn" id="nsClaim" hidden>Claim</button><button class="btn" id="nsLeave">Leave room</button></div>
    </div>`;
    document.body.append(home, room, res);
    const hud = document.createElement('div'); hud.id = 'netHud'; hud.hidden = true;
    const wait = document.createElement('div'); wait.id = 'netWait'; wait.hidden = true;
    const banner = document.createElement('div'); banner.id = 'netBanner'; banner.hidden = true;
    const leave = document.createElement('button'); leave.id = 'netLeave'; leave.className = 'btn small'; leave.textContent = 'Leave match'; leave.hidden = true;
    document.body.append(hud, wait, banner, leave);
    wire();
  }

  function toast(msg, bad) {
    let t = byId('netToast');
    if (!t) { t = document.createElement('div'); t.id = 'netToast'; document.body.appendChild(t); }
    t.className = bad ? 'bad' : ''; t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200);
  }

  // ------------------------------------------------------------------ state
  const N = {
    ws: null, conn: 'idle', me: null, room: null, lock: null, M: null, stats: null, rtt: 0, jit: 0, offset: null,
    stake: store.get('netStake', 0.05), mode: 2, pool: store.get('netPool', []), mapsOpen: false, regionUrl: store.get('netRegionUrl', null), regionOpen: false, pendingJoin: null, digest: null, retry: 0, everOpen: false, failT: 0, pingT: 0,
    view: null, lastRoom: null, realStake: null, wallet: null,
  };

  function send(o) {
    if (!N.ws || N.ws.readyState !== 1) return false;   // NetLockstep re-sends anything the socket did not take
    try { N.ws.send(JSON.stringify(o)); } catch (e) { return false; }
    return true;
  }
  // other files (78_net_social.js) listen to every server message and to view changes
  const hooks = [];
  const emit = m => { for (const h of hooks) { try { h(m); } catch (e) { console.warn('net hook', e); } } };
  function setView(v) { N.view = v; emit({ k: '_view', view: v }); }
  // the saved custom fighter (86_custom.js) follows the account into online rooms
  let lookSent = null;
  function syncLook() {
    let lk = null; try { lk = typeof CustomLook !== 'undefined' ? CustomLook.get() : null; } catch (e) { lk = null; }
    // the account keeps the X handle even if this build's creator doesn't know that field yet
    const srv = N.me && N.me.profile && N.me.profile.look;
    if (lk && !lk.x && srv && srv.x && srv.base === lk.base) lk = Object.assign({}, lk, { x: srv.x });
    const j = JSON.stringify(lk || null);
    if (j !== lookSent && N.conn === 'open') { lookSent = j; send({ k: 'look', look: lk || null }); }
  }
  // cleared storage, new device, or a restored account: take the fighter back from the account
  function adoptLook(lk) {
    if (!lk || typeof CustomLook === 'undefined' || !CustomLook.set) return;
    let mine = null; try { mine = CustomLook.get(); } catch (e) { mine = null; }
    if (mine) return;                       // this device already has one; it wins and gets pushed up
    try { CustomLook.set(lk); lookSent = JSON.stringify(CustomLook.get() || null); toast('Your saved fighter is back: ' + (lk.name || 'custom')); } catch (e) { /* creator not loaded */ }
  }

  function setConn(s) {
    N.conn = s;
    const el = byId('nbConn'); if (!el) return;
    el.className = 'chip nb-conn' + (s === 'open' ? ' on' : s === 'failed' || s === 'closed' ? ' bad' : '');
    el.querySelector('span').textContent = { idle: 'Offline', connecting: 'Connecting', open: 'Online', closed: 'Reconnecting', failed: 'No connection' }[s] || s;
  }

  function connect() {
    if (N.ws && (N.ws.readyState === 0 || N.ws.readyState === 1)) return;
    if (!N.digest) { try { N.digest = NetSim.digest(); } catch (e) { N.digest = 'unknown'; } restoreDemo(); }
    setConn('connecting');
    let ws;
    try { ws = new WebSocket(serverUrl()); } catch (e) { return failed('blocked'); }
    N.ws = ws; N.tries = (N.tries || 0) + 1;
    const t0 = performance.now();
    clearTimeout(N.failT);
    N.failT = setTimeout(() => {
      if (ws.readyState === 1 || N.ws !== ws) return;
      try { ws.close(); } catch (e) { /* closing */ }
      N.ws = null;
      if (N.everOpen) return;
      if (N.regionUrl) { N.regionUrl = null; store.set('netRegionUrl', null); store.set('netRegion', 'auto'); N.tries = 0; return connect(); }
      if (N.tries < 3) connect(); else failed('timeout');   // slow network or a busy device: try again before giving up
    }, 12000);
    ws.onopen = () => {
      clearTimeout(N.failT); N.everOpen = true; N.retry = 0; N.tries = 0; setConn('open'); byId('nbFail').hidden = true;
      send({ k: 'hello', v: PROTO, token: token(), name: store.get('netName', ''), build: N.digest, test: /[?&]nettest=1\b/.test(location.search) || undefined });
      clearInterval(N.pingT); N.pingT = setInterval(ping, 1000); ping();
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => {
      clearInterval(N.pingT);
      if (N.ws !== ws) return;
      N.ws = null; clearTimeout(N.failT);
      // refused outright (a sandbox that blocks sockets, no network): say so; a slow refusal gets retried
      if (!N.everOpen) {
        if (N.regionUrl) { N.regionUrl = null; store.set('netRegionUrl', null); store.set('netRegion', 'auto'); N.tries = 0; return void setTimeout(connect, 300); }
        if (N.tries < 3 && performance.now() - t0 > 1500) return void setTimeout(connect, 800);
        return failed('closed');
      }
      setConn('closed');
      // keep trying while the lobby is open or a match is running
      if (N.view || N.M) { const d = Math.min(8000, 700 * Math.pow(1.6, N.retry++)); setTimeout(() => { if (!N.ws && (N.view || N.M)) connect(); }, d); }
    };
    ws.onerror = () => {};
  }
  function ping() { send({ k: 'ping', t: performance.now(), e: Date.now(), rtt: Math.round(N.rtt), jit: Math.round(N.jit) }); }

  // the socket can't open from here (a sandboxed preview or a blocked network): say where to play
  function failed(why) {
    setConn('failed');
    const el = byId('nbFail'); if (!el) return;
    const here = location.href.split('#')[0].replace(/\/$/, '');
    const onSite = here === PLAY_URL.replace(/\/$/, '');
    el.innerHTML = `<div class="big">Can't reach the online server from here</div>
      <p class="note" style="text-align:left">${onSite ? 'Check your connection and try again.' : 'This copy of the game can\'t open a live connection (previews block it). Play online here:'}</p>
      ${onSite ? '' : `<div class="nb-row"><a href="${PLAY_URL}" target="_blank" rel="noopener">${PLAY_URL.replace('https://', '')}</a><button class="btn small" id="nbCopyUrl">Copy link</button></div>
      <p class="note" style="text-align:left">Backup server: <a href="${BACKUP_URL}" target="_blank" rel="noopener">${BACKUP_URL.replace('https://', '').replace(/\/$/, '')}</a></p>`}
      <button class="btn small" id="nbRetry">Try again</button>`;
    el.hidden = false;
    const cu = byId('nbCopyUrl'); if (cu) cu.onclick = () => copy(PLAY_URL);
    byId('nbRetry').onclick = () => { el.hidden = true; N.everOpen = false; N.tries = 0; connect(); };
    renderHome();
  }

  function copy(text) {
    const done = () => toast('Link copied');
    try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); } catch (e) { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:0;top:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); if (ok) done(); else prompt('Copy this link', text);
  }

  // ------------------------------------------------------------------ messages
  function onMsg(m) {
    try { handle(m); } finally { emit(m); }
  }
  function handle(m) {
    switch (m.k) {
      case 'welcome':
        N.me = m; N.stats = m.stats;
        if (m.now) N.offset = m.now - Date.now();
        if (!m.build.ok) {
          // out of date: fetch the current build once per server version instead of dead-ending on a banner
          const key = 'netReload_' + m.build.server, last = store.get(key, 0);
          if (N.M && !N.M.shown) { toast('Your game is out of date. It will update when this match ends.', true); }
          else if (!last || Date.now() - last > 20 * 60000) {
            store.set(key, Date.now());
            toast('Updating Brawl Street to the current build…');
            const u = new URL(location.href); u.searchParams.set('v', String(Date.now()).slice(-7));
            setTimeout(() => location.replace(u.toString()), 900);
            return;
          }
          const el = byId('nbFail');
          el.innerHTML = `<div class="big">Your game is out of date</div>
            <p class="note" style="text-align:left">This page runs a different build from the server (page <code>${esc(String(N.digest).slice(0, 12))}</code>, server <code>${esc(String(m.build.server).slice(0, 12))}</code>),
            so online play is switched off here until it matches. Reload to get the current build, or play at
            <a href="${PLAY_URL}" target="_blank" rel="noopener">${PLAY_URL.replace('https://', '')}</a>.</p>
            <button class="btn primary small" id="nbReload">Reload the game</button>`;
          el.hidden = false;
          byId('nbReload').onclick = () => location.reload();
          toast('Your game is out of date — reload to play online', true);
        }
        if (!byId('nbName').value || m.profile) byId('nbName').value = m.name;
        store.set('netName', m.name);
        if (m.profile && m.profile.look) adoptLook(m.profile.look);
        lookSent = null; syncLook();
        renderHome();
        maybeSwitchRegion().catch(() => {});
        // back after a drop mid-match: the server sends "resume" right away if the match is still on
        if (N.M && !N.M.shown) { const M = N.M; setTimeout(() => { if (N.M === M && !M.result && N.lock && N.lock.stalledFor > 2500) { toast('The match ended while you were disconnected.', true); endMatchView(); N.M = null; N.lock = null; restoreDemo(); showHome(); } }, 4000); }
        if (N.pendingJoin && m.build.ok) { const c = N.pendingJoin; N.pendingJoin = null; send({ k: 'join', code: c }); }
        else if (N.lastRoom && !N.M && m.build.ok && N.view === 'room') send({ k: 'join', code: N.lastRoom });
        return;
      case 'pong': {
        const v = performance.now() - m.t; if (v < 0 || v > 10000) return;
        N.jit = N.rtt ? N.jit * 0.8 + Math.abs(v - N.rtt) * 0.2 : 0; N.rtt = N.rtt ? N.rtt * 0.75 + v * 0.25 : v;
        if (m.s) { const off = m.s - (Date.now() - v / 2); N.offset = N.offset == null ? off : N.offset * 0.8 + off * 0.2; }
        const p = Math.round(N.rtt) + ' ms'; for (const id of ['nbPing', 'nrPing']) { const el = byId(id); if (el) el.textContent = p; }
        return;
      }
      case 'stats': N.stats = m; renderHome(); return;
      case 'me':
        N.me.bal = m.bal; N.me.name = m.name; if (m.profile) N.me.profile = m.profile;
        if (m.recovered) { byId('nbName').value = m.name; store.set('netName', m.name); toast('Account restored on this device'); if (m.profile && m.profile.look) { try { CustomLook.set(m.profile.look); lookSent = JSON.stringify(CustomLook.get() || null); } catch (e) { /* creator not loaded */ } } }
        renderHome(); if (N.room) renderRoom(); return;
      case 'toast': toast(m.msg); return;
      case 'err':
        if (m.code === 'build') { toast(m.msg, true); return; }
        toast(m.msg, true);
        if (m.code === 'noroom' && N.view === 'room' && !N.room) showHome();
        return;
      case 'widenq':
        N.widen = true; if (N.view === 'room') renderRoom();
        toast('Still looking. You can search any map instead.');
        return;
      case 'room': {
        const first = !N.room || N.room.code !== m.code;
        // quick match: tell them who and where as soon as the room fills
        if (m.quick && m.picked && N.room && (!N.room.picked || N.room.members.length < m.members.length) && m.members.length >= 2) {
          const other = m.members.find(x => x.id !== m.you);
          toast(`Match found${other ? ' · ' + other.name : ''} · ${stageName(m.picked)}`);
          sfx('coin');
        }
        N.room = m; N.lastRoom = m.code;
        if (first) N.widen = false;
        if (m.state !== 'match' && N.view !== 'res' && !N.M) { if (first || N.view !== 'room') showRoom(); else renderRoom(); }
        else if (N.view === 'room') renderRoom();
        return;
      }
      case 'kicked': toast(m.msg, true); N.room = null; N.lastRoom = null; if (!N.M) showHome(); return;
      case 'left': N.room = null; N.lastRoom = null; if (!N.M) showHome(); return;
      case 'start': case 'resume': beginMatch(m); return;
      case 'i':
        if (!N.lock) return;
        N.lock.onInput(m.p, m.t, m.m);
        if (Net.active && N.lock.stalledFor > 0) frame(performance.now());   // the input we were waiting for: step now, not next frame
        return;
      case 'net': if (N.lock) { N.lock.setBase(m.delay[N.lock.me]); N.lock.delays = m.delay; N.lock.pings = m.ping; } return;
      case 'need': if (N.lock) N.lock.onNeed(m.t); return;   // the server is missing inputs: send them again
      case 'drop': onDrop(m); return;
      case 'lag': onLag(m); return;
      case 'desync': onDesync(m); return;
      case 'result': onResult(m); return;
      case 'fund': onFund(m); return;
      case 'fundfail': toast(m.msg, true); N.refund = { id: m.id, escrow: m.escrow }; renderRoom(); return;
    }
  }

  // ------------------------------------------------------------------ screens
  function showHome() { build(); N.room = null; UI.show('scNet'); setView('home'); renderHome(); syncLook(); }
  function showRoom() { build(); UI.show('scNetRoom'); setView('room'); renderRoom(); syncLook(); }
  function leaveOnline() {
    setView(null); N.pendingJoin = null;
    if (N.room) send({ k: 'leave' });
    N.room = null; N.lastRoom = null;
    try { if (location.hash.startsWith('#room') || location.hash.startsWith('#online')) history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandboxed */ }
    UI.title();
  }

  function renderHome() {
    if (!built) return;
    const me = N.me, ok = N.conn === 'open' && me && me.build.ok;
    byId('nbBal').textContent = me ? fmt(me.bal) + ' ETH · practice' : '— ETH';
    byId('nbRefill').hidden = !(me && me.bal < 0.01);
    const s = N.stats;
    byId('nbFoot').textContent = (s ? `${s.online} online · ${s.matches} match${s.matches === 1 ? '' : 'es'} live. ` : '') +
      'Every online match is replayed on the server from the inputs to decide the winner, so results can\'t be faked.';
    byId('nbWait2').textContent = s ? (s.waiting ? s.waiting + ' waiting' : 'Find match') : '—';
    byId('nbWait4').textContent = s ? 'Up to 4' : '—';
    byId('nbStakes').innerHTML = PSTAKES.map(v => `<button class="nb-pill${v === N.stake ? ' on' : ''}" data-v="${v}" ${me && v > me.bal + 1e-9 ? 'disabled' : ''}>${v ? v + ' Ξ' : 'Free'}</button>`).join('');
    byId('nbStakes').querySelectorAll('button').forEach(b => b.onclick = () => { N.stake = +b.dataset.v; store.set('netStake', N.stake); sfx('coin'); renderHome(); });
    byId('nbStakeNote').textContent = N.stake ? `Practice ETH. Stake ${N.stake} each, winner takes the pot.` : 'Free play, no stake.';
    renderMaps();
    renderRegions();
    for (const id of ['nbQuick2', 'nbQuick4', 'nbCreate', 'nbJoin']) byId(id).disabled = !ok;
    const real = me && me.real;
    byId('nbReal').hidden = !real;
    if (real) {
      if (N.realStake == null) N.realStake = real.stakes[0];
      byId('nbRealStakes').innerHTML = real.stakes.map(v => `<button class="nb-pill${v === N.realStake ? ' on' : ''}" data-v="${v}">${v} ETH</button>`).join('');
      byId('nbRealStakes').querySelectorAll('button').forEach(b => b.onclick = () => { N.realStake = +b.dataset.v; renderHome(); });
      byId('nbRealNote').textContent = `Real ETH on ${real.chainName || 'Robinhood Chain'}. Stakes sit in an escrow contract until the server's replay names the winner.`;
    }
  }

  function renderRegions() {
    const list = regionList(), ms = pings() || {}, cur = N.me && N.me.region;
    const el = byId('nbRegion');
    if (el) { el.textContent = cur ? cur.label : 'Region'; el.title = cur && ms[cur.id] != null ? cur.label + ': ' + ms[cur.id] + ' ms measured' : 'Pick a server region'; el.onclick = () => { N.regionOpen = !N.regionOpen; sfx(); renderHome(); }; }
    const panel = byId('nbRegionPanel'); if (!panel) return;
    panel.hidden = !N.regionOpen;
    const want = store.get('netRegion', 'auto');
    byId('nbRegions').innerHTML = [`<button class="nb-pill${want === 'auto' ? ' on' : ''}" data-v="auto">Auto (closest)</button>`]
      .concat(list.map(r => {
        // the region we are on already has a live number (the socket round trip); the others need the probe
        const msr = ms[r.id] != null ? ms[r.id] : (cur && r.id === cur.id && N.rtt ? Math.round(N.rtt) : null);
        return `<button class="nb-pill${want === r.id ? ' on' : ''}" data-v="${esc(r.id)}">${esc(r.label)}${msr != null ? ' · ' + msr + ' ms' : ' · —'}</button>`;
      })).join('');
    byId('nbRegions').querySelectorAll('button').forEach(b => b.onclick = () => { store.set('netRegion', b.dataset.v); sfx(); maybeSwitchRegion().catch(() => {}); renderHome(); });
    byId('nbRegionTest').onclick = () => { probeRegions(true).then(() => { renderHome(); toast('Measured again'); }); };
    const best = pickRegion();
    byId('nbRegionNote').textContent = list.length < 2
      ? 'One server region so far (' + (cur ? cur.label : '—') + '). Online fights wait for the slower connection, so a server near both players matters more than anything else.'
      : 'Playing on ' + (best ? best.label : '—') + '. Both players should be on the region that is closest to the pair.';
  }

  function stageList() { return (N.me && N.me.stages) || []; }
  function stageName(id) { const s = stageList().find(x => x.id === id); return s ? s.name : String(id || '').toUpperCase(); }
  function renderMaps() {
    const list = stageList(), any = !N.pool.length;
    byId('nbMapMode').innerHTML = `<button class="nb-pill${any ? ' on' : ''}" data-v="any">Any map</button>` +
      `<button class="nb-pill${any ? '' : ' on'}" data-v="some">${any ? 'Pick maps' : N.pool.length + ' of ' + list.length}</button>`;
    byId('nbMapMode').querySelectorAll('button').forEach(b => b.onclick = () => {
      if (b.dataset.v === 'any') { N.pool = []; store.set('netPool', N.pool); N.mapsOpen = false; }
      else { N.mapsOpen = true; }
      sfx(); renderHome();
    });
    byId('nbMapsBtn').textContent = N.mapsOpen ? 'Hide maps' : 'Choose maps';
    byId('nbMapsBtn').onclick = () => { N.mapsOpen = !N.mapsOpen; sfx(); renderHome(); };
    byId('nbMapsPanel').hidden = !N.mapsOpen;
    byId('nbMapsLbl').textContent = any ? 'Quick match maps · any map' : `Quick match maps · ${N.pool.length} picked`;
    if (!N.mapsOpen) return;
    const box = byId('nbMaps');
    box.innerHTML = list.map(s => `<button class="nb-map${!N.pool.length || N.pool.includes(s.id) ? ' on' : ''}" data-v="${s.id}"
      style="background-image:url(assets/bg_${s.id}.jpg)"><span>${esc(s.name)}</span></button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => {
      const id = b.dataset.v;
      let p = N.pool.length ? N.pool.slice() : list.map(x => x.id);   // "any" means everything is on
      p = p.includes(id) ? p.filter(x => x !== id) : p.concat([id]);
      if (!p.length) p = [id];                                        // never leave zero maps
      N.pool = p.length === list.length ? [] : p;
      store.set('netPool', N.pool); sfx(); renderHome();
    });
    byId('nbMapsAll').onclick = () => { N.pool = []; store.set('netPool', N.pool); sfx(); renderHome(); };
    byId('nbMapsNone').onclick = () => { N.pool = list.length ? [list[0].id] : []; store.set('netPool', N.pool); sfx(); renderHome(); };
  }

  const slotColor = i => PCOLORS[i] || '#fff';
  function renderRoom() {
    if (!built || !N.room) return;
    const r = N.room, me = r.members.find(x => x.id === r.you), host = r.host === r.you, lobby = r.state === 'lobby';
    const unit = r.real ? ' ETH' : ' ETH';
    byId('nrKick').textContent = `Room ${r.code} · ${r.size === 2 ? '1v1' : '4-player free-for-all'} · ${r.quick ? 'quick match' : 'private'}${r.ranked ? ' · ranked' : ''}${r.real ? ' · real ETH' : ''}`
      + (r.quick && r.picked ? ' · ' + stageName(r.picked).toUpperCase() : '');
    byId('nrTitle').textContent = r.state === 'funding' ? 'Deposit your stake' : r.members.length < 2 ? 'Waiting for players' : me && me.ready ? 'Waiting for the others' : 'Pick your fighter';
    byId('nrCode').textContent = r.code;
    // player plates, Tekken style
    const n = r.size, box = byId('nrPlayers');
    box.style.setProperty('--n', n);
    box.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const p = r.members[i], el = document.createElement('div');
      el.style.setProperty('--c', slotColor(i));
      if (!p) {
        el.className = 'nr-p empty';
        el.innerHTML = `<div class="art">${r.size === 4 && r.cpuFill ? 'CPU fills this seat' : 'Waiting for player'}</div><div class="pl"><div class="pn">P${i + 1}</div><div class="who" style="color:var(--dim)">Open seat</div></div>`;
      } else {
        el.className = 'nr-p' + (p.id === r.you ? ' me' : '');
        el.innerHTML = `<div class="art"></div><div class="pl"><div class="pn">P${i + 1}${p.id === r.host ? '<span class="tag">HOST</span>' : ''}${p.id === r.you ? '<span class="tag">YOU</span>' : ''}</div>
          <div class="fn">${esc(p.look && p.look.base === p.char ? p.look.name : charName(p.char))}</div>${p.look && p.look.base === p.char ? `<div class="lk">${esc(p.look.title || 'Custom fighter')}</div>` : ''}
          <div class="who">${esc(p.name)}${p.elo ? ' · ' + p.elo : ''}</div>${p.x ? `<div class="xh">@${esc(p.x)}</div>` : ''}
          <div class="st"><span class="${p.ready ? 'ok' : ''}">${p.ready ? 'Ready' : 'Picking'}</span><span>${r.real ? (p.wallet ? 'wallet ✓' : 'no wallet') : (p.ping ? p.ping + ' ms' : '')}</span></div></div>`;
        el.querySelector('.art').appendChild(artImg(p.char));
      }
      box.appendChild(el);
    }
    const old = box.parentNode.querySelector('.nr-vs'); if (old) old.remove();
    if (n === 2) { const vs = document.createElement('div'); vs.className = 'nr-vs'; vs.textContent = 'VS'; box.parentNode.appendChild(vs); }
    // roster
    const ro = byId('nrRoster');
    if (ro.childElementCount !== CHARS.length) {
      ro.innerHTML = '';
      for (const c of CHARS) {
        const b = document.createElement('button'); b.className = 'pick'; b.dataset.id = c.id; b.title = c.name;
        b.innerHTML = `<span class="face"></span><span class="nm">${esc(c.name)}</span>`;
        const face = b.querySelector('.face'), probe = new Image();
        probe.onload = () => { face.style.backgroundImage = `url(${probe.src})`; };
        probe.onerror = () => { if (probe.src.endsWith('_cut.webp')) probe.src = 'assets/' + ASSET_ID(c.id) + '.jpg'; };
        probe.src = 'assets/' + ASSET_ID(c.id) + '_cut.webp';
        b.onclick = () => { if (N.room && N.room.state === 'lobby') { send({ k: 'pick', char: c.id }); sfx(); } };
        ro.appendChild(b);
      }
    }
    ro.querySelectorAll('.pick').forEach(b => { b.classList.toggle('cur', !!me && b.dataset.id === me.char); b.disabled = !lobby || (me && me.ready); });
    // rules (host edits, everyone sees)
    byId('nrRulesLbl').textContent = r.quick
      ? 'Rules · quick match · 3 lives, items on · ' + (r.picked ? 'map: ' + stageName(r.picked) : r.pool && r.pool.length ? 'maps: ' + r.pool.map(stageName).join(', ') : 'any map')
      : host ? 'Rules · you are the host' : 'Rules · set by the host';
    const stages = (N.me && N.me.stages) || [];
    const sb = byId('nrStages'), canEdit = host && lobby && !r.quick;
    const cur = r.quick ? (r.picked || '') : r.stage;
    sb.innerHTML = [{ id: 'random', name: 'Random' }].concat(stages).map(s => `<button class="nr-stage${cur === s.id ? ' on' : ''}" data-v="${s.id}"${canEdit ? '' : ' disabled'}
      style="background-image:${s.id === 'random' ? 'linear-gradient(135deg,#1a0c14,#0c1224)' : `url(assets/bg_${s.id}.jpg)`}"><span>${esc(s.name)}</span></button>`).join('');
    sb.querySelectorAll('button').forEach(b => b.onclick = () => { send({ k: 'set', stage: b.dataset.v }); sfx(); });
    const edit = host && lobby && !r.quick;
    const pills = (id, opts, cur, key, map) => {
      byId(id).innerHTML = opts.map(([v, l]) => `<button class="nb-pill${v === cur ? ' on' : ''}" data-v="${v}" ${edit ? '' : 'disabled'}>${l}</button>`).join('');
      byId(id).querySelectorAll('button').forEach(b => b.onclick = () => { send({ k: 'set', [key]: map(b.dataset.v) }); sfx(); });
    };
    pills('nrStocks', [1, 2, 3, 4, 5].map(v => [v, String(v)]), r.stocks, 'stocks', Number);
    pills('nrItems', [[true, 'On'], [false, 'Off']], r.items, 'items', v => v === 'true');
    const stakeOpts = r.real ? ((N.me.real && N.me.real.stakes) || []) : PSTAKES;
    pills('nrStake', stakeOpts.map(v => [v, v ? v + (r.real ? ' ETH' : ' Ξ') : 'Free']), r.stake, 'stake', Number);
    pills('nrMode', [[2, '1v1'], [4, '4-player FFA']], r.size, 'size', Number);
    pills('nrCpu', [[true, 'On'], [false, 'Off']], r.cpuFill, 'cpuFill', v => v === 'true');
    pills('nrRanked', [[true, 'On'], [false, 'Off']], !!r.ranked, 'ranked', v => v === 'true');
    byId('nrRankF').hidden = r.size !== 2;
    const mine = N.me && N.me.profile && N.me.profile.look;
    byId('nrMine').hidden = !(mine && lobby && me && !me.ready && CHAR_BY_ID[mine.base] && me.char !== mine.base);
    byId('nrMine').textContent = mine ? 'Use ' + mine.name : 'Use my fighter';
    byId('nrModeRow').hidden = r.quick;
    byId('nrCpuF').hidden = r.size !== 4;
    // pot + actions
    const humans = r.members.length;
    byId('nrPot').textContent = fmt(r.stake * Math.max(2, humans)) + unit;
    byId('nrBal').textContent = r.real ? (N.wallet ? 'Wallet ' + N.wallet.slice(0, 6) + '…' + N.wallet.slice(-4) : 'Connect a wallet to play for real ETH')
      : (N.me ? `Stake ${r.stake ? r.stake + ' ETH each' : 'free'} · your balance ${fmt(N.me.bal)} ETH (practice)` : '');
    const rd = byId('nrReady');
    rd.textContent = me && me.ready ? 'Ready ✓' : 'Ready';
    rd.classList.toggle('nb-ready-on', !!(me && me.ready));
    rd.disabled = !lobby;
    rd.onclick = () => { send({ k: 'ready', on: !(me && me.ready) }); sfx(me && me.ready ? 'ui' : 'coin'); };
    const canStart = host && lobby && r.size === 4 && humans >= 2 && r.members.every(x => x.ready) && humans < 4;
    byId('nrStart').hidden = !canStart;
    byId('nrWallet').hidden = !r.real || !lobby;
    byId('nrWallet').textContent = me && me.wallet ? 'Wallet ✓' : 'Connect wallet';
    const pingLine = r.members.filter(m => m.ping).map(m => esc(m.name) + ' ' + m.ping + ' ms').join(' · ');
    byId('nrPing').textContent = pingLine || '— ms';
    byId('nrPing').title = 'Round trip to the ' + (r.region ? r.region.label : 'game') + ' server';
    // how the match will actually feel, before anyone readies up
    const delayNote = r.delay >= 9
      ? `<b style="color:var(--gold)">Heavy connection: ${r.delay} frames of input delay (${Math.round(r.delay * 16.7)} ms).</b> Lockstep waits for the slower path, so a server closer to both of you is the fix. `
      : r.delay ? `Input delay ${r.delay} frames (${Math.round(r.delay * 16.7)} ms) on ${esc(r.region ? r.region.label : 'this server')}. ` : '';
    let note = '';
    if (r.state === 'funding') note = 'Waiting for every deposit to land. The match starts once the escrow is funded.';
    else if (r.state === 'match') note = 'Match in progress.';
    else if (r.countdown) note = `Starting in ${Math.ceil(r.countdown / 1000)} s. More players can still join.`;
    else if (humans < 2) note = r.quick
      ? `Looking for an opponent at this stake${r.pool && r.pool.length ? ' on ' + (r.pool.length === 1 ? stageName(r.pool[0]) : r.pool.length + ' chosen maps') : ''}…`
        + (N.widen ? ' <button class="btn small" id="nrWiden">Search any map</button>' : '')
      : 'Send the invite link or the code to a friend.';
    if (humans >= 2) note = delayNote + note;
    else if (!r.members.every(x => x.ready)) note = 'The match starts when everyone is ready.' + (r.readyBy ? ` Ready up within ${Math.ceil(r.readyBy / 1000)} s.` : '');
    else if (r.size === 4 && humans < 4) note = host ? 'Everyone is ready. Start now or wait for more players.' : 'Everyone is ready. The host can start now.';
    if (N.refund) note += ' Your deposit can be refunded: ' + '<button class="btn small" id="nrRefund">Refund</button>';
    byId('nrNote').innerHTML = note;
    const wd = byId('nrWiden'); if (wd) wd.onclick = () => { send({ k: 'widen' }); N.widen = false; N.pool = []; store.set('netPool', []); sfx(); };
    const rf = byId('nrRefund'); if (rf) rf.onclick = () => walletTx(N.refund.escrow, SEL.refund, N.refund.id, 0n).then(() => { N.refund = null; toast('Refund sent'); renderRoom(); }).catch(e => toast(e.message, true));
  }

  // ------------------------------------------------------------------ match
  function perfStart(m) {
    if (m.k === 'resume') return performance.now();
    const off = N.offset != null ? N.offset : (m.now - Date.now());
    return performance.now() + Math.max(0, Math.min(8000, m.startAt - (Date.now() + off)));
  }

  function beginMatch(m) {
    build();
    const quiet = m.k === 'resume', mute = Sfx.on;
    if (quiet) Sfx.on = false;
    if (N.lock) N.lock.dropped = true;
    NetSim.onEnd = null;
    N.lock = new NetLockstep(m, o => send(o));
    Sfx.on = mute;
    N.M = { id: m.id, names: m.names, handles: m.handles || [], you: m.you, cfg: m.cfg, ranked: !!m.ranked, stake: m.stake, pot: m.pot, real: m.real, startLocal: perfStart(m), result: null, localEnd: null, shown: false, desync: null, lag: null, dropped: new Set() };
    // equipped cosmetics for every player in the match (89_econ.js). Visual only; the fight never
    // reads them, which is why they are allowed in wagered and ranked matches too.
    try { if (window.Econ) Econ.matchCosmetics(m.cosm || []); } catch (e) { /* cosmetics must never block a match */ }
    NetSim.onEnd = w => { if (N.M) { N.M.localEnd = { winner: w.idx, tick: Game.tick }; afterEnd(); } };
    const hs = m.handles || [];
    Game.arenaTags = m.cfg.players.map((p, i) => (i === m.you ? 'YOU' : p.cpu ? 'CPU' : hs[i] ? '@' + String(hs[i]).slice(0, 15) : String(m.names[i] || 'P' + (i + 1)).toUpperCase().slice(0, 10)));
    N.M2handles = hs;
    Game.potLabel = m.pot > 0 ? 'POT ' + fmt(m.pot) + ' Ξ' : 'ONLINE';
    store.set('netLive', { id: m.id, t: Date.now() });
    setView('match');
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* nothing focused */ }
    UI.show(null);
    byId('pauseBtn').hidden = true;
    Touch.visible = IS_TOUCH; byId('touch').hidden = !IS_TOUCH;
    byId('netHud').hidden = false; byId('netLeave').hidden = false; byId('netBanner').hidden = true; byId('netWait').hidden = true;
    Net.active = true;
    // the lockstep ticks on its own timer too, so a slow render frame never holds back the others
    clearInterval(N.tickT); N.tickT = setInterval(() => { if (Net.active && !document.hidden) frame(performance.now()); }, 8);
    Sfx.unlock();
    hud(performance.now(), true);
  }

  // My input is every local scheme at once: both players online use the same controls, so whichever one a
  // player reaches for (WASD, arrows, touch, pad) drives their own fighter. Read from KEYMAPS so a scheme
  // added later is picked up on its own, and the mask covers every ACTION including grab/grapple/drop.
  function sample() {
    let m = 0;
    try { for (const src of Object.keys(KEYMAPS)) m |= NetSim.encode(readInput(src)); } catch (e) { m |= NetSim.encode(readInput('kb1')); }
    m |= NetSim.encode(readInput('touch'));
    m |= NetSim.encode(readInput('pad0')) | NetSim.encode(readInput('pad1'));
    return m;
  }

  function frame(now) {
    const L = N.lock, M = N.M; if (!L || !M) return;
    if (now < M.startLocal) { hud(now); return; }
    if (!M.shown) {
      try { L.run(now, sample); }
      catch (e) {
        // a bug in the fight code would otherwise throw every frame: stop here and let the server settle it
        console.error('online sim error', e);
        L.dropped = true;
        banner('This match hit an error in the game code. The server decides the result.');
        send({ k: 'leave' });
      }
    }
    hud(now);
  }

  let hudT = 0;
  function hud(now, force) {
    const L = N.lock, M = N.M; if (!L || !M || (!force && now - hudT < 200)) return;
    hudT = now;
    const players = M.cfg.players.length, humans = M.cfg.players.filter(p => !p.cpu).length;
    byId('netHud').innerHTML = `<span class="chip live">Online · ${players === 2 ? '1v1' : players + '-player FFA'}${M.ranked ? ' · ranked' : ''}</span><span class="chip">${Math.round(N.rtt)} ms · delay ${L.delay}f</span>` +
      (humans < players ? `<span class="chip">${players - humans} CPU</span>` : '');
    const w = byId('netWait');
    if (now < M.startLocal) { w.hidden = false; w.innerHTML = `<b>${Math.ceil((M.startLocal - now) / 1000)}</b>Match starting`; return; }
    const miss = L.stalledFor > 250 ? L.missing().filter(i => i !== L.me) : [];
    if (N.conn !== 'open') { w.hidden = false; w.innerHTML = '<b>Reconnecting…</b>Hold on, your connection dropped'; }
    else if (miss.length) {
      const lag = M.lag || {};
      w.hidden = false;
      w.innerHTML = `<b>Waiting…</b>${miss.map(i => esc(M.names[i] || 'P' + (i + 1)) + (lag[i] && lag[i].gone ? ' left' : '') + (lag[i] && lag[i].secs ? ' · ' + lag[i].secs + 's' : '')).join(', ')}`;
    } else w.hidden = true;
  }

  function onLag(m) {
    const M = N.M; if (!M) return;
    M.lag = M.lag || {};
    for (const s of m.slots) { if (s.back) delete M.lag[s.slot]; else M.lag[s.slot] = s; }
  }
  function onDrop(m) {
    const M = N.M, L = N.lock; if (!M || !L) return;
    if (m.slot === L.me) {
      L.dropped = true;
      banner(m.why === 'left' ? 'You left the match.' : 'You were dropped from the match (no inputs for too long). A CPU took over your fighter and your stake is forfeit.');
      return;
    }
    L.onDrop(m.slot, m.t, m.level);
    M.dropped.add(m.slot);
    Game.arenaTags[m.slot] = 'CPU';
    toast(`${M.names[m.slot] || 'A player'} ${m.why === 'left' ? 'left' : 'disconnected'}. A CPU takes over their fighter.`);
  }
  function onDesync(m) {
    const M = N.M; if (!M) return;
    M.desync = m;
    banner(m.slot === M.you ? 'Your game fell out of sync with the server. The server\'s replay decides the result.' : `${esc(M.names[m.slot] || 'A player')} fell out of sync. The server's replay decides the result.`);
  }
  function banner(text) { const b = byId('netBanner'); b.textContent = text; b.hidden = false; }

  function onResult(m) {
    const M = N.M;
    if (N.me && m.bal != null) N.me.bal = m.bal;
    if (!M || M.id !== m.id) { toast(`Match over. Balance ${fmt(m.bal)} ETH`); return; }
    M.result = m;
    store.set('netLive', null);
    // a fight that ended on screen shows the result as soon as this page's copy reaches the end too
    if (m.reason === 'forfeit' || m.reason === 'cancelled' || N.lock.dropped) return setTimeout(showResult, 500);
    afterEnd();
    setTimeout(() => { if (N.M === M && !M.shown) showResult(); }, 4000);
  }
  function afterEnd() {
    const M = N.M; if (!M || M.shown) return;
    if (M.result && M.localEnd) setTimeout(() => { if (N.M === M && !M.shown) showResult(); }, 250);
    else if (M.localEnd && !M.result) setTimeout(() => { if (N.M === M && !M.result) { const w = byId('netWait'); w.hidden = false; w.innerHTML = '<b>Checking…</b>The server is verifying the result'; } }, 1200);
  }

  function endMatchView() {
    Net.active = false; clearInterval(N.tickT);
    for (const id of ['netHud', 'netLeave', 'netWait', 'netBanner']) byId(id).hidden = true;
    Touch.visible = false; byId('touch').hidden = true;
  }
  function restoreDemo() {
    NetSim.onEnd = null; Game.arena = null; Game.arenaTags = null; Game.potLabel = null;
    try { UI.startDemo(); } catch (e) { /* UI not booted yet */ }
  }

  function showResult() {
    const M = N.M, r = M && M.result; if (!r) return;
    M.shown = true;
    endMatchView();
    UI.show('scNetRes');
    setView('res');
    const you = M.you, win = r.winner, payee = r.payee;
    const wc = win >= 0 ? M.cfg.players[win] : null;
    const art = byId('nsArt'); art.innerHTML = '';
    if (wc) art.appendChild(artImg(wc.char));
    const reason = { ko: 'Knockout', time: 'Won on time', forfeit: 'Won by forfeit', cancelled: 'Match cancelled' }[r.reason] || r.reason;
    byId('nsKick').textContent = 'Match over · ' + reason;
    if (r.reason === 'cancelled') { byId('nsName').textContent = 'No contest'; byId('nsSub').textContent = 'Everyone left. Stakes were returned.'; }
    else {
      const wname = win === you ? 'You' : wc && wc.cpu && !M.dropped.has(win) ? 'CPU' : (M.names[win] || 'P' + (win + 1));
      byId('nsName').textContent = (wc ? charName(wc.char) : '') + ' wins';
      byId('nsSub').textContent = wname === 'You' ? 'That was you.' : wname + (payee !== win && payee >= 0 ? ` · the pot goes to ${payee === you ? 'you' : M.names[payee]}, the best-placed player still in` : '');
    }
    const d = r.deltas[you] || 0, pay = byId('nsPay');
    pay.className = 'ns-pay ' + (d > 1e-12 ? 'win' : d < -1e-12 ? 'lose' : 'even');
    pay.textContent = !M.stake && !r.real ? 'Free play' : (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d)) + ' ETH' + (r.real ? '' : ' (practice)');
    const ver = [];
    ver.push(r.desync && r.desync.length ? '<span>Replay decided it (a player desynced)</span>' : '<span class="ok">✓ Server-verified replay</span>');
    ver.push(`<span>${r.ticks} ticks · replay ${esc(String(r.replay).slice(2, 12))}</span>`);
    const base = serverUrl().replace(/^ws/, 'http').replace(/\/ws$/, '');
    ver.push(`<a href="${base}/api/replay/${esc(r.id)}" target="_blank" rel="noopener">Download replay</a>`);
    if (!r.real) ver.push(`<span>Balance ${fmt(r.bal)} ETH</span>`);
    byId('nsVer').innerHTML = ver.join('<span>·</span>');
    const e = r.elo && r.elo[you], old = byId('nsElo'); if (old) old.remove();
    if (e) { const d = document.createElement('div'); d.id = 'nsElo'; d.className = 'ns-elo'; d.innerHTML = `Rating <b>${e.elo}</b> <span class="${e.d >= 0 ? 'up' : 'dn'}">${e.d >= 0 ? '+' : ''}${e.d}</span> · week ${e.season}`; byId('nsVer').after(d); }
    // Achievements unlocked by THIS match. r.ach is keyed by slot, so a player only ever sees
    // their own. Rebuilt every result the same way nsElo is, so a match that unlocks nothing
    // leaves no stale badges from the last one behind.
    const oldAch = byId('nsAch'); if (oldAch) oldAch.remove();
    const mine = r.ach && r.ach[you];
    if (mine && mine.length) {
      const box = document.createElement('div');
      box.id = 'nsAch'; box.className = 'ns-ach';
      box.innerHTML = `<div class="ns-ach-h">${mine.length === 1 ? 'Achievement unlocked' : mine.length + ' achievements unlocked'}</div>`
        + mine.map((a, i) => `<div class="ns-badge ${esc(a.tier)}" style="animation-delay:${i * 70}ms">`
            + `<span class="dot"></span><div class="bd"><div class="nm">${esc(a.name)}</div><div class="ds">${esc(a.desc)}</div></div>`
            + `<span class="xp">+${a.xp | 0}</span></div>`).join('');
      (byId('nsElo') || byId('nsVer')).after(box);
    }
    const order = r.placements || [];
    const rows = order.map((i, k) => {
      const p = M.cfg.players[i], s = r.stats[i] || {}, nm = i === you ? 'You' : p.cpu && !M.dropped.has(i) ? 'CPU' : (M.names[i] || 'P' + (i + 1));
      const xh = (M.handles || [])[i];
      return `<tr><td style="color:${slotColor(i)}">${k + 1}. ${esc(nm)}${xh ? ` <span class="ns-x">@${esc(xh)}</span>` : ''}${r.dropped && r.dropped.includes(i) ? ' (left)' : ''}</td><td>${esc(charName(p.char))}</td><td>${s.kos ?? 0}</td><td>${s.falls ?? 0}</td><td>${s.dealt ?? 0}%</td><td>${(r.deltas[i] > 0 ? '+' : '') + (r.deltas[i] ? fmt(r.deltas[i]) : '0')}</td></tr>`;
    }).join('');
    byId('nsTable').innerHTML = `<thead><tr><th>Player</th><th>Fighter</th><th>KOs</th><th>Falls</th><th>Dealt</th><th>ETH</th></tr></thead><tbody>${rows}</tbody>`;
    const claim = byId('nsClaim');
    claim.hidden = !(r.real && r.real.claim && N.wallet && r.real.claim.toLowerCase() === N.wallet.toLowerCase()) && !(r.real && r.real.refund);
    if (r.real) {
      claim.textContent = r.real.refund ? 'Refund stake' : 'Claim ' + fmt(M.pot) + ' ETH';
      claim.onclick = () => walletTx(r.real.escrow, r.real.refund ? SEL.refund : SEL.claim, r.real.id, 0n).then(() => { toast('Sent to your wallet'); claim.hidden = true; }).catch(e => toast(e.message, true));
    }
    byId('nsAgain').hidden = !N.room;
    byId('nsRoom').hidden = !N.room;
    sfx(d > 0 ? 'coin' : 'ui');
  }

  function closeResult(toRoom) {
    N.M = null; N.lock = null;
    restoreDemo();
    if (toRoom && N.room) showRoom(); else if (N.room) { send({ k: 'leave' }); N.room = null; showHome(); } else showHome();
  }

  // two taps to leave (confirm() is blocked in sandboxed pages)
  let leaveArm = 0;
  function leaveMatch() {
    if (!N.M) return;
    const b = byId('netLeave');
    if (!N.M.result && performance.now() - leaveArm > 3000) {
      leaveArm = performance.now();
      b.textContent = N.M.stake ? 'Tap again: forfeit stake' : 'Tap again to leave';
      setTimeout(() => { b.textContent = 'Leave match'; }, 3000);
      return;
    }
    leaveArm = 0; b.textContent = 'Leave match';
    send({ k: 'leave' });
    const M = N.M;
    endMatchView(); N.M = null; N.lock = null; N.room = null; store.set('netLive', null);
    restoreDemo(); showHome();
    if (M && M.result) return;
  }

  // ------------------------------------------------------------------ real ETH (only when the server has it switched on)
  async function wallet() {
    const eth = window.ethereum, real = N.me && N.me.real;
    if (!eth) throw new Error('No wallet in this browser. Open the page in a browser with MetaMask or another wallet.');
    const [a] = await eth.request({ method: 'eth_requestAccounts' });
    const want = '0x' + Number(real.chainId).toString(16);
    if ((await eth.request({ method: 'eth_chainId' })) !== want) {
      try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); }
      catch (e) {
        if (e.code !== 4902) throw e;
        await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: want, chainName: real.chainName || 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [real.rpc], blockExplorerUrls: real.explorer ? [real.explorer] : [] }] });
      }
    }
    N.wallet = a;
    return a;
  }
  async function bindWallet() {
    const a = await wallet(), r = N.room;
    const text = `Brawl Street online\nRoom ${r.code}\nPlayer ${r.you}\nNonce ${r.nonce}`;
    const data = '0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');
    const sig = await window.ethereum.request({ method: 'personal_sign', params: [data, a] });
    send({ k: 'wallet', addr: a, sig });
  }
  async function walletTx(to, sel, id, value) {
    const a = N.wallet || await wallet();
    const tx = { from: a, to, data: '0x' + sel + String(id).replace(/^0x/, '') };
    if (value) tx.value = '0x' + BigInt(value).toString(16);
    return window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
  }
  // A deposit is the one moment the page moves real money, and every detail of it arrives over the
  // socket. Check it before the wallet is ever opened:
  //   - the escrow address must match the build-time pin (ESCROW_LIVE, injected by build.py the way
  //     ARENA_LIVE is) when there is one, and otherwise the address announced at sign-in;
  //   - the amount must be exactly the stake this room agreed, and one of the stakes on offer;
  //   - the chain must be the one announced at sign-in.
  // Without this a server that has been tampered with can point every player's deposit at an
  // address of its choosing, for an amount of its choosing.
  const HEX40 = /^0x[0-9a-fA-F]{40}$/, HEX64 = /^0x[0-9a-fA-F]{64}$/;
  function checkFund(m) {
    const real = N.me && N.me.real;
    if (!real) return 'This build is not set up for real-ETH matches.';
    if (!HEX40.test(String(m.escrow || ''))) return 'The server sent a malformed escrow address.';
    if (!HEX64.test(String(m.id || ''))) return 'The server sent a malformed match id.';
    const pinned = typeof ESCROW_LIVE !== 'undefined' && ESCROW_LIVE && ESCROW_LIVE.escrow;
    const expect = pinned || real.escrow;
    if (!expect || String(expect).toLowerCase() !== String(m.escrow).toLowerCase())
      return `The deposit address does not match the escrow this game uses (${expect || 'unknown'}). Nothing was sent.`;
    if (pinned && ESCROW_LIVE.chainId && Number(ESCROW_LIVE.chainId) !== Number(real.chainId))
      return 'The server asked for a different chain than this build expects. Nothing was sent.';
    let wei; try { wei = BigInt(m.stakeWei); } catch (e) { return 'The server sent a malformed stake.'; }
    if (wei <= 0n) return 'The server asked for a stake of zero.';
    // exactly the stake shown in the room, to the wei
    const agreed = N.room && N.room.stake;
    if (agreed != null) {
      const want = (BigInt(Math.round(Number(agreed) * 1e6)) * (10n ** 12n));
      if (want !== wei) return `The server asked for ${Number(wei) / 1e18} ETH but this room's stake is ${agreed} ETH. Nothing was sent.`;
    }
    const offered = (real.stakes || []).map(v => BigInt(Math.round(Number(v) * 1e6)) * (10n ** 12n));
    if (offered.length && !offered.some(v => v === wei)) return 'The server asked for a stake that is not one of the listed amounts. Nothing was sent.';
    return null;
  }
  function onFund(m) {
    N.room && (N.room.state = 'funding'); renderRoom();
    const bad = checkFund(m);
    if (bad) { toast(bad, true); send({ k: 'leave' }); return; }
    toast('Confirm the deposit in your wallet');
    walletTx(m.escrow, SEL.deposit, m.id, BigInt(m.stakeWei)).then(() => toast('Deposit sent. Waiting for the others…')).catch(e => toast('Deposit not sent: ' + (e.message || e), true));
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    byId('nbBack').onclick = () => { sfx(); leaveOnline(); };
    byId('nbRefill').onclick = () => { send({ k: 'refill' }); sfx('coin'); };
    const nm = byId('nbName');
    nm.onchange = () => { const v = nm.value.replace(/[^\w .\-]/g, '').trim().slice(0, 16); nm.value = v; if (v) { store.set('netName', v); send({ k: 'name', name: v }); } };
    byId('nbQuick2').onclick = () => { send({ k: 'quick', size: 2, stake: N.stake, stages: N.pool }); sfx(); };
    byId('nbQuick4').onclick = () => { send({ k: 'quick', size: 4, stake: N.stake, stages: N.pool }); sfx(); };
    byId('nbMode').querySelectorAll('button').forEach(b => b.onclick = () => { N.mode = +b.dataset.v; byId('nbMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); sfx(); });
    byId('nbCreate').onclick = () => { send({ k: 'create', size: N.mode, stake: N.stake, cpuFill: true, stocks: 3, items: true, stage: 'random' }); sfx(); };
    byId('nbCreateReal').onclick = () => { send({ k: 'create', size: N.mode, stake: N.realStake, real: true, stocks: 3, items: true, stage: 'random' }); sfx(); };
    const code = byId('nbCode');
    code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); };
    code.onkeydown = e => { if (e.key === 'Enter') byId('nbJoin').click(); };
    byId('nbJoin').onclick = () => { if (code.value.length < 5) return toast('Room codes have five letters'); send({ k: 'join', code: code.value }); sfx(); };
    byId('nrLeave').onclick = () => { send({ k: 'leave' }); N.room = null; N.lastRoom = null; showHome(); };
    byId('nrCopy').onclick = () => { if (N.room) copy(linkBase().replace(/#.*$/, '') + '#room:' + N.room.code); };
    byId('nrStart').onclick = () => { send({ k: 'start' }); sfx(); };
    byId('nrWallet').onclick = () => bindWallet().catch(e => toast(e.message || String(e), true));
    byId('nrMine').onclick = () => { const lk = N.me && N.me.profile && N.me.profile.look; if (lk) { send({ k: 'pick', char: lk.base }); sfx(); } };
    byId('nsAgain').onclick = () => { closeResult(true); send({ k: 'ready', on: true }); };
    byId('nsRoom').onclick = () => closeResult(true);
    byId('nsLeave').onclick = () => closeResult(false);
    byId('netLeave').onclick = leaveMatch;
    // the game's own Escape/P pause is off online (Game.arena is set); Escape here offers to leave
    addEventListener('keydown', e => { if (e.code === 'Escape' && Net.active && !e.repeat) leaveMatch(); });
    // a hidden tab stops requestAnimationFrame: keep the lockstep ticking so the others don't freeze
    let bg = null, bgT = null;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && Net.active) {
        try {
          bg = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),16)'], { type: 'text/javascript' })));
          bg.onmessage = () => { if (Net.active && document.hidden) frame(performance.now()); };
        } catch (e) { bgT = setInterval(() => { if (Net.active && document.hidden) frame(performance.now()); }, 16); }
      } else { if (bg) bg.terminate(); bg = null; clearInterval(bgT); bgT = null; }
    });
    setInterval(() => { if (N.view === 'home' && N.conn === 'open') send({ k: 'stats' }); }, 5000);
    setInterval(() => { if ((N.view === 'home' || N.view === 'room') && N.conn === 'open') syncLook(); }, 2000);
    setInterval(() => { if (N.view === 'room' && N.room && (N.room.countdown || N.room.readyBy)) { N.room.countdown = Math.max(0, N.room.countdown - 1000); N.room.readyBy = Math.max(0, N.room.readyBy - 1000); renderRoom(); } }, 1000);
  }

  // ------------------------------------------------------------------ entry points
  function open(opts) {
    build();
    showHome();
    if (opts && opts.room) N.pendingJoin = opts.room;
    if (N.conn === 'open' && N.me) { if (N.pendingJoin) { send({ k: 'join', code: N.pendingJoin }); N.pendingJoin = null; } return; }
    setTimeout(connect, 30);
  }
  function fromHash() {
    const h = location.hash || '';
    const m = /^#room[:=]([A-Za-z0-9]{5})/.exec(h);
    if (m) return open({ room: m[1].toUpperCase() });
    if (/^#online/.test(h)) return open();
    // came back within a minute of a running match (reload, crash): rejoin it
    const live = store.get('netLive', null);
    if (live && live.t && Date.now() - live.t < 60000) open();
  }
  addEventListener('hashchange', () => { if (/^#(room|online)/.test(location.hash)) fromHash(); });
  setTimeout(() => { try { fromHash(); } catch (e) { /* page still booting */ } }, 0);

  return { active: false, open, frame, send, toast, esc, charName, artImg, fmt, on: fn => hooks.push(fn), get state() { return N; } };
})();
window.Net = Net;
