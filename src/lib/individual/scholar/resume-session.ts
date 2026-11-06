/* eslint-disable @typescript-eslint/no-explicit-any */
import { displaySessionTitle, sessionHits, type SessionHit } from "./learn-search";
import { listLearningSessions, type MaterialRow } from "./store";

// SCH-HFE-01, Learn landing: which learning session a learner can go straight back to, read the same way on the Study Home and on
// Learn. An open study session comes first, because it reopens in its last stage, then the latest active session with lessons left.
// Reads only, no AI, and nothing is created.

const LOOK_BACK = 30;
const CHECK = 5;

export type Resume = {
  /** Null where the sessions could not be read: said so, never shown as none. */
  read: boolean;
  session: SessionHit | null;
  /** The session is the open study session: reopen it in this stage. */
  connectedSpace: string | null;
  /** Active sessions exist, and none has lessons left to open. */
  blocked: boolean;
  /** The learner has more than this one session. */
  more: boolean;
};

/** Pure: the most recent session the learner can go back to. Only active sessions with lessons left count. */
export function resumableOf(hits: readonly SessionHit[]): { session: SessionHit | null; blocked: boolean } {
  const active = hits.filter(h => h.status === "active");
  const session = active.find(h => h.steps > 0) ?? null;
  return { session, blocked: !session && active.length > 0 };
}

export async function resumeSession(admin: any, userId: string, materials: readonly MaterialRow[], connected: { id: string; space: string } | null): Promise<Resume> {
  const sessions = await listLearningSessions(admin, userId, LOOK_BACK);
  if (!sessions.ok) return { read: false, session: null, connectedSpace: null, blocked: false, more: false };
  const active = sessions.data.filter(r => r.status === "active");
  const ordered = connected ? [...active.filter(r => r.id === connected.id), ...active.filter(r => r.id !== connected.id)] : active;
  const { session: picked, blocked } = resumableOf(await sessionHits(admin, userId, ordered.slice(0, CHECK), materials));
  // One session on its own needs no "started on" to tell it from others with the same name.
  const row = picked ? sessions.data.find(r => r.id === picked.id) : null;
  const session = picked && row ? { ...picked, title: displaySessionTitle(row.title) } : picked;
  return { read: true, session, connectedSpace: session && connected?.id === session.id ? connected.space : null, blocked, more: sessions.data.length > 1 };
}
