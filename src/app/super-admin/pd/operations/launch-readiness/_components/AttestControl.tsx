"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CPR-IAM-001 §14.1 / CPR-PD-014 §6.4 — recording a human attestation against a launch control.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// !! THIS IS THE CONTROL THE PAGE USED TO SAY WAS IMPOSSIBLE. The ledger has existed since migration
// 340 and nothing wrote to it, because it records `attested_by_capability` and no capability existed to
// name. Migration 344 created `hq.practice.launch.attest`; this is the only surface that uses it.
//
// !! IT IS RENDERED ONLY TO SOMEBODY WHO HOLDS THE CAPABILITY. §13: "do not create placeholder controls
// that do nothing", and a disabled button with a tooltip is still a control that does nothing. Where the
// caller cannot attest, the page says who may — in words, with nothing to click.
//
// !! THE BUILD REFERENCE IS REQUIRED, AND IT IS THE POINT. §6.4 asks WHAT WAS ACTUALLY TESTED. An
// attestation against no named build cannot be audited later, so the engine refuses an empty one and
// this form does not pretend otherwise by defaulting it to something convenient.
//
// !! CHANGING YOUR MIND APPENDS, NEVER EDITS. Migration 340's trigger refuses UPDATE and DELETE, so a
// second attestation on the same control is a new row that supersedes the last. The form says so rather
// than offering an Edit that the database would reject.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function AttestControl({ controlId, controlLabel, alreadyAttested }: {
  controlId: string;
  controlLabel: string;
  /** True when this control already carries a live attestation — the verb becomes "supersede". */
  alreadyAttested: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releaseRef, setReleaseRef] = useState("");
  const [verdict, setVerdict] = useState<"ATTESTED" | "REJECTED" | "SUPERSEDED">("ATTESTED");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [note, setNote] = useState("");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/practice/launch-attestation", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ controlId, verdict, releaseRef, evidenceRef, note }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        // The engine's own sentence, never a summary of it.
        setError(body?.error?.message ?? `that was refused (HTTP ${r.status})`);
        return;
      }
      setOpen(false);
      setReleaseRef(""); setEvidenceRef(""); setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? `the request did not reach the server: ${e.message}` : "the request did not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const FIELD = "w-full rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:border-teal-600 hover:text-teal-700">
        {alreadyAttested ? "Supersede" : "Attest"}
      </button>
    );
  }

  return (
    <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50/70 p-2">
      <p className="text-[11px] font-semibold text-gray-800">
        {alreadyAttested ? "Supersede the attestation for" : "Attest"}: {controlLabel}
      </p>
      {alreadyAttested && (
        <p className="mt-0.5 text-[10.5px] text-gray-600">
          The ledger is append-only, so this adds a new row rather than changing the last one. Both stay
          in the history.
        </p>
      )}

      <div className="mt-1.5 flex flex-col gap-1.5">
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
          What was tested
          <input className={`${FIELD} mt-0.5 font-normal normal-case`} value={releaseRef} disabled={busy}
            onChange={e => setReleaseRef(e.target.value)}
            placeholder="a build, a tag, a commit or an environment" />
        </label>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
          Verdict
          {/* !! WITHDRAW IS THE THIRD VERDICT AND IT IS NOT DECORATION. An attestation recorded in
              error -- against the wrong build, by the wrong person, or to test the mechanism -- cannot
              be deleted, because migration 340's trigger refuses DELETE. Without a way to withdraw it,
              the only options are to leave a false statement standing or to mark the control REJECTED,
              which asserts the test FAILED. Both are lies of a different shape. SUPERSEDED is already
              in the schema CHECK and in ATTESTATION_VERDICTS; it simply had no way in. */}
          <select className={`${FIELD} mt-0.5 font-normal normal-case`} value={verdict} disabled={busy}
            onChange={e => setVerdict(e.target.value as "ATTESTED" | "REJECTED" | "SUPERSEDED")}>
            <option value="ATTESTED">Attested — I performed this and it passed</option>
            <option value="REJECTED">Rejected — I performed this and it failed</option>
            <option value="SUPERSEDED">Withdrawn — the earlier attestation no longer stands</option>
          </select>
        </label>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
          Evidence <span className="font-normal normal-case text-gray-400">(optional)</span>
          <input className={`${FIELD} mt-0.5 font-normal normal-case`} value={evidenceRef} disabled={busy}
            onChange={e => setEvidenceRef(e.target.value)} placeholder="a link, a document, a run id" />
        </label>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
          Note <span className="font-normal normal-case text-gray-400">(optional)</span>
          <input className={`${FIELD} mt-0.5 font-normal normal-case`} value={note} disabled={busy}
            onChange={e => setNote(e.target.value)} placeholder="what a later reader needs to know" />
        </label>
      </div>

      {error && <p role="alert" className="mt-1.5 text-[11px] font-semibold text-[var(--cmp-text-critical)]">{error}</p>}

      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" disabled={busy || releaseRef.trim().length === 0}
          onClick={submit}
          className="rounded-lg bg-teal-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {busy ? "Recording…" : "Record attestation"}
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Cancel
        </button>
        {releaseRef.trim().length === 0 && (
          <span className="text-[10.5px] text-gray-500">Name what was tested first.</span>
        )}
      </div>
    </div>
  );
}
