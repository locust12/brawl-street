// ===== fighting styles: give every fighter its own normal attacks =====
//
// Duane, 9/23: "Every character kinda has the same attacks, so each character feels too similar.
// So if u change attack styles or styles of play in characters would be good."
//
// He is right, and it is the biggest identity gap left in the game. `baseMoves(c)` in 20_chars.js
// builds ONE table -- jab, 3 tilts, 3 smashes, 5 aerials, grab, throws -- and hands the same one to
// all 46 fighters. The only per-fighter inputs are four scalars (w, h, power, reach), so a heavy and
// a lightweight throw the *same punch* at different sizes. Everything that already differed sat
// somewhere else: stats (66_traits), one signature special (67_unique), the stat->hitbox link
// (69_identity). The fourteen moves you actually press were shared.
//
// This file gives EVERY fighter its own kit (the core twelve on 9/23, the other thirty-four on 9/26): different startup, different active frames,
// different endlag, different reach, different damage and different knockback, per move. Not a
// global multiplier -- a fighter can have the fastest jab in the game AND the worst smash.
//
// GATED exactly like 67_unique: the kit is written to `c.moves2`, which 40_fighter.js only reads
// when `Game.sigs` is on, i.e. never in a seeded fight. The bet arena (ARENA.version 1) and online
// replays run the original shared table untouched. Prove with:
//   ~/.local/bin/node arena/test/det_node.js
// Nothing here uses Math.random, the DOM or wall-clock time; it runs once at load.
//
// `hl` on a move is its HITSTOP WEIGHT (6b_hitstop): the per-hitbox freeze multiplier Sakurai calls
// the dial that makes two hits of equal damage feel different. Ultimate ships 0.5 on multi-hit
// links and 1.8 on Mario's and Fox's jabs. Each fighter's signature move carries one here, so the
// twelve differ in WEIGHT as well as in frames and motion.
//
// STYLE.off = true puts the whole roster back on the shared table (A/B).
//
// ---- the twelve, in one line each -------------------------------------------------------------
//   DOGE      all-rounder      the reference kit; every other style is a departure from this
//   PEPE      rushdown         fastest tilts, tongue reach on ftilt, weak smashes, combo knockback
//   SHIB      hit-and-run      lightest and quickest, lowest damage on the roster, fast smashes
//   BONK      the bat          slowest jab, biggest fsmash arc; commit or don't swing
//   WIF       aerialist        poor on the ground, best aerials in the game, low landing lag
//   PENGU     slider           long belly-slide dtilt + spin dsmash, heavy ground game, bad in air
//   POPCAT    flurry           2-frame jab, tiny damage, huge active windows: a thousand cuts
//   BRETT     boxer            jab and ftilt carry the kit; no low game, mediocre aerials
//   MOODENG   charger          headbutt ftilt/fsmash, strong lows, aerials are a last resort
//   WHALE     superheavy       slowest everything, biggest single hit in the game, huge lag
//   GIGACHAD  KO power         earliest kill smashes; slower than Brett, hits far harder
//   RONIN     disjoint         blade reach: hitboxes pushed out and made thin, clean single hits
// ------------------------------------------------------------------------------------------------

const STYLE = {
  off: false,
  on() { return !STYLE.off && !!Game.sigs; },
};

(function () {
  // ---- tuning helpers -------------------------------------------------------------------------
  // Every field is a MULTIPLIER on what baseMoves already built for this fighter, so the character's
  // own w / h / power / reach stay in the number and 69_identity still composes on top. The two
  // exceptions are frames (`f`, `total`, `iasa`, `charge`), which are absolute, and `ang`/`landLag`.
  function tuneHit(h, t) {
    const o = Object.assign({}, h);
    if (t.f) o.f = [t.f[0], t.f[1]];
    if (t.dmg) o.dmg = h.dmg * t.dmg;
    if (t.x) o.x = h.x * t.x;
    if (t.r) o.r = h.r * t.r;
    if (t.bkb) o.bkb = h.bkb * t.bkb;
    if (t.kbg) o.kbg = h.kbg * t.kbg;
    if (t.ang != null) o.ang = h.ang < 0 ? -Math.abs(t.ang) : t.ang;   // keep spikes pointing down
    if (t.hl) o.hl = t.hl;   // per-hitbox hitstop weight (6b_hitstop)
    return o;
  }
  // moves.throws is not a hits[] move: it is a flat table of four throws, each a bare
  // { dmg, ang, bkb, kbg, dir }. tuneMove bailed on it (no .hits), so a kit could not touch a throw
  // at all until 9/26 -- the header claimed throws were covered and they were not. A kit writes
  // `throws: { f: { dmg: 1.3, kbg: 1.14 }, b: {...}, u: {...}, d: {...} }`, same multipliers.
  function tuneThrows(T, t) {
    const o = Object.assign({}, T);
    for (const k of ['f', 'b', 'u', 'd']) {
      const th = T[k], tt = t[k];
      if (!th || !tt) continue;
      const n = Object.assign({}, th);
      if (tt.dmg) n.dmg = th.dmg * tt.dmg;
      if (tt.bkb) n.bkb = th.bkb * tt.bkb;
      if (tt.kbg) n.kbg = th.kbg * tt.kbg;
      if (tt.ang != null) n.ang = th.ang < 0 ? -Math.abs(tt.ang) : tt.ang;
      o[k] = n;
    }
    return o;
  }
  function tuneMove(m, t) {
    if (m && m.f && m.b && m.u && m.d && !m.hits) return tuneThrows(m, t);   // the throw table
    if (!m || !m.hits || !m.hits.length) return m;   // tick()-driven specials are not ours to touch
    const o = Object.assign({}, m);
    if (t.total) o.total = t.total;
    if (t.iasa) o.iasa = t.iasa;
    if (t.landLag != null && m.landLag != null) o.landLag = Math.max(3, Math.round(m.landLag + t.landLag));
    if (t.charge && m.charge) o.charge = Object.assign({}, m.charge, { at: t.charge });
    o.hits = m.hits.map(h => tuneHit(h, t));
    return o;
  }

  // ---- the kits -------------------------------------------------------------------------------
  // Frame numbers are at 60 Hz. Baseline for reference (20_chars.js baseMoves):
  //   jab 16f (act 3-5) | ftilt 26 (7-10) | utilt 26 (6-10) | dtilt 20 (5-7)
  //   fsmash 50 (14-18) | usmash 44 (10-15) | dsmash 44 (9-12)
  //   nair 34 (5-20) | fair 36 (9-13) | bair 32 (7-10) | uair 30 (6-10) | dair 40 (12-15)
  const KITS = {
    // the reference. Tightened very slightly so "balanced" still feels crisp, nothing else moved.
    doge: {
      jab:    { total: 15, iasa: 10 },
      ftilt:  { f: [7, 10] },
      fsmash: { f: [14, 18], hl: 1.15 },
    },

    // RUSHDOWN. Fast, low commitment, knockback tuned to keep the victim in front of him. The tongue
    // is the one long move he owns; his smashes are the worst of the twelve so the pressure has to pay.
    pepe: {
      jab:    { total: 13, iasa: 8,  f: [2, 4],  dmg: 0.80, bkb: 0.76, kbg: 0.56, hl: 1.7 },
      ftilt:  { total: 29, f: [7, 11], dmg: 0.92, x: 1.52, r: 1.12, ang: 30, kbg: 0.94, hl: 1.25 },  // tongue lash
      utilt:  { total: 23, f: [5, 9],  dmg: 0.90, kbg: 0.82 },
      dtilt:  { total: 17, f: [4, 6],  dmg: 0.88, kbg: 0.84 },
      fsmash: { total: 48, charge: 8, f: [13, 17], dmg: 0.96, kbg: 0.98 },
      usmash: { total: 42, charge: 6, f: [9, 14],  dmg: 0.96, kbg: 0.98 },
      dsmash: { total: 42, charge: 5, f: [8, 11],  dmg: 0.96, kbg: 0.98 },
      nair:   { f: [4, 19], landLag: -2, dmg: 0.92, kbg: 0.88 },
      fair:   { f: [7, 11], landLag: -3, dmg: 0.92, kbg: 0.90 },
      uair:   { f: [5, 9],  landLag: -2, dmg: 0.92 },
    },

    // HIT AND RUN. The quickest kit on the roster and the weakest: nothing Shib throws is a threat on
    // its own, but nothing he throws leaves him standing there either.
    shib: {
      jab:    { total: 13, iasa: 9,  f: [2, 4],  dmg: 0.88, kbg: 0.85, hl: 1.5 },
      ftilt:  { total: 22, f: [6, 9],  dmg: 0.86, kbg: 0.90 },
      utilt:  { total: 22, f: [5, 9],  dmg: 0.88 },
      dtilt:  { total: 17, f: [4, 6],  dmg: 0.88 },
      fsmash: { total: 44, charge: 6, f: [11, 15], dmg: 0.86, kbg: 0.94 },
      usmash: { total: 39, charge: 5, f: [8, 13],  dmg: 0.88, kbg: 0.94 },
      dsmash: { total: 39, charge: 4, f: [7, 10],  dmg: 0.88, kbg: 0.94 },
      nair:   { f: [4, 18], landLag: -2, dmg: 0.90 },
      fair:   { f: [7, 11], landLag: -3, dmg: 0.90 },
      bair:   { f: [6, 9],  landLag: -2, dmg: 0.92 },
      uair:   { f: [5, 9],  landLag: -2, dmg: 0.90 },
      dair:   { f: [10, 13], landLag: -3, dmg: 0.92 },
    },

    // THE BAT. Every swing is a decision. Slowest jab of the twelve, and an fsmash that covers more
    // ground than anything except the whale's.
    bonk: {
      jab:    { total: 20, iasa: 14, f: [5, 7],  dmg: 1.22, bkb: 1.10, kbg: 1.05 },
      ftilt:  { total: 32, f: [10, 14], dmg: 1.26, x: 1.14, r: 1.12, kbg: 1.05 },
      utilt:  { total: 30, f: [8, 13],  dmg: 1.18, r: 1.10 },
      dtilt:  { total: 24, f: [7, 10],  dmg: 1.15 },
      fsmash: { total: 58, charge: 10, f: [18, 23], dmg: 1.34, x: 1.10, r: 1.20, bkb: 1.08, kbg: 1.10, hl: 1.45 },
      usmash: { total: 50, charge: 8,  f: [13, 18], dmg: 1.24, r: 1.12, kbg: 1.06 },
      dsmash: { total: 50, charge: 7,  f: [12, 16], dmg: 1.22, r: 1.12, kbg: 1.06 },
      nair:   { f: [7, 21], landLag: 3, dmg: 1.12 },
      fair:   { f: [12, 16], landLag: 4, dmg: 1.20, kbg: 1.05 },
      bair:   { f: [9, 13],  landLag: 3, dmg: 1.18 },
      uair:   { f: [8, 12],  landLag: 3, dmg: 1.12 },
      dair:   { f: [14, 18], landLag: 4, dmg: 1.18 },
    },

    // AERIALIST. Give up the ground entirely. Best aerials in the game, least landing lag, and a
    // ground kit that cannot close a stock.
    wif: {
      jab:    { total: 17, iasa: 12, dmg: 0.84, kbg: 0.88 },
      ftilt:  { total: 27, f: [8, 11], dmg: 0.80, kbg: 0.88 },
      utilt:  { total: 27, dmg: 0.84 },
      dtilt:  { total: 21, dmg: 0.82 },
      fsmash: { total: 50, charge: 8, dmg: 0.84, kbg: 0.90 },
      usmash: { total: 44, charge: 6, dmg: 0.88, kbg: 0.92 },
      dsmash: { total: 44, charge: 5, dmg: 0.84, kbg: 0.90 },
      nair:   { f: [4, 22], landLag: -2, dmg: 1.06, r: 1.12 },
      fair:   { f: [7, 12], landLag: -3, dmg: 1.10, kbg: 1.04, hl: 1.3 },
      bair:   { f: [6, 10], landLag: -2, dmg: 1.10, kbg: 1.05, hl: 1.3 },
      uair:   { f: [5, 10], landLag: -2, dmg: 1.08, kbg: 1.03 },
      dair:   { f: [10, 14], landLag: -3, dmg: 1.08, kbg: 1.03 },
    },

    // SLIDER. The belly is the kit: a dtilt that travels, a dsmash that covers both sides wide. Heavy
    // and grounded -- the worst air game of the twelve, on purpose.
    pengu: {
      jab:    { total: 16, iasa: 11, dmg: 1.02 },
      ftilt:  { total: 25, f: [6, 9],  dmg: 0.96, r: 1.08 },                                  // flipper slap
      utilt:  { total: 27, f: [6, 11], dmg: 1.02 },
      dtilt:  { total: 26, f: [5, 11], dmg: 1.09, x: 1.65, r: 1.18, ang: 20, kbg: 1.03, hl: 1.35 },     // belly slide
      fsmash: { total: 50, charge: 8, dmg: 1.06, r: 1.08 },
      usmash: { total: 46, charge: 6, dmg: 1.02 },
      dsmash: { total: 46, charge: 5, f: [9, 14], dmg: 1.09, r: 1.24, kbg: 1.04, hl: 1.3 },            // spin
      nair:   { f: [7, 20], landLag: 4, dmg: 0.90 },
      fair:   { f: [11, 15], landLag: 5, dmg: 0.90 },
      bair:   { f: [9, 12],  landLag: 4, dmg: 0.92 },
      uair:   { f: [8, 12],  landLag: 4, dmg: 0.86 },
      dair:   { f: [14, 17], landLag: 6, dmg: 0.90 },
    },

    // FLURRY. A 2-frame jab and the longest active windows in the game, paid for with damage so low
    // that Popcat has to land four things where anyone else lands one.
    popcat: {
      jab:    { total: 11, iasa: 7,  f: [2, 4],  dmg: 0.62, bkb: 0.58, kbg: 0.47, hl: 1.8 },
      ftilt:  { total: 20, f: [5, 8],  dmg: 0.76, kbg: 0.78 },
      utilt:  { total: 21, f: [4, 9],  dmg: 0.82, kbg: 0.82 },
      dtilt:  { total: 16, f: [3, 6],  dmg: 0.76, kbg: 0.78 },
      fsmash: { total: 42, charge: 6, f: [12, 15], dmg: 0.92, kbg: 0.97, hl: 1.4 },
      usmash: { total: 38, charge: 5, f: [9, 14],  dmg: 0.92, kbg: 0.97 },
      dsmash: { total: 38, charge: 4, f: [8, 12],  dmg: 0.92, kbg: 0.97 },
      nair:   { f: [4, 26], landLag: -2, dmg: 0.79, kbg: 0.85 },
      fair:   { f: [6, 12], landLag: -2, dmg: 0.85, kbg: 0.87 },
      bair:   { f: [5, 10], landLag: -2, dmg: 0.87 },
      uair:   { f: [4, 10], landLag: -2, dmg: 0.83 },
      dair:   { f: [9, 14], landLag: -2, dmg: 0.88 },
    },

    // BOXER. Everything lives in the jab and the straight. No low game worth pressing and aerials he
    // would rather not throw.
    brett: {
      jab:    { total: 15, iasa: 10, f: [3, 5], dmg: 1.00, ang: 55, kbg: 1.00, hl: 1.8 },
      ftilt:  { total: 25, f: [6, 9], dmg: 1.02, ang: 30, kbg: 0.93 },                        // straight
      utilt:  { total: 26, dmg: 1.05 },
      dtilt:  { total: 22, f: [6, 8], dmg: 0.86, kbg: 0.90 },
      fsmash: { total: 50, charge: 8, f: [13, 16], dmg: 1.01, bkb: 1.02, kbg: 0.98, hl: 1.35 },         // hook
      usmash: { total: 42, charge: 6, f: [9, 14],  dmg: 1.04 },
      dsmash: { total: 46, charge: 6, dmg: 0.94 },
      nair:   { landLag: 2, dmg: 0.92 },
      fair:   { landLag: 2, dmg: 0.94 },
      bair:   { landLag: 2, dmg: 0.94 },
      uair:   { landLag: 2, dmg: 0.90 },
      dair:   { landLag: 2, dmg: 0.92 },
    },

    // CHARGER. Head first, forward, with weight behind it. Strong lows, and an air game that exists
    // only to get back to the stage.
    moodeng: {
      jab:    { total: 19, iasa: 13, f: [4, 6], dmg: 1.15 },
      ftilt:  { total: 30, f: [9, 13], dmg: 1.24, r: 1.12, ang: 32, kbg: 1.05, hl: 1.4 },              // headbutt
      utilt:  { total: 28, f: [7, 12], dmg: 1.12 },
      dtilt:  { total: 22, f: [5, 8],  dmg: 1.17, kbg: 1.06 },
      fsmash: { total: 52, charge: 9, f: [15, 19], dmg: 1.24, bkb: 1.07, kbg: 1.05 },
      usmash: { total: 46, charge: 6, dmg: 1.12 },
      dsmash: { total: 46, charge: 5, dmg: 1.14 },
      nair:   { f: [7, 20], landLag: 5, dmg: 0.88 },
      fair:   { f: [11, 15], landLag: 6, dmg: 0.90 },
      bair:   { f: [9, 12],  landLag: 6, dmg: 0.82 },
      uair:   { f: [8, 12],  landLag: 5, dmg: 0.84 },
      dair:   { f: [14, 17], landLag: 7, dmg: 0.86 },
    },

    // SUPERHEAVY. The slowest kit in the game and the single biggest hit in it. If the whale's fsmash
    // lands at all, the stock is usually over.
    whale: {
      jab:    { total: 20, iasa: 13, f: [5, 7],  dmg: 1.28, bkb: 1.10, kbg: 1.05 },
      ftilt:  { total: 32, f: [10, 14], dmg: 1.32, x: 1.12, r: 1.18, kbg: 1.05 },
      utilt:  { total: 32, f: [9, 14],  dmg: 1.24, r: 1.14 },
      dtilt:  { total: 26, f: [8, 11],  dmg: 1.20 },
      fsmash: { total: 58, charge: 11, f: [18, 23], dmg: 1.42, x: 1.14, r: 1.28, bkb: 1.12, kbg: 1.10, hl: 1.5 },
      usmash: { total: 51, charge: 8,  f: [13, 18], dmg: 1.30, r: 1.16, kbg: 1.06 },
      dsmash: { total: 51, charge: 7,  f: [12, 16], dmg: 1.28, r: 1.16, kbg: 1.06 },
      nair:   { f: [8, 22],  landLag: 5, dmg: 1.18 },
      fair:   { f: [13, 18], landLag: 6, dmg: 1.24, kbg: 1.05 },
      bair:   { f: [10, 14], landLag: 5, dmg: 1.24, kbg: 1.06 },
      uair:   { f: [9, 13],  landLag: 5, dmg: 1.18 },
      dair:   { f: [15, 19], landLag: 6, dmg: 1.26, kbg: 1.06 },
    },

    // KO POWER. Slower than Brett everywhere, and kills a good twenty per cent earlier. The smashes
    // are the whole character.
    gigachad: {
      jab:    { total: 17, iasa: 12, f: [3, 5], dmg: 1.18 },
      ftilt:  { total: 28, f: [8, 11], dmg: 1.12, ang: 34, kbg: 1.06 },
      utilt:  { total: 28, f: [7, 11], dmg: 1.16, kbg: 1.06 },
      dtilt:  { total: 22, dmg: 1.08 },
      fsmash: { total: 54, charge: 9, f: [16, 20], dmg: 1.22, bkb: 1.06, kbg: 1.12, hl: 1.45 },
      usmash: { total: 48, charge: 7, f: [11, 16], dmg: 1.16, kbg: 1.08 },
      dsmash: { total: 48, charge: 6, f: [10, 14], dmg: 1.20, kbg: 1.10 },
      nair:   { landLag: 3, dmg: 1.08 },
      fair:   { f: [10, 14], landLag: 3, dmg: 1.12, kbg: 1.05 },
      bair:   { f: [8, 11],  landLag: 3, dmg: 1.12, kbg: 1.05 },
      uair:   { landLag: 3, dmg: 1.10 },
      dair:   { f: [13, 16], landLag: 3, dmg: 1.16 },
    },

    // DISJOINT. Every hitbox is pushed out along the blade and made thin -- Ronin reaches further than
    // anyone and hits a narrower slice of air for it. Single clean hits, real endlag.
    ronin: {
      jab:    { total: 17, iasa: 11, f: [4, 6],  dmg: 1.05, x: 1.38, r: 0.94 },
      ftilt:  { total: 28, f: [8, 11], dmg: 1.20, x: 1.42, r: 0.98, kbg: 1.08 },
      utilt:  { total: 28, f: [7, 11], dmg: 1.06, r: 0.96 },
      dtilt:  { total: 22, f: [6, 9],  dmg: 1.04, x: 1.38, r: 0.94 },                          // low sweep
      fsmash: { total: 52, charge: 8, f: [15, 19], dmg: 1.28, x: 1.44, r: 1.00, kbg: 1.12, hl: 1.4 },
      usmash: { total: 46, charge: 6, f: [11, 16], dmg: 1.16, r: 1.00 },
      dsmash: { total: 46, charge: 5, f: [10, 14], dmg: 1.10, x: 1.34, r: 0.96 },
      nair:   { f: [5, 20],  landLag: 1, dmg: 1.02, r: 1.06 },
      fair:   { f: [8, 12],  landLag: 1, dmg: 1.10, x: 1.38, r: 0.94 },
      bair:   { f: [7, 10],  landLag: 1, dmg: 1.12, x: 1.36, r: 0.94 },
      uair:   { f: [6, 10],  landLag: 1, dmg: 1.06, r: 0.96 },
      dair:   { f: [12, 15], landLag: 2, dmg: 1.12, r: 0.96 },
    },

    // ================================================================================================
    // THE OTHER THIRTY (9/26). The core twelve got kits on 9/23; the roster opened to 42 on 9/25 and
    // the new thirty were all still sharing baseMoves -- the exact "every character feels the same"
    // complaint, now across three quarters of the game. Each kit below is built from what the fighter
    // ALREADY IS in 66_traits (weight, walk, power, reach, gravity) so the normals amplify the body
    // rather than argue with it, and each one trades a real strength for a real weakness.
    // ================================================================================================

    // ---- superheavies: slow, enormous, and punished hard for missing -------------------------------
    // KAIJU  Shell King. The heaviest and longest-reaching body on the roster (w128, reach 1.15) and
    // the slowest walk. Everything is late and huge; the reward is the biggest smash in this group.
    kaiju: {
      jab:    { total: 22, iasa: 15, f: [6, 9],  dmg: 1.22, r: 1.10 },
      ftilt:  { total: 36, f: [12, 16], dmg: 1.26, x: 1.16, r: 1.12, kbg: 1.06 },
      utilt:  { total: 34, f: [10, 15], dmg: 1.20, r: 1.14 },
      dtilt:  { total: 30, f: [9, 13],  dmg: 1.16, x: 1.14, r: 1.08 },                       // tail sweep
      fsmash: { total: 62, charge: 11, f: [22, 27], dmg: 1.42, x: 1.18, r: 1.16, kbg: 1.16, hl: 2.1 },
      usmash: { total: 56, charge: 9, f: [17, 23], dmg: 1.30, r: 1.16 },
      dsmash: { total: 54, charge: 8, f: [15, 20], dmg: 1.24, x: 1.16, r: 1.10 },
      nair:   { f: [8, 24], landLag: 6, dmg: 1.18, r: 1.12 },
      fair:   { f: [13, 18], landLag: 7, dmg: 1.26, r: 1.10 },
      dair:   { f: [17, 22], landLag: 9, dmg: 1.30, r: 1.08, hl: 1.6 },                      // shell drop
    },
    // SLAM  Main Eventer, the wrestler. Grabs and throws carry the whole kit; his smashes are ordinary
    // for his weight and his aerials are the worst of the heavies. Get in, or get nothing.
    slam: {
      jab:    { total: 19, iasa: 13, f: [4, 7],  dmg: 1.10 },
      ftilt:  { total: 32, f: [10, 14], dmg: 1.14, x: 1.10 },
      dtilt:  { total: 26, f: [8, 11],  dmg: 1.12, ang: 70 },                                // trip into a grab
      grab:   { total: 30, f: [6, 9],   x: 1.24, r: 1.18 },                                  // the whole point
      throws: { f: { dmg: 1.30, kbg: 1.14 }, b: { dmg: 1.34, kbg: 1.18 },                   // the best throws in the game
                u: { dmg: 1.22, kbg: 1.10 }, d: { dmg: 1.26, kbg: 1.06 } },
      fsmash: { total: 56, charge: 9, f: [18, 22], dmg: 1.18, kbg: 1.04 },
      nair:   { f: [9, 22], landLag: 8, dmg: 1.02 },
      fair:   { f: [14, 18], landLag: 9, dmg: 1.06 },
    },
    // BEAR  Red Candle. A maul: wide, heavy swings with real endlag, and the best dtilt of the heavies.
    bear: {
      jab:    { total: 20, iasa: 14, f: [5, 9],  dmg: 1.16, r: 1.08 },
      ftilt:  { total: 34, f: [11, 16], dmg: 1.22, x: 1.12, r: 1.10, hl: 1.3 },
      utilt:  { total: 32, f: [9, 14],  dmg: 1.14, r: 1.10 },
      dtilt:  { total: 26, f: [7, 12],  dmg: 1.18, x: 1.12, r: 1.08, ang: 28 },
      fsmash: { total: 58, charge: 10, f: [20, 25], dmg: 1.34, x: 1.14, r: 1.12, kbg: 1.12, hl: 1.9 },
      dsmash: { total: 50, charge: 7, f: [13, 18],  dmg: 1.20, x: 1.12, r: 1.06 },
      nair:   { f: [7, 22], landLag: 6, dmg: 1.12, r: 1.08 },
      dair:   { f: [15, 20], landLag: 8, dmg: 1.22, r: 1.06 },
    },
    // BULL  Green Candle. Everything is a horn charge: the strongest forward moves in the game and
    // almost nothing behind or below him.
    bull: {
      jab:    { total: 18, iasa: 12, f: [5, 8],  dmg: 1.14, x: 1.10 },
      ftilt:  { total: 30, f: [9, 14],  dmg: 1.30, x: 1.20, r: 1.06, kbg: 1.10, hl: 1.5 },   // horns
      utilt:  { total: 32, f: [10, 14], dmg: 1.04 },
      dtilt:  { total: 28, f: [9, 12],  dmg: 1.00 },
      fsmash: { total: 56, charge: 9, f: [18, 23], dmg: 1.40, x: 1.24, r: 1.08, kbg: 1.14, hl: 2.0 },
      usmash: { total: 50, charge: 7, f: [14, 19], dmg: 1.08 },
      dsmash: { total: 50, charge: 7, f: [13, 17], dmg: 1.04 },
      bair:   { f: [12, 16], landLag: 7, dmg: 0.94 },                                        // nothing behind
      fair:   { f: [11, 15], landLag: 6, dmg: 1.22, x: 1.16 },
    },
    // TOP G  Alpha Parody. A striker in a heavy body: clean fast hands for his weight, no low game.
    topg: {
      jab:    { total: 14, iasa: 9,  f: [3, 5],  dmg: 1.06, hl: 1.5 },
      ftilt:  { total: 27, f: [7, 10],  dmg: 1.18, x: 1.10, kbg: 1.06 },
      utilt:  { total: 26, f: [6, 10],  dmg: 1.10 },
      dtilt:  { total: 30, f: [11, 14], dmg: 0.92 },                                         // he does not crouch
      fsmash: { total: 52, charge: 8, f: [16, 20], dmg: 1.32, kbg: 1.12, hl: 1.8 },
      usmash: { total: 46, charge: 6, f: [12, 17], dmg: 1.18 },
      nair:   { f: [5, 20], landLag: 5, dmg: 1.08 },
      fair:   { f: [9, 13], landLag: 6, dmg: 1.16 },
    },
    // APE  Bored Ape. Brawler: long arms, wide swings, a real dair, sloppy endlag.
    ape: {
      jab:    { total: 19, iasa: 13, f: [4, 8],  dmg: 1.12, x: 1.12, r: 1.06 },
      ftilt:  { total: 33, f: [10, 15], dmg: 1.20, x: 1.16, r: 1.08 },
      utilt:  { total: 30, f: [8, 13],  dmg: 1.14, r: 1.10 },
      dtilt:  { total: 27, f: [8, 12],  dmg: 1.10, x: 1.12 },
      fsmash: { total: 56, charge: 9, f: [19, 24], dmg: 1.30, x: 1.18, r: 1.10, kbg: 1.10, hl: 1.8 },
      dsmash: { total: 48, charge: 7, f: [12, 17], dmg: 1.16, x: 1.14 },
      dair:   { f: [14, 19], landLag: 8, dmg: 1.26, r: 1.06, hl: 1.5 },
      fair:   { f: [11, 16], landLag: 7, dmg: 1.16, x: 1.14 },
    },
    // LOBSTER  AI Claw. reach 1.20 is the longest on the roster: thin, pushed-out claw hitboxes that
    // win every spacing exchange and lose every scramble.
    lobster: {
      jab:    { total: 20, iasa: 14, f: [5, 7],  dmg: 1.04, x: 1.40, r: 0.88 },
      ftilt:  { total: 33, f: [10, 13], dmg: 1.14, x: 1.52, r: 0.90, kbg: 1.04 },
      utilt:  { total: 30, f: [9, 13],  dmg: 1.06, r: 0.92 },
      dtilt:  { total: 26, f: [8, 11],  dmg: 1.06, x: 1.44, r: 0.88 },
      fsmash: { total: 58, charge: 10, f: [20, 24], dmg: 1.26, x: 1.58, r: 0.92, kbg: 1.10, hl: 1.7 },
      dsmash: { total: 50, charge: 7, f: [13, 17], dmg: 1.12, x: 1.46, r: 0.90 },
      fair:   { f: [10, 14], landLag: 7, dmg: 1.12, x: 1.44, r: 0.90 },
      bair:   { f: [9, 12],  landLag: 7, dmg: 1.14, x: 1.42, r: 0.90 },
    },

    // ---- mid heavies ------------------------------------------------------------------------------
    // EMBER  Wing Blaze. A bird: the aerials are the kit, the ground game is an afterthought.
    ember: {
      jab:    { total: 18, iasa: 12, f: [4, 7], dmg: 0.98 },
      ftilt:  { total: 30, f: [9, 13], dmg: 1.04, r: 1.06 },
      dtilt:  { total: 26, f: [8, 11], dmg: 0.96 },
      fsmash: { total: 54, charge: 9, f: [17, 22], dmg: 1.14, r: 1.08 },
      nair:   { f: [4, 24], landLag: 2, dmg: 1.16, r: 1.14, hl: 1.4 },                       // wing spread
      fair:   { f: [7, 12], landLag: 2, dmg: 1.22, x: 1.14, r: 1.08 },
      bair:   { f: [6, 10], landLag: 2, dmg: 1.24, x: 1.12, r: 1.06, hl: 1.5 },
      uair:   { f: [5, 10], landLag: 2, dmg: 1.18, r: 1.10 },
      dair:   { f: [11, 16], landLag: 4, dmg: 1.20, r: 1.06 },
    },
    // FLOKI  Viking Dog. Axe work: heavy committed swings, a genuine kill fsmash, slow recovery.
    floki: {
      jab:    { total: 19, iasa: 13, f: [5, 8], dmg: 1.10, x: 1.14 },
      ftilt:  { total: 32, f: [10, 14], dmg: 1.20, x: 1.22, r: 0.96, hl: 1.3 },
      utilt:  { total: 30, f: [9, 13], dmg: 1.10, r: 0.98 },
      dtilt:  { total: 26, f: [8, 11], dmg: 1.08, x: 1.16 },
      fsmash: { total: 58, charge: 10, f: [20, 25], dmg: 1.38, x: 1.28, r: 0.98, kbg: 1.14, hl: 2.0 },
      dsmash: { total: 50, charge: 7, f: [13, 18], dmg: 1.14, x: 1.20 },
      fair:   { f: [11, 15], landLag: 6, dmg: 1.18, x: 1.20, r: 0.96 },
      dair:   { f: [14, 18], landLag: 8, dmg: 1.22, x: 1.10 },
    },
    // TURBO  Grand Prix. walk 7.9 is the fastest on the roster and grav 0.74 the heaviest fall: he
    // arrives before anyone else and cannot stay airborne. Fast weak pokes, one real punish.
    turbo: {
      jab:    { total: 12, iasa: 7, f: [2, 4], dmg: 0.86, kbg: 0.78, hl: 1.6 },
      ftilt:  { total: 24, f: [5, 8], dmg: 0.94, kbg: 0.92 },
      utilt:  { total: 22, f: [5, 8], dmg: 0.92 },
      dtilt:  { total: 18, f: [4, 6], dmg: 0.90, kbg: 0.88 },
      fsmash: { total: 46, charge: 6, f: [12, 16], dmg: 1.20, kbg: 1.08, hl: 1.7 },
      usmash: { total: 42, charge: 5, f: [9, 14], dmg: 1.06 },
      dsmash: { total: 40, charge: 5, f: [8, 12], dmg: 1.02 },
      nair:   { f: [4, 17], landLag: 4, dmg: 0.94 },
      dair:   { f: [10, 13], landLag: 6, dmg: 1.14, ang: -80 },                              // dives like a stone
    },
    // CLANKER  Chrome Android. Machined and repeatable: every frame window identical, nothing fast,
    // nothing slow, no flair -- the most PREDICTABLE kit in the game, which is its own identity.
    clanker: {
      jab:    { total: 16, iasa: 11, f: [4, 7], dmg: 1.04, r: 1.04 },
      ftilt:  { total: 28, f: [8, 12], dmg: 1.08, r: 1.04 },
      utilt:  { total: 28, f: [8, 12], dmg: 1.08, r: 1.04 },
      dtilt:  { total: 24, f: [6, 10], dmg: 1.04, r: 1.04 },
      fsmash: { total: 50, charge: 8, f: [16, 20], dmg: 1.18, r: 1.06, kbg: 1.06, hl: 1.4 },
      usmash: { total: 46, charge: 7, f: [13, 17], dmg: 1.14, r: 1.06 },
      dsmash: { total: 46, charge: 7, f: [13, 17], dmg: 1.14, r: 1.06 },
      nair:   { f: [6, 20], landLag: 4, dmg: 1.06 },
      fair:   { f: [9, 13], landLag: 4, dmg: 1.08 },
    },
    // TECHNOKING  Rocket Mogul. Everything wants to launch: high angles, low damage, huge uair.
    techno: {
      jab:    { total: 16, iasa: 11, f: [4, 6], dmg: 0.96 },
      ftilt:  { total: 28, f: [8, 11], dmg: 1.00, ang: 42 },
      utilt:  { total: 24, f: [6, 10], dmg: 1.08, ang: 88, kbg: 1.10 },
      dtilt:  { total: 24, f: [7, 10], dmg: 0.96, ang: 58 },
      usmash: { total: 48, charge: 7, f: [13, 19], dmg: 1.22, kbg: 1.16, hl: 1.8 },          // to the moon
      fsmash: { total: 52, charge: 8, f: [17, 21], dmg: 1.06 },
      uair:   { f: [4, 10], landLag: 3, dmg: 1.18, r: 1.10, kbg: 1.12 },
      nair:   { f: [5, 19], landLag: 4, dmg: 0.98 },
    },

    // ---- mids ---------------------------------------------------------------------------------
    // GINGA  Roda Master. CAPOEIRA: everything rotates. Long spinning kicks from odd angles, almost
    // no punches, and the dsmash is a full floor sweep.
    ginga: {
      jab:    { total: 17, iasa: 11, f: [4, 8], dmg: 0.94, r: 1.08 },
      ftilt:  { total: 29, f: [8, 13], dmg: 1.08, x: 1.24, r: 1.06, ang: 38 },               // au batido
      utilt:  { total: 27, f: [6, 12], dmg: 1.06, r: 1.12, ang: 76 },                        // meia lua
      dtilt:  { total: 23, f: [6, 11], dmg: 1.02, x: 1.20, r: 1.04, ang: 22 },               // rasteira
      fsmash: { total: 50, charge: 7, f: [15, 21], dmg: 1.16, x: 1.22, r: 1.08, kbg: 1.06, hl: 1.5 },
      dsmash: { total: 44, charge: 5, f: [10, 18], dmg: 1.10, x: 1.30, r: 1.08 },            // full sweep
      nair:   { f: [4, 22], landLag: 3, dmg: 1.04, r: 1.12 },
      bair:   { f: [6, 11], landLag: 3, dmg: 1.12, x: 1.18, r: 1.04 },
    },
    // SIFU  Five Animals. Technical: the fastest tilts of the mids, tiny damage, everything links.
    sifu: {
      jab:    { total: 12, iasa: 7, f: [2, 4], dmg: 0.82, bkb: 0.78, kbg: 0.58, hl: 1.7 },
      ftilt:  { total: 22, f: [5, 8], dmg: 0.88, kbg: 0.74 },
      utilt:  { total: 20, f: [4, 7], dmg: 0.86, kbg: 0.72 },
      dtilt:  { total: 16, f: [3, 6], dmg: 0.84, kbg: 0.70 },
      fsmash: { total: 46, charge: 6, f: [13, 17], dmg: 1.02, kbg: 0.96 },
      usmash: { total: 42, charge: 5, f: [10, 15], dmg: 1.00 },
      nair:   { f: [3, 18], landLag: 2, dmg: 0.88, kbg: 0.78 },
      uair:   { f: [4, 8], landLag: 2, dmg: 0.90, kbg: 0.80 },
    },
    // CHOP  Kung Fu Legend. Sifu's louder cousin: same speed philosophy, real damage on the finisher.
    chop: {
      jab:    { total: 13, iasa: 8, f: [3, 5], dmg: 0.88, kbg: 0.66, hl: 1.6 },
      ftilt:  { total: 24, f: [6, 9], dmg: 0.96, kbg: 0.84 },
      utilt:  { total: 22, f: [5, 9], dmg: 0.94 },
      dtilt:  { total: 18, f: [4, 7], dmg: 0.90, kbg: 0.80 },
      fsmash: { total: 48, charge: 7, f: [14, 18], dmg: 1.16, kbg: 1.08, hl: 1.7 },
      dsmash: { total: 42, charge: 5, f: [9, 14], dmg: 1.02 },
      fair:   { f: [6, 10], landLag: 3, dmg: 1.02 },
      dair:   { f: [10, 14], landLag: 5, dmg: 1.10 },
    },
    // HOODIE  Cage Coder. MMA: the best grab game of the mids, clinch damage, poor range.
    hoodie: {
      jab:    { total: 14, iasa: 9, f: [3, 5], dmg: 0.94, hl: 1.4 },
      ftilt:  { total: 26, f: [7, 10], dmg: 1.02, x: 0.94 },
      dtilt:  { total: 22, f: [6, 9], dmg: 1.00, ang: 66 },
      grab:   { total: 28, f: [6, 9], x: 1.14, r: 1.10 },
      throws: { d: { dmg: 1.18, kbg: 0.88 }, f: { dmg: 1.12, kbg: 1.04 } },                  // dthrow into the clinch
      fsmash: { total: 50, charge: 7, f: [15, 19], dmg: 1.12, x: 0.96 },
      nair:   { f: [4, 19], landLag: 4, dmg: 0.98 },
    },
    // MYSTIC  Left Hand. Everything comes from the wrong side: bair and back-facing hits carry it.
    mystic: {
      jab:    { total: 15, iasa: 10, f: [3, 6], dmg: 0.98 },
      ftilt:  { total: 27, f: [8, 11], dmg: 1.00 },
      utilt:  { total: 25, f: [6, 10], dmg: 1.06 },
      dtilt:  { total: 21, f: [5, 8], dmg: 1.00 },
      fsmash: { total: 50, charge: 7, f: [15, 19], dmg: 1.10 },
      dsmash: { total: 44, charge: 5, f: [10, 15], dmg: 1.16, x: 1.14, hl: 1.5 },
      bair:   { f: [5, 10], landLag: 2, dmg: 1.24, x: 1.20, r: 1.06, kbg: 1.12, hl: 1.7 },   // the left hand
      nair:   { f: [5, 20], landLag: 3, dmg: 1.00 },
    },
    // SIN  No Filter. Ninja: the fastest aerials in the game, nothing on the ground, low landing lag.
    sin: {
      jab:    { total: 14, iasa: 9, f: [3, 5], dmg: 0.90 },
      ftilt:  { total: 26, f: [7, 10], dmg: 0.94 },
      dtilt:  { total: 20, f: [5, 8], dmg: 0.92 },
      fsmash: { total: 50, charge: 7, f: [15, 19], dmg: 1.02 },
      nair:   { f: [3, 20], landLag: -3, dmg: 1.04, r: 1.06, hl: 1.4 },
      fair:   { f: [4, 8],  landLag: -3, dmg: 1.10, x: 1.12, r: 1.02 },
      bair:   { f: [4, 8],  landLag: -3, dmg: 1.12, x: 1.10, r: 1.02 },
      uair:   { f: [3, 7],  landLag: -3, dmg: 1.04 },
      dair:   { f: [8, 12], landLag: -1, dmg: 1.14, ang: -80 },
    },
    // TYRANT  Space Emperor. grav 0.52: hangs in the air. Slow floaty aerials that hit like smashes.
    tyrant: {
      jab:    { total: 17, iasa: 12, f: [4, 7], dmg: 1.00 },
      ftilt:  { total: 30, f: [9, 13], dmg: 1.08, r: 1.06 },
      utilt:  { total: 28, f: [8, 12], dmg: 1.06 },
      fsmash: { total: 54, charge: 9, f: [18, 22], dmg: 1.22, kbg: 1.08, hl: 1.7 },
      nair:   { f: [7, 26], landLag: 5, dmg: 1.14, r: 1.10 },
      fair:   { f: [11, 16], landLag: 6, dmg: 1.24, r: 1.06, kbg: 1.10, hl: 1.6 },
      bair:   { f: [10, 14], landLag: 6, dmg: 1.20, r: 1.04 },
      dair:   { f: [15, 20], landLag: 8, dmg: 1.26, hl: 1.5 },
    },
    // GIGA  Limit Breaker. Ordinary until it matters: average everything, enormous usmash.
    giga: {
      jab:    { total: 15, iasa: 10, f: [3, 6], dmg: 1.00 },
      ftilt:  { total: 28, f: [8, 11], dmg: 1.06 },
      utilt:  { total: 25, f: [6, 10], dmg: 1.08 },
      dtilt:  { total: 22, f: [6, 9], dmg: 1.02 },
      usmash: { total: 52, charge: 9, f: [16, 22], dmg: 1.34, kbg: 1.18, hl: 2.0 },
      fsmash: { total: 50, charge: 7, f: [15, 19], dmg: 1.08 },
      uair:   { f: [5, 10], landLag: 3, dmg: 1.12 },
    },
    // WRENCH  Pipe Hero. A length of pipe: blunt, long, slow, and it thuds.
    gwei: {
      jab:    { total: 18, iasa: 12, f: [5, 8], dmg: 1.06, x: 1.20, r: 0.94 },
      ftilt:  { total: 31, f: [10, 14], dmg: 1.16, x: 1.30, r: 0.94, hl: 1.4 },
      utilt:  { total: 29, f: [8, 13], dmg: 1.08, r: 0.96 },
      dtilt:  { total: 25, f: [7, 11], dmg: 1.06, x: 1.24, r: 0.92 },
      fsmash: { total: 54, charge: 9, f: [18, 23], dmg: 1.28, x: 1.34, r: 0.96, kbg: 1.08, hl: 1.9 },
      bair:   { f: [8, 12], landLag: 5, dmg: 1.14, x: 1.26, r: 0.94 },
    },
    // CHEEMS  Suit Shiba. Doge in a suit and it shows: the reference kit, a shade slower, a shade meaner.
    cheems: {
      jab:    { total: 16, iasa: 11, f: [3, 6], dmg: 1.04 },
      ftilt:  { total: 28, f: [8, 11], dmg: 1.08, kbg: 1.04 },
      dtilt:  { total: 23, f: [6, 9], dmg: 1.04 },
      fsmash: { total: 50, charge: 8, f: [16, 20], dmg: 1.16, kbg: 1.06, hl: 1.5 },
      fair:   { f: [8, 12], landLag: 4, dmg: 1.06 },
    },
    // OG BOBBY  Platinum Flow. Showboat: long wind-ups, big payoff, terrible if read.
    bling: {
      jab:    { total: 17, iasa: 12, f: [4, 7], dmg: 1.00 },
      ftilt:  { total: 31, f: [10, 13], dmg: 1.12, kbg: 1.06 },
      fsmash: { total: 58, charge: 11, f: [21, 26], dmg: 1.34, kbg: 1.14, hl: 2.0 },
      dsmash: { total: 48, charge: 7, f: [12, 17], dmg: 1.10, x: 1.12 },
      bair:   { f: [8, 12], landLag: 5, dmg: 1.14 },
    },
    // FARTCOIN  Hot Air. grav 0.54 and it is all buoyancy: weak, floaty, and the dair is a cloud.
    fartcoin: {
      jab:    { total: 15, iasa: 10, f: [3, 6], dmg: 0.88 },
      ftilt:  { total: 27, f: [7, 11], dmg: 0.94 },
      dtilt:  { total: 22, f: [6, 9], dmg: 0.90, ang: 74 },
      fsmash: { total: 50, charge: 7, f: [15, 20], dmg: 1.04 },
      nair:   { f: [5, 24], landLag: 1, dmg: 0.96, r: 1.12 },
      dair:   { f: [9, 18], landLag: 3, dmg: 1.06, r: 1.14, ang: 64, hl: 1.4 },              // the cloud
      uair:   { f: [4, 10], landLag: 1, dmg: 0.94, r: 1.08 },
    },

    // ---- lights -----------------------------------------------------------------------------------
    // WISP  Psi Sprite. w76 and grav 0.42: the lightest, floatiest thing on the roster. Almost no
    // damage, almost no endlag, and it never comes down.
    wisp: {
      jab:    { total: 11, iasa: 6, f: [2, 4], dmg: 0.72, kbg: 0.58, hl: 1.6 },
      ftilt:  { total: 21, f: [4, 7], dmg: 0.78, kbg: 0.70 },
      utilt:  { total: 19, f: [4, 7], dmg: 0.76, kbg: 0.68 },
      dtilt:  { total: 16, f: [3, 6], dmg: 0.74, kbg: 0.66 },
      fsmash: { total: 44, charge: 5, f: [12, 16], dmg: 0.92, kbg: 0.92 },
      nair:   { f: [3, 22], landLag: -3, dmg: 0.80, r: 1.10 },
      fair:   { f: [4, 8], landLag: -3, dmg: 0.82 },
      uair:   { f: [3, 7], landLag: -3, dmg: 0.80 },
    },
    // SPARK  Volt Critter. Tiny and electric: the fastest jab in the game, no reach at all.
    spark: {
      jab:    { total: 10, iasa: 6, f: [2, 3], dmg: 0.74, r: 0.90, kbg: 0.56, hl: 1.8 },
      ftilt:  { total: 20, f: [4, 6], dmg: 0.82, r: 0.92, kbg: 0.72 },
      utilt:  { total: 19, f: [4, 7], dmg: 0.84, r: 0.94 },
      dtilt:  { total: 15, f: [3, 5], dmg: 0.78, r: 0.90, kbg: 0.66 },
      usmash: { total: 40, charge: 5, f: [8, 14], dmg: 1.04, r: 0.96, hl: 1.6 },
      fsmash: { total: 44, charge: 5, f: [11, 15], dmg: 0.94, r: 0.92 },
      nair:   { f: [3, 17], landLag: -1, dmg: 0.80, r: 0.94 },
    },
    // CASHCAT  Sad Money. Quick and scrappy, lowest commitment of the lights, no kill move at all.
    cashcat: {
      jab:    { total: 11, iasa: 7, f: [2, 4], dmg: 0.78, kbg: 0.60, hl: 1.5 },
      ftilt:  { total: 22, f: [5, 7], dmg: 0.84, kbg: 0.76 },
      dtilt:  { total: 16, f: [3, 6], dmg: 0.80, kbg: 0.70 },
      fsmash: { total: 46, charge: 6, f: [13, 17], dmg: 0.94, kbg: 0.90 },
      nair:   { f: [3, 18], landLag: -1, dmg: 0.84 },
      fair:   { f: [5, 9], landLag: -1, dmg: 0.86 },
    },
    // SHROOM  Spore Kid. Lingering hitboxes: nothing hits hard, everything stays out a long time.
    shroom: {
      jab:    { total: 16, iasa: 11, f: [4, 9], dmg: 0.80, kbg: 0.68 },
      ftilt:  { total: 28, f: [7, 15], dmg: 0.88, r: 1.06 },                                 // spore puff
      utilt:  { total: 26, f: [6, 14], dmg: 0.86, r: 1.08 },
      dtilt:  { total: 22, f: [5, 12], dmg: 0.84, r: 1.04 },
      fsmash: { total: 50, charge: 7, f: [14, 24], dmg: 1.00, r: 1.08, hl: 1.4 },
      nair:   { f: [4, 28], landLag: 2, dmg: 0.86, r: 1.10 },
      dair:   { f: [8, 20], landLag: 4, dmg: 0.92, r: 1.06 },
    },
    // WOJAK  Feels Guy. Deliberately unremarkable, and slightly worse than average everywhere except
    // a single desperate dsmash. The joke is the character.
    wojak: {
      jab:    { total: 17, iasa: 12, f: [4, 6], dmg: 0.90 },
      ftilt:  { total: 29, f: [8, 11], dmg: 0.94 },
      utilt:  { total: 27, f: [7, 11], dmg: 0.92 },
      dtilt:  { total: 24, f: [7, 10], dmg: 0.90 },
      dsmash: { total: 46, charge: 6, f: [11, 16], dmg: 1.24, x: 1.14, kbg: 1.12, hl: 1.9 }, // one good day
      fsmash: { total: 52, charge: 8, f: [17, 21], dmg: 0.96 },
      nair:   { f: [6, 19], landLag: 5, dmg: 0.92 },
    },
    // OMEN  Psi Clone. reach 1.10 with grav 0.50: telekinetic, so hitboxes sit OFF the body, thin and
    // far out, and he drifts while they do it.
    omen: {
      jab:    { total: 16, iasa: 11, f: [4, 6], dmg: 0.92, x: 1.34, r: 0.90 },
      ftilt:  { total: 29, f: [8, 12], dmg: 1.02, x: 1.44, r: 0.92 },
      utilt:  { total: 27, f: [7, 11], dmg: 1.00, r: 1.10 },
      dtilt:  { total: 23, f: [6, 9], dmg: 0.96, x: 1.36, r: 0.90 },
      fsmash: { total: 52, charge: 8, f: [16, 21], dmg: 1.14, x: 1.50, r: 0.94, kbg: 1.06, hl: 1.6 },
      nair:   { f: [5, 24], landLag: 2, dmg: 0.98, r: 1.12 },
      fair:   { f: [8, 13], landLag: 2, dmg: 1.06, x: 1.40, r: 0.92 },
    },

    // ---- the four 79_core holds back from the core set ---------------------------------------------
    // They are still pickable from the full select screen, so they get kits too. Duane 9/26: keep every
    // character, decide later who stays -- nobody is being cut, so nobody is left on the shared table.
    // TRUMP  Big Coin Energy. w114: a heavy who only goes forward, and gestures instead of guarding.
    trump: {
      jab:    { total: 18, iasa: 13, f: [5, 8], dmg: 1.08 },
      ftilt:  { total: 31, f: [9, 13], dmg: 1.22, x: 1.16, kbg: 1.08 },
      utilt:  { total: 30, f: [9, 13], dmg: 1.02 },
      dtilt:  { total: 28, f: [9, 12], dmg: 0.96 },
      fsmash: { total: 56, charge: 9, f: [19, 24], dmg: 1.34, x: 1.20, kbg: 1.12, hl: 1.9 },
      nair:   { f: [7, 21], landLag: 6, dmg: 1.00 },
      fair:   { f: [12, 16], landLag: 7, dmg: 1.12, x: 1.14 },
    },
    // MOCHI  Puffball. w72 with the mallet set from 21_roster2: the normals stay tiny so the mallet
    // reads as the payoff, and the aerials float.
    mochi: {
      jab:    { total: 12, iasa: 7, f: [2, 4], dmg: 0.76, kbg: 0.60, hl: 1.6 },
      ftilt:  { total: 22, f: [5, 8], dmg: 0.82, kbg: 0.72 },
      utilt:  { total: 20, f: [4, 7], dmg: 0.80, kbg: 0.70 },
      dtilt:  { total: 17, f: [3, 6], dmg: 0.78, kbg: 0.68 },
      fsmash: { total: 46, charge: 6, f: [13, 17], dmg: 0.96, kbg: 0.94 },
      nair:   { f: [3, 22], landLag: -2, dmg: 0.84, r: 1.10 },
      uair:   { f: [3, 8], landLag: -2, dmg: 0.82 },
    },
    // FRO  Number Two. reach 1.26 is the longest limb set in the whole cast: loose, flailing, far out,
    // and it commits to nothing.
    fro: {
      jab:    { total: 15, iasa: 10, f: [3, 6], dmg: 0.90, x: 1.34, r: 0.88 },
      ftilt:  { total: 28, f: [8, 12], dmg: 1.00, x: 1.48, r: 0.90 },
      utilt:  { total: 26, f: [7, 11], dmg: 0.98, r: 1.12 },
      dtilt:  { total: 22, f: [6, 9], dmg: 0.94, x: 1.38, r: 0.88 },
      fsmash: { total: 52, charge: 8, f: [16, 21], dmg: 1.12, x: 1.52, r: 0.92, kbg: 1.04, hl: 1.5 },
      bair:   { f: [7, 12], landLag: 3, dmg: 1.08, x: 1.44, r: 0.90 },
      fair:   { f: [9, 14], landLag: 3, dmg: 1.06, x: 1.40, r: 0.90 },
    },
    // BOGDANOFF  He Bought? air 5.0 is the best air speed on the roster: a swarm of weak aerials,
    // nothing at all on the ground.
    bogdanoff: {
      jab:    { total: 16, iasa: 11, f: [4, 6], dmg: 0.86 },
      ftilt:  { total: 29, f: [8, 12], dmg: 0.90 },
      dtilt:  { total: 24, f: [7, 10], dmg: 0.88 },
      fsmash: { total: 52, charge: 8, f: [17, 21], dmg: 0.98 },
      nair:   { f: [3, 21], landLag: -3, dmg: 0.94, r: 1.08 },
      fair:   { f: [5, 9], landLag: -3, dmg: 0.98 },
      bair:   { f: [5, 9], landLag: -3, dmg: 1.00 },
      uair:   { f: [4, 8], landLag: -3, dmg: 0.94 },
      dair:   { f: [9, 13], landLag: -1, dmg: 1.02 },
    },
    // WOLVERINU  Circuit Prowl. CLAW NORMALS, and the last fighter on the roster that had none: it ran
    // the shared table, so the partner character played exactly like DOGE. A claw is the last six inches
    // of the limb, not the whole arm, so every box here is pushed OUT (x) and made THIN (r) -- the same
    // disjoint idea as RONIN's blade, but cheap and repeatable instead of clean and single. The cuts
    // come out fast and carry almost no knockback, so they link into each other and into the Prowl dash
    // (sb); the one thing in the kit that kills is the fsmash cross-rake. Nothing here is lightning:
    // `blade` ('#9bf000', 21_roster2) already tints every one of these trails circuit green.
    // 10/15 pass: the shapes above were right and the numbers were timid -- a claw kit that cuts fast
    // and carries no knockback is only worth playing if the cuts actually come out faster than
    // anybody else's and actually link. So: jab 11 frames with iasa 7 (the quickest on the roster) so
    // it rattles, the tilts a frame or two earlier, the smashes and the dive-in cut hit harder, and
    // the aerials autocancel deeper. He is the lead; the normals are allowed to be the best ones.
    wolverinu: {
      jab:    { total: 11, iasa: 7,   f: [2, 4],   dmg: 0.88, x: 1.22, r: 0.78, bkb: 0.72, kbg: 0.52, hl: 1.65 },  // two claws, in and out
      ftilt:  { total: 22, f: [5, 8],   dmg: 1.00, x: 1.40, r: 0.80, ang: 32, kbg: 0.86, hl: 1.2 },                 // the rake: his longest ground poke
      utilt:  { total: 22, f: [4, 8],   dmg: 0.96, x: 1.10, r: 0.90, kbg: 0.78 },                                   // rising claw, keeps them low enough to chase
      dtilt:  { total: 18, f: [4, 7],   dmg: 0.92, x: 1.32, r: 0.78, ang: 14, kbg: 0.74 },                          // claws through the ankles
      fsmash: { total: 50, charge: 9,  f: [14, 18], dmg: 1.26, x: 1.32, r: 0.88, kbg: 1.12, hl: 1.5 },              // cross rake: the kill move
      usmash: { total: 40, charge: 6,  f: [8, 12],  dmg: 1.08, r: 0.94 },
      dsmash: { total: 40, charge: 5,  f: [7, 10],  dmg: 1.06, x: 1.18, r: 0.84 },
      nair:   { f: [4, 20],  landLag: -3, dmg: 0.96, r: 1.08 },                                                     // spin rake, the one wide box he owns
      fair:   { f: [6, 10],  landLag: -4, dmg: 1.12, x: 1.36, r: 0.82, kbg: 1.06, hl: 1.3 },                        // the dive-in cut
      bair:   { f: [5, 9],   landLag: -3, dmg: 1.08, x: 1.24, r: 0.84 },
      uair:   { f: [4, 8],   landLag: -3, dmg: 0.98, r: 0.96 },
      dair:   { f: [9, 13],  landLag: 1,  dmg: 1.10, r: 0.92 },
    },
  };

  STYLE.KITS = KITS;

  // ---- install --------------------------------------------------------------------------------
  // moves2 may already hold a signature special from 67_unique; we only ever add the normals to it,
  // never replace the object wholesale, so both layers survive in either load order.
  STYLE.build = function () {
    if (typeof CHARS === 'undefined') return 0;
    let n = 0;
    for (const c of CHARS) {
      const kit = KITS[c.id];
      if (!kit || !c.moves) continue;
      if (c.moves2pre === undefined) c.moves2pre = c.moves2 || null;   // what 67_unique left, for the A/B
      const out = Object.assign({}, c.moves2pre || c.moves);
      for (const mv in kit) if (c.moves[mv]) out[mv] = tuneMove(c.moves[mv], kit[mv]);
      c.moves2 = out;
      n++;
    }
    return n;
  };
  // STYLE.set(true) puts the whole roster back on the shared table without a reload (A/B: the sim
  // harnesses pass STYLE_OFF=1, dev/aaa/observe.js style).
  STYLE.set = function (off) {
    STYLE.off = !!off;
    if (!off) return STYLE.build();
    let n = 0;
    for (const c of (typeof CHARS === 'undefined' ? [] : CHARS)) {
      if (!KITS[c.id] || c.moves2pre === undefined) continue;
      c.moves2 = c.moves2pre || undefined; n++;
    }
    return n;
  };
  STYLE.count = STYLE.build();
})();
