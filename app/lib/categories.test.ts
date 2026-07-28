import { describe, expect, it } from "vitest";
import {
  buildOverpassQuery,
  classify,
  defaultVisibility,
  SUBCATEGORIES,
} from "./categories";

describe("classify", () => {
  it("returns null for missing or unmatched tags", () => {
    expect(classify(undefined)).toBeNull();
    expect(classify({})).toBeNull();
    expect(classify({ random: "value" })).toBeNull();
  });

  it("maps amenities to the right subcategory and group", () => {
    expect(classify({ amenity: "cafe" })).toMatchObject({
      groupId: "food",
      id: "cafes",
      render: "point",
    });
    expect(classify({ amenity: "library" })).toMatchObject({
      groupId: "civic",
      id: "libraries",
    });
    expect(classify({ amenity: "school" })).toMatchObject({
      groupId: "education",
      id: "schools",
    });
  });

  it("maps shop and leisure tags", () => {
    expect(classify({ shop: "supermarket" })?.id).toBe("supermarkets");
    expect(classify({ leisure: "playground" })?.id).toBe("playgrounds");
  });

  it("classifies rail lines as line geometry", () => {
    const c = classify({ railway: "subway" });
    expect(c?.id).toBe("rail_lines");
    expect(c?.render).toBe("line");
  });

  it("distinguishes stations from rail lines", () => {
    expect(classify({ railway: "station" })?.id).toBe("stations");
    expect(classify({ railway: "tram" })?.id).toBe("rail_lines");
  });
});

describe("buildOverpassQuery", () => {
  const q = buildOverpassQuery(6000, -37.8136, 144.9631);

  it("includes the around filter with radius and coordinates", () => {
    expect(q).toContain("(around:6000,-37.8136,144.9631)");
  });

  it("emits point output with center and line output with geometry", () => {
    expect(q).toContain("out tags center");
    expect(q).toContain("out tags geom");
  });

  it("collapses same-key selectors into a single anchored-regex statement", () => {
    // amenity values from many subcategories fold into one nw[...] statement.
    expect(q).toMatch(/nw\["amenity"~"\^\([^"]*\bcafe\b[^"]*\)\$"\]/);
    expect(q).toMatch(/nw\["amenity"~"\^\([^"]*\brestaurant\b[^"]*\)\$"\]/);
    expect(q).toMatch(/nw\["shop"~"\^\([^"]*\bsupermarket\b[^"]*\)\$"\]/);
    // point line output for rail lines keeps its own anchored regex.
    expect(q).toMatch(/"railway"~"\^\(rail\|subway/);
    // The whole point body issues a single `around` pass per tag key.
    expect((q.match(/\["amenity"/g) ?? []).length).toBe(1);
    expect((q.match(/\["shop"/g) ?? []).length).toBe(1);
  });

  it("uses the nw shorthand for node+way selectors and node for node-only", () => {
    expect(q).toMatch(/nw\["amenity"/);
    // public_transport=station is a node-only filter.
    expect(q).toContain('node["public_transport"="station"]');
  });

  it("orders output by quadtile for faster emission", () => {
    expect(q).toContain("out tags center 6000 qt;");
    expect(q).toContain("out tags geom 2000 qt;");
  });

  it("starts with an out:json header and a timeout", () => {
    expect(q.startsWith("[out:json][timeout:")).toBe(true);
  });
});

describe("defaultVisibility", () => {
  it("has an entry for every subcategory", () => {
    const vis = defaultVisibility();
    expect(Object.keys(vis).length).toBe(SUBCATEGORIES.length);
    for (const s of SUBCATEGORIES) {
      expect(vis[s.id]).toBe(s.defaultOn);
    }
  });
});
