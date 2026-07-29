/* Supabase sync engine for Random Jingle (Phase 2).
 *
 * Design: IndexedDB (js/db.js) is always the source of truth for the UI —
 * every read/write in app.js goes through it and works with no network and
 * no login. This module is a best-effort layer on top: when configured
 * (window.RJ_CONFIG present) AND online AND authenticated, it pushes local
 * "dirty" rows to Supabase, pulls remote rows into IndexedDB with
 * Last-Write-Wins (compare updatedAt), and mirrors audio files to/from
 * Supabase Storage. If any of those conditions are missing, every function
 * here is a safe no-op and the app behaves exactly like Phase 1.
 */
const RJSync = (() => {
  const BUCKET = 'jingle-audio';
  const PUSH_DEBOUNCE_MS = 400;

  let client = null;
  let userId = null;
  let userEmail = null;
  let channel = null;
  let syncing = false;
  let pushTimer = null;

  let status = {
    configured: false,
    online: navigator.onLine,
    authenticated: false,
    email: null,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
  };
  const statusListeners = new Set();
  const remoteChangeListeners = new Set();

  function setStatus(patch) {
    status = { ...status, ...patch };
    for (const cb of statusListeners) cb(status);
  }

  function onStatusChange(cb) {
    statusListeners.add(cb);
    cb(status);
    return () => statusListeners.delete(cb);
  }

  function onRemoteChange(cb) {
    remoteChangeListeners.add(cb);
    return () => remoteChangeListeners.delete(cb);
  }

  function notifyRemoteChange() {
    for (const cb of remoteChangeListeners) cb();
  }

  // ---- Row <-> local record mapping (snake_case <-> camelCase, ISO <-> ms) ----
  function localCategoryToRow(cat) {
    return {
      id: cat.id,
      user_id: cat.userId,
      name: cat.name,
      color: cat.color,
      sort_order: cat.order ?? 0,
      deleted: !!cat.deleted,
      created_at: new Date(cat.createdAt).toISOString(),
      updated_at: new Date(cat.updatedAt).toISOString(),
    };
  }

  function rowToLocalCategory(row) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      color: row.color,
      order: row.sort_order,
      deleted: !!row.deleted,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
    };
  }

  function localJingleToRow(jingle) {
    return {
      id: jingle.id,
      user_id: jingle.userId,
      category_id: jingle.categoryId,
      name: jingle.name,
      color: jingle.color || null,
      storage_path: jingle.storagePath || null,
      mime_type: jingle.mimeType || null,
      file_name: jingle.fileName || null,
      sort_order: jingle.order ?? 0,
      deleted: !!jingle.deleted,
      created_at: new Date(jingle.createdAt).toISOString(),
      updated_at: new Date(jingle.updatedAt).toISOString(),
    };
  }

  function rowToLocalJingle(row) {
    return {
      id: row.id,
      userId: row.user_id,
      categoryId: row.category_id,
      name: row.name,
      color: row.color,
      storagePath: row.storage_path,
      mimeType: row.mime_type,
      fileName: row.file_name,
      order: row.sort_order,
      deleted: !!row.deleted,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
    };
  }

  function extFromFileName(fileName) {
    if (!fileName) return null;
    const dot = fileName.lastIndexOf('.');
    return dot === -1 ? null : fileName.slice(dot + 1).toLowerCase();
  }

  function extFromMime(mime) {
    const map = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/wave': 'wav',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/webm': 'weba',
    };
    return map[mime] || null;
  }

  // ---- Storage ----
  async function uploadAudio(jingle) {
    const ext = extFromFileName(jingle.fileName) || extFromMime(jingle.mimeType) || 'audio';
    const path = `${userId}/${jingle.id}.${ext}`;
    const { error } = await client.storage.from(BUCKET).upload(path, jingle.blob, {
      contentType: jingle.mimeType || 'application/octet-stream',
      upsert: true,
    });
    if (error) throw error;
    return path;
  }

  async function removeAudio(storagePath) {
    if (!storagePath) return;
    try {
      await client.storage.from(BUCKET).remove([storagePath]);
    } catch (err) {
      console.warn('Konnte Audio nicht aus Storage entfernen', err);
    }
  }

  async function downloadMissingAudio() {
    const jingles = await RJDB.getAllJingles();
    for (const j of jingles) {
      if (!j.blob && j.storagePath) {
        try {
          const { data, error } = await client.storage.from(BUCKET).download(j.storagePath);
          if (error) throw error;
          await RJDB.patchLocal('jingles', j.id, { blob: data });
        } catch (err) {
          console.warn(`Audio-Download fehlgeschlagen für "${j.name}"`, err);
        }
      }
    }
  }

  // On-demand download for a single jingle whose audio hasn't been cached
  // locally yet (e.g. right after pulling a jingle synced from another
  // device). Safe no-op (returns null) when not configured/offline.
  async function ensureBlob(jingle) {
    if (jingle.blob) return jingle.blob;
    if (!client || !jingle.storagePath || !navigator.onLine) return null;
    try {
      const { data, error } = await client.storage.from(BUCKET).download(jingle.storagePath);
      if (error) throw error;
      await RJDB.patchLocal('jingles', jingle.id, { blob: data });
      return data;
    } catch (err) {
      console.warn('On-demand Audio-Download fehlgeschlagen', err);
      return null;
    }
  }

  // ---- Language preference (Phase 3) ----
  // Same local-first, LWW-by-updatedAt convention as categories/jingles, but
  // for the single per-user row in `user_settings` instead of a collection.
  async function pushLanguage() {
    if (!client || !userId) return;
    const meta = await RJDB.getMeta('language');
    if (!meta || !meta.dirty) return;
    try {
      const { error } = await client.from('user_settings').upsert({
        user_id: userId,
        language: meta.code,
        updated_at: new Date(meta.updatedAt).toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      await RJDB.setMeta('language', { ...meta, dirty: false });
    } catch (err) {
      console.warn('Sync: Sprachpräferenz-Push fehlgeschlagen', err);
      setStatus({ lastError: err.message || String(err) });
    }
  }

  async function pullLanguage() {
    if (!client || !userId) return;
    try {
      const { data, error } = await client.from('user_settings').select('language, updated_at').eq('user_id', userId);
      if (error) throw error;
      const row = data && data[0];
      if (!row || !row.language) return;

      const remoteUpdatedAt = Date.parse(row.updated_at);
      const local = (await RJDB.getMeta('language')) || { code: null, updatedAt: 0, dirty: false, auto: true };

      if (local.dirty && local.updatedAt > remoteUpdatedAt) return; // unpushed local edit is newer
      if (!local.auto && remoteUpdatedAt <= local.updatedAt && !local.dirty) return; // already up to date

      if (typeof RJI18n !== 'undefined') await RJI18n.setLanguage(row.language, { persist: false });
      await RJDB.setMeta('language', { code: row.language, updatedAt: remoteUpdatedAt, dirty: false });
    } catch (err) {
      console.warn('Sync: Sprachpräferenz-Pull fehlgeschlagen', err);
    }
  }

  // ---- Push (local dirty rows -> Supabase) ----
  async function pushDirty() {
    if (!client || !userId || !navigator.onLine) return;

    await pushLanguage();

    const dirtyCats = (await RJDB.getDirty('categories')).filter((c) => c.userId === userId);
    for (const cat of dirtyCats) {
      try {
        const { error } = await client.from('categories').upsert(localCategoryToRow(cat), { onConflict: 'id' });
        if (error) throw error;
        await RJDB.clearDirtyIfUnchanged('categories', cat.id, cat.updatedAt);
      } catch (err) {
        console.warn('Sync: Kategorie-Push fehlgeschlagen', err);
        setStatus({ lastError: err.message || String(err) });
      }
    }

    const dirtyJingles = (await RJDB.getDirty('jingles')).filter((j) => j.userId === userId);
    for (const jingle of dirtyJingles) {
      try {
        let storagePath = jingle.storagePath;
        if (jingle.deleted) {
          if (storagePath) await removeAudio(storagePath);
        } else if (jingle.blob && !storagePath) {
          storagePath = await uploadAudio(jingle);
        }
        const row = localJingleToRow({ ...jingle, storagePath });
        const { error } = await client.from('jingles').upsert(row, { onConflict: 'id' });
        if (error) throw error;
        await RJDB.clearDirtyIfUnchanged('jingles', jingle.id, jingle.updatedAt, { storagePath });
      } catch (err) {
        console.warn('Sync: Jingle-Push fehlgeschlagen', err);
        setStatus({ lastError: err.message || String(err) });
      }
    }
  }

  // ---- Pull (Supabase -> local, merged with LWW) ----
  async function pullAll() {
    if (!client || !userId) return;
    await pullLanguage();
    const [catRes, jingleRes] = await Promise.all([
      client.from('categories').select('*').eq('user_id', userId),
      client.from('jingles').select('*').eq('user_id', userId),
    ]);
    if (catRes.error) throw catRes.error;
    if (jingleRes.error) throw jingleRes.error;

    for (const row of catRes.data) await RJDB.upsertFromRemote('categories', rowToLocalCategory(row));
    for (const row of jingleRes.data) await RJDB.upsertFromRemote('jingles', rowToLocalJingle(row));

    await downloadMissingAudio();
    await RJDB.setMeta('lastSyncAt', Date.now());
  }

  async function syncAll() {
    if (!client || !userId || !navigator.onLine || syncing) return;
    syncing = true;
    setStatus({ syncing: true, lastError: null });
    try {
      await pushDirty();
      await pullAll();
      notifyRemoteChange();
    } catch (err) {
      console.warn('Sync fehlgeschlagen', err);
      setStatus({ lastError: err.message || String(err) });
    } finally {
      syncing = false;
      setStatus({ syncing: false, lastSyncAt: await RJDB.getMeta('lastSyncAt') });
    }
  }

  function pushSoon() {
    if (!client || !userId) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (syncing) return; // a full syncAll() is already pushing+pulling
      syncing = true;
      setStatus({ syncing: true });
      pushDirty()
        .catch((err) => {
          console.warn('Sync: verzögerter Push fehlgeschlagen', err);
          setStatus({ lastError: err.message || String(err) });
        })
        .finally(() => {
          syncing = false;
          setStatus({ syncing: false });
        });
    }, PUSH_DEBOUNCE_MS);
  }

  // ---- Realtime (cross-tab / cross-device live sync while logged in) ----
  function setupRealtime(uid) {
    teardownRealtime();
    channel = client
      .channel(`rj-sync-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${uid}` }, (payload) => handleRealtime('categories', payload))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jingles', filter: `user_id=eq.${uid}` }, (payload) => handleRealtime('jingles', payload))
      .subscribe();
  }

  function teardownRealtime() {
    if (channel) {
      client.removeChannel(channel);
      channel = null;
    }
  }

  async function handleRealtime(storeName, payload) {
    try {
      if (payload.eventType === 'DELETE') {
        if (payload.old?.id) await RJDB.removeLocal(storeName, payload.old.id);
      } else {
        const normalized = storeName === 'categories' ? rowToLocalCategory(payload.new) : rowToLocalJingle(payload.new);
        await RJDB.upsertFromRemote(storeName, normalized);
        if (storeName === 'jingles') await downloadMissingAudio();
      }
      notifyRemoteChange();
    } catch (err) {
      console.warn('Sync: Realtime-Update konnte nicht angewendet werden', err);
    }
  }

  // ---- Auth ----
  async function handleAuthChange(session) {
    userId = session?.user?.id ?? null;
    userEmail = session?.user?.email ?? null;
    RJDB.setCurrentUserId(userId);
    setStatus({ authenticated: !!userId, email: userEmail });
  }

  async function onSignedIn(session) {
    await RJDB.claimUnownedRecords(session.user.id);
    setupRealtime(session.user.id);
    await syncAll();
  }

  function onSignedOut() {
    teardownRealtime();
    setStatus({ authenticated: false, email: null });
  }

  async function signInWithEmail(email) {
    if (!client) throw new Error('Supabase ist nicht konfiguriert.');
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] },
    });
    if (error) throw error;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  async function init() {
    const cfg = window.RJ_CONFIG;
    if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      setStatus({ configured: false });
      return;
    }
    const SupabaseLib = window.supabase;
    if (!SupabaseLib || typeof SupabaseLib.createClient !== 'function') {
      console.warn('Supabase-Client-Bibliothek nicht geladen — Cloud-Funktionen deaktiviert.');
      setStatus({ configured: false });
      return;
    }

    client = SupabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    setStatus({ configured: true });

    client.auth.onAuthStateChange((event, session) => {
      handleAuthChange(session);
      if (event === 'SIGNED_IN') onSignedIn(session);
      if (event === 'SIGNED_OUT') onSignedOut();
    });

    const { data } = await client.auth.getSession();
    await handleAuthChange(data.session);
    if (data.session) await onSignedIn(data.session);

    window.addEventListener('online', () => {
      setStatus({ online: true });
      if (userId) syncAll();
    });
    window.addEventListener('offline', () => setStatus({ online: false }));
  }

  return {
    init,
    isConfigured: () => status.configured,
    getStatus: () => status,
    onStatusChange,
    onRemoteChange,
    signInWithEmail,
    signOut,
    syncNow: syncAll,
    pushSoon,
    ensureBlob,
  };
})();
