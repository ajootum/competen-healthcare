"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Client actions for MDT Coordination (SSW-CCR-005). Every control posts to
// /api/operations/mdt, which re-validates server-side — nothing here is trusted.
/* eslint-disable @typescript-eslint/no-explicit-any */

const btn = "text-[11px] font-medium rounded-lg px-2.5 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${btn} bg-teal-600 border-teal-600 text-white hover:bg-teal-700`;
const ghost = `${btn} bg-white border-gray-200 text-gray-600 hover:bg-gray-50`;

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (method: "POST" | "PATCH", body: any) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/operations/mdt", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Request failed (${res.status})`); return false; }
      router.refresh();
      return true;
    } catch (e: any) { setErr(String(e?.message ?? e)); return false; }
    finally { setBusy(false); }
  };
  return { act, busy, err, setErr };
}

function Err({ err }: { err: string | null }) {
  if (!err) return null;
  return <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>;
}

// ── Meeting lifecycle: start / complete / cancel ──
export function MeetingControls({ meeting }: { meeting: any }) {
  const { act, busy, err } = useAct();
  const [summary, setSummary] = useState("");
  const [showComplete, setShowComplete] = useState(false);

  if (["completed", "cancelled"].includes(meeting.status)) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {meeting.status === "scheduled" && (
          <button className={primary} disabled={busy}
            onClick={() => act("PATCH", { action: "meeting_status", meeting_id: meeting.id, status: "in_progress" })}>
            Start meeting
          </button>
        )}
        {meeting.status === "in_progress" && (
          <button className={primary} disabled={busy} onClick={() => setShowComplete(v => !v)}>Complete</button>
        )}
        <button className={ghost} disabled={busy}
          onClick={() => {
            const reason = window.prompt("Reason for cancelling this meeting?");
            if (reason?.trim()) act("PATCH", { action: "meeting_status", meeting_id: meeting.id, status: "cancelled", cancel_reason: reason });
          }}>
          Cancel
        </button>
      </div>
      {showComplete && (
        <div className="mt-2 flex flex-col gap-1.5">
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2}
            placeholder="Meeting summary (optional)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <div className="flex gap-1.5">
            <button className={primary} disabled={busy}
              onClick={async () => { if (await act("PATCH", { action: "meeting_status", meeting_id: meeting.id, status: "completed", summary })) setShowComplete(false); }}>
              Confirm complete
            </button>
            <button className={ghost} onClick={() => setShowComplete(false)}>Back</button>
          </div>
          <p className="text-[10px] text-gray-400">Completing the meeting marks the referrals it was convened for as reviewed.</p>
        </div>
      )}
      <Err err={err} />
    </div>
  );
}

// ── Attendance: a status ON an invitation, so "did not attend" is recordable ──
const ATTENDANCE = [
  { key: "attended", label: "Attended" },
  { key: "delegated", label: "Delegate" },
  { key: "apologies", label: "Apologies" },
  { key: "absent", label: "Absent" },
];

export function AttendanceRow({ participant }: { participant: any }) {
  const { act, busy, err } = useAct();
  const p = participant;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {ATTENDANCE.map(a => (
          <button key={a.key} disabled={busy || p.attendance === a.key}
            className={`text-[10px] rounded px-1.5 py-0.5 border transition-colors ${
              p.attendance === a.key ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}
            onClick={() => {
              if (a.key === "delegated") {
                const who = window.prompt("Who is attending in their place?");
                if (!who?.trim()) return;
                act("PATCH", { action: "attendance", participant_id: p.id, attendance: "delegated", delegated_to: who });
              } else {
                act("PATCH", { action: "attendance", participant_id: p.id, attendance: a.key });
              }
            }}>
            {a.label}
          </button>
        ))}
        {["attended", "delegated"].includes(p.attendance) && !p.signed_off && (
          <button className={`${ghost} ml-1`} disabled={busy}
            onClick={() => act("PATCH", { action: "sign_off", participant_id: p.id })}>
            Sign off
          </button>
        )}
      </div>
      <Err err={err} />
    </div>
  );
}

// ── Action tracker ──
export function ActionControls({ action }: { action: any }) {
  const { act, busy, err } = useAct();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {action.status === "open" && (
          <button className={ghost} disabled={busy}
            onClick={() => act("PATCH", { action: "action_status", action_id: action.id, status: "in_progress" })}>Start</button>
        )}
        <button className={primary} disabled={busy}
          onClick={() => {
            const note = window.prompt("Outcome (optional)") ?? "";
            act("PATCH", { action: "action_status", action_id: action.id, status: "completed", outcome_note: note });
          }}>Complete</button>
        <button className={ghost} disabled={busy}
          onClick={() => {
            const note = window.prompt("What is blocking this action?");
            if (note?.trim()) act("PATCH", { action: "action_status", action_id: action.id, status: "blocked", outcome_note: note });
          }}>Block</button>
        <button className={ghost} disabled={busy}
          onClick={() => act("PATCH", { action: "action_status", action_id: action.id, status: "escalated" })}>Escalate</button>
      </div>
      <Err err={err} />
    </div>
  );
}

// ── Complex case register: schedule a meeting from a referral, or defer it ──
export function ReferralControls({ referral, meetingTypes }: { referral: any; meetingTypes: readonly { key: string; label: string }[] }) {
  const { act, busy, err } = useAct();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: `MDT review — ${referral.op_patients?.label ?? "patient"}`,
    meeting_type: "complex_case",
    scheduled_at: "",
    location: "",
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={primary} disabled={busy} onClick={() => setOpen(v => !v)}>Schedule MDT</button>
        <button className={ghost} disabled={busy}
          onClick={() => {
            const note = window.prompt("Why is this review being deferred?");
            if (note?.trim()) act("PATCH", { action: "referral_status", referral_id: referral.id, status: "deferred", outcome_note: note });
          }}>Defer</button>
        <button className={ghost} disabled={busy}
          onClick={() => {
            const note = window.prompt("Why is this referral being withdrawn?");
            if (note?.trim()) act("PATCH", { action: "referral_status", referral_id: referral.id, status: "withdrawn", outcome_note: note });
          }}>Withdraw</button>
      </div>
      {open && (
        <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Meeting title"
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 sm:col-span-2" />
          <select value={form.meeting_type} onChange={e => setForm({ ...form, meeting_type: e.target.value })}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
            {meetingTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Location (optional)"
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 sm:col-span-2" />
          <div className="flex gap-1.5 sm:col-span-2">
            <button className={primary} disabled={busy || !form.scheduled_at || !form.title.trim()}
              onClick={async () => {
                const ok = await act("POST", {
                  action: "schedule", referral_id: referral.id, patient_id: referral.patient_id,
                  title: form.title, meeting_type: form.meeting_type,
                  scheduled_at: new Date(form.scheduled_at).toISOString(),
                  location: form.location,
                  participants: (referral.services_requested ?? []).map((s: string) => ({ service: s, required: true })),
                });
                if (ok) setOpen(false);
              }}>
              Schedule
            </button>
            <button className={ghost} onClick={() => setOpen(false)}>Back</button>
          </div>
          {(referral.services_requested ?? []).length > 0 && (
            <p className="text-[10px] text-gray-400 sm:col-span-2">
              The {referral.services_requested.length} service(s) requested on this referral will be invited as required participants.
            </p>
          )}
        </div>
      )}
      <Err err={err} />
    </div>
  );
}

// ── Capture a decision and its actions during/after a meeting ──
export function DecisionCapture({ meetingId, categories }: { meetingId: string; categories: readonly string[] }) {
  const router = useRouter();
  const { act, busy, err, setErr } = useAct();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "care_plan", decision: "", rationale: "", action_text: "", owner_name: "", due_at: "" });

  return (
    <div className="mt-2">
      <button className={ghost} onClick={() => setOpen(v => !v)}>{open ? "Close" : "Capture decision"}</button>
      {open && (
        <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
            {categories.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <input value={form.decision} onChange={e => setForm({ ...form, decision: e.target.value })} placeholder="Decision"
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <textarea value={form.rationale} onChange={e => setForm({ ...form, rationale: e.target.value })} rows={2}
            placeholder="Rationale (optional)" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 sm:col-span-2" />
          <input value={form.action_text} onChange={e => setForm({ ...form, action_text: e.target.value })}
            placeholder="Action arising (optional)" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 sm:col-span-2" />
          <input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} placeholder="Action owner"
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <input type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <div className="sm:col-span-2">
            <button className={primary} disabled={busy || !form.decision.trim()}
              onClick={async () => {
                // The decision is saved first so its id can carry the action arising from it.
                const res = await fetch("/api/operations/mdt", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "decide", meeting_id: meetingId, category: form.category, decision: form.decision, rationale: form.rationale }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) { setErr(j.error ?? `Could not save the decision (${res.status})`); return; }
                if (form.action_text.trim()) {
                  const ok = await act("POST", {
                    action: "assign_action", meeting_id: meetingId, decision_id: j.decision?.id,
                    action_text: form.action_text, owner_name: form.owner_name,
                    due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
                  });
                  if (!ok) return;   // the decision is saved; the error names what the action failed on
                } else {
                  router.refresh();
                }
                setForm({ category: "care_plan", decision: "", rationale: "", action_text: "", owner_name: "", due_at: "" });
                setOpen(false);
              }}>
              Save decision
            </button>
          </div>
          <Err err={err} />
        </div>
      )}
    </div>
  );
}
