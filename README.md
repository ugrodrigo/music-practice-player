# Music Practice Player

A local, keyboard-first audio player for learning songs. Set nine cue points and jump between sections while practicing. An optional LRCLIB panel finds lyrics without uploading your audio.

## Open the app

Open `index.html` directly in Chrome or Edge. No installation, server, or build step is needed. Audio playback works offline; fetching new lyrics requires internet access.

Drag an audio file anywhere onto the page, or click **Open audio file**. MP3, WAV, M4A, and other browser-supported audio formats are accepted; actual playback depends on the codec supported by your browser. Your audio stays on your device and is never uploaded.

## Install on Android and use offline

The same app can be installed as a Progressive Web App (PWA). On phones, **Lyrics** is the first tab and opens by default; **Edit cues** is second. **Open audio file** is beside the Lyrics and Edit cues tabs; Install app sits beside the title. The Lyrics tab hides the waveform/track block to give the lyrics more reading space. Playback controls stay at the bottom, and **Show waveform** expands the waveform when needed. Tap or hold a timed lyric to open a small cue bubble, then tap **Save cue 1**; select the next verse and save cue 2. Tap outside or press Escape to dismiss the bubble. A compact **+ Cue** button opens it for the current playback position. Saving uses the selected line's timestamp even during playback and advances to the next empty cue. After saving, select another lyric or save the current playback position. **Use current time** clears the selection; **+ Cue** captures the current position. Tap a saved cue button to jump; hold it for about two-thirds of a second to overwrite that cue using the selected lyric timestamp, or the playback position captured when you started holding. The cue name is preserved. Moving your finger or cancelling the touch cancels the overwrite. **Edit cues** opens naming, replacement, and deletion controls. Full cue banks disable saving until you clear a slot. Plain lyrics use the current playback position.

1. Publish this folder on an HTTPS static host. For this repository, GitHub Pages can serve the `main` branch's root folder: repository **Settings → Pages → Build and deployment → Deploy from a branch → main → / (root)**. See [GitHub's publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). These local changes must be pushed before the hosted site can include them; implementation does not publish the site automatically.
2. Open the published URL in Chrome on Android while online. With GitHub Pages enabled for this repository, the expected URL is `https://ugrodrigo.github.io/music-practice-player/`.
3. Wait for **Ready offline**, then tap **Install app**. If that button is unavailable, use Chrome's menu to install/add the app to your home screen.
4. Open an audio file stored on your phone. Fetch its lyrics once while online if you want them available offline.
5. You can now reopen the app without internet and select the same local audio file again.

Playback, speed controls, cues, waveform analysis, and previously cached lyrics work offline. New lyrics searches and Genius require internet. Audio is never uploaded or copied into the app cache; select it again after reopening. Cloud-only files need to be downloaded to the phone first. The lyrics cache retains the last ten selected records.

Saved cues and lyrics belong to this browser and site address. They do not automatically transfer from the desktop app or a `file://` page. Clearing site data removes them and the offline app cache. Background/lock-screen playback and installation still need verification on a physical Android phone.

Updates show **Update & reload** and wait for your tap, so they do not reload the app during practice. Developers must bump `VERSION` in `sw.js` whenever a cached app file changes. The service worker caches only the listed app files and removes only older caches belonging to this app's scope. Serve through HTTPS for phone installation; localhost also works for development on the same computer. Opening `index.html` directly continues to work as a local player, but does not install the service worker.

## Controls

Use Play/Pause, the backward/forward buttons (2 seconds), or the seek bar. The playback clock shows tenths of a second. Available speeds are 0.5×, 0.75×, 0.9×, 1.0×, 1.1×, and 1.25×; each file starts at 1.0×. Pitch is preserved where the browser supports it.

Each cue has a large jump button, an editable name, a Set/Update button, and a Reset button. Setting an existing cue replaces its timestamp and keeps its name. A jump preserves playback state: playing stays playing, paused stays paused. Empty cues do nothing when their number is pressed.

## Colored waveform

A DJ-style waveform appears above the seek bar after local analysis. Red represents bass, green mids, and blue highs; mixed colors reflect mixed frequency content. These are approximate frequency bands, not instrument or vocal detection. The color convention is inspired by [Serato's waveform display](https://support.serato.com/hc/en-us/articles/224969307-Main-Waveform-Display); this app does not reproduce its proprietary analysis.

The main view follows the playhead, with a choice of **10 seconds**, **30 seconds** (default), or **Full track**. A smaller overview below always shows the entire song and outlines the visible window. Time labels are seconds, not detected beats. Average signal energy sets the body height, with faint peak outlines for transients, so a few loud samples no longer turn whole sections into solid blocks.

Click or drag on the main waveform to seek within its visible time window; use the lower overview to jump anywhere in the song. The time window stays fixed during a drag. Playing stays playing; paused stays paused. Cue jumps and keyboard seeks update the cursor, zoomed view, and lyrics as usual. The standard seek bar remains available for keyboard and assistive-technology access.

Waveform analysis runs separately from playback, with no upload or dependencies. Files over 100 MiB or 20 minutes skip analysis to limit memory usage. Unsupported decoding falls back to the seek bar. Switching songs discards stale results and serializes decoding to avoid several large analyses at once. The decoded audio is reduced to energy, peak, and frequency-band arrays at approximately 10 ms resolution, then released; waveform data is not stored in browser storage. Analysis uses a 16 kHz overview decode and approximate crossovers at 200 Hz and 2.5 kHz; this is a navigation aid, not a precision spectrum analyzer.

| Shortcut | Action |
|---|---|
| Space | Play / pause |
| Backtick (`` ` ``) | Jump to the beginning; playing stays playing, paused stays paused |
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

**Find on Genius** opens a new tab searching Genius for the current artist and song, where you can explore lyrics, annotations, and song background. The link follows detected, corrected, or matched song details. It is a search link rather than an unverified direct song URL, requires both artist and title, and does not contact Genius until clicked.

The app first requests a match using title, artist, available album information, and duration. An exact normalized artist/title match within two seconds of the track's duration can display automatically. Otherwise, search results let you choose a recording; closest durations appear first. Matching can still be wrong for alternate versions, so check the displayed artist/title/album and search again if needed.

The desktop layout keeps a compact player and cue grid on the left and lyrics visible on the right. The frame has **Lyrics** and **Find lyrics** subtabs, with a Genius link between them. Open Find lyrics to correct the match. On narrow screens, lyrics are the main view, with cue saving and playback always accessible in the bottom bar; use **Edit cues** to manage saved sections.

Lyric following is always active. When LRCLIB supplies timed lyrics, the current line is highlighted and centered using the audio position, including after cue jumps and seeks. LRC offsets and repeated timestamps are supported. With plain lyrics, scrolling follows the percentage of the song played; the panel labels this approximate because intros, solos, and uneven verse lengths can shift alignment. Playback speed changes work naturally because following uses the audio's position.

Scrolling lyrics moves playback: timed lyrics seek to the line at the center marker, while plain lyrics map scroll percentage to song percentage approximately. Following resumes when scrolling settles. Seeking preserves play/pause state. Automatic following never triggers another seek. Instrumental records have no lyric navigation.

Click a timed lyric line to jump to its timestamp and resume lyric following. Playing stays playing; paused stays paused. You can also Tab to a line and press Enter; Space keeps its usual Play/Pause function. Plain lyrics remain read-only because they have no reliable line timestamps. Timing accuracy depends on the selected LRCLIB recording.

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

The app deliberately excludes loops, A/B repeat, streaming services, and cloud features.

### Lyrics acceptance test

1. Load `Red Hot Chili Peppers - Scar Tissue.mp3` (or another clearly named song) with automatic lookup enabled.
2. Confirm the suggested artist/title and the displayed lyrics or recording choices.
3. Correct the artist/title and select **Find lyrics**. Choose a different recording if necessary.
4. Type spaces and digits into the search fields and verify they do not play/pause or activate cues.
5. Reload, reopen the same file, and confirm saved lyrics return. Cached lyrics should also work offline.
6. Disable automatic lookup, load another song, and confirm no search runs until **Find lyrics** is clicked.
7. Change songs during a search; a late response must not replace the new song's panel. Try a nonexistent title or go offline; playback and cues should keep working.
8. With timed lyrics, play and jump between cues; confirm the highlighted line follows immediately. Scroll manually and confirm playback seeks to the centered line, then following resumes when scrolling settles.
9. With plain lyrics, seek to halfway through the song and confirm the lyric panel is approximately halfway scrolled. Check the start and end as well.

The playback code remains in `app.js`; independent metadata parsing, LRCLIB requests, result selection, and caching live in `lyrics.js`.

## Validation performed

PWA checks in headless Edge served the app from a subdirectory, verified its manifest and offline cache, disabled networking, and reopened the app successfully. Local audio playback, saved cues, cached timed lyrics, lyric seeking, and waveform analysis worked offline. Mobile panel switching and horizontal overflow were checked at 390×844. A staged update waited during playback and activated only after clicking **Update & reload**, removing the old app cache while preserving an unrelated cache. These desktop browser checks do not replace physical Android testing.

Automated checks in headless Microsoft Edge opened the actual `index.html` through `file://` and used a generated 65-second WAV file. They verified both loading paths, playback state, repeated cue jumps, exact paused seeks, fine positioning, name editing, speed limits, track boundaries, reset persistence, restoration after reload, file switching, and recovery from invalid audio or unavailable/corrupt storage.

Chrome was not installed in the implementation environment. Manual listening and real MP3/M4A samples still need the acceptance check above; automated WAV checks do not establish audible seeking latency or every codec's compatibility.

After adding lyrics, the local-player regression checks passed again. Browser tests also covered filename and generated ID3 tag inference, exact and ambiguous matches, result selection, keyboard safety, cached reuse, automatic lookup opt-out, safe text rendering, timestamped-text fallback, no results, network failures, stale responses, and rate limits. A live LRCLIB lookup for Red Hot Chili Peppers / Scar Tissue succeeded from the `file://` page in Edge. No application JavaScript exceptions were observed.

The compact layout and lyric following passed Edge checks at desktop (1366×768) and mobile (390×844) sizes. Tests covered above-fold lyric visibility, timed highlighting, cue jumps, manual scroll interruption/resume, percentage-based fallback, start/end positions, offsets, and repeated timestamps. Playback and lookup regression checks also passed after this update.

Waveform checks in Edge passed native WAV decoding, real pointer click/drag seeking, preservation of play/pause state, oversized-file fallback, decoder failure, and recovery. Local playback regressions, the backtick shortcut, and Genius link checks also passed with no application JavaScript exceptions. To test manually, load a song with quiet and loud sections, wait for the waveform, click/drag while playing and paused, and switch files while analysis is running.

The DJ-style update additionally passed color-discrimination tests using decoded 60 Hz, 1 kHz, and 6 kHz test tones, and verified that a click in the zoomed 10-second view seeks to the correct time. Existing playback and waveform fallback checks passed again.

Phone cue workflow checks passed in Edge: a selected lyric timestamp stayed fixed while playback advanced, saving selected the next empty slot, current-position saving and quick cue jumps worked, and the speed control fit widths from 320 to 760 pixels. Offline reopening and explicit app updates passed again. Physical Android testing remains necessary.

Hold-to-overwrite browser checks verified selected-line and current-position replacement, no jump after a hold, movement/cancellation safety, and the enlarged mobile lyric viewport. Offline updates and desktop playback regression checks passed.

Cue-bubble checks passed tap/hold opening, exact timestamp saving, compact dock layout, Find lyrics switching, manual scroll seeking, and prevention of automatic-follow seek feedback. Playback and offline update regressions passed.
