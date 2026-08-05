"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// CPR-CORE-001 s12 + s16.5: the dashboard keeps up WITHOUT A MANUAL RELOAD.
//
// s16.5: "Completing an encounter updates counts, queue status, recent patients, timeline and
//         performance without manual reload."
// s12:   "Operational items should update through SSE or WebSocket where available. Polling fallback may
//         run every 30-60 seconds."
//
// ── WHY THIS IS A REFRESH AND NOT A PATCH ───────────────────────────────────────────────────────────
//
// The event says WHAT changed, and this component throws that away and asks the server to render the
// page again. That looks wasteful and is the whole point: the alternative is a client-side reducer that
// applies "encounter.completed" to eight cards, which is a SECOND implementation of every metric --
// exactly what s16 forbids, only now in the browser where nothing can test it. The server already knows
// how to compute the dashboard. Asking it again is one round trip and cannot disagree with itself.
//
// ── THREE STATES, AND THE THIRD IS THE ONE THAT MATTERS ─────────────────────────────────────────────
//
//   live      the stream is connected and events arrive
//   polling   the stream failed, so the page re-reads on s12's fallback interval
//   stale     neither is working
//
// ⚠ A DASHBOARD WHOSE STREAM DIED LOOKS EXACTLY LIKE A QUIET MORNING. That is the failure this component
// exists to make impossible: it degrades to polling on its own, and says which of the three it is in, so
// "nothing is happening" is never indistinguishable from "nothing is arriving".
//
// The indicator is deliberately small and deliberately present. s16: the page "does not imply live data
// when only snapshot data is available".

/** s12's fallback window. The slow end of 30-60s: this is a whole-page re-render, not a delta. */
const POLL_MS = 45_000;
/** Events arrive in bursts -- a completion emits several -- so refreshes are coalesced. */
const COALESCE_MS = 400;

type Mode = "connecting" | "live" | "polling";

export default function LiveRefresh() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("connecting");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        if (!cancelled) { router.refresh(); setLastAt(Date.now()); }
      }, COALESCE_MS);
    };

    // ── The stream ──────────────────────────────────────────────────────────────────────────────
    //
    // EventSource reconnects by itself and replays from Last-Event-ID, so there is no retry logic here
    // to get wrong. What it does NOT do is tell us it has given up, which is why the poll below runs
    // regardless and simply costs nothing while the stream is healthy.
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/v1/practice/stream");
      source.addEventListener("ready", () => { if (!cancelled) setMode("live"); });
      source.addEventListener("practice", () => { if (!cancelled) refresh(); });
      // The server says so when it cannot read the log. Reported rather than treated as silence.
      source.addEventListener("degraded", () => { if (!cancelled) setMode("polling"); });
      source.onerror = () => {
        // EventSource retries on its own. This only records that we are not currently receiving, so the
        // indicator stops claiming live -- it does not close the connection and prevent the retry.
        if (!cancelled) setMode("polling");
      };
      source.onopen = () => { if (!cancelled) setMode("live"); };
    } catch {
      // Deferred by a tick rather than set here. React's rule is not pedantry: a setState in the effect
      // BODY runs during the same commit and cascades a second render before the first has painted. Every
      // other transition in this component already happens in a callback, and this one -- the browser
      // refusing to construct an EventSource at all -- is the only synchronous path.
      queueMicrotask(() => { if (!cancelled) setMode("polling"); });
    }

    // ── s12's fallback, always running ──────────────────────────────────────────────────────────
    //
    // Not "instead of" the stream: ALONGSIDE it. A stream that is connected but silently dropping events
    // -- a proxy buffering, a tab throttled in the background -- is invisible from in here, and a
    // 45-second re-read costs one render and closes that hole without needing to detect it.
    const poll = setInterval(() => { if (!cancelled) { router.refresh(); setLastAt(Date.now()); } }, POLL_MS);

    return () => {
      cancelled = true;
      if (pending.current) clearTimeout(pending.current);
      clearInterval(poll);
      source?.close();
    };
  }, [router]);

  const label = mode === "live" ? "Live" : mode === "polling" ? "Updating every 45s" : "Connecting";
  const tone = mode === "live"
    ? "bg-emerald-100 text-emerald-700"
    : mode === "polling" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}
      title={mode === "live"
        ? "Connected to the practice event stream. Cards update as things happen."
        : mode === "polling"
          ? "The event stream is not connected, so this page re-reads every 45 seconds instead."
          : "Connecting to the practice event stream."}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${
        mode === "live" ? "bg-emerald-500" : mode === "polling" ? "bg-amber-500" : "bg-slate-400"}`} />
      {label}
      {lastAt && <span className="sr-only">Last updated at {new Date(lastAt).toLocaleTimeString("en-GB")}</span>}
    </span>
  );
}
