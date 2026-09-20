const STORE = 'images';

export function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true });
    const fail = () => reject(tx.error || new Error('local collection could not be saved'));
    tx.addEventListener('abort', fail, { once: true });
    tx.addEventListener('error', fail, { once: true });
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(
      request.error || new Error('local collection could not be read'),
    ), { once: true });
  });
}

export function openCuratorDB(factory = globalThis.indexedDB) {
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = factory.open('lumiere', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readLocalWorks(db) {
  const tx = db.transaction(STORE, 'readonly');
  const result = requestResult(tx.objectStore(STORE).getAll());
  const done = waitForTransaction(tx);
  const [records] = await Promise.all([result, done]);
  return records || [];
}

export async function putLocalWork(db, record) {
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(STORE).put(record);
  await done;
}

export async function deleteLocalWork(db, id) {
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(STORE).delete(id);
  await done;
}
