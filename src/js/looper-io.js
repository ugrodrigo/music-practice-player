"use strict";

// Device selection applies to the looper, its count-in, and its output test.
window.LooperAudioIO = class {
  constructor(getContext) {
    this.context = getContext;
    this.el = id => document.getElementById(`io-${id}`);
    this.input = this.output = '';
    this.labels = {};
    this.epoch = 0;
    this.locked = this.pending = false;
    this.outputSupported = typeof AudioContext.prototype.setSinkId === 'function';
    try {
      const saved = JSON.parse(localStorage.getItem('music-practice-player:audio-io'));
      this.input = typeof saved?.input === 'string' ? saved.input : '';
      this.output = this.outputSupported && typeof saved?.output === 'string' ? saved.output : '';
      this.labels = saved?.labels || {};
    } catch {}
    for (const type of ['input', 'output']) this.el(type).addEventListener('change', () => {
      this.stopTest(); this[type] = this.el(type).value;
      this.labels[type] = this.el(type).selectedOptions[0]?.textContent || '';
      this.save(); this.message('Selection saved. Test the devices before recording.');
    });
    this.el('refresh').addEventListener('click', () => this.find());
    this.el('test-input').addEventListener('click', () => this.testInput());
    this.el('test-output').addEventListener('click', () => this.testOutput());
    this.el('choose-output').hidden = !this.outputSupported || !navigator.mediaDevices?.selectAudioOutput;
    this.el('choose-output').addEventListener('click', () => this.chooseOutput());
    navigator.mediaDevices?.addEventListener('devicechange', () => this.refresh());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stopTest(); });
    window.addEventListener('pagehide', () => this.stopTest());
    this.refresh();
  }
  message(text) { this.el('status').textContent = text; }
  save() { try { localStorage.setItem('music-practice-player:audio-io', JSON.stringify({ input: this.input, output: this.output, labels: this.labels })); } catch {} }
  lock(value) {
    this.locked = value;
    for (const id of ['input', 'output', 'refresh', 'choose-output', 'test-output']) this.el(id).disabled = value || this.pending || !!this.testStream;
    this.el('output').disabled ||= !this.outputSupported;
    this.el('test-input').disabled = value;
    this.el('test-input').textContent = this.pending || this.testStream ? 'Stop test' : 'Test input';
  }
  get isBusy() { return this.pending; }
  stopTest() {
    this.epoch++; this.pending = false;
    this.testStream?.getTracks().forEach(t => t.stop()); this.testStream = null;
    this.node?.disconnect(); this.node = null;
    this.analyser?.disconnect(); this.analyser = null;
    if (this.tone) { try { this.tone.stop(); } catch {} this.tone = null; }
    cancelAnimationFrame(this.frame); this.el('meter').value = 0;
    this.lock(this.locked);
  }
  async refresh() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const type of ['input', 'output']) {
        const select = this.el(type), kind = type === 'input' ? 'audioinput' : 'audiooutput';
        select.replaceChildren(new Option('System default', ''));
        for (const d of devices.filter(d => d.kind === kind && d.deviceId)) select.add(new Option(d.label || `${type === 'input' ? 'Microphone' : 'Output'} ${select.options.length}`, d.deviceId));
        if (this[type] && ![...select.options].some(o => o.value === this[type])) {
          select.add(new Option(`${this.labels[type] || 'Saved device'} (unavailable)`, this[type]));
          this.message('A selected device is unavailable or needs permission. Reconnect it or choose another device.');
        }
        select.value = this[type];
      }
      if (!this.outputSupported) this.message('Output selection is unavailable here. Choose your headphones in Android sound settings. Microphone selection is independent when exposed by the browser.');
    } catch { this.message('Could not list devices. Use HTTPS and allow microphone access.'); }
    this.lock(this.locked);
  }
  async openInput() {
    const input = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(this.input ? { deviceId: { exact: this.input } } : {}),
      channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false
    } });
    const track = input.getAudioTracks()[0];
    const actual = track?.getSettings().deviceId;
    if (this.input && !['default', 'communications'].includes(this.input) && actual && actual !== this.input) {
      input.getTracks().forEach(t => t.stop());
      throw new Error('The browser selected a different microphone. Choose and test another input.');
    }
    this.el('active').textContent = `Microphone: ${track?.label || 'System default (name unavailable)'}`;
    return input;
  }
  async prepareOutput() {
    const ctx = this.context();
    if (!this.outputSupported) return;
    try { await ctx.setSinkId(this.output); }
    catch { throw new Error('Selected output is unavailable or not authorized. Choose another output or System default.'); }
  }
  async find() {
    if (this.locked || this.pending) return;
    this.stopTest(); const token = this.epoch; this.pending = true; this.lock(false);
    try {
      // Permission reveals device names; probing never records or monitors audio.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(t => t.stop());
      if (token !== this.epoch) return;
      this.message('Devices refreshed. Select your microphone and output, then test them.'); await this.refresh();
    } catch (error) { if (token === this.epoch) this.message(`Device access failed: ${error.message}`); }
    finally { if (token === this.epoch) { this.pending = false; this.lock(this.locked); } }
  }
  async testInput() {
    if (this.locked) return;
    if (this.pending || this.testStream) { this.stopTest(); this.message('Input test stopped.'); return; }
    this.stopTest(); const token = this.epoch; this.pending = true; this.lock(false);
    try {
      const ctx = this.context(); await ctx.resume();
      const input = await this.openInput();
      if (token !== this.epoch) { input.getTracks().forEach(t => t.stop()); return; }
      this.testStream = input; this.pending = false;
      this.node = ctx.createMediaStreamSource(input); this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
      this.node.connect(this.analyser); // Deliberately no connection to speakers.
      input.getAudioTracks()[0].addEventListener('ended', () => { if (this.testStream === input) { this.stopTest(); this.message('Microphone disconnected. Choose another input.'); } });
      const samples = new Float32Array(1024);
      const draw = () => { if (!this.analyser) return; this.analyser.getFloatTimeDomainData(samples); this.el('meter').value = Math.min(1, Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0)/samples.length)*3); this.frame = requestAnimationFrame(draw); };
      draw(); this.message('Speak or tap near your microphone and watch the meter. Nothing is being recorded.');
      await this.refresh();
    } catch (error) { if (token === this.epoch) { this.stopTest(); this.message(`Input test failed: ${error.message}. Check the selected microphone.`); } }
    finally { if (token === this.epoch) { this.pending = false; this.lock(this.locked); } }
  }
  async testOutput() {
    if (this.locked || this.pending) return;
    this.stopTest(); const token = this.epoch; this.pending = true; this.lock(false);
    try {
      const ctx = this.context(); await ctx.resume(); await this.prepareOutput();
      if (token !== this.epoch) return;
      const tone = ctx.createOscillator(), gain = ctx.createGain(), now = ctx.currentTime;
      tone.frequency.value = 660; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.1, now+.01); gain.gain.linearRampToValueAtTime(0, now+.3);
      tone.connect(gain); gain.connect(ctx.destination); this.tone = tone;
      tone.onended = () => { tone.disconnect(); gain.disconnect(); if (this.tone === tone) this.tone = null; };
      tone.start(); tone.stop(now+.31); this.message('Test tone sent to the selected output. Confirm where you heard it.');
    } catch (error) { if (token === this.epoch) this.message(error.message); }
    finally { if (token === this.epoch) { this.pending = false; this.lock(this.locked); } }
  }
  async chooseOutput() {
    if (this.locked || this.pending) return;
    this.stopTest(); const token = this.epoch; this.pending = true; this.lock(false);
    try {
      const device = await navigator.mediaDevices.selectAudioOutput({ deviceId: this.output });
      if (token !== this.epoch) return;
      this.output = device.deviceId; this.labels.output = device.label; this.save();
      await this.prepareOutput(); await this.refresh(); this.message('Output selected. Use Test output to check it.');
    } catch (error) { if (token === this.epoch) this.message(`Output selection: ${error.message}`); }
    finally { if (token === this.epoch) { this.pending = false; this.lock(this.locked); } }
  }
};
