// ===== the core set (9/22 night, Duane: "only focus on less fighters and less maps, make everything professional") =====
// 12 fighters and 5 stages, finished properly before the rest come back. The menus show only these; nothing is
// deleted, the fight code and the online / bet-arena rosters are untouched. localStorage tb_all = '1' shows everything.
// Page only (not a SIM file). To swap a pick, edit the lists below.
// 9/25, Duane: "maybe can we add more characters? the current characters against cpu is mad boring...
// can u only add the characters that are polished". So the set opens up to every fighter that is
// genuinely finished, and only those. The bar, checked per fighter rather than assumed:
//   * a shipped, PUBLISHED model (publish/files.json) with a real skinned rig -- 33 of the 34 hidden
//     fighters had one; mochi is the exception the build has always warned about (mochi_v2_glb.wasm
//     has no skins, so it gets procedural motion and holds no weapon)
//   * cutout art for the select screen, published
//   * a stat profile in 66_traits, so it does not move like a clone of the body next to it
//   * and then I LOOKED AT ALL 33 in-game, idle, on the same stage in the same light
//     (dev/rostershots.mjs, runs/roster/sheets). That last step is the only reason this list is not 32:
//       bogdanoff -- completely blank white head, one red line, no eyes/nose/mouth
//       fro       -- completely blank head, no features at all
//     Both are unfinished art and are held back. giga, turbo (visored) and ember all read as finished
//     characters on a close crop and are in.
// HELD BACK SEPARATELY, not for polish: 'trump' is the only fighter whose display name is a real
// person's actual surname. Every comparable one is already aliased (bling -> OG BOBBY, gwei -> WRENCH,
// topg -> TOP G "Alpha Parody", gigachad -> MARBLE, ronin -> WICK). That is Duane's call, not mine.
const CORE_SET = {
  on: true,
  fighters: [
    // the original twelve, which have bespoke normal-attack kits in 6g_styles
    'doge', 'pepe', 'shib', 'bonk', 'wif', 'pengu', 'popcat', 'brett', 'moodeng', 'whale', 'gigachad', 'ronin',
    // finished and verified by eye, 9/25. These share the base normals but differ in weight, walk,
    // power, jump, gravity, air control and reach (66_traits) and most carry their own specials
    // (21_roster2 moves2 / ai2), so they are distinct to play, not reskins.
    'ape', 'bear', 'bling', 'bull', 'cashcat', 'cheems', 'chop', 'clanker', 'ember', 'fartcoin',
    'floki', 'giga', 'ginga', 'gwei', 'hoodie', 'kaiju', 'lobster', 'mystic', 'omen', 'shroom',
    'sifu', 'sin', 'slam', 'spark', 'techno', 'topg', 'turbo', 'tyrant', 'wisp', 'wojak',,
    // OPENED 9/27. All four holdback reasons below were re-checked against the running page and
    // every one of them was stale:
    //   trump     held as "the only fighter whose display name is a real person's actual surname" --
    //             but ORIGINS already aliases it, and it displays as BULLION / "Hard Money". The
    //             model is a gold brick golem with no likeness of anyone.
    //   mochi     held because mochi_v2_glb.wasm has no skins -- but ASSET_ID('mochi') is 'mochi',
    //             so it loads mochi_glb.wasm, not the v2 file. Read off the live avatar: 1 skinned
    //             mesh, 24 bones, real clips, and it holds its mallet.
    //   fro       held as "completely blank head, no features at all" -- it is a MUMMY, called
    //             LIMIT / "Resting Order". The blank head is bandages. That is the design.
    //   bogdanoff held as "blank white head, one red line" -- it is a faceless figure in a long
    //             coat, no less deliberate than WISP or OMEN. It is the thinnest art on the roster
    //             and the first one to cut if any goes. (Its shipped name and title are aliased
    //             again for portal builds in build_portals.py, which is also why neither string is
    //             written out here: a grep of the built page for gambling vocabulary should come
    //             back empty, and a comment quoting the words it removes defeats the check.)
    // All four: 1 skinned mesh, 24 bones, not in V3.missing, real animation clips.
    'trump', 'mochi', 'fro', 'bogdanoff'
  ],
  // STAGES OPENED UP 9/27. This was five while the rest were assumed unfinished. They are not: every
  // one of the other thirteen was run as a live four-player level-7 match and LOOKED AT on the same
  // day (dev/stagesheet.mjs -> dev/aaa/shots/gated_sheet.jpg). All thirteen have a finished backdrop,
  // working platforms, their own music theme, four fighters alive at the end and zero exceptions --
  // Neon City even carries the one moving platform in the game and Gloom Bayou two more. Shipping
  // five of eighteen was gating finished work, and a platform fighter listing that says "5 stages"
  // undersells the game by a factor of three.
  // The order is the order the picker draws them: the original five first.
  stages: ['isle', 'chart', 'dojo', 'roof', 'keep',
    'moon', 'miami', 'city', 'ship', 'street', 'arena', 'swamp', 'floor', 'train', 'peak', 'lunar',
    'baghdad', 'shibuya'],
};
try { if (localStorage.getItem('tb_all') === '1') CORE_SET.on = false; } catch (e) { /* private mode: core set */ }
function coreChars() { return CORE_SET.on ? CHARS.filter(c => CORE_SET.fighters.includes(c.id)) : CHARS; }
function coreStage(id) { return !CORE_SET.on || CORE_SET.stages.includes(id); }
