# Walkabout

Enter an Australian address and see an interactive map of everything within a
chosen radius (default **6 km**), built entirely on **OpenStreetMap** data.

Overlays are organised as a two-level hierarchy of **groups → subcategories**,
each toggleable individually or by group:

- **Transport** — train/tram stations, bus stops, rail/tram lines
- **Food & Drink** — restaurants, cafes, fast food, bars & pubs
- **Shopping** — supermarkets, convenience & grocery, shops & malls
- **Parks & Recreation** — parks & gardens, playgrounds, sports & fitness
- **Education** — schools, early childhood, TAFE & universities
- **Civic & Community** — libraries, community/government, post offices, places of worship
- **Health** — pharmacies, medical & dental
- **Money & Services** — banks & ATMs, fuel & EV charging
- **Entertainment** — cinemas & theatres, nightlife

Coverage is best in Australian cities, where OSM transit and POI data is dense.

## Features

- **Address autocomplete** as you type (debounced Nominatim suggestions).
- **Shareable URLs** — searches are encoded as `?q=…&r=…` and restored on load.
- **Persistent overlays** — your layer toggles are saved to `localStorage`.
- **Hierarchical legend** with per-group / per-subcategory toggles, select all / none,
  live counts, and a "capped" indicator when a layer hits its limit.
- **Rich markers** — emoji icons in group colours, group-coloured clusters, and
  popups showing distance from centre plus a link to the feature on OpenStreetMap.
- **Loading states** — a map overlay spinner and a legend skeleton while data loads.
- **Robustness** — in-flight request cancellation, per-IP rate limiting on the API
  routes, request timeouts with retry, and fallback across multiple Overpass mirrors.

## How it works

```
address ─▶ /api/geocode (Nominatim) ─▶ center lat/lon
center  ─▶ /api/overpass (Overpass API, around:radius) ─▶ categorized POIs
                                                          └▶ Leaflet + OSM tiles
```

- **`/api/geocode`** proxies [Nominatim](https://nominatim.openstreetmap.org/)
  to turn a free-text Australian address into a coordinate. Proxying lets us set
  the descriptive `User-Agent` Nominatim's usage policy requires.
- **`/api/overpass`** builds a single [Overpass API](https://overpass-api.de/)
  query using an `around:<radius>` filter, then classifies the returned OSM
  elements into the overlay categories defined in
  [`app/lib/categories.ts`](app/lib/categories.ts).
- The map ([`app/components/PostcodeMap.tsx`](app/components/PostcodeMap.tsx))
  uses [Leaflet](https://leafletjs.com/) with OpenStreetMap raster tiles and
  clusters dense point layers via `leaflet.markercluster`.

All overlay data is fetched **live** from OpenStreetMap on each search — nothing
is bundled or stored in a database. API responses are cached briefly to stay
within the public services' fair-use limits.

## Adding a new overlay category

Add a group or subcategory to `GROUPS` in
[`app/lib/categories.ts`](app/lib/categories.ts). Each filter's `key`/`values`
drives both the Overpass query and the classification of results, so a new
grouping is a few lines and automatically appears in the legend, query, and map.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # run unit tests (vitest)
```

## Build / deploy (Vercel)

```bash
npm run build
npm start
```

This is a standard Next.js (App Router) app and deploys to
[Vercel](https://vercel.com/) with zero configuration — import the repo and
deploy. The `/api/*` routes run as serverless functions.

## Notes & limitations

- Nominatim and Overpass are free, shared, rate-limited services. Heavy use or a
  very large radius in a dense CBD can be slow or temporarily rate-limited.
- A 6 km radius over a dense city can contain thousands of POIs; results are
  capped (see `MAX_FEATURES` in
  [`app/api/overpass/route.ts`](app/api/overpass/route.ts)) and point layers are
  clustered to keep the map responsive.
# walkabout
