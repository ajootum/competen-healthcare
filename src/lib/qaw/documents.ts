// QAW-008 Documents, Policies & Evidence Centre — central controlled-document library (policies, SOPs,
// guidelines, protocols, forms, work instructions) plus the evidence repository. Grounded in adm_documents
// (the controlled-document spine, migration 109) with a fallback to the policies store (007) when a tenant
// has no adm_documents rows, and the evidence repository (029) for the evidence widgets. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const DOC_TONE: Record<string, string> = { policy: "teal", sop: "blue", guideline: "indigo", protocol: "violet", form: "amber", work_instruction: "slate" };
const TONE_CYCLE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];
const EV_TONE: Record<string, string> = { evidence: "teal", credential_document: "blue" };
// Controlled-document status enum in lifecycle order (adm_documents.status).
const STATUSES: [string, string, string][] = [
  ["draft", "Draft", "slate"],
  ["in_review", "In review", "amber"],
  ["pending_approval", "Pending approval", "violet"],
  ["published", "Published", "emerald"],
  ["archived", "Archived", "gray"],
];

export async function loadDocuments(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Primary controlled-document spine + secondary policy store + evidence repository.
  const { data: admRows, error: admErr } = await scope(admin.from("adm_documents").select("id, title, doc_type, category, status, version, review_date, created_at").limit(5000));
  const { data: polRows, error: polErr } = await scope(admin.from("policies").select("id, title, policy_type, version, review_date, is_active, created_at").limit(5000));
  const { data: evRows, error: evErr } = await scope(admin.from("evidence").select("id, kind").limit(5000));

  // Both controlled-document sources missing → surface an honest "not provisioned" state.
  if (admErr && polErr) return { provisioned: false as const };

  const adm = (admErr ? [] : (admRows ?? [])) as any[];
  const pols = (polErr ? [] : (polRows ?? [])) as any[];
  const ev = (evErr ? [] : (evRows ?? [])) as any[];

  // Unified document spine: adm_documents when present, else the policies store (fallback), normalised
  // to one shape so every category / status / lifecycle widget reads a single honest source.
  const spineSource: "adm_documents" | "policies" = adm.length ? "adm_documents" : (pols.length ? "policies" : "adm_documents");
  const docs = adm.length
    ? adm.map(x => ({ title: x.title, doc_type: x.doc_type ?? "policy", status: x.status ?? "draft", version: x.version ?? null, review_date: x.review_date ?? null, created_at: x.created_at ?? null }))
    : pols.map(p => ({ title: p.title, doc_type: "policy", status: p.is_active ? "published" : "archived", version: p.version ?? null, review_date: p.review_date ?? null, created_at: p.created_at ?? null }));

  // ── KPIs.
  const total = docs.length;
  const policiesProcs = adm.filter(x => x.doc_type === "policy").length + pols.length;
  const evidenceItems = ev.length;
  const needReview = docs.filter(x => x.review_date && x.review_date < today).length;
  const pendingApprovals = docs.filter(x => ["pending_approval", "in_review"].includes(x.status)).length;
  const expiring = docs.filter(x => x.review_date && x.review_date >= today && x.review_date <= in30).length;

  // ── Documents by category (doc_type).
  const catMap = new Map<string, number>();
  docs.forEach(x => catMap.set(x.doc_type, (catMap.get(x.doc_type) ?? 0) + 1));
  const byCategory = [...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, pct: total ? Math.round((value / total) * 100) : 0, tone: DOC_TONE[label] ?? TONE_CYCLE[i % TONE_CYCLE.length] }));

  // ── Status mix (full enum) + the approval-stage subset (draft → published).
  const statusBreak = STATUSES.map(([key, label, tone]) => ({ label, tone, value: docs.filter(x => x.status === key).length }));
  const approvalFlow = STATUSES.slice(0, 4).map(([key, label, tone]) => ({ label, tone, value: docs.filter(x => x.status === key).length }));

  // ── Top documents — published first, then most recently created.
  const topDocs = [...docs]
    .sort((a, b) => (a.status === "published" ? 0 : 1) - (b.status === "published" ? 0 : 1) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, 7)
    .map(x => ({ title: x.title, doc_type: x.doc_type, status: x.status, version: x.version, review_date: x.review_date }));

  // ── Expiring soon — every doc with a review_date, soonest (and overdue) first.
  const expiringSoon = docs.filter(x => x.review_date)
    .sort((a, b) => String(a.review_date).localeCompare(String(b.review_date)))
    .slice(0, 7)
    .map(x => ({ title: x.title, doc_type: x.doc_type, review_date: x.review_date, daysLeft: Math.round((Date.parse(String(x.review_date)) - Date.parse(today)) / 86400000) }));

  // ── Evidence by source (kind).
  const evMap = new Map<string, number>();
  ev.forEach(e => { const kind = e.kind ?? "evidence"; evMap.set(kind, (evMap.get(kind) ?? 0) + 1); });
  const evidenceBySource = [...evMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: label.replace(/_/g, " "), value, pct: evidenceItems ? Math.round((value / evidenceItems) * 100) : 0, tone: EV_TONE[label] ?? "slate" }));

  // ── Recent activity — newest documents by created_at.
  const recent = [...docs].filter(x => x.created_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 6)
    .map(x => ({ title: x.title, doc_type: x.doc_type, status: x.status, when: String(x.created_at).slice(0, 10) }));

  return {
    provisioned: true as const,
    spineSource,
    kpis: { total, policiesProcs, evidence: evidenceItems, needReview, pendingApprovals, expiring },
    byCategory, statusBreak, approvalFlow, topDocs, expiringSoon, evidenceBySource, recent,
  };
}
