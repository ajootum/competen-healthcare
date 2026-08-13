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
  resolvePrimary, validateItem, DIAGNOSIS_CERTAINTIES, DEFAULT_CERTAINTY, diagnosisBand,
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

// ── 4. THE RECORDED-ROW BANDING (CP-ENC-DIAG, the owner's colour scheme) ────────────────────────────
//
// A pure function, so the design rules are asserted directly rather than inferred from markup.
{
  const bands = DIAGNOSIS_CERTAINTIES.map(c => ({ c, b: diagnosisBand(c) }));

  check("4a every certainty in the vocabulary gets a band",
    bands.every(({ b }) => b.edge.length > 0), JSON.stringify(bands.map(x => x.c)));

  // ⚠ THE RAMP MUST ACTUALLY BE A RAMP. Three weights that resolved to the same string would band
  // every row identically while every other assertion here still passed.
  const ramp = ["confirmed", "provisional", "suspected"].map(c => diagnosisBand(c).edge);
  check("4b CONTROL: the three confidence weights are distinct, so the banding is not uniform",
    new Set(ramp).size === 3, ramp.join(" | "));

  // ⚠ ruled_out IS A NEGATION, NOT A WEAK DIAGNOSIS. Read as "probably has this" it is the worst
  // misreading this list allows, so it leaves the hue AND is struck through.
  const out = diagnosisBand("ruled_out");
  check("4c ruled out is dashed, struck, and outside the confidence hue",
    out.dashed && out.struck && !ramp.includes(out.edge), JSON.stringify(out));
  check("4d CONTROL: nothing else is dashed or struck",
    bands.filter(({ c }) => c !== "ruled_out").every(({ b }) => !b.dashed && !b.struck));

  // ⚠ THE SAME SHAPE AS THE PROCEDURE ENGINE COERCING AN UNKNOWN STATUS TO PERFORMED. A certainty this
  // build does not know -- a typo, a newer vocabulary, a stale client -- must never be drawn as the
  // most settled thing on the screen. The failure has to land on the side that claims LESS.
  const unknown = diagnosisBand("probably_something");
  check("4e an unrecognised certainty falls to the WEAKEST band, never confirmed",
    unknown.edge === diagnosisBand("suspected").edge && unknown.edge !== diagnosisBand("confirmed").edge,
    JSON.stringify(unknown));

  // ⚠ CERTAINTY IS A CONFIDENCE AXIS AND THE ALERT TOKENS ARE A GOOD/BAD ONE. Green on a confirmed
  // cancer would read as reassurance. This keeps the two vocabularies apart by name.
  const alertish = /warning|success|critical|danger|error/i;
  check("4f no band borrows the alert palette",
    [...bands.map(x => x.b.edge), out.edge].every(e => !alertish.test(e)),
    bands.map(x => x.b.edge).join(" | "));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
