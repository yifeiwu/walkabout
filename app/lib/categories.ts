// Single source of truth for the map overlays, organised as a two-level
// hierarchy: GROUPS (e.g. "Food & Drink") each contain SUBCATEGORIES
// (e.g. "Cafes"). From one structured filter we derive BOTH:
//   - the Overpass tag selector used to build the query, and
//   - a JS predicate used to classify returned elements back into a subcategory.
//
// Adding a new grouping is just a matter of adding an entry here.

export type OsmElementType = "node" | "way" | "relation";
export type RenderKind = "point" | "line";

export interface TagFilter {
  types: OsmElementType[];
  key: string;
  values: string[];
}

export interface SubCategory {
  id: string;
  label: string;
  icon: string; // emoji glyph rendered inside the marker
  render: RenderKind;
  defaultOn: boolean;
  filters: TagFilter[];
  // Per-subcategory cap so dense layers (e.g. restaurants) can't crowd out
  // sparse ones (e.g. libraries) when results are large.
  maxFeatures: number;
}

export interface Group {
  id: string;
  label: string;
  color: string;
  icon: string; // emoji glyph representing the group in the legend
  subcategories: SubCategory[];
}

const DEFAULT_CAP = 600;

// Convenience builder to keep the config below readable.
function sub(
  id: string,
  label: string,
  icon: string,
  filters: TagFilter[],
  opts: Partial<Pick<SubCategory, "render" | "defaultOn" | "maxFeatures">> = {},
): SubCategory {
  return {
    id,
    label,
    icon,
    filters,
    render: opts.render ?? "point",
    defaultOn: opts.defaultOn ?? false,
    maxFeatures: opts.maxFeatures ?? DEFAULT_CAP,
  };
}

const PT = (key: string, values: string[]): TagFilter => ({
  types: ["node", "way"],
  key,
  values,
});

export const GROUPS: Group[] = [
  {
    id: "transport",
    label: "Transport",
    color: "#2563eb",
    icon: "🚉",
    subcategories: [
      sub("stations", "Train & Tram Stations", "🚉", [
        { types: ["node", "way"], key: "railway", values: ["station", "halt", "tram_stop"] },
        { types: ["node"], key: "public_transport", values: ["station"] },
      ]),
      sub(
        "bus",
        "Bus Stops",
        "🚌",
        [{ types: ["node"], key: "highway", values: ["bus_stop"] }],
        { defaultOn: false, maxFeatures: 400 },
      ),
      sub(
        "rail_lines",
        "Rail & Tram Lines",
        "🚆",
        [
          {
            types: ["way"],
            key: "railway",
            values: ["rail", "subway", "light_rail", "tram", "monorail"],
          },
        ],
        { render: "line", maxFeatures: 400 },
      ),
    ],
  },
  {
    id: "food",
    label: "Food & Drink",
    color: "#dc2626",
    icon: "🍽️",
    subcategories: [
      sub("restaurants", "Restaurants", "🍽️", [PT("amenity", ["restaurant"])]),
      sub("cafes", "Cafes", "☕", [PT("amenity", ["cafe"])]),
      sub("fast_food", "Fast Food", "🍔", [PT("amenity", ["fast_food", "food_court"])], {
        defaultOn: false,
      }),
      sub("bars", "Bars & Pubs", "🍺", [PT("amenity", ["bar", "pub", "biergarten"])]),
    ],
  },
  {
    id: "shopping",
    label: "Shopping",
    color: "#ea580c",
    icon: "🛍️",
    subcategories: [
      sub("supermarkets", "Supermarkets", "🛒", [PT("shop", ["supermarket"])]),
      sub("convenience", "Convenience & Grocery", "🏪", [
        PT("shop", ["convenience", "grocery", "greengrocer", "general"]),
      ]),
      sub(
        "retail",
        "Shops & Malls",
        "🛍️",
        [PT("shop", ["mall", "department_store"]), PT("amenity", ["marketplace"])],
        { defaultOn: false },
      ),
    ],
  },
  {
    id: "parks",
    label: "Parks & Recreation",
    color: "#16a34a",
    icon: "🌳",
    subcategories: [
      sub("parks", "Parks & Gardens", "🌳", [
        PT("leisure", ["park", "garden", "nature_reserve", "recreation_ground"]),
      ]),
      sub("playgrounds", "Playgrounds", "🛝", [PT("leisure", ["playground"])]),
      sub("sports", "Sports & Fitness", "⚽", [
        PT("leisure", ["sports_centre", "pitch", "fitness_centre", "stadium"]),
      ]),
    ],
  },
  {
    id: "education",
    label: "Education",
    color: "#7c3aed",
    icon: "🎓",
    subcategories: [
      sub("schools", "Schools", "🏫", [PT("amenity", ["school"])]),
      sub("early_childhood", "Early Childhood", "🧸", [PT("amenity", ["kindergarten"])], {
        defaultOn: false,
      }),
      sub("tertiary", "TAFE & Universities", "🎓", [PT("amenity", ["college", "university"])]),
    ],
  },
  {
    id: "civic",
    label: "Civic & Community",
    color: "#0891b2",
    icon: "🏛️",
    subcategories: [
      sub("libraries", "Libraries", "📚", [PT("amenity", ["library"])]),
      sub("community", "Community & Government", "🏛️", [
        PT("amenity", ["community_centre", "townhall"]),
      ]),
      sub("post", "Post Offices", "📮", [PT("amenity", ["post_office"])], { defaultOn: false }),
      sub("worship", "Places of Worship", "⛪", [PT("amenity", ["place_of_worship"])], {
        defaultOn: false,
      }),
    ],
  },
  {
    id: "health",
    label: "Health",
    color: "#db2777",
    icon: "🏥",
    subcategories: [
      sub("pharmacies", "Pharmacies", "💊", [PT("amenity", ["pharmacy"])]),
      sub("medical", "Medical & Dental", "🏥", [
        PT("amenity", ["clinic", "doctors", "dentist", "hospital"]),
      ]),
    ],
  },
  {
    id: "services",
    label: "Money & Services",
    color: "#ca8a04",
    icon: "🏧",
    subcategories: [
      sub("banks", "Banks & ATMs", "🏧", [PT("amenity", ["bank", "atm"])], { defaultOn: false }),
      sub("fuel", "Fuel & EV Charging", "⛽", [PT("amenity", ["fuel", "charging_station"])], {
        defaultOn: false,
      }),
    ],
  },
  {
    id: "entertainment",
    label: "Entertainment",
    color: "#c026d3",
    icon: "🎬",
    subcategories: [
      sub("cinemas", "Cinemas & Theatres", "🎬", [
        PT("amenity", ["cinema", "theatre", "arts_centre"]),
      ]),
      sub("nightlife", "Nightlife", "🎶", [PT("amenity", ["nightclub"])], { defaultOn: false }),
    ],
  },
  {
    id: "attractions",
    label: "Attractions",
    color: "#4f46e5",
    icon: "🗺️",
    subcategories: [
      sub(
        "landmarks",
        "Landmarks & Sights",
        "🗽",
        [
          PT("tourism", ["attraction", "viewpoint", "artwork"]),
          PT("historic", [
            "monument",
            "memorial",
            "castle",
            "ruins",
            "monastery",
            "fort",
            "city_gate",
            "archaeological_site",
            "battlefield",
          ]),
          PT("man_made", ["tower", "lighthouse", "obelisk"]),
        ],
        { defaultOn: true },
      ),
      sub("museums", "Museums & Galleries", "🖼️", [PT("tourism", ["museum", "gallery"])], {
        defaultOn: true,
      }),
      sub(
        "themeparks",
        "Zoos & Theme Parks",
        "🎢",
        [
          PT("tourism", ["zoo", "theme_park", "aquarium"]),
          PT("leisure", ["water_park"]),
        ],
        { defaultOn: true },
      ),
    ],
  },
];

// ---- Derived lookups -------------------------------------------------------

export interface FlatSub extends SubCategory {
  groupId: string;
  groupLabel: string;
  color: string;
}

export const SUBCATEGORIES: FlatSub[] = GROUPS.flatMap((g) =>
  g.subcategories.map((s) => ({
    ...s,
    groupId: g.id,
    groupLabel: g.label,
    color: g.color,
  })),
);

export const SUB_BY_ID: Record<string, FlatSub> = Object.fromEntries(
  SUBCATEGORIES.map((s) => [s.id, s]),
);

export function defaultVisibility(): Record<string, boolean> {
  return Object.fromEntries(SUBCATEGORIES.map((s) => [s.id, s.defaultOn]));
}

// ---- Overpass query building ----------------------------------------------

function selectorFor(filter: TagFilter): string {
  if (filter.values.length === 1) {
    return `["${filter.key}"="${filter.values[0]}"]`;
  }
  return `["${filter.key}"~"^(${filter.values.join("|")})$"]`;
}

function buildBody(render: RenderKind, around: string, subs: SubCategory[]): string {
  const lines: string[] = [];
  for (const s of subs) {
    if (s.render !== render) continue;
    for (const filter of s.filters) {
      for (const type of filter.types) {
        lines.push(`  ${type}${selectorFor(filter)}${around};`);
      }
    }
  }
  return lines.join("\n");
}

// Full Overpass query for the given subcategories (defaults to all). Querying
// only the subcategories that are actually needed is the main lever for load
// time, since each extra selector adds work for Overpass.
export function buildOverpassQuery(
  radiusMeters: number,
  lat: number,
  lon: number,
  subIds?: string[],
): string {
  const subs = subIds
    ? SUBCATEGORIES.filter((s) => subIds.includes(s.id))
    : SUBCATEGORIES;
  const around = `(around:${radiusMeters},${lat},${lon})`;
  const points = buildBody("point", around, subs);
  const lineBody = buildBody("line", around, subs);
  // Keep the server-side timeout aligned with the client's per-attempt budget so
  // a slow query fails fast enough to fall back to another mirror within the
  // serverless function's time limit.
  const parts = [`[out:json][timeout:20];`];
  if (points.trim().length) {
    parts.push(`(\n${points}\n);`);
    parts.push(`out tags center 6000;`);
  }
  if (lineBody.trim().length) {
    parts.push(`(\n${lineBody}\n);`);
    parts.push(`out tags geom 2000;`);
  }
  return parts.join("\n");
}

// Precomputed lookup from a concrete `key=value` tag pair to the subcategory it
// belongs to, along with that subcategory's priority (its position in
// SUBCATEGORIES). Built once at module load so classification of each Overpass
// element is a handful of map lookups rather than a scan over every
// subcategory/filter. First definition wins on duplicate pairs, preserving the
// original "first matching subcategory" precedence.
const CLASSIFY_INDEX = new Map<string, { sub: FlatSub; order: number }>();
SUBCATEGORIES.forEach((sub, order) => {
  for (const filter of sub.filters) {
    for (const value of filter.values) {
      const key = `${filter.key}=${value}`;
      if (!CLASSIFY_INDEX.has(key)) CLASSIFY_INDEX.set(key, { sub, order });
    }
  }
});

// Classify an OSM element (by its tags) into the matching subcategory, choosing
// the highest-priority one when several tags match.
export function classify(tags: Record<string, string> | undefined): FlatSub | null {
  if (!tags) return null;
  let best: { sub: FlatSub; order: number } | null = null;
  for (const key in tags) {
    const hit = CLASSIFY_INDEX.get(`${key}=${tags[key]}`);
    if (hit && (!best || hit.order < best.order)) best = hit;
  }
  return best ? best.sub : null;
}
