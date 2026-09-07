# Base44 dev environment

## What this app is
A static site: `index.html` loads `data.json` (already committed) and renders an
interactive Cobe globe in the browser. `badge.gif` is a pre-generated animated
badge (rotating globe). `badge/generate-badge.js` is an offline Node script that
regenerates both files from the GitHub API — it is NOT needed to view the site.

## Running it
`docker compose -f docker-compose.base44.yml up -d` serves the repo root on
host port 3000 via `python -m http.server`. No build step, no dependencies.

## Why python http.server (not nginx)
The repo root directory is mode 0700 (owner root only). nginx's worker runs as
a non-root user and gets 403. `http.server` runs as root inside the container,
so it can read the bind-mounted source.

## Secrets
None required to view the site. The badge generator optionally uses
`GITHUB_ACTOR` and `GITHUB_TOKEN` env vars, but only for regenerating data —
the committed `data.json` is what the preview renders.

## Badge generator dependencies
`badge/generate-badge.js` uses `canvas` (node-canvas) and `gif-encoder-2` to
render an animated rotating GIF. The GitHub Actions workflow installs the
system libraries canvas needs (libcairo2, libpango, libjpeg, libgif,
librsvg2). Running the generator locally requires the same system deps.

## Verifying
`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/data.json`
should return 200. The globe renders client-side from `data.json` (imports
Cobe from jsDelivr CDN).
