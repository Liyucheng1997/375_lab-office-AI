// 文件存储：基于 IndexedDB，所有文档保存在浏览器本地。
// 文件记录结构：{ id, type: 'doc'|'sheet'|'slide', name, content, createdAt, updatedAt, trashed, starred, size }

const DB_NAME = 'office-suite';
const STORE = 'files';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const os = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(os)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
      })
  );
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set();
export function onFilesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { console.error(e); }
  });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sizeOf(content) {
  try { return JSON.stringify(content).length; } catch { return 0; }
}

/** 列出文件（默认不含回收站） */
export async function listFiles({ includeTrashed = false, onlyTrashed = false } = {}) {
  const all = await tx('readonly', (os) => reqP(os.getAll()));
  return all
    .filter((f) => (onlyTrashed ? f.trashed : includeTrashed || !f.trashed))
    .map(({ content, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFile(id) {
  return tx('readonly', (os) => reqP(os.get(id)));
}

export async function createFile(type, name, content) {
  const now = Date.now();
  const file = { id: uid(), type, name, content, createdAt: now, updatedAt: now, trashed: false, starred: false, size: sizeOf(content) };
  await tx('readwrite', (os) => reqP(os.put(file)));
  emit();
  return file;
}

/** 部分更新：patch 可包含 name / content / starred / trashed 等 */
export async function updateFile(id, patch) {
  const file = await getFile(id);
  if (!file) throw new Error('文件不存在');
  Object.assign(file, patch);
  if ('content' in patch) file.size = sizeOf(patch.content);
  if ('content' in patch || 'name' in patch) file.updatedAt = Date.now();
  await tx('readwrite', (os) => reqP(os.put(file)));
  emit();
  return file;
}

export async function duplicateFile(id, newName) {
  const file = await getFile(id);
  return createFile(file.type, newName || file.name + ' - 副本', structuredClone(file.content));
}

export async function trashFile(id) { return updateFile(id, { trashed: true }); }
export async function restoreFile(id) { return updateFile(id, { trashed: false }); }

export async function deleteFileForever(id) {
  await tx('readwrite', (os) => reqP(os.delete(id)));
  emit();
}

export async function emptyTrash() {
  const trashed = await listFiles({ onlyTrashed: true });
  await tx('readwrite', (os) => Promise.all(trashed.map((f) => reqP(os.delete(f.id)))));
  emit();
}
