import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// CPD & Courses — course library with live enrolment/completion figures plus
// the hospital's real CPD picture from learner-logged hours. Uses the admin
// client (the old user-scoped reads returned empty under RLS). Course
// authoring has no builder yet and is stated as such.

export const dynamic = "force-dynamic";

export default async function CpdCoursesPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const yearStart = `${new Date().toISOString().slice(0, 4)}-01-01`;

  const [{ data: courses }, { data: enrollments }, { data: nurses }] = await Promise.all([
    admin.from("courses")
      .select("id, title, description, category, level, duration_hours, cpd_points, is_published, created_at")
      .order("created_at", { ascending: false }),
    admin.from("course_enrollments").select("course_id, completed_at"),
    hospitalId ? admin.from("profiles").select("id").eq("hospital_id", hospitalId).eq("role", "nurse") : Promise.resolve({ data: [] }),
  ]);
  const nurseIds = (nurses ?? []).map(n => n.id);
  const { data: cpdRows } = nurseIds.length
    ? await admin.from("cpd_logs").select("hours, activity_type, activity_date, user_id").in("user_id", nurseIds).gte("activity_date", yearStart).limit(3000)
    : { data: [] };

  const rows = (courses ?? []).map(c => {
    const enrolled = (enrollments ?? []).filter(e => e.course_id === c.id).length;
    const completed = (enrollments ?? []).filter(e => e.course_id === c.id && e.completed_at).length;
    return { ...c, enrolled, completed };
  });

  const levelColors: Record<string, string> = {
    beginner: "bg-green-100 text-green-700",
    intermediate: "bg-amber-100 text-amber-700",
    advanced: "bg-red-100 text-red-700",
  };

  const cpd = (cpdRows ?? []) as { hours: number; activity_type: string; activity_date: string; user_id: string }[];
  const monthHours = Math.round(cpd.filter(r => r.activity_date >= monthStart).reduce((s, r) => s + Number(r.hours), 0) * 10) / 10;
  const yearHours = Math.round(cpd.reduce((s, r) => s + Number(r.hours), 0) * 10) / 10;
  const activeLoggers = new Set(cpd.map(r => r.user_id)).size;
  const byType = new Map<string, number>();
  for (const r of cpd) byType.set(r.activity_type, (byType.get(r.activity_type) ?? 0) + Number(r.hours));
  const topTypes = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <div className="max-w-5xl">
      <EduHeader icon="📚" title="CPD & Courses" sub="Continuing education — the course library and the hospital's live CPD hours." />
      <StatTiles tiles={[
        { label: "Courses", value: String(rows.length), sub: `${rows.filter(r => r.is_published).length} published` },
        { label: "CPD Hours (Month)", value: String(monthHours), sub: "logged by learners" },
        { label: "CPD Hours (Year)", value: String(yearHours) },
        { label: "Learners Logging CPD", value: String(activeLoggers), sub: "this year" },
      ]} />

      {topTypes.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mr-1">CPD by type (year)</span>
          {topTypes.map(([t, h]) => (
            <span key={t} className="text-[10px] text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2.5 py-1 capitalize">
              {t.replace(/_/g, " ")} · {Math.round(h * 10) / 10}h
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">📚</p>
          <p className="text-gray-500 text-sm font-medium">No courses yet</p>
          <p className="text-gray-400 text-xs mt-1">A course builder isn&apos;t built — courses arrive via import until it gets its own spec.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Course</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Level</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Duration</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">CPD Pts</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Enrolled</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Completed</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900">{c.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{c.category}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${levelColors[c.level] ?? "bg-gray-100 text-gray-600"}`}>{c.level}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.duration_hours}h</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.cpd_points}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.enrolled}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.completed}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.is_published ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {c.is_published ? "Published" : "Draft"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-gray-400 mt-4">
        CPD hours are learner-logged with duplicate protection and count against the organisation&apos;s configurable annual target.
        Course authoring and enrolment management need their own builder — not simulated.
      </p>
    </div>
  );
}
