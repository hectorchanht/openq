// OpenQ sign-in client — talks to the openq-auth worker (Dawn standard
// auth: @dawn-studio/auth on Cloudflare Worker + D1). The web app is
// hosted on Vercel, so sessions are Bearer tokens persisted here and
// sent as `Authorization: Bearer <token>` (the lib's native pattern) —
// no cross-origin cookies.
//
// The token is the ONLY credential this module manages. Anonymous room
// participation does NOT go through here at all: queues, votes and
// host-by-localStorage keep working signed-out, exactly as before.

export const AUTH_API =
  process.env.NEXT_PUBLIC_AUTH_API || 'https://openq-auth.gowithin.workers.dev';

const TOKEN_KEY = 'openq:auth-token:v1';

export function getAuthToken() {
  try { return window.localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function setAuthToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable — session just won't persist */ }
}

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  const t = token ?? getAuthToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`${AUTH_API}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Step 1: email the sign-in link (button) + 6-digit code. */
export async function requestSignInLink(email) {
  const { status, data } = await call('/auth/request-link', { method: 'POST', body: { email } });
  if (status === 200 && data.ok) return { ok: true };
  if (status === 429) return { ok: false, err: 'rate-limited' };
  if (status === 503) return { ok: false, err: 'not-configured' };
  return { ok: false, err: data.err || 'invalid-email' };
}

/** Step 2a: redeem the 6-digit code typed into THIS app (the path that
 *  works inside an installed home-screen web app, where the email link
 *  would open a browser with a different cookie jar). */
export async function verifySignInCode(email, code) {
  const { status, data } = await call('/auth/verify-code', { method: 'POST', body: { email, code } });
  if (status === 200 && data.ok && data.token) {
    setAuthToken(data.token);
    return { ok: true, user: data.user };
  }
  if (status === 429) return { ok: false, err: 'rate-limited' };
  return { ok: false, err: 'invalid' };
}

/** Step 2b: redeem a magic-link token (called by /auth/magic landing). */
export async function verifySignInToken(token) {
  const { status, data } = await call('/auth/verify', { method: 'POST', body: { token } });
  if (status === 200 && data.ok && data.token) {
    setAuthToken(data.token);
    return { ok: true, user: data.user };
  }
  return { ok: false, err: 'invalid-token' };
}

/** The signed-in user, or null. Always safe to call signed-out. */
export async function fetchSessionUser() {
  if (!getAuthToken()) return null;
  const { status, data } = await call('/auth/session');
  if (status === 200 && data.user) return data.user;
  if (status === 200) setAuthToken(null); // token is dead — drop it
  return null;
}

export async function signOut() {
  const token = getAuthToken();
  setAuthToken(null);
  if (token) {
    try { await call('/auth/logout', { method: 'POST', token }); } catch { /* already gone locally */ }
  }
}

/** Claim a private-page name for the signed-in user. */
export async function claimAlias(alias) {
  const { status, data } = await call('/auth/claim', { method: 'POST', body: { alias } });
  if (status === 200 && data.ok) return { ok: true, alias: data.alias };
  if (status === 409) return { ok: false, err: 'alias-taken' };
  if (status === 401) return { ok: false, err: 'not-signed-in' };
  return { ok: false, err: data.err || 'invalid-alias' };
}

/** My claimed page names. */
export async function fetchMyAliases() {
  const { status, data } = await call('/auth/me-aliases');
  return status === 200 && data.ok ? data.aliases : [];
}
