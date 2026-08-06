// Four distinct, human-looking interviewer heads built entirely from three.js
// primitives (no external models, no DOM). Each builder returns an AvatarParts
// assembly that Avatar3D renders + animates uniformly (lip-sync, blinking,
// expression). The heads share a common face rig but differ in proportions,
// hair, brows and facial hair so they read as four different people.
//
// Coordinate conventions match the studio camera (looking down +Z at the
// origin, head ~1 unit radius): eyes near y=0.12 z=0.72, mouth near y=-0.42
// z=0.74, neck at y=-1.15, shoulders at y=-1.9.
import { register, type AvatarParts, type Builder } from "./kit";
import type * as THREE from "three";
import type { Mood, Palette } from "./kit";

const SHIRT = 0x2a3242; // dark shirt color shared by every interviewer

type HairFn = (ctx: BuildCtx) => void;

interface Cfg {
  feminine: boolean;
  head: [number, number, number]; // skull ellipsoid scale
  jaw: [number, number, number]; // jaw ellipsoid scale
  jawY: number;
  browThickness: number; // vertical thickness of eyebrows
  browColor?: number; // defaults to hair color
  irisColor: number;
  lipColor: number;
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

// Shared face rig. Returns the assembly; per-character variation comes in via cfg.
function human(three: typeof THREE, p: Palette, cfg: Cfg): AvatarParts {
  const root = new three.Group();

  const color = (hex: number, f = 1) => new three.Color(hex).multiplyScalar(f);

  const skinMat = new three.MeshStandardMaterial({ color: p.skin, roughness: 0.7, metalness: 0.02 });
  const hairMat = new three.MeshStandardMaterial({ color: p.hair, roughness: 0.9, metalness: 0 });
  const browMat = new three.MeshStandardMaterial({ color: cfg.browColor ?? p.hair, roughness: 0.85 });

  const head = new three.Group();
  root.add(head);

  // ---- skull + jaw -------------------------------------------------------
  const skull = new three.Mesh(new three.SphereGeometry(1, 48, 48), skinMat);
  skull.scale.set(cfg.head[0], cfg.head[1], cfg.head[2]);
  head.add(skull);

  const jaw = new three.Mesh(new three.SphereGeometry(0.72, 36, 32), skinMat);
  jaw.scale.set(cfg.jaw[0], cfg.jaw[1], cfg.jaw[2]);
  jaw.position.y = cfg.jawY;
  head.add(jaw);

  // cheeks — subtle volume so the lower face isn't a flat sphere
  for (const sx of [-1, 1]) {
    const cheek = new three.Mesh(new three.SphereGeometry(0.3, 20, 20), skinMat);
    cheek.scale.set(0.9, 0.8, 0.7);
    cheek.position.set(0.42 * sx, -0.28, 0.62);
    head.add(cheek);
  }

  // ---- ears --------------------------------------------------------------
  const earX = cfg.head[0] * 0.98;
  for (const sx of [-1, 1]) {
    const ear = new three.Mesh(new three.SphereGeometry(0.16, 18, 18), skinMat);
    ear.scale.set(0.55, 1, 0.85);
    ear.position.set(earX * sx, -0.04, -0.02);
    head.add(ear);
    const lobe = new three.Mesh(new three.SphereGeometry(0.07, 12, 12), skinMat);
    lobe.position.set(earX * sx, -0.16, 0.0);
    head.add(lobe);
  }

  // ---- eyes (sclera + iris + pupil + upper lid) --------------------------
  const lidRestY = 0.16;
  const lids: THREE.Object3D[] = [];
  const eyeR = 0.15;
  const eyeY = 0.12;
  const eyeZ = 0.72;
  const eyeX = 0.32;
  const whiteMat = new three.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35 });
  const irisMat = new three.MeshStandardMaterial({ color: cfg.irisColor, roughness: 0.45, metalness: 0.05 });
  const pupilMat = new three.MeshStandardMaterial({ color: 0x0b0a09, roughness: 0.3 });
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? -1 : 1;
    const g = new three.Group();
    // subtle asymmetry so the pair reads as a face, not a mirror
    g.position.set(eyeX * sx, eyeY + (sx > 0 ? 0.006 : 0), eyeZ);

    const white = new three.Mesh(new three.SphereGeometry(eyeR, 22, 22), whiteMat);
    white.scale.z = 0.5;
    g.add(white);

    const iris = new three.Mesh(new three.SphereGeometry(eyeR * 0.46, 18, 18), irisMat);
    iris.position.z = eyeR * 0.72;
    g.add(iris);

    const pupil = new three.Mesh(new three.SphereGeometry(eyeR * 0.22, 14, 14), pupilMat);
    pupil.position.z = eyeR * 0.9;
    g.add(pupil);

    // upper eyelid — the mesh Avatar3D lowers to blink
    const lid = new three.Mesh(
      new three.SphereGeometry(eyeR * 1.16, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      skinMat,
    );
    lid.scale.z = 0.55;
    lid.position.y = lidRestY;
    g.add(lid);
    lids.push(lid);

    head.add(g);
  }

  // ---- eyebrows (returned in `brows`) ------------------------------------
  const brows: THREE.Object3D[] = [];
  const browRest: { y: number; rz: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const sx = i === 0 ? -1 : 1;
    const bg = new three.Group();
    const restY = 0.34;
    const restRz = -0.06 * sx; // gentle natural arch (outer end down)
    bg.position.set(eyeX * sx, restY, 0.83);
    bg.rotation.z = restRz;
    const brow = new three.Mesh(
      new three.BoxGeometry(0.26, cfg.browThickness, 0.07),
      browMat,
    );
    // taper the outer end down a touch by rotating the box slightly
    brow.rotation.x = 0.15;
    bg.add(brow);
    head.add(bg);
    brows.push(bg);
    browRest.push({ y: restY, rz: restRz });
  }

  // ---- nose (bridge + tip + nostrils) ------------------------------------
  const bridge = new three.Mesh(new three.BoxGeometry(0.12, 0.34, 0.14), skinMat);
  bridge.position.set(0, 0.02, 0.84);
  bridge.rotation.x = -0.12;
  head.add(bridge);
  const tip = new three.Mesh(new three.SphereGeometry(0.11, 18, 18), skinMat);
  tip.scale.set(1, 0.85, 1);
  tip.position.set(0, -0.16, 0.9);
  head.add(tip);
  for (const sx of [-1, 1]) {
    const nostril = new three.Mesh(new three.SphereGeometry(0.06, 12, 12), skinMat);
    nostril.position.set(0.07 * sx, -0.18, 0.86);
    head.add(nostril);
  }

  // ---- lips (upper static + lower = the lip-sync mouth) ------------------
  const lipMat = new three.MeshStandardMaterial({ color: cfg.lipColor, roughness: 0.5 });
  const mouthY = -0.42;
  const mouthZ = 0.76;
  const lipW = cfg.feminine ? 0.23 : 0.22;

  const upper = new three.Mesh(new three.SphereGeometry(lipW, 26, 18), lipMat);
  upper.scale.set(1, cfg.feminine ? 0.11 : 0.09, 0.4);
  upper.position.set(0, mouthY + 0.055, mouthZ);
  head.add(upper);

  // lower lip is the `mouth`: x/z baked into scale, y driven each frame by
  // the caller (rest ~0.12, open up to ~1.4).
  const mouth = new three.Mesh(new three.SphereGeometry(lipW, 28, 20), lipMat);
  mouth.scale.set(1, 0.12, cfg.feminine ? 0.44 : 0.4);
  mouth.position.set(0, mouthY, mouthZ);
  head.add(mouth);

  // dark mouth interior so an open mouth shows depth (sits just behind lips)
  const cavity = new three.Mesh(new three.SphereGeometry(lipW * 0.8, 20, 16), new three.MeshStandardMaterial({ color: 0x3a1414, roughness: 0.8 }));
  cavity.scale.set(0.9, 0.5, 0.3);
  cavity.position.set(0, mouthY + 0.02, mouthZ - 0.06);
  head.add(cavity);

  // closed subtle smile: upturned corners
  for (const sx of [-1, 1]) {
    const corner = new three.Mesh(new three.SphereGeometry(0.045, 10, 10), lipMat);
    corner.position.set(lipW * 0.82 * sx, mouthY + 0.05, mouthZ - 0.02);
    head.add(corner);
  }

  // ---- hair + facial hair (per character) --------------------------------
  const ctx: BuildCtx = { three, head, p, skinMat, hairMat, color };
  cfg.buildHair(ctx);
  cfg.buildFacialHair?.(ctx);

  // ---- neck + shoulders --------------------------------------------------
  const neck = new three.Mesh(new three.CylinderGeometry(0.26, 0.32, 0.55, 24), skinMat);
  neck.position.y = -1.12;
  root.add(neck);
  const shirtMat = new three.MeshStandardMaterial({ color: SHIRT, roughness: 0.92 });
  const torso = new three.Mesh(new three.SphereGeometry(1.1, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), shirtMat);
  torso.scale.set(1.35, 0.85, 0.72);
  torso.position.y = -1.92;
  root.add(torso);
  // collar
  const collar = new three.Mesh(new three.TorusGeometry(0.34, 0.08, 12, 28, Math.PI), shirtMat);
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
          // raise both brows, slight extra arch
          b.position.y = rest.y + 0.05;
          b.rotation.z = rest.rz - 0.04 * sx;
          break;
        case "stern":
          // lower brows and angle the inner ends downward (furrow)
          b.position.y = rest.y - 0.045;
          b.rotation.z = rest.rz + 0.16 * sx;
          break;
        case "listening":
          // soft, attentive — a touch higher and relaxed
          b.position.y = rest.y + 0.02;
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
  };

  return { root, mouth, lids, brows, lidRestY, setMood };
}

// ---------------------------------------------------------------------------
// Hair builders
// ---------------------------------------------------------------------------

// Ava — longer hair framing the face, falling past the jaw.
const avaHair: HairFn = ({ three, head, hairMat }) => {
  // crown + back mass
  const crown = new three.Mesh(
    new three.SphereGeometry(1.05, 44, 44, 0, Math.PI * 2, 0, Math.PI * 0.72),
    hairMat,
  );
  crown.scale.set(0.9, 1.05, 0.94);
  crown.position.y = 0.08;
  head.add(crown);

  // back length hanging behind the shoulders
  const back = new three.Mesh(new three.SphereGeometry(0.85, 32, 32), hairMat);
  back.scale.set(0.95, 1.25, 0.6);
  back.position.set(0, -0.55, -0.42);
  head.add(back);

  // side curtains framing the face, falling past the jaw (jaw ~ -0.55)
  for (const sx of [-1, 1]) {
    const front = new three.Mesh(new three.CapsuleGeometry(0.17, 0.7, 8, 16), hairMat);
    front.scale.set(0.85, 1, 0.7);
    front.position.set(0.66 * sx, -0.2, 0.28);
    front.rotation.z = 0.12 * sx;
    front.rotation.x = 0.1;
    head.add(front);

    const behind = new three.Mesh(new three.CapsuleGeometry(0.2, 0.85, 8, 16), hairMat);
    behind.scale.set(0.9, 1, 0.75);
    behind.position.set(0.6 * sx, -0.35, -0.05);
    behind.rotation.z = 0.08 * sx;
    head.add(behind);
  }

  // soft side-swept fringe across the forehead
  const fringe = new three.Mesh(new three.SphereGeometry(0.9, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat);
  fringe.scale.set(0.9, 0.6, 0.55);
  fringe.position.set(0.12, 0.5, 0.62);
  fringe.rotation.z = 0.2;
  head.add(fringe);
};

// Maya — rounded, voluminous curly / afro-textured hair.
const mayaHair: HairFn = ({ three, head, hairMat, color, p }) => {
  const baseMat = hairMat;
  const litMat = new three.MeshStandardMaterial({ color: color(p.hair, 1.5), roughness: 0.95 });

  // big rounded base volume sitting high and wide around the skull
  const base = new three.Mesh(new three.SphereGeometry(1.18, 40, 40), baseMat);
  base.scale.set(1.02, 1.0, 0.98);
  base.position.set(0, 0.24, -0.06);
  head.add(base);

  // curl clusters spread over the upper hemisphere for texture + silhouette
  const R = 1.18;
  let seed = 0.123; // deterministic-ish jitter without module-level RNG
  const rnd = () => {
    seed = (seed * 9301 + 0.49297) % 1;
    return seed;
  };
  const curlCount = 90;
  for (let i = 0; i < curlCount; i++) {
    const u = rnd();
    const v = rnd();
    const phi = Math.acos(1 - 0.95 * v); // bias toward the top/sides
    const theta = u * Math.PI * 2;
    const cx = R * Math.sin(phi) * Math.cos(theta) * 1.02;
    const cy = R * Math.cos(phi) * 1.0 + 0.24;
    const cz = R * Math.sin(phi) * Math.sin(theta) * 0.98 - 0.06;
    // keep the face clear (no curls low in front)
    if (cz > 0.5 && cy < 0.15) continue;
    const cr = 0.15 + rnd() * 0.08;
    const curl = new three.Mesh(new three.SphereGeometry(cr, 12, 12), rnd() > 0.7 ? litMat : baseMat);
    curl.position.set(cx, cy, cz);
    head.add(curl);
  }

  // small hairline curls along the temples/forehead edge
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const curl = new three.Mesh(new three.SphereGeometry(0.12, 10, 10), baseMat);
      curl.position.set((0.55 + k * 0.02) * sx, 0.42 - k * 0.14, 0.5 - k * 0.08);
      head.add(curl);
    }
  }
};

// Leo — short crop.
const leoHair: HairFn = ({ three, head, hairMat }) => {
  const cap = new three.Mesh(
    new three.SphereGeometry(1.01, 40, 40, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairMat,
  );
  cap.scale.set(0.86, 0.95, 0.88);
  cap.position.y = 0.09;
  head.add(cap);
  // slightly textured front hairline
  const front = new three.Mesh(new three.BoxGeometry(1.0, 0.12, 0.2), hairMat);
  front.position.set(0, 0.52, 0.55);
  front.rotation.x = -0.35;
  head.add(front);
  // short sideburns
  for (const sx of [-1, 1]) {
    const burn = new three.Mesh(new three.CapsuleGeometry(0.06, 0.16, 6, 10), hairMat);
    burn.position.set(0.74 * sx, 0.02, 0.1);
    head.add(burn);
  }
};

// Noah — short crop (beard added separately).
const noahHair: HairFn = ({ three, head, hairMat }) => {
  const cap = new three.Mesh(
    new three.SphereGeometry(1.0, 40, 40, 0, Math.PI * 2, 0, Math.PI * 0.5),
    hairMat,
  );
  cap.scale.set(0.85, 0.9, 0.87);
  cap.position.y = 0.12;
  head.add(cap);
  // clean short front edge
  const front = new three.Mesh(new three.BoxGeometry(0.95, 0.1, 0.18), hairMat);
  front.position.set(0, 0.56, 0.52);
  front.rotation.x = -0.3;
  head.add(front);
};

// ---------------------------------------------------------------------------
// Facial hair builders
// ---------------------------------------------------------------------------

// Leo — light mustache + stubble shadow across the jaw.
const leoFacial: HairFn = ({ three, head, color, p }) => {
  // stubble: a translucent darkened-skin shell over the lower face
  const stubbleMat = new three.MeshStandardMaterial({
    color: color(p.skin, 0.55),
    roughness: 0.95,
    transparent: true,
    opacity: 0.5,
  });
  const stubble = new three.Mesh(
    new three.SphereGeometry(0.76, 32, 28, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48),
    stubbleMat,
  );
  stubble.scale.set(0.95, 0.78, 0.92);
  stubble.position.set(0, -0.36, 0.04);
  head.add(stubble);

  // light mustache above the upper lip
  const stacheMat = new three.MeshStandardMaterial({ color: color(p.hair, 1.35), roughness: 0.9 });
  for (const sx of [-1, 1]) {
    const half = new three.Mesh(new three.CapsuleGeometry(0.035, 0.12, 6, 10), stacheMat);
    half.rotation.z = Math.PI * 0.5 + 0.25 * sx;
    half.position.set(0.07 * sx, -0.32, 0.84);
    head.add(half);
  }
};

// Noah — neat full beard along the jawline + mustache.
const noahFacial: HairFn = ({ three, head, hairMat }) => {
  // full beard shell wrapping the jaw and chin, extending below the chin
  const beard = new three.Mesh(
    new three.SphereGeometry(0.78, 36, 32, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58),
    hairMat,
  );
  beard.scale.set(0.97, 0.95, 0.94);
  beard.position.set(0, -0.42, 0.02);
  head.add(beard);

  // chin extension for a neat squared-off point
  const chin = new three.Mesh(new three.SphereGeometry(0.28, 20, 20), hairMat);
  chin.scale.set(0.9, 1.0, 0.8);
  chin.position.set(0, -0.82, 0.34);
  head.add(chin);

  // sideburns connecting the beard up to the hairline
  for (const sx of [-1, 1]) {
    const burn = new three.Mesh(new three.CapsuleGeometry(0.09, 0.4, 8, 12), hairMat);
    burn.position.set(0.72 * sx, -0.1, 0.14);
    burn.rotation.z = 0.1 * sx;
    head.add(burn);
  }

  // mustache above the upper lip, joined to the beard
  const stache = new three.Mesh(new three.CapsuleGeometry(0.05, 0.24, 8, 12), hairMat);
  stache.rotation.z = Math.PI * 0.5;
  stache.position.set(0, -0.31, 0.84);
  head.add(stache);
};

// ---------------------------------------------------------------------------
// Register the four interviewers
// ---------------------------------------------------------------------------

const ava: Builder = (three, p) =>
  human(three, p, {
    feminine: true,
    head: [0.8, 1.0, 0.84],
    jaw: [0.86, 0.58, 0.82], // narrower, softer jaw
    jawY: -0.56,
    browThickness: 0.045,
    irisColor: 0x6b4a2f, // warm brown
    lipColor: 0xb5735f,
    buildHair: avaHair,
  });

const maya: Builder = (three, p) =>
  human(three, p, {
    feminine: true,
    head: [0.81, 0.99, 0.85],
    jaw: [0.87, 0.6, 0.83],
    jawY: -0.55,
    browThickness: 0.05,
    irisColor: 0x2e1c12, // deep brown
    lipColor: 0x8f5240,
    buildHair: mayaHair,
  });

const leo: Builder = (three, p) =>
  human(three, p, {
    feminine: false,
    head: [0.85, 0.98, 0.86],
    jaw: [0.95, 0.66, 0.86], // broader, squarer jaw
    jawY: -0.53,
    browThickness: 0.075,
    irisColor: 0x4a3524, // hazel-brown
    lipColor: 0xb56a55,
    buildHair: leoHair,
    buildFacialHair: leoFacial,
  });

const noah: Builder = (three, p) =>
  human(three, p, {
    feminine: false,
    head: [0.86, 0.97, 0.87],
    jaw: [0.96, 0.68, 0.87],
    jawY: -0.52,
    browThickness: 0.08,
    irisColor: 0x241610, // very dark brown
    lipColor: 0x7a4635,
    buildHair: noahHair,
    buildFacialHair: noahFacial,
  });

register("ava", ava, { skin: 0xf1c9a5, hair: 0x3a2a22 });
register("maya", maya, { skin: 0xc98c63, hair: 0x1c1512 });
register("leo", leo, { skin: 0xe8b48c, hair: 0x22262e });
register("noah", noah, { skin: 0xa26d45, hair: 0x0f0c0a });
