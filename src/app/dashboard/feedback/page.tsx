import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { METHOD_LABELS as METHOD_LABELS_T, OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import FeedbackFeed, { type FeedbackItem } from "./FeedbackFeed";

const METHOD_LABELS = METHOD_LABELS_T as Record<string, string>;

// My Feedback — performance intelligence workspace (My Feedback Workspace
// spec). Aggregates every narrative comment from assessments and skill
// scorings, with strengths/growth analytics from the decision record. Spec
// items with no backing store (feedback requests, acknowledgements, threaded
// comments) are omitted rather than faked; scores are shown on the platform's
// real 0–6 Benner scale, not the mockup's /5.

const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();

export default async function MyFeedbackPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [{ data: cycles }, { data: decisions }, { data: recognitions }, { data: pathwayItems }] = await Promise.all([
    admin.from("competency_cycles").select("id").eq("nurse_id", user.id),
    admin.from("competency_decisions")
      .select("competency_id, outcome, maturity, created_at, framework_competencies(name, framework_domains(name))")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_recognitions")
      .select("title, description, awarded_by_name, awarded_at")
      .eq("nurse_id", user.id).order("awarded_at", { ascending: false }).limit(3),
    admin.from("pathway_items")
      .select("competency_name, reason, resource_title, learning_pathways!inner(nurse_id, status)")
      .eq("learning_pathways.nurse_id", user.id).eq("learning_pathways.status", "active"),
  ]);
  const cycleIds = (cycles ?? []).map(c => c.id);

  const [{ data: assessNotes }, { data: skillNotes }, { data: allScores }] = await Promise.all([
    cycleIds.length
      ? admin.from("assessments")
          .select("id, method, score, notes, assessed_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name)")
          .in("cycle_id", cycleIds).not("notes", "is", null).order("assessed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    cycleIds.length
      ? admin.from("skill_scores")
          .select("id, score, notes, assessed_at, profiles!assessor_id(full_name), competency_skills(name)")
          .in("cycle_id", cycleIds).not("notes", "is", null).order("assessed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    cycleIds.length
      ? admin.from("skill_scores").select("score, assessed_at").in("cycle_id", cycleIds)
      : Promise.resolve({ data: [] }),
  ]);

  // ── Feed items: assessment comments + skill-scoring comments ──
  const items: FeedbackItem[] = [
    ...((assessNotes ?? []) as unknown as { id: string; method: string; score: number | null; notes: string; assessed_at: string | null; profiles: { full_name: string } | null; framework_competencies: { name: string } | null }[])
      .map(c => ({
        id: `a-${c.id}`,
        assessor: c.profiles?.full_name ?? null,
        typeLabel: METHOD_LABELS[c.method] ?? c.method,
        competency: c.framework_competencies?.name ?? null,
        notes: c.notes, score: c.score, at: c.assessed_at,
        positive: c.score === null || c.score >= 3,
      })),
    ...((skillNotes ?? []) as unknown as { id: string; score: number; notes: string; assessed_at: string | null; profiles: { full_name: string } | null; competency_skills: { name: string } | null }[])
      .map(s => ({
        id: `s-${s.id}`,
        assessor: s.profiles?.full_name ?? null,
        typeLabel: "Skill Assessment",
        competency: s.competency_skills?.name ?? null,
        notes: s.notes, score: s.score, at: s.assessed_at,
        positive: s.score >= 3,
      })),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  // ── Strengths & growth from the decision record ──
  const seen = new Set<string>();
  const strengths: { name: string; domain: string; note: string | null }[] = [];
  const growth: { name: string; domain: string; label: string }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    const comp = d.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
    const name = comp?.name ?? "—";
    const domain = comp?.framework_domains?.name ?? "—";
    const oc = OUTCOME_CONFIG[d.outcome as DecisionOutcome];
    if (oc?.passing) {
      strengths.push({ name, domain, note: d.maturity === "proficient" || d.maturity === "expert" ? `${d.maturity} level` : null });
    } else {
      growth.push({ name, domain, label: oc?.label ?? d.outcome });
    }
  }
  const strengthDomains = new Set(strengths.map(s => s.domain)).size;
  const growthDomains = new Set(growth.map(g => g.domain)).size;

  // ── KPIs ──
  const scoredItems = items.filter(i => i.score !== null);
  const avgScore = scoredItems.length
    ? Math.round(scoredItems.reduce((s, i) => s + (i.score as number), 0) / scoredItems.length * 10) / 10 : null;
  const recent30 = items.filter(i => i.at && (nowMs() - new Date(i.at).getTime()) / dayMs <= 30).length;

  // ── Trend: monthly average score across all scorings ──
  const monthly = new Map<string, { sum: number; n: number }>();
  for (const s of allScores ?? []) {
    if (!s.assessed_at) continue;
    const k = s.assessed_at.slice(0, 7);
    const v = monthly.get(k) ?? { sum: 0, n: 0 };
    v.sum += s.score; v.n++;
    monthly.set(k, v);
  }
  const trend = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, v]) => ({ m, avg: v.sum / v.n }));

  // ── Top strengths / focus areas by skill score ──
  const topStrengths = strengths.slice(0, 4);
  const focusAreas = growth.slice(0, 4);

  const card = "bg-white rounded-xl border border-gray-100";

  const KPI = [
    { label: "Overall Feedback Score", value: avgScore !== null ? `${avgScore}` : "—", suffix: avgScore !== null ? "/6" : "", sub: `based on ${scoredItems.length || "no"} scored item${scoredItems.length === 1 ? "" : "s"}`, color: "text-gray-900" },
    { label: "Strengths Identified", value: strengths.length, suffix: "", sub: strengths.length ? `across ${strengthDomains} domain${strengthDomains === 1 ? "" : "s"}` : "appear with passing decisions", color: "text-green-600" },
    { label: "Areas to Grow", value: growth.length, suffix: "", sub: growth.length ? `across ${growthDomains} domain${growthDomains === 1 ? "" : "s"}` : "no open development areas", color: growth.length ? "text-amber-600" : "text-gray-400" },
    { label: "Recent Feedback", value: recent30, suffix: "", sub: "in the last 30 days", color: "text-blue-600" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Feedback</h1>
          <p className="text-gray-400 text-sm mt-0.5">See how your assessors and supervisors rate your performance and guide your growth.</p>
        </div>
        <Link href="/dashboard/assessments"
          className="text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg">
          📝 My Assessments
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}<span className="text-xs text-gray-400 font-normal">{k.suffix}</span></p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
        {/* Feed */}
        <div className="min-w-0 flex flex-col gap-5">
          <FeedbackFeed items={items} />

          {(pathwayItems ?? []).length > 0 && (
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-5">
              <h2 className="text-xs font-bold text-teal-700 uppercase tracking-widest mb-2">📋 Your Action Plan</h2>
              <ul className="flex flex-col gap-1.5">
                {(pathwayItems ?? []).map((p, i) => (
                  <li key={i} className="text-sm text-teal-900">
                    {p.competency_name}: {p.resource_title ? <>complete <b>{p.resource_title}</b></> : "practice with your preceptor"}
                  </li>
                ))}
              </ul>
              <Link href="/dashboard/learning" className="inline-block mt-3 text-sm font-semibold text-teal-700 hover:underline">
                Open my Learning Pathway →
              </Link>
            </div>
          )}

          {(recognitions ?? []).length > 0 && (
            <div className={`${card} p-5`}>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recognition 🏆</h2>
              <div className="flex flex-col gap-2">
                {(recognitions ?? []).map((r, i) => (
                  <div key={i} className="border border-amber-100 rounded-lg px-4 py-3">
                    <p className="text-sm font-medium text-gray-800">{r.title}</p>
                    {r.description && <p className="text-[11px] text-gray-500 mt-0.5">{r.description}</p>}
                    <p className="text-[10px] text-gray-400 mt-1" suppressHydrationWarning>{r.awarded_by_name} · {new Date(r.awarded_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Analytics rail */}
        <div className="flex flex-col gap-5">
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-2">Feedback Trends</h2>
            {trend.length > 1 ? (
              <>
                <svg viewBox="0 0 240 70" className="w-full h-20">
                  {(() => {
                    const pts = trend.map((t, i) => `${(i / (trend.length - 1)) * 225 + 8},${62 - (t.avg / 6) * 52}`);
                    return (
                      <>
                        <polyline points={pts.join(" ")} fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
                        {pts.map(p => { const [x, y] = p.split(","); return <circle key={p} cx={x} cy={y} r="3" fill="#16a34a" />; })}
                      </>
                    );
                  })()}
                </svg>
                <div className="flex justify-between text-[9px] text-gray-400">
                  <span>{trend[0].m}</span><span>avg score /6</span><span>{trend[trend.length - 1].m}</span>
                </div>
              </>
            ) : <p className="text-xs text-gray-400 text-center py-4">Trends appear as scores accumulate over months. 📈</p>}
          </div>

          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">🏆 Top Strengths</h2>
              <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline">View all</Link>
            </div>
            {topStrengths.length ? topStrengths.map(s => (
              <div key={s.name} className="py-1.5 border-b border-gray-50 last:border-0">
                <p className="text-[11px] text-gray-700">✅ {s.name}{s.note && <span className="ml-1.5 text-[9px] font-bold text-violet-600 capitalize">{s.note}</span>}</p>
                <p className="text-[9px] text-gray-400">{s.domain}</p>
              </div>
            )) : <p className="text-xs text-gray-400 text-center py-3">Strengths appear with passing decisions. 💪</p>}
          </div>

          <div className="bg-amber-50/60 rounded-xl border border-amber-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">🎯 Focus Areas</h2>
              <Link href="/dashboard/learning" className="text-xs text-teal-700 hover:underline">View all</Link>
            </div>
            {focusAreas.length ? focusAreas.map(g => (
              <div key={g.name} className="flex items-center gap-2 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <p className="text-[11px] text-gray-700 flex-1 truncate">{g.name}</p>
                <span className="text-[9px] font-bold text-amber-700 shrink-0">{g.label}</span>
              </div>
            )) : <p className="text-xs text-gray-500 text-center py-3">No open development areas. ✅</p>}
          </div>

          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-1.5">💡 Tips for Growth</h2>
            <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
              {growth.length
                ? "Your pathway targets your open areas — small, regular practice closes gaps fastest."
                : "Keep seeking feedback regularly. Small improvements lead to big results."}
            </p>
            <Link href="/dashboard/learning"
              className="block text-center text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 py-2 rounded-lg">
              View Learning Resources
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
