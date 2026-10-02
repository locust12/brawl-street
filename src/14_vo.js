// ===== fighter voice lines: the trigger points =====
// Page-only (build.py's SIM_FILES never includes 1x files), so the headless fight engines and the bet
// arena never load it. It adds nothing to the fight: it listens to what already happened and asks
// GameAudio to say a line. Everything degrades to silence when a clip is missing.
//
// GameAudio (12_audio.js) already plays four kinds - atk, hurt, sp, ko - keyed `<type>_<kind>` out of
// the `voices` bank. This file adds the two Duane asked for:
//   taunt  when the fighter taunts (Shield + Up, 21_roster2.js TAUNT)
//   win    when the results screen comes up for the winner
//
// ---- FOR THE AUDIO AGENT: what to record for OG BOBBY (fighter id `bling`) ----
// Voice type name: `ogbobby`. Gangster tone, dry, no music bed, mono, same loudness as the other packs.
//   ogbobby_taunt  "WAGWAN MY G"            (taunt)
//   ogbobby_ko     "THAT AIN'T COOL YOOO"   (his own KO, the long one)
//   ogbobby_hurt1  "MY G"                   (short, taking a hit)
//   ogbobby_hurt2  "THAT AIN'T COOL YO"     (short, taking a hit)
//   ogbobby_win    "WHAT U SAYING?"         (victory screen)
//   ogbobby_atk1   "MY G"                   (swing effort, clipped)
//   ogbobby_atk2   "YO"                     (swing effort, clipped)
//   ogbobby_sp     "WHAT U SAYING?"         (special move)
// Ship them in the existing sheet `assets/audio/voices.mp4` and add the offsets to SPR.voices in
// 12_audio.js (that is how every other pack is loaded). Separate files work too, as
// `assets/audio/vo_ogbobby_<key>.mp4` - this file switches the pack on as soon as the keys exist.
const VO = {
  // fighter id -> voice pack, used once its clips are in the bank (audio session, 9/20: both packs
  // are recorded and live in assets/audio/voices.mp4 — see SPR.voices in 12_audio.js)
  PACKS: { bling: 'ogbobby', topg: 'topg' },
  ready(type) {
    try {
      const S = GameAudio && GameAudio.SPR && GameAudio.SPR.voices;
      return !!(S && (S[type + '_ko'] || S[type + '_taunt']));
    } catch (e) { return false; }
  },
  // swap a fighter's voice over the moment the pack is available (checked on every line, costs nothing)
  sync(f) {
    if (!f || !f.c) return;
    const want = this.PACKS[f.c.id];
    if (!want || !this.ready(want)) return;
    try { const V = GameAudio.VOICE; if (!V[f.c.id] || V[f.c.id][0] !== want) V[f.c.id] = [want, 1]; } catch (e) {}
  },
  say(f, kind, prio) {
    if (!f) return;
    this.sync(f);
    try { GameAudio && GameAudio.say && GameAudio.say(f, kind, prio || 1); } catch (e) {}
  },
};

// installed after the whole bundle has run: this file sorts before 40_fighter.js and 60_game.js, so
// Fighter and Game do not exist yet while it loads
function voInstall() {
  if (typeof Fighter === 'undefined' || typeof Game === 'undefined') return;
  // taunt: Shield + Up plays a move with the taunt clip (21_roster2.js TAUNT)
  const start0 = Fighter.prototype.startMove;
  Fighter.prototype.startMove = function (def) {
    const r = start0.call(this, def);
    if (def && def.clip === 'taunt') VO.say(this, 'taunt', 2);
    return r;
  };
  // win: said once, for the fighter left standing
  const finish0 = Game.finish;
  Game.finish = function () {
    const w = this.winner;
    if (w && w.c && !this.demo && !this.arena) VO.say(w, 'win', 4);
    return finish0.call(this);
  };
}
if (typeof queueMicrotask === 'function') queueMicrotask(voInstall); else setTimeout(voInstall, 0);
