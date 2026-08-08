"use client";

import { useState } from "react";
import { purgeOfflineDay } from "@/lib/practice/offline-store";

// CP-OFFLINE-SURVEY-001 s3.8.6 — the practice's own off switch, where a practice administrator can reach
// it rather than behind a support ticket.
//
// ⚠ EVERY SENTENCE BELOW IS BOUNDED BY WHAT THIS ACTUALLY DOES.
//
// Switching it off stops any device caching a clinic day, and clears the store on each device the next
// time it loads a Practice page. It CANNOT reach a device that never comes back online -- nothing can,
// and that is why the day expires by itself at the end of the clinic day. The copy says so, in those
// words, because a practice that believes "off" means "wiped everywhere" has been told something untrue
// about where its patients' names are.

export default function OfflineCacheSwitch(
  { workspaceId, enabled, readable, canManage }:
  { workspaceId: string; enabled: boolean; readable: boolean; canManage: boolean },
) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/v1/practice/configuration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { offlineCache: next } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNote(`Not changed: ${body?.error?.message ?? res.status}`);
        return;
      }
      setOn(next);
      // Switching it off clears THIS device immediately rather than waiting for its next Practice page
      // load -- the person throwing the switch is usually sitting at one of the devices in question.
      if (!next) {
        const purged = await purgeOfflineDay(workspaceId);
        setNote(purged.ok
          ? "Off. This device has been cleared. Other devices clear themselves the next time they open Practice; a device that never comes back online keeps nothing beyond the end of the day it cached."
          : `Off for the practice, but this device could not be cleared: ${purged.reason}`);
      } else {
        setNote("On. Devices may hold a copy of the day's list until the end of that clinic day.");
      }
    } catch (e) {
      setNote(`Not changed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Holding today&rsquo;s list on a device</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
        When this is on, a device that has opened Practice keeps a copy of the day&rsquo;s appointment
        list — time, name, one identifier, age and status — so it can still be read without a connection.
        It holds no contact details, no reason for the visit, no allergies, no medicines and no diagnoses.
        The copy is removed at the end of that clinic day whether or not the device reconnects.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
        Turning it off clears the copy from each device the next time that device opens Practice.{" "}
        <b>It cannot reach a device that stays offline</b> — nothing can. That is why the copy expires on
        its own.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={!canManage || !readable || busy} onClick={() => void set(!on)}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
            canManage && readable && !busy
              ? "bg-[var(--cp-primary)] text-white hover:opacity-90"
              : "cursor-not-allowed bg-gray-100 text-gray-400"}`}>
          {busy ? "Saving…" : on ? "Turn off for this practice" : "Turn on for this practice"}
        </button>
        <span className="text-[12px] text-gray-600">
          {/* ⚠ THREE STATES. "off" is a decision; "could not be read" is the absence of one, and showing
              them as the same word would tell a practice its patients' names are not on any device when
              nobody actually checked. */}
          {readable
            ? <>Currently <b>{on ? "on" : "off"}</b></>
            : <>This practice&rsquo;s setting could not be read just now, so it is not shown and cannot be changed here.</>}
          {readable && !canManage && " · changing this needs practice settings permission"}
        </span>
      </div>
      {note && <p className="mt-2 text-[12px] text-gray-700">{note}</p>}
    </section>
  );
}
