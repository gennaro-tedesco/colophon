package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework CoreText -framework Foundation -framework AppKit
#import <CoreText/CoreText.h>
#include <stdlib.h>

static char** fontFamilyList(int *count) {
	CFArrayRef families = CTFontManagerCopyAvailableFontFamilyNames();
	int n = (int)CFArrayGetCount(families);
	char **items = calloc((size_t)n, sizeof(char*));
	for (int i = 0; i < n; i++) {
		CFStringRef name = CFArrayGetValueAtIndex(families, i);
		char buf[512];
		if (CFStringGetCString(name, buf, sizeof(buf), kCFStringEncodingUTF8)) {
			items[i] = strdup(buf);
		}
	}
	CFRelease(families);
	*count = n;
	return items;
}

static void freeFontFamilyList(char **items, int count) {
	for (int i = 0; i < count; i++) {
		free(items[i]);
	}
	free(items);
}
*/
import "C"

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"metabrowser/model"
	"metabrowser/scanner"
	"metabrowser/server"
)

type App struct {
	ctx     context.Context
	mu      sync.RWMutex
	root    string
	lib     model.Library
	handler http.Handler
	cfg     Config
}

func NewApp(root string) *App {
	return &App{root: root}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.mu.Lock()
	a.cfg = loadConfig()
	if a.root == "" {
		a.root = a.cfg.LibraryDir
	}
	root := a.root
	a.mu.Unlock()
	if root != "" {
		go a.streamScan(root)
	} else {
		runtime.EventsEmit(a.ctx, "scan:done", model.Library{Books: []model.Book{}})
	}
}

// streamScan runs asynchronously on startup.
// Phase 1: emit cached books instantly.
// Phase 2: parse new/changed files and emit each.
// Phase 3: sort, build handler, persist updated cache, emit scan:done.
func (a *App) streamScan(dir string) {
	fonts := listSystemFonts()
	cache := loadBookCache(dir)
	newCache := make(bookCache, len(cache))

	// Phase 1 — emit cached books immediately
	cached := make([]model.Book, 0, len(cache))
	for _, entry := range cache {
		cached = append(cached, entry.Book)
		newCache[entry.Book.Path] = entry
		runtime.EventsEmit(a.ctx, "book:add", entry.Book)
	}
	if len(cached) > 0 {
		sort.Slice(cached, func(i, j int) bool { return cached[i].Title < cached[j].Title })
		lib := scanner.BuildLibrary(cached)
		a.mu.Lock()
		a.root = dir
		a.lib = lib
		a.handler = server.NewHandler(dir, lib, fonts)
		a.mu.Unlock()
	}

	// Phase 2 — parse new/changed files
	results := make(chan scanner.ScanResult, 32)
	if err := scanner.Stream(dir, results); err != nil {
		a.mu.RLock()
		lib := a.lib
		a.mu.RUnlock()
		runtime.EventsEmit(a.ctx, "scan:done", lib)
		return
	}
	a.mu.Lock()
	indexByPath := make(map[string]int, len(a.lib.Books))
	for i, b := range a.lib.Books {
		indexByPath[b.Path] = i
	}
	a.mu.Unlock()
	for r := range results {
		newCache[r.Book.Path] = cacheEntry{ModTime: r.ModTime, Book: r.Book}
		old, inCache := cache[r.Book.Path]
		if inCache && old.ModTime.Equal(r.ModTime) {
			continue // already emitted
		}
		a.mu.Lock()
		if i, ok := indexByPath[r.Book.Path]; ok {
			a.lib.Books[i] = r.Book
		} else {
			indexByPath[r.Book.Path] = len(a.lib.Books)
			a.lib.Books = append(a.lib.Books, r.Book)
		}
		a.mu.Unlock()
		runtime.EventsEmit(a.ctx, "book:add", r.Book)
	}

	// Phase 3 — finalize
	a.mu.Lock()
	sort.Slice(a.lib.Books, func(i, j int) bool { return a.lib.Books[i].Title < a.lib.Books[j].Title })
	a.lib = scanner.BuildLibrary(a.lib.Books)
	a.root = dir
	a.handler = server.NewHandler(dir, a.lib, fonts)
	finalLib := a.lib
	a.mu.Unlock()

	saveBookCache(dir, newCache)
	runtime.EventsEmit(a.ctx, "scan:done", finalLib)
}

// scan is the synchronous path used by PickAndScan and SaveConfig.
func (a *App) scan(dir string) error {
	results := make(chan scanner.ScanResult, 64)
	if err := scanner.Stream(dir, results); err != nil {
		return err
	}
	newCache := make(bookCache)
	var books []model.Book
	for r := range results {
		books = append(books, r.Book)
		newCache[r.Book.Path] = cacheEntry{ModTime: r.ModTime, Book: r.Book}
	}
	sort.Slice(books, func(i, j int) bool { return books[i].Title < books[j].Title })
	lib := scanner.BuildLibrary(books)
	a.mu.Lock()
	a.root = dir
	a.lib = lib
	a.handler = server.NewHandler(dir, lib, listSystemFonts())
	a.mu.Unlock()
	saveBookCache(dir, newCache)
	return nil
}

func (a *App) GetConfig() Config {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.cfg
}

func (a *App) SaveConfig(cfg Config) error {
	a.mu.RLock()
	root := a.root
	a.mu.RUnlock()
	if cfg.LibraryDir != "" && cfg.LibraryDir != root {
		if err := a.scan(cfg.LibraryDir); err != nil {
			return err
		}
	}
	a.mu.Lock()
	a.cfg = cfg
	a.mu.Unlock()
	return saveConfig(cfg)
}

func (a *App) GetLibrary() model.Library {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.lib
}

func (a *App) PickAndScan() (model.Library, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose your EPUB library folder",
	})
	if err != nil {
		return model.Library{}, err
	}
	if dir == "" {
		a.mu.RLock()
		lib := a.lib
		a.mu.RUnlock()
		return lib, nil
	}
	if err := a.scan(dir); err != nil {
		return model.Library{}, err
	}
	a.mu.Lock()
	a.cfg.LibraryDir = dir
	cfg := a.cfg
	lib := a.lib
	a.mu.Unlock()
	saveConfig(cfg)
	return lib, nil
}

func (a *App) ListFonts() []string {
	return listSystemFonts()
}

func listSystemFonts() []string {
	var n C.int
	items := C.fontFamilyList(&n)
	defer C.freeFontFamilyList(items, n)
	seen := make(map[string]bool, int(n))
	slice := unsafe.Slice((**C.char)(unsafe.Pointer(items)), int(n))
	for _, item := range slice {
		if item == nil {
			continue
		}
		name := C.GoString(item)
		if name != "" && name[0] != '.' {
			seen[name] = true
		}
	}
	fonts := make([]string, 0, len(seen))
	for name := range seen {
		fonts = append(fonts, name)
	}
	sort.Strings(fonts)
	return fonts
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/config":
		a.mu.RLock()
		cfg := a.cfg
		a.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg)
		return
	case "/api/library":
		a.mu.RLock()
		lib := a.lib
		a.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lib)
		return
	}
	a.mu.RLock()
	h := a.handler
	a.mu.RUnlock()
	if h == nil {
		http.Error(w, "no library loaded", http.StatusServiceUnavailable)
		return
	}
	h.ServeHTTP(w, r)
}
