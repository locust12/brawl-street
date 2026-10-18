#!/bin/bash
# EVENT MODE: the four per-IP limits that stop a crowd sharing one connection, lifted together and
# put back together. Written 10/18 after a night of load testing, because on the night of an event
# nobody should be editing .env by hand on two boxes and hoping.
#
#   bash net/tools/event-mode.sh on     # lift the limits on every region
#   bash net/tools/event-mode.sh off    # put them back exactly as they were
#   bash net/tools/event-mode.sh status # what each box is running right now
#
# WHAT IT LIFTS, and why each one matters to a room full of people on one wifi:
#   SAME_IP_OK=1         ranked quick 1v1 refuses two players on one IP -- flatmates, an office, a
#                        venue. This also drops MAX_ROOMS_PER_IP, which is 4 by default.
#   MAX_CONN_PER_IP      16 by default: the 17th player on that address cannot connect at all.
#   NEW_ACCT_PER_IP      30 new accounts per IP per hour: the 31st NEW player is refused.
#   NEW_ACCT_GLOBAL      600 per hour across everyone.
#
# WHAT IT DOES NOT TOUCH: MAX_MATCHES. That cap is what keeps a box playable (measured 10/18: lw 15,
# sg 10), and lifting it would let a crowd in and freeze all of them. Capacity is hardware.
#
# THE LIMITS ARE REAL ABUSE PROTECTION. Event mode is for the hours of the event, not a setting to
# leave on: with it on, one person can hold any number of rooms and mint accounts freely.
set -e
CMD="${1:-status}"
HOSTS="${REGION_HOSTS:-lw sg}"
MARK="# --- event-mode ---"

for H in $HOSTS; do
  case "$CMD" in
    on)
      ssh -o ConnectTimeout=15 -o BatchMode=yes "$H" "cd /opt/brawlstreet && \
        if grep -q '$MARK' .env; then echo '$H: already in event mode'; else \
          cp .env .env.before-event && \
          printf '%s\nSAME_IP_OK=1\nMAX_CONN_PER_IP=600\nNEW_ACCT_PER_IP=100000\nNEW_ACCT_GLOBAL=1000000\nMAX_ROOMS_PER_IP=400\n' '$MARK' >> .env && \
          docker compose up -d >/dev/null 2>&1 && echo \"\$(hostname): EVENT MODE ON\"; fi"
      ;;
    off)
      ssh -o ConnectTimeout=15 -o BatchMode=yes "$H" "cd /opt/brawlstreet && \
        if [ -f .env.before-event ]; then mv .env.before-event .env && docker compose up -d >/dev/null 2>&1 && echo \"\$(hostname): back to normal limits\"; \
        else echo \"\$(hostname): no event-mode backup, nothing to restore\"; fi"
      ;;
    status)
      ssh -o ConnectTimeout=15 -o BatchMode=yes "$H" "cd /opt/brawlstreet && \
        printf '%s: ' \"\$(hostname)\" && \
        if grep -q '$MARK' .env; then printf 'EVENT MODE'; else printf 'normal limits'; fi && \
        printf '  (MAX_MATCHES=%s)\n' \"\$(grep -m1 '^MAX_MATCHES=' .env | cut -d= -f2)\""
      ;;
    *) echo "usage: event-mode.sh on|off|status"; exit 1 ;;
  esac
done

if [ "$CMD" != status ]; then
  # a recreated container needs a moment; checking instantly reports UNREACHABLE and panics whoever
  # is running this five minutes before an event
  echo "--- waiting for both regions to answer ---"
  for U in https://brawlstreet.167-233-230-149.sslip.io https://brawlstreet.5-223-91-79.sslip.io; do
    for i in $(seq 1 30); do
      if curl -s --max-time 6 "$U/healthz" | grep -q '"ok":true'; then break; fi
      sleep 2
    done
    printf '  %s ' "$U"
    curl -s --max-time 10 "$U/healthz" | python3 -c "import json,sys;d=json.load(sys.stdin);print('ok',d.get('ok'),'engine',d.get('engine'),'| matches',d.get('matches'))" 2>/dev/null || echo "STILL UNREACHABLE -- check it before the event starts"
  done
fi
