import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { recomputeAll } from "@/lib/engines/scoring";
import { notify } from "@/lib/notify";
import { METHOD_LABELS } from "@/lib/ckcm";

// Conduct Assessment cockpit submit: records one assessment session in a single
// call — per-competency scores + notes (assessments), checklist responses,
// consensus recompute, audit trail, learner notification, and linked scheduled
// session completion. Formal competency decisions remain the educator/admin
// decision-run; this endpoint records the assessor's raw judgements.

// assessments.method has a DB check constraint on the legacy 7 methods.
const DB_METHODS = new Set([
  "knowledge", "direct_observation", "simulation", "osce",
  "concurrent_audit", "retrospective_audit", "logbook",
]);

// Advisory overall recommendation (assessment_sessions check constraint).
const RECOMMENDATIONS: Record<string, string> = {
  competent:                  "Competent",
  competent_with_supervision: "Competent with Supervision",
  needs_development:          "Needs Development",
  reassessment_required:      "Reassessment Required",
  critical_failure:           "Critical Failure",
};

// Signature pads post small PNG data URLs; decode + store in the private
// evidence bucket. Returns the storage path or null.
async function storeSignature(
  admin: ReturnType<typeof createAdminClient>, dataUrl: unknown, who: string,
): Promise<string | null> {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > 400_000) return null; // ~300KB decoded cap
  const path = `signatures/${crypto.randomUUID()}-${who}.png`;
  const { error } = await admin.storage.from("evidence")
    .upload(path, Buffer.from(m[1], "base64"), { contentType: "image/png" });
  return error ? null : path;
}

type ScoreInput = {
  competency_id?: string;
  score?: number;
  notes?: string;
  checklist?: { item_id?: string; response?: string }[];
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessor roles can conduct assessments" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { cycle_id, nurse_id, session_id, method, location, attest, strengths, improvements, workflow,
          recommendation, duration_seconds, witness_name, signatures } = body;
  const scores: ScoreInput[] = Array.isArray(body.scores) ? body.scores : [];

  if (recommendation != null && !RECOMMENDATIONS[recommendation]) {
    return NextResponse.json({ error: `recommendation must be one of: ${Object.keys(RECOMMENDATIONS).join(", ")}` }, { status: 400 });
  }

  if (!cycle_id || !nurse_id || !scores.length) {
    return NextResponse.json({ error: "cycle_id, nurse_id and scores[] are required" }, { status: 400 });
  }
  if (!DB_METHODS.has(method)) {
    return NextResponse.json({ error: `method must be one of: ${[...DB_METHODS].join(", ")}` }, { status: 400 });
  }
  if (attest !== true) {
    return NextResponse.json({ error: "Assessor attestation is required before submitting" }, { status: 400 });
  }
  if (nurse_id === user.id) {
    return NextResponse.json({ error: "You cannot assess yourself" }, { status: 400 });
  }

  const valid = scores.filter(s =>
    typeof s.competency_id === "string" && s.competency_id &&
    typeof s.score === "number" && Number.isInteger(s.score) && s.score >= 0 && s.score <= 6
  );
  if (!valid.length) {
    return NextResponse.json({ error: "No valid scores (each needs competency_id and an integer score 0–6)" }, { status: 400 });
  }

  const [{ data: cycle }, { data: nurse }] = await Promise.all([
    admin.from("competency_cycles").select("id, nurse_id").eq("id", cycle_id).single(),
    admin.from("profiles").select("id, full_name, hospital_id").eq("id", nurse_id).single(),
  ]);
  if (!cycle || cycle.nurse_id !== nurse_id) {
    return NextResponse.json({ error: "Cycle not found for this clinician" }, { status: 404 });
  }
  if (!nurse) return NextResponse.json({ error: "Clinician not found" }, { status: 404 });
  if (me?.hospital_id && nurse.hospital_id !== me.hospital_id && !roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only assess clinicians in your hospital" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const actions: string[] = [];
  let checklistSaved = 0;

  for (const s of valid) {
    const { data: row, error } = await admin.from("assessments").insert({
      cycle_id,
      competency_id: s.competency_id,
      assessor_id: user.id,
      method,
      score: s.score,
      notes: (s.notes ?? "").trim() || null,
      status: "complete",
      assessed_at: now,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = (Array.isArray(s.checklist) ? s.checklist : []).filter(c =>
      typeof c.item_id === "string" && c.item_id && ["yes", "no", "na"].includes(c.response ?? "")
    );
    if (items.length) {
      const { error: ce } = await admin.from("checklist_responses").insert(
        items.map(c => ({ assessment_id: row.id, checklist_item_id: c.item_id, response: c.response }))
      );
      if (!ce) checklistSaved += items.length;
    }
    await recomputeAll(admin, cycle_id, s.competency_id as string);
  }

  actions.push(`Recorded ${valid.length} competency score${valid.length === 1 ? "" : "s"}`);
  if (checklistSaved) actions.push(`Saved ${checklistSaved} checklist response${checklistSaved === 1 ? "" : "s"}`);
  actions.push("Recomputed consensus scores and domain/framework rollups");

  // Session record (migration 032): recommendation + e-signatures. Fail-soft
  // if the table isn't there yet — scores/notifications above still stand.
  const [sigAssessor, sigLearner, sigWitness] = await Promise.all([
    storeSignature(admin, signatures?.assessor, "assessor"),
    storeSignature(admin, signatures?.learner, "learner"),
    storeSignature(admin, signatures?.witness, "witness"),
  ]);
  const { error: sessErr } = await admin.from("assessment_sessions").insert({
    cycle_id, nurse_id, assessor_id: user.id,
    hospital_id: nurse.hospital_id ?? null,
    scheduled_assessment_id: session_id ?? null,
    method, location: (location ?? "").trim() || null,
    duration_seconds: Number.isFinite(duration_seconds) ? Math.max(0, Math.round(duration_seconds)) : null,
    scored_count: valid.length,
    recommendation: recommendation ?? null,
    strengths: (strengths ?? "").trim() || null,
    improvements: (improvements ?? "").trim() || null,
    assessor_signature_path: sigAssessor,
    learner_signature_path: sigLearner,
    witness_name: (witness_name ?? "").trim() || null,
    witness_signature_path: sigWitness,
  });
  if (!sessErr) {
    actions.push("Session record saved");
    const sigCount = [sigAssessor, sigLearner, sigWitness].filter(Boolean).length;
    if (sigCount) actions.push(`Captured ${sigCount} e-signature${sigCount === 1 ? "" : "s"}`);
    if (recommendation) actions.push(`Overall recommendation recorded: ${RECOMMENDATIONS[recommendation]}`);
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "conduct_assessment", entity_type: "cycle", entity_id: cycle_id, entity_name: nurse.full_name,
    new_value: {
      scored: valid.length, method, location: (location ?? "").trim() || null,
      checklist_responses: checklistSaved, session_id: session_id ?? null,
      workflow: Array.isArray(workflow) ? workflow : null,
      recommendation: recommendation ?? null,
      strengths: (strengths ?? "").trim() || null,
      improvements: (improvements ?? "").trim() || null,
    },
  });
  actions.push("Audit trail written");

  const feedbackBits = [
    (strengths ?? "").trim() ? `Strengths: ${(strengths as string).trim()}` : null,
    (improvements ?? "").trim() ? `To develop: ${(improvements as string).trim()}` : null,
  ].filter(Boolean).join(" · ");
  await notify([nurse_id], {
    type: "assessment_submitted",
    title: "Assessment session completed",
    body: `${me?.full_name ?? "An assessor"} recorded ${valid.length} competency score${valid.length === 1 ? "" : "s"} (${METHOD_LABELS[method as keyof typeof METHOD_LABELS] ?? method}).${recommendation ? ` Assessor recommendation: ${RECOMMENDATIONS[recommendation]}.` : ""}${feedbackBits ? ` ${feedbackBits}` : ""}`,
    href: "/dashboard/feedback",
  });
  actions.push("Learner notified");

  if (session_id) {
    const { data: sess } = await admin.from("scheduled_assessments")
      .select("id, assessor_id, nurse_id, status").eq("id", session_id).single();
    if (sess && sess.assessor_id === user.id && sess.nurse_id === nurse_id && sess.status === "scheduled") {
      await admin.from("scheduled_assessments").update({ status: "completed" }).eq("id", session_id);
      actions.push("Scheduled session marked complete");
    }
  }

  return NextResponse.json({ ok: true, scored: valid.length, actions });
}
