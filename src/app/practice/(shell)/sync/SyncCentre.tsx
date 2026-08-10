"use client";

import { useCallback, useEffect, useState } from "react";
import {
  outboxNeedingAttention, outboxRecordLabel, outboxRetryByHand, outboxSendOrder, outboxSummary,
  OUTBOX_UNRESOLVED, type OutboxRecord,
} from "@/lib/practice/outbox-model";
import { outboxExport, outboxLoad, outboxSave } from "@/lib/practice/outbox-store";
import {
  CONFLICT_NOTHING_IS_DISCARDED, CONFLICT_RESOLUTIONS, compareConflict, conflictSentence,
  resolutionLabel, validateDecision, type ConflictResolution,
} from "@/lib/practice/conflict-model";

// CP-OFF-UI-001 s7 (Synchronisation Centre) and CP-OFFLINE-SURVEY-001 s5 precondition 5.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS SCREEN IS THE PRECONDITION. Not the model behind it -- the survey's words are "a conflict
// surface that EXISTS", and: "until 'display clear comparison to the user' has a screen, any write whose
// conflict policy is anything other than a deterministic automatic rule is a write with no defined
// outcome."
//
// COMP-CONF-001 s6's four rules, and where each one lives:
//   never silently overwrite clinically significant data  -> every conflict waits for a person
//   preserve both values until resolved                   -> both sides rendered, neither discarded
//   display clear comparison to the user                  -> the table below
//   record all decisions in the audit log                 -> the reason, required, kept on the record
//
// ⚠ IT READS TWO DIFFERENT THINGS AND MUST NEVER CONFLATE THEM. The OUTBOX is on this device and no
// server has ever seen it. The LEDGER is what the practice received. A screen that showed the ledger
// count as "waiting" would tell a practitioner holding fifty unsent notes that everything was fine.
//
// ⚠ AND TODAY IT IS HONESTLY EMPTY. Nothing captures offline yet -- outboxAccept has no callers, by
// design, until all seven preconditions hold. So this renders "nothing waiting", which is TRUE, and it
// says why rather than looking like a feature that does not work.

type Ledger = {
  state: "ok" | "absent" | "failed";
  detail: string | null;
  lastReceivedAt: string | null;
  applied: number; refused: number; conflicts: number;
  needsAttention: { id: string; entityType: string; operation: string; status: string; errorMessage: string | null; receivedAt: string }[];
  syncableEntityTypes: string[];
};

const card = "rounded-xl border border-gray-200 bg-white p-4";

export default function SyncCentre() {
  const [records, setRecords] = useState<OutboxRecord[] | null>(null);
  const [outboxDetail, setOutboxDetail] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [choice, setChoice] = useState<ConflictResolution | "">("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reread = useCallback(async () => {
    const loaded = await outboxLoad();
    setRecords(loaded.records);
    setOutboxDetail(loaded.detail);
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void reread(); });
    // The ledger is the practice's side. A failure here must not blank the device's side, which is the
    // half that holds the only copy of anything.
    fetch("/api/v1/practice/sync/status", { cache: "no-store" })
      .then(r => r.json()).then(setLedger)
      .catch(() => setLedger(null));
  }, [reread]);

  const now = new Date();
  const summary = records ? outboxSummary(records, now) : null;
  const attention = records ? outboxNeedingAttention(records, now) : [];
  const waiting = records ? outboxSendOrder(records).filter(r => OUTBOX_UNRESOLVED.includes(r.state)) : [];

  async function settle(record: OutboxRecord) {
    const check = validateDecision({ resolution: choice, reason });
    if (!check.ok) { setProblem(check.message); return; }
    setBusy(true); setProblem(null);
    // ⚠ THE DECISION IS RECORDED ON THE RECORD BEFORE ANYTHING IS RESENT, and the previous values stay
    // beside it. If the resend never happens, what the practitioner decided is still here.
    const decided: OutboxRecord = {
      ...record,
      conflict: record.conflict
        ? { ...record.conflict, decision: { resolution: choice, reason: reason.trim(), decidedAt: new Date().toISOString() } }
        : record.conflict,
      // "Use what I recorded" puts it back in the queue to be sent again. The other two settle it here.
      ...(choice === "keep_mine" ? outboxRetryByHand(record) : {}),
    };
    const saved = await outboxSave(decided);
    setBusy(false);
    if (!saved.ok) { setProblem(saved.reason ?? "That could not be saved on this device."); return; }
    setOpenId(null); setChoice(""); setReason("");
    void reread();
  }

  async function download() {
    const bundle = await outboxExport();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `competen-unsent-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Synchronisation</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What this device is holding, what has reached the practice, and anything that needs you.
      </p>

      {problem && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {problem}
        </p>
      )}

      {/* ── ON THIS DEVICE ───────────────────────────────────────────────────────────────────────── */}
      <section className={`${card} mt-4`}>
        <h2 className="text-[13px] font-bold text-gray-900">On this device</h2>
        {records === null ? (
          <p className="mt-1 text-[12px] text-gray-500">Reading what is stored on this device…</p>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] leading-relaxed text-gray-800">{summary?.sentence}</p>
            {/* ⚠ A store that could not be read is NOT an empty store. */}
            {outboxDetail && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                {outboxDetail}
              </p>
            )}
            {summary && summary.unresolved === 0 && summary.needsAttention === 0 && !outboxDetail && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                Recording while offline is not switched on yet, so nothing has been captured on this
                device to send. This screen is where it will appear when it is.
              </p>
            )}

            {waiting.length > 0 && (
              <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {waiting.map(r => {
                  const label = outboxRecordLabel(r);
                  return (
                    <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                      <span className="text-[12.5px] font-semibold text-gray-900">{r.entityType}</span>
                      <span className="text-[11.5px] text-gray-500">{r.operation}</span>
                      <span className="ml-auto text-[11.5px] text-gray-700">{label.label}</span>
                      {label.detail && <span className="w-full text-[11px] text-gray-500">{label.detail}</span>}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* ⚠ DISABLED WITH A REASON, NOT HIDDEN. CP-OFF-UI-001 s7 asks for a manual Sync Now, and
                  there is genuinely nothing to send until capture ships. Offering a working button that
                  did nothing would teach the practitioner that syncing is unreliable. */}
              <button type="button" disabled
                className="cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-[12px] font-semibold text-gray-400">
                Sync now
              </button>
              <span className="text-[11px] text-gray-500">
                There is nothing on this device waiting to be sent.
              </span>
              {/* ⚠ The offline view lives outside the shell so it renders with no connection, which is
                  also why nothing linked to it. This screen is about this device; it is the right door. */}
              {/* ⚠ A PLAIN <a>, NOT next/link, AND ESLINT IS OVERRULED ON PURPOSE. A Link does a
                  client-side navigation: it fetches an RSC payload, which is exactly what is NOT
                  available when the network is down -- the moment this destination matters most. A full
                  document navigation is what the service worker can answer from cache. OfflineReader
                  already carries prefetch={false} on its link back, for the same family of reason. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/practice/offline"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                See what is held on this device
              </a>
              <button type="button" onClick={download}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Export what has not been sent
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── NEEDS YOU ────────────────────────────────────────────────────────────────────────────── */}
      {attention.length > 0 && (
        <section className={`${card} mt-4 border-amber-300`}>
          <h2 className="text-[13px] font-bold text-gray-900">Needs you</h2>
          <p className="mt-0.5 text-[11.5px] text-gray-600">{CONFLICT_NOTHING_IS_DISCARDED}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {attention.map(r => {
              const label = outboxRecordLabel(r);
              const fields = r.conflict
                ? compareConflict({
                    mine: (r.payload ?? {}) as Record<string, unknown>,
                    theirs: r.conflict.theirs,
                    labels: r.conflict.labels,
                    insignificant: r.conflict.insignificant,
                  })
                : [];
              const open = openId === r.id;
              return (
                <li key={r.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-[12.5px] font-semibold text-gray-900">{r.entityType}</span>
                    <span className="text-[11.5px] text-gray-500">{r.operation}</span>
                    <span className="ml-auto text-[11.5px] font-semibold text-amber-900">{label.label}</span>
                  </div>
                  {r.state === "conflicted" ? (
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{conflictSentence(fields)}</p>
                  ) : (
                    label.detail && <p className="mt-1 text-[12px] leading-relaxed text-gray-700">{label.detail}</p>
                  )}

                  {/* ⚠ THE COMPARISON. Both sides, side by side, with the clinical ones marked. */}
                  {fields.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[32rem] text-[12px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                            <th className="py-1 pr-3 font-semibold">Field</th>
                            <th className="py-1 pr-3 font-semibold">You recorded</th>
                            <th className="py-1 font-semibold">The practice has</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map(f => (
                            <tr key={f.field} className="border-t border-gray-100 align-top">
                              <td className="py-1.5 pr-3 text-gray-700">
                                {f.label}
                                {f.significant && (
                                  <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9.5px] font-bold text-amber-900">
                                    clinical
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 pr-3 font-medium text-gray-900">{render(f.mine)}</td>
                              <td className="py-1.5 text-gray-900">{render(f.theirs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {r.conflict?.decision ? (
                    <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] leading-relaxed text-gray-700">
                      Settled as <strong>{resolutionLabel(r.conflict.decision.resolution as ConflictResolution).label}</strong>
                      {" — "}&ldquo;{r.conflict.decision.reason}&rdquo;
                    </p>
                  ) : r.state === "conflicted" ? (
                    open ? (
                      <div className="mt-2 flex flex-col gap-2">
                        {CONFLICT_RESOLUTIONS.map(res => {
                          const rl = resolutionLabel(res);
                          return (
                            <label key={res} className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                              <input type="radio" name={`res-${r.id}`} value={res} checked={choice === res}
                                onChange={() => setChoice(res)} className="mt-0.5" />
                              <span>
                                <span className="block text-[12px] font-semibold text-gray-900">{rl.label}</span>
                                <span className="block text-[11px] leading-relaxed text-gray-600">{rl.detail}</span>
                              </span>
                            </label>
                          );
                        })}
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-gray-600">
                            Why you settled it this way (required)
                          </span>
                          <input value={reason} onChange={e => setReason(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)]" />
                        </label>
                        <span className="flex gap-2">
                          <button type="button" disabled={busy} onClick={() => settle(r)}
                            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                            Record this decision
                          </button>
                          <button type="button" onClick={() => { setOpenId(null); setChoice(""); setReason(""); }}
                            className="text-[12px] text-gray-500 hover:underline">Cancel</button>
                        </span>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setOpenId(r.id); setChoice(""); setReason(""); }}
                        className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                        Settle this
                      </button>
                    )
                  ) : (
                    <button type="button" disabled={busy}
                      onClick={async () => { await outboxSave(outboxRetryByHand(r)); void reread(); }}
                      className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                      Try this again
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── WHAT THE PRACTICE RECEIVED ───────────────────────────────────────────────────────────── */}
      <section className={`${card} mt-4`}>
        <h2 className="text-[13px] font-bold text-gray-900">What the practice has received</h2>
        {ledger === null ? (
          <p className="mt-1 text-[12px] text-gray-500">
            The practice could not be reached, so what it has received is not shown. This is not a claim
            that nothing arrived.
          </p>
        ) : ledger.state !== "ok" ? (
          <p className="mt-1 text-[12px] text-gray-600">{ledger.detail}</p>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] text-gray-800">
              {ledger.applied} filed · {ledger.conflicts} needing a decision · {ledger.refused} refused
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {ledger.lastReceivedAt
                ? `Last received ${new Date(ledger.lastReceivedAt).toLocaleString()}.`
                : "Nothing has ever been received from a device."}
            </p>
            {ledger.syncableEntityTypes.length === 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                No kind of record can be filed from a device yet. That arrives with offline recording,
                one kind at a time.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** ⚠ `null` renders as a word, not as an empty cell. An empty cell reads as "no disagreement here". */
function render(v: unknown): string {
  if (v === null || v === undefined) return "— not recorded —";
  if (typeof v === "string") return v.trim() === "" ? "— blank —" : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
