// Assessor workspace: autosave for the runner. Client-safe, no imports from the server side of this directory.
//
//   - a change is queued per response key and sent after a quiet ~800 ms (debounce)
//   - every send carries the revision the browser last saw (optimistic concurrency): a stale one is a CONFLICT and the
//     server's row comes back, so the person chooses between theirs and mine. Nothing is overwritten silently.
//   - what is not yet saved lives in sessionStorage, so a reload, a lost connection or a closed tab does not lose it. It is
//     replayed when the assessment is opened again.
//   - no connection (a thrown fetch, a 5xx) is OFFLINE: the queue keeps everything and retries.
import type { ResponseValue } from "@/lib/assessment/core";

export type SaveState = "idle" | "saving" | "saved" | "offline" | "conflict";
export type SendResult =
  | { kind: "ok"; revision: number }
  | { kind: "conflict"; server: { value: ResponseValue | null; revision: number } }
  | { kind: "rejected"; message: string }
  | { kind: "offline" };

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface QueueOptions {
  instanceId: string;
  send: (key: string, value: ResponseValue | null, revision: number) => Promise<SendResult>;
  storage?: StorageLike | null;
  debounceMs?: number;
  retryMs?: number;
  onStatus?: (s: SaveState) => void;
  onConflict?: (c: Conflict) => void;
  onRejected?: (key: string, message: string) => void;
}
export interface Conflict { key: string; mine: ResponseValue | null; server: { value: ResponseValue | null; revision: number } }

export const pendingKey = (instanceId: string) => `asmt.assessor.pending.${instanceId}`;

/** What a previous session left unsaved. Tolerates a missing, blocked or damaged store. */
export function readPending(storage: StorageLike | null | undefined, instanceId: string): Record<string, ResponseValue | null> {
  try {
    const raw = storage?.getItem(pendingKey(instanceId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export class PatchQueue {
  private pending = new Map<string, ResponseValue | null>();
  private conflicts = new Map<string, Conflict>();
  private revisions: Record<string, number>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private disposed = false;
  status: SaveState = "idle";

  constructor(private o: QueueOptions, revisions: Record<string, number>) {
    this.revisions = { ...revisions };
  }

  /** Put back what an earlier session left unsaved, and send it. Returns the values so the screen can show them. */
  replay(): Record<string, ResponseValue | null> {
    const left = readPending(this.o.storage, this.o.instanceId);
    for (const [k, v] of Object.entries(left)) this.pending.set(k, v);
    if (this.pending.size) { this.set("saving"); this.schedule(0); }
    return left;
  }

  enqueue(key: string, value: ResponseValue | null) {
    this.pending.set(key, value);
    this.persist();
    this.set("saving");
    this.schedule(this.o.debounceMs ?? 800);
  }

  get unsaved(): number { return this.pending.size; }
  get conflictList(): Conflict[] { return [...this.conflicts.values()]; }
  revisionOf(key: string): number { return this.revisions[key] ?? 0; }

  /** Send everything now. Resolves when nothing more can be sent (all saved, offline, or only conflicts remain). */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  /** Keep mine: send it again against the server's revision. Use theirs: drop mine and report the server's row. */
  resolve(key: string, choice: "mine" | "theirs"): ResponseValue | null | undefined {
    const c = this.conflicts.get(key);
    if (!c) return undefined;
    this.conflicts.delete(key);
    this.revisions[key] = c.server.revision;
    if (choice === "mine") { this.enqueue(key, c.mine); return c.mine; }
    this.after();
    return c.server.value;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearTimeout(this.retry);
  }

  /** The browser came back online. */
  online() { if (this.pending.size) void this.flush(); }

  private schedule(ms: number) {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms);
  }

  private set(s: SaveState) {
    if (this.status === s) return;
    this.status = s;
    this.o.onStatus?.(s);
  }

  private persist() {
    try {
      if (!this.o.storage) return;
      if (!this.pending.size) this.o.storage.removeItem(pendingKey(this.o.instanceId));
      else this.o.storage.setItem(pendingKey(this.o.instanceId), JSON.stringify(Object.fromEntries(this.pending)));
    } catch { /* a blocked store only loses the reload safety net */ }
  }

  private after() {
    this.set(this.conflicts.size ? "conflict" : this.pending.size ? "offline" : "saved");
  }

  private async drain(): Promise<void> {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    let offline = false;
    // a change made while a send was in flight stays queued and goes in the next pass
    for (let pass = 0; pass < 50 && this.pending.size && !offline; pass++) {
      for (const [key, value] of [...this.pending.entries()]) {
        let r: SendResult;
        try { r = await this.o.send(key, value, this.revisions[key] ?? 0); } catch { r = { kind: "offline" }; }
        if (r.kind === "offline") { offline = true; break; }
        if (r.kind === "ok") {
          if (value === null) delete this.revisions[key]; else this.revisions[key] = r.revision;
          if (this.pending.get(key) === value) this.pending.delete(key);
        } else if (r.kind === "conflict") {
          this.pending.delete(key);
          const c = { key, mine: value, server: r.server };
          this.conflicts.set(key, c);
          this.o.onConflict?.(c);
        } else {
          this.pending.delete(key);
          this.o.onRejected?.(key, r.message);
        }
        this.persist();
      }
    }
    this.persist();
    if (offline && !this.disposed) {
      this.set("offline");
      this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, this.o.retryMs ?? 5000);
      return;
    }
    this.after();
  }
}
