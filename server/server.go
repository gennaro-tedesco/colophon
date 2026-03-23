package server

import (
	"archive/zip"
	"bytes"
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
}

type chapterDoc struct {
	Path  string
	Title string
	Text  string
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
	books   map[string]readerBookData
	loading map[string]chan struct{}
	errors  map[string]error
}

func NewHandler(root string, lib model.Library, fonts []string, theme string) http.Handler {
	titleIndex := make(map[string]string, len(lib.Books))
	authorIndex := make(map[string]string, len(lib.Books))
	cache := &readerCache{
		books:   make(map[string]readerBookData),
		loading: make(map[string]chan struct{}),
		errors:  make(map[string]error),
	}
	for _, b := range lib.Books {
		titleIndex[b.Path] = b.Title
		authorIndex[b.Path] = strings.Join(b.Authors, ", ")
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/library", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(lib); err != nil {
			return
		}
	})

	mux.HandleFunc("/api/fonts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(fonts); err != nil {
			return
		}
	})

	mux.HandleFunc("/reader-assets/reader.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		if _, err := io.WriteString(w, readerCSS); err != nil {
			return
		}
	})

	mux.HandleFunc("/reader-assets/reader.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		if _, err := io.WriteString(w, readerJS); err != nil {
			return
		}
	})

	mux.HandleFunc("/reader-search/", func(w http.ResponseWriter, r *http.Request) {
		epubRel := strings.TrimPrefix(r.URL.Path, "/reader-search/")
		absEpub, ok := resolveEpubPath(root, epubRel)
		if !ok {
			http.NotFound(w, r)
			return
		}
		book, err := cache.load(absEpub)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(searchReaderBook(book, query)); err != nil {
			return
		}
	})

	mux.HandleFunc("/cover/", func(w http.ResponseWriter, r *http.Request) {
		epubRel := strings.TrimPrefix(r.URL.Path, "/cover/")
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
			w.Header().Set("Cache-Control", "public, max-age=86400")
			if _, err := io.Copy(w, rc); err != nil {
				return
			}
			return
		}
		http.NotFound(w, r)
	})

	mux.HandleFunc("/read/", func(w http.ResponseWriter, r *http.Request) {
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
			serveReaderShell(w, r, absEpub, epubRel, titleIndex[epubRel], authorIndex[epubRel], cache, theme)
		}
	})

	return mux
}

func serveReaderShell(w http.ResponseWriter, r *http.Request, absEpub, epubRel, title, meta string, cache *readerCache, theme string) {
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
	currentTitle := fallbackChapterTitle(book.Chapters[chapterIndex].Title, chapterIndex)
	if tocTitle := normalizeWhitespace(tocLabels[book.Spine[chapterIndex]]); tocTitle != "" {
		currentTitle = tocTitle
	}

	data := readerShellData{
		Title:          title,
		Meta:           meta,
		CurrentChapter: currentTitle,
		Progress:       strconv.Itoa(chapterIndex+1) + " / " + strconv.Itoa(len(book.Chapters)),
		ChapterCount:   len(book.Chapters),
		TOCHTML:        buildTOCHTML(book.TOC, book.Spine, epubRel, book.Spine[chapterIndex]),
		EncodedPath:    encodeURLPath(epubRel),
		CurrentIndex:   chapterIndex,
		IframeSrc:      template.URL(readerChapterDocURL(epubRel, chapterIndex, r.URL.Query().Get("frag"))),
		Theme:          theme,
	}
	isContinuation := make(map[int]bool)
	for _, contIndices := range spineContinuations(book.Spine, book.TOC) {
		for _, ci := range contIndices {
			isContinuation[ci] = true
		}
	}
	for prev := chapterIndex - 1; prev >= 0; prev-- {
		if !isContinuation[prev] {
			data.Prev = readerShellURL(epubRel, prev, "")
			break
		}
	}
	for next := chapterIndex + 1; next < len(book.Chapters); next++ {
		if !isContinuation[next] {
			data.Next = readerShellURL(epubRel, next, "")
			break
		}
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

	chapterPath := book.Spine[chapterIndex]
	chapterHTML, err := readZipEntry(&zr.Reader, chapterPath)
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

	if contIndices := spineContinuations(book.Spine, book.TOC)[chapterIndex]; len(contIndices) > 0 {
		body := findHTMLNode(doc, "body")
		if body != nil {
			for _, ci := range contIndices {
				contHTML, err := readZipEntry(&zr.Reader, book.Spine[ci])
				if err != nil {
					continue
				}
				contDoc, err := xhtml.Parse(bytes.NewReader(contHTML))
				if err != nil {
					continue
				}
				rewriteDocumentLinks(contDoc, epubRel, book.Spine[ci], book.Spine)
				contBody := findHTMLNode(contDoc, "body")
				if contBody == nil {
					continue
				}
				for child := contBody.FirstChild; child != nil; {
					next := child.NextSibling
					contBody.RemoveChild(child)
					body.AppendChild(child)
					child = next
				}
			}
		}
	}

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
		w.Header().Set("Cache-Control", "public, max-age=3600")
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
	if !strings.HasPrefix(requestPath, "/read/") {
		return "", "", "", false
	}
	trimmed := strings.TrimPrefix(requestPath, "/read/")
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

func loadChapterMetadata(r *zip.Reader, spine []string, tocLabels map[string]string) []chapterDoc {
	chapters := make([]chapterDoc, 0, len(spine))
	for i, chapterPath := range spine {
		title := ""
		text := ""
		if tocLabels != nil {
			title = normalizeWhitespace(tocLabels[chapterPath])
		}
		data, err := readZipEntry(r, chapterPath)
		if err == nil {
			if title == "" {
				title = extractChapterTitle(data)
			}
			text = extractChapterText(data)
		}
		chapters = append(chapters, chapterDoc{
			Path:  chapterPath,
			Title: fallbackChapterTitle(title, i),
			Text:  text,
		})
	}
	return chapters
}

func (c *readerCache) load(absEpub string) (readerBookData, error) {
	for {
		c.mu.RLock()
		book, ok := c.books[absEpub]
		if ok {
			c.mu.RUnlock()
			return book, nil
		}
		loadErr := c.errors[absEpub]
		wait := c.loading[absEpub]
		c.mu.RUnlock()
		if wait == nil {
			if loadErr != nil {
				return readerBookData{}, loadErr
			}
			break
		}
		<-wait
	}

	c.mu.Lock()
	if book, ok := c.books[absEpub]; ok {
		c.mu.Unlock()
		return book, nil
	}
	if wait, ok := c.loading[absEpub]; ok {
		c.mu.Unlock()
		<-wait
		c.mu.RLock()
		book, ok := c.books[absEpub]
		loadErr := c.errors[absEpub]
		c.mu.RUnlock()
		if ok {
			return book, nil
		}
		if loadErr != nil {
			return readerBookData{}, loadErr
		}
		return readerBookData{}, errors.New("reader cache load failed")
	}
	wait := make(chan struct{})
	c.loading[absEpub] = wait
	c.mu.Unlock()

	book, err := loadReaderBookData(absEpub)

	c.mu.Lock()
	delete(c.loading, absEpub)
	if err == nil {
		delete(c.errors, absEpub)
		c.books[absEpub] = book
	} else {
		c.errors[absEpub] = err
	}
	close(wait)
	c.mu.Unlock()

	return book, err
}

func loadReaderBookData(absEpub string) (readerBookData, error) {
	readerData, err := scanner.ParseReaderData(absEpub)
	if err != nil {
		return readerBookData{}, err
	}

	zr, err := zip.OpenReader(absEpub)
	if err != nil {
		return readerBookData{}, err
	}
	defer zr.Close()

	chapters := loadChapterMetadata(&zr.Reader, readerData.Spine, flattenTOCLabels(readerData.TOC))

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

func searchReaderBook(book readerBookData, query string) []readerSearchMatch {
	query = normalizeWhitespace(query)
	if query == "" {
		return []readerSearchMatch{}
	}
	loweredQuery := strings.ToLower(query)
	var matches []readerSearchMatch
	for chapterIndex, chapter := range book.Chapters {
		loweredText := strings.ToLower(chapter.Text)
		offset := 0
		for offset < len(loweredText) {
			matchIndex := strings.Index(loweredText[offset:], loweredQuery)
			if matchIndex == -1 {
				break
			}
			matches = append(matches, readerSearchMatch{
				Chapter: chapterIndex,
				Title:   chapter.Title,
			})
			offset += matchIndex + len(loweredQuery)
		}
	}
	return matches
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

func buildTOCHTML(entries []scanner.TOCEntry, spine []string, epubRel, currentPath string) template.HTML {
	indexByPath := make(map[string]int, len(spine))
	for i, chapterPath := range spine {
		indexByPath[chapterPath] = i
	}
	entries = attachSpineContinuations(entries, spine)
	var out strings.Builder
	renderTOCEntries(&out, entries, indexByPath, epubRel, currentPath)
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

func spineContinuations(spine []string, toc []scanner.TOCEntry) map[int][]int {
	primaryPaths := make(map[string]bool)
	collectTOCPaths(toc, primaryPaths)
	result := make(map[int][]int)
	lastPrimary := -1
	for i, p := range spine {
		if primaryPaths[p] {
			lastPrimary = i
		} else if lastPrimary >= 0 {
			result[lastPrimary] = append(result[lastPrimary], i)
		}
	}
	return result
}

func collectTOCPaths(entries []scanner.TOCEntry, paths map[string]bool) {
	for _, entry := range entries {
		if entry.Path != "" {
			paths[entry.Path] = true
		}
		collectTOCPaths(entry.Children, paths)
	}
}

func renderTOCEntries(out *strings.Builder, entries []scanner.TOCEntry, indexByPath map[string]int, epubRel, currentPath string) bool {
	hasActive := false
	for _, entry := range entries {
		entryActive := renderTOCEntry(out, entry, indexByPath, epubRel, currentPath)
		hasActive = hasActive || entryActive
	}
	return hasActive
}

func renderTOCEntry(out *strings.Builder, entry scanner.TOCEntry, indexByPath map[string]int, epubRel, currentPath string) bool {
	active := entry.Path != "" && entry.Path == currentPath
	title := html.EscapeString(entry.Title)

	if len(entry.Children) == 0 {
		if href, ok := readerTOCEntryURL(epubRel, entry.Path, indexByPath); ok {
			renderTOCLink(out, title, href, active, indexByPath[entry.Path])
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
		if href, ok := readerTOCEntryURL(epubRel, entry.Path, indexByPath); ok {
			renderTOCLink(out, title, href, active, indexByPath[entry.Path])
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
	childActive := renderTOCEntries(childBuf, realChildren, indexByPath, epubRel, currentPath)
	branchActive := active || childActive

	href, hasHref := readerTOCEntryURL(epubRel, entry.Path, indexByPath)
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

func renderTOCLink(out *strings.Builder, title, href string, active bool, chapterIndex int) {
	out.WriteString(`<a class="group-item`)
	if active {
		out.WriteString(` active`)
	}
	out.WriteString(`" data-toc-chapter="`)
	out.WriteString(strconv.Itoa(chapterIndex))
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

func readerTOCEntryURL(epubRel, entryPath string, indexByPath map[string]int) (string, bool) {
	chapterIndex, ok := indexByPath[entryPath]
	if !ok {
		return "", false
	}
	return readerShellURL(epubRel, chapterIndex, ""), true
}

func extractChapterTitle(chapterHTML []byte) string {
	doc, err := xhtml.Parse(bytes.NewReader(chapterHTML))
	if err != nil {
		return ""
	}

	if title := strings.TrimSpace(nodeText(findHTMLNode(doc, "title"))); title != "" {
		return normalizeWhitespace(title)
	}

	for _, tag := range []string{"h1", "h2", "h3"} {
		if node := findHTMLNode(doc, tag); node != nil {
			if title := normalizeWhitespace(nodeText(node)); title != "" {
				return title
			}
		}
	}

	return ""
}

func extractChapterText(chapterHTML []byte) string {
	doc, err := xhtml.Parse(bytes.NewReader(chapterHTML))
	if err != nil {
		return ""
	}
	body := findHTMLNode(doc, "body")
	if body == nil {
		return ""
	}
	return normalizeWhitespace(nodeText(body))
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
		Data: `(function(){var bg=localStorage.getItem('reader:bg')||'#073541';var fg=localStorage.getItem('reader:fg')||'#fdf6e2';var size=localStorage.getItem('reader:size')||'16px';var padX=localStorage.getItem('reader:px')||'72px';document.documentElement.style.setProperty('--reader-bg',bg);document.documentElement.style.setProperty('--reader-fg',fg);document.documentElement.style.setProperty('--reader-size',size);document.documentElement.style.setProperty('--reader-pad-x',padX);}());`,
	})
	head.AppendChild(script)

	style := &xhtml.Node{
		Type: xhtml.ElementNode,
		Data: "style",
	}
	style.AppendChild(&xhtml.Node{
		Type: xhtml.TextNode,
		Data: `:root {
  --reader-bg: #073541;
  --reader-fg: #fdf6e2;
  --reader-size: 16px;
  --reader-pad-x: 72px;
}
html {
  background: var(--reader-bg);
  color: var(--reader-fg);
  font-size: var(--reader-size);
}
body {
  background: var(--reader-bg);
  color: var(--reader-fg);
  box-sizing: border-box;
  min-height: 100vh;
  padding: 3rem var(--reader-pad-x) 4rem;
}
::selection {
  background: rgba(39, 139, 211, 0.35);
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

	rewritten := "/read/" + encodeURLPath(epubRel) + "/asset/" + encodeURLPath(resolvedPath)
	if parsed.RawQuery != "" {
		rewritten += "?" + parsed.RawQuery
	}
	if parsed.Fragment != "" {
		rewritten += "#" + parsed.Fragment
	}
	return rewritten
}

func readZipEntry(r *zip.Reader, entry string) ([]byte, error) {
	for _, f := range r.File {
		if f.Name != entry {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		data, err := io.ReadAll(rc)
		if err != nil {
			return nil, err
		}
		return data, nil
	}
	return nil, errors.New("entry not found")
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

func readerShellURL(epubRel string, chapter int, fragment string) string {
	values := url.Values{}
	values.Set("chapter", strconv.Itoa(chapter))
	if fragment != "" {
		values.Set("frag", fragment)
	}
	return "/read/" + encodeURLPath(epubRel) + "?" + values.Encode()
}

func readerChapterDocURL(epubRel string, chapter int, fragment string) string {
	values := url.Values{}
	values.Set("chapter", strconv.Itoa(chapter))
	rewritten := "/read/" + encodeURLPath(epubRel) + "/chapter?" + values.Encode()
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
