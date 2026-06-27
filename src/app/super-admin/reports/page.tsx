import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const TYPE_COLORS: Record<string, string> = {
  competency_summary:  "bg-teal-50 text-teal-700",
  workforce_analysis:  "bg-blue-50 text-blue-700",
  cycle_completion:    "bg-indigo-50 text-indigo-700",
  domain_scores:       "bg-violet-50 text-violet-700",
  framework_scores:    "bg-purple-50 text-purple-700",
  policy_compliance:   "bg-amber-50 text-amber-700",
  assessor_activity:   "bg-orange-50 text-orange-700",
  educator_validation: "bg-rose-50 text-rose-700",
};

type Column = { key: string; label: string; type: string };

export default async function ReportTemplatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: templates } = await admin
    .from("report_templates")
    .select("id, name, description, report_type, columns, is_global, is_active, hospitals(name)")
    .order("report_type");

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Report Templates</h1>
          <p className="text-gray-400 text-sm mt-0.5">{(templates ?? []).length} templates — define what columns, filters, and groupings each report includes</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {(templates ?? []).map(t => {
          const cols = (t.columns as Column[]) ?? [];
          const color = TYPE_COLORS[t.report_type] ?? "bg-gray-100 text-gray-500";
          return (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{t.name}</p>
                    {t.is_global && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Global</span>}
                  </div>
                  {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${color}`}>
                  {t.report_type.replace(/_/g, " ")}
                </span>
              </div>
              <div className="px-5 py-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {cols.map((col, i) => (
                    <span key={i} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {col.label} <span className="text-gray-300">({col.type})</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
