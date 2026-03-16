/**
 * Fetch BLM section bounds for ALL sections in the visible map area
 * (T10N-T17N, R14W-R26W) to use for label positioning.
 * Outputs blm_all_section_bounds.json
 */
const fs = require('fs');
const https = require('https');

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

async function fetchTownship(t, r) {
  const twp = String(t * 10).padStart(4, '0') + 'N';
  const rng = String(r * 10).padStart(4, '0') + 'W';
  const plssid = `OK17${twp}${rng}0`;

  const url = new URL('https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query');
  url.searchParams.set('where', `PLSSID='${plssid}'`);
  url.searchParams.set('outFields', 'FRSTDIVNO');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'json');
  url.searchParams.set('resultRecordCount', '50');

  const data = await fetchJSON(url);
  if (!data.features) return {};

  const results = {};
  data.features.forEach(f => {
    const secNum = parseInt(f.attributes.FRSTDIVNO, 10);
    if (isNaN(secNum) || secNum < 1 || secNum > 36) return;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    f.geometry.rings.forEach(ring => {
      ring.forEach(([lng, lat]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      });
    });

    const key = `${secNum}-${t}N-${r}W`;
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
  const townships = [];
  for (let t = 10; t <= 17; t++) {
    for (let r = 14; r <= 26; r++) {
      townships.push({ t, r });
    }
  }

  for (let i = 0; i < townships.length; i++) {
    const { t, r } = townships[i];
    process.stdout.write(`[${i+1}/${townships.length}] T${t}N R${r}W... `);
    try {
      const bounds = await fetchTownship(t, r);
      const count = Object.keys(bounds).length;
      Object.assign(allBounds, bounds);
      console.log(`${count} sections`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
    if (i < townships.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nTotal: ${Object.keys(allBounds).length} sections`);
  fs.writeFileSync('blm_all_section_bounds.json', JSON.stringify(allBounds));
  console.log('Saved to blm_all_section_bounds.json');
}

main().catch(e => { console.error(e); process.exit(1); });
