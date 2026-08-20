import { cmoGuard, Head, Card, Kpi, Pill, Foot } from "../_cmo-ui";
import { loadAssignmentRules } from "@/lib/competency/assignment-rules";
import RuleManager from "./RuleManager";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-018 Competency Assignment & Distribution Engine — the RULES engine. A rule pairs a population (role) with
// a competency and a cadence; applying it materialises one target-based cmo_assignments row (method='rule') that
// the Assignment Centre (CMO-010) tracks. Real over cmo_assignment_rules (mig 125) + profiles. No fabricated data.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ROLE_OPTIONS = ["assessor", "educator", "senior_educator", "hospital_admin", "healthcare_worker"];

// The distribution framework — the trigger types a rules engine can drive. Role-based is implemented; the rest
// are mapped honestly as the next phase (they need department/risk/regulatory/campaign wiring the engine can grow into).
const FRAMEWORK = [
  { key: "role", label: "Role-based", impl: true, note: "population resolved from profiles.role / roles[]" },
  { key: "service", label: "Service / unit", impl: false, note: "assign by department or clinical service" },
  { key: "risk", label: "Risk-triggered", impl: false, note: "fire when a risk or incident threshold is crossed" },
  { key: "regulatory", label: "Regulatory", impl: false, note: "driven by accreditation / statutory mandate" },
  { key: "campaign", label: "Campaign", impl: false, note: "time-boxed org-wide drive (cmo_assignments.campaign)" },
  { key: "mandatory", label: "Mandatory", impl: false, note: "baseline requirement for all staff" },
  { key: "conditional", label: "Conditional", impl: false, note: "if a prerequisite is held or a gap is present" },
  { key: "inheritance", label: "Inheritance", impl: false, note: "cascade from a parent role or framework" },
];

export default async function AssignmentRulesPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadAssignmentRules(admin, hid, isSuper);
  const head = <Head code="COMP-018 · Competency Office" title="Assignment & Distribution Engine" sub="Define assignment RULES — a population × a competency × a cadence — then materialise each into the Assignment Centre. Real over cmo_assignment_rules; populations resolved live from staff." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The assignment rules store (<code>cmo_assignment_rules</code>) is not provisioned yet — apply migration 125 to enable the distribution engine.</p></Card></div>;

  const { data: compRows } = await admin.from("framework_competencies").select("id, name").order("name").limit(1000);
  const competencies = ((compRows ?? []) as any[]).map((c: any) => ({ id: c.id, name: c.name }));
  const roles = [...new Set([...ROLE_OPTIONS, ...((d.roles ?? []) as string[])])];
  const k = d.kpis;
  const highPriority = d.rules.filter((r: any) => r.priority === "high").length;

  const STEPS = [
    { n: "1", label: "Define", value: k.rules, sub: "rules" },
    { n: "2", label: "Target", value: k.roles, sub: "populations" },
    { n: "3", label: "Apply", value: k.active, sub: "active" },
    { n: "4", label: "Prioritise", value: highPriority, sub: "high" },
    { n: "5", label: "Assign", value: k.generated, sub: "generated" },
    { n: "6", label: "Notify", value: "—", sub: "next phase" },
    { n: "7", label: "Track", value: k.staffCovered, sub: "covered" },
  ];

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Assignment rules" value={k.rules} />
        <Kpi label="Active rules" value={k.active} tone="text-[var(--cmp-text-success)]" sub={`of ${k.rules}`} />
        <Kpi label="Roles targeted" value={k.roles} sub="distinct populations" />
        <Kpi label="Assignments generated" value={k.generated} sub="method = rule" />
        <Kpi label="Staff covered" value={k.staffCovered} sub="across active rules" />
        <Kpi label="Never applied" value={k.neverApplied} tone={k.neverApplied ? "text-[var(--cmp-text-warning)]" : "text-gray-900"} sub="0 generated" />
      </div>

      <Card title="Assignment workflow" right={<span className="text-[11px] text-gray-400 hidden md:inline">define → target → apply → prioritise → assign → notify → track</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
          {STEPS.map(s => (
            <div key={s.n} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
              <div className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-full bg-teal-700 text-white text-[9px] font-bold flex items-center justify-center shrink-0">{s.n}</span><span className="text-[11px] font-medium text-gray-700 truncate">{s.label}</span></div>
              <p className="text-lg font-bold tabular-nums text-gray-900 mt-1">{s.value}</p>
              <p className="text-[10px] text-gray-400">{s.sub}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Assignment rules" right={<Link href="/competency-office/assignments" className="text-[11px] text-teal-600 hover:underline">Assignment Centre →</Link>}>
        <RuleManager rules={d.rules} competencies={competencies} roles={roles} />
      </Card>

      <Card title="Distribution framework" right={<span className="text-[11px] text-gray-400">assignment triggers</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          {FRAMEWORK.map(f => (
            <div key={f.key} className="rounded-lg border border-gray-100 p-2.5">
              <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-gray-800">{f.label}</span>{f.impl ? <Pill text="live" tone="emerald" /> : <Pill text="planned" tone="slate" />}</div>
              <p className="text-[11px] text-gray-500 mt-1">{f.note}</p>
            </div>
          ))}
        </div>
      </Card>

      <Foot>COMP-018 — assignment rules are real and user-defined over <code>cmo_assignment_rules</code> (mig 125). A rule pairs a population (a role, matched against <code>profiles.role</code> / <code>roles[]</code>) with a competency and a cadence; population counts are computed live from staff. <strong>Apply</strong> materialises a rule into one target-based <code>cmo_assignments</code> row (<code>method=&apos;rule&apos;</code>) that the Assignment Centre (CMO-010) tracks — deduplicated so re-applying is safe. Role-based targeting is implemented; the service / risk / regulatory / campaign / conditional / inheritance triggers above are the mapped next phase, and worker-level notification on assignment is not yet wired.</Foot>
    </div>
  );
}
