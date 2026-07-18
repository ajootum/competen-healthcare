import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Meetings & Follow-ups — a unified agenda aggregating three real sources:
// support sessions (all types), intervention review dates and assessment
// sessions. One day-by-day list, no separate meetings store.

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  coaching: "Coaching", progress_review: "Progress review", validation_meeting: "Validation meeting", other: "Support session",
};

export default async function MeetingsPage() {
  const { admin, hospitalId, userId } = await requireEducatorAccess();
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 86400000).toISOString();
  const horizon = new Date(now.getTime() + 30 * 86400000).toISOString();
  const todayKey = now.toISOString().slice(0, 10);

  const [{ data: sessions }, { data: interventions }, { data: assessSessions }] = await Promise.all([
    hospitalId
      ? admin.from("support_sessions")
          .select("id, session_type, scheduled_for, focus, follow_up_date, status, profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).eq("status", "scheduled")
          .gte("scheduled_for", from).lte("scheduled_for", horizon)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("interventions")
          .select("id, review_date, competency_name, status, profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).neq("status", "completed").not("review_date", "is", null)
          .gte("review_date", todayKey).lte("review_date", horizon.slice(0, 10))
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("scheduled_assessments")
          .select("id, scheduled_for, method, location, status, nurse:profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).eq("assessor_id", userId).eq("status", "scheduled")
          .gte("scheduled_for", from).lte("scheduled_for", horizon)
      : Promise.resolve({ data: [] }),
  ]);

  type Item = { at: string; icon: string; kind: string; who: string; detail: string; time: string | null; href: string };
  const items: Item[] = [
    ...((sessions ?? []) as unknown as { id: string; session_type: string; scheduled_for: string; focus: string | null; profiles: { full_name: string } | null }[])
      .map(s => ({
        at: s.scheduled_for.slice(0, 10), time: s.scheduled_for,
        icon: "🗓️", kind: TYPE_LABEL[s.session_type] ?? "Session",
        who: s.profiles?.full_name ?? "—", detail: s.focus ?? "", href: "/educator/coaching",
      })),
    ...((interventions ?? []) as unknown as { id: string; review_date: string; competency_name: string | null; profiles: { full_name: string } | null }[])
      .map(i => ({
        at: i.review_date, time: null,
        icon: "🎯", kind: "Intervention review",
        who: i.profiles?.full_name ?? "—", detail: i.competency_name ?? "", href: "/educator/interventions",
      })),
    ...((assessSessions ?? []) as unknown as { id: string; scheduled_for: string; method: string; location: string | null; nurse: { full_name: string } | null }[])
      .map(a => ({
        at: a.scheduled_for.slice(0, 10), time: a.scheduled_for,
        icon: "📝", kind: "Assessment",
        who: (a.nurse as { full_name: string } | null)?.full_name ?? "—",
        detail: `${a.method.replace(/_/g, " ")}${a.location ? ` · ${a.location}` : ""}`, href: "/assessor/calendar",
      })),
  ].sort((a, b) => (a.time ?? a.at).localeCompare(b.time ?? b.at));

  const days = new Map<string, Item[]>();
  for (const it of items) { const l = days.get(it.at) ?? []; l.push(it); days.set(it.at, l); }

  const dayLabel = (key: string) => {
    if (key === todayKey) return "Today";
    if (key === new Date(now.getTime() + 86400000).toISOString().slice(0, 10)) return "Tomorrow";
    return new Date(key + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };

  return (
    <div className="max-w-3xl">
      <EduHeader icon="🤝" title="Meetings & Follow-ups" sub="Your unified agenda — coaching, reviews, validation meetings, intervention reviews and assessment sessions." />
      <StatTiles tiles={[
        { label: "Items (30d)", value: String(items.length) },
        { label: "Today", value: String((days.get(todayKey) ?? []).length) },
        { label: "Intervention Reviews", value: String((interventions ?? []).length), alert: (interventions ?? []).some(i => i.review_date <= todayKey) },
        { label: "Support Sessions", value: String((sessions ?? []).length) },
      ]} />

      {days.size ? (
        <div className="space-y-4">
          {[...days.entries()].map(([key, list]) => (
            <div key={key}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{dayLabel(key)}</p>
              <div className="space-y-1.5">
                {list.map((it, i) => (
                  <Link key={i} href={it.href} className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2 hover:border-purple-200 transition-colors">
                    <span className="text-base">{it.icon}</span>
                    <span className="text-[11px] font-mono text-gray-400 w-12 shrink-0" suppressHydrationWarning>
                      {it.time ? new Date(it.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                    <span className="text-xs font-semibold text-gray-800">{it.who}</span>
                    <span className="text-[10px] text-gray-400 flex-1 truncate">{it.kind}{it.detail ? ` · ${it.detail}` : ""}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card title="Agenda"><p className="text-xs text-gray-400">Nothing scheduled in the next 30 days. Schedule from <Link href="/educator/coaching" className="text-purple-600 hover:underline">Coaching Sessions</Link>.</p></Card>
      )}

      <p className="text-[10px] text-gray-400 mt-4">
        A day-by-day agenda aggregated from real sources — no separate meetings store or drag-drop calendar. Video/room booking isn&apos;t integrated.
      </p>
    </div>
  );
}
