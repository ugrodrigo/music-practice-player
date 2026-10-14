// Call before Auth/Firestore so their requests carry App Check tokens.
export async function startAppCheck(app, siteKey, environment = window,
  loadSDK = () => import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js')) {
  if (!siteKey) throw new Error('App Check site key is missing');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(environment.location.hostname);
  // Explicit development credential, kept only for this browser tab/session.
  if (local) {
    const token = environment.sessionStorage.getItem('music-practice-player:app-check-debug-token');
    if (token) environment.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
  }
  const sdk = await loadSDK();
  return sdk.initializeAppCheck(app, {
    provider: new sdk.ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
