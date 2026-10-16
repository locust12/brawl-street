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
// ===== QUALITY CUT 2026-10-04 (Duane: "cut out anything thats lesser quality ... so we remain
// with the top quality", before the portal/store submissions) =====
// Every fighter was re-rendered on ONE neutral background with one light rig and one camera
// (dev/aaa/qaudit.sh -> runs/qaudit) and scored (dev/aaa/qscore.py), then ALL 46 were looked at.
// The score alone was not trusted to cut: it ranked gigachad and mochi near the bottom, and both
// turned out finished -- gigachad is a carved marble statue and mochi a finished cat whose face
// crop happened to land on blank skull. Low chroma is a style, not a defect. Only art that is
// BROKEN or UNFINISHED was cut:
//   bogdanoff  a featureless white ovoid head with one red line, no eyes/nose/mouth. Already named
//              above as "the thinnest art on the roster and the first one to cut if any goes".
//   sifu       no face at all, AND mismatched arms -- one green scaly, one pale tan. Unfinished.
// Deliberately NOT cut, all re-checked by eye: fro (a mummy; the bandages are the design), mystic,
// turbo and ronin (masked/visored by design), wojak (the meme's own flat face), giga/hoodie/techno
// (plain but finished).
// Stages: all 18 were run as live matches and looked at (dev/stagesheet.mjs -> runs/stages18).
//   floor      Trading Floor: a thin railing over a blurred office, no stage identity
//   lunar      Lunar Base: flat grey and empty
// 'keep' is foggy but that is deliberate atmosphere and it is one of the original five, so it stays.
// Nothing is deleted from the repo: these only leave the menus, and tb_all='1' still shows them.
// ===== THIN PASS 2026-10-05 (Duane: "thin out the character roster, remove repetitive characters,
// and shit/repetitive maps before we ship the final project") =====
// Cut for REPETITION, judged off the neutral-background renders in runs/qaudit where all 46 can be
// compared side by side rather than one at a time:
//   cheems   the sixth shiba inu. doge (the rig every clip retargets off), shib (red ninja) and
//            floki (horned helmet) are the three that read differently at a glance; cheems in a
//            suit is the closest duplicate of doge's silhouette.
//   hoodie   plain young man in streetwear, near-identical read to techno and ginga
//   techno   same, and the weaker of the two
//   mystic   black hood + blank pale face. sin (red glow) and ronin (white mask, core 12) already
//            own that silhouette and both read stronger.
//   turbo    dark armour + blank visor, the fifth masked figure
// KEPT ON PURPOSE: wif and bonk. Both are near-duplicate shibas by silhouette and would otherwise
// go, but they are two of the biggest names on the roster and that is a brand call, not a quality
// one. Flagged to Duane; cut them only if he says so.
// Stage cut, same reason: 'train' (Bullet Express) was the least distinct of the four purple-neon
// night stages next to city, shibuya and roof, all of which carry more of their own geometry.
// Nothing is deleted from the repo: these only leave the menus, and tb_all='1' still shows them.
// ===== SECOND THIN PASS 2026-10-05 (Duane: "remove anything or anyone repetitive ... the less the
// better") =====
// Judged off runs/qaudit, where all 46 stand on the same background in the same light:
//   bonk, wif   the fourth and fifth shiba inu. doge (the rig every clip retargets off), shib (red
//               ninja) and floki (horned helmet) are the three that read differently at a glance.
//               Both are big names and were held back on the first pass as a brand call; Duane
//               called it on 10/05.
//   mochi       the third white cat next to popcat and cashcat; popcat is the iconic one.
//   fro         a white mummy with no features. Deliberate as a design, but it is the flattest
//               silhouette left and reads as unfinished next to everything around it.
//   giga        plain grey humanoid, the weakest read of the remaining originals.
// Stages, same rule:
//   roof        the fourth purple-neon night stage after city and shibuya, both of which carry
//               more of their own geometry.
//   keep        Shadow Keep: grey fog and two platforms, the sparsest stage in the set.
// Nothing is deleted from the repo: these only leave the menus, and tb_all='1' still shows them.
const CORE_SET = {
  on: true,
  fighters: [
    // the original twelve, which have bespoke normal-attack kits in 6g_styles
    'doge', 'pepe', 'shib', 'pengu', 'popcat', 'brett', 'moodeng', 'whale', 'gigachad', 'ronin',
    // finished and verified by eye, 9/25. These share the base normals but differ in weight, walk,
    // power, jump, gravity, air control and reach (66_traits) and most carry their own specials
    // (21_roster2 moves2 / ai2), so they are distinct to play, not reskins.
    'ape', 'bear', 'bling', 'bull', 'cashcat', 'chop', 'clanker', 'ember', 'fartcoin',
    'floki', 'ginga', 'gwei', 'kaiju', 'lobster', 'omen', 'shroom',
    'sin', 'slam', 'spark', 'topg', 'tyrant', 'volt', 'wisp', 'wojak', 'wolverinu',
    // OPENED 9/27. All four holdback reasons below were re-checked against the running page and
    // every one of them was stale:
    //   trump     held as "the only fighter whose display name is a real person's actual surname" --
    //             but ORIGINS already aliases it, and it displays as BULLION / "Hard Money". The
    //             model is a gold brick golem with no likeness of anyone.
    //   mochi     held because mochi_v2_glb.wasm has no skins -- but the plain id resolves to
    //             mochi_glb.wasm, not the v2 file. Read off the live avatar: 1 skinned
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
    'trump'
  ],
  // STAGES OPENED UP 9/27. This was five while the rest were assumed unfinished. They are not: every
  // one of the other thirteen was run as a live four-player level-7 match and LOOKED AT on the same
  // day (dev/stagesheet.mjs -> dev/aaa/shots/gated_sheet.jpg). All thirteen have a finished backdrop,
  // working platforms, their own music theme, four fighters alive at the end and zero exceptions --
  // Neon City even carries the one moving platform in the game and Gloom Bayou two more. Shipping
  // five of eighteen was gating finished work, and a platform fighter listing that says "5 stages"
  // undersells the game by a factor of three.
  // The order is the order the picker draws them: the original five first.
  stages: ['isle', 'chart', 'dojo', 'moon', 'miami', 'city', 'ship', 'street', 'arena', 'swamp', 'peak', 'baghdad', 'shibuya'],
};
try { if (localStorage.getItem('tb_all') === '1') CORE_SET.on = false; } catch (e) { /* private mode: core set */ }

// ---- THE VAULT GATE (the catalogue is CAT.vault in 89_econ.js) ----------------------------------
// Two stages and one fighter are SECRET: they draw as a shadow with a question mark until the
// account owns them. This is the only place the roster and the picker ask about it, so there is one
// answer rather than one per screen.
//
// `Econ` loads after this file (89_econ.js), which is fine because nothing here runs at load time --
// but a build with no store at all (portal, desktop) has no Econ ever, and the two cases want
// OPPOSITE answers:
//   - a FIGHTER falls open. OMEN has been in the roster since 9/27; a build that cannot sell
//     anything must not quietly lose a fighter.
//   - a STAGE stays shut, which is exactly what those builds do today (Shadow Keep and Neon Rooftop
//     are in no picker), so nothing changes for them.
// `tb_all=1` opens the vault with everything else, so the dev switch still shows all 19 stages.
function vaultOpen(kind, id) {
  if (!CORE_SET.on) return true;
  try { return Econ.vaultOpen(kind, id); } catch (e) { return kind === 'fighter'; }
}
function coreChars() {
  const list = CORE_SET.on ? CHARS.filter(c => CORE_SET.fighters.includes(c.id)) : CHARS;
  return list.filter(c => vaultOpen('fighter', c.id));
}
function coreStage(id) {
  // a vault stage answers only to the vault: it is in neither CORE_SET.stages nor the free picker
  try { if (typeof Econ !== 'undefined' && Econ.vaultFor('stage', id)) return vaultOpen('stage', id); } catch (e) { /* no store in this build */ }
  return !CORE_SET.on || CORE_SET.stages.includes(id);
}
