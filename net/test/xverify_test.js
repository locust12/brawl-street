// X handle verification: you connect it, you cannot type it.
//   node test/xverify_test.js            # logic only, fake profiles
//   LIVE=1 node test/xverify_test.js     # also hits the real public X read
const { XVerify, okHandle } = require('../lib/xverify');

let pass = 0; const problems = [];
const ok = (c, what) => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${what}`); c ? pass++ : problems.push(what); };

// a fake X where I control every bio
const fake = (bios, opts = {}) => async handle => {
  const k = Object.keys(bios).find(x => x.toLowerCase() === handle.toLowerCase());
  if (!k) return null;
  if (opts.throw) throw new Error('network down');
  return { id: opts.ids && opts.ids[k] || '100' + Object.keys(bios).indexOf(k), screen_name: k, name: k, description: bios[k], avatar_url: 'http://a/' + k, protected: !!(opts.prot && opts.prot[k]) };
};

(async () => {
  console.log('\nhandles are validated before anyone goes near X');
  {
    const v = new XVerify({ fetchProfile: fake({}) });
    ok(v.claim('a', 'has spaces').err, 'a handle with a space is refused');
    ok(v.claim('a', 'waaaaaaaaaaaaaaytoolong').err, 'a handle over 15 chars is refused');
    ok(v.claim('a', '').err, 'an empty handle is refused');
    ok(!v.claim('a', '@BrawlStreetGame').err, 'a leading @ is fine');
    ok(okHandle('a_1') && !okHandle('a-1'), 'letters, numbers, underscore only');
  }

  console.log('\nthe code has to actually be in the bio');
  {
    const v = new XVerify({ fetchProfile: fake({ rival: 'just a normal bio' }) });
    const c = v.claim('me', 'rival');
    ok(/^BRAWL-[2-9BCDFGHJKLMNPQRSTVWXZ]{6}$/.test(c.code), 'the code looks like ' + c.code);
    const r = await v.verify('me');
    ok(!!r.err && !r.ok, 'claiming someone else\'s handle fails while their bio has no code');
    ok(r.err.includes(c.code), 'and the error tells the player exactly what to paste');
  }

  console.log('\nwith the code in the bio it binds');
  {
    const code = { v: null };
    const v = new XVerify({ fetchProfile: async h => ({ id: '42', screen_name: 'Duane', name: 'D', description: 'builder ' + code.v + ' here', avatar_url: 'http://a' }) });
    code.v = v.claim('me', 'Duane').code;
    const r = await v.verify('me');
    ok(r.ok === true, 'verified');
    ok(r.x === 'Duane' && r.xid === '42', 'it returns the handle AND the numeric id');
    ok(v.pending('me') === null, 'the claim is consumed, so the code cannot be replayed');
  }

  console.log('\none X account cannot wear two fighters');
  {
    const code = { v: null };
    const v = new XVerify({ fetchProfile: async h => ({ id: '42', screen_name: 'Duane', description: 'x ' + code.v }) });
    code.v = v.claim('second', 'Duane').code;
    const r = await v.verify('second', () => 'first');     // already held by another account
    ok(!!r.err && !r.ok, 'the second account is refused');
    ok(/already connected/i.test(r.err), 'and told why');
    // the SAME account re-verifying is fine
    code.v = v.claim('first', 'Duane').code;
    const r2 = await v.verify('first', () => 'first');
    ok(r2.ok === true, 'but the account that owns it can re-verify');
  }

  console.log('\nfailures are reported honestly');
  {
    const v = new XVerify({ fetchProfile: fake({ ghost: 'x' }) });
    v.claim('me', 'nobodyhome');
    ok(/does not exist/i.test((await v.verify('me')).err || ''), 'a handle that is not on X says so');

    const v2 = new XVerify({ fetchProfile: fake({ shy: 'x' }, { prot: { shy: 1 } }) });
    v2.claim('me', 'shy');
    ok(/protected/i.test((await v2.verify('me')).err || ''), 'a protected account says so, rather than "failed"');

    const v3 = new XVerify({ fetchProfile: fake({ a: 'x' }, { throw: 1 }) });
    v3.claim('me', 'a');
    const r = await v3.verify('me');
    ok(r.soft === true, 'X being unreachable is a SOFT failure, never "that is not your account"');
  }

  console.log('\nthe code survives a reload, and expires');
  {
    const v = new XVerify({ fetchProfile: fake({ a: 'x' }) });
    const c1 = v.claim('me', 'a'), c2 = v.claim('me', 'a');
    ok(c1.code === c2.code, 'asking twice for the same handle keeps the same code');
    ok(v.claim('me', 'b').code !== c1.code, 'a different handle gets a fresh code');
    const v2 = new XVerify({ fetchProfile: fake({ a: 'x' }) });
    v2.claim('me', 'a');
    v2.claims.get('me').at -= 31 * 60e3;
    ok(/expired/i.test((await v2.verify('me')).err || ''), 'a 31-minute-old code is expired');
  }


  console.log('\nthe code counts wherever they put it');
  {
    const mk = field => {
      const code = { v: null };
      const v = new XVerify({ fetchProfile: async h => {
        const p = { id: '7', screen_name: h, name: 'n', description: 'bio', location: 'loc', website: { url: 'http://x.y', display_url: 'x.y' } };
        if (field === 'website') p.website = { url: 'http://x.y/' + code.v, display_url: 'x.y/' + code.v };
        else p[field] = 'something ' + code.v;
        return p;
      } });
      code.v = v.claim('me', 'someone').code;
      return v.verify('me');
    };
    for (const f of ['description', 'name', 'location', 'website']) {
      const r = await mk(f);
      ok(r.ok === true, 'the code is accepted in the ' + f + ' field');
    }
    const v = new XVerify({ fetchProfile: async h => ({ id: '7', screen_name: h, description: 'no code anywhere' }) });
    v.claim('me', 'someone');
    ok(!(await v.verify('me')).ok, 'and a profile with the code nowhere is still refused');
  }

  console.log('\nthe server polls so the player never presses a button');
  {
    const bio = { v: 'nothing' };
    const v = new XVerify({ fetchProfile: async h => ({ id: '9', screen_name: h, description: bio.v }) });
    const c = v.claim('me', 'waiter');
    let got = null;
    v.startPolling('me', null, (th, r) => { got = { th, r }; });
    await new Promise(r => setTimeout(r, 7000));
    ok(got === null, 'nothing binds while the bio has no code');
    bio.v = 'now it says ' + c.code;
    await new Promise(r => setTimeout(r, 8000));
    ok(!!got, 'once the bio carries the code it binds with no further input');
    ok(got && got.r.x === 'waiter' && got.r.xid === '9', 'and hands back the handle and id');
    ok(v.pending('me') === null, 'the claim is consumed');
  }

  console.log('\ncancelling stops the polling');
  {
    const v = new XVerify({ fetchProfile: async h => ({ id: '9', screen_name: h, description: 'x' }) });
    v.claim('me', 'w'); v.startPolling('me', null, () => {});
    const c = v.claims.get('me');
    v.cancel('me');
    ok(!c.timer, 'the timer is cleared on cancel');
    ok(v.pending('me') === null, 'and the claim is gone');
  }


  console.log('\npolling degrades instead of hammering a third party');
  {
    const v = new XVerify({ fetchProfile: async h => ({ id: '1', screen_name: h, description: 'x' }) });
    for (let i = 0; i < 30; i++) { v.claim('p' + i, 'h' + i); v.startPolling('p' + i, null, () => {}); }
    const n = v.pollerCount();
    ok(n <= 25, `at most 25 pollers run at once (got ${n})`);
    ok(n === 25, 'and it does fill up to the cap');
    for (let i = 0; i < 30; i++) v.cancel('p' + i);
    ok(v.pollerCount() === 0, 'cancelling them all clears every timer');
  }

  if (process.env.LIVE) {
    console.log('\nLIVE: the real public read actually works');
    const v = new XVerify({});
    const p = await v.fetchProfile('BrawlStreetGame').catch(e => ({ e: e.message }));
    ok(p && p.id && p.screen_name, 'read @BrawlStreetGame without any login: id ' + (p && p.id));
    ok(typeof (p && p.description) === 'string', 'and got the bio back, which is what the code goes in');
    const miss = await v.fetchProfile('zqxjkvwpl9').catch(() => 'threw');
    ok(miss === null, 'a handle that does not exist comes back null, not an exception');
  }

  console.log(problems.length ? `\n${problems.length} FAILED:\n  ` + problems.join('\n  ') : `\nall ${pass} checks passed`);
  process.exit(problems.length ? 1 : 0);
})();
