/* Patienten-Manager – Frontend (ohne Abhängigkeiten) */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const state = { patienten: [], aktiv: null, termine: [], google: { verbunden: false, konfiguriert: false } };

  // ---- Hilfsfunktionen -------------------------------------------------

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
    if (!res.ok) {
      const err = new Error(data?.fehler || `Fehler ${res.status}`);
      err.felder = data?.felder || {};
      throw err;
    }
    return data;
  }

  let meldungTimer = null;
  function meldung(text, typ = '') {
    const el = $('#meldung');
    el.textContent = text;
    el.className = `meldung ${typ}`;
    el.hidden = false;
    clearTimeout(meldungTimer);
    meldungTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  const fmtDatum = (iso) => iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('de-DE') : '';
  const fmtZeit = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const fmtDatumZeit = (iso) => `${fmtDatum(iso)} ${fmtZeit(iso)}`;

  function alter(geburtsdatum) {
    if (!geburtsdatum) return '';
    const g = new Date(geburtsdatum);
    const heute = new Date();
    let a = heute.getFullYear() - g.getFullYear();
    const m = heute.getMonth() - g.getMonth();
    if (m < 0 || (m === 0 && heute.getDate() < g.getDate())) a -= 1;
    return `${a} Jahre`;
  }

  /** Date -> Wert für <input type="datetime-local"> in lokaler Zeit */
  function toLocalInput(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formDaten(form) {
    const fd = new FormData(form);
    const obj = {};
    for (const [k, v] of fd.entries()) obj[k] = v;
    for (const cb of form.querySelectorAll('input[type=checkbox]')) obj[cb.name] = cb.checked;
    return obj;
  }

  function zeigeFeldFehler(form, fehlerEl, err) {
    form.querySelectorAll('.fehler-feld').forEach((el) => el.classList.remove('fehler-feld'));
    const details = Object.entries(err.felder || {});
    for (const [feld] of details) form.elements[feld]?.classList.add('fehler-feld');
    fehlerEl.textContent = details.length ? details.map(([, m]) => m).join(' ') : err.message;
    fehlerEl.hidden = false;
  }

  // ---- Google-Status ---------------------------------------------------

  async function ladeGoogleStatus() {
    try {
      state.google = await api('/api/google/status');
    } catch (err) {
      state.google = { konfiguriert: false, verbunden: false };
    }
    const g = state.google;
    const dot = $('#google-dot');
    const text = $('#google-text');
    $('#google-connect').hidden = !(g.konfiguriert && !g.verbunden);
    $('#google-sync').hidden = !g.verbunden;
    $('#google-disconnect').hidden = !g.verbunden;
    if (!g.konfiguriert) {
      dot.className = 'dot off';
      text.textContent = 'Google Kalender: nicht konfiguriert (siehe README)';
    } else if (g.verbunden) {
      dot.className = 'dot ok';
      text.textContent = `Google Kalender: verbunden${g.konto ? ` (${g.konto})` : ''}`;
    } else {
      dot.className = 'dot warn';
      text.textContent = 'Google Kalender: nicht verbunden';
    }
    renderTermine();
  }

  $('#google-disconnect').addEventListener('click', async () => {
    if (!confirm('Verbindung zum Google Kalender trennen? Bestehende Kalendereinträge bleiben erhalten.')) return;
    try { await api('/api/google/disconnect', { method: 'POST' }); meldung('Google Kalender getrennt.', 'ok'); }
    catch (err) { meldung(err.message, 'fehler'); }
    ladeGoogleStatus();
  });

  $('#google-sync').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/api/google/sync', { method: 'POST' });
      const txt = `${r.synchronisiert} Termin(e) synchronisiert.` + (r.fehler.length ? ` ${r.fehler.length} Fehler: ${r.fehler.map((f) => f.fehler).join('; ')}` : '');
      meldung(txt, r.fehler.length ? 'fehler' : 'ok');
      if (state.aktiv) await ladeTermine();
    } catch (err) { meldung(err.message, 'fehler'); }
    e.target.disabled = false;
  });

  // ---- Patienten -------------------------------------------------------

  async function ladePatienten() {
    const suche = $('#suche').value.trim();
    state.patienten = await api(`/api/patienten?suche=${encodeURIComponent(suche)}`);
    renderPatienten();
  }

  function renderPatienten() {
    const ul = $('#patienten-liste');
    ul.innerHTML = '';
    $('#patienten-anzahl').textContent = state.patienten.length;
    $('#patienten-leer').hidden = state.patienten.length > 0;
    const tpl = $('#tpl-patient');
    for (const p of state.patienten) {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = p.id;
      li.classList.toggle('aktiv', state.aktiv?.id === p.id);
      li.querySelector('.eintrag-name').textContent = `${p.nachname}, ${p.vorname}`;
      const meta = [p.geburtsdatum ? `* ${fmtDatum(p.geburtsdatum)}` : '', p.email, p.telefon].filter(Boolean).join(' · ');
      li.querySelector('.eintrag-meta').textContent = meta;
      li.addEventListener('click', () => waehlePatient(p.id));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehlePatient(p.id); } });
      ul.appendChild(li);
    }
  }

  async function waehlePatient(id) {
    try {
      const p = await api(`/api/patienten/${id}`);
      state.aktiv = p;
      state.termine = p.termine || [];
      renderPatienten();
      renderDetail();
    } catch (err) { meldung(err.message, 'fehler'); }
  }

  function zeige(sektion) {
    $('#detail-leer').hidden = sektion !== 'leer';
    $('#patient-form').hidden = sektion !== 'form';
    $('#patient-detail').hidden = sektion !== 'detail';
  }

  function renderDetail() {
    const p = state.aktiv;
    if (!p) return zeige('leer');
    zeige('detail');
    $('#detail-name').textContent = `${p.anrede ? p.anrede + ' ' : ''}${p.vorname} ${p.nachname}`;
    const felder = [
      ['Geburtsdatum', p.geburtsdatum ? `${fmtDatum(p.geburtsdatum)} (${alter(p.geburtsdatum)})` : ''],
      ['E-Mail', p.email],
      ['Telefon', p.telefon],
      ['Adresse', [p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
      ['Krankenkasse', p.krankenkasse],
      ['Versichertennr.', p.versichertennummer],
      ['Notizen', p.notizen],
      ['Angelegt', fmtDatumZeit(p.erstellt_am)],
    ];
    const dl = $('#detail-daten');
    dl.innerHTML = '';
    for (const [k, v] of felder) {
      if (!v) continue;
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd');
      if (k === 'E-Mail') { const a = document.createElement('a'); a.href = `mailto:${v}`; a.textContent = v; dd.appendChild(a); }
      else dd.textContent = v;
      dl.append(dt, dd);
    }
    $('#termin-form').hidden = true;
    renderTermine();
  }

  function oeffnePatientForm(p) {
    const form = $('#patient-form');
    form.reset();
    form.querySelectorAll('.fehler-feld').forEach((el) => el.classList.remove('fehler-feld'));
    $('#form-fehler').hidden = true;
    form.dataset.id = p?.id || '';
    $('#form-titel').textContent = p ? 'Patient bearbeiten' : 'Neuer Patient';
    if (p) for (const el of form.elements) if (el.name && p[el.name] !== undefined) el.value = p[el.name];
    zeige('form');
    form.elements.vorname.focus();
  }

  $('#neu-patient').addEventListener('click', () => { state.aktiv = null; renderPatienten(); oeffnePatientForm(null); });
  $('#detail-bearbeiten').addEventListener('click', () => oeffnePatientForm(state.aktiv));
  $('#form-abbrechen').addEventListener('click', () => renderDetail());

  $('#patient-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const daten = formDaten(form);
    const id = form.dataset.id;
    try {
      const p = id
        ? await api(`/api/patienten/${id}`, { method: 'PUT', body: daten })
        : await api('/api/patienten', { method: 'POST', body: daten });
      meldung(id ? 'Patient gespeichert.' : 'Patient angelegt.', 'ok');
      await ladePatienten();
      await waehlePatient(p.id);
    } catch (err) {
      zeigeFeldFehler(form, $('#form-fehler'), err);
    }
  });

  $('#detail-loeschen').addEventListener('click', async () => {
    const p = state.aktiv;
    if (!p) return;
    if (!confirm(`Patient „${p.vorname} ${p.nachname}“ und alle zugehörigen Termine endgültig löschen?`)) return;
    try {
      const r = await api(`/api/patienten/${p.id}`, { method: 'DELETE' });
      meldung(r.warnungen?.length ? `Patient gelöscht. Hinweise: ${r.warnungen.join('; ')}` : 'Patient gelöscht.', r.warnungen?.length ? 'fehler' : 'ok');
      state.aktiv = null;
      await ladePatienten();
      renderDetail();
    } catch (err) { meldung(err.message, 'fehler'); }
  });

  let sucheTimer = null;
  $('#suche').addEventListener('input', () => {
    clearTimeout(sucheTimer);
    sucheTimer = setTimeout(() => ladePatienten().catch((err) => meldung(err.message, 'fehler')), 200);
  });

  // ---- Termine ---------------------------------------------------------

  async function ladeTermine() {
    if (!state.aktiv) return;
    state.termine = await api(`/api/termine?patient_id=${state.aktiv.id}`);
    renderTermine();
  }

  function renderTermine() {
    const ul = $('#termine-liste');
    if (!ul) return;
    ul.innerHTML = '';
    $('#termine-leer').hidden = state.termine.length > 0;
    const tpl = $('#tpl-termin');
    const jetzt = Date.now();
    for (const t of state.termine) {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.classList.toggle('vergangen', Date.parse(t.ende) < jetzt);
      li.querySelector('.termin-zeit').innerHTML = `${fmtDatum(t.beginn)}<small>${fmtZeit(t.beginn)} – ${fmtZeit(t.ende)}</small>`;
      li.querySelector('.termin-titel').textContent = t.titel;
      li.querySelector('.termin-notizen').textContent = t.notizen || '';
      const sync = li.querySelector('.termin-sync');
      if (t.google_event_id) {
        const veraltet = t.synchronisiert_am && t.geaendert_am && t.synchronisiert_am < t.geaendert_am;
        sync.innerHTML = veraltet ? '⚠ Änderung noch nicht im Kalender' : '✓ Im Google Kalender';
        if (t.google_html_link) {
          const a = document.createElement('a');
          a.href = t.google_html_link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'öffnen';
          sync.append(' · ', a);
        }
      } else {
        sync.textContent = state.google.verbunden ? 'Noch nicht im Google Kalender' : '';
      }
      const syncBtn = li.querySelector('.t-sync');
      syncBtn.hidden = !state.google.verbunden;
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        try { await api(`/api/termine/${t.id}/sync`, { method: 'POST' }); meldung('Termin in den Google Kalender übertragen.', 'ok'); await ladeTermine(); }
        catch (err) { meldung(err.message, 'fehler'); syncBtn.disabled = false; }
      });
      li.querySelector('.t-bearbeiten').addEventListener('click', () => oeffneTerminForm(t));
      li.querySelector('.t-loeschen').addEventListener('click', async () => {
        if (!confirm(`Termin „${t.titel}“ am ${fmtDatumZeit(t.beginn)} löschen?`)) return;
        try {
          const r = await api(`/api/termine/${t.id}`, { method: 'DELETE' });
          meldung(r.warnung ? `Termin gelöscht. Hinweis: ${r.warnung}` : 'Termin gelöscht.', r.warnung ? 'fehler' : 'ok');
          await ladeTermine();
        } catch (err) { meldung(err.message, 'fehler'); }
      });
      ul.appendChild(li);
    }
  }

  function oeffneTerminForm(t) {
    const form = $('#termin-form');
    form.reset();
    form.querySelectorAll('.fehler-feld').forEach((el) => el.classList.remove('fehler-feld'));
    $('#termin-fehler').hidden = true;
    form.elements.id.value = t?.id || '';
    if (t) {
      form.elements.titel.value = t.titel;
      form.elements.beginn.value = toLocalInput(t.beginn);
      const dauer = Math.round((Date.parse(t.ende) - Date.parse(t.beginn)) / 60000);
      if (![...form.elements.dauer.options].some((o) => Number(o.value) === dauer)) {
        const o = document.createElement('option'); o.value = dauer; o.textContent = `${dauer} Minuten`; form.elements.dauer.appendChild(o);
      }
      form.elements.dauer.value = dauer;
      form.elements.notizen.value = t.notizen || '';
      form.elements.patient_einladen.checked = Boolean(t.patient_einladen);
    } else {
      const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
      form.elements.beginn.value = toLocalInput(d);
    }
    form.elements.patient_einladen.disabled = !state.aktiv?.email;
    form.hidden = false;
    form.elements.titel.focus();
  }

  $('#neu-termin').addEventListener('click', () => oeffneTerminForm(null));
  $('#termin-abbrechen').addEventListener('click', () => { $('#termin-form').hidden = true; });

  $('#termin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const d = formDaten(form);
    const beginn = new Date(d.beginn);
    const ende = new Date(beginn.getTime() + Number(d.dauer) * 60000);
    const body = {
      patient_id: state.aktiv.id,
      titel: d.titel,
      beginn: Number.isNaN(beginn.getTime()) ? '' : beginn.toISOString(),
      ende: Number.isNaN(beginn.getTime()) ? '' : ende.toISOString(),
      notizen: d.notizen,
      patient_einladen: d.patient_einladen,
    };
    try {
      const r = d.id
        ? await api(`/api/termine/${d.id}`, { method: 'PUT', body })
        : await api('/api/termine', { method: 'POST', body });
      if (r.warnung) meldung(`Termin gespeichert, aber Kalender-Sync fehlgeschlagen: ${r.warnung}`, 'fehler');
      else meldung(state.google.verbunden ? 'Termin gespeichert und in den Google Kalender übertragen.' : 'Termin gespeichert.', 'ok');
      form.hidden = true;
      await ladeTermine();
    } catch (err) {
      zeigeFeldFehler(form, $('#termin-fehler'), err);
    }
  });

  // ---- Start -----------------------------------------------------------

  const params = new URLSearchParams(location.search);
  if (params.get('google') === 'verbunden') meldung('Google Kalender erfolgreich verbunden.', 'ok');
  if (params.get('google') === 'fehler') meldung(`Google-Verbindung fehlgeschlagen: ${params.get('meldung') || 'unbekannter Fehler'}`, 'fehler');
  if (params.has('google')) history.replaceState(null, '', location.pathname);

  ladeGoogleStatus();
  ladePatienten().catch((err) => meldung(err.message, 'fehler'));
})();
