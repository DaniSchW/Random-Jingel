/* Random Jingle - app logic. IndexedDB is always the source of truth for
 * the UI (offline-first); RJSync (Phase 2) is a best-effort layer that
 * mirrors changes to Supabase when configured, online and authenticated. */
(() => {
  'use strict';

  const state = {
    categories: [],
    jinglesByCategory: new Map(), // categoryId -> jingle[]
  };

  const jingleButtonEls = new Map(); // jingleId -> button element
  const randomButtonEls = new Map(); // categoryId -> button element

  // ---- DOM refs ----
  const categoryListEl = document.getElementById('categoryList');
  const emptyStateEl = document.getElementById('emptyState');

  const addMenuBtn = document.getElementById('addMenuBtn');
  const addMenu = document.getElementById('addMenu');
  const addCategoryMenuItem = document.getElementById('addCategoryMenuItem');
  const addJingleMenuItem = document.getElementById('addJingleMenuItem');

  const categoryDialog = document.getElementById('categoryDialog');
  const categoryForm = document.getElementById('categoryForm');
  const categoryDialogTitle = document.getElementById('categoryDialogTitle');
  const categoryIdInput = document.getElementById('categoryId');
  const categoryNameInput = document.getElementById('categoryName');
  const categoryColorInput = document.getElementById('categoryColor');
  const deleteCategoryBtn = document.getElementById('deleteCategoryBtn');

  const jingleDialog = document.getElementById('jingleDialog');
  const jingleForm = document.getElementById('jingleForm');
  const jingleDialogTitle = document.getElementById('jingleDialogTitle');
  const jingleIdInput = document.getElementById('jingleId');
  const jingleFileInput = document.getElementById('jingleFile');
  const jingleFileHint = document.getElementById('jingleFileHint');
  const jingleNameInput = document.getElementById('jingleName');
  const jingleCategorySelect = document.getElementById('jingleCategory');
  const jingleColorOverrideEnabled = document.getElementById('jingleColorOverrideEnabled');
  const jingleColorField = document.getElementById('jingleColorField');
  const jingleColorInput = document.getElementById('jingleColor');
  const deleteJingleBtn = document.getElementById('deleteJingleBtn');

  const infoDialog = document.getElementById('infoDialog');
  const infoDialogTitle = document.getElementById('infoDialogTitle');
  const infoDialogText = document.getElementById('infoDialogText');

  const accountBtn = document.getElementById('accountBtn');
  const accountDialog = document.getElementById('accountDialog');
  const authForm = document.getElementById('authForm');
  const authLoggedOutView = document.getElementById('authLoggedOutView');
  const authLoggedInView = document.getElementById('authLoggedInView');
  const authEmailInput = document.getElementById('authEmail');
  const authMessage = document.getElementById('authMessage');
  const authSendBtn = document.getElementById('authSendBtn');
  const authUserEmail = document.getElementById('authUserEmail');
  const syncStatusText = document.getElementById('syncStatusText');
  const signOutBtn = document.getElementById('signOutBtn');
  const syncNowBtn = document.getElementById('syncNowBtn');

  const settingsBtn = document.getElementById('settingsBtn');
  const settingsDialog = document.getElementById('settingsDialog');
  const languageSelect = document.getElementById('languageSelect');
  const adConsentSelect = document.getElementById('adConsentSelect');

  const adSlotAdsense = document.getElementById('adSlotAdsense');
  const adSlotEthical = document.getElementById('adSlotEthical');
  const consentBanner = document.getElementById('consentBanner');
  const consentAcceptBtn = document.getElementById('consentAcceptBtn');
  const consentDeclineBtn = document.getElementById('consentDeclineBtn');

  const appViewEl = document.getElementById('appView');
  const adminBtn = document.getElementById('adminBtn');
  const adminView = document.getElementById('adminView');
  const adminBackBtn = document.getElementById('adminBackBtn');
  const adminLoading = document.getElementById('adminLoading');
  const adminDenied = document.getElementById('adminDenied');
  const adminContent = document.getElementById('adminContent');
  const adminStatTotal = document.getElementById('adminStatTotal');
  const adminStat7 = document.getElementById('adminStat7');
  const adminStat30 = document.getElementById('adminStat30');
  const adminUserRows = document.getElementById('adminUserRows');

  const masterVolumeInput = document.getElementById('masterVolume');
  const stopAllBtn = document.getElementById('stopAllBtn');
  const toastEl = document.getElementById('toast');

  // Maps each footer link's data-info-key to the i18n key prefix for its
  // placeholder dialog title/body (footer.imprint/footer.imprintText, etc.).
  const FOOTER_INFO_KEYS = {
    imprint: 'imprint',
    privacy: 'privacy',
    terms: 'terms',
  };

  // ---- Utilities ----
  let toastTimer = null;
  let lastAdminGate = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  function contrastTextColor(hex) {
    const c = (hex || '#7c3aed').replace('#', '');
    const full = c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c;
    const r = parseInt(full.substring(0, 2), 16) || 0;
    const g = parseInt(full.substring(2, 4), 16) || 0;
    const b = parseInt(full.substring(4, 6), 16) || 0;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? '#1a1a1a' : '#ffffff';
  }

  function applyColorVars(el, color) {
    el.style.setProperty('--btn-bg', color);
    el.style.setProperty('--btn-text', contrastTextColor(color));
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  // ---- Data loading ----
  async function loadState() {
    const [categories, jingles] = await Promise.all([
      RJDB.getAllCategories(),
      RJDB.getAllJingles(),
    ]);
    state.categories = categories;
    state.jinglesByCategory = new Map();
    for (const cat of categories) state.jinglesByCategory.set(cat.id, []);
    for (const jingle of jingles) {
      if (!state.jinglesByCategory.has(jingle.categoryId)) {
        state.jinglesByCategory.set(jingle.categoryId, []);
      }
      state.jinglesByCategory.get(jingle.categoryId).push(jingle);
    }
    render();
    syncAddJingleAvailability();
  }

  function syncAddJingleAvailability() {
    addJingleMenuItem.disabled = state.categories.length === 0;
  }

  // ---- Rendering ----
  function render() {
    categoryListEl.innerHTML = '';
    jingleButtonEls.clear();
    randomButtonEls.clear();

    if (state.categories.length === 0) {
      emptyStateEl.classList.remove('hidden');
      return;
    }
    emptyStateEl.classList.add('hidden');

    for (const cat of state.categories) {
      categoryListEl.appendChild(renderCategoryRow(cat));
    }
  }

  function renderCategoryRow(cat) {
    const jingles = state.jinglesByCategory.get(cat.id) || [];

    const row = document.createElement('section');
    row.className = 'category-row';
    row.dataset.categoryId = String(cat.id);

    const heading = document.createElement('div');
    heading.className = 'category-heading';

    const dot = document.createElement('span');
    dot.className = 'category-color-dot';
    dot.style.background = cat.color;

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'category-name-btn';
    nameBtn.title = RJI18n.t('category.editTitle');
    nameBtn.innerHTML = `<span>${escapeHtml(cat.name)}</span><span class="edit-hint" aria-hidden="true">✎</span>`;
    nameBtn.addEventListener('click', () => openCategoryDialog(cat));

    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = RJI18n.tCount('category.jingleCount', jingles.length);

    heading.append(dot, nameBtn, count);

    const body = document.createElement('div');
    body.className = 'category-body';

    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.className = 'random-btn';
    randomBtn.innerHTML = `<span class="random-icon" aria-hidden="true">🔀</span><span>${escapeHtml(RJI18n.t('random.label'))}</span>`;
    applyColorVars(randomBtn, cat.color);
    randomBtn.addEventListener('click', () => playRandom(cat));
    randomButtonEls.set(cat.id, randomBtn);

    const scroll = document.createElement('div');
    scroll.className = 'jingle-scroll';
    scroll.dataset.i18nEmpty = RJI18n.t('empty.noJingles');

    for (const jingle of jingles) {
      scroll.appendChild(renderJingleItem(jingle));
    }

    const addQuickBtn = document.createElement('button');
    addQuickBtn.type = 'button';
    addQuickBtn.className = 'add-jingle-quick';
    addQuickBtn.title = RJI18n.t('jingle.addToCategoryTitle');
    addQuickBtn.textContent = '+';
    addQuickBtn.addEventListener('click', () => openJingleDialog(null, cat.id));
    scroll.appendChild(addQuickBtn);

    body.append(randomBtn, scroll);
    row.append(heading, body);
    return row;
  }

  function renderJingleItem(jingle) {
    const item = document.createElement('div');
    item.className = 'jingle-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jingle-btn';
    btn.textContent = jingle.name;
    applyColorVars(btn, jingle.color || categoryColorOf(jingle.categoryId));
    btn.addEventListener('click', () => playJingle(jingle, [btn]));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'jingle-edit-btn';
    editBtn.title = RJI18n.t('jingle.editTitle');
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openJingleDialog(jingle);
    });

    item.append(btn, editBtn);
    jingleButtonEls.set(jingle.id, btn);
    return item;
  }

  function categoryColorOf(categoryId) {
    const cat = state.categories.find((c) => c.id === categoryId);
    return cat ? cat.color : '#7c3aed';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Playback ----
  async function playJingle(jingle, extraButtons = []) {
    const btn = jingleButtonEls.get(jingle.id);
    const buttons = [btn, ...extraButtons].filter(Boolean);

    let blob = jingle.blob;
    if (!blob) {
      // Synced from another device but the audio hasn't been cached here yet.
      showToast(RJI18n.t('toast.downloadingAudio'));
      blob = await RJSync.ensureBlob(jingle);
      if (!blob) {
        showToast(RJI18n.t('toast.audioUnavailable'));
        return;
      }
    }

    try {
      RJAudio.ensureContext();
      await RJAudio.play(jingle.id, blob, {
        onStart: () => buttons.forEach((b) => b.classList.add('playing')),
        onEnd: () => buttons.forEach((b) => b.classList.remove('playing')),
      });
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('toast.playbackFailed'));
    }
  }

  function playRandom(cat) {
    const jingles = state.jinglesByCategory.get(cat.id) || [];
    if (jingles.length === 0) {
      showToast(RJI18n.t('category.noJinglesToast', { name: cat.name }));
      return;
    }
    const jingle = jingles[Math.floor(Math.random() * jingles.length)];
    const randomBtn = randomButtonEls.get(cat.id);
    playJingle(jingle, [randomBtn]);
  }

  function stopAll() {
    RJAudio.stopAll();
    for (const btn of jingleButtonEls.values()) btn.classList.remove('playing');
    for (const btn of randomButtonEls.values()) btn.classList.remove('playing');
  }

  // ---- Add menu (header +) ----
  function toggleAddMenu(forceOpen) {
    const shouldOpen = forceOpen ?? addMenu.classList.contains('hidden');
    addMenu.classList.toggle('hidden', !shouldOpen);
    addMenuBtn.setAttribute('aria-expanded', String(shouldOpen));
  }

  addMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAddMenu();
  });

  document.addEventListener('click', (e) => {
    if (!addMenu.classList.contains('hidden') && !addMenu.contains(e.target) && e.target !== addMenuBtn) {
      toggleAddMenu(false);
    }
  });

  addCategoryMenuItem.addEventListener('click', () => {
    toggleAddMenu(false);
    openCategoryDialog(null);
  });

  addJingleMenuItem.addEventListener('click', () => {
    if (addJingleMenuItem.disabled) return;
    toggleAddMenu(false);
    openJingleDialog(null);
  });

  // ---- Category dialog ----
  function openCategoryDialog(cat) {
    categoryForm.reset();
    if (cat) {
      categoryDialogTitle.textContent = RJI18n.t('categoryDialog.editTitle');
      categoryIdInput.value = String(cat.id);
      categoryNameInput.value = cat.name;
      categoryColorInput.value = cat.color;
      deleteCategoryBtn.classList.remove('hidden');
    } else {
      categoryDialogTitle.textContent = RJI18n.t('categoryDialog.newTitle');
      categoryIdInput.value = '';
      categoryColorInput.value = randomNiceColor();
      deleteCategoryBtn.classList.add('hidden');
    }
    categoryDialog.showModal();
    categoryNameInput.focus();
  }

  function randomNiceColor() {
    const palette = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#db2777', '#0891b2', '#65a30d'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = categoryNameInput.value.trim();
    const color = categoryColorInput.value;
    if (!name) return;

    const id = categoryIdInput.value || null;
    try {
      if (id) {
        await RJDB.updateCategory(id, { name, color });
        showToast(RJI18n.t('toast.categoryUpdated'));
      } else {
        await RJDB.addCategory({ name, color });
        showToast(RJI18n.t('toast.categoryCreated'));
      }
      closeDialog(categoryDialog);
      await loadState();
      RJSync.pushSoon();
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('toast.saveFailed'));
    }
  });

  deleteCategoryBtn.addEventListener('click', async () => {
    const id = categoryIdInput.value;
    if (!id) return;
    const jingleCount = (state.jinglesByCategory.get(id) || []).length;
    const msg = jingleCount > 0
      ? RJI18n.t('categoryDialog.deleteConfirmWithJingles', { count: jingleCount })
      : RJI18n.t('categoryDialog.deleteConfirm');
    if (!confirm(msg)) return;
    await RJDB.deleteCategory(id);
    closeDialog(categoryDialog);
    showToast(RJI18n.t('toast.categoryDeleted'));
    await loadState();
    RJSync.pushSoon();
  });

  // ---- Jingle dialog ----
  function openJingleDialog(jingle, presetCategoryId) {
    jingleForm.reset();
    populateCategorySelect();

    if (jingle) {
      jingleDialogTitle.textContent = RJI18n.t('jingleDialog.editTitle');
      jingleIdInput.value = String(jingle.id);
      jingleFileInput.required = false;
      jingleFileHint.textContent = jingle.fileName
        ? RJI18n.t('jingleDialog.fileHintKeepNamed', { fileName: jingle.fileName })
        : RJI18n.t('jingleDialog.fileHintKeepGeneric');
      jingleFileHint.classList.remove('hidden');
      jingleNameInput.value = jingle.name;
      jingleCategorySelect.value = String(jingle.categoryId);
      const hasOverride = Boolean(jingle.color);
      jingleColorOverrideEnabled.checked = hasOverride;
      jingleColorInput.value = jingle.color || categoryColorOf(jingle.categoryId);
      jingleColorField.classList.toggle('hidden', !hasOverride);
      deleteJingleBtn.classList.remove('hidden');
    } else {
      jingleDialogTitle.textContent = RJI18n.t('jingleDialog.newTitle');
      jingleIdInput.value = '';
      jingleFileInput.required = true;
      jingleFileHint.classList.add('hidden');
      if (presetCategoryId != null) jingleCategorySelect.value = String(presetCategoryId);
      jingleColorOverrideEnabled.checked = false;
      jingleColorInput.value = categoryColorOf(presetCategoryId ?? jingleCategorySelect.value);
      jingleColorField.classList.add('hidden');
      deleteJingleBtn.classList.add('hidden');
    }
    jingleDialog.showModal();
    jingleNameInput.focus();
  }

  function populateCategorySelect() {
    jingleCategorySelect.innerHTML = '';
    for (const cat of state.categories) {
      const opt = document.createElement('option');
      opt.value = String(cat.id);
      opt.textContent = cat.name;
      jingleCategorySelect.appendChild(opt);
    }
  }

  jingleColorOverrideEnabled.addEventListener('change', () => {
    jingleColorField.classList.toggle('hidden', !jingleColorOverrideEnabled.checked);
  });

  jingleCategorySelect.addEventListener('change', () => {
    if (!jingleColorOverrideEnabled.checked) {
      jingleColorInput.value = categoryColorOf(jingleCategorySelect.value);
    }
  });

  jingleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = jingleNameInput.value.trim();
    const categoryId = jingleCategorySelect.value;
    const color = jingleColorOverrideEnabled.checked ? jingleColorInput.value : null;
    const id = jingleIdInput.value || null;
    const file = jingleFileInput.files[0];

    if (!name || !categoryId) return;
    if (!id && !file) {
      showToast(RJI18n.t('toast.fileRequired'));
      return;
    }

    try {
      const changes = { name, categoryId, color };
      if (file) {
        changes.blob = file;
        changes.mimeType = file.type;
        changes.fileName = file.name;
      }

      if (id) {
        await RJDB.updateJingle(id, changes);
        RJAudio.invalidate(id);
        showToast(RJI18n.t('toast.jingleUpdated'));
      } else {
        await RJDB.addJingle(changes);
        showToast(RJI18n.t('toast.jingleCreated'));
      }
      closeDialog(jingleDialog);
      await loadState();
      RJSync.pushSoon();
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('toast.saveFailed'));
    }
  });

  deleteJingleBtn.addEventListener('click', async () => {
    const id = jingleIdInput.value;
    if (!id) return;
    if (!confirm(RJI18n.t('jingleDialog.deleteConfirm'))) return;
    RJAudio.stop(id);
    RJAudio.invalidate(id);
    await RJDB.deleteJingle(id);
    closeDialog(jingleDialog);
    showToast(RJI18n.t('toast.jingleDeleted'));
    await loadState();
    RJSync.pushSoon();
  });

  // ---- Generic dialog close buttons ----
  document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dialog = btn.closest('dialog');
      closeDialog(dialog);
    });
  });

  // ---- Bottom bar ----
  masterVolumeInput.addEventListener('input', () => {
    RJAudio.setMasterVolume(Number(masterVolumeInput.value) / 100);
  });

  stopAllBtn.addEventListener('click', stopAll);

  // ---- Footer placeholders ----
  document.querySelectorAll('.footer-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const infoKey = FOOTER_INFO_KEYS[link.dataset.infoKey];
      infoDialogTitle.textContent = RJI18n.t(`footer.${infoKey}`);
      infoDialogText.textContent = RJI18n.t(`footer.${infoKey}Text`);
      infoDialog.showModal();
    });
  });

  // ---- Service worker registration ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('Service Worker Registrierung fehlgeschlagen', err);
      });
    });
  }

  // ---- Account / Cloud-Sync ----
  function formatSyncStatus(status) {
    if (status.syncing) return RJI18n.t('account.syncStatus.syncing');
    if (status.lastError) return RJI18n.t('account.syncStatus.failed', { error: status.lastError });
    if (!status.online) return RJI18n.t('account.syncStatus.offline');
    if (status.lastSyncAt) {
      const locale = RJI18n.getLanguage() === 'en' ? 'en-US' : 'de-DE';
      return RJI18n.t('account.syncStatus.lastSync', { time: new Date(status.lastSyncAt).toLocaleTimeString(locale) });
    }
    return RJI18n.t('account.syncStatus.never');
  }

  function refreshAccountDialog() {
    const status = RJSync.getStatus();
    authLoggedOutView.classList.toggle('hidden', status.authenticated);
    authLoggedInView.classList.toggle('hidden', !status.authenticated);
    if (status.authenticated) {
      authUserEmail.textContent = status.email || '';
      syncStatusText.textContent = formatSyncStatus(status);
    } else {
      authMessage.classList.add('hidden');
      authSendBtn.disabled = false;
    }
  }

  accountBtn.addEventListener('click', () => {
    refreshAccountDialog();
    accountDialog.showModal();
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmailInput.value.trim();
    if (!email) return;
    authSendBtn.disabled = true;
    authMessage.textContent = RJI18n.t('account.sendingLink');
    authMessage.classList.remove('hidden');
    try {
      await RJSync.signInWithEmail(email);
      authMessage.textContent = RJI18n.t('account.linkSent', { email });
    } catch (err) {
      console.error(err);
      authMessage.textContent = RJI18n.t('account.sendFailed', { error: err.message || err });
    } finally {
      authSendBtn.disabled = false;
    }
  });

  signOutBtn.addEventListener('click', async () => {
    await RJSync.signOut();
    closeDialog(accountDialog);
    showToast(RJI18n.t('account.signedOutToast'));
  });

  syncNowBtn.addEventListener('click', () => {
    RJSync.syncNow();
  });

  RJSync.onStatusChange((status) => {
    accountBtn.classList.toggle('hidden', !status.configured);
    accountBtn.classList.toggle('is-authed', status.authenticated);
    accountBtn.classList.toggle('is-syncing', status.syncing);
    accountBtn.classList.toggle('is-error', Boolean(status.lastError) && !status.syncing);
    accountBtn.title = status.authenticated
      ? RJI18n.t('header.accountTitleLoggedIn', { email: status.email })
      : RJI18n.t('header.accountTitleLoggedOut');
    if (accountDialog.open) refreshAccountDialog();

    const adminGate = status.authenticated && status.isAdmin;
    adminBtn.classList.toggle('hidden', !adminGate);
    if (isAdminRouteActive() && adminGate !== lastAdminGate) applyRoute();
    lastAdminGate = adminGate;
  });

  RJSync.onRemoteChange(() => {
    loadState().catch((err) => console.error(err));
  });

  // ---- Admin dashboard (Phase 4) ----
  // #/admin is a real, deep-linkable route, but the button/route being
  // hidden client-side is only a UX nicety. The actual gate is server-side:
  // adminUserStats() re-checks the caller's role itself (see
  // supabase/schema.sql), so a non-admin who navigates here directly always
  // just gets the "no access" message, never real data.
  function isAdminRouteActive() {
    return window.location.hash === '#/admin';
  }

  function formatAdminDate(iso) {
    const locale = RJI18n.getLanguage() === 'en' ? 'en-US' : 'de-DE';
    return new Date(iso).toLocaleDateString(locale);
  }

  function renderAdminStats(rows) {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    adminStatTotal.textContent = String(rows.length);
    adminStat7.textContent = String(rows.filter((r) => now - Date.parse(r.created_at) <= 7 * DAY_MS).length);
    adminStat30.textContent = String(rows.filter((r) => now - Date.parse(r.created_at) <= 30 * DAY_MS).length);

    adminUserRows.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const emailTd = document.createElement('td');
      emailTd.textContent = row.email;
      const dateTd = document.createElement('td');
      dateTd.textContent = formatAdminDate(row.created_at);
      const countTd = document.createElement('td');
      countTd.textContent = String(row.jingle_count);
      tr.append(emailTd, dateTd, countTd);
      adminUserRows.appendChild(tr);
    }
  }

  async function enterAdminRoute() {
    appViewEl.classList.add('hidden');
    consentBanner.classList.add('hidden');
    adminView.classList.remove('hidden');
    adminContent.classList.add('hidden');
    adminDenied.classList.add('hidden');

    const status = RJSync.getStatus();
    if (!status.authenticated || !status.isAdmin) {
      adminLoading.classList.add('hidden');
      adminDenied.classList.remove('hidden');
      return;
    }

    adminLoading.classList.remove('hidden');
    try {
      const rows = await RJSync.adminUserStats();
      renderAdminStats(rows);
      adminContent.classList.remove('hidden');
    } catch (err) {
      console.error('Admin: Laden fehlgeschlagen', err);
      adminDenied.textContent = RJI18n.t('admin.loadFailed');
      adminDenied.classList.remove('hidden');
    } finally {
      adminLoading.classList.add('hidden');
    }
  }

  function exitAdminRoute() {
    adminView.classList.add('hidden');
    appViewEl.classList.remove('hidden');
    updateConsentBanner();
  }

  function applyRoute() {
    if (isAdminRouteActive()) enterAdminRoute();
    else exitAdminRoute();
  }

  adminBtn.addEventListener('click', () => { window.location.hash = '#/admin'; });
  adminBackBtn.addEventListener('click', () => { window.location.hash = ''; });
  window.addEventListener('hashchange', applyRoute);

  // ---- Settings (language + ad-cookie consent) ----
  settingsBtn.addEventListener('click', () => {
    languageSelect.value = RJI18n.getLanguage();
    adConsentSelect.value = RJConsent.getStatus() === 'granted' ? 'granted' : 'denied';
    settingsDialog.showModal();
  });

  languageSelect.addEventListener('change', () => {
    RJI18n.setLanguage(languageSelect.value).then(() => RJSync.pushSoon());
  });

  adConsentSelect.addEventListener('change', () => {
    RJConsent.setStatus(adConsentSelect.value);
  });

  RJI18n.onChange(() => {
    // data-i18n elements are already updated by RJI18n itself; re-render
    // dynamic, JS-generated text (category counts, button titles, the
    // empty-jingle-list hint) and refresh whatever's currently open.
    render();
    if (accountDialog.open) refreshAccountDialog();
  });

  // ---- Ad area: which placeholder shows depends on consent, not just
  // connectivity — never forces network access itself, either way. ----
  function updateAdArea() {
    const online = navigator.onLine;
    const consent = RJConsent.getStatus();
    adSlotAdsense.classList.toggle('hidden', !(online && consent === 'granted'));
    adSlotEthical.classList.toggle('hidden', !(online && consent !== 'granted'));
  }

  function updateConsentBanner() {
    consentBanner.classList.toggle('hidden', RJConsent.getStatus() !== null);
  }

  consentAcceptBtn.addEventListener('click', () => RJConsent.setStatus('granted'));
  consentDeclineBtn.addEventListener('click', () => RJConsent.setStatus('denied'));

  RJConsent.onChange(() => {
    updateAdArea();
    updateConsentBanner();
  });

  window.addEventListener('online', updateAdArea);
  window.addEventListener('offline', updateAdArea);

  // ---- Init ----
  async function boot() {
    RJAudio.setMasterVolume(Number(masterVolumeInput.value) / 100);
    updateAdArea();
    updateConsentBanner();
    try {
      await RJI18n.init();
    } catch (err) {
      console.error('RJI18n.init fehlgeschlagen', err);
    }
    try {
      await loadState();
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('toast.loadFailed'));
    }
    applyRoute();
    RJSync.init().catch((err) => console.error('RJSync.init fehlgeschlagen', err));
  }
  boot();
})();
