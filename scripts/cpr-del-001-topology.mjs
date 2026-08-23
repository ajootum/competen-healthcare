// CPR-DEL-001 §3 -- the FK topology under practice_workspace.
//
// The inventory answered "which triggers refuse a delete". This answers the other half: WHAT DOES A
// DELETE OF practice_workspace ACTUALLY REACH, and where does it stop?
//
// ⚠ A CASCADE IS A WALK, NOT A LIST. A migration that fixes two triggers and then aborts on a RESTRICT
// edge three tables down is worse than none, because it looks finished. So this follows the graph:
//
//   CASCADE      the delete propagates -- recurse into that table's own children
//   SET NULL     the row survives with a nulled column -- deletion stops, nothing blocks
//   SET DEFAULT  same
//   RESTRICT     ABORTS the whole transaction, immediately
//   NO ACTION    ABORTS at constraint-check time (deferred, same outcome here)
//
// A trigger that refuses DELETE aborts a CASCADE edge just as hard as a RESTRICT, so the two are
// reported together -- a blocker is a blocker whichever layer it lives in.
//
//   node scripts/cpr-del-001-topology.mjs
import pg from "pg";
import { readFileSync } from "node:fs";

const env = { ...process.env };
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const c = new pg.Client({ connectionString: env.STAGING_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin read only");

const DEL = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

// Every FK in public, as edges parent <- child.
const edges = (await c.query(`
  select con.conname as name, ch.relname as child, pa.relname as parent, con.confdeltype as del
  from pg_constraint con
  join pg_class ch on ch.oid = con.conrelid
  join pg_class pa on pa.oid = con.confrelid
  join pg_namespace n on n.oid = ch.relnamespace
  where con.contype = 'f' and n.nspname = 'public'`)).rows
  .map(r => ({ ...r, action: DEL[r.del] ?? r.del }));

// Tables whose triggers fire on DELETE, and whether they allow a cascade.
const delTriggers = new Map();
for (const r of (await c.query(`
  select c2.relname as tbl, p.proname as fn, pg_get_functiondef(p.oid) as body
  from pg_trigger t
  join pg_class c2 on c2.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n on n.oid = c2.relnamespace
  where not t.tgisinternal and n.nspname='public' and (t.tgtype::int & 8) <> 0`)).rows) {
  const allows = /pg_trigger_depth|not exists\s*\(\s*select/i.test(r.body);
  const unconditional = /begin\s*raise exception/i.test(r.body);
  delTriggers.set(r.tbl, { fn: r.fn, allows, verdict: allows ? "allows cascade" : unconditional ? "refuses unconditionally" : "refuses conditionally" });
}

const childrenOf = (t) => edges.filter(e => e.parent === t);

const reached = new Set();          // tables a cascade would delete rows in
const blockers = [];                // edges or triggers that abort
const candidates = [];              // RESTRICT / NO ACTION edges, judged after the walk
const stopped = [];                 // edges where deletion legitimately stops (SET NULL etc.)
const seen = new Set();
const benign = [];                  // NO ACTION edges whose child the cascade also removes

function walk(table, path) {
  if (seen.has(table)) return;      // a table is only walked once; FK graphs here contain diamonds
  seen.add(table);
  for (const e of childrenOf(table)) {
    const where = [...path, `${table} -> ${e.child}`].join("  ");
    if (e.action === "CASCADE") {
      const trg = delTriggers.get(e.child);
      if (trg && !trg.allows) {
        blockers.push({ kind: "TRIGGER", table: e.child, detail: `${trg.fn} ${trg.verdict}`, via: `${table}.${e.name}`, path: where });
      }
      reached.add(e.child);
      walk(e.child, [...path, `${table} ->`]);
    } else if (e.action === "RESTRICT" || e.action === "NO ACTION") {
      // Recorded now, JUDGED after the walk -- see the reachability pass below. Whether one of these
      // actually aborts depends on something not known until the whole graph is walked.
      candidates.push({ kind: "FK", table: e.child, action: e.action, name: e.name, via: table, path: where });
    } else {
      stopped.push({ table: e.child, action: e.action, name: e.name });
    }
  }
}

walk("practice_workspace", []);

// ⚠ NOT EVERY RESTRICT/NO ACTION EDGE ABORTS, and treating them alike would overstate this by a factor
// of ten. Postgres checks NO ACTION at the END of the statement: if the referencing row is ALSO removed
// by the same cascade, nothing is left pointing anywhere and the constraint passes. RESTRICT does not
// wait -- it refuses the parent delete while any referencing row exists at that instant, even one the
// cascade is about to remove.
//
// So a NO ACTION edge only blocks when its CHILD is unreachable from the cascade. That is the difference
// between "35 blockers" and the real number, and it is only knowable after the reachable set is complete.
for (const cand of candidates) {
  const childSurvives = !reached.has(cand.table);
  const blocks = cand.action === "RESTRICT" || childSurvives;
  if (blocks) {
    blockers.push({
      kind: "FK", table: cand.table, via: cand.via, path: cand.path,
      detail: cand.action === "RESTRICT"
        ? `RESTRICT on ${cand.name} -- refuses while any referencing row exists`
        : `NO ACTION on ${cand.name} -- and this table is NOT reached by the cascade, so rows survive pointing at a deleted parent`,
    });
  } else {
    benign.push(cand);
  }
}

console.log(`\nCPR-DEL-001 §3 -- FK TOPOLOGY UNDER practice_workspace  (staging, read only)\n`);
console.log(`A delete of one practice_workspace row would CASCADE into ${reached.size} table(s).\n`);

// Deduped: a table reachable by two CASCADE paths is reported once. practice_invoice_item is reached
// both directly from the workspace and via practice_invoice, and listing it twice would suggest two
// separate problems to fix.
const uniq = (arr) => [...new Map(arr.map(b => [`${b.kind}|${b.table}|${b.detail}`, b])).values()];
const fkBlocks = uniq(blockers.filter(b => b.kind === "FK"));
const trgBlocks = uniq(blockers.filter(b => b.kind === "TRIGGER"));

console.log(`BLOCKERS -- ${blockers.length} edge(s) abort the delete\n`);
console.log(`  ${fkBlocks.length} foreign key(s):`);
for (const b of fkBlocks) console.log(`     ${b.table.padEnd(34)} ${b.detail}   (child of ${b.via})`);
console.log(`\n  ${trgBlocks.length} trigger(s) on a CASCADE edge:`);
for (const b of trgBlocks) console.log(`     ${b.table.padEnd(34)} ${b.detail}`);

console.log(`\nNON-BLOCKING STOPS -- ${stopped.length} edge(s) survive with a nulled reference`);
for (const s of stopped.slice(0, 12)) console.log(`     ${s.table.padEnd(34)} ${s.action}`);
if (stopped.length > 12) console.log(`     ... and ${stopped.length - 12} more`);

console.log(`\nEvery blocker above must be resolved for a practice deletion to complete.`);
console.log(`This is topology, not authorisation -- §4 classification stays a governance decision.\n`);

await c.query("rollback");
await c.end();
