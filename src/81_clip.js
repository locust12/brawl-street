// ===== Clip It: the last ~10 s of a match as an MP4 you can post =====
// While a match runs, every other frame of the screen (3D canvas + HUD canvas) goes into a WebCodecs
// H.264 encoder, and the game's sound goes into an AAC encoder. The encoded chunks sit in a rolling
// ~11 s buffer. "Clip It" (button or C) muxes the buffer into an MP4 with mp4-muxer (jsDelivr) and
// shows it with Save and Share. Inside a claude.ai artifact, Save goes through the `downloads` capability.
// UI only: wraps R.frame, reads the canvases, never touches fight state or the seeded Rng.
(function () {
  if (typeof R === 'undefined' || typeof document === 'undefined') return;
  const SECS = 10, FPS = 30, MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';
  const small = typeof IS_TOUCH !== 'undefined' && IS_TOUCH;
  const W = small ? 960 : 1280, H = small ? 540 : 720;
  const C = {
    ok: typeof VideoEncoder === 'function' && typeof VideoFrame === 'function',
    v: [], a: [], enc: null, vcfg: null, aenc: null, acfg: null, arate: 0,
    clock: 0, lastT: 0, lastKey: -1e12, forceKey: true, match: null, rec: false, aTs: null,
    busy: false, modal: null, url: null, muxP: null, dlP: null, dl: null, g3d: null,
  };
  let resBtn = null;   // "Clip the finish" on the results screen (built with the UI below)
  window.Clip = C;

  // ---------- video ----------
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { alpha: false });
  async function setupVideo() {
    const tries = [];
    for (const rt of [true, false]) for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
      const cfg = { codec, width: W, height: H, bitrate: small ? 3.5e6 : 6e6, framerate: FPS, avc: { format: 'avc' } };
      if (rt) cfg.latencyMode = 'realtime';   // no B-frames, steady output; some Safari builds refuse it
      tries.push(cfg);
    }
    for (const cfg of tries) {
      try { if (!(await VideoEncoder.isConfigSupported(cfg)).supported) continue; } catch (e) { continue; }
      const enc = new VideoEncoder({
        output(chunk, meta) {
          if (meta && meta.decoderConfig) C.vcfg = meta.decoderConfig;
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          C.v.push({ data, key: chunk.type === 'key', ts: chunk.timestamp, dur: chunk.duration || Math.round(1e6 / FPS) });
          prune();
        },
        error() { C.enc = null; C.ok = false; sync(); },
      });
      enc.configure(cfg); C.enc = enc; return true;
    }
    C.ok = false; sync(); return false;
  }
  // keep one keyframe at or before (newest - SECS), drop everything older
  function prune() {
    const v = C.v, cut = v[v.length - 1].ts - SECS * 1e6;
    let k = -1; for (let i = 0; i < v.length && v[i].ts <= cut; i++) if (v[i].key) k = i;
    if (k > 0) v.splice(0, k);
    const t0 = v[0].ts - 2e5; let j = 0; while (j < C.a.length && C.a[j].ts < t0) j++;
    if (j) C.a.splice(0, j);
  }
  function reset() { C.v = []; C.a = []; C.forceKey = true; C.aTs = null; }

  function watermark(x, y) {
    g.save(); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.font = `italic 900 ${Math.round(H * 0.036)}px "Barlow Condensed", Impact, sans-serif`;
    const gr = g.createLinearGradient(0, y - H * 0.03, 0, y);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#9aa1b3'); gr.addColorStop(0.58, '#ffffff'); gr.addColorStop(1, '#c9ced9');
    g.globalAlpha = 0.85; g.lineWidth = 4; g.strokeStyle = 'rgba(5,5,7,.8)'; g.strokeText('Brawl Street', x, y);
    g.fillStyle = gr; g.fillText('Brawl Street', x, y);
    const tw = g.measureText('Brawl Street').width;
    g.fillStyle = '#ff2a4a'; g.fillRect(x - tw, y + 4, tw, 3);
    g.restore();
  }
  function capture() {
    const G = Game, now = performance.now();
    C.rec = C.ok && G.state === 'match' && !G.paused && !document.hidden;
    if (!C.rec) return;
    if (!C.enc) { if (!C.starting) { C.starting = true; setupVideo(); } return; }
    if (C.enc.state !== 'configured') return;
    if (G.fighters !== C.match) { C.match = G.fighters; reset(); }
    if (now - C.lastT < 1000 / FPS - 3) return;
    C.clock += Math.min(now - C.lastT, 100); C.lastT = now;
    if (C.enc.encodeQueueSize > 3) return;   // encoder is behind: skip this frame
    // letterbox the viewport into 16:9, 3D world first, then the HUD canvas on top
    const sw = innerWidth, sh = innerHeight, k = Math.min(W / sw, H / sh), dw = sw * k, dh = sh * k, dx = (W - dw) / 2, dy = (H - dh) / 2;
    g.fillStyle = '#050507'; g.fillRect(0, 0, W, H);
    const w3 = window.V3 && V3.ready && (C.g3d = C.g3d || document.getElementById('g3d'));
    try { if (w3) g.drawImage(w3, dx, dy, dw, dh); g.drawImage(R.cv, dx, dy, dw, dh); } catch (e) { return; }
    watermark(W - 18, H - 16);
    const ts = Math.round(C.clock * 1000), key = C.forceKey || ts - C.lastKey >= 1e6;
    if (key) { C.lastKey = ts; C.forceKey = false; }
    let fr = null;
    try { fr = new VideoFrame(cv, { timestamp: ts, duration: Math.round(1e6 / FPS) }); C.enc.encode(fr, { keyFrame: key }); } catch (e) { /* skip */ }
    if (fr) fr.close();
    if (!C.muxP && C.v.length > FPS * 3) C.muxP = import(MUXER).catch(() => (C.muxP = null));   // warm the muxer
  }

  // ---------- audio: tap whatever the game connects to the speakers ----------
  if (C.ok && typeof AudioEncoder === 'function' && typeof AudioData === 'function' && window.AudioNode) {
    const connect = AudioNode.prototype.connect;
    const onAudio = e => {
      if (!C.aenc || C.aenc.state !== 'configured' || !C.rec || performance.now() - C.lastT > 200) { C.aTs = null; return; }
      const ib = e.inputBuffer, n = ib.length, data = new Float32Array(n * 2);
      data.set(ib.getChannelData(0), 0); data.set(ib.getChannelData(ib.numberOfChannels > 1 ? 1 : 0), n);
      const dur = n / ib.sampleRate * 1e6, clockNow = (C.clock + Math.min(performance.now() - C.lastT, 100)) * 1000;
      if (C.aTs == null || Math.abs(C.aTs - (clockNow - dur)) > 1.5e5) C.aTs = clockNow - dur;
      try {
        const ad = new AudioData({ format: 'f32-planar', sampleRate: ib.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.max(0, Math.round(C.aTs)), data });
        C.aenc.encode(ad); ad.close();
      } catch (err) { /* skip */ }
      C.aTs += dur;
    };
    const tap = node => {
      const ctx = node.context;
      if (window.OfflineAudioContext && ctx instanceof OfflineAudioContext) return;
      if (!C.tap || C.tap.context !== ctx) {
        const t = ctx.createGain(), sp = ctx.createScriptProcessor(2048, 2, 2), mute = ctx.createGain();
        mute.gain.value = 0; sp.onaudioprocess = onAudio;
        connect.call(t, sp); connect.call(sp, mute); connect.call(mute, ctx.destination);
        C.tap = t; C.arate = ctx.sampleRate;
        const cfg = { codec: 'mp4a.40.2', sampleRate: ctx.sampleRate, numberOfChannels: 2, bitrate: 128000 };
        AudioEncoder.isConfigSupported(cfg).then(s => {
          if (!s.supported) return;
          const enc = new AudioEncoder({
            output(chunk, meta) {
              if (meta && meta.decoderConfig) C.acfg = meta.decoderConfig;
              const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
              C.a.push({ data: d, ts: chunk.timestamp, dur: chunk.duration || 0 });
            },
            error() { C.aenc = null; },
          });
          enc.configure(cfg); C.aenc = enc;
        }).catch(() => {});
      }
      connect.call(node, C.tap);
    };
    AudioNode.prototype.connect = function (dest) {
      const r = connect.apply(this, arguments);
      try { if (window.AudioDestinationNode && dest instanceof AudioDestinationNode && dest.context === this.context) tap(this); } catch (e) { /* recording is optional */ }
      return r;
    };
  }

  // ---------- mux ----------
  async function makeClip() {
    const v = C.v.slice(), a = C.a.slice();
    if (!v.length || !C.vcfg) return null;
    const end = v[v.length - 1].ts;
    let i0 = 0; for (let i = 0; i < v.length; i++) if (v[i].key && v[i].ts <= end - SECS * 1e6) i0 = i;
    const vs = v.slice(i0); if (!vs[0].key) return null;
    const t0 = vs[0].ts, as = C.acfg ? a.filter(c => c.ts >= t0 && c.ts <= end + 1e5) : [];
    C.muxP = C.muxP || import(MUXER);
    const { Muxer, ArrayBufferTarget } = await C.muxP;
    const mux = new Muxer({
      target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      audio: as.length ? { codec: 'aac', numberOfChannels: 2, sampleRate: C.arate } : undefined,
    });
    vs.forEach((c, i) => mux.addVideoChunkRaw(c.data, c.key ? 'key' : 'delta', c.ts - t0, c.dur, i ? undefined : { decoderConfig: C.vcfg }));
    as.forEach((c, i) => mux.addAudioChunkRaw(c.data, 'key', c.ts - t0, c.dur, i ? undefined : { decoderConfig: C.acfg }));
    mux.finalize();
    return { blob: new Blob([mux.target.buffer], { type: 'video/mp4' }), secs: (end - t0) / 1e6 + 1 / FPS, t0, end, sound: as.length > 0 };
  }

  // ---------- UI ----------
  const css = document.createElement('style');
  css.textContent = `
/* --util-y is the utility row the HUD reserves under the clock plate (71_hud.js). Clip It used to
   sit at a hardcoded +64px, 14px above the pause/sound row, and its corner cut the "POT x.xxx" line
   the HUD draws there (runs/menus2/08_match.jpg). */
#clipBtn{position:fixed;left:calc(50% + 28px);top:var(--util-y,calc(max(12px,env(safe-area-inset-top)) + 90px));z-index:6;height:30px;padding:0 12px 0 10px;border:0;
  display:flex;align-items:center;gap:7px;background:rgba(5,5,7,.6);box-shadow:inset 0 0 0 1px var(--line2,rgba(255,255,255,.18));color:#fff;cursor:pointer;
  font:italic 900 16px/1 var(--display,"Barlow Condensed",Impact,sans-serif);letter-spacing:.02em}
#clipBtn:hover{background:rgba(255,42,74,.25)}
#clipBtn .dot{width:9px;height:9px;border-radius:50%;background:#ff2a4a;box-shadow:0 0 8px #ff2a4a;animation:clipRec 1.2s infinite}
#clipBtn kbd{font:700 10px var(--mono,monospace);color:var(--muted,#9398a8);font-style:normal}
#clipBtn.busy .dot{animation:none;background:#ffc83d;box-shadow:0 0 8px #ffc83d}
@keyframes clipRec{50%{opacity:.25}}
#clipModal{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(5,5,7,.78);backdrop-filter:blur(6px)}
#clipModal .card{width:min(860px,100%);max-height:100%;overflow:auto;background:var(--panel,rgba(12,13,20,.92));box-shadow:inset 0 0 0 1px var(--line2,rgba(255,255,255,.18)),0 30px 80px rgba(0,0,0,.6);padding:18px}
#clipModal .hd{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}
#clipModal h3{margin:0;font:italic 900 34px/1 var(--display,"Barlow Condensed",Impact,sans-serif);color:#fff}
#clipModal .meta{font:700 11px var(--mono,monospace);color:var(--muted,#9398a8);letter-spacing:.06em}
#clipModal video{display:block;width:100%;aspect-ratio:16/9;background:#000}
#clipModal .combo{margin-top:12px;font:italic 900 22px/1.1 var(--display,"Barlow Condensed",Impact,sans-serif);color:#fff}
#clipModal .combo b{color:var(--red,#ff2a4a)}
#clipModal .row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
#clipModal .note{margin-top:10px;font:500 13px var(--ui,system-ui);color:var(--muted,#9398a8);min-height:1em}
#clipToast{position:fixed;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 104px);transform:translateX(-50%);z-index:61;padding:8px 14px;background:rgba(5,5,7,.85);
  box-shadow:inset 0 0 0 1px var(--line2,rgba(255,255,255,.18));color:#fff;font:600 13px var(--ui,system-ui);pointer-events:none;transition:opacity .3s}`;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'clipBtn'; btn.hidden = true; btn.type = 'button';
  btn.setAttribute('aria-label', 'Clip It: save the last 10 seconds as a video');
  btn.innerHTML = '<span class="dot"></span>Clip It' + (small ? '' : ' <kbd>C</kbd>');
  btn.onclick = () => take();
  document.body.appendChild(btn);

  let toastT = 0;
  function toast(msg) {
    let el = document.getElementById('clipToast');
    if (!el) { el = document.createElement('div'); el.id = 'clipToast'; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = 0; }, 2200);
  }
  const hasFootage = () => C.v.length > 1 && C.v[C.v.length - 1].ts - C.v[0].ts >= 1e6;
  function sync() {
    const st = Game.state, show = C.ok && !C.modal && ((st === 'match' && !Game.demo) || (st === 'results' && hasFootage()));
    if (btn.hidden === show) btn.hidden = !show;
    const rs = !(C.ok && hasFootage() && !C.modal);
    if (resBtn && resBtn.hidden !== rs) resBtn.hidden = rs;
  }
  const rematch = document.getElementById('bRematch');
  if (rematch && rematch.parentNode) {
    resBtn = document.createElement('button'); resBtn.className = 'btn'; resBtn.type = 'button'; resBtn.hidden = true;
    resBtn.textContent = 'Clip the finish'; resBtn.onclick = () => take();
    rematch.parentNode.insertBefore(resBtn, rematch.nextSibling);
  }

  function bestCombo(clip) {
    const log = (window.ComboHUD && ComboHUD.log) || [], from = performance.now() - clip.secs * 1000 - 500;
    let best = null; for (const c of log) if (c.at >= from && (!best || c.n > best.n)) best = c;
    return best;
  }
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  async function take() {
    if (C.busy || C.modal) return;
    if (!C.ok) return toast('Clips need a browser with WebCodecs (Chrome, Edge, Safari 17+)');
    if (!hasFootage()) return toast('Fight for a few seconds first');
    C.busy = true; btn.classList.add('busy');
    const pause = Game.state === 'match' && !Game.paused && !Game.arena && !Game.demo && !(typeof Net !== 'undefined' && Net.active);
    if (pause) Game.paused = true;
    try {
      const clip = await makeClip();
      if (!clip) throw new Error('empty');
      open(clip, pause);
    } catch (e) {
      toast(e && e.message === 'empty' ? 'Fight for a few seconds first' : "Couldn't build the clip. Check your connection and try again");
      if (pause) Game.paused = false;
    } finally { C.busy = false; btn.classList.remove('busy'); sync(); }
  }

  // Resolved ahead of the click, into C.dl, because the Save handler must not await
  // anything before it triggers the download (see the comment on Save below).
  function downloads() {
    if (!C.dlP && window.claude && typeof window.claude.use === 'function') {
      C.dlP = Promise.resolve(window.claude.use('downloads')).then(d => (C.dl = d), () => null);
    }
    return C.dlP || Promise.resolve(null);
  }

  function open(clip, resume) {
    const combo = bestCombo(clip);
    const stamp = new Date(), pad = n => String(n).padStart(2, '0');
    const name = 'brawl-street-' + (combo ? slug(combo.name) + '-' + combo.n + '-hit-combo' : 'clip') + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds()) + '.mp4';
    const file = new File([clip.blob], name, { type: 'video/mp4' });
    C.url = URL.createObjectURL(clip.blob);
    const m = document.createElement('div'); m.id = 'clipModal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Your clip');
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    m.innerHTML = `<div class="card">
      <div class="hd"><h3>Clipped</h3><span class="meta">${clip.secs.toFixed(1)} s · ${W}×${H} · MP4${clip.sound ? '' : ' · no sound'}</span></div>
      <video playsinline autoplay loop controls></video>
      ${combo ? `<div class="combo">${combo.name} · <b>${combo.n}-hit combo</b> · ${combo.dmg}%</div>` : ''}
      <div class="row">
        <button class="btn primary" data-a="save">Save MP4</button>
        ${canShare ? '<button class="btn" data-a="share">Share</button>' : ''}
        <button class="btn" data-a="close">${resume ? 'Back to the fight' : 'Close'}</button>
      </div>
      <div class="note"></div></div>`;
    const vid = m.querySelector('video'); vid.muted = true; vid.src = C.url;
    const note = t => { m.querySelector('.note').textContent = t; };
    const close = () => {
      if (!C.modal) return;
      m.remove(); C.modal = null; URL.revokeObjectURL(C.url); C.url = null;
      if (resume && Game.state === 'match') Game.paused = false;
      sync();
    };
    m.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) { if (e.target === m) close(); return; }
      if (a.dataset.a === 'close') return close();
      if (a.dataset.a === 'save') {
        if (C.dl) {
          try { await C.dl.save({ filename: name, data: clip.blob }); note('Saved ' + name); }
          catch (err) { if (!err || err.code !== 'declined') note('Saving is blocked here. Right-click the video and pick "Save video as".'); }
          return;
        }
        // Nothing may be awaited before this click. Safari drops the user-gesture token
        // across an await and then refuses the download without a word - 9/20 the old
        // `await downloads()` here meant Save did nothing at all in Safari.
        const l = document.createElement('a'); l.href = C.url; l.download = name; document.body.appendChild(l); l.click(); l.remove();
        note('Saved ' + name + '. Nothing in Downloads? Safari asks per site - Safari > Settings > Websites > Downloads > Allow, or right-click the video and pick "Save video as".');
      }
      if (a.dataset.a === 'share') {
        const text = combo ? `${combo.n}-hit combo with ${combo.name} in Brawl Street` : 'Brawl Street';
        try { await navigator.share({ files: [file], title: 'Brawl Street clip', text }); }
        catch (err) { if (err && err.name !== 'AbortError') { a.remove(); note('Sharing is blocked here. Save the MP4 and post it.'); } }
      }
    });
    document.body.appendChild(m); C.modal = { close };
    vid.play().catch(() => {});
    downloads();
    sync();
  }

  addEventListener('keydown', e => {
    if (C.modal && e.code === 'Escape') { e.stopPropagation(); e.preventDefault(); C.modal.close(); return; }
    if (e.code === 'KeyC' && !e.repeat && !e.metaKey && !e.ctrlKey && !C.modal && (Game.state === 'match' || Game.state === 'results')) {
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); take();
    }
  }, true);

  // how-to-play: a Combos + Clips panel
  const keys = document.querySelector('#scHelp .keys');
  if (keys) {
    const p = document.createElement('div'); p.className = 'panel';
    p.innerHTML = `<h3>Combos + clips</h3><dl>
      <dt>Land a hit</dt><dd>Then press a stronger attack to cancel into it: Jab, then Tilt, then Smash or Special</dd>
      <dt>Up + Attack</dt><dd>Mid-combo, launches them straight up. Jump and keep hitting in the air</dd>
      <dt>In the air</dt><dd>Chain different aerials, then finish with a Special</dd>
      <dt>Smash button</dt><dd>Mid-combo, direction + Attack stays a tilt. Use the smash button for a smash</dd>
      <dt>Attack + Special</dt><dd>Grapple: press both together up close to grab and play your fighter's signature throw. Beats shields (GRAB on touch)</dd>
      <dt>C</dt><dd>Clip It: saves the last 10 seconds as a video you can post</dd></dl>`;
    keys.appendChild(p);
  }

  const frame = R.frame;
  R.frame = function () {
    const r = frame.apply(this, arguments);
    try { capture(); sync(); } catch (e) { /* recording must never break the game loop */ }
    return r;
  };
})();
