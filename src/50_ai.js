// ===== CPU opponent =====
const AI = {
  think(f, st) {
    const o = {}; for (const k of ACTIONS) o[k] = false;
    const a = f.ai, lvl = f.level, M = st.main;
    const press = k => { if (!f.prev[k]) o[k] = true; };
    const key = d => (d > 0 ? 'right' : 'left');
    if (a.holdT > 0) { for (const k of a.holdK) o[k] = true; a.holdT--; }
    const S = f.state;
    if (S === 'move' && f.c.ai2) MV2.aiMove(f, o, a);   // roster-2 fighters: hold charge / stream moves
    if (S === 'move' && Game.combos && COMBO.ai(f, o, press)) return o;   // combo follow-ups (23_combo)
    if (Game.feel && FEEL.ai(f, st, o, press)) return o;   // reactions, parries, burst, get-ups (25_feel)
    if (S === 'respawn') { if (f.st > 45) press('down'); return o; }
    if (S === 'hitstun' || S === 'grabbed' || S === 'dead' || S === 'climb') return o;
    if (S === 'ledge') {
      a.ledgeWait = a.ledgeWait || irand(12, 50);
      if (f.st > a.ledgeWait) {
        a.ledgeWait = 0;
        const r = Rng.next();
        if (r < 0.55) o[key(-f.ledge.side)] = true; else if (r < 0.8) press('jump'); else press('attack');
      }
      return o;
    }
    const tgt = AI.target(f);
    const off = f.x < M.x0 - 6 || f.x > M.x1 + 6 || f.y > M.top + 4;
    if (f.air && off) return AI.recover(f, st, o, press);
    if (S === 'grabbing') {
      if (f.st > 10) { if (tgt && tgt.dmg > 100) o.up = true; else o[key(f.x > 0 ? 1 : -1)] = true; }
      return o;
    }
    if (S === 'hammer') { if (tgt) { o[key(tgt.x > f.x ? 1 : -1)] = Math.abs(tgt.x - f.x) > 30; if (tgt.y < f.y - 80 && Rng.next() < 0.05) press('jump'); } return o; }
    if (!tgt) return o;
    // Final Smash: fire when someone is in front at roughly the same height
    if (f.finalReady && S === 'ground' || f.finalReady && S === 'air') {
      const ahead = (tgt.x - f.x) * f.face > 0, level = Math.abs((tgt.y - f.y)) < 110;
      if (ahead && level) { press('special'); return o; }
      if (!ahead) { o[key(-f.face)] = true; return o; }
    }
    // items: walk over and grab loose ones, use what we hold
    if ((S === 'ground' || S === 'air') && !f.item) {
      let near = null, nd = 1e9;
      for (const it of Game.items) {
        if (it.armed) continue;
        const d = Math.abs(it.x - f.x) + Math.abs(it.y - f.y) * 0.5;
        if (it.kind === 'moonball') { if (d < 300) { if (Math.abs(it.x - f.x) > 30) o[key(it.x > f.x ? 1 : -1)] = true; if (!f.air && Math.abs(it.x - f.x) < 120) press('jump'); else if (f.air && Math.abs(it.x - f.x) < 80 && Math.abs(it.y - (f.y - f.h)) < 90) { o.up = true; press('attack'); } return o; } continue; }
        if (it.y > M.top + 5 || it.x < M.x0 || it.x > M.x1) continue;
        if (d < nd) { nd = d; near = it; }
      }
      if (near && nd < 360 && Rng.next() < 0.6 + lvl * 0.04) {
        if (Math.abs(near.x - f.x) < f.w * 0.5) { press('attack'); return o; }
        o[key(near.x > f.x ? 1 : -1)] = true; return o;
      }
    }
    if (f.item && (S === 'ground' || S === 'air')) {
      const k = f.item.kind, adx0 = Math.abs(tgt.x - f.x), ady0 = Math.abs(tgt.y - f.y), toward = tgt.x > f.x ? 1 : -1;
      if (k === 'raygun' && ady0 < 70 && Rng.next() < 0.15) { if (f.face !== toward) { o[key(toward)] = true; return o; } press('attack'); return o; }
      if ((k === 'bomb' || k === 'grenade') && adx0 < 380 && Rng.next() < 0.06) { o[key(toward)] = true; press('attack'); return o; }
      if (ITEM_DEFS[k].set && Items2.ai(f, tgt, o, press)) return o;   // set-2 items (56_items2)
    }
    const dx = tgt.x - f.x, dy = (tgt.y - tgt.h / 2) - (f.y - f.h / 2), adx = Math.abs(dx), dir = dx > 0 ? 1 : -1;
    const tgtOff = tgt.x < M.x0 || tgt.x > M.x1 || tgt.y > M.top + 4;
    const react = Rng.next() < 0.05 + lvl * 0.055;

    // guard against incoming attacks
    const threat = tgt.state === 'move' && adx < 150 && Math.abs(dy) < 120;
    if (S === 'shield') {
      if (threat && Rng.next() < 0.9) o.shield = true;
      else if (adx < 80 && Rng.next() < 0.25) { o.shield = true; press('attack'); }
      return o;
    }
    if (threat && !f.air && S === 'ground' && Rng.next() < lvl * 0.014) {
      if (Rng.next() < 0.7) { a.holdK = ['shield']; a.holdT = irand(8, 20); o.shield = true; }
      else { o.shield = true; o[key(dir)] = true; }
      return o;
    }
    if (S !== 'ground' && S !== 'air') return o;

    const range = f.w * 0.5 + 44 * f.c.reach + tgt.w * 0.35;
    const edgeL = M.x0 + 40, edgeR = M.x1 - 40;
    if (Game.combos && GRAPPLE.ai(f, tgt, o, press)) return o;   // grapples when adjacent, more on shields (24_grapple)
    if (f.c.ai2 && MV2.aiPick(f, tgt, o, press, { dx, dy, adx, dir, range, tgtOff, M })) return o;   // roster-2 specials
    if (adx > range * 0.85 || (tgtOff && !f.air)) {
      let go = dir;
      if (tgtOff && ((go < 0 && f.x < edgeL) || (go > 0 && f.x > edgeR))) go = 0;
      if (go) o[key(go)] = true;
      if (!f.air && dy < -110 && adx < 260 && Rng.next() < 0.02 + lvl * 0.004) press('jump');
      if (!tgtOff && adx > 320 && Rng.next() < 0.012 + lvl * 0.002) { o.left = o.right = false; if (f.face !== dir) o[key(dir)] = true; else press('special'); }
      else if (!tgtOff && adx > 170 && adx < 300 && Math.abs(dy) < 50 && Rng.next() < 0.004 * lvl) { o[key(dir)] = true; press('special'); }
      if (f.air && f.vy > 0 && !off && dy > 60 && Rng.next() < 0.2) o.down = true;
      return o;
    }
    if (!react) { if (adx > 30) o[key(dir)] = Rng.next() < 0.5; return o; }

    if (f.air) {
      if (dy < -40) { o.up = true; press('attack'); }
      else if (dy > 45) { o.down = true; press('attack'); }
      else { o[key(dir)] = true; press('attack'); }
      return o;
    }
    const r = Rng.next();
    if (tgt.state === 'shield' && r < 0.6) { o.shield = true; press('attack'); return o; }
    if (dy < -70) {
      if (r < 0.5) { o.up = true; press('smash'); a.holdK = ['smash']; a.holdT = irand(0, 16); } else press('jump');
      return o;
    }
    const finish = tgt.dmg > 70 + Rng.next() * 60;
    if (finish && r < 0.5) {
      if (f.face !== dir) { o[key(dir)] = true; return o; }
      o[key(dir)] = true; press('smash'); a.holdK = ['smash', key(dir)]; a.holdT = irand(0, 20); return o;
    }
    if (r < 0.2) { o.down = true; press('attack'); return o; }
    if (r < 0.32) { press('jump'); return o; }
    if (r < 0.42) { o.down = true; press('special'); return o; }
    if (f.face !== dir) { o[key(dir)] = true; return o; }
    if (r < 0.7) press('attack'); else { o[key(dir)] = true; press('attack'); }
    return o;
  },
  target(f) {
    let best = null, bd = 1e9;
    for (const g of Game.fighters) {
      if (g === f || g.state === 'dead' || g.stocks <= 0) continue;
      const d = dhypot(g.x - f.x, g.y - f.y) + (g.state === 'respawn' ? 800 : 0);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  },
  recover(f, st, o, press) {
    const M = st.main, side = f.x < 0 ? -1 : 1, ledgeX = side < 0 ? M.x0 : M.x1;
    if (Game.holes.length && Items2.aiHole(f, st, o, press)) return o;                       // climbing out of a TNT crater
    if (f.item && ITEM_DEFS[f.item.kind].set && Items2.aiRecover(f, st, o, press)) return o;   // jetpack / grapple rope
    o[side > 0 ? 'left' : 'right'] = true;
    if (f.state !== 'air') return o;
    const distX = Math.abs(f.x - ledgeX);
    const low = f.y > M.top - 30;
    if (f.vy > -1 && (low || distX > 220)) {
      if (f.jumps > 0 && (f.y > M.top - 60 || distX > 260)) press('jump');
      else if (f.jumps === 0 && !f.airOnce.side && distX > 280 && f.y < M.top + 40) press('special');
      else if (f.jumps === 0 && !f.airOnce.up && (f.y > M.top + 30 || distX > 150)) { o.up = true; press('special'); }
    }
    return o;
  },
};
