"use strict";

(() => {
  const $ = id => document.getElementById(`recording-${id}`);
  const supported = window.isSecureContext && typeof window.showDirectoryPicker === 'function';
  let folder = null, pending = null, busy = true;
  const database = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open('music-practice-player:recording-folder', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage is blocked. Close other app windows and retry.'));
    } catch (error) { reject(error); }
  });
  async function storage(mode, action) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', mode);
      const request = action(tx.objectStore('settings'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Local storage is unavailable.'));
    });
  }
  const put = (key, value) => storage('readwrite', store => store.put(value, key));
  const remove = key => storage('readwrite', store => store.delete(key));
  function render() {
    $('name').textContent = folder ? folder.name : 'No folder selected';
    $('choose').disabled = busy || !supported;
    $('test').disabled = busy || !folder || !!pending;
    $('retry').hidden = !pending;
    $('retry').disabled = busy || !folder;
    $('download').hidden = !pending;
    $('download').disabled = busy;
    $('disconnect').disabled = busy || !folder;
  }
  function message(text) { $('status').textContent = text; }
  async function run(action) {
    if (busy) return;
    busy = true; render();
    try { await action(); }
    catch (error) {
      if (error.name === 'AbortError') message('Folder selection cancelled.');
      else message(`${error.message || 'Could not save to this folder.'}${pending ? ' The test file is kept locally. Retry or download it.' : ''}`);
    } finally { busy = false; render(); }
  }
  async function permission() {
    if (!folder) throw new Error('Choose a folder first.');
    const options = { mode: 'readwrite' };
    let state = await folder.queryPermission(options);
    if (state !== 'granted') state = await folder.requestPermission(options);
    if (state !== 'granted') throw new Error('Folder access was not granted.');
  }
  function testFile() {
    const now = new Date();
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
    const suffix = crypto.randomUUID().slice(0, 8);
    // One second of silent mono PCM, 16-bit at 8 kHz. This is not microphone audio.
    const bytes = new ArrayBuffer(44 + 16000), view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');view.setUint32(4, bytes.byteLength - 8, true);text(8, 'WAVE');text(12, 'fmt ');
    view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);view.setUint32(28, 16000, true);view.setUint16(32, 2, true);view.setUint16(34, 16, true);
    text(36, 'data');view.setUint32(40, 16000, true);
    return { name: `recording-test_${stamp}_${suffix}.wav`, blob: new Blob([bytes], { type: 'audio/wav' }) };
  }
  async function writePending() {
    const item = pending;
    let handle;
    try {
      handle = await folder.getFileHandle(item.name);
      // A previous save may have completed before the app closed. Never overwrite a different file.
      const existing = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const expected = new Uint8Array(await item.blob.arrayBuffer());
      if (existing.length !== expected.length || existing.some((byte, i) => byte !== expected[i])) throw new Error('A different file already has this name. Choose another folder or download the pending file.');
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      handle = await folder.getFileHandle(item.name, { create: true });
      let stream;
      try { stream = await handle.createWritable(); await stream.write(item.blob); await stream.close(); }
      catch (error) {
        try { await stream?.abort(); } catch {}
        // Only remove the new test file this attempt created, never an existing file.
        try { await folder.removeEntry(item.name); } catch {}
        throw error;
      }
    }
    await remove('pending');
    pending = null;
    message(`Saved to ${folder.name}: ${item.name}`);
  }
  $('choose').addEventListener('click', () => run(async () => {
    const selected = await window.showDirectoryPicker({ id: 'practice-recordings', mode: 'readwrite' });
    await put('folder', selected);
    folder = selected;
    message('Folder selected. Save a test file, then reopen the app to check access.');
  }));
  $('test').addEventListener('click', () => run(async () => {
    await permission();
    pending = testFile();
    await put('pending', pending);
    await writePending();
  }));
  $('retry').addEventListener('click', () => run(async () => {
    await permission();
    await put('pending', pending);
    await writePending();
  }));
  $('disconnect').addEventListener('click', () => run(async () => {
    await remove('folder'); folder = null;
    message('Folder disconnected. Existing files were not deleted.');
  }));
  $('download').addEventListener('click', () => {
    if (!pending) return;
    const url = URL.createObjectURL(pending.blob), link = document.createElement('a');
    link.href = url; link.download = pending.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('Download requested. The pending copy is kept until a folder save succeeds.');
  });
  render();
  (async () => {
    try {
      folder = await storage('readonly', store => store.get('folder')) || null;
      pending = await storage('readonly', store => store.get('pending')) || null;
      if (!supported) message('Folder saving is unavailable in this browser. Try opening this HTTPS app in Chrome.');
      else if (pending) message('A test file is waiting to be saved. Retry or download it.');
      else if (folder) {
        const state = await folder.queryPermission({ mode: 'readwrite' });
        message(state === 'granted' ? 'Folder restored and ready for a test save.' : 'Folder remembered. Save a test file to authorize access again.');
      } else message('Choose a folder to test saving directly on this device.');
    } catch { message('Could not restore folder settings. Choose a folder to try again.'); }
    finally { busy = false; render(); }
  })();
})();
