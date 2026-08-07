package persona

// Face is a client-rendered 3D avatar. Kind is "realistic" for the rigged glTF
// interviewers rendered by GltfAvatar with viseme lip-sync. Gltf points at the
// bundled model under web/public/avatars; the web registry keys off the same ID.
type Face struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Gltf  string `json:"gltf"`
	Kind  string `json:"kind"` // realistic
}

// Faces is the catalog served to clients. To add a face, bundle a rigged .glb
// under web/public/avatars, append one line here, and registerGltf() it under
// the same ID in web/components/studio/avatars/realistic.ts.
var Faces = []Face{
	// Realistic glTF interviewers (rendered by GltfAvatar with viseme lip-sync).
	{ID: "sophia", Label: "Sophia", Kind: "realistic", Gltf: "/avatars/rpm-female.glb"},
}

// FaceByID returns the catalog entry and whether it was found.
func FaceByID(id string) (Face, bool) {
	for _, f := range Faces {
		if f.ID == id {
			return f, true
		}
	}
	return Face{}, false
}

// ValidFace reports whether id is a known face.
func ValidFace(id string) bool {
	_, ok := FaceByID(id)
	return ok
}
