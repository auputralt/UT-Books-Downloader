// scripts/config.mjs — Shared configuration
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const CONFIG = {
  rootDir: ROOT,
  outputDir: path.join(ROOT, 'output'),
  sessionDir: path.join(ROOT, 'session'),
  sessionStateFile: path.join(ROOT, 'session', 'storageState.json'),

  // Kotobee URLs
  baseUrl: 'https://univterbuka.kotobee.com',
  loginUrl: 'https://univterbuka.kotobee.com',
  libraryUrl: 'https://univterbuka.kotobee.com/library',

  // Rate limiting
  delayBetweenFiles: 200,
  delayBetweenBooks: 3000,

  // Allowed hosts (security boundary)
  allowedHosts: new Set([
    'univterbuka.kotobee.com',
    'kotobee.com',
  ]),
};
