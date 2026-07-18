import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { generateAssessorQueue } from "@/lib/engines/tasks";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import LearnersTable, { type LearnerRow } from "./LearnersTable";

// Learners (Learners Page Redesign spec): the assessor's learner-management
// workspace. Every column is live — progress and pass rate from latest
// decisions (this page previously read the empty legacy nurse_competencies
// table), priority from the queue engine, due dates from scheduled sessions,
// risk from the risk-engine rules, feedback from real verifier comments.

export default async function LearnersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  if (!profile.hospital_id) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <p className="text-4xl mb-3">🏥</p>
        <h1 className="text-lg font-bold text-gray-900">No hospital linked yet</h1>
        <p className="text-sm text-gray-400 mt-1 mb-5">
          Your assessor account isn&apos;t linked to a facility, so there are no learners to show.
        </p>
        <div className="flex justify-center gap-2">
          <a href="mailto:gabriel@semacast.com?subject=Link my assessor account to a hospital"
            className="text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-4 py-2 rounded-lg transition-colors">
            Contact Administrator
          </a>
          <a href="/dashboard/billing"
            className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
            Update Profile
          </a>
        </div>
      </div>
    );
  }

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  const in60 = new Date(); in60.setDate(in60.getDate() + 60);
  const in60Key = in60.toISOString().slice(0, 10);

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization, created_at, avatar_url")
    .eq("hospital_id", profile.hospital_id).eq("role", "nurse").order("full_name");
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: decisions }, { data: sessions }, { data: pendingLogs },
    { data: assessRows }, { data: feedbackRows },
  ] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_decisions")
          .select("nurse_id, competency_id, outcome, critical_failure, expiry_date, created_at, frameworks(name)")
          .in("nurse_id", nurseIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("scheduled_assessments")
          .select("nurse_id, method, scheduled_for, status")
          .in("nurse_id", nurseIds).eq("status", "scheduled").order("scheduled_for")
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries").select("nurse_id").eq("status", "pending").in("nurse_id", nurseIds)
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("assessments")
          .select("status, score, competency_cycles!cycle_id!inner(nurse_id)")
          .in("competency_cycles.nurse_id", nurseIds)
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries")
          .select("nurse_id, verifier_comment, verified_by_name, verified_at")
          .in("nurse_id", nurseIds).not("verifier_comment", "is", null)
          .order("verified_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  let queue: Awaited<ReturnType<typeof generateAssessorQueue>> = { tasks: [], workload: { tasks: 0, estMinutes: 0, learners: 0, urgent: 0 } };
  try {
    queue = await generateAssessorQueue(admin, profile.hospital_id, user.id);
  } catch { /* requirement matrix not installed yet */ }

  // Latest decision per nurse+competency
  const seen = new Set<string>();
  type Agg = { pass: number; total: number; expSoon: number; expired: number; critical: number; notYet: number; framework: Map<string, number> };
  const agg = new Map<string, Agg>();
  for (const d of (decisions ?? []) as unknown as {
    nurse_id: string; competency_id: string; outcome: string; critical_failure: boolean;
    expiry_date: string | null; created_at: string; frameworks: { name: string } | null;
  }[]) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = agg.get(d.nurse_id) ?? { pass: 0, total: 0, expSoon: 0, expired: 0, critical: 0, notYet: 0, framework: new Map() };
    a.total++;
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (passing) {
      if (d.expiry_date && d.expiry_date < today) a.expired++;
      else {
        a.pass++;
        if (d.expiry_date && d.expiry_date <= in60Key) a.expSoon++;
      }
    } else a.notYet++;
    if (d.critical_failure) a.critical++;
    const fw = d.frameworks?.name;
    if (fw) a.framework.set(fw, (a.framework.get(fw) ?? 0) + 1);
    agg.set(d.nurse_id, a);
  }

  const nextSession = new Map<string, { when: string; method: string }>();
  const overdueSet = new Set<string>();
  const sessionsToday = (sessions ?? []).filter(s => s.scheduled_for >= nowIso && s.scheduled_for <= dayEnd.toISOString()).length;
  for (const s of sessions ?? []) {
    if (s.scheduled_for < nowIso) overdueSet.add(s.nurse_id);
    else if (!nextSession.has(s.nurse_id)) nextSession.set(s.nurse_id, { when: s.scheduled_for, method: s.method });
  }

  const pendingByNurse = new Map<string, number>();
  for (const p of pendingLogs ?? []) pendingByNurse.set(p.nurse_id, (pendingByNurse.get(p.nurse_id) ?? 0) + 1);

  const scoreByNurse = new Map<string, number[]>();
  const inProgressSet = new Set<string>();
  for (const a of (assessRows ?? []) as unknown as { status: string; score: number | null; competency_cycles: { nurse_id: string } }[]) {
    const nid = a.competency_cycles.nurse_id;
    if (a.status === "in_progress") inProgressSet.add(nid);
    if (a.status === "complete" && a.score !== null) {
      const list = scoreByNurse.get(nid) ?? [];
      list.push(a.score);
      scoreByNurse.set(nid, list);
    }
  }

  const feedbackByNurse = new Map<string, { text: string; by: string | null; at: string | null }>();
  for (const f of feedbackRows ?? []) {
    if (!feedbackByNurse.has(f.nurse_id) && f.verifier_comment) {
      feedbackByNurse.set(f.nurse_id, { text: f.verifier_comment, by: f.verified_by_name, at: f.verified_at });
    }
  }

  const taskByNurse = new Map<string, { cpuName: string; priority: number; type: string; readiness: number }>();
  for (const t of queue.tasks) {
    if (!taskByNurse.has(t.nurseId)) taskByNurse.set(t.nurseId, { cpuName: t.cpuName, priority: t.priority, type: t.type, readiness: t.readiness });
  }

  const rows: LearnerRow[] = (nurses ?? []).map(n => {
    const a = agg.get(n.id);
    const task = taskByNurse.get(n.id) ?? null;
    const scores = scoreByNurse.get(n.id) ?? [];
    const risk: LearnerRow["risk"] = a && (a.critical > 0 || a.notYet > 0) ? "high"
      : a && (a.expired > 0 || a.expSoon > 0) ? "medium" : "low";
    const status: LearnerRow["status"] = inProgressSet.has(n.id) ? "In Progress"
      : overdueSet.has(n.id) ? "Overdue"
      : nextSession.has(n.id) ? "Scheduled"
      : task ? "Awaiting Assessment" : "Up to date";
    const fwTop = a ? [...a.framework.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null : null;
    return {
      id: n.id, name: n.full_name, department: n.specialization ?? "General",
      joined: n.created_at, avatarUrl: n.avatar_url ?? null,
      framework: fwTop,
      currentAssessment: task ? task.cpuName : null,
      taskType: task?.type ?? null,
      priority: task ? (task.priority <= 3 ? "high" : task.priority <= 6 ? "medium" : "low") : null,
      due: nextSession.get(n.id) ?? null,
      overdue: overdueSet.has(n.id),
      status,
      pass: a?.pass ?? 0, total: a?.total ?? 0,
      expSoon: a?.expSoon ?? 0,
      risk,
      pendingEvidence: pendingByNurse.get(n.id) ?? 0,
      avgScore: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null,
      feedback: feedbackByNurse.get(n.id) ?? null,
      upcomingSessions: (sessions ?? []).filter(s => s.nurse_id === n.id && s.scheduled_for >= nowIso).length,
    };
  });

  const totalDecided = rows.reduce((s, r) => s + r.total, 0);
  const passRate = totalDecided ? Math.round((rows.reduce((s, r) => s + r.pass, 0) / totalDecided) * 100) : null;

  const kpis = {
    learners: rows.length,
    dueToday: sessionsToday,
    awaitingEvidence: (pendingLogs ?? []).length,
    overdue: (sessions ?? []).filter(s => s.scheduled_for < nowIso).length,
    passRate,
  };

  return <LearnersTable rows={rows} kpis={kpis} />;
}
