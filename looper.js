"use strict";

(() => {
  const $ = id => document.getElementById(`looper-${id}`);
  const canvas = $('waveform'), ink = canvas.getContext('2d');
  let ctx, source = null, stream = null, recorder = null, analyser = null, inputNode = null;
  let record = null, buffer = null, peaks = null, fullWav = null;
  let state = 'idle', selected = 'start', viewStart = 0, pointer = null, frozenView = null;
  let playGeneration = 0, zoom = 1;
  const touches = new Map();
  let pinch = null, gesture = null, suppressGesture = false;
  let countTimer = 0, countResolve = null, clicks = [];
  let loopStart = 0, loopEnd = 0;
  let frame = 0, recordStart = 0, playStart = 0, playOffset = 0, playDuration = 0;
  let limitTimer = 0, saveTimer = 0, seamTimer = 0, operation = 0, editVersion = 0;
  let dirty = false, recordingError = '', folderQueue = Promise.resolve();
  const busy = () => ['requesting', 'counting', 'recording', 'finishing', 'loading'].includes(state);
  const status = text => { $('status').textContent = text; };
  const time = seconds => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${(Math.max(0, seconds) % 60).toFixed(1).padStart(4, '0')}`;
  function context() { return ctx ||= new AudioContext({ latencyHint: 'interactive' }); }
  const io = new LooperAudioIO(context);
  function activity() {
    window.looperBusy = busy() || dirty;
    window.looperActive = document.body.dataset.appMode === 'looper' && (busy() || !!record);
    document.dispatchEvent(new Event('looperactivity'));
  }
  function render() {
    const loaded = !!buffer, locked = busy();
    io.lock(locked || state === 'playing');
    for (const id of ['play', 'start', 'end', 'earlier', 'later', 'seam', 'zoom', 'export-loop']) $(id).disabled = !loaded || locked;
    $('export-full').disabled = !record || locked;
    $('saved').disabled = locked;
    $('name').disabled = !record || locked;
    $('record').disabled = locked;
    $('bpm').disabled = $('count-in').disabled = locked;
    $('record').textContent = state === 'recording' ? 'Recording...' : 'Record new';
    $('stop').disabled = !['requesting', 'counting', 'recording', 'playing'].includes(state);
    $('folder-save').disabled = !loaded || locked;
    $('folder').disabled = locked || !window.RecordingFolder?.supported;
    $('select-start').disabled = !loaded || locked;
    $('select-end').disabled = !loaded || locked;
    $('pan').disabled = !loaded || locked || zoom === 1;
    if (record) {
      $('start').value = record.start.toFixed(3); $('end').value = record.end.toFixed(3);
      $('start').max = String(Math.max(0, record.end - .05));
      $('end').min = String(record.start + .05); $('end').max = String(record.duration);
    }
    $('select-start').setAttribute('aria-pressed', String(selected === 'start'));
    $('select-end').setAttribute('aria-pressed', String(selected === 'end'));
    activity(); draw();
  }
  function view() {
    if (!buffer) return { start: 0, span: 1 };
    const span = buffer.duration / zoom;
    viewStart = Math.max(0, Math.min(buffer.duration - span, viewStart));
    $('pan').max = String(buffer.duration - span); $('pan').value = String(viewStart);
    $('window').textContent = `${time(viewStart)} - ${time(viewStart + span)}`;
    return frozenView || { start: viewStart, span };
  }
  function draw() {
    if (!ink) return;
    const ratio = Math.min(devicePixelRatio || 1, 2), width = Math.max(1, Math.round(canvas.clientWidth * ratio)), height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ink.clearRect(0, 0, width, height);
    if (!buffer || !peaks) return;
    const v = view(), x = t => (t - v.start) / v.span * width;
    ink.fillStyle = '#d8ee9622'; ink.fillRect(x(record.start), 0, x(record.end) - x(record.start), height);
    for (let px = 0; px < width; px += 2 * ratio) {
      const a = Math.floor((v.start + px / width * v.span) / buffer.duration * peaks.length);
      const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil((v.start + (px + 2 * ratio) / width * v.span) / buffer.duration * peaks.length)));
      let peak = 0; for (let i = a; i < b; i++) peak = Math.max(peak, peaks[i]);
      ink.fillStyle = '#80b8b0'; const h = Math.max(1, peak * height * .8);
      ink.fillRect(px, (height - h) / 2, ratio, h);
    }
    for (const edge of ['start', 'end']) {
      const pos = x(record[edge]);
      ink.fillStyle = edge === selected ? '#f1ffbf' : '#c0d888';
      ink.fillRect(pos - ratio, 0, 2 * ratio, height);
      ink.fillRect(pos - 5 * ratio, 0, 10 * ratio, 22 * ratio);
    }
    if (state === 'playing') {
      const position = playbackPosition();
      ink.fillStyle = '#ffffff'; ink.fillRect(x(position), 0, 2 * ratio, height);
      $('clock').textContent = time(position);
    } else $('clock').textContent = time(record.end - record.start);
  }
  function animate() {
    cancelAnimationFrame(frame);
    if (state === 'recording') {
      $('clock').textContent = time((performance.now() - recordStart) / 1000);
      if (analyser) { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); let sum = 0; for (const sample of samples) sum += sample * sample; $('meter').value = Math.min(1, Math.sqrt(sum / samples.length) * 3); }
    } else draw();
    if (state === 'recording' || state === 'playing') frame = requestAnimationFrame(animate);
  }
  function playbackPosition() {
    const position = playOffset + Math.max(0, ctx.currentTime - playStart);
    return position < loopEnd ? position : loopStart + (position - loopEnd) % (loopEnd - loopStart);
  }
  function stopPlayback() {
    playGeneration++; clearTimeout(seamTimer); cancelAnimationFrame(frame);
    if (source) { try { source.stop(); } catch {} source.disconnect(); source = null; }
    if (state === 'playing') state = 'idle';
  }
  function cleanupInput() {
    cancelCount();
    clearTimeout(limitTimer); stream?.getTracks().forEach(track => track.stop()); stream = null;
    inputNode?.disconnect(); inputNode = null; analyser?.disconnect(); analyser = null; $('meter').value = 0;
  }
  function buildPeaks() {
    const count = Math.min(12000, buffer.length); peaks = new Float32Array(count);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const samples = buffer.getChannelData(ch);
      for (let i = 0; i < count; i++) {
        let maximum = peaks[i];
        for (let j = Math.floor(i * samples.length / count); j < Math.floor((i + 1) * samples.length / count); j++) maximum = Math.max(maximum, Math.abs(samples[j]));
        peaks[i] = maximum;
      }
    }
  }
  function trimmed() {
    const begin = Math.floor(record.start * buffer.sampleRate), end = Math.min(buffer.length, Math.round(record.end * buffer.sampleRate));
    const length = Math.max(1, end - begin), result = context().createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    const fade = Math.min(Math.floor(buffer.sampleRate * .003), Math.floor(length / 4));
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const samples = result.getChannelData(ch); samples.set(buffer.getChannelData(ch).subarray(begin, begin + length));
      for (let i = 0; i < fade; i++) { samples[i] *= i / fade; samples[length - 1 - i] *= i / fade; }
    }
    return result;
  }
  async function play(seam = false) {
    if (!buffer || busy()) return;
    if (io.isBusy) { status('Finish or cancel the device test first.'); return; }
    io.stopTest();
    stopPlayback(); const generation = playGeneration; io.lock(true);
    try {
      await context().resume(); await io.prepareOutput();
      if (generation !== playGeneration) return;
      if (!buffer || document.body.dataset.appMode !== 'looper' || busy()) return;
      source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      loopStart = record.start; loopEnd = record.end; source.loopStart = loopStart; source.loopEnd = loopEnd; source.connect(ctx.destination);
      playDuration = loopEnd - loopStart; playOffset = seam ? loopEnd - Math.min(.75, playDuration / 2) : loopStart;
      playStart = ctx.currentTime; source.start(playStart, playOffset); state = 'playing';
      status(seam ? 'Previewing the end-to-start join.' : 'Loop playing. Adjust either marker to refine the loop.');
      if (seam) seamTimer = setTimeout(() => { stopPlayback(); status('Seam preview finished. Adjust the markers or play the loop.'); render(); }, (loopEnd - playOffset + Math.min(.75, playDuration / 2)) * 1000);
      render(); animate();
    } catch (error) { stopPlayback(); status(error.message || 'Playback could not start. Tap Play loop to retry.'); render(); }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function wav(audio) {
    const channels = audio.numberOfChannels, size = audio.length * channels * 2;
    const bytes = new ArrayBuffer(44 + size), data = new DataView(bytes);
    const text = (at, value) => [...value].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF');data.setUint32(4, 36 + size, true);text(8, 'WAVE');text(12, 'fmt ');
    data.setUint32(16, 16, true);data.setUint16(20, 1, true);data.setUint16(22, channels, true);
    data.setUint32(24, audio.sampleRate, true);data.setUint32(28, audio.sampleRate * channels * 2, true);
    data.setUint16(32, channels * 2, true);data.setUint16(34, 16, true);text(36, 'data');data.setUint32(40, size, true);
    const samples = Array.from({ length: channels }, (_, i) => audio.getChannelData(i));
    for (let i = 0; i < audio.length; i++) {
      for (let ch = 0; ch < channels; ch++) { const sample = Math.max(-1, Math.min(1, samples[ch][i])); data.setInt16(44 + (i * channels + ch) * 2, sample < 0 ? sample * 32768 : sample * 32767, true); }
      if (i && i % 131072 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }
  function folderCopy(snapshot, original, prompt = false) {
    // Authorization must start from the user action, before waiting on conversion.
    const authorized = prompt ? window.RecordingFolder.authorize() : Promise.resolve();
    authorized.catch(() => {});
    folderQueue = folderQueue.catch(() => {}).then(async () => {
      try {
        await authorized; await window.RecordingFolder.ready;
        if (!window.RecordingFolder.name) { if (record?.id === snapshot.id) $('folder-status').textContent = 'Saved inside the app. Choose a folder or download a WAV for an external copy.'; return; }
        const audio = await original;
        await window.RecordingFolder.write(`${snapshot.fileName}.wav`, audio);
        const metadata = { version: 1, name: snapshot.name, created: snapshot.created, start: snapshot.start, end: snapshot.end, duration: snapshot.duration, audioFile: `${snapshot.fileName}.wav` };
        await window.RecordingFolder.write(`${snapshot.fileName}.json`, new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), true);
        if (record?.id === snapshot.id) $('folder-status').textContent = `Saved to ${window.RecordingFolder.name}: ${snapshot.fileName}.wav`;
      } catch (error) { if (record?.id === snapshot.id) $('folder-status').textContent = `Folder copy pending: ${error.message || 'write failed'}. The local recording is kept; tap Save to folder to retry.`; }
    });
    return folderQueue;
  }
  async function persist(copy = true) {
    clearTimeout(saveTimer); if (!record) return false;
    const snapshot = { ...record }, version = editVersion;
    try {
      await LooperStore.save(snapshot);
      if (record?.id === snapshot.id && editVersion === version) { dirty = false; $('save-status').textContent = 'Saved on this device.'; }
      if (copy && buffer && record?.id === snapshot.id) {
        fullWav ||= wav(buffer); folderCopy(snapshot, fullWav);
      }
      activity(); return true;
    } catch {
      if (record?.id === snapshot.id) { dirty = true; $('save-status').textContent = 'Local save failed. Download this recording before leaving or recording another take.'; }
      return false;
    }
  }
  function changed() { dirty = true; activity(); editVersion++; $('save-status').textContent = 'Saving changes...'; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(), 350); }
  function adjust(edge, value) {
    if (!buffer || busy() || !Number.isFinite(value)) return;
    const playing = state === 'playing';
    if (edge === 'start') record.start = Math.max(0, Math.min(record.end - .05, value));
    else record.end = Math.min(buffer.duration, Math.max(record.start + .05, value));
    if (playing && source) {
      const position = playbackPosition();
      loopStart = record.start; loopEnd = record.end;
      source.loopStart = loopStart; source.loopEnd = loopEnd;
      playOffset = position >= loopEnd ? loopStart + (position - loopEnd) % (loopEnd - loopStart) : position;
      playStart = ctx.currentTime;
      clearTimeout(seamTimer);
    }
    selected = edge; changed(); render();
  }
  async function decodeCurrent(blob, token) {
    const decoded = await context().decodeAudioData(await blob.arrayBuffer());
    if (token !== operation) return;
    if (decoded.duration < .05 || decoded.duration > 185) throw new Error('Recording must be between 0.05 seconds and 3 minutes.');
    buffer = decoded; record.duration = buffer.duration;
    record.start = Math.max(0, Math.min(record.start || 0, buffer.duration - .05));
    record.end = Math.max(record.start + .05, Math.min(record.end || buffer.duration, buffer.duration));
    fullWav = null; viewStart = 0; zoom = 1; $('zoom').value = '1'; buildPeaks();
  }
  function fileName(id) { return `recording_${new Date().toISOString().replace(/[:.]/g, '-')}_${id.slice(0, 8)}`; }
  async function finishRecording(chunks, mime, token) {
    state = 'finishing'; cleanupInput(); cancelAnimationFrame(frame); render();
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) { state = 'idle'; status('No audio was captured. Check microphone access and try again.'); render(); return; }
    const id = crypto.randomUUID(), created = new Date().toISOString();
    record = { id, name: `Recording ${new Date().toLocaleString()}`, created, fileName: fileName(id), blob, start: 0, end: 0, duration: 0 };
    buffer = null; peaks = null; fullWav = null; dirty = true; editVersion++; $('name').value = record.name;
    // Store the original take before decoding or converting it.
    await persist(false);
    try {
      await decodeCurrent(blob, token); if (token !== operation) return;
      await persist(); status(recordingError || 'Recording ready. Drag the markers to choose your loop.');
    } catch (error) { status(`${error.message || 'Could not decode recording.'} The original take can still be downloaded.`); }
    finally { state = 'idle'; render(); }
  }
  function cancelCount() {
    clearTimeout(countTimer);
    for (const click of clicks) { try { click.stop(); } catch {} }
    clicks = []; countResolve?.(false); countResolve = null;
  }
  function countIn() {
    const beats = Number($('count-in').value);
    if (!beats) return Promise.resolve(true);
    state = 'counting'; render();
    const interval = 60 / Number($('bpm').value), start = ctx.currentTime + .08;
    for (let beat = 0; beat < beats; beat++) {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain(), at = start + beat * interval;
      oscillator.frequency.value = beat % 4 === 0 ? 1000 : 700;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.18, at + .002);
      gain.gain.exponentialRampToValueAtTime(.001, at + .045);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + .05); clicks.push(oscillator);
    }
    return new Promise(resolve => {
      countResolve = resolve;
      const tick = () => {
        const elapsed = ctx.currentTime - start;
        if (elapsed >= beats * interval) { clicks = []; countResolve = null; resolve(true); return; }
        status(`Count in: ${Math.max(1, Math.floor(elapsed / interval) + 1)} / ${beats}`);
        countTimer = setTimeout(tick, 10);
      };
      tick();
    });
  }
  function saveCountSettings() {
    $('bpm').value = String(Math.max(30, Math.min(300, Math.round(Number($('bpm').value) || 100))));
    try { localStorage.setItem('music-practice-player:count-in', JSON.stringify({ bpm: Number($('bpm').value), beats: Number($('count-in').value) })); } catch {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem('music-practice-player:count-in'));
    if (saved?.bpm >= 30 && saved.bpm <= 300) $('bpm').value = saved.bpm;
    if ([0, 4, 8].includes(saved?.beats)) $('count-in').value = saved.beats;
  } catch {}
  $('bpm').addEventListener('change', saveCountSettings);
  $('count-in').addEventListener('change', saveCountSettings);
  async function recordNew() {
    if (busy()) return;
    if (io.isBusy) { status('Finish or cancel the device test first.'); return; }
    io.stopTest();
    if (dirty && !await persist() && !confirm('The current recording is not saved. Discard it and record another take?')) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.isSecureContext) { status('Recording requires microphone support and HTTPS. Open the installed app or HTTPS website.'); return; }
    saveCountSettings();
    stopPlayback(); const token = ++operation; state = 'requesting'; recordingError = ''; status('Allow microphone access to start recording.'); render();
    try {
      await context().resume(); await io.prepareOutput();
      if (token !== operation) return;
      const input = await io.openInput();
      if (token !== operation || state !== 'requesting') { input.getTracks().forEach(track => track.stop()); return; }
      stream = input;
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks = []; let bytes = 0;
      recorder.addEventListener('dataavailable', event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; } if (bytes > 32 * 1024 * 1024 && recorder.state === 'recording') { recordingError = 'Recording stopped at the size limit.'; stopRecording(); } });
      recorder.addEventListener('error', () => { recordingError = 'Recording was interrupted. Any captured audio has been kept.'; stopRecording(); });
      recorder.addEventListener('stop', () => finishRecording(chunks, recorder.mimeType || chunks[0]?.type || 'audio/webm', token));
      input.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (['recording', 'counting'].includes(state)) { recordingError = 'Microphone disconnected. The captured take has been kept.'; stopRecording(); } }));
      inputNode = ctx.createMediaStreamSource(stream); analyser = ctx.createAnalyser(); analyser.fftSize = 1024; inputNode.connect(analyser);
      if (!await countIn() || token !== operation) return;
      recorder.start(500); state = 'recording'; recordStart = performance.now();
      limitTimer = setTimeout(() => { recordingError = 'Recording stopped at the 3-minute limit.'; stopRecording(); }, 180000);
      status('Recording microphone. Tap Stop when your phrase is complete.'); render(); animate();
    } catch (error) {
      if (token !== operation) return;
      cleanupInput(); state = 'idle'; status(error.name === 'NotAllowedError' ? 'Microphone permission denied. Allow it in browser settings and try again.' : `Could not start recording: ${error.message || error.name}`); render();
    }
  }
  function stopRecording() {
    if (['requesting', 'counting'].includes(state)) { operation++; cancelCount(); state = 'idle'; cleanupInput(); status('Recording cancelled.'); render(); return; }
    if (recorder?.state === 'recording') { state = 'finishing'; clearTimeout(limitTimer); recorder.stop(); cleanupInput(); render(); }
  }
  async function openSaved(id) {
    if (busy()) return;
    if (dirty && !await persist() && !confirm('Discard the unsaved take and open this recording?')) return;
    stopPlayback(); state = 'loading'; const token = ++operation; render();
    try {
      const saved = await LooperStore.read(id); if (!saved) throw new Error('Recording not found.');
      record = saved; buffer = null; peaks = null; fullWav = null; dirty = false; $('name').value = record.name;
      await decodeCurrent(record.blob, token); $('library').close(); $('save-status').textContent = 'Saved recording restored.';
      $('folder-status').textContent = 'Use Save to folder to retry an external copy, or download a WAV.';
      status('Adjust the markers or tap Play loop.');
    } catch (error) { status(error.message || 'Could not open recording.'); }
    finally { state = 'idle'; render(); }
  }
  async function library() {
    if (busy()) return;
    stopPlayback(); render();
    $('library').showModal(); $('library-list').replaceChildren(); $('library-status').textContent = 'Loading recordings...';
    try {
      const records = (await LooperStore.list()).sort((a, b) => b.created.localeCompare(a.created));
      const total = records.reduce((sum, item) => sum + item.bytes, 0);
      $('library-status').textContent = `${records.length} recording(s) - ${(total / 1024 / 1024).toFixed(1)} MB stored locally`;
      for (const item of records) {
        const row = document.createElement('div'), open = document.createElement('button'), remove = document.createElement('button');
        open.type = remove.type = 'button'; open.textContent = `${item.name} - ${time(item.duration)}`; remove.textContent = 'Delete';
        open.addEventListener('click', () => openSaved(item.id));
        remove.addEventListener('click', async () => {
          if (!confirm(`Delete "${item.name}" from this app? Files already saved to a folder are kept.`)) return;
          try { if (record?.id === item.id) clearTimeout(saveTimer); await LooperStore.remove(item.id); if (record?.id === item.id) { stopPlayback(); record = null; buffer = null; peaks = null; fullWav = null; dirty = false; $('name').value = ''; render(); } row.remove(); $('library-status').textContent = 'Recording deleted from the app.'; }
          catch { $('library-status').textContent = 'Could not delete this recording.'; }
        });
        row.append(open, remove); $('library-list').append(row);
      }
    } catch { $('library-status').textContent = 'Could not read recordings. Check available browser storage.'; }
  }
  function setMode(mode) {
    if (mode === 'practice' && busy()) { status('Tap Stop and wait for the recording to finish before switching modes.'); return; }
    if (mode === 'looper') document.dispatchEvent(new Event('practicepause'));
    else { io.stopTest(); stopPlayback(); if (dirty) persist(); }
    document.body.dataset.appMode = mode; $('panel').hidden = mode !== 'looper';
    for (const name of ['practice', 'looper']) document.getElementById(`mode-${name}`).setAttribute('aria-pressed', String(name === mode));
    document.dispatchEvent(new Event('appmodechange')); render();
  }
  document.getElementById('mode-practice').addEventListener('click', () => setMode('practice'));
  document.getElementById('mode-looper').addEventListener('click', () => setMode('looper'));
  $('record').addEventListener('click', recordNew);
  $('stop').addEventListener('click', () => { if (['recording', 'requesting', 'counting'].includes(state)) stopRecording(); else { stopPlayback(); status('Loop stopped.'); render(); } });
  $('play').addEventListener('click', () => play()); $('seam').addEventListener('click', () => play(true));
  $('saved').addEventListener('click', library); $('library-close').addEventListener('click', () => $('library').close());
  $('name').addEventListener('input', () => { if (record) { record.name = $('name').value.trim() || 'Untitled recording'; changed(); } });
  for (const edge of ['start', 'end']) { $(`select-${edge}`).addEventListener('click', () => { selected = edge; render(); }); $(edge).addEventListener('change', () => adjust(edge, Number($(edge).value))); }
  $('earlier').addEventListener('click', () => adjust(selected, record[selected] - Number($('step').value)));
  $('later').addEventListener('click', () => adjust(selected, record[selected] + Number($('step').value)));
  $('zoom').addEventListener('change', () => { zoom = Number($('zoom').value); viewStart = Math.max(0, record[selected] - buffer.duration / zoom / 2); render(); });
  $('pan').addEventListener('input', () => { viewStart = Number($('pan').value); draw(); });
  function drag(event) {
    const rect = canvas.getBoundingClientRect(), v = frozenView || view();
    adjust(selected, v.start + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * v.span);
  }
  function syncZoom() {
    let option = $('zoom').querySelector('[data-pinch]');
    if (!option) { option = new Option(); option.dataset.pinch = ''; $('zoom').add(option); }
    option.value = String(zoom); option.textContent = `${zoom.toFixed(1)}x`; $('zoom').value = String(zoom);
  }
  canvas.addEventListener('pointerdown', event => {
    if (!buffer || busy() || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) frozenView = null;
    const rect = canvas.getBoundingClientRect(), v = view();
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { distance: Math.max(1, Math.hypot(a.x-b.x, a.y-b.y)), zoom,
        anchor: v.start + ((a.x+b.x)/2-rect.left)/rect.width*v.span };
      pointer = null; frozenView = null; suppressGesture = true; return;
    }
    if (touches.size !== 1 || suppressGesture) return;
    const startX = (record.start-v.start)/v.span*rect.width, endX = (record.end-v.start)/v.span*rect.width, x = event.clientX-rect.left;
    const near = Math.min(Math.abs(startX-x), Math.abs(endX-x)) < 24;
    if (near) selected = Math.abs(startX-x) <= Math.abs(endX-x) ? 'start' : 'end';
    frozenView = { ...v }; pointer = event.pointerId;
    gesture = { x: event.clientX, pan: event.pointerType === 'touch' && !near };
    if (event.pointerType !== 'touch') drag(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) {
      const [a,b] = [...touches.values()], rect = canvas.getBoundingClientRect();
      zoom = Math.max(1, Math.min(16, pinch.zoom * Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
      viewStart = pinch.anchor - ((a.x+b.x)/2-rect.left)/rect.width*buffer.duration/zoom;
      syncZoom(); render(); return;
    }
    if (pointer !== event.pointerId || suppressGesture) return;
    if (gesture.pan) { viewStart = frozenView.start - (event.clientX-gesture.x)/canvas.clientWidth*frozenView.span; const previous = frozenView; frozenView = null; draw(); frozenView = previous; }
    else drag(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (!touches.has(event.pointerId)) return;
    touches.delete(event.pointerId); pointer = null; frozenView = null; pinch = null;
    if (!touches.size) { suppressGesture = false; gesture = null; }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    render();
  });
  for (const type of ['loop', 'full']) $(`export-${type}`).addEventListener('click', async () => {
    if (!record || busy()) return;
    const item = record;
    try {
      if (!buffer) { download(item.blob, `${item.fileName}.${item.blob.type.includes('mp4') ? 'm4a' : item.blob.type.includes('ogg') ? 'ogg' : 'webm'}`); return; }
      const blob = type === 'loop' ? await wav(trimmed()) : await (fullWav ||= wav(buffer));
      download(blob, `${item.fileName}${type === 'loop' ? '_loop' : ''}.wav`);
    } catch { status('Could not prepare the download. Try again.'); }
  });
  $('folder').addEventListener('click', () => document.getElementById('recording-choose').click());
  new MutationObserver(() => { $('folder-status').textContent = document.getElementById('recording-status').textContent; }).observe(document.getElementById('recording-status'), { childList: true, subtree: true });
  $('folder-save').addEventListener('click', () => { if (record && buffer && !busy()) { fullWav ||= wav(buffer); folderCopy({ ...record }, fullWav, true); } });
  document.addEventListener('keydown', event => {
    if (document.body.dataset.appMode !== 'looper' || event.target.closest('input,select,textarea,button,dialog') || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) { if (state === 'playing') { stopPlayback(); render(); } else play(); } }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      if (state === 'recording') { recordingError = 'Recording stopped because the app left the screen. The captured take has been kept.'; stopRecording(); }
      else if (['requesting', 'counting'].includes(state)) stopRecording();
      stopPlayback(); if (dirty) persist(); render();
    }
  });
  window.addEventListener('pagehide', () => { if (['recording', 'requesting', 'counting'].includes(state)) stopRecording(); cleanupInput(); stopPlayback(); });
  window.addEventListener('beforeunload', event => { if (busy() || dirty) { event.preventDefault(); event.returnValue = ''; } });
  new ResizeObserver(draw).observe(canvas);
  render();
})();
