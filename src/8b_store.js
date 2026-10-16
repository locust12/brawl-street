// ===== ECONOMY UI: the store, the arsenal panel, the profile / bragging screen =====
// Reads Econ (89_econ.js) and Items3 (57_items3.js). UI only: never touches fight state, never the
// seeded Rng. Design + reasoning: docs/ECONOMY.md.
//
// Where the arsenal button sits: top-left, BELOW the 1v1 HUD bars (they run y 12..126 on the left),
// so it never covers a damage meter. `window.TB_ARSENAL_RECT` publishes the box it takes, and it
// honours `window.TB_HUD_SAFE_TOP` if the HUD session sets one — that is the handshake between us.
(() => {
  if (typeof document === 'undefined' || typeof Econ === 'undefined') return;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const byId = id => document.getElementById(id);
  const sfx = k => { try { Sfx[k || 'ui'](); } catch (e) { /* audio locked */ } };
  const M = Econ.money;
  // The shop told everybody to "Tap" and "Shift-tap" on a desktop build with a mouse. Read the input
  // once and write the copy for the thing the player is actually holding.
  const TOUCH = (() => { try { return matchMedia('(hover:none) and (pointer:coarse)').matches; } catch (e) { return false; } })();

  const css = `
  #scStore .wrap,#scProfile .wrap{width:min(1240px,100%)}

  /* ---- the shop, rebuilt 2026-10-14 to read like a real one -------------------------------- */
  /* The key art was showing through behind every shelf, which is why the grid looked noisy and the
     cards looked washed out. A shop is a catalogue: the items are the only thing competing for the
     eye. Solid plate, one accent per rarity, art on top, price always visible. */
  #scStore{background:#05070b}
  #scStore::before{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(1200px 500px at 50% -10%,rgba(255,42,74,.10),transparent 70%),
               repeating-linear-gradient(0deg,rgba(255,255,255,.02) 0 1px,transparent 1px 3px)}
  #scStore .wrap{position:relative}
  .card{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));
    border-radius:12px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc,#8fa3b0) 38%,transparent),0 10px 26px -14px #000;
    min-height:230px;gap:8px;overflow:hidden}
  .card::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--rc,#8fa3b0);opacity:.85}
  .card:hover{transform:translateY(-3px);
    box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc,#8fa3b0) 70%,transparent),0 16px 34px -14px #000,0 0 26px -6px color-mix(in srgb,var(--rc,#8fa3b0) 45%,transparent)}
  /* THE RARITY FIELD. Fortnite puts the rarity behind the object as a vertical gradient, dark at the
     top and saturated at the bottom, and the object is lit and fills the tile. That is what makes a
     Legendary look like one; recolouring the drawing itself (what we did before) makes every tier
     the same picture in a different tint. */
  .card .ic{position:relative;display:grid;place-items:center;height:132px;margin:0 0 2px;border-radius:10px;
    overflow:hidden;font-size:34px;
    background:linear-gradient(170deg,
      color-mix(in srgb,var(--rc,#8fa3b0) 8%,#0b0d11) 0%,
      color-mix(in srgb,var(--rc,#8fa3b0) 26%,#0b0d11) 62%,
      color-mix(in srgb,var(--rc,#8fa3b0) 46%,#0b0d11) 100%)}
  /* a soft pool of light under the object, so it sits on the card instead of floating */
  .card .ic::before{content:"";position:absolute;left:12%;right:12%;bottom:6px;height:16px;border-radius:50%;
    background:radial-gradient(50% 50% at 50% 50%,rgba(0,0,0,.55),transparent 70%)}
  /* 15 Oct: this was position:relative with height:100%, which never resolved because .ic has no
     definite height -- so a 640x640 render laid out 212x212 inside a 212x132 box and had 80px cut
     off top and bottom. Absolute inset:0 gives the image the box's real size to fit inside. */
  .card .ic .ia{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;
    filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
  .card:hover .ic .ia{transform:scale(1.06)}
  .card .ic .ia{transition:transform .18s ease}
  @media (prefers-reduced-motion:reduce){.card .ic .ia{transition:none}.card:hover .ic .ia{transform:none}}
  .card .ic svg{display:block}
  /* rarity written out in a filled pill, the way CS2 does it, so nobody has to learn what blue means */
  .card .rar{align-self:flex-start;font:800 9px var(--mono);letter-spacing:.16em;text-transform:uppercase;
    color:#0a0d12;background:var(--rc,#8fa3b0);padding:3px 8px;border-radius:999px;line-height:1.2}
  .card .nm{font-size:19px}
  .card .pr{font:800 16px var(--mono);color:var(--gold);display:inline-flex;align-items:center}
  .card .pr .ok{color:var(--lime);font:800 8.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;
    margin-left:7px;padding:2px 5px;border-radius:3px;background:rgba(61,255,138,.12);box-shadow:inset 0 0 0 1px rgba(61,255,138,.35)}
  .card.lock .ic{filter:none;opacity:.55}
  .card.lock:hover .ic{opacity:.9}
  .shelf-h{display:flex;align-items:baseline;gap:12px}
  .shelf-h .dot{width:9px;height:9px;border-radius:2px;transform:rotate(45deg);display:inline-block}

  .st-top{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
  .st-tabs{display:flex;gap:2px;flex-wrap:wrap}
  .st-tabs button{min-height:38px;padding:0 16px;font:700 13px var(--ui);color:var(--muted);background:rgba(255,255,255,.04);border:0;box-shadow:inset 0 0 0 1px var(--line);cursor:pointer}
  .st-tabs button.on{color:#fff;background:var(--red);box-shadow:none}
  .st-note{font-size:13px;color:var(--muted);max-width:74ch;line-height:1.5}
  .st-note b{color:var(--gold)}
  .shelf{display:flex;flex-direction:column;gap:10px}
  .shelf h3{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;line-height:.9;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .shelf .sub{font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:10px}
  .card{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px;min-height:168px;background:var(--glass);box-shadow:inset 0 0 0 1px var(--line);
    cursor:pointer;transition:transform .15s,box-shadow .2s;overflow:hidden;text-align:left}
  .card:hover{transform:translateY(-2px);box-shadow:inset 0 0 0 1px var(--line2)}
  .card .ic{font-size:30px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
  .card .nm{font-family:var(--display);font-style:italic;font-weight:900;font-size:22px;line-height:.95;text-transform:uppercase;color:var(--text)}
  .card .bl{font-size:12.5px;color:var(--muted);line-height:1.45;flex:1}
  .card .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:auto}
  .card .pr{font:800 16px var(--mono);color:var(--gold)}
  .card .tag{font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:3px 7px;background:rgba(255,255,255,.08);color:var(--muted)}
  .card.owned{box-shadow:inset 0 0 0 1px rgba(61,255,138,.4)}
  .card.owned .pr{color:var(--lime);font-size:13px}
  .card.eq{box-shadow:inset 0 0 0 2px var(--cyan)}
  .card.load{box-shadow:inset 0 0 0 2px var(--gold)}
  /* 15 Oct: this used to be filter:brightness(0) -- a deliberate blacked-out silhouette for
     anything unowned. It is the single reason Duane kept seeing "all the images are dark, I cannot
     even see what it is": with payments off almost nothing is owned, so almost EVERY card in the
     shop was crushed to a black rectangle, cosmetics worst of all because the dev grant does not
     cover them. No shop worth copying hides the thing it is selling -- CS2, Fortnite, Roblox and
     Lord Nine all show the item at full brightness and let the price and a padlock carry the state.
     Locked now reads through the FRAME, not by destroying the art. */
  .card.lock .ic{opacity:.92}
  .card.lock .ic::after{content:"";position:absolute;inset:0;pointer-events:none;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.14), inset 0 0 22px rgba(5,6,10,.45)}
  .card.lock .nm{color:var(--muted)}
  .card.lock .bl{color:var(--dim)}
  .card.lock::after{content:"";position:absolute;inset:0;background:linear-gradient(160deg,rgba(5,5,7,.10),rgba(5,5,7,.22));pointer-events:none}
  .card.lock .ft,.card.lock .lk{position:relative;z-index:2}
  /* the padlock, drawn and in the corner the locker already uses */
  .card .lk{position:absolute;right:9px;top:9px;width:15px;height:15px;color:rgba(255,255,255,.62);z-index:3;
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))}
  /* ---- the footer: one control, and the price is written on it ------------------------------- */
  /* A fixed height is the whole fix for "the $14.99 cards are taller than their neighbours": the old
     footer was price + a word, and at 5 characters the word wrapped and pushed the card down. */
  .card .ft{min-height:34px;align-items:center}
  .card .buy{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:0 13px;
    font:800 12px var(--ui);letter-spacing:.02em;color:var(--text);background:rgba(255,255,255,.07);
    box-shadow:inset 0 0 0 1px var(--line2);white-space:nowrap;order:2;margin-left:auto}
  /* for sale: filled, in the game's own red, with the price as the label. Nothing else to find. */
  .card .buy.go{color:#fff;background:var(--red);box-shadow:none;font:800 15px var(--mono);letter-spacing:.01em}
  .card:hover .buy.go{filter:brightness(1.12)}
  .card .buy.on{color:#05070b;background:var(--lime);box-shadow:none}
  .card .alt{order:1;font:700 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--dim);white-space:nowrap}
  .card .alt s{opacity:.72}
  .card .alt b{color:var(--lime)}
  /* ---- the three arsenal slots ---------------------------------------------------------------- */
  .ars-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;max-width:820px}
  .ars-slot{position:relative;display:flex;flex-direction:column;gap:3px;padding:12px;min-height:188px;
    background:var(--glass);box-shadow:inset 0 0 0 1px var(--line);text-align:left}
  .ars-slot.full{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc,#8fa3b0) 55%,transparent)}
  .ars-slot .ic{position:relative;height:104px;border-radius:9px;overflow:hidden;display:grid;place-items:center;
    background:linear-gradient(170deg,color-mix(in srgb,var(--rc,#8fa3b0) 7%,#0b0d11),color-mix(in srgb,var(--rc,#8fa3b0) 34%,#0b0d11))}
  .ars-slot:not(.full) .ic{background:repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 9px,transparent 9px 18px);
    box-shadow:inset 0 0 0 1px var(--line)}
  .ars-slot b{font-family:var(--display);font-style:italic;font-weight:900;font-size:19px;line-height:1;
    text-transform:uppercase;color:var(--text);margin-top:7px}
  .ars-slot:not(.full) b{color:var(--dim)}
  .ars-slot span{font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .ars-x{margin-top:auto;align-self:flex-start;font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;
    color:var(--muted);background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px var(--line);border:0;padding:5px 9px;cursor:pointer}
  .ars-x:hover{color:#fff;background:var(--red);box-shadow:none}
  @media (max-width:640px){.ars-slots{grid-template-columns:1fr}}
  /* ---- the filter stack ------------------------------------------------------------------------ */
  .st-filters{display:flex;flex-direction:column;gap:7px;padding:11px 14px;background:rgba(5,7,11,.6);box-shadow:inset 0 0 0 1px var(--line)}
  .st-frow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .st-flab{min-width:52px;font:700 10px var(--mono);letter-spacing:.11em;text-transform:uppercase;color:var(--dim)}
  .st-chip{font:700 11px var(--ui);color:var(--muted);background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line);
    border:0;padding:6px 11px;cursor:pointer}
  .st-chip:hover{color:#fff}
  .st-chip.on{color:#fff;background:var(--red);box-shadow:none;font-weight:800}
  .st-find{flex:1;min-width:150px;max-width:320px;margin-left:auto;height:30px;padding:0 10px;border:0;
    font:600 12px var(--ui);color:var(--text);background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line)}
  .st-find::placeholder{color:var(--dim)}
  .card .how{display:none;font-size:12px;color:var(--text);line-height:1.5;border-top:1px solid var(--line);padding-top:6px;margin-top:2px}
  .card.open .how{display:block}
  .card .how i{display:block;color:var(--cyan);font-style:normal;font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;margin-top:5px}
  .card .how i + span{color:var(--muted)}
  .st-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;background:rgba(5,5,7,.55);box-shadow:inset 0 0 0 1px var(--line)}
  .st-xp{flex:1;min-width:180px;height:8px;background:rgba(255,255,255,.08);position:relative;overflow:hidden}
  .st-xp i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--red),var(--gold));box-shadow:0 0 12px rgba(255,200,61,.5)}
  .st-lv{font-family:var(--display);font-style:italic;font-weight:900;font-size:26px;color:var(--gold);line-height:1}
  /* ---- the in-match arsenal rail ---- */
  #arsBtn{position:fixed;left:16px;z-index:40;width:52px;height:52px;display:none;align-items:center;justify-content:center;
    font-size:23px;background:rgba(10,11,16,.82);box-shadow:inset 0 0 0 1px var(--line2),0 6px 18px rgba(0,0,0,.5);border:0;cursor:pointer;
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px)}
  #arsBtn.on{display:flex}
  #arsBtn:active{transform:scale(.94)}
  #arsBtn i{position:absolute;right:-3px;top:-3px;font:800 10px var(--mono);background:var(--red);padding:2px 4px;font-style:normal}
  #arsRail{position:fixed;left:16px;z-index:40;display:none;flex-direction:column;gap:6px;width:186px}
  #arsRail.on{display:flex}
  #arsRail .hd{font:700 10px var(--mono);letter-spacing:.11em;text-transform:uppercase;color:var(--dim);padding-left:2px}
  .ars-i{position:relative;display:flex;align-items:center;gap:9px;padding:8px 10px;background:rgba(10,11,16,.86);box-shadow:inset 0 0 0 1px var(--line2);
    cursor:pointer;text-align:left;border:0;color:#fff;overflow:hidden;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  .ars-i:hover{background:rgba(26,28,40,.92)}
  .ars-i .ic{font-size:21px}
  .ars-i .tx{min-width:0;flex:1}
  .ars-i .tx b{display:block;font:800 12.5px var(--ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ars-i .tx span{font:700 10px var(--mono);letter-spacing:.07em;color:var(--muted)}
  .ars-i .key{font:800 11px var(--mono);color:var(--dim);padding:2px 5px;box-shadow:inset 0 0 0 1px var(--line)}
  .ars-i.off{opacity:.42;pointer-events:none}
  .ars-i .cdf{position:absolute;inset:auto 0 0 0;height:2px;background:var(--cyan)}
  .ars-empty{padding:9px 10px;font-size:12px;color:var(--muted);background:rgba(10,11,16,.86);box-shadow:inset 0 0 0 1px var(--line)}
  /* ---- profile ---- */
  .pf{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:12px;align-items:start}
  .pf .panel{display:flex;flex-direction:column;gap:10px}
  .pf-big{font-family:var(--display);font-style:italic;font-weight:900;font-size:56px;line-height:.86;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px}
  .pf-stat{padding:9px 10px;background:rgba(5,5,7,.5);box-shadow:inset 0 0 0 1px var(--line)}
  .pf-stat b{display:block;font-family:var(--display);font-style:italic;font-weight:900;font-size:27px;line-height:1;color:var(--text)}
  .pf-stat span{font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  .pf-bad{display:flex;flex-wrap:wrap;gap:6px}
  .pf-bad .b{display:flex;align-items:center;gap:6px;padding:5px 10px;font:700 12px var(--ui);background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--line2)}
  .pf-show{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:6px}
  .pf-show div{padding:9px;background:rgba(5,5,7,.5);box-shadow:inset 0 0 0 1px var(--line);text-align:center}
  .pf-show div .i{font-size:23px}
  .pf-show div b{display:block;font:800 12px var(--ui);margin-top:3px}
  .pf-show div span{font:700 9px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
  /* ---- level-up / unlock toast ---- */
  #econToast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:60;display:none;flex-direction:column;gap:5px;align-items:center;
    padding:13px 24px;background:rgba(10,11,16,.93);box-shadow:inset 0 0 0 1px var(--gold),0 10px 30px rgba(0,0,0,.6);pointer-events:none}
  #econToast.on{display:flex;animation:etIn .4s}
  #econToast b{font-family:var(--display);font-style:italic;font-weight:900;font-size:30px;line-height:.9;color:var(--gold);text-transform:uppercase}
  #econToast span{font:700 12px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
  @keyframes etIn{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}
  @media (max-width:760px){.pf{grid-template-columns:1fr}#arsRail{width:158px}}

  /* ======== THE MARKET, 2026-10-16 ==========================================================
     fortnite.gg/shop and csgoskins.gg, rebuilt for this game. Teardown and the reasoning behind
     every piece of it: https://claude.ai/artifact/Ag7J6RSPKQwHZPfjMYKtrY
     The four that matter, in order of how hard they move a buy decision:
       1. a clock at the top AND a countdown on every card, with LEAVING TODAY under 24 hours
       2. the reaction bar: five emoji with live counts, on a hot-to-cold gradient
       3. the grade written out in a filled pill ("Covert Chopper"), never left as a colour
       4. the two-part name: grey class line on top, bold finish name under it            */
  .mk-head{display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;padding:6px 0 2px}
  .mk-head h2{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:clamp(30px,6vw,52px);
    line-height:.92;text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .mk-date{font:800 12px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--cyan)}
  .mk-reset{font:700 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-top:4px}
  .mk-reset b{font:800 15px var(--mono);letter-spacing:.04em;color:var(--text);margin-left:8px;font-variant-numeric:tabular-nums}
  .mk-tabs{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-top:12px}
  .mk-tabs button{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 14px;border:0;cursor:pointer;
    font:700 12.5px var(--ui);color:var(--muted);background:rgba(255,255,255,.045);box-shadow:inset 0 0 0 1px var(--line);border-radius:999px}
  .mk-tabs button:hover{color:#fff;background:rgba(255,255,255,.09)}
  .mk-tabs button.on{color:#05070b;background:#fff;box-shadow:none;font-weight:800}
  .mk-tabs button i{font:800 10.5px var(--mono);font-style:normal;padding:2px 7px;border-radius:999px;
    background:rgba(255,255,255,.1);color:var(--dim)}
  .mk-tabs button.on i{background:rgba(5,7,11,.14);color:#05070b}
  .mk-ctrl{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:8px}
  .mk-ctrl button{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:0 13px;border:0;cursor:pointer;
    font:800 11.5px var(--ui);letter-spacing:.02em;color:var(--muted);background:rgba(255,255,255,.05);
    box-shadow:inset 0 0 0 1px var(--line);border-radius:999px}
  .mk-ctrl button:hover{color:#fff}
  .mk-ctrl button b{color:var(--gold);font-weight:800}
  /* the shelf. Fortnite promotes by making the TILE wider and carries no FEATURED badge anywhere. */
  .mk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:11px;align-items:start}
  .mk-card{position:relative;display:flex;flex-direction:column;border:0;padding:0;cursor:pointer;text-align:left;
    background:var(--glass);box-shadow:inset 0 0 0 1px var(--line);color:#fff;overflow:hidden;
    transition:transform .15s,box-shadow .2s}
  .mk-card:hover{transform:translateY(-3px);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc,#8fa3b0) 70%,transparent),0 16px 34px -14px #000}
  .mk-card.w2{grid-column:span 2}
  .mk-card.w4{grid-column:span 2}
  @media (min-width:980px){.mk-card.w4{grid-column:span 4}}
  /* the art box. The render bleeds to the card edges with no frame, and the gradient is ONLY at the
     bottom so the name and the price sit on it while the top of the card stays clean. */
  .mk-art{position:relative;height:186px;overflow:hidden;
    background:linear-gradient(170deg,color-mix(in srgb,var(--rc,#8fa3b0) 7%,#0a0d12) 0%,
      color-mix(in srgb,var(--rc,#8fa3b0) 24%,#0a0d12) 58%,color-mix(in srgb,var(--rc,#8fa3b0) 44%,#0a0d12) 100%)}
  .mk-card.w4 .mk-art,.mk-card.w2 .mk-art{height:210px}
  .mk-art img{position:absolute;inset:10px;width:auto;height:auto;max-width:calc(100% - 20px);max-height:calc(100% - 20px);
    margin:auto;object-fit:contain;display:block;filter:drop-shadow(0 8px 14px rgba(0,0,0,.5));transition:transform .18s ease}
  .mk-card:hover .mk-art img{transform:scale(1.05)}
  .mk-art .fb{position:absolute;inset:0;display:grid;place-items:center;font-size:52px;filter:drop-shadow(0 4px 9px rgba(0,0,0,.6))}
  /* the finish colour, masked to the weapon's silhouette, composited so the metal keeps its light */
  .mk-art .mk-tint{position:absolute;inset:10px;z-index:1;pointer-events:none;opacity:.82;
    mix-blend-mode:color;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;
    mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}
  .mk-art::after{content:"";position:absolute;left:0;right:0;bottom:0;height:62%;pointer-events:none;
    background:linear-gradient(180deg,transparent,rgba(4,6,10,.88) 72%,rgba(4,6,10,.96))}
  .mk-name{position:absolute;left:11px;right:11px;bottom:9px;z-index:2}
  .mk-cls{display:block;font:700 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#9fb0c2;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mk-nm{display:block;font-family:var(--display);font-style:italic;font-weight:900;font-size:21px;line-height:.98;
    text-transform:uppercase;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.8)}
  .mk-pr{display:flex;align-items:baseline;gap:8px;margin-top:3px}
  .mk-pr b{font:800 15px var(--mono);color:#fff;font-variant-numeric:tabular-nums}
  .mk-pr s{font:700 12px var(--mono);color:#8c99ab}
  .mk-pr .free{font:800 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#05070b;background:var(--lime);padding:2px 6px;border-radius:3px}
  /* the written-out grade pill, full width, exactly how csgoskins does it */
  .mk-rar{font:800 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#05070b;
    background:var(--rc,#8fa3b0);text-align:center;padding:5px 8px;line-height:1.2}
  /* badges above the card */
  .mk-flag{position:absolute;left:0;top:0;z-index:4;font:800 9.5px var(--mono);letter-spacing:.13em;text-transform:uppercase;
    padding:4px 9px;color:#05070b;background:var(--lime)}
  .mk-flag.new{background:var(--cyan)}
  .mk-flag.ser{background:var(--sc,#ffc83a)}
  .mk-inc{position:absolute;right:0;top:0;z-index:4;font:800 9px var(--mono);letter-spacing:.11em;text-transform:uppercase;
    padding:4px 8px;color:#fff;background:rgba(5,7,11,.78);box-shadow:inset 0 0 0 1px var(--line2)}
  /* the wishlist star, top-right of the art */
  .mk-wish{position:absolute;right:6px;bottom:6px;z-index:5;width:28px;height:28px;display:grid;place-items:center;border:0;
    cursor:pointer;font-size:15px;line-height:1;color:#8c99ab;background:rgba(5,7,11,.6);border-radius:50%;
    box-shadow:inset 0 0 0 1px var(--line2)}
  .mk-wish:hover{color:#fff}
  .mk-wish.on{color:#05070b;background:var(--gold);box-shadow:none}
  /* the countdown strip, below the art and outside the image, the way fortnite.gg does it */
  .mk-time{display:flex;align-items:center;gap:7px;padding:7px 11px;font:800 11px var(--mono);letter-spacing:.08em;
    text-transform:uppercase;color:var(--muted);background:rgba(5,7,11,.45);white-space:nowrap;overflow:hidden}
  .mk-time span{text-overflow:ellipsis;overflow:hidden}
  .mk-time.soon{color:#ffd36a}
  .mk-time span{margin-left:auto;font:700 10px var(--mono);letter-spacing:.06em;color:var(--dim);text-transform:none}
  /* THE REACTION BAR. Five emoji with live counts on a hot-to-cold gradient. */
  .mk-react{display:grid;grid-template-columns:repeat(5,1fr);gap:0;
    background:linear-gradient(90deg,#8f1f12,#8a3418,#6f3a1c,#5a3a20,#3f2f1d)}
  .mk-react button{display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 2px 6px;border:0;cursor:pointer;
    background:transparent;color:#fff;font:800 9.5px var(--mono);line-height:1}
  .mk-react button em{font-style:normal;font-size:14px;line-height:1;filter:saturate(.95)}
  .mk-react button i{font-style:normal;font:800 9px var(--mono);padding:1px 5px;border-radius:999px;
    background:rgba(5,7,11,.42);color:#ffe9c2;font-variant-numeric:tabular-nums}
  .mk-react button:hover{background:rgba(255,255,255,.12)}
  .mk-react button.on{background:rgba(255,255,255,.2)}
  .mk-react button.on i{background:#fff;color:#05070b}
  /* the market footer strip: listed / sold, the way csgoskins prints offers / markets */
  .mk-foot{display:flex;justify-content:center;gap:10px;padding:6px 8px;font:800 9.5px var(--mono);
    letter-spacing:.11em;text-transform:uppercase;color:var(--dim);background:rgba(5,7,11,.5)}
  .mk-empty{padding:34px 18px;text-align:center;color:var(--muted);font-size:13.5px;
    background:rgba(5,7,11,.5);box-shadow:inset 0 0 0 1px var(--line)}
  /* the collection line under the price, with its own dot */
  .mk-coll{display:flex;align-items:center;gap:6px;padding:6px 11px;font:700 10.5px var(--mono);letter-spacing:.06em;
    color:var(--muted);background:rgba(5,7,11,.3)}
  .mk-coll u{width:8px;height:8px;border-radius:2px;background:var(--cc,#8fa3b0);text-decoration:none;flex:0 0 8px}
  @media (max-width:560px){.mk-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
    .mk-art{height:150px}.mk-nm{font-size:17px}}
  /* A wide tile on a one-column grid is a tile wider than the screen. Promotion by size only works
     once there are columns to span. */
  @media (max-width:420px){.mk-grid{grid-template-columns:1fr}.mk-card.w2,.mk-card.w4{grid-column:span 1}}

  /* ---- THE VAULT: the secret stages and the secret fighter ---------------------------------- */
  /* The art is the REAL thing, drawn by the same painters the picker and the select screen use
     (UI.paintStage, drawPortrait) and then put in shadow -- not a separate "locked" picture that
     would drift from the stage it is selling. brightness(0) keeps the silhouette and throws away
     the lighting, which is what makes it read as a shadow rather than as a dark photo. */
  .vk-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:2px 0 14px}
  .vk-head h3{margin:0;font-family:var(--display);font-style:italic;font-weight:900;font-size:30px;line-height:.9;
    text-transform:uppercase;background:var(--chrome);-webkit-background-clip:text;background-clip:text;color:transparent}
  .vk-head p{margin:0;color:var(--muted);font-size:13px;max-width:62ch}
  .vk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
  .vk-card{position:relative;display:flex;flex-direction:column;gap:0;padding:0;border:0;text-align:left;cursor:pointer;
    background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.012));border-radius:12px;overflow:hidden;
    box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rc,#8847ff) 42%,transparent),0 12px 30px -16px #000;color:var(--text)}
  .vk-card:hover{transform:translateY(-3px);box-shadow:inset 0 0 0 1px var(--rc,#8847ff),0 18px 38px -16px #000,0 0 30px -8px color-mix(in srgb,var(--rc,#8847ff) 50%,transparent)}
  .vk-card::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--rc,#8847ff);opacity:.9}
  .vk-art{position:relative;height:168px;background:#04050a;display:grid;place-items:center;overflow:hidden}
  /* A BLACK SILHOUETTE NEEDS SOMETHING TO BE BLACK AGAINST. The fighter's art is a cutout dropped to
     pure black, so on the near-black plate the stages use it disappeared completely -- the first
     version of this card was a glow with nothing in it. The light comes from behind him instead. */
  .vk-art.k-fighter{background:radial-gradient(62% 72% at 50% 88%,rgba(154,96,255,.42),#0a0b16 72%)}
  /* above the veil: an absolutely positioned ::before otherwise paints over an in-flow canvas */
  .vk-art canvas{position:relative;z-index:1;width:100%;height:100%;object-fit:cover;display:block}
  .vk-face{position:relative;z-index:1;width:100%;height:100%;background-repeat:no-repeat;
    background-position:50% 10%;background-size:auto 118%}
  .vk-art.locked .vk-face{filter:brightness(0) drop-shadow(0 0 2px rgba(176,140,255,.8))}
  /* A FIGHTER GOES TO PURE BLACK and a STAGE DOES NOT. A cutout silhouette is a shape you can read
     at a glance -- the hood, the ears, the stance -- and that is the whole trick of a locked
     character slot. A landscape has no silhouette: brightness(0) on a stage is a black rectangle
     that says nothing about what is being sold, so it keeps just enough light to make out a place
     and the saturation comes down so it still reads as "in shadow". */
  /* a little more light than the picker's card: this is the one you decide to spend on */
  .vk-art.locked.k-stage canvas{filter:grayscale(.8) brightness(.62) contrast(1.1)}
  .vk-art.locked.k-stage::before{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;
    background:radial-gradient(80% 90% at 50% 120%,color-mix(in srgb,var(--rc,#8847ff) 24%,transparent),transparent 70%)}
  /* The shop card wears the SAME drawn padlock as the locked slot in the picker and on the select
     screen (8f_vault.js), at the size the bigger card wants. It replaced an outlined "?" -- see the
     note on the references in that file. */
  .vk-q{position:absolute;left:50%;top:50%;z-index:3;width:62px;transform:translate(-50%,-50%);pointer-events:none;
    filter:drop-shadow(3px 4px 0 rgba(0,0,0,.55))}
  .vk-body{padding:11px 13px 13px;display:flex;flex-direction:column;gap:7px}
  .vk-kind{font:700 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--rc,#8847ff)}
  .vk-nm{font-family:var(--display);font-style:italic;font-weight:900;font-size:24px;line-height:.95;text-transform:uppercase}
  .vk-sub{color:var(--muted);font-size:12px;line-height:1.35}
  .vk-how{color:var(--text);font-size:12px;line-height:1.4;opacity:.82}
  .vk-row{display:flex;align-items:center;gap:10px;margin-top:2px}
  .vk-pr{font-family:var(--display);font-style:italic;font-weight:900;font-size:22px}
  .vk-own{font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--lime)}
  .vk-get{margin-left:auto;font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--cyan)}
  @media (max-width:560px){.vk-grid{grid-template-columns:1fr}.vk-art{height:150px}.vk-q{font-size:74px}}

  /* ---- the account panel: where everything you own actually lives --------------------------- */
  .ac{grid-column:1/-1}
  .ac-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .ac-at{display:flex;align-items:center;gap:0;background:rgba(5,7,11,.55);border-radius:8px;
    box-shadow:inset 0 0 0 1px var(--line2);overflow:hidden}
  .ac-at span{padding:0 2px 0 10px;color:var(--muted);font:700 14px var(--mono)}
  .ac-at input{background:0;border:0;outline:0;color:var(--text);font:700 14px var(--mono);padding:9px 10px 9px 2px;width:11ch}
  .ac-btn{border:0;border-radius:8px;cursor:pointer;padding:9px 14px;background:var(--red);color:#fff;
    font:700 11px var(--mono);letter-spacing:.1em;text-transform:uppercase}
  .ac-btn.ghost{background:rgba(255,255,255,.07);color:var(--text)}
  .ac-btn:hover{filter:brightness(1.12)}
  .ac-ok{display:flex;align-items:center;gap:9px;font:700 14px var(--mono)}
  .ac-ok img{width:30px;height:30px;border-radius:50%;display:block}
  .ac-ok .tick{font:700 9.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--lime)}
  .ac-code{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 8px}
  .ac-code b{font-family:var(--display);font-style:italic;font-weight:900;font-size:27px;letter-spacing:.02em;color:var(--gold)}
  .ac-note{color:var(--muted);font-size:12px;line-height:1.45;max-width:72ch;margin:7px 0 0}
  .ac-note.bad{color:var(--red)}
  .ac-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--lime);margin-right:7px;
    animation:acp 1.1s ease-in-out infinite}
  @keyframes acp{50%{opacity:.25}}
  .ac-rec{font:700 15px var(--mono);letter-spacing:.06em;color:var(--gold);word-break:break-all}
  `;

  // 'looks' (Cosmetics) stays. It was briefly pulled because all 25 of its cards were the same
  // picture of the doge with a tint on it, which is a bake fault (dev/cosmbake.mjs), not a reason to
  // delete the only shelf that is legal in ranked and carries no balance risk. The bake now renders
  // each product: a weapon wearing the finish, the aura alone, the plate with a name in it.
  // THE COSMETICS TAB STAYS DELETED. Duane, 2026-10-15: "cosmetics is terrible remove that tab i
  // told you already just REMOVE IT." He had to ask twice, so this is a rule and not a preference:
  // never re-add ['looks', 'Cosmetics'] here and never re-add a `S.tab === 'looks'` shelf in
  // render(). A device that saved 'looks' opens on the Market instead of a dead tab.
  const SAVED_TAB = store.get('storeTab', 'market');
  const TAB_IDS = ['market', 'weapons', 'skins', 'arsenal'];
  const S = { tab: TAB_IDS.indexOf(SAVED_TAB) >= 0 ? SAVED_TAB : 'market', open: null, rail: false, built: false,
    // the market view's own state: which of the seven fortnite.gg tabs, and which sort
    mk: 'all', sort: 'heat', clock: null, skinFor: null, cat: 'all' };

  function build() {
    if (S.built) return; S.built = true;
    const st = el('style'); st.textContent = css; document.head.appendChild(st);

    // ---- store screen
    const sc = el('section', 'screen solid'); sc.id = 'scStore'; sc.hidden = true;
    sc.innerHTML = `<div class="wrap">
      <div class="st-top">
        <div><div class="eyebrow">Armoury</div><h2 class="h2">The Store</h2></div>
        <div class="row"><button class="btn small" id="stProfile">Profile</button><button class="btn small" id="stBack">Back</button></div>
      </div>
      <div class="st-bar"><span class="st-lv" id="stLv">1</span><span class="sub" style="font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim)">Level</span>
        <div class="st-xp"><i id="stXp"></i></div><span id="stXpT" style="font:700 11px var(--mono);color:var(--muted)"></span>
        <span id="stLoad" style="font:700 11px var(--mono);color:var(--gold)"></span></div>
      <p class="st-note" id="stRule"></p>
      <div class="st-tabs" id="stTabs"></div>
      <div id="stBody" style="display:flex;flex-direction:column;gap:22px"></div>
    </div>`;
    document.body.appendChild(sc);

    // ---- profile screen
    const pf = el('section', 'screen solid'); pf.id = 'scProfile'; pf.hidden = true;
    pf.innerHTML = `<div class="wrap">
      <div class="st-top"><div><div class="eyebrow">Record</div><h2 class="h2">Your Profile</h2></div>
        <div class="row"><button class="btn small" id="pfShare">Share a win card</button><button class="btn small" id="pfStore">Store</button><button class="btn small" id="pfBack">Back</button></div></div>
      <div class="pf" id="pfBody"></div>
    </div>`;
    document.body.appendChild(pf);

    // ---- in-match arsenal
    const btn = el('button'); btn.id = 'arsBtn'; btn.title = 'Arsenal (Tab)'; btn.setAttribute('aria-label', 'Arsenal');
    btn.textContent = '🎒'; document.body.appendChild(btn);
    const rail = el('div'); rail.id = 'arsRail'; document.body.appendChild(rail);
    const toast = el('div'); toast.id = 'econToast'; document.body.appendChild(toast);

    byId('stBack').onclick = () => { sfx(); closeStore(); };
    byId('stProfile').onclick = () => { sfx(); showProfile(); };
    byId('pfBack').onclick = () => { sfx(); closeStore(); };
    byId('pfStore').onclick = () => { sfx(); showStore(); };
    byId('pfShare').onclick = () => { sfx(); shareCard(); };
    btn.onclick = e => { e.stopPropagation(); sfx(); toggleRail(); };

    const TABS = [['market', 'Market'], ['weapons', 'Weapons'], ['skins', 'Finishes'], ['arsenal', 'My arsenal']];
    const tb = byId('stTabs');
    for (const [id, label] of TABS) { const b = el('button', S.tab === id ? 'on' : '', label); b.onclick = () => { S.tab = id; store.set('storeTab', id); sfx(); render(); }; b.dataset.t = id; tb.appendChild(b); }
    // The Locker is its own screen (src/8h_locker.js), not a fourth shelf in here: nothing in it is
    // for sale, so it does not belong in a shop. The button is here because this is where a player
    // goes looking for "my stuff", and it carries the unopened-crate count so a free crate is never
    // sitting there unnoticed.
    if (window.Locker) {
      const lb = el('button', '', 'Locker');
      lb.dataset.t = '__locker';
      lb.onclick = () => { sfx(); byId('scStore').hidden = true; Locker.open('scStore'); };
      lb.id = 'stLockerBtn';
      tb.appendChild(lb);
    }

    Econ.on(() => { if (!sc.hidden) render(); if (!pf.hidden) renderProfile(); renderRail(); });
  }


  // Rarity, because every shop worth copying has one (Fortnite, Brawlhalla, Valorant, CS2): a colour
  // you can read across the grid at a glance, derived from price so it can never disagree with what
  // the thing costs.
  const RARITY = [
    { id: 'common',    name: 'Common',    col: '#8fa3b0', max: 199 },
    { id: 'rare',      name: 'Rare',      col: '#3fa9ff', max: 399 },
    { id: 'epic',      name: 'Epic',      col: '#b06cff', max: 699 },
    { id: 'legendary', name: 'Legendary', col: '#ffb020', max: Infinity },
  ];
  // ONE ladder for the whole shop, 15 Oct. There used to be a second one here (`COS_MAX`) because
  // cosmetics were priced $5-$50 in whole dollars against weapons at $1.99-$14.99 -- so a Common
  // cosmetic cost four times a Common weapon, two price FORMATS ran on one page, and Rare cosmetics
  // disagreed with each other ($10, $10, $12). The cosmetics are now on the weapons' ladder
  // (89_econ.js: 199 / 399 / 699 / 999 / 1499) and one rule reads both, so a price and a grade can
  // never drift apart again.
  const rarityOf = (d) => RARITY.find(r => (d.price == null ? 0 : d.price) <= r.max) || RARITY[0];
  const price = n => (n == null ? '—' : M(n));   // M is Econ.money: cents -> "$1.99"
  // A shelf used to be `auto-fill, minmax(228px,1fr)`, so 2 Commons sat in a five-wide row with
  // three holes and 7 Rares broke 5 + 2. Pick the column count that leaves the LAST ROW fullest:
  // 7 goes 4 + 3, 6 goes 3 + 3, 2 goes 2. Nothing in Fortnite or CS2 ever ends a shelf ragged.
  function cols(n) {
    if (n <= 0) return 1;
    if (n < 3) return n;
    let best = 5, gap = 9;
    for (const c of [5, 4, 3]) { const g = (c - (n % c)) % c; if (g < gap) { gap = g; best = c; } }
    return best;
  }
  // ---- the filter stack, lifted from the Locker so the two screens behave the same way ----------
  function filterBar() {
    const bar = el('div', 'st-filters');
    const chip = (label, on, fn) => {
      const b = el('button', 'st-chip' + (on ? ' on' : ''), label);
      b.onclick = () => { sfx(); fn(); render(); };
      return b;
    };
    const r1 = el('div', 'st-frow');
    r1.appendChild(el('span', 'st-flab', 'Grade'));
    r1.appendChild(chip('All', !S.grade, () => { S.grade = null; }));
    for (const r of RARITY) r1.appendChild(chip(r.name, S.grade === r.id, () => { S.grade = S.grade === r.id ? null : r.id; }));
    bar.appendChild(r1);
    const r2 = el('div', 'st-frow');
    r2.appendChild(el('span', 'st-flab', 'Show'));
    r2.appendChild(chip('In my arsenal', S.show === 'loadout', () => { S.show = S.show === 'loadout' ? null : 'loadout'; }));
    r2.appendChild(chip('Not in it', S.show === 'rest', () => { S.show = S.show === 'rest' ? null : 'rest'; }));
    const q = el('input', 'st-find'); q.type = 'search'; q.placeholder = 'Search weapons'; q.value = S.q || '';
    // re-render on every keystroke would blur the field, so the value is kept and the box re-focused
    q.oninput = () => { S.q = q.value; render(); const n = document.querySelector('.st-find'); if (n) { n.focus(); n.selectionStart = n.value.length; } };
    r2.appendChild(q);
    bar.appendChild(r2);
    return bar;
  }
  function gridFor(n) {
    const c = cols(n), g = el('div', 'grid');
    g.style.gridTemplateColumns = 'repeat(' + c + ',minmax(0,1fr))';
    // and cap the width so a two-item shelf is two cards, not two billboards
    if (c < 5) g.style.maxWidth = (c * 268) + 'px';
    return g;
  }
  // ---------------- the store ----------------
  function shelves() {
    const q = (S.q || '').trim().toLowerCase();
    const W = Econ.CAT.weapons.filter(w => {
      if (S.grade && rarityOf(w).id !== S.grade) return false;
      if (S.show === 'loadout' && !Econ.inLoadout(w.id)) return false;
      if (S.show === 'rest' && Econ.inLoadout(w.id)) return false;
      if (q && !((w.name || '') + ' ' + (w.blurb || '')).toLowerCase().includes(q)) return false;
      return true;
    });
    const by = id => W.filter(w => rarityOf(w).id === id);
    return RARITY.map(r => ({ h: r.name, s: r.id === 'legendary' ? 'One per match, and everyone will know'
      : r.id === 'epic' ? 'Changes how a round plays'
      : r.id === 'rare' ? 'Real pressure for very little' : 'Cheap, loud, almost no raw power',
      col: r.col, items: by(r.id) })).filter(x => x.items.length);
  }
  function priceLine(d) {
    // `unlock` is null for anything the account level never grants for free (89_econ.js:18), so this
    // concatenation printed "UNLOCKED · LVL null" on the Store for five weapons -- Homing Missile,
    // Mole Bomb, Freeze Ray, Sentry Turret and Gravity Well. The card right below already guards the
    // same field; this one did not.
    if (Econ.owns(d.id)) return Econ.S.own[d.id] ? 'OWNED' : (d.unlock != null ? 'UNLOCKED · LVL ' + d.unlock : 'UNLOCKED');
    return M(d.price);
  }
  // every market weapon is free while the game is in practice (PRACTICE_FREE, 57_items3.js). That is
  // why `Econ.owns()` says yes to all 21 of them with nobody signed in.
  const freeNow = d => !!(d && typeof PRACTICE_FREE !== 'undefined' && PRACTICE_FREE
    && !Econ.S.own[d.id] && Econ.CAT.weapons.some(w => w.id === d.id) && d.price != null);
  function card(d, kind) {
    const owned = Econ.owns(d.id), free = freeNow(d);
    const c = el('button', 'card' + (owned ? ' owned' : ' lock') + (S.open === d.id ? ' open' : ''));
    if (kind === 'weapon' && Econ.inLoadout(d.id)) c.classList.add('load');
    if (kind === 'cosmetic' && Econ.equipped(d.slot) === d.id) c.classList.add('eq');
    const R = rarityOf(d);
    c.classList.add('r-' + R.id);
    c.style.setProperty('--rc', R.col);
    const ic = el('div', 'ic');
    // a baked studio render of the actual weapon (8e_itemart.js), sitting on the rarity field. The
    // emoji is only ever the fallback for something with no render yet.
    if (window.ItemArt && ItemArt.has(d.id)) ic.innerHTML = ItemArt.html(d.id, R.col, 128);
    else ic.textContent = d.icon || '◆';
    c.appendChild(ic);
    // The rarity PILL is gone, 15 Oct. The shelf heading above the grid already says COMMON in 26px
    // type, so every card printed its grade a second time six inches below it. The colour stays (it
    // is the field behind the art and the bar across the top), which is what carries the grade once
    // the shelf heading has scrolled away.
    c.appendChild(el('div', 'nm', d.name));
    c.appendChild(el('div', 'bl', d.blurb || ''));
    if (d.how) {
      const h = el('div', 'how');
      h.appendChild(el('i', '', 'How it works')); h.appendChild(el('span', '', d.how));
      const wait = kind === 'weapon' ? Econ.delayOf(d.id) : 0;
      if (wait) { h.appendChild(el('i', '', 'Locked at the start')); h.appendChild(el('span', '', 'Cannot be deployed for the first ' + wait + ' seconds of a match.')); }
      if (d.counter) { h.appendChild(el('i', '', 'What beats it')); h.appendChild(el('span', '', d.counter)); }
      c.appendChild(h);
    }
    // ---- the footer: ONE control, and it is the price ------------------------------------------
    // What was here: the price in green on the left, a flat grey word on the right, and an OWNED
    // badge in between. Signed out, every weapon in the shop read "$3.99  OWNED  ADD TO ARSENAL",
    // which is three states at once and no way to buy anything. Fortnite and CS2 both put ONE
    // control on a card and the price is written on it, so there is nothing to discover.
    const ft = el('div', 'ft');
    const act = el('span', 'buy');
    if (!owned) {
      // not yours: the price IS the button
      act.textContent = d.price == null ? 'Season prize' : M(d.price);
      act.classList.add('go');
      if (d.unlock != null) ft.appendChild(el('span', 'alt', 'or reach lvl ' + d.unlock));
    } else if (free) {
      // PRACTICE_FREE (57_items3.js) hands every market weapon out for nothing while the game is in
      // practice. That is TRUE and it sells, so say it: the price struck through and FREE NOW beside
      // it, rather than the OWNED badge that made the whole shelf look like a bug.
      act.textContent = Econ.inLoadout(d.id) ? 'In your arsenal' : 'Add to arsenal';
      act.classList.toggle('on', Econ.inLoadout(d.id));
      const was = el('span', 'alt');
      was.innerHTML = '<s>' + M(d.price) + '</s> <b>Free now</b>';
      ft.appendChild(was);
    } else if (kind === 'weapon') {
      act.textContent = Econ.inLoadout(d.id) ? 'In your arsenal' : 'Add to arsenal';
      act.classList.toggle('on', Econ.inLoadout(d.id));
    } else if (kind === 'cosmetic') {
      const on = Econ.equipped(d.slot) === d.id;
      act.textContent = on ? 'Equipped' : 'Equip';
      act.classList.toggle('on', on);
    } else act.textContent = 'Owned';
    ft.appendChild(act);
    c.appendChild(ft);
    // A drawn padlock, top right, where the locker already puts it. The emoji rendered at a different
    // size on every platform and sat half off the bottom-left corner of the card.
    if (!owned) c.insertAdjacentHTML('beforeend',
      '<svg class="lk" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>'
      + '<rect x="4.5" y="10" width="15" height="11" rx="2.2" fill="currentColor"/></svg>');
    // Cosmetics used to paint a live canvas here (Cosm.swatch). It is now a baked image served
    // through the same ItemArt path as every weapon, so there is ONE artwork component for the whole
    // shop. The swatch is only a fallback for a cosmetic that has not been baked yet.
    if (kind === 'cosmetic' && !ItemArt.has(d.id) && window.Cosm) { try { Cosm.swatch(c, d); } catch (e) { /* preview only */ } }
    // ONE action on a primary click, always the one the button says. The breakdown moved off
    // shift-click onto right-click and long-press: shift-click is not a gesture that exists on a
    // phone, and the card never said it was there.
    const flip = () => { S.open = S.open === d.id ? null : d.id; render(); };
    c.onclick = () => {
      sfx();
      if (!owned) return buy(d);
      if (kind === 'weapon') { if (!Econ.toggleLoadout(d.id)) note('Three weapons in the arsenal at a time. Take one out first.'); }
      else if (kind === 'cosmetic') Econ.equip(d.id);
      render();
    };
    if (d.how) {
      c.oncontextmenu = ev => { ev.preventDefault(); sfx(); flip(); };
      let hold = null;
      c.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'touch') return; hold = setTimeout(() => { hold = null; sfx(); flip(); }, 480); });
      for (const k of ['pointerup', 'pointercancel', 'pointerleave']) c.addEventListener(k, () => { clearTimeout(hold); });
    }
    return c;
  }
  function buy(d) {
    if (d.price == null) return note('That one is a season prize. It is not for sale.');
    // The old path fired "Checking out <name>…" and then, a beat later, a second toast explaining
    // that you are not signed in. Two toasts to say one thing, and the first one implied a checkout
    // that was never going to happen. Ask for the connection up front, naming the item and the price.
    if (!Econ.connected()) return note(d.name + ' is ' + M(d.price) + '. Connect to online play to buy it — what you own lives on your account, not on this device.', 'Connect');
    note('Checking out ' + d.name + '…');
    Econ.buy(d.id, r => {
      // PAYMENTS=chain: the server does not grant and does not refuse — it answers with the item and
      // its price, and the checkout sheet (8k_pay.js) takes ETH, USDC, USDT or WOLVERINU for it.
      // Nothing is unlocked until that sheet comes back with a payment this server has verified.
      // The SERVER's answer is the authority, not the cached `payments` mode: the econ state can
      // still be in flight on a fresh connection, and checking `Checkout.live()` here would send a
      // player to a toast while the server was offering them a checkout.
      if (r.checkout && window.Checkout) { Checkout.open(r.checkout); return; }
      note(r.msg);
      if (!r.ok) return;
      render();
      // WHERE THE PURCHASE NOW LIVES, said once, at the only moment it matters. The account is real
      // and server-side, but until an X account is on it the only way back in is this browser's
      // storage -- so a cleared cache or a new phone loses a paid stage. One nudge, after a vault
      // buy, and never again once a handle is connected.
      if (d.type === 'vault' && !xHandle()) {
        setTimeout(() => note('Connect your X account in Profile and this follows you to any device. Right now it lives in this browser.', 'Save it'), 2600);
      }
    });
  }
  // the VERIFIED handle on the account, or null. Never a typed one (89_econ / lib/xverify.js).
  function xHandle() {
    try { const N = Net.state, me = N && N.me; return (me && me.profile && me.profile.x) || null; } catch (e) { return null; }
  }
  function render() {
    const body = byId('stBody'); if (!body) return;
    for (const b of byId('stTabs').children) b.className = b.dataset.t === S.tab ? 'on' : '';
    { // the crate badge on the Locker button
      const lb = byId('stLockerBtn');
      if (lb) { const n = Econ.crates ? Econ.crates() : 0; lb.textContent = n > 0 ? 'Locker · ' + n + ' crate' + (n > 1 ? 's' : '') : 'Locker'; }
    }
    const bar = Econ.xpBar();
    byId('stLv').textContent = String(bar.level);
    byId('stXp').style.width = (bar.pct * 100).toFixed(1) + '%';
    byId('stXpT').textContent = bar.into + ' / ' + bar.need + ' XP';
    byId('stLoad').textContent = 'Arsenal ' + Econ.loadout().length + '/3';
    byId('stRule').innerHTML = Econ.S.synced
      ? 'Everything you own lives on your account, not on this device. <b>Weapons are for casual and party matches only</b> — wagered and ranked matches are items-off or a shared pool both players agreed to, so nobody can buy a win off you. <b>Cosmetics work everywhere, including money matches.</b>'
      : 'Not signed in to online play, so this is the last list your account gave this device. <b>Connect to buy.</b> Weapons are casual-only; cosmetics work everywhere.';
    body.textContent = '';
    if (S.tab !== 'market') stopClock();
    if (S.tab === 'market') {
      body.appendChild(marketView());
      startClock();
    } else if (S.tab === 'skins') {
      body.appendChild(skinsView());
    } else if (S.tab === 'weapons') {
      // The Locker has a Slot / Grade / Show stack and the shop had nothing, so 21 weapons across
      // four shelves could only be found by scrolling. Same control, same place, fewer axes: a shop
      // only has a grade and an ownership state worth filtering on.
      body.appendChild(filterBar());
      for (const sh of shelves()) {
        const w = el('div', 'shelf');
        // the shelf heading carries the rarity's own colour, so the grid reads top to bottom
        const hd = el('div', 'shelf-h');
        const dot = el('span', 'dot'); dot.style.background = sh.col || 'var(--muted)';
        hd.appendChild(dot); hd.appendChild(el('h3', '', sh.h));
        w.appendChild(hd); w.appendChild(el('div', 'sub', sh.s));
        const g = gridFor(sh.items.length); for (const d of sh.items) g.appendChild(card(d, 'weapon')); w.appendChild(g);
        body.appendChild(w);
      }
      body.appendChild(el('p', 'st-note', TOUCH
        ? 'Tap a weapon to put it in your arsenal (three at a time). Press and hold any card for the full breakdown — every weapon in here has something that beats it, and it is printed on the card.'
        : 'Click a weapon to put it in your arsenal (three at a time). Right-click any card for the full breakdown — every weapon in here has something that beats it, and it is printed on the card.'));
    } else {
      // There is no `S.tab === 'looks'` branch and there must never be one again. Every cosmetic
      // that used to sit on that shelf is on the Market now, on the same card as everything else,
      // with a clock and a grade on it. See the note on TAB_IDS above.
      body.appendChild(arsenalEditor());
    }
  }

  // ================= THE MARKET =================
  // The daily shop, built straight off the fortnite.gg teardown. Everything in here is reasoned
  // through on the page that produced it: https://claude.ai/artifact/Ag7J6RSPKQwHZPfjMYKtrY
  //
  // The shelf is computed from the DATE (Econ.sched / Econ.onShelf), not handed down by a server,
  // so an offline client, the website and the game all agree on what is on sale today and what
  // leaves tonight. That is what lets a countdown be truthful with no backend behind it.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // the two-part name. csgoskins writes WEAPON | FINISH: grey class line on top, bold name under.
  const SLOT_LABEL = { hat: 'Head', eyes: 'Eyes', neck: 'Neck', hands: 'Gloves', feet: 'Feet',
    back: 'Back', guard: 'Shield', charm: 'Charm' };
  function twoPart(d) {
    if (d.type === 'skin') { const w = Econ.BYID[d.weapon]; return [w ? w.name : d.weapon, d.name]; }
    if (d.type === 'gear') return [SLOT_LABEL[d.slot] || 'Gear', d.name];
    if (d.type === 'weapon') return ['Weapon', d.name];
    const L = { finish: 'Finish', aura: 'Aura', trail: 'Trail', ko: 'KO effect', pose: 'Victory', plate: 'Plate', taunt: 'Taunt', title: 'Title' };
    return [L[d.slot] || 'Cosmetic', d.name];
  }
  // the art: a weapon finish shows the weapon's own baked render, which is exactly what CS2 does.
  // THE PAINT HAS TO BE VISIBLE OR IT IS NOT A PRODUCT. The first version showed the bare weapon
  // render for every finish, so The Chopper in Ticker Tape and The Chopper in Pink Slip were the
  // same picture at the same price. The finish's own colour is masked to the weapon's silhouette
  // and composited in `color` blend mode, so the metal keeps its lighting and only the hue changes
  // -- the same thing the 3D does to the weapon in your hands (98_v3_econ.mjs `tintGroup`).
  function artFor(d) {
    const id = d.type === 'skin' ? d.weapon : d.id;
    if (!(window.ItemArt && ItemArt.has(id))) return '<span class="fb">' + (d.icon || '◆') + '</span>';
    const img = ItemArt.html(id, '#fff', 180);
    if (d.type !== 'skin' || !d.color) return img;
    const u = ItemArt.src(id);
    return img + '<i class="mk-tint" style="background:' + d.color + ';-webkit-mask-image:url(' + u
      + ');mask-image:url(' + u + ')"></i>';
  }
  // the grade, written out with the category after it: "Covert Chopper", "Extraordinary Knuckles"
  function gradeLine(d) {
    const g = Econ.gradeOf(d);
    const cls = d.type === 'skin' ? (Econ.BYID[d.weapon] || {}).name || 'Finish'
      : d.type === 'weapon' ? 'Weapon' : (twoPart(d)[0]);
    return g.market + ' ' + cls;
  }
  function mkCard(d, day) {
    const g = Econ.gradeOf(d), owned = Econ.owns(d.id), free = freeNow(d);
    const left = Econ.secsLeft(d.id, day), leaving = Econ.leavingToday(d.id, day), fresh = Econ.isNewToday(d.id, day);
    const freeOne = Econ.freeToday(day);
    const isFree = freeOne && freeOne.id === d.id;
    // tile width: the hero weapon and anything legendary gets a wider tile. There is no FEATURED
    // badge anywhere in Fortnite's shop; the SIZE does that job.
    const span = g.id === 'legendary' ? 'w2' : '';
    const c = el('button', 'mk-card ' + span);
    c.style.setProperty('--rc', g.color);
    const [cls, nm] = twoPart(d);
    const coll = d.collection ? Econ.collection(d.collection) : null;
    const price = isFree ? 0 : d.price;
    const was = isFree ? d.price : null;
    const rx = Econ.reactionsOf(d.id), votes = Econ.reactTotal(d.id);
    c.innerHTML =
      '<div class="mk-art">' + artFor(d)
      + (leaving ? '<i class="mk-flag">Leaving today</i>' : fresh ? '<i class="mk-flag new">New</i>' : '')
      + (d.type === 'weapon' && (d.charges || 1) > 1 ? '<i class="mk-inc">' + (d.charges) + ' per match</i>'
         : d.type === 'skin' ? '<i class="mk-inc">Finish included</i>' : '')
      + '<div class="mk-name"><span class="mk-cls">' + esc(cls) + '</span>'
      + '<span class="mk-nm">' + esc(nm) + '</span>'
      + '<span class="mk-pr">' + (owned && !free ? '<b style="color:var(--lime)">Owned</b>'
          : price === 0 ? '<b>Free</b>' : '<b>' + M(price) + '</b>')
      + (was ? '<s>' + M(was) + '</s>' : '')
      + (free ? '<span class="free">Free now</span>' : '') + '</span></div>'
      + '</div>'
      + '<div class="mk-rar">' + esc(gradeLine(d)) + '</div>'
      + (coll ? '<div class="mk-coll" style="--cc:' + coll.color + '"><u></u>' + esc(coll.name) + '</div>' : '')
      + '<div class="mk-time' + (left > 0 && left < 86400 ? ' soon' : '') + '">⏱ ' + esc(Econ.countdown(left) || 'Off shelf')
      + '<span>' + (d.style ? esc((Econ.style(d.style) || {}).name || '') : '') + '</span></div>'
      // THE REACTION BAR. Counts are only printed once there ARE counts: a row of five zeroes under
      // every card is how a shop reads as abandoned, and inventing a number to avoid that would be
      // worse than the empty row. Until somebody votes it is five emoji and an invitation.
      + '<div class="mk-react">' + rx.map(r =>
          '<button data-r="' + r.k.id + '" class="' + (r.mine ? 'on' : '') + '" title="' + esc(r.k.name) + '">'
          + '<em>' + r.k.e + '</em>' + (votes ? '<i>' + fmtN(r.n) + '</i>' : '') + '</button>').join('') + '</div>'
      + '<div class="mk-foot">' + (votes
          ? fmtN(votes) + ' vote' + (votes === 1 ? '' : 's') + ' · ' + Math.round(Econ.heat(d.id) * 100) + '% heat'
          : 'No votes yet') + '</div>';
    // the wishlist star lives on the art so it never moves when the name wraps
    const star = el('button', 'mk-wish' + (Econ.wished(d.id) ? ' on' : ''), Econ.wished(d.id) ? '★' : '☆');
    star.title = 'Wishlist';
    star.onclick = ev => { ev.stopPropagation(); sfx(); Econ.wish(d.id); renderMarket(); };
    c.querySelector('.mk-art').appendChild(star);
    for (const b of c.querySelectorAll('.mk-react button')) {
      b.onclick = ev => { ev.stopPropagation(); sfx(); Econ.react(d.id, b.dataset.r); renderMarket(); };
    }
    c.onclick = () => { sfx(); act(d); };
    return c;
  }
  // ---- THE VAULT ------------------------------------------------------------------------------
  // Its own card rather than a branch through mkCard: every line of that card is about the daily
  // shelf -- a countdown, a LEAVING TODAY flag, reactions, a wishlist star, a collection. The vault
  // has none of those (it never rotates), and a card that printed "Off shelf" under a $6.99 stage
  // would read as broken.
  //
  // The art is drawn by the game's own painters so the card can never drift from what you get:
  // `UI.paintStage` is the same call the stage picker makes, and `drawPortrait` is the roster's.
  // Locked, it goes to a pure silhouette in CSS (.vk-art.locked) with a question mark over it.
  function vaultArt(d, locked) {
    const box = el('div', 'vk-art' + (locked ? ' locked' : '') + ' k-' + d.kind);
    if (d.kind === 'fighter') {
      // THE FIGHTER USES THE CUTOUT, NOT A PORTRAIT CANVAS. `drawPortrait` renders the roster's
      // framing into a 480x240 box and the result, dropped to black, read as an empty card. The
      // cutout is the same image the locked roster tile uses (8f_vault.js), it is already a clean
      // alpha shape, and a shape is the whole point of a silhouette.
      const f = el('div', 'vk-face');
      try {
        const id = typeof ASSET_ID === 'function' ? ASSET_ID(d.unlocks) : d.unlocks;
        f.style.backgroundImage = 'url(assets/' + id + '_cut.webp)';
      } catch (e) { /* no cutout: the plate and the question mark still read */ }
      box.appendChild(f);
    } else {
      const c = el('canvas'); c.width = 480; c.height = 240;
      let drew = false;
      // the stage's own backdrop, the same call the picker makes (85_menu.js UI.paintStage)
      try { if (typeof UI !== 'undefined' && UI.paintStage) { UI.paintStage(c, d.unlocks); drew = true; } } catch (e) { drew = false; }
      // No painter in this build (headless, or a trimmed one): a flat plate behind the question
      // mark still sells it. An empty white canvas would not.
      if (!drew) { const g = c.getContext('2d'); if (g) { g.fillStyle = '#0a0b14'; g.fillRect(0, 0, c.width, c.height); } }
      box.appendChild(c);
    }
    if (locked) {
      const lk = el('span', 'vk-q');
      // the one lock, defined once in 8f_vault.js; if that file is not in this build the card
      // simply has no badge rather than falling back to the cheap glyph it replaced
      try { lk.innerHTML = window.VaultArt.lock; box.appendChild(lk); } catch (e) { /* no vault UI */ }
    }
    return box;
  }
  function vaultCard(d) {
    const owned = Econ.owns(d.id), g = Econ.gradeOf(d);
    const c = el('button', 'vk-card');
    c.style.setProperty('--rc', g.color);
    c.appendChild(vaultArt(d, !owned));
    const b = el('div', 'vk-body');
    b.appendChild(el('div', 'vk-kind', d.kind === 'stage' ? 'Secret stage' : 'Secret fighter'));
    // THE SHOP NAMES IT, THE PICKER DOES NOT. A "???" card at $6.99 is a mystery box, and a stage
    // nobody can see is a bad purchase -- so the shelf says what it is and shows the shadow, and the
    // secret is kept where it belongs: the stage picker and the select screen, where it is a locked
    // slot with a question mark in it.
    b.appendChild(el('div', 'vk-nm', d.name));
    b.appendChild(el('div', 'vk-sub', d.blurb));
    if (d.how) b.appendChild(el('div', 'vk-how', d.how));
    const row = el('div', 'vk-row');
    if (owned) row.appendChild(el('span', 'vk-own', 'Unlocked'));
    else { row.appendChild(el('span', 'vk-pr', M(d.price))); row.appendChild(el('span', 'vk-get', TOUCH ? 'Tap to unlock' : 'Click to unlock')); }
    b.appendChild(row);
    c.appendChild(b);
    c.onclick = () => { sfx(); act(d); };
    return c;
  }
  const fmtN = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'K' : String(n | 0));
  // one click, one action, always the one the card shows
  function act(d) {
    if (!Econ.owns(d.id)) return buy(d);
    if (d.type === 'vault') {
      note(d.kind === 'stage'
        ? d.name + ' is yours. It is in the stage picker now, on every device you sign in on.'
        : d.name + ' is yours. Pick it on the select screen, on every device you sign in on.', 'Unlocked');
      return;
    }
    if (d.type === 'weapon') { if (!Econ.toggleLoadout(d.id)) note('Three weapons in the arsenal at a time. Take one out first.'); }
    else if (d.type === 'skin') Econ.equipSkin(d.id);
    // a wearable is worn in the Locker, where its serial, condition and fit live. Sending the player
    // there beats a second, worse copy of that screen inside a shop card.
    else if (d.type === 'gear') { if (window.Locker) { stopClock(); byId('scStore').hidden = true; Locker.open('scStore'); } }
    else Econ.equip(d.id);
    render();
  }

  // ---- THE CATEGORY ROW ----------------------------------------------------------------------
  // Duane: "theres not even an item section where u can buy stuff for appearance/skins". There is
  // now, and it is the first thing after All. fortnite.gg splits its 21,920 cosmetics into thirty
  // categories down the side of the page; this is the same idea at our size, and it is what turns a
  // flat shelf of 261 things into a shop you can shop in.
  const MK_CATS = [
    ['all', 'All'],
    // The Vault sits second, straight after All. It is three items against the market's 261, and it
    // is the only shelf in the shop that never rotates -- which is exactly why it goes near the front
    // rather than at the end behind eleven cosmetic categories.
    ['vault', 'The Vault'],
    ['wear', 'Appearance'],
    ['guard', 'Shields'],
    ['hands', 'Gloves'],
    ['hat', 'Head'],
    ['charm', 'Charms'],
    ['weapon', 'Weapons'],
    ['skin', 'Finishes'],
    ['ko', 'KO effects'],
    ['taunt', 'Taunts'],
    ['fx', 'Auras & trails'],
    ['name', 'Names & plates'],
  ];
  function inCat(d, cat) {
    if (cat === 'all') return true;
    if (cat === 'vault') return d.type === 'vault';
    if (cat === 'wear') return d.type === 'gear';
    if (cat === 'weapon') return d.type === 'weapon';
    if (cat === 'skin') return d.type === 'skin';
    if (cat === 'fx') return d.slot === 'aura' || d.slot === 'trail' || d.slot === 'finish';
    if (cat === 'name') return d.slot === 'plate' || d.slot === 'title' || d.slot === 'pose';
    if (cat === 'ko' || cat === 'taunt') return d.slot === cat;
    return d.type === 'gear' && d.slot === cat;      // a locker slot
  }

  // the seven tabs fortnite.gg carries, with their live counts
  const MK_TABS = [['all', 'All'], ['new', 'New'], ['wish', 'My wishlist'], ['diff', 'Different than yesterday'],
    ['leaving', 'Leaving'], ['wait', 'Longest wait'], ['best', 'Best sellers']];
  const MK_SORTS = [['heat', 'Heat'], ['grade', 'Grade'], ['low', 'Lowest price'], ['high', 'Highest price'],
    ['new', 'Newest'], ['soon', 'Leaving first'], ['name', 'A to Z']];
  function mkRows(day) {
    // THE VAULT DOES NOT ROTATE and is not on the daily shelf at all (`Econ.sellable()` leaves it
    // out on purpose), so it short-circuits every tab, sort and clock below. A secret stage that was
    // "leaving today" would be a lie, and one that only appeared on the days the shelf rolled it
    // would be worse.
    if (S.cat === 'vault') return Econ.vault().slice();
    const on = Econ.shelf(day);
    const yest = new Set(Econ.shelf(day - 1).map(x => x.id));
    let out = on;
    if (S.mk === 'new') out = on.filter(x => Econ.isNewToday(x.id, day));
    else if (S.mk === 'wish') out = Econ.wishList();
    else if (S.mk === 'diff') out = on.filter(x => !yest.has(x.id));
    else if (S.mk === 'leaving') out = on.filter(x => Econ.leavingToday(x.id, day));
    else if (S.mk === 'wait') out = Econ.sellable().filter(x => !Econ.onShelf(x.id, day));
    else if (S.mk === 'best') out = Econ.sellable().slice();
    // PICKING A CATEGORY SHOWS THE WHOLE CATEGORY, not today's slice of it. Fortnite can rotate a
    // 387-item shelf because it has 21,920 cosmetics behind it; we have 261, so filtering the daily
    // shelf by category left Shields showing 2 of 20 and often zero, which is exactly what Duane
    // saw. All is the daily shop; every other tab is the catalogue, with the daily ones flagged.
    if (S.cat !== 'all') out = Econ.sellable().filter(x => inCat(x, S.cat));
    const ord = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const gi = x => ord.indexOf(Econ.gradeOf(x).id);
    out = out.slice().sort((a, b) => {
      if (S.sort === 'grade') return gi(b) - gi(a) || a.name.localeCompare(b.name);
      if (S.sort === 'low') return (a.price || 0) - (b.price || 0);
      if (S.sort === 'high') return (b.price || 0) - (a.price || 0);
      if (S.sort === 'new') return (Econ.isNewToday(b.id, day) ? 1 : 0) - (Econ.isNewToday(a.id, day) ? 1 : 0);
      if (S.sort === 'soon') return Econ.secsLeft(a.id, day) - Econ.secsLeft(b.id, day);
      if (S.sort === 'name') return a.name.localeCompare(b.name);
      return Econ.reactTotal(b.id) - Econ.reactTotal(a.id) || Econ.heat(b.id) - Econ.heat(a.id);
    });
    if (S.mk === 'wait') out.sort((a, b) => Econ.daysSince(b.id, day) - Econ.daysSince(a.id, day));
    return out.slice(0, 220);
  }
  function marketView() {
    const w = el('div');
    w.id = 'mkWrap';
    renderMarket(w);
    return w;
  }
  function renderMarket(host) {
    const w = host || byId('mkWrap'); if (!w) return;
    const day = Econ.day();
    w.textContent = '';
    // ---- the head: title, date, and the clock everything else hangs off
    const hd = el('div', 'mk-head');
    hd.appendChild(el('h2', '', 'Brawl Street Market'));
    const dt = new Date();
    hd.appendChild(el('div', 'mk-date', dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase()));
    const rs = el('div', 'mk-reset'); rs.id = 'mkReset';
    rs.innerHTML = 'Resets in <b>' + clockText() + '</b>';
    hd.appendChild(rs);
    // the featured shelf name. "Rare" is a database field; "Closing Bell" is a reason to look.
    const feat = Econ.featured(day);
    if (feat) hd.appendChild(el('div', 'mk-date', feat.name + ' · ' + feat.sub));
    w.appendChild(hd);
    // ---- the tab row, with the counts
    const cnt = Econ.tabCounts(day);
    const N = { all: cnt.all, new: cnt.fresh, wish: cnt.wish, diff: cnt.diff, leaving: cnt.leaving };
    const tabs = el('div', 'mk-tabs');
    for (const [id, label] of MK_TABS) {
      const b = el('button', S.mk === id ? 'on' : '');
      b.appendChild(document.createTextNode(label));
      if (N[id] != null) { const i = el('i', '', String(N[id])); b.appendChild(i); }
      b.onclick = () => { S.mk = id; sfx(); renderMarket(); };
      tabs.appendChild(b);
    }
    w.appendChild(tabs);
    // ---- sort + the free card of the day
    const ctrl = el('div', 'mk-ctrl');
    const sb = el('button');
    sb.innerHTML = 'Sort by <b>' + (MK_SORTS.find(s => s[0] === S.sort) || MK_SORTS[0])[1] + '</b>';
    sb.onclick = () => { const i = MK_SORTS.findIndex(s => s[0] === S.sort); S.sort = MK_SORTS[(i + 1) % MK_SORTS.length][0]; sfx(); renderMarket(); };
    ctrl.appendChild(sb);
    const fo = Econ.freeToday(day);
    if (fo) {
      const fb = el('button');
      fb.innerHTML = 'Free today <b>' + esc(fo.name) + '</b>';
      fb.onclick = () => { sfx(); S.mk = 'all'; renderMarket(); };
      ctrl.appendChild(fb);
    }
    const tu = Econ.tradeReady();
    if (tu.length) {
      const tb = el('button');
      tb.innerHTML = 'Trade-up ready <b>' + tu.length + '</b>';
      tb.onclick = () => { sfx(); if (window.Locker) { byId('scStore').hidden = true; Locker.open('scStore'); } };
      ctrl.appendChild(tb);
    }
    w.appendChild(ctrl);
    // ---- the category row
    const cats = el('div', 'mk-tabs');
    cats.style.marginTop = '10px';
    const day0 = day;
    const all = Econ.sellable();
    for (const [id, label] of MK_CATS) {
      // The vault is counted from its own list: it is deliberately NOT in `sellable()` (it never
      // rotates onto the daily shelf), so it counted 0 and the line below dropped the chip
      // entirely -- the shelf rendered perfectly and there was no way in the shop to reach it.
      const n = id === 'all' ? Econ.shelf(day0).length
        : id === 'vault' ? Econ.vault().length
        : all.filter(x => inCat(x, id)).length;
      if (!n && id !== 'all') continue;
      const b2 = el('button', S.cat === id ? 'on' : '');
      b2.appendChild(document.createTextNode(label));
      b2.appendChild(el('i', '', String(n)));
      b2.onclick = () => { S.cat = id; sfx(); renderMarket(); };
      cats.appendChild(b2);
    }
    w.appendChild(cats);
    // The colour row is GONE, 2026-10-16. Duane: "remove the colour search thing on the market that
    // makes no sense why?" It is a csgoskins feature and it earns its place there because that
    // catalogue is 15,718 skins deep; on a shelf of 26 items a row of twelve swatches is a filter
    // that removes almost everything and finds nothing. `Econ.colorOf` stays for the day a search
    // page needs it, and nothing in the shop calls it.
    // ---- the shelf
    const rows = mkRows(day);
    if (S.cat === 'vault') {
      const hd2 = el('div', 'vk-head');
      hd2.appendChild(el('h3', '', 'The Vault'));
      hd2.appendChild(el('p', '', 'Three things that were built and never listed: two stages that are in no picker, and one fighter that is in no roster. They show as a shadow with a question mark until they are yours. Unlocked once, on your account, on every device you ever play on.'));
      w.appendChild(hd2);
      const g = el('div', 'vk-grid');
      for (const d of rows) g.appendChild(vaultCard(d));
      w.appendChild(g);
      w.appendChild(el('p', 'st-note', 'The vault never rotates and nothing in it goes away. None of it carries a weapon or a combat number — a stage is a stage, and both players fight on it.'));
      return;
    }
    if (!rows.length) {
      w.appendChild(el('div', 'mk-empty', S.mk === 'wish'
        ? 'Nothing on your wishlist yet. Tap the star on any card and you will be told when it comes back.'
        : 'Nothing on this shelf right now. The market turns over every day.'));
    } else {
      const g = el('div', 'mk-grid');
      for (const d of rows) g.appendChild(mkCard(d, day));
      w.appendChild(g);
    }
    w.appendChild(el('p', 'st-note', 'The shelf turns over every day at ' + resetLocal() + '. A card shows what is left of its run, and anything with a green flag goes tonight. Nothing here changes a hitbox, so all of it is legal in a money match.'));
  }
  function clockText() {
    const s = Econ.toReset();
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = n => String(n).padStart(2, '0');
    return p(hh) + ':' + p(mm) + ':' + p(ss);
  }
  function resetLocal() {
    const d = new Date(); d.setUTCHours(Econ.CAT.shop.resetHour, 0, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  // The clock is the single highest-return thing in the whole teardown, so it ticks for real. One
  // interval for the whole screen, started when the market is shown and cleared when it is not:
  // a timer left running behind a hidden screen is how a menu ends up repainting during a fight.
  function startClock() {
    stopClock();
    S.clock = setInterval(() => {
      const r = byId('mkReset'); if (!r) return stopClock();
      r.innerHTML = 'Resets in <b>' + clockText() + '</b>';
      // the per-card countdowns are printed in days and hours, so they only move when the shelf
      // turns over; when the clock reaches zero the whole shelf is redrawn rather than ticked.
      if (Econ.toReset() <= 1) renderMarket();
    }, 1000);
  }
  function stopClock() { if (S.clock) { clearInterval(S.clock); S.clock = null; } }

  // ---- the finishes tab: one weapon at a time, its shelf of paints underneath ----------------
  function skinsView() {
    const w = el('div', 'shelf');
    w.appendChild(el('h3', '', 'Weapon finishes'));
    w.appendChild(el('div', 'sub', Econ.skins().length + ' finishes across ' + Econ.CAT.weapons.length + ' weapons · equipped per weapon'));
    // the weapon rail
    const rail = el('div', 'mk-ctrl'); rail.style.justifyContent = 'flex-start';
    const first = S.skinFor || Econ.CAT.weapons[0].id;
    for (const wp of Econ.CAT.weapons) {
      const n = Econ.skinsFor(wp.id).length; if (!n) continue;
      const b = el('button');
      b.innerHTML = esc(wp.name) + ' <b>' + n + '</b>';
      if (first === wp.id) { b.style.color = '#05070b'; b.style.background = '#fff'; b.style.boxShadow = 'none'; }
      b.onclick = () => { S.skinFor = wp.id; sfx(); render(); };
      rail.appendChild(b);
    }
    w.appendChild(rail);
    const list = Econ.skinsFor(first).map(s => Econ.BYID[s.id]);
    const ord = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    list.sort((a, b) => ord.indexOf(b.grade) - ord.indexOf(a.grade));
    const g = el('div', 'mk-grid');
    const day = Econ.day();
    for (const d of list) g.appendChild(mkCard(d, day));
    w.appendChild(g);
    w.appendChild(el('p', 'st-note', 'A finish is bought for ONE weapon and worn on that weapon, the way Counter-Strike does it. You do not own "gold", you own The Chopper in Bodega Gold. It paints whatever is in your hands during a fight and the sidearm on your back between them.'));
    return w;
  }

  // ---------------- the arsenal editor (store tab + the lobby button) ----------------
  // 15 Oct, rebuilt. It was a SECOND copy of the Weapons tab: all 21 weapons in scrambled order, each
  // with a price, an OWNED badge and an "Add to arsenal" button, under a heading that says three
  // weapons and a counter reading 0/3 — and nothing on the screen showed which three were picked.
  // It is a loadout screen now: the three slots first, then only what you actually own.
  function arsenalEditor() {
    const w = el('div', 'shelf');
    w.appendChild(el('h3', '', 'My arsenal'));
    w.appendChild(el('div', 'sub', 'Three weapons. Casual and party matches only'));
    const lo = Econ.loadout();
    // the three slots, always drawn, full width, so the screen says what it is before anything loads
    const slots = el('div', 'ars-slots');
    for (let i = 0; i < 3; i++) {
      const id = lo[i], d = id && Econ.BYID[id];
      const s = el('div', 'ars-slot' + (d ? ' full' : ''));
      s.style.setProperty('--rc', d ? rarityOf(d).col : 'var(--line2)');
      if (d) {
        const art = el('div', 'ic');
        if (window.ItemArt && ItemArt.has(d.id)) art.innerHTML = ItemArt.html(d.id, rarityOf(d).col, 128);
        else art.textContent = d.icon || '◆';
        s.appendChild(art);
        s.appendChild(el('b', '', d.name));
        s.appendChild(el('span', '', (d.charges || 1) + ' per match'));
        const x = el('button', 'ars-x', 'Remove');
        x.onclick = ev => { ev.stopPropagation(); sfx(); Econ.toggleLoadout(d.id); render(); };
        s.appendChild(x);
      } else {
        s.appendChild(el('div', 'ic', ''));
        s.appendChild(el('b', '', 'Slot ' + (i + 1)));
        s.appendChild(el('span', '', 'Empty'));
      }
      slots.appendChild(s);
    }
    w.appendChild(slots);
    // the rules line sat at the very bottom under four rows of cards. It is the most important
    // sentence on the screen, so it goes directly under the slots.
    const mode = el('p', 'st-note');
    mode.innerHTML = 'In a local or casual match the arsenal button sits in the top-left corner. Press <b>Tab</b> and pick one — it goes straight into your hands. Seven seconds between deploys. In a <b>wagered or ranked</b> match the button is gone and nothing here is loaded, and that rule is enforced by the server, not by this screen.';
    w.appendChild(mode);
    const owned = Econ.ownedWeapons();
    if (!owned.length) {
      // an empty loadout sells harder than a wall of things you cannot buy
      const e = el('p', 'st-note', 'Nothing in your arsenal yet. ');
      const b = el('button', 'btn small', 'Browse weapons');
      b.onclick = () => { sfx(); S.tab = 'weapons'; store.set('storeTab', 'weapons'); render(); };
      e.appendChild(b);
      w.appendChild(e);
      return w;
    }
    w.appendChild(el('div', 'sub', owned.length + ' weapon' + (owned.length === 1 ? '' : 's') + ' you own'));
    const g = gridFor(owned.length);
    for (const d of owned) g.appendChild(card(d, 'weapon'));
    w.appendChild(g);
    return w;
  }

  // ---------------- the in-match rail ----------------
  function hudSafeTop() { return (typeof window.TB_HUD_SAFE_TOP === 'number' ? window.TB_HUD_SAFE_TOP : 0) || (Game.fighters && Game.fighters.length > 2 ? 16 : 140); }
  function railVisible() {
    if (typeof Game === 'undefined') return false;
    if (Game.state !== 'match' || Game.paused || Game.endT) return false;
    return !!Game.arsenalOn && !!(Game.fighters && Game.fighters[0] && Game.fighters[0].arsenal);
  }
  function toggleRail() { S.rail = !S.rail; renderRail(); }
  function renderRail() {
    const btn = byId('arsBtn'), rail = byId('arsRail');
    if (!btn) return;
    const on = railVisible();
    const top = hudSafeTop();
    btn.style.top = top + 'px';
    rail.style.top = (top + 60) + 'px';
    btn.classList.toggle('on', on);
    if (!on) { rail.classList.remove('on'); S.rail = false; window.TB_ARSENAL_RECT = null; return; }
    window.TB_ARSENAL_RECT = { x: 16, y: top, w: S.rail ? 186 : 52, h: S.rail ? 60 + 52 * 3 : 52 };
    const st = Econ.arsenalState(0);
    const left = st.reduce((a, s) => a + s.left, 0);
    btn.textContent = '🎒';
    if (left) { const i = el('i', '', String(left)); btn.appendChild(i); }
    rail.classList.toggle('on', S.rail);
    if (!S.rail) return;
    rail.textContent = '';
    rail.appendChild(el('div', 'hd', 'Arsenal · 1 2 3'));
    if (!st.length) { rail.appendChild(el('div', 'ars-empty', 'Nothing equipped. Open the Store and put up to three weapons in your arsenal.')); return; }
    st.forEach((s, i) => {
      const b = el('button', 'ars-i' + (s.ready ? '' : ' off'));
      b.appendChild(el('div', 'ic', s.def.icon));
      const tx = el('div', 'tx'); tx.appendChild(el('b', '', s.def.name));
      tx.appendChild(el('span', '', s.wait > 0 ? 'in ' + Math.ceil(s.wait / 60) + 's' : s.left > 0 ? s.left + ' left' : 'spent'));
      b.appendChild(tx);
      b.appendChild(el('div', 'key', String(i + 1)));
      if (s.cd > 0) { const f = el('div', 'cdf'); f.style.width = (100 - s.cd / 420 * 100).toFixed(0) + '%'; b.appendChild(f); }
      b.onclick = ev => { ev.stopPropagation(); deploy(i, 0); };
      rail.appendChild(b);
    });
  }
  function deploy(i, slot) {
    const idx = slot || 0, st = Econ.arsenalState(idx), s = st[i];
    if (!s) return;
    if (!s.ready) { sfx(); return; }
    if (Econ.deploy(s.id, idx)) { sfx('coin'); if (!idx) S.rail = false; }
    renderRail();
  }

  // ---------------- profile ----------------
  function showStore() { build(); byId('scProfile').hidden = true; byId('scStore').hidden = false; if (typeof Game !== 'undefined' && Game.state === 'title') Game.state = 'menu'; render(); }
  function showProfile() { build(); byId('scStore').hidden = true; byId('scProfile').hidden = false; renderProfile(); }
  function closeStore() {
    stopClock();
    byId('scStore').hidden = true; byId('scProfile').hidden = true;
    if (typeof UI !== 'undefined' && UI.title && (typeof Game === 'undefined' || Game.state !== 'match')) UI.title();
  }
  function renderProfile() {
    const body = byId('pfBody'); if (!body) return;
    body.textContent = '';
    const N = (typeof Net !== 'undefined' && Net.state) ? Net.state : null;
    const me = N && N.me, prof = me && me.profile;
    const S2 = Econ.S, bar = Econ.xpBar();
    const left = el('div', 'panel');
    left.appendChild(el('div', 'eyebrow', 'Fighter'));
    // the same chain the share card uses (cardName), not a second copy of it. This screen kept its
    // own `|| 'Unnamed'` fallback, so a player with no account -- which is EVERY player on the portal
    // and desktop builds, where there is no online -- opened their profile and read "Unnamed" in
    // 56px chrome type, while the card beside it had already learned to say their fighter's name.
    left.appendChild(el('div', 'pf-big', cardName()));
    const stats = el('div', 'pf-stats');
    const rec = (prof && prof.record) || S2.record;
    // Rating and Season rank are ONLINE numbers, and the portal and desktop builds have no online at
    // all -- so on every one of them this row showed two permanent em dashes, which is the same dead
    // cell the share card used to have. Show what is actually known instead, and drop the season cell
    // entirely rather than print a placeholder. Losses stay here (this is the player's own record
    // screen, not the card they post).
    const rows = [
      [String(bar.level), 'Level'],
      prof && prof.elo != null ? [String(prof.elo), 'Rating'] : [String(((rec && rec.w) || 0) + ((rec && rec.l) || 0)), 'Matches'],
      [String((rec && rec.w) || 0), 'Wins'],
      [String((rec && rec.l) || 0), 'Losses'],
      [String((rec && rec.ko) || 0), 'KOs'],
    ];
    if (S2.season && S2.season.rank) rows.push(['#' + S2.season.rank, 'Season rank']);
    for (const [v, k] of rows) { const d = el('div', 'pf-stat'); d.appendChild(el('b', '', v)); d.appendChild(el('span', '', k)); stats.appendChild(d); }
    left.appendChild(stats);
    const xw = el('div', 'st-bar');
    xw.appendChild(el('span', 'st-lv', String(bar.level)));
    const xb = el('div', 'st-xp'); const xi = el('i'); xi.style.width = (bar.pct * 100).toFixed(1) + '%'; xb.appendChild(xi); xw.appendChild(xb);
    xw.appendChild(el('span', '', bar.into + ' / ' + bar.need + ' XP'));
    left.appendChild(xw);
    left.appendChild(el('div', 'eyebrow', 'Badges'));
    const bd = el('div', 'pf-bad');
    const badges = (S2.badges || []).slice();
    if (bar.level >= 10) badges.push({ icon: '🎖️', name: 'Level ' + bar.level });
    if (S2.season && S2.season.rank && S2.season.rank <= 10) badges.push({ icon: '🔟', name: 'Top 10 · ' + S2.season.id });
    if (!badges.length) bd.appendChild(el('div', 'b', 'No badges yet. Finish a season in the top 100.'));
    for (const b of badges) { const e = el('div', 'b'); e.appendChild(el('span', '', b.icon || '🏅')); e.appendChild(el('span', '', b.name || b.id)); bd.appendChild(e); }
    left.appendChild(bd);

    const right = el('div', 'panel');
    right.appendChild(el('div', 'eyebrow', 'Equipped'));
    const show = el('div', 'pf-show');
    const LBL = { finish: 'Finish', aura: 'Aura', trail: 'Trail', ko: 'KO effect', pose: 'Victory', plate: 'Plate' };
    for (const slot of Econ.SLOTS) {
      const id = Econ.equipped(slot), d = id && Econ.BYID[id];
      const box = el('div');
      box.appendChild(el('div', 'i', d ? d.icon : '·'));
      box.appendChild(el('b', '', d ? d.name : 'None'));
      box.appendChild(el('span', '', LBL[slot]));
      show.appendChild(box);
    }
    right.appendChild(show);
    right.appendChild(el('div', 'eyebrow', 'Arsenal'));
    const ar = el('div', 'pf-show');
    const lo = Econ.loadout();
    if (!lo.length) ar.appendChild(el('div', '', 'Nothing equipped'));
    for (const id of lo) { const d = Econ.BYID[id], box = el('div'); box.appendChild(el('div', 'i', d.icon)); box.appendChild(el('b', '', d.name)); box.appendChild(el('span', '', (d.charges || 1) + ' per match')); ar.appendChild(box); }
    right.appendChild(ar);
    const owned = Econ.ownedWeapons().length, all = Econ.CAT.weapons.length;
    right.appendChild(el('p', 'st-note', `You own ${owned} of ${all} weapons and ${Econ.CAT.cosmetics.filter(c => Econ.owns(c.id)).length} of ${Econ.CAT.cosmetics.length} cosmetics.`));
    const cl = el('div', 'row'); cl.style.justifyContent = 'flex-start';
    const b1 = el('button', 'btn small', 'Clip the last 10 s');
    b1.onclick = () => { sfx(); if (window.Clip && Clip.take) Clip.take(); else note('Clips need a match on screen. Press C during a fight.'); };
    cl.appendChild(b1);
    right.appendChild(cl);
    body.append(left, right, accountPanel());
  }

  // ---- THE ACCOUNT PANEL ----------------------------------------------------------------------
  // Duane, 2026-10-16: *"you need to make sure peoples games get saved with their twittter profile
  // or whatever make sure what they buy always gets saved ok?"*
  //
  // Both halves of that already existed and were not joined up:
  //   - every purchase is already an entitlement on a SERVER-SIDE account (net/lib/economy.js), so
  //     nothing bought has ever lived in a save file or in localStorage;
  //   - an account is reachable by a device token, and `lib/xverify.js` can already prove somebody
  //     holds an X handle.
  // What was missing: the account was reachable ONLY by that device token, so a cleared cache or a
  // new phone meant a new account -- and the one screen that could connect a handle was inside the
  // character creator, which was removed on 9/29, so in the shipping build there was no way to do it
  // at all. This is that screen, somewhere a player will actually find it, and the server now treats
  // a handle that is already connected as a SIGN-IN rather than an error (server.js xAdopt).
  const AC = { st: null, msg: '', bad: false, rec: null, wired: false };
  function acSend(m) { try { Net.send(m); } catch (e) { /* offline */ } }
  function acWire() {
    if (AC.wired) return; AC.wired = true;
    try {
      if (typeof Net === 'undefined' || !Net.on) return;
      Net.on(m => {
        if (m.k === 'xstate') { AC.st = m; if (m.x) { AC.msg = ''; AC.bad = false; } }
        else if (m.k === 'recovery') { AC.rec = m.code; }
        else if (m.k === 'me' && m.recovered) { AC.msg = 'Signed in. Everything on that account is back.'; AC.bad = false; }
        else if (m.k === 'err' && (m.code === 'x' || m.code === 'recover')) { AC.msg = m.msg || 'That did not work.'; AC.bad = true; }
        else if (m.k === 'welcome') { AC.st = { x: (m.profile && m.profile.x) || null, xav: (m.profile && m.profile.xav) || null, pending: null }; }
        else return;
        const sc = byId('scProfile');
        if (sc && !sc.hidden) renderProfile();
      });
    } catch (e) { /* no net in this build */ }
  }
  function accountPanel() {
    acWire();
    const p = el('div', 'panel ac');
    p.appendChild(el('div', 'eyebrow', 'Account'));
    const owned = Econ.vaultOwned().length, vt = Econ.vault().length;
    const st = AC.st, on = Econ.connected();
    p.appendChild(el('div', 'pf-big', xHandle() ? '@' + xHandle() : 'This device only'));

    if (!on) {
      p.appendChild(el('p', 'ac-note', 'Connecting needs you online. Open ONLINE once and this turns on. Everything you own is already held on your account by the server, not in this browser — but until an X account is on it, this browser is the only way back to it.'));
      return p;
    }
    if (st && st.x) {
      const row = el('div', 'ac-ok');
      if (st.xav) { const im = el('img'); im.src = st.xav; im.alt = ''; row.appendChild(im); }
      row.appendChild(el('b', '', '@' + st.x));
      row.appendChild(el('span', 'tick', 'connected'));
      const off = el('button', 'ac-btn ghost', 'Disconnect'); off.style.marginLeft = 'auto';
      off.onclick = () => { sfx(); AC.msg = ''; acSend({ k: 'xforget' }); };
      row.appendChild(off);
      p.appendChild(row);
      p.appendChild(el('p', 'ac-note', 'Signed in. Open the game anywhere, connect @' + st.x + ' again, and this account comes with it — the '
        + (owned ? owned + ' of ' + vt + ' vault unlocks you own' : 'vault, the arsenal, the locker') + ', the record and the rating. Nothing is kept in this browser.'));
      p.appendChild(recoveryRow());
      return p;
    }
    if (st && st.pending) {
      const box = el('div', 'ac-code');
      const b = el('b', '', st.pending.code); b.id = 'acCode';
      box.appendChild(b);
      box.appendChild(el('span', 'ac-note', 'goes anywhere in @' + st.pending.handle + '’s X bio'));
      p.appendChild(box);
      const row = el('div', 'ac-row');
      const open = el('button', 'ac-btn', 'Copy code & open X');
      open.onclick = async () => {
        sfx();
        let copied = false;
        try { await navigator.clipboard.writeText(st.pending.code); copied = true; } catch (e) { copied = false; }
        AC.msg = copied ? 'Code copied. Paste it into your bio on X and save.' : 'Copy the code above, then open x.com/settings/profile.';
        AC.bad = false; renderProfile();
        window.open('https://x.com/settings/profile', '_blank', 'noopener');
      };
      const other = el('button', 'ac-btn ghost', 'Different handle');
      other.onclick = () => { sfx(); AC.msg = ''; acSend({ k: 'xforget' }); };
      row.append(open, other);
      p.appendChild(row);
      const w = el('p', 'ac-note'); w.appendChild(el('span', 'ac-dot'));
      w.appendChild(el('span', '', 'Watching @' + st.pending.handle + ' — save your bio on X and this connects by itself. Delete the code again straight after; the connection sticks.'));
      p.appendChild(w);
      if (AC.msg) p.appendChild(el('p', 'ac-note' + (AC.bad ? ' bad' : ''), AC.msg));
      return p;
    }
    const row = el('div', 'ac-row');
    const at = el('div', 'ac-at');
    at.appendChild(el('span', '', '@'));
    const inp = el('input'); inp.id = 'acX'; inp.maxLength = 15; inp.autocomplete = 'off'; inp.spellcheck = false; inp.placeholder = 'yourhandle';
    at.appendChild(inp);
    const go = el('button', 'ac-btn', 'Connect');
    const send = () => {
      const h = String(inp.value || '').trim().replace(/^@+/, '');
      if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) { AC.msg = 'That is not an X handle. Letters, numbers and underscore, up to 15.'; AC.bad = true; return renderProfile(); }
      AC.msg = ''; acSend({ k: 'xclaim', handle: h });
    };
    go.onclick = () => { sfx(); send(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    row.append(at, go);
    p.appendChild(row);
    if (AC.msg) p.appendChild(el('p', 'ac-note' + (AC.bad ? ' bad' : ''), AC.msg));
    p.appendChild(el('p', 'ac-note', 'You get a code, you put it in your X bio for a moment, and that proves the account is yours. Twenty seconds, once — and then everything you own follows that handle to any device, any browser, any phone. Already connected it somewhere else? Do the same thing here and this device joins that account instead of starting a new one.'));
    p.appendChild(recoveryRow());
    return p;
  }
  // The no-X fallback, kept because not everybody has an X account: a one-time code that is shown
  // once and stored hashed (net/lib/accounts.js). The X route exists because nobody writes these down.
  function recoveryRow() {
    const box = el('div');
    if (AC.rec) {
      box.appendChild(el('div', 'ac-rec', AC.rec));
      box.appendChild(el('p', 'ac-note', 'Write this down now — it is shown once and it is not stored anywhere we can read. Anyone who has it can take the account, so keep it somewhere private.'));
      return box;
    }
    const row = el('div', 'ac-row'); row.style.marginTop = '10px';
    const b = el('button', 'ac-btn ghost', 'Get a recovery code');
    b.onclick = () => { sfx(); acSend({ k: 'recovery_new' }); };
    row.appendChild(b);
    box.appendChild(row);
    box.appendChild(el('p', 'ac-note', 'No X account? A recovery code brings this account back on any device. It replaces any code you were given before.'));
    return box;
  }

  // ---------------- share a win card ----------------
  // A 1200x675 PNG with the name, the record, the rank and the game's branding — the thing people
  // actually post. The MP4 clip (81_clip.js, key C) is the other half of the same marketing loop.
  // account name -> the name typed locally -> the name on the fighter they built -> BRAWLER
  function cardName() {
    const N = (typeof Net !== 'undefined' && Net.state) ? Net.state : null, me = N && N.me;
    if (me && me.name) return me.name;
    const local = store.get('netName', '');
    if (local) return local;
    try { const c = store.get('customLook', null); if (c && c.name) return c.name; } catch (e) { /* storage blocked */ }
    return 'BRAWLER';
  }
  // The player's own fighter, for the card. Same source the select screen uses: the transparent
  // cutout when there is one, the portrait jpg otherwise, and null if neither loads — the card then
  // falls back to the flat layout rather than leaving a hole. `lastChar` is written by UI.fight().
  function cardArt(cb) {
    let id = null;
    try { id = store.get('lastChar', null); } catch (e) { /* storage blocked */ }
    if (!id) return cb(null);
    const base = 'assets/' + (typeof ASSET_ID === 'function' ? ASSET_ID(id) : id);
    // one callback, whatever happens: a cached image can be `complete` before onload is attached, and
    // calling back twice would draw and download the card twice.
    let fired = false;
    const hand = im => { if (!fired) { fired = true; cb(im && im.naturalWidth ? im : null); } };
    const jpg = () => { const j = new Image(); j.onload = () => hand(j); j.onerror = () => hand(null); j.src = base + '.jpg'; if (j.complete) hand(j); };
    const im = new Image();
    im.onload = () => hand(im);
    im.onerror = jpg;
    im.src = base + '_cut.webp';
    if (im.complete) hand(im);
    setTimeout(() => hand(null), 4000);   // never leave the button doing nothing
  }
  function shareCard() { cardArt(img => drawCard(img)); }
  function drawCard(img) {
    const N = (typeof Net !== 'undefined' && Net.state) ? Net.state : null, me = N && N.me;
    const W = 1200, H = 675, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#12040a'); bg.addColorStop(0.5, '#05050a'); bg.addColorStop(1, '#04101c');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const r1 = g.createRadialGradient(140, 200, 10, 140, 200, 620); r1.addColorStop(0, 'rgba(255,42,74,.42)'); r1.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r1; g.fillRect(0, 0, W, H);
    const r2 = g.createRadialGradient(W - 140, H - 160, 10, W - 140, H - 160, 620); r2.addColorStop(0, 'rgba(42,107,255,.4)'); r2.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r2; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.strokeRect(30, 30, W - 60, H - 60);
    const chrome = (txt, x, y, size, align) => {
      g.font = `italic 900 ${size}px "Barlow Condensed", Impact, sans-serif`; g.textAlign = align || 'left';
      const gr = g.createLinearGradient(0, y - size * 0.82, 0, y);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.42, '#eef0f5'); gr.addColorStop(0.52, '#8f96a8'); gr.addColorStop(0.6, '#fff'); gr.addColorStop(1, '#c9ced9');
      g.lineWidth = Math.max(3, size / 9); g.strokeStyle = 'rgba(5,5,7,.85)'; g.lineJoin = 'round'; g.strokeText(txt, x, y);
      g.fillStyle = gr; g.fillText(txt, x, y);
    };
    g.font = '700 18px "JetBrains Mono", monospace'; g.fillStyle = '#ff2a4a'; g.textAlign = 'left';
    g.fillText('BRAWL STREET', 70, 110);
    // The name is the biggest thing on the card, and it only ever read `me.name` -- which exists only
    // with an online account. On the portal builds there is no account at all, so EVERY player's card
    // said UNNAMED in 104px type. The profile screen beside it already falls back to `netName`; this
    // uses the same chain and then the creator's fighter name, which is the most personal thing a
    // player who never signed in has. Last resort is BRAWLER, not UNNAMED: this is the one asset that
    // leaves the game, and it should not lead with a blank.
    // WITH the player's fighter, the card becomes two columns: name and a 2x2 of stats on the left,
    // the fighter filling the right. Without it, the original single row across the full width, so a
    // missing asset degrades to exactly what shipped before instead of leaving a hole.
    const art = !!img, LW = art ? 620 : W - 140;
    if (art) {
      // contain inside the right column, anchored to the bottom edge of the frame so the fighter
      // stands on it. Cutouts are portrait, portraits are square; both read correctly this way.
      const bx = 600, by = 78, bw = 1170 - bx, bh = H - 60 - by;
      const s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const dx = bx + (bw - dw) / 2, dy = by + (bh - dh);
      g.save();
      // a soft pool of light under the figure, so it sits on the card instead of floating on it
      const gl = g.createRadialGradient(dx + dw / 2, dy + dh - 10, 6, dx + dw / 2, dy + dh - 10, dw * 0.62);
      gl.addColorStop(0, 'rgba(255,42,74,.34)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gl; g.fillRect(bx - 40, by, bw + 80, bh + 30);
      g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 26; g.shadowOffsetY = 10;
      g.drawImage(img, dx, dy, dw, dh);
      g.restore();
    }
    // the name is the biggest thing here and it has a column to fit in now, so it is measured and
    // stepped down rather than allowed to run under the fighter. 16 characters is the name cap.
    const nm = cardName().toUpperCase();
    let nsz = 104;
    g.font = `italic 900 ${nsz}px "Barlow Condensed", Impact, sans-serif`;
    while (nsz > 44 && g.measureText(nm).width > LW - 70) { nsz -= 4; g.font = `italic 900 ${nsz}px "Barlow Condensed", Impact, sans-serif`; }
    chrome(nm, 70, 230, nsz);
    const bar = Econ.xpBar(), rec = Econ.S.record;
    const elo = me && me.profile && me.profile.elo != null ? String(me.profile.elo) : null;
    // RATING is an online Elo. With no account it drew an em dash -- an empty cell on a card people
    // post. Matches played is local, always real, and never a number to be embarrassed by (losses
    // deliberately do not appear on a shareable card).
    const cells = [['LEVEL', String(bar.level)], elo ? ['RATING', elo] : ['MATCHES', String((rec.w || 0) + (rec.l || 0))],
      ['WINS', String(rec.w || 0)], ['KOS', String(rec.ko || 0)]];
    cells.forEach(([k, v], i) => {
      const x = art ? 70 + (i % 2) * 250 : 70 + i * 250;
      const y = art ? 300 + Math.floor(i / 2) * 140 : 300;
      g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, y, 220, 120);
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.strokeRect(x, y, 220, 120);
      g.font = '700 13px "JetBrains Mono", monospace'; g.fillStyle = '#5d6272'; g.textAlign = 'left'; g.fillText(k, x + 18, y + 32);
      chrome(v, x + 18, y + 100, 58);
    });
    const eq = Econ.SLOTS.map(s => Econ.equipped(s)).filter(Boolean).map(id => Econ.BYID[id]);
    g.font = '700 14px "JetBrains Mono", monospace'; g.fillStyle = '#9398a8'; g.textAlign = 'left';
    g.fillText(eq.length ? eq.map(d => d.icon + ' ' + d.name.toUpperCase()).join('   ') : 'NO COSMETICS EQUIPPED', 70, art ? 596 : 486);
    // bottom RIGHT is where the fighter's feet are now, so with art the mark goes under the left
    // column instead. It read straight across the shoes the first time this was rendered.
    g.font = '700 16px "JetBrains Mono", monospace'; g.fillStyle = '#ffc83d'; g.textAlign = art ? 'left' : 'right';
    g.fillText('brawlstreet.lol/play', art ? 70 : W - 70, art ? 632 : H - 70);
    c.toBlob(b => {
      if (!b) return note('Could not make the card here.');
      const f = new File([b], 'brawl-street-card.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
        navigator.share({ files: [f], title: 'Brawl Street', text: 'My Brawl Street record' }).catch(() => {});
        return;
      }
      const u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = 'brawl-street-card.png'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      note('Card saved. Post it.');
    }, 'image/png');
  }

  // ---------------- toasts + XP ----------------
  let noteT = null;
  function note(msg, big) {
    build();
    const t = byId('econToast'); if (!t) return;
    t.textContent = '';
    if (big) { t.appendChild(el('b', '', big)); t.appendChild(el('span', '', msg)); }
    else t.appendChild(el('span', '', msg));
    t.classList.add('on');
    clearTimeout(noteT); noteT = setTimeout(() => t.classList.remove('on'), big ? 4200 : 2800);
  }
  // XP is awarded from the results screen. Local XP is provisional; the server recomputes it from its
  // own replay and overwrites this the next time the account syncs.
  function awardXp(won) {
    if (typeof Game === 'undefined' || !Game.fighters || !Game.fighters.length) return;
    const me = Game.fighters[0];
    if (!me || me.cpu) return;
    const r = Econ.addXp(Econ.matchXp(me, won), 'match');
    if (!r) return;
    const R = Econ.S.record; R.w = (R.w || 0) + (won ? 1 : 0); R.l = (R.l || 0) + (won ? 0 : 1);
    R.ko = (R.ko || 0) + ((me.stats && me.stats.kos) || 0);
    if (r.levelled) {
      const got = r.unlocked.map(w => w.name).join(', ');
      note(got ? 'Unlocked: ' + got : '+' + r.xp + ' XP', 'Level ' + r.level);
      sfx('coin');
    } else note('+' + r.xp + ' XP');
  }

  // ---------------- wiring ----------------
  function wire() {
    build();
    // title-screen buttons, beside the existing ones
    const row = document.querySelector('#scTitle .row:nth-of-type(2)') || document.querySelector('#scTitle .row');
    const host = byId('bHelp') ? byId('bHelp').parentElement : row;
    if (host && !byId('bStore')) {
      const b = el('button', 'btn', 'Store'); b.id = 'bStore'; b.onclick = () => { sfx(); showStore(); };
      const p = el('button', 'btn', 'Profile'); p.id = 'bProfile'; p.onclick = () => { sfx(); showProfile(); };
      host.insertBefore(b, byId('bHelp')); host.insertBefore(p, byId('bHelp'));
    }
    // results screen: a Store button beside Rematch
    const rr = byId('bRematch');
    if (rr && rr.parentElement && !byId('bResStore')) {
      const b = el('button', 'btn', 'Store'); b.id = 'bResStore'; b.onclick = () => { sfx(); showStore(); };
      rr.parentElement.appendChild(b);
    }
    // keys: Tab opens the rail, 1/2/3 deploy
    addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!byId('scStore').hidden || !byId('scProfile').hidden) { if (e.code === 'Escape') { e.preventDefault(); closeStore(); } return; }
      if (!railVisible()) return;
      if (e.code === 'Tab') { e.preventDefault(); sfx(); toggleRail(); return; }
      const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (n >= 0) { e.preventDefault(); deploy(n, 0); return; }
      // local 2-player on one keyboard: player 2 deploys with 7 8 9
      const n2 = ['Digit7', 'Digit8', 'Digit9'].indexOf(e.code);
      if (n2 >= 0 && Game.fighters[1] && !Game.fighters[1].cpu) { e.preventDefault(); deploy(n2, 1); }
    }, true);
    // close the rail when the fight is clicked
    addEventListener('pointerdown', e => { if (S.rail && !e.target.closest('#arsRail') && !e.target.closest('#arsBtn')) { S.rail = false; renderRail(); } }, true);

    // the arsenal is armed for LOCAL matches here. Online is armed by the server's room state in
    // 77_net.js -> Econ.arm('casual'|'ranked'|'wager'), never by this file.
    if (typeof UI !== 'undefined' && UI.fight) {
      const f0 = UI.fight;
      UI.fight = function () { const r = f0.apply(this, arguments); try { Econ.clearMatchCosmetics(); Econ.arm('local'); renderRail(); } catch (e) { /* never block the fight */ } return r; };
    }
    if (typeof UI !== 'undefined' && UI.showResults) {
      const s0 = UI.showResults;
      UI.showResults = function (w) {
        const r = s0.apply(this, arguments);
        try { if (!Game.arena && !Game.demo) awardXp(!!(w && w === Game.fighters[0])); } catch (e) { /* never block results */ }
        return r;
      };
    }
    setInterval(renderRail, 200);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', wire, { once: true }); else setTimeout(wire, 0);

  // `openVault` is what a locked stage card and a locked roster tile call (8f_vault.js): tapping the
  // question mark has to land on the thing it is selling, not on the shop's front page.
  function openVault() { build(); S.tab = 'market'; S.cat = 'vault'; S.mk = 'all'; showStore(); }
  window.EconUI = { showStore, showProfile, openVault, note, renderRail, shareCard, awardXp };
})();
