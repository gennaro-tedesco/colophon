package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"metabrowser/model"
)

type cacheEntry struct {
	ModTime time.Time  `json:"modTime"`
	Book    model.Book `json:"book"`
}

type bookCache map[string]cacheEntry

func cacheDir() string {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "metabrowser", "cache")
}

func cachePath(root string) string {
	sum := sha256.Sum256([]byte(root))
	return filepath.Join(cacheDir(), hex.EncodeToString(sum[:])+".json")
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
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}
