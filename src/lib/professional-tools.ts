import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Professional Tools ───────────────────────────────────────────────────────
// The educator productivity centre (Professional Tools spec v1.0 + developer
// functional spec). A hub landing with eight module cards; each opens a module
// workspace sharing the enterprise structure every module defines: six KPI
// cards, a repository, a create→archive workflow, AI insights and quick actions.
//
// Honest-UI: counts and repository rows are live from real records for the four
// modules that have a backing store — Template Library → frameworks, Question
// Bank → questions, Scenario Library → clinical_cases, Resource Library →
// knowledge_objects. AI-generation provenance, cross-user sharing and version
// compliance aren't metered yet, so those KPI cards are shown muted, never
// fabricated. The four modules with no store yet (AI Prompt Library, Content
// Import & Export, Lesson & Session Templates, Document Generator) render an
// honest scaffold and link to the live tool where one already exists.

const REVIEW = new Set(["review", "pending", "submitted", "in_review", "awaiting"]);
const PUBLISHED = new Set(["published", "active", "approved"]);

export type ProfCategory = "content" | "assessment" | "resource" | "productivity";

export type ProfModule = {
  slug: string;
  title: string;
  icon: string;
  tint: string;          // tailwind classes for the icon chip
  blurb: string;         // card description
  purpose: string;       // module-page purpose line (from spec)
  features: string[];    // four card bullets
  countLabel: string;    // e.g. "Prompts", "Templates"
  category: ProfCategory;
  live: boolean;         // backed by a real store?
  launchHref?: string;   // deep-link to the fuller existing tool, if any
  launchLabel?: string;
};

export const PROF_CATEGORIES: { key: ProfCategory | "all"; label: string }[] = [
  { key: "all", label: "All Tools" },
  { key: "content", label: "Content Creation" },
  { key: "assessment", label: "Assessment Tools" },
  { key: "resource", label: "Resource Management" },
  { key: "productivity", label: "Productivity" },
];

export const PROF_MODULES: ProfModule[] = [
  { slug: "prompts", title: "AI Prompt Library", icon: "🧠", tint: "text-violet-600 bg-violet-100",
    blurb: "Create, manage and reuse AI prompts for teaching, assessment, simulation and more.",
    purpose: "The institutional repository for reusable AI prompts that support teaching, assessment, curriculum design, simulation, competency mapping, reporting and educational content creation.",
    features: ["Save and organise prompts", "Share with colleagues", "Version control", "AI prompt recommendations"],
    countLabel: "Prompts", category: "content", live: false },
  { slug: "templates", title: "Template Library", icon: "🗂️", tint: "text-blue-600 bg-blue-100",
    blurb: "Access and manage templates for lessons, assessments, OSCEs, scenarios and more.",
    purpose: "Institution-approved templates for lessons, assessments, OSCEs, scenarios and frameworks — versioned and reusable across authorised educators.",
    features: ["Browse by category", "Create custom templates", "Use and reuse templates", "Institution approved templates"],
    countLabel: "Templates", category: "content", live: true, launchHref: "/educator/studio", launchLabel: "Open Education Studio" },
  { slug: "import-export", title: "Content Import & Export", icon: "🔁", tint: "text-cyan-600 bg-cyan-100",
    blurb: "Import and export content across multiple formats and data types.",
    purpose: "Bulk content exchange — import from Excel, CSV and Word and export reports and frameworks, with validation and mapping across formats such as QTI, SCORM and JSON.",
    features: ["Bulk import from Excel, CSV, Word", "Export reports and frameworks", "Support for QTI, SCORM, JSON", "Import validation & mapping"],
    countLabel: "Imports", category: "resource", live: false, launchHref: "/educator/import", launchLabel: "Open Import tool" },
  { slug: "questions", title: "Question Bank Manager", icon: "❓", tint: "text-amber-600 bg-amber-100",
    blurb: "Build, manage and analyse your question bank and assessments.",
    purpose: "The assessment item repository — build, calibrate and analyse questions, map them to blueprints and track their performance.",
    features: ["AI Question Builder", "Difficulty calibration", "Blueprint mapping", "Performance analytics"],
    countLabel: "Questions", category: "assessment", live: true, launchHref: "/educator/questions", launchLabel: "Open Question Bank" },
  { slug: "lessons", title: "Lesson & Session Templates", icon: "🗒️", tint: "text-emerald-600 bg-emerald-100",
    blurb: "Create and organise lesson and teaching session templates.",
    purpose: "Structured lesson and teaching-session planning — multiple session types with competency mapping, time and activity planning and reusable structures.",
    features: ["Multiple session types", "Competency mapping", "Time & activity planning", "Reusable structures"],
    countLabel: "Templates", category: "content", live: false },
  { slug: "scenarios", title: "Scenario Library", icon: "🧪", tint: "text-fuchsia-600 bg-fuchsia-100",
    blurb: "Create, organise and manage clinical and simulation scenarios.",
    purpose: "The repository for clinical and simulation scenarios — author scenarios, map learning outcomes, attach debrief and scoring templates, and reuse across cohorts.",
    features: ["Scenario authoring", "Learning outcomes mapping", "Debrief & scoring templates", "Reuse and versioning"],
    countLabel: "Scenarios", category: "assessment", live: true, launchHref: "/educator/simulation", launchLabel: "Open Simulation" },
  { slug: "resources", title: "Resource Library", icon: "📚", tint: "text-indigo-600 bg-indigo-100",
    blurb: "Store, organise and share teaching and learning resources.",
    purpose: "The learning resource repository — books, videos, policies and images, tagged to competencies, versioned and shareable.",
    features: ["Books, videos, policies, images", "Competency tagging", "Version control", "Usage analytics"],
    countLabel: "Resources", category: "resource", live: true, launchHref: "/educator/library", launchLabel: "Open Library" },
  { slug: "documents", title: "Document Generator", icon: "📄", tint: "text-rose-600 bg-rose-100",
    blurb: "Automatically generate documents, reports and certificates.",
    purpose: "AI-assisted document creation — generate lesson plans, assessment reports, competency reports and accreditation evidence.",
    features: ["Lesson plans", "Assessment reports", "Competency reports", "Accreditation evidence"],
    countLabel: "Documents", category: "productivity", live: false },
];

// Backing store for each live module. select("*") is fine — the largest of
// these tables holds a few dozen rows.
type Source = { table: string; titleCol: string; versioned?: boolean; metaCol?: string; metaLabel?: string };
const SOURCES: Record<string, Source> = {
  templates: { table: "frameworks", titleCol: "name", versioned: true },
  questions: { table: "questions", titleCol: "content", metaCol: "difficulty", metaLabel: "difficulty" },
  scenarios: { table: "clinical_cases", titleCol: "title", metaCol: "difficulty", metaLabel: "difficulty" },
  resources: { table: "knowledge_objects", titleCol: "title", metaCol: "knowledge_type", metaLabel: "type" },
};

export type Kpi = { label: string; value: number | string | null; sub: string; muted?: boolean };
export type Asset = { id: string; title: string; status: string; meta: string | null; version: number | null; updated: string | null };
export type Activity = { actor: string; action: string; entity: string | null; when: string | null };
type AuditRow = { actor_name: string | null; action: string | null; entity_name: string | null; created_at: string | null };
type Row = Record<string, unknown>;

const sevenDaysAgo = () => new Date(Date.now() - 7 * 864e5).toISOString();

function rawStatus(row: Row): string {
  if (typeof row.is_published === "boolean") return row.is_published ? "published" : "draft";
  return String(row.pub_status ?? row.status ?? "").toLowerCase();
}
function statusLabel(row: Row): string {
  const s = rawStatus(row);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}
function mapActivity(rows: AuditRow[]): Activity[] {
  return rows.map(a => ({ actor: a.actor_name ?? "Someone", action: a.action ?? "updated an item", entity: a.entity_name, when: a.created_at }));
}
async function aiConfigured(): Promise<boolean> {
  return import("@/lib/ai/config").then(m => m.aiStatus().configured).catch(() => false);
}

// ── Hub landing ──────────────────────────────────────────────────────────────
export type HubModule = ProfModule & { count: number | null };
export type ProfHub = { modules: HubModule[]; overview: Kpi[]; activity: Activity[]; aiConfigured: boolean };

export async function loadProfHub(admin: Admin): Promise<ProfHub> {
  const head = (table: string) => admin.from(table).select("id", { count: "exact", head: true });
  const [fw, q, cc, ko, audit, configured] = await Promise.all([
    head("frameworks"), head("questions"), head("clinical_cases"), head("knowledge_objects"),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").order("created_at", { ascending: false }).limit(6),
    aiConfigured(),
  ]);
  const counts: Record<string, number | null> = {
    templates: fw.count ?? null, questions: q.count ?? null, scenarios: cc.count ?? null, resources: ko.count ?? null,
  };
  const modules: HubModule[] = PROF_MODULES.map(m => ({ ...m, count: m.live ? (counts[m.slug] ?? 0) : null }));

  const overview: Kpi[] = [
    { label: "Tools Available", value: PROF_MODULES.length, sub: "professional tools" },
    { label: "Templates", value: counts.templates, sub: "institution frameworks", muted: counts.templates === null },
    { label: "Questions Created", value: counts.questions, sub: "in the question bank", muted: counts.questions === null },
    { label: "Scenarios Built", value: counts.scenarios, sub: "clinical & simulation", muted: counts.scenarios === null },
    { label: "Resources", value: counts.resources, sub: "learning content", muted: counts.resources === null },
    { label: "Tool Utilisation", value: null, sub: "usage metering not tracked", muted: true },
  ];

  return { modules, overview, activity: mapActivity((audit.data ?? []) as AuditRow[]), aiConfigured: configured };
}

// ── Module workspace ─────────────────────────────────────────────────────────
export type ModuleData = { module: ProfModule; kpis: Kpi[]; assets: Asset[]; activity: Activity[]; aiConfigured: boolean };

export async function loadProfModule(admin: Admin, slug: string): Promise<ModuleData | null> {
  const mod = PROF_MODULES.find(m => m.slug === slug);
  if (!mod) return null;

  const src = mod.live ? SOURCES[slug] : undefined;
  let rows: Row[] = [];
  if (src) {
    const { data, error } = await admin.from(src.table).select("*").order("created_at", { ascending: false }).limit(80);
    if (!error && data) rows = data as Row[];
  }

  const total = mod.live ? rows.length : null;
  const since = sevenDaysAgo();
  const recent = mod.live ? rows.filter(r => String(r.created_at ?? "") >= since).length : null;
  const pending = mod.live ? rows.filter(r => REVIEW.has(rawStatus(r))).length : null;
  const publishedN = mod.live ? rows.filter(r => PUBLISHED.has(rawStatus(r))).length : 0;
  const compliance = (mod.live && src?.versioned && total) ? Math.round((publishedN / total) * 100) : null;

  const kpis: Kpi[] = [
    { label: "Total Assets", value: total, sub: mod.live ? `${mod.countLabel.toLowerCase()} in the library` : "no store yet", muted: !mod.live },
    { label: "AI Generated", value: null, sub: "provenance not tracked yet", muted: true },
    { label: "Shared", value: null, sub: "sharing store not built yet", muted: true },
    { label: "Pending Review", value: pending, sub: pending ? "awaiting review" : "all clear", muted: !mod.live },
    // Honest label: these tables carry created_at only (no updated_at), so this
    // counts newly-added assets, not edits — hence "Added", not "Updated".
    { label: "Recently Added", value: recent, sub: "added in the last 7 days", muted: !mod.live },
    // Share of versioned assets currently in a published state (frameworks carry
    // pub_status + version_num). We don't diff against a "latest" marker, so the
    // sub-text claims publication state, not version currency.
    { label: "Version Compliance", value: compliance === null ? null : `${compliance}%`, sub: compliance === null ? "versioning not tracked" : "published of versioned assets", muted: compliance === null },
  ];

  const assets: Asset[] = rows.slice(0, 40).map(r => ({
    id: String(r.id),
    title: String(r[src?.titleCol ?? "title"] ?? r.title ?? r.name ?? "Untitled").slice(0, 120),
    status: statusLabel(r),
    meta: src?.metaCol && r[src.metaCol] ? String(r[src.metaCol]) : null,
    version: typeof r.version_num === "number" ? r.version_num : null,
    updated: (r.created_at as string) ?? null,
  }));

  const [{ data: audit }, configured] = await Promise.all([
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").order("created_at", { ascending: false }).limit(6),
    aiConfigured(),
  ]);

  return { module: mod, kpis, assets, activity: mapActivity((audit ?? []) as AuditRow[]), aiConfigured: configured };
}
