// View-only "family link": a second secret gist that only the owner's app writes to.
// Anyone with the link can read it (that's how secret gists work); nobody else can change it.
import { gh } from './sync.js';

const FILE = 'recipe-book-family.json';
const DESC = 'Recipe Book: view-only copy for family and friends';

export function familyPayload(recipes, synonyms, ownerName, contact) {
  const keep = recipes.filter(r => !r.deleted).map(r => ({
    id: r.id, title: r.title, description: r.description, serves: r.serves, ingredients: r.ingredients,
    method: r.method, notes: r.notes, mealTypes: r.mealTypes, courses: r.courses, cuisines: r.cuisines, tags: r.tags,
    links: r.links, updatedAt: r.updatedAt, reviewed: true,
  }));
  return JSON.stringify({ app: 'recipe-book', kind: 'family', ownerName, contact: contact || {}, publishedAt: Date.now(), recipes: keep, synonyms });
}

export function familyKey(recipes, synonymsUpdatedAt, ownerName) {
  let max = 0; for (const r of recipes) if ((r.updatedAt || 0) > max) max = r.updatedAt;
  return ['v3', recipes.length, max, synonymsUpdatedAt || 0, ownerName].join(':');
}

export async function createFamily(token, payload) {
  const g = await gh(token, '/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: payload } } }) });
  return { gistId: g.id, owner: g.owner?.login || '' };
}

export async function updateFamily(token, gistId, payload) {
  await gh(token, '/gists/' + gistId, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: payload } } }) });
}

export async function deleteFamily(token, gistId) {
  const res = await fetch('https://api.github.com/gists/' + gistId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  if (!res.ok && res.status !== 404) throw new Error('GitHub error ' + res.status);
}

// Viewers: no account needed.
export async function fetchFamily(gistId) {
  const res = await fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (res.status === 404) throw new Error('gone');
  if (!res.ok) throw new Error('GitHub error ' + res.status);
  const g = await res.json();
  const f = g.files && g.files[FILE];
  if (!f) throw new Error('gone');
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  return JSON.parse(text);
}

export function familyLink(gistId) {
  return new URL('./?f=' + gistId, location.href.split('#')[0].split('?')[0]).href;
}
