import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import WorkflowManager from "./WorkflowManager";

const TRIGGER_LABELS: Record<string, { label: string; color: string }> = {
  assessment_complete:    { label: "Assessment Complete",   color: "bg-teal-50 text-teal-700" },
  cycle_end:              { label: "Cycle End",             color: "bg-blue-50 text-blue-700" },
  score_below_threshold:  { label: "Score Below Threshold", color: "bg-red-50 text-red-600" },
  expiry_approaching:     { label: "Expiry Approaching",    color: "bg-amber-50 text-amber-700" },
  validation_required:    { label: "Validation Required",   color: "bg-violet-50 text-violet-700" },
  policy_review_due:      { label: "Policy Review Due",     color: "bg-indigo-50 text-indigo-700" },
};

type Step = { order: number; role: string; action: string; notify?: boolean; deadline_days?: number };

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: workflows } = await admin
    .from("workflow_templates")
    .select("id, name, description, trigger_type, steps, is_active, hospitals(name)")
    .order("trigger_type");

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workflow Templates</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure approval chains, validation steps, and notification rules</p>
        </div>
        <WorkflowManager />
      </div>

      <div className="flex flex-col gap-4">
        {(workflows ?? []).map(wf => {
          const trigger = TRIGGER_LABELS[wf.trigger_type] ?? { label: wf.trigger_type, color: "bg-gray-100 text-gray-500" };
          const steps = (wf.steps as Step[]) ?? [];
          return (
            <div key={wf.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{wf.name}</p>
                    {wf.description && <p className="text-xs text-gray-400 mt-0.5">{wf.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {(wf.hospitals as unknown as { name: string } | null)?.name && (
                      <span className="text-[10px] text-gray-400">🏥 {(wf.hospitals as unknown as { name: string }).name}</span>
                    )}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${trigger.color}`}>{trigger.label}</span>
                  </div>
                </div>
              </div>
              {steps.length > 0 && (
                <div className="px-5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {steps.sort((a, b) => a.order - b.order).map((step, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-gray-200 text-sm">→</span>}
                        <div className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 text-center">
                          <p className="text-[10px] font-semibold text-gray-700 capitalize">{step.role}</p>
                          <p className="text-[9px] text-gray-400 capitalize">{step.action}</p>
                          {step.deadline_days && <p className="text-[9px] text-teal-500">{step.deadline_days}d deadline</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!(workflows ?? []).length && (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-2xl mb-2">⚡</p>
            <p className="text-gray-400 text-sm">No workflow templates yet — click &quot;+ Add Workflow&quot; to create one</p>
          </div>
        )}
      </div>
    </div>
  );
}
