"use strict";

window.Waveform = (() => {
  const canvas = document.getElementById('waveform');
  const wrap = document.getElementById('waveform-wrap');
  const status = document.getElementById('waveform-status');
  const context = canvas.getContext('2d');
  const image = document.createElement('canvas');
  const ink = image.getContext('2d');
  let peaks = null, progress = 0, revision = 0, frame = 0, pointer = null;
  let jobs = Promise.resolve();
  const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

  function draw() {
    frame = 0;
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    if (!peaks) return;
    context.globalAlpha = .38;
    context.drawImage(image, 0, 0);
    context.globalAlpha = 1;
    context.save();
    context.beginPath();
    context.rect(0, 0, width * progress, height);
    context.clip();
    context.drawImage(image, 0, 0);
    context.restore();
    context.fillStyle = '#f0f8db';
    context.fillRect(Math.min(width - 2, width * progress), 0, 2, height);
  }

  function scheduleDraw() { if (!frame) frame = requestAnimationFrame(draw); }

  function resize() {
    if (!context || !ink || !peaks) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = image.width = width;
    canvas.height = image.height = height;
    const bars = Math.max(1, Math.floor(canvas.clientWidth / 3));
    const step = width / bars;
    let maximum = 0;
    for (const peak of peaks) maximum = Math.max(maximum, peak);
    for (let bar = 0; bar < bars; bar++) {
      let peak = 0;
      const start = Math.floor(bar * peaks.length / bars);
      const end = Math.max(start + 1, Math.floor((bar + 1) * peaks.length / bars));
      for (let i = start; i < end; i++) peak = Math.max(peak, peaks[i] || 0);
      const level = maximum ? peak / maximum : 0;
      const size = Math.max(ratio, Math.sqrt(level) * (height - 10 * ratio));
      // Color represents relative amplitude, not frequency or detected instruments.
      ink.fillStyle = `hsl(${185 - level * 155} 72% 67%)`;
      ink.fillRect(bar * step, (height - size) / 2, Math.max(1, step - ratio), size);
    }
    scheduleDraw();
  }

  function reset() {
    revision++;
    peaks = null; progress = 0;
    if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    pointer = null;
    wrap.hidden = true;
    canvas.hidden = false;
    status.hidden = false;
    status.textContent = 'Building waveform…';
    scheduleDraw();
  }

  function update(time, duration) {
    const next = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
    if (next !== progress) { progress = next; scheduleDraw(); }
  }

  function load(file, duration) {
    const version = revision;
    wrap.hidden = false;
    if (!context || !ink || !window.OfflineAudioContext || file.size > 100 * 1024 * 1024 || duration > 1200) {
      canvas.hidden = true;
      status.textContent = 'Waveform unavailable for this file. Use the seek bar below.';
      return;
    }
    // Serialize decoding so switching tracks cannot decode several large files at once.
    jobs = jobs.catch(() => {}).then(async () => {
      if (version !== revision) return;
      try {
        const encoded = await file.arrayBuffer();
        if (version !== revision) return;
        const decoder = new OfflineAudioContext(1, 1, 16000);
        const audio = await decoder.decodeAudioData(encoded);
        if (version !== revision) return;
        const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
        const result = new Float32Array(Math.min(2048, audio.length));
        for (let bin = 0; bin < result.length; bin++) {
          const from = Math.floor(bin * audio.length / result.length);
          const to = Math.floor((bin + 1) * audio.length / result.length);
          let peak = 0;
          for (const channel of channels) for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(channel[i]));
          result[bin] = peak;
          if (bin % 64 === 0) {
            await yieldToUI();
            if (version !== revision) return;
          }
        }
        peaks = result;
        status.textContent = 'Click or drag to seek · brighter color shows played audio';
        resize();
      } catch {
        if (version !== revision) return;
        canvas.hidden = true;
        status.textContent = 'Could not draw this waveform. Playback and the seek bar still work.';
      }
    });
  }

  function seek(event) {
    if (!peaks) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    canvas.dispatchEvent(new CustomEvent('waveformseek', { detail: fraction }));
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!peaks || !event.isPrimary || event.button !== 0) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    seek(event);
  });
  canvas.addEventListener('pointermove', (event) => { if (pointer === event.pointerId) seek(event); });
  canvas.addEventListener('pointerup', (event) => {
    if (pointer !== event.pointerId) return;
    seek(event);
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  for (const event of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { pointer = null; });
  new ResizeObserver(resize).observe(canvas);
  return { reset, load, update };
})();
