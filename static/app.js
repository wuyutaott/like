const API = '/api';
const $ = (id) => document.getElementById(id);

// section: 'all' | 'developers' | <category_id> (number)
const state = {
  categories: [],
  bookmarks: [],
  developers: [],
  section: 'all',
  search: '',
  user: null,
  isOwner: false,
};

const els = {
  tree: $('tree'),
  bookmarks: $('bookmarks'),
  search: $('search'),
  breadcrumb: $('breadcrumb'),
  empty: $('empty'),
  account: $('account'),
  btnAddCat: $('btn-add-cat'),
  btnAdd: $('btn-add'),
  dlgCat: $('dlg-cat'),
  dlgBm: $('dlg-bm'),
  dlgDev: $('dlg-dev'),
  formCat: $('form-cat'),
  formBm: $('form-bm'),
  formDev: $('form-dev'),
  catName: $('cat-name'),
  catParent: $('cat-parent'),
  catTitle: $('dlg-cat-title'),
  bmTitle: $('bm-title'),
  bmUrl: $('bm-url'),
  bmDesc: $('bm-desc'),
  bmCat: $('bm-cat'),
  bmDlgTitle: $('dlg-bm-title'),
  devName: $('dev-name'),
  devUrl: $('dev-url'),
  devAvatar: $('dev-avatar'),
  devReason: $('dev-reason'),
  devDlgTitle: $('dlg-dev-title'),
};

// ----------------- Helpers -----------------
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

const safeHost = (url) => {
  try { return new URL(url).host; } catch { return ''; }
};

const findCat = (id) => state.categories.find((c) => c.id === id);
const catName = (id) => findCat(id)?.name ?? '?';

function githubUserFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg && !/^(orgs|topics|search|sponsors|marketplace|settings)$/i.test(seg) ? seg : null;
  } catch { return null; }
}

function devAvatarUrl(dev) {
  if (dev.avatar_url) return dev.avatar_url;
  const user = githubUserFromUrl(dev.url);
  return user ? `https://github.com/${encodeURIComponent(user)}.png?size=200` : '';
}

async function jsonFetch(url, options = {}) {
  const opts = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const msg = await r.json().catch(() => ({}));
    throw new Error(msg.detail || `HTTP ${r.status}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

const api = {
  listCategories: () => jsonFetch(`${API}/categories`),
  createCategory: (data) => jsonFetch(`${API}/categories`, { method: 'POST', body: data }),
  updateCategory: (id, data) => jsonFetch(`${API}/categories/${id}`, { method: 'PATCH', body: data }),
  deleteCategory: (id) => jsonFetch(`${API}/categories/${id}`, { method: 'DELETE' }),
  listBookmarks: ({ category_id, q } = {}) => {
    const qs = new URLSearchParams();
    if (category_id != null) qs.set('category_id', category_id);
    if (q) qs.set('q', q);
    return jsonFetch(`${API}/bookmarks?${qs}`);
  },
  createBookmark: (data) => jsonFetch(`${API}/bookmarks`, { method: 'POST', body: data }),
  updateBookmark: (id, data) => jsonFetch(`${API}/bookmarks/${id}`, { method: 'PATCH', body: data }),
  deleteBookmark: (id) => jsonFetch(`${API}/bookmarks/${id}`, { method: 'DELETE' }),
  listDevelopers: ({ q } = {}) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    return jsonFetch(`${API}/developers?${qs}`);
  },
  createDeveloper: (data) => jsonFetch(`${API}/developers`, { method: 'POST', body: data }),
  updateDeveloper: (id, data) => jsonFetch(`${API}/developers/${id}`, { method: 'PATCH', body: data }),
  deleteDeveloper: (id) => jsonFetch(`${API}/developers/${id}`, { method: 'DELETE' }),
  me: () => jsonFetch('/auth/me'),
  logout: () => jsonFetch('/auth/logout', { method: 'POST' }),
};

// ----------------- Auth -----------------
async function refreshAuth() {
  try {
    const r = await api.me();
    state.user = r.user;
    state.isOwner = !!r.is_owner;
  } catch {
    state.user = null;
    state.isOwner = false;
  }
  document.body.classList.toggle('is-owner', state.isOwner);
  renderAccount();
}

function renderAccount() {
  if (state.user) {
    const name = escapeHtml(state.user.name || state.user.email || '');
    const pic = state.user.picture
      ? `<img class="avatar" src="${escapeHtml(state.user.picture)}" alt="">`
      : `<span class="avatar"></span>`;
    const badge = state.isOwner ? '<span class="badge">owner</span>' : '';
    els.account.innerHTML = `
      ${pic}
      <span class="who">${name}${badge}</span>
      <button id="btn-logout">退出</button>`;
    $('btn-logout').addEventListener('click', async () => {
      await api.logout();
      await refreshAuth();
    });
  } else {
    els.account.innerHTML = `
      <span class="who">未登录 · 仅作者可编辑</span>
      <a class="primary" href="/auth/google/login" style="text-decoration:none;font-size:12px;padding:4px 10px;border-radius:6px;">用 Google 登录</a>`;
  }
}

// ----------------- Render: tree -----------------
function renderTree() {
  const cats = state.categories;
  const top = cats.filter((c) => c.parent_id == null);
  const childrenOf = (id) => cats.filter((c) => c.parent_id === id);

  const isAct = (s) => state.section === s ? 'active' : '';
  const parts = [
    `<div class="node ${isAct('developers')}" data-section="developers">
      <span class="name">👨‍💻 Developers</span>
    </div>`,
    `<div class="node ${isAct('all')}" data-section="all">
      <span class="name">📚 全部书签</span>
    </div>`,
  ];

  for (const t of top) {
    parts.push(`
      <div class="node ${isAct(t.id)}" data-id="${t.id}" data-kind="top">
        <span class="name">📁 ${escapeHtml(t.name)}</span>
        <span class="actions">
          <button data-act="add-sub" title="新增子分类">+</button>
          <button data-act="rename" title="重命名">✎</button>
          <button data-act="del" title="删除">🗑</button>
        </span>
      </div>`);
    for (const k of childrenOf(t.id)) {
      parts.push(`
        <div class="node sub ${isAct(k.id)}" data-id="${k.id}" data-kind="sub">
          <span class="name">└ ${escapeHtml(k.name)}</span>
          <span class="actions">
            <button data-act="rename" title="重命名">✎</button>
            <button data-act="del" title="删除">🗑</button>
          </span>
        </div>`);
    }
  }

  els.tree.innerHTML = parts.join('');
}

// ----------------- Render: content -----------------
function renderBreadcrumb() {
  if (state.search) {
    els.breadcrumb.textContent = `搜索结果："${state.search}"`;
    return;
  }
  if (state.section === 'developers') {
    els.breadcrumb.textContent = '👨‍💻 Developers';
  } else if (state.section === 'all') {
    els.breadcrumb.textContent = '全部书签';
  } else {
    const c = findCat(state.section);
    if (c?.parent_id != null) {
      els.breadcrumb.textContent = `${catName(c.parent_id)} / ${c.name}`;
    } else {
      els.breadcrumb.textContent = c?.name ?? '?';
    }
  }
}

function renderAddButton() {
  if (state.section === 'developers') {
    els.btnAdd.textContent = '+ 新增 Developer';
  } else {
    els.btnAdd.textContent = '+ 新增书签';
  }
}

function renderContent() {
  renderBreadcrumb();
  renderAddButton();

  if (state.section === 'developers') {
    if (!state.developers.length) {
      els.bookmarks.innerHTML = '';
      els.bookmarks.classList.remove('dev-grid');
      els.empty.classList.remove('hidden');
      els.empty.textContent = state.search ? '没有匹配的 Developer' : '还没有 Developer';
      return;
    }
    els.empty.classList.add('hidden');
    els.bookmarks.classList.add('dev-grid');
    els.bookmarks.innerHTML = state.developers.map(renderDeveloperCard).join('');
  } else {
    if (!state.bookmarks.length) {
      els.bookmarks.innerHTML = '';
      els.bookmarks.classList.remove('dev-grid');
      els.empty.classList.remove('hidden');
      els.empty.textContent = state.search ? '没有匹配的书签' : '这里还没有内容';
      return;
    }
    els.empty.classList.add('hidden');
    els.bookmarks.classList.remove('dev-grid');
    els.bookmarks.innerHTML = state.bookmarks.map(renderBookmarkItem).join('');
  }
}

function renderBookmarkItem(b) {
  const host = safeHost(b.url);
  const cat = catName(b.category_id);
  return `
    <li class="bm" data-id="${b.id}">
      <div class="bm-main">
        <a class="bm-title" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.title)}</a>
        <div class="bm-meta">
          ${host ? `<span class="bm-host">${escapeHtml(host)}</span>` : ''}
          <span class="bm-cat">${escapeHtml(cat)}</span>
        </div>
        ${b.description ? `<p class="bm-desc">${escapeHtml(b.description)}</p>` : ''}
      </div>
      <div class="bm-actions">
        <button data-act="edit">编辑</button>
        <button data-act="del" class="del">删除</button>
      </div>
    </li>`;
}

function renderDeveloperCard(d) {
  const avatar = devAvatarUrl(d);
  const user = githubUserFromUrl(d.url);
  const handle = user ? `@${user}` : safeHost(d.url);
  return `
    <li class="bm dev-card" data-id="${d.id}">
      <div class="dev-card-head">
        ${avatar
          ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" class="dev-avatar-link">
               <img class="dev-avatar" src="${avatar}" alt="" loading="lazy"
                    onerror="this.parentElement.classList.add('dev-avatar-fallback');this.remove()">
             </a>`
          : `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" class="dev-avatar-link dev-avatar-fallback"></a>`
        }
        <div class="dev-card-meta">
          <a class="dev-card-name" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.name)}</a>
          ${handle ? `<div class="dev-card-handle">${escapeHtml(handle)}</div>` : ''}
        </div>
      </div>
      ${d.reason ? `<p class="dev-card-reason">${escapeHtml(d.reason)}</p>` : ''}
      <div class="bm-actions dev-card-actions">
        <button data-act="edit">编辑</button>
        <button data-act="del" class="del">删除</button>
      </div>
    </li>`;
}

// ----------------- Data ops -----------------
async function refreshCategories() {
  state.categories = await api.listCategories();
  renderTree();
}

async function refreshContent() {
  if (state.section === 'developers') {
    state.developers = await api.listDevelopers(
      state.search ? { q: state.search } : {},
    );
  } else {
    const params = {};
    if (state.search) params.q = state.search;
    if (typeof state.section === 'number' && !state.search) {
      params.category_id = state.section;
    }
    state.bookmarks = await api.listBookmarks(params);
  }
  renderContent();
}

// ----------------- Dialogs -----------------
function fillCategoryParentSelect(selectEl, { exclude, includeRoot } = {}) {
  const opts = includeRoot ? ['<option value="">— 一级分类 —</option>'] : [];
  state.categories
    .filter((c) => c.parent_id == null && c.id !== exclude)
    .forEach((c) => opts.push(`<option value="${c.id}">${escapeHtml(c.name)}</option>`));
  selectEl.innerHTML = opts.join('');
}

function fillBookmarkCategorySelect(selected) {
  const opts = [];
  state.categories
    .filter((c) => c.parent_id == null)
    .forEach((c) => {
      opts.push(`<option value="${c.id}">${escapeHtml(c.name)}</option>`);
      state.categories
        .filter((k) => k.parent_id === c.id)
        .forEach((k) =>
          opts.push(`<option value="${k.id}">　└ ${escapeHtml(k.name)}</option>`),
        );
    });
  els.bmCat.innerHTML = opts.join('');
  if (selected != null) els.bmCat.value = String(selected);
}

let categoryEditMode = null;
let bookmarkEditMode = null;
let developerEditMode = null;

function openCategoryDialog({ mode, parentId, category }) {
  categoryEditMode = null;
  if (mode === 'add') {
    els.catTitle.textContent = parentId ? '新增子分类' : '新增一级分类';
    els.catName.value = '';
    fillCategoryParentSelect(els.catParent, { includeRoot: true });
    els.catParent.value = parentId ? String(parentId) : '';
    els.catParent.disabled = false;
  } else {
    els.catTitle.textContent = '编辑分类';
    els.catName.value = category.name;
    fillCategoryParentSelect(els.catParent, { exclude: category.id, includeRoot: true });
    els.catParent.value = category.parent_id ? String(category.parent_id) : '';
    const hasChildren = state.categories.some((c) => c.parent_id === category.id);
    els.catParent.disabled = hasChildren;
    categoryEditMode = { id: category.id };
  }
  els.dlgCat.showModal();
  setTimeout(() => els.catName.focus(), 0);
}

function openBookmarkDialog({ mode, bookmark }) {
  bookmarkEditMode = null;
  if (!state.categories.length) {
    alert('请先创建至少一个分类');
    return;
  }
  if (mode === 'add') {
    els.bmDlgTitle.textContent = '新增书签';
    els.bmTitle.value = '';
    els.bmUrl.value = '';
    els.bmDesc.value = '';
    const preferCat = typeof state.section === 'number' ? state.section : state.categories[0].id;
    fillBookmarkCategorySelect(preferCat);
  } else {
    els.bmDlgTitle.textContent = '编辑书签';
    els.bmTitle.value = bookmark.title;
    els.bmUrl.value = bookmark.url;
    els.bmDesc.value = bookmark.description || '';
    fillBookmarkCategorySelect(bookmark.category_id);
    bookmarkEditMode = { id: bookmark.id };
  }
  els.dlgBm.showModal();
  setTimeout(() => els.bmTitle.focus(), 0);
}

function openDeveloperDialog({ mode, developer }) {
  developerEditMode = null;
  if (mode === 'add') {
    els.devDlgTitle.textContent = '新增 Developer';
    els.devName.value = '';
    els.devUrl.value = '';
    els.devAvatar.value = '';
    els.devReason.value = '';
  } else {
    els.devDlgTitle.textContent = '编辑 Developer';
    els.devName.value = developer.name;
    els.devUrl.value = developer.url;
    els.devAvatar.value = developer.avatar_url || '';
    els.devReason.value = developer.reason || '';
    developerEditMode = { id: developer.id };
  }
  els.dlgDev.showModal();
  setTimeout(() => els.devName.focus(), 0);
}

// ----------------- Events: tree -----------------
els.tree.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  const node = e.target.closest('.node');
  if (!node) return;

  if (btn) {
    e.stopPropagation();
    const id = Number(node.dataset.id);
    const cat = findCat(id);
    const act = btn.dataset.act;
    if (act === 'add-sub') {
      openCategoryDialog({ mode: 'add', parentId: id });
    } else if (act === 'rename') {
      openCategoryDialog({ mode: 'edit', category: cat });
    } else if (act === 'del') {
      const childCount = state.categories.filter((c) => c.parent_id === id).length;
      const msg = childCount
        ? `删除「${cat.name}」会同时删除 ${childCount} 个子分类及其下所有书签。确定？`
        : `确定删除「${cat.name}」及其下所有书签？`;
      if (!confirm(msg)) return;
      try {
        await api.deleteCategory(id);
        if (state.section === id) state.section = 'all';
        await refreshCategories();
        await refreshContent();
      } catch (err) { alert('删除失败：' + err.message); }
    }
    return;
  }

  // section switch
  if (node.dataset.section) {
    state.section = node.dataset.section;
  } else if (node.dataset.id) {
    state.section = Number(node.dataset.id);
  }
  state.search = '';
  els.search.value = '';
  renderTree();
  await refreshContent();
});

// ----------------- Events: content (delegated) -----------------
els.bookmarks.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const li = e.target.closest('.bm');
  const id = Number(li.dataset.id);

  if (state.section === 'developers') {
    const dev = state.developers.find((d) => d.id === id);
    if (!dev) return;
    if (btn.dataset.act === 'edit') {
      openDeveloperDialog({ mode: 'edit', developer: dev });
    } else if (btn.dataset.act === 'del') {
      if (!confirm(`删除「${dev.name}」？`)) return;
      try {
        await api.deleteDeveloper(id);
        await refreshContent();
      } catch (err) { alert('删除失败：' + err.message); }
    }
    return;
  }

  const bm = state.bookmarks.find((b) => b.id === id);
  if (!bm) return;
  if (btn.dataset.act === 'edit') {
    openBookmarkDialog({ mode: 'edit', bookmark: bm });
  } else if (btn.dataset.act === 'del') {
    if (!confirm(`删除书签「${bm.title}」？`)) return;
    try {
      await api.deleteBookmark(id);
      await refreshContent();
    } catch (err) { alert('删除失败：' + err.message); }
  }
});

// ----------------- Events: top buttons -----------------
els.btnAddCat.addEventListener('click', () => openCategoryDialog({ mode: 'add' }));
els.btnAdd.addEventListener('click', () => {
  if (state.section === 'developers') {
    openDeveloperDialog({ mode: 'add' });
  } else {
    openBookmarkDialog({ mode: 'add' });
  }
});

// ----------------- Events: dialog cancel -----------------
document.querySelectorAll('dialog [data-close]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.target.closest('dialog').close();
  });
});

// ----------------- Events: forms -----------------
els.formCat.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = els.catName.value.trim();
  if (!name) return;
  const parentRaw = els.catParent.value;
  const parent_id = parentRaw === '' ? null : Number(parentRaw);
  try {
    if (categoryEditMode) {
      await api.updateCategory(categoryEditMode.id, { name, parent_id });
    } else {
      await api.createCategory({ name, parent_id });
    }
    els.dlgCat.close();
    await refreshCategories();
    await refreshContent();
  } catch (err) { alert('保存失败：' + err.message); }
});

els.formBm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: els.bmTitle.value.trim(),
    url: els.bmUrl.value.trim(),
    description: els.bmDesc.value.trim(),
    category_id: Number(els.bmCat.value),
  };
  if (!payload.title || !payload.url || !payload.category_id) return;
  try {
    if (bookmarkEditMode) {
      await api.updateBookmark(bookmarkEditMode.id, payload);
    } else {
      await api.createBookmark(payload);
    }
    els.dlgBm.close();
    await refreshContent();
  } catch (err) { alert('保存失败：' + err.message); }
});

els.formDev.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: els.devName.value.trim(),
    url: els.devUrl.value.trim(),
    avatar_url: els.devAvatar.value.trim() || null,
    reason: els.devReason.value.trim(),
  };
  if (!payload.name || !payload.url) return;
  try {
    if (developerEditMode) {
      await api.updateDeveloper(developerEditMode.id, payload);
    } else {
      await api.createDeveloper(payload);
    }
    els.dlgDev.close();
    await refreshContent();
  } catch (err) { alert('保存失败：' + err.message); }
});

// ----------------- Events: search -----------------
let searchTimer;
els.search.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.search = e.target.value.trim();
    await refreshContent();
  }, 200);
});

// ----------------- Init -----------------
(async function init() {
  try {
    await refreshAuth();
    await refreshCategories();
    await refreshContent();
    const params = new URLSearchParams(location.search);
    if (params.has('login_error')) {
      alert('Google 登录失败：' + params.get('login_error'));
      history.replaceState({}, '', location.pathname);
    }
  } catch (err) {
    alert('加载失败：' + err.message);
  }
})();
