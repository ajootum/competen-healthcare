// Slice the supplied 5x2 contact sheet into ten profession portraits.
//
// SOURCE IS A CONTACT SHEET, not ten files, so the crop geometry lives here rather than in a designer's
// memory: re-running this against a re-exported sheet of the same shape reproduces the set exactly.
//
// THE LABELS DESCRIBE WHAT IS IN THE PICTURE, and that is the only rule that matters here. The frame at
// position 7 shows someone at a microscope; calling it "Dentist" because a comp listed dentists would put
// a false caption under a real-looking photograph. So the audience list on the page follows the sheet --
// surgeon and laboratory scientist are in, dentist and occupational therapist are out, because that is
// who was photographed.
//
//   node scripts/build-practitioner-portraits.mjs "<path to sheet.png>"

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/build-practitioner-portraits.mjs <sheet.png>"); process.exit(1); }

const OUT = join(process.cwd(), "public", "images", "practice", "professions");
mkdirSync(OUT, { recursive: true });

// Row-major, matching the sheet.
const TILES = [
  "doctor", "nurse", "clinical-officer", "midwife", "surgeon",
  "pharmacist", "laboratory-scientist", "nutritionist", "physiotherapist", "psychologist",
];

const COLS = 5, ROWS = 2;

const meta = await sharp(SRC).metadata();
const cellW = Math.floor(meta.width / COLS);
const cellH = Math.floor(meta.height / ROWS);
console.log(`sheet ${meta.width}x${meta.height} -> ${COLS}x${ROWS} cells of ${cellW}x${cellH}`);

let total = 0;
for (let i = 0; i < TILES.length; i++) {
  const col = i % COLS, row = Math.floor(i / COLS);
  const file = join(OUT, `${TILES[i]}.webp`);
  // A 4:5 portrait crop taken from the TOP of the cell: these are head-and-shoulders frames, and cropping
  // from the centre would cut the face on the taller ones.
  const targetH = Math.min(cellH, Math.round(cellW * 1.25));
  const info = await sharp(SRC)
    .extract({ left: col * cellW, top: row * cellH, width: cellW, height: targetH })
    .resize(560, 700, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toFile(file);
  total += info.size;
  console.log(`  ${TILES[i]}.webp  ${(info.size / 1024).toFixed(0)}KB`);
}
console.log(`\n${TILES.length} portraits, ${(total / 1024).toFixed(0)}KB total`);
