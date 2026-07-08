import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CycleManager from "./CycleManager";
import { CompleteCycleButton, ClinicalReadinessScore } from "./CycleActions";

const CYCLE_COLORS: Record<string, string> = {
  orientation: "bg-blue-100 text-blue-700",
  probation:   "bg-amber-100 text-amber-700",
  annual:      "bg-teal-100 text-teal-700",
  remediation: "bg-red-100 text-red-700",
  specialty:   "bg-violet-100 text-violet-700",
};
const STATUS_COLORS: Record<string, string> = {
  pending:  "bg-gray-100 text-gray-500",
  active:   "bg-green-100 text-green-700",
  complete: "bg-teal-100 text-teal-700",
  failed:   "bg-red-100 text-red-600",
  expired:  "bg-orange-100 text-orange-600",
};

export default async function CyclesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin","super_admin","educator"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();

  const { data: cycles } = await admin
    .from("competency_cycles")
    .select(`
      id, cycle_type, status, start_date, end_date, created_at, clinical_readiness_score,
      profiles!nurse_id(id, full_name, role),
      cycle_frameworks(id, status, framework_score, frameworks(name, library))
    `)
    .eq("hospital_id", profile.hospital_id ?? "")
    .order("created_at", { ascending: false });

  const { data: nurses } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("hospital_id", profile.hospital_id ?? "")
    .eq("role", "nurse")
    .order("full_name");

  const { data: frameworks } = await admin
    .from("frameworks")
    .select("id, name, library")
    .eq("is_active", true)
    .order("library")
    .order("name");

  const activeCycles = (cycles ?? []).filter(c => c.status === "active").length;
  const completedCycles = (cycles ?? []).filter(c => c.status === "complete").length;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Competency Cycles</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {activeCycles} active · {completedCycles} completed · {(cycles ?? []).length} total
          </p>
        </div>
        <CycleManager nurses={nurses ?? []} frameworks={frameworks ?? []} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Active",   count: activeCycles, color: "text-green-600", bg: "bg-green-50" },
          { label: "Complete", count: completedCycles, color: "text-teal-600", bg: "bg-teal-50" },
          { label: "Total",    count: (cycles ?? []).length, color: "text-gray-600", bg: "bg-gray-50" },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3`}>
            <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {(cycles ?? []).map(c => {
          const nurse = c.profiles as unknown as { id: string; full_name: string } | null;
          const fws = (c.cycle_frameworks ?? []) as unknown as { id: string; status: string; framework_score?: number; frameworks: { name: string; library: string } | null }[];
          const crs = (c as unknown as { clinical_readiness_score?: number }).clinical_readiness_score ?? null;
          return (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm">
                    {nurse?.full_name?.[0] ?? "?"}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{nurse?.full_name ?? "Unknown"}</p>
                    <p className="text-[10px] text-gray-400">
                      Started {new Date(c.start_date).toLocaleDateString()}
                      {c.end_date && ` · Due ${new Date(c.end_date).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${CYCLE_COLORS[c.cycle_type] ?? "bg-gray-100 text-gray-500"}`}>
                    {c.cycle_type}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {c.status}
                  </span>
                  {c.status === "active" && <CompleteCycleButton cycleId={c.id} />}
                </div>
              </div>

              {fws.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-50">
                  {fws.map(f => (
                    <span key={f.id} className={`text-[10px] px-2 py-0.5 rounded ${
                      f.status === "complete" ? "bg-teal-50 text-teal-600" :
                      f.status === "in_progress" ? "bg-blue-50 text-blue-600" :
                      "bg-gray-100 text-gray-500"
                    }`}>
                      {f.frameworks?.name ?? "—"}
                      {f.framework_score != null ? ` · ${f.framework_score.toFixed(1)}` : ""}
                    </span>
                  ))}
                </div>
              )}

              <ClinicalReadinessScore score={crs} />
            </div>
          );
        })}

        {!(cycles ?? []).length && (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-2xl mb-2">🔄</p>
            <p className="text-gray-400 text-sm">No cycles yet. Start one for a nurse using &quot;+ New Cycle&quot;.</p>
          </div>
        )}
      </div>
    </div>
  );
}
