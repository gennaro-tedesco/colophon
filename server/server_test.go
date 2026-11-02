// Tests reader table-of-contents rendering.
// Verifies fragment targets produce one active logical entry.
package server

import (
	"strings"
	"testing"

	"colophon/scanner"
)

func TestBuildTOCHTMLSelectsOneFragment(t *testing.T) {
	entries := []scanner.TOCEntry{
		{Title: "Chapter One", Path: "chapters.xhtml", Fragment: "pgepubid00005"},
		{Title: "Chapter Three", Path: "chapters.xhtml", Fragment: "pgepubid00007"},
	}
	html := string(buildTOCHTML(entries, []string{"chapters.xhtml"}, "book.epub", "chapters.xhtml", "pgepubid00007"))
	if strings.Count(html, "group-item active") != 1 {
		t.Fatalf("expected one active entry: %s", html)
	}
	if !strings.Contains(html, `data-toc-fragment="pgepubid00007"`) {
		t.Fatalf("missing fragment metadata: %s", html)
	}
	if !strings.Contains(html, "frag=pgepubid00007") {
		t.Fatalf("missing fragment link: %s", html)
	}
}
