import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { GoogleCalendar } from '../src/google.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Simulierter Google-Server: beantwortet Token- und Kalender-Anfragen und
 * protokolliert alle Aufrufe, damit Tests sie prüfen können.
 */
export function fakeGoogle() {
  const calls = [];
  const events = new Map();
  let counter = 0;
  const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = init.method || 'GET';
    const body = init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : Object.fromEntries(init.body)) : null;
    calls.push({ method, url: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: init.headers?.Authorization });

    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      if (body.grant_type === 'authorization_code') {
        if (body.code !== 'gutercode') return json(400, { error: 'invalid_grant', error_description: 'Code ungültig' });
        return json(200, { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, scope: 's', token_type: 'Bearer' });
      }
      if (body.grant_type === 'refresh_token') return json(200, { access_token: 'acc-2', expires_in: 3600, token_type: 'Bearer' });
      return json(400, { error: 'unsupported' });
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json(200, {});

    if (url.hostname === 'www.googleapis.com') {
      if (init.headers?.Authorization !== 'Bearer acc-1' && init.headers?.Authorization !== 'Bearer acc-2') return json(401, { error: { message: 'Unauthorized' } });
      const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/);
      if (!m) return json(404, { error: { message: 'Not found' } });
      const [, , eventId] = m;
      if (!url.pathname.includes('/events')) return json(200, { id: 'praxis@example.org' });
      if (method === 'POST') { const id = `ev${++counter}`; events.set(id, body); return json(200, { id, htmlLink: `https://cal/${id}`, ...body }); }
      if (method === 'PUT') { if (!events.has(eventId)) return json(404, { error: { message: 'Not Found' } }); events.set(eventId, body); return json(200, { id: eventId, htmlLink: `https://cal/${eventId}`, ...body }); }
      if (method === 'DELETE') { events.delete(eventId); return new Response(null, { status: 204 }); }
      if (method === 'GET') return json(200, { items: [...events.entries()].map(([id, e]) => ({ id, htmlLink: `https://cal/${id}`, ...e })) });
    }
    return json(500, { error: { message: `Unerwartete Anfrage ${method} ${url}` } });
  };
  return { fetch: fetchImpl, calls, events };
}

export function testConfig(overrides = {}) {
  return {
    root,
    port: 0,
    dbPath: ':memory:',
    appUser: 'praxis',
    appPassword: '',
    timezone: 'Europe/Berlin',
    google: { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost/auth/google/callback', calendarId: 'primary' },
    ...overrides,
  };
}

/** Startet die App auf einem freien Port und liefert einen kleinen HTTP-Client. */
export async function startTestServer(overrides = {}) {
  const config = testConfig(overrides.config);
  const repo = openDatabase(':memory:');
  const fake = fakeGoogle();
  const google = new GoogleCalendar(repo, config.google, { timezone: config.timezone, fetch: fake.fetch });
  const app = createApp({ repo, config, google });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (method, pathname, body, headers = {}) => {
    const res = await fetch(base + pathname, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };

  const close = () => new Promise((resolve) => server.close(() => { repo.close(); resolve(); }));
  return { request, repo, google, fake, close, base };
}
