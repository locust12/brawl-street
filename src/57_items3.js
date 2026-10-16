// ===== items, set 3: the ARSENAL — the weapons you buy, plus two new free ones =====
// Design: docs/ECONOMY.md. Progress: dev/NOTES-economy.md.
//
// FAIRNESS RAIL (the one rule this file exists to enforce):
//   Nothing in here can appear in a wagered or ranked match. Every arsenal kind carries
//   `set: 3, weight: 0`, and `Items2.inSet()` only ever draws kinds with `weight > 0`, so no
//   arsenal weapon can land in the random spawn pool or in a supply crate — not at item set 1
//   (the bet arena), not at item set 2 (local + online). The only way one enters a fight is
//   `Items3.deploy()` / `Items3.grant()`, and both refuse unless `Game.arsenalOn` is true.
//   `Game.arsenalOn` is set by the caller AFTER Game.start and is false for every seeded fight.
//
// DETERMINISM: fight code. Seeded `rand/irand/Rng` only, never Math.random, never the DOM.
//   The bet arena (ARENA.version 1, seeded, itemSet 1) must stay byte-identical: every new kind is
//   set 3 / weight 0, `Items3.update` returns on the first line unless `Game.itemSet >= 2`, and the
//   two hooks this file installs (Items.update, MV2.projStep) are no-ops when their new fields are
//   absent. Proven by `~/.local/bin/node arena/test/det_node.js`.
//
// Hooks used (all already provided by 55/56): def.tick(it,G,st) return true = own motion,
//   def.after(it) after an explosion, def.pick(f,it) on pickup, def.use(f,it) attack while held,
//   def.hittable(it,a,h), def.lob, def.shootable, def.cool, def.impact, def.throwable.

Object.assign(ITEM_DEFS, {
  // ---- two NEW FREE weapons. These replace banana + holy in the random pool (below), so casual
  // matches keep the same number of things to find after the two paid ones moved to the store.
  // `fuse` must live on the DEF, not just the instance: Items.update clears `armed` on landing for
  // anything whose def has no fuse, and a disarmed stick of dynamite never counts down.
  dyna:  { name: 'Dynamite', r: 19, weight: 2.2, set: 2, shootable: true, icon: '🧨', fuse: 200,
           use: (f, it) => Items3.place(f, it, {}), hittable: (it, a) => Items2.setOff(it, a),
           boom: { r: 165, dmg: 30, bkb: 90, kbg: 105 } },
  pan:   { name: 'Frying Pan', r: 20, weight: 1.8, set: 2, ammo: 3, cool: 26, icon: '🍳', use: (f, it) => Items3.swing(f, it, 'pan') },

  // ================= THE ARSENAL: every kind below is weight 0 and can NEVER spawn =================
  // $15 tier — cheap, high personality, low power
  // ================= THE SHELF, REBUILT 15 OCT =================
  // Duane: *"its just a copy of worms, thats not what i told you to do ... remove banana peel as a
  // weapon and other direct idiotic copies of worms, the sheep has to go too and the statue"*.
  // He was right and the code said it out loud: there was a bundle whose id was literally `bnd_worms`.
  //
  // Eleven items are gone: Banana Peel, Prod, Cluster Bomb, Sheep, Homing Missile, Mole Bomb,
  // Airstrike, Concrete Donkey, Armageddon, Banana Bomb, Holy Hand Grenade. Every one of them is a
  // Worms weapon, and Worms is turn-based artillery, not a platform fighter.
  //
  // What replaced them, checked against the genre rather than invented:
  //   * BRAWLHALLA is nothing but melee archetypes -- Spear, Axe, Scythe, Cannon, Battle Boots,
  //     Chakram -- so five of the replacements are those, built on the same `sword:` buff the
  //     Greatsword already uses. No new systems.
  //   * SMASH supplies the item classes: a thrown explosive (Bob-omb), a proximity trap
  //     (Motion-Sensor Bomb), a burying trap (Pitfall).
  //   * Rivals of Aether II and MultiVersus were checked too and have NO pickup arsenal at all --
  //     they are pure moveset fighters -- so there was nothing there to copy.
  // Then every one was renamed into Brawl Street's own world: a street fight, not a fantasy tourney.
  // Rebar, not Spear. Fire Axe, not Axe. Manhole, not Pitfall. Wrecking Ball, not a concrete donkey.

  gloves:  { name: 'Boxing Gloves', r: 24, weight: 0, set: 3, icon: '\u{1F94A}',
             sword: { reach: 12, dmg: 2.05, kb: 1.72, slow: 3, color: '#ff5a3c' },
             feelSword: { reach: 10, dmg: 1.5, kb: 1.3, slow: 3, color: '#ff5a3c', hits: 10 } },
  bat:     { name: 'Slugger', r: 28, weight: 0, set: 3, icon: '\u{1F3CF}',
             // `hits` is the DEFAULT-path durability (41_combat), not the Game.feel one. Without it
             // the card's "Four swings, then it is gone" was never enforced and the bat lasted the
             // whole stock, which made the $14.99 finisher worse value than the $3.99 Fire Axe.
             sword: { reach: 50, dmg: 3.15, kb: 3.4, slow: 13, hits: 4, color: '#e8d6a8' },
             feelSword: { reach: 44, dmg: 2.1, kb: 2.3, slow: 13, color: '#e8d6a8', hits: 4 } },

  // RECOVERY. Every fighter in the genre has one and we had none on the shelf at all: Smash has the
  // Maxim Tomato and the Heart Container, Brawlhalla has none because it has no damage to heal.
  // `instant` + `pick` is the same path the HODL Heart uses (55_items.js).
  medkit:  { name: 'Med Kit', r: 18, weight: 0, set: 3, instant: true, icon: '\u{1FA79}',
             pick: (f) => { const heal = Math.min(f.dmg, 45); if (heal <= 0) return false; f.dmg -= heal;
               Game.text(f.x, f.y - f.h - 20, '-' + Math.round(heal) + '%', '#6dff8c', 1.1);
               for (let i = 0; i < 16; i++) Game.parts.push({ x: f.x + rand(-18, 18), y: f.y - rand(0, f.h), vx: rand(-1, 1), vy: rand(-3, -1), life: 34, max: 34, color: '#6dff8c', size: rand(4, 8), g: 0 });
               return true; } },

  // BOXING GLOVES, Duane 2026-10-14: *"big boxing gloves? so ppl can super punch with it"*.
  // No `use` and no ammo: like the swords in set 1, these buff every normal while they are held
  // (40_fighter startMove -> swordify). Barely any extra reach, because a fist is not a blade -- what
  // they buy is the hardest hit in the game and knockback that actually launches people, which is the
  // whole point of the thing. `slow` keeps them off being strictly better than everything.
  zip:     { name: 'Zip Hook', r: 18, weight: 0, set: 3, ammo: 3, cool: 30, icon: '🪝', use: (f, it) => Items3.zip(f, it) },

  // $20–50 tier — the shadowed shelf
  boots:   { name: 'Nitro Boots', r: 20, weight: 0, set: 3, delay: 1200, ammo: 2, cool: 60, icon: '🥾', use: (f, it) => Items3.boots(f, it) },
  thunder: { name: 'Thunderbolt', r: 24, weight: 0, set: 3, delay: 2400, ammo: 2, cool: 86, icon: '\u{26A1}', use: (f, it) => Items3.gun(f, it, I3_BOLT) },
  flamer:  { name: 'Flamethrower', r: 22, weight: 0, set: 3, delay: 1200, ammo: 2, cool: 80, icon: '🔥', use: (f, it) => Items3.gun(f, it, I3_FLAME) },
  aegis:   { name: 'Riot Drone', r: 18, weight: 0, set: 3, delay: 2400, instant: true, icon: '🛰️', pick: f => Items3.giveAegis(f) },
  freeze:  { name: 'Taser', r: 22, weight: 0, set: 3, delay: 2400, ammo: 2, cool: 75, icon: '❄️', use: (f, it) => Items3.gun(f, it, I3_FREEZE) },
  turret:  { name: 'Sentry Turret', r: 22, weight: 0, set: 3, delay: 2400, icon: '🔫', use: (f, it) => Items3.place(f, it, { life: 460, hp: 26 }),
             tick: (it, G, st) => Items3.turretTick(it, G, st), hittable: (it, a, h) => Items3.hurt(it, a, h) },
  well:    { name: 'Vortex Grenade', r: 20, weight: 0, set: 3, delay: 2400, icon: '🕳️', use: (f, it) => Items3.place(f, it, { pull: 1, life: 200 }),
             // $9.99. It drags everything in and THEN goes off, so the burst has to pay for the
             // setup: 18 damage was less than a free Grenade. Biggest radius on the shelf.
             tick: (it, G) => Items3.wellTick(it, G), boom: { r: 196, dmg: 32, bkb: 118, kbg: 122 } },

  // ---- melee: the five Brawlhalla archetypes, as street objects ----
  fireaxe: { name: 'Fire Axe', r: 26, weight: 0, set: 3, icon: '\u{1FA93}',
             sword: { reach: 42, dmg: 2.1, kb: 1.9, slow: 8, hits: 6, color: '#d4341f' },
             feelSword: { reach: 38, dmg: 1.5, kb: 1.3, slow: 8, color: '#d4341f', hits: 6 } },
  pipegun: { name: 'Pipe Cannon', r: 28, weight: 0, set: 3, delay: 2400, icon: '\u{1F6E2}\uFE0F',
             sword: { reach: 52, dmg: 2.75, kb: 2.95, slow: 11, hits: 5, color: '#e0922e' },
             feelSword: { reach: 46, dmg: 1.7, kb: 1.5, slow: 11, color: '#e0922e', hits: 5 } },

  // ---- thrown and placed: Smash's item classes, as street hardware ----
  pipebomb:{ name: 'Pipe Bomb', r: 18, weight: 0, set: 3, delay: 1200, throwable: true, lob: true,
             shootable: true, fuse: 90, icon: '\u{1F4A3}',
             // $3.99. WAS 104/15/62, which is under the free Grenade (100/16/62) and barely half a
             // free Dynamite (165/30/90). You cannot sell a weapon that loses to the one lying on
             // the floor. On par with TNT now, which is what a pipe bomb should be.
             boom: { r: 152, dmg: 26, bkb: 84, kbg: 102 } },
  mine:    { name: 'Detonator', r: 16, weight: 0, set: 3, delay: 1200, ammo: 2, cool: 24, icon: '\u{1F4E1}',
             use: (f, it) => Items3.detonator(f, it), shootable: true,
             // $3.99, TWO charges and you pick the moment, so slightly under the Pipe Bomb each but
             // far more total damage in a round. Was 118/20/74: under free TNT.
             boom: { r: 148, dmg: 25, bkb: 84, kbg: 100 } },
  manhole: { name: 'Bear Trap', r: 20, weight: 0, set: 3, delay: 2400, icon: '\u{1F573}\uFE0F',
             use: (f, it) => Items3.place(f, it, { life: 900, arm: 24 }),
             tick: (it, G, st) => Items3.manholeTick(it, G, st) },

  // ---- the finisher. Reuses the mark-a-lane machinery, with a demolition ball on the end of it. ----
  wreck:   { name: 'Wrecking Ball', r: 26, weight: 0, set: 3, delay: 5400, icon: '\u{1F3D7}\uFE0F',
             use: (f, it) => Items3.aimStart(f, it, 'wreck') },

  // ================= FOUR NEW WEAPONS, 2026-10-16 =================
  // Duane: "add more weapons". Picked for the HOLES in the shelf rather than for being more of what
  // is already there, which is the mistake the Worms copies were ([[weapon-catalogue-design]]):
  //   * there was no cheap LONG-REACH melee at all. Every cheap melee was a short heavy swing.
  //   * there was no weapon with reach as its whole identity (Brawlhalla's Scythe slot).
  //   * every automatic was a bullet hose; nothing chipped through a shield.
  //   * nothing you throw came BACK, so there was no reason to ever miss on purpose.
  // Each one is built out of machinery that already works -- a sword def, a gun def, a throwable --
  // so none of this is new fight code, which is why it can ship without a balance season.

  // REBAR: Brawlhalla's Spear. The cheapest thing on the shelf and the longest reach under $4,
  // because a length of bar off a building site is exactly that. Fast, thin, almost no knockback.
  rebar:   { name: 'Rebar', r: 24, weight: 0, set: 3, icon: '\u{1F9EF}',
             sword: { reach: 62, dmg: 1.55, kb: 1.15, slow: 4, hits: 8, color: '#9a6a3a' },
             feelSword: { reach: 56, dmg: 1.2, kb: 1.0, slow: 4, color: '#9a6a3a', hits: 8 } },

  // CHAIN WHIP: Brawlhalla's Scythe. The longest reach in the game, full stop, and it pays for it
  // with the slowest swing on the melee shelf and knockback that sends rather than kills.
  chain:   { name: 'Chain Whip', r: 26, weight: 0, set: 3, delay: 1200, icon: '\u{26D3}\uFE0F',
             sword: { reach: 86, dmg: 1.95, kb: 2.3, slow: 16, hits: 5, color: '#8d97a6' },
             feelSword: { reach: 78, dmg: 1.5, kb: 1.9, slow: 16, color: '#8d97a6', hits: 5 } },

  // NAIL GUN: the chip weapon. Nothing else on the shelf eats a shield, and a tool that fires
  // fasteners is the one thing that obviously should.
  nailgun: { name: 'Nail Gun', r: 20, weight: 0, set: 3, delay: 1200, ammo: 2, cool: 60, icon: '\u{1FA9B}',
             use: (f, it) => Items3.gun(f, it, { total: 64, clip: 'punch', gunAnim: true, fx: 'burst', sfx: 'none',
               tick(f2, t) { Items3.nailTick(f2, t); } }) },

  // BUZZSAW: Brawlhalla's Chakram. It comes BACK, which is the only reason on this shelf to throw
  // something past them on purpose: it hits on the way out and again on the way home.
  buzzsaw: { name: 'Buzzsaw', r: 20, weight: 0, set: 3, delay: 1200, ammo: 2, cool: 48, icon: '\u{1FA9A}',
             use: (f, it) => Items3.buzz(f, it) },
});
// WEAPON DELAY: a weapon is locked for the first N frames of a round, priced against how much it
// swings a fight. The Wrecking Ball cannot appear in the opening exchange; Rebar can.

// DELAY and crate chance — and the delay (a turn-count lock before a weapon becomes available) is
// priced against power: Mole Bomb 0 turns, Sheep 1, Homing Pigeon 2, HOLY HAND GRENADE 4, Super
// Sheep 7. It is the reason a Holy Hand Grenade can be absurd without being broken. Ours is a
// wall-clock lock in frames, on the same curve: cheap tools from the first second, the $20-35 shelf
// at 20 s, the $40-50 shelf at 40 s, and the two $100 finishers at 90 s.

// ---- PRACTICE: every market weapon free, and back in the random drops (9/22) ----
// Duane: "bring back the banana grenades and the holy grenades, make them free. just add all the
// weapons you have in the market for free so we can practice with them first."
// So for now: each of them drops from supply crates in ordinary (unseeded) matches, with no warm-up
// lock, and Econ.owns() treats all of them as owned (89_econ.js), so the arsenal and store show them
// unlocked. Set 2 is the pool unseeded matches draw from; the seeded bet arena draws set 1 only, so
// it never sees any of these and its replays are unchanged. Flip PRACTICE_FREE to false to go back
// to the paid shop exactly as it was.
// OFF 2026-10-16, on Duane's word, the day the crypto checkout went in (docs/PAYMENTS.md): the shop
// cannot sell a weapon it is also giving away, and `Econ.owns()` was answering "you already own it"
// for all 22. Turning it off does TWO things, which is worth knowing before turning it back on:
//   1. the shop sells them again (this is the point), and
//   2. they stop dropping from supply crates in ordinary matches, because the block below is what
//      put them in set 2 at weight 2 with no warm-up lock.
// A bought weapon reaches a fight through the ARSENAL (three slots, casual and party only), which
// is the economy as designed; the seeded bet arena never saw any of this either way.
const PRACTICE_FREE = false;
const PRACTICE_WEAPONS = ['zip', 'boots', 'flamer', 'aegis', 'freeze', 'turret', 'well',
  'gloves', 'bat', 'medkit', 'thunder', 'bolt', 'blaster', 'bow', 'sweeper',
  'fireaxe', 'pipegun', 'pipebomb', 'mine', 'manhole', 'wreck', 'deagle'];   // the gloves are a shop weapon like the rest, so practice hands them out too
if (PRACTICE_FREE) for (const k of PRACTICE_WEAPONS) {
  const d = ITEM_DEFS[k]; if (!d) continue;
  d.weight = 2; d.set = 2; d.delay = 0;
}

// ---- move defs. `sfx:'none'` keeps 40_fighter from playing a generic swing over our own sound.
const I3_PAN = { total: 34, clip: 'punch', reflect: [4, 16], weapon: '#c8ccd4', sfx: 'none',
  hits: [H(6, 11, 46, -46, 30, 14, 44, 58, 94, { radial: false })] };
const I3_PROD = { total: 22, clip: 'punch', sfx: 'none',
  hits: [H(4, 7, 40, -44, 20, 1, 6, 74, 4)] };            // 1% damage, enormous flat shove: a ring-out tool
const I3_FLAME = { total: 78, clip: 'punch', gunAnim: true, fx: 'burst', sfx: 'none', tick(f, t) { Items3.flameTick(f, t); } };
// QUAKE's Thunderbolt: a CONTINUOUS beam, not a projectile you lead. It holds you in place while it
// fires and eats its charge fast, which is the trade the original made too.
const I3_BOLT = { total: 84, clip: 'punch', gunAnim: true, fx: 'scope', sfx: 'none', tick(f, t) { Items3.boltTick(f, t); } };
const I3_FREEZE = { total: 52, clip: 'punch', gunAnim: true, fx: 'scope', sfx: 'none', tick(f, t) { Items3.freezeTick(f, t); } };
const I3_BOOTS = { total: 46, clip: 'punch', sfx: 'none', tick(f, t) { Items3.bootsTick(f, t); },
  hits: [H(8, 34, 26, -44, 30, 6, 40, 46, 70, { radial: true, rehit: 12 })] };
const I3_AIM = { total: 210, clip: 'idle', sfx: 'none', tick(f, t) { Items3.aimTick(f, t); } };
const I3_ZIP = { total: 26, clip: 'punch', sfx: 'none' };

const Items3 = {
  game: null, strikes: [], rain: null, drops: null,

  // ---------- match lifecycle (no edit to Game.start needed: we notice a new fighter array) ----------
  fresh(G) {
    this.game = G.fighters;
    this.strikes = []; this.rain = null;
    // scheduled loadout drops for online casual (see "how a bought weapon enters a fight" below)
    const L = G.arsenalOn && Array.isArray(G.loadouts) ? G.loadouts : null;
    // sorted by weapon delay, so the cheap tools arrive first and the finishers last — the same
    // shape as the live panel's delay gate, and deterministic (a stable sort on fixed numbers).
    this.drops = L ? L.map(a => (Array.isArray(a)
      ? a.filter(k => ITEM_DEFS[k]).slice(0, 3).map((k, i) => [k, (ITEM_DEFS[k].delay || 0) * 100 + i]).sort((p, q) => p[1] - q[1]).map(p => p[0])
      : [])) : null;
    this.dropT = 150;
  },

  // ---------- the ONLY two doors a bought weapon can come through ----------
  // 1. deploy(): the in-match arsenal panel (local matches). Puts the weapon straight in your hand.
  //    Refuses in every seeded fight, with no arsenal, on cooldown, or with something already held.
  deploy(f, kind) {
    const G = Game, def = ITEM_DEFS[kind];
    if (!G.arsenalOn || !def || !f || f.state === 'dead' || G.countdown > 0 || G.endT) return false;
    if (!f.arsenal) return false;
    const slot = f.arsenal.find(s => s.kind === kind && s.n > 0);
    if (!slot || f.arsCd > 0) return false;
    if (G.frame < (def.delay || 0)) return false;   // weapon delay (see the note by ITEM_DEFS.holy.delay)
    if (f.item || f.state === 'hammer' || f.state === 'final') return false;
    slot.n--; f.arsCd = this.COOL;
    this.give(f, kind);
    G.text(f.x, f.y - f.h - 34, def.name.toUpperCase(), '#ffd45c', 1.2);
    return true;
  },
  COOL: 420,   // 7 s between deploys. Stops a full arsenal being dumped in one window.
  // 2. grant(): the deterministic online-casual path. The equipped loadout drops next to its owner on
  //    a fixed clock, so both pages and the server produce the identical fight from cfg alone.
  give(f, kind) {
    const def = ITEM_DEFS[kind];
    if (def.instant) { if (def.pick) def.pick(f, { kind }); return; }
    f.item = { kind, ammo: def.ammo || 0, fuse: def.fuse, cd: 0 };
    Game.ring(f.x, f.y - f.h * 0.5, '#ffd45c', 64); Sfx.coin();
  },
  drop(f, kind) {
    const def = ITEM_DEFS[kind], G = Game;
    G.items.push({ kind, x: f.x, y: G.stage.blast.t + 150, vx: 0, vy: 0, age: 0, hp: def.hp || 0, ammo: def.ammo || 0, fuse: def.fuse, mine: f.idx });
    G.ring(f.x, G.stage.blast.t + 200, '#ffd45c', 50);
    G.text(f.x, f.y - f.h - 40, 'LOADOUT', '#ffd45c', 1);
  },

  // ---------- per frame (called at the very end of Items.update; set-2+ only) ----------
  update(G, st) {
    if (this.game !== G.fighters) this.fresh(G);
    for (const f of G.fighters) {
      if (f.arsCd > 0) f.arsCd--;
      if (f.slipT > 0) f.slipT--;
      if (f.bumpT > 0) f.bumpT--;
      if (f.state === 'dead') { f.aegis = 0; f.frozen = 0; continue; }
      if (f.frozen > 0) this.frozenTick(f, G);
      if (f.aegis > 0) this.aegisTick(f, G);
    }
    this.strikeTick(G, st);
    if (this.rain) this.rainTick(G, st);
    if (this.drops) this.dropTick(G);
  },
  // online lockstep can't carry a mouse position, so the click-to-aim shortcut is local matches only
  local(G) { return !G.fighters.some(f => typeof f.ctrl === 'string' && f.ctrl.indexOf('net') === 0); },
  // online casual: one equipped weapon lands beside its owner every 20 s, in loadout order
  dropTick(G) {
    if (G.countdown > 0 || G.endT) return;
    if (--this.dropT > 0) return;
    this.dropT = 1200;
    for (let i = 0; i < this.drops.length; i++) {
      const list = this.drops[i], f = G.fighters[i];
      if (!list || !list.length || !f || f.state === 'dead') continue;
      if (G.frame < (ITEM_DEFS[list[0]].delay || 0)) continue;   // still locked: it waits for the next window
      this.drop(f, list.shift());
    }
  },

  // ---------- shared helpers ----------
  // put what you hold on the ground as a live, armed device
  place(f, it, extra) {
    const G = Game, def = ITEM_DEFS[it.kind];
    G.items.push(Object.assign({ kind: it.kind, x: f.x + f.face * f.w * 0.3, y: f.y - 2, vx: 0, vy: f.air ? 2 : 0,
      age: 0, armed: true, thrownBy: f, owner: f.idx, hp: def.hp || 0, ammo: 0, face: f.face,
      fuse: def.fuse != null ? (it.fuse != null ? it.fuse : def.fuse) : undefined }, extra || {}));
    f.item = null; f.startMove({ total: 14, throwAnim: 'f' });
    G.text(f.x, f.y - f.h - 24, def.name.toUpperCase(), '#ffd45c', 1);
    Sfx.tone(420, 260, 0.09, 'square', 0.08);
    return true;
  },
  // a melee weapon swing, with per-weapon ammo and a lockout so it can't be mashed
  swing(f, it, kind) {
    if (it.cd > 0) return true;
    it.cd = ITEM_DEFS[kind].cool || 30;
    it.ammo--; if (it.ammo <= 0) f.dropAfter = kind;
    if (kind === 'pan') { f.startMove(I3_PAN); Sfx.tone(1650, 380, 0.34, 'triangle', 0.2); Sfx.noise(0.06, 0.16, 3400); }
    else { f.startMove(I3_PROD); Sfx.tone(300, 700, 0.06, 'square', 0.1); }
    return true;
  },
  gun(f, it, def) {
    if (it.cd > 0) return true;
    it.cd = ITEM_DEFS[it.kind].cool || 60;
    it.ammo--; if (it.ammo <= 0) f.dropAfter = it.kind;
    f.startMove(def); f.move.aim = TK.aim(f); f.move.up = f.move.aim ? 0 : (f.in.up ? 1 : f.in.down ? -1 : 0);
    return true;
  },
  // anything with hp: attacks chip it down instead of setting it off instantly
  hurt(it, a, h) {
    it.hp -= h.hb.dmg * (a ? a.chargeMult() : 1);
    Game.ring(it.x, it.y, '#ffe27a', 44); Sfx.hit(0.35);
    if (it.hp <= 0) { it.dead = true; Game.burst(it.x, it.y, '#9aa0ac', 18); Game.text(it.x, it.y - 34, 'WRECKED', '#cfd4e8', 1); }
  },
  nearest(G, f, maxD) {
    let best = null, bd = maxD == null ? 1e9 : maxD;
    for (const o of G.fighters) {
      if (o === f || o.state === 'dead' || o.state === 'respawn' || o.untouchable) continue;
      const d = dhypot(o.x - f.x, (o.y - o.h * 0.5) - (f.y - f.h * 0.5));
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  },
  owner(it, G) { return it.thrownBy || (it.owner != null ? G.fighters[it.owner] : null) || null; },

  // ================= $15 tier =================
  // ---- banana peel: comedy, near-zero damage, the best clip in the game ----
  // Ownership follows Smash's rule, which is better than a timer: you cannot slip on your OWN peel
  // — until somebody else slips on it first, at which point it belongs to the stage and it will
  // absolutely get you too. That flip is the whole banana neutral game in Smash, and it means the
  // peel is never a free zone for the player who bought it.
  peelTick(it, G) {
    if (it.life != null && --it.life <= 0) { it.dead = true; G.puff(it.x, it.y, 6, '#ffe04a'); return true; }
    it.vy = Math.min((it.vy || 0) + 0.5, 14);
    const py = it.y; it.y += it.vy;
    const sf = MV2.surf(G.stage, it.x, py, it.x, it.y);
    if (sf) { it.y = sf.y; it.vy = 0; }
    if (it.y > G.stage.blast.b) { it.dead = true; return true; }
    const own = this.owner(it, G);
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.state === 'respawn' || f.untouchable || f.air) continue;
      if (f === own && !it.loose) continue;                      // yours until it catches somebody else
      if (f.slipT > 0) continue;
      if (Math.abs(f.x - it.x) > 26 + f.w * 0.4 || Math.abs(f.y - it.y) > 40) continue;
      if (Math.abs(f.vx) < 0.6 && f.state !== 'roll') continue;   // you have to be MOVING to slip
      this.slip(f, it, own);
      if (f !== own) it.loose = 1;                                // it belongs to the stage now
      if (--it.peel <= 0) { it.dead = true; return true; }
    }
    return true;
  },
  slip(f, it, by) {
    const G = Game, dir = f.vx >= 0 ? 1 : -1;
    f.dmg = Math.min(999, f.dmg + 3); f.stats.taken += 3;
    if (by && by !== f) { by.stats.dealt += 3; f.lastHitBy = by; f.lastHitT = G.frame; }
    f.move = null; f.item = f.item;                              // you keep what you were holding
    f.vx = dir * (Math.abs(f.vx) * 1.5 + 4); f.vy = -7.5;
    f.air = true; f.plat = null; f.tumble = true; f.hitstun = 44; f.slipT = 90;
    f.setState('hitstun'); f.flashT = 6; f.face = -dir;
    G.text(f.x, f.y - f.h - 20, 'SLIPPED', '#ffe04a', 1.5);
    G.rings.push({ x: it.x, y: it.y, r: 6, max: 70, color: '#ffe04a', life: 16, w: 6 });
    for (let i = 0; i < 14; i++) { const a = rand(0, TAU), s = rand(2, 6); G.parts.push({ x: it.x, y: it.y, vx: dcos(a) * s, vy: dsin(a) * s - 2, life: 26, max: 26, color: i % 2 ? '#ffe04a' : '#fff6c8', size: rand(4, 8), g: 0.25 }); }
    G.shake(6); Sfx.tone(180, 1500, 0.22, 'sine', 0.16);
  },


  // ---- spring bumper: no damage, pure chaos. Owns the space in front of a ledge ----

  // ---- zip hook: fire up-forward, get yanked to the anchor, jumps reset. Pure mobility ----
  zip(f, it) {
    if (it.cd > 0) return true;
    it.cd = 30; it.ammo--; if (it.ammo <= 0) f.dropAfter = 'zip';
    const A = TK.aim(f), V = TK.rot(A, 20, -14);
    MV2.spawn(f, { kind: 'zipline', vx: V[0], vy: V[1], grav: 0, step: true, r: 9, dmg: 3, ang: 70, bkb: 18, kbg: 16,
      life: 26, pierce: true, noReflect: true, color: '#cfd4e8', zip: 1 }, f.w * 0.5 + 10, f.h * 0.7);
    f.startMove(I3_ZIP); Sfx.tone(900, 1700, 0.08, 'square', 0.08); Sfx.noise(0.1, 0.07, 2200);
    return true;
  },
  // fired from the projectile hook below when the line reaches the end of its run
  zipPull(p) {
    const f = p.owner;
    if (!f || f.state === 'dead') return;
    const dx = p.x - f.x, dy = (p.y) - (f.y - f.h * 0.6), d = dhypot(dx, dy) || 1;
    f.vx = dx / d * 19; f.vy = dy / d * 19; f.air = true; f.plat = null;
    f.jumps = FEEL.jumps(f); f.airOnce = {}; f.fastFall = false;
    if (f.state === 'helpless' || f.state === 'move') f.setState('air');
    Game.text(f.x, f.y - f.h - 22, 'ZIP', '#cfd4e8', 1.1);
    for (let i = 0; i < 10; i++) Game.parts.push({ x: lerp(f.x, p.x, i / 10), y: lerp(f.y - f.h * 0.6, p.y, i / 10), vx: 0, vy: 0, life: 12, max: 12, color: '#cfd4e8', size: 4, g: 0 });
    Sfx.tone(1400, 500, 0.12, 'sine', 0.1);
  },

  // ================= $20–50 tier =================
  // ---- rocket boots: a committed horizontal burn. Great recovery, terrible if you miss ----
  boots(f, it) {
    if (it.cd > 0) return true;
    it.cd = 60; it.ammo--; if (it.ammo <= 0) f.dropAfter = 'boots';
    const dx = f.dirX(); if (dx) f.face = dx;
    f.startMove(I3_BOOTS); f.airOnce = {};
    Sfx.rocketFire();
    return true;
  },
  bootsTick(f, t) {
    if (t < 6) { f.vx *= 0.7; return; }
    if (t > 36) { f.vx *= 0.88; return; }
    f.vx = f.face * 17; f.vy = f.air ? Math.min(f.vy, -1.2) : f.vy;
    if (t % 2 === 0) Game.parts.push({ x: f.x - f.face * f.w * 0.4 + rand(-6, 6), y: f.y - rand(0, 14), vx: -f.face * rand(2, 5), vy: rand(-1, 2), life: 18, max: 18, color: Game.frame % 3 ? '#ff9a2a' : '#ffe27a', size: rand(9, 16), g: 0, fire: true });
    if (t === 36 && f.air) f.setState('helpless');
  },

  // ---- cluster bomb: the everyday lobbed bomb, but the second half is the scary half ----
  cluster(it) {
    const N = 5;
    for (let i = 0; i < N; i++) {
      const a = deg(-150 + i * (120 / (N - 1))), sp = rand(5, 8);
      Game.items.push({ kind: 'clustlet', x: it.x + dcos(a) * 12, y: it.y - 14 + dsin(a) * 8,
        vx: dcos(a) * sp, vy: dsin(a) * sp - 2.5, age: 0, armed: true, thrownBy: it.thrownBy || null, hp: 0, ammo: 0 });
    }
    Game.text(it.x, it.y - 44, 'CLUSTER', '#ffd45c', 1.2);
  },

  // ---- sheep: walks, hops, falls off things, goes off. The joy is that you can't quite aim it ----
  sheepTick(it, G, st) {
    if (it.fuse != null) return false;                        // set off: let the normal fuse run
    if (--it.life <= 0) { Items.explode(it); return true; }
    it.vy = Math.min(it.vy + 0.5, 14);
    const px = it.x, py = it.y;
    it.x += (it.face || 1) * 2.4; it.y += it.vy;
    const s = MV2.surf(st, px, py, it.x, it.y);
    if (s) { it.y = s.y; it.vy = 0; if (it.age % 44 === 0) { it.vy = -7.6; Sfx.tone(700, 500, 0.12, 'triangle', 0.09); } }
    if (it.x < st.main.x0 - 60 || it.x > st.main.x1 + 60 || it.y > st.blast.b) { it.dead = true; return true; }
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.untouchable || (f === this.owner(it, G) && it.age < 40)) continue;
      if (!circleRect(it.x, it.y - 12, 22, f)) continue;
      Items.explode(it); return true;
    }
    if (it.age % 8 === 0) G.parts.push({ x: it.x, y: it.y - 14, vx: 0, vy: -0.4, life: 16, max: 16, color: '#fff6f0', size: 5, g: 0, soft: true });
    return true;
  },

  // ---- flame thrower: no knockback worth speaking of, but it melts a shield and a recovery ----
  flameTick(f, t) {
    if (f.air) f.vy = Math.min(f.vy, 1.4);
    f.vx *= 0.9;
    if (t < 8 || t > 62 || t % 3) return;
    const V = TK.rot(f.move.aim, 7.5 + rand(0, 2), rand(-1.6, 1.6) - (f.move.up || 0) * 2.2);
    MV2.spawn(f, { kind: 'flame', vx: V[0], vy: V[1], grav: -0.03, drag: 0.965, step: true, r: 15, rgrow: 0.65,
      dmg: 1.4, ang: 32, bkb: 18, kbg: 6, life: 18, rehit: 10, pierce: true, color: '#ff7a1a' }, f.w * 0.5 + 12, f.h * 0.6);
    if (t % 9 === 0) Sfx.noise(0.16, 0.09, 700);
  },

  // ---- NAIL GUN. The chip weapon, 2026-10-16. Fast, light, PIERCES, and it is the only thing on
  // the shelf that eats a shield: 22 nails at 1.1 each is not a kill on its own, it is what you do
  // to somebody who will not stop blocking. Short range, so it cannot do that from across the stage.
  nailTick(f, t) {
    if (f.air) f.vy = Math.min(f.vy, 1.5);
    f.vx *= 0.93;
    if (t < 6 || t > 58 || t % 3) return;
    const V = TK.rot(f.move.aim, 21, rand(-1.1, 1.1) - (f.move.up || 0) * 3.4);
    MV2.spawn(f, { kind: 'nail', vx: V[0], vy: V[1], grav: 0.02, step: true, r: 5,
      dmg: 1.1, ang: 24, bkb: 7, kbg: 5, life: 26, pierce: true, shieldEat: 1.9, color: '#cfd6e4' }, f.w * 0.5 + 12, f.h * 0.6);
    if (t % 6 === 0) Sfx.noise(0.07, 0.04, 2100);
  },

  // ---- BUZZSAW. Brawlhalla's Chakram: it goes out, it comes back, and it hits on both legs. The
  // return is the whole weapon -- throwing it PAST someone is the correct play, which is true of
  // nothing else on this shelf. `rehit` lets the same blade catch them twice in one throw.
  buzz(f, it) {
    // It had no cooldown and never spent a charge: a $6.99 weapon with two uses that in fact threw
    // a saw every single frame you held Attack, for the whole stock. Same two lines every other
    // arsenal weapon runs (zip, boots, gun), and `dropAfter` is what takes the empty one out of
    // your hand once you are out of the move (56_items2).
    if (it.cd > 0) return true;
    it.cd = ITEM_DEFS.buzzsaw.cool || 48;
    it.ammo--; if (it.ammo <= 0) f.dropAfter = 'buzzsaw';
    const dir = f.face;
    // `boomer` is read by MV2.projStep: fly out for `out` frames, then pull back to the thrower.
    // NOT `home`, which is the homing-missile steer and chases an OPPONENT.
    MV2.spawn(f, { kind: 'buzz', vx: dir * 13, vy: -1.2, grav: 0, step: true, spin: 0.9, r: 17,
      dmg: 4.2, ang: 42, bkb: 26, kbg: 44, life: 110, rehit: 18, pierce: true, color: '#b8c2cf',
      boomer: f, out: 34 }, f.w * 0.5 + 14, f.h * 0.55);
    Sfx.noise(0.12, 0.07, 1400);
    return true;
  },

  // ---- the Thunderbolt. A held beam: fast, straight, repeat-hitting, almost no knockback, so it
  // melts someone standing still and does nothing at all to someone who keeps moving. ----
  boltTick(f, t) {
    if (f.air) f.vy = Math.min(f.vy, 1.2);
    f.vx *= 0.86;
    if (t < 10 || t > 74 || t % 2) return;
    const V = TK.rot(f.move.aim, 34, -(f.move.up || 0) * 4.5);
    MV2.spawn(f, { kind: 'arcbolt', vx: V[0], vy: V[1], grav: 0, drag: 1, step: true, r: 10,
      dmg: 2.2, ang: 14, bkb: 6, kbg: 4, life: 9, rehit: 6, pierce: true, color: '#9fdcff' },
      f.w * 0.5 + 14, f.h * 0.62);
    if (t % 6 === 0) { Sfx.tone(2400, 1800, 0.07, 'sawtooth', 0.07); Sfx.noise(0.05, 0.05, 6000); }
  },

  // ---- freeze ray: the pure control tool. 1 second of doing nothing at all ----
  freezeTick(f, t) {
    if (f.air) f.vy = Math.min(f.vy, 1);
    if (t < 20) { f.vx *= 0.7; return; }
    if (t !== 20) return;
    const V = TK.rot(f.move.aim, 26, -(f.move.up || 0) * 5);
    MV2.spawn(f, { kind: 'frost', vx: V[0], vy: V[1], grav: 0, step: true, r: 11, dmg: 6, ang: 30, bkb: 22, kbg: 18,
      life: 40, color: '#9fe8ff', after: (p, b) => Items3.chill(b) }, f.w * 0.5 + 16, f.h * 0.6);
    Sfx.tone(1900, 500, 0.3, 'sine', 0.14); Sfx.noise(0.2, 0.08, 5200);
  },
  chill(b) {
    if (!b || b.state === 'dead' || b.untouchable) return;
    b.frozen = 72; b.move = null; b.vx = 0;
    b.setState('dizzy'); b.st = 150 - 72;                       // reuse the shield-break stun, cut to 1.2 s
    Game.text(b.x, b.y - b.h - 22, 'FROZEN', '#9fe8ff', 1.5);
    Game.rings.push({ x: b.x, y: b.y - b.h * 0.5, r: 8, max: 110, color: '#9fe8ff', life: 20, w: 8 });
  },
  // mashing a direction breaks the ice early: the counter is in the player's hands
  frozenTick(f, G) {
    let m = 1;
    for (const d of ['left', 'right', 'up', 'down', 'attack', 'jump']) if (f.in[d] && !f.prev[d]) m += 3;
    f.frozen -= m;
    if (f.state === 'dizzy') { f.vx *= 0.7; f.st = Math.max(0, 150 - Math.max(0, f.frozen)); }
    if (G.frame % 4 === 0) G.parts.push({ x: f.x + rand(-f.w * 0.4, f.w * 0.4), y: f.y - rand(0, f.h), vx: 0, vy: rand(-0.6, 0.4), life: 18, max: 18, color: '#cdf3ff', size: rand(3, 6), g: 0 });
    if (f.frozen <= 0) { f.frozen = 0; G.burst(f.x, f.y - f.h * 0.5, '#cdf3ff', 16); Sfx.tone(1400, 300, 0.12, 'triangle', 0.1); }
  },

  // ---- homing missile: slow, obvious, and it WILL find you if you stand still ----
  homer(f, it) {
    if (it.cd > 0) return true;
    it.cd = 70; it.ammo--; if (it.ammo <= 0) f.dropAfter = 'homer';
    const tgt = this.nearest(Game, f, 900), A = TK.aim(f), V = TK.rot(A, 9, -3.5);
    const p = MV2.spawn(f, { kind: 'homer', vx: V[0], vy: V[1], grav: 0, step: true, boom: true, r: 12,
      dmg: 5, ang: 42, bkb: 24, kbg: 24, life: 150, color: '#ff5a8a', after: q => Items2.projBoom(q) }, f.w * 0.5 + 16, f.h * 0.62);
    p.home = tgt ? tgt.idx : -1; p.homeT = 22;                   // flies straight for a beat, THEN turns
    f.vx -= f.face * 2; Sfx.rocketFire();
    return true;
  },
  // called from the MV2.projStep wrapper at the bottom of this file
  homeStep(p) {
    if (p.homeT > 0) { p.homeT--; return; }
    const t = Game.fighters[p.home];
    if (!t || t.state === 'dead' || t === p.owner) return;
    const dx = t.x - p.x, dy = (t.y - t.h * 0.5) - p.y, d = dhypot(dx, dy) || 1;
    const sp = dhypot(p.vx, p.vy) || 9;
    p.vx = lerp(p.vx, dx / d * sp, 0.09); p.vy = lerp(p.vy, dy / d * sp, 0.09);
    const s = dhypot(p.vx, p.vy) || 1; p.vx = p.vx / s * Math.min(11, sp + 0.08); p.vy = p.vy / s * Math.min(11, sp + 0.08);
    if (Game.frame % 2 === 0) Game.parts.push({ x: p.x, y: p.y, vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6), life: 16, max: 16, color: Game.frame % 4 ? '#ff9a2a' : '#ffd0e0', size: rand(6, 11), g: 0, soft: true });
  },

  // ---- mole bomb: thrown, burrows, comes up under them. Beats camping on the far side ----
  drillTick(it, G, st) {
    if (it.dig == null) {
      if (!it.armed) return false;                              // still a pickup on the floor
      it.vy = Math.min(it.vy + 0.5, 14);
      const px = it.x, py = it.y; it.x += it.vx; it.y += it.vy;
      const s = MV2.surf(st, px, py, it.x, it.y);
      if (s && s === st.mainSurf) { it.dig = 70; it.y = s.y + 14; it.vy = 0;
        const own = this.owner(it, G), t = own ? this.nearest(G, own, 1e9) : null;
        it.digDir = t ? (t.x > it.x ? 1 : -1) : (it.vx >= 0 ? 1 : -1);
        G.text(it.x, s.y - 30, 'BURROWED', '#c8a06a', 1.1); G.puff(it.x, s.y, 10, '#8a7058'); Sfx.noise(0.3, 0.12, 400);
        return true; }
      if (it.y > st.blast.b || it.x < st.blast.l || it.x > st.blast.r) it.dead = true;
      return true;
    }
    const M = st.main;
    it.x += it.digDir * 5.2;
    if (G.frame % 3 === 0) G.parts.push({ x: it.x, y: M.top + rand(-2, 4), vx: rand(-1.5, 1.5), vy: rand(-3, -1), life: 22, max: 22, color: '#6a5442', size: rand(4, 8), g: 0.3 });
    const own = this.owner(it, G);
    for (const f of G.fighters) {
      if (f.state === 'dead' || f === own || f.air) continue;
      if (Math.abs(f.x - it.x) < 30) { it.y = M.top - 10; Items.explode(it); return true; }
    }
    if (--it.dig <= 0 || it.x < M.x0 + 6 || it.x > M.x1 - 6) { it.y = M.top - 10; Items.explode(it); return true; }
    return true;
  },

  // ---- aegis drone: point defence. Shoots down the NEXT 3 projectiles aimed at you ----
  // Deliberately projectile-only: it answers zoning, never a melee mix-up, so it can't turn a
  // fight into "whoever bought the shield wins" the way an all-hit bubble would.
  giveAegis(f) {
    f.aegis = 3; f.aegisT = 720;
    Game.text(f.x, f.y - f.h - 30, 'AEGIS ONLINE', '#9fe8ff', 1.2); Game.ring(f.x, f.y - f.h * 0.5, '#9fe8ff', 90);
    return true;
  },
  aegisTick(f, G) {
    if (--f.aegisT <= 0) { f.aegis = 0; G.text(f.x, f.y - f.h - 20, 'AEGIS OFFLINE', '#aaa', 0.9); return; }
    for (const p of G.projs) {
      if (p.dead || p.owner === f || p.noReflect) continue;
      if (dhypot(p.x - f.x, p.y - (f.y - f.h * 0.5)) > 78) continue;
      p.dead = true; f.aegis--;
      G.ring(p.x, p.y, '#9fe8ff', 56); G.burst(p.x, p.y, '#cdf3ff', 12); Sfx.tone(1500, 900, 0.07, 'sine', 0.1);
      if (f.aegis <= 0) { f.aegisT = 0; G.text(f.x, f.y - f.h - 20, 'AEGIS DOWN', '#aaa', 0.9); return; }
    }
  },

  // ---- sentry turret: holds a lane while you go somewhere else. Shootable, 26 hp ----
  turretTick(it, G, st) {
    if (--it.life <= 0) { it.dead = true; G.burst(it.x, it.y, '#9aa0ac', 20); return true; }
    it.vy = Math.min((it.vy || 0) + 0.5, 14);
    const py = it.y; it.y += it.vy;
    const s = MV2.surf(st, it.x, py, it.x, it.y);
    if (s) { it.y = s.y; it.vy = 0; }
    const own = this.owner(it, G);
    let tgt = null, bd = 460;
    for (const f of G.fighters) {
      if (f === own || f.state === 'dead' || f.state === 'respawn' || f.untouchable) continue;
      const d = dhypot(f.x - it.x, (f.y - f.h * 0.5) - it.y); if (d < bd) { bd = d; tgt = f; }
    }
    it.tgtX = tgt ? tgt.x : null;
    if (!tgt || !own || it.age % 22) return true;
    const dx = tgt.x - it.x, dy = (tgt.y - tgt.h * 0.5) - (it.y - 20), d = dhypot(dx, dy) || 1;
    G.projs.push({ kind: 'bullet', x: it.x, y: it.y - 22, vx: dx / d * 15, vy: dy / d * 15, grav: 0, r: 6,
      dmg: 2.2, ang: 24, bkb: 10, kbg: 14, life: 40, color: '#ffe27a', owner: own, age: 0, dir: dx > 0 ? 1 : -1 });
    G.puff(it.x + Math.sign(dx) * 16, it.y - 22, 3, '#ffe9a0'); Sfx.mgunTap();
    return true;
  },

  // ---- gravity well: drags everything in for 3 s, then lets go with a bang ----
  wellTick(it, G) {
    if (--it.life <= 0) { Items.explode(it); return true; }
    it.y -= 0.35; if (it.age < 12) return true;
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.state === 'respawn' || f.untouchable) continue;
      const dx = it.x - f.x, dy = it.y - (f.y - f.h * 0.5), d = dhypot(dx, dy);
      if (d > 270 || d < 1) continue;
      const k = (1 - d / 270) * 0.62;
      f.vx += dx / d * k * 1.9; f.vy += dy / d * k * 1.9;
      if (!f.air && dy < -20) { f.air = true; f.plat = null; }
    }
    for (const p of G.projs) {
      const dx = it.x - p.x, dy = it.y - p.y, d = dhypot(dx, dy);
      if (d > 220 || d < 1) continue;
      p.vx += dx / d * 0.5; p.vy += dy / d * 0.5;
    }
    if (it.age % 3 === 0) {
      const a = rand(0, TAU), r = rand(120, 250);
      G.parts.push({ x: it.x + dcos(a) * r, y: it.y + dsin(a) * r, vx: -dcos(a) * 5, vy: -dsin(a) * 5, life: 22, max: 22, color: '#9a6cff', size: rand(4, 8), g: 0 });
    }
    return true;
  },

  // ================= AIRSTRIKE + CONCRETE DONKEY: pick the spot, then run =================
  // Worms aims an air strike with the mouse. Here the marker is steered with the stick and locked
  // with Attack, because the marker has to be identical on every page and on the server: a mouse
  // position is not in the input stream. On a mouse or a touchscreen, tapping the stage still works
  // (UI.aimTo -> Items3.aimPoint) in LOCAL matches only; online it is stick-only. See docs/ECONOMY.md.
  // A proximity mine, which is Smash's Motion-Sensor Bomb. It arms after a beat (so you cannot stick
  // one to someone's face) and then goes off when anyone but the owner walks into it.
  // First press plants a charge, every press after that sets off everything you have planted.
  // Two charges max, so it is a decision rather than a carpet.
  detonator(f, it) {
    if (it.cd > 0) return true;
    it.cd = ITEM_DEFS.mine.cool || 24;
    const G = Game;
    // One charge out at a time, and the rule is dead simple so nobody has to learn a modifier:
    // a charge on the floor means PRESS BLOWS IT. No charge means press plants one.
    const mine = G.items.filter(x => x.kind === 'mine' && x.owner === f.idx);
    if (mine.length) return this.blow(f, mine, it);
    if (it.ammo <= 0) { Game.text(f.x, f.y - f.h - 24, 'OUT OF CHARGES', '#8d99a7', 0.95); return true; }
    // plant one
    it.ammo--;
    G.items.push({ kind: 'mine', x: f.x + f.face * f.w * 0.3, y: f.y - 2, vx: 0, vy: f.air ? 2 : 0,
      age: 0, armed: true, thrownBy: f, owner: f.idx, hp: 0, ammo: 0, face: f.face, arm: 22 });
    f.startMove({ total: 14, throwAnim: 'f' });
    G.text(f.x, f.y - f.h - 24, 'CHARGE SET \u2014 PRESS AGAIN', '#ff6a3d', 1.1);
    G.ring(f.x, f.y - f.h * 0.4, '#ff6a3d', 40);
    Sfx.tone(380, 240, 0.08, 'square', 0.07);
    return true;
  },
  // the press that matters
  blow(f, mine, it) {
    const G = Game;
    if (!mine.length) { G.text(f.x, f.y - f.h - 24, 'NOTHING SET', '#8d99a7', 0.95); return true; }
    for (const m of mine) { m.fuse = 0; Items.explode(m); }
    G.text(f.x, f.y - f.h - 30, 'DETONATE', '#ff3b2f', 1.5);
    Game.shake(12); Sfx.tone(140, 60, 0.26, 'square', 0.2);
    if (it && it.ammo <= 0) f.dropAfter = 'mine';
    return true;
  },
  mineTick(it, G, st) {
    if (it.arm > 0) { it.arm--; if (it.arm === 0) G.ring(it.x, it.y, '#ff4a4a', 26); return; }
    // a planted charge no longer triggers on proximity: it waits for the remote
    it.blink = (it.blink || 0) + 1;
    return;
    /* eslint-disable no-unreachable */
    it.blink = (it.blink || 0) + 1;
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.idx === it.owner) continue;
      if (Math.abs(f.x - it.x) < 34 && Math.abs((f.y - f.h * 0.5) - it.y) < 44) { Items2.setOff(it, f); return; }
    }
    /* eslint-enable no-unreachable */
  },

  // A manhole, which is Smash's Pitfall: it does no damage, it takes the opponent out of the fight
  // for a moment. Reuses `chill`, the freeze ray's hold, rather than inventing a second stun.
  manholeTick(it, G, st) {
    if (it.arm > 0) { it.arm--; return; }
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.idx === it.owner) continue;
      if (Math.abs(f.x - it.x) < 30 && Math.abs((f.y - f.h * 0.5) - it.y) < 46) {
        Items3.chill(f);
        f.vx *= 0.2; f.vy = 0;
        G.text(f.x, f.y - f.h - 20, 'DOWN THE HOLE', '#9fe8ff', 1.1);
        G.ring(it.x, it.y, '#5a6472', 44);
        it.life = 0;
        return;
      }
    }
  },

  aimStart(f, it, kind) {
    const G = Game;
    f.aimKind = kind; f.aimX = clamp(f.x + f.face * 150, G.stage.main.x0, G.stage.main.x1); f.aimV = 0;
    f.item = null;
    f.startMove(I3_AIM);
    G.text(f.x, f.y - f.h - 36, kind === 'wreck' ? 'PICK A LANE' : 'MARK THE TARGET', '#ff4a4a', 1.3);
    Sfx.tone(1200, 1200, 0.08, 'square', 0.08); Sfx.tone(1600, 1600, 0.08, 'square', 0.08, 0.12);
    return true;
  },
  aimTick(f, t) {
    const G = Game, M = G.stage.main;
    f.vx *= 0.6; if (f.air) f.vy = Math.min(f.vy, 3);
    const dx = f.dirX();
    f.aimV = dx ? clamp(f.aimV + dx * 1.1, -14, 14) : f.aimV * 0.6;
    f.aimX = clamp(f.aimX + f.aimV, M.x0 - 40, M.x1 + 40);
    if (G.frame % 6 === 0) Sfx.tone(2200, 2200, 0.02, 'square', 0.03);
    if ((t > 8 && f.pressed('attack')) || t >= I3_AIM.total - 6) this.aimFire(f);
  },
  // local-only convenience: a mouse click / tap sets the marker straight away
  aimPoint(x) {
    const G = Game;
    if (!G.fighters.length || !this.local(G)) return false;
    for (const f of G.fighters) if (f.state === 'move' && f.move && f.move.def === I3_AIM && !f.cpu) { f.aimX = clamp(x, G.stage.main.x0 - 40, G.stage.main.x1 + 40); f.aimV = 0; return true; }
    return false;
  },
  // true while anyone is holding the marker (the renderer draws it, the UI shows the prompt)
  aiming(f) { return f.state === 'move' && !!f.move && f.move.def === I3_AIM; },
  aimFire(f) {
    const G = Game, kind = f.aimKind || 'strike', x = f.aimX;
    f.aimKind = null;
    f.move = null; f.setState(f.air ? 'air' : 'ground');
    if (kind === 'wreck') {
      this.strikes.push({ kind: 'wreck', x, t: 96, by: f, face: f.face });
      G.text(x, G.stage.main.top - 180, 'INCOMING', '#c8ccd4', 1.6);
    } else {
      this.strikes.push({ kind: 'strike', x, t: 150, by: f, face: x >= f.x ? 1 : -1 });
      G.text(x, G.stage.main.top - 180, 'AIRSTRIKE', '#ff4a4a', 1.7);
      Sfx.tone(300, 900, 0.5, 'sawtooth', 0.1);
    }
    G.rings.push({ x, y: G.stage.main.top, r: 10, max: 140, color: '#ff4a4a', life: 26, w: 8 });
    G.shake(8);
  },
  strikeTick(G, st) {
    if (!this.strikes.length) return;
    for (const s of this.strikes) {
      s.t--;
      // ground marker pulse + the warning beep, so nobody is hit by something they could not see
      if (s.t % 10 === 0) {
        G.rings.push({ x: s.x, y: st.main.top - 4, r: 6, max: 90, color: s.t < 50 ? '#ff2a3a' : '#ff9a4a', life: 12, w: 5 });
        Sfx.tone(s.t < 50 ? 1500 : 900, s.t < 50 ? 1500 : 900, 0.05, 'square', 0.07);
      }
      if (s.kind === 'wreck') {
        if (s.t === 60) { G.text(s.x, st.blast.t + 200, 'CONCRETE DONKEY', '#c8ccd4', 1.6); Sfx.tone(120, 60, 1.1, 'sawtooth', 0.2); }
        if (s.t > 0) continue;
        G.items.push({ kind: 'blastx', x: s.x, y: st.main.top - 18, vx: 0, vy: 0, age: 0, thrownBy: s.by });
        this.bigBoom(G, s.x, st.main.top - 18, 210, 38, 118, 122, s.by);
        Items2.hole(s.x, st.main.top); Items2.hole(s.x - 90, st.main.top); Items2.hole(s.x + 90, st.main.top);
        G.shake(40); G.flashT = 8;
        continue;
      }
      // the three missiles are released with the jets still overhead, and land together
      if (s.t === 60) Sfx.rocketFire();
      if (s.t > 0) continue;
      for (let i = 0; i < 3; i++) {
        const mx = s.x + (i - 1) * 62;
        this.bigBoom(G, mx, st.main.top - 14, 118, 20, 82, 100, s.by);
        G.rings.push({ x: mx, y: st.main.top - 10, r: 10, max: 170, color: '#ffd45c', life: 18, w: 12 });
      }
      G.shake(34); G.flashT = 7; G.text(s.x, st.main.top - 120, 'BOOM BOOM BOOM', '#ffb347', 1.6);
      Sfx.ko();
    }
    this.strikes = this.strikes.filter(s => s.t > 0);
  },
  bigBoom(G, x, y, r, dmg, bkb, kbg, by) {
    for (const f of G.fighters) {
      if (f.state === 'dead' || f.untouchable) continue;
      if (dhypot(f.x - x, (f.y - f.h / 2) - y) > r + f.w * 0.4) continue;
      const keep = by ? by.hitlag : 0;
      f.takeHit({ dmg, ang: 58, bkb, kbg, radial: true }, by || null, 1, x, 1);
      if (by && by !== f) by.hitlag = keep;
    }
    for (let i = 0; i < 34; i++) { const a = rand(0, TAU), s = rand(3, 13); G.parts.push({ x, y, vx: dcos(a) * s, vy: dsin(a) * s, life: 32, max: 32, color: i % 3 ? '#ffb347' : '#ffffff', size: rand(6, 14), g: 0.05 }); }
    for (let i = 0; i < 16; i++) { const a = rand(0, TAU), s = rand(1, 5); G.parts.push({ x, y, vx: dcos(a) * s, vy: dsin(a) * s - 1.5, life: 34, max: 34, color: i % 3 ? '#ff8a1a' : '#ffe27a', size: rand(22, 44), g: 0, fire: true }); }
    G.impact = { x, y, t: 28 };
  },

  // ---- ARMAGEDDON: the $100 joke. The sky opens for four seconds. Once per match, per player ----
  armageddon(f, it) {
    if (this.rain) return true;
    f.item = null; f.startMove({ total: 40, throwAnim: 'f' });
    this.rain = { t: 260, by: f };
    Game.text(f.x, f.y - f.h - 50, 'ARMAGEDDON', '#ff2a3a', 2.6);
    Game.flashT = 12; Game.shake(30);
    Sfx.tone(60, 40, 2.4, 'sawtooth', 0.22); Sfx.ko();
    return true;
  },
  rainTick(G, st) {
    const R3 = this.rain;
    if (--R3.t <= 0) { this.rain = null; return; }
    if (R3.t % 7 === 0) {
      const x = rand(st.main.x0 - 60, st.main.x1 + 60);
      G.projs.push({ kind: 'meteor', x, y: st.blast.t + 40, vx: rand(-1.4, 1.4), vy: rand(9, 13), grav: 0.1, step: true,
        boom: true, r: 15, dmg: 6, ang: 60, bkb: 34, kbg: 60, life: 130, color: '#ff5a2a', owner: R3.by, age: 0, dir: 1,
        after: p => Items2.projBoom(p) });
    }
    if (R3.t % 20 === 0) { G.shake(10); Sfx.noise(0.3, 0.12, 500); }
  },

  // ---------- CPU: make the bots use what they are handed, so party matches read right ----------
  ai(f, tgt, o, press) {
    const k = f.item.kind, dx = tgt.x - f.x, adx = Math.abs(dx), toward = dx > 0 ? 'right' : 'left';
    if (k === 'peel' || k === 'bouncer') { if (Rng.next() < 0.02) { press('attack'); return true; } return false; }
    if (k === 'turret' || k === 'well') { if (adx < 320 && Rng.next() < 0.03) { press('attack'); return true; } return false; }
    if (k === 'sheep' || k === 'drill' || k === 'dyna') { if (adx < 340 && Rng.next() < 0.035) { if ((dx > 0 ? 1 : -1) !== f.face) { o[toward] = true; return true; } press('attack'); return true; } return false; }
    if (k === 'cluster') { if (adx < 420 && Rng.next() < 0.05) { o[toward] = true; press('attack'); return true; } return false; }
    if (k === 'strike' || k === 'donkey' || k === 'armageddon') { if (Rng.next() < 0.04) { press('attack'); return true; } return false; }
    if (k === 'zip' || k === 'boots') { if (Items2.offStage(f) && Rng.next() < 0.12) { if (f.x < 0) o.right = true; else o.left = true; press('attack'); return true; } return false; }
    const reach = { pan: 110, prod: 90, flamer: 200, freeze: 480, homer: 700 }[k];
    if (reach && !(f.item.cd > 0) && adx < reach && Rng.next() < 0.06) {
      if ((dx > 0 ? 1 : -1) !== f.face) { o[toward] = true; return true; }
      press('attack'); return true;
    }
    return false;
  },
  // the airstrike marker: the CPU walks it onto its target, then fires
  aiAim(f) {
    const o = {}; for (const k of ACTIONS) o[k] = false;
    const tgt = this.nearest(Game, f, 1e9);
    if (!tgt) { o.attack = !f.prev.attack; return o; }
    const d = tgt.x - f.aimX;
    if (Math.abs(d) > 36 && f.move.t < 150) o[d > 0 ? 'right' : 'left'] = true;
    else o.attack = !f.prev.attack;
    return o;
  },
};

// The 3D layer (src/98_v3_econ.mjs) is a MODULE and this is a classic script, so `Items3` reaches it
// through the global lexical environment — which a module can read by name but which is NOT a
// property of `window`. 98 reached for `window.Items3`, got undefined, and silently drew no marker,
// no jets, no missiles, no donkey and no Armageddon sky for the life of the file.
// 98 now reads it by name; this line is the belt, and it matches how 89_econ.js exports `Econ`.
if (typeof window !== 'undefined') window.Items3 = Items3;

// ---- hook 1: run Items3 at the end of every item frame (set 2+ only, so the bet arena never sees it)
Items.update = (function (base) {
  return function () {
    base.call(this);
    if (Game.itemSet >= 2) Items3.update(Game, Game.stage);
  };
})(Items.update);

// ---- hook 2: homing + the zip line's anchor, inside the shared projectile stepper.
// A projectile without `home` / `zip` goes through untouched, so seeded fights are unaffected.
MV2.projStep = (function (base) {
  return function (p, G, M) {
    if (p.home != null) Items3.homeStep(p);
    if (p.zip && (p.age >= p.life - 1 || (p.dead && !p.zipped))) { p.zipped = 1; Items3.zipPull(p); }
    return base.call(this, p, G, M);
  };
})(MV2.projStep);

// ---- hook 3: the CPU uses arsenal weapons too (Items2.ai only knows set-2 kinds)
Items2.ai = (function (base) {
  return function (f, tgt, o, press) {
    if (f.item && ITEM_DEFS[f.item.kind] && ITEM_DEFS[f.item.kind].set === 3) return Items3.ai(f, tgt, o, press);
    return base.call(this, f, tgt, o, press);
  };
})(Items2.ai);

// ---- hook 4: a CPU holding the airstrike marker is inside a move, which AI.think exits early, so
// the marker gets its own branch in front of everything else. Off unless item set 2+.
AI.think = (function (base) {
  return function (f, st) {
    if (Game.itemSet >= 2 && Items3.aiming(f)) return Items3.aiAim(f);
    return base.call(this, f, st);
  };
})(AI.think);
