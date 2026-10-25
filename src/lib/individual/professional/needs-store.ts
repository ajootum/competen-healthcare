/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import type { CatalogueCompetency } from "../catalogue";
import type { NeedColumns } from "./needs-form";
import type { NeedStage, SuggestionDecision } from "./needs-vocabulary";
import { ORIGIN } from "./vocabulary";

// ── DEVELOPMENT NEEDS, READ AND WRITTEN ── COMPETEN-PROFESSIONAL-NEEDS-01, migration 470 ─────────────────────────
//
// THE ONE WRITER of 470's tables and Stage 2 need columns, by the person's own id. The 373 need is still the record:
// this widens what is written to it. The need history is the 470 TRIGGER's, never written here.
//
// ⚠ NOT PROVISIONED IS NOT UNREADABLE. Before 470 is applied, `provisioned` is false and the workspace shows the
// MVP needs exactly as before. A failed read is null, and the page says it could not be checked.
//
// ⚠ NEVER A DEFICIENCY. Nothing here infers a need from missing evidence, a result or feedback. A need exists only
// because the person recorded it, or accepted a suggestion that says why it was made.

const NEED_COLUMNS = "id, title, detail, origin, status, stage_code, priority_code, priority_label, category_code, category_label, motivation_code, motivation_label, "
  + "why_it_matters, professional_context, development_interests, source_note, created_via, reflection_id, aspiration_item_id, reviewed_at, "
  + "framework_id, framework_competency_id, created_at, updated_at, closed_at";

export type StageTwoNeed = {
  id: string; title: string; detail: string | null; origin: string; status: string; stage_code: NeedStage;
  priority_code: string | null; priority_label: string | null; category_code: string | null; category_label: string | null;
  motivation_code: string | null; motivation_label: string | null; why_it_matters: string | null; professional_context: string | null;
  development_interests: string | null; source_note: string | null; created_via: string; reflection_id: string | null; aspiration_item_id: string | null;
  reviewed_at: string | null; framework_id: string | null; framework_competency_id: string | null; created_at: string; updated_at: string; closed_at: string | null;
};
export type NeedHistoryRow = { need_id: string; title: string; detail: string | null; stage_code: string | null; priority_label: string | null; category_label: string | null; recorded_at: string };
export type NeedCompetencyLink = { id: string; need_id: string; framework_id: string; framework_competency_id: string; framework_version: string | null; learning_outcome: string | null; linked_at: string; unlinked_at: string | null };
export type Reflection = { id: string; template_label: string | null; body: string; created_at: string; updated_at: string };
export type Suggestion = { id: string; source: "ai" | "rule"; rule_key: string | null; title: string; basis: string; status: string; accepted_need_id: string | null; decided_at: string | null; created_at: string };

export type NeedsWorkspace = {
  provisioned: boolean;
  needs: StageTwoNeed[] | null; history: NeedHistoryRow[] | null; competencies: NeedCompetencyLink[] | null;
  goalLinks: { goal_id: string; need_id: string }[] | null; reflections: Reflection[] | null; suggestions: Suggestion[] | null;
};

export async function loadNeedsWorkspace(admin: any, userId: string): Promise<NeedsWorkspace> {
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try {
      const r = await p;
      if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; }
      return r?.error ? null : (r?.data ?? []);
    } catch { return null; }
  };
  const [needs, history, competencies, goalLinks, reflections, suggestions] = await Promise.all([
    settle(admin.from("individual_professional_need").select(NEED_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(500)),
    settle(admin.from("individual_professional_need_history").select("need_id, title, detail, stage_code, priority_label, category_label, recorded_at").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(3000)),
    settle(admin.from("individual_professional_need_competency").select("id, need_id, framework_id, framework_competency_id, framework_version, learning_outcome, linked_at, unlinked_at").eq("user_id", userId).order("linked_at").limit(3000)),
    settle(admin.from("individual_professional_goal_need").select("goal_id, need_id").eq("user_id", userId).limit(3000)),
    settle(admin.from("individual_professional_reflection").select("id, template_label, body, created_at, updated_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(500)),
    settle(admin.from("individual_professional_need_suggestion").select("id, source, rule_key, title, basis, status, accepted_need_id, decided_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(500)),
  ]);
  if (!provisioned) return { provisioned, needs: [], history: [], competencies: [], goalLinks: [], reflections: [], suggestions: [] };
  return { provisioned, needs, history, competencies, goalLinks, reflections, suggestions };
}

type Write = { ok: true; id: string | null } | { ok: false; status: number; error: string };
const failed = (what: string, error?: any): Write => isNotProvisioned(error)
  ? { ok: false, status: 409, error: "Development needs are not set up on this environment yet." }
  : { ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` };

/** A new need. Only the title is required. `link` names the reflection or aspiration it came from, if any. */
export async function createNeed(admin: any, userId: string, cols: Partial<NeedColumns>, opts: {
  createdVia?: "person" | "ai_suggestion" | "rule_suggestion"; reflectionId?: string | null; aspirationItemId?: string | null; stage?: NeedStage;
} = {}): Promise<Write> {
  const origin = opts.reflectionId ? "reflection" : opts.aspirationItemId ? "aspiration" : cols.origin ?? "self_identified";
  const { data, error } = await admin.from("individual_professional_need").insert({
    ...cols, origin, user_id: userId, experience_code: ORIGIN, created_via: opts.createdVia ?? "person",
    reflection_id: opts.reflectionId ?? null, aspiration_item_id: opts.aspirationItemId ?? null, stage_code: opts.stage ?? "identified",
  }).select("id").single();
  return error || !data ? failed("development need", error) : { ok: true, id: data.id };
}

/** Edit a need, change its stage or priority, or mark it reviewed. The 470 triggers keep status and history. */
export async function updateNeed(admin: any, userId: string, id: string, patch: Partial<NeedColumns> & { stage_code?: NeedStage; reviewed?: boolean }): Promise<Write> {
  const { reviewed, ...cols } = patch;
  const now = new Date().toISOString();
  const { data, error } = await admin.from("individual_professional_need")
    .update({ ...cols, ...(reviewed ? { reviewed_at: now } : {}), updated_at: now }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("development need", error);
  return data ? { ok: true, id } : { ok: false, status: 404, error: "That need is not on your record." };
}

/** The framework version a link records: "v<major>.<minor>.<revision>" of the catalogue, as offered now. */
export const versionOf = (c: Pick<CatalogueCompetency, "catalogue">) => c.catalogue.version ? `v${c.catalogue.version.replace(/^v/i, "")}` : null;

/** Link a need to an OFFERED competency (the Professional allowlist). Anything not offered is refused. */
export async function linkCompetency(admin: any, userId: string, needId: string, competencyId: string, offered: readonly CatalogueCompetency[], outcome: string | null): Promise<Write> {
  const c = offered.find(x => x.competencyId === competencyId);
  if (!c) return { ok: false, status: 400, error: "That competency is not one Competen Professional offers." };
  const { data: open } = await admin.from("individual_professional_need_competency").select("id").eq("need_id", needId).eq("user_id", userId)
    .eq("framework_competency_id", competencyId).is("unlinked_at", null).limit(1);
  if ((open ?? []).length) return { ok: false, status: 409, error: "That competency is already linked." };
  if (outcome && !c.outcomes.includes(outcome)) return { ok: false, status: 400, error: "Choose a learning outcome of that competency." };
  const { data, error } = await admin.from("individual_professional_need_competency").insert({
    need_id: needId, user_id: userId, framework_id: c.catalogue.id, framework_competency_id: competencyId, framework_version: versionOf(c), learning_outcome: outcome,
  }).select("id").single();
  return error || !data ? failed("link", error) : { ok: true, id: data.id };
}

/** Unlink: kept as history (470 allows setting unlinked_at once, nothing else). */
export async function unlinkCompetency(admin: any, userId: string, linkId: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_need_competency").update({ unlinked_at: new Date().toISOString() })
    .eq("id", linkId).eq("user_id", userId).is("unlinked_at", null).select("id").maybeSingle();
  if (error) return failed("change", error);
  return data ? { ok: true, id: linkId } : { ok: false, status: 404, error: "That link is not current." };
}

/** Link a goal to a need (many to many). Both must be the person's own: 470's composite keys refuse otherwise. */
export async function linkGoal(admin: any, userId: string, goalId: string, needId: string): Promise<Write> {
  const { error } = await admin.from("individual_professional_goal_need").insert({ goal_id: goalId, need_id: needId, user_id: userId });
  if (error && String(error.code) === "23505") return { ok: true, id: null };
  return error ? (String(error.code) === "23503" ? { ok: false, status: 404, error: "That goal or need is not on your record." } : failed("link", error)) : { ok: true, id: null };
}
export async function unlinkGoal(admin: any, userId: string, goalId: string, needId: string): Promise<Write> {
  const { error } = await admin.from("individual_professional_goal_need").delete().eq("goal_id", goalId).eq("need_id", needId).eq("user_id", userId);
  return error ? failed("change", error) : { ok: true, id: null };
}

/** A private reflection: new, or edited in place (it is the person's own text, never shared). */
export async function saveReflection(admin: any, userId: string, id: string | null, v: { body: string; template_code: string | null; template_label: string | null }): Promise<Write> {
  if (id) {
    const { data, error } = await admin.from("individual_professional_reflection").update({ ...v, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", userId).select("id").maybeSingle();
    if (error) return failed("reflection", error);
    return data ? { ok: true, id } : { ok: false, status: 404, error: "That reflection is not yours." };
  }
  const { data, error } = await admin.from("individual_professional_reflection").insert({ ...v, user_id: userId, experience_code: ORIGIN }).select("id").single();
  return error || !data ? failed("reflection", error) : { ok: true, id: data.id };
}
export async function reflectionOf(admin: any, userId: string, id: string): Promise<Reflection | null> {
  const { data } = await admin.from("individual_professional_reflection").select("id, template_label, body, created_at, updated_at").eq("id", id).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/** AI suggestions, stored PRIVATE and undecided. They are never needs until accepted. */
export async function saveAiSuggestions(admin: any, userId: string, items: { title: string; basis: string }[], model: string | null): Promise<Write> {
  if (!items.length) return { ok: true, id: null };
  const { error } = await admin.from("individual_professional_need_suggestion")
    .insert(items.map(i => ({ user_id: userId, experience_code: ORIGIN, source: "ai", title: i.title, basis: i.basis, model })));
  return error ? failed("suggestions", error) : { ok: true, id: null };
}

/** A decision on a stored AI suggestion, or on a rule suggestion (stored now, so it is remembered). */
export async function decideSuggestion(admin: any, userId: string, d: {
  suggestionId?: string | null; rule?: { key: string; title: string; basis: string } | null; decision: SuggestionDecision; acceptedNeedId?: string | null;
}): Promise<Write> {
  const now = new Date().toISOString();
  if (d.suggestionId) {
    const { data, error } = await admin.from("individual_professional_need_suggestion")
      .update({ status: d.decision, decided_at: now, accepted_need_id: d.acceptedNeedId ?? null })
      .eq("id", d.suggestionId).eq("user_id", userId).eq("status", "suggested").select("id").maybeSingle();
    if (error) return failed("decision", error);
    return data ? { ok: true, id: data.id } : { ok: false, status: 404, error: "That suggestion has already been decided." };
  }
  if (!d.rule) return { ok: false, status: 400, error: "Choose a suggestion." };
  const { data, error } = await admin.from("individual_professional_need_suggestion").insert({
    user_id: userId, experience_code: ORIGIN, source: "rule", rule_key: d.rule.key, title: d.rule.title, basis: d.rule.basis,
    status: d.decision, decided_at: now, accepted_need_id: d.acceptedNeedId ?? null,
  }).select("id").single();
  return error || !data ? failed("decision", error) : { ok: true, id: data.id };
}

// ── RULE SUGGESTIONS: DETERMINISTIC, FROM THE PERSON'S OWN RECORD, NEVER A DEFICIENCY ─────────────────────────────

export type RuleSuggestion = { key: string; title: string; basis: string; aspirationItemId: string | null };

/**
 * Pure: suggestions from the person's own career aspirations (450) with no need yet, and registrations or
 * qualifications they recorded as expiring within `windowDays`. A rule already accepted or dismissed is not offered
 * again, and a deferred one returns after `windowDays`. Nothing here reads results, feedback or missing evidence.
 */
export function ruleSuggestions(input: {
  items: readonly { id: string; section: string; title: string; expires_on: string | null; superseded_at: string | null; withdrawn_at: string | null }[];
  needs: readonly { aspiration_item_id: string | null; title: string }[];
  decided: readonly { rule_key: string | null; status: string; decided_at: string | null }[];
  today: string; windowDays: number;
}): RuleSuggestion[] {
  const out: RuleSuggestion[] = [];
  const asked = new Set(input.needs.map(n => n.aspiration_item_id).filter(Boolean));
  const titles = new Set(input.needs.map(n => n.title.toLowerCase()));
  const horizon = new Date(Date.parse(`${input.today}T00:00:00Z`) + input.windowDays * 864e5).toISOString().slice(0, 10);
  for (const i of input.items) {
    if (i.superseded_at || i.withdrawn_at) continue;
    if (i.section === "aspiration" && !asked.has(i.id))
      out.push({ key: `aspiration:${i.id}`, title: `Work towards: ${i.title}`.slice(0, 200), basis: `Your career aspiration "${i.title}" has no development need yet.`, aspirationItemId: i.id });
    if ((i.section === "registration" || i.section === "qualification") && i.expires_on && i.expires_on >= input.today && i.expires_on <= horizon)
      out.push({ key: `renewal:${i.id}:${i.expires_on}`, title: `Prepare to renew: ${i.title}`.slice(0, 200), basis: `You recorded "${i.title}" as expiring on ${i.expires_on}.`, aspirationItemId: null });
  }
  const latest = new Map<string, { status: string; decided_at: string | null }>();
  for (const d of input.decided) if (d.rule_key) latest.set(d.rule_key, d);
  return out.filter(s => {
    if (titles.has(s.title.toLowerCase())) return false;
    const d = latest.get(s.key);
    if (!d) return true;
    if (d.status !== "deferred" || !d.decided_at) return false;
    return new Date(Date.parse(d.decided_at) + input.windowDays * 864e5).toISOString().slice(0, 10) <= input.today;
  });
}
