import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';
import { startAppCheck } from './firebase-app-check.js';

const $ = id => document.getElementById(id);
const sync = window.PracticeSync;
let auth, api, db, initializing, authReady = false;
const avatar = $('account-avatar-image');
const avatarFallback = $('account-avatar-fallback');
let avatarURL = '';
window.PracticeDriveAuth = {
  get user() { return auth?.currentUser || null; },
  async requestToken() {
    if (!auth?.currentUser) throw new Error('Sign in with Google from the Account menu first.');
    const user = auth.currentUser;
    const provider = new api.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result = await api.reauthenticateWithPopup(user, provider);
    if (result.user.uid !== user.uid) throw new Error('The Google account changed.');
    const token = api.GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('Google Drive permission was not granted.');
    return token;
  },
};
avatar.addEventListener('load', () => {
  if (avatarURL && avatar.currentSrc === avatarURL) { avatar.hidden = false; avatarFallback.hidden = true; }
});
avatar.addEventListener('error', () => { avatar.hidden = true; avatarFallback.hidden = false; });
function message(error) {
  const messages = {
    'auth/unauthorized-domain': 'Add this hostname to Firebase Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'Enable Google in Firebase Authentication → Sign-in method.',
    'auth/popup-blocked': 'Allow the Google sign-in popup, then try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled. Your local data is unchanged.',
    'permission-denied': 'Sync access was denied. Check your account and retry. If this continues, review Firestore rules and App Check settings.',
    'unavailable': 'Cloud sync is unavailable. Changes will wait on this device.',
  };
  return messages[error.code] || `Could not connect (${error.code || 'network error'}). Check your connection and retry.`;
}
function render() {
  const state = sync.state();
  const user = auth?.currentUser;
  const signedIn = !!user;
  const name = user?.displayName || user?.email?.split('@')[0] || 'Guest';
  $('account-name').textContent = name;
  $('account-toggle').setAttribute('aria-label', signedIn ? `Account menu for ${name}` : 'Open account menu');
  $('account-guest-icon').hidden = signedIn;
  $('account-initial').hidden = !signedIn;
  $('account-initial').textContent = signedIn ? name.trim().charAt(0).toUpperCase() || '?' : '';
  const photo = signedIn && /^https:\/\//i.test(user.photoURL || '') ? user.photoURL : '';
  if (photo !== avatarURL) {
    avatarURL = photo;
    avatar.hidden = true;
    avatarFallback.hidden = false;
    if (photo) avatar.src = photo;
    else avatar.removeAttribute('src');
  }
  $('account-signed-in').hidden = !signedIn;
  document.querySelector('.account-intro').hidden = signedIn;
  $('account-attention').hidden = !state.error && !state.conflicts.length;
  if (state.conflicts.length) $('account-sync-details').open = true;
  $('sync-import').hidden = state.owner === 'guest';
  $('sync-signout').hidden = !signedIn;
  $('sync-signin').hidden = signedIn;
  $('sync-account').textContent = user?.email || (state.owner === 'guest' ? 'Not signed in' : 'Saved account — reconnect to sync');
  $('sync-status').textContent = state.error || (state.owner === 'guest' ? 'Notes and cues are saved on this device.'
    : state.conflicts.length ? 'Conflicting edits need your review below.'
    : !navigator.onLine ? `Offline. ${state.pending} change(s) waiting to sync.`
    : !state.connected ? 'Connecting. Local changes are kept on this device.'
    : state.pending ? `${state.pending} change(s) waiting to sync.` : 'Notes and cues are synced.');
  $('sync-conflicts').replaceChildren();
  for (const conflict of state.conflicts) {
    const box = document.createElement('section'); box.className = 'sync-conflict';
    const heading = document.createElement('h4');
    heading.textContent = conflict.key === 'notes' ? 'Notes conflict' : `Cue conflict (${conflict.key.slice(-12)})`;
    box.append(heading);
    for (const [label, value] of [['This device', conflict.local], ['Cloud', conflict.cloud]]) {
      const text = document.createElement('p'); text.textContent = label;
      const preview = document.createElement('textarea'); preview.readOnly = true;
      preview.setAttribute('aria-label', `${heading.textContent}: ${label}`);
      preview.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      box.append(text, preview);
    }
    for (const [label, choice] of [['Keep this device’s version', 'local'], ['Use cloud version', 'cloud']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => sync.resolve(conflict.key, choice)); box.append(button);
    }
    $('sync-conflicts').append(box);
  }
}
function adapter(uid) {
  const collection = api.collection(db, 'users', uid, 'items');
  const decode = data => ({ value: JSON.parse(data.payload), revision: data.revision });
  return {
    watch(next, fail) {
      return api.onSnapshot(collection, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        try { next(Object.fromEntries(snapshot.docs.map(item => [item.id, decode(item.data())]))); }
        catch { fail(new Error('Cloud data could not be read. Local data has been preserved.')); }
      }, error => fail(new Error(message(error))));
    },
    async write(key, value, revision) {
      try {
        return await api.runTransaction(db, async transaction => {
          if (auth.currentUser?.uid !== uid) throw new Error('Account changed');
          const ref = api.doc(collection, key), snapshot = await transaction.get(ref);
          const remote = snapshot.exists() ? decode(snapshot.data()) : { value: null, revision: 0 };
          if (remote.revision !== revision) {
            if (JSON.stringify(remote.value) === JSON.stringify(value)) return { revision: remote.revision };
            return { conflict: remote };
          }
          transaction.set(ref, { payload: JSON.stringify(value), revision: revision + 1 });
          return { revision: revision + 1 };
        });
      } catch (error) { throw new Error(message(error)); }
    },
  };
}
async function initialize() {
  if (initializing) return initializing;
  initializing = (async () => {
    const [appSDK, authSDK, firestoreSDK] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
    ]);
    api = { ...authSDK, ...firestoreSDK };
    const app = appSDK.initializeApp(firebaseConfig);
    await startAppCheck(app, appCheckSiteKey);
    auth = api.getAuth(app);
    // Our account-scoped outbox handles offline writes and revision conflicts.
    db = api.initializeFirestore(app, { localCache: api.memoryLocalCache() });
    api.onAuthStateChanged(auth, user => {
      authReady = true;
      try {
        if (user) localStorage.setItem('music-practice-player:sync-owner', user.uid);
        else localStorage.removeItem('music-practice-player:sync-owner');
      } catch {}
      sync.setAccount(user?.uid, user ? adapter(user.uid) : null);
      render();
    });
  })();
  try { await initializing; }
  catch (error) { initializing = null; throw error; }
}
$('sync-signin').addEventListener('click', async () => {
  $('sync-signin').disabled = true;
  try {
    await initialize();
    await api.signInWithPopup(auth, new api.GoogleAuthProvider());
  } catch (error) { $('sync-status').textContent = message(error); }
  finally { $('sync-signin').disabled = false; }
});
$('sync-signout').addEventListener('click', async () => {
  try { await api.signOut(auth); }
  catch (error) { $('sync-status').textContent = message(error); }
});
$('sync-import').addEventListener('click', () => sync.importGuest());
$('sync-retry').addEventListener('click', async () => {
  try {
    await initialize();
    if (authReady && auth.currentUser) sync.setAccount(auth.currentUser.uid, adapter(auth.currentUser.uid));
    else sync.retry();
  } catch (error) { $('sync-status').textContent = message(error); }
});
document.addEventListener('syncchange', render);
render();
initialize().catch(error => { $('sync-status').textContent = message(error); });
