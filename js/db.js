/* IndexedDB wrapper for Random Jingle.
 * Phase 2: uuid ids (shared with Supabase), updatedAt/dirty bookkeeping and
 * soft-delete tombstones for Last-Write-Wins sync. The app stays
 * offline-first — every write here is local and immediate; RJSync decides
 * separately, and only when online + authenticated, whether/when to push.
 */
const RJDB = (() => {
  const DB_NAME = 'random-jingle-db';
  const DB_VERSION = 2;
  const STORE_CATEGORIES = 'categories';
  const STORE_JINGLES = 'jingles';
  const STORE_META = 'meta';

  let dbPromise = null;
  let currentUserId = null; // set by RJSync on login/logout; null = local-only

  function setCurrentUserId(userId) {
    currentUserId = userId;
  }

  function getCurrentUserId() {
    return currentUserId;
  }

  function createV2Stores(db) {
    const catStore = db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' });
    catStore.createIndex('order', 'order');
    const jingleStore = db.createObjectStore(STORE_JINGLES, { keyPath: 'id' });
    jingleStore.createIndex('categoryId', 'categoryId');
    jingleStore.createIndex('order', 'order');
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: 'key' });
    }
    return { catStore, jingleStore };
  }

  // Migrates v1 (autoincrement integer ids, no sync metadata) to v2 (uuid
  // ids shared with Supabase). Runs inside the versionchange transaction;
  // chaining requests from success callbacks keeps that transaction alive.
  function migrateToV2(db, tx, oldVersion) {
    const hasOldCategories = oldVersion > 0 && db.objectStoreNames.contains(STORE_CATEGORIES);
    if (!hasOldCategories) {
      createV2Stores(db);
      return;
    }

    const oldCatStore = tx.objectStore(STORE_CATEGORIES);
    const oldJingleStore = tx.objectStore(STORE_JINGLES);
    const oldCatsReq = oldCatStore.getAll();

    oldCatsReq.onsuccess = () => {
      const oldJinglesReq = oldJingleStore.getAll();
      oldJinglesReq.onsuccess = () => {
        const oldCats = oldCatsReq.result || [];
        const oldJingles = oldJinglesReq.result || [];

        db.deleteObjectStore(STORE_CATEGORIES);
        db.deleteObjectStore(STORE_JINGLES);
        const { catStore, jingleStore } = createV2Stores(db);

        const now = Date.now();
        const idMap = new Map();
        for (const cat of oldCats) {
          const newId = crypto.randomUUID();
          idMap.set(cat.id, newId);
          catStore.add({
            id: newId,
            name: cat.name,
            color: cat.color,
            order: cat.order ?? 0,
            deleted: false,
            userId: null,
            createdAt: cat.createdAt || now,
            updatedAt: now,
            dirty: true,
          });
        }
        for (const jingle of oldJingles) {
          const newCategoryId = idMap.get(jingle.categoryId);
          if (!newCategoryId) continue;
          jingleStore.add({
            id: crypto.randomUUID(),
            categoryId: newCategoryId,
            name: jingle.name,
            color: jingle.color || null,
            blob: jingle.blob,
            mimeType: jingle.mimeType,
            fileName: jingle.fileName || null,
            storagePath: null,
            order: jingle.order ?? 0,
            deleted: false,
            userId: null,
            createdAt: jingle.createdAt || now,
            updatedAt: now,
            dirty: true,
          });
        }
      };
    };
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;
        if (event.oldVersion < 2) {
          migrateToV2(db, tx, event.oldVersion);
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

  function uuid() {
    return crypto.randomUUID();
  }

  // ---- Meta (key/value: lastSyncAt, etc.) ----
  async function getMeta(key) {
    const t = await tx(STORE_META, 'readonly');
    const row = await reqToPromise(t.objectStore(STORE_META).get(key));
    return row ? row.value : undefined;
  }

  async function setMeta(key, value) {
    const t = await tx(STORE_META, 'readwrite');
    await reqToPromise(t.objectStore(STORE_META).put({ key, value }));
  }

  // ---- Categories ----
  async function getAllCategories() {
    const t = await tx(STORE_CATEGORIES, 'readonly');
    const all = await reqToPromise(t.objectStore(STORE_CATEGORIES).getAll());
    return all.filter((c) => !c.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function addCategory({ name, color }) {
    const t = await tx(STORE_CATEGORIES, 'readwrite');
    const store = t.objectStore(STORE_CATEGORIES);
    const count = await reqToPromise(store.count());
    const now = Date.now();
    const record = {
      id: uuid(),
      name,
      color,
      order: count,
      deleted: false,
      userId: currentUserId,
      createdAt: now,
      updatedAt: now,
      dirty: true,
    };
    await reqToPromise(store.add(record));
    return record.id;
  }

  async function updateCategory(id, changes) {
    const t = await tx(STORE_CATEGORIES, 'readwrite');
    const store = t.objectStore(STORE_CATEGORIES);
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('Kategorie nicht gefunden');
    const updated = { ...existing, ...changes, id, updatedAt: Date.now(), dirty: true };
    await reqToPromise(store.put(updated));
    return updated;
  }

  // Soft delete: the row becomes a tombstone (deleted:true) instead of being
  // removed, so its updatedAt can still win or lose an LWW race and the
  // delete can be pushed to Supabase like any other change. Child jingles
  // are tombstoned too. Rendering-facing getters filter deleted rows out.
  async function deleteCategory(id) {
    const t = await tx([STORE_CATEGORIES, STORE_JINGLES], 'readwrite');
    const catStore = t.objectStore(STORE_CATEGORIES);
    const jingleStore = t.objectStore(STORE_JINGLES);
    const idx = jingleStore.index('categoryId');
    const jingles = await reqToPromise(idx.getAll(id));
    const now = Date.now();

    for (const j of jingles) {
      if (j.deleted) continue;
      await reqToPromise(jingleStore.put({ ...j, deleted: true, blob: null, updatedAt: now, dirty: true }));
    }
    const existingCat = await reqToPromise(catStore.get(id));
    if (existingCat) {
      await reqToPromise(catStore.put({ ...existingCat, deleted: true, updatedAt: now, dirty: true }));
    }
  }

  // ---- Jingles ----
  async function getAllJingles() {
    const t = await tx(STORE_JINGLES, 'readonly');
    const all = await reqToPromise(t.objectStore(STORE_JINGLES).getAll());
    return all.filter((j) => !j.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function getJinglesByCategory(categoryId) {
    const t = await tx(STORE_JINGLES, 'readonly');
    const idx = t.objectStore(STORE_JINGLES).index('categoryId');
    const all = await reqToPromise(idx.getAll(categoryId));
    return all.filter((j) => !j.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async function getJingle(id) {
    const t = await tx(STORE_JINGLES, 'readonly');
    return reqToPromise(t.objectStore(STORE_JINGLES).get(id));
  }

  async function addJingle({ name, categoryId, color, blob, mimeType, fileName, hotkey, trimStart, trimEnd, sourceNote }) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const count = await reqToPromise(store.count());
    const now = Date.now();
    const record = {
      id: uuid(),
      name,
      categoryId,
      color: color || null,
      blob,
      mimeType,
      fileName: fileName || null,
      storagePath: null,
      order: count,
      deleted: false,
      // trimStart/trimEnd/sourceNote can already be known at creation time
      // for a jingle imported from the royalty-free search (Freesound/
      // Jamendo) — the trim editor runs before the jingle is even saved
      // there, unlike the normal upload flow where trimming only happens
      // as a later edit.
      trimStart: trimStart ?? null,
      trimEnd: trimEnd ?? null,
      hotkey: hotkey || null,
      sourceNote: sourceNote || null,
      userId: currentUserId,
      createdAt: now,
      updatedAt: now,
      dirty: true,
    };
    await reqToPromise(store.add(record));
    return record.id;
  }

  async function updateJingle(id, changes) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error('Jingle nicht gefunden');
    const updated = { ...existing, ...changes, id, updatedAt: Date.now(), dirty: true };
    // A new audio file invalidates whatever was previously uploaded to Storage.
    if (changes.blob) updated.storagePath = null;
    await reqToPromise(store.put(updated));
    return updated;
  }

  // Soft delete into the trash (Phase 8): the blob is deliberately kept (not
  // nulled) so a restore within the 24h window needs no re-download. Only
  // purgeExpiredTrash() below does the final, unrecoverable removal.
  async function deleteJingle(id) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const existing = await reqToPromise(store.get(id));
    if (!existing) return;
    const now = Date.now();
    await reqToPromise(store.put({ ...existing, deleted: true, deletedAt: now, updatedAt: now, dirty: true }));
  }

  async function restoreJingle(id) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const existing = await reqToPromise(store.get(id));
    if (!existing) return;
    await reqToPromise(store.put({ ...existing, deleted: false, deletedAt: null, updatedAt: Date.now(), dirty: true }));
  }

  // Only jingles deleted through deleteJingle() (which stamps deletedAt)
  // show up here — bulk paths like deleteCategory's cascade or wipeAll()
  // don't set deletedAt, so they're not recoverable through the trash.
  async function getTrash() {
    const t = await tx(STORE_JINGLES, 'readonly');
    const all = await reqToPromise(t.objectStore(STORE_JINGLES).getAll());
    return all
      .filter((j) => j.deleted && j.deletedAt != null)
      .sort((a, b) => b.deletedAt - a.deletedAt);
  }

  // Hard-removes trash entries older than maxAgeMs (default 24h) from
  // IndexedDB and returns what was purged so the caller (RJSync) can best-
  // effort clean up the matching Supabase row + Storage object too.
  const TRASH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  async function purgeExpiredTrash(maxAgeMs = TRASH_MAX_AGE_MS) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const all = await reqToPromise(store.getAll());
    const now = Date.now();
    const purged = [];
    for (const j of all) {
      if (!j.deleted || j.deletedAt == null) continue;
      if (now - j.deletedAt < maxAgeMs) continue;
      await reqToPromise(store.delete(j.id));
      purged.push({ id: j.id, storagePath: j.storagePath || null, userId: j.userId });
    }
    return purged;
  }

  // ---- Sync-only helpers (used by RJSync, not the UI) ----

  // Includes tombstones — sync needs to push deletes too.
  async function getDirty(storeName) {
    const t = await tx(storeName, 'readonly');
    const all = await reqToPromise(t.objectStore(storeName).getAll());
    return all.filter((r) => r.dirty);
  }

  // Clears the dirty flag only if the record hasn't changed again since the
  // push started (compares updatedAt), so an in-flight push can't clobber a
  // newer local edit made while the request was in the air.
  async function clearDirtyIfUnchanged(storeName, id, updatedAtAtPushTime, extra = {}) {
    const t = await tx(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    const existing = await reqToPromise(store.get(id));
    if (!existing || existing.updatedAt !== updatedAtAtPushTime) return false;
    await reqToPromise(store.put({ ...existing, ...extra, dirty: false }));
    return true;
  }

  // Merges a row pulled from Supabase (or a realtime event) using
  // Last-Write-Wins: whichever side has the newer updatedAt survives. For
  // categories, a remote tombstone that wins hard-deletes the local row
  // (tombstones are a sync-log detail there). For jingles (Phase 8), a
  // remote tombstone instead merges as a soft-delete — so the 24h trash is
  // shared across devices — and only a genuine DELETE (from purging an
  // expired trash entry) removes the local row for good; see
  // handleRealtime()'s DELETE branch and purgeExpiredTrash() in js/sync.js.
  async function upsertFromRemote(storeName, remote) {
    const t = await tx(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    const existing = await reqToPromise(store.get(remote.id));

    if (!existing) {
      if (remote.deleted && storeName !== STORE_JINGLES) return;
      await reqToPromise(store.add({ ...remote, blob: null, dirty: false }));
      return;
    }

    if (existing.dirty && existing.updatedAt > remote.updatedAt) {
      return; // unpushed local edit (possibly a local "undelete") is newer
    }
    if (remote.updatedAt <= existing.updatedAt && !existing.dirty) {
      return; // already up to date
    }

    if (remote.deleted && storeName !== STORE_JINGLES) {
      await reqToPromise(store.delete(remote.id));
      return;
    }

    const merged = { ...existing, ...remote, dirty: false };
    if (storeName === STORE_JINGLES && !('blob' in remote)) {
      merged.blob = existing.blob; // remote rows never carry the audio blob
    }
    await reqToPromise(store.put(merged));
  }

  // Raw local patch that does NOT touch dirty/updatedAt — for sync-derived
  // metadata only (e.g. storagePath after upload, blob after download).
  async function patchLocal(storeName, id, fields) {
    const t = await tx(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    const existing = await reqToPromise(store.get(id));
    if (!existing) return;
    await reqToPromise(store.put({ ...existing, ...fields }));
  }

  // Hard remove, for the defensive path of a real (non-tombstone) DELETE
  // arriving over realtime — normal deletes flow through the soft-delete
  // tombstone in deleteCategory/deleteJingle above instead.
  async function removeLocal(storeName, id) {
    const t = await tx(storeName, 'readwrite');
    await reqToPromise(t.objectStore(storeName).delete(id));
  }

  // ---- Local export/import (Phase 5) ----

  // Overwrite-mode import: tombstone every existing row first (same
  // soft-delete convention as deleteCategory/deleteJingle) so the following
  // import starts from a clean board and the deletion still propagates
  // through sync like any other change.
  async function wipeAll() {
    const now = Date.now();
    const tCats = await tx(STORE_CATEGORIES, 'readwrite');
    const catStore = tCats.objectStore(STORE_CATEGORIES);
    for (const cat of await reqToPromise(catStore.getAll())) {
      if (cat.deleted) continue;
      await reqToPromise(catStore.put({ ...cat, deleted: true, updatedAt: now, dirty: true }));
    }
    const tJingles = await tx(STORE_JINGLES, 'readwrite');
    const jingleStore = tJingles.objectStore(STORE_JINGLES);
    for (const j of await reqToPromise(jingleStore.getAll())) {
      if (j.deleted) continue;
      await reqToPromise(jingleStore.put({ ...j, deleted: true, blob: null, updatedAt: now, dirty: true }));
    }
  }

  // put() by an explicit id (rather than addCategory's auto id) so
  // re-importing the same export is idempotent: an id already present gets
  // updated in place instead of duplicated. Used only by RJExport.
  async function putCategoryForImport({ id, name, color, order }) {
    const t = await tx(STORE_CATEGORIES, 'readwrite');
    const store = t.objectStore(STORE_CATEGORIES);
    const existing = await reqToPromise(store.get(id));
    const now = Date.now();
    const record = {
      id, name, color, order: order ?? 0, deleted: false,
      userId: existing ? existing.userId : currentUserId,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now, dirty: true,
    };
    await reqToPromise(store.put(record));
    return record;
  }

  async function putJingleForImport({ id, name, categoryId, color, order, trimStart, trimEnd, fileName, mimeType, blob }) {
    const t = await tx(STORE_JINGLES, 'readwrite');
    const store = t.objectStore(STORE_JINGLES);
    const existing = await reqToPromise(store.get(id));
    const now = Date.now();
    const record = {
      id, name, categoryId, color: color || null,
      blob: blob || (existing ? existing.blob : null),
      mimeType: mimeType || null,
      fileName: fileName || null,
      storagePath: blob ? null : (existing ? existing.storagePath : null),
      order: order ?? 0,
      deleted: false,
      // Optional pass-through fields — no editing UI exists yet, but the
      // export/import round trip preserves them for whenever one does.
      trimStart: trimStart ?? null,
      trimEnd: trimEnd ?? null,
      userId: existing ? existing.userId : currentUserId,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now, dirty: true,
    };
    await reqToPromise(store.put(record));
    return record;
  }

  // Local-only records (created while logged out) get attached to the
  // account on first login so they sync up instead of staying orphaned.
  async function claimUnownedRecords(userId) {
    for (const storeName of [STORE_CATEGORIES, STORE_JINGLES]) {
      const t = await tx(storeName, 'readwrite');
      const store = t.objectStore(storeName);
      const all = await reqToPromise(store.getAll());
      for (const record of all) {
        if (record.userId == null) {
          await reqToPromise(store.put({ ...record, userId, dirty: true }));
        }
      }
    }
  }

  return {
    setCurrentUserId,
    getCurrentUserId,
    getMeta,
    setMeta,
    getAllCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    getAllJingles,
    getJinglesByCategory,
    getJingle,
    addJingle,
    updateJingle,
    deleteJingle,
    restoreJingle,
    getTrash,
    purgeExpiredTrash,
    TRASH_MAX_AGE_MS,
    getDirty,
    clearDirtyIfUnchanged,
    upsertFromRemote,
    patchLocal,
    removeLocal,
    claimUnownedRecords,
    wipeAll,
    putCategoryForImport,
    putJingleForImport,
  };
})();
