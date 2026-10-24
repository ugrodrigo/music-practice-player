"use strict";

// Only selected songs are copied here. The browser owns this storage; Drive/originals are backups.
window.SongLibraryStore = (() => {
  let opening;
  function db() {
    return opening ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('music-practice-player:songs', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('metadata', { keyPath: 'id' });
        request.result.createObjectStore('audio');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Song storage is blocked. Close other app tabs.'));
    }).catch(error => { opening = null; throw error; });
  }
  async function transaction(mode, stores, work) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      let result;
      try { result = work(tx); } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not access offline songs.'));
    });
  }
  async function list(owner) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction('metadata').objectStore('metadata').getAll();
      request.onsuccess = () => resolve(request.result.filter(item => item.owner === owner).sort((a, b) => a.name.localeCompare(b.name)));
      request.onerror = () => reject(request.error);
    });
  }
  async function get(id) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction('audio').objectStore('audio').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async function save(file, owner, sourceId, limitBytes) {
    if (!(file instanceof Blob) || !file.size) throw new Error('Choose a playable audio file.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const id = `${owner}:${hash}`;
    const existing = await list(owner);
    const old = existing.find(item => item.id === id);
    const used = existing.reduce((total, item) => total + item.size, 0);
    if (used - (old?.size || 0) + file.size > limitBytes) throw new Error('Offline limit reached. Remove a song or raise the limit first.');
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    if (estimate?.quota && estimate.quota - estimate.usage < file.size * 1.2 && !old)
      throw new Error('This device may not have enough browser storage. Free space before saving.');
    const metadata = { id, owner, hash, sourceId: sourceId || old?.sourceId || '', name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, savedAt: Date.now() };
    await transaction('readwrite', ['metadata', 'audio'], tx => {
      tx.objectStore('metadata').put(metadata);
      tx.objectStore('audio').put(file, id);
    });
    return metadata;
  }
  async function remove(id) {
    await transaction('readwrite', ['metadata', 'audio'], tx => {
      tx.objectStore('metadata').delete(id);
      tx.objectStore('audio').delete(id);
    });
  }
  return { list, get, save, remove };
})();
