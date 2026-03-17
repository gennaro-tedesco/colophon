(function() {
	let allBooks = [];
	let navGroups = { language: [], series: [], tags: [], author: [] };
	let navCounts = { language: {}, series: {}, tags: {}, author: {} };
	let activeFilters = createEmptyFilters();

	const navRefs = { language: new Map(), series: new Map(), tags: new Map(), author: new Map() };
	const sectionRefs = new Map();

	const nav = document.getElementById('nav');
	const list = document.getElementById('list');
	const logo = document.querySelector('.logo');
	const search = document.getElementById('search');
	const searchClear = document.getElementById('search-clear');
	const count = document.getElementById('count');
	const backdrop = document.getElementById('modal-backdrop');
	const modalTitle = document.getElementById('modal-title');
	const modalMeta = document.getElementById('modal-meta');
	const modalCover = document.getElementById('modal-cover');
	const modalClose = document.getElementById('modal-close');

	const GROUP_LABELS = { language: 'Language', series: 'Series', tags: 'Tags', author: 'Author' };

	fetch('/api/library')
		.then(r => r.json())
		.then(lib => {
			allBooks = lib.books || [];
			const data = buildGroupData(allBooks);
			navGroups = data.groups;
			navCounts = data.counts;
			renderNav();
			renderFiltered();
		})
		.catch(() => {
			list.innerHTML = '<div class="empty">failed to load library</div>';
		});

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

	logo.addEventListener('click', clearFilters);
	modalClose.addEventListener('click', closeModal);
	backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
	document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

	function createEmptyFilters() {
		return {
			language: new Set(),
			series: new Set(),
			tags: new Set(),
			author: new Set(),
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

		return {
			groups: {
				language: Array.from(groups.language).sort(),
				series: Array.from(groups.series).sort(),
				tags: Array.from(groups.tags).sort(),
				author: Array.from(groups.author).sort(),
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

	function closeModal() {
		backdrop.classList.remove('open');
	}

	function openModal(book) {
		modalTitle.textContent = book.title || '—';

		let img = modalCover.querySelector('img');
		const placeholder = document.getElementById('modal-cover-placeholder');

		if (book.coverUrl) {
			if (!img) {
				img = document.createElement('img');
				img.alt = '';
				modalCover.appendChild(img);
			}
			img.src = book.coverUrl;
			img.style.display = 'block';
			img.onerror = () => {
				img.style.display = 'none';
				placeholder.textContent = (book.title || '?').charAt(0).toUpperCase();
				placeholder.style.display = 'flex';
			};
			placeholder.style.display = 'none';
		} else {
			if (img) img.style.display = 'none';
			placeholder.textContent = (book.title || '?').charAt(0).toUpperCase();
			placeholder.style.display = 'flex';
		}

		modalMeta.innerHTML = '';
		[
			{ label: 'Author', value: (book.authors || []).join(', ') },
			{ label: 'Language', value: book.language || '' },
			{ label: 'Series', value: book.series || '' },
			{ label: 'Tags', value: (book.tags || []).join(', ') },
		].forEach(({ label, value }) => {
			if (!value) return;
			const row = document.createElement('div');
			row.className = 'modal-row';
			row.innerHTML = `<span class="modal-label">${label}</span><span class="modal-value">${value}</span>`;
			modalMeta.appendChild(row);
		});

		backdrop.classList.add('open');
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

	function bookRow(book) {
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

		let hoverTimer = null;

		row.addEventListener('mouseenter', () => {
			hoverTimer = setTimeout(() => preview.classList.add('expanded'), 500);
		});

		row.addEventListener('mouseleave', () => {
			clearTimeout(hoverTimer);
			preview.classList.remove('expanded');
		});

		row.addEventListener('click', () => openModal(book));

		return row;
	}
})();
