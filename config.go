package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	LibraryDir   string `json:"libraryDir"`
	UIFontFamily string `json:"uiFontFamily"`
	UIFontSize   int    `json:"uiFontSize"`
	Theme        string `json:"theme"`
	Version      string `json:"version,omitempty"`
}

func configPath() string {
	base := os.Getenv(configHomeEnvironment)
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, fallbackConfigDirectory)
	}
	return filepath.Join(base, applicationDirectory, configurationFilename)
}

func loadConfig() Config {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return Config{}
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}
	}
	return cfg
}

func saveConfig(cfg Config) error {
	p := configPath()
	if err := os.MkdirAll(filepath.Dir(p), defaultDirectoryMode); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", jsonIndent)
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, defaultFileMode)
}
