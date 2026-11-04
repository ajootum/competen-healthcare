import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import type { IntentSurface } from "@/lib/ai/request-intent";
import { QUESTION_MAX } from "./config";

// ── "ASK ABOUT THIS": THE TYPED CONTEXT A LEARNER'S IN-PLACE QUESTION CARRIES ── SCHOLAR-CE-2026 CE-01 ──────────────────
//
// Pure. The in-place Ask panel (Revise feedback, a flashcard, a case debrief, OSCE feedback, My Plan, a saved lesson, the
// Personal AI page) posts to the SAME route Learn's "Ask" uses (/api/individual/scholar/learn/assistant) with this payload
// as `askContext`. Nothing here decides who may read what:
//
// ⚠ THE CLIENT'S IDS ARE CLAIMS. Every chunk id is read again on the server by the caller's own id (store.getPassage) and an id
//   that is not the caller's is DROPPED, not refused: learner B naming learner A's section gets the same answer as naming
//   nothing (no disclosure that the id exists). Ownership is decided by `ownedPassages`, fed the store's owner-keyed read.
// ⚠ THE SURFACE NEVER LOWERS RISK. It maps onto an EXISTING intent surface (request-intent.ts), which is framing only: it can
//   never lower real-patient evidence, a configured high-risk rule or the model floor. `refLabel` is framing words too, and is
//   dropped when it carries a patient-identifier shape.
// ⚠ NO ANSWER OR CONTEXT IS STORED by this feature. SCHOLAR-SEARCH-HISTORY-01 (policy scholar_search_history, default off) alone keeps the learner's
// submitted question, in their own private history, through its own route; the panel says so.

export const ASK_SURFACES = ["revise", "flashcards", "case", "osce", "plan", "library", "learn", "personal_ai"] as const;
export type AskSurface = (typeof ASK_SURFACES)[number];

/** At most this many of the learner's own sections ground one in-place question. */
export const ASK_CHUNK_MAX = 6;
export const ASK_LABEL_MAX = 120;

/** The existing intent surfaces (request-intent.ts IntentSurface): the closest one for each place a question is asked from. */
export const ASK_INTENT_SURFACE: Record<AskSurface, IntentSurface> = {
  revise: "revise", flashcards: "revise", case: "apply", osce: "apply", plan: "learn", library: "learn", learn: "learn", personal_ai: "personal_ai",
};

export type AskContext = {
  surface: AskSurface;
  /** The learner's own sections (at most ASK_CHUNK_MAX, distinct, well-formed): still to be checked against the caller. */
  chunkIds: string[];
  materialId: string | null;
  studyId: string | null;
  /** Where the question is asked, in words ("Question feedback"): framing only. */
  refLabel: string | null;
  /** The question the panel offered for the learner to edit. The server does not use it; it is read only to be bounded. */
  prefill: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const ASK_UNREADABLE = "That question's context could not be read. Close the panel and open it again.";

/**
 * Pure. The `askContext` of a request body. Absent: `{ ok: true, value: null }` (the route behaves exactly as before).
 * Present but not an object, or with an unknown surface: refused. Everything else is cleaned, never trusted: ids that are not
 * well-formed are dropped, the rest de-duplicated and cut to ASK_CHUNK_MAX; free text is trimmed and bounded.
 */
export function parseAskContext(raw: unknown): { ok: true; value: AskContext | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: ASK_UNREADABLE };
  const o = raw as Record<string, unknown>;
  if (!(ASK_SURFACES as readonly unknown[]).includes(o.surface)) return { ok: false, error: ASK_UNREADABLE };
  const chunkIds = Array.isArray(o.chunkIds) ? [...new Set((o.chunkIds as unknown[]).filter(uuid).map(x => x.toLowerCase()))].slice(0, ASK_CHUNK_MAX) : [];
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
  return {
    ok: true,
    value: {
      surface: o.surface as AskSurface, chunkIds,
      materialId: uuid(o.materialId) ? o.materialId : null, studyId: uuid(o.studyId) ? o.studyId : null,
      refLabel: text(o.refLabel, ASK_LABEL_MAX), prefill: text(o.prefill, QUESTION_MAX),
    },
  };
}

/** Pure. The framing label as the intent layer may receive it: null when it would carry a patient-identifier shape. */
export const safeRefLabel = (label: string | null): string | null => (label && !findPatientIdentifiers(label).length ? label : null);

/**
 * The caller's own passages among `ids`, in the order asked, each read by `read` (store.getPassage: keyed on the caller).
 * An id the caller does not own reads null and is dropped; `dropped` says how many were (for the audit row, never shown).
 */
export async function ownedPassages<T>(ids: readonly string[], read: (id: string) => Promise<T | null>): Promise<{ passages: T[]; dropped: number }> {
  const found = (await Promise.all(ids.map(id => read(id).catch(() => null)))) as (T | null)[];
  const passages = found.filter((p): p is T => !!p);
  return { passages, dropped: found.length - passages.length };
}

// ── prefill: the short question each entry point offers, for the learner to edit ──

const quote = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

/** Pure. A short, editable question for an entry point, bounded to QUESTION_MAX. Empty parts are left out. */
export function askPrefill(kind: "revise" | "flashcard" | "case" | "osce" | "plan" | "library", p: { stem?: string | null; answer?: string | null; correct?: boolean | null; title?: string | null } = {}): string {
  const stem = p.stem ? quote(p.stem, 220) : "", answer = p.answer ? quote(p.answer, 160) : "", title = p.title ? quote(p.title, 120) : "";
  const out =
    kind === "revise" ? (stem ? `About the question "${stem}": ` : "") + (p.correct === false ? "Explain why the answer is what it is and what I may have misunderstood." : "Explain why this answer is right.")
      : kind === "flashcard" ? `Explain this flashcard${stem ? `: "${stem}"` : ""}${answer ? ` (answer: "${answer}")` : ""} and help me remember it.`
        : kind === "case" ? `Explain the key reasoning in this case${title ? ` ("${title}")` : ""} and what I should take from the debrief.`
          : kind === "osce" ? `Explain what I should improve from this station${title ? ` ("${title}")` : ""}.`
            : kind === "plan" ? `Help me get started with "${title || "my next step"}".`
              : `Explain the main points of this lesson${title ? ` ("${title}")` : ""} again, simply.`;
  return out.slice(0, QUESTION_MAX);
}

/** Pure. The well-formed section ids named by a plan link (`?section=<id>`), for My Plan's next step. */
export function sectionIdsInHref(href: string | null | undefined): string[] {
  if (!href) return [];
  const m = [...href.matchAll(/[?&]section=([0-9a-f-]{36})(?=&|#|$)/gi)].map(x => x[1]).filter(uuid);
  return [...new Set(m.map(x => x.toLowerCase()))].slice(0, ASK_CHUNK_MAX);
}

/** Pure. The learning session named by a plan link (`?session=<id>`), for My Plan's next step. */
export function sessionIdInHref(href: string | null | undefined): string | null {
  const m = /[?&]session=([0-9a-f-]{36})(?=&|#|$)/i.exec(href ?? "");
  return m && uuid(m[1]) ? m[1] : null;
}

// ── the request body the panels send (one place, so the Ask panel and the Personal AI page cannot drift) ──

export type AskRequestInput = {
  question: string;
  context: { surface: AskSurface; chunkIds?: readonly string[]; materialId?: string | null; studyId?: string | null; refLabel?: string | null; prefill?: string | null };
  /** A Learn session (and the step in it) whose sections ground the question, read on the server by the caller's own id. */
  sessionId?: string | null; step?: number | null;
  depth?: string; purpose?: "education" | null; followUp?: unknown; spelling?: Record<string, unknown>;
};

/** Pure. The JSON body for POST /api/individual/scholar/learn/assistant from an in-place panel. Grounded questions use mode "ask", others "teach". */
export function askRequestBody(i: AskRequestInput): Record<string, unknown> {
  const chunkIds = (i.context.chunkIds ?? []).slice(0, ASK_CHUNK_MAX);
  const grounded = chunkIds.length > 0 || !!i.sessionId;
  return {
    question: i.question, mode: grounded ? "ask" : "teach",
    ...(i.depth ? { depth: i.depth } : {}), ...(i.purpose ? { purpose: i.purpose } : {}), ...(i.followUp ? { followUp: i.followUp } : {}), ...(i.spelling ?? {}),
    ...(i.sessionId ? { sessionId: i.sessionId, ...(typeof i.step === "number" ? { step: i.step } : {}) } : {}),
    askContext: {
      surface: i.context.surface, chunkIds, ...(i.context.materialId ? { materialId: i.context.materialId } : {}), ...(i.context.studyId ? { studyId: i.context.studyId } : {}),
      ...(i.context.refLabel ? { refLabel: i.context.refLabel } : {}), ...(i.context.prefill ? { prefill: i.context.prefill } : {}),
    },
  };
}
