// Command previewformat inspects authored context locally; no DB or API key.
package main

import (
	"flag"
	"fmt"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/live"
	"os"
)

func main() {
	dir := flag.String("corpus", "data/corpus", "scenario directory (sibling formats directory required for v1)")
	id := flag.String("id", "work-sample-reservation-review", "scenario id")
	flag.Parse()
	cat, err := corpus.Load(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	q, ok := cat.Get(*id)
	if !ok {
		fmt.Fprintln(os.Stderr, "unknown scenario")
		os.Exit(1)
	}
	fmt.Println(live.SystemPrompt(q, "neutral", 3, "intro", "", "", q.Minutes, "aoede", "en", live.SectionPlan(q, false, ""), ""))
}
