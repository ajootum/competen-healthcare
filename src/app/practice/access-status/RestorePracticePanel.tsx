"use client";

import { useState } from "react";
import { REASON_MIN, REASON_MAX } from "@/lib/practice/lifecycle-constants";

// CPR-LIFE-001 s3: "Administrators may restore Archived or Suspended practices."
//
// ⚠ THIS PANEL EXISTS BECAUSE THE LIFECYCLE PAGE CANNOT BE REACHED FROM AN ARCHIVED PRACTICE.
//
// resolveWorkspaceContext refuses any workspace whose status is not ACTIVE, ONBOARDING or PROVISIONING,
// and the (shell) layout redirects that refusal here. So the screen that offers Restore is itself behind
// the door archiving closes, and without this panel "fully recoverable" would be true of the data and
// false of the product: the person who archived their practice could not un-archive it.
//
// It grants nothing. The same practice.restore capability decides it, resolved from the same membership
// and the same time-bounded grants, and the engine refuses a caller who does not hold it exactly as it
// would on the lifecycle page.

type Props = { workspaceId: string; workspaceName: string; status: string };

export default function RestorePracticePanel({ workspaceId, workspaceName, status }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/practice/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore", reason, workspaceId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error?.message ?? `That did not work (${res.status}).`); return; }
      window.location.href = "/practice/home";
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
      <p className="text-[13px] font-bold text-gray-900">You can restore {workspaceName}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
        It is {status.toLowerCase()}. Nothing has been removed. Restoring it returns the practice to
        normal operation and it starts taking bookings again.
      </p>
      <label htmlFor="restore-reason" className="mt-3 block text-[12px] font-semibold text-gray-800">
        Why? (required, at least {REASON_MIN} characters)
      </label>
      <textarea id="restore-reason" rows={3} value={reason} maxLength={REASON_MAX}
        onChange={e => setReason(e.target.value)}
        placeholder="This is kept for good and cannot be edited afterwards."
        className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[12.5px]" />
      {error && <p className="mt-2 text-[12px] font-semibold text-rose-700">{error}</p>}
      <button type="button" disabled={busy || reason.trim().length < REASON_MIN} onClick={restore}
        className="mt-2 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
        {busy ? "Working…" : "Restore this practice"}
      </button>
    </div>
  );
}
