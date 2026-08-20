"use client";

import { useState } from "react";
import { CLOSE_ACTIONS, DEFER_ACTION } from "@/lib/practice/adoption-constants";

// CPR-ADOPT-001 section 3 - Close My Day.
//
// ⚠ NOTHING HERE IS THE CONTROL. Every action posts to /api/v1/practice/day-close, which gates on
// encounter.edit and refuses a reasonless deferral itself. `canEdit` hides buttons a practitioner cannot
// use; it does not make the ones that remain safe.
//
// ⚠ AND THERE IS NO CLOSE-ALL BUTTON. Section 7 forbids "destructive bulk completion of unresolved clinical
// exceptions". "Finish" ends the session and says what is still open -- it never closes anything.

export type QueueRow = {
  encounterId: string;
  patientName: string | null;
  seenAt: string | null;
  status: string;
  captureMode: string;
  deferredReason: string | null;
};

const card = "bg-white rounded-xl border border-gray-200";

export default function CloseMyDayConsole({ rows, queueFailed, truncated, namesFailed, today, canEdit }: {
  rows: QueueRow[];
  queueFailed: string | null;
  truncated: boolean;
  namesFailed: boolean;
  today: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState(rows);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deferring, setDeferring] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [finished, setFinished] = useState<{ stillOpen: number | null } | null>(null);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/v1/practice/day-close", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? "That could not be completed.");
    return body;
  }

  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    const r = await post({ op: "open", closeDate: today });
    setSessionId(r.id);
    return r.id;
  }

  async function act(encounterId: string, action: string, deferReason?: string) {
    setBusy(encounterId); setError(null);
    try {
      const sid = await ensureSession();
      await post({ op: "action", encounterId, action, sessionId: sid, deferReason: deferReason ?? null });
      setItems(prev => action === DEFER_ACTION
        // A deferral stays on the list. It is not done, and removing it would be the silent completion
        // section 3 forbids.
        ? prev.map(i => i.encounterId === encounterId ? { ...i, deferredReason: deferReason ?? null } : i)
        : prev.filter(i => i.encounterId !== encounterId));
      setDeferring(null); setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be completed.");
    } finally { setBusy(null); }
  }

  async function finish() {
    setBusy("__finish__"); setError(null);
    try {
      const sid = await ensureSession();
      const r = await post({ op: "complete", sessionId: sid });
      setFinished({ stillOpen: r.stillOpen ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The session could not be closed.");
    } finally { setBusy(null); }
  }

  // ⚠ A FAILED READ IS SAID, NOT DRAWN AS AN EMPTY DAY.
  if (queueFailed)
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Close My Day</h1>
        <div className={`${card} p-4 border-[var(--cmp-color-warning)]`}>
          <p className="text-sm font-semibold text-[var(--cmp-text-warning)]">Your list could not be read.</p>
          <p className="text-xs text-gray-500 mt-1">
            This is not an empty day — nothing has been checked. Please try again.
          </p>
          <p className="text-[11px] text-gray-500 mt-2 break-words">{queueFailed}</p>
        </div>
      </div>
    );

  const outstanding = items.length;
  const deferred = items.filter(i => i.deferredReason).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Close My Day</h1>
        <p className="text-sm text-gray-500 mt-0.5">Review and complete what needs your attention.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${card} p-4`}>
          <p className="text-[11px] font-semibold text-gray-500">To complete</p>
          <p className="text-3xl font-bold text-gray-900 tabular-nums mt-1">{outstanding}</p>
          {truncated && (
            <p className="text-[11px] text-[var(--cmp-text-warning)] mt-1">
              Showing the first {outstanding}. There are more than this.
            </p>
          )}
        </div>
        <div className={`${card} p-4`}>
          <p className="text-[11px] font-semibold text-gray-500">Deferred</p>
          <p className="text-3xl font-bold text-gray-900 tabular-nums mt-1">{deferred}</p>
          <p className="text-[11px] text-gray-500 mt-1">Still open, with a reason</p>
        </div>
        <div className={`${card} p-4 flex flex-col justify-between`}>
          <p className="text-[11px] font-semibold text-gray-500">Finish</p>
          <button
            onClick={finish}
            disabled={!canEdit || !!busy || !!finished}
            className="mt-2 text-sm px-3 py-2 rounded-lg bg-gray-900 text-white disabled:opacity-40"
          >
            {busy === "__finish__" ? "Finishing…" : "Finish for today"}
          </button>
          {/* ⚠ SAYS WHAT IS LEFT. Finishing the session closes nothing. */}
          <p className="text-[11px] text-gray-500 mt-2">Ends the session. Anything unresolved stays open.</p>
        </div>
      </div>

      {namesFailed && (
        <div className={`${card} p-3`}>
          <p className="text-xs text-[var(--cmp-text-warning)]">
            Patient names could not be loaded. The list below is complete, but shows encounters without names.
          </p>
        </div>
      )}

      {finished && (
        <div className={`${card} p-4 border-[var(--cmp-color-information)]`}>
          <p className="text-sm font-semibold text-blue-700">Session closed for {today}.</p>
          <p className="text-xs text-gray-500 mt-1">
            {finished.stillOpen === null
              // ⚠ null means the count could not be read. Saying "0" here would send somebody home.
              ? "We could not check how many encounters are still open."
              : finished.stillOpen === 0
                ? "Nothing is left open."
                : `${finished.stillOpen} encounter${finished.stillOpen === 1 ? "" : "s"} still open — they are waiting for you, not lost.`}
          </p>
        </div>
      )}

      {error && (
        <div className={`${card} p-3`}><p className="text-xs text-[var(--cmp-text-error)]">{error}</p></div>
      )}

      <div className={card}>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500 p-6 text-center">Nothing is waiting to be completed.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((i, n) => (
              <li key={i.encounterId} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      <span className="text-gray-500 tabular-nums mr-2">{n + 1}</span>
                      {i.patientName || <span className="text-gray-500 italic">name unavailable</span>}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {/* ⚠ SECTION 7 ON THE SCREEN. A one-tap shell and a consultation somebody worked
                          through must not look the same, because they mean different things about what was
                          reviewed. */}
                      {i.captureMode === "capture_later"
                        ? "Marked seen — nothing reviewed yet"
                        : "Started, not finished"}
                      {i.seenAt && ` · ${new Date(i.seenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                    {i.deferredReason && (
                      <p className="text-[11px] text-[var(--cmp-text-warning)] mt-1">Deferred: {i.deferredReason}</p>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {CLOSE_ACTIONS.filter(a => a.code !== DEFER_ACTION).map(a => (
                      <button
                        key={a.code}
                        onClick={() => act(i.encounterId, a.code)}
                        disabled={!!busy}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                      >
                        {a.label}
                      </button>
                    ))}
                    <button
                      onClick={() => { setDeferring(i.encounterId); setReason(i.deferredReason ?? ""); }}
                      disabled={!!busy}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      Defer
                    </button>
                  </div>
                )}

                {deferring === i.encounterId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Why are you deferring this?"
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 flex-1 min-w-[12rem]"
                    />
                    <button
                      onClick={() => act(i.encounterId, DEFER_ACTION, reason)}
                      // Section 3 allows deferral WITH REASON. The server refuses one without; this stops
                      // the round trip that would only be refused.
                      disabled={!reason.trim() || !!busy}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-40"
                    >
                      Save reason
                    </button>
                    <button onClick={() => { setDeferring(null); setReason(""); }} className="text-xs text-gray-500">
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
