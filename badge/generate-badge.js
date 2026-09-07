import fs from 'fs';
import https from 'https';
import { createGlobe } from 'cobe';
import { createCanvas } from 'canvas';

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getContributedRepos(user) {
  const url = `https://api.github.com/search/commits?q=author:${user}+author-date:>2023-01-01&per_page=100`;
  const data = await fetchJSON(url, {
    Accept: 'application/vnd.github.cloak-preview+json',
    'User-Agent': 'cobe-badge-gen',
  });
  const set = new Set();
  for (const item of data.items || []) set.add(item.repository.full_name);
  return [...set];
}

async function getOwnerLocation(owner) {
  const usr = await fetchJSON(`https://api.github.com/users/${owner}`, {
    'User-Agent': 'cobe-badge-gen',
    Accept: 'application/vnd.github+json',
  });
  return usr.location || null;
}

async function geocode(loc) {
  if (!loc) return null;
  const q = encodeURIComponent(loc);
  const res = await fetchJSON(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`,
    { 'User-Agent': 'cobe-badge-gen/1.0' }
  );
  if (!res[0]) return null;
  return [+res[0].lat, +res[0].lon];
}

function buildSvg(markers) {
  const size = 520;
  const canvas = createCanvas(size, size);
  const globe = createGlobe(canvas, {
    devicePixelRatio: 2,
    width: size,
    height: size,
    markers,
    dark: 0,
    baseColor: [0.13, 0.13, 0.13],
    markerColor: [0.9, 0.7, 0.2],
  });
  globe.render();
  const svg = canvas.toBuffer('image/svg+xml').toString();
  globe.destroy();
  return svg;
}

(async () => {
  const USER = process.env.GITHUB_ACTOR || 'kveita';
  const repos = await getContributedRepos(USER);
  const owners = new Set(
    repos.map((r) => r.split('/')[0]).filter((o) => o !== USER)
  );
  const markers = [];
  for (const owner of owners) {
    const loc = await getOwnerLocation(owner);
    const geo = await geocode(loc);
    if (geo) markers.push(geo);
  }
  const svg = buildSvg(markers);
  fs.writeFileSync('badge.svg', svg);
  console.log('\u2705 badge.svg written –', markers.length, 'markers');
})();
