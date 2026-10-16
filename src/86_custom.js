// ===== Your fighter: build, name and save one custom fighter (look only, never gameplay) =====
// The body is any roster fighter, whose moves and stats stay exactly the same. The look adds a recolour, a finish
// and procedural gear (hat, eyes, neck, aura) attached to the shared 24-bone rig. 91_v3_render calls
// CustomLook.apply(id, root, THREE, f) for every avatar. A slot opts in with slot.custom (this device's saved
// look) or slot.customLook (a look object, e.g. an online opponent's). Never touches fight state or rand().
(function () {
  const $c = id => document.getElementById(id);
  const sfx = () => { try { Sfx.ui(); } catch (e) { /* audio locked */ } };
  const KEY = 'customLook';
  const TINTS = [['orig', 'Original', null], ['crimson', 'Crimson', '#ff3048'], ['ember', 'Ember', '#ff7a2a'], ['gold', 'Gold', '#ffc83d'],
    ['toxic', 'Toxic', '#8dff3a'], ['cyan', 'Cyan', '#27e1ff'], ['cobalt', 'Cobalt', '#3a6bff'], ['violet', 'Violet', '#9b5cff'],
    ['pink', 'Pink', '#ff4fd8'], ['shadow', 'Shadow', '#5a5070'], ['ghost', 'Ghost', '#dfe9ff']];
  const FINISH = [['orig', 'Original'], ['matte', 'Matte'], ['gloss', 'Gloss'], ['chrome', 'Chrome'], ['gold', 'Gold plated']];
  // ---- HATS: a catalogue plus a measured fit table, 10/14 -----------------------------------------
  // 9/21 every hat was deleted from the list, because one procedural mesh cannot be made to sit on 46
  // different heads and Duane had asked five times: "all the caps are fucking fucked. just remove caps".
  // Deleting them was right at the time and wrong as an end state, because the fault was never the art.
  // It was that the game had no per-fighter record of where a hat belongs, so every piece was a guess
  // that happened to work on the three bodies anyone looked at.
  //
  // 10/14, from a teardown of how the shops that do this at scale actually hold it together. Three
  // mechanics, copied directly, all of them metadata rather than modelling:
  //
  //  1. ROBLOX publishes a hard size box per accessory slot, measured in the body's own units, and
  //     rules that an accessory floating off the visible head is a violation and not a tuning job.
  //     -> `box` below: a width band and a height ceiling in skull units. dev/gearprobe2.js rejects
  //        any piece that measures outside its own box, so "too big" and "too small" are now failures
  //        with a number attached instead of something he has to spot and report again.
  //  2. DOTA 2 never lets the item decide where it goes. Attachment data is per hero, owned by the
  //     game, and an item simply is not offered on a hero it was not authored for.
  //     -> `HAT_FIT` below: per kind, the bodies it measured clean on. The creator only ever offers a
  //        hat the selected fighter is in the table for, so there is no combination a player can reach
  //        that was not measured first. Written by the harness, never edited by hand.
  //  3. TEAM FORTRESS 2 has every cosmetic declare what it switches off underneath, which is why a
  //     hat removes the hair instead of growing through it.
  //     -> `hides` below, read by buildGear.
  //
  // The bar he set stands: a few pieces that sit perfectly beats a lot that look wrong. What changes is
  // that "sits perfectly" is now decided per fighter instead of per roster, so one bad head costs that
  // head one hat rather than costing everybody the hat.
  //
  // box = [wMin, wMax, riseMax]: the piece's widest point as a multiple of the skull's own half-width,
  // and how far it may stand proud of the crown in head heights. Both are measured on the posed skin by
  // dev/gearprobe2.js, in the body's units, so one box holds on a 46-body roster.
  //   kind        label          box                                hides
  // The numbers are the roster's own, not a guess. dev/gearcheck_hat_all.json measured all 14 pieces on
  // all 48 bodies with the box off, and each band is set at [0.85, 1.37] x that piece's own median
  // width and 2x its median rise. Checked against the bodies rendered and judged by eye: for the ball
  // cap the band keeps all 7 that look right and refuses all 10 that do not, which is the whole point
  // of writing it down as a number rather than deciding it again every time someone looks at a cap.
  // Width is measured against the skull AT THE CROWN, so a snout or a beak cannot flatter the score.
  const HAT_ALL = [
    ['cap',     'Ball cap',      { box: [2.12, 3.42, 0.87], hides: ['hair'] }],
    ['backcap', 'Cap backwards', { box: [2.06, 3.33, 0.87], hides: ['hair'] }],
    ['trucker', 'Trucker',       { box: [2.14, 3.44, 0.89], hides: ['hair'] }],
    ['beanie',  'Beanie',        { box: [1.54, 2.48, 1.43], hides: ['hair'] }],
    ['bucket',  'Bucket hat',    { box: [2.06, 3.32, 0.66], hides: ['hair'] }],
    ['cowboy',  'Cowboy hat',    { box: [2.34, 3.77, 0.62], hides: ['hair'] }],
    ['tophat',  'Top hat',       { box: [2.08, 3.35, 2.13], hides: ['hair'] }],
    ['crown',   'Royal crown',   { box: [1.44, 2.32, 1.08], hides: [] }],
    ['kabuto',  'Kabuto',        { box: [2.60, 4.19, 1.01], hides: ['hair'] }],
    ['ninja',   'Kung-fu band',  { box: [1.45, 2.34, 0.27], hides: [] }],
    ['band',    'Sweatband',     { box: [1.44, 2.32, 0.22], hides: [] }],
    ['bandana', 'Bandana',       { box: [1.47, 2.37, 0.69], hides: ['hair'] }],
    ['halo',    'Halo',          { box: [1.17, 1.89, 0.70], hides: [] }],
    ['horns',   'Devil horns',   { box: [1.30, 2.09, 2.03], hides: [] }],
    // Added 2026-10-15 for the locker, which was selling five head pieces with no mesh behind any of
    // them. Boxes set the same way the fourteen above were: [0.85, 1.37] x the piece's own median
    // width across all 48 bodies and 2x its median rise, from `NOBOX=1 SLOTS=hat node
    // dev/gearcheck.mjs` (dev/gearcheck_new_nobox.json). The visor's median rise is NEGATIVE (-0.11
    // head heights: its top sits below the crown, which is what a visor is), so its ceiling is the
    // 0.2 floor rather than twice a negative number.
    ['visor',   'Sun visor',     { box: [2.29, 3.70, 0.20], hides: [] }],
    ['fedora',  'Fedora',        { box: [2.05, 3.31, 0.55], hides: ['hair'] }],
    ['cans',    'Headphones',    { box: [1.61, 2.59, 0.53], hides: [] }],
    ['pilot',   'Pilot cap',     { box: [1.60, 2.58, 0.93], hides: ['hair'] }],
    ['wreath',  'Laurel wreath', { box: [1.41, 2.27, 0.20], hides: [] }],
  ];
  const HAT_META = {}; for (const [k, , m] of HAT_ALL) HAT_META[k] = m;
  // Bodies each hat measured clean on, written by `SLOTS=hat node dev/gearcheck.mjs`. A kind missing from
  // this object, or a body missing from its list, is not offered and is stripped from a saved look.
  // EDITED BY THE HARNESS ONLY. Hand-adding a body here puts a floating hat back in the game.
  const HAT_FIT = {
    backcap: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'topg',
               'clanker', 'giga', 'gwei', 'mochi', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'slam',
               'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad', 'popcat',
               'brett', 'moodeng'],
    band: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump',
            'clanker', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling',
            'techno', 'hoodie', 'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'bear', 'whale',
            'sin', 'gigachad', 'popcat', 'moodeng'],
    bandana: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump',
               'clanker', 'giga', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro',
               'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'wolverinu', 'bogdanoff', 'bull', 'bear',
               'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    beanie: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'clanker',
              'giga', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling',
              'techno', 'hoodie', 'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear',
              'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    bucket: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'topg', 'clanker', 'giga',
              'tyrant', 'gwei', 'mochi', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno',
              'hoodie', 'slam', 'mystic', 'ape', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad',
              'popcat', 'moodeng'],
    cans: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'clanker',
            'giga', 'tyrant', 'gwei', 'mochi', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'slam',
            'mystic', 'ape', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad', 'popcat',
            'brett', 'moodeng'],
    cap: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'topg',
           'trump', 'clanker', 'giga', 'gwei', 'mochi', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno',
           'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad',
           'popcat', 'brett', 'moodeng'],
    cowboy: ['doge', 'bonk', 'pengu', 'floki', 'cashcat', 'wojak', 'topg', 'clanker', 'giga', 'tyrant',
              'gwei', 'mochi', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic',
              'ape', 'wolverinu', 'bogdanoff', 'fartcoin', 'bear', 'whale', 'sin', 'gigachad', 'popcat',
              'moodeng'],
    crown: ['doge', 'shib', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'topg', 'giga', 'gwei', 'mochi',
             'spark', 'turbo', 'sifu', 'fro', 'bling', 'slam', 'mystic', 'ape', 'wolverinu', 'bogdanoff',
             'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    fedora: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'clanker',
              'giga', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling',
              'techno', 'slam', 'mystic', 'ape', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad',
              'popcat', 'moodeng'],
    halo: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster',
            'wojak', 'topg', 'clanker', 'giga', 'tyrant', 'gwei', 'kaiju', 'mochi', 'turbo', 'ginga',
            'sifu', 'fro', 'bling', 'techno', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu',
            'bogdanoff', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    horns: ['doge', 'bonk', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga',
             'gwei', 'mochi', 'omen', 'wisp', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie',
             'mystic', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'gigachad',
             'popcat', 'brett', 'moodeng'],
    kabuto: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'clanker',
              'giga', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling',
              'techno', 'slam', 'mystic', 'ape', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad',
              'popcat', 'moodeng'],
    ninja: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump',
             'clanker', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling',
             'techno', 'hoodie', 'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear',
             'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    pilot: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump',
             'clanker', 'giga', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu',
             'fro', 'bling', 'techno', 'slam', 'mystic', 'ape', 'wolverinu', 'bogdanoff', 'bull', 'bear',
             'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    tophat: ['doge', 'bonk', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'clanker', 'giga', 'tyrant',
              'gwei', 'mochi', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam',
              'mystic', 'ape', 'wolverinu', 'bogdanoff', 'fartcoin', 'bear', 'whale', 'sin', 'gigachad',
              'popcat', 'moodeng'],
    trucker: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'topg',
               'trump', 'clanker', 'giga', 'gwei', 'mochi', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno',
               'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'bear', 'whale', 'sin', 'gigachad',
               'popcat', 'brett', 'moodeng'],
    visor: ['doge', 'shib', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak',
             'topg', 'clanker', 'giga', 'tyrant', 'gwei', 'mochi', 'turbo', 'ginga', 'sifu', 'fro', 'bling',
             'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bear', 'whale', 'sin',
             'gigachad', 'popcat', 'brett', 'moodeng'],
    wreath: ['doge', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'topg', 'trump', 'giga', 'gwei',
              'mochi', 'wisp', 'spark', 'turbo', 'sifu', 'fro', 'bling', 'slam', 'mystic', 'ape', 'volt',
              'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
  };
  // The harness has to be able to fit a piece the gate would otherwise refuse, or it could never measure
  // a new one. Nothing in the page turns this off.
  let HAT_GATE = true;
  const hatFits = (kind, base) => kind === 'none' || (!HAT_GATE && !!HAT_META[kind]) || ((HAT_FIT[kind] || []).indexOf(base) >= 0);
  // every kind, for sanitize and for the harness; the creator asks hatsFor(base) instead
  const HATS = [['none', 'None']].concat(HAT_ALL.map(([k, label]) => [k, label]));
  const hatsFor = base => [['none', 'None']].concat(HAT_ALL.filter(([k]) => hatFits(k, base)).map(([k, label]) => [k, label]));
  const EYES = [['none', 'None'], ['rayban', 'Thick rims'], ['aviator', 'Aviators'], ['mafia', 'Mafia shades'],
    // Shutter shades removed 9/21 as well: it survived the first cut by accident (the edit only replaced the
    // second line of this list) and the proof run caught it floating on cheems, trump, bling and moodeng.
    // Monocle removed the same day: floating off KAIJU's face by 0.423 head-heights.
    // Same rule as the hats — a piece that cannot be shown to sit right on every fighter does not ship.
    ['goggles', 'Ski goggles'], ['shades', 'Pixel shades'],
    // Restored / added 2026-10-15, and GATED (see EYES_GATED below). `shutter` and `monocle` were cut
    // on 9/21 for floating on a handful of bodies -- which was the right call with no per-body table
    // to put them behind, and the wrong one now that there is. A piece that measures clean on 40 of 44
    // bodies should be offered on those 40, exactly like a hat, rather than taken away from everyone.
    // `patch` is new. None of the three is offered to anybody until the harness writes EYES_FIT.
    ['shutter', 'Shutter shades'], ['monocle', 'Monocle'], ['patch', 'Eyepatch']];
  // Trimmed 9/21 from ten styles to five, on measurement, not taste. `SLOTS=eyes dev/gearcheck.mjs` over the
  // whole roster scored 417/460 with only 24 of 46 fighters clean: `laser` floated on ten bodies, `visor` on
  // eight, `shutter` on six, `monocle` on four and `round` on three. The five left are 44/46 each, and the
  // only two they miss are the bodies below. He has asked for glasses on the eyes more than once and been
  // given floating ones each time, so the rule is the same as the hats: it ships when it is measured.
  //
  // OMEN and FARTCOIN fail every style (omen 0/10, fartcoin 1/10): the face measurement finds no usable eye
  // frame on those two heads, so there is nowhere correct to put a pair. They render with no glasses rather
  // than with a floating pair. Re-measure before ever taking a body off this list.
  const EYES_UNFIT = ['omen', 'fartcoin'];
  const HAIR = [['none', 'None']];
  const HAIRCOL = [['black', 'Black', '#140f16'], ['darkbrown', 'Dark brown', '#2e1b10'], ['brown', 'Brown', '#57331b'], ['auburn', 'Auburn', '#7a3418'],
    ['ginger', 'Ginger', '#c4521c'], ['blonde', 'Blonde', '#e3b75e'], ['platinum', 'Platinum', '#ece6d6'], ['grey', 'Grey', '#9aa0ad'],
    ['white', 'White', '#e6e8f0'], ['red', 'Red', '#d8203c'], ['pink', 'Pink', '#ff4fd8'], ['violet', 'Violet', '#9b5cff'],
    ['cyan', 'Cyan', '#27e1ff'], ['lime', 'Lime', '#8dff3a'], ['gold', 'Gold', '#ffc83d'], ['blue', 'Blue', '#3a6bff']];
  // hats get their own swatch row; 'auto' keeps each hat's signature colour
  const HATCOL = [['auto', 'Default', null], ['black', 'Black', '#15151b'], ['white', 'White', '#eef0f6'], ['red', 'Red', '#d8203c'],
    ['orange', 'Orange', '#ff7a2a'], ['gold', 'Gold', '#ffc83d'], ['lime', 'Lime', '#8dff3a'], ['green', 'Green', '#1f8f4e'],
    ['cyan', 'Cyan', '#27e1ff'], ['blue', 'Blue', '#2a5cff'], ['violet', 'Violet', '#9b5cff'], ['pink', 'Pink', '#ff4fd8'],
    ['brown', 'Brown', '#6b4526'], ['grey', 'Grey', '#8b93a3']];
  // skin / fur tone: recolours only the skin-coloured texels, so clothes, eyes and logos keep their colour
  const SKIN = [['orig', 'Original', null], ['deep', 'Deep', '#3a2318'], ['ebony', 'Ebony', '#4e3122'], ['brown', 'Brown', '#7a4c2e'],
    ['tan', 'Tan', '#a9714a'], ['olive', 'Olive', '#c08f5e'], ['light', 'Light', '#e0b088'], ['fair', 'Fair', '#f0cfb0'],
    ['grey', 'Stone', '#8b93a3'], ['green', 'Green', '#5fa04a'], ['blue', 'Blue', '#4f7fd8']];
  // 'scarf' REMOVED, 9/28. It was a flat slab that read as a necktie; reshaped into a band and a
  // knot, it then rode up onto doge's muzzle as a thick red sausage. Two attempts, still wrong on the
  // first body I checked, while none/gold/ice/bowtie are good on every body I rendered. Duane's call,
  // stated plainly: "id rather u leave out what looks shit before we ship to newgrounds then keeping
  // something that lowers the value of our product." The builder branch stays, so re-adding it later
  // is one word in this list.
  const NECK = [['none', 'None'], ['gold', 'Gold chain'], ['ice', 'Diamond chain'], ['bowtie', 'Bow tie'],
    // `scarf` has had a mesh in buildNeck the whole time and was simply never in this list; `tags` is
    // new. Both are gated, so neither reaches a body the harness has not measured them on.
    ['scarf', 'Scarf'], ['tags', 'Dog tags']];
  const SHOES = [['none', 'None'], ['sneak', 'Sneakers'], ['boots', 'Boots'], ['sandal', 'Sandals'], ['kicks', 'Gold kicks']];
  // ---------------------------------------------------------------- hands + back (2026-10-15)
  // The locker (89_econ.js) sells six slots and this file could only render four of them: nine of the
  // 27 gear pieces had nowhere to go, because `measure()` published no hand or chest frame and
  // `M.ax` had no entry to attach them to. Both are measured now (see `measure()`), and these two
  // lists follow the hats' rules exactly, for the same reasons:
  //   * `box` is the Roblox rule -- a hard size band in the PART'S OWN measured units, so "too big"
  //     is a failure with a number on it rather than something Duane has to spot and report again.
  //     hands: [spanMax, reachMax] = the piece's widest cross-section as a multiple of the measured
  //     hand half-width, and how far past the fingertips it may reach, in hand lengths.
  //     back:  [outMax, dropMax, offMax?] = how far it may stand off the measured back surface in
  //     torso depths, how far below the chest it may hang in torso heights, and -- only where the
  //     piece is deliberately asymmetric -- how far off centre it may sit. A slung katana IS
  //     diagonal, so it declares 0.70 rather than the probe loosening the rule for every piece.
  //   * `HAND_FIT` / `BACK_FIT` are the Dota rule -- per kind, the bodies the harness measured clean.
  //     WRITTEN BY `SLOTS=hands,back node dev/gearcheck.mjs`, NEVER BY HAND. Hand-adding a body here
  //     is exactly how a floating hat got back into the game last time.
  //   * `hides` is the TF2 rule, read by buildGear: a gauntlet switches off the hand wraps under it.
  // `hides` is empty on every piece in both lists and that is correct, not an oversight: the six
  // locker slots are mutually exclusive, so a gauntlet can never be worn over hand wraps and has
  // nothing to switch off. It stays in the shape because the hide list is read as a union in
  // buildGear, so the day a piece does cover another slot it is one line of data here.
  // Span ceilings are 1.37 x the piece's own median across 96 hands (48 bodies x 2), measured with
  // `NOBOX=1 SLOTS=hands,back` -> dev/gearcheck_hb_all.json. The reach ceiling is a flat 0.12 hand
  // lengths for every piece, because it is a design rule and not a fitted statistic: nothing in this
  // slot may stick out past the fingertips, and every piece here currently measures well inside it
  // (median reach runs -0.20 to -0.66, i.e. they all stop short of the fingers, as they should).
  const HANDS_ALL = [
    ['tape',  'Hand wraps',    { box: [2.51, 0.12], hides: [] }],
    ['mitts', 'Fingerless',    { box: [2.73, 0.12], hides: [] }],
    ['rings', 'Knuckle rings', { box: [2.30, 0.12], hides: [] }],
    // `one` declares a piece that is deliberately worn on ONE hand, so the probe's "built on one hand
    // only" rule knows the difference between a single watch and a glove that failed to build
    ['watch', 'Gold watch',    { box: [2.66, 0.12], hides: [], one: 'handR' }],
    ['gaunt', 'Gauntlets',     { box: [2.29, 0.12], hides: [] }],
    // ---- six more, 2026-10-16 ----
    // Counter-Strike ships eight glove TYPES and that slot is the second most valuable in the game.
    // Ours had five. Each of these is a different silhouette at the wrist and the knuckle, which is
    // the only place a glove is readable at tile size.
    ['driver', 'Driving gloves', { box: [2.60, 0.12], hides: [] }],
    ['moto',   'Moto gloves',    { box: [2.60, 0.12], hides: [] }],
    ['work',   'Work gloves',    { box: [2.75, 0.12], hides: [] }],
    ['latex',  'Surgical',       { box: [2.45, 0.12], hides: [] }],
    ['boxing', 'Boxing gloves',  { box: [2.95, 0.12], hides: [] }],
    ['chrome', 'Chrome gauntlet',{ box: [2.60, 0.12], hides: [] }],
  ];
  // Stand-off ceilings are 1.37 x the median across 48 bodies, from the same run. The DROP ceiling is
  // a design number where the median is zero or negative (a pack and a pair of wings both sit on the
  // chest band, so 1.37 x 0 would be a ceiling nothing could ever meet). Only the katana declares an
  // off-centre allowance, because it is the only piece here that is deliberately diagonal.
  const BACK_ALL = [
    ['pack',   'Backpack',     { box: [1.36, 0.25], hides: [] }],
    ['cape',   'Cape',         { box: [1.15, 1.78], hides: [] }],
    ['katana', 'Slung katana', { box: [1.24, 0.40, 0.25], hides: [] }],
    // RE-DERIVED after the wings were rebuilt. The box is defined as 1.37x the piece's OWN median,
    // so when the piece changes the number has to be measured again -- the first wings fanned out
    // sideways and sat 0.88 torso depths off the back; these sweep out and BACK, which is what makes
    // them read as wings at all, and they sit 1.44 off it. Re-measured, not relaxed: leaving the old
    // 1.20 in place would have gated the better-looking piece off 46 of 48 bodies on a number that
    // was describing a different object.
    ['wings',  'Wings',        { box: [1.98, 0.30], hides: [] }],
  ];
  // ---- GUARD and CHARM, the two slots added 2026-10-16 ---------------------------------------
  // Duane: "i like the shields btw", and from the shop teardown, the CS2 charm — a 2 cm object on a
  // chain off the grip, added to that game in 2024 and now its own nav category, trading from $0.12
  // to $106. Teardown: https://claude.ai/artifact/Ag7J6RSPKQwHZPfjMYKtrY
  //
  // NEITHER NEEDED A NEW ATTACHMENT POINT, which is why they were cheap to add. A shield rides on
  // the measured BACK surface (`M.back`) when it is idle, exactly where a cape or a pack already
  // sits, and a charm hangs off the measured HAND frame (`M.hands`). The slots are separate so a
  // shield never competes with a cape and a charm never competes with a glove — that separation is
  // the whole reason to have them rather than stuffing both into `back` and `hands`.
  //
  // Boxes are the same Roblox rule as every other slot: [outMax, dropMax, offMax] for a back piece,
  // [spanMax, reachMax] for a hand piece, and they are ceilings the harness enforces. The numbers
  // here are the DESIGN intent; `SLOTS=guard,charm node dev/gearcheck.mjs` measures each piece and
  // writes GUARD_FIT / CHARM_FIT below. Nothing is offered on a body until that table says so.
  const GUARD_ALL = [
    ['dumpster', 'Dumpster lid',    { box: [1.45, 0.45], hides: [] }],
    ['plyboard', 'Ply board',       { box: [1.45, 0.45], hides: [] }],
    ['stopsign', 'Stop sign',       { box: [1.50, 0.45], hides: [] }],
    ['manhole',  'Manhole cover',   { box: [1.45, 0.40], hides: [] }],
    ['plank',    'Scaffold plank',  { box: [1.40, 0.50], hides: [] }],
    ['cardoor',  'Car door',        { box: [1.55, 0.55], hides: [] }],
    ['riot',     'Riot shield',     { box: [1.45, 0.60], hides: [] }],
    ['table',    'Café table top', { box: [1.45, 0.40], hides: [] }],
    ['ticker',   'Ticker board',    { box: [1.50, 0.45], hides: [] }],
    ['vault',    'Vault door',      { box: [1.55, 0.40], hides: [] }],
    ['bullion',  'Bullion stack',   { box: [1.50, 0.40], hides: [] }],
    ['desk',     'The Floor',       { box: [1.60, 0.50], hides: [] }],
    // ---- eight more, 2026-10-16 ----
    // Duane wanted the shelf three times the size, and a shield is the piece he asked for by name.
    // Every one is picked for a SILHOUETTE that is not any of the twelve above: a disc with spokes,
    // a disc with a rolled rim, a tall door, a see-through round grate, a sign on a post, a
    // parabola, a slatted rectangle and a grid of screens.
    ['wheelrim', 'Alloy wheel',     { box: [1.45, 0.40], hides: [] }],
    ['oildrum',  'Drum lid',        { box: [1.45, 0.40], hides: [] }],
    ['firedoor', 'Fire door',       { box: [1.55, 0.55], hides: [] }],
    ['grill',    'Grill grate',     { box: [1.40, 0.40], hides: [] }],
    ['sign',     'Street sign',     { box: [1.50, 0.50], hides: [] }],
    ['dish',     'Satellite dish',  { box: [1.55, 0.45], hides: [] }],
    ['pallet',   'Pallet',          { box: [1.50, 0.50], hides: [] }],
    ['screens',  'The Wall',        { box: [1.55, 0.45], hides: [] }],
    // ---- ten more, same day ----
    ['hubcap',    'Hubcap',         { box: [1.45, 0.40], hides: [] }],
    ['cellar',    'Cellar door',    { box: [1.55, 0.50], hides: [] }],
    ['jukebox',   'Jukebox front',  { box: [1.55, 0.50], hides: [] }],
    ['gymlocker', 'Locker door',    { box: [1.55, 0.55], hides: [] }],
    ['pizzapan',  'Pizza pan',      { box: [1.45, 0.40], hides: [] }],
    ['sash',      'Sash window',    { box: [1.50, 0.50], hides: [] }],
    ['crate',     'Crate lid',      { box: [1.50, 0.45], hides: [] }],
    ['boiler',    'Boiler plate',   { box: [1.50, 0.45], hides: [] }],
    ['turnstile', 'Turnstile',      { box: [1.55, 0.50], hides: [] }],
    ['score',     'Scoreboard',     { box: [1.55, 0.45], hides: [] }],
  ];
  const CHARM_ALL = [
    ['salt',    'Pinch of salt',  { box: [1.60, 0.12], hides: [], one: 'handR' }],
    ['token',   'Subway token',   { box: [1.60, 0.12], hides: [], one: 'handR' }],
    ['dice',    'Dice pair',      { box: [1.70, 0.12], hides: [], one: 'handR' }],
    ['padlock', 'Padlock',        { box: [1.60, 0.12], hides: [], one: 'handR' }],
    ['lighter', 'Lighter',        { box: [1.60, 0.12], hides: [], one: 'handR' }],
    ['pager',   'Pager',          { box: [1.65, 0.12], hides: [], one: 'handR' }],
    ['sneaker', 'Sneaker',        { box: [1.70, 0.12], hides: [], one: 'handR' }],
    ['boombox', 'Boombox',        { box: [1.75, 0.12], hides: [], one: 'handR' }],
    ['plane',   'Paper plane',    { box: [1.70, 0.12], hides: [], one: 'handR' }],
    ['tooth',   'Gold tooth',     { box: [1.55, 0.12], hides: [], one: 'handR' }],
    ['crown',   'Crown pendant',  { box: [1.65, 0.12], hides: [], one: 'handR' }],
    ['hydrant', 'Mini hydrant',   { box: [1.60, 0.12], hides: [], one: 'handR' }],
    ['knuck',   'Brass knuckle',  { box: [1.70, 0.12], hides: [], one: 'handR' }],
    ['bull',    'Bull figurine',  { box: [1.65, 0.12], hides: [], one: 'handR' }],
  ];
  const HANDS_META = {}; for (const [k, , m] of HANDS_ALL) HANDS_META[k] = m;
  const BACK_META = {}; for (const [k, , m] of BACK_ALL) BACK_META[k] = m;
  const GUARD_META = {}; for (const [k, , m] of GUARD_ALL) GUARD_META[k] = m;
  const CHARM_META = {}; for (const [k, , m] of CHARM_ALL) CHARM_META[k] = m;
  // EDITED BY THE HARNESS ONLY. Empty means nothing is offered yet, which is the correct state for a
  // slot that has not been measured: the creator shows no row and a saved look migrates to 'none'.
  const HAND_FIT = {
    boxing: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    chrome: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    driver: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'clanker', 'giga', 'ronin', 'tyrant', 'shroom', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'ginga', 'fro', 'hoodie', 'slam', 'mystic', 'volt', 'bogdanoff', 'fartcoin', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    gaunt: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    latex: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    mitts: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'clanker', 'giga', 'ronin', 'tyrant', 'shroom', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'volt', 'bogdanoff', 'fartcoin', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    moto: ['doge', 'shib', 'pepe', 'wif', 'floki', 'cheems', 'cashcat', 'wojak', 'clanker', 'giga', 'ronin', 'tyrant', 'shroom', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'mystic', 'bogdanoff', 'fartcoin', 'bear', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    rings: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    tape: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ember', 'volt', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    watch: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'clanker', 'giga', 'ronin', 'tyrant', 'shroom', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ember', 'volt', 'bogdanoff', 'fartcoin', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    work: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
  };
  const BACK_FIT = {
    cape: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster',
            'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju',
            'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno',
            'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin',
            'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    katana: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster',
              'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju',
              'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno',
              'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin',
              'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    pack: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg',
            'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen',
            'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic',
            'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin',
            'gigachad', 'popcat', 'moodeng'],
    wings: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster',
             'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju',
             'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno',
             'hoodie', 'slam', 'mystic', 'ape', 'volt', 'wolverinu', 'fartcoin', 'bull', 'bear', 'whale',
             'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
  };
  // WRITTEN BY `SLOTS=guard,charm node dev/gearcheck.mjs`, NEVER BY HAND. Empty is the correct
  // state for a slot that has not been measured yet: nothing is offered, and the locker says so in
  // words rather than putting an unmeasured piece on a fighter.
  const GUARD_FIT = {
    boiler: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    bullion: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    cardoor: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    cellar: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    crate: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    desk: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    dish: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    dumpster: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    firedoor: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    grill: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    gymlocker: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    hubcap: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    jukebox: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    manhole: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    oildrum: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    pallet: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    pizzapan: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    plank: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    plyboard: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    riot: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    sash: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    score: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    screens: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    sign: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    stopsign: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    table: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    ticker: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    turnstile: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    vault: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
    wheelrim: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'moodeng'],
  };
  const CHARM_FIT = {
    boombox: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    bull: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    crown: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    dice: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    hydrant: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    knuck: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    lighter: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    padlock: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    pager: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    plane: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    salt: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    sneaker: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    token: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
    tooth: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'topg', 'trump', 'clanker', 'giga', 'ronin', 'tyrant', 'gwei', 'shroom', 'kaiju', 'mochi', 'omen', 'wisp', 'spark', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt', 'wolverinu', 'bogdanoff', 'fartcoin', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett', 'moodeng'],
  };
  let GEAR_GATE = true;
  const handFits = (kind, base) => kind === 'none' || (!GEAR_GATE && !!HANDS_META[kind]) || ((HAND_FIT[kind] || []).indexOf(base) >= 0);
  const backFits = (kind, base) => kind === 'none' || (!GEAR_GATE && !!BACK_META[kind]) || ((BACK_FIT[kind] || []).indexOf(base) >= 0);
  const guardFits = (kind, base) => kind === 'none' || (!GEAR_GATE && !!GUARD_META[kind]) || ((GUARD_FIT[kind] || []).indexOf(base) >= 0);
  const charmFits = (kind, base) => kind === 'none' || (!GEAR_GATE && !!CHARM_META[kind]) || ((CHARM_FIT[kind] || []).indexOf(base) >= 0);
  const HANDS = [['none', 'None']].concat(HANDS_ALL.map(([k, label]) => [k, label]));
  const BACKS = [['none', 'None']].concat(BACK_ALL.map(([k, label]) => [k, label]));
  const GUARDS = [['none', 'None']].concat(GUARD_ALL.map(([k, label]) => [k, label]));
  const CHARMS = [['none', 'None']].concat(CHARM_ALL.map(([k, label]) => [k, label]));
  const handsFor = base => [['none', 'None']].concat(HANDS_ALL.filter(([k]) => handFits(k, base)).map(([k, label]) => [k, label]));
  const backsFor = base => [['none', 'None']].concat(BACK_ALL.filter(([k]) => backFits(k, base)).map(([k, label]) => [k, label]));
  const guardsFor = base => [['none', 'None']].concat(GUARD_ALL.filter(([k]) => guardFits(k, base)).map(([k, label]) => [k, label]));
  const charmsFor = base => [['none', 'None']].concat(CHARM_ALL.filter(([k]) => charmFits(k, base)).map(([k, label]) => [k, label]));
  // ---------------------------------------------------------------- gating a kind added later
  // A slot that already shipped keeps the rule it shipped under, and anything ADDED to it afterwards
  // is gated per body until the harness has measured it. That is the only way to add to a live slot
  // without either taking an existing piece away or putting an unmeasured one on a fighter. The two
  // tables below are WRITTEN BY `SLOTS=eyes,neck node dev/gearcheck.mjs`, never by hand.
  // Every kind in both slots is gated now, not just the ones added on 10/15. Until there was a table
  // the shipped five pairs of glasses were offered to everybody, which is why `EYES_UNFIT` existed:
  // two bodies that failed EVERY style had to be special-cased by hand. With a measured table per
  // kind that list is just the rows nobody is in, and the five bodies a given style actually fails on
  // stop seeing that style instead of the whole roster losing it.
  const EYES_GATED = ['rayban', 'aviator', 'mafia', 'goggles', 'shades', 'shutter', 'monocle', 'patch'];
  const NECK_GATED = ['gold', 'ice', 'bowtie', 'scarf', 'tags'];
  const EYES_FIT = {
    aviator: ['doge', 'shib', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak',
               'topg', 'trump', 'clanker', 'giga', 'tyrant', 'gwei', 'kaiju', 'mochi', 'wisp', 'spark',
               'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape',
               'ember', 'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat',
               'brett', 'moodeng'],
    goggles: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster',
               'wojak', 'topg', 'trump', 'clanker', 'giga', 'tyrant', 'gwei', 'mochi', 'spark', 'turbo',
               'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember',
               'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett',
               'moodeng'],
    mafia: ['doge', 'shib', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak', 'trump',
             'clanker', 'giga', 'tyrant', 'gwei', 'kaiju', 'mochi', 'wisp', 'spark', 'turbo', 'chop',
             'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt',
             'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'popcat', 'brett', 'moodeng'],
    monocle: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster',
               'wojak', 'topg', 'trump', 'clanker', 'giga', 'tyrant', 'gwei', 'mochi', 'wisp', 'spark', 'chop',
               'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'volt',
               'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett',
               'moodeng'],
    patch: ['doge', 'shib', 'pengu', 'floki', 'cheems', 'lobster', 'wojak', 'trump', 'tyrant', 'mochi',
             'spark', 'turbo', 'ginga', 'sifu', 'fro', 'techno', 'hoodie', 'ape', 'bogdanoff', 'bull',
             'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett'],
    rayban: ['doge', 'shib', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak',
              'topg', 'trump', 'clanker', 'giga', 'tyrant', 'gwei', 'kaiju', 'mochi', 'wisp', 'spark',
              'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape',
              'ember', 'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat',
              'brett', 'moodeng'],
    shades: ['doge', 'shib', 'pepe', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'lobster', 'wojak',
              'topg', 'trump', 'clanker', 'giga', 'tyrant', 'gwei', 'kaiju', 'mochi', 'wisp', 'spark',
              'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie', 'slam', 'mystic', 'ape',
              'ember', 'volt', 'wolverinu', 'bogdanoff', 'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat',
              'brett', 'moodeng'],
    shutter: ['doge', 'shib', 'pepe', 'wif', 'pengu', 'floki', 'cashcat', 'lobster', 'wojak', 'topg', 'trump',
               'clanker', 'giga', 'tyrant', 'gwei', 'kaiju', 'mochi', 'wisp', 'spark', 'turbo', 'ginga',
               'sifu', 'fro', 'techno', 'hoodie', 'slam', 'mystic', 'ape', 'ember', 'wolverinu', 'bogdanoff',
               'bull', 'bear', 'whale', 'sin', 'gigachad', 'popcat', 'brett'],
  };
  const NECK_FIT = {
    bowtie: ['doge', 'shib', 'bonk', 'wif', 'floki', 'cashcat', 'wojak', 'trump', 'clanker', 'giga',
              'tyrant', 'mochi', 'wisp', 'chop', 'ginga', 'fro', 'bling', 'slam', 'wolverinu', 'bogdanoff',
              'bull', 'popcat', 'brett', 'moodeng'],
    gold: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cashcat', 'wojak', 'trump', 'clanker',
            'giga', 'mochi', 'wisp', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'slam', 'wolverinu',
            'bogdanoff', 'bull', 'sin', 'popcat', 'brett', 'moodeng'],
    ice: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cashcat', 'wojak', 'trump', 'clanker',
           'giga', 'mochi', 'wisp', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'slam', 'wolverinu',
           'bogdanoff', 'bull', 'sin', 'popcat', 'brett', 'moodeng'],
    scarf: ['shib', 'bonk', 'wif', 'pengu', 'floki', 'cashcat', 'wojak', 'topg', 'trump', 'clanker', 'giga',
             'tyrant', 'mochi', 'wisp', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling', 'techno', 'hoodie',
             'slam', 'ape', 'ember', 'bogdanoff', 'bull', 'whale', 'sin', 'popcat', 'brett', 'moodeng'],
    tags: ['doge', 'shib', 'pepe', 'bonk', 'wif', 'pengu', 'floki', 'cheems', 'cashcat', 'wojak', 'trump',
            'clanker', 'giga', 'tyrant', 'mochi', 'wisp', 'turbo', 'chop', 'ginga', 'sifu', 'fro', 'bling',
            'slam', 'ember', 'wolverinu', 'bogdanoff', 'bull', 'sin', 'popcat', 'brett', 'moodeng'],
  };
  const lateFits = (gated, table) => (kind, base) =>
    kind === 'none' || !GEAR_GATE || gated.indexOf(kind) < 0 || ((table[kind] || []).indexOf(base) >= 0);
  const eyeFits = lateFits(EYES_GATED, EYES_FIT);
  const neckFits = lateFits(NECK_GATED, NECK_FIT);
  const eyesFor = base => EYES_UNFIT.indexOf(base) >= 0 ? [['none', 'None']] : EYES.filter(([k]) => eyeFits(k, base));
  const neckFor = base => NECK.filter(([k]) => neckFits(k, base));
  // ---- MATERIALS, 9/26 --------------------------------------------------------------------------
  // Duane: "can u also step up the character edit section. thats always been the WEAKEST worst quality
  // complete bullshit from the game every time... like check other games and copy what they do."
  //
  // He is right, and the reason it is weak is written into this file's own history: hats and hair were
  // both pulled because procedural gear cannot be made to sit correctly on 46 different heads, so what
  // was left is a recolour and four small accessories. Two custom fighters still read as the same
  // fighter.
  //
  // What other games actually do for this is not more hats. Rocket League decals, Call of Duty camos,
  // Forza liveries, FIFA kits, Fortnite styles -- the thing that makes a character read as YOURS is the
  // MATERIAL, and every one of those is painted in texture space. That matters here for a specific
  // reason: a pattern lives in UV space, on the skin the artist already fitted, so it cannot float,
  // cannot clip, cannot be the wrong size on KAIJU and right on SPARK. It is the one kind of
  // customisation this rig can carry perfectly on all 46 bodies.
  //
  // Each pattern is a small GLSL snippet generated for the chosen kind only (no uber-shader branch) and
  // injected at <map_fragment> exactly like the tint above, so it keeps the texel's own lighting and
  // composes with the tint and the skin tone. Carbon and the tech patterns also drive roughness and
  // metalness, because a woven carbon panel that is as matte as fur does not read as carbon.
  const PATTERN = [['none', 'None'], ['carbon', 'Carbon fibre'], ['hex', 'Hex tech'], ['circuit', 'Circuit'],
    ['camo', 'Camo'], ['digi', 'Digital camo'], ['tiger', 'Tiger'], ['scale', 'Scales'],
    ['stripe', 'Racing stripes'], ['dots', 'Halftone'], ['grid', 'Wireframe grid'], ['splat', 'Splatter']];
  // 'auto' keeps each pattern's own signature colour, so one tap gives a look that already works
  const PATCOL = [['auto', 'Default', null], ['black', 'Black', '#14141a'], ['white', 'White', '#eef0f6'],
    ['steel', 'Steel', '#8b93a3'], ['red', 'Red', '#d8203c'], ['orange', 'Orange', '#ff7a2a'],
    ['gold', 'Gold', '#ffc83d'], ['lime', 'Lime', '#8dff3a'], ['green', 'Green', '#1f8f4e'],
    ['cyan', 'Cyan', '#27e1ff'], ['blue', 'Blue', '#2a5cff'], ['violet', 'Violet', '#9b5cff'],
    ['pink', 'Pink', '#ff4fd8'], ['sand', 'Sand', '#c8b487']];
  // the colour each pattern picks when PATCOL is 'auto'
  // Brighter than the first pass on purpose. A near-black pattern colour multiplied by a shading term
  // that only moves +/-25 % is crushed to a flat wash by ACES tone mapping -- looked at on DOGE, carbon,
  // hex, circuit, camo, digi and scale all came out as "the dog, but muddier". The weave has to be
  // readable at the size a fighter is actually drawn, which means a mid-tone base and real contrast.
  const PAT_AUTO = { carbon: '#3a3e47', hex: '#4a5c74', circuit: '#1d5c46', camo: '#6f7a54', digi: '#5d6a7e',
    tiger: '#1a1510', scale: '#54798f', stripe: '#eef0f6', dots: '#14141a', grid: '#27e1ff', splat: '#d8203c' };
  // patterns that should also look like a hard surface rather than fur
  const PAT_MAT = { carbon: [0.26, 0.55], hex: [0.32, 0.65], circuit: [0.38, 0.5], grid: [0.3, 0.4], scale: [0.35, 0.3] };
  // how strongly the pattern takes over the body. Tiger and camo are markings, carbon is a shell.
  // `stripe` was 0.85 of a near-white (#eef0f6) over the whole body, which turned doge from orange to
  // WHITE with pale grey stripes -- it erased the character instead of marking it. Racing stripes are
  // an accent, so it sits with dots and grid at 0.5 and the fighter's own colour shows between them.
  // `digi` at 0.9 of a grey-blue washed the whole fighter out the same way; 0.72 keeps the pattern
  // readable while leaving the body underneath recognisable.
  const PAT_AMT = { carbon: 0.92, hex: 0.82, circuit: 0.88, camo: 0.86, digi: 0.72, tiger: 0.72,
    scale: 0.82, stripe: 0.5, dots: 0.6, grid: 0.6, splat: 0.7 };

  const AURA = [['none', 'None'], ['flame', 'Super flame'], ['fire', 'Fire'], ['volt', 'Electric'], ['frost', 'Frost'], ['void', 'Void'], ['holy', 'Holy'], ['cash', 'Cash']];
  const AURA_COL = { fire: '#ff6a1a', volt: '#27e1ff', cash: '#3dff8a', void: '#9b5cff' };
  // ---- presets ------------------------------------------------------------------------------------
  // The other half of what good creators do: a row of finished looks, one tap each. "Randomise" gives
  // chaos -- eleven controls rolled independently almost never land on something that looks designed --
  // so the first thing a player sees is twelve looks that already work, and the controls become the
  // place they go to adjust one instead of the place they have to start from nothing.
  // The body is deliberately NOT part of a preset: the preset is the look, the body stays whoever they
  // picked, so every one of these works on all 46.
  const PRESETS = [
    ['carbon',  'Carbon',      { pattern: 'carbon', patcol: 'auto',   finish: 'gloss',  tint: 'shadow', neck: 'none',  eyes: 'shades',  aura: 'none' }],
    ['neon',    'Neon Wolf',   { pattern: 'hex',    patcol: 'cyan',   finish: 'gloss',  tint: 'cobalt', neck: 'none',  eyes: 'goggles', aura: 'volt' }],
    ['gold',    'Gold Standard', { pattern: 'none', patcol: 'auto',   finish: 'gold',   tint: 'gold',   neck: 'ice',   eyes: 'aviator', aura: 'holy' }],
    ['ronin',   'Street Ronin', { pattern: 'scale', patcol: 'red',    finish: 'matte',  tint: 'crimson',neck: 'none',  eyes: 'none',    aura: 'flame' }],
    ['ghostop', 'Ghost Op',    { pattern: 'digi',   patcol: 'steel',  finish: 'matte',  tint: 'ghost',  neck: 'none',  eyes: 'goggles', aura: 'frost' }],
    ['jungle',  'Jungle',      { pattern: 'camo',   patcol: 'green',  finish: 'matte',  tint: 'orig',   neck: 'none',  eyes: 'rayban',  aura: 'none' }],
    ['circuit', 'Mainframe',   { pattern: 'circuit',patcol: 'lime',   finish: 'gloss',  tint: 'shadow', neck: 'none',  eyes: 'shades',  aura: 'volt' }],
    ['tiger',   'Tiger',       { pattern: 'tiger',  patcol: 'auto',   finish: 'orig',   tint: 'ember',  neck: 'gold',  eyes: 'none',    aura: 'fire' }],
    ['chrome',  'Chrome',      { pattern: 'grid',   patcol: 'white',  finish: 'chrome', tint: 'orig',   neck: 'none',  eyes: 'mafia',   aura: 'none' }],
    ['racer',   'Racer',       { pattern: 'stripe', patcol: 'white',  finish: 'gloss',  tint: 'crimson',neck: 'none',  eyes: 'aviator', aura: 'none' }],
    ['ink',     'Ink',         { pattern: 'dots',   patcol: 'black',  finish: 'matte',  tint: 'ghost',  neck: 'bowtie',eyes: 'shades',  aura: 'none' }],
    ['void',    'Void',        { pattern: 'splat',  patcol: 'violet', finish: 'gloss',  tint: 'shadow', neck: 'none',  eyes: 'none',    aura: 'void' }],
  ];

  const TITLES = ['Street Legend', 'Diamond Hands', 'Degen', 'Whale Hunter', 'Rug Survivor', 'Chart Wizard', 'Bag Holder', 'Moon Walker'];
  const CSS_TINT = { crimson: 'sepia(1) saturate(5) hue-rotate(-45deg)', ember: 'sepia(1) saturate(4) hue-rotate(-15deg)', gold: 'sepia(1) saturate(3) hue-rotate(5deg)',
    toxic: 'sepia(1) saturate(4) hue-rotate(60deg)', cyan: 'sepia(1) saturate(4) hue-rotate(150deg)', cobalt: 'sepia(1) saturate(5) hue-rotate(185deg)',
    violet: 'sepia(1) saturate(4) hue-rotate(225deg)', pink: 'sepia(1) saturate(4) hue-rotate(275deg)', shadow: 'brightness(.45) saturate(.6)', ghost: 'grayscale(1) brightness(1.4)' };
  const GROUPS = [['tint', TINTS], ['skin', SKIN], ['finish', FINISH], ['pattern', PATTERN], ['patcol', PATCOL], ['hair', HAIR], ['haircol', HAIRCOL], ['hat', HATS], ['hatcol', HATCOL], ['eyes', EYES], ['neck', NECK], ['shoes', SHOES], ['hands', HANDS], ['back', BACKS], ['guard', GUARDS], ['charm', CHARMS], ['aura', AURA]];
  const DEF = { v: 1, base: 'doge', tint: 'orig', skin: 'orig', finish: 'orig', pattern: 'none', patcol: 'auto', hair: 'none', haircol: 'black', hat: 'none', hatcol: 'auto', eyes: 'shades', neck: 'gold', shoes: 'none', hands: 'none', back: 'none', guard: 'none', charm: 'none', aura: 'none', name: 'Rookie', title: 'Street Legend' };
  const cleanTxt = s => String(s || '').replace(/[^\w .\-]/g, '').replace(/\s+/g, ' ').trim();
  const cleanHandle = s => String(s == null ? '' : s).replace(/^\s*@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // sanitize MIGRATES, it never rejects: every field it recognises is kept and only the unknown ones fall back
  // to a default. Adding gear, renaming an option or bumping the version can never reset someone's fighter.
  function sanitize(lk) {
    const o = Object.assign({}, DEF, lk && typeof lk === 'object' ? lk : {});
    if (typeof CHAR_BY_ID === 'undefined' || !CHAR_BY_ID[o.base]) o.base = DEF.base;
    for (const [k, list] of GROUPS) if (!list.some(x => x[0] === o[k])) o[k] = DEF[k];
    // the Dota rule, enforced on the way in as well as in the picker: a hat that was never measured on
    // THIS body is not a hat on this body. Migrates silently, exactly like a retired kind.
    if (!hatFits(o.hat, o.base)) o.hat = 'none';
    if (!handFits(o.hands, o.base)) o.hands = 'none';
    if (!backFits(o.back, o.base)) o.back = 'none';
    if (!guardFits(o.guard, o.base)) o.guard = 'none';
    if (!charmFits(o.charm, o.base)) o.charm = 'none';
    if (!eyeFits(o.eyes, o.base)) o.eyes = 'none';
    if (!neckFits(o.neck, o.base)) o.neck = 'none';
    o.name = cleanTxt(o.name).slice(0, 16) || DEF.name;
    o.title = cleanTxt(o.title).slice(0, 22);
    o.v = 1;
    return { v: o.v, base: o.base, tint: o.tint, skin: o.skin, finish: o.finish, pattern: o.pattern, patcol: o.patcol, hair: o.hair, haircol: o.haircol, hat: o.hat, hatcol: o.hatcol, eyes: o.eyes, neck: o.neck, shoes: o.shoes, hands: o.hands, back: o.back, guard: o.guard, charm: o.charm, aura: o.aura, name: o.name, title: o.title };
  }

  // ---------------------------------------------------------------- keeping the fighter, whatever happens
  // A saved fighter is written to THREE places on every change (debounced): the normal store key, a raw
  // backup key, and a second backup under a fixed name. Nothing here ever writes defaults over a stored
  // look: if a read fails we fall back, and if every read fails we leave the slot empty rather than stamp
  // DEF over the top. Export / Import give a paste-able code so a wiped browser is still recoverable.
  const BAK_KEY = 'tb_customLook_bak', BAK2_KEY = 'tb_customLook_bak2';
  const rawGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const rawSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* quota or private mode */ } };
  function parseLook(s) { if (!s) return null; try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
  function loadSaved() {
    const tries = [store.get(KEY, null), parseLook(rawGet(BAK_KEY)), parseLook(rawGet(BAK2_KEY))];
    for (const t of tries) if (t) return sanitize(t);
    return null;
  }
  function backupExists() { return !!(parseLook(rawGet(BAK_KEY)) || parseLook(rawGet(BAK2_KEY))); }
  function writeSaved(lk) {
    const s = JSON.stringify(lk);
    store.set(KEY, lk); rawSet(BAK_KEY, s); rawSet(BAK2_KEY, s);
  }
  const b64 = {
    enc(o) { try { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, ''); } catch (e) { return ''; } },
    dec(s) { try { return JSON.parse(decodeURIComponent(escape(atob(String(s).trim().replace(/\s+/g, ''))))); } catch (e) { return null; } },
  };
  let saved = loadSaved();
  // A portrait of the player's own fighter, rendered from the live 3D preview whenever the look is saved.
  // Kept out of the look blob (which travels to online opponents) and out of `store` (dataURLs are big).
  const SHOT_KEY = 'tb_customShot';
  let shot = null, shotImg = null;
  try { shot = localStorage.getItem(SHOT_KEY) || null; } catch (e) { shot = null; }
  function setShot(url) {
    shot = url || null;
    try { if (shot) localStorage.setItem(SHOT_KEY, shot); else localStorage.removeItem(SHOT_KEY); } catch (e) { /* quota or private mode: the picture is optional */ }
    if (shot) { shotImg = new Image(); shotImg.src = shot; } else shotImg = null;
  }
  if (shot) { shotImg = new Image(); shotImg.src = shot; }

  // ---------------------------------------------------------------- 3D look
  // Avatar.update rewrites emissive / opacity on every material each frame (hit flash, invulnerability),
  // so glowing and see-through gear puts its own values back right before it is drawn.
  function keep(mesh, want) {
    mesh.userData.cfWant = want;
    mesh.onBeforeRender = function () {
      const m = this.material, w = this.userData.cfWant;
      if (w.emissive && m.emissive) { m.emissive.copy(w.emissive); m.emissiveIntensity = w.ei; }
      if (w.opacity != null) { m.opacity = w.opacity; m.transparent = true; }
      if (w.depthWrite != null) m.depthWrite = w.depthWrite;
      if (w.tick) w.tick(m, performance.now() / 1000, this);
    };
  }
  // Tinting used to flatten the art: every texel became luminance x tint, so the highlights clipped to white
  // and all the painted detail (eyes, logos, fur bands) washed out. Now the texel keeps its own brightness AND
  // a share of its own hue; only the overall colour cast moves to the tint.
  function recolor(m, color, amt, keepChroma) {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uCfTint = { value: color }; sh.uniforms.uCfAmt = { value: amt }; sh.uniforms.uCfKeep = { value: keepChroma == null ? 0.42 : keepChroma };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCfTint; uniform float uCfAmt; uniform float uCfKeep;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float cfL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 cfChroma = clamp(diffuseColor.rgb / max(cfL, 0.004), 0.0, 2.0);   // the texel's own colour, brightness removed
  vec3 cfBase = uCfTint * (0.14 + 1.28 * cfL);                            // the tint, shaded by the texel's brightness
  vec3 cfOut = mix(cfBase, cfBase * cfChroma, uCfKeep);                   // put some of the art's own colour back
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(cfOut, 0.0, 1.6), uCfAmt);
}`);
    };
    m.customProgramCacheKey = () => prevKey + '|cftint';
    m.needsUpdate = true;
  }
  // ---- the pattern shader ------------------------------------------------------------------------
  // One snippet per pattern, generated for the chosen kind only, so a fighter wearing carbon compiles
  // the carbon maths and nothing else. Every snippet sets three values and nothing more:
  //   pm  0..1  where the pattern colour goes (coverage)
  //   ps  ~0.6..1.3  a shading multiplier, so a weave or a scale edge catches the light
  //   pg  0..1  an edge/glow term, used for emissive on the tech patterns
  // Everything runs in vMapUv, the same UVs the artist painted on, so the pattern is the right size on
  // every body automatically -- which is the whole reason this works where hats did not.
  const PAT_NOISE = `
float cfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float cfNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cfHash(i), cfHash(i + vec2(1.0, 0.0)), f.x),
             mix(cfHash(i + vec2(0.0, 1.0)), cfHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float cfFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * cfNoise(p); p *= 2.03; a *= 0.5; } return v; }
float cfHex(vec2 p){ p = abs(p); return max(p.x * 0.866 + p.y * 0.5, p.y); }`;

  // WHY THESE ARE PROJECTED, NOT UV-MAPPED. The first cut of this read the patterns straight off
  // vMapUv and it was wrong on the model: a UV atlas is cut into islands and each island is rotated
  // and scaled however the unwrap wanted, so "stripes" came out as short streaks running in a
  // different direction on the arm, the leg and the gi, and the hex lattice broke at every seam.
  // Looked at on DOGE, tiger read as orange noise.
  //
  // So anything with a direction or a lattice is projected TRIPLANAR in the model's own object space
  // (bind pose, before skinning), which fixes all of it at once:
  //   - stripes run around the body, scales flow down it, the weave keeps one direction
  //   - the lattice crosses UV seams without breaking
  //   - it is the bind pose, so the pattern stays painted ON the fighter as he animates instead of
  //     swimming across him
  //   - divided by the model's own height, so one setting is the same size on WISP and on KAIJU
  // The three noise patterns (camo, digital, splatter) stay in UV space: noise is noise in any
  // projection, and UV costs one evaluation instead of three.
  const PAT_SRC = {
    // a 2x2 twill: alternating cells whose threads run at right angles, each thread rounded so it
    // catches a highlight down its middle, with a dark gap between the tows
    carbon: { tri: 1, scale: 30.0, src: `vec2 q = uv; vec2 ci = floor(q), cf = fract(q);
      float dir = mod(ci.x + ci.y, 2.0);
      float w = dir > 0.5 ? cf.x : cf.y;
      float thread = 0.46 + 1.16 * sin(w * 3.14159);
      float gap = smoothstep(0.0, 0.12, min(min(cf.x, cf.y), min(1.0 - cf.x, 1.0 - cf.y)));
      pm = 1.0; ps = mix(0.30, thread, gap); pg = 0.0;` },
    // hex cells with a bright rim
    hex: { tri: 1, scale: 12.0, src: `vec2 q = uv; q.x *= 1.1547;
      vec2 a = mod(q, vec2(1.0, 1.7320)) - vec2(0.5, 0.8660);
      vec2 b = mod(q + vec2(0.5, 0.8660), vec2(1.0, 1.7320)) - vec2(0.5, 0.8660);
      float d = cfHex(dot(a, a) < dot(b, b) ? a : b);
      float rim = smoothstep(0.39, 0.49, d);
      pm = 1.0; ps = mix(0.58, 1.62, rim); pg = rim;` },
    // PCB: traces on a grid that stop at random, with solder pads on the junctions
    circuit: { tri: 1, scale: 13.0, src: `vec2 q = uv; vec2 ci = floor(q), cf = fract(q);
      float r = cfHash(ci);
      float trace = max(smoothstep(0.105, 0.065, abs(cf.y - 0.5)) * step(0.5, r),
                        smoothstep(0.105, 0.065, abs(cf.x - 0.5)) * step(r, 0.5));
      float pad = smoothstep(0.19, 0.13, length(cf - 0.5)) * step(0.74, cfHash(ci + 7.3));
      float on = clamp(trace + pad, 0.0, 1.0);
      pm = 1.0; ps = mix(0.50, 1.80, on); pg = on;` },
    // three-band woodland: soft blobs, hard edges
    camo: { tri: 1, scale: 3.4, src: `vec2 q = uv;
      float n = cfFbm(q), n2 = cfFbm(q * 2.1 + 11.0);
      float band = step(0.46, n) + step(0.58, n2);
      pm = 1.0; ps = 0.52 + 0.44 * band; pg = 0.0;` },
    // the same idea quantised to a pixel grid
    digi: { tri: 1, scale: 26.0, src: `vec2 q = floor(uv) / 26.0;
      float n = cfFbm(q * 9.0), n2 = cfFbm(q * 18.0 + 4.0);
      float band = step(0.47, n) + step(0.57, n2);
      pm = 1.0; ps = 0.50 + 0.46 * band; pg = 0.0;` },
    // stripes that wander around the body, thin out at the ends, and cover only part of it
    tiger: { tri: 1, scale: 9.0, src: `float wob = cfFbm(uv * vec2(0.9, 2.6)) * 0.8;
      float st = sin(uv.x * 3.05 + wob * 5.0);
      float edge = smoothstep(0.42, 0.80, abs(st));
      float thin = smoothstep(0.18, 0.44, cfFbm(uv * 0.75 + 3.0));
      pm = edge * thin; ps = 1.0; pg = 0.0;` },
    // overlapping rounded scales, each lit along its lower edge, flowing down the body
    scale: { tri: 1, scale: 15.0, src: `vec2 q = uv * vec2(1.0, 0.78);
      float row = floor(q.y); q.x += mod(row, 2.0) * 0.5;
      vec2 cf = fract(q) - vec2(0.5, 0.25);
      float d = length(cf * vec2(1.0, 1.35));
      float body = smoothstep(0.52, 0.42, d);
      float lip = smoothstep(0.50, 0.44, d) - smoothstep(0.44, 0.34, d);
      pm = 1.0; ps = mix(0.44, 1.10, body) + lip * 0.72; pg = lip;` },
    // two stripes up the front and back centre line -- object space, so they actually run up the body
    stripe: { tri: 1, scale: 1.0, src: `float c = abs(uv.x);
      float s1 = smoothstep(0.075, 0.055, abs(c - 0.085));
      float s2 = smoothstep(0.075, 0.055, abs(c - 0.235));
      pm = clamp(s1 + s2, 0.0, 1.0); ps = 1.0; pg = 0.0;` },
    // halftone: dots that grow where the art is dark
    dots: { tri: 1, scale: 34.0, src: `vec2 cf = fract(uv) - 0.5;
      float rad = mix(0.12, 0.46, 1.0 - clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0));
      pm = smoothstep(rad, rad - 0.08, length(cf)); ps = 1.0; pg = 0.0;` },
    // a thin wireframe over the whole body
    grid: { tri: 1, scale: 20.0, src: `vec2 cf = abs(fract(uv) - 0.5);
      float line = smoothstep(0.44, 0.49, max(cf.x, cf.y));
      pm = line; ps = 1.0; pg = line;` },
    // paint thrown at it
    splat: { tri: 1, scale: 4.2, src: `float n = cfFbm(uv + 21.0);
      float n2 = cfFbm(uv * 2.4 + 5.0);
      pm = smoothstep(0.50, 0.58, n) * smoothstep(0.28, 0.50, n2); ps = 1.0; pg = 0.0;` },
  };

  // Injected at <map_fragment> like recolor/reskin. cfPatM is declared at file scope so the roughness
  // and emissive chunks further down the standard shader can read the coverage this computed -- three.js
  // runs map_fragment before roughnessmap_fragment and emissivemap_fragment, so the value is there.
  function patternize(m, kind, color, amt, rough, metal, glow, sizeK) {
    const P = PAT_SRC[kind]; if (!P) return;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    // one evaluation in UV space, or three blended by the object-space normal
    const evalBlock = P.tri ? `
  vec3 bn = normalize(abs(vCfNrm) + 1e-4); bn = bn * bn; bn = bn * bn; bn /= (bn.x + bn.y + bn.z);
  vec3 wp = vCfPos * uPatSize * ${P.scale.toFixed(2)};
  float pm = 0.0, ps = 0.0, pg = 0.0, tm, tsv, tg;
  { vec2 uv = wp.zy; float pm = 0.0, ps = 1.0, pg = 0.0; ${P.src} tm = pm; tsv = ps; tg = pg; }
  pm += tm * bn.x; ps += tsv * bn.x; pg += tg * bn.x;
  { vec2 uv = wp.xz; float pm = 0.0, ps = 1.0, pg = 0.0; ${P.src} tm = pm; tsv = ps; tg = pg; }
  pm += tm * bn.y; ps += tsv * bn.y; pg += tg * bn.y;
  { vec2 uv = wp.xy; float pm = 0.0, ps = 1.0, pg = 0.0; ${P.src} tm = pm; tsv = ps; tg = pg; }
  pm += tm * bn.z; ps += tsv * bn.z; pg += tg * bn.z;` : `
  vec2 uv = vMapUv * ${P.scale.toFixed(2)};
  float pm = 0.0, ps = 1.0, pg = 0.0;
  ${P.src}`;
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uPatCol = { value: color }; sh.uniforms.uPatAmt = { value: amt };
      sh.uniforms.uPatRough = { value: rough }; sh.uniforms.uPatMetal = { value: metal };
      sh.uniforms.uPatGlow = { value: glow }; sh.uniforms.uPatSize = { value: sizeK };
      if (P.tri) sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCfPos; varying vec3 vCfNrm;')
        // BIND POSE on purpose: `position` and `normal` before the skinning chunks, so the pattern is
        // painted on the fighter and moves with him instead of sliding over him as he animates.
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCfPos = position; vCfNrm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uPatCol; uniform float uPatAmt; uniform float uPatRough; uniform float uPatMetal; uniform float uPatGlow; uniform float uPatSize;
${P.tri ? 'varying vec3 vCfPos; varying vec3 vCfNrm;' : ''}
float cfPatM = 0.0; float cfPatG = 0.0;${PAT_NOISE}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{${evalBlock}
  cfPatM = clamp(pm, 0.0, 1.0) * uPatAmt; cfPatG = clamp(pg, 0.0, 1.0) * cfPatM;
  float pL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 pCol = uPatCol * (0.30 + 1.05 * pL);                       // relit by the texel, so the art's shading survives
  vec3 pOut = mix(diffuseColor.rgb * ps, pCol * ps, clamp(pm, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(pOut, 0.0, 1.6), uPatAmt);
}`);
      // a carbon panel is not as rough as fur, and a wireframe is not metal: only the patterns in
      // PAT_MAT ask for this, the rest pass -1 and the chunk is left alone
      if (rough >= 0) sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uPatRough, cfPatM);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, uPatMetal, cfPatM);`);
      if (glow > 0) sh.fragmentShader = sh.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uPatCol * (cfPatG * uPatGlow);`);
    };
    m.customProgramCacheKey = () => prevKey + '|cfpat' + kind + (rough >= 0 ? 'm' : '') + (glow > 0 ? 'g' : '');
    m.needsUpdate = true;
  }

  // Skin tone. The whole-body tint above recolours everything, which is no use for "make him black or brown":
  // clothes, eyes and logos have to stay put. So we find THIS fighter's actual skin colour by reading the base
  // texture at the UVs of the vertices nearest the rig's `headfront` marker (i.e. the middle of the face), and
  // the shader only moves texels whose colour sits near that one, keeping each texel's own shading.
  const skinRefCache = new Map();
  // THE FIGHTER'S ACTUAL COAT COLOUR.
  //
  // This used to take the 80 vertices nearest the rig's `headfront` marker -- the middle of the face
  // -- and use their median texel. On a cartoon animal the middle of the face is the MUZZLE, which is
  // cream or white, and white has no hue: `skC = rgb / luminance` comes out near (1,1,1), so the
  // shader's "is this texel skin" test then matched every pale, desaturated texel in the atlas and
  // missed the orange fur entirely. The visible result was Duane's, 9/28: "Skin/fur tone doesnt
  // change anything" -- picking `green` turned doge's CHAIN green and left the dog orange.
  //
  // Now it samples the whole head and upper body, throws away texels too dark or too bright to carry
  // a hue (eyes, nostrils, specular highlights), buckets what is left by hue, and takes the biggest
  // bucket. That is the coat, by definition: the colour most of the fighter is actually painted.
  function skinReference(root, T, id) {
    if (id && skinRefCache.has(id)) return skinRefCache.get(id);
    let out = null;
    try {
      let mesh = null; root.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
      const tex = mesh && mesh.material && mesh.material.map, img = tex && tex.image;
      const uv = mesh && mesh.geometry && mesh.geometry.attributes.uv;
      const marker = root.getObjectByName('headfront') || root.getObjectByName('Head');
      if (mesh && uv && img && img.width && marker) {
        if (mesh.skeleton) mesh.skeleton.update();
        const hp = marker.getWorldPosition(new T.Vector3()), v = new T.Vector3();
        // a generous ball around the head: the head itself plus the shoulders, which on almost every
        // fighter here is coat rather than clothing
        let far = 0; const n = mesh.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 4000));
        const pts = [];
        for (let i = 0; i < n; i += step) { mesh.getVertexPosition(i, v); mesh.localToWorld(v); pts.push([v.distanceToSquared(hp), i]); }
        pts.sort((a, b) => a[0] - b[0]);
        far = pts.length ? pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.45))][0] : 0;
        const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
        const g2 = c.getContext('2d', { willReadFrequently: true }); g2.drawImage(img, 0, 0, S, S);
        const data = g2.getImageData(0, 0, S, S).data;
        const sample = minSat => {
          const buckets = new Map();
          for (let q = 0; q < pts.length; q++) {
            if (pts[q][0] > far) break;
            const i = pts[q][1];
            const u = uv.getX(i), vv = tex.flipY === false ? uv.getY(i) : 1 - uv.getY(i);
            const x = Math.max(0, Math.min(S - 1, Math.floor(u * S))), y = Math.max(0, Math.min(S - 1, Math.floor(vv * S)));
            const o2 = (y * S + x) * 4;
            const r = data[o2] / 255, gg = data[o2 + 1] / 255, b = data[o2 + 2] / 255;
            const L = 0.299 * r + 0.587 * gg + 0.114 * b;
            if (L < 0.10 || L > 0.94) continue;                // an eye, a nostril, a blown highlight
            const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
            if ((mx - mn) / Math.max(mx, 0.004) < minSat) continue;
            const k = Math.round(r / L * 6) + ',' + Math.round(gg / L * 6) + ',' + Math.round(b / L * 6);
            let e = buckets.get(k); if (!e) { e = []; buckets.set(k, e); }
            e.push([r, gg, b]);
          }
          let b2 = null; for (const e of buckets.values()) if (!b2 || e.length > b2.length) b2 = e;
          return b2;
        };
        // CHROMATIC FIRST. Bucketing every texel picked doge's WHITE -- the muzzle, chest and paws
        // together outnumber the orange -- and a white reference has no hue, so the shader's
        // "is this skin" test then matched every pale texel in the atlas (the gold chain) and none of
        // the coat. Requiring some saturation makes the dominant bucket the coat itself. A genuinely
        // pale fighter (mochi, wojak) has no chromatic bucket, so it falls back to the old behaviour.
        let best = sample(0.22);
        if (!best || best.length < 12) best = sample(0);
        if (best && best.length >= 6) {
          const med = j => { const a = best.map(p => p[j]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
          out = new T.Color(med(0), med(1), med(2));
        }
      }
    } catch (e) { out = null; }
    if (id) skinRefCache.set(id, out);
    return out;
  }
  function reskin(m, ref, to, amt) {
    // UPDATE IN PLACE IF IT IS ALREADY PATCHED. onBeforeCompile runs once per PROGRAM, and the cache
    // key here ('|cfskin') does not mention the colour -- so on a material that has already been
    // through this, three.js reuses the compiled program, never calls onBeforeCompile again, and the
    // fresh `{ value: to }` objects assigned inside it are simply dropped. Picking a new tone then
    // changed nothing at all, which is exactly what Duane reported: "Skin/fur tone doesnt change
    // anything. colour only works." Holding the uniform objects and writing into them makes a tone
    // change take effect with no recompile.
    const U = m.userData && m.userData.cfSkinU;
    if (U) { U.uSkRef.value.copy(ref); U.uSkTo.value.copy(to); U.uSkAmt.value = amt; return; }
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      const uu = { uSkRef: { value: ref.clone() }, uSkTo: { value: to.clone() }, uSkAmt: { value: amt } };
      sh.uniforms.uSkRef = uu.uSkRef; sh.uniforms.uSkTo = uu.uSkTo; sh.uniforms.uSkAmt = uu.uSkAmt;
      if (!m.userData) m.userData = {};
      m.userData.cfSkinU = uu;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkRef; uniform vec3 uSkTo; uniform float uSkAmt;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float skL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float skRL = max(dot(uSkRef, vec3(0.299, 0.587, 0.114)), 0.004);
  vec3 skC = diffuseColor.rgb / max(skL, 0.004);           // this texel's hue, brightness removed
  vec3 skR = uSkRef / skRL;                                 // the face's hue, brightness removed
  float d = distance(skC, skR);                             // 0 on skin, large on clothes, eyes and logos
  // WIDE ON PURPOSE. This was smoothstep(0.40, 0.13, d) -- a texel had to be within a whisker of the
  // reference hue to count as skin. A coat is not one hue: doge runs orange through cream to white,
  // and a white texel has no hue at all, so the tight band matched almost none of the fur and the
  // control appeared dead. Forcing mask to 1.0 recoloured the whole fighter correctly, which proved
  // the reference and the uniforms were fine and the band was the thing rejecting the coat.
  //
  // It cannot be made perfect: doge's gi is the same orange as doge, and no hue test can separate a
  // coat from clothing painted the same colour. Wide is the right trade -- picking a tone visibly
  // changes the fighter, which is what the control promises, and strongly contrasting clothing
  // (a blue shirt, a red scarf) still keeps its own colour.
  float mask = smoothstep(0.78, 0.24, d) * smoothstep(0.02, 0.10, skL);
  vec3 toned = uSkTo * (skL / skRL);                        // the new tone, relit by this texel's own shading
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(toned, 0.0, 1.5), mask * uSkAmt);
}`);
    };
    m.customProgramCacheKey = () => prevKey + '|cfskin';
    m.needsUpdate = true;
  }
  // The triplanar patterns are measured in the model's OWN units, and the models are not the same
  // size, so a fixed scale would give KAIJU a fine weave and SPARK a tarpaulin. Divide by the mesh's
  // bind-pose height and one setting means the same thing on all 46. Cached on the geometry.
  function patSize(mesh, T) {
    const g = mesh.geometry; if (!g) return 1;
    if (g.userData.cfSize == null) {
      let h = 0;
      try { if (!g.boundingBox) g.computeBoundingBox(); h = g.boundingBox.max.y - g.boundingBox.min.y; } catch (e) { h = 0; }
      g.userData.cfSize = h > 0.01 ? 1 / h : 1;
    }
    return g.userData.cfSize;
  }

  function paintBody(root, T, lk, id) {
    const tint = (TINTS.find(t => t[0] === lk.tint) || [])[2];
    const skinTo = (SKIN.find(t => t[0] === lk.skin) || [])[2];
    const ref = skinTo ? skinReference(root, T, id) : null;
    const pat = lk.pattern && lk.pattern !== 'none' ? lk.pattern : null;
    const patCol = pat ? ((PATCOL.find(c => c[0] === lk.patcol) || [])[2] || PAT_AUTO[pat] || '#14141a') : null;
    root.traverse(o => {
      if (!o.isMesh || o.userData.cfGear) return;
      const m = o.material; if (!m || !m.isMeshStandardMaterial) return;
      if (lk.finish === 'matte') { m.roughness = 0.92; m.metalness = 0; }
      else if (lk.finish === 'gloss') { m.roughness = 0.2; m.metalness = 0.05; m.envMapIntensity = 1.3; }
      else if (lk.finish === 'chrome') { m.roughness = 0.14; m.metalness = 0.95; m.envMapIntensity = 1.7; }
      else if (lk.finish === 'gold') { m.roughness = 0.28; m.metalness = 0.9; m.envMapIntensity = 1.6; }
      // Chrome needs a neutral albedo the way gold needs a gold one. Metalness 0.95 over doge's ORANGE
      // texture just reads as darker, more saturated orange -- a metal's colour comes from its albedo,
      // so a chrome finish over a coloured coat looks like tinted plastic. Gold already forced its own
      // albedo on this line and that is exactly why gold was the only finish that read.
      const col = tint || (lk.finish === 'gold' ? '#ffc83d' : lk.finish === 'chrome' ? '#cfd6e2' : null);
      // ORDER MATTERS: each of these wraps the previous onBeforeCompile and the LAST one applied ends up
      // FIRST in the shader. Skin has to run before tint -- its mask compares against the texture's own
      // colour, and a tinted texel would no longer look like skin. The pattern goes BETWEEN them for the
      // same reason in reverse: applied after the skin tone (so the tone still finds real skin under it)
      // and before the tint (so a crimson fighter gets crimson carbon rather than carbon over crimson).
      if (col) recolor(m, new T.Color(col), lk.tint === 'shadow' || lk.tint === 'ghost' ? 0.9 : 0.78, lk.tint === 'shadow' || lk.tint === 'ghost' ? 0.25 : 0.46);
      // m.map is required: the snippets read vMapUv, which three.js only declares under USE_MAP, so a
      // mesh with no texture would fail to compile and render the fighter black.
      if (pat && m.map) {
        const mt = PAT_MAT[pat];
        patternize(m, pat, new T.Color(patCol), PAT_AMT[pat] == null ? 0.8 : PAT_AMT[pat],
          mt ? mt[0] : -1, mt ? mt[1] : 0, pat === 'circuit' ? 1.15 : (pat === 'grid' ? 0.75 : (pat === 'hex' ? 0.5 : 0)), patSize(o, T));
      }
      if (skinTo && ref) reskin(m, ref, new T.Color(skinTo), 0.95);
    });
  }

  // ---------------------------------------------------------------- measuring the body
  // Everything is measured in BONE-LOCAL space from the rig's own markers (head_end = crown,
  // headfront = face). World space was the old bug: the avatar is rotated in a match, so "front"
  // came out along the wrong axis and the glasses landed on top of the head.
  // The skin is sampled once and split by its DOMINANT SKIN BONE, so the head profile is the head and
  // the foot profile is that foot -- a radius filter used to drag in shoulders, chins and the other leg.
  const HB = 36, HA = 24;          // head profile: height bands x azimuth bins
  const EYE_K = 0.52;              // eye line, as a fraction of head height above the headfront marker
  // Per-fighter eye-line nudge, in head heights. THIS WAS AN EMPTY OBJECT until 9/28 -- the comment
  // said "filled from dev/gearcheck" and it never was, so all 46 fighters got the same 0.52 and the
  // glasses sat on the forehead of anything with a snout and under the eyes of anything with a tall
  // skull. Duane: "a lot are disproportionate, dont fit... or dont go on the right place."
  //
  // gearcheck could not have caught it: its eye rule compares the glasses against CustomLook's OWN
  // reported eyeY, so it only ever asked "did they land where we aimed", never "is that the eyes".
  // Measured instead by dev/eyeline.mjs, which finds the eyes in the TEXTURE -- the one dark feature
  // that comes in a symmetric pair, so noses and mouths (on the centre line) are excluded. 36 of the
  // 43 it could measure were more than 0.09 head-heights out.
  //
  // Clamped to +/-0.30: a masked face (bogdanoff, clanker, gwei, sin) has no painted eyes at all, so
  // its "dark pair" is a coat or a visor and the reading should not be trusted to the clamp edge.
  // Per-fighter eye-line nudge, in head heights. THIS WAS AN EMPTY OBJECT until 9/28 -- the comment
  // said "filled from dev/gearcheck" and it never was, so all 46 fighters shared one 0.52 guess.
  // gearcheck could not have caught it: its eye rule compares the glasses against CustomLook's OWN
  // reported eyeY, so it only ever asked "did they land where we aimed", never "is that the eyes".
  //
  // Measured by dev/eyeline.mjs, which finds the eyes in the TEXTURE. Two wrong answers first, both
  // worth keeping written down: darkness alone picks a black nose or a shadowed jaw, and local
  // CONTRAST alone still picks a cartoon mouth, which on a muzzle has more texels than the eyes do
  // and dragged doge's glasses onto its snout. Eyes are the high-contrast pair ABOVE the mouth, so
  // it takes the median of the upper half of the contrast points.
  //
  // Clamped: a masked face (bogdanoff, clanker, gwei, sin) has no painted eyes, so its reading is a
  // visor or a coat and must not be trusted to the edge of the face band.
  const EYE_ADJ = { ape: -0.280, bear: -0.118, bling: -0.261, bogdanoff: -0.280, bonk: -0.040, brett: 0.104,
    bull: 0.277, cashcat: -0.206, cheems: -0.075, chop: -0.280, clanker: -0.130, ember: 0.128, fartcoin: -0.173,
    floki: -0.166, giga: 0.340, gigachad: 0.128, ginga: 0.272, gwei: -0.105, hoodie: 0.211, kaiju: 0.340,
    lobster: 0.057, mochi: -0.153, moodeng: 0.063, mystic: 0.093, omen: 0.340, pengu: -0.100, pepe: -0.057,
    popcat: 0.035, shib: 0.137, shroom: -0.280, sifu: -0.280, sin: 0.199, spark: 0.248, techno: 0.310,
    topg: -0.080, trump: 0.062, turbo: -0.100, tyrant: -0.100, whale: -0.263, wif: 0.138, wisp: 0.277,
    wojak: 0.054 };

  function fillGaps(arr, seen) {
    const n = arr.length; let prev = -1;
    for (let i = 0; i < n; i++) {
      if (!seen[i]) continue;
      if (prev >= 0 && i - prev > 1) for (let k = prev + 1; k < i; k++) { const t = (k - prev) / (i - prev); arr[k] = arr[prev] * (1 - t) + arr[i] * t; }
      prev = i;
    }
    let first = -1; for (let i = 0; i < n; i++) if (seen[i]) { first = i; break; }
    if (first < 0) return;
    for (let i = 0; i < first; i++) arr[i] = arr[first];
    for (let i = prev + 1; i < n; i++) arr[i] = arr[prev];
  }
  // Half-width / half-depth / radius of a point cloud, band by band up the axis, plus a per-azimuth
  // radius map. Every gear builder sizes itself off this instead of one global "head width".
  function bandProfile(pts, y0, y1, nb, na) {
    const W = new Float64Array(nb), D = new Float64Array(nb), R = new Float64Array(nb), F = new Float64Array(nb), A = new Float64Array(nb * na);
    const seen = new Array(nb).fill(false), span = (y1 - y0) || 1, k = nb / span;
    const idx = y => Math.max(0, Math.min(nb - 1, Math.floor((y - y0) * k)));
    for (const p of pts) {
      if (p.y < y0 || p.y > y1) continue;
      const b = idx(p.y), ax = Math.abs(p.x), az = Math.abs(p.z), r = Math.hypot(p.x, p.z);
      seen[b] = true;
      if (ax > W[b]) W[b] = ax;
      if (az > D[b]) D[b] = az;
      if (r > R[b]) R[b] = r;
      let ai = Math.floor((Math.atan2(p.x, p.z) / (Math.PI * 2) + 0.5) * na); ai = ((ai % na) + na) % na;
      if (r > A[b * na + ai]) A[b * na + ai] = r;
    }
    for (const p of pts) { if (p.y < y0 || p.y > y1) continue; const b = idx(p.y); if (Math.abs(p.x) <= W[b] * 0.45 + 1e-9 && p.z > F[b]) F[b] = p.z; }
    fillGaps(W, seen); fillGaps(D, seen); fillGaps(R, seen); fillGaps(F, seen);
    const at = (arr, y) => { const t = Math.max(0, Math.min(nb - 1, (y - y0) * k - 0.5)); const i = Math.floor(t), f = t - i; return arr[i] * (1 - f) + arr[Math.min(nb - 1, i + 1)] * f; };
    const top = (arr, a, b) => { let m = 0; for (let i = idx(Math.min(a, b)), e = idx(Math.max(a, b)); i <= e; i++) if (arr[i] > m) m = arr[i]; return m; };
    return {
      y0, y1, nb, na, W, D, R, F, A, seen, idx,
      w: y => at(W, y), d: y => at(D, y), r: y => at(R, y), f: y => at(F, y),
      fitW: (a, b) => top(W, a, b), fitD: (a, b) => top(D, a, b), fitR: (a, b) => top(R, a, b),
      rad: (y, ang) => { const b = idx(y); let ai = Math.floor((ang / (Math.PI * 2) + 0.5) * na); ai = ((ai % na) + na) % na; return A[b * na + ai] || at(R, y); },
      cov: (b, thr) => { let c = 0; for (let a = 0; a < na; a++) if (A[b * na + a] >= thr) c++; return c; },
    };
  }

  function measure(root, T, id) {
    let top = root; while (top.parent) top = top.parent;
    top.updateMatrixWorld(true);
    const V = () => new T.Vector3();
    const bone = n => root.getObjectByName(n);
    const B = { head: bone('Head') || bone('head'), neck: bone('neck') || bone('Neck'), spine: bone('Spine02') || bone('Spine'),
      footL: bone('LeftFoot'), footR: bone('RightFoot'), toeL: bone('LeftToeBase'), toeR: bone('RightToeBase'),
      // hands, forearms and the chest, for the hands + back slots (added 2026-10-15). The rig is
      // Mixamo-named and the full list is in 90_v3_core.mjs:DOGE -- 24 bones, no finger bones, so a
      // hand's own geometry is the only thing that can say how big a glove is.
      handL: bone('LeftHand'), handR: bone('RightHand'), foreL: bone('LeftForeArm'), foreR: bone('RightForeArm'),
      chest: bone('Spine') || bone('Spine01') || bone('Spine02'), hips: bone('Hips'),
      shL: bone('LeftShoulder'), shR: bone('RightShoulder') };
    if (!B.head) return null;
    const headEnd = bone('head_end') || bone('HeadTop_End'), headFront = bone('headfront');
    const invHead = new T.Matrix4().copy(B.head.matrixWorld).invert();
    const invRoot = new T.Matrix4().copy(root.matrixWorld).invert();
    const toHead = o => o.getWorldPosition(V()).applyMatrix4(invHead);
    // up: toward the crown. front: toward the face, squared off against up.
    const up = V();
    if (headEnd) up.copy(toHead(headEnd));
    if (up.lengthSq() < 1e-9 && B.neck) up.copy(toHead(B.neck)).negate();
    if (up.lengthSq() < 1e-9) up.set(0, 1, 0);
    const H = up.length() || 1;
    up.normalize();
    const face = headFront ? toHead(headFront) : V().set(0, 0, H * 0.5);
    const faceUp = face.dot(up);
    const front = V().copy(face).addScaledVector(up, -faceUp);
    if (front.lengthSq() < 1e-9) front.set(0, 0, 1);
    front.normalize();
    const right = V().crossVectors(up, front).normalize();
    front.crossVectors(right, up).normalize();

    // one skin sample, world space, tagged with the bone that owns each vertex
    let mesh = null; root.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
    const WV = [], WB = [];
    if (mesh && mesh.geometry && mesh.geometry.attributes.position) {
      if (mesh.skeleton) mesh.skeleton.update();
      const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      const bones = (mesh.skeleton && mesh.skeleton.bones) || [];
      const n = pos.count, step = Math.max(1, Math.floor(n / 7000)), v = V();
      for (let i = 0; i < n; i += step) {
        mesh.getVertexPosition(i, v); mesh.localToWorld(v); WV.push(v.clone());
        let nm = '';
        if (si && sw) {
          let bi = -1, bw = -1;
          for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
          const bn = bones[bi]; nm = bn ? bn.name : '';
        }
        WB.push(nm);
      }
    }
    // Spine is deliberately NOT here. Adding it to widen the profile on round-bodied fighters made
    // things worse, not better -- 8 of 24 neck checks passing became 6, and it broke pepe, which had
    // been clean. The extra vertices move `nw`/`nd` and the profile in ways that cost more than the
    // round bodies gain, so this stays as it was and the round-body case is left alone.
    const HEADB = { Head: 1, head_end: 1, headfront: 1 }, NECKB = { neck: 1, Head: 1, Spine02: 1, Spine01: 1 };
    const weighted = WB.some(Boolean);

    // ---- head, in head-bone space
    const hv = [], v1 = V();
    for (let i = 0; i < WV.length; i++) {
      v1.copy(WV[i]).applyMatrix4(invHead);
      const x = v1.dot(right), y = v1.dot(up), z = v1.dot(front);
      if (weighted) { if (!HEADB[WB[i]]) continue; } else if (y < -0.9 * H || y > 2.4 * H || Math.hypot(x, z) > 2.8 * H) continue;
      if (y < -1.3 * H || y > 2.6 * H) continue;
      hv.push({ x, y, z });
    }
    const P = bandProfile(hv, -1.3 * H, 2.6 * H, HB, HA);
    const maxW = P.fitW(-0.2 * H, 1.9 * H) || H * 0.5;
    // crown: the top of the SKULL, not the tip of an ear, horn or crest. Width alone is not enough --
    // a pair of wide ears is as wide as the head. A skull band fills most of its azimuth bins; ears,
    // horns and crests fill two or three. head_end is the rig's own crown marker, so it anchors the result.
    let skullTop = -1e9; for (const p of hv) if (p.y > skullTop) skullTop = p.y;
    if (!isFinite(skullTop)) skullTop = H;
    let det = H;
    for (let i = HB - 1; i >= 0; i--) {
      const yTop = -1.3 * H + (i + 1) * (3.9 * H) / HB;
      if (yTop > 1.7 * H) continue;
      if (P.seen[i] && P.W[i] >= maxW * 0.4 && P.cov(i, maxW * 0.36) >= HA * 0.6) { det = yTop; break; }
    }
    let capY = Math.min(Math.max(det, H * 0.98), H * 1.25, skullTop);
    capY = Math.max(capY, H * 0.7);
    const hw = Math.max(H * 0.22, P.fitW(capY - H * 0.55, capY));
    const hd = Math.max(H * 0.22, P.fitD(capY - H * 0.55, capY));

    // eye line: the headfront marker sits on the face plane, the eyes a little above it
    const eyeY = Math.max(faceUp + H * 0.05, Math.min(faceUp + H * (EYE_K + (EYE_ADJ[id] || 0)), capY - H * 0.24));
    // face depth on a grid, so each lens can sit on the surface under it instead of one flat plane
    const GX = 15, GY = 22, gx0 = -maxW * 1.1, gx1 = maxW * 1.1, gy0 = -0.6 * H, gy1 = 1.9 * H;
    const FG = new Float64Array(GX * GY).fill(-1e9);
    for (const p of hv) {
      const i = Math.floor((p.x - gx0) / (gx1 - gx0) * GX), j = Math.floor((p.y - gy0) / (gy1 - gy0) * GY);
      if (i < 0 || i >= GX || j < 0 || j >= GY) continue;
      const q = j * GX + i; if (p.z > FG[q]) FG[q] = p.z;
    }
    const faceZAt = (x, y) => {
      const i = Math.max(0, Math.min(GX - 1, Math.floor((x - gx0) / (gx1 - gx0) * GX)));
      const j = Math.max(0, Math.min(GY - 1, Math.floor((y - gy0) / (gy1 - gy0) * GY)));
      let best = FG[j * GX + i];
      if (best < -1e8) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || a >= GX || b < 0 || b >= GY) continue; if (FG[b * GX + a] > best) best = FG[b * GX + a]; }
      return best < -1e8 ? P.f(y) : best;
    };
    const fz = Math.max(faceZAt(0, eyeY), P.f(eyeY), H * 0.1);
    let ew = 0;
    for (const p of hv) { if (Math.abs(p.y - eyeY) < H * 0.2 && p.z > fz * 0.35 && Math.abs(p.x) > ew) ew = Math.abs(p.x); }
    ew = Math.max(hw * 0.42, Math.min(ew || hw * 0.75, hw * 0.96));
    const sideW = Math.max(ew, P.w(eyeY)), sideD = Math.max(hd * 0.7, P.d(eyeY));

    // ---- neck, in the neck bone's own space
    const nb = B.neck || B.spine || B.head;
    const invNeck = new T.Matrix4().copy(nb.matrixWorld).invert();
    const qNeck = nb.getWorldQuaternion(new T.Quaternion()).invert();
    const qHead = B.head.getWorldQuaternion(new T.Quaternion());
    const wDir = v => v.clone().applyQuaternion(qHead);            // head-local direction -> world
    const headInNeck = B.head.getWorldPosition(V()).applyMatrix4(invNeck);
    // The neck's own axis is the line from the neck joint to the head joint -- THE rig's definition of a
    // neck. Using the head's up vector instead tilts the whole collar on any fighter whose head sits
    // forward of the neck, which is why several of them wore the chain on the chest.
    const nUp = headInNeck.lengthSq() > 1e-12 ? headInNeck.clone().normalize() : wDir(up).applyQuaternion(qNeck).normalize();
    const nFront = wDir(front).applyQuaternion(qNeck);
    nFront.addScaledVector(nUp, -nFront.dot(nUp));
    if (nFront.lengthSq() < 1e-12) nFront.set(0, 0, 1);
    nFront.normalize();
    const nRight = V().crossVectors(nUp, nFront).normalize();
    nFront.crossVectors(nRight, nUp).normalize();
    // every bone on this rig carries its own scale, so head-bone units are NOT neck-bone units. nH is the
    // head height expressed in NECK space -- mixing the two is what dropped the bow tie onto the chest.
    const nH = headEnd ? headEnd.getWorldPosition(V()).applyMatrix4(invNeck).distanceTo(headInNeck) || H : H;
    const nl = Math.max(nH * 0.14, headInNeck.dot(nUp));           // the neck joint up to the jaw
    const nv = [];
    for (let i = 0; i < WV.length; i++) {
      if (weighted && !NECKB[WB[i]]) continue;
      v1.copy(WV[i]).applyMatrix4(invNeck);
      const y = v1.dot(nUp); if (y < -nH * 0.95 || y > nl * 1.1) continue;
      const x = v1.dot(nRight), z = v1.dot(nFront);
      if (Math.hypot(x, z) > nH * 1.8) continue;
      nv.push({ x, y, z });
    }
    const NP = bandProfile(nv, -nH * 0.95, nl * 1.1, 20, HA);
    // the collar ring is sized at MID neck, where nothing else is in the way, then flared a little
    let nw = 0, nd = 0;
    for (const p of nv) { if (Math.abs(p.y - nl * 0.5) > nl * 0.32) continue; const ax = Math.abs(p.x), az = Math.abs(p.z); if (ax > nw) nw = ax; if (az > nd) nd = az; }
    nw = Math.max(nH * 0.1, Math.min(nw || nH * 0.4, nH * 0.9));
    nd = Math.max(nw * 0.55, Math.min(nd || nw, nw * 1.4));
    let chestZ = 0;
    const dropY = -nH * 0.34;
    for (const p of nv) { if (Math.abs(p.y - dropY) > nH * 0.14 || Math.abs(p.x) > nw * 0.85) continue; if (p.z > chestZ) chestZ = p.z; }
    if (!chestZ) chestZ = nd * 1.15;

    // ---- feet, each in its own foot-bone space
    const qRoot = root.getWorldQuaternion(new T.Quaternion());
    const feet = [];
    for (const [key, fb, tb] of [['footL', B.footL, B.toeL], ['footR', B.footR, B.toeR]]) {
      if (!fb) continue;
      const fo = fb.getWorldPosition(V()), to = tb ? tb.getWorldPosition(V()) : null;
      const invF = new T.Matrix4().copy(fb.matrixWorld).invert();
      const qF = fb.getWorldQuaternion(new T.Quaternion()).invert();
      const toeLen = to ? Math.max(fo.distanceTo(to), H * 0.15) : H * 0.55;
      const wFront = to ? V().copy(to).sub(fo) : wDir(front).applyQuaternion(qRoot);
      wFront.y = 0;
      if (wFront.lengthSq() < 1e-9) { wFront.copy(wDir(front)); wFront.y = 0; }
      if (wFront.lengthSq() < 1e-9) wFront.set(0, 0, 1);
      wFront.normalize();
      const fUp = V().set(0, 1, 0).applyQuaternion(qF).normalize();
      const fFront = wFront.clone().applyQuaternion(qF).normalize();
      const fRight = V().crossVectors(fUp, fFront).normalize();
      fFront.crossVectors(fRight, fUp).normalize();
      const own = { [fb.name]: 1 }; if (tb) own[tb.name] = 1;
      const fv = [];
      for (let i = 0; i < WV.length; i++) {
        if (weighted) { if (!own[WB[i]]) continue; } else if (WV[i].distanceTo(fo) > toeLen * 2.2) continue;
        v1.copy(WV[i]).applyMatrix4(invF);
        const x = v1.dot(fRight), y = v1.dot(fUp), z = v1.dot(fFront);
        if (y > toeLen * 1.4) continue;
        fv.push({ x, y, z });
      }
      if (fv.length < 8) continue;
      let soleY = Infinity, toeZ = -Infinity, heelZ = Infinity, xMin = Infinity, xMax = -Infinity, topY = -Infinity;
      for (const p of fv) {
        if (p.y < soleY) soleY = p.y; if (p.y > topY) topY = p.y;
        if (p.z > toeZ) toeZ = p.z; if (p.z < heelZ) heelZ = p.z;
        if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
      }
      const len = Math.max(toeLen * 0.9, toeZ - heelZ);
      feet.push({ key, b: fb, len, halfW: Math.max(len * 0.16, (xMax - xMin) / 2), cx: (xMin + xMax) / 2, soleY, topY, heelZ, toeZ, cz: (heelZ + toeZ) / 2,
        right: fRight, up: fUp, front: fFront });
    }

    // ---- a dense per-bone sample, for the small parts
    // The body sample above is decimated to ~7000 points, which is right for a head or a torso and
    // far too coarse for a hand: on several bodies it lands under a dozen points on one, and a
    // bounding box off a dozen points is a guess with a number next to it. Reading which bone owns a
    // vertex is cheap; transforming it is not, so the filter runs FIRST and only the vertices that
    // belong to the part are transformed. Nothing here touches the decimated sample -- the head,
    // neck and foot numbers (and therefore every measurement in HAT_FIT) are left exactly as they
    // were measured.
    function denseFor(names, inv) {
      const out = [];
      if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return out;
      const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
      const bones = (mesh.skeleton && mesh.skeleton.bones) || [];
      if (!si || !sw || !bones.length) return out;
      const v2 = V();
      for (let i = 0; i < pos.count; i++) {
        let bi = -1, bw2 = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw2) { bw2 = w; bi = si.getComponent(i, k); } }
        const bn = bones[bi];
        if (!bn || !names[bn.name]) continue;
        mesh.getVertexPosition(i, v2); mesh.localToWorld(v2);
        out.push(v2.clone().applyMatrix4(inv));
      }
      return out;
    }
    // the thinnest direction perpendicular to `axis`, scanned over a half turn. A hand is flat and a
    // torso is not a cylinder, so the minimum extent across the part IS the palm normal / the
    // front-back axis. It is measured per body, which is the whole point.
    function thinAxis(pts, axis) {
      let e1 = V().set(1, 0, 0);
      if (Math.abs(e1.dot(axis)) > 0.9) e1.set(0, 1, 0);
      e1.addScaledVector(axis, -e1.dot(axis));
      if (e1.lengthSq() < 1e-12) { e1.set(0, 0, 1); e1.addScaledVector(axis, -e1.dot(axis)); }
      e1.normalize();
      const e2 = V().crossVectors(axis, e1).normalize();
      let best = null, bestSpan = Infinity;
      const STEPS = 36, d = V();
      for (let s = 0; s < STEPS; s++) {
        const a = Math.PI * s / STEPS;
        d.copy(e1).multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
        let lo = Infinity, hi = -Infinity;
        for (const p of pts) { const t = p.dot(d); if (t < lo) lo = t; if (t > hi) hi = t; }
        const span = hi - lo;
        if (span < bestSpan) { bestSpan = span; best = d.clone(); }
      }
      return { dir: best || e1, span: isFinite(bestSpan) ? bestSpan : 0 };
    }

    // ---- hands, each in its own hand-bone space
    // This rig STOPS at `*Hand`: there are no finger bones, so the skeleton cannot say which way the
    // fingers point or which way the palm faces, and both have to be measured.
    //   * `front` is the limb axis, forearm -> hand, continued through the hand. It is the one
    //     direction the rig defines, and it is the direction a glove runs along.
    //   * `up` is the PALM NORMAL, taken as the thinnest direction across the hand (`thinAxis`). A
    //     hand is flat, a paw is flat, a mitten is flat: the minimum extent is always across the
    //     palm. Assuming an axis instead is what would put a watch through the back of a wrist.
    //   * the sign of `up` points AWAY from the hips, which on a hanging arm is the back of the
    //     hand. Only the watch face cares; everything else in the slot is a band or a sleeve and is
    //     symmetric about the palm plane on purpose.
    const hipsW = B.hips ? B.hips.getWorldPosition(V()) : null;
    const hands = [];
    for (const [key, hb, ab] of [['handL', B.handL, B.foreL], ['handR', B.handR, B.foreR]]) {
      if (!hb) continue;
      const ho = hb.getWorldPosition(V()), ao = ab ? ab.getWorldPosition(V()) : null;
      const invH = new T.Matrix4().copy(hb.matrixWorld).invert();
      const qH = hb.getWorldQuaternion(new T.Quaternion()).invert();
      const wFwd = ao ? V().copy(ho).sub(ao) : wDir(front);
      if (wFwd.lengthSq() < 1e-9) wFwd.copy(wDir(front));
      wFwd.normalize();
      const hFront = wFwd.clone().applyQuaternion(qH).normalize();
      const hv2 = denseFor({ [hb.name]: 1 }, invH);
      if (hv2.length < 24) continue;                       // too little geometry to measure: no gear
      const th = thinAxis(hv2, hFront);
      const hUp = th.dir.clone();
      // point it away from the body, so +up is the back of the hand rather than the palm
      if (hipsW) {
        const outw = V().copy(ho).sub(hipsW).applyQuaternion(qH);
        outw.addScaledVector(hFront, -outw.dot(hFront));
        if (outw.lengthSq() > 1e-12 && hUp.dot(outw) < 0) hUp.negate();
      }
      const hRight = V().crossVectors(hUp, hFront).normalize();
      hFront.crossVectors(hRight, hUp).normalize();
      let zMin = Infinity, zMax = -Infinity, xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const p of hv2) {
        const x = p.dot(hRight), y = p.dot(hUp), z = p.dot(hFront);
        if (z < zMin) zMin = z; if (z > zMax) zMax = z;
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      }
      const len = Math.max(zMax - zMin, 1e-5);
      hands.push({ key, b: hb, n: hv2.length, len,
        halfW: Math.max((xMax - xMin) / 2, len * 0.14), halfT: Math.max((yMax - yMin) / 2, len * 0.09),
        cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2, cz: (zMin + zMax) / 2, wristZ: zMin, tipZ: zMax,
        right: hRight, up: hUp, front: hFront });
    }

    // ---- the back, in the chest bone's space
    // `Spine` is the chest: the shoulders and the neck both hang off it, so it is the bone a pack, a
    // cape or a slung blade should follow. `up` is the chest -> neck line (the rig's own definition
    // of which way the torso points), `front` is the face direction carried down from the head, and
    // `backZ` is the MEASURED rear surface at mid-chest, not an offset from the bone. A pack hung off
    // the bone origin sits inside the ribcage on a round body and a foot behind a thin one.
    let back = null;
    if (B.chest) {
      const cb = B.chest;
      const invC = new T.Matrix4().copy(cb.matrixWorld).invert();
      const qC = cb.getWorldQuaternion(new T.Quaternion()).invert();
      const neckInC = (B.neck || B.head).getWorldPosition(V()).applyMatrix4(invC);
      const cUp = neckInC.lengthSq() > 1e-12 ? neckInC.clone().normalize() : wDir(up).applyQuaternion(qC).normalize();
      const cFront = wDir(front).applyQuaternion(qC);
      cFront.addScaledVector(cUp, -cFront.dot(cUp));
      if (cFront.lengthSq() < 1e-12) cFront.set(0, 0, 1);
      cFront.normalize();
      const cRight = V().crossVectors(cUp, cFront).normalize();
      cFront.crossVectors(cRight, cUp).normalize();
      const names = { [cb.name]: 1 };
      for (const b2 of [B.shL, B.shR, bone('Spine01'), bone('Spine02')]) if (b2) names[b2.name] = 1;
      const cv = denseFor(names, invC);
      // the torso segment length in CHEST units -- every bone on this rig carries its own scale, so
      // this may not be anything like `H`, and mixing the two is what dropped the bow tie on the chest
      const tH = Math.max(neckInC.length() || 0, 1e-5);
      if (cv.length >= 40) {
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
        for (const p of cv) {
          const x = p.dot(cRight), y = p.dot(cUp), z = p.dot(cFront);
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          if (y < yMin) yMin = y; if (y > yMax) yMax = y;
          if (z < zMin) zMin = z; if (z > zMax) zMax = z;
        }
        // the rear surface measured ACROSS THE MIDDLE of the back only: the shoulder caps and the
        // small of the back both sit further in, and letting them into the number pushes a pack out
        const midY = (yMin + yMax) / 2, bandY = Math.max((yMax - yMin) * 0.3, tH * 0.12);
        let rear = Infinity, rearW = 0;
        for (const p of cv) {
          const y = p.dot(cUp); if (Math.abs(y - midY) > bandY) continue;
          const x = p.dot(cRight); if (Math.abs(x) > (xMax - xMin) * 0.3) continue;
          const z = p.dot(cFront); if (z < rear) rear = z;
          if (Math.abs(x) > rearW) rearW = Math.abs(x);
        }
        if (!isFinite(rear)) rear = zMin;
        back = { b: cb, n: cv.length, tH,
          halfW: Math.max((xMax - xMin) / 2, tH * 0.2), halfD: Math.max((zMax - zMin) / 2, tH * 0.12),
          h: Math.max(yMax - yMin, tH * 0.4), midY, topY: yMax, botY: yMin, backZ: rear, frontZ: zMax,
          coreW: Math.max(rearW, tH * 0.16),
          right: cRight, up: cUp, front: cFront };
      }
    }

    // whole body, in the model's own space, for the aura
    let minY = Infinity, maxY = -Infinity, bw = 0;
    for (const w of WV) { const p = v1.copy(w).applyMatrix4(invRoot); if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; const r = Math.hypot(p.x, p.z); if (r > bw) bw = r; }
    if (!isFinite(minY)) { minY = 0; maxY = H * 5; }
    const S = maxY - minY;

    const basis = (r2, u2, f2) => new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r2, u2, f2));
    const rootFront = wDir(front).applyQuaternion(qRoot.clone().invert());
    rootFront.y = 0; if (rootFront.lengthSq() < 1e-9) rootFront.set(0, 0, 1); rootFront.normalize();
    const rootUp = V().set(0, 1, 0), rootRight = V().crossVectors(rootUp, rootFront).normalize();
    const span = Math.max(capY - eyeY, H * 0.26);
    const M = {
      B, root, id, H, S, hw, hd, ew, fz, capY, eyeY, faceUp, minY, bw: bw || S * 0.3, maxW, sideW, sideD, span,
      P, NP, faceZAt, nl, nw, nd, nH, chestZ, dropY, feet, hands, back, made: [],
      cx: 0, zc: 0, neckY: 0, nzc: 0,
      // where a hat sits: k = 0 is the eye line, k = 1 the crown
      hatY: k => capY - span * (1 - k),
      // the ellipse a piece of headwear needs to clear the skull between two heights. Pure width x depth
      // cuts the corners on a head that is not an ellipse, so it is also floored against the max radius.
      fit: (a, b) => {
        const lo = Math.min(a, b), hi = Math.max(a, b), rr = P.fitR(lo, hi);
        return { rx: Math.max(P.fitW(lo, hi), rr * 0.88, H * 0.18), rz: Math.max(P.fitD(lo, hi), rr * 0.88, H * 0.18) };
      },
      ax: {
        head: { b: B.head, q: basis(right, up, front), right, up, front },
        neck: { b: nb, q: basis(nRight, nUp, nFront), right: nRight, up: nUp, front: nFront },
        root: { b: root, q: basis(rootRight, rootUp, rootFront), right: rootRight, up: rootUp, front: rootFront },
      },
    };
    for (const f of feet) M.ax[f.key] = { b: f.b, q: basis(f.right, f.up, f.front), right: f.right, up: f.up, front: f.front };
    // THE ATTACHMENT REGISTRY. Every wearable names one of these and nothing attaches to the model
    // root: `head`, `neck`, `footL`, `footR`, `handL`, `handR`, `back`, and `root` for the aura
    // only, which is a volume around the whole body rather than a thing worn on it. Each entry is a
    // bone plus a frame measured on THIS body, so a piece built in one of them follows animation for
    // free -- it is parented to the bone, not re-positioned per frame.
    for (const h of hands) M.ax[h.key] = { b: h.b, q: basis(h.right, h.up, h.front), right: h.right, up: h.up, front: h.front };
    if (back) M.ax.back = { b: back.b, q: basis(back.right, back.up, back.front), right: back.right, up: back.up, front: back.front };
    return M;
  }

  // ---------------------------------------------------------------- gear building blocks
  function mat(T, o) { return new T.MeshStandardMaterial(o); }
  function glowMat(T, hex, ei, extra) {
    const col = new T.Color(hex);
    return { m: mat(T, Object.assign({ color: 0x000000, emissive: col, emissiveIntensity: ei, roughness: 0.4 }, extra || {})), want: { emissive: col.clone(), ei, opacity: extra && extra.opacity } };
  }
  // Avatar.update (91_v3_render) walks every material on the model each frame and writes emissive / opacity.
  // A ShaderMaterial has no .emissive, so anything custom carries a dummy one for that write to land on.
  function fxMat(T, o) {
    const m = new T.ShaderMaterial(o);
    m.emissive = new T.Color(); m.emissiveIntensity = 1;
    return m;
  }
  function part(T, g, geo, m, want, tag) {
    const me = new T.Mesh(geo, m); me.castShadow = true; me.userData.cfGear = true; me.userData.cfPart = tag || '';
    if (want) keep(me, want);
    g.add(me); return me;
  }
  function gearGroup(T, slot) { const g = new T.Group(); g.userData.T = T; g.userData.cfGear = true; g.userData.cfSlot = slot; return g; }
  function mount(M, which, g, x, y, z) {
    const ax = M.ax[which]; if (!ax || !ax.b) return null;
    g.quaternion.copy(ax.q);
    g.position.copy(ax.right.clone().multiplyScalar(x)).addScaledVector(ax.up, y).addScaledVector(ax.front, z);
    ax.b.add(g);
    const slot = g.userData.cfSlot, foot = g.userData.cfFoot, hand = g.userData.cfHand;
    // `cfHand` is propagated here as of 2026-10-16. buildHands has set it on the GROUP since the slot
    // shipped and nothing ever carried it down to the meshes, so `gearPoints` read '' for every piece
    // and dev/gearprobe2.js silently fell back to its proximity match. That fallback works for a glove,
    // which wraps the hand; it cannot work for a charm, which hangs BELOW it on a chain, and the first
    // charm run scored "handR: nothing built" 672 times because of this one missing word.
    g.traverse(o => { o.userData.cfGear = true; if (slot && !o.userData.cfSlot) o.userData.cfSlot = slot; if (foot && !o.userData.cfFoot) o.userData.cfFoot = foot; if (hand && !o.userData.cfHand) o.userData.cfHand = hand; });
    M.made.push(g);
    return g;
  }
  // a cylinder laid between two points: temple arms, chains, straps, dread segments
  function strut(T, g, a, b, r, m, tag, seg) {
    const d = new T.Vector3().subVectors(b, a), L = d.length() || 1e-4;
    const c = part(T, g, new T.CylinderGeometry(r, r, L, seg || 8), m, null, tag);
    c.position.copy(a).addScaledVector(d, 0.5);
    c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
    return c;
  }
  function roundedRect(T, w, h, r) {
    const s = new T.Shape(), x = w / 2, y = h / 2, k = Math.min(r, x * 0.98, y * 0.98);
    s.moveTo(-x + k, -y);
    s.lineTo(x - k, -y); s.quadraticCurveTo(x, -y, x, -y + k);
    s.lineTo(x, y - k); s.quadraticCurveTo(x, y, x - k, y);
    s.lineTo(-x + k, y); s.quadraticCurveTo(-x, y, -x, y - k);
    s.lineTo(-x, -y + k); s.quadraticCurveTo(-x, -y, -x + k, -y);
    return s;
  }
  function ringPlate(T, w, h, r, t, thick) {   // a rounded-rect frame with the middle cut out
    const s = roundedRect(T, w, h, r);
    const hole = roundedRect(T, Math.max(w - t * 2, w * 0.15), Math.max(h - t * 2, h * 0.15), Math.max(r - t, r * 0.2));
    s.holes.push(new T.Path(hole.getPoints(40).reverse()));
    const geo = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.28, bevelSize: thick * 0.28, bevelSegments: 2, curveSegments: 14 });
    geo.translate(0, 0, -thick / 2);
    return geo;
  }
  function slab(T, w, h, r, thick, bevel) {    // a solid rounded-rect plate (soles, plates, brims)
    const geo = new T.ExtrudeGeometry(roundedRect(T, w, h, r), { depth: thick, bevelEnabled: bevel !== false, bevelThickness: thick * 0.3, bevelSize: thick * 0.3, bevelSegments: 2, curveSegments: 14 });
    geo.translate(0, 0, -thick / 2);
    return geo;
  }
  // a flat ring (or ring sector) lying in the horizontal plane: hat brims. Built as an annulus so no part
  // of it ever passes through the skull -- a solid disc would.  angle 0 = +x, pi/2 = front.
  function arcPlate(T, r0, r1, a0, a1, thick) {
    const s = new T.Shape();
    s.absarc(0, 0, r1, a0, a1, false);
    s.absarc(0, 0, r0, a1, a0, true);
    s.closePath();
    const geo = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.25, bevelSize: thick * 0.25, bevelSegments: 1, curveSegments: 40 });
    geo.translate(0, 0, -thick / 2); geo.rotateX(Math.PI / 2);
    return geo;
  }
  function dome(T, g, m, rx, ry, rz, tag, phiLen, phiStart) {
    const d = part(T, g, new T.SphereGeometry(1, 34, 18, phiStart == null ? 0 : phiStart, phiLen == null ? Math.PI * 2 : phiLen, 0, Math.PI / 2), m, null, tag);
    d.scale.set(rx, ry, rz); return d;
  }
  function ellipseRing(T, g, m, rx, rz, tube, tag, arc) {
    const r = part(T, g, new T.TorusGeometry(1, tube / Math.max(rx, 1e-6), 12, 48, arc || Math.PI * 2), m, null, tag);
    r.rotation.x = Math.PI / 2; r.scale.set(rx, rx, 1); r.scale.y = rz;
    return r;
  }

  // THE piece that makes hats fit. A scaled hemisphere cuts into any head that is not a ball -- that is what
  // "the skull pokes through the hat" was. This builds a shell whose radius at every (height, direction) comes
  // from the measured skull profile, so a cap hugs a flat top, a snout, a crest or a dome alike.
  function skullShell(T, M, yb, pad, opt) {
    const o = opt || {}, P = M.P, NA2 = o.na || 34, NJ = o.nj || 12;
    let yTop = o.top == null ? M.capY : o.top;
    const org = o.org == null ? yb : o.org;   // y that becomes 0 in the geometry (normally the group's mount height)
    if (yTop - yb < M.H * 0.02) yTop = yb + M.H * 0.02;   // never collapse to a zero-height ring
    const KD = o.dome === false ? 0 : (o.domeSegs || 6);
    const Rmax = M.fit(yb, yTop).rx;
    const arc = o.arc == null ? Math.PI * 2 : o.arc, a0 = o.arcStart == null ? -Math.PI : o.arcStart;
    const step = Math.PI * 2 / NA2;
    const rAt = (y, ang) => {
      let r = 0;
      for (let d = -1; d <= 1; d++) r = Math.max(r, P.rad(y, ang + d * step));
      // CLEARANCE, 10/14. A hat is not shrink-wrapped to the skin, and this profile and the one
      // dev/gearprobe2.js builds for itself are two independent estimates of the same fur: a shell laid
      // exactly on the measured surface reads as "the skull pokes through the hat" wherever the two
      // disagree by a few percent, which across 46 heads is everywhere (doge 40% of cells, pepe 36%).
      // The clearance is proportional to the HEAD rather than to a fixed slice of H, so it scales with
      // the body instead of being generous on a big skull and invisible on a small one.
      return Math.min(Math.max(r, Rmax * 0.28), Rmax * 1.38) + Rmax * 0.065 + pad;
    };
    const rings = [];
    for (let j = 0; j <= NJ; j++) {
      const y = yb + (yTop - yb) * (j / NJ), row = [];
      for (let i = 0; i <= NA2; i++) row.push(rAt(y, a0 + arc * (i / NA2)));
      rings.push({ y, row });
    }
    const top = rings[rings.length - 1];
    let mean = 0; for (const r of top.row) mean += r; mean /= top.row.length;
    const domeH = mean * (o.domeH == null ? 0.66 : o.domeH);
    for (let k = 1; k <= KD; k++) {
      const a = (k / KD) * Math.PI / 2, f = Math.cos(a) * (k === KD ? 0 : 1) || 1e-3;
      rings.push({ y: yTop + domeH * Math.sin(a), row: top.row.map(r => Math.max(r * Math.cos(a), 1e-4)) });
    }
    const pos = [], idx = [], NR = rings.length, W2 = NA2 + 1;
    for (let j = 0; j < NR; j++) {
      const R = rings[j];
      for (let i = 0; i <= NA2; i++) {
        const ang = a0 + arc * (i / NA2), r = R.row[i];
        pos.push(Math.sin(ang) * r, R.y - org, Math.cos(ang) * r);
      }
    }
    for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NA2; i++) {
      const a = j * W2 + i, b = a + 1, c = a + W2, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // a band that follows the skull between two heights: headbands, hat bands, crown bands
  function skullBand(T, M, y0, y1, pad, org) {
    return skullShell(T, M, y0, pad, { top: y1, nj: 3, dome: false, org: org == null ? y0 : org });
  }
  const hexCol = (T, list, key, fallback) => { const e = list.find(x => x[0] === key); return new T.Color(e && e[2] ? e[2] : fallback); };
  const shade = (T, c, k) => new T.Color(c).multiplyScalar(k);

  // ---------------------------------------------------------------- hats
  function buildHat(T, M, kind, colKey) {
    const g = gearGroup(T, 'hat'), H = M.H;
    const custom = colKey && colKey !== 'auto' ? hexCol(T, HATCOL, colKey, '#ffffff') : null;
    const main = def => custom || new T.Color(def);
    const gold = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.2, envMapIntensity: 1.9 });
    const goldD = mat(T, { color: 0xc99a22, metalness: 1, roughness: 0.32, envMapIntensity: 1.5 });
    const line = y => M.fit(y, M.capY);

    if (kind === 'cap' || kind === 'trucker' || kind === 'backcap') {
      const back = kind === 'backcap';
      const yb = M.hatY(back ? 0.5 : 0.42);
      const col = main(kind === 'trucker' ? 0x16305c : back ? 0x1b1d26 : 0xcf2038);
      const cloth = mat(T, { color: col, roughness: 0.74 });
      const rx = M.fit(yb, M.capY).rx;
      part(T, g, skullShell(T, M, yb, H * 0.018, { domeH: 0.72 }), cloth, null, 'crown');
      if (kind === 'trucker') {
        const fr = part(T, g, skullShell(T, M, yb, H * 0.026, { domeH: 0.72, arc: Math.PI * 0.86, arcStart: -Math.PI * 0.43 }), mat(T, { color: shade(T, col, 2.4).lerp(new T.Color(0xf2f3f7), 0.7), roughness: 0.88 }), null, 'panel');
        fr.position.y = 0;
      }
      const arc = Math.PI * (kind === 'trucker' ? 1.0 : 0.96);
      const dir = back ? -1 : 1;
      const br = part(T, g, arcPlate(T, rx * 0.72, rx * 1.05, Math.PI / 2 - arc / 2, Math.PI / 2 + arc / 2, H * 0.036), cloth, null, 'brim');
      br.scale.z = 1.75 * dir; br.position.y = H * 0.022; br.rotation.x = (kind === 'trucker' ? 0.03 : 0.14) * dir;
      if (back) {   // snapback strap, now at the front
        part(T, g, skullBand(T, M, yb, yb + H * 0.07, H * 0.026, yb), mat(T, { color: shade(T, col, 1.7), roughness: 0.7 }), null, 'strap');
        for (let i = 0; i < 5; i++) { const stud = part(T, g, new T.SphereGeometry(rx * 0.045, 8, 6), mat(T, { color: 0xdfe3ec, metalness: 0.9, roughness: 0.3 }), null, 'stud'); stud.position.set((i - 2) * rx * 0.13, H * 0.035, rx * 1.0); }
      }
      const btn = part(T, g, new T.SphereGeometry(rx * 0.08, 12, 10), cloth, null, 'button'); btn.position.y = (M.capY - yb) + rx * 0.62;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'beanie') {
      const yb = M.hatY(0.1), col = main(0xe23a4e);
      const knit = mat(T, { color: col, roughness: 0.96 });
      const rx = M.fit(yb, M.capY).rx;
      part(T, g, skullShell(T, M, yb, H * 0.04, { domeH: 0.9 }), knit, null, 'crown');
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI + i / 12 * Math.PI * 2;
        const rib = part(T, g, skullShell(T, M, yb, H * 0.052, { domeH: 0.9, arc: 0.1, arcStart: a, na: 3 }), mat(T, { color: shade(T, col, 0.78), roughness: 0.96 }), null, 'rib');
      }
      const cuff = part(T, g, skullBand(T, M, yb - H * 0.02, yb + H * 0.11, H * 0.055, yb), mat(T, { color: shade(T, col, 1.35).lerp(new T.Color(0xffffff), 0.45), roughness: 0.96 }), null, 'cuff');
      const pom = part(T, g, new T.SphereGeometry(rx * 0.3, 16, 12), mat(T, { color: shade(T, col, 1.35).lerp(new T.Color(0xffffff), 0.45), roughness: 1 }), null, 'pom');
      pom.position.y = (M.capY - yb) + rx * 0.82;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'bucket') {
      const yb = M.hatY(0.36), col = main(0x2f7a4a), rx = M.fit(yb, M.capY).rx, rz = M.fit(yb, M.capY).rz;
      const cloth = mat(T, { color: col, roughness: 0.9 });
      part(T, g, skullShell(T, M, yb, H * 0.022, { domeH: 0.55 }), cloth, null, 'crown');
      const brimM = new T.MeshStandardMaterial({ color: col, roughness: 0.9, side: T.DoubleSide });
      const br = part(T, g, new T.CylinderGeometry(rx * 1.02, rx * 1.62, H * 0.11, 44, 1, true), brimM, null, 'brim');
      br.scale.z = rz / rx; br.position.y = -H * 0.05;
      const lip = ellipseRing(T, g, cloth, rx * 1.6, rz * 1.6, rx * 0.06, 'lip'); lip.position.y = -H * 0.105;
      part(T, g, skullBand(T, M, yb + H * 0.04, yb + H * 0.13, H * 0.03, yb), mat(T, { color: shade(T, col, 0.55), roughness: 0.85 }), null, 'band');
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'cowboy') {
      const yb = M.hatY(0.46), f = line(yb), rx = f.rx * 1.05, rz = f.rz * 1.05, col = main(0x6b4526);
      const felt = mat(T, { color: col, roughness: 0.84 });
      const hc = (M.capY - yb) * 1.45 + H * 0.16;
      const pts = [[0.0, hc], [0.42, hc * 0.99], [0.7, hc * 0.9], [0.86, hc * 0.58], [0.97, hc * 0.22], [1.0, 0]];
      const crown = part(T, g, new T.LatheGeometry(pts.map(p => new T.Vector2(Math.max(p[0] * rx, 1e-4), p[1])), 40), felt, null, 'crown');
      crown.scale.z = rz / rx;
      const bp = [[0.35, 0.02], [0.8, -0.03], [1.25, -0.07], [1.62, -0.05], [1.74, 0.06], [1.72, 0.1], [1.58, 0.02], [1.2, -0.02], [0.78, 0.02], [0.35, 0.06]];
      const brimM = new T.MeshStandardMaterial({ color: col, roughness: 0.84, side: T.DoubleSide });
      const br = part(T, g, new T.LatheGeometry(bp.map(p => new T.Vector2(Math.max(p[0] * rx, 1e-4), p[1] * H * 2.2)), 48), brimM, null, 'brim');
      br.scale.z = (rz / rx) * 1.06;
      const band = ellipseRing(T, g, mat(T, { color: shade(T, col, 0.35), roughness: 0.7 }), rx * 1.02, rz * 1.02, rx * 0.13, 'band'); band.position.y = hc * 0.16;
      const buck = part(T, g, new T.BoxGeometry(rx * 0.3, rx * 0.22, rx * 0.08), gold, null, 'buckle'); buck.position.set(0, hc * 0.16, rz * 1.06);
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'tophat') {
      const yb = M.hatY(0.4), f = line(yb), rx = f.rx * 1.03, rz = f.rz * 1.03, col = main(0x0e0e13);
      const black = mat(T, { color: col, roughness: 0.42 });
      const br = part(T, g, arcPlate(T, rx * 0.99, rx * 1.62, 0, Math.PI * 2, H * 0.05), black, null, 'brim'); br.scale.z = rz / rx;
      const hollow = new T.MeshStandardMaterial({ color: col, roughness: 0.42, side: T.DoubleSide });
      const hgt = (M.capY - yb) + H * 1.05;
      const crown = part(T, g, new T.CylinderGeometry(rx * 0.99, rx * 1.03, hgt, 44, 1, true), hollow, null, 'crown'); crown.scale.z = rz / rx; crown.position.y = hgt / 2;
      const lid = part(T, g, new T.CylinderGeometry(rx * 0.99, rx * 0.99, H * 0.03, 44), black, null, 'lid'); lid.scale.z = rz / rx; lid.position.y = hgt;
      const band = part(T, g, new T.CylinderGeometry(rx * 1.05, rx * 1.05, H * 0.2, 44, 1, true), new T.MeshStandardMaterial({ color: custom ? shade(T, col, 0.4) : new T.Color(0xd22a42), roughness: 0.5, side: T.DoubleSide }), null, 'band');
      band.scale.z = rz / rx; band.position.y = H * 0.14;
      g.rotation.z = -0.1;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'crown') {
      // A British-style royal crown: jewelled gold band, ermine trim, a velvet cap, four dipped arches
      // meeting under a monde and cross pattee. Sized off the skull so it never floats or cuts in.
      const yb = M.hatY(0.66), f = M.fit(yb, M.capY), rx = f.rx * 1.0, rz = f.rz * 1.0;
      const bandH = Math.min(Math.max((M.capY - yb) * 0.5, H * 0.1), H * 0.17);
      const velvet = mat(T, { color: 0x6b0f2a, roughness: 0.95, metalness: 0 });
      const erm = mat(T, { color: 0xf6f4ef, roughness: 1 });
      const gem1 = mat(T, { color: 0xd4143c, roughness: 0.06, metalness: 0.25, emissive: 0x4a0010, emissiveIntensity: 0.6 });
      const gem2 = mat(T, { color: 0x1f4fd8, roughness: 0.06, metalness: 0.25, emissive: 0x001a4a, emissiveIntensity: 0.6 });
      const pearl = mat(T, { color: 0xfdfcf8, roughness: 0.18, metalness: 0.1 });
      // velvet cap inside
      part(T, g, skullShell(T, M, yb + bandH * 0.1, H * 0.03, { domeH: 0.95, org: yb }), velvet, null, 'velvet');
      // ermine trim + gold band
      part(T, g, skullBand(T, M, yb - H * 0.02, yb + bandH * 0.3, H * 0.055, yb), erm, null, 'ermine');
      for (let i = 0; i < 10; i++) { const fl = part(T, g, new T.BoxGeometry(rx * 0.07, rx * 0.11, rx * 0.04), mat(T, { color: 0x14141a, roughness: 0.9 }), null, 'ermine'); const a = i / 10 * Math.PI * 2; fl.position.set(Math.sin(a) * rx * 1.05, bandH * 0.1, Math.cos(a) * rz * 1.05); fl.lookAt(0, bandH * 0.1, 0); }
      const bandM = new T.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.16, envMapIntensity: 2.0, side: T.DoubleSide });
      part(T, g, skullBand(T, M, yb + bandH * 0.3, yb + bandH * 1.05, H * 0.05, yb), bandM, null, 'band');
      // jewelled course on the band
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, R = Math.max(M.P.rad(yb + bandH * 0.68, a), rx * 0.6) + H * 0.055;
        const big = i % 3 === 0;
        const gm = part(T, g, big ? new T.OctahedronGeometry(rx * 0.085, 0) : new T.SphereGeometry(rx * 0.042, 12, 10), big ? (i % 2 ? gem1 : gem2) : pearl, null, 'gem');
        gm.position.set(Math.sin(a) * R * 1.02, bandH * 0.68, Math.cos(a) * R * 1.02);
        if (big) gm.scale.set(1, 1.25, 0.6);
      }
      // four cross-pattee / fleur uprights, then the arches
      const top = bandH * 1.05, archH = Math.max((M.capY - yb) * 0.7, H * 0.16) + H * 0.1;
      const goldM = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.16, envMapIntensity: 2.0 });
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, R = Math.max(M.P.rad(yb + bandH, a), rx * 0.6) + H * 0.05;
        const x = Math.sin(a) * R, z = Math.cos(a) * R;
        if (k % 2 === 0) {   // cross pattee
          const v = part(T, g, new T.BoxGeometry(rx * 0.055, rx * 0.2, rx * 0.045), goldM, null, 'cross'); v.position.set(x, top + rx * 0.1, z); v.lookAt(0, top + rx * 0.1, 0); v.rotateY(Math.PI);
          const h2 = part(T, g, new T.BoxGeometry(rx * 0.15, rx * 0.06, rx * 0.045), goldM, null, 'cross'); h2.position.set(x, top + rx * 0.11, z); h2.lookAt(0, top + rx * 0.11, 0); h2.rotateY(Math.PI);
        } else {             // fleur-de-lis, three petals
          for (const t2 of [-1, 0, 1]) {
            const p = part(T, g, new T.ConeGeometry(rx * 0.038, rx * 0.19, 6), goldM, null, 'fleur');
            p.position.set(x, top + rx * 0.1, z);
            p.lookAt(0, top, 0); p.rotateX(-Math.PI / 2); p.rotateZ(t2 * 0.7); p.translateY(rx * 0.045);
          }
        }
        if (k % 2 === 0) {   // an arch springs from every cross
          const p0 = new T.Vector3(x, top + rx * 0.3, z);
          const p1 = new T.Vector3(x * 0.86, top + archH * 0.72, z * 0.86);
          const p2 = new T.Vector3(x * 0.34, top + archH * 0.8, z * 0.34);
          const p3 = new T.Vector3(0, top + archH * 0.97, 0);
          const curve = new T.CatmullRomCurve3([p0, p1, p2, p3]);
          part(T, g, new T.TubeGeometry(curve, 18, rx * 0.038, 8, false), goldM, null, 'arch');
          for (let q = 1; q <= 4; q++) { const pr = part(T, g, new T.SphereGeometry(rx * 0.032, 10, 8), pearl, null, 'pearl'); pr.position.copy(curve.getPoint(q / 5)); }
        }
      }
      const monde = part(T, g, new T.SphereGeometry(rx * 0.15, 20, 14), goldM, null, 'monde'); monde.position.y = top + archH * 1.04;
      for (const rot of [0, Math.PI / 2]) { const bandR = part(T, g, new T.TorusGeometry(rx * 0.155, rx * 0.018, 8, 28), goldM, null, 'monde'); bandR.position.y = top + archH * 1.04; bandR.rotation.y = rot; }
      const cv = part(T, g, new T.BoxGeometry(rx * 0.045, rx * 0.2, rx * 0.045), goldM, null, 'cross'); cv.position.y = top + archH * 1.22;
      const ch2 = part(T, g, new T.BoxGeometry(rx * 0.15, rx * 0.05, rx * 0.045), goldM, null, 'cross'); ch2.position.y = top + archH * 1.22;
      const tip = part(T, g, new T.OctahedronGeometry(rx * 0.045, 0), gem1, null, 'gem'); tip.position.y = top + archH * 1.22;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'kabuto') {
      const yb = M.hatY(0.3), f = line(yb), rx = f.rx * 1.07, rz = f.rz * 1.07, col = main(0x232733);
      const iron = mat(T, { color: col, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.3 });
      part(T, g, skullShell(T, M, yb, H * 0.03, { domeH: 0.8 }), iron, null, 'crown');
      for (let i = 0; i < 7; i++) {
        const a = (i - 3) / 7 * Math.PI * 1.1;
        part(T, g, skullShell(T, M, yb, H * 0.042, { domeH: 0.8, arc: 0.08, arcStart: a, na: 3 }), gold, null, 'rib');
      }
      for (let k = 0; k < 4; k++) {
        const rr = 1 + k * 0.22, sh = part(T, g, new T.CylinderGeometry(rx * rr, rx * (rr + 0.26), H * 0.15, 34, 1, true, Math.PI * 0.32, Math.PI * 1.36), iron, null, 'shikoro');
        sh.material = new T.MeshStandardMaterial({ color: k % 2 ? shade(T, col, 1.2) : col, metalness: 0.8, roughness: 0.4, side: T.DoubleSide });
        sh.scale.z = rz / rx; sh.position.y = -H * 0.06 - k * H * 0.11;
      }
      const cres = part(T, g, new T.TorusGeometry(rx * 0.72, rx * 0.11, 10, 28, Math.PI), gold, null, 'maedate');
      cres.position.set(0, (M.capY - yb) * 0.5 + H * 0.1, rz * 0.86); cres.rotation.set(0.3, 0, 0);
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'ninja' || kind === 'band') {
      // a real kung-fu headband: around the FOREHEAD, above the brow and below the crown, knot and tails at the back
      // the forehead: above the brow, well below the crown. Never the chin -- y is anchored on the eye line.
      const y0 = M.hatY(kind === 'ninja' ? 0.26 : 0.24), y1 = M.hatY(kind === 'ninja' ? 0.62 : 0.54);
      const col = custom || new T.Color(kind === 'ninja' ? 0xf4f5f8 : 0xf2f3f7);
      const cloth = mat(T, { color: col, roughness: 0.88 });
      part(T, g, skullBand(T, M, y0, y1, H * 0.016), cloth, null, 'band');
      const ymid = (y0 + y1) / 2, rF = Math.max(M.P.rad(ymid, 0), M.hw * 0.5), rB = Math.max(M.P.rad(ymid, Math.PI), M.hw * 0.5), rx = M.fit(y0, y1).rx;
      // the fold lines that make cloth read as cloth
      part(T, g, skullBand(T, M, y0 + (y1 - y0) * 0.34, y0 + (y1 - y0) * 0.42, H * 0.022, y0), mat(T, { color: shade(T, col, 0.86), roughness: 0.9 }), null, 'fold');
      if (kind === 'ninja') {
        const plate = part(T, g, new T.CylinderGeometry(rx * 0.34, rx * 0.34, H * 0.022, 26), mat(T, { color: 0xb9c0cc, metalness: 0.95, roughness: 0.28, envMapIntensity: 1.6 }), null, 'plate');
        plate.rotation.x = Math.PI / 2; plate.scale.set(1, 1, 0.62); plate.position.set(0, ymid - y0, rF * 1.02);
        const mark = part(T, g, new T.TorusGeometry(rx * 0.17, rx * 0.032, 6, 22), mat(T, { color: 0xd22a42, roughness: 0.6 }), null, 'mark'); mark.position.set(0, ymid - y0, rF * 1.05);
      }
      // knot: two crossed lobes at the back, then the tails
      for (const s2 of [-1, 1]) {
        const lobe = part(T, g, new T.SphereGeometry(rx * 0.15, 12, 10), cloth, null, 'knot');
        lobe.position.set(s2 * rx * 0.1, ymid - y0 + rx * 0.05, -rB * 1.06); lobe.scale.set(1.1, 0.75, 0.8); lobe.rotation.z = s2 * 0.5;
      }
      const cinch = part(T, g, new T.CylinderGeometry(rx * 0.07, rx * 0.07, rx * 0.2, 10), mat(T, { color: shade(T, col, 0.88), roughness: 0.9 }), null, 'knot');
      cinch.rotation.z = Math.PI / 2; cinch.position.set(0, ymid - y0, -rB * 1.06);
      for (const s2 of [-1, 1]) {
        const L = H * (kind === 'ninja' ? 0.95 : 0.55);
        const tail = part(T, g, new T.BoxGeometry(rx * 0.17, L, rx * 0.025), cloth, null, 'tail');
        tail.position.set(s2 * rx * 0.16, ymid - y0 - L * 0.48, -rB * 1.16); tail.rotation.set(-0.2, 0, s2 * 0.22);
        const tip = part(T, g, new T.BoxGeometry(rx * 0.17, L * 0.2, rx * 0.025), mat(T, { color: shade(T, col, 0.8), roughness: 0.9 }), null, 'tail');
        tip.position.set(s2 * rx * 0.2, ymid - y0 - L * 0.98, -rB * 1.2); tip.rotation.set(-0.3, 0, s2 * 0.3);
      }
      mount(M, 'head', g, 0, y0, 0);
    } else if (kind === 'bandana') {
      const yb = M.hatY(0.3), col = main(0xd22a42), rx = M.fit(yb, M.capY).rx;
      const cloth = mat(T, { color: col, roughness: 0.92 });
      part(T, g, skullShell(T, M, yb, H * 0.02, { domeH: 0.55 }), cloth, null, 'crown');
      for (let i = 0; i < 6; i++) { const a = -Math.PI * 0.8 + i / 6 * Math.PI * 1.6; part(T, g, skullShell(T, M, yb, H * 0.028, { domeH: 0.55, arc: 0.08, arcStart: a, na: 3 }), mat(T, { color: shade(T, col, 0.8), roughness: 0.92 }), null, 'fold'); }
      part(T, g, skullBand(T, M, yb - H * 0.01, yb + H * 0.06, H * 0.03, yb), cloth, null, 'rim');
      const rB = Math.max(M.P.rad(yb + H * 0.04, Math.PI), rx * 0.6);
      const knot = part(T, g, new T.SphereGeometry(rx * 0.2, 12, 10), cloth, null, 'knot'); knot.position.set(-rx * 0.34, H * 0.03, -rB * 0.98); knot.scale.set(1, 0.85, 0.9);
      for (const k of [0, 1]) {
        const tail = part(T, g, new T.BoxGeometry(rx * 0.2, H * 0.5, rx * 0.035), cloth, null, 'tail');
        tail.position.set(-rx * (0.46 + k * 0.1), -H * 0.2, -rB * (1.0 + k * 0.08)); tail.rotation.set(-0.2, 0, 0.35 + k * 0.2);
      }
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'visor') {
      // A SUN VISOR: a band at the brow and a brim, no crown. Added 10/15 because the locker sells
      // `g_visor` and there was no mesh behind it -- the only `visor` in this file was the tech visor
      // in buildEyes, which is a different object worn in a different slot.
      const yb = M.hatY(0.26), col = main(0x1f9ad8), rx = M.fit(yb, M.capY).rx;
      const foam = mat(T, { color: col, roughness: 0.84 });
      part(T, g, skullBand(T, M, yb, yb + H * 0.17, H * 0.022, yb), foam, null, 'band');
      part(T, g, skullBand(T, M, yb + H * 0.14, yb + H * 0.19, H * 0.03, yb), mat(T, { color: shade(T, col, 0.62), roughness: 0.8 }), null, 'band');
      const br = part(T, g, arcPlate(T, rx * 0.76, rx * 1.14, Math.PI / 2 - Math.PI * 0.47, Math.PI / 2 + Math.PI * 0.47, H * 0.028), mat(T, { color: shade(T, col, 0.82), roughness: 0.66 }), null, 'brim');
      br.scale.z = 1.72; br.position.y = H * 0.04; br.rotation.x = 0.16;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'fedora') {
      const yb = M.hatY(0.3), col = main(0x6b4526), f = M.fit(yb, M.capY), rx = f.rx, rz = f.rz;
      const felt = mat(T, { color: col, roughness: 0.94 });
      part(T, g, skullShell(T, M, yb, H * 0.02, { domeH: 0.48 }), felt, null, 'crown');
      // the two side dents are what separates a fedora from a bowler, and they are the only part of
      // the shape that is not just a shorter top hat
      for (const s of [-1, 1]) {
        const dent = part(T, g, new T.SphereGeometry(1, 16, 12), mat(T, { color: shade(T, col, 0.7), roughness: 0.95 }), null, 'fold');
        dent.scale.set(rx * 0.26, H * 0.11, rz * 0.6);
        dent.position.set(s * rx * 0.58, (M.capY - yb) + rx * 0.26, 0);
      }
      part(T, g, skullBand(T, M, yb + H * 0.02, yb + H * 0.12, H * 0.03, yb), mat(T, { color: 0x14161c, roughness: 0.72 }), null, 'band');
      const brimM = new T.MeshStandardMaterial({ color: col, roughness: 0.94, side: T.DoubleSide });
      const br = part(T, g, arcPlate(T, rx * 1.0, rx * 1.62, 0, Math.PI * 2, H * 0.026), brimM, null, 'brim');
      br.position.y = H * 0.014; br.scale.z = rz / rx;
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'cans') {
      // HEADPHONES. The band is an arc over the crown and the cups sit at the sides, so both are
      // sized from the skull at the height they actually touch rather than from one radius.
      const y = M.hatY(0.3), f = M.fit(y - H * 0.14, y + H * 0.14), rx = f.rx, rz = f.rz;
      const col = main(0x1b1d26);
      const shell = mat(T, { color: col, roughness: 0.44, metalness: 0.2 });
      const pad = mat(T, { color: 0x0b0d12, roughness: 0.95 });
      const accent = mat(T, { color: 0xff6a2a, roughness: 0.5 });
      const rise = Math.max(M.capY - y, H * 0.12) + H * 0.1;
      const band = part(T, g, new T.TorusGeometry(1, 0.038, 9, 30, Math.PI), shell, null, 'band');
      band.scale.set(rx * 1.04, rise, rx * 0.14);
      const pads = part(T, g, new T.TorusGeometry(1, 0.05, 9, 26, Math.PI * 0.5), pad, null, 'band');
      pads.scale.set(rx * 0.99, rise * 0.97, rx * 0.11); pads.rotation.z = Math.PI * 0.25;
      for (const s of [-1, 1]) {
        const cup = part(T, g, new T.CylinderGeometry(rz * 0.52, rz * 0.56, rx * 0.26, 24), shell, null, 'crown');
        cup.rotation.z = Math.PI / 2; cup.position.set(s * rx * 1.02, 0, 0);
        const ring = part(T, g, new T.TorusGeometry(rz * 0.5, rz * 0.12, 9, 24), pad, null, 'cuff');
        ring.rotation.y = Math.PI / 2; ring.position.set(s * rx * 0.92, 0, 0);
        const gl = part(T, g, new T.TorusGeometry(rz * 0.34, rz * 0.04, 6, 24), accent, null, 'stud');
        gl.rotation.y = Math.PI / 2; gl.position.set(s * rx * 1.16, 0, 0);
      }
      mount(M, 'head', g, 0, y, 0);
    } else if (kind === 'pilot') {
      const yb = M.hatY(0.08), col = main(0x5a3a22), f = M.fit(yb, M.capY), rx = f.rx, rz = f.rz;
      const leather = mat(T, { color: col, roughness: 0.8 });
      part(T, g, skullShell(T, M, yb, H * 0.022, { domeH: 0.82 }), leather, null, 'crown');
      for (const s of [-1, 1]) {
        const fl = part(T, g, new T.SphereGeometry(1, 14, 10), mat(T, { color: shade(T, col, 0.82), roughness: 0.82 }), null, 'fold');
        fl.scale.set(rx * 0.26, H * 0.2, rz * 0.4);
        fl.position.set(s * rx * 0.9, -H * 0.08, 0);
      }
      // the goggles are PUSHED UP on the brow, which is how a pilot cap is worn and also keeps them
      // off the eye line, where the eyes slot has its own piece
      part(T, g, skullBand(T, M, yb + H * 0.02, yb + H * 0.17, H * 0.048, yb), mat(T, { color: 0x14161c, roughness: 0.62 }), null, 'band');
      const fz = Math.max(M.P.f(yb + H * 0.09), rz) * 0.96;
      for (const s of [-1, 1]) {
        const lens = part(T, g, new T.CylinderGeometry(rx * 0.3, rx * 0.3, H * 0.045, 22), mat(T, { color: 0xb08a3a, metalness: 1, roughness: 0.26, envMapIntensity: 1.7 }), null, 'stud');
        lens.rotation.x = Math.PI / 2; lens.position.set(s * rx * 0.44, H * 0.09, fz);
        const gl = part(T, g, new T.CylinderGeometry(rx * 0.22, rx * 0.22, H * 0.05, 22), mat(T, { color: 0x2a3340, roughness: 0.12, metalness: 0.4 }), null, 'stud');
        gl.rotation.x = Math.PI / 2; gl.position.set(s * rx * 0.44, H * 0.09, fz + H * 0.006);
      }
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'wreath') {
      // a laurel ring that follows the skull's own per-azimuth radius, so it is a ring round THIS
      // head rather than a circle that happens to be near it
      const yb = M.hatY(0.62), f = M.fit(yb, M.capY), rx = f.rx, rz = f.rz;
      const leafM = mat(T, { color: 0xd9b43a, metalness: 1, roughness: 0.3, envMapIntensity: 1.9 });
      const leafD = mat(T, { color: 0x9a7a1c, metalness: 1, roughness: 0.42, envMapIntensity: 1.5 });
      const ring = ellipseRing(T, g, leafD, rx * 1.01, rz * 1.01, rx * 0.032, 'band');
      const N = 24;
      for (let i = 0; i < N; i++) {
        const a = -Math.PI + (i + 0.5) / N * Math.PI * 2;
        const r = Math.min(Math.max(M.P.rad(yb, a), rx * 0.6), rx * 1.35) * 1.02;
        const leaf = part(T, g, slab(T, rx * 0.17, rx * 0.4, rx * 0.085, rx * 0.035), i % 2 ? leafM : leafD, null, 'rib');
        leaf.position.set(Math.sin(a) * r, H * 0.035 + (i % 2) * H * 0.018, Math.cos(a) * r);
        leaf.rotation.y = a;
        leaf.rotation.x = -0.5 - (i % 2) * 0.22;
        leaf.rotation.z = (i % 2 ? 1 : -1) * 0.3;
      }
      mount(M, 'head', g, 0, yb, 0);
    } else if (kind === 'halo') {
      const r = M.hw * 0.9;
      const gm = glowMat(T, custom ? '#' + custom.getHexString() : 0xffd36a, 3.2, { metalness: 0.4 });
      const ring = part(T, g, new T.TorusGeometry(r, r * 0.085, 12, 48), gm.m, gm.want, 'ring'); ring.rotation.x = Math.PI / 2;
      mount(M, 'head', g, 0, M.capY + H * 0.3, 0);
    } else if (kind === 'horns') {
      // Devil horns: rooted INTO the skull (the base sits 12% inside the surface), thick at the base,
      // curving up and back, ridged, dark red-black through to a glossy tip.
      const base = custom || new T.Color(0x1a0409);
      const yRoot = M.hatY(0.66);
      for (const sx of [-1, 1]) {
        const a = sx * 0.95;                                    // ~55 degrees off the front, over the temples
        const rr = Math.max(M.P.rad(yRoot, a), M.hw * 0.5);
        const ox = Math.sin(a) * rr * 0.88, oz = Math.cos(a) * rr * 0.88;
        const L = M.H * 0.92, segs = 9;
        const outDir = new T.Vector3(Math.sin(a), 0, Math.cos(a)).normalize();
        const pts = [];
        for (let k = 0; k <= segs; k++) {
          const t = k / segs;
          const up = L * (0.18 + t * 0.95);
          const out = L * (0.24 * Math.sin(t * 1.5)) - L * 0.05 * t;
          const backAmt = -L * 0.42 * t * t;
          pts.push(new T.Vector3(ox + outDir.x * out + 0, yRoot - M.hatY(0.66) + up * 0.0 + up, oz + outDir.z * out + backAmt));
        }
        const curve = new T.CatmullRomCurve3(pts);
        for (let k = 0; k < segs; k++) {
          const t = k / segs, t2 = (k + 1) / segs;
          const p = curve.getPoint(t), q = curve.getPoint(t2);
          const r0 = L * 0.26 * Math.pow(1 - t, 0.85) + L * 0.012, r1 = L * 0.26 * Math.pow(1 - t2, 0.85) + L * 0.012;
          const col = new T.Color(base).lerp(new T.Color(0x6e0d1c), t * 0.8);
          const m = mat(T, { color: col, roughness: 0.62 - t * 0.5, metalness: 0.12 + t * 0.2, envMapIntensity: 1.2 });
          const d = new T.Vector3().subVectors(q, p);
          const seg = part(T, g, new T.CylinderGeometry(Math.max(r1, 1e-4), Math.max(r0, 1e-4), d.length() * 1.04, 14), m, null, 'horn');
          seg.position.copy(p).addScaledVector(d, 0.5);
          seg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
          if (k < segs - 2) {   // ridge ring
            const ring = part(T, g, new T.TorusGeometry(r0 * 1.06, r0 * 0.16, 6, 16), mat(T, { color: shade(T, col, 0.6), roughness: 0.5 }), null, 'ridge');
            ring.position.copy(p); ring.quaternion.copy(seg.quaternion); ring.rotateX(Math.PI / 2);
          }
        }
        const tipP = curve.getPoint(1), tipD = new T.Vector3().subVectors(curve.getPoint(1), curve.getPoint(0.93)).normalize();
        const tip = part(T, g, new T.ConeGeometry(L * 0.032, L * 0.18, 12), mat(T, { color: 0x2b0409, roughness: 0.06, metalness: 0.45, envMapIntensity: 1.9 }), null, 'horn');
        tip.position.copy(tipP).addScaledVector(tipD, L * 0.07);
        tip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), tipD);
      }
      mount(M, 'head', g, 0, yRoot, 0);
    }
  }

  // ---------------------------------------------------------------- glasses
  // The temple arms. They used to run out to `M.sideW` -- the head's WIDEST half-width, measured over
  // the whole skull -- and then back past `-M.sideD`. On any head that is narrower at the eye line
  // than at its widest point (a snout, a muzzle, a tapered jaw) that put the arm outside the
  // silhouette, so instead of disappearing behind the head it hung in the air as a thin bright line
  // with a visible end. That is what reads as "glitchy, the graphic is half missing".
  //
  // Now they stay on the lens line (x0, which is derived from the eye width) and run BACK, which is
  // where a real temple arm goes -- so the head itself occludes almost all of it. Slightly thicker
  // too: at the old radius they rendered as a wire rather than a part of the glasses.
  function eyeArms(T, M, g, x0, z0, m, r, tag) {
    const V3v = (a, b, c) => new T.Vector3(a, b, c);
    const xw = Math.min(x0, M.sideW * 0.98);          // never outside the head at this height
    // WHERE A TEMPLE ARM ENDS IS A PLACE, NOT A DISTANCE, 10/15. This used to travel a fixed
    // `max(sideD * 0.85, H * 0.18)` BACK FROM THE FACE, so on any head whose face stands well
    // forward -- a muzzle, a beak, a snout -- the arm started further forward and therefore ended
    // further forward, and never got behind the ear. It is the single biggest fault in this slot:
    // "arms do not reach back over the ears" was 16 to 26 failures on every one of the five shipped
    // styles, across a roster where each of them is supposed to be clean.
    // A real temple arm ends BEHIND the ear, which is behind the middle of the skull, so the end is
    // an absolute depth in head space and the arm is however long it needs to be to reach it.
    const endZ = -Math.max(M.sideD, M.hd * 0.8) * 0.62;
    const rr = r * 1.45;
    for (const sx of [-1, 1]) {
      const a = V3v(sx * x0, 0, z0);
      const b = V3v(sx * xw, M.H * 0.01, z0 + (endZ - z0) * 0.45);
      const c = V3v(sx * xw * 0.94, -M.H * 0.035, endZ);
      strut(T, g, a, b, rr, m, tag || 'arm', 6);
      strut(T, g, b, c, rr, m, tag || 'arm', 6);
    }
  }
  function buildEyes(T, M, kind) {
    const g = gearGroup(T, 'eyes'), H = M.H, w = M.ew;
    const cl = H * 0.014 + (M.hairOn ? H * 0.02 : 0);          // hair worn: stand the glasses off it, never inside it
    const ex = w * 0.46, lw = w * 0.36, lh = w * 0.25;
    const zAt = x => Math.max(M.faceZAt(x, M.eyeY), M.fz * 0.72) + cl;
    const zAvg = () => (zAt(ex) + zAt(-ex) + zAt(0)) / 3;
    const darkGlass = m => Object.assign({ roughness: 0.06, metalness: 0.35, envMapIntensity: 1.6 }, m || {});

    if (kind === 'rayban') {
      const frame = mat(T, { color: 0x14141a, roughness: 0.3, metalness: 0.12, envMapIntensity: 1.1 });
      const glass = mat(T, darkGlass({ color: 0x0a1018, transparent: true, opacity: 0.86 }));
      const t = lw * 0.26, th = w * 0.09;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const rim = part(T, g, ringPlate(T, lw * 2, lh * 2, lh * 0.55, t, th), frame, null, 'rim');
        rim.position.set(sx * ex, 0, z); rim.rotation.y = -sx * 0.16;
        const lens = part(T, g, slab(T, lw * 2 - t * 1.6, lh * 2 - t * 1.6, lh * 0.4, th * 0.4), glass, { opacity: 0.86 }, 'lens');
        lens.position.set(sx * ex, 0, z - th * 0.1); lens.rotation.y = -sx * 0.16; lens.castShadow = false;
      }
      const bz = zAt(0);
      const br = part(T, g, new T.BoxGeometry(Math.max(ex * 2 - lw * 1.7, w * 0.08), lh * 0.5, th * 0.8), frame, null, 'bridge'); br.position.set(0, lh * 0.5, bz);
      const bar = part(T, g, new T.BoxGeometry(ex * 2 + lw * 1.6, th * 0.9, th * 0.7), frame, null, 'browbar'); bar.position.set(0, lh * 0.94, bz - th * 0.1);
      eyeArms(T, M, g, ex + lw * 0.92, zAt(ex + lw * 0.8), frame, th * 0.28);
    } else if (kind === 'aviator') {
      const gold = mat(T, { color: 0xe8c463, metalness: 1, roughness: 0.2, envMapIntensity: 1.8 });
      const glass = mat(T, darkGlass({ color: 0x2a1c10, transparent: true, opacity: 0.68 }));
      const alw = w * 0.38, alh = w * 0.3;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const rim = part(T, g, new T.TorusGeometry(1, w * 0.028, 10, 40), gold, null, 'rim');
        rim.scale.set(alw, alh, 1); rim.position.set(sx * ex, -alh * 0.12, z); rim.rotation.set(0, -sx * 0.18, sx * 0.1);
        const lens = part(T, g, new T.CircleGeometry(1, 34), glass, { opacity: 0.68 }, 'lens');
        lens.scale.set(alw * 0.99, alh * 0.99, 1); lens.position.set(sx * ex, -alh * 0.12, z - w * 0.006); lens.rotation.set(0, -sx * 0.18, sx * 0.1); lens.castShadow = false;
      }
      const bz = zAt(0);
      for (const dy of [0.18, 0.4]) { const b = part(T, g, new T.CylinderGeometry(w * 0.02, w * 0.02, Math.max(ex * 2 - alw * 1.8, w * 0.06), 8), gold, null, 'bridge'); b.rotation.z = Math.PI / 2; b.position.set(0, alh * dy, bz); }
      const bar = part(T, g, new T.CylinderGeometry(w * 0.022, w * 0.022, ex * 2 + alw * 1.5, 8), gold, null, 'browbar'); bar.rotation.z = Math.PI / 2; bar.position.set(0, alh * 0.66, bz - w * 0.01);
      eyeArms(T, M, g, ex + alw * 0.9, zAt(ex + alw * 0.8), gold, w * 0.022);
    } else if (kind === 'mafia') {
      const frame = mat(T, { color: 0x101014, roughness: 0.25, metalness: 0.5, envMapIntensity: 1.4 });
      const glass = mat(T, darkGlass({ color: 0x05070a, transparent: true, opacity: 0.94 }));
      const mlw = w * 0.42, mlh = w * 0.13, th = w * 0.045;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const rim = part(T, g, ringPlate(T, mlw * 2, mlh * 2, mlh * 0.7, th * 1.1, th * 0.9), frame, null, 'rim');
        rim.position.set(sx * ex * 0.98, mlh * 0.1, z); rim.rotation.set(0.05, -sx * 0.3, sx * 0.06);
        const lens = part(T, g, slab(T, mlw * 2 - th, mlh * 2 - th, mlh * 0.6, th * 0.4), glass, { opacity: 0.94 }, 'lens');
        lens.position.set(sx * ex * 0.98, mlh * 0.1, z - th * 0.2); lens.rotation.set(0.05, -sx * 0.3, sx * 0.06); lens.castShadow = false;
      }
      const br = part(T, g, new T.BoxGeometry(Math.max(ex * 2 - mlw * 1.85, w * 0.05), th * 1.1, th * 0.9), frame, null, 'bridge'); br.position.set(0, mlh * 0.35, zAt(0));
      eyeArms(T, M, g, ex * 0.98 + mlw * 0.95, zAt(ex + mlw * 0.8), frame, th * 0.3);
    } else if (kind === 'shutter') {
      const frame = mat(T, { color: 0xe8203c, roughness: 0.35, metalness: 0.2 });
      const plw = w * 0.88, plh = w * 0.27, th = w * 0.06, z = zAvg() + w * 0.012;
      const rim = part(T, g, ringPlate(T, plw * 2, plh * 2, plh * 0.32, w * 0.09, th), frame, null, 'rim'); rim.position.set(0, 0, z);
      for (let i = 0; i < 6; i++) {
        const sl = part(T, g, new T.BoxGeometry(plw * 1.86, plh * 0.14, th * 0.85), frame, null, 'slat');
        sl.position.set(0, plh * (0.72 - i * 0.29), z); sl.rotation.x = -0.22;
      }
      const back = part(T, g, slab(T, plw * 1.9, plh * 1.9, plh * 0.3, th * 0.3), mat(T, { color: 0x08080c, roughness: 0.5 }), null, 'backing'); back.position.set(0, 0, z - th * 0.55); back.castShadow = false;
      // z0 is where the temple arm LEAVES THE FACE, so it has to be the face depth out at the arm's
      // own x, not the average across the lenses. With zAvg() the arms started at the most protruding
      // part of the face and ran back from there, so on 25 of 48 bodies they never reached behind the
      // ears -- which is exactly the failure that got this piece cut on 9/21.
      eyeArms(T, M, g, plw * 0.96, zAt(plw * 0.96), frame, w * 0.026);
    } else if (kind === 'goggles') {
      const rubber = mat(T, { color: 0x14161d, roughness: 0.9 });
      const strapM = mat(T, { color: 0xe8203c, roughness: 0.8 });
      // was w*0.92 x w*0.34 with the strap standing off the head at sideW*1.03: on the preview that
      // covered most of the face and the strap's two ends hung outside the silhouette as red stubs.
      // Sized to the eye band like every other pair here, and the strap hugs the skull so the head
      // occludes all of it but the sides, which is where a strap is actually visible.
      const glw = w * 0.66, glh = w * 0.25, th = w * 0.09, z = zAvg();
      const foam = part(T, g, ringPlate(T, glw * 2, glh * 2, glh * 0.72, w * 0.13, th), rubber, null, 'frame'); foam.position.set(0, 0, z + th * 0.3);
      const lm = glowMat(T, 0x27e1ff, 0.35, { color: 0x101820, metalness: 0.95, roughness: 0.06, envMapIntensity: 2.0, transparent: true, opacity: 0.9, side: T.DoubleSide });
      const R = glw * 1.25;
      const lens = part(T, g, new T.CylinderGeometry(R, R, glh * 1.75, 44, 1, true, -Math.PI * 0.3, Math.PI * 0.6), lm.m, lm.want, 'lens');
      lens.position.set(0, 0, z + th * 0.25 - R); lens.castShadow = false;
      const band = ellipseRing(T, g, strapM, M.sideW * 0.99, M.sideD * 0.99, w * 0.07, 'strap');
      const buck = part(T, g, new T.BoxGeometry(w * 0.13, w * 0.10, w * 0.05), rubber, null, 'buckle'); buck.position.set(M.sideW * 0.93, 0, -M.sideD * 0.25);
      mount(M, 'head', g, 0, M.eyeY, 0); return;
    } else if (kind === 'round' || kind === 'monocle') {
      const gold = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.22, envMapIntensity: 1.8 });
      const glass = mat(T, { color: 0xbfe8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25 });
      const rr = w * 0.26, sides = kind === 'monocle' ? [1] : [-1, 1];
      for (const sx of sides) {
        const z = zAt(sx * ex);
        const ring = part(T, g, new T.TorusGeometry(rr, w * 0.035, 10, 34), gold, null, 'rim'); ring.position.set(sx * ex, 0, z); ring.rotation.y = -sx * 0.14;
        const lens = part(T, g, new T.CircleGeometry(rr * 0.98, 30), glass, { opacity: 0.25 }, 'lens'); lens.position.set(sx * ex, 0, z - w * 0.008); lens.rotation.y = -sx * 0.14; lens.castShadow = false;
      }
      if (kind === 'round') {
        const br = part(T, g, new T.CylinderGeometry(w * 0.022, w * 0.022, Math.max(ex * 2 - rr * 2, w * 0.05), 8), gold, null, 'bridge'); br.rotation.z = Math.PI / 2; br.position.set(0, 0, zAt(0));
        eyeArms(T, M, g, ex + rr, zAt(ex + rr * 0.8), gold, w * 0.02);
      } else {
        const ch = part(T, g, new T.CylinderGeometry(w * 0.013, w * 0.013, H * 0.75, 6), gold, null, 'chain'); ch.position.set(ex + rr * 0.6, -H * 0.4, zAt(ex) - w * 0.05); ch.rotation.z = 0.22;
      }
    } else if (kind === 'shades') {
      const black = mat(T, { color: 0x050507, roughness: 0.3, metalness: 0.3 }), white = mat(T, { color: 0xffffff, roughness: 0.4 });
      const px = w * 0.1, t = px * 0.95, z = zAvg();
      const bar = part(T, g, new T.BoxGeometry(w * 1.9, px, t), black, null, 'browbar'); bar.position.set(0, px, z);
      for (const sx of [-1, 1]) {
        const a = part(T, g, new T.BoxGeometry(px * 5, px, t), black, null, 'lens'); a.position.set(sx * ex * 1.1, 0, z);
        const b = part(T, g, new T.BoxGeometry(px * 3, px, t), black, null, 'lens'); b.position.set(sx * ex * 1.1, -px, z);
        const hi = part(T, g, new T.BoxGeometry(px * 0.9, px * 0.9, t * 0.35), white, null, 'glint'); hi.position.set(sx * ex * 1.1 - px * 1.4, px * 0.05, z + t * 0.6);
      }
      eyeArms(T, M, g, w * 0.95, z, black, px * 0.3);
    } else if (kind === 'visor') {
      const R = M.sideW * 1.1;
      const vm = glowMat(T, 0x27e1ff, 1.2, { opacity: 0.6, transparent: true, metalness: 0.6, roughness: 0.1, side: T.DoubleSide });
      const z = zAvg() + w * 0.02;
      const v = part(T, g, new T.CylinderGeometry(R, R, w * 0.42, 40, 1, true, -Math.PI * 0.42, Math.PI * 0.84), vm.m, vm.want, 'lens');
      v.position.z = z - R; v.castShadow = false;
      const rim = part(T, g, new T.TorusGeometry(R, w * 0.03, 8, 44, Math.PI * 0.84), mat(T, { color: 0xdfe3ec, metalness: 1, roughness: 0.25 }), null, 'rim');
      rim.rotation.set(Math.PI / 2, 0, Math.PI * 0.08); rim.position.set(0, w * 0.2, z - R);
    } else if (kind === 'patch') {
      // An eyepatch covers ONE eye, so it is the one piece in this slot that is meant to be
      // asymmetric. The strap runs round the head at the eye line using the same arm geometry the
      // glasses use, so it reaches back over the ears instead of floating beside the face.
      const leather = mat(T, { color: 0x12131a, roughness: 0.74 });
      const strapM = mat(T, { color: 0x0c0d12, roughness: 0.8 });
      const sx = -1;                                   // left eye as the model faces you
      const z = zAt(sx * ex);
      const cup = part(T, g, new T.SphereGeometry(1, 20, 14), leather, null, 'lens');
      cup.scale.set(lw * 1.15, lh * 1.5, lw * 0.5);
      cup.position.set(sx * ex, 0, z - lw * 0.1);
      const rim = part(T, g, new T.TorusGeometry(1, lw * 0.07, 8, 26), mat(T, { color: 0x3a3f4a, roughness: 0.42, metalness: 0.6 }), null, 'rim');
      rim.scale.set(lw * 1.12, lh * 1.46, 1);
      rim.position.set(sx * ex, 0, z);
      // the strap: one run forward-to-back on each side of the head, meeting at the patch
      const V3v = (a, b, c) => new T.Vector3(a, b, c);
      const back = Math.max(M.sideD * 0.85, H * 0.18);
      const xw = Math.min(ex + lw, M.sideW * 0.98);
      // the strap leaves the face AT THE SIDE, so its base depth is the face depth out there -- the
      // same correction the shutter arms needed, for the same reason
      const zs = zAt(xw);
      strut(T, g, V3v(sx * ex, lh * 1.1, z), V3v(sx * xw, lh * 1.25, zs - back * 0.5), lw * 0.07, strapM, 'strap', 6);
      strut(T, g, V3v(sx * xw, lh * 1.25, zs - back * 0.5), V3v(-sx * xw * 0.9, lh * 0.55, zs - back), lw * 0.07, strapM, 'strap', 6);
      strut(T, g, V3v(sx * ex, -lh * 1.1, z), V3v(sx * xw, -lh * 0.9, zs - back * 0.5), lw * 0.07, strapM, 'strap', 6);
      strut(T, g, V3v(sx * xw, -lh * 0.9, zs - back * 0.5), V3v(-sx * xw * 0.9, -lh * 0.2, zs - back), lw * 0.07, strapM, 'strap', 6);
    } else if (kind === 'laser') {
      const L = M.S * 0.9;
      for (const sx of [-1, 1]) {
        const z = zAt(sx * ex);
        const core = glowMat(T, 0xff1020, 3);
        const eye = part(T, g, new T.SphereGeometry(w * 0.11, 14, 10), core.m, core.want, 'eye'); eye.position.set(sx * ex, 0, z);
        const bm = glowMat(T, 0xff0818, 2.2, { opacity: 0.85, transparent: true, depthWrite: false });
        const beam = part(T, g, new T.CylinderGeometry(w * 0.025, w * 0.075, L, 10, 1, true), bm.m, bm.want, 'beam');
        beam.rotation.x = Math.PI / 2; beam.position.set(sx * ex, 0, z + L / 2); beam.castShadow = false;
      }
    } else return;
    mount(M, 'head', g, 0, M.eyeY, 0);
  }

  // ---------------------------------------------------------------- hair
  function buildHair(T, M, kind, colKey) {
    const g = gearGroup(T, 'hair'), H = M.H;
    const col = hexCol(T, HAIRCOL, colKey, '#191320');
    const hairM = mat(T, { color: col, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.8 });
    const darkM = mat(T, { color: shade(T, col, 0.66), roughness: 0.7 });
    const yb = M.hatY(0.46);                                  // above the ears and clear of the eye line
    const hf = M.fit(yb, M.capY), rx = hf.rx, rz = hf.rz;
    const h = Math.max(M.capY - yb, H * 0.12);
    const cap = (pad, domeH, m) => part(T, g, skullShell(T, M, yb, pad, { domeH: domeH == null ? 0.66 : domeH }), m || hairM, null, 'cap');

    if (kind === 'buzz') {
      cap(H * 0.012, 0.62);
      for (let i = 0; i < 14; i++) { const n = part(T, g, new T.SphereGeometry(rx * 0.1, 8, 6), darkM, null, 'tuft'); const a = i / 14 * Math.PI * 2, t = 0.35 + (i % 3) * 0.16; n.position.set(Math.sin(a) * rx * Math.sin(t) * 1.0, Math.cos(t) * h * 1.02 + h * 0.1, Math.cos(a) * rz * Math.sin(t) * 1.0); n.scale.set(1, 0.5, 1); }
    } else if (kind === 'afro') {
      cap(H * 0.012, 0.62);
      const R = Math.max(rx, rz) * 1.42, n = 30;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, ang = i * 2.399963;
        const y = 1 - t * 1.55, rr = Math.sqrt(Math.max(0, 1 - y * y));
        if (y < -0.42) continue;
        if (Math.sin(ang) * rr > 0.15 && y < 0.14) continue;   // never hang a puff in front of the eyes
        const b = part(T, g, new T.IcosahedronGeometry(R * (0.3 + (i % 3) * 0.045), 1), i % 4 ? hairM : darkM, null, 'puff');
        b.position.set(Math.cos(ang) * rr * R * 1.02, y * R * 0.96 + h * 0.4, Math.sin(ang) * rr * R * (rz / rx) * 1.02);
        b.scale.setScalar(1 + ((i * 7) % 5) * 0.045);
      }
    } else if (kind === 'dreads') {
      cap(H * 0.012, 0.62);
      const N = 16, len = H * 1.35;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + 0.2, tilt = 0.62 + ((i * 5) % 3) * 0.12;
        if (Math.cos(a) > 0.42) continue;                      // locs fall at the sides and back, never over the face
        const sx = Math.sin(a) * Math.sin(tilt), sz = Math.cos(a) * Math.sin(tilt), sy = Math.cos(tilt);
        const p0 = new T.Vector3(sx * rx * 1.02, h * sy * 1.02 + h * 0.2, sz * rz * 1.02);
        const out = new T.Vector3(sx, 0, sz).normalize().multiplyScalar(rx * 0.3);
        const drop = len * (0.78 + ((i * 3) % 4) * 0.13);
        const pts = [p0,
          p0.clone().add(out.clone().multiplyScalar(0.7)).add(new T.Vector3(0, -drop * 0.22, 0)),
          p0.clone().add(out.clone().multiplyScalar(1.05)).add(new T.Vector3(0, -drop * 0.58, 0)),
          p0.clone().add(out.clone().multiplyScalar(0.92)).add(new T.Vector3(0, -drop, 0))];
        const curve = new T.CatmullRomCurve3(pts);
        part(T, g, new T.TubeGeometry(curve, 12, rx * 0.085, 7, false), i % 3 ? hairM : darkM, null, 'loc');
        const tip = part(T, g, new T.SphereGeometry(rx * 0.085, 8, 6), hairM, null, 'loc'); tip.position.copy(pts[3]);
        if (i % 4 === 0) { const bead = part(T, g, new T.TorusGeometry(rx * 0.1, rx * 0.028, 6, 14), mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.28 }), null, 'bead'); bead.position.copy(curve.getPoint(0.72)); bead.rotation.x = Math.PI / 2; }
      }
    } else if (kind === 'long') {
      cap(H * 0.014, 0.66);
      const len = H * 1.7, R = Math.max(rx, rz) * 1.06;
      const curtainM = new T.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.05, side: T.DoubleSide });
      const cur = part(T, g, new T.CylinderGeometry(R * 1.0, R * 1.16, len, 40, 1, true, Math.PI * 0.26, Math.PI * 1.48), curtainM, null, 'curtain');
      cur.scale.z = rz / rx; cur.position.set(0, -len / 2 + h * 0.5, 0);
      for (let i = 0; i < 10; i++) { const st = part(T, g, new T.BoxGeometry(rx * 0.1, len * 0.96, rx * 0.05), darkM, null, 'strand'); const a = Math.PI * 0.3 + (i / 9) * Math.PI * 1.4; st.position.set(Math.sin(a) * R * 1.05, -len * 0.48 + h * 0.5, Math.cos(a) * R * 1.05 * (rz / rx)); st.rotation.y = a; }
      for (const sx of [-1, 1]) { const fr = part(T, g, new T.BoxGeometry(rx * 0.2, H * 0.95, rz * 0.34), hairM, null, 'front'); fr.position.set(sx * rx * 1.0, -H * 0.3, rz * 0.3); fr.rotation.set(0, -sx * 0.4, sx * 0.05); }
    } else if (kind === 'pony') {
      cap(H * 0.014, 0.66);
      const rB = Math.max(M.P.rad(M.capY - h * 0.3, Math.PI), rz * 0.7);
      const tie = part(T, g, new T.TorusGeometry(rx * 0.26, rx * 0.07, 8, 20), mat(T, { color: 0x1a1a22, roughness: 0.8 }), null, 'tie'); tie.position.set(0, h * 0.62, -rB * 0.94); tie.rotation.set(0.5, 0, 0);
      let p = new T.Vector3(0, h * 0.62, -rB * 0.98);
      const segs = 7, len = H * 1.5;
      for (let i = 0; i < segs; i++) {
        const t = i / segs, r0 = rx * 0.3 * (1 - t * 0.72), r1 = rx * 0.3 * (1 - (t + 1 / segs) * 0.72);
        const dir = new T.Vector3(0, -0.45 - t * 0.55, -0.9 + t * 0.55).normalize().multiplyScalar(len / segs);
        const seg = part(T, g, new T.CylinderGeometry(Math.max(r1, 1e-4), Math.max(r0, 1e-4), dir.length() * 1.06, 10), i % 2 ? hairM : darkM, null, 'tail');
        seg.position.copy(p).addScaledVector(dir, 0.5);
        seg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
        p = p.clone().add(dir);
      }
    } else if (kind === 'mohawk') {
      cap(H * 0.01, 0.6, darkM);
      const N = 11;
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N, ang = (t - 0.5) * Math.PI * 1.15;
        const z = Math.sin(ang) * rz * 1.0, y = Math.cos(ang) * h * 1.0 + h * 0.3;
        const hgt = H * (0.36 + 0.34 * Math.sin(t * Math.PI));
        const fin = part(T, g, new T.ConeGeometry(rx * 0.13, hgt, 8), hairM, null, 'spike');
        fin.position.set(0, y + hgt * 0.4, z); fin.rotation.x = -ang * 0.45;
        fin.scale.z = 1.9;
      }
    } else return;
    mount(M, 'head', g, 0, yb, 0);
  }

  // ---------------------------------------------------------------- neck
  // NOTE: everything here is in NECK-bone units. M.H is head-bone units and must not appear -- every bone on
  // this rig carries its own scale, and mixing the two is what dropped the bow tie onto the chest.
  function buildNeck(T, M, kind) {
    const g = gearGroup(T, 'neck'), H = M.nH;
    const ringY = M.nl * 0.24, tieY = M.nl * 0.55;
    // SIZE THE COLLAR WHERE IT ACTUALLY SITS. `M.nw`/`M.nd` are measured at MID neck (see the
    // measure block: `Math.abs(p.y - nl * 0.5) > nl * 0.32` skips everything else), but the ring
    // hangs at nl * 0.24 -- down at the base, where the neck is already flaring into the shoulders.
    // A ring sized for the narrow part and hung on the wide part ends up INSIDE the body, which is
    // what dev/gearcheck reported on 85 of 184 neck checks: "collar inside the neck", "clipping into
    // the body". Ask the neck profile how wide the body is at the ring's own height instead.
    const pw = (M.NP && M.NP.w(ringY)) || 0, pd = (M.NP && M.NP.d(ringY)) || 0;
    const rx = Math.max(M.nw, pw * 0.5) * 1.10, rz = Math.max(M.nd, pd * 0.5) * 1.10;
    const sag = Math.min(M.nl * 0.5, H * 0.16);
    const front = Math.max(M.NP.f(ringY), rz) * 1.02;
    // the closed path a necklace follows: round the neck, dipping at the front under its own weight
    const path = (a, lift) => {
      const s = Math.max(0, Math.cos(a));
      return new T.Vector3(Math.sin(a) * rx, ringY - sag * s * s + (lift || 0), Math.cos(a) * rz * (1 + 0.1 * s));
    };
    if (kind === 'gold' || kind === 'ice') {
      const ice = kind === 'ice';
      const metal = mat(T, ice
        ? { color: 0xeaf0fa, metalness: 1, roughness: 0.1, envMapIntensity: 2.0 }
        : { color: 0xffc83d, metalness: 1, roughness: 0.17, envMapIntensity: 2.0 });
      const metalD = mat(T, ice
        ? { color: 0xb9c6da, metalness: 1, roughness: 0.2, envMapIntensity: 1.7 }
        : { color: 0xd8a126, metalness: 1, roughness: 0.26, envMapIntensity: 1.7 });
      // real link geometry: flattened ovals, every other one turned 90 degrees -- a Cuban link chain
      const N = 30, lr = Math.max(rx * 0.115, H * 0.018), tube = lr * 0.34;
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2, a2 = (i + 1) / N * Math.PI * 2;
        const p = path(a), q = path(a2);
        const dir = new T.Vector3().subVectors(q, p).normalize();
        const link = part(T, g, new T.TorusGeometry(lr, tube, 7, 16), i % 2 ? metal : metalD, null, 'link');
        link.position.copy(p).addScaledVector(dir, 0.5 * p.distanceTo(q));
        link.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
        link.rotateZ(i % 2 ? Math.PI / 2 : 0);
        link.scale.set(1, 0.68, 1);
        if (ice && i % 3 === 0) { const st = part(T, g, new T.OctahedronGeometry(tube * 1.5, 0), mat(T, { color: 0xffffff, roughness: 0.02, metalness: 0.1, emissive: 0x8fd8ff, emissiveIntensity: 0.55 }), null, 'stone'); st.position.copy(link.position); st.position.y += tube * 0.5; }
      }
      // the pendant hangs in FRONT and below, on a short bail
      const py = ringY - sag - H * 0.16, pz = Math.max(M.chestZ, front) * 1.0;
      const bail = part(T, g, new T.TorusGeometry(lr * 0.7, tube * 0.8, 6, 14), metal, null, 'droop');
      bail.position.set(0, ringY - sag - lr * 0.5, front); bail.rotation.y = Math.PI / 2;
      strut(T, g, new T.Vector3(0, ringY - sag - lr * 0.6, front), new T.Vector3(0, py + H * 0.05, pz), tube * 0.8, metal, 'droop', 6);
      if (!ice) {
        const coin = part(T, g, new T.CylinderGeometry(rx * 0.36, rx * 0.36, rx * 0.09, 32), metal, null, 'pendant');
        coin.rotation.x = Math.PI / 2; coin.position.set(0, py, pz);
        const rim = part(T, g, new T.TorusGeometry(rx * 0.35, rx * 0.035, 8, 30), metalD, null, 'pendant'); rim.position.set(0, py, pz);
        const mark = part(T, g, new T.TorusGeometry(rx * 0.18, rx * 0.04, 6, 24), mat(T, { color: 0xffe9a0, metalness: 1, roughness: 0.35 }), null, 'pendant'); mark.position.set(0, py, pz + rx * 0.05);
      } else {
        const claw = part(T, g, new T.OctahedronGeometry(rx * 0.3, 1), mat(T, { color: 0xffffff, roughness: 0.02, metalness: 0.05, envMapIntensity: 2.2, emissive: 0x9fe6ff, emissiveIntensity: 0.5 }), null, 'pendant');
        claw.scale.set(0.85, 1.3, 0.85); claw.position.set(0, py, pz);
        const setting = part(T, g, new T.TorusGeometry(rx * 0.2, rx * 0.04, 8, 22), metalD, null, 'pendant'); setting.position.set(0, py + rx * 0.16, pz); setting.rotation.x = Math.PI / 2;
      }
    } else if (kind === 'scarf') {
      const red = mat(T, { color: 0xd22a42, roughness: 0.9 });
      const wrap = part(T, g, new T.TorusGeometry(1, Math.max(rx * 0.3, H * 0.055) / Math.max(rx, 1e-6), 12, 44), red, null, 'ring');
      // scale.z was left at 1 while x and y were scaled to the neck. The torus is rotated a quarter
      // turn, so its local Z is the world VERTICAL -- leaving it at 1 squashed the tube into a flat
      // bar that cut straight across the chest and both arms and read as a rendering glitch. All
      // three axes have to be scaled together for the band to stay round.
      wrap.rotation.x = Math.PI / 2 - 0.1;
      // A scarf is a bulky wrap, not a chain, and at 1.08 it measured INSIDE the neck on 14 bodies:
      // the probe's neck radius is the hypotenuse across an elliptical neck, so a ring sized on the
      // half-width alone sits under it at the corners. Sized as what it is instead.
      wrap.scale.set(rx * 1.18, rz * 1.18, rx * 1.18);
      wrap.position.y = ringY + H * 0.02;
      const knot = part(T, g, new T.SphereGeometry(rx * 0.34, 14, 10), red, null, 'knot'); knot.position.set(rx * 0.34, ringY - H * 0.03, front * 0.94); knot.scale.set(1, 0.9, 0.85);
      // The tail was a rx*0.5 x H*0.72 x rx*0.1 slab -- half the fighter's height, a tenth as thick,
      // hanging flat down the chest. On every body it read as a necktie, not a scarf, and it was the
      // one neck option that looked wrong on all four fighters I rendered. Shorter, thicker, tapered
      // and turned off the chest so it has some form to catch the light.
      const tail = part(T, g, new T.CylinderGeometry(rx * 0.30, rx * 0.20, H * 0.40, 8, 1), red, null, 'tail');
      tail.scale.set(1, 1, 0.55);
      tail.position.set(rx * 0.46, ringY - H * 0.22, Math.max(M.chestZ, front) * 0.92);
      tail.rotation.set(0.18, 0, 0.20);
      const tip = part(T, g, new T.CylinderGeometry(rx * 0.20, rx * 0.16, H * 0.16, 8, 1), red, null, 'tail');
      tip.scale.set(1, 1, 0.55);
      tip.position.set(rx * 0.58, ringY - H * 0.46, Math.max(M.chestZ, front) * 0.86);
      tip.rotation.set(0.30, 0, 0.34);
    } else if (kind === 'tags') {
      // Dog tags: a ball chain on the same measured path the gold chain uses (so it hangs where a
      // chain hangs on THIS neck) with two stamped plates on the drop.
      const steel = mat(T, { color: 0xb8c0cc, metalness: 1, roughness: 0.3, envMapIntensity: 1.7 });
      const steelD = mat(T, { color: 0x79828f, metalness: 1, roughness: 0.42, envMapIntensity: 1.3 });
      const N = 46, br = Math.max(rx * 0.082, H * 0.013);
      for (let i = 0; i < N; i++) {
        const bead = part(T, g, new T.SphereGeometry(br, 7, 6), i % 2 ? steel : steelD, null, 'link');
        // 1.05 outward: the first version put the beads exactly on the chain path with a bead half
        // the size of a chain link, and the result measured inside the neck on 23 of 48 bodies
        const p = path(i / N * Math.PI * 2);
        bead.position.set(p.x * 1.05, p.y, p.z * 1.05);
      }
      const low = path(0);                               // the front of the loop, at its lowest point
      for (let i = 0; i < 2; i++) {
        const tag = part(T, g, slab(T, rx * 0.34, rx * 0.52, rx * 0.14, br * 1.1), i ? steelD : steel, null, 'pendant');
        tag.position.set(rx * (i ? 0.1 : -0.06), low.y - rx * 0.34 - i * rx * 0.07, low.z + br * (i ? -0.9 : 0.9));
        tag.rotation.set(0.1, i ? -0.18 : 0.14, i ? 0.08 : -0.05);
      }
    } else if (kind === 'bowtie') {
      const red = mat(T, { color: 0xd22a42, roughness: 0.42 }), dark = mat(T, { color: 0x9e1b30, roughness: 0.5 });
      const z = Math.max(M.NP.f(tieY), M.nd) * 1.02;
      const band = ellipseRing(T, g, dark, M.nw * 1.03, M.nd * 1.03, Math.max(rx * 0.11, H * 0.018), 'collar'); band.position.y = tieY;
      const w = rx * 0.62, hgt = rx * 0.5;
      for (const sx of [-1, 1]) {
        const wing = part(T, g, new T.CylinderGeometry(hgt * 0.24, hgt, w, 4, 1), red, null, 'wing');
        wing.rotation.set(0, Math.PI / 4, sx * Math.PI / 2); wing.position.set(sx * (w * 0.5 + rx * 0.1), tieY, z);
      }
      const knot = part(T, g, new T.BoxGeometry(rx * 0.24, rx * 0.3, rx * 0.2), dark, null, 'knot'); knot.position.set(0, tieY, z + rx * 0.02);
    } else return;
    mount(M, 'neck', g, 0, 0, 0);
  }

  // ---------------------------------------------------------------- shoes
  function buildShoes(T, M, kind) {
    for (const f of M.feet) {
      const g = gearGroup(T, 'shoes'); g.userData.cfFoot = f.key;
      const L = f.len, Wd = Math.max(f.halfW, L * 0.17), sole = L * 0.12;
      const y0 = f.soleY - L * 0.035;
      const cz = f.cz, cx = f.cx;
      const white = mat(T, { color: 0xf3f4f8, roughness: 0.55 });
      const rubber = mat(T, { color: 0x14161d, roughness: 0.85 });
      const goldM = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.22, envMapIntensity: 1.9 });
      const goldD = mat(T, { color: 0xb8892a, metalness: 1, roughness: 0.35, envMapIntensity: 1.6 });
      const leather = mat(T, { color: 0x5a3418, roughness: 0.7 });
      const accent = mat(T, { color: 0xe8203c, roughness: 0.5 });
      const isKick = kind === 'kicks';
      const body = isKick ? goldM : kind === 'boots' ? leather : kind === 'sandal' ? leather : white;
      const base = isKick ? goldD : rubber;

      const sm = part(T, g, slab(T, Wd * 2.16, L * 1.06, Wd * 0.55, sole), base, null, 'sole');
      sm.rotation.x = -Math.PI / 2; sm.position.set(cx, y0 + sole * 0.5, cz);
      if (kind !== 'sandal') {
        const mid = part(T, g, slab(T, Wd * 2.06, L * 1.0, Wd * 0.52, sole * 0.55), isKick ? goldM : white, null, 'midsole');
        mid.rotation.x = -Math.PI / 2; mid.position.set(cx, y0 + sole * 1.05, cz);
      }
      if (kind === 'sandal') {
        for (const [t, wdt] of [[0.18, 0.5], [-0.12, 0.42]]) {
          const st = part(T, g, new T.TorusGeometry(Wd * 0.98, Wd * 0.13, 8, 22, Math.PI), leather, null, 'strap');
          st.position.set(cx, y0 + sole, cz + L * t); st.scale.set(1, wdt * 1.7, 1);
        }
        const toe = part(T, g, new T.CylinderGeometry(Wd * 0.09, Wd * 0.09, L * 0.3, 8), leather, null, 'strap');
        toe.position.set(cx, y0 + sole * 1.3, cz + L * 0.33); toe.rotation.x = 1.2;
      } else {
        const up = dome(T, g, body, Wd * 1.1, L * (kind === 'boots' ? 0.42 : 0.46), L * 0.55, 'upper');
        up.position.set(cx, y0 + sole * 1.1, cz - L * 0.02);
        const heel = dome(T, g, isKick ? goldD : kind === 'boots' ? leather : accent, Wd * 1.06, L * (kind === 'boots' ? 0.5 : 0.44), L * 0.3, 'heel');
        heel.position.set(cx, y0 + sole * 1.1, cz - L * 0.3);
        const collar = part(T, g, new T.TorusGeometry(Wd * 0.8, Wd * 0.17, 8, 22), isKick ? goldD : rubber, null, 'collar');
        collar.rotation.x = Math.PI / 2; collar.scale.y = 1.15;
        collar.position.set(cx, y0 + sole * 1.1 + L * (kind === 'boots' ? 0.46 : 0.4), cz - L * 0.28);
        if (kind === 'boots') {
          const shaft = part(T, g, new T.CylinderGeometry(Wd * 0.94, Wd * 1.02, L * 0.62, 20, 1, true), new T.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.7, side: T.DoubleSide }), null, 'shaft');
          shaft.position.set(cx, y0 + sole + L * 0.66, cz - L * 0.22);
          const cuff = part(T, g, new T.TorusGeometry(Wd * 1.0, Wd * 0.13, 8, 22), mat(T, { color: 0x3a2110, roughness: 0.7 }), null, 'cuff');
          cuff.rotation.x = Math.PI / 2; cuff.position.set(cx, y0 + sole + L * 0.96, cz - L * 0.22);
          for (const s of [-1, 1]) { const bk = part(T, g, new T.BoxGeometry(Wd * 0.12, Wd * 0.3, Wd * 0.3), goldM, null, 'buckle'); bk.position.set(cx + s * Wd * 0.96, y0 + sole + L * 0.7, cz - L * 0.22); }
        } else {
          for (let i = 0; i < 3; i++) {
            const lace = part(T, g, new T.CylinderGeometry(Wd * 0.055, Wd * 0.055, Wd * 1.1, 6), isKick ? goldD : white, null, 'lace');
            lace.rotation.z = Math.PI / 2; lace.position.set(cx, y0 + sole * 1.1 + L * (0.36 - i * 0.05), cz + L * (0.02 + i * 0.1));
          }
          for (const s of [-1, 1]) {
            const sw = part(T, g, new T.BoxGeometry(Wd * 0.1, L * 0.12, L * 0.42), isKick ? goldD : accent, null, 'stripe');
            sw.position.set(cx + s * Wd * 1.08, y0 + sole * 1.1 + L * 0.13, cz - L * 0.02); sw.rotation.x = 0.16;
          }
        }
        const toe = part(T, g, new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), isKick ? goldD : rubber, null, 'toecap');
        toe.scale.set(Wd * 1.06, L * 0.2, L * 0.2); toe.position.set(cx, y0 + sole * 1.05, cz + L * 0.34);
      }
      if (isKick) { const gm = glowMat(T, 0xffd36a, 1.3, { metalness: 0.6, roughness: 0.2 }); const gl = part(T, g, new T.TorusGeometry(Wd * 1.02, Wd * 0.045, 6, 26), gm.m, gm.want, 'glow'); gl.rotation.x = Math.PI / 2; gl.scale.y = (L * 0.53) / Math.max(Wd, 1e-6); gl.position.set(cx, y0 + sole * 0.55, cz); }
      mount(M, f.key, g, 0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- hands
  // Everything here is in HAND-bone units, measured per hand in `measure()`:
  //   x = across the palm (`halfW`), y = the back of the hand (`halfT`), z = wrist -> fingertips
  //   (`wristZ` .. `tipZ`, `len`).
  // Nothing uses M.H: a hand bone's units are not head-bone units, and mixing them is the same bug
  // that put the bow tie on the chest. Every piece is sized off THIS hand's own numbers and carries
  // clearance, the same lesson skullShell learned -- a sleeve laid exactly on the measured surface
  // reads as a poke the moment the probe's profile disagrees by a vertex.
  const HAND_PAD = 0.075;              // fraction of the cross-section carried as air
  function buildHands(T, M, kind) {
    for (const h of M.hands || []) {
      // A WATCH GOES ON ONE WRIST. Everything else in this slot is a pair -- wraps, gloves, rings and
      // gauntlets all come in twos -- but the first render put a gold watch on both wrists of every
      // fighter, which reads as a mistake rather than as a flex. Nothing measured it: it is only
      // visible by looking at the contact sheet.
      if (kind === 'watch' && h.key !== 'handR') continue;
      const g = gearGroup(T, 'hands'); g.userData.cfHand = h.key;
      const L = h.len, rx0 = h.halfW, ry0 = h.halfT;
      const pad = k => [rx0 * (1 + HAND_PAD) * (k || 1), ry0 * (1 + HAND_PAD) * (k || 1)];
      // an elliptical sleeve between two heights along the hand, sized on the measured cross-section.
      // OPEN-ENDED by default: a capped tube puts a solid disc across the hand, and the hand comes
      // straight back out through it.
      const sleeve = (z0, z1, k, m, tag, capped, seg) => {
        const [rx, ry] = pad(k), len = Math.abs(z1 - z0) || L * 0.02;
        const c = part(T, g, new T.CylinderGeometry(1, 1, 1, seg || 22, 1, !capped), m, null, tag);
        c.rotation.x = Math.PI / 2;                         // the cylinder's own +Y becomes +Z
        c.scale.set(rx, len, ry);
        c.position.set(h.cx, h.cy, (z0 + z1) / 2);
        return c;
      };
      const band = (z, k, tube, m, tag) => {
        const [rx, ry] = pad(k);
        const t = part(T, g, new T.TorusGeometry(1, Math.max(tube, 1e-5), 8, 24), m, null, tag);
        t.scale.set(rx, ry, 1);
        t.position.set(h.cx, h.cy, z);
        return t;
      };
      const cloth = mat(T, { color: 0xe6e2d6, roughness: 0.92 });
      const clothD = mat(T, { color: 0xbdb7a6, roughness: 0.95 });
      const leather = mat(T, { color: 0x24262e, roughness: 0.72 });
      const leatherD = mat(T, { color: 0x15161c, roughness: 0.8 });
      const steel = mat(T, { color: 0x8d97a6, metalness: 1, roughness: 0.34, envMapIntensity: 1.5 });
      const steelD = mat(T, { color: 0x4a5160, metalness: 1, roughness: 0.46, envMapIntensity: 1.2 });
      const goldM = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.18, envMapIntensity: 2.0 });
      const goldD = mat(T, { color: 0xd8a126, metalness: 1, roughness: 0.28, envMapIntensity: 1.7 });

      if (kind === 'tape') {
        // boxer's wraps: overlapping cloth bands over the wrist and the palm, fingers left bare
        sleeve(h.wristZ - L * 0.1, h.wristZ + L * 0.34, 1.0, cloth, 'wrap');
        sleeve(h.wristZ + L * 0.3, h.wristZ + L * 0.62, 1.03, clothD, 'wrap');
        for (let i = 0; i < 3; i++) band(h.wristZ + L * (0.02 + i * 0.14), 1.04, ry0 * 0.1, i % 2 ? clothD : cloth, 'band');
        // one diagonal strap across the back of the hand, so it reads as wrapped and not as a tube
        const st = part(T, g, slab(T, rx0 * 0.5, L * 0.5, rx0 * 0.2, ry0 * 0.12), clothD, null, 'strap');
        st.position.set(h.cx, h.cy + ry0 * 1.02, h.wristZ + L * 0.42);
        st.rotation.set(-Math.PI / 2, 0, 0.5);
      } else if (kind === 'mitts') {
        // fingerless gloves: a leather sleeve that stops at the knuckles
        sleeve(h.wristZ - L * 0.06, h.wristZ + L * 0.66, 1.0, leather, 'glove');
        band(h.wristZ - L * 0.04, 1.06, ry0 * 0.14, leatherD, 'cuff');
        band(h.wristZ + L * 0.64, 1.04, ry0 * 0.1, leatherD, 'hem');
        const kn = part(T, g, slab(T, rx0 * 1.5, L * 0.2, rx0 * 0.3, ry0 * 0.14), leatherD, null, 'knuckle');
        kn.position.set(h.cx, h.cy + ry0 * 1.0, h.wristZ + L * 0.56);
        kn.rotation.x = -Math.PI / 2;
        const bk = part(T, g, new T.BoxGeometry(rx0 * 0.34, ry0 * 0.22, ry0 * 0.22), steelD, null, 'buckle');
        bk.position.set(h.cx + rx0 * 0.6, h.cy + ry0 * 1.04, h.wristZ + L * 0.02);
      } else if (kind === 'rings') {
        // Knuckle rings, and the first version of them was wrong in a way the probe caught: it put
        // each ring around a FINGER, and this rig has no finger bones -- every body wears a closed
        // paw or fist, so there is no finger to encircle and 14-18% of every ring measured inside the
        // hand. They sit ON the knuckle line instead, at the measured top surface, which is what a
        // knuckle ring looks like on a closed fist anyway.
        const r = Math.max(ry0 * 0.34, L * 0.03), tube = r * 0.32;
        const z = h.wristZ + L * 0.64, y = h.cy + ry0 * (1 + HAND_PAD) - r * 0.25;
        for (let i = 0; i < 4; i++) {
          const x = h.cx + (i - 1.5) * (rx0 * 2 * 0.38);
          const ring = part(T, g, new T.TorusGeometry(r, tube, 9, 20), i === 1 ? goldM : goldD, null, 'ring');
          ring.position.set(x, y, z);
          ring.rotation.x = Math.PI / 2;                   // the band lies flat on the knuckle
          if (i === 1) {
            const st = part(T, g, new T.BoxGeometry(r * 1.4, r * 0.55, r * 1.1), goldM, null, 'sovereign');
            st.position.set(x, y + r * 0.4, z);
          }
        }
      } else if (kind === 'watch') {
        // the band is a closed ring around the wrist; the FACE needs a side, and +up is the back of
        // the hand because `measure()` orients the palm normal away from the hips
        const z = h.wristZ + L * 0.1;
        band(z, 1.04, ry0 * 0.13, goldD, 'band');
        const [rx, ry] = pad(1.04);
        const case_ = part(T, g, new T.CylinderGeometry(ry * 0.62, ry * 0.62, ry * 0.26, 24), goldM, null, 'case');
        case_.position.set(h.cx, h.cy + ry * 1.02, z);
        const dial = part(T, g, new T.CylinderGeometry(ry * 0.48, ry * 0.48, ry * 0.3, 24), mat(T, { color: 0x0b1018, roughness: 0.25, metalness: 0.3 }), null, 'dial');
        dial.position.set(h.cx, h.cy + ry * 1.07, z);
        // A cylinder's own axis is +Y, and +Y here IS the back of the hand, so the dial already faces
        // out of it with no rotation. Turning the case is what would stand a watch on its edge.
        const gm = glowMat(T, 0xffe9a8, 0.9, { metalness: 0.5, roughness: 0.2 });
        const gl = part(T, g, new T.TorusGeometry(ry * 0.56, ry * 0.04, 6, 22), gm.m, gm.want, 'glow');
        gl.position.set(h.cx, h.cy + ry * 1.12, z);
        gl.rotation.x = Math.PI / 2;
      } else if (kind === 'gaunt') {
        // armoured gauntlet: it runs BACK into the forearm, which is the one piece in this slot that
        // is allowed to leave the hand -- the forearm is the parent bone, so it follows anyway
        sleeve(h.wristZ - L * 0.62, h.wristZ + L * 0.58, 1.02, leatherD, 'liner');
        const [rx, ry] = pad(1.14);
        for (let i = 0; i < 4; i++) {
          const z0 = h.wristZ - L * (0.58 - i * 0.3);
          const pl = part(T, g, new T.CylinderGeometry(1, 1, 1, 20, 1, true), i % 2 ? steel : steelD, null, 'plate');
          pl.rotation.x = Math.PI / 2;
          pl.scale.set(rx * (1 + i * 0.02), L * 0.26, ry * (1 + i * 0.02));
          pl.position.set(h.cx, h.cy, z0 + L * 0.13);
        }
        const cuff = part(T, g, new T.CylinderGeometry(1, 1, 1, 20, 1, true), steel, null, 'cuff');
        cuff.rotation.x = Math.PI / 2; cuff.scale.set(rx * 1.22, L * 0.16, ry * 1.22);
        cuff.position.set(h.cx, h.cy, h.wristZ - L * 0.62);
        const kn = part(T, g, slab(T, rx * 1.5, L * 0.26, rx * 0.34, ry * 0.2), steel, null, 'knuckle');
        kn.position.set(h.cx, h.cy + ry * 0.96, h.wristZ + L * 0.46);
        kn.rotation.x = -Math.PI / 2;
        for (let i = 0; i < 3; i++) {
          const sp = part(T, g, new T.ConeGeometry(ry * 0.14, ry * 0.4, 8), steel, null, 'spike');
          sp.position.set(h.cx + (i - 1) * rx * 0.62, h.cy + ry * 1.12, h.wristZ + L * 0.46);
        }
      } else if (kind === 'driver') {
        // driving gloves: a short leather sleeve, knuckle vents and a strap over the wrist
        sleeve(h.wristZ - L * 0.04, h.wristZ + L * 0.6, 1.0, mat(T, { color: 0x3a2a22, roughness: 0.55 }), 'glove');
        band(h.wristZ - L * 0.02, 1.07, ry0 * 0.12, mat(T, { color: 0x241a14, roughness: 0.6 }), 'cuff');
        for (let i = 0; i < 3; i++) {
          const v = part(T, g, new T.CylinderGeometry(ry0 * 0.11, ry0 * 0.11, ry0 * 0.1, 10), mat(T, { color: 0x120e0b, roughness: 0.8 }), null, 'vent');
          v.position.set(h.cx + (i - 1) * rx0 * 0.52, h.cy + ry0 * 1.0, h.wristZ + L * 0.44);
          v.rotation.x = Math.PI / 2;
        }
        const st2 = part(T, g, slab(T, rx0 * 1.5, L * 0.12, rx0 * 0.2, ry0 * 0.1), mat(T, { color: 0x241a14, roughness: 0.6 }), null, 'strap');
        st2.position.set(h.cx, h.cy + ry0 * 1.04, h.wristZ + L * 0.06);
        st2.rotation.x = -Math.PI / 2;
      } else if (kind === 'moto') {
        // moto gloves: an armoured knuckle plate, which is the whole silhouette
        sleeve(h.wristZ - L * 0.08, h.wristZ + L * 0.62, 1.0, leather, 'glove');
        band(h.wristZ - L * 0.06, 1.1, ry0 * 0.16, leatherD, 'cuff');
        const plate = part(T, g, slab(T, rx0 * 1.7, L * 0.3, rx0 * 0.3, ry0 * 0.26), steelD, null, 'knuckle');
        plate.position.set(h.cx, h.cy + ry0 * 1.1, h.wristZ + L * 0.5);
        plate.rotation.x = -Math.PI / 2;
        for (let i = 0; i < 4; i++) {
          const kn2 = part(T, g, new T.SphereGeometry(ry0 * 0.17, 10, 8), steel, null, 'stud');
          kn2.position.set(h.cx + (i - 1.5) * rx0 * 0.44, h.cy + ry0 * 1.26, h.wristZ + L * 0.5);
          kn2.scale.set(1, 0.6, 1);
        }
      } else if (kind === 'work') {
        // heavy work gloves: a thick body and a tall flared cuff up the forearm
        sleeve(h.wristZ - L * 0.3, h.wristZ + L * 0.64, 1.1, mat(T, { color: 0xc8a05a, roughness: 0.9 }), 'glove');
        sleeve(h.wristZ - L * 0.46, h.wristZ - L * 0.22, 1.28, mat(T, { color: 0xb08a44, roughness: 0.92 }), 'cuff');
        for (let i = 0; i < 2; i++) band(h.wristZ + L * (0.12 + i * 0.22), 1.13, ry0 * 0.08, mat(T, { color: 0x8a6a30, roughness: 0.9 }), 'seam');
        const pad = part(T, g, slab(T, rx0 * 1.5, L * 0.34, rx0 * 0.3, ry0 * 0.2), mat(T, { color: 0x8a6a30, roughness: 0.9 }), null, 'pad');
        pad.position.set(h.cx, h.cy - ry0 * 1.04, h.wristZ + L * 0.34);
        pad.rotation.x = -Math.PI / 2;
      } else if (kind === 'latex') {
        // surgical: thin, glossy, and it runs a long way up the forearm
        sleeve(h.wristZ - L * 0.55, h.wristZ + L * 0.66, 0.98, mat(T, { color: 0x3fc8b0, roughness: 0.22, metalness: 0.05 }), 'glove');
        band(h.wristZ - L * 0.52, 1.03, ry0 * 0.07, mat(T, { color: 0x2f9e8a, roughness: 0.3 }), 'hem');
      } else if (kind === 'boxing') {
        // full boxing gloves: one big rounded mitt and a wrapped wrist, no finger detail at all
        const mitt = part(T, g, new T.SphereGeometry(1, 18, 14), mat(T, { color: 0xc0231f, roughness: 0.52 }), null, 'glove');
        mitt.scale.set(rx0 * 1.5, ry0 * 1.7, L * 0.42);
        mitt.position.set(h.cx, h.cy + ry0 * 0.1, h.wristZ + L * 0.42);
        const thumb = part(T, g, new T.SphereGeometry(1, 12, 10), mat(T, { color: 0xa81c19, roughness: 0.55 }), null, 'thumb');
        thumb.scale.set(rx0 * 0.52, ry0 * 0.6, L * 0.2);
        thumb.position.set(h.cx - rx0 * 1.1, h.cy - ry0 * 0.3, h.wristZ + L * 0.3);
        sleeve(h.wristZ - L * 0.28, h.wristZ + L * 0.06, 1.12, mat(T, { color: 0xe6e2d6, roughness: 0.9 }), 'wrap');
        band(h.wristZ - L * 0.24, 1.16, ry0 * 0.09, mat(T, { color: 0xbdb7a6, roughness: 0.92 }), 'band');
      } else if (kind === 'chrome') {
        // a chrome gauntlet: segmented plates up the forearm, mirror finish
        const chr = mat(T, { color: 0xdfe6ef, metalness: 1, roughness: 0.1, envMapIntensity: 2.4 });
        const chrD = mat(T, { color: 0x8d97a6, metalness: 1, roughness: 0.22, envMapIntensity: 1.8 });
        sleeve(h.wristZ + L * 0.1, h.wristZ + L * 0.66, 1.04, chr, 'glove');
        for (let i = 0; i < 4; i++) {
          const seg = part(T, g, new T.CylinderGeometry(1, 1, L * 0.16, 20, 1, true), i % 2 ? chrD : chr, null, 'plate');
          seg.rotation.x = Math.PI / 2;
          seg.scale.set(rx0 * (1.16 - i * 0.03), L * 0.16, ry0 * (1.16 - i * 0.03));
          seg.position.set(h.cx, h.cy, h.wristZ - L * (0.06 + i * 0.17));
        }
        const ridge = part(T, g, slab(T, rx0 * 0.4, L * 0.7, rx0 * 0.12, ry0 * 0.16), chrD, null, 'ridge');
        ridge.position.set(h.cx, h.cy + ry0 * 1.1, h.wristZ + L * 0.3);
        ridge.rotation.x = -Math.PI / 2;
      } else { continue; }
      mount(M, h.key, g, 0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- back
  // CHEST-bone units, measured in `measure()`: x across the shoulders (`halfW`), y chest -> neck
  // (`botY`..`topY`, `h`), z toward the face. The rear SURFACE is `backZ`, measured across the middle
  // of the back only -- the shoulder caps and the small of the back both sit further in, and letting
  // them into that number is what would hang a pack a hand's width off the body.
  function buildBack(T, M, kind) {
    const b = M.back; if (!b) return;
    const g = gearGroup(T, 'back');
    const W = b.coreW, Hh = b.h, D = b.halfD, zb = b.backZ, yMid = b.midY;
    const canvas = mat(T, { color: 0x2b2f38, roughness: 0.88 });
    const canvasD = mat(T, { color: 0x1a1d24, roughness: 0.9 });
    const strapM = mat(T, { color: 0x14161c, roughness: 0.8 });
    const steel = mat(T, { color: 0x9aa4b2, metalness: 1, roughness: 0.3, envMapIntensity: 1.6 });
    const steelD = mat(T, { color: 0x3f4654, metalness: 1, roughness: 0.45, envMapIntensity: 1.2 });
    // two shoulder straps, from the top of the piece, over the shoulder line, down the chest. They
    // are what makes a pack look worn instead of stuck on.
    const straps = (yTop, m) => {
      for (const s of [-1, 1]) {
        const st = part(T, g, new T.CylinderGeometry(W * 0.1, W * 0.1, Hh * 0.72, 10), m, null, 'strap');
        st.position.set(s * W * 0.58, yTop - Hh * 0.2, zb + D * 0.55);
        st.rotation.x = -0.34;
      }
      for (const s of [-1, 1]) {
        const sh = part(T, g, new T.TorusGeometry(D * 0.78, W * 0.1, 8, 18, Math.PI * 1.05), m, null, 'strap');
        sh.position.set(s * W * 0.58, yTop, 0);
        sh.rotation.set(Math.PI / 2, 0, 0); sh.rotation.y = Math.PI / 2;
      }
    };
    if (kind === 'pack') {
      // The depth is driven by the torso's own DEPTH and only floored on its width. The first version
      // was `max(D * 0.8, W * 0.5)`, and on a body with a shallow chest and a broad back (wojak,
      // techno, fartcoin, brett) the width term won and hung the pack 1.5+ torso depths off the back.
      // Clamping it to the body's depth is the difference between a pack worn and a pack towed.
      const pd = Math.min(Math.max(D * 0.72, W * 0.34), D * 1.2);
      const body = part(T, g, slab(T, W * 1.9, Hh * 0.78, W * 0.3, pd), canvas, null, 'pack');
      body.position.set(0, yMid, zb - pd * 0.5);
      const lid = part(T, g, slab(T, W * 1.96, Hh * 0.3, W * 0.3, pd * 0.9), canvasD, null, 'lid');
      lid.position.set(0, yMid + Hh * 0.28, zb - pd * 0.5);
      const pocket = part(T, g, slab(T, W * 1.1, Hh * 0.26, W * 0.2, pd * 0.45), canvasD, null, 'pocket');
      pocket.position.set(0, yMid - Hh * 0.2, zb - pd * 1.02);
      for (const s of [-1, 1]) {
        const bk = part(T, g, new T.BoxGeometry(W * 0.22, Hh * 0.1, W * 0.14), steelD, null, 'buckle');
        bk.position.set(s * W * 0.5, yMid + Hh * 0.12, zb - pd * 1.0);
      }
      straps(yMid + Hh * 0.36, strapM);
    } else if (kind === 'cape') {
      // a hanging cloth, built as a curved strip so it wraps the shoulders instead of standing off
      // the back as a flat board. DoubleSide, because you see the inside of a cape constantly.
      const cm = new T.MeshStandardMaterial({ color: 0x8c1024, roughness: 0.82, side: T.DoubleSide });
      const lining = new T.MeshStandardMaterial({ color: 0x2b0a12, roughness: 0.86, side: T.DoubleSide });
      // `clear` is the air between the cloth and the measured back surface. Without it the sheet
      // starts exactly on the skin and the first frame of animation pushes it through.
      const clear = Math.max(D * 0.08, W * 0.04);
      // THE SECOND PIECE THAT PASSED EVERY NUMBER AND LOOKED WRONG. At a wrap of 0.95*PI and a flare
      // of 1.55 the sheet came out as a flat red BOARD on any broad-backed body (mochi, ape, bear):
      // the cloth was in the right place, hanging the right distance, and read as plywood, because a
      // cape is recognisable by its CURVATURE and almost all of this one's was spent going sideways.
      // More wrap round the body, less sideways flare, and a fold pattern that deepens toward the hem
      // the way hanging cloth actually does.
      const sheet = (off) => {
        const geo = new T.PlaneGeometry(1, 1, 26, 12), pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5;     // 0..1 across, 0..1 up
          // 0.62 PI of wrap, not 1.22: at the wider angle the edges swung so far behind the body that
          // the sheet closed into a tube and read as a rolled banner. A cape is WIDE and only gently
          // curved -- the curvature is what stops it being a board, the width is what makes it a cape,
          // and the first two attempts each had one of those at the cost of the other.
          const a = (u - 0.5) * Math.PI * 0.62;                   // wrap angle around the body
          const flare = 1 + (1 - v) * 0.45;                       // wider at the hem
          const fold = Math.sin(u * Math.PI * 4) * (1 - v) * 0.45 + Math.sin(u * Math.PI * 7.5) * (1 - v) * 0.14;
          const x = Math.sin(a) * W * 1.7 * flare;
          const z = zb - clear - off + (Math.cos(a) - 1) * D * 0.9 - (1 - v) * D * 0.28
            + fold * D * 0.34;                                    // the folds move the cloth in DEPTH
          const y = b.topY - (1 - v) * Hh * 2.25 + Math.abs(fold) * Hh * 0.05 * (1 - v);
          pos.setXYZ(i, x, y, z);
        }
        geo.computeVertexNormals();
        return geo;
      };
      part(T, g, sheet(clear * 0.5), cm, null, 'cape');
      part(T, g, sheet(0), lining, null, 'lining');
      // the collar: a torus arc round the back of the neck, which is what holds it up
      // tagged `strap`, not `collar`: `collar` is the neck slot's own tag and the probe's soft list is
      // shared across slots, so borrowing the name would relax the bow tie's test as a side effect
      const col = part(T, g, new T.TorusGeometry(W * 1.15, W * 0.12, 8, 22, Math.PI * 1.15), canvasD, null, 'strap');
      col.position.set(0, b.topY, zb + D * 0.25);
      col.rotation.set(Math.PI / 2, 0, -Math.PI * 0.075);
      // There were two metal clasps here at z = backZ + halfD/2, which the probe measured as 8% of
      // the piece BURIED IN THE TORSO -- a quarter of the way into the chest. They are gone rather
      // than pushed outward until the number clears: a cape is held up by its collar, the collar arc
      // is already there and already hugs the right surface, so the clasps were decoration sitting
      // inside a ribcage. Thickening the centre of the collar reads as the fastening instead.
      // (there was a metal knot here at zb + D * 0.3 as well, and the probe measured it inside the
      // torso on bonk, kaiju and mystic for the same reason the clasps were: anything placed forward
      // of the measured rear surface by a fraction of the body's own depth is INSIDE the body. The
      // collar arc is the fastening.)
    } else if (kind === 'katana') {
      // slung across the back on a strap, hilt up over the right shoulder
      // The length is capped against the back's WIDTH as well as its height. At a flat `Hh * 2.0` a
      // tall narrow torso wore a blade half again as long as its own back, and the hilt swung so far
      // out that the piece measured 0.8+ of the back width off centre on nine bodies. A slung blade is
      // meant to be diagonal, not to be longer than the person carrying it.
      const sheathL = Math.min(Hh * 1.72, W * 4.6), r = Math.max(W * 0.11, D * 0.14);
      const holder = new T.Group(); holder.userData.cfGear = true;
      const sh = part(T, holder, new T.CylinderGeometry(r, r * 0.86, sheathL, 14), mat(T, { color: 0x101318, roughness: 0.42 }), null, 'sheath');
      sh.position.set(0, 0, 0);
      for (let i = 0; i < 4; i++) {
        const w = part(T, holder, new T.TorusGeometry(r * 1.06, r * 0.1, 6, 16), mat(T, { color: 0xb08a3a, metalness: 1, roughness: 0.32 }), null, 'wrap');
        w.position.set(0, sheathL * (0.34 - i * 0.22), 0); w.rotation.x = Math.PI / 2;
      }
      const grip = part(T, holder, new T.CylinderGeometry(r * 0.62, r * 0.62, sheathL * 0.3, 12), mat(T, { color: 0x1c1f26, roughness: 0.7 }), null, 'grip');
      grip.position.set(0, sheathL * 0.63, 0);
      const guard = part(T, holder, new T.CylinderGeometry(r * 1.5, r * 1.5, r * 0.26, 20), mat(T, { color: 0x30343d, metalness: 0.9, roughness: 0.38 }), null, 'guard');
      guard.position.set(0, sheathL * 0.49, 0);
      const cap = part(T, holder, new T.SphereGeometry(r * 0.66, 14, 10), mat(T, { color: 0x30343d, metalness: 0.9, roughness: 0.38 }), null, 'cap');
      cap.position.set(0, sheathL * 0.78, 0);
      // the slung diagonal, with the holder shifted back by the hilt's own lean so the piece sits
      // across the back rather than hanging off one shoulder
      const lean = 0.42;
      holder.rotation.z = -lean;
      holder.position.set(-Math.sin(lean) * sheathL * 0.22, yMid, zb - r * 1.15);
      g.add(holder);
      const bandM = mat(T, { color: 0x141720, roughness: 0.84 });
      const bd = part(T, g, new T.TorusGeometry(Math.max(W * 1.25, D * 1.3), W * 0.095, 8, 26), bandM, null, 'baldric');
      bd.position.set(0, yMid + Hh * 0.1, zb + D * 0.45);
      bd.rotation.set(Math.PI / 2, 0, 0); bd.rotation.y = 0.56;
    } else if (kind === 'wings') {
      const featherM = mat(T, { color: 0xf2f4fa, roughness: 0.52 });
      const featherD = mat(T, { color: 0xc9d2e2, roughness: 0.6 });
      // THE FIRST VERSION OF THESE PASSED EVERY NUMBER AND LOOKED WRONG, which is the exact failure
      // the acceptance rules warn about. The feathers were fanned through `rotation.z` alone, from
      // -0.26 to -1.38 radians, so the last ones lay nearly horizontal and the pair read as a white
      // RUFF round the shoulders rather than as wings -- correct position, correct size, correct
      // clearance, wrong object. A wing sweeps BACK and up: the span is mostly along -z, the fan
      // angle stays well short of horizontal, and each feather sits further back than the one before.
      // Attempt three, and the first two are worth recording because they were both the same mistake.
      // Fanning the feathers from ONE origin -- whatever the angles -- builds a comb: every feather
      // radiates from the same point, so the silhouette is a sector of a circle. A wing is not a fan.
      // It has a LEADING EDGE that sweeps out from the shoulder and back, with feathers hanging off
      // that edge roughly PARALLEL to each other and shortening toward the tip. So the feathers are
      // placed ALONG a curve and all point the same way, instead of being rotated about a hub.
      for (const s of [-1, 1]) {
        const wing = new T.Group(); wing.userData.cfGear = true;
        const N = 13;
        // The leading edge as a direction, so every feather can be built in the WING'S OWN PLANE.
        // Attempt three placed the feathers correctly and still read as a garden rake, because
        // `setFromUnitVectors` gives the MINIMAL rotation from +Y to the feather direction -- which
        // twists each flat feather a different amount about its own length and leaves them standing
        // edge-on with daylight between them. A feather is a flat thing and which way the flat faces
        // is the whole silhouette, so the orientation is a full basis: length along the feather,
        // thickness along the wing's surface normal, width across the two.
        const edge = new T.Vector3(s * W * 1.5, Hh * 0.53, -D * 0.55).normalize();
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          // the leading edge: out from the shoulder, up, and back
          const lx = s * W * (0.18 + t * 1.5);
          const ly = Hh * (0.1 + t * 0.95 - t * t * 0.42);
          const lz = -D * (0.05 + t * 0.55);
          // every feather points the same way -- back, down and slightly out -- so they read as a
          // surface rather than as spokes. The tip ones tilt a little further out.
          const dir = new T.Vector3(s * (0.16 + t * 0.3), -(0.78 - t * 0.2), -(0.5 + t * 0.26)).normalize();
          // the feathers OVERLAP: each is wider than the gap to the next, so the wing is a surface
          // rather than a row of blades with sky between them
          const len = Hh * (1.25 - t * 0.72), wdt = W * (0.42 - t * 0.16);
          const f = part(T, wing, slab(T, wdt, len, wdt * 0.42, Math.max(W * 0.028, 1e-4)), i % 2 ? featherM : featherD, null, 'feather');
          const nrm = new T.Vector3().crossVectors(edge, dir).normalize();
          // the cross product flips sign on the mirrored side, which inverts the basis and with it
          // the winding of every feather on that wing. Point it outward on both sides instead.
          if (nrm.x * s < 0) nrm.negate();
          const wax = new T.Vector3().crossVectors(dir, nrm).normalize();
          f.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(wax, dir, nrm));
          f.position.set(lx, ly, lz).addScaledVector(dir, len * 0.42);
          wing.add(f);
        }
        // the arm bone along that same leading edge, which is what the feathers visibly hang from
        const a0 = new T.Vector3(s * W * 0.18, Hh * 0.1, -D * 0.05);
        const a1 = new T.Vector3(s * W * 1.68, Hh * 0.63, -D * 0.6);
        strut(T, wing, a0, a1, W * 0.075, featherD, 'bone', 8);
        wing.position.set(0, yMid + Hh * 0.18, zb - D * 0.05);
        g.add(wing);
      }
      const yoke = part(T, g, slab(T, W * 1.5, Hh * 0.3, W * 0.3, D * 0.2), steelD, null, 'yoke');
      yoke.position.set(0, yMid + Hh * 0.16, zb - D * 0.16);
      straps(yMid + Hh * 0.34, strapM);
    } else return;
    mount(M, 'back', g, 0, 0, 0);
  }

  // ---------------------------------------------------------------- auras
  // Each aura is a shader shell (cheap: 2-3 draw calls) plus a light that actually falls on the fighter, all
  // driven from one mesh's onBeforeRender so there is a single tick per aura per frame.
  const FX_NOISE = `
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }`;
  const FX_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  function flameMat(T, cA, cB, opt) {
    const o = opt || {};
    return fxMat(T, {
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      uniforms: { t: { value: 0 }, cA: { value: new T.Color(cA) }, cB: { value: new T.Color(cB) }, uInt: { value: o.int == null ? 1.0 : o.int }, uSpd: { value: o.spd == null ? 1.15 : o.spd }, uSharp: { value: o.sharp == null ? 0.32 : o.sharp } },
      vertexShader: FX_VERT,
      fragmentShader: FX_NOISE + `
        uniform float t, uInt, uSpd, uSharp; uniform vec3 cA, cB; varying vec2 vUv;
        void main(){
          float y = vUv.y;
          vec2 q = vec2(vUv.x * 7.0, vUv.y * 2.6 - t * uSpd);
          float n = fbm(q + fbm(q * 1.7));
          float lick = smoothstep(uSharp, 0.94, n + (1.0 - y) * 0.6);
          float body = lick * pow(1.0 - y, 0.5) * smoothstep(0.0, 0.1, y);
          vec3 c = mix(cA, cB, clamp(n * 1.35 - y * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(c * body * uInt, body);
        }`,
    });
  }
  function smokeMat(T, cA, cB, opt) {
    const o = opt || {};
    return fxMat(T, {
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: o.additive === false ? T.NormalBlending : T.AdditiveBlending,
      uniforms: { t: { value: 0 }, cA: { value: new T.Color(cA) }, cB: { value: new T.Color(cB) }, uInt: { value: o.int == null ? 1.0 : o.int }, uSpd: { value: o.spd == null ? 0.22 : o.spd } },
      vertexShader: FX_VERT,
      fragmentShader: FX_NOISE + `
        uniform float t, uInt, uSpd; uniform vec3 cA, cB; varying vec2 vUv;
        void main(){
          vec2 q = vec2(vUv.x * 4.0 + t * 0.06, vUv.y * 2.0 - t * uSpd);
          float n = fbm(q + fbm(q * 2.1));
          float body = smoothstep(0.38, 0.86, n) * pow(1.0 - vUv.y, 0.7) * smoothstep(0.0, 0.16, vUv.y);
          vec3 c = mix(cA, cB, clamp(n * 1.4, 0.0, 1.0));
          gl_FragColor = vec4(c * body * uInt, body * 0.9);
        }`,
    });
  }
  function auraDriver(T, g, tick) {
    // one invisible-ish quad that is always drawn: it owns the per-frame update for the whole aura
    const m = fxMat(T, { transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: {}, vertexShader: FX_VERT, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }' });
    const d = part(T, g, new T.PlaneGeometry(0.001, 0.001), m, { tick }, 'driver');
    d.frustumCulled = false; d.castShadow = false; d.renderOrder = -1;
    return d;
  }
  // WHY volt, void and holy used to look like plastic: flame and fire are shader SHELLS -- soft noise
  // blended additively, so they read as light. The other three drew solid geometry (tubes, rings,
  // planes) through `glowMat` with NORMAL blending at 0.55-0.95 opacity, which on a dark stage is an
  // opaque white noodle, a purple bar and a grey slab. Duane, 9/28, on the volt preview: the white
  // spaghetti in his screenshot. They are additive and thinner now, so the same shapes read as arcs
  // of light instead of objects. `fxAdd` is the one place that treatment is expressed.
  const fxAdd = (T, me, op) => { const m = me.material; if (m) { m.blending = T.AdditiveBlending; m.transparent = true; m.opacity = op; m.depthWrite = false; } if (me.userData) me.userData.cfWant = Object.assign({}, me.userData.cfWant, { opacity: op, depthWrite: false }); return me; };
  function buildAura(T, M, kind) {
    const g = gearGroup(T, 'aura');
    const S = M.S, R = Math.max(S * 0.3, M.bw * 1.06), mats = [];   // outside the silhouette, not through it
    const light = new T.PointLight(0xffffff, 0, S * 2.6, 2);
    light.position.set(0, S * 0.55, 0); light.userData.cfGear = true; g.add(light);
    const SOFT_FX = { opacity: 1, depthWrite: false };
    const shell = (rTop, rBot, h, m, yOff) => {
      const s = part(T, g, new T.CylinderGeometry(rTop, rBot, h, 44, 1, true), m, Object.assign({}, SOFT_FX), 'shell');
      s.position.y = h / 2 + (yOff || 0); s.castShadow = false; s.frustumCulled = false; mats.push(m); return s;
    };
    const ground = (rr, m, op) => { const r2 = part(T, g, new T.RingGeometry(rr * 0.82, rr, 48), m, { opacity: op == null ? 0.42 : op, depthWrite: false }, 'ring'); r2.rotation.x = -Math.PI / 2; r2.position.y = S * 0.004; r2.castShadow = false; r2.frustumCulled = false; return r2; };
    const soft = me => { keep(me, Object.assign({}, SOFT_FX, me.userData.cfWant || {})); me.castShadow = false; me.frustumCulled = false; return me; };

    if (kind === 'flame' || kind === 'fire') {
      const ssj = kind === 'flame';
      const cA = ssj ? 0xfff3a0 : 0xffd06a, cB = ssj ? 0xffb020 : 0xff3a08;
      const outer = flameMat(T, cA, cB, { int: ssj ? 0.85 : 0.7, spd: ssj ? 1.5 : 1.1, sharp: ssj ? 0.52 : 0.56 });
      const inner = flameMat(T, 0xffffff, cA, { int: ssj ? 0.7 : 0.5, spd: ssj ? 1.9 : 1.35, sharp: 0.66 });
      shell(R * (ssj ? 0.5 : 0.66), R * 1.1, S * (ssj ? 1.3 : 1.0), outer);
      shell(R * 0.62, R * 0.98, S * (ssj ? 1.05 : 0.8), inner);
      const gm = glowMat(T, cB, 2.4, { transparent: true, opacity: 0.75, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.25, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(ssj ? 0xffd75e : 0xff7a20);
      auraDriver(T, g, (m, t) => {
        outer.uniforms.t.value = t; inner.uniforms.t.value = t;
        const p = 0.8 + Math.sin(t * 7.0) * 0.12 + Math.sin(t * 13.3) * 0.06;
        outer.uniforms.uInt.value = (ssj ? 0.85 : 0.7) * p; inner.uniforms.uInt.value = (ssj ? 0.7 : 0.5) * p;
        light.color.copy(lc); light.intensity = (ssj ? 1.5 : 1.1) * p;
      });
    } else if (kind === 'volt') {
      const glow = flameMat(T, 0xcdf3ff, 0x2a6cff, { int: 0.55, spd: 2.4, sharp: 0.68 });
      shell(R * 0.82, R * 1.05, S * 1.0, glow);
      const boltM = glowMat(T, 0xd8f4ff, 3.6, { transparent: true, opacity: 0.95, depthWrite: false });
      const bolts = [];
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2, rr = R * (0.85 + (i % 3) * 0.12);
        const pts = [];
        const n = 6;
        for (let k = 0; k <= n; k++) {
          const t = k / n, wob = Math.sin(i * 3.7 + k * 2.1) * R * 0.3 * (1 - t);
          pts.push(new T.Vector3(Math.sin(a) * rr * (1 - t * 0.35) + wob, S * (0.92 - t * 0.92), Math.cos(a) * rr * (1 - t * 0.35) + Math.cos(i * 2.3 + k) * R * 0.22 * (1 - t)));
        }
        const b = part(T, g, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 14, S * 0.0045, 5, false), boltM.m, { emissive: boltM.want.emissive, ei: boltM.want.ei, opacity: 0.5, depthWrite: false }, 'bolt');
        soft(b); fxAdd(T, b, 0.5); bolts.push(b);
      }
      for (let k = 0; k < 2; k++) {
        const arc = part(T, g, new T.TorusGeometry(R * (1.0 + k * 0.18), S * 0.0032, 6, 60), boltM.m, { emissive: boltM.want.emissive, ei: boltM.want.ei, opacity: 0.35, depthWrite: false }, 'arc');
        arc.rotation.x = Math.PI / 2; arc.position.y = S * (0.35 + k * 0.4); soft(arc); fxAdd(T, arc, 0.35); bolts.push(arc);
      }
      const gm = glowMat(T, 0x27e1ff, 2.6, { transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.3, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0x6fd0ff);
      auraDriver(T, g, (m, t) => {
        glow.uniforms.t.value = t;
        const seed = Math.floor(t * 22);
        for (let i = 0; i < bolts.length; i++) {
          const h = Math.abs(Math.sin((seed + i * 7.31) * 12.9898) * 43758.5453) % 1;
          bolts[i].visible = h > 0.42;
        }
        g.rotation.y = t * 0.6;
        const flick = 0.35 + (Math.abs(Math.sin(seed * 78.233) * 43758.5) % 1) * 0.9;
        light.color.copy(lc); light.intensity = 1.6 * flick;
        boltM.want.ei = 2.6 + flick * 2.2;
      });
    } else if (kind === 'frost') {
      const mist = smokeMat(T, 0xdff4ff, 0x4aa8ff, { int: 0.45, spd: 0.16 });
      shell(R * 0.98, R * 1.15, S * 0.85, mist);
      // 0.8 opaque pale-grey octahedra read as chipped polystyrene rather than ice, and the eight
      // ground spikes looked like scenery a fighter would trip over. Glassier and more transparent,
      // with the emissive carrying the colour instead of the albedo.
      const ice = mat(T, { color: 0xbfe6ff, roughness: 0.02, metalness: 0.05, transparent: true, opacity: 0.42, envMapIntensity: 2.6, emissive: 0x3f9fe8, emissiveIntensity: 1.1 });
      const shards = [];
      for (let i = 0; i < 12; i++) {
        const sd = part(T, g, new T.OctahedronGeometry(S * (0.028 + (i % 3) * 0.010), 0), ice, { emissive: new T.Color(0x3f9fe8), ei: 1.1, opacity: 0.42 }, 'shard');
        sd.scale.set(0.5, 1.7, 0.5); sd.castShadow = false; shards.push(sd);
      }
      for (let i = 0; i < 8; i++) {
        const sp = part(T, g, new T.ConeGeometry(S * 0.013, S * 0.085, 5), ice, { opacity: 0.42 }, 'spike');
        const a = i / 8 * Math.PI * 2; sp.position.set(Math.sin(a) * R * 1.02, S * 0.035, Math.cos(a) * R * 1.02);
        sp.rotation.set(0.28 * Math.cos(a), 0, -0.28 * Math.sin(a)); sp.castShadow = false;
      }
      const gm = glowMat(T, 0x8fd8ff, 1.6, { transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.25, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0x8fd0ff);
      auraDriver(T, g, (m, t) => {
        mist.uniforms.t.value = t;
        for (let i = 0; i < shards.length; i++) {
          const a = t * 0.5 + i / shards.length * Math.PI * 2, rr = R * (0.85 + Math.sin(t * 0.8 + i) * 0.14);
          shards[i].position.set(Math.sin(a) * rr, S * (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.7 + i * 1.9))), Math.cos(a) * rr);
          shards[i].rotation.set(t * 0.6 + i, t * 0.4, 0);
        }
        light.color.copy(lc); light.intensity = 1.1 + Math.sin(t * 2.0) * 0.2;
      });
    } else if (kind === 'void') {
      const smoke = smokeMat(T, 0x1a0a28, 0x08040e, { int: 0.8, spd: 0.3, additive: false });
      shell(R * 0.92, R * 1.2, S * 1.0, smoke);
      const rim = flameMat(T, 0xc07bff, 0x5a10b0, { int: 0.75, spd: 0.75, sharp: 0.6 });
      shell(R * 0.86, R * 1.26, S * 1.05, rim);
      const gm = glowMat(T, 0x9b5cff, 2.4, { transparent: true, opacity: 0.7, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.3, gm.m).material.blending = T.AdditiveBlending;
      const wisps = [];
      for (let i = 0; i < 7; i++) {
        const wm = glowMat(T, 0x8a3cff, 2.0, { transparent: true, opacity: 0.6, depthWrite: false });
        const w = part(T, g, new T.TorusGeometry(R * (0.55 + (i % 3) * 0.2), S * 0.006, 6, 40, Math.PI * 1.2), wm.m, { emissive: wm.want.emissive, ei: 2.0, opacity: 0.3, depthWrite: false }, 'wisp');
        soft(w); fxAdd(T, w, 0.3); wisps.push(w);
      }
      const lc = new T.Color(0x9b5cff);
      auraDriver(T, g, (m, t) => {
        smoke.uniforms.t.value = t; rim.uniforms.t.value = t;
        for (let i = 0; i < wisps.length; i++) { wisps[i].position.y = S * (0.1 + ((t * 0.28 + i / wisps.length) % 1) * 0.95); wisps[i].rotation.set(Math.PI / 2, t * (0.5 + i * 0.13), 0); }
        light.color.copy(lc); light.intensity = 1.2 + Math.sin(t * 1.7) * 0.3;
      });
    } else if (kind === 'holy') {
      const glow = flameMat(T, 0xffffff, 0xffe9a8, { int: 0.5, spd: 0.5, sharp: 0.68 });
      shell(R * 0.92, R * 1.05, S * 0.9, glow);
      const beamM = glowMat(T, 0xfff4cf, 2.2, { transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide });
      const shafts = [];
      for (let i = 0; i < 12; i++) {
        const sf = part(T, g, new T.PlaneGeometry(S * 0.032, S * 0.75), beamM.m, { emissive: beamM.want.emissive, ei: 2.2, opacity: 0.22, depthWrite: false }, 'shaft');
        const a = i / 12 * Math.PI * 2; sf.position.set(Math.sin(a) * R * 0.95, S * 0.45, Math.cos(a) * R * 0.95);
        sf.rotation.y = a; soft(sf); fxAdd(T, sf, 0.22); shafts.push(sf);
      }
      const hm2 = glowMat(T, 0xffe9a8, 3.0, { transparent: true, opacity: 0.9, depthWrite: false });
      const halo = part(T, g, new T.TorusGeometry(R * 0.6, S * 0.0075, 8, 60), hm2.m, { emissive: hm2.want.emissive, ei: 3.0, opacity: 0.6, depthWrite: false }, 'halo');
      halo.rotation.x = Math.PI / 2; halo.position.y = S * 1.12; soft(halo); fxAdd(T, halo, 0.6);
      const gm = glowMat(T, 0xffe9a8, 2.2, { transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.3, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0xfff0c8);
      auraDriver(T, g, (m, t) => {
        glow.uniforms.t.value = t;
        for (let i = 0; i < shafts.length; i++) { const k = (t * 0.3 + i / shafts.length) % 1; shafts[i].position.y = S * (0.1 + k * 1.0); shafts[i].scale.y = 0.3 + (1 - k) * 0.9; }
        halo.rotation.z = t * 0.5; halo.position.y = S * (1.12 + Math.sin(t * 1.2) * 0.02);
        light.color.copy(lc); light.intensity = 1.4 + Math.sin(t * 2.6) * 0.3;
      });
    } else if (kind === 'cash') {
      const green = flameMat(T, 0xd8ffe2, 0x16c95a, { int: 0.6, spd: 0.9, sharp: 0.62 });
      shell(R * 0.86, R * 1.1, S * 0.9, green);
      const noteM = mat(T, { color: 0x3ec46d, roughness: 0.6, emissive: 0x0a3a18, emissiveIntensity: 0.6 });
      const notes = [];
      for (let i = 0; i < 10; i++) { const nt = part(T, g, new T.PlaneGeometry(S * 0.07, S * 0.035), noteM, null, 'note'); nt.castShadow = false; notes.push(nt); }
      const gm = glowMat(T, 0x3dff8a, 2.2, { transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide });
      ground(R * 1.25, gm.m).material.blending = T.AdditiveBlending;
      const lc = new T.Color(0x5cffa0);
      auraDriver(T, g, (m, t) => {
        green.uniforms.t.value = t;
        for (let i = 0; i < notes.length; i++) {
          const k = (t * 0.22 + i / notes.length) % 1, a = i * 2.4 + t * 0.7;
          notes[i].position.set(Math.sin(a) * R * 1.0, S * (0.05 + k * 1.1), Math.cos(a) * R * 1.0);
          notes[i].rotation.set(t * 1.6 + i, a, t * 0.9);
        }
        light.color.copy(lc); light.intensity = 1.0 + Math.sin(t * 3.1) * 0.25;
      });
    } else return;
    mount(M, 'root', g, 0, M.minY, 0);
  }

  // ---------------------------------------------------------------- the guard slot (shields)
  // Duane asked for these by name. The argument for them is the whole visibility rule in one
  // object: a shield rides on the back when idle and comes up on a block, so it is on screen for
  // the entire match whether it is being used or not. Gods Unchained has the best shield objects in
  // the category and a one cent floor, because a card game cosmetic is seen by one person.
  //
  // Each one is built from its SILHOUETTE, never as a decorated box: an octagon is an octagon, a
  // manhole is a disc with ribs, a grate has gaps you can see through. That lesson cost two rebuilds
  // on the boot ([[store-render-rig-counterstrike]]) and it is the difference between a shield and a
  // plate with a texture on it. Nothing here carries a combat number; it reskins the existing guard.
  function buildGuard(T, M, kind) {
    const b = M.back; if (!b) return;
    const g = gearGroup(T, 'guard');
    const W = b.coreW, Hh = b.h, D = b.halfD, zb = b.backZ, yMid = b.midY;
    // the plate sits just off the measured back surface, slightly to the carrying side
    // Clamped against the torso's own DEPTH, not only its width. The first run hung four shields
    // 1.3 to 1.8 torso depths off wojak's back, because that body is broad and shallow: the width
    // term won and towed the plate behind the fighter. The same mistake the backpack made in July.
    const clear = Math.min(Math.max(D * 0.09, W * 0.035), D * 0.3);
    const z = zb - clear;
    const R = Math.min(W * 1.55, Hh * 0.86);              // the shield's own radius / half-width
    const steel = mat(T, { color: 0x8d97a6, metalness: 1, roughness: 0.36, envMapIntensity: 1.5 });
    const steelD = mat(T, { color: 0x454c59, metalness: 1, roughness: 0.52, envMapIntensity: 1.1 });
    const zinc = mat(T, { color: 0xa8b0b8, metalness: 0.9, roughness: 0.6, envMapIntensity: 1.2 });
    const iron = mat(T, { color: 0x4a4238, metalness: 0.85, roughness: 0.68, envMapIntensity: 1.0 });
    const ply = mat(T, { color: 0xb08a52, roughness: 0.92 });
    const paintR = mat(T, { color: 0xc0231f, roughness: 0.55 });
    const paintW = mat(T, { color: 0xe8e6e0, roughness: 0.6 });
    const brass = mat(T, { color: 0xb08430, metalness: 1, roughness: 0.3, envMapIntensity: 1.8 });
    const gold = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.18, envMapIntensity: 2.1 });
    const dark = mat(T, { color: 0x1a1d24, roughness: 0.78 });
    const marble = mat(T, { color: 0xd8d4c8, roughness: 0.42, metalness: 0.1 });
    // the one piece of geometry every shield needs: the grip bar on the player's side
    const grip = (m, len) => {
      const h = part(T, g, new T.CylinderGeometry(R * 0.07, R * 0.07, len || R * 0.9, 10), m || steelD, null, 'grip');
      h.position.set(0, yMid, z + R * 0.1);
      h.rotation.z = Math.PI / 2;
      return h;
    };
    // a flat disc of n sides, lying in the fight plane (so it faces the camera edge-on when worn)
    const disc = (sides, rad, thick, m, tag) => {
      const d = part(T, g, new T.CylinderGeometry(rad, rad, thick, sides), m, null, tag || 'plate');
      d.rotation.x = Math.PI / 2;
      d.position.set(0, yMid, z - thick * 0.5);
      return d;
    };
    if (kind === 'dumpster') {
      const p = part(T, g, slab(T, R * 1.9, R * 1.5, R * 0.1, R * 0.12), zinc, null, 'plate');
      p.position.set(0, yMid, z - R * 0.06);
      // the dent: a shallow sphere pressed into the face, which is what stops it reading as a panel
      const dent = part(T, g, new T.SphereGeometry(R * 0.42, 14, 10), zinc, null, 'dent');
      dent.position.set(-R * 0.22, yMid + R * 0.18, z + R * 0.04); dent.scale.set(1, 1, 0.26);
      for (let i = -1; i <= 1; i++) {
        const rib = part(T, g, new T.BoxGeometry(R * 1.86, R * 0.07, R * 0.06), steelD, null, 'rib');
        rib.position.set(0, yMid + i * R * 0.52, z - R * 0.13);
      }
      grip(steelD);
    } else if (kind === 'plyboard') {
      const p = part(T, g, slab(T, R * 1.8, R * 1.6, R * 0.06, R * 0.09), ply, null, 'plate');
      p.position.set(0, yMid, z - R * 0.045);
      // a spray stripe across it, and a splintered corner so the silhouette is not a clean rectangle
      const st = part(T, g, new T.BoxGeometry(R * 1.86, R * 0.26, R * 0.012), paintR, null, 'tag');
      st.position.set(0, yMid - R * 0.1, z - R * 0.1); st.rotation.z = -0.14;
      for (let i = 0; i < 3; i++) {
        const sp = part(T, g, new T.ConeGeometry(R * 0.1, R * 0.26, 3), ply, null, 'splinter');
        sp.position.set(R * (0.72 + i * 0.07), yMid + R * (0.6 - i * 0.18), z - R * 0.045);
        sp.rotation.z = -1.2 - i * 0.3;
      }
      grip(dark);
    } else if (kind === 'stopsign') {
      const p = disc(8, R * 0.95, R * 0.07, paintR);
      p.rotation.y = Math.PI / 8;
      const ring = part(T, g, new T.TorusGeometry(R * 0.78, R * 0.045, 8, 8), paintW, null, 'ring');
      ring.position.set(0, yMid, z - R * 0.1); ring.rotation.z = Math.PI / 8;
      // the pipe it is bolted to: a stop sign on a pole reads instantly at thumbnail size
      // 2.3 R of pole hung the sign 0.51-0.55 torso heights below the chest on pengu and topg,
      // past the 0.45 ceiling the piece declares. A sign on a stub of pole still reads as a sign.
      const pipe = part(T, g, new T.CylinderGeometry(R * 0.09, R * 0.09, R * 1.5, 10), steelD, null, 'pole');
      pipe.position.set(0, yMid - R * 0.08, z + R * 0.06);
      grip(steelD, R * 0.7);
    } else if (kind === 'manhole') {
      disc(28, R * 0.96, R * 0.12, iron);
      for (let i = 0; i < 2; i++) {
        const ring = part(T, g, new T.TorusGeometry(R * (0.82 - i * 0.26), R * 0.04, 8, 26), iron, null, 'ring');
        ring.position.set(0, yMid, z - R * 0.19);
      }
      // raised radial ribs, the detail that makes cast iron read as cast iron
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const rb = part(T, g, new T.BoxGeometry(R * 0.5, R * 0.07, R * 0.05), iron, null, 'rib');
        rb.position.set(Math.cos(a) * R * 0.52, yMid + Math.sin(a) * R * 0.52, z - R * 0.2);
        rb.rotation.z = a;
      }
      grip(steelD, R * 0.8);
    } else if (kind === 'plank') {
      // a GRATE: a frame with gaps you can see through, which costs nothing and looks expensive
      const fr = (w, h, x, y) => { const q = part(T, g, new T.BoxGeometry(w, h, R * 0.1), steelD, null, 'frame'); q.position.set(x, yMid + y, z - R * 0.05); return q; };
      fr(R * 1.8, R * 0.11, 0, R * 0.78); fr(R * 1.8, R * 0.11, 0, -R * 0.78);
      fr(R * 0.11, R * 1.67, -R * 0.85, 0); fr(R * 0.11, R * 1.67, R * 0.85, 0);
      for (let i = 0; i < 7; i++) {
        const s = part(T, g, new T.BoxGeometry(R * 1.7, R * 0.07, R * 0.07), zinc, null, 'slat');
        s.position.set(0, yMid - R * 0.62 + i * R * 0.21, z - R * 0.05);
      }
      grip(steelD);
    } else if (kind === 'cardoor') {
      const p = part(T, g, slab(T, R * 1.55, R * 1.95, R * 0.22, R * 0.14), paintR, null, 'plate');
      p.position.set(0, yMid, z - R * 0.07);
      // the window: a dark inset in the top third, half down, with the glass line above it
      const win = part(T, g, slab(T, R * 1.25, R * 0.56, R * 0.12, R * 0.05), dark, null, 'window');
      win.position.set(0, yMid + R * 0.56, z - R * 0.15);
      const sill = part(T, g, new T.BoxGeometry(R * 1.35, R * 0.08, R * 0.16), steelD, null, 'sill');
      sill.position.set(0, yMid + R * 0.24, z - R * 0.14);
      const mir = part(T, g, new T.BoxGeometry(R * 0.26, R * 0.18, R * 0.12), steelD, null, 'mirror');
      mir.position.set(-R * 0.82, yMid + R * 0.3, z - R * 0.12); mir.rotation.z = 0.3;
      const hand = part(T, g, new T.BoxGeometry(R * 0.4, R * 0.1, R * 0.1), steel, null, 'handle');
      hand.position.set(R * 0.3, yMid - R * 0.08, z - R * 0.19);
      grip(dark);
    } else if (kind === 'riot') {
      // transparency does all the work here. A clear plate with scratches and a stencil reads as
      // polycarbonate; the same plate in grey reads as a lunch tray.
      const glass = new T.MeshStandardMaterial({ color: 0xbcd0dd, metalness: 0.1, roughness: 0.18,
        transparent: true, opacity: 0.34, envMapIntensity: 2.0, side: T.DoubleSide });
      const p = part(T, g, slab(T, R * 1.45, R * 2.0, R * 0.3, R * 0.05), glass, null, 'plate');
      p.position.set(0, yMid, z - R * 0.03);
      for (let i = 0; i < 4; i++) {
        const sc = part(T, g, new T.BoxGeometry(R * (0.5 + i * 0.12), R * 0.018, R * 0.012), paintW, null, 'scratch');
        sc.position.set((i % 2 ? 1 : -1) * R * 0.28, yMid + R * (0.5 - i * 0.34), z - R * 0.07);
        sc.rotation.z = 0.2 - i * 0.14;
      }
      const band = part(T, g, new T.BoxGeometry(R * 1.3, R * 0.2, R * 0.02), dark, null, 'stencil');
      band.position.set(0, yMid - R * 0.5, z - R * 0.07);
      grip(dark);
    } else if (kind === 'table') {
      disc(30, R * 0.92, R * 0.1, marble);
      const rim = part(T, g, new T.TorusGeometry(R * 0.92, R * 0.05, 8, 30), steel, null, 'rim');
      rim.position.set(0, yMid, z - R * 0.05);
      // one chipped edge, so a round top is not a perfect circle
      const chip = part(T, g, new T.SphereGeometry(R * 0.16, 10, 8), dark, null, 'chip');
      chip.position.set(R * 0.86, yMid + R * 0.3, z - R * 0.05); chip.scale.set(1, 1, 0.4);
      const stem = part(T, g, new T.CylinderGeometry(R * 0.1, R * 0.14, R * 0.7, 12), steel, null, 'stem');
      stem.position.set(0, yMid - R * 0.1, z + R * 0.22); stem.rotation.x = Math.PI / 2;
      grip(steelD, R * 0.7);
    } else if (kind === 'ticker') {
      const p = part(T, g, slab(T, R * 2.0, R * 1.2, R * 0.08, R * 0.09), dark, null, 'plate');
      p.position.set(0, yMid, z - R * 0.045);
      // the split flaps: small bright tiles in rows. They are the whole item, so there are enough of
      // them to read as a board and few enough to stay cheap.
      const on = mat(T, { color: 0x27e1ff, emissive: 0x0d6e80, emissiveIntensity: 1, roughness: 0.4 });
      const up = mat(T, { color: 0x3dff8a, emissive: 0x126b35, emissiveIntensity: 1, roughness: 0.4 });
      const dn = mat(T, { color: 0xff2a4a, emissive: 0x6b1020, emissiveIntensity: 1, roughness: 0.4 });
      for (let r0 = 0; r0 < 3; r0++) for (let c = 0; c < 8; c++) {
        const t2 = part(T, g, new T.BoxGeometry(R * 0.18, R * 0.22, R * 0.03), c % 5 === 0 ? up : c % 7 === 0 ? dn : on, null, 'flap');
        // proud of the plate, not flush with it: at R*0.13 against a plate whose front face was at
        // R*0.12 the flaps were invisible and the whole board baked as a black rectangle
        t2.position.set(-R * 0.78 + c * R * 0.224, yMid + R * (0.33 - r0 * 0.33), z - R * 0.145);
      }
      grip(steelD);
    } else if (kind === 'vault') {
      disc(30, R * 0.95, R * 0.2, steel);
      const rim = part(T, g, new T.TorusGeometry(R * 0.9, R * 0.1, 10, 30), steelD, null, 'rim');
      rim.position.set(0, yMid, z - R * 0.12);
      // the wheel: a brass torus with spokes. It spins on a guard, which is the thing being bought.
      const wheel = part(T, g, new T.TorusGeometry(R * 0.42, R * 0.06, 10, 26), brass, null, 'wheel');
      wheel.position.set(0, yMid, z - R * 0.28);
      for (let i = 0; i < 4; i++) {
        const sp = part(T, g, new T.BoxGeometry(R * 0.84, R * 0.07, R * 0.07), brass, null, 'spoke');
        sp.position.set(0, yMid, z - R * 0.28); sp.rotation.z = i * Math.PI / 4;
      }
      const hub = part(T, g, new T.CylinderGeometry(R * 0.12, R * 0.12, R * 0.16, 12), brass, null, 'hub');
      hub.position.set(0, yMid, z - R * 0.32); hub.rotation.x = Math.PI / 2;
      grip(steelD, R * 0.75);
    } else if (kind === 'bullion') {
      // stacked bars, strapped. Real metal roughness, one warm specular, nothing else.
      for (let r0 = 0; r0 < 3; r0++) {
        const n = 3 - r0;
        for (let i = 0; i < n; i++) {
          const bar = part(T, g, slab(T, R * 0.56, R * 0.3, R * 0.06, R * 0.14), gold, null, 'bar');
          bar.position.set((i - (n - 1) / 2) * R * 0.6, yMid - R * 0.55 + r0 * R * 0.36, z - R * (0.08 + r0 * 0.02));
          bar.rotation.z = (i - (n - 1) / 2) * 0.03;
        }
      }
      for (const s of [-1, 1]) {
        const strap = part(T, g, new T.BoxGeometry(R * 0.08, R * 1.3, R * 0.5), dark, null, 'strap');
        strap.position.set(s * R * 0.42, yMid - R * 0.1, z - R * 0.14);
      }
      grip(steelD, R * 0.8);
    } else if (kind === 'desk') {
      // a section of trading floor: a dark panel, two phone blocks and a handset still swinging
      const p = part(T, g, slab(T, R * 2.0, R * 1.3, R * 0.1, R * 0.16), dark, null, 'plate');
      p.position.set(0, yMid, z - R * 0.08);
      const edge = part(T, g, new T.BoxGeometry(R * 2.06, R * 0.12, R * 0.22), brass, null, 'edge');
      edge.position.set(0, yMid + R * 0.64, z - R * 0.1);
      for (const s of [-1, 1]) {
        const ph = part(T, g, slab(T, R * 0.4, R * 0.26, R * 0.06, R * 0.1), steelD, null, 'phone');
        ph.position.set(s * R * 0.62, yMid - R * 0.18, z - R * 0.17);
        const keys = part(T, g, new T.BoxGeometry(R * 0.26, R * 0.14, R * 0.04), mat(T, { color: 0x2b3340, roughness: 0.6 }), null, 'keys');
        keys.position.set(s * R * 0.62, yMid - R * 0.18, z - R * 0.21);
      }
      const hs = part(T, g, new T.CapsuleGeometry ? new T.CapsuleGeometry(R * 0.07, R * 0.3, 4, 8) : new T.CylinderGeometry(R * 0.07, R * 0.07, R * 0.4, 8), dark, null, 'handset');
      hs.position.set(R * 0.9, yMid - R * 0.44, z - R * 0.18); hs.rotation.z = 0.5;
      const cord = part(T, g, new T.TorusGeometry(R * 0.16, R * 0.02, 6, 16, Math.PI * 1.4), dark, null, 'cord');
      cord.position.set(R * 0.8, yMid - R * 0.28, z - R * 0.18); cord.rotation.y = Math.PI / 2;
      grip(brass);
    } else if (kind === 'wheelrim') {
      // an alloy wheel: a tyre lip, a dished face and five spokes out to a rim
      const tyre = part(T, g, new T.TorusGeometry(R * 0.92, R * 0.17, 12, 34), dark, null, 'tyre');
      tyre.position.set(0, yMid, z - R * 0.04);
      disc(26, R * 0.78, R * 0.1, steel);
      for (let i = 0; i < 5; i++) {
        const a2 = (i / 5) * Math.PI * 2;
        const sp = part(T, g, slab(T, R * 0.19, R * 0.62, R * 0.06, R * 0.08), steel, null, 'spoke');
        sp.position.set(Math.cos(a2) * R * 0.36, yMid + Math.sin(a2) * R * 0.36, z - R * 0.12);
        sp.rotation.z = a2 - Math.PI / 2;
      }
      const hub = part(T, g, new T.CylinderGeometry(R * 0.2, R * 0.2, R * 0.14, 14), steelD, null, 'hub');
      hub.position.set(0, yMid, z - R * 0.16); hub.rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const a2 = (i / 5) * Math.PI * 2 + 0.6;
        const nut = part(T, g, new T.CylinderGeometry(R * 0.045, R * 0.045, R * 0.06, 6), brass, null, 'nut');
        nut.position.set(Math.cos(a2) * R * 0.13, yMid + Math.sin(a2) * R * 0.13, z - R * 0.21);
        nut.rotation.x = Math.PI / 2;
      }
      grip(steelD, R * 0.8);
    } else if (kind === 'oildrum') {
      // a drum lid: a shallow disc with a rolled rim and a bung off centre
      disc(30, R * 0.9, R * 0.14, mat(T, { color: 0x2f6a4a, metalness: 0.85, roughness: 0.55, envMapIntensity: 1.2 }));
      const roll = part(T, g, new T.TorusGeometry(R * 0.9, R * 0.08, 10, 32), steelD, null, 'rim');
      roll.position.set(0, yMid, z - R * 0.08);
      for (let i = 0; i < 2; i++) {
        const ring = part(T, g, new T.TorusGeometry(R * (0.6 - i * 0.22), R * 0.035, 8, 28), steelD, null, 'ring');
        ring.position.set(0, yMid, z - R * 0.15);
      }
      const bung = part(T, g, new T.CylinderGeometry(R * 0.13, R * 0.13, R * 0.1, 12), brass, null, 'bung');
      bung.position.set(R * 0.42, yMid + R * 0.3, z - R * 0.18); bung.rotation.x = Math.PI / 2;
      grip(steelD, R * 0.8);
    } else if (kind === 'firedoor') {
      // a tall steel door: a push bar across it and a small wired window near the top
      const p = part(T, g, slab(T, R * 1.5, R * 2.05, R * 0.14, R * 0.14), mat(T, { color: 0x9c3a2a, roughness: 0.6, metalness: 0.5 }), null, 'plate');
      p.position.set(0, yMid, z - R * 0.07);
      const win = part(T, g, slab(T, R * 0.72, R * 0.5, R * 0.08, R * 0.04), dark, null, 'window');
      win.position.set(0, yMid + R * 0.74, z - R * 0.15);
      for (let i = 0; i < 4; i++) {
        const wire = part(T, g, new T.BoxGeometry(R * 0.72, R * 0.015, R * 0.015), steelD, null, 'wire');
        wire.position.set(0, yMid + R * (0.58 + i * 0.1), z - R * 0.17);
      }
      const bar = part(T, g, new T.CylinderGeometry(R * 0.07, R * 0.07, R * 1.26, 10), steel, null, 'pushbar');
      bar.position.set(0, yMid - R * 0.18, z - R * 0.2); bar.rotation.z = Math.PI / 2;
      for (const sx of [-1, 1]) {
        const br = part(T, g, new T.BoxGeometry(R * 0.08, R * 0.1, R * 0.2), steelD, null, 'bracket');
        br.position.set(sx * R * 0.52, yMid - R * 0.18, z - R * 0.16);
      }
      grip(dark);
    } else if (kind === 'grill') {
      // a round grate: parallel bars with gaps you can see through, inside a hoop
      const hoop = part(T, g, new T.TorusGeometry(R * 0.88, R * 0.06, 10, 34), steelD, null, 'hoop');
      hoop.position.set(0, yMid, z - R * 0.06);
      for (let i = -5; i <= 5; i++) {
        const t2 = Math.abs(i) / 5.5;
        const half = Math.sqrt(Math.max(0, 1 - t2 * t2)) * R * 0.86;
        const barG = part(T, g, new T.CylinderGeometry(R * 0.035, R * 0.035, half * 2, 8), zinc, null, 'bar');
        barG.position.set(0, yMid + i * R * 0.155, z - R * 0.06);
        barG.rotation.z = Math.PI / 2;
      }
      const handle = part(T, g, new T.TorusGeometry(R * 0.16, R * 0.04, 8, 16, Math.PI), steel, null, 'handle');
      handle.position.set(0, yMid + R * 0.9, z - R * 0.06);
      grip(steelD, R * 0.75);
    } else if (kind === 'sign') {
      // a street sign on a post: the most readable silhouette on the shelf at thumbnail size
      const blade = part(T, g, slab(T, R * 1.9, R * 0.52, R * 0.05, R * 0.06), mat(T, { color: 0x1f6b43, roughness: 0.45, metalness: 0.4 }), null, 'plate');
      blade.position.set(0, yMid + R * 0.35, z - R * 0.03);
      const edge = part(T, g, slab(T, R * 1.78, R * 0.4, R * 0.04, R * 0.012), paintW, null, 'edge');
      edge.position.set(0, yMid + R * 0.35, z - R * 0.08);
      for (let i = 0; i < 5; i++) {
        const ch = part(T, g, new T.BoxGeometry(R * 0.14, R * 0.2, R * 0.012), paintW, null, 'letter');
        ch.position.set(-R * 0.56 + i * R * 0.28, yMid + R * 0.35, z - R * 0.09);
      }
      const post = part(T, g, new T.CylinderGeometry(R * 0.075, R * 0.075, R * 1.8, 10), steelD, null, 'post');
      post.position.set(0, yMid - R * 0.3, z - R * 0.02);
      grip(steelD, R * 0.7);
    } else if (kind === 'dish') {
      // a parabola: built as a ring of segments so it is a DISH and not a flat plate
      const shell = new T.SphereGeometry(R * 1.05, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.42);
      const d2 = part(T, g, shell, mat(T, { color: 0xd8d4c8, roughness: 0.5, metalness: 0.35 }), null, 'dish');
      d2.position.set(0, yMid, z + R * 0.3); d2.rotation.x = -Math.PI / 2;
      const lip = part(T, g, new T.TorusGeometry(R * 0.86, R * 0.04, 8, 32), steelD, null, 'lip');
      lip.position.set(0, yMid, z - R * 0.28);
      const arm = part(T, g, new T.CylinderGeometry(R * 0.035, R * 0.035, R * 0.8, 8), steelD, null, 'arm');
      arm.position.set(0, yMid - R * 0.1, z - R * 0.5); arm.rotation.x = 0.4;
      const horn = part(T, g, new T.ConeGeometry(R * 0.11, R * 0.2, 12), steel, null, 'horn');
      horn.position.set(0, yMid + R * 0.22, z - R * 0.66); horn.rotation.x = -Math.PI / 2;
      grip(steelD, R * 0.75);
    } else if (kind === 'pallet') {
      // slats with gaps, which is the whole look, plus three bearers behind them
      for (let i = 0; i < 5; i++) {
        const sl = part(T, g, slab(T, R * 1.8, R * 0.26, R * 0.03, R * 0.07), ply, null, 'slat');
        sl.position.set(0, yMid - R * 0.72 + i * R * 0.36, z - R * 0.04);
      }
      for (let i = -1; i <= 1; i++) {
        const bearer = part(T, g, new T.BoxGeometry(R * 0.2, R * 1.8, R * 0.14), mat(T, { color: 0x8a6a42, roughness: 0.92 }), null, 'bearer');
        bearer.position.set(i * R * 0.74, yMid, z + R * 0.06);
      }
      for (let i = 0; i < 6; i++) {
        const nail = part(T, g, new T.CylinderGeometry(R * 0.022, R * 0.022, R * 0.05, 6), steelD, null, 'nail');
        nail.position.set((i % 2 ? 1 : -1) * R * 0.74, yMid - R * 0.6 + Math.floor(i / 2) * R * 0.6, z - R * 0.1);
        nail.rotation.x = Math.PI / 2;
      }
      grip(dark);
    } else if (kind === 'screens') {
      // a wall of monitors, every one of them lit. The Floor's top piece.
      const frame2 = part(T, g, slab(T, R * 1.95, R * 1.45, R * 0.06, R * 0.1), dark, null, 'frame');
      frame2.position.set(0, yMid, z - R * 0.05);
      const tints = ['#3dff8a', '#ff2a4a', '#27e1ff', '#ffc83a'];
      for (let r0 = 0; r0 < 3; r0++) for (let c = 0; c < 4; c++) {
        const col = tints[(r0 * 4 + c) % tints.length];
        const m2 = mat(T, { color: 0x05070b, emissive: new T.Color(col).multiplyScalar(0.5), emissiveIntensity: 1, roughness: 0.35, metalness: 0.2 });
        const sc = part(T, g, slab(T, R * 0.42, R * 0.4, R * 0.03, R * 0.03), m2, null, 'screen');
        sc.position.set(-R * 0.69 + c * R * 0.46, yMid + R * (0.45 - r0 * 0.45), z - R * 0.12);
      }
      const bez = part(T, g, new T.TorusGeometry(R * 1.0, R * 0.05, 8, 4), brass, null, 'bezel');
      bez.position.set(0, yMid, z - R * 0.05); bez.rotation.z = Math.PI / 4;
      grip(brass);
    } else if (kind === 'hubcap') {
      // a domed chrome cap with vanes: all specular, no texture
      const chrome2 = mat(T, { color: 0xdfe6ef, metalness: 1, roughness: 0.09, envMapIntensity: 2.6 });
      const dome = part(T, g, new T.SphereGeometry(R * 0.9, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.4), chrome2, null, 'dome');
      dome.position.set(0, yMid, z + R * 0.18); dome.rotation.x = -Math.PI / 2;
      const lip2 = part(T, g, new T.TorusGeometry(R * 0.88, R * 0.07, 10, 32), steel, null, 'lip');
      lip2.position.set(0, yMid, z - R * 0.08);
      for (let i = 0; i < 8; i++) {
        const a3 = (i / 8) * Math.PI * 2;
        const vane = part(T, g, slab(T, R * 0.12, R * 0.5, R * 0.05, R * 0.05), steelD, null, 'vane');
        vane.position.set(Math.cos(a3) * R * 0.45, yMid + Math.sin(a3) * R * 0.45, z - R * 0.16);
        vane.rotation.z = a3;
      }
      grip(steelD, R * 0.8);
    } else if (kind === 'cellar') {
      // two angled leaves, which is the only shield here that is not one flat face
      for (const sx of [-1, 1]) {
        const leaf = part(T, g, slab(T, R * 0.92, R * 1.8, R * 0.1, R * 0.12), mat(T, { color: 0x4a5a44, roughness: 0.7, metalness: 0.45 }), null, 'leaf');
        leaf.position.set(sx * R * 0.48, yMid, z - R * 0.06 - Math.abs(sx) * R * 0.04);
        leaf.rotation.y = sx * 0.22;
      }
      const hinge = part(T, g, new T.CylinderGeometry(R * 0.06, R * 0.06, R * 1.8, 8), steelD, null, 'hinge');
      hinge.position.set(0, yMid, z - R * 0.14);
      for (const sx of [-1, 1]) {
        const hd = part(T, g, new T.TorusGeometry(R * 0.14, R * 0.045, 8, 16, Math.PI), steel, null, 'handle');
        hd.position.set(sx * R * 0.6, yMid - R * 0.4, z - R * 0.16);
      }
      grip(dark);
    } else if (kind === 'jukebox') {
      // an arched lit front: the arch is the silhouette
      const body2 = part(T, g, slab(T, R * 1.5, R * 1.5, R * 0.3, R * 0.14), mat(T, { color: 0x6a2420, roughness: 0.4, metalness: 0.3 }), null, 'plate');
      body2.position.set(0, yMid - R * 0.2, z - R * 0.07);
      const arch = part(T, g, new T.CylinderGeometry(R * 0.76, R * 0.76, R * 0.26, 24, 1, false, 0, Math.PI), mat(T, { color: 0x6a2420, roughness: 0.4, metalness: 0.3 }), null, 'arch');
      arch.position.set(0, yMid + R * 0.55, z - R * 0.07); arch.rotation.x = Math.PI / 2;
      const glow2 = mat(T, { color: 0x1a0d16, emissive: new T.Color(0xff5fa8).multiplyScalar(0.55), emissiveIntensity: 1, roughness: 0.3 });
      const win2 = part(T, g, new T.CylinderGeometry(R * 0.6, R * 0.6, R * 0.1, 24, 1, false, 0, Math.PI), glow2, null, 'light');
      win2.position.set(0, yMid + R * 0.55, z - R * 0.2); win2.rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const key2 = part(T, g, new T.BoxGeometry(R * 0.2, R * 0.12, R * 0.06), brass, null, 'key');
        key2.position.set(-R * 0.5 + i * R * 0.25, yMid - R * 0.5, z - R * 0.2);
      }
      grip(brass);
    } else if (kind === 'gymlocker') {
      // a tall vented door with a padlock on it
      const p2 = part(T, g, slab(T, R * 1.2, R * 2.05, R * 0.08, R * 0.12), mat(T, { color: 0x2a5f8a, roughness: 0.52, metalness: 0.5 }), null, 'plate');
      p2.position.set(0, yMid, z - R * 0.06);
      for (let i = 0; i < 6; i++) {
        const sl2 = part(T, g, new T.BoxGeometry(R * 0.86, R * 0.05, R * 0.1), steelD, null, 'vent');
        sl2.position.set(0, yMid + R * (0.86 - i * 0.12), z - R * 0.13);
        sl2.rotation.x = 0.4;
      }
      const hdl = part(T, g, slab(T, R * 0.16, R * 0.5, R * 0.05, R * 0.08), steel, null, 'handle');
      hdl.position.set(R * 0.42, yMid - R * 0.15, z - R * 0.15);
      const lock = part(T, g, slab(T, R * 0.2, R * 0.24, R * 0.06, R * 0.08), brass, null, 'lock');
      lock.position.set(R * 0.42, yMid - R * 0.55, z - R * 0.17);
      const sh2 = part(T, g, new T.TorusGeometry(R * 0.1, R * 0.03, 8, 14, Math.PI), steel, null, 'shackle');
      sh2.position.set(R * 0.42, yMid - R * 0.42, z - R * 0.17);
      grip(dark);
    } else if (kind === 'pizzapan') {
      // a shallow pan: a disc, a rolled edge and burnt-on rings
      disc(30, R * 0.92, R * 0.07, mat(T, { color: 0x8d8275, metalness: 0.9, roughness: 0.62 }));
      const edge2 = part(T, g, new T.TorusGeometry(R * 0.92, R * 0.06, 10, 32), mat(T, { color: 0x6a6054, metalness: 0.9, roughness: 0.7 }), null, 'rim');
      edge2.position.set(0, yMid, z - R * 0.05);
      for (let i = 0; i < 3; i++) {
        const ring2 = part(T, g, new T.TorusGeometry(R * (0.7 - i * 0.22), R * 0.025, 8, 28), mat(T, { color: 0x4a3a2a, roughness: 0.9 }), null, 'burn');
        ring2.position.set(0, yMid, z - R * 0.1);
      }
      grip(steelD, R * 0.8);
    } else if (kind === 'sash') {
      // a window: six panes of glass in a frame, and you can see through all of them
      const glass2 = new T.MeshStandardMaterial({ color: 0xaecbdd, metalness: 0.1, roughness: 0.12,
        transparent: true, opacity: 0.3, envMapIntensity: 2.2, side: T.DoubleSide });
      for (let r0 = 0; r0 < 3; r0++) for (let c = 0; c < 2; c++) {
        const pane = part(T, g, slab(T, R * 0.62, R * 0.52, R * 0.04, R * 0.02), glass2, null, 'pane');
        pane.position.set(-R * 0.36 + c * R * 0.72, yMid + R * (0.62 - r0 * 0.62), z - R * 0.06);
      }
      const fr3 = (w, h, x, y) => { const q = part(T, g, new T.BoxGeometry(w, h, R * 0.12), mat(T, { color: 0xd8d2c4, roughness: 0.75 }), null, 'frame'); q.position.set(x, yMid + y, z - R * 0.05); };
      fr3(R * 1.6, R * 0.1, 0, R * 0.95); fr3(R * 1.6, R * 0.1, 0, -R * 0.95);
      fr3(R * 1.6, R * 0.08, 0, R * 0.31); fr3(R * 1.6, R * 0.08, 0, -R * 0.31);
      fr3(R * 0.1, R * 2.0, -R * 0.78, 0); fr3(R * 0.1, R * 2.0, R * 0.78, 0); fr3(R * 0.08, R * 2.0, 0, 0);
      grip(dark);
    } else if (kind === 'crate') {
      // a crate lid: planks with a stencilled band across them
      for (let i = 0; i < 4; i++) {
        const pl = part(T, g, slab(T, R * 1.8, R * 0.4, R * 0.03, R * 0.08), ply, null, 'plank');
        pl.position.set(0, yMid - R * 0.66 + i * R * 0.44, z - R * 0.04);
      }
      for (const sx of [-1, 1]) {
        const batten = part(T, g, new T.BoxGeometry(R * 0.16, R * 1.8, R * 0.1), mat(T, { color: 0x8a6a42, roughness: 0.9 }), null, 'batten');
        batten.position.set(sx * R * 0.74, yMid, z - R * 0.1);
      }
      const stencil = part(T, g, new T.BoxGeometry(R * 1.1, R * 0.26, R * 0.012), dark, null, 'stencil');
      stencil.position.set(0, yMid + R * 0.1, z - R * 0.1);
      grip(dark);
    } else if (kind === 'boiler') {
      // a riveted plate with a pressure gauge, which is the one detail that makes it read
      const p3 = part(T, g, slab(T, R * 1.7, R * 1.5, R * 0.2, R * 0.14), mat(T, { color: 0x7a5a3a, metalness: 0.95, roughness: 0.52, envMapIntensity: 1.5 }), null, 'plate');
      p3.position.set(0, yMid, z - R * 0.07);
      for (let i = 0; i < 16; i++) {
        const a3 = (i / 16) * Math.PI * 2;
        const riv = part(T, g, new T.SphereGeometry(R * 0.05, 8, 6), brass, null, 'rivet');
        riv.position.set(Math.cos(a3) * R * 0.74, yMid + Math.sin(a3) * R * 0.64, z - R * 0.15);
      }
      const gauge = part(T, g, new T.CylinderGeometry(R * 0.26, R * 0.26, R * 0.08, 20), mat(T, { color: 0xe8e2d4, roughness: 0.4 }), null, 'gauge');
      gauge.position.set(R * 0.3, yMid + R * 0.2, z - R * 0.19); gauge.rotation.x = Math.PI / 2;
      const needle = part(T, g, new T.BoxGeometry(R * 0.02, R * 0.2, R * 0.02), mat(T, { color: 0xd02a2a, roughness: 0.5 }), null, 'needle');
      needle.position.set(R * 0.3, yMid + R * 0.28, z - R * 0.23); needle.rotation.z = 0.7;
      grip(brass);
    } else if (kind === 'turnstile') {
      // three arms off a hub: the only shield on the shelf that is mostly empty space
      const hub2 = part(T, g, new T.CylinderGeometry(R * 0.3, R * 0.3, R * 0.34, 16), steel, null, 'hub');
      hub2.position.set(0, yMid + R * 0.2, z - R * 0.1); hub2.rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const a3 = (i / 3) * Math.PI * 2 + 0.4;
        // 1.7 R of arm meant one arm always pointed straight down and hung past the chest on ten
        // bodies. Shorter arms on a raised hub keep the three-spoke silhouette and stay in the box.
        const arm2 = part(T, g, new T.CylinderGeometry(R * 0.08, R * 0.08, R * 1.15, 10), steel, null, 'arm');
        arm2.position.set(Math.cos(a3) * R * 0.6, yMid + R * 0.2 + Math.sin(a3) * R * 0.6, z - R * 0.1);
        arm2.rotation.z = a3 + Math.PI / 2;
        const cap2 = part(T, g, new T.SphereGeometry(R * 0.1, 10, 8), steelD, null, 'cap');
        cap2.position.set(Math.cos(a3) * R * 1.15, yMid + R * 0.2 + Math.sin(a3) * R * 1.15, z - R * 0.1);
      }
      grip(steelD, R * 0.7);
    } else if (kind === 'score') {
      // a scoreboard: two big lit digits and a row of lamps
      const p4 = part(T, g, slab(T, R * 1.95, R * 1.3, R * 0.08, R * 0.12), dark, null, 'plate');
      p4.position.set(0, yMid, z - R * 0.06);
      const lamp = (hex, x, y, w, h) => {
        const m2 = mat(T, { color: 0x05070b, emissive: new T.Color(hex).multiplyScalar(0.6), emissiveIntensity: 1, roughness: 0.3 });
        const q = part(T, g, new T.BoxGeometry(w, h, R * 0.03), m2, null, 'seg');
        q.position.set(x, yMid + y, z - R * 0.13);
      };
      // two seven-segment-ish digits
      for (const sx of [-1, 1]) {
        const x0 = sx * R * 0.5;
        lamp('#ff2a4a', x0, R * 0.46, R * 0.44, R * 0.07);
        lamp('#ff2a4a', x0, R * 0.06, R * 0.44, R * 0.07);
        lamp('#ff2a4a', x0, -R * 0.34, R * 0.44, R * 0.07);
        lamp('#ff2a4a', x0 - R * 0.23, R * 0.26, R * 0.07, R * 0.34);
        lamp('#ff2a4a', x0 + R * 0.23, R * 0.26, R * 0.07, R * 0.34);
        lamp('#ff2a4a', x0 - R * 0.23, -R * 0.14, R * 0.07, R * 0.34);
        lamp('#ff2a4a', x0 + R * 0.23, -R * 0.14, R * 0.07, R * 0.34);
      }
      for (let i = 0; i < 7; i++) lamp(i % 2 ? '#ffc83a' : '#3dff8a', -R * 0.72 + i * R * 0.24, -R * 0.56, R * 0.1, R * 0.1);
      grip(steelD);
    } else { return; }
    // THE LINE THAT MAKES IT EXIST. A gear group is built in local space and is an orphan until
    // `mount()` parents it to the measured attachment frame -- the first run of this slot scored
    // 0/1248 with "nothing built" on every body for exactly this reason, because the group was
    // fully modelled and never attached to anything.
    mount(M, 'back', g, 0, 0, 0);
  }

  // ---------------------------------------------------------------- the charm slot
  // 2 to 4 cm of geometry on a short chain, hung off the hand. In CS2 these run from $0.12 to $106,
  // they are the newest category in that game and they sell to the player who will never spend
  // $14.99. One hand only, like the watch: a charm on both hands reads as a bug, not a flex.
  function buildCharm(T, M, kind) {
    for (const h of M.hands || []) {
      if (h.key !== 'handR') continue;
      const g = gearGroup(T, 'charm'); g.userData.cfHand = h.key;
      const L = h.len, rx0 = h.halfW, ry0 = h.halfT;
      // 0.9 made the object a speck hanging off a chain that was longer than it was. The span rule
      // measures the OBJECT, and at 1.25 every piece still clears its ceiling by a wide margin.
      const S0 = Math.min(rx0, ry0) * 1.25;               // the charm's own size, off the hand
      const steel = mat(T, { color: 0x9aa4b2, metalness: 1, roughness: 0.3, envMapIntensity: 1.6 });
      const steelD = mat(T, { color: 0x4a5160, metalness: 1, roughness: 0.46, envMapIntensity: 1.2 });
      const gold = mat(T, { color: 0xffc83d, metalness: 1, roughness: 0.18, envMapIntensity: 2.1 });
      const brass = mat(T, { color: 0xb08430, metalness: 1, roughness: 0.3, envMapIntensity: 1.8 });
      const dark = mat(T, { color: 0x1a1d24, roughness: 0.75 });
      const red = mat(T, { color: 0xc0231f, roughness: 0.5 });
      const white = mat(T, { color: 0xe8e6e0, roughness: 0.62 });
      const paper = mat(T, { color: 0xcfd6c2, roughness: 0.9 });
      // Where it hangs from: clear of the hand, below and outboard of it. The first run buried 28%
      // to 57% of the charm INSIDE the paw on floki and three others -- the drop was measured off
      // the hand's thickness (`halfT`), which on a flat paw is small, while the thing it has to
      // clear is the paw's WIDTH. Clearing the larger of the two is what fixed it.
      const clearH = Math.max(ry0, rx0 * 0.7);
      const ax = h.cx + rx0 * 0.34, ay = h.cy - clearH * 1.75, az = h.wristZ + L * 0.2;
      // the chain: three small links, which is what makes it read as hung rather than glued on
      for (let i = 0; i < 3; i++) {
        const lk2 = part(T, g, new T.TorusGeometry(S0 * 0.17, S0 * 0.05, 6, 12), steelD, null, 'link');
        lk2.position.set(ax, ay + S0 * (0.55 - i * 0.32), az);
        lk2.rotation.y = i % 2 ? Math.PI / 2 : 0;
      }
      const y0 = ay - S0 * 0.55;
      const put = (mesh) => { mesh.position.set(ax, y0 - S0 * 0.3, az); return mesh; };
      if (kind === 'salt') {
        put(part(T, g, slab(T, S0 * 0.5, S0 * 0.62, S0 * 0.1, S0 * 0.14), white, null, 'sachet'));
        const seam = part(T, g, new T.BoxGeometry(S0 * 0.56, S0 * 0.08, S0 * 0.16), paper, null, 'seam');
        seam.position.set(ax, y0 + S0 * 0.02, az);
      } else if (kind === 'token') {
        const d = put(part(T, g, new T.CylinderGeometry(S0 * 0.38, S0 * 0.38, S0 * 0.08, 18), brass, null, 'token'));
        d.rotation.x = Math.PI / 2;
        const hole = part(T, g, new T.CylinderGeometry(S0 * 0.11, S0 * 0.11, S0 * 0.12, 10), dark, null, 'hole');
        hole.position.set(ax, y0 - S0 * 0.3, az); hole.rotation.x = Math.PI / 2;
      } else if (kind === 'dice') {
        for (let i = 0; i < 2; i++) {
          const d = part(T, g, slab(T, S0 * 0.3, S0 * 0.3, S0 * 0.08, S0 * 0.3), red, null, 'die');
          d.position.set(ax + (i ? S0 * 0.34 : -S0 * 0.06), y0 - S0 * (i ? 0.46 : 0.26), az);
          d.rotation.set(0.4 * i, 0.3, 0.5 * i);
        }
      } else if (kind === 'padlock') {
        put(part(T, g, slab(T, S0 * 0.44, S0 * 0.5, S0 * 0.1, S0 * 0.16), brass, null, 'body'));
        const sh = part(T, g, new T.TorusGeometry(S0 * 0.2, S0 * 0.06, 8, 16, Math.PI), steel, null, 'shackle');
        sh.position.set(ax, y0 + S0 * 0.02, az);
      } else if (kind === 'lighter') {
        put(part(T, g, slab(T, S0 * 0.3, S0 * 0.56, S0 * 0.06, S0 * 0.14), steel, null, 'body'));
        const lid = part(T, g, new T.BoxGeometry(S0 * 0.32, S0 * 0.16, S0 * 0.3), steelD, null, 'lid');
        lid.position.set(ax, y0 + S0 * 0.02, az); lid.rotation.z = 0.25;
      } else if (kind === 'pager') {
        put(part(T, g, slab(T, S0 * 0.46, S0 * 0.34, S0 * 0.06, S0 * 0.14), dark, null, 'body'));
        const scr = part(T, g, new T.BoxGeometry(S0 * 0.3, S0 * 0.14, S0 * 0.04), mat(T, { color: 0x3dff8a, emissive: 0x0f5c2c, emissiveIntensity: 1, roughness: 0.4 }), null, 'screen');
        scr.position.set(ax, y0 - S0 * 0.22, az - S0 * 0.16);
      } else if (kind === 'sneaker') {
        // a shoe is a PROFILE, not a box. The same lesson as the boot in the store rig.
        const sole = part(T, g, slab(T, S0 * 0.56, S0 * 0.16, S0 * 0.08, S0 * 0.18), white, null, 'sole');
        sole.position.set(ax, y0 - S0 * 0.52, az);
        const up2 = part(T, g, slab(T, S0 * 0.42, S0 * 0.26, S0 * 0.1, S0 * 0.18), red, null, 'upper');
        up2.position.set(ax - S0 * 0.04, y0 - S0 * 0.32, az);
        for (let i = 0; i < 3; i++) {
          const lace = part(T, g, new T.BoxGeometry(S0 * 0.22, S0 * 0.03, S0 * 0.2), white, null, 'lace');
          lace.position.set(ax - S0 * 0.1, y0 - S0 * (0.24 + i * 0.07), az);
        }
      } else if (kind === 'boombox') {
        put(part(T, g, slab(T, S0 * 0.62, S0 * 0.38, S0 * 0.06, S0 * 0.18), dark, null, 'body'));
        for (const s of [-1, 1]) {
          const sp = part(T, g, new T.CylinderGeometry(S0 * 0.12, S0 * 0.12, S0 * 0.06, 12), steelD, null, 'speaker');
          sp.position.set(ax + s * S0 * 0.19, y0 - S0 * 0.3, az - S0 * 0.19); sp.rotation.x = Math.PI / 2;
        }
        const hand2 = part(T, g, new T.TorusGeometry(S0 * 0.16, S0 * 0.03, 6, 14, Math.PI), steel, null, 'handle');
        hand2.position.set(ax, y0 - S0 * 0.12, az);
      } else if (kind === 'plane') {
        // a folded note: two angled planes, so the silhouette is a dart and not a card
        for (const s of [-1, 1]) {
          const wing = part(T, g, new T.ConeGeometry(S0 * 0.26, S0 * 0.62, 3), paper, null, 'wing');
          wing.position.set(ax + s * S0 * 0.12, y0 - S0 * 0.34, az);
          wing.rotation.set(Math.PI / 2, 0, s * 0.3);
        }
      } else if (kind === 'tooth') {
        const t2 = put(part(T, g, slab(T, S0 * 0.3, S0 * 0.34, S0 * 0.1, S0 * 0.2), gold, null, 'tooth'));
        for (const s of [-1, 1]) {
          const root = part(T, g, new T.ConeGeometry(S0 * 0.07, S0 * 0.2, 8), gold, null, 'root');
          root.position.set(ax + s * S0 * 0.1, y0 - S0 * 0.52, az); root.rotation.x = Math.PI;
        }
      } else if (kind === 'crown') {
        const band = part(T, g, new T.CylinderGeometry(S0 * 0.3, S0 * 0.3, S0 * 0.16, 14, 1, true), gold, null, 'band');
        band.position.set(ax, y0 - S0 * 0.34, az);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const pt = part(T, g, new T.ConeGeometry(S0 * 0.07, S0 * 0.2, 6), gold, null, 'point');
          pt.position.set(ax + Math.cos(a) * S0 * 0.28, y0 - S0 * 0.18, az + Math.sin(a) * S0 * 0.28);
        }
      } else if (kind === 'hydrant') {
        put(part(T, g, new T.CylinderGeometry(S0 * 0.22, S0 * 0.26, S0 * 0.5, 12), red, null, 'body'));
        const cap = part(T, g, new T.SphereGeometry(S0 * 0.2, 12, 8), red, null, 'cap');
        cap.position.set(ax, y0 - S0 * 0.06, az);
        for (const s of [-1, 1]) {
          const noz = part(T, g, new T.CylinderGeometry(S0 * 0.08, S0 * 0.08, S0 * 0.16, 8), brass, null, 'nozzle');
          noz.position.set(ax + s * S0 * 0.24, y0 - S0 * 0.3, az); noz.rotation.z = Math.PI / 2;
        }
      } else if (kind === 'knuck') {
        const bar = part(T, g, slab(T, S0 * 0.52, S0 * 0.2, S0 * 0.08, S0 * 0.12), brass, null, 'bar');
        bar.position.set(ax, y0 - S0 * 0.26, az);
        for (let i = 0; i < 4; i++) {
          const ring = part(T, g, new T.TorusGeometry(S0 * 0.11, S0 * 0.035, 6, 14), brass, null, 'hole');
          ring.position.set(ax - S0 * 0.19 + i * S0 * 0.127, y0 - S0 * 0.42, az);
          ring.rotation.x = Math.PI / 2;
        }
      } else if (kind === 'bull') {
        // solid bronze, the one worth having. Body, head, two horns, four stub legs.
        const body = part(T, g, slab(T, S0 * 0.44, S0 * 0.24, S0 * 0.1, S0 * 0.2), brass, null, 'body');
        body.position.set(ax, y0 - S0 * 0.3, az);
        const head = part(T, g, slab(T, S0 * 0.2, S0 * 0.18, S0 * 0.08, S0 * 0.18), brass, null, 'head');
        head.position.set(ax + S0 * 0.28, y0 - S0 * 0.22, az);
        for (const s of [-1, 1]) {
          const horn = part(T, g, new T.ConeGeometry(S0 * 0.04, S0 * 0.16, 6), gold, null, 'horn');
          horn.position.set(ax + S0 * 0.34, y0 - S0 * 0.1, az + s * S0 * 0.08);
          horn.rotation.z = -s * 0.5;
        }
        for (let i = 0; i < 4; i++) {
          const leg = part(T, g, new T.CylinderGeometry(S0 * 0.04, S0 * 0.04, S0 * 0.18, 6), brass, null, 'leg');
          leg.position.set(ax - S0 * 0.12 + (i % 2) * S0 * 0.3, y0 - S0 * 0.5, az + (i < 2 ? -1 : 1) * S0 * 0.07);
        }
      } else { continue; }
      mount(M, h.key, g, 0, 0, 0);
    }
  }

  function buildGear(T, M, lk) {
    // The TF2 rule: the hat declares what it switches off, the renderer obeys it. Without this a cap
    // and a head of hair are two meshes competing for the same skull, which is the clipping everyone
    // has always noticed and nobody can fix by moving either piece.
    // The hide list is a UNION over every piece being worn, not just the hat's, so a conflict between
    // two slots is one line of data in the item rather than a special case in here. Today only the
    // hats declare anything (they switch off the hair): the six locker slots are mutually exclusive,
    // so two pieces competing for the same geometry is not reachable inside a slot.
    const hid = [];
    for (const m of [HAT_META[lk.hat], HANDS_META[lk.hands], BACK_META[lk.back]]) {
      if (m && m.hides) for (const h of m.hides) if (hid.indexOf(h) < 0) hid.push(h);
    }
    const hairOn = lk.hair !== 'none' && hid.indexOf('hair') < 0;
    M.hairOn = hairOn;
    M.hid = hid;
    if (hairOn) buildHair(T, M, lk.hair, lk.haircol);
    if (lk.hat !== 'none') buildHat(T, M, lk.hat, lk.hatcol);
    if (lk.eyes !== 'none' && EYES_UNFIT.indexOf(M.id || lk.base) < 0) buildEyes(T, M, lk.eyes);
    if (lk.neck !== 'none') buildNeck(T, M, lk.neck);
    if (lk.shoes !== 'none') buildShoes(T, M, lk.shoes);
    // Hands and back, added 2026-10-15. Both are no-ops when the body published no frame for them --
    // `M.hands` is empty and `M.back` is null when there was not enough geometry to measure, and
    // nothing is built rather than something being placed on a guess.
    if (lk.hands !== 'none') buildHands(T, M, lk.hands);
    if (lk.back !== 'none') buildBack(T, M, lk.back);
    // Guard and charm, added 2026-10-16. Same contract as the two above: a no-op when the body
    // published no frame to hang them on, rather than a guess placed on nothing.
    if (lk.guard && lk.guard !== 'none') buildGuard(T, M, lk.guard);
    if (lk.charm && lk.charm !== 'none') buildCharm(T, M, lk.charm);
    if (lk.aura !== 'none') buildAura(T, M, lk.aura);
    return M.made;
  }
  function applyLook(lk, root, T, id) {
    lk = sanitize(lk);
    paintBody(root, T, lk, id || lk.base);
    const M = measure(root, T, id || lk.base); if (!M) return null;
    buildGear(T, M, lk);
    return M;
  }

  function lookFor(f) {
    if (!f || !f.slot) return null;
    if (f.slot.customLook) return sanitize(f.slot.customLook);
    if (f.slot.custom && saved) return saved;
    return null;
  }

  window.CustomLook = {
    get: () => saved ? Object.assign({}, saved) : null,
    set(lk) { saved = sanitize(lk); writeSaved(saved); paintEntryPoints(); return Object.assign({}, saved); },
    code: () => (saved ? b64.enc(saved) : ''),
    fromCode(s) { const o = b64.dec(s); return o ? this.set(o) : null; },
    sanitize,
    lookFor,
    // THE ONE FUNCTION THAT ANSWERS "can this body wear this piece". The locker (89_econ.js) asks it
    // before it offers an item, before it equips one and before it renders one, so there is exactly
    // one copy of the Dota rule in the codebase and it is the measured table.
    fitsBody(slot, kind, base) {
      const f = { hat: hatFits, eyes: eyeFits, neck: neckFits, hands: handFits, back: backFits, guard: guardFits, charm: charmFits }[slot];
      if (!f) return true;                       // shoes and auras are not gated: they fit every body
      return !!f(kind, base);
    },
    // Everything the locker is wearing, merged over the saved fighter. The locker wins where both set
    // a slot, because the locker piece is an owned instance with a serial on it and the creator's is
    // a free choice. Anything the body was not measured for is already gone by here.
    withLocker(lk, base) {
      const b = base || (lk && lk.base) || DEF.base;
      let add = null;
      try { add = typeof Econ !== 'undefined' && Econ.lockerLook ? Econ.lockerLook(b) : null; } catch (e) { add = null; }
      return sanitize(Object.assign({}, lk || saved || DEF, add || {}, { base: b }));
    },
    thumb, thumbFor, hudArt, hudTag, dressHero,
    // The locker rides along here, so a piece you opened and put on shows up in a match, in the
    // preview and on the roster tile without any of those three knowing the locker exists.
    apply(id, root, T, f) {
      const lk = lookFor(f);
      if (lk && lk.base === id) applyLook(window.CustomLook.withLocker(lk, id), root, T, id);
    },
    applyLook,
    open: () => openCreator(),
    _pv: () => PV,   // dev inspection
    // dev/gearcheck.mjs drives these: the SAME measure + build path the match and the preview use,
    // minus the body recolour, so a harness can fit one piece at a time and take it off again.
    _dev: {
      lists: { HATS, EYES, HAIR, HAIRCOL, NECK, SHOES, HANDS, BACKS, GUARDS, CHARMS, AURA, TINTS, FINISH },
      // bodies a slot is deliberately suppressed on, so a measuring harness can tell "nothing was built
      // on purpose" apart from "the piece failed to land" — they look identical from outside
      unfit: { eyes: EYES_UNFIT.slice() },
      // the size box and the hide list each hat declares, so the harness enforces the item's own
      // numbers rather than a second copy of them (the Roblox rule and the TF2 rule, in one place)
      hatMeta: HAT_META,
      hatFit: HAT_FIT,
      hatsFor,
      // the same two tables for the slots added 10/15, in the same shape, so one harness covers all three
      meta: { hat: HAT_META, hands: HANDS_META, back: BACK_META, guard: GUARD_META, charm: CHARM_META },
      fit2: { hat: HAT_FIT, hands: HAND_FIT, back: BACK_FIT, eyes: EYES_FIT, neck: NECK_FIT, guard: GUARD_FIT, charm: CHARM_FIT },
      listFor: { hat: hatsFor, hands: handsFor, back: backsFor, eyes: eyesFor, neck: neckFor, guard: guardsFor, charm: charmsFor },
      gated: { eyes: EYES_GATED.slice(), neck: NECK_GATED.slice() },
      // Off, the gate stops filtering: every kind can be fitted and measured on every body, which is the
      // only way a new piece can ever earn a row in HAT_FIT. dev/gearcheck.mjs calls this; the page never does.
      gate(on) { HAT_GATE = !!on; GEAR_GATE = !!on; },
      measure,
      // dev/skinref probe: what colour did the coat detector actually land on? Without this the only
      // way to tell a bad reference from a bad shader mask is to guess.
      skinRef(root, T, id) { const c = skinReference(root, T, id); return c ? { r: +c.r.toFixed(3), g: +c.g.toFixed(3), b: +c.b.toFixed(3) } : null; },
      fit(root, T, lk, id) { const M = measure(root, T, id || (lk && lk.base)); if (!M) return null; buildGear(T, M, sanitize(Object.assign({ base: id }, lk))); return M; },
      // THE RIG PROFILE: which attachment points this body actually published and the numbers each
      // one was measured at. A harness reads this to tell "the body has no frame here, so nothing was
      // built on purpose" from "the piece failed to land" -- they are identical from outside, and
      // without it a correct suppression scores as a failure and a green run reads as broken.
      frames(root, T, id) {
        const M = measure(root, T, id); if (!M) return null;
        const r = { id: id || null, headH: M.H, bodyH: M.S, points: Object.keys(M.ax),
          head: { capY: M.capY, eyeY: M.eyeY, hw: M.hw, hd: M.hd, ew: M.ew },
          neck: { nH: M.nH, nl: M.nl, nw: M.nw, nd: M.nd },
          feet: (M.feet || []).map(f => ({ key: f.key, len: f.len, halfW: f.halfW, soleY: f.soleY })),
          hands: (M.hands || []).map(h => ({ key: h.key, n: h.n, len: h.len, halfW: h.halfW, halfT: h.halfT,
            wristZ: h.wristZ, tipZ: h.tipZ, cx: h.cx, cy: h.cy })),
          back: M.back ? { n: M.back.n, tH: M.back.tH, halfW: M.back.halfW, halfD: M.back.halfD, h: M.back.h,
            coreW: M.back.coreW, backZ: M.back.backZ, frontZ: M.back.frontZ, topY: M.back.topY, botY: M.back.botY, midY: M.back.midY } : null };
        // the frames a piece could be attached to on THIS body, which is what gates the two new slots
        r.canHands = (M.hands || []).length >= 2;
        r.canBack = !!M.back;
        return r;
      },
      strip(M) { for (const g of (M && M.made) || []) if (g.parent) g.parent.remove(g); if (M) M.made = []; },
    },
  };

  // Custom names on the HUD and results: a per-match view of the base fighter, gameplay fields untouched.
  if (typeof Game !== 'undefined' && Game.start) {
    const origStart = Game.start;
    Game.start = function () {
      const r = origStart.apply(this, arguments);
      try {
        for (const f of this.fighters || []) {
          const lk = lookFor(f);
          if (lk && lk.base === f.c.id) f.c = Object.create(f.c, { name: { value: lk.name, enumerable: true }, title: { value: lk.title || f.c.title, enumerable: true } });
        }
      } catch (e) { /* names are cosmetic */ }
      return r;
    };
  }

  // ---------------------------------------------------------------- creator screen
  const css = `
  #scCustom{align-items:stretch;padding:0;background:radial-gradient(60% 70% at 18% 40%,rgba(255,42,74,.22),transparent 62%),radial-gradient(50% 70% at 100% 10%,rgba(39,225,255,.14),transparent 60%),#050507}
  #scCustom .cf{width:100%;min-height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:12px;box-sizing:border-box;
    padding:max(16px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left))}
  #scCustom .cf-top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
  #scCustom .cf-top .row{display:flex;gap:8px;flex-wrap:wrap}
  #scCustom .cf-mid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,460px);gap:16px;min-height:0}
  #scCustom .cf-stage{position:relative;min-height:360px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0));
    box-shadow:inset 0 0 0 1px var(--line);clip-path:polygon(0 0,calc(100% - var(--cut)) 0,100% var(--cut),100% 100%,var(--cut) 100%,0 calc(100% - var(--cut)))}
  #scCustom #cfCanvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
  #scCustom #cfCanvas:active{cursor:grabbing}
  #scCustom #cfFallback{position:absolute;left:50%;bottom:90px;height:70%;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 20px 30px rgba(0,0,0,.6))}
  #scCustom .cf-plate{position:absolute;left:0;bottom:0;display:flex;flex-direction:column;gap:3px;padding:12px 18px 14px;background:linear-gradient(90deg,rgba(5,5,7,.9),rgba(5,5,7,.25));box-shadow:inset 3px 0 0 var(--red);max-width:calc(100% - 20px);pointer-events:none}
  #scCustom .cf-plate b{font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(38px,5vw,70px);line-height:.86;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent;overflow-wrap:anywhere}
  #scCustom .cf-plate span{font-family:var(--display);font-style:italic;font-weight:700;font-size:18px;letter-spacing:.04em;text-transform:uppercase;color:var(--red)}
  #scCustom .cf-plate small{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--muted)}
  #scCustom .cf-hint{position:absolute;right:14px;top:12px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;pointer-events:none}
  #scCustom .cf-msg{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font-family:var(--mono);font-size:12px;color:var(--muted);text-align:center;max-width:80%}
  #scCustom .cf-panel{display:flex;flex-direction:column;gap:16px;overflow-y:auto;min-height:0;padding:4px 6px 4px 2px;touch-action:pan-y;overscroll-behavior:contain}
  #scCustom .cf-grp{display:flex;flex-direction:column;gap:8px}
  #scCustom .cf-lbl{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--red);display:flex;justify-content:space-between;gap:8px}
  #scCustom .cf-lbl em{font-style:normal;color:var(--muted);font-weight:500;letter-spacing:.04em;text-transform:none}
  #scCustom .cf-in{width:100%;box-sizing:border-box;height:46px;padding:0 14px;border:0;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2);color:var(--text);
    font-family:var(--display);font-style:italic;font-weight:900;font-size:24px;letter-spacing:.01em;-webkit-user-select:text;user-select:text;border-radius:0}
  #scCustom .cf-in.sm{font-size:18px;height:40px;font-weight:700}
  #scCustom .cf-in:focus{outline:none;box-shadow:inset 0 0 0 2px var(--cyan)}
  /* X connect: three states in one box -- not connected, waiting for the code, connected */
  #scCustom .cf-xbox{display:flex;flex-direction:column;gap:8px}
  #scCustom .cf-xrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  #scCustom .cf-xrow .cf-at{flex:1;min-width:150px}
  #scCustom .cf-xbtn{height:40px;padding:0 16px;border:0;cursor:pointer;background:var(--cyan,#2fd4ff);color:#04121a;font-family:var(--display);font-weight:900;font-size:13px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
  #scCustom .cf-xbtn.ghost{background:rgba(255,255,255,.07);color:var(--muted);box-shadow:inset 0 0 0 1px var(--line2)}
  #scCustom .cf-xbtn:disabled{opacity:.5;cursor:default}
  #scCustom .cf-xcode{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(47,212,255,.08);box-shadow:inset 0 0 0 1px rgba(47,212,255,.35)}
  #scCustom .cf-xcode b{font-family:var(--mono);font-size:16px;letter-spacing:.08em;color:var(--cyan,#2fd4ff);user-select:all}
  #scCustom .cf-xnote{font-size:12px;line-height:1.5;color:var(--muted)}
  #scCustom .cf-xnote.bad{color:#ff8a7a}
  #scCustom .cf-xdot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--cyan,#2fd4ff);margin-right:7px;vertical-align:middle;animation:cfXPulse 1.4s ease-in-out infinite}
  @keyframes cfXPulse{0%,100%{opacity:.25}50%{opacity:1}}
  @media (prefers-reduced-motion:reduce){#scCustom .cf-xdot{animation:none;opacity:.8}}
  #scCustom .cf-xok{display:flex;align-items:center;gap:10px}
  #scCustom .cf-xok img{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.08)}
  #scCustom .cf-xok b{font-family:var(--mono);font-size:14px;color:var(--cyan,#2fd4ff)}
  #scCustom .cf-xok .tick{color:#6dff8c;font-weight:900}
  #scCustom .cf-at{display:flex;align-items:center;gap:0}
  #scCustom .cf-at span{height:40px;display:flex;align-items:center;padding:0 10px;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2);font-family:var(--display);font-style:italic;font-weight:900;font-size:18px;color:var(--muted)}
  #scCustom .cf-at .cf-in{flex:1}
  #scCustom .cf-plate #cfShowX{color:var(--cyan);font-weight:700}
  #scCustom .cf-chips{display:flex;flex-wrap:wrap;gap:6px}
  #scCustom .cf-chip{min-height:34px;padding:0 12px;border:0;cursor:pointer;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2);color:var(--text);font-size:13px;font-weight:600;
    clip-path:polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%);transition:background .15s}
  #scCustom .cf-chip:hover{background:rgba(255,255,255,.12)}
  #scCustom .cf-chip.on{background:var(--red);box-shadow:none;color:#fff}
  #scCustom .cf-sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:6px}
  #scCustom .cf-sw button{aspect-ratio:1;border:0;cursor:pointer;background:var(--c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px))}
  #scCustom .cf-sw button.orig{background:conic-gradient(from 45deg,#ffc83d,#ff2a4a,#9b5cff,#27e1ff,#8dff3a,#ffc83d)}
  #scCustom .cf-sw button.on{box-shadow:inset 0 0 0 3px #fff,0 0 12px var(--c)}
  #scCustom .cf-bodies{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:5px}
  #scCustom .cf-body{position:relative;aspect-ratio:1;border:0;padding:0;cursor:pointer;background:#0a0b11 no-repeat 50% 8%/180% auto;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);
    clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px));transition:transform .12s}
  #scCustom .cf-body:hover{transform:translateY(-2px)}
  #scCustom .cf-body.on{box-shadow:inset 0 0 0 3px var(--red)}
  #scCustom .cf-body span{position:absolute;left:0;right:0;bottom:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:11px;padding:2px 4px;background:linear-gradient(0deg,rgba(5,5,7,.9),transparent);text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
  #scCustom .cf-foot{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;position:sticky;bottom:0;z-index:3;padding:10px 0 max(4px,env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(5,5,7,0),rgba(5,5,7,.92) 35%)}
  #scCustom .cf-foot .cf-saved{font-family:var(--mono);font-size:12px;color:var(--lime);margin-right:auto;opacity:0;transition:opacity .3s}
  #scCustom .cf-foot .cf-saved.on{opacity:1}
  @media (max-width:820px){
    #scCustom .cf{grid-template-rows:auto auto auto}
    #scCustom .cf-mid{grid-template-columns:1fr;grid-template-rows:min(46vh,420px) auto;min-height:auto}
    #scCustom .cf-stage{min-height:0}
    #scCustom .cf-panel{overflow:visible}
    #scCustom .cf-plate b{font-size:36px}
    #scCustom .cf-foot .btn{flex:1}
  }
  #scSelect .cf-mine{background:linear-gradient(90deg,rgba(255,42,74,.9),rgba(255,106,61,.8));box-shadow:none}
  /* the player's own fighter, first tile in the select grid */
  #roster .cf-pick{position:relative;display:block;padding:0;border:0;cursor:pointer;background:linear-gradient(180deg,#2a1020,#0a0b11);
    box-shadow:inset 0 0 0 2px var(--red),0 0 18px rgba(255,42,74,.35);overflow:hidden;
    clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px));transition:transform .12s}
  #roster .cf-pick:hover{transform:translateY(-3px)}
  /* keyboard/pad highlight, matched to .pick.cur so the grid reads as one list */
  #roster .cf-pick.cf-cur{transform:translateY(-2px);box-shadow:inset 0 0 0 2px #fff,0 0 18px rgba(255,255,255,.5)}
  #roster .cf-pick.on{box-shadow:inset 0 0 0 3px var(--gold),0 0 22px rgba(255,200,61,.45)}
  #roster .cf-pick .face{position:absolute;inset:0;background:#0a0b11 no-repeat 50% 6%/185% auto}
  #roster .cf-pick .face.cf-shot{background-size:contain;background-position:50% 100%}
  #roster .cf-pick .badge{position:absolute;left:0;top:0;z-index:2;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.09em;padding:2px 4px;background:var(--red);color:#fff}
  #roster .cf-pick .nm{position:absolute;left:0;right:0;bottom:0;z-index:2;font-family:var(--display);font-style:italic;font-weight:900;font-size:11px;padding:2px 4px;
    background:linear-gradient(0deg,rgba(5,5,7,.95),transparent);text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;color:#fff}
  #scSelect .hero.cf-hero .art img,#scSelect #heroP1.cf-hero img,#scSelect #heroP2.cf-hero img{object-fit:contain}
  #scSelect .cf-hero .nm{color:var(--red)}
  #scSelect .cf-x{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--cyan);margin-top:2px}
  #scResults .cf-x{font-family:var(--mono);font-size:13px;letter-spacing:.06em;color:var(--cyan);margin-top:4px;text-align:center}
  #slots .slot.cf-slot .nm{color:var(--red)}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const sec = document.createElement('section');
  sec.className = 'screen solid'; sec.id = 'scCustom'; sec.hidden = true;
  const chips = (key, list) => `<div class="cf-chips" data-k="${key}">${list.map(([v, l]) => `<button class="cf-chip" data-v="${v}" id="cf_${key}_${v}">${l}</button>`).join('')}</div>`;
  sec.innerHTML = `<div class="cf">
    <header class="cf-top">
      <div><div class="eyebrow">Your fighter</div><h2 class="h2">Build your fighter</h2></div>
      <div class="row"><button class="btn small" id="cfRandom">Randomise</button><button class="btn small" id="cfBack">Back</button></div>
    </header>
    <div class="cf-mid">
      <div class="cf-stage">
        <canvas id="cfCanvas"></canvas><img id="cfFallback" alt="" hidden><div class="cf-msg" id="cfMsg" hidden></div>
        <div class="cf-hint">Drag to spin</div>
        <div class="cf-plate"><b id="cfShowName"></b><span id="cfShowTitle"></span><small id="cfShowX"></small><small id="cfShowBase"></small></div>
      </div>
      <div class="cf-panel">
        <div class="cf-grp"><div class="cf-lbl">Looks <em>one tap, then adjust anything below</em></div>
          <div class="cf-chips cf-pre" id="cfPresets">${PRESETS.map(([v, l]) => `<button class="cf-chip" data-p="${v}">${esc(l)}</button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">Name <em>up to 16 letters</em></div><input class="cf-in" id="cfName" maxlength="16" autocomplete="off" spellcheck="false"></div>
        <div class="cf-grp"><div class="cf-lbl">Title</div><input class="cf-in sm" id="cfTitle" maxlength="22" autocomplete="off" spellcheck="false">
          <div class="cf-chips" id="cfTitles">${TITLES.map(t => `<button class="cf-chip" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">X / Twitter <em>connect it, so the name over your head is really yours</em></div>
          <div id="cfXBox" class="cf-xbox"></div></div>
        <div class="cf-grp"><div class="cf-lbl">Body <em id="cfBodyNote">moves and stats come from the body</em></div><div class="cf-bodies" id="cfBodies"></div></div>
        <div class="cf-grp"><div class="cf-lbl">Colour</div><div class="cf-sw" data-k="tint">${TINTS.map(([v, l, h]) => `<button class="${v === 'orig' ? 'orig' : ''}" data-v="${v}" id="cf_tint_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">Skin / fur tone</div><div class="cf-sw" data-k="skin">${SKIN.map(([v, l, h]) => `<button class="${v === 'orig' ? 'orig' : ''}" data-v="${v}" id="cf_skin_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        <div class="cf-grp"><div class="cf-lbl">Finish</div>${chips('finish', FINISH)}</div>
        <div class="cf-grp"><div class="cf-lbl">Material <em>painted into the skin, so it fits every body</em></div>${chips('pattern', PATTERN)}</div>
        <div class="cf-grp" id="cfPatColGrp"><div class="cf-lbl">Material colour</div><div class="cf-sw" data-k="patcol">${PATCOL.map(([v, l, h]) => `<button class="${v === 'auto' ? 'orig' : ''}" data-v="${v}" id="cf_patcol_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        ${HAIR.length > 1 ? `<div class="cf-grp"><div class="cf-lbl">Hair</div>${chips('hair', HAIR)}</div>
        <div class="cf-grp"><div class="cf-lbl">Hair colour</div><div class="cf-sw" data-k="haircol">${HAIRCOL.map(([v, l, h]) => `<button data-v="${v}" id="cf_haircol_${v}" title="${l}" aria-label="${l}" style="--c:${h}"></button>`).join('')}</div></div>` : ''}
        <div class="cf-grp" id="cfHatGrp"><div class="cf-lbl">Hat <em>only the ones measured on this body</em></div><div id="cfHatChips"></div></div>
        <div class="cf-grp" id="cfHatColGrp"><div class="cf-lbl">Hat colour</div><div class="cf-sw" data-k="hatcol">${HATCOL.map(([v, l, h]) => `<button class="${v === 'auto' ? 'orig' : ''}" data-v="${v}" id="cf_hatcol_${v}" title="${l}" aria-label="${l}" style="--c:${h || '#fff'}"></button>`).join('')}</div></div>
        <div class="cf-grp" id="cfEyesGrp"><div class="cf-lbl">Eyes</div><div id="cfEyesChips"></div></div>
        <div class="cf-grp" id="cfNeckGrp"><div class="cf-lbl">Neck</div><div id="cfNeckChips"></div></div>
        <div class="cf-grp"><div class="cf-lbl">Shoes</div>${chips('shoes', SHOES)}</div>
        <div class="cf-grp" id="cfHandGrp" hidden><div class="cf-lbl">Hands</div><div id="cfHandChips"></div></div>
        <div class="cf-grp" id="cfBackGrp" hidden><div class="cf-lbl">Back</div><div id="cfBackChips"></div></div>
        <div class="cf-grp"><div class="cf-lbl">Aura</div>${chips('aura', AURA)}</div>
      </div>
    </div>
    <footer class="cf-foot"><span class="cf-saved" id="cfSaved">Saved</span>
      <button class="btn small" id="cfRestore" hidden>Restore last fighter</button>
      <button class="btn small" id="cfExport">Export code</button><button class="btn small" id="cfImport">Import code</button>
      <button class="btn" id="cfSave">Save</button><button class="btn primary" id="cfFight">Save + fight ▶</button></footer>
  </div>`;
  // The creator's screen STAYS IN THE DOM even though every way into it was pulled (see the
  // entry-points note below). Detaching it looked tidy and broke the Store and the Profile outright
  // -- both came back with zero text and zero buttons, and errsweep went from 0 errors to 1, because
  // they are built relative to this node. A hidden, unreachable section costs nothing; the screens
  // the player actually uses cost everything. Left attached on purpose.
  document.body.appendChild(sec);

  let draft = null, backTo = 'scTitle';
  const art = id => 'assets/' + ASSET_ID(id) + '_cut.webp';

  // The hat row is per body, the way Dota only offers a hero the wearables authored for that hero. It is
  // rebuilt whenever the body changes, so a player can never reach a combination that was not measured.
  // Both rows disappear on a body with nothing cleared yet, rather than showing an empty shelf.
  let hatRowFor = null;
  function paintHats() {
    const box = $c('cfHatChips'); if (!box) return;
    const list = hatsFor(draft.base);
    if (hatRowFor !== draft.base) {
      hatRowFor = draft.base;
      box.innerHTML = list.length > 1 ? chips('hat', list) : '';
    }
    const has = list.length > 1;
    { const g = $c('cfHatGrp'); if (g) g.hidden = !has; }
    { const g = $c('cfHatColGrp'); if (g) g.hidden = !has || draft.hat === 'none'; }
  }
  // The hands and back rows follow the same Dota rule and the same two states: a body is offered only
  // what the harness measured clean on it, and the row disappears rather than showing a lone "None".
  const gearRowFor = { hands: null, back: null, eyes: null, neck: null };
  function paintGearRows() {
    for (const [k, box, grp, lister] of [['hands', 'cfHandChips', 'cfHandGrp', handsFor], ['back', 'cfBackChips', 'cfBackGrp', backsFor],
      ['eyes', 'cfEyesChips', 'cfEyesGrp', eyesFor], ['neck', 'cfNeckChips', 'cfNeckGrp', neckFor]]) {
      const el2 = $c(box); if (!el2) continue;
      const list = lister(draft.base);
      if (gearRowFor[k] !== draft.base) { gearRowFor[k] = draft.base; el2.innerHTML = list.length > 1 ? chips(k, list) : ''; }
      const g = $c(grp); if (g) g.hidden = list.length < 2;
    }
  }

  function paintForm() {
    $c('cfName').value = draft.name; $c('cfTitle').value = draft.title;
    paintX();                         // the handle is the server's, not the draft's
    paintHats();                      // the hat row belongs to the BODY, so it is rebuilt before the ticks
    paintGearRows();                  // same for hands and back
    for (const [k] of GROUPS) sec.querySelectorAll(`[data-k="${k}"] [data-v]`).forEach(b => b.classList.toggle('on', b.dataset.v === draft[k]));
    sec.querySelectorAll('#cfTitles .cf-chip').forEach(b => b.classList.toggle('on', b.dataset.t === draft.title));
    sec.querySelectorAll('#cfPresets .cf-chip').forEach(b => {
      const pr = PRESETS.find(x => x[0] === b.dataset.p);
      b.classList.toggle('on', !!pr && Object.keys(pr[2]).every(k => draft[k] === pr[2][k]));
    });
    { const g = $c('cfPatColGrp'); if (g) g.hidden = draft.pattern === 'none'; }
    sec.querySelectorAll('.cf-body').forEach(b => b.classList.toggle('on', b.dataset.id === draft.base));
    paintPlate();
  }
  function paintPlate() {
    $c('cfShowName').textContent = draft.name || 'Rookie';
    $c('cfShowTitle').textContent = draft.title;
    // the plate shows the CONNECTED handle, never a typed one
    $c('cfShowX').textContent = XC.state && XC.state.x ? '@' + XC.state.x : '';
    const c = CHAR_BY_ID[draft.base];
    $c('cfShowBase').textContent = c ? 'Body: ' + c.name + (c.title ? ' · ' + c.title : '') : '';
  }
  // Every change is saved, debounced -- there is no way to build a fighter and then lose it by not pressing Save.
  let autoT = 0;
  function autoSave() {
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      if (!draft) return;
      draft.name = cleanTxt($c('cfName').value).slice(0, 16) || 'Rookie';
      draft.title = cleanTxt($c('cfTitle').value).slice(0, 22);
      CustomLook.set(draft);
      const s = $c('cfSaved'); s.textContent = 'Saved'; s.classList.add('on'); clearTimeout(autoSave.t); autoSave.t = setTimeout(() => s.classList.remove('on'), 1200);
    }, 450);
  }
  function buildBodies() {
    const box = $c('cfBodies'); if (box.childElementCount === coreChars().length) return;   // 79_core
    box.innerHTML = '';
    for (const c of coreChars()) {
      const b = document.createElement('button'); b.className = 'cf-body'; b.dataset.id = c.id; b.id = 'cf_body_' + c.id; b.title = c.name;
      b.innerHTML = `<span>${esc(c.name)}</span>`;
      const im = new Image(); im.onload = () => { b.style.backgroundImage = `url(${im.src})`; }; im.onerror = () => { b.style.backgroundImage = `url(assets/${c.id}.jpg)`; }; im.src = art(c.id);
      // sanitize on the way out of the body picker too: the new body may not carry the hat the old one
      // did, and the draft has to agree with the row the player is about to look at.
      b.addEventListener('click', () => { draft.base = c.id; draft = sanitize(draft); sfx(); paintForm(); refresh(); autoSave(); });
      box.appendChild(b);
    }
  }
  sec.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const grp = b.closest('[data-k]'); if (!grp) return;
    draft[grp.dataset.k] = b.dataset.v; sfx(); paintForm(); refresh(); autoSave();
  });
  $c('cfPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const pr = PRESETS.find(x => x[0] === b.dataset.p); if (!pr) return;
    // a preset is the LOOK only: body, name, title and handle are the player's and are never touched
    Object.assign(draft, pr[2]);
    sfx(); paintForm(); refresh(); autoSave();
  });
  $c('cfTitles').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; draft.title = b.dataset.t; sfx(); paintForm(); autoSave(); });
  $c('cfName').addEventListener('input', e => { draft.name = cleanTxt(e.target.value).slice(0, 16); paintPlate(); autoSave(); });
  // ---- X connect ----------------------------------------------------------------
  // Duane, 2026-10-14: *"it needs to connect. not just anyone type any name"*. The handle is no
  // longer part of the saved look at all: the server refuses to take it from `look` and only
  // xverify can set it, so what renders over a fighter's head is always an account that player
  // proved they hold. This box only drives that exchange.
  const XC = { state: null, busy: false, msg: '', bad: false };
  function xSend(m) { try { if (typeof Net !== 'undefined' && Net.send) Net.send(m); } catch (e) { /* offline */ } }
  function paintX() {
    const box = $c('cfXBox'); if (!box) return;
    const st = XC.state;
    if (!st) {
      box.innerHTML = '<div class="cf-xnote">Connecting needs you online. Join or host a match once and this turns on.</div>';
      return;
    }
    if (st.x) {
      box.innerHTML = `<div class="cf-xok">${st.xav ? `<img src="${esc(st.xav)}" alt="">` : ''}<b>@${esc(st.x)}</b><span class="tick">connected</span>`
        + `<button class="cf-xbtn ghost" id="cfXOff" style="margin-left:auto">Disconnect</button></div>`;
      $c('cfXOff').onclick = () => { XC.busy = true; XC.msg = ''; xSend({ k: 'xforget' }); paintX(); };
      return;
    }
    if (st.pending) {
      // The server is polling for them, so there is no "check" button to forget to press: they paste
      // the code on X and this flips to connected on its own. The button copies the code and opens
      // the X profile editor, which is the only screen they need.
      box.innerHTML = `<div class="cf-xcode"><b id="cfXCode">${esc(st.pending.code)}</b><span class="cf-xnote">goes anywhere in @${esc(st.pending.handle)}'s X bio</span></div>`
        + `<div class="cf-xrow"><button class="cf-xbtn" id="cfXOpen">Copy code &amp; open X</button>`
        + `<button class="cf-xbtn ghost" id="cfXCancel">Different handle</button></div>`
        + `<div class="cf-xnote" id="cfXWait"><span class="cf-xdot"></span>Watching @${esc(st.pending.handle)} — save your bio on X and this connects by itself.</div>`
        + (XC.msg ? `<div class="cf-xnote${XC.bad ? ' bad' : ''}">${esc(XC.msg)}</div>` : '')
        + '<div class="cf-xnote">Delete the code again straight after. The connection sticks.</div>';
      $c('cfXOpen').onclick = async () => {
        const code = st.pending.code;
        let copied = false;
        try { await navigator.clipboard.writeText(code); copied = true; } catch (e) { copied = false; }
        if (!copied) { const r = document.createRange(); r.selectNodeContents($c('cfXCode')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
        XC.msg = copied ? 'Code copied. Paste it into your bio on X and save.' : 'Copy the code above, then open x.com/settings/profile.';
        XC.bad = false; paintX();
        window.open('https://x.com/settings/profile', '_blank', 'noopener');
      };
      $c('cfXCancel').onclick = () => { XC.msg = ''; xSend({ k: 'xforget' }); };
      return;
    }
    box.innerHTML = '<div class="cf-xrow"><div class="cf-at"><span>@</span><input class="cf-in sm" id="cfX" maxlength="15" autocomplete="off" spellcheck="false" placeholder="yourhandle"></div>'
      + '<button class="cf-xbtn" id="cfXStart">Connect</button></div>'
      + (XC.msg ? `<div class="cf-xnote${XC.bad ? ' bad' : ''}">${esc(XC.msg)}</div>` : '')
      + '<div class="cf-xnote">You get a code, you put it in your X bio for a moment, and that proves the account is yours. Takes about twenty seconds, once.</div>';
    const go = () => { const h = cleanHandle($c('cfX').value); if (!h) { XC.msg = 'Type your X handle first.'; XC.bad = true; return paintX(); } XC.msg = ''; xSend({ k: 'xclaim', handle: h }); };
    $c('cfXStart').onclick = go;
    $c('cfX').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
  // the server is the only source of truth for this; the page never guesses it
  try {
    if (typeof Net !== 'undefined' && Net.on) Net.on(m => {
      if (m.k === 'xstate') { XC.state = m; XC.busy = false; if (m.x) { XC.msg = ''; XC.bad = false; } paintX(); paintPlate(); }
      else if (m.k === 'err' && m.code === 'x') { XC.busy = false; XC.msg = m.msg || 'That did not work.'; XC.bad = true; paintX(); }
      else if (m.k === 'welcome') { XC.state = { x: (m.profile && m.profile.x) || null, xav: (m.profile && m.profile.xav) || null, pending: null }; paintX(); }
    });
  } catch (e) { /* net not loaded in this build */ }
  $c('cfTitle').addEventListener('input', e => { draft.title = cleanTxt(e.target.value).slice(0, 22); sec.querySelectorAll('#cfTitles .cf-chip').forEach(b => b.classList.toggle('on', b.dataset.t === draft.title)); paintPlate(); autoSave(); });
  $c('cfRandom').addEventListener('click', () => {
    const pick = list => list[Math.floor(Math.random() * list.length)][0];
    { const CC = coreChars(); draft.base = CC[Math.floor(Math.random() * CC.length)].id; }
    // Rolling all eleven controls independently is how Randomise used to produce a mess -- gold chrome
    // with jungle camo and a bow tie. Most of the time it now starts from a look that works and varies
    // two or three things off it, which is what a random button is actually for.
    if (Math.random() < 0.72) {
      Object.assign(draft, PRESETS[Math.floor(Math.random() * PRESETS.length)][2]);
      const vary = [['tint', TINTS], ['patcol', PATCOL], ['aura', AURA], ['eyes', EYES], ['neck', NECK], ['shoes', SHOES]];
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) { const v = vary[Math.floor(Math.random() * vary.length)]; draft[v[0]] = pick(v[1]); }
    } else {
      // Randomise has to obey the per-body tables too, or the one button in the creator that nobody
      // reads the output of is the one that puts an unmeasured piece on a fighter.
      const perBody = { hat: hatsFor, hands: handsFor, back: backsFor, eyes: eyesFor, neck: neckFor };
      for (const [k, list] of GROUPS) draft[k] = pick(perBody[k] ? perBody[k](draft.base) : list);
    }
    if (Math.random() < 0.5) draft.title = TITLES[Math.floor(Math.random() * TITLES.length)];
    sfx(); paintForm(); refresh(); autoSave();
  });
  // export / import / restore: a wiped browser is no longer the end of a fighter
  $c('cfExport').addEventListener('click', async () => {
    sfx();
    draft.name = cleanTxt($c('cfName').value).slice(0, 16) || 'Rookie'; draft.title = cleanTxt($c('cfTitle').value).slice(0, 22);
    const code = b64.enc(sanitize(draft));
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch (e) { /* no clipboard permission */ }
    const s2 = $c('cfSaved'); s2.textContent = copied ? 'Code copied' : 'Code: ' + code.slice(0, 28) + '…'; s2.classList.add('on');
    if (!copied) window.prompt('Your fighter code — copy this:', code);
    clearTimeout(commit.t); commit.t = setTimeout(() => { s2.textContent = 'Saved'; s2.classList.remove('on'); }, 3000);
  });
  $c('cfImport').addEventListener('click', () => {
    sfx();
    const code = window.prompt('Paste a fighter code:', '');
    if (!code) return;
    const o = b64.dec(code);
    const s2 = $c('cfSaved');
    if (!o) { s2.textContent = 'That code did not read'; s2.classList.add('on'); clearTimeout(commit.t); commit.t = setTimeout(() => { s2.textContent = 'Saved'; s2.classList.remove('on'); }, 2500); return; }
    draft = sanitize(o); CustomLook.set(draft); draft = CustomLook.get();
    paintForm(); refresh(); setTimeout(grabThumb, 900);
    s2.textContent = 'Fighter loaded'; s2.classList.add('on'); clearTimeout(commit.t); commit.t = setTimeout(() => { s2.textContent = 'Saved'; s2.classList.remove('on'); }, 2500);
  });
  $c('cfRestore').addEventListener('click', () => {
    sfx();
    const o = loadSaved(); if (!o) return;
    draft = o; CustomLook.set(draft); draft = CustomLook.get(); paintForm(); refresh(); setTimeout(grabThumb, 900);
    $c('cfRestore').hidden = true;
  });
  function commit() {
    draft.name = cleanTxt($c('cfName').value).slice(0, 16) || 'Rookie';
    draft.title = cleanTxt($c('cfTitle').value).slice(0, 22);
    CustomLook.set(draft); draft = CustomLook.get(); paintForm();
    grabThumb();
    const s = $c('cfSaved'); s.classList.add('on'); clearTimeout(commit.t); commit.t = setTimeout(() => s.classList.remove('on'), 1800);
  }
  // A roster portrait of the fighter, taken off the preview canvas: same framing as assets/<id>_cut.webp
  // (full body, head near the top, transparent behind) so it drops into the tiles and plates unchanged.
  const SHOT_W = 376, SHOT_H = 560;
  function grabThumb() {
    if (!PV.r || !PV.model) { if (!shot) setShot(null); return; }
    const T = V3.THREE, r = PV.r, cv = r.domElement;
    const oldW = cv.width, oldH = cv.height, oldPR = r.getPixelRatio(), oldYaw = PV.holder.rotation.y;
    const oldAsp = PV.cam.aspect, oldPos = PV.cam.position.clone();
    const floor = PV.scene.children.find(o => o.isMesh && o.geometry && o.geometry.type === 'CircleGeometry');
    const floorVis = floor ? floor.visible : null;
    try {
      if (floor) floor.visible = false;
      r.setPixelRatio(1); r.setSize(SHOT_W, SHOT_H, false);
      PV.cam.aspect = SHOT_W / SHOT_H; PV.cam.position.set(0, 1.02, 4.35); PV.cam.updateProjectionMatrix(); PV.cam.lookAt(0, 0.93, 0);
      PV.holder.rotation.y = 0.38;
      r.render(PV.scene, PV.cam);
      setShot(cv.toDataURL('image/png'));
    } catch (e) { /* tainted canvas or lost context: the base art stands in */ }
    if (floor && floorVis != null) floor.visible = floorVis;
    r.setPixelRatio(oldPR); r.setSize(oldW / oldPR, oldH / oldPR, false);
    PV.cam.aspect = oldAsp; PV.cam.position.copy(oldPos); PV.cam.updateProjectionMatrix();
    PV.holder.rotation.y = oldYaw;
    try { paintEntryPoints(); } catch (e) { /* cosmetic */ }
  }
  $c('cfSave').addEventListener('click', () => { sfx(); commit(); });
  $c('cfFight').addEventListener('click', () => {
    sfx(); commit(); closeCreator(true);
    if (backTo === 'scSelect' && UI.slots && UI.slots.length) { useMine(UI.active || 0); UI.show('scSelect'); UI.renderSelect(); return; }
    UI.toSelect('cpu'); useMine(0); UI.renderSelect();
  });
  $c('cfBack').addEventListener('click', () => { sfx(); closeCreator(false); UI.show(backTo); if (backTo === 'scSelect') UI.renderSelect(); });

  function openCreator(from) {
    backTo = from || 'scTitle';
    draft = saved ? Object.assign({}, saved) : Object.assign({}, DEF);
    $c('cfRestore').hidden = !!saved || !backupExists();
    buildBodies(); paintForm();
    UI.show('scCustom');
    refresh(); pvLoop();
  }
  function closeCreator() { PV.running = false; }

  // The creator covers the whole screen, so the match behind it doesn't need drawing: skip the main
  // render pass while it is open (the preview canvas keeps its own loop). Composes with any other wrap.
  if (typeof R !== 'undefined' && typeof R.frame === 'function') {
    const origFrame = R.frame.bind(R);
    R.frame = function () { if (!sec.hidden) return; return origFrame(); };
  }

  // ---------------------------------------------------------------- live 3D preview
  const PV = { r: null, scene: null, cam: null, holder: null, model: null, mixer: null, act: null, yaw: 0.35, spin: 1, t: 0, drag: null, token: 0, running: false, last: 0 };
  function pvInit() {
    if (PV.r) return true;
    const T = window.V3 && V3.THREE; if (!T) return false;
    const cv = $c('cfCanvas');
    try { PV.r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { PV.r = null; return false; }   // preserve: the saved portrait is read back off this canvas
    PV.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    PV.r.toneMapping = T.ACESFilmicToneMapping; PV.r.toneMappingExposure = 1.05;
    PV.scene = new T.Scene();
    PV.cam = new T.PerspectiveCamera(26, 1, 0.05, 60);
    // a small studio for chrome and gold to reflect
    const ec = document.createElement('canvas'); ec.width = 256; ec.height = 128; const e2 = ec.getContext('2d');
    const gr = e2.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#6a7088'); gr.addColorStop(0.55, '#1a1c26'); gr.addColorStop(1, '#050507');
    e2.fillStyle = gr; e2.fillRect(0, 0, 256, 128);
    e2.fillStyle = '#ffffff'; e2.fillRect(100, 6, 60, 18); e2.fillRect(20, 44, 30, 20); e2.fillRect(190, 40, 36, 24);
    const et = new T.CanvasTexture(ec); et.colorSpace = T.SRGBColorSpace; et.mapping = T.EquirectangularReflectionMapping;
    const pm = new T.PMREMGenerator(PV.r); PV.scene.environment = pm.fromEquirectangular(et).texture; pm.dispose();
    PV.scene.environmentIntensity = 0.6;
    PV.scene.add(new T.HemisphereLight(0xdfe6ff, 0x20121a, 0.9));
    const key = new T.DirectionalLight(0xffffff, 2.4); key.position.set(-2, 4, 5); PV.scene.add(key);
    const rr = new T.DirectionalLight(0xff2a4a, 2.4); rr.position.set(4, 2, -3); PV.scene.add(rr);
    const rc = new T.DirectionalLight(0x27e1ff, 2.0); rc.position.set(-4, 1.5, -3); PV.scene.add(rc);
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const f2 = fc.getContext('2d');
    const fg = f2.createRadialGradient(64, 64, 0, 64, 64, 64); fg.addColorStop(0, 'rgba(255,42,74,.55)'); fg.addColorStop(0.45, 'rgba(255,42,74,.18)'); fg.addColorStop(1, 'rgba(255,42,74,0)');
    f2.fillStyle = fg; f2.fillRect(0, 0, 128, 128);
    const floor = new T.Mesh(new T.CircleGeometry(1.3, 48), new T.MeshBasicMaterial({ map: new T.CanvasTexture(fc), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; PV.scene.add(floor);
    PV.holder = new T.Group(); PV.scene.add(PV.holder);
    cv.addEventListener('pointerdown', e => { PV.drag = { x: e.clientX, yaw: PV.yaw + Math.sin(PV.t * 0.6) * 0.5 }; PV.t = 0; PV.yaw = PV.drag.yaw; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* old browser */ } });
    cv.addEventListener('pointermove', e => { if (PV.drag) PV.yaw = PV.drag.yaw + (e.clientX - PV.drag.x) * 0.012; });
    const up = () => { if (PV.drag) { PV.drag = null; PV.t = 0; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    return true;
  }
  function pvMsg(t) { const m = $c('cfMsg'); m.hidden = !t; m.textContent = t || ''; }
  function fallback2D(lk, note) {
    const im = $c('cfFallback'); im.hidden = false; $c('cfCanvas').style.visibility = 'hidden';
    im.onerror = () => { im.onerror = null; im.src = 'assets/' + lk.base + '.jpg'; };
    im.src = art(lk.base); im.style.filter = (CSS_TINT[lk.tint] || '') + ' drop-shadow(0 20px 30px rgba(0,0,0,.6))';
    pvMsg(note || '');
  }
  function disposeGear(o) { o.traverse(x => { if (x.userData && x.userData.cfGear && x.geometry) x.geometry.dispose(); }); }
  async function refresh() {
    if (!draft) return;
    const lk = sanitize(draft), tok = ++PV.token;
    if (window.V3 && V3.failed) return fallback2D(lk, '3D is off on this device. Your look still saves.');
    if (!window.V3 || !V3.ready || !pvInit()) {
      fallback2D(lk, 'Loading 3D…');
      const wait = () => { if (tok !== PV.token || sec.hidden) return; if (window.V3 && (V3.ready || V3.failed)) refresh(); else setTimeout(wait, 400); };
      setTimeout(wait, 400); return;
    }
    try { await V3.loadChar(lk.base); } catch (e) { if (tok === PV.token) fallback2D(lk, 'This body has no 3D model yet.'); return; }
    if (tok !== PV.token) return;
    const T = V3.THREE, mk = V3.makeModel(lk.base); if (!mk) return;
    $c('cfFallback').hidden = true; $c('cfCanvas').style.visibility = ''; pvMsg('');
    if (PV.model) { PV.holder.remove(PV.model); disposeGear(PV.model); }
    if (PV.mixer) PV.mixer.stopAllAction();
    const s = 1.7 / mk.height;
    mk.root.scale.setScalar(s); mk.root.position.y = -mk.minY * s;
    PV.holder.add(mk.root);
    try { applyLook(lk, mk.root, T, lk.base); } catch (e) { console.warn('custom look', e); }
    let hips = null; mk.root.traverse(o => { if (o.isBone && o.name === 'Hips' && !hips) hips = o; });
    const clips = V3.clipsFor(lk.base, hips ? hips.position.clone() : null);
    PV.mixer = new T.AnimationMixer(mk.root);
    const clip = clips.guard || clips.idle; PV.act = null;
    if (clip) { PV.act = PV.mixer.clipAction(clip); PV.act.play(); PV.range = (window.CLIP_RANGE || {})[clip.name] || null; }
    PV.model = mk.root;
  }
  function pvLoop() {
    if (PV.running) return;
    PV.running = true; PV.last = performance.now();
    const step = now => {
      if (!PV.running || sec.hidden) { PV.running = false; return; }
      requestAnimationFrame(step);
      if (!PV.r) return;
      const dt = Math.min(0.05, (now - PV.last) / 1000); PV.last = now;
      const cv = PV.r.domElement, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
      if (cv.width !== Math.round(w * PV.r.getPixelRatio()) || cv.height !== Math.round(h * PV.r.getPixelRatio())) { PV.r.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); }
      const narrow = w / h < 0.9;
      PV.cam.position.set(0, 1.0, narrow ? 6.2 : 5.0); PV.cam.lookAt(0, 0.95, 0);
      // a slow sway around a front three-quarter view; dragging takes over
      if (!PV.drag) PV.t += dt * PV.spin;
      PV.holder.rotation.y = PV.yaw + (PV.drag ? 0 : Math.sin(PV.t * 0.6) * 0.5);
      if (PV.mixer) {
        PV.mixer.update(dt);
        if (PV.act && PV.range) { const [a, b] = PV.range; if (PV.act.time < a || PV.act.time > b) PV.act.time = a; }
      }
      PV.r.render(PV.scene, PV.cam);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- entry points: title menu + fighter select
  //
  // PULLED 2026-09-29 on Duane's call ("remove the create character option"). Everything above this
  // line stays: `window.CustomLook` is still defined, so 91_v3_render can still paint a look onto an
  // avatar and 77_net can still show an ONLINE opponent who built one. What is gone is every way to
  // reach the creator from this build -- the title menu item, the two fighter-select buttons, the
  // roster tile, its keyboard handling and the #custom route, all of which live below.
  //
  // To put it back, delete this return.
  return;

  const tmenu = document.querySelector('#scTitle .tb-menu');
  let titleBtn = null;
  if (tmenu) {
    titleBtn = document.createElement('button'); titleBtn.id = 'bMyFighter'; titleBtn.className = 'tb-item';
    titleBtn.style.animationDelay = '0.31s';
    titleBtn.addEventListener('mouseenter', sfx);
    titleBtn.addEventListener('click', () => { sfx(); openCreator('scTitle'); });
    const first = tmenu.querySelector('.tb-item');
    if (first && first.nextSibling) tmenu.insertBefore(titleBtn, first.nextSibling); else tmenu.appendChild(titleBtn);
  }
  const selRow = document.querySelector('#scSelect .sel-top .row');
  let selMine = null, selEdit = null;
  if (selRow) {
    selMine = document.createElement('button'); selMine.className = 'btn small cf-mine'; selMine.id = 'bPlayMine';
    selEdit = document.createElement('button'); selEdit.className = 'btn small'; selEdit.id = 'bEditMine'; selEdit.textContent = 'Edit your fighter';
    selMine.addEventListener('click', () => {
      sfx();
      if (!saved) return openCreator('scSelect');
      const i = UI.active || 0; useMine(i);
      UI.active = (i + 1) % UI.slots.length; UI.renderSelect();
    });
    selEdit.addEventListener('click', () => { sfx(); openCreator('scSelect'); });
    selRow.prepend(selMine, selEdit);
  }
  function useMine(i) { const s = UI.slots && UI.slots[i]; if (!s || !saved) return; s.char = saved.base; s.custom = true; }
  function pickMine() {
    if (!saved) return openCreator('scSelect');
    const i = UI.active || 0; useMine(i);
    UI.active = (i + 1) % UI.slots.length; UI.renderSelect();
  }

  // ---------------------------------------------------------------- "Your fighter" everywhere it is shown
  // The select screen used to show the stock cutout, so the gear, hair, colours and name only appeared once
  // the match started. The creator now renders the live 3D preview to a portrait and every screen uses it.
  function thumb() { return shot; }
  function thumbFor(f) {   // f is a Fighter or a slot
    if (!shot || !saved) return null;
    const s = f && (f.slot || f);
    if (s && s.custom) return shot;
    if (f && f.slot && f.slot.customLook) return null;      // an online opponent's look: no picture of it here
    return null;
  }
  function hudArt(f) { const u = thumbFor(f); return u && shotImg && shotImg.complete && shotImg.naturalWidth ? shotImg : null; }
  function hudTag(f) { const lk = lookFor(f); return lk && lk.x ? '@' + lk.x : ''; }
  const setTxt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  function dressHero(el, s, c) {
    const img = el.querySelector('img'); if (!img) return;
    const mine = s && s.custom && shot;
    if (mine) {
      if (img.getAttribute('src') !== shot) img.setAttribute('src', shot);
      if (img.dataset.cfMine !== '1') img.dataset.cfMine = '1';
      const nm = el.querySelector('.nm'), tt = el.querySelector('.ttl');
      setTxt(nm, saved.name);
      setTxt(tt, saved.title || (c && c.title) || '');
      let xa = el.querySelector('.cf-x');
      if (saved.x) { if (!xa) { xa = document.createElement('div'); xa.className = 'cf-x'; (tt || nm).after(xa); } setTxt(xa, '@' + saved.x); if (xa.hidden) xa.hidden = false; }
      else if (xa && !xa.hidden) xa.hidden = true;
      el.classList.add('cf-hero');
    } else if (img.dataset.cfMine) { delete img.dataset.cfMine; el.classList.remove('cf-hero'); const xa = el.querySelector('.cf-x'); if (xa) xa.hidden = true; if (c) art2(c.id, u => { if (img.getAttribute('src') !== u) img.setAttribute('src', u); }); }
  }
  const ART2 = {};
  function art2(id, cb) {                                   // same cutout-or-jpg fallback 85_menu uses
    if (ART2[id]) return cb(ART2[id]);
    const im = new Image();
    im.onload = () => { ART2[id] = im.src; cb(im.src); };
    im.onerror = () => { ART2[id] = 'assets/' + id + '.jpg'; cb(ART2[id]); };
    im.src = art(id);
  }
  // the player's own tile, first in the select grid
  function ensureRosterTile() {
    const ro = $c('roster'); if (!ro) return;
    let tile = ro.querySelector('.cf-pick');
    if (!tile) {
      tile = document.createElement('button'); tile.className = 'cf-pick'; tile.id = 'pick_mine';
      tile.innerHTML = '<span class="face"></span><span class="badge">YOUR FIGHTER</span><span class="nm"></span>';
      tile.addEventListener('click', () => { sfx(); if (!saved) openCreator('scSelect'); else pickMine(); });
      tile.addEventListener('dblclick', () => { sfx(); openCreator('scSelect'); });
    }
    if (ro.firstElementChild !== tile) ro.prepend(tile);
    tile.title = saved ? saved.name + ' · your fighter (double-click to edit)' : 'Build your fighter';
    setTxt(tile.querySelector('.nm'), saved ? saved.name : 'BUILD ONE');
    const face = tile.querySelector('.face');
    if (saved && shot) { face.style.backgroundImage = `url(${shot})`; face.classList.add('cf-shot'); }
    else if (saved) { face.classList.remove('cf-shot'); art2(saved.base, u => { face.style.backgroundImage = `url(${u})`; }); }
    else { face.style.backgroundImage = 'none'; face.classList.remove('cf-shot'); }
    tile.classList.toggle('on', !!(UI.slots || []).some(s => s.custom));
  }
  function paintEntryPoints() {
    if (titleBtn) {
      titleBtn.innerHTML = `<i>02</i><b>Your fighter</b><em>▶</em><small>${saved ? esc(saved.name) + (saved.title ? ' · ' + esc(saved.title) : '') : 'Build, colour and name your own fighter'}</small><span class="tb-badge">NEW</span>`;
      if (tmenu) [...tmenu.querySelectorAll('.tb-item')].forEach((b, k) => { const n = b.querySelector('i'); if (n) n.textContent = String(k + 1).padStart(2, '0'); });
    }
    if (selMine) { selMine.textContent = saved ? '★ Play as ' + saved.name : '★ Build your fighter'; selEdit.hidden = !saved; }
  }
  paintEntryPoints();

  // fighter select: name + picture wherever a slot plays as your fighter
  let fixing = false;
  function fixSelectNames() {
    if (fixing || !UI.slots) return;
    fixing = true;
    try { fixSelectNamesInner(); } finally { fixing = false; }
  }
  function fixSelectNamesInner() {
    ensureRosterTile();
    if (!saved) return;
    const base = CHAR_BY_ID[saved.base];
    const slotEls = $c('slots') ? [...$c('slots').children] : [];
    UI.slots.forEach((s, i) => {
      const el = slotEls[i]; if (!el) return;
      el.classList.toggle('cf-slot', !!s.custom);
      if (!s.custom) return;
      setTxt(el.querySelector('.nm'), saved.name);
      const face = el.querySelector('.face'); if (face && shot && face.dataset.cfMine !== '1') { face.style.backgroundImage = `url(${shot})`; face.style.backgroundSize = 'contain'; face.style.backgroundPosition = '50% 100%'; face.dataset.cfMine = '1'; }
    });
    [['heroP1', 0], ['heroP2', 1]].forEach(([id, i]) => {
      const el = $c(id), s = UI.slots[i]; if (!el || !s || !base) return;
      if (!s.custom) return;
      try { dressHero(el, s, base); } catch (e) { /* cosmetic */ }
    });
    // wager screen portraits
    const wg = $c('wagers');
    if (wg) [...wg.querySelectorAll('.wcard')].forEach((el, i) => {
      const s = UI.slots[i]; if (!s || !s.custom) return;
      setTxt(el.querySelector('.pn'), (s.ctrl === 'cpu' ? 'CPU' : 'P' + (i + 1)) + ' · ' + saved.name);
      const cv = el.querySelector('canvas');
      if (cv && shot && shotImg && shotImg.complete && shotImg.naturalWidth) {
        const g2 = cv.getContext('2d'); g2.clearRect(0, 0, cv.width, cv.height);
        const sc = Math.min(cv.width / shotImg.naturalWidth, cv.height / shotImg.naturalHeight);
        const w2 = shotImg.naturalWidth * sc, h2 = shotImg.naturalHeight * sc;
        g2.drawImage(shotImg, (cv.width - w2) / 2, cv.height - h2, w2, h2);
      }
    });
  }
  if (typeof UI !== 'undefined' && UI.renderSelect) {
    const origRS = UI.renderSelect;
    UI.renderSelect = function () {
      for (const s of this.slots || []) if (s.custom && (!saved || s.char !== saved.base)) s.custom = false;
      const r = origRS.apply(this, arguments);
      try { fixSelectNames(); } catch (e) { /* cosmetic */ }
      return r;
    };
    for (const id of ['heroP1', 'heroP2']) { const el = $c(id); if (el) new MutationObserver(() => { try { fixSelectNames(); } catch (e) { /* cosmetic */ } }).observe(el, { childList: true, subtree: true, characterData: true }); }
    const origW = UI.renderWagers;
    if (origW) UI.renderWagers = function () { const r = origW.apply(this, arguments); try { fixSelectNames(); } catch (e) { /* cosmetic */ } return r; };
  }
  // results screen: the winner's own handle under the name
  if (typeof UI !== 'undefined' && UI.showResults) {
    const origShow = UI.showResults;
    UI.showResults = function (w) {
      const r = origShow.apply(this, arguments);
      try {
        const lk = lookFor(w), box = $c('winName');
        if (box) {
          let xa = box.parentNode.querySelector('.cf-x');
          if (lk && lk.x) { if (!xa) { xa = document.createElement('div'); xa.className = 'cf-x'; box.after(xa); } setTxt(xa, '@' + lk.x); if (xa.hidden) xa.hidden = false; }
          else if (xa && !xa.hidden) xa.hidden = true;
        }
      } catch (e) { /* cosmetic */ }
      return r;
    };
  }
  // ---------------------------------------------------------------- keyboard / pad reach the tile
  // 85_menu drives the grid off `.pick` and picks with `CHARS[cursor].id`, so the custom tile — which is
  // deliberately NOT a `.pick` (adding the class makes the roster length test rebuild the grid every frame
  // and knocks every CHARS index off by one) — was unreachable by anything except a mouse. Anyone playing
  // on a keyboard or a pad simply never saw their own fighter.
  //
  // This is a capture-phase listener, so it gets each key before 85_menu's own. It only ever swallows a key
  // when the cursor is actually parked on the tile, or when Left would wrap off the first column onto it;
  // every other key falls through untouched.
  let kbOnMine = false;
  const mineTile = () => { const ro = $c('roster'); return ro && ro.querySelector('.cf-pick'); };
  function paintMineCursor() {
    const t = mineTile(); if (t) t.classList.toggle('cf-cur', kbOnMine);
    if (kbOnMine) { const ro = $c('roster'); if (ro) [...ro.querySelectorAll('.pick.cur')].forEach(b => b.classList.remove('cur')); }
  }
  function leaveMine() { if (kbOnMine) { kbOnMine = false; paintMineCursor(); } }
  addEventListener('keydown', e => {
    const S = $c('scSelect'); if (!S || S.hidden) { kbOnMine = false; return; }
    const ro = $c('roster'), t = mineTile(); if (!ro || !t) return;
    const code = e.code;
    if (kbOnMine) {
      if (code === 'Enter' || code === 'KeyF' || code === 'KeyK') {
        e.preventDefault(); e.stopImmediatePropagation(); sfx();
        leaveMine(); pickMine(); return;                          // no fighter saved yet -> pickMine opens the creator
      }
      // any move off the tile hands the grid back to 85_menu, which resumes from its own cursor
      if (/^(Arrow(Right|Left|Up|Down)|Key[WASD])$/.test(code)) { leaveMine(); return; }
      return;
    }
    // Left from the first tile in the grid steps onto the custom tile instead of wrapping to the last fighter.
    // `at === -1` is the case that actually matters most: arriving at the select screen and pressing Left
    // before the grid has a cursor at all, which is exactly what a pad player does first.
    if (code === 'ArrowLeft' || code === 'KeyA') {
      const picks = [...ro.querySelectorAll('.pick')];
      const at = picks.findIndex(b => b.classList.contains('cur'));
      if (at === 0 || at === -1) {
        e.preventDefault(); e.stopImmediatePropagation(); sfx();
        kbOnMine = true; paintMineCursor();
      }
    }
  }, true);
  // a mouse anywhere in the grid takes the keyboard highlight back off the tile
  addEventListener('mouseover', e => { if (kbOnMine && e.target && e.target.closest && e.target.closest('#roster .pick')) leaveMine(); }, true);

  if (/^#custom\b/.test(location.hash)) setTimeout(() => openCreator('scTitle'), 60);
})();
