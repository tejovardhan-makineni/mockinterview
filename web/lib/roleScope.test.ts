import { describe, expect, it } from "vitest";
import {
  levelAfterTrackChange,
  levelsForRoleTrack,
  roleTrackLabel,
} from "./roleScope";

describe("role scope and seniority", () => {
  it("offers the appropriate ladder and preserves authored legacy defaults", () => {
    expect(levelsForRoleTrack("individual_contributor")).toContain("principal");
    expect(levelsForRoleTrack("individual_contributor")).not.toContain(
      "manager",
    );
    expect(levelsForRoleTrack("management")).toEqual([
      "manager",
      "senior_manager",
      "director",
    ]);
    expect(levelsForRoleTrack("executive")).toEqual(["vp", "executive"]);
    expect(levelsForRoleTrack("management", "senior")).toContain("senior");
    expect(levelsForRoleTrack(undefined)).toContain("manager");
    expect(roleTrackLabel(undefined)).toBe("Across roles / unspecified");
  });
  it("changes seniority only when a deliberate track change requires it", () => {
    expect(levelAfterTrackChange("management", "principal")).toBe("manager");
    expect(levelAfterTrackChange("management", "director")).toBe("director");
    expect(levelAfterTrackChange("executive", "manager")).toBe("vp");
    expect(levelAfterTrackChange("individual_contributor", "director")).toBe(
      "mid",
    );
    expect(levelAfterTrackChange(undefined, "director")).toBe("director");
  });
});
