/* IndexedDB wrapper for Random Jingle (Phase 1, local only). */
const RJDB = (() => {
  const DB_NAME = 'random-jingle-db';
  const DB_VERSION = 1;
  const STORE_CATEGORIES = 'categories';
  const STORE_JINGLES = 'jingles';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
          const catStore = db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id', autoIncrement: true });
          catStore.createIndex('order', 'order');
        }
        if (!db.objectStoreNames.contains(STORE_JINGLES)) {
          const jingleStore = db.createObjectStore(STORE_JINGLES, { keyPath: 'id', autoIncrement: true });
          jingleStore.createIndex('categoryId', 'categoryId');
          jingleStore.createIndex('order', 'order');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeNames, mode) {
    const db = await open();
    return db.transaction(storeNames, mode);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Categories ----
  async function getAllCategories() {
    const t = await tx(STORE_CATEGORIES, 'readonly');
    const store = t.objectStore(STORE_CATEGORIES);
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function addCategory({ name, color }) {
    const t = await tx(STORE_CATEGORIES, 'readwrite');
    const store = t.objectStore(STORE_CATEGORIES);
    const count = await reqToPromise(store.count());
    const id = await reqToPromise(store.add({ name, color, order: count, createdAt: Date.now() }));
    return id;
  }

  async function updateCategory(id, changes) {
    const t = await tx(STORE_CATEGORIES, 'readwrite');
    const store = t.objectStore(STORE_CATEGORIES);
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('Kategorie nicht gefunden');
    const updated = { ...existing, ...changes, id };
    await reqToPromise(store.put(updated));
    return updated;
  }

  async function deleteCategory(id) {
    const t = await tx([STORE_CATEGORIES, STORE_JINGLES], 'readwrite');
    const catStore = t.objectStore(STORE_CATEGORIES);
    const jingleStore = t.objectStore(STORE_JINGLES);
    const idx = jingleStore.index('categoryId');
    const jingles = await reqToPromise(idx.getAll(id));
    await Promise.all(jingles.map((j) => reqToPromise(jingleStore.delete(j.id))));
    await reqToPromise(catStore.delete(id));
  }

  // ---- Jingles ----
  async function getAllJingles() {
    const t = await tx(STORE_JINGLES, 'readonly');
    const store = t.objectStore(STORE_JINGLES);
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function getJinglesByCategory(categoryId) {
    const t = await tx(STORE_JINGLES, 'readonly');
    const store = t.objectStore(STORE_JINGLES);
    const idx = store.index('categoryId');
    const all = await reqToPromise(idx.getAll(categoryId));
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function addJingle({ name, categoryId, color, blob, mimeType }) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const count = await reqToPromise(store.count());
    const id = await reqToPromise(store.add({
      name, categoryId, color: color || null, blob, mimeType,
      order: count, createdAt: Date.now(),
    }));
    return id;
  }

  async function updateJingle(id, changes) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('Jingle nicht gefunden');
    const updated = { ...existing, ...changes, id };
    await reqToPromise(store.put(updated));
    return updated;
  }

  async function deleteJingle(id) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    await reqToPromise(store.delete(id));
  }

  return {
    getAllCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    getAllJingles,
    getJinglesByCategory,
    addJingle,
    updateJingle,
    deleteJingle,
  };
})();
