import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// CGR-000 — Competency Governance & Regulation Platform. The GOVERNANCE operating system for competencies:
// it ensures every competency is valid, owned, evidence-backed, regulatory-aligned and auditable. This hub
// maps the 30 CGR engines to real surfaces and is honest about each: Live (an engine built here), Linked (an
// existing surface already owns it — cross-linked, not duplicated), Partial (data real, a fuller build needs
// more) or Planned. The genuinely-new engine is the Governance Registry (CGR-001) — the per-competency
// governance record that joins ownership, regulatory mapping, review currency, evidence and change control
// into one source of truth. No migration — a governance view over stores the rest of Competen already produces.
export const dynamic = "force-dynamic";

type Status = "real" | "linked" | "partial" | "gap";
type Mod = { code: string; icon: string; label: string; desc: string; href?: string; status: Status };

const BADGE: Record<Status, { text: string; cls: string }> = {
  real: { text: "Live", cls: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" },
  linked: { text: "Linked", cls: "text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)]" },
  partial: { text: "Partial", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" },
  gap: { text: "Planned", cls: "text-gray-400 bg-gray-50 border-gray-100" },
};

function EngineCard({ m }: { m: Mod }) {
  const b = BADGE[m.status];
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-300 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.status === "gap" ? "text-gray-500" : "text-gray-900 group-hover:text-emerald-700"}`}>{m.label}</p>
        </div>
        <span className={`ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${b.cls}`}>{b.text}</span>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">{m.desc}</p>
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} hover:border-[var(--cmp-color-success)] hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}

function Layer({ title, mods }: { title: string; mods: Mod[] }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <EngineCard key={m.code} m={m} />)}</div>
    </>
  );
}

export default async function CgrPlatformPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0).catch(() => 0);
  const [comps, frameworks, mappings, ownership, decisions, changes] = await Promise.all([
    c(admin.from("framework_competencies").select("id", { count: "exact", head: true })),
    c(admin.from("frameworks").select("id", { count: "exact", head: true })),
    c(admin.from("competency_standard_mappings").select("id", { count: "exact", head: true })),
    c(admin.from("content_responsibilities").select("id", { count: "exact", head: true }).eq("status", "active")),
    c(admin.from("competency_decisions").select("id", { count: "exact", head: true })),
    c(admin.from("change_requests").select("id", { count: "exact", head: true }).eq("status", "open")),
  ]);
  const STATS = [
    { label: "Competency definitions", value: comps, icon: "🧬" },
    { label: "Framework libraries", value: frameworks, icon: "📚" },
    { label: "Standards mapped", value: mappings, icon: "📏" },
    { label: "Ownership records", value: ownership, icon: "🧾" },
    { label: "Governed decisions", value: decisions, icon: "⚖️" },
    { label: "Open change requests", value: changes, icon: "🔀" },
  ];

  const CORE: Mod[] = [
    { code: "CGR-001", icon: "📖", label: "Governance Registry & Master Control", desc: "The genuinely-new engine — one governance record per competency joining ownership, regulatory mapping, review currency, evidence and change control into a single source of truth, with a derived governance state & completeness score. Highest-risk first.", href: "/super-admin/cgr/registry", status: "real" },
    { code: "CGR-002", icon: "📏", label: "Regulatory Intelligence & Standards Mapping", desc: "The intelligence lens over the mapping store — a Standards Library of the clauses in use, compliance gap detection (unmapped / weakly-mapped competencies by risk) and coverage by domain. Authoring cross-links to the Studio Standards Centre.", href: "/super-admin/cgr/standards", status: "real" },
    { code: "CGR-003", icon: "✅", label: "Approval & Governance Workflow", desc: "The governance approval workspace — pending pipeline, turnaround & SLA, escalation, reviewer workload and the per-step decision-audit timeline over the real approval stores. Deciding cross-links to the console + Office review board.", href: "/super-admin/cgr/approvals", status: "real" },
    { code: "CGR-004", icon: "♻️", label: "Change Control & Lifecycle", desc: "The change-control workspace — controlled-change log, impact assessment (downstream blast radius via the dependency graph) and framework version/lifecycle integrity. Raising & approving changes cross-links to lifecycle management.", href: "/super-admin/cgr/change-control", status: "real" },
    { code: "CGR-005", icon: "🔍", label: "Audit & Evidence Assurance", desc: "The governance audit trail — the continuous action-history across all CGR engines (audit_log + domain_events) scoped to competency governance, plus an evidence-assurance headline. Deep statistical assurance (integrity/reliability/drift) cross-links to CAPA.", href: "/super-admin/cgr/audit", status: "real" },
    { code: "CGR-006", icon: "📊", label: "Governance Dashboard & Intelligence", desc: "Role-based governance rollup over the live registry — competency assurance score + organisational maturity, regulatory readiness by standards body, competency risk, governance performance (change control + validation) and a per-domain portfolio.", href: "/super-admin/cgr/dashboard", status: "real" },
    { code: "CGR-007", icon: "🧠", label: "Governance Intelligence & Predictive Risk", desc: "A live copilot grounded in the Governance Registry — it flags ownership, regulatory, review and evidence gaps and prioritises governance risk over real data via the governed AI gateway. Recommends and detects; never approves or changes standards.", href: "/super-admin/cgr/ai", status: "real" },
  ];
  const OPS: Mod[] = [
    { code: "CGR-008", icon: "⚙️", label: "Policy & Rules Engine", desc: "The enforced governance ruleset made explicit — live compliance per rule, risk-tiered governance posture, and the real configured thresholds (review intervals, approval blueprints, evidence rules). Authoring cross-links to policy-manager + studio rules.", href: "/super-admin/cgr/policy-rules", status: "real" },
    { code: "CGR-009", icon: "⚠️", label: "Exception, Escalation & Risk", desc: "The governance escalation queue — registry concerns classified by risk and auto-escalated (owner → department → executive) — plus the risk register and the real time-boxed exceptions (break-glass). Enterprise risk cross-links to GOV.", href: "/super-admin/cgr/risk", status: "real" },
    { code: "CGR-010", icon: "🏛️", label: "Operating Model & Governance Council", desc: "The live competency-governance council structure — committees, membership, quorum and what each governs (frameworks) with accountability coverage gaps — above the stated decision-rights/RACI/cadence model. Office bodies & meetings cross-link to OGS.", href: "/super-admin/cgr/council", status: "real" },
    { code: "CGR-011", icon: "📋", label: "Compliance Reporting & Regulatory Assurance", desc: "A competency-governance compliance report — compliance score + risk rating (§8), accreditation readiness by standard and the real requirement register (cmo_accreditations) with evidence-pack summary. Report building cross-links to QAW.", href: "/super-admin/cgr/compliance", status: "real" },
    { code: "CGR-012", icon: "🗄️", label: "Knowledge & Evidence Repository", desc: "The governance evidence lens — knowledge inventory, the evidence-to-competency COVERAGE metric (via CPU) and the governed knowledge graph. Repository authoring cross-links to CKP; assessment-evidence integrity to CAPA.", href: "/super-admin/cgr/knowledge", status: "real" },
    { code: "CGR-013", icon: "🔗", label: "Interoperability & Integration", desc: "The event-driven integration health monitor over the governance event bus (domain_events) — processing success, retry/dead-letter backlog, event flow by type & platform, and traceability. Endpoint config cross-links to CMO.", href: "/super-admin/cgr/integration", status: "real" },
    { code: "CGR-014", icon: "🔐", label: "Security, Privacy & Access Control", desc: "The governance access map + the separation-of-duties check (same user authoring AND approving an object) + assessor independence + permission review. Identity/RLS/encryption cross-link to System.", href: "/super-admin/cgr/access", status: "real" },
    { code: "CGR-015", icon: "🛠️", label: "Platform Administration & Configuration", desc: "The no-code governance config layer — configuration inventory by domain, the inherit-vs-override hierarchy (safe defaults), and advisory AI recommendations. Deep admin console cross-links to the Control Plane.", href: "/super-admin/cgr/administration", status: "real" },
  ];
  const DELIVERY: Mod[] = [
    { code: "CGR-016", icon: "📈", label: "Analytics, Metrics & Continuous Improvement", desc: "The trend + improvement layer the point-in-time dashboard lacks — governance readiness/compliance over time (readiness snapshots), maturity progression, and ranked continuous-improvement opportunities from the registry gaps. Deep analytics cross-link to Performance.", href: "/super-admin/cgr/analytics", status: "real" },
    { code: "CGR-017", icon: "🧪", label: "Simulation, Testing & Validation", desc: "The validation backbone — release-readiness gate, test-suite health and run history over the config test-suites, with change-impact simulation (blast radius) via CGR-004. Suite authoring cross-links to Studio.", href: "/super-admin/cgr/testing", status: "real" },
    { code: "CGR-018", icon: "📦", label: "Deployment, Release & Migration", desc: "The governance release pipeline — releases by channel (dev→production) & status, migration jobs (export/import/rollback) and rollback tracking over the real config release/migration stores. Building/execution cross-links to the Package Manager.", href: "/super-admin/cgr/releases", status: "real" },
    { code: "CGR-019", icon: "🛟", label: "Business Continuity & Resilience", desc: "Keep governance, decisions and audit available during outages, with recovery. Data-protection & recovery infrastructure owns the base; a governance-continuity view is planned.", href: "/super-admin/system/data", status: "gap" },
  ];
  const ECO: Mod[] = [
    { code: "CGR-020", icon: "🗺️", label: "Strategic Roadmap & Future Evolution", desc: "Narrative maturity roadmap from control system to global assurance ecosystem. A strategy narrative, not a data surface — planned.", status: "gap" },
    { code: "CGR-021", icon: "🛍️", label: "Marketplace & External Standards Exchange", desc: "The governance-resource catalog — packages by domain, the shared-vs-private split, publication readiness (manifest completeness) and licensing over the real package store. Publishing & adoption cross-link to Studio Marketplace.", href: "/super-admin/cgr/marketplace", status: "real" },
    { code: "CGR-022", icon: "📊", label: "Global Benchmarking & Comparative Intelligence", desc: "Comparative GOVERNANCE benchmarking — maturity, ownership, regulatory readiness and review currency per domain & framework against the enterprise mean, with leading/lagging bands and peer-learning exemplars. Capability benchmarking cross-links to CAPM-006.", href: "/super-admin/cgr/benchmarking", status: "real" },
    { code: "CGR-023", icon: "🤖", label: "AI Agent & Autonomous Assurance", desc: "The governed-AI view — the 5 governance agents mapped to their live surfaces, real AI activity over the governed gateway, the model registry, and the human-in-the-loop boundary. AI platform ops cross-link to AIS.", href: "/super-admin/cgr/ai-agents", status: "real" },
    { code: "CGR-024", icon: "🧿", label: "Ecosystem Intelligence & Digital Twin", desc: "The §6 confidence-weighted competency state — capability × evidence confidence × recency × risk — at individual, team and org level. Distinct from readiness-states, which resolves outcome+expiry into categorical states. Practice exposure honestly unavailable.", href: "/super-admin/cgr/twin", status: "real" },
    { code: "CGR-025", icon: "👥", label: "Governance Workforce Capability", desc: "The capability of the workforce that GOVERNS competency — governance load by holder, key-person concentration, succession exposure (single-point governance) and assessor capacity. Clinical capability cross-links to Workforce Mapping.", href: "/super-admin/cgr/workforce", status: "real" },
    { code: "CGR-026", icon: "🩺", label: "Clinical Practice Intelligence & Outcome Correlation", desc: "Two lenses on whether competency improves outcomes — the statistical correlation (CAPM-005, embedded with credit) and the CASE lens: competencies implicated by real safety events via governance-confirmed learning links, cross-referenced with the registry as practice risk. Aggregated by competency, never by person.", href: "/super-admin/cgr/clinical", status: "real" },
    { code: "CGR-027", icon: "🔄", label: "Organisational Learning & Knowledge Transformation", desc: "Loop-CLOSURE performance — signals transformed into action, real time-to-improvement, recurrence by event type, and competency evolution enacted. Honest that no event↔competency linkage exists yet. Signal correlation cross-links to COMP-028.", href: "/super-admin/cgr/learning", status: "real" },
    { code: "CGR-028", icon: "🎯", label: "Service Activation Readiness", desc: "The §9 activation gate over the new Service Profile store (mig 151) — a profile states what a service REQUIRES (competency × min level × min staff × critical); the gate evaluates every department's real decisions + assessor capacity → READY / CONDITIONAL / NOT READY. Org-level readiness cross-links to CGR-029 + cmo/readiness.", href: "/super-admin/cgr/activation", status: "real" },
    { code: "CGR-029", icon: "🛰️", label: "Strategic Decision Intelligence & Executive Assurance", desc: "The board-level governance assurance statement — an assurance rating with the evidence behind it, the strategic risk register, regulatory exposure and investment priorities. Broad executive intelligence cross-links to HEX.", href: "/super-admin/cgr/executive", status: "real" },
    { code: "CGR-030", icon: "🌐", label: "Global Ecosystem Platform", desc: "Vision for a global inter-organisation competency-governance network. A narrative horizon — planned.", status: "gap" },
  ];

  const all = [...CORE, ...OPS, ...DELIVERY, ...ECO];
  const nReal = all.filter(m => m.status === "real").length;
  const nLinked = all.filter(m => m.status === "linked").length;
  const nPartial = all.filter(m => m.status === "partial").length;
  const nGap = all.filter(m => m.status === "gap").length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-000 · Competency Governance &amp; Regulation</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Governance &amp; Regulation</h1>
          <p className="text-gray-400 text-sm mt-0.5">The governance operating system — can we trust that every competency is valid, owned, evidence-backed and regulatory-aligned? Studio authors, Delivery runs, Assurance verifies, Performance measures — and Governance proves integrity.</p>
        </div>
        <Link href="/super-admin" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Mission Control</Link>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
        {STATS.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-1"><span className="text-sm">{s.icon}</span><p className="text-lg font-bold text-gray-900">{s.value}</p></div>
            <p className="text-[10px] text-gray-400 font-medium leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5 text-[11px]">
        {nReal > 0 && <span className="font-semibold text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-lg px-2.5 py-1">{nReal} live</span>}
        {nLinked > 0 && <span className="font-semibold text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-lg px-2.5 py-1">{nLinked} linked (existing surface)</span>}
        {nPartial > 0 && <span className="font-semibold text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-lg px-2.5 py-1">{nPartial} partial</span>}
        {nGap > 0 && <span className="font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{nGap} planned</span>}
      </div>

      <Layer title="Core Governance · CGR-001 … 007" mods={CORE} />
      <Layer title="Governance Operations · CGR-008 … 015" mods={OPS} />
      <Layer title="Analytics, Testing & Release · CGR-016 … 019" mods={DELIVERY} />
      <Layer title="Intelligence & Ecosystem · CGR-020 … 030" mods={ECO} />

      <div className="bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-xl p-4">
        <p className="text-[11px] text-emerald-900">
          <span className="font-bold">One governance layer over the whole competency system.</span> CGR doesn&apos;t re-collect data — it proves the competency machinery is trustworthy. Approval, change control, audit, councils, standards mapping and compliance are already owned by Studio, the Competency Office, Assurance, Office Governance and the enterprise GRC hub (cross-linked, not duplicated); the genuinely-new engine — the <span className="font-semibold">Governance Registry (CGR-001)</span> — is the per-competency source of truth that joins ownership, regulatory alignment, review currency, evidence and change control into one governed record.
        </p>
      </div>
    </div>
  );
}
