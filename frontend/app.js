(function () {
  let allBooks = [];
  let navGroups = groupValues(() => []);
  let navCounts = groupValues(() => ({}));
  let activeFilters = createEmptyFilters();
  let currentView = "library";
  let statsCharts = [];
  let isDrilldownSuspended = false;
  let currentDrilldown = null;
  let drilldownBaseFilters = null;
  let readerOverlayLoading = false;

  const navRefs = groupValues(() => new Map());
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
  const readerOverlay = document.getElementById("reader-overlay");
  const readerOverlayFrame = document.getElementById("reader-overlay-frame");
  const statsBtnStatsIcon = Icons.stats;

  function groupLabel(key) {
    return t("groups." + key);
  }
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
  const SIDEBAR_WIDTH_KEY = Settings.sidebarWidthKey;
  const SIDEBAR_LAST_KEY = Settings.sidebarLastKey;
  const SIDEBAR_MIN = parseFloat(settingValue("--sidebar-width-min"));
  const SIDEBAR_MAX = parseFloat(settingValue("--sidebar-width-max"));
  const SIDEBAR_COLLAPSED = parseFloat(
    settingValue("--sidebar-width-collapsed"),
  );
  const SIDEBAR_DEFAULT = parseFloat(settingValue("--sidebar-width-default"));
  const UI_FONT_SIZE_DEFAULT = parseFloat(
    settingValue("--ui-font-size-default"),
  );
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
  let searchScope = "all";
  const SEARCH_SCOPE_VALUES = [
    "all",
    "title",
    "authors",
    "series",
    "tags",
    "language",
  ];
  function searchScopes() {
    return SEARCH_SCOPE_VALUES.map(function (v) {
      return { value: v, label: t("scopes." + v) };
    });
  }

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
        width === SIDEBAR_COLLAPSED
          ? t("sidebar.expand")
          : t("sidebar.collapse"),
      );
    }
  }

  function initSidebarResize() {
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
    if (saved > 0) applySidebarWidth(saved);
    if (!sidebarResizer || settingValue("--sidebar-resize-enabled") === "0")
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
      const startWidth =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--sidebar-w",
          ),
        ) || SIDEBAR_DEFAULT;
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

  function loadLibrary() {
    fetch(Settings.routes.library)
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
    renderLibraryDirectoryState("", "", t("library.chooseFolder"));
  }

  function showEmptyLibrary() {
    renderLibraryDirectoryState(
      t("library.noBooksTitle"),
      t("library.noBooksDetail"),
      t("library.chooseAnother"),
    );
  }

  function renderLibraryDirectoryState(title, detail, buttonLabel) {
    nav.innerHTML = "";
    list.innerHTML =
      '<div class="empty">' +
      (title ? "<div>" + title + "</div>" : "") +
      (detail
        ? '<div style="margin-top:var(--empty-detail-gap);color:var(--subtext0);font-size:var(--fs-sm)">' +
          detail +
          "</div>"
        : "") +
      '<button id="pick-dir" type="button" style="' +
      (title || detail ? "margin-top:var(--empty-action-gap);" : "") +
      "background:var(--surface0);border:var(--empty-action-border-width) solid var(--surface1);border-radius:var(--empty-action-radius);" +
      "color:var(--blue);font-family:var(--font-serif);font-size:var(--fs-md);" +
      'padding:var(--empty-action-padding-y) var(--empty-action-padding-x);cursor:pointer">' +
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
    navGroups = groupValues(() => []);
    navCounts = groupValues(() => ({}));
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
      '<div class="scan-loading"><div class="scan-loading-spinner" aria-hidden="true"></div><div class="scan-loading-title">' +
      t("library.scanning") +
      '</div><div class="scan-loading-meta">' +
      (scanBookCount > 0
        ? t("library.booksIndexed", { count: scanBookCount })
        : t("library.mayTakeAMoment")) +
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
          ? t("library.refreshingCount", { count: scanBookCount })
          : t("library.refreshing")
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
    }, Settings.scanShowDelay);
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
      const remaining =
        Settings.scanMinimumDuration - (Date.now() - scanVisibleAt);
      if (remaining > 0) {
        scanHideTimer = setTimeout(finalizeScanUI, remaining);
        return;
      }
    }
    finalizeScanUI();
  }

  if (window.runtime && typeof window.runtime.EventsOn === "function") {
    window.runtime.EventsOn(Settings.events.bookAdded, function (book) {
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
      }, Settings.bookRenderDelay);
    });

    window.runtime.EventsOn(Settings.events.scanDone, function (lib) {
      clearTimeout(bookAddTimer);
      bookAddTimer = null;
      startupScanPending = false;
      endScanUI();
      applyLibraryData(lib && lib.books ? lib.books : []);
    });
  }

  function localizeDOM() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key.startsWith("[")) {
        var match = key.match(/^\[([^\]]+)\](.+)$/);
        if (match) el.setAttribute(match[1], t(match[2]));
      } else {
        el.textContent = t(key);
      }
    });
  }

  document.querySelectorAll(".app-lang-btn").forEach(function (btn) {
    var lang = btn.getAttribute("data-lang");
    if (i18next.language === lang) btn.classList.add("is-active");
    btn.addEventListener("click", function () {
      window.setLanguage(lang);
    });
  });

  localizeDOM();

  loadLibrary();
  initSidebarResize();

  // ── Preferences ──
  const prefsBackdrop = document.getElementById("prefs-backdrop");
  const prefsClose = document.getElementById("prefs-close");
  const prefsLibraryDir = document.getElementById("prefs-library-dir");
  const prefsPickDir = document.getElementById("prefs-pick-dir");
  const prefsFontFamily = document.getElementById("prefs-font-family");
  const prefsFontSize = document.getElementById("prefs-font-size");
  configureRange(prefsFontSize, Settings.uiFontRange);
  const prefsFontSizeVal = document.getElementById("prefs-font-size-val");
  const prefsSave = document.getElementById("prefs-save");
  const helpBackdrop = document.getElementById("help-backdrop");
  const helpClose = document.getElementById("help-close");
  const appVersionValue = document.getElementById("app-version-value");
  const appHelpRow = document.getElementById("app-help-row");

  function applyUIConfig(cfg) {
    const root = document.documentElement;
    if (cfg.uiFontSize && cfg.uiFontSize > 0) {
      applyFontScale(cfg.uiFontSize);
    }
    if (cfg.uiFontFamily) {
      applyFontFamily(cfg.uiFontFamily);
    }
    if ("theme" in cfg || !root.hasAttribute("data-theme")) {
      root.setAttribute("data-theme", cfg.theme || Settings.defaultTheme);
    }
    if (searchScopeEl) syncScopeWrapWidth();
  }

  function syncScopeWrapWidth() {
    searchScopeMenu.style.width = "max-content";
    searchScopeMenu.style.right = "auto";
    var w = searchScopeMenu.offsetWidth;
    searchScopeMenu.style.width = "";
    searchScopeMenu.style.right = "";
    searchScopeWrap.style.width = w + "px";
  }

  function openPreferences() {
    prefsBackdrop.classList.remove("hidden");
    window.go.main.App.GetConfig().then(function (cfg) {
      prefsLibraryDir.value = cfg.libraryDir || "";
      prefsFontSize.value = cfg.uiFontSize || UI_FONT_SIZE_DEFAULT;
      prefsFontSizeVal.textContent =
        (cfg.uiFontSize || UI_FONT_SIZE_DEFAULT) + "px";
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
          return;
        }
        endScanUI();
        applyLibraryData([]);
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
  configureRange(appFontSlider, Settings.uiFontRange);
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
    }, Settings.menuHideDelay);
  }

  appMenuToggle.addEventListener("mouseenter", showAppMenu);
  appMenuToggle.addEventListener("mouseleave", scheduleHideAppMenu);
  appMenuPanel.addEventListener("mouseenter", function () {
    clearTimeout(appMenuHideTimer);
  });
  appMenuPanel.addEventListener("mouseleave", scheduleHideAppMenu);

  function updateAppFontFamilyButton(value) {
    appFontFamily.textContent = value || t("prefs.systemDefault");
    appFontFamily.dataset.value = value || "";
  }

  var APP_THEMES = Settings.themes;

  function updateAppThemeButton(value) {
    var item = APP_THEMES.find(function (t) {
      return t.value === (value || Settings.defaultTheme);
    });
    appTheme.textContent = (
      item ||
      APP_THEMES.find(function (theme) {
        return theme.value === Settings.defaultTheme;
      })
    ).label;
    appTheme.dataset.value = value || Settings.defaultTheme;
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
      const active = choice.dataset.value === (value || Settings.defaultTheme);
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
    [{ value: "", label: t("prefs.systemDefault") }]
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
    var normalizedSelected = selected || Settings.defaultTheme;
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
    searchScopeEl.textContent = t("scopes." + (value || "all"));
  }

  function searchPlaceholderForScope(value) {
    var normalizedValue = value || "all";
    return normalizedValue === "all"
      ? t("search.placeholder")
      : t("search.placeholderScoped", {
          scope: t("scopes." + normalizedValue),
        });
  }

  function updateSearchPlaceholder(value) {
    search.placeholder = searchPlaceholderForScope(value);
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
    searchScopes().forEach(function (item) {
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
        });
      })
      .catch(function () {
        endScanUI();
      });
  });

  appFontSlider.addEventListener("input", function () {
    const size = parseInt(appFontSlider.value);
    appFontVal.textContent = size + "px";
  });

  function commitUIFontSize(size) {
    appFontSlider.value = size;
    appFontVal.textContent = size + "px";
    applyUIConfig({ uiFontSize: size });
    const cfg = Object.assign({}, currentCfg, { uiFontSize: size });
    currentCfg = cfg;
    window.go.main.App.SaveConfig(cfg);
  }

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
    commitUIFontSize(parseInt(appFontSlider.value));
  });

  document.addEventListener("keydown", function (event) {
    if (!event.ctrlKey) return;
    let direction = 0;
    if (event.key === "+" || event.key === "=") direction = 1;
    if (event.key === "-") direction = -1;
    if (!direction) return;
    event.preventDefault();
    const currentSize = parseInt(appFontSlider.value);
    const nextSize = Math.min(
      Settings.uiFontRange.max,
      Math.max(
        Settings.uiFontRange.min,
        currentSize + direction * Settings.uiFontRange.step,
      ),
    );
    if (nextSize !== currentSize) commitUIFontSize(nextSize);
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
    const size = cfg.uiFontSize || UI_FONT_SIZE_DEFAULT;
    appFontSlider.value = size;
    appFontVal.textContent = size + "px";
    renderAppThemeChoices(cfg.theme || Settings.defaultTheme);
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
  });

  (function initContinueReading() {
    continueReading.disabled = true;
    try {
      var data = JSON.parse(localStorage.getItem(Settings.lastReadKey));
      if (data && data.path) {
        continueReading.title = t("books.continueReading", {
          title: data.title || "",
        });
        continueReading.disabled = false;
        continueReading.addEventListener("click", function () {
          openReaderURL(
            Settings.routes.read +
              data.path +
              "?chapter=" +
              (data.chapter || 0),
          );
        });
      }
    } catch (e) {}
  })();

  search.addEventListener("input", () => {
    searchClear.classList.toggle("visible", search.value.length > 0);
    renderFiltered();
    updateViewButtons();
  });

  if (searchScopeEl) {
    renderSearchScopeChoices(searchScope);
    syncScopeWrapWidth();
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
    setView("stats");
  });
  updateViewButtons();
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
    return groupValues(() => new Set());
  }

  function cloneFilters(filters) {
    return groupValues((key) => new Set(filters[key]));
  }

  function buildGroupData(books) {
    const groups = groupValues(() => new Set());
    const counts = groupValues(() => ({}));

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
      groups: groupValues((key) => Array.from(groups[key]).sort(sortFn)),
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
    search.value = "";
    searchClear.classList.remove("visible");
    updateNavState();
    renderFiltered();
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
      !hasActiveFilters() &&
      search.value.trim() === "";
    libraryBtn.classList.toggle("current", cleanLibrary);
    statsBtn.classList.toggle("current", currentView === "stats");
    statsBtn.dataset.tooltip = "stats";
    statsBtn.setAttribute("aria-label", t("tooltip.stats"));
    statsBtn.innerHTML = statsBtnStatsIcon;
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

  function openReaderURL(url) {
    if (!readerOverlay || !readerOverlayFrame) {
      window.location.href = url;
      return;
    }
    readerOverlayLoading = true;
    readerOverlayFrame.src = url;
  }

  function openReader(book) {
    openReaderURL(
      `${Settings.routes.read}${encodeBookPath(book.path)}?chapter=0`,
    );
  }

  readerOverlayFrame.addEventListener("load", function () {
    if (!readerOverlayLoading) return;
    readerOverlayLoading = false;
    readerOverlay.classList.add("visible");
    readerOverlayFrame.contentWindow.focus();
  });

  window.closeReader = function () {
    readerOverlay.classList.remove("visible");
    readerOverlayFrame.src = "about:blank";
    window.focus();
  };

  function renderDrilldownContent(sourceType, value, books) {
    const filteredBooks = sourceType
      ? books.filter((book) => matchFilter(book, sourceType, value))
      : books;
    renderDrilldownTitle(sourceType, value, filteredBooks.length);
    drilldownBody.innerHTML = "";

    if (!filteredBooks.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("books.noBooks");
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
    allEl.innerHTML = `<span>${t("nav.allBooks")}</span><span class="group-item-count">${allBooks.length}</span>`;
    allEl.addEventListener("click", clearFilters);
    nav.appendChild(allEl);
    sectionRefs.set("all", allEl);

    Settings.navigationGroups.forEach((key) => {
      const values = navGroups[key];
      if (!values || values.length === 0) return;

      const section = document.createElement("div");
      section.className = "group-section";

      const header = document.createElement("div");
      header.className = "group-header";
      header.innerHTML = `<span>${groupLabel(key)}</span><span class="group-chevron">&#9654;</span>`;
      header.addEventListener("click", () => section.classList.toggle("open"));

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

    Settings.navigationGroups.forEach((type) => {
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

    Settings.groups.forEach((type) => {
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
    return allBooks.filter((book) => {
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
    if (filtered.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.textContent = t("books.noBooks");
      list.appendChild(emptyEl);
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach((book) => {
      frag.appendChild(bookRow(book));
    });
    list.appendChild(frag);
  }

  function renderStatsView(books) {
    destroyCharts(statsCharts);
    stats.innerHTML = "";

    if (books.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.textContent = t("books.noBooks");
      stats.appendChild(emptyEl);
      return;
    }

    ["tags", "series", "language"].forEach((type) => {
      const card = document.createElement("section");
      card.className = "stats-card";
      card.innerHTML = `<div class="stats-card-label">${groupLabel(type)}</div>`;

      const distribution = buildDistribution(books, type);
      if (distribution.labels.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "empty";
        emptyEl.textContent = t("books.noData");
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
            borderWidth: Settings.chartBorderWidth,
            hoverOffset: Settings.chartHoverOffset,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: Settings.chartCutout,
        animation: {
          duration: Settings.chartAnimationDuration,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            titleFont: function () {
              return {
                size: parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    "--fs-base",
                  ),
                ),
              };
            },
            bodyFont: function () {
              return {
                size: parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    "--fs-base",
                  ),
                ),
              };
            },
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

    const titleWrap = document.createElement("div");
    titleWrap.className = "book-row-title-wrap";
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    header.appendChild(chips);
    header.appendChild(author);

    const preview = document.createElement("div");
    preview.className = "book-row-preview";

    const inner = document.createElement("div");
    inner.className = "book-row-preview-inner";

    const metaPanel = document.createElement("div");
    metaPanel.className = "book-row-meta-panel";

    [
      { label: t("meta.language"), value: book.language || "" },
      { label: t("meta.series"), value: book.series || "" },
      { label: t("meta.tags"), value: (book.tags || []).join(", ") },
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
