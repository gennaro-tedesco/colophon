package server

import (
	"archive/zip"
	"bytes"
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

	"metabrowser/model"
	"metabrowser/scanner"
)

var readerShellTmpl = template.Must(template.New("reader-shell").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{.Title}}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/theme.css">
  <script>
    fetch('/api/config').then(function(r){return r.json();}).then(function(cfg){
      var root = document.documentElement;
      if (cfg.uiFontSize > 0) {
        var b = cfg.uiFontSize;
        root.style.setProperty('--fs-xs',   Math.round(b*0.75)+'px');
        root.style.setProperty('--fs-sm',   Math.round(b*0.9)+'px');
        root.style.setProperty('--fs-base', b+'px');
        root.style.setProperty('--fs-md',   Math.round(b*1.15)+'px');
        root.style.setProperty('--fs-lg',   Math.round(b*1.65)+'px');
      }
      if (cfg.uiFontFamily) {
        root.style.setProperty('--font-sans',  "'"+cfg.uiFontFamily+"', system-ui, sans-serif");
        root.style.setProperty('--font-serif', "'"+cfg.uiFontFamily+"', sans-serif");
      }
    });
  </script>
  <style>
    :root {
      --fs-xs: 15px; --fs-sm: 18px; --fs-base: 20px; --fs-md: 23px; --fs-lg: 33px; --sidebar-w: 280px; --reader-shell-fg: var(--text);
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      height: 100%;
      margin: 0;
      background: var(--base);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: var(--fs-base);
      line-height: 1.5;
    }
    body {
      display: grid;
      grid-template-columns: var(--sidebar-w) 10px minmax(0, 1fr);
      overflow: hidden;
    }
    .reader-sidebar {
      background: var(--mantle);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .reader-sidebar-resizer {
      cursor: col-resize;
      background: transparent;
      touch-action: none;
    }
    .reader-sidebar-toggle {
      position: absolute;
      bottom: 12px;
      left: 12px;
      width: 42px;
      height: 42px;
      border: none;
      background: transparent;
      color: var(--text);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      line-height: 1;
      z-index: 1;
      opacity: 1;
      pointer-events: auto;
      transition: color 0.15s ease;
    }
    .reader-sidebar-toggle:hover {
      color: var(--text);
    }
    body.sidebar-collapsed .reader-sidebar-header,
    body.sidebar-collapsed .reader-toc {
      display: none;
    }
    body.sidebar-collapsed .reader-sidebar {
      overflow: visible;
    }
    .reader-sidebar-header {
      padding: 24px 20px 18px;
      border-bottom: 1px solid color-mix(in srgb, var(--surface1) 35%, transparent);
    }
    .reader-kicker {
      font-family: var(--font-mono);
      font-size: var(--fs-base);
      color: var(--teal);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .reader-book-title {
      margin-top: 10px;
      font-family: var(--font-serif);
      font-size: var(--fs-lg);
      color: var(--text);
      line-height: 1.35;
    }
    .reader-book-meta {
      margin-top: 8px;
      color: var(--subtext0);
      font-size: var(--fs-base);
    }
    .reader-library-action {
      background: var(--surface0);
      border: 1px solid var(--surface1);
      border-radius: 4px;
      color: var(--text);
      font-size: 22px;
      padding: 2px 6px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
      margin: 0;
    }
    .reader-library-action svg {
      width: var(--fs-md);
      height: var(--fs-md);
    }
    .reader-library-action:hover {
      color: var(--mauve);
      background: color-mix(in srgb, var(--mauve) 12%, var(--surface0));
      border-color: var(--mauve);
    }
    .reader-sidebar-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
      align-items: center;
    }
    .reader-action,
    .reader-action-disabled {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 4px;
      text-decoration: none;
      font-family: var(--font-mono);
      font-size: var(--fs-md);
    }
    .reader-action {
      color: var(--text);
      background: color-mix(in srgb, var(--surface0) 75%, transparent);
      border: 1px solid var(--surface1);
    }
    .reader-action:hover {
      color: var(--mauve);
      border-color: var(--mauve);
      background: color-mix(in srgb, var(--mauve) 12%, var(--surface0));
    }
    .reader-action-disabled {
      color: var(--overlay0);
      background: color-mix(in srgb, var(--surface0) 35%, transparent);
      border: 1px solid color-mix(in srgb, var(--surface1) 50%, transparent);
      cursor: default;
    }
    .reader-sidebar-spacer {
      flex: 1;
    }
    .reader-toc {
      flex: 1;
      padding: 14px 0;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--surface1) transparent;
    }
    .group-section {
      margin-bottom: 4px;
    }
    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 20px;
      cursor: pointer;
      user-select: none;
      color: var(--overlay1);
      font-size: var(--fs-md);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      transition: color 0.15s;
    }
    .group-header:hover {
      color: var(--blue);
    }
    .group-chevron {
      font-size: var(--fs-md);
      color: var(--lavender);
      transition: transform 0.2s;
    }
    .group-section.open .group-chevron,
    .group-section.hover-open .group-chevron {
      transform: rotate(90deg);
    }
    .group-items {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.22s ease;
    }
    .group-section.open .group-items,
    .group-section.hover-open .group-items {
      grid-template-rows: 1fr;
    }
    .group-items-inner {
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .group-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 20px 6px 28px;
      cursor: pointer;
      color: var(--subtext0);
      font-size: var(--fs-md);
      transition: color 0.12s, background 0.12s;
      border-left: 2px solid transparent;
      text-decoration: none;
    }
    .group-item:link,
    .group-item:visited {
      color: var(--subtext0);
      text-decoration: none;
    }
    .group-item:hover,
    .group-item:visited:hover {
      color: var(--text);
      background: color-mix(in srgb, var(--teal) 10%, var(--mantle));
      text-decoration: none;
    }
    .group-item.active {
      color: var(--blue);
      border-left-color: var(--blue);
      background: color-mix(in srgb, var(--blue) 16%, transparent);
    }
    .group-header-link {
      flex: 1;
      color: inherit;
      text-decoration: none;
      min-width: 0;
    }
    .group-header-link:link,
    .group-header-link:visited {
      color: inherit;
      text-decoration: none;
    }
    .group-item-label {
      display: block;
      min-width: 0;
    }
    .reader-main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--teal) 12%, transparent), transparent 32%),
        linear-gradient(180deg, color-mix(in srgb, var(--mantle) 28%, var(--base)), var(--base));
    }
    .reader-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid color-mix(in srgb, var(--surface1) 35%, transparent);
      background: color-mix(in srgb, var(--base) 82%, transparent);
    }
    .reader-toolbar-title {
      min-width: 0;
    }
    .reader-toolbar-heading {
      color: var(--text);
      font-family: var(--font-serif);
      font-size: var(--fs-lg);
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .reader-progress-badge {
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
      color: var(--yellow);
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
    }
	    .reader-frame-wrap {
	      position: relative;
	      flex: 1;
	      min-height: 0;
	      padding: 20px 24px 24px;
	    }
    .reader-next-chapter {
      position: absolute;
      right: 72px;
      bottom: 40px;
      z-index: 3;
      color: var(--reader-shell-fg);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      min-height: 36px;
      padding: 0 12px;
      font-family: var(--font-mono);
      font-size: var(--fs-md);
      text-decoration: none;
      opacity: 0;
      pointer-events: none;
      transform: translateY(12px);
      transition: opacity 0.18s ease, transform 0.18s ease, color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .reader-next-chapter:link,
    .reader-next-chapter:visited,
    .reader-next-chapter:hover,
    .reader-next-chapter:active,
    .reader-next-chapter:focus {
      color: var(--reader-shell-fg);
      text-decoration: none;
    }
    .reader-next-chapter.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
	    .reader-page-tools {
      position: absolute;
      top: 32px;
      left: 36px;
      z-index: 2;
      display: flex;
      align-items: flex-start;
    }
    .reader-menu-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border: none;
      background: transparent;
      color: var(--reader-shell-fg);
      font-size: 44px;
      cursor: pointer;
      padding: 0;
      transition: transform 0.2s ease, color 0.15s ease;
      transform-origin: center;
    }
    .reader-menu-toggle,
    .reader-menu-toggle:hover,
    .reader-menu-toggle:active,
    .reader-menu-toggle:focus {
      color: var(--reader-shell-fg);
    }
    .reader-menu-toggle.rotating {
      transform: rotate(180deg);
    }
    .reader-menu-panel {
      display: none;
    }
    .reader-menu-panel.open {
      display: block;
    }
    .reader-page-tools.open .reader-menu-toggle {
      display: none;
    }
    .reader-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .reader-control-group {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid color-mix(in srgb, var(--surface1) 55%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--base) 72%, transparent);
      backdrop-filter: blur(10px);
    }
    .reader-control-symbol {
      color: var(--yellow);
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .reader-control-symbol svg {
      width: var(--fs-md);
      height: var(--fs-md);
      flex: 0 0 auto;
    }
	.reader-control-bubble {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		min-height: 26px;
	}
	    .reader-current-swatch,
	    .reader-current-line,
	    .reader-current-size {
	      position: relative;
	      z-index: 1;
	      width: 26px;
		height: 26px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--surface1) 75%, transparent);
      flex: 0 0 auto;
    }
	    .reader-current-line,
	    .reader-current-size {
	      width: auto;
	      min-width: 32px;
	      padding: 0 7px;
      background: color-mix(in srgb, var(--surface0) 55%, transparent);
      color: var(--text);
      font-family: var(--font-mono);
	      font-size: var(--fs-sm);
	      line-height: 26px;
	      text-align: center;
	    }
	    .reader-current-size {
	      font-size: var(--fs-sm);
	      line-height: 26px;
	    }
	.reader-bubble-menu {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 34px;
		max-height: 0;
		padding: 0;
		border-radius: 999px;
		overflow: hidden;
		background: color-mix(in srgb, var(--base) 92%, transparent);
		opacity: 0;
		pointer-events: none;
		transform: translate(-50%, 0) scaleY(0.82);
		transform-origin: top center;
		transition: max-height 0.14s ease, opacity 0.14s ease, padding 0.14s ease, transform 0.14s ease;
	}
	.reader-control-bubble.open .reader-bubble-menu,
	.reader-control-group:focus-within .reader-bubble-menu {
		max-height: 180px;
		padding: 24px 4px 4px;
		opacity: 1;
		pointer-events: auto;
		border: 1px solid color-mix(in srgb, var(--surface1) 75%, transparent);
		transform: translate(-50%, 0) scaleY(1);
	}
	    .reader-control-bubble.open .reader-current-swatch,
	    .reader-control-group:focus-within .reader-current-swatch,
	    .reader-control-bubble.open .reader-current-line,
	    .reader-control-group:focus-within .reader-current-line,
	    .reader-control-bubble.open .reader-current-size,
	    .reader-control-group:focus-within .reader-current-size {
	      opacity: 0;
	    }
	    .reader-swatch-choice {
	      appearance: none;
	      width: 22px;
	      height: 22px;
	      border: none;
	      border-radius: 999px;
	      padding: 0;
	      cursor: pointer;
	      flex: 0 0 auto;
	      transition: transform 0.12s ease, box-shadow 0.12s ease;
	    }
	    .reader-swatch-choice:hover {
	      transform: scale(1.08);
	      box-shadow: 0 0 0 2px color-mix(in srgb, var(--mauve) 35%, transparent);
	    }
	    .reader-choice-active {
	      outline: 2px solid var(--text);
	      outline-offset: 1px;
	    }
	    .reader-slider {
	      writing-mode: vertical-lr;
	      direction: rtl;
	      appearance: slider-vertical;
	      width: 26px;
	      height: 110px;
	      cursor: pointer;
	      accent-color: var(--blue);
	      background: transparent;
	      margin: 0;
	      padding: 0;
	    }
	    .reader-font-menu {
	      width: 180px;
	      overflow-y: auto;
	      max-height: 160px;
	      border-radius: 8px;
	      align-items: stretch;
	    }
	    .reader-font-choice {
	      display: block;
	      width: 100%;
	      text-align: left;
	      background: none;
	      border: none;
	      color: var(--text);
	      font-size: 13px;
	      padding: 3px 6px;
	      cursor: pointer;
	      border-radius: 3px;
	      white-space: nowrap;
	      outline: none;
	    }
	    .reader-font-choice:hover {
	      background: var(--surface1);
	    }
	    .reader-font-choice.reader-choice-active {
	      outline: none;
	      color: var(--blue);
	    }
	    .reader-frame {
	      width: 100%;
	      height: 100%;
	      min-height: 400px;
	      border: 1px solid color-mix(in srgb, var(--surface1) 45%, transparent);
	      border-radius: 12px;
	      background: var(--base);
	      box-shadow: 0 24px 80px color-mix(in srgb, black 20%, transparent);
	    }
	    @media (max-width: 920px) {
      body {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
      }
      .reader-sidebar-resizer {
        display: none;
      }
      .reader-sidebar {
        border-right: none;
        border-bottom: 1px solid color-mix(in srgb, var(--surface1) 55%, transparent);
        max-height: 42vh;
      }
      .reader-frame-wrap {
        padding: 16px;
      }
      .reader-next-chapter {
        right: 56px;
        bottom: 24px;
      }
      .reader-page-tools {
        top: 24px;
        left: 24px;
      }
    }
  </style>
</head>
<body>
  <aside class="reader-sidebar">
    <button id="reader-sidebar-toggle" class="reader-sidebar-toggle" type="button" aria-label="Collapse sidebar">‹</button>
    <div class="reader-sidebar-header">
      <div class="reader-kicker">Reader</div>
      <div class="reader-book-title">{{.Title}}</div>
      {{if .Meta}}<div class="reader-book-meta">{{.Meta}}</div>{{end}}
      <div class="reader-sidebar-actions">
        <button type="button" class="reader-library-action" aria-label="Library" onclick="window.location.href='/'"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg></button>
        <span class="reader-sidebar-spacer"></span>
        {{if .Prev}}<a class="reader-action" href="{{.Prev}}" aria-label="Previous">❮</a>{{else}}<span class="reader-action-disabled" aria-hidden="true">❮</span>{{end}}
        {{if .Next}}<a class="reader-action" href="{{.Next}}" aria-label="Next">❯</a>{{else}}<span class="reader-action-disabled" aria-hidden="true">❯</span>{{end}}
      </div>
    </div>
	    <nav id="reader-toc" class="reader-toc">{{.TOCHTML}}</nav>
  </aside>
  <div id="reader-sidebar-resizer" class="reader-sidebar-resizer" aria-hidden="true"></div>
  <main class="reader-main">
    <div class="reader-toolbar">
      <div class="reader-toolbar-title">
        <div class="reader-toolbar-heading">{{.CurrentChapter}}</div>
      </div>
      <div class="reader-progress-badge">{{.Progress}}</div>
    </div>
    <div class="reader-frame-wrap">
      <div id="reader-page-tools" class="reader-page-tools">
        <button id="reader-menu-toggle" type="button" class="reader-menu-toggle" aria-label="Reader menu">☰</button>
        <div id="reader-menu-panel" class="reader-menu-panel">
          <div class="reader-controls">
            <div class="reader-control-group" aria-label="Background color">
              <span class="reader-control-symbol"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg></span>
              <div class="reader-control-bubble">
                <span id="reader-bg-current" class="reader-current-swatch" style="background:#073541"></span>
                <div class="reader-bubble-menu" aria-label="Background color">
                  <button type="button" class="reader-swatch-choice reader-choice-active" data-bg="#073541" style="background:#073541" aria-label="Background color 1"></button>
                  <button type="button" class="reader-swatch-choice" data-bg="#002b36" style="background:#002b36" aria-label="Background color 2"></button>
                  <button type="button" class="reader-swatch-choice" data-bg="#1e1e1e" style="background:#1e1e1e" aria-label="Background color 3"></button>
                  <button type="button" class="reader-swatch-choice" data-bg="#fdf6e3" style="background:#fdf6e3" aria-label="Background color 4"></button>
                </div>
              </div>
            </div>
            <div class="reader-control-group" aria-label="Text color">
              <span class="reader-control-symbol"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/></svg></span>
              <div class="reader-control-bubble">
                <span id="reader-fg-current" class="reader-current-swatch" style="background:#fdf6e2"></span>
                <div class="reader-bubble-menu" aria-label="Text color">
                  <button type="button" class="reader-swatch-choice reader-choice-active" data-fg="#fdf6e2" style="background:#fdf6e2" aria-label="Text color 1"></button>
                  <button type="button" class="reader-swatch-choice" data-fg="#93a1a1" style="background:#93a1a1" aria-label="Text color 2"></button>
                  <button type="button" class="reader-swatch-choice" data-fg="#eee8d5" style="background:#eee8d5" aria-label="Text color 3"></button>
                  <button type="button" class="reader-swatch-choice" data-fg="#073642" style="background:#073642" aria-label="Text color 4"></button>
                </div>
              </div>
            </div>
	            <div class="reader-control-group" aria-label="Line height">
	              <span class="reader-control-symbol"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m8 18 4 4 4-4"/><path d="m8 6 4-4 4 4"/></svg></span>
	              <div class="reader-control-bubble">
	                <span id="reader-lh-current" class="reader-current-line">1.6</span>
	                <div class="reader-bubble-menu" aria-label="Line height">
	                  <input type="range" orient="vertical" id="reader-lh-slider" class="reader-slider" min="1.2" max="2.4" step="0.1" value="1.6">
	                </div>
	              </div>
	            </div>
	            <div class="reader-control-group" aria-label="Font size">
	              <span class="reader-control-symbol"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 16 2.536-7.328a1.02 1.02 0 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/></svg></span>
	              <div class="reader-control-bubble">
	                <span id="reader-size-current" class="reader-current-size">16</span>
	                <div class="reader-bubble-menu" aria-label="Font size">
	                  <input type="range" orient="vertical" id="reader-size-slider" class="reader-slider" min="24" max="48" step="1" value="24">
	                </div>
	              </div>
	            </div>
	            <div class="reader-control-group" aria-label="Page padding">
	              <span class="reader-control-symbol"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h6"/><path d="M15 12h6"/><path d="m7 8-4 4 4 4"/><path d="m17 8 4 4-4 4"/></svg></span>
	              <div class="reader-control-bubble">
	                <span id="reader-pad-current" class="reader-current-size">72</span>
	                <div class="reader-bubble-menu" aria-label="Page padding">
	                  <input type="range" orient="vertical" id="reader-pad-slider" class="reader-slider" min="32" max="160" step="4" value="72">
	                </div>
	              </div>
	            </div>
	            <div class="reader-control-group" aria-label="Font family">
	              <span class="reader-control-symbol"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg></span>
	              <div class="reader-control-bubble">
	                <span id="reader-font-current" class="reader-current-line">Default</span>
	                <div class="reader-bubble-menu reader-font-menu" aria-label="Font family">
	                  <button type="button" class="reader-font-choice reader-choice-active" data-font="">Default</button>
	                </div>
	              </div>
	            </div>
	          </div>
	        </div>
	      </div>
      {{if .Next}}<a id="reader-next-chapter" class="reader-next-chapter" href="{{.Next}}" aria-label="Next chapter">❯</a>{{end}}
	      <iframe id="reader-frame" class="reader-frame" src="{{.IframeSrc}}" title="{{.CurrentChapter}}"></iframe>
	    </div>
	  </main>
	  <script>
	    (function () {
		      const frame = document.getElementById('reader-frame');
		      const nextChapter = document.getElementById('reader-next-chapter');
		      const sidebarResizer = document.getElementById('reader-sidebar-resizer');
		      const sidebarToggle = document.getElementById('reader-sidebar-toggle');
		      const pageTools = document.getElementById('reader-page-tools');
	      const menuToggle = document.getElementById('reader-menu-toggle');
	      const menuPanel = document.getElementById('reader-menu-panel');
	      const toc = document.getElementById('reader-toc');
		      const bgCurrent = document.getElementById('reader-bg-current');
		      const fgCurrent = document.getElementById('reader-fg-current');
		      const lhCurrent = document.getElementById('reader-lh-current');
		      const sizeCurrent = document.getElementById('reader-size-current');
		      const padCurrent = document.getElementById('reader-pad-current');
		      const bgChoices = Array.from(document.querySelectorAll('[data-bg]'));
		      const fgChoices = Array.from(document.querySelectorAll('[data-fg]'));
		      const lhSlider = document.getElementById('reader-lh-slider');
		      const sizeSlider = document.getElementById('reader-size-slider');
		      const padSlider = document.getElementById('reader-pad-slider');
		      const fontCurrent = document.getElementById('reader-font-current');
	      const fontMenu = document.querySelector('.reader-font-menu');
	      const bubbles = Array.from(document.querySelectorAll('.reader-control-bubble'));
	      const controlGroups = Array.from(document.querySelectorAll('.reader-control-group'));
	      let bg = localStorage.getItem('reader:bg') || '#073541';
	      let fg = localStorage.getItem('reader:fg') || '#fdf6e2';
	      let lh = localStorage.getItem('reader:lh') || '1.6';
	      let size = localStorage.getItem('reader:size') || '24px';
	      let padX = localStorage.getItem('reader:px') || '72px';
	      let fontFamily = localStorage.getItem('reader:font') || '';
		      let hideTimer = null;
		      let openTimer = null;
		      let frameCloseBound = false;
		      let frameScrollBound = false;
		      const SIDEBAR_WIDTH_KEY = 'sidebar:width';
		      const SIDEBAR_LAST_KEY = 'sidebar:last-width';
		      const SIDEBAR_MIN = 220;
		      const SIDEBAR_MAX = 520;
		      const SIDEBAR_COLLAPSED = 60;

			function clampSidebarWidth(value) {
				return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
			}

			function applySidebarWidth(value) {
				const width = value <= SIDEBAR_COLLAPSED ? SIDEBAR_COLLAPSED : clampSidebarWidth(value);
				document.documentElement.style.setProperty('--sidebar-w', width + 'px');
				document.body.classList.toggle('sidebar-collapsed', width === SIDEBAR_COLLAPSED);
				if (sidebarToggle) {
					sidebarToggle.textContent = width === SIDEBAR_COLLAPSED ? '❯' : '❮';
					sidebarToggle.setAttribute('aria-label', width === SIDEBAR_COLLAPSED ? 'Expand sidebar' : 'Collapse sidebar');
				}
			}

			function initSidebarResize() {
				const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10);
				if (saved > 0) applySidebarWidth(saved);
				if (!sidebarResizer || window.matchMedia('(max-width: 920px)').matches) return;
				if (sidebarToggle) {
					sidebarToggle.addEventListener('click', function (event) {
						event.stopPropagation();
						const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10) || 0;
						if (current === SIDEBAR_COLLAPSED) {
							const restored = parseInt(localStorage.getItem(SIDEBAR_LAST_KEY) || '', 10) || 280;
							applySidebarWidth(restored);
							localStorage.setItem(SIDEBAR_WIDTH_KEY, String(restored));
							return;
						}
						localStorage.setItem(SIDEBAR_LAST_KEY, String(current));
						applySidebarWidth(SIDEBAR_COLLAPSED);
						localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_COLLAPSED));
					});
				}
				sidebarResizer.addEventListener('pointerdown', function (event) {
					if (event.target === sidebarToggle) return;
					const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 280;
					const startX = event.clientX;
					document.body.classList.add('resizing-sidebar');
					sidebarResizer.setPointerCapture(event.pointerId);
					function onMove(moveEvent) {
						applySidebarWidth(startWidth + (moveEvent.clientX - startX));
					}
					function onEnd(endEvent) {
						sidebarResizer.removeEventListener('pointermove', onMove);
						sidebarResizer.removeEventListener('pointerup', onEnd);
						sidebarResizer.removeEventListener('pointercancel', onEnd);
						document.body.classList.remove('resizing-sidebar');
						sidebarResizer.releasePointerCapture(endEvent.pointerId);
						const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10) || 0;
						if (finalWidth > SIDEBAR_COLLAPSED) {
							localStorage.setItem(SIDEBAR_LAST_KEY, String(finalWidth));
						}
						localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
					}
					sidebarResizer.addEventListener('pointermove', onMove);
					sidebarResizer.addEventListener('pointerup', onEnd);
					sidebarResizer.addEventListener('pointercancel', onEnd);
				});
			}

			function applyTheme() {
				applyThemeToFrame(frame, bg, fg, lh, size, padX, fontFamily);
				document.documentElement.style.setProperty('--reader-shell-fg', fg);
				bgCurrent.style.backgroundColor = bg;
				fgCurrent.style.backgroundColor = fg;
				lhCurrent.textContent = lh;
				sizeCurrent.textContent = size.replace('px', '');
				padCurrent.textContent = padX.replace('px', '');
				fontCurrent.textContent = fontFamily || 'Default';
			}

			function applyThemeToFrame(frame, activeBg, activeFg, activeLh, activeSize, activePadX, activeFont) {
				const doc = frame.contentDocument;
				if (!doc) return;
				doc.documentElement.style.setProperty('--reader-bg', activeBg);
				doc.documentElement.style.setProperty('--reader-fg', activeFg);
				doc.documentElement.style.setProperty('--reader-pad-x', activePadX);
				doc.documentElement.style.backgroundColor = activeBg;
				doc.documentElement.style.color = activeFg;
				doc.documentElement.style.lineHeight = activeLh;
				doc.documentElement.style.fontSize = activeSize;
				doc.documentElement.style.fontFamily = activeFont || '';
				if (doc.body) {
					doc.body.style.backgroundColor = activeBg;
					doc.body.style.color = activeFg;
					doc.body.style.lineHeight = activeLh;
					doc.body.style.fontSize = activeSize;
					doc.body.style.paddingLeft = activePadX;
					doc.body.style.paddingRight = activePadX;
					doc.body.style.fontFamily = activeFont || '';
				}
			}

      function scheduleHide() {
        clearTimeout(openTimer);
        openTimer = null;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          closeMenu();
        }, 3000);
      }

      function openMenu() {
        menuPanel.classList.add('open');
        pageTools.classList.add('open');
        menuToggle.classList.remove('rotating');
        scheduleHide();
      }

	      function closeMenu() {
	        menuPanel.classList.remove('open');
	        pageTools.classList.remove('open');
	        clearTimeout(hideTimer);
	        clearTimeout(openTimer);
	        openTimer = null;
	        bubbles.forEach(bubble => bubble.classList.remove('open'));
	      }

      function queueOpenMenu() {
        clearTimeout(hideTimer);
        if (menuPanel.classList.contains('open')) {
          return;
        }
        if (openTimer) {
          return;
        }
        menuToggle.classList.add('rotating');
        openTimer = setTimeout(function () {
          openTimer = null;
          openMenu();
        }, 200);
      }

		function openBubble(targetBubble) {
			const current = targetBubble.querySelector('.reader-current-swatch, .reader-current-line, .reader-current-size, #reader-font-current');
			const menu = targetBubble.querySelector('.reader-bubble-menu');
			if (current && menu) {
				menu.style.left = String(current.offsetLeft + current.offsetWidth / 2) + 'px';
			}
			bubbles.forEach(bubble => {
				bubble.classList.toggle('open', bubble === targetBubble);
			});
		}

      function closeBubble(targetBubble) {
        targetBubble.classList.remove('open');
      }

			function bindChoices(choices, key, setter) {
				choices.forEach(choice => {
						var saved;
						var previewing = false;
						choice.addEventListener('mousedown', function (event) {
							event.stopPropagation();
						});
						choice.addEventListener('pointerdown', function (event) {
							event.preventDefault();
							event.stopPropagation();
							previewing = false;
							saved = choice.dataset[key];
							choices.forEach(item => item.classList.remove('reader-choice-active'));
							choice.classList.add('reader-choice-active');
							setter(choice.dataset[key]);
							localStorage.setItem('reader:' + key, choice.dataset[key]);
							applyTheme();
							scheduleHide();
						});
						choice.addEventListener('mouseenter', function () {
							saved = key === 'bg' ? bg : fg;
							previewing = true;
							setter(choice.dataset[key]);
							applyTheme();
						});
						choice.addEventListener('mouseleave', function () {
							if (previewing) {
								setter(saved);
								applyTheme();
								previewing = false;
							}
					});
				});
			}

			function bindFrameClose() {
				if (frameCloseBound) {
					return;
			}
			const doc = frame.contentDocument;
			if (!doc) return;
			doc.addEventListener('mousedown', function () {
				closeMenu();
				menuToggle.classList.remove('rotating');
			});
				frameCloseBound = true;
			}

			function updateNextChapterVisibility() {
				if (!nextChapter) {
					return;
				}
				const doc = frame.contentDocument;
				if (!doc) {
					nextChapter.classList.remove('visible');
					return;
				}
				const win = doc.defaultView;
				const docEl = doc.documentElement;
				const body = doc.body;
				if (!win || !docEl) {
					nextChapter.classList.remove('visible');
					return;
				}
				const scrollTop = win.scrollY || win.pageYOffset || docEl.scrollTop || (body ? body.scrollTop : 0) || 0;
				const clientHeight = win.innerHeight || docEl.clientHeight || (body ? body.clientHeight : 0) || 0;
				const scrollHeight = Math.max(
					docEl.scrollHeight || 0,
					body ? body.scrollHeight : 0,
					doc.scrollingElement ? doc.scrollingElement.scrollHeight : 0,
				);
				const atBottom = Math.abs(scrollHeight - clientHeight - scrollTop) <= 2;
				nextChapter.classList.toggle('visible', atBottom);
			}

			function bindFrameScroll() {
				if (!nextChapter || frameScrollBound) {
					return;
				}
				const doc = frame.contentDocument;
				if (!doc) {
					return;
				}
				const win = doc.defaultView;
				const docEl = doc.documentElement;
				const body = doc.body;
				if (!win || !docEl) {
					return;
				}
				win.addEventListener('scroll', updateNextChapterVisibility, { passive: true });
				win.addEventListener('resize', updateNextChapterVisibility);
				doc.addEventListener('scroll', updateNextChapterVisibility, { passive: true });
				docEl.addEventListener('scroll', updateNextChapterVisibility, { passive: true });
				if (body) {
					body.addEventListener('scroll', updateNextChapterVisibility, { passive: true });
				}
				frameScrollBound = true;
				updateNextChapterVisibility();
			}

		function syncActiveChoices(choices, key, currentValue) {
			choices.forEach(choice => {
				choice.classList.toggle('reader-choice-active', choice.dataset[key] === currentValue);
			});
		}

	      bindChoices(bgChoices, 'bg', value => { bg = value; });
	      bindChoices(fgChoices, 'fg', value => { fg = value; });
		      lhSlider.value = lh;
		      lhSlider.addEventListener('mousedown', function (event) {
		        event.stopPropagation();
		      });
		      lhSlider.addEventListener('input', function () {
		        lh = lhSlider.value;
		        applyTheme();
	      });
	      lhSlider.addEventListener('change', function () {
	        localStorage.setItem('reader:lh', lh);
	        scheduleHide();
		      });
		      sizeSlider.value = size.replace('px', '');
		      sizeSlider.addEventListener('mousedown', function (event) {
		        event.stopPropagation();
		      });
		      sizeSlider.addEventListener('input', function () {
		        size = sizeSlider.value + 'px';
		        applyTheme();
	      });
		      sizeSlider.addEventListener('change', function () {
		        localStorage.setItem('reader:size', size);
		        scheduleHide();
		      });
		      padSlider.value = padX.replace('px', '');
		      padSlider.addEventListener('mousedown', function (event) {
		        event.stopPropagation();
		      });
		      padSlider.addEventListener('input', function () {
		        padX = padSlider.value + 'px';
		        applyTheme();
		      });
		      padSlider.addEventListener('change', function () {
		        localStorage.setItem('reader:px', padX);
		        scheduleHide();
		      });
		      function bindFontChoices() {
		        const choices = Array.from(fontMenu.querySelectorAll('.reader-font-choice'));
		        choices.forEach(function (choice) {
		          var saved;
		          var previewing = false;
		          choice.addEventListener('mousedown', function (event) {
		            event.stopPropagation();
		          });
		          choice.addEventListener('pointerdown', function (event) {
		            event.preventDefault();
		            event.stopPropagation();
		            previewing = false;
		            saved = choice.dataset.font;
		            choices.forEach(function (c) { c.classList.remove('reader-choice-active'); });
		            choice.classList.add('reader-choice-active');
		            fontFamily = choice.dataset.font;
		            localStorage.setItem('reader:font', fontFamily);
		            applyTheme();
		            closeBubble(fontMenu.closest('.reader-control-bubble'));
		            scheduleHide();
		          });
		          choice.addEventListener('mouseenter', function () {
		            saved = fontFamily;
		            previewing = true;
		            fontFamily = choice.dataset.font;
		            applyTheme();
		          });
		          choice.addEventListener('mouseleave', function () {
		            if (previewing) {
		              fontFamily = saved;
		              applyTheme();
		              previewing = false;
		            }
		          });
		        });
		      }
	      fetch('/api/fonts').then(function(r) { return r.json(); }).then(function (fonts) {
	        fonts.forEach(function (f) {
	          var btn = document.createElement('button');
	          btn.type = 'button';
	          btn.className = 'reader-font-choice';
	          btn.dataset.font = f;
	          btn.textContent = f;
	          btn.style.fontFamily = "'" + f + "'";
	          fontMenu.appendChild(btn);
	        });
	        fontMenu.querySelectorAll('.reader-font-choice').forEach(function (c) {
	          c.classList.toggle('reader-choice-active', c.dataset.font === fontFamily);
	        });
	        bindFontChoices();
	      });

		      controlGroups.forEach(group => {
		        const bubble = group.querySelector('.reader-control-bubble');
		        if (!bubble) {
		          return;
		        }
		        group.addEventListener('mousedown', function (event) {
		          event.stopPropagation();
		        });
		        group.addEventListener('click', function (event) {
		          event.stopPropagation();
		          clearTimeout(hideTimer);
		          if (!menuPanel.classList.contains('open')) {
	            openMenu();
	          }
	          openBubble(bubble);
	        });
	        group.addEventListener('mouseenter', function () {
	          clearTimeout(hideTimer);
	          openBubble(bubble);
        });
        group.addEventListener('mouseleave', function () {
          closeBubble(bubble);
          if (menuPanel.classList.contains('open')) {
            scheduleHide();
          }
        });
      });

      menuToggle.addEventListener('mouseenter', queueOpenMenu);
	      menuToggle.addEventListener('click', function () {
	        if (menuPanel.classList.contains('open')) {
	          closeMenu();
	          return;
	        }
	        queueOpenMenu();
	      });
	      pageTools.addEventListener('mousedown', function (event) {
	        event.stopPropagation();
	      });
	      menuPanel.addEventListener('mousedown', function (event) {
	        event.stopPropagation();
	      });
	      pageTools.addEventListener('mouseenter', function () {
	        clearTimeout(openTimer);
        openTimer = null;
        clearTimeout(hideTimer);
        if (!menuPanel.classList.contains('open')) {
          queueOpenMenu();
        }
      });
      pageTools.addEventListener('mouseleave', function () {
        if (menuPanel.classList.contains('open')) {
          scheduleHide();
          return;
        }
        clearTimeout(openTimer);
        openTimer = null;
        menuToggle.classList.remove('rotating');
      });
      menuPanel.addEventListener('click', scheduleHide);
      menuPanel.addEventListener('focusin', function () {
        if (menuPanel.classList.contains('open')) {
          clearTimeout(hideTimer);
        }
      });
		menuPanel.addEventListener('focusout', function () {
			if (menuPanel.classList.contains('open')) {
				scheduleHide();
			}
		});
		document.addEventListener('mousedown', function (event) {
			if (!pageTools.contains(event.target)) {
				closeMenu();
				menuToggle.classList.remove('rotating');
			}
		});
			if (toc) {
				const tocKey = 'reader:toc:' + window.location.pathname;
	        const savedTop = localStorage.getItem(tocKey);
	        if (savedTop) toc.scrollTop = Number(savedTop);
        toc.addEventListener('scroll', function () {
          localStorage.setItem(tocKey, String(toc.scrollTop));
        });
      }
	      syncActiveChoices(bgChoices, 'bg', bg);
	      syncActiveChoices(fgChoices, 'fg', fg);
			frame.addEventListener('load', function () {
				frameCloseBound = false;
				frameScrollBound = false;
				applyTheme();
				bindFrameClose();
				bindFrameScroll();
				setTimeout(updateNextChapterVisibility, 150);
			});
			initSidebarResize();
			bindFrameClose();
			bindFrameScroll();
			applyTheme();
		document.querySelectorAll('.reader-toc .group-section').forEach(function (section) {
			var hoverTimer = null;
			section.querySelector('.group-header').addEventListener('click', function (e) {
				if (!e.target.closest('a')) {
					section.classList.toggle('open');
				}
			});
			section.addEventListener('mouseenter', function () {
				hoverTimer = setTimeout(function () { section.classList.add('hover-open'); }, 500);
			});
			section.addEventListener('mouseleave', function () {
				clearTimeout(hoverTimer);
				section.classList.remove('hover-open');
			});
		});
      localStorage.setItem('lastRead', JSON.stringify({path: '{{.EncodedPath}}', chapter: {{.CurrentIndex}}, title: '{{.Title}}'}));
      window.openPreferences = function() { window.location.href = '/?openPrefs=1'; };
	})();
  </script>
</body>
</html>
`))

type readerShellData struct {
	Title          string
	Meta           string
	CurrentChapter string
	Progress       string
	Prev           string
	Next           string
	TOCHTML        template.HTML
	EncodedPath    string
	CurrentIndex   int
	IframeSrc      template.URL
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

type readerCache struct {
	mu      sync.RWMutex
	books   map[string]readerBookData
	loading map[string]chan struct{}
	errors  map[string]error
}

func NewHandler(root string, lib model.Library, fonts []string) http.Handler {
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
		json.NewEncoder(w).Encode(lib)
	})

	mux.HandleFunc("/api/fonts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(fonts)
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
			io.Copy(w, rc)
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
			serveReaderShell(w, r, absEpub, epubRel, titleIndex[epubRel], authorIndex[epubRel], cache)
		}
	})

	return mux
}

func serveReaderShell(w http.ResponseWriter, r *http.Request, absEpub, epubRel, title, meta string, cache *readerCache) {
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
		TOCHTML:        buildTOCHTML(book.TOC, book.Spine, epubRel, book.Spine[chapterIndex]),
		EncodedPath:    encodeURLPath(epubRel),
		CurrentIndex:   chapterIndex,
		IframeSrc:      template.URL(readerChapterDocURL(epubRel, chapterIndex, r.URL.Query().Get("frag"))),
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
	w.Write(out.Bytes())
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
	file := cleanZIPPath(assetPath)
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
		io.Copy(w, rc)
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

func cleanZIPPath(value string) string {
	return cleanPathSegment(value)
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

func loadChapterMetadata(r *zip.Reader, spine []string, tocLabels map[string]string) ([]chapterDoc, error) {
	chapters := make([]chapterDoc, 0, len(spine))
	for i, chapterPath := range spine {
		title := ""
		if tocLabels != nil {
			title = normalizeWhitespace(tocLabels[chapterPath])
		}
		data, err := readZipEntry(r, chapterPath)
		if err == nil && title == "" {
			title = extractChapterTitle(data)
		}
		chapters = append(chapters, chapterDoc{
			Path:  chapterPath,
			Title: fallbackChapterTitle(title, i),
		})
	}
	return chapters, nil
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

	chapters, err := loadChapterMetadata(&zr.Reader, readerData.Spine, flattenTOCLabels(readerData.TOC))
	if err != nil {
		return readerBookData{}, err
	}

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

	resolvedPath := cleanZIPPath(path.Join(path.Dir(chapterPath), parsed.Path))
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

	resolvedPath := cleanZIPPath(path.Join(path.Dir(chapterPath), parsed.Path))
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
		data, err := io.ReadAll(rc)
		rc.Close()
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
