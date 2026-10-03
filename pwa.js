"use strict";

(() => {
  const status = document.getElementById('offline-status');
  const install = document.getElementById('install-app');
  const update = document.getElementById('update-app');
  const updateStatus = document.getElementById('update-status');
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && location.pathname.startsWith('/__preview__/');
  let updateTimer = 0, reloadStarted = false;
  let installPrompt = null, registration = null, reloadForUpdate = false, cached = false;

  function renderStatus() {
    status.textContent = cached
      ? navigator.onLine ? 'Ready offline · songs stay on your device' : 'Offline · local songs and saved lyrics are available'
      : navigator.onLine ? 'Preparing offline access…' : 'Offline access is not confirmed. Reconnect and reopen the app.';
  }

  async function checkOffline() {
    const worker = registration?.active;
    if (!worker) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      cached = event.data?.ready === true;
      renderStatus();
    };
    worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (localPreview) return;
    installPrompt = event;
    install.hidden = false;
  });
  install.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    install.hidden = true;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { status.textContent = 'Use your browser menu to install this app.'; }
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; install.hidden = true; });
  function reloadUpdatedApp() {
    if (reloadStarted) return;
    clearTimeout(updateTimer);
    if (window.looperBusy) {
      reloadForUpdate = false; update.disabled = false; update.hidden = false;
      update.textContent = 'Update & reload';
      updateStatus.textContent = 'Finish recording or download/save the unsaved take before reloading.';
      return;
    }
    reloadStarted = true;
    location.reload();
  }
  update.addEventListener('click', async () => {
    if (window.looperBusy) {
      updateStatus.textContent = 'Finish recording or download/save the unsaved take before updating.';
      return;
    }
    update.disabled = true; update.textContent = 'Updating...'; updateStatus.textContent = '';
    reloadForUpdate = true;
    try {
      registration = await navigator.serviceWorker.getRegistration(new URL('./', location.href).href);
      const worker = registration?.waiting;
      // Another tab may already have activated the update. The visible button
      // must still reload this older page instead of silently doing nothing.
      if (!worker || worker.state === 'activated') { reloadUpdatedApp(); return; }
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' && reloadForUpdate) reloadUpdatedApp();
      });
      updateTimer = setTimeout(() => {
        reloadForUpdate = false; update.disabled = false; update.textContent = 'Retry update';
        updateStatus.textContent = 'The update did not finish. Close other app tabs, then retry.';
      }, 8000);
      worker.postMessage({ type: 'ACTIVATE_UPDATE' });
    } catch {
      clearTimeout(updateTimer); reloadForUpdate = false; update.disabled = false; update.textContent = 'Retry update';
      updateStatus.textContent = 'Could not activate the update. Reload this page and try again.';
    }
  });

  for (const panel of ['cues', 'lyrics']) {
    document.getElementById(`show-${panel}`).addEventListener('click', () => {
      document.body.dataset.mobilePanel = panel;
      requestAnimationFrame(updateLayout);
      for (const name of ['cues', 'lyrics']) document.getElementById(`show-${name}`).setAttribute('aria-pressed', String(name === panel));
    });
  }
  document.body.dataset.mobilePanel = 'lyrics';
  document.getElementById('toggle-waveform').addEventListener('click', (event) => {
    const expanded = document.body.dataset.waveformExpanded !== 'true';
    document.body.dataset.waveformExpanded = String(expanded);
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = expanded ? 'Hide waveform' : 'Show waveform';
  });

  let heightPercent = 0, layoutFrame = 0;
  try { const saved = Number(localStorage.getItem('music-practice-player:lyrics:height')); if (saved >= 40 && saved <= 100) heightPercent = saved; } catch {}
  const heightSlider = document.getElementById('lyrics-height-slider');
  function renderHeightSetting() {
    heightSlider.value = String(heightPercent || 100);
    document.getElementById('lyrics-height-value').textContent = heightPercent ? `${heightPercent}%` : 'Auto';
  }
  function saveHeight() {
    try { localStorage.setItem('music-practice-player:lyrics:height', String(heightPercent)); } catch {}
    renderHeightSetting(); scheduleLayout();
  }
  heightSlider.addEventListener('input', () => { heightPercent = Number(heightSlider.value); saveHeight(); });
  document.getElementById('lyrics-height-auto').addEventListener('click', () => { heightPercent = 0; saveHeight(); });
  renderHeightSetting();
  function updateLayout() {
    const root = document.documentElement;
    const header = document.querySelector('.sticky-header').getBoundingClientRect();
    root.style.setProperty('--header-height', `${header.height}px`);
    const dock = document.getElementById('playback-dock').getBoundingClientRect();
    root.style.setProperty('--dock-height', `${dock.height}px`);
    const lyrics = document.querySelector('.lyrics');
    if (lyrics.getClientRects().length) {
      const viewportBottom = window.visualViewport ? visualViewport.offsetTop + visualViewport.height : innerHeight;
      const mobile = matchMedia('(max-width: 760px)').matches;
      const bottom = mobile ? Math.min(dock.top, viewportBottom) : viewportBottom;
      // Document position avoids sizing changes caused just by page scrolling.
      const top = lyrics.getBoundingClientRect().top + (mobile ? window.scrollY : 0);
      const available = Math.max(220, bottom - top - 10);
      root.style.setProperty('--lyrics-height', `${Math.max(220, available * (heightPercent || 100) / 100)}px`);
    }
  }
  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(updateLayout);
  }
  const layoutObserver = new ResizeObserver(scheduleLayout);
  for (const selector of ['#playback-dock', '.sticky-header', '.install-row']) layoutObserver.observe(document.querySelector(selector));
  document.addEventListener('appmodechange', scheduleLayout);
  window.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('scroll', scheduleLayout);
  scheduleLayout();

  if (localPreview) {
    install.hidden = update.hidden = true;
    status.textContent = 'Local preview: files load directly from disk. Refresh to see edits.';
    return;
  }
  if (location.protocol === 'file:') {
    status.textContent = 'Local file mode · open the HTTPS website on Android to install';
    return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    status.textContent = 'Installation and offline reopening require HTTPS and a supported browser.';
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) reloadUpdatedApp();
    else { update.hidden = !registration?.waiting; checkOffline(); }
  });
  window.addEventListener('online', () => { renderStatus(); checkOffline(); });
  window.addEventListener('offline', () => { renderStatus(); checkOffline(); });
  renderStatus();
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async (value) => {
    registration = value;
    const showUpdate = () => { update.hidden = !registration.waiting; };
    showUpdate();
    const watchInstalling = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') setTimeout(showUpdate, 0);
        if (worker.state === 'redundant' && !cached) status.textContent = 'Could not save the app offline. Reconnect and reload to retry.';
      });
    };
    registration.addEventListener('updatefound', watchInstalling);
    watchInstalling();
    await navigator.serviceWorker.ready;
    checkOffline();
  }).catch(() => { status.textContent = 'Could not enable offline access. Reconnect and reload to retry.'; });
})();
