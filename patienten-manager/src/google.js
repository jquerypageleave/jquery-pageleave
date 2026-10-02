/**
 * Google-Kalender-Anbindung ohne externe Abhängigkeiten:
 * OAuth 2.0 (Authorization Code Flow) + Google Calendar REST API v3 über fetch().
 */
import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];

const TOKEN_KEY = 'google_tokens';
const STATE_KEY = 'google_oauth_state';

export class GoogleError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = 'GoogleError';
    this.status = status;
    this.details = details;
  }
}

export class GoogleCalendar {
  /**
   * @param {import('./db.js').Repository} repo
   * @param {{clientId:string, clientSecret:string, redirectUri:string, calendarId:string}} cfg
   * @param {{timezone:string, fetch?:typeof fetch}} [opts]
   */
  constructor(repo, cfg, opts = {}) {
    this.repo = repo;
    this.cfg = cfg;
    this.timezone = opts.timezone || 'Europe/Berlin';
    this.fetch = opts.fetch || globalThis.fetch;
  }

  isConfigured() {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret && this.cfg.redirectUri);
  }

  getTokens() {
    return this.repo.getJsonSetting(TOKEN_KEY);
  }

  isConnected() {
    const t = this.getTokens();
    return Boolean(t && t.refresh_token);
  }

  status() {
    const t = this.getTokens();
    return {
      konfiguriert: this.isConfigured(),
      verbunden: Boolean(t && t.refresh_token),
      konto: t?.account_email || null,
      kalenderId: this.cfg.calendarId,
      zeitzone: this.timezone,
    };
  }

  // ---- OAuth ----------------------------------------------------------

  buildAuthUrl() {
    if (!this.isConfigured()) throw new GoogleError('Google-Anbindung ist nicht konfiguriert (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen).', 400);
    const state = crypto.randomBytes(16).toString('hex');
    this.repo.setSetting(STATE_KEY, state);
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  async handleCallback({ code, state }) {
    const expected = this.repo.getSetting(STATE_KEY);
    this.repo.setSetting(STATE_KEY, null);
    if (!expected || state !== expected) throw new GoogleError('Ungültiger OAuth-Status (state). Bitte Verbindung erneut starten.', 400);
    if (!code) throw new GoogleError('Kein Autorisierungscode erhalten.', 400);

    const tokens = await this.#tokenRequest({
      code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: this.cfg.redirectUri,
      grant_type: 'authorization_code',
    });
    if (!tokens.refresh_token) {
      throw new GoogleError('Google hat kein Refresh-Token geliefert. Bitte den Zugriff in den Google-Kontoeinstellungen entfernen und erneut verbinden.', 400);
    }
    const stored = this.#storeTokens(tokens, null);
    // Konto-E-Mail zur Anzeige ermitteln (optional, Fehler ignorieren)
    try {
      const cal = await this.#api('GET', `/calendars/${encodeURIComponent('primary')}`);
      stored.account_email = cal.id;
      this.repo.setJsonSetting(TOKEN_KEY, stored);
    } catch { /* ignorieren */ }
    return this.status();
  }

  async disconnect() {
    const t = this.getTokens();
    if (t?.refresh_token) {
      try {
        await this.fetch(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' });
      } catch { /* Netzwerkfehler beim Widerrufen ignorieren */ }
    }
    this.repo.setJsonSetting(TOKEN_KEY, null);
    return this.status();
  }

  #storeTokens(tokens, previous) {
    const stored = {
      ...(previous || {}),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || previous?.refresh_token,
      scope: tokens.scope || previous?.scope,
      token_type: tokens.token_type || 'Bearer',
      expires_at: Date.now() + Math.max(0, (tokens.expires_in ?? 3600) - 60) * 1000,
    };
    this.repo.setJsonSetting(TOKEN_KEY, stored);
    return stored;
  }

  async #tokenRequest(body) {
    const res = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GoogleError(`Google-Token-Anfrage fehlgeschlagen: ${data.error_description || data.error || res.status}`, 502, data);
    }
    return data;
  }

  async #accessToken() {
    const t = this.getTokens();
    if (!t?.refresh_token) throw new GoogleError('Google Kalender ist nicht verbunden.', 409);
    if (t.access_token && t.expires_at && Date.now() < t.expires_at) return t.access_token;
    let refreshed;
    try {
      refreshed = await this.#tokenRequest({
        refresh_token: t.refresh_token,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: 'refresh_token',
      });
    } catch (err) {
      // invalid_grant: Refresh-Token widerrufen oder abgelaufen (z. B. nach 7 Tagen
      // bei einer Google-App im Status "Testen"). Verbindung zurücksetzen, damit
      // die Oberfläche "erneut verbinden" anbietet.
      if (err.details?.error === 'invalid_grant') {
        this.repo.setJsonSetting(TOKEN_KEY, null);
        throw new GoogleError('Die Google-Verbindung ist abgelaufen oder wurde widerrufen. Bitte erneut mit Google Kalender verbinden.', 409, err.details);
      }
      throw err;
    }
    return this.#storeTokens(refreshed, t).access_token;
  }

  async #api(method, pathname, { query, body } = {}) {
    const token = await this.#accessToken();
    const url = new URL(`${CALENDAR_API}${pathname}`);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const res = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) this.repo.setJsonSetting(TOKEN_KEY, null);
      const msg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
      throw new GoogleError(`Google Kalender: ${msg}`, res.status === 404 ? 404 : 502, data);
    }
    return data;
  }

  // ---- Kalender-Operationen ---------------------------------------------

  /** Termin (aus der DB, inkl. Patientendaten) in ein Google-Event umwandeln. */
  terminToEvent(termin) {
    const name = `${termin.patient_vorname} ${termin.patient_nachname}`.trim();
    const descriptionParts = [`Patient: ${name}`];
    if (termin.patient_email) descriptionParts.push(`E-Mail: ${termin.patient_email}`);
    if (termin.notizen) descriptionParts.push('', termin.notizen);
    const event = {
      summary: `${termin.titel} – ${name}`,
      description: descriptionParts.join('\n'),
      start: { dateTime: termin.beginn, timeZone: this.timezone },
      end: { dateTime: termin.ende, timeZone: this.timezone },
      extendedProperties: { private: { patientenManagerTerminId: String(termin.id), patientenManagerPatientId: String(termin.patient_id) } },
      reminders: { useDefault: true },
    };
    if (termin.patient_einladen && termin.patient_email) {
      event.attendees = [{ email: termin.patient_email, displayName: name }];
    }
    return event;
  }

  async syncTermin(termin) {
    const event = this.terminToEvent(termin);
    const calendarId = encodeURIComponent(this.cfg.calendarId);
    const query = { sendUpdates: termin.patient_einladen && termin.patient_email ? 'all' : 'none' };
    let result;
    if (termin.google_event_id) {
      try {
        result = await this.#api('PUT', `/calendars/${calendarId}/events/${encodeURIComponent(termin.google_event_id)}`, { query, body: event });
      } catch (err) {
        if (err.status !== 404) throw err;
        result = await this.#api('POST', `/calendars/${calendarId}/events`, { query, body: event });
      }
    } else {
      result = await this.#api('POST', `/calendars/${calendarId}/events`, { query, body: event });
    }
    return this.repo.setTerminGoogleEvent(termin.id, { eventId: result.id, htmlLink: result.htmlLink });
  }

  async deleteEvent(eventId) {
    if (!eventId) return;
    const calendarId = encodeURIComponent(this.cfg.calendarId);
    try {
      await this.#api('DELETE', `/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`, { query: { sendUpdates: 'all' } });
    } catch (err) {
      if (err.status !== 404 && err.status !== 410) throw err;
    }
  }

  async syncAll() {
    if (!this.isConnected()) throw new GoogleError('Google Kalender ist nicht verbunden.', 409);
    const results = { synchronisiert: 0, fehler: [] };
    for (const termin of this.repo.listUnsyncedTermine()) {
      try {
        await this.syncTermin(termin);
        results.synchronisiert += 1;
      } catch (err) {
        results.fehler.push({ terminId: termin.id, fehler: err.message });
      }
    }
    return results;
  }

  /** Kommende Ereignisse aus dem Google-Kalender lesen (z. B. zur Anzeige der Belegung). */
  async listUpcomingEvents({ maxResults = 20, timeMin = new Date().toISOString() } = {}) {
    const calendarId = encodeURIComponent(this.cfg.calendarId);
    const data = await this.#api('GET', `/calendars/${calendarId}/events`, {
      query: { maxResults, timeMin, singleEvents: 'true', orderBy: 'startTime', timeZone: this.timezone },
    });
    return (data?.items || []).map((e) => ({
      id: e.id,
      titel: e.summary || '(ohne Titel)',
      beginn: e.start?.dateTime || e.start?.date || null,
      ende: e.end?.dateTime || e.end?.date || null,
      link: e.htmlLink || null,
      terminId: e.extendedProperties?.private?.patientenManagerTerminId ? Number(e.extendedProperties.private.patientenManagerTerminId) : null,
    }));
  }
}
