package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"html"
	"html/template"
	"io"
	"io/fs"
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
  <style>
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
      grid-template-columns: 280px minmax(0, 1fr);
      overflow: hidden;
    }
    .reader-sidebar {
      background: var(--mantle);
      border-right: 1px solid color-mix(in srgb, var(--surface1) 55%, transparent);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .reader-sidebar-header {
      padding: 24px 20px 18px;
      border-bottom: 1px solid color-mix(in srgb, var(--surface1) 35%, transparent);
    }
    .reader-kicker {
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
      color: var(--teal);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .reader-book-title {
      margin-top: 10px;
      font-family: var(--font-serif);
      font-size: 20px;
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
      padding: 14px 0;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--surface1) transparent;
    }
    .reader-toc-item {
      display: block;
      padding: 9px 20px 9px 24px;
      border-left: 2px solid transparent;
      color: var(--subtext0);
      text-decoration: none;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .reader-toc-item:hover {
      background: color-mix(in srgb, var(--teal) 10%, var(--mantle));
      color: var(--text);
    }
    .reader-toc-item.active {
      border-left-color: var(--blue);
      background: color-mix(in srgb, var(--blue) 16%, transparent);
      color: var(--text);
    }
    .reader-toc-index {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      color: var(--yellow);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .reader-toc-title {
      display: block;
      margin-top: 3px;
      font-size: var(--fs-base);
      line-height: 1.35;
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
      background: color-mix(in srgb, var(--yellow) 14%, var(--mantle));
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
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: var(--text);
      font-size: 22px;
      cursor: pointer;
      padding: 0;
      transition: transform 0.2s ease, color 0.15s ease;
      transform-origin: center;
    }
    .reader-menu-toggle.rotating {
      transform: rotate(180deg);
    }
    .reader-menu-toggle:hover {
      color: var(--mauve);
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
      font-size: var(--fs-md);
      line-height: 1;
    }
	.reader-control-bubble {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		min-height: 22px;
	}
	.reader-current-swatch,
	.reader-current-line {
		position: relative;
		z-index: 1;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--surface1) 75%, transparent);
      flex: 0 0 auto;
    }
    .reader-current-line {
      width: auto;
      min-width: 28px;
      padding: 0 7px;
      background: color-mix(in srgb, var(--surface0) 55%, transparent);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      line-height: 20px;
      text-align: center;
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
    .reader-control-group:focus-within .reader-current-line {
      opacity: 0;
    }
	.reader-swatch-choice,
	.reader-line-choice {
		appearance: none;
		width: 22px;
      height: 22px;
      border: none;
      border-radius: 999px;
      padding: 0;
		cursor: pointer;
		flex: 0 0 auto;
		transition: transform 0.12s ease, outline-color 0.12s ease, box-shadow 0.12s ease;
	}
	.reader-line-choice {
		width: 26px;
		min-width: 0;
		padding: 0;
		background: color-mix(in srgb, var(--surface0) 55%, transparent);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: 20px;
		text-transform: lowercase;
	}
	.reader-swatch-choice:hover,
	.reader-line-choice:hover {
		transform: scale(1.08);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--mauve) 35%, transparent);
	}
	.reader-choice-active {
		outline: 2px solid var(--text);
		outline-offset: 1px;
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
      .reader-sidebar {
        border-right: none;
        border-bottom: 1px solid color-mix(in srgb, var(--surface1) 55%, transparent);
        max-height: 42vh;
      }
      .reader-frame-wrap {
        padding: 16px;
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
    <div class="reader-sidebar-header">
      <div class="reader-kicker">Reader</div>
      <div class="reader-book-title">{{.Title}}</div>
      {{if .Meta}}<div class="reader-book-meta">{{.Meta}}</div>{{end}}
      <div class="reader-sidebar-actions">
        <button type="button" class="reader-library-action" aria-label="Library" onclick="window.location.href='/'">📚</button>
        <span class="reader-sidebar-spacer"></span>
        {{if .Prev}}<a class="reader-action" href="{{.Prev}}" aria-label="Previous">❮</a>{{else}}<span class="reader-action-disabled" aria-hidden="true">❮</span>{{end}}
        {{if .Next}}<a class="reader-action" href="{{.Next}}" aria-label="Next">❯</a>{{else}}<span class="reader-action-disabled" aria-hidden="true">❯</span>{{end}}
      </div>
    </div>
    <nav id="reader-toc" class="reader-toc">
      {{range .Chapters}}
      <a class="reader-toc-item{{if .Active}} active{{end}}" href="{{.URL}}">
        <span class="reader-toc-index">Chapter {{.Number}}</span>
        <span class="reader-toc-title">{{.Title}}</span>
      </a>
      {{end}}
    </nav>
  </aside>
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
              <span class="reader-control-symbol">▣</span>
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
              <span class="reader-control-symbol">A</span>
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
              <span class="reader-control-symbol">↕</span>
              <div class="reader-control-bubble">
                <span id="reader-lh-current" class="reader-current-line">≡</span>
                <div class="reader-bubble-menu" aria-label="Line height">
                  <button type="button" class="reader-line-choice" data-lh="1.4">≣</button>
                  <button type="button" class="reader-line-choice reader-choice-active" data-lh="1.6">≡</button>
                  <button type="button" class="reader-line-choice" data-lh="1.8">☰</button>
                  <button type="button" class="reader-line-choice" data-lh="2">⋮</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <iframe id="reader-frame" class="reader-frame" src="{{.ChapterURL}}" title="{{.CurrentChapter}}"></iframe>
    </div>
  </main>
  <script>
    (function () {
      const frame = document.getElementById('reader-frame');
      const pageTools = document.getElementById('reader-page-tools');
      const menuToggle = document.getElementById('reader-menu-toggle');
      const menuPanel = document.getElementById('reader-menu-panel');
      const toc = document.getElementById('reader-toc');
      const bgCurrent = document.getElementById('reader-bg-current');
      const fgCurrent = document.getElementById('reader-fg-current');
      const lhCurrent = document.getElementById('reader-lh-current');
      const bgChoices = Array.from(document.querySelectorAll('[data-bg]'));
      const fgChoices = Array.from(document.querySelectorAll('[data-fg]'));
      const lhChoices = Array.from(document.querySelectorAll('[data-lh]'));
	      const bubbles = Array.from(document.querySelectorAll('.reader-control-bubble'));
	      const controlGroups = Array.from(document.querySelectorAll('.reader-control-group'));
	      let bg = localStorage.getItem('reader:bg') || '#073541';
	      let fg = localStorage.getItem('reader:fg') || '#fdf6e2';
	      let lh = localStorage.getItem('reader:lh') || '1.6';
	      let hideTimer = null;
	      let openTimer = null;
	      let frameCloseBound = false;

		function applyTheme(nextBg, nextFg, nextLh) {
			const activeBg = nextBg || bg;
			const activeFg = nextFg || fg;
			const activeLh = nextLh || lh;
			const doc = frame.contentDocument;
			if (!doc) return;
			doc.documentElement.style.backgroundColor = activeBg;
			doc.documentElement.style.color = activeFg;
			doc.documentElement.style.lineHeight = activeLh;
			if (doc.body) {
				doc.body.style.backgroundColor = activeBg;
				doc.body.style.color = activeFg;
				doc.body.style.lineHeight = activeLh;
			}
			bgCurrent.style.backgroundColor = activeBg;
			fgCurrent.style.backgroundColor = activeFg;
			lhCurrent.textContent = activeLh === '1.4' ? '≣' : activeLh === '1.6' ? '≡' : activeLh === '1.8' ? '☰' : '⋮';
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
			const current = targetBubble.querySelector('.reader-current-swatch, .reader-current-line');
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
				choice.addEventListener('mouseenter', function () {
					const previewBg = key === 'bg' ? choice.dataset[key] : bg;
					const previewFg = key === 'fg' ? choice.dataset[key] : fg;
					const previewLh = key === 'lh' ? choice.dataset[key] : lh;
					applyTheme(previewBg, previewFg, previewLh);
				});
				choice.addEventListener('mouseleave', function () {
					applyTheme();
				});
				choice.addEventListener('click', function () {
					choices.forEach(item => item.classList.remove('reader-choice-active'));
					choice.classList.add('reader-choice-active');
					setter(choice.dataset[key]);
					localStorage.setItem('reader:' + key, choice.dataset[key]);
            applyTheme();
            scheduleHide();
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

		function syncActiveChoices(choices, key, currentValue) {
			choices.forEach(choice => {
				choice.classList.toggle('reader-choice-active', choice.dataset[key] === currentValue);
			});
		}

      bindChoices(bgChoices, 'bg', value => { bg = value; });
      bindChoices(fgChoices, 'fg', value => { fg = value; });
      bindChoices(lhChoices, 'lh', value => { lh = value; });

      controlGroups.forEach(group => {
        const bubble = group.querySelector('.reader-control-bubble');
        if (!bubble) {
          return;
        }
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
	      syncActiveChoices(lhChoices, 'lh', lh);
		frame.addEventListener('load', function () {
			frameCloseBound = false;
			applyTheme();
			bindFrameClose();
		});
		bindFrameClose();
		applyTheme();
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
	ChapterURL     string
	Prev           string
	Next           string
	Chapters       []readerTOCItem
}

type readerTOCItem struct {
	Number int
	Title  string
	URL    string
	Active bool
}

type chapterDoc struct {
	Path  string
	Title string
}

type readerBookData struct {
	Spine    []string
	Chapters []chapterDoc
}

type readerCache struct {
	mu      sync.RWMutex
	books   map[string]readerBookData
	loading map[string]chan struct{}
	errors  map[string]error
}

func Serve(addr, root string, lib model.Library, static fs.FS) {
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
		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(lib)
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

	stripped, err := fs.Sub(static, "static")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(stripped)))

	log.Printf("metabrowser listening on http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
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
	fragment := r.URL.Query().Get("frag")

	if strings.TrimSpace(title) == "" {
		title = strings.TrimSuffix(path.Base(epubRel), path.Ext(epubRel))
	}

	toc := make([]readerTOCItem, 0, len(book.Chapters))
	for i, chapter := range book.Chapters {
		toc = append(toc, readerTOCItem{
			Number: i + 1,
			Title:  fallbackChapterTitle(chapter.Title, i),
			URL:    readerShellURL(epubRel, i, ""),
			Active: i == chapterIndex,
		})
	}

	data := readerShellData{
		Title:          title,
		Meta:           meta,
		CurrentChapter: fallbackChapterTitle(book.Chapters[chapterIndex].Title, chapterIndex),
		Progress:       strconv.Itoa(chapterIndex+1) + " / " + strconv.Itoa(len(book.Chapters)),
		ChapterURL:     readerChapterDocURL(epubRel, chapterIndex, fragment),
		Chapters:       toc,
	}
	if chapterIndex > 0 {
		data.Prev = readerShellURL(epubRel, chapterIndex-1, "")
	}
	if chapterIndex+1 < len(book.Chapters) {
		data.Next = readerShellURL(epubRel, chapterIndex+1, "")
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

	docHTML, err := buildChapterDocument(chapterHTML, epubRel, chapterPath, book.Spine)
	if err != nil {
		http.Error(w, "error rendering chapter", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := w.Write(docHTML); err != nil {
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

	chapters, err := loadChapterMetadata(&zr.Reader, readerData.Spine, readerData.TOC)
	if err != nil {
		return readerBookData{}, err
	}

	return readerBookData{
		Spine:    readerData.Spine,
		Chapters: chapters,
	}, nil
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

func buildChapterDocument(chapterHTML []byte, epubRel, chapterPath string, spine []string) ([]byte, error) {
	doc, err := xhtml.Parse(bytes.NewReader(chapterHTML))
	if err != nil {
		return nil, err
	}

	rewriteDocumentLinks(doc, epubRel, chapterPath, spine)
	injectReaderBaseline(doc)

	var out bytes.Buffer
	if err := xhtml.Render(&out, doc); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
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
		Data: `(function(){var bg=localStorage.getItem('reader:bg')||'#073541';var fg=localStorage.getItem('reader:fg')||'#fdf6e2';document.documentElement.style.setProperty('--reader-bg',bg);document.documentElement.style.setProperty('--reader-fg',fg);}());`,
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
}
html {
  background: var(--reader-bg);
  color: var(--reader-fg);
}
body {
  background: var(--reader-bg);
  color: var(--reader-fg);
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
