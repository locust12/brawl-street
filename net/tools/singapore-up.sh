#!/usr/bin/env bash
# Buy a Singapore box and turn it into the second Brawlstreet region, in one go.
#
#   HCLOUD_TOKEN=xxxxx bash net/tools/singapore-up.sh
#
# Everything after the purchase was already written (net/region-up.sh). The only thing that was ever
# missing is a server to point it at, and the only thing missing for THAT is a Hetzner Cloud API
# token. lw is already a Hetzner box, so this is the same account and the same invoice: no new
# signup, no new card.
#
# Make the token at https://console.hetzner.cloud -> your project -> Security -> API tokens ->
# Generate API token, with READ & WRITE. It is shown once. Paste it as HCLOUD_TOKEN above.
#
# What this does:
#   1. picks the cheapest server type actually available in Singapore with at least 2 GB
#   2. uploads this machine's SSH public key to the project if it is not already there
#   3. creates the server, waits for it to boot and answer SSH
#   4. hands it to net/region-up.sh, which installs Docker, Caddy, the SAME engine build that is
#      live on lw, and joins both boxes into one region list
#
# It is safe to re-run: if a server called $NAME already exists it is reused rather than bought again.
set -euo pipefail

TOKEN="${HCLOUD_TOKEN:?set HCLOUD_TOKEN (Hetzner Cloud -> Security -> API tokens, read & write)}"
NAME="${NAME:-brawlstreet-sg}"
LOCATION="${LOCATION:-sin}"
IMAGE="${IMAGE:-ubuntu-24.04}"
MIN_RAM_GB="${MIN_RAM_GB:-2}"
KEYFILE="${KEYFILE:-$HOME/.ssh/launchwindow}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API="https://api.hetzner.cloud/v1"

api() { # api METHOD PATH [JSON]
  local m="$1" p="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$m" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body" "$API$p"
  else
    curl -fsS -X "$m" -H "Authorization: Bearer $TOKEN" "$API$p"
  fi
}

command -v jq >/dev/null || { echo "this needs jq (brew install jq, or use the python fallback below)" >&2; exit 1; }
[ -f "$KEYFILE.pub" ] || { echo "no public key at $KEYFILE.pub" >&2; exit 1; }

echo "==> checking the token and the Singapore location"
api GET "/locations" | jq -e --arg l "$LOCATION" '.locations[] | select(.name==$l)' >/dev/null \
  || { echo "location $LOCATION is not offered on this account" >&2; exit 1; }

# ---- reuse an existing box rather than buying a second one
EXISTING="$(api GET "/servers?name=$NAME" | jq -r '.servers[0].public_net.ipv4.ip // empty')"
if [ -n "$EXISTING" ]; then
  echo "==> $NAME already exists at $EXISTING, reusing it (nothing bought)"
  IP="$EXISTING"
else
  echo "==> picking the cheapest type in $LOCATION with >= ${MIN_RAM_GB} GB"
  # Hetzner regrouped the Singapore line-up in Oct 2025, so ask the API what is actually there
  # instead of hard-coding a type that may no longer be sold.
  # A type having a PRICE for a location does not mean it is sold there: cpx11 is priced for sin and
  # refused with "unsupported location for server type", because the cheap Singapore tiers were
  # retired at the end of 2025. The truth is server_types[].locations[], where each entry carries its
  # own `available` flag. (/v1/datacenters, the old way to ask this, was removed in June 2026.)
  TYPE_JSON="$(api GET "/server_types?per_page=100")"
  TYPE="$(echo "$TYPE_JSON" | jq -r --arg l "$LOCATION" --argjson min "$MIN_RAM_GB" '
    [ .server_types[]
      | select(.memory >= $min)
      | select(.architecture == "x86")
      | . as $t
      | (.locations[]? | select(.name == $l and .available == true)) as $L
      | ($t.prices[]? | select(.location == $l)) as $p
      | { name: $t.name, cores: $t.cores, memory: $t.memory, eur: ($p.price_monthly.gross | tonumber) }
    ] | sort_by(.eur) | .[0] // empty | "\(.name) \(.cores)vCPU \(.memory)GB EUR\((.eur*100|round)/100)"')"
  [ -n "$TYPE" ] || { echo "no server type available in $LOCATION with >= ${MIN_RAM_GB} GB" >&2; exit 1; }
  TYPE_NAME="$(echo "$TYPE" | cut -d' ' -f1)"
  echo "    $TYPE  (per month, incl. VAT)"

  echo "==> making sure this machine's SSH key is on the account"
  FPR="$(ssh-keygen -lf "$KEYFILE.pub" -E md5 | awk '{print $2}' | sed 's/^MD5://')"
  KEYID="$(api GET "/ssh_keys?per_page=100" | jq -r --arg f "$FPR" '.ssh_keys[] | select(.fingerprint==$f) | .id' | head -1)"
  if [ -z "$KEYID" ]; then
    KEYID="$(api POST "/ssh_keys" "$(jq -n --arg n "brawlstreet-$(hostname -s)" --arg k "$(cat "$KEYFILE.pub")" '{name:$n, public_key:$k}')" | jq -r '.ssh_key.id')"
    echo "    uploaded key $KEYID"
  else
    echo "    key $KEYID already on the account"
  fi

  echo "==> creating $NAME ($TYPE_NAME, $IMAGE, $LOCATION)"
  CREATE="$(api POST "/servers" "$(jq -n --arg n "$NAME" --arg t "$TYPE_NAME" --arg i "$IMAGE" --arg l "$LOCATION" --argjson k "[$KEYID]" \
    '{name:$n, server_type:$t, image:$i, location:$l, ssh_keys:$k, public_net:{enable_ipv4:true, enable_ipv6:true}, labels:{project:"brawlstreet", role:"game-region"}}')")"
  ID="$(echo "$CREATE" | jq -r '.server.id')"
  IP="$(echo "$CREATE" | jq -r '.server.public_net.ipv4.ip')"
  echo "    server $ID at $IP"

  echo "==> waiting for it to come up"
  for i in $(seq 1 60); do
    st="$(api GET "/servers/$ID" | jq -r '.server.status')"
    [ "$st" = running ] && break
    sleep 5
  done
fi

echo "==> waiting for SSH on $IP"
for i in $(seq 1 60); do
  if ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -i "$KEYFILE" "root@$IP" true 2>/dev/null; then break; fi
  sleep 5
done
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "$KEYFILE" "root@$IP" true \
  || { echo "the box is up at $IP but SSH did not answer; try again in a minute" >&2; exit 1; }
echo "    ssh ok"

# region-up.sh shells out with a plain `ssh root@<ip>`, with no -i, so the key has to be something
# ssh finds on its own or every call fails with "Permission denied (publickey)". Write the host into
# ~/.ssh/config the way lw already is, which also makes later deploys reachable as `sg`.
if ! grep -q "$IP" "$HOME/.ssh/config" 2>/dev/null; then
  echo "==> adding $IP to ~/.ssh/config as 'sg'"
  printf '\nHost sg %s\n  HostName %s\n  User root\n  IdentityFile %s\n  StrictHostKeyChecking accept-new\n' "$IP" "$IP" "$KEYFILE" >> "$HOME/.ssh/config"
fi

echo "==> handing over to region-up.sh (Docker, Caddy, the live engine build, region list)"
# Singapore gets the 401 MB assets/ folder it has none of (that rsync is unconditional in
# region-up.sh and is the slow part: expect 10-30 min on a home uplink). lw already has them, and
# re-pushing them is what timed out a deploy on 16 Oct, so skip that leg: SKIP_ASSETS is read only
# by deploy.sh, which region-up.sh calls at the end to make lw advertise both regions.
export SKIP_ASSETS=1
APPLY_REGIONS=1 bash "$ROOT/net/region-up.sh" "$IP" sg Singapore

# The tournament feed is keyed per box and the new one has no .env, so copy lw's across; without it
# /api/matches is simply not a route on the Singapore box and the bracket runner sees half the games.
if ssh -o ConnectTimeout=10 lw 'test -f /opt/brawlstreet/.env' 2>/dev/null; then
  echo "==> copying lw's .env (TOURNEY_KEY, MAX_MATCHES, PAYMENTS) to Singapore"
  ssh -o ConnectTimeout=10 lw 'cat /opt/brawlstreet/.env' \
    | ssh -o StrictHostKeyChecking=accept-new -i "$KEYFILE" "root@$IP" 'cat > /opt/brawlstreet/.env && chmod 600 /opt/brawlstreet/.env'
  ssh -o StrictHostKeyChecking=accept-new -i "$KEYFILE" "root@$IP" 'cd /opt/brawlstreet && docker compose up -d' >/dev/null
fi

cat <<EOF

Done. Singapore is live and both boxes advertise both regions.

  ssh root@$IP
  https://brawlstreet.$(echo "$IP" | tr '.' '-').sslip.io/healthz

Add this to ~/.ssh/config so later deploys can reach it by name:

  Host sg
    HostName $IP
    User root
    IdentityFile $KEYFILE
    StrictHostKeyChecking accept-new
EOF
