// SCHOLAR-FLASHCARDS-01 s8-12 / SCHOLAR-FLASHCARDS-QA-01: writes the flashcard downloads for the respiratory fixture deck,
// for review: the deck, printable double-sided and single-sided foldable cards, and the comprehensive and concise guides.
//   npx tsx scripts/flashcard-pdf-samples.ts <out-dir>
// Fixture data only. No database, no network, no AI.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlashcardPdf, exportFilename, type FlashcardExportFormat, type FlashcardPdfOptions } from "../src/lib/individual/scholar/flashcard-pdf";
import { RESP_GENERATED_AT, respiratoryCards } from "../src/lib/individual/scholar/flashcard-pdf.fixture";

const SAMPLES: [FlashcardExportFormat, FlashcardPdfOptions][] = [
  ["deck", {}], ["print", { layout: "duplex" }], ["print", { layout: "fold" }], ["guide", { guide: "comprehensive" }], ["guide", { guide: "concise" }],
];

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: npx tsx scripts/flashcard-pdf-samples.ts <out-dir>");
  mkdirSync(out, { recursive: true });
  const input = { cards: respiratoryCards(), title: "Respiratory Assessment", generatedAt: RESP_GENERATED_AT };
  for (const [format, opts] of SAMPLES) {
    const bytes = await buildFlashcardPdf(format, input, opts);
    const name = exportFilename(input.title, format, input.generatedAt, opts);
    writeFileSync(join(out, name), bytes);
    console.log(`${name}  ${bytes.byteLength} bytes`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
