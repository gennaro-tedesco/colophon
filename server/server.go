package server

import (
	"archive/zip"
	"bytes"
	"container/list"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"html"
	"html/template"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	xhtml "golang.org/x/net/html"

	"colophon/internal/contract"
	"colophon/model"
	"colophon/scanner"
)

//go:embed reader_shell.html
var readerShellHTML string

//go:embed reader.css
var readerCSS string

//go:embed reader.js
var readerJS string

var readerShellTmpl = template.Must(template.New("reader-shell").Parse(readerShellHTML))

const (
	coverCacheMaxAgeSeconds       = 86400
	readerAssetCacheMaxAgeSeconds = 3600
	readerCacheCapacity           = 8
	readerSearchMaxResults        = 1000
	maxReaderEntrySize            = 32 << 20
)

type readerShellData struct {
	Title          string
	Meta           string
	CurrentChapter string
	Progress       string
	ChapterCount   int
	Prev           string
	Next           string
	TOCHTML        template.HTML
	EncodedPath    string
	CurrentIndex   int
	IframeSrc      template.URL
	Theme          string
	ContractScript string
	ThemeFile      string
	ThemeCSS       string
	ReaderCSS      string
	ReaderJS       string
	Chapters       template.JS
}

type readerChapterMeta struct {
	Title string `json:"title"`
	Prev  int    `json:"prev"`
	Next  int    `json:"next"`
}

type chapterDoc struct {
	Path  string
	Title string
}

type readerBookData struct {
	Spine    []string
	Chapters []chapterDoc
	TOC      []scanner.TOCEntry
}

type readerSearchMatch struct {
	Chapter int    `json:"chapter"`
	Title   string `json:"title"`
}

type readerCache struct {
	mu      sync.RWMutex
	books   map[string]*readerCacheEntry
	loading map[string]chan struct{}
	lru     *list.List
}

type readerCacheEntry struct {
	book       readerBookData
	texts      []string
	textLoaded []bool
	element    *list.Element
	pins       int
}

type Handler struct {
	mux   http.Handler
	mu    sync.RWMutex
	theme string
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) SetTheme(theme string) {
	h.mu.Lock()
	h.theme = theme
	h.mu.Unlock()
}

func (h *Handler) currentTheme() string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.theme
}

func NewHandler(root string, lib model.Library, fonts []string, theme string) *Handler {
	titleIndex := make(map[string]string, len(lib.Books))
	authorIndex := make(map[string]string, len(lib.Books))
	cache := &readerCache{
		books:   make(map[string]*readerCacheEntry),
		loading: make(map[string]chan struct{}),
		lru:     list.New(),
	}
	for _, b := range lib.Books {
		titleIndex[b.Path] = b.Title
		authorIndex[b.Path] = strings.Join(b.Authors, ", ")
	}

	h := &Handler{theme: theme}
	mux := http.NewServeMux()

	mux.HandleFunc(contract.Routes["fonts"], func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(fonts); err != nil {
			return
		}
	})

	mux.HandleFunc(contract.Routes["readerCSS"], func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		if _, err := io.WriteString(w, readerCSS); err != nil {
			return
		}
	})

	mux.HandleFunc(contract.Routes["readerJS"], func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		if _, err := io.WriteString(w, readerJS); err != nil {
			return
		}
	})

	mux.HandleFunc(contract.Routes["search"], func(w http.ResponseWriter, r *http.Request) {
		epubRel := strings.TrimPrefix(r.URL.Path, contract.Routes["search"])
		absEpub, ok := resolveEpubPath(root, epubRel)
		if !ok {
			http.NotFound(w, r)
			return
		}
		matches, err := cache.search(r.Context(), absEpub, strings.TrimSpace(r.URL.Query().Get("q")))
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(matches); err != nil {
			return
		}
	})

	mux.HandleFunc(contract.Routes["cover"], func(w http.ResponseWriter, r *http.Request) {
		epubRel := strings.TrimPrefix(r.URL.Path, contract.Routes["cover"])
		entry := r.URL.Query().Get("entry")
		if entry == "" {
			http.NotFound(w, r)
			return
		}

		absEpub, ok := resolveEpubPath(root, epubRel)
		if !ok {
			http.NotFound(w, r)
			return
		}

		zr, err := zip.OpenReader(absEpub)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer zr.Close()

		for _, f := range zr.File {
			if f.Name != entry {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				http.Error(w, "error reading cover", http.StatusInternalServerError)
				return
			}
			defer rc.Close()
			w.Header().Set("Content-Type", mediaTypeForEntry(entry))
			w.Header().Set("Cache-Control", "public, max-age="+strconv.Itoa(coverCacheMaxAgeSeconds))
			if _, err := io.Copy(w, rc); err != nil {
				return
			}
			return
		}
		http.NotFound(w, r)
	})

	mux.HandleFunc(contract.Routes["read"], func(w http.ResponseWriter, r *http.Request) {
		epubRel, mode, assetPath, ok := parseReadRequestPath(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}

		absEpub, ok := resolveEpubPath(root, epubRel)
		if !ok {
			http.NotFound(w, r)
			return
		}

		switch mode {
		case "asset":
			serveReaderAsset(w, r, absEpub, assetPath)
		case "chapter":
			serveChapterDocument(w, r, absEpub, epubRel, cache)
		default:
			serveReaderShell(w, r, absEpub, epubRel, titleIndex[epubRel], authorIndex[epubRel], cache, h.currentTheme())
		}
	})

	h.mux = mux
	return h
}

func serveReaderShell(w http.ResponseWriter, r *http.Request, absEpub, epubRel, title, meta string, cache *readerCache, theme string) {
	theme = contract.NormalizeTheme(theme)
	book, err := cache.load(absEpub)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	chapterIndex, err := chapterIndexFromRequest(r, len(book.Spine))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if strings.TrimSpace(title) == "" {
		title = strings.TrimSuffix(path.Base(epubRel), path.Ext(epubRel))
	}

	tocLabels := flattenTOCLabels(book.TOC)
	chapters := make([]readerChapterMeta, len(book.Chapters))
	for i := range book.Chapters {
		chapterTitle := fallbackChapterTitle(book.Chapters[i].Title, i)
		if tocTitle := normalizeWhitespace(tocLabels[book.Spine[i]]); tocTitle != "" {
			chapterTitle = tocTitle
		}
		chapters[i] = readerChapterMeta{
			Title: chapterTitle,
			Prev:  adjacentChapter(i, len(book.Chapters), -1),
			Next:  adjacentChapter(i, len(book.Chapters), 1),
		}
	}
	chaptersJSON, _ := json.Marshal(chapters)

	data := readerShellData{
		Title:          title,
		Meta:           meta,
		CurrentChapter: chapters[chapterIndex].Title,
		Progress:       strconv.Itoa(chapterIndex+1) + " / " + strconv.Itoa(len(book.Chapters)),
		ChapterCount:   len(book.Chapters),
		TOCHTML:        buildTOCHTML(book.TOC, book.Spine, epubRel, book.Spine[chapterIndex], r.URL.Query().Get("frag")),
		EncodedPath:    encodeURLPath(epubRel),
		CurrentIndex:   chapterIndex,
		IframeSrc:      template.URL(readerChapterDocURL(epubRel, chapterIndex, r.URL.Query().Get("frag"))),
		Theme:          theme,
		ContractScript: contract.ScriptPath,
		ThemeFile:      contract.ThemesPath + theme + ".css",
		ThemeCSS:       contract.ThemePath,
		ReaderCSS:      contract.Routes["readerCSS"],
		ReaderJS:       contract.Routes["readerJS"],
		Chapters:       template.JS(chaptersJSON),
	}
	if prev := chapters[chapterIndex].Prev; prev >= 0 {
		data.Prev = readerShellURL(epubRel, prev, "")
	}
	if next := chapters[chapterIndex].Next; next >= 0 {
		data.Next = readerShellURL(epubRel, next, "")
	}

	var out bytes.Buffer
	if err := readerShellTmpl.Execute(&out, data); err != nil {
		http.Error(w, "error rendering page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(out.Bytes()); err != nil {
		return
	}
}

func serveChapterDocument(w http.ResponseWriter, r *http.Request, absEpub, epubRel string, cache *readerCache) {
	book, err := cache.load(absEpub)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	chapterIndex, err := chapterIndexFromRequest(r, len(book.Spine))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	zr, err := zip.OpenReader(absEpub)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer zr.Close()
	entries := zipEntryIndex(&zr.Reader)

	chapterPath := book.Spine[chapterIndex]
	chapterHTML, err := readZipEntry(entries, chapterPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	doc, err := xhtml.Parse(bytes.NewReader(chapterHTML))
	if err != nil {
		http.Error(w, "error rendering chapter", http.StatusInternalServerError)
		return
	}
	rewriteDocumentLinks(doc, epubRel, chapterPath, book.Spine)

	injectReaderBaseline(doc)
	var docBuf bytes.Buffer
	if err := xhtml.Render(&docBuf, doc); err != nil {
		http.Error(w, "error rendering chapter", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(docBuf.Bytes()); err != nil {
		log.Printf("error writing chapter document for %s: %v", absEpub, err)
	}
}

func serveReaderAsset(w http.ResponseWriter, r *http.Request, absEpub, assetPath string) {
	file := cleanPathSegment(assetPath)
	if file == "" {
		http.NotFound(w, r)
		return
	}

	zr, err := zip.OpenReader(absEpub)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer zr.Close()

	for _, f := range zr.File {
		if f.Name != file {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			http.Error(w, "error reading asset", http.StatusInternalServerError)
			return
		}
		defer rc.Close()
		w.Header().Set("Content-Type", contentTypeForEntry(file))
		w.Header().Set("Cache-Control", "public, max-age="+strconv.Itoa(readerAssetCacheMaxAgeSeconds))
		if _, err := io.Copy(w, rc); err != nil {
			return
		}
		return
	}

	http.NotFound(w, r)
}

func chapterIndexFromRequest(r *http.Request, chapterCount int) (int, error) {
	chapterIndex := 0
	if raw := r.URL.Query().Get("chapter"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			return 0, errors.New("invalid chapter")
		}
		chapterIndex = parsed
	}
	if chapterIndex >= chapterCount {
		return 0, errors.New("chapter out of range")
	}
	return chapterIndex, nil
}

func parseReadRequestPath(requestPath string) (string, string, string, bool) {
	if !strings.HasPrefix(requestPath, contract.Routes["read"]) {
		return "", "", "", false
	}
	trimmed := strings.TrimPrefix(requestPath, contract.Routes["read"])
	if trimmed == "" {
		return "", "", "", false
	}
	if strings.HasSuffix(trimmed, "/chapter") {
		epubRel := strings.TrimSuffix(trimmed, "/chapter")
		return epubRel, "chapter", "", epubRel != ""
	}
	if idx := strings.LastIndex(trimmed, "/asset/"); idx >= 0 {
		epubRel := trimmed[:idx]
		assetPath := trimmed[idx+len("/asset/"):]
		return epubRel, "asset", assetPath, epubRel != "" && assetPath != ""
	}
	return trimmed, "shell", "", true
}

func resolveEpubPath(root, epubRel string) (string, bool) {
	cleanRel := cleanPathSegment(epubRel)
	if cleanRel == "" {
		return "", false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", false
	}
	absEpub, err := filepath.Abs(filepath.Join(absRoot, filepath.FromSlash(cleanRel)))
	if err != nil {
		return "", false
	}
	relToRoot, err := filepath.Rel(absRoot, absEpub)
	if err != nil || relToRoot == ".." || strings.HasPrefix(relToRoot, ".."+string(filepath.Separator)) {
		return "", false
	}
	return absEpub, true
}

func cleanPathSegment(value string) string {
	if value == "" {
		return ""
	}
	cleaned := path.Clean("/" + value)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "." || cleaned == "" || strings.HasPrefix(cleaned, "../") {
		return ""
	}
	return cleaned
}

func loadChapterMetadata(entries zipEntries, spine []string, tocLabels map[string]string) []chapterDoc {
	chapters := make([]chapterDoc, 0, len(spine))
	for i, chapterPath := range spine {
		title := ""
		if tocLabels != nil {
			title = normalizeWhitespace(tocLabels[chapterPath])
		}
		if title == "" && entries != nil {
			data, err := readZipEntry(entries, chapterPath)
			if err == nil {
				title = extractChapterTitle(data)
			}
		}
		chapters = append(chapters, chapterDoc{
			Path:  chapterPath,
			Title: fallbackChapterTitle(title, i),
		})
	}
	return chapters
}

func (c *readerCache) load(absEpub string) (readerBookData, error) {
	for {
		c.mu.Lock()
		entry, ok := c.books[absEpub]
		if ok {
			c.lru.MoveToFront(entry.element)
			book := entry.book
			c.mu.Unlock()
			return book, nil
		}
		wait := c.loading[absEpub]
		if wait == nil {
			wait = make(chan struct{})
			c.loading[absEpub] = wait
			c.mu.Unlock()
			book, err := loadReaderBookData(absEpub)
			c.mu.Lock()
			delete(c.loading, absEpub)
			if err == nil {
				entry = &readerCacheEntry{book: book, texts: make([]string, len(book.Spine)), textLoaded: make([]bool, len(book.Spine))}
				entry.element = c.lru.PushFront(absEpub)
				c.books[absEpub] = entry
				c.evict(entry)
			}
			close(wait)
			c.mu.Unlock()
			return book, err
		}
		c.mu.Unlock()
		<-wait
	}
}

func loadReaderBookData(absEpub string) (readerBookData, error) {
	zr, err := zip.OpenReader(absEpub)
	if err != nil {
		return readerBookData{}, err
	}
	defer zr.Close()

	readerData, err := scanner.ParseReaderDataReader(zr)
	if err != nil {
		return readerBookData{}, err
	}

	labels := flattenTOCLabels(readerData.TOC)
	chapters := loadChapterMetadata(zipEntryIndex(&zr.Reader), readerData.Spine, labels)

	return readerBookData{
		Spine:    readerData.Spine,
		Chapters: chapters,
		TOC:      fallbackTOC(readerData.TOC, readerData.Spine, chapters),
	}, nil
}

func fallbackTOC(entries []scanner.TOCEntry, spine []string, chapters []chapterDoc) []scanner.TOCEntry {
	if len(entries) > 0 {
		return entries
	}
	fallback := make([]scanner.TOCEntry, 0, len(spine))
	for i, chapter := range chapters {
		fallback = append(fallback, scanner.TOCEntry{
			Title: fallbackChapterTitle(chapter.Title, i),
			Path:  spine[i],
		})
	}
	return fallback
}

func (c *readerCache) search(ctx context.Context, absEpub, query string) ([]readerSearchMatch, error) {
	entry, release, err := c.pin(absEpub)
	if err != nil {
		return nil, err
	}
	defer release()
	query = strings.ToLower(normalizeWhitespace(query))
	if query == "" {
		return []readerSearchMatch{}, nil
	}
	zr, err := zip.OpenReader(absEpub)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	entries := zipEntryIndex(&zr.Reader)
	var matches []readerSearchMatch
	for i := range entry.book.Spine {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		text, err := c.chapterText(entry, entries, i)
		if err != nil {
			continue
		}
		offset := 0
		for offset < len(text) {
			index := strings.Index(text[offset:], query)
			if index < 0 {
				break
			}
			matches = append(matches, readerSearchMatch{Chapter: i, Title: entry.book.Chapters[i].Title})
			if len(matches) == readerSearchMaxResults {
				return matches, nil
			}
			offset += index + len(query)
		}
	}
	return matches, nil
}

func (c *readerCache) chapterText(entry *readerCacheEntry, entries zipEntries, index int) (string, error) {
	c.mu.Lock()
	if index >= len(entry.texts) {
		c.mu.Unlock()
		return "", errors.New("chapter index out of range")
	}
	if entry.textLoaded[index] {
		text := entry.texts[index]
		c.mu.Unlock()
		return text, nil
	}
	chapterPath := entry.book.Spine[index]
	c.mu.Unlock()

	data, err := readZipEntry(entries, chapterPath)
	if err != nil {
		return "", err
	}
	_, text := extractChapterData(data)
	text = strings.ToLower(text)

	c.mu.Lock()
	entry.texts[index] = text
	entry.textLoaded[index] = true
	c.mu.Unlock()
	return text, nil
}

func (c *readerCache) pin(absEpub string) (*readerCacheEntry, func(), error) {
	for {
		if _, err := c.load(absEpub); err != nil {
			return nil, nil, err
		}
		c.mu.Lock()
		entry, ok := c.books[absEpub]
		if ok {
			entry.pins++
			c.lru.MoveToFront(entry.element)
			c.mu.Unlock()
			return entry, func() {
				c.mu.Lock()
				entry.pins--
				c.evict(nil)
				c.mu.Unlock()
			}, nil
		}
		c.mu.Unlock()
	}
}

func (c *readerCache) evict(except *readerCacheEntry) {
	for c.lru.Len() > readerCacheCapacity {
		for candidate := c.lru.Back(); candidate != nil; candidate = candidate.Prev() {
			entry := c.books[candidate.Value.(string)]
			if entry == except || entry.pins > 0 {
				continue
			}
			delete(c.books, candidate.Value.(string))
			c.lru.Remove(candidate)
			break
		}
		if c.lru.Len() <= readerCacheCapacity {
			return
		}
		return
	}
}

func flattenTOCLabels(entries []scanner.TOCEntry) map[string]string {
	labels := make(map[string]string)
	var walk func([]scanner.TOCEntry)
	walk = func(nodes []scanner.TOCEntry) {
		for _, node := range nodes {
			if node.Path != "" && node.Title != "" {
				if _, ok := labels[node.Path]; !ok {
					labels[node.Path] = node.Title
				}
			}
			walk(node.Children)
		}
	}
	walk(entries)
	return labels
}

func buildTOCHTML(entries []scanner.TOCEntry, spine []string, epubRel, currentPath, currentFragment string) template.HTML {
	indexByPath := make(map[string]int, len(spine))
	for i, chapterPath := range spine {
		indexByPath[chapterPath] = i
	}
	entries = attachSpineContinuations(entries, spine)
	var out strings.Builder
	renderTOCEntries(&out, entries, indexByPath, epubRel, currentPath, currentFragment)
	return template.HTML(out.String())
}

func attachSpineContinuations(entries []scanner.TOCEntry, spine []string) []scanner.TOCEntry {
	if len(entries) == 0 {
		return entries
	}
	cloned := cloneTOCEntries(entries)
	entryByPath := make(map[string]*scanner.TOCEntry)
	indexTOCEntries(cloned, entryByPath)
	var lastMatched *scanner.TOCEntry
	segmentCount := make(map[string]int)
	for _, chapterPath := range spine {
		if entry, ok := entryByPath[chapterPath]; ok {
			lastMatched = entry
			segmentCount[entry.Path] = 1
			continue
		}
		if lastMatched == nil {
			continue
		}
		segmentCount[lastMatched.Path]++
		lastMatched.Children = append(lastMatched.Children, scanner.TOCEntry{
			Title:     lastMatched.Title + " · " + strconv.Itoa(segmentCount[lastMatched.Path]),
			Path:      chapterPath,
			Synthetic: true,
		})
	}
	return cloned
}

func renderTOCEntries(out *strings.Builder, entries []scanner.TOCEntry, indexByPath map[string]int, epubRel, currentPath, currentFragment string) bool {
	hasActive := false
	for _, entry := range entries {
		entryActive := renderTOCEntry(out, entry, indexByPath, epubRel, currentPath, currentFragment)
		hasActive = hasActive || entryActive
	}
	return hasActive
}

func renderTOCEntry(out *strings.Builder, entry scanner.TOCEntry, indexByPath map[string]int, epubRel, currentPath, currentFragment string) bool {
	active := entry.Path != "" && entry.Path == currentPath && entry.Fragment == currentFragment
	title := html.EscapeString(entry.Title)

	if len(entry.Children) == 0 {
		if href, ok := readerTOCEntryURL(epubRel, entry.Path, entry.Fragment, indexByPath); ok {
			renderTOCLink(out, title, href, active, indexByPath[entry.Path], entry.Fragment)
		}
		return active
	}

	allSynthetic := true
	for _, child := range entry.Children {
		if !child.Synthetic {
			allSynthetic = false
			break
		}
	}

	if allSynthetic {
		if href, ok := readerTOCEntryURL(epubRel, entry.Path, entry.Fragment, indexByPath); ok {
			renderTOCLink(out, title, href, active, indexByPath[entry.Path], entry.Fragment)
		}
		return active
	}

	realChildren := make([]scanner.TOCEntry, 0, len(entry.Children))
	for _, child := range entry.Children {
		if !child.Synthetic {
			realChildren = append(realChildren, child)
		}
	}

	childBuf := &strings.Builder{}
	childActive := renderTOCEntries(childBuf, realChildren, indexByPath, epubRel, currentPath, currentFragment)
	branchActive := active || childActive

	href, hasHref := readerTOCEntryURL(epubRel, entry.Path, entry.Fragment, indexByPath)
	out.WriteString(`<div class="group-section`)
	if branchActive {
		out.WriteString(` open`)
	}
	out.WriteString(`">`)
	out.WriteString(`<div class="group-header">`)
	if hasHref {
		out.WriteString(`<a class="group-header-link" href="`)
		out.WriteString(html.EscapeString(href))
		out.WriteString(`"><span>`)
		out.WriteString(title)
		out.WriteString(`</span></a>`)
	} else {
		out.WriteString(`<span>`)
		out.WriteString(title)
		out.WriteString(`</span>`)
	}
	out.WriteString(`<span class="group-chevron">&#9654;</span></div>`)
	out.WriteString(`<div class="group-items"><div class="group-items-inner">`)
	out.WriteString(childBuf.String())
	out.WriteString(`</div></div></div>`)
	return branchActive
}

func renderTOCLink(out *strings.Builder, title, href string, active bool, chapterIndex int, fragment string) {
	out.WriteString(`<a class="group-item`)
	if active {
		out.WriteString(` active`)
	}
	out.WriteString(`" data-toc-chapter="`)
	out.WriteString(strconv.Itoa(chapterIndex))
	out.WriteString(`" data-toc-fragment="`)
	out.WriteString(html.EscapeString(fragment))
	out.WriteString(`" href="`)
	out.WriteString(html.EscapeString(href))
	out.WriteString(`"><span class="group-item-label">`)
	out.WriteString(title)
	out.WriteString(`</span></a>`)
}

func cloneTOCEntries(entries []scanner.TOCEntry) []scanner.TOCEntry {
	cloned := make([]scanner.TOCEntry, len(entries))
	for i, entry := range entries {
		cloned[i] = scanner.TOCEntry{
			Title:    entry.Title,
			Path:     entry.Path,
			Fragment: entry.Fragment,
			Children: cloneTOCEntries(entry.Children),
		}
	}
	return cloned
}

func indexTOCEntries(entries []scanner.TOCEntry, byPath map[string]*scanner.TOCEntry) {
	for i := range entries {
		entry := &entries[i]
		if entry.Path != "" {
			byPath[entry.Path] = entry
		}
		indexTOCEntries(entry.Children, byPath)
	}
}

func readerTOCEntryURL(epubRel, entryPath, fragment string, indexByPath map[string]int) (string, bool) {
	chapterIndex, ok := indexByPath[entryPath]
	if !ok {
		return "", false
	}
	return readerShellURL(epubRel, chapterIndex, fragment), true
}

func extractChapterTitle(chapterHTML []byte) string {
	doc, err := xhtml.Parse(bytes.NewReader(chapterHTML))
	if err != nil {
		return ""
	}
	return chapterTitle(doc)
}

func extractChapterData(chapterHTML []byte) (string, string) {
	doc, err := xhtml.Parse(bytes.NewReader(chapterHTML))
	if err != nil {
		return "", ""
	}
	title := chapterTitle(doc)
	body := findHTMLNode(doc, "body")
	if body == nil {
		return title, ""
	}
	return title, normalizeWhitespace(nodeText(body))
}

func chapterTitle(doc *xhtml.Node) string {
	var title string
	if documentTitle := strings.TrimSpace(nodeText(findHTMLNode(doc, "title"))); documentTitle != "" {
		title = normalizeWhitespace(documentTitle)
	} else {
		for _, tag := range []string{"h1", "h2", "h3"} {
			if node := findHTMLNode(doc, tag); node != nil {
				if heading := normalizeWhitespace(nodeText(node)); heading != "" {
					title = heading
					break
				}
			}
		}
	}

	return title
}

func injectReaderBaseline(doc *xhtml.Node) {
	head := findHTMLNode(doc, "head")
	if head == nil {
		return
	}

	script := &xhtml.Node{
		Type: xhtml.ElementNode,
		Data: "script",
	}
	script.AppendChild(&xhtml.Node{
		Type: xhtml.TextNode,
		Data: `(function(){var parentWindow=window.parent;if(!parentWindow||parentWindow===window)return;var parentDocument=parentWindow.document;var settings=parentWindow.Settings;if(!parentDocument||!settings)return;var defaults=parentWindow.getComputedStyle(parentDocument.documentElement);var root=document.documentElement;Object.keys(settings.readerProperties).forEach(function(name){var preference=settings.readerProperties[name];var value=localStorage.getItem(settings.readerStoragePrefix+preference)||(preference==="size"?defaults.getPropertyValue("--fs-base").trim():defaults.getPropertyValue(settings.readerDefaults[preference]).trim());if(value)root.style.setProperty(name,value);});settings.readerStaticProperties.forEach(function(name){var value=defaults.getPropertyValue(name).trim();if(value)root.style.setProperty(name,value);});var font=defaults.getPropertyValue("--font-sans").trim();if(font)root.style.fontFamily=font;}());`,
	})
	head.AppendChild(script)

	style := &xhtml.Node{
		Type: xhtml.ElementNode,
		Data: "style",
	}
	style.AppendChild(&xhtml.Node{
		Type: xhtml.TextNode,
		Data: `html {
  background: var(--reader-bg);
  color: var(--reader-fg);
  font-size: var(--reader-size);
}
body {
  background: var(--reader-bg);
  color: var(--reader-fg);
  box-sizing: border-box;
  min-height: var(--reader-min-height);
  padding: var(--reader-padding-top) var(--reader-pad-x) var(--reader-padding-bottom);
}
::selection {
  background: var(--reader-selection);
  color: var(--reader-fg);
}
`,
	})
	head.AppendChild(style)
}

func rewriteDocumentLinks(root *xhtml.Node, epubRel, chapterPath string, spine []string) {
	chapterIndexByPath := make(map[string]int, len(spine))
	for i, chapter := range spine {
		chapterIndexByPath[chapter] = i
	}

	var walk func(*xhtml.Node)
	walk = func(node *xhtml.Node) {
		if node.Type == xhtml.ElementNode {
			for i := range node.Attr {
				attr := &node.Attr[i]
				switch {
				case attr.Key == "src" && attr.Namespace == "":
					attr.Val = rewriteAssetURL(attr.Val, epubRel, chapterPath)
				case attr.Key == "href" && attr.Namespace == "":
					rewritten, targetTop := rewriteHrefURL(attr.Val, epubRel, chapterPath, chapterIndexByPath)
					attr.Val = rewritten
					if targetTop {
						setNodeAttr(node, "target", "_top")
					}
				case attr.Key == "href" && attr.Namespace == "xlink":
					attr.Val = rewriteAssetURL(attr.Val, epubRel, chapterPath)
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(root)
}

func rewriteHrefURL(rawValue, epubRel, chapterPath string, chapterIndexByPath map[string]int) (string, bool) {
	rawValue = strings.TrimSpace(rawValue)
	if rawValue == "" || strings.HasPrefix(rawValue, "#") || strings.HasPrefix(rawValue, "/") || strings.HasPrefix(rawValue, "//") {
		return rawValue, false
	}

	parsed, err := url.Parse(rawValue)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" {
		return rawValue, false
	}

	resolvedPath := cleanPathSegment(path.Join(path.Dir(chapterPath), parsed.Path))
	if resolvedPath == "" {
		return rawValue, false
	}

	if chapterIndex, ok := chapterIndexByPath[resolvedPath]; ok {
		rewritten := readerShellURL(epubRel, chapterIndex, parsed.Fragment)
		return rewritten, true
	}

	return rewriteAssetURL(rawValue, epubRel, chapterPath), false
}

func rewriteAssetURL(rawValue, epubRel, chapterPath string) string {
	rawValue = strings.TrimSpace(rawValue)
	if rawValue == "" || strings.HasPrefix(rawValue, "#") || strings.HasPrefix(rawValue, "/") || strings.HasPrefix(rawValue, "//") {
		return rawValue
	}

	parsed, err := url.Parse(rawValue)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Path == "" {
		return rawValue
	}

	resolvedPath := cleanPathSegment(path.Join(path.Dir(chapterPath), parsed.Path))
	if resolvedPath == "" {
		return rawValue
	}

	rewritten := contract.Routes["read"] + encodeURLPath(epubRel) + "/asset/" + encodeURLPath(resolvedPath)
	if parsed.RawQuery != "" {
		rewritten += "?" + parsed.RawQuery
	}
	if parsed.Fragment != "" {
		rewritten += "#" + parsed.Fragment
	}
	return rewritten
}

type zipEntries map[string]*zip.File

func zipEntryIndex(r *zip.Reader) zipEntries {
	entries := make(zipEntries, len(r.File))
	for _, f := range r.File {
		if _, exists := entries[f.Name]; !exists {
			entries[f.Name] = f
		}
	}
	return entries
}

func readZipEntry(entries zipEntries, entry string) ([]byte, error) {
	f, ok := entries[entry]
	if !ok {
		return nil, errors.New("entry not found")
	}
	if f.CompressedSize64 > maxReaderEntrySize || f.UncompressedSize64 > maxReaderEntrySize {
		return nil, errors.New("entry exceeds size limit")
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxReaderEntrySize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxReaderEntrySize {
		return nil, errors.New("entry exceeds size limit")
	}
	return data, nil
}

func findHTMLNode(node *xhtml.Node, name string) *xhtml.Node {
	if node.Type == xhtml.ElementNode && node.Data == name {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := findHTMLNode(child, name); found != nil {
			return found
		}
	}
	return nil
}

func nodeText(node *xhtml.Node) string {
	if node == nil {
		return ""
	}
	var parts []string
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n.Type == xhtml.TextNode {
			parts = append(parts, n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return strings.Join(parts, " ")
}

func normalizeWhitespace(value string) string {
	return strings.Join(strings.Fields(html.UnescapeString(value)), " ")
}

func setNodeAttr(node *xhtml.Node, key, value string) {
	for i := range node.Attr {
		if node.Attr[i].Namespace == "" && node.Attr[i].Key == key {
			node.Attr[i].Val = value
			return
		}
	}
	node.Attr = append(node.Attr, xhtml.Attribute{Key: key, Val: value})
}

func fallbackChapterTitle(value string, index int) string {
	if index == 0 {
		return "Cover"
	}
	if strings.TrimSpace(value) != "" {
		return value
	}
	return "Chapter " + strconv.Itoa(index+1)
}

func adjacentChapter(index, total, step int) int {
	adjacent := index + step
	if adjacent < 0 || adjacent >= total {
		return -1
	}
	return adjacent
}

func readerShellURL(epubRel string, chapter int, fragment string) string {
	values := url.Values{}
	values.Set("chapter", strconv.Itoa(chapter))
	if fragment != "" {
		values.Set("frag", fragment)
	}
	return contract.Routes["read"] + encodeURLPath(epubRel) + "?" + values.Encode()
}

func readerChapterDocURL(epubRel string, chapter int, fragment string) string {
	values := url.Values{}
	values.Set("chapter", strconv.Itoa(chapter))
	rewritten := contract.Routes["read"] + encodeURLPath(epubRel) + "/chapter?" + values.Encode()
	if fragment != "" {
		rewritten += "#" + url.PathEscape(fragment)
	}
	return rewritten
}

func encodeURLPath(value string) string {
	parts := strings.Split(value, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func mediaTypeForEntry(entry string) string {
	switch strings.ToLower(filepath.Ext(entry)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

func contentTypeForEntry(entry string) string {
	switch strings.ToLower(filepath.Ext(entry)) {
	case ".xhtml":
		return "application/xhtml+xml"
	case ".css":
		return "text/css; charset=utf-8"
	}
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(entry))); contentType != "" {
		return contentType
	}
	return "application/octet-stream"
}
