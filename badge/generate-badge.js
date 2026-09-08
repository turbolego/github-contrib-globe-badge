import fs from 'fs';
import https from 'https';
import { createCanvas } from 'canvas';
import GIFEncoder from 'gif-encoder-2';

const USER = process.env.GITHUB_ACTOR || 'kveita';
const SIZE = 520;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 238;
const FRAMES = 60;
const FRAME_DELAY = 50; // ms — 60 frames × 50ms = 3s per rotation
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
  // Resolve a repository to its canonical (non-fork) source using the repos
  // API (5000 req/hour limit), NOT the search API (30 req/min) that caused
  // 403 rate-limit errors in the previous per-SHA approach.
  const repoCache = new Map();
  async function resolveRepository(fullName) {
    if (repoCache.has(fullName)) return repoCache.get(fullName);
    try {
      const repo = await fetchJSON(`https://api.github.com/repos/${fullName}`, githubHeaders());
      const resolved = (repo.fork && repo.source?.full_name) ? repo.source.full_name : fullName;
      repoCache.set(fullName, resolved);
      return resolved;
    } catch (error) {
      console.warn(`Could not resolve repository ${fullName}: ${error.message}`);
      repoCache.set(fullName, fullName);
      return fullName;
    }
  }

  const counts = new Map();
  const seenShas = new Set();
  let total = 0;

  for (let page = 1; page <= 3; page += 1) {
    const q = encodeURIComponent(`author:${user} author-date:>2023-01-01 is:public`);
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
      const sha = item.sha;
      if (!fullName || !sha) continue;
      // Deduplicate by SHA — the same commit may appear in both the original
      // repo and its forks. First occurrence wins; fork resolution ensures we
      // attribute it to the original repository regardless of which copy the
      // search returned first.
      if (seenShas.has(sha)) continue;
      seenShas.add(sha);

      const resolvedName = await resolveRepository(fullName);
      const owner = resolvedName.split('/')[0];
      if (owner === user) continue;
      if (!counts.has(owner)) counts.set(owner, { commits: 0, repositories: new Set() });
      const ownerStats = counts.get(owner);
      ownerStats.commits += 1;
      ownerStats.repositories.add(resolvedName);
      total += 1;
      console.log(`Commit ${sha.slice(0, 8)} attributed to ${resolvedName}`);
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

function landPolygons(geojson) {
  const polygons = [];
  for (const feature of geojson.features || []) {
    const geometry = feature.geometry;
    const groups = geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const polygon of groups) {
      const ring = polygon[0];
      const lons = ring.map(([lon]) => lon);
      const lats = ring.map(([, lat]) => lat);
      polygons.push({
        polygon,
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons),
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
      });
    }
  }
  return polygons;
}

// Orthographic projection — centerLonDeg rotates the globe for animation.
function project(lat, lon, centerLonDeg = 0) {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const centerLon = (centerLonDeg * Math.PI) / 180;
  const centerLat = (12 * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const x = Math.cos(latRad) * Math.sin(lonRad - centerLon);
  const y = Math.cos(centerLat) * Math.sin(latRad) - Math.sin(centerLat) * cosLat * Math.cos(lonRad - centerLon);
  const z = Math.sin(centerLat) * Math.sin(latRad) + Math.cos(centerLat) * cosLat * Math.cos(lonRad - centerLon);
  if (z < 0) return null;
  return [CX + x * RADIUS, CY - y * RADIUS, z];
}

// Precompute which grid points are land — independent of rotation angle.
function computeLandGrid(geojson) {
  const polygons = landPolygons(geojson);
  const grid = [];
  for (let lat = -84; lat <= 84; lat += 2.8) {
    for (let lon = -180; lon < 180; lon += 2.8) {
      const land = polygons.some(({ polygon, minLon, maxLon, minLat, maxLat }) => (
        lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
        && pointInRing(lon, lat, polygon[0])
        && !polygon.slice(1).some((ring) => pointInRing(lon, lat, ring))
      ));
      if (land) grid.push([lat, lon]);
    }
  }
  return grid;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderFrame(ctx, centerLonDeg, landGrid, markers, total) {
  // Background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Shadow
  ctx.fillStyle = 'rgba(156, 163, 175, 0.2)';
  ctx.beginPath();
  ctx.arc(CX + 4, CY + 8, RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Ocean
  const grad = ctx.createRadialGradient(
    CX - RADIUS * 0.08, CY - RADIUS * 0.15, 0,
    CX, CY, RADIUS,
  );
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.86, '#f3f4f6');
  grad.addColorStop(1, '#d1d5db');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Land dots (clipped to globe)
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#343a40';
  ctx.globalAlpha = 0.9;
  for (const [lat, lon] of landGrid) {
    const p = project(lat, lon, centerLonDeg);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Markers — fade near the globe edge for smooth rotation
  for (const marker of markers) {
    const p = project(marker.location[0], marker.location[1], centerLonDeg);
    if (!p) continue;
    const [x, y, z] = p;
    const opacity = Math.min(1, z * 2.5);
    if (opacity <= 0) continue;
    const percentage = Math.round((marker.commits / total) * 100);

    ctx.globalAlpha = opacity;

    // Marker dot
    ctx.fillStyle = '#34d399';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Label box
    const boxWidth = 98;
    const boxHeight = 34;
    const boxX = Math.max(8, Math.min(SIZE - boxWidth - 8, x - boxWidth / 2));
    const boxY = Math.max(8, y - 48);

    ctx.fillStyle = 'rgba(23, 23, 23, 0.94)';
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 7);
    ctx.fill();

    // Commit count
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(String(marker.commits), boxX + 10, boxY + boxHeight / 2);

    // Percentage
    ctx.fillStyle = '#34d399';
    ctx.font = '11px monospace';
    ctx.fillText(`↑ ${percentage}%`, boxX + 57, boxY + boxHeight / 2 - 1);

    ctx.globalAlpha = 1;
  }
}

async function main() {
  const { counts, total } = await getContributions(USER);
  const owners = [...counts.entries()].sort((a, b) => b[1].commits - a[1].commits).slice(0, 8);
  console.log(`Found ${total} commits across ${counts.size} owners`);
  const markers = [];
  for (const [owner, stats] of owners) {
    const location = await getOwnerLocation(owner).then(geocode);
    console.log(`Located ${owner}: ${location ? location.join(', ') : 'unknown'}`);
    if (location) markers.push({
      owner,
      commits: stats.commits,
      location,
      repositories: [...stats.repositories].sort().map((fullName) => ({
        name: fullName.split('/').slice(1).join('/'),
        url: `https://github.com/${fullName}`,
      })),
    });
  }
  const geojson = await fetchJSON(WORLD_GEOJSON_URL, { 'User-Agent': 'cobe-github-profile-badge/1.0' });
  fs.writeFileSync('data.json', JSON.stringify({
    user: USER,
    generatedAt: new Date().toISOString(),
    totalCommits: total,
    markers,
  }, null, 2));

  // Render animated GIF — globe rotates one full turn seamlessly.
  const landGrid = computeLandGrid(geojson);
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const encoder = new GIFEncoder(SIZE, SIZE);
  encoder.setDelay(FRAME_DELAY);
  encoder.setRepeat(0); // loop forever
  encoder.setQuality(10);
  encoder.start();
  for (let i = 0; i < FRAMES; i += 1) {
    const angle = (360 / FRAMES) * i;
    renderFrame(ctx, angle, landGrid, markers, total || 1);
    encoder.addFrame(ctx);
  }
  encoder.finish();
  fs.writeFileSync('badge.gif', Buffer.from(encoder.out.getData()));
  console.log(`✅ badge.gif written – ${markers.length} locations, ${total} commits, ${FRAMES} frames`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
