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
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"colophon/model"
	"colophon/scanner"
	"colophon/server"
)

type App struct {
	ctx     context.Context
	mu      sync.RWMutex
	root    string
	lib     model.Library
	handler http.Handler
	cfg     Config
	fonts   []string
	views   []View
}

func NewApp(root string) *App {
	return &App{root: root}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.mu.Lock()
	a.cfg = loadConfig()
	a.cfg.Version = version
	a.fonts = listSystemFonts()
	if a.root == "" {
		a.root = a.cfg.LibraryDir
	}
	if a.root != "" {
		a.views = loadViews(a.root)
	}
	root := a.root
	a.mu.Unlock()
	if root != "" {
		go a.streamScan(root)
	} else {
		runtime.EventsEmit(a.ctx, "scan:done", model.Library{Books: []model.Book{}})
	}
}

func (a *App) getFonts() []string {
	a.mu.RLock()
	fonts := a.fonts
	a.mu.RUnlock()
	if len(fonts) > 0 {
		return fonts
	}
	fonts = listSystemFonts()
	a.mu.Lock()
	if len(a.fonts) == 0 {
		a.fonts = fonts
	}
	fonts = a.fonts
	a.mu.Unlock()
	return fonts
}

// streamScan runs asynchronously on startup.
// Phase 1: emit cached books instantly.
// Phase 2: parse new/changed files and emit each.
// Phase 3: sort, build handler, persist updated cache, emit scan:done.
func (a *App) streamScan(dir string) {
	fonts := a.getFonts()
	cache := loadBookCache(dir)
	newCache := make(bookCache)
	booksByPath := make(map[string]model.Book, len(cache))

	// Phase 1 — emit cached books immediately
	cached := make([]model.Book, 0, len(cache))
	for _, entry := range cache {
		cached = append(cached, entry.Book)
		booksByPath[entry.Book.Path] = entry.Book
		runtime.EventsEmit(a.ctx, "book:add", entry.Book)
	}
	if len(cached) > 0 {
		sort.Slice(cached, func(i, j int) bool { return cached[i].Title < cached[j].Title })
		lib := scanner.BuildLibrary(cached)
		a.mu.Lock()
		a.root = dir
		a.lib = lib
		a.handler = server.NewHandler(dir, lib, fonts, a.cfg.Theme)
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
	for r := range results {
		newCache[r.Book.Path] = cacheEntry{ModTime: r.ModTime, Book: r.Book}
		booksByPath[r.Book.Path] = r.Book
		old, inCache := cache[r.Book.Path]
		if inCache && old.ModTime.Equal(r.ModTime) {
			continue // already emitted
		}
		runtime.EventsEmit(a.ctx, "book:add", r.Book)
	}

	// Phase 3 — finalize
	finalBooks := make([]model.Book, 0, len(newCache))
	for _, entry := range newCache {
		finalBooks = append(finalBooks, entry.Book)
	}
	sort.Slice(finalBooks, func(i, j int) bool { return finalBooks[i].Title < finalBooks[j].Title })
	finalLib := scanner.BuildLibrary(finalBooks)
	a.mu.Lock()
	a.lib = finalLib
	a.root = dir
	a.handler = server.NewHandler(dir, a.lib, fonts, a.cfg.Theme)
	a.mu.Unlock()

	saveBookCache(dir, newCache)
	runtime.EventsEmit(a.ctx, "scan:done", finalLib)
}

// scan is the synchronous path used by PickAndScan and SaveConfig.
func (a *App) scan(dir string) error {
	fonts := a.getFonts()
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
	a.handler = server.NewHandler(dir, lib, fonts, a.cfg.Theme)
	a.mu.Unlock()
	saveBookCache(dir, newCache)
	return nil
}

func (a *App) Rescan() error {
	a.mu.RLock()
	root := a.root
	a.mu.RUnlock()
	if root == "" {
		return nil
	}
	return a.scan(root)
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
	cfg.Version = ""
	if cfg.LibraryDir != "" && cfg.LibraryDir != root {
		if err := a.scan(cfg.LibraryDir); err != nil {
			return err
		}
	}
	a.mu.Lock()
	a.cfg = cfg
	if cfg.LibraryDir == "" {
		a.root = ""
		a.lib = model.Library{}
		a.views = nil
		a.handler = nil
	} else if a.root != "" {
		if cfg.LibraryDir != root {
			a.views = loadViews(a.root)
		}
		a.handler = server.NewHandler(a.root, a.lib, a.fonts, cfg.Theme)
	}
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
	a.views = loadViews(dir)
	cfg := a.cfg
	lib := a.lib
	a.mu.Unlock()
	saveConfig(cfg)
	return lib, nil
}

func (a *App) ListFonts() []string {
	return a.getFonts()
}

func (a *App) GetViews() []View {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.views == nil {
		return []View{}
	}
	return a.views
}

func (a *App) CreateView(name string) (View, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	v := View{
		ID:        fmt.Sprintf("%x", time.Now().UnixNano()),
		Name:      name,
		BookPaths: []string{},
	}
	a.views = append(a.views, v)
	return v, saveViews(a.root, a.views)
}

func (a *App) DeleteView(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	updated := make([]View, 0, len(a.views))
	for _, v := range a.views {
		if v.ID != id {
			updated = append(updated, v)
		}
	}
	a.views = updated
	return saveViews(a.root, a.views)
}

func (a *App) RenameView(id, name string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for i, v := range a.views {
		if v.ID == id {
			a.views[i].Name = name
			break
		}
	}
	return saveViews(a.root, a.views)
}

func (a *App) AddBooksToView(id string, paths []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for i, v := range a.views {
		if v.ID != id {
			continue
		}
		existing := make(map[string]bool, len(v.BookPaths))
		for _, p := range v.BookPaths {
			existing[p] = true
		}
		for _, p := range paths {
			if !existing[p] {
				a.views[i].BookPaths = append(a.views[i].BookPaths, p)
				existing[p] = true
			}
		}
		break
	}
	return saveViews(a.root, a.views)
}

func (a *App) RemoveBookFromView(id, path string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for i, v := range a.views {
		if v.ID != id {
			continue
		}
		updated := make([]string, 0, len(v.BookPaths))
		for _, p := range v.BookPaths {
			if p != path {
				updated = append(updated, p)
			}
		}
		a.views[i].BookPaths = updated
		break
	}
	return saveViews(a.root, a.views)
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
		if err := json.NewEncoder(w).Encode(cfg); err != nil {
			return
		}
		return
	case "/api/library":
		a.mu.RLock()
		lib := a.lib
		a.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(lib); err != nil {
			return
		}
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
