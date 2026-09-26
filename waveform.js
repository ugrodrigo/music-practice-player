"use strict";

window.Waveform = (() => {
  const canvas = document.getElementById('waveform');
  const wrap = document.getElementById('waveform-wrap');
  const status = document.getElementById('waveform-status');
  const zoom = document.getElementById('waveform-zoom');
  const context = canvas.getContext('2d');
  const image = document.createElement('canvas');
  const ink = image.getContext('2d');
  let peaks = null, progress = 0, revision = 0, frame = 0, pointer = null;
  let jobs = Promise.resolve();
  let trackDuration = 0, scale = 1, dragView = null;
  const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

  function view() {
    const span = Number(zoom.value);
    return span ? { start: progress * trackDuration - span / 2, span } : { start: 0, span: trackDuration };
  }

  function paint(target, start, span, width, height) {
    const count = peaks.amplitude.length;
    const bars = Math.max(1, Math.floor(width / (2 * (window.devicePixelRatio || 1))));
    const step = width / bars;
    // Anchor each bar's audio interval to the track, not the moving viewport.
    // Scrolling changes only its x position, never its height or color.
    const secondsPerBar = span / bars;
    const firstBar = Math.floor(start / secondsPerBar);
    for (let bar = firstBar; bar <= Math.floor((start + span) / secondsPerBar); bar++) {
      const barStart = bar * secondsPerBar;
      const barEnd = (bar + 1) * secondsPerBar;
      const x = (barStart - start) / span * width;
      if (barEnd <= 0 || barStart >= trackDuration) continue;
      const from = Math.max(0, Math.min(count - 1, Math.floor(barStart / trackDuration * count)));
      const to = Math.min(count, Math.max(from + 1, Math.floor(barEnd / trackDuration * count)));
      let energy = 0, transient = 0, bass = 0, mid = 0, high = 0;
      for (let i = from; i < to; i++) {
        energy += peaks.amplitude[i] ** 2;
        transient = Math.max(transient, peaks.transient[i]);
        bass += peaks.bass[i] ** 2; mid += peaks.mid[i] ** 2; high += peaks.high[i] ** 2;
      }
      const amplitude = Math.sqrt(energy / (to - from));
      const strongest = Math.max(bass, mid, high, 1e-12);
      const color = `rgb(${Math.round(40 + 215 * Math.pow(bass / strongest, .65))},${Math.round(40 + 215 * Math.pow(mid / strongest, .65))},${Math.round(50 + 205 * Math.pow(high / strongest, .65))})`;
      const size = Math.max(1, Math.min(1, amplitude / scale) ** 1.15 * (height - 8));
      const outer = Math.max(size, Math.min(1, transient / (scale * 2.8)) * (height - 8));
      target.fillStyle = color;
      target.globalAlpha = .25;
      target.fillRect(x, (height - outer) / 2, Math.max(1, step - .5), outer);
      target.globalAlpha = .95;
      target.fillRect(x, (height - size) / 2, Math.max(1, step - .5), size);
    }
    target.globalAlpha = 1;
  }

  function draw() {
    frame = 0;
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    if (!peaks) return;
    const ratio = height / 150;
    const mainHeight = 104 * ratio, overviewTop = 120 * ratio;
    const current = dragView || view();
    paint(context, current.start, current.span, width, mainHeight);
    const tick = current.span <= 10 ? 2 : current.span <= 30 ? 5 : Math.max(10, Math.ceil(current.span / 6 / 10) * 10);
    context.font = `${10 * ratio}px Segoe UI`;
    for (let time = Math.max(0, Math.ceil(current.start / tick) * tick); time <= Math.min(trackDuration, current.start + current.span); time += tick) {
      const x = (time - current.start) / current.span * width;
      context.fillStyle = '#ffffff15'; context.fillRect(x, 0, 1, mainHeight);
      context.fillStyle = '#929e97';
      context.fillText(`${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`, Math.min(width - 32 * ratio, x + 3), 115 * ratio);
    }
    context.drawImage(image, 0, overviewTop);
    context.fillStyle = '#ffffff12';
    const viewStart = Math.max(0, current.start), viewEnd = Math.min(trackDuration, current.start + current.span);
    context.fillRect(viewStart / trackDuration * width, overviewTop, (viewEnd - viewStart) / trackDuration * width, height - overviewTop);
    context.strokeStyle = '#d8ee9680';
    context.strokeRect(viewStart / trackDuration * width, overviewTop, (viewEnd - viewStart) / trackDuration * width, height - overviewTop - 1);
    const playhead = (progress * trackDuration - current.start) / current.span * width;
    context.fillStyle = '#f0f8db';
    context.fillRect(Math.max(0, Math.min(width - 2, playhead)), 0, 2, mainHeight);
    context.fillRect(Math.min(width - 2, width * progress), overviewTop, 2, height - overviewTop);
  }

  function scheduleDraw() { if (!frame) frame = requestAnimationFrame(draw); }

  function resize() {
    if (!context || !ink || !peaks) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    canvas.width = image.width = width;
    canvas.height = height;
    image.height = Math.round(30 * ratio);
    paint(ink, 0, trackDuration, width, image.height);
    scheduleDraw();
  }

  function reset() {
    revision++;
    peaks = null; progress = 0;
    trackDuration = 0; dragView = null; zoom.disabled = true;
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
        const count = Math.min(Math.ceil(audio.duration * 100), audio.length);
        const result = Object.fromEntries(['amplitude', 'transient', 'bass', 'mid', 'high'].map((name) => [name, new Float32Array(count)]));
        const states = channels.map(() => ({ low: 0, upper: 0 }));
        const lowAlpha = 1 - Math.exp(-2 * Math.PI * 200 / audio.sampleRate);
        const highAlpha = 1 - Math.exp(-2 * Math.PI * 2500 / audio.sampleRate);
        for (let bin = 0; bin < count; bin++) {
          const from = Math.floor(bin * audio.length / count);
          const to = Math.floor((bin + 1) * audio.length / count);
          let energy = 0, peak = 0, bass = 0, mid = 0, high = 0;
          for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
            const channel = channels[channelIndex], state = states[channelIndex];
            for (let i = from; i < to; i++) {
              const sample = channel[i];
              state.low += lowAlpha * (sample - state.low);
              state.upper += highAlpha * (sample - state.upper);
              energy += sample * sample;
              peak = Math.max(peak, Math.abs(sample));
              bass += state.low ** 2;
              mid += (state.upper - state.low) ** 2;
              high += (sample - state.upper) ** 2;
            }
          }
          const samples = (to - from) * channels.length;
          result.amplitude[bin] = Math.sqrt(energy / samples);
          result.transient[bin] = peak;
          result.bass[bin] = Math.sqrt(bass / samples);
          result.mid[bin] = Math.sqrt(mid / samples);
          result.high[bin] = Math.sqrt(high / samples);
          if (bin % 100 === 0) {
            await yieldToUI();
            if (version !== revision) return;
          }
        }
        peaks = result;
        trackDuration = duration;
        const sorted = result.amplitude.slice().sort();
        scale = Math.max(.001, sorted[Math.floor((sorted.length - 1) * .98)] * 1.15);
        zoom.disabled = false;
        status.textContent = 'Click or drag to seek · bottom strip shows the whole track';
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
    const current = dragView || view();
    canvas.dispatchEvent(new CustomEvent('waveformseek', { detail: Math.max(0, Math.min(1, (current.start + fraction * current.span) / trackDuration)) }));
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!peaks || !event.isPrimary || event.button !== 0) return;
    pointer = event.pointerId;
    const bounds = canvas.getBoundingClientRect();
    dragView = event.clientY - bounds.top >= bounds.height * .8 ? { start: 0, span: trackDuration } : view();
    canvas.setPointerCapture(pointer);
    seek(event);
  });
  canvas.addEventListener('pointermove', (event) => { if (pointer === event.pointerId) seek(event); });
  canvas.addEventListener('pointerup', (event) => {
    if (pointer !== event.pointerId) return;
    seek(event);
    pointer = null;
    dragView = null; scheduleDraw();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  for (const event of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { pointer = null; dragView = null; scheduleDraw(); });
  zoom.addEventListener('change', scheduleDraw);
  new ResizeObserver(resize).observe(canvas);
  return { reset, load, update };
})();
