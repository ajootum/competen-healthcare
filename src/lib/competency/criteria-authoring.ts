/* eslint-disable @typescript-eslint/no-explicit-any */
import { authored, domainOfCompetency, editableFramework, frameworkOfDomain, isId, NOT_RECORDED, type Actor } from "./authoring";
import { pendingLayout, reorderLayout, writeSortOrders } from "./framework-layout";
import { byRowOrder, type SortWrite } from "./layout-order";

// ── CRITERIA ON SCREEN, IN DRAFT FRAMEWORKS ── FRAMEWORK-DESIGN-STUDIO-02 S1, owner rulings D3 (31 Oct 2026) ──────────
//
// A criterion is a competency_skills row (670): its text (name), its section (component_code, a row of the
// competency_assessment_component registry), where it came from (source_ref) and its order (sort_order, one dense
// order per competency; a section's criteria keep their slots in it, as layout-order.ts densePlan numbers them).
//
//   create / update text      SUBSTANTIVE. The text is in the 395/670 content hash, so the fingerprint changes and
//                             an approved or pending version goes back to clinical review.
//   source reference only     authorship, but outside the fingerprint (where it came from, not what it says).
//   move to another section   SUBSTANTIVE (D3): the component tag is in the hash.
//   or another competency     SUBSTANTIVE (D3): both competencies' fingerprints change. Recorded on both.
//   move within its section   ORGANISATIONAL: delegated to reorder_layout unchanged (F4: not authorship).
//   retire / restore          SUBSTANTIVE (D3): is_active, never a delete (history). See RETIREMENT below.
//
// ⚠ AUTHORSHIP FIRST. Every write but an organisational reorder is preceded by its audit row on the competency (cfca_
// criterion_*), which 395's authorsOf counts as authorship, so whoever wrote or moved a criterion cannot review it.
//
// ⚠ DRAFT FRAMEWORKS ONLY. A published, in-review, approved or archived framework is refused: changes to a published
// framework go through a revision draft (D2, slice S5). Shared frameworks only (editableFramework).
//
// ⚠ RETIREMENT AND THE FINGERPRINT. Migration 761 makes competency_content_hash cover ACTIVE criteria only, so
// retiring a criterion changes the fingerprint (the approval goes stale and the competency goes back to clinical
// review) and restoring it returns the fingerprint to its earlier value. Before 761 the hash covered every row,
// active or not, so a retirement would change what assessors see while the approval still read as current. So for
// a competency that has any clinical content version, retire and restore first probe 761's marker
// (competency_content_hash_covers_retirement) and are refused (409) when it is absent: fail closed. A competency
// never put forward needs no probe.

type Fail = { ok: false; status: number; error: string };
type Result<T extends object = object> = ({ ok: true } & T) | Fail;

export const REVISION_DRAFT = "Changes to a published framework go through a revision draft.";
const UNREADABLE: Fail = { ok: false, status: 503, error: "The criteria could not be read just now. Nothing has changed." };
const missingTable = (e: any) => ["42P01", "PGRST205"].includes(String(e?.code ?? ""));

export type CriterionRow = { id: string; competency_id: string; name: string; sort_order: number | null; component_code: string | null; source_ref: string | null; is_active: boolean | null };

// ── Pure ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pure: criterion text, kept in its source wording (trimmed only). */
export function parseCriterionText(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length >= 3 && t.length <= 2000 ? { ok: true, value: t } : { ok: false, error: "A criterion is 3 to 2,000 characters." };
}
/** Pure: a source reference (null clears it), or undefined when it is not valid. */
export function parseSourceRef(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length <= 300 ? t || null : undefined;
}
/** Pure: a 1-based position, or null for "at the end". undefined = not valid. */
export function parsePosition(v: unknown): number | null | undefined {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : undefined;
}

/**
 * Pure: a competency's whole criteria order (ids) with `item` placed at `position` (1-based) within its section, or
 * at the section's end. Other sections keep their slots. An empty section's first criterion goes last.
 */
export function placeCriterion(list: readonly { id: string; component: string | null }[], item: { id: string; component: string | null }, position: number | null): string[] {
  const rest = list.filter(x => x.id !== item.id);
  const ids = rest.map(x => x.id);
  const section = rest.filter(x => (x.component ?? null) === (item.component ?? null));
  if (!section.length) return [...ids, item.id];
  const p = position == null ? section.length + 1 : Math.min(Math.max(1, position), section.length + 1);
  const at = p <= section.length ? ids.indexOf(section[p - 1].id) : ids.indexOf(section[section.length - 1].id) + 1;
  ids.splice(at, 0, item.id);
  return ids;
}

/** Pure: the sort_order writes that number `order` densely 1..n (only rows whose number changes). */
export function denseWrites(order: readonly string[], current: ReadonlyMap<string, number | null>): SortWrite[] {
  const out: SortWrite[] = [];
  order.forEach((id, i) => { const from = current.get(id) ?? null; if (from !== i + 1) out.push({ table: "competency_skills", id, from, to: i + 1 }); });
  return out;
}

/** Pure: what a move is (D3). Same competency and section = organisational; anything else is substantive. */
export function classifyMove(from: { competencyId: string; component: string | null }, to: { competencyId: string; component: string | null }): "reorder" | "section" | "competency" | "section_and_competency" {
  const c = from.competencyId !== to.competencyId, s = (from.component ?? null) !== (to.component ?? null);
  return c && s ? "section_and_competency" : c ? "competency" : s ? "section" : "reorder";
}

/** Pure: the published assessment methods that pin a criterion (690 criterionId), by name. */
export function pinningMethods(methods: readonly { content: any; name: string | null }[], criterionId: string): string[] {
  const id = criterionId.toLowerCase();
  return methods.filter(m => [...(m.content?.criteria ?? []), ...(m.content?.checklist ?? [])].some((x: any) => typeof x?.criterionId === "string" && x.criterionId.toLowerCase() === id))
    .map(m => m.name ?? "an assessment method");
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Place = { fw: { id: string; name: string; pub_status: string }; comp: { id: string; name: string } };

/** The competency, in a shared DRAFT framework, or why it may not be changed here. */
async function draftCompetency(admin: any, competencyId: unknown): Promise<Result<Place>> {
  if (!isId(competencyId)) return { ok: false, status: 400, error: "Choose a competency." };
  const c = await domainOfCompetency(admin, competencyId);
  if (!c) return { ok: false, status: 404, error: "That competency does not exist." };
  const d = await frameworkOfDomain(admin, c.domain_id);
  if (!d) return { ok: false, status: 404, error: "That competency's domain does not exist." };
  const g = await editableFramework(admin, d.framework_id);
  if (!g.ok && g.status !== 409) return g;
  if (!g.ok || g.fw.pub_status !== "draft")
    return { ok: false, status: 409, error: `Criteria are changed here only while the framework is a draft. ${REVISION_DRAFT}` };
  return { ok: true, fw: g.fw, comp: { id: c.id, name: c.name } };
}

async function criterion(admin: any, criterionId: unknown): Promise<CriterionRow | null | Fail> {
  if (!isId(criterionId)) return { ok: false, status: 400, error: "Choose a criterion." };
  const { data, error } = await admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code, source_ref, is_active").eq("id", criterionId).maybeSingle();
  if (error) return UNREADABLE;
  return data ?? null;
}

async function criteriaOf(admin: any, competencyId: string): Promise<CriterionRow[] | null> {
  const { data, error } = await admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code, source_ref, is_active").eq("competency_id", competencyId).limit(2000);
  return error ? null : ([...(data ?? [])] as CriterionRow[]).sort(byRowOrder);
}

/** The active registry codes. null = unreadable. */
async function activeComponents(admin: any): Promise<Set<string> | null> {
  const { data, error } = await admin.from("competency_assessment_component").select("code, is_active");
  if (error) return null;
  return new Set((data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.code));
}
export async function checkComponent(admin: any, code: unknown): Promise<Fail | string> {
  const reg = await activeComponents(admin);
  if (!reg) return { ok: false, status: 503, error: "The assessment components could not be read just now. Nothing has changed." };
  if (typeof code !== "string" || !reg.has(code)) return { ok: false, status: 422, error: "Choose an active assessment component (section) for the criterion." };
  return code;
}

/** Whether a competency was ever put forward for clinical review. null = unreadable. Before 395: never. */
async function everPutForward(admin: any, competencyId: string): Promise<boolean | null> {
  const { data, error } = await admin.from("clinical_content_version").select("id").eq("competency_id", competencyId).limit(1);
  if (error) return missingTable(error) ? false : null;
  return (data ?? []).length > 0;
}

/** Whether the fingerprint covers retirement (the 761 marker). null = unreadable. A missing function = before 761. */
async function hashCoversRetirement(admin: any): Promise<boolean | null> {
  const { data, error } = await admin.rpc("competency_content_hash_covers_retirement");
  if (error) return ["PGRST202", "42883"].includes(String(error?.code ?? "")) ? false : null;
  return data === true;
}

async function renumber(admin: any, order: string[], rows: Pick<CriterionRow, "id" | "sort_order">[]): Promise<boolean> {
  const w = await writeSortOrders(admin, denseWrites(order, new Map(rows.map(r => [r.id, r.sort_order]))));
  return w.ok;
}

/** The published assessment methods that pin this criterion. null = unreadable. Before 690: none. */
export async function pinnedByActiveMethod(admin: any, criterionId: string): Promise<string[] | null> {
  const { data, error } = await admin.from("competency_verification_method_version").select("content, competency_verification_method(name)").eq("state", "published").limit(1000);
  if (error) return missingTable(error) || ["42703", "PGRST200"].includes(String(error?.code ?? "")) ? [] : null;
  return pinningMethods((data ?? []).map((m: any) => ({ content: m.content, name: m.competency_verification_method?.name ?? null })), criterionId);
}

// ── Actions (POST /api/hq/competency/authoring) ─────────────────────────────────────────────────────────────────

/** create_criterion { competencyId, component, text, sourceRef?, position? } */
export async function createCriterion(admin: any, actor: Actor, b: any): Promise<Result<{ id: string }>> {
  const t = parseCriterionText(b?.text);
  if (!t.ok) return { ok: false, status: 422, error: t.error };
  const sourceRef = parseSourceRef(b?.sourceRef), position = parsePosition(b?.position);
  if (sourceRef === undefined) return { ok: false, status: 422, error: "A source reference is at most 300 characters." };
  if (position === undefined) return { ok: false, status: 422, error: "The position is a whole number from 1." };
  const at = await draftCompetency(admin, b?.competencyId);
  if (!at.ok) return at;
  const component = await checkComponent(admin, b?.component);
  if (typeof component !== "string") return component;
  const rows = await criteriaOf(admin, at.comp.id);
  if (!rows) return UNREADABLE;
  const id = crypto.randomUUID();
  const order = placeCriterion(rows.map(r => ({ id: r.id, component: r.component_code })), { id, component }, position);
  if (!(await authored(admin, actor, "cfca_criterion_created", "framework_competency", at.comp.id, at.comp.name,
    { criterion_id: id, component, position, substantive: true, framework_id: at.fw.id }))) return NOT_RECORDED;
  const { error } = await admin.from("competency_skills").insert({
    id, competency_id: at.comp.id, name: t.value, component_code: component, source_ref: sourceRef, sort_order: order.indexOf(id) + 1, is_active: true,
  });
  if (error) return { ok: false, status: 422, error: "The criterion could not be created." };
  if (!(await renumber(admin, order, [...rows, { id, sort_order: order.indexOf(id) + 1 }]))) return { ok: false, status: 503, error: "The criterion was created, but the order of the others could not be updated. Reorder the section to tidy it." };
  return { ok: true, id };
}

/** update_criterion { criterionId, text?, sourceRef? } */
export async function updateCriterion(admin: any, actor: Actor, b: any): Promise<Result<{ unchanged: boolean }>> {
  const k = await criterion(admin, b?.criterionId);
  if (k === null) return { ok: false, status: 404, error: "That criterion does not exist." };
  if ("ok" in k) return k;
  const hasText = b && "text" in b, hasRef = b && "sourceRef" in b;
  if (!hasText && !hasRef) return { ok: false, status: 400, error: "Send the new text or source reference." };
  const t = hasText ? parseCriterionText(b.text) : null;
  if (t && !t.ok) return { ok: false, status: 422, error: t.error };
  const sourceRef = hasRef ? parseSourceRef(b.sourceRef) : k.source_ref;
  if (sourceRef === undefined) return { ok: false, status: 422, error: "A source reference is at most 300 characters." };
  const at = await draftCompetency(admin, k.competency_id);
  if (!at.ok) return at;
  if (k.is_active === false) return { ok: false, status: 409, error: "This criterion is retired. Restore it before editing it." };
  const text = t && t.ok ? t.value : k.name;
  const textChanged = text !== k.name, refChanged = (sourceRef ?? null) !== (k.source_ref ?? null);
  if (!textChanged && !refChanged) return { ok: true, unchanged: true };
  if (!(await authored(admin, actor, "cfca_criterion_updated", "framework_competency", at.comp.id, at.comp.name,
    { criterion_id: k.id, text_changed: textChanged, source_changed: refChanged, substantive: textChanged, framework_id: at.fw.id }))) return NOT_RECORDED;
  const { error } = await admin.from("competency_skills").update({ name: text, source_ref: sourceRef }).eq("id", k.id);
  return error ? { ok: false, status: 422, error: "The criterion could not be saved." } : { ok: true, unchanged: false };
}

async function setActive(admin: any, actor: Actor, b: any, active: boolean): Promise<Result<{ unchanged: boolean }>> {
  const k = await criterion(admin, b?.criterionId);
  if (k === null) return { ok: false, status: 404, error: "That criterion does not exist." };
  if ("ok" in k) return k;
  const at = await draftCompetency(admin, k.competency_id);
  if (!at.ok) return at;
  if ((k.is_active !== false) === active) return { ok: true, unchanged: true };
  if (!active) {
    // FDS-02 (coordinator, D3): a criterion a PUBLISHED assessment method pins (690 criterionId) is not retired under it.
    const pins = await pinnedByActiveMethod(admin, k.id);
    if (pins === null) return { ok: false, status: 503, error: "The assessment methods could not be checked just now. Nothing has changed." };
    if (pins.length) return { ok: false, status: 409, error: `This criterion is used by the published assessment method ${pins.join(", ")}. Remove it from the method first.` };
  }
  const put = await everPutForward(admin, at.comp.id);
  if (put === null) return { ok: false, status: 503, error: "The clinical review record could not be read just now. Nothing has changed." };
  if (put) {
    const covers = await hashCoversRetirement(admin);
    if (covers === null) return { ok: false, status: 503, error: "The clinical fingerprint could not be checked just now. Nothing has changed." };
    if (!covers) return { ok: false, status: 409, error: `This competency has been put forward for clinical review, and its fingerprint does not yet cover ${active ? "restoring" : "retiring"} a criterion, so it is not ${active ? "restored" : "retired"} here. Edit the criterion's text, or move it, instead.` };
  }
  // Substantive either way (D3). With 761 the fingerprint changes, so a reviewed competency goes back to clinical review.
  if (!(await authored(admin, actor, active ? "cfca_criterion_restored" : "cfca_criterion_retired", "framework_competency", at.comp.id, at.comp.name,
    { criterion_id: k.id, substantive: true, clinical_review: put, framework_id: at.fw.id }))) return NOT_RECORDED;
  const { error } = await admin.from("competency_skills").update({ is_active: active }).eq("id", k.id);
  return error ? { ok: false, status: 422, error: `The criterion could not be ${active ? "restored" : "retired"}.` } : { ok: true, unchanged: false };
}
/** retire_criterion { criterionId }: is_active false. The row, its history and its evidence stay. */
export const retireCriterion = (admin: any, actor: Actor, b: any) => setActive(admin, actor, b, false);
/** restore_criterion { criterionId } */
export const restoreCriterion = (admin: any, actor: Actor, b: any) => setActive(admin, actor, b, true);

export type MoveResult = Result<{ kind: ReturnType<typeof classifyMove>; substantive: boolean; mode?: "direct" | "draft"; unchanged?: boolean }>;

/** move_criterion { criterionId, component?, competencyId?, position? } */
export async function moveCriterion(admin: any, actor: Actor, b: any): Promise<MoveResult> {
  const k = await criterion(admin, b?.criterionId);
  if (k === null) return { ok: false, status: 404, error: "That criterion does not exist." };
  if ("ok" in k) return k;
  const position = parsePosition(b?.position);
  if (position === undefined) return { ok: false, status: 422, error: "The position is a whole number from 1." };
  const from = await draftCompetency(admin, k.competency_id);
  if (!from.ok) return from;
  const toId = b?.competencyId == null || b.competencyId === "" ? k.competency_id : b.competencyId;
  const to = toId === k.competency_id ? from : await draftCompetency(admin, toId);
  if (!to.ok) return to;
  if (to.fw.id !== from.fw.id) return { ok: false, status: 422, error: "A criterion moves only to a competency of its own framework." };
  const component = b && "component" in b && b.component != null ? b.component : k.component_code;
  const kind = classifyMove({ competencyId: k.competency_id, component: k.component_code }, { competencyId: to.comp.id, component });
  if (kind === "reorder") {
    // Organisational: exactly the reorder the Studio already makes (F4: not authorship, layout draft once published).
    const rows = await criteriaOf(admin, k.competency_id);
    if (!rows) return UNREADABLE;
    const section = rows.filter(r => (r.component_code ?? null) === (k.component_code ?? null)).map(r => ({ id: r.id, component: r.component_code }));
    const order = placeCriterion(section, { id: k.id, component: k.component_code }, position);
    const r = await reorderLayout(admin, actor, { frameworkId: from.fw.id, level: "criteria", parentId: k.competency_id, component: k.component_code, order });
    return r.ok ? { ok: true, kind, substantive: false, mode: r.mode, unchanged: r.unchanged } : r;
  }
  if (k.is_active === false) return { ok: false, status: 409, error: "This criterion is retired. Restore it before moving it." };
  const checked = await checkComponent(admin, component);
  if (typeof checked !== "string") return checked;
  if (to.comp.id !== k.competency_id) {
    // 752 refuses a publication whose pending layout names a criterion under a competency it no longer belongs to.
    const pl = await pendingLayout(admin, from.fw.id);
    if (pl && "ok" in pl) return pl;
    if (pl && (pl.layout.criteria?.[k.competency_id] ?? []).includes(k.id))
      return { ok: false, status: 409, error: "A pending layout names this criterion in its current competency. Discard the pending layout first, then move it." };
  }
  const [src, dst] = await Promise.all([criteriaOf(admin, k.competency_id), to.comp.id === k.competency_id ? Promise.resolve(null) : criteriaOf(admin, to.comp.id)]);
  if (!src || (to.comp.id !== k.competency_id && !dst)) return UNREADABLE;
  const target = dst ?? src;
  const order = placeCriterion(target.map(r => ({ id: r.id, component: r.component_code })), { id: k.id, component: checked }, position);
  const detail = { criterion_id: k.id, substantive: true, kind, from: { competency_id: k.competency_id, component: k.component_code }, to: { competency_id: to.comp.id, component: checked }, position, framework_id: from.fw.id };
  // Authorship on every competency whose content changes, all before the write.
  if (!(await authored(admin, actor, "cfca_criterion_moved", "framework_competency", from.comp.id, from.comp.name, detail))) return NOT_RECORDED;
  if (to.comp.id !== from.comp.id && !(await authored(admin, actor, "cfca_criterion_moved", "framework_competency", to.comp.id, to.comp.name, detail))) return NOT_RECORDED;
  const { error } = await admin.from("competency_skills").update({ competency_id: to.comp.id, component_code: checked, sort_order: order.indexOf(k.id) + 1 }).eq("id", k.id);
  if (error) return { ok: false, status: 422, error: "The criterion could not be moved." };
  const okTo = await renumber(admin, order, target.map(r => (r.id === k.id ? { ...r, sort_order: order.indexOf(k.id) + 1 } : r)));
  const okFrom = dst ? await renumber(admin, src.filter(r => r.id !== k.id).map(r => r.id), src) : true;
  if (!okTo || !okFrom) return { ok: false, status: 503, error: "The criterion was moved, but the order of the others could not be updated. Reorder the section to tidy it." };
  return { ok: true, kind, substantive: true };
}
