// OpenQ auth worker — flow tests against the real worker fetch handler,
// the real @dawn-studio/auth service layer, and the real schema on an
// in-memory SQLite D1 shim. The mailer is a capture stub injected via
// env.MAILER (the worker's documented test seam); the code + link are
// extracted from the captured email, exactly as a user would read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeTestDb } from './d1shim.mjs';

const EMAIL = 'f147259+openq-test@gmail.com';

function makeEnv() {
  const sent = [];
  const env = {
    ACCOUNTS_DB: makeTestDb(),
    APP_ORIGIN: 'https://openq.dawnstudio.app',
    // Dummy key: the lib fails closed ('not-configured') without one,
    // even when a mailer override is injected — the override below is
    // what actually "sends" in tests.
    RESEND_API_KEY: 're_test_dummy',
    MAILER: async (msg) => { sent.push(msg); return true; },
  };
  return { env, sent };
}

function call(env, path, { method = 'POST', body, token } = {}) {
  const headers = { 'content-type': 'application/json', origin: 'https://openq.dawnstudio.app' };
  if (token) headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://auth.openq.test${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }), env);
}

async function requestLink(env, sent, email = EMAIL) {
  const res = await call(env, '/auth/request-link', { body: { email } });
  assert.equal(res.status, 200);
  const mail = sent[sent.length - 1];
  assert.ok(mail, 'an email was sent');
  const code = /(?:^|\D)(\d{6})(?:\D|$)/m.exec(mail.text)?.[1] || /(\d{6})/.exec(mail.html)?.[1];
  const token = (mail.text.split('token=')[1] || '').split(/[\s&"]/)[0]
    || (mail.html.split('token=')[1] || '').split(/[\s&"]/)[0];
  assert.ok(code, 'email carries a 6-digit code');
  assert.ok(token, 'email carries the magic-link token');
  return { code, token, mail };
}

test('request-link: one email carries BOTH the button link and the 6-digit code', async () => {
  const { env, sent } = makeEnv();
  const { mail } = await requestLink(env, sent);
  assert.match(mail.subject, /OpenQ/);
  assert.ok(mail.html.includes('auth/magic?token='), 'html links to the app magic page');
  assert.ok(mail.text.includes('auth/magic?token='), 'text links to the app magic page');
});

test('verify-code: correct code signs in; session resolves; logout kills it', async () => {
  const { env, sent } = makeEnv();
  const { code } = await requestLink(env, sent);
  const res = await call(env, '/auth/verify-code', { body: { email: EMAIL, code } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.user.email, EMAIL);
  assert.ok(data.token, 'bearer session issued');

  const s = await call(env, '/auth/session', { method: 'GET', token: data.token });
  assert.equal((await s.json()).user.email, EMAIL);

  await call(env, '/auth/logout', { token: data.token });
  const s2 = await call(env, '/auth/session', { method: 'GET', token: data.token });
  assert.equal((await s2.json()).user, null);
});

test('mutual burn: using the code kills the link, and vice versa', async () => {
  const { env, sent } = makeEnv();
  const first = await requestLink(env, sent);
  const ok = await call(env, '/auth/verify-code', { body: { email: EMAIL, code: first.code } });
  assert.equal(ok.status, 200);
  const linkAfterCode = await call(env, '/auth/verify', { body: { token: first.token } });
  assert.equal(linkAfterCode.status, 400, 'link is dead after the code was used');

  const second = await requestLink(env, sent);
  const okLink = await call(env, '/auth/verify', { body: { token: second.token } });
  assert.equal(okLink.status, 200);
  const codeAfterLink = await call(env, '/auth/verify-code', { body: { email: EMAIL, code: second.code } });
  assert.equal(codeAfterLink.status, 400, 'code is dead after the link was used');
});

test('wrong code: generic refusal, and the code dies after 5 wrong tries', async () => {
  const { env, sent } = makeEnv();
  const { code } = await requestLink(env, sent);
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) {
    const r = await call(env, '/auth/verify-code', { body: { email: EMAIL, code: wrong } });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).err, 'invalid', 'refusal is generic — never says which part failed');
  }
  const sixth = await call(env, '/auth/verify-code', { body: { email: EMAIL, code } });
  assert.equal(sixth.status, 400, 'even the CORRECT code is dead after 5 wrong tries');
});

test('rate limit: the 4th sign-in email within 10 minutes is refused', async () => {
  const { env, sent } = makeEnv();
  for (let i = 0; i < 3; i++) {
    const r = await call(env, '/auth/request-link', { body: { email: EMAIL } });
    assert.equal(r.status, 200);
  }
  const fourth = await call(env, '/auth/request-link', { body: { email: EMAIL } });
  assert.equal(fourth.status, 429);
  assert.equal(sent.length, 3, 'no fourth email was sent');
});

test('invalid email is refused before anything is sent', async () => {
  const { env, sent } = makeEnv();
  const r = await call(env, '/auth/request-link', { body: { email: 'not-an-email' } });
  assert.equal(r.status, 400);
  assert.equal(sent.length, 0);
});

test('alias claim: owner claims, stranger is refused, public check is email-free', async () => {
  const { env, sent } = makeEnv();
  const { code } = await requestLink(env, sent);
  const mine = await (await call(env, '/auth/verify-code', { body: { email: EMAIL, code } })).json();

  const claim = await call(env, '/auth/claim', { body: { alias: 'My Page' }, token: mine.token });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).alias, 'mypage');

  const pub = await call(env, '/auth/alias?alias=mypage', { method: 'GET' });
  const pubData = await pub.json();
  assert.equal(pubData.claimed, true);
  assert.ok(!('email' in pubData), 'public claim check never leaks the owner email');

  const other = await requestLink(env, sent, 'someone-else@example.com');
  const otherSession = await (await call(env, '/auth/verify-code', { body: { email: 'someone-else@example.com', code: other.code } })).json();
  const steal = await call(env, '/auth/claim', { body: { alias: 'mypage' }, token: otherSession.token });
  assert.equal(steal.status, 409);

  const list = await call(env, '/auth/me-aliases', { method: 'GET', token: mine.token });
  assert.deepEqual((await list.json()).aliases.map((a) => a.alias), ['mypage']);

  const anon = await call(env, '/auth/claim', { body: { alias: 'whatever' } });
  assert.equal(anon.status, 401, 'claiming requires sign-in');
});
