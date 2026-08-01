/**
 * Build the Competen Practice interface previews for the public site.
 *
 * Source: the CPR-0xx design mockups (1536x1024 PNG, ~1.4MB each). Twenty of those unprocessed would put
 * ~28MB of images behind /practice, which on a Ugandan mobile connection is not a marketing page, it is a
 * wall. Resized to 1400px and encoded as WebP they land around a tenth of that and still hold detail at 2x
 * on the widths they are displayed at.
 *
 * Kept as a script rather than a one-off shell command because the mockups WILL be revised, and the next
 * person needs the exact same resize and quality settings or the gallery starts looking uneven.
 *
 *   node scripts/build-practice-images.mjs [sourceDir]
 */
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";

const SRC = process.argv[2] ?? "C:/Users/elish/Downloads";
const OUT = "public/images/practice";

// CPR module id -> published filename. The filename says what the screen IS, so a future image swap that
// puts the calendar under booking.webp is visible in the diff rather than only on the rendered page.
const MAP = {
  "001": "dashboard", "002": "calendar", "003": "booking", "004": "appointments", "005": "queue",
  "006": "portal", "007": "questionnaires", "008": "timeline", "009": "diagnosis", "010": "treatments",
  "011": "documents", "012": "followups", "013": "notifications", "014": "referrals", "015": "analytics",
  "016": "assistant", "017": "search", "018": "reception", "019": "settings", "020": "integrations",
};

mkdirSync(OUT, { recursive: true });

const found = new Set();
let total = 0;
for (const f of readdirSync(SRC).filter(x => /^CPR-\d{3}.*\.png$/.test(x)).sort()) {
  const id = f.slice(4, 7);
  const name = MAP[id];
  if (!name) { console.log(`  skip   ${f} (no published name)`); continue; }
  const dest = `${OUT}/${name}.webp`;
  await sharp(`${SRC}/${f}`).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 82 }).toFile(dest);
  const kb = statSync(dest).size / 1024;
  total += kb;
  found.add(id);
  console.log(`  ${id} -> ${name}.webp  ${kb.toFixed(0)}KB`);
}

const missing = Object.keys(MAP).filter(id => !found.has(id));
if (missing.length) {
  console.error(`\nMISSING source mockups for: ${missing.join(", ")} -- those pages will 404 their image.`);
  process.exitCode = 1;
}
console.log(`\n${found.size}/${Object.keys(MAP).length} screens, ${Math.round(total)}KB total.`);
