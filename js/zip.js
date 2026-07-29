/* Minimal dependency-free ZIP reader/writer for Random Jingle's local
 * export/import (Phase 5). This only ever needs to round-trip zips the app
 * itself created, so it deliberately implements just the STORE method
 * (method 0, no compression) — audio files are already compressed formats
 * and gain little from DEFLATE anyway. read() rejects any entry using a
 * different compression method with a clear error instead of producing
 * garbage.
 */
const RJZip = (() => {
  const LOCAL_SIG = 0x04034b50;
  const CENTRAL_SIG = 0x02014b50;
  const END_SIG = 0x06054b50;

  let crcTable = null;
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function toDosTime(d) {
    return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  }
  function toDosDate(d) {
    return (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  }

  // files: [{ name: string, data: Uint8Array }]
  function create(files) {
    const now = new Date();
    const dosTime = toDosTime(now);
    const dosDate = toDosDate(now);
    const nameBytesList = files.map((f) => new TextEncoder().encode(f.name));
    const crcs = files.map((f) => crc32(f.data));

    const localChunks = [];
    const centralChunks = [];
    const offsets = [];
    let offset = 0;

    for (let i = 0; i < files.length; i++) {
      const nameBytes = nameBytesList[i];
      const data = files[i].data;
      const crc = crcs[i];
      offsets.push(offset);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, LOCAL_SIG, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      localChunks.push(new Uint8Array(local.buffer), nameBytes, data);
      offset += 30 + nameBytes.length + data.length;
    }

    let centralSize = 0;
    for (let i = 0; i < files.length; i++) {
      const nameBytes = nameBytesList[i];
      const data = files[i].data;
      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, CENTRAL_SIG, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, dosTime, true);
      central.setUint16(14, dosDate, true);
      central.setUint32(16, crcs[i], true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint16(30, 0, true);
      central.setUint16(32, 0, true);
      central.setUint16(34, 0, true);
      central.setUint16(36, 0, true);
      central.setUint32(38, 0, true);
      central.setUint32(42, offsets[i], true);
      centralChunks.push(new Uint8Array(central.buffer), nameBytes);
      centralSize += 46 + nameBytes.length;
    }

    const centralStart = offset;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, END_SIG, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    end.setUint16(20, 0, true);

    return new Blob([...localChunks, ...centralChunks, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // Returns Map<name, Uint8Array>.
  function read(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    let eocdOffset = -1;
    const scanStart = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= scanStart; i--) {
      if (view.getUint32(i, true) === END_SIG) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) throw new Error('Keine gültige ZIP-Datei (End-of-Central-Directory nicht gefunden).');

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let centralOffset = view.getUint32(eocdOffset + 16, true);

    const result = new Map();
    for (let i = 0; i < totalEntries; i++) {
      if (view.getUint32(centralOffset, true) !== CENTRAL_SIG) {
        throw new Error('ZIP-Zentralverzeichnis ist beschädigt.');
      }
      const method = view.getUint16(centralOffset + 10, true);
      const compSize = view.getUint32(centralOffset + 20, true);
      const nameLen = view.getUint16(centralOffset + 28, true);
      const extraLen = view.getUint16(centralOffset + 30, true);
      const commentLen = view.getUint16(centralOffset + 32, true);
      const localOffset = view.getUint32(centralOffset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLen));

      if (method !== 0) {
        throw new Error(`Datei "${name}" ist komprimiert (Methode ${method}) — nur unkomprimierte ZIPs aus diesem Export werden unterstützt.`);
      }

      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      result.set(name, bytes.subarray(dataStart, dataStart + compSize));

      centralOffset += 46 + nameLen + extraLen + commentLen;
    }
    return result;
  }

  return { create, read };
})();
