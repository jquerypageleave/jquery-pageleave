# Patienten-Manager

Ein kleines, selbst gehostetes Patientenmanagementsystem mit lokaler SQLite-Datenbank
und Anbindung an den Google Kalender.

**Funktionen**

- Patienten erfassen, suchen, bearbeiten und löschen
  (Anrede, Vor-/Nachname, Geburtsdatum, E-Mail, Telefon, Adresse, Krankenkasse,
  Versichertennummer, Notizen)
- Termine pro Patient anlegen (Titel, Beginn, Dauer, Notizen)
- Termine automatisch in einen Google Kalender eintragen, aktualisieren und löschen
- Optional: Kalender-Einladung per E-Mail an den Patienten senden
- Optionaler Passwortschutz für die Oberfläche
- Keine Cloud-Datenbank: alle Daten liegen in einer SQLite-Datei auf Ihrem Rechner

Technik: Node.js ≥ 22.13 (eingebautes SQLite), Express, Google Calendar REST API v3.
Außer Express werden keine weiteren Pakete benötigt.

## Schnellstart ohne Kommandozeile (Doppelklick)

1. Einmalig [Node.js](https://nodejs.org) (LTS-Version, mindestens 22.13) installieren.
2. Den Ordner `patienten-manager` auf den Rechner kopieren (oder das ZIP entpacken).
3. Starten:
   - **Windows:** Doppelklick auf `start.bat`
   - **macOS:** Doppelklick auf `start.command` (beim ersten Mal ggf. Rechtsklick → „Öffnen“)
   - **Linux:** `./start.sh`

Das Skript installiert bei Bedarf die Abhängigkeiten, legt die `.env` an und öffnet
den Browser unter <http://localhost:3000>. Das Fenster muss geöffnet bleiben, solange
die App läuft.

Die App funktioniert vollständig offline: Daten liegen in `data/patienten.sqlite` auf
dem eigenen Rechner, es werden keine externen Skripte oder Dienste geladen. Nur die
Google-Kalender-Synchronisation benötigt eine Internetverbindung; ohne Verbindung
werden Termine lokal gespeichert und lassen sich später mit **Alle Termine
synchronisieren** nachträglich übertragen.

## Schnellstart mit Kommandozeile

```bash
cd patienten-manager
npm install
cp .env.example .env     # anpassen, siehe unten
npm start
```

Danach im Browser <http://localhost:3000> öffnen. Die Datenbank wird beim ersten Start
automatisch unter `data/patienten.sqlite` angelegt.

Tests ausführen:

```bash
npm test
```

## Konfiguration (`.env`)

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `PORT` | Port des Webservers | `3000` |
| `DB_PATH` | Pfad zur SQLite-Datei | `./data/patienten.sqlite` |
| `APP_USER` / `APP_PASSWORD` | Login für die Oberfläche (HTTP Basic Auth). Ohne `APP_PASSWORD` kein Login. | `praxis` / leer |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth-Zugangsdaten aus der Google Cloud Console | leer |
| `GOOGLE_REDIRECT_URI` | Muss exakt mit der in Google hinterlegten Weiterleitungs-URI übereinstimmen | `http://localhost:3000/auth/google/callback` |
| `GOOGLE_CALENDAR_ID` | Ziel-Kalender. `primary` = Hauptkalender, sonst die Kalender-ID aus den Google-Kalender-Einstellungen | `primary` |
| `TIMEZONE` | Zeitzone der Termine | `Europe/Berlin` |

## Google Kalender verbinden

Die App nutzt OAuth 2.0: Sie melden sich einmal mit Ihrem Google-Konto an und erlauben
der App, Termine in Ihren Kalender zu schreiben. Die Zugangs-Tokens werden in der
lokalen Datenbank gespeichert.

1. <https://console.cloud.google.com/> öffnen und ein Projekt anlegen (oder ein bestehendes wählen).
2. Unter **APIs und Dienste → Bibliothek** die **Google Calendar API** aktivieren.
3. Unter **APIs und Dienste → OAuth-Zustimmungsbildschirm** einen Zustimmungsbildschirm
   anlegen (Typ „Extern“ reicht, Status „Testen“). Unter **Testnutzer** das Google-Konto
   eintragen, dessen Kalender verwendet werden soll.
4. Unter **APIs und Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp: **Webanwendung**
   - Autorisierte Weiterleitungs-URI: `http://localhost:3000/auth/google/callback`
     (bzw. Ihre Adresse, passend zu `GOOGLE_REDIRECT_URI`)
5. Client-ID und Client-Secret in die `.env` eintragen und die App neu starten.
6. In der Oberfläche oben auf **Mit Google Kalender verbinden** klicken und den Zugriff
   bestätigen.

### Fehler „Access blocked: … has not completed the Google verification process“

Diese Meldung erscheint beim Verbinden, wenn die OAuth-App bei Google im Status
**Testen** steht und das verwendete Google-Konto nicht als **Testnutzer** eingetragen
ist. Lösung:

1. <https://console.cloud.google.com/> öffnen, oben das richtige Projekt wählen.
2. Links **APIs und Dienste → OAuth-Zustimmungsbildschirm** (neuere Oberfläche:
   **Google Auth Platform → Zielgruppe**).
3. Im Abschnitt **Testnutzer** auf **+ Add users** klicken, die E-Mail-Adresse des
   Google-Kontos eintragen, dessen Kalender verwendet wird, und speichern.
4. In der App erneut auf **Mit Google Kalender verbinden** klicken. Es erscheint
   eventuell noch der Hinweis „Google hat diese App nicht überprüft“. Dort auf
   **Weiter** klicken.

Wichtig: Im Status „Testen“ laufen die Zugangs-Tokens nach **7 Tagen** ab. Die App
zeigt dann „nicht verbunden“ an, und Sie müssen einmal neu verbinden. Wer das
vermeiden will, hat zwei Möglichkeiten:

- **Google-Workspace-Konto** (eigene Firmendomain): Beim Zustimmungsbildschirm
  Nutzertyp **Intern** wählen. Dann gibt es weder Testnutzer-Liste noch 7-Tage-Ablauf.
- **Privates Gmail-Konto**: Auf derselben Seite unter *Veröffentlichungsstatus* auf
  **App veröffentlichen** klicken. Eine Überprüfung durch Google ist dafür nicht
  nötig, solange nur Sie selbst die App nutzen. Beim Verbinden erscheint dann ein
  Warnhinweis („nicht überprüft“), den Sie über **Erweitert → Zu Patientenmanager
  (unsicher)** bestätigen. Danach läuft die Verbindung nicht mehr ab.

Ab dann gilt:

- Jeder neue oder geänderte Termin wird sofort in den Kalender geschrieben.
- Gelöschte Termine (oder gelöschte Patienten) werden auch aus dem Kalender entfernt.
- Termine, die vor der Verbindung angelegt wurden, übertragen Sie mit
  **Alle Termine synchronisieren**.
- Ist beim Termin „Kalender-Einladung an den Patienten senden“ angehakt und eine
  E-Mail-Adresse hinterlegt, erhält der Patient eine Einladung von Google.

Soll ein eigener Praxis-Kalender statt des Hauptkalenders verwendet werden: Im Google
Kalender den Kalender anlegen, unter *Einstellungen → Kalender integrieren* die
**Kalender-ID** kopieren und als `GOOGLE_CALENDAR_ID` eintragen.

## Datenschutz (DSGVO)

Patientendaten sind Gesundheitsdaten im Sinne von Art. 9 DSGVO. Bitte beachten Sie:

- `APP_PASSWORD` setzen, sobald die App nicht nur auf dem eigenen Rechner läuft, und
  dann nur über HTTPS (z. B. hinter einem Reverse-Proxy) betreiben.
- Mit der Google-Anbindung werden Name, Termin und ggf. E-Mail des Patienten an Google
  übertragen. Prüfen Sie, ob das mit Ihrer Datenschutzerklärung und Einwilligung der
  Patienten vereinbar ist. Notizen zum Termin landen ebenfalls in der Kalender-Beschreibung.
- Die SQLite-Datei (`data/`) regelmäßig sichern und den Zugriff auf das Verzeichnis beschränken.

## Projektstruktur

```
patienten-manager/
├── server.js          Startpunkt
├── src/
│   ├── app.js         Express-App und REST-API
│   ├── db.js          SQLite-Schema, Validierung, Datenzugriff
│   ├── google.js      OAuth 2.0 und Google-Calendar-Client
│   └── config.js      .env-Loader und Konfiguration
├── public/            Weboberfläche (HTML, CSS, JS ohne Framework)
└── test/              Tests (node:test), inkl. simuliertem Google-Server
```

## REST-API (Auszug)

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/api/patienten?suche=` | Patienten auflisten / suchen |
| `POST` | `/api/patienten` | Patient anlegen |
| `GET` / `PUT` / `DELETE` | `/api/patienten/:id` | Patient lesen (inkl. Termine), ändern, löschen |
| `GET` | `/api/termine?patient_id=&ab=&bis=` | Termine auflisten |
| `POST` / `PUT` / `DELETE` | `/api/termine[/:id]` | Termin anlegen, ändern, löschen (mit Kalender-Sync) |
| `POST` | `/api/termine/:id/sync` | Einzelnen Termin in den Kalender übertragen |
| `GET` | `/api/google/status` | Verbindungsstatus |
| `GET` | `/auth/google` | OAuth-Anmeldung starten |
| `POST` | `/api/google/sync` | Alle noch nicht übertragenen Termine synchronisieren |
| `POST` | `/api/google/disconnect` | Verbindung trennen |
| `GET` | `/api/google/events?limit=` | Kommende Kalendereinträge lesen |
