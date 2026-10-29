/**
 * Responsive variants of the Competen Scholar hero photograph -- SCHOLAR-WEB-REDESIGN-01.
 *
 * The master is the owner-approved photograph (African healthcare students around a simulation manikin),
 * kept as supplied at public/images/scholar/hero-students.webp (1672 wide, WebP). It is never re-encoded
 * in place: every variant is built FROM it, so a rerun is not a second generation loss.
 *
 * Widths follow how the hero is shown: about half the 1280px container on desktop (so 1024 covers 2x on
 * most laptops), the full phone width below md (640 covers a 2x 320pt phone). AVIF first, WebP as the
 * fallback the <picture> in ScholarLanding.tsx falls back to; the master serves the widest WebP slot.
 * NO UPSCALING -- the same rule as build-home-images.mjs.
 *
 *   node scripts/build-scholar-images.mjs
 */
import sharp from "sharp";
import { statSync } from "node:fs";

const DIR = "public/images/scholar";
const MASTER = `${DIR}/hero-students.webp`;
const WIDTHS = [640, 1024];

const { width } = await sharp(MASTER).metadata();
for (const w of [...WIDTHS, width]) {
  const img = () => sharp(MASTER).resize({ width: w, withoutEnlargement: true });
  const outs = [[`${DIR}/hero-students-${w}.avif`, img().avif({ quality: 55, effort: 6 })]];
  if (w !== width) outs.push([`${DIR}/hero-students-${w}.webp`, img().webp({ quality: 80 })]);
  for (const [dest, pipeline] of outs) {
    await pipeline.toFile(dest);
    console.log(`  ${dest.padEnd(44)} ${(statSync(dest).size / 1024).toFixed(0).padStart(4)}KB`);
  }
}
console.log(`  master ${MASTER} ${width}px, ${(statSync(MASTER).size / 1024).toFixed(0)}KB (served as the widest WebP)`);
