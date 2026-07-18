import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BRIEFS } from "@/lib/simulation-briefs";
import SimCentre, { type SimKpis, type SimSession, type SimResult, type LibraryCase, type LibraryBrief, type SimAnalytics, type PickOption } from "./SimCentre";

// Simulation & OSCE Centre (assessor) — /assessor/simulation. Replaces the
// cross-shell "Simulation Scenarios" link into the nurse lab. Everything is
// live data: sessions from scheduled_assessments (method 'simulation'),
// results from the assessments table, scenarios from the governed
// clinical_cases library + curated briefs. The live assessment console is the
// real Conduct Assessment cockpit (method prefilled via the linked session).
// Standardized patients, equipment inventory, recordings and moderation have
// no backing store and appear as muted "soon" chips only.

export default async function AssessorSimulationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const myRoles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  const hospitalId = me?.hospital_id ?? null;

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);

  const [{ data: sessionsRaw }, { data: simAssessRaw }, { data: casesRaw }, { data: nursesRaw }, { data: compsRaw }, { count: osceActive }] = await Promise.all([
    hospitalId
      ? admin.from("scheduled_assessments")
          .select("id, nurse_id, assessor_id, scheduled_for, location, note, status, nurse:profiles!nurse_id(full_name), assessor:profiles!assessor_id(full_name)")
          .eq("hospital_id", hospitalId).eq("method", "simulation").eq("status", "scheduled")
          .order("scheduled_for").limit(40)
      : Promise.resolve({ data: [] }),
    admin.from("assessments")
      .select("id, score, notes, assessed_at, validated_at, competency_id, framework_competencies!competency_id(name), competency_cycles!cycle_id(hospital_id, nurse_id, profiles!nurse_id(full_name))")
      .eq("method", "simulation").eq("status", "complete").not("score", "is", null)
      .order("assessed_at", { ascending: false }).limit(200),
    admin.from("clinical_cases")
      .select("id, title, difficulty, status, clinical_practice_units(name)")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(12),
    hospitalId
      ? admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name").limit(400)
      : Promise.resolve({ data: [] }),
    admin.from("framework_competencies").select("id, name").order("name").limit(400),
    hospitalId
      ? admin.from("osce_exams").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId).in("status", ["draft", "published", "running"])
      : Promise.resolve({ count: 0 }),
  ]);

  type SessRow = {
    id: string; nurse_id: string; assessor_id: string; scheduled_for: string; location: string | null; note: string | null;
    nurse: { full_name: string } | null; assessor: { full_name: string } | null;
  };
  const sessions = (sessionsRaw ?? []) as unknown as SessRow[];
  const upcoming = sessions.filter(s => s.scheduled_for >= nowIso);
  const overdue = sessions.filter(s => s.scheduled_for < nowIso);

  type AssessRow = {
    id: string; score: number; assessed_at: string | null; validated_at: string | null;
    framework_competencies: { name: string } | null;
    competency_cycles: { hospital_id: string | null; nurse_id: string; profiles: { full_name: string } | null } | null;
  };
  const simAssess = ((simAssessRaw ?? []) as unknown as AssessRow[])
    .filter(a => !hospitalId || a.competency_cycles?.hospital_id === hospitalId);

  const completedToday = simAssess.filter(a => (a.assessed_at ?? "").startsWith(today)).length;
  const awaitingValidation = simAssess.filter(a => !a.validated_at).length;

  const last30 = simAssess.filter(a => (a.assessed_at ?? "") >= d30.toISOString());
  const passRate30 = last30.length ? Math.round(last30.filter(a => a.score >= 3).length / last30.length * 100) : null;
  const avg30 = last30.length ? Math.round(last30.reduce((s, a) => s + a.score, 0) / last30.length * 10) / 10 : null;

  // Competency gaps: most failing simulation scores (all-time, this hospital).
  const failCounts = new Map<string, number>();
  for (const a of simAssess) {
    if (a.score >= 3) continue;
    const n = a.framework_competencies?.name ?? "Competency";
    failCounts.set(n, (failCounts.get(n) ?? 0) + 1);
  }
  const gaps = [...failCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, fails]) => ({ name, fails }));

  const cases: LibraryCase[] = ((casesRaw ?? []) as unknown as {
    id: string; title: string; difficulty: string | null; status: string; clinical_practice_units: { name: string } | null;
  }[]).map(c => ({ id: c.id, title: c.title, difficulty: c.difficulty, status: c.status, cpu: c.clinical_practice_units?.name ?? null }));

  const briefs: LibraryBrief[] = BRIEFS.map(b => ({
    id: b.id, title: b.title, category: b.category, difficulty: b.difficulty, duration: b.duration,
    patient: b.patient, complaint: b.complaint, vitals: b.vitals, skills: b.skills,
  }));

  const kpis: SimKpis = {
    upcoming: upcoming.length,
    pendingScoring: overdue.length,
    completedToday,
    awaitingValidation,
    library: briefs.length + cases.length,
    osceActive: osceActive ?? 0,
  };

  const toSession = (s: SessRow): SimSession => ({
    id: s.id, nurseId: s.nurse_id, nurse: s.nurse?.full_name ?? "—",
    assessor: s.assessor?.full_name ?? "—", mine: s.assessor_id === user.id,
    at: s.scheduled_for, location: s.location, note: s.note,
  });

  const results: SimResult[] = simAssess.slice(0, 10).map(a => ({
    id: a.id,
    nurse: a.competency_cycles?.profiles?.full_name ?? "—",
    competency: a.framework_competencies?.name ?? "—",
    score: a.score,
    at: a.assessed_at,
    validated: !!a.validated_at,
  }));

  const analytics: SimAnalytics = { sims30: last30.length, passRate30, avg30, gaps };

  return (
    <SimCentre
      kpis={kpis}
      upcoming={upcoming.slice(0, 10).map(toSession)}
      overdue={overdue.slice(0, 6).map(toSession)}
      results={results}
      briefs={briefs}
      cases={cases}
      analytics={analytics}
      nurses={(nursesRaw ?? []).map(n => ({ id: n.id, name: n.full_name })) as PickOption[]}
      competencies={(compsRaw ?? []).map(c => ({ id: c.id, name: c.name })) as PickOption[]}
      hasHospital={!!hospitalId}
    />
  );
}
