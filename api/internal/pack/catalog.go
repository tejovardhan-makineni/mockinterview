package pack

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

// Catalog is an in-memory, validated index of all packs.
type Catalog struct {
	byID  map[string]Pack
	order []string
}

// Load reads every *.json file under dir, unmarshals + validates each pack
// against the corpus, and indexes it. Errors are aggregated like corpus.Load.
func Load(dir string, cat *corpus.Catalog) (*Catalog, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read packs dir %s: %w", dir, err)
	}
	c := &Catalog{byID: map[string]Pack{}}
	var errs []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		var p Pack
		if err := json.Unmarshal(b, &p); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		if err := Validate(p, cat); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		if p.Revision == 0 {
			p.Revision = 1
		}
		if p.ReviewStatus == "" {
			p.ReviewStatus = "preview"
		}
		if p.SourceNote == "" {
			p.SourceNote = "Community practice approximation; not an official or guaranteed current employer interview process."
		}
		if _, dup := c.byID[p.ID]; dup {
			errs = append(errs, fmt.Sprintf("%s: duplicate id %s", e.Name(), p.ID))
			continue
		}
		c.byID[p.ID] = p
		c.order = append(c.order, p.ID)
	}
	if len(errs) > 0 {
		return nil, fmt.Errorf("pack load errors:\n  %s", strings.Join(errs, "\n  "))
	}
	sort.Strings(c.order)
	return c, nil
}

// Count returns the number of loaded packs.
func (c *Catalog) Count() int { return len(c.order) }

// Get returns a pack by id.
func (c *Catalog) Get(id string) (Pack, bool) {
	p, ok := c.byID[id]
	return p, ok
}

// All returns every pack, in stable (sorted-id) order.
func (c *Catalog) All() []Pack {
	out := make([]Pack, 0, len(c.order))
	for _, id := range c.order {
		out = append(out, c.byID[id])
	}
	return out
}

// List returns packs targeting the given profession. An empty profession
// returns all packs.
func (c *Catalog) List(profession string) []Pack {
	if profession == "" {
		return c.All()
	}
	out := make([]Pack, 0, len(c.order))
	for _, id := range c.order {
		p := c.byID[id]
		for _, a := range p.Areas {
			if a == profession {
				out = append(out, p)
				break
			}
		}
	}
	return out
}
