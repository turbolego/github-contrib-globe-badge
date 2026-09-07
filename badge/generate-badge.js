import fs from 'fs';
import https from 'https';

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
  const cx = size / 2;
  const cy = size / 2;
  const radius = 238;
  const project = ([lat, lon]) => [
    cx + (lon / 180) * radius,
    cy - (lat / 90) * radius * 0.5,
  ];
  const markerSvg = markers.map((location) => {
    const [x, y] = project(location);
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5" fill="#e6b233"/>`;
  }).join('');
  const longitudeLines = [-120, -60, 0, 60, 120].map((lon) => {
    const x = cx + (lon / 180) * radius;
    return `<path d="M ${x.toFixed(2)} ${cy - radius * 0.5} Q ${cx} ${cy} ${x.toFixed(2)} ${cy + radius * 0.5}"/>`;
  }).join('');
  const latitudeLines = [-60, -30, 0, 30, 60].map((lat) => {
    const y = cy - (lat / 90) * radius * 0.5;
    return `<ellipse cx="${cx}" cy="${y.toFixed(2)}" rx="${radius}" ry="${(radius * 0.18).toFixed(2)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><radialGradient id="globe"><stop offset="0" stop-color="#3f3f3f"/><stop offset="1" stop-color="#151515"/></radialGradient><clipPath id="clip"><circle cx="${cx}" cy="${cy}" r="${radius}"/></clipPath></defs>
  <rect width="100%" height="100%" fill="#0d1117"/>
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#globe)" stroke="#666" stroke-width="3"/>
  <g clip-path="url(#clip)" fill="none" stroke="#777" stroke-opacity=".38" stroke-width="1">${longitudeLines}${latitudeLines}</g>
  <g>${markerSvg}</g>
</svg>`;
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
  fs.writeFileSync('badge.svg', buildSvg(markers));
  console.log('\u2705 badge.svg written –', markers.length, 'markers');
})();
