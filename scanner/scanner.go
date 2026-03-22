package scanner

import (
	"io/fs"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"metabrowser/model"
)

type ScanResult struct {
	ModTime time.Time
	Book    model.Book
}

// Stream walks root for EPUB files and sends parsed results to out as they complete.
// It closes out when all workers finish. The caller must drain out.
func Stream(root string, out chan<- ScanResult) error {
	type fileInfo struct {
		path    string
		modTime time.Time
	}
	var files []fileInfo
	if err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() && strings.ToLower(filepath.Ext(path)) == ".epub" {
			info, err2 := d.Info()
			if err2 != nil {
				return nil
			}
			files = append(files, fileInfo{path, info.ModTime()})
		}
		return nil
	}); err != nil {
		close(out)
		return err
	}

	type job struct {
		path    string
		modTime time.Time
	}
	jobs := make(chan job, len(files))
	for _, f := range files {
		jobs <- job{f.path, f.modTime}
	}
	close(jobs)

	var wg sync.WaitGroup
	for i := 0; i < runtime.NumCPU(); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				if book, ok := parseBook(root, j.path); ok {
					out <- ScanResult{ModTime: j.modTime, Book: book}
				}
			}
		}()
	}

	go func() {
		wg.Wait()
		close(out)
	}()

	return nil
}

func parseBook(root, path string) (model.Book, bool) {
	title, language, series, coverPath, authors, tags, err := parseEpub(path)
	if err != nil {
		return model.Book{}, false
	}
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}

	rel, _ := filepath.Rel(root, path)

	coverURL := ""
	if coverPath != "" {
		coverURL = "/cover/" + filepath.ToSlash(rel) + "?entry=" + coverPath
	}

	return model.Book{
		Title:     title,
		Authors:   authors,
		Language:  normaliseLanguage(language),
		Series:    series,
		Tags:      tags,
		Path:      rel,
		CoverURL:  coverURL,
		CoverPath: coverPath,
	}, true
}

func BuildLibrary(books []model.Book) model.Library {
	langSet := map[string]struct{}{}
	seriesSet := map[string]struct{}{}
	tagSet := map[string]struct{}{}
	authorSet := map[string]struct{}{}

	for _, b := range books {
		if b.Language != "" {
			langSet[b.Language] = struct{}{}
		}
		if b.Series != "" {
			seriesSet[b.Series] = struct{}{}
		}
		for _, t := range b.Tags {
			tagSet[t] = struct{}{}
		}
		for _, a := range b.Authors {
			authorSet[a] = struct{}{}
		}
	}

	groups := map[string][]string{
		"language": setToSortedSlice(langSet),
		"series":   setToSortedSlice(seriesSet),
		"tags":     setToSortedSlice(tagSet),
		"author":   setToSortedSlice(authorSet),
	}

	return model.Library{Books: books, Groups: groups}
}

func setToSortedSlice(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func normaliseLanguage(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	switch lang {
	case "en", "eng":
		return "English"
	case "de", "deu", "ger":
		return "German"
	case "fr", "fra", "fre":
		return "French"
	case "it", "ita":
		return "Italian"
	case "es", "spa":
		return "Spanish"
	case "pt", "por":
		return "Portuguese"
	case "nl", "nld", "dut":
		return "Dutch"
	case "ru", "rus":
		return "Russian"
	case "zh", "zho", "chi":
		return "Chinese"
	case "ja", "jpn":
		return "Japanese"
	case "ar", "ara":
		return "Arabic"
	default:
		if lang == "" {
			return "Unknown"
		}
		return strings.ToUpper(lang[:1]) + lang[1:]
	}
}
