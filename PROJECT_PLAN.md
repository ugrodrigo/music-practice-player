# Music Practice Player — Project Plan

## Objective

Build a reliable practice workflow: load a local song, set cues while listening, and jump between them instantly using the keyboard.

Implementation is complete in `index.html`, `style.css`, `app.js`, and `README.md`. Automated checks in headless Edge verified the core workflow with a generated WAV file, including persistence after reloading the local page. Manual listening checks, Chrome validation, and MP3/M4A samples remain to be verified; see the README acceptance test.

## 1. Scope and file structure

Build a desktop-first app using HTML, CSS, and vanilla JavaScript, with no dependencies, build tools, backend, or network requests.

| File | Responsibility |
|---|---|
| `index.html` | Audio loading, playback controls, seek bar, nine cue slots, shortcut guide |
| `style.css` | Dark theme, large playback clock, accessible controls, cue highlighting |
| `app.js` | Audio playback, keyboard handling, cue management, local persistence |
| `README.md` | Opening the app, controls, shortcuts, persistence, testing instructions |

The app must run by opening `index.html` directly in Chrome or Edge. Use a regular script rather than modules that could require a local server.

## 2. Implementation phases

### Phase 1: Local audio loading and playback

- Support drag-and-drop and an “Open audio file” button.
- Play the selected file through a native audio element using an object URL.
- Show filename, current time, duration, and a seek bar.
- Display time with tenths of a second.
- Add Play/Pause and backward/forward buttons.
- Disable audio-dependent controls until the file is ready.
- Handle unsupported or unreadable files with a clear message.
- Release the previous object URL when replacing a file.

**Completion check:** A local file loads through either method, plays, pauses, and seeks correctly without uploading anything.

### Phase 2: Nine cue slots—the core feature

Each slot will show its number, saved timestamp, editable name, and reset button. Empty slots will be clearly marked.

- Save the current position with `Shift + 1–9`.
- Jump with `1–9` or by clicking an assigned cue.
- Preserve playback state during every cue jump.
- Briefly highlight the destination cue.
- Keep name editing and reset actions from triggering a jump.
- Treat a cue at `00:00.0` as valid.
- Make unassigned shortcuts harmless.
- Save full timestamp precision; round only the displayed value.

**Completion check:** Repeated jumps between two cues work reliably both during playback and while paused.

### Phase 3: Keyboard controls and precise positioning

Use one keyboard handler with consistent shortcut rules.

| Shortcut | Action |
|---|---|
| `Space` | Play/Pause |
| `Left` / `Right` | Seek −2 / +2 seconds |
| `Shift + Left` / `Shift + Right` | Seek −5 / +5 seconds |
| `Shift + 1–9` | Save or overwrite a cue |
| `1–9` | Jump to a cue |
| `[` / `]` | Seek −0.5 / +0.5 seconds while paused |
| `-` / `=` | Step down/up through playback speeds |

Implementation details:

- Suppress app shortcuts while editing a cue name.
- Prevent handled keys from scrolling the page or activating a focused control twice.
- Identify number keys reliably even when Shift changes the typed symbol.
- Allow repeated seek presses; prevent held Space from rapidly toggling playback.
- Clamp seeks to the track boundaries.
- Support the specified speeds: `0.5x`, `0.75x`, `0.9x`, `1.0x`, `1.1x`, `1.25x`.
- Default to `1.0x` and enable pitch preservation where supported.

**Completion check:** All shortcuts work with controls focused, while cue-name typing remains unaffected.

### Phase 4: Cue persistence

- Store timestamps and names in `localStorage`, keyed by the exact audio filename.
- Save immediately after setting, renaming, or resetting a cue.
- Restore cues when the same filename is loaded again.
- Validate stored data and handle corrupt or unavailable storage without breaking playback.
- Store no audio data.
- Document that identical filenames share cue records and that the audio must be selected again after reloading.
- Verify persistence specifically when opening the app through `file://` in Chrome and Edge.

**Completion check:** After a reload and file reselection, cue timestamps and names return correctly.

### Phase 5: Interface polish and documentation

- Make the current playback time prominent and readable from a distance.
- Use large cue targets suitable for clicking while holding an instrument.
- Provide visible keyboard focus, descriptive labels, and clear empty/loading/error states.
- Include a compact shortcut reference.
- Write the README with launch instructions, controls, persistence behavior, and the acceptance workflow.

## 3. Validation plan

Use manual browser testing with real local audio files; no test framework or dependencies are needed.

### Primary acceptance workflow

1. Open `index.html`.
2. Drag an MP3 onto the page.
3. Press Space to play.
4. At approximately 20 seconds, press Shift+1.
5. Continue listening.
6. Press `1`.
7. Confirm playback immediately returns to approximately 20 seconds and continues.
8. Press Shift+2 somewhere else.
9. Press `1` and `2` repeatedly to jump between the two sections.
10. Press Left Arrow several times and confirm each press seeks backward exactly 2 seconds.
11. Pause playback and press `[` / `]` to fine-adjust position.
12. Set a cue at the adjusted position.
13. Give the cue a name.
14. Reload the page and load the same audio filename.
15. Confirm that cue timestamps and names are restored.

### Additional checks

- Cue jumps preserve both playing and paused states.
- A cue at zero works.
- Seeking near either end stays within the track.
- Editing cue names does not trigger shortcuts.
- Reset cues remain cleared after reload.
- Loading another file replaces the previous playback and displays its own cues.
- Speed controls stop at the minimum and maximum settings.
- Unsupported files and storage failures produce useful feedback.
- MP3, WAV, and M4A samples are tested for browser playback compatibility.

Finish with a code review focused on keyboard conflicts, duplicate event handling, stale file state, and persistence errors.

## 4. V1 boundaries

Exclude loops, A/B repeat, waveforms, streaming integrations, lyrics, chord detection, AI features, accounts, and cloud storage.

## 5. Definition of done

The acceptance workflow passes in Chrome and Edge when opened locally, the four requested implementation/documentation files are complete, and any browser-specific limitations are documented. The implementation handoff reports which files were created and how to test the app.
