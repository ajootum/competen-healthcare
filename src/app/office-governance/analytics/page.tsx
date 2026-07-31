import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Bars, Gauge, Trend, Table, Foot, ragPct } from "../_ui";
import { loadOgsAnalytics } from "@/lib/ogs/analytics";

export const dynamic = "force-dynamic";

// OGS-005 Office Performance & Governance Analytics — measure, monitor and improve the performance and impact
// of all governance offices. A derived read-model over the real governance stores; Office Health Score and the
// compliance mix are transparent composites (active + chaired + at-quorum).
/* eslint-disable @typescript-eslint/no-explicit-any */
const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "indigo", facility: "teal", department: "blue", specialty: "amber" };
const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : "—");
const healthTone = (n: number) => (n >= 85 ? "text-[var(--cmp-text-success)]" : n >= 60 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");

export default async function OgsAnalytics() {
  const { admin, isSuper, hid } = await ogsGuard();
  const d = await loadOgsAnalytics(admin, hid, isSuper);
  const head = <Head code="OGS-005 · Office Governance System" title="Office Performance & Governance Analytics" sub="Measure, monitor and improve the performance and impact of all governance offices." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">No governance offices provisioned yet.</p></Card></div>;
  const k = d.kpis;
  const c = d.compliance;
  const cRate = c.rate ?? 0;
  const pctOf = (n: number) => (c.total ? Math.round((n / c.total) * 100) : 0);

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat icon="🩺" tone={k.overallHealth != null ? ragPct(k.overallHealth) : "slate"} label="Office Health Score" value={k.overallHealth != null ? `${k.overallHealth}%` : "—"} sub="composite" />
        <Stat icon="🏛️" tone="teal" label="Offices" value={k.offices} />
        <Stat icon="⚖️" tone="emerald" label="Decisions made" value={k.decisionsMade} sub="approved + implemented" />
        <Stat icon="🛡️" tone={k.complianceRate != null ? ragPct(k.complianceRate) : "slate"} label="Compliance rate" value={k.complianceRate != null ? `${k.complianceRate}%` : "—"} />
        <Stat icon="🗝️" tone="violet" label="Active delegations" value={k.activeDelegations} />
        <Stat icon="⚠️" tone={k.attention ? "amber" : "emerald"} label="Attention" value={k.attention} sub="no chair / below quorum" />
        <Stat icon="📅" tone="slate" label="Meetings held" value="—" sub="next-phase store" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Office Health Score breakdown" className="xl:col-span-2" right="composite dimensions (0–100)">
          <Bars items={d.healthDimensions} />
          <p className="text-[10px] text-gray-400 mt-3">Office Health Score = active (40) + chaired (30) + at-quorum (30), averaged across offices. Decision throughput = governance decisions approved or implemented vs. raised.</p>
        </Card>

        <Card title="Decisions by type" right={`${d.totalDecisions} total`}>
          {d.decisionsByType.length ? (
            <div className="flex items-center gap-2">
              <Donut segments={d.decisionsByType} total={d.totalDecisions} label="Decisions" size={130} />
              <Legend items={d.decisionsByType.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: d.totalDecisions ? Math.round((s.value / d.totalDecisions) * 100) : 0 }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No governance decisions recorded yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Governance performance trend" className="xl:col-span-2" right="health score by month">
          {d.hasTrend
            ? <Trend points={d.trendPoints} labels={d.trendLabels} tone="teal" target={85} />
            : <p className="text-sm text-gray-400 py-10 text-center">Not enough snapshot history to plot a trend — the <code>quality_score_snapshots</code> store needs ≥2 months of data.</p>}
        </Card>

        <Card title="Compliance overview">
          <div className="flex flex-col items-center">
            <Gauge pct={cRate} label="offices compliant" tone={ragPct(cRate)} />
            <div className="w-full mt-3">
              <Legend items={[
                { label: "Compliant", value: c.compliant, tone: "emerald", pct: pctOf(c.compliant) },
                { label: "Partial", value: c.partial, tone: "amber", pct: pctOf(c.partial) },
                { label: "Non-compliant", value: c.nonCompliant, tone: "rose", pct: pctOf(c.nonCompliant) },
              ]} />
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Compliant = active + chaired + at-quorum · partial = active but missing one · non-compliant = inactive.</p>
        </Card>
      </div>

      <Card title="Top performing offices" right="ranked by Office Health Score">
        <Table
          cols={["Office", "Level", "Members", "Health"]}
          rows={d.topOffices.map((o: any) => [
            <span key="n" className="font-medium text-gray-800">{o.name}</span>,
            <Pill key="l" text={cap(o.level)} tone={LEVEL_TONE[o.level] ?? "slate"} />,
            <span key="m" className="tabular-nums text-gray-500">{o.members}/{o.quorum}</span>,
            <span key="h" className={`font-semibold tabular-nums ${healthTone(o.health)}`}>{o.health}%</span>,
          ])}
          empty="No offices registered."
        />
      </Card>

      <Foot>OGS-005 — a live governance analytics read-model over <code>governance_committees</code> + <code>committee_members</code> (offices, chairs &amp; quorum), <code>change_requests</code> (governance decisions) and <code>adm_delegations</code> (delegations), with the performance trend drawn from <code>quality_score_snapshots</code> where history exists. The <strong>Office Health Score</strong> is a transparent composite (active + chaired + at-quorum) and the compliance mix is derived from the same signals. Meeting attendance, quorum-achievement and decision-cycle-time metrics require the next-phase meetings + <code>ogs_offices</code> model; benchmarking vs. peer offices is next-phase.</Foot>
    </div>
  );
}
