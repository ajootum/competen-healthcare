/**
 * Build the Open Graph social cards.
 *
 * WHAT THESE ARE FOR. A link pasted into WhatsApp, LinkedIn or Slack is unfurled by fetching the page and
 * reading its og:image. With no image the link renders as bare text, and a bare URL in a group chat is a
 * link nobody taps -- which matters most in exactly the market this product is sold into.
 *
 * SIZING. 1200x630 is the size every platform crops from; anything else gets cut in a way you cannot
 * predict. The source screenshots are 3:2, so they are letterboxed onto a branded canvas with `contain`
 * rather than cropped to fit -- a crop of a dashboard removes the half that made it worth showing.
 *
 * JPEG, NOT WEBP. The site's own images are WebP because page weight matters, but social scrapers are a
 * different audience: several still fail to unfurl WebP, and the failure is SILENT -- the page looks
 * perfect and the card comes out blank. JPEG is universally unfurled and, on photographic content, about a
 * fifth of the size of the equivalent PNG.
 *
 *   node scripts/build-og-images.mjs
 */
import sharp from "sharp";
import { existsSync, mkdirSync, statSync } from "node:fs";

const OUT = "public/images/og";
const W = 1200, H = 630;

// Brand tint for the letterbox bars. The Practice blue at low opacity over white, computed once rather
// than eyeballed, so the bars read as deliberate rather than as a rendering accident.
const CANVAS = { r: 239, g: 244, b: 254, alpha: 1 };

/**
 * [output name, source image, what it is]. Sources are existing site assets -- nothing new is invented.
 *
 * THESE GO STALE SILENTLY WHEN THE SCREENS ARE REBUILT. The V2 mockups renamed dashboard.webp to
 * command-centre.webp and redrew booking.webp in place; the existsSync guard below caught the rename but
 * could not catch the redraw, so /practice/book kept unfurling a superseded screen while every check passed.
 * Re-run this script whenever scripts/build-practice-images.mjs is re-run.
 */
const CARDS = [
  ["competen",         "public/images/home/hero-clinicians.png",     "site-wide default"],
  ["practice",         "public/images/practice/command-centre.webp", "Competen Practice"],
  ["practice-booking", "public/images/practice/booking.webp",        "patient booking journey"],
];

mkdirSync(OUT, { recursive: true });

let built = 0;
for (const [name, src, what] of CARDS) {
  if (!existsSync(src)) {
    console.error(`  MISSING source ${src} -- ${name}.jpg not built, so ${what} will unfurl without a card.`);
    process.exitCode = 1;
    continue;
  }
  const dest = `${OUT}/${name}.jpg`;
  await sharp(src)
    .resize(W, H, { fit: "contain", background: CANVAS })
    .flatten({ background: CANVAS })
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toFile(dest);
  console.log(`  ${name}.jpg  ${(statSync(dest).size / 1024).toFixed(0)}KB  (${what})`);
  built++;
}

console.log(`\n${built}/${CARDS.length} cards at ${W}x${H}.`);
