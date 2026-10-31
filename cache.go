package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"colophon/model"
)

type cacheEntry struct {
	ModTime time.Time  `json:"modTime"`
	Book    model.Book `json:"book"`
}

type bookCache map[string]cacheEntry

func cacheDir() string {
	base := os.Getenv(configHomeEnvironment)
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, fallbackConfigDirectory)
	}
	return filepath.Join(base, applicationDirectory, bookCacheDirectory)
}

func cachePath(root string) string {
	sum := sha256.Sum256([]byte(root))
	return filepath.Join(cacheDir(), hex.EncodeToString(sum[:])+jsonExtension)
}

func loadBookCache(root string) bookCache {
	if root == "" {
		return make(bookCache)
	}
	data, err := os.ReadFile(cachePath(root))
	if err != nil {
		return make(bookCache)
	}
	var c bookCache
	if err := json.Unmarshal(data, &c); err != nil {
		return make(bookCache)
	}
	return c
}

func saveBookCache(root string, c bookCache) error {
	if root == "" {
		return nil
	}
	p := cachePath(root)
	if err := os.MkdirAll(filepath.Dir(p), defaultDirectoryMode); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", jsonIndent)
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, defaultFileMode)
}
