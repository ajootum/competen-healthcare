"use client";

import { useEffect, useState } from "react";
import { cacheNav, cacheOfflineDay, cacheOfflineGuidance, purgeOfflineWorkspace, type CachedNavItem } from "@/lib/practice/offline-store";
import { loadLock } from "@/lib/practice/offline-lock-store";
import { sessionKey } from "@/lib/practice/offline-session";
import DeviceLockPrompt from "../_offline/DeviceLockPrompt";
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
  | { kind: "failed"; reason: string }
  /** ⚠ A PIN is set and this tab has not been unlocked. Nothing was stored, and nothing was lost. */
  | { kind: "locked" };

export default function OfflineCacheWriter(
  { workspaceId, gate, nav, showStatus = false }:
  { workspaceId: string; gate: OfflineWriterGate; nav?: CachedNavItem[]; showStatus?: boolean },
) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  // ⚠ Bumped when the device is unlocked, so the effect re-runs and the cache is written immediately
  // rather than at the next navigation. Without it, unlocking would appear to do nothing.
  const [attempt, setAttempt] = useState(0);
  // A stable identity for the sections list -- see the dependency note at the end of the effect.
  const navKey = (nav ?? []).map(i => i.href).join("|");

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

      // ⚠ THE SIDEBAR IS REMEMBERED BEFORE THE LOCK CHECK, because it is not sealed and a LOCKED device
      // still has to draw its chrome. Sealing it, or writing it later, would leave a locked practitioner
      // looking at a blank navy column -- the "this looks broken" state the frame exists to remove.
      if (nav && nav.length) await cacheNav(nav);

      // ── 3. THE DEVICE PIN, IF THERE IS ONE ────────────────────────────────────────────────────
      // ⚠ A LOCKED DEVICE STORES NOTHING, AND THAT IS NOT A FAILURE. The caches are sealed with a key
      // only the PIN can unwrap, so writing them while locked is impossible -- and writing them under a
      // DIFFERENT key would leave records the reader cannot open, which loadOfflineDay deletes. Better
      // to hold off and say so than to fill the device with rubble.
      const lock = await loadLock(new Date());
      const derived = lock.state === "not_enrolled" ? undefined : (sessionKey() ?? null);
      if (derived === null) {
        if (!cancelled) setOutcome({ kind: "locked" });
        return;
      }

      // ── 4. THE DAY ITSELF ─────────────────────────────────────────────────────────────────────
      try {
        const res = await fetch("/api/v1/practice/offline/day", { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setOutcome({ kind: "failed", reason: `the practice could not be reached (${res.status})` }); return; }
        const body = await res.json() as { gate?: { purge?: boolean; reason?: string }; day: OfflineDay | null };

        // The server may refuse between render and fetch -- a switch thrown in the meantime. Its answer
        // wins over the prop, including its instruction to purge.
        if (body.gate?.purge) {
          // ⚠ WORKSPACE, NOT DAY -- see the first purge above.
          const purged = await purgeOfflineWorkspace(workspaceId);
          if (!cancelled) setOutcome(purged.ok
            ? { kind: "purged", reason: body.gate.reason ?? gate.reason }
            : { kind: "failed", reason: purged.reason });
          return;
        }
        if (!body.day) { if (!cancelled) setOutcome({ kind: "withheld", reason: body.gate?.reason ?? "Nothing was stored on this device." }); return; }

        const wrote = await cacheOfflineDay(body.day, derived);
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
              const gWrote = await cacheOfflineGuidance(gBody.library, derived);
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
    // ⚠ `navKey`, NOT `nav`. The prop is built fresh by the server on every render, so a new array
    // identity arrives each time -- putting `nav` itself in this list would re-run the whole effect, and
    // therefore re-fetch and re-write the cache, on every single render. The key is derived from the
    // hrefs, so it changes exactly when the practitioner's sections change and not otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, gate.state, gate.purge, gate.reason, attempt, navKey]);

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

  // ⚠ THE PIN PROMPT IS RENDERED WHATEVER THE OUTCOME, AND IT IS THE ONLY WAY OUT OF `locked`. It is a
  // quiet line, never a wall: the practitioner is online and has no reason to be stopped by a device
  // credential. Ignoring it costs tomorrow's offline copy, not today's work.
  const prompt = (
    <DeviceLockPrompt variant="inline" onUnlocked={() => setAttempt(a => a + 1)} />
  );

  if (outcome.kind === "locked")
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[10.5px] text-gray-400">
          A PIN is set on this device and this tab has not been unlocked, so nothing new is being stored
          for offline use. Nothing already recorded is affected.
        </p>
        {prompt}
      </div>
    );

  if (!line) return prompt;
  // ⚠ THE ONLY PLACE THIS WAS EVER MENTIONED, AND IT WAS NOT A LINK. /practice/offline sits outside the
  // (shell) group so it can render with no connection -- correct -- and the consequence nobody drew is
  // that it had no route in at all: not in the nav, and not linked from anywhere in the product. The
  // owner went looking for it on 2026-08-11 and there was nothing to click.
  return (
    <div className="flex flex-col gap-1">
    <p className="text-[10.5px] text-gray-400">
      {line}{" "}
      {/* ⚠ A plain <a>: a client-side navigation needs an RSC fetch, which is unavailable exactly when
          this destination matters. A document navigation is what the service worker can serve. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/practice/offline" className="underline hover:text-gray-600">See what is held on this device</a>
    </p>
    {prompt}
    </div>
  );
}
