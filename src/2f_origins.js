// ===== ORIGINS: original-design replacements for the borrowed skins =====
//
// See dev/NOTES-roster.md for the audit. Short version: 19 of the 46 fighters shipped as a close
// likeness of somebody else's character (11) or of a real person (8), and 4 more are fine as art but
// point at somebody through their name and move names. That is survivable for a free hobby build and
// not survivable for a product taking wagers, because a takedown lands on the whole game.
//
// This file makes the swap available WITHOUT touching a single number. Every replacement was designed
// from the fighter's GAMEPLAY ROLE outward — what it actually does in 20_chars / 21_roster2 /
// 22_chars_more — so the silhouette still explains the archetype and nothing needs rebalancing.
//
// WHAT IT CHANGES: name, title, blurb, the `look` descriptor (2D fallback only), taunt, the shout and
// sigText strings, the TRAIT display name, the voice pack, and which art files load.
// WHAT IT NEVER TOUCHES: the character `id`, w/h/walk/air/grav/fall/jump/djump/jumps/weight/power/
// reach, every hitbox, every move def's frames and tick, traits' numbers, AI tables, animations.
//
// ARENA-SAFE BY CONSTRUCTION: build.py only folds `src/2[0-9]_*.js` into arena/fightsim.js, and this
// file is `2f_`, so the headless fight engine and the bet arena (ARENA.version 1) never load it at
// all. Verified anyway on every edit:
//   ~/.local/bin/node arena/test/det_node.js   -> mismatches 0
//   ~/.local/bin/node dev/detcheck.js 7        -> mismatches 0
//
// PER-FIGHTER SWITCH. Nothing is irreversible and nothing is all-or-nothing:
//   ORIGINS.TEXT   ids whose name/title/blurb/shouts are swapped
//   ORIGINS.ART    ids that load assets/<id>_v2* instead of assets/<id>*
//   ?origins=all | none | giga,ronin,...     URL override, both lists
//   ?originsArt=none                          text swap only, keep the old art
// An id can be in TEXT without being in ART (the text swap is free and needs no new art) but should
// not be in ART without TEXT.

const ORIGINS = {
  // ---- which swaps are live ----
  // 9/21: Duane approved the swap. TEXT is every entry below; ART is the 17 that got original art
  // (`techno` and `hoodie` keep their models — the name was the whole tell — and `tyrant`, `omen`,
  // `spark`, `wisp` never needed art). Both lists are per fighter on purpose: a bad one comes out of
  // ART without blocking the other sixteen, and out of TEXT without touching anyone else.
  TEXT: ['giga', 'ronin', 'gwei', 'shroom', 'kaiju', 'ember', 'turbo', 'fro', 'ape', 'sifu',
    'trump', 'techno', 'mystic', 'hoodie', 'chop', 'bogdanoff', 'gigachad',
    'tyrant', 'omen', 'spark', 'wisp'],
  ART: ['giga', 'ronin', 'gwei', 'shroom', 'kaiju', 'ember', 'turbo', 'fro', 'ape', 'sifu',
    'trump', 'mystic', 'chop', 'bogdanoff', 'gigachad'],
  SUF: '_v2',

  // asset base name for a fighter. Everything that loads per-fighter art goes through this:
  // 30_draw.js PORTRAITS, 71_hud.js head(), 77_net.js, 85_menu.js art(), 86_custom.js,
  // 90_v3_core.mjs V3.loadChar. Returns the id unchanged for anything not swapped, so with both
  // lists empty this file is a no-op.
  asset(id) { return ORIGINS.ART.indexOf(id) >= 0 ? id + ORIGINS.SUF : id; },
  on(id) { return ORIGINS.TEXT.indexOf(id) >= 0; },

  // ---- the designs ----
  // Each: why it had to change, then the replacement. `role` is the thing the design had to explain,
  // copied off the move data, and is the reason the swap needs no rebalancing.
  DATA: {

    // ============ (b) close likeness of a copyrighted character ============

    giga: {
      was: 'Goku (Dragon Ball) — white spiked hair, dark gi with a teal sash, charged beam, vanish step',
      role: 'balanced all-rounder; long charge into a big piercing beam, teleport recovery, rush that links into a flurry',
      name: 'BEACON', title: 'Charge Keeper',
      blurb: 'Balanced and strong. Charged Moon Wave, blink step.',
      idea: 'A lighthouse for the chain. Tall lean graphite figure; instead of hair, a swept crest of six glass quills that fill white-hot root to tip as he charges, and a cold ring of light at the waist. Wrapped forearms and shins, barefoot, no gi. The crest IS the charge meter, so the player reads the wind-up off the silhouette.',
      story: 'He holds the last confirmed block and lets it go all at once.',
      look: { fur: '#2b2f3a', belly: '#138f8a', ear: '#f4f6ff', dark: '#0a1018', eye: 'fierce' },
      taunt: 'STILL CHARGING',
      say: { 'KI STORM': 'DUST STORM' },
    },

    ronin: {
      was: 'Trunks (Dragon Ball) — pale blue anime hair, sword slung across the back over a jacket',
      role: 'longest melee reach on the roster; three-shot energy volley, dash slash, rising spin, slam with ground waves',
      name: 'WICK', title: 'Wick Trimmer',
      blurb: 'Sword reach. Energy volley, rising spin slash.',
      idea: 'A duelist built like the thin line on top of a candle. Narrow heron-headed figure in a bone beak-mask, very long limbs, high collar, a coat cut like a candle body that splits into two tails at the waist with one red seam down it. The blade is a thin bar of pale cyan light held reverse-grip, carried level at the hip — never on the back.',
      story: 'He trims the wick off every candle. If your position printed a long top, that was him.',
      look: { fur: '#20222c', belly: '#c8ccd4', ear: '#9fd8ff', dark: '#0c0e16' },
      taunt: 'SHOW ME THE TOP',
      say: { SHATTER: 'TRIMMED' },
    },

    gwei: {
      was: 'Mario — moustache, round badged cap, blue overalls over a yellow shirt, wrench; bouncing fireball and a coin uppercut',
      role: 'all-rounder; bouncing fireball, a spin that reflects projectiles and turns them around, multi-hit rising uppercut, slam',
      name: 'GASKET', title: 'Gas Fitter',
      blurb: 'All-rounder. Bouncing fireball, reflector spin, coin uppercut.',
      idea: 'A stout mechanical badger in a welding rig. Heavy brass diving-helm with ONE round amber lens (no cap, no face, no moustache), oxide-teal canvas coveralls, a bandolier of brass washers across the chest, and a pipe-wrench manipulator for a right hand. The wrench-arm is why the spin reflects.',
      story: 'He keeps the pipes under the chain from bursting. He charges one washer, and he has a lot of washers.',
      look: { fur: '#1f7a78', belly: '#d8952a', ear: '#ff8a1a', dark: '#2a1206' },
      taunt: 'ITS LEAKING',
      say: {},
    },

    shroom: {
      was: 'Toad (Mario) — the mushroom-cap head, waistcoat and puffy trousers are the character in silhouette',
      role: 'light trap-layer; a slow growing poison cloud that re-hits, headbutt dash, a very long parachute glide recovery, spin burst',
      // 9/22, Duane on THISTLE (the dandelion sprite): "make thistle a cooler character the name is shit".
      // Same kit, new body: the cloud is a dropped smoke canister, the headbutt is a helmet ram, the glide is
      // a real parachute. Old art kept in assets3d/shroom_v2_thistle_backup/.
      name: 'AIRDROP', title: 'Claim Now',
      blurb: 'Light. Smoke drops, helmet ram, parachute glide.',
      idea: 'An elite high-tech paratrooper: gunmetal flight suit with mint neon seams, an iridescent chrome visor over a breathing mask, safety-orange harness, a parachute pack and glowing canisters on the hips. It falls in from nowhere, leaves a cloud and a crate, and is gone before you read the fine print.',
      story: 'Everyone wants the drop. Nobody reads what is in the crate.',
      look: { fur: '#3b4048', belly: '#ff6a1a', ear: '#5cffc2', dark: '#121417' },
      taunt: 'CLAIM IT',
      say: { 'SPORE BURST': 'CARE PACKAGE' },
    },

    kaiju: {
      was: 'Bowser — spiked shell, horns, crown, fire breath, shell spin, flying slam. jobs3.json already logged three moderation rejections for the shell-and-crown combo',
      role: 'heaviest on the roster; fire-breath stream, command grab into a flying slam, spinning armoured body, shell bomb',
      name: 'VAULT', title: 'Cold Storage',
      blurb: 'Heaviest. Fire breath, flying slam, vault roll.',
      idea: 'A hunched crustacean-saurian titan dragging a bank vault door on its back as a hermit-crab shell — round dial and spokes facing out, seam glowing orange before it breathes. Slate-blue plated hide, blunt furnace jaw, heavy clawed feet, short thick tail. No crown, no cone spikes, no fin-plates. The door is the armour AND the thing it rolls on.',
      story: 'Whatever it swallowed in 2013 is still in there, and the dial only turns from the inside.',
      look: { ear: '#8a8e98' },
      taunt: 'ROAR',
      say: { 'SHELL BOMB': 'LOCKDOWN' },
    },

    ember: {
      was: 'Charizard — orange-red dragon, cream belly, wings, flame on the tail tip, fire breath, wing flaps',
      role: 'heavy flyer with two wing flaps; fire-breath stream, a committed rush that costs it damage, spin-wings rise, an armoured punch that smashes shields',
      name: 'PYRE', title: 'Ash Wing',
      blurb: 'Heavy flyer, two wing flaps. Fire breath, blaze tackle.',
      idea: 'A big-shouldered ash-grey vulture-drake. Charcoal plumage that glows ember-orange in the gaps, a bald bone skull-face with a hooked beak, two broad ragged smoking wings, and — instead of a lit tail tip — a fan of six glowing ember quills at the back. Soot-black chest, heavy talons.',
      story: 'Everything burned so far is still in there somewhere, and it is what keeps him warm.',
      look: { fur: '#4a4448', belly: '#ffd9a0', ear: '#ff6a1a', dark: '#1a1416' },
      taunt: 'ALL BURNED',
      say: {},
    },

    turbo: {
      was: 'Captain Falcon (F-Zero) — racing helmet with a mirrored visor, red neck scarf, black-and-gold bodysuit, and BLAZE PUNCH is the Falcon Punch beat for beat',
      role: 'fastest runner; one enormous 80-frame commitment punch, flame-fist dash, a dive command grab for a recovery, flame kick',
      name: 'REDLINE', title: 'Last Mile',
      blurb: 'Fastest runner. Redline Punch, dive grab, burnout kick.',
      idea: 'A greyhound-built courier android. Matte carbon chassis with exposed piston calves, a smooth featureless brushed-steel faceplate with one horizontal amber light bar (no helmet, no visor), a long torn red banner trailing from ONE shoulder rather than a neck scarf, and a deliberately oversized right forearm that vents heat. The big arm is the whole design brief: it is why that punch takes eighty frames and why it is worth it.',
      story: 'A settlement courier that kept the last packet it was ever asked to deliver. The arm is where it keeps it.',
      look: { acc: 'none' },   // the shipped steel / ink / amber palette already fits; the scarf was the tell
      taunt: 'SHOW ME',
      say: { BLAZE: 'REDLINE', 'BLAZE PUNCH': 'LAST MILE', 'BLAZE KICK': 'BURNOUT' },
    },

    fro: {
      was: 'Afro Samurai — the afro, the grey kimono and the katana, and "Number Two" is literally that character\'s rank',
      role: 'counter-first duelist with the second-longest reach; a quick-draw counter that pays 1.6x, an intangible dash-through slash, rising spin, slam',
      name: 'LIMIT', title: 'Resting Order',
      blurb: 'Sword reach. Quick-draw counter, dash-through slash.',
      idea: 'A figure wrapped head to foot in pale ash binding cloth like a stopped clock. No face — one horizontal slot of cold white light. One arm free, one still bound. A single straight blade in a lacquered scabbard held out LEVEL at the hip, never on the back. It does not move until you do, which is the counter, drawn.',
      story: 'It was set once, at a price nobody remembers. It is still waiting for it.',
      look: { fur: '#7a7a72', belly: '#2a2a30', ear: '#e8f4ff', dark: '#100a06' },
      taunt: 'HMPH',
      say: { IAI: 'FILLED', 'ONE CUT': 'FILLED' },
    },

    ape: {
      was: 'Bored Ape Yacht Club (Yuga Labs) — the BAYC muzzle and bored eyes exactly, plus the hoodie and gold chain, and the title says "Bored Ape"',
      role: 'heavy strong zoner-bruiser; a boomerang that always comes back, dash, swing recovery, chest-pound shockwave and air slam',
      name: 'BAGGER', title: 'Heavy Bags',
      blurb: 'Heavy and strong. Bag boomerang, chest pound.',
      idea: 'A shaggy ground-sloth bear — long blunt snout, small sleepy eyes, heavy brow, long curved forearm claws. Not a primate face. Slung across him is a huge canvas sack on a strap with a cyan tag, and that is what he throws; it always comes back, because he would never let it go. The weight of the sack is why he hits like that.',
      story: 'He has been carrying it since the last cycle. He will not put it down and he will not open it.',
      look: {},   // dun-brown / cream / cyan already fits; only the species and the face change
      taunt: 'STILL HOLDING',
      say: { 'APE IN': 'ALL IN', 'APE STRONG': 'BAGS UP' },
    },

    sifu: {
      was: 'Lei Wulong (Tekken) — long black ponytail, sunglasses pushed up on the head, red mandarin jacket with an emblem; Five Animals is his style and the drunken stance is his',
      role: 'stance technician; a fast multi-hit poke, a lunging pounce, a rising kick, and a counter stance with intangible frames that pays 1.4x',
      name: 'COUNCIL', title: 'Five Keys',
      blurb: 'Five-limb construct. Fast jabs, pounce, rising kick, stance counter.',
      idea: 'A patchwork construct: five differently-coloured jade and stone limb-segments bolted onto one lacquered black torso, each ending in a different beast shape — a snake-head left hand, a tiger-paw right hand, a crane-claw foot, a bear-pad foot. Smooth featureless jade mask with five small lit dots in a ring. No hair, no jacket, no glasses. The five limbs ARE the five animals, so the moveset still reads at a glance.',
      story: 'Five keys, one body. It only throws a punch when all five agree, which is why the first one is so slow.',
      look: { fur: '#1f8a7a', belly: '#c01a2a', ear: '#141010', dark: '#0e0c0c' },
      taunt: 'ALL AGREED',
      say: { 'DRUNKEN FIST': 'UNANIMOUS', TIGER: 'QUORUM' },
    },

    mochi: {
      was: 'Kirby — round puffball, five air jumps, inhale, swallow, spit a star, mallet, stone drop. The art is halfway original; the kit is the character',
      role: 'floaty featherweight, five air jumps; inhale into a swallow command grab that spits a star, a charged mallet, and a stone drop with total armour',
      name: 'BLOAT', title: 'Supply Sink',
      blurb: 'Five air jumps. Inhale, mallet, hard-cap drop.',
      idea: 'A pufferfish. Soft mint-cream and round when idle, stub fins for arms, two webbed feet, big flat eyes, and a small round mouth that opens wider than its own body to inhale. On the down-special it clamps into a spiked chrome ball — which is a better reason for 999 armour than a stone ever was. Dorsal spines instead of cat ears; a little wooden mallet in a strap.',
      story: 'Supply goes in. Supply does not come out. It has never once been hungry and never once been full.',
      look: {},   // mint / cream / coral already fits; only the species changes
      taunt: 'HI',
      say: { STONE: 'HARD CAP' },
    },

    // ============ (c) likeness of a real person ============

    trump: {
      was: 'Donald Trump — the caricature, the navy suit and red tie, TARIFF / AIR FORCE ONE / YUGE. And this one is in ARENA.roster, i.e. the money arena',
      role: 'heavy all-rounder; a heavy lobbed gold-bar arc, rally dash, rise, a two-sided slam',
      name: 'BULLION', title: 'Hard Money',
      blurb: 'Heavy. Throws its own gold bar, huge slam.',
      idea: 'A squat, immensely heavy golem stacked out of mismatched gold bars banded together with dark iron. No face — a slot of warm light where one would be, and a small barred hatch in the chest. Short thick legs, huge forearms. It throws one of its own bars and grows a new one, which is exactly what the projectile does.',
      story: 'It has been in the same vault since the first bar was cast, and it gets one bar heavier every time somebody panics.',
      look: { fur: '#e8b84a', belly: '#2a2f3a', ear: '#f0c050', dark: '#2a1a10', eye: 'dot' },
      taunt: 'COME ON',
      say: { TARIFF: 'TOLL', 'AIR FORCE ONE': 'LIFT OFF', YUGE: 'HEAVY' },
    },

    topg: {
      was: 'Andrew Tate — bald, aviators, cigar, gold chain, black tee, "TOP G", "BUGATTI", plus a recorded impression voice pack. Also in ARENA.roster',
      role: 'bruiser; a charged punch, the fastest dash in the game (speed 18) with a car effect on it, rise, big slam, and a rage trait',
      name: 'SHILL', title: 'Caller',
      blurb: 'Bruiser. Charged punch, sponsored dash.',
      idea: 'A lean, wired bull-terrier man in a white-and-gold tracksuit — narrow head, tiny eyes, permanent grin. A thin wire headset mic curling to his mouth (he is always broadcasting; the headset replaces the shades), chains, and a phone in one hand he never looks at. No cigar, no aviators, no bald human head. The car dash still reads as the thing he is selling you.',
      story: 'He has never held a position for more than four minutes and he has never once been quiet about it.',
      look: {},   // tan / warm / brass already fits; the species and the dress do the work
      trait: 'Hype Mode',
      voice: false,   // drops the impression voice pack; falls back to the `deep` archetype
      taunt: 'COME ON',
      say: { 'TOP G': 'SHILL', BUGATTI: 'FLOOR IT' },
    },

    techno: {
      was: 'Elon Musk — but only by NAME. "Technoking" is his own Tesla job title and the kit is his companies one by one: a flamethrower, a STEEL TRUCK ram, a rocket. The 3D model is a generic dark-haired young man in a rocket tee with a jetpack; nothing about the face is him. 9/21: Duane took the rename over a redraw on exactly that finding',
      role: 'flamethrower stream, a wide heavy 52-frame ram, a rocket liftoff recovery, a thrust slam, and an air-control trait',
      name: 'BOOSTER', title: 'Burn Rate', art: false,
      blurb: 'Flamethrower, battering ram, rocket launch.',
      idea: 'NO NEW ART — the existing model is kept. The name was the entire tell, so the replacement had to be clean of it end to end: no company, no job title, no product. "Booster" is plain rocketry and "burn rate" is what a startup does to its money, which is the joke doing the work instead. Nothing in the kit is named after a vehicle any more.',
      story: 'Strapped on a jetpack he definitely built himself, and the fuel gauge only goes one way.',
      taunt: 'TO THE MOON',
      say: { 'STEEL TRUCK': 'BATTERING RAM' },
    },

    mystic: {
      was: 'Conor McGregor — "Mystic Mac" is his nickname, the left hand is his trademark, plus the red beard, the fur coat and the chest tattoo. jobs3.json already rejected one image of this fighter as "too close to a real fighter\'s tattoo"',
      role: 'fast striker; a counter that pays 2.0x, a kick dash, rising kick, spinning back kick, and a unique move that marks you and goes off three seconds later',
      name: 'SETTLE', title: 'Deferred',
      blurb: 'Fast striker. Counter, spinning back kick.',
      idea: 'A wiry figure in a hooded singlet, arms and torso covered in slowly rotating hex-glyph tattoos of cold green light — invented glyphs, not anybody\'s ink. Hands wrapped in black tape, bare feet, and a bone-pale mask with no mouth and one vertical seam. Nothing is happening to you yet.',
      story: 'It never throws the punch you are blocking. It throws the one you already took.',
      look: { fur: '#d8cfc4', belly: '#1f8a4a', ear: '#3a7a52', dark: '#1a1410' },
      taunt: 'WHO',
      say: { 'LIGHTS OUT': 'SETTLED', 'AXE KICK': 'HEX' },
    },

    hoodie: {
      was: 'Mark Zuckerberg — but only by NAME. "Cage Coder" plus a hoodie plus MMA is the entire joke; the 3D model is a generic curly-haired young man in a sleeveless hoodie and shorts. 9/21: Duane took the rename over a redraw on exactly that finding',
      role: 'grappler; a command-grab takedown that trips them flat, a flying knee dash, uppercut, and a multi-hit ground-and-pound',
      name: 'MARGIN', title: 'Forced Close', art: false,
      blurb: 'Takedown grab, flying knee, hold-down.',
      idea: 'NO NEW ART — the existing model is kept. The fighter id stays `hoodie` because every asset and stat table is keyed on it, but nothing a player sees says hoodie, coder or cage any more. A margin call is a takedown, so the new name describes the grappler rather than the man it used to be.',
      story: 'It is not angry with you. Your collateral fell below the line and it has one job.',
      taunt: 'GG',
      say: { 'GROUND N POUND': 'LIQUIDATED' },
    },

    chop: {
      was: 'Bruce Lee — shirtless, black trousers with a red sash, red headband, nunchaku, "WATAA". Bruce Lee Enterprises enforces this likeness hard',
      role: 'fast and light; a chain-weapon multi-hit flurry, a lunging dragon kick, a rising kick, and a double sweep that trips',
      name: 'WHIP', title: 'Whipsaw',
      blurb: 'Fast and light. Chain flurry, lunge kick, double sweep.',
      idea: 'A lean long-limbed marten in a cropped sleeveless wrap-top — clothed, not bare-chested. Sleek russet fur, cream throat, a long banded tail used for balance. The chain flail has two hexagonal block-shaped weights instead of wooden handles. No headband, no sash. The whole animal is built to change direction mid-move, which is what the sweeps and the flurry do.',
      story: 'Two blocks on a chain, swung very fast. That is all it is, and it is enough.',
      look: { fur: '#c9743a', belly: '#f0e0c8', ear: '#141010', dark: '#2a1208', acc: 'none' },
      taunt: 'TOO SLOW',
      say: { WATAA: 'SNAP' },
    },

    bogdanoff: {
      was: 'the Bogdanoff twins — named outright, and the face is modelled on them',
      role: 'tricky mid; a red-candle shot angled to spike them downward, a pump dash, a pump rise, and a counter. Rage trait',
      name: 'DEALER', title: 'House Edge',
      blurb: 'Tricky. Red-candle spikes, pump jump, counter.',
      idea: 'A tall, thin, immaculately dressed figure in a black double-breasted coat with a stiff high collar. The head is a smooth featureless porcelain oval with one thin red horizontal slot. White gloves. One hand always holds a fan of candle-shaped cards, red on one face and green on the other, and it flicks one at you — which is the projectile, and the reason it only ever comes out red.',
      story: 'It deals from a deck with two cards in it and it has never once dealt you the green one.',
      look: { fur: '#e8e4dc', belly: '#15151a', ear: '#ff3b30', dark: '#0c0c10', eye: 'dot' },
      taunt: 'COME ON',
      say: { 'HE BOUGHT?': 'YOU BOUGHT?', 'HE SOLD': 'YOU SOLD' },
    },

    gigachad: {
      was: 'Ernest Khalimov — the GigaChad meme is a photo set of a real model, and the black-and-white treatment in the render is the photograph',
      role: 'bruiser; a charged punch, an armoured dash (armor 70), a rise, a flex shockwave, plus a unique parry that pumps him up instead of hitting back',
      name: 'MARBLE', title: 'Unbroken',
      blurb: 'Bruiser. Armored dash, charged punch, flex shockwave.',
      idea: 'A classical statue that got up and walked. Veined white marble torso and limbs with visible chisel facets, one forearm and one shin still rough-hewn and unfinished, a blank sculpted face with drilled pupils, and a section of the chest broken open showing a lattice of gold kintsugi repair seams. Moves with a grinding weight. The stone is why the dash has armour, and the greyscale tile is now on purpose.',
      story: 'Carved for a plaza that got rugged. It walked off the plinth and it has been taking hits ever since.',
      look: {},   // the shipped greyscale already fits, and now it has a reason
      trait: 'Kintsugi',
      taunt: 'COME ON',
      say: { CHAD: 'SOLID', GIGA: 'MARBLE' },
    },

    // ============ (b-lite) art already passes — the name and the move names were the tell ============

    tyrant: {
      was: 'the art is an original black-and-gold armoured demon-cat, but "Space Emperor" + finger laser + SUPERNOVA is Frieza\'s kit by name',
      role: 'floaty zoner; a piercing finger laser, a hover recovery, and a huge slow charged orb',
      name: 'TYRANT', title: 'Void Sovereign', art: false,
      blurb: 'Floaty. Finger laser, hover, Black Swan.',
      idea: 'No new art. The render is already an original creature — keep it.',
      story: 'It has outlived four chains and it is bored of all of them.',
      taunt: 'KNEEL',
      say: { SUPERNOVA: 'BLACK SWAN' },
    },

    omen: {
      was: 'the art was already redrawn in a robe for moderation and now reads original, but "Psi Clone" + SHADOW ORB + teleport + disable is Mewtwo\'s kit by name',
      role: 'tall floaty zoner; a charged shadow orb, a reflect that turns them around, teleport, and a flash that stuns a grounded opponent',
      name: 'OMEN', title: 'Forked Mind', art: false,
      blurb: 'Tall and floaty. Dark Pool orb, teleport, disable.',
      idea: 'No new art. Keep the hooded blue figure.',
      story: 'Two minds that disagreed, still walking around in the one body that lost.',
      taunt: 'THINK',
      say: { 'SHADOW ORB': 'DARK POOL' },
    },

    spark: {
      was: 'nothing in the art — it is a yellow rodent in goggles with a squirrel tail, no red cheeks and no bolt tail. Only "Volt Critter" pointed anywhere',
      role: 'light and fast; a jolt that crawls along the floor and wraps the stage, a charged bash, a zip recovery, and a thunderclap',
      name: 'SPARK', title: 'Live Wire', art: false,
      blurb: 'Light and fast. Floor-crawling jolt, zig-zag dash.',
      idea: 'No new art.',
      story: 'It chewed through a validator cable once and has been like this ever since.',
      taunt: 'STATIC',
      say: {},
    },

    wisp: {
      was: 'nothing in the art. "Psi Sprite" was the only pointer, and it does not match the trait it already has (Drifter)',
      role: 'tiny, three air jumps; a slow heavy bubble, a lift dash, teleport, and a barrier that both counters and reflects',
      name: 'WISP', title: 'Drift Sprite', art: false,
      blurb: 'Tiny, three air jumps. Bubble, blink, barrier.',
      idea: 'No new art.',
      story: 'Somebody\'s lost change, drifting, and it has opinions about being spent.',
      taunt: 'WHEEE',
      say: {},
    },
  },

  // ---- applying it ----
  // A move def is a nest of objects (ground/air/land/hold/counterHit/def) with hitboxes that can carry
  // a `cgrab` holding another def. Rather than know every shape, walk it and remap any shout/sigText
  // that matches. Circular refs are real here (a slam's land def), hence `seen`.
  KEYS: ['shout', 'sigText'],
  SUBS: ['ground', 'air', 'land', 'hold', 'counterHit', 'def', 'cgrab'],
  remap(def, map, seen) {
    if (!def || typeof def !== 'object' || seen.has(def)) return;
    seen.add(def);
    for (const k of ORIGINS.KEYS) { const v = def[k]; if (typeof v === 'string' && map[v]) def[k] = map[v]; }
    for (const k of ORIGINS.SUBS) if (def[k]) ORIGINS.remap(def[k], map, seen);
    if (Array.isArray(def.hits)) for (const h of def.hits) ORIGINS.remap(h, map, seen);
  },

  // every string this fighter could shout, old -> new. Also used to catch the ones that are hardcoded
  // inside a move's tick() as MV2.say(f, 'MOON WAVE') and cannot be patched on the data.
  SAY: {},

  applyOne(id) {
    const d = ORIGINS.DATA[id], c = typeof CHAR_BY_ID !== 'undefined' && CHAR_BY_ID[id];
    if (!d || !c) return;
    if (d.name) c.name = d.name;
    if (d.title) c.title = d.title;
    if (d.blurb) c.blurb = d.blurb;
    if (d.taunt) c.taunt = d.taunt;
    if (d.look) for (const k in d.look) c.look[k] = d.look[k];
    const map = d.say || {};
    if (Object.keys(map).length) {
      const seen = new Set();
      for (const m of [c.moves, c.moves2]) if (m) for (const k in m) ORIGINS.remap(m[k], map, seen);
      for (const k in map) ORIGINS.SAY[k] = map[k];
    }
    // TRAIT (66_traits.js) is a `const` in a file that sorts AFTER this one, and `typeof` does NOT
    // protect you from a const in its temporal dead zone — it throws a ReferenceError, which would
    // abort the whole concatenated bundle and leave `Game` undeclared. try/catch is the only safe
    // way to touch a binding that may not have been evaluated yet. Same for VO on a re-run.
    if (d.trait) { try { if (TRAIT[id]) TRAIT[id].name = d.trait; } catch (e) {} }
    if (d.voice === false) { try { if (VO.PACKS) delete VO.PACKS[id]; } catch (e) {} }
  },

  applied: false,
  apply() {
    // one fighter failing must never take the bundle down with it
    for (const id of ORIGINS.TEXT) { try { ORIGINS.applyOne(id); } catch (e) { try { console.warn('origins', id, e); } catch (e2) {} } }
    ORIGINS.applied = true;
  },
};

// URL / stored override, so a swap can be looked at without editing this file:
//   ?origins=all | none | giga,ronin      which fighters get the text swap
//   ?originsArt=all | none | giga,...     which fighters get the new art (defaults to the text list)
(function () {
  // 'all' / 'none' / a comma list of ids -> a list of ids this file knows about
  const list = v => (v === 'all' ? Object.keys(ORIGINS.DATA)
    : v === 'none' || v === '' ? []
      : v.split(',').map(s => s.trim()).filter(s => ORIGINS.DATA[s]));
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) {}
  const get = k => {
    let v = q && q.get(k);
    if (v == null) try { v = store.get(k, null); } catch (e) {}
    return v;
  };
  const t = get('origins');
  if (t != null) {
    ORIGINS.TEXT = list(t);
    // art follows the text list, minus the four that keep their art on purpose
    ORIGINS.ART = ORIGINS.TEXT.filter(id => ORIGINS.DATA[id].art !== false);
  }
  const a = get('originsArt');
  if (a != null) ORIGINS.ART = list(a).filter(id => ORIGINS.DATA[id].art !== false);
})();

ORIGINS.apply();

// Second pass after the whole bundle has run: 66_traits.js (TRAIT), 67_unique.js (moves2) and
// 14_vo.js all sort AFTER this file, so anything they add has to be re-patched once they exist.
// Also wraps MV2.say, because a handful of shouts are hardcoded inside a move's tick() rather than
// sitting on the move data where remap() can reach them.
(function () {
  const late = () => {
    if (!ORIGINS.TEXT.length) return;
    ORIGINS.apply();
    try {
      if (typeof MV2 !== 'undefined' && MV2.say && !MV2.say.__origins) {
        const say0 = MV2.say;
        const say = function (f, text, scale) { return say0.call(this, f, (typeof text === 'string' && ORIGINS.SAY[text]) || text, scale); };
        say.__origins = true; MV2.say = say;
      }
    } catch (e) {}
    // 12_audio.js re-registers VO.PACKS.topg inside its own install(), so drop it again here
    try {
      if (typeof VO !== 'undefined' && VO.PACKS && !VO.sync.__origins) {
        const sync0 = VO.sync;
        const sync = function (f) { if (f && f.c && ORIGINS.DATA[f.c.id] && ORIGINS.DATA[f.c.id].voice === false && ORIGINS.on(f.c.id)) return; return sync0.call(this, f); };
        sync.__origins = true; VO.sync = sync;
      }
    } catch (e) {}
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(late); else setTimeout(late, 0);
})();

// the one hook every art loader goes through (declared in 10_core.js as the identity function)
ASSET_ID = id => (ORIGINS.ART.indexOf(id) >= 0 ? id + ORIGINS.SUF : id);

try { window.ORIGINS = ORIGINS; } catch (e) {}
