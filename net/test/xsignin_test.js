// "Sign in with X" end to end through the real server: the popup's signed token is the only thing
// that binds a handle, a forged one binds nothing, and a second device holding the same X account
// signs IN to it rather than starting over.   node test/xsignin_test.js
//
// The OAuth half (the popup, X's own authorise screen, the code exchange) lives on the verify
// origin and is not in this process. What arrives here is the one thing this server has to judge:
// `{k:'x_claim', h, id, tok}` where tok is an HMAC over the handle, signed with X_LINK_SECRET. So
// that is what this test drives, including the forgeries.
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

const SECRET = 'test-link-secret-' + crypto.randomBytes(8).toString('hex');
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// the same two lines as net/api/x/callback.js on the verify origin
function sign(h, id, exp) {
  const payload = b64url(Buffer.from(JSON.stringify({ h, id, iat: Date.now(), exp: exp || Date.now() + 10 * 60e3 })));
  return payload + '.' + b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
}

(async () => {
  const port = 21000 + crypto.randomInt(20000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-xsi-'));
  // The avatar fill-in is best effort and goes to a public mirror; stub it so the run stays offline.
  const stub = path.join(dataDir, 'xstub.js');
  fs.writeFileSync(stub, `
    const { XVerify } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'xverify.js'))});
    const real = XVerify.prototype.claim;
    XVerify.prototype.claim = function (...a) { return real.apply(this, a); };
    const C = XVerify;
    const origFetch = C.prototype.constructor;
    // every instance gets a stub profile source
    Object.defineProperty(C.prototype, 'fetchProfile', {
      configurable: true, writable: true,
      value: async h => ({ id: '777' + h.length, screen_name: h, name: h, description: '', avatar_url: 'http://a/' + h }),
    });
  `);
  procs.push(spawn(process.execPath, ['-r', stub, path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, START_DELAY_MS: '400',
      QUIET: process.env.VERBOSE ? '0' : '1', SAME_IP_OK: '1', NEW_ACCT_PER_IP: '100000', NEW_ACCT_GLOBAL: '1000000',
      X_LINK_SECRET: SECRET,
    }),
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
  const clear = b => { const l = seen.get(b); if (l) l.length = 0; };

  console.log('\na claim nobody signed binds nothing');
  const A = await join('Ava');
  A.raw({ k: 'x_claim', h: 'ava_plays', id: '42', code: 'BS-AAA', tok: '' });
  await sleep(600);
  ok(had(A, m => m.k === 'err' && m.code === 'x'), 'an unsigned "I am @ava_plays" is refused');
  ok(!(last(A, 'xstate') || {}).x, 'and no handle is on the account');

  console.log('\nnor a forged one');
  clear(A);
  const good = sign('ava_plays', '900001');
  const forged = good.split('.')[0] + '.' + b64url(crypto.createHmac('sha256', 'not-the-secret').update(good.split('.')[0]).digest());
  A.raw({ k: 'x_claim', h: 'ava_plays', id: '900001', tok: forged });
  await sleep(600);
  ok(had(A, m => m.k === 'err' && m.code === 'x'), 'a token signed with the wrong secret is refused');
  ok(!(last(A, 'xstate') || {}).x, 'still nothing connected');

  console.log('\nnor one that has expired');
  clear(A);
  A.raw({ k: 'x_claim', h: 'ava_plays', id: '900001', tok: sign('ava_plays', '900001', Date.now() - 1000) });
  await sleep(600);
  ok(had(A, m => m.k === 'err' && m.code === 'x'), 'an expired token is refused');

  console.log('\nTHE POINT: the real thing connects in one press');
  clear(A);
  A.raw({ k: 'x_claim', h: 'ava_plays', id: '900001', tok: good });
  const st = await A.until(m => m.k === 'xstate' && m.x, 8000, 'connected').catch(() => null);
  ok(!!st, 'the signed token connects with no code and no bio');
  ok(st && st.x === 'ava_plays', 'the verified handle is on the account');
  await sleep(300);   // x_linked rides immediately behind xstate; let the socket drain
  ok(had(A, m => m.k === 'x_linked' && m.h === 'ava_plays'), 'and the title-screen plate is told');

  console.log('\nTHE NAME: you play as your X handle');
  const meA = last(A, 'me');
  ok(meA && meA.name === 'ava_plays', 'the account name became the handle');
  A.raw({ k: 'name', name: 'xXSniperXx' });
  await sleep(500);
  ok(had(A, m => m.k === 'err' && m.code === 'name'), 'a typed name is refused while X is connected');
  ok((last(A, 'me') || {}).name === 'ava_plays', 'and the handle is still the name');

  console.log('\nit shows up where players see it');
  A.raw({ k: 'create', size: 2, stake: 0, stocks: 3, items: true, stage: 'random' });
  const room = await A.until(m => m.k === 'room', 8000, 'room');
  const mine = room.members.find(x => x.id === room.you);
  ok(mine && mine.x === 'ava_plays', 'the lobby card carries the handle');
  ok(mine && mine.name === 'ava_plays', 'and the player is named by it');
  A.raw({ k: 'leave' });
  await sleep(400);

  console.log('\nTHE OTHER POINT: a second device signs IN, it does not start again');
  const B = await join('Ava on her phone');
  B.raw({ k: 'x_claim', h: 'ava_plays', id: '900001', tok: sign('ava_plays', '900001') });
  const rec = await B.until(m => m.k === 'me' && m.recovered, 8000, 'signed in').catch(() => null);
  ok(!!rec, 'the second device is handed the account that holds the X id');
  const stB = await B.until(m => m.k === 'xstate' && m.x, 6000, 'xstate').catch(() => null);
  ok(stB && stB.x === 'ava_plays', 'and it reads as connected there too');
  ok(had(B, m => m.k === 'econ' || m.k === 'econstate'), 'the entitlements are pushed to the new device');

  console.log('\ndisconnecting still works');
  clear(A);
  B.raw({ k: 'x_unlink' });
  const off = await B.until(m => m.k === 'xstate' && !m.x, 6000, 'unlinked').catch(() => null);
  ok(!!off, 'x_unlink releases the handle');

  console.log(problems.length ? `\n${problems.length} FAILED:\n  ` + problems.join('\n  ') : '\nall good');
  for (const p of procs) { try { p.kill(); } catch (e) {} }
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); for (const p of procs) { try { p.kill(); } catch (e2) {} } process.exit(1); });
