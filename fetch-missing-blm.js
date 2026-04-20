/**
 * Fetch BLM PLSS polygon geometry for sections that are in SECTION_NMA
 * but missing from blm_section_polygons.json. Merges results into existing file.
 */
const fs = require('fs');
const https = require('https');

const sectionNma = JSON.parse(fs.readFileSync('new_section_nma.json', 'utf8'));
const blmPolygons = JSON.parse(fs.readFileSync('blm_section_polygons.json', 'utf8'));

// Find missing sections
const missing = Object.keys(sectionNma).filter(k => !blmPolygons[k]);
console.log('Missing BLM polygons:', missing.length);
if (missing.length === 0) { console.log('Nothing to fetch.'); process.exit(0); }

// Group by township PLSSID
const twpSections = new Map();
missing.forEach(s => {
  const m = s.match(/(\d+)-(\d+)N-(\d+)W/);
  if (!m) return;
  // Indian Meridian = OK17
  const twp = String(parseInt(m[2]) * 10).padStart(4, '0') + 'N';
  const rng = String(parseInt(m[3]) * 10).padStart(4, '0') + 'W';
  const plssid = `OK17${twp}${rng}0`;
  if (!twpSections.has(plssid)) twpSections.set(plssid, []);
  twpSections.get(plssid).push({ sec: m[1], twpNum: m[2], rngNum: m[3] });
});

console.log('Township groups to fetch:', twpSections.size);

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url.toString(), res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

async function fetchTownship(plssid, sections) {
  const secNums = sections.map(s => s.sec.padStart(2, '0'));
  const secFilter = secNums.map(n => `'${n}'`).join(',');

  const url = new URL('https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query');
  url.searchParams.set('where', `PLSSID='${plssid}' AND FRSTDIVNO IN (${secFilter})`);
  url.searchParams.set('outFields', 'FRSTDIVNO');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'json');
  url.searchParams.set('resultRecordCount', '100');

  const data = await fetchJSON(url);
  if (!data.features) {
    console.log('  No features for', plssid, data.error ? 'Error: ' + JSON.stringify(data.error) : '');
    return {};
  }

  const results = {};
  data.features.forEach(f => {
    const secNum = parseInt(f.attributes.FRSTDIVNO, 10);
    const secInfo = sections.find(s => parseInt(s.sec) === secNum);
    if (!secInfo) return;

    const key = `${secInfo.sec}-${secInfo.twpNum}N-${secInfo.rngNum}W`;
    results[key] = f.geometry.rings.map(ring =>
      ring.map(([lng, lat]) => [
        Math.round(lat * 1e7) / 1e7,
        Math.round(lng * 1e7) / 1e7
      ])
    );
  });
  return results;
}

async function main() {
  const newPolygons = {};
  const entries = [...twpSections.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [plssid, sections] = entries[i];
    console.log(`[${i + 1}/${entries.length}] ${plssid} (${sections.length} sections: ${sections.map(s => s.sec).join(',')})`);

    try {
      const polys = await fetchTownship(plssid, sections);
      Object.assign(newPolygons, polys);
      console.log('  Found:', Object.keys(polys).length);
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // Rate limit
    if (i < entries.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nFetched', Object.keys(newPolygons).length, 'new polygon(s)');

  // Merge into existing
  Object.assign(blmPolygons, newPolygons);
  fs.writeFileSync('blm_section_polygons.json', JSON.stringify(blmPolygons));
  console.log('Updated blm_section_polygons.json:', Object.keys(blmPolygons).length, 'total sections');

  // Also update BLM_SECTION_BOUNDS in index.html
  // Compute bounds for new polygons
  const newBounds = {};
  Object.entries(newPolygons).forEach(([key, rings]) => {
    let south = 90, north = -90, west = 180, east = -180;
    rings.forEach(ring => {
      ring.forEach(([lat, lng]) => {
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
      });
    });
    newBounds[key] = { south, north, west, east };
  });

  // Read and update BLM_SECTION_BOUNDS in HTML
  let html = fs.readFileSync('index.html', 'utf8');
  const boundsStart = html.indexOf('const BLM_SECTION_BOUNDS = {');
  if (boundsStart >= 0) {
    const objStart = html.indexOf('{', boundsStart);
    let depth = 0, objEnd = objStart;
    for (let i = objStart; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { objEnd = i + 1; break; } }
    }
    const existingBounds = JSON.parse(html.substring(objStart, objEnd));
    Object.assign(existingBounds, newBounds);
    html = html.substring(0, objStart) + JSON.stringify(existingBounds) + html.substring(objEnd);
    fs.writeFileSync('index.html', html);
    console.log('Updated BLM_SECTION_BOUNDS in index.html:', Object.keys(existingBounds).length, 'sections');
  }

  // Report still-missing
  const stillMissing = missing.filter(k => !newPolygons[k]);
  if (stillMissing.length) {
    console.log('\nStill missing:', stillMissing.length);
    stillMissing.forEach(s => console.log('  ', s));
  }
}

main().catch(e => console.error(e));
