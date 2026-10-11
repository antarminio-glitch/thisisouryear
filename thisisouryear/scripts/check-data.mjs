// Checks the data files before a build. Run it with: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/lib/validate-data.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'src/data', name), 'utf8'));

let data;
try {
  data = {
    teams: read('teams.json'),
    palettes: read('palettes.json'),
    catalog: read('catalog.json'),
    store: read('store.json'),
    history: read('history.json'),
    stories: read('stories.json'),
  };
} catch (e) {
  console.error(`Couldn't read a data file: ${e.message}`);
  console.error('This is usually a missing comma or quote. The line number above points near it.');
  process.exit(1);
}

const { errors, warnings } = validateData(data);
for (const w of warnings) console.log(`note: ${w}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s) in the data files:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Data files look good: ${data.teams.length} cities, ${data.catalog.products.length} products, ${data.catalog.designs.length} designs.`);
