/**
 * Re-encode the corporate site's photography as WebP.
 *
 * WHY. The Practice mockups were optimised when they were added (28MB of PNG down to 1.9MB) and the home
 * photography never was. Measured against the production build, that left the HOMEPAGE at 3.66MB while
 * /practice -- the page with twenty product screenshots on it -- was 1.10MB. The single most important
 * public page, and the entry point for every visitor, was three times heavier than the page it links to.
 *
 * The cause is simply format: these are photographs stored as PNG. A 360x760 photograph has no business
 * being 592KB. On a 1.5 Mbps mobile connection 3.66MB is roughly twenty seconds before anything useful
 * appears, which for a product sold across East Africa is not a performance nicety.
 *
 * NO UPSCALING. Several of these are already low-resolution crops taken from a page comp -- path-students
 * is 330px wide. Enlarging them to hit a round number would add bytes and blur in one step, so each is
 * re-encoded at its native size and the soft ones stay soft until better originals exist.
 *
 * The PNGs stay on disk as masters: scripts/build-og-images.mjs reads hero-clinicians.png to build the
 * social card, and re-encoding from a WebP would be a second generation loss.
 *
 *   node scripts/build-home-images.mjs
 */
import sharp from "sharp";
import { readdirSync, statSync } from "node:fs";

const DIR = "public/images/home";

// Only what the site actually references. The rest (journey-team, closing-sunset, serve-*) are unreferenced
// leftovers -- converting them would just add unused files to the deploy.
const REFERENCED = [
  "journey-nurse", "team-hospital", "hero-clinicians",
  "path-students", "path-professionals", "path-practice", "path-hospitals",
];

let before = 0, after = 0, n = 0;
for (const name of REFERENCED) {
  const src = `${DIR}/${name}.png`;
  let stat;
  try { stat = statSync(src); } catch { console.error(`  MISSING ${src}`); process.exitCode = 1; continue; }
  const dest = `${DIR}/${name}.webp`;
  await sharp(src).webp({ quality: 82 }).toFile(dest);   // native size: see NO UPSCALING above
  const out = statSync(dest).size;
  before += stat.size; after += out; n++;
  console.log(`  ${name.padEnd(20)} ${(stat.size / 1024).toFixed(0).padStart(5)}KB -> ${(out / 1024).toFixed(0).padStart(4)}KB`);
}

const unreferenced = readdirSync(DIR)
  .filter(f => f.endsWith(".png"))
  .filter(f => !REFERENCED.includes(f.replace(/\.png$/, "")));
console.log(`\n  ${n} image(s): ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB` +
  ` (${(100 - (after / before) * 100).toFixed(0)}% smaller)`);
if (unreferenced.length) {
  console.log(`  ${unreferenced.length} unreferenced PNG(s) left untouched: ${unreferenced.join(", ")}`);
}
