/**
 * Cherokee / Des Moines Horizontal Type Curve
 * Custer County, Oklahoma — 13N-19W analog area
 *
 * All parameters normalized PER LATERAL FOOT for easy scaling.
 *
 * Scaling guide:
 *   1,280-acre unit (2-mile lateral) → multiply by 10,560 ft
 *   1,920-acre unit (3-mile lateral) → multiply by 15,840 ft
 *
 * Methodology: Modified Arps hyperbolic decline → exponential tail
 *   q(t) = qi / (1 + b * Di * t)^(1/b)   [hyperbolic phase]
 *   switch to exponential when instantaneous decline hits Dmin
 *
 * Analog basis: Cherokee/Des Moines HZ wells in Custer County
 *   (13N-16W through 15N-20W), Nadel & Gussman, Devon, Mewbourne offsets
 */

// ---------------------------------------------------------------------------
// DECLINE PARAMETERS — per lateral foot, monthly time steps
// ---------------------------------------------------------------------------
const DECLINE_PARAMS = {
  oil: {
    qi:   0.040,   // bbl/day/ft — peak 30-day IP rate
    Di:   0.080,   // nominal monthly decline (initial)
    b:    1.20,    // hyperbolic exponent
    Dmin: 0.005,   // terminal exponential decline (monthly)
  },
  gas: {
    qi:   0.100,   // mcf/day/ft
    Di:   0.070,   // nominal monthly decline (initial)
    b:    1.30,    // hyperbolic exponent
    Dmin: 0.005,   // terminal exponential decline (monthly)
  },
  ngl: {
    qi:   0.005,   // bbl/day/ft — derived from gas yield ~50 bbl/MMcf
    Di:   0.070,   // tracks gas decline
    b:    1.30,
    Dmin: 0.005,
  },
};

// ---------------------------------------------------------------------------
// REFERENCE LATERAL LENGTHS
// ---------------------------------------------------------------------------
const LATERAL_LENGTHS = {
  '1280ac': 10560,  // 2-mile lateral
  '1920ac': 15840,  // 3-mile lateral
};

// ---------------------------------------------------------------------------
// FORECAST HORIZON
// ---------------------------------------------------------------------------
const FORECAST_MONTHS = 240; // 20 years

// ---------------------------------------------------------------------------
// CORE DECLINE ENGINE
// ---------------------------------------------------------------------------

/**
 * Generate monthly production forecast using Arps hyp-to-exp decline.
 * Returns array of { month, rate_per_ft, cumulative_per_ft } objects.
 *
 * @param {object} params - { qi, Di, b, Dmin }
 * @param {number} months - forecast length
 * @param {number} daysPerMonth - average days per month (default 30.44)
 * @returns {Array<{month: number, rate_per_ft: number, cum_per_ft: number}>}
 */
function generateDeclineCurve(params, months = FORECAST_MONTHS, daysPerMonth = 30.44) {
  const { qi, Di, b, Dmin } = params;
  const forecast = [];
  let cumulative = 0;
  let switched = false;
  let switchMonth = -1;
  let qSwitch = 0;

  for (let t = 1; t <= months; t++) {
    let rate;

    if (!switched) {
      // Hyperbolic phase: q(t) = qi / (1 + b * Di * t)^(1/b)
      rate = qi / Math.pow(1 + b * Di * t, 1 / b);

      // Check instantaneous decline: D(t) = Di / (1 + b * Di * t)
      const Dt = Di / (1 + b * Di * t);
      if (Dt <= Dmin) {
        switched = true;
        switchMonth = t;
        qSwitch = rate;
      }
    }

    if (switched) {
      // Exponential tail: q(t) = qSwitch * exp(-Dmin * (t - switchMonth))
      rate = qSwitch * Math.exp(-Dmin * (t - switchMonth));
    }

    const monthlyVolume = rate * daysPerMonth; // volume per ft for this month
    cumulative += monthlyVolume;

    forecast.push({
      month: t,
      rate_per_ft: rate,           // daily rate per lateral foot
      monthly_per_ft: monthlyVolume, // monthly volume per lateral foot
      cum_per_ft: cumulative,       // cumulative volume per lateral foot
    });
  }

  return forecast;
}

/**
 * Scale a per-foot forecast to a specific lateral length.
 * @param {Array} forecast - per-foot forecast from generateDeclineCurve
 * @param {number} lateralFt - lateral length in feet
 * @returns {Array<{month, daily_rate, monthly_volume, cumulative}>}
 */
function scaleToLateral(forecast, lateralFt) {
  return forecast.map(row => ({
    month: row.month,
    daily_rate: row.rate_per_ft * lateralFt,
    monthly_volume: row.monthly_per_ft * lateralFt,
    cumulative: row.cum_per_ft * lateralFt,
  }));
}

// ---------------------------------------------------------------------------
// BUILD FULL TYPE CURVE (all 3 streams)
// ---------------------------------------------------------------------------

function buildTypeCurve(overrides = {}) {
  const params = {
    oil: { ...DECLINE_PARAMS.oil, ...(overrides.oil || {}) },
    gas: { ...DECLINE_PARAMS.gas, ...(overrides.gas || {}) },
    ngl: { ...DECLINE_PARAMS.ngl, ...(overrides.ngl || {}) },
  };

  const oil = generateDeclineCurve(params.oil);
  const gas = generateDeclineCurve(params.gas);
  const ngl = generateDeclineCurve(params.ngl);

  // Combined monthly table (per lateral foot)
  const monthly = [];
  for (let i = 0; i < FORECAST_MONTHS; i++) {
    monthly.push({
      month: i + 1,
      oil_rate_bopd_per_ft:  oil[i].rate_per_ft,
      oil_monthly_bbl_per_ft: oil[i].monthly_per_ft,
      oil_cum_bbl_per_ft:    oil[i].cum_per_ft,
      gas_rate_mcfd_per_ft:  gas[i].rate_per_ft,
      gas_monthly_mcf_per_ft: gas[i].monthly_per_ft,
      gas_cum_mcf_per_ft:    gas[i].cum_per_ft,
      ngl_rate_bpd_per_ft:   ngl[i].rate_per_ft,
      ngl_monthly_bbl_per_ft: ngl[i].monthly_per_ft,
      ngl_cum_bbl_per_ft:    ngl[i].cum_per_ft,
    });
  }

  // EUR summary (per foot, 20-year)
  const last = monthly[monthly.length - 1];
  const eur_per_ft = {
    oil_bbl:  last.oil_cum_bbl_per_ft,
    gas_mcf:  last.gas_cum_mcf_per_ft,
    ngl_bbl:  last.ngl_cum_bbl_per_ft,
    boe:      last.oil_cum_bbl_per_ft + last.ngl_cum_bbl_per_ft + last.gas_cum_mcf_per_ft / 6,
  };

  return { params, monthly, eur_per_ft, oil, gas, ngl };
}

// ---------------------------------------------------------------------------
// SUMMARY & SCALING HELPERS
// ---------------------------------------------------------------------------

function printSummary(tc, label = 'Cherokee HZ Type Curve — 13N-19W Analog') {
  const eur = tc.eur_per_ft;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n  20-Year EUR per Lateral Foot:`);
  console.log(`    Oil:   ${eur.oil_bbl.toFixed(2)} bbl/ft`);
  console.log(`    Gas:   ${eur.gas_mcf.toFixed(2)} mcf/ft`);
  console.log(`    NGL:   ${eur.ngl_bbl.toFixed(2)} bbl/ft`);
  console.log(`    BOE:   ${eur.boe.toFixed(2)} boe/ft`);

  console.log(`\n  Scaled EUR by Unit Size:`);
  for (const [name, ft] of Object.entries(LATERAL_LENGTHS)) {
    const oilMbbl = (eur.oil_bbl * ft / 1000).toFixed(1);
    const gasMmcf = (eur.gas_mcf * ft / 1000).toFixed(1);
    const nglMbbl = (eur.ngl_bbl * ft / 1000).toFixed(1);
    const boeMboe = (eur.boe * ft / 1000).toFixed(1);
    console.log(`    ${name} (${(ft).toLocaleString()} ft lateral):`);
    console.log(`      Oil: ${oilMbbl} Mbbl  |  Gas: ${gasMmcf} MMcf  |  NGL: ${nglMbbl} Mbbl  |  BOE: ${boeMboe} Mboe`);
  }

  // IP30 and IP90
  const ip30Oil = tc.monthly[0];
  const ip90Oil = tc.monthly.slice(0, 3).reduce((s, r) => s + r.oil_monthly_bbl_per_ft, 0) / 3 / 30.44;
  console.log(`\n  Key Rates (per lateral foot):`);
  console.log(`    IP30 Oil: ${(ip30Oil.oil_rate_bopd_per_ft * 1000).toFixed(2)} bbl/d per 1,000 ft`);
  console.log(`    IP90 Oil: ${(ip90Oil * 1000).toFixed(2)} bbl/d per 1,000 ft`);

  // Peak month rates scaled
  console.log(`\n  Peak Month Rates (Month 1) by Unit Size:`);
  for (const [name, ft] of Object.entries(LATERAL_LENGTHS)) {
    const oilBopd = (ip30Oil.oil_rate_bopd_per_ft * ft).toFixed(0);
    const gasMcfd = (tc.monthly[0].gas_rate_mcfd_per_ft * ft).toFixed(0);
    const nglBpd  = (tc.monthly[0].ngl_rate_bpd_per_ft * ft).toFixed(0);
    console.log(`    ${name}: ${oilBopd} BOPD  |  ${gasMcfd} MCFD  |  ${nglBpd} BPD NGL`);
  }

  // GOR
  const gor = (eur.gas_mcf / eur.oil_bbl * 1000).toFixed(0);
  console.log(`\n  GOR: ${gor} scf/bbl  |  NGL Yield: ${(eur.ngl_bbl / eur.gas_mcf * 1e6).toFixed(0)} bbl/MMcf`);
  console.log(`${'='.repeat(70)}\n`);
}

function exportCSV(tc, lateralFt = null) {
  const header = lateralFt
    ? 'Month,Oil_BOPD,Oil_Monthly_BBL,Oil_Cum_BBL,Gas_MCFD,Gas_Monthly_MCF,Gas_Cum_MCF,NGL_BPD,NGL_Monthly_BBL,NGL_Cum_BBL'
    : 'Month,Oil_BOPD_per_ft,Oil_Monthly_BBL_per_ft,Oil_Cum_BBL_per_ft,Gas_MCFD_per_ft,Gas_Monthly_MCF_per_ft,Gas_Cum_MCF_per_ft,NGL_BPD_per_ft,NGL_Monthly_BBL_per_ft,NGL_Cum_BBL_per_ft';

  const scale = lateralFt || 1;
  const rows = tc.monthly.map(r => [
    r.month,
    (r.oil_rate_bopd_per_ft * scale).toFixed(4),
    (r.oil_monthly_bbl_per_ft * scale).toFixed(2),
    (r.oil_cum_bbl_per_ft * scale).toFixed(2),
    (r.gas_rate_mcfd_per_ft * scale).toFixed(4),
    (r.gas_monthly_mcf_per_ft * scale).toFixed(2),
    (r.gas_cum_mcf_per_ft * scale).toFixed(2),
    (r.ngl_rate_bpd_per_ft * scale).toFixed(4),
    (r.ngl_monthly_bbl_per_ft * scale).toFixed(2),
    (r.ngl_cum_bbl_per_ft * scale).toFixed(2),
  ].join(','));

  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

const tc = buildTypeCurve();
printSummary(tc);

// Export CSVs
const fs = require('fs');
const path = require('path');

// Per-foot base curve
fs.writeFileSync(
  path.join(__dirname, 'cherokee_type_curve_per_ft.csv'),
  exportCSV(tc)
);

// 1,280-acre (2-mile) scaled
fs.writeFileSync(
  path.join(__dirname, 'cherokee_type_curve_1280ac.csv'),
  exportCSV(tc, LATERAL_LENGTHS['1280ac'])
);

// 1,920-acre (3-mile) scaled
fs.writeFileSync(
  path.join(__dirname, 'cherokee_type_curve_1920ac.csv'),
  exportCSV(tc, LATERAL_LENGTHS['1920ac'])
);

console.log('CSV files written:');
console.log('  cherokee_type_curve_per_ft.csv   (base, per lateral foot)');
console.log('  cherokee_type_curve_1280ac.csv   (10,560 ft lateral)');
console.log('  cherokee_type_curve_1920ac.csv   (15,840 ft lateral)');

// Export the module for dashboard integration
if (typeof module !== 'undefined') {
  module.exports = {
    DECLINE_PARAMS,
    LATERAL_LENGTHS,
    FORECAST_MONTHS,
    generateDeclineCurve,
    scaleToLateral,
    buildTypeCurve,
    printSummary,
    exportCSV,
  };
}