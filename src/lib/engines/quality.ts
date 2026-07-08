import { createAdminClient } from "@/lib/supabase/server";
import { indicatorStatus } from "@/lib/ckcm";

type Admin = ReturnType<typeof createAdminClient>;

// ============================================================
// Book III Ch.5 (Assessment Quality) + Ch.11 (Accreditation Intelligence)
// Pure computation over governed data — no AI required.
// ============================================================

export type CheckStatus = "pass" | "warn" | "fail";
export type AccreditationCheck = { label: string; status: CheckStatus; detail: string };
export type AssessorRow = {
  id: string; name: string; count: number; avg: number; delta: number;
  flag: "consistent" | "lenient" | "strict";
};
export type QualityReport = {
  checks: AccreditationCheck[];
  score: number;               // % of checks passing (pass=1, warn=0.5)
  assessors: AssessorRow[];
  overallAvg: number | null;
};

export async function qualityReport(admin: Admin, hospitalId: string): Promise<QualityReport> {
  const [
    { data: frameworks },
    { data: workers },
    { data: decisions },
    { data: credentials },
    { data: committees },
    { count: recentAudit },
    { data: assessments },
  ] = await Promise.all([
    admin.from("frameworks").select("id, pub_status, review_date").eq("is_active", true)
      .returns<{ id: string; pub_status: string | null; review_date: string | null }[]>(),
    admin.from("profiles").select("id").eq("hospital_id", hospitalId).eq("role", "nurse"),
    admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at")
      .order("created_at", { ascending: false }),
    admin.from("professional_credentials").select("verified, status, expiry_date").eq("hospital_id", hospitalId),
    admin.from("governance_committees").select("id, is_active, committee_members(id)"),
    admin.from("audit_log").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
    admin.from("assessments")
      .select("assessor_id, score, profiles!assessor_id(full_name), competency_cycles!inner(hospital_id)")
      .eq("status", "complete")
      .not("score", "is", null)
      .not("assessor_id", "is", null)
      .eq("competency_cycles.hospital_id", hospitalId),
  ]);

  // ── Accreditation checks (Ch.11) ─────────────────────────────
  const checks: AccreditationCheck[] = [];
  const add = (label: string, status: CheckStatus, detail: string) => checks.push({ label, status, detail });

  // 1. Framework publication status
  const fws = frameworks ?? [];
  const unpublished = fws.filter(f => (f.pub_status ?? "published") !== "published").length;
  add("All active frameworks published",
    fws.length === 0 ? "warn" : unpublished === 0 ? "pass" : "warn",
    fws.length === 0 ? "No active frameworks" : unpublished === 0 ? `${fws.length} frameworks published` : `${unpublished} of ${fws.length} not yet published`);

  // 2. Framework review currency
  const overdueReviews = fws.filter(f => f.review_date && new Date(f.review_date).getTime() < Date.now()).length;
  add("Framework reviews up to date",
    overdueReviews === 0 ? "pass" : "fail",
    overdueReviews === 0 ? "No overdue reviews" : `${overdueReviews} framework${overdueReviews !== 1 ? "s" : ""} past review date`);

  // 3. Workforce competency coverage — latest decision per (nurse, competency)
  const workerIds = new Set((workers ?? []).map(w => w.id));
  const seen = new Set<string>();
  const latest = (decisions ?? []).filter(d => {
    if (!workerIds.has(d.nurse_id)) return false;
    const k = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const coveredWorkers = new Set(latest.map(d => d.nurse_id)).size;
  const coverage = workerIds.size ? Math.round((coveredWorkers / workerIds.size) * 100) : 0;
  add("Workforce competency coverage",
    workerIds.size === 0 ? "warn" : coverage >= 80 ? "pass" : coverage >= 50 ? "warn" : "fail",
    workerIds.size === 0 ? "No workers registered" : `${coveredWorkers}/${workerIds.size} workers assessed (${coverage}%)`);

  // 4. No expired competencies outstanding
  const expired = latest.filter(d => d.expiry_date && new Date(d.expiry_date).getTime() < Date.now()).length;
  add("No expired competencies",
    expired === 0 ? "pass" : expired <= 5 ? "warn" : "fail",
    expired === 0 ? "All decisions current" : `${expired} expired decision${expired !== 1 ? "s" : ""} awaiting reassessment`);

  // 5. Credential verification
  const creds = credentials ?? [];
  const verifiedPct = creds.length ? Math.round((creds.filter(c => c.verified).length / creds.length) * 100) : null;
  const expiredCreds = creds.filter(c => c.status === "expired" || (c.expiry_date && new Date(c.expiry_date).getTime() < Date.now())).length;
  add("Credentials verified & current",
    creds.length === 0 ? "warn" : (verifiedPct! >= 90 && expiredCreds === 0) ? "pass" : expiredCreds > 0 ? "fail" : "warn",
    creds.length === 0 ? "No credentials recorded" : `${verifiedPct}% verified · ${expiredCreds} expired`);

  // 6. Governance committee in place
  const activeCommittees = (committees ?? []).filter(c => c.is_active && (c.committee_members ?? []).length > 0);
  add("Governance committee established",
    activeCommittees.length > 0 ? "pass" : "fail",
    activeCommittees.length > 0 ? `${activeCommittees.length} active committee${activeCommittees.length !== 1 ? "s" : ""} with members` : "No active committee with members");

  // 7. Audit trail active
  add("Audit trail active (30 days)",
    (recentAudit ?? 0) > 0 ? "pass" : "warn",
    `${recentAudit ?? 0} governance actions logged in the last 30 days`);

  // 8. Quality indicators on target (EQOS Ch.44) — skipped until migration 019 exists
  const { data: qIndicators, error: qiErr } = await admin
    .from("quality_indicators")
    .select("id, direction, target_value, escalation_value")
    .eq("is_active", true)
    .not("target_value", "is", null);
  if (!qiErr && (qIndicators ?? []).length > 0) {
    const { data: qMeas } = await admin
      .from("indicator_measurements")
      .select("indicator_id, value, period")
      .order("period", { ascending: false });
    const latestVal = new Map<string, number>();
    for (const m of qMeas ?? []) {
      if (!latestVal.has(m.indicator_id)) latestVal.set(m.indicator_id, Number(m.value));
    }
    const statuses = (qIndicators ?? []).map(i => indicatorStatus(
      latestVal.get(i.id) ?? null, Number(i.target_value),
      i.escalation_value == null ? null : Number(i.escalation_value), i.direction));
    const onTarget = statuses.filter(s => s === "on_target").length;
    const breaches = statuses.filter(s => s === "breach").length;
    add("Quality indicators on target",
      breaches > 0 ? "fail" : onTarget === statuses.length ? "pass" : "warn",
      `${onTarget}/${statuses.length} indicators meeting target${breaches ? ` · ${breaches} escalation breach${breaches !== 1 ? "es" : ""}` : ""}`);
  }

  const score = checks.length
    ? Math.round((checks.reduce((s, c) => s + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0) / checks.length) * 100)
    : 0;

  // ── Assessor consistency (Ch.5) ──────────────────────────────
  const byAssessor = new Map<string, { name: string; scores: number[] }>();
  for (const a of assessments ?? []) {
    const id = a.assessor_id as string;
    const name = (a.profiles as unknown as { full_name: string } | null)?.full_name ?? "Unknown";
    const entry = byAssessor.get(id) ?? { name, scores: [] };
    entry.scores.push(a.score as number);
    byAssessor.set(id, entry);
  }
  const allScores = (assessments ?? []).map(a => a.score as number);
  const overallAvg = allScores.length ? allScores.reduce((s, v) => s + v, 0) / allScores.length : null;

  const assessors: AssessorRow[] = [...byAssessor.entries()]
    .filter(([, e]) => e.scores.length >= 3) // need a minimum sample to be meaningful
    .map(([id, e]) => {
      const avg = e.scores.reduce((s, v) => s + v, 0) / e.scores.length;
      const delta = overallAvg != null ? avg - overallAvg : 0;
      return {
        id, name: e.name, count: e.scores.length,
        avg: Math.round(avg * 100) / 100,
        delta: Math.round(delta * 100) / 100,
        flag: (delta > 0.75 ? "lenient" : delta < -0.75 ? "strict" : "consistent") as AssessorRow["flag"],
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { checks, score, assessors, overallAvg: overallAvg != null ? Math.round(overallAvg * 100) / 100 : null };
}
