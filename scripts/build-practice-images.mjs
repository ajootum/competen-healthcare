/**
 * Build the Competen Practice interface previews for the public site.
 *
 * SOURCE: the CPR-0xx_V2 workspace mockups (1536x1024 PNG, ~1.5MB each). Twenty of those unprocessed
 * would put ~30MB of images behind /practice, which on a Ugandan mobile connection is not a marketing
 * page, it is a wall. Resized to 1400px and encoded as WebP they land around a twentieth of that and still
 * hold detail at 2x on the widths they are displayed at.
 *
 * V2 SUPERSEDES V1 ENTIRELY -- not a revision of the same screens but a different product surface. Version
 * 1 had a patient portal, a pre-visit questionnaire engine and a reception workspace; version 2 has
 * teleconsultation, mobile/offline, delegation and multi-practice switching, and every screen was redrawn.
 * So this maps the V2 workspace list, and the V1 filenames are deliberately gone rather than aliased --
 * an alias would let a page keep rendering a superseded screen while looking correct in the diff.
 *
 * THE DEMO PRACTICE STILL IS NOT "COMPETEN MEDICAL CENTRE" (the agreed name, settled 2026-08-02). The V2
 * artwork says "Kampala Clinic - Main Site" throughout, which at least replaces V1's "Sunrise"/"Eonrise"
 * inconsistency with one consistent name -- but it is not the agreed one. Until the screens are re-exported
 * again, NO alt text or caption may name the practice; scripts/practice-content-harness.ts asserts it.
 *
 *   node scripts/build-practice-images.mjs [sourceDir]
 */
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";

const SRC = process.argv[2] ?? "C:/Users/elish/Downloads";
const OUT = "public/images/practice";

// CPR-V2 workspace id -> published filename. The filename says which WORKSPACE the screen is, so an image
// swap that puts the schedule under booking.webp shows up in the diff rather than only on the page.
const MAP = {
  "001": "command-centre", "002": "schedule", "003": "booking", "004": "registration",
  "005": "patient-search", "006": "encounter", "007": "diagnosis", "008": "investigations",
  "009": "treatment", "010": "followups", "011": "intelligence", "012": "reports",
  "013": "ai-copilot", "014": "settings", "015": "multi-practice", "016": "delegation",
  "017": "collaboration", "018": "teleconsultation", "019": "mobile-offline", "020": "home-navigation",
};

mkdirSync(OUT, { recursive: true });

// Only _V2_ files. Matching bare CPR-0xx would silently pick up the superseded V1 artwork for any id whose
// V2 export is missing, which is exactly the failure this naming is meant to make impossible.
const sources = new Map();
for (const f of readdirSync(SRC)) {
  const m = /^CPR-(\d{3})_V2_.*\.png$/i.exec(f);
  if (m) sources.set(m[1], f);
}

const found = new Set();
let total = 0;
for (const [id, name] of Object.entries(MAP)) {
  const file = sources.get(id);
  if (!file) { console.error(`  MISSING CPR-${id}_V2 -> ${name}.webp not built`); process.exitCode = 1; continue; }
  const dest = `${OUT}/${name}.webp`;
  await sharp(`${SRC}/${file}`).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 82 }).toFile(dest);
  const kb = statSync(dest).size / 1024;
  total += kb; found.add(id);
  console.log(`  ${id} -> ${name.padEnd(16)} ${kb.toFixed(0).padStart(4)}KB`);
}

console.log(`\n${found.size}/${Object.keys(MAP).length} screens, ${Math.round(total)}KB total.`);
