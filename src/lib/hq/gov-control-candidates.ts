import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 §6 — CONTROL CANDIDATES, derived from the product's own source.
//
// ⚠ THESE ARE CANDIDATES AND NOT CONTROLS, AND THE DISTINCTION IS THE ENTIRE POINT OF THIS FILE.
//
// The product enforces hundreds of rules: named CHECK constraints that refuse a wrong write, database
// triggers that refuse a wrong transition, and harnesses that try to break both. In the plain sense
// those are preventive and detective controls, and it would be easy — and wrong — to register them as
// governed controls automatically.
//
// §6: "CONTROL EXISTENCE IS NOT PROOF OF EFFECTIVENESS", and testing independence is configurable
// precisely so that the person who built a control cannot certify it. A product that wrote its own
// constraints into its own control catalogue and marked them effective would be self-certifying, which
// is the failure §6 exists to prevent, executed at scale and with a straight face.
//
// So this module counts what EXISTS in the source and says so. Whether any of it is a governed control
// — with an owner, an evidence requirement and a test regime — is a decision somebody makes, and the
// answer today is none of it.
//
// ⚠ AND A FAILED READ RETURNS null, NEVER ZERO. If the migration or script directories are not present
// in a deployed bundle, this page must say the source could not be read. "0 constraints" would be a
// measurement claiming this product enforces nothing, which is the opposite of true.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type ControlCandidates = {
  /** Named CHECK constraints. Preventive: the write is refused before it lands. */
  checkConstraints: number;
  /** Database triggers. Preventive or corrective, depending on what they do. */
  triggers: number;
  /** Append-only trails — a specific and load-bearing kind of preventive control. */
  appendOnlyTrails: number;
  /** Harness scripts. Detective: they look for the failure rather than preventing it. */
  harnesses: number;
  /** Migration files scanned, so a reader can see the denominator of the scan itself. */
  migrationsScanned: number;
  /** A sample, so the counts are checkable rather than merely large. */
  sample: { name: string; kind: "check" | "trigger" | "harness" }[];
} | null;

/**
 * Read the product's own enforcement surface.
 *
 * ⚠ SYNCHRONOUS AND WRAPPED. This runs during a server render and the directories may legitimately be
 * absent — reading them is a best effort, and the failure is reported rather than swallowed into a zero.
 */
export function loadControlCandidates(root = process.cwd()): ControlCandidates {
  try {
    const migrationDir = join(root, "supabase", "migrations");
    const files = readdirSync(migrationDir).filter(f => f.endsWith(".sql"));
    if (files.length === 0) return null;

    let sql = "";
    for (const f of files) sql += readFileSync(join(migrationDir, f), "utf8") + "\n";

    // ⚠ COMMENTS STRIPPED BEFORE COUNTING. Every one of these migrations DISCUSSES its constraints in
    // prose above them, and a count that included the discussion would inflate with every explanation
    // written. Third time this build has had to strip commentary before matching.
    const code = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

    const checks = new Set([...code.matchAll(/constraint\s+(\w+)\s+check/gi)].map(m => m[1]));
    const triggers = new Set([...code.matchAll(/create\s+trigger\s+(\w+)/gi)].map(m => m[1]));
    const appendOnly = new Set(
      [...code.matchAll(/create\s+or\s+replace\s+function\s+(\w*immutable\w*)/gi)].map(m => m[1]),
    );

    let harnesses: string[] = [];
    try {
      harnesses = readdirSync(join(root, "scripts")).filter(f => f.endsWith("-harness.ts"));
    } catch {
      harnesses = [];
    }

    const sample: ControlCandidates extends null ? never : NonNullable<ControlCandidates>["sample"] = [
      ...[...checks].slice(0, 4).map(n => ({ name: n, kind: "check" as const })),
      ...[...triggers].slice(0, 3).map(n => ({ name: n, kind: "trigger" as const })),
      ...harnesses.slice(0, 3).map(n => ({ name: n.replace(/\.ts$/, ""), kind: "harness" as const })),
    ];

    return {
      checkConstraints: checks.size,
      triggers: triggers.size,
      appendOnlyTrails: appendOnly.size,
      harnesses: harnesses.length,
      migrationsScanned: files.length,
      sample,
    };
  } catch {
    return null;
  }
}
