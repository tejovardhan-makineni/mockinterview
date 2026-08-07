package persona

// Face is a client-rendered 3D avatar style. Kind is "human" for standard
// interviews or "fun" for themed characters (e.g. a Pumpkin Professor for
// academic/PhD interviews). Gltf is a hook for a future real glTF model URL;
// empty means the client builds the head procedurally from its avatar registry
// (web/components/studio/avatars/*). The web registry keys off the same ID.
type Face struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Gltf  string `json:"gltf"`
	Kind  string `json:"kind"` // human | fun
}

// Faces is the catalog served to clients. To add a face, append one line here
// and register a matching builder under the same ID in the web avatar registry.
var Faces = []Face{
	// Realistic glTF interviewers (rendered by GltfAvatar with viseme lip-sync).
	{ID: "sophia", Label: "Sophia", Kind: "realistic", Gltf: "/avatars/rpm-female.glb"},
	{ID: "cand1", Label: "Person 1", Kind: "realistic"},
	{ID: "cand2", Label: "Person 2", Kind: "realistic"},
	{ID: "cand3", Label: "Person 3", Kind: "realistic"},
	{ID: "cand4", Label: "Person 4", Kind: "realistic"},
	{ID: "cand5", Label: "Person 5", Kind: "realistic"},
	{ID: "cand6", Label: "Person 6", Kind: "realistic"},
	// Fun themed characters (deliberately stylized novelty, not realism).
	{ID: "pumpkin", Label: "Pumpkin Professor", Kind: "fun"},
	{ID: "robot", Label: "Interviewer-9000 (Robot)", Kind: "fun"},
	{ID: "wizard", Label: "The Wizard", Kind: "fun"},
	{ID: "alien", Label: "Zorp (Alien)", Kind: "fun"},
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
