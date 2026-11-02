// Tests EPUB navigation target parsing.
// Verifies document paths and decoded fragments remain distinct.
package scanner

import "testing"

func TestResolveBookTargetPreservesFragment(t *testing.T) {
	entryPath, fragment := resolveBookTarget("OPS/nav.xhtml", "text/chapters.xhtml#chapter%202")
	if entryPath != "OPS/text/chapters.xhtml" {
		t.Fatalf("unexpected path: %q", entryPath)
	}
	if fragment != "chapter 2" {
		t.Fatalf("unexpected fragment: %q", fragment)
	}
}

func TestResolveBookTargetRejectsExternalTarget(t *testing.T) {
	entryPath, fragment := resolveBookTarget("OPS/nav.xhtml", "https://example.com/chapter.xhtml#one")
	if entryPath != "" || fragment != "" {
		t.Fatalf("unexpected external target: %q %q", entryPath, fragment)
	}
}
