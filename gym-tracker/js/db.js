// Persistencia local en IndexedDB. Dos almacenes:
//  - kv:        rutina y ajustes (clave -> valor)
//  - sessions:  una entrada por sesión de entrenamiento

const DB_NAME = 'gym-tracker';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      db.createObjectStore('sessions', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        let result;
        const req = fn(tx.objectStore(store));
        if (req) req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));
export const sessionsAll = () => run('sessions', 'readonly', (s) => s.getAll());
export const sessionPut = (session) => run('sessions', 'readwrite', (s) => s.put(session));
export const sessionDelete = (id) => run('sessions', 'readwrite', (s) => s.delete(id));

/** Reemplaza todo el contenido (para importar un respaldo) en una sola transacción. */
export function replaceAll({ routine, settings, sessions }) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(['kv', 'sessions'], 'readwrite');
        const kv = tx.objectStore('kv');
        const ss = tx.objectStore('sessions');
        ss.clear();
        sessions.forEach((s) => ss.put(s));
        kv.put(routine, 'routine');
        kv.put(settings, 'settings');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

/** Pide al navegador que no borre los datos por falta de espacio. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) {
    /* no pasa nada: seguimos igual */
  }
  return false;
}
