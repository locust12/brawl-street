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

ssh "$HOST" "mkdir -p $DEST/engine $DEST/public/assets"
rsync -az "$NET/engine/" "$HOST:$DEST/engine/"
ssh "$HOST" "cd $DEST/engine && ls -t sim-v*.js 2>/dev/null | tail -n +13 | xargs -r rm -f"
rsync -az --delete "$ROOT/assets/" "$HOST:$DEST/public/assets/"
rsync -az "$ROOT/index.html" "$HOST:$DEST/public/index.html"

if [ "${1:-}" = "--code" ]; then
  # lib/catalog.js reads the store catalogue out of src/89_econ.js; the image only carries net/, so
  # vendor a copy into the build context (keeps one source of truth for prices and unlocks)
  mkdir -p "$NET/econ-src" && cp "$ROOT/src/89_econ.js" "$NET/econ-src/89_econ.js"
  ssh "$HOST" "mkdir -p $DEST/econ-src"
  rsync -az "$NET/econ-src/89_econ.js" "$HOST:$DEST/econ-src/89_econ.js"
  rsync -az "$NET/package.json" "$NET/package-lock.json" "$NET/server.js" "$NET/Dockerfile" "$NET/compose.yml" "$NET/.dockerignore" "$HOST:$DEST/"
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
