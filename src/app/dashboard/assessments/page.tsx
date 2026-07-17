import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { METHOD_LABELS as METHOD_LABELS_T, OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import AssessmentCentre, { type CentreRow } from "./AssessmentCentre";

const METHOD_LABELS = METHOD_LABELS_T as Record<string, string>;

// Assessment Centre — the worker's assessment command centre (Assessment
// Workspace Redesign v2). Knowledge tests, assessor-led assessments,
// reassessment deadlines, workplace tracker, domain radar and analytics —
// all from the governed record. Spec items with no backing (booking,
// difficulty levels, attempt limits, certificates-per-assessment) are omitted.

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];
const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

const CATEGORY_FOR: Record<string, CentreRow["category"]> = {
  knowledge: "knowledge",
  skills_checklist: "practical", osce: "practical", direct_observation: "practical",
  peer: "workplace", supervisor: "workplace", portfolio: "workplace",
  concurrent_audit: "workplace", retrospective_audit: "workplace", interview: "workplace",
  simulation: "simulation",
  self: "self",
};

function Radar({ axes }: { axes: { label: string; pct: number }[] }) {
  const n = axes.length, cx = 90, cy = 80, r = 55;
  const pt = (i: number, scale: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale] as const;
  };
  const ring = (scale: number) => axes.map((_, i) => pt(i, scale).join(",")).join(" ");
  return (
    <svg viewBox="0 0 180 170" className="w-full">
      {[0.33, 0.66, 1].map(s => (
        <polygon key={s} points={ring(s)} fill="none" stroke="#f3f4f6" strokeWidth="1" />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#f3f4f6" strokeWidth="1" />;
      })}
      <polygon points={axes.map((a, i) => pt(i, Math.max(a.pct / 100, 0.04)).join(",")).join(" ")}
        fill="rgba(13,148,136,0.15)" stroke="#0d9488" strokeWidth="1.5" />
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1.22);
        return (
          <text key={a.label} x={x} y={y} textAnchor="middle" fontSize="7" fill="#6b7280">
            {a.label.length > 14 ? a.label.slice(0, 13) + "…" : a.label}
          </text>
        );
      })}
    </svg>
  );
}

export default async function AssessmentCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [{ data: cycles }, { data: decisions }, { data: banks }, { data: kAttempts }, { data: compScores }] = await Promise.all([
    admin.from("competency_cycles").select("id").eq("nurse_id", user.id),
    admin.from("competency_decisions")
      .select("competency_id, outcome, validation_outcome, expiry_date, created_at, framework_competencies(name, framework_domains(name))")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("question_banks")
      .select("id, name, pass_mark, questions(id), clinical_practice_units(name, practices(name))")
      .eq("is_active", true).order("name"),
    admin.from("knowledge_attempts").select("bank_id, score, passed, completed_at")
      .eq("nurse_id", user.id).order("completed_at", { ascending: false }),
    admin.from("competency_scores")
      .select("competency_id, score, framework_competencies(framework_domains(name))")
      .eq("nurse_id", user.id).order("assessed_at", { ascending: false }),
  ]);
  const cycleIds = (cycles ?? []).map(c => c.id);

  const { data: assessments } = cycleIds.length
    ? await admin.from("assessments")
        .select("id, method, status, score, notes, assessed_at, created_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name, framework_domains(name))")
        .in("cycle_id", cycleIds).order("created_at", { ascending: false })
    : { data: [] };

  const compName = (a: { framework_competencies: unknown }) =>
    (a.framework_competencies as { name: string; framework_domains?: { name: string } | null } | null);
  const assessorName = (a: { profiles: unknown }) =>
    (a.profiles as { full_name: string } | null)?.full_name ?? null;

  // ── Latest decision per competency (tracker + validated KPI + renewals) ──
  const seen = new Set<string>();
  type Latest = { name: string; validated: boolean; passing: boolean; expiry: string | null; days: number | null };
  const latest: Latest[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    const days = d.expiry_date ? Math.ceil((new Date(d.expiry_date).getTime() - nowMs()) / dayMs) : null;
    latest.push({
      name: compName(d)?.name ?? "Competency",
      validated: d.validation_outcome === "validated",
      passing: !!OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing,
      expiry: d.expiry_date, days,
    });
  }
  const validatedCount = latest.filter(l => l.validated).length;
  const upcoming = latest.filter(l => l.days !== null && l.days <= 120).sort((a, b) => (a.days! - b.days!));
  const now = new Date(nowMs());
  const dueThisMonth = latest.filter(l => l.expiry
    && new Date(l.expiry).getMonth() === now.getMonth()
    && new Date(l.expiry).getFullYear() === now.getFullYear()).length;
  const overdueCount = latest.filter(l => l.days !== null && l.days < 0).length;

  // ── Unified rows ──
  const bestAttempt = new Map<string, { score: number; passed: boolean }>();
  for (const a of kAttempts ?? []) {
    const b = bestAttempt.get(a.bank_id);
    if (!b || Number(a.score) > b.score) bestAttempt.set(a.bank_id, { score: Number(a.score), passed: a.passed });
  }
  const bankRows: CentreRow[] = ((banks ?? []) as unknown as {
    id: string; name: string; pass_mark: number; questions: { id: string }[];
    clinical_practice_units: { name: string; practices: { name: string } | null } | null;
  }[]).map(b => {
    const at = bestAttempt.get(b.id);
    return {
      id: `bank-${b.id}`, category: "knowledge",
      title: b.name, typeLabel: "Knowledge Test",
      cpu: b.clinical_practice_units?.name ?? null,
      domain: b.clinical_practice_units?.practices?.name ?? null,
      meta: `${b.questions.length} questions · pass ${b.pass_mark}%`,
      due: null,
      status: at ? (at.passed ? "validated" : "retake") : "ready",
      score: at ? `${at.score}%` : null,
      href: `/dashboard/tests/${b.id}`,
      action: at?.passed ? "Retake" : at ? "Try again" : "Start",
    };
  });
  const assessorRows: CentreRow[] = (assessments ?? []).map(a => ({
    id: `as-${a.id}`,
    category: CATEGORY_FOR[a.method] ?? "workplace",
    title: compName(a)?.name ?? "Assessment",
    typeLabel: METHOD_LABELS[a.method] ?? a.method,
    cpu: null,
    domain: compName(a)?.framework_domains?.name ?? null,
    meta: assessorName(a) ? `Assessor: ${assessorName(a)}` : "Assessor-led",
    due: null,
    status: a.status === "validated" ? "validated"
      : a.status === "complete" ? "completed"
      : a.status === "in_progress" ? "in_progress" : "awaiting_review",
    score: a.score != null ? `${a.score}/6` : null,
    href: null, action: null,
  }));
  const rows = [...bankRows, ...assessorRows];

  const doneRows = rows.filter(r => r.status === "completed" || r.status === "validated").length;
  const overallPct = rows.length ? Math.round((doneRows / rows.length) * 100) : 0;
  const mandatoryRemaining = bankRows.filter(r => r.status !== "validated").length
    + assessorRows.filter(r => r.status === "awaiting_review" || r.status === "in_progress").length;

  // ── Scores & analytics ──
  const attempts = kAttempts ?? [];
  const quizAvg = attempts.length ? Math.round(attempts.reduce((s, a) => s + Number(a.score), 0) / attempts.length) : null;
  const passRate = attempts.length ? Math.round((attempts.filter(a => a.passed).length / attempts.length) * 100) : null;
  const scored = (assessments ?? []).filter(a => a.score != null);
  const assessAvg = scored.length ? Math.round(scored.reduce((s, a) => s + (a.score as number), 0) / scored.length * 10) / 10 : null;

  const domSeen = new Set<string>();
  const byDomain = new Map<string, { sum: number; n: number }>();
  for (const cs of compScores ?? []) {
    if (domSeen.has(cs.competency_id)) continue;
    domSeen.add(cs.competency_id);
    const dom = (cs.framework_competencies as unknown as { framework_domains: { name: string } | null } | null)?.framework_domains?.name ?? "—";
    const v = byDomain.get(dom) ?? { sum: 0, n: 0 };
    v.sum += cs.score; v.n++;
    byDomain.set(dom, v);
  }
  const radarAxes = [...byDomain.entries()].map(([label, v]) => ({ label, pct: Math.round((v.sum / v.n / 6) * 100) }));

  // Next recommended: first unpassed knowledge test, else soonest renewal
  const nextBank = bankRows.find(r => r.status !== "validated");
  const nextRec = nextBank
    ? { title: nextBank.title, sub: nextBank.meta ?? "Knowledge test", href: nextBank.href!, action: "Start now" }
    : upcoming[0]
    ? { title: upcoming[0].name, sub: `Reassessment due ${fmt(upcoming[0].expiry)}`, href: "/dashboard/passport", action: "View passport" }
    : null;

  const done = (assessments ?? []).filter(a => a.status === "complete" || a.status === "validated");
  const card = "bg-white rounded-xl border border-gray-100";
  const secHead = "font-semibold text-gray-900 text-sm";

  const KPI = [
    { label: "Overall Progress", value: `${overallPct}%`, sub: `${doneRows} of ${rows.length || "—"} completed`, color: "text-gray-900" },
    { label: "Mandatory Remaining", value: mandatoryRemaining, sub: "tests & assessor items", color: mandatoryRemaining ? "text-amber-600" : "text-gray-400" },
    { label: "Due This Month", value: dueThisMonth, sub: overdueCount ? `${overdueCount} overdue` : "renewals", color: dueThisMonth ? "text-red-500" : "text-gray-400" },
    { label: "Average Score", value: quizAvg !== null ? `${quizAvg}%` : "—", sub: assessAvg !== null ? `assessments ${assessAvg}/6` : "no attempts yet", color: "text-green-600" },
    { label: "Competencies Validated", value: latest.length ? `${Math.round((validatedCount / latest.length) * 100)}%` : "—", sub: `${validatedCount} of ${latest.length || "—"} · passport`, color: "text-blue-600", href: "/dashboard/passport" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard" className="hover:text-gray-600">Dashboard</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Assessment Centre</span>
      </div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Assessment Centre</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage all your assessments and track your competency progress.</p>
      </div>

      {/* KPI dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPI.map(k => {
          const inner = (
            <>
              <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
            </>
          );
          return k.href
            ? <Link key={k.label} href={k.href} className={`${card} p-4 hover:border-teal-200 transition-colors`}>{inner}</Link>
            : <div key={k.label} className={`${card} p-4`}>{inner}</div>;
        })}
      </div>

      {/* Upcoming reassessments strip */}
      {upcoming.length > 0 && (
        <div className={`${card} p-4 mb-5`}>
          <div className="flex items-center gap-3 overflow-x-auto">
            <p className="text-sm font-bold text-gray-800 shrink-0 pr-2 border-r border-gray-100">Upcoming</p>
            {upcoming.slice(0, 5).map(u => (
              <Link key={u.name} href="/dashboard/passport"
                className="flex items-center gap-2.5 shrink-0 border border-gray-100 hover:border-teal-200 rounded-lg px-3 py-2 transition-colors">
                <div className="text-center">
                  <p className="text-[8px] font-bold text-teal-600 uppercase" suppressHydrationWarning>{u.expiry ? new Date(u.expiry).toLocaleDateString(undefined, { month: "short" }) : ""}</p>
                  <p className="text-sm font-bold text-gray-800">{u.expiry ? new Date(u.expiry).getDate() : ""}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-800 truncate max-w-[160px]">{u.name}</p>
                  <p className={`text-[9px] font-bold ${u.days! < 0 ? "text-red-500" : u.days! <= 30 ? "text-red-500" : "text-amber-600"}`}>
                    {u.days! < 0 ? `${-u.days!}d overdue` : `${u.days}d remaining`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_290px] gap-5">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          <AssessmentCentre rows={rows} />

          {/* History (spec §13) */}
          {done.length > 0 && (
            <div className={`${card} p-5`}>
              <h2 className={`${secHead} mb-3`}>Assessment History</h2>
              <div className="flex flex-col">
                {done.map(a => (
                  <div key={a.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    {a.score != null && (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: SCORE_COLORS[a.score] ?? "#9ca3af" }}>{a.score}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{compName(a)?.name ?? "Assessment"}</p>
                      <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                        {METHOD_LABELS[a.method] ?? a.method}{assessorName(a) ? ` · ${assessorName(a)}` : ""}
                        {a.assessed_at ? ` · ${new Date(a.assessed_at).toLocaleDateString()}` : ""}
                      </p>
                      {a.notes && <p className="text-[11px] text-gray-500 italic mt-1">&ldquo;{a.notes}&rdquo;</p>}
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded shrink-0 ${a.status === "validated" ? "bg-green-50 text-green-700" : "bg-teal-50 text-teal-700"}`}>
                      {a.status === "validated" ? "Validated" : "Completed"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5">
          {/* Next recommended */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-2`}>✨ Next Recommended</h2>
            {nextRec ? (
              <>
                <p className="text-sm font-semibold text-gray-800">{nextRec.title}</p>
                <p className="text-[10px] text-gray-400 mb-3">{nextRec.sub}</p>
                <Link href={nextRec.href}
                  className="block text-center text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg">
                  {nextRec.action} →
                </Link>
              </>
            ) : <p className="text-xs text-gray-400">Nothing outstanding — you&apos;re up to date. ✅</p>}
            {radarAxes.length >= 3 && (
              <div className="mt-4 pt-3 border-t border-gray-50">
                <Radar axes={radarAxes} />
                <p className="text-[9px] text-gray-400 text-center">Domain performance (your assessed scores)</p>
              </div>
            )}
          </div>

          {/* Workplace competency tracker (spec §9) */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className={secHead}>Workplace Tracker</h2>
              <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline">View all →</Link>
            </div>
            {latest.length ? latest.slice(0, 5).map(l => {
              const state = l.days !== null && l.days < 0 ? { label: "Expired", cls: "text-red-500", icon: "⚠️" }
                : l.days !== null && l.days <= 60 ? { label: "Reassessment due", cls: "text-amber-600", icon: "🕐" }
                : l.validated ? { label: "Validated", cls: "text-green-600", icon: "✅" }
                : l.passing ? { label: "Pending validation", cls: "text-amber-600", icon: "🕐" }
                : { label: "Gap open", cls: "text-orange-500", icon: "🎯" };
              return (
                <div key={l.name} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  <p className="text-[11px] text-gray-700 flex-1 truncate">{l.name}</p>
                  <span className={`text-[9px] font-bold shrink-0 ${state.cls}`}>{state.label} {state.icon}</span>
                </div>
              );
            }) : <p className="text-xs text-gray-400 text-center py-3">Populates as you are assessed. 🏥</p>}
          </div>

          {/* AI assistant (spec §7) */}
          <div className="bg-[#0a2e38] rounded-xl p-5 text-white">
            <h2 className="font-semibold text-sm mb-1">AI Assessment Assistant</h2>
            <p className="text-[10px] text-teal-200/70 mb-3">Grounded in your organisation&apos;s governed content.</p>
            <ul className="text-[11px] text-teal-100/80 flex flex-col gap-1 mb-4">
              <li>💡 Explain a topic before you test</li>
              <li>❓ Practise with the question bank</li>
              <li>🧑‍⚕️ Talk through a clinical case</li>
              <li>🎯 Ask where your gaps are</li>
            </ul>
            <Link href="/dashboard/copilot"
              className="block text-center text-xs font-semibold bg-teal-500 hover:bg-teal-400 text-white py-2 rounded-lg">
              Ask me anything →
            </Link>
          </div>

          {/* Analytics (spec §11) */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Analytics</h2>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                [done.length + attempts.length, "Completed"],
                [passRate !== null ? `${passRate}%` : "—", "Quiz pass rate"],
                [quizAvg !== null ? `${quizAvg}%` : "—", "Avg quiz score"],
                [assessAvg !== null ? `${assessAvg}/6` : "—", "Avg assessment"],
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

      <p className="text-[11px] text-gray-400 mt-6">
        Formal outcomes live on your <Link href="/dashboard/passport" className="text-teal-600 hover:underline">Competency Passport</Link>; passing decisions update it automatically.
      </p>
    </div>
  );
}
