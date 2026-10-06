# Map pipeline

Downloads every `highway=*` way for an LCDA from OpenStreetMap (Overpass API) and writes one game-ready JSON per LCDA to `tools/data/<slug>.json`. It then copies that file to `client/public/maps` and `server/maps`.

```bash
npm run map:list
npm run map:build -- ikorodu-west            # uses tools/data/raw/<slug>.json if it has been downloaded before
npm run map:build -- ikorodu-west --refresh  # force a fresh download
npm run map:build -- ikorodu-west --seed x   # same roads, different pothole/scenery layout
npm run map:validate -- ikorodu-west
```

Overpass is a free shared service. If one endpoint times out or rate-limits, the script tries the next and retries once. Requests carry a User-Agent header because overpass-api.de rejects anonymous requests with HTTP 406.

## Steps

1. Fetch all `highway=*` ways in the area's bounding box (`areas.json`), then keep the drivable classes (motorway through track, plus `_link` roads; footways, paths, steps and parking aisles are dropped).
2. Clip ways to the box (plus about 200 m of margin). Some roads, such as the Sagamu road, would otherwise run 30 km out of the area.
3. Project lat/lng to local metres with an equirectangular projection centred on the box (`x` east, `y` north).
4. Split ways at shared OSM nodes into graph edges between junctions. Label connected components by size (`mainComponent` is always 0).
5. Set width from road class (primary 12 m down to residential 5.5 m and track 3.5 m) and the `paved` flag from the `surface` tag.
6. Place potholes with a seeded RNG: about 1 per 40 m on unpaved roads, 1 per 70 m on residential and service streets, 1 per 160 m on tertiary roads, and 1 per 450 m on primary and secondary roads. Each has a position, radius and depth.
7. Place low-poly roadside buildings and trees with the same seed. Nothing overlaps a road or another object.

## Output (`schemaVersion: 2`, see `shared/types.ts`)

- `roads[i]` and `graph.edges[i]` always describe the same stretch of road.
- `graph.nodes[]` holds `{ id, position, component }`.
- `potholes[]`, `buildings[]`, `trees[]`
- `extent`: the bounds of the road network in metres.
- `source.attribution`: `© OpenStreetMap contributors`. The client shows it on every screen that uses the map.

## Adding an LCDA

Add an entry to `areas.json` with a name, a stable seed and a bounding box, then build it. The non-West LCDAs ship with approximate boxes; refine them against the official LCDA boundaries if needed.
