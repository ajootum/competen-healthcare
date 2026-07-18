import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ValidationCentre, {
  type QueueItem, type ArchiveItem, type CentreStats,
  type AssessmentRow, type HistoryRow,
} from "@/components/educator/ValidationCentre";

// Educator Validation Centre (COMPETEN Educator Validation Centre spec).
// Server side assembles the live queue: pending competency scores with their
// individual assessments (assessor, method, notes, scoring spread), attempt
// history, performance criteria, plus the validated archive and analytics
// computed from real validated_at timestamps.

const nowMs = () => Date.now();

export default async function ValidationCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["educator", "hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const { data: hospitalNurses } = await admin
    .from("profiles").select("id")
    .eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse");
  const nurseIds = (hospitalNurses ?? []).map(n => n.id);

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const d7 = new Date(nowMs() - 7 * 86400000).toISOString();
  const noRows = Promise.resolve({ data: [] as never[] });

  const [{ data: pending }, { data: validated }, { count: validatedToday }] = await Promise.all([
    nurseIds.length ? admin.from("competency_scores")
      .select(`
        id, competency_id, cycle_id, nurse_id, score, label, is_passing, assessed_at,
        educator_id, educator_notes,
        profiles!nurse_id(full_name),
        framework_competencies!competency_id(
          name,
          performance_criteria(criterion, sort_order),
          framework_domains(name, frameworks(name))
        )
      `)
      .eq("educator_validated", false).in("nurse_id", nurseIds)
      .order("assessed_at").limit(50) : noRows,
    nurseIds.length ? admin.from("competency_scores")
      .select(`
        id, nurse_id, score, is_passing, assessed_at, validated_at,
        profiles!nurse_id(full_name),
        framework_competencies!competency_id(name)
      `)
      .eq("educator_validated", true).in("nurse_id", nurseIds)
      .order("assessed_at", { ascending: false }).limit(40) : noRows,
    admin.from("competency_scores").select("id", { count: "exact", head: true })
      .eq("educator_id", user.id).eq("educator_validated", true)
      .gte("validated_at", dayStart.toISOString()),
  ]);

  // Individual assessments for every pending (competency, cycle) pair
  const compIds = [...new Set((pending ?? []).map(p => p.competency_id))];
  const cycleIds = [...new Set((pending ?? []).map(p => p.cycle_id))];
  const { data: assessRows } = compIds.length ? await admin.from("assessments")
    .select("id, competency_id, cycle_id, method, score, notes, assessed_at, profiles!assessor_id(full_name)")
    .in("competency_id", compIds).in("cycle_id", cycleIds)
    .order("assessed_at") : { data: [] };

  // Attempt history for every pending (nurse, competency) pair
  const { data: historyRows } = nurseIds.length && compIds.length ? await admin.from("competency_scores")
    .select("id, nurse_id, competency_id, score, assessed_at, educator_validated")
    .in("nurse_id", nurseIds).in("competency_id", compIds)
    .order("assessed_at") : { data: [] };

  const queue: QueueItem[] = (pending ?? []).map(p => {
    const comp = p.framework_competencies as unknown as {
      name: string;
      performance_criteria: { criterion: string; sort_order: number }[] | null;
      framework_domains: { name: string; frameworks: { name: string } | null } | null;
    } | null;
    const assessments: AssessmentRow[] = (assessRows ?? [])
      .filter(a => a.competency_id === p.competency_id && a.cycle_id === p.cycle_id)
      .map(a => ({
        id: a.id,
        assessor: (a.profiles as unknown as { full_name: string } | null)?.full_name ?? "Assessor",
        method: a.method, score: a.score, notes: a.notes, assessedAt: a.assessed_at,
      }));
    const scores = assessments.map(a => a.score).filter((s): s is number => s !== null);
    const history: HistoryRow[] = (historyRows ?? [])
      .filter(h => h.nurse_id === p.nurse_id && h.competency_id === p.competency_id)
      .map(h => ({ id: h.id, score: h.score, assessedAt: h.assessed_at, validated: h.educator_validated }));
    const attempt = Math.max(1, history.findIndex(h => h.id === p.id) + 1 || history.length);
    return {
      id: p.id, competencyId: p.competency_id, cycleId: p.cycle_id, nurseId: p.nurse_id,
      competency: comp?.name ?? "Competency",
      framework: comp?.framework_domains?.frameworks?.name ?? "—",
      domain: comp?.framework_domains?.name ?? "—",
      criteria: (comp?.performance_criteria ?? []).sort((a, b) => a.sort_order - b.sort_order).map(c => c.criterion),
      nurse: (p.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
      score: p.score, label: p.label, isPassing: p.is_passing, assessedAt: p.assessed_at,
      attempt, returned: !!p.educator_id, educatorNotes: p.educator_notes,
      assessments, history,
      spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : null,
    };
  });

  const archive: ArchiveItem[] = (validated ?? []).map(v => ({
    id: v.id,
    competency: (v.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency",
    nurse: (v.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
    score: v.score, isPassing: v.is_passing, assessedAt: v.assessed_at, validatedAt: v.validated_at,
  }));

  // Analytics — real timestamps only.
  const pendingOnly = queue.filter(i => !i.returned);
  const returned = queue.filter(i => i.returned);
  const validatedCount = (validated ?? []).length;
  const reviewed = validatedCount + returned.length;
  const totalScores = validatedCount + queue.length;
  const reviewDays = (validated ?? [])
    .filter(v => v.validated_at)
    .map(v => (new Date(v.validated_at as string).getTime() - new Date(v.assessed_at).getTime()) / 86400000)
    .filter(d => d >= 0);
  const spreads = queue.map(i => i.spread).filter((s): s is number => s !== null);
  const passingAll = [...queue.map(i => i.isPassing), ...(validated ?? []).map(v => v.is_passing)];

  const stats: CentreStats = {
    pending: pendingOnly.length,
    highPriority: pendingOnly.filter(i => !i.isPassing).length,
    overdue: pendingOnly.filter(i => i.assessedAt < d7).length,
    validatedToday: validatedToday ?? 0,
    returned: returned.length,
    avgReviewDays: reviewDays.length ? reviewDays.reduce((s, x) => s + x, 0) / reviewDays.length : null,
    approvalRate: reviewed ? Math.round((validatedCount / reviewed) * 100) : null,
    returnRate: reviewed ? Math.round((returned.length / reviewed) * 100) : null,
    passRate: passingAll.length ? Math.round((passingAll.filter(Boolean).length / passingAll.length) * 100) : null,
    validationRate: totalScores ? Math.round((validatedCount / totalScores) * 100) : null,
    spreadAvg: spreads.length ? spreads.reduce((s, x) => s + x, 0) / spreads.length : null,
  };

  return <ValidationCentre queue={queue} archive={archive} stats={stats} />;
}
