// Erzeugt die App-Icons in docs/ (benötigt Playwright/Chromium, nur beim Bauen).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0b5a9c"/>
<path d="M150 96h212v318l-35-24-35 24-36-24-36 24-35-24-35 24z" fill="#fff"/>
<rect x="186" y="146" width="140" height="18" rx="4" fill="#0b5a9c"/>
<rect x="186" y="190" width="100" height="12" rx="4" fill="#9db9d3"/>
<rect x="186" y="216" width="140" height="12" rx="4" fill="#9db9d3"/>
<text x="256" y="322" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="76" text-anchor="middle" fill="#0b5a9c">EBE</text>
</svg>`;
const b = await chromium.launch();
for (const g of [180, 192, 512]) {
  const p = await b.newPage({ viewport: { width: g, height: g } });
  await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${g}" height="${g}" `)}</body>`);
  await p.screenshot({ path: join(root, `docs/icon-${g}.png`) });
  await p.close();
}
await b.close();
console.log('Icons erzeugt');
