/**
 * Fetch actual BLM polygon geometry for all DSU-referenced sections.
 * Outputs blm_section_polygons.json with STR → array of ring coordinates.
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

// Group by township
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
  if (!data.features) return {};

  const results = {};
  data.features.forEach(f => {
    const secNum = parseInt(f.attributes.FRSTDIVNO, 10);
    const secInfo = sections.find(s => parseInt(s.sec) === secNum);
    if (!secInfo) return;

    const key = `${secInfo.sec}-${secInfo.twpNum}N-${secInfo.rngNum}W`;
    // Store rings as [[lat, lng], ...] for Leaflet (BLM returns [lng, lat])
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
  const allPolygons = {};
  const entries = [...twpSections.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [plssid, sections] = entries[i];
    process.stdout.write(`[${i+1}/${entries.length}] ${plssid} (${sections.length})... `);
    try {
      const polys = await fetchTownship(plssid, sections);
      Object.assign(allPolygons, polys);
      console.log(`${Object.keys(polys).length} ok`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
    if (i < entries.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nFetched polygons for ${Object.keys(allPolygons).length} / ${strs.size} sections`);
  fs.writeFileSync('blm_section_polygons.json', JSON.stringify(allPolygons));
  console.log('Saved to blm_section_polygons.json');
}

main().catch(e => { console.error(e); process.exit(1); });
