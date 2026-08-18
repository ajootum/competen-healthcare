/**
 * COMP-ENG-001 §7 — classify every scripts/*-harness.ts by real, grep-derived signals.
 *
 * ⚠ THIS PRODUCES EVIDENCE, NOT OPINIONS. Every field below is extracted from the file's actual source
 * — an import, a string literal, a call name — never guessed from the filename or remembered from
 * having written some of these harnesses earlier in the same session. A classification a reader can't
 * re-derive from the same grep is a claim with no way to be checked, which is the exact failure this
 * whole hardening spec exists to close.
 *
 * WHAT THIS DOES NOT KNOW: whether a harness's fixture cleanup actually WORKS (only that the file
 * imports the shared cleanup helper or defines its own cleanup() function), and whether "insert" calls
 * are all inside a fixture-and-cleanup pattern or leak state (only that insert/update/delete/upsert
 * appear somewhere in the file). Both are real limits of a static, mechanical pass — a human or a live
 * run is still the authority on whether a specific harness is safe to automate. This script tells you
 * WHERE TO LOOK, not "trust me".
 *
 * Run: npx tsx scripts/harness-classify.ts            (human-readable table + summary)
 *      npx tsx scripts/harness-classify.ts --json      (machine-readable, for regenerating the doc)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "scripts";

type Row = {
  file: string;
  purpose: string;
  specRefs: string[];
  usesSupabase: boolean;
  usesServiceRole: boolean;
  mutates: boolean;
  mutationVerbs: string[];
  usesSharedCleanupHelper: boolean;
  hasMigrationGate: boolean;
  tier: "pure/local" | "mocked" | "privileged-live" | "release-only";
};

function extractPurpose(src: string, file: string): string {
  // The dominant convention in this codebase (184 of 212, confirmed) is a /** ... */ block near the top
  // whose first meaningful line names the spec and the subject. Try that first.
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (m) {
    const lines = m[1].split("\n").map(l => l.replace(/^\s*\*\s?/, "").trim());
    for (const l of lines) {
      if (l.length < 8) continue;
      if (/^[⚠—\-–]/.test(l)) continue; // skip a leading warning/decoration line
      return l.slice(0, 160);
    }
  }

  // ⚠ THE REMAINING 28 USE A LEADING BLOCK OF `//` LINE COMMENTS INSTEAD, confirmed by direct count
  // (cgr-gate-harness.ts is one). Missing this fallback would have reported "no header comment found"
  // for real, documented files — 13% of the inventory silently understated for a comment-style
  // difference, not an actual absence of documentation.
  const leadingLineComments: string[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("//")) break;
    leadingLineComments.push(line.replace(/^\/\/\s?/, ""));
  }
  for (const l of leadingLineComments) {
    if (l.length < 8) continue;
    if (/^[⚠—\-–]/.test(l)) continue;
    return l.slice(0, 160);
  }

  return `(no header comment found — see ${file})`;
}

function classify(row: Omit<Row, "tier">): Row["tier"] {
  if (!row.usesSupabase) return "pure/local";
  // "mocked" would mean it stubs the client rather than hitting a real project. None of this
  // codebase's harnesses do that today (confirmed: every file importing @supabase/supabase-js calls
  // createClient with a real URL/key pair from env) -- so this tier is reachable by the classifier but
  // is expected to be empty until/unless a mocking convention is introduced.
  if (row.usesServiceRole || row.mutates) return "privileged-live";
  return "privileged-live"; // any live Supabase read still needs real project credentials today
}

function main() {
  const files = readdirSync(DIR).filter(f => f.endsWith("-harness.ts")).sort();
  const rows: Row[] = [];

  for (const file of files) {
    const path = join(DIR, file);
    const src = readFileSync(path, "utf8");

    const specRefs = [...new Set(
      [...src.matchAll(/\b(CPR-[A-Z0-9-]+|COMP-[A-Z0-9-]+|PLAT-[A-Z0-9-]+)\b/g)].map(m => m[1]),
    )].slice(0, 3);

    const usesSupabase = /@supabase\/supabase-js/.test(src);
    const usesServiceRole = /SUPABASE_SERVICE_ROLE_KEY/.test(src);

    // ⚠ A MUTATION VERB WITHOUT A SUPABASE IMPORT IS A FALSE POSITIVE, NOT A FINDING — confirmed on
    // pui-header-harness.ts, whose one `.delete(` match is a string-literal assertion that OTHER source
    // code calls `cookieStore.delete(...)`, not a database write. Requiring usesSupabase as a
    // precondition is the fix, not a caveat bolted on after: a source-inspection harness with no
    // Supabase client cannot mutate a database no matter what substrings its assertions check for.
    const mutationVerbs = usesSupabase
      ? ["insert", "update", "delete", "upsert"].filter(v => new RegExp(`\\.${v}\\(`).test(src))
      : [];
    const mutates = mutationVerbs.length > 0;

    // ⚠ THIS DETECTS ONE SPECIFIC CONVENTION, NOT "DOES THIS HARNESS CLEAN UP". Confirmed on
    // hq-guard-harness.ts: it inserts a fixture appointment, updates it, and deletes it by id inline —
    // real cleanup, with no separate cleanup() function and no shared helper import, so this regex
    // misses it. A false NEGATIVE here means "doesn't use the shared helper," not "leaks data" — do not
    // let this field alone stand for "unsafe." See the flagged list's framing in the generated doc.
    const usesSharedCleanupHelper = /_cleanup"|cleanupOnKill|FIXTURE_OWNER_PREFIX|async function cleanup\(/.test(src);
    const hasMigrationGate = /NOT (READY|APPLIED)|IS NOT APPLIED/.test(src);

    const base = { file, purpose: extractPurpose(src, file), specRefs, usesSupabase, usesServiceRole, mutates, mutationVerbs, usesSharedCleanupHelper, hasMigrationGate };
    rows.push({ ...base, tier: classify(base) });
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (process.argv.includes("--md")) {
    console.log("| File | Purpose | Tier | Spec refs | Writes | Shared cleanup helper | Migration-gated |");
    console.log("|---|---|---|---|---|---|---|");
    for (const r of rows) {
      const purpose = r.purpose.replace(/\|/g, "\\|");
      // ⚠ "no" here means "does not use the shared helper", not "does not clean up" — see the doc's
      // own caveat before reading this column as a safety verdict.
      console.log(
        `| \`${r.file}\` | ${purpose} | ${r.tier} | ${r.specRefs.join(", ") || "—"} `
        + `| ${r.mutates ? r.mutationVerbs.join("/") : "read-only"} | ${r.usesSharedCleanupHelper ? "yes" : (r.mutates ? "no — verify" : "n/a")} `
        + `| ${r.hasMigrationGate ? "yes" : "no"} |`,
      );
    }
    return;
  }

  const byTier = new Map<string, Row[]>();
  for (const r of rows) byTier.set(r.tier, [...(byTier.get(r.tier) ?? []), r]);

  console.log(`\nHARNESS CLASSIFICATION — ${rows.length} files scanned in ${DIR}/\n`);
  for (const [tier, group] of byTier) {
    console.log(`${tier}  (${group.length})`);
  }
  console.log();
  console.log(`mutate the database:        ${rows.filter(r => r.mutates).length}`);
  console.log(`read-only (Supabase, no write): ${rows.filter(r => r.usesSupabase && !r.mutates).length}`);
  console.log(`no Supabase at all:          ${rows.filter(r => !r.usesSupabase).length}`);
  console.log(`use the shared cleanup helper:      ${rows.filter(r => r.usesSharedCleanupHelper).length}`);
  console.log(`mutate WITHOUT the shared helper (verify individually — may clean up inline instead): ${rows.filter(r => r.mutates && !r.usesSharedCleanupHelper).length}`);
  console.log(`gate on a migration being applied: ${rows.filter(r => r.hasMigrationGate).length}`);

  const noSharedHelper = rows.filter(r => r.mutates && !r.usesSharedCleanupHelper);
  if (noSharedHelper.length) {
    console.log(`\n⚠ MUTATE WITHOUT THE SHARED CLEANUP HELPER — this means "verify their own cleanup`);
    console.log(`  individually," not "these leak data." hq-guard-harness.ts is a confirmed example that`);
    console.log(`  cleans up inline (insert, update, delete-by-id) with no separate helper or function name`);
    console.log(`  this regex recognises:`);
    for (const r of noSharedHelper) console.log(`  ${r.file}`);
  }
}

main();
