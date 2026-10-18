// 100 ROOM CREATE-AND-JOIN CYCLES against the LIVE servers, over every combination of the two real
// regions players land on: host in Europe or Singapore, guest arriving from either. Protocol-level
// clients (the same messages the page sends), because 100 browser pairs would take hours.
//
// Honest about one thing: these all leave from one machine, so the IPs are not 100 different
// countries. What varies, and what actually breaks rooms, is WHICH BOX holds the room versus which
// box the guest asks -- that is the bug that lost every invite, and it is covered in both directions.
//
// Accounts are reused from a small fixed set of tokens: minting 200 new accounts would hit the live
// server's per-IP new-account limit and the failures would be the limiter, not the rooms.
import { WebSocket } from 'ws';

const REGIONS = {
  eu: 'wss://brawlstreet.167-233-230-149.sslip.io/ws',
  sg: 'wss://brawlstreet.5-223-91-79.sslip.io/ws',
};
const HTTP = {
  eu: 'https://brawlstreet.167-233-230-149.sslip.io',
  sg: 'https://brawlstreet.5-223-91-79.sslip.io',
};
const N = +(process.argv[2] || 100);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

// one stable token per role per region slot, so accounts are reused instead of minted
// A POOL, NOT A PAIR. With two host tokens and two guest tokens, a cycle that started a match was
// still holding that account when the cycle two later reused the same token -- and a second socket on
// one account KICKS the first, which forfeits the live match and leaves the new client in a state the
// join could not complete from. That looked like a server failure (20 of 100) and was the harness.
// Six of each, released properly, means a token is idle for six cycles before it comes round again.
const HOSTS = Array.from({ length: 6 }, () => hex(64));
const GUESTS = Array.from({ length: 6 }, () => hex(64));

async function digestOf(region) {
  const r = await fetch(HTTP[region] + '/healthz');
  return (await r.json()).engine;
}

function client(region, token, build, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(REGIONS[region], { headers: { Origin: 'https://brawlstreet-desk-4k9m2x.vercel.app' } });
    const api = { ws, region, label, msgs: [], room: null, me: null, errs: [] };
    const waiters = [];
    api.wait = (pred, ms = 15000) => new Promise((res, rej) => {
      const hit = api.msgs.find(pred);
      if (hit) return res(hit);
      const w = { pred, res, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(label + ' timeout')); }, ms) };
      waiters.push(w);
    });
    api.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => { api.send({ k: 'hello', v: 1, token, name: label, build }); });
    ws.on('message', d => {
      let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      if (m.k === 'welcome') api.me = m;
      if (m.k === 'room') api.room = m;
      if (m.k === 'err') api.errs.push((m.code || '') + ':' + (m.msg || ''));
      api.msgs.push(m);
      for (const w of waiters.slice()) if (w.pred(m)) { clearTimeout(w.t); waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    });
    ws.on('error', e => reject(e));
    ws.on('close', () => { api.closed = true; });
    api.wait(m => m.k === 'welcome', 20000).then(() => resolve(api)).catch(reject);
  });
}

const results = [];
const combos = [['eu', 'eu'], ['eu', 'sg'], ['sg', 'sg'], ['sg', 'eu']];
const builds = { eu: await digestOf('eu'), sg: await digestOf('sg') };
console.log('engines:', JSON.stringify(builds));

for (let i = 0; i < N; i++) {
  const [hostR, guestR] = combos[i % combos.length];
  const t0 = Date.now();
  let host = null, guest = null;
  const row = { i: i + 1, host: hostR, guest: guestR, ok: false, why: '', ms: 0 };
  try {
    host = await client(hostR, HOSTS[i % HOSTS.length], builds[hostR], 'host' + i);
    if (!host.me.build || !host.me.build.ok) throw new Error('host build rejected by ' + hostR);
    host.send({ k: 'create', size: 2, stake: 0, cpuFill: true, stocks: 3, items: true, stage: 'random' });
    const rm = await host.wait(m => m.k === 'room' && m.code, 15000);
    row.code = rm.code;
    row.roomRegion = rm.region && rm.region.id;

    // the guest arrives on ITS OWN region first, exactly like a browser that has played before,
    // then goes where the invite says
    guest = await client(guestR, GUESTS[i % GUESTS.length], builds[guestR], 'guest' + i);
    const target = row.roomRegion || hostR;
    if (target !== guestR) {
      // the invite names the region: the page reconnects there before asking for the code
      guest.ws.close();
      await sleep(120);
      guest = await client(target, GUESTS[i % GUESTS.length], builds[target], 'guest' + i);
      row.moved = guestR + '->' + target;
    }
    guest.send({ k: 'join', code: rm.code });
    const jr = await guest.wait(m => m.k === 'room' && m.code === rm.code, 15000);
    // MEASURE THE DELAY THE SERVER ACTUALLY ASSIGNS. The start message carries `delay` per seat, which
    // is the whole feel of the fight: at 60 Hz every frame of it is 16.7 ms of input lag. Reading it
    // here needs no browser and no fight, so it is the one number that can be sampled 100 times.
    if (process.env.MEASURE_DELAY === '1') {
      // A BROWSER THAT HITCHES. The page reports its own ping and jitter, and those are what the old
      // formula leaned on: `max(transport, appRtt) + 2 x appJit`, uncapped. FAKE_JIT lets the test
      // say "I am a browser with this much frame jitter" and read back the delay the server assigns,
      // which is the exact A/B for the fix. Real numbers, same inputs, one fixed box and one not.
      if (process.env.FAKE_JIT) {
        const jit = +process.env.FAKE_JIT, rtt = +(process.env.FAKE_RTT || 45);
        for (const c of [host, guest]) c.send({ k: 'ping', t: Date.now(), e: Date.now(), rtt, jit });
        await sleep(600);
      }
      host.send({ k: 'ready', on: true });
      guest.send({ k: 'ready', on: true });
      const st = await guest.wait(m => m.k === 'start' && m.delay != null, 25000).catch(() => null);
      if (st) { row.delay = st.delay; row.startRtt = Math.round(guest.me && guest.me.now ? 0 : 0); }
      else row.why += ' no start message';
    }
    const seats = (jr.members || []).length;
    const hostView = await host.wait(m => m.k === 'room' && (m.members || []).length === 2, 15000).catch(() => null);
    row.seats = seats;
    row.ok = seats === 2 && !!hostView;
    if (!row.ok) row.why = 'guest saw ' + seats + ' seats, host saw ' + (hostView ? 2 : 'not 2');
    if (guest.errs.length) row.why += ' guestErr=' + guest.errs.join('|').slice(0, 80);
    if (host.errs.length) row.why += ' hostErr=' + host.errs.join('|').slice(0, 80);
  } catch (e) {
    row.why = String(e.message || e).slice(0, 120);
  } finally {
    // leave the match and the room before dropping the socket, so the account is free for its next
    // turn instead of being kicked out of a fight that is still running
    try { host && host.send({ k: 'leave' }); } catch (e) {}
    try { guest && guest.send({ k: 'leave' }); } catch (e) {}
    await sleep(150);
    row.ms = Date.now() - t0;
    try { host && host.ws.close(); } catch (e) {}
    try { guest && guest.ws.close(); } catch (e) {}
  }
  results.push(row);
  if (row.delay != null) console.log(`  ${row.host}->${row.guest} delay ${row.delay} frames (${Math.round(row.delay * 16.7)} ms)`);
  if (!row.ok) console.log('FAIL', JSON.stringify(row));
  else if ((i + 1) % 10 === 0) console.log(`${i + 1}/${N} ok (last ${row.host}->${row.guest} ${row.ms}ms)`);
  await sleep(250);
}

const pass = results.filter(r => r.ok).length;
const byCombo = {};
for (const r of results) {
  const k = r.host + '->' + r.guest;
  byCombo[k] = byCombo[k] || { n: 0, ok: 0, ms: [] };
  byCombo[k].n++; if (r.ok) byCombo[k].ok++; byCombo[k].ms.push(r.ms);
}
for (const k of Object.keys(byCombo)) {
  const b = byCombo[k]; b.ms.sort((x, y) => x - y);
  b.medianMs = b.ms[Math.floor(b.ms.length / 2)]; delete b.ms;
}
const ds = results.filter(r => r.delay != null).map(r => r.delay).sort((a, b) => a - b);
if (ds.length) console.log('delay frames: p50', ds[Math.floor(ds.length / 2)], 'worst', ds[ds.length - 1], 'n', ds.length);
console.log(JSON.stringify({ total: results.length, pass, fail: results.length - pass, byCombo,
  failures: results.filter(r => !r.ok).slice(0, 10) }, null, 1));
process.exit(pass === results.length ? 0 : 1);
