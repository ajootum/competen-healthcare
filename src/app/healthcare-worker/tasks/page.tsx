import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyTaskCentre } from "@/lib/hww/tasks";
import { titleCase, fmtTime, fmtWhen, PrioChip, StatCard, SectionCard, Empty, Chip } from "@/lib/hww/kit";
import TaskActions from "./TaskActions";

// Task Centre (HWW-WARD-001 S4.7 / HWW-TSK-001) — the nurse's own task lens
// over op_tasks: open work by state, priority-ranked with due times, one-tap
// lifecycle transitions (the existing nurse-permitted API), and today's
// completed list. Tasks arrive from supervisors, ward-round actions (152),
// care routines and task templates.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, string> = {
  created: "bg-gray-100 text-gray-500", assigned: "bg-[var(--cmp-surface-information)] text-blue-700", accepted: "bg-indigo-100 text-indigo-700",
  in_progress: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", completed: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", verified: "bg-[var(--cmp-surface-success)] text-emerald-700",
};

export default async function TaskCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();

  const { open, done, overdue, urgent, wardRound } = await loadMyTaskCentre(admin, user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Task Centre</h1>
        <p className="text-sm text-gray-500 mt-1">Your live task list — accept, start and complete; verification stays with your coordinator.</p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="✅" title="Open Tasks" value={open.length} sub={`${wardRound} from ward-round actions`} />
        <StatCard icon="🔴" title="Urgent" value={urgent} tone={urgent > 0 ? "text-[var(--cmp-text-critical)]" : undefined} sub="priority urgent" />
        <StatCard icon="⏰" title="Past Due" value={overdue} tone={overdue > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="due time elapsed" />
        <StatCard icon="🏁" title="Completed (24h)" value={done.length} sub="by you" />
      </div>

      <SectionCard icon="📋" title="My Open Tasks" count={open.length}>
        {open.length === 0 ? (
          <Empty>Nothing open. Tasks arrive from your supervisor, ward-round decisions, care plans and ward routines.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {open.map((t: any) => (
              <div key={t.id} className="py-2.5 flex items-start gap-3">
                <span className={`text-xs tabular-nums w-12 shrink-0 mt-0.5 ${t.past_due ? "text-[var(--cmp-text-critical)] font-semibold" : "text-gray-500"}`}>{t.due_at ? fmtTime(t.due_at) : "--:--"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 leading-tight">{t.description}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {t.op_patients?.label ? `${t.op_patients.label} · ` : ""}{t.task_type ? `${titleCase(t.task_type)} · ` : ""}assigned {fmtWhen(t.created_at)}
                  </p>
                </div>
                {t.task_type === "ward_round_action" && <Chip tone="bg-indigo-100 text-indigo-700">Ward round</Chip>}
                <Chip tone={STATE_TONE[t.status] ?? STATE_TONE.created}>{titleCase(t.status)}</Chip>
                <PrioChip p={t.priority} />
                <TaskActions id={t.id} status={t.status} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard icon="🏁" title="Completed Today" count={done.length}>
        {done.length === 0 ? <Empty>No completions in the last 24 hours yet.</Empty> : (
          <div className="divide-y divide-gray-50">
            {done.map((t: any) => (
              <div key={t.id} className="py-2 flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-400 tabular-nums w-12">{fmtTime(t.completed_at)}</span>
                <span className="text-gray-600 flex-1 min-w-0 truncate">{t.description}</span>
                <span className="text-xs text-gray-400">{t.op_patients?.label ?? ""}</span>
                <Chip tone={STATE_TONE[t.status]}>{titleCase(t.status)}</Chip>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Completing a task records the operational event; coordinator verification (separation of duties) happens in the supervisor workspace.
      </p>
    </div>
  );
}
