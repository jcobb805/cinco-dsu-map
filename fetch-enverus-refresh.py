"""
Fetch fresh wells (horizontal), DUCs, permits, and rigs from Enverus Developer API
for the Cinco DSU Map area. Produces *_map_data.json files ready for injection.
"""
import json
import os
import re
from enverus_developer_api import DeveloperAPIv3

API_KEY = os.environ.get('ENVERUS_API_KEY', 'slPLsk0XM5a4tflOHW79H92eFfLri2CLfNw2GiZAbPcuQ.gKoOhMEKOCWRWRx7kw')
v3 = DeveloperAPIv3(secret_key=API_KEY)

COUNTIES = ['Custer', 'Roger Mills', 'Beckham', 'Washita', 'Dewey']

WELL_FIELDS = ','.join([
    'WellName', 'API_UWI', 'Latitude', 'Longitude', 'Latitude_BH', 'Longitude_BH',
    'County', 'Formation', 'ENVOperator', 'LateralLength_FT',
    'Section_Township_Range', 'Trajectory', 'SpudDate', 'CompletionDate',
    'ENVProdWellType', 'ENVWellStatus'
])

PERMIT_FIELDS = ','.join([
    'WellName', 'API_UWI', 'Latitude', 'Longitude', 'Latitude_BH', 'Longitude_BH',
    'County', 'Formation', 'ENVOperator', 'LateralLength_FT',
    'Section_Township_Range', 'Trajectory', 'SpudDate', 'CompletionDate',
    'ENVProdWellType', 'ENVWellStatus'
])

RIG_FIELDS = ','.join([
    'RigName_Number', 'RigLatitudeWGS84', 'RigLongitudeWGS84',
    'County', 'Formation', 'ENVOperator', 'SpudDate', 'LeaseName',
    'MD_FT', 'Section', 'Township', 'Range'
])

FM_GROUPS = {
    'Cherokee': ['CHEROKEE', 'DES MOINES'],
    'Red Fork': ['RED FORK'],
    'Skinner': ['SKINNER'],
    'Cleveland': ['CLEVELAND'],
    'Cottage Grove': ['COTTAGE GROVE'],
    'Tonkawa': ['TONKAWA'],
    'Oswego': ['OSWEGO'],
}

def formation_group(fm):
    if not fm:
        return 'Other'
    fm_upper = fm.upper()
    for group, keywords in FM_GROUPS.items():
        for kw in keywords:
            if kw in fm_upper:
                return group
    return 'Other'

def parse_str(str_val):
    """Parse Section_Township_Range like '14-13N-19W' or '14 13N 19W'"""
    if not str_val:
        return ''
    m = re.search(r'(\d+)\D+(\d+N)\D+(\d+W)', str(str_val))
    if m:
        return f"{int(m.group(1))}-{m.group(2)}-{m.group(3)}"
    return str(str_val)

def time_bucket(spud_date, comp_date, well_status):
    """Assign time bucket: DUC if drilled but not completed, else year bucket"""
    sd = str(spud_date) if spud_date else ''
    cd = str(comp_date) if comp_date else ''
    status = str(well_status).upper() if well_status else ''

    # DUC: has spud date but no completion date, and status indicates drilled uncompleted
    if sd and not cd and 'DUC' in status:
        return 'DUC'
    if sd and not cd and spud_date and 'COMPLET' not in status:
        return 'DUC'

    # Use completion date if available, else spud date
    date_str = cd if cd else sd
    if not date_str or date_str == 'None':
        return 'Pre-2000'

    try:
        year = int(date_str[:4])
    except (ValueError, IndexError):
        return 'Pre-2000'

    if year >= 2020:
        return str(year)
    elif year >= 2010:
        return '2010s'
    elif year >= 2000:
        return '2000s'
    else:
        return 'Pre-2000'

def process_well(row):
    return {
        'n': row.get('WellName', ''),
        'lat': row.get('Latitude'),
        'lng': row.get('Longitude'),
        'lat2': row.get('Latitude_BH') or None,
        'lng2': row.get('Longitude_BH') or None,
        'fm': row.get('Formation', ''),
        'fg': formation_group(row.get('Formation', '')),
        'op': row.get('ENVOperator', ''),
        'str': parse_str(row.get('Section_Township_Range', '')),
        'cd': str(row.get('CompletionDate', '') or ''),
        'sd': str(row.get('SpudDate', '') or ''),
        'll': row.get('LateralLength_FT') or 0,
        'tb': time_bucket(
            row.get('SpudDate'),
            row.get('CompletionDate'),
            row.get('ENVWellStatus')
        ),
    }

# ── Fetch horizontal wells ──
print("Fetching horizontal wells...")
wells_raw = []
for county in COUNTIES:
    print(f"  {county}...")
    try:
        for row in v3.query('wells',
            County=county,
            StateProvince='OK',
            Trajectory='Horizontal',
            deleteddate='null',
            fields=WELL_FIELDS,
            pagesize=10000):
            if row.get('Latitude') and row.get('Longitude'):
                wells_raw.append(row)
    except Exception as e:
        print(f"    Error: {e}")

print(f"  Total horizontal wells: {len(wells_raw)}")

# ── Fetch permits (wells with permit status, not yet drilled) ──
print("\nFetching permits...")
permits_raw = []
for county in COUNTIES:
    print(f"  {county}...")
    try:
        for row in v3.query('wells',
            County=county,
            StateProvince='OK',
            ENVWellStatus='PERMIT',
            Trajectory='Horizontal',
            deleteddate='null',
            fields=PERMIT_FIELDS,
            pagesize=10000):
            if row.get('Latitude') and row.get('Longitude'):
                permits_raw.append(row)
    except Exception as e:
        print(f"    Error: {e}")

print(f"  Total permits: {len(permits_raw)}")

# ── Fetch rigs ──
print("\nFetching rigs...")
rigs_raw = []
for county in COUNTIES:
    print(f"  {county}...")
    try:
        for row in v3.query('rigs',
            County=county,
            StateProvince='OK',
            deleteddate='null',
            fields=RIG_FIELDS,
            pagesize=10000):
            if row.get('RigLatitudeWGS84') and row.get('RigLongitudeWGS84'):
                rigs_raw.append(row)
    except Exception as e:
        print(f"    Error: {e}")

print(f"  Total rigs: {len(rigs_raw)}")

# ── Process wells (separate DUCs from completed wells) ──
wells_map = []
seen_apis = set()
for w in wells_raw:
    api = w.get('API_UWI', '')
    if api in seen_apis:
        continue
    seen_apis.add(api)
    processed = process_well(w)
    if processed['lat'] and processed['lng']:
        # Clean up None values for JSON
        if not processed['lat2']:
            del processed['lat2']
        if not processed['lng2']:
            del processed['lng2']
        wells_map.append(processed)

# ── Process permits ──
permits_map = []
permit_apis = set()
for p in permits_raw:
    api = p.get('API_UWI', '')
    if api in permit_apis or api in seen_apis:
        continue
    permit_apis.add(api)
    processed = process_well(p)
    processed['tb'] = 'Permit'
    if processed['lat'] and processed['lng']:
        if not processed.get('lat2'):
            processed.pop('lat2', None)
        if not processed.get('lng2'):
            processed.pop('lng2', None)
        permits_map.append(processed)

# ── Process rigs ──
rigs_map = []
for r in rigs_raw:
    rigs_map.append({
        'n': r.get('RigName_Number', ''),
        'lat': r.get('RigLatitudeWGS84'),
        'lng': r.get('RigLongitudeWGS84'),
        'fm': r.get('Formation', ''),
        'op': r.get('ENVOperator', ''),
        'county': r.get('County', ''),
    })

# ── Save ──
with open('wells_map_data.json', 'w') as f:
    json.dump(wells_map, f, default=str)
print(f"\nSaved {len(wells_map)} wells to wells_map_data.json")

with open('permits_map_data.json', 'w') as f:
    json.dump(permits_map, f, default=str)
print(f"Saved {len(permits_map)} permits to permits_map_data.json")

with open('rigs_map_data.json', 'w') as f:
    json.dump(rigs_map, f, default=str)
print(f"Saved {len(rigs_map)} rigs to rigs_map_data.json")

# ── Summary ──
tb_counts = {}
for w in wells_map:
    tb_counts[w['tb']] = tb_counts.get(w['tb'], 0) + 1
print("\nWells by time bucket:")
for tb, ct in sorted(tb_counts.items()):
    print(f"  {tb}: {ct}")

fg_counts = {}
for w in wells_map:
    fg_counts[w['fg']] = fg_counts.get(w['fg'], 0) + 1
print("\nWells by formation group:")
for fg, ct in sorted(fg_counts.items(), key=lambda x: -x[1]):
    print(f"  {fg}: {ct}")
