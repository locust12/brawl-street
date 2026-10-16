// Does the DEPLOYED server actually answer the X connect exchange? Read-only: it claims a code and
// never verifies, so nothing is bound and no account is touched.
//   node test/live_xprobe.js [wss://host/ws]
const WebSocket = require('ws');
const URL = process.argv[2] || 'wss://brawlstreet.167-233-230-149.sslip.io/ws';
const TOKEN = require('crypto').randomBytes(32).toString('hex');   // the server wants 32-128 hex chars

(async () => {
  const health = await fetch(URL.replace(/^wss/, 'https').replace(/\/ws$/, '/healthz')).then(r => r.json());
  console.log('server engine:', health.engine);
  // no Origin header: originOk() accepts a non-browser client, and any other value is refused (1008)
  const ws = new WebSocket(URL);
  const seen = [];
  ws.on('error', e => { console.log('ws error:', e.message); process.exit(1); });
  ws.on('close', (c, r) => console.log('closed', c, String(r || '').slice(0, 140), '| saw:', seen.join(',') || '(nothing)'));
  ws.on('open', () => {
    console.log('socket open');
    ws.send(JSON.stringify({ k: 'hello', v: 1, token: TOKEN, name: 'Probe', build: health.engine, test: true }));
  });
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    seen.push(m.k);
    if (m.k === 'welcome') {
      console.log('welcome: profile.x =', m.profile && m.profile.x, '| has xav field:', 'xav' in (m.profile || {}));
      ws.send(JSON.stringify({ k: 'xclaim', handle: 'BrawlStreetGame' }));
    }
    if (m.k === 'xstate') { console.log('XSTATE:', JSON.stringify(m)); process.exit(0); }
    if (m.k === 'err' && m.code === 'x') { console.log('err(x):', m.msg); process.exit(0); }
  });
  setTimeout(() => { console.log('timeout; saw:', seen.join(',') || '(nothing)'); process.exit(1); }, 15000);
})().catch(e => { console.error(e.message); process.exit(1); });
