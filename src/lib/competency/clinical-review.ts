/* eslint-disable @typescript-eslint/no-explicit-any */
import { activeGrants } from "@/lib/hq/spaces";

// ── COMPETEN HOLDINGS CLINICAL-CONTENT APPROVAL ── migration 395, owner decisions D2 and D3 ─────────────────
//
// "Clinically approved" is a fact the database proves: an appointed reviewer, independent of whoever wrote or
// edited the content, within a scope their appointment holds, approved the EXACT content version -- the
// content hash competency_content_hash() computes from name, description, outcomes, expected level, practice,
// CPU, risk and skills. Change any of those and the approval no longer describes the competency: it is STALE
// and the content needs a new version and renewed approval. One independent approval by default; more for
// higher-risk content, by configuration.
//
// ⚠ SEPARATE FROM PUBLICATION. Publishing a framework or a controlled catalogue (394) approves nothing
// clinically, and approval publishes nothing. A catalogue shows each competency's clinical state beside it.
//
// ⚠ THE DATABASE REFUSES, THIS MODULE EXPLAINS. Independence, authority, scope and currency are enforced by
// the 395 triggers. This module only shapes the requests and turns a refusal into words.
//
// ⚠ NOTHING PROFESSION-SPECIFIC. A scope is a profession or specialty term, a framework or a domain -- data.

export type ClinicalState = "approved" | "in_review" | "changes_requested" | "stale" | "unreviewed";
export type ClinicalReview = {
  state: ClinicalState;
  /** Independent approvals of the CURRENT content version, and how many it needs. */
  approvals: number;
  required: number;
  versionId: string | null;
  approvedAt: string | null;
};
type VersionRow = { id: string; competency_id: string; content_hash: string; required_approvals: number; created_at: string };
type DecisionRow = { version_id: string; decision: string; created_at: string };

export const CLINICAL_STATE_LABEL: Record<ClinicalState, string> = {
  approved: "Clinically approved",
  in_review: "In clinical review",
  changes_requested: "Clinical reviewer asked for changes",
  stale: "Changed since its clinical approval",
  unreviewed: "Not clinically reviewed",
};

/** Words for the state, with the counts that explain it. Never says approved unless it is. */
export function clinicalNote(r: ClinicalReview): string {
  switch (r.state) {
    case "approved": return `Approved by ${r.approvals} independent clinical reviewer${r.approvals === 1 ? "" : "s"} for this exact content.`;
    case "in_review": return `${r.approvals} of ${r.required} independent approval${r.required === 1 ? "" : "s"} so far.`;
    case "changes_requested": return "A clinical reviewer asked for changes to this content version.";
    case "stale": return "The content changed after it was approved, so it needs renewed approval.";
    default: return "No clinical reviewer has approved this content.";
  }
}

/** Pure: the clinical state of one competency from its current content hash and its review records. */
export function clinicalStatus(currentHash: string | null, versions: readonly VersionRow[], decisions: readonly DecisionRow[]): ClinicalReview {
  const none: ClinicalReview = { state: "unreviewed", approvals: 0, required: 1, versionId: null, approvedAt: null };
  const byVersion = (id: string) => decisions.filter(d => d.version_id === id);
  const done = (v: VersionRow) => { const ds = byVersion(v.id); return !ds.some(d => d.decision === "rejected") && ds.filter(d => d.decision === "approved").length >= v.required_approvals; };
  const current = currentHash ? versions.find(v => v.content_hash === currentHash) : undefined;
  if (!current) return versions.some(done) ? { ...none, state: "stale" } : none;
  const ds = byVersion(current.id);
  const approvals = ds.filter(d => d.decision === "approved");
  const base = { approvals: approvals.length, required: current.required_approvals, versionId: current.id, approvedAt: null };
  if (ds.some(d => d.decision === "rejected")) return { ...base, state: "changes_requested" };
  if (approvals.length >= current.required_approvals) {
    const at = approvals.map(d => d.created_at).sort()[current.required_approvals - 1] ?? null;
    return { ...base, state: "approved", approvedAt: at };
  }
  return { ...base, state: "in_review" };
}

// An undefined table or function (Postgres, PostgREST schema cache): 395 is not applied here. Nothing has
// been clinically reviewed on such an environment, which is a true "unreviewed", not an unreadable store.
const NOT_PROVISIONED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const absent = (e: any) => !!e && NOT_PROVISIONED.has(String(e.code ?? ""));

/** The clinical state of many competencies. null = could not be read. Before 395: every one unreviewed. */
export async function loadClinicalReviews(admin: any, competencyIds: readonly string[]): Promise<Map<string, ClinicalReview> | null> {
  const ids = [...new Set(competencyIds)];
  const out = new Map<string, ClinicalReview>();
  if (!ids.length) return out;
  try {
    const h = await admin.rpc("competency_content_hashes", { p_ids: ids });
    if (absent(h.error)) { for (const id of ids) out.set(id, clinicalStatus(null, [], [])); return out; }
    if (h.error) return null;
    const v = await admin.from("clinical_content_version").select("id, competency_id, content_hash, required_approvals, created_at").in("competency_id", ids);
    if (v.error) return absent(v.error) ? new Map(ids.map(id => [id, clinicalStatus(null, [], [])])) : null;
    const versions: VersionRow[] = v.data ?? [];
    const d = versions.length ? await admin.from("clinical_review_decision").select("version_id, decision, created_at").in("version_id", versions.map(x => x.id)) : { data: [] };
    if (d.error) return null;
    const hash = new Map<string, string>((h.data ?? []).map((r: any) => [r.competency_id, r.content_hash]));
    for (const id of ids) out.set(id, clinicalStatus(hash.get(id) ?? null, versions.filter(x => x.competency_id === id), d.data ?? []));
    return out;
  } catch { return null; }
}

// ── CONFIGURATION: how many independent approvals content needs ── the CONFIG-002 engine, Holdings scope ──
export const CLINICAL_SCOPE = { scopeType: "platform", scopeRef: "holdings_clinical" } as const;
export const CLINICAL_PATH = { standard: "holdings.clinical.required_approvals.standard", high: "holdings.clinical.required_approvals.high" } as const;
export const REQUIRED_DEFAULT = { standard: 1, high: 1 } as const;
export const REQUIRED_MIN = 1, REQUIRED_MAX = 5;
const clampCount = (v: unknown, fallback: number) => { const n = Number((v as any)?.value); return Number.isInteger(n) ? Math.min(REQUIRED_MAX, Math.max(REQUIRED_MIN, n)) : fallback; };

/** The published review counts. Fail-soft to one independent approval -- never to none. */
export async function loadRequiredApprovals(admin: any): Promise<{ standard: number; high: number }> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("config_path, published")
      .eq("scope_type", CLINICAL_SCOPE.scopeType).eq("scope_ref", CLINICAL_SCOPE.scopeRef);
    if (error) return { ...REQUIRED_DEFAULT };
    const get = (p: string) => (data ?? []).find((r: any) => r.config_path === p)?.published;
    return { standard: clampCount(get(CLINICAL_PATH.standard), REQUIRED_DEFAULT.standard), high: clampCount(get(CLINICAL_PATH.high), REQUIRED_DEFAULT.high) };
  } catch { return { ...REQUIRED_DEFAULT }; }
}

/** Pure: the risk a competency is reviewed at -- its own risk category, else its CPU's. */
export function reviewRisk(competencyRisk: string | null | undefined, cpuRisk: string | null | undefined): "high" | "standard" {
  return competencyRisk === "high" || cpuRisk === "high" ? "high" : "standard";
}

// Audit actions that record governance of content rather than authorship of it.
const NOT_AUTHORSHIP = new Set(["submit_review", "approve_content", "reject_content", "publish", "archive", "revert",
  "catalogue_entry_add", "catalogue_entry_status", "catalogue_entry_remove", "catalogue_entry_review", "clinical_review_submitted", "clinical_review_decided",
  "clinical_scope_added", "clinical_scope_ended", "framework_specialty_set"]);

/** Pure: who authored or materially edited a competency, from its audit trail and the person putting it forward. */
export function authorsOf(submitter: string, audit: readonly { actor_id: string | null; action: string }[]): string[] {
  return [...new Set([submitter, ...audit.filter(a => a.actor_id && !NOT_AUTHORSHIP.has(a.action)).map(a => a.actor_id as string)])];
}

/** Put a competency's CURRENT content forward for clinical review. The database computes what is reviewed. */
export async function submitForReview(admin: any, competencyId: string, submitter: string)
  : Promise<{ ok: true; versionId: string; required: number } | { ok: false; error: string }> {
  const { data: c, error } = await admin.from("framework_competencies").select("id, domain_id, risk_category, cpu_id").eq("id", competencyId).maybeSingle();
  if (error) return { ok: false, error: "The competency could not be read just now." };
  if (!c) return { ok: false, error: "That competency does not exist." };
  const { data: d } = await admin.from("framework_domains").select("framework_id").eq("id", c.domain_id).maybeSingle();
  const [cpu, audit, required] = await Promise.all([
    c.cpu_id ? admin.from("clinical_practice_units").select("risk_category").eq("id", c.cpu_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("audit_log").select("actor_id, action").or(`entity_id.eq.${c.id}${d?.framework_id ? `,entity_id.eq.${d.framework_id}` : ""}`).limit(2000),
    loadRequiredApprovals(admin),
  ]);
  if (audit.error) return { ok: false, error: "The authorship trail could not be read, so nothing was put forward." };
  const risk = reviewRisk(c.risk_category, cpu.data?.risk_category);
  const { data: v, error: insErr } = await admin.from("clinical_content_version").insert({
    competency_id: c.id, content_hash: "computed-by-trigger", content_snapshot: {}, authored_by: authorsOf(submitter, audit.data ?? []),
    submitted_by: submitter, required_approvals: required[risk], risk_basis: `${risk} risk`,
  }).select("id, required_approvals").single();
  if (insErr) return { ok: false, error: /duplicate key|unique/i.test(insErr.message) ? "This exact content is already in clinical review." : reviewRefusal(insErr.message) };
  return { ok: true, versionId: v.id, required: v.required_approvals };
}

/** Pure: a 395 refusal, in words. */
export function reviewRefusal(message: string | undefined): string {
  const m = message ?? "";
  if (/not independent/i.test(m)) return "You authored, edited or put forward this content, or an earlier version of it, so you cannot review it. Another reviewer must.";
  if (/not authorised/i.test(m)) return "You do not hold an active clinical reviewer appointment for this.";
  if (/out of scope/i.test(m)) return "This content is outside the scope of your clinical reviewer appointment.";
  if (/stale/i.test(m)) return "The content has changed since this version was put forward. It needs a new version and renewed review.";
  if (/shared frameworks/i.test(m)) return "Only competencies of shared frameworks are reviewed here.";
  if (/duplicate key|unique/i.test(m)) return "You have already recorded a decision on this version.";
  return "The decision could not be recorded just now.";
}

/** Record one reviewer's decision on one version, under one of their appointments. */
export async function decideReview(admin: any, versionId: string, reviewerId: string, appointmentId: string, decision: "approved" | "rejected", comment: string | null)
  : Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from("clinical_review_decision").insert({ version_id: versionId, reviewer_id: reviewerId, appointment_id: appointmentId, decision, comment });
  return error ? { ok: false, error: reviewRefusal(error.message) } : { ok: true };
}

// ── REVIEWERS AND SCOPES ─────────────────────────────────────────────────────────────────────────────────
export const REVIEWER_POSITION = "clinical_content_reviewer";
export const SCOPE_KINDS = ["profession", "specialty", "framework", "domain"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export type ReviewerScope = { id: string; appointmentId: string; kind: ScopeKind; ref: string };

/** Pure: whether one appointment's scopes cover a competency (the same rule as clinical_scope_covers). */
export function scopeCovers(scopes: readonly ReviewerScope[], c: { domainId: string; frameworkId: string; professionTermId: string | null; specialtyTermId: string | null }): boolean {
  return scopes.some(s => (s.kind === "profession" && s.ref === c.professionTermId) || (s.kind === "specialty" && s.ref === c.specialtyTermId)
    || (s.kind === "framework" && s.ref === c.frameworkId) || (s.kind === "domain" && s.ref === c.domainId));
}

export const APPROVE_CAPABILITY = "hq.quality.clinical.approve";

/**
 * The positions that grant clinical approval now. ⚠ HQ-SOD-CROSSCUT-01: since migration 640 that is ANY position
 * holding hq.quality.clinical.approve (a cross-cutting one such as scholar_clinical_lead included), not only
 * REVIEWER_POSITION. It is the same test the 395/461 trigger makes for every decision. null = unreadable.
 */
export async function approverPositions(admin: any): Promise<string[] | null> {
  const { data, error } = await admin.from("hq_position_capability")
    .select("position_code, effective_from, effective_to").eq("capability_code", APPROVE_CAPABILITY).limit(500);
  if (error) return null;
  return [...new Set(activeGrants((data ?? []) as { position_code: string; effective_from: string | null; effective_to: string | null }[]).map(g => g.position_code))].sort();
}

/** A person's active clinical reviewer appointments (any position granting approval) and their active scopes. */
export async function reviewerAppointments(admin: any, personId: string): Promise<{ id: string; scopes: ReviewerScope[] }[] | null> {
  const positions = await approverPositions(admin);
  if (positions === null) return null;
  if (!positions.length) return [];
  const { data: appts, error } = await admin.from("ogs_office_appointments").select("id").eq("person_id", personId).in("role", positions).eq("status", "active");
  if (error) return null;
  if (!appts?.length) return [];
  const { data: sc, error: sErr } = await admin.from("clinical_reviewer_scope").select("id, appointment_id, scope_kind, scope_ref").in("appointment_id", appts.map((a: any) => a.id)).is("ended_at", null);
  if (sErr) return absent(sErr) ? appts.map((a: any) => ({ id: a.id, scopes: [] })) : null;
  return appts.map((a: any) => ({ id: a.id, scopes: (sc ?? []).filter((s: any) => s.appointment_id === a.id).map((s: any) => ({ id: s.id, appointmentId: a.id, kind: s.scope_kind, ref: s.scope_ref })) }));
}
