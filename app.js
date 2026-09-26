"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const speeds = [0.5, 0.75, 0.9, 1, 1.1, 1.25];
  const storagePrefix = "music-practice-player:v1:";
  const ui = Object.fromEntries([
    "open-file", "file-input", "filename", "file-hint", "current-time", "duration",
    "seek", "back", "forward", "play", "play-label", "play-icon", "speed", "status",
    "storage-warning", "cues", "drop-overlay",
  ].map((id) => [id, $(id)]));
  let audio = null;
  let objectURL = null;
  let filename = "";
  let ready = false;
  let cues = Array(9).fill(null);
  let frame = 0;
  let dragDepth = 0;
  const cards = [];
  let selectedLyricTime = null;
  const quickButtons = Array.from({ length: 9 }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => jumpCue(index));
    $('quick-cues').append(button);
    return button;
  });

  function renderQuickCues() {
    const next = cues.findIndex(cue => !cue);
    $('save-next-cue').disabled = !ready || next < 0;
    $('save-next-cue').textContent = next < 0 ? 'All 9 cues saved' : `Save cue ${next + 1}`;
    $('use-current-time').hidden = selectedLyricTime === null;
    $('cue-selection').textContent = selectedLyricTime === null
      ? 'Save current position - or tap a timed lyric'
      : `Selected lyric - ${formatTime(selectedLyricTime)}`;
    quickButtons.forEach((button, index) => {
      const cue = cues[index];
      button.hidden = !cue;
      button.disabled = !ready;
      button.textContent = `${index + 1} - ${cue?.name || (cue ? formatTime(cue.time) : '')}`;
      button.setAttribute('aria-label', `Jump to cue ${index + 1}${cue ? ', ' + formatTime(cue.time) : ''}`);
    });
  }

  function clearLyricSelection() {
    selectedLyricTime = null;
    document.querySelectorAll('.lyric-line.selected').forEach(node => {
      node.classList.remove('selected'); node.setAttribute('aria-pressed', 'false');
    });
    renderQuickCues();
  }

  $('use-current-time').addEventListener('click', clearLyricSelection);
  $('lyrics-text').addEventListener('lyricschanged', clearLyricSelection);
  $('save-next-cue').addEventListener('click', () => {
    const next = cues.findIndex(cue => !cue);
    if (!ready || next < 0) return;
    setCue(next, selectedLyricTime ?? audio.currentTime);
    clearLyricSelection();
    $('cue-selection').textContent = `Cue ${next + 1} saved at ${formatTime(cues[next].time)}. Select the next verse.`;
  });

  function formatTime(seconds) {
    const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
    return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
  }

  function announce(message, error = false) {
    ui.status.textContent = message;
    ui.status.classList.toggle("error", error);
  }

  function warnStorage(message) {
    ui["storage-warning"].textContent = message;
    ui["storage-warning"].hidden = !message;
  }

  function restoreCues() {
    warnStorage("");
    try {
      const stored = localStorage.getItem(storagePrefix + filename);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed.version !== 1 || !Array.isArray(parsed.cues)) throw new Error("Invalid cues");
      cues = Array.from({ length: 9 }, (_, index) => {
        const cue = parsed.cues[index];
        return cue && Number.isFinite(cue.time) && cue.time >= 0 && cue.time <= audio.duration
          ? { time: cue.time, name: typeof cue.name === "string" ? cue.name.slice(0, 100) : "" }
          : null;
      });
    } catch {
      warnStorage("Saved cues could not be read. You can still practice and set new cues.");
    }
  }

  function persistCues() {
    try {
      localStorage.setItem(storagePrefix + filename, JSON.stringify({ version: 1, cues }));
      warnStorage("");
    } catch {
      warnStorage("Cue changes are only available for this session: browser storage is unavailable or full.");
    }
  }

  function renderCue(index) {
    const cue = cues[index];
    const card = cards[index];
    card.root.classList.toggle("assigned", !!cue);
    card.time.textContent = cue ? formatTime(cue.time) : "Not set yet";
    card.time.classList.toggle("cue-empty", !cue);
    card.jump.disabled = !ready || !cue;
    card.jump.setAttribute("aria-label", cue ? `Jump to cue ${index + 1}, ${formatTime(cue.time)}${cue.name ? `, ${cue.name}` : ""}` : `Cue ${index + 1}, not set`);
    card.name.disabled = !ready || !cue;
    card.name.value = cue ? cue.name : "";
    card.set.disabled = !ready;
    card.set.textContent = `${cue ? "Update" : "Set"} · Shift + ${index + 1}`;
    card.reset.disabled = !ready || !cue;
    renderQuickCues();
  }

  function flashCue(index) {
    const card = cards[index];
    clearTimeout(card.timer);
    card.root.classList.add("flash");
    card.timer = setTimeout(() => card.root.classList.remove("flash"), 300);
  }

  function setCue(index, time = audio.currentTime) {
    if (!ready) return;
    cues[index] = { time: Math.max(0, Math.min(audio.duration, time)), name: cues[index]?.name || "" };
    renderCue(index);
    persistCues();
    flashCue(index);
    announce(`Cue ${index + 1} set at ${formatTime(cues[index].time)}.`);
  }

  function jumpCue(index) {
    if (!ready || !cues[index]) return;
    // Setting currentTime alone preserves the current play/pause state.
    seekTo(cues[index].time);
    flashCue(index);
    announce(`Cue ${index + 1}${cues[index].name ? ` · ${cues[index].name}` : ""}.`);
  }

  for (let index = 0; index < 9; index++) {
    const root = document.createElement("article");
    root.className = "cue-card";
    root.innerHTML = `<button class="cue-jump" type="button" disabled><span class="cue-number">${index + 1}</span><span class="cue-time cue-empty">Not set yet</span></button>
      <input class="cue-name" type="text" maxlength="100" placeholder="Name this section…" aria-label="Cue ${index + 1} name" autocomplete="off" spellcheck="false" disabled>
      <div class="cue-actions"><button class="cue-set" type="button" disabled>Set · Shift + ${index + 1}</button><button class="cue-reset" type="button" aria-label="Reset cue ${index + 1}" disabled>Reset</button></div>`;
    const card = {
      root, jump: root.querySelector(".cue-jump"), time: root.querySelector(".cue-time"),
      name: root.querySelector(".cue-name"), set: root.querySelector(".cue-set"),
      reset: root.querySelector(".cue-reset"), timer: 0,
    };
    card.jump.addEventListener("click", () => jumpCue(index));
    card.set.addEventListener("click", () => setCue(index));
    card.reset.addEventListener("click", () => {
      cues[index] = null;
      renderCue(index);
      persistCues();
      announce(`Cue ${index + 1} cleared.`);
    });
    card.name.addEventListener("input", () => {
      if (!cues[index]) return;
      cues[index].name = card.name.value;
      renderQuickCues();
      card.jump.setAttribute("aria-label", `Jump to cue ${index + 1}, ${formatTime(cues[index].time)}, ${card.name.value}`);
      persistCues();
    });
    card.name.addEventListener("keydown", (event) => {
      if (!event.isComposing && (event.key === "Enter" || event.key === "Escape")) {
        event.preventDefault();
        card.name.blur();
      }
    });
    cards.push(card);
    ui.cues.append(root);
    renderCue(index);
  }

  function renderPosition() {
    const time = ready ? audio.currentTime : 0;
    ui["current-time"].textContent = formatTime(time);
    ui.seek.value = String(time);
    ui.seek.setAttribute("aria-valuetext", formatTime(time));
    ui.seek.style.setProperty("--progress", `${ready ? time / audio.duration * 100 : 0}%`);
    window.LyricsPanel.update(time, ready ? audio.duration : 0);
    window.Waveform.update(time, ready ? audio.duration : 0);
  }

  function tick() {
    renderPosition();
    if (ready && !audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
  }

  function renderPlayback() {
    const playing = ready && !audio.paused && !audio.ended;
    ui["play-label"].textContent = playing ? "Pause" : "Play";
    ui["play-icon"].textContent = playing ? "Ⅱ" : "▶";
    ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    cancelAnimationFrame(frame);
    renderPosition();
    if (playing) frame = requestAnimationFrame(tick);
  }

  function setReady(value) {
    ready = value;
    for (const id of ["play", "back", "forward", "seek", "speed"]) ui[id].disabled = !value;
    cards.forEach((_, index) => renderCue(index));
    renderPlayback();
  }

  function seekTo(time) {
    if (!ready || !Number.isFinite(time)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, time));
    renderPosition();
  }

  async function togglePlayback() {
    if (!ready) return;
    const current = audio;
    if (!current.paused) {
      current.pause();
      return;
    }
    try {
      await current.play();
    } catch (error) {
      if (current === audio && error.name !== "AbortError") announce("Playback could not start. Try opening the file again.", true);
    }
  }

  function changeSpeed(value) {
    if (!ready) return;
    audio.playbackRate = value;
    ui.speed.value = String(value);
  }

  function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|aiff?|weba)$/i.test(file.name)) {
      announce("Choose an audio file, such as MP3, WAV, or M4A.", true);
      return;
    }
    const previous = audio;
    const current = new Audio();
    audio = current; // Events and play promises from a replaced file must not update this track.
    if (previous) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(file);
    filename = file.name;
    window.LyricsPanel.reset();
    window.Waveform.reset();
    cues = Array(9).fill(null);
    cards.forEach((card) => { clearTimeout(card.timer); card.root.classList.remove("flash"); });
    warnStorage("");
    ui.filename.textContent = filename;
    ui.filename.title = filename;
    ui["file-hint"].textContent = "Local file · Drop another song to replace it";
    ui.duration.textContent = "00:00.0";
    ui.seek.max = "0";
    ui.speed.value = "1";
    setReady(false);
    announce("Loading audio…");
    current.preload = "auto";
    if ("preservesPitch" in current) current.preservesPitch = true;
    current.addEventListener("loadedmetadata", () => {
      if (current !== audio) return;
      if (!Number.isFinite(current.duration) || current.duration <= 0) {
        announce("This file has no playable duration. Try another audio file.", true);
        return;
      }
      ui.duration.textContent = formatTime(current.duration);
      ui.seek.max = String(current.duration);
      restoreCues();
      setReady(true);
      window.LyricsPanel.load(file, current.duration);
      window.Waveform.load(file, current.duration);
      const count = cues.filter(Boolean).length;
      announce(count ? `${count} saved cue${count === 1 ? "" : "s"} restored. Press Space to play.` : "Press Space to play. Set your first cue with Shift + 1.");
    });
    for (const event of ["play", "pause", "ended"]) current.addEventListener(event, () => { if (current === audio) renderPlayback(); });
    for (const event of ["timeupdate", "seeked"]) current.addEventListener(event, () => { if (current === audio) renderPosition(); });
    current.addEventListener("error", () => {
      if (current !== audio) return;
      setReady(false);
      announce("This audio file could not be played. Try another file or a different audio format.", true);
    });
    current.src = objectURL;
    current.load();
  }

  ui["open-file"].addEventListener("click", () => ui["file-input"].click());
  ui["file-input"].addEventListener("change", () => {
    loadFile(ui["file-input"].files[0]);
    ui["file-input"].value = "";
  });
  ui.play.addEventListener("click", togglePlayback);
  ui.back.addEventListener("click", () => seekTo(audio.currentTime - 2));
  ui.forward.addEventListener("click", () => seekTo(audio.currentTime + 2));
  ui.seek.addEventListener("input", () => seekTo(Number(ui.seek.value)));
  document.getElementById('waveform').addEventListener('waveformseek', (event) => {
    if (ready) seekTo(event.detail * audio.duration);
  });
  document.getElementById('lyrics-text').addEventListener('lyricsseek', (event) => {
    seekTo(event.detail);
    if (ready && Number.isFinite(event.detail)) {
      selectedLyricTime = Math.max(0, Math.min(audio.duration, event.detail));
      renderQuickCues();
    }
  });
  ui.speed.addEventListener("change", () => changeSpeed(Number(ui.speed.value)));

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      target.closest('input:not([type="range"]), textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
    const space = event.code === "Space" || event.key === " ";
    const arrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const fine = event.key === "[" || event.key === "]";
    const speed = event.key === "-" || event.key === "=";
    const beginning = event.key === "`" || (event.code === "Backquote" && !event.shiftKey);
    if (!digit && !space && !arrow && !fine && !speed && !beginning) return;
    event.preventDefault();
    if (!ready) return;
    if (beginning) {
      seekTo(0);
    } else if (digit) {
      const index = Number(digit[1]) - 1;
      if (event.shiftKey) { if (!event.repeat) setCue(index); }
      else jumpCue(index);
    } else if (space) {
      if (!event.repeat) togglePlayback();
    } else if (arrow) {
      seekTo(audio.currentTime + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 2));
    } else if (fine) {
      if (audio.paused) seekTo(audio.currentTime + (event.key === "[" ? -0.5 : 0.5));
    } else {
      const index = speeds.indexOf(Number(ui.speed.value));
      changeSpeed(speeds[Math.max(0, Math.min(speeds.length - 1, index + (event.key === "-" ? -1 : 1)))]);
    }
  });

  const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const hideDrop = () => { dragDepth = 0; ui["drop-overlay"].hidden = true; };
  document.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    ui["drop-overlay"].hidden = false;
  });
  document.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideDrop();
  });
  document.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    hideDrop();
    loadFile(event.dataTransfer.files[0]);
  });
  window.addEventListener("blur", hideDrop);
  document.addEventListener("dragend", hideDrop);
})();
