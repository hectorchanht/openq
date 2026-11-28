# openq-auth worker

OpenQ's auth backend: the Dawn app-auth standard via
[`@dawn-studio/auth`](https://www.npmjs.com/package/@dawn-studio/auth)
on a standalone Cloudflare Worker + D1. The OpenQ web app is hosted on
Vercel, so it calls this worker cross-origin with Bearer sessions
(`src/libs/auth.js` in the app).

## Routes

| Route | Purpose |
| --- | --- |
| `POST /auth/request-link` | Email the sign-in button + 6-digit code (one intent) |
| `POST /auth/verify` | Redeem the magic-link token (from the app's `/auth/magic` page) |
| `POST /auth/verify-code` | Redeem the 6-digit code typed into the app |
| `GET /auth/session` | Current user for a Bearer token |
| `POST /auth/logout` | Destroy the session |
| `POST /auth/claim` | Claim a private-page name (Bearer) |
| `GET /auth/me-aliases` | My claimed page names (Bearer) |
| `GET /auth/alias?alias=x` | Public claimed check (never leaks the email) |
| `GET /health` | Liveness |

## Deploy

```bash
npm install
npx wrangler d1 create openq-accounts        # once; put the id in wrangler.toml
npx wrangler d1 execute openq-accounts --remote --file=schema.sql
npx wrangler secret put RESEND_API_KEY       # dawnstudio.app-scoped sending key
npx wrangler deploy
```

Sending identity: `OpenQ <login@dawnstudio.app>` (the verified
dawnstudio.app Resend domain — OpenQ has no verified domain of its
own, so it uses the fleet pattern).

## Tests

```bash
npm test   # node:test against the real handler + lib + schema on a
           # node:sqlite D1 shim; the mailer is a capture stub
```
