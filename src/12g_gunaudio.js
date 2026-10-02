// ===== GUN AUDIO: real-sounding reports, mechanics, brass, impacts — synthesised, original, no samples =====
// Owner: the gunplay session (dev/NOTES-guns.md). Page only (NOT a build.py SIM_FILE): it never touches
// fight state or the seeded Rng — it listens to the sim's GUNS.ev ring (6e_guns.js) after every
// Game.step and plays what happened.
//
// WHY THIS FILE EXISTS. Duane: "all the weapons sound like lasers, and no real bullets". Two causes:
//   1. 12_audio.js overrides Sfx.tone and maps ANY falling tone that starts at 1 kHz or more onto its
//      sampled `laser` clip. The old gun synth in 10_core built the pump rack, the brass tinkle and the
//      slide cycle out of exactly such tones, and every casing bounce called Sfx.brass — so a shotgun
//      blast came with two lasers and every bouncing shell was a laser.
//   2. The reports were one lowpassed noise burst + a sine drop: no crack, no body, no room.
// Here every sound is built the way a recorded gunshot is shaped:
//   CRACK  — a sub-millisecond N-wave + a broadband burst (the muzzle blast / supersonic crack)
//   BODY   — filtered noise whose cutoff falls from ~9 kHz to a few hundred Hz in tens of ms, plus the
//            gun's own resonance (a pistol rings high, a shotgun booms low)
//   THUMP  — a pitched-down sine: the chest punch of the pressure wave, soft-clipped
//   MECH   — the action cycling: slide, bolt, pump, hammer, as tuned metal clicks (partials)
//   ROOM   — a Freeverb-style tail + discrete slap echoes off distant walls, darker than the dry
//   then saturation (recordings clip) and a DC block.
// Buffers are rendered once, a few per idle slice after the audio context unlocks (~0.3 s of CPU
// total), with 2-5 variants per sound so an SMG burst never machine-guns the same sample.
// The same GNSYN code runs in Node (dev/guns/gunsfx_render.js writes WAVs + spectrograms to check).

const GNSYN = (() => {
  let _s = 1;
  const seed = n => { _s = (n >>> 0) || 1; };
  const rnd = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const nz = () => rnd() * 2 - 1;
  const jit = k => 1 + (rnd() * 2 - 1) * k;          // +-k variation
  const TAU = Math.PI * 2;

  // TPT state-variable filter: stable while its cutoff sweeps
  class Svf {
    constructor(sr, fc, q) { this.sr = sr; this.z1 = 0; this.z2 = 0; this.set(fc || 1000, q || 0.707); }
    set(fc, q) {
      const g = Math.tan(Math.PI * Math.min(Math.max(fc, 12), this.sr * 0.45) / this.sr), k = 1 / (q || 0.707);
      this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    }
    run(v0) {
      const v3 = v0 - this.z2, v1 = this.a1 * this.z1 + this.a2 * v3, v2 = this.z2 + this.a2 * this.z1 + this.a3 * v3;
      this.z1 = 2 * v1 - this.z1; this.z2 = 2 * v2 - this.z2;
      this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2; return v2;
    }
  }
  const idx = (sr, t) => Math.max(0, Math.round(t * sr));

  // ---- layers (all add into `o`) ----
  // N-wave: the shock front. Straight up, a linear fall through zero, straight back: the "crack".
  function nwave(o, sr, t0, amp, wMs) {
    const i0 = idx(sr, t0), n = Math.max(3, Math.round(wMs * sr / 1000));
    for (let i = 0; i < n && i0 + i < o.length; i++) o[i0 + i] += amp * (1 - 2 * i / (n - 1)) * (i === 0 ? 0.6 : 1);
  }
  // noise burst: attack/decay envelope, then optional sweeping lowpass, a highpass, and a resonant body
  function burst(o, sr, t0, amp, attMs, tauMs, lenS, f) {
    f = f || {};
    const i0 = idx(sr, t0), n = Math.min(o.length - i0, idx(sr, lenS)), att = attMs * sr / 1000, tau = tauMs * sr / 1000;
    const lp = f.lp ? new Svf(sr, f.lp[0], f.lpq || 0.8) : null, hp = f.hp ? new Svf(sr, f.hp, 0.7) : null;
    const bp = f.bp ? new Svf(sr, f.bp[0], f.bp[1]) : null, res = f.res ? new Svf(sr, f.res[0], f.res[1]) : null;
    const sw = f.lp ? f.lp[2] * sr / 1000 : 1;
    for (let i = 0; i < n; i++) {
      if (lp && (i & 15) === 0) lp.set(f.lp[1] + (f.lp[0] - f.lp[1]) * Math.exp(-i / sw), f.lpq || 0.8);
      const env = i < att ? i / att : Math.exp(-(i - att) / tau);
      let x = nz() * env;
      if (hp) { hp.run(x); x = hp.hp; }
      if (bp) { bp.run(x); x = bp.bp * bp.k * (f.bpGain || 2); }
      let y = x;
      if (lp) y = lp.run(x);
      if (res) { res.run(x); y = y * (1 - f.res[2]) + res.bp * res.k * f.res[2] * 2.6; }
      o[i0 + i] += y * amp;
    }
  }
  // pitched-down sine: the thump you feel
  function thump(o, sr, t0, amp, f0, f1, swMs, tauMs, drive) {
    const i0 = idx(sr, t0), tau = tauMs * sr / 1000, sw = swMs * sr / 1000, att = 0.0008 * sr, n = Math.min(o.length - i0, Math.round(tau * 7));
    const d = drive || 1.5, kd = Math.tanh(d); let ph = 0;
    for (let i = 0; i < n; i++) {
      const fr = f1 + (f0 - f1) * Math.exp(-i / sw); ph += TAU * fr / sr;
      const env = i < att ? i / att : Math.exp(-(i - att) / tau);
      o[i0 + i] += Math.tanh(Math.sin(ph) * env * d) / kd * amp;
    }
  }
  // tuned metal: decaying partials, each with its own decay, excited by a tiny noise tick
  function modes(o, sr, t0, amp, fr, taus, amps, tickAmp) {
    const i0 = idx(sr, t0);
    for (let m = 0; m < fr.length; m++) {
      const w = TAU * fr[m] / sr, tau = taus[m] * sr / 1000, a = (amps ? amps[m] : 1) * amp, n = Math.min(o.length - i0, Math.round(tau * 6));
      let ph = rnd() * TAU;
      for (let i = 0; i < n; i++) { ph += w; o[i0 + i] += Math.sin(ph) * Math.exp(-i / tau) * a * (i < 24 ? i / 24 : 1); }
    }
    if (tickAmp) burst(o, sr, t0, tickAmp * amp, 0.05, 0.6, 0.006, { hp: 2500 });
  }
  // mechanical click: resonant noise tick (a part hitting a part)
  function click(o, sr, t0, amp, fc, q, tauMs) {
    burst(o, sr, t0, amp, 0.05, tauMs, tauMs * 0.008, { bp: [fc, q], bpGain: 3 });
  }
  // sine sweep with vibrato: a ricochet's whine
  function whine(o, sr, t0, amp, f0, f1, durS, vib) {
    const i0 = idx(sr, t0), n = Math.min(o.length - i0, idx(sr, durS)); let ph = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n, fr = f0 * Math.pow(f1 / f0, k) * (1 + Math.sin(i / sr * TAU * vib) * 0.012);
      ph += TAU * fr / sr; o[i0 + i] += Math.sin(ph) * amp * Math.min(1, i / (0.004 * sr)) * Math.exp(-k * 3.2);
    }
  }
  // Freeverb-style room: 8 damped combs into 4 allpasses. rt60 in s, damp 0..1, size scales the room.
  function room(dry, sr, rt60, damp, size, preMs) {
    const out = new Float32Array(dry.length), sc = sr / 44100 * (size || 1), pre = Math.round((preMs || 0) * sr / 1000);
    const CD = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(d => Math.round(d * sc)), AD = [556, 441, 341, 225].map(d => Math.round(d * sr / 44100));
    const combs = CD.map(d => ({ b: new Float32Array(d), i: 0, f: 0, g: Math.pow(10, -3 * d / (rt60 * sr)) }));
    const aps = AD.map(d => ({ b: new Float32Array(d), i: 0 }));
    const dmp = damp == null ? 0.4 : damp;
    for (let n = 0; n < dry.length; n++) {
      const x = n >= pre ? dry[n - pre] * 0.12 : 0; let y = 0;
      for (const c of combs) { const v = c.b[c.i]; c.f = v * (1 - dmp) + c.f * dmp; c.b[c.i] = x + c.f * c.g; if (++c.i >= c.b.length) c.i = 0; y += v; }
      for (const a of aps) { const v = a.b[a.i]; const w = y + v * 0.5; a.b[a.i] = w; y = v - w * 0.5 * 1; if (++a.i >= a.b.length) a.i = 0; }
      out[n] = y;
    }
    return out;
  }
  // a slap echo off a far wall: delayed, darker, quieter
  function echo(o, src, sr, ms, gain, lpHz) {
    const D = Math.round(ms * sr / 1000), f = new Svf(sr, lpHz || 2000, 0.6);
    for (let i = 0; i + D < o.length; i++) o[i + D] += f.run(src[i]) * gain;
  }
  // print: DC block, saturate, normalise, fade the end
  function finish(o, sr, drive, peak) {
    let z = 0, px = 0; const a = Math.exp(-TAU * 22 / sr);
    for (let i = 0; i < o.length; i++) { const x = o[i]; const y = x - px + a * z; px = x; z = y; o[i] = y; }
    if (drive) { const kd = Math.tanh(drive); for (let i = 0; i < o.length; i++) o[i] = Math.tanh(o[i] * drive) / kd; }
    let p = 0; for (let i = 0; i < o.length; i++) { const v = Math.abs(o[i]); if (v > p) p = v; }
    const g = p > 0 ? (peak || 0.95) / p : 1, fade = Math.round(0.04 * sr);
    for (let i = 0; i < o.length; i++) { o[i] *= g; const r = o.length - i; if (r < fade) o[i] *= r / fade; }
    return o;
  }
  // dry shot -> + room + echoes -> print
  function space(dry, sr, o) {
    const wet = room(dry, sr, o.rt, o.damp, o.size, o.pre || 9);
    const out = new Float32Array(dry.length);
    // the tail is mid-range: a real room/street echo does not rumble, so high-pass the wet at ~160 Hz
    const a = Math.exp(-TAU * 160 / sr); let lp = 0;
    for (let i = 0; i < dry.length; i++) { lp = wet[i] + a * (lp - wet[i]); out[i] = dry[i] + (wet[i] - lp) * o.mix * 1.25; }
    for (const e of o.echo || []) echo(out, dry, sr, e[0], e[1], e[2]);
    return finish(out, sr, o.drive, o.peak);
  }

  // ---- a gunshot, built in layers so the CRACK stays the loudest instant: the body is driven (recordings
  // clip), the crack is laid on top clean, then the room. P: len, nw (N-wave ms), nw2 [dt ms, amp, ms],
  // cb/ct/chp (crack burst level / tau ms / highpass), bt (body tau ms), bf [start Hz, end Hz, sweep ms],
  // res [Hz, Q, mix], th/tf/tt (thump level, [Hz start, Hz end, sweep ms], tau ms), drive, body (level),
  // mech(o) extra layer, room {rt, damp, size, mix, pre, echo}
  function gunshot(sr, P, k) {
    const L = Math.round(sr * P.len), crack = new Float32Array(L), body = new Float32Array(L);
    nwave(crack, sr, 0.001, 1, P.nw);
    if (P.nw2) nwave(crack, sr, 0.001 + P.nw2[0] / 1000, P.nw2[1], P.nw2[2]);
    burst(crack, sr, 0.001, P.cb, 0.03, P.ct, P.ct * 0.01, { hp: P.chp });
    burst(body, sr, 0.0012, 1, 0.25, P.bt * jit(0.08), P.bt * 0.009, { lp: [P.bf[0], P.bf[1] * k, P.bf[2]], res: [P.res[0] * k, P.res[1], P.res[2]] });
    thump(body, sr, 0.001, P.th, P.tf[0] * k, P.tf[1], P.tf[2], P.tt, 1.3);
    if (P.extra) P.extra(body, sr, k);
    const kd = Math.tanh(P.drive), dry = new Float32Array(L);
    for (let i = 0; i < L; i++) dry[i] = crack[i] * P.crack + Math.tanh(body[i] * P.drive) / kd * P.body;
    if (P.mech) P.mech(dry, sr, k);
    return space(dry, sr, P.room);
  }

  // ---- recipes. Each returns a Float32Array at `sr`. `v` = variant number (seeds + jitter).
  const R = {
    pistol(sr) {
      return gunshot(sr, { len: 0.95, nw: 0.3, cb: 0.9, ct: 1.1, chp: 1600, crack: 0.85,
        bt: 13, bf: [9000, 1500, 18], res: [1400, 1.4, 0.5], th: 0.7, tf: [210, 70, 8], tt: 17, drive: 1.8, body: 0.62,
        mech: (o, sr, k) => { click(o, sr, 0.034, 0.12, 3300 * k, 7, 4); modes(o, sr, 0.035, 0.03, [2900, 4400, 6200].map(x => x * k), [14, 10, 8], null, 0);
                              click(o, sr, 0.068, 0.1, 2600 * k, 6, 5); modes(o, sr, 0.069, 0.025, [2500, 3800], [16, 11], null, 0); },
        room: { rt: 0.9, damp: 0.45, size: 1.15, mix: 0.3, echo: [[135 * jit(0.1), 0.1, 1900], [320, 0.045, 1300]], peak: 0.95 } }, jit(0.05));
    },
    revolver(sr) {
      return gunshot(sr, { len: 1.4, nw: 0.45, cb: 1.0, ct: 1.6, chp: 1300, crack: 0.9,
        bt: 22, bf: [8500, 850, 24], res: [680, 1.2, 0.55], th: 0.85, tf: [160, 52, 11], tt: 30, drive: 2.1, body: 0.75,
        extra: (o, sr, k) => burst(o, sr, 0.0012, 0.3, 0.05, 2.2, 0.025, { bp: [2700 * k, 1.5] }),     // the cylinder-gap spit
        room: { rt: 1.35, damp: 0.5, size: 1.35, mix: 0.36, echo: [[168 * jit(0.1), 0.13, 1600], [390, 0.065, 1100], [680, 0.03, 800]], peak: 0.95 } }, jit(0.05));
    },
    shotgun(sr) {
      return gunshot(sr, { len: 1.6, nw: 0.65, cb: 0.9, ct: 2.2, chp: 1000, crack: 0.8,
        bt: 32, bf: [6500, 480, 34], res: [390, 1.0, 0.6], th: 1.0, tf: [125, 40, 16], tt: 46, drive: 2.4, body: 0.85,
        extra: (o, sr, k) => burst(o, sr, 0.002, 0.45, 2, 55, 0.35, { lp: [360, 200, 50] }),              // the air shove
        room: { rt: 1.55, damp: 0.52, size: 1.45, mix: 0.4, echo: [[186 * jit(0.1), 0.15, 1500], [420, 0.075, 1000], [750, 0.035, 750]], peak: 0.95 } }, jit(0.05));
    },
    smg(sr) {
      return gunshot(sr, { len: 0.45, nw: 0.22, cb: 0.8, ct: 0.8, chp: 2000, crack: 0.8,
        bt: 8, bf: [9500, 2100, 10], res: [1750, 1.5, 0.45], th: 0.55, tf: [240, 95, 6], tt: 11, drive: 1.6, body: 0.55,
        mech: (o, sr, k) => click(o, sr, 0.016, 0.08, 3600 * k, 8, 3),
        room: { rt: 0.5, damp: 0.5, size: 1.0, mix: 0.24, echo: [[118 * jit(0.1), 0.07, 1800]], peak: 0.9 } }, jit(0.07));
    },
    sniper(sr) {
      return gunshot(sr, { len: 2.5, nw: 0.26, nw2: [0.7, -0.5, 0.2], cb: 1.0, ct: 1.0, chp: 2600, crack: 1.0,
        bt: 20, bf: [11000, 950, 20], res: [540, 1.1, 0.5], th: 0.95, tf: [105, 36, 14], tt: 58, drive: 2.2, body: 0.8,
        room: { rt: 2.3, damp: 0.56, size: 1.6, mix: 0.44, pre: 14, echo: [[222, 0.17, 1300], [515, 0.1, 1000], [905, 0.055, 750], [1320, 0.028, 600]], peak: 0.95 } }, jit(0.04));
    },
    rocket(sr) {
      const o = new Float32Array(Math.round(sr * 1.6)), k = jit(0.05);
      burst(o, sr, 0.0, 1.0, 6, 125, 0.9, { lp: [2600, 280 * k, 80], res: [190 * k, 1, 0.5] });
      burst(o, sr, 0.01, 0.4, 25, 480, 1.4, { bp: [3400 * k, 0.9], bpGain: 1.6 });    // the motor's hiss
      thump(o, sr, 0.0, 0.8, 84, 38, 30, 95, 2);
      return space(o, sr, { rt: 1.3, damp: 0.5, size: 1.3, mix: 0.32, echo: [[210, 0.2, 1200]], drive: 2 });
    },
    // ---- the actions
    pump(sr) {                                             // shuck-shuck
      const o = new Float32Array(Math.round(sr * 0.5)), k = jit(0.05);
      burst(o, sr, 0.0, 0.25, 4, 38, 0.12, { bp: [2100 * k, 0.8] });
      click(o, sr, 0.004, 0.6, 1650 * k, 3, 12); modes(o, sr, 0.004, 0.14, [1850, 3100, 4700].map(x => x * k), [26, 18, 12], null, 0);
      burst(o, sr, 0.13, 0.2, 4, 30, 0.1, { bp: [2400 * k, 0.8] });
      click(o, sr, 0.16, 0.75, 2150 * k, 4, 10); modes(o, sr, 0.16, 0.18, [2300, 3700, 5200].map(x => x * k), [32, 22, 14], null, 0);
      return space(o, sr, { rt: 0.28, damp: 0.4, size: 0.7, mix: 0.14, drive: 1.4, peak: 0.7 });
    },
    cock(sr) {                                             // hammer back: click-tick-tick-CLACK
      const o = new Float32Array(Math.round(sr * 0.3)), k = jit(0.05);
      click(o, sr, 0.0, 0.4, 3900 * k, 8, 4); modes(o, sr, 0.0, 0.06, [4100, 6500].map(x => x * k), [12, 8], null, 0);
      click(o, sr, 0.045, 0.15, 5200 * k, 10, 2.5); click(o, sr, 0.058, 0.15, 5100 * k, 10, 2.5);
      click(o, sr, 0.092, 0.55, 3050 * k, 6, 5); modes(o, sr, 0.092, 0.1, [3200, 5100].map(x => x * k), [16, 10], null, 0);
      return space(o, sr, { rt: 0.22, damp: 0.4, size: 0.6, mix: 0.12, drive: 1.3, peak: 0.6 });
    },
    bolt(sr) {                                             // up, back, forward, down
      const o = new Float32Array(Math.round(sr * 0.75)), k = jit(0.04);
      click(o, sr, 0.0, 0.45, 2450 * k, 5, 7); modes(o, sr, 0.0, 0.1, [2600, 4100].map(x => x * k), [22, 14], null, 0);
      burst(o, sr, 0.05, 0.22, 10, 50, 0.14, { bp: [1600 * k, 0.9] });
      click(o, sr, 0.18, 0.5, 2850 * k, 6, 7); modes(o, sr, 0.18, 0.12, [3000, 4700].map(x => x * k), [24, 15], null, 0);
      burst(o, sr, 0.24, 0.2, 8, 40, 0.12, { bp: [1900 * k, 0.9] });
      click(o, sr, 0.36, 0.7, 2050 * k, 4, 9); modes(o, sr, 0.36, 0.16, [2200, 3500, 5000].map(x => x * k), [30, 20, 12], null, 0);
      return space(o, sr, { rt: 0.3, damp: 0.4, size: 0.7, mix: 0.15, drive: 1.4, peak: 0.7 });
    },
    lock(sr) {                                             // the slide / action locks open: empty
      const o = new Float32Array(Math.round(sr * 0.25)), k = jit(0.05);
      click(o, sr, 0.0, 0.5, 2700 * k, 5, 6); modes(o, sr, 0.0, 0.12, [2400, 3900, 5600].map(x => x * k), [28, 18, 11], null, 0);
      click(o, sr, 0.06, 0.25, 4200 * k, 9, 3);
      return space(o, sr, { rt: 0.2, damp: 0.4, size: 0.6, mix: 0.12, drive: 1.2, peak: 0.55 });
    },
    // ---- brass and hulls on the floor
    tink(sr) {
      const o = new Float32Array(Math.round(sr * 0.35)), f1 = 3700 + rnd() * 1100;
      modes(o, sr, 0.0, 0.5, [f1, f1 * 1.63, f1 * 2.46, f1 * 3.08], [95 * jit(0.3), 60, 40, 25], [1, 0.6, 0.35, 0.2], 0.8);
      if (rnd() < 0.6) modes(o, sr, 0.03 + rnd() * 0.04, 0.2, [f1 * 1.02, f1 * 1.66], [50, 30], null, 0.5);
      return finish(o, sr, 1.1, 0.5);
    },
    hull(sr) {
      const o = new Float32Array(Math.round(sr * 0.2)), f1 = 850 + rnd() * 300;
      modes(o, sr, 0.0, 0.5, [f1, f1 * 1.9, f1 * 3.1], [26, 16, 9], [1, 0.5, 0.25], 0.5);
      burst(o, sr, 0.0, 0.3, 0.1, 6, 0.03, { lp: [1800, 900, 10] });
      return finish(o, sr, 1.2, 0.45);
    },
    // ---- the thrown gun
    whoosh(sr) {
      const o = new Float32Array(Math.round(sr * 0.45)), f = new Svf(sr, 700, 1.4), n = o.length;
      for (let i = 0; i < n; i++) {
        const t = i / n; if ((i & 15) === 0) f.set(650 + 1100 * Math.sin(Math.PI * Math.min(1, t * 1.4)), 1.4);
        const env = Math.min(1, t / 0.12) * Math.exp(-Math.max(0, t - 0.12) * 5), am = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.45 * TAU * 13));
        o[i] = f.run(nz()) * env * am;
      }
      return finish(o, sr, 1.2, 0.55);
    },
    bonk(sr) {                                             // a pistol to the head: thud + clank
      const o = new Float32Array(Math.round(sr * 0.6)), k = jit(0.06);
      thump(o, sr, 0.0, 0.9, 165 * k, 72, 8, 34, 2);
      burst(o, sr, 0.0, 0.6, 0.1, 14, 0.08, { lp: [2600, 900, 12] });
      modes(o, sr, 0.001, 0.36, [440, 1170, 1850, 2790, 4010].map(x => x * k * jit(0.02)), [120, 95, 70, 48, 30], [1, 0.75, 0.6, 0.42, 0.25], 0.6);
      return space(o, sr, { rt: 0.35, damp: 0.45, size: 0.8, mix: 0.16, drive: 1.8, peak: 0.85 });
    },
    clat(sr) {                                             // a gun hitting the floor: three knocks
      const o = new Float32Array(Math.round(sr * 0.5)), k = jit(0.08);
      for (const [t, a] of [[0, 1], [0.052, 0.55], [0.11, 0.3]]) {
        modes(o, sr, t, 0.35 * a, [690, 1640, 2880, 4250].map(x => x * k * jit(0.03)), [55, 38, 26, 16], [1, 0.7, 0.45, 0.25], 0.7);
        burst(o, sr, t, 0.35 * a, 0.1, 5, 0.03, { lp: [2200, 800, 6] });
      }
      return space(o, sr, { rt: 0.3, damp: 0.45, size: 0.8, mix: 0.14, drive: 1.5, peak: 0.6 });
    },
    // ---- where the round lands
    impact(sr) {                                           // into concrete / dirt: thwack + grit
      const o = new Float32Array(Math.round(sr * 0.3)), k = jit(0.1);
      burst(o, sr, 0.0, 0.7, 0.05, 7, 0.06, { bp: [2600 * k, 1.1], bpGain: 2.5 });
      burst(o, sr, 0.0, 0.6, 0.2, 18, 0.12, { lp: [1400, 500, 15] });
      for (let i = 0; i < 5; i++) click(o, sr, 0.015 + rnd() * 0.11, 0.1 * rnd(), 3000 + rnd() * 3000, 6, 2);
      return finish(o, sr, 1.6, 0.6);
    },
    ric(sr) {                                              // the odd ricochet
      const o = new Float32Array(Math.round(sr * 0.55)), k = jit(0.12);
      burst(o, sr, 0.0, 0.5, 0.05, 5, 0.04, { hp: 2000 });
      whine(o, sr, 0.004, 0.32, 3400 * k, 1650 * k, 0.42, 28 + rnd() * 10);
      return space(o, sr, { rt: 0.5, damp: 0.5, size: 1.0, mix: 0.2, drive: 1.2, peak: 0.5 });
    },
    flesh(sr) {                                            // a round landing on a fighter: a hard, dull smack
      const o = new Float32Array(Math.round(sr * 0.3)), k = jit(0.08);
      thump(o, sr, 0.0, 0.55, 140 * k, 62, 8, 18, 1.6);
      burst(o, sr, 0.0, 0.9, 0.1, 11, 0.08, { lp: [2400, 700, 10], res: [950 * k, 1.3, 0.5] });
      burst(o, sr, 0.0, 0.45, 0.02, 1.4, 0.012, { hp: 2600 });
      return finish(o, sr, 1.5, 0.8);
    },
    shieldping(sr) {
      const o = new Float32Array(Math.round(sr * 0.4)), k = jit(0.06);
      modes(o, sr, 0.0, 0.4, [1850, 2780, 4150, 5600].map(x => x * k), [110, 80, 55, 35], [1, 0.7, 0.45, 0.25], 0.9);
      return finish(o, sr, 1.2, 0.55);
    },
  };
  const VARIANTS = { pistol: 4, revolver: 3, shotgun: 3, smg: 5, sniper: 2, rocket: 2, pump: 2, cock: 2, bolt: 2, lock: 2, tink: 5, hull: 3,
    whoosh: 2, bonk: 3, clat: 3, impact: 4, ric: 3, flesh: 4, shieldping: 2 };
  // the order the page renders them in: shots first, so they are ready by the first match
  const ORDER = ['pistol', 'shotgun', 'smg', 'revolver', 'sniper', 'flesh', 'impact', 'tink', 'pump', 'cock', 'bolt', 'lock', 'whoosh', 'bonk', 'clat', 'rocket', 'hull', 'ric', 'shieldping'];
  function render(name, v, sr) {
    let h = 7; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    seed(h ^ (v * 0x9E3779B1));
    return R[name](sr);
  }
  return { render, VARIANTS, ORDER, R };
})();

// ================= page: render on unlock, play from the sim's event ring =================
const GunAudio = (() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const G = {
    buf: {}, queue: null, busy: false, cursor: 0, live: 0, lastT: {}, casings3D: false, ready: false,
  };
  const ctxOf = () => (typeof Sfx !== 'undefined' && Sfx.ctx) || null;
  const GA = () => (typeof GameAudio !== 'undefined' && GameAudio && GameAudio.A) || null;
  // render a few buffers per idle slice so the page never hitches
  function pump() {
    const c = ctxOf(); if (!c || !G.queue || !G.queue.length) { G.busy = false; if (G.queue && !G.queue.length) G.ready = true; return; }
    const t0 = performance.now();
    while (G.queue.length && performance.now() - t0 < 12) {
      const [name, v] = G.queue.shift();
      try {
        const d = GNSYN.render(name, v, c.sampleRate), b = c.createBuffer(1, d.length, c.sampleRate);
        if (b.copyToChannel) b.copyToChannel(d, 0); else b.getChannelData(0).set(d);
        (G.buf[name] || (G.buf[name] = [])).push(b);
      } catch (e) { /* a failed render leaves that sound silent, never the game */ }
    }
    const next = () => pump();
    if (window.requestIdleCallback) requestIdleCallback(next, { timeout: 120 }); else setTimeout(next, 16);
  }
  function start() {
    if (G.queue || !ctxOf()) return;
    G.queue = [];
    for (const n of GNSYN.ORDER) for (let v = 0; v < GNSYN.VARIANTS[n]; v++) G.queue.push([n, v]);
    // first variant of every sound before second variants, so a match that starts early has everything
    G.queue.sort((a, b) => a[1] - b[1] || GNSYN.ORDER.indexOf(a[0]) - GNSYN.ORDER.indexOf(b[0]));
    G.busy = true; setTimeout(pump, 30);
  }
  function muted() {
    if (typeof Sfx === 'undefined' || !Sfx.on) return true;
    const A = GA(); return !!(A && A.muted);
  }
  // gameplay sounds are silent behind the title demo and in a fast-forwarded (bet arena) run
  function gameOk() {
    if (muted()) return false;
    try { if (Game.demo) return false; const A = GA(); if (A && A.burst > 6) return false; } catch (e) {}
    return true;
  }
  function panOf(x) { try { return Math.max(-0.8, Math.min(0.8, (x - Game.cam.x) / 650)); } catch (e) { return 0; } }
  // play one sound: vol, pan (from a world x), rate jitter, optional delay (s), and a per-name rate limit
  function play(name, o) {
    o = o || {};
    const c = ctxOf(), list = G.buf[name]; if (!c || !list || !list.length || c.state !== 'running') return null;
    const now = c.currentTime, key = o.key || name, lim = o.limit == null ? 0.012 : o.limit;
    if (G.lastT[key] != null && now - G.lastT[key] < lim) return null;
    if (G.live > 34 && !o.prio) return null;
    G.lastT[key] = now;
    try {
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = list[(Math.random() * list.length) | 0];
      src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * (o.jit == null ? 0.03 : o.jit));
      g.gain.value = o.vol == null ? 1 : o.vol;
      let node = g;
      if (o.x != null && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = panOf(o.x); g.connect(p); node = p; }
      src.connect(g);
      const A = GA(); node.connect((A && A.sfxBus) || Sfx.master || c.destination);
      src.start(now + (o.delay || 0));
      G.live++; src.onended = () => { G.live--; try { src.disconnect(); g.disconnect(); if (node !== g) node.disconnect(); } catch (e) {} };
      return src;
    } catch (e) { return null; }
  }
  // ---- the sim's events -> sound
  const SHOT = { pistol: ['pistol', 0.95], revolver: ['revolver', 1], shotgun: ['shotgun', 1], smg: ['smg', 0.72], sniper: ['sniper', 1], bazooka: ['rocket', 0.9] };
  function onEvent(e) {
    const k = e.k, x = e.x;
    switch (e.type) {
      case 'shot': {
        const s = SHOT[k]; if (!s) break;
        play(s[0], { x, vol: s[1], prio: true, limit: k === 'smg' ? 0.03 : 0.02, key: 'shot' + e.f });
        // without the 3D layer there are no casings to bounce, so the brass comes from here
        if (!G.casings3D && k !== 'bazooka') { play(k === 'shotgun' ? 'hull' : 'tink', { x, vol: 0.35, delay: 0.32 + Math.random() * 0.1, limit: 0.03 }); }
        break;
      }
      case 'mech': play(k, { x, vol: 0.8, limit: 0.05 }); break;
      case 'lock': play('lock', { x, vol: 0.75, delay: 0.06, limit: 0.1 }); break;
      case 'wind': play('lock', { x, vol: 0.35, rate: 1.6, limit: 0.1 }); break;
      case 'pick': if (SHOT[k]) play(k === 'shotgun' ? 'pump' : k === 'sniper' ? 'bolt' : k === 'revolver' ? 'cock' : 'lock', { x, vol: 0.55, rate: 1.1, limit: 0.1 }); break;
      case 'throw': play('whoosh', { x, vol: 0.75, limit: 0.05 }); break;
      case 'bonk': play('bonk', { x, vol: 1, prio: true, limit: 0.05 }); break;
      case 'clat': play('clat', { x, vol: Math.min(1, 0.35 + Math.abs(e.v) * 0.06), limit: 0.06 }); break;
      case 'imp': play('impact', { x, vol: k === 'sniper' ? 0.9 : k === 'shotgun' ? 0.35 : 0.55, limit: 0.025, key: 'imp' });
        if (Math.random() < (k === 'sniper' ? 0.6 : 0.22)) play('ric', { x, vol: 0.5, delay: 0.01, limit: 0.12 });
        break;
      case 'hit': play('flesh', { x, vol: k === 'smg' ? 0.55 : k === 'sniper' || k === 'revolver' || k === 'shotgun' ? 1 : 0.8, limit: 0.02, key: 'hit' }); break;
      case 'blast': play('flesh', { x, vol: 1, rate: 0.8, prio: true, limit: 0.05, key: 'blast' }); break;
      case 'shld': play('shieldping', { x, vol: 0.55, limit: 0.03 }); break;
    }
  }
  function drain() {
    if (typeof GUNS === 'undefined') return;
    const top = GUNS.seq; if (G.cursor >= top) return;
    if (top - G.cursor > GUNS.N_EV - 1) G.cursor = top - (GUNS.N_EV - 1);
    const ok = gameOk() && G.ready !== null;
    for (let s = G.cursor + 1; s <= top; s++) { const e = GUNS.ev[s & (GUNS.N_EV - 1)]; if (ok && e.seq === s) onEvent(e); }
    G.cursor = top;
  }
  // ---- hooks
  const unlock0 = Sfx.unlock;
  Sfx.unlock = function () { const r = unlock0.apply(this, arguments); try { start(); } catch (e) {} return r; };
  // the old gun synth (still called by BLING's pistol, the turret and the non-gun-rules paths) now
  // plays the real thing instead of tones that 12_audio turned into lasers
  const old = { shotgun: Sfx.shotgun, rack: Sfx.rack, pistol: Sfx.pistol, brass: Sfx.brass, slide: Sfx.slide, rocketFire: Sfx.rocketFire, mgunTap: Sfx.mgunTap, sniperShot: Sfx.sniperShot };
  const via = (name, o, k) => function () { if (G.buf[name]) { if (gameOk()) play(name, typeof o === 'function' ? o.apply(null, arguments) : o); return; } if (!G.queue) return old[k].apply(Sfx, arguments); };
  Sfx.shotgun = via('shotgun', { vol: 1, prio: true }, 'shotgun');
  Sfx.rack = via('pump', d => ({ vol: 0.8, delay: d == null ? 0.34 : d }), 'rack');
  Sfx.pistol = via('pistol', { vol: 0.95, prio: true, limit: 0.02 }, 'pistol');
  Sfx.brass = via('tink', d => ({ vol: 0.4, delay: d == null ? 0.26 : d, limit: 0.025 }), 'brass');
  Sfx.slide = via('lock', d => ({ vol: 0.5, delay: d || 0 }), 'slide');
  Sfx.rocketFire = via('rocket', { vol: 0.9 }, 'rocketFire');
  Sfx.mgunTap = via('smg', { vol: 0.7, limit: 0.03 }, 'mgunTap');
  Sfx.sniperShot = via('sniper', { vol: 1, prio: true }, 'sniperShot');
  // a round landing plays its own smack (from the event above): mute the generic punch for it
  let gnHit = 0;
  const hit0 = Sfx.hit;
  Sfx.hit = function () { if (gnHit) return; return hit0.apply(this, arguments); };
  function install() {
    if (typeof Game === 'undefined') return;
    const step0 = Game.step;
    Game.step = function () { const r = step0.apply(this, arguments); try { drain(); } catch (e) {} return r; };
    const onHit0 = Game.onHit;
    Game.onHit = function (v, att, hb) {
      const k = hb && hb.kind; gnHit = (k && typeof GUNS !== 'undefined' && (GUNS.ROUND[k] || k === 'gunthrow') && GUNS.on()) ? 1 : 0;
      try { return onHit0.apply(this, arguments); } finally { gnHit = 0; }
    };
    if (typeof GUNS !== 'undefined') G.cursor = GUNS.seq;
  }
  // after every game file has loaded: Game and GUNS are `const`s further down the same bundle, so even
  // `typeof Game` here at load time would throw (temporal dead zone). 12_audio queued its own install
  // first, so ours wraps outside theirs.
  if (typeof queueMicrotask === 'function') queueMicrotask(install); else setTimeout(install, 0);
  return { G, play, start, drain, get ready() { return G.ready; } };
})();
