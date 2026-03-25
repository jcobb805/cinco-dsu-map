/**
 * Inject Enverus well laterals, active permits, rig markers,
 * formation toggles, and time bucket slicer into the DSU map.
 *
 * Starts from the clean pre-injection base (be57c5a) every time.
 */
const fs = require('fs');
const { execSync } = require('child_process');

// Always start from the clean base
let html = execSync('git show be57c5a:index.html', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

// Inject esri-leaflet script after leaflet.js
html = html.replace(
  '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
  '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>\n<script src="https://unpkg.com/esri-leaflet@3.0.12/dist/esri-leaflet.js"></script>'
);

const wellData = JSON.parse(fs.readFileSync('wells_map_data.json', 'utf8'));
const rigData = JSON.parse(fs.readFileSync('rigs_map_data.json', 'utf8'));
const permitData = JSON.parse(fs.readFileSync('permits_map_data.json', 'utf8'));

// ── 0. Replace single basemap with Dark/Topo/Satellite toggle ──
const oldBasemap = `L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd', maxZoom: 19,
}).addTo(map);`;

const newBasemap = `// Multiple basemaps — Dark + Topo + Satellite
var darkBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19
});
var topoBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri', maxZoom: 19
});
var satBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri', maxZoom: 19
});
var voyagerBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19
});
voyagerBase.addTo(map);
// Layer control will be created after BLM PLSS layer is defined
var _baseMaps = { 'Map': voyagerBase, 'Dark': darkBase, 'Topo': topoBase, 'Satellite': satBase };`;

html = html.replace(oldBasemap, newBasemap);

// ── 0a. Add new DSU units and update changed units ──
// New units
const newDSUs = [
  `{ unit:"28", nma:68.4, wi:0.05344, nri:0.04168, operator:"CRAWLEY", type:"Non-Op", north:"11-13N-23W", middle:"", south:"14-13N-23W", unitSize:1280 }`,
  `{ unit:"522", nma:284.7, wi:0.14829, nri:0.11912, operator:"ANTHEM", type:"Potential Drillable", north:"1-14N-17W", middle:"12-14N-17W", south:"13-14N-17W", unitSize:1920 }`,
  `{ unit:"A40", nma:666.7, wi:0.52083, nri:0.41667, operator:"DEH_Cinco", type:"Potential Drillable", north:"26-17N-20W", middle:"", south:"35-17N-20W", unitSize:1280 }`,
];
const dsuInsert = newDSUs.map(d => '  ' + d + ',').join('\n');
html = html.replace('];\n\n// ═══════════════════════════════════════════════════════════════════════\n// PLSS Grid', dsuInsert + '\n];\n\n// ═══════════════════════════════════════════════════════════════════════\n// PLSS Grid');

// Updated units — NMA/WI/NRI changes from sheet
html = html.replace('unit:"1075", nma:626.3, wi:0.48929, nri:0.38717', 'unit:"1075", nma:643.8, wi:0.50294, nri:0.39827');
html = html.replace('unit:"902", nma:604.4, wi:0.47222, nri:0.37778', 'unit:"902", nma:641.1, wi:0.50086, nri:0.40069');
html = html.replace('unit:"1080", nma:560.2, wi:0.43768, nri:0.34964', 'unit:"1080", nma:573.6, wi:0.44810, nri:0.35798');
html = html.replace('unit:"648", nma:353.7, wi:0.27631, nri:0.22235', 'unit:"648", nma:391.4, wi:0.30580, nri:0.24594');
html = html.replace('unit:"1117", nma:156.7, wi:0.12239, nri:0.09358', 'unit:"1117", nma:136.0, wi:0.10625, nri:0.08124');
html = html.replace('unit:"A32", nma:91.1, wi:0.04743, nri:0.03742', 'unit:"A32", nma:22.7, wi:0.01180, nri:0.00964');
// Unit 638 type change
html = html.replace('unit:"638", nma:240.0, wi:0.18750, nri:0.15000, operator:"OSTRICH", type:"Potential Drillable"', 'unit:"638", nma:240.0, wi:0.18750, nri:0.15000, operator:"OSTRICH", type:"Non-Op"');

// ── 0b. Replace computed PLSS grid with BLM official PLSS tile overlay ──
// Remove the entire computed grid section and replace with BLM WMS layer
const oldGridBlock = `// ═══════════════════════════════════════════════════════════════════════
// PLSS Grid Overlay — Township, Range & Section Labels
// ═══════════════════════════════════════════════════════════════════════
const gridLayer = L.layerGroup().addTo(map);
const sectionLabelLayer = L.layerGroup(); // added at higher zoom

// Collect all referenced townships from the data
const referencedTwps = new Set();
DSU_DATA.forEach(dsu => {
  [dsu.north, dsu.middle, dsu.south].forEach(str => {
    const p = parseSectionTownshipRange(str);
    if (p) referencedTwps.add(\`\${p.township}\${p.twpDir}-\${p.range}\${p.rngDir}\`);
  });
});

// Build grid only for referenced townships (no buffer)
const twpSet = referencedTwps;

twpSet.forEach(key => {
  const m = key.match(/^(\\d+)N-(\\d+)W$/);
  if (!m) return;
  const t = +m[1], r = +m[2];
  if (t < 1 || r < 1) return;

  const midLat = INDIAN_MERIDIAN.lat + t * TWP_MILES / MI_PER_DEG_LAT;
  const miPerDegLng = MI_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180);
  const twpSouthLat = INDIAN_MERIDIAN.lat + (t - 1) * TWP_MILES / MI_PER_DEG_LAT;
  const twpNorthLat = INDIAN_MERIDIAN.lat + t * TWP_MILES / MI_PER_DEG_LAT;
  const twpWestLng  = INDIAN_MERIDIAN.lng - r * TWP_MILES / miPerDegLng;
  const twpEastLng  = INDIAN_MERIDIAN.lng - (r - 1) * TWP_MILES / miPerDegLng;

  // Township boundary (heavier line)
  gridLayer.addLayer(L.rectangle([[twpSouthLat, twpWestLng], [twpNorthLat, twpEastLng]], {
    color: '#b0b8c1', weight: 1.5, opacity: 0.6, fill: false, interactive: false
  }));

  // Township label at center
  const twpCenterLat = (twpSouthLat + twpNorthLat) / 2;
  const twpCenterLng = (twpWestLng + twpEastLng) / 2;
  gridLayer.addLayer(L.marker([twpCenterLat, twpCenterLng], {
    icon: L.divIcon({
      className: '',
      html: \`<div style="color:#b0b8c1;font-size:11px;font-weight:600;white-space:nowrap;text-align:center;pointer-events:none;">T\${t}N R\${r}W</div>\`,
      iconSize: [80, 14], iconAnchor: [40, 14]
    }),
    interactive: false
  }));

  // Section grid lines and labels
  for (let sec = 1; sec <= 36; sec++) {
    const { row, col } = sectionToRowCol(sec);
    const secNLat = twpSouthLat + (6 - row) * SEC_MILES / MI_PER_DEG_LAT;
    const secSLat = twpSouthLat + (5 - row) * SEC_MILES / MI_PER_DEG_LAT;
    const secWLng = twpWestLng + col * SEC_MILES / miPerDegLng;
    const secELng = twpWestLng + (col + 1) * SEC_MILES / miPerDegLng;

    // Section boundary (lighter line)
    sectionLabelLayer.addLayer(L.rectangle([[secSLat, secWLng], [secNLat, secELng]], {
      color: '#c8cfd6', weight: 0.7, opacity: 0.5, fill: false, interactive: false
    }));

    // Section number label
    const secCLat = (secNLat + secSLat) / 2;
    const secCLng = (secWLng + secELng) / 2;
    sectionLabelLayer.addLayer(L.marker([secCLat, secCLng], {
      icon: L.divIcon({
        className: '',
        html: \`<div style="color:#c0c8d0;font-size:9px;font-weight:400;text-align:center;pointer-events:none;">\${sec}</div>\`,
        iconSize: [20, 12], iconAnchor: [10, 6]
      }),
      interactive: false
    }));
  }
});

// Show section detail only when zoomed in enough
function updateGridVisibility() {
  const z = map.getZoom();
  if (z >= 11 && !map.hasLayer(sectionLabelLayer)) {
    sectionLabelLayer.addTo(map);
  } else if (z < 11 && map.hasLayer(sectionLabelLayer)) {
    map.removeLayer(sectionLabelLayer);
  }
}
map.on('zoomend', updateGridVisibility);
updateGridVisibility();`;

const newGridBlock = `// ═══════════════════════════════════════════════════════════════════════
// PLSS Grid Overlay — BLM Official Survey via esri-leaflet
// ═══════════════════════════════════════════════════════════════════════
var blmPLSS = L.esri.dynamicMapLayer({
  url: 'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer',
  layers: [1, 2],
  opacity: 0.6,
  bboxSR: 4326,
  imageSR: 4326,
  dynamicLayers: [
    {id:1, source:{type:'mapLayer',mapLayerId:1}, drawingInfo:{renderer:{type:'simple',symbol:{type:'esriSFS',style:'esriSFSNull',outline:{type:'esriSLS',style:'esriSLSSolid',color:[140,150,160,160],width:1.5}}},showLabels:false}},
    {id:2, source:{type:'mapLayer',mapLayerId:2}, drawingInfo:{renderer:{type:'simple',symbol:{type:'esriSFS',style:'esriSFSNull',outline:{type:'esriSLS',style:'esriSLSSolid',color:[190,200,210,130],width:0.7}}},showLabels:false}}
  ]
}).addTo(map);

L.control.layers(
  _baseMaps,
  { 'PLSS Grid (BLM)': blmPLSS },
  { position: 'topright' }
).addTo(map);

// ── PLSS Labels (positioned using BLM actual survey bounds) ──
var twpLabelLayer = L.layerGroup().addTo(map);
var secLabelLayer = L.layerGroup();

(function() {
  for (var t = 10; t <= 17; t++) {
    for (var r = 14; r <= 26; r++) {
      // Compute township bounds from section 1 and section 36 BLM data
      var sec1Key = '1-' + t + 'N-' + r + 'W';
      var sec36Key = '36-' + t + 'N-' + r + 'W';
      var s1 = BLM_SECTION_BOUNDS[sec1Key];
      var s36 = BLM_SECTION_BOUNDS[sec36Key];
      if (!s1 || !s36) continue; // skip if no BLM data for this township

      // Township extents from corners (sec 1 = NE corner, sec 36 = SE corner)
      var twpNorth = s1.north;
      var twpSouth = s36.south;
      var twpWest = s1.west; // sec 1 is col 5 (east), need sec 6 for west
      var sec6Key = '6-' + t + 'N-' + r + 'W';
      var s6 = BLM_SECTION_BOUNDS[sec6Key];
      if (s6) twpWest = s6.west;
      var twpEast = s36.east; // sec 36 is col 5 (east)

      // Township label at center
      var twpCLat = (twpNorth + twpSouth) / 2;
      var twpCLng = (twpWest + twpEast) / 2;
      twpLabelLayer.addLayer(L.marker([twpCLat, twpCLng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="color:#8b949e;font-size:11px;font-weight:600;white-space:nowrap;text-align:center;pointer-events:none;opacity:0.7;">T' + t + 'N R' + r + 'W</div>',
          iconSize: [80, 14], iconAnchor: [40, 7]
        }),
        interactive: false
      }));

      // Section labels — use BLM bounds for each section
      for (var sec = 1; sec <= 36; sec++) {
        var secKey = sec + '-' + t + 'N-' + r + 'W';
        var sb = BLM_SECTION_BOUNDS[secKey];
        if (!sb) continue;
        var secCLat = (sb.north + sb.south) / 2;
        var secCLng = (sb.west + sb.east) / 2;
        secLabelLayer.addLayer(L.marker([secCLat, secCLng], {
          icon: L.divIcon({
            className: '',
            html: '<div style="color:#a0a8b0;font-size:9px;font-weight:400;text-align:center;pointer-events:none;opacity:0.7;">' + sec + '</div>',
            iconSize: [20, 12], iconAnchor: [10, 6]
          }),
          interactive: false
        }));
      }
    }
  }
})();

function updateLabelVisibility() {
  var z = map.getZoom();
  if (z >= 11 && !map.hasLayer(secLabelLayer)) secLabelLayer.addTo(map);
  else if (z < 11 && map.hasLayer(secLabelLayer)) map.removeLayer(secLabelLayer);
}
map.on('zoomend', updateLabelVisibility);
updateLabelVisibility();`;

html = html.replace(oldGridBlock, newGridBlock);

// ── 0c. Replace DSU polygon rendering with BLM actual survey polygons ──
const blmAllBounds = JSON.parse(fs.readFileSync('blm_all_section_bounds.json', 'utf8'));
const blmPolygons = JSON.parse(fs.readFileSync('blm_section_polygons.json', 'utf8'));

// Inject BLM bounds (for labels) and polygons (for DSU shapes) after PLSS constants
const blmDataJS = `
const BLM_SECTION_BOUNDS = ${JSON.stringify(blmAllBounds)};
const BLM_SECTION_POLYGONS = ${JSON.stringify(blmPolygons)};
`;
html = html.replace(
  'const SEC_MILES = 1;',
  'const SEC_MILES = 1;' + blmDataJS
);

// Replace dsuPolygon to use BLM actual polygon geometry
const oldDsuPolygon = `function dsuPolygon(dsu) {
  const sections = [dsu.north, dsu.middle, dsu.south].filter(s => s && s.length > 0);
  if (sections.length === 0) return null;

  const bounds = sections.map(sectionBounds).filter(Boolean);
  if (bounds.length === 0) return null;

  const north = Math.max(...bounds.map(b => b.north));
  const south = Math.min(...bounds.map(b => b.south));
  const west  = Math.min(...bounds.map(b => b.west));
  const east  = Math.max(...bounds.map(b => b.east));

  return [
    [north, west], [north, east],
    [east !== west ? south : south, east],
    [south, west]
  ];
}`;

const newDsuPolygon = `function dsuPolygon(dsu) {
  const sections = [dsu.north, dsu.middle, dsu.south].filter(s => s && s.length > 0);
  if (sections.length === 0) return null;

  // Try BLM actual polygons first — returns multi-polygon (array of rings)
  const blmRings = [];
  sections.forEach(str => {
    const p = parseSectionTownshipRange(str);
    if (!p) return;
    const key = p.section + '-' + p.township + 'N-' + p.range + 'W';
    if (BLM_SECTION_POLYGONS[key]) {
      BLM_SECTION_POLYGONS[key].forEach(ring => blmRings.push(ring));
    }
  });
  if (blmRings.length > 0) return blmRings;

  // Fallback to computed bounding box
  const bounds = sections.map(sectionBounds).filter(Boolean);
  if (bounds.length === 0) return null;
  const north = Math.max(...bounds.map(b => b.north));
  const south = Math.min(...bounds.map(b => b.south));
  const west  = Math.min(...bounds.map(b => b.west));
  const east  = Math.max(...bounds.map(b => b.east));
  return [[ [north, west], [north, east], [south, east], [south, west] ]];
}`;

html = html.replace(oldDsuPolygon, newDsuPolygon);

// ── 1. CSS ──
const newCSS = `
  /* ── Well & Rig Layer Controls ─────────────────────────── */
  #well-slicer { position: absolute; right: 194px; top: 12px; z-index: 1000; background: rgba(255,255,255,0.95);
    border-radius: 8px; border: 1px solid #d1d9e0; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 10px 12px;
    width: 185px; max-height: calc(100vh - 24px); overflow-y: auto; font-size: 11px; }
  #well-slicer::-webkit-scrollbar { width: 4px; }
  #well-slicer::-webkit-scrollbar-thumb { background: #d1d9e0; border-radius: 2px; }
  #well-slicer h4 { font-size: 11px; color: #656d76; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .well-slicer-section { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #e8ecf0; }
  .well-slicer-section:last-of-type { border-bottom: none; }
  .well-slicer-section h5 { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
  .well-toggle { display: flex; align-items: center; gap: 6px; padding: 3px 6px; margin-bottom: 2px;
    font-size: 11px; color: #1f2328; cursor: pointer; border-radius: 4px; transition: background 0.15s; user-select: none; }
  .well-toggle:hover { background: #eef1f5; }
  .well-toggle input[type="checkbox"] { margin: 0; accent-color: #0969da; flex-shrink: 0; }
  .well-toggle .swatch-line { display: inline-block; width: 16px; height: 0; border-top: 2.5px solid; flex-shrink: 0; }
  .well-toggle .swatch-line.dashed { border-top-style: dashed; }
  .well-toggle .count { color: #8b949e; font-size: 10px; margin-left: auto; }
`;

html = html.replace('</style>', newCSS + '\n</style>');

// ── 2. HTML: Place slicer panel INSIDE the rank-slicer area (after rank-slicer-potential, before map div) ──
const slicerHTML = `
  <!-- Well & Rig Layer Slicer -->
  <div id="well-slicer">
    <h4>Enverus Wells &amp; Rigs</h4>

    <div class="well-slicer-section">
      <h5>Formation</h5>
      <div id="formation-toggles"></div>
    </div>

    <div class="well-slicer-section">
      <h5>Completion Year</h5>
      <div id="time-toggles"></div>
    </div>

    <div class="well-slicer-section">
      <h5>Layers</h5>
      <label class="well-toggle" style="font-weight:500;">
        <input type="checkbox" id="well-layer-toggle" checked>
        <span class="swatch-line" style="border-color:#1f2328;"></span>
        Completed Wells
        <span class="count" id="well-count-completed">0</span>
      </label>
      <label class="well-toggle" style="font-weight:500;">
        <input type="checkbox" id="duc-layer-toggle" checked>
        <span class="swatch-line dashed" style="border-color:#e63946;"></span>
        DUCs
        <span class="count" id="well-count-duc">0</span>
      </label>
      <label class="well-toggle" style="font-weight:500;">
        <input type="checkbox" id="permit-layer-toggle" checked>
        <span class="swatch-line dashed" style="border-color:#f4a261;"></span>
        Active Permits
        <span class="count" id="permit-count">0</span>
      </label>
      <label class="well-toggle" style="font-weight:500;">
        <input type="checkbox" id="rig-layer-toggle" checked>
        <svg width="12" height="14" viewBox="0 0 18 22" style="flex-shrink:0;"><polygon points="9,0 3,18 15,18" fill="none" stroke="#000" stroke-width="2"/><line x1="9" y1="0" x2="9" y2="18" stroke="#000" stroke-width="1.5"/><rect x="2" y="18" width="14" height="3" fill="#000" rx="1"/></svg>
        Active Rigs
        <span class="count">${rigData.length}</span>
      </label>
    </div>

    <div style="padding-top:4px;">
      <span style="font-size:10px;color:#8b949e;">Total visible: <b id="well-count-total">0</b></span>
    </div>
  </div>
`;

// Insert right before the map div (alongside rank slicers, inside #app)
html = html.replace('  <!-- Map -->\n  <div id="map"></div>', slicerHTML + '\n  <!-- Map -->\n  <div id="map"></div>');

// ── 3. JavaScript ──
const mainJS = `

// ═══════════════════════════════════════════════════════════════════════
// Enverus Well Laterals, Permits & Rig Markers
// ═══════════════════════════════════════════════════════════════════════
var WELL_DATA = ${JSON.stringify(wellData)};
var RIG_DATA = ${JSON.stringify(rigData)};
var PERMIT_DATA = ${JSON.stringify(permitData)};

var FORMATION_COLORS = {
  'Red Fork':      '#e63946',
  'Cherokee':      '#457b9d',
  'Skinner':       '#2a9d8f',
  'Cleveland':     '#e9c46a',
  'Oswego':        '#f4a261',
  'Tonkawa':       '#6a4c93',
  'Cottage Grove': '#1d3557',
  'Other':         '#adb5bd',
};

var TIME_BUCKETS_ORDER = ['2026','2025','2024','2023','2022','2021','2020','2010s','2000s','Pre-2000'];

// Layer groups
var wellLayerGroup = L.layerGroup().addTo(map);
var ducLayerGroup = L.layerGroup().addTo(map);
var permitLayerGroup = L.layerGroup().addTo(map);
var rigLayerGroup = L.layerGroup().addTo(map);

// Filter state
var activeFormations = new Set(Object.keys(FORMATION_COLORS));
var activeTimeBuckets = new Set(TIME_BUCKETS_ORDER);

// Counts
var fgCounts = {}, tbCounts = {}, ducFgCounts = {}, permitFgCounts = {};
WELL_DATA.forEach(function(w) {
  if (w.tb !== 'DUC') {
    fgCounts[w.fg] = (fgCounts[w.fg] || 0) + 1;
    tbCounts[w.tb] = (tbCounts[w.tb] || 0) + 1;
  } else {
    ducFgCounts[w.fg] = (ducFgCounts[w.fg] || 0) + 1;
  }
});
PERMIT_DATA.forEach(function(p) { permitFgCounts[p.fg] = (permitFgCounts[p.fg] || 0) + 1; });

var allFgCounts = {};
Object.keys(FORMATION_COLORS).forEach(function(fg) {
  var total = (fgCounts[fg]||0) + (ducFgCounts[fg]||0) + (permitFgCounts[fg]||0);
  if (total > 0) allFgCounts[fg] = total;
});

// Build formation toggles
(function() {
  var container = document.getElementById('formation-toggles');
  var groups = ['Red Fork','Cherokee','Cleveland','Tonkawa','Cottage Grove','Skinner','Oswego','Other'];
  groups.forEach(function(fg) {
    if (!allFgCounts[fg]) return;
    var color = FORMATION_COLORS[fg];
    var label = document.createElement('label');
    label.className = 'well-toggle';
    label.innerHTML = '<input type="checkbox" checked data-fg="' + fg + '"> <span class="swatch-line" style="border-color:' + color + ';"></span> ' + fg + ' <span class="count">' + allFgCounts[fg] + '</span>';
    label.querySelector('input').addEventListener('change', function() {
      if (this.checked) activeFormations.add(fg);
      else activeFormations.delete(fg);
      renderAll();
    });
    container.appendChild(label);
  });
})();

// Build time bucket toggles
(function() {
  var container = document.getElementById('time-toggles');
  TIME_BUCKETS_ORDER.forEach(function(tb) {
    var ct = tbCounts[tb] || 0;
    if (ct === 0) return;
    var label = document.createElement('label');
    label.className = 'well-toggle';
    label.innerHTML = '<input type="checkbox" checked data-tb="' + tb + '"> ' + tb + ' <span class="count">' + ct + '</span>';
    label.querySelector('input').addEventListener('change', function() {
      if (this.checked) activeTimeBuckets.add(tb);
      else activeTimeBuckets.delete(tb);
      renderAll();
    });
    container.appendChild(label);
  });
})();

// Layer toggles
document.getElementById('well-layer-toggle').addEventListener('change', function() {
  if (this.checked) wellLayerGroup.addTo(map); else map.removeLayer(wellLayerGroup);
});
document.getElementById('duc-layer-toggle').addEventListener('change', function() {
  if (this.checked) ducLayerGroup.addTo(map); else map.removeLayer(ducLayerGroup);
});
document.getElementById('permit-layer-toggle').addEventListener('change', function() {
  if (this.checked) permitLayerGroup.addTo(map); else map.removeLayer(permitLayerGroup);
});
document.getElementById('rig-layer-toggle').addEventListener('change', function() {
  if (this.checked) rigLayerGroup.addTo(map); else map.removeLayer(rigLayerGroup);
});

// Tooltip builders
function wellTooltip(w) {
  var completionStr = w.cd ? w.cd : (w.tb === 'DUC' ? 'DUC (Spud: ' + w.sd + ')' : 'N/A');
  var llStr = w.ll ? Math.round(w.ll).toLocaleString() + ' ft' : 'N/A';
  return '<b>' + (w.n || 'Unknown') + '</b><br>' +
    '<span style="color:#656d76;">Operator:</span> ' + (w.op || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Formation:</span> ' + (w.fm || 'N/A') + '<br>' +
    '<span style="color:#656d76;">STR:</span> ' + (w.str || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Completed:</span> ' + completionStr + '<br>' +
    '<span style="color:#656d76;">Lateral:</span> ' + llStr;
}

function permitTooltip(p) {
  var llStr = p.pll ? Math.round(p.pll).toLocaleString() + ' ft' : 'N/A';
  var pdStr = p.pd ? Math.round(p.pd).toLocaleString() + ' ft' : 'N/A';
  return '<b>' + (p.n || 'Unknown') + '</b> <span style="color:#f4a261;font-weight:600;">(Permit)</span><br>' +
    '<span style="color:#656d76;">Operator:</span> ' + (p.op || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Formation:</span> ' + (p.fm || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Lease:</span> ' + (p.lease || 'N/A') + '<br>' +
    '<span style="color:#656d76;">STR:</span> ' + (p.str || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Approved:</span> ' + (p.ad || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Permit Type:</span> ' + (p.pt || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Permit Depth:</span> ' + pdStr + '<br>' +
    '<span style="color:#656d76;">Lateral:</span> ' + llStr;
}

function rigTooltip(r) {
  var mdStr = r.md ? Math.round(r.md).toLocaleString() + ' ft' : 'N/A';
  return '<b>' + (r.n || 'Unknown Rig') + '</b> <span style="color:#000;font-weight:600;">(Rig)</span><br>' +
    '<span style="color:#656d76;">Operator:</span> ' + (r.op || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Formation:</span> ' + (r.fm || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Lease:</span> ' + (r.lease || 'N/A') + '<br>' +
    '<span style="color:#656d76;">STR:</span> ' + (r.str || 'N/A') + '<br>' +
    '<span style="color:#656d76;">Spud Date:</span> ' + (r.sd || 'N/A') + '<br>' +
    '<span style="color:#656d76;">MD:</span> ' + mdStr;
}

function addLateral(layerGroup, coords, color, dashed, tooltip) {
  if (coords.length === 2) {
    var line = L.polyline(coords, {
      color: color, weight: 2.5, opacity: 0.85,
      dashArray: dashed ? '6, 4' : null,
    });
    line.bindTooltip(tooltip, { sticky: true });
    layerGroup.addLayer(line);
  } else {
    var marker = L.circleMarker(coords[0], {
      radius: 4, fillColor: color, color: '#fff', weight: 0.8, fillOpacity: 0.8,
    });
    marker.bindTooltip(tooltip, { sticky: true });
    layerGroup.addLayer(marker);
  }
}

function renderAll() {
  wellLayerGroup.clearLayers();
  ducLayerGroup.clearLayers();
  permitLayerGroup.clearLayers();

  var completedCount = 0, ducCount = 0, permitCount = 0;

  WELL_DATA.forEach(function(w) {
    if (!activeFormations.has(w.fg)) return;
    var color = FORMATION_COLORS[w.fg] || FORMATION_COLORS['Other'];
    var coords = (w.lat2 && w.lng2) ? [[w.lat, w.lng], [w.lat2, w.lng2]] : [[w.lat, w.lng]];

    if (w.tb === 'DUC') {
      ducCount++;
      addLateral(ducLayerGroup, coords, color, true, wellTooltip(w));
    } else {
      if (!activeTimeBuckets.has(w.tb)) return;
      completedCount++;
      addLateral(wellLayerGroup, coords, color, false, wellTooltip(w));
    }
  });

  PERMIT_DATA.forEach(function(p) {
    if (!activeFormations.has(p.fg)) return;
    permitCount++;
    var color = FORMATION_COLORS[p.fg] || FORMATION_COLORS['Other'];
    var coords = (p.lat2 && p.lng2) ? [[p.lat, p.lng], [p.lat2, p.lng2]] : [[p.lat, p.lng]];
    addLateral(permitLayerGroup, coords, color, true, permitTooltip(p));
  });

  document.getElementById('well-count-completed').textContent = completedCount.toLocaleString();
  document.getElementById('well-count-duc').textContent = ducCount.toLocaleString();
  document.getElementById('permit-count').textContent = permitCount.toLocaleString();
  document.getElementById('well-count-total').textContent = (completedCount + ducCount + permitCount).toLocaleString();
}

function renderRigs() {
  rigLayerGroup.clearLayers();
  RIG_DATA.forEach(function(r) {
    var icon = L.divIcon({
      className: '',
      html: '<svg width="18" height="22" viewBox="0 0 18 22" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));"><polygon points="9,0 3,18 15,18" fill="none" stroke="#000" stroke-width="1.8"/><line x1="9" y1="0" x2="9" y2="18" stroke="#000" stroke-width="1.2"/><line x1="5" y1="6" x2="13" y2="6" stroke="#000" stroke-width="1"/><line x1="4" y1="12" x2="14" y2="12" stroke="#000" stroke-width="1"/><rect x="2" y="18" width="14" height="3" fill="#000" rx="1"/></svg>',
      iconSize: [18, 22], iconAnchor: [9, 22],
    });
    var marker = L.marker([r.lat, r.lng], { icon: icon });
    marker.bindTooltip(rigTooltip(r), { sticky: true });
    rigLayerGroup.addLayer(marker);
  });
}

renderAll();
renderRigs();
`;

// Insert JS before the closing </script> tag, after the Escape keydown listener
const insertPoint = "document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });";
html = html.replace(insertPoint, insertPoint + '\n' + mainJS);

fs.writeFileSync('index.html', html, 'utf8');
console.log('Done — clean rebuild with wells, permits, rigs');
console.log('Wells:', wellData.length, 'Permits:', permitData.length, 'Rigs:', rigData.length);
