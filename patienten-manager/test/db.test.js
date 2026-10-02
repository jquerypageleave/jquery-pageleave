import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, ValidationError } from '../src/db.js';

test('Patient anlegen, suchen, ändern, löschen', () => {
  const repo = openDatabase(':memory:');
  const p = repo.createPatient({ vorname: 'Anna', nachname: 'Muster', geburtsdatum: '1985-04-12', email: 'anna@example.org', plz: '10115' });
  assert.ok(p.id > 0);
  assert.equal(p.nachname, 'Muster');

  assert.equal(repo.listPatienten('must').length, 1);
  assert.equal(repo.listPatienten('anna@').length, 1);
  assert.equal(repo.listPatienten('Anna Muster').length, 1);
  assert.equal(repo.listPatienten('xyz').length, 0);

  const upd = repo.updatePatient(p.id, { ...p, telefon: '030 123' });
  assert.equal(upd.telefon, '030 123');

  assert.equal(repo.deletePatient(p.id), true);
  assert.equal(repo.getPatient(p.id), null);
  repo.close();
});

test('Validierung von Patientendaten', () => {
  const repo = openDatabase(':memory:');
  assert.throws(() => repo.createPatient({ vorname: '', nachname: 'X' }), (e) => e instanceof ValidationError && 'vorname' in e.fields);
  assert.throws(() => repo.createPatient({ vorname: 'A', nachname: 'B', email: 'keine-mail' }), (e) => e instanceof ValidationError && 'email' in e.fields);
  assert.throws(() => repo.createPatient({ vorname: 'A', nachname: 'B', geburtsdatum: '12.04.1985' }), (e) => 'geburtsdatum' in e.fields);
  assert.throws(() => repo.createPatient({ vorname: 'A', nachname: 'B', plz: 'abc' }), (e) => 'plz' in e.fields);
  repo.close();
});

test('Termine: anlegen, validieren, Kaskade beim Löschen des Patienten', () => {
  const repo = openDatabase(':memory:');
  const p = repo.createPatient({ vorname: 'Max', nachname: 'Beispiel' });
  const t = repo.createTermin({ patient_id: p.id, titel: 'Kontrolle', beginn: '2026-10-05T09:00:00+02:00', ende: '2026-10-05T09:30:00+02:00' });
  assert.equal(t.patient_nachname, 'Beispiel');
  assert.equal(t.beginn, '2026-10-05T07:00:00.000Z');
  assert.equal(t.google_event_id, null);

  assert.throws(() => repo.createTermin({ patient_id: p.id, beginn: '2026-10-05T10:00:00Z', ende: '2026-10-05T09:00:00Z' }), (e) => 'ende' in e.fields);
  assert.throws(() => repo.createTermin({ patient_id: 999, beginn: '2026-10-05T10:00:00Z', ende: '2026-10-05T11:00:00Z' }), (e) => 'patient_id' in e.fields);

  assert.equal(repo.listUnsyncedTermine().length, 1);
  repo.setTerminGoogleEvent(t.id, { eventId: 'ev1', htmlLink: 'https://calendar.google.com/x' });
  assert.equal(repo.listUnsyncedTermine().length, 0);

  assert.equal(repo.listTermine({ patientId: p.id }).length, 1);
  assert.equal(repo.listTermine({ ab: '2026-10-06T00:00:00Z' }).length, 0);
  repo.deletePatient(p.id);
  assert.equal(repo.listTermine().length, 0);
  repo.close();
});

test('Einstellungen als JSON speichern', () => {
  const repo = openDatabase(':memory:');
  assert.equal(repo.getJsonSetting('x'), null);
  repo.setJsonSetting('x', { a: 1 });
  assert.deepEqual(repo.getJsonSetting('x'), { a: 1 });
  repo.setJsonSetting('x', null);
  assert.equal(repo.getJsonSetting('x'), null);
  repo.close();
});
