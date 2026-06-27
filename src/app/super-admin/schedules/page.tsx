import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ScheduleManager from "./ScheduleManager";

export default async function SchedulesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: schedules } = await admin
    .from("reassessment_schedules")
    .select("*, frameworks(name)")
    .order("cycle_type");

  const { data: frameworks } = await admin.from("frameworks").select("id, name").order("name");

  const CYCLE_COLORS: Record<string, string> = {
    orientation: "bg-blue-100 text-blue-700",
    probation: "bg-amber-100 text-amber-700",
    annual: "bg-teal-100 text-teal-700",
    remediation: "bg-red-100 text-red-700",
    specialty: "bg-violet-100 text-violet-700",
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reassessment Schedules</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure when competencies are reassessed and what triggers a new cycle</p>
        </div>
        <ScheduleManager frameworks={frameworks ?? []} />
      </div>

      <div className="flex flex-col gap-3">
        {(schedules ?? []).map(s => (
          <div key={s.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${CYCLE_COLORS[s.cycle_type ?? "annual"] ?? "bg-gray-100 text-gray-600"}`}>
                  {s.cycle_type ?? "—"}
                </span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{s.name}</p>
                  {(s.frameworks as { name: string } | null)?.name && (
                    <p className="text-[10px] text-gray-400 mt-0.5">Linked to: {(s.frameworks as { name: string }).name}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-700">Every {s.frequency_months} month{s.frequency_months > 1 ? "s" : ""}</p>
                <p className="text-[10px] text-gray-400">{s.grace_period_days}d grace period</p>
              </div>
            </div>
            <div className="flex gap-3 mt-3 pt-3 border-t border-gray-50">
              {s.trigger_on_fail && <span className="text-[10px] bg-red-50 text-red-500 px-2 py-0.5 rounded">Triggers on fail</span>}
              {s.trigger_on_expiry && <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded">Triggers on expiry</span>}
              {s.trigger_on_role_change && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">Triggers on role change</span>}
              {s.auto_create_cycle && <span className="text-[10px] bg-teal-50 text-teal-600 px-2 py-0.5 rounded">Auto-creates cycle</span>}
              {!s.is_active && <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded">Inactive</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
