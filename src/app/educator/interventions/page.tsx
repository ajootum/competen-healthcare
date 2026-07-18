import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";
import InterventionsBoard, { type InterventionRow, type Learner } from "./InterventionsBoard";

// Interventions — remediation plans with objectives, activities, review dates
// and recorded outcomes (interventions table, migration 036).

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ new?: string }>;

export default async function InterventionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireEducatorAccess();
  const params = await searchParams;
  const ctx = await loadAnalytics(admin, hospitalId);

  const { data: raw } = hospitalId
    ? await admin.from("interventions")
        .select("id, nurse_id, competency_name, reason, objectives, activities, review_date, status, outcome, outcome_note, created_by_name, created_at, profiles!nurse_id(full_name)")
        .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(100)
    : { data: [] };

  const rows: InterventionRow[] = ((raw ?? []) as unknown as {
    id: string; nurse_id: string; competency_name: string | null; reason: string; objectives: string | null; activities: string | null;
    review_date: string | null; status: string; outcome: string | null; outcome_note: string | null; created_by_name: string | null; created_at: string;
    profiles: { full_name: string } | null;
  }[]).map(r => ({
    id: r.id, nurseId: r.nurse_id, nurse: r.profiles?.full_name ?? "—",
    competency: r.competency_name, reason: r.reason, objectives: r.objectives, activities: r.activities,
    reviewDate: r.review_date, status: r.status, outcome: r.outcome, outcomeNote: r.outcome_note,
    createdBy: r.created_by_name, at: r.created_at,
  }));

  const activeCount = rows.filter(r => r.status !== "completed").length;
  const completed = rows.filter(r => r.status === "completed");
  const today = new Date().toISOString().slice(0, 10);
  const dueReview = rows.filter(r => r.status !== "completed" && r.reviewDate && r.reviewDate <= today).length;
  const successRate = completed.length
    ? Math.round(completed.filter(r => r.outcome === "successful").length / completed.length * 100) : null;
  const learners: Learner[] = ctx.nurses.map(n => ({ id: n.id, name: n.name, dept: n.dept }));

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🎯" title="Interventions" sub="Create and track remediation plans — objectives, activities, review dates and recorded outcomes." />
      <StatTiles tiles={[
        { label: "Active", value: String(activeCount), alert: dueReview > 0 },
        { label: "Due for Review", value: String(dueReview), alert: dueReview > 0 },
        { label: "Completed", value: String(completed.length) },
        { label: "Success Rate", value: successRate != null ? `${successRate}%` : "—", sub: "of completed" },
      ]} />
      <InterventionsBoard items={rows} learners={learners} startOpen={params.new === "1"} />
      <p className="text-[10px] text-gray-400 mt-4">
        Learners are notified when an intervention is created for them. Outcomes feed <a href="/educator/support-analytics" className="text-purple-600 hover:underline">Support Analytics</a> —
        intervention effectiveness is now a real recorded measure.
      </p>
    </div>
  );
}
