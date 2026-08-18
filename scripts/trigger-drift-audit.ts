/**
 * Trigger-drift audit — is every trigger the repo declares actually deployed, and enabled?
 *
 * COMP-ENG-002B §9 priority 4. Completes the set alongside rls-drift-audit (policies),
 * function-drift-audit (bodies) and schema-drift-audit (columns). Reads plat_trigger_registry()
 * (migration 332), which exists because pg_trigger is in pg_catalog and PostgREST does not expose it.
 *
 * ⚠ WHY TRIGGERS ARE A SECURITY MEASUREMENT HERE, NOT HOUSEKEEPING. This codebase enforces real
 * invariants with them — most notably the append-only audit pattern, where an UPDATE/DELETE is refused
 * unless `pg_trigger_depth() > 1` allows a cascade. A database missing one of those ACCEPTS writes the
 * declared system refuses, and every test of the invariant passes while proving nothing. That is the
 * exact false-assurance shape the staging fidelity gate exists to prevent.
 *
 * ⚠ AND A DISABLED TRIGGER IS THE DANGEROUS CASE, because it is present. `ALTER TABLE ... DISABLE
 * TRIGGER` leaves the object in place: an existence check sees it, the invariant is gone. tgenabled is
 * therefore compared, not just presence.
 *
 * WHAT IT COMPARES: existence, enabled state, and the function each trigger fires. NOT the function's
 * body — function-drift-audit.ts already does that, and duplicating it here would mean two tools
 * disagreeing about the same thing.
 *
 *   npx tsx scripts/trigger-drift-audit.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pagedRpc, capWarning } from "./_registry";

loadEnvConfig(process.cwd());

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const LOOSE = join(ROOT, "supabase");

type Deployed = {
  tbl: string; trigger_name: string; fn_name: string;
  timing: string; events: string; enabled: string;
};
type Declared = { name: string; table: string; fn: string | null; file: string };

/** `create trigger NAME timing events on TABLE ... execute function FN()` */
function declaredTriggers(dir: string, label: (f: string) => string): Declared[] {
  const out: Declared[] = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith(".sql")).sort()) {
    let src: string;
    try { src = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    for (const m of src.matchAll(
      /create\s+trigger\s+([\w"]+)[\s\S]{0,400}?\bon\s+("?[\w.]+"?)[\s\S]{0,300}?execute\s+(?:function|procedure)\s+([\w".]+)/gi)) {
      out.push({
        name: m[1].replace(/"/g, ""),
        table: m[2].replace(/"/g, "").replace(/^public\./, ""),
        fn: m[3].replace(/"/g, "").replace(/^public\./, "").replace(/\(.*$/, ""),
        file: label(f),
      });
    }
  }
  return out;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const live = await pagedRpc<Deployed>(admin, "plat_trigger_registry", ["tbl", "trigger_name"]);
  if (live.error) {
    console.error(`\nplat_trigger_registry() unreadable: ${live.error}`);
    console.error("Migration 332 defines it. If this says the function is missing, it has not been applied.\n");
    process.exit(1);
  }
  if (live.suspicious) console.log(`\n⚠ ${capWarning(live.rows.length)}`);

  const declared = declaredTriggers(MIGRATIONS, f => `supabase/migrations/${f}`);
  // Ordered migrations settle intent. The loose scripts do not -- reported, never obeyed, exactly as
  // rls-drift-audit and function-drift-audit treat them.
  const looseDecl = declaredTriggers(LOOSE, f => `supabase/${f}`);

  // A later DROP TRIGGER retires an earlier declaration, unless it is the idempotent drop-then-create
  // pair this codebase writes.
  const byKey = new Map<string, Declared>();
  for (const d of declared) byKey.set(`${d.table}::${d.name}`, d);
  for (const f of readdirSync(MIGRATIONS).filter(x => x.endsWith(".sql")).sort()) {
    const src = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of src.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?([\w"]+)\s+on\s+("?[\w.]+"?)/gi)) {
      const name = m[1].replace(/"/g, "");
      const key = `${m[2].replace(/"/g, "").replace(/^public\./, "")}::${name}`;
      const created = byKey.get(key);
      // ⚠ A DROP RETIRES A TRIGGER ONLY IF NO CREATE FOLLOWS IT IN THE SAME FILE — anywhere after,
      // not adjacent. The first version of this rule demanded `drop ...; create trigger` back to back,
      // and migration 319 breaks that shape for a real reason: it drops trg_mos_support_event_immutable,
      // DELETEs the rows the immutability trigger would otherwise refuse, alters five columns, and
      // restores the trigger 52 lines later. The adjacency rule retired it, and the audit then reported
      // a deployed append-only trigger as UNDECLARED — a phantom finding about the exact invariant this
      // audit exists to protect.
      const recreatedAfter = new RegExp(`create\\s+trigger\\s+"?${name}"?\\b`, "i")
        .test(src.slice(m.index! + m[0].length));
      if (created && created.file <= `supabase/migrations/${f}` && !recreatedAfter) {
        byKey.delete(key);
      }
    }
  }

  const liveByKey = new Map(live.rows.map(r => [`${r.tbl}::${r.trigger_name}`, r]));
  const missing: Declared[] = [], disabled: Deployed[] = [], wrongFn: string[] = [];
  const undeclared: Deployed[] = [];

  for (const [key, d] of byKey) {
    const l = liveByKey.get(key);
    if (!l) { missing.push(d); continue; }
    if (l.enabled !== "enabled" && l.enabled !== "always") disabled.push(l);
    if (d.fn && l.fn_name && d.fn !== l.fn_name) {
      wrongFn.push(`${key}  repo fires ${d.fn}(), database fires ${l.fn_name}()`);
    }
  }
  for (const [key, l] of liveByKey) {
    if (!byKey.has(key) && !looseDecl.some(x => `${x.table}::${x.name}` === key)) undeclared.push(l);
  }
  const alsoDisabled = live.rows.filter(r => r.enabled !== "enabled" && r.enabled !== "always");

  console.log("\nTrigger drift audit\n");
  console.log(`  repo: ${byKey.size} trigger(s) declared and not retired  (${declared.length} create statements, ${looseDecl.length} in loose scripts)`);
  console.log(`  live: ${live.rows.length} trigger(s) in public\n`);

  let failed = 0;
  const section = (title: string, lines: string[], bad: boolean) => {
    if (!lines.length) return;
    if (bad) failed++;
    console.log(`  ${title} (${lines.length})`);
    lines.slice(0, 30).forEach(l => console.log(`    ${l}`));
    if (lines.length > 30) console.log(`    ... and ${lines.length - 30} more`);
    console.log("");
  };

  section("⚠ DISABLED — present but not firing; the invariant is gone",
    alsoDisabled.map(t => `${t.tbl} :: ${t.trigger_name} (${t.enabled})`), true);
  section("MISSING — declared in a numbered migration, absent from the database",
    missing.map(d => `${d.table} :: ${d.name} -> ${d.fn}()  (${d.file})`), true);
  section("WRONG FUNCTION — deployed trigger fires a different function than declared",
    wrongFn, true);
  section("UNDECLARED — in the database, declared in no numbered migration",
    undeclared.map(t => `${t.tbl} :: ${t.trigger_name} -> ${t.fn_name}()  [${t.timing} ${t.events}]`), false);

  if (!failed) console.log("  no disabled, missing or mis-wired triggers\n");
  console.log(`${failed === 0 ? "ALL GREEN" : "RED"}  ${failed} problem class(es)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
