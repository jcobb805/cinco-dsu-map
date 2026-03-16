/**
 * Fetch actual BLM PLSS section boundaries for all sections referenced
 * by DSU_DATA. Outputs blm_section_bounds.json mapping STR → bounding box.
 */
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const html = execSync('git show be57c5a:index.html', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

// Extract all STR references
const strs = new Set();
const re = /(\d+)-(\d+)N-(\d+)W/g;
let m;
while ((m = re.exec(html)) !== null) strs.add(m[0]);

// Group by township PLSSID
const twpSections = new Map();
strs.forEach(s => {
  const m2 = s.match(/(\d+)-(\d+)N-(\d+)W/);
  if (!m2) return;
  const twp = String(parseInt(m2[2]) * 10).padStart(4, '0') + 'N';
  const rng = String(parseInt(m2[3]) * 10).padStart(4, '0') + 'W';
  const plssid = `OK17${twp}${rng}0`;
  if (!twpSections.has(plssid)) twpSections.set(plssid, []);
  twpSections.get(plssid).push({ sec: m2[1], twpNum: m2[2], rngNum: m2[3] });
});

function fetchJSON(urlObj) {
  return new Promise((resolve, reject) => {
    https.get(urlObj.toString(), res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

async function fetchTownshipSections(plssid, sections) {
  const secNums = sections.map(s => s.sec.padStart(2, '0'));
  const secFilter = secNums.map(n => `'${n}'`).join(',');

  const url = new URL('https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query');
  url.searchParams.set('where', `PLSSID='${plssid}' AND FRSTDIVNO IN (${secFilter})`);
  url.searchParams.set('outFields', 'FRSTDIVNO,PLSSID');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'json');
  url.searchParams.set('resultRecordCount', '100');

  const data = await fetchJSON(url);
  console.log('  Response features:', data.features ? data.features.length : 'NONE', data.error ? 'Error: ' + JSON.stringify(data.error) : '');
  if (!data.features || data.features.length === 0) {
    if (data.features && data.features.length === 0) {
      // Debug: show the URL
      console.log('  URL:', url.toString().slice(0, 200));
    }
    return {};
  }

  const results = {};
  data.features.forEach(f => {
    const secNum = parseInt(f.attributes.FRSTDIVNO, 10);
    const secInfo = sections.find(s => parseInt(s.sec) === secNum);
    if (!secInfo) return;

    // Compute bounding box from polygon rings
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    f.geometry.rings.forEach(ring => {
      ring.forEach(([lng, lat]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      });
    });

    const key = `${secInfo.sec}-${secInfo.twpNum}N-${secInfo.rngNum}W`;
    results[key] = {
      south: Math.round(minLat * 1e7) / 1e7,
      north: Math.round(maxLat * 1e7) / 1e7,
      west: Math.round(minLng * 1e7) / 1e7,
      east: Math.round(maxLng * 1e7) / 1e7,
    };
  });
  return results;
}

async function main() {
  const allBounds = {};
  const entries = [...twpSections.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [plssid, sections] = entries[i];
    console.log(`[${i+1}/${entries.length}] Fetching ${plssid} (${sections.length} sections)...`);
    try {
      const bounds = await fetchTownshipSections(plssid, sections);
      Object.assign(allBounds, bounds);
      console.log(`  Got ${Object.keys(bounds).length} sections`);
    } catch (e) {
      console.error('  Error:', e.message);
    }
    if (i < entries.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nFetched bounds for ${Object.keys(allBounds).length} / ${strs.size} sections`);
  fs.writeFileSync('blm_section_bounds.json', JSON.stringify(allBounds, null, 2));
  console.log('Saved to blm_section_bounds.json');
}

main().catch(e => { console.error(e); process.exit(1); });
