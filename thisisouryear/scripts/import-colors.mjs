// Imports the color reference file into the store's palette data.
//
//   node scripts/import-colors.mjs <color-master.json> <store-color-map.json>
//
// Both input files live in your private handoff folder, not in this project.
// The map file translates the reference file's IDs into the plain keys this
// store uses (city slug plus a color word), so nothing from the reference
// file's naming ends up in the site.
//
// What this does and does not do:
//   - HEX values are copied exactly as supplied. Nothing is converted or guessed.
//   - RGB is checked against the HEX. A mismatch stops the import.
//   - Pantone references, ink type and status are kept as separate fields.
//   - Optional rows (metallic, variants, candidates) are imported but never
//     added to a default palette.
//   - A missing Pantone reference stays null.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [masterPath, mapPath] = process.argv.slice(2);
if (!masterPath || !mapPath) {
  console.error('Usage: node scripts/import-colors.mjs <color-master.json> <store-color-map.json>');
  process.exit(2);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const store = JSON.parse(fs.readFileSync(path.join(root, 'src/data/teams.json'), 'utf8'));
const slugs = new Set(store.map((t) => t.slug));

const problems = [];
const fail = (msg) => problems.push(msg);
const UNRESOLVED = new Set(['Resolve discrepancy', 'Current spec unverified']);
const HEX = /^#[0-9A-Fa-f]{6}$/;

if (!Array.isArray(master.teams) || master.teams.length !== 32) {
  fail(`Expected 32 teams in the reference file, found ${master.teams?.length ?? 0}.`);
}

const seenIds = new Set();
const seenKeys = new Set();
const colorways = {};

for (const team of master.teams ?? []) {
  const slug = map.teams?.[team.id];
  if (!slug) {
    fail(`Reference team "${team.id}" has no entry in the map file.`);
    continue;
  }
  if (!slugs.has(slug)) {
    fail(`Map sends "${team.id}" to "${slug}", which is not a city in src/data/teams.json.`);
    continue;
  }
  if (colorways[slug]) {
    fail(`Two reference teams map to "${slug}".`);
    continue;
  }

  const colors = [];
  const keyOf = {};
  for (const c of team.colors ?? []) {
    if (seenIds.has(c.id)) fail(`Color ID "${c.id}" appears more than once.`);
    seenIds.add(c.id);

    const entry = map.colors?.[c.id];
    if (!entry) {
      fail(`Color "${c.id}" has no entry in the map file.`);
      continue;
    }
    if (seenKeys.has(entry.key)) fail(`Store key "${entry.key}" is used twice.`);
    seenKeys.add(entry.key);

    if (!HEX.test(String(c.render_hex))) {
      fail(`Color "${c.id}" has a malformed HEX: ${JSON.stringify(c.render_hex)}. Expected the form #RRGGBB.`);
      continue;
    }
    const hex = c.render_hex.toUpperCase();
    const decoded = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (JSON.stringify(decoded) !== JSON.stringify(c.render_rgb)) {
      fail(`Color "${c.id}": render_rgb ${JSON.stringify(c.render_rgb)} is not ${hex} decoded (${decoded.join(', ')}).`);
    }

    keyOf[c.id] = entry.key;
    colors.push({
      key: entry.key,
      label: entry.label,
      role: map.roles?.[c.role] ?? c.role,
      default: c.render_default === true,
      order: c.render_order,
      hex,
      rgb: decoded,
      pantone: c.pantone_reference ?? null,
      otherPantone: c.other_published_pms ?? null,
      inkType: c.ink_type ?? null,
      status: c.specification_status,
      unresolved: UNRESOLVED.has(c.specification_status),
      vendorPrintSelection: c.vendor_print_selection ?? null,
      proofReference: c.vendor_proof_reference ?? null,
      productionStatus: c.production_status ?? 'Not approved',
    });
  }

  const defaults = [];
  for (const id of team.default_render_color_ids ?? []) {
    const row = (team.colors ?? []).find((c) => c.id === id);
    if (!row) {
      fail(`Team "${team.id}" lists default color "${id}", which does not exist.`);
      continue;
    }
    if (row.render_default !== true) {
      fail(`Team "${team.id}" lists "${id}" as a default, but that row is marked optional.`);
      continue;
    }
    if (keyOf[id]) defaults.push(keyOf[id]);
  }
  for (const c of team.colors ?? []) {
    if (c.render_default === true && !(team.default_render_color_ids ?? []).includes(c.id)) {
      fail(`Color "${c.id}" is marked default but is missing from its team's default list.`);
    }
  }

  colorways[slug] = { defaults, colors };
}

for (const slug of slugs) {
  if (!colorways[slug]) fail(`City "${slug}" got no palette. Check the map file.`);
}

if (problems.length) {
  console.error(`Import stopped. ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const out = {
  version: master.prepared_on ?? null,
  colorSpace: master.render_color_space ?? 'sRGB',
  productionApproved: master.production_approved === true,
  colorways: Object.fromEntries(store.map((t) => [t.slug, colorways[t.slug]])),
};
const outPath = path.join(root, 'src/data/palettes.json');
// One color per line, so the file stays readable and diffs stay small.
const lines = ['{', ` "version": ${JSON.stringify(out.version)},`, ` "colorSpace": ${JSON.stringify(out.colorSpace)},`, ` "productionApproved": ${out.productionApproved},`, ' "colorways": {'];
const entries = Object.entries(out.colorways);
entries.forEach(([slug, cw], i) => {
  lines.push(`  ${JSON.stringify(slug)}: {`);
  lines.push(`   "defaults": ${JSON.stringify(cw.defaults)},`);
  lines.push('   "colors": [');
  cw.colors.forEach((c, j) => lines.push(`    ${JSON.stringify(c)}${j < cw.colors.length - 1 ? ',' : ''}`));
  lines.push('   ]');
  lines.push(`  }${i < entries.length - 1 ? ',' : ''}`);
});
lines.push(' }', '}');
fs.writeFileSync(outPath, lines.join('\n') + '\n');

const rows = Object.values(colorways).flatMap((c) => c.colors);
console.log(`Imported ${Object.keys(colorways).length} palettes, ${rows.length} colors (${rows.filter((r) => r.default).length} default, ${rows.filter((r) => !r.default).length} optional).`);
console.log(`${rows.filter((r) => r.unresolved).length} colors carry an unresolved reference. ${rows.filter((r) => r.pantone === null).length} have no Pantone reference (kept null).`);
console.log(`Wrote ${path.relative(root, outPath)}. Run "npm run check" next.`);
