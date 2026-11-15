/* EBE-Erfassung: Erfassung Erhöhter Beförderungsentgelte mit Belegdruck über Bixolon mPrint.
   Alle Daten bleiben auf dem Gerät (IndexedDB). Jeder Vorgang trägt id (UUID), geraet und
   geaendertAm, damit später eine Server-Synchronisation ergänzt werden kann. */
(() => {
'use strict';

const VERSION = '1.1.0';
const VORSCHAU = !!window.EBE_VORSCHAU;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- Hilfsfunktionen ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const z2 = n => String(n).padStart(2, '0');
const isoTag = d => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
const heute = () => isoTag(new Date());
const jetztZeit = () => { const d = new Date(); return `${z2(d.getHours())}:${z2(d.getMinutes())}`; };
const plusTage = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoTag(d); };
const datumDE = iso => iso ? iso.split('-').reverse().join('.') : '';
const cent = s => {
  let t = String(s ?? '').replace(/[^\d.,-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? Math.round(n * 100) : 0;
};
const eur = c => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((c === 'x' ? Math.random() * 16 : 8 + Math.random() * 4) | 0).toString(16)));
const alter = (geb, am) => {
  if (!geb) return null;
  const [y, m, d] = geb.split('-').map(Number), [Y, M, D] = (am || heute()).split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
};
const ibanRoh = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const ibanOk = s => {
  const i = ibanRoh(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(i)) return false;
  const t = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
  let r = 0;
  for (const ch of t) r = (r * 10 + +ch) % 97;
  return r === 1;
};
const ibanSchoen = s => ibanRoh(s).replace(/(.{4})/g, '$1 ').trim();

let toastTimer;
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('an');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('an'), ms);
}
function frage(text, ja = 'OK') {
  const d = $('#frage');
  $('#frageText').textContent = text; $('#frageJa').textContent = ja;
  return new Promise(res => {
    const ende = w => { d.close(); $('#frageJa').onclick = $('#frageNein').onclick = d.oncancel = null; res(w); };
    $('#frageJa').onclick = () => ende(true);
    $('#frageNein').onclick = () => ende(false);
    d.oncancel = e => { e.preventDefault(); ende(false); };
    d.showModal();
  });
}

/* ---------- Speicher (IndexedDB, mit Ausweichspeicher im RAM) ---------- */
const DB = (() => {
  const ram = { vorgaenge: new Map(), kv: new Map() };
  let dbp, dauerhaft = true;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('ebe-erfassung', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('vorgaenge', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blockiert'));
  }).catch(() => { dauerhaft = false; return null; }));
  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) return fn(null);
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq ? rq.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  return {
    dauerhaft: () => dauerhaft,
    alle: () => tx('vorgaenge', 'readonly', s => s ? s.getAll() : [...ram.vorgaenge.values()]),
    speichern: v => tx('vorgaenge', 'readwrite', s => s ? s.put(v) : void ram.vorgaenge.set(v.id, v)),
    leeren: () => tx('vorgaenge', 'readwrite', s => s ? s.clear() : void ram.vorgaenge.clear()),
    get: k => tx('kv', 'readonly', s => s ? s.get(k) : ram.kv.get(k)),
    set: (k, v) => tx('kv', 'readwrite', s => s ? s.put(v, k) : void ram.kv.set(k, v)),
  };
})();

/* ---------- Einstellungen ---------- */
const STANDARD = {
  prueferName: '', prueferNr: '', firma: '', strasse: '', plzOrt: '', telefon: '', email: '', web: '', logo: '',
  empfaenger: '', iban: '', bic: '', bank: '',
  betrag: '60,00', ermaessigt: '7,00', fristTage: 14, praefix: 'EBE',
  linien: '',
  gruende: [
    'Ohne gültigen Fahrausweis angetroffen',
    'Fahrausweis nicht entwertet',
    'Fahrausweis zeitlich oder räumlich ungültig',
    'Persönliche Zeitkarte nicht vorgezeigt',
    'Ermäßigung ohne Berechtigungsnachweis genutzt',
    'Nicht übertragbaren Fahrausweis einer anderen Person genutzt',
    'Sonstige Beanstandung',
  ].join('\n'),
  hinweis: [
    'Rechtsgrundlage: § 9 der Verordnung über die Allgemeinen Beförderungsbedingungen (BefBedV) in Verbindung mit den Beförderungsbedingungen des Unternehmens.',
    'Das erhöhte Beförderungsentgelt ermäßigt sich auf {ermaessigt} EUR, wenn Sie innerhalb einer Woche ab dem Feststellungstag bei unserer Verwaltung nachweisen, dass Sie zum Zeitpunkt der Feststellung Inhaber einer gültigen persönlichen Zeitkarte waren.',
    'Bei nicht fristgerechter Zahlung entstehen zusätzliche Mahn- und Bearbeitungskosten.',
    'Datenschutz: Ihre Angaben werden zur Bearbeitung dieses Vorgangs verarbeitet (Art. 6 Abs. 1 lit. b und f DSGVO). Auskunft erteilt unsere Verwaltung.',
  ].join('\n'),
  fuss: '',
  format: 'pdf', breite: '576', teilung: '800',
};
const MUSTER_CFG = {
  prueferName: 'A. Beispiel', prueferNr: '0417', firma: 'Muster Verkehrsbetriebe GmbH', strasse: 'Am Betriebshof 1', plzOrt: '12345 Musterstadt',
  telefon: '01234 567890', web: 'www.muster-verkehr.example', empfaenger: 'Muster Verkehrsbetriebe GmbH',
  iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bank: 'Musterbank',
};
let cfg = { ...STANDARD };
let geraet = '';

/* ---------- Zustand ---------- */
let vorgaenge = [];
let aktuell = null;          // im Beleg angezeigter Vorgang
let bearbeiteId = null;      // gesetzt, wenn ein Vorgang korrigiert wird
let dateien = { png: null, pdf: null };
let filter = 'alle';

const FELDER = ['datum', 'zeit', 'linie', 'richtung', 'ort', 'fahrzeug', 'grund', 'grundText', 'fahrausweis',
  'anrede', 'vorname', 'nachname', 'gebdatum', 'gebort', 'strasse', 'plz', 'wohnort', 'land', 'ausweisart', 'ausweisnr', 'vertreter',
  'frist', 'weiterfahrtBis', 'bemerkung'];
const form = $('#v-erfassen');
const el = n => form.elements[n];

const offen = v => Math.max(0, v.betrag - v.gezahlt);
const status = v => v.storniert ? 'storniert' : offen(v) === 0 ? 'bezahlt' : v.gezahlt > 0 ? 'teilbezahlt' : 'offen';
const STATUS_TEXT = { offen: 'Offen', teilbezahlt: 'Teilzahlung', bezahlt: 'Bezahlt', storniert: 'Storniert' };

/* ---------- Unterschriftsfeld ---------- */
const Sig = (() => {
  const c = $('#sig'), ctx = c.getContext('2d');
  let leer = true, aktiv = false, letzter = null;
  const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  ctx.lineWidth = 4; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#000';
  c.addEventListener('pointerdown', e => {
    e.preventDefault(); c.setPointerCapture(e.pointerId); aktiv = true; letzter = pos(e);
    ctx.beginPath(); ctx.arc(letzter[0], letzter[1], 2, 0, 7); ctx.fillStyle = '#000'; ctx.fill(); leer = false;
  });
  c.addEventListener('pointermove', e => {
    if (!aktiv) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(letzter[0], letzter[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); letzter = p;
  });
  const ende = () => { if (aktiv) { aktiv = false; entwurfSichern(); } };
  c.addEventListener('pointerup', ende); c.addEventListener('pointercancel', ende);
  return {
    leeren() { ctx.clearRect(0, 0, c.width, c.height); leer = true; },
    daten: () => leer ? '' : c.toDataURL('image/png'),
    laden(url) {
      this.leeren();
      if (!url) return;
      const i = new Image(); i.onload = () => { ctx.drawImage(i, 0, 0, c.width, c.height); leer = false; }; i.src = url;
    },
  };
})();

/* ---------- Formular ---------- */
function formLeeren() {
  form.reset();
  bearbeiteId = null;
  el('datum').value = heute(); el('zeit').value = jetztZeit();
  el('land').value = 'Deutschland';
  el('betrag').value = eur(cent(cfg.betrag));
  el('gezahlt').value = '';
  el('frist').value = plusTage(heute(), +cfg.fristTage || 14);
  Sig.leeren();
  $$('.fehler', form).forEach(e => e.classList.remove('fehler'));
  $('#speichern').textContent = 'Speichern und Beleg anzeigen';
  formAnsicht();
}
function formLesen() {
  const v = {};
  FELDER.forEach(f => v[f] = el(f).value.trim());
  v.betrag = cent(el('betrag').value);
  v.zahlart = el('zahlart').value;
  v.gezahlt = v.zahlart === 'offen' ? 0 : Math.min(v.betrag, el('gezahlt').value.trim() === '' ? v.betrag : cent(el('gezahlt').value));
  if (v.gezahlt <= 0) { v.gezahlt = 0; v.zahlart = 'offen'; }
  v.weiterfahrt = el('weiterfahrt').checked;
  v.verweigert = el('verweigert').checked;
  v.unterschrift = v.verweigert ? '' : Sig.daten();
  return v;
}
function formFuellen(v) {
  FELDER.forEach(f => { el(f).value = v[f] ?? ''; });
  el('betrag').value = eur(v.betrag ?? cent(cfg.betrag));
  el('zahlart').value = v.zahlart || 'offen';
  el('gezahlt').value = v.gezahlt ? eur(v.gezahlt) : '';
  el('weiterfahrt').checked = !!v.weiterfahrt;
  el('verweigert').checked = !!v.verweigert;
  Sig.laden(v.unterschrift);
  formAnsicht();
}
function formAnsicht() {
  const za = el('zahlart').value, b = cent(el('betrag').value);
  $('#gezahltBlock').hidden = za === 'offen';
  const gez = za === 'offen' ? 0 : Math.min(b, el('gezahlt').value.trim() === '' ? b : cent(el('gezahlt').value));
  const rest = Math.max(0, b - gez);
  $('#fristBlock').hidden = rest === 0;
  $('#summeLabel').textContent = rest === 0 ? 'Vollständig bezahlt' : 'Noch zu zahlen';
  $('#summeWert').textContent = eur(rest === 0 ? b : rest) + ' €';
  $('#weiterBlock').hidden = !el('weiterfahrt').checked;
  const a = alter(el('gebdatum').value, el('datum').value);
  $('#vertreterBlock').hidden = !(a !== null && a >= 0 && a < 18);
}
let entwurfTimer;
function entwurfSichern() {
  clearTimeout(entwurfTimer);
  entwurfTimer = setTimeout(() => DB.set('entwurf', { ...formLesen(), _id: bearbeiteId }).catch(() => {}), 400);
}
function listenFuellen() {
  const gruende = cfg.gruende.split('\n').map(s => s.trim()).filter(Boolean);
  const alt = el('grund').value;
  el('grund').innerHTML = '<option value="">Bitte wählen</option>' + gruende.map(g => `<option>${esc(g)}</option>`).join('');
  if (alt && !gruende.includes(alt)) el('grund').insertAdjacentHTML('beforeend', `<option>${esc(alt)}</option>`);
  el('grund').value = alt;
  $('#linienListe').innerHTML = cfg.linien.split(',').map(s => s.trim()).filter(Boolean).map(l => `<option value="${esc(l)}">`).join('');
}

async function naechsteNummer(datum) {
  const tag = datum.slice(2).replace(/-/g, '');
  const z = (await DB.get('zaehler')) || {};
  const n = (z.tag === tag ? z.n : 0) + 1;
  await DB.set('zaehler', { tag, n });
  return [cfg.praefix || 'EBE', cfg.prueferNr || geraet.slice(0, 4).toUpperCase(), tag, String(n).padStart(3, '0')].join('-');
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const daten = formLesen();
  const pflicht = ['grund', 'vorname', 'nachname'].filter(f => !daten[f]);
  if (!daten.betrag) pflicht.push('betrag');
  $$('.fehler', form).forEach(x => x.classList.remove('fehler'));
  if (pflicht.length) {
    pflicht.forEach(f => el(f).classList.add('fehler'));
    el(pflicht[0]).scrollIntoView({ block: 'center' });
    toast('Bitte die markierten Pflichtfelder ausfüllen.');
    return;
  }
  const jetzt = new Date().toISOString();
  let v;
  if (bearbeiteId) {
    v = { ...vorgaenge.find(x => x.id === bearbeiteId), ...daten, geaendertAm: jetzt };
  } else {
    v = { id: uuid(), nummer: await naechsteNummer(daten.datum || heute()), erstelltAm: jetzt, geaendertAm: jetzt, geraet,
      prueferName: cfg.prueferName, prueferNr: cfg.prueferNr, storniert: false, drucke: 0, sync: 'lokal', ...daten };
  }
  try { await DB.speichern(v); } catch (err) { toast('Speichern fehlgeschlagen: ' + (err && err.message || 'Speicher nicht verfügbar')); return; }
  const i = vorgaenge.findIndex(x => x.id === v.id);
  if (i >= 0) vorgaenge[i] = v; else vorgaenge.push(v);
  await DB.set('entwurf', null).catch(() => {});
  formLeeren();
  toast('Vorgang ' + v.nummer + ' gespeichert');
  belegZeigen(v);
});
form.addEventListener('input', e => { e.target.classList.remove('fehler'); formAnsicht(); entwurfSichern(); });
form.addEventListener('change', e => {
  if (e.target.name === 'zahlart' && e.target.value !== 'offen' && !el('gezahlt').value) el('gezahlt').value = eur(cent(el('betrag').value));
  e.target.classList.remove('fehler'); formAnsicht(); entwurfSichern();
});
$('#sigLoeschen').onclick = () => { Sig.leeren(); entwurfSichern(); };
$('#verwerfen').onclick = async () => {
  if (await frage('Alle Eingaben in diesem Formular verwerfen?', 'Verwerfen')) { formLeeren(); DB.set('entwurf', null).catch(() => {}); }
};

/* ---------- Beleg zeichnen ---------- */
const bildLaden = url => new Promise(res => { if (!url) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });

async function belegZeichnen(v, c, canvas) {
  const W = +c.breite || 576, M = Math.round(W * 0.035), IW = W - 2 * M, k = W / 576;
  const S = n => Math.round(n * k);
  const SCHRIFT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const font = (g, fett) => `${fett ? 700 : 400} ${g}px ${SCHRIFT}`;
  const mess = document.createElement('canvas').getContext('2d');
  const ops = []; let y = S(12);
  const [logo, sig] = await Promise.all([bildLaden(c.logo), bildLaden(v.unterschrift)]);

  function umbruch(text, f, breite) {
    mess.font = f;
    const zeilen = [];
    for (const absatz of String(text).split('\n')) {
      let zeile = '';
      for (let wort of absatz.split(/\s+/).filter(Boolean)) {
        while (mess.measureText(wort).width > breite) {           // überlange Wörter hart trennen
          let n = wort.length;
          while (n > 1 && mess.measureText(wort.slice(0, n)).width > breite) n--;
          if (zeile) { zeilen.push(zeile); zeile = ''; }
          zeilen.push(wort.slice(0, n)); wort = wort.slice(n);
        }
        const probe = zeile ? zeile + ' ' + wort : wort;
        if (mess.measureText(probe).width <= breite) zeile = probe; else { zeilen.push(zeile); zeile = wort; }
      }
      zeilen.push(zeile);
    }
    return zeilen;
  }
  function text(str, o = {}) {
    if (str === '' || str == null) return;
    const g = S(o.g || 22), f = font(g, o.fett), zh = Math.round(g * 1.32), x0 = o.x ?? M, br = o.b ?? IW, aus = o.aus || 'left';
    const zeilen = umbruch(str, f, br), y0 = y;
    ops.push(ctx => {
      ctx.font = f; ctx.textAlign = aus; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#000';
      const x = aus === 'center' ? x0 + br / 2 : aus === 'right' ? x0 + br : x0;
      zeilen.forEach((z, i) => ctx.fillText(z, x, y0 + i * zh + Math.round(g * 1.02)));
    });
    y += zeilen.length * zh;
  }
  const abstand = n => { y += S(n); };
  function linie(d = 2, strich = false) {
    const y0 = y, h = S(d);
    ops.push(ctx => {
      ctx.fillStyle = '#000';
      if (!strich) return ctx.fillRect(M, y0, IW, h);
      for (let x = M; x < M + IW; x += S(12)) ctx.fillRect(x, y0, S(7), h);
    });
    y += h;
  }
  function paar(label, wert, o = {}) {
    if (wert === '' || wert == null) return;
    const lb = S(o.lb || 170), y0 = y;
    text(label, { g: o.g || 20, b: lb - S(8) });
    const y1 = y; y = y0;
    text(wert, { g: o.g || 20, fett: o.fett !== false, x: M + lb, b: IW - lb });
    y = Math.max(y, y1) + S(3);
  }
  function geld(label, wert, o = {}) {
    const y0 = y, g = o.g || 22;
    text(label, { g, fett: o.fett, b: IW - S(170) });
    const y1 = y; y = y0;
    text(wert, { g, fett: o.fett, aus: 'right' });
    y = Math.max(y, y1) + S(3);
  }
  function abschnitt(titel) {
    abstand(14); text(titel.toUpperCase(), { g: 18, fett: true }); abstand(2); linie(2); abstand(8);
  }
  function rahmen(zeichne) {
    const y0 = y; y += S(12); zeichne(); y += S(12);
    const h = y - y0;
    ops.push(ctx => { ctx.strokeStyle = '#000'; ctx.lineWidth = S(3); ctx.strokeRect(M + S(1.5), y0 + S(1.5), IW - S(3), h - S(3)); });
  }
  function bild(img, maxB, maxH) {
    if (!img) return;
    const f = Math.min(maxB / img.width, maxH / img.height, 1), b = Math.round(img.width * f), h = Math.round(img.height * f), y0 = y;
    ops.push(ctx => ctx.drawImage(img, Math.round((W - b) / 2), y0, b, h));
    y += h;
  }
  function qr(inhalt) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, 'M'); q.addData(inhalt, 'Byte'); q.make();
    const n = q.getModuleCount(), p = Math.max(3, Math.floor(S(250) / n)), b = n * p, x0 = Math.round((W - b) / 2), y0 = y;
    ops.push(ctx => {
      ctx.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let s = 0; s < n; s++) if (q.isDark(r, s)) ctx.fillRect(x0 + s * p, y0 + r * p, p, p);
    });
    y += b;
  }

  const rest = offen(v);

  /* Kopf */
  if (v.muster) { text('MUSTER – KEIN GÜLTIGER BELEG', { g: 20, fett: true, aus: 'center' }); abstand(8); }
  if (logo) { bild(logo, IW * 0.8, S(130)); abstand(8); }
  text(c.firma || 'Verkehrsunternehmen', { g: 28, fett: true, aus: 'center' });
  text([c.strasse, c.plzOrt].filter(Boolean).join(', '), { g: 19, aus: 'center' });
  text([c.telefon && 'Tel. ' + c.telefon, c.email].filter(Boolean).join(' · '), { g: 19, aus: 'center' });
  text(c.web, { g: 19, aus: 'center' });
  abstand(12); linie(4); abstand(12);
  text('ERHÖHTES BEFÖRDERUNGSENTGELT', { g: 31, fett: true, aus: 'center' });
  abstand(2);
  text(rest === 0 ? 'Quittung' : v.gezahlt > 0 ? 'Zahlungsaufforderung mit Teilquittung' : 'Zahlungsaufforderung', { g: 23, aus: 'center' });
  if (v.storniert) { abstand(8); rahmen(() => text('STORNIERT', { g: 34, fett: true, aus: 'center' })); }
  abstand(12); linie(4); abstand(10);
  paar('Vorgangs-Nr.', v.nummer, { g: 22 });
  paar('Datum', datumDE(v.datum) + (v.zeit ? ', ' + v.zeit + ' Uhr' : ''));

  /* Feststellung */
  abschnitt('Feststellung');
  paar('Linie', [v.linie, v.richtung && 'Richtung ' + v.richtung].filter(Boolean).join(', '));
  paar('Ort', v.ort);
  paar('Fahrzeug', v.fahrzeug);
  paar('Beanstandung', v.grund);
  paar('Erläuterung', v.grundText);
  paar('Vorgezeigt', v.fahrausweis);

  /* Fahrgast */
  abschnitt('Fahrgast');
  paar('Name', [v.anrede, v.vorname, v.nachname].filter(Boolean).join(' '));
  paar('Geboren', [datumDE(v.gebdatum), v.gebort && 'in ' + v.gebort].filter(Boolean).join(' '));
  paar('Anschrift', [v.strasse, [v.plz, v.wohnort].filter(Boolean).join(' '), v.land && v.land !== 'Deutschland' ? v.land : ''].filter(Boolean).join('\n'));
  paar('Ausweis', [v.ausweisart, v.ausweisnr].filter(Boolean).join(' '));
  paar('Ges. Vertreter', v.vertreter);

  /* Betrag */
  abschnitt('Betrag');
  geld('Erhöhtes Beförderungsentgelt', eur(v.betrag) + ' EUR');
  if (v.gezahlt > 0) geld('Gezahlt (' + ({ bar: 'bar', karte: 'Karte' }[v.zahlart] || 'nachträglich') + ')', '−' + eur(v.gezahlt) + ' EUR');
  abstand(8);
  rahmen(() => {
    const x = M + S(14), b = IW - S(28), y0 = y;
    text(rest === 0 ? 'Betrag erhalten' : 'Noch zu zahlen', { g: 24, fett: true, x, b: b - S(200) });
    const y1 = y; y = y0 - S(4);
    text(eur(rest === 0 ? v.betrag : rest) + ' EUR', { g: 32, fett: true, x, b, aus: 'right' });
    y = Math.max(y, y1);
  });

  /* Zahlung */
  if (rest > 0 && !v.storniert) {
    abschnitt('Zahlung per Überweisung');
    paar('Zahlbar bis', datumDE(v.frist), { g: 22 });
    paar('Empfänger', c.empfaenger || c.firma);
    paar('IBAN', ibanSchoen(c.iban));
    paar('BIC', c.bic);
    paar('Bank', c.bank);
    paar('Verwendungszweck', v.nummer, { g: 22, lb: 220 });
    if (ibanOk(c.iban) && (c.empfaenger || c.firma)) {
      abstand(14);
      qr(['BCD', '002', '1', 'SCT', (c.bic || '').replace(/\s/g, ''), (c.empfaenger || c.firma).slice(0, 70), ibanRoh(c.iban),
        'EUR' + (rest / 100).toFixed(2), '', '', v.nummer, ''].join('\n'));
      abstand(8);
      text('GiroCode: mit der Banking-App scannen', { g: 18, aus: 'center' });
    }
  }

  /* Weiterfahrt, Bemerkung */
  if (!v.storniert) {
    abstand(16); linie(2, true); abstand(10);
    text(v.weiterfahrt
      ? 'Dieser Beleg gilt am ' + datumDE(v.datum) + ' als Fahrausweis für die Weiterfahrt' + (v.weiterfahrtBis ? ' bis ' + v.weiterfahrtBis : '') + '.'
      : 'Dieser Beleg berechtigt nicht zur Weiterfahrt.', { g: 20, fett: true, aus: 'center' });
    abstand(10); linie(2, true);
  }
  if (v.bemerkung) { abschnitt('Bemerkung'); text(v.bemerkung, { g: 20 }); }

  /* Hinweise */
  const hinweis = (c.hinweis || '').replace(/\{ermaessigt\}/g, eur(cent(c.ermaessigt)));
  if (hinweis.trim()) {
    abschnitt('Hinweise');
    hinweis.split('\n').filter(s => s.trim()).forEach(p => { text(p, { g: 17 }); abstand(6); });
  }

  /* Unterschriften */
  abstand(18);
  if (v.verweigert) text('Unterschrift des Fahrgasts: verweigert', { g: 19 });
  else {
    if (sig) bild(sig, S(360), S(120)); else abstand(70);
    linie(1); abstand(3); text('Unterschrift Fahrgast', { g: 17 });
  }
  abstand(12);
  paar('Prüfer', [v.prueferName, v.prueferNr && 'Dienst-Nr. ' + v.prueferNr].filter(Boolean).join(', '), { fett: false, lb: 110 });
  if (c.fuss) { abstand(10); text(c.fuss, { g: 18, aus: 'center' }); }
  if (v.muster) { abstand(10); text('MUSTER – KEIN GÜLTIGER BELEG', { g: 20, fett: true, aus: 'center' }); }
  y += S(48);

  canvas.width = W; canvas.height = y;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, y);
  ops.forEach(op => op(ctx));
  return canvas;
}

/* ---------- PNG / PDF ---------- */
const alsBlob = (canvas, typ, q) => new Promise(res => canvas.toBlob(res, typ, q));
/* Zerlegt den Beleg an weißen Zeilen in Abschnitte von höchstens maxH Punkten Höhe. */
function abschnitte(canvas, maxH) {
  if (!maxH || canvas.height <= maxH) return [canvas];
  const W = canvas.width, H = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const weiss = y => { for (let x = 0, i = y * W * 4; x < W; x++, i += 4) if (d[i] < 200) return false; return true; };
  const teile = []; let y0 = 0;
  while (y0 < H) {
    let y1 = Math.min(H, y0 + maxH);
    if (y1 < H) { let y = y1; while (y > y0 + maxH / 2 && !weiss(y)) y--; if (y > y0 + maxH / 2) y1 = y; }
    const c = document.createElement('canvas'); c.width = W; c.height = y1 - y0;
    c.getContext('2d').drawImage(canvas, 0, y0, W, y1 - y0, 0, 0, W, y1 - y0);
    teile.push(c); y0 = y1;
  }
  return teile;
}
async function alsPdf(seiten) {
  const bMm = seiten[0].width >= 500 ? 72 : 48, b = bMm / 25.4 * 72;
  const enc = new TextEncoder(), teile = [], pos = [];
  let laenge = 0;
  const raus = d => { const u = typeof d === 'string' ? enc.encode(d) : d; teile.push(u); laenge += u.length; };
  const obj = (n, inhalt) => { pos[n] = laenge; raus(`${n} 0 obj\n`); inhalt(); raus('\nendobj\n'); };
  raus('%PDF-1.4\n');
  obj(1, () => raus('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => raus(`<< /Type /Pages /Kids [${seiten.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${seiten.length} >>`));
  for (let i = 0; i < seiten.length; i++) {
    const c = seiten[i], n = 3 + i * 3, h = b * c.height / c.width;
    const jpg = new Uint8Array(await (await alsBlob(c, 'image/jpeg', 0.95)).arrayBuffer());
    obj(n, () => raus(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${b.toFixed(2)} ${h.toFixed(2)}] /Resources << /XObject << /B ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`));
    obj(n + 1, () => {
      raus(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      raus(jpg); raus('\nendstream');
    });
    const inhalt = `q ${b.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /B Do Q`;
    obj(n + 2, () => raus(`<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`));
  }
  const anz = 3 + seiten.length * 3, xref = laenge;
  raus(`xref\n0 ${anz}\n0000000000 65535 f \n` + pos.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  raus(`trailer\n<< /Size ${anz} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(teile, { type: 'application/pdf' });
}

/* ---------- Teilen (Übergabe an mPrint) ---------- */
async function teilen(datei) {
  const liste = [].concat(datei); datei = liste[0];
  if (navigator.canShare && navigator.canShare({ files: liste })) {
    try { await navigator.share({ files: liste }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  if (VORSCHAU) { toast('In dieser Vorschau ist das Teilen-Menü gesperrt. Drucken geht in der installierten App.', 4500); return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(datei); a.download = datei.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Datei gespeichert: ' + datei.name);
  return true;
}

/* ---------- Belegansicht ---------- */
async function belegZeigen(v) {
  aktuell = v;
  const c = v.muster ? { ...cfg, ...Object.fromEntries(Object.entries(MUSTER_CFG).filter(([k]) => !cfg[k])) } : cfg;
  const canvas = $('#belegCanvas');
  await belegZeichnen(v, c, canvas);
  dateien = { png: null, pdf: null };
  const name = v.nummer;
  const seiten = abschnitte(canvas, +cfg.teilung || 0);
  Promise.all(seiten.map(c => alsBlob(c, 'image/png'))).then(bs => {
    dateien.png = bs.map((b, i) => new File([b], name + (bs.length > 1 ? '-' + (i + 1) : '') + '.png', { type: 'image/png' }));
  });
  alsPdf(seiten).then(b => { dateien.pdf = new File([b], name + '.pdf', { type: 'application/pdf' }); });
  const st = status(v);
  $('#belegNr').textContent = v.nummer;
  $('#belegStatus').textContent = v.muster ? 'Muster' : STATUS_TEXT[st];
  $('#belegStatus').className = 'pill ' + (v.muster ? 'teilbezahlt' : st);
  $('#alsAnderes').textContent = cfg.format === 'pdf' ? 'Als Bild teilen' : 'Als PDF teilen';
  $('#korrigieren').hidden = $('#storno').hidden = !!v.muster || v.storniert;
  $('#bezahlt').hidden = !!v.muster || v.storniert || st === 'bezahlt';
  zeige('beleg');
}
async function belegTeilen(typ) {
  const d = dateien[typ];
  if (!d) return toast('Der Beleg wird noch aufbereitet. Bitte erneut tippen.');
  if (await teilen(d) && aktuell && !aktuell.muster) {
    aktuell.drucke = (aktuell.drucke || 0) + 1;
    DB.speichern(aktuell).catch(() => {});
  }
}
$('#drucken').onclick = () => belegTeilen(cfg.format === 'pdf' ? 'pdf' : 'png');
$('#alsAnderes').onclick = () => belegTeilen(cfg.format === 'pdf' ? 'png' : 'pdf');
$('#neu').onclick = () => zeige('erfassen');
$('#korrigieren').onclick = () => {
  formLeeren(); bearbeiteId = aktuell.id; formFuellen(aktuell);
  $('#speichern').textContent = 'Korrektur speichern';
  zeige('erfassen');
};
async function aendern(werte, meldung) {
  Object.assign(aktuell, werte, { geaendertAm: new Date().toISOString() });
  await DB.speichern(aktuell);
  toast(meldung);
  belegZeigen(aktuell);
}
$('#bezahlt').onclick = async () => {
  if (await frage(`Vorgang ${aktuell.nummer} als vollständig bezahlt markieren (${eur(offen(aktuell))} EUR)?`, 'Bezahlt'))
    aendern({ gezahlt: aktuell.betrag, zahlart: aktuell.zahlart === 'offen' ? 'nachtraeglich' : aktuell.zahlart }, 'Als bezahlt markiert');
};
$('#storno').onclick = async () => {
  if (await frage(`Vorgang ${aktuell.nummer} stornieren? Der Vorgang bleibt in der Liste und wird als storniert gekennzeichnet.`, 'Stornieren'))
    aendern({ storniert: true }, 'Vorgang storniert');
};
function musterZeigen() {
  belegZeigen({
    muster: true, nummer: 'EBE-0417-' + heute().slice(2).replace(/-/g, '') + '-001', datum: heute(), zeit: '14:32',
    linie: 'M4', richtung: 'Hauptbahnhof', ort: 'Rathausplatz', fahrzeug: '2207', grund: 'Ohne gültigen Fahrausweis angetroffen', grundText: '', fahrausweis: '',
    anrede: 'Herr', vorname: 'Max', nachname: 'Mustermann', gebdatum: '1990-01-01', gebort: 'Musterstadt', strasse: 'Musterstraße 1', plz: '12345', wohnort: 'Musterstadt', land: 'Deutschland',
    ausweisart: 'Personalausweis', ausweisnr: 'L01X00T47', vertreter: '', betrag: cent(cfg.betrag) || 6000, gezahlt: 0, zahlart: 'offen',
    frist: plusTage(heute(), +cfg.fristTage || 14), weiterfahrt: true, weiterfahrtBis: 'Hauptbahnhof', bemerkung: '', unterschrift: '', verweigert: false,
    prueferName: cfg.prueferName || MUSTER_CFG.prueferName, prueferNr: cfg.prueferNr || MUSTER_CFG.prueferNr, storniert: false,
  });
}
$('#testbeleg').onclick = musterZeigen;

/* ---------- Vorgangsliste ---------- */
function listeZeichnen() {
  const q = $('#suche').value.trim().toLowerCase();
  const treffer = vorgaenge
    .filter(v => filter === 'alle' || (filter === 'offen' ? ['offen', 'teilbezahlt'].includes(status(v)) : status(v) === filter))
    .filter(v => !q || [v.nummer, v.vorname, v.nachname, v.linie, v.ort].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
  const summe = treffer.filter(v => !v.storniert).reduce((s, v) => s + offen(v), 0);
  $('#listenInfo').textContent = `${treffer.length} ${treffer.length === 1 ? 'Vorgang' : 'Vorgänge'} · ${eur(summe)} € offen`;
  $('#liste').innerHTML = treffer.length ? treffer.map(v => {
    const st = status(v);
    return `<button class="vg" type="button" data-id="${esc(v.id)}">
      <span class="name">${esc(v.nachname)}, ${esc(v.vorname)}</span><span class="betrag">${eur(v.betrag)} €</span>
      <span class="meta">${esc(v.nummer)} · ${esc(datumDE(v.datum))} ${esc(v.zeit)}${v.linie ? ' · Linie ' + esc(v.linie) : ''}</span><span class="pill ${st}">${STATUS_TEXT[st]}</span>
    </button>`;
  }).join('') : `<div class="leer">${vorgaenge.length ? 'Kein Vorgang passt zur Suche.' : 'Noch keine Vorgänge. Neue Vorgänge legen Sie unter »Erfassen« an.'}</div>`;
}
$('#liste').onclick = e => { const b = e.target.closest('.vg'); if (b) belegZeigen(vorgaenge.find(v => v.id === b.dataset.id)); };
$('#suche').oninput = listeZeichnen;
$('#filter').onclick = e => {
  const b = e.target.closest('.chip'); if (!b) return;
  filter = b.dataset.f;
  $$('#filter .chip').forEach(c => c.setAttribute('aria-pressed', c === b));
  listeZeichnen();
};

/* ---------- Export / Import ---------- */
const CSV_SPALTEN = ['nummer', 'status', 'datum', 'zeit', 'linie', 'richtung', 'ort', 'fahrzeug', 'grund', 'grundText', 'fahrausweis',
  'anrede', 'vorname', 'nachname', 'gebdatum', 'gebort', 'strasse', 'plz', 'wohnort', 'land', 'ausweisart', 'ausweisnr', 'vertreter',
  'betrag', 'gezahlt', 'offen', 'zahlart', 'frist', 'weiterfahrt', 'weiterfahrtBis', 'bemerkung', 'unterschrift', 'prueferName', 'prueferNr', 'erstelltAm', 'geaendertAm', 'id'];
function csvText() {
  const zelle = w => '"' + String(w ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const zeilen = vorgaenge.map(v => CSV_SPALTEN.map(s => zelle(
    s === 'status' ? STATUS_TEXT[status(v)] : s === 'offen' ? eur(v.storniert ? 0 : offen(v)) : s === 'betrag' || s === 'gezahlt' ? eur(v[s] || 0)
      : s === 'weiterfahrt' ? (v.weiterfahrt ? 'ja' : 'nein') : s === 'unterschrift' ? (v.verweigert ? 'verweigert' : v.unterschrift ? 'ja' : 'nein') : v[s])).join(';'));
  return '﻿' + [CSV_SPALTEN.join(';'), ...zeilen].join('\r\n');
}
$('#csv').onclick = () => {
  if (!vorgaenge.length) return toast('Es gibt noch keine Vorgänge.');
  teilen(new File([csvText()], `EBE-Vorgaenge-${heute()}.csv`, { type: 'text/csv' }));
};
$('#sicherung').onclick = () => {
  if (!vorgaenge.length) return toast('Es gibt noch keine Vorgänge.');
  teilen(new File([JSON.stringify({ app: 'ebe-erfassung', version: VERSION, exportiertAm: new Date().toISOString(), geraet, vorgaenge }, null, 1)],
    `EBE-Sicherung-${heute()}.json`, { type: 'application/json' }));
};
$('#importBtn').onclick = () => $('#importDatei').click();
$('#importDatei').onchange = async e => {
  const d = e.target.files[0]; e.target.value = '';
  if (!d) return;
  try {
    const daten = JSON.parse(await d.text());
    if (daten.app !== 'ebe-erfassung' || !Array.isArray(daten.vorgaenge)) throw new Error();
    let n = 0;
    for (const v of daten.vorgaenge) {
      if (!v.id || !v.nummer) continue;
      const alt = vorgaenge.find(x => x.id === v.id);
      if (alt && (alt.geaendertAm || '') >= (v.geaendertAm || '')) continue;
      await DB.speichern(v); n++;
    }
    vorgaenge = await DB.alle();
    listeZeichnen();
    toast(`${n} ${n === 1 ? 'Vorgang' : 'Vorgänge'} eingelesen`);
  } catch { toast('Die Datei ist keine gültige EBE-Sicherung.'); }
};

/* ---------- Einstellungen ---------- */
let cfgTimer;
function cfgSichern() {
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(async () => {
    try { await DB.set('einstellungen', cfg); $('#kopfInfo').textContent = 'Gespeichert'; setTimeout(kopfInfo, 1500); } catch { toast('Einstellungen konnten nicht gespeichert werden.'); }
  }, 400);
}
function cfgAnzeigen() {
  $$('[data-cfg]').forEach(i => { i.value = cfg[i.dataset.cfg] ?? ''; });
  $('#ibanHinweis').hidden = !cfg.iban || ibanOk(cfg.iban);
  $('#logoBild').hidden = $('#logoWeg').hidden = !cfg.logo;
  if (cfg.logo) $('#logoBild').src = cfg.logo;
  $('#speicherInfo').textContent = `${vorgaenge.length} ${vorgaenge.length === 1 ? 'Vorgang' : 'Vorgänge'} auf diesem Gerät gespeichert.`
    + (DB.dauerhaft() ? '' : ' Achtung: Der Gerätespeicher ist hier nicht verfügbar, die Daten gehen beim Schließen verloren.');
  $('#version').textContent = `EBE-Erfassung ${VERSION} · Gerätekennung ${geraet.slice(0, 8)}`;
}
$('#v-einstellungen').addEventListener('input', e => {
  const k = e.target.dataset.cfg; if (!k) return;
  cfg[k] = e.target.value;
  if (k === 'iban') $('#ibanHinweis').hidden = !cfg.iban || ibanOk(cfg.iban);
  if (k === 'gruende' || k === 'linien') listenFuellen();
  cfgSichern(); bannerPruefen();
});
$('#logoBtn').onclick = () => $('#logoDatei').click();
$('#logoDatei').onchange = async e => {
  const d = e.target.files[0]; e.target.value = '';
  if (!d) return;
  const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(d); });
  const img = await bildLaden(url);
  if (!img) return toast('Das Bild konnte nicht gelesen werden.');
  const f = Math.min(1, 460 / img.width, 200 / img.height), c = document.createElement('canvas');
  c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  cfg.logo = c.toDataURL('image/png'); cfgSichern(); cfgAnzeigen();
};
$('#logoWeg').onclick = () => { cfg.logo = ''; cfgSichern(); cfgAnzeigen(); };
$('#allesLoeschen').onclick = async () => {
  if (!vorgaenge.length) return toast('Es sind keine Vorgänge gespeichert.');
  if (!await frage(`Wirklich alle ${vorgaenge.length} Vorgänge von diesem Gerät löschen? Das lässt sich nicht rückgängig machen. Bitte vorher eine Sicherung exportieren.`, 'Alle löschen')) return;
  await DB.leeren(); vorgaenge = []; cfgAnzeigen(); toast('Alle Vorgänge gelöscht');
};

/* ---------- Navigation ---------- */
const TITEL = { erfassen: 'Erfassen', liste: 'Vorgänge', beleg: 'Beleg', einstellungen: 'Einstellungen' };
function kopfInfo() { $('#kopfInfo').textContent = cfg.prueferName ? `${cfg.prueferName}${cfg.prueferNr ? ' · ' + cfg.prueferNr : ''}` : ''; }
function zeige(name) {
  $$('.view').forEach(v => { v.hidden = v.id !== 'v-' + name; });
  $$('.tabs button').forEach(b => b.dataset.view === (name === 'beleg' ? 'liste' : name) ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('#viewTitle').textContent = name === 'erfassen' && bearbeiteId ? 'Korrigieren' : TITEL[name];
  if (name === 'liste') listeZeichnen();
  if (name === 'einstellungen') cfgAnzeigen();
  if (name === 'erfassen' && !bearbeiteId && !el('vorname').value && !el('nachname').value) { el('datum').value = heute(); el('zeit').value = jetztZeit(); }
  kopfInfo(); bannerPruefen();
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach(b => { b.onclick = () => zeige(b.dataset.view); });
function bannerPruefen() {
  const fehlt = !cfg.firma || !cfg.prueferName || !cfg.prueferNr;
  const text = VORSCHAU ? 'Vorschau zum Ausprobieren. Bitte keine echten Personendaten eingeben; gedruckt wird erst in der installierten App.'
    : fehlt ? 'Bitte zuerst Unternehmen, Prüfer und Bankverbindung eintragen.' : '';
  $('#banner').hidden = !text || !$('#v-einstellungen').hidden;
  $('#bannerText').textContent = text;
  $('#bannerBtn').hidden = VORSCHAU || !fehlt;
}
$('#bannerBtn').onclick = () => zeige('einstellungen');

/* ---------- Start ---------- */
(async () => {
  try {
    cfg = { ...STANDARD, ...((await DB.get('einstellungen')) || {}) };
    geraet = (await DB.get('geraet')) || uuid();
    await DB.set('geraet', geraet);
    vorgaenge = (await DB.alle()) || [];
  } catch { geraet = geraet || uuid(); }
  listenFuellen();
  formLeeren();
  const entwurf = await DB.get('entwurf').catch(() => null);
  if (entwurf && (entwurf.vorname || entwurf.nachname || entwurf.grund)) {
    if (entwurf._id && vorgaenge.some(v => v.id === entwurf._id)) { bearbeiteId = entwurf._id; $('#speichern').textContent = 'Korrektur speichern'; }
    formFuellen(entwurf);
  }
  if (VORSCHAU) musterZeigen(); else zeige('erfassen');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (!VORSCHAU && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
