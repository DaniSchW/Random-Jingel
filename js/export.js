/* Local export/import for Random Jingle (Phase 5). Export bundles every
 * category/jingle plus their audio into a single ZIP (via js/zip.js) with
 * an index.csv describing them; import reads that ZIP back. Entirely
 * client-side — no server round trip either way.
 *
 * index.csv columns: id,name,category,color,order,trimStart,trimEnd,
 * fileName,mimeType. A row with an empty id/name is a "category-only" row
 * (just category+color) so an empty category still survives a round trip.
 * trimStart/trimEnd are pass-through only — nothing in the app sets them
 * yet, they're reserved for a future trim-points editor.
 */
const RJExport = (() => {
  const CSV_HEADER = ['id', 'name', 'category', 'color', 'order', 'trimStart', 'trimEnd', 'fileName', 'mimeType'];

  function csvField(value) {
    const str = value == null ? '' : String(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function buildCsv(categories, jingles) {
    const jinglesByCategory = new Map();
    for (const j of jingles) {
      if (!jinglesByCategory.has(j.categoryId)) jinglesByCategory.set(j.categoryId, []);
      jinglesByCategory.get(j.categoryId).push(j);
    }
    const lines = [CSV_HEADER.join(',')];
    for (const cat of categories) {
      const catJingles = jinglesByCategory.get(cat.id) || [];
      if (catJingles.length === 0) {
        lines.push(['', '', csvField(cat.name), csvField(cat.color), '', '', '', '', ''].join(','));
        continue;
      }
      for (const j of catJingles) {
        const effectiveColor = j.color || cat.color;
        lines.push([
          csvField(j.id), csvField(j.name), csvField(cat.name), csvField(effectiveColor), csvField(j.order ?? 0),
          csvField(j.trimStart ?? ''), csvField(j.trimEnd ?? ''), csvField(j.fileName || ''), csvField(j.mimeType || ''),
        ].join(','));
      }
    }
    return lines.join('\r\n') + '\r\n';
  }

  // Full RFC4180 parser (quoted fields, escaped quotes, embedded commas/newlines).
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // ignore — the following \n (if any) ends the row
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }

  function extFromFileName(fileName) {
    if (!fileName) return null;
    const dot = fileName.lastIndexOf('.');
    return dot === -1 ? null : fileName.slice(dot + 1).toLowerCase();
  }
  function extFromMime(mime) {
    const map = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'weba' };
    return map[mime] || null;
  }

  async function exportAll() {
    const categories = await RJDB.getAllCategories();
    const jingles = await RJDB.getAllJingles();

    const files = [];
    for (const j of jingles) {
      if (!j.blob) continue;
      const ext = extFromFileName(j.fileName) || extFromMime(j.mimeType) || 'audio';
      const buf = await j.blob.arrayBuffer();
      files.push({ name: `audio/${j.id}.${ext}`, data: new Uint8Array(buf) });
    }
    files.push({ name: 'index.csv', data: new TextEncoder().encode(buildCsv(categories, jingles)) });

    const blob = RJZip.create(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `random-jingle-export-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Parses a zip into plain data — no DB writes yet, so the caller can ask
  // "merge or overwrite?" before anything happens to local data.
  async function readImportFile(file) {
    const entries = RJZip.read(await file.arrayBuffer());
    const csvBytes = entries.get('index.csv');
    if (!csvBytes) throw new Error('index.csv fehlt in der ZIP-Datei.');
    const rows = parseCsv(new TextDecoder().decode(csvBytes));
    if (rows.length === 0) throw new Error('index.csv ist leer.');

    const header = rows[0].map((h) => h.trim());
    const col = (name) => header.indexOf(name);
    const iId = col('id'), iName = col('name'), iCategory = col('category'), iColor = col('color'),
      iOrder = col('order'), iTrimStart = col('trimStart'), iTrimEnd = col('trimEnd'),
      iFileName = col('fileName'), iMimeType = col('mimeType');
    if (iCategory === -1 || iColor === -1) throw new Error('index.csv hat ein unerwartetes Format.');

    const categories = [];
    const categoryColorByName = new Map();
    const jingles = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const categoryName = (row[iCategory] || '').trim();
      if (!categoryName) continue;
      if (!categoryColorByName.has(categoryName)) {
        const color = (row[iColor] || '#7c3aed').trim();
        categoryColorByName.set(categoryName, color);
        categories.push({ name: categoryName, color, order: categories.length });
      }

      const id = iId !== -1 ? (row[iId] || '').trim() : '';
      const name = iName !== -1 ? (row[iName] || '').trim() : '';
      if (!id || !name) continue; // category-only row, already handled above

      const fileName = iFileName !== -1 ? (row[iFileName] || '').trim() : '';
      const mimeType = iMimeType !== -1 ? (row[iMimeType] || '').trim() : '';
      const ext = extFromFileName(fileName) || extFromMime(mimeType) || 'audio';
      const audioBytes = entries.get(`audio/${id}.${ext}`);

      // The CSV only carries one "effective" color per jingle (its own
      // override if it has one, else its category's color — see
      // buildCsv()). A row whose color matches its category's established
      // color is treated as "inherits from the category" (color: null);
      // only a genuinely different color round-trips as an explicit
      // per-jingle override.
      const rowColor = (row[iColor] || '').trim() || null;
      const categoryColor = categoryColorByName.get(categoryName);
      const color = rowColor && rowColor.toLowerCase() !== (categoryColor || '').toLowerCase() ? rowColor : null;

      jingles.push({
        id, name, categoryName, color,
        order: iOrder !== -1 && row[iOrder] !== '' ? Number(row[iOrder]) : 0,
        trimStart: iTrimStart !== -1 && row[iTrimStart] !== '' ? Number(row[iTrimStart]) : null,
        trimEnd: iTrimEnd !== -1 && row[iTrimEnd] !== '' ? Number(row[iTrimEnd]) : null,
        fileName: fileName || null,
        mimeType: mimeType || null,
        blob: audioBytes ? new Blob([audioBytes], { type: mimeType || 'application/octet-stream' }) : null,
      });
    }
    return { categories, jingles };
  }

  // mode: 'merge' (default-safe: reuse existing categories by name, upsert
  // jingles by id so re-importing the same export never duplicates) or
  // 'overwrite' (wipe local data first, then import fresh).
  async function applyImport(parsed, mode) {
    if (mode === 'overwrite') await RJDB.wipeAll();

    const nameToId = new Map();
    for (const cat of await RJDB.getAllCategories()) nameToId.set(cat.name.trim().toLowerCase(), cat.id);

    let categoriesImported = 0;
    for (const cat of parsed.categories) {
      const key = cat.name.trim().toLowerCase();
      if (nameToId.has(key)) continue;
      const id = crypto.randomUUID();
      await RJDB.putCategoryForImport({ id, name: cat.name, color: cat.color, order: cat.order });
      nameToId.set(key, id);
      categoriesImported++;
    }

    let jinglesImported = 0;
    for (const jingle of parsed.jingles) {
      const categoryId = nameToId.get(jingle.categoryName.trim().toLowerCase());
      if (!categoryId) continue;
      await RJDB.putJingleForImport({
        id: jingle.id, name: jingle.name, categoryId, color: jingle.color, order: jingle.order,
        trimStart: jingle.trimStart, trimEnd: jingle.trimEnd,
        fileName: jingle.fileName, mimeType: jingle.mimeType, blob: jingle.blob,
      });
      jinglesImported++;
    }
    return { categoriesImported, jinglesImported };
  }

  return { exportAll, readImportFile, applyImport };
})();
