"use strict";

// A single local copy of the latest playable file. No network requests.
window.LastAudio = (() => {
  let database, queue = Promise.resolve();
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('music-practice-player:audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Audio storage is blocked'));
    });
    return database;
  }
  function operation(mode, action) {
    const result = queue.catch(() => {}).then(async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', mode);
        const request = action(tx.objectStore('files'));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Audio storage failed'));
      });
    });
    queue = result;
    return result;
  }
  return {
    async read() {
      const record = await operation('readonly', store => store.get('last'));
      if (!record) return null;
      if (!(record.blob instanceof Blob) || typeof record.name !== 'string') throw new Error('Invalid saved audio');
      return new File([record.blob], record.name, { type: record.type || '', lastModified: record.lastModified });
    },
    save(file) { return operation('readwrite', store => store.put({ blob: file, name: file.name, type: file.type, lastModified: file.lastModified }, 'last')); },
    clear() { return operation('readwrite', store => store.delete('last')); }
  };
})();
