import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";

// Object Analytics / Reuse & Dependencies (Education Studio) — real usage of
// content objects across the platform: which competencies drive passports
// (decisions), which courses have enrolments, which resources are linked.

export const dynamic = "force-dynamic";

export default async function ObjectAnalyticsPage() {
  const { admin } = await requireEducatorAccess();

  const [{ data: decisions }, { data: courses }, { data: enrollments }, { data: resLinks }, { data: comps }, { data: qAttempts }, { data: banks }] = await Promise.all([
    admin.from("competency_decisions").select("competency_id, framework_competencies!competency_id(name)").limit(4000),
    admin.from("courses").select("id, title, is_published"),
    admin.from("course_enrollments").select("course_id, completed_at"),
    admin.from("resource_competencies").select("resource_id, learning_resources(title)"),
    admin.from("framework_competencies").select("id, name"),
    admin.from("knowledge_attempts").select("bank_id, passed"),
    admin.from("question_banks").select("id, name").eq("is_active", true),
  ]);

  // Top competencies by passport usage (decision count)
  const compUse = new Map<string, { name: string; n: number }>();
  for (const d of decisions ?? []) {
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const cur = compUse.get(d.competency_id) ?? { name, n: 0 };
    cur.n++; compUse.set(d.competency_id, cur);
  }
  const topComps = [...compUse.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  const usedComps = compUse.size;
  const totalComps = (comps ?? []).length;

  // Courses by enrolment
  const courseRows = (courses ?? []).map(c => {
    const enr = (enrollments ?? []).filter(e => e.course_id === c.id);
    return { title: c.title, enrolled: enr.length, completed: enr.filter(e => e.completed_at).length, published: c.is_published };
  }).sort((a, b) => b.enrolled - a.enrolled).slice(0, 6);

  // Resources by link count
  const resUse = new Map<string, { title: string; n: number }>();
  for (const r of resLinks ?? []) {
    const title = (r.learning_resources as unknown as { title: string } | null)?.title ?? "Resource";
    const cur = resUse.get(r.resource_id) ?? { title, n: 0 };
    cur.n++; resUse.set(r.resource_id, cur);
  }
  const topRes = [...resUse.values()].sort((a, b) => b.n - a.n).slice(0, 5);

  // Question banks by attempts
  const bankUse = new Map<string, number>();
  for (const a of qAttempts ?? []) if (a.bank_id) bankUse.set(a.bank_id, (bankUse.get(a.bank_id) ?? 0) + 1);
  const bankRows = (banks ?? []).map(b => ({ name: b.name, attempts: bankUse.get(b.id) ?? 0 })).sort((a, b) => b.attempts - a.attempts).slice(0, 5);

  return (
    <div className="max-w-4xl">
      <Link href="/educator/studio/cko" className="text-xs text-gray-400 hover:text-gray-600">← CKO & CPU Studio</Link>
      <div className="mt-1"><EduHeader icon="📈" title="Object Analytics" sub="How content objects are actually used across the platform — passports, enrolments, links and attempts." /></div>
      <StatTiles tiles={[
        { label: "Competencies In Use", value: `${usedComps}/${totalComps}`, sub: "drive passport decisions" },
        { label: "Course Enrolments", value: String((enrollments ?? []).length) },
        { label: "Resource Links", value: String((resLinks ?? []).length) },
        { label: "Knowledge Attempts", value: String((qAttempts ?? []).length) },
      ]} />

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Top Competencies by Usage" sub="passport decisions issued">
          {topComps.length ? topComps.map(c => (
            <div key={c.name} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1 truncate">{c.name}</span>
              <span className="text-[10px] font-bold bg-purple-50 text-purple-700 rounded px-1.5 py-0.5">{c.n}</span>
            </div>
          )) : <p className="text-xs text-gray-400">No decisions yet.</p>}
        </Card>
        <Card title="Courses by Enrolment">
          {courseRows.length ? courseRows.map(c => (
            <div key={c.title} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1 truncate">{c.title}</span>
              <span className="text-gray-400">{c.completed}/{c.enrolled} done</span>
              {!c.published && <span className="text-[8px] text-amber-600">draft</span>}
            </div>
          )) : <p className="text-xs text-gray-400">No courses.</p>}
        </Card>
        <Card title="Most-Linked Resources" sub="reused across competencies">
          {topRes.length ? topRes.map(r => (
            <div key={r.title} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1 truncate">{r.title}</span>
              <span className="text-[10px] font-bold bg-teal-50 text-teal-700 rounded px-1.5 py-0.5">{r.n} links</span>
            </div>
          )) : <p className="text-xs text-gray-400">No resource links yet.</p>}
        </Card>
        <Card title="Question Banks by Attempts">
          {bankRows.length ? bankRows.map(b => (
            <div key={b.name} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1 truncate">{b.name}</span>
              <span className="text-gray-400">{b.attempts} attempts</span>
            </div>
          )) : <p className="text-xs text-gray-400">No banks yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Reliability and discrimination indices need larger attempt volumes; per-object OSCE/simulation outcome analytics live in the assessor
        <Link href="/educator/validation-analytics" className="text-purple-600 hover:underline"> Validation Analytics</Link>. Every figure here is a live count.
      </p>
    </div>
  );
}
