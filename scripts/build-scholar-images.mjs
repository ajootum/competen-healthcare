/**
 * Responsive variants of the Competen Scholar photographs -- SCHOLAR-WEB-REDESIGN-01.
 *
 * The masters are the owner-approved photographs, kept as supplied (1672 wide, WebP): hero-students (students
 * around a simulation manikin) and journey-student-laptop (section C, supplied 29 Oct). They are never
 * re-encoded in place: every variant is built FROM them, so a rerun is not a second generation loss.
 *
 * Widths follow how the photos are shown: about half the 1280px container on desktop (so 1024 covers 2x on
 * most laptops), the full phone width below md (640 covers a 2x 320pt phone). AVIF first, WebP as the
 * fallback the <picture> in ScholarLanding.tsx (ScholarPhoto) falls back to; the master serves the widest
 * WebP slot. NO UPSCALING -- the same rule as build-home-images.mjs.
 *
 *   node scripts/build-scholar-images.mjs
 */
import sharp from "sharp";
import { statSync } from "node:fs";

const DIR = "public/images/scholar";
const MASTERS = ["hero-students", "journey-student-laptop"];
const WIDTHS = [640, 1024];

for (const name of MASTERS) {
  const master = `${DIR}/${name}.webp`;
  const { width } = await sharp(master).metadata();
  for (const w of [...WIDTHS, width]) {
    const img = () => sharp(master).resize({ width: w, withoutEnlargement: true });
    const outs = [[`${DIR}/${name}-${w}.avif`, img().avif({ quality: 55, effort: 6 })]];
    if (w !== width) outs.push([`${DIR}/${name}-${w}.webp`, img().webp({ quality: 80 })]);
    for (const [dest, pipeline] of outs) {
      await pipeline.toFile(dest);
      console.log(`  ${dest.padEnd(52)} ${(statSync(dest).size / 1024).toFixed(0).padStart(4)}KB`);
    }
  }
  console.log(`  master ${master} ${width}px, ${(statSync(master).size / 1024).toFixed(0)}KB (served as the widest WebP)`);
}
