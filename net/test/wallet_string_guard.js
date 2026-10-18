// The page and the server must agree, character for character, on the message a wallet signs.
//
// On 17 Oct they did not. The page signed `Brawl Street online\nRoom…` and the server verified
// `Brawlstreet online\nRoom…` -- the rename had never reached the server. Every "Connect wallet" in
// a real-stakes room failed with "Wallet signature did not check out", so no real wager could be
// funded at all, and it had been that way for weeks.
//
// Why no test caught it: the escrow tests all signed the SERVER's own string, so the money path
// passed its suite while being unusable from a browser. A test that builds the string itself can
// never catch this. The only thing that can is reading BOTH sources and comparing them, which is
// what this does -- no server, no chain, no browser, so it costs nothing to run every time.
//
//   node test/wallet_string_guard.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'src', '77_net.js');
const SERVER = path.join(__dirname, '..', 'server.js');

let bad = 0;
const check = (ok, what, detail) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`); if (!ok) bad++; };

// Pull the template literal each side signs/verifies, and normalise the variable names away so only
// the LITERAL text is compared: `${r.code}` here and `${r.code}` there are the same field.
function shape(src, re, label) {
  const m = re.exec(src);
  if (!m) return null;
  return m[1].replace(/\$\{[^}]+\}/g, '${}');
}

const page = fs.readFileSync(PAGE, 'utf8');
const server = fs.readFileSync(SERVER, 'utf8');

const pageStr = shape(page, /const text = `([^`]+)`/, 'page');
const srvStr = shape(server, /function walletMessage\([^)]*\)\s*\{\s*return `([^`]+)`/, 'server');

check(!!pageStr, 'the page has a wallet message to sign', pageStr && JSON.stringify(pageStr));
check(!!srvStr, 'the server has a wallet message to verify', srvStr && JSON.stringify(srvStr));
check(!!pageStr && !!srvStr && pageStr === srvStr,
  'the two are identical',
  pageStr === srvStr ? '' : `\n        page   ${JSON.stringify(pageStr)}\n        server ${JSON.stringify(srvStr)}`);

// The field ORDER has to match too, not just the words around it. These strings come out of a FILE,
// so a newline in the source is the two characters backslash-n, not a line break -- splitting on a
// real newline here found nothing and made this check pass vacuously.
const fields = s => (s || '').split('\\n').map(l => l.split(' ')[0]);
check(JSON.stringify(fields(pageStr)) === JSON.stringify(fields(srvStr)),
  'the lines appear in the same order', JSON.stringify(fields(srvStr)));

// A nonce has to be in there: without one, a signature captured from one room is replayable in the next.
check(/Nonce/.test(srvStr || ''), 'the signed message is bound to a nonce');
check(/Room/.test(srvStr || ''), 'the signed message is bound to the room');

console.log(bad ? `\n${bad} check(s) FAILED -- a real wager cannot be funded while these disagree` : '\nthe page and the server sign the same string');
process.exit(bad ? 1 : 0);
