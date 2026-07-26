import { hexGuard, Head, Tabs, Stat, Card, Pill, Gauge, Bars, Table, Donut, Legend, Foot, T } from "../_ui";
import { loadExecFinancial } from "@/lib/hex/financial";

export const dynamic = "force-dynamic";

// HEX-005 Financial Intelligence (executive lens). HONEST module — the only real hospital operating-finance
// store is pa_cost_centres (budget vs actual). Revenue/surplus/cash-flow/capital/forecast/financial-risk have
// no ledger and are shown as connect-when-ready, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Budget Performance", "Revenue & Expenditure", "Cost Centres", "Cash Flow", "Forecasting", "Capital Projects", "Financial Risk"];
const PALETTE = ["blue", "teal", "violet", "indigo", "amber", "emerald", "rose", "slate"];
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;

// Honest placeholder for a finance surface with no backing store yet.
function Connect({ icon, title, line, detail }: { icon: string; title: string; line: string; detail: string }) {
  return (
    <Card title={title}>
      <div className="flex flex-col items-center justify-center py-5 text-center">
        <span className="text-2xl mb-1 opacity-70">{icon}</span>
        <p className="text-[12px] text-gray-500">{line}</p>
        <p className="text-[10px] text-gray-400 mt-1 max-w-[15rem] leading-relaxed">{detail}</p>
        <span className="mt-2 inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1">Connect when ready</span>
      </div>
    </Card>
  );
}

export default async function ExecFinancialPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecFinancial(admin, hid, isSuper);
  const head = <Head code="HEX-005 · Hospital Executive" title="Financial Intelligence" sub="Your financial position. Our strategic advantage." action={{ label: "Performance centre →", href: "/hospital-executive/performance" }} />;
  const k = d.kpis;
  const has = d.hasData;
  const utilTone = k.utilisation == null ? "slate" : k.utilisation <= 100 ? "emerald" : k.utilisation <= 105 ? "amber" : "rose";

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="💰" tone="blue" label="Total budget" value={has ? money(k.totalBudget) : "—"} sub={has ? `${d.centres.length} cost centres` : "no budgets yet"} />
        <Stat icon="💳" tone="indigo" label="Total spend (actual)" value={has ? money(k.totalActual) : "—"} sub={has ? "committed to date" : "no data yet"} />
        <Stat icon="⚖️" tone={has ? (k.favourable ? "emerald" : "rose") : "slate"} label="Budget variance" value={has ? signed(k.variance) : "—"} sub={has ? (k.favourable ? "under budget" : "over budget") : "—"} />
        <Stat icon="🎯" tone={utilTone} label="Budget utilisation" value={has && k.utilisation != null ? `${k.utilisation}%` : "—"} sub="actual of budget" />
        <Stat icon="📈" tone="slate" label="Total revenue" value="—" sub="no ledger yet" />
        <Stat icon="🏦" tone="slate" label="Operating surplus" value="—" sub="no ledger yet" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Budget utilisation" right="actual vs budget">
          {has && k.utilisation != null ? (
            <div className="flex flex-col items-center">
              <Gauge pct={k.utilisation} label="of budget" tone={utilTone} />
              <p className="text-[11px] text-gray-500 mt-1 tabular-nums">{money(k.totalActual)} <span className="text-gray-400">of</span> {money(k.totalBudget)}</p>
              <Pill text={k.favourable ? "Under budget" : "Over budget"} tone={k.favourable ? "emerald" : "rose"} />
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No cost-centre budgets recorded yet.</p>}
        </Card>

        <Card title="Top cost centres by spend" className="xl:col-span-2" right="actual · top 8">
          {has ? <Bars items={d.topSpend.map((c: any, i: number) => ({ label: c.name, pct: c.share, tone: PALETTE[i % PALETTE.length], value: `${money(c.actual)} · ${c.share}%` }))} /> : <p className="text-sm text-gray-400 py-8 text-center">No cost-centre spend to rank yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Cost centre intelligence" className="xl:col-span-2" right="budget vs actual · by cost centre">
          <Table cols={["Cost centre", "Category", "Budget", "Actual", "Variance", "Utilisation"]} rows={d.centres.map((c: any) => [
            <span key="n" className="font-medium text-gray-800">{c.name}</span>,
            <span key="c" className="text-gray-500 capitalize">{c.category ?? "—"}</span>,
            <span key="b" className="tabular-nums text-gray-500">{money(c.budget)}</span>,
            <span key="a" className="tabular-nums text-gray-800">{money(c.actual)}</span>,
            <span key="v" className={`tabular-nums font-medium ${(c.variance >= 0 ? T("emerald") : T("rose")).text}`}>{signed(c.variance)}</span>,
            <span key="u" className={`tabular-nums ${c.utilisation == null ? "text-gray-400" : (c.utilisation <= 100 ? T("emerald") : c.utilisation <= 105 ? T("amber") : T("rose")).text}`}>{c.utilisation != null ? `${c.utilisation}%` : "—"}</span>,
          ])} empty="No cost-centre budgets recorded yet — connect a finance system or seed budgets." />
        </Card>

        <Card title="Expenditure by category" right="by expense category">
          {d.byCategory.length ? (
            <div className="flex items-center gap-3">
              <Donut segments={d.byCategory.map((c: any, i: number) => ({ value: c.value, tone: PALETTE[i % PALETTE.length], label: c.label }))} total={d.categoryTotal} label="Spend" size={130} />
              <Legend items={d.byCategory.map((c: any, i: number) => ({ label: c.label, value: money(c.value), tone: PALETTE[i % PALETTE.length], pct: d.categoryTotal ? Math.round((c.value / d.categoryTotal) * 100) : 0 }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No expenditure breakdown yet.</p>}
          {has && d.lensSplit && <p className="text-[10px] text-gray-400 mt-2">An alternate lens on the same operating spend, broken down by expense type rather than cost centre.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Connect icon="📊" title="Revenue mix" line="Revenue tracking is connect-when-ready." detail="Payer/service-line revenue needs a billing or general-ledger feed — no hospital revenue ledger exists yet, so nothing is shown rather than fabricated." />
        <Connect icon="💧" title="Cash flow" line="Cash-flow statement is connect-when-ready." detail="Operating, investing and financing cash flows require a finance-system (GL/treasury) integration; no cash ledger is connected today." />
        <Connect icon="🏗️" title="Capital projects" line="Capital programme is connect-when-ready." detail="Capex budgets, commitments and drawdowns need a capital-projects/finance feed — not modelled from operating cost centres." />
        <Connect icon="🛡️" title="Financial risk" line="Financial-risk register is connect-when-ready." detail="Liquidity, credit and budget-overrun risks need finance-ledger signals; the enterprise risk register (HEX-008) covers non-financial risk today." />
      </div>

      <Foot>HEX-005 — live over <code>pa_cost_centres</code> (budget vs actual per cost centre), the only hospital operating-finance store today. The budget/spend/variance/utilisation KPIs, the utilisation gauge, top cost centres by spend, the cost-centre table and expenditure-by-category are real and tenant-scoped (totals roll up the cost-centre lens; the category donut is the same spend by expense type, so it is labelled separately and reconciles only approximately). Total revenue, operating surplus, cash flow, capital projects, forecasting and the financial-risk register have no ledger/GL source and are shown honestly as connect-when-ready, not fabricated. (Platform SaaS-billing tables exist but are landlord-billing grain — not hospital operating finance — and are deliberately excluded here.)</Foot>
    </div>
  );
}
