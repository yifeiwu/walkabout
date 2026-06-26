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

  it("includes selectors for representative tags", () => {
    expect(q).toContain('"amenity"="cafe"');
    expect(q).toContain('"shop"="supermarket"');
    // multi-value selector uses an anchored regex
    expect(q).toMatch(/"railway"~"\^\(rail\|subway/);
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
