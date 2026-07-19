import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Publishing Tools ─────────────────────────────────────────────────────────
// The enterprise release-management & governance centre (Publishing Tools spec +
// developer functional spec). One workspace: a Publication Status header, a
// Publication Manager table over every publishable educational asset, eight
// governance modules (tabs) and a contextual per-resource panel.
//
// Honest-UI: the Publication Manager aggregates REAL records from the content
// stores that exist — frameworks, courses, learning pathways, knowledge
// objects, clinical cases, questions, practice units and learning resources —
// with owners resolved from profiles and status/version/approval derived from
// the actual columns. There is no dedicated release / scheduling / distribution
// / approval-workflow / publish-job store yet, so those KPIs and the modules
// that depend on them are shown muted or as honest scaffolds — never fabricated.

// Status buckets. LIVE = genuinely published/available; READY = approved but not
// yet live (its own kind, so it isn't miscounted as "Published — live"); the
// rest map as named. Anything unrecognised falls through to draft.
const LIVE = new Set(["published", "active", "live", "completed", "complete", "done", "finalized"]);
const READY = new Set(["approved", "ready"]);
const REVIEW = new Set(["review", "pending", "submitted", "in_review", "awaiting"]);
const ARCHIVED = new Set(["archived", "deprecated", "retired", "inactive"]);

export type StatusKind = "published" | "ready" | "draft" | "review" | "scheduled" | "archived" | "deprecated";
export type ApprovalKind = "approved" | "review" | "none" | "archived";

export type PubResource = {
  id: string;            // type-prefixed, unique across tables
  entityId: string;      // raw id, for audit matching
  title: string;
  type: string;
  typeKey: string;
  icon: string;
  status: string;
  statusKind: StatusKind;
  version: string | null;
  approval: string;
  approvalKind: ApprovalKind;
  owner: string;
  modified: string | null;
  target: string | null; // no distribution store yet → null
  deps: string | null;   // no dependency store yet → null
  checklist: { label: string; state: "done" | "pending" | "warn" }[];
  checklistPct: number;
  audit: Activity[];
};

export type Activity = { actor: string; action: string; entity: string | null; when: string | null };
export type Kpi = { label: string; value: number | null; sub: string; icon: string; tone: string; muted?: boolean };
export type Bar = { label: string; count: number; kind?: StatusKind };

export type PublishingHub = {
  kpis: Kpi[];
  resources: PubResource[];
  activity: Activity[];
  typeCounts: Bar[];
  statusCounts: Bar[];
  recentCount: number;
  capped: boolean;
  aiConfigured: boolean;
};

type SourceCfg = {
  key: string; type: string; icon: string; table: string; titleCol: string;
  statusFrom?: string; boolPub?: string; boolActive?: string; versionCol?: string; semver?: boolean; ownerCols?: string[];
};

const SOURCES: SourceCfg[] = [
  // Frameworks carry a real semver in version_major/minor/revision (version_num
  // is a legacy 0 counter); CPUs only have version_num.
  { key: "framework", type: "Framework", icon: "🏛️", table: "frameworks", titleCol: "name", statusFrom: "pub_status", semver: true, ownerCols: ["owner_id"] },
  { key: "course", type: "Course", icon: "📘", table: "courses", titleCol: "title", boolPub: "is_published" },
  { key: "pathway", type: "Learning Pathway", icon: "🧭", table: "learning_pathways", titleCol: "title", statusFrom: "status", ownerCols: ["nurse_id"] },
  { key: "knowledge", type: "Knowledge Object", icon: "💠", table: "knowledge_objects", titleCol: "title", statusFrom: "status", ownerCols: ["created_by"] },
  { key: "scenario", type: "Scenario", icon: "🧪", table: "clinical_cases", titleCol: "title", statusFrom: "status", ownerCols: ["created_by"] },
  { key: "question", type: "Question", icon: "❓", table: "questions", titleCol: "content", boolPub: "is_published" },
  { key: "cpu", type: "Practice Unit", icon: "🩺", table: "clinical_practice_units", titleCol: "name", statusFrom: "pub_status", versionCol: "version_num" },
  { key: "resource", type: "Resource", icon: "📚", table: "learning_resources", titleCol: "title", boolActive: "is_active" },
];

type Row = Record<string, unknown>;
type AuditRow = { actor_name: string | null; action: string | null; entity_id: string | null; entity_name: string | null; created_at: string | null };

const sevenDaysAgo = () => new Date(Date.now() - 7 * 864e5).toISOString();

// Fetch a store by dynamic table name WITHOUT dragging Supabase's per-table
// generic types through tsc — resolving `.from(string).select("*")` across the
// union of every table blows up the type checker (OOM). Casting to a minimal
// shape keeps inference cheap; rows are validated structurally at runtime.
type LooseResult = { data: unknown; error: { message: string } | null };
type LooseClient = { from: (t: string) => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<LooseResult> } } } };
export const ROW_CAP = 2000;
async function fetchRows(admin: Admin, table: string): Promise<Row[]> {
  const { data } = await (admin as unknown as LooseClient).from(table).select("*").order("created_at", { ascending: false }).limit(ROW_CAP);
  return (Array.isArray(data) ? data : []) as Row[];
}

const prettify = (raw: string) => raw.split(/[_\s]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function deriveStatus(row: Row, s: SourceCfg): { kind: StatusKind; label: string } {
  if (s.boolPub) return row[s.boolPub] ? { kind: "published", label: "Published" } : { kind: "draft", label: "Draft" };
  if (s.boolActive) return row[s.boolActive] ? { kind: "published", label: "Active" } : { kind: "archived", label: "Inactive" };
  const raw = String(row[s.statusFrom ?? ""] ?? "").toLowerCase();
  const kind: StatusKind = LIVE.has(raw) ? "published" : READY.has(raw) ? "ready" : REVIEW.has(raw) ? "review"
    : ARCHIVED.has(raw) ? "archived" : raw === "scheduled" ? "scheduled" : "draft";
  return { kind, label: raw ? prettify(raw) : "Draft" };
}
// Real version string. Frameworks: major.minor.revision. Others: a version_num
// counter (>0 only — 0 is the unset default, shown as "—").
function deriveVersion(row: Row, s: SourceCfg): string | null {
  if (s.semver && typeof row.version_major === "number") {
    const min = typeof row.version_minor === "number" ? row.version_minor : 0;
    const rev = typeof row.version_revision === "number" ? row.version_revision : 0;
    return `${row.version_major}.${min}.${rev}`;
  }
  if (s.versionCol) { const n = row[s.versionCol]; if (typeof n === "number" && n > 0) return String(n); }
  return null;
}
function deriveApproval(kind: StatusKind): { kind: ApprovalKind; label: string } {
  if (kind === "published" || kind === "ready" || kind === "scheduled") return { kind: "approved", label: "Approved" };
  if (kind === "review") return { kind: "review", label: "In Review" };
  if (kind === "archived" || kind === "deprecated") return { kind: "archived", label: "—" };
  return { kind: "none", label: "Not Started" };
}

export async function loadPublishingHub(admin: Admin): Promise<PublishingHub> {
  // Pull each store, the audit log, the owner directory and AI status together.
  // The dynamic-table fetches go through fetchRows (loosely typed); the two
  // fixed-table queries stay fully typed.
  const sourceResults = await Promise.all(SOURCES.map(async s => ({ s, rows: await fetchRows(admin, s.table) })));
  const [auditRes, profRes, configured] = await Promise.all([
    admin.from("audit_log").select("actor_name, action, entity_id, entity_name, created_at").order("created_at", { ascending: false }).limit(400),
    admin.from("profiles").select("id, full_name").limit(2000),
    import("@/lib/ai/config").then(m => m.aiStatus().configured).catch(() => false),
  ]);

  const nameById = new Map<string, string>();
  for (const p of (profRes.data ?? []) as { id: string; full_name: string | null }[]) nameById.set(p.id, p.full_name ?? "—");

  const auditRows = (auditRes.data ?? []) as AuditRow[];
  const auditByEntity = new Map<string, Activity[]>();
  for (const a of auditRows) {
    if (!a.entity_id) continue;
    const list = auditByEntity.get(a.entity_id) ?? [];
    if (list.length < 5) list.push({ actor: a.actor_name ?? "Someone", action: a.action ?? "updated", entity: a.entity_name, when: a.created_at });
    auditByEntity.set(a.entity_id, list);
  }

  const resources: PubResource[] = [];
  for (const { s, rows } of sourceResults) {
    for (const row of rows) {
      const { kind, label } = deriveStatus(row, s);
      const approval = deriveApproval(kind);
      const version = deriveVersion(row, s);
      const ownerId = (s.ownerCols ?? []).map(c => row[c]).find(Boolean) as string | undefined;
      const owner = ownerId ? (nameById.get(ownerId) ?? "—") : "—";
      const entityId = String(row.id);
      const title = String(row[s.titleCol] ?? "Untitled").replace(/\s+/g, " ").trim().slice(0, 140) || "Untitled";

      const checklist: PubResource["checklist"] = [
        { label: "Content created", state: "done" },
        { label: "Version assigned", state: version ? "done" : "pending" },
        { label: "Owner assigned", state: owner !== "—" ? "done" : "pending" },
        { label: "Approved", state: approval.kind === "approved" ? "done" : approval.kind === "review" ? "warn" : "pending" },
        { label: "Published", state: kind === "published" ? "done" : "pending" },
      ];
      const checklistPct = Math.round((checklist.filter(c => c.state === "done").length / checklist.length) * 100);

      resources.push({
        id: `${s.key}:${entityId}`, entityId, title, type: s.type, typeKey: s.key, icon: s.icon,
        status: label, statusKind: kind, version, approval: approval.label, approvalKind: approval.kind, owner,
        modified: (row.created_at as string) ?? null, target: null, deps: null,
        checklist, checklistPct, audit: auditByEntity.get(entityId) ?? [],
      });
    }
  }
  resources.sort((a, b) => String(b.modified ?? "").localeCompare(String(a.modified ?? "")));

  // If any store hit the row cap the aggregate counts are a floor, not a total —
  // surface that honestly rather than presenting a partial figure as complete.
  const capped = sourceResults.some(x => x.rows.length >= ROW_CAP);

  const count = (pred: (r: PubResource) => boolean) => resources.filter(pred).length;
  const drafts = count(r => r.statusKind === "draft");
  const pending = count(r => r.statusKind === "review");
  const published = count(r => r.statusKind === "published");
  const archived = count(r => r.statusKind === "archived" || r.statusKind === "deprecated");
  const since = sevenDaysAgo();
  const recentCount = auditRows.filter(a => String(a.created_at ?? "") >= since).length;

  const kpis: Kpi[] = [
    { label: "Draft Items", value: drafts, sub: "awaiting release", icon: "📝", tone: "text-violet-600 bg-violet-100" },
    { label: "Pending Approvals", value: pending, sub: pending ? "in review" : "none in review", icon: "🧑‍⚖️", tone: "text-amber-600 bg-amber-100" },
    { label: "Scheduled Releases", value: null, sub: "scheduling not enabled yet", icon: "🗓️", tone: "text-blue-600 bg-blue-100", muted: true },
    { label: "Published Resources", value: published, sub: "live to audiences", icon: "✅", tone: "text-emerald-600 bg-emerald-100" },
    { label: "Archived Resources", value: archived, sub: archived ? "retired / superseded" : "none archived", icon: "🗄️", tone: "text-gray-600 bg-gray-100" },
    { label: "Failed Publications", value: null, sub: "no publish pipeline yet", icon: "⚠️", tone: "text-rose-600 bg-rose-100", muted: true },
    { label: "Recent Activity", value: recentCount, sub: "audit events · 7 days", icon: "📈", tone: "text-cyan-600 bg-cyan-100" },
  ];

  const typeMap = new Map<string, number>();
  for (const r of resources) typeMap.set(r.type, (typeMap.get(r.type) ?? 0) + 1);
  const typeCounts: Bar[] = [...typeMap.entries()].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count);

  const statusOrder: StatusKind[] = ["published", "ready", "draft", "review", "scheduled", "archived", "deprecated"];
  const statusMap = new Map<StatusKind, number>();
  for (const r of resources) statusMap.set(r.statusKind, (statusMap.get(r.statusKind) ?? 0) + 1);
  const statusCounts: Bar[] = statusOrder.filter(k => statusMap.has(k)).map(k => ({ label: k.charAt(0).toUpperCase() + k.slice(1), count: statusMap.get(k)!, kind: k }));

  const activity: Activity[] = auditRows.slice(0, 12).map(a => ({ actor: a.actor_name ?? "Someone", action: a.action ?? "updated", entity: a.entity_name, when: a.created_at }));

  return { kpis, resources, activity, typeCounts, statusCounts, recentCount, capped, aiConfigured: configured };
}
