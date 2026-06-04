#!/usr/bin/env node
// scripts/login.mjs — Interactive browser login, saves session state
// Usage: npm run login

import fs from 'node:fs';
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CONFIG } from './config.mjs';

async function promptContinue(message) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(`${message}\nPress Enter when done...`);
  rl.close();
}

async function login() {
  console.log('\n=== UT Kotobee Login ===');
  console.log('A browser window will open. Log in, then come back here.\n');

  fs.mkdirSync(CONFIG.sessionDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded' });

  await promptContinue('Complete login in the browser window.');

  await context.storageState({ path: CONFIG.sessionStateFile });
  await browser.close();

  console.log(`Session saved to: ${CONFIG.sessionStateFile}`);
  console.log('You can now run: npm run fetch');
}

login().catch((err) => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
