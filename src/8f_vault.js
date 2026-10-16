// ===== THE VAULT, on screen: a shadow with a question mark where the secret content sits =====
//
// Duane, 2026-10-16: *"you should make 2 of the maps be a shadow with a question mark and make them
// purchaseable to unlock like secret maps"*, then *"also make one of the characters a secret one
// choose one that seems the most like mew/mewto put it dark and make it unlockable by paying"*.
//
// The catalogue is `CAT.vault` in 89_econ.js, the gate is `vaultOpen()` in 79_core.js and the shelf
// that sells them is the Vault category in 8b_store.js. This file is the two LOCKED SLOTS:
//   - the stage picker gets a shadowed card per unowned secret stage
//   - the select screen gets a shadowed tile for the secret fighter
// Both are drawn from the REAL art (the stage's own backdrop, the fighter's own cutout) put into
// pure silhouette by a CSS filter, so a locked slot can never show the wrong thing, and tapping one
// opens the shop on the item it is hiding.
//
// WHY THIS IS A SEPARATE FILE: 85_menu.js already wraps `UI.renderWager` and `UI.renderSelect` and
// is the busiest file in the project. Loading after it (sorted: 89_econ.js, then 8f_vault.js) means
// these wrappers run LAST, so the locked cards land after the real cards and after the Random card
// has been put at the front -- which is exactly the order they should read in.
//
// THE ONE RULE THAT MATTERS HERE: a locked card carries no `data-stage`. The Random card builds its
// pool from `.stagec[data-stage]` (85_menu.js), so without that attribute Random can never roll a
// stage the player has not unlocked -- and the pool stays honest without a second list to maintain.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined' || typeof Econ.vaultLocked !== 'function') return;

  // ---- THE LOCK, drawn rather than typed ---------------------------------------------------
  // Duane, 2026-10-16: *"the question marks look cheap on the character select"* / *"question marks
  // on the maps also look cheap"* / *"change the graphic no cheap question mark"*, and underneath
  // it the standing rule: go and copy what the real games do.
  //
  // So I went and looked at three, which is what should have happened first:
  //   1. SUPER SMASH BROS. MELEE, locked slot: the tile keeps the EXACT frame, bevel and plate of a
  //      real fighter tile, and the mark is a solid glyph stamped into that plate with a shadow. It
  //      is a slot in the same cabinet, never a black hole in the grid.
  //   2. SUPER SMASH BROS. ULTIMATE, random panel: the mark is a chunky FILLED object -- light fill,
  //      heavy dark outline, hard offset drop shadow, tilted -- sitting on the same tile art as
  //      every other fighter. There is no glow anywhere on it.
  //   3. BRAWLHALLA / MULTIVERSUS, locked legend: the thing is shown dimmed rather than hidden, with
  //      a PADLOCK and the PRICE on the tile, which is what makes it read as buyable instead of
  //      broken.
  // What I had shipped was the opposite of all three: a 2px transparent outline of a "?" with a
  // purple neon glow, floating on a near-black tile with a purple border I invented.
  //
  // The mark is now a drawn padlock, not a typed character: a shackle and a body with a brushed
  // metal gradient, a heavy dark outline and a hard shadow, which is (3)'s badge built the way (2)
  // builds its glyph. Both ids are fixed; several copies on one page resolve to the first identical
  // gradient, which is what we want anyway.
  const LOCK = '<svg class="vlk" viewBox="0 0 48 56" aria-hidden="true">'
    + '<defs><linearGradient id="vlkM" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#f4f7fb"/><stop offset=".46" stop-color="#b3becd"/>'
    + '<stop offset=".47" stop-color="#8b97a9"/><stop offset="1" stop-color="#59667a"/>'
    + '</linearGradient></defs>'
    + '<path d="M14 25v-8a10 10 0 0 1 20 0v8" fill="none" stroke="#090b11" stroke-width="10.5" stroke-linecap="round"/>'
    + '<path d="M14 25v-8a10 10 0 0 1 20 0v8" fill="none" stroke="url(#vlkM)" stroke-width="5.5" stroke-linecap="round"/>'
    + '<rect x="4" y="22" width="40" height="31" rx="6" fill="#090b11"/>'
    + '<rect x="7.5" y="25.5" width="33" height="24" rx="4" fill="url(#vlkM)"/>'
    + '<circle cx="24" cy="35" r="4.2" fill="#090b11"/>'
    + '<rect x="22.3" y="35" width="3.4" height="9" rx="1.7" fill="#090b11"/>'
    + '</svg>';

  const css = `
  /* ---- the lock itself: one object, two sizes ---------------------------------------------- */
  .vlk{display:block;filter:drop-shadow(3px 4px 0 rgba(0,0,0,.55))}

  /* ---- a locked stage card ---------------------------------------------------------------- */
  .stagec.vlock{cursor:pointer}
  /* Dark enough to read as a shadow, light enough that there is still a PLACE under it. At
     brightness(0) a stage card is a black rectangle: a landscape has no silhouette to recognise the
     way a character does, so the thing being hidden has to still be faintly there.
     THE NUMBER CAME OFF A MEASUREMENT, not off a guess (dev/vaultprobe.mjs): the stage art behind
     these two cards has a mean luminance of 0.118 (Shadow Keep, already the darkest stage in the
     game) and 0.273 (Neon Rooftop), so an earlier brightness(.17) put them at 0.02 and 0.05 -- both
     effectively black, and the first screenshot of this feature looked like two missing images.
     Greyscale does the "hidden" work instead of brightness, which keeps the highlights that make a
     place readable: Shadow Keep's two lanterns still glow through it. */
  .stagec.vlock canvas{filter:grayscale(.92) brightness(.46) contrast(1.12)}
  /* The card keeps the picker's own frame (.stagec::after in 01_head.html). Nothing purple, no
     invented border: reference (1), the slot belongs to the same cabinet as every other card. */
  .stagec.vlock .vlk{position:absolute;left:50%;top:44%;z-index:2;width:54px;transform:translate(-50%,-50%);pointer-events:none}
  .stagec.vlock div{z-index:3}
  .stagec.vlock .pr{display:inline-block;margin-left:7px;padding:1px 6px;border-radius:3px;
    background:var(--gold);color:#120d02;font:900 11px var(--ui);font-style:normal;letter-spacing:.02em;vertical-align:1px}
  @media (max-width:560px){.stagec.vlock .vlk{width:42px}}

  /* ---- a locked roster tile ------------------------------------------------------------------
     Same plate, same clip-path and same 1px frame as a real .pick (01_head.html), copied verbatim
     rather than restyled: reference (1) again. The only differences are the silhouette and the
     padlock, which is the whole point of the slot. */
  .vpick{--c:var(--line2);position:relative;aspect-ratio:1;padding:0;border:0;cursor:pointer;overflow:hidden;background:
    linear-gradient(160deg,rgba(255,42,74,.18),transparent 45%),linear-gradient(340deg,rgba(42,107,255,.2),transparent 45%),linear-gradient(#141722,#0a0b11);
    clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));transition:transform .12s,filter .12s}
  .vpick::after{content:"";position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);pointer-events:none}
  .vpick:hover{transform:translateY(-2px);filter:brightness(1.15)}
  .vpick .face{position:absolute;inset:0;background-repeat:no-repeat;background-size:150% auto;background-position:50% 2%;
    filter:brightness(0) contrast(1.4);opacity:.95}
  .vpick .vlk{position:absolute;left:50%;top:46%;width:34px;transform:translate(-50%,-50%);pointer-events:none}
  .vpick .nm{position:absolute;left:0;right:0;bottom:0;padding:10px 3px 3px;font-family:var(--display);font-style:italic;
    font-weight:800;font-size:12px;letter-spacing:.02em;text-transform:uppercase;text-align:center;color:var(--text);
    background:linear-gradient(transparent,rgba(5,5,7,.92) 55%);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .vpick .nm b{display:block;font-family:var(--ui);font-style:normal;font-weight:900;font-size:10px;color:var(--gold);letter-spacing:.02em}
  #roster.core .vpick .nm{font-size:12px;padding:10px 3px 4px}
  @media (max-height:640px){#roster.core .vpick .nm{font-size:10px;padding:8px 2px 3px}#roster.core .vpick .vlk{width:28px}}
  `;
  // 8b_store.js renders the shop's vault cards and wants the same object; it loads before this file
  // but only reads this at render time.
  window.VaultArt = { lock: LOCK };
  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }
  const sfx = () => { try { Sfx.ui(); } catch (e) { /* audio locked */ } };
  const open = () => { try { EconUI.openVault(); } catch (e) { /* no store in this build */ } };

  // ---- the stage picker ------------------------------------------------------------------------
  function lockedStages() {
    const sb = document.getElementById('stages'); if (!sb) return;
    for (const old of [...sb.querySelectorAll('.vlock')]) old.remove();
    for (const v of Econ.vaultLocked('stage')) {
      const b = document.createElement('button');
      b.className = 'stagec vlock';
      b.title = 'Secret stage';
      // no data-stage, on purpose: see the header. Random rolls from data-stage and must not see this.
      b.innerHTML = '<canvas width="480" height="240"></canvas>' + LOCK
        // NO "???" ANYWHERE. Duane, twice: *"Remove the question marks man.. it looks cheap"*.
        // Melee's locked slot carries no label at all and Brawlhalla's carries the price; a row of
        // typed question marks is neither, and it is the last cheap thing on this card.
        + '<div>Locked<small>Secret stage<span class="pr">' + Econ.money(v.price) + '</span></small></div>';
      sb.appendChild(b);
      // the stage's own backdrop, in shadow (UI.paintStage draws assets/bg_<id>.jpg, 85_menu.js)
      try { UI.paintStage(b.querySelector('canvas'), v.unlocks); } catch (e) { /* procedural fallback */ }
      b.addEventListener('click', () => { sfx(); open(); });
    }
  }

  // ---- the select screen -----------------------------------------------------------------------
  // The tile is NOT a `.pick`. 85_menu.js counts `.pick` tiles to decide whether to rebuild the
  // roster, indexes `coreChars()` by the position of a `.pick` for keyboard nav, and paints the
  // "who picked what" badges over them -- a locked tile in that set would offset all three by one.
  function lockedChars() {
    const ro = document.getElementById('roster'); if (!ro) return;
    for (const old of [...ro.querySelectorAll('.vpick')]) old.remove();
    for (const v of Econ.vaultLocked('fighter')) {
      const b = document.createElement('button');
      b.className = 'vpick';
      b.title = 'Secret fighter';
      b.innerHTML = '<span class="face"></span>' + LOCK + '<span class="nm">Locked<b>' + Econ.money(v.price) + '</b></span>';
      try {
        const id = typeof ASSET_ID === 'function' ? ASSET_ID(v.unlocks) : v.unlocks;
        b.querySelector('.face').style.backgroundImage = 'url(assets/' + id + '_cut.webp)';
      } catch (e) { /* no cutout: the plate and the question mark still read */ }
      b.addEventListener('click', () => { sfx(); open(); });
      ro.appendChild(b);
    }
  }

  function wrap(name, fn) {
    if (typeof UI === 'undefined' || typeof UI[name] !== 'function') return;
    const orig = UI[name];
    UI[name] = function () {
      const r = orig.apply(this, arguments);
      // never let a locked card be the reason a menu does not open
      try { style(); fn(); } catch (e) { /* ignore */ }
      return r;
    };
  }
  wrap('renderWager', lockedStages);
  wrap('renderSelect', lockedChars);

  // A purchase has to land on screen without a reload: the server answers `buyres`, Econ caches the
  // new entitlement list, and both screens are rebuilt from it. Whichever one is open redraws, which
  // is how the shadow card turns into the real stage the moment it is paid for.
  try {
    if (typeof Net !== 'undefined' && Net.on) Net.on(m => {
      if (m.k !== 'buyres' && m.k !== 'econ') return;
      try { if (typeof UI !== 'undefined' && UI.renderWager && !document.getElementById('scWager').hidden) UI.renderWager(); } catch (e) {}
      try { if (typeof UI !== 'undefined' && UI.renderSelect && !document.getElementById('scSelect').hidden) UI.renderSelect(); } catch (e) {}
    });
  } catch (e) { /* no net in this build */ }
})();
