"use strict";
window.LooperStore = (() => {
  let dbPromise, queue = Promise.resolve();
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('music-practice-player:looper', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Recording storage is blocked. Close other app windows.'));
    });
    return dbPromise;
  }
  function run(mode, action) {
    const result = queue.catch(() => {}).then(async () => {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('recordings', mode);
        const request = action(tx.objectStore('recordings'));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not access recording storage.'));
      });
    });
    queue = result;
    return result;
  }
  return {
    save: record => run('readwrite', store => store.put(record)),
    read: id => run('readonly', store => store.get(id)),
    remove: id => run('readwrite', store => store.delete(id)),
    list: () => run('readonly', store => {
      // Return only metadata: do not load every audio blob into memory.
      const request = store.openCursor(), records = [];
      const result = { result: records };
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const { blob, ...meta } = cursor.value;
        records.push({ ...meta, bytes: blob.size }); cursor.continue();
      };
      return result;
    })
  };
})();
