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
// ================= THE MARKET LAYER, 2026-10-16 =================
// Duane: "implement it into brawlstreet now, add everything", pointing at the teardown of
// fortnite.gg/shop and csgoskins.gg: https://claude.ai/artifact/Ag7J6RSPKQwHZPfjMYKtrY
//
// Everything below is lifted from one of those two shops and named for this game. Nothing in it
// touches a hitbox, and `_rails` in dev/weapon_test.js fails the build if that ever stops being true.
//
// WEAPON FINISHES, the biggest single change. CS2's catalogue is not 25 guns, it is 25 guns x ~20
// paints x 5 wear steps, and that is why its market is bigger than most games. Ours was six
// universal recolours that applied to everything you picked up, so a player could own "Gold" and
// there was nothing else to want. A finish is now PER WEAPON, named the way CS2 names them (two
// words, no sentence), carrying the finish STYLE that produced it -- which is also the brief for
// the render -- and the collection it belongs to.
//
// The art costs nothing: `98_v3_econ.mjs` already recolours whatever is in your hands from the
// finish's material fields, so a finish is data and the weapon's own baked render is the card.
const ECON_FIN_STYLES = ['gunsmith', 'hydro', 'patina', 'anod', 'anodmulti', 'custom', 'spray'];
// weapon id -> [ name, style, collection, grade, colour, metalness, glow? ]
const ECON_FIN_SRC = {
  ak: [ // the hero weapon gets the deepest shelf, the way the AK-47 does
    ['Bodega Gold', 'patina', 'bodega', 'epic', '#d9a441', 0.95],
    ['Night Shift', 'gunsmith', 'night', 'uncommon', '#2f3f52', 0.75],
    ['Ticker Tape', 'hydro', 'floor', 'rare', '#d8d2c0', 0.35],
    ['Bull Run', 'patina', 'floor', 'rare', '#8a5a2b', 0.8],
    ['Circuit Breaker', 'anod', 'boiler', 'rare', '#27e1ff', 0.9, 1],
    ['Pink Slip', 'custom', 'night', 'common', '#ff5fa8', 0.3],
    ['Hard Fork', 'spray', 'scaffold', 'common', '#f0b429', 0.2],
    ['Blue Chip', 'anodmulti', 'floor', 'legendary', '#2a5fd0', 1],
  ],
  bat: [
    ['Taped Up', 'spray', 'scaffold', 'common', '#cfc6b4', 0.1],
    ['Grand Slam', 'custom', 'bodega', 'rare', '#d43b3b', 0.25],
    ['Chalk Line', 'hydro', 'precinct', 'uncommon', '#e8edf4', 0.2],
    ['Louisville Rust', 'patina', 'dock', 'uncommon', '#7a4a2a', 0.5],
    ['Pine Tar', 'patina', 'bodega', 'common', '#3a2a16', 0.3],
    ['Gold Barrel', 'anod', 'floor', 'epic', '#ffc83a', 1],
  ],
  sweeper: [
    ['Scrap Yard', 'patina', 'scaffold', 'common', '#6d6257', 0.6],
    ['Fire Sale', 'custom', 'floor', 'rare', '#ff4a2a', 0.4],
    ['Last Call', 'gunsmith', 'night', 'uncommon', '#1d2430', 0.7],
    ['Gutter King', 'anodmulti', 'dock', 'epic', '#2fbf8f', 0.85],
    ['Hazard Tape', 'spray', 'scaffold', 'common', '#f2b705', 0.2],
    ['Brass Shell', 'patina', 'boiler', 'uncommon', '#b08430', 0.95],
  ],
  blaster: [
    ['Chrome Twins', 'anod', 'floor', 'uncommon', '#e8ecf4', 1],
    ['Split Shift', 'anodmulti', 'night', 'rare', '#7a4fd8', 0.85],
    ['Dollar Menu', 'custom', 'bodega', 'common', '#d8c24a', 0.3],
    ['Pay Day', 'hydro', 'floor', 'uncommon', '#2f8f5a', 0.4],
    ['Neon Nines', 'anod', 'night', 'rare', '#ff2a7a', 0.8, 1],
    ['Ivory Grip', 'gunsmith', 'bodega', 'common', '#e4ddc8', 0.35],
  ],
  deagle: [   // a .50 that exists to be looked at, so the finishes are loud on purpose
    ['Bodega Chrome', 'anod', 'bodega', 'uncommon', '#dfe5ee', 1],
    ['Last Word', 'gunsmith', 'night', 'rare', '#1f242c', 0.8],
    ['Closing Price', 'patina', 'floor', 'epic', '#d9a441', 0.95],
    ['Hand Cannon', 'spray', 'scaffold', 'common', '#b4461c', 0.3],
    ['Precinct Issue', 'anodmulti', 'precinct', 'rare', '#2a5fd0', 0.85],
  ],
  bow: [
    ['Deep End', 'anod', 'dock', 'uncommon', '#1f6f8f', 0.8],
    ['Dock Rust', 'patina', 'dock', 'common', '#8a5330', 0.55],
    ['Harpoon Chrome', 'anod', 'floor', 'rare', '#cfd8e4', 1],
    ['Salt Line', 'hydro', 'dock', 'common', '#b8c6cc', 0.3],
    ['Deck Gun', 'gunsmith', 'boiler', 'epic', '#2a3a44', 0.85],
  ],
  fireaxe: [
    ['Station Nine', 'custom', 'precinct', 'uncommon', '#d02a2a', 0.4],
    ['Red Line', 'spray', 'precinct', 'common', '#ff3a3a', 0.25],
    ['Cold Steel', 'anod', 'night', 'rare', '#9fb4c8', 1],
    ['Hydrant', 'patina', 'bodega', 'common', '#b83a2a', 0.45],
    ['Ash Grey', 'gunsmith', 'scaffold', 'uncommon', '#4a4f57', 0.7],
  ],
  pipegun: [
    ['Boiler Room', 'patina', 'boiler', 'rare', '#9a6a33', 0.9],
    ['Steam Line', 'hydro', 'boiler', 'uncommon', '#8fb8c4', 0.6],
    ['Copper Top', 'anod', 'boiler', 'epic', '#c87a3a', 1],
    ['Blast Cap', 'spray', 'scaffold', 'common', '#e2a33a', 0.3],
    ['Primer', 'gunsmith', 'scaffold', 'common', '#8a6a52', 0.4],
  ],
  gloves: [
    ['Gold Caps', 'anod', 'floor', 'legendary', '#ffc83a', 1],
    ['Site Red', 'custom', 'scaffold', 'common', '#c23a2a', 0.2],
    ['Brass Knuckle', 'patina', 'night', 'epic', '#b08430', 0.95],
    ['Wrapped', 'spray', 'precinct', 'common', '#ddd4c4', 0.1],
    ['Ringside', 'gunsmith', 'bodega', 'uncommon', '#2a2f3a', 0.4],
    ['Split Leather', 'anodmulti', 'dock', 'rare', '#6a3f2a', 0.5],
  ],
  boots: [
    ['Afterburner', 'anod', 'boiler', 'rare', '#ff6a2a', 0.8, 1],
    ['Red Soles', 'custom', 'floor', 'uncommon', '#d02a4a', 0.3],
    ['Jet Wash', 'hydro', 'dock', 'common', '#8fa8c4', 0.5],
    ['Site Boots', 'patina', 'scaffold', 'common', '#8a6a3a', 0.4],
  ],
  wreck: [
    ['Demo Day', 'spray', 'scaffold', 'common', '#f2b705', 0.4],
    ['Iron Moon', 'patina', 'night', 'rare', '#5a6270', 0.9],
    ['Chain Gang', 'gunsmith', 'precinct', 'uncommon', '#3a4048', 0.85],
    ['Closing Bell', 'anod', 'floor', 'epic', '#c8a03a', 1],
  ],
  manhole: [
    ['City Seal', 'patina', 'bodega', 'uncommon', '#5a5048', 0.8],
    ['Storm Lid', 'gunsmith', 'dock', 'common', '#3f4650', 0.75],
    ['Brass Cover', 'anod', 'boiler', 'rare', '#b08430', 1],
    ['Grate', 'hydro', 'scaffold', 'common', '#6a7078', 0.6],
  ],
  freeze: [
    ['Code Red', 'custom', 'precinct', 'uncommon', '#ff2a3a', 0.4],
    ['Frost Bite', 'anod', 'night', 'rare', '#9fe8ff', 0.7, 1],
    ['Hazmat', 'spray', 'scaffold', 'common', '#d8f03a', 0.3],
    ['Blue Line', 'anodmulti', 'precinct', 'epic', '#2a5fd0', 0.85],
  ],
  turret: [
    ['Precinct', 'gunsmith', 'precinct', 'uncommon', '#2f3f52', 0.8],
    ['Grey Hornet', 'anod', 'night', 'rare', '#8a9098', 0.9],
    ['Safety Orange', 'spray', 'scaffold', 'common', '#ff8a2a', 0.3],
    ['Desk Phone', 'custom', 'floor', 'epic', '#2a2a2f', 0.5],
  ],
  well: [
    ['Undercurrent', 'anod', 'dock', 'rare', '#2a6f8f', 0.8, 1],
    ['Blackwater', 'gunsmith', 'dock', 'uncommon', '#1a2028', 0.7],
    ['Storm Drain', 'patina', 'bodega', 'common', '#5f6a70', 0.6],
    ['Margin Call', 'anodmulti', 'floor', 'epic', '#d03a5a', 0.85],
  ],
  thunder: [
    ['Live Wire', 'anod', 'boiler', 'rare', '#ffe84a', 0.8, 1],
    ['Substation', 'gunsmith', 'scaffold', 'uncommon', '#3a4450', 0.85],
    ['Arc Flash', 'anodmulti', 'night', 'epic', '#9a6cff', 0.9, 1],
    ['Earth Strap', 'spray', 'scaffold', 'common', '#2f8f4a', 0.3],
  ],
  bolt: [
    ['Cold Store', 'anod', 'dock', 'uncommon', '#cfe0e8', 0.9],
    ['Air Line', 'gunsmith', 'boiler', 'common', '#6a7580', 0.75],
    ['Red Tag', 'custom', 'precinct', 'rare', '#d02a2a', 0.4],
    ['Nickel', 'patina', 'floor', 'epic', '#c8ccd4', 1],
  ],
  flamer: [
    ['Blue Flame', 'anod', 'boiler', 'epic', '#4aa8ff', 0.6, 1],
    ['Cutting Torch', 'gunsmith', 'scaffold', 'uncommon', '#4a5058', 0.85],
    ['Butane Gold', 'patina', 'bodega', 'rare', '#d9a441', 0.95],
    ['Burn Notice', 'spray', 'night', 'common', '#ff6a2a', 0.25],
  ],
  mine: [
    ['Tripwire', 'spray', 'scaffold', 'common', '#f2b705', 0.3],
    ['Short Fuse', 'custom', 'night', 'uncommon', '#d03a2a', 0.35],
    ['Detonator Grey', 'gunsmith', 'precinct', 'common', '#5a6068', 0.7],
    ['Red Tape', 'anodmulti', 'floor', 'rare', '#e03a4a', 0.5],
  ],
  pipebomb: [
    ['Firecracker', 'custom', 'bodega', 'common', '#e03a3a', 0.3],
    ['Gas Line', 'patina', 'boiler', 'uncommon', '#9a7a3a', 0.8],
    ['Black Powder', 'gunsmith', 'night', 'rare', '#22262e', 0.7],
    ['Scaffold Pipe', 'anod', 'scaffold', 'common', '#8f989f', 0.9],
  ],
  zip: [
    ['Rope Line', 'patina', 'dock', 'common', '#9a7a52', 0.3],
    ['Window Washer', 'gunsmith', 'floor', 'uncommon', '#5a6a78', 0.8],
    ['Sky Hook', 'anod', 'scaffold', 'rare', '#27e1ff', 0.9, 1],
  ],
  medkit: [
    ['Station Kit', 'custom', 'precinct', 'common', '#e8edf4', 0.2],
    ['Green Cross', 'spray', 'bodega', 'common', '#2fbf6a', 0.25],
    ['Trauma Gold', 'anod', 'floor', 'rare', '#ffc83a', 0.95],
  ],
  rebar: [
    ['Hot Rolled', 'patina', 'scaffold', 'common', '#8a6a3a', 0.6],
    ['Site Red', 'spray', 'scaffold', 'common', '#c23a2a', 0.3],
    ['Twisted Steel', 'anod', 'night', 'uncommon', '#8f989f', 0.9],
    ['Primer', 'gunsmith', 'dock', 'common', '#9a7a52', 0.4],
  ],
  chain: [
    ['Fence Link', 'patina', 'scaffold', 'common', '#8f989f', 0.85],
    ['Rust Link', 'patina', 'dock', 'common', '#8a5330', 0.6],
    ['Gold Rope', 'anod', 'floor', 'epic', '#ffc83a', 1],
    ['Snap Back', 'gunsmith', 'night', 'uncommon', '#2f3f52', 0.8],
  ],
  nailgun: [
    ['Framer', 'gunsmith', 'scaffold', 'common', '#f2b705', 0.5],
    ['Galvanised', 'anod', 'scaffold', 'uncommon', '#b8c6cc', 0.95],
    ['Red Tag', 'custom', 'precinct', 'uncommon', '#d02a2a', 0.4],
    ['Air Line', 'hydro', 'boiler', 'rare', '#8fb8c4', 0.6],
  ],
  buzzsaw: [
    ['Mill Cut', 'patina', 'scaffold', 'common', '#8d97a6', 0.9],
    ['Carbide', 'anod', 'night', 'rare', '#cfd6e4', 1],
    ['Red Disc', 'custom', 'bodega', 'uncommon', '#d43b3b', 0.5],
    ['Scrap Wheel', 'patina', 'dock', 'common', '#7a4a2a', 0.7],
  ],
  // 17 Oct: finishes for the ten new ones. Same shape as the shelf above -- name, finish, backdrop,
  // rarity, colour, drop weight -- so the market, the trade-up and the locker all read them without
  // a special case.
  toaster: [
    ['Kitchen Issue', 'patina', 'bodega', 'common', '#c9ced6', 1],
    ['Burnt', 'custom', 'dock', 'common', '#6b5440', 0.8],
    ['Chrome Pop', 'anod', 'night', 'rare', '#e6edf6', 0.45],
  ],
  riotshield: [
    ['Precinct', 'patina', 'precinct', 'common', '#aeb6c2', 1],
    ['Scuffed', 'patina', 'dock', 'common', '#8d97a6', 0.8],
    ['Riot Line', 'custom', 'night', 'rare', '#2f6fd0', 0.45],
  ],
  cardoor: [
    ['Wrecked Red', 'patina', 'dock', 'common', '#b4382c', 1],
    ['Primer', 'patina', 'scaffold', 'common', '#8a8f98', 0.8],
    ['Taxi', 'custom', 'bodega', 'uncommon', '#e2b015', 0.5],
  ],
  warhammer: [
    ['Forge', 'patina', 'scaffold', 'common', '#8a6a3f', 1],
    ['Pig Iron', 'patina', 'dock', 'common', '#6e737a', 0.8],
    ['Gilded Head', 'anod', 'night', 'rare', '#d9a441', 0.4],
  ],
  chainsaw: [
    ['Site Orange', 'patina', 'scaffold', 'common', '#d8771f', 1],
    ['Oil Black', 'custom', 'dock', 'uncommon', '#3a3d42', 0.6],
    ['Limiter Off', 'anod', 'night', 'rare', '#e04b1f', 0.4],
  ],
  katana: [
    ['Folded', 'patina', 'night', 'common', '#d7dde6', 1],
    ['Lacquer', 'custom', 'bodega', 'uncommon', '#1f2328', 0.6],
    ['Gold Saya', 'anod', 'night', 'rare', '#d9a441', 0.38],
  ],
  nunchaku: [
    ['Hardwood', 'patina', 'bodega', 'common', '#6b4a2a', 1],
    ['Taped Grip', 'custom', 'scaffold', 'common', '#3f4349', 0.8],
    ['Dragon Cord', 'anod', 'night', 'rare', '#c0392b', 0.42],
  ],
  machete: [
    ['Field', 'patina', 'dock', 'common', '#9aa3ad', 1],
    ['Blacked', 'custom', 'night', 'uncommon', '#2a2d33', 0.6],
    ['Bone Grip', 'anod', 'bodega', 'rare', '#e3ddcb', 0.4],
  ],
  golfclub: [
    ['Club House', 'patina', 'bodega', 'common', '#c8ccd2', 1],
    ['Bent Shaft', 'patina', 'dock', 'common', '#8a8f98', 0.8],
    ['Tour Chrome', 'anod', 'night', 'rare', '#eef3fa', 0.4],
  ],
  aegis: [
    ['Riot Grey', 'gunsmith', 'precinct', 'common', '#6a7078', 0.8],
    ['Blue Light', 'anod', 'precinct', 'uncommon', '#2a7fd0', 0.85, 1],
    ['Night Watch', 'anodmulti', 'night', 'rare', '#2a2f3a', 0.9],
    ['Floor Drone', 'custom', 'floor', 'epic', '#c8a03a', 1],
  ],
};
// Prices follow the grade, so a price and a grade can never disagree. Same ladder the shop already
// runs on (199 / 399 / 699 / 999 / 1499) -- nothing here invents a sixth step.
const ECON_GRADE_PRICE = { common: 199, uncommon: 399, rare: 699, epic: 999, legendary: 1499 };
function econMakeFinishes() {
  const out = [];
  for (const wid of Object.keys(ECON_FIN_SRC)) {
    for (const [name, style, coll, grade, color, metal, glow] of ECON_FIN_SRC[wid]) {
      out.push({
        id: 'sk_' + wid + '_' + name.toLowerCase().replace(/[^a-z0-9]+/g, ''),
        slot: 'skin', weapon: wid, name, style, collection: coll, grade,
        price: ECON_GRADE_PRICE[grade], color, metal, glow: glow || 0,
        icon: '\u{1F3A8}',
      });
    }
  }
  return out;
}
const ECON_CATALOG = {
  version: 4,
  // ---------------- weapons ----------------
  // price: US cents. tier: the shelf it sits on in the store.
  // unlock: the account level that grants it for free (null = money only).
  // counter: what beats it. Every weapon has one, written down, because "what beats this" is the
  // difference between a toy and a fighting-game tool.
  weapons: [
    // $15 shelf — cheap, huge personality, almost no raw power
    { id: 'fireaxe', kind: 'fireaxe', name: 'Fire Axe', price: 399, tier: 25, unlock: null, charges: 2, icon: '\u{1FA93}',
      blurb: 'Off the wall of a stairwell. Slow, heavy, and it sends people a long way.',
      how: 'Nearly double damage with heavy knockback, on a swing you have to commit to. Six swings.',
      counter: 'Bait the swing. The recovery is long enough to punish properly.' },
    { id: 'pipebomb', kind: 'pipebomb', name: 'Pipe Bomb', price: 399, tier: 25, unlock: null, charges: 2, icon: '\u{1F4A3}',
      blurb: 'Light it and throw it. Lands, waits a beat, takes the floor with it.',
      how: 'Lobbed on an arc with a fuse, so you are throwing it where they will BE, not where they are.',
      counter: 'You can see the fuse. Move, or shoot it out of the air and it goes off on them.' },
    { id: 'mine', kind: 'mine', name: 'Detonator', price: 399, tier: 30, unlock: null, charges: 2, icon: '\u{1F6A7}',
      blurb: 'Plant the charge, keep the remote. It goes off when YOU say.',
      how: 'First press plants a charge and leaves you holding the remote. Press again to set off everything you have planted. Two charges.',
      counter: 'You can see the charge blinking on the floor. Shoot it, or simply do not stand near it.' },
    { id: 'sweeper', kind: 'sweeper', name: 'Street Sweeper', price: 699, tier: 40, unlock: null, charges: 2, icon: '\u{1F4A5}',
      blurb: 'Eight pellets per shell. In someone\u2019s face it ends the argument.',
      how: 'Six shells, huge spread, enormous close damage that falls off to nothing past a few steps.',
      counter: 'Stay away. Past short range it is a noise-maker.' },
    { id: 'pipegun', kind: 'pipegun', name: 'Pipe Cannon', price: 999, tier: 50, unlock: null, charges: 1, icon: '\u{1F6E2}\uFE0F',
      blurb: 'A scaffold pole swung like a bat. Nearly double damage, huge launch.',
      how: 'The second hardest hit on the shelf with the second heaviest knockback, on a slow swing. Five swings.',
      counter: 'Slow. Shield it and take the whole recovery.' },
    { id: 'bolt', kind: 'bolt', name: 'Captive Bolt', price: 999, tier: 50, unlock: null, charges: 1, icon: '\u{1F529}',
      blurb: 'A cattle stunner on an air tank. You have to be touching them. Then it does not matter what they had.',
      how: 'The shortest range of anything that fires, and the hardest single hit in the game. Two shots, a long wind-up and a longer recovery.',
      counter: 'It cannot reach you. Stay at arm\u2019s length and it is a very expensive paperweight.' },
    { id: 'thunder', kind: 'thunder', name: 'Thunderbolt', price: 999, tier: 50, unlock: null, charges: 1, icon: '\u{26A1}',
      blurb: 'A held beam of lightning. It does not travel \u2014 it is just suddenly on them.',
      how: 'Fires continuously while held, hitting over and over with almost no knockback, so they stay in it. You cannot move much while firing.',
      counter: 'Knockback is tiny, which means YOU can still move. Walk out of the beam and it is doing nothing.' },
    { id: 'manhole', kind: 'manhole', name: 'Bear Trap', price: 999, tier: 50, unlock: null, charges: 1, icon: '\u{1F573}\uFE0F',
      blurb: 'Open the street under them. No damage, and that is not the point.',
      how: 'Does ZERO damage. It holds them in place, and what you do in that window is up to you.',
      counter: 'Watch the floor. It only catches you if you walk over it.' },
    { id: 'wreck', kind: 'wreck', name: 'Wrecking Ball', price: 1499, tier: 100, unlock: null, charges: 1, icon: '\u{1F3D7}\uFE0F',
      blurb: 'Mark a lane. A demolition ball comes through it and takes everything with it.',
      how: 'You pick the lane, then it falls. One use, and it will take a stock off anyone standing in it.',
      counter: 'You get a moment while they aim. Do not be in the lane.' },
    { id: 'zip', kind: 'zip', name: 'Zip Hook', price: 199, tier: 15, unlock: 10, charges: 3, icon: '🪝',
      blurb: 'Fire it up and forward and get yanked across the screen. Jumps reset.',
      how: 'Travels for about half a second, then pulls you to where it ended and gives your air jumps back.',
      counter: 'Nothing about it hurts. Punish the landing.' },

    // $20-50 shelf — the shadowed shelf
    { id: 'boots', kind: 'boots', name: 'Nitro Boots', price: 399, tier: 25, unlock: 18, charges: 2, icon: '🥾',
      blurb: 'A committed horizontal burn that runs people over. No brakes.',
      how: '6% on contact, and it will take you back from anywhere. You land helpless. 2 burns.',
      counter: 'It goes in a straight line and cannot stop. Shield, then punish the helpless landing.' },
    { id: 'flamer', kind: 'flamer', name: 'Flamethrower', price: 399, tier: 30, unlock: 30, charges: 2, icon: '🔥',
      blurb: 'A stream of burning fuel. No knockback, and it eats a shield alive.',
      how: 'A stream of fire for about a second. ~1.4% a tick, repeat hits. Two bursts.',
      counter: 'Stay outside about 200 px and it does literally nothing. Jump over it.' },
    { id: 'blaster', kind: 'blaster', name: 'Twin Nines', price: 399, tier: 25, unlock: null, charges: 2, icon: '\u{1F52B}',
      blurb: 'Light, fast shots you can chain into everything else you are doing.',
      how: 'Sixteen rounds, automatic, low knockback per shot. Barely slows you down while firing, so you can keep moving and keep the pressure on.',
      counter: 'Each shot is small. Shield through a burst and close the gap; it cannot stop you at range.' },
    { id: 'bow', kind: 'bow', name: 'Speargun', price: 699, tier: 40, unlock: null, charges: 2, icon: '\u{1F3F9}',
      blurb: 'Five arrows. Each one crosses the whole stage and takes a stock off the edge.',
      how: 'The longest range on the shelf with heavy knockback per arrow. Drawing it roots you in place for a moment.',
      counter: 'They cannot move while they draw. Close the distance or break the line of fire.' },
    { id: 'bat', kind: 'bat', name: 'Slugger', price: 1499, tier: 100, unlock: null, charges: 1, icon: '\u{1F3CF}',
      blurb: 'A bat off the back seat of a car. One swing and that stock is gone.',
      how: 'Over twice the damage and more than twice the knockback of a bare hit, on the slowest windup in the game. Four swings, then it is gone.',
      counter: 'You will see it coming from across the stage. Shield it or simply walk away and make them whiff.' },
    { id: 'medkit', kind: 'medkit', name: 'Med Kit', price: 199, tier: 15, unlock: 4, charges: 3, icon: '\u{1FA79}',
      blurb: 'Takes 45% straight back off. Deploy it when you are one hit from gone.',
      how: 'Used instantly, no holding it. Heals up to 45% damage; useless at low damage, so save it.',
      counter: 'Nothing beats it directly. Hit them before they can use it, or knock them out before the heal matters.' },
    { id: 'gloves', kind: 'gloves', name: 'Boxing Gloves', price: 399, tier: 30, unlock: null, charges: 2, icon: '\u{1F94A}',
      blurb: 'Every punch you throw lands like the last one of the fight.',
      how: 'Hold them and all your normal attacks hit for more than double, with far more knockback. Slightly slower windup. No ammo, they last the whole stock.',
      counter: 'Shield the first swing and punish the recovery, or just stay outside fist range and shoot.' },
    { id: 'ak', kind: 'ak', name: 'The Chopper', price: 699, tier: 40, unlock: null, charges: 2, icon: '\u{1F52B}',
      blurb: 'Twenty rounds, ten a second, and they go through whoever is behind you too.',
      how: 'Fully automatic at 600 rounds a minute with a 20 round magazine. Rounds pierce, so a lined-up pair both take it. The muzzle climbs the longer you hold it.',
      counter: 'Break the line of fire. It cannot turn as fast as it shoots, and a reload is the whole magazine.' },
    // THE DESERT EAGLE, 15 Oct. One round, and it does not kill: it leaves them at 160% with almost
    // no knockback, which in this game means the next thing that touches them takes the stock. The
    // card has to say that plainly or it reads as a dud when the first person fires it.
    { id: 'deagle', kind: 'deagle', name: 'Desert Eagle', price: 1499, tier: 100, unlock: null, charges: 1, icon: '\u{1F52B}',
      blurb: 'One round in the magazine. It does not kill them. It leaves them one hit from gone.',
      how: 'A single shot that puts whoever it lands on at 160% damage, however fresh they were, with almost no knockback of its own. You still have to land the finisher.',
      counter: 'There is one bullet and a long draw before it. Make them miss and the gun is spent for the rest of the stock.' },
    { id: 'aegis', kind: 'aegis', name: 'Riot Drone', price: 699, tier: 40, unlock: 25, charges: 1, icon: '🛰️',
      blurb: 'A little drone that shoots down the next three shots aimed at you.',
      how: 'Projectiles only, three of them, twelve seconds. It does nothing at all against a fist.',
      counter: 'Walk in and hit them. It is a zoning answer, not a defence.' },
    { id: 'freeze', kind: 'freeze', name: 'Taser', price: 699, tier: 40, unlock: null, charges: 2, icon: '❄️',
      blurb: 'Fifty thousand volts. They drop where they stand and you take your time.',
      how: '6% and a 1.2 s freeze. Two shots. The beam is fast but thin.',
      counter: 'Mash any direction and the ice breaks early. Shield the beam outright.' },
    { id: 'turret', kind: 'turret', name: 'Sentry Turret', price: 699, tier: 45, unlock: null, charges: 1, icon: '🔫',
      blurb: 'Put it down, walk away, and let it hold a lane for eight seconds.',
      how: 'Fires a 2.2% pellet every 0.4 s at whoever is nearest, up to 460 px. 26 hp.',
      counter: 'Break it — it has less health than one smash attack. Or stand outside its range.' },
    // ---- four added 2026-10-16, picked for the holes in the shelf ----------------------------
    { id: 'rebar', kind: 'rebar', name: 'Rebar', price: 199, tier: 15, unlock: null, charges: 2, icon: '\u{1F9EF}',
      blurb: 'A length of bar off a building site. It reaches further than anything else this cheap.',
      how: 'The longest reach under four dollars, on a fast thin swing. Low damage and almost no knockback, so it pokes rather than finishes.',
      counter: 'It barely moves you. Walk through the poke and punish inside its reach, where a bar is useless.' },
    { id: 'chain', kind: 'chain', name: 'Chain Whip', price: 399, tier: 30, unlock: null, charges: 2, icon: '\u{26D3}\uFE0F',
      blurb: 'Padlock on the end of a dog chain. Nothing on the shelf reaches further.',
      how: 'The longest reach in the game by a wide margin, with knockback that sends people off the side. It also has the slowest swing on the melee shelf.',
      counter: 'You can see the wind-up from across the stage. Shield it and take the whole recovery, or close inside the arc.' },
    { id: 'nailgun', kind: 'nailgun', name: 'Nail Gun', price: 399, tier: 30, unlock: null, charges: 2, icon: '\u{1FA9B}',
      blurb: 'A framing tool. It is the only thing here that eats a shield alive.',
      how: 'Eighteen nails a burst, light and piercing, and each one takes nearly double off a shield. Short range: it cannot do this from across the stage.',
      counter: 'Stop blocking and move. Outside about 300 px it does almost nothing, and each nail barely budges you.' },
    { id: 'buzzsaw', kind: 'buzzsaw', name: 'Buzzsaw', price: 699, tier: 40, unlock: null, charges: 2, icon: '\u{1FA9A}',
      blurb: 'A circular blade off a cut-off saw. It goes out, and it comes back.',
      how: 'Hits on the way out AND on the way home, so throwing it PAST somebody is the correct play. It returns to your hand on its own.',
      counter: 'The return path is a straight line to whoever threw it. Stand off that line and both legs miss.' },
    { id: 'toaster', kind: 'toaster', name: 'Toaster', price: 199, tier: 10, unlock: null, charges: 10, icon: '\u{1F35E}',
      blurb: 'Two slices, one setting. Off the counter and into the fight.',
      how: 'Almost no reach, but it SENDS. Cheapest thing on the shelf and it still launches people off the edge.',
      counter: 'Stay a step outside arm\u2019s length and it cannot touch you.' },
    { id: 'riotshield', kind: 'riotshield', name: 'Riot Shield', price: 399, tier: 30, unlock: null, charges: 10, icon: '\u{1F6E1}\uFE0F',
      blurb: 'Precinct issue. Absorbs four hits and bashes with the rest.',
      how: 'Picking it up puts a guard on you that eats the next FOUR hits. The bash barely hurts, but it sends.',
      counter: 'Four hits and the guard pops. Spend them on anything cheap, then fight them properly.' },
    { id: 'cardoor', kind: 'cardoor', name: 'Car Door', price: 699, tier: 35, unlock: null, charges: 8, icon: '\u{1F6AA}',
      blurb: 'Torn off a wreck, hinges and all.',
      how: 'The heavy shield: eats SIX hits, and the swing launches. Slow enough that they will see it coming.',
      counter: 'It swings like a door. Punish the recovery, do not trade with it.' },
    { id: 'warhammer', kind: 'warhammer', name: 'War Hammer', price: 999, tier: 50, unlock: null, charges: 4, icon: '\u{1F528}',
      blurb: 'The hardest single hit on the shelf.',
      how: 'Four swings, enormous damage and knockback on every one. Miss and you are wide open.',
      counter: 'The slowest swing in the game. Bait it, step in while it recovers.' },
    { id: 'chainsaw', kind: 'chainsaw', name: 'Chainsaw', price: 699, tier: 45, unlock: null, charges: 7, icon: '\u{1FA9A}',
      blurb: 'Starts on the second pull. Usually.',
      how: 'Grinds rather than launches: big damage, almost no knockback, so they stay in it instead of flying somewhere safe.',
      counter: 'Short reach. Anything with a handle outranges it.' },
    { id: 'katana', kind: 'katana', name: 'Katana', price: 699, tier: 40, unlock: null, charges: 6, icon: '\u{1F5E1}\uFE0F',
      blurb: 'Clean reach and a clean edge.',
      how: 'Best damage per swing that is not a hammer, and fast with it. Six swings and it is done.',
      counter: 'It breaks soonest of any blade. Make them spend the six.' },
    { id: 'nunchaku', kind: 'nunchaku', name: 'Nunchaku', price: 399, tier: 20, unlock: null, charges: 12, icon: '\u{1F94B}',
      blurb: 'Hardwood and cord. Faster than anything else here.',
      how: 'Twelve tiny hits, the fastest swing on the shelf. It chips rather than launches.',
      counter: 'No knockback at all. Walk through it and hit back harder.' },
    { id: 'machete', kind: 'machete', name: 'Machete', price: 399, tier: 22, unlock: null, charges: 9, icon: '\u{1F52A}',
      blurb: 'Honest steel. Does the job and keeps doing it.',
      how: 'A shorter, tougher katana: less damage per swing, nine of them instead of six.',
      counter: 'Mid reach and no launch. A longer weapon beats it for free.' },
    { id: 'golfclub', kind: 'golfclub', name: 'Golf Club', price: 399, tier: 25, unlock: null, charges: 7, icon: '\u{26F3}',
      blurb: 'Driver. Long shaft, lousy lie.',
      how: 'A launcher, not a killer: middling damage, near-hammer knockback, and fast. Send them off the edge.',
      counter: 'It barely hurts. Stay away from edges and it is an annoyance.' },
    { id: 'well', kind: 'well', name: 'Vortex Grenade', price: 999, tier: 50, unlock: null, charges: 1, icon: '🕳️',
      blurb: 'Throw it and the floor around it stops being a safe place to stand.',
      how: 'Pulls fighters AND projectiles toward it from 270 px, then bursts for 32%.',
      counter: 'It pulls you too. Hold away from it and it is survivable — or use the pull to come back.' },
  ],

  // ---------------- cosmetics ----------------
  // Zero gameplay effect, allowed in EVERY mode including money matches. This is the shelf that is
  // meant to make money, because it is the one that cannot poison a wager.
  cosmetics: [
    // weapon finishes: recolour every weapon you hold
    { id: 'fin_chrome', slot: 'finish', name: 'Chrome', price: 199, icon: '🪞', color: '#e8ecf4', metal: 1, blurb: 'Mirror-polished. Everything you pick up looks expensive.' },
    { id: 'fin_gold', slot: 'finish', name: 'Solid Gold', price: 699, icon: '🥇', color: '#ffc83a', metal: 1, blurb: 'Loud on purpose.' },
    { id: 'fin_toxic', slot: 'finish', name: 'Toxic', price: 399, icon: '☢️', color: '#7dff5a', metal: 0.3, glow: 1, blurb: 'Green, and slightly radioactive.' },
    { id: 'fin_carbon', slot: 'finish', name: 'Carbon', price: 399, icon: '⬛', color: '#23262e', metal: 0.7, blurb: 'Matte black weave. The quiet flex.' },
    { id: 'fin_vapor', slot: 'finish', name: 'Vaporwave', price: 399, icon: '🌴', color: '#ff4fd8', metal: 0.4, glow: 1, blurb: 'Pink and cyan, permanently 1994.' },
    { id: 'fin_rekt', slot: 'finish', name: 'Liquidation Red', price: 699, icon: '📉', color: '#ff1a3a', metal: 0.6, glow: 1, blurb: 'The colour of somebody else\'s portfolio.' },
    // auras: a light that follows you
    { id: 'aur_ember', slot: 'aura', name: 'Ember', price: 399, icon: '🔥', color: '#ff6a2a', blurb: 'Warm coals drifting off your shoulders.' },
    { id: 'aur_frost', slot: 'aura', name: 'Frost', price: 399, icon: '🧊', color: '#9fe8ff', blurb: 'Cold light and a drifting mist.' },
    { id: 'aur_volt', slot: 'aura', name: 'Voltage', price: 699, icon: '⚡', color: '#ffe84a', blurb: 'It crackles when you move.' },
    { id: 'aur_void', slot: 'aura', name: 'Void', price: 699, icon: '🌑', color: '#9a6cff', blurb: 'Light bends the wrong way around you.' },
    { id: 'aur_rain', slot: 'aura', name: 'Full Spectrum', price: 999, icon: '🌈', color: null, rainbow: 1, blurb: 'Every colour, all the time. Subtlety is for people who lose.' },
    // trails: the streak you leave when you are launched
    { id: 'trl_neon', slot: 'trail', name: 'Neon', price: 199, icon: '💫', color: '#ff2a4a', blurb: 'A hard red streak.' },
    { id: 'trl_ice', slot: 'trail', name: 'Ice', price: 199, icon: '❄️', color: '#9fe8ff', blurb: 'Shards that hang in the air.' },
    { id: 'trl_gold', slot: 'trail', name: 'Gold Dust', price: 399, icon: '✨', color: '#ffc83a', blurb: 'Money, falling.' },
    { id: 'trl_glitch', slot: 'trail', name: 'Glitch', price: 699, icon: '📺', color: '#27e1ff', blurb: 'The renderer giving up on you.' },
    // KO effects: what the screen does when you send somebody off
    { id: 'ko_rain', slot: 'ko', name: 'Gold Rain', price: 699, icon: '🪙', color: '#ffc83a', blurb: 'Coins rain down where they used to be.' },
    { id: 'ko_liq', slot: 'ko', name: 'Liquidated', price: 699, icon: '📉', color: '#ff1a3a', blurb: 'A red candle drops through the blast zone.' },
    { id: 'ko_nova', slot: 'ko', name: 'Supernova', price: 999, icon: '💥', color: '#fff3b0', blurb: 'White out, then a ring that fills the screen.' },
    { id: 'ko_conf', slot: 'ko', name: 'Confetti', price: 399, icon: '🎉', color: '#ff4fd8', blurb: 'Party poppers. Deeply disrespectful.' },
    // victory poses
    { id: 'vic_flex', slot: 'pose', name: 'Flex', price: 199, icon: '💪', clip: 'taunt', blurb: 'Both arms. Held far too long.' },
    { id: 'vic_diamond', slot: 'pose', name: 'Diamond Hands', price: 699, icon: '💎', clip: 'guard', blurb: 'Hands up, fists closed, never selling.' },
    { id: 'vic_throne', slot: 'pose', name: 'Throne', price: 999, icon: '👑', clip: 'victory2', blurb: 'A chair appears. You sit in it.' },
    // name plates: the frame around your name on the HUD, the lobby and the board
    { id: 'plt_degen', slot: 'plate', name: 'Degen', price: 199, icon: '🎰', color: '#ff2a4a', blurb: 'Red bracket, permanently tilted.' },
    { id: 'plt_whale', slot: 'plate', name: 'Whale', price: 699, icon: '🐋', color: '#27e1ff', blurb: 'A plate that says you did not check the price.' },
    { id: 'plt_found', slot: 'plate', name: 'Founder', price: 1499, icon: '🏛️', color: '#ffc83a', blurb: 'Only while the game is new. It never comes back.' },

    // ---- KO effects, taken to twelve 2026-10-16 ----------------------------------------------
    // The research said this is the strongest category in a brawler and we were shipping four of
    // them: the KO is the half second every player in the match is watching, and Brawlhalla sells
    // exactly this category as a headline. Each one is drawn in src/98_v3_econ.mjs `koEffect()`.
    { id: 'ko_bell', slot: 'ko', name: 'Closing Bell', price: 999, icon: '🔔', color: '#c8a03a', blurb: 'The bell goes. A brass ring fills the screen and the stage flashes white.' },
    { id: 'ko_cash', slot: 'ko', name: 'Cash Cannon', price: 699, icon: '💵', color: '#2fbf6a', blurb: 'A wall of notes blows across the screen and keeps going.' },
    { id: 'ko_lamp', slot: 'ko', name: 'Street Light', price: 399, icon: '🏮', color: '#ffb347', blurb: 'Every light on the stage flickers and cuts out for a beat.' },
    { id: 'ko_siren', slot: 'ko', name: 'Siren Wash', price: 699, icon: '🚨', color: '#2a6aff', blurb: 'Red and blue washes over the whole stage. Somebody called it in.' },
    { id: 'ko_chalk', slot: 'ko', name: 'Chalk Outline', price: 699, icon: '🥢', color: '#e8edf4', blurb: 'An outline is left on the floor for the rest of the match.' },
    { id: 'ko_spark', slot: 'ko', name: 'Spark Shower', price: 399, icon: '✨', color: '#ffd36a', blurb: 'Grinder sparks, long falloff, warm.' },
    { id: 'ko_smoke', slot: 'ko', name: 'Smoke Signal', price: 399, icon: '💨', color: '#9aa4b2', blurb: 'A thick column goes up and drifts off the top of the screen.' },
    { id: 'ko_drop', slot: 'ko', name: 'Manhole Drop', price: 1499, icon: '🕳️', color: '#5a5048', blurb: 'A cover swings open under them and the street takes them.' },

    // ---- taunts. Fortnite carries 2,072 emotes and they outsell outfits, for one reason: an
    // emote is seen by everyone in the lobby and costs a fraction of a character to make. Ours ride
    // clips the rig already carries (src/97_v3_pose.mjs), so a taunt is an animation and a name.
    //
    // EVERY `clip` BELOW IS A CLIP THE RIG ACTUALLY CARRIES (assets/anims.json, 28 of them). A taunt
    // named for an animation that does not exist is a taunt that silently plays `idle`, which is the
    // same class of mistake as a weapon called Speargun that renders a recurve bow. `rate` is the
    // playback speed and `hold` the seconds it is held after the clip ends. Checked by
    // `dev/weapon_test.js` case `_market`, which fails the build if a taunt names a missing clip.
    { id: 'tnt_bow', slot: 'taunt', name: 'Take a Bow', price: 199, icon: '🙇', clip: 'victory2', rate: 0.8, hold: 0.5, blurb: 'Slow, low, and far too polite for a street fight.' },
    { id: 'tnt_flex', slot: 'taunt', name: 'Double Flex', price: 199, icon: '💪', clip: 'taunt', rate: 1, hold: 0.4, blurb: 'Both arms, held about two seconds too long.' },
    { id: 'tnt_point', slot: 'taunt', name: 'Point Them Out', price: 199, icon: '👉', clip: 'cast', rate: 1.1, hold: 0.6, blurb: 'Straight arm, straight at them. No words needed.' },
    { id: 'tnt_clap', slot: 'taunt', name: 'Slow Clap', price: 399, icon: '👏', clip: 'fists2', rate: 0.55, hold: 0.3, blurb: 'Every beat of it an insult.' },
    { id: 'tnt_shrug', slot: 'taunt', name: 'Shrug It Off', price: 199, icon: '🤷', clip: 'block2', rate: 0.7, hold: 0.5, blurb: 'Arms out. It was never close.' },
    { id: 'tnt_wave', slot: 'taunt', name: 'Wave Goodbye', price: 399, icon: '👋', clip: 'cast2', rate: 0.9, hold: 0.6, blurb: 'A small wave, held while they fall.' },
    { id: 'tnt_spin', slot: 'taunt', name: 'Showboat Spin', price: 399, icon: '🌀', clip: 'spin', rate: 1, hold: 0.2, blurb: 'A full turn, for nobody in particular.' },
    { id: 'tnt_guard', slot: 'taunt', name: 'Come On', price: 399, icon: '🥊', clip: 'guard', rate: 1, hold: 0.9, blurb: 'Guard up, and an invitation. Ask for it.' },
    { id: 'tnt_stomp', slot: 'taunt', name: 'Stomp', price: 699, icon: '🦶', clip: 'slam', rate: 0.9, hold: 0.3, blurb: 'One foot into the floor. The stage hears it.' },
    { id: 'tnt_sweep', slot: 'taunt', name: 'Sweep the Leg', price: 699, icon: '🦵', clip: 'sweep', rate: 1.1, hold: 0.2, blurb: 'A clean low sweep through empty air.' },
    { id: 'tnt_roll', slot: 'taunt', name: 'Roll Through', price: 199, icon: '🤸', clip: 'roll2', rate: 1.2, hold: 0.1, blurb: 'Straight past them and back up. Nothing touched you.' },
    { id: 'tnt_hang', slot: 'taunt', name: 'Hang Loose', price: 699, icon: '🤙', clip: 'hang', rate: 0.8, hold: 0.8, blurb: 'Loose, slack, completely unbothered.' },

    // ---- titles. TF2 has sold name tags for fifteen years and the art budget is zero. A title
    // sits under the name on the versus screen, the HUD plate and the results card.
    { id: 'ttl_regular', slot: 'title', name: 'The Regular', price: 199, icon: '🏷️', blurb: 'In here every night.' },
    { id: 'ttl_nightshift', slot: 'title', name: 'Night Shift', price: 199, icon: '🏷️', blurb: 'Works while everyone else is asleep.' },
    { id: 'ttl_closer', slot: 'title', name: 'The Closer', price: 399, icon: '🏷️', blurb: 'Last one standing, every time.' },
    { id: 'ttl_floor', slot: 'title', name: 'Floor Trader', price: 399, icon: '🏷️', blurb: 'Loud, fast, and usually right.' },
    { id: 'ttl_landlord', slot: 'title', name: 'Landlord', price: 699, icon: '🏷️', blurb: 'Owns the stage you are standing on.' },
    { id: 'ttl_bellringer', slot: 'title', name: 'Bell Ringer', price: 699, icon: '🏷️', blurb: 'Opens the day and ends the argument.' },
    { id: 'ttl_blockcapt', slot: 'title', name: 'Block Captain', price: 399, icon: '🏷️', blurb: 'Nothing happens on this street without you.' },
    { id: 'ttl_houseedge', slot: 'title', name: 'House Edge', price: 999, icon: '🏷️', blurb: 'The odds were never yours.' },
  ],

  // ---------------- weapon finishes (CS2 skins) ----------------
  // Built from ECON_FIN_SRC above: 101 named finishes across all 22 weapons, each with the finish
  // STYLE that produced it and the collection it belongs to. Equipped PER WEAPON, like CS2, not as
  // one universal recolour: `Econ.skinFor(kind)` resolves which one the renderer should use.
  skins: econMakeFinishes(),

  // ---------------- bundles ----------------
  // Bundles removed 15 Oct on Duane's call. They were also the last thing in here priced in the
  // old credits economy, which is how all three ended up costing MORE than their contents.
  bundles: [],

  // ---------------- THE VAULT: the secret, paid content ----------------
  // Duane, 2026-10-16: *"you should make 2 of the maps be a shadow with a question mark and make
  // them purchaseable to unlock like secret maps"*, then *"also make one of the characters a secret
  // one choose one that seems the most like mew/mewto put it dark and make it unlockable by paying"*.
  //
  // All three were ALREADY BUILT and gated off by `CORE_SET` in 79_core.js -- Shadow Keep and Neon
  // Rooftop are the two hidden stages that carry their own night light rigs (dev/NOTES-stages.md),
  // and OMEN is the roster's "Psi Clone": tall, floaty, shadow orb, teleport, disable. Nothing here
  // is new content behind a paywall; it is finished content that had no way in.
  //
  // WHY THESE THREE AND NOT THE OTHER FOUR HIDDEN STAGES: a paid item has to be the good one. Of the
  // six stages that ship in neither picker, Shadow Keep and Neon Rooftop are the only two with
  // finished light rigs; Trading Floor, Lunar Base, High Roller and Bullet Express are all pending a
  // relight, and selling a stage that needs work is how a shop loses somebody for good.
  //
  // `unlocks` is a STAGE id or a FIGHTER id, and it is the only thing the gate reads. The
  // entitlement id (`v_*`) is what the server stores, so renaming a stage never orphans a purchase.
  //
  // ranked: whether the thing is legal in a WAGERED or RANKED match.
  //   - a stage is `true`: both players fight on it, so there is no asymmetry to exploit. The owner
  //     picking it is the only difference, and that is the same as any stage pick.
  //   - the fighter is `true` as well, which is the Smash DLC precedent (every paid Ultimate fighter
  //     is tournament legal). It is a flag rather than a hard-coded answer so one edit reverses it.
  //   Either way the FAIRNESS RULE at the top of this file is untouched: nothing in the vault carries
  //   a weapon, a charge or a combat number, and `_vault` in dev/weapon_test.js fails the build if
  //   that ever stops being true.
  vault: [
    { id: 'v_stage_keep', kind: 'stage', unlocks: 'keep', price: 699, grade: 'rare', ranked: true,
      name: 'Shadow Keep', sub: 'Two lantern-lit gates over fogged stone',
      blurb: 'A cedar and bamboo forest at night, a crooked torii, stone lanterns and a shrine. The darkest stage in the game and the only one lit entirely by flame.',
      how: 'Two gates over fogged stone, so every recovery is read against a black backdrop. It plays slower and closer than anything in the open picker.' },
    { id: 'v_stage_roof', kind: 'stage', unlocks: 'roof', price: 699, grade: 'rare', ranked: true,
      name: 'Neon Rooftop', sub: 'Helipad over a city at night',
      blurb: 'A helipad on top of a tower, the city burning away underneath it in red and cyan. Nothing between the edge of the pad and the ground.',
      how: 'One wide platform with no cover and a long fall on both sides. The cleanest stage on the roster for a launch KO.' },
    { id: 'v_char_omen', kind: 'fighter', unlocks: 'omen', price: 999, grade: 'epic', ranked: true,
      name: 'OMEN', sub: 'Psi Clone',
      blurb: 'Tall, floaty, and built out of somebody else. Shadow orb, teleport, disable.',
      how: 'Teleport closes any gap and the disable turns a blocked approach into a free opening. Floats, so it wins the air and loses the trade on the ground.' },
  ],

  // ================= THE MARKET =================
  // Everything a shop needs that we did not have: a clock, a grade ladder written in words, wear,
  // collections, a series axis, named shelves and a public verdict per item.

  // ---- the grade ladder, one for the whole game -------------------------------------------
  // CS2 writes the grade out in a filled pill ("Covert Rifle") instead of leaving the player to
  // learn what purple means, and it carries TWO names: the in-game one and the market one. Colours
  // here are CS2's own, because a player who has seen one market already knows them.
  grades: [
    { id: 'common',    name: 'Street',    market: 'Base Grade',    color: '#b0c3d9', price: 199,  star: 0 },
    { id: 'uncommon',  name: 'Uncommon',  market: 'Medium Grade',  color: '#4b69ff', price: 399,  star: 0 },
    { id: 'rare',      name: 'Rare',      market: 'High Grade',    color: '#8847ff', price: 699,  star: 0 },
    { id: 'epic',      name: 'Epic',      market: 'Remarkable',    color: '#d32ce6', price: 999,  star: 0 },
    { id: 'legendary', name: 'Legendary', market: 'Extraordinary', color: '#eb4b4b', price: 1499, star: 1 },
    // Contraband: pulled from the drop pool and never coming back. Supply is fixed from that day on,
    // which is the whole reason the CS:GO Weapon Case is $96 and the Kilowatt Case is $0.08.
    { id: 'pulled',    name: 'Pulled',    market: 'Contraband',    color: '#e4ae39', price: null, star: 1 },
  ],

  // ---- CONDITION. The biggest catalogue multiplier there is -------------------------------
  // CS2 ships every skin in five wear steps with a hidden float, and each step has its own price.
  // Four finishes on a weapon is four products; four finishes x five conditions is twenty. The
  // float is rolled once when the item is minted and never changes.
  conditions: [
    { id: 'mint',    name: 'Mint',    short: 'MT', lo: 0.00, hi: 0.07, mul: 1.00, color: '#3ddc84' },
    { id: 'clean',   name: 'Clean',   short: 'CL', lo: 0.07, hi: 0.15, mul: 0.82, color: '#8ad44a' },
    { id: 'scuffed', name: 'Scuffed', short: 'SC', lo: 0.15, hi: 0.38, mul: 0.68, color: '#d6c23a' },
    { id: 'beat',    name: 'Beat',    short: 'BT', lo: 0.38, hi: 0.45, mul: 0.57, color: '#e08a3c' },
    { id: 'gutted',  name: 'Gutted',  short: 'GT', lo: 0.45, hi: 1.00, mul: 0.46, color: '#c4542f' },
  ],

  // ---- the seven finish styles, which double as the render brief ---------------------------
  // CS2 groups skins by HOW they were painted, and prints it on the item page. It is the single
  // most useful field on that page for us, because it is also the instruction we hand the forge.
  finishStyles: [
    { id: 'gunsmith',  name: 'Gunsmith',    blurb: 'Painted panels with masked hard edges, bare metal showing at the wear points.' },
    { id: 'hydro',     name: 'Hydrographic', blurb: 'A printed pattern wrapped over the whole shape, distorting where it curves.' },
    { id: 'patina',    name: 'Patina',      blurb: 'Aged metal. Dark in the recesses, polished on the high points.' },
    { id: 'anod',      name: 'Anodized',    blurb: 'Coloured metal, high specular, no texture. Pure form.' },
    { id: 'anodmulti', name: 'Anodized Multicoloured', blurb: 'Anodized with a second colour masked in on a hard boundary.' },
    { id: 'custom',    name: 'Custom Paint Job', blurb: 'Hand painted across the body, matte, with a clear coat over it.' },
    { id: 'spray',     name: 'Spray Paint', blurb: 'Flat, overspray at the edges, stencil marks and tape lines.' },
  ],

  // ---- collections. Every item belongs to a named set, and the set links to its other items.
  // This is the mechanic that turns one purchase into five. `retire` is the quarter it leaves the
  // drop pool for good: a collection that can never drop again is an appreciating asset and it
  // costs us nothing to make.
  collections: [
    { id: 'bodega',   name: 'The Bodega Collection',  color: '#d9a441', blurb: 'Warm, gold, tiled. The corner store at two in the morning.' },
    { id: 'night',    name: 'Night Shift Collection', color: '#2f3f52', blurb: 'Blued steel, hazard orange, sodium light.' },
    { id: 'boiler',   name: 'Boiler Room Collection', color: '#c87a3a', blurb: 'Copper, steam and pressure gauges.' },
    { id: 'floor',    name: 'The Floor Collection',   color: '#c8a03a', blurb: 'The trading floor. Brass, paper, navy and pinstripe.' },
    { id: 'scaffold', name: 'Scaffold Collection',    color: '#f2b705', blurb: 'Galvanised, safety yellow, mesh.' },
    { id: 'dock',     name: 'Dock 9 Collection',      color: '#2a6f8f', blurb: 'Salt, rust, rope and deep green.' },
    { id: 'precinct', name: 'Precinct 12 Collection', color: '#2a5fd0', blurb: 'Grey, blue line, polycarbonate.' },
  ],

  // ---- the series axis, which sits ABOVE the grade ----------------------------------------
  // Fortnite runs Icon / Marvel / Gaming Legends / Dark / Frozen on top of Common-to-Legendary, and
  // the series owns the card background instead of the grade. Ours are four we fully control.
  series: [
    { id: 'founder', name: 'Founder Series', color: '#ffc83a', blurb: 'Only while the game is new. It never comes back.' },
    { id: 'arena',   name: 'Arena Series',   color: '#27e1ff', blurb: 'Only drops from a wagered or ranked match, stamped with the fight.' },
    { id: 'crew',    name: 'Crew Series',    color: '#ff2a4a', blurb: 'Worn by a crew. You are either in it or you are not.' },
    { id: 'pulled',  name: 'Pulled Series',  color: '#e4ae39', blurb: 'Retired. Supply is fixed and nothing new is coming.' },
  ],

  // ---- the shop itself ----------------------------------------------------------------------
  shop: {
    // Fortnite's whole shop is a countdown and it is the single highest-return thing in the
    // teardown: a reset clock at the top, a countdown on every card, and a LEAVING TODAY badge
    // under 24 hours. 00:00 UTC is 07:00 in Bangkok, which is where Duane is.
    resetHour: 0,
    // how long an item stays on the daily shelf before it rotates off, in days
    runDays: 7,
    // how many items the rotating shelf carries, and how many of them are brand new each day
    shelfSize: 18,
    // Fortnite promotes by making the TILE wider and has no FEATURED badge anywhere. Three widths.
    tiles: [{ id: 'small', cols: 1 }, { id: 'wide', cols: 2 }, { id: 'hero', cols: 4 }],
    // the public verdict, five reactions, on a hot-to-cold bar under every card. It is community
    // moderation of our own catalogue and it tells us what to build next.
    reactions: [
      { id: 'fire', e: '\u{1F525}', name: 'Fire',  color: '#ff3a1a' },
      { id: 'love', e: '\u{1F60D}', name: 'Love',  color: '#ff5a4a' },
      { id: 'meh',  e: '\u{1F610}', name: 'Meh',   color: '#c86a4a' },
      { id: 'yuck', e: '\u{1F92E}', name: 'Yuck',  color: '#a05a3a' },
      { id: 'poo',  e: '\u{1F4A9}', name: 'Bin',   color: '#6a4a33' },
    ],
    // named shelves, not categories. "Rare" is a database field; "Closing Bell" is a reason to
    // look. One is featured each day, picked from the date so every client agrees without a server.
    shelves: [
      { id: 'closing',  name: 'Closing Bell',  sub: 'Whatever is leaving tonight' },
      { id: 'nightsh',  name: 'Night Shift',   sub: 'Blued steel and sodium light' },
      { id: 'floor',    name: 'The Floor',     sub: 'Brass, paper and pinstripe' },
      { id: 'scaffold', name: 'Scaffold Season', sub: 'Galvanised and safety yellow' },
      { id: 'dock',     name: 'Dock 9',        sub: 'Salt, rust and deep green' },
      { id: 'bodega',   name: 'Open All Night', sub: 'The corner store shelf' },
    ],
  },

  // ---------------- progression ----------------
  // XP is earned by PLAYING, never bought. Levels unlock the cheap and mid shelves for free, which is
  // what keeps a non-paying player in the game long enough to become a paying one.
  xp: { match: 50, win: 60, ko: 12, damage: 0.25, firstOfDay: 150, perLevel: 420, curve: 1.18 },
  // stages and features gated on level (the stages session reads `shibuya`)
  unlocks: { shibuya: 12 },
  // ---------------- monthly season ----------------
  // ================= THE LOCKER: gear, cases, keys, unusuals =================
  // Duane, 2026-10-15, after a sweep of ten shops that sell wearables:
  //   "Sell by body slot. Keep the boxes. One rare roll on a common item. A KO counter welded to the
  //    item. Push KO effects hardest."
  //
  // Each line below is lifted from a market that has run for years, not invented here:
  //   * SLOTS come from Dota 2 (a Slot filter: head, shoulder, back) and Decentraland (Head, Upper
  //     Body, Handwear, Lower Body, Feet). One fighter becomes six sales instead of one.
  //   * CRATE + KEY is Team Fortress 2, 2010. The crate drops free from playing and is worth pennies;
  //     the KEY is the product. It converts time played into money without ever selling power.
  //   * UNUSUAL is the single highest-leverage mechanic in any of those shops. The SAME hat, plus a
  //     particle effect that almost never drops, goes from $2 to $440 on the Steam market. We already
  //     render auras and trails, so the effect layer existed before the idea did.
  //   * THE COUNTER is TF2's Strange and CS2's StatTrak: a number welded to your copy that only your
  //     copy has. Here it counts KOs, because that is the number this game is about.
  //
  // Nothing in here touches damage, reach or knockback. Gear is cosmetic in every mode, including the
  // wagered arena, and `_rails` in dev/weapon_test.js fails the build if that ever stops being true.
  locker: {
    // ---- the six slots, in the order the locker shows them ----
    slots: [
      { id: 'hat',   name: 'Head',  icon: '\u{1F3A9}' },
      { id: 'eyes',  name: 'Eyes',  icon: '\u{1F576}\uFE0F' },
      { id: 'neck',  name: 'Neck',  icon: '\u{1F4FF}' },
      { id: 'hands', name: 'Hands', icon: '\u{1F9E4}' },
      { id: 'feet',  name: 'Feet',  icon: '\u{1F45F}' },
      { id: 'back',  name: 'Back',  icon: '\u{1F392}' },
      // ---- added 2026-10-16 ----
      // GUARD is the slot Duane asked for by name: "i like the shields btw". It rides on the back
      // when idle and comes up on a block, so it is on screen the entire match whether it is being
      // used or not -- which is the whole visibility argument in one object. Cosmetic: it reskins
      // the guard that already exists and changes no number a hitbox can see.
      { id: 'guard', name: 'Shield', icon: '\u{1F6E1}️' },
      // CHARM is the CS2 sleeper. A 2 cm object on a chain off the grip, added to CS2 in 2024 and
      // now its own nav category, trading from $0.12 to $106. It is the cheapest geometry in the
      // game per dollar and it sells to the player who will never spend $14.99.
      { id: 'charm', name: 'Charm', icon: '\u{1F517}' },
    ],


    // ---- the crate. Earned by playing, never sold. ----
    // `every` matches played earns one, up to `cap` held at once, so a player who stops playing stops
    // earning and a player who never pays still fills a locker eventually.
    crate: { id: 'crate', name: 'Street Crate', every: 3, cap: 20, icon: '\u{1F4E6}',
             blurb: 'Drops free for playing. Open it.' },

    // ---- the odds, which are published because a market where the odds are hidden is a casino ----
    // Shaped on Counter-Strike's case table: the overwhelming majority of opens are the cheap tier,
    // and that is what makes the top tier worth anything.
    odds: [
      { tier: 'common',    p: 0.7992, name: 'Common',    color: '#8d99a7' },
      { tier: 'uncommon',  p: 0.1598, name: 'Uncommon',  color: '#4b8bff' },
      { tier: 'rare',      p: 0.0320, name: 'Rare',      color: '#a16bff' },
      { tier: 'epic',      p: 0.0064, name: 'Epic',      color: '#ff4fd8' },
      { tier: 'legendary', p: 0.0026, name: 'Legendary', color: '#ffb020' },
    ],
    // The orthogonal roll, on top of whatever tier came out. This is the TF2 Unusual: it does not
    // change WHICH item you got, only whether it is on fire. 1 in 100.
    unusualChance: 0.01,

    // ---- the effects an Unusual roll can land, drawn from particle work that already exists ----
    unusuals: [
      { id: 'u_ember',   name: 'Street Steam', color: '#ff6a2a', w: 20 },
      { id: 'u_frost',   name: 'Frostbite',    color: '#7fd8ff', w: 20 },
      { id: 'u_volt',    name: 'Neon Static',  color: '#8dff2b', w: 18 },
      { id: 'u_gold',    name: 'Gold Dust',    color: '#ffc83a', w: 14 },
      { id: 'u_void',    name: 'Ash Cloud',    color: '#b06ad8', w: 12 },
      { id: 'u_static',  name: 'Ticker Tape',  color: '#d8d2c0', w: 10 },
      { id: 'u_nebula',  name: 'Siren Wash',   color: '#ff4fd8', w: 5 },
      { id: 'u_eclipse', name: 'Blue Flame',   color: '#2fe8c0', w: 1 },   // 1 in 100 of 1 in 100
    ],

    // ---- the gear itself. Roblox's catalogue is the shape here: a cap is its own item, and a look
    // is assembled from several cheap pieces rather than bought as one outfit. ----
    //
    // `wear` IS THE WHOLE POINT OF THIS FIELD, added 2026-10-15. Every line below now names the
    // creator group and kind that actually renders on the fighter (src/86_custom.js), so owning a
    // piece and wearing it are the same object rather than two catalogues that happen to share a
    // name. Before this the locker sold 27 items and the fighter could render none of them: nine had
    // no attachment point at all (hands and back did not exist), and six had no mesh behind them.
    // Both have been fixed rather than papered over -- `visor`, `fedora`, `cans`, `pilot`, `wreath`,
    // `patch` and `tags` are new meshes, and `scarf`, `shutter` and `monocle` are existing ones that
    // were unreachable. Nothing here points at a mesh that does not exist.
    //
    // A piece is only OFFERED on a body the harness measured it clean on (HAT_FIT / EYES_FIT /
    // NECK_FIT / HAND_FIT / BACK_FIT in 86_custom.js), so `fit` below is the measured coverage at the
    // time of writing, out of 48 bodies, and the store shows it. It is documentation, not a gate: the
    // gate is the table, and `CustomLook.fitsBody(id, base)` is the one function that answers it.
    gear: [
      // HEAD
      { id: 'g_visor',    slot: 'hat',   tier: 'common',    name: 'Visor',          icon: '\u{1F9E2}' , wear: { slot: 'hat', kind: 'visor' }, fit: 35 },
      { id: 'g_snapback', slot: 'hat',   tier: 'common',    name: 'Snapback',       icon: '\u{1F9E2}' , wear: { slot: 'hat', kind: 'cap' }, fit: 35 },
      { id: 'g_fedora',   slot: 'hat',   tier: 'uncommon',  name: 'Fedora',         icon: '\u{1F3A9}' , wear: { slot: 'hat', kind: 'fedora' }, fit: 33 },
      { id: 'g_cans',     slot: 'hat',   tier: 'uncommon',  name: 'Headphones',     icon: '\u{1F3A7}' , wear: { slot: 'hat', kind: 'cans' }, fit: 32 },
      { id: 'g_pilot',    slot: 'hat',   tier: 'rare',      name: 'Pilot Cap',      icon: '\u{1F9E2}' , wear: { slot: 'hat', kind: 'pilot' }, fit: 36 },
      { id: 'g_wreath',   slot: 'hat',   tier: 'legendary', name: 'Laurel Wreath',  icon: '\u{1F33F}' , wear: { slot: 'hat', kind: 'wreath' }, fit: 30 },
      // ---- 2026-10-16: THE OTHER THIRTEEN HATS -------------------------------------------------
      // The creator has carried nineteen head pieces since September and the locker was selling six
      // of them. Every one below is an existing mesh with an existing measured row in HAT_FIT, so
      // this is thirteen finished items for the cost of thirteen lines. Checked, not assumed: the
      // `fit` numbers are what `SLOTS=hat node dev/gearcheck.mjs` wrote.
      { id: 'g_backcap',  slot: 'hat',   tier: 'common',    name: 'Cap Backwards',  icon: '\u{1F9E2}' , wear: { slot: 'hat', kind: 'backcap' }, fit: 34, collection: 'night' },
      { id: 'g_trucker',  slot: 'hat',   tier: 'common',    name: 'Trucker',        icon: '\u{1F9E2}' , wear: { slot: 'hat', kind: 'trucker' }, fit: 35, collection: 'dock' },
      { id: 'g_beanie',   slot: 'hat',   tier: 'common',    name: 'Beanie',         icon: '\u{1F9E3}' , wear: { slot: 'hat', kind: 'beanie' }, fit: 36, collection: 'night' },
      { id: 'g_bucket',   slot: 'hat',   tier: 'common',    name: 'Bucket Hat',     icon: '\u{1FAA3}' , wear: { slot: 'hat', kind: 'bucket' }, fit: 32, collection: 'bodega' },
      { id: 'g_band',     slot: 'hat',   tier: 'common',    name: 'Sweatband',      icon: '\u{1F3BD}' , wear: { slot: 'hat', kind: 'band' }, fit: 35, collection: 'precinct' },
      { id: 'g_bandana',  slot: 'hat',   tier: 'uncommon',  name: 'Bandana',        icon: '\u{1FA96}' , wear: { slot: 'hat', kind: 'bandana' }, fit: 36, collection: 'night' },
      { id: 'g_ninja',    slot: 'hat',   tier: 'uncommon',  name: 'Kung-Fu Band',   icon: '\u{1F94B}' , wear: { slot: 'hat', kind: 'ninja' }, fit: 36, collection: 'night' },
      { id: 'g_cowboy',   slot: 'hat',   tier: 'uncommon',  name: 'Cowboy Hat',     icon: '\u{1F920}' , wear: { slot: 'hat', kind: 'cowboy' }, fit: 31, collection: 'dock' },
      { id: 'g_tophat',   slot: 'hat',   tier: 'rare',      name: 'Top Hat',        icon: '\u{1F3A9}' , wear: { slot: 'hat', kind: 'tophat' }, fit: 32, collection: 'floor' },
      { id: 'g_kabuto',   slot: 'hat',   tier: 'rare',      name: 'Kabuto',         icon: '\u{1FA96}' , wear: { slot: 'hat', kind: 'kabuto' }, fit: 33, collection: 'scaffold' },
      { id: 'g_horns',    slot: 'hat',   tier: 'epic',      name: 'Devil Horns',    icon: '\u{1F608}' , wear: { slot: 'hat', kind: 'horns' }, fit: 33, collection: 'night' },
      { id: 'g_halo',     slot: 'hat',   tier: 'epic',      name: 'Halo',           icon: '\u{1F607}' , wear: { slot: 'hat', kind: 'halo' }, fit: 38, collection: 'floor' },
      { id: 'g_crown',    slot: 'hat',   tier: 'legendary', name: 'Royal Crown',    icon: '\u{1F451}' , wear: { slot: 'hat', kind: 'crown' }, fit: 27, collection: 'floor' },
      // EYES
      { id: 'g_aviators', slot: 'eyes',  tier: 'common',    name: 'Aviators',       icon: '\u{1F576}\uFE0F' , wear: { slot: 'eyes', kind: 'aviator' }, fit: 43 },
      { id: 'g_shutter',  slot: 'eyes',  tier: 'uncommon',  name: 'Shutter Shades', icon: '\u{1F576}\uFE0F' , wear: { slot: 'eyes', kind: 'shutter' }, fit: 38 },
      { id: 'g_patch',    slot: 'eyes',  tier: 'rare',      name: 'Eyepatch',       icon: '\u{1F3F4}' , wear: { slot: 'eyes', kind: 'patch' }, fit: 26 },
      { id: 'g_monocle',  slot: 'eyes',  tier: 'epic',      name: 'Monocle',        icon: '\u{1F50D}' , wear: { slot: 'eyes', kind: 'monocle' }, fit: 42 },
      // the four the creator had and the locker never sold, all measured in EYES_FIT
      { id: 'g_rayban',   slot: 'eyes',  tier: 'common',    name: 'Thick Rims',     icon: '\u{1F453}' , wear: { slot: 'eyes', kind: 'rayban' }, fit: 43, collection: 'bodega' },
      { id: 'g_mafia',    slot: 'eyes',  tier: 'uncommon',  name: 'Mafia Shades',   icon: '\u{1F576}\uFE0F' , wear: { slot: 'eyes', kind: 'mafia' }, fit: 40, collection: 'floor' },
      { id: 'g_goggles',  slot: 'eyes',  tier: 'uncommon',  name: 'Ski Goggles',    icon: '\u{1F97D}' , wear: { slot: 'eyes', kind: 'goggles' }, fit: 42, collection: 'scaffold' },
      { id: 'g_shades',   slot: 'eyes',  tier: 'rare',      name: 'Pixel Shades',   icon: '\u{1F576}\uFE0F' , wear: { slot: 'eyes', kind: 'shades' }, fit: 43, collection: 'night' },
      // NECK
      { id: 'g_chain',    slot: 'neck',  tier: 'common',    name: 'Gold Chain',     icon: '\u{1F4FF}' , wear: { slot: 'neck', kind: 'gold' }, fit: 28 },
      { id: 'g_scarf',    slot: 'neck',  tier: 'common',    name: 'Scarf',          icon: '\u{1F9E3}' , wear: { slot: 'neck', kind: 'scarf' }, fit: 32 },
      { id: 'g_tags',     slot: 'neck',  tier: 'uncommon',  name: 'Dog Tags',       icon: '\u{1F4FF}' , wear: { slot: 'neck', kind: 'tags' }, fit: 31 },
      { id: 'g_ice',      slot: 'neck',  tier: 'epic',      name: 'Ice Chain',      icon: '\u{1F48E}' , wear: { slot: 'neck', kind: 'ice' }, fit: 28 },
      { id: 'g_bowtie',   slot: 'neck',  tier: 'rare',      name: 'Bow Tie',        icon: '\u{1F380}' , wear: { slot: 'neck', kind: 'bowtie' }, fit: 24, collection: 'floor' },
      // HANDS -- THE GOLD SLOT, 2026-10-16.
      // Every glove in Counter-Strike is a single grade, Extraordinary. There is no cheap glove, the
      // floor is $85 and the top is $5,489, and that one decision is what makes the hands the second
      // most valuable slot in that game. Ours were common-to-epic, which made the slot worthless.
      // Hands are legendary-only now: the 0.26% roll, and nothing else gets in.
      { id: 'g_tape',     slot: 'hands', tier: 'legendary', name: 'Hand Wraps',     icon: '\u{1FA79}' , wear: { slot: 'hands', kind: 'tape' }, fit: 43 },
      { id: 'g_mitts',    slot: 'hands', tier: 'legendary', name: 'Fingerless',     icon: '\u{1F9E4}' , wear: { slot: 'hands', kind: 'mitts' }, fit: 46 },
      { id: 'g_rings',    slot: 'hands', tier: 'legendary', name: 'Knuckle Rings',  icon: '\u{1F48D}' , wear: { slot: 'hands', kind: 'rings' }, fit: 47 },
      { id: 'g_watch',    slot: 'hands', tier: 'legendary', name: 'Gold Watch',     icon: '\u{231A}' , wear: { slot: 'hands', kind: 'watch' }, fit: 47 },
      { id: 'g_gaunt',    slot: 'hands', tier: 'legendary', name: 'Gauntlets',      icon: '\u{1F9BE}' , wear: { slot: 'hands', kind: 'gaunt' }, fit: 47 },
      // ---- six more glove types, 2026-10-16. CS2 ships eight and that slot is the second most
      // valuable in the game; ours had five. All legendary, the same no-cheap-tier rule as the rest.
      { id: 'g_driver',   slot: 'hands', tier: 'legendary', name: 'Driving Gloves', icon: '\u{1F9E4}' , wear: { slot: 'hands', kind: 'driver' }, collection: 'night' },
      { id: 'g_moto',     slot: 'hands', tier: 'legendary', name: 'Moto Gloves',    icon: '\u{1F3CD}\uFE0F' , wear: { slot: 'hands', kind: 'moto' }, collection: 'night' },
      { id: 'g_work',     slot: 'hands', tier: 'legendary', name: 'Work Gloves',    icon: '\u{1F9F0}' , wear: { slot: 'hands', kind: 'work' }, collection: 'scaffold' },
      { id: 'g_latex',    slot: 'hands', tier: 'legendary', name: 'Surgical',       icon: '\u{1FA7A}' , wear: { slot: 'hands', kind: 'latex' }, collection: 'precinct' },
      { id: 'g_boxing',   slot: 'hands', tier: 'legendary', name: 'Boxing Gloves',  icon: '\u{1F94A}' , wear: { slot: 'hands', kind: 'boxing' }, collection: 'bodega' },
      { id: 'g_chrome',   slot: 'hands', tier: 'legendary', name: 'Chrome Gauntlet', icon: '\u{1F9BE}' , wear: { slot: 'hands', kind: 'chrome' }, collection: 'floor' },
      // FEET
      { id: 'g_hitops',   slot: 'feet',  tier: 'common',    name: 'Hi-Tops',        icon: '\u{1F45F}' , wear: { slot: 'shoes', kind: 'sneak' }, fit: 48 },
      { id: 'g_sliders',  slot: 'feet',  tier: 'common',    name: 'Sliders',        icon: '\u{1FA74}' , wear: { slot: 'shoes', kind: 'sandal' }, fit: 48 },
      { id: 'g_steels',   slot: 'feet',  tier: 'uncommon',  name: 'Steel Caps',     icon: '\u{1F97E}' , wear: { slot: 'shoes', kind: 'boots' }, fit: 48 },
      { id: 'g_golds',    slot: 'feet',  tier: 'rare',      name: 'Gold Kicks',     icon: '\u{1F45F}' , wear: { slot: 'shoes', kind: 'kicks' }, fit: 48 },
      // BACK
      { id: 'g_pack',     slot: 'back',  tier: 'common',    name: 'Backpack',       icon: '\u{1F392}' , wear: { slot: 'back', kind: 'pack' }, fit: 45 },
      { id: 'g_cape',     slot: 'back',  tier: 'uncommon',  name: 'Cape',           icon: '\u{1F9E5}' , wear: { slot: 'back', kind: 'cape' }, fit: 48 },
      { id: 'g_katana',   slot: 'back',  tier: 'rare',      name: 'Slung Katana',   icon: '\u{1F5E1}\uFE0F' , wear: { slot: 'back', kind: 'katana' }, fit: 48 },
      { id: 'g_wings',    slot: 'back',  tier: 'legendary', name: 'Wings',          icon: '\u{1FAB6}' , wear: { slot: 'back', kind: 'wings' }, fit: 46 },

      // ---- SHIELDS, the guard slot, 2026-10-16 ----------------------------------------------
      // Gods Unchained has the best shield objects in the category and a one cent floor, because a
      // cosmetic in a card game is seen by one person. These are seen on every block, in the middle
      // of the screen, with sparks coming off them. Each carries its own `impact`, which is the
      // thing actually being bought: a manhole rings, plywood splinters, bullion thuds dead.
      { id: 'g_dumpster', slot: 'guard', tier: 'common',    name: 'Dumpster Lid',    icon: '\u{1F5D1}️', wear: { slot: 'guard', kind: 'dumpster' }, impact: 'clang', collection: 'bodega' },
      { id: 'g_plyboard', slot: 'guard', tier: 'common',    name: 'Ply Board',       icon: '\u{1FAB5}', wear: { slot: 'guard', kind: 'plyboard' }, impact: 'splinter', collection: 'scaffold' },
      { id: 'g_stopsign', slot: 'guard', tier: 'uncommon',  name: 'Stop Sign',       icon: '\u{1F6D1}', wear: { slot: 'guard', kind: 'stopsign' }, impact: 'ring', collection: 'bodega' },
      { id: 'g_manhole',  slot: 'guard', tier: 'uncommon',  name: 'Manhole Cover',   icon: '\u{26AB}', wear: { slot: 'guard', kind: 'manhole' }, impact: 'toll', collection: 'bodega' },
      { id: 'g_plank',    slot: 'guard', tier: 'uncommon',  name: 'Scaffold Plank',  icon: '\u{1FA9C}', wear: { slot: 'guard', kind: 'plank' }, impact: 'rattle', collection: 'scaffold' },
      { id: 'g_cardoor',  slot: 'guard', tier: 'rare',      name: 'Car Door',        icon: '\u{1F697}', wear: { slot: 'guard', kind: 'cardoor' }, impact: 'thud', collection: 'night' },
      { id: 'g_riot',     slot: 'guard', tier: 'rare',      name: 'Riot Shield',     icon: '\u{1F6E1}️', wear: { slot: 'guard', kind: 'riot' }, impact: 'flex', collection: 'precinct' },
      { id: 'g_table',    slot: 'guard', tier: 'rare',      name: 'Café Table Top', icon: '\u{2615}', wear: { slot: 'guard', kind: 'table' }, impact: 'crack', collection: 'bodega' },
      { id: 'g_ticker',   slot: 'guard', tier: 'epic',      name: 'Ticker Board',    icon: '\u{1F4C8}', wear: { slot: 'guard', kind: 'ticker' }, impact: 'flap', collection: 'floor' },
      { id: 'g_vault',    slot: 'guard', tier: 'epic',      name: 'Vault Door',      icon: '\u{1F3E6}', wear: { slot: 'guard', kind: 'vault' }, impact: 'boom', collection: 'floor' },
      { id: 'g_bullion',  slot: 'guard', tier: 'legendary', name: 'Bullion Stack',   icon: '\u{1F9F1}', wear: { slot: 'guard', kind: 'bullion' }, impact: 'dead', collection: 'floor' },
      { id: 'g_desk',     slot: 'guard', tier: 'legendary', name: 'The Floor',       icon: '\u{260E}️', wear: { slot: 'guard', kind: 'desk' }, impact: 'dead', collection: 'floor' },
      // ---- eight more shields, 2026-10-16. Duane wanted the shelf three times the size and a
      // shield is the piece he asked for by name. Each one is a silhouette none of the twelve above
      // has: a wheel with spokes, a rolled drum lid, a tall door, a see-through round grate, a sign
      // on a post, a parabola, a slatted rectangle and a grid of lit screens.
      { id: 'g_wheelrim', slot: 'guard', tier: 'common',    name: 'Alloy Wheel',     icon: '\u{1F6DE}', wear: { slot: 'guard', kind: 'wheelrim' }, impact: 'clang', collection: 'night' },
      { id: 'g_oildrum',  slot: 'guard', tier: 'common',    name: 'Drum Lid',        icon: '\u{1F6E2}\uFE0F', wear: { slot: 'guard', kind: 'oildrum' }, impact: 'boom', collection: 'dock' },
      { id: 'g_pallet',   slot: 'guard', tier: 'common',    name: 'Pallet',          icon: '\u{1F4E6}', wear: { slot: 'guard', kind: 'pallet' }, impact: 'splinter', collection: 'scaffold' },
      { id: 'g_grill',    slot: 'guard', tier: 'uncommon',  name: 'Grill Grate',     icon: '\u{1F356}', wear: { slot: 'guard', kind: 'grill' }, impact: 'rattle', collection: 'bodega' },
      { id: 'g_sign',     slot: 'guard', tier: 'uncommon',  name: 'Street Sign',     icon: '\u{1F6A6}', wear: { slot: 'guard', kind: 'sign' }, impact: 'ring', collection: 'bodega' },
      { id: 'g_firedoor', slot: 'guard', tier: 'rare',      name: 'Fire Door',       icon: '\u{1F6AA}', wear: { slot: 'guard', kind: 'firedoor' }, impact: 'boom', collection: 'precinct' },
      { id: 'g_dish',     slot: 'guard', tier: 'rare',      name: 'Satellite Dish',  icon: '\u{1F4E1}', wear: { slot: 'guard', kind: 'dish' }, impact: 'ring', collection: 'scaffold' },
      { id: 'g_screens',  slot: 'guard', tier: 'epic',      name: 'The Wall',        icon: '\u{1F5A5}\uFE0F', wear: { slot: 'guard', kind: 'screens' }, impact: 'crack', collection: 'floor' },
      // ---- ten more shields ----
      { id: 'g_hubcap',   slot: 'guard', tier: 'common',    name: 'Hubcap',          icon: '\u{1F6DE}', wear: { slot: 'guard', kind: 'hubcap' }, impact: 'ring', collection: 'night' },
      { id: 'g_pizzapan', slot: 'guard', tier: 'common',    name: 'Pizza Pan',       icon: '\u{1F355}', wear: { slot: 'guard', kind: 'pizzapan' }, impact: 'clang', collection: 'bodega' },
      { id: 'g_crate',    slot: 'guard', tier: 'common',    name: 'Crate Lid',       icon: '\u{1F4E6}', wear: { slot: 'guard', kind: 'crate' }, impact: 'splinter', collection: 'dock' },
      { id: 'g_gymlocker', slot: 'guard', tier: 'uncommon', name: 'Locker Door',     icon: '\u{1F512}', wear: { slot: 'guard', kind: 'gymlocker' }, impact: 'rattle', collection: 'precinct' },
      { id: 'g_cellar',   slot: 'guard', tier: 'uncommon',  name: 'Cellar Door',     icon: '\u{1F6AA}', wear: { slot: 'guard', kind: 'cellar' }, impact: 'thud', collection: 'bodega' },
      { id: 'g_sash',     slot: 'guard', tier: 'uncommon',  name: 'Sash Window',     icon: '\u{1FA9F}', wear: { slot: 'guard', kind: 'sash' }, impact: 'crack', collection: 'night' },
      { id: 'g_turnstile', slot: 'guard', tier: 'rare',     name: 'Turnstile',       icon: '\u{1F6C2}', wear: { slot: 'guard', kind: 'turnstile' }, impact: 'ring', collection: 'night' },
      { id: 'g_boiler',   slot: 'guard', tier: 'rare',      name: 'Boiler Plate',    icon: '\u{2699}\uFE0F', wear: { slot: 'guard', kind: 'boiler' }, impact: 'boom', collection: 'boiler' },
      { id: 'g_jukebox',  slot: 'guard', tier: 'epic',      name: 'Jukebox Front',   icon: '\u{1F3B5}', wear: { slot: 'guard', kind: 'jukebox' }, impact: 'flap', collection: 'bodega' },
      { id: 'g_score',    slot: 'guard', tier: 'epic',      name: 'Scoreboard',      icon: '\u{1F4CA}', wear: { slot: 'guard', kind: 'score' }, impact: 'flap', collection: 'floor' },

      // ---- CHARMS, 2026-10-16 ---------------------------------------------------------------
      // 2 to 4 cm of geometry on a short chain off the grip. They swing. Cheapest thing per dollar
      // we will ever ship, and in CS2 they run from $0.12 (Pinch O' Salt) to $106 (Butane Buddy).
      { id: 'g_salt',     slot: 'charm', tier: 'common',    name: 'Pinch of Salt',   icon: '\u{1F9C2}', wear: { slot: 'charm', kind: 'salt' }, collection: 'bodega' },
      { id: 'g_token',    slot: 'charm', tier: 'common',    name: 'Subway Token',    icon: '\u{1FA99}', wear: { slot: 'charm', kind: 'token' }, collection: 'night' },
      { id: 'g_dice',     slot: 'charm', tier: 'common',    name: 'Dice Pair',       icon: '\u{1F3B2}', wear: { slot: 'charm', kind: 'dice' }, collection: 'bodega' },
      { id: 'g_padlock',  slot: 'charm', tier: 'uncommon',  name: 'Padlock',         icon: '\u{1F512}', wear: { slot: 'charm', kind: 'padlock' }, collection: 'scaffold' },
      { id: 'g_lighter',  slot: 'charm', tier: 'uncommon',  name: 'Lighter',         icon: '\u{1F526}', wear: { slot: 'charm', kind: 'lighter' }, collection: 'night' },
      { id: 'g_pager',    slot: 'charm', tier: 'uncommon',  name: 'Pager',           icon: '\u{1F4DF}', wear: { slot: 'charm', kind: 'pager' }, collection: 'floor' },
      { id: 'g_sneaker',  slot: 'charm', tier: 'rare',      name: 'Sneaker',         icon: '\u{1F45F}', wear: { slot: 'charm', kind: 'sneaker' }, collection: 'night' },
      { id: 'g_boombox',  slot: 'charm', tier: 'rare',      name: 'Boombox',         icon: '\u{1F4FB}', wear: { slot: 'charm', kind: 'boombox' }, collection: 'night' },
      { id: 'g_plane',    slot: 'charm', tier: 'rare',      name: 'Paper Plane',     icon: '\u{2708}️', wear: { slot: 'charm', kind: 'plane' }, collection: 'floor' },
      { id: 'g_tooth',    slot: 'charm', tier: 'epic',      name: 'Gold Tooth',      icon: '\u{1F9B7}', wear: { slot: 'charm', kind: 'tooth' }, collection: 'bodega' },
      { id: 'g_pendant',  slot: 'charm', tier: 'epic',      name: 'Crown Pendant',   icon: '\u{1F451}', wear: { slot: 'charm', kind: 'crown' }, collection: 'floor' },
      { id: 'g_hydrant',  slot: 'charm', tier: 'epic',      name: 'Mini Hydrant',    icon: '\u{1F6B0}', wear: { slot: 'charm', kind: 'hydrant' }, collection: 'precinct' },
      { id: 'g_knuck',    slot: 'charm', tier: 'legendary', name: 'Brass Knuckle',   icon: '\u{1F44A}', wear: { slot: 'charm', kind: 'knuck' }, collection: 'night' },
      { id: 'g_bull',     slot: 'charm', tier: 'legendary', name: 'Bull Figurine',   icon: '\u{1F3C6}', wear: { slot: 'charm', kind: 'bull' }, collection: 'floor' },
    ],
  },

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
// ---- EVERY PIECE OF GEAR IS ALSO FOR SALE, 2026-10-16 -------------------------------------
// Duane: "theres not even an item section where u can buy stuff for appearance/skins. wtf?" He was
// right and it was a real hole: the 85 wearables were crate-only, so the shop sold weapons, paints
// and effects and nothing you could put ON your fighter.
//
// Both routes now, which is what the references do: Fortnite SELLS the outfit, Counter-Strike lets
// you open a case for it. The crate stays free and stays the only way to get an Unusual, a serial
// or a condition roll worth having; the shop sells the same piece at its grade's price, every time,
// no gamble. Nothing in the LOCKER is paywalled, which was the rule, and nothing here is: the crate
// still has no price and there is still no key.
for (const g of ECON_CATALOG.locker.gear) if (g.price == null) g.price = ECON_GRADE_PRICE[g.tier] || null;
/* CATALOG-END */

const Econ = (() => {
  const CAT = ECON_CATALOG;
  const BYID = {};
  for (const w of CAT.weapons) BYID[w.id] = Object.assign({ type: 'weapon' }, w);
  for (const c of CAT.cosmetics) BYID[c.id] = Object.assign({ type: 'cosmetic' }, c);
  // A weapon finish is a cosmetic in every way that matters (no combat number, legal in a money
  // match) but it is equipped PER WEAPON rather than into one global slot, so it carries its own
  // type and its own equip map. CS2 works exactly this way: you do not own "gold", you own
  // "The Chopper | Bodega Gold".
  for (const s of (CAT.skins || [])) BYID[s.id] = Object.assign({ type: 'skin' }, s);
  for (const b of CAT.bundles) BYID[b.id] = Object.assign({ type: 'bundle' }, b);
  // The vault (secret stages + the secret fighter) is a plain entitlement: `grant()` on the server
  // stores the id and `owned()` lists it, exactly like a weapon. It is in BYID so `setServer()` keeps
  // it -- an id the client does not know is DROPPED from the owned list, which would silently
  // relock a paid stage on the next sync.
  for (const v of (CAT.vault || [])) BYID[v.id] = Object.assign({ type: 'vault' }, v);
  for (const p of CAT.season.plates) BYID[p.id] = Object.assign({ type: 'cosmetic', slot: 'plate', price: null, season: true }, p);
  // The locker's gear is indexed separately from BYID on purpose: a gear piece is never bought, so it
  // must not turn up in the store's shelves, in `owns()` or in an entitlement list.
  const GEAR_BY = {};
  for (const g of (CAT.locker && CAT.locker.gear) || []) GEAR_BY[g.id] = g;
  // Gear is in BYID as of 2026-10-16 so the SHOP can list and sell it, and it carries its own type
  // so nothing confuses it with an entitlement: you do not "own" a Dumpster Lid, you own an INSTANCE
  // of one, with a serial and a condition on it. `owns()` answers that from `inv`, never from `own`.
  for (const g of (CAT.locker && CAT.locker.gear) || []) BYID[g.id] = Object.assign({ type: 'gear' }, g);

  const SLOTS = ['finish', 'aura', 'trail', 'ko', 'pose', 'plate', 'taunt', 'title'];
  const KEY = 'econ3';
  // ---- the market tables, indexed once ------------------------------------------------------
  const GRADE_BY = {}; for (const g of (CAT.grades || [])) GRADE_BY[g.id] = g;
  const COND_BY = {};  for (const c of (CAT.conditions || [])) COND_BY[c.id] = c;
  const COLL_BY = {};  for (const c of (CAT.collections || [])) COLL_BY[c.id] = c;
  const SER_BY = {};   for (const s of (CAT.series || [])) SER_BY[s.id] = s;
  const STYLE_BY = {}; for (const s of (CAT.finishStyles || [])) STYLE_BY[s.id] = s;
  const SKIN_FOR = {}; for (const s of (CAT.skins || [])) (SKIN_FOR[s.weapon] = SKIN_FOR[s.weapon] || []).push(s);
  // every weapon id -> its fight `kind`, so the renderer can resolve a finish from what is in hand
  const KIND_TO_WEAPON = {}; for (const w of CAT.weapons) KIND_TO_WEAPON[w.kind] = w.id;
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
    // 'off' | 'stub' | 'chain' — what the SERVER says it is doing about money, never a local guess.
    // Not persisted: a cached 'chain' on a device whose server has since turned payments off would
    // offer a checkout that cannot take a payment.
    payments: 'off',
    // ---- the locker (2026-10-15). These four are a CACHE of the server's answer and nothing else.
    // An instance is { uid, id, slot, tier, unusual, ko, serial, at }: the server mints it in
    // openCase() and the page never creates one, because a page that could mint its own instance
    // could mint itself an Unusual, and an Unusual is the most valuable thing in the catalogue.
    inv: [],            // owned instances
    crates: 0,          // unopened crates
    wear: {},           // locker slot -> instance uid
    mint: {},           // item id -> how many the server has ever handed out (for "#n of N")
    // ---- the market, 2026-10-16 ----
    skins: {},          // weapon id -> finish id, because a finish is per weapon the way CS2 does it
    wish: {},           // item id -> 1. Local only: a wishlist is a convenience, not an entitlement
    react: {},          // item id -> { fire, love, meh, yuck, poo } community counts (server's copy)
    mine: {},           // item id -> which reaction THIS player left, so the bar can show it back
  };

  function load() {
    try {
      const raw = store.get(KEY, null);
      if (raw && typeof raw === 'object') {
        Object.assign(S, { own: raw.own || {}, equip: raw.equip || {}, loadout: raw.loadout || [], xp: raw.xp || 0, record: raw.record || S.record, badges: raw.badges || [], credits: raw.credits || 0,
          inv: Array.isArray(raw.inv) ? raw.inv : [], crates: raw.crates || 0, wear: raw.wear || {}, mint: raw.mint || {},
          skins: raw.skins || {}, wish: raw.wish || {}, react: raw.react || {}, mine: raw.mine || {} });
        S.level = levelFor(S.xp);
      }
    } catch (e) { /* storage blocked */ }
  }
  function save() {
    try { store.set(KEY, { own: S.own, equip: S.equip, loadout: S.loadout, xp: S.xp, record: S.record, badges: S.badges, credits: S.credits,
      inv: S.inv, crates: S.crates, wear: S.wear, mint: S.mint,
      skins: S.skins, wish: S.wish, react: S.react, mine: S.mine }); } catch (e) { /* storage blocked */ }
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
      // a piece of gear is owned when you hold an INSTANCE of it, not when an entitlement says so
      if (GEAR_BY[id]) return S.inv.some(i => i.id === id);
      if (S.own[id]) return true;
      // practice period: every market weapon is free (PRACTICE_FREE in 57_items3.js). Cosmetics are not affected.
      if (typeof PRACTICE_FREE !== 'undefined' && PRACTICE_FREE && CAT.weapons.some(w => w.id === id)) return true;
      const d = BYID[id];
      return !!(d && d.unlock != null && S.level >= d.unlock);   // level unlocks are entitlements too
    },
    ownedWeapons() { return CAT.weapons.filter(w => api.owns(w.id)); },
    lockedWeapons() { return CAT.weapons.filter(w => !api.owns(w.id)); },

    // ---------- the vault: secret stages + the secret fighter ----------
    // `vaultOpen` is the ONE gate. 79_core.js asks it for every stage card and every roster tile, so
    // a vault id is invisible everywhere until the server says this account owns it. It answers TRUE
    // for anything that is not in the vault at all, which is what makes it safe to call on all 19
    // stages and all 36 fighters without a second list to keep in step.
    vault: () => (CAT.vault || []).slice(),
    vaultFor(kind, unlocks) { return (CAT.vault || []).find(v => v.kind === kind && v.unlocks === unlocks) || null; },
    vaultOpen(kind, unlocks) { const v = api.vaultFor(kind, unlocks); return !v || api.owns(v.id); },
    vaultLocked(kind) { return (CAT.vault || []).filter(v => (!kind || v.kind === kind) && !api.owns(v.id)); },
    vaultOwned(kind) { return (CAT.vault || []).filter(v => (!kind || v.kind === kind) && api.owns(v.id)); },
    // legal in a wagered or ranked match? Set per item in the catalogue, never guessed here.
    vaultRanked(kind, unlocks) { const v = api.vaultFor(kind, unlocks); return !v || v.ranked !== false; },
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
        // the locker. `inv` and `wear` are replaced wholesale, never merged: the server's answer is
        // the answer, and merging is how a client keeps an instance the server has taken away.
        if (Array.isArray(extra.inv)) S.inv = extra.inv.filter(i => i && GEAR_BY[i.id]);
        if (extra.crates != null) S.crates = extra.crates | 0;
        if (extra.wear && typeof extra.wear === 'object') S.wear = extra.wear;
        if (extra.mint && typeof extra.mint === 'object') S.mint = extra.mint;
        if (extra.skins && typeof extra.skins === 'object') S.skins = extra.skins;
        if (extra.react && typeof extra.react === 'object') S.react = extra.react;
        if (extra.mine && typeof extra.mine === 'object') S.mine = extra.mine;
        if (Array.isArray(extra.worn)) api.mostWorn = extra.worn;
        if (typeof extra.payments === 'string') S.payments = extra.payments;
      }
      S.level = levelFor(S.xp); S.synced = true;
      api.clean(); save(); api.emit();
    },
    // drop anything equipped or loaded out that this account does not actually own
    clean() {
      for (const k of Object.keys(S.equip)) if (!api.owns(S.equip[k])) delete S.equip[k];
      // a finish you no longer own must come off the weapon it was on, the same rule as above
      for (const k of Object.keys(S.skins)) if (!api.owns(S.skins[k])) delete S.skins[k];
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
    // THE SHOP SIGNS YOU IN BY ITSELF. Every entitlement lives on the server, so a purchase needs
    // the socket -- but it used to be the PLAYER's job to go to Play online, connect, and come back
    // to the store, and nothing on the card said so until after the click. It connects on demand
    // now, quietly (Net.signIn never changes the screen), and the purchase carries straight on.
    ensureOnline(fn, ms) {
      if (api.connected()) return fn(true);
      try { if (window.Net && Net.signIn) Net.signIn(); } catch (e) { /* no net module */ }
      const t0 = Date.now(), lim = ms || 9000;
      const tick = () => {
        if (api.connected()) return fn(true);
        if (Date.now() - t0 > lim) return fn(false);
        setTimeout(tick, 250);
      };
      setTimeout(tick, 250);
    },
    buy(id, cb) {
      const d = BYID[id];
      if (!d || d.price == null) return cb && cb({ ok: false, msg: 'Not for sale.' });
      if (api.owns(id)) return cb && cb({ ok: false, msg: 'You already own it.' });
      if (!api.connected()) {
        return api.ensureOnline(ok => {
          if (!ok) return cb && cb({ ok: false, msg: 'Could not reach the game server. Try again in a moment.' });
          api.buy(id, cb);
        });
      }
      api.pending = { id, cb, at: Date.now() };
      Net.send({ k: 'buy', id, provider: 'stub' });
      setTimeout(() => { if (api.pending && api.pending.id === id) { const c = api.pending.cb; api.pending = null; c && c({ ok: false, msg: 'The store did not answer. Try again.' }); } }, 8000);
    },
    onBuyResult(m) {
      const p = api.pending; api.pending = null;
      if (m.owned) api.setServer(m.owned, m);
      // `checkout` is the server saying "this item is for sale, in crypto, here is its price" —
      // the whole message goes to the caller so the store can open the checkout sheet on it.
      if (p && p.cb) p.cb({ ok: !!m.ok, msg: m.msg || (m.ok ? 'Unlocked.' : 'That did not go through.'), checkout: m.checkout || null, off: !!m.off });
    },

    // ---------- the crypto checkout: THE WIRE ONLY ----------
    // 8k_pay.js draws the sheet and talks to the wallet; net/lib/pay.js decides the price, the
    // amount, the address and whether a payment counts. Nothing in this block grants anything, and
    // nothing here can name a price: the page sends an item id and a currency, never an amount.
    payWait: {},
    payAsk(kind, body, back, cb, ms) {
      // same rule as buy(): bring the socket up rather than sending the player away mid-checkout,
      // which with a quote already locked would be the worst possible moment to do it
      if (!api.connected()) {
        return api.ensureOnline(ok => {
          if (!ok) return cb && cb({ ok: false, retry: true, msg: 'Could not reach the game server. Try again in a moment.' });
          api.payAsk(kind, body, back, cb, ms);
        });
      }
      const old = api.payWait[back];
      if (old && old.cb) old.cb({ ok: false, msg: 'Cancelled.' });
      const w = { cb, at: Date.now() };
      api.payWait[back] = w;
      Net.send(Object.assign({ k: kind }, body));
      // Every wait is bounded. A checkout that sits on "working…" because a reply never came is
      // worse than one that says it failed, because the player has already paid by then.
      setTimeout(() => { if (api.payWait[back] === w) { api.payWait[back] = null; cb && cb({ ok: false, retry: true, msg: 'The checkout did not answer. Try again.' }); } }, ms || 12000);
    },
    payMenu(id, cb) { api.payAsk('paymenu', { id }, 'paymenu', cb); },
    payQuote(id, cur, payer, cb) { api.payAsk('payquote', { id, cur, payer }, 'payq', cb); },
    payClaim(ref, tx, cb) { api.payAsk('payclaim', { ref, tx }, 'payres', cb, 25000); },
    // Everything this wallet has paid for that is missing from this account. A purchase is delivered
    // to whichever account the device was on when it paid, so paying before signing in — or coming
    // back on a fresh device token — used to strand a paid item on an account nobody could reach.
    payRestore(addr, cb) { if (addr) api.payAsk('payrestore', { addr: String(addr) }, 'payrest', cb || (() => { }), 15000); },
    onPay(m) {
      const w = api.payWait[m.k]; api.payWait[m.k] = null;
      if (m.k === 'payres' && m.ok && m.owned) api.setServer(m.owned, m);
      if (w && w.cb) w.cb(m);
    },
    // 'chain' once the server is taking crypto; 'stub' in a playtest; 'off' otherwise. The store
    // reads this to decide whether a click opens the checkout or a toast.
    payMode() { return (S.payments || 'off'); },
    // push equip + loadout to the account so they follow you to another device
    connected() { try { const N = Net.state; return !!(N && N.conn === 'open' && N.me); } catch (e) { return false; } },
    push() { if (api.connected()) Net.send({ k: 'econset', equip: S.equip, loadout: S.loadout, skins: S.skins }); },
    pull() { if (api.connected()) Net.send({ k: 'econ' }); },

    // ================= THE LOCKER =================
    // The server owns every roll, every instance and what is worn (net/lib/economy.js). Everything
    // here either reads the cache or asks the server and waits. Nothing in this block grants anything.
    locker: () => CAT.locker,
    gear: id => GEAR_BY[id] || null,
    gearList: () => CAT.locker.gear.slice(),
    lockerSlots: () => CAT.locker.slots.slice(),
    tierOf(t) { return CAT.locker.odds.find(o => o.tier === t) || CAT.locker.odds[0]; },
    unusualOf(id) { return CAT.locker.unusuals.find(u => u.id === id) || null; },
    crates: () => S.crates,
    inv: () => S.inv.slice(),
    // every instance of a given locker slot, newest first, so the locker shows the fresh drop on top
    invFor(slot) { return S.inv.filter(i => i.slot === slot).sort((a, b) => (b.at || 0) - (a.at || 0)); },
    byUid(uid) { return S.inv.find(i => i.uid === uid) || null; },
    wornUid(slot) { return S.wear[slot] || null; },
    worn(slot) { const u = S.wear[slot]; return u == null ? null : api.byUid(u); },
    ownsGear(id) { return S.inv.some(i => i.id === id); },
    countOf(id) { return S.inv.filter(i => i.id === id).length; },
    mintOf(id) { return S.mint[id] || 0; },
    // how many of the 48 bodies this piece was measured clean on, and whether THIS body is one
    fitCount(id) { const g = GEAR_BY[id]; return g && g.fit != null ? g.fit : null; },
    fitsBody(id, base) {
      const g = GEAR_BY[id];
      if (!g || !g.wear) return false;
      try { return !!(window.CustomLook && CustomLook.fitsBody(g.wear.slot, g.wear.kind, base)); }
      catch (e) { return true; }        // no creator loaded (headless tests): do not claim it fails
    },
    // THE BRIDGE. What the locker says you are wearing, as the look fields the renderer understands.
    // This is the one place the two catalogues meet, and it drops anything this BODY was not measured
    // for rather than putting an unmeasured piece on a fighter.
    lockerLook(base) {
      const out = {};
      for (const sl of CAT.locker.slots) {
        const inst = api.worn(sl.id); if (!inst) continue;
        const g = GEAR_BY[inst.id]; if (!g || !g.wear) continue;
        if (base && !api.fitsBody(inst.id, base)) continue;
        out[g.wear.slot] = g.wear.kind;
      }
      return out;
    },
    // ask the server to open one. The roll, the item, the Unusual and the serial all come back from it.
    openCase(cb) {
      if (!api.connected()) return cb && cb({ ok: false, msg: 'Connect to online play first — a crate is opened on your account, not on this device.' });
      if (S.crates < 1) return cb && cb({ ok: false, msg: 'No crates yet. They drop free every ' + CAT.locker.crate.every + ' matches.' });
      api.lkPending = { cb, at: Date.now() };
      Net.send({ k: 'lkopen' });
      setTimeout(() => { if (api.lkPending && api.lkPending.cb === cb) { api.lkPending = null; cb && cb({ ok: false, msg: 'The locker did not answer. Try again.' }); } }, 8000);
    },
    onOpenResult(m) {
      const p = api.lkPending; api.lkPending = null;
      if (m.ok && m.inst) {
        S.inv.push(m.inst);
        if (m.crates != null) S.crates = m.crates;
        if (m.inst.serial) S.mint[m.inst.id] = Math.max(S.mint[m.inst.id] || 0, m.inst.serial);
        save(); api.emit();
      }
      if (p && p.cb) p.cb(m);
    },
    // wear / take off. uid === null takes the slot off.
    setWear(slot, uid, cb) {
      if (!CAT.locker.slots.some(s => s.id === slot)) return cb && cb({ ok: false, msg: 'No such slot.' });
      if (uid != null) { const i = api.byUid(uid); if (!i || i.slot !== slot) return cb && cb({ ok: false, msg: 'You do not own that.' }); }
      // shown immediately and corrected by the server's answer, the same way equip() already works
      if (uid == null) delete S.wear[slot]; else S.wear[slot] = uid;
      save(); api.emit();
      if (api.connected()) Net.send({ k: 'wear', slot, uid: uid == null ? null : uid });
      cb && cb({ ok: true });
      return true;
    },
    onWearResult(m) { if (m && m.wear) { S.wear = m.wear; save(); api.emit(); } },

    // ================= THE MARKET =================
    // fortnite.gg and csgoskins.gg, in code. Teardown: https://claude.ai/artifact/Ag7J6RSPKQwHZPfjMYKtrY

    // ---------- grades, conditions, collections, series, styles ----------
    grades: () => (CAT.grades || []).slice(),
    grade(id) { return GRADE_BY[id] || GRADE_BY.common; },
    // The grade of anything in the catalogue, from the field it carries or, failing that, its price.
    // Price and grade can never disagree because a finish's price IS derived from its grade.
    gradeOf(d) {
      if (!d) return GRADE_BY.common;
      if (d.grade && GRADE_BY[d.grade]) return GRADE_BY[d.grade];
      if (d.tier && GRADE_BY[d.tier]) return GRADE_BY[d.tier];
      const p = d.price == null ? 0 : d.price;
      let out = GRADE_BY.common;
      for (const g of CAT.grades) if (g.price != null && p >= g.price) out = g;
      return out;
    },
    conditions: () => (CAT.conditions || []).slice(),
    condition(id) { return COND_BY[id] || null; },
    // float -> the condition band it falls in. One roll at mint time, never changes after.
    conditionFor(f) {
      const v = typeof f === 'number' ? f : 0;
      for (const c of CAT.conditions) if (v < c.hi) return c;
      return CAT.conditions[CAT.conditions.length - 1];
    },
    collection(id) { return COLL_BY[id] || null; },
    collections: () => (CAT.collections || []).slice(),
    // everything in a collection, across weapons, finishes and gear. "Contains N items" is the
    // mechanic that turns one purchase into five, and it only works if the link actually goes
    // somewhere, so this is the one function behind it.
    inCollection(id) {
      const out = [];
      for (const s of (CAT.skins || [])) if (s.collection === id) out.push(s);
      for (const g of (CAT.locker.gear || [])) if (g.collection === id) out.push(g);
      return out;
    },
    series: () => (CAT.series || []).slice(),
    seriesOf(d) { return d && d.series ? (SER_BY[d.series] || null) : null; },
    style(id) { return STYLE_BY[id] || null; },

    // ---------- weapon finishes, equipped per weapon ----------
    skins: () => (CAT.skins || []).slice(),
    skinsFor(weaponId) { return (SKIN_FOR[weaponId] || []).slice(); },
    skinOn(weaponId) { const id = S.skins[weaponId]; return id && BYID[id] ? BYID[id] : null; },
    // what the renderer should paint on a weapon that is in somebody's hands RIGHT NOW. The
    // per-weapon finish wins; the old universal finish is the fallback, so nothing anyone already
    // owns stops working.
    skinFor(kind) {
      const wid = KIND_TO_WEAPON[kind];
      const own = wid && S.skins[wid];
      if (own && BYID[own] && api.owns(own)) return BYID[own];
      const uni = S.equip.finish;
      return uni && BYID[uni] ? BYID[uni] : null;
    },
    equipSkin(id) {
      const d = BYID[id];
      if (!d || d.type !== 'skin' || !api.owns(id)) return false;
      if (S.skins[d.weapon] === id) delete S.skins[d.weapon]; else S.skins[d.weapon] = id;
      save(); api.push(); api.emit(); return true;
    },
    // the price of one copy, after its condition. A Mint copy is the list price; a Gutted one is
    // 46% of it. CS2's spread between Factory New and Battle-Scarred is roughly this.
    priceOf(d, condId) {
      if (!d || d.price == null) return null;
      const c = condId ? COND_BY[condId] : null;
      return Math.round(d.price * (c ? c.mul : 1) / 1) || d.price;
    },

    // ---------- the shop clock and the daily shelf ----------
    // Fortnite's shop turns over at a fixed hour and every card carries what is left of its run.
    // Ours is computed from the DATE rather than handed down by a server, so an offline client, the
    // website and the game all agree on what is on the shelf today and what is leaving tonight.
    hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },
    day(t) { return Math.floor(((t == null ? Date.now() : t) - CAT.shop.resetHour * 3600000) / 86400000); },
    // seconds until the shelf turns over
    toReset(t) {
      const now = t == null ? Date.now() : t;
      const next = (api.day(now) + 1) * 86400000 + CAT.shop.resetHour * 3600000;
      return Math.max(0, Math.round((next - now) / 1000));
    },
    // Each item runs on its own cycle, derived from its id, so the shelf is varied without anyone
    // having to author a schedule: a run of 4-8 days every 26-43 days, at its own offset.
    //
    // THE THREE NUMBERS COME FROM THREE SEPARATE HASHES, and that is not fussiness. The first
    // version took all three out of one FNV hash by shifting bits, and the three were correlated
    // enough that the daily shelf swung between 7 and 26 items off an expected 27 -- a shop that is
    // some days half empty. Salting the id three times decorrelates them, and the count now sits at
    // 31 on average and never drops below 18 across a full year (measured, not assumed).
    sched(id) {
      const p = 26 + (api.hash('p:' + id) % 18), r = 4 + (api.hash('r:' + id) % 5);
      return { period: p, run: r, off: api.hash('o:' + id) % p };
    },
    onShelf(id, d) { const s = api.sched(id), k = ((d == null ? api.day() : d) + s.off) % s.period; return k < s.run; },
    // days of the run left, 0 if it is not on the shelf at all. 1 means it goes tonight.
    daysLeft(id, d) { const s = api.sched(id), k = ((d == null ? api.day() : d) + s.off) % s.period; return k < s.run ? s.run - k : 0; },
    isNewToday(id, d) { const s = api.sched(id), k = ((d == null ? api.day() : d) + s.off) % s.period; return k === 0; },
    leavingToday(id, d) { return api.daysLeft(id, d) === 1; },
    // how long since it was last on the shelf, which is Fortnite's Longest Wait sort. An item nobody
    // has seen for 200 days is news on its own.
    daysSince(id, d) {
      const s = api.sched(id), day = d == null ? api.day() : d;
      if (api.onShelf(id, day)) return 0;
      const k = (day + s.off) % s.period;
      return k - s.run + 1;
    },
    // the countdown a card prints, as seconds. (daysLeft - 1) whole days plus what is left of today.
    secsLeft(id, d) { const n = api.daysLeft(id, d); return n <= 0 ? 0 : (n - 1) * 86400 + api.toReset(); },
    // "16D 13H" / "13H 19M" / "48M", exactly the way fortnite.gg writes it
    countdown(secs) {
      if (!(secs > 0)) return '';
      const dd = Math.floor(secs / 86400), hh = Math.floor((secs % 86400) / 3600), mm = Math.floor((secs % 3600) / 60);
      if (dd > 0) return dd + 'D ' + hh + 'H';
      if (hh > 0) return hh + 'H ' + mm + 'M';
      return Math.max(1, mm) + 'M';
    },
    // everything that can be sold, which is what the shelf draws from
    sellable() {
      const out = [];
      for (const w of CAT.weapons) if (w.price != null) out.push(BYID[w.id]);
      for (const c of CAT.cosmetics) if (c.price != null) out.push(BYID[c.id]);
      for (const s of (CAT.skins || [])) out.push(BYID[s.id]);
      // the appearance half of the shop: hats, eyes, neck, gloves, feet, back, shields and charms
      for (const g of (CAT.locker.gear || [])) if (g.price != null) out.push(BYID[g.id]);
      return out;
    },
    // today's shelf, with the named section it sits under
    shelf(d) {
      const day = d == null ? api.day() : d;
      return api.sellable().filter(x => api.onShelf(x.id, day));
    },
    // which named shelf is featured today. Picked from the date so every client agrees.
    featured(d) { const L = CAT.shop.shelves; return L[(d == null ? api.day() : d) % L.length]; },
    // the tab counts fortnite.gg prints next to every tab
    tabCounts(d) {
      const day = d == null ? api.day() : d, on = api.shelf(day);
      const yest = new Set(api.shelf(day - 1).map(x => x.id));
      return {
        all: on.length,
        fresh: on.filter(x => api.isNewToday(x.id, day)).length,
        wish: on.filter(x => S.wish[x.id]).length,
        diff: on.filter(x => !yest.has(x.id)).length + [...yest].filter(id => !on.some(x => x.id === id)).length,
        leaving: on.filter(x => api.leavingToday(x.id, day)).length,
      };
    },
    // the FREE card. Fortnite puts a $0 item on the shelf so the shop is worth opening without a
    // wallet, and has a whole Free Cosmetics page. One item a day, picked from the date.
    freeToday(d) {
      const day = d == null ? api.day() : d;
      const pool = api.sellable().filter(x => x.price != null && x.price <= 399);
      return pool.length ? pool[api.hash('free' + day) % pool.length] : null;
    },

    // ---------- browse by colour ----------
    // csgoskins ships thirteen colour pages and a colour filter on every search, for one reason:
    // people build a look around a colour, so a colour filter is what sells the second and third
    // item in a set. Classified from the item's own hex rather than a tag somebody has to maintain.
    colors: [
      { id: 'red', name: 'Red', hex: '#e03a3a' }, { id: 'orange', name: 'Orange', hex: '#ff8a2a' },
      { id: 'gold', name: 'Gold', hex: '#ffc83a' }, { id: 'green', name: 'Green', hex: '#3ddc84' },
      { id: 'cyan', name: 'Cyan', hex: '#27e1ff' }, { id: 'blue', name: 'Blue', hex: '#2a5fd0' },
      { id: 'purple', name: 'Purple', hex: '#8847ff' }, { id: 'pink', name: 'Pink', hex: '#ff5fa8' },
      { id: 'brown', name: 'Brown', hex: '#8a5a2b' }, { id: 'white', name: 'White', hex: '#e8edf4' },
      { id: 'grey', name: 'Grey', hex: '#8d99a7' }, { id: 'black', name: 'Black', hex: '#1a1d24' },
    ],
    colorOf(d) {
      const hex = d && d.color;
      if (!hex || typeof hex !== 'string' || hex[0] !== '#') return null;
      const n = parseInt(hex.slice(1, 7), 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, c = mx - mn;
      if (c < 0.12) return l < 0.22 ? 'black' : l > 0.78 ? 'white' : 'grey';
      let h = 0;
      if (mx === r) h = ((g - b) / c + 6) % 6; else if (mx === g) h = (b - r) / c + 2; else h = (r - g) / c + 4;
      h *= 60;
      // brown is the one colour that is not a hue: it is an orange that has gone dark
      if (h >= 15 && h < 45 && l < 0.4) return 'brown';
      if (h < 15 || h >= 330) return 'red';
      if (h < 42) return 'orange';
      if (h < 68) return 'gold';
      if (h < 160) return 'green';
      if (h < 200) return 'cyan';
      if (h < 255) return 'blue';
      if (h < 300) return 'purple';
      return 'pink';
    },

    // ---------- the wishlist ----------
    wished(id) { return !!S.wish[id]; },
    wish(id) { if (S.wish[id]) delete S.wish[id]; else S.wish[id] = 1; save(); api.emit(); return !!S.wish[id]; },
    wishList() { return Object.keys(S.wish).filter(id => BYID[id]).map(id => BYID[id]); },

    // ---------- the reaction bar ----------
    // Five reactions with live counts under every card, on a hot-to-cold bar. It is community
    // moderation of our own catalogue and it tells us what to make more of. The counts are the
    // server's; the local copy is a cache so the bar renders offline.
    reactions: () => CAT.shop.reactions.slice(),
    reactionsOf(id) {
      const r = S.react[id] || {};
      return CAT.shop.reactions.map(k => ({ k, n: r[k.id] || 0, mine: S.mine[id] === k.id }));
    },
    reactTotal(id) { const r = S.react[id] || {}; let t = 0; for (const k of CAT.shop.reactions) t += r[k.id] || 0; return t; },
    // the "heat" of an item, 0..1, which is what orders Best Sellers and paints the bar
    heat(id) {
      const r = S.react[id] || {}, tot = api.reactTotal(id);
      if (!tot) return 0.5;
      return ((r.fire || 0) + (r.love || 0) * 0.75 + (r.meh || 0) * 0.4) / tot;
    },
    react(id, kind) {
      if (!BYID[id] || !CAT.shop.reactions.some(r => r.id === kind)) return false;
      const was = S.mine[id];
      const row = S.react[id] = S.react[id] || {};
      if (was === kind) { row[kind] = Math.max(0, (row[kind] || 1) - 1); delete S.mine[id]; }
      else {
        if (was) row[was] = Math.max(0, (row[was] || 1) - 1);
        row[kind] = (row[kind] || 0) + 1; S.mine[id] = kind;
      }
      save(); api.emit();
      if (api.connected()) Net.send({ k: 'react', id, r: S.mine[id] || null });
      return true;
    },
    onReactions(m) { if (m && m.react) { S.react = m.react; save(); api.emit(); } },

    // ---------- supply, odds and the honesty layer ----------
    // csgoskins prints the whole chain: Covert 1 in 156, this finish 1 in 2, Factory New 1 in 4,
    // Normal 9 in 10, final 1 in 1,238 (0.081%). It is a legal requirement in several markets, it
    // makes us look honest, and 0.081% is a better advert than anything we could write.
    oddsChain(gearId) {
      const g = GEAR_BY[gearId]; if (!g) return null;
      const L = CAT.locker, o = L.odds.find(x => x.tier === g.tier);
      if (!o) return null;
      const pool = L.gear.filter(x => x.tier === g.tier).length || 1;
      const rows = [
        { label: api.grade(g.tier).name + ' grade', p: o.p },
        { label: 'this item, 1 of ' + pool + ' in the grade', p: 1 / pool },
      ];
      let p = o.p / pool;
      const mintC = CAT.conditions[0];
      rows.push({ label: mintC.name + ' condition', p: mintC.hi });
      p *= mintC.hi;
      return { rows, total: p, one: Math.round(1 / p) };
    },
    // how many of this item the server has handed out, split the way csgoskins splits supply
    supplyOf(id) {
      const total = S.mint[id] || 0, mine = S.inv.filter(i => i.id === id);
      const byCond = {};
      for (const c of CAT.conditions) byCond[c.id] = 0;
      for (const i of mine) if (i.cond && byCond[i.cond] != null) byCond[i.cond]++;
      return { total, mine: mine.length, unusual: mine.filter(i => i.unusual).length, byCond };
    },

    // ---------- the trade-up ----------
    // CS2's contract: ten of one grade from one collection become one of the grade above. It is the
    // sink that stops the floor collapsing under duplicates, and it is what feeds the +N stamp.
    tradeNeed: 10,
    // every (grade, collection) pair this account could trade up right now
    tradeReady() {
      const out = [];
      const order = CAT.locker.odds.map(o => o.tier);
      for (let i = 0; i < order.length - 1; i++) {
        const t = order[i];
        const have = S.inv.filter(x => x.tier === t && !api.wornAny(x.uid));
        if (have.length >= api.tradeNeed) out.push({ from: t, to: order[i + 1], have: have.length });
      }
      return out;
    },
    wornAny(uid) { for (const k of Object.keys(S.wear)) if (S.wear[k] === uid) return true; return false; },
    tradeUp(tier, cb) {
      if (!api.connected()) return cb && cb({ ok: false, msg: 'Connect to online play first — a trade-up happens on your account, not on this device.' });
      api.tuPending = { cb, at: Date.now() };
      Net.send({ k: 'tradeup', tier });
      setTimeout(() => { if (api.tuPending && api.tuPending.cb === cb) { api.tuPending = null; cb && cb({ ok: false, msg: 'The market did not answer. Try again.' }); } }, 8000);
    },
    onTradeResult(m) {
      const p = api.tuPending; api.tuPending = null;
      if (m && m.ok) {
        if (Array.isArray(m.inv)) S.inv = m.inv.filter(i => i && GEAR_BY[i.id]);
        if (m.mint) S.mint = m.mint;
        save(); api.emit();
      }
      if (p && p.cb) p.cb(m);
    },

    // ---------- most worn ----------
    // fortnite.gg publishes a usage ranking for every cosmetic (1 BACKLASH 3.25% / 48M). It is the
    // proof of the visibility rule in public, and the best advert the items at the top could have.
    mostWorn: [],
    onMostWorn(m) { if (m && Array.isArray(m.worn)) { api.mostWorn = m.worn; api.emit(); } },

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
  if (m.k === 'paymenu' || m.k === 'payq' || m.k === 'payres' || m.k === 'payrest') { Econ.onPay(m); return; }
  if (m.k === 'lkres') { Econ.onOpenResult(m); return; }
  if (m.k === 'wearres') { Econ.onWearResult(m); return; }
  if (m.k === 'reactres') { Econ.onReactions(m); return; }
  if (m.k === 'traderes') { Econ.onTradeResult(m); return; }
  if (m.k === 'wornres') { Econ.onMostWorn(m); return; }
});
