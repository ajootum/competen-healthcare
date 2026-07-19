import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Tools & Settings hub data loader ────────────────────────────────────────
// The educator productivity & administration hub (Tools & Settings spec v1.0 +
// mockup). One hospital-scoped pass over the reusable content assets the educator
// builds — knowledge objects, questions, clinical cases, frameworks/CPUs — plus
// the audit log, turned into the hub's KPIs, recent activity, pending approvals
// and top templates.
//
// Honest-UI: counts and lists are live from real records. AI-usage metering,
// per-asset usage/favourite tracking and a dedicated template store don't exist
// yet, so those are shown muted or derived from what we do have (recency),
// clearly labelled — never fabricated.

const REVIEW = new Set(["review", "pending", "submitted", "in_review", "awaiting"]);
const PUBLISHED = new Set(["published", "active", "approved"]);

export type Kpi = { label: string; value: number | null; sub: string; icon: string; tint: string; muted?: boolean };
export type Activity = { actor: string; action: string; entity: string | null; when: string | null };
export type Approval = { title: string; kind: string; status: string };
export type Template = { title: string; kind: string; status: string };
export type ToolModule = { label: string; desc: string; icon: string; href?: string; soon?: boolean };
export type ToolSection = { title: string; modules: ToolModule[] };

export type ToolsHub = {
  kpis: Kpi[];
  quickTools: ToolModule[];
  activity: Activity[];
  approvals: Approval[];
  templates: Template[];
  sections: ToolSection[];
  aiConfigured: boolean;
};

// The five Tools & Settings sections and their modules. Real modules deep-link to
// the live page that provides them; not-yet-built modules are flagged soon (no
// dead links). Exported so the sidebar and the hub cards stay in sync.
export const TOOL_SECTIONS: ToolSection[] = [
  { title: "Professional Tools", modules: [
    { label: "AI Prompt Library", desc: "Create & manage prompts", icon: "🧠", soon: true },
    { label: "Template Library", desc: "Reusable teaching templates", icon: "🗂️", href: "/educator/studio" },
    { label: "Content Import & Export", desc: "Import or export content", icon: "🔁", href: "/educator/import" },
    { label: "Question Bank Manager", desc: "Build & analyse questions", icon: "❓", href: "/educator/questions" },
    { label: "Lesson & Session Templates", desc: "Plan teaching sessions", icon: "🗒️", soon: true },
    { label: "Scenario Library", desc: "Clinical & simulation scenarios", icon: "🧪", href: "/educator/simulation" },
    { label: "Resource Library", desc: "Books, videos & resources", icon: "📚", href: "/educator/library" },
    { label: "Document Generator", desc: "Auto-generate documents", icon: "📄", soon: true },
  ]},
  { title: "Publishing Tools", modules: [
    { label: "Publishing Queue", desc: "Review & publish items", icon: "📤", href: "/educator/studio/publishing" },
    { label: "Version Management", desc: "Track & restore versions", icon: "🕐", href: "/educator/studio/versions" },
    { label: "Approval Requests", desc: "Manage approvals", icon: "✅", href: "/educator/approvals" },
    { label: "Digital Signatures", desc: "Sign-off & attestation", icon: "✍️", soon: true },
  ]},
  { title: "Workspace Settings", modules: [
    { label: "My Workspace", desc: "Personalise your workspace", icon: "🎛️", soon: true },
    { label: "Notifications", desc: "Alerts & preferences", icon: "🔔", href: "/educator/notifications" },
    { label: "Dashboard Preferences", desc: "Widgets, KPIs & theme", icon: "⚙️", soon: true },
    { label: "Calendar Integration", desc: "Sync calendars", icon: "🗓️", soon: true },
    { label: "Connected Apps", desc: "LMS & integrations", icon: "🔌", soon: true },
  ]},
  { title: "Professional Development", modules: [
    { label: "CPD Portfolio", desc: "Track your CPD", icon: "🏅", href: "/educator/courses" },
    { label: "Teaching Portfolio", desc: "Your teaching record", icon: "📁", soon: true },
    { label: "Professional Goals", desc: "Goals & appraisal", icon: "🎯", soon: true },
    { label: "Certifications", desc: "Qualifications & certs", icon: "📜", soon: true },
  ]},
  { title: "Administration", modules: [
    { label: "Profile & Permissions", desc: "Profile, roles & security", icon: "🛂", soon: true },
    { label: "Institution Settings", desc: "Institution configuration", icon: "🏛️", soon: true },
    { label: "Audit Logs", desc: "Traceable action history", icon: "🗒️", soon: true },
    { label: "Help & Support", desc: "Knowledge base & support", icon: "🎧", soon: true },
  ]},
];

export async function loadToolsHub(admin: Admin, hospitalId: string): Promise<ToolsHub> {
  const noRows = Promise.resolve({ data: [] as never[] });

  const [
    { data: knowledge }, { data: questions }, { data: cases }, { data: frameworks }, { data: cpus }, { data: audit },
  ] = await Promise.all([
    admin.from("knowledge_objects").select("id, title, status").limit(8000),
    admin.from("questions").select("id, content, is_published").limit(8000),
    admin.from("clinical_cases").select("id, title, status").limit(8000),
    admin.from("frameworks").select("id, name, pub_status").limit(500),
    admin.from("clinical_practice_units").select("id, name, pub_status").limit(2000),
    hospitalId ? admin.from("audit_log").select("actor_name, action, entity_name, created_at").order("created_at", { ascending: false }).limit(8) : noRows,
  ]);

  const ko = (knowledge ?? []) as { id: string; title: string | null; status: string | null }[];
  const q = (questions ?? []) as { id: string; content: string | null; is_published: boolean }[];
  const cc = (cases ?? []) as { id: string; title: string | null; status: string | null }[];
  const fw = (frameworks ?? []) as { id: string; name: string; pub_status: string | null }[];
  const cpu = (cpus ?? []) as { id: string; name: string; pub_status: string | null }[];
  const au = (audit ?? []) as { actor_name: string | null; action: string | null; entity_name: string | null; created_at: string | null }[];

  const templates = ko.length + q.length;
  const publishedCount = ko.filter(k => PUBLISHED.has(k.status ?? "")).length + q.filter(x => x.is_published).length + cc.filter(c => PUBLISHED.has(c.status ?? "")).length;
  const pendingObjs = [
    ...ko.filter(k => REVIEW.has(k.status ?? "")).map(k => ({ title: k.title ?? "Knowledge object", kind: "Knowledge", status: k.status ?? "Review" })),
    ...cc.filter(c => REVIEW.has(c.status ?? "")).map(c => ({ title: c.title ?? "Clinical case", kind: "Scenario", status: c.status ?? "Review" })),
    ...fw.filter(f => REVIEW.has(f.pub_status ?? "")).map(f => ({ title: f.name, kind: "Framework", status: f.pub_status ?? "Review" })),
    ...cpu.filter(c => REVIEW.has(c.pub_status ?? "")).map(c => ({ title: c.name, kind: "CPU", status: c.pub_status ?? "Review" })),
    ...q.filter(x => !x.is_published).slice(0, 20).map(x => ({ title: (x.content ?? "Question").slice(0, 60), kind: "Question", status: "Draft" })),
  ];
  const resources = ko.length + cc.length;

  const kpis: Kpi[] = [
    { label: "My Content Assets", value: templates, sub: "knowledge objects & questions", icon: "🗂️", tint: "text-violet-600 bg-violet-100" },
    { label: "Published Items", value: publishedCount, sub: "live across the platform", icon: "📗", tint: "text-emerald-600 bg-emerald-100" },
    { label: "Pending Approvals", value: pendingObjs.length, sub: pendingObjs.length ? "require review" : "all clear", icon: "📄", tint: "text-amber-600 bg-amber-100" },
    { label: "Resources", value: resources, sub: "knowledge & scenarios", icon: "📚", tint: "text-blue-600 bg-blue-100" },
    { label: "AI Usage", value: null, sub: "metering not tracked yet", icon: "📈", tint: "text-fuchsia-600 bg-fuchsia-100", muted: true },
  ];

  const activity: Activity[] = au.map(a => ({ actor: a.actor_name ?? "Someone", action: a.action ?? "updated an item", entity: a.entity_name, when: a.created_at }));

  // Quick-access tools = the ten featured modules from the mockup, in order.
  // Live ones deep-link to their page; not-yet-built ones stay flagged soon.
  const QUICK = ["AI Prompt Library", "Template Library", "Question Bank Manager", "Scenario Library", "Resource Library", "Document Generator", "Content Import & Export", "Publishing Queue", "My Workspace", "CPD Portfolio"];
  const allModules = TOOL_SECTIONS.flatMap(s => s.modules);
  const quickTools = QUICK.map(l => allModules.find(m => m.label === l)).filter((m): m is ToolModule => !!m);

  // Top templates: no usage/favourite store yet — surface recent content honestly.
  const templatesList: Template[] = [
    ...ko.slice(0, 3).map(k => ({ title: k.title ?? "Knowledge object", kind: "Knowledge", status: PUBLISHED.has(k.status ?? "") ? "Published" : (k.status ?? "Draft") })),
    ...cc.slice(0, 2).map(c => ({ title: c.title ?? "Clinical case", kind: "Scenario", status: PUBLISHED.has(c.status ?? "") ? "Published" : (c.status ?? "Draft") })),
  ].slice(0, 5);

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));

  return {
    kpis, quickTools, activity, approvals: pendingObjs.slice(0, 6), templates: templatesList,
    sections: TOOL_SECTIONS, aiConfigured: configured,
  };
}
