import { PRIMARY, rkey, type ResponseValue, type Responses } from "../../core";

// ── ANSWERS: WIRE <-> DATABASE SHAPES ── Checklist Studio S3 ─────────────────────────────────────────────────────────
//
// Pure. The runner's ResponseValue may carry null-valued keys ({ level_code: "4", state: null }). The database holds ONE json object
// with exactly one of level_code, state, value (a null-valued key still counts as present there), plus an optional reason.
// "Not answered" is the ABSENCE of a row: the runner clears the answer to null, and the store deletes the row, it never stores
// not_assessed as an answer (an unanswered item and a deliberately unjudged item are different things).

/** The stored answer object, or null when the runner means "no answer". */
export function toDbValue(v: ResponseValue | null | undefined): Record<string, unknown> | null {
  if (!v) return null;
  const reason = typeof v.reason === "string" && v.reason.trim() ? { reason: v.reason.trim().slice(0, 1000) } : {};
  if (typeof v.level_code === "string" && v.level_code !== "") return { level_code: v.level_code, ...reason };
  if (typeof v.state === "string") return { state: v.state, ...reason };
  if (v.value !== undefined && v.value !== null && v.value !== "") return { value: v.value, ...reason };
  return null;
}

/** A stored answer object back to the runner's value. */
export function fromDbValue(o: unknown): ResponseValue | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const out: ResponseValue = {};
  if (typeof r.level_code === "string") out.level_code = r.level_code;
  else if (typeof r.state === "string") out.state = r.state as ResponseValue["state"];
  else if ("value" in r) out.value = r.value;
  else return null;
  if (typeof r.reason === "string" && r.reason) out.reason = r.reason;
  return out;
}

/** A response key is the item's stable key, or "<stable_key>#<field_key>" for a secondary field. */
export function splitKey(key: string): { itemKey: string; fieldKey: string } | null {
  const [item, field = PRIMARY, ...rest] = key.split("#");
  if (rest.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item) || !/^[a-z][a-z0-9_]{1,40}$/.test(field)) return null;
  return { itemKey: item.toLowerCase(), fieldKey: field };
}

export type ResponseRow = { item_id: string; field_key: string; value: unknown; revision: number };

/** Responses (and their revisions) from stored rows, keyed the way the engine keys them. */
export function responsesFromRows(rows: readonly ResponseRow[], stableKeyOf: ReadonlyMap<string, string>): { responses: Responses; revisions: Record<string, number> } {
  const responses: Responses = {}, revisions: Record<string, number> = {};
  for (const r of rows) {
    const stable = stableKeyOf.get(r.item_id);
    const v = fromDbValue(r.value);
    if (!stable || !v) continue;
    const key = rkey(stable, r.field_key);
    responses[key] = v;
    revisions[key] = r.revision;
  }
  return { responses, revisions };
}
