// Governed policies: reading and checking the body of the two policy routes. Pure, no database. The route and page files own the
// vocabularies (types and scopes) and pass them in, so this file holds no domain word list.
import type { NewPolicy, PolicyVersionPatch } from "./write";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PolicyVocab { types: readonly string[]; scopes: readonly string[] }

export const TITLE_MAX = 200;
export const TEXT_MAX = 200_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const bad = <T,>(error: string): Parsed<T> => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A calendar date YYYY-MM-DD, or empty/null meaning "none". undefined means "not given". */
function dateOf(v: unknown): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) return bad("Dates are written year-month-day, for example 2027-01-31.");
  return { ok: true, value: v };
}

function textOf(v: unknown, max: number, what: string): Parsed<string | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (typeof v !== "string") return bad(`${what} must be text.`);
  if (v.length > max) return bad(`${what} is too long (at most ${max} characters).`);
  return { ok: true, value: v };
}

export function parseNewPolicy(body: unknown, vocab: PolicyVocab): Parsed<NewPolicy> {
  if (!isObj(body)) return bad("Send the policy as JSON.");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 3) return bad("Give the policy a title of at least three characters.");
  if (title.length > TITLE_MAX) return bad(`The title is too long (at most ${TITLE_MAX} characters).`);
  if (typeof body.policyType !== "string" || !vocab.types.includes(body.policyType)) return bad(`Choose the policy type: ${vocab.types.join(", ")}.`);
  const scope = body.scope === undefined || body.scope === null || body.scope === "" ? undefined : body.scope;
  if (scope !== undefined && (typeof scope !== "string" || !vocab.scopes.includes(scope))) return bad(`Choose the scope: ${vocab.scopes.join(", ")}.`);
  const description = textOf(body.description, 2000, "The description"); if (!description.ok) return description;
  const summary = textOf(body.summary, 2000, "The summary"); if (!summary.ok) return summary;
  const content = textOf(body.content, TEXT_MAX, "The text"); if (!content.ok) return content;
  return { ok: true, value: { title, policyType: body.policyType, scope, description: description.value ?? null, summary: summary.value ?? null, content: content.value ?? "" } };
}

export function parsePolicyPatch(body: unknown): Parsed<PolicyVersionPatch> {
  if (!isObj(body)) return bad("Send the changes as JSON.");
  const patch: PolicyVersionPatch = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length < 3) return bad("The title needs at least three characters.");
    if (body.title.length > TITLE_MAX) return bad(`The title is too long (at most ${TITLE_MAX} characters).`);
    patch.title = body.title;
  }
  if (body.summary !== undefined) {
    if (body.summary !== null && typeof body.summary !== "string") return bad("The summary must be text.");
    if (typeof body.summary === "string" && body.summary.length > 2000) return bad("The summary is too long (at most 2000 characters).");
    patch.summary = body.summary as string | null;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string") return bad("The text must be text.");
    if (body.content.length > TEXT_MAX) return bad(`The text is too long (at most ${TEXT_MAX} characters).`);
    patch.content = body.content;
  }
  const eff = dateOf(body.effectiveFrom); if (!eff.ok) return eff;
  if (eff.value !== undefined) patch.effectiveFrom = eff.value;
  const due = dateOf(body.reviewDue); if (!due.ok) return due;
  if (due.value !== undefined) patch.reviewDue = due.value;
  if (Object.keys(patch).length === 0) return bad("Nothing to save: send at least one field.");
  return { ok: true, value: patch };
}
