# EBE-Erfassung

Web-App für das iPhone zur Erfassung Erhöhter Beförderungsentgelte mit Belegdruck auf dem
Bixolon SPP-R310 über die App »BIXOLON mPrint«.

## Was im Ordner liegt

| Pfad | Zweck |
| --- | --- |
| `docs/` | Die fertige App. Diese sechs Dateien gehören auf den Webspace. |

| `src/` | Quelltext (Oberfläche `body.html`, Gestaltung `style.css`, Logik `app.js`). |
| `build.mjs`, `icons.mjs` | Bauen: `npm install`, dann `node build.mjs` (Icons: `node icons.mjs`). |


## Einrichtung

1. **Hochladen.** Den Inhalt von `docs/` auf einen Webspace mit HTTPS legen, zum Beispiel
   `https://www.ihr-unternehmen.de/ebe/`. HTTPS ist Pflicht, sonst sperrt das iPhone das
   Teilen-Menü und den Offline-Betrieb. Es wird kein Server-Programm und keine Datenbank benötigt.
2. **Auf dem iPhone öffnen.** Adresse in Safari aufrufen, dann Teilen → »Zum Home-Bildschirm«.
   Ab jetzt die App immer über dieses Symbol starten: Safari und das Home-Bildschirm-Symbol
   haben getrennte Datenspeicher.
3. **Einstellungen ausfüllen.** Prüfer (Name, Dienst-Nr.), Unternehmen, Bankverbindung, Logo.
   Die Dienst-Nr. ist Teil der Vorgangsnummer und muss je Gerät eindeutig sein.
4. **Drucker koppeln.** SPP-R310 in den iOS-Bluetooth-Einstellungen koppeln und in mPrint als
   Drucker auswählen (Papierbreite 80 mm bzw. 3 Zoll).
5. **Testen.** Einstellungen → »Musterbeleg anzeigen« → »Drucken« → im Teilen-Menü »mPrint« wählen.

## Ablauf bei einer Beanstandung

1. »Erfassen«: Feststellung, Fahrgast, Betrag und Zahlung eintragen, Fahrgast unterschreiben lassen.
2. »Speichern und Beleg anzeigen«: Der Vorgang erhält eine Nummer nach dem Muster
   `EBE-<Dienst-Nr.>-<JJMMTT>-<lfd. Nr.>` und der Beleg erscheint.
3. »Drucken«: Teilen-Menü → mPrint → Druck.

Der Beleg wird als Bild mit 576 Punkten Breite erzeugt (72 mm Druckbreite bei 203 dpi).
Druckt mPrint das Bild zu klein oder mit Rand, unter Einstellungen → Druck auf »PDF« umstellen.

Auf dem Beleg stehen: Unternehmen, Vorgangs-Nr., Feststellung, Fahrgastdaten, Betrag,
Zahlungsstatus, Bankverbindung mit GiroCode, Weiterfahrt-Hinweis, Rechtshinweise,
Unterschrift und Prüfer. Bei Sofortzahlung wird der Beleg zur Quittung.

## Daten

- Alle Vorgänge liegen nur auf dem jeweiligen iPhone (IndexedDB). Es werden keine Daten übertragen.
- Unter »Vorgänge« lassen sich eine CSV-Datei (für Excel) und eine Sicherung (JSON) exportieren.
  Die Sicherung kann auf einem anderen Gerät wieder eingelesen werden.
- Regelmäßig exportieren: Wird die App vom Home-Bildschirm gelöscht, sind die Daten weg.
- Stornierte Vorgänge bleiben in der Liste und sind als storniert gekennzeichnet.

## Vor dem Echtbetrieb prüfen

- **Rechtstexte.** Die Hinweise auf dem Beleg sind ein Vorschlag (§ 9 BefBedV, 60 EUR, Ermäßigung
  auf 7 EUR). Bitte mit den eigenen Beförderungsbedingungen abgleichen und in den Einstellungen anpassen.
- **Datenschutz.** Es werden personenbezogene Daten verarbeitet. Gerätesperre aktivieren,
  Verarbeitung im Verzeichnis nach Art. 30 DSGVO aufnehmen, Löschfristen festlegen.
- **Kassenführung.** Für Bar- und Kartenzahlungen ersetzt die App kein Kassensystem.

## Spätere Server-Anbindung

Jeder Vorgang trägt eine UUID (`id`), die Gerätekennung (`geraet`), `geaendertAm` und das Feld
`sync` (derzeit immer `lokal`). Eine Synchronisation kann darauf aufsetzen: Vorgänge mit
`sync = lokal` an den Server senden und bei Erfolg auf `gesendet` setzen. Die Speicherzugriffe
sind in `src/app.js` im Objekt `DB` gebündelt.
