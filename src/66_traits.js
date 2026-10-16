// ===== per-fighter identity: stat profiles and one passive nobody else has =====
//
// Duane, 9/20: "each character maybe should have diff stats - Moodeng could have higher HP than the
// rest while being slower. Every character needs something unique... but make it fair."
//
// Two halves:
//   PROFILE  stat changes per fighter. dev/stats_audit.js found 83 pairs of fighters whose whole stat
//            line was within 3% of each other (32 of the 46), i.e. most of the roster felt the same to
//            move around. The table below spreads them out along their own character's axis, and every
//            gain is paid for: faster = lighter or weaker, heavier = slower.
//   TRAIT    one passive each, and no two fighters share a mechanic AND a number. Six mechanics, all
//            small: knockback taken, damage dealt, rage (damage over a damage threshold), run-up speed,
//            air control, shield size, burn resistance, fast-fall and landing lag.
//
// GATED: applied only when `Game.sigs` is on, i.e. unseeded local matches. The bet arena (ARENA.version
// 1) and online lockstep never see any of it - `~/.local/bin/node arena/test/det_node.js` stays at 0
// mismatches. Nothing here uses Math.random; the stat swap happens once per match on the fighter's own
// copy of its character (never on the shared CHARS entry).
const PROFILE = {
  // --- heavies: slower, hit harder, harder to launch ---
  kaiju:    { weight: 134, walk: 4.8, power: 1.14, fall: 13 },   // 9/21: 1.24 while the stat was inert; 69_identity made it real and kaiju went to 80% of 2070 CPU matches. 1.14 -> 76.7%, in line with ape/giga (dev/aaa/identity_audit.js)
  whale:    { weight: 140, walk: 4.6, power: 1.1, jump: 13.2 },
  bear:     { weight: 124, walk: 5.0, power: 1.16 },
  bull:     { weight: 120, walk: 5.2, power: 1.18 },
  moodeng:  { weight: 130, walk: 5.1, power: 1.12, jump: 13.6 },   // Duane's example: tankiest small body
  ape:      { weight: 120, walk: 5.3, power: 1.18 },
  slam:     { weight: 116, walk: 5.6, power: 1.12, jump: 14.2 },
  gigachad: { weight: 112, walk: 6.0, power: 1.14 },
  ember:    { weight: 114, walk: 5.7, power: 1.14 },
  trump:    { weight: 114, walk: 5.4, power: 1.06 },
  clanker:  { weight: 110, walk: 5.6, power: 1.08, grav: 0.7 },
  lobster:  { weight: 108, walk: 5.4, power: 1.14, reach: 1.24 },
  brett:    { weight: 108, walk: 6.0, power: 1.02, jump: 14.2 },
  bling:    { weight: 106, walk: 6.0, power: 1.05 },
  floki:    { weight: 110, walk: 5.5, power: 1.16, reach: 1.12 },
  gwei:     { weight: 102, walk: 5.85, power: 1.06 },
  bonk:     { weight: 100, walk: 6.0, power: 1.14, jump: 15.0 },
  pengu:    { weight: 100, walk: 6.3, power: 1.14 },   // bottom of both round-robins: given some pace. 9/21: 1.08 while the stat was inert; once 69_identity made it real pengu fell to 17.8% of 2070 CPU matches (next worst 28.9%). 1.14 -> 34.4%, roster sd 13.2 -> 12.0
  // --- middleweights: the reference bodies ---
  giga:     { weight: 104, walk: 6.1, power: 1.08 },
  turbo:    { weight: 100, walk: 7.6, power: 1.02 },               // the fastest runner on the roster
  topg:     { weight: 98, walk: 6.6, power: 1.12 },
  pepe:     { weight: 98, walk: 6.6, power: 1.02 },
  ronin:    { weight: 96, walk: 6.3, power: 1.06, reach: 1.24, ai2: [['nb', 'punish'], ['sb', 'dash'], ['db', 'breaker'], ['ub', 'up']] },   // sword set (21_roster2 moves2)
  // 10/15: the lead of the key art played at DOGE's pace on DOGE's reach. He is the rushdown now --
  // second-fastest walk behind TURBO (7.6), the longest arms outside the sword/limb fighters, and
  // real power -- and he pays for it in weight: 100 is dead middleweight, no armour at all. His claw kit, the
  // held sprint and the FERAL state are in 67_unique.js.
  wolverinu:{ weight: 100, walk: 7.3, power: 1.1, reach: 1.22, jump: 15.0, air: 5.2 },
  doge:     { weight: 96, walk: 6.4, power: 1.0 },
  wojak:    { weight: 88, walk: 7.1, power: 0.92, grav: 0.58 },
  mystic:   { weight: 92, walk: 6.4, power: 1.04 },
  wif:      { weight: 94, walk: 6.5, power: 0.98, grav: 0.52, fall: 10 },
  techno:   { weight: 92, walk: 6.4, power: 1.0 },
  fro:      { weight: 90, walk: 6.4, power: 1.06, reach: 1.26 },
  hoodie:   { weight: 90, walk: 7.0, power: 0.95, air: 5.1 },
  tyrant:   { weight: 88, walk: 6.0, power: 1.05, grav: 0.46, air: 5.0 },
  sifu:     { weight: 92, walk: 6.8, power: 1.0, reach: 1.1 },
  bogdanoff:{ weight: 88, walk: 6.6, power: 0.96, air: 5.0 },
  // --- lights: quick, fragile, and they have to work for damage ---
  ginga:    { weight: 84, walk: 7.5, power: 0.92, air: 5.4 },
  omen:     { weight: 86, walk: 6.4, power: 1.06, grav: 0.48 },
  sin:      { weight: 84, walk: 7.0, power: 1.0, grav: 0.54 },
  cheems:   { weight: 80, walk: 7.0, power: 0.9, jump: 15.8 },
  chop:     { weight: 78, walk: 7.4, power: 0.96, reach: 1.06, air: 5.2 },
  fartcoin: { weight: 82, walk: 6.2, power: 0.94, grav: 0.5 },
  shib:     { weight: 80, walk: 7.0, power: 0.95 },
  shroom:   { weight: 80, walk: 6.2, power: 0.98 },
  spark:    { weight: 78, walk: 7.5, power: 0.94, ai2: [['nb', 'zone'], ['db', 'punish'], ['sb', 'dash'], ['ub', 'up']] },   // electric set (21_roster2 moves2)
  cashcat:  { weight: 84, walk: 6.8, power: 0.93 },
  popcat:   { weight: 74, walk: 7.45, power: 0.9, jump: 15.2 },
  mochi:    { weight: 72, walk: 5.8, power: 0.96 },
  wisp:     { weight: 70, walk: 6.8, power: 0.9 },
};

// one passive each. kb = knockback taken, dmg = damage dealt, rage = [own damage %, damage multiplier],
// hunt = [VICTIM's damage %, damage multiplier] -- rage read off the other fighter instead of yourself,
// run = top ground speed after a run-up, airc = air control, shield = shield HP (60 is standard),
// burn = fire damage taken, fall = fast-fall speed, land = landing lag.
const TRAIT = {
  kaiju:    { name: 'Shell Plating', kb: 0.86 },
  whale:    { name: 'Blubber', kb: 0.84 },
  bear:     { name: 'Thick Hide', kb: 0.88 },
  bull:     { name: 'Bull Neck', kb: 0.90 },
  moodeng:  { name: 'Baby Fat', kb: 0.78 },
  slam:     { name: 'Bodyweight', kb: 0.92 },

  gigachad: { name: 'Average Enjoyer', dmg: 1.08 },
  ape:      { name: 'Knuckle Up', dmg: 1.07 },
  bonk:     { name: 'Bat Swing', dmg: 1.09 },
  floki:    { name: 'Axe Master', dmg: 1.05 },
  trump:    { name: 'Big League', dmg: 1.04 },
  gwei:     { name: 'Torque', dmg: 1.06 },
  volt:     { name: 'Live Wire', dmg: 1.03 },

  wojak:    { name: 'Cope Harder', rage: [80, 1.18] },
  sin:      { name: 'No Filter', rage: [90, 1.20] },
  bogdanoff:{ name: 'Dump It', rage: [70, 1.15] },
  topg:     { name: 'Top G Mode', rage: [75, 1.16] },
  tyrant:   { name: 'Final Form', rage: [100, 1.22] },
  giga:     { name: 'Power Up', rage: [70, 1.10] },

  turbo:    { name: 'Redline', run: 1.22 },
  spark:    { name: 'Static Run', run: 1.18 },
  shib:     { name: 'Zoomies', run: 1.14 },
  cheems:   { name: 'Sprint', run: 1.12 },
  popcat:   { name: 'Pop Off', run: 1.16 },
  ginga:    { name: 'Ginga Flow', run: 1.20 },

  wisp:     { name: 'Drifter', airc: 1.35 },
  fartcoin: { name: 'Hot Air', airc: 1.30 },
  mochi:    { name: 'Float', airc: 1.25 },
  omen:     { name: 'Levitate', airc: 1.28 },
  pengu:    { name: 'Belly Glide', airc: 1.20 },
  techno:   { name: 'Thruster', airc: 1.22 },

  brett:    { name: 'Chill Guard', shield: 78 },
  hoodie:   { name: 'Hood Up', shield: 74 },
  clanker:  { name: 'Plating', shield: 82 },
  doge:     { name: 'Such Shield', shield: 70 },
  pepe:     { name: 'Feels Guarded', shield: 72 },

  ember:    { name: 'Fireproof', burn: 0.35 },
  shroom:   { name: 'Spore Skin', burn: 0.60 },
  lobster:  { name: 'Boiled Already', burn: 0.50 },
  sifu:     { name: 'Iron Body', burn: 0.70 },

  chop:     { name: 'Light Feet', land: 0.70 },
  ronin:    { name: 'Swordfooting', land: 0.75 },
  fro:      { name: 'Loose Steps', land: 0.72 },
  mystic:   { name: 'Soft Landing', land: 0.78 },
  bling:    { name: 'Smooth Landing', land: 0.80 },
  cashcat:  { name: 'Cat Landing', land: 0.68 },

  wif:      { name: 'Hat Drop', fall: 1.30 },

  // 10/15: the only passive on the roster that reads the OTHER fighter. WOLVERINU is a hunter, so he
  // is at his worst against a fresh opponent and at his best finishing a hurt one: over 70% damage
  // every claw he lands does 16% more. He also gets a real run-up, because a rushdown that could not
  // run was the whole problem (his held sprint is sb PROWL, 67_unique). Two mechanics in one trait,
  // which nobody else has either -- he is the lead of the key art and the kit is allowed to say so.
  wolverinu:{ name: 'Scent of Blood', hunt: [70, 1.16], run: 1.19 },
};

const TR = {
  disabled: false,                        // dev/tourney.js flips this for an A/B run
  of(f) { return f && f.c && !this.disabled && BAL.on() ? TRAIT[f.c.id] : null; },
  // swap in the fighter's own copy of its character with the local stat profile applied
  profile(f) {
    const p = f && f.c && PROFILE[f.c.id];
    if (!p) return;
    const c = Object.create(Object.getPrototypeOf(f.c) || Object.prototype);
    for (const k in f.c) c[k] = f.c[k];
    for (const k in p) c[k] = p[k];
    c.baseOf = f.c;
    f.c = c;
  },
};

(function () {
  // stat profiles, once per match, on the fighter's own copy
  const start0 = Game.start;
  Game.start = function (slots, stageId, stocks, demo, itemsOn, seed) {
    const r = start0.call(this, slots, stageId, stocks, demo, itemsOn, seed);
    if (this.sigs && !TR.disabled) for (const f of this.fighters) { TR.profile(f); const t = TRAIT[f.c.id]; if (t && t.shield) f.shieldHP = t.shield; }
    return r;
  };

  // damage dealt / knockback taken
  const take0 = Fighter.prototype.takeHit;
  Fighter.prototype.takeHit = function (hb, att, mult, srcX, srcFace) {
    const tv = TR.of(this), ta = TR.of(att);
    if (ta) {
      if (ta.dmg) mult = (mult || 1) * ta.dmg;
      if (ta.rage && att.dmg >= ta.rage[0]) mult = (mult || 1) * ta.rage[1];
      if (ta.hunt && this.dmg >= ta.hunt[0]) mult = (mult || 1) * ta.hunt[1];   // rage read off the VICTIM
    }
    if (tv && tv.kb && hb && (hb.bkb != null || hb.kbg != null)) {
      hb = Object.assign({}, hb, { bkb: (hb.bkb || 0) * tv.kb, kbg: (hb.kbg || 0) * tv.kb });
    }
    return take0.call(this, hb, att, mult, srcX, srcFace);
  };

  // movement passives
  const up0 = Fighter.prototype.update;
  Fighter.prototype.update = function (stage) {
    const r = up0.call(this, stage);
    const t = TR.of(this);
    if (!t || this.state === 'dead' || this.hitlag > 0) return r;
    const dx = this.dirX();
    if (t.run) {                                        // a run-up that keeps building past the walk cap
      if (!this.air && dx && (this.state === 'ground' || this.state === 'land')) {
        this.runT = (this.runT || 0) + (dx === this.runDir ? 1 : -(this.runT || 0));
        this.runDir = dx;
        if (this.runT > 20) {
          const cap = this.c.walk * t.run;
          if (Math.abs(this.vx) < cap) this.vx += dx * 0.14;
        }
      } else { this.runT = 0; }
    }
    if (t.airc && this.air && dx && this.state === 'air') this.vx = approach(this.vx, dx * this.c.air * t.airc, 0.16);
    if (t.fall && this.air && this.in.down && this.vy > 0) this.vy = Math.min(this.c.fall * t.fall, this.vy + 0.35);
    if (t.shield && this.state !== 'shield' && this.shieldHP < t.shield) this.shieldHP = Math.min(t.shield, this.shieldHP + 0.1);
    if (t.land && this.state === 'land' && this.st === 0 && this.landT > 2) this.landT = Math.max(2, Math.round(this.landT * t.land));
    return r;
  };
})();
