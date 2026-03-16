package scanner

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"io"
	"path/filepath"
	"strings"
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
		Metas []struct {
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

	opfDir := filepath.ToSlash(filepath.Dir(opfPath))

	var pkg opfPackage
	for _, f := range r.File {
		if f.Name != opfPath {
			continue
		}
		rc, e := f.Open()
		if e != nil {
			err = e
			return
		}
		data, e := io.ReadAll(rc)
		rc.Close()
		if e != nil {
			err = e
			return
		}
		if e := xml.Unmarshal(data, &pkg); e != nil {
			err = e
			return
		}
		break
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
