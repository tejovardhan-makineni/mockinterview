"use client";

// GltfAvatar renders a rigged Ready Player Me glTF head-and-shoulders and drives
// it from the same AvatarDrive the procedural avatar uses — but with REAL
// morph-target animation: Oculus-viseme lip-sync (from live audio analysis),
// ARKit blinks, and mood expressions. If the model fails to load it calls
// onError so Avatar3D can fall back to the procedural face.
import { memo, useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AvatarDrive } from "./Avatar3D";

type MorphTarget = { mesh: THREE.Mesh; index: number };

function GltfAvatarImpl({ url, drive, onError }: { url: string; drive: MutableRefObject<AvatarDrive>; onError?: () => void }) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    // Portrait lighting: soft key from front-right, cool rim from behind.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
    const key = new THREE.DirectionalLight(0xfff4e8, 1.4); key.position.set(1.5, 2.2, 2.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x88a0ff, 0.8); rim.position.set(-2, 1.5, -2); scene.add(rim);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);

    // Morph lookup: a viseme/blendshape can live on several meshes (head + teeth).
    let baseY = 0; // model's grounded Y after normalization (idle bob adds to this)
    const morphs: Record<string, MorphTarget[]> = {};
    const setMorph = (name: string, value: number) => {
      const t = morphs[name];
      if (!t) return;
      for (const { mesh, index } of t) mesh.morphTargetInfluences![index] = value;
    };
    const hasMorph = (name: string) => !!morphs[name];

    // Smoothed current values so lip-sync/expression don't jitter.
    const cur: Record<string, number> = {};
    const ease = (name: string, target: number, rate = 0.35) => {
      cur[name] = (cur[name] ?? 0) + (target - (cur[name] ?? 0)) * rate;
      setMorph(name, cur[name]);
    };

    const blink = { t: 0, next: 80, v: 0 };
    let root: THREE.Group | null = null;

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        root = gltf.scene;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) {
            m.frustumCulled = false;
            for (const [name, idx] of Object.entries(m.morphTargetDictionary)) {
              (morphs[name] ??= []).push({ mesh: m, index: idx as number });
            }
          }
        });
        scene.add(root);

        // NORMALIZE every model to a standard full-body height, centered with feet
        // at y=0. Source avatars vary wildly in scale/position/pose; after this,
        // the head always sits at ~1.6, so ONE fixed camera frames every avatar as
        // a clean, centered head-and-shoulders portrait.
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.7 / Math.max(0.3, size.y); // treat as ~1.7m human
        root.scale.setScalar(scale);
        const b2 = new THREE.Box3().setFromObject(root);
        const c2 = b2.getCenter(new THREE.Vector3());
        root.position.x -= c2.x;                    // center horizontally
        root.position.z -= c2.z;
        root.position.y -= b2.min.y;                // feet on the ground plane
        baseY = root.position.y;
        camera.fov = 24;
        camera.position.set(0, 1.58, 0.85);         // head-and-shoulders of a 1.7m avatar
        camera.lookAt(0, 1.48, 0);
        camera.updateProjectionMatrix();
        resize();

        el.appendChild(renderer.domElement); // ensure attached
      },
      undefined,
      () => { if (!disposed) onError?.(); }, // load error → procedural fallback
    );

    ro.observe(el);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const d = drive.current;
      if (root) {
        // ---- lip-sync from live audio (level = openness, bright = vowel color).
        // Deliberately restrained: real speech barely parts the lips, so the
        // openness is capped well below a full gape and the jaw contributes little.
        const speaking = d.speaking;
        const level = speaking ? Math.min(1, d.level ?? d.amplitude ?? 0) : 0;
        const hi = d.bright ?? 0.5; // 1 = front/sibilant (E/I/SS), 0 = back/round (O/U)
        const open = Math.min(0.6, level); // hard cap so it never yawns
        ease("viseme_aa", open * (0.38 + 0.26 * (1 - hi)));
        ease("viseme_E", open * hi * 0.5);
        ease("viseme_I", open * hi * 0.3);
        ease("viseme_O", open * (1 - hi) * 0.38);
        ease("viseme_U", open * (1 - hi) * 0.24);
        ease("viseme_SS", Math.min(1, hi * level * 2) * 0.2);
        if (hasMorph("jawOpen")) ease("jawOpen", open * 0.1);
        if (hasMorph("mouthClose")) ease("mouthClose", level < 0.03 ? 0.2 : 0);

        // ---- blink (ARKit eyeBlinkLeft/Right)
        blink.t += 1;
        if (blink.t > blink.next) { blink.v = 1; blink.next = blink.t + 100 + Math.floor(Math.abs(Math.sin(blink.t) * 160)); }
        if (blink.v > 0) blink.v = Math.max(0, blink.v - 0.2);
        const blinkAmt = blink.v > 0.5 ? (blink.v - 0.5) * 2 : 0;
        setMorph("eyeBlinkLeft", blinkAmt); setMorph("eyeBlinkRight", blinkAmt);

        // ---- expression from mood (gentle, eased)
        const mood = d.mood;
        const smile = mood === "listening" ? 0.16 : mood === "curious" ? 0.1 : speaking ? 0.06 : 0.04;
        ease("mouthSmileLeft", smile, 0.1); ease("mouthSmileRight", smile, 0.1);
        ease("browInnerUp", mood === "curious" ? 0.35 : 0.06, 0.1);
        ease("browDownLeft", mood === "stern" ? 0.25 : 0, 0.1); ease("browDownRight", mood === "stern" ? 0.25 : 0, 0.1);

        // ---- subtle idle life (head sway + breathing)
        const t = performance.now() / 1000;
        root.rotation.y = Math.sin(t * 0.5) * 0.05 * (speaking ? 1 : 0.5);
        root.rotation.x = Math.sin(t * 0.8) * 0.02;
        root.position.y = baseY + Math.sin(t * 1.4) * 0.004;
      }
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
    // drive is a stable ref read each frame; rebuild only when the model changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return <div ref={mount} className="h-full w-full" style={{ borderRadius: 12, overflow: "hidden" }} />;
}

export const GltfAvatar = memo(GltfAvatarImpl, (a, b) => a.url === b.url && a.drive === b.drive);
