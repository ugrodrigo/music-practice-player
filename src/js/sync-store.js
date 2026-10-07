"use strict";

// Local outbox per account. Cloud access is optional and never blocks the player.
window.PracticeSync = (() => {
  const prefix = 'music-practice-player:sync:v1:';
  let owner = 'guest', records = {}, adapter = null, unsubscribe = null;
  try { owner = localStorage.getItem('music-practice-player:sync-owner') || 'guest'; } catch {}
  let epoch = 0, timer = 0, running = false, connected = false, error = '';
  const copy = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function emit(keys = []) {
    document.dispatchEvent(new CustomEvent('syncchange', { detail: { keys, owner } }));
  }
  function persist() {
    try { localStorage.setItem(prefix + owner, JSON.stringify(records)); return true; }
    catch { error = 'Local storage is full or unavailable. Keep this page open until changes sync.'; return false; }
  }
  function readOwner() {
    try { records = JSON.parse(localStorage.getItem(prefix + owner) || '{}'); }
    catch { records = {}; error = 'Could not read saved sync data on this device.'; }
  }
  readOwner();
  function schedule() { clearTimeout(timer); timer = setTimeout(flush, 800); }
  function put(key, value) {
    const old = records[key];
    if (old && same(old.value, value)) return;
    records[key] = { ...old, value: copy(value), revision: old?.revision || 0, pending: true };
    persist(); emit([key]); schedule();
  }
  function receive(items) {
    const changed = [];
    for (const [key, remote] of Object.entries(items)) {
      const local = records[key];
      if (!local?.pending) {
        if (!local || local.revision !== remote.revision) {
          records[key] = { value: remote.value, revision: remote.revision, pending: false };
          changed.push(key);
        }
      } else if (remote.revision !== local.revision) {
        if (same(local.value, remote.value)) {
          records[key] = { value: remote.value, revision: remote.revision, pending: false };
        } else local.conflict = remote;
        changed.push(key);
      }
    }
    persist(); emit(changed); schedule();
  }
  async function flush() {
    if (running || !adapter || !connected || !navigator.onLine) return;
    const generation = epoch, currentAdapter = adapter;
    running = true;
    try {
      for (const key of Object.keys(records)) {
        if (generation !== epoch) return;
        const record = records[key];
        if (!record.pending || record.conflict) continue;
        const sent = copy(record);
        const result = await currentAdapter.write(key, sent.value, sent.revision);
        if (generation !== epoch) return;
        const current = records[key];
        if (result.conflict) current.conflict = result.conflict;
        else {
          current.revision = Math.max(current.revision, result.revision);
          current.pending = !same(current.value, sent.value);
          // A snapshot of this successful write may have arrived before its promise.
          if (current.conflict?.revision === result.revision && same(current.conflict.value, sent.value)) delete current.conflict;
        }
        error = ''; persist(); emit([key]);
      }
    } catch (failure) {
      if (generation === epoch) { error = failure.message || 'Sync failed. Your changes are pending.'; emit(); }
    } finally {
      if (generation === epoch) {
        running = false;
        if (!error && Object.values(records).some(r => r.pending && !r.conflict)) schedule();
      }
    }
  }
  function setAccount(uid, remote = null) {
    epoch++; clearTimeout(timer); unsubscribe?.(); unsubscribe = null;
    owner = uid || 'guest'; adapter = remote; connected = false; running = false; error = '';
    readOwner();
    document.dispatchEvent(new Event('syncaccountchange')); emit(Object.keys(records));
    if (adapter) {
      const generation = epoch;
      unsubscribe = adapter.watch(items => {
        if (generation !== epoch) return;
        connected = true; error = ''; receive(items);
      }, failure => {
        if (generation !== epoch) return;
        connected = false; error = failure.message || 'Sync connection failed.'; emit();
      });
    }
  }
  function resolve(key, choice) {
    const record = records[key];
    if (!record?.conflict) return;
    const remote = record.conflict;
    record.revision = remote.revision;
    if (choice === 'cloud') { record.value = remote.value; record.pending = false; }
    else record.pending = true;
    delete record.conflict; persist(); emit([key]); schedule();
  }
  window.addEventListener('online', () => { error = ''; emit(); schedule(); });
  window.addEventListener('offline', () => emit());
  return {
    get owner() { return owner; },
    get: (key, fallback = null) => records[key] ? copy(records[key].value) : fallback,
    has: key => Object.hasOwn(records, key),
    keys: () => Object.keys(records),
    put, setAccount, resolve, flush,
    retry: () => { error = ''; emit(); schedule(); },
    state: () => ({ owner, connected, error, pending: Object.values(records).filter(r => r.pending).length,
      conflicts: Object.entries(records).filter(([, r]) => r.conflict).map(([key, r]) => ({ key, local: copy(r.value), cloud: copy(r.conflict.value) })) }),
    importGuest() {
      if (owner === 'guest') return;
      let guest;
      try { guest = JSON.parse(localStorage.getItem(prefix + 'guest') || '{}'); }
      catch { error = 'Could not read local data to import.'; emit(); return; }
      for (const [key, record] of Object.entries(guest)) {
        if (!records[key]) put(key, record.value);
        else if (!same(records[key].value, record.value)) {
          const remote = records[key].conflict || { value: records[key].value, revision: records[key].revision };
          records[key] = { value: record.value, revision: remote.revision, pending: true, conflict: remote };
        }
      }
      persist(); emit(Object.keys(guest)); schedule();
    },
  };
})();
