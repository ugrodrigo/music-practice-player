# Firebase notes and cue sync

Google sign-in syncs account-scoped notes and cues. The optional Songs library
adds explicit audio uploads to a private app-created Google Drive folder and
selected offline copies on each device. Looper recordings, lyrics and device
preferences remain local. No Analytics SDK is loaded.

## Song library and Drive setup

1. The `music-practice-player` Google Cloud project has **Google Drive API** enabled
   and declares the non-sensitive `https://www.googleapis.com/auth/drive.file`
   scope on its OAuth consent screen. **Google Picker API** is also enabled. A
   separate public Picker key is limited to that API and the published origin,
   localhost port 8766, and `docs.google.com` (where Picker renders). If the OAuth app is in
   Testing mode, add your Google account as a test user. Keep the existing
   Firebase Google sign-in provider and its web OAuth client; no client secret
   belongs in this repository.
2. Deploy the app on its authorized HTTPS origin, or use the localhost preview
   on port 8766 (the port allowed by the project's browser API key).
   The raw `file://` page cannot complete Firebase Google sign-in.
3. Sign in from Account. Open **Songs** from app navigation, then choose
   **Connect Google Drive**. The app asks for Drive permission separately. It
   creates a private `Music Practice Player` folder in your own Drive if needed.
   It never creates an `anyone` sharing permission or scans your other Drive files.
   **Open audio file -> Google Drive** connects and opens this list; **Offline
   songs** opens selected local copies, and **This device** opens the browser's
   local file picker.
   Use **Choose existing Drive files** to authorize audio that you manually put
   into the folder. The app cannot see such files just because they are in its
   folder: `drive.file` requires an explicit Picker selection. Files selected
   outside the app folder may also appear in the library. The app only offers
   **Remove from Drive** for files it uploaded itself.
4. Use **Upload file to Drive** to send an audio file without an offline copy,
   or **Save current song to Drive** for the open song. **Add offline file** and
   **Keep current song offline** save a local copy. **Save to Drive** on an
   offline row uploads that copy. On another device, sign in to the same
   account, connect Drive, then choose **Play** or **Keep offline**. **Remove
   from Drive** confirms before deleting a cloud file and leaves offline copies.

The Drive access token is kept only in page memory, expires from the app after
45 minutes, and is cleared on account change. Reconnect Drive after reload or
expiry. The Drive folder and files remain in the account until removed with
**Remove from Drive** or in Google Drive. The app does not automatically delete songs.

Offline songs are stored in a separate IndexedDB database on this device, alongside
the legacy single last-audio copy. The user chooses a 250 MB to 2 GB offline
budget; the app checks that budget and the browser's approximate available
space before copying a file. Failed writes leave existing copies untouched.
Removing an offline copy never deletes its Drive copy. Browser site-data clearing,
private browsing, or storage eviction can still remove offline copies, so Drive
or the original file is the backup. Local browser data is not encrypted or
protected by Google sign-in; anyone using the same browser profile can open
offline songs. Clear site data on a shared device.

To validate Drive access, test with two devices on the same account, then a
different Google account. The second account must not see the first account's
folder or songs. Test an offline download with networking disabled, low storage,
cancelled consent, token expiry, and Brave with Shields enabled. Google Drive
integration cannot be exercised by local mock tests alone.

Live check on 2026-10-24 at the authorized `http://localhost:8766` preview:
Google sign-in and separate `drive.file` consent completed, the app created its
Drive folder, uploaded a generated 4 KB WAV directly without an offline copy,
listed it, downloaded it into IndexedDB, played that offline copy, then removed
both test copies. This checks one account and one browser; repeat on a second
physical device before relying on cross-device audio access.

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
2. Tap the round Account button in the header → Sign in with Google.
3. Explicitly import the device's local notes and identified cues if desired.
   A conflicting import preserves both versions for review under Account → Sync options.
4. Edit a note or cue and wait for “Notes and cues are synced.”
5. Sign in to the same account in another browser/device running this version.
   Open the identical audio file to view its cues. Notes/cue sync does not upload
   audio; saving a song to Drive is a separate action in Songs.
6. Test offline edits, reconnect, and review any conflicts under Account → Sync options.
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
For security rules and integration against real Firebase SDKs, install Node 22+
and Java 21+, then run:

```sh
npm ci
npm run test:rules
npm run test:sync-browser
```

The browser test also requires Python and Windows Edge. Both commands use only
the local `demo-music-practice` emulator project. Rule tests cover signed-out and
cross-account access, allowed owner access, revisions, payload limits, unknown
paths and atomic batch rejection. The browser test uses two isolated profiles,
the production sync code, and local Auth/Firestore emulators; its HTTP test server
injects emulator connections without adding test switches to the shipped app.
Production Google API endpoints are blocked during the browser test.

Verification on 2026-10-09: all seven rule tests and the two-profile emulator
browser test passed. Two read-only requests to the live project's
`users/security-check/items` path (a document read and collection listing), without
credentials, both returned `403 PERMISSION_DENIED: Missing or insufficient
permissions`. This checks signed-out denial only, not live cross-account access.

These checks don't verify your real Google OAuth popup, physical phone behavior,
or whether the rules currently deployed in the live project match this file.
A real-account test on the authorized site is still required. Do not put real
account credentials in automated tests.

For the final live check, use the same deployed app version on desktop and phone:
sign into the same Google account, change a note on each device in turn, and verify
the changes arrive. Open byte-identical audio files and repeat with cue creation,
renaming and resetting. Then edit the same note offline on one device, change it
online on the other, reconnect and confirm both versions are offered for review.
Sign out and verify account notes disappear from the interface. Separate account
caches remain on the device until site data is cleared.

Publishing Firestore rules does not publish the app. GitHub Pages receives these
changes only after the repository's normal deployment.

## App Check and API-key restrictions

On 2026-10-14 the live browser key was verified as restricted to the GitHub Pages
and Firebase auth-helper origins (root and `/*`), plus `http://localhost:8766`
(root and `/*`). Its API allowlist contains Identity Toolkit, Token Service,
Firestore, Datastore, Firebase Management, Cloud Logging, and Firebase App Check.
The last entry was added for App Check token exchange; existing restrictions
were preserved. Website restrictions reduce misuse but are not authorization:
non-browser clients can forge referrer headers. Owner-only Firestore rules remain
the data-access boundary. Public browser keys are not passwords, and putting
them in a frontend `.env` would not hide them from browsers.

reCAPTCHA Enterprise and App Check APIs are enabled. The web app is registered
with a score-based Enterprise site key restricted to `ugrodrigo.github.io` and
`music-practice-player.firebaseapp.com`, a one-hour token TTL and score threshold
0.5. The public site key is in `firebase-config.js`. App Check initializes before
Auth and Firestore, with token auto-refresh. No analytics SDK was added.

**Enforcement is pending deployment and a real-browser check.** Registering the
provider and shipping the SDK alone does not reject unverified requests.

1. Deploy this app version to GitHub Pages. Update/reload the installed PWA on
   desktop and phone (service-worker version v44).
2. Sign in and edit notes/cues on both devices. In Firebase Console → App Check,
   confirm verified requests are arriving for the services used by the app.
3. Enable enforcement for Cloud Firestore after checking legitimate traffic.
   Check Authentication support/requirements in the console before enabling its
   enforcement separately. Verify sign-in, token refresh and cross-device sync.
4. Confirm an authenticated request without an App Check token is rejected after
   enforcement propagates. An unauthenticated Firestore denial alone only tests
   Security Rules, not App Check. Do not use customer credentials in test scripts.

For localhost development against the live project, create a private debug token
in Firebase Console → App Check → this web app → Manage debug tokens. In DevTools
on `http://localhost:8766`, set the token in sessionStorage and reload:

```js
sessionStorage.setItem('music-practice-player:app-check-debug-token', 'YOUR_PRIVATE_DEBUG_TOKEN');
location.reload();
```

The app reads this value only on loopback hosts. Never commit/share the token or
add localhost to the production reCAPTCHA key. Remove the sessionStorage item
and revoke the token when finished. Emulator browser tests replace App Check in
their test HTTP server; production code has no emulator bypass. They do not
verify real reCAPTCHA attestation. Run the focused integration tests with
`node --test tests/app-check.test.mjs` as well as `npm run test:sync-browser`.

Validation on 2026-10-14: all three App Check initialization tests, the two-profile
Auth/Firestore emulator sync test (including account isolation and offline
conflicts), and the Edge PWA update regression passed. Real production App Check
tokens and enforcement have not yet been validated.

Reference: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
