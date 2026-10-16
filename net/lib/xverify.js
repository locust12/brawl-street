// ===== X handle verification: prove you own the account, instead of typing whatever you like =====
//
// Duane, 2026-10-14: *"no it needs to connect. not just anyone type any name of course we dont want
// that wtf"*. He is right: the handle used to be a free-text field on the custom fighter, so anyone
// could put @elonmusk over their head in a match that people are betting on.
//
// THE FLOW (no X app, no login, no keys, works today):
//   1. claim(th, handle) -> a one-time code, e.g. "BRAWL-7K2QD4"
//   2. the player pastes that code anywhere in their X bio
//   3. verify(th, ...) -> we read the PUBLIC profile, find the code, and bind the account
//   4. the player deletes the code from their bio; the binding holds, because we keep the numeric
//      X user id, which never changes even if they rename the handle
//
// Why a bio code and not OAuth: creating an X OAuth client needs developer.x.com, which cannot be
// reached from a session ([[x-key-vault]]) -- only Duane can mint one. This needs nothing. When a
// client id does exist, `oauthReady()` below turns the OAuth route on and this stays as the fallback.
//
// Why fxtwitter: x.com's own `1.1/guest/activate.json` guest-token route, which this would have used,
// now returns 404 on BOTH api.x.com and api.twitter.com (measured 2026-10-14) -- the endpoint the
// older notes relied on is gone. fxtwitter is a public read-only mirror that returns the numeric id
// and the bio with no auth at all. It is a third-party dependency and is treated as one: a failure to
// reach it is reported as "could not check right now", never as "verification failed".

const CODE_TTL_MS = 30 * 60e3;        // half an hour to go and edit a bio is plenty
const MIN_RETRY_MS = 4e3;             // one profile fetch per account per few seconds, not per click
const FETCH_TIMEOUT_MS = 12e3;
const POLL_MS = 6e3;                  // how often a waiting claim re-checks on the player's behalf
const POLL_FOR_MS = 5 * 60e3;         // give up polling after this; the manual button still works
// The profile read goes to a free third party, so the server must never be the reason it falls over.
// Past this many people mid-connect at once, later ones simply do not get the automatic polling and
// fall back to checking manually -- which still works. Degrades, never breaks.
const MAX_POLLERS = 25;

const okHandle = h => /^[A-Za-z0-9_]{1,15}$/.test(h);

class XVerify {
  constructor(o = {}) {
    this.claims = new Map();            // th -> { handle, code, at, last }
    this.log = o.log || (() => {});
    this.fetchProfile = o.fetchProfile || defaultFetchProfile;
    this.clientId = o.clientId || null;  // set X_CLIENT_ID to light up the OAuth route
  }

  oauthReady() { return !!this.clientId; }

  // A code the player can actually retype without errors: no vowels (so it cannot spell anything),
  // no 0/O/1/I confusion.
  static code() {
    const A = '23456789BCDFGHJKLMNPQRSTVWXZ';
    let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
    return 'BRAWL-' + s;
  }

  // `heldBy` is optional and only improves the message: it answers "is this handle already connected
  // to another account", so a player is told at once instead of going off to edit a bio for a handle
  // they were never going to get. The authoritative check is still the one in verify(), by numeric id.
  claim(th, handle, heldBy) {
    const h = String(handle || '').trim().replace(/^@+/, '');
    if (!okHandle(h)) return { err: 'That is not an X handle. Letters, numbers and underscore, up to 15.' };
    // AN X ACCOUNT THAT IS ALREADY CONNECTED IS A SIGN-IN, NOT AN ERROR. This used to refuse, which
    // is correct for "somebody else is wearing my handle" and exactly wrong for the common case:
    // it is the same person on a second device, coming back for what they bought. They still have to
    // prove it with the bio code, so nothing is weaker -- the proof just now has two outcomes.
    const owner = heldBy ? heldBy(h) : null;
    const restore = !!(owner && owner !== th);
    const prev = this.claims.get(th);
    // keep the same code if they are still working on the same handle, so a reload does not force
    // them to go and edit their bio a second time
    const code = prev && prev.handle.toLowerCase() === h.toLowerCase() && Date.now() - prev.at < CODE_TTL_MS
      ? prev.code : XVerify.code();
    this.claims.set(th, { handle: h, code, at: Date.now(), last: 0, restore });
    return { handle: h, code, expires: CODE_TTL_MS, restore };
  }

  // `taken` is asked for the account currently holding an X id, so one X account cannot wear two
  // fighters' names. The caller owns the account store; this stays storage-free.
  async verify(th, taken) {
    const c = this.claims.get(th);
    if (!c) return { err: 'Start by entering your X handle.' };
    if (Date.now() - c.at > CODE_TTL_MS) { this.claims.delete(th); return { err: 'That code expired. Get a new one.' }; }
    if (Date.now() - c.last < MIN_RETRY_MS) return { err: 'Give it a moment, then check again.' };
    c.last = Date.now();

    let p;
    try { p = await this.fetchProfile(c.handle); }
    catch (e) { this.log('xverify fetch failed', e.message); return { err: 'Could not reach X just now. Try again in a moment.', soft: true }; }

    if (!p) return { err: `@${c.handle} does not exist on X.` };
    if (p.protected) return { err: 'That account is protected, so we cannot read it. Make it public to connect it.' };
    // Look for the code in EVERY field the player can edit from the same screen, not just the bio.
    // People drop it in their name or their location as often as their bio, and failing someone who
    // did the thing correctly in the wrong box is the fastest way to make this feel broken.
    if (!XVerify.carries(p, c.code)) {
      return { err: `Not seeing ${c.code} on @${c.handle} yet. Put it in your X bio and save, then this connects on its own.`, soft: true };
    }

    // The numeric id is the authority (a handle can be renamed and reused). If it is already on an
    // account, the proof we just took says this person holds it -- so hand the caller that account
    // id as `adopt` and let it move the device over. The caller decides; this stays storage-free.
    const other = taken ? taken(p.id) : null;

    this.claims.delete(th);
    const out = { ok: true, x: p.screen_name || c.handle, xid: String(p.id), xav: p.avatar_url || null, xname: p.name || null };
    if (other && other !== th) out.adopt = other;
    return out;
  }

  // Does this profile carry the code anywhere the player can type? description, display name,
  // location, and the website field (both the raw url and the shortened display form X substitutes).
  static carries(p, code) {
    const want = String(code).toUpperCase();
    const w = p.website || {};
    const fields = [p.description, p.name, p.location, w.url, w.display_url,
      p.raw_description && p.raw_description.text];
    return fields.some(f => String(f || '').toUpperCase().includes(want));
  }

  pending(th) { const c = this.claims.get(th); return c ? { handle: c.handle, code: c.code } : null; }
  cancel(th) { this.stopPolling(th); this.claims.delete(th); }
  // claims are tiny and die on their own, but a long-lived server should not keep dead ones
  prune() { const now = Date.now(); for (const [k, v] of this.claims) if (now - v.at > CODE_TTL_MS) this.claims.delete(k); }

  // ---- polling: the player should not have to come back and press a button ----
  //
  // They are over on X editing their bio. Making them return to the game and click "check" is the
  // step that makes a 20-second job feel like a chore, and it is the step most people abandon on. So
  // the server watches for them: once a claim exists it re-checks every POLL_MS for POLL_FOR_MS, and
  // the moment the code appears the page flips to connected by itself.
  //
  // `onDone(th, result)` fires only on success, so the caller binds the account and pushes the new
  // state. Costs one small request per waiting player per 6s, and only while they are actually
  // mid-connect, which is a handful of people at a time at most.
  pollerCount() { let n = 0; for (const c of this.claims.values()) if (c.timer) n++; return n; }
  startPolling(th, taken, onDone) {
    const c = this.claims.get(th);
    if (!c || c.timer) return;
    if (this.pollerCount() >= MAX_POLLERS) { this.log('xpoll at capacity, manual check only'); return; }
    c.pollUntil = Date.now() + POLL_FOR_MS;
    const tick = async () => {
      const cur = this.claims.get(th);
      if (!cur || cur !== c) return;                       // cancelled, or replaced by a new claim
      if (Date.now() > c.pollUntil) { c.timer = null; return; }
      let r = null;
      try { r = await this.verify(th, taken); } catch (e) { this.log('xpoll', e.message); }
      if (r && r.ok) { c.timer = null; try { onDone(th, r); } catch (e) { this.log('xpoll done', e.message); } return; }
      if (this.claims.get(th) === c) arm();
    };
    const arm = () => { c.timer = setTimeout(tick, POLL_MS); if (c.timer.unref) c.timer.unref(); };
    arm();
  }
  stopPolling(th) { const c = this.claims.get(th); if (c && c.timer) { clearTimeout(c.timer); c.timer = null; } }
}

// Deliberately the `https` module and not `fetch`.
//
// `fetch` gives no control over address family, and this host is behind Cloudflare, which answers
// with AAAA records first. On a machine with no working IPv6 route (this Mac, and plenty of players'
// networks) Node sits on the v6 address until it times out and the whole check fails with a useless
// "fetch failed" -- measured at 10.6s here, against instant over IPv4. `dns.setDefaultResultOrder`
// would fix it by changing DNS for the ENTIRE process, which a library has no business doing, so the
// family is pinned per request instead.
function getJson(url, timeoutMs) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request(url, { family: 4, headers: { 'user-agent': 'brawlstreet-handle-check', accept: 'application/json' } }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timed out after ' + timeoutMs + 'ms')));
    req.on('error', reject);
    req.end();
  });
}

async function defaultFetchProfile(handle) {
  const r = await getJson('https://api.fxtwitter.com/' + encodeURIComponent(handle), FETCH_TIMEOUT_MS);
  // 404 is "no such account". A redirect or a non-JSON body means the mirror did not recognise it as
  // a handle at all, which is also "no such account" rather than an outage -- only a real server
  // error should become a soft failure, because a soft failure tells the player to try again.
  if (r.status === 404 || (r.status >= 300 && r.status < 400)) return null;
  if (r.status < 200 || r.status >= 300) throw new Error('status ' + r.status);
  if (!r.type.includes('json')) return null;
  let j; try { j = JSON.parse(r.body); } catch (e) { throw new Error('bad json from the profile mirror'); }
  if (j && j.code === 404) return null;
  const u = j && j.user;
  if (!u || !u.id) throw new Error('no user in response');
  return u;
}

module.exports = { XVerify, okHandle };
