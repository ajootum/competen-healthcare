import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify, hospitalVerifierIds } from "@/lib/notify";

// Appeals against assessment outcomes. POST: the assessed learner raises an
// appeal with a reason. PATCH: staff move it through
// open → under_review → upheld / overturned (or withdrawn), with a resolution
// note. Both sides are notified; everything is audit-logged. Note: an upheld/
// overturned appeal is a governance record — score changes still happen
// through reassessment, not by editing history.

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { assessment_id, reason } = await req.json().catch(() => ({}));
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!assessment_id || !why) return NextResponse.json({ error: "assessment_id and reason are required" }, { status: 400 });

  const { data: a } = await admin.from("assessments")
    .select("id, score, competency_cycles!cycle_id(nurse_id, hospital_id), framework_competencies!competency_id(name)")
    .eq("id", assessment_id).single();
  if (!a) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  const cycle = a.competency_cycles as unknown as { nurse_id: string; hospital_id: string | null } | null;
  if (cycle?.nurse_id !== user.id) {
    return NextResponse.json({ error: "You can only appeal your own assessment outcomes" }, { status: 403 });
  }
  const { data: existing } = await admin.from("appeals")
    .select("id").eq("assessment_id", assessment_id).in("status", ["open", "under_review"]).limit(1);
  if (existing?.length) return NextResponse.json({ error: "An appeal for this assessment is already in progress" }, { status: 409 });

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
  const compName = (a.framework_competencies as unknown as { name: string } | null)?.name ?? null;
  const { data: row, error } = await admin.from("appeals").insert({
    hospital_id: cycle?.hospital_id ?? null,
    assessment_id, nurse_id: user.id,
    competency_name: compName, score: a.score ?? null,
    reason: why.slice(0, 2000),
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "raise_appeal", entity_type: "appeal", entity_id: row.id, entity_name: compName ?? "assessment",
  });
  const verifiers = await hospitalVerifierIds(cycle?.hospital_id ?? null, user.id);
  await notify(verifiers, {
    type: "appeal_submitted",
    title: "Assessment outcome appealed",
    body: `${me?.full_name ?? "A learner"} appealed their ${compName ?? "assessment"} outcome${a.score != null ? ` (scored ${a.score}/6)` : ""}: ${why.slice(0, 140)}`,
    href: "/assessor/reports/quality",
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

const TRANSITIONS: Record<string, string[]> = {
  open: ["under_review", "upheld", "overturned", "withdrawn"],
  under_review: ["upheld", "overturned", "withdrawn"],
};

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessor roles can review appeals" }, { status: 403 });
  }

  const { id, status, resolution_note } = await req.json().catch(() => ({}));
  if (!id || !status) return NextResponse.json({ error: "id and status are required" }, { status: 400 });
  const { data: row } = await admin.from("appeals")
    .select("id, nurse_id, status, hospital_id, competency_name").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Appeal not found" }, { status: 404 });
  if (me?.hospital_id && row.hospital_id !== me.hospital_id && !roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only review appeals in your hospital" }, { status: 403 });
  }
  if (row.nurse_id === user.id) return NextResponse.json({ error: "You cannot review your own appeal" }, { status: 400 });
  if (!(TRANSITIONS[row.status] ?? []).includes(status)) {
    return NextResponse.json({ error: `Cannot move a ${row.status} appeal to ${status}` }, { status: 400 });
  }

  const terminal = ["upheld", "overturned", "withdrawn"].includes(status);
  const { error } = await admin.from("appeals").update({
    status,
    reviewer_id: user.id, reviewer_name: me?.full_name ?? null,
    resolution_note: (resolution_note ?? "").trim() || null,
    resolved_at: terminal ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "review_appeal", entity_type: "appeal", entity_id: id, entity_name: row.competency_name ?? "assessment",
    new_value: { from: row.status, to: status },
  });
  if (terminal) {
    const LABEL: Record<string, string> = { upheld: "upheld (original outcome stands)", overturned: "overturned — a reassessment will be arranged", withdrawn: "closed as withdrawn" };
    await notify([row.nurse_id], {
      type: "appeal_resolved",
      title: "Your appeal has been decided",
      body: `${me?.full_name ?? "A reviewer"} reviewed your ${row.competency_name ?? "assessment"} appeal: ${LABEL[status]}.${(resolution_note ?? "").trim() ? ` Note: ${(resolution_note as string).trim().slice(0, 200)}` : ""}`,
      href: "/dashboard/feedback",
    });
  }
  return NextResponse.json({ ok: true, status });
}
