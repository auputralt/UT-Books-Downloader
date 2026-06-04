#!/usr/bin/env node
// scripts/book_fetcher.mjs — Authorized book fetcher using saved session
// Usage: npm run fetch
// Prereq: Run "npm run login" first to save session state

import fs from 'node:fs';
import path from 'node:path';
import { request as playwrightRequest } from 'playwright';
import { CONFIG } from './config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mustBeAllowedUrl(rawUrl) {
  const url = new URL(rawUrl);
  for (const host of CONFIG.allowedHosts) {
    if (url.hostname === host || url.hostname.endsWith('.' + host)) return url;
  }
  throw new Error(`Blocked host: ${url.hostname}`);
}

// ── Kotobee EPUB fetcher ──────────────────────────────────────────

async function fetchKotobeeEpub(api, bookId, outputDir) {
  const baseUrl = `https://univterbuka.kotobee.com/books/${bookId}/EPUB/EPUB/`;

  console.log(`\n  [Kotobee EPUB] ${bookId}`);

  // Fetch manifest
  const opfRes = await api.get(`${baseUrl}package.opf`, { timeout: 30_000 });
  if (!opfRes.ok()) throw new Error(`Failed to fetch manifest: HTTP ${opfRes.status()}`);

  const opfText = await opfRes.text();

  // Parse manifest hrefs
  const hrefs = [];
  const itemRegex = /<item[^>]+href="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = itemRegex.exec(opfText)) !== null) {
    hrefs.push(decodeURIComponent(match[1]));
  }

  if (!hrefs.length) throw new Error('No items found in manifest');

  console.log(`    Manifest: ${hrefs.length} files`);

  // Download assets to temp dir
  const tempDir = path.join(outputDir, `_temp_${bookId}`);
  ensureDir(tempDir);
  ensureDir(path.join(tempDir, 'EPUB'));

  fs.writeFileSync(path.join(tempDir, 'EPUB', 'package.opf'), opfText);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < hrefs.length; i++) {
    const href = hrefs[i];
    const fileUrl = `${baseUrl}${href}`;
    const localPath = path.join(tempDir, 'EPUB', href);

    ensureDir(path.dirname(localPath));

    try {
      mustBeAllowedUrl(fileUrl);
      const res = await api.get(fileUrl, { timeout: 60_000 });
      if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
      const body = await res.body();
      fs.writeFileSync(localPath, body);
      ok++;
    } catch (err) {
      console.warn(`    [FAIL] ${href}: ${err.message}`);
      fail++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`    Progress: ${i + 1}/${hrefs.length}`);
    }

    await sleep(CONFIG.delayBetweenFiles);
  }

  console.log(`    Downloaded: ${ok} OK, ${fail} failed`);

  // EPUB scaffolding
  fs.writeFileSync(path.join(tempDir, 'mimetype'), 'application/epub+zip');
  ensureDir(path.join(tempDir, 'META-INF'));
  fs.writeFileSync(
    path.join(tempDir, 'META-INF', 'container.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
      '  <rootfiles>\n' +
      '    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>\n' +
      '  </rootfiles>\n' +
      '</container>'
  );

  // Package as EPUB
  const { default: archiver } = await import('archiver');
  const epubPath = path.join(outputDir, `${bookId}.epub`);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(epubPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(fs.createReadStream(path.join(tempDir, 'mimetype')), {
      name: 'mimetype',
      store: true,
    });
    archive.directory(path.join(tempDir, 'META-INF'), 'META-INF');
    archive.directory(path.join(tempDir, 'EPUB'), 'EPUB');
    archive.finalize();
  });

  // Cleanup temp
  fs.rmSync(tempDir, { recursive: true, force: true });

  const size = fs.statSync(epubPath).size;
  console.log(`    Saved: ${bookId}.epub (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

// ── Main ──────────────────────────────────────────────────────────

async function run() {
  console.log('\n=========================================');
  console.log(' UT BOOKS FETCHER (Authorized Session)');
  console.log('=========================================');

  if (!fs.existsSync(CONFIG.sessionStateFile)) {
    console.error('\nNo session found. Run first: npm run login');
    process.exit(1);
  }

  const booksRaw = fs.readFileSync(path.join(CONFIG.rootDir, 'books.json'), 'utf8');
  const bookIds = JSON.parse(booksRaw).filter((id) => typeof id === 'string' && id.trim());

  if (!bookIds.length) {
    console.error('No book IDs in books.json');
    process.exit(1);
  }

  console.log(`\nBooks: ${bookIds.length}`);

  // Build API from saved session cookies
  const sessionRaw = JSON.parse(fs.readFileSync(CONFIG.sessionStateFile, 'utf8'));
  const cookiePairs = (sessionRaw.cookies || [])
    .filter((c) => {
      const domain = c.domain.replace(/^\./, '');
      for (const host of CONFIG.allowedHosts) {
        if (domain === host || domain.endsWith('.' + host)) return true;
      }
      return false;
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const api = await playwrightRequest.newContext({
    baseURL: CONFIG.baseUrl,
    extraHTTPHeaders: { Cookie: cookiePairs },
  });

  ensureDir(CONFIG.outputDir);

  let succeeded = 0;
  let failed = 0;

  try {
    for (let i = 0; i < bookIds.length; i++) {
      try {
        await fetchKotobeeEpub(api, bookIds[i], CONFIG.outputDir);
        succeeded++;
      } catch (err) {
        console.error(`\n  FAILED [${bookIds[i]}]: ${err.message}`);
        failed++;
      }

      if (i < bookIds.length - 1) {
        console.log(`\n  Waiting ${CONFIG.delayBetweenBooks / 1000}s...`);
        await sleep(CONFIG.delayBetweenBooks);
      }
    }
  } finally {
    await api.dispose();
  }

  console.log(`\n=========================================`);
  console.log(`  DONE: ${succeeded} OK, ${failed} failed`);
  console.log(`  Output: ${CONFIG.outputDir}`);
  console.log(`=========================================\n`);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
