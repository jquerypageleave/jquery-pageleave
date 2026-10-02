import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

async function verbinden(s) {
  const r = await s.request('GET', '/auth/google');
  assert.equal(r.status, 302);
  const authUrl = new URL(r.headers.get('location'));
  assert.equal(authUrl.hostname, 'accounts.google.com');
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  const state = authUrl.searchParams.get('state');
  const cb = await s.request('GET', `/auth/google/callback?code=gutercode&state=${state}`);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/?google=verbunden');
}

test('OAuth-Verbindung: Status, Verbinden, Trennen', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());

  let r = await s.request('GET', '/api/google/status');
  assert.deepEqual({ k: r.data.konfiguriert, v: r.data.verbunden }, { k: true, v: false });

  await verbinden(s);
  r = await s.request('GET', '/api/google/status');
  assert.equal(r.data.verbunden, true);
  assert.equal(r.data.konto, 'praxis@example.org');

  r = await s.request('POST', '/api/google/disconnect');
  assert.equal(r.data.verbunden, false);
  assert.ok(s.fake.calls.some((c) => c.url === '/revoke'));
});

test('OAuth-Callback mit falschem state wird abgelehnt', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  await s.request('GET', '/auth/google');
  const cb = await s.request('GET', '/auth/google/callback?code=gutercode&state=falsch');
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /google=fehler/);
  const r = await s.request('GET', '/api/google/status');
  assert.equal(r.data.verbunden, false);
});

test('Nicht konfiguriert: Verbinden liefert verständlichen Fehler', async (t) => {
  const s = await startTestServer({ config: { google: { clientId: '', clientSecret: '', redirectUri: '', calendarId: 'primary' } } });
  t.after(() => s.close());
  const r = await s.request('GET', '/auth/google');
  assert.equal(r.status, 400);
  assert.match(r.data.fehler, /nicht konfiguriert/);
});

test('Termine werden in den Google Kalender synchronisiert', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  await verbinden(s);

  const p = (await s.request('POST', '/api/patienten', { vorname: 'Anna', nachname: 'Muster', email: 'anna@example.org' })).data;

  // Anlegen -> Event wird erstellt, mit Einladung
  let r = await s.request('POST', '/api/termine', {
    patient_id: p.id, titel: 'Kontrolle', beginn: '2026-11-02T10:00:00Z', ende: '2026-11-02T10:30:00Z', patient_einladen: true,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.google_event_id, 'ev1');
  assert.equal(r.data.google_html_link, 'https://cal/ev1');
  assert.equal(r.data.warnung, null);
  const ev = s.fake.events.get('ev1');
  assert.equal(ev.summary, 'Kontrolle – Anna Muster');
  assert.equal(ev.start.dateTime, '2026-11-02T10:00:00.000Z');
  assert.equal(ev.start.timeZone, 'Europe/Berlin');
  assert.deepEqual(ev.attendees, [{ email: 'anna@example.org', displayName: 'Anna Muster' }]);
  const post = s.fake.calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'));
  assert.equal(post.query.sendUpdates, 'all');

  // Ändern -> Event wird aktualisiert (PUT), nicht neu angelegt
  r = await s.request('PUT', `/api/termine/${r.data.id}`, { titel: 'Nachkontrolle', patient_einladen: false });
  assert.equal(r.data.google_event_id, 'ev1');
  assert.equal(s.fake.events.get('ev1').summary, 'Nachkontrolle – Anna Muster');
  assert.equal(s.fake.events.get('ev1').attendees, undefined);
  const terminId = r.data.id;

  // Event wurde extern gelöscht -> beim nächsten Sync neu anlegen
  s.fake.events.delete('ev1');
  r = await s.request('POST', `/api/termine/${terminId}/sync`);
  assert.equal(r.data.google_event_id, 'ev2');

  // Löschen -> DELETE am Kalender
  r = await s.request('DELETE', `/api/termine/${terminId}`);
  assert.equal(r.data.geloescht, true);
  assert.equal(s.fake.events.size, 0);
  assert.ok(s.fake.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/events/ev2')));
});

test('Sync aller Termine und Token-Refresh', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const p = (await s.request('POST', '/api/patienten', { vorname: 'Max', nachname: 'Beispiel' })).data;
  await s.request('POST', '/api/termine', { patient_id: p.id, beginn: '2026-11-02T10:00:00Z', ende: '2026-11-02T10:30:00Z' });
  await s.request('POST', '/api/termine', { patient_id: p.id, beginn: '2026-11-03T10:00:00Z', ende: '2026-11-03T10:30:00Z' });

  // Noch nicht verbunden -> Fehler 409
  let r = await s.request('POST', '/api/google/sync');
  assert.equal(r.status, 409);

  await verbinden(s);
  // Access-Token künstlich ablaufen lassen -> Refresh muss passieren
  const tokens = s.repo.getJsonSetting('google_tokens');
  s.repo.setJsonSetting('google_tokens', { ...tokens, expires_at: Date.now() - 1000 });

  r = await s.request('POST', '/api/google/sync');
  assert.equal(r.status, 200);
  assert.equal(r.data.synchronisiert, 2);
  assert.deepEqual(r.data.fehler, []);
  assert.ok(s.fake.calls.some((c) => c.url === '/token' && c.body.grant_type === 'refresh_token'));
  assert.equal(s.fake.events.size, 2);

  // Zweiter Sync: nichts mehr zu tun
  r = await s.request('POST', '/api/google/sync');
  assert.equal(r.data.synchronisiert, 0);

  // Kommende Events lesen
  r = await s.request('GET', '/api/google/events');
  assert.equal(r.data.length, 2);
  assert.equal(r.data[0].terminId, 1);

  // Patient löschen entfernt auch die Kalendereinträge
  r = await s.request('DELETE', `/api/patienten/${p.id}`);
  assert.equal(r.data.geloescht, true);
  assert.equal(s.fake.events.size, 0);
});
