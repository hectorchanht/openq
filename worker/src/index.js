// OpenQ auth worker — the Dawn app-auth standard, served cross-origin.
//
// OpenQ's web app is a Next.js app hosted on Vercel; it has no Dawn-store
// seam of its own. So auth lives here: a standalone Cloudflare Worker +
// D1 running @dawn-studio/auth (magic link + 6-digit code in ONE email,
// mutual burn, single-use, 15-min, code dies after 5 wrong tries,
// 3 emails/email/10min). Sessions are Bearer tokens (the lib's native
// pattern) — the web app persists the token and sends
// `Authorization: Bearer <token>`; there are no cross-origin cookies.
//
// Routes (thin wrappers over the lib service layer; the lib owns the
// semantics, this file owns HTTP shape + CORS):
//   POST /auth/request-link  { email }          → email the button+code
//   POST /auth/verify        { token }          → magic-link redeem
//   POST /auth/verify-code   { email, code }    → code redeem (in-app path)
//   GET  /auth/session                          → { user } (Bearer)
//   POST /auth/logout                           → destroy the session
//   POST /auth/claim         { alias }          → claim a page name (Bearer)
//   GET  /auth/me-aliases                       → my claimed aliases (Bearer)
//   GET  /auth/alias?alias=x                    → { alias, claimed } (public)
//   GET  /health                                → { ok: true }
//
// Alias claims replace what Gun passwords "protected": the private page
// u/<alias>. Gun accounts were keypairs with no email attached, so there
// is NO migration path from a Gun account to an email account — claims
// start fresh, first signed-in claimant owns the name.

import {
  defineAuth,
  createD1Store,
  requestMagicLink,
  verifyMagicToken,
  verifyCode,
  getSessionUser,
  destroySession,
  requestIp,
} from '@dawn-studio/auth';

const DEFAULT_APP_ORIGIN = 'https://openq.dawnstudio.app';
const DEFAULT_ORIGINS = [
  'https://openq.dawnstudio.app',
  'https://openq.hectorchan.com',
  'http://localhost:3000',
];

export function makeAuth(env) {
  return defineAuth({
    appName: 'OpenQ',
    domain: 'openq.dawnstudio.app',
    // Own sending identity on the verified dawnstudio.app Resend domain
    // (fleet pattern; openq has no Resend-verified domain of its own).
    from: 'OpenQ <login@dawnstudio.app>',
    resendApiKey: env.RESEND_API_KEY || undefined,
    brandColor: '#8b5cf6', // OpenQ violet (theme gradient start)
    cookieName: 'openq_session',
    // Test seam only: unit tests inject a capture mailer via env. Real
    // deployments never set MAILER, so the lib sends via Resend.
    ...(env.MAILER ? { mailer: env.MAILER } : {}),
  });
}

function allowedOrigins(env) {
  if (env.APP_ORIGINS) return env.APP_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ORIGINS;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const headers = { vary: 'Origin' };
  if (allowedOrigins(env).includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type, authorization';
    headers['access-control-max-age'] = '86400';
  }
  return headers;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request, env) },
  });
}

// Alias shape: the old Gun username with spaces stripped, tightened to
// URL-safe characters so u/<alias> is always a clean path segment.
export function normalizeAlias(raw) {
  const a = String(raw || '').replace(/\s+/g, '').toLowerCase();
  return /^[a-z0-9][a-z0-9-_]{1,30}$/.test(a) ? a : null;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (path === '/health') return json(request, env, { ok: true, service: 'openq-auth' });
    if (!path.startsWith('/auth/')) return json(request, env, { error: 'not found' }, 404);

    const auth = makeAuth(env);
    const store = createD1Store(env.ACCOUNTS_DB);
    const ip = requestIp(request);

    if (path === '/auth/request-link' && request.method === 'POST') {
      const { email } = await readBody(request);
      const result = await requestMagicLink(store, auth, {
        email: String(email || ''),
        // The magic link must land on the WEB APP's /auth/magic page,
        // not on this worker — so the origin is the app's, always.
        origin: env.APP_ORIGIN || DEFAULT_APP_ORIGIN,
        ip,
      });
      const status = result === 'ok' ? 200
        : result === 'rate-limited' ? 429
        : result === 'not-configured' ? 503
        : 400;
      return json(request, env, result === 'ok' ? { ok: true } : { ok: false, err: result }, status);
    }

    if (path === '/auth/verify' && request.method === 'POST') {
      const { token } = await readBody(request);
      const r = await verifyMagicToken(store, auth, String(token || ''));
      if (!r.ok) return json(request, env, { ok: false, err: 'invalid-token' }, 400);
      return json(request, env, { ok: true, user: r.user, token: r.sessionToken });
    }

    if (path === '/auth/verify-code' && request.method === 'POST') {
      const { email, code } = await readBody(request);
      const r = await verifyCode(store, auth, {
        email: String(email || ''),
        code: String(code || ''),
        ip,
      });
      if (!r.ok) {
        const status = r.result === 'rate-limited' ? 429 : 400;
        // One generic refusal for a wrong/expired/burned code — the
        // response never says which (no oracle for guessing).
        return json(request, env, { ok: false, err: r.result === 'rate-limited' ? 'rate-limited' : 'invalid' }, status);
      }
      return json(request, env, { ok: true, user: r.user, token: r.sessionToken });
    }

    if (path === '/auth/session' && request.method === 'GET') {
      const user = await getSessionUser(store, auth, request);
      return json(request, env, { user });
    }

    if (path === '/auth/logout' && request.method === 'POST') {
      await destroySession(store, auth, request);
      return json(request, env, { ok: true });
    }

    if (path === '/auth/claim' && request.method === 'POST') {
      const user = await getSessionUser(store, auth, request);
      if (!user) return json(request, env, { ok: false, err: 'not-signed-in' }, 401);
      const { alias: raw } = await readBody(request);
      const alias = normalizeAlias(raw);
      if (!alias) return json(request, env, { ok: false, err: 'invalid-alias' }, 400);
      const existing = await env.ACCOUNTS_DB
        .prepare('SELECT alias, user_id FROM alias_claims WHERE alias = ?')
        .bind(alias).first();
      if (existing && existing.user_id !== user.id) {
        return json(request, env, { ok: false, err: 'alias-taken' }, 409);
      }
      if (!existing) {
        await env.ACCOUNTS_DB
          .prepare('INSERT INTO alias_claims (alias, user_id, email, claimed_at) VALUES (?, ?, ?, ?)')
          .bind(alias, user.id, user.email, Date.now()).run();
      }
      return json(request, env, { ok: true, alias });
    }

    if (path === '/auth/me-aliases' && request.method === 'GET') {
      const user = await getSessionUser(store, auth, request);
      if (!user) return json(request, env, { ok: false, err: 'not-signed-in' }, 401);
      const { results } = await env.ACCOUNTS_DB
        .prepare('SELECT alias, claimed_at FROM alias_claims WHERE user_id = ? ORDER BY claimed_at ASC')
        .bind(user.id).all();
      return json(request, env, { ok: true, aliases: results || [] });
    }

    if (path === '/auth/alias' && request.method === 'GET') {
      const alias = normalizeAlias(url.searchParams.get('alias') || '');
      if (!alias) return json(request, env, { ok: false, err: 'invalid-alias' }, 400);
      const row = await env.ACCOUNTS_DB
        .prepare('SELECT alias FROM alias_claims WHERE alias = ?')
        .bind(alias).first();
      return json(request, env, { ok: true, alias, claimed: !!row });
    }

    return json(request, env, { error: 'not found' }, 404);
  },
};
