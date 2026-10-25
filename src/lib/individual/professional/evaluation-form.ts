import type { ContextOption, ProfessionalEvaluationPolicy } from "../policy";
import { isScopeKind, isDecision, type Decision } from "./evaluation-vocabulary";
import type { Scope } from "./evaluation";
import { isUuid } from "./validate";

// ── MY PROFESSIONAL EVALUATION: WHAT A PERSON SUBMITS ── pure parsers, COMPETEN-PROFESSIONAL-EVALUATION-01 ─────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** A scope from a query string or a body. Refs are the person's own ids (checked against their record later). */
export function parseScope(b: Record<string, unknown>, policy: Pick<ProfessionalEvaluationPolicy, "scopes">): Parsed<Scope> {
  const kind = one(b.scope ?? b.scopeKind) ?? "development";
  if (!isScopeKind(kind)) return { ok: false, error: "Choose what to evaluate." };
  if (!policy.scopes.includes(kind)) return { ok: false, error: "That kind of evaluation is not offered." };
  const ref = str(one(b.ref ?? b.scopeRef));
  if (kind === "development") return { ok: true, value: { kind, ref: null, ...period(b) } };
  if (kind === "topic") {
    if (ref.length < 2 || ref.length > 80) return { ok: false, error: "Name a topic of 2 to 80 characters." };
    return { ok: true, value: { kind, ref, ...period(b) } };
  }
  if (!isUuid(ref)) return { ok: false, error: "Choose what to evaluate." };
  const outcome = kind === "outcome" ? str(one(b.outcome)) : "";
  if (kind === "outcome" && (outcome.length < 2 || outcome.length > 300)) return { ok: false, error: "Choose a learning outcome." };
  return { ok: true, value: { kind, ref, outcome: kind === "outcome" ? outcome : null, ...period(b) } };
}

function period(b: Record<string, unknown>): { from: string | null; to: string | null } {
  const from = str(one(b.from)), to = str(one(b.to));
  return { from: DATE.test(from) ? from : null, to: DATE.test(to) && (!DATE.test(from) || to >= from) ? to : null };
}

export function parseCorrection(b: Record<string, unknown>): Parsed<{ id: string; note: string } | null> {
  if (b.supersedesId === undefined || b.supersedesId === null || b.supersedesId === "") return { ok: true, value: null };
  if (!isUuid(b.supersedesId)) return { ok: false, error: "Choose the evaluation you are correcting." };
  const note = str(b.correctionNote);
  if (note.length < 3 || note.length > 2000) return { ok: false, error: "Say what you are correcting (3 to 2,000 characters)." };
  return { ok: true, value: { id: b.supersedesId, note } };
}

export function parseAnnotation(b: Record<string, unknown>, templates: readonly ContextOption[]): Parsed<{ evaluationId: string; body: string; template_code: string | null; template_label: string | null; supersedesId: string | null }> {
  if (!isUuid(b.evaluationId)) return { ok: false, error: "Choose an evaluation." };
  const body = str(b.body);
  if (body.length < 3 || body.length > 5000) return { ok: false, error: "Write a note of 3 to 5,000 characters." };
  const code = str(b.templateCode);
  const t = code ? templates.find(o => o.code === code) : undefined;
  if (code && !t) return { ok: false, error: "That template is not offered." };
  const sup = b.supersedesId === undefined || b.supersedesId === "" ? null : b.supersedesId;
  if (sup !== null && !isUuid(sup)) return { ok: false, error: "Choose the note you are revising." };
  return { ok: true, value: { evaluationId: b.evaluationId, body, template_code: t?.code ?? null, template_label: t?.label ?? null, supersedesId: sup } };
}

export function parseDecision(b: Record<string, unknown>, today: string): Parsed<{ evaluationId: string; key: string; decision: Decision; editedTitle: string | null; deferredUntil: string | null; note: string | null }> {
  if (!isUuid(b.evaluationId)) return { ok: false, error: "Choose an evaluation." };
  const key = str(b.key);
  if (!/^[a-z0-9][a-z0-9:_.-]{0,159}$/.test(key)) return { ok: false, error: "Choose a recommendation." };
  if (!isDecision(b.decision)) return { ok: false, error: "Choose accept, defer or dismiss." };
  const edited = str(b.editedTitle);
  if (edited && (b.decision !== "accepted" || edited.length < 3 || edited.length > 200)) return { ok: false, error: "An edited title is 3 to 200 characters, on an acceptance." };
  const until = str(b.deferredUntil);
  if (until && (b.decision !== "deferred" || !DATE.test(until) || until < today)) return { ok: false, error: "A deferral date is today or later." };
  const note = str(b.note);
  if (note.length > 1000) return { ok: false, error: "A note is at most 1,000 characters." };
  return { ok: true, value: { evaluationId: b.evaluationId, key, decision: b.decision, editedTitle: edited || null, deferredUntil: until || null, note: note || null } };
}
