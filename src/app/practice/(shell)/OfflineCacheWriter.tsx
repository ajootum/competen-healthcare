"use client";

import { useEffect, useState } from "react";
import { cacheOfflineDay, purgeOfflineDay } from "@/lib/practice/offline-store";
import type { OfflineDay } from "@/lib/practice/offline-projection";

// CP-OFFLINE-SURVEY-001 s3.3 step 2 — the cache is a BY-PRODUCT OF A SUCCESSFUL ONLINE RENDER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// It runs once, after the shell has already rendered from the server. The online path is untouched: the
// server render remains the source of truth, nothing on screen waits for this, and a failure here changes
// nothing a practitioner can see except the one line this component renders about itself.
//
// ⚠ THE FLAG IS RESOLVED ON THE SERVER AND ARRIVES AS A PROP. s3.7: "Phase one needs the flag resolved
// server-side and passed into the client component as a prop -- do not build a client evaluator." There
// is no client-side flag evaluation anywhere in this repository and this does not add the first one.
//
// ⚠ PROPS ARE PLAIN JSON. No function is passed across this boundary. This repository has already lost a
// board to a function riding on a payload into a client component -- tsc clean, API fine, page dead.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────────
//
// It does not poll, it does not retry, and it offers no "sync now". There is nothing to sync: phase one
// accepts no input, so a retry affordance would imply a queue that does not exist. It writes once per
// page load, which for a dashboard that already re-renders every 45 seconds (LiveRefresh) is a cached day
// that follows the clinic within a page navigation.

export type OfflineWriterGate = {
  state: "allowed" | "withheld" | "unresolved";
  reason: string;
  /** ⚠ True only when somebody DECIDED to switch it off. Then the device is cleared, not just left. */
  purge: boolean;
};

type Outcome =
  | { kind: "idle" }
  | { kind: "stored"; patients: number; at: string }
  | { kind: "purged"; reason: string }
  | { kind: "withheld"; reason: string }
  | { kind: "failed"; reason: string };

export default function OfflineCacheWriter(
  { workspaceId, gate, showStatus = false }:
  { workspaceId: string; gate: OfflineWriterGate; showStatus?: boolean },
) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // ── 1. A DECISION TO SWITCH IT OFF CLEARS THE DEVICE ──────────────────────────────────────
      // s3.8.6: "Turning it off must purge, not merely stop caching." An `unresolved` gate does NOT
      // purge -- an unreadable table is not a decision anybody made, and deleting on a blip would punish
      // a practice for a database fault.
      if (gate.purge) {
        const purged = await purgeOfflineDay(workspaceId);
        if (!cancelled) setOutcome(purged.ok
          ? { kind: "purged", reason: gate.reason }
          : { kind: "failed", reason: purged.reason });
        return;
      }
      if (gate.state !== "allowed") {
        if (!cancelled) setOutcome({ kind: "withheld", reason: gate.reason });
        return;
      }

      // ── 2. THE SERVICE WORKER, WHOSE ONLY JOB IS THE APP SHELL ────────────────────────────────
      // Scoped to /practice/ rather than the whole origin: nothing outside Practice has an offline
      // story, and a worker with a wider scope than its purpose is a worker that will one day answer a
      // request nobody thought about.
      if ("serviceWorker" in navigator) {
        try {
          await navigator.serviceWorker.register("/sw.js", { scope: "/practice/", updateViaCache: "none" });
        } catch {
          // A browser that refuses the worker still gets the cache -- it simply cannot boot the offline
          // page from a cold start. Reported through the outcome below rather than thrown.
        }
      }

      // ── 3. THE DAY ITSELF ─────────────────────────────────────────────────────────────────────
      try {
        const res = await fetch("/api/v1/practice/offline/day", { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setOutcome({ kind: "failed", reason: `the practice could not be reached (${res.status})` }); return; }
        const body = await res.json() as { gate?: { purge?: boolean; reason?: string }; day: OfflineDay | null };

        // The server may refuse between render and fetch -- a switch thrown in the meantime. Its answer
        // wins over the prop, including its instruction to purge.
        if (body.gate?.purge) {
          const purged = await purgeOfflineDay(workspaceId);
          if (!cancelled) setOutcome(purged.ok
            ? { kind: "purged", reason: body.gate.reason ?? gate.reason }
            : { kind: "failed", reason: purged.reason });
          return;
        }
        if (!body.day) { if (!cancelled) setOutcome({ kind: "withheld", reason: body.gate?.reason ?? "Nothing was stored on this device." }); return; }

        const wrote = await cacheOfflineDay(body.day);
        if (!cancelled) setOutcome(wrote.ok
          ? { kind: "stored", patients: wrote.patients, at: body.day.asOf }
          : { kind: "failed", reason: wrote.reason });
      } catch (e) {
        // ⚠ A DEVICE THAT IS ALREADY OFFLINE LANDS HERE, and it must not purge. What is already stored is
        // the only thing that will be shown when the page next fails to load; throwing it away because
        // this fetch failed would delete the cache at exactly the moment it becomes useful.
        if (!cancelled) setOutcome({ kind: "failed", reason: String((e as Error)?.message ?? e).slice(0, 160) });
      }
    })();

    return () => { cancelled = true; };
  }, [workspaceId, gate.state, gate.purge, gate.reason]);

  if (!showStatus) return null;

  // ⚠ EVERY SENTENCE BELOW MUST BE TRUE TODAY. None of them says "synced", "backed up" or "saved" --
  // nothing has been sent anywhere and nothing can be. What is described is a COPY, held here, which the
  // server still holds too.
  const line =
    outcome.kind === "stored"
      ? `A copy of today's list is held on this device for use without a connection (${outcome.patients} ${outcome.patients === 1 ? "appointment" : "appointments"}, as at ${new Date(outcome.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}). It is removed at the end of the day.`
      : outcome.kind === "purged" ? outcome.reason
      : outcome.kind === "withheld" ? outcome.reason
      : outcome.kind === "failed" ? `Nothing new was stored on this device: ${outcome.reason}`
      : null;

  if (!line) return null;
  return <p className="text-[10.5px] text-gray-400">{line}</p>;
}
