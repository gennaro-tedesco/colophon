(function () {
  let allBooks = [];
  let allViews = [];
  let navGroups = { language: [], series: [], tags: [], author: [] };
  let navCounts = { language: {}, series: {}, tags: {}, author: {} };
  let activeFilters = createEmptyFilters();
  let activeViewId = "";
  let currentView = "library";
  let statsCharts = [];
  let isDrilldownSuspended = false;
  let currentDrilldown = null;
  let drilldownBaseFilters = null;

  const navRefs = {
    language: new Map(),
    series: new Map(),
    tags: new Map(),
    author: new Map(),
  };
  const sectionRefs = new Map();

  const nav = document.getElementById("nav");
  const list = document.getElementById("list");
  const stats = document.getElementById("stats");
  const logo = document.querySelector(".logo");
  const search = document.getElementById("search");
  const searchScopeEl = document.getElementById("search-scope");
  const searchScopeWrap = document.getElementById("search-scope-wrap");
  const searchScopeMenu = document.getElementById("search-scope-menu");
  const searchClear = document.getElementById("search-clear");
  const activeFiltersEl = document.getElementById("active-filters");
  const count = document.getElementById("count");
  const scanStatus = document.getElementById("scan-status");
  const libraryBtn = document.getElementById("library-btn");
  const statsBtn = document.getElementById("stats-btn");
  const sidebarResizer = document.getElementById("sidebar-resizer");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const drilldownBackdrop = document.getElementById("drilldown-backdrop");
  const drilldownTitle = document.getElementById("drilldown-title");
  const drilldownBody = document.getElementById("drilldown-body");
  const drilldownClose = document.getElementById("drilldown-close");
  const continueReading = document.getElementById("continue-reading");
  const viewToFilterBtn = document.getElementById("view-to-filter-btn");
  const statsBtnStatsIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/></svg>';
  const statsBtnViewIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

  const GROUP_LABELS = {
    language: "Language",
    series: "Series",
    tags: "Tags",
    author: "Author",
  };
  const CHART_PALETTE_VARS = [
    "--blue",
    "--lavender",
    "--teal",
    "--yellow",
    "--pink",
    "--peach",
    "--green",
    "--sky",
    "--rosewater",
    "--flamingo",
    "--sapphire",
    "--red",
    "--maroon",
  ];
  const SIDEBAR_WIDTH_KEY = "sidebar:width";
  const SIDEBAR_LAST_KEY = "sidebar:last-width";
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 520;
  const SIDEBAR_COLLAPSED = 60;
  const VIEWS_HEIGHT_KEY = "views:height";
  const VIEWS_HEIGHT_MIN = 5;
  const VIEWS_HEIGHT_DEFAULT = 288;
  let currentCfg = {};
  let configReady = false;
  let scanInProgress = false;
  let scanVisible = false;
  let scanHadVisibleContent = false;
  let scanBookCount = 0;
  let scanTimer = null;
  let scanHideTimer = null;
  let scanVisibleAt = 0;
  let startupScanPending = false;
  let activeViewAddOpen = false;
  let activeViewAddQuery = "";
  let searchScope = "all";
  const SEARCH_SCOPES = [
    { value: "all", label: "all" },
    { value: "title", label: "title" },
    { value: "authors", label: "authors" },
    { value: "series", label: "series" },
    { value: "tags", label: "tags" },
    { value: "language", label: "language" },
  ];

  function clampSidebarWidth(value) {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
  }

  function applySidebarWidth(value) {
    const width =
      value <= SIDEBAR_COLLAPSED ? SIDEBAR_COLLAPSED : clampSidebarWidth(value);
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
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
    if (saved > 0) applySidebarWidth(saved);
    if (!sidebarResizer || window.matchMedia("(max-width: 720px)").matches)
      return;
    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", function (event) {
        event.stopPropagation();
        const current =
          parseInt(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--sidebar-w",
            ),
            10,
          ) || 0;
        if (current === SIDEBAR_COLLAPSED) {
          const restored =
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
      const startWidth =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--sidebar-w",
          ),
        ) || 280;
      const startX = event.clientX;
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
        const finalWidth =
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

  function initViewsResize() {
    const saved = parseInt(localStorage.getItem(VIEWS_HEIGHT_KEY) || "", 10);
    if (saved >= VIEWS_HEIGHT_MIN) {
      document.documentElement.style.setProperty("--views-h", saved + "px");
    }
  }

  function attachViewsResizerDrag(resizerEl) {
    if (!resizerEl || window.matchMedia("(max-width: 720px)").matches) return;
    resizerEl.addEventListener("pointerdown", function (event) {
      const startHeight =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--views-h",
          ),
        ) || VIEWS_HEIGHT_DEFAULT;
      const startY = event.clientY;
      document.body.classList.add("resizing-views");
      resizerEl.setPointerCapture(event.pointerId);
      function onMove(e) {
        const newH = Math.max(
          VIEWS_HEIGHT_MIN,
          startHeight - (e.clientY - startY),
        );
        document.documentElement.style.setProperty("--views-h", newH + "px");
      }
      function onEnd(e) {
        resizerEl.removeEventListener("pointermove", onMove);
        resizerEl.removeEventListener("pointerup", onEnd);
        resizerEl.removeEventListener("pointercancel", onEnd);
        document.body.classList.remove("resizing-views");
        resizerEl.releasePointerCapture(e.pointerId);
        const finalH = Math.round(
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--views-h",
            ),
          ) || VIEWS_HEIGHT_DEFAULT,
        );
        localStorage.setItem(VIEWS_HEIGHT_KEY, String(finalH));
      }
      resizerEl.addEventListener("pointermove", onMove);
      resizerEl.addEventListener("pointerup", onEnd);
      resizerEl.addEventListener("pointercancel", onEnd);
    });
  }

  function initThemeMixes() {
    const cs = getComputedStyle(document.documentElement);
    const el = document.documentElement;

    function get(v) {
      return cs.getPropertyValue(v).trim();
    }

    function parse(str) {
      const s = str.trim();
      if (s.startsWith("#")) {
        const hex =
          s.length === 4 ? s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s.slice(1);
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
        ];
      }
      const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (m) return [+m[1], +m[2], +m[3]];
      return null;
    }

    function blend(c1, ratio, c2) {
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

    const teal = parse(get("--teal"));
    const base = parse(get("--base"));
    const mantle = parse(get("--mantle"));
    const blue = parse(get("--blue"));
    const lavender = parse(get("--lavender"));
    const yellow = parse(get("--yellow"));
    const peach = parse(get("--peach"));
    const mauve = parse(get("--mauve"));
    const surface0 = parse(get("--surface0"));
    const surface1 = parse(get("--surface1"));

    const mixes = [
      ["--mix-teal-10-mantle", blend(teal, 0.1, mantle)],
      ["--mix-blue-16-t", blend(blue, 0.16, null)],
      ["--mix-yellow-14-mantle", blend(yellow, 0.14, mantle)],
      ["--mix-blue-22-t", blend(blue, 0.22, null)],
      ["--mix-blue-35-t", blend(blue, 0.35, null)],
      ["--mix-blue-16-base", blend(blue, 0.16, base)],
      ["--mix-lavender-16-base", blend(lavender, 0.16, base)],
      ["--mix-teal-14-base", blend(teal, 0.14, base)],
      ["--mix-teal-35-t", blend(teal, 0.35, null)],
      ["--mix-teal-28-t", blend(teal, 0.28, null)],
      ["--mix-teal-8-base", blend(teal, 0.08, base)],
      ["--mix-peach-12-t", blend(peach, 0.12, null)],
      ["--mix-lavender-16-t", blend(lavender, 0.16, null)],
      ["--mix-teal-14-t", blend(teal, 0.14, null)],
      ["--mix-mauve-12-surface0", blend(mauve, 0.12, surface0)],
      ["--mix-blue-12-surface0", blend(blue, 0.12, surface0)],
      ["--mix-blue-20-surface0", blend(blue, 0.2, surface0)],
      ["--mix-blue-30-surface0", blend(blue, 0.3, surface0)],
      ["--mix-surface1-60-t", blend(surface1, 0.6, null)],
      ["--mix-blue-12-t", blend(blue, 0.12, null)],
      ["--mix-mauve-12-t", blend(mauve, 0.12, null)],
      ["--mix-mauve-14-mantle", blend(mauve, 0.14, mantle)],
      ["--mix-mauve-16-t", blend(mauve, 0.16, null)],
    ];

    for (const [k, v] of mixes) {
      el.style.setProperty(k, v);
    }
  }

  function loadLibrary() {
    fetch("/api/library")
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then((lib) => {
        allBooks = lib.books || [];
        if (allBooks.length === 0) {
          if (configReady && currentCfg.libraryDir) {
            if (startupScanPending) {
              beginScanUI({ hasVisibleContent: false, count: 0 });
              return;
            }
            showEmptyLibrary();
            return;
          }
          showPickDirectory();
          return;
        }
        endScanUI();
        applyLibraryData(allBooks);
        loadViews();
      })
      .catch(() => {
        if (configReady && currentCfg.libraryDir) {
          if (startupScanPending) {
            beginScanUI({ hasVisibleContent: false, count: 0 });
            return;
          }
          showEmptyLibrary();
          return;
        }
        showPickDirectory();
      });
  }

  function showPickDirectory() {
    if (scanInProgress && !allBooks.length) {
      nav.innerHTML = "";
      if (scanVisible) {
        renderScanPlaceholder();
      }
      return;
    }
    renderLibraryDirectoryState("", "", "Choose library folder");
  }

  function showEmptyLibrary() {
    renderLibraryDirectoryState(
      "No books found",
      "The selected folder is valid, but it does not contain any supported books.",
      "Choose another folder",
    );
  }

  function renderLibraryDirectoryState(title, detail, buttonLabel) {
    nav.innerHTML = "";
    list.innerHTML =
      '<div class="empty">' +
      (title ? "<div>" + title + "</div>" : "") +
      (detail
        ? '<div style="margin-top:8px;color:var(--subtext0);font-size:var(--fs-sm)">' +
          detail +
          "</div>"
        : "") +
      '<button id="pick-dir" type="button" style="' +
      (title || detail ? "margin-top:18px;" : "") +
      "background:var(--surface0);border:1px solid var(--surface1);border-radius:6px;" +
      "color:var(--blue);font-family:var(--font-serif);font-size:var(--fs-md);" +
      'padding:10px 24px;cursor:pointer">' +
      buttonLabel +
      "</button></div>";
    document.getElementById("pick-dir").addEventListener("click", function () {
      beginEmptyScanUI();
      window.go.main.App.PickAndScan()
        .then(function (lib) {
          endScanUI();
          applyLibraryData(lib.books || []);
        })
        .catch(function () {
          endScanUI();
        });
    });
  }

  let bookAddTimer = null;

  function resetLibraryData() {
    allBooks = [];
    navGroups = { language: [], series: [], tags: [], author: [] };
    navCounts = { language: {}, series: {}, tags: {}, author: {} };
  }

  function applyLibraryData(books) {
    allBooks = books || [];
    if (allBooks.length === 0) {
      resetLibraryData();
      if (currentCfg.libraryDir) {
        showEmptyLibrary();
        return;
      }
      showPickDirectory();
      return;
    }
    const data = buildGroupData(allBooks);
    navGroups = data.groups;
    navCounts = data.counts;
    renderNav();
    renderFiltered();
  }

  function renderScanPlaceholder() {
    list.innerHTML =
      '<div class="scan-loading"><div class="scan-loading-spinner" aria-hidden="true"></div><div class="scan-loading-title">Scanning library…</div><div class="scan-loading-meta">' +
      (scanBookCount > 0
        ? scanBookCount + " books indexed"
        : "This may take a moment") +
      "</div></div>";
  }

  function updateScanUI() {
    const showBadge =
      scanInProgress &&
      scanVisible &&
      (scanHadVisibleContent || allBooks.length > 0);
    if (scanStatus) {
      scanStatus.classList.toggle("hidden", !showBadge);
      scanStatus.textContent = showBadge
        ? scanBookCount > 0
          ? "Refreshing library… " + scanBookCount
          : "Refreshing library…"
        : "";
    }
    if (
      scanInProgress &&
      scanVisible &&
      !scanHadVisibleContent &&
      allBooks.length === 0 &&
      currentView === "library"
    ) {
      renderScanPlaceholder();
    }
  }

  function beginScanUI(options) {
    clearTimeout(scanTimer);
    clearTimeout(scanHideTimer);
    scanHideTimer = null;
    scanInProgress = true;
    scanVisible = false;
    scanVisibleAt = 0;
    scanHadVisibleContent = Boolean(options && options.hasVisibleContent);
    scanBookCount =
      options && typeof options.count === "number"
        ? options.count
        : allBooks.length;
    scanTimer = setTimeout(function () {
      scanVisible = true;
      scanVisibleAt = Date.now();
      updateScanUI();
    }, 400);
    updateScanUI();
  }

  function beginCurrentScanUI() {
    beginScanUI({
      hasVisibleContent: allBooks.length > 0,
      count: allBooks.length,
    });
  }

  function beginEmptyScanUI() {
    beginScanUI({ hasVisibleContent: false, count: 0 });
  }

  function bumpScanUI() {
    if (!scanInProgress) {
      beginCurrentScanUI();
      return;
    }
    scanBookCount = allBooks.length;
    updateScanUI();
  }

  function endScanUI() {
    function finalizeScanUI() {
      scanInProgress = false;
      scanVisible = false;
      scanHadVisibleContent = false;
      scanBookCount = 0;
      scanVisibleAt = 0;
      scanHideTimer = null;
      updateScanUI();
    }

    clearTimeout(scanTimer);
    scanTimer = null;
    clearTimeout(scanHideTimer);
    if (scanVisible && scanVisibleAt > 0) {
      const remaining = 500 - (Date.now() - scanVisibleAt);
      if (remaining > 0) {
        scanHideTimer = setTimeout(finalizeScanUI, remaining);
        return;
      }
    }
    finalizeScanUI();
  }

  if (window.runtime && typeof window.runtime.EventsOn === "function") {
    window.runtime.EventsOn("book:add", function (book) {
      const hadBooks = allBooks.length > 0;
      const idx = allBooks.findIndex(function (b) {
        return b.path === book.path;
      });
      if (idx >= 0) {
        allBooks[idx] = book;
      } else {
        allBooks.push(book);
      }
      if (!scanInProgress) {
        beginScanUI({ hasVisibleContent: hadBooks, count: allBooks.length });
      } else {
        bumpScanUI();
      }
      clearTimeout(bookAddTimer);
      bookAddTimer = setTimeout(function () {
        const data = buildGroupData(allBooks);
        navGroups = data.groups;
        navCounts = data.counts;
        renderNav();
        renderFiltered();
      }, 80);
    });

    window.runtime.EventsOn("scan:done", function (lib) {
      clearTimeout(bookAddTimer);
      bookAddTimer = null;
      startupScanPending = false;
      endScanUI();
      applyLibraryData(lib && lib.books ? lib.books : []);
      loadViews();
    });
  }

  loadLibrary();
  loadViews();
  initSidebarResize();
  initViewsResize();
  initThemeMixes();

  // ── Preferences ──
  const prefsBackdrop = document.getElementById("prefs-backdrop");
  const prefsClose = document.getElementById("prefs-close");
  const prefsLibraryDir = document.getElementById("prefs-library-dir");
  const prefsPickDir = document.getElementById("prefs-pick-dir");
  const prefsFontFamily = document.getElementById("prefs-font-family");
  const prefsFontSize = document.getElementById("prefs-font-size");
  const prefsFontSizeVal = document.getElementById("prefs-font-size-val");
  const prefsSave = document.getElementById("prefs-save");
  const helpBackdrop = document.getElementById("help-backdrop");
  const helpClose = document.getElementById("help-close");
  const appVersionValue = document.getElementById("app-version-value");
  const appHelpRow = document.getElementById("app-help-row");

  function applyUIConfig(cfg) {
    const root = document.documentElement;
    if (cfg.uiFontSize && cfg.uiFontSize > 0) {
      const base = cfg.uiFontSize;
      root.style.setProperty("--fs-xs", Math.round(base * 0.75) + "px");
      root.style.setProperty("--fs-sm", Math.round(base * 0.9) + "px");
      root.style.setProperty("--fs-base", base + "px");
      root.style.setProperty("--fs-md", Math.round(base * 1.15) + "px");
      root.style.setProperty("--fs-lg", Math.round(base * 1.65) + "px");
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
    if (cfg.theme) {
      root.setAttribute("data-theme", cfg.theme);
    }
    initThemeMixes();
  }

  function openPreferences() {
    prefsBackdrop.classList.remove("hidden");
    window.go.main.App.GetConfig().then(function (cfg) {
      prefsLibraryDir.value = cfg.libraryDir || "";
      prefsFontSize.value = cfg.uiFontSize || 20;
      prefsFontSizeVal.textContent = (cfg.uiFontSize || 20) + "px";
      prefsFontFamily.value = cfg.uiFontFamily || "";
    });
    window.go.main.App.ListFonts().then(function (fonts) {
      while (prefsFontFamily.options.length > 1) prefsFontFamily.remove(1);
      fonts.forEach(function (f) {
        var opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        prefsFontFamily.appendChild(opt);
      });
    });
  }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      openPreferences();
    }
  });
  prefsClose.addEventListener("click", () =>
    prefsBackdrop.classList.add("hidden"),
  );
  prefsBackdrop.addEventListener("click", (e) => {
    if (e.target === prefsBackdrop) prefsBackdrop.classList.add("hidden");
  });
  helpClose.addEventListener("click", () =>
    helpBackdrop.classList.add("hidden"),
  );
  helpBackdrop.addEventListener("click", (e) => {
    if (e.target === helpBackdrop) helpBackdrop.classList.add("hidden");
  });
  prefsFontSize.addEventListener("input", () => {
    prefsFontSizeVal.textContent = prefsFontSize.value + "px";
  });
  prefsPickDir.addEventListener("click", () => {
    beginCurrentScanUI();
    window.go.main.App.PickAndScan()
      .then(function (lib) {
        endScanUI();
        prefsLibraryDir.value = lib.libraryDir || prefsLibraryDir.value;
        window.go.main.App.GetConfig().then((cfg) => {
          prefsLibraryDir.value = cfg.libraryDir || "";
        });
        applyLibraryData(lib.books || []);
        loadViews();
      })
      .catch(function () {
        endScanUI();
      });
  });

  prefsSave.addEventListener("click", () => {
    const cfg = Object.assign({}, currentCfg, {
      libraryDir: prefsLibraryDir.value,
      uiFontFamily: prefsFontFamily.value,
      uiFontSize: parseInt(prefsFontSize.value, 10),
    });
    const shouldScan = Boolean(
      cfg.libraryDir && cfg.libraryDir !== currentCfg.libraryDir,
    );
    if (shouldScan) {
      beginCurrentScanUI();
    }
    window.go.main.App.SaveConfig(cfg)
      .then(function () {
        if (shouldScan) {
          endScanUI();
        }
        currentCfg = cfg;
        applyUIConfig(cfg);
        prefsBackdrop.classList.add("hidden");
        if (cfg.libraryDir) {
          loadLibrary();
          loadViews();
          return;
        }
        endScanUI();
        applyLibraryData([]);
        allViews = [];
        renderViewsSection();
        updateViewToFilterBtn();
      })
      .catch(function () {
        if (shouldScan) {
          endScanUI();
        }
      });
  });

  window.openPreferences = openPreferences;
  if (new URLSearchParams(location.search).has("openPrefs")) {
    openPreferences();
  }

  // ── App settings menu ──
  let appMenuHideTimer = null;

  const appMenuToggle = document.getElementById("app-menu-toggle");
  const appMenuPanel = document.getElementById("app-menu-panel");
  const appDirName = document.getElementById("app-dir-name");
  const appDirPick = document.getElementById("app-dir-pick");
  const appTheme = document.getElementById("app-theme");
  const appThemeWrap = document.getElementById("app-theme-wrap");
  const appThemeMenu = document.getElementById("app-theme-menu");
  const appFontFamily = document.getElementById("app-font-family");
  const appFontFamilyWrap = document.getElementById("app-font-family-wrap");
  const appFontFamilyMenu = document.getElementById("app-font-family-menu");
  const appFontSlider = document.getElementById("app-font-slider");
  const appFontVal = document.getElementById("app-font-val");

  function showAppMenu() {
    clearTimeout(appMenuHideTimer);
    appMenuToggle.classList.add("open");
    appMenuPanel.classList.add("open");
  }

  function scheduleHideAppMenu() {
    clearTimeout(appMenuHideTimer);
    appMenuHideTimer = setTimeout(function () {
      appMenuToggle.classList.remove("open");
      appMenuPanel.classList.remove("open");
    }, 300);
  }

  appMenuToggle.addEventListener("mouseenter", showAppMenu);
  appMenuToggle.addEventListener("mouseleave", scheduleHideAppMenu);
  appMenuPanel.addEventListener("mouseenter", function () {
    clearTimeout(appMenuHideTimer);
  });
  appMenuPanel.addEventListener("mouseleave", scheduleHideAppMenu);

  function updateAppFontFamilyButton(value) {
    appFontFamily.textContent = value || "System default";
    appFontFamily.dataset.value = value || "";
  }

  var APP_THEMES = [
    { value: "solarized-dark", label: "Solarized Dark" },
    { value: "solarized-light", label: "Solarized Light" },
    { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
    { value: "catppuccin-latte", label: "Catppuccin Latte" },
    { value: "nord", label: "Nord" },
    { value: "everforest", label: "Everforest" },
    { value: "tokyonight", label: "Tokyo Night" },
    { value: "kanagawa", label: "Kanagawa" },
    { value: "rose-pine", label: "Rose Pine" },
    { value: "ayu-mirage", label: "Ayu Mirage" },
    { value: "iceberg-light", label: "Iceberg Light" },
  ];

  function updateAppThemeButton(value) {
    var item = APP_THEMES.find(function (t) {
      return t.value === (value || "solarized-dark");
    });
    appTheme.textContent = item ? item.label : "Solarized Dark";
    appTheme.dataset.value = value || "solarized-dark";
  }

  function updateAppFontFamilyChoices(value) {
    Array.from(
      appFontFamilyMenu.querySelectorAll(".app-font-family-choice"),
    ).forEach(function (choice) {
      const active = choice.dataset.value === (value || "");
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function updateAppThemeChoices(value) {
    Array.from(
      appThemeMenu.querySelectorAll(".app-font-family-choice"),
    ).forEach(function (choice) {
      const active = choice.dataset.value === (value || "solarized-dark");
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function closeAppFontFamilyMenu() {
    appFontFamilyWrap.classList.remove("open");
    appFontFamily.setAttribute("aria-expanded", "false");
  }

  function closeAppThemeMenu() {
    appThemeWrap.classList.remove("open");
    appTheme.setAttribute("aria-expanded", "false");
  }

  function closeSearchScopeMenu() {
    searchScopeWrap.classList.remove("open");
    searchScopeEl.setAttribute("aria-expanded", "false");
  }

  function openAppFontFamilyMenu() {
    appFontFamilyWrap.classList.add("open");
    appFontFamily.setAttribute("aria-expanded", "true");
  }

  function openAppThemeMenu() {
    appThemeWrap.classList.add("open");
    appTheme.setAttribute("aria-expanded", "true");
  }

  function openSearchScopeMenu() {
    searchScopeWrap.classList.add("open");
    searchScopeEl.setAttribute("aria-expanded", "true");
  }

  function renderAppFontFamilyChoices(fonts, selected) {
    appFontFamilyMenu.innerHTML = "";
    [{ value: "", label: "System default" }]
      .concat(
        (fonts || []).map(function (font) {
          return { value: font, label: font };
        }),
      )
      .forEach(function (item) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "app-font-family-choice";
        choice.dataset.value = item.value;
        choice.textContent = item.label;
        choice.setAttribute("role", "option");
        var isActive = item.value === (selected || "");
        choice.classList.toggle("is-active", isActive);
        choice.setAttribute("aria-selected", isActive ? "true" : "false");
        if (item.value) {
          choice.style.fontFamily = "'" + item.value + "'";
        }
        choice.addEventListener("click", function (event) {
          event.stopPropagation();
          const cfg = Object.assign({}, currentCfg, {
            uiFontFamily: item.value,
          });
          currentCfg = cfg;
          updateAppFontFamilyButton(item.value);
          updateAppFontFamilyChoices(item.value);
          applyUIConfig(cfg);
          closeAppFontFamilyMenu();
          window.go.main.App.SaveConfig(cfg);
        });
        appFontFamilyMenu.appendChild(choice);
      });
    updateAppFontFamilyButton(selected);
  }

  function renderAppThemeChoices(selected) {
    var normalizedSelected = selected || "solarized-dark";
    appThemeMenu.innerHTML = "";
    APP_THEMES.forEach(function (item) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "app-font-family-choice";
      choice.dataset.value = item.value;
      choice.textContent = item.label;
      choice.setAttribute("role", "option");
      var isActive = item.value === normalizedSelected;
      choice.classList.toggle("is-active", isActive);
      choice.setAttribute("aria-selected", isActive ? "true" : "false");
      choice.addEventListener("click", function (event) {
        event.stopPropagation();
        const cfg = Object.assign({}, currentCfg, { theme: item.value });
        currentCfg = cfg;
        updateAppThemeButton(item.value);
        updateAppThemeChoices(item.value);
        applyUIConfig(cfg);
        closeAppThemeMenu();
        window.go.main.App.SaveConfig(cfg);
      });
      appThemeMenu.appendChild(choice);
    });
    updateAppThemeButton(normalizedSelected);
  }

  function updateSearchScopeButton(value) {
    searchScopeEl.dataset.value = value || "all";
  }

  function updateSearchPlaceholder(value) {
    var normalizedValue = value || "all";
    search.placeholder =
      normalizedValue === "all"
        ? "search title, authors, tags..."
        : "search " + normalizedValue;
  }

  function updateSearchScopeChoices(value) {
    Array.from(
      searchScopeMenu.querySelectorAll(".app-font-family-choice"),
    ).forEach(function (choice) {
      const active = choice.dataset.value === (value || "all");
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function renderSearchScopeChoices(selected) {
    var normalizedSelected = selected || "all";
    searchScopeMenu.innerHTML = "";
    SEARCH_SCOPES.forEach(function (item) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "app-font-family-choice";
      choice.dataset.value = item.value;
      choice.textContent = item.label;
      choice.setAttribute("role", "option");
      var isActive = item.value === normalizedSelected;
      choice.classList.toggle("is-active", isActive);
      choice.setAttribute("aria-selected", isActive ? "true" : "false");
      choice.addEventListener("click", function (event) {
        event.stopPropagation();
        searchScope = item.value;
        updateSearchScopeButton(item.value);
        updateSearchPlaceholder(item.value);
        updateSearchScopeChoices(item.value);
        closeSearchScopeMenu();
        renderFiltered();
        updateViewToFilterBtn();
        updateViewButtons();
      });
      searchScopeMenu.appendChild(choice);
    });
    updateSearchScopeButton(normalizedSelected);
    updateSearchPlaceholder(normalizedSelected);
  }

  appDirPick.addEventListener("click", function () {
    beginCurrentScanUI();
    window.go.main.App.PickAndScan()
      .then(function (lib) {
        endScanUI();
        window.go.main.App.GetConfig().then(function (cfg) {
          currentCfg = cfg;
          appDirName.textContent = cfg.libraryDir || "—";
          applyLibraryData(lib.books || []);
          loadViews();
        });
      })
      .catch(function () {
        endScanUI();
      });
  });

  appFontSlider.addEventListener("input", function () {
    const size = parseInt(appFontSlider.value);
    appFontVal.textContent = size + "px";
    applyUIConfig({ uiFontSize: size });
  });

  appFontFamily.addEventListener("click", function (event) {
    event.stopPropagation();
    if (appFontFamilyWrap.classList.contains("open")) {
      closeAppFontFamilyMenu();
      return;
    }
    openAppFontFamilyMenu();
  });

  appTheme.addEventListener("click", function (event) {
    event.stopPropagation();
    if (appThemeWrap.classList.contains("open")) {
      closeAppThemeMenu();
      return;
    }
    openAppThemeMenu();
  });

  appFontSlider.addEventListener("change", function () {
    const cfg = Object.assign({}, currentCfg, {
      uiFontSize: parseInt(appFontSlider.value),
    });
    currentCfg = cfg;
    window.go.main.App.SaveConfig(cfg);
  });

  document
    .getElementById("app-rescan-btn")
    .addEventListener("click", function () {
      appMenuToggle.classList.remove("open");
      appMenuPanel.classList.remove("open");
      beginCurrentScanUI();
      window.go.main.App.Rescan()
        .then(function () {
          return window.go.main.App.GetLibrary();
        })
        .then(function (lib) {
          endScanUI();
          applyLibraryData(lib && lib.books ? lib.books : []);
          loadViews();
        })
        .catch(function () {
          endScanUI();
        });
    });

  appHelpRow.addEventListener("click", function () {
    helpBackdrop.classList.remove("hidden");
    appMenuToggle.classList.remove("open");
    appMenuPanel.classList.remove("open");
  });

  function initAppMenu(cfg) {
    appDirName.textContent = cfg.libraryDir || "—";
    if (appVersionValue) {
      appVersionValue.textContent = cfg.version || "dev";
    }
    const size = cfg.uiFontSize || 20;
    appFontSlider.value = size;
    appFontVal.textContent = size + "px";
    renderAppThemeChoices(cfg.theme || "solarized-dark");
    window.go.main.App.ListFonts().then(function (fonts) {
      renderAppFontFamilyChoices(fonts, cfg.uiFontFamily || "");
    });
  }

  window.go.main.App.GetConfig().then(function (cfg) {
    configReady = true;
    currentCfg = cfg;
    applyUIConfig(cfg);
    initAppMenu(cfg);
    startupScanPending = Boolean(cfg.libraryDir && allBooks.length === 0);
    if (startupScanPending) {
      beginEmptyScanUI();
    }
  });

  document.addEventListener("mousedown", function (event) {
    if (!appFontFamilyWrap.contains(event.target)) {
      closeAppFontFamilyMenu();
    }
    if (!appThemeWrap.contains(event.target)) {
      closeAppThemeMenu();
    }
    if (!searchScopeWrap.contains(event.target)) {
      closeSearchScopeMenu();
    }
    if (
      activeViewAddOpen &&
      !event.target.closest(".active-view-add-section")
    ) {
      activeViewAddOpen = false;
      activeViewAddQuery = "";
      renderFiltered();
    }
  });

  (function initContinueReading() {
    continueReading.disabled = true;
    try {
      var data = JSON.parse(localStorage.getItem("lastRead"));
      if (data && data.path) {
        continueReading.title = "Continue reading: " + (data.title || "");
        continueReading.disabled = false;
        continueReading.addEventListener("click", function () {
          window.location.href =
            "/read/" + data.path + "?chapter=" + (data.chapter || 0);
        });
      }
    } catch (e) {}
  })();

  search.addEventListener("input", () => {
    searchClear.classList.toggle("visible", search.value.length > 0);
    renderFiltered();
    updateViewToFilterBtn();
    updateViewButtons();
  });

  if (searchScopeEl) {
    renderSearchScopeChoices(searchScope);
    searchScopeWrap.addEventListener("mouseenter", function () {
      openSearchScopeMenu();
    });
    searchScopeWrap.addEventListener("mouseleave", function () {
      closeSearchScopeMenu();
    });
  }

  searchClear.addEventListener("click", () => {
    search.value = "";
    searchClear.classList.remove("visible");
    search.focus();
    renderFiltered();
  });

  libraryBtn.addEventListener("click", function () {
    if (libraryBtn.classList.contains("current")) return;
    if (currentView !== "library") setView("library");
    clearFilters();
  });
  statsBtn.addEventListener("click", function () {
    if (currentView === "stats" && activeViewId) {
      setView("library");
      return;
    }
    setView("stats");
  });
  updateViewButtons();
  logo.addEventListener("click", clearFilters);
  drilldownClose.addEventListener("click", closeDrilldownModal);
  drilldownBackdrop.addEventListener("click", (event) => {
    if (event.target === drilldownBackdrop) closeDrilldownModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      if (sidebarToggle) sidebarToggle.click();
      return;
    }
    if (event.key !== "Escape") return;
    if (drilldownBackdrop.classList.contains("open")) {
      closeDrilldownModal();
      return;
    }
    if (!prefsBackdrop.classList.contains("hidden")) {
      prefsBackdrop.classList.add("hidden");
      return;
    }
    if (!helpBackdrop.classList.contains("hidden")) {
      helpBackdrop.classList.add("hidden");
    }
  });

  function createEmptyFilters() {
    return {
      language: new Set(),
      series: new Set(),
      tags: new Set(),
      author: new Set(),
    };
  }

  function cloneFilters(filters) {
    return {
      language: new Set(filters.language),
      series: new Set(filters.series),
      tags: new Set(filters.tags),
      author: new Set(filters.author),
    };
  }

  function buildGroupData(books) {
    const groups = {
      language: new Set(),
      series: new Set(),
      tags: new Set(),
      author: new Set(),
    };
    const counts = { language: {}, series: {}, tags: {}, author: {} };

    books.forEach((book) => {
      if (book.language) {
        groups.language.add(book.language);
        counts.language[book.language] =
          (counts.language[book.language] || 0) + 1;
      }
      if (book.series) {
        groups.series.add(book.series);
        counts.series[book.series] = (counts.series[book.series] || 0) + 1;
      }
      (book.tags || []).forEach((tag) => {
        groups.tags.add(tag);
        counts.tags[tag] = (counts.tags[tag] || 0) + 1;
      });
      (book.authors || []).forEach((author) => {
        groups.author.add(author);
        counts.author[author] = (counts.author[author] || 0) + 1;
      });
    });

    const sortFn = (a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });
    return {
      groups: {
        language: Array.from(groups.language).sort(sortFn),
        series: Array.from(groups.series).sort(sortFn),
        tags: Array.from(groups.tags).sort(sortFn),
        author: Array.from(groups.author).sort(sortFn),
      },
      counts,
    };
  }

  function hasActiveFilters() {
    return Object.values(activeFilters).some((values) => values.size > 0);
  }

  function hasActiveFilterGroup(type) {
    return activeFilters[type].size > 0;
  }

  function isFilterActive(type, value) {
    return activeFilters[type].has(value);
  }

  function clearFilters() {
    activeFilters = createEmptyFilters();
    activeViewId = "";
    activeViewAddOpen = false;
    activeViewAddQuery = "";
    search.value = "";
    searchClear.classList.remove("visible");
    updateNavState();
    renderFiltered();
    updateViewToFilterBtn();
    updateViewButtons();
  }

  function applyFilter(type, value) {
    if (activeFilters[type].has(value)) {
      activeFilters[type].delete(value);
    } else {
      activeFilters[type].add(value);
    }
    updateNavState();
    renderFiltered();
    updateViewToFilterBtn();
    updateViewButtons();
  }

  function setView(view) {
    if (currentView === view) return;
    currentView = view;
    updateViewButtons();
    if (view === "stats") {
      list.classList.add("hidden");
      stats.classList.remove("hidden");
      renderStatsView(filterBooks());
    } else {
      closeDrilldownModal();
      destroyCharts(statsCharts);
      stats.innerHTML = "";
      stats.classList.add("hidden");
      list.classList.remove("hidden");
      renderFiltered();
    }
  }

  function updateViewButtons() {
    const cleanLibrary =
      currentView === "library" &&
      activeViewId === "" &&
      !hasActiveFilters() &&
      search.value.trim() === "";
    const statsReturnsToView = currentView === "stats" && activeViewId !== "";
    libraryBtn.classList.toggle("current", cleanLibrary);
    statsBtn.classList.toggle(
      "current",
      currentView === "stats" && !statsReturnsToView,
    );
    statsBtn.dataset.tooltip = statsReturnsToView ? "view" : "stats";
    statsBtn.setAttribute("aria-label", statsReturnsToView ? "View" : "Stats");
    statsBtn.innerHTML = statsReturnsToView
      ? statsBtnViewIcon
      : statsBtnStatsIcon;
  }

  function closeDrilldownModal() {
    if (drilldownBaseFilters) {
      activeFilters = cloneFilters(drilldownBaseFilters);
      drilldownBaseFilters = null;
      updateNavState();
    }
    isDrilldownSuspended = false;
    currentDrilldown = null;
    drilldownBackdrop.classList.remove("hidden");
    drilldownBackdrop.classList.remove("open");
    drilldownBody.innerHTML = "";
    renderFiltered();
  }

  function suspendDrilldownModal() {
    if (!drilldownBackdrop.classList.contains("open")) return;
    isDrilldownSuspended = true;
    drilldownBackdrop.classList.add("hidden");
  }

  function resumeDrilldownModal() {
    isDrilldownSuspended = false;
    drilldownBackdrop.classList.remove("hidden");
  }

  function encodeBookPath(path) {
    return (path || "").split("/").map(encodeURIComponent).join("/");
  }

  function openReader(book) {
    window.location.href = `/read/${encodeBookPath(book.path)}?chapter=0`;
  }

  function renderDrilldownContent(sourceType, value, books) {
    const filteredBooks = sourceType
      ? books.filter((book) => matchFilter(book, sourceType, value))
      : books;
    renderDrilldownTitle(sourceType, value, filteredBooks.length);
    drilldownBody.innerHTML = "";

    if (!filteredBooks.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "no books found";
      drilldownBody.appendChild(empty);
    } else {
      const results = document.createElement("div");
      results.className = "drilldown-results";
      filteredBooks.forEach((book) => {
        results.appendChild(
          bookRow(book, {
            disablePreview: true,
            onOpen() {
              suspendDrilldownModal();
              openReader(book);
            },
          }),
        );
      });
      drilldownBody.appendChild(results);
    }
  }

  function openDrilldownModal(sourceType, value, books) {
    if (!drilldownBaseFilters) {
      drilldownBaseFilters = cloneFilters(activeFilters);
    }
    currentDrilldown = { sourceType, value };
    isDrilldownSuspended = false;
    drilldownBackdrop.classList.remove("hidden");
    renderDrilldownContent(sourceType, value, books);

    drilldownBackdrop.classList.add("open");
  }

  function renderDrilldownTitle(sourceType, value, countValue) {
    drilldownTitle.innerHTML = "";

    const filtersWrap = document.createElement("div");
    filtersWrap.className = "drilldown-title-filters";

    const seen = new Set();
    if (sourceType && value) {
      filtersWrap.appendChild(drilldownTitleChip(sourceType, value));
      seen.add(`${sourceType}:${value}`);
    }

    Object.entries(activeFilters).forEach(([type, values]) => {
      values.forEach((activeValue) => {
        const key = `${type}:${activeValue}`;
        if (seen.has(key)) return;
        filtersWrap.appendChild(drilldownTitleChip(type, activeValue));
        seen.add(key);
      });
    });

    const countBadge = document.createElement("span");
    countBadge.className = "group-item-count";
    countBadge.textContent = countValue;

    drilldownTitle.appendChild(filtersWrap);
    drilldownTitle.appendChild(countBadge);
  }

  function drilldownTitleChip(type, value) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `book-row-chip ${drilldownChipClass(type)}`;
    chip.textContent = value;
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      handleDrilldownTitleChipClick(type, value);
    });
    return chip;
  }

  function handleDrilldownTitleChipClick(type, value) {
    if (
      currentDrilldown &&
      currentDrilldown.sourceType === type &&
      currentDrilldown.value === value
    ) {
      currentDrilldown = null;
      renderFiltered();
      return;
    }

    if (!activeFilters[type].has(value)) return;
    activeFilters[type].delete(value);
    updateNavState();
    renderFiltered();
  }

  function drilldownChipClass(type) {
    switch (type) {
      case "language":
        return "book-row-chip-language";
      case "series":
        return "book-row-chip-series";
      case "tags":
        return "book-row-chip-tag";
      default:
        return "book-row-chip-tag";
    }
  }

  function renderNav() {
    nav.innerHTML = "";
    Object.values(navRefs).forEach((group) => group.clear());
    sectionRefs.clear();

    const allEl = document.createElement("div");
    allEl.className = "all-item";
    allEl.innerHTML = `<span>All books</span><span class="group-item-count">${allBooks.length}</span>`;
    allEl.addEventListener("click", clearFilters);
    nav.appendChild(allEl);
    sectionRefs.set("all", allEl);

    ["author", "language", "series", "tags"].forEach((key) => {
      const values = navGroups[key];
      if (!values || values.length === 0) return;

      const section = document.createElement("div");
      section.className = "group-section";
      let hoverTimer = null;

      const header = document.createElement("div");
      header.className = "group-header";
      header.innerHTML = `<span>${GROUP_LABELS[key]}</span><span class="group-chevron">&#9654;</span>`;
      header.addEventListener("click", () => section.classList.toggle("open"));

      section.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(() => section.classList.add("hover-open"), 300);
      });

      section.addEventListener("mouseleave", () => {
        clearTimeout(hoverTimer);
        section.classList.remove("hover-open");
      });

      const items = document.createElement("div");
      items.className = "group-items";

      const itemsInner = document.createElement("div");
      itemsInner.className = "group-items-inner";

      values.forEach((value) => {
        const item = document.createElement("div");
        item.className = "group-item";
        const label = document.createElement("span");
        label.textContent = value;
        const itemCount = document.createElement("span");
        itemCount.className = "group-item-count";
        itemCount.textContent = String(navCounts[key][value] || 0);
        item.appendChild(label);
        item.appendChild(itemCount);
        item.addEventListener("click", () => applyFilter(key, value));
        itemsInner.appendChild(item);
        navRefs[key].set(value, item);
      });

      items.appendChild(itemsInner);
      section.appendChild(header);
      section.appendChild(items);
      nav.appendChild(section);
      sectionRefs.set(key, section);
    });

    updateNavState();
  }

  function updateNavState() {
    const allEl = sectionRefs.get("all");
    if (allEl) {
      allEl.classList.toggle("active", !hasActiveFilters());
    }

    ["author", "language", "series", "tags"].forEach((type) => {
      const section = sectionRefs.get(type);
      if (section) {
        if (hasActiveFilterGroup(type)) {
          section.classList.add("open");
        } else {
          section.classList.remove("open");
        }
      }

      navRefs[type].forEach((item, value) => {
        item.classList.toggle("active", isFilterActive(type, value));
      });
    });

    renderActiveFilterChips();
  }

  function renderActiveFilterChips() {
    activeFiltersEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    ["language", "series", "tags", "author"].forEach((type) => {
      activeFilters[type].forEach((value) => {
        frag.appendChild(activeFilterChip(type, value));
      });
    });

    activeFiltersEl.appendChild(frag);
    activeFiltersEl.classList.toggle(
      "visible",
      activeFiltersEl.childElementCount > 0,
    );
  }

  function activeFilterChip(type, value) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `book-row-chip toolbar-filter-chip ${drilldownChipClass(type)}`;
    chip.textContent = value;
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      applyFilter(type, value);
    });
    return chip;
  }

  function matchFilter(book, type, value) {
    switch (type) {
      case "language":
        return book.language === value;
      case "series":
        return book.series === value;
      case "tags":
        return Array.isArray(book.tags) && book.tags.includes(value);
      case "author":
        return Array.isArray(book.authors) && book.authors.includes(value);
      default:
        return true;
    }
  }

  function searchHaystack(book, scope) {
    switch (scope) {
      case "title":
        return (book.title || "").toLowerCase();
      case "authors":
        return (book.authors || []).join(" ").toLowerCase();
      case "series":
        return (book.series || "").toLowerCase();
      case "tags":
        return (book.tags || []).join(" ").toLowerCase();
      case "language":
        return (book.language || "").toLowerCase();
      default:
        return [
          book.title || "",
          ...(book.authors || []),
          book.series || "",
          ...(book.tags || []),
          book.language || "",
        ]
          .join(" ")
          .toLowerCase();
    }
  }

  function filterBooks() {
    const q = search.value.trim().toLowerCase();
    const activeView = activeViewId
      ? allViews.find(function (view) {
          return view.id === activeViewId;
        })
      : null;
    const activeViewPaths = activeView
      ? new Set(activeView.bookPaths || [])
      : null;

    return allBooks.filter((book) => {
      if (activeViewPaths && !activeViewPaths.has(book.path)) return false;

      for (const [type, values] of Object.entries(activeFilters)) {
        if (values.size === 0) continue;

        let matchesGroup = false;
        for (const value of values) {
          if (matchFilter(book, type, value)) {
            matchesGroup = true;
            break;
          }
        }

        if (!matchesGroup) return false;
      }

      if (q) {
        const haystack = searchHaystack(book, searchScope);
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }

  function renderFiltered() {
    const filtered = filterBooks();
    count.textContent = `${filtered.length}/${allBooks.length}`;

    if (currentView === "stats") {
      renderStatsView(filtered);
      if (
        drilldownBackdrop.classList.contains("open") &&
        !isDrilldownSuspended
      ) {
        if (currentDrilldown) {
          renderDrilldownContent(
            currentDrilldown.sourceType,
            currentDrilldown.value,
            filtered,
          );
        } else {
          renderDrilldownContent(null, null, filtered);
        }
      }
      return;
    }

    renderBookList(filtered);
  }

  function renderBookList(filtered) {
    list.innerHTML = "";
    const activeView = activeViewId
      ? allViews.find(function (view) {
          return view.id === activeViewId;
        })
      : null;

    if (activeViewId) {
      if (activeView) {
        list.appendChild(buildActiveViewBanner(activeView));
      }
    }

    if (filtered.length === 0 && !activeView) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.textContent = "no books found";
      list.appendChild(emptyEl);
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach((book) => {
      frag.appendChild(
        bookRow(book, activeViewId ? { viewId: activeViewId } : {}),
      );
    });
    if (activeView) {
      frag.appendChild(buildActiveViewAddSection(activeView));
    }
    list.appendChild(frag);
  }

  function buildActiveViewAddSection(view) {
    const wrap = document.createElement("div");
    wrap.className = "active-view-add-section";

    const row = document.createElement("div");
    row.className = "book-row";

    const header = document.createElement("div");
    header.className = "book-row-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "book-row-title-wrap";

    if (activeViewAddOpen) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "view-name-input";
      input.placeholder = "Search books…";
      input.autocomplete = "off";
      input.autocorrect = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.value = activeViewAddQuery;
      input.addEventListener("click", function (event) {
        event.stopPropagation();
      });
      input.addEventListener("input", function () {
        activeViewAddQuery = input.value;
        renderFiltered();
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          activeViewAddOpen = false;
          activeViewAddQuery = "";
          renderFiltered();
        }
      });
      titleWrap.appendChild(input);
      setTimeout(function () {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }, 0);
    } else {
      const title = document.createElement("span");
      title.className = "book-row-title";
      title.innerHTML = "&nbsp;";
      titleWrap.appendChild(title);

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "book-row-add-btn";
      addBtn.title = "Add to view";
      addBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
      addBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        activeViewAddOpen = true;
        activeViewAddQuery = "";
        renderFiltered();
      });
      titleWrap.appendChild(addBtn);
    }

    header.appendChild(titleWrap);
    row.appendChild(header);
    wrap.appendChild(row);

    if (!activeViewAddOpen) return wrap;

    const q = activeViewAddQuery.trim().toLowerCase();
    if (!q) return wrap;

    const activeViewPaths = new Set(view.bookPaths || []);
    const matches = allBooks.filter(function (book) {
      if (activeViewPaths.has(book.path)) return false;
      const haystack = searchHaystack(book, searchScope);
      return haystack.includes(q);
    });

    if (matches.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.textContent = "no books found";
      wrap.appendChild(emptyEl);
      return wrap;
    }

    matches.forEach(function (book) {
      wrap.appendChild(
        bookRow(book, {
          disableOpen: true,
          addAction: function () {
            window.go.main.App.AddBooksToView(view.id, [book.path]).then(
              function () {
                activeViewAddOpen = false;
                activeViewAddQuery = "";
                mergeViewBooks(view.id, [book.path]);
              },
            );
          },
        }),
      );
    });

    return wrap;
  }

  function buildActiveViewBanner(view) {
    const banner = document.createElement("div");
    banner.className = "active-view-banner";

    const titleWrap = document.createElement("div");
    titleWrap.className = "active-view-banner-title-wrap";

    const titleBtn = document.createElement("button");
    titleBtn.type = "button";
    titleBtn.className = "active-view-banner-title";
    titleBtn.textContent = view.name;
    titleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      startRenameView(view, titleBtn, deleteBtn);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "active-view-banner-delete";
    deleteBtn.title = "Delete view";
    deleteBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      window.go.main.App.DeleteView(view.id).then(function () {
        allViews = allViews.filter(function (v) {
          return v.id !== view.id;
        });
        if (activeViewId === view.id) activeViewId = "";
        renderViewsSection();
        updateViewToFilterBtn();
        updateViewButtons();
        document.body.classList.toggle("no-views", allViews.length === 0);
        renderFiltered();
      });
    });

    titleWrap.appendChild(titleBtn);
    titleWrap.appendChild(deleteBtn);

    banner.appendChild(titleWrap);

    return banner;
  }

  function renderStatsView(books) {
    destroyCharts(statsCharts);
    stats.innerHTML = "";

    if (books.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.textContent = "no books found";
      stats.appendChild(emptyEl);
      return;
    }

    ["tags", "series", "language"].forEach((type) => {
      const card = document.createElement("section");
      card.className = "stats-card";
      card.innerHTML = `<div class="stats-card-label">${GROUP_LABELS[type]}</div>`;

      const distribution = buildDistribution(books, type);
      if (distribution.labels.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "empty";
        emptyEl.textContent = "no data";
        card.appendChild(emptyEl);
        stats.appendChild(card);
        return;
      }

      const canvasWrap = document.createElement("div");
      canvasWrap.className = "stats-canvas-wrap";
      const canvas = document.createElement("canvas");
      canvasWrap.appendChild(canvas);
      card.appendChild(canvasWrap);
      stats.appendChild(card);
      statsCharts.push(
        createDonutChart(
          canvas,
          distribution,
          true,
          (event, elements, chart) => {
            if (!elements.length) return;
            const selectedIndex = elements[0].index;
            openDrilldownModal(type, chart.data.labels[selectedIndex], books);
          },
        ),
      );
    });
  }

  function buildDistribution(books, type) {
    const counts = new Map();

    books.forEach((book) => {
      getBookValues(book, type).forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });

    const entries = Array.from(counts.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0], undefined, { sensitivity: "base" });
    });

    return {
      labels: entries.map((entry) => entry[0]),
      values: entries.map((entry) => entry[1]),
    };
  }

  function getBookValues(book, type) {
    switch (type) {
      case "language":
        return book.language ? [book.language] : [];
      case "series":
        return book.series ? [book.series] : [];
      case "tags":
        return (book.tags || []).filter(Boolean);
      case "author":
        return (book.authors || []).filter(Boolean);
      default:
        return [];
    }
  }

  function createDonutChart(canvas, distribution, clickable, onClick) {
    const styles = getComputedStyle(document.documentElement);
    const palette = CHART_PALETTE_VARS.map((name) =>
      styles.getPropertyValue(name).trim(),
    ).filter(Boolean);
    const backgroundColor = distribution.labels.map(
      (_, index) => palette[index % palette.length],
    );

    return new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: distribution.labels,
        datasets: [
          {
            data: distribution.values,
            backgroundColor,
            borderColor: styles.getPropertyValue("--mantle").trim(),
            borderWidth: 2,
            hoverOffset: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        animation: {
          duration: 220,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label(context) {
                const value = context.raw;
                const suffix = value === 1 ? "book" : "books";
                return `${context.label}: ${value} ${suffix}`;
              },
            },
          },
        },
        onClick: clickable ? onClick : null,
      },
    });
  }

  function destroyCharts(charts) {
    while (charts.length) {
      const chart = charts.pop();
      chart.destroy();
    }
  }

  // ── Views ──

  let viewsSectionEl = null;
  let viewPickerAnchorEl = null;
  let viewPickerCloseHandler = null;

  function loadViews() {
    if (!window.go || !window.go.main) return;
    window.go.main.App.GetViews().then(function (views) {
      allViews = views || [];
      renderViewsSection();
      updateViewToFilterBtn();
      document.body.classList.toggle("no-views", allViews.length === 0);
      renderFiltered();
    });
  }

  function updateViewToFilterBtn() {
    if (!viewToFilterBtn) return;
    const hasContent = hasActiveFilters() || search.value.trim().length > 0;
    viewToFilterBtn.disabled = allViews.length === 0 || !hasContent;
  }

  function renderViewsSection() {
    if (viewsSectionEl && viewsSectionEl.parentNode) {
      viewsSectionEl.remove();
    }
    viewsSectionEl = buildViewsSection();
    if (viewsSectionEl) {
      nav.insertAdjacentElement("afterend", viewsSectionEl);
    }
  }

  function mergeViewBooks(viewId, paths) {
    const view = allViews.find(function (v) {
      return v.id === viewId;
    });
    if (!view) return null;
    view.bookPaths = Array.from(new Set((view.bookPaths || []).concat(paths)));
    renderViewsSection();
    renderFiltered();
    return view;
  }

  function buildViewsSection() {
    const section = document.createElement("div");
    section.className = "views-section";

    const header = document.createElement("div");
    header.className = "views-header";

    const headerLabel = document.createElement("span");
    headerLabel.textContent = "Views";

    const headerActions = document.createElement("span");
    headerActions.className = "views-header-actions";

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "view-action-btn";
    createBtn.title = "New view";
    createBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
    createBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      showCreateViewInput(itemsInner);
    });

    headerActions.appendChild(createBtn);
    header.appendChild(headerLabel);
    header.appendChild(headerActions);

    const items = document.createElement("div");
    items.className = "views-items";

    const itemsInner = document.createElement("div");
    itemsInner.className = "views-items-inner";

    allViews.forEach(function (view) {
      itemsInner.appendChild(buildViewItem(view));
    });

    items.appendChild(itemsInner);

    const resizer = document.createElement("div");
    resizer.id = "views-resizer";
    attachViewsResizerDrag(resizer);

    section.appendChild(header);
    section.appendChild(resizer);
    section.appendChild(items);

    return section;
  }

  function buildViewItem(view) {
    const item = document.createElement("div");
    item.className = "group-item view-item";
    item.dataset.viewId = view.id;

    const label = document.createElement("span");
    label.className = "view-item-label";
    label.textContent = view.name;

    const count = document.createElement("span");
    count.className = "group-item-count";
    count.textContent = String((view.bookPaths || []).length);

    item.appendChild(label);
    item.appendChild(count);

    item.addEventListener("click", function () {
      activeViewId = activeViewId === view.id ? "" : view.id;
      activeViewAddOpen = false;
      activeViewAddQuery = "";
      renderFiltered();
      updateViewButtons();
    });

    return item;
  }

  function showCreateViewInput(itemsInner) {
    if (itemsInner.querySelector(".view-create-container")) return;
    const container = document.createElement("div");
    container.className = "view-create-container";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "view-name-input";
    input.placeholder = "View name…";
    input.autocomplete = "off";
    input.autocorrect = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    container.appendChild(input);
    itemsInner.insertBefore(container, itemsInner.firstChild);
    input.focus();

    function confirm() {
      const name = input.value.trim();
      container.remove();
      if (!name) return;
      window.go.main.App.CreateView(name).then(function (view) {
        allViews.push(view);
        renderViewsSection();
        updateViewToFilterBtn();
        document.body.classList.remove("no-views");
        renderFiltered();
      });
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
      if (e.key === "Escape") {
        container.remove();
      }
    });
    input.addEventListener("blur", confirm);
  }

  function startRenameView(view, labelEl, deleteBtnEl) {
    if (labelEl.querySelector("input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "view-name-input view-name-input-inline";
    input.value = view.name;
    const originalText = labelEl.textContent;
    let cancelled = false;
    labelEl.textContent = "";
    labelEl.appendChild(input);
    if (deleteBtnEl) deleteBtnEl.style.display = "none";
    input.select();

    function confirm() {
      if (cancelled) return;
      const name = input.value.trim() || originalText;
      labelEl.textContent = name;
      if (deleteBtnEl) deleteBtnEl.style.display = "";
      if (name !== originalText) {
        view.name = name;
        renderViewsSection();
        renderFiltered();
        window.go.main.App.RenameView(view.id, name);
      }
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        cancelled = true;
        labelEl.textContent = originalText;
        if (deleteBtnEl) deleteBtnEl.style.display = "";
      }
    });
    input.addEventListener("blur", confirm);
  }

  function openViewPickerDropdown(anchorEl, onSelect) {
    if (
      viewPickerAnchorEl === anchorEl &&
      document.getElementById("view-picker-dropdown")
    ) {
      closeViewPickerDropdown();
      return;
    }
    closeViewPickerDropdown();
    if (allViews.length === 0) return;

    const dropdown = document.createElement("div");
    dropdown.id = "view-picker-dropdown";
    dropdown.className = "view-picker-dropdown";

    allViews.forEach(function (view) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "view-picker-item";
      item.textContent = view.name;
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        closeViewPickerDropdown();
        onSelect(view);
      });
      dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.top = rect.bottom + 4 + "px";
    dropdown.style.left = rect.left + "px";
    viewPickerAnchorEl = anchorEl;
    viewPickerCloseHandler = function (event) {
      if (dropdown.contains(event.target) || anchorEl.contains(event.target))
        return;
      closeViewPickerDropdown();
    };
    setTimeout(function () {
      document.addEventListener("mousedown", viewPickerCloseHandler);
    }, 0);
  }

  function closeViewPickerDropdown() {
    const el = document.getElementById("view-picker-dropdown");
    if (el) el.remove();
    if (viewPickerCloseHandler) {
      document.removeEventListener("mousedown", viewPickerCloseHandler);
      viewPickerCloseHandler = null;
    }
    viewPickerAnchorEl = null;
  }

  if (viewToFilterBtn) {
    viewToFilterBtn.addEventListener("click", function () {
      if (viewToFilterBtn.disabled) return;
      openViewPickerDropdown(viewToFilterBtn, function (view) {
        const paths = filterBooks().map(function (b) {
          return b.path;
        });
        if (paths.length === 0) return;
        window.go.main.App.AddBooksToView(view.id, paths).then(function () {
          mergeViewBooks(view.id, paths);
        });
      });
    });
  }

  function bookRow(book, options = {}) {
    const row = document.createElement("div");
    row.className = "book-row";
    row.dataset.path = book.path;

    const header = document.createElement("div");
    header.className = "book-row-header";

    const title = document.createElement("span");
    title.className = "book-row-title";
    title.textContent = book.title || "—";

    const chips = document.createElement("div");
    chips.className = "book-row-chips";

    if (book.language) {
      const chip = document.createElement("span");
      chip.className = "book-row-chip book-row-chip-language";
      chip.textContent = book.language;
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        applyFilter("language", book.language);
      });
      chips.appendChild(chip);
    }

    if (book.series) {
      const chip = document.createElement("span");
      chip.className = "book-row-chip book-row-chip-series";
      chip.textContent = book.series;
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        applyFilter("series", book.series);
      });
      chips.appendChild(chip);
    }

    (book.tags || []).forEach((tag) => {
      if (!tag) return;
      const chip = document.createElement("span");
      chip.className = "book-row-chip book-row-chip-tag";
      chip.textContent = tag;
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        applyFilter("tags", tag);
      });
      chips.appendChild(chip);
    });

    const author = document.createElement("span");
    author.className = "book-row-author";
    author.textContent = (book.authors || []).join(", ");

    let addBtn = null;
    if (!options.hideViewActions && allViews.length > 0) {
      addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "book-row-add-btn";
      addBtn.title = "Add to view";
      addBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
      addBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (options.addAction) {
          options.addAction(book);
          return;
        }
        openViewPickerDropdown(addBtn, function (view) {
          window.go.main.App.AddBooksToView(view.id, [book.path]).then(
            function () {
              mergeViewBooks(view.id, [book.path]);
            },
          );
        });
      });
    }

    if (options.viewId) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "book-row-remove-btn";
      removeBtn.title = "Remove from view";
      removeBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        window.go.main.App.RemoveBookFromView(options.viewId, book.path).then(
          function () {
            const v = allViews.find(function (v) {
              return v.id === options.viewId;
            });
            if (v) {
              v.bookPaths = (v.bookPaths || []).filter(function (p) {
                return p !== book.path;
              });
            }
            renderViewsSection();
            renderFiltered();
          },
        );
      });
      const titleWrap = document.createElement("div");
      titleWrap.className = "book-row-title-wrap";
      titleWrap.appendChild(title);
      titleWrap.appendChild(removeBtn);
      header.appendChild(titleWrap);
      header.appendChild(chips);
      header.appendChild(author);
    } else {
      const titleWrap = document.createElement("div");
      titleWrap.className = "book-row-title-wrap";
      titleWrap.appendChild(title);
      if (addBtn) titleWrap.appendChild(addBtn);
      header.appendChild(titleWrap);
      header.appendChild(chips);
      header.appendChild(author);
    }

    const preview = document.createElement("div");
    preview.className = "book-row-preview";

    const inner = document.createElement("div");
    inner.className = "book-row-preview-inner";

    const metaPanel = document.createElement("div");
    metaPanel.className = "book-row-meta-panel";

    [
      { label: "Language", value: book.language || "" },
      { label: "Series", value: book.series || "" },
      { label: "Tags", value: (book.tags || []).join(", ") },
    ].forEach(({ label, value }) => {
      if (!value) return;
      const metaRow = document.createElement("div");
      metaRow.className = "book-row-meta-row";
      const metaLabel = document.createElement("span");
      metaLabel.className = "book-row-meta-label";
      metaLabel.textContent = label;
      const metaValue = document.createElement("span");
      metaValue.className = "book-row-meta-value";
      metaValue.textContent = value;
      metaRow.appendChild(metaLabel);
      metaRow.appendChild(metaValue);
      metaPanel.appendChild(metaRow);
    });

    inner.appendChild(metaPanel);
    preview.appendChild(inner);
    row.appendChild(header);
    row.appendChild(preview);

    row.classList.add("book-row-static");

    row.addEventListener("click", () => {
      if (options.disableOpen) {
        return;
      }
      if (options.onOpen) {
        options.onOpen(book);
        return;
      }
      openReader(book);
    });

    return row;
  }
})();
