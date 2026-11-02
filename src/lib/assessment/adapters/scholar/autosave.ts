// ── AUTOSAVE: THE PENDING-PATCH QUEUE ── Checklist Studio S3 ─────────────────────────────────────────────────────────
//
// Pure (the browser storage is passed in). The runner saves one answer at a time (PATCH with the revision the browser last saw).
// An answer that has not been confirmed saved is kept in sessionStorage under the instance id and replayed when the page is reopened,
// so a closed tab or a dropped connection loses nothing. A confirmed answer leaves the queue. Only the LATEST unsaved answer per
// item is kept. Nothing is kept for another instance, and unreadable storage is simply an empty queue (never an error).

export type PendingPatch = { key: string; value: unknown | null; revision: number; at: number };
export const PENDING_PREFIX = "cmp:asmt:pending:v1:";
export const pendingKey = (instanceId: string) => `${PENDING_PREFIX}${instanceId}`;
export const SAVE_DEBOUNCE_MS = 800;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readPending(store: Store | null | undefined, instanceId: string): PendingPatch[] {
  try {
    const raw = store?.getItem(pendingKey(instanceId));
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((p): p is PendingPatch => !!p && typeof p === "object" && typeof (p as PendingPatch).key === "string" && Number.isInteger((p as PendingPatch).revision) && typeof (p as PendingPatch).at === "number");
  } catch { return []; }
}

export function writePending(store: Store | null | undefined, instanceId: string, patches: readonly PendingPatch[]): void {
  try {
    if (!store) return;
    if (!patches.length) store.removeItem(pendingKey(instanceId));
    else store.setItem(pendingKey(instanceId), JSON.stringify(patches));
  } catch { /* storage full or blocked: the page still works, it just cannot replay */ }
}

/** Adds (or replaces) the pending patch for an item: the newest answer wins. */
export function queuePatch(queue: readonly PendingPatch[], p: PendingPatch): PendingPatch[] {
  return [...queue.filter(x => x.key !== p.key), p];
}

/** Removes the patch for an item once the server confirmed THAT answer (a newer unsaved answer for the item stays queued). */
export function confirmPatch(queue: readonly PendingPatch[], key: string, at: number): PendingPatch[] {
  return queue.filter(x => !(x.key === key && x.at <= at));
}

/** The save pill state from the queue and the last attempt. */
export function saveStatusOf(o: { inFlight: boolean; queued: number; offline: boolean; conflict: boolean; everSaved: boolean }): "idle" | "saving" | "saved" | "offline" | "conflict" {
  if (o.conflict) return "conflict";
  if (o.offline && o.queued > 0) return "offline";
  if (o.inFlight || o.queued > 0) return "saving";
  return o.everSaved ? "saved" : "idle";
}
