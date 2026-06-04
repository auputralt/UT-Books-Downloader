#!/usr/bin/env node
// scripts/run.mjs — One-command interactive UT Books downloader
// Usage: npm run go

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
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

// ── Login ──────────────────────────────────────────────────────────
async function login() {
  console.log('\n  Login required — browser will open.');
  console.log('  Log in to Kotobee, then come back here.\n');

  fs.mkdirSync(CONFIG.sessionDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
  } catch {
    browser = await chromium.launch({ headless: false });
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question('  Press Enter when done logging in... ');
  rl.close();

  await context.storageState({ path: CONFIG.sessionStateFile });
  await browser.close();
  console.log('  Session saved!\n');
}

// ── Fetch single EPUB ──────────────────────────────────────────────
async function fetchEpub(api, bookId, outputDir) {
  const baseUrl = `https://univterbuka.kotobee.com/books/${bookId}/EPUB/EPUB/`;

  console.log(`\n  [${bookId}] Fetching manifest...`);

  const opfRes = await api.get(`${baseUrl}package.opf`, { timeout: 30_000 });
  if (!opfRes.ok()) throw new Error(`Manifest HTTP ${opfRes.status()}`);

  const opfText = await opfRes.text();

  const hrefs = [];
  const itemRegex = /<item[^>]+href="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = itemRegex.exec(opfText)) !== null) {
    hrefs.push(decodeURIComponent(match[1]));
  }

  if (!hrefs.length) throw new Error('No items in manifest');

  console.log(`  [${bookId}] ${hrefs.length} files to download`);

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
      fs.writeFileSync(localPath, await res.body());
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

  console.log(`  [${bookId}] Downloaded: ${ok} OK, ${fail} failed`);

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

  fs.rmSync(tempDir, { recursive: true, force: true });

  const size = fs.statSync(epubPath).size;
  console.log(`  [${bookId}] Saved: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

// ── Build API from saved session ───────────────────────────────────
async function buildApi() {
  const { request: playwrightRequest } = await import('playwright');
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

  return await playwrightRequest.newContext({
    baseURL: CONFIG.baseUrl,
    extraHTTPHeaders: { Cookie: cookiePairs },
  });
}

// ── Main ───────────────────────────────────────────────────────────
async function run() {
  console.log('\n=========================================');
  console.log(' UT BOOKS DOWNLOADER');
  console.log('=========================================');

  // Step 1: Get book IDs interactively
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const input = await rl.question('\n  Enter book IDs (comma-separated): ');
  rl.close();

  const bookIds = input
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (!bookIds.length) {
    console.error('  No book IDs provided. Exiting.');
    process.exit(1);
  }

  console.log(`\n  Books to download: ${bookIds.length}`);

  // Step 2: Login if no session
  if (!fs.existsSync(CONFIG.sessionStateFile)) {
    await login();
  } else {
    console.log('  Using saved session.');
  }

  // Step 3: Fetch all books
  let api;
  try {
    api = await buildApi();
  } catch {
    console.log('  Session invalid. Re-login needed.\n');
    await login();
    api = await buildApi();
  }

  ensureDir(CONFIG.outputDir);

  let ok = 0;
  let fail = 0;

  try {
    for (let i = 0; i < bookIds.length; i++) {
      try {
        await fetchEpub(api, bookIds[i], CONFIG.outputDir);
        ok++;
      } catch (err) {
        console.error(`\n  FAILED [${bookIds[i]}]: ${err.message}`);
        fail++;
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
  console.log(`  Done: ${ok} OK, ${fail} failed`);
  console.log(`  Output: ${CONFIG.outputDir}`);
  console.log(`=========================================\n`);
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
