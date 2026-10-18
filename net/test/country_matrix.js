// Can someone in <country> actually play, and how bad does it feel?
//
// The thing a player's location changes is their link: round trip, jitter, and packet loss. So each
// profile here is a real socket to a real server with that link imposed on it in both directions,
// and the fight runs to a finish over it. What comes back is the number that decides playability --
// the input delay the server hands the room, how long the fight spent frozen waiting for a frame
// that had not arrived, and whether it finished at all.
//
// Lockstep is unforgiving about this in a specific way: game time only advances once EVERY player's
// input for a tick is in, so a room is as slow as its worst connection, and the server's input delay
// is capped at MAX_DELAY frames (15 = 250 ms). Past that cap the fight cannot pre-roll far enough
// ahead and starts stalling instead, which is what a player calls lag.
//
//   node test/country_matrix.js                           # every profile against the local server
//   node test/country_matrix.js --region eu               # against the real Germany box
//   node test/country_matrix.js --region sg --only "Thailand,Japan,Brazil"
//   node test/country_matrix.js --pairs same              # both players in the same country
//   node test/country_matrix.js --secs 45                 # longer fights
//
// The RTTs are modelled, not measured from inside each country: they are typical consumer round
// trips to Frankfurt and to Singapore. Three rows are anchored to real measurements from this desk
// (Thailand -> Germany 238 ms, Thailand -> Singapore 113 ms). What the test proves is the behaviour
// of the netcode at a given link quality; it does not prove any one country's routing.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const engine = require('../lib/engine');
const { LightBot, driveAll } = require('./light_bot');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes('--' + k);

const REGION = arg('region', 'local');
const SECS = +arg('secs', 30);
const SIZE = +arg('size', 2);
const PAIRS = arg('pairs', 'mixed');     // mixed = country vs a clean local host; same = both sides in-country
const ONLY = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = arg('out', null);

const REGIONS = {
  local: 'ws://127.0.0.1:8790/ws',
  eu: 'wss://brawlstreet.167-233-230-149.sslip.io/ws',
  sg: 'wss://brawlstreet.5-223-91-79.sslip.io/ws',
};
const URL = arg('url', REGIONS[REGION] || REGIONS.local);
// Which column of the table to impose. Defaults to the region being played on, but can be set
// independently so the whole matrix runs against the local server at real-world link quality.
const MODEL = arg('model', REGION === 'local' ? 'eu' : REGION);

// rtt to Frankfurt, rtt to Singapore, jitter, loss %   (jitter/loss are the consumer-line defaults)
const C = (name, eu, sg, jit = 8, loss = 0) => ({ name, eu, sg, jit, loss });
// `loss` in the table is the chance a frame needs retransmitting, which on TCP costs a round trip
// for it and everything behind it -- not a frame the server never sees. --dropped turns it into the
// harsher, rarer failure instead: a client that never sent at all, which tests the resend path.
const DROPPED = has('dropped');
const PROFILES = [
  C('Germany', 18, 170, 4),
  C('Netherlands', 22, 175, 4),
  C('UK', 28, 180, 6),
  C('Spain', 40, 195, 8),
  C('Poland', 35, 200, 8),
  C('Turkey', 60, 160, 14),
  C('Russia (Moscow)', 50, 190, 12),
  C('UAE', 120, 100, 12),
  C('India (Mumbai)', 130, 65, 18),
  C('Nigeria (Lagos)', 145, 245, 30, 0.5),
  C('South Africa', 165, 235, 20, 0.3),
  C('Brazil', 205, 335, 18, 0.3),
  C('Argentina', 225, 345, 22, 0.3),
  C('US East', 90, 240, 8),
  C('US Central', 115, 220, 10),
  C('US West', 148, 178, 10),
  C('Canada East', 100, 250, 8),
  C('Mexico', 150, 240, 16),
  C('Japan', 230, 80, 8),
  C('Korea', 240, 85, 8),
  C('China (Shanghai)', 240, 75, 45, 1.0),
  C('Singapore', 168, 6, 4),
  C('Thailand', 238, 113, 14),            // measured from this desk, 16 Oct 2026
  C('Indonesia', 190, 35, 18),
  C('Philippines', 235, 50, 22),
  C('Vietnam', 245, 50, 20),
  C('Australia', 258, 100, 10),
  C('New Zealand', 278, 120, 10),
  // link quality, not geography: the same country on a worse line
  C('US East, 4G', 110, 260, 55, 0.8),
  C('India, 4G', 150, 85, 70, 1.2),
  C('Brazil, 4G', 225, 355, 80, 1.5),
  C('Thailand, bad wifi', 250, 125, 110, 2.5),
  C('Nigeria, mobile', 170, 270, 140, 3.0),
];

const info = engine.load();
const BUILD = info.digest;
const CHARS = info.chars.filter(c => c !== 'omen');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

// one-way delay is half the round trip; the server sees the sum of both legs
const legs = p => {
  const rtt = MODEL === 'sg' ? p.sg : p.eu;
  return { lat: Math.round(rtt / 2), jit: Math.round(p.jit / 2), loss: (p.loss || 0) / 100 };
};

async function run(p) {
  const link = legs(p);
  const bots = [];
  for (let i = 0; i < SIZE; i++) {
    // mixed: one seat is in-country and the rest are on a clean line, which is the common case and
    // the one that shows whether one bad connection drags a whole room down.
    const mine = PAIRS === 'same' || i === 0;
    bots.push(new LightBot('C' + i + '-' + crypto.randomBytes(2).toString('hex'), URL, {
      token: crypto.randomBytes(32).toString('hex'), build: BUILD, seed: (i + 1) * 2654435761,
      // Latency is applied AFTER the baseline is measured, not here: measuring the real link through
      // the injected one double-counts it, which made a 35 ms desk look like a 321 ms one and then
      // clamped the injection to zero. jitter and retransmission are harmless to set up front.
      lat: 0, jit: mine ? link.jit : 0,
      loss: mine && DROPPED ? link.loss : 0, spike: mine && !DROPPED ? link.loss : 0,
    }));
    bots[bots.length - 1].wantLat = mine ? link.lat : 0;
  }
  const out = { country: p.name, modelRtt: MODEL === 'sg' ? p.sg : p.eu, jit: p.jit, loss: p.loss || 0 };
  try {
    for (const b of bots) { await b.connect(); await b.until(m => m.k === 'welcome', 60000, 'welcome'); }
    // let the ping/pong settle so the server's input delay is computed from a real round trip
    await sleep(3000);
    // AGAINST A REAL REGION, the link is already there. Injecting the modelled round trip on top of
    // it would measure baseline+model, so take the baseline off: a profile modelled at 80 ms, run
    // from a desk that is already 35 ms away, should add 45 ms and not 80. Clamped at zero, because
    // a profile closer than the real link cannot be simulated by sending faster.
    const baseline = Math.max(...bots.map(b => b.rtt || 0));
    out.baselineRtt = Math.round(baseline);
    // Top the real link up to the profile. Against a local server the baseline is ~0 and the full
    // profile goes in; against a real region only the difference does.
    const target = Math.max(0, out.modelRtt - baseline);
    for (const b of bots) if (b.wantLat) b.lat = Math.round(target / 2);
    out.injectedRtt = Math.round(target);
    if (out.modelRtt < baseline - 10) out.note = 'the real link is already slower than this profile';
    bots[0].raw({ k: 'create', size: SIZE, stake: 0, stage: 'isle', stocks: 3, items: true, cpuFill: false });
    const room = await bots[0].until(m => m.k === 'room', 60000, 'room');
    for (let i = 1; i < SIZE; i++) { bots[i].raw({ k: 'join', code: room.code }); await bots[i].until(m => m.k === 'room' && m.code === room.code, 60000, 'join'); }
    await sleep(2500);                           // one more ping cycle with both seats present
    bots.forEach((b, i) => { b.raw({ k: 'pick', char: CHARS[i % CHARS.length] }); b.raw({ k: 'ready', on: true }); });
    const starts = await Promise.all(bots.map(b => b.until(m => m.k === 'start', 90000, 'start')));
    out.startDelayFrames = starts[0].delay || null;
    // WATCH THIS MACHINE, NOT JUST THE LINK. Twice tonight a busy generator produced a 581 ms round
    // trip on a 35 ms link and the verdict read LAGGY -- it was measuring contention on this laptop,
    // not the region. So sample our own event loop next to the fight, and say so rather than lie.
    let genLag = 0, lagLast = Date.now();
    const lagTimer = setInterval(() => { const n = Date.now(); genLag = Math.max(genLag, n - lagLast - 20); lagLast = n; }, 20);
    const drive = driveAll(bots);
    const fightFrom = Math.max(...bots.map(b => b.startAt || Date.now()));
    await sleep(SECS * 1000);
    clearInterval(drive);
    clearInterval(lagTimer);
    out.genLagMs = Math.round(genLag);
    out.genLoad = Math.round(os.loadavg()[0] * 10) / 10;
    out.genBusy = genLag > 60 || out.genLoad > os.cpus().length * 0.8;
    const t0 = fightFrom;
    const st = bots.map(b => b.state());
    const ticks = st.map(s => s.tick);
    out.rttMeasured = Math.max(...st.map(s => s.rtt));
    out.jitMeasured = Math.max(...st.map(s => s.jit));
    out.delayFrames = Math.max(2, ...bots.map(b => b.delay || 0));
    out.ticks = Math.min(...ticks);
    // 60 ticks of game time per second of wall clock is a fight running at full speed
    out.fightSecs = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
    out.speedPct = Math.min(100, Math.round((out.ticks / (out.fightSecs * 60)) * 100));
    out.stalls = Math.max(...st.map(s => s.stalls));
    out.stallMs = Math.max(...st.map(s => s.stallMs));
    out.stallPct = Math.round((out.stallMs / Math.max(1, Date.now() - t0)) * 100);
    out.needs = Math.max(...st.map(s => s.needs));
    out.lostFrames = Math.max(...st.map(s => s.lost || 0));
    out.retransmits = Math.max(...st.map(s => s.spikes || 0));
    out.desync = bots.some(b => b.inbox.some(m => m.k === 'desync'));
    out.closed = bots.some(b => b.closed);
    // The verdict a player would give. Input delay is the server's own number; the stall share is
    // the fraction of the fight that was frozen waiting for someone's frame.
    out.verdict = out.closed || out.desync ? 'BROKEN'
      // A busy generator cannot tell a slow region from its own stalls, so it must not pretend to.
      : out.genBusy ? 'UNRELIABLE'
      : out.stallPct > 12 || out.speedPct < 85 ? 'LAGGY'
      : out.delayFrames >= 15 ? 'HEAVY'
      : out.delayFrames >= 10 ? 'OK'
      : 'GOOD';
  } catch (e) {
    out.err = String(e.message || e).slice(0, 120); out.verdict = 'FAILED';
  } finally {
    for (const b of bots) b.close();
  }
  return out;
}

(async () => {
  const list = PROFILES.filter(p => !ONLY.length || ONLY.some(o => p.name.toLowerCase().includes(o.toLowerCase())));
  console.log(`country matrix: ${list.length} profiles, ${SIZE}-player rooms, ${SECS}s fights, pairs=${PAIRS}`);
  console.log(`  region ${REGION}  ${URL}\n  link model: typical consumer round trip to ${MODEL === 'sg' ? 'Singapore' : 'Frankfurt'}\n`);
  console.log('  country                 rtt  jit  loss | delay  speed  stall  needs | verdict');
  console.log('  ' + '-'.repeat(84));
  const rows = [];
  for (const p of list) {
    const r = await run(p);
    rows.push(r);
    console.log('  ' + r.country.padEnd(22) +
      String(r.rttMeasured ?? r.modelRtt).padStart(5) + String(r.jitMeasured ?? '').padStart(5) + String((r.loss || 0) + '%').padStart(6) + ' |' +
      String(r.delayFrames ?? '-').padStart(6) + String((r.speedPct ?? '-') + '%').padStart(7) + String((r.stallPct ?? '-') + '%').padStart(7) + String(r.needs ?? '-').padStart(7) + ' | ' +
      (r.verdict || '?') + (r.verdict === 'UNRELIABLE' ? ' (this machine was busy: loop +' + r.genLagMs + 'ms, load ' + r.genLoad + ')' : '') + (r.err ? '  ' + r.err : ''));
    await sleep(500);
  }
  const unreliable = rows.filter(r => r.verdict === 'UNRELIABLE');
  const bad = rows.filter(r => r.verdict === 'BROKEN' || r.verdict === 'FAILED' || r.verdict === 'LAGGY');
  if (unreliable.length) console.log('\n  ' + unreliable.length + ' row(s) measured nothing but this machine being busy -- re-run them idle');
  console.log('\n  ' + rows.filter(r => r.verdict === 'GOOD' || r.verdict === 'OK').length + ' of ' + rows.length + ' playable without complaint, '
    + rows.filter(r => r.verdict === 'HEAVY').length + ' heavy but playable, ' + bad.length + ' not acceptable');
  if (bad.length) for (const r of bad) console.log('    ' + r.verdict + '  ' + r.country + (r.err ? ': ' + r.err : ` (delay ${r.delayFrames}f, speed ${r.speedPct}%, stall ${r.stallPct}%)`));
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ region: REGION, model: MODEL, url: URL, size: SIZE, secs: SECS, pairs: PAIRS, rows }, null, 2)); console.log('  wrote ' + OUT); }
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('matrix died:', e); process.exit(3); });
