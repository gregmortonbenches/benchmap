#!/usr/bin/env python3
"""Merge OpenBenches data into the Bench Map tile files.

Fetches https://openbenches.org/api/benches/?truncated=false and, for each
OpenBenches bench:

  * within MATCH_RADIUS_M of an existing bench -> set `openbenches_id` on that
    bench and backfill `inscription` if it has none.
  * otherwise -> insert a new feature (`source: 'openbenches'`,
    `id: 'openbenches_{id}'`) into the tile covering its coordinates.

Optionally (--photos) scrapes each matched/added bench's OpenBenches page for
photo paths and stores them as `openbenches_photos` (list of '/image/<hash>'),
which the drawer renders. This is one request per bench, so it is throttled and
cached in --photo-cache; interrupt and re-run to resume.

Also rewrites data/inscription_index.json ([lat, lng, inscription] rows) used
by the search box.

Safe to re-run: benches already carrying an `openbenches_id` are not re-added.
Tiles are never created — benches outside the 55 existing tiles are skipped,
because EXISTING_TILES (app.js) and bench-of-the-day.html would need to change.

Usage:
    python3 merge_openbenches.py --dry-run          # counts only, writes nothing
    python3 merge_openbenches.py                    # merge + rebuild search index
    python3 merge_openbenches.py --photos           # also fetch photo paths (slow)

Data licence: OpenBenches content is CC BY-SA 4.0.
"""
import argparse
import html
import json
import math
import re
import sys
import time
import urllib.request
from pathlib import Path

API_URL = "https://openbenches.org/api/benches/?truncated=false"
BENCH_PAGE = "https://openbenches.org/bench/{id}"
MATCH_RADIUS_M = 15
USER_AGENT = "BenchMapUK-merge/1.0 (https://www.benchmap.co.uk)"

# Must mirror CONFIG in app.js.
MAP_SOUTH, MAP_WEST, MAP_NORTH, MAP_EAST = 48.5, -11.0, 61.5, 4.0
TILE_ROWS = TILE_COLS = 10

BUCKET = 0.001  # degrees; ~110 m, comfortably larger than the match radius


def http_get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def tile_key(lat, lng):
    row = math.floor((lat - MAP_SOUTH) / ((MAP_NORTH - MAP_SOUTH) / TILE_ROWS))
    col = math.floor((lng - MAP_WEST) / ((MAP_EAST - MAP_WEST) / TILE_COLS))
    if not (0 <= row < TILE_ROWS and 0 <= col < TILE_COLS):
        return None
    return f"{row}_{col}"


def distance_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def clean_inscription(raw):
    text = html.unescape(re.sub(r"<br\s*/?>", "\n", raw or "", flags=re.I))
    text = re.sub(r"<[^>]+>", "", text).replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def bucket_of(lat, lng):
    return (math.floor(lat / BUCKET), math.floor(lng / BUCKET))


class Grid:
    """Spatial hash of features so each OB bench checks only nearby benches."""

    def __init__(self):
        self.cells = {}

    def add(self, feature):
        lng, lat = feature["geometry"]["coordinates"][:2]
        self.cells.setdefault(bucket_of(lat, lng), []).append(feature)

    def nearest(self, lat, lng, max_m):
        br, bc = bucket_of(lat, lng)
        best, best_d = None, max_m
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                for f in self.cells.get((br + dr, bc + dc), ()):
                    flng, flat = f["geometry"]["coordinates"][:2]
                    d = distance_m(lat, lng, flat, flng)
                    if d <= best_d:
                        best, best_d = f, d
        return best


def fetch_photos(ob_id):
    page = http_get(BENCH_PAGE.format(id=ob_id), timeout=60)
    hashes = []
    for h in re.findall(r"/image/([0-9a-f]{40})", page):
        if h not in hashes:
            hashes.append(h)
    return ["/image/" + h for h in hashes]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="report counts, write nothing")
    ap.add_argument("--data-dir", default=None, help="directory holding tile_*.geojson (default: public/data, else data)")
    ap.add_argument("--photos", action="store_true", help="also fetch photo paths per bench (slow, throttled)")
    ap.add_argument("--photo-cache", default="openbenches_photos_cache.json")
    ap.add_argument("--photo-delay", type=float, default=1.0, help="seconds between page requests")
    ap.add_argument("--from-file", default=None, help="read the API response from this file instead of the network")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent
    data_dir = Path(args.data_dir) if args.data_dir else next(
        (p for p in (root / "public" / "data", root / "data") if p.is_dir()), None)
    if not data_dir or not data_dir.is_dir():
        sys.exit("Could not find the tile directory; pass --data-dir.")

    tile_paths = {p.stem[len("tile_"):]: p for p in sorted(data_dir.glob("tile_*.geojson"))}
    print(f"Loading {len(tile_paths)} tiles from {data_dir} ...")
    tiles = {k: json.loads(p.read_text(encoding="utf-8")) for k, p in tile_paths.items()}

    grid = Grid()
    by_ob_id = {}
    tile_of = {}  # id(feature) -> tile key
    for key, data in tiles.items():
        for f in data["features"]:
            grid.add(f)
            tile_of[id(f)] = key
            oid = f.get("properties", {}).get("openbenches_id")
            if oid is not None:
                by_ob_id[str(oid)] = f

    if args.from_file:
        payload = json.loads(Path(args.from_file).read_text(encoding="utf-8"))
    else:
        print("Fetching OpenBenches ...")
        payload = json.loads(http_get(API_URL))
    ob_features = payload.get("features", [])
    print(f"OpenBenches returned {len(ob_features)} benches.")

    matched = added = already = outside = bad = 0
    backfilled = 0
    touched = set()
    ob_to_feature = {}

    for obf in ob_features:
        try:
            ob_id = str(obf["id"])
            lng, lat = obf["geometry"]["coordinates"][:2]
            inscription = clean_inscription(obf.get("properties", {}).get("popupContent"))
        except (KeyError, TypeError, ValueError):
            bad += 1
            continue

        existing = by_ob_id.get(ob_id)
        if existing is not None:
            already += 1
            ob_to_feature[ob_id] = existing
            continue

        near = grid.nearest(lat, lng, MATCH_RADIUS_M)
        if near is not None and near.get("properties", {}).get("openbenches_id") is None:
            props = near.setdefault("properties", {})
            props["openbenches_id"] = ob_id
            if inscription and not props.get("inscription"):
                props["inscription"] = inscription
                backfilled += 1
            by_ob_id[ob_id] = near
            ob_to_feature[ob_id] = near
            matched += 1
            touched.add(tile_of[id(near)])
            continue

        key = tile_key(lat, lng)
        if key is None or key not in tiles:
            outside += 1
            continue
        props = {
            "id": f"openbenches_{ob_id}",
            "source": "openbenches",
            "amenity": "bench",
            "openbenches_id": ob_id,
        }
        if inscription:
            props["inscription"] = inscription
        feature = {
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "id": f"openbenches_{ob_id}",
        }
        tiles[key]["features"].append(feature)
        grid.add(feature)
        tile_of[id(feature)] = key
        by_ob_id[ob_id] = feature
        ob_to_feature[ob_id] = feature
        added += 1
        touched.add(key)

    print(f"  matched to existing OSM benches: {matched} ({backfilled} inscriptions backfilled)")
    print(f"  added as new benches:            {added}")
    print(f"  already merged (skipped):        {already}")
    print(f"  outside existing tiles:          {outside}")
    print(f"  malformed entries:               {bad}")

    if args.photos and not args.dry_run:
        cache_path = Path(args.photo_cache)
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        todo = [i for i in ob_to_feature if i not in cache]
        print(f"Fetching photos: {len(todo)} pages to scrape ({len(cache)} cached).")
        try:
            for n, ob_id in enumerate(todo, 1):
                try:
                    cache[ob_id] = fetch_photos(ob_id)
                except Exception as exc:  # network blip: leave uncached, retry next run
                    print(f"  {ob_id}: {exc}")
                if n % 50 == 0:
                    cache_path.write_text(json.dumps(cache))
                    print(f"  {n}/{len(todo)}")
                time.sleep(args.photo_delay)
        except KeyboardInterrupt:
            print("Interrupted; saving progress.")
        cache_path.write_text(json.dumps(cache))
        for ob_id, paths in cache.items():
            feature = ob_to_feature.get(ob_id)
            if feature is not None and paths:
                if feature["properties"].get("openbenches_photos") != paths:
                    feature["properties"]["openbenches_photos"] = paths
                    touched.add(tile_of[id(feature)])
    elif args.photos:
        print("(--photos skipped in dry-run)")

    if args.dry_run:
        print("Dry run: nothing written.")
        return

    for key in sorted(k for k in touched if k):
        tile_paths[key].write_text(json.dumps(tiles[key]), encoding="utf-8")
    print(f"Rewrote {len([k for k in touched if k])} tiles.")

    index = []
    for data in tiles.values():
        for f in data["features"]:
            ins = f.get("properties", {}).get("inscription")
            if ins:
                lng, lat = f["geometry"]["coordinates"][:2]
                index.append([round(lat, 5), round(lng, 5), ins])
    (data_dir / "inscription_index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote inscription_index.json ({len(index)} entries).")


if __name__ == "__main__":
    main()
