import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadReminderStatus } from "@/lib/delivery/reminders";
import ReminderRunner from "./ReminderRunner";

// CDP-011 — Scheduled reminders (operator view). Proactive expiry reminders + a scan control. The daily
// learning_reminders cron runs it automatically; learners see the reminders in-app. Real over cdp_reminders
// (145) + professional_credentials + competency_decisions. Super-admin, platform-wide.

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { credential_expiry: "Credential", competency_expiry: "Competency" };

export default async function RemindersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadReminderStatus(admin, null, true);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-011 · Notifications & Engagement</p>
          <h1 className="text-xl font-bold text-gray-900">Scheduled Reminders</h1>
          <p className="text-gray-400 text-sm mt-0.5">Proactive nudges before credentials and competencies expire — once per milestone, straight to the learner.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">Reminders aren&apos;t provisioned — apply migration 145 (<code className="text-[11px]">cdp_reminders</code>).</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Reminders sent", value: q.kpis.sent, tone: "text-gray-900" },
              { label: "Credential", value: q.kpis.credential, tone: "text-gray-900" },
              { label: "Competency", value: q.kpis.competency, tone: "text-gray-900" },
              { label: "Due in 30 days", value: q.kpis.upcoming, tone: "text-violet-600" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-gray-900 text-sm">Run reminder scan</h2>
                <p className="text-[11px] text-gray-400">Finds credentials & competencies expiring within 30 days (or already expired) and sends each learner a reminder — once per due milestone. Runs daily via the <code className="text-[10px]">learning_reminders</code> cron.</p>
              </div>
              <ReminderRunner upcoming={q.kpis.upcoming} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">Recent reminders</p></div>
            {q.recent.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-8 text-center">No reminders sent yet. Run a scan to nudge learners with approaching expiries.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.recent.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0 w-24 text-center">{KIND_LABEL[r.kind] ?? r.kind}</span>
                    <span className="text-sm text-gray-800 truncate flex-1">{r.subject_label ?? "—"}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">due {r.due_date ?? "—"}</span>
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
