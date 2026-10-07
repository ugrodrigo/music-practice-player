# Firebase notes and cue sync

This stage adds Google sign-in, account-scoped notes, and per-cue sync. Audio files,
looper recordings, lyrics and device preferences remain local. Google Drive and
shared preference sync are follow-up work. No Analytics SDK is loaded.

## Console setup

Project: `music-practice-player`, Spark plan.

1. Enable Google in Authentication → Sign-in method and choose a support email.
2. Add `ugrodrigo.github.io` and `localhost` to Authentication → Settings → Authorized domains.
3. Create the default Firestore database, Standard edition, production mode.
4. Paste the complete contents of `firestore.rules` into Firestore Database → Rules
   and publish. Alternatively, with Firebase CLI installed and authenticated:
   `firebase deploy --only firestore:rules --project music-practice-player`.

The web configuration in `src/js/firebase-config.js` is public, not a server
credential. Never add service-account keys or OAuth client secrets to this app.

## Local check

Run `python scripts/preview.py` and visit `http://localhost:8766/__preview__/`.
Use localhost, not the raw IP address, unless that address is also authorized.
The web app requires HTTP(S); do not test Firebase by opening index.html directly.

1. While signed out, open songs whose old cues you want to migrate. Loading a song
   identifies it using SHA-256 of the audio file bytes. Identical renamed copies
   share cues; re-encoded or edited copies are different tracks.
2. Open Configurations → Account & sync → Sign in with Google.
3. Explicitly import the device's local notes and identified cues if desired.
   A conflicting import preserves both versions for review in Configurations.
4. Edit a note or cue and wait for “Notes and cues are synced.”
5. Sign in to the same account in another browser/device running this version.
   Open the identical audio file to view its cues. Audio itself is not uploaded.
6. Test offline edits, reconnect, and review any conflicts in Configurations.
7. Sign out: the app returns to the separate guest notes and cues. Pending account
   changes stay locally under that account and resume only when it signs in again.

The Firebase SDK is fetched from Google's CDN. Local editing continues if the SDK
cannot load; reconnect and use Retry sync. Cloud transactions run while the app
is open and online. The app doesn't promise background sync after closing.

## Data and checks

Documents are stored at `users/{uid}/items/{itemId}`, with a JSON payload and an
integer revision. Notes use `notes`; cues use `track-{sha256}-cue-{index}`. Independent
cue edits merge naturally. Transactions reject stale revisions and preserve
conflicting versions until the user chooses one. Cleared cues are null payloads.

An account-scoped localStorage outbox persists pending edits; Firestore uses an
in-memory cache. Local browser storage is not encrypted; sign out on shared devices
and clear site data if you need to remove all local copies (including pending edits).

Run `python tests/sync_smoke.py` for isolated two-client sync tests with a simulated
cloud, and the existing `looper_smoke.py` and `pwa_update_smoke.py` regressions.
These tests don't authenticate as a real user or validate the deployed Firestore
rules. A real-account test on the authorized site is still required.

Publishing Firestore rules does not publish the app. GitHub Pages receives these
changes only after the repository's normal deployment.
