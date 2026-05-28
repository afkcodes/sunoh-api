FROM node:20-alpine

# Install Chromium + the X-less runtime libs Puppeteer needs.
#
# Why: Puppeteer's bundled Chromium is glibc-only. Alpine ships musl
# libc, so the downloaded binary won't run. We install Alpine's native
# Chromium package instead and tell Puppeteer to point at it via
# PUPPETEER_EXECUTABLE_PATH (PUPPETEER_SKIP_DOWNLOAD skips the doomed
# postinstall download — saves ~170 MB during build).
#
# Adds ~120 MB to the final image. Only needed because the Spotify
# playlist importer (`src/spotify/scraper.ts`) drives a real browser —
# Spotify's Web API requires a Premium dev account as of 2024-2025, and
# their embed page is hard-capped at 100 tracks.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    dumb-init

# NODE_ENV is set at RUNTIME via docker-compose.yml — not here. Setting
# it at build time causes `npm ci` to drop devDependencies (husky,
# rimraf, etc.), and the package's `prepare` lifecycle then fails when
# it can't find husky on PATH.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./

# --ignore-scripts skips lifecycle hooks (the `prepare` hook runs husky
# to set up git hooks, which is meaningless inside a container — and
# would fail anyway since the container isn't a git checkout).
RUN npm ci --ignore-scripts

COPY . .

RUN npm run build:release

EXPOSE 3600

# dumb-init reaps zombie Chromium processes when Puppeteer crashes
# mid-scrape — without it, leaked child PIDs can accumulate over time.
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
