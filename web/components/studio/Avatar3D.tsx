"use client";

// Renders + animates any registered 3D avatar. Characters are plug-and-play
// builders (see ./avatars/*) registered against ./avatars/kit — swap or add one
// and it shows up everywhere. Falls back to the 2D <Avatar> if WebGL is absent.
import { memo, useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { Avatar as Avatar2D, type Mood } from "./Avatar";
import { getBuilder, getPalette, getGltf, type AvatarParts, type Mood as KitMood } from "./avatars/kit";
import { GltfAvatar } from "./GltfAvatar";

// The avatar is driven by a REF the parent mutates — so rapid audio updates
// never re-render React (which was causing flicker). `level`/`bright` feed the
// realistic glTF avatar's viseme lip-sync (openness + vowel color); the
// procedural avatar uses `amplitude`.
export type AvatarDrive = { speaking: boolean; amplitude: number; mood: Mood; level?: number; bright?: number };
// Side-effect imports register the builders (each with its own palette) and the
// realistic glTF faces.
import "./avatars/humans";
import "./avatars/fun-a";
import "./avatars/fun-b";
import "./avatars/realistic";

function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch { return false; }
}

function ProceduralAvatar({ faceId, drive }: { faceId: string; drive: MutableRefObject<AvatarDrive> }) {
  const mount = useRef<HTMLDivElement>(null);
  const st = useRef({ amp: 0, blink: 0, nextBlink: 60, t: 0 });

  useEffect(() => {
    if (!mount.current || !webglOK()) return;
    const el = mount.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.05, 4.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xfff2e6, 1.1); key.position.set(2, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7c8bff, 0.7); rim.position.set(-3, 1, -2); scene.add(rim);

    const builder = getBuilder(faceId) ?? getBuilder("ava");
    let parts: AvatarParts | null = null;
    if (builder) {
      parts = builder(THREE, getPalette(faceId));
      scene.add(parts.root);
    } else {
      const fallback = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), new THREE.MeshStandardMaterial({ color: 0xf1c9a5 }));
      scene.add(fallback);
    }
    const lidRest = parts?.lidRestY ?? 0.16;
    let lastMood: KitMood | "" = "";

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    let raf = 0;
    const loop = () => {
      const s = st.current; s.t += 1;
      const d = drive.current;
      // lip-sync
      const target = d.speaking ? 0.12 + d.amplitude * 0.5 : 0.12;
      s.amp = s.amp + (target - s.amp) * 0.4;
      if (parts?.mouth) parts.mouth.scale.y = d.speaking ? 0.12 + s.amp * 1.3 : 0.12;
      // blink
      if (s.t > s.nextBlink) { s.blink = 1; s.nextBlink = s.t + 120 + Math.floor(Math.abs(Math.sin(s.t) * 160)); }
      if (s.blink > 0) s.blink = Math.max(0, s.blink - 0.18);
      const open = 1 - (s.blink > 0.5 ? (s.blink - 0.5) * 2 : 0);
      parts?.lids?.forEach((lid) => { lid.position.y = lidRest - (1 - open) * 0.18; });
      // mood → expression (only when it changes)
      const effMood: KitMood = d.speaking ? "speaking" : d.mood;
      if (effMood !== lastMood) { parts?.setMood?.(effMood); lastMood = effMood; }
      // gentle sway/nod
      const speak = d.speaking ? 1 : 0.4;
      if (parts?.root) { parts.root.rotation.y = Math.sin(s.t / 70) * 0.08 * speak; parts.root.rotation.x = Math.sin(s.t / 45) * 0.04 * speak; }
      parts?.tick?.(s.t, d.speaking, s.amp);
      raf = requestAnimationFrame(loop); renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); });
    };
    // Only rebuild the scene on faceId change; `drive` is a stable ref read each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceId]);

  if (typeof window !== "undefined" && !webglOK()) {
    const d = drive.current;
    return <Avatar2D faceId={faceId} speaking={d.speaking} amplitude={d.amplitude} mood={d.mood} />;
  }
  return <div ref={mount} className="h-full w-full" style={{ borderRadius: 12, overflow: "hidden" }} />;
}

// Avatar3D routes a face to the realistic glTF renderer when one is registered
// for that id, otherwise to the procedural builder. A glTF load failure falls
// back to procedural so the room always has a face. Memoized on faceId + drive
// so audio updates (via the ref) never re-render.
function Avatar3DImpl({ faceId, drive }: { faceId: string; drive: MutableRefObject<AvatarDrive> }) {
  const gltf = getGltf(faceId);
  // Track which face failed to load (derived, so switching faces auto-resets the
  // fallback without a setState-in-effect).
  const [failedFace, setFailedFace] = useState<string | null>(null);

  if (gltf && failedFace !== faceId && (typeof window === "undefined" || webglOK())) {
    return <GltfAvatar key={faceId} url={gltf.url} drive={drive} onError={() => setFailedFace(faceId)} />;
  }
  return <ProceduralAvatar key={faceId} faceId={faceId} drive={drive} />;
}

export const Avatar3D = memo(Avatar3DImpl, (a, b) => a.faceId === b.faceId && a.drive === b.drive);
