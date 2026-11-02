"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition } from "react";
import { applyPlanPatches, applyPlanPatchesToDay, type PlanPatch } from "@/lib/individual/scholar/plan-patches";
import type { AgendaDay } from "@/lib/individual/scholar/plan-view";
import type { CalendarItem } from "@/lib/individual/scholar/study-calendar";
import { errorOf, type Called } from "./plan-ui";
import { errorCls } from "./plan-style";

// MY PLAN -> INSTANT UPDATES (scholar/plan-perf-01). When the learner adds, moves, postpones, edits, completes or deletes something, the change is shown
// at once (a patch laid over what the server last sent), the request goes as it always did, and only then does the page ask the server for its own
// answer (router.refresh, in a transition, so the screen never blanks). A refused request takes its patch off again and says why. Nothing here decides
// anything: the server still checks and records everything, and its answer replaces the patches when it arrives (`stamp` changes with every render).

type Ctx = {
  patches: readonly PlanPatch[];
  /** Show `patches` now, send `request`, and then reconcile with the server. `settle` may swap the patches for the server's own answer once it is in. */
  commit: (patches: readonly PlanPatch[], request: () => Promise<Called>, settle?: (r: Called) => PlanPatch[]) => Promise<Called>;
};
const PlanOptimisticContext = createContext<Ctx | null>(null);

/** `covered`: the server was asked for its page after this change was confirmed, so the next page that arrives already includes it. */
type Held = { id: number; patches: readonly PlanPatch[]; done: boolean; covered: boolean };

export function PlanOptimistic({ stamp, children }: { stamp: string; children: React.ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [held, setHeld] = useState<Held[]>([]);
  const [seen, setSeen] = useState(stamp);
  const [error, setError] = useState("");
  const counter = useRef(0);
  // The server sent a fresh page: it already includes every change that was confirmed before it was asked for, so those patches go. One still on its way stays.
  if (seen !== stamp) {
    setSeen(stamp);
    setHeld(h => h.filter(x => !x.covered));
  }

  const commit = useCallback<Ctx["commit"]>(async (patches, request, settle) => {
    const id = ++counter.current;
    setError("");
    setHeld(h => [...h, { id, patches, done: false, covered: false }]);
    const r = await request();
    if (!r.ok) {
      setHeld(h => h.filter(x => x.id !== id));
      setError(errorOf(r));
      return r;
    }
    setHeld(h => h.map(x => (x.id === id ? { ...x, patches: settle ? settle(r) : x.patches, done: true } : x)).map(x => (x.done ? { ...x, covered: true } : x)));
    startTransition(() => router.refresh());
    return r;
  }, [router]);

  const value = useMemo<Ctx>(() => ({ patches: held.flatMap(x => x.patches), commit }), [held, commit]);
  return (
    <PlanOptimisticContext.Provider value={value}>
      {error && (
        <div className="mb-3 flex items-start justify-between gap-3" data-testid="plan-update-error">
          <p role="alert" className={errorCls}>{error} The change was not kept.</p>
          <button type="button" className="shrink-0 text-[13px] font-semibold text-gray-700 underline" onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {children}
    </PlanOptimisticContext.Provider>
  );
}

/** The instant-update door. Without a provider (another screen) a change simply asks the server and refreshes, as before. */
export function usePlanUpdates(): Ctx {
  const router = useRouter();
  const ctx = useContext(PlanOptimisticContext);
  return useMemo<Ctx>(() => ctx ?? {
    patches: [],
    commit: async (_p, request) => { const r = await request(); if (r.ok) router.refresh(); return r; },
  }, [ctx, router]);
}

/** The days the server sent with the learner's unconfirmed changes laid over them. */
export function usePatchedDays(days: AgendaDay[]): AgendaDay[] {
  const { patches } = usePlanUpdates();
  return useMemo(() => applyPlanPatches(days, patches), [days, patches]);
}

/** Today's schedule rows, with the learner's unconfirmed changes laid over them. */
export function usePatchedDay(date: string, items: readonly CalendarItem[]): CalendarItem[] {
  const { patches } = usePlanUpdates();
  return useMemo(() => applyPlanPatchesToDay(date, items, patches), [date, items, patches]);
}
