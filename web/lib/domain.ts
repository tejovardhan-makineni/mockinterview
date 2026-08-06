// Cross-feature vocabulary shared by more than one feature slice. Keep this tiny
// — only primitives that genuinely belong to no single feature live here. Types
// owned by a feature live in that feature's file under lib/features/.

export type Personality = "supportive" | "neutral" | "interruptive" | "annoying";
export type Modality = "system_design" | "coding" | "written" | "conversational";

export type Phase =
  | "lobby" | "device_check" | "intro" | "question" | "requirements"
  | "estimation" | "hld" | "api" | "lld" | "deepdive" | "scaling"
  | "reliability" | "observability" | "security" | "wrap" | "scoring" | "report";
