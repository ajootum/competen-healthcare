import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// CAPA-000 — Competency Assurance Platform. The ASSURANCE layer: continuously evaluates whether the competency
// machinery itself (frameworks, assessments, evidence, assessors, governance) stays valid, reliable and compliant.
// It CONSUMES the real stores the rest of Competen produces. This hub maps the 10 CAPA engines to real surfaces and
// is honest about each: Live (a dedicated assurance engine built here), Linked (an existing surface already owns
// that territory — cross-linked, not duplicated), Partial (the data is real but a fuller build needs more), or
// Planned. No migration — a single-source-of-truth view over assurance infrastructure. Counts are live.

export const dynamic = "force-dynamic";

type Status = "real" | "linked" | "partial" | "gap";
type Mod = { code: string; icon: string; label: string; desc: string; href?: string; status: Status };

const BADGE: Record<Status, { text: string; cls: string }> = {
  real: { text: "Live", cls: "text-teal-700 bg-teal-50 border-teal-100" },
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
          <p className={`font-bold text-sm leading-tight ${m.status === "gap" ? "text-gray-500" : "text-gray-900 group-hover:text-indigo-700"}`}>{m.label}</p>
        </div>
        <span className={`ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${b.cls}`}>{b.text}</span>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">{m.desc}</p>
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} hover:border-indigo-200 hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}

// Date.now() must live in a module helper, not the component body (react-hooks/purity blocks direct render calls).
const horizonISO = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

function Layer({ title, mods }: { title: string; mods: Mod[] }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <EngineCard key={m.code} m={m} />)}</div>
    </>
  );
}

export default async function AssurancePlatformPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0).catch(() => 0);
  const [decisions, assessments, evidence, actions, auditEvents, expiring] = await Promise.all([
    c(admin.from("competency_decisions").select("id", { count: "exact", head: true })),
    c(admin.from("assessments").select("id", { count: "exact", head: true })),
    c(admin.from("evidence").select("id", { count: "exact", head: true })),
    c(admin.from("op_quality_actions").select("id", { count: "exact", head: true })),
    c(admin.from("audit_log").select("id", { count: "exact", head: true })),
    c(admin.from("competency_decisions").select("id", { count: "exact", head: true }).not("expiry_date", "is", null).lte("expiry_date", horizonISO(30))),
  ]);
  const STATS = [
    { label: "Competency decisions", value: decisions, icon: "⚖️" },
    { label: "Assessments recorded", value: assessments, icon: "📝" },
    { label: "Evidence items", value: evidence, icon: "📎" },
    { label: "Corrective actions", value: actions, icon: "🛠️" },
    { label: "Audit events", value: auditEvents, icon: "🧾" },
    { label: "Expiring ≤30d", value: expiring, icon: "⏳" },
  ];

  const RULES_AUDIT: Mod[] = [
    { code: "CAPA-001", icon: "📐", label: "Assurance Rules Engine", desc: "Configurable policy rules over competency processes, assessments and reassessment. The platform config/rules engine (WCE + critical-failure/assignment rules) already provides the substrate; a competency-assurance rule pack is the next build.", href: "/super-admin/studio/rules", status: "linked" },
    { code: "CAPA-002", icon: "🔍", label: "Competency Audit Engine", desc: "Scheduled and on-demand audits of the competency lifecycle with findings and immutable history. Audit trails live across Governance and the Quality workspace; a competency-scoped audit runner is next.", href: "/super-admin/governance/audit", status: "linked" },
  ];
  const ASSESS_EVIDENCE: Mod[] = [
    { code: "CAPA-003", icon: "🎯", label: "Assessment Quality Engine", desc: "Classical item analysis — per-question difficulty (p-value) and discrimination (upper-minus-lower), a flagged-item review queue and by-category quality — over the real quiz_attempts + questions store.", href: "/super-admin/assurance/assessment-quality", status: "real" },
    { code: "CAPA-004", icon: "📎", label: "Evidence Integrity Platform", desc: "Authenticity, completeness and chain-of-custody of competency evidence. The evidence store is real; verification/tamper/retention columns are a migration away (partial).", href: "/educator/analytics/accreditation/evidence", status: "partial" },
    { code: "CAPA-005", icon: "⚖️", label: "Assessor Reliability Engine", desc: "Per-assessor scoring behaviour — mean score, variance, leniency/severity vs peers and inter-rater agreement — over real assessments + skill_scores (assessor_id + score). A calibration watchlist flags outliers.", href: "/super-admin/assurance/assessor-reliability", status: "real" },
  ];
  const DRIFT_COMPLIANCE: Mod[] = [
    { code: "CAPA-006", icon: "📉", label: "Competency Drift Analytics", desc: "Workforce competency change over time — decay vs improvement across reassessments, expiry pressure, a composite drift index and per-competency hotspots — over competency_decisions.", href: "/super-admin/assurance/drift", status: "real" },
    { code: "CAPA-007", icon: "🏅", label: "Compliance & Accreditation Monitor", desc: "JCI / SafeCare / MoH readiness, gaps and remediation. Fully owned by the Quality & Accreditation workspace — cross-linked, not duplicated.", href: "/quality-accreditation/compliance", status: "linked" },
  ];
  const ACTION_INTEL: Mod[] = [
    { code: "CAPA-008", icon: "🛠️", label: "Corrective Action Manager", desc: "Corrective / preventive / improvement action lifecycle from assurance findings. Live over op_quality_actions in the CAPA centre — cross-linked.", href: "/unit-manager/capa", status: "linked" },
    { code: "CAPA-009", icon: "📊", label: "Organizational Assurance Dashboard", desc: "One enterprise assurance SCORE consolidating the live engines + cross-linked signals, with a per-domain breakdown and a ranked, deep-linked risk list. The executive assurance view.", href: "/super-admin/assurance/dashboard", status: "real" },
    { code: "CAPA-010", icon: "🤖", label: "AI Assurance Intelligence", desc: "A live copilot grounded in the enterprise assurance score, domains and ranked risks — predicts, recommends and explains over the real signals via the governed AI gateway. Advises; never acts.", href: "/super-admin/assurance/ai", status: "real" },
  ];

  const all = [...RULES_AUDIT, ...ASSESS_EVIDENCE, ...DRIFT_COMPLIANCE, ...ACTION_INTEL];
  const nReal = all.filter(m => m.status === "real").length;
  const nLinked = all.filter(m => m.status === "linked").length;
  const nPartial = all.filter(m => m.status === "partial").length;
  const nGap = all.filter(m => m.status === "gap").length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-000 · Competency Assurance Platform</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Assurance</h1>
          <p className="text-gray-400 text-sm mt-0.5">The assurance layer — continuously checking that the competency machinery itself stays valid, reliable and compliant. Studio authors, Delivery runs, the Office governs, and Assurance verifies it all holds.</p>
        </div>
        <Link href="/super-admin" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Mission Control</Link>
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
        {nReal > 0 && <span className="font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1">{nReal} live</span>}
        <span className="font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1">{nLinked} linked (existing surface)</span>
        <span className="font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1">{nPartial} partial</span>
        <span className="font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{nGap} planned</span>
      </div>

      <Layer title="Rules & Audit · CAPA-001/002" mods={RULES_AUDIT} />
      <Layer title="Assessment & Evidence Assurance · CAPA-003/004/005" mods={ASSESS_EVIDENCE} />
      <Layer title="Drift & Compliance · CAPA-006/007" mods={DRIFT_COMPLIANCE} />
      <Layer title="Action & Intelligence · CAPA-008/009/010" mods={ACTION_INTEL} />

      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
        <p className="text-[11px] text-indigo-900">
          <span className="font-bold">One assurance layer over the whole competency system.</span> CAPA doesn&apos;t re-collect data — it verifies the machinery that produces it. Compliance, corrective actions and audit trails are already owned by the Quality workspace and the CAPA centre (cross-linked, not duplicated); the genuinely-new assurance engines — <span className="font-semibold">assessor reliability</span>, <span className="font-semibold">competency drift</span>, the consolidated assurance dashboard and the AI assurance copilot — are what this platform adds on top of the real assessment, decision and evidence stores.
        </p>
      </div>
    </div>
  );
}
