"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// PCS-PORT-001 admin console — Portfolio Manager + Suite Designer + Product Assignment + Licensing Matrix over the
// packaging model (migration 105). Every mutation posts to /api/platform/portfolio (super-admin) and refreshes.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const btn = "text-[12px] font-medium rounded-lg px-2.5 py-1.5";

export default function PortfolioConsole({ data }: { data: any }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({}); // scratch form fields keyed by name
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const call = (method: string, opts: { body?: any; query?: string }) => start(async () => {
    setMsg(null);
    const url = "/api/platform/portfolio" + (opts.query ? `?${opts.query}` : "");
    const r = await fetch(url, { method, headers: opts.body ? { "Content-Type": "application/json" } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined }).catch(() => null);
    if (r?.ok) { setF({}); router.refresh(); } else { const j = await r?.json().catch(() => null); setMsg(j?.error ?? "Action failed"); }
  });
  const licensed = new Set<string>(data.licenseSet);

  return (
    <div className="space-y-5">
      {msg && <div className="bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] text-[12px] rounded-lg px-3 py-2">{msg}</div>}

      {/* Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[["Portfolios", data.stats.portfolios], ["Suites", data.stats.suites], ["Products", data.stats.products], ["Mapped", data.stats.mappedProducts], ["Gated workspaces", data.stats.gatedWorkspaces], ["Active licences", data.stats.activeLicenses]].map(([l, v]: any) => (
          <div key={l} className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{l}</p><p className="text-2xl font-bold tabular-nums text-gray-900">{v}</p></div>
        ))}
      </div>

      <div className="rounded-lg bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] text-[12px] text-amber-800 px-3 py-2">Note: this is the PCS <b>packaging</b> model (portfolio→suite→product→workspace, licence-gates workspace access). It is distinct from the POP-001 <b>billing</b> model (plans/subscriptions) in the <a href="/super-admin/platform-ops/licensing" className="underline font-medium">Licensing &amp; Subscription Centre</a>. Reconciling the two &quot;product&quot; concepts into one catalogue is a follow-up.</div>

      {/* Portfolio Manager + Suite Designer + Product Assignment */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-gray-900">Portfolios, Suites &amp; Products</h2></div>
        <div className="flex gap-2 mb-4">
          <input value={f.pfName ?? ""} onChange={e => set("pfName", e.target.value)} placeholder="New portfolio name…" className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={() => f.pfName && call("POST", { body: { type: "portfolio", name: f.pfName } })} disabled={pending || !f.pfName} className={`${btn} bg-[var(--cmp-color-information)] text-white hover:bg-[var(--cmp-color-information)] disabled:opacity-40`}>+ Portfolio</button>
        </div>

        {data.tree.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">No portfolios yet — create one above to begin packaging products into suites.</p>}
        <div className="space-y-4">
          {data.tree.map((pf: any) => (
            <div key={pf.id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-800">🗂️ {pf.name}</span>
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${pf.status === "active" ? "bg-[var(--cmp-surface-success)] text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{pf.status}</span>
                <span className="flex-1" />
                {pf.status === "active" && <button onClick={() => call("DELETE", { query: `type=portfolio&id=${pf.id}` })} disabled={pending} className="text-[11px] text-gray-500 hover:text-[var(--cmp-text-error)]">Archive</button>}
              </div>

              {/* suites */}
              <div className="space-y-2 pl-3 border-l-2 border-gray-100">
                {pf.suites.map((s: any) => (
                  <div key={s.id} className="bg-gray-50/50 rounded-lg p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-gray-800" style={{ color: s.color ?? undefined }}>{s.icon ?? "📦"} {s.name}</span>
                      {s.code && <span className="text-[10px] text-gray-500 font-mono">{s.code}</span>}
                      <span className="text-[10px] rounded px-1 bg-white border border-gray-200 text-gray-500">{s.visibility}</span>
                      <span className="flex-1" />
                      <button onClick={() => call("DELETE", { query: `type=suite&id=${s.id}` })} disabled={pending} className="text-[10px] text-gray-500 hover:text-[var(--cmp-text-error)]">Archive</button>
                    </div>
                    {/* products in suite */}
                    <div className="mt-2 space-y-1.5">
                      {s.products.map((p: any) => <ProductRow key={p.id} p={p} data={data} call={call} pending={pending} />)}
                      <div className="flex gap-1.5 pt-1">
                        <input value={f[`prod-${s.id}`] ?? ""} onChange={e => set(`prod-${s.id}`, e.target.value)} placeholder="New product name…" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[12px]" />
                        <button onClick={() => f[`prod-${s.id}`] && call("POST", { body: { type: "product", name: f[`prod-${s.id}`], suite_id: s.id } })} disabled={pending || !f[`prod-${s.id}`]} className={`${btn} bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40`}>+ Product</button>
                      </div>
                    </div>
                  </div>
                ))}
                {/* add suite */}
                <div className="flex gap-1.5">
                  <input value={f[`suite-${pf.id}`] ?? ""} onChange={e => set(`suite-${pf.id}`, e.target.value)} placeholder="New suite name…" className="flex-1 border border-gray-200 rounded px-2 py-1 text-[12px]" />
                  <button onClick={() => f[`suite-${pf.id}`] && call("POST", { body: { type: "suite", name: f[`suite-${pf.id}`], portfolio_id: pf.id } })} disabled={pending || !f[`suite-${pf.id}`]} className={`${btn} bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40`}>+ Suite</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Licensing Matrix */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Licensing Matrix</h2>
        <p className="text-[11px] text-gray-500 mb-3">Tenant × product. A ticked cell licenses that product for the tenant — which unlocks the product&apos;s mapped workspaces (fail-open: unmapped workspaces stay free).</p>
        {data.products.length === 0 || data.tenants.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">{data.products.length === 0 ? "Create products first." : "No tenants."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-[12px] border-collapse">
              <thead><tr><th className="text-left px-2 py-1 sticky left-0 bg-white">Tenant</th>{data.products.map((p: any) => <th key={p.code} className="px-2 py-1 text-gray-600 font-medium whitespace-nowrap" title={p.code}>{p.name}</th>)}</tr></thead>
              <tbody>
                {data.tenants.map((t: any) => (
                  <tr key={t.id} className="border-t border-gray-50">
                    <td className="px-2 py-1 font-medium text-gray-700 sticky left-0 bg-white whitespace-nowrap">{t.name ?? t.slug ?? t.id.slice(0, 8)}</td>
                    {data.products.map((p: any) => {
                      const on = licensed.has(`${t.id}:${p.code}`);
                      return <td key={p.code} className="px-2 py-1 text-center">
                        <button onClick={() => call(on ? "DELETE" : "POST", on ? { query: `type=license&tenant_id=${t.id}&product_code=${encodeURIComponent(p.code)}` } : { body: { type: "license", tenant_id: t.id, product_code: p.code } })} disabled={pending} className={`w-5 h-5 rounded ${on ? "bg-[var(--cmp-color-success)] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{on ? "✓" : ""}</button>
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Product row (a plat_products catalogue entry) with workspace mapping (Product Assignment) + dependency count.
function ProductRow({ p, data, call, pending }: any) {
  const [ws, setWs] = useState("");
  const unmapped = data.workspaceKeys.filter((w: any) => !p.workspaces.includes(w.key));
  return (
    <div className="bg-white border border-gray-100 rounded p-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-medium text-gray-800">{p.name}</span>
        <span className="text-[9px] font-mono text-gray-500">{p.code}</span>
        <span className="text-[9px] rounded px-1 bg-[var(--cmp-surface-information)] text-blue-700">{p.is_core ? "core" : "add-on"}</span>
        <span className="text-[9px] text-gray-500">{p.licensedTenants} licensed · {p.workspaces.length} workspace{p.workspaces.length === 1 ? "" : "s"}</span>
        <span className="flex-1" />
        <button onClick={() => call("DELETE", { query: `type=product&code=${encodeURIComponent(p.code)}` })} disabled={pending} className="text-[9px] text-gray-500 hover:text-[var(--cmp-text-error)]" title="Remove from suite (keeps the catalogue entry)">Unassign</button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        {p.workspaces.map((k: string) => (
          <span key={k} className="inline-flex items-center gap-1 text-[10px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">{k}<button onClick={() => call("DELETE", { query: `type=mapping&product_code=${encodeURIComponent(p.code)}&workspace_key=${encodeURIComponent(k)}` })} disabled={pending} className="hover:text-[var(--cmp-text-error)]">×</button></span>
        ))}
        {unmapped.length > 0 && <span className="inline-flex items-center gap-1">
          <select value={ws} onChange={e => setWs(e.target.value)} className="text-[10px] border border-gray-200 rounded px-1 py-0.5"><option value="">+ map workspace…</option>{unmapped.map((w: any) => <option key={w.key} value={w.key}>{w.label} ({w.key})</option>)}</select>
          {ws && <button onClick={() => { call("POST", { body: { type: "mapping", product_code: p.code, workspace_key: ws } }); setWs(""); }} disabled={pending} className="text-[10px] font-medium text-[var(--cmp-text-information)]">add</button>}
        </span>}
      </div>
    </div>
  );
}
