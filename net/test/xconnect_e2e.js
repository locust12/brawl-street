// X connect, end to end through the real server: the typed-handle hole is shut, and the connect
// exchange actually binds a handle.  node test/xconnect_e2e.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Bot } = require('./bot');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const problems = [];
const ok = (c, what) => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${what}`); if (!c) problems.push(what); };

(async () => {
  const port = 21000 + crypto.randomInt(20000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-x-'));
  // A stub X: every profile's bio is whatever the test last wrote into this file. That keeps the
  // run offline and lets me drive "the code is not in the bio yet" -> "now it is".
  const bioFile = path.join(dataDir, 'bio.txt');
  fs.writeFileSync(bioFile, 'nothing here yet');
  const stub = path.join(dataDir, 'xstub.js');
  fs.writeFileSync(stub, `
    const fs = require('fs');
    const { XVerify } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'xverify.js'))});
    const orig = XVerify.prototype.constructor;
    module.exports = {};
    // patch the default fetch by handing every new XVerify a stub profile source
    const realInit = XVerify.prototype.claim;
    XVerify.prototype.claim = function (...a) { if (!this._stubbed) { this._stubbed = 1; this.fetchProfile = async h =>
      h.toLowerCase() === 'ghosthandle' ? null
      : ({ id: '555' + h.length, screen_name: h, name: h, description: fs.readFileSync(${JSON.stringify(bioFile)}, 'utf8'), avatar_url: 'http://a/' + h });
    } return realInit.apply(this, a); };
  `);
  procs.push(spawn(process.execPath, ['-r', stub, path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, START_DELAY_MS: '400',
      QUIET: process.env.VERBOSE ? '0' : '1', SAME_IP_OK: '1', NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000' }),
    stdio: ['ignore', 'inherit', 'inherit'] }));
  const base = `http://127.0.0.1:${port}`, url = `ws://127.0.0.1:${port}/ws`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) {} await sleep(150); }

  const seen = new Map();
  async function join(name) {
    const b = new Bot(name, url); await b.connect();
    const log = []; seen.set(b, log);
    b.ws.on('message', d => { try { log.push(JSON.parse(d.toString())); } catch (e) {} });
    b.welcome = await b.until(m => m.k === 'welcome', 10000, 'welcome');
    return b;
  }
  const last = (b, k) => (seen.get(b) || []).filter(m => m.k === k).pop();
  const had = (b, f) => (seen.get(b) || []).some(f);

  console.log('\nTHE HOLE: a handle can no longer be typed into the saved fighter');
  const A = await join('Alice');
  A.raw({ k: 'look', look: { v: 1, base: A.welcome.chars[0], name: 'Alice', x: 'elonmusk' } });
  await sleep(500);
  A.raw({ k: 'look', look: { v: 1, base: A.welcome.chars[0], name: 'Alice', x: 'elonmusk' } });
  await sleep(400);
  const me = last(A, 'me') || last(A, 'welcome');
  const lookX = me && me.profile && me.profile.look && me.profile.look.x;
  ok(!lookX, 'a look claiming x:"elonmusk" is stored WITHOUT the handle');
  ok(!(me && me.profile && me.profile.x), 'and the account has no verified handle either');

  console.log('\nconnecting: the code has to reach the bio first');
  A.raw({ k: 'xclaim', handle: 'alice_plays' });
  const st1 = await A.until(m => m.k === 'xstate', 8000, 'xstate').catch(() => null);
  ok(!!(st1 && st1.pending && st1.pending.code), 'claiming gives a code: ' + (st1 && st1.pending && st1.pending.code));
  ok(st1 && st1.pending.handle === 'alice_plays', 'bound to the handle that was asked for');

  A.raw({ k: 'xverify' });
  await sleep(1200);
  ok(had(A, m => m.k === 'err' && m.code === 'x'), 'verifying with an empty bio is refused');
  ok(!last(A, 'xstate').x, 'and nothing is connected');

  console.log('\nTHE POINT: it connects on its own, with no further clicking');
  fs.writeFileSync(bioFile, 'gamer. ' + st1.pending.code + ' . she/her');
  // deliberately send NOTHING from here. The server is polling on the player's behalf.
  const st2 = await A.until(m => m.k === 'xstate' && m.x, 20000, 'connected').catch(() => null);
  ok(!!st2, 'connected without the player pressing anything');
  ok(st2 && st2.x === 'alice_plays', 'the verified handle is on the account');
  ok(st2 && !st2.pending, 'and the claim is cleared');

  console.log('\nit shows up where players see it');
  A.raw({ k: 'create', size: 2, stake: 0, stocks: 3, items: true, stage: 'random' });
  const room = await A.until(m => m.k === 'room', 8000, 'room');
  const mine = room.members.find(x => x.id === room.you);
  ok(mine && mine.x === 'alice_plays', 'the lobby card carries the handle');

  console.log('\none X account cannot be worn by two players');
  const B = await join('Bob');
  B.raw({ k: 'xclaim', handle: 'alice_plays' });
  await sleep(1200);
  ok(had(B, m => m.k === 'err' && m.code === 'x' && /already connected/i.test(m.msg || '')),
     'the second player is told at once, before being sent off to edit a bio');
  ok(!(last(B, 'xstate') || {}).x, 'and gets nothing');
  // and the authoritative check still holds even if they get past the early one
  B.raw({ k: 'xclaim', handle: 'bob_plays' });
  await B.until(m => m.k === 'xstate', 8000, 'xstate b2');
  ok(true, 'a different handle is allowed through to the bio step');

  console.log('\ndisconnecting works');
  A.raw({ k: 'xforget' });
  const st3 = await A.until(m => m.k === 'xstate' && !m.x, 8000, 'forgotten').catch(() => null);
  ok(!!st3 && !st3.x, 'the handle is released');

  console.log(problems.length ? `\n${problems.length} FAILED:\n  ` + problems.join('\n  ') : '\nall checks passed');
  for (const p of procs) { try { p.kill(); } catch (e) {} }
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); for (const p of procs) { try { p.kill(); } catch (e2) {} } process.exit(1); });
