import { RECORD_STATE_DETAIL, RECORD_STATE_LABEL, type ItemKind, type RecordState } from "./profile-vocabulary";

// ── PROFILE RECORDS: STATE, VERSIONS AND HISTORY, PURE ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, GO s4-s5 ─────
//
// ⚠ A STATE IS COMPUTED, NEVER STORED, AND NEVER "VERIFIED". From 450's generated evidence_class (a document
// attached or not), the expiry date against today, and the lifecycle columns. Nothing a person records can
// reach a verified state here: what an organisation verified is read through the Passport, labelled by its
// issuer, and shown apart (src/lib/individual/passport.ts). An unknown evidence class is treated as
// self-declared -- the least claim -- never as anything stronger.
//
// ⚠ VERSIONS, NOT EDITS. A change to a record is a new row naming the one it supersedes (450 trigger), so the
// earlier version is always there to show. A chain is the current version and every version before it.

export type ProfileItem = {
  id: string; section: ItemKind; title: string; type_code: string | null; type_label: string | null;
  organisation: string | null; jurisdiction: string | null; self_declared_identifier: string | null;
  started_on: string | null; ended_on: string | null; expires_on: string | null; target_on: string | null;
  detail: string | null; document_name: string | null; evidence_class: string;
  supersedes_id: string | null; superseded_at: string | null; withdrawn_at: string | null; withdrawn_reason: string | null;
  created_at: string;
};

/** Pure: a record's state today. Lifecycle first, then expiry, then what evidence it carries. */
export function itemState(i: Pick<ProfileItem, "evidence_class" | "expires_on" | "superseded_at" | "withdrawn_at">, today: string): RecordState {
  if (i.withdrawn_at) return "withdrawn";
  if (i.superseded_at) return "superseded";
  if (i.expires_on && i.expires_on < today) return "expired";
  return i.evidence_class === "source_linked" ? "document_supported" : "self_declared";
}

/** Pure: what a record's evidence is, separately from its lifecycle (an expired record still had a document). */
export const evidenceState = (i: Pick<ProfileItem, "evidence_class">): RecordState => (i.evidence_class === "source_linked" ? "document_supported" : "self_declared");

export const stateLabel = (s: RecordState) => RECORD_STATE_LABEL[s];
export const stateDetail = (s: RecordState) => RECORD_STATE_DETAIL[s];

export type ItemChain = { current: ProfileItem; earlier: ProfileItem[] };

/**
 * Pure: each record's chain of versions, newest version first. A chain's head is the version nobody
 * supersedes -- current, or withdrawn (shown as withdrawn, never as current). Chains are newest first.
 */
export function chains(items: readonly ProfileItem[]): ItemChain[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const superseded = new Set(items.map(i => i.supersedes_id).filter((v): v is string => !!v));
  const heads = items.filter(i => !superseded.has(i.id));
  return heads.map(head => {
    const earlier: ProfileItem[] = [];
    const seen = new Set([head.id]);
    let at = head.supersedes_id ? byId.get(head.supersedes_id) : undefined;
    while (at && !seen.has(at.id)) { earlier.push(at); seen.add(at.id); at = at.supersedes_id ? byId.get(at.supersedes_id) : undefined; }
    return { current: head, earlier };
  }).sort((a, b) => (b.current.created_at > a.current.created_at ? 1 : b.current.created_at < a.current.created_at ? -1 : 0));
}

/** Pure: the chains of one kind, current ones first, withdrawn ones after. */
export function chainsOf(items: readonly ProfileItem[] | null, kind: ItemKind): { live: ItemChain[]; withdrawn: ItemChain[] } {
  const all = chains((items ?? []).filter(i => i.section === kind));
  return { live: all.filter(c => !c.current.withdrawn_at), withdrawn: all.filter(c => !!c.current.withdrawn_at) };
}

/** Pure: the facts of a record that changed from the version before it, for the history line. */
export function changedFields(now: ProfileItem, before: ProfileItem): string[] {
  const names: [keyof ProfileItem, string][] = [
    ["title", "name"], ["type_label", "type"], ["organisation", "organisation"], ["jurisdiction", "jurisdiction"],
    ["self_declared_identifier", "number"], ["started_on", "start"], ["ended_on", "end"], ["expires_on", "expiry"],
    ["target_on", "target date"], ["detail", "details"], ["document_name", "document"],
  ];
  return names.filter(([k]) => (now[k] ?? null) !== (before[k] ?? null)).map(([, n]) => n);
}
