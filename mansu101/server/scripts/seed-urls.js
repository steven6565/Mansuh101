/**
 * Import URLs from config/urls.json into the database.
 * By default this only seeds an empty database; the dashboard is the
 * long-term source of truth. Use --append to add any new entries.
 *
 * Run: pnpm db:seed [--append]
 */
import { createStore, seedUrls, readSeedUrls } from '../src/store/index.js';

const log = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

const { store, engine } = await createStore(log);
const append = process.argv.includes('--append');
const existing = await store.listUrls();

if (!existing.length) {
  const urls = await seedUrls(store, log);
  console.log(`Seeded ${urls.length} URL(s) from config/urls.json`);
} else if (append) {
  const added = await store.addUrls(
    readSeedUrls().filter((seed) => !existing.some((url) => url.url === seed.url)),
  );
  console.log(`Appended ${added.length} new URL(s); ${existing.length} already present`);
} else {
  console.log(`Database already has ${existing.length} URL(s); nothing imported.`);
  console.log('Use --append to import additional entries from config/urls.json.');
}

for (const url of await store.listUrls()) {
  console.log(` ${url.enabled ? '✓' : '○'} ${url.url}`);
}

await store.close();
console.log(`\nStore: ${engine}`);
