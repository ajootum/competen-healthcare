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

// THE DEMO PRACTICE IS CALLED "COMPETEN MEDICAL CENTRE" (settled 2026-08-02).
//
// The current mockups do NOT say that. They show "Sunrise Medical Centre" on nineteen screens and
// "Eonrise Medical Centre" on the integrations screen -- a typo in the source artwork. Both are baked into
// rendered PNGs, so this cannot be corrected here: it needs the screens re-exported with the agreed name.
//
// Until they are, NO alt text or caption may name the practice. A caption saying "Competen Medical Centre"
// over a screenshot reading "Sunrise" tells a screen-reader user something different from what a sighted
// user sees, which is a worse failure than saying nothing. scripts/practice-content-harness.ts asserts it.
//
// CPR module id -> published filename. The filename says what the screen IS, so a future image swap that
// puts the calendar under booking.webp is visible in the diff rather than only on the rendered page.
//
// NOT PUBLISHED, deliberately: CPR-000 (a duplicate of the CPR-001 dashboard) and CPR-000A. The latter is
// the enterprise architecture diagram, which draws the Platform Operations / landlord control plane and
// the whole product ecosystem. WEB-STRAT-001 forbids disclosing those publicly, and an image is a
// disclosure even though no text harness can read one. Neither has an entry below, so both are skipped.
const MAP = {
  "001": "dashboard", "002": "calendar", "003": "booking", "004": "appointments", "005": "queue",
  "006": "portal", "007": "questionnaires", "008": "timeline", "009": "diagnosis", "010": "treatments",
  "011": "documents", "012": "followups", "013": "notifications", "014": "referrals", "015": "analytics",
  "016": "assistant", "017": "search", "018": "reception", "019": "settings", "020": "integrations",
};

mkdirSync(OUT, { recursive: true });

// A module can have several source files once it is revised (CPR-019 and CPR-019_Revision2 both carry id
// 019). Pick the HIGHEST revision explicitly and say which one was used. Relying on sort order to put the
// revision last happens to work today and would silently publish the superseded screen the first time
// somebody names a file differently.
const revisionOf = f => { const m = /Revision\s*(\d+)/i.exec(f); return m ? Number(m[1]) : 1; };

const byId = new Map();
for (const f of readdirSync(SRC).filter(x => /^CPR-\d{3}[_A-Z].*\.png$/.test(x))) {
  const id = f.slice(4, 7);
  const best = byId.get(id);
  if (!best || revisionOf(f) > revisionOf(best)) byId.set(id, f);
}

const found = new Set();
let total = 0;
for (const [id, f] of [...byId.entries()].sort()) {
  const name = MAP[id];
  if (!name) { console.log(`  skip   ${f} (not published)`); continue; }
  const rev = revisionOf(f);
  if (rev > 1) console.log(`  using revision ${rev} for ${id}: ${f}`);
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
