import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, passRateOf, avgScoreOf } from "@/lib/analytics";
import { StatTiles, Card, PctChip } from "@/app/assessor/reports/ui";

// Teach & Assess hub — the educator's operational home: live KPIs, module
// grid, upcoming assessment schedule, to-do panel and learner progress.
// Class/lesson scheduling has no backing store yet: the schedule shown is the
// real assessment-session calendar, and class modules are marked soon.

export const dynamic = "force-dynamic";

export default async function TeachAndAssessPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().getTime();
  const nowIso = new Date(now).toISOString();
  const in7 = new Date(now + 7 * 86400000).toISOString();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const nurseIds = ctx.nurses.map(n => n.id);

  const [{ count: resourceCount }, { count: questionCount }, { data: cpdRows }, { count: pendingScores }, { data: openAppeals }, { data: upcoming }] = await Promise.all([
    admin.from("learning_resources").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("questions").select("id", { count: "exact", head: true }).not("bank_id", "is", null),
    nurseIds.length
      ? admin.from("cpd_logs").select("hours, user_id").in("user_id", nurseIds).gte("activity_date", monthStart)
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("competency_scores").select("id", { count: "exact", head: true }).eq("educator_validated", false).in("nurse_id", nurseIds)
      : Promise.resolve({ count: 0 }),
    hospitalId
      ? admin.from("appeals").select("id").eq("hospital_id", hospitalId).in("status", ["open", "under_review"])
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("scheduled_assessments")
          .select("scheduled_for, method, location, status, nurse:profiles!nurse_id(full_name), assessor:profiles!assessor_id(full_name)")
          .eq("hospital_id", hospitalId).eq("status", "scheduled")
          .gte("scheduled_for", nowIso).lte("scheduled_for", in7)
          .order("scheduled_for").limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  const cur30 = ctx.assess.filter(a => a.assessed_at >= d30);
  const cpdHours = Math.round(((cpdRows ?? []) as { hours: number }[]).reduce((s, r) => s + Number(r.hours), 0) * 10) / 10;
  const pendingEvidence = ctx.entries.filter(e => e.status === "pending").length;
  const escalated = ctx.entries.filter(e => e.status === "escalated").length;

  // Learner progress: latest-decision pass% per learner, top 5 by volume.
  const byNurse = new Map<string, { pass: number; total: number }>();
  for (const d of ctx.latest) {
    const v = byNurse.get(d.nurse_id) ?? { pass: 0, total: 0 };
    v.total++;
    if (d.passing && !d.expired) v.pass++;
    byNurse.set(d.nurse_id, v);
  }
  const progress = ctx.nurses
    .map(n => ({ ...n, ...(byNurse.get(n.id) ?? { pass: 0, total: 0 }) }))
    .filter(n => n.total > 0)
    .sort((a, b) => b.total - a.total).slice(0, 5)
    .map(n => ({ ...n, pct: Math.round(n.pass / n.total * 100) }));

  const MODULES: { icon: string; name: string; desc: string; href?: string; soon?: boolean }[] = [
    { icon: "👥", name: "My Classes", desc: "Class and cohort management needs a class store.", soon: true },
    { icon: "📅", name: "Lesson Planner", desc: "Lesson plans and objectives need a planning store.", soon: true },
    { icon: "✍️", name: "Assessment Builder", desc: "Governed knowledge tests with pass marks and validity.", href: "/educator/questions" },
    { icon: "📮", name: "Assignments", desc: "Submission tracking needs an assignment store.", soon: true },
    { icon: "❓", name: "Question Bank", desc: "Reusable MCQ banks delivered by the quiz engine.", href: "/educator/questions" },
    { icon: "⚖️", name: "Rubric Library", desc: "The governed Benner scale and scoring methods.", href: "/assessor/studio/rubrics" },
    { icon: "🗳️", name: "Grading & Feedback", desc: "Validate scores and give structured feedback.", href: "/educator/validations" },
    { icon: "🧪", name: "Simulation Scenarios", desc: "Curated briefs, governed cases and the AI designer.", href: "/educator/simulation" },
    { icon: "🗂️", name: "Learning Resources", desc: "Governed resources mapped to competencies.", href: "/educator/library" },
    { icon: "🧩", name: "Competency Mapping", desc: "Resource ↔ competency links power learning pathways.", href: "/educator/library" },
    { icon: "📚", name: "CPD & Courses", desc: "Courses, enrolments and CPD hours.", href: "/educator/courses" },
    { icon: "📐", name: "Teach & Assess Analytics", desc: "Validation and outcome analytics.", href: "/educator/validation-analytics" },
  ];

  const TODO = [
    { icon: "✅", label: "Scores pending validation", n: pendingScores ?? 0, href: "/educator/validations" },
    { icon: "🖇️", label: "Evidence awaiting review", n: pendingEvidence, href: "/educator/evidence" },
    { icon: "⬆️", label: "Open escalations", n: escalated, href: "/educator/escalations" },
    { icon: "⚖️", label: "Appeals to moderate", n: (openAppeals ?? []).length, href: "/educator/moderation" },
  ].filter(t => t.n > 0);

  return (
    <div className="max-w-[1100px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Teach &amp; Assess 📚</h1>
        <p className="text-gray-400 text-sm mt-0.5">Plan learning, create assessments and evaluate learner competency — every figure below is live.</p>
      </div>

      <StatTiles cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" tiles={[
        { label: "Active Learners", value: String(ctx.nurses.length) },
        { label: "Assessments (30d)", value: String(cur30.length), sub: `pass ${passRateOf(cur30) ?? "—"}%` },
        { label: "Avg Assessment Score", value: avgScoreOf(cur30) != null ? `${avgScoreOf(cur30)}` : "—", sub: "Benner 0–6, 30d" },
        { label: "Learning Resources", value: String(resourceCount ?? 0), sub: "active, governed" },
        { label: "CPD Hours (Month)", value: String(cpdHours), sub: "logged by learners" },
        { label: "Question Bank", value: String(questionCount ?? 0), sub: "governed MCQs" },
      ]} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_290px] gap-4 mb-4">
        <Card title="Teach & Assess Modules">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {MODULES.map(m => m.soon ? (
              <div key={m.name} className="border border-gray-100 rounded-lg px-3 py-2.5 opacity-60 select-none">
                <p className="text-xs font-semibold text-gray-500">{m.icon} {m.name} <span className="text-[8px] font-bold uppercase bg-gray-100 text-gray-400 rounded px-1 py-0.5 ml-1">soon</span></p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</p>
              </div>
            ) : (
              <Link key={m.name} href={m.href!} className="border border-gray-100 rounded-lg px-3 py-2.5 hover:border-purple-300 transition-colors">
                <p className="text-xs font-semibold text-gray-800">{m.icon} {m.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{m.desc}</p>
              </Link>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Assessment Schedule" sub="next 7 days — real sessions">
            {(upcoming ?? []).length ? (
              <div className="space-y-1.5">
                {(upcoming ?? []).map((s, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <p className="text-[11px] font-semibold text-gray-800">{(s.nurse as unknown as { full_name: string } | null)?.full_name ?? "—"}</p>
                    <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                      {new Date(s.scheduled_for).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {s.method.replace(/_/g, " ")}
                      {s.location ? ` · ${s.location}` : ""} · {(s.assessor as unknown as { full_name: string } | null)?.full_name ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">No sessions in the next 7 days.</p>}
            <p className="text-[9px] text-gray-400 mt-2">Class/lesson scheduling isn&apos;t built — this is the live assessment-session calendar.</p>
          </Card>

          <Card title="To Do / Action Required">
            {TODO.length ? (
              <div className="space-y-1.5">
                {TODO.map(t => (
                  <Link key={t.label} href={t.href} className="flex items-center gap-2 text-[11px] text-gray-700 hover:text-purple-700">
                    <span>{t.icon}</span><span className="flex-1">{t.label}</span>
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 rounded-full px-1.5 py-0.5">{t.n}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">Nothing pending. ✅</p>}
          </Card>

          <Card title="Learner Progress Overview" sub="pass rate from latest decisions">
            {progress.length ? (
              <div className="space-y-2">
                {progress.map(p => (
                  <div key={p.id}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="text-gray-700 truncate">{p.name}</span>
                      <PctChip v={p.pct} />
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${p.pct >= 80 ? "bg-green-500" : p.pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${p.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">No decided competencies yet.</p>}
            <Link href="/educator/students" className="mt-2 inline-block text-[11px] font-semibold text-purple-600 hover:underline">View all learners →</Link>
          </Card>
        </div>
      </div>

      <p className="text-[10px] text-gray-400">
        Honest scope: My Classes, Lesson Planner and Assignments need class/lesson stores and their own specs — marked soon, not simulated.
        Everything else on this page reads live records.
      </p>
    </div>
  );
}
