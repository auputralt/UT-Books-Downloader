const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs-extra');
const archiver = require('archiver');
const path = require('path');

const BASE_URL_TEMPLATE = 'https://univterbuka.kotobee.com/books/{bookId}/EPUB/EPUB/';

const AXIOS_CONFIG = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  },
  timeout: 30000,
};

const RATE_LIMIT = {
  BETWEEN_FILES_MS: 200,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadWithRetry(url, retries = RATE_LIMIT.MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { ...AXIOS_CONFIG, responseType: 'arraybuffer' });
      return res.data;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      const delay = RATE_LIMIT.RETRY_DELAY_MS * attempt;
      console.warn(`    Retry ${attempt}/${retries} after ${delay}ms: ${path.basename(url)}`);
      await sleep(delay);
    }
  }
}

async function parseManifest(opfContent) {
  const parser = new xml2js.Parser();
  const parsed = await parser.parseStringPromise(opfContent);
  const items = parsed?.package?.manifest?.[0]?.item;
  if (!items || !items.length) {
    throw new Error('No manifest items found in package.opf');
  }

  const metadata = parsed?.package?.metadata?.[0];
  let title = 'Unknown';
  const titleVal = metadata?.['dc:title']?.[0];
  if (typeof titleVal === 'string') {
    title = titleVal;
  } else if (titleVal?._) {
    title = titleVal._;
  }

  return { items, title };
}

async function downloadAssets(items, baseUrl, epubDir) {
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < items.length; i++) {
    const href = items[i].$.href;
    const url = `${baseUrl}${href}`;
    const localPath = path.join(epubDir, href);

    await fs.ensureDir(path.dirname(localPath));

    try {
      const data = await downloadWithRetry(url);
      await fs.writeFile(localPath, data);
      success++;

      // Progress indicator for large batches
      if ((i + 1) % 50 === 0) {
        console.log(`    Progress: ${i + 1}/${items.length} files`);
      }
    } catch (err) {
      const msg = err.response ? `HTTP ${err.response.status}` : err.message;
      console.warn(`    [FAIL] ${href} — ${msg}`);
      failed++;
    }

    await sleep(RATE_LIMIT.BETWEEN_FILES_MS);
  }

  return { success, failed, skipped, total: items.length };
}

async function createEpubScaffolding(tempDir) {
  await fs.writeFile(path.join(tempDir, 'mimetype'), 'application/epub+zip');
  await fs.ensureDir(path.join(tempDir, 'META-INF'));

  const containerXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles>',
    '    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>',
    '  </rootfiles>',
    '</container>',
  ].join('\n');

  await fs.writeFile(path.join(tempDir, 'META-INF', 'container.xml'), containerXml);
}

async function packageEpub(tempDir, outputPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);

    // EPUB spec: mimetype first, stored (no compression)
    archive.append(fs.createReadStream(path.join(tempDir, 'mimetype')), {
      name: 'mimetype',
      store: true,
    });
    archive.directory(path.join(tempDir, 'META-INF'), 'META-INF');
    archive.directory(path.join(tempDir, 'EPUB'), 'EPUB');

    archive.finalize();
  });

  const stats = await fs.stat(outputPath);
  return stats.size;
}

async function buildEpub(bookId) {
  const tempDir = path.join(__dirname, 'temp', bookId);
  const outputDir = path.join(__dirname, 'output');
  const baseUrl = BASE_URL_TEMPLATE.replace('{bookId}', bookId);
  const opfUrl = `${baseUrl}package.opf`;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  BOOK: ${bookId}`);
  console.log('='.repeat(50));

  try {
    await fs.ensureDir(path.join(tempDir, 'EPUB'));
    await fs.ensureDir(outputDir);

    // Step 1: Download & parse manifest
    console.log('  [1/4] Downloading manifest...');
    const opfRes = await axios.get(opfUrl, { ...AXIOS_CONFIG, responseType: 'text' });
    await fs.writeFile(path.join(tempDir, 'EPUB', 'package.opf'), opfRes.data);

    const { items, title } = await parseManifest(opfRes.data);
    console.log(`        Title: ${title}`);
    console.log(`        Assets: ${items.length} files`);

    // Step 2: Download all assets
    console.log('  [2/4] Downloading assets...');
    const stats = await downloadAssets(items, baseUrl, path.join(tempDir, 'EPUB'));
    console.log(`        Done: ${stats.success} OK, ${stats.failed} failed`);

    if (stats.failed === stats.total) {
      throw new Error('All assets failed to download. Check book ID or network.');
    }

    // Step 3: Create EPUB scaffolding
    console.log('  [3/4] Building EPUB structure...');
    await createEpubScaffolding(tempDir);

    // Step 4: Package into .epub
    console.log('  [4/4] Compressing...');
    const outputPath = path.join(outputDir, `${bookId}.epub`);
    const fileSize = await packageEpub(tempDir, outputPath);

    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);
    console.log(`\n  DONE: ${bookId}.epub (${sizeMB} MB) saved to /output`);

  } catch (error) {
    console.error(`\n  FAILED [${bookId}]: ${error.message}`);
    throw error;
  } finally {
    await fs.remove(tempDir).catch(() => {});
  }
}

module.exports = { buildEpub };
