(function () {
  function parseColor(str) {
    var s = str.trim();
    if (s.charAt(0) === "#") {
      var hex =
        s.length === 4 ? s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s.slice(1);
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    var m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  function blendColors(c1, ratio, c2) {
    if (!c1) return "transparent";
    if (c2 === null)
      return "rgba(" + c1[0] + "," + c1[1] + "," + c1[2] + "," + ratio + ")";
    if (!c2) return "transparent";
    return (
      "rgb(" +
      Math.round(c1[0] * ratio + c2[0] * (1 - ratio)) +
      "," +
      Math.round(c1[1] * ratio + c2[1] * (1 - ratio)) +
      "," +
      Math.round(c1[2] * ratio + c2[2] * (1 - ratio)) +
      ")"
    );
  }

  function initReaderThemeMixes() {
    var cs = getComputedStyle(document.documentElement);
    var el = document.documentElement;
    function get(v) {
      return cs.getPropertyValue(v).trim();
    }
    var teal = parseColor(get("--teal"));
    var base = parseColor(get("--base"));
    el.style.setProperty("--mix-teal-8-base", blendColors(teal, 0.08, base));
    el.style.setProperty("--mix-teal-14-base", blendColors(teal, 0.14, base));
  }

  function applyConfig(cfg) {
    var root = document.documentElement;
    if (cfg.theme) root.setAttribute("data-theme", cfg.theme);
    initReaderThemeMixes();
    if (cfg.uiFontSize > 0) {
      var b = cfg.uiFontSize;
      root.style.setProperty("--fs-xs", Math.round(b * 0.75) + "px");
      root.style.setProperty("--fs-sm", Math.round(b * 0.9) + "px");
      root.style.setProperty("--fs-base", b + "px");
      root.style.setProperty("--fs-md", Math.round(b * 1.15) + "px");
      root.style.setProperty("--fs-lg", Math.round(b * 1.65) + "px");
    }
    if (cfg.uiFontFamily) {
      root.style.setProperty(
        "--font-sans",
        "'" + cfg.uiFontFamily + "', system-ui, sans-serif",
      );
      root.style.setProperty(
        "--font-serif",
        "'" + cfg.uiFontFamily + "', sans-serif",
      );
    }
  }

  fetch("/api/config")
    .then(function (r) {
      return r.json();
    })
    .then(applyConfig)
    .catch(function () {});

  function init() {
    var body = document.body;
    var chapterCount = Number(body.dataset.readerChapterCount || "0");
    var currentIndex = Number(body.dataset.readerCurrentIndex || "0");
    var encodedPath = body.dataset.readerEncodedPath || "";
    var readerTheme = body.dataset.readerTheme || "";
    if (readerTheme)
      document.documentElement.setAttribute("data-theme", readerTheme);
    initReaderThemeMixes();
    var readerTitle = body.dataset.readerTitle || "";
    var frameStage = document.querySelector(".reader-frame-stage");
    var prevChapter = document.getElementById("reader-prev-chapter");
    var frame = document.getElementById("reader-frame");
    var nextChapter = document.getElementById("reader-next-chapter");
    var sidebarResizer = document.getElementById("reader-sidebar-resizer");
    var sidebarToggle = document.getElementById("reader-sidebar-toggle");
    var pageTools = document.getElementById("reader-page-tools");
    var menuToggle = document.getElementById("reader-menu-toggle");
    var menuPanel = document.getElementById("reader-menu-panel");
    var searchTools = document.getElementById("reader-search-tools");
    var searchToggle = document.getElementById("reader-search-toggle");
    var searchPanel = document.getElementById("reader-search-panel");
    var chapterProgressFill = document.getElementById(
      "reader-chapter-progress-fill",
    );
    var bookProgressFill = document.getElementById("reader-book-progress-fill");
    var toc = document.getElementById("reader-toc");
    var searchForm = document.getElementById("reader-search");
    var searchInput = document.getElementById("reader-search-input");
    var searchReset = document.getElementById("reader-search-reset");
    var searchCount = document.getElementById("reader-search-count");
    var searchPrev = document.getElementById("reader-search-prev");
    var searchNext = document.getElementById("reader-search-next");
    var searchClear = document.getElementById("reader-search-clear");
    var searchScopeToggle = document.getElementById("reader-search-scope");
    var searchScopeIcon = document.getElementById("reader-search-scope-icon");
    var bgCurrent = document.getElementById("reader-bg-current");
    var fgCurrent = document.getElementById("reader-fg-current");
    var lhCurrent = document.getElementById("reader-lh-current");
    var sizeCurrent = document.getElementById("reader-size-current");
    var padCurrent = document.getElementById("reader-pad-current");
    var bgChoices = Array.from(document.querySelectorAll("[data-bg]"));
    var fgChoices = Array.from(document.querySelectorAll("[data-fg]"));
    var lhSlider = document.getElementById("reader-lh-slider");
    var sizeSlider = document.getElementById("reader-size-slider");
    var padSlider = document.getElementById("reader-pad-slider");
    var fontCurrent = document.getElementById("reader-font-current");
    var fontMenu = document.querySelector(".reader-font-menu");
    var bubbles = Array.from(
      document.querySelectorAll(".reader-control-bubble"),
    );
    var controlGroups = Array.from(
      document.querySelectorAll(".reader-control-group"),
    );
    var themePalettes = {
      "solarized-dark": {
        bg: ["#073541", "#002b36", "#00141a", "#1e1e1e", "#eee8d5", "#fdf6e3"],
        fg: ["#fdf6e2", "#eee8d5", "#93a1a1", "#839496", "#586e75", "#073642"],
      },
      "solarized-light": {
        bg: ["#fdf6e3", "#eee8d5", "#ffffff", "#f5f0e1", "#002b36", "#073642"],
        fg: ["#073642", "#002b36", "#586e75", "#657b83", "#839496", "#fdf6e3"],
      },
      "catppuccin-mocha": {
        bg: ["#1e1e2e", "#181825", "#11111b", "#313244", "#45475a", "#cdd6f4"],
        fg: ["#cdd6f4", "#bac2de", "#a6adc8", "#9399b2", "#7f849c", "#1e1e2e"],
      },
      "catppuccin-latte": {
        bg: ["#eff1f5", "#e6e9ef", "#dce0e8", "#ccd0da", "#bcc0cc", "#4c4f69"],
        fg: ["#4c4f69", "#5c5f77", "#6c6f85", "#7c7f93", "#8c8fa1", "#eff1f5"],
      },
      nord: {
        bg: ["#2e3440", "#3b4252", "#434c5e", "#4c566a", "#d8dee9", "#eceff4"],
        fg: ["#eceff4", "#e5e9f0", "#d8dee9", "#81a1c1", "#88c0d0", "#2e3440"],
      },
      everforest: {
        bg: ["#2e383c", "#272e33", "#1e2326", "#374145", "#414b50", "#d3c6aa"],
        fg: ["#d3c6aa", "#9da9a0", "#859289", "#7a8478", "#a7c080", "#2e383c"],
      },
      tokyonight: {
        bg: ["#222436", "#1e2030", "#1b1d2b", "#2f334d", "#3b4261", "#c8d3f5"],
        fg: ["#c8d3f5", "#a9b1d6", "#828bb8", "#737aa2", "#636da6", "#222436"],
      },
      kanagawa: {
        bg: ["#1f1f28", "#16161d", "#2a2a37", "#363646", "#54546d", "#dcd7ba"],
        fg: ["#dcd7ba", "#c8c093", "#938aa9", "#727169", "#9cabca", "#1f1f28"],
      },
      "rose-pine": {
        bg: ["#191724", "#16141f", "#1f1d2e", "#26233a", "#403d52", "#e0def4"],
        fg: ["#e0def4", "#ebbcba", "#908caa", "#6e6a86", "#c4a7e7", "#191724"],
      },
      "ayu-mirage": {
        bg: ["#1f2430", "#1c212b", "#171b24", "#242936", "#33415e", "#cbccc6"],
        fg: ["#cbccc6", "#8a9199", "#707a8c", "#5ccfe6", "#ffd173", "#1f2430"],
      },
      "iceberg-light": {
        bg: ["#f6f7fb", "#e8ebf3", "#dcdfe7", "#d6dbe8", "#c6ccdc", "#33374c"],
        fg: ["#33374c", "#4a4f69", "#6b7089", "#2d539e", "#7759b4", "#f6f7fb"],
      },
    };
    var bg = localStorage.getItem("reader:bg") || "#073541";
    var fg = localStorage.getItem("reader:fg") || "#fdf6e2";
    var lh = localStorage.getItem("reader:lh") || "1.6";
    var size = localStorage.getItem("reader:size") || "24px";
    var padX = localStorage.getItem("reader:px") || "72px";
    var fontFamily = localStorage.getItem("reader:font") || "";
    var pendingG = false;
    var pendingGTimer = null;
    var searchQuery = "";
    var searchScope =
      sessionStorage.getItem("reader:search-scope:" + encodedPath) || "chapter";
    var searchMatches = [];
    var bookSearchMatches = [];
    var activeBookSearchIndex = -1;
    var activeSearchIndex = -1;
    var hideTimer = null;
    var searchOpenTimer = null;
    var searchHideTimer = null;
    var frameCloseBound = false;
    var frameScrollBound = false;
    var frameSetupDoc = null;
    var SIDEBAR_WIDTH_KEY = "sidebar:width";
    var SIDEBAR_LAST_KEY = "sidebar:last-width";
    var SIDEBAR_MIN = 220;
    var SIDEBAR_MAX = 520;
    var SIDEBAR_COLLAPSED = 60;

    function clampSidebarWidth(value) {
      return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
    }

    function applySidebarWidth(value) {
      var width =
        value <= SIDEBAR_COLLAPSED
          ? SIDEBAR_COLLAPSED
          : clampSidebarWidth(value);
      document.documentElement.style.setProperty("--sidebar-w", width + "px");
      document.body.classList.toggle(
        "sidebar-collapsed",
        width === SIDEBAR_COLLAPSED,
      );
      if (sidebarToggle) {
        sidebarToggle.textContent = width === SIDEBAR_COLLAPSED ? "❯" : "❮";
        sidebarToggle.setAttribute(
          "aria-label",
          width === SIDEBAR_COLLAPSED ? "Expand sidebar" : "Collapse sidebar",
        );
      }
    }

    function initSidebarResize() {
      var saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
      if (saved > 0) applySidebarWidth(saved);
      if (!sidebarResizer || window.matchMedia("(max-width: 920px)").matches)
        return;
      if (sidebarToggle) {
        sidebarToggle.addEventListener("click", function (event) {
          event.stopPropagation();
          var current =
            parseInt(
              getComputedStyle(document.documentElement).getPropertyValue(
                "--sidebar-w",
              ),
              10,
            ) || 0;
          if (current === SIDEBAR_COLLAPSED) {
            var restored =
              parseInt(localStorage.getItem(SIDEBAR_LAST_KEY) || "", 10) || 280;
            applySidebarWidth(restored);
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(restored));
            return;
          }
          localStorage.setItem(SIDEBAR_LAST_KEY, String(current));
          applySidebarWidth(SIDEBAR_COLLAPSED);
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_COLLAPSED));
        });
      }
      sidebarResizer.addEventListener("pointerdown", function (event) {
        if (event.target === sidebarToggle) return;
        var startWidth =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--sidebar-w",
            ),
          ) || 280;
        var startX = event.clientX;
        document.body.classList.add("resizing-sidebar");
        sidebarResizer.setPointerCapture(event.pointerId);
        function onMove(moveEvent) {
          applySidebarWidth(startWidth + (moveEvent.clientX - startX));
        }
        function onEnd(endEvent) {
          sidebarResizer.removeEventListener("pointermove", onMove);
          sidebarResizer.removeEventListener("pointerup", onEnd);
          sidebarResizer.removeEventListener("pointercancel", onEnd);
          document.body.classList.remove("resizing-sidebar");
          sidebarResizer.releasePointerCapture(endEvent.pointerId);
          var finalWidth =
            parseInt(
              getComputedStyle(document.documentElement).getPropertyValue(
                "--sidebar-w",
              ),
              10,
            ) || 0;
          if (finalWidth > SIDEBAR_COLLAPSED) {
            localStorage.setItem(SIDEBAR_LAST_KEY, String(finalWidth));
          }
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
        }
        sidebarResizer.addEventListener("pointermove", onMove);
        sidebarResizer.addEventListener("pointerup", onEnd);
        sidebarResizer.addEventListener("pointercancel", onEnd);
      });
    }

    function applyThemeToFrame(
      activeBg,
      activeFg,
      activeLh,
      activeSize,
      activePadX,
      activeFont,
    ) {
      var doc = frame.contentDocument;
      if (!doc) return;
      doc.documentElement.style.setProperty("--reader-bg", activeBg);
      doc.documentElement.style.setProperty("--reader-fg", activeFg);
      doc.documentElement.style.setProperty("--reader-pad-x", activePadX);
      doc.documentElement.style.backgroundColor = activeBg;
      doc.documentElement.style.color = activeFg;
      doc.documentElement.style.lineHeight = activeLh;
      doc.documentElement.style.fontSize = activeSize;
      doc.documentElement.style.fontFamily = activeFont || "";
      if (doc.body) {
        doc.body.style.backgroundColor = activeBg;
        doc.body.style.color = activeFg;
        doc.body.style.lineHeight = activeLh;
        doc.body.style.fontSize = activeSize;
        doc.body.style.paddingLeft = activePadX;
        doc.body.style.paddingRight = activePadX;
        doc.body.style.fontFamily = activeFont || "";
      }
    }

    function syncActiveChoices(choices, key, currentValue) {
      choices.forEach(function (choice) {
        choice.classList.toggle(
          "reader-choice-active",
          choice.dataset[key] === currentValue,
        );
      });
    }

    function applyTheme() {
      applyThemeToFrame(bg, fg, lh, size, padX, fontFamily);
      document.documentElement.style.setProperty("--reader-shell-fg", fg);
      document.documentElement.style.setProperty("--reader-progress-book", fg);
      document.documentElement.style.setProperty(
        "--reader-progress-chapter",
        fg,
      );
      bgCurrent.style.backgroundColor = bg;
      fgCurrent.style.backgroundColor = fg;
      lhCurrent.textContent = lh;
      sizeCurrent.textContent = size.replace("px", "");
      padCurrent.textContent = padX.replace("px", "");
      fontCurrent.textContent = fontFamily || "Default";
      searchMatches.forEach(function (match, idx) {
        applySearchMarkStyle(match, idx === activeSearchIndex);
      });
    }

    function applySwatchPalette(theme) {
      var pal = themePalettes[theme] || themePalettes["solarized-dark"];
      bgChoices.forEach(function (btn, i) {
        btn.dataset.bg = pal.bg[i];
        btn.style.background = pal.bg[i];
      });
      fgChoices.forEach(function (btn, i) {
        btn.dataset.fg = pal.fg[i];
        btn.style.background = pal.fg[i];
      });
      if (localStorage.getItem("reader:theme") !== theme) {
        bg = pal.bg[0];
        fg = pal.fg[0];
        localStorage.setItem("reader:bg", bg);
        localStorage.setItem("reader:fg", fg);
        localStorage.setItem("reader:theme", theme);
      }
      bgCurrent.style.backgroundColor = bg;
      fgCurrent.style.backgroundColor = fg;
      syncActiveChoices(bgChoices, "bg", bg);
      syncActiveChoices(fgChoices, "fg", fg);
    }

    function isShortcutTargetBlocked(target) {
      if (!target || target.nodeType !== 1) return false;
      if (target.closest("#reader-page-tools")) return true;
      if (target.closest("#reader-search-tools")) return true;
      if (
        target.closest(
          'input, textarea, select, button, a, [contenteditable="true"]',
        )
      )
        return true;
      return false;
    }

    function scrollReaderTo(position) {
      var doc = frame.contentDocument;
      if (!doc) return;
      var win = doc.defaultView;
      var scrollingEl = doc.scrollingElement || doc.documentElement || doc.body;
      if (!scrollingEl) return;
      var top = position === "end" ? scrollingEl.scrollHeight : 0;
      if (win && typeof win.scrollTo === "function") {
        win.scrollTo({ top: top, behavior: "smooth" });
      } else {
        scrollingEl.scrollTop = top;
      }
    }

    function scrollReaderBy(delta) {
      var doc = frame.contentDocument;
      if (!doc) return;
      var win = doc.defaultView;
      if (win && typeof win.scrollBy === "function") {
        win.scrollBy({ top: delta, behavior: "smooth" });
        return;
      }
      var scrollingEl = doc.scrollingElement || doc.documentElement || doc.body;
      if (scrollingEl) scrollingEl.scrollTop += delta;
    }

    function getChapterIndexFromHref(href) {
      if (!href) return null;
      try {
        var url = new URL(href, window.location.href);
        var chapter = parseInt(url.searchParams.get("chapter") || "", 10);
        return Number.isFinite(chapter) ? chapter : null;
      } catch (err) {
        return null;
      }
    }

    function goToChapter(link) {
      if (!link || !link.href) return;
      window.location.href = link.href;
    }

    function goToChapterIndex(index) {
      if (index < 0 || index >= chapterCount) return;
      window.location.href = "/read/" + encodedPath + "?chapter=" + index;
    }

    function bindChapterLinks() {
      document.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        var link = event.target.closest("a[href]");
        if (!link) return;
        if (getChapterIndexFromHref(link.href) === null) return;
      });
    }

    function clearPendingG() {
      pendingG = false;
      if (pendingGTimer) {
        clearTimeout(pendingGTimer);
        pendingGTimer = null;
      }
    }

    function armPendingG() {
      clearPendingG();
      pendingG = true;
      pendingGTimer = setTimeout(function () {
        pendingG = false;
        pendingGTimer = null;
      }, 450);
    }

    function toggleSidebar() {
      if (sidebarToggle) sidebarToggle.click();
    }

    function handleReaderShortcut(event) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        openSearch(true);
        if (searchInput) searchInput.select();
        return;
      }
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        clearPendingG();
        return;
      }
      if (isShortcutTargetBlocked(event.target)) {
        clearPendingG();
        return;
      }
      if (event.isComposing) return;
      if (
        event.repeat &&
        event.key !== "j" &&
        event.key !== "k" &&
        event.key !== "J" &&
        event.key !== "K" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp"
      )
        return;
      if (event.key === "g") {
        event.preventDefault();
        if (pendingG) {
          clearPendingG();
          goToChapterIndex(0);
          return;
        }
        armPendingG();
        return;
      }
      if (event.key === "G") {
        event.preventDefault();
        clearPendingG();
        goToChapterIndex(chapterCount - 1);
        return;
      }
      clearPendingG();
      if (event.key === "J") {
        event.preventDefault();
        scrollReaderTo("end");
        return;
      }
      if (event.key === "K") {
        event.preventDefault();
        scrollReaderTo("start");
        return;
      }
      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          scrollReaderBy(96);
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          scrollReaderBy(-96);
          break;
        case "ArrowRight":
        case "l":
          event.preventDefault();
          goToChapter(nextChapter);
          break;
        case "ArrowLeft":
        case "h":
          event.preventDefault();
          goToChapter(prevChapter);
          break;
        case "Tab":
          event.preventDefault();
          toggleSidebar();
          break;
      }
    }

    function bindReaderShortcuts() {
      window.addEventListener("keydown", handleReaderShortcut);
    }

    function bindFrameShortcuts() {
      var doc = frame.contentDocument;
      if (!doc) return;
      var win = doc.defaultView;
      if (win) win.addEventListener("keydown", handleReaderShortcut);
      doc.addEventListener("keydown", handleReaderShortcut);
    }

    function updateSearchUI() {
      var hasQuery = Boolean(searchQuery);
      var hasMatches =
        searchScope === "book"
          ? bookSearchMatches.length > 0
          : searchMatches.length > 0;
      var currentIndexValue =
        searchScope === "book" ? activeBookSearchIndex : activeSearchIndex;
      var totalMatches =
        searchScope === "book"
          ? bookSearchMatches.length
          : searchMatches.length;
      if (searchCount) {
        if (!hasQuery) {
          searchCount.textContent = "";
        } else if (!hasMatches) {
          searchCount.textContent = "0";
        } else {
          searchCount.textContent =
            String(currentIndexValue + 1) + "/" + String(totalMatches);
        }
      }
      if (searchPrev) searchPrev.disabled = !hasMatches;
      if (searchNext) searchNext.disabled = !hasMatches;
      if (searchReset) searchReset.disabled = !hasQuery;
    }

    function updateSearchScopeUI() {
      if (!searchScopeToggle || !searchScopeIcon || !searchInput) return;
      if (searchScope === "book") {
        searchScopeToggle.dataset.tooltip = "book";
        searchScopeToggle.setAttribute(
          "aria-label",
          "Switch to chapter search",
        );
        searchInput.placeholder = "Search book";
        searchInput.setAttribute("aria-label", "Search book");
        searchScopeIcon.innerHTML =
          '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
        return;
      }
      searchScopeToggle.dataset.tooltip = "chapter";
      searchScopeToggle.setAttribute("aria-label", "Switch to book search");
      searchInput.placeholder = "Search chapter";
      searchInput.setAttribute("aria-label", "Search chapter");
      searchScopeIcon.innerHTML =
        '<path d="M8 6h10"/><path d="M8 12h8"/><path d="M8 18h6"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>';
    }

    function persistSearchState() {
      sessionStorage.setItem("reader:search-scope:" + encodedPath, searchScope);
      if (!searchQuery) {
        sessionStorage.removeItem("reader:search-state:" + encodedPath);
        return;
      }
      sessionStorage.setItem(
        "reader:search-state:" + encodedPath,
        JSON.stringify({
          query: searchQuery,
          scope: searchScope,
          activeBookSearchIndex: activeBookSearchIndex,
        }),
      );
    }

    function loadPersistedSearchState() {
      try {
        var raw = sessionStorage.getItem("reader:search-state:" + encodedPath);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (!parsed || !parsed.query) return;
        searchQuery = parsed.query;
        searchScope = parsed.scope === "book" ? "book" : "chapter";
        activeBookSearchIndex =
          typeof parsed.activeBookSearchIndex === "number"
            ? parsed.activeBookSearchIndex
            : -1;
        if (searchInput) searchInput.value = searchQuery;
        if (searchQuery) openSearch(false);
      } catch (err) {}
    }

    function unwrapSearchMark(mark) {
      if (!mark || !mark.parentNode) return;
      var parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    }

    function clearSearchHighlights() {
      var doc = frame.contentDocument;
      if (!doc) return;
      Array.from(doc.querySelectorAll(".reader-search-mark")).forEach(
        unwrapSearchMark,
      );
      searchMatches = [];
      activeSearchIndex = -1;
      updateSearchUI();
    }

    function getReaderSearchPalette() {
      var pal =
        themePalettes[localStorage.getItem("reader:theme") || readerTheme] ||
        themePalettes["solarized-dark"];
      var pool = [];
      pal.fg.forEach(function (color) {
        if (color === fg) return;
        if (pal.bg.indexOf(color) >= 0) return;
        if (pool.indexOf(color) >= 0) return;
        pool.push(color);
      });
      return {
        match: pool[0] || "#ffb703",
        active: pool[1] || pool[0] || "#fb8500",
      };
    }

    function getSearchMarkStyles(active) {
      var palette = getReaderSearchPalette();
      return {
        backgroundColor: active ? palette.active : palette.match,
        color: fg,
      };
    }

    function applySearchMarkStyle(mark, active) {
      var styles = getSearchMarkStyles(active);
      mark.style.backgroundColor = styles.backgroundColor;
      mark.style.color = styles.color;
      mark.style.borderRadius = "2px";
    }

    function collectSearchTextNodes(doc) {
      var nodes = [];
      var walker = doc.createTreeWalker(
        doc.body || doc.documentElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function (node) {
            if (!node.nodeValue || !node.nodeValue.trim())
              return NodeFilter.FILTER_REJECT;
            if (!node.parentElement) return NodeFilter.FILTER_REJECT;
            if (
              node.parentElement.closest(
                "script, style, noscript, .reader-search-mark",
              )
            )
              return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );
      var current;
      while ((current = walker.nextNode())) {
        nodes.push(current);
      }
      return nodes;
    }

    function highlightTextNode(node, start, end) {
      var textNode = node;
      if (start > 0) {
        textNode = textNode.splitText(start);
      }
      if (end - start < textNode.nodeValue.length) {
        textNode.splitText(end - start);
      }
      var mark = document.createElement("mark");
      mark.className = "reader-search-mark";
      textNode.parentNode.insertBefore(mark, textNode);
      mark.appendChild(textNode);
      applySearchMarkStyle(mark, false);
      return mark;
    }

    function findSearchMatches(query) {
      var doc = frame.contentDocument;
      if (!doc) return [];
      var loweredQuery = query.toLocaleLowerCase();
      var matches = [];
      collectSearchTextNodes(doc).forEach(function (node) {
        var loweredText = node.nodeValue.toLocaleLowerCase();
        var ranges = [];
        var nodeMatches = [];
        var offset = 0;
        while (offset < loweredText.length) {
          var index = loweredText.indexOf(loweredQuery, offset);
          if (index === -1) break;
          ranges.push({ start: index, end: index + loweredQuery.length });
          offset = index + loweredQuery.length;
        }
        for (var i = ranges.length - 1; i >= 0; i--) {
          nodeMatches.push(
            highlightTextNode(node, ranges[i].start, ranges[i].end),
          );
        }
        nodeMatches.reverse();
        matches = matches.concat(nodeMatches);
      });
      return matches;
    }

    function setActiveSearchMatch(index) {
      if (!searchMatches.length) {
        activeSearchIndex = -1;
        updateSearchUI();
        return;
      }
      activeSearchIndex =
        ((index % searchMatches.length) + searchMatches.length) %
        searchMatches.length;
      searchMatches.forEach(function (match, idx) {
        match.classList.toggle("is-active", idx === activeSearchIndex);
        applySearchMarkStyle(match, idx === activeSearchIndex);
      });
      var activeMatch = searchMatches[activeSearchIndex];
      if (activeMatch && typeof activeMatch.scrollIntoView === "function") {
        activeMatch.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      updateSearchUI();
    }

    function setActiveBookSearchMatch(index) {
      if (!bookSearchMatches.length) {
        activeBookSearchIndex = -1;
        updateSearchUI();
        persistSearchState();
        return;
      }
      activeBookSearchIndex =
        ((index % bookSearchMatches.length) + bookSearchMatches.length) %
        bookSearchMatches.length;
      var activeMatch = bookSearchMatches[activeBookSearchIndex];
      persistSearchState();
      if (!activeMatch) {
        updateSearchUI();
        return;
      }
      if (activeMatch.chapter !== currentIndex) {
        goToChapterIndex(activeMatch.chapter);
        return;
      }
      runSearch(searchQuery);
      var matchIndexInChapter = 0;
      for (var i = 0; i < activeBookSearchIndex; i++) {
        if (bookSearchMatches[i].chapter === activeMatch.chapter)
          matchIndexInChapter++;
      }
      setActiveSearchMatch(matchIndexInChapter);
      updateSearchUI();
    }

    function runSearch(query) {
      searchQuery = query.trim();
      clearSearchHighlights();
      if (!searchQuery) {
        persistSearchState();
        updateSearchUI();
        return;
      }
      searchMatches = findSearchMatches(searchQuery);
      if (searchMatches.length > 0) {
        setActiveSearchMatch(0);
        persistSearchState();
        return;
      }
      persistSearchState();
      updateSearchUI();
    }

    function runBookSearch(query, noNavigate) {
      searchQuery = query.trim();
      clearSearchHighlights();
      bookSearchMatches = [];
      if (!searchQuery) {
        activeBookSearchIndex = -1;
        persistSearchState();
        updateSearchUI();
        return Promise.resolve();
      }
      return fetch(
        "/reader-search/" +
          encodedPath +
          "?q=" +
          encodeURIComponent(searchQuery),
      )
        .then(function (r) {
          if (!r.ok) {
            throw new Error(String(r.status));
          }
          return r.json();
        })
        .then(function (matches) {
          bookSearchMatches = Array.isArray(matches) ? matches : [];
          if (!bookSearchMatches.length) {
            activeBookSearchIndex = -1;
            persistSearchState();
            updateSearchUI();
            return;
          }
          if (
            activeBookSearchIndex < 0 ||
            activeBookSearchIndex >= bookSearchMatches.length
          ) {
            activeBookSearchIndex = 0;
          }
          if (noNavigate) {
            persistSearchState();
            runSearch(searchQuery);
            return;
          }
          setActiveBookSearchMatch(activeBookSearchIndex);
        })
        .catch(function () {
          bookSearchMatches = [];
          activeBookSearchIndex = -1;
          persistSearchState();
          updateSearchUI();
        });
    }

    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        closeMenu();
      }, 300);
    }

    function openMenu() {
      menuPanel.classList.add("open");
      pageTools.classList.add("open");
      menuToggle.classList.add("open");
      scheduleHide();
    }

    function closeMenu() {
      menuPanel.classList.remove("open");
      pageTools.classList.remove("open");
      clearTimeout(hideTimer);
      menuToggle.classList.remove("open");
      bubbles.forEach(function (bubble) {
        bubble.classList.remove("open");
      });
    }

    function queueOpenMenu() {
      clearTimeout(hideTimer);
      if (menuPanel.classList.contains("open")) return;
      openMenu();
    }

    function openSearch(shouldFocus) {
      if (!searchPanel || !searchTools) return;
      var wasOpen = searchPanel.classList.contains("open");
      searchPanel.classList.add("open");
      searchTools.classList.add("open");
      if (searchToggle) searchToggle.classList.add("open");
      if (shouldFocus && searchInput) searchInput.focus();
      if (!wasOpen && searchQuery && !searchMatches.length) {
        if (searchScope === "book") {
          runBookSearch(searchQuery, true);
        } else {
          runSearch(searchQuery);
        }
      }
    }

    function closeSearch() {
      if (!searchPanel || !searchTools) return;
      if (!searchPanel.classList.contains("open")) return;
      searchPanel.classList.remove("open");
      searchTools.classList.remove("open");
      if (searchToggle) searchToggle.classList.remove("open");
      clearSearchHighlights();
    }

    function queueOpenSearch() {
      if (searchPanel.classList.contains("open")) return;
      clearTimeout(searchOpenTimer);
      searchOpenTimer = setTimeout(function () {
        openSearch(false);
      }, 150);
    }

    function openBubble(targetBubble) {
      var current = targetBubble.querySelector(
        ".reader-current-swatch, .reader-current-line, .reader-current-size, #reader-font-current",
      );
      var menu = targetBubble.querySelector(".reader-bubble-menu");
      if (current && menu) {
        menu.style.left =
          String(current.offsetLeft + current.offsetWidth / 2) + "px";
      }
      bubbles.forEach(function (bubble) {
        bubble.classList.toggle("open", bubble === targetBubble);
      });
    }

    function closeBubble(targetBubble) {
      targetBubble.classList.remove("open");
    }

    function bindChoices(choices, key, setter) {
      choices.forEach(function (choice) {
        var saved;
        var previewing = false;
        choice.addEventListener("mousedown", function (event) {
          event.stopPropagation();
        });
        choice.addEventListener("pointerdown", function (event) {
          event.preventDefault();
          event.stopPropagation();
          previewing = false;
          saved = choice.dataset[key];
          choices.forEach(function (item) {
            item.classList.remove("reader-choice-active");
          });
          choice.classList.add("reader-choice-active");
          setter(choice.dataset[key]);
          localStorage.setItem("reader:" + key, choice.dataset[key]);
          applyTheme();
          scheduleHide();
        });
        choice.addEventListener("mouseenter", function () {
          saved = key === "bg" ? bg : fg;
          previewing = true;
          setter(choice.dataset[key]);
          applyTheme();
        });
        choice.addEventListener("mouseleave", function () {
          if (!previewing) return;
          setter(saved);
          applyTheme();
          previewing = false;
        });
      });
    }

    function bindFrameClose() {
      if (frameCloseBound) return;
      var doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("mousedown", function () {
        closeMenu();
        closeSearch();
      });
      frameCloseBound = true;
    }

    function clearNavHover() {
      if (!frameStage) return;
      frameStage.classList.remove("nav-hover-prev", "nav-hover-next");
    }

    function updateNavHover(clientX, clientY, width, height) {
      if (!frameStage) return;
      var inBottomBand = clientY >= height - Math.min(160, height * 0.3);
      var edgeWidth = Math.min(180, Math.max(72, width * 0.24));
      var showPrev =
        inBottomBand && clientX <= edgeWidth && Boolean(prevChapter);
      var showNext =
        inBottomBand && clientX >= width - edgeWidth && Boolean(nextChapter);
      frameStage.classList.toggle("nav-hover-prev", showPrev);
      frameStage.classList.toggle("nav-hover-next", showNext);
    }

    function bindFrameNavHover() {
      var doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener(
        "mousemove",
        function (event) {
          var win = doc.defaultView;
          var width =
            (win && win.innerWidth) || doc.documentElement.clientWidth || 0;
          var height =
            (win && win.innerHeight) || doc.documentElement.clientHeight || 0;
          updateNavHover(event.clientX, event.clientY, width, height);
        },
        { passive: true },
      );
      doc.addEventListener("mouseleave", clearNavHover);
    }

    function updateReaderProgress() {
      if (!chapterProgressFill || !bookProgressFill) return;
      if (chapterCount <= 0) {
        chapterProgressFill.style.width = "0%";
        bookProgressFill.style.width = "0%";
        return;
      }
      var doc = frame.contentDocument;
      if (!doc) {
        chapterProgressFill.style.width = "0%";
        bookProgressFill.style.width =
          String(((currentIndex + 1) / chapterCount) * 100) + "%";
        return;
      }
      var win = doc.defaultView;
      var docEl = doc.documentElement;
      var bodyEl = doc.body;
      var scrollTop =
        (win && (win.scrollY || win.pageYOffset)) ||
        (docEl && docEl.scrollTop) ||
        (bodyEl && bodyEl.scrollTop) ||
        0;
      var clientHeight =
        (win && win.innerHeight) ||
        (docEl && docEl.clientHeight) ||
        (bodyEl && bodyEl.clientHeight) ||
        0;
      var scrollHeight = Math.max(
        (docEl && docEl.scrollHeight) || 0,
        (bodyEl && bodyEl.scrollHeight) || 0,
        (doc.scrollingElement && doc.scrollingElement.scrollHeight) || 0,
      );
      var scrollable = Math.max(scrollHeight - clientHeight, 0);
      var chapterFraction =
        scrollable > 0 ? Math.min(Math.max(scrollTop / scrollable, 0), 1) : 1;
      var chapterProgress = chapterFraction * 100;
      var bookProgress =
        ((currentIndex + chapterFraction) / chapterCount) * 100;
      chapterProgressFill.style.width =
        String(Math.min(Math.max(chapterProgress, 0), 100)) + "%";
      bookProgressFill.style.width =
        String(Math.min(Math.max(bookProgress, 0), 100)) + "%";
    }

    function bindFrameScroll() {
      if (frameScrollBound) return;
      var doc = frame.contentDocument;
      if (!doc) return;
      var win = doc.defaultView;
      var docEl = doc.documentElement;
      var bodyEl = doc.body;
      if (!win || !docEl) return;
      win.addEventListener("scroll", updateReaderProgress, { passive: true });
      win.addEventListener("resize", updateReaderProgress);
      doc.addEventListener("scroll", updateReaderProgress, { passive: true });
      docEl.addEventListener("scroll", updateReaderProgress, { passive: true });
      if (bodyEl)
        bodyEl.addEventListener("scroll", updateReaderProgress, {
          passive: true,
        });
      frameScrollBound = true;
      updateReaderProgress();
    }

    function setupFrame() {
      var doc = frame.contentDocument;
      if (!doc || frameSetupDoc === doc) return;
      frameSetupDoc = doc;
      frameCloseBound = false;
      frameScrollBound = false;
      applyTheme();
      var scrollbarWidth =
        frame.contentWindow.innerWidth -
        frame.contentDocument.documentElement.clientWidth;
      document.documentElement.style.setProperty(
        "--frame-scrollbar-width",
        scrollbarWidth + "px",
      );
      bindFrameClose();
      bindFrameNavHover();
      bindFrameScroll();
      bindFrameShortcuts();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (searchScope === "book" && searchQuery) {
            runBookSearch(searchQuery);
          } else {
            runSearch(searchQuery);
          }
          updateReaderProgress();
        });
      });
      setTimeout(updateReaderProgress, 150);
    }

    function bindSlider(
      slider,
      initialValue,
      updateValue,
      storageKey,
      getStoredValue,
    ) {
      slider.value = initialValue;
      slider.addEventListener("mousedown", function (event) {
        event.stopPropagation();
      });
      slider.addEventListener("input", function () {
        updateValue(slider.value);
        applyTheme();
      });
      slider.addEventListener("change", function () {
        localStorage.setItem(storageKey, getStoredValue());
        scheduleHide();
      });
    }

    function bindFontChoices() {
      var choices = Array.from(
        fontMenu.querySelectorAll(".reader-font-choice"),
      );
      choices.forEach(function (choice) {
        var saved;
        var previewing = false;
        choice.addEventListener("mousedown", function (event) {
          event.stopPropagation();
        });
        choice.addEventListener("pointerdown", function (event) {
          event.preventDefault();
          event.stopPropagation();
          previewing = false;
          saved = choice.dataset.font;
          choices.forEach(function (c) {
            c.classList.remove("reader-choice-active");
          });
          choice.classList.add("reader-choice-active");
          fontFamily = choice.dataset.font;
          localStorage.setItem("reader:font", fontFamily);
          applyTheme();
          closeBubble(fontMenu.closest(".reader-control-bubble"));
          scheduleHide();
        });
        choice.addEventListener("mouseenter", function () {
          saved = fontFamily;
          previewing = true;
          fontFamily = choice.dataset.font;
          applyTheme();
        });
        choice.addEventListener("mouseleave", function () {
          if (!previewing) return;
          fontFamily = saved;
          applyTheme();
          previewing = false;
        });
      });
    }

    bindChoices(bgChoices, "bg", function (value) {
      bg = value;
    });
    bindChoices(fgChoices, "fg", function (value) {
      fg = value;
    });
    bindSlider(
      lhSlider,
      lh,
      function (value) {
        lh = value;
      },
      "reader:lh",
      function () {
        return lh;
      },
    );
    bindSlider(
      sizeSlider,
      size.replace("px", ""),
      function (value) {
        size = value + "px";
      },
      "reader:size",
      function () {
        return size;
      },
    );
    bindSlider(
      padSlider,
      padX.replace("px", ""),
      function (value) {
        padX = value + "px";
      },
      "reader:px",
      function () {
        return padX;
      },
    );

    fetch("/api/fonts")
      .then(function (r) {
        return r.json();
      })
      .then(function (fonts) {
        fonts.forEach(function (f) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "reader-font-choice";
          btn.dataset.font = f;
          btn.textContent = f;
          btn.style.fontFamily = "'" + f + "'";
          fontMenu.appendChild(btn);
        });
        fontMenu.querySelectorAll(".reader-font-choice").forEach(function (c) {
          c.classList.toggle(
            "reader-choice-active",
            c.dataset.font === fontFamily,
          );
        });
        bindFontChoices();
      });

    controlGroups.forEach(function (group) {
      var bubble = group.querySelector(".reader-control-bubble");
      if (!bubble) return;
      group.addEventListener("mousedown", function (event) {
        event.stopPropagation();
      });
      group.addEventListener("click", function (event) {
        event.stopPropagation();
        clearTimeout(hideTimer);
        if (!menuPanel.classList.contains("open")) openMenu();
        openBubble(bubble);
      });
      group.addEventListener("mouseenter", function () {
        clearTimeout(hideTimer);
        openBubble(bubble);
      });
      group.addEventListener("mouseleave", function () {
        closeBubble(bubble);
        if (menuPanel.classList.contains("open")) scheduleHide();
      });
    });

    menuToggle.addEventListener("mouseenter", queueOpenMenu);
    menuToggle.addEventListener("click", function () {
      if (menuPanel.classList.contains("open")) {
        closeMenu();
        return;
      }
      queueOpenMenu();
    });
    pageTools.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });
    menuPanel.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });
    pageTools.addEventListener("mouseenter", function () {
      clearTimeout(hideTimer);
      if (!menuPanel.classList.contains("open")) queueOpenMenu();
    });
    pageTools.addEventListener("mouseleave", function () {
      if (menuPanel.classList.contains("open")) scheduleHide();
    });
    menuPanel.addEventListener("click", scheduleHide);
    menuPanel.addEventListener("focusin", function () {
      if (menuPanel.classList.contains("open")) clearTimeout(hideTimer);
    });
    menuPanel.addEventListener("focusout", function () {
      if (menuPanel.classList.contains("open")) scheduleHide();
    });
    document.addEventListener("mousedown", function (event) {
      if (!pageTools.contains(event.target)) {
        closeMenu();
      }
    });
    if (searchTools) {
      searchTools.addEventListener("mousedown", function (event) {
        event.stopPropagation();
      });
    }
    if (searchToggle) {
      searchToggle.addEventListener("mouseenter", function () {
        clearTimeout(searchHideTimer);
        if (!searchPanel.classList.contains("open")) queueOpenSearch();
      });
      searchToggle.addEventListener("mouseleave", function () {
        clearTimeout(searchOpenTimer);
        searchHideTimer = setTimeout(function () {
          searchPanel.classList.remove("open");
          searchTools.classList.remove("open");
          searchToggle.classList.remove("open");
        }, 300);
      });
    }
    if (searchPanel) {
      searchPanel.addEventListener("mousedown", function (event) {
        event.stopPropagation();
      });
      searchPanel.addEventListener("mouseenter", function () {
        clearTimeout(searchHideTimer);
      });
      searchPanel.addEventListener("mouseleave", function () {
        searchHideTimer = setTimeout(function () {
          searchPanel.classList.remove("open");
          searchTools.classList.remove("open");
          searchToggle.classList.remove("open");
        }, 300);
      });
    }
    document.addEventListener("mousedown", function (event) {
      if (searchTools && !searchTools.contains(event.target)) {
        closeSearch();
      }
    });

    if (toc) {
      var tocKey = "reader:toc:" + window.location.pathname;
      var savedTop = localStorage.getItem(tocKey);
      if (savedTop) toc.scrollTop = Number(savedTop);
      toc.addEventListener("scroll", function () {
        localStorage.setItem(tocKey, String(toc.scrollTop));
      });
    }

    applySwatchPalette(readerTheme);
    loadPersistedSearchState();
    updateSearchScopeUI();
    if (searchForm) {
      searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (searchScope === "book") {
          if (bookSearchMatches.length > 0) {
            setActiveBookSearchMatch(activeBookSearchIndex + 1);
            return;
          }
          runBookSearch(searchInput.value);
          return;
        }
        if (searchMatches.length > 0) {
          setActiveSearchMatch(activeSearchIndex + 1);
          return;
        }
        runSearch(searchInput.value);
      });
    }
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        openSearch(false);
        if (searchScope === "book") {
          activeBookSearchIndex = 0;
          runBookSearch(searchInput.value, true);
          return;
        }
        runSearch(searchInput.value);
      });
      searchInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          if (searchScope === "book") {
            if (event.shiftKey) {
              setActiveBookSearchMatch(activeBookSearchIndex - 1);
              return;
            }
            setActiveBookSearchMatch(activeBookSearchIndex + 1);
            return;
          }
          if (event.shiftKey) {
            setActiveSearchMatch(activeSearchIndex - 1);
            return;
          }
          setActiveSearchMatch(activeSearchIndex + 1);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          searchInput.value = "";
          if (searchScope === "book") {
            bookSearchMatches = [];
            activeBookSearchIndex = -1;
            runBookSearch("");
            return;
          }
          runSearch("");
          closeSearch();
        }
      });
    }
    if (searchScopeToggle) {
      searchScopeToggle.addEventListener("click", function () {
        searchScope = searchScope === "book" ? "chapter" : "book";
        sessionStorage.setItem(
          "reader:search-scope:" + encodedPath,
          searchScope,
        );
        updateSearchScopeUI();
        if (!searchQuery) {
          bookSearchMatches = [];
          activeBookSearchIndex = -1;
          persistSearchState();
          updateSearchUI();
          return;
        }
        if (searchScope === "book") {
          activeBookSearchIndex = 0;
          runBookSearch(searchQuery);
          return;
        }
        bookSearchMatches = [];
        activeBookSearchIndex = -1;
        runSearch(searchQuery);
      });
    }
    if (searchPrev) {
      searchPrev.addEventListener("click", function () {
        openSearch(false);
        if (searchScope === "book") {
          setActiveBookSearchMatch(activeBookSearchIndex - 1);
          return;
        }
        setActiveSearchMatch(activeSearchIndex - 1);
      });
    }
    if (searchNext) {
      searchNext.addEventListener("click", function () {
        openSearch(false);
        if (searchScope === "book") {
          setActiveBookSearchMatch(activeBookSearchIndex + 1);
          return;
        }
        setActiveSearchMatch(activeSearchIndex + 1);
      });
    }
    if (searchReset) {
      searchReset.addEventListener("click", function () {
        if (searchInput) searchInput.value = "";
        if (searchScope === "book") {
          bookSearchMatches = [];
          activeBookSearchIndex = -1;
          runBookSearch("");
        } else {
          runSearch("");
        }
        if (searchInput) searchInput.focus();
      });
    }
    if (searchClear) {
      searchClear.addEventListener("click", function () {
        closeSearch();
      });
    }
    updateSearchUI();
    frame.addEventListener("load", setupFrame);
    initSidebarResize();
    bindReaderShortcuts();
    bindChapterLinks();
    applyTheme();
    setupFrame();
    updateReaderProgress();

    document
      .querySelectorAll(".reader-toc .group-section")
      .forEach(function (section) {
        var hoverTimer = null;
        section
          .querySelector(".group-header")
          .addEventListener("click", function (e) {
            if (!e.target.closest("a")) {
              section.classList.toggle("open");
            }
          });
        section.addEventListener("mouseenter", function () {
          hoverTimer = setTimeout(function () {
            section.classList.add("hover-open");
          }, 500);
        });
        section.addEventListener("mouseleave", function () {
          clearTimeout(hoverTimer);
          section.classList.remove("hover-open");
        });
      });

    localStorage.setItem(
      "lastRead",
      JSON.stringify({
        path: encodedPath,
        chapter: currentIndex,
        title: readerTitle,
      }),
    );
    window.openPreferences = function () {
      window.location.href = "/?openPrefs=1";
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
