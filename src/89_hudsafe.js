// ===== keep the corner buttons out of the HUD =====
//
// 71_hud.js owns ONE layout budget for everything drawn over the arena, and says so: "`top`/`bottom`
// are the HARD insets in CSS px: opaque chrome the action must stay clear of... the bars, the clock,
// the map name, the now-playing label, the controls tab". The camera obeys it. The two DOM buttons
// never did:
//
//   #ctrlBtn  (87_controls.js)  position:fixed; left:14px; bottom:14px
//   #sndBtn   (12_audio.js)     position:fixed; left:16px; bottom:16px   [data-pos=bottom]
//
// So in a 3-4 fighter match, where the HUD puts its player plates along the bottom (inset 104px),
// both buttons sit ON TOP of player 1's card — the sound icon covers the portrait and the "Controls"
// tab clips the damage number. It is in every screenshot the graphics pass took, on every stage
// (dev/aaa/shots/, and other sessions' dev/stage_shots/live_dojo.png).
//
// This file changes no other file: it publishes the HUD's own bottom inset as a CSS variable and
// re-anchors the two buttons to it. Menus are unaffected (the inset is 0 outside a match).

(() => {
  const st = document.createElement('style');
  // `html body` prefixes, because 12_audio.js builds #sndBtn's stylesheet lazily (when the button is
  // first created) and so appends it AFTER this one: matching specificity would lose the cascade.
  st.textContent =
    'html body #ctrlBtn{bottom:calc(max(14px,env(safe-area-inset-bottom)) + 8px + var(--tb-hud-bottom,0px));' +
      'left:calc(max(14px,env(safe-area-inset-left)) + 46px)}' +
    // never let the two stack on each other: sound in the corner, controls tab beside it
    'html body #sndBtn[data-pos=bottom]{bottom:calc(env(safe-area-inset-bottom) + 16px + var(--tb-hud-bottom,0px));' +
      'left:max(16px,env(safe-area-inset-left))}';
  document.head.appendChild(st);

  let last = -1;
  function apply() {
    let inset = 0;
    try {
      // Not `state === 'match'`: the attract demo on the title screen draws the same player cards
      // while the state is still 'title', which is exactly where the overlap was first caught.
      // The test is "are the HUD cards on screen", i.e. fighters exist and no menu covers them.
      const covered = window.TB_MENU_COVERS ? TB_MENU_COVERS() : false;
      const showing = typeof Game !== 'undefined' && Game.fighters && Game.fighters.length && !covered;
      if (showing && window.TB_HUD && TB_HUD.layout) {
        const touch = typeof IS_TOUCH_UI === 'function' ? IS_TOUCH_UI() : false;
        const L = TB_HUD.layout(innerWidth, innerHeight, Game.fighters.length, touch);
        inset = Math.max(0, L.bottom | 0);
      }
    } catch (e) { inset = 0; }                 // never let a HUD hiccup break the page
    if (inset !== last) { last = inset; document.documentElement.style.setProperty('--tb-hud-bottom', inset + 'px'); }
    requestAnimationFrame(apply);
  }
  requestAnimationFrame(apply);
})();
