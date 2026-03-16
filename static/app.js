(function() {
	let allBooks = [];
	let activeFilter = { type: null, value: null };
	let currentRows = [];

	const nav = document.getElementById('nav');
	const list = document.getElementById('list');
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
			renderNav(lib.groups || {});
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

	modalClose.addEventListener('click', closeModal);
	backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
	document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

	function closeModal() {
		backdrop.classList.remove('open');
	}

	function clearFilters() {
		activeFilter = { type: null, value: null };
		search.value = '';
		searchClear.classList.remove('visible');
		renderNav(buildGroups());
		renderFiltered();
	}

	function applyFilter(type, value) {
		activeFilter = { type, value };
		renderNav(buildGroups());
		renderFiltered();
	}

	function buildGroups() {
		const groups = { language: new Set(), series: new Set(), tags: new Set(), author: new Set() };

		allBooks.forEach(book => {
			if (book.language) groups.language.add(book.language);
			if (book.series) groups.series.add(book.series);
			(book.tags || []).forEach(tag => groups.tags.add(tag));
			(book.authors || []).forEach(author => groups.author.add(author));
		});

		return {
			language: Array.from(groups.language).sort(),
			series: Array.from(groups.series).sort(),
			tags: Array.from(groups.tags).sort(),
			author: Array.from(groups.author).sort(),
		};
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

	function renderNav(groups) {
		nav.innerHTML = '';
		const allEl = document.createElement('div');
		allEl.className = activeFilter.type ? 'all-item' : 'all-item active';
		allEl.innerHTML = `<span>All books</span><span class="group-item-count">${allBooks.length}</span>`;
		allEl.addEventListener('click', clearFilters);
		nav.appendChild(allEl);

		['author', 'language', 'series', 'tags'].forEach(key => {
			const values = groups[key];
			if (!values || values.length === 0) return;

			const section = document.createElement('div');
			section.className = 'group-section';
			if (activeFilter.type === key) {
				section.classList.add('open');
			}
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

			values.forEach(val => {
				const bookCount = allBooks.filter(b => matchFilter(b, key, val)).length;
				const item = document.createElement('div');
				item.className = activeFilter.type === key && activeFilter.value === val ? 'group-item active' : 'group-item';
				item.innerHTML = `<span>${val}</span><span class="group-item-count">${bookCount}</span>`;
				item.addEventListener('click', () => applyFilter(key, val));
				itemsInner.appendChild(item);
			});

			items.appendChild(itemsInner);
			section.appendChild(header);
			section.appendChild(items);
			nav.appendChild(section);
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

	function clearActive() {
		nav.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
	}

	function filterBooks() {
		const q = search.value.trim().toLowerCase();
		const { type, value } = activeFilter;
		return allBooks.filter(b => {
			if (type && !matchFilter(b, type, value)) return false;
			if (q) {
				const haystack = [b.title || '', ...(b.authors || []), b.series || '', ...(b.tags || []), b.language || ''].join(' ').toLowerCase();
				if (!haystack.includes(q)) return false;
			}
			return true;
		});
	}

	function renderFiltered() {
		const filtered = filterBooks();
		count.textContent = `${filtered.length} book${filtered.length !== 1 ? 's' : ''}`;

		const incoming = new Set(filtered.map(b => b.path));
		currentRows.forEach(row => {
			row.style.display = incoming.has(row.dataset.path) ? '' : 'none';
		});

		const existingPaths = new Set(currentRows.map(r => r.dataset.path));
		const toAdd = filtered.filter(b => !existingPaths.has(b.path));

		if (toAdd.length > 0) {
			const frag = document.createDocumentFragment();
			toAdd.forEach(b => {
				const row = bookRow(b);
				frag.appendChild(row);
				currentRows.push(row);
			});
			list.appendChild(frag);
		}

		let emptyEl = list.querySelector('.empty');
		if (filtered.length === 0) {
			if (!emptyEl) {
				emptyEl = document.createElement('div');
				emptyEl.className = 'empty';
				emptyEl.textContent = 'no books found';
				list.appendChild(emptyEl);
			}
			emptyEl.style.display = '';
		} else if (emptyEl) {
			emptyEl.style.display = 'none';
		}
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
			const r = document.createElement('div');
			r.className = 'book-row-meta-row';
			r.innerHTML = `<span class="book-row-meta-label">${label}</span><span class="book-row-meta-value">${value}</span>`;
				metaPanel.appendChild(r);
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
