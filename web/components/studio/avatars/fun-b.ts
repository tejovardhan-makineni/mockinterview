// Fun themed interviewer characters — WIZARD and ALIEN — built entirely from
// three.js primitives + MeshStandardMaterial. Each builder returns an
// AvatarParts assembly (root/mouth/lids/brows/lidRestY/setMood/tick) that
// Avatar3D renders and animates uniformly: mouth.scale.y for talking
// (rest ~0.12, open ~1.4), lids lowered from lidRestY to blink, setMood for
// expression, tick(t, speaking, amp) for per-frame flourishes.
//
// No window/document access — everything is built from the passed-in `three`.
import { register, type AvatarParts, type Builder, type Mood } from "./kit";
import type * as THREE from "three";

// ---------------------------------------------------------------------------
// WIZARD — kindly human-ish head, tall pointed indigo hat with curved brim +
// gold stars, long flowing brows, big flowing beard, mustache, floating orb.
// ---------------------------------------------------------------------------
const wizard: Builder = (three, p) => {
  const root = new three.Group();

  const skin = p.skin || 0xe8b48c;
  const skinMat = new three.MeshStandardMaterial({ color: skin, roughness: 0.72, metalness: 0.02 });
  const hairColor = p.hair || 0xcfd2d8; // flowing grey/white
  const hairMat = new three.MeshStandardMaterial({ color: hairColor, roughness: 0.95 });

  // --- head + jaw --------------------------------------------------------
  const skull = new three.Mesh(new three.SphereGeometry(1, 48, 48), skinMat);
  skull.scale.set(0.82, 1, 0.85);
  root.add(skull);
  const jaw = new three.Mesh(new three.SphereGeometry(0.7, 32, 32), skinMat);
  jaw.scale.set(0.9, 0.62, 0.85);
  jaw.position.y = -0.52;
  root.add(jaw);

  // rosy cheeks for a kindly look
  const cheekMat = new three.MeshStandardMaterial({ color: 0xe59a86, roughness: 0.85, transparent: true, opacity: 0.55 });
  for (const sx of [-1, 1]) {
    const cheek = new three.Mesh(new three.SphereGeometry(0.16, 16, 16), cheekMat);
    cheek.scale.set(1, 0.7, 0.4);
    cheek.position.set(0.34 * sx, -0.18, 0.74);
    root.add(cheek);
  }

  // --- eyes with warm irises --------------------------------------------
  const lids: THREE.Object3D[] = [];
  const lidRestY = 0.16;
  const eyeWhiteMat = new three.MeshStandardMaterial({ color: 0xfdf6ee, roughness: 0.35 });
  const irisMat = new three.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.4, emissive: 0x2a1608, emissiveIntensity: 0.35 });
  const pupilMat = new three.MeshStandardMaterial({ color: 0x120a04, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const g = new three.Group();
    g.position.set(0.3 * sx, 0.12, 0.72);
    const r = 0.14;
    const white = new three.Mesh(new three.SphereGeometry(r, 20, 20), eyeWhiteMat);
    white.scale.z = 0.55;
    g.add(white);
    const iris = new three.Mesh(new three.SphereGeometry(r * 0.5, 16, 16), irisMat);
    iris.position.z = r * 0.72;
    g.add(iris);
    const pupil = new three.Mesh(new three.SphereGeometry(r * 0.24, 12, 12), pupilMat);
    pupil.position.z = r * 0.92;
    g.add(pupil);
    // upper lid (skin cap) — Avatar3D lowers this from lidRestY to blink
    const lid = new three.Mesh(
      new three.SphereGeometry(r * 1.18, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
      skinMat,
    );
    lid.scale.z = 0.55;
    lid.position.y = lidRestY;
    g.add(lid);
    lids.push(lid);
    root.add(g);
  }

  // --- nose --------------------------------------------------------------
  const nose = new three.Mesh(new three.ConeGeometry(0.1, 0.3, 16), skinMat);
  nose.rotation.x = Math.PI * 0.5;
  nose.position.set(0, -0.06, 0.86);
  root.add(nose);

  // --- mouth (lower lip / opening, partly visible under the mustache) ----
  const mouth = new three.Mesh(
    new three.SphereGeometry(0.2, 28, 20),
    new three.MeshStandardMaterial({ color: 0x7c2b28, roughness: 0.5 }),
  );
  mouth.scale.set(1, 0.12, 0.4);
  mouth.position.set(0, -0.44, 0.76);
  root.add(mouth);

  // --- flowing brows (returned as `brows`) -------------------------------
  const brows: THREE.Object3D[] = [];
  const browGeo = new three.BoxGeometry(0.34, 0.07, 0.1);
  for (const sx of [-1, 1]) {
    const brow = new three.Mesh(browGeo, hairMat);
    brow.position.set(0.3 * sx, 0.34, 0.78);
    brow.rotation.z = -0.16 * sx; // gentle outward droop
    brow.scale.set(1, 1, 1);
    root.add(brow);
    brows.push(brow);
    // wispy tuft trailing off the outer end
    const tuft = new three.Mesh(new three.ConeGeometry(0.05, 0.22, 8), hairMat);
    tuft.position.set(0.2 * sx, 0.02, 0);
    tuft.rotation.z = (Math.PI / 2) * sx;
    brow.add(tuft);
  }

  // --- mustache (over the mouth) ----------------------------------------
  const mustache = new three.Group();
  mustache.position.set(0, -0.34, 0.8);
  for (const sx of [-1, 1]) {
    const half = new three.Mesh(new three.SphereGeometry(0.16, 18, 14), hairMat);
    half.scale.set(1.35, 0.55, 0.55);
    half.position.set(0.12 * sx, 0, 0);
    half.rotation.z = 0.18 * sx;
    mustache.add(half);
  }
  root.add(mustache);

  // --- big flowing beard (lathe) reaching past the neck ------------------
  const beardPts: THREE.Vector2[] = [
    new three.Vector2(0.02, -0.28),
    new three.Vector2(0.46, -0.42),
    new three.Vector2(0.52, -0.66),
    new three.Vector2(0.46, -0.94),
    new three.Vector2(0.34, -1.24),
    new three.Vector2(0.2, -1.56),
    new three.Vector2(0.08, -1.82),
    new three.Vector2(0.0, -1.98),
  ];
  const beard = new three.Mesh(new three.LatheGeometry(beardPts, 28), hairMat);
  beard.scale.set(1, 1, 0.72);
  beard.position.set(0, 0, 0.34);
  root.add(beard);

  // --- TALL wizard hat (its own group, prominent, with a bent tip) -------
  const hatMat = new three.MeshStandardMaterial({ color: 0x3a2b7c, roughness: 0.7, metalness: 0.1 }); // deep indigo
  const goldMat = new three.MeshStandardMaterial({ color: 0xffcf4d, roughness: 0.35, metalness: 0.4, emissive: 0x6b4e00, emissiveIntensity: 0.5 });
  const hat = new three.Group();
  hat.position.y = 0.72;

  // wide curved brim via lathe (dips down then curls up at the rim)
  const brimPts: THREE.Vector2[] = [
    new three.Vector2(0.0, 0.0),
    new three.Vector2(0.62, -0.02),
    new three.Vector2(1.04, -0.06),
    new three.Vector2(1.28, 0.02),
    new three.Vector2(1.34, 0.16),
    new three.Vector2(1.28, 0.2),
    new three.Vector2(1.16, 0.1),
  ];
  const brim = new three.Mesh(new three.LatheGeometry(brimPts, 40), hatMat);
  brim.scale.set(0.62, 0.62, 0.62);
  brim.position.y = 0.02;
  hat.add(brim);

  // tall cone — split into a straight lower section + a bent tip section
  const coneLower = new three.Mesh(new three.CylinderGeometry(0.28, 0.66, 1.15, 28, 1, true), hatMat);
  coneLower.position.y = 0.62;
  hat.add(coneLower);
  const tip = new three.Group();
  tip.position.y = 1.18;
  const coneTip = new three.Mesh(new three.ConeGeometry(0.28, 0.62, 28), hatMat);
  coneTip.position.y = 0.28;
  tip.add(coneTip);
  tip.rotation.z = 0.4; // slightly bent tip
  tip.position.x = 0.02;
  hat.add(tip);

  // a few small gold stars scattered on the cone
  const starGeo = new three.OctahedronGeometry(0.06, 0);
  const starSpots: Array<[number, number, number]> = [
    [0.2, 0.5, 0.5],
    [-0.28, 0.85, 0.35],
    [0.12, 1.05, -0.42],
    [-0.1, 0.65, -0.5],
    [0.3, 1.02, 0.28],
  ];
  for (const [sx, sy, sz] of starSpots) {
    const star = new three.Mesh(starGeo, goldMat);
    star.scale.set(1, 1.5, 0.4);
    star.position.set(sx, sy, sz);
    star.rotation.set(Math.random() * 1, Math.random() * 3, Math.random() * 1);
    hat.add(star);
  }
  // gold band around the base of the cone
  const band = new three.Mesh(new three.TorusGeometry(0.6, 0.05, 10, 32), goldMat);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.14;
  hat.add(band);

  root.add(hat);

  // --- floating glowing orb near the head (animated in tick) -------------
  const orbMat = new three.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x4aa0ff, emissiveIntensity: 1.4, roughness: 0.2, transparent: true, opacity: 0.9 });
  const orb = new three.Mesh(new three.SphereGeometry(0.12, 20, 20), orbMat);
  const orbBaseX = 1.05;
  const orbBaseY = 0.1;
  orb.position.set(orbBaseX, orbBaseY, 0.7);
  root.add(orb);
  const halo = new three.Mesh(new three.SphereGeometry(0.18, 16, 16), new three.MeshStandardMaterial({ color: 0x4aa0ff, emissive: 0x2a70cc, emissiveIntensity: 0.8, transparent: true, opacity: 0.22 }));
  orb.add(halo);

  // --- expression --------------------------------------------------------
  const browRestY = 0.34;
  const setMood = (m: Mood) => {
    const curious = m === "curious";
    const stern = m === "stern";
    for (let i = 0; i < brows.length; i++) {
      const b = brows[i];
      const sx = i === 0 ? -1 : 1;
      // raise the bushy brows on curious, furrow (inner-down) on stern
      b.position.y = browRestY + (curious ? 0.12 : 0) - (stern ? 0.05 : 0);
      b.rotation.z = -0.16 * sx + (stern ? 0.28 * sx : 0) - (curious ? 0.06 * sx : 0);
      b.position.x = 0.3 * sx + (stern ? -0.03 * sx : 0);
    }
  };

  // --- per-frame flourishes ---------------------------------------------
  const tick = (t: number, speaking: boolean, amp: number) => {
    // orb bobs in a gentle orbit and pulses brighter while speaking
    orb.position.x = orbBaseX + Math.sin(t / 40) * 0.06;
    orb.position.y = orbBaseY + Math.sin(t / 22) * 0.12 + 0.2;
    orb.position.z = 0.7 + Math.cos(t / 40) * 0.06;
    const pulse = 1.2 + Math.sin(t / 10) * 0.25 + (speaking ? amp * 1.5 : 0);
    orbMat.emissiveIntensity = pulse;
    orb.rotation.y = t / 30;
  };

  const parts: AvatarParts = { root, mouth, lids, brows, lidRestY, setMood, tick };
  return parts;
};

// ---------------------------------------------------------------------------
// ALIEN — smooth elongated cranium (big top, small chin), pale green sheen,
// large black almond eyes with a glossy highlight, tiny nostrils, small mouth,
// wobbling antennae. Translucent/emissive skin feel.
// ---------------------------------------------------------------------------
const alien: Builder = (three, p) => {
  const root = new three.Group();

  const skin = p.skin || 0x7bd88f; // pale green
  const skinMat = new three.MeshStandardMaterial({
    color: skin,
    roughness: 0.32,
    metalness: 0.12,
    emissive: 0x1f5a2c,
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.97,
  });

  // --- elongated cranium via lathe (larger at top, taper to small chin) --
  const skullPts: THREE.Vector2[] = [
    new three.Vector2(0.0, 1.18),
    new three.Vector2(0.34, 1.08),
    new three.Vector2(0.62, 0.86),
    new three.Vector2(0.8, 0.5),
    new three.Vector2(0.86, 0.12),
    new three.Vector2(0.82, -0.24),
    new three.Vector2(0.66, -0.58),
    new three.Vector2(0.42, -0.88),
    new three.Vector2(0.2, -1.1),
    new three.Vector2(0.0, -1.2),
  ];
  const skull = new three.Mesh(new three.LatheGeometry(skullPts, 48), skinMat);
  skull.scale.set(0.82, 1, 0.9); // subtly narrower side-to-side
  root.add(skull);

  // faint neck ridges
  const ridgeMat = new three.MeshStandardMaterial({ color: 0x5cbf72, roughness: 0.4, emissive: 0x184a24, emissiveIntensity: 0.3 });
  for (let i = 0; i < 3; i++) {
    const ridge = new three.Mesh(new three.TorusGeometry(0.26 - i * 0.02, 0.03, 8, 28), ridgeMat);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.set(0, -1.0 - i * 0.16, 0.05);
    ridge.scale.set(1, 0.75, 1);
    root.add(ridge);
  }

  // --- large black almond eyes with glossy highlight ---------------------
  const lids: THREE.Object3D[] = [];
  const lidRestY = 0.16;
  const eyeMat = new three.MeshStandardMaterial({ color: 0x05070a, roughness: 0.08, metalness: 0.3, emissive: 0x0a0f18, emissiveIntensity: 0.25 });
  const glossMat = new three.MeshStandardMaterial({ color: 0xdff2ff, roughness: 0.1, emissive: 0x9fd0ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.8 });
  const eyeGroups: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const g = new three.Group();
    g.position.set(0.34 * sx, 0.16, 0.5);
    g.rotation.z = 0.34 * sx; // angled, classic almond tilt
    g.rotation.y = -0.28 * sx; // wrap toward the sides of the head
    const eye = new three.Mesh(new three.SphereGeometry(0.26, 28, 24), eyeMat);
    eye.scale.set(1.35, 0.8, 0.4); // large, flattened almond
    g.add(eye);
    const gloss = new three.Mesh(new three.SphereGeometry(0.06, 12, 12), glossMat);
    gloss.position.set(-0.12 * sx, 0.08, 0.12);
    gloss.scale.set(1.4, 0.9, 0.5);
    g.add(gloss);
    // thin lid cover (blinks)
    const lid = new three.Mesh(new three.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), skinMat);
    lid.scale.set(1.35, 0.8, 0.42);
    lid.position.y = lidRestY;
    g.add(lid);
    lids.push(lid);
    root.add(g);
    eyeGroups.push(g);
  }

  // --- tiny nostrils -----------------------------------------------------
  const nostrilMat = new three.MeshStandardMaterial({ color: 0x2b5c37, roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const n = new three.Mesh(new three.SphereGeometry(0.03, 10, 10), nostrilMat);
    n.scale.set(1, 1.3, 0.6);
    n.position.set(0.06 * sx, -0.28, 0.78);
    root.add(n);
  }

  // --- small mouth (scales to talk) --------------------------------------
  const mouth = new three.Mesh(
    new three.SphereGeometry(0.12, 24, 18),
    new three.MeshStandardMaterial({ color: 0x2b5c37, roughness: 0.5, emissive: 0x0f2e1a, emissiveIntensity: 0.3 }),
  );
  mouth.scale.set(1, 0.12, 0.4);
  mouth.position.set(0, -0.52, 0.72);
  root.add(mouth);

  // --- antennae stalks with tips (wobble in tick) ------------------------
  const stalkMat = new three.MeshStandardMaterial({ color: 0x5cbf72, roughness: 0.5 });
  const tipMat = new three.MeshStandardMaterial({ color: 0xbafff0, emissive: 0x3fe0c0, emissiveIntensity: 1.2, roughness: 0.2 });
  const antennae: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const a = new three.Group();
    a.position.set(0.22 * sx, 1.02, 0);
    a.rotation.z = -0.3 * sx;
    const stalk = new three.Mesh(new three.CylinderGeometry(0.02, 0.035, 0.5, 10), stalkMat);
    stalk.position.y = 0.25;
    a.add(stalk);
    const tip = new three.Mesh(new three.SphereGeometry(0.075, 16, 16), tipMat);
    tip.position.y = 0.52;
    a.add(tip);
    root.add(a);
    antennae.push(a);
  }

  // --- expression --------------------------------------------------------
  const eyeBaseTilt = (i: number) => (i === 0 ? -1 : 1); // sx per eye
  const setMood = (m: Mood) => {
    const curious = m === "curious";
    const stern = m === "stern";
    for (let i = 0; i < eyeGroups.length; i++) {
      const g = eyeGroups[i];
      const sx = eyeBaseTilt(i);
      // stern narrows the eyes; curious opens + tilts them inquisitively
      g.scale.y = stern ? 0.55 : curious ? 1.08 : 1;
      g.rotation.z = 0.34 * sx + (curious ? 0.1 * sx : 0) - (stern ? 0.12 * sx : 0);
    }
    // skin/eyes shimmer a touch more when curious
    eyeMat.emissiveIntensity = curious ? 0.55 : 0.25;
    skinMat.emissiveIntensity = curious ? 0.4 : stern ? 0.2 : 0.28;
  };

  // --- per-frame flourishes ---------------------------------------------
  const tick = (t: number, speaking: boolean, amp: number) => {
    // gentle antenna wobble; livelier while speaking
    const life = speaking ? 1 + amp * 1.4 : 0.6;
    for (let i = 0; i < antennae.length; i++) {
      const a = antennae[i];
      const sx = i === 0 ? -1 : 1;
      a.rotation.z = -0.3 * sx + Math.sin(t / 26 + i * 1.3) * 0.12 * life;
      a.rotation.x = Math.sin(t / 34 + i) * 0.08 * life;
    }
    // faint breathing sheen on the skin
    skinMat.emissiveIntensity = 0.26 + Math.sin(t / 45) * 0.05 + (speaking ? amp * 0.3 : 0);
  };

  const parts: AvatarParts = { root, mouth, lids, lidRestY, setMood, tick };
  return parts;
};

register("wizard", wizard, { skin: 0xe8b48c, hair: 0xcfd2d8 });
register("alien", alien, { skin: 0x7bd88f, hair: 0x111111 });

export { wizard, alien };
