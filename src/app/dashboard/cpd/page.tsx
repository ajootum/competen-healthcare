import { createClient } from "@/lib/supabase/server";
import CPDClient from "./CPDClient";

export default async function CPDPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: logs } = await supabase
    .from("cpd_logs")
    .select("*")
    .eq("user_id", user!.id)
    .order("activity_date", { ascending: false });

  const totalHours = logs?.reduce((sum, l) => sum + Number(l.hours), 0) ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">CPD Log</h1>
        <p className="text-gray-400 text-sm mt-0.5">Track and verify your Continuing Professional Development hours.</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Hours",    value: totalHours.toFixed(1), color: "text-teal-600" },
          { label: "Activities",     value: logs?.length ?? 0,     color: "text-blue-600" },
          { label: "Verified",       value: logs?.filter(l => l.verified).length ?? 0, color: "text-green-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <CPDClient initialLogs={logs ?? []} totalHours={totalHours} />
    </div>
  );
}
