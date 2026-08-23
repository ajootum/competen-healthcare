// CPR-DEL-001 §3 -- the mandatory pre-migration inventory.
//
// ⚠ MEASURED FROM THE CATALOG, NOT FROM THE MIGRATION FILES. My first pass at this grepped the .sql and
// reported "twelve of twelve triggers refuse all deletes". That was wrong: practice_access_log already
// allows the cascade by a different spelling (it checks the parent row is gone rather than calling
// pg_trigger_depth), so grepping for one spelling of the rule and reporting the count AS the rule
// produced a number the spec would have been built on. §16 says re-measure; this is that.
//
// READ-ONLY. It opens a transaction, sets it read only, and never writes. §11 forbids routinely testing
// destructive lifecycle changes against production, so demonstration of DELETE behaviour is a separate
// staging exercise -- this establishes the static picture the classification needs.
//
//   node scripts/cpr-del-001-inventory.mjs            (staging, default)
//   node scripts/cpr-del-001-inventory.mjs --json     (machine-readable)
import pg from "pg";
import { readFileSync } from "node:fs";

const env = { ...process.env };
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = env.STAGING_DB_URL;
if (!url) { console.error("STAGING_DB_URL is not set."); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("begin read only");

// Every trigger on a practice_* table that fires BEFORE UPDATE or DELETE -- the shape that can abort a
// cascade. Not filtered on a name pattern: a trigger called something else blocks just as hard.
const trg = (await client.query(`
  select c.relname as tbl, t.tgname as trigger, p.proname as fn,
         pg_get_functiondef(p.oid) as body,
         (t.tgtype::int & 4) <> 0 as on_insert,
         (t.tgtype::int & 8) <> 0 as on_delete,
         (t.tgtype::int & 16) <> 0 as on_update
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public' and c.relname like 'practice\_%'
  order by c.relname`)).rows.filter(r => r.on_delete || r.on_update);

// Inbound FKs: who points AT this table, and what happens to them. Plus this table's own parent FKs.
const fks = (await client.query(`
  select con.conname as name,
         child.relname  as child_table,
         parent.relname as parent_table,
         con.confdeltype as del
  from pg_constraint con
  join pg_class child  on child.oid  = con.conrelid
  join pg_class parent on parent.oid = con.confrelid
  where con.contype = 'f' and child.relname like 'practice\_%'`)).rows;

const DEL = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
// ⚠ THIS REPORTS A SHAPE, NOT A VERDICT, and the distinction was forced by getting it wrong twice.
//
// The first version answered a binary -- allows cascade / refuses -- and so called
// practice_invoice_item_frozen_guard a refusal. That function RETURNS OLD on DELETE and raises only when
// the parent invoice has left DRAFT: it refuses CONDITIONALLY. A binary turned "blocks a cascade once an
// invoice has been issued" into "blocks every delete", which is a different table and a different
// governance decision. §4 forbids classifying by pattern alone, so every row is read by hand and this
// only narrows what has to be read.
const allowance = (body) => {
  if (/pg_trigger_depth/.test(body)) return "allows cascade (pg_trigger_depth)";
  if (/not exists\s*\(\s*select/i.test(body)) return "allows cascade (parent-gone check)";
  // A raise that is not the first statement of the body is guarded by something.
  const unconditional = /begin\s*raise exception/i.test(body);
  return unconditional ? "refuses unconditionally" : "refuses CONDITIONALLY -- read the condition";
};

const rows = trg.map(t => {
  const parents = fks.filter(f => f.child_table === t.tbl);
  const toWorkspace = parents.find(f => f.parent_table === "practice_workspace");
  return {
    table: t.tbl,
    trigger: t.trigger,
    fn: t.fn,
    fires: [t.on_delete && "DELETE", t.on_update && "UPDATE"].filter(Boolean).join("+"),
    parentFk: toWorkspace ? toWorkspace.name : (parents[0]?.name ?? null),
    parentTable: toWorkspace ? "practice_workspace" : (parents[0]?.parent_table ?? null),
    onDelete: toWorkspace ? DEL[toWorkspace.del] : (parents[0] ? DEL[parents[0].del] : null),
    allowsCascade: allowance(t.body),
  };
});

if (process.argv.includes("--json")) { console.log(JSON.stringify(rows, null, 2)); await client.end(); process.exit(0); }

console.log(`\nCPR-DEL-001 §3 INVENTORY  (staging catalog, read only)\n`);
console.log(`${rows.length} practice_* trigger(s) fire on DELETE or UPDATE\n`);
console.log("table                              fires   parent FK on delete   cascade allowance");
console.log("-".repeat(104));
for (const r of rows) {
  console.log(
    `${r.table.padEnd(34)} ${r.fires.padEnd(7)} ${String(r.onDelete ?? "-- no FK --").padEnd(21)} ${r.allowsCascade ?? "NONE -- aborts the cascade"}`
  );
}
// ⚠ ONLY TRIGGERS THAT FIRE ON DELETE CAN BLOCK A CASCADE. Nineteen of the twenty-two below guard UPDATE
// only -- they never see a delete, and counting them as blockers is what produced the "eleven of twelve"
// figure that went into CPR-DEL-001 before this ran.
const onDelete = rows.filter(r => r.fires.includes("DELETE"));
const blocked = onDelete.filter(r => r.allowsCascade.startsWith("refuses"));
console.log(`\n${rows.length - onDelete.length} of ${rows.length} guard UPDATE only and cannot block a delete.`);
console.log(`${onDelete.length} fire on DELETE; ${blocked.length} of those refuse rather than allow a cascade:`);
for (const r of blocked) {
  const reach = r.onDelete === "CASCADE" ? "a parent delete REACHES it and aborts"
    : r.onDelete ? `its FK is ${r.onDelete}, so the FK blocks first`
    : "it has no FK, so a cascade never reaches it -- its rows ORPHAN instead";
  console.log(`   ${r.table.padEnd(32)} ${reach}`);
}
console.log(`\nEvery line above is a SHAPE. §4 classification is a governance decision, not an output of this script.\n`);
await client.query("rollback");
await client.end();
