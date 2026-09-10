package persona

// Face is an original code-drawn animated portrait served by the web client.
// No third-party avatar binary is required or redistributed.
type Face struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Gltf  string `json:"gltf,omitempty"`
	Kind  string `json:"kind"`
}

var Faces = []Face{
	{ID: "alex", Label: "Alex", Kind: "illustrated"},
	{ID: "jordan", Label: "Jordan", Kind: "illustrated"},
	{ID: "sam", Label: "Sam", Kind: "illustrated"},
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
