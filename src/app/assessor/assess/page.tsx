import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import ConductCockpit, { type CockpitFramework, type CockpitLevel } from "./ConductCockpit";

// Conduct Assessment workspace (assessor cockpit). One live session per
// clinician + cycle: guided workflow, criterion checklists (real
// checklist_items with critical flags), 0–6 Benner scoring, evidence capture,
// rule-based assistant signals, and a single submit that records assessments,
// checklist responses, audit trail and learner notification.

type SearchParams = Promise<{ nurse?: string; cycle?: string; s?: string }>;

export default async function AssessorAssessPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: assessor } = await admin
    .from("profiles")
    .select("role, roles, hospital_id, full_name")
    .eq("id", user.id)
    .single();

  const myRoles: string[] = assessor?.roles?.length ? assessor.roles : [assessor?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const nurseId = params.nurse;
  const hospitalId = assessor?.hospital_id ?? null;

  // ── Session setup screen: pick a learner or start from a scheduled session ──
  if (!nurseId) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [{ data: nurses }, { data: sessions }] = await Promise.all([
      hospitalId
        ? admin.from("profiles")
            .select("id, full_name, specialization, email")
            .eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name")
        : Promise.resolve({ data: [] }),
      admin.from("scheduled_assessments")
        .select("id, nurse_id, method, scheduled_for, location, profiles!nurse_id(full_name)")
        .eq("assessor_id", user.id).eq("status", "scheduled")
        .gte("scheduled_for", todayStart.toISOString())
        .order("scheduled_for").limit(8),
    ]);

    const nurseIds = (nurses ?? []).map(n => n.id);
    const { data: allCycles } = nurseIds.length
      ? await admin.from("competency_cycles")
          .select("nurse_id, id, cycle_type, status")
          .in("nurse_id", nurseIds).eq("status", "active")
      : { data: [] };

    return (
      <div className="max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Conduct Assessment</h1>
          <p className="text-gray-400 text-sm mt-0.5">Start a session from your schedule, or pick a learner with an active cycle.</p>
        </div>

        {(sessions ?? []).length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 mb-6 overflow-hidden">
            <div className="px-5 py-3 bg-indigo-50/60 border-b border-indigo-100">
              <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider">📅 Upcoming scheduled sessions</p>
            </div>
            {(sessions ?? []).map((s, i) => {
              const nurseName = (s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—";
              return (
                <div key={s.id} className={`flex items-center gap-4 px-5 py-3 ${i > 0 ? "border-t border-gray-50" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{nurseName}</p>
                    <p className="text-xs text-gray-400 capitalize" suppressHydrationWarning>
                      {new Date(s.scheduled_for).toLocaleString()} · {s.method.replace(/_/g, " ")}{s.location ? ` · ${s.location}` : ""}
                    </p>
                  </div>
                  <Link href={`/assessor/assess?nurse=${s.nurse_id}&s=${s.id}`}
                    className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                    Start Session →
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {!hospitalId ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
            Your assessor account is not linked to a hospital. Ask a hospital administrator to link you.
          </div>
        ) : !(nurses ?? []).length ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <p className="text-3xl mb-3">👩‍⚕️</p>
            <p className="text-gray-500 text-sm">No nurses in your hospital yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {(nurses ?? []).map((nurse, i) => {
              const activeCycle = (allCycles ?? []).find(c => c.nurse_id === nurse.id);
              return (
                <div key={nurse.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-gray-50" : ""}`}>
                  <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {nurse.full_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{nurse.full_name}</p>
                    <p className="text-xs text-gray-400">{nurse.specialization ?? nurse.email}</p>
                  </div>
                  {activeCycle ? (
                    <Link
                      href={`/assessor/assess?nurse=${nurse.id}&cycle=${activeCycle.id}`}
                      className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors capitalize">
                      {activeCycle.cycle_type} cycle →
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400 border border-gray-200 px-3 py-1.5 rounded-lg">No active cycle</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Live session: load learner, cycle, frameworks, history, evidence ────────
  const [{ data: nurse }, { data: cycle }, { data: session }] = await Promise.all([
    admin.from("profiles").select("id, full_name, specialization, avatar_url").eq("id", nurseId).single(),
    params.cycle
      ? admin.from("competency_cycles").select("id, cycle_type, start_date").eq("id", params.cycle).eq("nurse_id", nurseId).single()
      : admin.from("competency_cycles").select("id, cycle_type, start_date").eq("nurse_id", nurseId).eq("status", "active").limit(1).maybeSingle(),
    params.s
      ? admin.from("scheduled_assessments").select("id, method, location, scheduled_for, assessor_id").eq("id", params.s).single()
      : Promise.resolve({ data: null }),
  ]);

  if (!cycle || !nurse) {
    return (
      <div className="max-w-2xl">
        <h1 className="sr-only">Conduct Assessment</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="text-amber-800 font-semibold mb-1">No active cycle found</p>
          <p className="text-amber-700 text-sm mb-3">This clinician does not have an active competency cycle. Create one from the Admin panel before assessing.</p>
          <Link href="/assessor/assess" className="text-sm text-indigo-600 hover:underline">← Back to session setup</Link>
        </div>
      </div>
    );
  }

  const linkedSession = session && session.assessor_id === user.id
    ? { id: session.id as string, method: session.method as string, location: (session.location as string | null) ?? null, at: session.scheduled_for as string }
    : null;

  // Frameworks in scope: assigned via cycle_frameworks, else all active.
  const { data: cfw } = await admin.from("cycle_frameworks").select("framework_id").eq("cycle_id", cycle.id);
  const frameworkIds = (cfw ?? []).map(a => a.framework_id);

  let fwQuery = admin
    .from("frameworks")
    .select(`
      id, name, library, sort_order,
      framework_domains(id, name, sort_order,
        framework_competencies(id, name, description, sort_order,
          performance_criteria(id, criterion, sort_order),
          competency_skills(id, name, is_active,
            skill_checklists(id, name, checklist_items(id, item, is_critical, sort_order))
          ),
          assessment_method_configs(method, is_required)
        )
      )
    `)
    .eq("is_active", true)
    .order("library")
    .order("sort_order");
  if (frameworkIds.length > 0) fwQuery = fwQuery.in("id", frameworkIds);

  const [{ data: frameworks }, { data: levels }, { data: priorAssessments }, { data: priorDecisions }, { data: evidenceRows }] = await Promise.all([
    fwQuery,
    admin.from("scoring_levels")
      .select("score, label, description, color, is_passing")
      .eq("scale_id", "00000000-0000-0000-0000-000000000001")
      .order("score"),
    admin.from("assessments")
      .select("competency_id, score, assessed_at, profiles!assessor_id(full_name)")
      .eq("cycle_id", cycle.id).not("score", "is", null)
      .order("created_at", { ascending: false }).limit(400),
    admin.from("competency_decisions")
      .select("competency_id, outcome, expiry_date, critical_failure, created_at, framework_competencies(name)")
      .eq("nurse_id", nurseId)
      .order("created_at", { ascending: false }).limit(400),
    admin.from("evidence")
      .select("id, competency_id")
      .eq("owner_id", nurseId).eq("kind", "evidence"),
  ]);

  // Latest prior score per competency (any assessor) — shown as reference.
  const prevByComp = new Map<string, { score: number; by: string; at: string | null }>();
  for (const a of priorAssessments ?? []) {
    if (prevByComp.has(a.competency_id)) continue;
    prevByComp.set(a.competency_id, {
      score: a.score as number,
      by: (a.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
      at: a.assessed_at?.slice(0, 10) ?? null,
    });
  }

  // Latest decision per competency → assistant signals + risk chip.
  const seenDec = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Key = in30.toISOString().slice(0, 10);
  const outcomeByComp = new Map<string, string>();
  const focusAreas: string[] = [];
  const expiringSoon: string[] = [];
  let riskLevel: "high" | "medium" | "low" = "low";
  const riskNotes: string[] = [];
  for (const d of priorDecisions ?? []) {
    if (seenDec.has(d.competency_id)) continue;
    seenDec.add(d.competency_id);
    outcomeByComp.set(d.competency_id, d.outcome);
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (d.critical_failure) {
      riskLevel = "high";
      riskNotes.push(`Critical failure on record: ${name}`);
    }
    if (!passing) {
      if (riskLevel === "low") riskLevel = "medium";
      if (focusAreas.length < 4) focusAreas.push(name);
    } else if (d.expiry_date && d.expiry_date < today) {
      if (riskLevel === "low") riskLevel = "medium";
      riskNotes.push(`Expired competency: ${name}`);
    } else if (d.expiry_date && d.expiry_date <= in30Key && expiringSoon.length < 4) {
      expiringSoon.push(name);
    }
  }

  const evidenceByComp = new Map<string, number>();
  for (const e of evidenceRows ?? []) {
    if (e.competency_id) evidenceByComp.set(e.competency_id, (evidenceByComp.get(e.competency_id) ?? 0) + 1);
  }

  const cockpitFrameworks: CockpitFramework[] = (frameworks ?? []).map(f => ({
    id: f.id,
    name: f.name,
    domains: [...(f.framework_domains ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(d => ({
        id: d.id,
        name: d.name,
        comps: [...(d.framework_competencies ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(c => {
            const prev = prevByComp.get(c.id) ?? null;
            return {
              id: c.id,
              name: c.name,
              description: c.description ?? null,
              criteria: [...(c.performance_criteria ?? [])]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(pc => ({ id: pc.id, text: pc.criterion })),
              skills: (c.competency_skills ?? [])
                .filter(s => s.is_active !== false)
                .map(s => ({
                  id: s.id,
                  name: s.name,
                  items: (s.skill_checklists ?? []).flatMap(cl =>
                    [...(cl.checklist_items ?? [])]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map(it => ({ id: it.id, item: it.item, critical: !!it.is_critical }))
                  ),
                })),
              methods: (c.assessment_method_configs ?? []).map(m => ({ method: m.method, required: !!m.is_required })),
              prevScore: prev?.score ?? null,
              prevBy: prev?.by ?? null,
              prevAt: prev?.at ?? null,
              priorOutcome: outcomeByComp.get(c.id) ?? null,
              evidenceCount: evidenceByComp.get(c.id) ?? 0,
            };
          }),
      })),
  }));

  const cockpitLevels: CockpitLevel[] = (levels ?? []).map(l => ({
    score: l.score, label: l.label, desc: l.description ?? null, color: l.color, passing: !!l.is_passing,
  }));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/assessor/assess" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← Session Setup</Link>
        <span className="text-gray-200">/</span>
        <span className="text-xs text-gray-600">Conduct Assessment · Assessment in Progress</span>
      </div>
      <ConductCockpit
        cycleId={cycle.id}
        cycleType={cycle.cycle_type}
        nurseId={nurse.id}
        nurseName={nurse.full_name}
        nurseSpec={nurse.specialization ?? null}
        nurseAvatar={nurse.avatar_url ?? null}
        assessorName={assessor?.full_name ?? "Assessor"}
        frameworks={cockpitFrameworks}
        levels={cockpitLevels}
        riskLevel={riskLevel}
        riskNotes={riskNotes.slice(0, 4)}
        focusAreas={focusAreas}
        expiringSoon={expiringSoon}
        evidenceTotal={(evidenceRows ?? []).length}
        session={linkedSession}
      />
    </div>
  );
}
