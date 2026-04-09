/**
 * Update WELL_DATA, PERMIT_DATA, RIG_DATA, UNIT_ACTIVITY, and CINCO_WELLS
 * in index.html using fresh Enverus map data files.
 * Reuses the polygon-matching logic from inject-wells.js.
 */
const fs = require('fs');

// ── Load data ──
const wellData = JSON.parse(fs.readFileSync('wells_map_data.json', 'utf8'));
const permitData = JSON.parse(fs.readFileSync('permits_map_data.json', 'utf8'));
const rigData = JSON.parse(fs.readFileSync('rigs_map_data.json', 'utf8'));
const blmPolygons = JSON.parse(fs.readFileSync('blm_section_polygons.json', 'utf8'));

// ── Extract current DSU_DATA and SECTION_NMA from HTML ──
let html = fs.readFileSync('index.html', 'utf8');

function extractJSON(varName) {
  const prefix = varName.startsWith('var ') ? varName : 'const ' + varName + ' = ';
  let start = html.indexOf(prefix);
  if (start < 0) { start = html.indexOf(prefix.replace('const ', 'var ')); }
  if (start < 0) throw new Error('Could not find ' + varName);
  const opener = varName.includes('NMA') || varName.includes('ACTIVITY') ? '{' : '[';
  const closer = opener === '{' ? '}' : ']';
  const objStart = html.indexOf(opener, start);
  let depth = 0, end = objStart;
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === opener) depth++;
    else if (html[i] === closer) { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return { data: JSON.parse(html.substring(objStart, end)), start: objStart, end };
}

const dsuData = extractJSON('DSU_DATA').data;
const sectionNma = extractJSON('SECTION_NMA').data;

console.log('DSU units:', dsuData.length);
console.log('Wells:', wellData.length, 'Permits:', permitData.length, 'Rigs:', rigData.length);

// ── Compute unit activity (ported from inject-wells.js) ──
const DSU_OFFSET_LAT = 0.0004;

function parseSectionTownshipRange(str) {
  var m = str.match(/(\d+)-(\d+)N-(\d+)W/);
  if (!m) return null;
  return { section: parseInt(m[1]), township: parseInt(m[2]), range: parseInt(m[3]) };
}

// Build DSU polygon boundaries from BLM sections (only sections with NMA)
var dsuPolygons = {};
dsuData.forEach(function(dsu) {
  var rings = [];
  [dsu.north, dsu.middle, dsu.south].filter(Boolean).forEach(function(str) {
    var p = parseSectionTownshipRange(str);
    if (!p) return;
    var key = p.section + '-' + p.township + 'N-' + p.range + 'W';
    if (!sectionNma[key]) return;
    if (blmPolygons[key]) {
      blmPolygons[key].forEach(function(ring) {
        rings.push(ring.map(function(pt) { return [pt[0] + DSU_OFFSET_LAT, pt[1]]; }));
      });
    }
  });
  if (rings.length > 0) dsuPolygons[dsu.unit] = rings;
});

console.log('DSUs with polygon boundaries:', Object.keys(dsuPolygons).length);

function pointInRing(lat, lng, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var yi = ring[i][0], xi = ring[i][1];
    var yj = ring[j][0], xj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInDsu(lat, lng, rings) {
  for (var r = 0; r < rings.length; r++) {
    if (pointInRing(lat, lng, rings[r])) return true;
  }
  return false;
}

function lateralOverlap(lat1, lng1, lat2, lng2, rings) {
  var samples = 20;
  var inside = 0;
  for (var i = 0; i <= samples; i++) {
    var t = i / samples;
    var lat = lat1 + (lat2 - lat1) * t;
    var lng = lng1 + (lng2 - lng1) * t;
    if (pointInDsu(lat, lng, rings)) inside++;
  }
  return inside / (samples + 1);
}

var MIN_OVERLAP = 0.10;
var unitActivity = {};
var cincoWells = [];
var recentBuckets = ['2023', '2024', '2025', '2026'];
var dsuUnits = Object.keys(dsuPolygons);

wellData.forEach(function(w) {
  if (!w.lat || !w.lng) return;
  dsuUnits.forEach(function(unit) {
    var rings = dsuPolygons[unit];
    var overlap = (w.lat2 && w.lng2)
      ? lateralOverlap(w.lat, w.lng, w.lat2, w.lng2, rings)
      : (pointInDsu(w.lat, w.lng, rings) ? 1.0 : 0.0);
    if (overlap < MIN_OVERLAP) return;

    if (!unitActivity[unit]) unitActivity[unit] = { rcw: false, lcw: false, duc: false, permit: false };
    if (w.tb === 'DUC') {
      unitActivity[unit].duc = true;
      cincoWells.push({ n: w.n, unit: unit, fg: w.fg, op: w.op, lat: w.lat, lng: w.lng, cat: 'duc' });
    } else if (recentBuckets.indexOf(w.tb) >= 0) {
      unitActivity[unit].rcw = true;
      cincoWells.push({ n: w.n, unit: unit, fg: w.fg, op: w.op, lat: w.lat, lng: w.lng, cat: 'recent' });
    } else {
      unitActivity[unit].lcw = true;
      cincoWells.push({ n: w.n, unit: unit, fg: w.fg, op: w.op, lat: w.lat, lng: w.lng, cat: 'legacy' });
    }
  });
});

permitData.forEach(function(p) {
  if (!p.lat || !p.lng) return;
  dsuUnits.forEach(function(unit) {
    var rings = dsuPolygons[unit];
    var overlap = (p.lat2 && p.lng2)
      ? lateralOverlap(p.lat, p.lng, p.lat2, p.lng2, rings)
      : (pointInDsu(p.lat, p.lng, rings) ? 1.0 : 0.0);
    if (overlap < MIN_OVERLAP) return;

    if (!unitActivity[unit]) unitActivity[unit] = { rcw: false, lcw: false, duc: false, permit: false };
    unitActivity[unit].permit = true;
    cincoWells.push({ n: p.n, unit: unit, fg: p.fg, op: p.op, lat: p.lat, lng: p.lng, cat: 'permit' });
  });
});

// Manual overrides
cincoWells.forEach(function(w) {
  if (w.n === "BEATY 1-2-11-14CHX" && w.unit === "1117") w.unit = "28";
});

// Remove known duplicates/stale entries:
// - TOPAZ 1-13HX is a stale duplicate of TOPAZ 1-13HX(R) which has the completion date
// - EAGAN 1-1.12H permit is stale — well has been spudded (EAGAN #1-1.12H DUC)
var removeEntries = [
  function(w) { return w.n === "TOPAZ 1-13HX"; },
  function(w) { return w.n === "EAGAN 1-1.12H" && w.cat === "permit"; },
  function(w) { return w.n === "QUETZAL 1-6-7XH" && w.cat === "permit"; },
];
for (var ri = cincoWells.length - 1; ri >= 0; ri--) {
  if (removeEntries.some(function(fn) { return fn(cincoWells[ri]); })) {
    cincoWells.splice(ri, 1);
  }
}

// Deduplicate by name+unit — prefer recent > duc > permit > legacy
var catPriority = { recent: 0, duc: 1, permit: 2, legacy: 3 };
var seen = {};
cincoWells.forEach(function(w) {
  var key = w.n + '|' + w.unit;
  if (!seen[key] || catPriority[w.cat] < catPriority[seen[key].cat]) seen[key] = w;
});
cincoWells.length = 0;
Object.values(seen).forEach(function(w) { cincoWells.push(w); });

// Recompute unitActivity from final cincoWells (after removals and dedup)
unitActivity = {};
cincoWells.forEach(function(w) {
  if (!unitActivity[w.unit]) unitActivity[w.unit] = { rcw: false, lcw: false, duc: false, permit: false };
  if (w.cat === 'recent') unitActivity[w.unit].rcw = true;
  else if (w.cat === 'legacy') unitActivity[w.unit].lcw = true;
  else if (w.cat === 'duc') unitActivity[w.unit].duc = true;
  else if (w.cat === 'permit') unitActivity[w.unit].permit = true;
});

console.log('Unit activity:', Object.keys(unitActivity).length, 'units with wells/permits');
console.log('Cinco wells:', cincoWells.length, '(deduped, 10% lateral overlap)');

// ── Replace variables in HTML ──
function replaceVar(html, varName, newData) {
  // Match: var VARNAME = [...]; or var VARNAME = {...};
  const patterns = [
    'var ' + varName + ' = ',
    'const ' + varName + ' = '
  ];
  let start = -1;
  let prefix = '';
  for (const p of patterns) {
    start = html.indexOf(p);
    if (start >= 0) { prefix = p; break; }
  }
  if (start < 0) throw new Error('Could not find var ' + varName);

  const dataStart = start + prefix.length;
  const opener = typeof newData === 'object' && !Array.isArray(newData) ? '{' : '[';
  const closer = opener === '{' ? '}' : ']';
  const objStart = html.indexOf(opener, start);
  let depth = 0, end = objStart;
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === opener) depth++;
    else if (html[i] === closer) { depth--; if (depth === 0) { end = i + 1; break; } }
  }

  return html.substring(0, objStart) + JSON.stringify(newData) + html.substring(end);
}

html = replaceVar(html, 'WELL_DATA', wellData);
html = replaceVar(html, 'PERMIT_DATA', permitData);
html = replaceVar(html, 'RIG_DATA', rigData);
html = replaceVar(html, 'UNIT_ACTIVITY', unitActivity);
html = replaceVar(html, 'CINCO_WELLS', cincoWells);

// ── Also update well/permit/rig count displays ──
// Update the stats panel counts if they exist
const wellCountRe = /<span class="count">(\d+)<\/span>\s*wells/;
const permitCountRe = /<span class="count">(\d+)<\/span>\s*permits/;
const rigCountRe = /<span class="count">(\d+)<\/span>\s*rigs/;

if (wellCountRe.test(html)) html = html.replace(wellCountRe, `<span class="count">${wellData.length}</span> wells`);
if (permitCountRe.test(html)) html = html.replace(permitCountRe, `<span class="count">${permitData.length}</span> permits`);
if (rigCountRe.test(html)) html = html.replace(rigCountRe, `<span class="count">${rigData.length}</span> rigs`);

fs.writeFileSync('index.html', html);
console.log('\nPatched index.html successfully');
console.log('  Wells:', wellData.length);
console.log('  Permits:', permitData.length);
console.log('  Rigs:', rigData.length);
