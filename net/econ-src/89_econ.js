// ===== ECONOMY: catalogue, entitlements, XP + levels, loadout, cosmetics =====
// Design + reasoning: docs/ECONOMY.md. Progress: dev/NOTES-economy.md. UI lives in src/8b_store.js.
//
// THE FAIRNESS RULE, in code:
//   - Nothing bought is available in a WAGERED or RANKED match. `Econ.arsenalAllowed(mode)` is the
//     single gate, and the server decides it for online play (`room.arsenal`), not this file. The
//     client copy is a convenience so the UI greys out; it is never the authority.
//   - Cosmetics are allowed everywhere, in every mode. They change nothing a hitbox can see.
//
// ENTITLEMENTS ARE SERVER-SIDE. `Econ.own` is a CACHE of what the server last said this account owns
// (net/lib/entitlements.js). It is mirrored to localStorage only so the store and the arsenal render
// offline and in solo play. A purchase is never granted here: `Econ.buy()` asks the server and waits.
/* CATALOG-START */
const ECON_CATALOG = {
  version: 3,
  // ---------------- weapons ----------------
  // price: US cents. tier: the shelf it sits on in the store.
  // unlock: the account level that grants it for free (null = money only).
  // counter: what beats it. Every weapon has one, written down, because "what beats this" is the
  // difference between a toy and a fighting-game tool.
  weapons: [
    // $15 shelf — cheap, huge personality, almost no raw power
    { id: 'peel', kind: 'peel', name: 'Banana Peel', price: 1500, tier: 15, unlock: 2, charges: 3, icon: '🍌',
      blurb: 'Drop it and walk away. Anyone who runs over it goes flying on their back.',
      how: 'Only trips a fighter who is actually moving on the ground. 3% damage. Trips 3 times, then it is gone.',
      counter: 'Walk, don\'t run — standing still over it does nothing. Or jump it.' },
    { id: 'prod', kind: 'prod', name: 'Prod', price: 1500, tier: 15, unlock: 4, charges: 3, icon: '👉',
      blurb: 'One finger. One percent damage. Straight off the edge.',
      how: '1% damage and an enormous flat shove that does not scale with your damage. 3 pokes.',
      counter: 'Shield it — it has no shield pressure at all. Or hit them first, the range is tiny.' },
    { id: 'girder', kind: 'girder', name: 'Girder', price: 1500, tier: 15, unlock: 6, charges: 2, icon: '🏗️',
      blurb: 'Bolt a steel beam into thin air. No damage. It rewrites the stage.',
      how: 'Places a soft platform 96 px in front of you. Lasts 20 s, then blinks out. 2 beams.',
      counter: 'It is a platform for both of you. Stand on it and take the high ground.' },
    { id: 'bouncer', kind: 'bouncer', name: 'Spring Bumper', price: 1500, tier: 15, unlock: 8, charges: 2, icon: '🛸',
      blurb: 'A pinball bumper you leave on the ledge. No damage, total chaos.',
      how: 'Flings anyone who touches it away at speed. Hurts nobody, kills plenty. 15 s.',
      counter: 'It flings you too, and it is easy to see. Bait them into their own bumper.' },
    { id: 'zip', kind: 'zip', name: 'Zip Hook', price: 1500, tier: 15, unlock: 10, charges: 3, icon: '🪝',
      blurb: 'Fire it up and forward and get yanked across the screen. Jumps reset.',
      how: 'Travels for about half a second, then pulls you to where it ended and gives your air jumps back.',
      counter: 'Nothing about it hurts. Punish the landing.' },

    // $20-50 shelf — the shadowed shelf
    { id: 'boots', kind: 'boots', name: 'Rocket Boots', price: 2000, tier: 25, unlock: 18, charges: 2, icon: '🥾',
      blurb: 'A committed horizontal burn that runs people over.',
      how: '6% on contact, and it will take you back from anywhere. You land helpless. 2 burns.',
      counter: 'It goes in a straight line and cannot stop. Shield, then punish the helpless landing.' },
    { id: 'cluster', kind: 'cluster', name: 'Cluster Bomb', price: 2500, tier: 25, unlock: 12, charges: 2, icon: '🎇',
      blurb: 'Lob it. It bursts once, then five bomblets burst where they land.',
      how: '11% on the first blast, 7% per bomblet. They go off on impact, so the ground is briefly a minefield.',
      counter: 'The lob is slow and obvious. Move to where the bomblets already went off.' },
    { id: 'sheep', kind: 'sheep', name: 'Sheep', price: 3000, tier: 25, unlock: 15, charges: 2, icon: '🐑',
      blurb: 'It walks. It hops. It falls off things. Then it goes off for 22%.',
      how: 'Walks forward hopping every 0.7 s, explodes on contact or after 5 s. Shoot it to set it off early.',
      counter: 'Shoot it, or just stand behind it — it never turns round.' },
    { id: 'flamer', kind: 'flamer', name: 'Flame Thrower', price: 3000, tier: 30, unlock: 30, charges: 2, icon: '🔥',
      blurb: 'Short range, no knockback worth anything, and it eats a shield alive.',
      how: 'A stream of fire for about a second. ~1.4% a tick, repeat hits. Two bursts.',
      counter: 'Stay outside about 200 px and it does literally nothing. Jump over it.' },
    { id: 'homer', kind: 'homer', name: 'Homing Missile', price: 3500, tier: 35, unlock: null, charges: 2, icon: '🚀',
      blurb: 'Slow, loud, and it turns. Standing still is no longer an option.',
      how: 'Flies straight for a beat, then steers onto the nearest opponent. Bursts for 14% on anything it touches.',
      counter: 'Air-dodge it, shield it, or reflect it. It turns slowly — keep moving sideways.' },
    { id: 'drill', kind: 'drill', name: 'Mole Bomb', price: 3500, tier: 35, unlock: null, charges: 2, icon: '🐹',
      blurb: 'Throw it at the floor. It burrows, travels, and comes up under them.',
      how: 'Digs for about a second toward the nearest opponent, then erupts for 20%.',
      counter: 'Get in the air. It cannot touch anyone who is not standing on the main stage.' },
    { id: 'aegis', kind: 'aegis', name: 'Aegis Drone', price: 4000, tier: 40, unlock: 25, charges: 1, icon: '🛰️',
      blurb: 'A little drone that shoots down the next three shots aimed at you.',
      how: 'Projectiles only, three of them, twelve seconds. It does nothing at all against a fist.',
      counter: 'Walk in and hit them. It is a zoning answer, not a defence.' },
    { id: 'freeze', kind: 'freeze', name: 'Freeze Ray', price: 4000, tier: 40, unlock: null, charges: 2, icon: '❄️',
      blurb: 'One second where they simply cannot do anything.',
      how: '6% and a 1.2 s freeze. Two shots. The beam is fast but thin.',
      counter: 'Mash any direction and the ice breaks early. Shield the beam outright.' },
    { id: 'turret', kind: 'turret', name: 'Sentry Turret', price: 4500, tier: 45, unlock: null, charges: 1, icon: '🔫',
      blurb: 'Put it down, walk away, and let it hold a lane for eight seconds.',
      how: 'Fires a 2.2% pellet every 0.4 s at whoever is nearest, up to 460 px. 26 hp.',
      counter: 'Break it — it has less health than one smash attack. Or stand outside its range.' },
    { id: 'well', kind: 'well', name: 'Gravity Well', price: 5000, tier: 50, unlock: null, charges: 1, icon: '🕳️',
      blurb: 'Three seconds where the middle of the stage sucks everything in. Then it lets go.',
      how: 'Pulls fighters AND projectiles toward it from 270 px, then bursts for 18%.',
      counter: 'It pulls you too. Hold away from it and it is survivable — or use the pull to come back.' },
    { id: 'banana', kind: 'banana', name: 'Banana Bomb', price: 5000, tier: 50, unlock: null, charges: 2, icon: '🍌',
      blurb: 'The classic. Lobbed, bursts, then seven live bomblets spray across the floor.',
      how: '12% on the burst, then a rolling chain of bomblets as each one sets off its neighbour.',
      counter: 'The lob is slow. Be somewhere else — and never chase into the bomblets.' },
    { id: 'strike', kind: 'strike', name: 'Airstrike', price: 5000, tier: 50, unlock: null, charges: 1, icon: '✈️',
      blurb: 'Pick up the remote, mark a spot, three jets come in and put three missiles on it.',
      how: 'Steer the marker, Attack to lock. Jets fly in, missiles land 2.5 s later, 20% each in a 3-wide pattern.',
      counter: 'The marker is on the ground the whole time and it beeps. You get 2.5 seconds. Leave.' },
    { id: 'donkey', kind: 'donkey', name: 'Concrete Donkey', price: 5000, tier: 50, unlock: null, charges: 1, icon: '🫏',
      blurb: 'Mark a lane. A concrete donkey falls on it and takes the floor with it.',
      how: '38% in a 210 px radius and it punches three craters in the stage. Arrives 1.6 s after you lock it.',
      counter: 'One lane, clearly marked, and the craters are as bad for the caller as for you.' },

    // $100 shelf — the two finishers
    { id: 'holy', kind: 'holy', name: 'Holy Grenade', price: 10000, tier: 100, unlock: null, charges: 1, icon: '😇',
      blurb: 'It hangs in the air for a hallelujah. Then it takes the stage with it.',
      // 9/21: this used to read "more than double any other bomb", which dev/weapon_test.js caught as
      // false — the free Dynamite does 30% to this one's 32%. What IS more than double is the blast
      // AREA (235 px vs the next biggest at 165 px = 2.0x), and that is what actually makes it a
      // finisher: there is nowhere on a platform to stand that it does not reach.
      how: '32% in a 235 px radius — more than double the blast area of any other bomb, so there is nowhere on the platform to stand. One per match.',
      counter: 'The choir is a one-second warning and the fuse is 1.7 s. Run, and make them throw it badly.' },
    { id: 'armageddon', kind: 'armageddon', name: 'Armageddon', price: 10000, tier: 100, unlock: null, charges: 1, icon: '☄️',
      blurb: 'The sky turns red and stays that way for four seconds. Nobody is safe, including you.',
      how: 'Meteors rain across the whole stage for 4.3 s, ~6% each on contact and a blast where they land.',
      counter: 'It hits the caller too, and it cannot be aimed. Survive it and they have nothing left.' },
  ],

  // ---------------- cosmetics ----------------
  // Zero gameplay effect, allowed in EVERY mode including money matches. This is the shelf that is
  // meant to make money, because it is the one that cannot poison a wager.
  cosmetics: [
    // weapon finishes: recolour every weapon you hold
    { id: 'fin_chrome', slot: 'finish', name: 'Chrome', price: 800, icon: '🪞', color: '#e8ecf4', metal: 1, blurb: 'Mirror-polished. Everything you pick up looks expensive.' },
    { id: 'fin_gold', slot: 'finish', name: 'Solid Gold', price: 1500, icon: '🥇', color: '#ffc83a', metal: 1, blurb: 'Loud on purpose.' },
    { id: 'fin_toxic', slot: 'finish', name: 'Toxic', price: 1000, icon: '☢️', color: '#7dff5a', metal: 0.3, glow: 1, blurb: 'Green, and slightly radioactive.' },
    { id: 'fin_carbon', slot: 'finish', name: 'Carbon', price: 1000, icon: '⬛', color: '#23262e', metal: 0.7, blurb: 'Matte black weave. The quiet flex.' },
    { id: 'fin_vapor', slot: 'finish', name: 'Vaporwave', price: 1200, icon: '🌴', color: '#ff4fd8', metal: 0.4, glow: 1, blurb: 'Pink and cyan, permanently 1994.' },
    { id: 'fin_rekt', slot: 'finish', name: 'Liquidation Red', price: 2000, icon: '📉', color: '#ff1a3a', metal: 0.6, glow: 1, blurb: 'The colour of somebody else\'s portfolio.' },
    // auras: a light that follows you
    { id: 'aur_ember', slot: 'aura', name: 'Ember', price: 1200, icon: '🔥', color: '#ff6a2a', blurb: 'Warm coals drifting off your shoulders.' },
    { id: 'aur_frost', slot: 'aura', name: 'Frost', price: 1200, icon: '🧊', color: '#9fe8ff', blurb: 'Cold light and a drifting mist.' },
    { id: 'aur_volt', slot: 'aura', name: 'Voltage', price: 1500, icon: '⚡', color: '#ffe84a', blurb: 'It crackles when you move.' },
    { id: 'aur_void', slot: 'aura', name: 'Void', price: 2000, icon: '🌑', color: '#9a6cff', blurb: 'Light bends the wrong way around you.' },
    { id: 'aur_rain', slot: 'aura', name: 'Full Spectrum', price: 2500, icon: '🌈', color: null, rainbow: 1, blurb: 'Every colour, all the time. Subtlety is for people who lose.' },
    // trails: the streak you leave when you are launched
    { id: 'trl_neon', slot: 'trail', name: 'Neon', price: 800, icon: '💫', color: '#ff2a4a', blurb: 'A hard red streak.' },
    { id: 'trl_ice', slot: 'trail', name: 'Ice', price: 800, icon: '❄️', color: '#9fe8ff', blurb: 'Shards that hang in the air.' },
    { id: 'trl_gold', slot: 'trail', name: 'Gold Dust', price: 1200, icon: '✨', color: '#ffc83a', blurb: 'Money, falling.' },
    { id: 'trl_glitch', slot: 'trail', name: 'Glitch', price: 1500, icon: '📺', color: '#27e1ff', blurb: 'The renderer giving up on you.' },
    // KO effects: what the screen does when you send somebody off
    { id: 'ko_rain', slot: 'ko', name: 'Gold Rain', price: 1500, icon: '🪙', color: '#ffc83a', blurb: 'Coins rain down where they used to be.' },
    { id: 'ko_liq', slot: 'ko', name: 'Liquidated', price: 2000, icon: '📉', color: '#ff1a3a', blurb: 'A red candle drops through the blast zone.' },
    { id: 'ko_nova', slot: 'ko', name: 'Supernova', price: 2500, icon: '💥', color: '#fff3b0', blurb: 'White out, then a ring that fills the screen.' },
    { id: 'ko_conf', slot: 'ko', name: 'Confetti', price: 1000, icon: '🎉', color: '#ff4fd8', blurb: 'Party poppers. Deeply disrespectful.' },
    // victory poses
    { id: 'vic_flex', slot: 'pose', name: 'Flex', price: 800, icon: '💪', blurb: 'Both arms. Held far too long.' },
    { id: 'vic_diamond', slot: 'pose', name: 'Diamond Hands', price: 1500, icon: '💎', blurb: 'Hands up, fists closed, never selling.' },
    { id: 'vic_throne', slot: 'pose', name: 'Throne', price: 2500, icon: '👑', blurb: 'A chair appears. You sit in it.' },
    // name plates: the frame around your name on the HUD, the lobby and the board
    { id: 'plt_degen', slot: 'plate', name: 'Degen', price: 500, icon: '🎰', color: '#ff2a4a', blurb: 'Red bracket, permanently tilted.' },
    { id: 'plt_whale', slot: 'plate', name: 'Whale', price: 2000, icon: '🐋', color: '#27e1ff', blurb: 'A plate that says you did not check the price.' },
    { id: 'plt_found', slot: 'plate', name: 'Founder', price: 5000, icon: '🏛️', color: '#ffc83a', blurb: 'Only while the game is new. It never comes back.' },
  ],

  // ---------------- bundles ----------------
  bundles: [
    { id: 'bnd_starter', name: 'Starter Kit', price: 3000, icon: '🎒', grants: ['peel', 'prod', 'girder', 'bouncer', 'zip'],
      blurb: 'All five $15 weapons. About half price.' },
    { id: 'bnd_worms', name: 'Heavy Ordnance', price: 12000, icon: '💣', grants: ['cluster', 'sheep', 'banana', 'strike', 'donkey', 'drill'],
      blurb: 'Every bomb and everything that falls out of the sky.' },
    { id: 'bnd_found', name: 'Founder Bundle', price: 25000, icon: '🏛️', grants: ['ALL_WEAPONS', 'plt_found', 'aur_rain', 'fin_gold'],
      blurb: 'Every weapon in the game, the Founder plate, Full Spectrum and Solid Gold. Sold while the game is new.' },
  ],

  // ---------------- progression ----------------
  // XP is earned by PLAYING, never bought. Levels unlock the cheap and mid shelves for free, which is
  // what keeps a non-paying player in the game long enough to become a paying one.
  xp: { match: 50, win: 60, ko: 12, damage: 0.25, firstOfDay: 150, perLevel: 420, curve: 1.18 },
  // stages and features gated on level (the stages session reads `shibuya`)
  unlocks: { shibuya: 12 },
  // ---------------- monthly season ----------------
  season: {
    prizes: [
      { rank: 1, title: 'Champion', plate: 'plt_champ', reward: 'Champion plate + gold name for the season + 10000 credits' },
      { rank: 2, title: 'Runner-up', plate: 'plt_top3', reward: 'Top 3 plate + 6000 credits' },
      { rank: 3, title: 'Third', plate: 'plt_top3', reward: 'Top 3 plate + 4000 credits' },
      { rank: 10, title: 'Top 10', plate: 'plt_top10', reward: 'Top 10 plate + 2000 credits' },
      { rank: 100, title: 'Top 100', plate: null, reward: '500 credits' },
    ],
    // plates handed out by the season, never sold
    plates: [
      { id: 'plt_champ', name: 'Champion', color: '#ffc83a', icon: '👑' },
      { id: 'plt_top3', name: 'Top 3', color: '#e8ecf4', icon: '🥈' },
      { id: 'plt_top10', name: 'Top 10', color: '#ff6a3d', icon: '🔟' },
    ],
  },
};
/* CATALOG-END */

const Econ = (() => {
  const CAT = ECON_CATALOG;
  const BYID = {};
  for (const w of CAT.weapons) BYID[w.id] = Object.assign({ type: 'weapon' }, w);
  for (const c of CAT.cosmetics) BYID[c.id] = Object.assign({ type: 'cosmetic' }, c);
  for (const b of CAT.bundles) BYID[b.id] = Object.assign({ type: 'bundle' }, b);
  for (const p of CAT.season.plates) BYID[p.id] = Object.assign({ type: 'cosmetic', slot: 'plate', price: null, season: true }, p);

  const SLOTS = ['finish', 'aura', 'trail', 'ko', 'pose', 'plate'];
  const KEY = 'econ3';
  const S = {
    own: {},            // id -> 1 (cache of the server's entitlement list)
    equip: {},          // slot -> cosmetic id
    loadout: [],        // up to 3 weapon ids, the arsenal you bring into a casual match
    xp: 0, level: 1,
    record: { w: 0, l: 0, ko: 0, best: 0 },
    season: null,       // { id, rank, elo, ends }
    badges: [],         // earned titles, server-issued
    synced: false,      // true once the server has confirmed this list
    credits: 0,
  };

  function load() {
    try {
      const raw = store.get(KEY, null);
      if (raw && typeof raw === 'object') {
        Object.assign(S, { own: raw.own || {}, equip: raw.equip || {}, loadout: raw.loadout || [], xp: raw.xp || 0, record: raw.record || S.record, badges: raw.badges || [], credits: raw.credits || 0 });
        S.level = levelFor(S.xp);
      }
    } catch (e) { /* storage blocked */ }
  }
  function save() {
    try { store.set(KEY, { own: S.own, equip: S.equip, loadout: S.loadout, xp: S.xp, record: S.record, badges: S.badges, credits: S.credits }); } catch (e) { /* storage blocked */ }
  }
  // cumulative XP for a level: perLevel * sum(i^curve). Level 12 (Shibuya) is ~30 matches.
  function xpForLevel(n) { let t = 0; for (let i = 1; i < n; i++) t += Math.round(CAT.xp.perLevel * Math.pow(i, CAT.xp.curve) / i); return t; }
  function levelFor(xp) { let n = 1; while (n < 99 && xp >= xpForLevel(n + 1)) n++; return n; }

  const api = {
    CAT, BYID, SLOTS,
    S,   // read-only from outside; the UI renders from here

    // ---------- entitlements ----------
    owns(id) {
      if (!id) return false;
      if (S.own[id]) return true;
      const d = BYID[id];
      return !!(d && d.unlock != null && S.level >= d.unlock);   // level unlocks are entitlements too
    },
    ownedWeapons() { return CAT.weapons.filter(w => api.owns(w.id)); },
    lockedWeapons() { return CAT.weapons.filter(w => !api.owns(w.id)); },
    // the server told us what this account has. Anything not in the list is not owned, full stop.
    setServer(list, extra) {
      S.own = {};
      for (const id of list || []) if (BYID[id]) S.own[id] = 1;
      if (extra) {
        if (extra.xp != null) S.xp = extra.xp;
        if (extra.credits != null) S.credits = extra.credits;
        if (extra.record) S.record = extra.record;
        if (extra.season) S.season = extra.season;
        if (extra.badges) S.badges = extra.badges;
        if (extra.equip) S.equip = extra.equip;
        if (extra.loadout) S.loadout = extra.loadout.filter(id => BYID[id]);
      }
      S.level = levelFor(S.xp); S.synced = true;
      api.clean(); save(); api.emit();
    },
    // drop anything equipped or loaded out that this account does not actually own
    clean() {
      for (const k of Object.keys(S.equip)) if (!api.owns(S.equip[k])) delete S.equip[k];
      S.loadout = S.loadout.filter(id => api.owns(id)).slice(0, 3);
    },

    // ---------- levels / XP ----------
    level() { return S.level; },
    xp() { return S.xp; },
    xpBar() { const a = xpForLevel(S.level), b = xpForLevel(S.level + 1); return { level: S.level, into: S.xp - a, need: b - a, pct: Math.min(1, (S.xp - a) / Math.max(1, b - a)) }; },
    levelAtLeast(n) { return S.level >= n; },
    // the stages session gates SHIBUYA on this
    unlocked(what) { const n = CAT.unlocks[what]; return n == null ? true : S.level >= n; },
    unlockLevel(what) { return CAT.unlocks[what] || 0; },
    // Local XP is provisional and shown straight away; the server recomputes it from its own replay
    // and `setServer` overwrites whatever we guessed. Nothing here can be farmed into an entitlement.
    addXp(n, why) {
      if (!(n > 0)) return null;
      const before = S.level;
      S.xp += Math.round(n); S.level = levelFor(S.xp); save();
      const gained = [];
      if (S.level > before) for (const w of CAT.weapons) if (w.unlock != null && w.unlock > before && w.unlock <= S.level) gained.push(w);
      api.emit();
      return { xp: Math.round(n), why, level: S.level, levelled: S.level > before, unlocked: gained };
    },
    // what a finished match is worth. Called by the UI from the results screen.
    matchXp(f, won) {
      const X = CAT.xp;
      let n = X.match + (won ? X.win : 0) + (f && f.stats ? f.stats.kos * X.ko + f.stats.dealt * X.damage : 0);
      const today = new Date().toISOString().slice(0, 10);
      if (store.get('econDay', '') !== today) { store.set('econDay', today); n += X.firstOfDay; }
      return Math.round(n);
    },

    // ---------- loadout ----------
    loadout() { return S.loadout.slice(); },
    inLoadout(id) { return S.loadout.indexOf(id) >= 0; },
    toggleLoadout(id) {
      if (!api.owns(id) || !BYID[id] || BYID[id].type !== 'weapon') return false;
      const i = S.loadout.indexOf(id);
      if (i >= 0) S.loadout.splice(i, 1);
      else { if (S.loadout.length >= 3) return false; S.loadout.push(id); }
      save(); api.push(); api.emit(); return true;
    },

    // ---------- cosmetics ----------
    equipped(slot) { return S.equip[slot] || null; },
    equip(id) {
      const d = BYID[id];
      if (!d || d.type !== 'cosmetic' || !api.owns(id)) return false;
      if (S.equip[d.slot] === id) delete S.equip[d.slot]; else S.equip[d.slot] = id;
      save(); api.push(); api.emit(); return true;
    },
    // what the renderer should apply for ME
    look() {
      const out = {};
      for (const s of SLOTS) { const id = S.equip[s]; if (id && BYID[id]) out[s] = BYID[id]; }
      return out;
    },
    // Per-slot cosmetics for the match on screen. Online they come from the server (start.cosm);
    // locally every human slot is this account, so they all get mine. Read by 98_v3_econ.mjs.
    slotLooks: null,
    matchCosmetics(list) {
      const out = [];
      for (let i = 0; i < 4; i++) {
        const eq = list && list[i], o = {};
        if (eq && typeof eq === 'object') for (const s of SLOTS) { const id = eq[s]; if (typeof id === 'string' && BYID[id] && BYID[id].slot === s) o[s] = BYID[id]; }
        out[i] = o;
      }
      S.slotLooks = out; api.slotLooks = out;
      return out;
    },
    // what the renderer should apply to fighter `i` right now
    lookFor(i) {
      if (S.slotLooks) return S.slotLooks[i] || {};
      if (typeof Game !== 'undefined' && Game.fighters && Game.fighters[i] && Game.fighters[i].cpu) return {};
      return api.look();   // local play: every human seat is this account
    },
    clearMatchCosmetics() { S.slotLooks = null; api.slotLooks = null; },

    // ---------- THE FAIRNESS GATE ----------
    // mode: 'local' | 'casual' | 'ranked' | 'wager' | 'arena'. Anything staked or rated says no.
    arsenalAllowed(mode) { return mode === 'local' || mode === 'casual'; },
    // the single place the arsenal is switched on for a fight. Everything else calls this.
    // `mode` comes from the caller; for online it comes from the SERVER's room state, never the client.
    // Local play: every human on this keyboard gets the SAME arsenal, so a local versus match is
    // symmetric — the same rule as a money match, for the same reason.
    arm(mode) {
      if (typeof Game === 'undefined' || !Game.fighters || !Game.fighters.length) return false;
      Game.arsenalOn = false; Game.loadouts = null;
      if (!api.arsenalAllowed(mode)) return false;
      const ids = S.loadout.filter(id => api.owns(id));
      if (!ids.length) return false;
      Game.arsenalOn = true;
      for (const f of Game.fighters) { if (f.cpu) continue; f.arsenal = ids.map(id => ({ kind: BYID[id].kind, n: BYID[id].charges || 1 })); }
      return true;
    },
    // live deploy from the in-match panel
    deploy(id, slotIdx) {
      if (typeof Items3 === 'undefined' || typeof Game === 'undefined') return false;
      const f = Game.fighters && Game.fighters[slotIdx == null ? 0 : slotIdx];
      if (!f || !BYID[id]) return false;
      return Items3.deploy(f, BYID[id].kind);
    },
    // what the panel should show: owned, in the loadout, how many left, cooldown
    arsenalState(slotIdx) {
      const G = typeof Game !== 'undefined' ? Game : null;
      const f = G && G.fighters ? G.fighters[slotIdx == null ? 0 : slotIdx] : null;
      const cd = f && f.arsCd > 0 ? f.arsCd : 0;
      const frame = G ? G.frame : 0;
      return S.loadout.map(id => {
        const d = BYID[id], slot = f && f.arsenal ? f.arsenal.find(s => s.kind === d.kind) : null;
        // Worms-style weapon delay: the big ones are locked for the first part of the match
        const def = (typeof ITEM_DEFS !== 'undefined' && ITEM_DEFS[d.kind]) || null;
        const wait = def && def.delay ? Math.max(0, def.delay - frame) : 0;
        return { id, def: d, left: slot ? slot.n : (d.charges || 1), cd, wait,
          ready: !!f && !f.item && cd === 0 && wait === 0 && (!slot || slot.n > 0) };
      });
    },
    // seconds a weapon is locked for at the start of a match (0 = available immediately)
    delayOf(id) { const d = BYID[id]; const def = d && typeof ITEM_DEFS !== 'undefined' ? ITEM_DEFS[d.kind] : null; return def && def.delay ? Math.round(def.delay / 60) : 0; },

    // ---------- purchases (STUBBED: no money moves until docs/SECURITY-REVIEW.md clears) ----------
    // The client never grants anything. It asks; the server answers; `setServer` is the only writer.
    buy(id, cb) {
      const d = BYID[id];
      if (!d || d.price == null) return cb && cb({ ok: false, msg: 'Not for sale.' });
      if (api.owns(id)) return cb && cb({ ok: false, msg: 'You already own it.' });
      if (!api.connected()) return cb && cb({ ok: false, msg: 'Connect to online play first — what you own lives on your account, not on this device.' });
      api.pending = { id, cb, at: Date.now() };
      Net.send({ k: 'buy', id, provider: 'stub' });
      setTimeout(() => { if (api.pending && api.pending.id === id) { const c = api.pending.cb; api.pending = null; c && c({ ok: false, msg: 'The store did not answer. Try again.' }); } }, 8000);
    },
    onBuyResult(m) {
      const p = api.pending; api.pending = null;
      if (m.owned) api.setServer(m.owned, m);
      if (p && p.cb) p.cb({ ok: !!m.ok, msg: m.msg || (m.ok ? 'Unlocked.' : 'That did not go through.') });
    },
    // push equip + loadout to the account so they follow you to another device
    connected() { try { const N = Net.state; return !!(N && N.conn === 'open' && N.me); } catch (e) { return false; } },
    push() { if (api.connected()) Net.send({ k: 'econset', equip: S.equip, loadout: S.loadout }); },
    pull() { if (api.connected()) Net.send({ k: 'econ' }); },

    // ---------- change events ----------
    subs: [],
    on(fn) { api.subs.push(fn); return fn; },
    emit() { for (const fn of api.subs) { try { fn(S); } catch (e) { /* a listener must never break the game */ } } },
    money(cents) { return '$' + (cents / 100).toFixed(cents % 100 ? 2 : 0); },
  };
  load();
  api.clean();
  return api;
})();
if (typeof window !== 'undefined') window.Econ = Econ;

// The server is the authority on what an account owns: ask on every sign-in, and take whatever it
// says over the local cache. A device that has never been online plays with the cache and cannot buy.
if (typeof Net !== 'undefined' && Net.on) Net.on(m => {
  if (m.k === 'welcome' || m.k === 'me') { Econ.pull(); return; }
  if (m.k === 'econ') { Econ.setServer(m.owned, m); return; }
  if (m.k === 'buyres') { Econ.onBuyResult(m); return; }
});
