(function () {
  let allBooks = [];
  let activeFilter = { type: null, value: null };
  let currentCards = [];

  const nav = document.getElementById('nav');
  const grid = document.getElementById('grid');
  const search = document.getElementById('search');
  const searchClear = document.getElementById('search-clear');
  const count = document.getElementById('count');

  const GROUP_LABELS = {
    language: 'Language',
    series: 'Series',
    tags: 'Tags',
    author: 'Author',
  };

  fetch('/api/library')
    .then(r => r.json())
    .then(lib => {
      allBooks = lib.books || [];
      renderNav(lib.groups || {});
      renderAll();
    })
    .catch(() => {
      grid.innerHTML = '<div class="empty">failed to load library</div>';
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

  function renderNav(groups) {
    const allEl = document.createElement('div');
    allEl.className = 'all-item active';
    allEl.innerHTML = `<span>All books</span><span class="group-item-count">${allBooks.length}</span>`;
    allEl.addEventListener('click', () => {
      clearActive();
      allEl.classList.add('active');
      activeFilter = { type: null, value: null };
      renderFiltered();
    });
    nav.appendChild(allEl);

    const ORDER = ['author', 'language', 'series', 'tags'];
    ORDER.forEach(key => {
      const values = groups[key];
      if (!values || values.length === 0) return;

      const section = document.createElement('div');
      section.className = 'group-section';

      const header = document.createElement('div');
      header.className = 'group-header';
      header.innerHTML = `<span>${GROUP_LABELS[key] || key}</span><span class="group-chevron">&#9654;</span>`;
      header.addEventListener('click', () => section.classList.toggle('open'));

      const items = document.createElement('div');
      items.className = 'group-items';

      values.forEach(val => {
        const bookCount = countBooks(key, val);
        const item = document.createElement('div');
        item.className = 'group-item';
        item.dataset.type = key;
        item.dataset.value = val;
        item.innerHTML = `<span>${val}</span><span class="group-item-count">${bookCount}</span>`;
        item.addEventListener('click', () => {
          clearActive();
          item.classList.add('active');
          activeFilter = { type: key, value: val };
          renderFiltered();
        });
        items.appendChild(item);
      });

      section.appendChild(header);
      section.appendChild(items);
      nav.appendChild(section);
    });
  }

  function countBooks(type, value) {
    return allBooks.filter(b => matchFilter(b, type, value)).length;
  }

  function matchFilter(book, type, value) {
    switch (type) {
      case 'language': return book.language === value;
      case 'series':   return book.series === value;
      case 'tags':     return Array.isArray(book.tags) && book.tags.includes(value);
      case 'author':   return Array.isArray(book.authors) && book.authors.includes(value);
      default:         return true;
    }
  }

  function clearActive() {
    nav.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
  }

  function renderAll() {
    activeFilter = { type: null, value: null };
    renderFiltered();
  }

  function filterBooks() {
    const q = search.value.trim().toLowerCase();
    const { type, value } = activeFilter;
    return allBooks.filter(b => {
      if (type && !matchFilter(b, type, value)) return false;
      if (q) {
        const parts = [
          b.title || '',
          ...(b.authors || []),
          b.series || '',
          ...(b.tags || []),
          b.language || '',
        ];
        const haystack = parts.join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  function renderFiltered() {
    const filtered = filterBooks();
    count.textContent = `${filtered.length} book${filtered.length !== 1 ? 's' : ''}`;

    const incoming = new Set(filtered.map(b => b.path));
    const existing = new Set(currentCards.map(c => c.dataset.path));

    currentCards.forEach(card => {
      if (!incoming.has(card.dataset.path)) card.style.display = 'none';
      else card.style.display = '';
    });

    const existingPaths = new Set(currentCards.map(c => c.dataset.path));
    const toAdd = filtered.filter(b => !existingPaths.has(b.path));

    if (toAdd.length > 0) {
      const frag = document.createDocumentFragment();
      toAdd.forEach(b => {
        const card = bookCard(b);
        frag.appendChild(card);
        currentCards.push(card);
      });
      grid.appendChild(frag);
    }

    const visibleCount = filtered.length;
    let emptyEl = grid.querySelector('.empty');
    if (visibleCount === 0) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'empty';
        emptyEl.textContent = 'no books found';
        grid.appendChild(emptyEl);
      }
      emptyEl.style.display = '';
    } else if (emptyEl) {
      emptyEl.style.display = 'none';
    }
  }

  function bookCard(book) {
    const wrapper = document.createElement('div');
    wrapper.className = 'book-card-wrapper';
    wrapper.dataset.path = book.path;

    const card = document.createElement('div');
    card.className = 'book-card';

    const front = document.createElement('div');
    front.className = 'book-face book-front';

    if (book.coverUrl) {
      const img = document.createElement('img');
      img.className = 'book-cover';
      img.src = book.coverUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(placeholder(book.title));
      front.appendChild(img);
    } else {
      front.appendChild(placeholder(book.title));
    }

    const frontInfo = document.createElement('div');
    frontInfo.className = 'book-info';

    const title = document.createElement('div');
    title.className = 'book-title';
    title.textContent = book.title || '—';
    frontInfo.appendChild(title);

    if (book.authors && book.authors.length > 0) {
      const author = document.createElement('div');
      author.className = 'book-author';
      author.textContent = book.authors.join(', ');
      frontInfo.appendChild(author);
    }

    front.appendChild(frontInfo);

    const back = document.createElement('div');
    back.className = 'book-face book-back';

    const backContent = document.createElement('div');
    backContent.className = 'book-back-content';

    const backTitle = document.createElement('div');
    backTitle.className = 'back-title';
    backTitle.textContent = book.title || '—';
    backContent.appendChild(backTitle);

    const rows = [
      { label: 'Author',   value: (book.authors || []).join(', ') },
      { label: 'Language', value: book.language || '' },
      { label: 'Series',   value: book.series || '' },
      { label: 'Tags',     value: (book.tags || []).join(', ') },
    ];

    rows.forEach(({ label, value }) => {
      if (!value) return;
      const row = document.createElement('div');
      row.className = 'back-row';
      row.innerHTML = `<span class="back-label">${label}</span><span class="back-value">${value}</span>`;
      backContent.appendChild(row);
    });

    back.appendChild(backContent);

    card.appendChild(front);
    card.appendChild(back);
    wrapper.appendChild(card);

	  wrapper.addEventListener('click', () => {
  const wasFlipped = wrapper.classList.toggle('flipped');
  clearTimeout(wrapper._flipTimer);
  if (wasFlipped) {
    wrapper._flipTimer = setTimeout(() => wrapper.classList.remove('flipped'), 5000);
  }
});

    return wrapper;
  }

  function placeholder(title) {
    const div = document.createElement('div');
    div.className = 'book-cover-placeholder';
    div.textContent = (title || '?').charAt(0).toUpperCase();
    return div;
  }
})();
