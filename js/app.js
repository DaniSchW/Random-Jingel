/* Random Jingle - app logic (Phase 1, local only, no backend). */
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

  const masterVolumeInput = document.getElementById('masterVolume');
  const stopAllBtn = document.getElementById('stopAllBtn');
  const toastEl = document.getElementById('toast');

  const FOOTER_PLACEHOLDER_TEXT = {
    Impressum: 'Platzhalter für das Impressum. Wird in einer späteren Phase ergänzt.',
    Datenschutz: 'Platzhalter für die Datenschutzerklärung. Wird in einer späteren Phase ergänzt.',
    AGB: 'Platzhalter für die AGB. Wird in einer späteren Phase ergänzt.',
  };

  // ---- Utilities ----
  let toastTimer = null;
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
    nameBtn.title = 'Kategorie bearbeiten';
    nameBtn.innerHTML = `<span>${escapeHtml(cat.name)}</span><span class="edit-hint" aria-hidden="true">✎</span>`;
    nameBtn.addEventListener('click', () => openCategoryDialog(cat));

    const count = document.createElement('span');
    count.className = 'category-count';
    count.textContent = `${jingles.length} Jingle${jingles.length === 1 ? '' : 's'}`;

    heading.append(dot, nameBtn, count);

    const body = document.createElement('div');
    body.className = 'category-body';

    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.className = 'random-btn';
    randomBtn.innerHTML = '<span class="random-icon" aria-hidden="true">🔀</span><span>Random</span>';
    applyColorVars(randomBtn, cat.color);
    randomBtn.addEventListener('click', () => playRandom(cat));
    randomButtonEls.set(cat.id, randomBtn);

    const scroll = document.createElement('div');
    scroll.className = 'jingle-scroll';

    for (const jingle of jingles) {
      scroll.appendChild(renderJingleItem(jingle));
    }

    const addQuickBtn = document.createElement('button');
    addQuickBtn.type = 'button';
    addQuickBtn.className = 'add-jingle-quick';
    addQuickBtn.title = 'Jingle zu dieser Kategorie hinzufügen';
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
    editBtn.title = 'Jingle bearbeiten';
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
    try {
      RJAudio.ensureContext();
      await RJAudio.play(jingle.id, jingle.blob, {
        onStart: () => buttons.forEach((b) => b.classList.add('playing')),
        onEnd: () => buttons.forEach((b) => b.classList.remove('playing')),
      });
    } catch (err) {
      console.error(err);
      showToast('Wiedergabe fehlgeschlagen.');
    }
  }

  function playRandom(cat) {
    const jingles = state.jinglesByCategory.get(cat.id) || [];
    if (jingles.length === 0) {
      showToast(`Keine Jingles in "${cat.name}".`);
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
      categoryDialogTitle.textContent = 'Kategorie bearbeiten';
      categoryIdInput.value = String(cat.id);
      categoryNameInput.value = cat.name;
      categoryColorInput.value = cat.color;
      deleteCategoryBtn.classList.remove('hidden');
    } else {
      categoryDialogTitle.textContent = 'Neue Kategorie';
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

    const id = categoryIdInput.value ? Number(categoryIdInput.value) : null;
    try {
      if (id) {
        await RJDB.updateCategory(id, { name, color });
        showToast('Kategorie aktualisiert.');
      } else {
        await RJDB.addCategory({ name, color });
        showToast('Kategorie angelegt.');
      }
      closeDialog(categoryDialog);
      await loadState();
    } catch (err) {
      console.error(err);
      showToast('Speichern fehlgeschlagen.');
    }
  });

  deleteCategoryBtn.addEventListener('click', async () => {
    const id = Number(categoryIdInput.value);
    if (!id) return;
    const jingleCount = (state.jinglesByCategory.get(id) || []).length;
    const msg = jingleCount > 0
      ? `Kategorie und ${jingleCount} zugehörige Jingle(s) wirklich löschen?`
      : 'Kategorie wirklich löschen?';
    if (!confirm(msg)) return;
    await RJDB.deleteCategory(id);
    closeDialog(categoryDialog);
    showToast('Kategorie gelöscht.');
    await loadState();
  });

  // ---- Jingle dialog ----
  function openJingleDialog(jingle, presetCategoryId) {
    jingleForm.reset();
    populateCategorySelect();

    if (jingle) {
      jingleDialogTitle.textContent = 'Jingle bearbeiten';
      jingleIdInput.value = String(jingle.id);
      jingleFileInput.required = false;
      jingleFileHint.textContent = jingle.fileName
        ? `Aktuelle Datei: ${jingle.fileName} (leer lassen, um sie zu behalten)`
        : 'Leer lassen, um die aktuelle Datei zu behalten.';
      jingleFileHint.classList.remove('hidden');
      jingleNameInput.value = jingle.name;
      jingleCategorySelect.value = String(jingle.categoryId);
      const hasOverride = Boolean(jingle.color);
      jingleColorOverrideEnabled.checked = hasOverride;
      jingleColorInput.value = jingle.color || categoryColorOf(jingle.categoryId);
      jingleColorField.classList.toggle('hidden', !hasOverride);
      deleteJingleBtn.classList.remove('hidden');
    } else {
      jingleDialogTitle.textContent = 'Neuer Jingle';
      jingleIdInput.value = '';
      jingleFileInput.required = true;
      jingleFileHint.classList.add('hidden');
      if (presetCategoryId != null) jingleCategorySelect.value = String(presetCategoryId);
      jingleColorOverrideEnabled.checked = false;
      jingleColorInput.value = categoryColorOf(presetCategoryId ?? Number(jingleCategorySelect.value));
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
      jingleColorInput.value = categoryColorOf(Number(jingleCategorySelect.value));
    }
  });

  jingleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = jingleNameInput.value.trim();
    const categoryId = Number(jingleCategorySelect.value);
    const color = jingleColorOverrideEnabled.checked ? jingleColorInput.value : null;
    const id = jingleIdInput.value ? Number(jingleIdInput.value) : null;
    const file = jingleFileInput.files[0];

    if (!name || !categoryId) return;
    if (!id && !file) {
      showToast('Bitte eine Audiodatei auswählen.');
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
        showToast('Jingle aktualisiert.');
      } else {
        await RJDB.addJingle(changes);
        showToast('Jingle angelegt.');
      }
      closeDialog(jingleDialog);
      await loadState();
    } catch (err) {
      console.error(err);
      showToast('Speichern fehlgeschlagen.');
    }
  });

  deleteJingleBtn.addEventListener('click', async () => {
    const id = Number(jingleIdInput.value);
    if (!id) return;
    if (!confirm('Jingle wirklich löschen?')) return;
    RJAudio.stop(id);
    RJAudio.invalidate(id);
    await RJDB.deleteJingle(id);
    closeDialog(jingleDialog);
    showToast('Jingle gelöscht.');
    await loadState();
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
      const key = link.dataset.placeholder;
      infoDialogTitle.textContent = key;
      infoDialogText.textContent = FOOTER_PLACEHOLDER_TEXT[key] || 'Inhalt folgt.';
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

  // ---- Init ----
  RJAudio.setMasterVolume(Number(masterVolumeInput.value) / 100);
  loadState().catch((err) => {
    console.error(err);
    showToast('Daten konnten nicht geladen werden.');
  });
})();
