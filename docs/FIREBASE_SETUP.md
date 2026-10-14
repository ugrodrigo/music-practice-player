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
