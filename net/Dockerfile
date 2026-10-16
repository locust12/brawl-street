# Brawlstreet online game server (lobby, lockstep relay, server-side replays, practice wagers).
# The fight engine (engine/) and the built game (public/) are mounted from the host, so a new game
# build deploys with rsync alone; this image only changes when server.js or lib/ change.
FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY lib ./lib
# the checkout's chain/treasury/token config (lib/pay.js reads ../pay.json). Addresses only: no key
# for any wallet is in it, and this server never signs anything.
COPY pay.json ./
# the store catalogue lives in the game source; deploy.sh vendors src/89_econ.js here
COPY econ-src ./econ-src
# tools/daily-survey.js runs inside the container for the nightly report
COPY tools ./tools
RUN mkdir -p /data /app/engine /app/public && chown -R node:node /data
USER node
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data PUBLIC_DIR=/app/public ENGINE_DIR=/app/engine
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
