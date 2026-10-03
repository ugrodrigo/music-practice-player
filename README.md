# Music Practice Player

A local, keyboard-first audio player for learning songs. Save cue points in pages of eight and jump between sections while practicing. An optional LRCLIB panel finds lyrics without uploading your audio.

## Open the app

Open `index.html` directly in Chrome or Edge. No installation, server, or build step is needed. Audio playback works offline; fetching new lyrics requires internet access.

Drag an audio file anywhere onto the page, or click **Open audio file**. MP3, WAV, M4A, and other browser-supported audio formats are accepted; actual playback depends on the codec supported by your browser. Your audio stays on your device and is never uploaded.

## Install on Android and use offline

The same app can be installed as a Progressive Web App (PWA). On phones, **Lyrics** is the first tab and opens by default; **Cues** is second. **Open audio file** is beside the Lyrics and Edit cues tabs; Install app sits beside the title. The Lyrics tab hides the waveform/track block to give the lyrics more reading space. Playback controls stay at the bottom, and the waveform starts expanded on the Cues tab; **Hide waveform** collapses it. Tap a timed lyric to seek, then tap an empty numbered cue button to save that timestamp. Eight numbered cue buttons are always visible: tap an empty slot to save, tap a filled slot to jump, or hold to overwrite. Filling all eight slots opens the next page; Previous/Next navigate saved pages. Saving uses the selected lyric timestamp even during playback. Tap a saved cue button to jump; hold it for about two-thirds of a second to overwrite that cue using the selected lyric timestamp, or the playback position captured when you started holding. The cue name is preserved. Moving your finger or cancelling the touch cancels the overwrite. **Cues** opens naming, replacement, and deletion controls. Additional pages are created as needed, and existing saved cues (including cue 9 from earlier versions) are retained. Keyboard shortcuts 1-9 still address the first nine cues. Plain lyrics use the current playback position.

1. Publish this folder on an HTTPS static host. For this repository, GitHub Pages can serve the `main` branch's root folder: repository **Settings → Pages → Build and deployment → Deploy from a branch → main → / (root)**. See [GitHub's publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). These local changes must be pushed before the hosted site can include them; implementation does not publish the site automatically.
2. Open the published URL in Chrome on Android while online. With GitHub Pages enabled for this repository, the expected URL is `https://ugrodrigo.github.io/music-practice-player/`.
3. Let the initial page finish loading, then tap **Install app**. If that button is unavailable, use Chrome's menu to install/add the app to your home screen.
4. Open an audio file stored on your phone. Fetch its lyrics once while online if you want them available offline.
5. You can now reopen the app without internet; the last saved audio file restores automatically, paused.

Playback, speed controls, cues, waveform analysis, and previously cached lyrics work offline. New lyrics searches and Genius require internet. Audio is never uploaded. With **Remember last audio on this device** enabled (the default), one local copy is stored in IndexedDB and restored automatically after reopening. Cloud-only files need to be downloaded to the phone first. The lyrics cache retains the last ten selected records.

Saved cues and lyrics belong to this browser and site address. They do not automatically transfer from the desktop app or a `file://` page. Clearing site data removes them and the offline app cache. Background/lock-screen playback and installation still need verification on a physical Android phone.

Updates show **Update & reload** and wait for your tap, so they do not reload the app during practice. Developers must bump `VERSION` in `sw.js` whenever a cached app file changes. The service worker caches only the listed app files and removes only older caches belonging to this app's scope. Serve through HTTPS for phone installation; localhost also works for development on the same computer. Opening `index.html` directly continues to work as a local player, but does not install the service worker.

## Controls

Use Play/Pause, the backward/forward buttons (0.5 seconds), or the seek bar. The playback clock shows tenths of a second. Available speeds are 0.5×, 0.75×, 0.9×, 1.0×, 1.1×, and 1.25×; each file starts at 1.0×. Pitch is preserved where the browser supports it.

Each cue has a large jump button, an editable name, a Set/Update button, and a Reset button. Setting an existing cue replaces its timestamp and keeps its name. A jump preserves playback state: playing stays playing, paused stays paused. Empty cues do nothing when their number is pressed.

## Colored waveform

A DJ-style waveform appears above the seek bar after local analysis. Red represents bass, green mids, and blue highs; mixed colors reflect mixed frequency content. These are approximate frequency bands, not instrument or vocal detection. The color convention is inspired by [Serato's waveform display](https://support.serato.com/hc/en-us/articles/224969307-Main-Waveform-Display); this app does not reproduce its proprietary analysis.

The main view defaults to **30 seconds**, with the waveform scrolling beneath a centered playhead. **10 seconds** works the same way; empty space at the track boundaries keeps the playhead centered. **Full track** remains static with a moving playhead. The lower overview always stays static. A smaller overview below always shows the entire song and outlines the visible window. Time labels are seconds, not detected beats. Average signal energy sets the body height, with faint peak outlines for transients, so a few loud samples no longer turn whole sections into solid blocks.

Click or drag on the main waveform to seek within its visible time window; use the lower overview to jump anywhere in the song. The time window stays fixed during a drag. Playing stays playing; paused stays paused. Cue jumps and keyboard seeks update the cursor, zoomed view, and lyrics as usual. The standard seek bar remains available for keyboard and assistive-technology access.

Waveform analysis runs separately from playback, with no upload or dependencies. Files over 100 MiB or 20 minutes skip analysis to limit memory usage. Unsupported decoding falls back to the seek bar. Switching songs discards stale results and serializes decoding to avoid several large analyses at once. The decoded audio is reduced to energy, peak, and frequency-band arrays at approximately 10 ms resolution, then released; waveform data is not stored in browser storage. Analysis uses a 16 kHz overview decode and approximate crossovers at 200 Hz and 2.5 kHz; this is a navigation aid, not a precision spectrum analyzer.

| Shortcut | Action |
|---|---|
| Space | Play / pause |
| Backtick (`` ` ``) | Jump to the beginning; playing stays playing, paused stays paused |
| Left / Right Arrow | Seek backward / forward 0.5 seconds |
| Shift + Left / Right Arrow | Seek backward / forward 5 seconds |
| Shift + 1–9 | Save current position to a cue |
| 1–9 | Jump to a cue |
| `[` / `]` | Move backward / forward 2 seconds while paused |
| `-` / `=` | Decrease / increase speed through the available settings |

Shortcuts work across the app except while typing in cue names or lyrics search fields. Names save as you type; press Enter or Escape to leave the name field. Holding an arrow repeats seeking. Holding Space does not repeatedly toggle playback. Seeks stop at the start and end of the song.

## Lyrics lookup

Load a song with **Auto-find lyrics** enabled. The app reads basic MP3 ID3v1 and ID3v2.2/2.3/2.4 title, artist, and album tags locally. Unsupported, compressed, or malformed tags fall back to the filename. Other formats, including WAV/M4A, currently use filename inference rather than embedded tags.

Use a filename such as `Red Hot Chili Peppers - Scar Tissue.mp3`. If the artist cannot be inferred, enter it in the Lyrics panel and click **Find lyrics**. Artist and title are always editable. Files named `track01.mp3` without readable tags cannot be identified from their audio.

**Find on Genius** opens a new tab searching Genius for the current artist and song, where you can explore lyrics, annotations, and song background. The link follows detected, corrected, or matched song details. It is a search link rather than an unverified direct song URL, requires both artist and title, and does not contact Genius until clicked.

The app first requests a match using title, artist, available album information, and duration. An exact normalized artist/title match within two seconds of the track's duration can display automatically. Otherwise, search results let you choose a recording; closest durations appear first. Matching can still be wrong for alternate versions, so check the displayed artist/title/album and search again if needed.

The desktop layout keeps a compact player and cue grid on the left and lyrics visible on the right. The frame has **Lyrics** and **Find lyrics** subtabs, with a Genius link between them. Open Find lyrics to correct the match. On narrow screens, lyrics are the main view, with cue saving and playback always accessible in the bottom bar; use **Cues** to manage saved sections.

Lyric following is always active. When LRCLIB supplies timed lyrics, the current line is highlighted and centered using the audio position, including after cue jumps and seeks. LRC offsets and repeated timestamps are supported. With plain lyrics, scrolling follows the percentage of the song played; the panel labels this approximate because intros, solos, and uneven verse lengths can shift alignment. Playback speed changes work naturally because following uses the audio's position.

Scrolling lyrics moves playback: timed lyrics seek to the line at the center marker, while plain lyrics map scroll percentage to song percentage approximately. Following resumes when scrolling settles. Seeking preserves play/pause state. Automatic following never triggers another seek. Instrumental records have no lyric navigation.

Click a timed lyric line to jump to its timestamp and resume lyric following. Playing stays playing; paused stays paused. You can also Tab to a line and press Enter; Space keeps its usual Play/Pause function. Plain lyrics remain read-only because they have no reliable line timestamps. Timing accuracy depends on the selected LRCLIB recording.

Only the search details are sent to [LRCLIB](https://lrclib.net/docs), using its public API and an identifying client header. The audio file is never uploaded. There is no API key, dependency, proxy, or backend. Requests are sequential, spaced apart, have a timeout, and honor rate-limit retry instructions. A failed lookup does not interrupt audio playback or cues.

The last ten selected lyrics records are cached in `localStorage`, associated with filename, size, and modification time. Reopening the same file restores cached lyrics without a network request, including while offline. Editing/replacing a file can cause a fresh lookup. If browser storage is unavailable or full, lyrics still display for the session. Clearing browser storage removes cached lyrics and preferences.

Uncheck **Auto-find lyrics** to stop automatic online searches; this preference is saved. Cached lyrics still load, and **Find lyrics** remains available for explicit searches. There is no background polling or song recognition service.

## Cue persistence

Cue timestamps and names save to this browser's `localStorage`, associated with the exact filename. The last saved audio restores automatically, together with its cues. Other files restore their cues when selected again.

Two files with identical names share the same cue record. Cues beyond a loaded file's duration are ignored. Clearing browser storage removes saved cues. Storage is browser/profile-specific; private browsing, browser settings, or moving the app folder may affect persistence for local `file://` pages. If storage cannot be read or written, the app shows a message and playback remains available.

## Acceptance test

Run this workflow in Chrome and Edge:

1. Open `index.html` and drag in an MP3 longer than one minute.
2. Press Space to play. Around 20 seconds, press Shift+1.
3. Continue listening, then press 1. Confirm an immediate return to the cue with playback continuing.
4. Set Cue 2 elsewhere with Shift+2. Press 1 and 2 repeatedly to jump between sections.
5. Press Left Arrow repeatedly: each press moves the position backward 0.5 seconds (the clock also continues advancing while playing).
6. Pause. Press `[` and `]` to adjust by 2 seconds, then set a cue at the adjusted position.
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

Before the first sung line, lyrics start at the top without a highlighted line; early lines highlight in place without adding space above them. Centered following starts only once enough preceding lines naturally fill the upper half. The lyrics box automatically fills the available space between the header and player. The following position is 40% down the lyrics area, independent of its height. A-/A+ adjust text from 14 to 26 pixels and remember the setting on this browser. The title and navigation stay pinned while scrolling. The mobile Edit cues track row has Show waveform instead of a duplicate Open audio file button. Browser checks covered repeated hold/tap cycles, eight visible slots, page creation through cue 16, later-page persistence, and offline reopening.

The lyric hold popup has been removed. Lyrics only seek/select; numbered cue buttons handle saving, jumping, and hold-to-overwrite.

Scrolling waveform bars sample fixed intervals anchored to the track, so their heights and colors remain stable as they move horizontally.

With **Keep screen on** checked (the default), a loaded song requests a screen wake lock whenever the app is visible, including while paused or after the track ends. Turning it off or leaving the app releases the lock; returning requests it again. The app retries device-released or rejected locks up to three times with increasing delays. Tap the status message to retry manually. **Screen lock active** confirms a granted lock, while failures show an actionable message.

Use the HTTPS site or installed app: plain HTTP phone previews do not support wake locks. The browser/OS can still refuse or revoke them; the app cannot prevent manual locking or OS app termination. See [MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

Browser checks covered automatic height, pinned navigation, font-size persistence after reload, and scroll-to-seek at the 40% following position. Mocked wake-lock checks covered paused practice, automatic recovery after system release, visibility changes, opt-out, delayed requests, rejections, and missing API support. Physical Android screen timeout behavior still needs device testing.

The phone header is fixed edge-to-edge with safe-area padding. Lyric height recalculates on viewport and browser-chrome changes. The gear in the lyrics header opens text-size controls and a box-height slider (40-100% of available space, with a 220px minimum); **Auto** returns to filling the available space. The chosen percentage is saved independently of text size. Browser checks verified full-width header bounds, manual height changes, Auto reset, and a 200px lyric-height change when the viewport grew by 200px.

The solid gear opens a separate Settings view with text size, box height, and Keep screen on. Lyrics are hidden while Settings is open; tap Lyrics to return. The header no longer displays offline-status text; update notifications remain available.

In Settings, **Remember last audio on this device** controls local audio persistence. **Remove saved audio** deletes the stored copy without stopping the current song. Only the latest successfully loaded audio is retained, preserving its filename, type, and modification time so cached lyrics still match. Storage failures do not interrupt playback. Clearing site data or browser eviction can remove the copy. After installing this update, open a song once to save it. Offline browser tests passed automatic restoration without the picker, paused playback state, cue restoration, preserved file identity, quota failure, deletion, and persistent opt-out.

## Recorder / Looper

Branch: `feature/looper-folder-storage`. Use the new **Practice / Looper** buttons in the header. Practice retains the existing lyrics, cues and player; entering Looper pauses the practice track.

In **Looper**:

1. Set **BPM** (30-300) and **Count in** (Off, 4 or 8 beats), then tap **Record new** and allow microphone access. Audible/visual counting starts after permission is granted; recording starts after the last beat interval. Count-in defaults to Off, with BPM initially 100. This update resets the previous count-in preference to Off once while keeping BPM; subsequent choices are remembered. **Stop** cancels a count-in without creating a take. Play a phrase, then tap **Stop**. This first version records one layer, up to 3 minutes, with an input meter and no live microphone monitoring.
2. Pinch the waveform with two fingers to zoom from 1x to 16x around the gesture midpoint; drag away from a marker with one finger to pan. Drag the waveform's start/end markers. Select **Start** or **End**, zoom and pan, then use the +/- controls with 1, 10 or 100 ms steps for fine adjustments. The numeric fields use seconds.
3. **Play loop** repeats the selection. **Preview seam** plays across the end-to-start transition. Editing markers updates the running loop without restarting its audio source. The current position continues until the end boundary; moving the end behind it wraps playback into the new loop. Loop WAV exports apply a 3 ms edge fade to reduce clicks.
4. Rename the take if desired. Audio and loop boundaries save automatically in IndexedDB. **Saved recordings** reopens or deletes takes; deleting inside the app preserves external files.
5. **Download loop WAV** exports the trimmed selection; **Download original WAV** exports the full take. Names are English and contain a UTC timestamp and unique suffix, e.g. `recording_2026-09-30T14-25-30-123Z_a1b2c3d4_loop.wav`.

**Choose folder** is optional and depends on browser support. When supported and authorized, completed recordings are automatically copied there as full WAV files with JSON sidecars containing the name and loop boundaries. Edits update the sidecar. Permission or disk failures leave the local take intact; reopen it and use **Save to folder** to retry. Existing audio files with different contents are not overwritten. Settings also provides a silent **Save test WAV** to check folder access. Without folder support, recording and local saving still work, with WAV downloads for external copies.

Microphone access requires HTTPS or localhost. After the app is cached, recording, editing, playback and local saving work offline. Leaving the app stops capture and attempts to save the captured audio; stay in the app during a take. **Keep screen on** also applies in Looper, subject to browser/OS permission. New recording and mode switching are protected while capture is finishing. Storage failures keep the take available for download and warn before replacement.

Local browser storage is not a permanent backup: clearing site data or browser eviction can remove recordings. Keep folder copies or WAV downloads for recordings you want to retain. This version has no overdubbing or background recording.

### Looper verification

Run `python tests/looper_smoke.py` on Windows with Microsoft Edge installed. The test uses an isolated temporary profile and a simulated microphone. It checks actual MediaRecorder capture and decoding, trims, looping, WAV contents, automatic folder copies using browser-private handles, offline library restoration, permission denial, cancelled requests, storage failure recovery, deletion, and layouts from 320 to 1366 pixels. Physical Android microphone quality, latency, directory access and OS wake-lock behavior still need device testing. Existing practice-player, lyrics, cues, audio-memory and PWA-update regression checks also passed.

Looper interaction checks also cover real two-finger touch events without marker changes, live source continuity during boundary edits, count-in duration at 100 BPM, and cancellation without creating a take.

### Looper audio devices

Open **Audio input / output**, connect your USB-C microphone and headphones, then choose **Find devices** and grant microphone permission. Select **Microphone** and **Looper output** independently. **Test input** displays the actual microphone name and a live level meter without recording or monitoring it through speakers; tap **Stop test** to release it. **Test output** plays a short tone. Input testing stops when you start recording, leave Looper, or hide the app.

Selections are remembered on this browser. Recording requests the selected microphone explicitly and fails if it is unavailable, rather than silently using another input. Device lists refresh on connection changes; input/output changes are locked during recording and loop playback. If a selected output cannot be opened, choose another output or System default before recording. **Allow output device** is offered where the browser supports a permission picker. Output selection affects loop playback, the count-in and the test tone; the Practice player keeps the system output.

A PWA can only select devices exposed by the browser and OS. If output selection is unsupported, the control stays on **System default** and the app explains how to use Android's output selection. A USB-C microphone plus Bluetooth headphones must still be verified on the physical phone. Browser tests cover explicit input constraints, microphone-test cleanup, output tones, missing-device failures, preference restoration and existing looper workflows; they cannot verify Android's hardware routing.

Practice volume: desktop has a horizontal fader and speaker/mute button next to speed. On mobile, the speaker button opens a vertical fader with Mute; tap outside or press Escape to close. Volume and the previous nonzero mute level are remembered across sessions and song changes. The fader uses a squared taper and only affects the Practice player. Arrow keys seek 0.5 seconds; Shift+arrows retain 5 seconds; [ and ] seek 2 seconds while paused.

The Practice main waveform keeps its playhead centered during playback and click/drag seeking, including navigation through the bottom overview. The overview remains a stationary map of the track. The Full track zoom uses a track-length window centered on the playhead, with empty space beyond the track boundaries.
