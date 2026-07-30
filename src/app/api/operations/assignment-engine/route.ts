import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { notify } from "@/lib/notify";
import { generateRecommendation, publishPairs } from "@/lib/hww/assignment-engine";

// Assignment & Workload Engine API (HWW-AE-001, migration 155). Supervisor
// tier — this is the charge nurse's decision tool (spec S4: charge nurse
// review → approve/override → publish).
//   GET  → latest recommendation runs for the tenant
//   POST {action:'generate'} → compute + persist an explainable run
//   POST {action:'publish', run_id, pairs:[{patient_id,staff_id,override_reason?}], notes?}
//        → write accepted pairs into op_patient_assignments (single-assignment
//          API semantics), notify the nurses, stamp the run's decision trail
//   POST {action:'discard', run_id, notes?}
// Every action audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 155 to enable the Assignment Engine record" }, { status: 409 }) : null;

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  let q = c.admin.from("op_assignment_recommendations").select("*").order("created_at", { ascending: false }).limit(10);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");
  const admin = c.admin as any;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();

  if (action === "generate") {
    const r = await generateRecommendation(admin, { hospitalId: c.hospitalId, isSuperUser: isSuper(c), actorId: c.userId, actorName: me?.full_name ?? null });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null, action: "assignment_recommendation_generated",
      entity_type: "op_assignment_recommendation", entity_id: r.runId, hospital_id: r.shift.hospital_id,
      new_value: { proposals: r.proposals.length, gaps: r.gaps.length, alerts: r.riskAlerts.length, shift_id: r.shift.id },
    }).then((x: any) => x, () => {});
    return NextResponse.json(r, { status: 201 });
  }

  if (action === "publish") {
    const pairs = Array.isArray(b.pairs) ? b.pairs.filter((p: any) => p?.patient_id && p?.staff_id) : [];
    if (!pairs.length) return badRequest("pairs required");

    // Tenant scope: every patient must be in the caller's hospital (supers exempt).
    if (!isSuper(c)) {
      const { data: pts } = await admin.from("op_patients").select("id, hospital_id").in("id", pairs.map((p: any) => p.patient_id));
      const bad = (pts ?? []).find((p: any) => p.hospital_id !== c.hospitalId);
      if (bad || (pts ?? []).length !== pairs.length) return forbidden("One or more patients are out of scope");
    }

    const results = await publishPairs(admin, pairs, { id: c.userId, name: me?.full_name ?? null });
    const okCount = results.filter(r => r.ok).length;

    // Notify each nurse of their new/kept allocation (deduped).
    const byNurse = new Map<string, number>();
    for (const r of results) if (r.ok) byNurse.set(r.staff_id, (byNurse.get(r.staff_id) ?? 0) + 1);
    for (const [staffId, count] of byNurse) {
      if (staffId !== c.userId) {
        await notify([staffId], {
          type: "op_assignment",
          title: `Patient allocation updated — ${count} patient${count === 1 ? "" : "s"}`,
          body: "Your assignment for this shift was published by the assignment engine. Open My Patients for the full picture.",
          href: "/healthcare-worker/patients",
        });
      }
    }

    // Stamp the run's decision trail when a run id was given.
    if (b.run_id) {
      const status = okCount === results.length ? "published" : okCount > 0 ? "partially_published" : "generated";
      await admin.from("op_assignment_recommendations").update({
        status, acted_by: c.userId, acted_at: new Date().toISOString(),
        action_notes: String(b.notes ?? "").trim() || null,
      }).eq("id", b.run_id).then((x: any) => x, () => {});
    }

    await admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null, action: "assignment_recommendation_published",
      entity_type: "op_assignment_recommendation", entity_id: b.run_id ?? null, hospital_id: c.hospitalId ?? null,
      new_value: { attempted: results.length, published: okCount, failed: results.length - okCount },
    }).then((x: any) => x, () => {});
    return NextResponse.json({ ok: true, results, published: okCount, failed: results.length - okCount });
  }

  if (action === "discard") {
    if (!b.run_id) return badRequest("run_id required");
    const { data: run } = await admin.from("op_assignment_recommendations").select("id, hospital_id, status").eq("id", b.run_id).maybeSingle();
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuper(c) && run.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    if (run.status !== "generated") return badRequest(`Run already ${run.status}`);
    const { error } = await admin.from("op_assignment_recommendations").update({
      status: "discarded", acted_by: c.userId, acted_at: new Date().toISOString(),
      action_notes: String(b.notes ?? "").trim() || null,
    }).eq("id", b.run_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({
      actor_id: c.userId, actor_name: me?.full_name ?? null, action: "assignment_recommendation_discarded",
      entity_type: "op_assignment_recommendation", entity_id: b.run_id, hospital_id: run.hospital_id,
    }).then((x: any) => x, () => {});
    return NextResponse.json({ ok: true });
  }

  return badRequest("unknown action");
}
