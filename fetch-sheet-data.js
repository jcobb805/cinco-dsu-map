/**
 * Fetch DSU data from Google Sheet and save as local CSVs.
 * Run this before inject-wells.js to get the latest sheet data.
 *
 * Source: https://docs.google.com/spreadsheets/d/1fvUTh86igQfJt3NtNx6CgrfmutFMPevJudyRZ8ci7_g/
 *
 * Tabs fetched:
 *   1. Unit Pivot - All  → sheet_unit_pivot.csv  (numbered units with commentary)
 *   2. (gid=0 main tab)  → sheet_main.csv        (all leases, for A-prefix units)
 *   3. Section Shapefiles Table → sheet_section_nma.csv (section-level NMA)
 */
const https = require('https');
const fs = require('fs');

const SHEET_ID = '1fvUTh86igQfJt3NtNx6CgrfmutFMPevJudyRZ8ci7_g';

const TABS = [
  { name: 'Unit Pivot - All', file: 'sheet_unit_pivot.csv' },
  { name: null, gid: 0, file: 'sheet_main.csv' },  // main tab (gid=0)
  { name: 'Section Shapefiles Table', file: 'sheet_section_nma.csv' },
];

function fetchCSV(tab) {
  return new Promise((resolve, reject) => {
    let url;
    if (tab.name) {
      url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab.name)}`;
    } else {
      url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${tab.gid}`;
    }

    function doFetch(fetchUrl, redirects) {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const mod = fetchUrl.startsWith('https') ? https : require('http');
      mod.get(fetchUrl, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doFetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${tab.file}`));
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          fs.writeFileSync(tab.file, data);
          const lines = data.split('\n').filter(l => l.trim()).length;
          console.log(`  ${tab.file}: ${lines} rows`);
          resolve();
        });
      }).on('error', reject);
    }

    doFetch(url, 0);
  });
}

async function main() {
  console.log('Fetching Google Sheet data...');
  for (const tab of TABS) {
    await fetchCSV(tab);
  }
  console.log('Done. Run: node inject-wells.js');
}

main().catch(e => { console.error(e); process.exit(1); });
