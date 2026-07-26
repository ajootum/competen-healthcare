// HEX-005 Financial Intelligence (executive lens). HONEST module: the ONLY real hospital operating-finance
// store today is pa_cost_centres (budget vs actual per cost centre), read via fetchPerformance. There is no
// revenue/GL/cash-flow ledger, so total revenue, operating surplus, cash flow, capital projects, forecasting
// and the financial-risk register are ABSENT and surfaced as "connect-when-ready", never fabricated.
//
// Note on double-counting: pa_cost_centres models the SAME operating spend two ways — by operational
// department (category "department") and by expense category (category "spend"). Summing both would
// double-count, so — mirroring loadPaFinancial — the department rows are the canonical cost-centre rollup
// (totals / table / bars) and the spend rows are the expenditure-by-category breakdown (donut). Falls back
// to a flat treatment when a tenant's data doesn't follow that convention. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchPerformance } from "@/lib/analytics/performance";

const n = (v: any) => Number(v ?? 0);

export async function loadExecFinancial(admin: any, hid: string | null, isSuper: boolean) {
  const perf = await fetchPerformance(admin, hid, isSuper);
  const provisioned = perf.provisioned === true;
  const allCentres = (perf.provisioned ? (perf.costCentres ?? []) : []) as any[];

  const deptRows = allCentres.filter(c => c.category === "department");
  const spendRows = allCentres.filter(c => c.category === "spend");
  const lensSplit = deptRows.length > 0 && spendRows.length > 0;

  // Canonical cost-centre lens (one coherent set — totals reconcile with table + bars).
  const centreRows = deptRows.length ? deptRows : allCentres;
  const hasData = centreRows.length > 0;

  const totalBudget = centreRows.reduce((a, c) => a + n(c.budget), 0);
  const totalActual = centreRows.reduce((a, c) => a + n(c.actual), 0);
  const variance = totalBudget - totalActual;                    // + = under budget (favourable)
  const utilisation = totalBudget ? Math.round((totalActual / totalBudget) * 100) : null;

  const centres = centreRows
    .map(c => {
      const budget = n(c.budget), actual = n(c.actual);
      return { name: c.name ?? "—", category: c.category ?? null, budget, actual, variance: budget - actual, utilisation: budget ? Math.round((actual / budget) * 100) : null };
    })
    .sort((a, b) => b.actual - a.actual);

  const topSpend = centres.slice(0, 8).map(c => ({ name: c.name, actual: c.actual, share: totalActual ? Math.round((c.actual / totalActual) * 100) : 0 }));

  // Expenditure-by-category lens: prefer the explicit "spend" breakdown; else group all rows by their
  // category column; else fall back to one segment per cost centre.
  let byCategory: { label: string; value: number }[];
  if (spendRows.length) {
    byCategory = spendRows.map(c => ({ label: c.name ?? "—", value: n(c.actual) }));
  } else {
    const m = new Map<string, number>();
    allCentres.forEach(c => { const key = c.category ?? c.name ?? "Uncategorised"; m.set(key, (m.get(key) ?? 0) + n(c.actual)); });
    byCategory = [...m.entries()].map(([label, value]) => ({ label, value }));
  }
  byCategory = byCategory.filter(x => x.value > 0).sort((a, b) => b.value - a.value);
  const categoryTotal = byCategory.reduce((a, s) => a + s.value, 0);

  return {
    provisioned,
    hasData,
    lensSplit,
    kpis: { totalBudget, totalActual, variance, utilisation, favourable: variance >= 0 },
    centres,
    topSpend,
    byCategory,
    categoryTotal,
  };
}
