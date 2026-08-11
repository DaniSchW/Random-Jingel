/* Self-hosted PHP/MySQL sync engine for Random Jingle (replaces Supabase).
 *
 * Design unchanged from the Supabase version: IndexedDB (js/db.js) is
 * always the source of truth for the UI — every read/write in app.js goes
 * through it and works with no network and no login. This module is a
 * best-effort layer on top: when configured (window.RJ_CONFIG.API_BASE_URL
 * present) AND online AND authenticated, it pushes local "dirty" rows to
 * the backend, pulls remote rows into IndexedDB with Last-Write-Wins
 * (compare updatedAt), and mirrors audio files to/from server/uploads/. If
 * any of those conditions are missing, every function here is a safe
 * no-op and the app behaves exactly like fully-offline mode.
 *
 * What's different from the Supabase version, and why:
 * - Auth is a hand-rolled magic-link + opaque session token instead of
 *   Supabase Auth. The session token lives in localStorage and is sent as
 *   "Authorization: Bearer <token>" on every request.
 * - There is no Row Level Security. server/api/*.php enforces ownership
 *   explicitly on every query; this module just has to actually send the
 *   session token on every call, and interpret 401/403 as "not allowed."
 * - No live realtime (no postgres_changes equivalent without websocket
 *   infrastructure). Replaced with periodic polling (POLL_INTERVAL_MS)
 *   while signed in and online, on top of the existing push-on-change
 *   (pushSoon) and sync-on-reconnect/sign-in behavior.
 */
const RJSync = (() => {
  const SESSION_STORAGE_KEY = 'rj_session_token';
  const PUSH_DEBOUNCE_MS = 400;
  const POLL_INTERVAL_MS = 60000;

  let apiBase = null;
  let sessionToken = null;
  let userId = null;
  let userEmail = null;
  let userRole = null;
  let syncing = false;
  let pushTimer = null;
  let pollTimer = null;

  let status = {
    configured: false,
    online: navigator.onLine,
    authenticated: false,
    email: null,
    isAdmin: false,
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

  // ---- HTTP helpers ----
  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    const res = await fetch(`${apiBase}${path}`, { ...options, headers });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.message || body.error || message;
      } catch {
        // response wasn't JSON - keep the generic HTTP status message
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function apiGetJson(path) {
    const res = await apiFetch(path, { method: 'GET' });
    return res.json();
  }

  async function apiPostJson(path, body) {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // ---- Row <-> local record mapping (snake_case <-> camelCase, ISO <-> ms) ----
  // Unchanged from the Supabase version - server/api/sync/pull.php and
  // push.php deliberately speak this exact same shape, so this code
  // didn't need to change at all.
  function localCategoryToRow(cat) {
    return {
      id: cat.id,
      user_id: cat.userId,
      name: cat.name,
      color: cat.color,
      sort_order: cat.order ?? 0,
      deleted: !!cat.deleted,
      playback_mode: cat.playbackMode || 'random',
      sequential_index: cat.sequentialIndex ?? 0,
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
      playbackMode: row.playback_mode || 'random',
      sequentialIndex: row.sequential_index ?? 0,
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
      trim_start: jingle.trimStart ?? null,
      trim_end: jingle.trimEnd ?? null,
      hotkey: jingle.hotkey || null,
      source_note: jingle.sourceNote || null,
      deleted: !!jingle.deleted,
      deleted_at: jingle.deletedAt != null ? new Date(jingle.deletedAt).toISOString() : null,
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
      trimStart: row.trim_start ?? null,
      trimEnd: row.trim_end ?? null,
      hotkey: row.hotkey || null,
      sourceNote: row.source_note || null,
      deleted: !!row.deleted,
      deletedAt: row.deleted_at != null ? Date.parse(row.deleted_at) : null,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
    };
  }

  // ---- Storage (audio files) ----
  async function uploadAudio(jingle) {
    const form = new FormData();
    form.append('jingle_id', jingle.id);
    form.append('file', jingle.blob, jingle.fileName || 'audio');
    const res = await apiFetch('/upload.php', { method: 'POST', body: form });
    const data = await res.json();
    return data.storage_path;
  }

  async function downloadAudio(storagePath) {
    const res = await apiFetch(`/audio.php?path=${encodeURIComponent(storagePath)}`, { method: 'GET' });
    return res.blob();
  }

  // Trash: hard-removes locally-expired (>24h) trash entries and,
  // best-effort, their remote row + audio file too, in one batched call.
  async function purgeExpiredTrash() {
    const purged = await RJDB.purgeExpiredTrash();
    if (!purged.length || !apiBase || !userId || !navigator.onLine) return purged;
    const ids = purged.filter((item) => item.userId === userId).map((item) => item.id);
    if (!ids.length) return purged;
    try {
      await apiPostJson('/sync/purge.php', { ids });
    } catch (err) {
      console.warn('Sync: Papierkorb-Bereinigung (Remote) fehlgeschlagen', err);
    }
    return purged;
  }

  async function downloadMissingAudio() {
    const jingles = await RJDB.getAllJingles();
    for (const j of jingles) {
      if (!j.blob && j.storagePath) {
        try {
          const blob = await downloadAudio(j.storagePath);
          await RJDB.patchLocal('jingles', j.id, { blob });
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
    if (!apiBase || !jingle.storagePath || !navigator.onLine) return null;
    try {
      const blob = await downloadAudio(jingle.storagePath);
      await RJDB.patchLocal('jingles', jingle.id, { blob });
      return blob;
    } catch (err) {
      console.warn('On-demand Audio-Download fehlgeschlagen', err);
      return null;
    }
  }

  // ---- Language preference ----
  // Same local-first, LWW-by-updatedAt convention as categories/jingles,
  // but for the single per-user language setting.
  async function pushLanguage() {
    if (!apiBase || !userId) return;
    const meta = await RJDB.getMeta('language');
    if (!meta || !meta.dirty) return;
    try {
      await apiPostJson('/sync/push.php', {
        kind: 'language',
        row: { language: meta.code, updated_at: new Date(meta.updatedAt).toISOString() },
      });
      await RJDB.setMeta('language', { ...meta, dirty: false });
    } catch (err) {
      console.warn('Sync: Sprachpräferenz-Push fehlgeschlagen', err);
      setStatus({ lastError: err.message || String(err) });
    }
  }

  async function applyPulledLanguage(language) {
    if (!language || !language.language) return;
    const remoteUpdatedAt = Date.parse(language.updated_at);
    const local = (await RJDB.getMeta('language')) || { code: null, updatedAt: 0, dirty: false, auto: true };

    if (local.dirty && local.updatedAt > remoteUpdatedAt) return; // unpushed local edit is newer
    if (!local.auto && remoteUpdatedAt <= local.updatedAt && !local.dirty) return; // already up to date

    if (typeof RJI18n !== 'undefined') await RJI18n.setLanguage(language.language, { persist: false });
    await RJDB.setMeta('language', { code: language.language, updatedAt: remoteUpdatedAt, dirty: false });
  }

  // ---- Push (local dirty rows -> backend) ----
  async function pushDirty() {
    if (!apiBase || !userId || !navigator.onLine) return;

    await pushLanguage();

    const dirtyCats = (await RJDB.getDirty('categories')).filter((c) => c.userId === userId);
    for (const cat of dirtyCats) {
      try {
        await apiPostJson('/sync/push.php', { kind: 'category', row: localCategoryToRow(cat) });
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
        if (!jingle.deleted && jingle.blob && !storagePath) {
          storagePath = await uploadAudio(jingle);
        }
        const row = localJingleToRow({ ...jingle, storagePath });
        await apiPostJson('/sync/push.php', { kind: 'jingle', row });
        await RJDB.clearDirtyIfUnchanged('jingles', jingle.id, jingle.updatedAt, { storagePath });
      } catch (err) {
        console.warn('Sync: Jingle-Push fehlgeschlagen', err);
        setStatus({ lastError: err.message || String(err) });
      }
    }
  }

  // ---- Pull (backend -> local, merged with LWW) ----
  async function pullAll() {
    if (!apiBase || !userId) return;
    const data = await apiGetJson('/sync/pull.php');

    await applyPulledLanguage(data.language);
    for (const row of data.categories) await RJDB.upsertFromRemote('categories', rowToLocalCategory(row));
    for (const row of data.jingles) await RJDB.upsertFromRemote('jingles', rowToLocalJingle(row));

    await downloadMissingAudio();
    await RJDB.setMeta('lastSyncAt', Date.now());
  }

  async function syncAll() {
    if (!apiBase || !userId || !navigator.onLine || syncing) return;
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
    if (!apiBase || !userId) return;
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

  // ---- Polling (cross-device sync while signed in) ----
  // No websocket/realtime infrastructure on this backend, so cross-device
  // updates show up within POLL_INTERVAL_MS instead of instantly. Local
  // changes still push immediately via pushSoon().
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (userId && navigator.onLine) syncAll();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---- Admin ----
  async function adminUserStats() {
    if (!apiBase) throw new Error('Backend ist nicht konfiguriert.');
    return apiGetJson('/admin/stats.php');
  }

  // ---- Auth ----
  function persistSessionToken(token) {
    sessionToken = token;
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  function handleAuthChange(user) {
    userId = user?.id ?? null;
    userEmail = user?.email ?? null;
    userRole = user?.role ?? null;
    RJDB.setCurrentUserId(userId);
    setStatus({ authenticated: !!userId, email: userEmail, isAdmin: userRole === 'admin' });
  }

  async function onSignedIn(user) {
    await RJDB.claimUnownedRecords(user.id);
    startPolling();
    await syncAll();
  }

  function onSignedOut() {
    stopPolling();
    setStatus({ authenticated: false, email: null, isAdmin: false });
  }

  async function signInWithEmail(email) {
    if (!apiBase) throw new Error('Backend ist nicht konfiguriert.');
    await apiPostJson('/auth/request-link.php', { email });
  }

  async function signOut() {
    if (!apiBase) return;
    try {
      await apiFetch('/auth/logout.php', { method: 'POST' });
    } catch (err) {
      console.warn('Sync: Logout-Request fehlgeschlagen (Session wird trotzdem lokal verworfen)', err);
    }
    persistSessionToken(null);
    handleAuthChange(null);
    onSignedOut();
  }

  // Handles the magic-link callback: the emailed link points back at this
  // app with "?token=...". detectSessionInUrl's replacement - verify the
  // token, store the resulting session, then strip it from the URL so a
  // refresh/share of the link can't replay it.
  async function consumeMagicLinkFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return false;

    try {
      const data = await apiPostJson('/auth/verify.php', { token });
      persistSessionToken(data.session_token);
      handleAuthChange(data.user);
    } catch (err) {
      console.warn('Sync: Magic-Link-Verifizierung fehlgeschlagen', err);
      setStatus({ lastError: err.message || String(err) });
    } finally {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    return !!sessionToken;
  }

  async function restorePersistedSession() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return false;
    sessionToken = stored;
    try {
      const data = await apiGetJson('/auth/me.php');
      handleAuthChange(data.user);
      return true;
    } catch (err) {
      persistSessionToken(null);
      return false;
    }
  }

  async function init() {
    const cfg = window.RJ_CONFIG;
    if (!cfg || !cfg.API_BASE_URL) {
      setStatus({ configured: false });
      return;
    }
    apiBase = cfg.API_BASE_URL;
    setStatus({ configured: true });

    const signedInViaLink = await consumeMagicLinkFromUrl();
    const signedInViaSession = signedInViaLink ? false : await restorePersistedSession();

    if (!signedInViaLink && !signedInViaSession) {
      handleAuthChange(null);
    }
    if (userId) await onSignedIn({ id: userId });

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
    adminUserStats,
    purgeExpiredTrash,
  };
})();
