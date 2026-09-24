# Music Practice Player

A local, keyboard-first audio player for learning songs. Set nine cue points and jump between sections while practicing.

## Open the app

Open `index.html` directly in Chrome or Edge. No installation, server, build step, or internet connection is needed.

Drag an audio file anywhere onto the page, or click **Open audio file**. MP3, WAV, M4A, and other browser-supported audio formats are accepted; actual playback depends on the codec supported by your browser. Your audio stays on your device and is never uploaded.

## Controls

Use Play/Pause, the backward/forward buttons (2 seconds), or the seek bar. The playback clock shows tenths of a second. Available speeds are 0.5×, 0.75×, 0.9×, 1.0×, 1.1×, and 1.25×; each file starts at 1.0×. Pitch is preserved where the browser supports it.

Each cue has a large jump button, an editable name, a Set/Update button, and a Reset button. Setting an existing cue replaces its timestamp and keeps its name. A jump preserves playback state: playing stays playing, paused stays paused. Empty cues do nothing when their number is pressed.

| Shortcut | Action |
|---|---|
| Space | Play / pause |
| Left / Right Arrow | Seek backward / forward 2 seconds |
| Shift + Left / Right Arrow | Seek backward / forward 5 seconds |
| Shift + 1–9 | Save current position to a cue |
| 1–9 | Jump to a cue |
| `[` / `]` | Move backward / forward 0.5 seconds while paused |
| `-` / `=` | Decrease / increase speed through the available settings |

Shortcuts work across the app except while typing a cue name. Names save as you type; press Enter or Escape to leave the name field. Holding an arrow repeats seeking. Holding Space does not repeatedly toggle playback. Seeks stop at the start and end of the song.

## Cue persistence

Cue timestamps and names save to this browser's `localStorage`, associated with the exact filename. Reload the page and select the same filename to restore them. Audio files themselves are never stored, and must be selected again each session.

Two files with identical names share the same cue record. Cues beyond a loaded file's duration are ignored. Clearing browser storage removes saved cues. Storage is browser/profile-specific; private browsing, browser settings, or moving the app folder may affect persistence for local `file://` pages. If storage cannot be read or written, the app shows a message and playback remains available.

## Acceptance test

Run this workflow in Chrome and Edge:

1. Open `index.html` and drag in an MP3 longer than one minute.
2. Press Space to play. Around 20 seconds, press Shift+1.
3. Continue listening, then press 1. Confirm an immediate return to the cue with playback continuing.
4. Set Cue 2 elsewhere with Shift+2. Press 1 and 2 repeatedly to jump between sections.
5. Press Left Arrow repeatedly: each press moves the position backward 2 seconds (the clock also continues advancing while playing).
6. Pause. Press `[` and `]` to adjust by 0.5 seconds, then set a cue at the adjusted position.
7. Name the cue, reload the page, and reopen the same filename. Confirm timestamps and names return.
8. While paused, jump between cues and confirm playback remains paused.
9. Check a cue at zero, resetting a cue, seeking at track boundaries, changing speeds, and typing shortcut characters into a cue name.
10. Load another file and confirm its own cues appear. Try WAV and M4A samples and an unreadable audio file.

The app deliberately excludes loops, A/B repeat, waveforms, streaming services, and cloud features.

## Validation performed

Automated checks in headless Microsoft Edge opened the actual `index.html` through `file://` and used a generated 65-second WAV file. They verified both loading paths, playback state, repeated cue jumps, exact paused seeks, fine positioning, name editing, speed limits, track boundaries, reset persistence, restoration after reload, file switching, and recovery from invalid audio or unavailable/corrupt storage.

Chrome was not installed in the implementation environment. Manual listening and real MP3/M4A samples still need the acceptance check above; automated WAV checks do not establish audible seeking latency or every codec's compatibility.
