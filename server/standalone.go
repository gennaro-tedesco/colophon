// Serves a single explicitly selected EPUB through the existing reader.
// Keeps standalone files isolated from the configured library root.
package server

import (
	"archive/zip"
	"container/list"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"colophon/internal/contract"
)

const standalonePathPrefix = "__standalone__/"

type StandaloneHandler struct {
	handler     *Handler
	epubPath    string
	epubRel     string
	encodedPath string
	title       string
}

func NewStandaloneHandler(epubPath string, fonts []string, theme string) (*StandaloneHandler, string, error) {
	absolutePath, err := filepath.Abs(epubPath)
	if err != nil {
		return nil, "", err
	}
	info, err := filepath.EvalSymlinks(absolutePath)
	if err != nil {
		return nil, "", err
	}
	fileInfo, err := os.Stat(info)
	if err != nil {
		return nil, "", err
	}
	if !fileInfo.Mode().IsRegular() || !strings.EqualFold(filepath.Ext(info), ".epub") {
		return nil, "", fmt.Errorf("not an EPUB file: %s", epubPath)
	}

	identifier := make([]byte, 16)
	if _, err := rand.Read(identifier); err != nil {
		return nil, "", err
	}
	epubRel := standalonePathPrefix + hex.EncodeToString(identifier) + ".epub"
	standalone := &StandaloneHandler{
		epubPath:    info,
		epubRel:     epubRel,
		encodedPath: encodeURLPath(epubRel),
		title:       strings.TrimSuffix(filepath.Base(info), filepath.Ext(info)),
	}
	standalone.handler = standalone.newHandler(fonts, theme)
	return standalone, readerShellURL(epubRel, 0, ""), nil
}

func (h *StandaloneHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.handler.ServeHTTP(w, r)
}

func (h *StandaloneHandler) SetTheme(theme string) {
	h.handler.SetTheme(theme)
}

func (h *StandaloneHandler) Handles(requestPath string) bool {
	switch requestPath {
	case contract.Routes["fonts"], contract.Routes["readerCSS"], contract.Routes["readerJS"]:
		return true
	}
	return standaloneRouteMatches(requestPath, contract.Routes["read"]+h.encodedPath) ||
		standaloneRouteMatches(requestPath, contract.Routes["search"]+h.encodedPath) ||
		standaloneRouteMatches(requestPath, contract.Routes["cover"]+h.encodedPath)
}

func standaloneRouteMatches(requestPath, bookPath string) bool {
	return requestPath == bookPath || strings.HasPrefix(requestPath, bookPath+"/")
}

func (h *StandaloneHandler) newHandler(fonts []string, theme string) *Handler {
	cache := &readerCache{
		books:   make(map[string]*readerCacheEntry),
		loading: make(map[string]chan struct{}),
		lru:     list.New(),
	}
	handler := &Handler{theme: theme}
	mux := http.NewServeMux()

	mux.HandleFunc(contract.Routes["fonts"], func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(fonts)
	})
	mux.HandleFunc(contract.Routes["readerCSS"], func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		io.WriteString(w, readerCSS)
	})
	mux.HandleFunc(contract.Routes["readerJS"], func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		io.WriteString(w, readerJS)
	})
	mux.HandleFunc(contract.Routes["search"], func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimPrefix(r.URL.Path, contract.Routes["search"]) != h.epubRel {
			http.NotFound(w, r)
			return
		}
		matches, err := cache.search(r.Context(), h.epubPath, strings.TrimSpace(r.URL.Query().Get("q")))
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				http.NotFound(w, r)
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(matches)
	})
	mux.HandleFunc(contract.Routes["cover"], func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimPrefix(r.URL.Path, contract.Routes["cover"]) != h.epubRel {
			http.NotFound(w, r)
			return
		}
		h.serveCover(w, r)
	})
	mux.HandleFunc(contract.Routes["read"], func(w http.ResponseWriter, r *http.Request) {
		epubRel, mode, assetPath, ok := parseReadRequestPath(r.URL.Path)
		if !ok || epubRel != h.epubRel {
			http.NotFound(w, r)
			return
		}
		switch mode {
		case "asset":
			serveReaderAsset(w, r, h.epubPath, assetPath)
		case "chapter":
			serveChapterDocument(w, r, h.epubPath, h.epubRel, cache)
		default:
			serveReaderShell(w, r, h.epubPath, h.epubRel, h.title, "", cache, handler.currentTheme())
		}
	})

	handler.mux = mux
	return handler
}

func (h *StandaloneHandler) serveCover(w http.ResponseWriter, r *http.Request) {
	entry := r.URL.Query().Get("entry")
	if entry == "" {
		http.NotFound(w, r)
		return
	}
	reader, err := zip.OpenReader(h.epubPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer reader.Close()
	for _, file := range reader.File {
		if file.Name != entry {
			continue
		}
		content, err := file.Open()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer content.Close()
		w.Header().Set("Content-Type", mediaTypeForEntry(entry))
		io.Copy(w, content)
		return
	}
	http.NotFound(w, r)
}
