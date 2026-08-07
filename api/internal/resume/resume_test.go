package resume

import (
	"testing"

	"github.com/ledongthuc/pdf"
)

// glyph lays out one character at x with the given width, all on one baseline.
func glyph(s string, x, w float64) pdf.Text {
	return pdf.Text{S: s, X: x, W: w, Y: 700, FontSize: 10}
}

// TestSpaceGlyphs reproduces the reported bug: PDFs encode inter-word spacing as
// horizontal gaps (TJ kerning), which the raw text stream drops, yielding
// "ElasticAPM". spaceGlyphs must reinsert the space from the geometry gap.
func TestSpaceGlyphs(t *testing.T) {
	// "AB CD": A,B adjacent (2pt glyphs), then a 3pt gap, then C,D adjacent.
	// Gap threshold at fontsize 10 is 2.0pt, so only the 3pt gap becomes a space.
	chars := []pdf.Text{
		glyph("A", 0, 2),
		glyph("B", 2, 2), // adjacent to A -> no space
		glyph("C", 7, 2), // 3pt gap from B's end (4) -> space
		glyph("D", 9, 2), // adjacent to C -> no space
	}
	if got, want := spaceGlyphs(chars), "AB CD"; got != want {
		t.Fatalf("spaceGlyphs = %q, want %q", got, want)
	}
}

// TestSpaceGlyphsNewLine checks that a change in baseline starts a new line.
func TestSpaceGlyphsNewLine(t *testing.T) {
	chars := []pdf.Text{
		{S: "H", X: 0, W: 2, Y: 700, FontSize: 10},
		{S: "i", X: 2, W: 2, Y: 700, FontSize: 10},
		{S: "T", X: 0, W: 2, Y: 680, FontSize: 10}, // 20pt lower -> new line
		{S: "here", X: 2, W: 8, Y: 680, FontSize: 10},
	}
	if got, want := spaceGlyphs(chars), "Hi\nThere"; got != want {
		t.Fatalf("spaceGlyphs = %q, want %q", got, want)
	}
}

// TestSpaceGlyphsEmpty guards the no-glyphs fallback path.
func TestSpaceGlyphsEmpty(t *testing.T) {
	if got := spaceGlyphs(nil); got != "" {
		t.Fatalf("spaceGlyphs(nil) = %q, want empty", got)
	}
}
