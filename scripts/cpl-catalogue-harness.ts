/**
 * CPR-CPL-001 -- the catalogue CONTENT, and what the shipped engine does to it.
 *
 *   npx --yes tsx scripts/cpl-catalogue-harness.ts
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR, given that the seeder cannot write a platform row.
 *
 * The catalogue is data, and data that has never been through the engine is a guess about what the
 * engine would accept. So the live half below pushes ALL of it -- every definition, every pack, every
 * pack item -- through createDefinition, createPack and setPackItem into a throwaway workspace, and
 * then reads the rows back. That proves three separate things:
 *
 *   the content satisfies every CHECK constraint in migration 246 and every validation in parameters.ts
 *   the fields the engine SILENTLY DROPS are exactly the ones ENGINE_GAPS names, and no others
 *   authoring the whole catalogue creates ZERO activations -- CPL s2, "inactive until selected"
 *
 * ⚠ EVERY ASSERTION HERE HAS BEEN MADE TO FAIL. An assertion that counts rows it just inserted proves
 * only that the insert ran. So the shape assertions below read back a field and compare it, the
 * refusals are asserted as refusals with the right code, and each refusal is PAIRED WITH A CONTROL that
 * proves the same call succeeds when the one bad field is corrected -- because "createDefinition
 * refuses everything" would satisfy a refusal test on its own.
 *
 * ⚠ AND THE VALIDATOR IS TESTED AGAINST DELIBERATE BREAKAGE. validate() in the seeder mirrors migration
 * 246's constraints; a validator that returns [] for everything would pass "the catalogue is valid" and
 * be worthless, so each of its eleven checks is fed a row that should trip it.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  ensureCoreLibrary, createDefinition, createPack, setPackItem, CORE_LIBRARY,
} from "../src/lib/practice/parameters";
import {
  PARAMETER_CATEGORY_CODES, PARAMETER_DATA_TYPE_CODES, COLLECTION_RULE_CODES, RISK_CLASS_CODES,
  NO_PLATFORM_REFERENCE_RANGE, PARAMETER_REFUSALS,
} from "../src/lib/practice/parameters-constants";
// ⚠ validate() COMES FROM THE CATALOGUE, NOT FROM THE SEEDER. The seeder calls main() at module scope,
// so importing anything from it would run it against the live database on load.
import {
  CATALOGUE_DEFINITIONS, CATALOGUE_PACKS, CATALOGUE_REFUSALS, ENGINE_GAPS, CATALOGUE_CODES, validate,
  type CatalogueDefinition,
} from "./cpl-catalogue";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-0000000c9100";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (t: string) => console.log(`\n── ${t} ──`);

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

/**
 * ⚠ THE PACK ITEMS COME OUT FIRST, AND FINDING OUT WHY COST A RUN.
 *
 * migration 246 s4: "No on-delete clause: a definition that a pack still names cannot be deleted, only
 * retired." That is deliberate and correct -- CPL s24, "Retiring a pack preserves all previous patient
 * data and definitions". But it also means `delete from practice_workspace` RESTRICTS: the cascade
 * reaches practice_parameter_definition and stops dead against practice_parameter_pack_item.
 *
 * The house cleanup() in every harness in scripts/ deletes the workspace and DISCARDS THE ERROR, so the
 * workspace silently survives -- and the next run fails with 37 DUPLICATE_CODEs that look like an
 * engine bug rather than a leftover fixture. This one unpicks the references in order and REPORTS a
 * failure, because a cleanup that quietly does nothing is how a harness stops being re-runnable.
 */
async function cleanup() {
  const { data: ws, error } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  if (error) { console.log(`  cleanup: the workspace list could not be read -- ${error.message}`); return; }
  for (const w of (ws ?? []) as { id: string }[]) {
    const { data: packs } = await admin.from("practice_parameter_pack").select("id").eq("workspace_id", w.id);
    for (const p of (packs ?? []) as { id: string }[])
      await admin.from("practice_parameter_pack_item").delete().eq("pack_id", p.id);
    await admin.from("practice_parameter_pack").delete().eq("workspace_id", w.id);
    await admin.from("practice_parameter_definition").delete().eq("workspace_id", w.id);
    const { error: delErr } = await admin.from("practice_workspace").delete().eq("id", w.id);
    // ⚠ NEVER DISCARDED. A cleanup that failed and said nothing is why this comment exists.
    if (delErr) console.log(`  cleanup: workspace ${w.id} could not be deleted -- ${delErr.message}`);
  }
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await admin.from("practice_audit_event").delete().eq("actor_id", USER);
}

/** A catalogue row with one field broken, for the validator's controls. */
const broken = (over: Partial<CatalogueDefinition>): CatalogueDefinition => ({
  code: "control_row", display_name: "Control", category: "specialty", data_type: "text",
  default_collection_rule: "on_request", presentation: { form: true, graph: false, table: true },
  risk_class: "low", source: "control", owner: "control", status: "active", version_note: "control",
  ...over,
});

const base = { actorId: USER, correlationId: "cpl-catalogue-harness" };

async function main() {
  console.log("\nCPR-CPL-001 catalogue harness -- s3 Reusable General Parameters\n");
  await cleanup();

  // ══ 1. THE VOCABULARIES ARE THE ENGINE'S, NOT A SECOND COPY ═════════════════════════════════════
  section("1. every catalogue value comes from LCP s6's own vocabulary");

  const badCategory = CATALOGUE_DEFINITIONS.filter(d => !PARAMETER_CATEGORY_CODES.includes(d.category));
  ok("1a. every category is one of LCP s6's six", badCategory.length === 0, badCategory.map(d => d.code).join(", "));
  const badType = CATALOGUE_DEFINITIONS.filter(d => !PARAMETER_DATA_TYPE_CODES.includes(d.data_type));
  ok("1b. every data type is one of LCP s6's eight", badType.length === 0, badType.map(d => d.code).join(", "));
  const badRule = CATALOGUE_DEFINITIONS.filter(d => !COLLECTION_RULE_CODES.includes(d.default_collection_rule));
  ok("1c. every collection rule is one of LCP s6's seven", badRule.length === 0, badRule.map(d => d.code).join(", "));
  const badRisk = CATALOGUE_DEFINITIONS.filter(d => !RISK_CLASS_CODES.includes(d.risk_class));
  ok("1d. every risk class is one of CPL s23's four", badRisk.length === 0, badRisk.map(d => d.code).join(", "));

  // ⚠ CONTROL. Without it, 1a-1d pass against an empty catalogue.
  ok("1e. CONTROL: the catalogue is not empty and spans more than one category",
    CATALOGUE_DEFINITIONS.length >= 30 && new Set(CATALOGUE_DEFINITIONS.map(d => d.category)).size >= 2,
    `${CATALOGUE_DEFINITIONS.length} definitions, ${new Set(CATALOGUE_DEFINITIONS.map(d => d.category)).size} categories`);

  // ══ 2. ⚠ NO REFERENCE RANGE, AND NO PLAUSIBILITY BOUND THAT IS A CLINICAL JUDGEMENT ═════════════
  //
  // This is the assertion the whole pass exists for. CPL-001 states no reference range anywhere, and a
  // definition has no column for one -- so the failure mode is a range smuggled in as a plausibility
  // bound, which looks like validation and reads on screen like a check that passed.
  section("2. ⚠ no reference range is authored, and every plausibility bound is arithmetic");

  const clinicalBound = CATALOGUE_DEFINITIONS.filter(d =>
    (d.min_plausible != null && d.min_plausible !== 0 && d.min_plausible !== 100)
    || (d.max_plausible != null && d.max_plausible !== 0 && d.max_plausible !== 100));
  ok("2a. ⚠ every plausibility bound in the catalogue is 0 or 100 -- a count floor or a percentage",
    clinicalBound.length === 0,
    clinicalBound.map(d => `${d.code} ${d.min_plausible}..${d.max_plausible}`).join(", "));

  const textWithBounds = CATALOGUE_DEFINITIONS.filter(d =>
    d.data_type === "text" && (d.min_plausible != null || d.max_plausible != null));
  ok("2b. no free-text parameter carries numeric bounds", textWithBounds.length === 0,
    textWithBounds.map(d => d.code).join(", "));

  // ⚠ CONTROL. A catalogue with NO bounds at all passes 2a and 2b and proves nothing.
  const bounded = CATALOGUE_DEFINITIONS.filter(d => d.min_plausible != null || d.max_plausible != null);
  ok("2c. CONTROL: some parameters DO carry bounds, so 2a is testing something",
    bounded.length >= 4, `${bounded.length} bounded`);

  // ⚠ CONTROL ON THE VALIDATOR ITSELF. A clinical bound must be caught, not merely absent.
  ok("2d. CONTROL: validate() rejects a bound of 30 as a clinical judgement",
    validate(broken({ data_type: "integer", canonical_unit: "x", permitted_units: ["x"], unit_conversions: { x: 1 }, max_plausible: 30 }))
      .some(m => /neither 0 nor 100/.test(m)));
  ok("2e. CONTROL: validate() rejects numeric bounds on a text parameter",
    validate(broken({ max_plausible: 100 })).some(m => /text parameter has been given numeric bounds/.test(m)));

  // The engine's own refusal is still standing and this catalogue did not quietly undo it.
  ok("2f. NO_PLATFORM_REFERENCE_RANGE is still the platform's position on shipped ranges",
    PARAMETER_REFUSALS.some(r => r.key === NO_PLATFORM_REFERENCE_RANGE.key));
  ok("2g. and the catalogue records that CPL-001 named no range for anything",
    CATALOGUE_REFUSALS.some(r => r.key === "reference_ranges" && /STATES NO REFERENCE RANGE ANYWHERE/.test(r.detail)));

  // ══ 3. AN UNSTATED SCALE IS NOT INVENTED ════════════════════════════════════════════════════════
  section("3. a score whose instrument CPL-001 does not name ships as a draft with no scale");

  const unscaled = CATALOGUE_DEFINITIONS.filter(d => d.scale_unstated);
  ok("3a. CONTROL: the catalogue contains scores with an unstated scale", unscaled.length === 4, `${unscaled.length}`);
  ok("3b. every one of them is a draft", unscaled.every(d => d.status === "draft"),
    unscaled.filter(d => d.status !== "draft").map(d => d.code).join(", "));
  ok("3c. none of them carries a plausibility bound or an option list",
    unscaled.every(d => d.min_plausible == null && d.max_plausible == null),
    unscaled.filter(d => d.min_plausible != null || d.max_plausible != null).map(d => d.code).join(", "));
  ok("3d. ⚠ each one's version note names the candidate instruments and says they disagree",
    unscaled.every(d => /must stay one until a practice states the instrument/.test(d.version_note)));
  ok("3e. CONTROL: validate() rejects an unstated scale that is not a draft",
    validate(broken({ scale_unstated: true, status: "active", category: "score", data_type: "integer" }))
      .some(m => /is not a draft/.test(m)));
  ok("3f. CONTROL: validate() rejects bounds set against an unstated scale",
    validate(broken({ scale_unstated: true, status: "draft", category: "score", data_type: "integer", min_plausible: 0 }))
      .some(m => /bounds have been set against it anyway/.test(m)));

  // ⚠ AND THE HONEST LIMIT IS RECORDED. `draft` does not stop activation and the refusal says so.
  ok("3g. the catalogue records that `draft` is advisory and does not block activation",
    CATALOGUE_REFUSALS.some(r => r.key === "unstated_scales" && /ADVISORY AND NOT A LOCK/.test(r.detail)));

  // ══ 4. WHETHER IT TRENDS ════════════════════════════════════════════════════════════════════════
  section("4. text does not trend, numbers do");

  const textGraphed = CATALOGUE_DEFINITIONS.filter(d => d.data_type === "text" && d.presentation.graph);
  ok("4a. ⚠ no free-text parameter is marked graphable", textGraphed.length === 0,
    textGraphed.map(d => d.code).join(", "));
  const numeric = CATALOGUE_DEFINITIONS.filter(d => d.data_type === "integer" || d.data_type === "decimal");
  ok("4b. CONTROL: every numeric parameter IS graphable, so 4a is not passing on an all-false field",
    numeric.length >= 6 && numeric.every(d => d.presentation.graph), `${numeric.length} numeric`);
  ok("4c. CONTROL: validate() rejects graphable free text",
    validate(broken({ presentation: { form: true, graph: true, table: true } }))
      .some(m => /free text marked graphable/.test(m)));

  // ⚠ THE SHAPE OF THE CATALOGUE IS PINNED, because rule 4's header states these three numbers and a
  // prose count drifts the first time somebody adds a parameter. 28 free text is the FINDING about
  // CPR-CPL-001 -- it names 37 things and supplies a scale for 9 of them.
  const counts = {
    text: CATALOGUE_DEFINITIONS.filter(d => d.data_type === "text").length,
    numeric: CATALOGUE_DEFINITIONS.filter(d => d.category !== "score" && (d.data_type === "integer" || d.data_type === "decimal")).length,
    score: CATALOGUE_DEFINITIONS.filter(d => d.category === "score").length,
  };
  ok("4d. the catalogue is 28 free text + 5 numeric + 4 unscaled scores = 37, as rule 4's header states",
    counts.text === 28 && counts.numeric === 5 && counts.score === 4
    && counts.text + counts.numeric + counts.score === CATALOGUE_DEFINITIONS.length,
    JSON.stringify(counts));

  // ══ 5. THE CATALOGUE DOES NOT DUPLICATE WHAT IS ALREADY SHIPPED ═════════════════════════════════
  section("5. nothing here re-defines a core parameter or a computed one");

  const coreCodes = new Set(CORE_LIBRARY.map(d => d.code));
  const collisions = CATALOGUE_CODES.filter(c => coreCodes.has(c));
  ok("5a. ⚠ no catalogue code collides with a CORE_LIBRARY code", collisions.length === 0, collisions.join(", "));
  ok("5b. ⚠ `pain` is NOT re-defined -- the Symptoms pack names the core `pain_score` instead",
    !CATALOGUE_CODES.includes("pain") && !CATALOGUE_CODES.includes("pain_score")
    && CATALOGUE_PACKS.some(p => p.code === "general_symptoms" && p.items.includes("pain_score")));
  ok("5c. CONTROL: `pain_score` really is a core definition, so 5b reuses a real row",
    coreCodes.has("pain_score"));
  ok("5d. ⚠ weight loss percentage is not a definition -- it is read from the weight series",
    !CATALOGUE_CODES.some(c => /weight_loss|weight_change/.test(c))
    && CATALOGUE_REFUSALS.some(r => r.key === "weight_loss_percentage"));

  // ══ 6. THE PACKS ════════════════════════════════════════════════════════════════════════════════
  section("6. five packs, every item resolving to a definition that exists");

  const resolvable = new Set([...CATALOGUE_CODES, ...coreCodes]);
  const dangling = CATALOGUE_PACKS.flatMap(p => p.items.filter(i => !resolvable.has(i)).map(i => `${p.code}->${i}`));
  ok("6a. every pack item names a definition the catalogue or the core library supplies",
    dangling.length === 0, dangling.join(", "));
  ok("6b. no pack is empty -- installPack refuses one and the refusal would be a silent no-op",
    CATALOGUE_PACKS.every(p => p.items.length > 0));
  ok("6c. CONTROL: the packs between them cover every catalogue definition",
    CATALOGUE_CODES.every(c => CATALOGUE_PACKS.some(p => p.items.includes(c))),
    CATALOGUE_CODES.filter(c => !CATALOGUE_PACKS.some(p => p.items.includes(c))).join(", "));
  ok("6d. CPL s21's nine condition packs are refused rather than half-built",
    CATALOGUE_REFUSALS.some(r => r.key === "condition_packs"));

  // ══ 7. THE VALIDATOR IS NOT VACUOUS ═════════════════════════════════════════════════════════════
  section("7. the seeder's validator can see each thing it claims to check");

  ok("7a. the real catalogue passes validation clean",
    CATALOGUE_DEFINITIONS.flatMap(validate).length === 0,
    CATALOGUE_DEFINITIONS.flatMap(validate).join(" | "));
  ok("7b. CONTROL: a bad code is caught", validate(broken({ code: "Bad Code" })).some(m => /does not match/.test(m)));
  ok("7c. CONTROL: a bad category is caught", validate(broken({ category: "vitals" as never })).some(m => /category/.test(m)));
  ok("7d. CONTROL: an inverted plausibility window is caught",
    validate(broken({ data_type: "integer", canonical_unit: "x", permitted_units: ["x"], unit_conversions: { x: 1 }, min_plausible: 100, max_plausible: 0 }))
      .some(m => /wrong way round/.test(m)));
  ok("7e. CONTROL: an active licensed definition with no licence reference is caught",
    validate(broken({ risk_class: "licensed", licence_required: true, status: "active" }))
      .some(m => /no licence reference/.test(m)));
  ok("7f. CONTROL: a licensed class that claims it needs no licence is caught",
    validate(broken({ risk_class: "licensed" })).some(m => /claims it needs no licence/.test(m)));
  ok("7g. CONTROL: a numeric parameter with no canonical unit is caught",
    validate(broken({ data_type: "decimal" })).some(m => /no canonical unit/.test(m)));
  ok("7h. CONTROL: a canonical unit missing from permitted_units is caught",
    validate(broken({ data_type: "integer", canonical_unit: "kg", permitted_units: [], unit_conversions: { kg: 1 } }))
      .some(m => /not in permitted_units/.test(m)));
  ok("7i. CONTROL: a canonical unit that does not convert to itself by 1 is caught",
    validate(broken({ data_type: "integer", canonical_unit: "kg", permitted_units: ["kg"], unit_conversions: { kg: 2 } }))
      .some(m => /convert to itself by 1/.test(m)));

  // ══ THE LIVE HALF ═══════════════════════════════════════════════════════════════════════════════
  section("8. the whole catalogue goes through the REAL engine");

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: "harness-cpl-catalogue", request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: "cpl-catalogue-harness",
  }).select("id").single();
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: USER, correlation_id: "cpl-catalogue-harness", workspace_id: null },
    payload("HARNESS CPL Catalogue (synthetic)"));
  if (!run.ok || !run.workspaceId) { ok("8-0. a workspace provisions", false, run.errorCode ?? ""); return report(); }
  const ctxRes = await resolveWorkspaceContext(admin, USER, run.workspaceId);
  if (!ctxRes.ok) { ok("8-0. the workspace context resolves", false); return report(); }
  const ctx: WorkspaceContext = ctxRes.ctx;

  const seed = await ensureCoreLibrary(admin);
  ok("8a. CONTROL: the platform core library is present, so pack items may name pain_score",
    seed.ok && (seed.data.created + seed.data.existing) >= CORE_LIBRARY.length,
    seed.ok ? JSON.stringify(seed.data) : seed.message);

  // ── every definition through createDefinition ──────────────────────────────────────────────────
  const created = new Map<string, string>();
  const rejected: string[] = [];
  for (const d of CATALOGUE_DEFINITIONS) {
    const r = await createDefinition(admin, ctx, {
      ...base,
      code: d.code, displayName: d.display_name, shortName: d.short_name ?? null,
      synonyms: d.synonyms ?? [], category: d.category, dataType: d.data_type,
      canonicalUnit: d.canonical_unit ?? null, permittedUnits: d.permitted_units ?? [],
      unitConversions: d.unit_conversions ?? {},
      precision: d.value_precision ?? null,
      minPlausible: d.min_plausible ?? null, maxPlausible: d.max_plausible ?? null,
      defaultCollectionRule: d.default_collection_rule,
      riskClass: d.risk_class, licenceRequired: d.licence_required === true,
      licenceReference: d.licence_reference ?? null,
    });
    if (r.ok) created.set(d.code, r.data.id); else rejected.push(`${d.code}: ${r.code} ${r.message}`);
  }
  ok("8b. ⚠ ALL 37 catalogue definitions are accepted by the real createDefinition",
    created.size === CATALOGUE_DEFINITIONS.length, rejected.join(" | "));

  // ── the packs, and their items ─────────────────────────────────────────────────────────────────
  const packIds = new Map<string, string>();
  const packErrors: string[] = [];
  for (const p of CATALOGUE_PACKS) {
    const r = await createPack(admin, ctx, {
      ...base, code: p.code, name: p.name, specialty: p.specialty, description: p.description,
    });
    if (r.ok) packIds.set(p.code, r.data.id); else packErrors.push(`${p.code}: ${r.code} ${r.message}`);
  }
  ok("8c. all five packs are accepted by the real createPack", packIds.size === CATALOGUE_PACKS.length, packErrors.join(" | "));

  const { data: platformDefs } = await admin.from("practice_parameter_definition")
    .select("id, code").is("workspace_id", null);
  const platformByCode = new Map(((platformDefs ?? []) as { id: string; code: string }[]).map(r => [r.code, r.id]));

  let items = 0; const itemErrors: string[] = [];
  for (const p of CATALOGUE_PACKS) {
    const packId = packIds.get(p.code); if (!packId) continue;
    for (let i = 0; i < p.items.length; i++) {
      const defId = created.get(p.items[i]) ?? platformByCode.get(p.items[i]);
      if (!defId) { itemErrors.push(`${p.code}->${p.items[i]}: no definition id`); continue; }
      const r = await setPackItem(admin, ctx, { ...base, packId, definitionId: defId, position: i });
      if (r.ok) items++; else itemErrors.push(`${p.code}->${p.items[i]}: ${r.code} ${r.message}`);
    }
  }
  const expectedItems = CATALOGUE_PACKS.reduce((n, p) => n + p.items.length, 0);
  ok("8d. every pack item is accepted, INCLUDING the platform pain_score in a workspace pack",
    items === expectedItems, `${items}/${expectedItems}: ${itemErrors.join(" | ")}`);

  // ── ⚠ NOTHING WAS ACTIVATED. CPL s2: "inactive until selected by a practitioner." ───────────────
  const { data: acts, error: actErr } = await admin.from("practice_parameter_activation")
    .select("id").eq("workspace_id", ctx.workspaceId);
  ok("8e. ⚠ authoring the entire catalogue created ZERO activations -- the library is seeded, nothing installed",
    !actErr && (acts ?? []).length === 0, actErr?.message ?? `${(acts ?? []).length} activations`);

  // ══ 9. ⚠ WHAT THE ENGINE SILENTLY DROPS ═════════════════════════════════════════════════════════
  //
  // Each assertion below reads a row BACK and compares it with what the catalogue asked for. These are
  // deliberately written as "the engine does NOT carry this", so if any of them is fixed in
  // parameters.ts the assertion FAILS and ENGINE_GAPS gets shorter. That is the intended failure.
  section("9. ⚠ the fields the shipped engine cannot carry (each one fails when it is fixed)");

  const probeCode = "safeguarding_concern";           // text: graph must be false
  const probe = CATALOGUE_DEFINITIONS.find(d => d.code === probeCode)!;
  const { data: back } = await admin.from("practice_parameter_definition")
    .select("workspace_id, presentation, source, owner, status, data_type, canonical_unit, min_plausible, category")
    .eq("id", created.get(probeCode)!).maybeSingle();
  const row = back as Record<string, unknown> | null;

  ok("9a. ⚠ PLATFORM SCOPE: the engine wrote a WORKSPACE row, not the platform row a catalogue needs",
    row != null && row.workspace_id === ctx.workspaceId,
    `workspace_id=${String(row?.workspace_id)}`);
  ok("9b. ⚠ PRESENTATION: the catalogue says graph:false and the row says graph:true -- free text marked chartable",
    probe.presentation.graph === false
    && (row?.presentation as { graph?: boolean } | null)?.graph === true,
    JSON.stringify(row?.presentation));
  ok("9c. ⚠ SOURCE: the catalogue cites CPR-CPL-001 s3 and the row is attributed to the practice",
    /CPR-CPL-001/.test(probe.source) && typeof row?.source === "string" && !/CPL-001/.test(row.source as string),
    String(row?.source));
  ok("9d. ⚠ STATUS: the catalogue says active and every engine-created definition is a draft",
    probe.status === "active" && row?.status === "draft", String(row?.status));

  const { data: ver } = await admin.from("practice_parameter_definition_version")
    .select("change_note").eq("definition_id", created.get("performance_status")!).maybeSingle();
  const scored = CATALOGUE_DEFINITIONS.find(d => d.code === "performance_status")!;
  ok("9e. ⚠ VERSION NOTE: rule 3's caveat is lost -- the engine writes `Created.` for every definition",
    /must stay one until a practice states the instrument/.test(scored.version_note)
    && (ver as { change_note?: string } | null)?.change_note === "Created.",
    String((ver as { change_note?: string } | null)?.change_note));

  // ⚠ CONTROL FOR ALL OF 9. The fields the engine DOES carry came through unchanged, so 9a-9e are not
  // passing because the read is broken or the row is empty.
  ok("9f. CONTROL: the fields the engine DOES carry survived exactly -- category, type and unit",
    row?.category === probe.category && row?.data_type === probe.data_type
    && row?.min_plausible === null,
    JSON.stringify({ category: row?.category, data_type: row?.data_type, min_plausible: row?.min_plausible }));

  ok("9g. ENGINE_GAPS names the blocker first and gives the one-function fix",
    ENGINE_GAPS[0].key === "platform_scope" && /ensurePlatformCatalogue/.test(ENGINE_GAPS[0].wouldRequire));
  ok("9h. and there is still no platform pack anywhere -- the tier has no writer",
    ((await admin.from("practice_parameter_pack").select("id").is("workspace_id", null)).data ?? []).length === 0);

  // ══ 10. THE ENGINE'S REFUSALS STILL REFUSE ══════════════════════════════════════════════════════
  //
  // ⚠ EACH PAIRED WITH A CONTROL. "createDefinition rejects everything" satisfies a refusal test alone.
  section("10. the engine refuses the rows it should, and accepts the corrected ones");

  const dupe = await createDefinition(admin, ctx, { ...base, code: "fatigue", displayName: "Fatigue again", category: "specialty", dataType: "text" });
  ok("10a. a duplicate code in the same practice is refused as DUPLICATE_CODE",
    !dupe.ok && dupe.code === "DUPLICATE_CODE", dupe.ok ? "accepted" : dupe.code);

  const badCode = await createDefinition(admin, ctx, { ...base, code: "Fatigue Level", displayName: "x", category: "specialty", dataType: "text" });
  ok("10b. a code that breaks migration 246 s1's pattern is refused",
    !badCode.ok && badCode.code === "VALIDATION_ERROR", badCode.ok ? "accepted" : badCode.code);

  const licensed = await createDefinition(admin, ctx, {
    ...base, code: "licensed_probe", displayName: "Licensed probe", category: "score", dataType: "integer",
    riskClass: "licensed",
  });
  ok("10c. a `licensed` definition is forced to licence_required (CPL s23), and is created as a DRAFT",
    licensed.ok, licensed.ok ? "" : `${licensed.code} ${licensed.message}`);

  const inverted = await createDefinition(admin, ctx, {
    ...base, code: "inverted_probe", displayName: "Inverted", category: "specialty", dataType: "integer",
    minPlausible: 100, maxPlausible: 0,
  });
  ok("10d. an inverted plausibility window is refused by the engine too",
    !inverted.ok && inverted.code === "VALIDATION_ERROR", inverted.ok ? "accepted" : inverted.code);

  // ⚠ THE CONTROL. Same call, window the right way round.
  const corrected = await createDefinition(admin, ctx, {
    ...base, code: "corrected_probe", displayName: "Corrected", category: "specialty", dataType: "integer",
    minPlausible: 0, maxPlausible: 100,
  });
  ok("10e. CONTROL: the same call with the window corrected IS accepted",
    corrected.ok, corrected.ok ? "" : `${corrected.code} ${corrected.message}`);

  const emptyPack = await createPack(admin, ctx, { ...base, code: "Bad Pack", name: "x" });
  ok("10f. a pack code that breaks the pattern is refused",
    !emptyPack.ok && emptyPack.code === "VALIDATION_ERROR", emptyPack.ok ? "accepted" : emptyPack.code);

  await cleanup();
  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
