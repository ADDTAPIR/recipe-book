// Sync between devices through one private ("secret") GitHub Gist in Andy's own account.
// Each device keeps a full copy in IndexedDB; sync merges by id, newest edit wins.
const API = 'https://api.github.com';
const FILE = 'recipe-book.json';
const DESC = 'Recipe Book sync data (used by the Recipe Book app)';

async function gh(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub did not accept the access code. It may have expired; create a new one.');
  if (res.status === 403 || res.status === 404) throw new Error('The access code needs the "Gists" permission (read and write).');
  if (!res.ok) throw new Error('GitHub error ' + res.status);
  return res.json();
}

async function findGist(token) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(token, `/gists?per_page=100&page=${page}`);
    const g = list.find(x => x.files && x.files[FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return null;
}

async function readGist(token, id) {
  const g = await gh(token, '/gists/' + id);
  const f = g.files[FILE];
  if (!f) return { recipes: [], synonyms: null };
  let text = f.content;
  if (f.truncated) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
  try { return JSON.parse(text); } catch { return { recipes: [], synonyms: null }; }
}

export function mergeRecipes(local, remote) {
  const byId = new Map(local.map(r => [r.id, r]));
  let changedLocal = 0;
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) { byId.set(r.id, r); changedLocal++; }
  }
  return { merged: [...byId.values()], changedLocal };
}

// Returns { recipes, synonyms, gistId, changedLocal }
export async function syncNow({ token, gistId, recipes, synonyms, synonymsUpdatedAt }) {
  if (!gistId) gistId = await findGist(token);
  let remote = { recipes: [], synonyms: null, synonymsUpdatedAt: 0 };
  if (gistId) remote = await readGist(token, gistId);
  const { merged, changedLocal } = mergeRecipes(recipes, remote.recipes || []);
  let syn = synonyms, synAt = synonymsUpdatedAt || 0;
  if (remote.synonyms && (remote.synonymsUpdatedAt || 0) > synAt) { syn = remote.synonyms; synAt = remote.synonymsUpdatedAt; }
  const payload = JSON.stringify({ app: 'recipe-book', version: 1, savedAt: Date.now(), recipes: merged, synonyms: syn, synonymsUpdatedAt: synAt });
  const body = JSON.stringify({ description: DESC, files: { [FILE]: { content: payload } } });
  if (gistId) await gh(token, '/gists/' + gistId, { method: 'PATCH', body });
  else gistId = (await gh(token, '/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: payload } } }) })).id;
  return { recipes: merged, synonyms: syn, synonymsUpdatedAt: synAt, gistId, changedLocal };
}
