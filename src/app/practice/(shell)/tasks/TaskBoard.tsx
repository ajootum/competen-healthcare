"use client";

import { useState } from "react";
import Link from "next/link";
import {
  TASK_CATEGORIES, TASK_PRIORITIES, TASK_TRANSITIONS, TASK_ACTIONS,
  REASON_REQUIRED_FOR, taskLabelFor,
} from "@/lib/practice/task-constants";

// The board, the raise form, and the in-app feed.
//
// THE BUTTONS ARE THE STATE TABLE, as everywhere else in this product: what renders is
// TASK_TRANSITIONS[status] mapped through TASK_ACTIONS, so an illegal move cannot be drawn.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

const CATEGORY_LABEL = Object.fromEntries(TASK_CATEGORIES) as Record<string, string>;
const ACTION_FOR = Object.fromEntries(Object.entries(TASK_ACTIONS).map(([a, s]) => [s, a]));

export default function TaskBoard({ board, members, notifications, me, canManage }: {
  board: any; members: any[]; notifications: any[]; me: string; canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", detail: "", assignedTo: me, category: "admin", priority: "routine", dueOn: "", remindOn: "",
  });
  const [reasonFor, setReasonFor] = useState<{ id: string; action: string } | null>(null);
  const [reason, setReason] = useState("");
  const [reassignFor, setReassignFor] = useState<string | null>(null);

  async function send(path: string, method: string, payload: unknown) {
    setBusy(true); setNotice(null);
    const res = await fetch(path, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return false;
    }
    window.location.reload();
    return true;
  }

  const memberName = (id: string) =>
    members.find(m => m.userId === id)?.name ?? (id === me ? "You" : "Unnamed member");

  const row = (t: any, opts: { showAssignee?: boolean } = {}) => {
    const active = reasonFor?.id === t.id ? reasonFor : null;
    const needsWords = active !== null && REASON_REQUIRED_FOR.includes(TASK_ACTIONS[active.action] ?? "");
    const targets = (TASK_TRANSITIONS[t.status] ?? []);

    return (
      <li key={t.id} className={`border-b border-gray-100 py-2 last:border-0 ${t.overdue ? "border-l-2 border-l-[var(--cmp-color-critical)] pl-2" : ""}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-gray-900">{t.title}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
            {CATEGORY_LABEL[t.category] ?? t.category}
          </span>
          {t.priority !== "routine" && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              t.priority === "urgent"
                ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>
              {t.priority}
            </span>
          )}
          {t.status === "BLOCKED" && (
            <span className="rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-warning)]">blocked</span>
          )}
          <span className={`ml-auto text-[11px] ${t.overdue ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>
            {t.closed ? `${t.status.toLowerCase()} ${String(t.closed_at ?? "").slice(0, 10)}`
              : t.overdue ? `${Math.abs(t.dueInDays)}d overdue`
                : t.due_on ? `due ${t.due_on}` : "no date"}
          </span>
        </div>

        {t.detail && <p className="mt-0.5 text-[12px] text-gray-600">{t.detail}</p>}
        {t.blocked_reason && <p className="mt-0.5 text-[11px] text-[var(--cmp-text-warning)]">blocked on: {t.blocked_reason}</p>}
        {t.outcome && <p className="mt-0.5 text-[11px] text-gray-500">{t.outcome}</p>}

        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {opts.showAssignee && (
            <span className={`text-[10px] ${t.assigneeInactive ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-400"}`}>
              {t.assigneeInactive ? "assigned to somebody who no longer has access" : memberName(t.assigned_to)}
            </span>
          )}
          {t.patient_id && (
            <Link href={`/practice/patients/${t.patient_id}`} className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {t.patient_name ?? "patient"}
            </Link>
          )}
          {t.follow_up_id && <span className="text-[10px] text-gray-400">linked to a follow-up</span>}
          {t.reminderDue && !t.overdue && <span className="text-[10px] text-gray-400">reminder due</span>}

          {canManage && !t.closed && (
            <span className="ml-auto flex gap-1.5">
              {targets.map(to => {
                const action = ACTION_FOR[to];
                if (!action) return null;
                return (
                  <button key={to} type="button" disabled={busy}
                    onClick={() => {
                      if (REASON_REQUIRED_FOR.includes(to)) { setReason(""); setReasonFor({ id: t.id, action }); return; }
                      send(`/api/v1/practice/tasks/${t.id}`, "PATCH", { action });
                    }}
                    className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    {taskLabelFor(to)}
                  </button>
                );
              })}
              <button type="button" disabled={busy} onClick={() => setReassignFor(reassignFor === t.id ? null : t.id)}
                className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                Hand over
              </button>
            </span>
          )}
        </div>

        {active && (
          <form className="mt-2 flex gap-1.5 rounded-lg bg-gray-50 p-2"
            onSubmit={e => { e.preventDefault(); send(`/api/v1/practice/tasks/${t.id}`, "PATCH", { action: active.action, reason }); }}>
            <input autoFocus required={needsWords} placeholder="What is this blocked on?"
              value={reason} onChange={e => setReason(e.target.value)} className={input} />
            <button type="submit" disabled={busy || (needsWords && !reason.trim())}
              className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              Confirm
            </button>
            <button type="button" onClick={() => setReasonFor(null)}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-white">
              Cancel
            </button>
          </form>
        )}

        {reassignFor === t.id && (
          <div className="mt-2 flex gap-1.5 rounded-lg bg-gray-50 p-2">
            <select aria-label="Hand over to" className={input} defaultValue=""
              onChange={e => e.target.value && send(`/api/v1/practice/tasks/${t.id}`, "PATCH", { assignedTo: e.target.value })}>
              <option value="">Hand over to…</option>
              {members.filter(m => m.userId !== t.assigned_to).map(m => (
                <option key={m.userId} value={m.userId}>{m.name ?? (m.userId === me ? "You" : "Unnamed member")}</option>
              ))}
            </select>
            <button type="button" onClick={() => setReassignFor(null)}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-white">
              Cancel
            </button>
          </div>
        )}
      </li>
    );
  };

  const groups: [string, any[], string, boolean][] = [
    ["Overdue", board.mineOverdue, "Yours, past their date.", false],
    ["Yours", [...board.mineDue, ...board.mineLater], "Assigned to you and still open.", false],
    ["Blocked", board.blocked, "Waiting on something or somebody. Each one says what.", true],
    ["Nobody can see these", board.orphaned, "Assigned to a person whose access has since been removed. Hand them to somebody who is here.", true],
    ["With others", board.others, "Open elsewhere in the practice.", true],
    ["Recently closed", board.recentlyClosed, "The last ten to be settled.", true],
  ];

  const total = board.mineOverdue.length + board.mineDue.length + board.mineLater.length
    + board.blocked.length + board.orphaned.length + board.others.length;

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {/* The in-app feed. Only things that cannot be worked out from the record appear here. */}
      {notifications.length > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--cp-primary-border)] bg-[var(--cp-primary-soft)] p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">New for you</h2>
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{notifications.length}</span>
            <button type="button" disabled={busy} onClick={() => send("/api/v1/practice/notifications", "PATCH", {})}
              className="ml-auto rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              Mark all read
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {notifications.map((n: any) => (
              <li key={n.id} className="text-[12px]">
                <Link href={n.href} className="font-semibold text-gray-900 hover:underline">{n.title}</Link>
                <span className="ml-1.5 text-gray-500">{n.label}</span>
                {n.body && <p className="text-[11px] text-gray-600">{n.body}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-500">
            In-app only. Nothing here was emailed, texted or sent to a patient &mdash; this product has no
            way to do that, and does not pretend otherwise.
          </p>
        </section>
      )}

      {canManage && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <button type="button" onClick={() => setOpen(o => !o)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            {open ? "Cancel" : "Raise a task"}
          </button>
          {open && (
            <form className="mt-3 grid grid-cols-2 gap-2" onSubmit={e => {
              e.preventDefault();
              send("/api/v1/practice/tasks", "POST", {
                ...form, dueOn: form.dueOn || undefined, remindOn: form.remindOn || undefined,
                detail: form.detail || undefined,
              });
            }}>
              <input required placeholder="What needs doing" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={`${input} col-span-2`} />
              <input placeholder="Detail (optional)" value={form.detail}
                onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} className={`${input} col-span-2`} />
              <select aria-label="Assign to" value={form.assignedTo}
                onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} className={input}>
                {members.map(m => (
                  <option key={m.userId} value={m.userId}>{m.name ?? (m.userId === me ? "You" : "Unnamed member")}</option>
                ))}
              </select>
              <select aria-label="Category" value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={input}>
                {TASK_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select aria-label="Priority" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={input}>
                {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="flex items-center gap-2 text-[11px] text-gray-500">
                Due
                <input type="date" value={form.dueOn} onChange={e => setForm(f => ({ ...f, dueOn: e.target.value }))} className={input} />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-gray-500">
                Remind me from
                <input type="date" value={form.remindOn} onChange={e => setForm(f => ({ ...f, remindOn: e.target.value }))} className={input} />
              </label>
              <button type="submit" disabled={busy || !form.title.trim()}
                className="col-span-2 rounded-lg bg-[var(--cp-primary)] py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                Raise
              </button>
              <p className="col-span-2 text-[10px] text-gray-400">
                A reminder date is not a second thing to manage &mdash; it is the day this task starts
                appearing in front of whoever it is assigned to. Nothing is sent to anyone.
              </p>
            </form>
          )}
        </section>
      )}

      {total === 0 && board.recentlyClosed.length === 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-[13px] font-semibold text-gray-700">No tasks.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Raise one for anything operational you do not want to hold in your head.
          </p>
        </section>
      )}

      {groups.map(([title, list, note, showAssignee]) => list.length > 0 && (
        <section key={title} className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <h2 className={`text-[13px] font-bold ${title === "Overdue" || title === "Nobody can see these" ? "text-[var(--cmp-text-critical)]" : "text-gray-900"}`}>{title}</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{list.length}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">{note}</p>
          <ul className="mt-2">{list.map(t => row(t, { showAssignee }))}</ul>
        </section>
      ))}
    </>
  );
}
