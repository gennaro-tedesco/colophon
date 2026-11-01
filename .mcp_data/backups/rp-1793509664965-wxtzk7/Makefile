# Build targets for Colophon.
# Embed the exact HEAD tag or short commit SHA.
VERSION := $(shell git describe --exact-match --tags HEAD 2>/dev/null || git rev-parse --short HEAD)

.PHONY: build

build:
	wails build -ldflags "-X main.version=$(VERSION)"
