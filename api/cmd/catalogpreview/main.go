// catalogpreview regenerates the bundled demonstration catalog using only the
// same public projections as the API. Run from api with:
// go run ./cmd/catalogpreview -output ../web/lib/features/catalog-preview.json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/pack"
)

type preview struct {
	Professions []corpus.Profession `json:"professions"`
	Questions   []corpus.Summary    `json:"questions"`
	Packs       []pack.Pack         `json:"packs"`
}

// Include the complete public bank so every pinned or pooled practice round
// can resolve offline. Pack definitions are the same public payload as GET /packs/{id}.
func snapshot(cat *corpus.Catalog, packs *pack.Catalog) preview {
	return preview{Professions: cat.Professions(), Questions: cat.List("", "", ""), Packs: packs.All()}
}

func main() {
	directory := flag.String("corpus", "data/corpus", "validated corpus directory")
	packDirectory := flag.String("packs", "data/packs", "validated pack directory")
	output := flag.String("output", "", "output file; defaults to stdout")
	flag.Parse()
	cat, err := corpus.Load(*directory)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	packs, err := pack.Load(*packDirectory, cat)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data, err := json.MarshalIndent(snapshot(cat, packs), "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data = append(data, '\n')
	if *output == "" {
		_, err = os.Stdout.Write(data)
	} else {
		err = os.WriteFile(*output, data, 0644)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
