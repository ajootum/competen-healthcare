import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import PassportCentre, { type PassportRow, type CentreKpis, type TimelineEvent, type CpuSummary } from "./PassportCentre";

// Competency Passport Centre (Passport Centre spec): the assessor's
// operational view of every clinician's passport — validation backlog,
// evidence gaps, expiries and risk, with per-nurse drill-down (timeline + CPU
// summary) and a real request-evidence action. Passports update automatically
// when assessments are validated (decisions engine); per-score validation
// itself lives in the educator workflow.

export default async function PassportCentrePage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n: selectedNurse } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Key = in30.toISOString().slice(0, 10);
  const week = new Date(); week.setDate(week.getDate() - 7);

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization, created_at, avatar_url")
    .eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").order("full_name");
  const nurseIds = (nurses ?? []).map(x => x.id);

  const [{ data: decisions }, { data: pendingLogs }] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_decisions")
          .select("nurse_id, competency_id, cpu_id, outcome, critical_failure, validation_outcome, validated_at, expiry_date, created_at, framework_competencies(name), clinical_practice_units(name)")
          .in("nurse_id", nurseIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries").select("nurse_id, skill_name, created_at").eq("status", "pending").in("nurse_id", nurseIds)
      : Promise.resolve({ data: [] }),
  ]);

  type Dec = {
    nurse_id: string; competency_id: string; cpu_id: string | null; outcome: string;
    critical_failure: boolean; validation_outcome: string | null; validated_at: string | null;
    expiry_date: string | null; created_at: string;
    framework_competencies: { name: string } | null;
    clinical_practice_units: { name: string } | null;
  };
  const allDecs = (decisions ?? []) as unknown as Dec[];
  const isPassing = (o: string) => OUTCOME_CONFIG[o as DecisionOutcome]?.passing ?? false;

  // Latest decision per nurse+competency
  const seen = new Set<string>();
  const latest: Dec[] = [];
  for (const d of allDecs) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(d);
  }

  const pendingByNurse = new Map<string, number>();
  for (const p of pendingLogs ?? []) pendingByNurse.set(p.nurse_id, (pendingByNurse.get(p.nurse_id) ?? 0) + 1);

  type Agg = { competent: number; awaiting: number; expired: number; expSoon: number; flagged: number; total: number; nearestDue: string | null };
  const agg = new Map<string, Agg>();
  for (const d of latest) {
    const a = agg.get(d.nurse_id) ?? { competent: 0, awaiting: 0, expired: 0, expSoon: 0, flagged: 0, total: 0, nearestDue: null };
    a.total++;
    const passing = isPassing(d.outcome);
    if (!passing || d.critical_failure) a.flagged++;
    if (passing) {
      if (d.expiry_date && d.expiry_date < today) a.expired++;
      else if (d.validation_outcome === "validated") {
        a.competent++;
        if (d.expiry_date && d.expiry_date <= in30Key) {
          a.expSoon++;
          if (!a.nearestDue || d.expiry_date < a.nearestDue) a.nearestDue = d.expiry_date;
        }
      } else a.awaiting++;
    }
    agg.set(d.nurse_id, a);
  }

  const rows: PassportRow[] = (nurses ?? []).map(nu => {
    const a = agg.get(nu.id) ?? { competent: 0, awaiting: 0, expired: 0, expSoon: 0, flagged: 0, total: 0, nearestDue: null };
    const evidence = pendingByNurse.get(nu.id) ?? 0;
    let status: PassportRow["status"]; let reason: string; let priority: PassportRow["priority"];
    if (a.flagged > 0) {
      status = "Flagged"; reason = `${a.flagged} non-passing or critical decision${a.flagged === 1 ? "" : "s"}`; priority = "high";
    } else if (a.expired > 0) {
      status = "Reassessment Due"; reason = `${a.expired} competenc${a.expired === 1 ? "y" : "ies"} expired`; priority = "high";
    } else if (a.awaiting > 0) {
      status = "Awaiting Validation"; reason = `${a.awaiting} decision${a.awaiting === 1 ? "" : "s"} awaiting educator validation`; priority = "medium";
    } else if (evidence > 0) {
      status = "Evidence Incomplete"; reason = `${evidence} logbook entr${evidence === 1 ? "y" : "ies"} unverified`; priority = "medium";
    } else if (a.expSoon > 0) {
      status = "Expiring Soon"; reason = `Expires ${a.nearestDue ? new Date(a.nearestDue).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "within 30 days"}`; priority = "medium";
    } else if (a.total > 0) {
      status = "Healthy"; reason = "All decided competencies validated"; priority = "low";
    } else {
      status = "No Passport Yet"; reason = "No competency decisions recorded"; priority = "low";
    }
    return {
      id: nu.id, name: nu.full_name, department: nu.specialization ?? "General",
      avatarUrl: nu.avatar_url ?? null, joined: nu.created_at,
      status, reason, priority,
      health: a.total ? Math.round((a.competent / a.total) * 100) : null,
      competent: a.competent, total: a.total, awaiting: a.awaiting,
      expired: a.expired, expSoon: a.expSoon, evidence,
      due: a.nearestDue,
    };
  });

  // KPIs (org level) — avg review time from real created→validated intervals
  const validated = allDecs.filter(d => d.validated_at);
  const reviewDays = validated
    .map(d => (new Date(d.validated_at!).getTime() - new Date(d.created_at).getTime()) / 86400000)
    .filter(x => x >= 0);
  const totalDecided = latest.length;
  const kpis: CentreKpis = {
    pending: rows.reduce((s, r) => s + r.awaiting, 0),
    awaitingEvidence: (pendingLogs ?? []).length,
    expiring: rows.reduce((s, r) => s + r.expSoon, 0),
    recentlyApproved: validated.filter(d => d.validated_at! >= week.toISOString()).length,
    highRisk: rows.filter(r => r.status === "Flagged" || r.status === "Reassessment Due").length,
    avgReviewDays: reviewDays.length ? Math.round((reviewDays.reduce((s, x) => s + x, 0) / reviewDays.length) * 10) / 10 : null,
    health: totalDecided ? Math.round((latest.filter(d => isPassing(d.outcome) && d.validation_outcome === "validated" && !(d.expiry_date && d.expiry_date < today)).length / totalDecided) * 100) : null,
  };

  // Detail for the selected nurse
  const sel = rows.find(r => r.id === selectedNurse) ?? rows.find(r => r.priority === "high") ?? rows[0] ?? null;
  let timeline: TimelineEvent[] = [];
  let cpus: CpuSummary[] = [];
  if (sel) {
    const nurseDecs = allDecs.filter(d => d.nurse_id === sel.id).slice(0, 5);
    const { data: nurseLogs } = await admin.from("skill_log_entries")
      .select("skill_name, status, created_at").eq("nurse_id", sel.id)
      .order("created_at", { ascending: false }).limit(3);
    timeline = [
      ...nurseDecs.map(d => ({
        at: d.created_at,
        label: `Decision: ${d.framework_competencies?.name ?? "Competency"}`,
        chip: d.validation_outcome === "validated" ? (isPassing(d.outcome) ? "Competent" : d.outcome.replace(/_/g, " ")) : isPassing(d.outcome) ? "Pending Validation" : d.outcome.replace(/_/g, " "),
        good: isPassing(d.outcome) && d.validation_outcome === "validated",
      })),
      ...((nurseLogs ?? []).map(l => ({
        at: l.created_at,
        label: `Logbook: ${l.skill_name}`,
        chip: l.status === "verified" ? "Verified" : l.status === "pending" ? "Pending" : l.status.replace(/_/g, " "),
        good: l.status === "verified",
      }))),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

    const byCpu = new Map<string, { name: string; pass: number; total: number; nearestDue: string | null }>();
    for (const d of latest.filter(x => x.nurse_id === sel.id)) {
      const key = d.cpu_id ?? "none";
      const c = byCpu.get(key) ?? { name: d.clinical_practice_units?.name ?? "Unassigned CPU", pass: 0, total: 0, nearestDue: null };
      c.total++;
      if (isPassing(d.outcome) && !(d.expiry_date && d.expiry_date < today)) c.pass++;
      if (d.expiry_date && d.expiry_date >= today && (!c.nearestDue || d.expiry_date < c.nearestDue)) c.nearestDue = d.expiry_date;
      byCpu.set(key, c);
    }
    cpus = [...byCpu.values()]
      .map(c => ({ name: c.name, pct: Math.round((c.pass / c.total) * 100), total: c.total, due: c.nearestDue }))
      .sort((a, b) => a.pct - b.pct).slice(0, 6);
  }

  return (
    <PassportCentre
      rows={rows} kpis={kpis}
      selectedId={sel?.id ?? null} timeline={timeline} cpus={cpus}
    />
  );
}
