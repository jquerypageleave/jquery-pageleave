import { loadEnvFile, getConfig } from './src/config.js';
import { openDatabase } from './src/db.js';
import { createApp } from './src/app.js';

loadEnvFile();
const config = getConfig();
const repo = openDatabase(config.dbPath);
const app = createApp({ repo, config });

const server = app.listen(config.port, () => {
  console.log(`Patienten-Manager läuft auf http://localhost:${config.port}`);
  console.log(`Datenbank: ${config.dbPath}`);
  if (!config.appPassword) console.log('Hinweis: Kein APP_PASSWORD gesetzt – die Oberfläche ist ohne Login erreichbar.');
  if (!config.google.clientId) console.log('Hinweis: GOOGLE_CLIENT_ID fehlt – Google-Kalender-Anbindung ist deaktiviert (siehe README).');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => { repo.close(); process.exit(0); });
  });
}
