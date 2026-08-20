"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { assetHref, TYPE_LABEL, STATUS_ORDER, ASSET_ENGINES, type AssetRow } from "@/lib/assets/service";
import AssetFiles from "./AssetFiles";
import AssetEdit from "./AssetEdit";

type Facets = { byType: Record<string, number>; byStatus: Record<string, number>; total: number };
type Status = { total: number; byType: Record<string, number>; lastIndexedAt: string | null; types: number };
type Overlays = Record<string, { linked: number; total: number }>;

const STATUS_STYLE: Record<string, string> = {
  draft: "text-gray-500 bg-gray-50 border-gray-100",
  in_review: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]",
  approved: "text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)]",
  published: "text-teal-700 bg-teal-50 border-teal-100",
  active: "text-[var(--cmp-text-success)] bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]",
  archived: "text-gray-500 bg-gray-50 border-gray-100",
};

function StatusBadge({ s }: { s: string | null }) {
  const k = s ?? "active";
  return <span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${STATUS_STYLE[k] ?? STATUS_STYLE.active}`}>{k.replace("_", " ")}</span>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-[11px] font-semibold rounded-lg px-2.5 py-1 border transition-colors ${active ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-200"}`}>{children}</button>
  );
}

function fmtDate(s: string | null) {
  if (!s) return "never";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

type OrgOpt = { id: string; name: string };

export default function AssetBrowser({ initialRows, initialTotal, initialFacets, initialStatus, initialOverlays, orgOptions }: { initialRows: AssetRow[]; initialTotal: number; initialFacets: Facets; initialStatus: Status; initialOverlays: Overlays; orgOptions: OrgOpt[] }) {
  const [rows, setRows] = useState<AssetRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [type, setType] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [org, setOrg] = useState("");
  // Facets, index status and overlay coverage are recomputed server-side (a refresh reloads the page).
  const facets: Facets = initialFacets;
  const status: Status = initialStatus;
  const overlays: Overlays = initialOverlays;
  const orgName = new Map(orgOptions.map(o => [o.id, o.name]));

  const load = useCallback(async (next: { type?: string; status?: string; q?: string; org?: string; page?: number }) => {
    const t = next.type ?? type, st = next.status ?? statusFilter, query = next.q ?? q, og = next.org ?? org, pg = next.page ?? 1;
    setLoading(true);
    const params = new URLSearchParams();
    if (t) params.set("type", t);
    if (st) params.set("status", st);
    if (query.trim()) params.set("q", query.trim());
    if (og) params.set("org", og);
    params.set("page", String(pg));
    const r = await fetch(`/api/admin/assets?${params.toString()}`);
    const j = await r.json().catch(() => ({ rows: [], total: 0 }));
    setLoading(false);
    setRows(j.rows ?? []); setTotal(j.total ?? 0); setPage(pg);
  }, [type, statusFilter, q, org]);

  async function refresh() {
    setBusy(true);
    const r = await fetch("/api/admin/assets/refresh", { method: "POST" });
    await r.json().catch(() => ({}));
    // Reload so the server recomputes facets, counts and index status from the freshly-populated index.
    if (r.ok) { window.location.reload(); return; }
    setBusy(false);
  }

  const pageSize = 25;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const empty = status.total === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Index status + refresh */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Governed index</h2>
            <p className="text-[11px] text-gray-500">{status.total} assets across {status.types} types · last refreshed {fmtDate(status.lastIndexedAt)}</p>
          </div>
          <button onClick={refresh} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Refreshing…" : "Refresh index"}</button>
        </div>
        {empty && <p className="text-[11px] text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-lg px-3 py-2">The index is empty. Click <span className="font-semibold">Refresh index</span> to build cap_assets from the 12 source tables.</p>}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {ASSET_ENGINES.map(e => (
            <Link key={e.href} href={e.href} className="text-[10px] font-semibold text-gray-500 bg-gray-50 hover:bg-teal-50 hover:text-teal-700 border border-gray-100 rounded px-2 py-1" title={e.desc}>{e.label} →</Link>
          ))}
        </div>
        {Object.keys(overlays).length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-50">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Overlays linked to the header</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(overlays).map(([label, o]) => {
                const pct = o.total ? Math.round((o.linked / o.total) * 100) : 0;
                const tone = o.total === 0 ? "text-gray-500 border-gray-100" : o.linked === o.total ? "text-teal-700 bg-teal-50 border-teal-100" : "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]";
                return <span key={label} className={`text-[10px] font-semibold border rounded px-2 py-1 ${tone}`}>{label} {o.linked}/{o.total}{o.total ? ` · ${pct}%` : ""}</span>;
              })}
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">A real cap_asset_id FK — rows whose type has no asset counterpart (policy, guideline, learning-pathway) stay unlinked by design.</p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && load({ q, page: 1 })} placeholder="Search assets by name…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400" />
          <button onClick={() => load({ q, page: 1 })} disabled={loading} className="text-sm font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 rounded-lg px-4">Search</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={type === ""} onClick={() => { setType(""); load({ type: "", page: 1 }); }}>All types ({facets.total})</Chip>
          {Object.keys(TYPE_LABEL).filter(t => (facets.byType[t] ?? 0) > 0).map(t => (
            <Chip key={t} active={type === t} onClick={() => { setType(t); load({ type: t, page: 1 }); }}>{TYPE_LABEL[t]} ({facets.byType[t]})</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={statusFilter === ""} onClick={() => { setStatusFilter(""); load({ status: "", page: 1 }); }}>Any status</Chip>
          {STATUS_ORDER.filter(s => (facets.byStatus[s] ?? 0) > 0).map(s => (
            <Chip key={s} active={statusFilter === s} onClick={() => { setStatusFilter(s); load({ status: s, page: 1 }); }}>{s.replace("_", " ")} ({facets.byStatus[s]})</Chip>
          ))}
        </div>
        {orgOptions.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide shrink-0">Organisation</span>
            <select value={org} onChange={e => { setOrg(e.target.value); load({ org: e.target.value, page: 1 }); }} className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400">
              <option value="">All organisations</option>
              {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="text-[10px] text-gray-500 hidden sm:inline">rolls assets up to the org that owns their hospital · visibility, not an access boundary</span>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
          <p className="text-[11px] text-gray-500">{total} result{total === 1 ? "" : "s"}{loading ? " · loading…" : ""}</p>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => page > 1 && load({ page: page - 1 })} disabled={page <= 1} className="text-[11px] font-semibold text-gray-500 disabled:opacity-30 hover:text-teal-700">← Prev</button>
              <span className="text-[11px] text-gray-500">{page}/{pages}</span>
              <button onClick={() => page < pages && load({ page: page + 1 })} disabled={page >= pages} className="text-[11px] font-semibold text-gray-500 disabled:opacity-30 hover:text-teal-700">Next →</button>
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-gray-500 px-4 py-8 text-center">{empty ? "No indexed assets yet." : "No assets match these filters."}</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {rows.map(r => (
              <div key={r.id}>
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/60 group">
                  <Link href={assetHref(r.object_type, r.object_id)} className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0 w-28 text-center truncate">{TYPE_LABEL[r.object_type] ?? r.object_type}</span>
                    <span className="text-sm font-medium text-gray-800 group-hover:text-teal-700 truncate">{r.name || "Untitled"}</span>
                  </Link>
                  <span className="text-[10px] text-gray-500 shrink-0 hidden sm:inline truncate max-w-[8rem]" title={r.hospital_id ? "Hospital-scoped" : "Global / shared"}>{!r.hospital_id ? "Global" : (r.organisation_id && orgName.get(r.organisation_id)) || "Hospital"}</span>
                  <span className="text-[10px] text-gray-500 shrink-0 w-10 text-right tabular-nums hidden sm:inline">v{r.version ?? "1.0"}</span>
                  <StatusBadge s={r.status} />
                  <button onClick={() => setEditFor(editFor === r.id ? null : r.id)} className={`text-xs shrink-0 rounded px-1.5 py-0.5 border transition-colors ${editFor === r.id ? "bg-teal-50 border-teal-200" : "border-gray-200 hover:border-teal-200"}`} title="Govern status/version" aria-label="Edit status">✎</button>
                  <button onClick={() => setFilesFor(filesFor === r.id ? null : r.id)} className={`text-xs shrink-0 rounded px-1.5 py-0.5 border transition-colors ${filesFor === r.id ? "bg-teal-50 border-teal-200" : "border-gray-200 hover:border-teal-200"}`} title="Files" aria-label="Files">📎</button>
                </div>
                {editFor === r.id && (
                  <div className="px-4 pb-3">
                    <AssetEdit objectType={r.object_type} objectId={r.object_id} currentStatus={r.status} currentVersion={r.version}
                      onSaved={(s, v) => setRows(rows.map(x => x.id === r.id ? { ...x, status: s ?? x.status, version: v ?? x.version } : x))} />
                  </div>
                )}
                {filesFor === r.id && (
                  <div className="px-4 pb-3">
                    <AssetFiles objectType={r.object_type} objectId={r.object_id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
