import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Remediation & Learning Plans (Assessor Workspace redesign): nurses whose
// latest decisions are non-passing or expired, with the learning-pathway items
// the pathway engine generated for them. Everything is read from real
// decisions and learning_pathways — mentorship assignments aren't tracked yet.

export default async function RemediationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name").eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").limit(200);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [{ data: decisions }, { data: pathways }] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_decisions")
          .select("nurse_id, competency_id, outcome, critical_failure, expiry_date, created_at, framework_competencies(name)")
          .in("nurse_id", nurseIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("learning_pathways").select("id, nurse_id, pathway_items(competency_name, reason, resource_title, status)")
          .in("nurse_id", nurseIds)
      : Promise.resolve({ data: [] }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  type Item = { competency: string; kind: "remediation" | "expired"; date: string | null };
  const byNurse = new Map<string, Item[]>();
  const seen = new Set<string>();
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    let item: Item | null = null;
    if (!passing) item = { competency: name, kind: "remediation", date: d.created_at?.slice(0, 10) ?? null };
    else if (d.expiry_date && d.expiry_date < today) item = { competency: name, kind: "expired", date: d.expiry_date };
    if (item) {
      const list = byNurse.get(d.nurse_id) ?? [];
      list.push(item);
      byNurse.set(d.nurse_id, list);
    }
  }

  const planByNurse = new Map<string, { competency_name: string | null; reason: string | null; resource_title: string | null; status: string | null }[]>();
  for (const p of (pathways ?? []) as unknown as { nurse_id: string; pathway_items: { competency_name: string | null; reason: string | null; resource_title: string | null; status: string | null }[] }[]) {
    planByNurse.set(p.nurse_id, p.pathway_items ?? []);
  }

  const flagged = (nurses ?? [])
    .filter(n => byNurse.has(n.id))
    .map(n => ({ ...n, items: byNurse.get(n.id)!, plan: planByNurse.get(n.id) ?? [] }));

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Remediation &amp; Learning Plans</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Nurses with non-passing or expired competencies, and the learning plans generated for them.
        </p>
      </div>

      {flagged.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-sm font-semibold text-gray-700">No one needs remediation right now</p>
          <p className="text-xs text-gray-400 mt-1">Nurses appear here when a decision is non-passing or a competency expires.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {flagged.map(n => (
            <div key={n.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {n.full_name?.[0] ?? "?"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{n.full_name}</p>
                  <p className="text-[10px] text-gray-400">
                    {n.items.filter(i => i.kind === "remediation").length} needing remediation · {n.items.filter(i => i.kind === "expired").length} expired
                  </p>
                </div>
                <Link href={`/assessor/assess?nurse=${n.id}`}
                  className="text-[11px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                  Reassess →
                </Link>
              </div>
              <div className="px-5 py-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Flagged Competencies</p>
                  <div className="flex flex-col gap-1.5">
                    {n.items.map((i, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          i.kind === "remediation" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
                        }`}>
                          {i.kind === "remediation" ? "Remediation" : "Expired"}
                        </span>
                        <span className="text-xs text-gray-700 truncate flex-1">{i.competency}</span>
                        {i.date && <span className="text-[9px] text-gray-300 shrink-0" suppressHydrationWarning>{new Date(i.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Generated Learning Plan</p>
                  {n.plan.length === 0 ? (
                    <p className="text-[11px] text-gray-400">No pathway items yet — the plan regenerates when decisions are issued.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {n.plan.slice(0, 5).map((p, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${p.status === "completed" ? "bg-green-400" : "bg-indigo-300"}`} />
                          <div className="min-w-0">
                            <p className="text-[11px] text-gray-700 leading-snug truncate">{p.resource_title ?? p.competency_name ?? "Learning item"}</p>
                            {p.reason && <p className="text-[9px] text-gray-400 leading-snug">{p.reason}</p>}
                          </div>
                        </div>
                      ))}
                      {n.plan.length > 5 && <p className="text-[9px] text-gray-400">+{n.plan.length - 5} more items</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-300 mt-5">Mentorship assignments aren&apos;t tracked yet.</p>
    </div>
  );
}
