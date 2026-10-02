@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Patienten-Manager

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte einmalig von https://nodejs.org die LTS-Version installieren und dieses Skript erneut starten.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 22 (
  echo Node.js ist zu alt. Es wird mindestens Version 22.13 benoetigt. Gefundene Version:
  node -v
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installiere Abhaengigkeiten ...
  call npm install --omit=dev
)
if not exist .env copy .env.example .env >nul

echo.
echo Patienten-Manager startet. Dieses Fenster bitte geoeffnet lassen.
echo Zum Beenden: Fenster schliessen oder Strg+C druecken.
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node --no-warnings=ExperimentalWarning server.js
pause
