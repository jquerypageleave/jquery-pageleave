import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

test('REST-API: Patienten und Termine', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());

  let r = await s.request('POST', '/api/patienten', { vorname: 'Anna', nachname: 'Muster', email: 'anna@example.org' });
  assert.equal(r.status, 201);
  const patient = r.data;

  r = await s.request('POST', '/api/patienten', { vorname: '', nachname: 'X' });
  assert.equal(r.status, 400);
  assert.equal(r.data.felder.vorname, 'Vorname ist erforderlich.');

  r = await s.request('GET', '/api/patienten?suche=anna');
  assert.equal(r.data.length, 1);

  r = await s.request('POST', '/api/termine', { patient_id: patient.id, titel: 'Erstgespräch', beginn: '2026-11-02T10:00:00Z', ende: '2026-11-02T10:30:00Z' });
  assert.equal(r.status, 201);
  assert.equal(r.data.google_event_id, null, 'ohne Google-Verbindung kein Sync');
  const termin = r.data;

  r = await s.request('GET', `/api/patienten/${patient.id}`);
  assert.equal(r.data.termine.length, 1);

  r = await s.request('PUT', `/api/termine/${termin.id}`, { notizen: 'Bitte Befunde mitbringen' });
  assert.equal(r.status, 200);
  assert.equal(r.data.notizen, 'Bitte Befunde mitbringen');
  assert.equal(r.data.titel, 'Erstgespräch');

  r = await s.request('DELETE', `/api/termine/${termin.id}`);
  assert.equal(r.data.geloescht, true);
  r = await s.request('GET', `/api/termine/9999`);
  assert.equal(r.status, 404);

  r = await s.request('DELETE', `/api/patienten/${patient.id}`);
  assert.equal(r.data.geloescht, true);
  r = await s.request('GET', '/api/patienten');
  assert.deepEqual(r.data, []);

  r = await s.request('POST', '/api/patienten', '{kaputt', );
  assert.equal(r.status, 400);
});

test('Passwortschutz per Basic Auth', async (t) => {
  const s = await startTestServer({ config: { appPassword: 'geheim' } });
  t.after(() => s.close());
  let r = await s.request('GET', '/api/patienten');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /Basic/);
  r = await s.request('GET', '/api/patienten', undefined, { Authorization: 'Basic ' + Buffer.from('praxis:falsch').toString('base64') });
  assert.equal(r.status, 401);
  r = await s.request('GET', '/api/patienten', undefined, { Authorization: 'Basic ' + Buffer.from('praxis:geheim').toString('base64') });
  assert.equal(r.status, 200);
});

test('Statische Oberfläche wird ausgeliefert', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const r = await s.request('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.data, /Patienten-Manager/);
});
