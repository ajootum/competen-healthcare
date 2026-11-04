// SCHOLAR LEARNING DESIGN SYSTEM: the contrast table of every learning tone (light and staged dark), from tokens.ts.
// Run from the repo root:  npx tsx docs/evidence/LEARN-REDESIGN/contrast.ts   (exit 1 on any failure)
import { learningPairs } from "../../../src/lib/design/scholar-learning-contrast";

const rows = learningPairs();
let minText = 99, minUi = 99;
for (const p of rows) { if (p.min === 4.5) minText = Math.min(minText, p.ratio); else minUi = Math.min(minUi, p.ratio); }
const fails = rows.filter(p => p.ratio < p.min);
console.log(rows.map(p => `${p.ratio >= p.min ? "PASS" : "FAIL"}  ${p.scheme.padEnd(5)}  ${p.tone.padEnd(10)}  ${p.what.padEnd(42)} ${p.ratio.toFixed(2)} (min ${p.min})`).join("\n"));
console.log(`\n${fails.length ? `${fails.length} FAIL` : "ALL PASS"}: ${rows.length} pairs; lowest text pair ${minText.toFixed(2)}:1 (AA 4.5), lowest non-text pair ${minUi.toFixed(2)}:1 (AA 3)`);
process.exit(fails.length ? 1 : 0);
