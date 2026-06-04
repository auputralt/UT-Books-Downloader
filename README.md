# UT Books Downloader

CLI tools for downloading UT Kotobee EPUB books from a saved authenticated session or from a list of book IDs.

## What this project does

This repo contains two related download flows:

- A batch EPUB builder that reads book IDs from `books.json` and saves `.epub` files into `output/`.
- An interactive downloader that can log in through a browser, save session state, and fetch books one by one.

The code is designed for content you are authorized to access.

## Requirements

- Node.js 18 or newer
- npm
- A Chromium-based browser for the login flow

## Install

```bash
npm install
```

## Usage

### 1. Put book IDs in `books.json`

`books.json` should contain a JSON array of book IDs:

```json
["12345", "67890"]
```

### 2. Run the batch downloader

```bash
npm start
```

or:

```bash
npm run download
```

This uses `index.js`, reads `books.json`, and writes EPUB files to `output/`.

### 3. Log in and save a session

```bash
npm run login
```

This opens a browser window, lets you authenticate manually, and saves session cookies to `session/storageState.json`.

### 4. Fetch using the saved session

```bash
npm run fetch
```

This reads book IDs from `books.json`, uses the saved session, and downloads each book.

### 5. Interactive one-command flow

```bash
npm run go
```

This prompts for comma-separated book IDs, logs in if needed, then downloads the books.

## Project scripts

- `npm start` or `npm run download` runs `index.js`
- `npm run login` opens the browser login flow
- `npm run fetch` downloads books using `books.json` and a saved session
- `npm run go` starts the interactive downloader in `scripts/run.mjs`

## Output and local files

- Downloaded EPUB files are saved in `output/`
- Temporary packaging files are created and removed during processing
- Session state is stored in `session/storageState.json`

The repository’s `.gitignore` excludes local browser/session files and dependencies such as `node_modules/`.

## How it works

1. The code loads the book ID list.
2. It fetches each book’s `package.opf` manifest from the Kotobee library.
3. It downloads the referenced EPUB assets.
4. It creates a valid EPUB structure and packages it into a `.epub` archive.

## Repository layout

- `index.js` - batch EPUB builder using `books.json`
- `epubBuilder.js` - EPUB packaging logic
- `scripts/config.mjs` - shared paths, URLs, and rate limits
- `scripts/login.mjs` - browser login and session capture
- `scripts/book_fetcher.mjs` - session-based downloader
- `scripts/run.mjs` - interactive downloader
- `books.json` - book ID list
- `output/` - generated EPUB files
- `session/` - local browser session state

## Notes

- Keep `session/storageState.json` private.
- If a session expires, run `npm run login` again.
- If you want to change the target host or timing settings, edit `scripts/config.mjs`.
