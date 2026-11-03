// UNIFIED-GOVERNANCE-V1 sections 5 and 7 -- the PURE half of the Controlled Content index and the Governance History page.
// Client-safe: no server import. "One item. One status. One obvious next action." This arranges what the existing readers
// return (Studio versions, the framework governance index, the clinical review, publication and audit trails); it adds no rule.
import type { GovernedVersionRow } from "@/lib/assessment/studio/read";
import { KIND_LABEL, type DefinitionKind, type LifecycleState } from "@/lib/assessment/studio/types";

export const SCOPE = "Competen Holdings";
const DASH = "—";

// ---- controlled content ----------------------------------------------------------------------------------------------

/** none = the identity is registered but has no version yet. */
export type StatusKey = "none" | LifecycleState;
export type StatusFilter = "all" | "draft" | "in_review" | "approved" | "published";
export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "draft", label: "Draft" }, { key: "in_review", label: "In review" }, { key: "approved", label: "Approved" }, { key: "published", label: "Published" },
];
export const STATUS_WORD: Record<StatusKey, string> = { none: "Not started", draft: "Draft", in_review: "In review", approved: "Approved", published: "Published", retired: "Retired" };

export interface ControlledRow {
  key: string;
  section: "studio" | "framework";
  title: string;
  code: string;
  type: string;
  scope: string;
  version: string;
  status: StatusKey;
  authors: string[];
  next: string;
  href: string;
}

/** The one next action for a Studio definition, by the status of its latest version. */
export function nextActionStudio(status: StatusKey): string {
  switch (status) {
    case "none": return "Create first draft";
    case "draft": return "Submit for review";
    case "in_review": return "Review & approve or request changes";
    case "approved": return "Publish";
    case "published": return "Create new version";
    default: return DASH;
  }
}

/** The one next action for a competency framework, by its publication status. A pending publication request is decided first. */
export function nextActionFramework(pubStatus: string, hasPendingRequest: boolean): string {
  if (hasPendingRequest || pubStatus === "in_review") return "Decide publication";
  switch (pubStatus) {
    case "draft": return "Put competencies forward for clinical review";
    case "approved": return "Publish";
    case "published": return "Create revision draft";
    default: return DASH;
  }
}

export function frameworkStatus(pubStatus: string): StatusKey {
  if (pubStatus === "archived") return "retired";
  return pubStatus === "draft" || pubStatus === "in_review" || pubStatus === "approved" || pubStatus === "published" ? pubStatus : "draft";
}

/** The latest version of each definition (highest version number), per kind. Pure. */
export function latestPerDefinition(rows: readonly GovernedVersionRow[]): GovernedVersionRow[] {
  const best = new Map<string, GovernedVersionRow>();
  for (const r of rows) {
    const k = `${r.kind}:${r.definitionId}`;
    const cur = best.get(k);
    if (!cur || r.versionNo > cur.versionNo) best.set(k, r);
  }
  return [...best.values()];
}

export interface RegisteredIdentity { id: string; code: string; name: string; versions: number }

/** Studio rows: the latest version of every definition, plus registered checklists that have no version yet. Newest first. */
export function studioRows(versions: readonly GovernedVersionRow[], identities: readonly RegisteredIdentity[], names: Record<string, string>): ControlledRow[] {
  const withVersion: ControlledRow[] = latestPerDefinition(versions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((v) => ({
    key: `${v.kind}:${v.versionId}`, section: "studio", title: v.name || v.code || "Untitled", code: v.code, type: KIND_LABEL[v.kind as DefinitionKind], scope: SCOPE,
    version: `v${v.versionNo}`, status: v.state, authors: [...new Set(v.authoredBy.map((id) => names[id] ?? "Unnamed person"))], next: nextActionStudio(v.state), href: v.href,
  }));
  const bare: ControlledRow[] = identities.filter((i) => i.versions === 0).map((i) => ({
    key: `instrument-new:${i.id}`, section: "studio", title: i.name || i.code, code: i.code, type: KIND_LABEL.instrument, scope: SCOPE,
    version: DASH, status: "none", authors: [], next: nextActionStudio("none"), href: `/super-admin/checklist-studio/${i.id}`,
  }));
  return [...withVersion, ...bare];
}

export function statusMatches(status: StatusKey, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "draft") return status === "draft" || status === "none";
  return status === filter;
}

/** Status filter plus a case-insensitive text search over title and code. */
export function filterControlled(rows: readonly ControlledRow[], filter: StatusFilter, query: string): ControlledRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => statusMatches(r.status, filter) && (!q || r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)));
}

/** "12 items: 4 draft, 2 in review, 1 approved, 5 published" (retired are counted in the total and named when present). */
export function summaryLine(rows: readonly ControlledRow[]): string {
  if (!rows.length) return "No items";
  const n = (f: StatusFilter) => rows.filter((r) => statusMatches(r.status, f)).length;
  const parts = [`${n("draft")} draft`, `${n("in_review")} in review`, `${n("approved")} approved`, `${n("published")} published`];
  const retired = rows.filter((r) => r.status === "retired").length;
  if (retired) parts.push(`${retired} retired`);
  return `${rows.length} item${rows.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

// ---- governance history ----------------------------------------------------------------------------------------------

export type HistoryType = "checklist" | "clinical" | "framework" | "organisation";
export const HISTORY_TYPE_LABEL: Record<HistoryType, string> = {
  checklist: "Checklist and Studio", clinical: "Clinical review", framework: "Framework publication", organisation: "Organisation",
};

export interface HistoryItem {
  id: string;
  at: string;
  type: HistoryType;
  who: string;
  what: string;
  item: string | null;
  href: string | null;
  detail: string | null;
}

export interface TrailInput { at: string; kind: "event" | "decision"; label: string; actorId: string | null; versionTable: string; versionId: string; detail: string | null }
export interface ClinicalInput { versionId: string; reviewerId: string; decision: string; comment: string | null; at: string; competency: string | null; frameworkId: string | null }
export interface PublicationInput { frameworkId: string; frameworkName: string; versionNum: number; label: string | null; at: string; by: string | null }
export interface OrganisationInput { id: string; at: string; actor: string | null; action: string; entity: string | null }

export const HISTORY_LIMIT = 200;

/** "hq_appointment_scope_set" becomes "Appointment scope set". */
export function plainAction(action: string): string {
  const s = action.replace(/^hq_/, "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Change";
}

const UNNAMED = "Unnamed person";

/** One reverse-chronological list from the four sources. A source that could not be read is passed as empty by the caller, which says so. */
export function buildHistory(src: {
  trail?: readonly TrailInput[]; versions?: readonly GovernedVersionRow[]; clinical?: readonly ClinicalInput[];
  publications?: readonly PublicationInput[]; organisation?: readonly OrganisationInput[]; names: Record<string, string>; limit?: number;
}): HistoryItem[] {
  const byVersion = new Map((src.versions ?? []).map((v) => [v.versionId, v]));
  const out: HistoryItem[] = [];
  for (const [i, t] of (src.trail ?? []).entries()) {
    const v = byVersion.get(t.versionId);
    out.push({
      id: `c${i}:${t.versionId}:${t.at}`, at: t.at, type: "checklist", who: t.actorId ? src.names[t.actorId] ?? UNNAMED : "System", what: t.label,
      item: v ? `${v.name || v.code} v${v.versionNo}` : "A definition version", href: v ? v.href : null, detail: t.detail,
    });
  }
  for (const [i, c] of (src.clinical ?? []).entries()) {
    out.push({
      id: `k${i}:${c.versionId}:${c.at}`, at: c.at, type: "clinical", who: src.names[c.reviewerId] ?? UNNAMED,
      what: c.decision === "approved" ? "Approved after clinical review" : c.decision === "rejected" ? "Asked for changes after clinical review" : `Clinical review: ${c.decision}`,
      item: c.competency ?? "Clinical content", href: c.frameworkId ? `/super-admin/competencies/governance/${c.frameworkId}` : null, detail: c.comment,
    });
  }
  for (const [i, p] of (src.publications ?? []).entries()) {
    out.push({
      id: `p${i}:${p.frameworkId}:${p.versionNum}`, at: p.at, type: "framework", who: p.by ?? "Not recorded", what: `Published version ${p.label ?? p.versionNum}`,
      item: p.frameworkName, href: `/super-admin/competencies/governance/${p.frameworkId}`, detail: null,
    });
  }
  for (const o of src.organisation ?? []) {
    out.push({ id: `o:${o.id}`, at: o.at, type: "organisation", who: o.actor ?? "Not recorded", what: plainAction(o.action), item: o.entity, href: null, detail: null });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, src.limit ?? HISTORY_LIMIT);
}

export function filterHistory(items: readonly HistoryItem[], type: HistoryType | "all", query: string): HistoryItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => (type === "all" || i.type === type) && (!q || [i.who, i.what, i.item ?? "", i.detail ?? ""].some((s) => s.toLowerCase().includes(q))));
}
