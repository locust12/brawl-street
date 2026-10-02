#!/usr/bin/env bash
# Stand up a SECOND Brawlstreet game-server region on a fresh box and join it to the region list.
#
#   bash net/region-up.sh 203.0.113.10 sg Singapore
#   bash net/region-up.sh <ip> <region-id> <label>
#
# Copies the lw pattern exactly: Docker + Caddy + a free sslip.io hostname, the same container and the
# SAME engine build that is live on lw (a version skew between regions is worse than one region). It is
# idempotent: run it again after a code change and it redeploys.
#
# What it does NOT do: buy anything, create accounts, or touch lw's Caddy. The box must already exist
# and accept the local SSH key as root.
#
# After it finishes it prints the REGIONS JSON and, with APPLY_REGIONS=1, writes it into net/compose.yml
# and redeploys lw so both boxes advertise both regions.
set -euo pipefail
IP="${1:?usage: region-up.sh <ip> [region-id] [label]}"
RID="${2:-sg}"
LABEL="${3:-Singapore}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="$ROOT/net"
SSH_USER="${SSH_USER:-root}"
R="$SSH_USER@$IP"
HOSTNAME="brawlstreet.$(echo "$IP" | tr '.' '-').sslip.io"
URL="https://$HOSTNAME"
DEST=/opt/brawlstreet
NODE="${NODE:-$(command -v node || echo "$HOME/.local/bin/node")}"
SSH="ssh -o StrictHostKeyChecking=accept-new"

echo "region $RID ($LABEL) on $IP -> $URL"

# ---- 0. the engine that is live on lw, so both regions run identical code
LIVE="$(curl -fsS https://brawlstreet.167-233-230-149.sslip.io/healthz | sed -n 's/.*"engine":"\(v[0-9]*-[0-9a-f]*\)".*/\1/p')"
LOCAL="$(sed -n 's/.*"digest": "\(v[0-9]*-[0-9a-f]*\)".*/\1/p' "$NET/engine/engine.json")"
if [ -z "$LIVE" ]; then echo "could not read lw's live engine digest" >&2; exit 1; fi
if [ "$LIVE" != "$LOCAL" ]; then
  echo "REFUSING: lw runs $LIVE but this checkout builds $LOCAL." >&2
  echo "Deploy the same build to both, or run: SKIP_BUILD=1 bash net/deploy.sh   (then re-run this)" >&2
  exit 1
fi
echo "engine $LIVE (matches lw)"

# ---- 1. reachable, and Docker
$SSH "$R" 'command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }'
$SSH "$R" "mkdir -p $DEST/engine $DEST/public/assets $DEST/econ-src $DEST/caddy"

# ---- 2. Caddy: the same site block lw uses (TLS from Let's Encrypt, no access log)
$SSH "$R" "cat > $DEST/caddy/Caddyfile" <<EOF
# Brawlstreet online, $LABEL region: game server + WebSocket. Free sslip.io hostname. No log directive: no access log.
$HOSTNAME {
  encode zstd gzip
  reverse_proxy brawlstreet:8080
}
EOF

# ---- 3. compose: this box runs only Caddy + the game server, on its own network
$SSH "$R" "cat > $DEST/compose.yml" <<EOF
# Brawlstreet online, $LABEL region. Written by net/region-up.sh -- edit there, not here.
services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks: [brawl]
  brawlstreet:
    build: .
    image: brawlstreet:latest
    container_name: brawlstreet
    restart: unless-stopped
    env_file:
      - path: .env
        required: false
    environment:
      PUBLIC_URL: $URL
      REGION: $RID
      REGION_LABEL: $LABEL
      REGIONS: '$(cat "$NET/regions.json" 2>/dev/null || echo '[]')'
    volumes:
      - ./engine:/app/engine:ro
      - ./public:/app/public:ro
      - brawlstreet-data:/data
    networks: [brawl]
    read_only: true
    tmpfs: ["/tmp:size=64m,mode=1777"]
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    mem_limit: 700m
    memswap_limit: 700m
    pids_limit: 512
    ulimits:
      nofile: { soft: 4096, hard: 8192 }
    logging:
      driver: json-file
      options: { max-size: "2m", max-file: "2" }
volumes:
  brawlstreet-data:
  caddy-data:
  caddy-config:
networks:
  brawl:
EOF

# ---- 4. the same files deploy.sh ships to lw
mkdir -p "$NET/econ-src" && cp "$ROOT/src/89_econ.js" "$NET/econ-src/89_econ.js"
rsync -az "$NET/engine/" "$R:$DEST/engine/"
rsync -az --delete "$ROOT/assets/" "$R:$DEST/public/assets/"
rsync -az "$ROOT/index.html" "$R:$DEST/public/index.html"
rsync -az "$NET/econ-src/89_econ.js" "$R:$DEST/econ-src/89_econ.js"
rsync -az "$NET/package.json" "$NET/package-lock.json" "$NET/server.js" "$NET/Dockerfile" "$NET/.dockerignore" "$R:$DEST/"
rsync -az --delete "$NET/lib/" "$R:$DEST/lib/"
rsync -az --delete "$NET/tools/" "$R:$DEST/tools/"
$SSH "$R" "cd $DEST && docker compose up -d --build"

# ---- 5. wait for it to answer, then prove it is this region on this engine
echo "waiting for $URL …"
for i in $(seq 1 40); do
  if curl -fsS "$URL/healthz" 2>/dev/null | grep -q "$LIVE"; then
    echo "live: $URL"
    echo "ping: $(curl -fsS "$URL/ping")"
    curl -fsS "$URL/healthz" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("region",j.region,j.label,"engine",j.engine);});'
    break
  fi
  sleep 5
  [ "$i" = 40 ] && { echo "no healthy answer yet; check: ssh $R 'docker logs --tail 50 brawlstreet'" >&2; exit 1; }
done

# ---- 6. the region list both boxes must advertise
cat > "$NET/regions.json" <<EOF
[{"id":"eu","label":"Germany","ws":"wss://brawlstreet.167-233-230-149.sslip.io/ws","http":"https://brawlstreet.167-233-230-149.sslip.io"},{"id":"$RID","label":"$LABEL","ws":"wss://$HOSTNAME/ws","http":"$URL"}]
EOF
echo
echo "REGIONS (both boxes must carry this):"
cat "$NET/regions.json"
echo
if [ "${APPLY_REGIONS:-0}" = 1 ]; then
  "$NODE" -e '
    const fs=require("fs"), p=process.argv[1], j=fs.readFileSync(process.argv[2],"utf8").trim();
    let s=fs.readFileSync(p,"utf8");
    s = /^\s*REGIONS:/m.test(s) ? s.replace(/^\s*REGIONS:.*$/m, "      REGIONS: \x27"+j+"\x27")
                                : s.replace(/^(\s*REGION_LABEL:.*)$/m, "$1\n      REGIONS: \x27"+j+"\x27");
    fs.writeFileSync(p,s);' "$NET/compose.yml" "$NET/regions.json"
  echo "net/compose.yml updated; redeploying lw so it advertises both regions…"
  SKIP_BUILD=1 bash "$NET/deploy.sh" --code
  $SSH "$R" "cd $DEST && docker compose up -d"     # picks up the REGIONS written above
else
  echo "Run again with APPLY_REGIONS=1 to write this into net/compose.yml and redeploy lw."
fi
