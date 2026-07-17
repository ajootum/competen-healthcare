import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  RISK_CONFIG as RISK_CONFIG_T, METHOD_LABELS as METHOD_LABELS_T,
  OUTCOME_CONFIG, COMPLEXITY_LABELS, type DecisionOutcome,
} from "@/lib/ckcm";
import CompetencyCards, { type CompCard } from "./CompetencyCards";

const METHOD_LABELS = METHOD_LABELS_T as Record<string, string>;
const RISK_CONFIG = RISK_CONFIG_T as Record<string, { label: string; cls: string }>;

// CPU Workspace (CPU Workspace Redesign spec) — one screen per Clinical
// Practice Unit: header, expandable competencies, assessment centre, evidence
// coverage, learning resources, milestones, deadlines and activity. Every
// figure is the nurse's real record; actions with no backing workflow
// (booking, uploads, downloads) are omitted rather than rendered dead.

const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const KNOWLEDGE_ICON: Record<string, string> = {
  anatomy: "🫀", physiology: "🫁", pathophysiology: "🧬", pharmacology: "💊",
  clinical_reasoning: "🧠", other: "📘",
};

export default async function CpuWorkspacePage({ params }: { params: Promise<{ cpuId: string }> }) {
  const { cpuId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: cpu } = await admin.from("clinical_practice_units")
    .select("id, name, code, description, risk_category, complexity, reassessment_months, pub_status, practices(name)")
    .eq("id", cpuId).single();
  if (!cpu || cpu.pub_status !== "published") notFound();

  const [
    { data: comps }, { data: myCycles }, { data: decisions }, { data: scores },
    { data: blueprint }, { data: evidence }, { data: bank },
    { data: knowledge }, { data: cases }, { data: allCpuDecisions },
  ] = await Promise.all([
    admin.from("framework_competencies")
      .select("id, name, description, sort_order, competency_skills(id, name, is_active)")
      .eq("cpu_id", cpuId).order("sort_order"),
    admin.from("competency_cycles").select("id").eq("nurse_id", user.id),
    admin.from("competency_decisions")
      .select("competency_id, outcome, maturity, expiry_date, decided_by_name, validation_outcome, created_at")
      .eq("nurse_id", user.id).eq("cpu_id", cpuId).order("created_at", { ascending: false }),
    admin.from("competency_scores")
      .select("competency_id, score, label, educator_validated, assessed_at")
      .eq("nurse_id", user.id).order("assessed_at", { ascending: false }),
    admin.from("assessment_blueprints")
      .select("min_score, min_assessors, consensus_rule, blueprint_methods(method, weight, is_required)")
      .eq("cpu_id", cpuId).maybeSingle(),
    admin.from("evidence_matrix").select("evidence_type, min_quantity, is_critical").eq("cpu_id", cpuId),
    admin.from("question_banks").select("id, name, pass_mark").eq("cpu_id", cpuId).eq("is_active", true).limit(1).maybeSingle(),
    admin.from("knowledge_objects").select("id, title, knowledge_type").eq("cpu_id", cpuId).neq("status", "retired").order("sort_order"),
    admin.from("clinical_cases").select("id, title").eq("cpu_id", cpuId).neq("status", "retired"),
    admin.from("competency_decisions").select("nurse_id, competency_id, outcome, created_at").eq("cpu_id", cpuId),
  ]);

  const compIds = (comps ?? []).map(c => c.id);
  const cycleIds = (myCycles ?? []).map(c => c.id);

  const [{ data: assessments }, { data: attempts }, { data: skillScores }, { data: resourceLinks }] = await Promise.all([
    cycleIds.length && compIds.length
      ? admin.from("assessments")
          .select("competency_id, method, status, score, assessed_at, profiles!assessor_id(full_name)")
          .in("cycle_id", cycleIds).in("competency_id", compIds).order("assessed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    bank
      ? admin.from("knowledge_attempts").select("score, passed, completed_at").eq("nurse_id", user.id).eq("bank_id", bank.id).order("completed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    cycleIds.length && compIds.length
      ? admin.from("skill_scores")
          .select("skill_id, competency_id, score, assessed_at, competency_skills(name)")
          .in("cycle_id", cycleIds).in("competency_id", compIds)
      : Promise.resolve({ data: [] }),
    compIds.length
      ? admin.from("resource_competencies")
          .select("competency_id, learning_resources(title, resource_type, url, is_active)")
          .in("competency_id", compIds)
      : Promise.resolve({ data: [] }),
  ]);

  // ── Per-competency state ──
  const latestDecision = new Map<string, { outcome: DecisionOutcome; maturity: string | null; expiry: string | null }>();
  const historyByComp = new Map<string, { outcome: string; cls: string; at: string; by: string | null; expiry: string | null }[]>();
  for (const d of decisions ?? []) {
    if (!latestDecision.has(d.competency_id)) {
      latestDecision.set(d.competency_id, { outcome: d.outcome as DecisionOutcome, maturity: d.maturity, expiry: d.expiry_date });
    }
    const h = historyByComp.get(d.competency_id) ?? [];
    if (h.length < 5) h.push({
      outcome: OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.label ?? d.outcome,
      cls: OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.cls ?? "bg-gray-100 text-gray-600",
      at: d.created_at, by: d.decided_by_name, expiry: d.expiry_date,
    });
    historyByComp.set(d.competency_id, h);
  }
  const bestScore = new Map<string, { value: number; label: string; validated: boolean }>();
  for (const s of scores ?? []) {
    if (!compIds.includes(s.competency_id) || bestScore.has(s.competency_id)) continue;
    bestScore.set(s.competency_id, { value: s.score, label: s.label ?? `${s.score}/6`, validated: s.educator_validated ?? false });
  }
  const resByComp = new Map<string, { title: string; type: string; url: string | null }[]>();
  for (const r of resourceLinks ?? []) {
    const lr = r.learning_resources as unknown as { title: string; resource_type: string; url: string | null; is_active: boolean } | null;
    if (!lr?.is_active) continue;
    const list = resByComp.get(r.competency_id) ?? [];
    list.push({ title: lr.title, type: lr.resource_type, url: lr.url });
    resByComp.set(r.competency_id, list);
  }

  const cards: CompCard[] = (comps ?? []).map((c, i) => {
    const d = latestDecision.get(c.id);
    const oc = d ? OUTCOME_CONFIG[d.outcome] : null;
    const passing = !!oc?.passing;
    const score = bestScore.get(c.id) ?? null;
    return {
      id: c.id, number: i + 1, name: c.name, description: c.description ?? null,
      outcome: oc ? { label: oc.label, cls: oc.cls } : null,
      score,
      progressPct: passing ? 100 : score ? Math.round((score.value / 6) * 100) : 0,
      skills: ((c.competency_skills ?? []) as { name: string; is_active: boolean }[]).map(s => ({ name: s.name, active: s.is_active })),
      resources: resByComp.get(c.id) ?? [],
      history: historyByComp.get(c.id) ?? [],
    };
  });

  const total = cards.length;
  const passing = cards.filter(c => c.progressPct === 100).length;
  const progress = total ? Math.round((passing / total) * 100) : 0;
  const started = (decisions ?? []).length > 0 || (scores ?? []).some(s => compIds.includes(s.competency_id)) || (attempts ?? []).length > 0;
  const status = progress === 100 ? { label: "Completed", cls: "text-green-600" }
    : started ? { label: "In Progress", cls: "text-amber-600" }
    : { label: "Not Started", cls: "text-gray-400" };
  const expiries = [...latestDecision.values()].map(d => d.expiry).filter(Boolean) as string[];
  const nextReassessment = expiries.length ? [...expiries].sort()[0] : null;
  const daysToReassess = nextReassessment ? Math.ceil((new Date(nextReassessment).getTime() - nowMs()) / dayMs) : null;
  const overdue = [...latestDecision.values()].filter(d => d.expiry && new Date(d.expiry).getTime() < nowMs()).length;

  // Latest assessor seen on this CPU
  const lastAssessor = ((assessments ?? []) as unknown as { profiles: { full_name: string } | null }[])
    .map(a => a.profiles?.full_name).find(Boolean)
    ?? (decisions ?? []).map(d => d.decided_by_name).find(Boolean) ?? null;

  // ── Assessment centre: per blueprint method ──
  const bpMethods = ((blueprint?.blueprint_methods ?? []) as { method: string; weight: number; is_required: boolean }[]);
  const bestAttempt = (attempts ?? []).reduce<{ score: number; passed: boolean } | null>(
    (b, a) => (!b || a.score > b.score ? { score: a.score, passed: a.passed } : b), null);
  const methodRows = bpMethods.map(m => {
    if (m.method === "knowledge" || m.method === "knowledge_test" || m.method === "written_exam") {
      return {
        method: m.method, label: METHOD_LABELS[m.method] ?? m.method, weight: m.weight,
        pct: bestAttempt ? Math.min(bestAttempt.score, 100) : 0,
        detail: bank
          ? bestAttempt ? `best ${bestAttempt.score}% · pass ${bank.pass_mark}%` : `not attempted · pass ${bank.pass_mark}%`
          : "no question bank yet",
        href: bank ? `/dashboard/tests/${bank.id}` : null,
        action: bank ? (bestAttempt?.passed ? "Retake" : "Take test") : null,
      };
    }
    if (m.method === "skills_checklist") {
      const scored = (skillScores ?? []).length;
      const totalSkills = cards.reduce((s, c) => s + c.skills.length, 0);
      return {
        method: m.method, label: METHOD_LABELS[m.method] ?? m.method, weight: m.weight,
        pct: totalSkills ? Math.round((scored / totalSkills) * 100) : 0,
        detail: totalSkills ? `${scored}/${totalSkills} skills scored` : "no skills defined",
        href: "/dashboard/logbook", action: "Logbook",
      };
    }
    const done = (assessments ?? []).filter(a => a.method === m.method && ["complete", "validated"].includes(a.status)).length;
    const all = (assessments ?? []).filter(a => a.method === m.method).length;
    return {
      method: m.method, label: METHOD_LABELS[m.method] ?? m.method, weight: m.weight,
      pct: all ? Math.round((done / all) * 100) : 0,
      detail: all ? `${done}/${all} completed` : "arranged by your assessor",
      href: "/dashboard/assessments", action: all ? "View" : null,
    };
  });

  // ── Evidence coverage (matrix vs record) ──
  const evidenceRows = (evidence ?? []).map(e => {
    const fulfilled = e.evidence_type === "skills_checklist"
      ? (skillScores ?? []).length
      : (assessments ?? []).filter(a => a.method === e.evidence_type && ["complete", "validated"].includes(a.status)).length;
    return {
      label: METHOD_LABELS[e.evidence_type] ?? e.evidence_type,
      need: e.min_quantity, have: Math.min(fulfilled, e.min_quantity), critical: e.is_critical,
      met: fulfilled >= e.min_quantity,
    };
  });

  // ── Milestones (spec §8) ──
  const validatedAny = (decisions ?? []).some(d => d.validation_outcome === "validated");
  const milestones = [
    { label: "Learning", state: (knowledge ?? []).length || (cases ?? []).length ? "available" : "none", done: false },
    { label: "Knowledge test", state: bestAttempt ? (bestAttempt.passed ? "passed" : `best ${bestAttempt.score}%`) : bank ? "not attempted" : "no bank", done: !!bestAttempt?.passed },
    { label: "Skills checklist", state: (skillScores ?? []).length ? `${(skillScores ?? []).length} scored` : "not started", done: (skillScores ?? []).length > 0 },
    { label: "Assessments", state: (assessments ?? []).length ? `${(assessments ?? []).length} recorded` : "none yet", done: (assessments ?? []).some(a => ["complete", "validated"].includes(a.status)) },
    { label: "Validation", state: validatedAny ? "validated" : "pending", done: validatedAny },
    { label: "Competent", state: `${passing}/${total}`, done: progress === 100 },
  ];

  // ── Peer average across nurses with decisions on this CPU ──
  const byNurse = new Map<string, { seen: Set<string>; pass: number }>();
  for (const d of allCpuDecisions ?? []) {
    const v = byNurse.get(d.nurse_id) ?? { seen: new Set<string>(), pass: 0 };
    if (!v.seen.has(d.competency_id)) {
      v.seen.add(d.competency_id);
      if (OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing) v.pass++;
    }
    byNurse.set(d.nurse_id, v);
  }
  const peerPcts = [...byNurse.entries()].filter(([id]) => id !== user.id)
    .map(([, v]) => total ? Math.round((v.pass / total) * 100) : 0);
  const peerAvg = peerPcts.length ? Math.round(peerPcts.reduce((s, p) => s + p, 0) / peerPcts.length) : null;

  // ── Activity feed ──
  const activity = [
    ...(decisions ?? []).slice(0, 4).map(d => ({ icon: "🧾", text: `Decision: ${OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.label ?? d.outcome}`, at: d.created_at })),
    ...((assessments ?? []) as unknown as { method: string; status: string; assessed_at: string | null }[]).filter(a => a.assessed_at).slice(0, 4)
      .map(a => ({ icon: "📝", text: `${METHOD_LABELS[a.method] ?? a.method} ${a.status}`, at: a.assessed_at! })),
    ...(attempts ?? []).slice(0, 3).map(a => ({ icon: "❓", text: `Knowledge test — ${a.score}%${a.passed ? " (passed)" : ""}`, at: a.completed_at })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6);

  const risk = RISK_CONFIG[cpu.risk_category] ?? null;
  const practice = (cpu.practices as unknown as { name: string } | null)?.name;
  const card = "bg-white rounded-xl border border-gray-100";
  const secHead = "font-semibold text-gray-900 text-sm";
  const continueHref = bank && !bestAttempt?.passed ? `/dashboard/tests/${bank.id}` : "/dashboard/learning";

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard/cpu" className="hover:text-gray-600">My CPUs</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{cpu.name}</span>
      </div>

      {/* Header (spec §1) */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 flex flex-wrap items-center gap-2">
            {cpu.name}
            <span className="text-[10px] font-mono font-normal bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{cpu.code}</span>
            {risk && <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${risk.cls}`}>⚠ {risk.label}</span>}
          </h1>
          <p className="text-gray-400 text-xs mt-1">
            {practice ? `${practice} · ` : ""}{COMPLEXITY_LABELS[cpu.complexity] ?? `Level ${cpu.complexity}`}
            {cpu.reassessment_months ? ` · Reassess every ${cpu.reassessment_months} months` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={continueHref}
            className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">▶ Continue CPU</Link>
          <Link href="/dashboard/learning"
            className="text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg">View Learning</Link>
          <Link href="/dashboard/copilot"
            className="text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg">🤖 Ask AI</Link>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {[
          { label: "Status", value: status.label, cls: status.cls, sub: null },
          { label: "Overall progress", value: `${progress}%`, cls: "text-gray-900", sub: `${passing}/${total} competent` },
          { label: "Risk level", value: risk?.label ?? "—", cls: cpu.risk_category === "high" || cpu.risk_category === "critical" ? "text-red-500" : "text-gray-900", sub: "priority" },
          { label: "Valid for", value: cpu.reassessment_months ? `${cpu.reassessment_months} mo` : "—", cls: "text-gray-900", sub: nextReassessment ? `next: ${fmt(nextReassessment)}` : "no decisions yet" },
          { label: "Overdue items", value: overdue, cls: overdue ? "text-red-500" : "text-gray-400", sub: "expired decisions" },
          { label: "Last assessor", value: lastAssessor ?? "None yet", cls: "text-gray-900", sub: lastAssessor ? "most recent" : "assigned by your admin", small: true },
        ].map(s => (
          <div key={s.label} className={`${card} p-3.5`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{s.label}</p>
            <p className={`font-bold ${"small" in s && s.small ? "text-sm" : "text-lg"} ${s.cls}`}>{s.value}</p>
            {s.sub && <p className="text-[9px] text-gray-400 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          <CompetencyCards cards={cards} />

          {/* Assessment centre (spec §3) */}
          {methodRows.length > 0 && (
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-1">
                <h2 className={secHead}>Assessment Centre</h2>
                {blueprint && (
                  <span className="text-[10px] text-gray-400">
                    Pass {blueprint.min_score}/6 · {blueprint.min_assessors} assessor{blueprint.min_assessors !== 1 ? "s" : ""} · {blueprint.consensus_rule}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2.5 mt-3">
                {methodRows.map(m => (
                  <div key={m.method} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 w-40 truncate">{m.label} <span className="text-gray-300">{m.weight}%</span></span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${m.pct >= 100 ? "bg-green-500" : "bg-teal-500"}`} style={{ width: `${Math.max(m.pct, 2)}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-40 truncate">{m.detail}</span>
                    {m.href && m.action
                      ? <Link href={m.href} className="text-[11px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-2.5 py-1 rounded-lg shrink-0">{m.action}</Link>
                      : <span className="w-14 shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Learning resources (spec §5) */}
          {((knowledge ?? []).length > 0 || (cases ?? []).length > 0) && (
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className={secHead}>Learning Resources</h2>
                <Link href="/dashboard/copilot" className="text-xs text-teal-600 hover:underline">Study with the AI Coach →</Link>
              </div>
              <div className="grid md:grid-cols-2 gap-x-5 gap-y-1">
                {(knowledge ?? []).map(k => (
                  <p key={k.id} className="text-[11px] text-gray-600 py-0.5">
                    {KNOWLEDGE_ICON[k.knowledge_type] ?? "📘"} {k.title}
                  </p>
                ))}
                {(cases ?? []).map(c => (
                  <p key={c.id} className="text-[11px] text-gray-600 py-0.5">🧑‍⚕️ Case study: {c.title}</p>
                ))}
              </div>
              <p className="text-[9px] text-gray-300 mt-2">Governed knowledge objects and worked cases for this CPU — the AI Coach cites them when you ask.</p>
            </div>
          )}
        </div>

        {/* Right rail (spec §10) */}
        <div className="flex flex-col gap-5">
          {/* Milestones (spec §8) */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>CPU Milestones</h2>
            <div className="flex flex-col">
              {milestones.map((m, i) => (
                <div key={m.label} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center ${m.done ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                      {m.done ? "✓" : i + 1}
                    </span>
                    {i < milestones.length - 1 && <span className="w-0.5 flex-1 bg-gray-100 my-0.5" />}
                  </div>
                  <div className="pb-3">
                    <p className={`text-xs font-medium ${m.done ? "text-gray-800" : "text-gray-500"}`}>{m.label}</p>
                    <p className="text-[9px] text-gray-400 capitalize">{m.state}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence coverage (spec §4) */}
          {evidenceRows.length > 0 && (
            <div className={`${card} p-5`}>
              <h2 className={`${secHead} mb-3`}>Evidence Required</h2>
              <div className="flex flex-col gap-2">
                {evidenceRows.map(e => (
                  <div key={e.label} className="flex items-center gap-2">
                    <span className={`text-xs ${e.met ? "text-green-500" : "text-gray-300"}`}>{e.met ? "✓" : "○"}</span>
                    <span className="text-[11px] text-gray-700 flex-1">
                      {e.label}{e.critical && <span className="ml-1 text-[8px] font-bold text-red-500">CRITICAL</span>}
                    </span>
                    <span className="text-[10px] font-semibold text-gray-500">{e.have}/{e.need}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-300 mt-2.5">Counted from your recorded assessments and skill scorings.</p>
            </div>
          )}

          {/* Deadlines */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Upcoming & Deadlines</h2>
            {nextReassessment ? (
              <div className="flex items-center gap-2.5">
                <span className="text-base">⏰</span>
                <div>
                  <p className="text-xs font-medium text-gray-800">Reassessment due</p>
                  <p className={`text-[10px] ${daysToReassess !== null && daysToReassess < 30 ? "text-red-500 font-bold" : "text-gray-400"}`} suppressHydrationWarning>
                    {fmt(nextReassessment)}{daysToReassess !== null ? ` (${daysToReassess > 0 ? `in ${daysToReassess} days` : `${-daysToReassess} days overdue`})` : ""}
                  </p>
                </div>
              </div>
            ) : <p className="text-xs text-gray-400">No deadlines until your first decision. ✅</p>}
          </div>

          {/* Analytics (spec §9) */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Analytics</h2>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                [`${progress}%`, "Your progress"],
                [peerAvg !== null ? `${peerAvg}%` : "—", "Peer average"],
                [overdue, "Overdue"],
                [total - passing, "Gaps open"],
              ].map(([v, l]) => (
                <div key={l as string} className="bg-gray-50/70 rounded-lg py-2.5">
                  <p className="text-base font-bold text-gray-900">{v}</p>
                  <p className="text-[9px] text-gray-400">{l}</p>
                </div>
              ))}
            </div>
            {peerAvg === null && <p className="text-[9px] text-gray-300 mt-2">Peer average appears when colleagues are assessed on this CPU.</p>}
          </div>

          {/* Activity */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Activity</h2>
            {activity.length ? activity.map((a, i) => (
              <div key={i} className="flex items-start gap-2 py-1 border-b border-gray-50 last:border-0">
                <span className="text-xs">{a.icon}</span>
                <p className="text-[11px] text-gray-600 flex-1">{a.text}</p>
                <span className="text-[9px] text-gray-400 shrink-0" suppressHydrationWarning>{fmt(a.at)}</span>
              </div>
            )) : <p className="text-xs text-gray-400 text-center py-3">Your work on this CPU appears here. 📋</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
