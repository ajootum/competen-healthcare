import { cmoGuard, Head, Card, Kpi, Ring, Pill, Foot } from "../_cmo-ui";
import { loadOperatingModel } from "@/lib/competency/operating-model";

// CMO-017 — Operating Model & Future Evolution (lean). A REAL maturity snapshot (derived from live competency /
// program / mapping signals) sits above the office's stated operating-model framework and 5-year roadmap, which
// are narrative (clearly labelled). Hospital-scoped.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// ── The stated framework (narrative, not data) ──
const MATURITY_MODEL = [
  { num: 1, label: "Initial", desc: "Ad-hoc competency management; inconsistent standards." },
  { num: 2, label: "Developing", desc: "Core programs and compliance monitoring in place." },
  { num: 3, label: "Defined", desc: "Standardised frameworks, governed programs, mapped workforce." },
  { num: 4, label: "Managed", desc: "Data-driven; predictive analytics and strong assurance." },
  { num: 5, label: "Optimising", desc: "Self-optimising, AI-assisted, continuously improving." },
];
const VALUE_STREAMS = [
  { icon: "🎨", name: "Standardise & Design", desc: "Create and maintain competency standards, frameworks and programs." },
  { icon: "🗺️", name: "Map & Plan", desc: "Map workforce capability needs and plan for the future state." },
  { icon: "🧩", name: "Assign & Enable", desc: "Assign competencies, provide learning and enable evidence collection." },
  { icon: "🛡️", name: "Assure & Monitor", desc: "Monitor compliance, validate evidence and assure readiness." },
  { icon: "📈", name: "Improve & Grow", desc: "Drive remediation, improvement initiatives and capability growth." },
];
const ROADMAP = [
  { year: "Year 1 · Foundation", items: ["Governance & processes", "Core competency programs", "Compliance & readiness"] },
  { year: "Year 2 · Intelligence", items: ["Advanced analytics", "AI copilot & insights", "Integration expansion"] },
  { year: "Year 3 · Optimisation", items: ["Predictive capability intelligence", "Dynamic learning pathways", "Advanced risk prediction"] },
  { year: "Year 4 · Autonomous", items: ["Autonomous recommendations", "Real-time competency assurance", "Self-optimising workflows"] },
  { year: "Year 5 · Transformational", items: ["Workforce capability ecosystem", "AI-driven strategic planning", "Adaptive competency culture"] },
];
const PRINCIPLES = ["Patient safety first", "Evidence-based decisions", "Data integrity & transparency", "Standardisation with flexibility", "Accountability at every level", "Continuous improvement", "Empower people & teams", "Technology with human centre"];

export default async function OperatingModelPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadOperatingModel(admin, hid, isSuper) as any;
  const k = d.kpis ?? {};

  return (
    <div className="space-y-4 max-w-[1400px]">
      <Head code="CMO-017 · Operating Model & Future Evolution" title="Operating Model & Future Evolution" sub="A future-ready operating model that drives workforce capability, compliance, quality and organisational excellence." />

      {/* Real maturity snapshot */}
      {d.provisioned ? (
        <Card title="Organisational maturity" right={<span className="text-[11px] text-gray-400">derived from live competency, program & mapping signals</span>}>
          <div className="flex flex-col md:flex-row items-center gap-5">
            <div className="flex items-center gap-4 shrink-0">
              <Ring pct={d.composite} label={`Level ${d.maturityNum}`} size={92} />
              <div><p className="text-2xl font-bold text-gray-900">{d.maturityLevel}</p><p className="text-[11px] text-gray-400">composite {d.composite}/100</p></div>
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
              {d.dimensions.map((dim: any) => (
                <div key={dim.label} className="border border-gray-100 rounded-lg p-2.5"><p className="text-[11px] text-gray-500">{dim.label}</p><p className="text-lg font-bold text-gray-900 tabular-nums">{dim.value == null ? "—" : `${dim.value}%`}</p></div>
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-6"><p className="text-sm text-gray-400">Maturity snapshot needs competency, program or mapping data — once those exist the composite level computes here. The operating model and roadmap below are the office&apos;s stated framework.</p></div>
      )}

      {d.provisioned && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Workforce competence" value={k.competence != null ? `${k.competence}%` : "—"} sub="profile coverage" tone="text-teal-600" />
          <Kpi label="Program effectiveness" value={k.programEff != null ? `${k.programEff}%` : "—"} sub="avg completion" />
          <Kpi label="Mapping coverage" value={k.mappingCov != null ? `${k.mappingCov}%` : "—"} sub="workforce mapped" />
          <Kpi label="Active initiatives" value={k.activeInitiatives} sub="programs + campaigns" />
          <Kpi label="At-risk programs" value={k.atRiskPrograms} sub="need attention" tone={k.atRiskPrograms ? "text-amber-600" : "text-gray-900"} />
          <Kpi label="Critical gaps" value={k.criticalGaps} sub="capability risk" tone={k.criticalGaps ? "text-rose-600" : "text-gray-900"} />
        </div>
      )}

      {/* 5-level maturity model — current level from data */}
      <Card title="Competency maturity model" right={<span className="text-[11px] text-gray-400">current level highlighted from the snapshot</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {MATURITY_MODEL.map(m => {
            const active = m.num === d.maturityNum;
            return (
              <div key={m.num} className={`rounded-lg border p-3 ${active ? "border-teal-300 bg-teal-50" : "border-gray-100"}`}>
                <div className="flex items-center gap-1.5 mb-1"><span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${active ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>L{m.num}</span><p className={`text-[12px] font-semibold ${active ? "text-teal-800" : "text-gray-700"}`}>{m.label}</p></div>
                <p className="text-[10px] text-gray-500 leading-snug">{m.desc}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Operating model — framework */}
        <Card title="Operating model — value streams" right={<Pill text="framework" tone="slate" />}>
          <div className="space-y-2">
            {VALUE_STREAMS.map(v => (
              <div key={v.name} className="flex items-start gap-2.5"><span className="text-base shrink-0">{v.icon}</span><div><p className="text-[13px] font-semibold text-gray-800">{v.name}</p><p className="text-[11px] text-gray-500 leading-snug">{v.desc}</p></div></div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Operating principles</p>
            <div className="flex flex-wrap gap-1.5">{PRINCIPLES.map(p => <span key={p} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">{p}</span>)}</div>
          </div>
        </Card>

        {/* Future evolution roadmap — narrative */}
        <Card title="Future evolution roadmap (3–5 years)" right={<Pill text="roadmap" tone="slate" />}>
          <div className="space-y-2.5">
            {ROADMAP.map((r, i) => (
              <div key={r.year} className="flex gap-2.5">
                <div className="flex flex-col items-center shrink-0"><span className={`w-2.5 h-2.5 rounded-full ${i === 0 ? "bg-teal-500" : "bg-gray-300"}`} />{i < ROADMAP.length - 1 && <span className="w-px flex-1 bg-gray-200 my-0.5" />}</div>
                <div className="pb-1"><p className="text-[12px] font-semibold text-gray-800">{r.year}</p><p className="text-[11px] text-gray-500 leading-snug">{r.items.join(" · ")}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>CMO-017 — the maturity snapshot and KPIs at the top are REAL, derived live from the competency, program (CMO-006) and workforce-mapping (CMO-007) signals. The value-stream operating model, maturity-model descriptions and 5-year roadmap are the office&apos;s stated framework (narrative), not computed. A dedicated maturity-model store with per-capability scoring + governance-structure and success-measure tracking is the next phase.</Foot>
    </div>
  );
}
