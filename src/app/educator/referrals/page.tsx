import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";
import ReferralsBoard, { type ReferralRow, type Person, type Learner } from "./ReferralsBoard";

// Referrals — escalate learners to colleagues or external support services.
// Sensitive by design: the learner is not notified and cannot read the row;
// only referrer + referee see it (migration 036 RLS).

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ new?: string }>;

export default async function ReferralsPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId, userId } = await requireEducatorAccess();
  const params = await searchParams;
  const ctx = await loadAnalytics(admin, hospitalId);

  const [{ data: raw }, { data: staff }] = await Promise.all([
    hospitalId
      ? admin.from("referrals")
          .select("id, nurse_id, referred_to_id, referred_to_text, reason, urgency, status, resolution_note, created_by, created_by_name, created_at, learner:profiles!nurse_id(full_name), referee:profiles!referred_to_id(full_name)")
          .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hospitalId).neq("id", userId).order("full_name").limit(400)
      : Promise.resolve({ data: [] }),
  ]);

  const rows: ReferralRow[] = ((raw ?? []) as unknown as {
    id: string; nurse_id: string; referred_to_id: string | null; referred_to_text: string | null; reason: string; urgency: string;
    status: string; resolution_note: string | null; created_by: string | null; created_by_name: string | null; created_at: string;
    learner: { full_name: string } | null; referee: { full_name: string } | null;
  }[]).map(r => ({
    id: r.id, nurse: r.learner?.full_name ?? "—",
    referredTo: r.referee?.full_name ?? r.referred_to_text ?? "—",
    reason: r.reason, urgency: r.urgency, status: r.status, resolutionNote: r.resolution_note,
    createdBy: r.created_by_name, at: r.created_at, mine: r.created_by === userId,
  }));

  const referees: Person[] = (staff ?? [])
    .filter(p => (p.roles?.length ? p.roles : [p.role]).some((x: string) => ["assessor", "educator", "hospital_admin"].includes(x)))
    .map(p => ({ id: p.id, name: p.full_name, role: ((p.roles?.length ? p.roles : [p.role])[0] ?? "staff").replace("_", " ") }));
  const learners: Learner[] = ctx.nurses.map(n => ({ id: n.id, name: n.name, dept: n.dept }));

  const open = rows.filter(r => ["open", "accepted"].includes(r.status)).length;
  const highOpen = rows.filter(r => r.urgency === "high" && ["open", "accepted"].includes(r.status)).length;

  return (
    <div className="max-w-4xl">
      <EduHeader icon="📤" title="Referrals" sub="Escalate learners to programme leads, assessors, supervisors or wellbeing support — with resolution tracking." />
      <StatTiles tiles={[
        { label: "Open", value: String(open), alert: highOpen > 0 },
        { label: "High Urgency Open", value: String(highOpen), alert: highOpen > 0 },
        { label: "Resolved", value: String(rows.filter(r => r.status === "resolved").length) },
        { label: "Total", value: String(rows.length) },
      ]} />
      <ReferralsBoard referrals={rows} learners={learners} referees={referees} startOpen={params.new === "1"} />
      <p className="text-[10px] text-gray-400 mt-4">
        Referrals are sensitive: the learner is not notified and cannot see the referral — only the referrer and the internal referee can.
        External-service referrals record the service name and reason only, no clinical detail. Internal referees are notified; resolution notifies the referrer.
      </p>
    </div>
  );
}
