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

registerGltf("sophia", "/avatars/rpm-female.glb");
