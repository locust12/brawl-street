// Does the matcher actually find a code in a REAL X profile payload? The stubs prove the logic; this
// proves the shape of what X hands back has not drifted. Read-only, binds nothing.
//   node test/xlive_fields.js [handle]
const { XVerify } = require('../lib/xverify');

(async () => {
  const handle = process.argv[2] || 'BrawlStreetGame';
  const v = new XVerify({});
  const p = await v.fetchProfile(handle);
  if (!p) { console.log('FAIL: @' + handle + ' did not resolve'); process.exit(1); }

  const problems = [];
  const ok = (c, what) => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${what}`); if (!c) problems.push(what); };

  console.log(`\nreal profile @${p.screen_name} (id ${p.id})`);
  ok(!!p.id && /^\d+$/.test(String(p.id)), 'has a numeric id, which is what we bind to');
  ok(typeof p.screen_name === 'string' && p.screen_name.length > 0, 'has a screen_name');
  ok(typeof p.description === 'string', 'has a description field (the bio)');
  ok('protected' in p, 'reports whether the account is protected');

  console.log('\nthe matcher reads every editable field out of the REAL payload');
  // take a word that genuinely appears in each field and check the matcher finds it there
  const probes = [
    ['description', p.description],
    ['name', p.name],
    ['location', p.location],
    ['website', p.website && (p.website.display_url || p.website.url)],
  ];
  let checked = 0;
  for (const [field, val] of probes) {
    const token = String(val || '').split(/[\s/]+/).filter(w => w.length >= 4)[0];
    if (!token) { console.log(`  --    ${field} is empty on this account, nothing to probe`); continue; }
    checked++;
    ok(XVerify.carries(p, token), `a token from ${field} ("${token}") is found by carries()`);
  }
  ok(checked > 0, 'at least one field had content to probe');
  ok(!XVerify.carries(p, 'BRAWL-ZZZZZZ'), 'a code that is NOT there is correctly not found');

  console.log(problems.length ? `\n${problems.length} FAILED` : '\nall checks passed');
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error('threw:', e.message); process.exit(1); });
