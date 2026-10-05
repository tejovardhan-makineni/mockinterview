// Role scope and seniority are independent: a staff engineer need not manage
// people, and missing scenario metadata does not imply an IC interview.
export const ROLE_TRACKS = [
  "individual_contributor",
  "management",
  "executive",
] as const;
export type RoleTrack = (typeof ROLE_TRACKS)[number];
export const INTERVIEW_LEVELS = [
  "entry",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "senior_manager",
  "director",
  "vp",
  "executive",
] as const;
export type InterviewLevel = (typeof INTERVIEW_LEVELS)[number];

export const roleTrackLabel = (track?: RoleTrack) =>
  track
    ? {
        individual_contributor: "Individual contributor",
        management: "Management",
        executive: "Executive",
      }[track]
    : "Across roles / unspecified";

export const levelLabel = (level: string) =>
  level === "vp"
    ? "VP"
    : level.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const trackLevels: Record<RoleTrack, readonly InterviewLevel[]> = {
  individual_contributor: [
    "entry",
    "junior",
    "mid",
    "senior",
    "staff",
    "principal",
  ],
  management: ["manager", "senior_manager", "director"],
  executive: ["vp", "executive"],
};

// Retain an authored round/scenario or restored draft value even if it uses a
// legacy cross-track level. Only a deliberate track change selects a new level.
export function levelsForRoleTrack(
  track?: RoleTrack,
  selected?: InterviewLevel,
) {
  const levels = track ? trackLevels[track] : INTERVIEW_LEVELS;
  return selected && !levels.includes(selected)
    ? [...levels, selected]
    : levels;
}

export function levelAfterTrackChange(
  track: RoleTrack | undefined,
  selected?: InterviewLevel,
): InterviewLevel {
  if (!track || (selected && trackLevels[track].includes(selected)))
    return selected ?? "mid";
  return track === "individual_contributor"
    ? "mid"
    : track === "management"
      ? "manager"
      : "vp";
}
