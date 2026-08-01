/**
 * QIE-000 harness — does the hub tell the truth about its own engines?
 *
 * The hub's whole value is that it does NOT claim thirteen live engines over four real tables. It reports
 * each module as live / empty / gap, measured against the live database at request time. That claim is
 * only worth anything if the measurement is right, and it fails in a specific, quiet way: several of
 * these stores have no hospital_id, so a tenant-scoped count ERRORS, and a loader that treats an error as
 * "absent" would report a populated table as a gap. That is the fail-soft read this codebase has been
 * removing all session -- including three times from my own probes today.
 *
 * ASSERTIONS:
 *   1. Every module resolves to a state, and no module claims to be live with a zero count.
 *   2. A table WITHOUT hospital_id is still counted, not reported as a gap (the retry path works).
 *   3. A table that genuinely does not exist reports "gap" -- so the retry does not paper over absence.
 *   4. The states match what the database actually holds, checked independently of the loader.
 *
 *   npx --yes tsx scripts/qie-hub-harness.ts
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadQieModules, qieSummary, resolveState } from "../src/lib/qie/engines";
import { loadRootCause } from "../src/lib/qie/root-cause";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

async function main() {
  console.log("\nQIE-000 hub — is the composition honest?\n");

  const mods = await loadQieModules(admin, null, true);
  const s = qieSummary(mods);
  ok("every module in the catalogue resolves", mods.length === 12 && mods.every(m => !!m.state));
  ok("no module claims to be live with nothing behind it", mods.every(m => m.state !== "live" || m.count > 0));
  ok("no module claims empty while holding rows", mods.every(m => m.state !== "empty" || m.count === 0));
  ok("a gap reports no count", mods.every(m => m.state !== "gap" || m.count === 0));

  console.log();
  for (const m of mods) console.log(`        ${m.id}  ${m.state.padEnd(5)} ${String(m.count).padStart(5)}  ${m.name}`);
  console.log(`\n        ${s.live} live, ${s.empty} empty, ${s.gap} gap, of ${s.total}\n`);

  // 2. The retry path: knowledge_objects has NO hospital_id, so a scoped count errors. QIE-007 must still
  //    resolve from real rows rather than being called a gap.
  const { error: scopedErr } = await admin.from("knowledge_objects").select("*", { count: "exact", head: true }).eq("hospital_id", "00000000-0000-0000-0000-000000000000");
  const learning = mods.find(m => m.id === "QIE-007")!;
  ok("a store with no hospital_id still counts (the retry path)",
    !!scopedErr && learning.state !== "gap",
    scopedErr ? `QIE-007 came back "${learning.state}" despite competency_learning_links holding rows` : "knowledge_objects unexpectedly accepts a hospital_id filter — this check no longer proves anything");

  // 3. ...but absence must still read as absence. Tested against a table that certainly does not exist,
  //    rather than against one I BELIEVED did not: the first version asserted rca_investigations was
  //    absent, the database said otherwise, and the catalogue was wrong as a result. A check whose
  //    premise is an assumption tests the assumption.


  // The trap this check exists for: PostgREST answers head+count on a MISSING table with 204, no error
  // and a null count -- indistinguishable from an empty one. The first loader used head counts alone, so
  // its gap branch could never fire and an absent store would have been reported as merely unused.
  const headOnMissing = await admin.from("qie_definitely_not_a_table").select("*", { count: "exact", head: true });
  ok("head+count on a missing table does NOT error (the trap)", !headOnMissing.error && headOnMissing.count === null);
  const selectOnMissing = await admin.from("qie_definitely_not_a_table").select("id").limit(1);
  ok("a plain select on a missing table DOES error (the fix)", !!selectOnMissing.error);

  // And the loader itself must land on `gap` for a table that is not there.
  const phantom = await resolveState(admin, ["qie_definitely_not_a_table"], null, true);
  ok("resolveState reports GAP for an absent store", phantom.state === "gap" && phantom.count === 0,
    `got "${phantom.state}" -- an absent store reading as "empty" is the whole bug`);
  // EMPTY must be distinguishable from GAP, tested on a store that really does exist and is unused.
  const realEmpty = await resolveState(admin, ["workspace_config_overrides"], null, true);
  ok("resolveState reports EMPTY for a store that exists and is unused", realEmpty.state === "empty",
    `got "${realEmpty.state}"`);

  // QIE-005 WAS the one genuine gap and is now built (migration 180). The assertion that found it was
  // itself wrong first, on a check that used head+count -- the same blind spot as the loader it was
  // checking -- and it confidently told me an absent table existed. A check that shares the flaw of the
  // thing it checks confirms the bug rather than finding it.
  const rootCause = mods.find(m => m.id === "QIE-005")!;
  const rcaProbe = await admin.from("rca_investigations").select("id").limit(1);
  ok("QIE-005 is deployed and no longer a gap", !rcaProbe.error && rootCause.state !== "gap",
    rcaProbe.error ? "rca_investigations is absent — migration 180 not applied" : `module says "${rootCause.state}"`);
  ok("the built module links to its own surface", rootCause.href === "/super-admin/quality-intelligence/root-cause");

  // ── The engine's own read model ────────────────────────────────────────────
  const rc = await loadRootCause(admin, null, true);
  ok("the root-cause loader is ready", rc.ready, rc.reason);
  ok("it counts real incidents", rc.stats.incidents > 0);
  ok("every unanalysed incident is one with no investigation",
    rc.unanalysed.length === rc.stats.incidents - rc.stats.investigated);
  ok("all eight Ishikawa categories are represented in the breakdown", rc.stats.factorsByCategory.length === 8);
  // The rate must be NULL, never 0, when there is nothing to divide by.
  ok("the analysis rate is a real fraction, not a fabricated zero",
    rc.stats.incidents === 0 ? rc.stats.analysisRate === null : typeof rc.stats.analysisRate === "number");

  console.log(`\n        ${rc.stats.incidents} incident(s), ${rc.stats.investigated} investigated (${rc.stats.analysisRate}%), ${rc.unanalysed.length} awaiting analysis\n`);

  // 4. Independent verification: count two stores directly and compare with what the loader said.
  for (const [id, table] of [["QIE-002", "pa_kpi_values"], ["QIE-008", "pa_benchmarks"]] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true });
    const m = mods.find(x => x.id === id)!;
    ok(`${id} count matches ${table} directly (${m.count} vs ${count})`, m.count === (count ?? 0));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main();
