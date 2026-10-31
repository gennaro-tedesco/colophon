package contract

import (
	"encoding/json"
	"io"
	"net/http"
)

const ScriptPath = "/contract.js"
const ResourcesPath = "/resources.css"
const ThemePath = "/theme.css"
const ThemesPath = "/themes/"
const DefaultTheme = "solarized-dark"
const ReaderStoragePrefix = "reader:"

var ReaderDefaults = map[string]string{
	"bg":   "--base",
	"fg":   "--text",
	"lh":   "--reader-line-height-default",
	"size": "--reader-size-default",
	"px":   "--reader-padding-default",
}

type Theme struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type Group struct {
	Key             string `json:"key"`
	NavigationOrder int    `json:"navigationOrder"`
}

var Routes = map[string]string{
	"config":    "/api/config",
	"library":   "/api/library",
	"fonts":     "/api/fonts",
	"read":      "/read/",
	"search":    "/reader-search/",
	"cover":     "/cover/",
	"readerCSS": "/reader-assets/reader.css",
	"readerJS":  "/reader-assets/reader.js",
}

var Events = map[string]string{
	"bookAdded": "book:add",
	"scanDone":  "scan:done",
}

var Themes = []Theme{
	{DefaultTheme, "Solarized Dark"},
	{"solarized-light", "Solarized Light"},
	{"catppuccin-mocha", "Catppuccin Mocha"},
	{"catppuccin-latte", "Catppuccin Latte"},
	{"nord", "Nord"},
	{"everforest", "Everforest"},
	{"tokyonight", "Tokyo Night"},
	{"kanagawa", "Kanagawa"},
	{"rose-pine", "Rose Pine"},
	{"ayu-mirage", "Ayu Mirage"},
	{"iceberg-light", "Iceberg Light"},
}

var Groups = []Group{
	{"language", 1},
	{"series", 2},
	{"tags", 3},
	{"author", 0},
}

func NormalizeTheme(value string) string {
	for _, theme := range Themes {
		if theme.Value == value {
			return value
		}
	}
	return DefaultTheme
}

func ServeScript(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	io.WriteString(w, "window.Contract = ")
	json.NewEncoder(w).Encode(struct {
		DefaultTheme        string            `json:"defaultTheme"`
		Routes              map[string]string `json:"routes"`
		Events              map[string]string `json:"events"`
		Themes              []Theme           `json:"themes"`
		Groups              []Group           `json:"groups"`
		ReaderStoragePrefix string            `json:"readerStoragePrefix"`
		ReaderDefaults      map[string]string `json:"readerDefaults"`
	}{DefaultTheme, Routes, Events, Themes, Groups, ReaderStoragePrefix, ReaderDefaults})
}

func ServeResources(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	for _, theme := range Themes {
		io.WriteString(w, "@import url(\"/themes/"+theme.Value+".css\");\n")
	}
}
