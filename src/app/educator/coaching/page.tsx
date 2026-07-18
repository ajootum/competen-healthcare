import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";
import CoachingBoard, { type SessionRow, type Learner } from "./CoachingBoard";

// Coaching Sessions — schedule and manage coaching appointments with SMART
// goals, notes and follow-up dates (support_sessions, migration 036).

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ new?: string }>;

export default async function CoachingSessionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireEducatorAccess();
  const params = await searchParams;
  const ctx = await loadAnalytics(admin, hospitalId);

  const { data: sessions } = hospitalId
    ? await admin.from("support_sessions")
        .select("id, nurse_id, educator_name, session_type, scheduled_for, focus, goals, notes, follow_up_date, status, profiles!nurse_id(full_name)")
        .eq("hospital_id", hospitalId).eq("session_type", "coaching")
        .order("scheduled_for", { ascending: false }).limit(100)
    : { data: [] };

  const now = new Date().toISOString();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  const rows: SessionRow[] = ((sessions ?? []) as unknown as {
    id: string; nurse_id: string; educator_name: string | null; session_type: string; scheduled_for: string;
    focus: string | null; goals: string | null; notes: string | null; follow_up_date: string | null; status: string;
    profiles: { full_name: string } | null;
  }[]).map(s => ({
    id: s.id, nurseId: s.nurse_id, nurse: s.profiles?.full_name ?? "—", educator: s.educator_name,
    type: s.session_type, at: s.scheduled_for, focus: s.focus, goals: s.goals, notes: s.notes,
    followUp: s.follow_up_date, status: s.status,
  }));

  const upcoming = rows.filter(s => s.status === "scheduled" && s.at >= now).length;
  const today = rows.filter(s => s.status === "scheduled" && s.at >= dayStart.toISOString() && s.at <= dayEnd.toISOString()).length;
  const completed = rows.filter(s => s.status === "completed").length;
  const learners: Learner[] = ctx.nurses.map(n => ({ id: n.id, name: n.name, dept: n.dept }));

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🗓️" title="Coaching Sessions" sub="Schedule and run coaching appointments — SMART goals, notes and follow-up dates. Learners are notified on scheduling." />
      <StatTiles tiles={[
        { label: "Upcoming", value: String(upcoming) },
        { label: "Today", value: String(today) },
        { label: "Completed", value: String(completed) },
        { label: "Total Sessions", value: String(rows.length) },
      ]} />
      <CoachingBoard sessions={rows} learners={learners} startOpen={params.new === "1"} />
      <p className="text-[10px] text-gray-400 mt-4">
        Sessions notify the learner when scheduled and when cancelled; notes are captured at completion and audit-logged.
        Meetings across all session types appear in <a href="/educator/meetings" className="text-purple-600 hover:underline">Meetings &amp; Follow-ups</a>.
        SMART goals are structured text — no separate goal engine.
      </p>
    </div>
  );
}
