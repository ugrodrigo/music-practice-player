"use strict";

(() => {
  const $ = id => document.getElementById(`songs-${id}`);
  const store = window.SongLibraryStore;
  const DRIVE = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,appProperties';
  const MARKER = 'music-practice-player-library-v1';
  // Public browser key, restricted in Google Cloud to Picker API and approved referrers.
  const PICKER_KEY = 'AIzaSyCXtTqoEzorFkysQPBwHKVY2ongT7u4jBk';
  const PROJECT_NUMBER = '26996166257';
  const LIMIT_KEY = 'music-practice-player:offline-limit-mb';
  const MAX_FILE = 50 * 1024 * 1024;
  const DEVICE = 'device';
  let token = '', tokenOwner = '', tokenTime = 0, folderId = '', remote = [], busy = false, pickerLoading;
  let local = [];
  const format = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const owner = () => window.PracticeDriveAuth?.user?.uid || 'guest';
  const status = message => { $('status').textContent = message; };
  const validAudio = file => file && file.size > 0 && file.size <= MAX_FILE &&
    (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|aiff?|weba)$/i.test(file.name));
  function errorMessage(error) {
    if (error?.name === 'QuotaExceededError') return 'Browser storage is full. Remove an offline song or free device space.';
    return error?.message || 'The operation failed. Try again.';
  }
  async function run(work) {
    if (busy) return;
    busy = true; updateControls();
    try { await work(); }
    catch (error) { status(errorMessage(error)); }
    finally { busy = false; updateControls(); }
  }
  function updateControls() {
    $('add').disabled = $('upload').disabled = $('save-current').disabled = $('upload-current').disabled = busy;
    $('save-current').disabled ||= !window.PracticePlayer?.file;
    $('upload-current').disabled ||= !window.PracticePlayer?.file;
    $('connect').disabled = busy;
    $('refresh').disabled = busy;
    $('pick').disabled = busy;
    $('connect').hidden = !!token && owner() === tokenOwner;
    $('refresh').hidden = !token || owner() !== tokenOwner;
    $('pick').hidden = !token || owner() !== tokenOwner;
    $('connect').textContent = window.PracticeDriveAuth?.user ? 'Connect Google Drive' : 'Sign in to use Drive';
  }
  function button(label, action) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.addEventListener('click', () => run(action)); return node;
  }
  function row(item, subtitle, actions) {
    const node = document.createElement('div'); node.className = 'song-row';
    const info = document.createElement('div'); info.className = 'song-info';
    const name = document.createElement('strong'); name.textContent = item.name;
    const details = document.createElement('small'); details.textContent = subtitle;
    info.append(name, details);
    const controls = document.createElement('div'); controls.className = 'song-actions';
    for (const [label, action] of actions) controls.append(button(label, action));
    node.append(info, controls); return node;
  }
  async function refreshLocal() {
    local = await store.list(DEVICE);
    const total = local.reduce((sum, item) => sum + item.size, 0);
    let browser = '';
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota) browser = ` · Browser estimate: ${format(estimate.usage)} used of ${format(estimate.quota)}`;
    } catch {}
    $('usage').textContent = `${format(total)} of ${$('limit').value} MB selected for offline songs${browser}.`;
    $('local-list').replaceChildren();
    if (!local.length) { const p = document.createElement('p'); p.textContent = 'No songs selected for offline use.'; $('local-list').append(p); }
    for (const item of local) {
      $('local-list').append(row(item, `${format(item.size)} · Available offline`, [
        ['Play', async () => {
          const blob = await store.get(item.id);
          if (!blob) throw new Error('Offline copy is missing. Remove it and download again.');
          window.PracticePlayer.load(new File([blob], item.name, { type: item.type, lastModified: item.lastModified }));
          status(`Opened ${item.name} from this device.`);
        }],
        ['Save to Drive', async () => {
          if (!token || tokenOwner !== owner()) throw new Error('Connect Google Drive first.');
          const blob = await store.get(item.id);
          if (!blob) throw new Error('Offline copy is missing.');
          await upload(new File([blob], item.name, { type: item.type, lastModified: item.lastModified }), item.hash);
        }],
        ['Remove offline', async () => {
          if (!confirm(`Remove the offline copy of “${item.name}” from this device? The Drive copy, if any, remains.`)) return;
          await store.remove(item.id); await refreshLocal(); status('Offline copy removed from this device.');
        }],
      ]));
    }
    updateControls();
  }
  async function keepOffline(file, sourceId = '') {
    if (!validAudio(file)) throw new Error('Choose a playable audio file up to 50 MB.');
    const item = await store.save(file, DEVICE, sourceId, Number($('limit').value) * 1024 * 1024);
    await refreshLocal(); status(`${item.name} is available offline on this device.`);
  }
  async function authorized(url, options = {}) {
    if (!token || tokenOwner !== owner()) throw new Error('Connect Google Drive first.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers, cache: 'no-store', signal: AbortSignal.timeout(options.method === 'PUT' ? 300000 : 30000) });
    if (response.status === 401) { token = ''; folderId = ''; throw new Error('Drive permission expired. Connect Google Drive again.'); }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error?.message || ''; } catch {}
      throw new Error(`Google Drive error ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response;
  }
  async function files(query, fields) {
    const found = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: query, fields: `nextPageToken,files(${fields})`, pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await (await authorized(`${DRIVE}?${params}`)).json();
      found.push(...(page.files || [])); pageToken = page.nextPageToken || '';
    } while (pageToken);
    return found;
  }
  async function ensureFolder() {
    if (folderId) return folderId;
    const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='library' and value='${MARKER}' }`;
    const existing = await files(query, 'id,name');
    if (existing.length) return folderId = existing[0].id;
    const response = await authorized(`${DRIVE}?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Music Practice Player', mimeType: 'application/vnd.google-apps.folder', appProperties: { library: MARKER } }),
    });
    return folderId = (await response.json()).id;
  }
  async function refreshDrive() {
    await ensureFolder();
    // drive.file returns files made by this app and files the user chose in Picker.
    remote = (await files('trashed = false', 'id,name,size,mimeType,appProperties,parents'))
      .filter(item => item.mimeType?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|aiff?|weba)$/i.test(item.name));
    $('drive-list').replaceChildren();
    if (!remote.length) { const p = document.createElement('p'); p.textContent = 'No accessible songs yet. Choose existing Drive files to add songs you placed there yourself.'; $('drive-list').append(p); }
    for (const item of remote.sort((a, b) => a.name.localeCompare(b.name))) {
      const size = Number(item.size || 0);
      const appFile = item.appProperties?.library === MARKER;
      const actions = [
        ['Play', async () => {
          const file = await download(item);
          window.PracticePlayer.load(file);
          status(`Opened ${item.name} from Drive. Use Keep offline to save a copy.`);
        }],
        ['Keep offline', async () => keepOffline(await download(item), item.id)],
      ];
      if (appFile) actions.push(
        ['Remove from Drive', async () => {
          if (!confirm(`Remove “${item.name}” from Google Drive? Offline copies on your devices will remain.`)) return;
          await authorized(`${DRIVE}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          await refreshDrive(); status(`${item.name} removed from Google Drive.`);
        }],
      );
      $('drive-list').append(row(item, `${format(size)} · ${appFile ? 'Saved by this app' : 'Chosen from your Drive'}`, actions));
    }
  }
  async function download(item) {
    if (Number(item.size) > MAX_FILE) throw new Error('This song exceeds the 50 MB playback limit.');
    status(`Downloading ${item.name} from Drive...`);
    const response = await authorized(`${DRIVE}/${encodeURIComponent(item.id)}?alt=media`);
    const blob = await response.blob();
    if (blob.size > MAX_FILE) throw new Error('This song exceeds the 50 MB playback limit.');
    return new File([blob], item.name, { type: item.mimeType?.startsWith('audio/') ? item.mimeType : 'audio/mpeg' });
  }
  async function upload(file, knownHash = '') {
    if (!validAudio(file)) throw new Error('Choose a playable audio file up to 50 MB.');
    const hash = knownHash || [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    await refreshDrive(); // Another device may have uploaded the same file since the last refresh.
    if (remote.some(item => item.appProperties?.sha256 === hash)) { status('This exact song is already in Drive.'); return; }
    const folder = await ensureFolder();
    const type = file.type?.startsWith('audio/') ? file.type : 'audio/mpeg';
    status(`Uploading ${file.name} to Drive...`);
    const start = await authorized(UPLOAD, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify({ name: file.name, mimeType: type, parents: [folder], appProperties: { sha256: hash, library: MARKER } }),
    });
    const session = start.headers.get('Location');
    if (!session || !session.startsWith('https://www.googleapis.com/')) throw new Error('Drive did not provide a safe upload session.');
    await authorized(session, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
    try { await refreshDrive(); status(`${file.name} saved in your Google Drive folder.`); }
    catch { status(`${file.name} was uploaded, but the list could not refresh. Reconnect Drive before retrying.`); }
  }
  async function loadPicker() {
    if (window.google?.picker) return;
    if (!pickerLoading) pickerLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('Google Drive picker did not load. Try again.')), 20000);
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onerror = () => { clearTimeout(timer); reject(new Error('Google Drive picker could not load. Check your connection or browser shields.')); };
      script.onload = () => {
        if (!window.gapi?.load) { clearTimeout(timer); reject(new Error('Google Drive picker is unavailable.')); return; }
        window.gapi.load('picker', () => { clearTimeout(timer); resolve(); });
      };
      document.head.append(script);
    }).catch(error => { pickerLoading = null; throw error; });
    await pickerLoading;
  }
  async function chooseExisting() {
    if (!token || tokenOwner !== owner()) throw new Error('Connect Google Drive first.');
    await loadPicker();
    const folder = await ensureFolder();
    const api = window.google.picker;
    const view = new api.DocsView(api.ViewId.DOCS).setParent(folder).setMode(api.DocsViewMode.LIST);
    const picker = new api.PickerBuilder()
      .addView(view)
      .enableFeature(api.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(PICKER_KEY)
      .setAppId(PROJECT_NUMBER)
      .setOrigin(location.origin)
      .setTitle('Choose audio files from Google Drive')
      .setCallback(data => {
        if (data[api.Response.ACTION] !== api.Action.PICKED) return;
        const chosen = (data[api.Response.DOCUMENTS] || []).filter(item =>
          item.mimeType?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|aiff?|weba)$/i.test(item.name || ''));
        if (!chosen.length) { status('Choose an audio file such as MP3, WAV, or M4A.'); return; }
        run(async () => {
          await refreshDrive();
          const found = chosen.filter(item => remote.some(song => song.id === item.id));
          status(found.length === chosen.length
            ? `${found.length} Drive song${found.length === 1 ? '' : 's'} added. Choose Play or Keep offline below.`
            : 'Selection received. Refresh Drive in a moment if the songs have not appeared yet.');
        });
      })
      .build();
    picker.setVisible(true);
    status('Choose the MP3 files you want the app to access. Files you added manually need this one-time selection.');
  }
  $('pick').addEventListener('click', () => run(chooseExisting));
  $('add').addEventListener('click', () => $('file-input').click());
  $('upload').addEventListener('click', () => {
    if (!token || tokenOwner !== owner()) { status('Connect Google Drive before uploading.'); return; }
    $('upload-input').click();
  });
  $('file-input').addEventListener('change', () => {
    const file = $('file-input').files[0]; $('file-input').value = '';
    if (file) run(() => keepOffline(file));
  });
  $('upload-input').addEventListener('change', () => {
    const file = $('upload-input').files[0]; $('upload-input').value = '';
    if (file) run(() => upload(file));
  });
  $('save-current').addEventListener('click', () => run(() => keepOffline(window.PracticePlayer.file)));
  $('upload-current').addEventListener('click', () => run(() => upload(window.PracticePlayer.file)));
  $('limit').addEventListener('change', () => { localStorage.setItem(LIMIT_KEY, $('limit').value); refreshLocal().catch(error => status(errorMessage(error))); });
  $('connect').addEventListener('click', () => run(async () => {
    if (!window.PracticeDriveAuth?.user) {
      document.getElementById('account-toggle').click();
      status('Sign in with Google from the Account menu, then connect Drive.');
      return;
    }
    token = await window.PracticeDriveAuth.requestToken();
    tokenOwner = owner(); tokenTime = Date.now(); folderId = '';
    await refreshDrive(); status('Google Drive connected. The app folder is private by default; its sharing settings in Drive control access.');
  }));
  $('refresh').addEventListener('click', () => run(async () => {
    if (Date.now() - tokenTime > 45 * 60 * 1000) { token = ''; throw new Error('Drive permission expired. Connect Google Drive again.'); }
    await refreshDrive(); status('Drive library updated.');
  }));
  document.addEventListener('syncaccountchange', () => {
    if (owner() !== tokenOwner) { token = ''; tokenOwner = ''; folderId = ''; remote = []; $('drive-list').textContent = 'Connect Drive to see your songs.'; }
    refreshLocal().catch(error => status(errorMessage(error)));
  });
  document.addEventListener('appmodechange', () => { if (document.body.dataset.appMode === 'songs') refreshLocal().catch(error => status(errorMessage(error))); });
  try { const saved = localStorage.getItem(LIMIT_KEY); if (['250', '500', '1024', '2048'].includes(saved)) $('limit').value = saved; } catch {}
  refreshLocal().catch(error => status(errorMessage(error)));
})();
