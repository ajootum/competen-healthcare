/**
 * Diagnosis working-set harness (CP-ENC-DIAG-001). Pure rules only -- no database.
 *
 * The two rules in s2 that are one-way traps, and the batch semantics around them.
 *
 * WHAT IT PROVES:
 *   1. ONE PRIMARY PER ENCOUNTER, and the LAST tick wins rather than the first.
 *   2. AN UNKNOWN CERTAINTY IS REFUSED, NOT COERCED -- the single-diagnosis function silently rewrote
 *      anything it did not recognise to `provisional`, so a caller's typo became a clinical qualifier
 *      nobody chose.
 *   3. A blank label is refused, and the refusal names the item rather than the batch.
 *
 *   npx --yes tsx scripts/practice-diagnosis-capture-harness.ts
 */
import {
  resolvePrimary, validateItem, DIAGNOSIS_CERTAINTIES, DEFAULT_CERTAINTY,
} from "../src/lib/practice/diagnosis-capture";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

console.log("\nDIAGNOSIS WORKING-SET HARNESS\n");

// 1 ── one primary
{
  const none = resolvePrimary([{ label: "a" }, { label: "b" }]);
  check("1a nothing ticked means no primary, not an accidental first",
    none.primaryIndex === null, String(none.primaryIndex));

  const one = resolvePrimary([{ label: "a" }, { label: "b", isPrimary: true }]);
  check("1b a single tick is the primary", one.primaryIndex === 1, String(one.primaryIndex));

  // ⚠ THE RULE THAT MATTERS: a screen that let two be ticked must not silently keep the older one.
  const two = resolvePrimary([{ label: "a", isPrimary: true }, { label: "b" }, { label: "c", isPrimary: true }]);
  check("1c ⚠ two ticks: the LAST wins, and the other is reported as demoted rather than dropped quietly",
    two.primaryIndex === 2 && two.demoted.length === 1 && two.demoted[0] === 0,
    JSON.stringify(two));
}

// 2 ── certainty
{
  const good = validateItem({ label: "Essential hypertension", certainty: "confirmed" });
  check("2a a known certainty is kept", good.ok && good.certainty === "confirmed", JSON.stringify(good));

  const dflt = validateItem({ label: "Essential hypertension" });
  check("2b an absent certainty falls back to the documented default",
    dflt.ok && dflt.certainty === DEFAULT_CERTAINTY, JSON.stringify(dflt));

  // ⚠ REFUSED, NOT COERCED.
  const bad = validateItem({ label: "Essential hypertension", certainty: "definitely" });
  check("2c ⚠ an UNKNOWN certainty is refused rather than rewritten to provisional",
    !bad.ok && bad.code === "CERTAINTY_INVALID", JSON.stringify(bad));

  check("2d and the four are exactly what practice_diagnosis accepts",
    DIAGNOSIS_CERTAINTIES.join(",") === "suspected,provisional,confirmed,ruled_out",
    DIAGNOSIS_CERTAINTIES.join(","));
}

// 3 ── labels
{
  const blank = validateItem({ label: "   " });
  check("3a a blank label is refused", !blank.ok && blank.code === "LABEL_REQUIRED", JSON.stringify(blank));
  const trimmed = validateItem({ label: "  Acute URTI  " });
  check("3b and a real one is trimmed rather than stored with its whitespace",
    trimmed.ok && trimmed.label === "Acute URTI", JSON.stringify(trimmed));
  const long = validateItem({ label: "x".repeat(301) });
  check("3c an absurd label is refused", !long.ok && long.code === "LABEL_TOO_LONG", JSON.stringify(long));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
