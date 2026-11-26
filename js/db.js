// Tiny IndexedDB wrapper. Everything lives on the device, so the app works offline.
const DB_NAME = 'recipe-book';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  allRecipes: () => tx('recipes', 'readonly', s => reqP(s.getAll())),
  putRecipe: r => tx('recipes', 'readwrite', s => { s.put(r); }),
  putRecipes: rs => tx('recipes', 'readwrite', s => { rs.forEach(r => s.put(r)); }),
  deleteRecipeHard: id => tx('recipes', 'readwrite', s => { s.delete(id); }),
  getSetting: k => tx('settings', 'readonly', s => reqP(s.get(k))),
  setSetting: (k, v) => tx('settings', 'readwrite', s => { s.put(v, k); }),
};

// Ask the browser not to clear our data when space runs low.
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { }
  return false;
}
