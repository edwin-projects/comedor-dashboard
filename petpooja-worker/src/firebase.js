// ─── Firebase Realtime Database access from a Cloudflare Worker ──────────────
// Workers run outside the Firebase project, so we authenticate with a service
// account: sign a short-lived JWT (RS256, via WebCrypto) and exchange it for a
// Google OAuth access token, then hit the RTDB REST API with it. The token is
// cached in module scope for its lifetime so we mint it at most ~once/hour.
//
// The service-account JSON (Firebase console → Project settings → Service
// accounts → Generate new private key) is stored as the Worker secret
// FIREBASE_SERVICE_ACCOUNT. FIREBASE_DB_URL is the RTDB origin, e.g.
// https://<project>-default-rtdb.firebaseio.com  (no trailing slash).

let _cachedToken = null;   // { token, exp } — exp is epoch seconds

const SCOPE = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = s => b64url(new TextEncoder().encode(s));

// PEM (PKCS#8) private key → CryptoKey for RS256 signing.
async function importPrivateKey(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function mintAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedToken.exp - 60 > now) return _cachedToken.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email, scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const signingInput = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claim));
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = signingInput + '.' + b64url(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  if (!res.ok) throw new Error('token exchange failed: ' + res.status + ' ' + (await res.text()));
  const j = await res.json();
  _cachedToken = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return _cachedToken.token;
}

// Thin RTDB REST wrapper bound to one project's credentials + db url.
function firebase(env) {
  const sa = typeof env.FIREBASE_SERVICE_ACCOUNT === 'string'
    ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : env.FIREBASE_SERVICE_ACCOUNT;
  const base = String(env.FIREBASE_DB_URL || '').replace(/\/$/, '');
  const url = async path => base + '/' + path.replace(/^\//, '') + '.json?access_token=' +
    encodeURIComponent(await mintAccessToken(sa));

  return {
    async get(path) {
      const r = await fetch(await url(path));
      if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
      return r.json();
    },
    async set(path, value) {
      const r = await fetch(await url(path), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!r.ok) throw new Error('PUT ' + path + ' → ' + r.status + ' ' + (await r.text()));
      return r.json();
    },
    async update(path, patch) {
      const r = await fetch(await url(path), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error('PATCH ' + path + ' → ' + r.status + ' ' + (await r.text()));
      return r.json();
    },
  };
}

export { firebase, mintAccessToken };
