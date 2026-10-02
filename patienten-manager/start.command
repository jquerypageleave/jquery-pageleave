#!/usr/bin/env bash
# Startet den Patienten-Manager (macOS: Doppelklick auf start.command, Linux: ./start.sh)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden."
  echo "Bitte einmalig von https://nodejs.org die LTS-Version installieren und dieses Skript erneut starten."
  read -r -p "Enter zum Beenden ..."
  exit 1
fi

major=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$major" -lt 22 ]; then
  echo "Node.js ist zu alt (gefunden: $(node -v)). Es wird mindestens Version 22.13 benötigt."
  read -r -p "Enter zum Beenden ..."
  exit 1
fi

[ -d node_modules ] || { echo "Installiere Abhängigkeiten ..."; npm install --omit=dev; }
[ -f .env ] || cp .env.example .env

APP_PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
APP_PORT=${APP_PORT:-3000}

echo
echo "Patienten-Manager startet. Dieses Fenster bitte geöffnet lassen."
echo "Zum Beenden: Strg+C drücken oder Fenster schließen."
echo
( sleep 2; open "http://localhost:$APP_PORT" 2>/dev/null || xdg-open "http://localhost:$APP_PORT" 2>/dev/null ) &
exec node --no-warnings=ExperimentalWarning server.js
