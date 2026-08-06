// Plug-and-play avatar kit. Each character is a self-contained builder that
// returns an AvatarParts assembly; Avatar3D renders + animates it uniformly.
// This makes avatars swappable — add a builder + register(id, builder) and it
// shows up everywhere (settings, setup preview, interview studio).
import type * as THREE_NS from "three";

export type Mood = "neutral" | "listening" | "curious" | "stern" | "speaking";
export type Palette = { skin: number; hair: number };

export interface AvatarParts {
  root: THREE_NS.Group;               // head assembly; caller adds it to the scene
  mouth?: THREE_NS.Object3D;          // scaled on Y for lip-sync (rest scale.y ~0.12)
  lids?: THREE_NS.Object3D[];         // translated down to blink (rest y set by builder)
  brows?: THREE_NS.Object3D[];        // translated for expression (optional)
  lidRestY?: number;                  // resting Y of the lids (default 0.16)
  setMood?: (m: Mood) => void;        // optional: change expression when mood changes
  tick?: (t: number, speaking: boolean, amp: number) => void; // optional per-frame extras
}

export type Builder = (three: typeof THREE_NS, p: Palette) => AvatarParts;

// A face is fully described by ONE registration: its builder + its palette. So
// adding a face means one register() call here-adjacent and one row in the
// backend persona/faces.go — nothing in Avatar3D.
const DEFAULT_PALETTE: Palette = { skin: 0xf1c9a5, hair: 0x3a2a22 };
const registry: Record<string, Builder> = {};
const palettes: Record<string, Palette> = {};

export function register(id: string, b: Builder, palette?: Palette) {
  registry[id] = b;
  if (palette) palettes[id] = palette;
}
export function getBuilder(id: string): Builder | undefined { return registry[id]; }
export function hasBuilder(id: string): boolean { return !!registry[id]; }
export function getPalette(id: string): Palette { return palettes[id] ?? DEFAULT_PALETTE; }

// ---- realistic glTF avatars (Ready Player Me: Oculus visemes + ARKit rig) ----
// A face id can instead map to a rigged glTF model rendered by GltfAvatar with
// morph-target viseme lip-sync. Registered separately so the procedural builders
// stay untouched; Avatar3D prefers a glTF face when one is registered.
export type GltfFace = { url: string };
const gltfFaces: Record<string, GltfFace> = {};
export function registerGltf(id: string, url: string) { gltfFaces[id] = { url }; }
export function getGltf(id: string): GltfFace | undefined { return gltfFaces[id]; }
