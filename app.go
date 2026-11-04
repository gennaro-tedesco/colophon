package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework CoreText -framework Foundation -framework AppKit
#import <CoreText/CoreText.h>
#include <stdlib.h>

enum { fontFamilyBufferCapacity = 512 };

static char** fontFamilyList(int *count) {
	CFArrayRef families = CTFontManagerCopyAvailableFontFamilyNames();
	int n = (int)CFArrayGetCount(families);
	char **items = calloc((size_t)n, sizeof(char*));
	for (int i = 0; i < n; i++) {
		CFStringRef name = CFArrayGetValueAtIndex(families, i);
		char buf[fontFamilyBufferCapacity];
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
	"log"
	"net/http"
	"sort"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"colophon/internal/contract"
	"colophon/model"
	"colophon/scanner"
	"colophon/server"
)

type App struct {
	ctx               context.Context
	mu                sync.RWMutex
	scanMu            sync.Mutex
	root              string
	lib               model.Library
	handler           *server.Handler
	standaloneHandler *server.StandaloneHandler
	cfg               Config
	fonts             []string
	pendingReaderPath string
	pendingReaderURL  string
	frontendReady     bool
	readerEventsReady bool
}

func NewApp(root string) *App {
	return &App{root: root}
}

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	a.cfg = loadConfig()
	a.cfg.Version = version
	a.fonts = listSystemFonts()
	if a.root == "" {
		a.root = a.cfg.LibraryDir
	}
	root := a.root
	a.mu.Unlock()
	if root != "" {
		go a.streamScan(root)
	} else {
		runtime.EventsEmit(a.ctx, contract.Events["scanDone"], model.Library{Books: []model.Book{}})
	}
}

func (a *App) domReady(_ context.Context) {
	a.mu.Lock()
	a.frontendReady = true
	ctx := a.ctx
	pendingReaderPath := a.pendingReaderPath
	a.pendingReaderPath = ""
	a.mu.Unlock()
	runtime.WindowShow(ctx)
	if pendingReaderPath != "" {
		if err := a.openReaderPath(pendingReaderPath); err != nil {
			log.Printf("could not open EPUB in reader mode: %v", err)
		}
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
	a.scanMu.Lock()
	defer a.scanMu.Unlock()
	fonts := a.getFonts()
	cache := loadBookCache(dir)
	newCache := make(bookCache)

	// Phase 1 — emit cached books immediately
	cached := make([]model.Book, 0, len(cache))
	for _, entry := range cache {
		cached = append(cached, entry.Book)
		runtime.EventsEmit(a.ctx, contract.Events["bookAdded"], entry.Book)
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
	results := make(chan scanner.ScanResult, streamScanBufferSize)
	wait, err := scanner.StreamCached(dir, cache, results)
	if err != nil {
		a.mu.RLock()
		lib := a.lib
		a.mu.RUnlock()
		runtime.EventsEmit(a.ctx, contract.Events["scanDone"], lib)
		return
	}
	for r := range results {
		newCache[r.Book.Path] = cacheEntry{ModTime: r.ModTime, Book: r.Book}
		old, inCache := cache[r.Book.Path]
		if inCache && old.ModTime.Equal(r.ModTime) {
			continue // already emitted
		}
		runtime.EventsEmit(a.ctx, contract.Events["bookAdded"], r.Book)
	}
	fatal, warnings := wait()
	for _, warning := range warnings {
		log.Printf("scan warning for %s: %v", dir, warning)
	}
	if fatal != nil {
		log.Printf("scan incomplete for %s: %v", dir, fatal)
		a.mu.RLock()
		lib := a.lib
		a.mu.RUnlock()
		runtime.EventsEmit(a.ctx, contract.Events["scanDone"], lib)
		return
	}

	// Phase 3 — finalize
	finalBooks := make([]model.Book, 0, len(newCache))
	for _, entry := range newCache {
		finalBooks = append(finalBooks, entry.Book)
	}
	sort.Slice(finalBooks, func(i, j int) bool { return finalBooks[i].Title < finalBooks[j].Title })
	finalLib := scanner.BuildLibrary(finalBooks)
	if err := saveBookCache(dir, newCache); err != nil {
		log.Printf("could not save book cache for %s: %v", dir, err)
	}
	a.mu.Lock()
	a.lib = finalLib
	a.root = dir
	a.handler = server.NewHandler(dir, a.lib, fonts, a.cfg.Theme)
	a.mu.Unlock()
	runtime.EventsEmit(a.ctx, contract.Events["scanDone"], finalLib)
}

// scan is the synchronous path used by PickAndScan and Rescan.
func (a *App) scan(dir string) error {
	a.scanMu.Lock()
	defer a.scanMu.Unlock()
	return a.scanLocked(dir)
}

func (a *App) scanLocked(dir string) error {
	fonts := a.getFonts()
	cache := loadBookCache(dir)
	results := make(chan scanner.ScanResult, synchronousScanBufferSize)
	wait, err := scanner.StreamCached(dir, cache, results)
	if err != nil {
		return err
	}
	newCache := make(bookCache)
	var books []model.Book
	for r := range results {
		books = append(books, r.Book)
		newCache[r.Book.Path] = cacheEntry{ModTime: r.ModTime, Book: r.Book}
	}
	fatal, warnings := wait()
	for _, warning := range warnings {
		log.Printf("scan warning for %s: %v", dir, warning)
	}
	if fatal != nil {
		return fatal
	}
	sort.Slice(books, func(i, j int) bool { return books[i].Title < books[j].Title })
	lib := scanner.BuildLibrary(books)
	if err := saveBookCache(dir, newCache); err != nil {
		return err
	}
	a.mu.Lock()
	a.root = dir
	a.lib = lib
	a.handler = server.NewHandler(dir, lib, fonts, a.cfg.Theme)
	a.mu.Unlock()
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
	a.scanMu.Lock()
	defer a.scanMu.Unlock()

	a.mu.RLock()
	root := a.root
	prevCfg := a.cfg
	prevLib := a.lib
	prevHandler := a.handler
	a.mu.RUnlock()
	cfg.Version = ""
	if cfg.LibraryDir != "" && cfg.LibraryDir != root {
		if err := a.scanLocked(cfg.LibraryDir); err != nil {
			return err
		}
	}
	if err := saveConfig(cfg); err != nil {
		a.mu.Lock()
		a.root = root
		a.lib = prevLib
		a.handler = prevHandler
		a.cfg = prevCfg
		a.mu.Unlock()
		return err
	}
	a.mu.Lock()
	a.cfg = cfg
	if cfg.LibraryDir == "" {
		a.root = ""
		a.lib = model.Library{}
		a.handler = nil
	} else if a.handler != nil {
		a.handler.SetTheme(cfg.Theme)
	}
	if a.standaloneHandler != nil {
		a.standaloneHandler.SetTheme(cfg.Theme)
	}
	a.mu.Unlock()
	return nil
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
	a.scanMu.Lock()
	defer a.scanMu.Unlock()

	a.mu.RLock()
	root := a.root
	prevCfg := a.cfg
	prevLib := a.lib
	prevHandler := a.handler
	a.mu.RUnlock()
	if err := a.scanLocked(dir); err != nil {
		return model.Library{}, err
	}
	a.mu.Lock()
	a.cfg.LibraryDir = dir
	cfg := a.cfg
	lib := a.lib
	a.mu.Unlock()
	if err := saveConfig(cfg); err != nil {
		a.mu.Lock()
		a.root = root
		a.lib = prevLib
		a.handler = prevHandler
		a.cfg = prevCfg
		a.mu.Unlock()
		return lib, err
	}
	return lib, nil
}

func (a *App) ListFonts() []string {
	return a.getFonts()
}

func (a *App) OpenInReaderMode() error {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open in Reader Mode",
		Filters: []runtime.FileFilter{
			{DisplayName: "EPUB Books (*.epub)", Pattern: "*.epub"},
		},
		ResolvesAliases: true,
	})
	if err != nil || filePath == "" {
		return err
	}
	return a.openReaderPath(filePath)
}

func (a *App) TakePendingReaderURL() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.readerEventsReady = true
	readerURL := a.pendingReaderURL
	a.pendingReaderURL = ""
	return readerURL
}

func (a *App) queueReaderPath(filePath string) {
	a.mu.Lock()
	if a.ctx == nil || !a.frontendReady {
		a.pendingReaderPath = filePath
		a.mu.Unlock()
		return
	}
	ctx := a.ctx
	a.mu.Unlock()
	runtime.WindowShow(ctx)
	if err := a.openReaderPath(filePath); err != nil {
		log.Printf("could not open EPUB in reader mode: %v", err)
	}
}

func (a *App) openReaderPath(filePath string) error {
	a.mu.RLock()
	ctx := a.ctx
	fonts := a.fonts
	theme := a.cfg.Theme
	a.mu.RUnlock()
	if ctx == nil {
		a.mu.Lock()
		a.pendingReaderPath = filePath
		a.mu.Unlock()
		return nil
	}

	handler, readerURL, err := server.NewStandaloneHandler(filePath, fonts, theme)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.standaloneHandler = handler
	readerEventsReady := a.readerEventsReady
	if !readerEventsReady {
		a.pendingReaderURL = readerURL
	}
	a.mu.Unlock()
	if readerEventsReady {
		runtime.EventsEmit(ctx, contract.Events["readerOpen"], readerURL)
	}
	return nil
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
	case contract.ScriptPath:
		contract.ServeScript(w, r)
		return
	case contract.ResourcesPath:
		contract.ServeResources(w, r)
		return
	case contract.Routes["config"]:
		a.mu.RLock()
		cfg := a.cfg
		a.mu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(cfg); err != nil {
			return
		}
		return
	case contract.Routes["library"]:
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
	standaloneHandler := a.standaloneHandler
	a.mu.RUnlock()
	if standaloneHandler != nil && standaloneHandler.Handles(r.URL.Path) {
		standaloneHandler.ServeHTTP(w, r)
		return
	}
	if h == nil {
		http.Error(w, "no library loaded", http.StatusServiceUnavailable)
		return
	}
	h.ServeHTTP(w, r)
}
