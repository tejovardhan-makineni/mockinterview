package corpus

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type FormatStage struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Kind     string  `json:"kind"`
	Guidance string  `json:"guidance"`
	Share    float64 `json:"share"`
}
type Format struct {
	SchemaVersion   int           `json:"schema_version"`
	ID              string        `json:"id"`
	Revision        int           `json:"revision"`
	Name            string        `json:"name"`
	InterviewerRole string        `json:"interviewer_role"`
	Workspaces      []string      `json:"workspaces"`
	ToolPolicy      string        `json:"tool_policy"`
	Stages          []FormatStage `json:"stages"`
}

func ValidateFormat(f Format) error {
	if f.SchemaVersion != 1 || !idRe.MatchString(f.ID) || f.Revision < 1 || f.Name == "" || f.InterviewerRole == "" || f.ToolPolicy == "" {
		return fmt.Errorf("invalid format metadata: %s", f.ID)
	}
	if len(f.Workspaces) == 0 {
		return fmt.Errorf("%s: workspaces required", f.ID)
	}
	for _, w := range f.Workspaces {
		if !validModalities[w] {
			return fmt.Errorf("%s: unknown workspace", f.ID)
		}
	}
	if len(f.Stages) < 2 || len(f.Stages) > 8 || f.Stages[0].Kind != "intro" || f.Stages[len(f.Stages)-1].Kind != "wrap" {
		return fmt.Errorf("%s: stages need intro and wrap boundaries", f.ID)
	}
	sum := 0.0
	seen := map[string]bool{}
	for _, s := range f.Stages {
		if !idRe.MatchString(s.ID) || seen[s.ID] || s.Title == "" || s.Guidance == "" || s.Kind == "" || s.Share <= 0 || s.Share > 1 {
			return fmt.Errorf("%s: invalid stage", f.ID)
		}
		sum += s.Share
		seen[s.ID] = true
	}
	if sum < .9999 || sum > 1.0001 {
		return fmt.Errorf("%s: stage shares must sum to one", f.ID)
	}
	return nil
}

func loadFormats(dir string) (map[string]Format, error) {
	out := map[string]Format{}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var f Format
		d := json.NewDecoder(bytes.NewReader(b))
		d.DisallowUnknownFields()
		if err = d.Decode(&f); err != nil {
			return nil, err
		}
		if err = d.Decode(new(any)); err != io.EOF {
			return nil, fmt.Errorf("%s: expected one JSON object", entry.Name())
		}
		if err = ValidateFormat(f); err != nil {
			return nil, err
		}
		if f.ID+".json" != entry.Name() {
			return nil, fmt.Errorf("format filename must match id")
		}
		out[f.ID] = f
	}
	return out, nil
}

func containsString(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
