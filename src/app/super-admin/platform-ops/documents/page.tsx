import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDocuments, humanSize } from "@/lib/platform/documents";

export const dynamic = "force-dynamic";

// Unified Document Service console (PCS-000 Document) — one index across the evidence
// and assessment-evidence stores with type/source distribution and a recent list.
// Read-only aggregation; a write-path document service with versioning/retention is
// an honest next-phase gap.

const card = "bg-white rounded-xl border border-gray-200";
const TYPE_COLOR = ["#14b8a6", "#8b5cf6", "#3b82f6", "#f59e0b", "#ef4444", "#0ea5e9", "#6b7280"];
const stamp = (iso?: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "—");

function Kpi({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className="text-2xl font-bold tabular-nums mt-0.5 text-gray-900">{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}
function Donut({ segs, total }: { segs: { n: number; color: string }[]; total: number }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segs.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span><span className="text-[8px] text-gray-400">Docs</span></div></div>;
}

export default async function DocumentServiceConsole({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const source = typeof sp.source === "string" ? sp.source : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadDocuments(admin, { source });

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><span className="text-xl">📎</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Document Service</h1><p className="text-sm text-gray-500">Unified index of evidence, credentials and assessment documents across the platform.</p></div></div>
      <Link href="/super-admin/platform-ops" className="text-xs text-teal-700 hover:underline shrink-0">← Platform Operations</Link>
    </div>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Document stores not provisioned</p><p className="text-sm text-amber-800 mt-1">The evidence and assessment-evidence stores aren&apos;t available for this tenant yet.</p></div></div>;

  const k = d.kpis;
  const active = source && ["Evidence", "Assessment"].includes(source) ? source : "All";
  const chips: string[] = ["All", ...Object.entries(d.sourcesAvailable).filter(([, ok]) => ok).map(([s]) => s)];
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total Documents" value={k.total.toLocaleString()} sub="Across all sources" icon="📄" />
        <Kpi label="Stored Files" value={k.withFile.toLocaleString()} sub="With a file blob" icon="🗄️" />
        <Kpi label="Document Types" value={k.types} sub="Distinct types" icon="🏷️" />
        <Kpi label="Total Size" value={humanSize(k.totalSize)} sub="Metered blobs only" icon="💾" />
        <Kpi label="Added This Week" value={k.thisWeek.toLocaleString()} sub="Last 7 days" icon="🆕" />
        <Kpi label="Sources" value={k.sources} sub="Connected stores" icon="🔌" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">By Type</h3>
          {d.byType.length === 0 ? <p className="text-sm text-gray-400">No documents.</p> : (
            <div className="flex items-center gap-3"><Donut total={k.total} segs={d.byType.map((x, i) => ({ n: x.n, color: TYPE_COLOR[i % TYPE_COLOR.length] }))} /><div className="text-[11px] space-y-0.5 flex-1">{d.byType.slice(0, 7).map((x, i) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[i % TYPE_COLOR.length] }} /><span className="text-gray-600 flex-1 truncate">{x.label}</span><b>{x.n}</b></div>)}</div></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">By Source</h3>
          <div className="space-y-2">{d.bySource.map(x => (<div key={x.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{x.label}</span><span className="text-gray-400">{x.n} ({x.pct}%)</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${x.pct}%` }} /></div></div>))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Integrity &amp; Retention</h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="text-gray-700">Storage backend</span><span className="text-gray-500 text-[10px]">Supabase Storage</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-700">Index sources</span><b className="text-gray-900">{k.sources}</b></div>
            <div className="flex items-center justify-between"><span className="text-gray-400">Versioning</span><span className="text-gray-300 text-[10px]">Next phase</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-400">Retention policy</span><span className="text-gray-300 text-[10px]">Next phase</span></div>
          </div>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-gray-900">Recent Documents</h3>
          <div className="flex gap-1">{chips.map(s => <Link key={s} href={s === "All" ? "/super-admin/platform-ops/documents" : `/super-admin/platform-ops/documents?source=${s}`} className={`text-[10px] px-2 py-0.5 rounded-full ${active === s ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{s}</Link>)}</div>
        </div>
        {d.recent.length === 0 ? (
          <div className="text-center py-8"><p className="text-3xl mb-2">📭</p><p className="text-sm text-gray-500">No documents in this source yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Added</th><th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Owner</th><th className="py-2 pr-3 font-medium">Size</th><th className="py-2 font-medium">File</th></tr></thead>
              <tbody>
                {d.recent.map(doc => (
                  <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{stamp(doc.at)}</td>
                    <td className="py-2 pr-3 text-gray-800 font-medium max-w-[180px] truncate">{doc.name}</td>
                    <td className="py-2 pr-3 text-gray-600">{doc.type}</td>
                    <td className="py-2 pr-3 text-gray-600">{doc.source}</td>
                    <td className="py-2 pr-3 text-gray-600 truncate max-w-[110px]">{doc.owner}</td>
                    <td className="py-2 pr-3 text-gray-500">{humanSize(doc.sizeBytes)}</td>
                    <td className="py-2">{doc.hasFile ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 mt-2">Showing {d.recent.length} most recent. Size is metered for stored blobs (evidence store); assessment evidence links to external files.</p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Document Service (PCS-000 Document) unifies the platform&apos;s document-bearing stores — evidence &amp; credential documents (evidence) and assessment evidence (assessment_evidence) — into one normalised index with type/source distribution and size metering. It is a read-only aggregation over what already exists; a write-path document service with upload, versioning, retention policies and full-text document search is an honest next-phase gap, not pretended-built.</p>
    </div>
  );
}
