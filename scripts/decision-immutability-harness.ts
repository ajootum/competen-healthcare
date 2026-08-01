/**
 * Decision immutability harness (XWI P2-10).
 *
 * THE BUG THIS GUARDS. generateDecisionsForCycle used to DELETE every decision for a cycle and re-insert.
 * Re-running a cycle therefore erased the record that a clinician had ever been found not_yet_competent,
 * suspended, or in critical failure -- in a competency platform, the artefact a regulator actually asks
 * for. The give-away was measurable before a line was written: all 77 live decisions sat at version_num 1,
 * because the row that would have been version 1 was deleted first. The versioning machinery was reducing
 * over a set that could not contain history.
 *
 * WHAT IT ASSERTS, and why each one can fail:
 *   1. re-running does not destroy      -- every prior decision is findable in history afterwards
 *   2. versions actually increment      -- the replacement is version n+1, not another 1
 *   3. the live table does not grow     -- history is additive WITHOUT double-counting the current view,
 *                                          which is the whole reason it is a separate table
 *   4. the archive is fail-CLOSED       -- with the history write sabotaged, the engine must throw AND
 *                                          leave the existing decisions intact. This is the assertion that
 *                                          matters: a fail-soft archive would silently restore the exact
 *                                          bug being fixed, and every other check here would still pass.
 *
 * ON ITS OWN DATA. It creates a throwaway cycle and scores, works only on those, and deletes everything in
 * a finally -- including on failure. It never touches the real cycles.
 *
 *   npx --yes tsx scripts/decision-immutability-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { generateDecisionsForCycle } from "../src/lib/engines/decisions";
loadEnvConfig(process.cwd());

const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

// An admin client whose ONLY difference is that writes to the history table fail. Used to prove the engine
// refuses to delete when it cannot archive.
function sabotageHistory(real: any) {
  return new Proxy(real, {
    get(t, prop, recv) {
      if (prop === "from") {
        return (table: string) => table === "competency_decision_history"
          ? { insert: async () => ({ error: { message: "sabotaged", code: "XXXXX" } }),
              upsert: async () => ({ error: { message: "sabotaged", code: "XXXXX" } }) }
          : t.from(table);
      }
      return Reflect.get(t, prop, recv);
    },
  });
}

async function main() {
  const probe = await admin.from("competency_decision_history").select("id").limit(1);
  if (probe.error) {
    console.log(`\nSKIPPED: competency_decision_history is absent (${probe.error.code}).`);
    console.log("Apply supabase/migrations/182-decision-history.sql, then re-run.\n");
    process.exitCode = 2; return;
  }

  // A real nurse, hospital and two real competencies -- the engine joins them, so invented uuids would
  // fail on the foreign keys rather than testing anything.
  const { data: nurse } = await admin.from("profiles").select("id, hospital_id").not("hospital_id", "is", null).limit(1).single();
  const { data: comps } = await admin.from("framework_competencies").select("id, domain_id").limit(2);
  if (!nurse || !comps || comps.length < 2) { console.log("No seed data to test against."); process.exitCode = 2; return; }
  const { data: dom } = await admin.from("framework_domains").select("id, framework_id").eq("id", comps[0].domain_id).maybeSingle();

  let cycleId: string | null = null;
  try {
    const { data: cycle, error: cErr } = await admin.from("competency_cycles").insert({
      nurse_id: nurse.id, hospital_id: nurse.hospital_id, cycle_type: "annual",
      status: "active", start_date: "2026-01-01", end_date: "2026-12-31",
      notes: "HARNESS decision-immutability (throwaway)",
    }).select("id").single();
    if (cErr) throw new Error(`cycle insert: ${cErr.message}`);
    cycleId = cycle.id;

    const { error: sErr } = await admin.from("competency_scores").insert(comps.map((c: any, i: number) => ({
      cycle_id: cycleId, competency_id: c.id, domain_id: c.domain_id,
      framework_id: dom?.framework_id ?? null, nurse_id: nurse.id,
      score: i === 0 ? 5 : 2, is_passing: i === 0, educator_validated: true,
    })));
    if (sErr) throw new Error(`scores insert: ${sErr.message}`);

    // ---- run 1 -------------------------------------------------------------------------------------
    const r1 = await generateDecisionsForCycle(admin, cycleId!, nurse.id, "Harness");
    const { data: v1 } = await admin.from("competency_decisions").select("id, competency_id, outcome, version_num").eq("cycle_id", cycleId);
    ok("run 1 writes decisions", (v1?.length ?? 0) === r1.created && r1.created > 0, `created=${r1.created} rows=${v1?.length}`);
    ok("run 1 decisions are version 1", (v1 ?? []).every((d: any) => d.version_num === 1),
      JSON.stringify((v1 ?? []).map((d: any) => d.version_num)));
    const firstIds = new Set((v1 ?? []).map((d: any) => d.id));
    const firstOutcomes = new Map((v1 ?? []).map((d: any) => [d.competency_id, d.outcome]));

    // ---- run 2: the re-run that used to destroy the record ------------------------------------------
    await generateDecisionsForCycle(admin, cycleId!, nurse.id, "Harness");
    const { data: v2 } = await admin.from("competency_decisions").select("id, competency_id, version_num").eq("cycle_id", cycleId);
    const { data: hist } = await admin.from("competency_decision_history").select("decision_id, competency_id, outcome, version_num, superseded_at, decided_at").eq("cycle_id", cycleId);

    ok("1. re-run does not destroy the prior decisions",
      (hist ?? []).length === firstIds.size && (hist ?? []).every((h: any) => firstIds.has(h.decision_id)),
      `archived=${hist?.length} expected=${firstIds.size}`);
    ok("1b. archived rows keep their original outcome",
      (hist ?? []).every((h: any) => firstOutcomes.get(h.competency_id) === h.outcome));
    ok("1c. archived rows record when they were decided AND superseded",
      (hist ?? []).every((h: any) => !!h.decided_at && !!h.superseded_at));
    ok("2. the replacement is version 2, not another version 1",
      (v2 ?? []).length > 0 && (v2 ?? []).every((d: any) => d.version_num === 2),
      JSON.stringify((v2 ?? []).map((d: any) => d.version_num)));
    ok("3. the live table did not grow -- history does not double-count",
      (v2 ?? []).length === (v1 ?? []).length, `before=${v1?.length} after=${v2?.length}`);
    ok("3b. every live row is a NEW row (the old ones moved to history)",
      (v2 ?? []).every((d: any) => !firstIds.has(d.id)));

    // ---- 4. fail-closed: cannot archive => must not delete ------------------------------------------
    const before = new Set(((await admin.from("competency_decisions").select("id").eq("cycle_id", cycleId)).data ?? []).map((d: any) => d.id));
    let threw = false;
    try { await generateDecisionsForCycle(sabotageHistory(admin), cycleId!, nurse.id, "Harness"); }
    catch { threw = true; }
    const after = new Set(((await admin.from("competency_decisions").select("id").eq("cycle_id", cycleId)).data ?? []).map((d: any) => d.id));
    ok("4. a failed archive throws instead of proceeding", threw);
    ok("4b. a failed archive leaves the existing decisions intact",
      before.size === after.size && [...before].every(id => after.has(id)),
      `before=${before.size} after=${after.size}`);
  } finally {
    if (cycleId) {
      await admin.from("competency_decision_history").delete().eq("cycle_id", cycleId);
      await admin.from("competency_decisions").delete().eq("cycle_id", cycleId);
      await admin.from("competency_scores").delete().eq("cycle_id", cycleId);
      await admin.from("competency_cycles").delete().eq("id", cycleId);
      const left = await admin.from("competency_decisions").select("id", { count: "exact", head: true }).eq("cycle_id", cycleId);
      console.log(`\n  cleanup: throwaway cycle removed (${left.count ?? 0} decision rows left behind)`);
    }
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
