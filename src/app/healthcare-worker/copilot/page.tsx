import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyShift } from "@/lib/hww/my-shift";
import { card } from "@/lib/hww/kit";
import AiCopilotPanel from "@/components/AiCopilotPanel";

// AI Copilot (HWW-AI-001) — the bedside advisory assistant, grounded only in
// the nurse's OWN live operational picture. Advisory by design: every HWW
// business rule requires user acknowledgement or override; the copilot never
// diagnoses, prescribes, documents or acts.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyShift(admin, user.id);
  const obsDue = data.observations.filter((o: any) => ["due", "overdue"].includes(o.status)).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Copilot</h1>
        <p className="text-sm text-gray-500 mt-1">Advisory only — grounded in your own live shift data. You acknowledge or override; clinical judgement always prevails.</p>
      </div>

      <AiCopilotPanel
        endpoint="/api/hww/copilot"
        title="Bedside Clinical Copilot"
        sublabel={`Grounded in your live picture: ${data.patients.length} patients · ${data.tasks.length} open tasks · ${obsDue} obs due`}
        prompts={[
          "Who should I see first and why?",
          "What is due or overdue right now?",
          "Summarise each of my patients in one line",
          "What could I be missing this shift?",
          "Draft an SBAR outline for my sickest patient",
        ]}
        placeholder="Ask about your shift, your patients, your priorities…"
      />

      <div className={card}>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">What this copilot will and will not do</p>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-gray-600">
          <p>✓ Prioritise your patients from PEWS, acuity, workload and alerts — with the reasons</p>
          <p>✓ Surface due/overdue observations and medications</p>
          <p>✓ Flag what looks missed and suggest what to chase</p>
          <p>✓ Draft SBAR outlines from your recorded data</p>
          <p className="text-gray-400">✗ Diagnose, prescribe or calculate doses</p>
          <p className="text-gray-400">✗ Document care or write records for you</p>
          <p className="text-gray-400">✗ Act on anything without you</p>
          <p className="text-gray-400">✗ Replace escalation to your supervisor</p>
        </div>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Every question is quota-limited, logged to the platform AI request ledger and auditable. Answers come only from your own operational records — never invented.
      </p>
    </div>
  );
}
