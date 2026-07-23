// Competency Validations Workspace (UMW-EA-004) loader. Reads the real competency
// store — passing competency_scores awaiting educator validation (is_passing &&
// !educator_validated) joined to their cycle (learner, type) and framework
// competency (name, code, risk_category). KPIs, validation queue, by-type/status,
// weekly trend, the selected review panel (rule-based AI validation insight + risk
// indicators), recently-completed and frameworks. Fail-soft. Competency has no
// department dimension → unit-wide (honest). Decisions run through the existing
// audited /api/educator/validate route.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : "—");
const riskLabel = (rc?: string) => (rc === "high" || rc === "critical" ? "High" : rc === "medium" ? "Medium" : "Low");
const priRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export async function loadCompetencyValidations(admin: any, hid: string | null, isSuper: boolean, _dept?: string, selectedId?: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("competency_scores").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  const { data: cyc } = await scope(admin.from("competency_cycles").select("id, nurse_id, cycle_type, end_date, profiles!nurse_id(full_name)").limit(8000));
  const cycles = new Map((cyc ?? []).map((c: any) => [c.id, c]));
  const ids = (cyc ?? []).map((c: any) => c.id);
  if (!ids.length) return { provisioned: true as const, empty: true, kpis: emptyKpis(), queue: [], byType: [], byStatus: [], trend: [], review: null, recentlyCompleted: [], aiWarn: [], frameworks: await loadFw(admin) };

  const { data: sc } = await admin.from("competency_scores")
    .select("id, cycle_id, competency_id, is_passing, educator_validated, educator_id, validated_at, final_score, avg_score, level_label, created_at, framework_competencies!competency_id(name, code, risk_category)")
    .in("cycle_id", ids).eq("is_passing", true).order("created_at", { ascending: false }).limit(6000);

  const now = new Date(); const today = now.toISOString().slice(0, 10);
  const d7 = new Date(); d7.setDate(d7.getDate() - 7); const since7 = d7.toISOString().slice(0, 10);
  const enrich = (s: any) => {
    const c: any = cycles.get(s.cycle_id) ?? {};
    const risk = riskLabel(s.framework_competencies?.risk_category);
    return {
      ...s, learner: c.profiles?.full_name ?? "—", type: c.cycle_type ?? "competency", endDate: c.end_date ?? null,
      competency: s.framework_competencies?.name ?? "Competency", code: s.framework_competencies?.code ?? "—",
      risk, priority: risk, score: s.final_score ?? (s.avg_score != null ? Math.round(s.avg_score * 20) : null),
      returned: !!s.educator_id && !s.educator_validated,
    };
  };
  const all = (sc ?? []).map(enrich);
  const pending = all.filter((s: any) => !s.educator_validated);
  const validated = all.filter((s: any) => s.educator_validated);

  const overdue = pending.filter((s: any) => s.endDate && s.endDate < today);
  const decidedThisWeek = validated.filter((s: any) => s.validated_at && s.validated_at.slice(0, 10) >= since7);
  const kpis = {
    pending: pending.length,
    overdue: overdue.length,
    dueToday: pending.filter((s: any) => s.endDate === today).length,
    highPriority: pending.filter((s: any) => s.priority === "High").length,
    validatedThisWeek: decidedThisWeek.length,
    decisionQuality: (validated.length + all.filter((s: any) => s.returned).length) ? Math.round((validated.length / (validated.length + all.filter((s: any) => s.returned).length)) * 100) : null,
    health: pending.length ? Math.max(0, Math.round(100 - (overdue.length / pending.length) * 40 - (pending.filter((s: any) => s.priority === "High").length / pending.length) * 20)) : 100,
  };

  const queue = [...pending].sort((a: any, b: any) => (priRank[a.priority] - priRank[b.priority]) || ((a.endDate ?? "9") < (b.endDate ?? "9") ? -1 : 1));
  const grp = (arr: any[], key: string) => { const m: Record<string, number> = {}; for (const r of arr) { const k = r[key] ?? "other"; m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label: cap(label), n, pct: arr.length ? Math.round((n / arr.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };
  const byType = grp(pending, "type");
  const byStatus = [
    { label: "Pending", n: pending.filter((s: any) => !s.returned).length },
    { label: "Returned", n: pending.filter((s: any) => s.returned).length },
    { label: "Validated", n: validated.length },
  ];

  const days: string[] = []; for (let i = 6; i >= 0; i--) { const dd = new Date(); dd.setDate(dd.getDate() - i); days.push(dd.toISOString().slice(0, 10)); }
  const trend = days.map(dt => ({ date: dt, validated: validated.filter((s: any) => (s.validated_at ?? "").slice(0, 10) === dt).length }));

  const selected = (selectedId ? all.find((s: any) => s.id === selectedId) : null) ?? queue[0] ?? null;
  let review = null;
  if (selected) {
    const conf = selected.score != null ? Math.min(95, 60 + Math.round((selected.score - 60) / 2)) : 70;
    const rec = selected.score != null && selected.score >= 80 ? "Approve" : selected.score != null && selected.score >= 70 ? "Review & Verify" : "Return for more evidence";
    review = {
      ...selected, aiConfidence: Math.max(50, conf), aiRec: rec,
      rationale: [`Score ${selected.score ?? "—"}% vs required standard.`, `Risk category: ${selected.risk}.`, selected.returned ? "Previously returned — re-check evidence." : "First review."],
      riskIndicators: [
        { label: `${selected.risk}-risk competency`, tone: selected.risk === "High" ? "red" : "amber" },
        { label: selected.risk === "High" ? "Critical patient impact" : "Standard patient impact", tone: selected.risk === "High" ? "red" : "gray" },
        { label: `Last validated: ${selected.validated_at ? selected.validated_at.slice(0, 10) : "Never"}`, tone: "gray" },
      ],
    };
  }

  const recentlyCompleted = [...validated].sort((a: any, b: any) => ((b.validated_at ?? "") > (a.validated_at ?? "") ? 1 : -1)).slice(0, 6);

  const aiWarn: { tone: string; title: string; sev: string }[] = [];
  const lowScore = pending.filter((s: any) => s.score != null && s.score < 75).length;
  if (lowScore) aiWarn.push({ tone: "red", title: `${lowScore} competenc${lowScore === 1 ? "y" : "ies"} trending low`, sev: "High" });
  if (overdue.length) aiWarn.push({ tone: "red", title: `${overdue.length} learner(s) with overdue validations`, sev: "High" });
  if (kpis.highPriority) aiWarn.push({ tone: "amber", title: `${kpis.highPriority} high-risk competenc${kpis.highPriority === 1 ? "y" : "ies"} pending`, sev: "Medium" });

  return { provisioned: true as const, empty: false, kpis, queue, byType, byStatus, trend, review, recentlyCompleted, aiWarn, frameworks: await loadFw(admin) };
}

function emptyKpis() { return { pending: 0, overdue: 0, dueToday: 0, highPriority: 0, validatedThisWeek: 0, decisionQuality: null, health: 100 }; }
async function loadFw(admin: any) {
  try { const { data } = await admin.from("frameworks").select("name").order("name").limit(20); return (data ?? []).map((f: any) => ({ name: f.name, active: true })); } catch { return []; }
}
