'use strict';
// The store catalogue, read from the ONE place it is written: src/89_econ.js, between the
// CATALOG-START / CATALOG-END markers. Loading it rather than copying it means the client and the
// server can never disagree about what something costs or what a level unlocks — a drift there is
// how a player ends up owning something they did not pay for.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// In the repo the file sits at ../../src/89_econ.js. The container image only carries net/, so
// deploy.sh vendors a copy to net/econ-src/89_econ.js and that is the second place to look.
const SRC_PATHS = [path.join(__dirname, '..', '..', 'src', '89_econ.js'), path.join(__dirname, '..', 'econ-src', '89_econ.js')];
const SRC = SRC_PATHS.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || SRC_PATHS[0];

function read() {
  const src = fs.readFileSync(SRC, 'utf8');
  const m = src.match(/\/\* CATALOG-START \*\/([\s\S]*?)\/\* CATALOG-END \*\//);
  if (!m) throw new Error('catalog markers not found in src/89_econ.js');
  const ctx = { out: null };
  vm.createContext(ctx);
  vm.runInContext(m[1] + '\n;out = ECON_CATALOG;', ctx, { timeout: 2000, filename: '89_econ.js:catalog' });
  // The vm gives back objects from another realm, whose Array/Object prototypes are not this one's
  // (deepStrictEqual and instanceof both trip over that). It is pure data, so round-trip it.
  const cat = JSON.parse(JSON.stringify(ctx.out));
  if (!cat || !Array.isArray(cat.weapons) || !Array.isArray(cat.cosmetics)) throw new Error('catalog looks wrong');
  return cat;
}

const CAT = read();
const BY = new Map();
for (const w of CAT.weapons) BY.set(w.id, Object.assign({ type: 'weapon' }, w));
for (const c of CAT.cosmetics) BY.set(c.id, Object.assign({ type: 'cosmetic' }, c));
// weapon finishes: a cosmetic in every way that matters, but equipped per weapon rather than into
// one global slot, so it carries its own type and the server keeps its own map of them
for (const s of (CAT.skins || [])) BY.set(s.id, Object.assign({ type: 'skin' }, s));
// Locker gear is sellable as of 2026-10-16 (the appearance half of the shop). It carries its own
// type because buying one MINTS AN INSTANCE -- it is never an entitlement, so `grant()` must not
// see it and `owned()` must never list it.
for (const g of ((CAT.locker && CAT.locker.gear) || [])) BY.set(g.id, Object.assign({ type: 'gear' }, g));
for (const b of CAT.bundles) BY.set(b.id, Object.assign({ type: 'bundle' }, b));
// The vault: the two secret stages and the secret fighter. A plain entitlement with a price, so
// `buy()` and `grant()` need no special case at all -- but it HAS to be in here, because `buy()`
// refuses anything `BY` does not know and `grant()` skips it, so a paid unlock would take the money
// (once a provider exists) and hand back nothing.
for (const v of (CAT.vault || [])) BY.set(v.id, Object.assign({ type: 'vault' }, v));
for (const p of CAT.season.plates) BY.set(p.id, Object.assign({ type: 'cosmetic', slot: 'plate', price: null, season: true }, p));

const WEAPON_IDS = CAT.weapons.map(w => w.id);
const KIND_OF = {};
for (const w of CAT.weapons) KIND_OF[w.id] = w.kind;

// cumulative XP needed to REACH level n (level 1 = 0)
function xpForLevel(n) { let t = 0; for (let i = 1; i < n; i++) t += Math.round(CAT.xp.perLevel * Math.pow(i, CAT.xp.curve) / i); return t; }
function levelFor(xp) { let n = 1; while (n < 99 && xp >= xpForLevel(n + 1)) n++; return n; }
// everything a level hands out for free, so an account's real entitlement list = bought + earned
function levelGrants(level) { return CAT.weapons.filter(w => w.unlock != null && w.unlock <= level).map(w => w.id); }

// what a finished match is worth, computed from the SERVER's own copy of the fight
function matchXp(stat, won) {
  const X = CAT.xp;
  const kos = (stat && stat.kos) || 0, dealt = (stat && stat.dealt) || 0;
  return Math.round(X.match + (won ? X.win : 0) + kos * X.ko + dealt * X.damage);
}

module.exports = { CAT, BY, WEAPON_IDS, KIND_OF, xpForLevel, levelFor, levelGrants, matchXp, reload: read };
