/**
 * Defence-in-depth codemod: add `.eq("workspace_id", …)` to practice_* reads that are currently safe
 * only BY PROVENANCE — keyed on a parent id that some earlier read resolved inside the workspace.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY. RLS cannot hold this boundary (service_role bypasses it — see practice-tenant-scope-audit.ts),
 * so ~290 child reads are safe only because no child row in practice B carries a patient_id belonging
 * to practice A. That is true today and rests entirely on referential integrity, with nothing behind
 * it. The predicate is free — index-covered on tables that already carry the column — so adding it
 * removes the dependency rather than trading one risk for another.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE TWO REFUSALS THAT MAKE THIS SAFE, AND THE FIRST ONE NEARLY WENT WRONG.
 *
 * 1. PLATFORM-CATALOGUE TABLES ARE NEVER TOUCHED. A live probe (2026-08-12) found EIGHT tables whose
 *    rows carry NULL workspace_id — and for seven it is EVERY row: the investigation catalogue (81),
 *    treatment options (79), the medication catalogue (70), parameter definitions (53), procedure
 *    types (10), parameter packs (5), note templates (4). That NULL is migration 191's deliberate
 *    convention for "platform row, shared by every practice". Adding an equality filter to any read of
 *    them would have hidden the entire shared clinical catalogue from every practice, silently and
 *    everywhere at once. Their correct scope is `.or("workspace_id.is.null,workspace_id.eq.X")`,
 *    which the engines that matter already use. practice_audit_event joins the list because auth
 *    events legitimately carry no workspace.
 *
 * 2. ONLY FUNCTIONS THAT ALREADY KNOW THEIR WORKSPACE. The expression inserted is not guessed from a
 *    list of likely names — it is COPIED from an existing `.eq("workspace_id", X)` in the SAME
 *    function. If a function never scopes anything by workspace, it is left alone and reported. A
 *    codemod that invents `ctx.workspaceId` into a function where `ctx` means something else does not
 *    fail loudly; it compiles.
 *
 *   npx --yes tsx scripts/practice-tenant-scope-codemod.ts           list what it would change
 *   npx --yes tsx scripts/practice-tenant-scope-codemod.ts --apply   write the files
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

/** See refusal 1. Never given an equality filter — a NULL row here means "every practice". */
const PLATFORM_CATALOGUE = new Set([
  "practice_investigation_catalogue", "practice_treatment_option", "practice_medication_catalogue",
  "practice_parameter_definition", "practice_parameter_pack", "practice_procedure_type",
  "practice_note_template", "practice_audit_event",
  // Carry the same platform/workspace duality by design, verified in the migrations.
  "practice_role_capabilities", "practice_plans", "practice_platform_flags", "practice_identifier_format",
  "practice_reserved_handle", "practice_onboarding_step_catalog",
]);

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

function tablesWithWorkspaceId(): Set<string> {
  const dir = join(ROOT, "supabase/migrations");
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter(n => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    let m: RegExpExecArray | null;
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(practice_\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    while ((m = create.exec(sql))) if (/\bworkspace_id\b/i.test(m[2])) out.add(m[1].toLowerCase());
    const alter = /alter\s+table\s+(?:public\.)?(practice_\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?workspace_id\b/gi;
    while ((m = alter.exec(sql))) out.add(m[1].toLowerCase());
  }
  return out;
}

/** The chain following a `.from(...)`, depth-tracked. Same reader as the audit. */
function chainAfter(src: string, from: number): { text: string; end: number } {
  let depth = 0;
  for (let i = from; i < src.length && i < from + 4000; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth < 0) {
        const tail = src.slice(i, Math.min(src.length, i + 260));
        return /^\)\s*\./.test(tail) ? { text: src.slice(from, i) + tail, end: i } : { text: src.slice(from, i), end: i };
      }
    } else if (c === ";" && depth === 0) return { text: src.slice(from, i), end: i };
  }
  return { text: src.slice(from, from + 4000), end: Math.min(src.length, from + 4000) };
}

const WS_FILTER = /\.(eq|in|is|neq|not|filter|match)\(\s*["'`]workspace_id|workspace_id\s*:|\.or\(\s*[`"'][^`"']*workspace_id/;
const KEY_FILTER = /\.(eq|in)\(\s*["'`](\w*_?id)["'`]/;

/**
 * ⚠⚠ WHERE THE PREDICATE MAY BE INSERTED, AND THE FIRST VERSION OF THIS FILE GOT IT WRONG.
 *
 * `.eq()` does NOT exist on what `.from()` returns — a PostgrestQueryBuilder only gains filters after
 * `.select()`, `.update()` or `.delete()`. Inserting straight after `.from("x")` produces
 * `admin.from("x").eq(…)`, which is a RUNTIME TypeError: "admin.from(...).eq is not a function".
 *
 * ⚠ AND THE TYPE CHECKER CANNOT SAVE YOU HERE. These engines take `admin: any` (every one of them
 * carries `/* eslint-disable @typescript-eslint/no-explicit-any *​/` at the top), so `.eq()` on the
 * builder type-checks fine. The first run wrote 203 such calls and tsc reported exactly THREE errors —
 * the three files where the client happens to be properly typed. 200 broken reads compiled clean.
 *
 * So the insertion point is the end of the OPERATION call, found by bracket-matching its arguments
 * (`.select("a, b", { count: "exact", head: true })` nests, so a naive search for `)` truncates it).
 * Returns null when no operation is found, and the site is then skipped rather than guessed at.
 */
function opCallEnd(src: string, fromEnd: number): number | null {
  const window = src.slice(fromEnd, fromEnd + 4000);
  const m = /^\s*\.\s*(select|update|delete)\s*\(/.exec(window)
    ?? /\.\s*(select|update|delete)\s*\(/.exec(window);
  if (!m) return null;
  const openIdx = fromEnd + m.index + m[0].length - 1;   // the '(' itself
  let depth = 0;
  for (let i = openIdx; i < src.length && i < openIdx + 3000; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/**
 * The workspace expression THIS function already uses. See refusal 2: copied, never guessed.
 * Scans from the enclosing function's start to the call site.
 */
function workspaceExprInScope(src: string, callIdx: number): string | null {
  const before = src.slice(0, callIdx);
  const starts = [
    before.lastIndexOf("\nexport async function"), before.lastIndexOf("\nasync function"),
    before.lastIndexOf("\nexport function"), before.lastIndexOf("\nfunction"),
    before.lastIndexOf("\nexport const"), before.lastIndexOf("\nconst"),
  ].filter(i => i >= 0);
  const fnStart = starts.length ? Math.max(...starts) : 0;
  // Look across the whole function body, not just what precedes the call: a later sibling query in the
  // same Promise.all is still the same function's own answer to "which workspace is this".
  const fnEnd = (() => {
    const nextExport = src.indexOf("\nexport ", callIdx);
    return nextExport === -1 ? src.length : nextExport;
  })();
  const body = src.slice(fnStart, fnEnd);
  const m = /\.eq\(\s*["'`]workspace_id["'`]\s*,\s*([^)]+?)\s*\)/.exec(body);
  return m ? m[1].trim() : null;
}

type Change = { file: string; line: number; table: string; expr: string; insertAt: number };

function main() {
  const withWs = tablesWithWorkspaceId();
  const files = [
    ...walk(join(ROOT, "src/lib/practice")),
    ...walk(join(ROOT, "src/app/api/v1/practice")),
    ...walk(join(ROOT, "src/app/practice")),
  ];

  let considered = 0, skippedPlatform = 0, skippedNoExpr = 0, skippedNoColumn = 0, skippedNoOp = 0;
  const byFile = new Map<string, Change[]>();

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const re = /\.from\(\s*["'`](practice_\w+)["'`]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const table = m[1].toLowerCase();
      const { text: chain } = chainAfter(src, m.index);
      if (WS_FILTER.test(chain)) continue;              // already scoped
      if (!KEY_FILTER.test(chain)) continue;            // not a key-scoped read; the audit reports these
      considered++;
      if (PLATFORM_CATALOGUE.has(table)) { skippedPlatform++; continue; }
      if (!withWs.has(table)) { skippedNoColumn++; continue; }
      const expr = workspaceExprInScope(src, m.index);
      if (!expr) { skippedNoExpr++; continue; }
      // See opCallEnd: after the operation, never after .from().
      const insertAt = opCallEnd(src, m.index + m[0].length);
      if (insertAt === null) { skippedNoOp++; continue; }
      const line = src.slice(0, m.index).split("\n").length;
      byFile.set(rel, [...(byFile.get(rel) ?? []), { file: rel, line, table, expr, insertAt }]);
    }
  }

  const total = [...byFile.values()].reduce((n, c) => n + c.length, 0);
  console.log(`\nTENANT-SCOPE CODEMOD ${APPLY ? "(APPLYING)" : "(dry run — pass --apply to write)"}\n`);
  console.log(`  ${considered} key-scoped reads considered`);
  console.log(`  ${total} will gain .eq("workspace_id", …)`);
  console.log(`  ${skippedPlatform} skipped: platform-catalogue table (a NULL workspace means EVERY practice)`);
  console.log(`  ${skippedNoColumn} skipped: table has no workspace_id column`);
  console.log(`  ${skippedNoExpr} skipped: the enclosing function never scopes by workspace — REVIEW BY HAND\n`);

  for (const [file, changes] of [...byFile.entries()].sort()) {
    console.log(`  ${file}  (${changes.length})`);
    if (!APPLY) for (const c of changes.slice(0, 3)) console.log(`      :${c.line} ${c.table} -> .eq("workspace_id", ${c.expr})`);
  }

  if (!APPLY) { console.log("\nNothing written.\n"); return; }

  for (const [file, changes] of byFile) {
    const path = join(ROOT, file);
    let src = readFileSync(path, "utf8");
    // Descending, so earlier offsets stay valid.
    for (const c of [...changes].sort((a, b) => b.insertAt - a.insertAt)) {
      src = src.slice(0, c.insertAt) + `.eq("workspace_id", ${c.expr})` + src.slice(c.insertAt);
    }
    writeFileSync(path, src);
  }
  console.log(`\nWrote ${byFile.size} files, ${total} insertions.\n`);
}

main();
