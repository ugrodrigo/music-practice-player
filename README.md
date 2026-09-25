# Music Practice Player

A local, keyboard-first audio player for learning songs. Set nine cue points and jump between sections while practicing. An optional LRCLIB panel finds lyrics without uploading your audio.

## Open the app

Open `index.html` directly in Chrome or Edge. No installation, server, or build step is needed. Audio playback works offline; fetching new lyrics requires internet access.

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

Shortcuts work across the app except while typing in cue names or lyrics search fields. Names save as you type; press Enter or Escape to leave the name field. Holding an arrow repeats seeking. Holding Space does not repeatedly toggle playback. Seeks stop at the start and end of the song.

## Lyrics lookup

Load a song with **Auto-find lyrics** enabled. The app reads basic MP3 ID3v1 and ID3v2.2/2.3/2.4 title, artist, and album tags locally. Unsupported, compressed, or malformed tags fall back to the filename. Other formats, including WAV/M4A, currently use filename inference rather than embedded tags.

Use a filename such as `Red Hot Chili Peppers - Scar Tissue.mp3`. If the artist cannot be inferred, enter it in the Lyrics panel and click **Find lyrics**. Artist and title are always editable. Files named `track01.mp3` without readable tags cannot be identified from their audio.

The app first requests a match using title, artist, available album information, and duration. An exact normalized artist/title match within two seconds of the track's duration can display automatically. Otherwise, search results let you choose a recording; closest durations appear first. Matching can still be wrong for alternate versions, so check the displayed artist/title/album and search again if needed.

The desktop layout keeps a compact player and cue grid on the left and lyrics visible on the right. Search settings collapse when lyrics load; open **Find or change lyrics** to correct the match. On narrow screens, lyrics appear immediately after the player and before cues.

**Follow song** is enabled for each loaded song. When LRCLIB supplies timed lyrics, the current line is highlighted and centered using the audio position, including after cue jumps and seeks. LRC offsets and repeated timestamps are supported. With plain lyrics, scrolling follows the percentage of the song played; the panel labels this approximate because intros, solos, and uneven verse lengths can shift alignment. Playback speed changes work naturally because following uses the audio's position.

Scroll or touch the lyric text to pause following, then check **Follow song** to resume at the current position. You can also disable it directly. Manual scrolling never seeks or pauses audio. Only the lyric panel scrolls automatically, not the page. Instrumental records are labeled clearly and have following disabled.

Only the search details are sent to [LRCLIB](https://lrclib.net/docs), using its public API and an identifying client header. The audio file is never uploaded. There is no API key, dependency, proxy, or backend. Requests are sequential, spaced apart, have a timeout, and honor rate-limit retry instructions. A failed lookup does not interrupt audio playback or cues.

The last ten selected lyrics records are cached in `localStorage`, associated with filename, size, and modification time. Reopening the same file restores cached lyrics without a network request, including while offline. Editing/replacing a file can cause a fresh lookup. If browser storage is unavailable or full, lyrics still display for the session. Clearing browser storage removes cached lyrics and preferences.

Uncheck **Auto-find lyrics** to stop automatic online searches; this preference is saved. Cached lyrics still load, and **Find lyrics** remains available for explicit searches. There is no background polling or song recognition service.

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

### Lyrics acceptance test

1. Load `Red Hot Chili Peppers - Scar Tissue.mp3` (or another clearly named song) with automatic lookup enabled.
2. Confirm the suggested artist/title and the displayed lyrics or recording choices.
3. Correct the artist/title and select **Find lyrics**. Choose a different recording if necessary.
4. Type spaces and digits into the search fields and verify they do not play/pause or activate cues.
5. Reload, reopen the same file, and confirm saved lyrics return. Cached lyrics should also work offline.
6. Disable automatic lookup, load another song, and confirm no search runs until **Find lyrics** is clicked.
7. Change songs during a search; a late response must not replace the new song's panel. Try a nonexistent title or go offline; playback and cues should keep working.
8. With timed lyrics, play and jump between cues; confirm the highlighted line follows immediately. Scroll manually and confirm following pauses; re-enable **Follow song** to catch up.
9. With plain lyrics, seek to halfway through the song and confirm the lyric panel is approximately halfway scrolled. Check the start and end as well.

The playback code remains in `app.js`; independent metadata parsing, LRCLIB requests, result selection, and caching live in `lyrics.js`.

## Validation performed

Automated checks in headless Microsoft Edge opened the actual `index.html` through `file://` and used a generated 65-second WAV file. They verified both loading paths, playback state, repeated cue jumps, exact paused seeks, fine positioning, name editing, speed limits, track boundaries, reset persistence, restoration after reload, file switching, and recovery from invalid audio or unavailable/corrupt storage.

Chrome was not installed in the implementation environment. Manual listening and real MP3/M4A samples still need the acceptance check above; automated WAV checks do not establish audible seeking latency or every codec's compatibility.

After adding lyrics, the local-player regression checks passed again. Browser tests also covered filename and generated ID3 tag inference, exact and ambiguous matches, result selection, keyboard safety, cached reuse, automatic lookup opt-out, safe text rendering, timestamped-text fallback, no results, network failures, stale responses, and rate limits. A live LRCLIB lookup for Red Hot Chili Peppers / Scar Tissue succeeded from the `file://` page in Edge. No application JavaScript exceptions were observed.

The compact layout and lyric following passed Edge checks at desktop (1366×768) and mobile (390×844) sizes. Tests covered above-fold lyric visibility, timed highlighting, cue jumps, manual scroll interruption/resume, percentage-based fallback, start/end positions, offsets, and repeated timestamps. Playback and lookup regression checks also passed after this update.
