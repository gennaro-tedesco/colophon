package scanner

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"io"
	"path"
	"path/filepath"
	"strings"

	xhtml "golang.org/x/net/html"
)

type container struct {
	Rootfile struct {
		FullPath string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}

type opfPackage struct {
	Metadata struct {
		Titles    []string `xml:"title"`
		Creators  []string `xml:"creator"`
		Languages []string `xml:"language"`
		Subjects  []string `xml:"subject"`
		Metas     []struct {
			Name     string `xml:"name,attr"`
			Content  string `xml:"content,attr"`
			Property string `xml:"property,attr"`
			Refines  string `xml:"refines,attr"`
			Value    string `xml:",chardata"`
		} `xml:"meta"`
	} `xml:"metadata"`
	Manifest struct {
		Items []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			MediaType  string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"item"`
	} `xml:"manifest"`
	Spine struct {
		TOC      string `xml:"toc,attr"`
		Itemrefs []struct {
			IDRef string `xml:"idref,attr"`
		} `xml:"itemref"`
	} `xml:"spine"`
}

type ncx struct {
	NavMap struct {
		Points []ncxNavPoint `xml:"navPoint"`
	} `xml:"navMap"`
}

type ncxNavPoint struct {
	NavLabel struct {
		Text string `xml:"text"`
	} `xml:"navLabel"`
	Content struct {
		Src string `xml:"src,attr"`
	} `xml:"content"`
	Points []ncxNavPoint `xml:"navPoint"`
}

type ReaderData struct {
	Spine []string
	TOC   map[string]string
}

func parseEpub(path string) (title, language, series, coverPath string, authors, tags []string, err error) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return
	}
	defer r.Close()

	opfPath, err := findOPFPath(r)
	if err != nil {
		return
	}

	pkg, opfDir, err := readOPFPackage(r, opfPath)
	if err != nil {
		return
	}

	if len(pkg.Metadata.Titles) > 0 {
		title = strings.TrimSpace(pkg.Metadata.Titles[0])
	}
	if len(pkg.Metadata.Languages) > 0 {
		language = strings.TrimSpace(pkg.Metadata.Languages[0])
	}
	for _, c := range pkg.Metadata.Creators {
		if v := strings.TrimSpace(c); v != "" {
			authors = append(authors, v)
		}
	}
	tags = splitSubjects(pkg.Metadata.Subjects)

	var calibreSeries, collectionSeries string
	coverItemID := ""
	for _, m := range pkg.Metadata.Metas {
		switch m.Name {
		case "calibre:series":
			calibreSeries = strings.TrimSpace(m.Content)
		case "cover":
			coverItemID = strings.TrimSpace(m.Content)
		}
		if m.Property == "belongs-to-collection" && m.Refines == "" {
			collectionSeries = strings.TrimSpace(m.Value)
		}
	}
	if calibreSeries != "" {
		series = calibreSeries
	} else {
		series = collectionSeries
	}

	coverPath = findCoverPath(pkg, opfDir, coverItemID)
	return
}

func ParseSpine(epubPath string) ([]string, error) {
	data, err := ParseReaderData(epubPath)
	if err != nil {
		return nil, err
	}
	return data.Spine, nil
}

func ParseTOC(epubPath string) (map[string]string, error) {
	data, err := ParseReaderData(epubPath)
	if err != nil {
		return nil, err
	}
	if len(data.TOC) == 0 {
		return nil, errors.New("no table of contents found in EPUB")
	}
	return data.TOC, nil
}

func ParseReaderData(epubPath string) (ReaderData, error) {
	r, err := zip.OpenReader(epubPath)
	if err != nil {
		return ReaderData{}, err
	}
	defer r.Close()

	opfPath, err := findOPFPath(r)
	if err != nil {
		return ReaderData{}, err
	}

	pkg, opfDir, err := readOPFPackage(r, opfPath)
	if err != nil {
		return ReaderData{}, err
	}

	spine, err := parseSpine(pkg, opfDir)
	if err != nil {
		return ReaderData{}, err
	}

	return ReaderData{
		Spine: spine,
		TOC:   parseTOCFromPackage(r, pkg, opfDir),
	}, nil
}

func parseTOCFromPackage(r *zip.ReadCloser, pkg opfPackage, opfDir string) map[string]string {
	if toc := parseNavDocumentTOC(r, pkg, opfDir); len(toc) > 0 {
		return toc
	}
	if toc := parseNCXTOC(r, pkg, opfDir); len(toc) > 0 {
		return toc
	}
	return nil
}

func parseSpine(pkg opfPackage, opfDir string) ([]string, error) {
	manifest := make(map[string]struct {
		Href      string
		MediaType string
	}, len(pkg.Manifest.Items))
	for _, item := range pkg.Manifest.Items {
		manifest[item.ID] = struct {
			Href      string
			MediaType string
		}{
			Href:      item.Href,
			MediaType: item.MediaType,
		}
	}

	var spine []string
	for _, itemref := range pkg.Spine.Itemrefs {
		item, ok := manifest[itemref.IDRef]
		if !ok {
			continue
		}
		if item.MediaType != "application/xhtml+xml" && item.MediaType != "text/html" {
			continue
		}
		spine = append(spine, joinOPFPath(opfDir, item.Href))
	}

	if len(spine) == 0 {
		return nil, errors.New("no readable chapters found in EPUB spine")
	}

	return spine, nil
}

func parseNavDocumentTOC(r *zip.ReadCloser, pkg opfPackage, opfDir string) map[string]string {
	for _, item := range pkg.Manifest.Items {
		if !strings.Contains(item.Properties, "nav") {
			continue
		}
		navPath := joinOPFPath(opfDir, item.Href)
		data, err := readZipEntry(r, navPath)
		if err != nil {
			continue
		}
		doc, err := xhtml.Parse(strings.NewReader(string(data)))
		if err != nil {
			continue
		}
		toc := make(map[string]string)
		var walk func(*xhtml.Node)
		walk = func(node *xhtml.Node) {
			if node.Type == xhtml.ElementNode && node.Data == "nav" && hasTOCType(node) {
				collectNavLinks(node, navPath, toc)
				return
			}
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				walk(child)
			}
		}
		walk(doc)
		if len(toc) > 0 {
			return toc
		}
	}
	return nil
}

func parseNCXTOC(r *zip.ReadCloser, pkg opfPackage, opfDir string) map[string]string {
	if pkg.Spine.TOC == "" {
		return nil
	}
	var ncxPath string
	for _, item := range pkg.Manifest.Items {
		if item.ID == pkg.Spine.TOC {
			ncxPath = joinOPFPath(opfDir, item.Href)
			break
		}
	}
	if ncxPath == "" {
		return nil
	}
	data, err := readZipEntry(r, ncxPath)
	if err != nil {
		return nil
	}
	var doc ncx
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil
	}
	toc := make(map[string]string)
	for _, point := range doc.NavMap.Points {
		collectNCXPoints(point, ncxPath, toc)
	}
	if len(toc) == 0 {
		return nil
	}
	return toc
}

func collectNCXPoints(point ncxNavPoint, basePath string, toc map[string]string) {
	if href := strings.TrimSpace(point.Content.Src); href != "" {
		target := resolveBookPath(basePath, href)
		if target != "" {
			if _, exists := toc[target]; !exists {
				toc[target] = normalizeTOCLabel(point.NavLabel.Text)
			}
		}
	}
	for _, child := range point.Points {
		collectNCXPoints(child, basePath, toc)
	}
}

func collectNavLinks(node *xhtml.Node, basePath string, toc map[string]string) {
	var walk func(*xhtml.Node)
	walk = func(current *xhtml.Node) {
		if current.Type == xhtml.ElementNode && current.Data == "a" {
			href := strings.TrimSpace(getAttr(current, "", "href"))
			target := resolveBookPath(basePath, href)
			if target != "" {
				if _, exists := toc[target]; !exists {
					toc[target] = normalizeTOCLabel(nodeText(current))
				}
			}
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
}

func hasTOCType(node *xhtml.Node) bool {
	for _, attr := range node.Attr {
		if attr.Namespace == "epub" && attr.Key == "type" && containsWord(attr.Val, "toc") {
			return true
		}
		if attr.Namespace == "" && attr.Key == "epub:type" && containsWord(attr.Val, "toc") {
			return true
		}
	}
	return false
}

func containsWord(value, target string) bool {
	for _, part := range strings.Fields(strings.ToLower(value)) {
		if part == target {
			return true
		}
	}
	return false
}

func getAttr(node *xhtml.Node, namespace, key string) string {
	for _, attr := range node.Attr {
		if attr.Namespace == namespace && attr.Key == key {
			return attr.Val
		}
	}
	return ""
}

func normalizeTOCLabel(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if value == "" {
		return ""
	}
	return value
}

func nodeText(node *xhtml.Node) string {
	if node == nil {
		return ""
	}
	var parts []string
	var walk func(*xhtml.Node)
	walk = func(current *xhtml.Node) {
		if current.Type == xhtml.TextNode {
			parts = append(parts, current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return strings.Join(parts, " ")
}

func resolveBookPath(basePath, href string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	if idx := strings.IndexByte(href, '#'); idx >= 0 {
		href = href[:idx]
	}
	if href == "" {
		return ""
	}
	if strings.Contains(href, "://") || strings.HasPrefix(href, "/") {
		return ""
	}
	return path.Clean(path.Join(path.Dir(basePath), href))
}

func readZipEntry(r *zip.ReadCloser, entry string) ([]byte, error) {
	for _, f := range r.File {
		if f.Name != entry {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		return data, nil
	}
	return nil, errors.New("ZIP entry not found")
}

func splitSubjects(subjects []string) []string {
	var tags []string
	seen := make(map[string]struct{})

	for _, subject := range subjects {
		for _, part := range strings.FieldsFunc(subject, func(r rune) bool {
			return r == ',' || r == ';' || r == '\n' || r == '\r'
		}) {
			tag := strings.TrimSpace(part)
			if tag == "" {
				continue
			}
			if _, ok := seen[tag]; ok {
				continue
			}
			seen[tag] = struct{}{}
			tags = append(tags, tag)
		}
	}

	return tags
}

func findCoverPath(pkg opfPackage, opfDir, coverItemID string) string {
	for _, item := range pkg.Manifest.Items {
		if item.Properties == "cover-image" && isImageMediaType(item.MediaType) {
			return joinOPFPath(opfDir, item.Href)
		}
	}
	if coverItemID != "" {
		for _, item := range pkg.Manifest.Items {
			if item.ID == coverItemID && isImageMediaType(item.MediaType) {
				return joinOPFPath(opfDir, item.Href)
			}
		}
	}
	for _, item := range pkg.Manifest.Items {
		lower := strings.ToLower(item.Href)
		if isImageMediaType(item.MediaType) && (strings.Contains(lower, "cover") || strings.HasPrefix(strings.ToLower(item.ID), "cover")) {
			return joinOPFPath(opfDir, item.Href)
		}
	}
	return ""
}

func joinOPFPath(opfDir, href string) string {
	if opfDir == "." || opfDir == "" {
		return href
	}
	return opfDir + "/" + href
}

func isImageMediaType(mt string) bool {
	return mt == "image/jpeg" || mt == "image/png" || mt == "image/gif" || mt == "image/webp"
}

func readOPFPackage(r *zip.ReadCloser, opfPath string) (opfPackage, string, error) {
	opfDir := filepath.ToSlash(filepath.Dir(opfPath))

	for _, f := range r.File {
		if f.Name != opfPath {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return opfPackage{}, "", err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return opfPackage{}, "", err
		}

		var pkg opfPackage
		if err := xml.Unmarshal(data, &pkg); err != nil {
			return opfPackage{}, "", err
		}
		return pkg, opfDir, nil
	}

	return opfPackage{}, "", errors.New("OPF document not found in EPUB")
}

func findOPFPath(r *zip.ReadCloser) (string, error) {
	for _, f := range r.File {
		if f.Name == "META-INF/container.xml" {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			data, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				return "", err
			}
			var c container
			if err := xml.Unmarshal(data, &c); err != nil {
				return "", err
			}
			return c.Rootfile.FullPath, nil
		}
	}
	for _, f := range r.File {
		if strings.HasSuffix(f.Name, ".opf") {
			return f.Name, nil
		}
	}
	return "", errors.New("no OPF document found in EPUB")
}
