import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { ValidationError } from './db.js';
import { GoogleCalendar, GoogleError } from './google.js';

/**
 * Erstellt die Express-Anwendung. Datenbank und Google-Client werden
 * übergeben, damit die App in Tests mit einer In-Memory-Datenbank läuft.
 */
export function createApp({ repo, config, google }) {
  const app = express();
  const gcal = google || new GoogleCalendar(repo, config.google, { timezone: config.timezone });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  // Optionaler Passwortschutz (HTTP Basic Auth)
  if (config.appPassword) {
    const expected = Buffer.from(`${config.appUser}:${config.appPassword}`);
    app.use((req, res, next) => {
      const header = req.headers.authorization || '';
      const [scheme, encoded] = header.split(' ');
      if (scheme === 'Basic' && encoded) {
        const given = Buffer.from(encoded, 'base64');
        if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
      }
      res.set('WWW-Authenticate', 'Basic realm="Patienten-Manager", charset="UTF-8"');
      res.status(401).send('Anmeldung erforderlich.');
    });
  }

  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.static(path.join(config.root, 'public')));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---- Patienten ------------------------------------------------------

  app.get('/api/patienten', (req, res) => {
    res.json(repo.listPatienten(req.query.suche || ''));
  });

  app.post('/api/patienten', (req, res) => {
    res.status(201).json(repo.createPatient(req.body || {}));
  });

  app.get('/api/patienten/:id', (req, res) => {
    const p = repo.getPatient(req.params.id);
    if (!p) return res.status(404).json({ fehler: 'Patient nicht gefunden.' });
    res.json({ ...p, termine: repo.listTermine({ patientId: p.id }) });
  });

  app.put('/api/patienten/:id', (req, res) => {
    const p = repo.updatePatient(req.params.id, req.body || {});
    if (!p) return res.status(404).json({ fehler: 'Patient nicht gefunden.' });
    res.json(p);
  });

  app.delete('/api/patienten/:id', wrap(async (req, res) => {
    const termine = repo.listTermine({ patientId: req.params.id });
    const warnungen = [];
    if (gcal.isConnected()) {
      for (const t of termine) {
        try { await gcal.deleteEvent(t.google_event_id); } catch (err) { warnungen.push(err.message); }
      }
    }
    if (!repo.deletePatient(req.params.id)) return res.status(404).json({ fehler: 'Patient nicht gefunden.' });
    res.json({ geloescht: true, warnungen });
  }));

  // ---- Termine --------------------------------------------------------

  app.get('/api/termine', (req, res) => {
    res.json(repo.listTermine({ patientId: req.query.patient_id, ab: req.query.ab, bis: req.query.bis }));
  });

  app.post('/api/termine', wrap(async (req, res) => {
    let termin = repo.createTermin(req.body || {});
    let warnung = null;
    if (gcal.isConnected()) {
      try { termin = await gcal.syncTermin(termin); } catch (err) { warnung = err.message; }
    }
    res.status(201).json({ ...termin, warnung });
  }));

  app.put('/api/termine/:id', wrap(async (req, res) => {
    let termin = repo.updateTermin(req.params.id, req.body || {});
    if (!termin) return res.status(404).json({ fehler: 'Termin nicht gefunden.' });
    let warnung = null;
    if (gcal.isConnected()) {
      try { termin = await gcal.syncTermin(termin); } catch (err) { warnung = err.message; }
    }
    res.json({ ...termin, warnung });
  }));

  app.delete('/api/termine/:id', wrap(async (req, res) => {
    const termin = repo.getTermin(req.params.id);
    if (!termin) return res.status(404).json({ fehler: 'Termin nicht gefunden.' });
    let warnung = null;
    if (gcal.isConnected() && termin.google_event_id) {
      try { await gcal.deleteEvent(termin.google_event_id); } catch (err) { warnung = err.message; }
    }
    repo.deleteTermin(termin.id);
    res.json({ geloescht: true, warnung });
  }));

  app.post('/api/termine/:id/sync', wrap(async (req, res) => {
    const termin = repo.getTermin(req.params.id);
    if (!termin) return res.status(404).json({ fehler: 'Termin nicht gefunden.' });
    res.json(await gcal.syncTermin(termin));
  }));

  // ---- Google Kalender ------------------------------------------------

  app.get('/api/google/status', (req, res) => res.json(gcal.status()));

  app.get('/auth/google', (req, res) => {
    res.redirect(gcal.buildAuthUrl());
  });

  app.get('/auth/google/callback', wrap(async (req, res) => {
    if (req.query.error) {
      return res.redirect(`/?google=fehler&meldung=${encodeURIComponent(String(req.query.error))}`);
    }
    try {
      await gcal.handleCallback({ code: req.query.code, state: req.query.state });
      res.redirect('/?google=verbunden');
    } catch (err) {
      res.redirect(`/?google=fehler&meldung=${encodeURIComponent(err.message)}`);
    }
  }));

  app.post('/api/google/disconnect', wrap(async (req, res) => res.json(await gcal.disconnect())));
  app.post('/api/google/sync', wrap(async (req, res) => res.json(await gcal.syncAll())));
  app.get('/api/google/events', wrap(async (req, res) => {
    res.json(await gcal.listUpcomingEvents({ maxResults: Number(req.query.limit) || 20 }));
  }));

  // ---- Fehlerbehandlung -----------------------------------------------

  app.use('/api', (req, res) => res.status(404).json({ fehler: 'Nicht gefunden.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ fehler: err.message, felder: err.fields });
    }
    if (err instanceof GoogleError) {
      return res.status(err.status || 502).json({ fehler: err.message });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ fehler: 'Ungültiges JSON.' });
    }
    console.error(err);
    res.status(500).json({ fehler: 'Interner Serverfehler.' });
  });

  return app;
}
