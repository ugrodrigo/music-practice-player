"use strict";

window.LyricsPanel = (() => {
  const $ = (id) => document.getElementById(`lyrics-${id}`);
  const cacheKey = 'music-practice-player:lyrics:v1';
  const autoKey = 'music-practice-player:lyrics:auto';
  const client = 'Music Practice Player/1.1 (https://github.com/ugrodrigo/music-practice-player)';
  let fileKey = '', duration = 0, album = '', revision = 0, controller;
  let queue = Promise.resolve(), nextRequest = 0, blockedUntil = 0;
  let timedLines = [], lineNodes = [], activeLine = -1;
  let scrubbing = false, scrubTimer = 0;
  let playbackTime = 0, playbackDuration = 0, hasLyrics = false;

  function parseTimedLyrics(text) {
    const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(text)?.[1] || 0) / 1000;
    const entries = [];
    for (const line of text.split(/\r?\n/)) {
      const stamps = [...line.matchAll(/\[(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g)];
      if (!stamps.length) continue;
      const content = line.slice(stamps.at(-1).index + stamps.at(-1)[0].length).trim();
      for (const stamp of stamps) {
        const time = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`) - offset;
        if (Number.isFinite(time)) entries.push({ time: Math.max(0, time), text: content });
      }
    }
    entries.sort((a, b) => a.time - b.time);
    // Multiple voices can share a timestamp. Keep those lines together.
    const groups = [];
    for (const entry of entries) {
      const previous = groups.at(-1);
      if (previous?.time === entry.time) previous.text += `\n${entry.text}`;
      else groups.push({ ...entry });
    }
    return groups.some((entry) => entry.text) ? groups : [];
  }

  function showTab(find) {
    document.querySelector('.lyrics').dataset.view = find ? 'find' : 'lyrics';
    $('settings').open = find;
    $('view').setAttribute('aria-pressed', String(!find));
    $('find').setAttribute('aria-pressed', String(find));
    requestAnimationFrame(() => update(playbackTime, playbackDuration, true));
  }
  $('view').addEventListener('click', () => showTab(false));
  $('find').addEventListener('click', () => showTab(true));

  function renderFollowMode() {
    $('mode').textContent = !hasLyrics ? 'Waiting for lyrics' : timedLines.length ? 'Scroll to seek. Tap or hold a line to save a cue.' : 'Approximate scrolling - song %';
  }

  function update(time, total, force = false) {
    playbackTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    playbackDuration = Number.isFinite(total) ? Math.max(0, total) : 0;
    if (!hasLyrics || $('text').hidden) return;
    let changed = false;
    if (timedLines.length) {
      let low = 0, high = timedLines.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (timedLines[mid].time <= playbackTime) low = mid + 1;
        else high = mid;
      }
      const index = low - 1;
      changed = index !== activeLine;
      if (changed) {
        lineNodes[activeLine]?.classList.remove('current');
        lineNodes[activeLine]?.removeAttribute('aria-current');
        activeLine = index;
        lineNodes[index]?.classList.add('current');
        lineNodes[index]?.setAttribute('aria-current', 'true');
      }
    }
    if (scrubbing || document.getElementById('cue-bubble').matches(':popover-open')) return;
    const panel = $('text');
    if (timedLines.length) {
      if (!changed && !force) return;
      const line = lineNodes[activeLine];
      panel.scrollTop = line ? Math.max(0, line.offsetTop - (panel.clientHeight - line.offsetHeight) / 2) : 0;
    } else if (playbackDuration > 0) {
      panel.scrollTop = Math.min(1, playbackTime / playbackDuration) * Math.max(0, panel.scrollHeight - panel.clientHeight);
    }
  }

  const status = (message) => { $('status').textContent = message; };
  const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const clean = (text) => text.replace(/\0.*$/s, '').trim().slice(0, 200);
  const syncSafe = (bytes, offset) => ((bytes[offset] & 127) * 2097152 + (bytes[offset + 1] & 127) * 16384 + (bytes[offset + 2] & 127) * 128 + (bytes[offset + 3] & 127));
  const ascii = (bytes) => new TextDecoder('windows-1252').decode(bytes);

  function updateGeniusLink() {
    const artist = $('artist').value.trim(), title = $('title').value.trim();
    const link = $('genius');
    link.hidden = !artist || !title;
    if (link.hidden) { link.removeAttribute('href'); return; }
    link.href = `https://genius.com/search?${new URLSearchParams({ q: `${artist} ${title}` })}`;
    link.title = `Find ${title} by ${artist} on Genius for lyrics, annotations, and song background`;
  }

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
    clearTimeout(scrubTimer); scrubbing = false;
    timedLines = []; lineNodes = []; activeLine = -1; hasLyrics = false;
    $('text').classList.remove('synced');
    renderFollowMode();
    $('results').replaceChildren();
    $('results').hidden = true;
    $('match').hidden = true;
    $('text').dispatchEvent(new Event('lyricschanged'));
    $('text').replaceChildren();
    $('text').hidden = true;
  }

  function reset() {
    $('text').dispatchEvent(new Event('lyricschanged'));
    cancel();
    fileKey = ''; album = ''; duration = 0;
    playbackTime = 0; playbackDuration = 0;

    showTab(true);
    $('artist').value = ''; $('title').value = '';
    updateGeniusLink();
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
    updateGeniusLink();
    album = record.albumName;
    $('match').textContent = `${record.artistName} — ${record.trackName}${record.albumName ? ` · ${record.albumName}` : ''}`;
    $('match').hidden = false;
    timedLines = record.instrumental ? [] : parseTimedLyrics(record.syncedLyrics);
    lineNodes = []; activeLine = -1;
    hasLyrics = !record.instrumental && !!(timedLines.length || record.plainLyrics.trim());
    // Build text nodes only; lyrics returned by the service are never HTML.
    $('text').dispatchEvent(new Event('lyricschanged'));
    $('text').replaceChildren();
    $('text').classList.toggle('synced', !!timedLines.length);
    if (timedLines.length) {
      for (const line of timedLines) {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'lyric-line';
        node.textContent = line.text || '♪';
        const stamp = `${Math.floor(line.time / 60)}:${(line.time % 60).toFixed(1).padStart(4, '0')}`;
        node.title = `Jump to ${stamp}`;
        node.setAttribute('aria-label', `Jump to ${stamp}: ${line.text || 'Instrumental break'}`);
        node.setAttribute('aria-pressed', 'false');
        const selectLine = () => {
          scrubbing = false; clearTimeout(scrubTimer);
          lineNodes.forEach(line => { line.classList.remove('selected'); line.setAttribute('aria-pressed', 'false'); });
          node.classList.add('selected');
          node.setAttribute('aria-pressed', 'true');

          renderFollowMode();
          $('text').dispatchEvent(new CustomEvent('lyricsseek', { detail: line.time }));
          $('text').dispatchEvent(new CustomEvent('lyriccue', { detail: node }));
        };
        let holdTimer = 0, held = false, start = null;
        const cancelHold = () => { clearTimeout(holdTimer); start = null; };
        node.addEventListener('pointerdown', event => {
          cancelHold(); held = false;
          if (!event.isPrimary || event.button !== 0) return;
          start = { x: event.clientX, y: event.clientY };
          holdTimer = setTimeout(() => { held = true; selectLine(); }, 550);
        });
        node.addEventListener('pointermove', event => {
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelHold();
        });
        for (const event of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(event, cancelHold);
        node.addEventListener('contextmenu', event => event.preventDefault());
        node.addEventListener('click', () => { if (held) held = false; else selectLine(); });
        lineNodes.push(node);
        $('text').append(node);
      }
    } else $('text').textContent = record.instrumental ? 'Instrumental — no sung lyrics.' : record.plainLyrics || 'This record has no lyrics yet. Try another match.';
    $('text').hidden = false;
    showTab(!hasLyrics);
    $('text').scrollTop = 0;
    renderFollowMode();
    update(playbackTime, playbackDuration || duration, true);
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
    updateGeniusLink();
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
  for (const id of ['artist', 'title']) $(id).addEventListener('input', () => { cancel(); album = ''; updateGeniusLink(); $('results').hidden = true; status('Choose Find lyrics to search with these details.'); });
  const finishScrub = () => {
    scrubbing = false;
    update(playbackTime, playbackDuration, true);
  };
  const armScrub = () => {
    if (!hasLyrics) return;
    scrubbing = true;
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(finishScrub, 250);
  };
  for (const event of ['wheel', 'touchstart', 'pointerdown']) $('text').addEventListener(event, armScrub, { passive: true });
  $('text').addEventListener('keydown', event => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) armScrub();
  });
  $('text').addEventListener('scroll', () => {
    if (!scrubbing || !hasLyrics) return;
    clearTimeout(scrubTimer);
    const panel = $('text');
    let time;
    if (timedLines.length) {
      const center = panel.scrollTop + panel.clientHeight / 2;
      let nearest = 0;
      for (let i = 1; i < lineNodes.length; i++) {
        if (Math.abs(lineNodes[i].offsetTop + lineNodes[i].offsetHeight / 2 - center) < Math.abs(lineNodes[nearest].offsetTop + lineNodes[nearest].offsetHeight / 2 - center)) nearest = i;
      }
      time = timedLines[nearest].time;
    } else {
      const range = panel.scrollHeight - panel.clientHeight;
      if (range <= 0) return;
      time = panel.scrollTop / range * playbackDuration;
    }
    $('text').dispatchEvent(new CustomEvent('lyricsscrub', { detail: time }));
    scrubTimer = setTimeout(finishScrub, 180);
  }, { passive: true });
  new ResizeObserver(() => {
    $('text').style.setProperty('--lyric-edge', `${Math.max(0, $('text').clientHeight / 2 - 22)}px`);
    update(playbackTime, playbackDuration, true);
  }).observe($('text'));
  renderFollowMode();
  return { reset, load, update };
})();
