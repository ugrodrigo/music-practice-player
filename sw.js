"use strict";

// Bump this version whenever any cached application file changes.
const VERSION = 'v38';
const PREFIX = `music-practice-player:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const FILES = ['./', 'index.html', 'src/css/style.css', 'src/js/app.js', 'src/js/practice-audio.js', 'vendor/signalsmith/SignalsmithStretch.js', 'src/js/audio-store.js', 'src/js/recording-folder.js', 'src/js/looper-store.js', 'src/js/looper.js', 'src/js/looper-io.js', 'src/js/lyrics.js', 'src/js/waveform.js', 'src/js/pwa.js', 'manifest.webmanifest', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png'];
const URLS = FILES.map((file) => new URL(file, self.registration.scope).href);

self.addEventListener('install', (event) => {
  // Installation succeeds only after the entire app is cached.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(URLS.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = ''; url.hash = '';
  if (!URLS.includes(url.href)) return; // Never cache audio, lyrics API requests, or unrelated sites.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.href) || fetch(request);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CHECK_OFFLINE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(URLS.map((url) => cache.match(url)));
      event.ports[0]?.postMessage({ ready: entries.every(Boolean), version: VERSION });
    })());
  }
});
