// Realistic glTF interviewer faces (Ready Player Me — synthetic avatars, not
// real people, so no likeness/consent concern). Each carries Oculus visemes
// (viseme_aa/E/I/O/U/…) + ARKit blendshapes (jawOpen, eyeBlink*, mouthSmile*,
// brows) so GltfAvatar drives real morph-target lip-sync, blinking and
// expressions. Side-effect import registers them, like the procedural builders.
//
// The .glb is bundled under /public/avatars and loaded at runtime. To add more
// realistic faces, create an avatar at readyplayer.me (export with
// "ARKit,Oculus Visemes"), drop the .glb in public/avatars, and registerGltf().
import { registerGltf } from "./kit";

// Ready Player Me CDN avatars, requested WITH the viseme + ARKit rig so
// GltfAvatar can lip-sync/blink them. These load correctly-centered/scaled
// (unlike random re-exports), so framing is consistent. Bundled Sophia stays as
// the always-available default; the CDN ones are additional options.
const rpm = (id: string) => `https://models.readyplayer.me/${id}.glb?morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024`;

registerGltf("sophia", "/avatars/rpm-female.glb");
registerGltf("cand1", rpm("68e7de6f3448aa53bed9b8a1"));
registerGltf("cand2", rpm("68eba1d1715955684cd37e23"));
registerGltf("cand3", rpm("68eba3d4f7af368e4e3a7ae3"));
registerGltf("cand4", rpm("68eba4c70823a207ba1e82f0"));
registerGltf("cand5", rpm("641abfe8398f7e86e69897bb"));
registerGltf("cand6", rpm("641ac17c04207164c855f2d5"));
