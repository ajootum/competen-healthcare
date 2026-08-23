/**
 * CPR-DEL-001 §10 — the permanent cascade-vs-immutability ratchet.
 *
 * THE CLASS OF BUG. An append-only trail refuses DELETE so it cannot be edited. A parent table declares
 * ON DELETE CASCADE so the trail goes when its owner goes. Both are right on their own, and together they
 * make the parent UNDELETABLE BY ANYBODY: the cascade reaches the trail, the trigger aborts it, and no
 * ordering helps because the child may never go first. Migration 351 fixed one instance. This fails
 * the moment a second one appears.
 *
 * WHAT IT ASSERTS, read from pg_catalog and never from the migration files -- the inventory behind 351
 * was wrong twice by grepping .sql, and this harness exists partly so that cannot happen a third time:
 *
 *   1. Every table reached by a cascade from practice_workspace whose DELETE trigger refuses
 *      unconditionally is a contradiction -- the declared cascade is impossible. FAIL.
 *   2. Every immutable trail must STILL refuse a direct DELETE. A ratchet that only checked (1) would
 *      pass if somebody "fixed" the contradiction by making the trail mutable, which is the one outcome
 *      CPR-DEL-001 §2 forbids. So (2) is asserted behaviourally, on a fixture row, not inferred from
 *      the function text.
 *   3. A RESTRICT or unreachable NO ACTION edge under practice_workspace must carry a documented
 *      exception (§10, last line), or it is a blocker nobody has owned.
 *
 * ⚠ (2) IS THE CONTROL FOR (1). Without it this harness could be satisfied by deleting every trigger.
 *
 * Reads the catalog, so it is privileged-live and runs against STAGING by default -- and refuses to run
 * at all unless the connection's project ref matches STAGING_SUPABASE_URL, because a pooler host is the
 * same address for every project and a host comparison would pass against production.
 *
 *   npx tsx scripts/cascade-immutability-ratchet-harness.ts
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env: Record<string, string | undefined> = { ...process.env };
try {
  for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local */ }

/**
 * §10: "Require an explicit documented exception when a table intentionally blocks parent deletion."
 * An entry here is a DECISION with an owner and a reason. Adding one to silence a red line is the
 * failure this list exists to make visible, so every entry prints on every run.
 */
const DOCUMENTED_EXCEPTIONS: { table: string; edge: string; reason: string }[] = [
  // None yet. After 351, nothing under practice_workspace intentionally blocks its deletion.
];

let pass = 0, fail = 0;
const ok = (name: string, detail = "") => { pass++; console.log(`  PASS  ${name}${detail ? "  -- " + detail : ""}`); };
const bad = (name: string, detail: string) => { fail++; console.log(`  FAIL  ${name}\n        ${detail}`); };

type Edge = { child: string; parent: string; del: string; name: string };
type Trg = { tbl: string; fn: string; body: string };

async function main(): Promise<number> {
  const dbUrl = env.STAGING_DB_URL, stagingApi = env.STAGING_SUPABASE_URL;
  if (!dbUrl || !stagingApi) { console.error("STAGING_DB_URL and STAGING_SUPABASE_URL are required."); return 1; }
  const connRef = decodeURIComponent(new URL(dbUrl).username).split(".")[1];
  const stagingRef = new URL(stagingApi).host.split(".")[0];
  if (connRef !== stagingRef) { console.error(`REFUSED: connection is project ${connRef}, staging is ${stagingRef}.`); return 1; }

  console.log(`\nCASCADE vs IMMUTABILITY RATCHET  (CPR-DEL-001 §10, project ${connRef})\n`);
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();

  try {
    // ── Reachability: every table a practice_workspace delete cascades into ──────────────────────
    const edges: Edge[] = (await c.query(`
      select ch.relname as child, pa.relname as parent, con.confdeltype as del, con.conname as name
      from pg_constraint con
      join pg_class ch on ch.oid = con.conrelid
      join pg_class pa on pa.oid = con.confrelid
      join pg_namespace n on n.oid = ch.relnamespace
      where con.contype = 'f' and n.nspname = 'public'`)).rows;
    const reached = new Set<string>();
    const queue = ["practice_workspace"];
    const restrictish: { child: string; parent: string; action: string; name: string }[] = [];
    while (queue.length) {
      const t = queue.shift()!;
      for (const e of edges.filter(x => x.parent === t)) {
        if (e.del === "c") { if (!reached.has(e.child)) { reached.add(e.child); queue.push(e.child); } }
        else if (e.del === "r" || e.del === "a") restrictish.push({ child: e.child, parent: t, action: e.del === "r" ? "RESTRICT" : "NO ACTION", name: e.name });
      }
    }
    ok("cascade reachability computed", `${reached.size} table(s) under practice_workspace`);

    // ── (1) No refusing DELETE trigger on a cascade-reached table ─────────────────────────────────
    const trg: Trg[] = (await c.query(`
      select c2.relname as tbl, p.proname as fn, pg_get_functiondef(p.oid) as body
      from pg_trigger t
      join pg_class c2 on c2.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = c2.relnamespace
      where not t.tgisinternal and n.nspname = 'public' and (t.tgtype::int & 8) <> 0`)).rows;
    const onReached = trg.filter(t => reached.has(t.tbl));
    const contradictions = onReached.filter(t =>
      /begin\s*raise exception/i.test(t.body) && !/pg_trigger_depth|not exists\s*\(\s*select/i.test(t.body));
    if (contradictions.length) {
      bad("no cascade-reached table has a DELETE trigger that refuses unconditionally",
        contradictions.map(t => `${t.tbl} (${t.fn}) -- a declared cascade this trigger makes impossible`).join("; "));
    } else {
      ok("no cascade-reached table has a DELETE trigger that refuses unconditionally", `${onReached.length} DELETE trigger(s) inspected`);
    }

    // ── (2) THE CONTROL: immutability still holds, behaviourally ──────────────────────────────────
    // practice_lifecycle_transition is the table 351 corrected. If (1) ever passes because its trigger
    // was simply removed, this is the line that goes red.
    const wsId = randomUUID();
    await c.query(
      `insert into practice_workspace (id, name, status, owner_person_id, country, timezone) values ($1,$2,'ACTIVE',$3,'UG','Africa/Kampala')`,
      [wsId, `ZZ ratchet ${wsId.slice(0, 8)}`, randomUUID()],
    );
    const tr = await c.query(
      `insert into practice_lifecycle_transition (workspace_id, from_status, to_status, reason) values ($1,'ACTIVE','ARCHIVED','ratchet') returning id`,
      [wsId],
    );
    const trId = tr.rows[0].id;
    let directRefused = false, updateRefused = false, cascaded = false;
    try { await c.query(`delete from practice_lifecycle_transition where id = $1`, [trId]); } catch { directRefused = true; }
    try { await c.query(`update practice_lifecycle_transition set reason = 'x' where id = $1`, [trId]); } catch { updateRefused = true; }
    if (directRefused) ok("CONTROL: a direct DELETE on the trail is still refused");
    else bad("CONTROL: direct DELETE refused", "IT WAS PERMITTED. The contradiction was resolved by making the trail mutable -- CPR-DEL-001 §2 forbids exactly this.");
    if (updateRefused) ok("CONTROL: a direct UPDATE on the trail is still refused");
    else bad("CONTROL: direct UPDATE refused", "IT WAS PERMITTED -- the trail is no longer append only.");

    try { await c.query(`delete from practice_workspace where id = $1`, [wsId]); cascaded = true; } catch { /* still blocked */ }
    if (cascaded) ok("and the authorized parent cascade still completes");
    else {
      bad("authorized parent cascade completes", "the workspace delete was refused -- 351 has regressed");
      // Do not strand the fixture: the only way through a re-closed door.
      await c.query(`alter table practice_lifecycle_transition disable trigger trg_practice_lifecycle_transition_immutable`);
      await c.query(`delete from practice_lifecycle_transition where workspace_id = $1`, [wsId]);
      await c.query(`alter table practice_lifecycle_transition enable trigger trg_practice_lifecycle_transition_immutable`);
      await c.query(`delete from practice_workspace where id = $1`, [wsId]);
    }

    // ── (3) Every real blocker is a documented exception ─────────────────────────────────────────
    // A RESTRICT between two cascade-reached tables is satisfied by cascade ordering (demonstrated in
    // the §9 fixture); a NO ACTION whose child is also reached passes at end of statement. Only an edge
    // with a SURVIVING side can block.
    const real = restrictish.filter(e => !reached.has(e.child));
    const undocumented = real.filter(e => !DOCUMENTED_EXCEPTIONS.some(x => x.table === e.child && x.edge === e.name));
    if (undocumented.length) {
      bad("every blocking edge under practice_workspace carries a documented exception",
        undocumented.map(e => `${e.child}.${e.name} (${e.action}, child of ${e.parent})`).join("; "));
    } else {
      ok("every blocking edge under practice_workspace carries a documented exception", `${real.length} blocker(s), ${DOCUMENTED_EXCEPTIONS.length} exception(s)`);
    }
    for (const x of DOCUMENTED_EXCEPTIONS) console.log(`        exception: ${x.table}.${x.edge} -- ${x.reason}`);
  } finally {
    await c.end();
  }

  console.log(`\n${fail === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
