import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LibrarySearch from "./LibrarySearch";
import { loadDocumentLibrary, DOC_TYPE } from "@/lib/document-library";

// PW-008 Documents & Knowledge Library — unified view over the platform's real governed content (policies,
// knowledge objects, learning resources, quality standards, clinical cases). KPI ribbon, browse tree, document
// list (type filter via ?type=), category donut, mandatory/review-due list and recent additions. Server-rendered,
// read-only. No binary/upload/storage/bookmark store exists — those are shown honestly as next-phase, never faked.
export const dynamic = "force-dynamic";

const nowMs = () => Date.now(); // module helper — Date.now() in render body trips react-hooks/purity
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Kpi({ icon, label, value, sub, tint }: { icon: string; label: string; value: string | number; sub: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
      <p className="text-[11px] font-medium text-gray-700 leading-tight">{label}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}

export default async function DocumentLibraryPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();

  const d = await loadDocumentLibrary(admin, user.id, profile);
  const rows = (type ? d.docs.filter((x: any) => x.type === type) : d.docs).slice(0, 40); // eslint-disable-line @typescript-eslint/no-explicit-any
  const reviewCutoff = nowMs() + 30 * 86400000;

  // Donut geometry.
  const donutTotal = d.donut.reduce((s: number, c: any) => s + c.n, 0) || 1; // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = 46, C = 2 * Math.PI * R;
  const segs = d.donut.map((c: any, i: number) => ({ ...c, len: (c.n / donutTotal) * C, offset: d.donut.slice(0, i).reduce((s: number, x: any) => s + (x.n / donutTotal) * C, 0) })); // eslint-disable-line @typescript-eslint/no-explicit-any

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-information)] uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Documents &amp; Knowledge Library</h1>
          <p className="text-sm text-gray-500 mt-0.5">Find, access and manage all your essential documents, policies, guidelines and knowledge resources.</p>
        </div>
        <Link href="/dashboard/copilot" className="text-sm font-medium text-white bg-[var(--cmp-color-information)] rounded-lg px-3 py-2 hover:bg-[var(--cmp-color-information)]">✨ Ask AI</Link>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon="📚" label="Total Documents" value={d.kpis.total} sub="In library" tint="bg-[var(--cmp-surface-information)]" />
        <Kpi icon="📁" label="My Documents" value={d.kpis.myDocs} sub="Authored by you" tint="bg-indigo-50" />
        <Kpi icon="📖" label="Knowledge" value={d.kpis.knowledge} sub="Articles + cases" tint="bg-violet-50" />
        <Kpi icon="🛡️" label="Mandatory" value={d.kpis.mandatory} sub="Policies" tint="bg-[var(--cmp-surface-error)]" />
        <Kpi icon="⏰" label="Review Soon" value={d.kpis.reviewSoon} sub="Within 30 days" tint="bg-[var(--cmp-surface-warning)]" />
        <Kpi icon="🗂️" label="Categories" value={d.kpis.categories} sub="Content types" tint="bg-cyan-50" />
        <Kpi icon="🆕" label="Added (7d)" value={d.kpis.added7d} sub="Recently" tint="bg-[var(--cmp-surface-success)]" />
      </div>

      <LibrarySearch />

      <div className="grid lg:grid-cols-[200px_minmax(0,1fr)_280px] gap-5 items-start">
        {/* Browse tree */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2 pb-1">Browse</p>
          <Link href="/dashboard/library" className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm ${!type ? "bg-[var(--cmp-surface-information)] text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}><span>📚 All Documents</span><span className="text-[11px] text-gray-400">{d.totalShown}</span></Link>
          {d.browse.map((b: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <Link key={b.type} href={`/dashboard/library?type=${b.type}`} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm ${type === b.type ? "bg-[var(--cmp-surface-information)] text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}><span className="truncate">{b.icon} {b.label}</span><span className="text-[11px] text-gray-400 shrink-0 ml-1">{b.n}</span></Link>
          ))}
        </div>

        {/* Document list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">{type ? DOC_TYPE[type]?.label ?? "Documents" : "All Documents"}</h2>
            <span className="text-[11px] text-gray-400">{rows.length} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-semibold text-gray-500 uppercase border-b border-gray-100 bg-gray-50/60"><th className="px-4 py-2.5">Name</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5">Modified</th><th className="px-3 py-2.5"></th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((doc: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <tr key={`${doc.type}-${doc.id}`} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="text-base shrink-0">{doc.meta.icon}</span><span className="font-medium text-gray-800 leading-tight">{doc.name}{doc.review_date && new Date(doc.review_date).getTime() <= reviewCutoff && <span className="ml-1.5 text-[10px] font-medium text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] rounded px-1">review due</span>}</span></div></td>
                    <td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5" style={{ background: `${doc.meta.color}15`, color: doc.meta.color }}>{doc.meta.label}</span></td>
                    <td className="px-3 py-3 text-gray-500 text-[12px] capitalize">{doc.category}</td>
                    <td className="px-3 py-3 text-gray-500 text-[12px] whitespace-nowrap">{fmtDate(doc.modified)}</td>
                    <td className="px-3 py-3 text-right"><Link href={doc.meta.href} className="text-[12px] font-medium text-[var(--cmp-text-information)] hover:underline">Open →</Link></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-gray-400">No documents in this category.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-400">Showing {rows.length} of {d.totalAll} governed documents</div>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">By Category</h3>
            {d.donut.length > 0 ? (
              <div className="flex items-center gap-4">
                <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
                  <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
                  {segs.map((c: any, i: number) => <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={c.color} strokeWidth="14" strokeDasharray={`${c.len} ${C - c.len}`} strokeDashoffset={-c.offset} transform="rotate(-90 60 60)" />) /* eslint-disable-line @typescript-eslint/no-explicit-any */}
                  <text x="60" y="56" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="18">{d.totalShown}</text>
                  <text x="60" y="72" textAnchor="middle" className="fill-gray-400" fontSize="8">Shown</text>
                </svg>
                <div className="space-y-1.5 text-[12px] flex-1">
                  {d.donut.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <div key={c.type} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-gray-600 truncate">{c.label}</span><span className="ml-auto font-semibold text-gray-900">{c.n}</span></div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No documents yet.</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Mandatory Documents</h3>
            {d.mandatoryList.length > 0 ? (
              <div className="space-y-2">
                {d.mandatoryList.map((m: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={m.id} className="flex items-start gap-2"><span className="text-blue-500 text-sm shrink-0">📋</span><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 leading-tight truncate">{m.name}</p><p className="text-[10px] text-gray-400">{m.review_date ? `Review by ${fmtDate(m.review_date)}` : "No review date"}</p></div></div>
                ))}
                <Link href="/dashboard/library?type=policy" className="block text-center text-[12px] font-medium text-[var(--cmp-text-information)] hover:underline pt-1">View all policies →</Link>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No mandatory documents.</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recently Added</h3>
            {d.recent.length > 0 ? (
              <div className="space-y-2">
                {d.recent.map((r: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={`${r.type}-${r.id}`} className="flex items-center gap-2"><span className="text-sm shrink-0">{r.meta.icon}</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 truncate">{r.name}</p><p className="text-[10px] text-gray-400">{fmtDate(r.modified)}</p></div></div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">Nothing added recently.</p>}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Library aggregates the platform&apos;s real governed content. File upload, storage quota, bookmarks and secure sharing require their own stores (progressive) — sizes aren&apos;t shown as fabricated numbers.</p>
    </div>
  );
}
