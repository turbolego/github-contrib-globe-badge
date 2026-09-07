# cobe‑github‑profile‑badge

A **dynamic** badge that can be placed in any GitHub profile `README.md`. It visualises **where the owners of the repositories you contribute to are located**, using the tiny‑dependency globe from [shuding/cobe](https://github.com/shuding/cobe).

## How it works
1. **GitHub API** – searches commits authored by the badge owner (since 2023) to collect the set of repositories you have contributed to.
2. **Owner lookup** – for each distinct repository owner, the public `location` field from the GitHub user profile is fetched.
3. **Geocoding** – free OSM Nominatim turns the location string into latitude/longitude.
4. **cobe + canvas** – the lat/lon pairs become markers on a static globe rendered to an SVG.
5. **GitHub Actions** – a daily workflow regenerates `badge.svg` and pushes it back to the repository.

> The badge updates automatically **once per day**; no Vercel or external hosting required.

## Adding the badge to your profile
Add the following markdown line to your GitHub profile README (replace `turbolego` with your GitHub username if you fork the repo):

```markdown
![My contributions badge](https://raw.githubusercontent.com/turbolego/cobe-github-profile-badge/main/badge.svg)
```

The image will render directly in the README and will refresh each day after the Action runs.

## Repository layout
```
.
├─ badge/                     # badge generator (node script)
│   └─ generate-badge.js       # builds badge.svg
├─ .github/workflows/          # GitHub Action to update badge
│   └─ badge-update.yml
├─ website/                    # original cobe website (unchanged)
├─ package.json                # root dependencies (cobe, canvas, node‑fetch)
└─ README.md                   # this file
```

## Customising the badge
* **Size** – edit `size` in `badge/generate-badge.js` (default = 520 px).
* **Marker colour** – adjust `markerColor` in the globe options.
* **Date range** – change the `author-date:>2023-01-01` filter in the commit‑search query.

---
### Development
```bash
# install root deps (cobe, canvas, node-fetch)
npm ci
# generate badge locally (writes badge.svg)
node badge/generate-badge.js
```

The `badge.svg` can be committed and pushed manually, but the Action will keep it up‑to‑date automatically.

---
### License
MIT – see LICENSE file.
