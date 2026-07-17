import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG } from "@/lib/ckcm";
import { aiStatus } from "@/lib/ai/config";
import CoachPanel from "./CoachPanel";
import LearningWorkspace, { type PathwayItem } from "./LearningWorkspace";

// My Learning Pathway — competency-first development workspace (Volume 5
// spec). Every recommendation originates from the decision record and shows
// its reason; progress is toward competency, not course completion. Widgets
// without backing data (streaks, goals, weekly calendar) are omitted.

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];
const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

const JOURNEY = ["📝 Assessment", "📚 Learning", "🧪 Simulation", "🏥 Clinical Practice", "🛡️ Validation", "✅ Competent", "🪪 Passport Updated"];

export default async function LearningPathwayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [
    { data: pathway }, { data: decisions }, { data: compScores },
    { data: skillScores }, { data: attempts }, { data: cpdLogs },
  ] = await Promise.all([
    admin.from("learning_pathways").select("id, title, status, generated_at")
      .eq("nurse_id", user.id).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("competency_decisions")
      .select("competency_id, outcome, expiry_date, created_at, framework_competencies(name, framework_domains(name))")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("competency_scores")
      .select("competency_id, score, assessed_at, framework_competencies(framework_domains(name))")
      .eq("nurse_id", user.id).order("assessed_at", { ascending: false }),
    admin.from("skill_scores")
      .select("skill_id, score, competency_skills(name), competency_cycles!inner(nurse_id)")
      .eq("competency_cycles.nurse_id", user.id).order("assessed_at", { ascending: false }).limit(100),
    admin.from("knowledge_attempts")
      .select("bank_id, score, passed, completed_at, question_banks(name)")
      .eq("nurse_id", user.id).order("completed_at", { ascending: false }).limit(20),
    admin.from("cpd_logs").select("hours").eq("user_id", user.id),
  ]);

  const { data: rawItems } = pathway
    ? await admin.from("pathway_items")
        .select("id, competency_name, reason, resource_title, resource_type, status, sort_order")
        .eq("pathway_id", pathway.id).order("sort_order")
    : { data: [] as PathwayItem[] };
  const items = (rawItems ?? []) as PathwayItem[];

  // ── Readiness from the governed record ──
  const seen = new Set<string>();
  let assessed = 0, current = 0;
  const upcoming: { name: string; domain: string; expiry: string; days: number }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    assessed++;
    const comp = d.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
    const expired = d.expiry_date && new Date(d.expiry_date).getTime() < nowMs();
    if (OUTCOME_CONFIG[d.outcome as keyof typeof OUTCOME_CONFIG]?.passing && !expired) {
      current++;
      if (d.expiry_date) {
        const days = Math.ceil((new Date(d.expiry_date).getTime() - nowMs()) / dayMs);
        if (days <= 120) upcoming.push({ name: comp?.name ?? "Competency", domain: comp?.framework_domains?.name ?? "—", expiry: d.expiry_date, days });
      }
    }
  }
  upcoming.sort((a, b) => a.days - b.days);
  const readiness = assessed ? Math.round((current / assessed) * 100) : 0;

  const done = items.filter(i => i.status === "completed").length;
  const inProgress = items.filter(i => i.status === "in_progress").length;
  const highPriority = items.filter(i => i.status !== "completed" && /expir|critical|remediat|not yet/i.test(i.reason ?? "")).length;

  // ── Domain progress (best score per competency) ──
  const bestSeen = new Set<string>();
  const byDomain = new Map<string, { sum: number; n: number }>();
  for (const cs of compScores ?? []) {
    if (bestSeen.has(cs.competency_id)) continue;
    bestSeen.add(cs.competency_id);
    const dom = (cs.framework_competencies as unknown as { framework_domains: { name: string } | null } | null)?.framework_domains?.name ?? "—";
    const v = byDomain.get(dom) ?? { sum: 0, n: 0 };
    v.sum += cs.score; v.n++;
    byDomain.set(dom, v);
  }
  const domains = [...byDomain.entries()]
    .map(([name, v]) => ({ name, avg: v.sum / v.n, pct: Math.round((v.sum / v.n / 6) * 100) }))
    .sort((a, b) => a.pct - b.pct);

  // ── Clinical practice suggestions: weakest scored skills (spec §7) ──
  const skillBest = new Map<string, { name: string; best: number }>();
  for (const s of (skillScores ?? []) as unknown as { skill_id: string; score: number; competency_skills: { name: string } | null }[]) {
    const cur = skillBest.get(s.skill_id);
    if (!cur || s.score > cur.best) skillBest.set(s.skill_id, { name: s.competency_skills?.name ?? "Skill", best: s.score });
  }
  const practice = [...skillBest.values()].filter(s => s.best < 3).sort((a, b) => a.best - b.best).slice(0, 4);

  // ── Recently completed (items + passed quizzes) ──
  const recent = [
    ...items.filter(i => i.status === "completed").map(i => ({ icon: "✅", text: i.resource_title ?? i.competency_name ?? "Pathway item", at: null as string | null })),
    ...((attempts ?? []) as unknown as { passed: boolean; score: number; completed_at: string; question_banks: { name: string } | null }[])
      .filter(a => a.passed)
      .map(a => ({ icon: "❓", text: `${a.question_banks?.name ?? "Knowledge test"} — ${a.score}%`, at: a.completed_at })),
  ].slice(0, 5);

  // ── Analytics (spec §8) — only measures the data supports ──
  const quizAvg = (attempts ?? []).length
    ? Math.round((attempts ?? []).reduce((s, a) => s + a.score, 0) / (attempts ?? []).length) : null;
  const totalScores = [...byDomain.values()].reduce((s, v) => s + v.n, 0);
  const scoreAvg = totalScores
    ? Math.round([...byDomain.values()].reduce((s, v) => s + v.sum, 0) / totalScores * 10) / 10
    : null;
  const cpdHours = (cpdLogs ?? []).reduce((s, l) => s + Number(l.hours), 0);

  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard" className="hover:text-gray-600">Dashboard</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Learning Pathway</span>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">My Learning Pathway</h1>
        <p className="text-gray-400 text-sm mt-0.5">Personalised from your competency decisions — targeted at your current gaps.</p>
      </div>

      {/* Readiness header (spec §2) */}
      <div className={`${card} p-5 mb-5`}>
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="flex-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Overall competency readiness</p>
            <p className="text-4xl font-extrabold text-gray-900 mt-1">{readiness}%</p>
            <p className="text-[10px] text-gray-400">{assessed ? `${current} of ${assessed} assessed competencies current` : "no assessed competencies yet"}</p>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mt-2 max-w-sm">
              <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(readiness, 2)}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              [done, "Complete", "text-green-600"],
              [inProgress, "In progress", "text-blue-600"],
              [highPriority, "High priority", highPriority ? "text-red-500" : "text-gray-400"],
            ].map(([v, l, c]) => (
              <div key={l as string} className="bg-gray-50/70 rounded-lg px-4 py-2.5">
                <p className={`text-xl font-bold ${c}`}>{v}</p>
                <p className="text-[9px] text-gray-400">{l}</p>
              </div>
            ))}
          </div>
        </div>
        {/* Learning journey (spec §4) */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-4 border-t border-gray-50">
          {JOURNEY.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-gray-500 bg-gray-50 rounded-full px-2.5 py-1">{step}</span>
              {i < JOURNEY.length - 1 && <span className="text-gray-300 text-[10px]">→</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          <LearningWorkspace items={items} />

          {/* Clinical practice suggestions (spec §7) */}
          {practice.length > 0 && (
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm">Clinical Practice Suggestions</h2>
                <Link href="/dashboard/logbook" className="text-xs text-teal-600 hover:underline">Skills Logbook →</Link>
              </div>
              <p className="text-[10px] text-gray-400 mb-3">Skills scored below Competent — practise these under supervision; new scores update your logbook and passport.</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {practice.map(s => (
                  <div key={s.name} className="flex items-center gap-2.5 border border-gray-100 rounded-lg px-3 py-2">
                    <span className="w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0"
                      style={{ backgroundColor: SCORE_COLORS[s.best] ?? "#9ca3af" }}>{s.best}</span>
                    <span className="text-xs text-gray-700">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Clinical Coach (spec §9) */}
          {aiStatus().configured && <CoachPanel />}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5">
          {/* Domain progress (spec §5) */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Progress by Domain</h2>
              <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline">Passport →</Link>
            </div>
            {domains.length ? domains.map(d => (
              <div key={d.name} className="flex items-center gap-2.5 py-1.5">
                <span className="text-[11px] text-gray-700 w-28 truncate">{d.name}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${d.pct}%`, backgroundColor: SCORE_COLORS[Math.round(d.avg)] ?? "#9ca3af" }} />
                </div>
                <span className="text-[10px] font-bold text-gray-600 w-8 text-right">{d.pct}%</span>
              </div>
            )) : <p className="text-xs text-gray-400 text-center py-4">Populates as assessors score you. 📊</p>}
          </div>

          {/* Upcoming renewals (spec §2 timeline) */}
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Upcoming Renewals</h2>
            {upcoming.length ? upcoming.slice(0, 4).map(u => (
              <div key={u.name} className="flex items-center gap-2.5 py-1.5 border-b border-gray-50 last:border-0">
                <div className="w-10 text-center bg-gray-50 rounded-lg py-1 shrink-0">
                  <p className="text-[8px] font-bold text-teal-600 uppercase">{new Date(u.expiry).toLocaleDateString(undefined, { month: "short" })}</p>
                  <p className="text-xs font-bold text-gray-800">{new Date(u.expiry).getDate()}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-gray-800 truncate">{u.name}</p>
                  <p className="text-[9px] text-gray-400">{u.domain}</p>
                </div>
                <span className={`text-[9px] font-bold shrink-0 ${u.days <= 30 ? "text-red-500" : "text-amber-600"}`}>{u.days}d</span>
              </div>
            )) : <p className="text-xs text-gray-400 text-center py-4">Nothing due within 120 days. ✅</p>}
          </div>

          {/* Recently completed */}
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Recently Completed</h2>
            {recent.length ? recent.map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs">{r.icon}</span>
                <p className="text-[11px] text-gray-700 flex-1 truncate">{r.text}</p>
                {r.at && <span className="text-[9px] text-gray-400 shrink-0" suppressHydrationWarning>{fmt(r.at)}</span>}
              </div>
            )) : <p className="text-xs text-gray-400 text-center py-4">Completed learning appears here. 🎓</p>}
          </div>

          {/* Analytics (spec §8) */}
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Your Numbers</h2>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                [quizAvg !== null ? `${quizAvg}%` : "—", "Avg quiz score"],
                [scoreAvg !== null ? `${scoreAvg}/6` : "—", "Avg assessment"],
                [cpdHours || "—", "CPD hours"],
                [`${done}/${items.length || "—"}`, "Pathway items"],
              ].map(([v, l]) => (
                <div key={l as string} className="bg-gray-50/70 rounded-lg py-2.5">
                  <p className="text-base font-bold text-gray-900">{v}</p>
                  <p className="text-[9px] text-gray-400">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
