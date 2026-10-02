import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimaler .env-Loader (ohne externe Abhängigkeit).
 * Bereits gesetzte Umgebungsvariablen haben Vorrang vor der .env-Datei.
 */
export function loadEnvFile(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function getConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  return {
    root,
    port,
    dbPath: path.resolve(root, env.DB_PATH || './data/patienten.sqlite'),
    appUser: env.APP_USER || 'praxis',
    appPassword: env.APP_PASSWORD || '',
    timezone: env.TIMEZONE || 'Europe/Berlin',
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`,
      calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
    },
  };
}
