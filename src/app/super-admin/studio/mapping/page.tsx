import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMappingStudio } from "@/lib/studio/mapping";
import { requireHqCapability } from "@/lib/hq/context";

// CST-104 — Competency Mapping Studio. Traceability across the cross-object links that already exist
// (competency ↔ CPU / assessment / evidence / learning / skills): per-dimension coverage, a per-framework
// coverage heatmap, and the competencies with the thinnest traceability. Dimensions with no store yet
// (standards, clinical role) are shown as pending — standards mapping is CST-108. Computed on read.

export const dynamic = "force-dynamic";

const DIM_COLS: { key: string; label: string }[] = [
  { key: "cpu", label: "CPU" }, { key: "assessment", label: "Assess" }, { key: "evidence", label: "Evidence" }, { key: "learning", label: "Learning" }, { key: "skills", label: "Skills" },
];
function cellColor(pct: number) { return pct >= 90 ? "#10b981" : pct >= 75 ? "#3b82f6" : pct >= 50 ? "#f59e0b" : pct > 0 ? "#ef4444" : "#cbd5e1"; }

export default async function StudioMappingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const map = await loadMappingStudio(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-104 · Mapping Studio</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Traceability</h1>
          <p className="text-gray-400 text-sm mt-0.5">How competencies map across assessment, evidence, learning, skills and CPUs — coverage and gaps, computed live.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {!map.provisioned ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">Content tables are not available in this environment.</div>
      ) : map.empty ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No competencies to map yet — author frameworks and competencies in the Studio first.</div>
      ) : (
        <>
          {/* Dimension coverage */}
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Mapping dimensions · {map.total} competencies</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {map.dimensions.map(d => (
              <div key={d.key} className={`bg-white rounded-xl border border-gray-100 p-4 ${d.pending ? "opacity-70" : ""}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-700">{d.label}</span>
                  {d.pending ? <span className="text-[8px] font-bold uppercase tracking-wide text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] px-1.5 py-0.5 rounded">Pending</span>
                    : <span className="text-sm font-bold" style={{ color: cellColor(d.coverage) }}>{d.coverage}%</span>}
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5"><div className="h-full rounded-full" style={{ width: `${d.coverage}%`, backgroundColor: d.color }} /></div>
                <p className="text-[10px] text-gray-400">{d.pending ? "No store yet — standards mapping is CST-108" : `${d.links} link${d.links === 1 ? "" : "s"}`}</p>
              </div>
            ))}
          </div>

          {/* Per-framework coverage heatmap */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Coverage heatmap</h2>
              <span className="text-[9px] text-gray-400">% of each framework&apos;s competencies traced to the dimension · lowest first</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] text-gray-400 uppercase tracking-wide">
                    <th className="text-left font-semibold py-1.5 pr-3 min-w-[180px]">Framework</th>
                    {DIM_COLS.map(c => <th key={c.key} className="font-semibold py-1.5 px-2 text-center w-20">{c.label}</th>)}
                    <th className="font-semibold py-1.5 px-2 text-center w-14">n</th>
                  </tr>
                </thead>
                <tbody>
                  {map.matrix.map(m => (
                    <tr key={m.id} className="border-t border-gray-50">
                      <td className="py-1.5 pr-3"><Link href={`/super-admin/content/${m.id}`} className="text-gray-700 hover:text-teal-700 truncate block max-w-[220px]">{m.name}</Link></td>
                      {DIM_COLS.map(c => {
                        const pct = m.cells[c.key] ?? 0;
                        return <td key={c.key} className="py-1 px-1 text-center"><span className="inline-block w-full rounded py-1 font-semibold" style={{ backgroundColor: `${cellColor(pct)}22`, color: cellColor(pct) }}>{pct}%</span></td>;
                      })}
                      <td className="py-1.5 px-2 text-center text-gray-400">{m.competencies}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Thinnest traceability */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Thinnest traceability</h2>
              <span className="text-[9px] text-gray-400">competencies mapped to the fewest object types</span>
            </div>
            {map.gaps.length === 0 ? (
              <p className="text-xs text-gray-400">Every competency is traced across all dimensions. 🎉</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {map.gaps.map((g, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 text-xs">
                    <span className="font-semibold text-gray-800 truncate max-w-[38%]">{g.name}</span>
                    {g.framework && <span className="text-[10px] text-gray-400 truncate hidden md:inline">{g.framework}</span>}
                    <span className="ml-auto flex items-center gap-1">
                      {g.missing.map(m => <span key={m} className="text-[9px] font-semibold text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)] rounded px-1.5 py-0.5">no {m}</span>)}
                      <span className="text-[10px] font-bold text-gray-500 ml-1">{g.mapped}/5</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
