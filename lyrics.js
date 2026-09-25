"use strict";

window.LyricsPanel = (() => {
  const $ = (id) => document.getElementById(`lyrics-${id}`);
  const cacheKey = 'music-practice-player:lyrics:v1';
  const autoKey = 'music-practice-player:lyrics:auto';
  const client = 'Music Practice Player/1.1 (https://github.com/ugrodrigo/music-practice-player)';
  let fileKey = '', duration = 0, album = '', revision = 0, controller;
  let queue = Promise.resolve(), nextRequest = 0, blockedUntil = 0;

  const status = (message) => { $('status').textContent = message; };
  const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const clean = (text) => text.replace(/\0.*$/s, '').trim().slice(0, 200);
  const syncSafe = (bytes, offset) => ((bytes[offset] & 127) * 2097152 + (bytes[offset + 1] & 127) * 16384 + (bytes[offset + 2] & 127) * 128 + (bytes[offset + 3] & 127));
  const ascii = (bytes) => new TextDecoder('windows-1252').decode(bytes);

  function decodeText(bytes) {
    const encoding = bytes[0];
    let content = bytes.subarray(1);
    let charset = ['windows-1252', 'utf-16le', 'utf-16be', 'utf-8'][encoding];
    if (!charset) return '';
    if (encoding === 1 && content[0] === 0xfe && content[1] === 0xff) charset = 'utf-16be';
    if (encoding === 1 && ((content[0] === 0xff && content[1] === 0xfe) || (content[0] === 0xfe && content[1] === 0xff))) content = content.subarray(2);
    return clean(new TextDecoder(charset).decode(content));
  }

  async function readSongInfo(file) {
    const stem = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}(?:[.)]\s*|\s+-\s+)/, '');
    const parts = stem.split(/\s+[-–—]\s+/);
    const info = { artist: parts.length > 1 ? parts.shift() : '', title: parts.join(' - '), album: '' };
    try {
      // Read bounded metadata only; audio bytes are never sent to the lyrics service.
      const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
      const view = new DataView(bytes.buffer);
      const tags = {};
      if (ascii(bytes.subarray(0, 3)) === 'ID3' && [2, 3, 4].includes(bytes[3]) && !(bytes[5] & 0x80)) {
        const version = bytes[3], end = Math.min(bytes.length, 10 + syncSafe(bytes, 6));
        let offset = 10;
        if (version >= 3 && bytes[5] & 0x40) offset += version === 3 ? 4 + view.getUint32(offset) : syncSafe(bytes, offset);
        const header = version === 2 ? 6 : 10;
        while (offset + header <= end) {
          const id = ascii(bytes.subarray(offset, offset + (version === 2 ? 3 : 4)));
          const length = version === 2 ? bytes[offset + 3] * 65536 + bytes[offset + 4] * 256 + bytes[offset + 5] : version === 4 ? syncSafe(bytes, offset + 4) : view.getUint32(offset + 4);
          if (!/^[A-Z0-9]{3,4}$/.test(id) || length <= 0 || offset + header + length > end) break;
          const field = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album' }[id];
          // Skip compressed/encrypted/grouped or unsynchronized frames.
          if (field && (version === 2 || bytes[offset + 9] === 0)) tags[field] = decodeText(bytes.subarray(offset + header, offset + header + length));
          offset += header + length;
        }
      }
      if (file.size >= 128) {
        const tail = new Uint8Array(await file.slice(-128).arrayBuffer());
        if (ascii(tail.subarray(0, 3)) === 'TAG') {
          for (const [field, offset] of [['title', 3], ['artist', 33], ['album', 63]]) if (!tags[field]) tags[field] = clean(ascii(tail.subarray(offset, offset + 30)));
        }
      }
      for (const field of ['title', 'artist', 'album']) if (tags[field]) info[field] = tags[field];
    } catch { /* Unsupported or malformed tags fall back to editable filename guesses. */ }
    return info;
  }

  function cancel() {
    revision++;
    controller?.abort();
    $('search').textContent = 'Find lyrics';
    $('text').removeAttribute('aria-busy');
  }

  function clearLyrics() {
    $('results').replaceChildren();
    $('results').hidden = true;
    $('match').hidden = true;
    $('text').replaceChildren();
    $('text').hidden = true;
  }

  function reset() {
    cancel();
    fileKey = ''; album = ''; duration = 0;
    $('artist').value = ''; $('title').value = '';
    for (const id of ['artist', 'title', 'search']) $(id).disabled = true;
    clearLyrics();
    status('Load a song to find its lyrics.');
  }

  function recordFrom(value) {
    if (!value || typeof value.trackName !== 'string' || typeof value.artistName !== 'string' || !Number.isFinite(value.id)) return null;
    return { id: value.id, trackName: value.trackName.slice(0, 200), artistName: value.artistName.slice(0, 200), albumName: typeof value.albumName === 'string' ? value.albumName.slice(0, 200) : '', duration: Number.isFinite(value.duration) ? value.duration : 0, instrumental: value.instrumental === true, plainLyrics: typeof value.plainLyrics === 'string' ? value.plainLyrics.slice(0, 100000) : '', syncedLyrics: typeof value.syncedLyrics === 'string' ? value.syncedLyrics.slice(0, 100000) : '' };
  }

  function readCache() {
    try {
      const entries = JSON.parse(localStorage.getItem(cacheKey));
      return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry.key === 'string' && recordFrom(entry.record)).slice(0, 10) : [];
    } catch { return []; }
  }

  function showRecord(record, cached = false) {
    $('results').hidden = true;
    $('artist').value = record.artistName;
    $('title').value = record.trackName;
    album = record.albumName;
    $('match').textContent = `${record.artistName} — ${record.trackName}${record.albumName ? ` · ${record.albumName}` : ''}`;
    $('match').hidden = false;
    // Plain text only: API responses must never become HTML.
    const text = record.plainLyrics || record.syncedLyrics.split('\n').filter((line) => /\[\d+:\d+/.test(line)).map((line) => line.replace(/\[[^\]]*\]/g, '').trim()).join('\n');
    $('text').textContent = record.instrumental ? 'Instrumental — no sung lyrics.' : text || 'This record has no lyrics yet. Try another match.';
    $('text').hidden = false;
    $('text').scrollTop = 0;
    status(cached ? 'Saved lyrics · available offline. Edit the details to find another version.' : 'Lyrics from LRCLIB. Edit the details if this is the wrong version.');
    if (!cached) {
      try {
        const entries = readCache().filter((entry) => entry.key !== fileKey);
        entries.unshift({ key: fileKey, record });
        localStorage.setItem(cacheKey, JSON.stringify(entries.slice(0, 10)));
      } catch { status('Lyrics loaded, but browser storage could not save them for offline use.'); }
    }
  }

  function request(path, params, signal) {
    const run = async () => {
      if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
      if (Date.now() < blockedUntil) throw new Error(`LRCLIB is busy. Please wait ${Math.ceil((blockedUntil - Date.now()) / 1000)} seconds before searching again.`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
      if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
      const timeout = new AbortController();
      const abort = () => timeout.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 12000);
      try {
        const response = await fetch(`https://lrclib.net/api/${path}?${params}`, { signal: timeout.signal, credentials: 'omit', headers: { 'Lrclib-Client': client } });
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 60;
          blockedUntil = Math.max(Date.now() + 1000, retry && !/^\d+$/.test(retry) ? Date.parse(retry) || Date.now() + 60000 : Date.now() + seconds * 1000);
          throw new Error(`LRCLIB is busy. Please wait ${Math.ceil((blockedUntil - Date.now()) / 1000)} seconds before searching again.`);
        }
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('LRCLIB is unavailable right now. Try again later; playback still works.');
        return await response.json();
      } catch (error) {
        if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
        if (error.name === 'AbortError') throw new Error('Lyrics lookup timed out. Try again when your connection is ready.');
        if (error instanceof TypeError) throw new Error('Could not reach LRCLIB. Check your connection or content blocker. Local playback still works.');
        throw error;
      } finally {
        nextRequest = Date.now() + 300;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    };
    const pending = queue.then(run);
    queue = pending.catch(() => {});
    return pending;
  }

  async function findLyrics() {
    if (!fileKey || !$('title').value.trim()) return;
    cancel();
    const version = revision;
    controller = new AbortController();
    const signal = controller.signal;
    const title = $('title').value.trim(), artist = $('artist').value.trim();
    clearLyrics();
    status('Looking for lyrics…');
    $('search').textContent = 'Search again';
    const params = new URLSearchParams({ track_name: title });
    if (artist) params.set('artist_name', artist);
    try {
      if (artist) {
        const exact = new URLSearchParams(params);
        if (album) exact.set('album_name', album);
        if (duration >= 1 && duration <= 3600) exact.set('duration', String(Math.round(duration)));
        const record = recordFrom(await request('get', exact, signal));
        if (version !== revision) return;
        if (record && normalize(record.trackName) === normalize(title) && normalize(record.artistName) === normalize(artist) && Math.abs(record.duration - duration) <= 2) {
          showRecord(record); return;
        }
      }
      const response = await request('search', params, signal);
      if (version !== revision) return;
      const records = Array.isArray(response) ? response.map(recordFrom).filter(Boolean).slice(0, 20).sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration)) : [];
      const matches = records.filter((record) => artist && normalize(record.trackName) === normalize(title) && normalize(record.artistName) === normalize(artist) && Math.abs(record.duration - duration) <= 2);
      if (matches.length === 1) { showRecord(matches[0]); return; }
      if (!records.length) { status('No lyrics found. Check the artist and title, then try again.'); return; }
      status('Choose the recording that matches your song. Closest durations appear first.');
      $('results').hidden = false;
      for (const record of records) {
        const button = document.createElement('button');
        button.type = 'button';
        const seconds = Math.round(record.duration);
        button.textContent = `${record.artistName} — ${record.trackName}\n${record.albumName || 'Unknown album'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}${record.instrumental ? ' · Instrumental' : ''}`;
        button.addEventListener('click', () => { if (version === revision) showRecord(record); });
        $('results').append(button);
      }
    } catch (error) {
      if (version === revision && error.name !== 'AbortError') status(error.message || 'Lyrics lookup failed. Try again later.');
    } finally {
      if (version === revision) $('search').textContent = 'Find lyrics';
    }
  }

  async function load(file, seconds) {
    reset();
    fileKey = JSON.stringify([file.name, file.size, file.lastModified]);
    duration = seconds;
    const version = revision;
    for (const id of ['artist', 'title', 'search']) $(id).disabled = false;
    const saved = readCache().find((entry) => entry.key === fileKey);
    if (saved) { showRecord(recordFrom(saved.record), true); return; }
    status('Reading song details…');
    const info = await readSongInfo(file);
    if (version !== revision) return;
    $('artist').value = info.artist;
    $('title').value = info.title;
    album = info.album;
    if ($('auto').checked && info.artist && info.title) findLyrics();
    else status($('auto').checked ? 'Check the song title and add an artist for a more accurate match, then choose Find lyrics.' : 'Automatic lookup is off. Choose Find lyrics when you want to search online.');
  }

  try { $('auto').checked = localStorage.getItem(autoKey) !== 'false'; } catch { /* Use the default. */ }
  $('auto').addEventListener('change', () => {
    try { localStorage.setItem(autoKey, String($('auto').checked)); } catch { /* Session setting still works. */ }
    if (!$('auto').checked) { cancel(); status('Automatic lookup is off. You can still search manually.'); }
    else if (fileKey && $('artist').value.trim() && $('title').value.trim()) findLyrics();
  });
  $('form').addEventListener('submit', (event) => { event.preventDefault(); $('artist').blur(); $('title').blur(); findLyrics(); });
  for (const id of ['artist', 'title']) $(id).addEventListener('input', () => { cancel(); album = ''; $('results').hidden = true; status('Choose Find lyrics to search with these details.'); });
  return { reset, load };
})();
