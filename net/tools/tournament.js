#!/usr/bin/env node
'use strict';
// tools/tournament.js -- the operator's end of the bracket, which server.js has had a comment
// promising since the capacity work. The bracket itself runs inside the server (lib/tourney.js) and
// needs nobody watching it: entries close, the draw happens, no-shows forfeit and rounds advance on
// the server's own clock. This tool is for the four things a human does around that.
//
//   announce   write the event: name, cap, the three timestamps, the prize line
//   board      print the live bracket, the field and the standings
//   draw       close entries and draw NOW, rather than waiting for startsAt
//   force      hand a disputed match to one player, with a reason players can read
//   watch      stream the board as it changes (what to leave open on the night)
//
// It talks over the game server's own websocket and presents TOURNEY_KEY as `opkey` in `hello`,
// which is the operator socket the server now honours. Reading the board needs no key at all:
// /api/tourney is public, because it carries exactly what the in-game screen shows any player.
//
// Examples
//   TOURNEY_KEY=... node tools/tournament.js announce --name "Brawl Street Open #1" \
//       --cap 64 --opens "2026-10-18T12:00Z" --closes "2026-10-25T12:30Z" --starts "2026-10-25T13:00Z" \
//       --prize "Unusual locker item + CHAMPION title plate"
//   node tools/tournament.js board --url https://eu.brawlstreet.lol
//   TOURNEY_KEY=... node tools/tournament.js force --pid r3m2 --acct 9f3c1a2b4d5e --why "opponent lagged out twice"
const crypto = require('crypto');

const ARGV = process.argv.slice(2);
const CMD = ARGV[0] || 'board';
function arg(name, dflt) { const i = ARGV.indexOf('--' + name); return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : dflt; }
function flag(name) { return ARGV.includes('--' + name); }
const URL_BASE = (arg('url', process.env.TOURNEY_URL || 'http://127.0.0.1:8787')).replace(/\/$/, '');
const KEY = arg('key', process.env.TOURNEY_KEY || '');
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/ws';

const die = m => { console.error(m); process.exit(1); };
// Timestamps are given as anything Date.parse takes, and printed back in UTC so there is never a
// doubt about which 13:00 was meant.
function when(s, what) {
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) die('Could not read --' + what + ' "' + s + '". Use something like 2026-10-25T13:00Z.');
  return t;
}
const utc = t => !t ? '-' : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const mins = ms => ms <= 0 ? 'now' : ms < 90e3 ? Math.round(ms / 1e3) + 's' : ms < 5400e3 ? Math.round(ms / 60e3) + 'm' : (ms / 3600e3).toFixed(1) + 'h';
const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);

// ---------------------------------------------------------------- reading the board (no key)
async function getBoard() {
  const res = await fetch(URL_BASE + '/api/tourney');
  if (!res.ok) die('GET /api/tourney answered ' + res.status + '. Is ' + URL_BASE + ' the game server?');
  return res.json();
}
function printBoard(s) {
  if (!s || !s.on) return console.log('No tournament announced on ' + URL_BASE + '.');
  const e = s.ev;
  console.log('\n' + e.name + '   [' + s.phase + ']   ' + e.id);
  console.log('  field      ' + s.seats + '/' + e.cap + (s.wait ? '  (+' + s.wait + ' waiting)' : ''));
  console.log('  opens      ' + utc(e.opensAt));
  console.log('  closes     ' + utc(e.closesAt) + (s.phase === 'open' ? '   in ' + mins(e.closesAt - s.now) : ''));
  console.log('  starts     ' + utc(e.startsAt) + (!s.bracket ? '   in ' + mins(e.startsAt - s.now) : ''));
  console.log('  stages     ' + (e.stages || []).join(' ') + '   ' + e.stocks + ' stocks');
  if (e.prize) console.log('  prize      ' + e.prize);
  if (s.champion) console.log('\n  CHAMPION   ' + s.champion.name + '  (seed ' + s.champion.seed + ')');
  if (s.bracket) {
    for (const r of s.bracket.rounds) {
      const done = r.pairs.filter(p => p.winner).length;
      console.log('\n  ' + r.name + '   best of ' + r.bestOf + '   ' + done + '/' + r.pairs.length + ' decided'
        + (r.endsBy && r.endsBy > s.now ? '   round ends in ' + mins(r.endsBy - s.now) : ''));
      for (const p of r.pairs) {
        const nm = x => x ? pad((x.seed ? '(' + x.seed + ') ' : '') + x.name, 22) : pad('bye', 22);
        const mark = w => (p.winner === w ? '*' : ' ');
        const tail = p.winner ? '  ' + (p.how || '') : p.live ? '  LIVE' : p.deadline ? '  check in by ' + utc(p.deadline).slice(11) : '';
        console.log('    ' + pad(p.pid, 7) + mark('a') + nm(p.a) + ' ' + p.wa + ' - ' + p.wb + ' ' + mark('b') + nm(p.b) + tail);
      }
    }
  } else if (s.entrants && s.entrants.length) {
    console.log('\n  Entered (' + s.entrants.length + '):');
    for (const x of s.entrants) console.log('    ' + pad(x.status === 'wait' ? 'wait' : 'in', 5) + pad(x.name, 22) + (x.elo ? 'elo ' + x.elo : 'unrated'));
  }
  if (s.standings && s.standings.length) {
    console.log('\n  Final standings');
    for (const x of s.standings.slice(0, 16)) console.log('    ' + pad(x.place, 5) + pad(x.name, 22) + x.w + 'W ' + x.l + 'L' + (x.out ? '   out: ' + x.out : ''));
  }
  console.log('');
}

// ---------------------------------------------------------------- the operator socket (needs the key)
// One admin message per run, then the socket closes. `hello` wants a device token like any other
// client, so the tool mints a throwaway one: the operator socket is authorised by the KEY, and its
// account is never used for anything.
function admin(msg) {
  if (!KEY) die('This needs the tournament key. Set TOURNEY_KEY, or pass --key.');
  let WS;
  try { WS = require('ws'); } catch (e) { die('This tool needs the server\'s own dependencies. Run it from net/ after npm install.'); }
  return new Promise((resolve, reject) => {
    const ws = new WS(WS_URL, { origin: URL_BASE });
    const t = setTimeout(() => { ws.close(); reject(new Error('The game server did not answer in 15 s.')); }, 15000);
    ws.on('open', () => ws.send(JSON.stringify({ k: 'hello', v: 1, token: crypto.randomBytes(24).toString('hex'), name: 'operator', opkey: KEY })));
    ws.on('message', buf => {
      let m; try { m = JSON.parse(buf); } catch (e) { return; }
      if (m.k === 'welcome') return void ws.send(JSON.stringify(msg));
      if (m.k === 'tadmin') { clearTimeout(t); ws.close(); return resolve(m); }
      if (m.k === 'err') { clearTimeout(t); ws.close(); return reject(new Error(m.msg || 'refused')); }
    });
    ws.on('close', (code) => { clearTimeout(t); if (code === 4005) reject(new Error('The server refused the tournament key.')); });
    ws.on('error', e => { clearTimeout(t); reject(e); });
  });
}

// ---------------------------------------------------------------- commands
async function main() {
  if (CMD === 'board') return printBoard(await getBoard());

  if (CMD === 'watch') {
    let last = '';
    for (;;) {
      const s = await getBoard().catch(e => ({ err: e.message }));
      const sig = JSON.stringify(s && s.bracket ? s.bracket : s);
      if (sig !== last) { last = sig; console.clear(); printBoard(s); }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (CMD === 'announce') {
    const ev = {
      id: arg('id', 'bs-open-1'),
      name: arg('name', 'Brawl Street Open #1'),
      cap: +arg('cap', 64),
      waitlist: +arg('waitlist', 32),
      opensAt: when(arg('opens'), 'opens') || Date.now(),
      closesAt: when(arg('closes'), 'closes'),
      startsAt: when(arg('starts'), 'starts'),
      checkInMs: +arg('checkin', 8) * 60e3,
      roundMs: +arg('round', 25) * 60e3,
      prize: arg('prize', ''),
      note: arg('note', ''),
      stocks: +arg('stocks', 3),
    };
    if (arg('stages')) ev.stages = arg('stages').split(',').map(s => s.trim()).filter(Boolean);
    if (!ev.closesAt || !ev.startsAt) die('announce needs --closes and --starts (and usually --opens).');
    console.log('Announcing on ' + URL_BASE + ':');
    console.log('  ' + ev.name + '   cap ' + ev.cap + ' (+' + ev.waitlist + ' waiting)');
    console.log('  entries ' + utc(ev.opensAt) + '  to  ' + utc(ev.closesAt));
    console.log('  draw    ' + utc(ev.startsAt));
    if (!flag('yes')) { console.log('\n  (nothing is written without --yes)'); return; }
    const r = await admin({ k: 'tannounce', ev });
    if (!r.ok) die('Refused: ' + r.msg);
    console.log('\nAnnounced. The screen in the game shows it now.');
    return printBoard(await getBoard());
  }

  if (CMD === 'draw') {
    if (!flag('yes')) die('This closes entries and draws the bracket immediately. Add --yes.');
    const r = await admin({ k: 'tdraw' });
    if (!r.ok) die('Refused: ' + r.msg);
    console.log('Drawn: ' + r.field + ' entrants into a ' + r.size + ' bracket.');
    return printBoard(await getBoard());
  }

  if (CMD === 'force') {
    const pid = arg('pid'), acct = arg('acct'), why = arg('why', 'decided by hand');
    if (!pid || !acct) die('force needs --pid (as the board prints it, e.g. r3m2) and --acct (the winner\'s account id).');
    const r = await admin({ k: 'tforce', pid, acct, why });
    if (!r.ok) die('Refused: ' + r.msg);
    console.log('Done. The bracket now reads "operator: ' + why + '".');
    return printBoard(await getBoard());
  }

  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
}

main().catch(e => die(String(e && e.message || e)));
