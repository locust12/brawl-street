#!/usr/bin/env bash
# Redeploy Brawlstreet online to the lw box.
#   bash net/deploy.sh          # rebuild the page + engine, upload engine + index.html + assets (no restart)
#   bash net/deploy.sh --code   # same, plus upload server code and rebuild/restart the container
# A new engine file is picked up by the running server within 30 s, and older engine versions stay
# loaded, so pages still on the previous build keep working until they reload.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="$ROOT/net"
HOST="${DEPLOY_HOST:-lw}"
DEST=/opt/brawlstreet
URL="https://brawlstreet.167-233-230-149.sslip.io"
NODE="${NODE:-$(command -v node || echo "$HOME/.local/bin/node")}"

if [ "${SKIP_BUILD:-0}" != 1 ]; then (cd "$ROOT" && python3 build.py); fi
# --strict: refuse to ship an engine that doesn't match the index.html being uploaded
"$NODE" "$NET/tools/build-engine.js" --strict

# Two machines ship this game, so the build about to go up can be OLDER than the one already live.
# Compare the screens each one carries: a local build that is missing whole screens the live page has
# is a machine that has not pulled, and shipping it deletes features. FORCE=1 to override.
python3 - "$ROOT/index.html" "$URL" <<'PY' || { [ "${FORCE:-0}" = 1 ] && echo 'FORCE=1: shipping anyway' || exit 1; }
import re, sys, urllib.request
mine = open(sys.argv[1], encoding='utf8', errors='ignore').read()
try:
    live = urllib.request.urlopen(sys.argv[2], timeout=30).read().decode('utf8', 'ignore')
except Exception as e:
    print('could not read the live page (%s): skipping the regression check' % e); sys.exit(0)
ids = lambda s: set(re.findall(r'id="([A-Za-z][\w-]{2,})"', s))
lost = sorted(ids(live) - ids(mine))
if len(lost) > 4:
    print('REFUSING: this build is missing %d screens the live one has, e.g. %s' % (len(lost), ', '.join(lost[:8])))
    print('Pull from the machine that built the live page first, or re-run with FORCE=1.')
    sys.exit(1)
PY

ssh "$HOST" "mkdir -p $DEST/engine $DEST/public/assets"
rsync -az "$NET/engine/" "$HOST:$DEST/engine/"
ssh "$HOST" "cd $DEST/engine && ls -t sim-v*.js 2>/dev/null | tail -n +13 | xargs -r rm -f"
# assets/ is art and models and is NOT in git, so a fresh clone has an empty one. Syncing that with
# --delete would wipe every asset off the server, so only push them from a machine that has them,
# and never delete what is already up there.
# SKIP_ASSETS=1 forces a code-only deploy. assets/ is 401 MB, and on 16 Oct pushing it over a home
# uplink held the ssh session open long enough that it timed out mid-transfer ("Read from remote
# host ... Operation timed out"), which killed the deploy BEFORE the server code and the docker
# rebuild — so a change to net/ never shipped and nothing said so except the rsync error.
# --partial keeps what did transfer, so a retry resumes instead of starting over.
if [ "${SKIP_ASSETS:-0}" = 1 ]; then
  echo "SKIP_ASSETS=1: leaving $DEST/public/assets as it is"
elif [ -n "$(ls -A "$ROOT/assets" 2>/dev/null)" ]; then
  rsync -az --partial --timeout=180 "$ROOT/assets/" "$HOST:$DEST/public/assets/"
else
  echo "assets/ is empty on this machine: leaving the server's assets untouched (code-only deploy)"
fi
rsync -az "$ROOT/index.html" "$HOST:$DEST/public/index.html"

if [ "${1:-}" = "--code" ]; then
  # lib/catalog.js reads the store catalogue out of src/89_econ.js; the image only carries net/, so
  # vendor a copy into the build context (keeps one source of truth for prices and unlocks)
  mkdir -p "$NET/econ-src" && cp "$ROOT/src/89_econ.js" "$NET/econ-src/89_econ.js"
  ssh "$HOST" "mkdir -p $DEST/econ-src"
  rsync -az "$NET/econ-src/89_econ.js" "$HOST:$DEST/econ-src/89_econ.js"
  # pay.json rides along: the checkout is refused with "not taking payments yet" without it, which
  # is a silent failure rather than a loud one, so it must never be left behind by a deploy.
  rsync -az "$NET/package.json" "$NET/package-lock.json" "$NET/server.js" "$NET/pay.json" "$NET/Dockerfile" "$NET/compose.yml" "$NET/.dockerignore" "$HOST:$DEST/"
  rsync -az --delete "$NET/lib/" "$HOST:$DEST/lib/"
  # tools/ carries daily-survey.js, which the nightly report runs inside the container
  rsync -az --delete "$NET/tools/" "$HOST:$DEST/tools/"
  # Build and BOOT the new image in a throwaway container before it replaces the running one. A module
  # that throws while loading (a missing file, a bad require) otherwise crash-loops the real container
  # and the site is down until someone notices -- that is exactly how lib/catalog.js took it down on
  # 21 Sep. The live container is only touched once the new image has answered /healthz.
  ssh "$HOST" "set -e; cd $DEST
    docker compose build
    docker rm -f brawlstreet-preflight >/dev/null 2>&1 || true
    docker run -d --name brawlstreet-preflight --network none \
      -e PORT=8099 -e HOST=127.0.0.1 -e DATA_DIR=/tmp/preflight -e ENGINE_DIR=/app/engine -e PUBLIC_DIR=/app/public \
      -v $DEST/engine:/app/engine:ro brawlstreet:latest >/dev/null
    ok=0
    for i in \$(seq 1 20); do
      if docker exec brawlstreet-preflight node -e \"fetch('http://127.0.0.1:8099/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\" 2>/dev/null; then ok=1; break; fi
      sleep 2
    done
    if [ \$ok != 1 ]; then
      echo '--- the new image does not boot; the live container was NOT touched:' >&2
      docker logs --tail 25 brawlstreet-preflight 2>&1 | tail -25 >&2
      docker rm -f brawlstreet-preflight >/dev/null 2>&1 || true
      exit 1
    fi
    docker rm -f brawlstreet-preflight >/dev/null 2>&1 || true
    echo 'preflight ok: the new image boots'
    docker compose up -d"
fi

echo "waiting for the server to load the new engine…"
want="$(sed -n 's/.*"digest": "\(v[0-9]*-[0-9a-f]*\)".*/\1/p' "$NET/engine/engine.json")"
for i in $(seq 1 30); do
  if curl -fsS "$URL/healthz" | grep -q "$want"; then echo "live: $URL (engine $want)"; exit 0; fi
  sleep 3
done
echo "server did not report engine $want yet; check: ssh $HOST 'docker logs --tail 50 brawlstreet'" >&2
exit 1
