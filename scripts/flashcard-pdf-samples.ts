// SCHOLAR-FLASHCARDS-01 s8-12: writes the three flashcard downloads for the respiratory fixture deck, for review.
//   npx tsx scripts/flashcard-pdf-samples.ts <out-dir>
// Fixture data only. No database, no network, no AI.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlashcardPdf, exportFilename } from "../src/lib/individual/scholar/flashcard-pdf";
import { RESP_GENERATED_AT, respiratoryCards } from "../src/lib/individual/scholar/flashcard-pdf.fixture";

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: npx tsx scripts/flashcard-pdf-samples.ts <out-dir>");
  mkdirSync(out, { recursive: true });
  const input = { cards: respiratoryCards(), title: "Respiratory Assessment", generatedAt: RESP_GENERATED_AT };
  for (const [format, layout, suffix] of [["deck", undefined, ""], ["print", "duplex", ""], ["print", "single", "-single-sided"], ["guide", undefined, ""]] as const) {
    const bytes = await buildFlashcardPdf(format, input, { layout });
    const name = exportFilename(input.title, format, input.generatedAt).replace(/\.pdf$/, `${suffix}.pdf`);
    writeFileSync(join(out, name), bytes);
    console.log(`${name}  ${bytes.byteLength} bytes`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
