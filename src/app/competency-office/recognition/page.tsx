import { cmoGuard, Head, Card, Kpi, Pill, Donut, Foot } from "../_cmo-ui";
import { loadRecognition, RECOG } from "@/lib/competency/recognition";
import EquivalencyManager from "./EquivalencyManager";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-024 Competency Mobility & Recognition — recognise a professional's competencies on mobility via
// equivalency rules. Real over competency_equivalencies (mig 123) + competency_decisions. No fabricated data.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function RecognitionPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadRecognition(admin, hid, isSuper);
  const head = <Head code="COMP-024 · Competency Office" title="Mobility & Recognition" sub="Recognise competencies earned elsewhere — map incoming competencies to local requirements with equivalency rules, and issue full / conditional recognition." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">The recognition store (<code>competency_equivalencies</code>) is not provisioned yet — apply migration 123 to enable equivalency rules and recognition.</p></Card></div>;

  const { data: compRows } = await admin.from("framework_competencies").select("id, name").order("name").limit(1000);
  const competencies = ((compRows ?? []) as any[]).map(c => ({ id: c.id, name: c.name }));
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Equivalency rules" value={k.rules} />
        <Kpi label="Full recognition" value={k.full} tone="text-emerald-600" sub="exact + equivalent" />
        <Kpi label="Conditional" value={k.conditional} tone="text-amber-600" sub="conditional + bridging" />
        <Kpi label="Denied" value={k.denied} tone={k.denied ? "text-rose-600" : "text-gray-900"} />
        <Kpi label="Local reqs covered" value={k.targetsCovered} sub="target competencies" />
        <Kpi label="Awaiting recognition" value={k.crossOrgPending} tone={k.crossOrgPending ? "text-amber-600" : "text-gray-900"} sub="cross-org, unmapped" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recognition rules" className="xl:col-span-2" right={<Link href="/dashboard/passport/share" className="text-[11px] text-teal-600 hover:underline">Verify a passport →</Link>}>
          <EquivalencyManager rules={d.rules} competencies={competencies} />
        </Card>

        <Card title="Recognition mix">
          {d.byType.length ? (
            <div className="flex flex-col items-center gap-3">
              <Donut segs={d.byType.map((t: any) => ({ n: t.n, color: t.color }))} total={k.rules} centre={k.rules} sub="rules" size={130} />
              <div className="w-full space-y-1">
                {d.byType.map((t: any) => (
                  <div key={t.type} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} /><span className="text-gray-600 flex-1">{t.label}</span><span className="text-gray-400">{t.recognition}</span><span className="tabular-nums text-gray-800 font-semibold w-6 text-right">{t.n}</span></div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">Define rules to see the recognition mix.</p>}
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {Object.entries(RECOG).map(([t, v]: any) => (
              <div key={t} className="flex items-center gap-2 text-[10.5px]"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v.color }} /><span className="text-gray-600 capitalize flex-1">{t}</span><span className="text-gray-400">→ {v.recognition} recognition</span></div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Recognition worklist" right="cross-organisation competencies held by current staff">
        {d.crossOrg.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-3 font-medium">Professional</th><th className="pb-2 pr-3 font-medium">Competency (earned elsewhere)</th><th className="pb-2 pr-3 font-medium">Rule</th><th className="pb-2 font-medium">Recognition</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.crossOrg.map((r: any, i: number) => (
                  <tr key={i} className="text-gray-700">
                    <td className="py-2 pr-3 font-medium text-gray-800">{r.person}</td>
                    <td className="py-2 pr-3">{r.competency}</td>
                    <td className="py-2 pr-3">{r.type === "unmapped" ? <span className="text-gray-400 text-[11px]">no rule</span> : <span className="capitalize text-[11px] text-gray-500">{r.type}</span>}</td>
                    <td className="py-2"><Pill text={r.recognition} tone={r.tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.crossOrgTotal > d.crossOrg.length && <p className="text-[10px] text-gray-400 mt-2">Showing 100 of {d.crossOrgTotal}.</p>}
          </div>
        ) : <p className="text-sm text-gray-400 py-6 text-center">No portable competencies from other organisations held by current staff yet. This populates as workers move between organisations or share verified passports (COMP-023), and each is then recognised through the rules above.</p>}
      </Card>

      <Foot>COMP-024 — the equivalency rules (source→target with a recognition type: exact / equivalent / conditional / bridging / denied) are real and user-defined over <code>competency_equivalencies</code>; the worklist applies them to competencies your current staff earned at a different hospital (<code>competency_decisions</code> stamped with another <code>hospital_id</code>) — inherently sparse in a single tenant. Trusted cross-organisation verification builds on the consented passport share/verify (COMP-023); a full recognition-decision record, bridging-pathway auto-assignment and cross-border regulatory mapping are the next-phase deepening.</Foot>
    </div>
  );
}
