(function() {
	let allBooks = [];
	let navGroups = { language: [], series: [], tags: [], author: [] };
	let navCounts = { language: {}, series: {}, tags: {}, author: {} };
	let activeFilters = createEmptyFilters();
	let currentView = 'library';
	let statsCharts = [];
	let isDrilldownSuspended = false;
	let currentDrilldown = null;
	let drilldownBaseFilters = null;

	const navRefs = { language: new Map(), series: new Map(), tags: new Map(), author: new Map() };
	const sectionRefs = new Map();

	const nav = document.getElementById('nav');
	const list = document.getElementById('list');
	const stats = document.getElementById('stats');
	const logo = document.querySelector('.logo');
	const search = document.getElementById('search');
	const searchClear = document.getElementById('search-clear');
	const activeFiltersEl = document.getElementById('active-filters');
	const count = document.getElementById('count');
	const viewToggle = document.getElementById('view-toggle');
	const sidebarResizer = document.getElementById('sidebar-resizer');
	const sidebarToggle = document.getElementById('sidebar-toggle');
	const drilldownBackdrop = document.getElementById('drilldown-backdrop');
	const drilldownTitle = document.getElementById('drilldown-title');
	const drilldownBody = document.getElementById('drilldown-body');
	const drilldownClose = document.getElementById('drilldown-close');
	const continueReading = document.getElementById('continue-reading');

	const GROUP_LABELS = { language: 'Language', series: 'Series', tags: 'Tags', author: 'Author' };
	const CHART_PALETTE_VARS = ['--blue', '--lavender', '--teal', '--yellow', '--pink', '--peach', '--green', '--sky', '--rosewater', '--flamingo', '--sapphire', '--red', '--maroon'];
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
		if (!sidebarResizer || window.matchMedia('(max-width: 720px)').matches) return;
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

	function loadLibrary() {
		fetch('/api/library')
			.then(r => {
				if (!r.ok) throw new Error(r.status);
				return r.json();
			})
			.then(lib => {
				allBooks = lib.books || [];
				if (allBooks.length === 0) {
					showPickDirectory();
					return;
				}
				const data = buildGroupData(allBooks);
				navGroups = data.groups;
				navCounts = data.counts;
				renderNav();
				renderFiltered();
			})
			.catch(() => {
				showPickDirectory();
			});
	}

	function showPickDirectory() {
		nav.innerHTML = '';
		list.innerHTML = '<div class="empty"><button id="pick-dir" type="button" style="' +
			'background:var(--surface0);border:1px solid var(--surface1);border-radius:6px;' +
			'color:var(--blue);font-family:var(--font-serif);font-size:var(--fs-md);' +
			'padding:10px 24px;cursor:pointer">' +
			'Choose library folder</button></div>';
		document.getElementById('pick-dir').addEventListener('click', function() {
			window.go.main.App.PickAndScan().then(function(lib) {
				allBooks = lib.books || [];
				if (allBooks.length === 0) return;
				const data = buildGroupData(allBooks);
				navGroups = data.groups;
				navCounts = data.counts;
				renderNav();
				renderFiltered();
			});
		});
	}

	let bookAddTimer = null;

	if (window.runtime && typeof window.runtime.EventsOn === 'function') {
		window.runtime.EventsOn('book:add', function(book) {
			const idx = allBooks.findIndex(function(b) { return b.path === book.path; });
			if (idx >= 0) {
				allBooks[idx] = book;
			} else {
				allBooks.push(book);
			}
			clearTimeout(bookAddTimer);
			bookAddTimer = setTimeout(function() {
				const data = buildGroupData(allBooks);
				navGroups = data.groups;
				navCounts = data.counts;
				renderNav();
				renderFiltered();
			}, 80);
		});

		window.runtime.EventsOn('scan:done', function(lib) {
			clearTimeout(bookAddTimer);
			bookAddTimer = null;
			allBooks = (lib && lib.books) ? lib.books : [];
			if (allBooks.length > 0) {
				const data = buildGroupData(allBooks);
				navGroups = data.groups;
				navCounts = data.counts;
				renderNav();
				renderFiltered();
			} else {
				navGroups = { language: [], series: [], tags: [], author: [] };
				navCounts = { language: {}, series: {}, tags: {}, author: {} };
				showPickDirectory();
			}
		});
	}

	loadLibrary();
	initSidebarResize();

	// ── Preferences ──
	const prefsBackdrop = document.getElementById('prefs-backdrop');
	const prefsClose = document.getElementById('prefs-close');
	const prefsLibraryDir = document.getElementById('prefs-library-dir');
	const prefsPickDir = document.getElementById('prefs-pick-dir');
	const prefsFontFamily = document.getElementById('prefs-font-family');
	const prefsFontSize = document.getElementById('prefs-font-size');
	const prefsFontSizeVal = document.getElementById('prefs-font-size-val');
	const prefsSave = document.getElementById('prefs-save');

	function applyUIConfig(cfg) {
		const root = document.documentElement;
		if (cfg.uiFontSize && cfg.uiFontSize > 0) {
			const base = cfg.uiFontSize;
			root.style.setProperty('--fs-xs',   Math.round(base * 0.75) + 'px');
			root.style.setProperty('--fs-sm',   Math.round(base * 0.9) + 'px');
			root.style.setProperty('--fs-base', base + 'px');
			root.style.setProperty('--fs-md',   Math.round(base * 1.15) + 'px');
			root.style.setProperty('--fs-lg',   Math.round(base * 1.65) + 'px');
		}
		if (cfg.uiFontFamily) {
			root.style.setProperty('--font-sans', "'" + cfg.uiFontFamily + "', system-ui, sans-serif");
			root.style.setProperty('--font-serif', "'" + cfg.uiFontFamily + "', sans-serif");
		}
	}

	function openPreferences() {
		prefsBackdrop.classList.remove('hidden');
		window.go.main.App.GetConfig().then(function(cfg) {
			prefsLibraryDir.value = cfg.libraryDir || '';
			prefsFontSize.value = cfg.uiFontSize || 20;
			prefsFontSizeVal.textContent = (cfg.uiFontSize || 20) + 'px';
			prefsFontFamily.value = cfg.uiFontFamily || '';
		});
		window.go.main.App.ListFonts().then(function(fonts) {
			while (prefsFontFamily.options.length > 1) prefsFontFamily.remove(1);
			fonts.forEach(function(f) {
				var opt = document.createElement('option');
				opt.value = f;
				opt.textContent = f;
				prefsFontFamily.appendChild(opt);
			});
		});
	}

	document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openPreferences(); } });
	prefsClose.addEventListener('click', () => prefsBackdrop.classList.add('hidden'));
	prefsBackdrop.addEventListener('click', e => { if (e.target === prefsBackdrop) prefsBackdrop.classList.add('hidden'); });
	prefsFontSize.addEventListener('input', () => { prefsFontSizeVal.textContent = prefsFontSize.value + 'px'; });
	prefsPickDir.addEventListener('click', () => {
		window.go.main.App.PickAndScan().then(function(lib) {
			prefsLibraryDir.value = lib.libraryDir || prefsLibraryDir.value;
			window.go.main.App.GetConfig().then(cfg => { prefsLibraryDir.value = cfg.libraryDir || ''; });
			if (lib.books && lib.books.length > 0) {
				allBooks = lib.books;
				const data = buildGroupData(allBooks);
				navGroups = data.groups;
				navCounts = data.counts;
				renderNav();
				renderFiltered();
			}
		});
	});
	let currentCfg = {};

	prefsSave.addEventListener('click', () => {
		const cfg = Object.assign({}, currentCfg, {
			libraryDir:   prefsLibraryDir.value,
			uiFontFamily: prefsFontFamily.value,
			uiFontSize:   parseInt(prefsFontSize.value, 10),
		});
		window.go.main.App.SaveConfig(cfg).then(function() {
			currentCfg = cfg;
			applyUIConfig(cfg);
			prefsBackdrop.classList.add('hidden');
			if (cfg.libraryDir) loadLibrary();
		});
	});

	window.openPreferences = openPreferences;
	if (new URLSearchParams(location.search).has('openPrefs')) { openPreferences(); }

	// ── App settings menu ──
	let appMenuHideTimer = null;

	const appMenuToggle = document.getElementById('app-menu-toggle');
	const appMenuPanel = document.getElementById('app-menu-panel');
	const appDirName = document.getElementById('app-dir-name');
	const appDirPick = document.getElementById('app-dir-pick');
	const appFontFamily = document.getElementById('app-font-family');
	const appFontSlider = document.getElementById('app-font-slider');
	const appFontVal = document.getElementById('app-font-val');

	function showAppMenu() {
		clearTimeout(appMenuHideTimer);
		appMenuToggle.classList.add('open');
		appMenuPanel.classList.add('open');
	}

	function scheduleHideAppMenu() {
		clearTimeout(appMenuHideTimer);
		appMenuHideTimer = setTimeout(function() {
			appMenuToggle.classList.remove('open');
			appMenuPanel.classList.remove('open');
		}, 300);
	}

	appMenuToggle.addEventListener('mouseenter', showAppMenu);
	appMenuToggle.addEventListener('mouseleave', scheduleHideAppMenu);
	appMenuPanel.addEventListener('mouseenter', function() { clearTimeout(appMenuHideTimer); });
	appMenuPanel.addEventListener('mouseleave', scheduleHideAppMenu);

	appDirPick.addEventListener('click', function() {
		window.go.main.App.PickAndScan().then(function(lib) {
			window.go.main.App.GetConfig().then(function(cfg) {
				currentCfg = cfg;
				appDirName.textContent = cfg.libraryDir || '—';
				if (lib.books && lib.books.length > 0) {
					allBooks = lib.books;
					const data = buildGroupData(allBooks);
					navGroups = data.groups;
					navCounts = data.counts;
					renderNav();
					renderFiltered();
				}
			});
		});
	});

	appFontSlider.addEventListener('input', function() {
		const size = parseInt(appFontSlider.value);
		appFontVal.textContent = size + 'px';
		applyUIConfig({ uiFontSize: size });
	});

	appFontFamily.addEventListener('change', function() {
		const cfg = Object.assign({}, currentCfg, { uiFontFamily: appFontFamily.value });
		currentCfg = cfg;
		applyUIConfig(cfg);
		window.go.main.App.SaveConfig(cfg);
	});

	appFontSlider.addEventListener('change', function() {
		const cfg = Object.assign({}, currentCfg, { uiFontSize: parseInt(appFontSlider.value) });
		currentCfg = cfg;
		window.go.main.App.SaveConfig(cfg);
	});

	function initAppMenu(cfg) {
		appDirName.textContent = cfg.libraryDir || '—';
		const size = cfg.uiFontSize || 20;
		appFontSlider.value = size;
		appFontVal.textContent = size + 'px';
		window.go.main.App.ListFonts().then(function(fonts) {
			while (appFontFamily.options.length > 1) appFontFamily.remove(1);
			fonts.forEach(function(f) {
				const opt = document.createElement('option');
				opt.value = f;
				opt.textContent = f;
				appFontFamily.appendChild(opt);
			});
			appFontFamily.value = cfg.uiFontFamily || '';
		});
	}

	window.go.main.App.GetConfig().then(function(cfg) {
		currentCfg = cfg;
		applyUIConfig(cfg);
		initAppMenu(cfg);
	});

	(function initContinueReading() {
		try {
			var data = JSON.parse(localStorage.getItem('lastRead'));
			if (data && data.path) {
				continueReading.title = 'Continue reading: ' + (data.title || '');
				continueReading.style.display = '';
				continueReading.addEventListener('click', function() {
					window.location.href = '/read/' + data.path + '?chapter=' + (data.chapter || 0);
				});
			}
		} catch (e) {}
	})();

	search.addEventListener('input', () => {
		searchClear.classList.toggle('visible', search.value.length > 0);
		renderFiltered();
	});

	searchClear.addEventListener('click', () => {
		search.value = '';
		searchClear.classList.remove('visible');
		search.focus();
		renderFiltered();
	});

	viewToggle.addEventListener('click', toggleView);
	logo.addEventListener('click', clearFilters);
	drilldownClose.addEventListener('click', closeDrilldownModal);
	drilldownBackdrop.addEventListener('click', event => {
		if (event.target === drilldownBackdrop) closeDrilldownModal();
	});
	document.addEventListener('keydown', event => {
		if (event.key !== 'Escape') return;
		if (drilldownBackdrop.classList.contains('open')) {
			closeDrilldownModal();
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
		const groups = { language: new Set(), series: new Set(), tags: new Set(), author: new Set() };
		const counts = { language: {}, series: {}, tags: {}, author: {} };

		books.forEach(book => {
			if (book.language) {
				groups.language.add(book.language);
				counts.language[book.language] = (counts.language[book.language] || 0) + 1;
			}
			if (book.series) {
				groups.series.add(book.series);
				counts.series[book.series] = (counts.series[book.series] || 0) + 1;
			}
			(book.tags || []).forEach(tag => {
				groups.tags.add(tag);
				counts.tags[tag] = (counts.tags[tag] || 0) + 1;
			});
			(book.authors || []).forEach(author => {
				groups.author.add(author);
				counts.author[author] = (counts.author[author] || 0) + 1;
			});
		});

		const sortFn = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
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
		return Object.values(activeFilters).some(values => values.size > 0);
	}

	function hasActiveFilterGroup(type) {
		return activeFilters[type].size > 0;
	}

	function isFilterActive(type, value) {
		return activeFilters[type].has(value);
	}

	function clearFilters() {
		activeFilters = createEmptyFilters();
		search.value = '';
		searchClear.classList.remove('visible');
		updateNavState();
		renderFiltered();
	}

	function applyFilter(type, value) {
		if (activeFilters[type].has(value)) {
			activeFilters[type].delete(value);
		} else {
			activeFilters[type].add(value);
		}
		updateNavState();
		renderFiltered();
	}

	function toggleView() {
		if (currentView === 'library') {
			currentView = 'stats';
			viewToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>';
			list.classList.add('hidden');
			stats.classList.remove('hidden');
			renderStatsView(filterBooks());
			return;
		}

		currentView = 'library';
		viewToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/></svg>';
		closeDrilldownModal();
		destroyCharts(statsCharts);
		stats.innerHTML = '';
		stats.classList.add('hidden');
		list.classList.remove('hidden');
		renderFiltered();
	}

	function closeDrilldownModal() {
		if (drilldownBaseFilters) {
			activeFilters = cloneFilters(drilldownBaseFilters);
			drilldownBaseFilters = null;
			updateNavState();
		}
		isDrilldownSuspended = false;
		currentDrilldown = null;
		drilldownBackdrop.classList.remove('hidden');
		drilldownBackdrop.classList.remove('open');
		drilldownBody.innerHTML = '';
		renderFiltered();
	}

	function suspendDrilldownModal() {
		if (!drilldownBackdrop.classList.contains('open')) return;
		isDrilldownSuspended = true;
		drilldownBackdrop.classList.add('hidden');
	}

	function resumeDrilldownModal() {
		isDrilldownSuspended = false;
		drilldownBackdrop.classList.remove('hidden');
	}

	function encodeBookPath(path) {
		return (path || '').split('/').map(encodeURIComponent).join('/');
	}

	function openReader(book) {
		window.location.href = `/read/${encodeBookPath(book.path)}?chapter=0`;
	}

	function renderDrilldownContent(sourceType, value, books) {
		const filteredBooks = sourceType ? books.filter(book => matchFilter(book, sourceType, value)) : books;
		renderDrilldownTitle(sourceType, value, filteredBooks.length);
		drilldownBody.innerHTML = '';

		if (!filteredBooks.length) {
			const empty = document.createElement('div');
			empty.className = 'empty';
			empty.textContent = 'no books found';
			drilldownBody.appendChild(empty);
		} else {
			const results = document.createElement('div');
			results.className = 'drilldown-results';
				filteredBooks.forEach(book => {
					results.appendChild(bookRow(book, {
						disablePreview: true,
						onOpen() {
							suspendDrilldownModal();
							openReader(book);
						},
					}));
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
		drilldownBackdrop.classList.remove('hidden');
		renderDrilldownContent(sourceType, value, books);

		drilldownBackdrop.classList.add('open');
	}

	function renderDrilldownTitle(sourceType, value, countValue) {
		drilldownTitle.innerHTML = '';

		const filtersWrap = document.createElement('div');
		filtersWrap.className = 'drilldown-title-filters';

		const seen = new Set();
		if (sourceType && value) {
			filtersWrap.appendChild(drilldownTitleChip(sourceType, value));
			seen.add(`${sourceType}:${value}`);
		}

		Object.entries(activeFilters).forEach(([type, values]) => {
			values.forEach(activeValue => {
				const key = `${type}:${activeValue}`;
				if (seen.has(key)) return;
				filtersWrap.appendChild(drilldownTitleChip(type, activeValue));
				seen.add(key);
			});
		});

		const countBadge = document.createElement('span');
		countBadge.className = 'group-item-count';
		countBadge.textContent = countValue;

		drilldownTitle.appendChild(filtersWrap);
		drilldownTitle.appendChild(countBadge);
	}

	function drilldownTitleChip(type, value) {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = `book-row-chip ${drilldownChipClass(type)}`;
		chip.textContent = value;
		chip.addEventListener('click', event => {
			event.stopPropagation();
			handleDrilldownTitleChipClick(type, value);
		});
		return chip;
	}

	function handleDrilldownTitleChipClick(type, value) {
		if (currentDrilldown && currentDrilldown.sourceType === type && currentDrilldown.value === value) {
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
			case 'language':
				return 'book-row-chip-language';
			case 'series':
				return 'book-row-chip-series';
			case 'tags':
				return 'book-row-chip-tag';
			default:
				return 'book-row-chip-tag';
		}
	}

	function renderNav() {
		nav.innerHTML = '';
		Object.values(navRefs).forEach(group => group.clear());
		sectionRefs.clear();

		const allEl = document.createElement('div');
		allEl.className = 'all-item';
		allEl.innerHTML = `<span>All books</span><span class="group-item-count">${allBooks.length}</span>`;
		allEl.addEventListener('click', clearFilters);
		nav.appendChild(allEl);
		sectionRefs.set('all', allEl);

		['author', 'language', 'series', 'tags'].forEach(key => {
			const values = navGroups[key];
			if (!values || values.length === 0) return;

			const section = document.createElement('div');
			section.className = 'group-section';
			let hoverTimer = null;

			const header = document.createElement('div');
			header.className = 'group-header';
			header.innerHTML = `<span>${GROUP_LABELS[key]}</span><span class="group-chevron">&#9654;</span>`;
			header.addEventListener('click', () => section.classList.toggle('open'));

			section.addEventListener('mouseenter', () => {
				hoverTimer = setTimeout(() => section.classList.add('hover-open'), 500);
			});

			section.addEventListener('mouseleave', () => {
				clearTimeout(hoverTimer);
				section.classList.remove('hover-open');
			});

			const items = document.createElement('div');
			items.className = 'group-items';

			const itemsInner = document.createElement('div');
			itemsInner.className = 'group-items-inner';

			values.forEach(value => {
				const item = document.createElement('div');
				item.className = 'group-item';
				item.innerHTML = `<span>${value}</span><span class="group-item-count">${navCounts[key][value] || 0}</span>`;
				item.addEventListener('click', () => applyFilter(key, value));
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
		const allEl = sectionRefs.get('all');
		if (allEl) {
			allEl.classList.toggle('active', !hasActiveFilters());
		}

		['author', 'language', 'series', 'tags'].forEach(type => {
			const section = sectionRefs.get(type);
			if (section) {
				if (hasActiveFilterGroup(type)) {
					section.classList.add('open');
				} else {
					section.classList.remove('open');
				}
			}

			navRefs[type].forEach((item, value) => {
				item.classList.toggle('active', isFilterActive(type, value));
			});
		});

		renderActiveFilterChips();
	}

	function renderActiveFilterChips() {
		activeFiltersEl.innerHTML = '';
		const frag = document.createDocumentFragment();

		['language', 'series', 'tags', 'author'].forEach(type => {
			activeFilters[type].forEach(value => {
				frag.appendChild(activeFilterChip(type, value));
			});
		});

		activeFiltersEl.appendChild(frag);
		activeFiltersEl.classList.toggle('visible', activeFiltersEl.childElementCount > 0);
	}

	function activeFilterChip(type, value) {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = `book-row-chip toolbar-filter-chip ${drilldownChipClass(type)}`;
		chip.textContent = value;
		chip.addEventListener('click', event => {
			event.stopPropagation();
			applyFilter(type, value);
		});
		return chip;
	}

	function matchFilter(book, type, value) {
		switch (type) {
			case 'language': return book.language === value;
			case 'series': return book.series === value;
			case 'tags': return Array.isArray(book.tags) && book.tags.includes(value);
			case 'author': return Array.isArray(book.authors) && book.authors.includes(value);
			default: return true;
		}
	}

	function filterBooks() {
		const q = search.value.trim().toLowerCase();

		return allBooks.filter(book => {
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
				const haystack = [book.title || '', ...(book.authors || []), book.series || '', ...(book.tags || []), book.language || ''].join(' ').toLowerCase();
				if (!haystack.includes(q)) return false;
			}

			return true;
		});
	}

	function renderFiltered() {
		const filtered = filterBooks();
		count.textContent = `${filtered.length}/${allBooks.length}`;

		if (currentView === 'stats') {
			renderStatsView(filtered);
			if (drilldownBackdrop.classList.contains('open') && !isDrilldownSuspended) {
				if (currentDrilldown) {
					renderDrilldownContent(currentDrilldown.sourceType, currentDrilldown.value, filtered);
				} else {
					renderDrilldownContent(null, null, filtered);
				}
			}
			return;
		}

		renderBookList(filtered);
	}

	function renderBookList(filtered) {
		list.innerHTML = '';

		if (filtered.length === 0) {
			const emptyEl = document.createElement('div');
			emptyEl.className = 'empty';
			emptyEl.textContent = 'no books found';
			list.appendChild(emptyEl);
			return;
		}

		const frag = document.createDocumentFragment();
		filtered.forEach(book => {
			frag.appendChild(bookRow(book));
		});
		list.appendChild(frag);
	}

	function renderStatsView(books) {
		destroyCharts(statsCharts);
		stats.innerHTML = '';

		if (books.length === 0) {
			const emptyEl = document.createElement('div');
			emptyEl.className = 'empty';
			emptyEl.textContent = 'no books found';
			stats.appendChild(emptyEl);
			return;
		}

		['tags', 'series', 'language'].forEach(type => {
			const card = document.createElement('section');
			card.className = 'stats-card';
			card.innerHTML = `<div class="stats-card-label">${GROUP_LABELS[type]}</div>`;

			const distribution = buildDistribution(books, type);
			if (distribution.labels.length === 0) {
				const emptyEl = document.createElement('div');
				emptyEl.className = 'empty';
				emptyEl.textContent = 'no data';
				card.appendChild(emptyEl);
				stats.appendChild(card);
				return;
			}

			const canvasWrap = document.createElement('div');
			canvasWrap.className = 'stats-canvas-wrap';
			const canvas = document.createElement('canvas');
			canvasWrap.appendChild(canvas);
			card.appendChild(canvasWrap);
			stats.appendChild(card);
			statsCharts.push(createDonutChart(canvas, distribution, true, (event, elements, chart) => {
				if (!elements.length) return;
				const selectedIndex = elements[0].index;
				openDrilldownModal(type, chart.data.labels[selectedIndex], books);
			}));
		});
	}

	function buildDistribution(books, type) {
		const counts = new Map();

		books.forEach(book => {
			getBookValues(book, type).forEach(value => {
				counts.set(value, (counts.get(value) || 0) + 1);
			});
		});

		const entries = Array.from(counts.entries()).sort((a, b) => {
			if (b[1] !== a[1]) return b[1] - a[1];
			return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
		});

		return {
			labels: entries.map(entry => entry[0]),
			values: entries.map(entry => entry[1]),
		};
	}

	function getBookValues(book, type) {
		switch (type) {
			case 'language':
				return book.language ? [book.language] : [];
			case 'series':
				return book.series ? [book.series] : [];
			case 'tags':
				return (book.tags || []).filter(Boolean);
			case 'author':
				return (book.authors || []).filter(Boolean);
			default:
				return [];
		}
	}

	function createDonutChart(canvas, distribution, clickable, onClick) {
		const styles = getComputedStyle(document.documentElement);
		const palette = CHART_PALETTE_VARS.map(name => styles.getPropertyValue(name).trim()).filter(Boolean);
		const backgroundColor = distribution.labels.map((_, index) => palette[index % palette.length]);

		return new Chart(canvas, {
			type: 'doughnut',
			data: {
				labels: distribution.labels,
				datasets: [{
					data: distribution.values,
					backgroundColor,
					borderColor: styles.getPropertyValue('--mantle').trim(),
					borderWidth: 2,
					hoverOffset: 10,
				}],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				cutout: '62%',
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
								const suffix = value === 1 ? 'book' : 'books';
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
		const row = document.createElement('div');
		row.className = 'book-row';
		row.dataset.path = book.path;

		const header = document.createElement('div');
		header.className = 'book-row-header';

		const title = document.createElement('span');
		title.className = 'book-row-title';
		title.textContent = book.title || '—';

		const chips = document.createElement('div');
		chips.className = 'book-row-chips';

		if (book.language) {
			const chip = document.createElement('span');
			chip.className = 'book-row-chip book-row-chip-language';
			chip.textContent = book.language;
			chip.addEventListener('click', event => {
				event.stopPropagation();
				applyFilter('language', book.language);
			});
			chips.appendChild(chip);
		}

		if (book.series) {
			const chip = document.createElement('span');
			chip.className = 'book-row-chip book-row-chip-series';
			chip.textContent = book.series;
			chip.addEventListener('click', event => {
				event.stopPropagation();
				applyFilter('series', book.series);
			});
			chips.appendChild(chip);
		}

		(book.tags || []).forEach(tag => {
			if (!tag) return;
			const chip = document.createElement('span');
			chip.className = 'book-row-chip book-row-chip-tag';
			chip.textContent = tag;
			chip.addEventListener('click', event => {
				event.stopPropagation();
				applyFilter('tags', tag);
			});
			chips.appendChild(chip);
		});

		const author = document.createElement('span');
		author.className = 'book-row-author';
		author.textContent = (book.authors || []).join(', ');

		header.appendChild(title);
		header.appendChild(chips);
		header.appendChild(author);

		const preview = document.createElement('div');
		preview.className = 'book-row-preview';

		const inner = document.createElement('div');
		inner.className = 'book-row-preview-inner';

		const metaPanel = document.createElement('div');
		metaPanel.className = 'book-row-meta-panel';

		[
			{ label: 'Language', value: book.language || '' },
			{ label: 'Series', value: book.series || '' },
			{ label: 'Tags', value: (book.tags || []).join(', ') },
		].forEach(({ label, value }) => {
			if (!value) return;
			const metaRow = document.createElement('div');
			metaRow.className = 'book-row-meta-row';
			metaRow.innerHTML = `<span class="book-row-meta-label">${label}</span><span class="book-row-meta-value">${value}</span>`;
			metaPanel.appendChild(metaRow);
		});

		inner.appendChild(metaPanel);
		preview.appendChild(inner);
		row.appendChild(header);
		row.appendChild(preview);

		row.classList.add('book-row-static');

		row.addEventListener('click', () => {
			if (options.onOpen) {
				options.onOpen(book);
				return;
			}
			openReader(book);
		});

		return row;
	}
})();
