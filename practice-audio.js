"use strict";

// Practice uses Signalsmith exclusively; the media element only reads metadata.
window.PracticeAudio = class extends EventTarget {
  constructor(native, file) {
    super();
    this.native = native; this.file = file;
    this.position = 0; this.anchor = 0; this.stopped = true;
    this.version = 0; this.playVersion = 0; this.disposed = false; this.preparing = null;
    for (const name of ['loadedmetadata', 'error']) native.addEventListener(name, () => { if (!this.disposed) this.emit(name); });
  }

  emit(name) { this.dispatchEvent(new Event(name)); }
  get duration() { return this.native.duration; }
  get paused() { return this.stopped; }
  get ended() { return this.position >= this.duration && this.stopped; }
  get currentTime() {
    return Math.max(0, Math.min(Number.isFinite(this.duration) ? this.duration : 0, this.position + (this.stopped ? 0 : Math.max(0, this.context.currentTime - this.anchor) * this.playbackRate)));
  }
  set currentTime(value) {
    this.position = Math.max(0, Math.min(this.duration, value)); this.anchor = this.context?.currentTime || 0;
    this.node?.schedule({ input: this.position, rate: this.playbackRate, active: !this.stopped });
    this.emit('seeked');
  }
  get playbackRate() { return this.native.playbackRate; }
  set playbackRate(value) {
    const time = this.currentTime;
    this.native.playbackRate = value;
    if (this.node) {
      this.position = time; this.anchor = this.context?.currentTime || 0;
      this.node.schedule({ input: time, rate: value, active: !this.stopped });
    }
  }
  get volume() { return this.native.volume; }
  set volume(value) { this.native.volume = value; if (this.gain) this.gain.gain.setTargetAtTime(value, this.context.currentTime, .008); }
  set preservesPitch(value) { this.native.preservesPitch = value; }
  get preservesPitch() { return this.native.preservesPitch; }
  set preload(value) { this.native.preload = value; }
  set src(value) { this.native.src = value; }
  load() { this.native.load(); }
  removeAttribute(name) { this.native.removeAttribute(name); if (name === 'src') this.dispose(); }
  async prepare() {
    if (this.node) { await this.context.resume(); return; }
    if (!isSecureContext || !window.AudioWorkletNode || !window.SignalsmithStretch) throw Error('Signalsmith needs HTTPS or localhost and AudioWorklet support.');
    if (this.file.size > 50 * 1024 * 1024 || this.duration > 600) throw Error('Playback supports songs up to 10 minutes and 50 MB. Please open a shorter or smaller file.');
    const ctx = this.context = new AudioContext({ latencyHint: 'playback' });
    await ctx.resume();
    const check = () => { if (this.disposed || this.context !== ctx) throw new DOMException('Track replaced', 'AbortError'); };
    try {
      const decoded = await ctx.decodeAudioData(await this.file.arrayBuffer()); check();
      if (decoded.numberOfChannels > 2 || decoded.length * decoded.numberOfChannels * 4 > 128 * 1024 * 1024) throw Error('Playback supports mono/stereo audio up to 128 MB decoded. Please open a smaller file.');
      const node = await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [decoded.numberOfChannels] }); check();
      const gain = ctx.createGain(); gain.gain.value = this.volume; node.connect(gain); gain.connect(ctx.destination);
      node.addEventListener('processorerror', () => this.fail());
      const buffers = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c).slice());
      await node.addBuffers(buffers, buffers.map(b => b.buffer)); check();
      this.node = node; this.gain = gain;
    } catch (error) { if (this.context === ctx) this.releaseEngine(); else ctx.close().catch(() => {}); throw error; }
  }
  async initialize() {
    if (this.preparing) return this.preparing;
    this.dispatchEvent(new CustomEvent('enginestatus', { detail: 'Preparing audio...' }));
    this.preparing = (async () => {
      let timer;
      try {
        await Promise.race([this.prepare(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Audio preparation timed out. Press Play to retry.')), 20000); })]);
        if (!this.disposed) this.dispatchEvent(new CustomEvent('enginestatus', { detail: '' }));
      } catch (error) { this.releaseEngine(); throw error; }
      finally { clearTimeout(timer); this.preparing = null; }
    })();
    return this.preparing;
  }
  async play() {
    if (this.disposed) return;
    const token = ++this.playVersion;
    try { await this.initialize(); }
    catch (error) { if (this.disposed || token !== this.playVersion) return; throw error; }
    if (this.disposed || token !== this.playVersion) return;
    if (!this.stopped) return;
    if (this.position >= this.duration) this.position = 0;
    this.anchor = this.context?.currentTime || 0; this.stopped = false;
    this.gain.gain.setValueAtTime(this.volume, this.anchor);
    this.node.schedule({ input: this.position, rate: this.playbackRate, semitones: 0, active: true });
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.currentTime >= this.duration) { this.pause(); this.position = this.duration; this.emit('ended'); }
      else this.emit('timeupdate');
    }, 30);
    this.emit('play');
  }
  pause() {
    this.playVersion++;
    this.position = this.currentTime; this.stopped = true; clearInterval(this.timer);
    this.node?.stop();
    this.gain?.gain.setValueAtTime(0, this.context.currentTime);
    this.emit('pause');
  }
  fail() {
    if (this.disposed) return;
    this.pause(); this.releaseEngine();
    this.dispatchEvent(new CustomEvent('engineerror', { detail: 'Audio processing stopped unexpectedly. Press Play to retry.' }));
  }
  releaseEngine() {
    clearInterval(this.timer);
    this.node?.disconnect(); this.node?.port.close(); this.node = null;
    this.gain?.disconnect(); this.gain = null;
    this.context?.close().catch(() => {}); this.context = null;
  }
  dispose() { this.pause(); this.disposed = true; this.version++; this.releaseEngine(); this.file = null; }
};
