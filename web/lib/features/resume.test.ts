import { describe, it, expect } from "vitest";
import { looseFind, looseIncludes, looseReplaceAll } from "./resume";

describe("whitespace-tolerant resume matching", () => {
  it("finds an exact substring", () => {
    expect(looseFind("Developed an Ingestion Utility", "an Ingestion")).toEqual({ start: 10, end: 22 });
  });

  it("matches a run-together needle against spaced text (PDF space-loss)", () => {
    const doc = "Developed an Ingestion Utility web application";
    const hit = looseFind(doc, "DevelopedanIngestionUtility");
    expect(hit).not.toBeNull();
    // the highlighted span is the REAL spaced text, not the needle
    expect(doc.slice(hit!.start, hit!.end)).toBe("Developed an Ingestion Utility");
  });

  it("matches a spaced needle against run-together text", () => {
    expect(looseIncludes("DevelopedanIngestionUtility", "Developed an Ingestion")).toBe(true);
  });

  it("returns null when the non-whitespace content differs", () => {
    expect(looseFind("Developed a Search Platform", "DevelopedanIngestion")).toBeNull();
  });

  it("replaces a run-together original with the improved (spaced) text", () => {
    const out = looseReplaceAll("Developed an Ingestion Utility.", "DevelopedanIngestionUtility", "Built a geo-seismic ingestion app");
    expect(out).toBe("Built a geo-seismic ingestion app.");
  });

  it("does not loop when the replacement contains the needle", () => {
    const out = looseReplaceAll("foo bar", "foobar", "foo bar baz");
    expect(out).toBe("foo bar baz");
  });

  it("ignores an empty needle", () => {
    expect(looseFind("anything", "")).toBeNull();
    expect(looseReplaceAll("anything", "", "x")).toBe("anything");
  });
});
