// COMPETEN-NOTEBOOK-001, owner 6 Nov 2026: "Ensure sign-out clears Notebook drafts from browser storage without deleting saved server-side notes. Also clear drafts when
// the authenticated account changes on a shared device." Notes the server has saved are never touched here. This is device storage only.
//
// Nothing else is imported, because the root layout loads this on every page of every product. A device with no drafts does no more than look at its own storage.

export const DRAFT_PREFIX = "cmp-scholar-note-draft:v1:";

type DraftStore = Pick<Storage, "length" | "key" | "removeItem">;

const draftKeys = (store: DraftStore): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(DRAFT_PREFIX)) keys.push(k); }
  return keys;
};

export const hasDrafts = (store: DraftStore) => draftKeys(store).length > 0;

/** Removes every draft on this device except those of `keepUserId`. Null removes them all. Returns how many went. */
export function sweepDrafts(store: DraftStore, keepUserId: string | null): number {
  const keep = keepUserId ? `${DRAFT_PREFIX}${keepUserId}:` : null;
  const gone = draftKeys(store).filter(k => !keep || !k.startsWith(keep));
  gone.forEach(k => store.removeItem(k));
  return gone.length;
}

/**
 * Who is signed in decides what stays. A session that has ended takes every draft, and another account takes the last one's. An answer that could not be had, a refresh
 * on a lost connection, changes nothing: that is when a learner's own draft matters most.
 */
export async function guardDrafts(store: DraftStore, readSession: () => Promise<{ userId: string | null; failed: boolean }>): Promise<void> {
  if (!hasDrafts(store)) return;
  const { userId, failed } = await readSession();
  if (!failed) sweepDrafts(store, userId);
}

// ── THIS PAGE ──

let closed = false;
/** Once closed, this page keeps nothing more on the device, so saving on the way out cannot put a draft back after a sign-out. */
export const noteDraftsClosed = () => closed;
export function closeNoteDrafts() {
  closed = true;
  try { sweepDrafts(window.localStorage, null); } catch { /* no storage: nothing is kept */ }
}

type OpenNote = { sendAndWait: () => Promise<void> };
const open = new Set<OpenNote>();
export function trackOpenNote(note: OpenNote) { open.add(note); return () => { open.delete(note); }; }

/** Gives words still waiting one short chance to reach the server before a sign-out clears the device. A lost connection must not hold the sign-out up. */
export async function saveOpenNotes(waitMs = 2000): Promise<void> {
  if (!open.size) return;
  await Promise.race([Promise.allSettled([...open].map(n => n.sendAndWait())), new Promise(r => setTimeout(r, waitMs))]);
}
