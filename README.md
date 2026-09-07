# cobe-github-profile-badge

A daily-updating GitHub contribution analytics badge showing where the owners of repositories you contribute to are located. Click the badge to open an **interactive Cobe globe** on GitHub Pages.

[![My contributions badge](https://raw.githubusercontent.com/turbolego/cobe-github-profile-badge/main/badge.svg)](https://turbolego.github.io/cobe-github-profile-badge/)

## What it shows

The static SVG badge shows a dotted world map, contribution-location markers, commit counts, and each location's percentage of tracked contributions. Clicking the badge opens the interactive version, where the globe can be dragged and zoomed. The interactive globe uses the same daily-generated `data.json` as the badge and displays the Cobe world map with live marker labels.

## How it works

1. GitHub Actions searches commits authored by the configured GitHub user since 2023 and groups them by repository owner.
2. The generator looks up each owner's public GitHub profile location and geocodes it with OpenStreetMap Nominatim.
3. The generator writes `badge.svg` for the static profile badge and `data.json` for the interactive page.
4. GitHub Pages serves the root `index.html`, which loads Cobe in the browser and renders the interactive globe.
5. A daily workflow regenerates and commits the badge and shared analytics data.

## Adding the badge to a profile README

Use the linked-image Markdown below. Replace `turbolego` with your GitHub username if you fork the repository:

```markdown
[![My contributions badge](https://raw.githubusercontent.com/turbolego/cobe-github-profile-badge/main/badge.svg)](https://turbolego.github.io/cobe-github-profile-badge/)
```

The outer link opens the interactive GitHub Pages globe in a new browser tab when the profile visitor clicks the badge link.

## Repository layout

```text
.
├─ index.html                         # interactive Cobe globe served by GitHub Pages
├─ data.json                          # generated contribution data consumed by index.html
├─ badge.svg                          # generated static profile badge
├─ badge/generate-badge.js            # badge and analytics-data generator
└─ .github/workflows/badge-update.yml # daily generation and commit workflow
```

## Customising

The contribution date range is controlled by the `author-date:>2023-01-01` query in `badge/generate-badge.js`. The interactive page imports Cobe from jsDelivr and can be customised through the globe options and page styles in `index.html`.

## Development

```bash
npm install
GITHUB_ACTOR=turbolego node badge/generate-badge.js
```

The generator writes both `badge.svg` and `data.json`. GitHub Pages is configured to serve the repository's `main` branch root at:

<https://turbolego.github.io/cobe-github-profile-badge/>

## License

MIT
