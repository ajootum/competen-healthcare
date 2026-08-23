"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Correct where a session happened. Used on the running card (StartYourDay) and on Session Complete.
 *
 * ⚠ EXTRACTED THE MOMENT IT WAS NEEDED TWICE, NOT COPIED. The running card grew this dialog first; the
 * second screen is where a copy would have been cheapest and worst. Two dialogs posting the same action
 * drift in exactly the way this repository keeps recording -- one gains a refusal the other does not,
 * one starts preselecting by name, and the day somebody changes the rule they change it once.
 *
 * ⚠ IT POSTS set_location, NEVER plan OR end. Correcting a RUNNING session must not create a second
 * activity or restart the live one: a clinic with patients in it does not survive being reopened to fix
 * a typo. The engine amends in place and records the change as a correction, with wasBlank and
 * correctedAfterEnd on the audit entry so a later reader can tell completing a record from
 * contradicting one.
 *
 * ⚠ IT RENDERS NOTHING WITH NO LOCATIONS TO OFFER. A practice that has configured none has no choice to
 * make, and a control that opens onto an empty list is a dead end wearing a button.
 */
export default function SessionLocation({ activityId, locationId, locationName, locations, canEdit }: {
  activityId: string;
  locationId: string | null;
  locationName: string | null;
  locations: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(locationId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit || locations.length === 0) return null;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/v1/practice/current-activity", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_location", id: activityId, locationId: value }),
      });
      const j = await r.json().catch(() => ({}));
      // The engine's own sentence, not a generic one. It refuses a cancelled session, a location
      // belonging to another practice and an empty value, each with a reason worth reading.
      if (!r.ok) { setError(j.error ?? "That did not work."); setBusy(false); return; }
      setOpen(false); setBusy(false);
      router.refresh();
    } catch {
      setError("That did not reach the server."); setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => { setValue(locationId ?? ""); setOpen(true); }}
        className="min-h-[var(--cp-touch)] text-[11.5px] font-semibold text-[var(--cp-primary-deep)] underline underline-offset-2">
        {locationName ? "Change location" : "Record where this happened"}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Cancel changing the location" onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40" />
          {/* One dialog, two presentations -- bottom sheet where a thumb reaches, compact modal on a
              wide screen. The same shape the start confirmation uses, so the product has one way of
              asking rather than two. */}
          <div role="dialog" aria-modal="true" aria-label="Where did this session happen"
            onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-gray-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] md:inset-0 md:m-auto md:h-fit md:max-w-sm md:rounded-2xl md:border md:p-5 md:pb-5 md:shadow-xl">
            <h3 className="text-[15px] font-bold text-gray-900">Where did this session happen?</h3>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
              This corrects the record for the session and everything filed under it. It is kept as a
              correction, with the date it was made.
            </p>
            <select value={value} onChange={e => setValue(e.target.value)}
              className="mt-3 min-h-[var(--cp-touch)] w-full rounded-lg border border-gray-200 px-2.5 text-[13px] text-gray-800">
              <option value="">Choose where…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {error && <p role="alert" className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}
            <div className="mt-3 flex flex-col gap-1.5">
              <button type="button" disabled={busy || !value || value === locationId} onClick={save}
                className="flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-xl bg-[var(--cp-primary)] px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Saving…" : "Save location"}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                className="flex min-h-[var(--cp-touch)] w-full items-center justify-center rounded-lg text-[13px] font-semibold text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
