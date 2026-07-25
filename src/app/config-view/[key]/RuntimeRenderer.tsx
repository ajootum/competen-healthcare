import Link from "next/link";
import { Tile, WidgetCard } from "./widgets";

// Metadata-driven runtime renderer (NCP-015) — renders a composed configuration object as the real surface the
// current user sees: only enabled widgets/tiles and only role-visible navigation. Navigation items backed by a
// registry target link recursively into that object's live view, so the whole experience is composed from
// metadata. Widget/metric bodies are typed placeholders until concrete widget components exist (honest).
/* eslint-disable @typescript-eslint/no-explicit-any */

function NavMenu({ items }: { items: any[] }) {
  const visible = items.filter(i => i.visible);
  return (
    <nav className="space-y-0.5">
      {visible.map((it: any) => (
        <div key={it.key}>
          {it.target && !it.target.external ? (
            <Link href={`/config-view/${encodeURIComponent(it.target.key)}`} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 hover:bg-indigo-50">
              <span className="w-4 text-center text-gray-400">{it.icon || "•"}</span><span className="truncate">{it.label || it.key}</span>
            </Link>
          ) : (
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-700"><span className="w-4 text-center text-gray-400">{it.icon || "•"}</span><span className="truncate">{it.label || it.key}</span></div>
          )}
          {it.children?.some((c: any) => c.visible) && <div className="ml-4 border-l border-gray-100 pl-1.5 mt-0.5"><NavMenu items={it.children} /></div>}
        </div>
      ))}
      {visible.length === 0 && <p className="text-xs text-gray-400 px-2.5 py-1.5">No navigation is visible in your context.</p>}
    </nav>
  );
}

export default function RuntimeRenderer({ composed, ctx }: { composed: any; ctx: any }) {
  const o = composed.object;
  const card = "bg-white rounded-xl border border-gray-200";

  const header = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">metadata-driven</span>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{o.name}</h1>
        </div>
        <p className="text-[11px] text-gray-400 font-mono mt-0.5">{o.key}</p>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
        <span className="text-gray-400">your context:</span>
        {ctx.hospitalId && <span className="bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">hospital</span>}
        {(ctx.roles ?? []).slice(0, 3).map((r: string) => <span key={r} className="bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{r}</span>)}
      </div>
    </div>
  );

  if (!composed.composable) return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">{header}<div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">This object type ({o.type}) is not a renderable surface.</p><p className="text-xs text-gray-400 mt-1">Only pages, dashboards and navigation sections render here.</p></div></div>
  );

  const m = composed.model;
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {header}

      {m.kind === "page" && (
        <div className="space-y-2">
          {m.rows.map((row: any, ri: number) => (
            <div key={ri} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${m.grid}, minmax(0,1fr))` }}>
              {row.columns.filter((c: any) => c.shown).map((col: any, ci: number) => (
                <div key={ci} className={`${card} p-4 min-h-[72px]`} style={{ gridColumn: `span ${col.span} / span ${col.span}` }}>
                  <WidgetCard widget={col.widget} />
                </div>
              ))}
            </div>
          ))}
          {m.rows.every((r: any) => r.columns.every((c: any) => !c.shown)) && <div className={`${card} p-8 text-center text-sm text-gray-400`}>No widgets are enabled in your context.</div>}
        </div>
      )}

      {m.kind === "dashboard" && (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
          {m.tiles.filter((t: any) => t.shown).map((t: any) => (
            <div key={t.key} className={`${card} p-4 min-h-[92px]`} style={{ gridColumn: `span ${t.span || 4} / span ${t.span || 4}` }}>
              <Tile tile={t} />
            </div>
          ))}
          {m.tiles.every((t: any) => !t.shown) && <div className={`${card} p-8 text-center text-sm text-gray-400 col-span-12`}>No tiles are enabled in your context.</div>}
        </div>
      )}

      {m.kind === "navigation" && (
        <div className={`${card} p-3 max-w-xs`}><NavMenu items={m.items} /></div>
      )}

      <p className="text-[11px] text-gray-400">This surface is composed entirely from configuration for your context — nothing here is hard-coded. Widgets render their configured spec (target, RAG thresholds, data source); live numeric values arrive with the metric calculation runtime (NCP-005 next-phase).</p>
    </div>
  );
}
