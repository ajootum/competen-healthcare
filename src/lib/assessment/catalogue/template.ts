/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Create from template: a new instrument whose first draft is a copy of an authorised (published) version of another
 * instrument, with the provenance kept as an adapted_from relation and a catalogue event. Server only.
 *
 * It copies through the Studio writers (createFirstVersion, saveSettings, saveContent, saveScoring, saveLayouts, saveTags)
 * so the copy is an ordinary draft: same guard, same review, same publication. Item stable keys are new (a new
 * instrument has its own identity), everything else, including criterion mappings, is carried over.
 */
import { randomUUID } from "node:crypto";
import { loadInstrumentVersion } from "../studio/read";
import { createFirstVersion, saveContent, saveLayouts, saveScoring, saveSettings, saveTags } from "../studio/write";
import { registerInstrument } from "./register";
import { setRelation } from "./relations";
import { must, type Admin, type Row } from "./db";

export type TemplateChoice = { instrumentId: string; code: string; name: string; familyCode: string | null; versionId: string; versionNo: number; items: number };

/** Instruments with a published version, newest first. */
export async function listTemplates(admin: Admin): Promise<TemplateChoice[]> {
  const versions = (must(await admin.from("asmt_instrument_version").select("id, instrument_id, version_no, published_at").eq("state", "published").order("published_at", { ascending: false }).limit(500), "templates") ?? []) as Row[];
  if (!versions.length) return [];
  const ids = [...new Set(versions.map((v) => v.instrument_id as string))];
  const [ins, counts] = await Promise.all([
    admin.from("asmt_instrument").select("id, code, name, family_code").in("id", ids),
    admin.from("asmt_item").select("version_id").in("version_id", versions.map((v) => v.id)).limit(20000),
  ]);
  const by = new Map(((ins.data ?? []) as Row[]).map((i) => [i.id as string, i]));
  const n = new Map<string, number>();
  for (const r of (counts.data ?? []) as Row[]) n.set(r.version_id, (n.get(r.version_id) ?? 0) + 1);
  const seen = new Set<string>();
  const out: TemplateChoice[] = [];
  for (const v of versions) {
    if (seen.has(v.instrument_id)) continue;
    seen.add(v.instrument_id);
    const i = by.get(v.instrument_id);
    if (i) out.push({ instrumentId: i.id, code: i.code, name: i.name, familyCode: i.family_code ?? null, versionId: v.id, versionNo: v.version_no, items: n.get(v.id) ?? 0 });
  }
  return out;
}

export type FromTemplateInput = { templateVersionId: string; family: string; name: string; description: string | null; terms: { termId: string; isPrimary: boolean }[] };

export async function createFromTemplate(admin: Admin, actorId: string, input: FromTemplateInput): Promise<{ ok: true; instrumentId: string; code: string; versionId: string; warnings: string[] } | { ok: false; status: number; error: string }> {
  const src = await loadInstrumentVersion(admin, input.templateVersionId);
  if (!src) return { ok: false, status: 404, error: "That template does not exist." };
  if (src.version.state !== "published") return { ok: false, status: 422, error: "Only a published version can be used as a template." };
  const v = src.version;
  const warnings: string[] = [];

  const made = await registerInstrument(admin, actorId, { family: input.family, name: input.name, description: input.description, kind: src.instrument.kind, terms: input.terms });
  const first = await createFirstVersion(admin, actorId, made.id, { purpose: v.purpose_code, methods: v.method_codes ?? [], deliveryModes: v.delivery_modes ?? [], respondentRoles: v.respondent_roles ?? ["self"] });
  if (!first.ok) return { ok: false, status: first.status, error: `${first.error} The instrument ${made.code} was registered without a version.` };
  const versionId = first.versionId;

  const st = await saveSettings(admin, actorId, versionId, {
    title: input.name, summary: v.summary, requires_domain_review: v.requires_domain_review, assess_capability: v.assess_capability, assign_capability: v.assign_capability,
    evidence_policy: v.evidence_policy ?? {}, effective_from: null, review_due: null,
  });
  if (!st.ok) warnings.push(`Settings were not copied: ${st.error}`);

  // new keys for the copy, old keys remapped for section parents and item sections
  const key = new Map<string, string>();
  const k = (old: string) => { let n = key.get(old); if (!n) { n = randomUUID(); key.set(old, n); } return n; };
  const content = {
    groups: src.content.groups.map((g) => ({ ...g })),
    sections: src.content.sections.map((s) => ({ ...s, stable_key: k(s.stable_key), parent_section_key: s.parent_section_key ? k(s.parent_section_key) : null })),
    items: src.content.items.map((i) => ({ ...i, stable_key: k(i.stable_key), section_key: k(i.section_key), fields: (i.fields ?? []).map((f) => ({ ...f })) })),
  };
  const sc = await saveContent(admin, actorId, versionId, content);
  if (!sc.ok) return { ok: false, status: sc.status, error: `${sc.error} The instrument ${made.code} was registered with an empty draft.` };

  const rules = v.scoring as any;
  if (rules && Array.isArray(rules.outcomes)) {
    const r = await saveScoring(admin, actorId, versionId, v.scoring, (v.scoring_tests ?? []) as unknown[], v.scoring_template_version_id);
    if (!r.ok) warnings.push(`Scoring rules were not copied: ${r.error}`);
  }
  if (v.default_layout_version_id || src.allowedLayoutIds.length) {
    const l = await saveLayouts(admin, actorId, versionId, v.default_layout_version_id, src.allowedLayoutIds);
    if (!l.ok) warnings.push(`Layouts were not copied: ${l.error}`);
  }
  if (src.tagTermIds.length) {
    const t = await saveTags(admin, actorId, versionId, src.tagTermIds);
    if (!t.ok) warnings.push(`Tags were not copied: ${t.error}`);
  }
  await setRelation(admin, actorId, made.id, src.instrument.id, "adapted_from", `Created from ${src.instrument.code} v${v.version_no}`, false);
  await admin.rpc("asmt_catalogue_event", { p_instrument: made.id, p_event: "catalogue_from_template", p_actor: actorId, p_detail: { template_instrument_id: src.instrument.id, template_version_id: v.id, template_code: src.instrument.code, template_version_no: v.version_no } });
  return { ok: true, instrumentId: made.id, code: made.code, versionId, warnings };
}
