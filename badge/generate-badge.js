import fs from 'fs';
import https from 'https';

const USER = process.env.GITHUB_ACTOR || 'kveita';
const SIZE = 520;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 238;
const WORLD_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

function fetchJSONOnce(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${url} returned ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function fetchJSON(url, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchJSONOnce(url, headers);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cobe-github-profile-badge',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
}

async function getContributions(user) {
  const counts = new Map();
  let total = 0;

  for (let page = 1; page <= 3; page += 1) {
    const q = encodeURIComponent(`author:${user} author-date:>2023-01-01`);
    let data;
    try {
      data = await fetchJSON(
        `https://api.github.com/search/commits?q=${q}&per_page=100&page=${page}`,
        { ...githubHeaders(), Accept: 'application/vnd.github+json' },
      );
    } catch (error) {
      if (page === 1) throw error;
      console.warn(`Stopping commit pagination at page ${page}: ${error.message}`);
      break;
    }
    const items = data.items || [];
    for (const item of items) {
      const fullName = item.repository?.full_name;
      if (!fullName) continue;
      const owner = fullName.split('/')[0];
      if (owner === user) continue;
      counts.set(owner, (counts.get(owner) || 0) + 1);
      total += 1;
    }
    if (items.length < 100) break;
  }

  return { counts, total };
}

async function getOwnerLocation(owner) {
  const user = await fetchJSON(`https://api.github.com/users/${encodeURIComponent(owner)}`, githubHeaders());
  return user.location || null;
}

async function geocode(location) {
  if (!location) return null;
  const result = await fetchJSON(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`,
    { 'User-Agent': 'cobe-github-profile-badge/1.0' },
  );
  if (!result[0]) return null;
  return [+result[0].lat, +result[0].lon];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return pointInRing(lon, lat, geometry.coordinates[0])
      && !geometry.coordinates.slice(1).some((ring) => pointInRing(lon, lat, ring));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => (
      pointInRing(lon, lat, polygon[0])
      && !polygon.slice(1).some((ring) => pointInRing(lon, lat, ring))
    ));
  }
  return false;
}

function project(lat, lon) {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const centerLon = 0;
  const centerLat = 12 * Math.PI / 180;
  const cosLat = Math.cos(latRad);
  const x = Math.cos(latRad) * Math.sin(lonRad - centerLon);
  const y = Math.cos(centerLat) * Math.sin(latRad) - Math.sin(centerLat) * cosLat * Math.cos(lonRad - centerLon);
  const z = Math.sin(centerLat) * Math.sin(latRad) + Math.cos(centerLat) * cosLat * Math.cos(lonRad - centerLon);
  if (z < 0) return null;
  return [CX + x * RADIUS, CY - y * RADIUS, z];
}

function equirectangularPoint([lon, lat]) {
  return [CX + (lon / 180) * RADIUS, CY - (lat / 90) * RADIUS * 0.5];
}

function ringToPath(ring) {
  return ring.map((coordinate, index) => {
    const [x, y] = equirectangularPoint(coordinate);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

function geometryToPath(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringToPath).join(' ');
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map(ringToPath)).join(' ');
  }
  return '';
}

function buildLandMap(geojson) {
  const features = geojson.features || [];
  const dots = [];
  for (let lat = -84; lat <= 84; lat += 2.8) {
    for (let lon = -180; lon < 180; lon += 2.8) {
      if (!features.some((feature) => pointInGeometry(lon, lat, feature.geometry))) continue;
      const point = project(lat, lon);
      if (point) dots.push(`<circle cx="${point[0].toFixed(1)}" cy="${point[1].toFixed(1)}" r="1.15"/>`);
    }
  }
  return dots.join('');
}

function buildMarker(label, location, commits, percentage) {
  const point = project(...location);
  if (!point) return '';
  const [x, y] = point;
  const boxWidth = 98;
  const boxHeight = 34;
  const boxX = Math.max(8, Math.min(SIZE - boxWidth - 8, x - boxWidth / 2));
  const boxY = Math.max(8, y - 48);
  const safeLabel = label.replace(/[&<>"']/g, '');
  return `<g>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#34d399" stroke="#fff" stroke-width="2"/>
    <rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxWidth}" height="${boxHeight}" rx="7" fill="#171717" opacity=".94"/>
    <text x="${(boxX + 10).toFixed(1)}" y="${(boxY + 22).toFixed(1)}" fill="#fff" font-family="monospace" font-size="16" font-weight="700">${commits}</text>
    <text x="${(boxX + 57).toFixed(1)}" y="${(boxY + 21).toFixed(1)}" fill="#34d399" font-family="monospace" font-size="11">↑ ${percentage}%</text>
    <title>${safeLabel}: ${commits} commits (${percentage}%)</title>
  </g>`;
}

function buildSvg(landDots, markers, total) {
  const markerSvg = markers.map((marker) => buildMarker(
    marker.owner,
    marker.location,
    marker.commits,
    Math.round((marker.commits / total) * 100),
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="GitHub contribution analytics globe">
  <defs>
    <radialGradient id="ocean" cx="42%" cy="35%"><stop offset="0" stop-color="#fff"/><stop offset=".86" stop-color="#f3f4f6"/><stop offset="1" stop-color="#d1d5db"/></radialGradient>
    <filter id="shadow"><feGaussianBlur stdDeviation="5"/></filter>
    <clipPath id="globe-clip"><circle cx="${CX}" cy="${CY}" r="${RADIUS}"/></clipPath>
  </defs>
  <rect width="100%" height="100%" fill="#fff"/>
  <circle cx="${CX + 4}" cy="${CY + 8}" r="${RADIUS}" fill="#9ca3af" opacity=".2" filter="url(#shadow)"/>
  <circle cx="${CX}" cy="${CY}" r="${RADIUS}" fill="url(#ocean)" stroke="#e5e7eb" stroke-width="3"/>
  <g clip-path="url(#globe-clip)" fill="#343a40" opacity=".9">${landDots}</g>
  ${markerSvg}
</svg>`;
}

async function main() {
  const { counts, total } = await getContributions(USER);
  const owners = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`Found ${total} commits across ${counts.size} owners`);
  const markers = [];
  for (const [owner, commits] of owners) {
    const location = await getOwnerLocation(owner).then(geocode);
    console.log(`Located ${owner}: ${location ? location.join(', ') : 'unknown'}`);
    if (location) markers.push({ owner, commits, location });
  }
  const geojson = await fetchJSON(WORLD_GEOJSON_URL, { 'User-Agent': 'cobe-github-profile-badge/1.0' });
  fs.writeFileSync('badge.svg', buildSvg(buildLandMap(geojson), markers, total || 1));
  console.log(`✅ badge.svg written – ${markers.length} locations, ${total} commits`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
