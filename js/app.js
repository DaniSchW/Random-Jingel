/* Random Jingle - app logic. IndexedDB is always the source of truth for
 * the UI (offline-first); RJSync (Phase 2) is a best-effort layer that
 * mirrors changes to Supabase when configured, online and authenticated. */
(() => {
  'use strict';

  const state = {
    categories: [],
    jinglesByCategory: new Map(), // categoryId -> jingle[]
    hotkeyMap: new Map(), // hotkey string -> jingle
  };

  const jingleButtonEls = new Map(); // jingleId -> { btn, timeSpan, progressEl }
  const randomButtonEls = new Map(); // categoryId -> button element
  const sequenceProgressEls = new Map(); // categoryId -> "Jingle x von y" span (sequential mode only)

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
  const categoryPlaybackModeSelect = document.getElementById('categoryPlaybackMode');
  const deleteCategoryBtn = document.getElementById('deleteCategoryBtn');

  const jingleDialog = document.getElementById('jingleDialog');
  const jingleForm = document.getElementById('jingleForm');
  const jingleDialogTitle = document.getElementById('jingleDialogTitle');
  const jingleIdInput = document.getElementById('jingleId');
  const jingleFileInput = document.getElementById('jingleFile');
  const jingleFileHint = document.getElementById('jingleFileHint');
  const jingleSourceNoteHint = document.getElementById('jingleSourceNoteHint');
  const jingleNameInput = document.getElementById('jingleName');
  const jingleCategorySelect = document.getElementById('jingleCategory');
  const jingleColorOverrideEnabled = document.getElementById('jingleColorOverrideEnabled');
  const jingleColorField = document.getElementById('jingleColorField');
  const jingleColorInput = document.getElementById('jingleColor');
  const jingleTrimBtn = document.getElementById('jingleTrimBtn');
  const deleteJingleBtn = document.getElementById('deleteJingleBtn');
  const jingleHotkeyDisplay = document.getElementById('jingleHotkeyDisplay');
  const jingleHotkeyAssignBtn = document.getElementById('jingleHotkeyAssignBtn');
  const jingleHotkeyClearBtn = document.getElementById('jingleHotkeyClearBtn');
  const jingleHotkeyInput = document.getElementById('jingleHotkeyInput');
  const jingleSearchSection = document.getElementById('jingleSearchSection');
  const jingleSearchTabSfx = document.getElementById('jingleSearchTabSfx');
  const jingleSearchTabMusic = document.getElementById('jingleSearchTabMusic');
  const jingleSearchInput = document.getElementById('jingleSearchInput');
  const jingleSearchBtn = document.getElementById('jingleSearchBtn');
  const jingleSearchStatus = document.getElementById('jingleSearchStatus');
  const jingleSearchResults = document.getElementById('jingleSearchResults');

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
  const openTrashBtn = document.getElementById('openTrashBtn');
  const footerSupportBtn = document.getElementById('footerSupportBtn');

  const trashDialog = document.getElementById('trashDialog');
  const trashList = document.getElementById('trashList');
  const trashEmptyHint = document.getElementById('trashEmptyHint');

  const adSlotAdsense = document.getElementById('adSlotAdsense');
  const consentBanner = document.getElementById('consentBanner');
  const consentAcceptBtn = document.getElementById('consentAcceptBtn');
  const consentDeclineBtn = document.getElementById('consentDeclineBtn');

  // The legal pages only exist in German and English (see impressum.html /
  // impressum.en.html etc.) — every other supported language falls back to
  // the English version rather than showing an empty/broken page.
  const footerImprintLink = document.getElementById('footerImprintLink');
  const footerPrivacyLink = document.getElementById('footerPrivacyLink');
  const footerTermsLink = document.getElementById('footerTermsLink');
  function updateLegalLinks() {
    const suffix = RJI18n.getLanguage() === 'de' ? '' : '.en';
    footerImprintLink.href = `impressum${suffix}.html`;
    footerPrivacyLink.href = `datenschutz${suffix}.html`;
    footerTermsLink.href = `agb${suffix}.html`;
  }

  const helpToggle = document.getElementById('helpToggle');
  const helpPanel = document.getElementById('helpPanel');

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

  const exportDataBtn = document.getElementById('exportDataBtn');
  const importDataBtn = document.getElementById('importDataBtn');
  const importFileInput = document.getElementById('importFileInput');
  const importChoiceDialog = document.getElementById('importChoiceDialog');
  const importMergeBtn = document.getElementById('importMergeBtn');
  const importOverwriteBtn = document.getElementById('importOverwriteBtn');
  const importCancelBtn = document.getElementById('importCancelBtn');

  const masterVolumeInput = document.getElementById('masterVolume');
  const stopAllBtn = document.getElementById('stopAllBtn');
  const toastEl = document.getElementById('toast');

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

  // ---- Hotkeys (Phase 9) ----
  // Stored/synced as "5" or "ctrl+5" (digits 1-9 only, optional Ctrl/Cmd).
  function normalizeHotkeyEvent(e) {
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return null;
    return (e.ctrlKey || e.metaKey) ? `ctrl+${m[1]}` : m[1];
  }

  function formatHotkeyBadge(hotkey) {
    return hotkey.startsWith('ctrl+') ? `⌃${hotkey.slice(5)}` : hotkey;
  }

  function formatHotkeyFull(hotkey) {
    if (!hotkey) return RJI18n.t('jingleDialog.hotkeyNone');
    return hotkey.startsWith('ctrl+')
      ? `${RJI18n.t('jingleDialog.hotkeyCtrlPrefix')}${hotkey.slice(5)}`
      : hotkey;
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
    state.hotkeyMap = new Map();
    for (const jingle of jingles) {
      if (jingle.hotkey) state.hotkeyMap.set(jingle.hotkey, jingle);
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
    sequenceProgressEls.clear();

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

    const isSequential = cat.playbackMode === 'sequential';
    const sequenceProgress = document.createElement('span');
    sequenceProgress.className = 'category-sequence-progress';
    if (!isSequential) sequenceProgress.classList.add('hidden');
    sequenceProgressEls.set(cat.id, sequenceProgress);
    updateSequenceProgressDisplay(cat.id, cat.sequentialIndex ?? 0, jingles.length);

    heading.append(dot, nameBtn, count, sequenceProgress);

    const body = document.createElement('div');
    body.className = 'category-body';

    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.className = 'random-btn';
    if (isSequential) {
      randomBtn.innerHTML = `<span class="random-icon" aria-hidden="true">⏭️</span><span>${escapeHtml(RJI18n.t('random.nextLabel'))}</span>`;
      randomBtn.addEventListener('click', () => playSequential(cat));
    } else {
      randomBtn.innerHTML = `<span class="random-icon" aria-hidden="true">🔀</span><span>${escapeHtml(RJI18n.t('random.label'))}</span>`;
      randomBtn.addEventListener('click', () => playRandom(cat));
    }
    applyColorVars(randomBtn, cat.color);
    randomButtonEls.set(cat.id, randomBtn);

    const scroll = document.createElement('div');
    scroll.className = 'jingle-scroll';
    scroll.dataset.i18nEmpty = RJI18n.t('empty.noJingles');

    for (const jingle of jingles) {
      scroll.appendChild(renderJingleItem(jingle));
    }
    attachDragReorder(scroll, cat.id);

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
    item.dataset.jingleId = String(jingle.id);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jingle-btn';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'jingle-btn-name';
    nameSpan.textContent = jingle.name;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'jingle-btn-time hidden';

    const progressEl = document.createElement('span');
    progressEl.className = 'jingle-btn-progress';
    progressEl.setAttribute('aria-hidden', 'true');

    btn.append(nameSpan, timeSpan, progressEl);
    if (jingle.hotkey) {
      const hotkeyBadge = document.createElement('span');
      hotkeyBadge.className = 'jingle-btn-hotkey';
      hotkeyBadge.textContent = formatHotkeyBadge(jingle.hotkey);
      btn.appendChild(hotkeyBadge);
    }
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

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'jingle-drag-handle';
    dragHandle.title = RJI18n.t('jingle.dragHandleTitle');
    dragHandle.setAttribute('aria-label', RJI18n.t('jingle.dragHandleTitle'));
    dragHandle.textContent = '⠿';

    item.append(btn, editBtn, dragHandle);
    jingleButtonEls.set(jingle.id, { btn, timeSpan, progressEl });
    return item;
  }

  // ---- Drag-and-drop reordering within a category (Phase 11) ----
  // Pointer Events (not native HTML5 drag-and-drop, which mobile Safari/
  // Chrome don't fire reliably for touch) so the same code path handles
  // mouse and touch, mirroring js/trim.js's marker-dragging pattern.
  // The dragged tile itself is repositioned live to track the drop target
  // (dimmed via .jingle-item-dragging) while a floating ghost clone tracks
  // the actual pointer/finger, so there's always a clear "what's being
  // held" cue even where a finger occludes the tile underneath it.
  function attachDragReorder(scrollEl, categoryId) {
    let drag = null;

    scrollEl.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.jingle-drag-handle');
      if (!handle) return;
      const item = handle.closest('.jingle-item');
      if (!item) return;
      e.preventDefault();

      const rect = item.getBoundingClientRect();
      const ghost = item.querySelector('.jingle-btn').cloneNode(true);
      ghost.classList.add('jingle-drag-ghost');
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);

      item.classList.add('jingle-item-dragging');

      drag = {
        item,
        ghost,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
      handle.setPointerCapture(e.pointerId);
    });

    scrollEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.ghost.style.left = `${e.clientX - drag.offsetX}px`;
      drag.ghost.style.top = `${e.clientY - drag.offsetY}px`;

      const siblings = Array.from(scrollEl.querySelectorAll('.jingle-item')).filter((el) => el !== drag.item);
      for (const sib of siblings) {
        const r = sib.getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          if (sib.previousElementSibling !== drag.item) scrollEl.insertBefore(drag.item, sib);
          return;
        }
      }
      // Past every sibling's midpoint -> last slot, right before the
      // always-present "+" add-jingle button at the end of the row.
      const addBtn = scrollEl.querySelector('.add-jingle-quick');
      if (drag.item.nextElementSibling !== addBtn) scrollEl.insertBefore(drag.item, addBtn);
    });

    async function endDrag() {
      if (!drag) return;
      const { item, ghost } = drag;
      item.classList.remove('jingle-item-dragging');
      ghost.remove();
      drag = null;

      const orderedIds = Array.from(scrollEl.querySelectorAll('.jingle-item'))
        .map((el) => el.dataset.jingleId)
        .filter(Boolean);
      await RJDB.reorderJingles(orderedIds);
      const byId = new Map((state.jinglesByCategory.get(categoryId) || []).map((j) => [j.id, j]));
      state.jinglesByCategory.set(categoryId, orderedIds.map((id) => byId.get(id)).filter(Boolean));
      RJSync.pushSoon();
    }

    scrollEl.addEventListener('pointerup', endDrag);
    scrollEl.addEventListener('pointercancel', endDrag);
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
  // Cut points (Phase 6) are metadata only — the stored file is untouched.
  // trimStart null means "from the start"; trimEnd null means "to the end".
  function trimRangeFor(jingle) {
    const start = jingle.trimStart != null ? jingle.trimStart : 0;
    const duration = jingle.trimEnd != null && jingle.trimEnd > start ? jingle.trimEnd - start : undefined;
    return { start, duration };
  }

  // Progress bar + "0:03 / 0:08" readout (Phase 7) on the jingle's own
  // button — driven by RJAudio's requestAnimationFrame loop, so this just
  // paints whatever elapsed/total it's handed.
  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function updateJingleProgress(refs, elapsed, total) {
    if (!refs) return;
    const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
    refs.progressEl.style.width = `${pct}%`;
    refs.timeSpan.textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
    refs.timeSpan.classList.remove('hidden');
  }

  function resetJingleProgress(refs) {
    if (!refs) return;
    refs.progressEl.style.width = '0%';
    refs.timeSpan.textContent = '';
    refs.timeSpan.classList.add('hidden');
  }

  async function playJingle(jingle, extraButtons = []) {
    const refs = jingleButtonEls.get(jingle.id);
    const btn = refs && refs.btn;
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
      const { start, duration } = trimRangeFor(jingle);
      await RJAudio.play(jingle.id, blob, {
        start,
        duration,
        onStart: () => buttons.forEach((b) => b.classList.add('playing')),
        onProgress: (elapsed, total) => updateJingleProgress(refs, elapsed, total),
        onEnd: () => {
          buttons.forEach((b) => b.classList.remove('playing'));
          resetJingleProgress(refs);
        },
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

  // "Jingle {current} von {total}" — current is 1-based. Shown/updated
  // whenever a category is in sequential mode; hidden entirely otherwise.
  function updateSequenceProgressDisplay(categoryId, zeroBasedIndex, total) {
    const el = sequenceProgressEls.get(categoryId);
    if (!el) return;
    if (total <= 0) {
      el.classList.add('hidden');
      return;
    }
    el.textContent = RJI18n.t('category.sequenceProgress', { current: zeroBasedIndex + 1, total });
  }

  // Sequential playback (Phase 11): plays the jingle at the category's
  // stored sequentialIndex (following Part 1's drag-and-drop `order`),
  // then advances that index for next time, wrapping back to the start
  // after the last jingle. RJDB.advanceSequentialIndex() does the read/
  // clamp/increment/persist in one go and hands back the index that
  // should play *now*, so this can't race itself on a fast double-click.
  async function playSequential(cat) {
    const jingles = state.jinglesByCategory.get(cat.id) || [];
    if (jingles.length === 0) {
      showToast(RJI18n.t('category.noJinglesToast', { name: cat.name }));
      return;
    }
    const index = await RJDB.advanceSequentialIndex(cat.id, jingles.length);
    cat.sequentialIndex = (index + 1) % jingles.length;
    updateSequenceProgressDisplay(cat.id, index, jingles.length);
    RJSync.pushSoon();

    const jingle = jingles[index];
    const randomBtn = randomButtonEls.get(cat.id);
    playJingle(jingle, [randomBtn]);
  }

  function stopAll() {
    RJAudio.stopAll();
    for (const refs of jingleButtonEls.values()) {
      refs.btn.classList.remove('playing');
      resetJingleProgress(refs);
    }
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
      categoryPlaybackModeSelect.value = cat.playbackMode === 'sequential' ? 'sequential' : 'random';
      deleteCategoryBtn.classList.remove('hidden');
    } else {
      categoryDialogTitle.textContent = RJI18n.t('categoryDialog.newTitle');
      categoryIdInput.value = '';
      categoryColorInput.value = randomNiceColor();
      categoryPlaybackModeSelect.value = 'random';
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
    const playbackMode = categoryPlaybackModeSelect.value === 'sequential' ? 'sequential' : 'random';
    if (!name) return;

    const id = categoryIdInput.value || null;
    try {
      if (id) {
        await RJDB.updateCategory(id, { name, color, playbackMode });
        showToast(RJI18n.t('toast.categoryUpdated'));
      } else {
        await RJDB.addCategory({ name, color, playbackMode });
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
  let editingJingle = null;

  function openJingleDialog(jingle, presetCategoryId) {
    jingleForm.reset();
    populateCategorySelect();
    editingJingle = jingle || null;

    if (jingle) {
      jingleDialogTitle.textContent = RJI18n.t('jingleDialog.editTitle');
      jingleIdInput.value = String(jingle.id);
      jingleFileInput.required = false;
      jingleFileHint.textContent = jingle.fileName
        ? RJI18n.t('jingleDialog.fileHintKeepNamed', { fileName: jingle.fileName })
        : RJI18n.t('jingleDialog.fileHintKeepGeneric');
      jingleFileHint.classList.remove('hidden');
      if (jingle.sourceNote) {
        jingleSourceNoteHint.textContent = jingle.sourceNote;
        jingleSourceNoteHint.classList.remove('hidden');
      } else {
        jingleSourceNoteHint.classList.add('hidden');
      }
      jingleNameInput.value = jingle.name;
      jingleCategorySelect.value = String(jingle.categoryId);
      const hasOverride = Boolean(jingle.color);
      jingleColorOverrideEnabled.checked = hasOverride;
      jingleColorInput.value = jingle.color || categoryColorOf(jingle.categoryId);
      jingleColorField.classList.toggle('hidden', !hasOverride);
      jingleTrimBtn.classList.remove('hidden');
      deleteJingleBtn.classList.remove('hidden');
    } else {
      jingleDialogTitle.textContent = RJI18n.t('jingleDialog.newTitle');
      jingleIdInput.value = '';
      jingleFileInput.required = true;
      jingleFileHint.classList.add('hidden');
      jingleSourceNoteHint.classList.add('hidden');
      pendingImportMeta = null;
      if (presetCategoryId != null) jingleCategorySelect.value = String(presetCategoryId);
      jingleColorOverrideEnabled.checked = false;
      jingleColorInput.value = categoryColorOf(presetCategoryId ?? jingleCategorySelect.value);
      jingleColorField.classList.add('hidden');
      jingleTrimBtn.classList.add('hidden');
      deleteJingleBtn.classList.add('hidden');
    }
    jingleHotkeyInput.value = (jingle && jingle.hotkey) || '';
    updateHotkeyDisplay();
    resetJingleSearchSection(!jingle);
    jingleDialog.showModal();
    jingleNameInput.focus();
  }

  // ---- Royalty-free search (Sound Effects via Freesound) ----
  // Only shown when creating a brand-new jingle (not editing an existing
  // one), and only when RJMediaSearch itself considers the section usable
  // (API key configured in js/config.js AND currently online). Re-checked
  // every time the dialog opens, since connectivity can change between
  // visits without a page reload.
  let searchPreviewAudio = null;
  let searchPreviewBtnEl = null;

  function stopSearchPreview() {
    if (searchPreviewAudio) {
      searchPreviewAudio.pause();
      searchPreviewAudio = null;
    }
    if (searchPreviewBtnEl) {
      searchPreviewBtnEl.textContent = RJI18n.t('jingleSearch.previewPlay');
      searchPreviewBtnEl = null;
    }
  }

  // Set by selectSearchResult() right before it opens the trim editor;
  // picked up and merged into the new jingle's fields by jingleForm's
  // submit handler, then cleared. Only ever relevant for a brand-new
  // jingle (the search section never shows while editing one).
  let pendingImportMeta = null;

  function buildSourceNote(result) {
    const licenseLabel = RJMediaSearch.shortLicenseLabel(result.license);
    // Jamendo tracks that make it through the NC filter almost always still
    // need attribution (some form of "BY") -- the rare CC0 Jamendo track
    // doesn't, so it deliberately falls through to the generic note below
    // instead of claiming "attribution required" when none is needed.
    if (result.sourceLabel === 'Jamendo' && result.artist && licenseLabel !== 'CC0') {
      return RJI18n.t('jingleSearch.sourceNoteJamendoWithArtist', {
        title: result.trackTitle || result.title,
        artist: result.artist,
        license: licenseLabel || '?',
      });
    }
    return licenseLabel
      ? RJI18n.t('jingleSearch.sourceNoteWithLicense', { source: result.sourceLabel, license: licenseLabel })
      : RJI18n.t('jingleSearch.sourceNoteNoLicense', { source: result.sourceLabel });
  }

  // Downloads the result's actual audio, then opens the existing trim
  // editor (js/trim.js) against that not-yet-saved audio -- same waveform/
  // start-end-marker UI a normal upload gets, just before the jingle
  // exists rather than after. A random id (not a real jingle id yet) keeps
  // RJAudio's per-jingle buffer cache from confusing this import with any
  // other still-unsaved one from the same session.
  async function selectSearchResult(result, selectBtn) {
    stopSearchPreview();
    selectBtn.disabled = true;
    jingleSearchStatus.textContent = RJI18n.t('jingleSearch.importing');
    jingleSearchStatus.classList.remove('hidden');
    try {
      const res = await fetch(result.previewUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const mimeType = blob.type || 'audio/mpeg';
      const fileName = `${result.title || 'import'}.${mimeType.includes('wav') ? 'wav' : 'mp3'}`;
      const file = new File([blob], fileName, { type: mimeType });
      const sourceNote = buildSourceNote(result);
      const tempId = crypto.randomUUID();

      jingleSearchStatus.classList.add('hidden');

      RJTrimUI.open({ id: tempId, name: result.title, trimStart: null, trimEnd: null }, file, {
        onSave: (trimStart, trimEnd) => {
          pendingImportMeta = { trimStart, trimEnd, sourceNote };
          jingleNameInput.value = result.title;
          const dt = new DataTransfer();
          dt.items.add(file);
          jingleFileInput.files = dt.files;
          jingleFileHint.classList.add('hidden');
        },
      });
    } catch (err) {
      console.warn('Import fehlgeschlagen', err);
      jingleSearchStatus.textContent = RJI18n.t('jingleSearch.importFailed');
      jingleSearchStatus.classList.remove('hidden');
    } finally {
      selectBtn.disabled = false;
    }
  }

  function renderSearchResults(results) {
    jingleSearchResults.innerHTML = '';
    for (const result of results) {
      const li = document.createElement('li');
      li.className = 'jingle-search-result';

      const title = document.createElement('span');
      title.className = 'jingle-search-result-title';
      title.textContent = result.title;
      title.title = result.title;

      const duration = document.createElement('span');
      duration.className = 'jingle-search-result-duration';
      duration.textContent = formatTime(result.durationSeconds);

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'btn btn-ghost jingle-search-result-preview-btn';
      previewBtn.textContent = RJI18n.t('jingleSearch.previewPlay');
      previewBtn.setAttribute('aria-label', RJI18n.t('jingleSearch.previewAriaLabel', { title: result.title }));
      previewBtn.addEventListener('click', () => {
        if (searchPreviewBtnEl === previewBtn) {
          stopSearchPreview();
          return;
        }
        stopSearchPreview();
        try {
          const audio = new Audio(result.previewUrl);
          audio.addEventListener('ended', stopSearchPreview);
          audio.addEventListener('error', stopSearchPreview);
          audio.play().catch(() => stopSearchPreview());
          searchPreviewAudio = audio;
          searchPreviewBtnEl = previewBtn;
          previewBtn.textContent = RJI18n.t('jingleSearch.previewStop');
        } catch (err) {
          console.warn('Vorhören fehlgeschlagen', err);
          stopSearchPreview();
        }
      });

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'btn btn-primary jingle-search-result-select-btn';
      selectBtn.textContent = RJI18n.t('jingleSearch.selectButton');
      selectBtn.addEventListener('click', () => selectSearchResult(result, selectBtn));

      li.append(title, duration, previewBtn, selectBtn);
      jingleSearchResults.appendChild(li);
    }
  }

  // 'sfx' or 'music' -- which of the two sources the search bar currently
  // queries. Sound Effects is the default/most relevant tab for jingles.
  let activeSearchTab = 'sfx';

  async function runJingleSearch() {
    const query = jingleSearchInput.value;
    const searchFn = activeSearchTab === 'music' ? RJMediaSearch.searchMusic : RJMediaSearch.searchSoundEffects;
    stopSearchPreview();
    jingleSearchResults.innerHTML = '';
    jingleSearchStatus.textContent = RJI18n.t('jingleSearch.searching');
    jingleSearchStatus.classList.remove('hidden');
    const outcome = await searchFn(query);
    if (outcome.error) {
      jingleSearchStatus.textContent = RJI18n.t('jingleSearch.error');
      jingleSearchStatus.classList.remove('hidden');
      return;
    }
    if (outcome.results.length === 0) {
      jingleSearchStatus.textContent = RJI18n.t('jingleSearch.noResults');
      jingleSearchStatus.classList.remove('hidden');
      return;
    }
    jingleSearchStatus.classList.add('hidden');
    renderSearchResults(outcome.results);
  }

  jingleSearchBtn.addEventListener('click', runJingleSearch);
  jingleSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runJingleSearch();
    }
  });

  function setActiveSearchTab(tab) {
    activeSearchTab = tab;
    jingleSearchTabSfx.classList.toggle('active', tab === 'sfx');
    jingleSearchTabMusic.classList.toggle('active', tab === 'music');
    stopSearchPreview();
    jingleSearchInput.value = '';
    jingleSearchResults.innerHTML = '';
    jingleSearchStatus.classList.add('hidden');
  }

  jingleSearchTabSfx.addEventListener('click', () => setActiveSearchTab('sfx'));
  jingleSearchTabMusic.addEventListener('click', () => setActiveSearchTab('music'));

  function resetJingleSearchSection(isNewJingle) {
    stopSearchPreview();
    jingleSearchInput.value = '';
    jingleSearchResults.innerHTML = '';
    jingleSearchStatus.classList.add('hidden');

    const sfxAvailable = isNewJingle && typeof RJMediaSearch !== 'undefined' && RJMediaSearch.soundEffectsAvailable();
    const musicAvailable = isNewJingle && typeof RJMediaSearch !== 'undefined' && RJMediaSearch.musicAvailable();
    jingleSearchSection.classList.toggle('hidden', !sfxAvailable && !musicAvailable);
    // Only offer a tab for a source that's actually configured -- e.g. if
    // just FREESOUND_API_KEY is set, the Music tab never even appears
    // rather than showing a permanently-broken option.
    jingleSearchTabSfx.classList.toggle('hidden', !sfxAvailable);
    jingleSearchTabMusic.classList.toggle('hidden', !musicAvailable);
    setActiveSearchTab(sfxAvailable ? 'sfx' : 'music');
  }

  jingleDialog.addEventListener('close', stopSearchPreview);

  function updateHotkeyDisplay() {
    jingleHotkeyDisplay.textContent = formatHotkeyFull(jingleHotkeyInput.value);
    jingleHotkeyClearBtn.classList.toggle('hidden', !jingleHotkeyInput.value);
  }

  let hotkeyListening = false;
  let hotkeyListenCleanup = null;

  function cancelHotkeyListening() {
    if (!hotkeyListening) return;
    hotkeyListening = false;
    if (hotkeyListenCleanup) hotkeyListenCleanup();
    hotkeyListenCleanup = null;
    updateHotkeyDisplay();
  }

  jingleHotkeyAssignBtn.addEventListener('click', () => {
    if (hotkeyListening) return;
    hotkeyListening = true;
    const prevLabel = jingleHotkeyAssignBtn.textContent;
    jingleHotkeyAssignBtn.textContent = RJI18n.t('jingleDialog.hotkeyListening');
    jingleHotkeyDisplay.textContent = RJI18n.t('jingleDialog.hotkeyListening');

    const onKey = (e) => {
      // A Ctrl/Cmd+digit combo fires a keydown for the modifier itself
      // first — ignore that one and keep listening for the actual key.
      if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'AltGraph') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      hotkeyListening = false;
      document.removeEventListener('keydown', onKey, true);
      hotkeyListenCleanup = null;
      jingleHotkeyAssignBtn.textContent = prevLabel;

      if (e.key === 'Escape') {
        updateHotkeyDisplay();
        return;
      }
      const normalized = normalizeHotkeyEvent(e);
      if (!normalized) {
        updateHotkeyDisplay();
        showToast(RJI18n.t('jingleDialog.hotkeyInvalid'));
        return;
      }
      const excludeId = jingleIdInput.value || null;
      const conflict = state.hotkeyMap.get(normalized);
      if (conflict && conflict.id !== excludeId) {
        updateHotkeyDisplay();
        showToast(RJI18n.t('jingleDialog.hotkeyConflict', { name: conflict.name }));
        return;
      }
      jingleHotkeyInput.value = normalized;
      updateHotkeyDisplay();
    };
    hotkeyListenCleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      jingleHotkeyAssignBtn.textContent = prevLabel;
    };
    document.addEventListener('keydown', onKey, true);
  });

  jingleHotkeyClearBtn.addEventListener('click', () => {
    jingleHotkeyInput.value = '';
    updateHotkeyDisplay();
  });

  jingleDialog.addEventListener('close', cancelHotkeyListening);

  jingleTrimBtn.addEventListener('click', async () => {
    if (!editingJingle) return;
    let blob = editingJingle.blob;
    if (!blob) {
      showToast(RJI18n.t('toast.downloadingAudio'));
      blob = await RJSync.ensureBlob(editingJingle);
      if (!blob) {
        showToast(RJI18n.t('toast.audioUnavailable'));
        return;
      }
    }
    RJTrimUI.open(editingJingle, blob, {
      onSave: async (trimStart, trimEnd) => {
        try {
          await RJDB.updateJingle(editingJingle.id, { trimStart, trimEnd });
          showToast(RJI18n.t('trim.saved'));
          await loadState();
          RJSync.pushSoon();
        } catch (err) {
          console.error(err);
          showToast(RJI18n.t('toast.saveFailed'));
        }
      },
    });
  });

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
      const changes = { name, categoryId, color, hotkey: jingleHotkeyInput.value || null };
      if (file) {
        changes.blob = file;
        changes.mimeType = file.type;
        changes.fileName = file.name;
      }
      // Trim range + source hint picked up from the royalty-free search
      // (see selectSearchResult()) -- only ever set for a brand-new jingle.
      if (pendingImportMeta) {
        changes.trimStart = pendingImportMeta.trimStart;
        changes.trimEnd = pendingImportMeta.trimEnd;
        changes.sourceNote = pendingImportMeta.sourceNote;
      }

      if (id) {
        await RJDB.updateJingle(id, changes);
        RJAudio.invalidate(id);
        showToast(RJI18n.t('toast.jingleUpdated'));
      } else {
        await RJDB.addJingle(changes);
        showToast(RJI18n.t('toast.jingleCreated'));
      }
      pendingImportMeta = null;
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

  // Global hotkey playback (Phase 9): active whenever the app has focus,
  // except while typing in a field or while a dialog is open (both to avoid
  // hijacking normal typing, and because the hotkey-assign flow above uses
  // its own capture-phase listener that already stopPropagation()s).
  document.addEventListener('keydown', (e) => {
    if (hotkeyListening) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const normalized = normalizeHotkeyEvent(e);
    if (!normalized) return;
    const jingle = state.hotkeyMap.get(normalized);
    if (!jingle) return;
    e.preventDefault();
    playJingle(jingle);
  });

  // Footer links (Impressum/Datenschutz/AGB) are real pages now — plain
  // <a href> navigation, no JS needed.

  // ---- Service worker registration ----
  // A browser only re-checks sw.js for changes on its own schedule (per
  // spec, at most once every 24h) — far too slow for a visitor to notice a
  // shipped fix. .update() forces an immediate, unconditional re-fetch of
  // sw.js on every load, so a bumped CACHE_VERSION (and the fix that came
  // with it) takes effect on this visitor's very next visit instead of
  // however much later the browser would have gotten around to it.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((registration) => registration.update())
        .catch((err) => {
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
      const locale = RJI18n.getLocale();
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
    return new Date(iso).toLocaleDateString(RJI18n.getLocale());
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

  // Footer support link opens the same Settings dialog rather than picking
  // one of the two donation links itself — both stay equally one click away.
  footerSupportBtn.addEventListener('click', () => settingsBtn.click());

  languageSelect.addEventListener('change', () => {
    RJI18n.setLanguage(languageSelect.value).then(() => RJSync.pushSoon());
  });

  adConsentSelect.addEventListener('change', () => {
    RJConsent.setStatus(adConsentSelect.value);
  });

  // ---- Trash / undo for deleted jingles (Phase 8) ----
  function formatHoursRemaining(deletedAt) {
    const remainingMs = deletedAt + RJDB.TRASH_MAX_AGE_MS - Date.now();
    const hours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
    return RJI18n.t('trash.expiresIn', { hours });
  }

  async function renderTrash() {
    const trash = await RJDB.getTrash();
    trashList.innerHTML = '';
    trashEmptyHint.classList.toggle('hidden', trash.length > 0);
    trash.forEach((jingle) => {
      const li = document.createElement('li');
      li.className = 'trash-item';

      const info = document.createElement('div');
      info.className = 'trash-item-info';
      const name = document.createElement('span');
      name.className = 'trash-item-name';
      name.textContent = jingle.name;
      const expiry = document.createElement('span');
      expiry.className = 'trash-item-expiry';
      expiry.textContent = formatHoursRemaining(jingle.deletedAt);
      info.append(name, expiry);

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'btn btn-ghost';
      restoreBtn.textContent = RJI18n.t('trash.restore');
      restoreBtn.addEventListener('click', async () => {
        await RJDB.restoreJingle(jingle.id);
        await loadState();
        await renderTrash();
        showToast(RJI18n.t('trash.restoredToast', { name: jingle.name }));
        RJSync.pushSoon();
      });

      li.append(info, restoreBtn);
      trashList.appendChild(li);
    });
  }

  openTrashBtn.addEventListener('click', async () => {
    closeDialog(settingsDialog);
    await renderTrash();
    trashDialog.showModal();
  });

  // Runs once at boot and then hourly: hard-removes trash entries older than
  // 24h (locally always; remotely best-effort, see RJSync.purgeExpiredTrash).
  // A short poll interval isn't needed since nothing in the UI depends on the
  // purge happening the instant an item expires.
  async function purgeExpiredTrashAndRefresh() {
    const purged = await RJSync.purgeExpiredTrash();
    if (purged.length) {
      await loadState();
      if (trashDialog.open) await renderTrash();
    }
  }

  // ---- Local export/import (Phase 5) ----
  exportDataBtn.addEventListener('click', async () => {
    closeDialog(settingsDialog);
    try {
      await RJExport.exportAll();
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('settings.exportFailed', { error: err.message || err }));
    }
  });

  importDataBtn.addEventListener('click', () => importFileInput.click());

  // Resolves 'merge' | 'overwrite' | null (cancelled) once the user picks a
  // button in importChoiceDialog, including the native Esc/cancel path.
  function askImportMode() {
    return new Promise((resolve) => {
      function finish(mode) {
        importMergeBtn.removeEventListener('click', onMerge);
        importOverwriteBtn.removeEventListener('click', onOverwrite);
        importCancelBtn.removeEventListener('click', onCancel);
        importChoiceDialog.removeEventListener('cancel', onCancel);
        closeDialog(importChoiceDialog);
        resolve(mode);
      }
      const onMerge = () => finish('merge');
      const onOverwrite = () => finish('overwrite');
      const onCancel = () => finish(null);
      importMergeBtn.addEventListener('click', onMerge);
      importOverwriteBtn.addEventListener('click', onOverwrite);
      importCancelBtn.addEventListener('click', onCancel);
      importChoiceDialog.addEventListener('cancel', onCancel);
      importChoiceDialog.showModal();
    });
  }

  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files[0];
    importFileInput.value = '';
    if (!file) return;
    closeDialog(settingsDialog);
    try {
      const parsed = await RJExport.readImportFile(file);
      let mode = 'merge';
      if (state.categories.length > 0) {
        mode = await askImportMode();
        if (!mode) return;
      }
      const result = await RJExport.applyImport(parsed, mode);
      await loadState();
      RJSync.pushSoon();
      showToast(RJI18n.t('settings.importDone', { categories: result.categoriesImported, jingles: result.jinglesImported }));
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('settings.importFailed', { error: err.message || err }));
    }
  });

  RJI18n.onChange(() => {
    // data-i18n elements are already updated by RJI18n itself; re-render
    // dynamic, JS-generated text (category counts, button titles, the
    // empty-jingle-list hint) and refresh whatever's currently open.
    render();
    if (accountDialog.open) refreshAccountDialog();
    updateLegalLinks();
  });

  // ---- Ad area: AdSense only ever loads/shows after explicit consent +
  // while online — never speculatively. adRequested guards against asking
  // AdSense to fill the same <ins> more than once (it throws on that).
  let adRequested = false;
  async function updateAdArea() {
    const online = navigator.onLine;
    const consent = RJConsent.getStatus();
    const shouldShowAds = online && consent === 'granted';
    adSlotAdsense.classList.toggle('hidden', !shouldShowAds);
    if (!shouldShowAds) return;
    try {
      await RJAds.load();
      if (!adRequested) {
        RJAds.requestAd();
        adRequested = true;
      }
    } catch (err) {
      console.warn('AdSense konnte nicht geladen werden', err);
    }
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

  // ---- Help/guide accordion: plain expand/collapse, no exclusivity
  // between sections (opening one doesn't close the others) - the content
  // is short text, so there's no real cost to letting several sections
  // stay open at once. ----
  function wireAccordionToggle(toggleBtn, panelEl) {
    toggleBtn.addEventListener('click', () => {
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!expanded));
      panelEl.classList.toggle('hidden', expanded);
    });
  }
  wireAccordionToggle(helpToggle, helpPanel);
  helpPanel.querySelectorAll('.help-sub-toggle').forEach((subToggle) => {
    const body = document.getElementById(subToggle.getAttribute('aria-controls'));
    wireAccordionToggle(subToggle, body);
  });

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
    updateLegalLinks();
    try {
      await loadState();
    } catch (err) {
      console.error(err);
      showToast(RJI18n.t('toast.loadFailed'));
    }
    applyRoute();
    RJSync.init().catch((err) => console.error('RJSync.init fehlgeschlagen', err));
    purgeExpiredTrashAndRefresh().catch((err) => console.error('Papierkorb-Bereinigung fehlgeschlagen', err));
    setInterval(() => {
      purgeExpiredTrashAndRefresh().catch((err) => console.error('Papierkorb-Bereinigung fehlgeschlagen', err));
    }, 60 * 60 * 1000);
  }
  boot();
})();
