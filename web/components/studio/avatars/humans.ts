// Four distinct, human-looking interviewer heads built entirely from three.js
// primitives (no external models, no DOM). Each builder returns an AvatarParts
// assembly that Avatar3D renders + animates uniformly (lip-sync, blinking,
// expression). The heads share one sculpted face rig but differ in proportions,
// skin/hair, brows and facial hair so they read as four different people.
//
// The head is a SINGLE sphere deformed vertex-by-vertex into a proper skull:
// a tapered jaw, a projecting chin, cheekbones and a slightly flatter cranium.
// That gives a clean continuous silhouette (no seams between skull/jaw spheres),
// which is the biggest driver of a polished, Memoji-adjacent look. Everything
// else (eyes, nose, lips, ears, hair) is layered on that surface.
//
// Coordinate conventions match the studio camera (looking down +Z at the
// origin, head ~1 unit tall): eyes near y=0.14 z=0.70, mouth near y=-0.45
// z=0.78, neck at y=-1.15, shoulders at y=-1.95.
import { register, type AvatarParts, type Builder } from "./kit";
import type * as THREE from "three";
import type { Mood, Palette } from "./kit";

const SHIRT = 0x2b3446; // dark shirt color shared by every interviewer

type HairFn = (ctx: BuildCtx) => void;

interface Cfg {
  feminine: boolean;
  head: [number, number, number]; // final head ellipsoid scale (w,h,d)
  jawWidth: number; // how much the lower face narrows toward the chin
  jawLength: number; // how far the chin drops (face length)
  chin: number; // forward chin projection
  cheek: number; // cheekbone volume
  browThickness: number;
  browY: number; // resting height of the brows
  browColor?: number; // defaults to hair color
  irisColor: number;
  lipColor: number;
  lipFull: number; // lower-lip fullness
  buildHair: HairFn;
  buildFacialHair?: HairFn;
}

interface BuildCtx {
  three: typeof THREE;
  head: THREE.Group;
  p: Palette;
  skinMat: THREE.MeshStandardMaterial;
  hairMat: THREE.MeshStandardMaterial;
  color: (hex: number, f?: number) => THREE.Color;
}

// Smoothstep that also works with a descending range (edge0 > edge1).
function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Sculpt a unit sphere into a head: jaw taper, chin, cheekbones, flatter nape.
function sculptHead(three: typeof THREE, geo: THREE.BufferGeometry, cfg: Cfg) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new three.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let x = v.x;
    let y = v.y;
    let z = v.z;
    const front = Math.max(0, z); // 0..1 front-ness

    // 1) Jaw taper — narrow the lower face toward the chin. Width narrows more
    //    than depth so a jawline stays readable in profile.
    const jt = smooth(0.18, -1.0, y); // 0 above the cheeks → 1 at the chin
    x *= 1 - cfg.jawWidth * jt;
    z *= 1 - cfg.jawWidth * 0.45 * jt * (z < 0 ? 1.1 : 0.5);

    // 2) Chin — push the lower-front forward and down a touch to give a jaw.
    const ct = smooth(-0.4, -0.95, y) * front;
    z += cfg.chin * ct;
    y -= cfg.jawLength * ct;

    // 3) Cheekbones — a soft outward bump on the front-sides.
    const cheekY = Math.exp(-Math.pow((y + 0.0) / 0.26, 2));
    const cheekXZ = front * Math.min(1, Math.abs(x) * 1.7);
    const cb = cfg.cheek * cheekY * cheekXZ;
    x += cb * Math.sign(x || 1) * 0.65;
    z += cb * 0.5;

    // 4) Brow ridge — a small forward lip above the eyes.
    const brow = Math.exp(-Math.pow((y - 0.24) / 0.12, 2)) * front;
    z += 0.03 * brow;

    // 5) Flatten the very back of the cranium so the head isn't a beach ball.
    if (z < -0.25) z *= 0.95;
    // and trim the top a hair so the crown reads rounder-square, not pointy.
    if (y > 0.7) y *= 0.98;

    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// Shared face rig. Returns the assembly; per-character variation comes via cfg.
function human(three: typeof THREE, p: Palette, cfg: Cfg): AvatarParts {
  const root = new three.Group();
  const color = (hex: number, f = 1) => new three.Color(hex).multiplyScalar(f);

  // Soft, slightly glossy skin — enough sheen to catch the key light without
  // looking like wet plastic.
  const skinMat = new three.MeshStandardMaterial({ color: p.skin, roughness: 0.58, metalness: 0.0 });
  const hairMat = new three.MeshStandardMaterial({ color: p.hair, roughness: 0.66, metalness: 0.04 });
  const browMat = new three.MeshStandardMaterial({ color: cfg.browColor ?? p.hair, roughness: 0.72 });

  const head = new three.Group();
  root.add(head);

  // ---- sculpted head -----------------------------------------------------
  const skullGeo = new three.SphereGeometry(1, 72, 56);
  sculptHead(three, skullGeo, cfg);
  const skull = new three.Mesh(skullGeo, skinMat);
  skull.scale.set(cfg.head[0], cfg.head[1], cfg.head[2]);
  head.add(skull);

  // Surface-ish front depth used to seat features (approx front of the skull).
  const fz = cfg.head[2];

  // ---- ears --------------------------------------------------------------
  const earX = cfg.head[0] * 0.97;
  const earInnerMat = new three.MeshStandardMaterial({ color: color(p.skin, 0.82), roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const ear = new three.Mesh(new three.SphereGeometry(0.17, 20, 20), skinMat);
    ear.scale.set(0.42, 1.0, 0.9);
    ear.position.set(earX * sx, -0.02, -0.04);
    ear.rotation.y = -0.35 * sx;
    ear.rotation.z = 0.12 * sx;
    head.add(ear);
    // inner ear shadow
    const inner = new three.Mesh(new three.SphereGeometry(0.1, 14, 14), earInnerMat);
    inner.scale.set(0.35, 0.85, 0.5);
    inner.position.set(earX * sx * 1.02, -0.02, 0.03);
    head.add(inner);
  }

  // ---- eyes (socket + sclera + iris + pupil + catchlight + lids) ---------
  const lidRestY = 0.2;
  const lids: THREE.Object3D[] = [];
  const eyeR = 0.145;
  const eyeY = 0.14;
  const eyeZ = fz * 0.82;
  const eyeX = 0.31;

  const whiteMat = new three.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.28 });
  const irisMat = new three.MeshStandardMaterial({ color: cfg.irisColor, roughness: 0.35, metalness: 0.08 });
  const irisRimMat = new three.MeshStandardMaterial({ color: color(cfg.irisColor, 0.5), roughness: 0.4 });
  const pupilMat = new three.MeshStandardMaterial({ color: 0x0a0908, roughness: 0.3 });
  const catchMat = new three.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.1 });
  const socketMat = new three.MeshStandardMaterial({ color: color(p.skin, 0.86), roughness: 0.7 });

  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? -1 : 1;
    const g = new three.Group();
    // subtle asymmetry so the pair reads as a face, not a mirror
    g.position.set(eyeX * sx, eyeY + (sx > 0 ? 0.005 : 0), eyeZ);

    // slight socket shadow just behind the lids
    const socket = new three.Mesh(new three.SphereGeometry(eyeR * 1.5, 20, 16), socketMat);
    socket.scale.set(1.05, 0.9, 0.4);
    socket.position.z = -0.03;
    g.add(socket);

    const white = new three.Mesh(new three.SphereGeometry(eyeR, 24, 22), whiteMat);
    white.scale.set(1.05, 0.92, 0.7);
    g.add(white);

    const irisRim = new three.Mesh(new three.SphereGeometry(eyeR * 0.52, 20, 18), irisRimMat);
    irisRim.position.z = eyeR * 0.66;
    irisRim.scale.z = 0.5;
    g.add(irisRim);
    const iris = new three.Mesh(new three.SphereGeometry(eyeR * 0.42, 20, 18), irisMat);
    iris.position.z = eyeR * 0.74;
    iris.scale.z = 0.55;
    g.add(iris);
    const pupil = new three.Mesh(new three.SphereGeometry(eyeR * 0.2, 16, 14), pupilMat);
    pupil.position.z = eyeR * 0.9;
    g.add(pupil);
    // catchlight — a small always-bright speck for life
    const catch1 = new three.Mesh(new three.SphereGeometry(eyeR * 0.09, 10, 10), catchMat);
    catch1.position.set(-eyeR * 0.16 * sx, eyeR * 0.2, eyeR * 0.95);
    g.add(catch1);

    // upper eyelid — the mesh Avatar3D lowers to blink. Sits above the eye at
    // rest so the eye reads open; a blink drops it ~0.18 to cover the sclera.
    const lid = new three.Mesh(
      new three.SphereGeometry(eyeR * 1.16, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
      skinMat,
    );
    lid.scale.set(1.1, 1.05, 0.6);
    lid.position.y = lidRestY;
    g.add(lid);
    lids.push(lid);

    // lower lid — a soft skin ridge (static)
    const lower = new three.Mesh(
      new three.SphereGeometry(eyeR * 1.12, 22, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38),
      skinMat,
    );
    lower.scale.set(1.05, 0.7, 0.58);
    lower.position.y = -eyeR * 0.5;
    g.add(lower);

    head.add(g);
  }

  // ---- eyebrows (returned in `brows`) ------------------------------------
  const brows: THREE.Object3D[] = [];
  const browRest: { y: number; rz: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? -1 : 1;
    const bg = new three.Group();
    const restY = cfg.browY;
    const restRz = -0.09 * sx; // gentle natural arch (outer end down)
    bg.position.set(eyeX * sx, restY, fz * 0.9);
    bg.rotation.z = restRz;
    // one smooth capsule per brow, laid horizontally along the ridge
    const brow = new three.Mesh(
      new three.CapsuleGeometry(cfg.browThickness * 0.5, 0.19, 6, 14),
      browMat,
    );
    brow.rotation.z = Math.PI * 0.5;
    brow.scale.set(1, 1, 0.55); // flatten front-to-back against the brow ridge
    bg.add(brow);
    head.add(bg);
    brows.push(bg);
    browRest.push({ y: restY, rz: restRz });
  }

  // ---- nose (bridge + tip + wings + nostrils) ----------------------------
  const noseZ = fz * 0.98;
  const bridge = new three.Mesh(new three.CapsuleGeometry(0.05, 0.3, 8, 14), skinMat);
  bridge.scale.set(0.9, 1.0, 0.75);
  bridge.position.set(0, -0.04, noseZ - 0.08);
  bridge.rotation.x = 0.1;
  head.add(bridge);
  const tip = new three.Mesh(new three.SphereGeometry(0.08, 20, 18), skinMat);
  tip.scale.set(1.05, 0.9, 1.1);
  tip.position.set(0, -0.23, noseZ);
  head.add(tip);
  const nostrilMat = new three.MeshStandardMaterial({ color: color(p.skin, 0.5), roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const wing = new three.Mesh(new three.SphereGeometry(0.058, 16, 14), skinMat);
    wing.scale.set(0.85, 0.85, 0.9);
    wing.position.set(0.072 * sx, -0.24, noseZ - 0.05);
    head.add(wing);
    const nostril = new three.Mesh(new three.SphereGeometry(0.026, 10, 10), nostrilMat);
    nostril.position.set(0.06 * sx, -0.27, noseZ - 0.02);
    head.add(nostril);
  }

  // ---- lips (upper static + lower = the lip-sync mouth) ------------------
  const lipMat = new three.MeshStandardMaterial({ color: cfg.lipColor, roughness: 0.42, metalness: 0.0 });
  const mouthY = -0.46;
  const mouthZ = fz * 0.9;
  const lipW = cfg.feminine ? 0.22 : 0.225;

  // upper lip: one slim tapered piece with a faint cupid's-bow dip in the
  // middle. Thinner and set slightly back so it doesn't parallel the lower lip.
  const upper = new three.Mesh(new three.SphereGeometry(lipW * 0.98, 30, 18), lipMat);
  upper.scale.set(1, cfg.feminine ? 0.2 : 0.17, 0.34);
  upper.position.set(0, mouthY + 0.055, mouthZ - 0.02);
  head.add(upper);
  const bow = new three.Mesh(new three.SphereGeometry(lipW * 0.12, 12, 10), skinMat);
  bow.position.set(0, mouthY + 0.085, mouthZ + 0.01);
  head.add(bow); // tiny philtrum notch

  // lower lip is the `mouth`: x/z baked into scale, y driven each frame by the
  // caller (rest scale.y ~0.12, opens up to ~1.4). Fuller than the upper lip.
  const mouth = new three.Mesh(new three.SphereGeometry(lipW, 30, 22), lipMat);
  mouth.scale.set(0.94, 0.12, cfg.lipFull);
  mouth.position.set(0, mouthY - 0.01, mouthZ);
  head.add(mouth);

  // dark mouth line/interior so an open mouth shows depth (sits behind lips)
  const cavity = new three.Mesh(
    new three.SphereGeometry(lipW * 0.85, 20, 16),
    new three.MeshStandardMaterial({ color: 0x2c1010, roughness: 0.85 }),
  );
  cavity.scale.set(0.9, 0.32, 0.26);
  cavity.position.set(0, mouthY + 0.03, mouthZ - 0.08);
  head.add(cavity);

  // upturned corners for a resting friendly set (also moved by mood)
  const corners: THREE.Object3D[] = [];
  const cornerRestY: number[] = [];
  for (const sx of [-1, 1]) {
    const corner = new three.Mesh(new three.SphereGeometry(0.032, 12, 12), lipMat);
    const cy = mouthY + 0.05;
    corner.position.set(lipW * 0.86 * sx, cy, mouthZ - 0.04);
    head.add(corner);
    corners.push(corner);
    cornerRestY.push(cy);
  }

  // ---- hair + facial hair (per character) --------------------------------
  const ctx: BuildCtx = { three, head, p, skinMat, hairMat, color };
  cfg.buildHair(ctx);
  cfg.buildFacialHair?.(ctx);

  // ---- neck + shoulders --------------------------------------------------
  const neck = new three.Mesh(new three.CylinderGeometry(0.24, 0.34, 0.6, 28), skinMat);
  neck.position.y = -1.1;
  root.add(neck);
  const shirtMat = new three.MeshStandardMaterial({ color: SHIRT, roughness: 0.85, metalness: 0.05 });
  const torso = new three.Mesh(new three.SphereGeometry(1.1, 36, 26, 0, Math.PI * 2, 0, Math.PI * 0.5), shirtMat);
  torso.scale.set(1.4, 0.9, 0.74);
  torso.position.y = -1.95;
  root.add(torso);
  // simple collar
  const collar = new three.Mesh(new three.TorusGeometry(0.33, 0.09, 14, 30, Math.PI), shirtMat);
  collar.position.set(0, -1.32, 0.16);
  collar.rotation.x = Math.PI * 0.5;
  root.add(collar);

  // ---- expression --------------------------------------------------------
  const setMood = (m: Mood) => {
    for (let i = 0; i < brows.length; i++) {
      const b = brows[i];
      const rest = browRest[i];
      const sx = i === 0 ? -1 : 1;
      switch (m) {
        case "curious":
          b.position.y = rest.y + 0.05;
          b.rotation.z = rest.rz - 0.05 * sx;
          break;
        case "stern":
          b.position.y = rest.y - 0.05;
          b.rotation.z = rest.rz + 0.18 * sx;
          break;
        case "listening":
          b.position.y = rest.y + 0.025;
          b.rotation.z = rest.rz;
          break;
        case "speaking":
        case "neutral":
        default:
          b.position.y = rest.y;
          b.rotation.z = rest.rz;
          break;
      }
    }
    // mouth corners: lift for warm/attentive moods, flatten when stern
    for (let i = 0; i < corners.length; i++) {
      const lift = m === "stern" ? -0.035 : m === "listening" || m === "curious" ? 0.03 : 0.0;
      corners[i].position.y = cornerRestY[i] + lift;
    }
  };

  // gentle idle life: slow "breathing" of the chest + a hint on the shoulders
  const tick = (t: number, _speaking: boolean, _amp: number) => {
    const breathe = 1 + Math.sin(t / 55) * 0.012;
    torso.scale.set(1.4 * breathe, 0.9, 0.74 * breathe);
  };

  return { root, mouth, lids, brows, lidRestY, setMood, tick };
}

// ---------------------------------------------------------------------------
// Hair builders
// ---------------------------------------------------------------------------

// Ava — long, side-parted hair framing the face and falling past the jaw.
const avaHair: HairFn = ({ three, head, hairMat, color, p }) => {
  const sheen = new three.MeshStandardMaterial({ color: color(p.hair, 1.25), roughness: 0.5, metalness: 0.05 });

  // crown cap covering the top/back/sides. The dome is cut ABOVE the equator
  // (thetaLength < 0.5π) so its rim rides the forehead, and tilted slightly
  // forward-up so the front hairline stays well clear of the eyes.
  const crown = new three.Mesh(
    new three.SphereGeometry(1.05, 48, 44, 0, Math.PI * 2, 0, Math.PI * 0.46),
    hairMat,
  );
  crown.scale.set(0.96, 1.06, 1.02);
  crown.position.set(0.02, 0.16, -0.04);
  crown.rotation.x = -0.1;
  head.add(crown);

  // back mass hanging behind the shoulders
  const back = new three.Mesh(new three.SphereGeometry(0.82, 36, 36), hairMat);
  back.scale.set(1.0, 1.35, 0.62);
  back.position.set(0, -0.6, -0.42);
  head.add(back);

  // side curtains framing the face, falling past the jaw
  for (const sx of [-1, 1]) {
    const front = new three.Mesh(new three.CapsuleGeometry(0.2, 0.9, 10, 18), hairMat);
    front.scale.set(0.8, 1, 0.72);
    front.position.set(0.7 * sx, -0.3, 0.22);
    front.rotation.z = 0.1 * sx;
    front.rotation.x = 0.06;
    head.add(front);

    const behind = new three.Mesh(new three.CapsuleGeometry(0.24, 0.95, 10, 18), hairMat);
    behind.scale.set(0.9, 1, 0.78);
    behind.position.set(0.62 * sx, -0.42, -0.08);
    behind.rotation.z = 0.06 * sx;
    head.add(behind);
  }

  // side-swept fringe sitting on the upper forehead (well above the brows),
  // with a highlighted strand for a soft parted look.
  const fringe = new three.Mesh(
    new three.SphereGeometry(0.86, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.4),
    hairMat,
  );
  fringe.scale.set(1.0, 0.52, 0.64);
  fringe.position.set(0.2, 0.58, 0.54);
  fringe.rotation.z = 0.3;
  fringe.rotation.x = 0.5;
  head.add(fringe);
  const strand = new three.Mesh(new three.CapsuleGeometry(0.045, 0.42, 8, 14), sheen);
  strand.position.set(-0.26, 0.56, 0.62);
  strand.rotation.z = 1.05;
  strand.rotation.x = 0.4;
  head.add(strand);
};

// Maya — rounded, voluminous curly / afro-textured hair.
const mayaHair: HairFn = ({ three, head, hairMat, color, p }) => {
  const baseMat = hairMat;
  const litMat = new three.MeshStandardMaterial({ color: color(p.hair, 1.6), roughness: 0.7 });

  // Rounded back/top mass — pushed BACK so it never covers the face front.
  const base = new three.Mesh(new three.SphereGeometry(1.1, 44, 40), baseMat);
  base.scale.set(1.06, 1.02, 0.86);
  base.position.set(0, 0.34, -0.28);
  head.add(base);

  // Curl clusters form the voluminous silhouette. A face window (front-center
  // oval) is left clear so eyes/nose/mouth are never occluded.
  const R = 1.16;
  let seed = 0.123; // deterministic jitter without a module-level RNG
  const rnd = () => {
    seed = (seed * 9301 + 0.49297) % 1;
    return seed;
  };
  const curlGeoA = new three.SphereGeometry(0.17, 12, 12);
  const curlGeoB = new three.SphereGeometry(0.13, 12, 12);
  const curlCount = 120;
  for (let i = 0; i < curlCount; i++) {
    const u = rnd();
    const v = rnd();
    const phi = Math.acos(1 - 0.98 * v); // bias toward top/sides
    const theta = u * Math.PI * 2;
    const cx = R * Math.sin(phi) * Math.cos(theta) * 1.06;
    const cy = R * Math.cos(phi) * 1.02 + 0.3;
    const cz = R * Math.sin(phi) * Math.sin(theta) * 0.98 - 0.08;
    // face window: skip curls that would sit over the front of the face
    if (cz > 0.28 && cy < 0.52 && cy > -0.75 && Math.abs(cx) < 0.62) continue;
    const curl = new three.Mesh(rnd() > 0.5 ? curlGeoA : curlGeoB, rnd() > 0.72 ? litMat : baseMat);
    curl.position.set(cx, cy, cz);
    head.add(curl);
  }

  // A clean curly hairline arcing across the upper forehead (above the brows).
  for (let k = -3; k <= 3; k++) {
    const curl = new three.Mesh(curlGeoB, rnd() > 0.6 ? litMat : baseMat);
    const a = (k / 3) * 1.05; // across the brow
    curl.position.set(Math.sin(a) * 0.62, 0.66 - Math.abs(k) * 0.02, 0.5 + Math.cos(a) * 0.12);
    head.add(curl);
  }
};

// Leo — short, tidy side-part crop.
const leoHair: HairFn = ({ three, head, hairMat, color, p }) => {
  const sheen = new three.MeshStandardMaterial({ color: color(p.hair, 1.3), roughness: 0.5, metalness: 0.05 });
  const cap = new three.Mesh(
    new three.SphereGeometry(1.03, 44, 44, 0, Math.PI * 2, 0, Math.PI * 0.44),
    hairMat,
  );
  cap.scale.set(0.94, 1.0, 0.96);
  cap.position.set(0.02, 0.14, -0.04);
  cap.rotation.x = -0.08;
  head.add(cap);
  // swept fringe on the upper forehead with a subtle part highlight
  const fringe = new three.Mesh(
    new three.SphereGeometry(0.86, 30, 20, 0, Math.PI * 2, 0, Math.PI * 0.34),
    hairMat,
  );
  fringe.scale.set(0.98, 0.48, 0.64);
  fringe.position.set(0.14, 0.56, 0.52);
  fringe.rotation.z = 0.2;
  fringe.rotation.x = 0.5;
  head.add(fringe);
  const part = new three.Mesh(new three.CapsuleGeometry(0.035, 0.36, 8, 12), sheen);
  part.position.set(-0.2, 0.56, 0.6);
  part.rotation.z = 0.75;
  part.rotation.x = 0.4;
  head.add(part);
  // short sideburns
  for (const sx of [-1, 1]) {
    const burn = new three.Mesh(new three.CapsuleGeometry(0.055, 0.2, 6, 10), hairMat);
    burn.position.set(0.74 * sx, 0.02, 0.12);
    head.add(burn);
  }
};

// Noah — very short crop (beard added separately).
const noahHair: HairFn = ({ three, head, hairMat }) => {
  const cap = new three.Mesh(
    new three.SphereGeometry(1.0, 44, 44, 0, Math.PI * 2, 0, Math.PI * 0.42),
    hairMat,
  );
  cap.scale.set(0.94, 0.94, 0.94);
  cap.position.set(0, 0.14, -0.04);
  cap.rotation.x = -0.08;
  head.add(cap);
  // clean short front hairline sitting high on the forehead
  const front = new three.Mesh(new three.SphereGeometry(0.9, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.3), hairMat);
  front.scale.set(0.96, 0.4, 0.6);
  front.position.set(0, 0.56, 0.5);
  front.rotation.x = 0.5;
  head.add(front);
};

// ---------------------------------------------------------------------------
// Facial hair builders
// ---------------------------------------------------------------------------

// Leo — light stubble shadow + faint mustache.
const leoFacial: HairFn = ({ three, head, color, p }) => {
  const stubbleMat = new three.MeshStandardMaterial({
    color: color(p.hair, 0.9),
    roughness: 0.95,
    transparent: true,
    opacity: 0.42,
  });
  const stubble = new three.Mesh(
    new three.SphereGeometry(0.82, 34, 30, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48),
    stubbleMat,
  );
  stubble.scale.set(0.9, 0.8, 0.9);
  stubble.position.set(0, -0.42, 0.02);
  head.add(stubble);

  const stacheMat = new three.MeshStandardMaterial({ color: color(p.hair, 1.15), roughness: 0.9 });
  for (const sx of [-1, 1]) {
    const half = new three.Mesh(new three.CapsuleGeometry(0.03, 0.1, 6, 10), stacheMat);
    half.rotation.z = Math.PI * 0.5 + 0.3 * sx;
    half.position.set(0.06 * sx, -0.36, 0.82);
    head.add(half);
  }
};

// Noah — neat full beard along the jawline + mustache.
const noahFacial: HairFn = ({ three, head, hairMat }) => {
  const beard = new three.Mesh(
    new three.SphereGeometry(0.78, 40, 34, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.54),
    hairMat,
  );
  beard.scale.set(0.92, 0.95, 0.96);
  beard.position.set(0, -0.5, 0.02);
  head.add(beard);

  // chin extension for a neat rounded point
  const chin = new three.Mesh(new three.SphereGeometry(0.22, 22, 22), hairMat);
  chin.scale.set(0.9, 0.95, 0.85);
  chin.position.set(0, -0.82, 0.32);
  head.add(chin);

  // sideburns connecting the beard up to the hairline
  for (const sx of [-1, 1]) {
    const burn = new three.Mesh(new three.CapsuleGeometry(0.09, 0.42, 8, 12), hairMat);
    burn.position.set(0.7 * sx, -0.12, 0.14);
    burn.rotation.z = 0.1 * sx;
    head.add(burn);
  }

  // mustache above the upper lip, joined to the beard
  const stache = new three.Mesh(new three.CapsuleGeometry(0.045, 0.22, 8, 12), hairMat);
  stache.rotation.z = Math.PI * 0.5;
  stache.position.set(0, -0.35, 0.82);
  head.add(stache);
};

// ---------------------------------------------------------------------------
// Register the four interviewers
// ---------------------------------------------------------------------------

const ava: Builder = (three, p) =>
  human(three, p, {
    feminine: true,
    head: [0.82, 1.02, 0.86],
    jawWidth: 0.3,
    jawLength: 0.06,
    chin: 0.05,
    cheek: 0.06,
    browThickness: 0.04,
    browY: 0.35,
    irisColor: 0x6b4a2f, // warm brown
    lipColor: 0xbf7a64,
    lipFull: 0.46,
    buildHair: avaHair,
  });

const maya: Builder = (three, p) =>
  human(three, p, {
    feminine: true,
    head: [0.83, 1.0, 0.86],
    jawWidth: 0.29,
    jawLength: 0.05,
    chin: 0.05,
    cheek: 0.07,
    browThickness: 0.045,
    browY: 0.34,
    irisColor: 0x2e1c12, // deep brown
    lipColor: 0x995a47,
    lipFull: 0.47,
    buildHair: mayaHair,
  });

const leo: Builder = (three, p) =>
  human(three, p, {
    feminine: false,
    head: [0.87, 0.99, 0.88],
    jawWidth: 0.2, // broader, squarer jaw
    jawLength: 0.07,
    chin: 0.08,
    cheek: 0.05,
    browThickness: 0.07,
    browY: 0.33,
    irisColor: 0x4a3524, // hazel-brown
    lipColor: 0xb56a55,
    lipFull: 0.42,
    buildHair: leoHair,
    buildFacialHair: leoFacial,
  });

const noah: Builder = (three, p) =>
  human(three, p, {
    feminine: false,
    head: [0.88, 0.98, 0.89],
    jawWidth: 0.18,
    jawLength: 0.07,
    chin: 0.09,
    cheek: 0.05,
    browThickness: 0.075,
    browY: 0.33,
    irisColor: 0x2a1a12, // very dark brown
    lipColor: 0x854e3c,
    lipFull: 0.42,
    buildHair: noahHair,
    buildFacialHair: noahFacial,
  });

register("ava", ava, { skin: 0xf1c6a0, hair: 0x4a3126 });
register("maya", maya, { skin: 0xba7c53, hair: 0x1c1512 });
register("leo", leo, { skin: 0xe8b48c, hair: 0x2c2118 });
register("noah", noah, { skin: 0x9c6640, hair: 0x120d0a });
