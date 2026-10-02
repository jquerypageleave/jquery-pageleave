import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS patienten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anrede TEXT NOT NULL DEFAULT '',
  vorname TEXT NOT NULL,
  nachname TEXT NOT NULL,
  geburtsdatum TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  telefon TEXT NOT NULL DEFAULT '',
  strasse TEXT NOT NULL DEFAULT '',
  plz TEXT NOT NULL DEFAULT '',
  ort TEXT NOT NULL DEFAULT '',
  krankenkasse TEXT NOT NULL DEFAULT '',
  versichertennummer TEXT NOT NULL DEFAULT '',
  notizen TEXT NOT NULL DEFAULT '',
  erstellt_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  geaendert_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS termine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patienten(id) ON DELETE CASCADE,
  titel TEXT NOT NULL,
  beginn TEXT NOT NULL,
  ende TEXT NOT NULL,
  notizen TEXT NOT NULL DEFAULT '',
  patient_einladen INTEGER NOT NULL DEFAULT 0,
  google_event_id TEXT,
  google_html_link TEXT,
  synchronisiert_am TEXT,
  erstellt_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  geaendert_am TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_termine_patient ON termine(patient_id);
CREATE INDEX IF NOT EXISTS idx_termine_beginn ON termine(beginn);
CREATE INDEX IF NOT EXISTS idx_patienten_name ON patienten(nachname, vorname);

CREATE TABLE IF NOT EXISTS einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert TEXT NOT NULL
);
`;

const PATIENT_FIELDS = [
  'anrede', 'vorname', 'nachname', 'geburtsdatum', 'email', 'telefon',
  'strasse', 'plz', 'ort', 'krankenkasse', 'versichertennummer', 'notizen',
];

const TERMIN_FIELDS = ['patient_id', 'titel', 'beginn', 'ende', 'notizen', 'patient_einladen'];

export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.fields = fields;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

export function validatePatient(input) {
  const p = {};
  const errors = {};
  for (const f of PATIENT_FIELDS) p[f] = str(input[f]);

  if (!p.vorname) errors.vorname = 'Vorname ist erforderlich.';
  if (!p.nachname) errors.nachname = 'Nachname ist erforderlich.';
  if (p.geburtsdatum && (!DATE_RE.test(p.geburtsdatum) || Number.isNaN(Date.parse(p.geburtsdatum)))) {
    errors.geburtsdatum = 'Geburtsdatum muss im Format JJJJ-MM-TT sein.';
  }
  if (p.email && !EMAIL_RE.test(p.email)) errors.email = 'E-Mail-Adresse ist ungültig.';
  if (p.plz && !/^\d{4,5}$/.test(p.plz)) errors.plz = 'Postleitzahl muss 4 oder 5 Ziffern haben.';

  if (Object.keys(errors).length) throw new ValidationError('Eingaben sind ungültig.', errors);
  return p;
}

export function validateTermin(input) {
  const t = {};
  const errors = {};
  t.patient_id = Number(input.patient_id);
  t.titel = str(input.titel) || 'Termin';
  t.beginn = str(input.beginn);
  t.ende = str(input.ende);
  t.notizen = str(input.notizen);
  t.patient_einladen = input.patient_einladen ? 1 : 0;

  if (!Number.isInteger(t.patient_id) || t.patient_id <= 0) errors.patient_id = 'Patient fehlt.';
  const start = Date.parse(t.beginn);
  const end = Date.parse(t.ende);
  if (!t.beginn || Number.isNaN(start)) errors.beginn = 'Beginn ist ungültig.';
  if (!t.ende || Number.isNaN(end)) errors.ende = 'Ende ist ungültig.';
  if (!errors.beginn && !errors.ende && end <= start) errors.ende = 'Ende muss nach dem Beginn liegen.';

  if (Object.keys(errors).length) throw new ValidationError('Eingaben sind ungültig.', errors);
  // Als ISO-Zeitstempel normalisieren
  t.beginn = new Date(start).toISOString();
  t.ende = new Date(end).toISOString();
  return t;
}

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return new Repository(db);
}

export class Repository {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  // ---- Patienten ------------------------------------------------------

  listPatienten(suche = '') {
    const q = str(suche);
    if (!q) {
      return this.db.prepare('SELECT * FROM patienten ORDER BY nachname, vorname').all();
    }
    const like = `%${q}%`;
    return this.db.prepare(`
      SELECT * FROM patienten
      WHERE vorname LIKE ? OR nachname LIKE ? OR email LIKE ? OR telefon LIKE ?
         OR versichertennummer LIKE ? OR (vorname || ' ' || nachname) LIKE ?
      ORDER BY nachname, vorname
    `).all(like, like, like, like, like, like);
  }

  getPatient(id) {
    return this.db.prepare('SELECT * FROM patienten WHERE id = ?').get(Number(id)) ?? null;
  }

  createPatient(input) {
    const p = validatePatient(input);
    const cols = PATIENT_FIELDS.join(', ');
    const marks = PATIENT_FIELDS.map(() => '?').join(', ');
    const res = this.db.prepare(`INSERT INTO patienten (${cols}) VALUES (${marks})`)
      .run(...PATIENT_FIELDS.map((f) => p[f]));
    return this.getPatient(res.lastInsertRowid);
  }

  updatePatient(id, input) {
    if (!this.getPatient(id)) return null;
    const p = validatePatient(input);
    const sets = PATIENT_FIELDS.map((f) => `${f} = ?`).join(', ');
    this.db.prepare(`UPDATE patienten SET ${sets}, geaendert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(...PATIENT_FIELDS.map((f) => p[f]), Number(id));
    return this.getPatient(id);
  }

  deletePatient(id) {
    const res = this.db.prepare('DELETE FROM patienten WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  // ---- Termine --------------------------------------------------------

  listTermine({ patientId, ab, bis } = {}) {
    const where = [];
    const params = [];
    if (patientId) { where.push('t.patient_id = ?'); params.push(Number(patientId)); }
    if (ab) { where.push('t.ende >= ?'); params.push(new Date(ab).toISOString()); }
    if (bis) { where.push('t.beginn <= ?'); params.push(new Date(bis).toISOString()); }
    const sql = `
      SELECT t.*, p.vorname AS patient_vorname, p.nachname AS patient_nachname, p.email AS patient_email
      FROM termine t JOIN patienten p ON p.id = t.patient_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.beginn
    `;
    return this.db.prepare(sql).all(...params);
  }

  getTermin(id) {
    return this.db.prepare(`
      SELECT t.*, p.vorname AS patient_vorname, p.nachname AS patient_nachname, p.email AS patient_email
      FROM termine t JOIN patienten p ON p.id = t.patient_id WHERE t.id = ?
    `).get(Number(id)) ?? null;
  }

  createTermin(input) {
    const t = validateTermin(input);
    if (!this.getPatient(t.patient_id)) throw new ValidationError('Patient existiert nicht.', { patient_id: 'Unbekannter Patient.' });
    const cols = TERMIN_FIELDS.join(', ');
    const marks = TERMIN_FIELDS.map(() => '?').join(', ');
    const res = this.db.prepare(`INSERT INTO termine (${cols}) VALUES (${marks})`)
      .run(...TERMIN_FIELDS.map((f) => t[f]));
    return this.getTermin(res.lastInsertRowid);
  }

  updateTermin(id, input) {
    const existing = this.getTermin(id);
    if (!existing) return null;
    const t = validateTermin({ ...existing, ...input });
    if (!this.getPatient(t.patient_id)) throw new ValidationError('Patient existiert nicht.', { patient_id: 'Unbekannter Patient.' });
    const sets = TERMIN_FIELDS.map((f) => `${f} = ?`).join(', ');
    this.db.prepare(`UPDATE termine SET ${sets}, geaendert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(...TERMIN_FIELDS.map((f) => t[f]), Number(id));
    return this.getTermin(id);
  }

  setTerminGoogleEvent(id, { eventId, htmlLink }) {
    this.db.prepare(`
      UPDATE termine SET google_event_id = ?, google_html_link = ?,
        synchronisiert_am = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(eventId ?? null, htmlLink ?? null, Number(id));
    return this.getTermin(id);
  }

  listUnsyncedTermine() {
    return this.db.prepare(`
      SELECT t.*, p.vorname AS patient_vorname, p.nachname AS patient_nachname, p.email AS patient_email
      FROM termine t JOIN patienten p ON p.id = t.patient_id
      WHERE t.google_event_id IS NULL OR t.synchronisiert_am IS NULL OR t.synchronisiert_am < t.geaendert_am
      ORDER BY t.beginn
    `).all();
  }

  deleteTermin(id) {
    const res = this.db.prepare('DELETE FROM termine WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  // ---- Einstellungen (z. B. Google-Tokens) ------------------------------

  getSetting(key) {
    const row = this.db.prepare('SELECT wert FROM einstellungen WHERE schluessel = ?').get(key);
    return row ? row.wert : null;
  }

  setSetting(key, value) {
    if (value === null || value === undefined) {
      this.db.prepare('DELETE FROM einstellungen WHERE schluessel = ?').run(key);
    } else {
      this.db.prepare(`
        INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
        ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert
      `).run(key, String(value));
    }
  }

  getJsonSetting(key) {
    const raw = this.getSetting(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  setJsonSetting(key, value) {
    this.setSetting(key, value == null ? null : JSON.stringify(value));
  }
}
