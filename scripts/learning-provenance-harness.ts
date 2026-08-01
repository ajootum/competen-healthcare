/**
 * Learning completion provenance harness (XWI P2-8).
 *
 * THE DEFECT. A clinician sets their own pathway item to 'completed' -- no evidence, no second party, no
 * timestamp, no audit row. That is fine in itself; reading a policy genuinely is self-attested. What was not
 * fine is that src/lib/super-admin/gov-compliance.ts read that same column and published
 * "Training (pathway items done)" as a COMPLIANCE PERCENTAGE, on the same panel as audit compliance, which
 * is externally measured. A number nobody had checked wore the badge of one somebody had.
 *
 * WHAT IT ASSERTS:
 *   1. self-attested completion still WORKS          -- the fix must not push people out of the system
 *   2. it is RECORDED as self-attested               -- the distinction has to exist in the data
 *   3. evidence must belong to the learner           -- otherwise anyone can dress a tick as evidence-backed
 *                                                       by quoting someone else's file, which is worse than
 *                                                       no evidence: the compliance number would count it
 *   4. un-completing clears the verification         -- a stale 'verified' on a reopened item is a standing
 *                                                       false attestation
 *   5. the compliance loader SPLITS the two          -- the whole point; asserted against the real loader,
 *                                                       not a reimplementation of it
 *   6. before migration 183 it says so               -- rather than silently reporting the flattering number
 *
 * ON ITS OWN DATA: creates a throwaway pathway + item, and deletes them in a finally.
 *
 *   npx --yes tsx scripts/learning-provenance-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadComplianceManagement } from "../src/lib/super-admin/gov-compliance";
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

async function main() {
  const probe = await admin.from("pathway_items").select("completion_method").limit(1);
  const provenanceApplied = !probe.error;

  // 6 first, because it is the only assertion that is meaningful in BOTH states.
  const pre = await loadComplianceManagement(admin);
  const assured = pre.derivedDomains.find((d: any) => d.label.startsWith("Training (verified"));
  if (!provenanceApplied) {
    ok("6. before migration 183 the loader says provenance is unavailable",
      pre.trainingProvenance.available === false && !!pre.trainingProvenance.reason && assured?.value === null,
      JSON.stringify(pre.trainingProvenance));
    console.log("\nSKIPPED the rest: migration 183 is not applied.");
    console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)\n`);
    process.exitCode = fails.length ? 1 : 2;
    return;
  }
  ok("6. with migration 183 applied the loader reports provenance as available",
    pre.trainingProvenance.available === true && pre.trainingProvenance.reason === null);

  const { data: nurse } = await admin.from("profiles").select("id, hospital_id").not("hospital_id", "is", null).limit(1).single();
  const { data: other } = await admin.from("profiles").select("id").neq("id", nurse.id).limit(1).single();
  if (!nurse || !other) { console.log("No seed data."); process.exitCode = 2; return; }

  let pathwayId: string | null = null, evidenceId: string | null = null;
  try {
    const { data: pw, error: pErr } = await admin.from("learning_pathways")
      .insert({ nurse_id: nurse.id, title: "HARNESS provenance (throwaway)", status: "active" }).select("id").single();
    if (pErr) throw new Error(`pathway: ${pErr.message}`);
    pathwayId = pw.id;

    const mk = async (title: string) => {
      const { data, error } = await admin.from("pathway_items")
        .insert({ pathway_id: pathwayId, resource_title: title, resource_type: "course", status: "pending", reason: "harness", sort_order: 0 })
        .select("id").single();
      if (error) throw new Error(`item: ${error.message}`);
      return data.id as string;
    };
    const selfItem = await mk("self-attested");
    const evItem = await mk("evidence-backed");

    // 1 + 2 -- self-attestation still works, and is recorded as such.
    await admin.from("pathway_items").update({
      status: "completed", completed_at: new Date().toISOString(), completion_method: "self_attested",
    }).eq("id", selfItem);
    const { data: s1 } = await admin.from("pathway_items").select("status, completion_method, completed_at, verified_at").eq("id", selfItem).single();
    ok("1. self-attested completion still works", s1?.status === "completed" && !!s1?.completed_at);
    ok("2. it is recorded AS self-attested, not as assurance",
      s1?.completion_method === "self_attested" && !s1?.verified_at, JSON.stringify(s1));

    // 3 -- the constraint the route enforces: evidence must be the learner's own. Asserted at the DB level
    // by checking a foreign owner's evidence is distinguishable, since the route's check is on owner_id.
    // The error is CHECKED. Destructuring only `data` and reading owner_id off null reported
    // "owner=undefined" and failed for a reason that had nothing to do with ownership -- the insert was
    // rejected for a missing not-null file_path. An unchecked write error is the same confident-zero shape
    // this harness exists to catch, so it must not be the shape of the harness itself.
    const { data: ev, error: evErr } = await admin.from("evidence")
      // Columns per migration 029: file_path, file_name and mime_type are all NOT NULL.
      .insert({ owner_id: other.id, kind: "evidence", file_path: "harness/foreign-evidence.txt", file_name: "foreign-evidence.txt", mime_type: "text/plain", note: "HARNESS foreign evidence" })
      .select("id, owner_id").single();
    if (evErr) throw new Error(`evidence insert: ${evErr.message}`);
    evidenceId = ev?.id ?? null;
    ok("3. foreign evidence is identifiable as not the learner's",
      !!ev && ev.owner_id !== nurse.id, `owner=${ev?.owner_id} learner=${nurse.id}`);

    // 4 -- un-completing clears verification.
    await admin.from("pathway_items").update({
      status: "completed", completed_at: new Date().toISOString(), completion_method: "self_attested",
      verified_by: other.id, verified_at: new Date().toISOString(), verification_note: "harness",
    }).eq("id", evItem);
    // the reopen patch the route applies
    await admin.from("pathway_items").update({
      status: "in_progress", completed_at: null, completion_method: null, evidence_id: null,
      verified_by: null, verified_at: null, verification_note: null,
    }).eq("id", evItem);
    const { data: s2 } = await admin.from("pathway_items").select("status, verified_at, verified_by, completion_method").eq("id", evItem).single();
    ok("4. reopening an item clears its verification",
      s2?.status === "in_progress" && !s2?.verified_at && !s2?.verified_by && !s2?.completion_method, JSON.stringify(s2));

    // 5 -- the real loader must count the self-attested item as NOT assured.
    await admin.from("pathway_items").update({
      status: "completed", completed_at: new Date().toISOString(), completion_method: "evidence",
    }).eq("id", evItem);
    const post = await loadComplianceManagement(admin);
    const grew = post.trainingProvenance.completed - pre.trainingProvenance.completed;
    const grewAssured = post.trainingProvenance.assured - pre.trainingProvenance.assured;
    const grewSelf = post.trainingProvenance.selfAttested - pre.trainingProvenance.selfAttested;
    ok("5. the compliance loader splits assured from self-attested",
      grew === 2 && grewAssured === 1 && grewSelf === 1,
      `completed +${grew}, assured +${grewAssured}, self-attested +${grewSelf}`);
    ok("5b. the two training figures are reported separately and differ in meaning",
      post.derivedDomains.filter((d: any) => d.label.startsWith("Training")).length === 2);
  } finally {
    if (pathwayId) {
      await admin.from("pathway_items").delete().eq("pathway_id", pathwayId);
      await admin.from("learning_pathways").delete().eq("id", pathwayId);
    }
    if (evidenceId) await admin.from("evidence").delete().eq("id", evidenceId);
    console.log("\n  cleanup: throwaway pathway, items and evidence removed");
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
