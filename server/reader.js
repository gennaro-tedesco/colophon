(function () {
  var READER_I18N = {
    en: {
      collapseSidebar: "Collapse sidebar",
      expandSidebar: "Expand sidebar",
      searchChapter: "Search chapter",
      searchBook: "Search book",
      switchToBook: "Switch to book search",
      switchToChapter: "Switch to chapter search",
      tooltipChapter: "chapter",
      tooltipBook: "book",
      tooltipLibrary: "library",
    },
    de: {
      collapseSidebar: "Seitenleiste einblenden",
      expandSidebar: "Seitenleiste ausblenden",
      searchChapter: "Kapitel durchsuchen",
      searchBook: "Buch durchsuchen",
      switchToBook: "Zur Buchsuche wechseln",
      switchToChapter: "Zur Kapitelsuche wechseln",
      tooltipChapter: "Kapitel",
      tooltipBook: "Buch",
      tooltipLibrary: "Bibliothek",
    },
    it: {
      collapseSidebar: "Comprimi barra laterale",
      expandSidebar: "Espandi barra laterale",
      searchChapter: "Cerca nel capitolo",
      searchBook: "Cerca nel libro",
      switchToBook: "Passa alla ricerca nel libro",
      switchToChapter: "Passa alla ricerca nel capitolo",
      tooltipChapter: "capitolo",
      tooltipBook: "libro",
      tooltipLibrary: "libreria",
    },
    zh: {
      collapseSidebar: "\u6536\u8d77\u4fa7\u8fb9\u680f",
      expandSidebar: "\u5c55\u5f00\u4fa7\u8fb9\u680f",
      searchChapter: "\u641c\u7d22\u7ae0\u8282",
      searchBook: "\u641c\u7d22\u4e66\u7c4d",
      switchToBook: "\u5207\u6362\u5230\u4e66\u7c4d\u641c\u7d22",
      switchToChapter: "\u5207\u6362\u5230\u7ae0\u8282\u641c\u7d22",
      tooltipChapter: "\u7ae0\u8282",
      tooltipBook: "\u4e66\u7c4d",
      tooltipLibrary: "\u4e66\u5e93",
    },
  };
  var readerLang =
    (typeof localStorage !== "undefined" &&
      localStorage.getItem(Settings.languageKey)) ||
    Settings.defaultLanguage;
  var rt = function (key) {
    var dict = READER_I18N[readerLang] || READER_I18N[Settings.defaultLanguage];
    return dict[key] || READER_I18N[Settings.defaultLanguage][key] || key;
  };

  var onConfigApplied = null;

  function applyConfig(cfg) {
    var root = document.documentElement;
    root.setAttribute("data-theme", cfg.theme || Settings.defaultTheme);
    if (cfg.uiFontSize > 0) {
      applyFontScale(cfg.uiFontSize);
    }
    if (cfg.uiFontFamily) {
      applyFontFamily(cfg.uiFontFamily);
    }
    if (onConfigApplied) onConfigApplied();
  }

  fetch(Settings.routes.config)
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
    var readerTheme = body.dataset.readerTheme || Settings.defaultTheme;
    if (readerTheme)
      document.documentElement.setAttribute("data-theme", readerTheme);
    var readerTitle = body.dataset.readerTitle || "";
    var frameStage = document.querySelector(".reader-frame-stage");
    var prevChapter = document.getElementById("reader-prev-chapter");
    var frame = document.getElementById("reader-frame");
    var frameBack = document.getElementById("reader-frame-buffer");
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
    var chapterHeading = document.querySelector(".reader-toolbar-chapter");
    var progressBadge = document.querySelector(".reader-progress-badge");
    var chapterMeta = [];
    var chapterMetaNode = document.getElementById("reader-chapters");
    if (chapterMetaNode) {
      try {
        chapterMeta = JSON.parse(chapterMetaNode.textContent) || [];
      } catch (err) {
        chapterMeta = [];
      }
    }
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
    configureRange(lhSlider, Settings.readerLineHeightRange);
    configureRange(sizeSlider, Settings.readerFontRange);
    configureRange(padSlider, Settings.readerPaddingRange);
    var bubbles = Array.from(
      document.querySelectorAll(".reader-control-bubble"),
    );
    var controlGroups = Array.from(
      document.querySelectorAll(".reader-control-group"),
    );

    if (searchInput) {
      searchInput.placeholder = rt("searchChapter");
      searchInput.setAttribute("aria-label", rt("searchChapter"));
    }
    if (searchScopeToggle) {
      searchScopeToggle.dataset.tooltip = rt("tooltipChapter");
      searchScopeToggle.setAttribute("aria-label", rt("switchToBook"));
    }
    var libraryAction = document.querySelector(".reader-library-action");
    if (libraryAction) {
      libraryAction.setAttribute("aria-label", rt("tooltipLibrary"));
      libraryAction.dataset.tooltip = rt("tooltipLibrary");
      libraryAction.addEventListener("click", function () {
        if (
          window.parent !== window &&
          typeof window.parent.closeReader === "function"
        ) {
          window.parent.closeReader();
          return;
        }
        window.location.href = "/";
      });
    }
    if (sidebarToggle) {
      sidebarToggle.setAttribute("aria-label", rt("collapseSidebar"));
    }
    function readerPalette() {
      return {
        bg: settingValue("--reader-backgrounds").split(/\s*,\s*/),
        fg: settingValue("--reader-foregrounds").split(/\s*,\s*/),
      };
    }
    var bg = readerPreference("bg");
    var fg = readerPreference("fg");
    var lh = readerPreference("lh");
    var size = readerPreference("size");
    var padX = readerPreference("px");
    var pendingG = false;
    var pendingGTimer = null;
    var searchQuery = "";
    var searchScope =
      sessionStorage.getItem(
        readerStorageKey(Settings.readerSearchScopeSuffix) + encodedPath,
      ) || "chapter";
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
    var progressFrame = 0;
    var themeFrame = 0;
    var prevIndex = -1;
    var nextIndex = -1;
    var pendingChapter = -1;
    var bufferReady = false;
    var pendingNavigation = null;
    var SIDEBAR_WIDTH_KEY = Settings.sidebarWidthKey;
    var SIDEBAR_LAST_KEY = Settings.sidebarLastKey;
    var SIDEBAR_MIN = parseFloat(settingValue("--sidebar-width-min"));
    var SIDEBAR_MAX = parseFloat(settingValue("--sidebar-width-max"));
    var SIDEBAR_COLLAPSED = parseFloat(
      settingValue("--sidebar-width-collapsed"),
    );
    var SIDEBAR_DEFAULT = parseFloat(settingValue("--sidebar-width-default"));
    var NAV_EDGE_MAX = parseFloat(settingValue("--reader-nav-edge-max"));
    var NAV_EDGE_MIN = parseFloat(settingValue("--reader-nav-edge-min"));
    var NAV_EDGE_RATIO = parseFloat(settingValue("--reader-nav-edge-ratio"));

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
          width === SIDEBAR_COLLAPSED
            ? rt("expandSidebar")
            : rt("collapseSidebar"),
        );
      }
    }

    function initSidebarResize() {
      var saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
      if (saved > 0) applySidebarWidth(saved);
      if (!sidebarResizer || settingValue("--sidebar-resize-enabled") === "0")
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
              parseInt(localStorage.getItem(SIDEBAR_LAST_KEY) || "", 10) ||
              SIDEBAR_DEFAULT;
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
          ) || SIDEBAR_DEFAULT;
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
    ) {
      var doc = frame.contentDocument;
      if (!doc) return;
      var shellStyles = getComputedStyle(document.documentElement);
      var fontFamily = shellStyles.getPropertyValue("--font-sans").trim();
      Settings.readerStaticProperties.forEach(function (name) {
        doc.documentElement.style.setProperty(
          name,
          shellStyles.getPropertyValue(name).trim(),
        );
      });
      doc.documentElement.style.setProperty("--reader-bg", activeBg);
      doc.documentElement.style.setProperty("--reader-fg", activeFg);
      doc.documentElement.style.setProperty("--reader-pad-x", activePadX);
      doc.documentElement.style.backgroundColor = activeBg;
      doc.documentElement.style.color = activeFg;
      doc.documentElement.style.lineHeight = activeLh;
      doc.documentElement.style.fontSize = activeSize;
      doc.documentElement.style.fontFamily = fontFamily;
      if (doc.body) {
        doc.body.style.backgroundColor = activeBg;
        doc.body.style.color = activeFg;
        doc.body.style.lineHeight = activeLh;
        doc.body.style.fontSize = activeSize;
        doc.body.style.paddingLeft = activePadX;
        doc.body.style.paddingRight = activePadX;
        doc.body.style.fontFamily = fontFamily;
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

    function requestApplyTheme() {
      if (themeFrame) return;
      themeFrame = requestAnimationFrame(function () {
        themeFrame = 0;
        applyTheme();
      });
    }

    function applyTheme() {
      applyThemeToFrame(bg, fg, lh, size, padX);
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
      var palette = getReaderSearchPalette();
      var radius = settingValue("--reader-search-radius");
      searchMatches.forEach(function (match, idx) {
        applySearchMarkStyle(match, idx === activeSearchIndex, palette, radius);
      });
    }

    function applySwatchPalette(theme) {
      var pal = readerPalette();
      bgChoices.forEach(function (btn, i) {
        btn.dataset.bg = pal.bg[i];
        btn.style.background = pal.bg[i];
      });
      fgChoices.forEach(function (btn, i) {
        btn.dataset.fg = pal.fg[i];
        btn.style.background = pal.fg[i];
      });
      if (localStorage.getItem(readerStorageKey("theme")) !== theme) {
        bg = pal.bg[0];
        fg = pal.fg[0];
        localStorage.setItem(readerStorageKey("bg"), bg);
        localStorage.setItem(readerStorageKey("fg"), fg);
        localStorage.setItem(readerStorageKey("theme"), theme);
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

    function chapterShellURL(index, fragment) {
      var url =
        Settings.routes.read + encodedPath + "?chapter=" + String(index);
      if (fragment) url += "&frag=" + encodeURIComponent(fragment);
      return url;
    }

    function chapterDocURL(index, fragment) {
      var url =
        Settings.routes.read +
        encodedPath +
        "/chapter?chapter=" +
        String(index);
      if (fragment) url += "#" + encodeURIComponent(fragment);
      return url;
    }

    function chapterRequest(href) {
      try {
        var url = new URL(href, window.location.href);
        if (decodeURI(url.pathname) !== decodeURI(window.location.pathname))
          return null;
        var chapter = parseInt(url.searchParams.get("chapter") || "", 10);
        if (!Number.isFinite(chapter)) return null;
        return {
          index: chapter,
          fragment: url.searchParams.get("frag") || "",
        };
      } catch (err) {
        return null;
      }
    }

    function goToChapter(index) {
      showChapter(index, "", true);
    }

    function markActiveTOC(index) {
      if (!toc) return;
      toc.querySelectorAll("a[data-toc-chapter]").forEach(function (link) {
        link.classList.toggle(
          "active",
          Number(link.dataset.tocChapter) === index,
        );
      });
      var active = toc.querySelector("a[data-toc-chapter].active");
      var section = active ? active.closest(".group-section") : null;
      while (section) {
        section.classList.add("open");
        section = section.parentNode
          ? section.parentNode.closest(".group-section")
          : null;
      }
    }

    function updateChapterLinks(index) {
      var meta = chapterMeta[index];
      if (!meta) return;
      prevIndex = meta.prev;
      nextIndex = meta.next;
      if (prevChapter) {
        prevChapter.href =
          prevIndex >= 0 ? chapterShellURL(prevIndex, "") : "#";
        prevChapter.parentNode.hidden = prevIndex < 0;
      }
      if (nextChapter) {
        nextChapter.href =
          nextIndex >= 0 ? chapterShellURL(nextIndex, "") : "#";
        nextChapter.parentNode.hidden = nextIndex < 0;
      }
    }

    function chapterIndexFromURL(href) {
      try {
        var chapter = parseInt(
          new URL(href, window.location.href).searchParams.get("chapter") || "",
          10,
        );
        return Number.isFinite(chapter) ? chapter : -1;
      } catch (err) {
        return -1;
      }
    }

    function commitFrame(index) {
      var incoming = frameBack;
      var doc = incoming.contentDocument;
      if (!doc || chapterIndexFromURL(doc.URL) !== index) return false;
      var outgoing = frame;
      var focusWasInFrame =
        outgoing.contentDocument && outgoing.contentDocument.hasFocus();
      var meta = chapterMeta[index];
      frame = incoming;
      frameBack = outgoing;
      if (meta) incoming.setAttribute("title", meta.title);
      setupFrame();
      incoming.removeAttribute("tabindex");
      outgoing.setAttribute("tabindex", "-1");
      incoming.classList.remove("reader-frame-buffer");
      outgoing.classList.add("reader-frame-buffer");
      if (focusWasInFrame) incoming.contentWindow.focus();
      return true;
    }

    function onFrameLoad(event) {
      if (event.currentTarget === frameBack) {
        if (!bufferReady) {
          bufferReady = true;
          if (pendingNavigation) {
            var navigation = pendingNavigation;
            pendingNavigation = null;
            showChapter(navigation.index, navigation.fragment, navigation.push);
          }
          return;
        }
        if (pendingChapter < 0) return;
        if (commitFrame(pendingChapter)) pendingChapter = -1;
        return;
      }
      setupFrame();
    }

    function showChapter(index, fragment, push) {
      var meta = chapterMeta[index];
      if (!meta) return;
      if (!bufferReady) {
        pendingNavigation = { index: index, fragment: fragment, push: push };
        return;
      }
      currentIndex = index;
      pendingChapter = index;
      clearNavHover();
      var src = chapterDocURL(index, fragment);
      if (
        frameBack.contentDocument &&
        frameBack.contentDocument.URL ===
          new URL(src, window.location.href).href
      ) {
        frameBack.contentWindow.location.reload();
      } else {
        frameBack.src = src;
      }
      if (chapterHeading) chapterHeading.textContent = meta.title;
      if (progressBadge) {
        progressBadge.textContent =
          String(index + 1) + " / " + String(chapterCount);
      }
      updateChapterLinks(index);
      markActiveTOC(index);
      localStorage.setItem(
        Settings.lastReadKey,
        JSON.stringify({
          path: encodedPath,
          chapter: index,
          title: readerTitle,
        }),
      );
      if (push) {
        history.pushState(
          { chapter: index, frag: fragment || "" },
          "",
          chapterShellURL(index, fragment),
        );
      }
    }

    function bindShellChapterLinks() {
      document.addEventListener("click", function (event) {
        var link = event.target.closest("a[href]");
        if (!link || !link.closest("#reader-toc, .reader-nav-zone")) return;
        var target = chapterRequest(link.href);
        var wasDefaultPrevented = event.defaultPrevented;
        var hasChapterMetadata = Boolean(target && chapterMeta[target.index]);
        var shouldIntercept =
          !wasDefaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          target &&
          hasChapterMetadata;
        if (shouldIntercept) event.preventDefault();
        if (!shouldIntercept) return;
        showChapter(target.index, target.fragment, true);
      });
    }

    function bindFrameChapterLinks() {
      var doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        var link = event.target.closest("a[href]");
        if (!link) return;
        var target = chapterRequest(link.href);
        if (!target || !chapterMeta[target.index]) return;
        event.preventDefault();
        showChapter(target.index, target.fragment, true);
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
      }, Settings.shortcutSequenceDelay);
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
          goToChapter(0);
          return;
        }
        armPendingG();
        return;
      }
      if (event.key === "G") {
        event.preventDefault();
        clearPendingG();
        goToChapter(chapterCount - 1);
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
          scrollReaderBy(Settings.readerScrollStep);
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          scrollReaderBy(-Settings.readerScrollStep);
          break;
        case "ArrowRight":
        case "l":
          event.preventDefault();
          goToChapter(nextIndex);
          break;
        case "ArrowLeft":
        case "h":
          event.preventDefault();
          goToChapter(prevIndex);
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
        searchScopeToggle.dataset.tooltip = rt("tooltipBook");
        searchScopeToggle.setAttribute("aria-label", rt("switchToChapter"));
        searchInput.placeholder = rt("searchBook");
        searchInput.setAttribute("aria-label", rt("searchBook"));
        searchScopeIcon.innerHTML =
          '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
        return;
      }
      searchScopeToggle.dataset.tooltip = rt("tooltipChapter");
      searchScopeToggle.setAttribute("aria-label", rt("switchToBook"));
      searchInput.placeholder = rt("searchChapter");
      searchInput.setAttribute("aria-label", rt("searchChapter"));
      searchScopeIcon.innerHTML =
        '<path d="M8 6h10"/><path d="M8 12h8"/><path d="M8 18h6"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>';
    }

    function persistSearchState() {
      sessionStorage.setItem(
        readerStorageKey(Settings.readerSearchScopeSuffix) + encodedPath,
        searchScope,
      );
      if (!searchQuery) {
        sessionStorage.removeItem(
          readerStorageKey(Settings.readerSearchStateSuffix) + encodedPath,
        );
        return;
      }
      sessionStorage.setItem(
        readerStorageKey(Settings.readerSearchStateSuffix) + encodedPath,
        JSON.stringify({
          query: searchQuery,
          scope: searchScope,
          activeBookSearchIndex: activeBookSearchIndex,
        }),
      );
    }

    function loadPersistedSearchState() {
      try {
        var raw = sessionStorage.getItem(
          readerStorageKey(Settings.readerSearchStateSuffix) + encodedPath,
        );
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
      var pal = readerPalette();
      var pool = [];
      pal.fg.forEach(function (color) {
        if (color === fg) return;
        if (pal.bg.indexOf(color) >= 0) return;
        if (pool.indexOf(color) >= 0) return;
        pool.push(color);
      });
      return {
        match: pool[0] || settingValue("--reader-search-mark"),
        active:
          pool[1] || pool[0] || settingValue("--reader-search-mark-active"),
      };
    }

    function applySearchMarkStyle(mark, active, palette, radius) {
      var colors = palette || getReaderSearchPalette();
      mark.style.backgroundColor = active ? colors.active : colors.match;
      mark.style.color = fg;
      mark.style.borderRadius =
        radius || settingValue("--reader-search-radius");
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

    function highlightTextNode(node, start, end, palette, radius) {
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
      applySearchMarkStyle(mark, false, palette, radius);
      return mark;
    }

    function findSearchMatches(query) {
      var doc = frame.contentDocument;
      if (!doc) return [];
      var loweredQuery = query.toLocaleLowerCase();
      var matches = [];
      var palette = getReaderSearchPalette();
      var radius = settingValue("--reader-search-radius");
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
            highlightTextNode(
              node,
              ranges[i].start,
              ranges[i].end,
              palette,
              radius,
            ),
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
      var palette = getReaderSearchPalette();
      var radius = settingValue("--reader-search-radius");
      searchMatches.forEach(function (match, idx) {
        var active = idx === activeSearchIndex;
        match.classList.toggle("is-active", active);
        applySearchMarkStyle(match, active, palette, radius);
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
        goToChapter(activeMatch.chapter);
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
        Settings.routes.search +
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
      }, Settings.menuHideDelay);
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
      }, Settings.searchOpenDelay);
    }

    function openBubble(targetBubble) {
      var current = targetBubble.querySelector(
        ".reader-current-swatch, .reader-current-line, .reader-current-size",
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
          localStorage.setItem(readerStorageKey(key), choice.dataset[key]);
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
      var inBottomBand =
        clientY >=
        height -
          Math.min(
            Settings.readerNavBandMax,
            height * Settings.readerNavBandRatio,
          );
      var edgeWidth = Math.min(
        NAV_EDGE_MAX,
        Math.max(NAV_EDGE_MIN, width * NAV_EDGE_RATIO),
      );
      var showPrev = inBottomBand && clientX <= edgeWidth && prevIndex >= 0;
      var showNext =
        inBottomBand && clientX >= width - edgeWidth && nextIndex >= 0;
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

    function scheduleReaderProgress() {
      if (progressFrame) return;
      progressFrame = requestAnimationFrame(function () {
        progressFrame = 0;
        updateReaderProgress();
      });
    }

    function bindFrameScroll() {
      if (frameScrollBound) return;
      var doc = frame.contentDocument;
      if (!doc) return;
      var win = doc.defaultView;
      if (!win) return;
      win.addEventListener("scroll", scheduleReaderProgress, {
        passive: true,
        capture: true,
      });
      win.addEventListener("resize", updateReaderProgress);
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
      bindFrameChapterLinks();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!searchQuery) {
            searchMatches = [];
            activeSearchIndex = -1;
            return;
          }
          if (searchScope === "book") {
            runBookSearch(searchQuery);
          } else {
            runSearch(searchQuery);
          }
        });
      });
      setTimeout(updateReaderProgress, Settings.readerProgressDelay);
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
        requestApplyTheme();
      });
      slider.addEventListener("change", function () {
        localStorage.setItem(storageKey, getStoredValue());
        scheduleHide();
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
      readerStorageKey("lh"),
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
      readerStorageKey("size"),
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
      readerStorageKey("px"),
      function () {
        return padX;
      },
    );

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
        }, Settings.menuHideDelay);
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
        }, Settings.menuHideDelay);
      });
    }
    document.addEventListener("mousedown", function (event) {
      if (searchTools && !searchTools.contains(event.target)) {
        closeSearch();
      }
    });

    if (toc) {
      var tocKey =
        readerStorageKey(Settings.readerTocSuffix) + window.location.pathname;
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
          readerStorageKey(Settings.readerSearchScopeSuffix) + encodedPath,
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
    frame.addEventListener("load", onFrameLoad);
    frameBack.addEventListener("load", onFrameLoad);
    if (chapterIndexFromURL(frameBack.contentDocument.URL) === currentIndex) {
      bufferReady = true;
    }
    initSidebarResize();
    bindReaderShortcuts();
    bindShellChapterLinks();
    updateChapterLinks(currentIndex);
    window.addEventListener("popstate", function (event) {
      var state = event.state;
      if (state && typeof state.chapter === "number") {
        showChapter(state.chapter, state.frag || "", false);
        return;
      }
      var target = chapterRequest(window.location.href);
      if (!target) return;
      showChapter(target.index, target.fragment, false);
    });
    setupFrame();

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
          }, Settings.readerTocHoverDelay);
        });
        section.addEventListener("mouseleave", function () {
          clearTimeout(hoverTimer);
          section.classList.remove("hover-open");
        });
      });

    localStorage.setItem(
      Settings.lastReadKey,
      JSON.stringify({
        path: encodedPath,
        chapter: currentIndex,
        title: readerTitle,
      }),
    );
    window.openPreferences = function () {
      window.location.href = "/?openPrefs=1";
    };
    onConfigApplied = applyTheme;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
