/**
 * Practice tenant-scope audit -- every practice_* query, and whether it can see another practice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WHY RLS POLICIES CANNOT FIX THIS, AND WHY WRITING SOME WOULD BE WORSE THAN NOTHING.
 *
 * Every practice_* table has RLS ENABLED and ZERO POLICIES, which is deny-by-default and correct: an
 * anon or authenticated client reads nothing (proven live -- anon sees 0 rows, service_role sees all).
 *
 * But this application does not use those clients. Every read and write in src/lib/practice goes
 * through createAdminClient(), the SERVICE-ROLE client, and in Supabase `service_role` carries the
 * Postgres BYPASSRLS attribute. No policy -- however carefully written, even under FORCE ROW LEVEL
 * SECURITY -- constrains a role that bypasses RLS. Adding policies to these tables would produce a
 * security control that claims more than it enforces, which CPR-370 already names as worse than an
 * absent one: the next reader would believe the tenant boundary was held in the database, and stop
 * looking at the query.
 *
 * SO THE TENANT BOUNDARY IS HELD IN THE QUERY, BY `.eq("workspace_id", ctx.workspaceId)`, AND ONLY
 * THERE. One forgotten filter is a cross-tenant read that compiles, returns 200, and silently includes
 * another practice's patients. That is the exact hole this file exists to make impossible to open
 * quietly -- the same job scripts/read-scope-audit.ts does for hospital_id on the estate plane, which
 * covers only src/app/api routes and no practice engine.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT CLASSIFIES, AND WHY UNSCOPED IS NOT AUTOMATICALLY A FINDING.
 *
 *   SCOPED        the chain filters or writes workspace_id. Nothing to do.
 *   ID-ONLY       filtered by a primary key with no workspace_id. SAFE ONLY IF that id was itself
 *                 obtained from a workspace-scoped read in the same request. Reported for a human,
 *                 because the scanner cannot see where the id came from and must not pretend to.
 *   NO TENANT     the table has no workspace_id column at all (read from the migrations, not assumed).
 *   UNSCOPED      neither. Every one of these is a candidate cross-tenant read.
 *
 * ⚠ THE ALLOWLIST CARRIES REASONS, NOT NAMES. An entry that only names a file silences that file
 * forever, including the tenant-table read somebody adds to it next year.
 *
 *   npx --yes tsx scripts/practice-tenant-scope-audit.ts
 *   npx --yes tsx scripts/practice-tenant-scope-audit.ts --all    list the scoped ones too
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SHOW_ALL = process.argv.includes("--all");

// ── 1. WHICH TABLES EVEN HAVE A TENANT COLUMN, read from the migrations rather than assumed ────────
//
// A table with no workspace_id cannot be workspace-scoped, and reporting it as unscoped forever would
// train people to skim this output. Parsed from CREATE TABLE bodies across every migration.

function tenantColumnByTable(): { withWs: Set<string>; seen: Set<string> } {
  const dir = join(ROOT, "supabase/migrations");
  const withWs = new Set<string>();
  const seen = new Set<string>();
  if (!existsSync(dir)) return { withWs, seen };
  for (const f of readdirSync(dir).filter(n => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(practice_\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const table = m[1].toLowerCase();
      seen.add(table);
      if (/\bworkspace_id\b/i.test(m[2])) withWs.add(table);
    }
  }
  // Columns added later by ALTER, so a table created without one is still tenant-scoped.
  for (const f of readdirSync(dir).filter(n => n.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    const re = /alter\s+table\s+(?:public\.)?(practice_\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?workspace_id\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) { withWs.add(m[1].toLowerCase()); seen.add(m[1].toLowerCase()); }
  }
  return { withWs, seen };
}

// ── 2. THE SOURCE WALK ──────────────────────────────────────────────────────────────────────────────

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

/**
 * ⚠ TABLE NAMES THAT ARE NOT STRING LITERALS -- THE BLIND SPOT THAT MADE THE FIRST VERSION OF THIS
 * FILE REPORT "ZERO UNSCOPED READS" WHILE THREE REAL ONES WERE OPEN.
 *
 * Roughly a seventh of this codebase's queries name their table through a constant:
 * `.from(INVESTIGATION_TABLES.setItem)`, `.from(TREATMENT_TABLES.templateItem)`, `.from(FORM_TABLE)`.
 * A scanner matching only `.from("practice_…")` cannot see any of them, and an audit that cannot see a
 * call site will certify it. Two of the three genuine holes found on 2026-08-12 -- cross-tenant reads
 * of investigation aliases and of other practices' PRESCRIPTION TEMPLATE ITEMS -- were in exactly
 * this shape.
 *
 * So the constants are resolved: any `const NAME = …` whose value mentions a practice_ table makes
 * `.from(NAME)` and `.from(NAME.anything)` count. The recorded lesson applies -- THE DETECTION WAS THE
 * BUG -- and a scanner that silently narrows its own scope is the worst kind, because its green line
 * is read as coverage.
 */
function practiceTableConstants(files: string[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]{2,})\s*(?::[^=]{0,120})?=\s*([\s\S]{0,700}?);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      // ⚠ THE VALUE MUST OPEN AS A TABLE NAME OR A MAP OF THEM. A lazy match to the next semicolon
      // will happily run past a short declaration into a nearby practice_ string, which is how
      // `Uint8Array.from(n)` in offline-lock.ts was first reported as an unscoped cross-tenant read.
      // A scanner's false positives cost it its readers as surely as its false negatives.
      if (!/^\s*(["'`]practice_|\{)/.test(m[2])) continue;
      if (/["'`]practice_\w+["'`]/.test(m[2])) names.add(m[1]);
    }
  }
  return names;
}

/**
 * The query chain that follows a `.from("practice_x")`.
 *
 * Depth-tracked from the match, so it stops at the `;` that ends the statement and at the `)` that
 * closes an enclosing wrapper -- lookup(CAP, () => admin.from(...)...) is the shape half this codebase
 * uses, and a naive "read to the next semicolon" would swallow the rest of the function.
 */
function chainAfter(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length && i < from + 4000; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      // ⚠ THE WRAPPER TAIL. `build(admin.from("x")).is("workspace_id", null)` applies its scope OUTSIDE
      // the call the .from() sits in, and stopping dead at that `)` reported four correctly-scoped
      // reads as open. Only the immediately-chained tail is taken (a `)` followed by `.`), so this
      // widens the window by one call level and not to the rest of the file.
      if (depth < 0) {
        const tail = src.slice(i, Math.min(src.length, i + 260));
        return /^\)\s*\./.test(tail) ? src.slice(from, i) + tail : src.slice(from, i);
      }
    } else if (c === ";" && depth === 0) return src.slice(from, i);
  }
  return src.slice(from, Math.min(src.length, from + 4000));
}

// ⚠ FILTER POSITIONS ONLY, NEVER A BARE MENTION. `.select("workspace_id, handle, ...")` READS the
// column and scopes nothing -- an early version of this file matched the word anywhere in the chain
// and cleared two genuinely cross-tenant reads that select workspace_id in their column list.
//
// `.is("workspace_id", null)` counts, and is the deliberate PLATFORM-ROW read (migration 191's
// null-workspace template rows). `.or("workspace_id.is.null,workspace_id.eq.X")` counts too: it is the
// both-scopes read the parameter engines use on purpose.
const WS_FILTER = new RegExp(
  [
    /\.(eq|in|is|neq|not|filter|match)\(\s*["'`]workspace_id/.source,
    /workspace_id\s*:/.source,
    /\.match\(\s*\{[^}]*workspace_id/.source,
    /\.or\(\s*[`"'][^`"']*workspace_id/.source,
  ].join("|"),
);
const ID_FILTER = /\.(eq|in)\(\s*["'`]id["'`]/;
// ⚠ A FOREIGN KEY IS SCOPING, JUST ONE HOP AWAY. `.eq("patient_id", id)` is safe exactly when that
// patient id came from a workspace-scoped read -- which is the normal shape in these engines. It is a
// DIFFERENT risk from a query with no filter at all, and lumping them together buries the second in
// the first: the run that found this bug class reported 127 rows, of which the handful that matter
// were the ones filtering on NOTHING.
const FK_FILTER = /\.(eq|in)\(\s*["'`]\w+_id["'`]/;
// An insert whose payload is a variable -- the workspace_id may well be in it, off-screen.
const INSERT_VAR = /\.(insert|upsert)\(\s*[A-Za-z_$][\w$]*\s*[),]/;
const OP = /\.(select|insert|update|upsert|delete|rpc)\s*\(/;

type Finding = {
  file: string; line: number; table: string; op: string;
  verdict: "SCOPED" | "ID-ONLY" | "FK-ONLY" | "PAYLOAD" | "NO TENANT" | "UNSCOPED";
  snippet: string;
};

/**
 * ⚠ REASONS AND COUNTS, NEVER BARE NAMES.
 *
 * Keyed by "table@file". Every entry says WHY these queries are safe without a workspace filter, and
 * how MANY of them there are -- because a key that only names a file silences that file forever,
 * including the cross-tenant read somebody adds to it next year. The count is the tripwire: a seventh
 * unscoped `practice_otp_challenge` query in messaging.ts is reported even though six are excused.
 *
 * The count here is NOT a tally anybody is trying to move (the recorded trap). These are settled
 * exceptions; if one changes, that IS the thing worth a second look.
 */
const ALLOW: Record<string, { count: number; reason: string }> = {
  // ⚠ COUNTS ARE EXACT, NOT GENEROUS. The first draft of this list guessed 9 for two entries; the stale
  // check deleted one outright and the budget silently left room for eight future unscoped queries in
  // the other. An exception with slack in it is an exception that admits its own successors.
  "practice_membership@src/lib/practice/access.ts": { count: 1, reason:
    "the membership read IS the gate that produces workspaceId -- scoping it by workspace would be circular" },

  "practice_audit_event@src/lib/practice/auth-audit.ts": { count: 2, reason:
    "authTrail() takes workspaceId OPTIONALLY and applies .eq('workspace_id') when given; its only caller " +
    "(auth-audit.ts:291) passes it. VERIFIED 2026-08-12 -- a caller that omits it would be a real leak" },

  // ── SCHEMA-PRESENCE PROBES ──────────────────────────────────────────────────────────────────────
  // All of the same shape: `.select("id").limit(1)` destructuring ONLY `error` and discarding `data`,
  // to ask whether a migration has been applied. No row content reaches the caller, so there is
  // nothing for a tenant boundary to hold back.
  "practice_availability_template@src/lib/practice/availability-config.ts": { count: 1, reason:
    "SCHEMA PROBE: recurrenceStoreState() asks whether the COLUMN exists and reads only `error`" },
  "practice_booking_rule@src/lib/practice/booking-rules.ts": { count: 1, reason:
    "SCHEMA PROBE: bookingRuleExtensionPresent() probes for migration 268's columns, reads only `error`" },
  "«WAITING_LIST_TABLE»@src/lib/practice/booking-cancellation.ts": { count: 1, reason:
    "SCHEMA PROBE: waiting-list store presence, reads only `error`" },
  "«table»@src/lib/practice/checklist.ts": { count: 1, reason: "SCHEMA PROBE, reads only `error`" },
  "«table»@src/lib/practice/forms.ts": { count: 1, reason: "SCHEMA PROBE, reads only `error`" },
  "«table»@src/lib/practice/knowledge.ts": { count: 1, reason: "SCHEMA PROBE, reads only `error`" },
  "«table»@src/lib/practice/medication.ts": { count: 1, reason: "SCHEMA PROBE, reads only `error`" },
  "«s.table»@src/lib/practice/patient-access.ts": { count: 1, reason: "SCHEMA PROBE, reads only `error`" },

  // ── CHILD INSERTS WHOSE PARENT WAS JUST VERIFIED IN THIS WORKSPACE ─────────────────────────────
  // These tables have no workspace_id column; their tenant is their parent. Each parent read or
  // insert immediately above them carries .eq("workspace_id", ctx.workspaceId) and 404s when absent
  // -- checked by hand 2026-08-12, and the reason is here so the next reader need not re-derive it.
  "«INVESTIGATION_TABLES.alias»@src/lib/practice/investigations.ts": { count: 1, reason:
    "aliases for the catalogue row created two statements above with workspace_id: ctx.workspaceId" },
  "«INVESTIGATION_TABLES.setItem»@src/lib/practice/investigations.ts": { count: 1, reason:
    "items for a set whose id was either just inserted with workspace_id, or loaded by " +
    ".eq('id', setId).eq('workspace_id', ctx.workspaceId) with a 404 when it is not this practice's" },
  "«TREATMENT_TABLES.templateItem»@src/lib/practice/treatment-capture.ts": { count: 1, reason:
    "same shape as the investigation set items, over a template verified the same way" },
  "«TREATMENT_TABLES.treatment»@src/lib/practice/treatment-capture.ts": { count: 1, reason:
    "insert of prepared.map(p => p.row), and every row is built at line ~437 with " +
    "workspace_id: ctx.workspaceId -- the payload IS scoped, one construction step out of view" },

  "practice_otp_challenge@src/lib/practice/messaging.ts": { count: 3, reason:
    "DELIBERATELY GLOBAL, and must be: the limit is per DESTINATION (a phone number). Scoping it by " +
    "workspace would let a sender bypass it by switching practice, which is the harassment case the " +
    "limit exists to stop" },
  "practice_booking_request@src/lib/practice/booking-request-unverified.ts": { count: 1, reason:
    "same: rate limit per SOURCE hash across all practices, for the same bypass reason" },

  "practice_invitation@src/lib/practice/team.ts": { count: 1, reason:
    "acceptInvitation() is the ONE function that runs for somebody who is not yet a member of anything: " +
    "the code is a bearer credential and RESOLVES to the workspace, so it cannot be scoped by one. Every " +
    "bad code gets one identical refusal, so this cannot be used to enumerate practices" },

  "practice_booking_access@src/lib/practice/patient-booking.ts": { count: 1, reason:
    "the PUBLIC handle lookup -- an unauthenticated visitor's handle is what this RESOLVES TO a " +
    "workspace, so it cannot be workspace-scoped without being unable to do its job" },

  "practice_patient@src/lib/practice/patient-workspace.ts": { count: 3, reason:
    "myPatients() passes every one of these through applyFilters(), whose FIRST line is " +
    "q.eq('workspace_id', ws) -- the scope is applied by the helper, one call level out of view" },
};

function main() {
  const { withWs, seen } = tenantColumnByTable();
  const files = [
    ...walk(join(ROOT, "src/lib/practice")),
    ...walk(join(ROOT, "src/app/api/v1/practice")),
    ...walk(join(ROOT, "src/app/practice")),
  ];

  // Resolved across the WHOLE source tree, not just the walked directories: a constant is often
  // declared in a -constants.ts file that lives outside them.
  const constNames = practiceTableConstants([...files, ...walk(join(ROOT, "src/lib"))]);

  const findings: Finding[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    // Literal `.from("practice_x")` OR `.from(CONST)` / `.from(CONST.member)` where CONST is known to
    // name a practice table.
    const re = /\.from\(\s*(?:["'`](practice_\w+)["'`]|([A-Za-z_$][\w$]*)(\.[\w$]+)?)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const chain = chainAfter(src, m.index);
      let table: string;
      if (m[1]) {
        table = m[1].toLowerCase();
      } else if (m[2] && constNames.has(m[2])) {
        table = `«${m[2]}${m[3] ?? ""}»`;
      } else if (m[2] && OP.test(chain)) {
        // ⚠ A TABLE NAME THIS SCANNER CANNOT RESOLVE -- `.from(table)` where `table` is a function
        // PARAMETER. Included rather than skipped, and judged on its chain like any other: tightening
        // the constant resolver above (correctly, to stop Uint8Array.from(n) being reported) had the
        // side effect of dropping these entirely, which is a scanner quietly narrowing its own scope.
        // The OP test is what separates a Supabase chain from every other .from() in the language.
        table = `«${m[2]}${m[3] ?? ""}»`;
      } else {
        continue;   // not a database call at all
      }
      const line = src.slice(0, m.index).split("\n").length;
      const op = (OP.exec(chain)?.[1] ?? "?").toLowerCase();

      let verdict: Finding["verdict"];
      if (WS_FILTER.test(chain)) verdict = "SCOPED";
      else if (seen.has(table) && !withWs.has(table)) verdict = "NO TENANT";
      else if (ID_FILTER.test(chain)) verdict = "ID-ONLY";
      else if (FK_FILTER.test(chain)) verdict = "FK-ONLY";
      else if (INSERT_VAR.test(chain)) verdict = "PAYLOAD";
      else verdict = "UNSCOPED";

      findings.push({
        file: rel, line, table, op, verdict,
        snippet: chain.replace(/\s+/g, " ").slice(0, 150),
      });
    }
  }

  // ── 3. THE CONTROL. A scanner that found nothing would print a clean report. ──────────────────────
  console.log("\nPRACTICE TENANT-SCOPE AUDIT\n");
  if (findings.length < 50) {
    console.log(`  ⚠ CONTROL FAILED — only ${findings.length} practice_* queries found. This codebase has`);
    console.log("    hundreds. The walk or the pattern is broken, and a clean report below would be a lie.\n");
    process.exit(1);
  }
  const scoped = findings.filter(f => f.verdict === "SCOPED");
  if (scoped.length === 0) {
    console.log("  ⚠ CONTROL FAILED — not one query classified as SCOPED, so the detector is not working.\n");
    process.exit(1);
  }

  // ⚠ THE COUNT IS THE TRIPWIRE. Findings are excused up to the allowlisted count, in file order; the
  // surplus is reported. So a NEW unscoped query in an allowlisted file is open, and an exception that
  // has been REMOVED shows as a stale entry rather than silently protecting nothing.
  const budget = new Map<string, number>();
  const staleKeys = new Set(Object.keys(ALLOW));
  const excused: Finding[] = [];
  const allowed = (f: Finding) => {
    const key = `${f.table}@${f.file}`;
    const entry = ALLOW[key];
    if (!entry) return false;
    staleKeys.delete(key);
    const used = budget.get(key) ?? 0;
    if (used >= entry.count) return false;      // over budget -> reported as open
    budget.set(key, used + 1);
    excused.push(f);
    return true;
  };

  // Order matters for the budget, so the unscoped classes are consumed first and deterministically.
  const rank = { UNSCOPED: 0, PAYLOAD: 1, "ID-ONLY": 2, "FK-ONLY": 3, SCOPED: 4, "NO TENANT": 5 } as const;
  const considered = findings
    .filter(f => f.verdict !== "SCOPED" && f.verdict !== "NO TENANT")
    .sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.file.localeCompare(b.file) || a.line - b.line);
  const unexcused = considered.filter(f => !allowed(f));

  const open = unexcused.filter(f => f.verdict === "UNSCOPED");
  const idOnly = unexcused.filter(f => f.verdict === "ID-ONLY");
  const fkOnly = unexcused.filter(f => f.verdict === "FK-ONLY");
  const payload = unexcused.filter(f => f.verdict === "PAYLOAD");
  const noTenant = findings.filter(f => f.verdict === "NO TENANT");

  console.log(`  ${findings.length} practice_* queries across ${new Set(findings.map(f => f.file)).size} files`);
  console.log(`  ${scoped.length} workspace-scoped · ${idOnly.length} by primary key · ${fkOnly.length} by foreign key`);
  console.log(`  ${payload.length} insert/upsert with an off-screen payload · ${noTenant.length} on tables with no tenant column · ${excused.length} allowlisted\n`);

  if (open.length) {
    console.log(`── ${open.length} WITH NO FILTER OF ANY KIND — these read across every practice ────────\n`);
    for (const f of open) console.log(`  ${f.file}:${f.line}  ${f.table}.${f.op}\n      ${f.snippet}\n`);
  } else {
    console.log("── No practice_* query runs without a filter of some kind. ──────────────────────\n");
  }

  if (SHOW_ALL && idOnly.length) {
    console.log(`── ${idOnly.length} BY PRIMARY KEY — safe iff the id came from a workspace-scoped read ────\n`);
    for (const f of idOnly) console.log(`  ${f.file}:${f.line}  ${f.table}.${f.op}`);
    console.log("");
  }
  if (SHOW_ALL && fkOnly.length) {
    console.log(`── ${fkOnly.length} BY FOREIGN KEY — safe iff the parent was resolved in this workspace ───\n`);
    for (const f of fkOnly) console.log(`  ${f.file}:${f.line}  ${f.table}.${f.op}`);
    console.log("");
  }
  if (payload.length) {
    console.log(`── ${payload.length} INSERT/UPSERT whose payload the scanner cannot see ────────────────────\n`);
    for (const f of payload) console.log(`  ${f.file}:${f.line}  ${f.table}.${f.op}\n      ${f.snippet}\n`);
  }

  if (noTenant.length && SHOW_ALL) {
    console.log("── on tables with no workspace_id column ─────────────────────────────────────────\n");
    for (const f of noTenant) console.log(`  ${f.file}:${f.line}  ${f.table}.${f.op}`);
    console.log("");
  }

  if (SHOW_ALL) {
    console.log("── scoped ───────────────────────────────────────────────────────────────────────\n");
    for (const f of scoped) console.log(`  ${f.file}:${f.line}  ${f.table}.${f.op}`);
    console.log("");
  }

  if (excused.length) {
    console.log("── allowlisted, with the reason each is safe ────────────────────────────────────\n");
    const byKey = new Map<string, Finding[]>();
    for (const f of excused) {
      const k = `${f.table}@${f.file}`;
      byKey.set(k, [...(byKey.get(k) ?? []), f]);
    }
    for (const [k, fs] of byKey) {
      console.log(`  ${k}  (${fs.length}: ${fs.map(f => f.line).join(", ")})\n      ${ALLOW[k].reason}\n`);
    }
  }

  // A stale exception protects nothing and reads as though it does.
  if (staleKeys.size) {
    console.log("── ⚠ STALE ALLOWLIST ENTRIES — nothing matched these, so delete them ────────────\n");
    for (const k of staleKeys) console.log(`  ${k}`);
    console.log("");
  }

  const fail = open.length > 0 || staleKeys.size > 0;
  console.log(fail
    ? `FAILED  ${open.length} unscoped practice_* quer${open.length === 1 ? "y" : "ies"}` +
      `${staleKeys.size ? `, ${staleKeys.size} stale allowlist entr${staleKeys.size === 1 ? "y" : "ies"}` : ""}\n`
    : `PASSED  every practice_* query is workspace-scoped, key-scoped, on a table with no tenant\n` +
      `        column, or allowlisted with a reason. ${idOnly.length + fkOnly.length} key-scoped reads reported under --all.\n`);
  process.exit(fail ? 1 : 0);
}

main();
