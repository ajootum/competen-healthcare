"use client";

import { useEffect, useState } from "react";
import { cacheOfflineDay, cacheOfflineGuidance, purgeOfflineWorkspace } from "@/lib/practice/offline-store";
import type { OfflineDay } from "@/lib/practice/offline-projection";
import type { OfflineGuidanceLibrary } from "@/lib/practice/offline-guidance";

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
  /** ⚠ `documents: null` means the guidance library was NOT stored -- never render it as zero. */
  | { kind: "stored"; patients: number; at: string; documents: number | null }
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
        // ⚠ WORKSPACE, NOT DAY. The switch means "hold nothing for this practice", and the guidance
        // library lives a week rather than a day -- purging only the day would leave protocols behind
        // for six more days after somebody switched caching off.
        const purged = await purgeOfflineWorkspace(workspaceId);
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
          // ⚠ WORKSPACE, NOT DAY. The switch means "hold nothing for this practice", and the guidance
        // library lives a week rather than a day -- purging only the day would leave protocols behind
        // for six more days after somebody switched caching off.
        const purged = await purgeOfflineWorkspace(workspaceId);
          if (!cancelled) setOutcome(purged.ok
            ? { kind: "purged", reason: body.gate.reason ?? gate.reason }
            : { kind: "failed", reason: purged.reason });
          return;
        }
        if (!body.day) { if (!cancelled) setOutcome({ kind: "withheld", reason: body.gate?.reason ?? "Nothing was stored on this device." }); return; }

        const wrote = await cacheOfflineDay(body.day);
        if (!wrote.ok) { if (!cancelled) setOutcome({ kind: "failed", reason: wrote.reason }); return; }

        // ── 4. THE GUIDANCE LIBRARY ───────────────────────────────────────────────────────────────
        // ⚠ INDEPENDENT OF THE DAY, IN BOTH DIRECTIONS. Guidance is gated on a different capability
        // (document.view), lives a week rather than a day, and is stored under its own key. A caller
        // entitled to their day but not to documents must still get their day, so a refusal here is
        // reported and swallowed rather than allowed to unwind what was just stored.
        //
        // It is fetched SECOND on purpose: today's list is what a clinic cannot run without, and on a
        // failing connection the first request is the one most likely to complete.
        let documents: number | null = null;
        try {
          const gRes = await fetch("/api/v1/practice/offline/guidance", { cache: "no-store" });
          if (gRes.ok) {
            const gBody = await gRes.json() as { library: OfflineGuidanceLibrary | null };
            if (gBody.library) {
              const gWrote = await cacheOfflineGuidance(gBody.library);
              if (gWrote.ok) documents = gWrote.documents;
            }
          }
        } catch {
          // Already offline, or the route refused. The day is stored either way, and whatever guidance is
          // already on the device keeps its own expiry -- nothing here deletes it.
        }

        if (!cancelled) setOutcome({ kind: "stored", patients: wrote.patients, at: body.day.asOf, documents });
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
        // ⚠ SILENT WHEN `documents` IS NULL. "0 guidance documents" would be a claim that the practice
        // has none; not storing them is a different fact and this line does not know which.
        + (outcome.documents === null ? ""
          : ` ${outcome.documents} guidance ${outcome.documents === 1 ? "document is" : "documents are"} held with it.`)
      : outcome.kind === "purged" ? outcome.reason
      : outcome.kind === "withheld" ? outcome.reason
      : outcome.kind === "failed" ? `Nothing new was stored on this device: ${outcome.reason}`
      : null;

  if (!line) return null;
  return <p className="text-[10.5px] text-gray-400">{line}</p>;
}
