#!/usr/bin/env node
// Encrypts the page list HTML and embeds it into index.html
// Usage: node build-index.mjs <password>

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { webcrypto } from 'crypto';

const PASSWORD = process.argv[2];
if (!PASSWORD) { console.error('Usage: node build-index.mjs <password>'); process.exit(1); }

const SALT = new Uint8Array([103,112,97,112,112,114,111,97,99,104,115,105,116,101,50,48]);

// Scan directories and build page data
const root = new URL('.', import.meta.url).pathname;
const pages = [];

for (const dir of readdirSync(root)) {
  const full = join(root, dir);
  if (!statSync(full).isDirectory()) continue;
  const indexPath = join(full, 'index.html');
  try {
    const html = readFileSync(indexPath, 'utf-8');
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    if (!titleMatch) continue;
    const title = titleMatch[1];

    let type = 'other';
    if (title.includes('デモンストレーション') || title.includes('事例集')) type = 'demo';
    else if (title.includes('MTG準備メモ') || title.includes('フォローアップ準備メモ')) type = 'memo';
    else if (title.includes('事例集') || title.includes('30社')) type = 'list';

    // Extract company name
    let company = '';
    const companyMatch = title.match(/[—―]\s*(.+?)(?:様向け|様$)/);
    if (companyMatch) company = companyMatch[1];

    // Extract date from MTG memo titles
    let date = '';
    const dateMatch = title.match(/[｜|]\s*(\d{1,4}[\/年]\d{1,2}[\/月]\d{1,2})/);
    if (dateMatch) date = dateMatch[1];

    // Get file mtime
    const mtime = statSync(indexPath).mtime;

    pages.push({ dir, title, type, company, date, mtime });
  } catch {}
}

// Group by company
const grouped = {};
for (const p of pages) {
  const key = p.company || p.dir;
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(p);
}

// Sort groups by most recent page
const sortedGroups = Object.entries(grouped).sort((a, b) => {
  const aMax = Math.max(...a[1].map(p => p.mtime.getTime()));
  const bMax = Math.max(...b[1].map(p => p.mtime.getTime()));
  return bMax - aMax;
});

// Build HTML
const typeLabel = { demo: 'DEMO', memo: 'MEMO', list: 'LIST', other: 'PAGE' };
const typeCls = { demo: 'demo', memo: 'memo', list: 'list', other: 'demo' };

let contentHtml = `
<div class="hero">
  <h1>GP Approach Site</h1>
  <div class="subtitle">Personalized Sales Pages Index</div>
</div>
<div class="container">
  <div class="section">
    <div class="section-label">Pages by Company</div>
`;

for (const [company, pageList] of sortedGroups) {
  const dateStr = new Date(Math.max(...pageList.map(p => p.mtime.getTime()))).toLocaleDateString('ja-JP');
  contentHtml += `
    <div class="company-group">
      <div class="company-name">${company}</div>
      <div class="company-meta">Last updated: ${dateStr} &middot; ${pageList.length} page(s)</div>
      <div class="page-cards">
  `;
  // Sort: demo first, then memo
  const order = { demo: 0, list: 1, memo: 2, other: 3 };
  pageList.sort((a, b) => order[a.type] - order[b.type]);

  for (const p of pageList) {
    contentHtml += `
        <a href="./${p.dir}/" class="page-card">
          <div class="page-card-left">
            <span class="page-type ${typeCls[p.type]}">${typeLabel[p.type]}</span>
            <span class="page-title">${p.title}</span>
          </div>
          <span class="page-arrow">&rarr;</span>
        </a>`;
  }
  contentHtml += `
      </div>
    </div>`;
}

contentHtml += `
  </div>
</div>
<footer>INTERNAL USE ONLY &middot; ${new Date().toLocaleDateString('ja-JP')}</footer>
`;

// Encrypt
async function encrypt(text, password) {
  const enc = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(combined).toString('base64');
}

const encPayload = await encrypt(contentHtml, PASSWORD);
const template = readFileSync(join(root, 'index.html'), 'utf-8');
const output = template.replace("'##ENCRYPTED_PAYLOAD##'", `'${encPayload}'`);
writeFileSync(join(root, 'index.html'), output);

console.log(`Encrypted ${pages.length} pages into index.html`);
