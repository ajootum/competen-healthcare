import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OsceCentre, { type ExamRow, type ExamDetail, type OsceKpis, type ActivityRow, type PickOption } from "./OsceCentre";

// OSCE Management Centre (assessor). Everything rendered is live: exams,
// stations, candidates and results come from the OSCE tables (migration 033);
// pass marks use the Benner scale; the Reliability Index is a real Cronbach's
// alpha computed from the score matrix when there is enough complete data.
// Completing an exam feeds results into the assessment engine (see
// /api/osce/exams). Blueprint/circuit designers and quality moderation have no
// backing store yet and appear as muted "soon" chips only.

type SearchParams = Promise<{ x?: string }>;

type StationRow = {
  id: string; station_no: number; name: string; competency_id: string | null; assessor_id: string | null;
  duration_minutes: number; brief: string | null; equipment: string | null;
  framework_competencies: { name: string } | null;
  profiles: { full_name: string } | null;
};
type CandidateRow = { nurse_id: string; status: string; profiles: { full_name: string } | null };
type ResultRow = { station_id: string; nurse_id: string; score: number };
type ExamRecord = {
  id: string; title: string; programme: string | null; exam_date: string | null; status: string; notes: string | null;
  osce_stations: StationRow[]; osce_candidates: CandidateRow[]; osce_results: ResultRow[];
};

// Real Cronbach's alpha over complete candidate rows (candidates × stations).
function cronbachAlpha(matrix: number[][]): number | null {
  const k = matrix[0]?.length ?? 0;
  if (k < 2 || matrix.length < 3) return null;
  const variance = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  };
  const itemVars = Array.from({ length: k }, (_, j) => variance(matrix.map(r => r[j])));
  const totalVar = variance(matrix.map(r => r.reduce((a, b) => a + b, 0)));
  if (totalVar === 0) return null;
  return (k / (k - 1)) * (1 - itemVars.reduce((a, b) => a + b, 0) / totalVar);
}

export default async function OscePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id, full_name").eq("id", user.id).single();
  const myRoles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  const hospitalId = me?.hospital_id ?? null;

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: examsRaw }, { data: staff }, { data: comps }, { data: activityRaw }] = await Promise.all([
    hospitalId
      ? admin.from("osce_exams")
          .select(`
            id, title, programme, exam_date, status, notes,
            osce_stations(id, station_no, name, competency_id, assessor_id, duration_minutes, brief, equipment,
              framework_competencies!competency_id(name), profiles!assessor_id(full_name)),
            osce_candidates(nurse_id, status, profiles!nurse_id(full_name)),
            osce_results(station_id, nurse_id, score)
          `)
          .eq("hospital_id", hospitalId)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hospitalId).order("full_name").limit(400)
      : Promise.resolve({ data: [] }),
    admin.from("framework_competencies").select("id, name").order("name").limit(400),
    admin.from("audit_log")
      .select("actor_name, action, entity_name, created_at")
      .in("action", ["create_osce", "update_osce", "complete_osce", "record_osce_score", "ai_osce_design"])
      .order("created_at", { ascending: false }).limit(8),
  ]);

  const exams = (examsRaw ?? []) as unknown as ExamRecord[];

  const nurses: PickOption[] = (staff ?? [])
    .filter(p => (p.roles?.length ? p.roles : [p.role]).includes("nurse"))
    .map(p => ({ id: p.id, name: p.full_name }));
  const assessors: PickOption[] = (staff ?? [])
    .filter(p => (p.roles?.length ? p.roles : [p.role]).some((r: string) => ["assessor", "educator", "hospital_admin"].includes(r)))
    .map(p => ({ id: p.id, name: p.full_name }));
  const competencies: PickOption[] = (comps ?? []).map(c => ({ id: c.id, name: c.name }));

  // ── KPIs (all real; alpha only when the matrix supports it) ────────────────
  const active = exams.filter(e => ["draft", "published", "running"].includes(e.status));
  const runningToday = exams.filter(e => e.status === "running" || (e.status === "published" && e.exam_date === today));
  const activeCandidates = new Set(active.flatMap(e => e.osce_candidates.map(c => c.nurse_id)));
  const activeAssessors = new Set(active.flatMap(e => e.osce_stations.map(s => s.assessor_id).filter(Boolean)));
  const stationsCount = active.reduce((n, e) => n + e.osce_stations.length, 0);

  const measured = exams.filter(e => ["running", "completed"].includes(e.status));
  const expectedOf = (e: ExamRecord) => e.osce_stations.length * e.osce_candidates.filter(c => c.status !== "absent").length;
  const expected = measured.reduce((n, e) => n + expectedOf(e), 0);
  const recorded = measured.reduce((n, e) => n + e.osce_results.length, 0);
  const allResults = exams.flatMap(e => e.osce_results);
  const passRate = allResults.length ? Math.round(allResults.filter(r => r.score >= 3).length / allResults.length * 100) : null;
  const missing = exams.filter(e => e.status === "running").reduce((n, e) => n + Math.max(0, expectedOf(e) - e.osce_results.length), 0);

  // Reliability: most recent running/completed exam with enough complete rows.
  let alpha: number | null = null;
  let alphaExam: string | null = null;
  for (const e of measured) {
    if (e.osce_stations.length < 2) continue;
    const byNurse = new Map<string, Map<string, number>>();
    for (const r of e.osce_results) {
      const m = byNurse.get(r.nurse_id) ?? new Map<string, number>();
      m.set(r.station_id, r.score);
      byNurse.set(r.nurse_id, m);
    }
    const matrix = [...byNurse.values()]
      .filter(m => m.size === e.osce_stations.length)
      .map(m => e.osce_stations.map(s => m.get(s.id)!));
    const a = cronbachAlpha(matrix);
    if (a != null) { alpha = Math.round(a * 100) / 100; alphaExam = e.title; break; }
  }

  const kpis: OsceKpis = {
    active: active.length,
    runningToday: runningToday.length,
    candidates: activeCandidates.size,
    assessors: activeAssessors.size,
    stations: stationsCount,
    completion: expected ? Math.round(recorded / expected * 100) : null,
    passRate,
    alpha, alphaExam,
    missing,
  };

  const rows: ExamRow[] = exams.map(e => {
    const exp = expectedOf(e);
    const rec = e.osce_results.length;
    const pr = e.osce_results.length ? Math.round(e.osce_results.filter(r => r.score >= 3).length / e.osce_results.length * 100) : null;
    return {
      id: e.id, title: e.title, programme: e.programme, date: e.exam_date, status: e.status,
      stations: e.osce_stations.length, candidates: e.osce_candidates.length,
      expected: exp, recorded: rec, passRate: pr,
      isToday: e.exam_date === today,
    };
  });

  // ── Selected exam detail ───────────────────────────────────────────────────
  let detail: ExamDetail | null = null;
  const sel = params.x ? exams.find(e => e.id === params.x) : undefined;
  if (sel) {
    const stations = [...sel.osce_stations].sort((a, b) => a.station_no - b.station_no);
    const scoreOf = new Map(sel.osce_results.map(r => [`${r.station_id}:${r.nurse_id}`, r.score]));
    const readiness = [
      { label: "Stations added", ok: stations.length > 0 },
      { label: "Examiners assigned", ok: stations.length > 0 && stations.every(s => s.assessor_id) },
      { label: "Competencies linked", ok: stations.length > 0 && stations.every(s => s.competency_id) },
      { label: "Candidates registered", ok: sel.osce_candidates.length > 0 },
      { label: "Date scheduled", ok: !!sel.exam_date },
      { label: "Published", ok: ["published", "running", "completed"].includes(sel.status) },
    ];
    detail = {
      id: sel.id, title: sel.title, programme: sel.programme, date: sel.exam_date,
      status: sel.status, notes: sel.notes,
      stations: stations.map(s => ({
        id: s.id, no: s.station_no, name: s.name,
        competency: s.framework_competencies?.name ?? null,
        assessor: s.profiles?.full_name ?? null,
        duration: s.duration_minutes, brief: s.brief, equipment: s.equipment,
        recorded: sel.osce_results.filter(r => r.station_id === s.id).length,
      })),
      candidates: sel.osce_candidates.map(c => {
        const scores = stations.map(s => scoreOf.get(`${s.id}:${c.nurse_id}`));
        const present = scores.filter((v): v is number => v != null);
        return {
          nurseId: c.nurse_id,
          name: c.profiles?.full_name ?? "—",
          status: c.status,
          avg: present.length ? Math.round(present.reduce((a, b) => a + b, 0) / present.length * 10) / 10 : null,
          passed: present.filter(v => v >= 3).length,
          missing: scores.filter(v => v == null).length,
        };
      }),
      results: sel.osce_results.map(r => ({ stationId: r.station_id, nurseId: r.nurse_id, score: r.score })),
      readiness,
      readyPct: Math.round(readiness.filter(r => r.ok).length / readiness.length * 100),
    };
  }

  const activity: ActivityRow[] = (activityRaw ?? []).map(a => ({
    who: a.actor_name ?? "—",
    action: a.action, what: a.entity_name ?? "",
    at: a.created_at,
  }));

  return (
    <OsceCentre
      kpis={kpis}
      rows={rows}
      detail={detail}
      nurses={nurses}
      assessors={assessors}
      competencies={competencies}
      activity={activity}
      hasHospital={!!hospitalId}
    />
  );
}
