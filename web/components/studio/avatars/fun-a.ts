// Pumpkin Professor + Robot avatar builders. Conform to ./kit AvatarParts.
import { register, type AvatarParts } from "./kit";
import type * as THREE_NS from "three";

register("pumpkin", (three, p) => {
  const root = new three.Group();
  const glowMat = () => new three.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff8a00, emissiveIntensity: 1.3 });

  const body = new three.Mesh(new three.SphereGeometry(1.05, 40, 32), new three.MeshStandardMaterial({ color: p.skin, roughness: 0.55, emissive: 0x3a1500, emissiveIntensity: 0.4 }));
  body.scale.set(1.08, 0.92, 1); root.add(body);
  for (let i = 0; i < 6; i++) {
    const rib = new three.Mesh(new three.TorusGeometry(1.02, 0.035, 8, 40, Math.PI), new three.MeshStandardMaterial({ color: 0xc85e12 }));
    rib.rotation.y = (i / 6) * Math.PI; rib.rotation.z = Math.PI / 2; rib.scale.y = 0.92; root.add(rib);
  }
  // stem + leaves
  const stem = new three.Mesh(new three.CylinderGeometry(0.08, 0.13, 0.38, 8), new three.MeshStandardMaterial({ color: p.hair, roughness: 0.9 }));
  stem.position.y = 0.98; stem.rotation.z = 0.2; root.add(stem);
  const leaf = new three.Mesh(new three.SphereGeometry(0.18, 12, 8), new three.MeshStandardMaterial({ color: 0x3fae4a }));
  leaf.scale.set(1.4, 0.25, 0.7); leaf.position.set(0.2, 0.9, 0); leaf.rotation.z = 0.5; root.add(leaf);
  // mortarboard cap
  const cap = new three.Mesh(new three.BoxGeometry(1.0, 0.06, 1.0), new three.MeshStandardMaterial({ color: 0x111318 })); cap.position.y = 1.12; root.add(cap);
  const capBase = new three.Mesh(new three.CylinderGeometry(0.2, 0.22, 0.2, 20), new three.MeshStandardMaterial({ color: 0x111318 })); capBase.position.y = 1.02; root.add(capBase);
  const button = new three.Mesh(new three.SphereGeometry(0.05, 10, 10), glowMat()); button.position.y = 1.16; root.add(button);
  const tassel = new three.Mesh(new three.CylinderGeometry(0.02, 0.02, 0.35, 6), new three.MeshStandardMaterial({ color: 0xffd166 }));
  tassel.position.set(0.42, 1.0, 0); root.add(tassel);

  // carved eyes (triangles) + round glasses
  const lids: THREE_NS.Object3D[] = [];
  const brows: THREE_NS.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const eye = new three.Mesh(new three.ConeGeometry(0.17, 0.24, 3), glowMat());
    eye.position.set(0.34 * sx, 0.18, 0.92); eye.rotation.x = Math.PI / 2; root.add(eye);
    const glasses = new three.Mesh(new three.TorusGeometry(0.17, 0.02, 10, 24), new three.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6 }));
    glasses.position.set(0.34 * sx, 0.18, 1.0); root.add(glasses);
    const lid = new three.Mesh(new three.BoxGeometry(0.36, 0.24, 0.06), new three.MeshStandardMaterial({ color: p.skin }));
    lid.position.set(0.34 * sx, 0.34, 0.95); root.add(lid); lids.push(lid);
    const brow = new three.Mesh(new three.BoxGeometry(0.3, 0.05, 0.06), new three.MeshStandardMaterial({ color: 0xc85e12 }));
    brow.position.set(0.34 * sx, 0.42, 0.95); root.add(brow); brows.push(brow);
  }
  // glasses bridge
  const bridge = new three.Mesh(new three.BoxGeometry(0.3, 0.02, 0.02), new three.MeshStandardMaterial({ color: 0x1a1a1a })); bridge.position.set(0, 0.18, 1.0); root.add(bridge);

  // jagged glowing mouth
  const mouth = new three.Mesh(new three.SphereGeometry(0.3, 28, 20), glowMat());
  mouth.scale.set(1, 0.12, 0.4); mouth.position.set(0, -0.42, 0.92); root.add(mouth);

  const parts: AvatarParts = {
    root, mouth, lids, brows, lidRestY: 0.34,
    setMood: (m) => brows.forEach((b, i) => { b.position.y = 0.42 + (m === "curious" ? 0.05 : m === "stern" ? -0.06 : 0) * (i === 0 ? 1 : 1); }),
    tick: (t) => { tassel.rotation.z = Math.sin(t / 40) * 0.2; },
  };
  return parts;
}, { skin: 0xe8731a, hair: 0x2f7d32 });

register("robot", (three, p) => {
  const root = new three.Group();
  const metal = new three.MeshStandardMaterial({ color: p.skin, metalness: 0.75, roughness: 0.3 });
  const box = new three.Mesh(new three.BoxGeometry(1.5, 1.4, 1.4), metal); root.add(box);
  // panel lines + rivets
  for (const y of [0.4, -0.1, -0.5]) {
    const line = new three.Mesh(new three.BoxGeometry(1.52, 0.03, 0.02), new three.MeshStandardMaterial({ color: 0x222831 })); line.position.set(0, y, 0.71); root.add(line);
  }
  for (const sx of [-1, 1]) for (const sy of [0.55, -0.55]) {
    const rivet = new three.Mesh(new three.SphereGeometry(0.05, 10, 10), new three.MeshStandardMaterial({ color: 0x444c56 })); rivet.position.set(0.65 * sx, sy, 0.7); root.add(rivet);
  }
  // antenna with pulsing ball
  const antenna = new three.Mesh(new three.CylinderGeometry(0.03, 0.03, 0.4, 8), new three.MeshStandardMaterial({ color: 0x555c66 })); antenna.position.y = 0.95; root.add(antenna);
  const ball = new three.Mesh(new three.SphereGeometry(0.1, 16, 16), new three.MeshStandardMaterial({ color: 0xff6b5e, emissive: 0xff6b5e, emissiveIntensity: 1 })); ball.position.y = 1.2; root.add(ball);
  // ear modules
  for (const sx of [-1, 1]) { const ear = new three.Mesh(new three.CylinderGeometry(0.12, 0.12, 0.15, 16), metal); ear.rotation.z = Math.PI / 2; ear.position.set(0.78 * sx, 0, 0); root.add(ear); }

  // glowing eyes + shutter lids
  const eyeMat = new three.MeshStandardMaterial({ color: 0x34d1c4, emissive: 0x1fb5a8, emissiveIntensity: 1.1 });
  const lids: THREE_NS.Object3D[] = [];
  const eyes: THREE_NS.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const eye = new three.Mesh(new three.CylinderGeometry(0.17, 0.17, 0.06, 24), eyeMat); eye.rotation.x = Math.PI / 2; eye.position.set(0.34 * sx, 0.18, 0.72); root.add(eye); eyes.push(eye);
    const pupil = new three.Mesh(new three.SphereGeometry(0.06, 12, 12), new three.MeshStandardMaterial({ color: 0x06231f })); pupil.position.set(0.34 * sx, 0.18, 0.78); root.add(pupil);
    const lid = new three.Mesh(new three.BoxGeometry(0.38, 0.2, 0.05), metal); lid.position.set(0.34 * sx, 0.36, 0.74); root.add(lid); lids.push(lid);
  }
  // speaker-grille mouth
  const mouth = new three.Mesh(new three.BoxGeometry(0.6, 0.3, 0.08), new three.MeshStandardMaterial({ color: 0x1a1e28, emissive: 0x0a3d38, emissiveIntensity: 0.5 }));
  mouth.scale.y = 0.12; mouth.position.set(0, -0.42, 0.72); root.add(mouth);
  for (let i = -2; i <= 2; i++) { const slat = new three.Mesh(new three.BoxGeometry(0.5, 0.02, 0.02), new three.MeshStandardMaterial({ color: 0x34d1c4 })); slat.position.set(0, -0.42 + i * 0.05, 0.77); root.add(slat); }

  const parts: AvatarParts = {
    root, mouth, lids, lidRestY: 0.36,
    setMood: (m) => { eyeMat.color.set(m === "stern" ? 0xff7b6e : 0x34d1c4); eyeMat.emissiveIntensity = m === "curious" ? 1.6 : 1.1; },
    tick: (t, speaking) => { const b = ball.material as THREE_NS.MeshStandardMaterial; b.emissiveIntensity = 0.6 + Math.abs(Math.sin(t / 15)) * 0.8; eyes.forEach((e) => (e.material as THREE_NS.MeshStandardMaterial).emissiveIntensity = speaking ? 1.4 : 1.1); },
  };
  return parts;
}, { skin: 0x9aa6b2, hair: 0x34d1c4 });
