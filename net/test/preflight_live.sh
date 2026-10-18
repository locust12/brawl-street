#!/usr/bin/env bash
# Is online play actually working on the live regions, right now?
#
# Run this before an event. It plays real fights on each region and checks the things a player would
# notice, in the order they would notice them. It takes about two minutes.
#
# It passes TEST_KEY, so the accounts it makes are hidden from the leaderboard and pruned within the
# hour. WITHOUT that key every run leaves its bot accounts on the board permanently, where they are
# indistinguishable from players. Never run a bot against a live region without it.
#
#   bash net/test/preflight_live.sh
#   REGIONS="sg" bash net/test/preflight_live.sh      # just one
set -u
cd "$(dirname "$0")/.."

EU=wss://brawlstreet.167-233-230-149.sslip.io/ws
SG=wss://brawlstreet.5-223-91-79.sslip.io/ws
REGIONS="${REGIONS:-eu sg}"
fail=0

key_for() { ssh -o ConnectTimeout=12 "$1" "grep '^TEST_KEY=' /opt/brawlstreet/.env | cut -d= -f2" 2>/dev/null; }

for R in $REGIONS; do
  case "$R" in
    eu) URL=$EU; HOST=lw; LABEL="Germany" ;;
    sg) URL=$SG; HOST=sg; LABEL="Singapore" ;;
    *)  echo "unknown region $R"; exit 2 ;;
  esac
  HTTP=$(printf '%s' "$URL" | sed 's|^wss|https|; s|/ws$||')
  echo
  echo "================ $LABEL"

  # 1. the server is up and on the build the page is serving
  H=$(curl -fsS -m 10 "$HTTP/healthz" 2>/dev/null)
  if [ -z "$H" ]; then echo "  FAIL  /healthz did not answer"; fail=1; continue; fi
  python3 -c "
import json,sys
d=json.loads('''$H''')
print('  ok    healthz: engine %s, region %s, online %s, matches %s' % (d['engine'], d['region'], d['online'], d['matches']))
sys.exit(0 if d.get('ok') else 1)
" || { echo "  FAIL  healthz says not ok"; fail=1; }

  # 2. the key is set, or this run will leave permanent accounts on the board
  K=$(key_for "$HOST")
  if [ -z "$K" ]; then
    echo "  WARN  no TEST_KEY on $HOST -- accounts from this run will be PERMANENT and will show on the leaderboard"
  else
    echo "  ok    TEST_KEY present, so this run stays off the leaderboard"
  fi

  # 3. a room opens, fills and starts, four times over
  if TEST_KEY="$K" node test/room_torture.js --n 4 --conc 1 --mode full --size 2 --url "$URL" --quiet 2>&1 | grep -q "no failures"; then
    echo "  ok    4 rooms created, joined, readied and started"
  else
    echo "  FAIL  the room lifecycle did not complete cleanly"; fail=1
  fi

  # 4. a four-player room fills and starts
  if TEST_KEY="$K" node test/room_torture.js --n 2 --conc 1 --mode full --size 4 --url "$URL" --quiet 2>&1 | grep -q "no failures"; then
    echo "  ok    4-player rooms fill and start"
  else
    echo "  FAIL  a 4-player room did not start"; fail=1
  fi

  # 5. the leaderboard is real players, not leftover bots
  TEST_KEY="$K" node -e "
const crypto=require('crypto');
const engine=require('./lib/engine'); const info=engine.load();
const {LightBot}=require('./test/light_bot');
const BOT=/^(L\d{3}-|T\d{5}-|X-(thailand|germany)|RH-|DC-|FS-|C\d-)/;
(async()=>{
  const b=new LightBot('PF',process.argv[1],{token:crypto.randomBytes(32).toString('hex'),build:info.digest,seed:9});
  await b.connect(); await b.until(m=>m.k==='welcome',20000,'welcome');
  b.raw({k:'board'});
  const bd=await b.until(m=>m.k==='board',10000,'board');
  const rows=bd.all||[]; const bots=rows.filter(r=>BOT.test(r.name||''));
  if (bots.length) { console.log('  FAIL  the leaderboard has '+bots.length+' leftover test accounts on it: '+bots.slice(0,4).map(r=>r.name).join(', ')); process.exit(1); }
  console.log('  ok    leaderboard is '+rows.length+' real player(s), no test accounts');
  b.close(); process.exit(0);
})().catch(e=>{console.log('  FAIL  could not read the leaderboard: '+e.message);process.exit(1)});
" "$URL" || fail=1
done

echo
if [ $fail = 0 ]; then echo "PREFLIGHT CLEAN -- online play is working on every region checked"; else echo "PREFLIGHT FOUND PROBLEMS -- see the FAIL lines above"; fi
exit $fail
