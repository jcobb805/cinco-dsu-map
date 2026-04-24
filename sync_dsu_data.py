"""
Syncs the hardcoded `const DSU_DATA = [...]` block in private.html
from the live dsu_geometry.json published by Mac Mini to SharePoint.

Run before re-running cinco-deck/screenshots.js so captured maps reflect
the current Postgres state.
"""
import json, re, datetime, sys, os

HTML  = r"C:\Users\Josh Cobb\cinco-dsu-map\private.html"
JSON_SP = r"C:\Users\Josh Cobb\Platform Energy\Platform Data Warehouse - Documents\STR Warehouse\_platform_exports\dsu_geometry.json"
ACREAGE_SP = r"C:\Users\Josh Cobb\Platform Energy\Platform Data Warehouse - Documents\STR Warehouse\_platform_exports\acreage_position.json"
JSON_LOCAL_MIRROR = r"C:\Users\Josh Cobb\cinco-dsu-map\dsu_geometry.json"
MAX_AGE_DAYS = 14

def main():
    if not os.path.exists(JSON_SP):
        sys.exit(f"dsu_geometry.json not found at {JSON_SP}. Ask Mac Mini to export.")
    with open(JSON_SP) as f:
        payload = json.load(f)

    # Freshness guard
    try:
        gen = datetime.datetime.fromisoformat(payload["generated_at"].replace("Z", "+00:00"))
        age = (datetime.datetime.now(datetime.timezone.utc) - gen).days
        if age > MAX_AGE_DAYS:
            print(f"WARN: dsu_geometry.json is {age} days old (generated {payload['generated_at']}).")
    except Exception as e:
        print(f"WARN: could not parse generated_at: {e}")

    units = payload["units"]
    # Mirror to map folder for any runtime fetch consumers + verification
    with open(JSON_LOCAL_MIRROR, "w") as f:
        json.dump(payload, f, indent=2)

    # Load canonical acreage totals so the DSU map stats bar matches the deck
    acreage = {}
    if os.path.exists(ACREAGE_SP):
        with open(ACREAGE_SP) as f:
            acreage = json.load(f)
    totals_const = {
        "as_of": acreage.get("as_of"),
        "units": acreage.get("total", {}).get("units"),
        "nma":   acreage.get("total", {}).get("nma"),
        "unassigned_nma": acreage.get("total", {}).get("unassigned_nma"),
    }
    # Portfolio-wide avg WI/NRI: unit-count-weighted (matches the Acreage Position
    # Overview template convention and what the deck's Portfolio Overview TOTAL row shows).
    # Per-category avg_wi/avg_nri from the JSON are already unit-count averages within each
    # category, so: total_wi_sum = sum(category.units * category.avg_wi) / total_units.
    if acreage:
        total_wi_sum  = sum(acreage[c].get("units", 0) * acreage[c].get("avg_wi", 0)
                           for c in ("drillable", "potential", "nonop"))
        total_nri_sum = sum(acreage[c].get("units", 0) * acreage[c].get("avg_nri", 0)
                            for c in ("drillable", "potential", "nonop"))
        total_units   = sum(acreage[c].get("units", 0) for c in ("drillable", "potential", "nonop"))
        totals_const["wi"]  = total_wi_sum  / total_units if total_units else 0
        totals_const["nri"] = total_nri_sum / total_units if total_units else 0

    with open(HTML, encoding="utf-8") as f:
        html = f.read()
    m = re.search(r'const DSU_DATA\s*=\s*\[', html)
    if not m:
        sys.exit("Could not find `const DSU_DATA = [` in private.html")
    start = m.start()
    # Walk brackets to find matching close
    i = html.index("[", m.end() - 1)
    depth = 1
    while depth > 0 and i < len(html) - 1:
        i += 1
        c = html[i]
        if c == "[": depth += 1
        elif c == "]": depth -= 1
    end = html.find(";", i) + 1
    # Inject PORTFOLIO_TOTALS right before DSU_DATA so the stats-bar code can read it
    totals_block = "const PORTFOLIO_TOTALS = " + json.dumps(totals_const) + ";\n  "
    new_block = totals_block + "const DSU_DATA = " + json.dumps(units, separators=(",", ":")) + ";"
    html_new = html[:start] + new_block + html[end:]
    # If PORTFOLIO_TOTALS already exists from a previous run, replace it
    html_new = re.sub(r'const PORTFOLIO_TOTALS\s*=\s*\{[^}]*\};\s*\n?\s*const PORTFOLIO_TOTALS',
                     'const PORTFOLIO_TOTALS', html_new, count=1)
    with open(HTML, "w", encoding="utf-8", newline="") as f:
        f.write(html_new)

    print(f"Synced {len(units)} units into private.html")
    print(f"PORTFOLIO_TOTALS: {totals_const['units']} units, {totals_const['nma']:,.1f} NMA, "
          f"WI {totals_const.get('wi', 0)*100:.2f}%, NRI {totals_const.get('nri', 0)*100:.2f}%")
    print(f"Source generated_at: {payload.get('generated_at')}")

if __name__ == "__main__":
    main()
