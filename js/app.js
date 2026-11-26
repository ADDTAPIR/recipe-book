import { db, persist } from './db.js';
import { escapeHtml as h, norm, uid } from './text.js';
import { MEAL_TYPES, COURSES, splitRecipes, parseRecipe, parseIngredientLine, newRecipe, categorize } from './parse.js';
import { SearchIndex, DEFAULT_SYNONYMS } from './search.js';
import { extractIngredients } from './vocab.js';
import { syncNow } from './sync.js';

// ---------------- State ----------------
const S = {
  recipes: [],
  synonyms: DEFAULT_SYNONYMS,
  synonymsUpdatedAt: 0,
  index: null,
  query: '',
  filters: { mealType: '', course: '', favourite: false, needsReview: false, needsAmounts: false },
  selecting: false,
  selected: new Set(),
  lastSearch: null,
  importDraft: null,
  sync: null, // { token, gistId, lastSync, error }
};
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');

function live() { return S.recipes.filter(r => !r.deleted); }
function rebuild() { S.index = new SearchIndex(S.recipes, S.synonyms); updateBadge(); }
function byId(id) { return S.recipes.find(r => r.id === id); }

async function saveRecipe(r, { touch = true } = {}) {
  if (touch) r.updatedAt = Date.now();
  const i = S.recipes.findIndex(x => x.id === r.id);
  if (i >= 0) S.recipes[i] = r; else S.recipes.push(r);
  await db.putRecipe(r);
  rebuild();
  scheduleSync();
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function updateBadge() {
  const n = live().filter(r => !r.reviewed).length;
  const b = $('#reviewBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}

// ---------------- Formatting ----------------
function fmtIng(i) {
  const q = [i.qty, i.unit].filter(Boolean).join(' ');
  let s = (q ? q + ' ' : '') + i.name;
  if (i.alternatives?.length) s += ' (or ' + i.alternatives.join(' / ') + ')';
  if (i.note) s += ', ' + i.note;
  if (i.optional) s += ' (optional)';
  return s;
}

function shareText(recipes) {
  return recipes.map(r => {
    const out = ['*' + r.title + '*'];
    const meta = [...(r.courses || []), ...(r.mealTypes || [])].join(' · ');
    if (meta) out.push(meta);
    if (r.serves) out.push('Serves ' + r.serves);
    if (r.description) out.push('', r.description);
    const listed = r.ingredients.filter(i => !i.fromText || i.qty);
    if (listed.length) { out.push('', '*Ingredients*'); listed.forEach(i => out.push('• ' + fmtIng(i))); }
    if (r.method) out.push('', '*Method*', r.method);
    if (r.notes) out.push('', '*Notes*', r.notes);
    return out.join('\n');
  }).join('\n\n— — —\n\n');
}

function catTags(r) {
  return (r.courses || []).map(c => `<span class="tag course">${h(c)}</span>`).join('') +
    (r.mealTypes || []).map(c => `<span class="tag">${h(c)}</span>`).join('');
}

// ---------------- Router ----------------
const routes = [];
function route(re, fn) { routes.push([re, fn]); }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

let lastHomeScroll = 0;
async function render() {
  const hash = location.hash.slice(1) || '/';
  const prev = render.current;
  if (prev === '/') lastHomeScroll = window.scrollY;
  render.current = hash;
  $('#topActions').innerHTML = '';
  $('#backBtn').hidden = true;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.remove('active'));
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { await fn(...m.slice(1)); break; }
  }
  if (hash === '/' && prev && prev.startsWith('/r/')) window.scrollTo(0, lastHomeScroll);
  else if (hash !== prev) window.scrollTo(0, 0);
}
function setTab(t) { const a = document.querySelector(`.tabbar a[data-tab="${t}"]`); if (a) a.classList.add('active'); }
function setTitle(t) { $('#pageTitle').textContent = t; document.title = t === 'Recipes' ? 'Recipe Book' : t + ' · Recipe Book'; }
function showBack(to) { const b = $('#backBtn'); b.hidden = false; b.onclick = () => (history.length > 1 ? history.back() : go(to || '#/')); }
function topAction(html, onClick, label) {
  const b = document.createElement('button'); b.className = 'icon-btn'; b.innerHTML = html; b.onclick = onClick;
  if (label) b.setAttribute('aria-label', label);
  $('#topActions').appendChild(b); return b;
}
const ICON = {
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>',
  star: on => `<svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`,
};

// ---------------- Home / search ----------------
route(/^\/$/, () => {
  setTab('home'); setTitle('Recipes');
  topAction(S.selecting ? 'Done' : 'Select', () => { S.selecting = !S.selecting; if (!S.selecting) S.selected.clear(); render(); });
  const f = S.filters;
  const chip = (group, val, label) => `<button class="chip ${f[group] === val ? 'on' : ''}" data-g="${group}" data-v="${h(val)}">${h(label || val)}</button>`;
  const toggle = (k, label) => `<button class="chip ${f[k] ? 'on' : ''}" data-t="${k}">${label}</button>`;
  const used = (key, list) => { const s = new Set(live().flatMap(r => r[key] || [])); return list.filter(x => s.has(x)); };
  view.innerHTML = `
    <div class="searchbox">
      <svg class="mag" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="q" type="search" placeholder="Ingredients, dish or course…" value="${h(S.query)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      <button class="clear" id="clearQ" aria-label="Clear" ${S.query ? '' : 'hidden'}>✕</button>
    </div>
    <p class="hint">Try <a href="#" data-try="spaghetti, parsley, sausage">spaghetti, parsley, sausage</a> or <a href="#" data-try="zuchini">zuchini</a>. Separate ingredients with commas.</p>
    <div class="chip-label">Course</div>
    <div class="chips">${chip('course', '', 'All')}${used('courses', COURSES).map(c => chip('course', c)).join('')}</div>
    <div class="chip-label">Meal</div>
    <div class="chips">${chip('mealType', '', 'All')}${used('mealTypes', MEAL_TYPES).map(c => chip('mealType', c)).join('')}</div>
    <div class="chips">${toggle('favourite', '★ Favourites')}${toggle('needsReview', 'Not yet reviewed')}${toggle('needsAmounts', 'Missing amounts')}</div>
    <div id="results"></div>`;
  const q = $('#q');
  q.addEventListener('input', () => { S.query = q.value; $('#clearQ').hidden = !q.value; drawResults(); });
  $('#clearQ').onclick = () => { S.query = ''; q.value = ''; $('#clearQ').hidden = true; drawResults(); q.focus(); };
  view.querySelectorAll('[data-try]').forEach(a => a.onclick = e => { e.preventDefault(); S.query = a.dataset.try; q.value = S.query; $('#clearQ').hidden = false; drawResults(); });
  view.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { f[b.dataset.g] = b.dataset.v; render(); });
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { f[b.dataset.t] = !f[b.dataset.t]; render(); });
  drawResults();
});

function highlightIngs(r, hit) {
  const names = r.ingredients.map((i, k) => (hit && hit.has(k) ? `<mark>${h(i.name)}</mark>` : h(i.name)));
  // Show matched ones first
  const order = r.ingredients.map((_, k) => k).sort((a, b) => (hit?.has(b) ? 1 : 0) - (hit?.has(a) ? 1 : 0));
  return order.map(k => names[k]).join(', ');
}

function inText(x) {
  const m = x.matched.filter(m => m.where === 'method').map(m => m.term);
  return m.length ? ` · ${h(m.join(', '))} only in the method` : '';
}

function drawResults() {
  const el = $('#results'); if (!el) return;
  if (!live().length) {
    el.innerHTML = `<div class="empty"><h2>No recipes yet</h2><p>Import your recipes from Notes, or add one by hand.</p>
      <div class="btn-row"><a class="btn" href="#/import">Import from Notes</a><a class="btn secondary" href="#/new">Add a recipe</a></div></div>`;
    return;
  }
  const res = S.index.search(S.query, S.filters);
  S.lastSearch = res;
  const n = res.results.length;
  const full = res.terms.length ? res.results.filter(x => !x.missing.length).length : n;
  let head = '';
  if (res.terms.length > 1) head = full ? `${full} with all ${res.terms.length}, then closest matches` : `No recipe has all ${res.terms.length}. Closest matches:`;
  else head = `${n} recipe${n === 1 ? '' : 's'}`;
  el.innerHTML = `<div class="count"><span>${h(head)}</span>${S.selecting ? `<button class="btn ghost" id="selAll" style="padding:4px 0">Select all</button>` : ''}</div>
    <ul class="results">${res.results.slice(0, 200).map(x => {
      const r = x.r;
      const multi = res.terms.length > 1;
      const match = multi ? (x.missing.length
        ? `<div class="match part">Has ${x.matched.length} of ${res.terms.length} · missing ${h(x.missing.join(', '))}${inText(x)}</div>`
        : `<div class="match full">Has all ${res.terms.length}${inText(x)}</div>`) : '';
      const sel = S.selected.has(r.id);
      return `<li class="card ${sel ? 'selected' : ''}"><a class="result" href="#/r/${r.id}" data-id="${r.id}">
        ${S.selecting ? '<span class="select-box"></span>' : ''}
        <div class="body"><h3>${r.favourite ? '<span class="fav">★</span> ' : ''}${h(r.title)}</h3>
        <div>${catTags(r)}${r.reviewed ? '' : '<span class="tag warn">not reviewed</span>'}</div>
        <div class="ings">${highlightIngs(r, x.hitIngs)}</div>${match}</div></a></li>`;
    }).join('')}</ul>${n > 200 ? '<p class="hint">Showing the first 200. Narrow your search to see more.</p>' : ''}
    ${!n ? '<div class="empty"><p>Nothing found. Try fewer words, or clear the filters.</p></div>' : ''}`;
  if (S.selecting) {
    el.querySelectorAll('a.result').forEach(a => a.onclick = e => {
      e.preventDefault(); const id = a.dataset.id;
      S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
      a.parentElement.classList.toggle('selected'); drawSelectBar();
    });
    const sa = $('#selAll'); if (sa) sa.onclick = () => { res.results.forEach(x => S.selected.add(x.r.id)); drawResults(); };
  }
  drawSelectBar();
}

function drawSelectBar() {
  document.querySelector('.select-bar')?.remove();
  if (!S.selecting || render.current !== '/') return;
  const bar = document.createElement('div'); bar.className = 'select-bar';
  const n = S.selected.size;
  bar.innerHTML = `<span>${n} selected</span><button class="btn" ${n ? '' : 'disabled'}>Share</button>`;
  bar.querySelector('button').onclick = () => openShare(S.recipes.filter(r => S.selected.has(r.id)));
  document.body.appendChild(bar);
}
window.addEventListener('hashchange', () => { document.querySelector('.select-bar')?.remove(); closeSheet(); });

// ---------------- Recipe view ----------------
route(/^\/r\/(.+)$/, id => {
  const r = byId(id);
  if (!r || r.deleted) { view.innerHTML = '<div class="empty"><h2>Recipe not found</h2></div>'; return; }
  showBack('#/'); setTitle('');
  topAction(ICON.star(r.favourite), async () => { r.favourite = !r.favourite; await saveRecipe(r); render(); }, 'Favourite');
  topAction(ICON.share, () => openShare([r]), 'Share');
  topAction('Edit', () => go('#/edit/' + r.id));
  const hit = S.lastSearch?.results.find(x => x.r.id === id)?.hitIngs;
  const listed = r.ingredients.map((i, k) => ({ i, k }));
  let group = null;
  const ingHtml = listed.map(({ i, k }) => {
    let g = '';
    if ((i.group || '') !== (group || '')) { group = i.group || ''; if (group) g = `<li class="group">For the ${h(group)}</li>`; }
    const alt = i.alternatives?.length ? `<span class="sub">or ${h(i.alternatives.join(' / '))}</span>` : '';
    const note = i.note ? `<span class="sub">${h(i.note)}</span>` : '';
    const qty = (i.qty || i.unit) ? h([i.qty, i.unit].filter(Boolean).join(' ')) : `<button data-addqty="${k}">+ amount</button>`;
    const name = hit?.has(k) ? `<mark>${h(i.name)}</mark>` : h(i.name);
    return g + `<li><span class="qty">${qty}</span><span class="name">${name}${i.optional ? '<span class="opt">optional</span>' : ''}${alt}${note}</span></li>`;
  }).join('');
  const fromText = r.ingredients.some(i => i.fromText);
  view.innerHTML = `
    <article class="recipe-head">
      <h2>${h(r.title)}</h2>
      <div>${catTags(r)}${(r.tags || []).map(t => `<span class="tag">${h(t)}</span>`).join('')}</div>
      ${r.serves ? `<div class="meta">Serves ${h(r.serves)}</div>` : ''}
      ${r.description ? `<p class="desc">${h(r.description)}</p>` : ''}
      ${r.reviewed ? '' : `<div class="review-banner"><span>Sorted automatically. Is the course and meal right?</span><span style="display:flex;gap:6px"><button class="btn secondary" id="fixCat">Change</button><button class="btn good" id="okCat">Yes</button></span></div>`}
    </article>
    ${r.ingredients.length ? `<section class="section"><h3>Ingredients</h3>
      ${fromText ? '<p class="hint" style="margin-top:-4px">Some of these were picked out of the recipe text. Tap “+ amount” to add a measurement.</p>' : ''}
      <ul class="ing-list">${ingHtml}</ul></section>` : ''}
    ${r.method ? `<section class="section"><h3>${r.ingredients.some(i => !i.fromText) ? 'Method' : 'Recipe'}</h3><div class="method">${h(r.method)}</div></section>` : ''}
    ${r.notes ? `<section class="section"><h3>Notes</h3><div class="method">${h(r.notes)}</div></section>` : ''}
    <div class="btn-row"><button class="btn secondary" id="shareBtn">${ICON.share} Share</button><a class="btn secondary" href="#/edit/${r.id}">Edit</a></div>`;
  $('#shareBtn').onclick = () => openShare([r]);
  const ok = $('#okCat'); if (ok) ok.onclick = async () => { r.reviewed = true; await saveRecipe(r); toast('Marked as reviewed'); render(); };
  const fx = $('#fixCat'); if (fx) fx.onclick = () => openCategorySheet(r);
  view.querySelectorAll('[data-addqty]').forEach(b => b.onclick = () => {
    const k = +b.dataset.addqty; const span = b.parentElement;
    span.innerHTML = `<input type="text" placeholder="e.g. 200 g" aria-label="Amount">`;
    const inp = span.querySelector('input'); inp.focus();
    const commit = async () => {
      const v = inp.value.trim(); if (!v) { render(); return; }
      const p = parseIngredientLine(v + ' x');
      const ing = r.ingredients[k];
      ing.qty = p.qty || v; ing.unit = p.qty ? p.unit : '';
      delete ing.fromText;
      await saveRecipe(r); render();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = ''; inp.blur(); } });
    inp.addEventListener('blur', commit, { once: true });
  });
});

// ---------------- Sheets ----------------
function openSheet(html, onMount) {
  const sh = $('#sheet'), bd = $('#sheetBackdrop');
  sh.innerHTML = html; sh.hidden = false; bd.hidden = false;
  bd.onclick = closeSheet;
  onMount?.(sh);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true; }

function openCategorySheet(r, after) {
  const chips = (list, key) => list.map(c => `<button class="chip ${(r[key] || []).includes(c) ? 'on' : ''}" data-k="${key}" data-c="${c}">${c}</button>`).join('');
  openSheet(`<h2>${h(r.title)}</h2>
    <div class="chip-label">Course</div><div class="chips wrap">${chips(COURSES, 'courses')}</div>
    <div class="chip-label">Meal</div><div class="chips wrap">${chips(MEAL_TYPES, 'mealTypes')}</div>
    <div class="btn-row"><button class="btn block" id="catSave">Save</button></div>`, sh => {
    sh.querySelectorAll('[data-k]').forEach(b => b.onclick = () => b.classList.toggle('on'));
    $('#catSave', sh).onclick = async () => {
      r.courses = [...sh.querySelectorAll('[data-k=courses].on')].map(b => b.dataset.c);
      r.mealTypes = [...sh.querySelectorAll('[data-k=mealTypes].on')].map(b => b.dataset.c);
      r.reviewed = true; await saveRecipe(r); closeSheet(); toast('Saved'); after ? after() : render();
    };
  });
}

function openShare(recipes) {
  if (!recipes.length) return;
  const text = shareText(recipes);
  const title = recipes.length === 1 ? recipes[0].title : recipes.length + ' recipes';
  const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  const mail = 'mailto:?subject=' + encodeURIComponent(recipes.length === 1 ? 'Recipe: ' + title : 'Some recipes for you') + '&body=' + encodeURIComponent(text);
  openSheet(`<h2>Share ${h(title)}</h2>
    <div class="share-grid">
      <a class="btn" href="${h(wa)}" target="_blank" rel="noopener" style="background:#25d366;color:#fff">WhatsApp</a>
      <a class="btn" href="${h(mail)}">Email</a>
      ${navigator.share ? '<button class="btn secondary" id="shMore">More…</button>' : ''}
      <button class="btn secondary" id="shCopy">Copy text</button>
    </div>
    <div class="share-preview">${h(text)}</div>
    <p class="hint" style="margin-top:10px">Sharing needs an internet connection. “Copy text” works offline; paste it later.</p>`, sh => {
    const more = $('#shMore', sh); if (more) more.onclick = async () => { try { await navigator.share({ title, text }); closeSheet(); } catch { } };
    $('#shCopy', sh).onclick = async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied'); }
      catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied'); }
    };
  });
}

// ---------------- Edit / new ----------------
route(/^\/new$/, () => editView(newRecipe(), true));
route(/^\/edit\/(.+)$/, id => { const r = byId(id); if (r) editView(structuredClone(r), false); });

function editView(r, isNew) {
  if (isNew) setTab('new');
  showBack(isNew ? '#/' : '#/r/' + r.id);
  setTitle(isNew ? 'New recipe' : 'Edit recipe');
  const chips = (list, key) => list.map(c => `<button type="button" class="chip ${(r[key] || []).includes(c) ? 'on' : ''}" data-k="${key}" data-c="${c}">${c}</button>`).join('');
  view.innerHTML = `
    <form id="ef" autocomplete="off">
      <label class="field"><span>Name</span><input type="text" name="title" value="${h(r.title)}" required placeholder="e.g. Spaghetti with sausage and parsley"></label>
      <div class="field-label">Course</div><div class="chips wrap" id="cCourses">${chips(COURSES, 'courses')}</div>
      <div class="field-label" style="margin-top:8px">Meal</div><div class="chips wrap" id="cMeals">${chips(MEAL_TYPES, 'mealTypes')}</div>
      ${isNew ? '<button type="button" class="btn ghost" id="autoCat" style="padding-left:0">Suggest course and meal for me</button>' : ''}
      <label class="field"><span>Serves</span><input type="text" name="serves" value="${h(r.serves)}" placeholder="e.g. 4" inputmode="text"></label>
      <div class="field-label">Ingredients</div>
      <p class="hint">Amounts are optional. Tick “optional” for extras, and put swaps in “or”.</p>
      <div class="ing-edit" id="ings"></div>
      <div class="btn-row"><button type="button" class="btn secondary" id="addIng">+ Add ingredient</button><button type="button" class="btn secondary" id="pasteIngs">Paste a list</button></div>
      <label class="field"><span>Method</span><textarea name="method" class="tall" placeholder="How to make it">${h(r.method)}</textarea></label>
      <button type="button" class="btn ghost" id="findIngs" style="padding-left:0">Find ingredients mentioned in the method</button>
      <label class="field"><span>Notes</span><textarea name="notes" placeholder="Tips, variations, wine pairing…">${h(r.notes)}</textarea></label>
      <label class="field"><span>Tags (comma separated)</span><input type="text" name="tags" value="${h((r.tags || []).join(', '))}" placeholder="e.g. vegetarian, party, quick"></label>
      <div class="btn-row"><button class="btn" type="submit">Save</button></div>
      ${isNew ? '' : '<div class="btn-row"><button type="button" class="btn danger" id="del">Delete this recipe</button></div>'}
    </form>`;
  const ings = $('#ings');
  const row = (i = { name: '', qty: '', unit: '', optional: false, alternatives: [], note: '' }) => {
    const d = document.createElement('div'); d.className = 'ing-row' + (!i.qty && i.name ? ' missing' : '');
    d.innerHTML = `<input class="q" placeholder="Qty" value="${h(i.qty)}" aria-label="Quantity" inputmode="decimal">
      <input class="u" placeholder="Unit" value="${h(i.unit)}" aria-label="Unit" list="units">
      <input class="n" placeholder="Ingredient" value="${h(i.name)}" aria-label="Ingredient">
      <button type="button" class="rm" aria-label="Remove">×</button>
      <div class="more"><input class="a" placeholder="or… (swap)" value="${h((i.alternatives || []).join(' / '))}" aria-label="Alternatives"><input class="no" placeholder="note, e.g. chopped" value="${h(i.note)}" aria-label="Note"></div>
      <label class="opt-toggle"><span><input type="checkbox" class="o" ${i.optional ? 'checked' : ''}> optional</span>${i.group ? `<span>in “${h(i.group)}”</span>` : ''}</label>`;
    d.dataset.group = i.group || '';
    d.querySelector('.rm').onclick = () => d.remove();
    d.querySelector('.q').addEventListener('input', e => d.classList.toggle('missing', !e.target.value));
    ings.appendChild(d); return d;
  };
  r.ingredients.forEach(i => row(i));
  if (!r.ingredients.length) row();
  if (!document.getElementById('units')) {
    const dl = document.createElement('datalist'); dl.id = 'units';
    dl.innerHTML = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'cups', 'pinch', 'clove', 'cloves', 'bunch', 'handful', 'can', 'pack', 'slice', 'oz', 'lb'].map(u => `<option value="${u}">`).join('');
    document.body.appendChild(dl);
  }
  $('#addIng').onclick = () => row().querySelector('.n').focus();
  $('#pasteIngs').onclick = () => openSheet(`<h2>Paste ingredients</h2><p class="hint">One per line, like “2 tbsp olive oil” or “parsley (or coriander), optional”.</p>
    <textarea id="pasteTa" class="tall"></textarea><div class="btn-row"><button class="btn block" id="pasteGo">Add these</button></div>`, sh => {
    $('#pasteGo', sh).onclick = () => {
      $('#pasteTa', sh).value.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => { const p = parseIngredientLine(l); if (p.name) row(p); });
      [...ings.children].forEach(c => { if (!c.querySelector('.n').value && !c.querySelector('.q').value) c.remove(); });
      closeSheet();
    };
  });
  $('#findIngs').onclick = () => {
    const have = new Set([...ings.querySelectorAll('.n')].map(i => norm(i.value)));
    const found = extractIngredients($('[name=method]').value).filter(n => !have.has(norm(n)));
    [...ings.children].forEach(c => { if (!c.querySelector('.n').value && !c.querySelector('.q').value) c.remove(); });
    found.forEach(n => row({ name: n, qty: '', unit: '', optional: false, alternatives: [], note: '' }));
    toast(found.length ? `Added ${found.length} ingredient${found.length === 1 ? '' : 's'}` : 'No new ingredients found');
  };
  view.querySelectorAll('[data-k]').forEach(b => b.onclick = () => b.classList.toggle('on'));
  const collect = () => {
    const f = $('#ef');
    r.title = f.title.value.trim();
    r.serves = f.serves.value.trim();
    r.method = f.method.value.trim();
    r.notes = f.notes.value.trim();
    r.tags = f.tags.value.split(',').map(s => s.trim()).filter(Boolean);
    r.courses = [...view.querySelectorAll('[data-k=courses].on')].map(b => b.dataset.c);
    r.mealTypes = [...view.querySelectorAll('[data-k=mealTypes].on')].map(b => b.dataset.c);
    r.ingredients = [...ings.children].map(d => ({
      qty: d.querySelector('.q').value.trim(), unit: d.querySelector('.u').value.trim(), name: d.querySelector('.n').value.trim(),
      alternatives: d.querySelector('.a').value.split(/\s*\/\s*|\s*,\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean),
      note: d.querySelector('.no').value.trim(), optional: d.querySelector('.o').checked,
      ...(d.dataset.group ? { group: d.dataset.group } : {}),
    })).filter(i => i.name);
  };
  const ac = $('#autoCat'); if (ac) ac.onclick = () => {
    collect(); const c = categorize(r);
    view.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('on', (b.dataset.k === 'courses' ? c.courses : c.mealTypes).includes(b.dataset.c)));
    toast(c.courses.length || c.mealTypes.length ? 'Suggested. Adjust if needed.' : 'No suggestion; please pick.');
  };
  $('#ef').onsubmit = async e => {
    e.preventDefault(); collect();
    if (!r.title) { toast('Please give it a name'); return; }
    r.reviewed = true;
    await saveRecipe(r); toast('Saved');
    history.replaceState(null, '', '#/r/' + r.id); render();
  };
  const del = $('#del'); if (del) del.onclick = async () => {
    if (!confirm('Delete “' + r.title + '”?')) return;
    const orig = byId(r.id); orig.deleted = true; await saveRecipe(orig); toast('Deleted'); go('#/');
  };
}

// ---------------- Review ----------------
route(/^\/review$/, () => {
  setTab('review'); setTitle('Review');
  const list = live().filter(r => !r.reviewed).sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
  if (!list.length) { view.innerHTML = `<div class="empty"><h2>All reviewed</h2><p>Every recipe has had its course and meal checked.</p></div>`; return; }
  const chips = (r, list2, key) => list2.map(c => `<button class="chip small ${(r[key] || []).includes(c) ? 'on' : ''}" data-id="${r.id}" data-k="${key}" data-c="${c}">${c}</button>`).join('');
  view.innerHTML = `<p class="hint">These were sorted automatically. Tap to change the course and meal, then tick. ${list.length} to go.</p>
    <ul class="results">${list.slice(0, 30).map(r => `<li class="card import-item" data-card="${r.id}">
      <h3 style="justify-content:space-between"><a href="#/r/${r.id}" style="color:inherit;text-decoration:none">${h(r.title)}</a></h3>
      <div class="sub">${h(r.ingredients.slice(0, 8).map(i => i.name).join(', '))}</div>
      <div class="chips wrap">${chips(r, COURSES, 'courses')}</div>
      <div class="chips wrap">${chips(r, MEAL_TYPES, 'mealTypes')}</div>
      <button class="btn good block" data-ok="${r.id}">Looks right ✓</button></li>`).join('')}</ul>
    ${list.length > 30 ? `<p class="hint">Showing 30 at a time.</p>` : ''}
    <div class="btn-row"><button class="btn secondary" id="okAll">Mark all ${Math.min(30, list.length)} shown as right</button></div>`;
  view.querySelectorAll('[data-k]').forEach(b => b.onclick = async () => {
    const r = byId(b.dataset.id); const k = b.dataset.k; const c = b.dataset.c;
    r[k] = (r[k] || []).includes(c) ? r[k].filter(x => x !== c) : [...(r[k] || []), c];
    b.classList.toggle('on'); await saveRecipe(r);
  });
  view.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    const r = byId(b.dataset.ok); r.reviewed = true; await saveRecipe(r);
    const card = view.querySelector(`[data-card="${r.id}"]`); card.style.transition = '.2s'; card.style.opacity = '0';
    setTimeout(render, 200);
  });
  $('#okAll').onclick = async () => { for (const r of list.slice(0, 30)) { r.reviewed = true; r.updatedAt = Date.now(); } await db.putRecipes(list.slice(0, 30)); rebuild(); scheduleSync(); render(); };
});

// ---------------- Import ----------------
route(/^\/import$/, () => {
  setTab('import'); setTitle('Import');
  if (S.importDraft) return drawImportPreview();
  view.innerHTML = `
    <div class="callout"><b>From Apple Notes:</b> open a note, tap in it, Select All, Copy, then paste below. You can paste many recipes at once: put a line of dashes (---) or two blank lines between them.</div>
    <label class="field"><span>Recipe text</span><textarea id="impTa" class="tall" placeholder="Paste recipes here"></textarea></label>
    <div class="btn-row"><button class="btn" id="impGo">Read recipes</button>
      <label class="btn secondary" style="position:relative">Choose a file<input type="file" id="impFile" accept=".txt,.md,.json,text/plain,application/json" style="position:absolute;inset:0;opacity:0"></label></div>
    <p class="hint">A backup file (.json) from this app can be loaded here too.</p>`;
  $('#impGo').onclick = () => startImport($('#impTa').value);
  $('#impFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    if (/\.json$/i.test(f.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) return importBackup(text);
    $('#impTa').value = text; startImport(text);
  };
});

function startImport(text) {
  if (!text.trim()) { toast('Paste some recipe text first'); return; }
  const blocks = splitRecipes(text);
  S.importDraft = blocks.map(b => ({ r: parseRecipe(b), keep: true }));
  drawImportPreview();
}

function drawImportPreview() {
  const d = S.importDraft;
  const existing = new Set(live().map(r => norm(r.title)));
  view.innerHTML = `<p class="hint">Found ${d.length} recipe${d.length === 1 ? '' : 's'}. Untick any that aren’t recipes. You can fix course and meal later in Review.</p>
    <ul class="results">${d.map((x, k) => `<li class="card import-item">
      <h3><input type="checkbox" data-keep="${k}" ${x.keep ? 'checked' : ''}> ${h(x.r.title)}</h3>
      <div class="sub">${catTags(x.r) || '<span class="tag warn">no category yet</span>'} ${existing.has(norm(x.r.title)) ? '<span class="tag warn">already in your book</span>' : ''}</div>
      <div class="sub">${x.r.ingredients.length} ingredients: ${h(x.r.ingredients.slice(0, 6).map(i => i.name).join(', '))}${x.r.ingredients.length > 6 ? '…' : ''}</div>
      <details><summary>Original text</summary><pre>${h(x.r.source)}</pre></details></li>`).join('')}</ul>
    <div class="btn-row"><button class="btn" id="impSave">Import ${d.filter(x => x.keep).length}</button><button class="btn secondary" id="impCancel">Cancel</button></div>`;
  view.querySelectorAll('[data-keep]').forEach(c => c.onchange = () => { d[+c.dataset.keep].keep = c.checked; $('#impSave').textContent = 'Import ' + d.filter(x => x.keep).length; });
  $('#impCancel').onclick = () => { S.importDraft = null; render(); };
  $('#impSave').onclick = async () => {
    const rs = d.filter(x => x.keep).map(x => { const r = x.r; delete r.source; r.updatedAt = Date.now(); return r; });
    // Prose-only recipes: also pick ingredients out of the text so ingredient search works.
    rs.forEach(addTextIngredients);
    await db.putRecipes(rs); S.recipes.push(...rs); rebuild(); scheduleSync();
    S.importDraft = null; toast(`Imported ${rs.length}`); go('#/review');
  };
}

function addTextIngredients(r) {
  const have = new Set(r.ingredients.map(i => norm(i.name)));
  const all = [...have].join(' | ');
  for (const n of extractIngredients(r.title + '\n' + r.method)) {
    const k = norm(n); if (have.has(k) || all.includes(k)) continue;
    have.add(k); r.ingredients.push({ name: n, qty: '', unit: '', optional: false, alternatives: [], note: '', fromText: true });
  }
}

async function importBackup(text) {
  let data; try { data = JSON.parse(text); } catch { toast('That file isn’t a valid backup'); return; }
  const incoming = Array.isArray(data) ? data : data.recipes;
  if (!Array.isArray(incoming)) { toast('No recipes found in that file'); return; }
  let added = 0, updated = 0;
  for (const r of incoming) {
    if (!r || !r.id || !r.title) continue;
    const cur = byId(r.id);
    if (!cur) { S.recipes.push(r); added++; }
    else if ((r.updatedAt || 0) > (cur.updatedAt || 0)) { Object.assign(cur, r); updated++; }
  }
  if (data.synonyms && (data.synonymsUpdatedAt || 0) > S.synonymsUpdatedAt) { S.synonyms = data.synonyms; S.synonymsUpdatedAt = data.synonymsUpdatedAt; await db.setSetting('synonyms', { list: S.synonyms, at: S.synonymsUpdatedAt }); }
  await db.putRecipes(S.recipes); rebuild(); scheduleSync();
  toast(`Loaded: ${added} new, ${updated} updated`); go('#/');
}

// ---------------- Settings ----------------
route(/^\/settings$/, () => {
  setTab('settings'); setTitle('More');
  const n = live().length;
  const s = S.sync;
  const syncLine = s?.token ? (s.error ? `<span style="color:#c0392b">${h(s.error)}</span>` : s.lastSync ? 'Last synced ' + new Date(s.lastSync).toLocaleString() : 'Not synced yet') : 'Off';
  view.innerHTML = `
    <div class="settings-group">Your recipe book</div>
    <div class="card"><ul class="list-plain">
      <li><a class="row-link" href="#/synonyms">Ingredient names that mean the same <small>${S.synonyms.length} groups ›</small></a></li>
      <li><a class="row-link" href="#/sync">Sync between phone and Mac <small>${h(syncLine)} ›</small></a></li>
      <li><button class="row-link" id="exportJson">Download a backup <small>${n} recipes</small></button></li>
      <li><button class="row-link" id="exportTxt">Export all as plain text <small>.txt</small></button></li>
      <li><a class="row-link" href="#/import">Import recipes or a backup <small>›</small></a></li>
    </ul></div>
    <div class="settings-group">Using it offline</div>
    <div class="card" style="padding:14px">
      <p style="margin-top:0"><b>On iPhone:</b> open this page in Safari, tap the Share button, then <b>Add to Home Screen</b>. Open it from the new icon. Everything is stored on the phone, so it works with no signal.</p>
      <p style="margin-bottom:0"><b>On the Mac:</b> in Safari, choose File › <b>Add to Dock</b>.</p>
      <p class="hint" style="margin:10px 0 0">${'serviceWorker' in navigator && navigator.serviceWorker.controller ? '✓ Ready for offline use on this device.' : 'Offline copy is being prepared; reload once while online.'}</p>
    </div>
    <div class="settings-group">Danger zone</div>
    <div class="card"><ul class="list-plain"><li><button class="row-link" id="wipe" style="color:#c0392b">Remove all recipes from this device</button></li></ul></div>
    <p class="hint" style="text-align:center;margin-top:20px">Recipe Book · made for Andy</p>`;
  $('#exportJson').onclick = () => download(`recipe-book-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ app: 'recipe-book', version: 1, savedAt: Date.now(), recipes: S.recipes, synonyms: S.synonyms, synonymsUpdatedAt: S.synonymsUpdatedAt }, null, 1), 'application/json');
  $('#exportTxt').onclick = () => download('recipes.txt', shareText(live().sort((a, b) => norm(a.title).localeCompare(norm(b.title)))).replace(/\*/g, ''), 'text/plain');
  $('#wipe').onclick = async () => {
    if (!confirm('Remove every recipe from this device? Download a backup first if unsure.')) return;
    for (const r of S.recipes) await db.deleteRecipeHard(r.id);
    S.recipes = []; rebuild(); toast('Removed'); render();
  };
});

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

route(/^\/synonyms$/, () => {
  showBack('#/settings'); setTitle('Same ingredient, other names');
  view.innerHTML = `<p class="hint">One group per line, names separated by commas. Searching for any name finds recipes with the others. Accents and plurals are handled automatically.</p>
    <textarea id="synTa" class="tall" style="min-height:55vh" spellcheck="false">${h(S.synonyms.map(g => g.join(', ')).join('\n'))}</textarea>
    <div class="btn-row"><button class="btn" id="synSave">Save</button><button class="btn secondary" id="synReset">Restore defaults</button></div>`;
  $('#synSave').onclick = async () => {
    S.synonyms = $('#synTa').value.split('\n').map(l => l.split(',').map(s => s.trim()).filter(Boolean)).filter(g => g.length > 1);
    S.synonymsUpdatedAt = Date.now();
    await db.setSetting('synonyms', { list: S.synonyms, at: S.synonymsUpdatedAt }); rebuild(); scheduleSync(); toast('Saved');
  };
  $('#synReset').onclick = () => { $('#synTa').value = DEFAULT_SYNONYMS.map(g => g.join(', ')).join('\n'); };
});

route(/^\/sync$/, () => {
  showBack('#/settings'); setTitle('Sync');
  const s = S.sync || {};
  view.innerHTML = s.token ? `
    <div class="callout">Sync is <b>on</b>. Changes are sent to your private GitHub storage whenever you’re online, and changes from your other devices come back the same way.</div>
    <p>${s.error ? `<span style="color:#c0392b">${h(s.error)}</span>` : s.lastSync ? 'Last synced ' + h(new Date(s.lastSync).toLocaleString()) : 'Not synced yet.'}</p>
    <div class="btn-row"><button class="btn" id="syncGo">Sync now</button><button class="btn danger" id="syncOff">Turn off on this device</button></div>`
    : `
    <p>Sync keeps your phone and Mac in step, using a private storage space in your own GitHub account. It's free.</p>
    <ol class="steps">
      <li>On GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">New fine-grained token</a>.</li>
      <li>Name it “Recipe Book”, set Expiration to the longest allowed (or “No expiration”).</li>
      <li>Under <b>Permissions › Account permissions</b>, set <b>Gists</b> to <b>Read and write</b>. Nothing else is needed.</li>
      <li>Tap <b>Generate token</b>, copy it, and paste it below. Do the same paste on your other device.</li>
    </ol>
    <label class="field"><span>Access code (token)</span><input type="password" id="tok" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <div class="btn-row"><button class="btn" id="syncOn">Turn on sync</button></div>
    <p class="hint">The code is kept only on this device and only lets the app read and write gists (small private files), nothing else in your account.</p>`;
  const on = $('#syncOn'); if (on) on.onclick = async () => {
    const token = $('#tok').value.trim(); if (!token) return toast('Paste the access code first');
    S.sync = { token }; await doSync(true); render();
  };
  const goB = $('#syncGo'); if (goB) goB.onclick = async () => { await doSync(true); render(); };
  const off = $('#syncOff'); if (off) off.onclick = async () => { S.sync = null; await db.setSetting('sync', null); toast('Sync turned off on this device'); render(); };
});

// ---------------- Sync ----------------
let syncTimer, syncing = false;
function scheduleSync() { if (!S.sync?.token) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => doSync(false), 2500); }
async function doSync(manual) {
  if (!S.sync?.token || syncing) return;
  if (!navigator.onLine) { if (manual) toast('You’re offline. Changes will sync when you’re back online.'); return; }
  syncing = true;
  try {
    const res = await syncNow({ token: S.sync.token, gistId: S.sync.gistId, recipes: S.recipes, synonyms: S.synonyms, synonymsUpdatedAt: S.synonymsUpdatedAt });
    S.sync = { ...S.sync, gistId: res.gistId, lastSync: Date.now(), error: '' };
    if (res.changedLocal) { S.recipes = res.recipes; await db.putRecipes(S.recipes); }
    if (res.synonyms && res.synonymsUpdatedAt > S.synonymsUpdatedAt) { S.synonyms = res.synonyms; S.synonymsUpdatedAt = res.synonymsUpdatedAt; await db.setSetting('synonyms', { list: S.synonyms, at: S.synonymsUpdatedAt }); }
    rebuild();
    if (res.changedLocal && (render.current === '/' || render.current === '/review')) render();
    if (manual) toast(res.changedLocal ? `Synced: ${res.changedLocal} updates received` : 'Synced');
  } catch (e) {
    S.sync = { ...S.sync, error: e.message };
    if (manual) toast(e.message);
  } finally {
    syncing = false;
    await db.setSetting('sync', S.sync);
  }
}

// ---------------- Boot ----------------
async function boot() {
  S.recipes = await db.allRecipes();
  const syn = await db.getSetting('synonyms');
  if (syn?.list) { S.synonyms = syn.list; S.synonymsUpdatedAt = syn.at || 0; }
  S.sync = (await db.getSetting('sync')) || null;
  rebuild();
  persist();
  window.addEventListener('hashchange', render);
  render();
  const pill = $('#offlinePill');
  const net = () => { pill.hidden = navigator.onLine; if (navigator.onLine) doSync(false); };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') doSync(false); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();
