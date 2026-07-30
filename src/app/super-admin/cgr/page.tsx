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
  real: { text: "Live", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  linked: { text: "Linked", cls: "text-blue-600 bg-blue-50 border-blue-100" },
  partial: { text: "Partial", cls: "text-amber-600 bg-amber-50 border-amber-100" },
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
    ? <Link href={m.href} className={`${base} hover:border-emerald-200 hover:shadow-sm transition-all group`}>{inner}</Link>
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
    { code: "CGR-002", icon: "📏", label: "Regulatory Intelligence & Standards Mapping", desc: "Maps competencies to accreditation standards (JCI/WHO/SafeCare/council) with coverage levels. Owned by the Standards Mapping Centre — cross-linked.", href: "/super-admin/studio/standards", status: "linked" },
    { code: "CGR-003", icon: "✅", label: "Approval & Governance Workflow", desc: "Multi-step review → approve → publish with reviewer roles and decision audit. Owned by the Review & Governance board + platform approvals — cross-linked.", href: "/competency-office/review-board", status: "linked" },
    { code: "CGR-004", icon: "♻️", label: "Change Control & Lifecycle", desc: "Change request → impact → version → release → retire, with the competency lifecycle state machine. Owned by Lifecycle Management + change requests — cross-linked.", href: "/competency-office/lifecycle-state", status: "linked" },
    { code: "CGR-005", icon: "🔍", label: "Audit & Evidence Assurance", desc: "Continuous evidence assurance, assessor reliability, drift and findings. Owned by the Competency Assurance platform + the domain-event audit backbone — cross-linked.", href: "/super-admin/assurance", status: "linked" },
    { code: "CGR-006", icon: "📊", label: "Governance Dashboard & Intelligence", desc: "Role-based governance rollup over the live registry — competency assurance score + organisational maturity, regulatory readiness by standards body, competency risk, governance performance (change control + validation) and a per-domain portfolio.", href: "/super-admin/cgr/dashboard", status: "real" },
    { code: "CGR-007", icon: "🧠", label: "Governance Intelligence & Predictive Risk", desc: "A live copilot grounded in the Governance Registry — it flags ownership, regulatory, review and evidence gaps and prioritises governance risk over real data via the governed AI gateway. Recommends and detects; never approves or changes standards.", href: "/super-admin/cgr/ai", status: "real" },
  ];
  const OPS: Mod[] = [
    { code: "CGR-008", icon: "⚙️", label: "Policy & Rules Engine", desc: "Configurable governance rules — review frequency, approval authority, evidence & risk thresholds. Owned by the Rules Engine + Policy centre — cross-linked.", href: "/super-admin/studio/rules", status: "linked" },
    { code: "CGR-009", icon: "⚠️", label: "Exception, Escalation & Risk", desc: "Recorded, authorised, time-limited exceptions + risk register + break-glass. Owned by the Governance Risk & Controls centre — cross-linked.", href: "/super-admin/governance/risk", status: "linked" },
    { code: "CGR-010", icon: "🏛️", label: "Operating Model & Governance Council", desc: "Councils, RACI, decision rights, meetings and votes — the human governance layer. Owned outright by Office Governance (OGS) — cross-linked.", href: "/office-governance", status: "linked" },
    { code: "CGR-011", icon: "📋", label: "Compliance Reporting & Regulatory Assurance", desc: "Evidence-based compliance reports and accreditation-readiness packs. Owned by Governance Compliance + the Quality audit-trail — cross-linked.", href: "/super-admin/governance/compliance", status: "linked" },
    { code: "CGR-012", icon: "🗄️", label: "Knowledge & Evidence Repository", desc: "Store, validate and link evidence (guidelines, standards, policies, audits) with reliability & review-due. Owned by the Assurance Evidence Centre — cross-linked.", href: "/super-admin/assurance/evidence", status: "linked" },
    { code: "CGR-013", icon: "🔗", label: "Interoperability & Integration", desc: "Governance data flows across CST/CAP/CDP/COMP/CMO with integrity & traceability. Owned by the Cross-Workspace Integration surface — cross-linked.", href: "/competency-office/integration", status: "linked" },
    { code: "CGR-014", icon: "🔐", label: "Security, Privacy & Access Control", desc: "RBAC, least privilege, separation of duties and audit of access to governance data. Owned by the System & Security platform + scoped authority — cross-linked.", href: "/super-admin/system", status: "linked" },
    { code: "CGR-015", icon: "🛠️", label: "Platform Administration & Configuration", desc: "Governance config, workflow parameters, rule deployment and templates. Owned by the Control Plane + configuration registry — cross-linked.", href: "/super-admin/platform-ops/control-plane", status: "linked" },
  ];
  const DELIVERY: Mod[] = [
    { code: "CGR-016", icon: "📈", label: "Analytics, Metrics & Continuous Improvement", desc: "Governance KPIs, maturity trend and improvement opportunities. Owned by Competency Performance + the Office analytics — cross-linked.", href: "/super-admin/performance", status: "linked" },
    { code: "CGR-017", icon: "🧪", label: "Simulation, Testing & Validation", desc: "Sandbox to test rule/workflow/policy changes before release. Owned by Studio Release Readiness + config test-suites — cross-linked.", href: "/super-admin/studio/testing", status: "linked" },
    { code: "CGR-018", icon: "📦", label: "Deployment, Release & Migration", desc: "Controlled rollout of governance versions with rollback. Owned by the Package Manager + config releases/migration jobs — cross-linked.", href: "/super-admin/studio/packages", status: "linked" },
    { code: "CGR-019", icon: "🛟", label: "Business Continuity & Resilience", desc: "Keep governance, decisions and audit available during outages, with recovery. Data-protection & recovery infrastructure owns the base; a governance-continuity view is planned.", href: "/super-admin/system/data", status: "gap" },
  ];
  const ECO: Mod[] = [
    { code: "CGR-020", icon: "🗺️", label: "Strategic Roadmap & Future Evolution", desc: "Narrative maturity roadmap from control system to global assurance ecosystem. A strategy narrative, not a data surface — planned.", status: "gap" },
    { code: "CGR-021", icon: "🛍️", label: "Marketplace & External Standards Exchange", desc: "Share and adopt frameworks, standards and governance templates. Owned by the Studio Marketplace + config packages — cross-linked.", href: "/super-admin/studio/marketplace", status: "linked" },
    { code: "CGR-022", icon: "📊", label: "Global Benchmarking & Comparative Intelligence", desc: "Compare governance & capability across departments and specialties. Owned by Competency Performance benchmarking — cross-linked.", href: "/super-admin/performance/benchmarking", status: "linked" },
    { code: "CGR-023", icon: "🤖", label: "AI Agent & Autonomous Assurance", desc: "Continuous AI surveillance of evidence & risk (human-in-loop). The governed AI services platform runs today; autonomous agents are the next layer.", href: "/super-admin/ai/services", status: "linked" },
    { code: "CGR-024", icon: "🧿", label: "Ecosystem Intelligence & Digital Twin", desc: "Real-time competency-state model per person/team/org with trajectory. Owned by the Readiness State engine + lifecycle snapshots — cross-linked.", href: "/competency-office/readiness-states", status: "linked" },
    { code: "CGR-025", icon: "👥", label: "Global Learning & Workforce Capability", desc: "Current vs future workforce capability and gaps. Owned by Workforce Mapping + forecasting — cross-linked.", href: "/competency-office/workforce-mapping", status: "linked" },
    { code: "CGR-026", icon: "🩺", label: "Clinical Practice Intelligence & Outcome Correlation", desc: "Does validated competency track better outcomes? Owned by the Competency-to-Outcome correlation engine — cross-linked.", href: "/super-admin/performance/correlation", status: "linked" },
    { code: "CGR-027", icon: "🔄", label: "Organisational Learning & Knowledge Transformation", desc: "Turn incidents and audits into competency evolution. Owned by the Quality → Competency feedback loop — cross-linked.", href: "/competency-office/quality-feedback", status: "linked" },
    { code: "CGR-028", icon: "🎯", label: "Enterprise Readiness & Capability Assurance", desc: "Is the org/service ready to safely deliver? Owned by the Readiness rollup + enterprise governance — cross-linked.", href: "/competency-office/readiness", status: "linked" },
    { code: "CGR-029", icon: "🛰️", label: "Strategic Decision Intelligence & Executive Assurance", desc: "Executive decision support on capability, risk and investment. Owned outright by the Hospital Executive workspace — cross-linked.", href: "/hospital-executive", status: "linked" },
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
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-000 · Competency Governance &amp; Regulation</p>
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
        {nReal > 0 && <span className="font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1">{nReal} live</span>}
        {nLinked > 0 && <span className="font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1">{nLinked} linked (existing surface)</span>}
        {nPartial > 0 && <span className="font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1">{nPartial} partial</span>}
        {nGap > 0 && <span className="font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{nGap} planned</span>}
      </div>

      <Layer title="Core Governance · CGR-001 … 007" mods={CORE} />
      <Layer title="Governance Operations · CGR-008 … 015" mods={OPS} />
      <Layer title="Analytics, Testing & Release · CGR-016 … 019" mods={DELIVERY} />
      <Layer title="Intelligence & Ecosystem · CGR-020 … 030" mods={ECO} />

      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
        <p className="text-[11px] text-emerald-900">
          <span className="font-bold">One governance layer over the whole competency system.</span> CGR doesn&apos;t re-collect data — it proves the competency machinery is trustworthy. Approval, change control, audit, councils, standards mapping and compliance are already owned by Studio, the Competency Office, Assurance, Office Governance and the enterprise GRC hub (cross-linked, not duplicated); the genuinely-new engine — the <span className="font-semibold">Governance Registry (CGR-001)</span> — is the per-competency source of truth that joins ownership, regulatory alignment, review currency, evidence and change control into one governed record.
        </p>
      </div>
    </div>
  );
}
