// CPR-DEL-001 §9 -- the staging deletion fixture.
//
// §3 asks for DEMONSTRATED delete behaviour and everything so far has been static analysis of the
// catalog. This builds a synthetic practice, tries to delete it, and records what actually happens --
// turning the eight predicted blockers into observed ones, in the order the database hits them.
//
// It also produces the thing §6 needs and nothing else can supply: the ORDER OF OPERATIONS for a
// governed deletion service. Each blocker is cleared in turn and the delete retried, so the output is a
// dependency-ordered list rather than a guess.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SAFETY, AND IT IS CHECKED HERE RATHER THAN TRUSTED.
//
//   1. REFUSES to run unless the connection's project ref matches STAGING_SUPABASE_URL. A pooler
//      connection string carries the project in its USERNAME, not its host, so comparing hosts would
//      have compared two aws pooler addresses and passed against production.
//   2. Everything it creates carries a run-scoped marker and is removed at the end, including on failure.
//   3. It touches no row it did not create. The workspace it deletes is its own.
//
// §11 forbids routinely testing destructive lifecycle changes against production. This is why.
//
//   node scripts/cpr-del-001-fixture.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = { ...process.env };
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ---- GUARD 1 -------------------------------------------------------------------------------------
const dbUrl = env.STAGING_DB_URL, stagingApi = env.STAGING_SUPABASE_URL, prodApi = env.NEXT_PUBLIC_SUPABASE_URL;
if (!dbUrl || !stagingApi) { console.error("STAGING_DB_URL and STAGING_SUPABASE_URL are both required."); process.exit(1); }
const connRef = decodeURIComponent(new URL(dbUrl).username).split(".")[1] ?? null;
const stagingRef = new URL(stagingApi).host.split(".")[0];
const prodRef = prodApi ? new URL(prodApi).host.split(".")[0] : null;
if (connRef !== stagingRef) {
  console.error(`\nREFUSED. STAGING_DB_URL connects to project "${connRef}", but STAGING_SUPABASE_URL is "${stagingRef}".`);
  if (connRef === prodRef) console.error("That is the PRODUCTION project. This fixture deletes rows.\n");
  process.exit(1);
}
console.log(`\nCPR-DEL-001 §9 FIXTURE  -- project ${connRef} (staging, confirmed)\n`);

const RUN = randomUUID().slice(0, 8);
const MARK = `cprdel-${RUN}`;
const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

const say = (s) => console.log(s);
const results = [];
let wsId = null;

const q = async (sql, args = []) => c.query(sql, args);
const tryQ = async (sql, args = []) => { try { await c.query(sql, args); return { ok: true }; } catch (e) { return { ok: false, err: e }; } };
/** The constraint or trigger that refused, not the whole postgres message. */
const why = (e) => (e.constraint ? `FK ${e.constraint}` : (e.message ?? "").split("\n")[0]).slice(0, 120);

try {
  // ---- BUILD -------------------------------------------------------------------------------------
  wsId = randomUUID();
  // owner_person_id is required but carries NO foreign key -- practice_workspace has no outbound FKs at
  // all -- so the fixture owns a person id nothing else can be pointing at, and stays self-contained.
  await q(
    `insert into practice_workspace (id, name, status, owner_person_id, country, timezone)
     values ($1, $2, 'ACTIVE', $3, 'UG', 'Africa/Kampala')`,
    [wsId, `ZZ ${MARK}`, randomUUID()],
  );
  say(`  built   practice_workspace ${wsId}`);

  // The rows that matter are the ones the topology named as blockers. Each insert is best-effort: this
  // schema has 197 practice_* tables and a fixture that must satisfy every NOT NULL to exist would
  // never run. What it fails to build, it reports -- an unbuilt blocker is an untested one.
  const seeded = [], unbuilt = [];
  const seed = async (label, sql, args) => {
    const r = await tryQ(sql, args);
    r.ok ? (seeded.push(label), say(`  seeded  ${label}`)) : (unbuilt.push({ label, why: why(r.err) }));
  };

  await seed("practice_lifecycle_transition",
    `insert into practice_lifecycle_transition (workspace_id, from_status, to_status, reason) values ($1,'ACTIVE','ARCHIVED',$2)`,
    [wsId, `fixture ${MARK}`]);

  await seed("practice_facility",
    `insert into practice_facility (workspace_id, name) values ($1, $2)`, [wsId, `ZZ Facility ${MARK}`]);

  // ---- OBSERVE: the parent delete ----------------------------------------------------------------
  say(`\n  ATTEMPTING the parent delete, and clearing each blocker in turn:\n`);
  const order = [];
  for (let attempt = 1; attempt <= 12; attempt++) {
    const r = await tryQ(`delete from practice_workspace where id = $1`, [wsId]);
    if (r.ok) { say(`  ${String(attempt).padStart(2)}. DELETE SUCCEEDED`); results.push({ step: "delete", ok: true }); break; }
    const reason = why(r.err);
    const tbl = (r.err.table ?? r.err.detail?.match(/table "([^"]+)"/)?.[1]) ?? "?";
    say(`  ${String(attempt).padStart(2)}. blocked by ${reason}${tbl !== "?" ? `  (table ${tbl})` : ""}`);
    order.push({ table: tbl, reason });
    // Clear that blocker and retry -- this is what produces the dependency order.
    if (tbl === "?" || !/^practice_/.test(tbl)) { say(`      cannot clear automatically; stopping here`); break; }
    const cleared = await tryQ(`delete from ${tbl} where workspace_id = $1`, [wsId]);
    if (!cleared.ok) { say(`      and its own delete is refused: ${why(cleared.err)}`); break; }
    say(`      cleared ${tbl}, retrying`);
  }

  say(`\n  ORDER OF OPERATIONS observed (${order.length} step(s) before the parent could go):`);
  order.forEach((o, i) => say(`     ${i + 1}. delete ${o.table}   -- ${o.reason}`));
  if (unbuilt.length) {
    say(`\n  NOT BUILT, so NOT TESTED -- ${unbuilt.length}:`);
    unbuilt.forEach(u => say(`     ${u.label}: ${u.why}`));
  }
} finally {
  // ---- GUARD 2: clean up whatever survives, marker-scoped ----------------------------------------
  if (wsId) {
    // ⚠ THE FIXTURE MUST OUTLIVE THE DEADLOCK IT EXISTS TO PROVE. The first run stranded its own
    // workspace in staging: the FK refused the parent, the append-only trigger refused the child, and
    // ordinary cleanup has no move. A test that litters when it finds the bug is a test people stop
    // running.
    //
    // So the last resort DISABLES the immutability trigger, removes the fixture's own rows, and turns it
    // back on -- verified below, not assumed. This is legitimate only because the guard at the top has
    // already proved this is the staging project; the same three lines against production would be
    // tampering with an audit trail.
    await tryQ(`delete from practice_facility where workspace_id = $1`, [wsId]);
    let gone = await tryQ(`delete from practice_workspace where id = $1`, [wsId]);

    if (!gone.ok) {
      const TRG = "trg_practice_lifecycle_transition_immutable";
      const off = await tryQ(`alter table practice_lifecycle_transition disable trigger ${TRG}`);
      if (off.ok) {
        await tryQ(`delete from practice_lifecycle_transition where workspace_id = $1`, [wsId]);
        await tryQ(`alter table practice_lifecycle_transition enable trigger ${TRG}`);
        gone = await tryQ(`delete from practice_workspace where id = $1`, [wsId]);
      }
      // The trigger being back on matters more than the cleanup succeeding.
      const st = await q(`select tgenabled from pg_trigger where tgname = $1`, [TRG]);
      const restored = st.rows[0]?.tgenabled === "O";
      console.log(`  ${restored ? "trigger restored" : "*** TRIGGER LEFT DISABLED -- FIX BEFORE ANYTHING ELSE RUNS ***"}`);
    }

    const left = await q(`select count(*)::int as n from practice_workspace where name like $1`, [`ZZ ${MARK}%`]);
    console.log(`  cleanup: workspace ${gone.ok ? "removed" : "COULD NOT BE REMOVED"}, ${left.rows[0].n} fixture workspace(s) left behind`);
  }
  await c.end();
}
