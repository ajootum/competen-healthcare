// One-off harness for the CGR-028 activation gate. Calls the SHIPPED engines (@/lib/cgr/service-profiles +
// @/lib/cgr/activation) — the same code the route and page run. Creates a clearly-labelled TEST ICU profile,
// negative-tests the creation guard, proves drafts are never gated, activates, runs the gate, and then
// INDEPENDENTLY recomputes one department's evaluation straight from the decision rows so the engine's verdicts
// are cross-checked against a second implementation, not just believed.
//   npx --yes tsx scripts/cgr-gate-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

const LEVELS = ["novice", "advanced_beginner", "competent", "proficient", "expert", "mentor", "authority"];
const ord = (l: string | null | undefined) => { const i = LEVELS.indexOf(l ?? ""); return i < 0 ? 3 : i + 1; };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { createServiceProfile } = await import("../src/lib/cgr/service-profiles");
  const { loadActivationReadiness } = await import("../src/lib/cgr/activation");

  // ── Ground truth ──
  const [comps, depts, staff, decs] = await Promise.all([
    admin.from("framework_competencies").select("id, name"),
    admin.from("departments").select("id, name"),
    admin.from("profiles").select("id, department_id"),
    admin.from("competency_decisions").select("id", { count: "exact", head: true }),
  ]);
  const byDept = new Map<string, number>();
  for (const s of staff.data ?? []) if (s.department_id) byDept.set(s.department_id, (byDept.get(s.department_id) ?? 0) + 1);
  console.log("── Ground truth ──");
  console.log("competencies:", comps.data?.length, "| departments:", depts.data?.length, "| staff with department:", [...byDept.values()].reduce((a, b) => a + b, 0), "| decisions:", decs.count);

  // ── Requirement set chosen to exercise BOTH paths against the real cohort (decisions cover the oxygen +
  // gait competencies): criticals on competencies staff actually HOLD (expect met), one at proficient level
  // (exercises the maturity rule), one nobody holds (expect unmet, non-critical → CONDITIONAL not NOT_READY). ──
  const lib = comps.data ?? [];
  const pick = (re: RegExp) => lib.find((c: any) => re.test(c.name))?.id ?? null;
  const wanted = [
    { id: pick(/assess oxygen requirement/i), label: "assess oxygen requirement", min_staff: 2, min_level: null as string | null, is_critical: true },
    { id: pick(/administer oxygen via delivery/i), label: "administer oxygen", min_staff: 1, min_level: null, is_critical: true },
    { id: pick(/monitor.*oxygen/i), label: "monitor/escalate oxygen (proficient)", min_staff: 1, min_level: "proficient", is_critical: false },
    { id: pick(/comprehensive patient assessment/i), label: "patient assessment (unheld)", min_staff: 1, min_level: null, is_critical: false },
  ];
  const missing = wanted.filter((w) => !w.id);
  const fallback = lib.filter((c: any) => !wanted.some((w) => w.id === c.id)).slice(0, missing.length);
  missing.forEach((w, i) => { w.id = fallback[i]?.id ?? null; });
  const requirements = wanted.filter((w) => w.id).map((w) => ({ competency_id: w.id!, min_staff: w.min_staff, min_level: w.min_level ?? undefined, is_critical: w.is_critical }));
  console.log("\n── Requirement set ──");
  for (const w of wanted) console.log(`  ${w.is_critical ? "[CRITICAL]" : "[normal]  "} ≥${w.min_staff} @ ${w.min_level ?? "any"} — ${lib.find((c: any) => c.id === w.id)?.name ?? "(unresolved)"}`);

  // ── Idempotent re-run: remove ONLY prior harness-authored test profiles (cascade removes requirements) ──
  const { count: removed } = await admin.from("service_profiles").delete({ count: "exact" })
    .eq("created_by_name", "harness (test run)").eq("name", "ICU Service (test profile)");
  if (removed) console.log(`\n(removed ${removed} prior harness test profile${removed === 1 ? "" : "s"})`);

  // ── Negative tests: the creation guard must reject garbage ──
  console.log("\n── Creation guard negative tests ──");
  const g1 = await createServiceProfile(admin, { name: "x", requirements: [] });
  console.log(`${!g1.ok && g1.status === 400 ? "PASS" : "FAIL"}  empty requirements → ${g1.ok ? "accepted (!)" : g1.error}`);
  const g2 = await createServiceProfile(admin, { name: "x", requirements: [{ competency_id: "deadbeef-0000-0000-0000-000000000000" }] });
  console.log(`${!g2.ok && g2.status === 400 ? "PASS" : "FAIL"}  invented competency id → ${g2.ok ? "accepted (!)" : g2.error}`);
  const g3 = await createServiceProfile(admin, { name: "x", requirements: [{ competency_id: requirements[0].competency_id, min_level: "wizard" }] });
  console.log(`${!g3.ok && g3.status === 400 ? "PASS" : "FAIL"}  bad min_level → ${g3.ok ? "accepted (!)" : g3.error}`);

  // ── Create the TEST profile (draft) through the shipped engine ──
  const created = await createServiceProfile(admin, {
    name: "ICU Service (test profile)", code: "SVC-ICU-TEST",
    description: "Harness-created test profile exercising the activation gate. Not a governed clinical requirements set.",
    requirements, hospitalId: null, createdBy: null, createdByName: "harness (test run)",
  });
  if (!created.ok) { console.error("CREATE FAILED:", created.error); process.exit(1); }
  console.log(`\ncreated draft profile ${created.profile.id} (“${created.profile.name}”)`);

  // ── Drafts must never be gated ──
  let gate: any = await loadActivationReadiness(admin);
  const mineDraft = gate.ready ? gate.profiles.find((p: any) => p.id === created.profile.id) : null;
  console.log(`${mineDraft && mineDraft.evaluations.length === 0 ? "PASS" : "FAIL"}  draft profile is NOT evaluated (evaluations: ${mineDraft?.evaluations.length ?? "?"})`);

  // ── Activate (direct status update — the PATCH route adds only auth on top of this) and run the gate ──
  await admin.from("service_profiles").update({ status: "active" }).eq("id", created.profile.id);
  gate = await loadActivationReadiness(admin);
  const mine = gate.profiles.find((p: any) => p.id === created.profile.id);
  console.log(`\n── Gate results (${mine.evaluations.length} departments evaluated) ──`);
  for (const e of mine.evaluations) {
    console.log(`  ${e.verdict.toUpperCase().padEnd(12)} ${e.department}  staff=${e.staff} assessors=${e.assessors} met=${e.met}/${e.total}${e.unmet.length ? "  unmet: " + e.unmet.map((u: any) => `${u.name} ${u.have}/${u.need}${u.critical ? "!" : ""}`).join("; ") : ""}`);
  }

  // ── Independent cross-check: recompute the top-staff department straight from the rows ──
  const top = mine.evaluations[0] ? mine.evaluations.reduce((a: any, b: any) => (b.staff > a.staff ? b : a), mine.evaluations[0]) : null;
  if (top) {
    console.log(`\n── Independent recount for “${top.department}” ──`);
    const dept = (depts.data ?? []).find((d: any) => d.name === top.department);
    const deptStaff = (staff.data ?? []).filter((s: any) => s.department_id === dept?.id).map((s: any) => s.id);
    const { data: allDecs } = await admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, maturity, expiry_date, created_at")
      .in("nurse_id", deptStaff.length ? deptStaff : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });
    const latest = new Map<string, any>();
    for (const d of allDecs ?? []) { const k = `${d.nurse_id}|${d.competency_id}`; if (!latest.has(k)) latest.set(k, d); }
    const today = new Date().toISOString().slice(0, 10);
    let agree = 0, total = 0;
    for (const w of wanted.filter((x) => x.id)) {
      const have = deptStaff.filter((n) => {
        const d = latest.get(`${n}|${w.id}`);
        return d && ["competent", "competent_with_conditions"].includes(d.outcome) && !(d.expiry_date && d.expiry_date < today) && (!w.min_level || ord(d.maturity) >= ord(w.min_level));
      }).length;
      const engineRow = top.unmet.find((u: any) => u.name === lib.find((c: any) => c.id === w.id)?.name);
      const engineSaysMet = !engineRow;
      const recountMet = have >= w.min_staff;
      total++;
      const ok = engineSaysMet === recountMet && (engineSaysMet || engineRow.have === have);
      if (ok) agree++;
      console.log(`  ${ok ? "MATCH" : "MISMATCH"}  ${lib.find((c: any) => c.id === w.id)?.name}: recount have=${have}/${w.min_staff} → ${recountMet ? "met" : "unmet"}; engine → ${engineSaysMet ? "met" : `unmet ${engineRow?.have}/${engineRow?.need}`}`);
    }
    console.log(`${agree}/${total} requirements agree between engine and independent recount.`);
  } else {
    console.log("\n(no departments with staff — gate had nothing to evaluate; verdicts untested)");
  }

  // ── Phase 2: prove the MET → READY/CONDITIONAL path with a profile matching what staff actually hold
  // (the AMU cohort's decisions are gait + communication, per the cross-tab diagnosis). Created, evaluated,
  // then DELETED — only the ICU test profile is left behind. ──
  console.log("\n── Phase 2: mobility profile (exercises the MET path) ──");
  const wanted2 = [
    { id: pick(/technical performance of gait/i), min_staff: 2, min_level: null as string | null, is_critical: true },
    { id: pick(/gait and balance physiology/i), min_staff: 2, min_level: null, is_critical: true },
    { id: pick(/communication and patient/i), min_staff: 1, min_level: null, is_critical: false },
    { id: pick(/monitor.*oxygen/i), min_staff: 1, min_level: "proficient", is_critical: false },
  ].filter((w) => w.id);
  const created2 = await createServiceProfile(admin, {
    name: "Mobility Assessment Service (test profile)", code: "SVC-MOB-TEST",
    requirements: wanted2.map((w) => ({ competency_id: w.id!, min_staff: w.min_staff, min_level: w.min_level ?? undefined, is_critical: w.is_critical })),
    hospitalId: null, createdByName: "harness (test run)",
  });
  if (!created2.ok) { console.error("phase-2 create failed:", created2.error); process.exit(1); }
  await admin.from("service_profiles").update({ status: "active" }).eq("id", created2.profile.id);
  const gate2: any = await loadActivationReadiness(admin);
  const mob = gate2.profiles.find((p: any) => p.id === created2.profile.id);
  for (const e of mob.evaluations) {
    console.log(`  ${e.verdict.toUpperCase().padEnd(12)} ${e.department}  staff=${e.staff} met=${e.met}/${e.total}${e.unmet.length ? "  unmet: " + e.unmet.map((u: any) => `${u.name} ${u.have}/${u.need}${u.critical ? "!" : ""}`).join("; ") : ""}`);
  }
  const amu = mob.evaluations.find((e: any) => /AMU/i.test(e.department));
  const metPathProven = !!amu && amu.met > 0 && (amu.verdict === "ready" || amu.verdict === "conditional");
  console.log(`${metPathProven ? "PASS" : "FAIL"}  AMU meets requirements it actually holds → verdict ${amu?.verdict ?? "?"} with ${amu?.met ?? 0}/${amu?.total ?? "?"} met`);
  await admin.from("service_profiles").delete().eq("id", created2.profile.id);
  console.log("(phase-2 profile deleted)");

  console.log(`\nProfile left ACTIVE as “ICU Service (test profile)” so the page shows the live gate. Delete or retire it once reviewed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
