// COMP-020 Competency Recertification & Renewal Management. Read model that unifies every EXPIRING credential a
// professional holds — professional certifications/licences/registrations (cmo_certifications, mig 114) and
// current competent competency decisions carrying an expiry (competency_decisions, mig 011; hospital_id via 027)
// — stages each by time-to-expiry, and overlays the renewals opened against them (cmo_renewals, mig 124). The
// expiring worklist, notification cadence and KPIs are all DERIVED on read from real data; only the renewal
// records themselves are persisted. No fabricated data — a hospital with no expiry-dated records simply shows
// an empty worklist, and a missing renewals table is fail-soft (renewals = []).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

// Competency NAME via the framework_competencies FK embed (PostgREST returns object-or-array).
const nameOf = (row: any) => { const f = row?.framework_competencies; const v = Array.isArray(f) ? f[0] : f; return (v?.name ?? null) as string | null; };

// The seven renewal paths (COMP-020) with a label + colour for the path-mix chart and its legend.
export const PATHS: Record<string, { label: string; color: string; tone: string }> = {
  evidence:             { label: "Evidence portfolio",   color: "#3b82f6", tone: "blue" },
  assessment:           { label: "Reassessment",         color: "#14b8a6", tone: "teal" },
  simulation:           { label: "Simulation",           color: "#8b5cf6", tone: "violet" },
  continuing_education: { label: "Continuing education", color: "#f59e0b", tone: "amber" },
  practice_observation: { label: "Practice observation", color: "#10b981", tone: "emerald" },
  portfolio:            { label: "Portfolio review",     color: "#0ea5e9", tone: "blue" },
  mixed:                { label: "Mixed pathway",        color: "#64748b", tone: "slate" },
};

// Days-to-expiry → worklist band. `beyond` (>90d) is tracked but excluded from the actionable worklist.
function bandOf(days: number): { key: string; label: string; tone: string } {
  if (days < 0)   return { key: "expired", label: "Expired", tone: "rose" };
  if (days <= 7)  return { key: "due",     label: "Due now", tone: "amber" };   // 0–7
  if (days <= 30) return { key: "d30",     label: "≤30 days", tone: "amber" };  // 8–30
  if (days <= 90) return { key: "d90",     label: "≤90 days", tone: "blue" };   // 31–90
  return { key: "beyond", label: ">90 days", tone: "slate" };
}

type Item = {
  person: string; personId: string | null; subject: string; subjectId: string | null;
  type: "competency" | "certification"; expiry_date: string; daysLeft: number;
  band: string; bandLabel: string; bandTone: string; hasRenewal: boolean;
};

export async function loadRecertification(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today + "T00:00:00Z").getTime();
  const daysTo = (d: string) => Math.round((new Date(d + "T00:00:00Z").getTime() - todayMs) / 86400000);

  // ── EXPIRY SOURCE 1: professional certifications / licences / registrations (cmo_certifications, mig 114) ──
  const certRes = await scope(
    admin.from("cmo_certifications")
      .select("id, staff_id, name, expiry_date, status, cert_type")
      .not("expiry_date", "is", null)
      .limit(8000),
  );
  // ── EXPIRY SOURCE 2: current competent competency decisions carrying an expiry (competency_decisions) ──
  const decRes = await scope(
    admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, expiry_date, created_at, framework_competencies(name)")
      .eq("outcome", "competent")
      .not("expiry_date", "is", null)
      .order("created_at", { ascending: false })
      .limit(8000),
  );

  // Not provisioned only if BOTH sources error; a missing cmo_certifications alone is fine (competencies still work).
  if (certRes.error && decRes.error) return { provisioned: false as const };
  const certRows = (certRes.error ? [] : (certRes.data ?? [])) as any[];
  const decRows = (decRes.error ? [] : (decRes.data ?? [])) as any[];

  // LATEST competent decision per (nurse, competency) — rows arrive created_at DESC, so first-seen wins.
  const seen = new Set<string>();
  const latestDecs: any[] = [];
  for (const d of decRows) {
    const key = `${d.nurse_id}::${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latestDecs.push(d);
  }

  // Resolve person names for both sources in one batch.
  const personIds = [...new Set([...certRows.map(c => c.staff_id), ...latestDecs.map(d => d.nurse_id)].filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  for (let i = 0; i < personIds.length; i += 300) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", personIds.slice(i, i + 300));
    ((data ?? []) as any[]).forEach(p => nameById.set(p.id, p.full_name));
  }

  // ── ACTIVE RENEWALS (cmo_renewals, mig 124) — fail-soft: a missing table leaves renewals empty. ──
  let renewalRows: any[] = [];
  try {
    const r = await scope(
      admin.from("cmo_renewals")
        .select("id, subject_type, subject_id, subject_name, nurse_id, nurse_name, expiry_date, renewal_path, status, completed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(4000),
    );
    if (!r.error) renewalRows = (r.data ?? []) as any[];
  } catch { /* table not provisioned yet → renewals stay [] */ }
  const renewalSubjectIds = new Set(renewalRows.map(r => r.subject_id).filter(Boolean));
  const hasRenewalFor = (subjectId: string | null) => !!subjectId && renewalSubjectIds.has(subjectId);

  // ── Build the unified expiring-item list from both sources. ──
  const raw: Item[] = [];
  for (const c of certRows) {
    if (!c.expiry_date) continue;
    const days = daysTo(c.expiry_date);
    const b = bandOf(days);
    raw.push({
      person: (c.staff_id ? nameById.get(c.staff_id) : null) ?? "Staff member", personId: c.staff_id ?? null,
      subject: c.name ?? "Certification", subjectId: c.id ?? null, type: "certification",
      expiry_date: c.expiry_date, daysLeft: days, band: b.key, bandLabel: b.label, bandTone: b.tone,
      hasRenewal: hasRenewalFor(c.id ?? null),
    });
  }
  for (const d of latestDecs) {
    if (!d.expiry_date) continue;
    const days = daysTo(d.expiry_date);
    const b = bandOf(days);
    raw.push({
      person: (d.nurse_id ? nameById.get(d.nurse_id) : null) ?? "Worker", personId: d.nurse_id ?? null,
      subject: nameOf(d) ?? "Competency", subjectId: d.competency_id ?? null, type: "competency",
      expiry_date: d.expiry_date, daysLeft: days, band: b.key, bandLabel: b.label, bandTone: b.tone,
      hasRenewal: hasRenewalFor(d.competency_id ?? null),
    });
  }

  // ── Notification cadence strip: escalating reminders by time-to-expiry. ──
  const inWindow = (lo: number, hi: number) => raw.filter(r => r.daysLeft >= lo && r.daysLeft <= hi).length;
  const stages = [
    { key: "90d",     label: "T-90",    sub: "61–90 days", tone: "blue",  n: inWindow(61, 90) },
    { key: "60d",     label: "T-60",    sub: "31–60 days", tone: "blue",  n: inWindow(31, 60) },
    { key: "30d",     label: "T-30",    sub: "8–30 days",  tone: "amber", n: inWindow(8, 30) },
    { key: "due",     label: "Due",     sub: "0–7 days",   tone: "amber", n: inWindow(0, 7) },
    { key: "overdue", label: "Overdue", sub: "expired",    tone: "rose",  n: raw.filter(r => r.daysLeft < 0).length },
  ];

  // ── Worklist: top ~60 soonest-expiring items (excludes >90d), most-urgent first (expired ⇒ negative ⇒ first). ──
  const worklistAll = raw.filter(r => r.band !== "beyond").sort((a, b) => a.daysLeft - b.daysLeft);
  const worklist = worklistAll.slice(0, 60);

  // ── Renewals (active + historical) mapped for the manager + path-mix. ──
  const renewals = renewalRows.map(r => ({
    id: r.id, status: r.status, renewalPath: r.renewal_path,
    pathLabel: PATHS[r.renewal_path]?.label ?? r.renewal_path,
    subjectType: r.subject_type, subjectId: r.subject_id,
    subject: r.subject_name ?? "—", person: r.nurse_name ?? "—",
    expiry_date: r.expiry_date, completedAt: r.completed_at,
    inFlight: !["completed", "lapsed"].includes(r.status),
  }));

  const completed = renewalRows.filter(r => r.status === "completed").length;
  const inProgress = renewalRows.filter(r => r.status === "in_progress").length;
  const reassessment = renewalRows.filter(r => r.status === "reassessment").length;
  const inFlight = renewalRows.filter(r => !["completed", "lapsed"].includes(r.status)).length;

  const expired = raw.filter(r => r.daysLeft < 0).length;
  const expiring30 = raw.filter(r => r.daysLeft >= 0 && r.daysLeft <= 30).length;
  const expiring90 = raw.filter(r => r.daysLeft >= 31 && r.daysLeft <= 90).length;
  const overdueNoRenewal = raw.filter(r => r.daysLeft < 0 && !r.hasRenewal).length;

  // ── 7-step renewal lifecycle strip with derivable counts. ──
  const lifecycle = [
    { key: "monitor",      label: "Monitor",      sub: "tracked",      n: raw.length },
    { key: "notify",       label: "Notify",       sub: "in window",    n: worklistAll.length },
    { key: "assign",       label: "Assign",       sub: "no renewal",   n: raw.filter(r => r.daysLeft <= 30 && !r.hasRenewal).length },
    { key: "learn",        label: "Learn",        sub: "in progress",  n: inProgress },
    { key: "reassess",     label: "Reassess",     sub: "reassessment", n: reassessment },
    { key: "renew",        label: "Renew",        sub: "completed",    n: completed },
    { key: "monitor_next", label: "Monitor next", sub: "re-cycled",    n: completed },
  ];

  // ── Renewal-path distribution (for a Bars / Donut) — only paths in use. ──
  const pathMix = Object.keys(PATHS)
    .map(p => ({ path: p, ...PATHS[p], n: renewalRows.filter(r => r.renewal_path === p).length }))
    .filter(x => x.n > 0);

  return {
    provisioned: true as const,
    empty: raw.length === 0 && renewalRows.length === 0,
    kpis: {
      expiring30, expiring90, expired,
      inProgress: inFlight,
      renewalRate: renewalRows.length ? Math.round((completed / renewalRows.length) * 100) : null,
      overdueNoRenewal,
    },
    stages,
    lifecycle,
    worklist,
    worklistTotal: worklistAll.length,
    renewals,
    pathMix,
    counts: { expired, expiring30, expiring90, inFlight, renewalsTotal: renewalRows.length, completed },
    certsAvailable: !certRes.error,
    decisionsAvailable: !decRes.error,
  };
}
