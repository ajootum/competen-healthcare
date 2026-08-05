import type { WorkspaceContext } from "@/lib/practice/access";
import { practiceToday } from "@/lib/practice/practice-time";
import { todaysPlan, type TodaysPlan } from "@/lib/practice/activity";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */
// CPR-V3-002 "Today's Work" -- the six panels the specification names, over stores that already exist.
//
// Current Activity · Next Patient · Walk-in Queue · Overdue Follow-ups · Pending Results · Tasks.
//
// FIVE OF THE SIX ARE A LENS, NOT A NEW STORE. The queue, the follow-ups, the incoming documents and the
// tasks have all been recorded for several phases; what V3 adds is putting them where a practitioner
// actually stands, which is in front of a patient rather than in four separate modules. Only Current
// Activity needed a table (migration 232), because "what am I doing right now" was the one thing this
// application genuinely did not know.
//
// EVERY PANEL IS A COUNT AND A LIST, and the count is the length of the list you can open. No panel shows
// a figure it cannot itemise -- a number nobody can drill into is a number nobody can check.
//
// A FAILED READ IS NOT A ZERO. Each panel carries `unavailable`, set when its query errored, so a screen
// can say "could not read this" rather than draw a reassuring nought. A zero has to be earned.

export type WorkItem = {
  id: string;
  title: string;
  detail: string | null;
  /** Rendered as the panel's right-hand marker: a time, a due date, or a priority word. */
  marker: string | null;
  urgent: boolean;
};

export type WorkPanel = {
  key: string;
  label: string;
  count: number | null;
  items: WorkItem[];
  /** Where the full list lives. Every panel's count opens something. */
  href: string;
  unavailable: boolean;
  /** Why it is empty or unreadable, in words a practitioner can act on. */
  note: string | null;
};

export type TodaysWork = {
  plan: TodaysPlan;
  panels: WorkPanel[];
  /** The person the queue says is next. Null when nobody is waiting -- which is not the same as unknown. */
  nextPatient: { name: string; status: string; waitingSinceIso: string } | null;
  nextPatientUnavailable: boolean;
};

const LIMIT = 5;

/** One place to decide "we could not read this", so no caller can mistake an error for an empty list. */
function panel(
  key: string, label: string, href: string,
  res: { data: any[] | null; count: number | null; error: any; denied?: boolean },
  map: (row: any) => WorkItem,
  emptyNote: string,
): WorkPanel {
  if (res.error) {
    return { key, label, count: null, items: [], href, unavailable: true,
      note: "This could not be read just now, so no figure is shown rather than a nought." };
  }
  // ⚠ NOT ALLOWED TO SEE IT IS NOT THE SAME AS THERE BEING NONE. This branch used to return a hard 0 with
  // "Nothing is overdue." beside it -- a reassurance manufactured for somebody who was never permitted to
  // look. An unearned zero is the same defect as a swallowed error wearing better clothes.
  if (res.denied) {
    return { key, label, count: null, items: [], href, unavailable: true,
      note: "You do not have access to this list, so no figure is shown." };
  }
  const items = (res.data ?? []).map(map);
  return {
    key, label, href, unavailable: false,
    count: res.count ?? items.length,
    items,
    note: (res.count ?? items.length) === 0 ? emptyNote : null,
  };
}

export async function todaysWork(admin: any, ctx: WorkspaceContext, opts: { at?: Date } = {}): Promise<TodaysWork> {
  const at = opts.at ?? new Date();
  const plan = await todaysPlan(admin, ctx, { at });
  const today = practiceToday(plan.timezone, at);

  const can = (c: string) => ctx.capabilities.includes(c);

  // ── THE SIX READS ───────────────────────────────────────────────────────────────────────────────
  //
  // Counted with head+count and listed with a small limit, so the count is the TRUE total while the panel
  // shows the first few. Taking `items.length` as the count would silently cap every panel at five and
  // report a thirty-patient queue as five.
  const [queue, followUps, results, tasks] = await Promise.all([
    // ⚠ `appointment.view` DOES NOT EXIST as a capability, so this always took the false branch and the
    // Walk-in Queue and Next Patient reported a confident nought forever. The gate below is the one
    // command-centre.ts and operations-home.ts already use for the same table.
    can("queue.manage") || can("practice.calendar.view")
      ? admin.from("practice_queue_entry")
        .select("id, patient_name, status, entered_at", { count: "exact" })
        .eq("workspace_id", ctx.workspaceId).in("status", ["WAITING", "READY"])
        .order("entered_at", { ascending: true }).limit(LIMIT)
      : Promise.resolve({ data: null, count: null, error: null, denied: true }),

    can("followup.view")
      ? admin.from("practice_follow_up")
        .select("id, reason, kind, due_on, priority", { count: "exact" })
        .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"])
        .lt("due_on", today)
        .order("due_on", { ascending: true }).limit(LIMIT)
      : Promise.resolve({ data: null, count: null, error: null, denied: true }),

    can("inbox.record")
      ? admin.from("practice_incoming_document")
        .select("id, title, doc_type, received_on, priority", { count: "exact" })
        .eq("workspace_id", ctx.workspaceId).eq("status", "RECEIVED")
        .order("received_on", { ascending: true }).limit(LIMIT)
      : Promise.resolve({ data: null, count: null, error: null, denied: true }),

    can("task.view")
      ? admin.from("practice_task")
        .select("id, title, detail, due_on, priority", { count: "exact" })
        .eq("workspace_id", ctx.workspaceId).eq("assigned_to", ctx.userId)
        .in("status", ["OPEN", "IN_PROGRESS", "BLOCKED"])
        .order("due_on", { ascending: true, nullsFirst: false }).limit(LIMIT)
      : Promise.resolve({ data: null, count: null, error: null, denied: true }),
  ]);

  const panels: WorkPanel[] = [
    panel("walk_ins", "Walk-in Queue", "/practice/calendar", queue,
      (r: any) => ({
        id: r.id, title: r.patient_name, detail: r.status === "READY" ? "Ready" : "Waiting",
        marker: null, urgent: r.status === "READY",
      }),
      "Nobody is waiting."),

    // OVERDUE means due_on strictly BEFORE the practice's today. Something due today is due, not overdue,
    // and a panel that called it overdue at one minute past midnight would cry wolf every morning.
    panel("overdue_follow_ups", "Overdue Follow-ups", "/practice/follow-ups", followUps,
      (r: any) => ({
        id: r.id, title: r.reason || r.kind, detail: null,
        marker: r.due_on, urgent: r.priority === "urgent",
      }),
      "Nothing is overdue."),

    panel("pending_results", "Pending Results", "/practice/inbox", results,
      (r: any) => ({
        id: r.id, title: r.title, detail: r.doc_type,
        marker: r.received_on, urgent: r.priority === "urgent",
      }),
      "Nothing is waiting to be reviewed."),

    panel("tasks", "Tasks", "/practice/tasks", tasks,
      (r: any) => ({
        id: r.id, title: r.title, detail: r.detail,
        marker: r.due_on, urgent: r.priority === "urgent" || (!!r.due_on && r.due_on < today),
      }),
      "No tasks assigned to you."),
  ];

  // NEXT PATIENT is the head of the same queue, not a second query with its own idea of the order --
  // two answers to "who is next" is the fastest way to lose trust in both.
  const head = (queue.data ?? [])[0];
  const queueUnreadable = !!queue.error || !!(queue as any).denied;
  return {
    plan,
    panels,
    nextPatient: queueUnreadable || !head
      ? null
      : { name: head.patient_name, status: head.status, waitingSinceIso: head.entered_at },
    // "Nobody is waiting" and "I was not allowed to look" must not render the same way here either.
    nextPatientUnavailable: queueUnreadable,
  };
}
