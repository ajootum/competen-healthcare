/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PassportPolicy } from "../policy";
import type { PassportCategory } from "../passport-vocabulary";
import type { PassportRecordRef, PassportViewInput } from "./share";
import { isUuid } from "./validate";

// ── A PURPOSE-SPECIFIC PASSPORT VIEW, AS THE SHARE FORM SENDS IT ── COMPETEN-PROFESSIONAL-PASSPORT-01 P4, migration 540 ──
//
// Explicit and private by default: nothing is on a view unless the person ticked it, one record at a time, and only
// kinds the configuration lets a link carry. Checked before the link is minted; 540's composite keys refuse another
// person's record whatever this says. Private reflections, AI conversations and plans have no field here at all.

const RECORD_KINDS: readonly PassportRecordRef["kind"][] = ["cpd", "evidence", "study", "scholar_evaluation"];
export const RECORD_CATEGORY: Record<PassportRecordRef["kind"], PassportCategory> = { cpd: "cpd", evidence: "evidence", study: "study", scholar_evaluation: "evaluation" };
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const ticked = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";

/** Pure: the view a share form describes (fields record:<kind>:<id>), or why it cannot be made. */
export function parsePassportView(b: Record<string, unknown>, policy: PassportPolicy): { ok: true; value: PassportViewInput } | { ok: false; error: string } {
  const records: PassportRecordRef[] = [];
  for (const k of Object.keys(b)) {
    const m = /^record:([a-z_]+):([0-9a-f-]{36})$/i.exec(k);
    if (!m || !ticked(b[k]) || !isUuid(m[2]) || !(RECORD_KINDS as readonly string[]).includes(m[1])) continue;
    records.push({ kind: m[1] as PassportRecordRef["kind"], id: m[2] });
  }
  if (records.some(r => !policy.shareable.includes(RECORD_CATEGORY[r.kind]))) return { ok: false, error: "One kind of record you chose cannot be shared." };
  const purpose = typeof b.purpose === "string" && b.purpose ? policy.purposes.find(o => o.code === b.purpose) : null;
  if (b.purpose && !purpose) return { ok: false, error: "Choose a purpose from the list." };
  const recipient = text(b.recipient, 160);
  if (policy.recipient === "required" && !recipient) return { ok: false, error: "Say who this view is for." };
  const includeInstitution = ticked(b.includeInstitution);
  if (includeInstitution && !policy.shareable.includes("institution")) return { ok: false, error: "Organisation records cannot be shared on a view." };
  return { ok: true, value: {
    purposeCode: purpose?.code ?? null, purposeLabel: purpose?.label ?? null, recipientLabel: recipient, summary: text(b.summary, 2000),
    includeInstitution, records: [...new Map(records.map(r => [`${r.kind}:${r.id}`, r])).values()].slice(0, 300),
  } };
}

/** PRODUCT-EXPERIENCE P4 (owner Option A): a Scholar link carries ONLY formative Scholar records the learner put on
 *  their Passport (375 study, 427 evaluations), explicitly ticked. Never a Professional record, never organisation records. */
export const SCHOLAR_RECORD_KINDS: readonly PassportRecordRef["kind"][] = ["study", "scholar_evaluation"];

/** Pure: why a parsed view cannot be a Scholar link, or null. */
export function scholarViewRefusal(v: PassportViewInput): string | null {
  if (!v.records.length) return "Choose at least one study achievement or evaluation to share.";
  if (v.records.some(r => !SCHOLAR_RECORD_KINDS.includes(r.kind))) return "From Competen Scholar you can share only your study achievements and evaluations.";
  if (v.includeInstitution) return "Organisation records are not shared from Competen Scholar.";
  return null;
}

/** Before minting: every chosen record is the person's own and current. null = fine. */
export async function checkPassportRecords(admin: any, userId: string, refs: readonly PassportRecordRef[], available: { study: readonly string[]; evaluations: readonly string[] }): Promise<string | null> {
  const ids = (k: PassportRecordRef["kind"]) => refs.filter(r => r.kind === k).map(r => r.id);
  const own = async (table: string, list: string[]) => {
    if (!list.length) return true;
    const { data, error } = await admin.from(table).select("id").eq("user_id", userId).in("id", list);
    return !error && (data ?? []).length === list.length;
  };
  if (!(await own("individual_professional_cpd", ids("cpd"))) || !(await own("individual_professional_evidence", ids("evidence")))) return "One of the records you chose is not yours. Refresh and choose again.";
  if (ids("study").some(i => !available.study.includes(i)) || ids("scholar_evaluation").some(i => !available.evaluations.includes(i)))
    return "Only study and evaluations shown on your Passport can be shared.";
  return null;
}
