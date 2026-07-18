import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { recomputeAll } from "@/lib/engines/scoring";
import { notify } from "@/lib/notify";

// OSCE Management Centre — exam lifecycle. POST creates an exam with stations
// and registered candidates; PATCH moves it through
// draft → published → running → completed (or cancelled). Completing an exam
// runs the automatic workflow: every scored station with a linked competency
// writes a real `assessments` row (method 'osce') into the candidate's active
// cycle and recomputes consensus/rollups, candidates are notified, and the
// audit trail records it. Formal decisions/passport updates remain the
// educator/admin decision run.

type StationInput = { name?: string; competency_id?: string | null; assessor_id?: string | null; duration_minutes?: number; brief?: string; equipment?: string };

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) return null;
  return { admin, me: me!, roles, userId: user.id };
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Only assessor roles can manage OSCEs" }, { status: 403 });
  const { admin, me, userId } = auth;

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const stations: StationInput[] = Array.isArray(body.stations) ? body.stations : [];
  const candidateIds: string[] = [...new Set((Array.isArray(body.candidate_ids) ? body.candidate_ids : []).filter((x: unknown) => typeof x === "string"))] as string[];

  const { data: exam, error } = await admin.from("osce_exams").insert({
    hospital_id: me.hospital_id ?? null,
    title,
    programme: (body.programme ?? "").trim() || null,
    exam_date: body.exam_date || null,
    notes: (body.notes ?? "").trim() || null,
    created_by: userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let stationRows: { id: string; name: string; station_no: number }[] = [];
  const validStations = stations.filter(s => (s.name ?? "").trim());
  if (validStations.length) {
    const { data: srows, error: serr } = await admin.from("osce_stations").insert(
      validStations.map((s, i) => ({
        exam_id: exam.id,
        station_no: i + 1,
        name: s.name!.trim(),
        competency_id: s.competency_id || null,
        assessor_id: s.assessor_id || null,
        duration_minutes: Number.isFinite(s.duration_minutes) ? Math.min(120, Math.max(1, Math.round(s.duration_minutes!))) : 10,
        brief: (s.brief ?? "").trim() || null,
        equipment: (s.equipment ?? "").trim() || null,
      }))
    ).select("id, name, station_no");
    if (serr) return NextResponse.json({ error: serr.message }, { status: 500 });
    stationRows = srows ?? [];
  }

  if (candidateIds.length) {
    // Candidates must be clinicians in the same hospital (unless super_admin).
    const { data: nurses } = await admin.from("profiles").select("id, hospital_id").in("id", candidateIds);
    const valid = (nurses ?? []).filter(n => !me.hospital_id || n.hospital_id === me.hospital_id || auth.roles.includes("super_admin"));
    if (valid.length) {
      await admin.from("osce_candidates").insert(valid.map(n => ({ exam_id: exam.id, nurse_id: n.id })));
    }
  }

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: "create_osce", entity_type: "osce_exam", entity_id: exam.id, entity_name: title,
    new_value: { stations: stationRows.length, candidates: candidateIds.length, exam_date: body.exam_date ?? null },
  });

  return NextResponse.json({ ok: true, id: exam.id, stations: stationRows }, { status: 201 });
}

const TRANSITIONS: Record<string, string[]> = {
  draft:     ["published", "cancelled"],
  published: ["running", "cancelled"],
  running:   ["completed", "cancelled"],
};

export async function PATCH(req: Request) {
  const auth = await requireStaff();
  if (!auth) return NextResponse.json({ error: "Only assessor roles can manage OSCEs" }, { status: 403 });
  const { admin, me, userId } = auth;

  const { id, status } = await req.json().catch(() => ({}));
  if (!id || !status) return NextResponse.json({ error: "id and status are required" }, { status: 400 });

  const { data: exam } = await admin.from("osce_exams").select("id, title, status, hospital_id").eq("id", id).single();
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });
  if (me.hospital_id && exam.hospital_id !== me.hospital_id && !auth.roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only manage OSCEs in your hospital" }, { status: 403 });
  }
  if (!(TRANSITIONS[exam.status] ?? []).includes(status)) {
    return NextResponse.json({ error: `Cannot move a ${exam.status} exam to ${status}` }, { status: 400 });
  }

  const actions: string[] = [];

  if (status === "completed") {
    // Automatic workflow: results → assessment engine → notify → audit.
    const [{ data: stations }, { data: results }, { data: candidates }] = await Promise.all([
      admin.from("osce_stations").select("id, name, competency_id").eq("exam_id", id),
      admin.from("osce_results").select("station_id, nurse_id, assessor_id, score, notes").eq("exam_id", id),
      admin.from("osce_candidates").select("nurse_id").eq("exam_id", id),
    ]);
    const stationById = new Map((stations ?? []).map(s => [s.id, s]));
    const nurseIds = [...new Set((candidates ?? []).map(c => c.nurse_id))];
    const { data: cycles } = nurseIds.length
      ? await admin.from("competency_cycles").select("id, nurse_id").in("nurse_id", nurseIds).eq("status", "active")
      : { data: [] };
    const cycleByNurse = new Map((cycles ?? []).map(c => [c.nurse_id, c.id]));

    const now = new Date().toISOString();
    let engineWrites = 0;
    for (const r of results ?? []) {
      const st = stationById.get(r.station_id);
      const cycleId = cycleByNurse.get(r.nurse_id);
      if (!st?.competency_id || !cycleId) continue;
      const { error: aerr } = await admin.from("assessments").insert({
        cycle_id: cycleId,
        competency_id: st.competency_id,
        assessor_id: r.assessor_id ?? userId,
        method: "osce",
        score: r.score,
        notes: `OSCE: ${exam.title} — ${st.name}${r.notes ? ` · ${r.notes}` : ""}`,
        status: "complete",
        assessed_at: now,
      });
      if (!aerr) {
        engineWrites++;
        await recomputeAll(admin, cycleId, st.competency_id);
      }
    }
    actions.push(`Fed ${engineWrites} station result${engineWrites === 1 ? "" : "s"} into the assessment engine`);

    const scoredNurses = new Set((results ?? []).map(r => r.nurse_id));
    if (scoredNurses.size) {
      await admin.from("osce_candidates").update({ status: "completed" })
        .eq("exam_id", id).in("nurse_id", [...scoredNurses]);
    }
    await notify([...scoredNurses], {
      type: "osce_completed",
      title: "OSCE results recorded",
      body: `Your results for “${exam.title}” have been recorded${engineWrites ? " and fed into your competency record" : ""}. Formal outcomes follow educator validation.`,
      href: "/dashboard/feedback",
    });
    actions.push(`Notified ${scoredNurses.size} candidate${scoredNurses.size === 1 ? "" : "s"}`);
  }

  const { error: uerr } = await admin.from("osce_exams").update({ status }).eq("id", id);
  if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });
  actions.push(`Exam moved to ${status}`);

  await admin.from("audit_log").insert({
    actor_id: userId, actor_name: me.full_name ?? null,
    action: status === "completed" ? "complete_osce" : "update_osce",
    entity_type: "osce_exam", entity_id: id, entity_name: exam.title,
    new_value: { from: exam.status, to: status },
  });

  return NextResponse.json({ ok: true, status, actions });
}
