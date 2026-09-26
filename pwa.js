"use strict";

(() => {
  const status = document.getElementById('offline-status');
  const install = document.getElementById('install-app');
  const update = document.getElementById('update-app');
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
  update.addEventListener('click', () => {
    if (!registration?.waiting) return;
    reloadForUpdate = true;
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  });

  for (const panel of ['cues', 'lyrics']) {
    document.getElementById(`show-${panel}`).addEventListener('click', () => {
      document.body.dataset.mobilePanel = panel;
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

  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--dock-height', `${document.getElementById('playback-dock').getBoundingClientRect().height}px`);
  }).observe(document.getElementById('playback-dock'));

  if (location.protocol === 'file:') {
    status.textContent = 'Local file mode · open the HTTPS website on Android to install';
    return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    status.textContent = 'Installation and offline reopening require HTTPS and a supported browser.';
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) location.reload();
    else checkOffline();
  });
  window.addEventListener('online', () => { renderStatus(); checkOffline(); });
  window.addEventListener('offline', () => { renderStatus(); checkOffline(); });
  renderStatus();
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async (value) => {
    registration = value;
    const showUpdate = () => { update.hidden = !registration.waiting; };
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') showUpdate();
        if (worker.state === 'redundant' && !cached) status.textContent = 'Could not save the app offline. Reconnect and reload to retry.';
      });
    });
    await navigator.serviceWorker.ready;
    checkOffline();
  }).catch(() => { status.textContent = 'Could not enable offline access. Reconnect and reload to retry.'; });
})();
