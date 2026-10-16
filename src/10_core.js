// ===== core: math, input, sound =====
// Asset base name for a fighter id. Everything that loads per-fighter art (assets/<id>.jpg,
// <id>_cut.webp, <id>_glb.wasm, <id>_tex.jpg) goes through this one function instead of using the id
// directly, so an alternative art set can be switched on per fighter without touching six files.
// Identity by default; src/2f_origins.js replaces it when a fighter's roster-originality swap is on.
// Defined here, in the first file, so that removing 2f_origins.js leaves the game working.
let ASSET_ID = id => id;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Seeded match RNG (sfc32). Everything that can change a fight draws from here, so a
// fight replays identically from its seed in every browser and in the headless runner.
const Rng = {
  s: [0x9e3779b9, 0x243f6a88, 0xb7e15162, 1],
  seed(hex) {
    const h = String(hex).replace(/^0x/, '').padEnd(32, '0');
    this.s = [0, 8, 16, 24].map(i => parseInt(h.slice(i, i + 8), 16) >>> 0);
    if (!(this.s[0] | this.s[1] | this.s[2] | this.s[3])) this.s[3] = 1;
    for (let i = 0; i < 12; i++) this.next();
  },
  next() {
    let [a, b, c, d] = this.s;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0; a = b ^ (b >>> 9); b = (c + (c << 3)) >>> 0; c = ((c << 21) | (c >>> 11)) >>> 0; c = (c + t) >>> 0;
    this.s = [a >>> 0, b, c, d];
    return t / 4294967296;
  },
};
const rand = (a, b) => a + Rng.next() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const vrand = (a, b) => a + Math.random() * (b - a); // det-ok: visual-only jitter, never touches a fight
const deg = d => d * Math.PI / 180;
// Trig from + - * / only: engines disagree on Math.sin/cos in the last bit (V8 vs Safari),
// which is enough to fork a chaotic fight. These give identical doubles everywhere.
const HALF_PI = Math.PI / 2;
const S3 = -1 / 6, S5 = 1 / 120, S7 = -1 / 5040, S9 = 1 / 362880, S11 = -1 / 39916800, S13 = 1 / 6227020800, S15 = -1 / 1307674368000, S17 = 1 / 355687428096000;
function dsin(x) {
  x = x - Math.round(x / TAU) * TAU;
  if (x > HALF_PI) x = Math.PI - x; else if (x < -HALF_PI) x = -Math.PI - x;
  const q = x * x;
  return x * (1 + q * (S3 + q * (S5 + q * (S7 + q * (S9 + q * (S11 + q * (S13 + q * (S15 + q * S17))))))));
}
const dcos = x => dsin(x + HALF_PI);
const dhypot = (x, y) => Math.sqrt(x * x + y * y);
const store = {
  get(k, d) { try { const v = localStorage.getItem('tb_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tb_' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};

const PCOLORS = ['#ff4f8b', '#2fd4ff', '#ffd23f', '#6dff8c'];
// grab / grapple / drop are appended, never inserted: the online lockstep packs one bit per action in
// this order (63_netsim encode), so every older bit keeps its index.
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'shield', 'smash', 'grab', 'grapple', 'drop'];

// ---- keyboard ----
// Tekken's two throw pairs become two neighbouring keys (27_tekken.js): grab = the generic throw,
// grapple = the fighter's command throw, both together = the command throw. Smash moved off R to T
// for P1 so R can be the grapple; a direction tap + Attack still fires a smash either way.
const KEYMAPS = {
  kb1: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], jump: ['KeyW', 'Space'],
         attack: ['KeyF'], special: ['KeyG'], shield: ['KeyH'], smash: ['KeyT'],
         grab: ['KeyE'], grapple: ['KeyR'], drop: ['KeyQ'] },
  kb2: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], jump: ['ArrowUp'],
         attack: ['KeyK', 'Numpad1'], special: ['KeyL', 'Numpad2'], shield: ['Semicolon', 'Numpad3'], smash: ['KeyI', 'Numpad5'],
         grab: ['KeyO', 'Numpad4'], grapple: ['KeyP', 'Numpad6'], drop: ['KeyU', 'Numpad0'] },
};
const keysHeld = new Set();
const keysTapped = new Set();
const GAME_KEYS = new Set(Object.values(KEYMAPS).flatMap(m => Object.values(m).flat()));
addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code) && Game.state === 'match') e.preventDefault();
  keysHeld.add(e.code); keysTapped.add(e.code);
  // P is player 2's grapple key now, so it only pauses when nobody is on the P2 keyboard
  if (e.repeat) return;
  if (e.code === 'Escape') Game.togglePause();
  else if (e.code === 'KeyP' && !(Game.fighters || []).some(f => f.ctrl === 'kb2')) Game.togglePause();
});
addEventListener('keyup', e => keysHeld.delete(e.code));
addEventListener('blur', () => keysHeld.clear());

// ---- touch (drives whichever human slot is set to "touch") ----
const Touch = { held: {}, stickX: 0, stickY: 0 };
function setupTouch() {
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let sid = null, cx = 0, cy = 0;
  const move = (x, y) => {
    let dx = x - cx, dy = y - cy; const m = Math.hypot(dx, dy), R = 55;   // det-ok: touch knob render + this device's own input; the encoded mask is what travels, never recomputed
    if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    Touch.stickX = dx / R; Touch.stickY = dy / R;
  };
  stick.addEventListener('pointerdown', e => {
    sid = e.pointerId; stick.setPointerCapture(sid);
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) move(e.clientX, e.clientY); });
  const end = e => { if (e.pointerId !== sid) return; sid = null; Touch.stickX = Touch.stickY = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  document.querySelectorAll('.tb').forEach(b => {
    const k = b.dataset.k;
    const on = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); Touch.held[k] = true; Touch.tap = Touch.tap || {}; Touch.tap[k] = true; b.classList.add('on'); Sfx.unlock(); };
    const off = e => { Touch.held[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  });
}

// ---- gamepads ----
function padState(i) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[i];
  if (!p) return null;
  const b = n => !!(p.buttons[n] && (p.buttons[n].pressed || p.buttons[n].value > 0.5));
  const ax = p.axes[0] || 0, ay = p.axes[1] || 0, rx = p.axes[2] || 0, ry = p.axes[3] || 0;
  const rs = Math.hypot(rx, ry) > 0.6;   // det-ok: gamepad deadzone on this device; only the transmitted input mask reaches the fight
  return {
    left: ax < -0.4 || b(14) || (rs && rx < -0.4), right: ax > 0.4 || b(15) || (rs && rx > 0.4),
    up: ay < -0.5 || b(12) || (rs && ry < -0.5), down: ay > 0.5 || b(13) || (rs && ry > 0.5),
    jump: b(2) || b(3) || ay < -0.7, attack: b(0), special: b(1),
    // throws sit on the two shoulder buttons, Tekken-style; the triggers keep guard
    shield: b(6) || b(7), smash: rs,
    grab: b(4), grapple: b(5), drop: b(10) || b(8),
    // NOT free aim: the right stick is already the smash flick (`smash: rs` above), so taking it for
    // aiming would fire a smash every time you pointed the gun. Pad free-aim needs smash moved to a
    // button first, which is a controls decision, not a rename. Mouse aim is wired up below and is
    // what Madness itself uses.
  };
}

// Online play: controllers 'net0'..'net3' read this tick's lockstep input (a bitmask over ACTIONS),
// set by NetSim.step() in the page (77_net.js) and on the game server (net/), before each Game.step().
const NetInput = { cur: [0, 0, 0, 0] };

// ---- FREE AIM (Madness-style): the body faces a direction, the arms point anywhere ----
// The angle is quantised to AIM_STEPS positions around the circle and that integer is the ONLY thing
// that ever reaches the simulation. The table is precomputed so a given step always yields the exact
// same cos/sin on every machine; deriving them from a float at sim time is how lockstep desyncs.
// 128 steps is 2.8 degrees apart, which nobody can see in play, and it keeps mouse, right stick and
// keyboard on identical footing. See NetSim.encode (63_netsim.js) for the wire format.
const AIM_STEPS = 128;
const AIM_COS = [], AIM_SIN = [];
// dcos/dsin, NOT Math.cos/sin: these values become the bullet's direction, and V8 and Safari
// disagree on Math.cos in the last bit, which is enough to fork a fight. The table is built once and
// every step then yields the identical double on every machine.
for (let i = 0; i < AIM_STEPS; i++) { const a = i * TAU / AIM_STEPS; AIM_COS.push(dcos(a)); AIM_SIN.push(dsin(a)); }
// Math.atan2 maps THIS device's pointer to a step number: a local input decision, the same class as
// the gamepad deadzone. Only the integer it produces is ever simulated or sent, so an engine
// disagreeing by one step changes where that player aimed, never what the fight does.
const aimStep = (dx, dy) => Math.round(Math.atan2(dy, dx) / TAU * AIM_STEPS) & (AIM_STEPS - 1);   // det-ok: local input quantising; only the integer reaches the fight
// where the pointer is, in world space, kept by the page; null until the mouse moves over the canvas
const Aim = { px: null, py: null, kb: [0, 0, 0, 0] };

// Read one controller into a plain {action: bool} object
function readInput(src) {
  const o = {};
  if (src === 'kb1' || src === 'kb2') {
    const m = KEYMAPS[src];
    for (const a of ACTIONS) o[a] = m[a].some(k => keysHeld.has(k) || keysTapped.has(k));
  } else if (src === 'touch') {
    const t = Touch.tap || {};
    for (const a of ACTIONS) o[a] = !!(Touch.held[a] || t[a]);
    o.left = Touch.stickX < -0.35; o.right = Touch.stickX > 0.35;
    o.up = Touch.stickY < -0.5; o.down = Touch.stickY > 0.55;
    o.jump = o.jump || Touch.stickY < -0.75;
  } else if (src && src.startsWith('pad')) {
    const s = padState(+src.slice(3));
    for (const a of ACTIONS) o[a] = !!(s && s[a]);
    if (s && s.aim != null) o.aim = s.aim;
  } else if (src && src.startsWith('net')) {
    const m = NetInput.cur[+src.slice(3)] | 0;
    for (let i = 0; i < ACTIONS.length; i++) o[ACTIONS[i]] = (m & (1 << i)) !== 0;
    const a = (m >>> ACTIONS.length) & (AIM_STEPS * 2 - 1);
    if (a) o.aim = a - 1;
  } else for (const a of ACTIONS) o[a] = false;
  return o;
}
function endInputFrame() { keysTapped.clear(); Touch.tap = {}; }

// ---- sound: small synth, no files ----
const Sfx = {
  ctx: null, master: null, on: store.get('sound', true),
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  tone(f0, f1, dur, type = 'square', vol = 0.2, delay = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3, freq = 1200, delay = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + delay, n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);   // det-ok: audio noise buffer
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  hit(power) { const p = clamp(power, 0, 1); this.noise(0.08 + p * 0.18, 0.25 + p * 0.3, 900 + p * 3000); this.tone(220 - p * 120, 60, 0.12 + p * 0.1, 'square', 0.12 + p * 0.1); },
  swing() { this.noise(0.07, 0.08, 2400); },
  jump() { this.tone(300, 620, 0.1, 'triangle', 0.12); },
  land() { this.noise(0.05, 0.07, 500); },
  shield() { this.tone(900, 500, 0.08, 'sine', 0.12); },
  ko() { this.noise(0.7, 0.5, 4000); this.tone(880, 60, 0.8, 'sawtooth', 0.2); },
  coin() { this.tone(988, 988, 0.06, 'square', 0.1); this.tone(1319, 1319, 0.2, 'square', 0.1, 0.06); },
  ui() { this.tone(660, 880, 0.05, 'triangle', 0.1); },
  // ---- guns (items session): pure synth, no samples; silent until the audio context exists ----
  shotgun() {                                   // deep thump + bright crack + tail
    this.noise(0.05, 0.42, 7000); this.noise(0.24, 0.5, 1700); this.noise(0.55, 0.2, 420, 0.02);
    this.tone(190, 42, 0.3, 'sine', 0.32);
  },
  rack(delay = 0.34) {                          // pump action: two metallic clacks
    this.tone(2200, 900, 0.035, 'square', 0.1, delay); this.noise(0.04, 0.12, 3400, delay);
    this.tone(1500, 620, 0.045, 'square', 0.1, delay + 0.1); this.noise(0.05, 0.1, 2600, delay + 0.1);
  },
  pistol() { this.noise(0.045, 0.4, 8000); this.noise(0.2, 0.16, 900, 0.015); this.tone(330, 60, 0.12, 'sine', 0.26); },
  brass(delay = 0.26) { this.tone(2700, 1900, 0.04, 'triangle', 0.07, delay); this.tone(3500, 2500, 0.03, 'sine', 0.05, delay + 0.05); },
  slide(delay = 0) { this.tone(1800, 700, 0.05, 'square', 0.09, delay); this.noise(0.05, 0.1, 3000, delay + 0.02); },
  rocketFire() { this.noise(0.5, 0.3, 700); this.tone(140, 420, 0.4, 'sawtooth', 0.14); },
  mgunTap() { this.noise(0.03, 0.2, 4200); this.tone(430, 120, 0.05, 'square', 0.09); },
  sniperShot() { this.noise(0.05, 0.5, 9000); this.noise(0.75, 0.16, 520, 0.03); this.tone(270, 50, 0.32, 'sine', 0.24); },
  count(hi) { this.tone(hi ? 880 : 440, hi ? 880 : 440, hi ? 0.35 : 0.15, 'square', 0.15); },
};
addEventListener('pointerdown', () => Sfx.unlock(), { once: false, passive: true });
addEventListener('keydown', () => Sfx.unlock(), { passive: true });
