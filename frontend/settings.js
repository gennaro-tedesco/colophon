const Settings = Object.freeze({
  defaultTheme: Contract.defaultTheme,
  routes: Object.freeze(Contract.routes),
  events: Object.freeze(Contract.events),
  themes: Object.freeze(Contract.themes),
  groups: Object.freeze(
    Contract.groups.map(function (group) {
      return group.key;
    }),
  ),
  navigationGroups: Object.freeze(
    Contract.groups
      .slice()
      .sort(function (a, b) {
        return a.navigationOrder - b.navigationOrder;
      })
      .map(function (group) {
        return group.key;
      }),
  ),
  defaultLanguage: "en",
  languageKey: "colophon-lang",
  readerStoragePrefix: Contract.readerStoragePrefix,
  readerSearchScopeSuffix: "search-scope:",
  readerSearchStateSuffix: "search-state:",
  readerTocSuffix: "toc:",
  readerDefaults: Object.freeze(Contract.readerDefaults),
  readerProperties: Object.freeze({
    "--reader-bg": "bg",
    "--reader-fg": "fg",
    "--reader-size": "size",
    "--reader-pad-x": "px",
  }),
  readerStaticProperties: Object.freeze([
    "--reader-selection",
    "--reader-padding-top",
    "--reader-padding-bottom",
    "--reader-min-height",
  ]),
  sidebarWidthKey: "sidebar:width",
  sidebarLastKey: "sidebar:last-width",
  viewsHeightKey: "views:height",
  scanShowDelay: 400,
  scanMinimumDuration: 500,
  bookRenderDelay: 80,
  menuHideDelay: 300,
  navigationGroupOpenDelay: 300,
  shortcutSequenceDelay: 450,
  searchOpenDelay: 150,
  readerScrollStep: 96,
  fontScale: Object.freeze(["xs", "sm", "base", "md", "lg"]),
  lastReadKey: "lastRead",
  uiFontRange: Object.freeze({ min: 14, max: 28, step: 1 }),
  readerLineHeightRange: Object.freeze({ min: 1.2, max: 2.4, step: 0.1 }),
  readerFontRange: Object.freeze({ min: 20, max: 48, step: 1 }),
  readerPaddingRange: Object.freeze({ min: 32, max: 160, step: 4 }),
  readerProgressDelay: 150,
  readerTocHoverDelay: 500,
  readerNavBandMax: 160,
  readerNavBandRatio: 0.3,
  chartBorderWidth: 2,
  chartHoverOffset: 10,
  chartCutout: "62%",
  chartAnimationDuration: 220,
  dropdownGap: 4,
  floatingMenuLayer: 9999,
});

window.Settings = Settings;

function groupValues(factory) {
  return Object.fromEntries(
    Settings.groups.map(function (key) {
      return [key, factory(key)];
    }),
  );
}

function configureRange(input, range) {
  Object.assign(input, range);
}

function readerStorageKey(name) {
  return Settings.readerStoragePrefix + name;
}

function readerPreference(name) {
  return (
    localStorage.getItem(readerStorageKey(name)) ||
    settingValue(Settings.readerDefaults[name])
  );
}

let rootComputedStyle = null;

function settingValue(name) {
  if (!rootComputedStyle) {
    rootComputedStyle = getComputedStyle(document.documentElement);
  }
  return rootComputedStyle.getPropertyValue(name).trim();
}

function applyFontScale(size) {
  Settings.fontScale.forEach(function (name) {
    const ratio = parseFloat(settingValue("--font-scale-" + name));
    document.documentElement.style.setProperty(
      "--fs-" + name,
      Math.round(size * ratio) + "px",
    );
  });
}

function applyFontFamily(family) {
  document.documentElement.style.setProperty(
    "--font-sans",
    "'" + family + "', " + settingValue("--font-sans-fallback"),
  );
  document.documentElement.style.setProperty(
    "--font-serif",
    "'" + family + "', " + settingValue("--font-serif-fallback"),
  );
}
