"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { offlineFreshness } from "@/lib/practice/offline-projection";

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
//
// ── ⚠ AND NOW A FOURTH: `offline` (CP-OFFLINE-SURVEY-001 s3.4.4) ────────────────────────────────────
//
// A FOURTH STATE ON THIS INDICATOR, NOT A SECOND INDICATOR. The survey is explicit: "Phase one adds a
// fourth state to an existing indicator. It does not invent an indicator system." Two badges disagreeing
// about connectivity in one header would be the same failure this component was built to remove.
//
// `polling` and `offline` must never look alike, because they mean opposite things:
//
//   polling   DEGRADED BUT CURRENT -- the stream is down, the page is still re-reading from the server
//   offline   NOT CURRENT AT ALL   -- nothing has been read since the instant printed on the badge
//
// So the offline state prints an ABSOLUTE capture time on the practice's clock ("Offline - showing
// 08:14"), never a relative "2 hours ago" that a glance misreads, and its weight ESCALATES with age: the
// same grey badge at 8 minutes and 8 hours is the failure this is meant to prevent. The bands come from
// offline-projection.ts, so the badge and the offline page cannot disagree about what "stale" means.
//
// ⚠ The `asOf` it prints is the instant THE SERVER assembled the page, handed down as a prop. Reading the
// clock in here would print the time the badge rendered, which is not the age of anything on screen.

/** s12's fallback window. The slow end of 30-60s: this is a whole-page re-render, not a delta. */
const POLL_MS = 45_000;
/**
 * How long a page may go without a successful re-read before it stops calling itself current.
 *
 * TWO POLL INTERVALS, NOT ONE. A single missed poll is a slow request or a tab the browser throttled
 * while it was in the background; escalating on that would put a red badge on every phone that had been
 * in a pocket. Two consecutive misses is a pattern, and 112 seconds is still well inside the window in
 * which a practitioner would want to know that what they are reading has stopped moving.
 */
const STALE_AFTER_MS = POLL_MS * 2.5;
/** Events arrive in bursts -- a completion emits several -- so refreshes are coalesced. */
const COALESCE_MS = 400;
/** How often the offline badge re-reads its own age, so the label escalates while the tab is left open. */
const AGE_TICK_MS = 30_000;

type Mode = "connecting" | "live" | "polling" | "offline";

/**
 * @param asOf     the instant the SERVER assembled what is on screen (DashboardReadModel.asOf).
 * @param timezone the practice's zone, so the stamp is the clinic's wall clock and not the laptop's.
 *
 * Both optional: a surface that cannot say when its data was assembled gets the three states it had
 * before, and the offline badge falls back to saying only that the device is offline. It must never
 * invent a capture time.
 */
export default function LiveRefresh({ asOf, timezone }: { asOf?: string; timezone?: string } = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("connecting");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── THE FOURTH STATE ────────────────────────────────────────────────────────────────────────────
  //
  // navigator.onLine is a weak signal -- it reports a link, not reachability -- so it is used only in the
  // direction it is reliable in: FALSE genuinely means there is no network. TRUE does not mean the
  // practice is reachable, which is exactly why the stream and the poll below keep running and keep the
  // other three states honest.
  useEffect(() => {
    const down = () => setMode("offline");
    const up = () => { setMode("polling"); router.refresh(); };
    // Deferred by a tick for the reason the EventSource catch below already gives at length: a setState
    // in the effect BODY runs during the same commit and cascades a second render before the first has
    // painted.
    if (typeof navigator !== "undefined" && navigator.onLine === false) queueMicrotask(down);
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    const age = setInterval(() => setTick(t => t + 1), AGE_TICK_MS);
    return () => { window.removeEventListener("offline", down); window.removeEventListener("online", up); clearInterval(age); };
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        if (!cancelled) { router.refresh(); setLastAt(Date.now()); }
      }, COALESCE_MS);
    };

    // ⚠ THE STREAM MUST NOT TALK THE BADGE OUT OF `offline`. With no network EventSource errors within a
    // second, and its handler would have set `polling` -- which says "degraded but CURRENT" over a page
    // that has not been re-read since it rendered. Every transition below goes through this, so the one
    // state that means "not current at all" cannot be overwritten by a symptom of the same outage.
    const say = (next: Mode) => {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) { setMode("offline"); return; }
      setMode(next);
    };

    // ── The stream ──────────────────────────────────────────────────────────────────────────────
    //
    // EventSource reconnects by itself and replays from Last-Event-ID, so there is no retry logic here
    // to get wrong. What it does NOT do is tell us it has given up, which is why the poll below runs
    // regardless and simply costs nothing while the stream is healthy.
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/v1/practice/stream");
      source.addEventListener("ready", () => say("live"));
      source.addEventListener("practice", () => { if (!cancelled) refresh(); });
      // The server says so when it cannot read the log. Reported rather than treated as silence.
      source.addEventListener("degraded", () => say("polling"));
      source.onerror = () => {
        // EventSource retries on its own. This only records that we are not currently receiving, so the
        // indicator stops claiming live -- it does not close the connection and prevent the retry.
        say("polling");
      };
      source.onopen = () => say("live");
    } catch {
      // Deferred by a tick rather than set here. React's rule is not pedantry: a setState in the effect
      // BODY runs during the same commit and cascades a second render before the first has painted. Every
      // other transition in this component already happens in a callback, and this one -- the browser
      // refusing to construct an EventSource at all -- is the only synchronous path.
      queueMicrotask(() => say("polling"));
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

  // ⚠ `tick` is READ so that the offline badge recomputes its age on the timer above. Without it the
  // escalation would be a promise the component never keeps: the badge would freeze at the age it had
  // when the tab lost its connection, which is precisely the "8 minutes and 8 hours look identical"
  // failure this state exists to prevent.
  void tick;

  // ── A REFRESH THAT NEVER LANDS (CPR-CC-MOB-001 s6, "never label it Live") ──────────────────────
  //
  // ⚠ EVERY STATE ABOVE IS ABOUT THE TRANSPORT, AND NONE OF THEM IS ABOUT THE DATA. `live` means the
  // EventSource is open; `polling` means it is not; `offline` means navigator says there is no network.
  // A server returning 500 to every re-read satisfies none of those: the socket is fine, navigator is
  // happy, and the badge says Live over a page that has not been re-read since it was opened.
  //
  // router.refresh() is fire-and-forget -- it returns nothing, resolves nothing, and throws nothing a
  // caller can see -- so a failed refresh cannot be observed at the call site. What CAN be observed is
  // its effect: `asOf` is the server's render instant (dashboard.ts, `asOf: at.toISOString()`), so a
  // re-read that lands necessarily brings a new one. The poll runs ALONGSIDE the stream in every mode,
  // every POLL_MS -- so in every mode, a stalled `asOf` means the re-reads are not arriving.
  //
  // Two intervals, not one, before it says so: a single missed poll is a slow request or a throttled
  // tab, and calling that stale would cry wolf at every red light.
  const asOfSeenAt = useRef<number>(Date.now());
  const lastAsOf = useRef<string | undefined>(asOf);
  if (asOf !== lastAsOf.current) { lastAsOf.current = asOf; asOfSeenAt.current = Date.now(); }
  const notReRead = Date.now() - asOfSeenAt.current > STALE_AFTER_MS;

  // Offline already had this reading and keeps it. The addition is that a page nobody could re-read is
  // now described the same way whether the cause was the network or the server -- because to the person
  // reading it, those are the same fact: what is on screen is older than it looks.
  const stale = (mode === "offline" || notReRead) && asOf
    ? offlineFreshness(asOf, timezone ?? "UTC", new Date())
    : null;

  // ⚠ notReRead OUTRANKS live AND polling, and that ordering is the whole fix. Both of those words are
  // claims about currency -- "Live" says this is now, "Updating every 45s" says it will be shortly --
  // and neither is true of a page whose re-reads are failing. Offline still wins over both, because it
  // is the more specific diagnosis of the same fact.
  const label = mode === "offline" ? (stale ? `Offline — showing ${stale.atLabel}` : "Offline")
    : notReRead ? (stale ? `Not updating — showing ${stale.atLabel}` : "Not updating")
    : mode === "live" ? "Live"
    : mode === "polling" ? "Updating every 45s"
    : "Connecting";

  // Offline is NOT amber. Amber is `polling`, which means degraded but current; these must never look
  // alike, and the offline tone deepens with age.
  // Not-updating takes the offline palette rather than amber: amber is `polling`, which means degraded
  // but CURRENT, and this is the one thing amber must never be confused with. It deepens with age
  // through the same bands, because eight minutes and eight hours are not the same warning.
  const agedTone = stale?.band === "stale" ? "bg-red-200 text-red-900"
    : stale?.band === "ageing" ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-700";

  const tone = mode === "offline" ? agedTone
    : notReRead ? agedTone
    : mode === "live" ? "bg-emerald-100 text-emerald-700"
    : mode === "polling" ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-500";

  const dot = mode === "offline" || notReRead ? "bg-red-500"
    : mode === "live" ? "bg-emerald-500"
    : mode === "polling" ? "bg-amber-500" : "bg-slate-400";

  const title = mode === "offline"
    ? (stale
      ? `${stale.sentence} Nothing on this page has been re-read since then.`
      : "This device has no connection, so nothing on this page has been re-read since it was opened.")
    : notReRead
      // Deliberately does not guess WHY. From in here a server error, a signed-out session and a proxy
      // eating the request are indistinguishable, and naming the wrong cause is worse than naming none:
      // it sends somebody to check their wifi when their session has expired.
      ? (stale
        ? `${stale.sentence} This page has asked for newer figures and not received any, so what you see is older than it looks.`
        : "This page has asked for newer figures and not received any, so what you see is older than it looks.")
    : mode === "live"
      ? "Connected to the practice event stream. Cards update as things happen."
      : mode === "polling"
        ? "The event stream is not connected, so this page re-reads every 45 seconds instead."
        : "Connecting to the practice event stream.";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}
      title={title}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
      {mode === "offline" && <span className="sr-only">{title}</span>}
      {lastAt && <span className="sr-only">Last updated at {new Date(lastAt).toLocaleTimeString("en-GB")}</span>}
    </span>
  );
}
