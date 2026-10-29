/* eslint-disable @typescript-eslint/no-explicit-any */

// ── CCHU ASSESSMENT COMPONENTS ── CFCA-STUDIO-P1, migration 660 ───────────────────────────────────────────
//
// A competency in a programme framework can be assessed in COMPONENTS -- Clinical Skills, Knowledge, Knowledge
// Application, or any other row of competency_assessment_component (configuration, not code). Which components
// apply to a competency, and what each must reach, is set per programme catalogue entry
// (competency_catalogue_entry_component), so the same shared competency can ask more of a Master's programme
// than of an Enrolled one without being defined twice.
//
// ⚠ THE ROLL-UP RULE (owner, CFCA-STUDIO-P1 item 8). A weighted average NEVER overrides a failed mandatory or
// safety-critical component. A competency is achieved only when every mandatory component reaches its pass
// level AND, where the programme sets a target, the weighted level of the assessed components reaches it.
// A mandatory component not yet assessed leaves the result incomplete -- never passed by default.
//
// ⚠ CONFIGURATION ONLY IN THIS PHASE. No assessment decision reads this yet: clinical verification stays OFF
// until assessors and assessment-method governance are in place. componentOutcome is the rule the verification
// path will call, proven here by unit tests.
//
// ⚠ FROZEN WITH ITS CATALOGUE. The 660 trigger refuses any change to a component requirement once the catalogue
// is in review or published, exactly like the entry it belongs to.

export type ComponentDef = { code: string; label: string; description: string | null; sortOrder: number; active: boolean };
export type Level = { id: string; scaleId: string; score: number; label: string };
export type ComponentRequirement = {
  code: string;
  /** The level this component must reach. Null: the competency's target level in the programme. */
  passLevel: { id: string; score: number; label: string } | null;
  mandatory: boolean;
  safetyCritical: boolean;
  /** Relative weight in the overall level. Null counts as 1. */
  weight: number | null;
};
/** One component's assessed level. Null score: not assessed yet. */
export type ComponentResult = { code: string; score: number | null };
export type ComponentOutcome = {
  status: "achieved" | "not_achieved" | "incomplete";
  /** The weighted level of the assessed components, rounded down. Null when none is assessed. Never a pass on its own. */
  overall: number | null;
  failedMandatory: string[];
  failedSafetyCritical: string[];
  missingMandatory: string[];
  reasons: string[];
};

/** Pure: the outcome of one competency from its component results (the rule above). */
export function componentOutcome(reqs: readonly ComponentRequirement[], results: readonly ComponentResult[], target: number | null): ComponentOutcome {
  const got = new Map(results.map(r => [r.code, r.score]));
  const failedMandatory: string[] = [], failedSafetyCritical: string[] = [], missingMandatory: string[] = [], reasons: string[] = [];
  let sum = 0, weights = 0;
  for (const r of reqs) {
    const score = got.get(r.code) ?? null;
    const pass = r.passLevel?.score ?? target;
    if (score === null) {
      if (r.mandatory) { missingMandatory.push(r.code); reasons.push(`${r.code} is mandatory and not yet assessed.`); }
      continue;
    }
    // Weights are kept to two decimal places (660 numeric(5,2), 680 method content), so they are summed in
    // hundredths: exact integer arithmetic, and the same result as the database (680 competency_component_outcome).
    const w = Math.round((r.weight ?? 1) * 100);
    sum += score * w; weights += w;
    if (pass === null) {
      if (r.mandatory) { missingMandatory.push(r.code); reasons.push(`${r.code} has no pass level and the programme sets no target.`); }
      continue;
    }
    if (score < pass && r.mandatory) {
      failedMandatory.push(r.code);
      if (r.safetyCritical) { failedSafetyCritical.push(r.code); reasons.push(`${r.code} is safety-critical and below its pass level (${score} < ${pass}).`); }
      else reasons.push(`${r.code} is mandatory and below its pass level (${score} < ${pass}).`);
    }
  }
  const overall = weights > 0 ? Math.floor(sum / weights) : null;
  if (failedMandatory.length) return { status: "not_achieved", overall, failedMandatory, failedSafetyCritical, missingMandatory, reasons };
  if (missingMandatory.length) return { status: "incomplete", overall, failedMandatory, failedSafetyCritical, missingMandatory, reasons };
  if (overall === null) return { status: "incomplete", overall, failedMandatory, failedSafetyCritical, missingMandatory, reasons: ["No component is assessed yet."] };
  if (target !== null && overall < target) {
    reasons.push(`The weighted level ${overall} is below the target ${target}.`);
    return { status: "not_achieved", overall, failedMandatory, failedSafetyCritical, missingMandatory, reasons };
  }
  return { status: "achieved", overall, failedMandatory, failedSafetyCritical, missingMandatory, reasons };
}

const CODE = /^[a-z][a-z0-9_]{2,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Refusal = { ok: false; error: string };

/** Pure: a registry row from HQ, or why it is refused. Mirrors the 660 CHECK. */
export function checkComponentDef(body: any): { ok: true; def: ComponentDef } | Refusal {
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!CODE.test(code)) return { ok: false, error: "The code is 3 to 41 lower-case letters, digits or underscores, starting with a letter." };
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (label.length < 2 || label.length > 80) return { ok: false, error: "The name is 2 to 80 characters." };
  const description = typeof body?.description === "string" && body.description.trim() ? body.description.trim() : null;
  if (description && description.length > 500) return { ok: false, error: "Keep the description under 500 characters." };
  const sortOrder = Number.isInteger(body?.sortOrder) ? body.sortOrder : 0;
  return { ok: true, def: { code, label, description, sortOrder, active: body?.active !== false } };
}

/** Pure: the component requirements HQ sets on one entry, or why they are refused. Mirrors the 660 CHECK and keys. */
export function checkRequirements(body: unknown, registry: readonly ComponentDef[], levels: readonly Level[]):
  { ok: true; reqs: { code: string; passLevelId: string | null; mandatory: boolean; safetyCritical: boolean; weight: number | null }[] } | Refusal {
  if (!Array.isArray(body)) return { ok: false, error: "Send the components as a list." };
  const known = new Map(registry.map(c => [c.code, c]));
  const levelIds = new Set(levels.map(l => l.id));
  const seen = new Set<string>();
  const reqs = [];
  for (const r of body as any[]) {
    const code = typeof r?.code === "string" ? r.code : "";
    const def = known.get(code);
    if (!def) return { ok: false, error: "Each component must be one from the registry." };
    if (!def.active) return { ok: false, error: `${def.label} is retired and cannot be required.` };
    if (seen.has(code)) return { ok: false, error: `${def.label} is listed twice.` };
    seen.add(code);
    const passLevelId = r?.passLevelId ? String(r.passLevelId).toLowerCase() : null;
    if (passLevelId && (!UUID.test(passLevelId) || !levelIds.has(passLevelId))) return { ok: false, error: `Choose ${def.label}'s pass level from the scale.` };
    const safetyCritical = r?.safetyCritical === true;
    const mandatory = r?.mandatory !== false || safetyCritical;
    const weight = r?.weight === null || r?.weight === undefined || r?.weight === "" ? null : Number(r.weight);
    if (weight !== null && !(Number.isFinite(weight) && weight > 0 && weight <= 100)) return { ok: false, error: `${def.label}'s weight is a number above 0 and at most 100, or blank.` };
    reqs.push({ code, passLevelId, mandatory, safetyCritical, weight });
  }
  return { ok: true, reqs };
}

/** Pure: the database refusal, in words. */
export function componentRefusal(message: string | undefined): string {
  if (/frozen/i.test(message ?? "")) return "This catalogue is in review or published, so its component requirements are frozen. Start a new draft version to change them.";
  return "The component requirements could not be saved just now. Nothing has changed.";
}

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

/** The component registry, in order. null = unreadable (or 660 not applied). */
export async function listComponents(admin: any): Promise<ComponentDef[] | null> {
  const data = await rows(admin.from("competency_assessment_component").select("code, label, description, sort_order, is_active").order("sort_order"));
  return data === null ? null : data.map((c: any) => ({ code: c.code, label: c.label, description: c.description ?? null, sortOrder: c.sort_order ?? 0, active: c.is_active !== false }));
}

export async function upsertComponent(admin: any, def: ComponentDef): Promise<{ ok: true } | Refusal> {
  const { error } = await admin.from("competency_assessment_component").upsert({
    code: def.code, label: def.label, description: def.description, sort_order: def.sortOrder, is_active: def.active, updated_at: new Date().toISOString(),
  }, { onConflict: "code" });
  return error ? { ok: false, error: "The component could not be saved just now." } : { ok: true };
}

/** How many catalogue entries require each component (so a retirement is made knowingly). */
export async function componentUsage(admin: any): Promise<Map<string, number> | null> {
  const data = await rows(admin.from("competency_catalogue_entry_component").select("component_code"));
  if (data === null) return null;
  const m = new Map<string, number>();
  for (const r of data) m.set(r.component_code, (m.get(r.component_code) ?? 0) + 1);
  return m;
}

/** The component requirements of some entries. null = unreadable. */
export async function loadEntryComponents(admin: any, entryIds: readonly string[], levels: ReadonlyMap<string, Level>): Promise<Map<string, ComponentRequirement[]> | null> {
  const out = new Map<string, ComponentRequirement[]>();
  if (!entryIds.length) return out;
  const data = await rows(admin.from("competency_catalogue_entry_component")
    .select("entry_id, component_code, pass_level_id, is_mandatory, is_safety_critical, weight, sort_order").in("entry_id", [...entryIds]).order("sort_order"));
  if (data === null) return null;
  for (const r of data) {
    const l = r.pass_level_id ? levels.get(r.pass_level_id) : undefined;
    out.set(r.entry_id, [...(out.get(r.entry_id) ?? []), {
      code: r.component_code, passLevel: l ? { id: l.id, score: l.score, label: l.label } : null,
      mandatory: r.is_mandatory !== false, safetyCritical: r.is_safety_critical === true, weight: r.weight === null ? null : Number(r.weight),
    }]);
  }
  return out;
}

/** Replace one entry's component requirements. The 660 trigger refuses it outside draft. */
export async function replaceEntryComponents(admin: any, entryId: string,
  reqs: { code: string; passLevelId: string | null; mandatory: boolean; safetyCritical: boolean; weight: number | null }[]): Promise<{ ok: true } | Refusal> {
  const del = await admin.from("competency_catalogue_entry_component").delete().eq("entry_id", entryId);
  if (del.error) return { ok: false, error: componentRefusal(del.error.message) };
  if (!reqs.length) return { ok: true };
  const ins = await admin.from("competency_catalogue_entry_component").insert(reqs.map((r, i) => ({
    entry_id: entryId, component_code: r.code, pass_level_id: r.passLevelId, is_mandatory: r.mandatory, is_safety_critical: r.safetyCritical, weight: r.weight, sort_order: i,
  })));
  if (ins.error) return { ok: false, error: /frozen/i.test(ins.error.message ?? "") ? componentRefusal(ins.error.message) : "The components were cleared but could not be saved. Save them again." };
  return { ok: true };
}
