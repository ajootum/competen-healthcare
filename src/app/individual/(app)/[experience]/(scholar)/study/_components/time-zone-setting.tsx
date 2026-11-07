"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReaderClock } from "@/lib/datetime";
import { focusRing } from "../../../../../_components/chrome";

// LOCAL-TIME-ZONES: the learner's own override. Shown only while policy scholar_reader_time_zone is on.
// A choice goes through the one preference door (/api/personalisation/preferences), which audits it. Using this device
// clears the choice, so a learner who travels follows their device again.

const API = "/api/personalisation/preferences";
const readable = (zone: string) => zone.replace(/_/g, " ");

const WHY: Record<ReaderClock["source"], string> = {
  choice: "you chose this",
  device: "from this device",
  network: "estimated from your connection",
  default: "the standard zone, because this device has not reported one",
};

export function TimeZoneSetting({ clock, label, zones }: { clock: ReaderClock; label: string; zones: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = clock.source === "choice" ? clock.zone : "";
  // A chosen zone this list does not hold still has to show as selected.
  const options = chosen && !zones.includes(chosen) ? [chosen, ...zones] : zones;

  async function save(zone: string) {
    setBusy(true); setError("");
    const res = await (zone
      ? fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { timezone: zone } }) })
      : fetch(API, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "timezone" }) })
    ).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setError(json.error ?? "Your time zone could not be saved. Nothing has changed."); return; }
    router.refresh();
  }

  return (
    <section id="time-zone" aria-labelledby="time-zone-h" data-testid="time-zone-setting" data-source={clock.source} className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="time-zone-h" className="text-[16px] font-bold text-gray-900">Time zone</h2>
      <p className="mt-1.5 text-[14.5px] text-gray-700" data-testid="time-zone-line">
        Times in Scholar show in <span className="font-semibold">{readable(clock.zone)} ({label})</span>, {WHY[clock.source]}.
      </p>
      <label htmlFor="time-zone-select" className="mt-3 block text-[13.5px] font-semibold text-gray-900">Show times in</label>
      <select
        id="time-zone-select" value={chosen} disabled={busy} onChange={e => save(e.target.value)}
        className={`mt-1 min-h-[40px] w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 text-[14px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}
      >
        <option value="">This device&apos;s time zone (recommended)</option>
        {options.map(z => <option key={z} value={z}>{readable(z)}</option>)}
      </select>
      <p className="mt-2 text-[13px] text-gray-600">This changes how times are shown. Your study days, your streak and what is stored stay as they are.</p>
      <p role="status" aria-live="polite" className="mt-1 text-[13px] font-semibold text-red-700">{error}</p>
    </section>
  );
}
