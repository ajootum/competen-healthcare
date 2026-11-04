// A slide deck exported to PDF, about 10 MB: 16 landscape slides, each a heading, teaching text and a photo-like picture
// (random pixels, so it does not compress: the size is real bytes on the wire). No patient information.
// usage: npx tsx make-deck.mts <out.pdf> <seed> [targetBytes]
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { createRequire } from "node:module";
const { PDFDocument, StandardFonts, rgb } = createRequire(process.cwd() + "/package.json")("pdf-lib");

const [out, seedArg, targetArg] = process.argv.slice(2);
let seed = Number(seedArg ?? 1) * 2654435761 >>> 0;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const target = Number(targetArg ?? 10_300_000);

function png(w: number, h: number): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (rnd() * 256) | 0; }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}

const topics = [
  ["Fluid balance", "Intake and output are recorded over 24 hours. A positive balance can signal fluid retention; review weight, oedema and urine output together."],
  ["Early warning scores", "Respiratory rate is often the first observation to change. Recalculate the score after every full set of observations and escalate as the local policy states."],
  ["Hand hygiene", "The five moments: before touching a patient, before a clean procedure, after body fluid exposure, after touching a patient, after touching surroundings."],
  ["Pressure ulcer prevention", "Assess skin on admission and regularly after. Reposition, manage moisture, optimise nutrition and use pressure-redistributing surfaces when indicated."],
  ["Oxygen therapy", "Oxygen is a drug: prescribe a target saturation range. Most adults 94 to 98 percent, people at risk of hypercapnia 88 to 92 percent."],
  ["Medication safety", "Check the right person, drug, dose, route and time, plus the right to refuse and the right documentation. Stop and ask when anything is unclear."],
  ["Sepsis recognition", "Think sepsis in anyone with an infection who looks unwell. Take observations, lactate and cultures, and start treatment within the hour where indicated."],
  ["Pain assessment", "Use a validated scale suited to the person. Reassess after every intervention and record both the score and the effect on function."],
];
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const slides = 16;
const perImage = Math.floor((target - 60_000) / slides);
const side = Math.floor(Math.sqrt(perImage / 3));
for (let i = 0; i < slides; i++) {
  const page = doc.addPage([960, 540]);
  const [title, text] = topics[i % topics.length];
  page.drawText(`${i + 1}. ${title}`, { x: 40, y: 480, size: 30, font: bold, color: rgb(0.1, 0.2, 0.4) });
  const words = text.split(" "); let line = ""; let y = 430;
  for (const w of words) { if ((line + " " + w).length > 52) { page.drawText(line, { x: 40, y, size: 18, font }); y -= 26; line = w; } else line = line ? `${line} ${w}` : w; }
  if (line) page.drawText(line, { x: 40, y, size: 18, font });
  page.drawText(`Slide ${i + 1} of ${slides}. Study notes for revision, no patient information.`, { x: 40, y: 40, size: 11, font, color: rgb(0.4, 0.4, 0.4) });
  const img = await doc.embedPng(png(side, side));
  page.drawImage(img, { x: 560, y: 90, width: 360, height: 360 });
}
const bytes = await doc.save({ useObjectStreams: false });
writeFileSync(out, bytes);
console.log(out, bytes.length);
