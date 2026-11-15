// Baut aus src/ zwei Ausgaben:
//   docs/                 -> fertige Web-App zum Hochladen auf einen HTTPS-Webspace
//   vorschau/ebe-vorschau.html -> Vorschau-Fassung ohne Druck/Offline-Funktionen
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const lies = p => readFileSync(join(root, p), 'utf8');
const css = lies('src/style.css'), body = lies('src/body.html'), app = lies('src/app.js');
const qr = lies('node_modules/qrcode-generator/qrcode.js');
const titel = 'EBE-Erfassung';

mkdirSync(join(root, 'docs'), { recursive: true });
mkdirSync(join(root, 'vorschau'), { recursive: true });

writeFileSync(join(root, 'docs/index.html'), `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${titel}</title>
<meta name="theme-color" content="#eef1f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e151b" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="EBE">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png">
<style>
:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}
body{margin:0}
[hidden]{display:none!important}
${css}</style>
</head>
<body>
${body}
<script>${qr}</script>
<script>${app}</script>
</body>
</html>
`);

writeFileSync(join(root, 'docs/manifest.webmanifest'), JSON.stringify({
  name: 'EBE-Erfassung', short_name: 'EBE', lang: 'de', start_url: './', scope: './', display: 'standalone',
  background_color: '#eef1f4', theme_color: '#0b5a9c',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
}, null, 1));

const stand = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
writeFileSync(join(root, 'docs/sw.js'), `// Offline-Betrieb: Die App wird beim ersten Aufruf gespeichert und danach aus dem Speicher geladen.
const CACHE = 'ebe-${stand}';
const DATEIEN = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const kopie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopie)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
`);

writeFileSync(join(root, 'vorschau/ebe-vorschau.html'), `<title>${titel}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${body}
<script>${qr}</script>
<script>window.EBE_VORSCHAU = true;</script>
<script>${app}</script>
`);

console.log('gebaut:', existsSync(join(root, 'docs/icon-192.png')) ? 'docs/ und vorschau/' : 'docs/ und vorschau/ (Icons fehlen noch: node icons.mjs)');
