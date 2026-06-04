const fs = require('fs-extra');
const path = require('path');
const { buildEpub } = require('./epubBuilder');

const DELAY_BETWEEN_BOOKS_MS = 3000;

async function run() {
  console.log('\n=========================================');
  console.log(' KOTOBEE EPUB EXTRACTOR v1.0');
  console.log('=========================================');

  const booksPath = path.join(__dirname, 'books.json');

  if (!fs.existsSync(booksPath)) {
    console.error('ERROR: books.json not found!');
    process.exit(1);
  }

  let bookIds;
  try {
    const raw = await fs.readFile(booksPath, 'utf8');
    bookIds = JSON.parse(raw);
  } catch {
    console.error('ERROR: books.json is invalid JSON.');
    process.exit(1);
  }

  if (!Array.isArray(bookIds) || bookIds.length === 0) {
    console.error('ERROR: books.json must be a non-empty array of book IDs.');
    process.exit(1);
  }

  // Filter out placeholder entries
  bookIds = bookIds.filter((id) => typeof id === 'string' && id.trim().length > 0);

  console.log(`\nBooks to process: ${bookIds.length}`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < bookIds.length; i++) {
    try {
      await buildEpub(bookIds[i]);
      succeeded++;
    } catch {
      failed++;
    }

    if (i < bookIds.length - 1) {
      console.log(`\n  Waiting ${DELAY_BETWEEN_BOOKS_MS / 1000}s before next book...`);
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BOOKS_MS));
    }
  }

  console.log(`\n=========================================`);
  console.log(`  FINISHED: ${succeeded} OK, ${failed} failed`);
  console.log(`  Output: ./output/`);
  console.log(`=========================================\n`);
}

run();
