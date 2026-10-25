import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid, parseCpd } from "@/lib/individual/professional/validate";
import { removeDocument, storeDocument } from "@/lib/individual/professional/documents";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, todayUtc, writeFailed } from "@/lib/individual/professional/api";
import { DIFFERENT_ACTIVITY_FIELD, duplicateForSave, notifyDuplicate, recordDifferentActivity, refusalBody } from "@/lib/individual/professional/cpd-duplicates";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { lcpdSchemaReady, recordableTypes } from "@/lib/individual/professional/lcpd-schema";
import { linkSavedCpd, planReady } from "@/lib/individual/professional/record-goals";

/** LCPD-2: the configured types, and with migration 490 only a description and a date required. Before 490, 373's rule. */
async function cpdRules(admin: unknown) {
  const [cfg, ready] = await Promise.all([loadLcpdConfig(admin), lcpdSchemaReady(admin)]);
  return { types: recordableTypes(cfg, ready).map(t => t.code), flexible: ready };
}

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/cpd -- COMPETEN-IND-007 s4, the private CPD log.
//
// ⚠ NOT cpd_logs (owner ruling D1). The estate CPD table is read by hospital analytics
// (src/lib/operations/pd-cpd.ts). This writes migration 373's individual_professional_cpd, which no
// institutional reader queries and which has no hospital column to scope by.
//
// ⚠ THE CLASS IS NOT SENT, IT IS COMPUTED. A certificate attached here makes the entry `source_linked`
// through 373's generated column. Nothing in the body can make it anything else, and nothing makes it
// verified.
//
// ⚠ A COURSE ALREADY IN THE RECORD THROUGH COMPETEN LEARNING IS NOT POSTED AGAIN (owner: "we don't post this and send
// a notification to the user", src/lib/individual/professional/cpd-duplicates.ts). The save is refused with 409, the
// course, its date and a link, and the person is notified. "This is a different activity" (differentActivity=yes)
// saves it: the decision is written FIRST, and without it the row is not written either.
//
// ⚠ THE GOAL IT SERVED (LCPD-01 with PLAN-01, migration 480). With 480 present the goal, and the planned activity it
// completes (activityId), are linked AFTER the entry is saved through Stage 3's writers (record-goals.ts), and 373's
// goal_id is no longer written: a PUT leaves an earlier one as it was. Without 480, goal_id exactly as before.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields, file } = await readBody(req);
  const parsed = parseCpd(fields, todayUtc(), await cpdRules(ctx.admin));
  if (!parsed.ok) return refuse(parsed.error);
  if (parsed.value.goal_id) {
    const { data: goal } = await ctx.admin.from("individual_professional_goal").select("id").eq("id", parsed.value.goal_id).eq("user_id", ctx.userId).maybeSingle();
    if (!goal) return refuse("That goal is not on your record.");
  }

  const id = crypto.randomUUID();
  const dup = await duplicateForSave(ctx.admin, ctx.userId, parsed.value, null);
  if (dup) {
    if (fields[DIFFERENT_ACTIVITY_FIELD] !== "yes") {
      await notifyDuplicate(ctx.admin, ctx.userId, "refused", { ...dup, cpdId: id });
      return NextResponse.json(refusalBody(dup), { status: 409 });
    }
    if (!(await recordDifferentActivity(ctx.admin, ctx.userId, id, dup.recordId))) return writeFailed("CPD entry");
  }

  let doc = {};
  if (file) {
    const stored = await storeDocument(ctx.admin, ctx.userId, file);
    if (!stored.ok) return refuse(stored.error);
    doc = stored.doc;
  }
  const plan = await planReady(ctx.admin);
  const { data, error } = await ctx.admin.from("individual_professional_cpd")
    .insert({ ...parsed.value, ...(plan ? { goal_id: null } : {}), ...doc, id, user_id: ctx.userId, experience_code: ORIGIN }).select("id, evidence_class").single();
  if (error || !data) {
    await removeDocument(ctx.admin, (doc as { document_path?: string }).document_path);
    return writeFailed("CPD entry");
  }
  await audit(ctx, "individual_professional_cpd_create", "individual_professional_cpd", data.id, { evidence_class: data.evidence_class, ...(dup ? { different_activity_from: dup.recordId } : {}) });
  const planNote = plan ? await linkSavedCpd(ctx.admin, ctx.userId, data.id, { goalId: parsed.value.goal_id, activityId: isUuid(fields.activityId) ? fields.activityId : null }) : null;
  return NextResponse.json({ ok: true, id: data.id, evidenceClass: data.evidence_class, ...(planNote ? { planNote } : {}) }, { status: 201 });
}

/**
 * PUT ?id= -- edit an entry: the same checks as adding one. A newly attached document replaces the old one (removed
 * only after the update succeeds); with none attached, the entry keeps its document, so a typo never costs it.
 */
export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a CPD entry.");
  const { fields, file } = await readBody(req);
  const rules = await cpdRules(ctx.admin);
  // An entry keeps its own type even if the configuration has since stopped offering it.
  const { data: prior } = await ctx.admin.from("individual_professional_cpd").select("activity_type").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  const parsed = parseCpd(fields, todayUtc(), prior?.activity_type ? { ...rules, types: [...rules.types, prior.activity_type] } : rules);
  if (!parsed.ok) return refuse(parsed.error);
  const { data: before } = await ctx.admin.from("individual_professional_cpd").select("id, document_path, title, provider, activity_type, activity_date").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!before) return refuse("That CPD entry is not on your record.", 404);
  if (parsed.value.goal_id) {
    const { data: goal } = await ctx.admin.from("individual_professional_goal").select("id").eq("id", parsed.value.goal_id).eq("user_id", ctx.userId).maybeSingle();
    if (!goal) return refuse("That goal is not on your record.");
  }
  const dup = await duplicateForSave(ctx.admin, ctx.userId, parsed.value, before);
  if (dup) {
    if (fields[DIFFERENT_ACTIVITY_FIELD] !== "yes") {
      await notifyDuplicate(ctx.admin, ctx.userId, "refused", { ...dup, cpdId: id });
      return NextResponse.json(refusalBody(dup), { status: 409 });
    }
    if (!(await recordDifferentActivity(ctx.admin, ctx.userId, id, dup.recordId))) return writeFailed("CPD entry");
  }
  let doc = {};
  if (file) {
    const stored = await storeDocument(ctx.admin, ctx.userId, file);
    if (!stored.ok) return refuse(stored.error);
    doc = stored.doc;
  }
  // With 480 the goal is linked in the plan, so the entry's own goal_id is left as it was (not cleared by its absence).
  const cols: Partial<typeof parsed.value> = { ...parsed.value };
  if (await planReady(ctx.admin)) delete cols.goal_id;
  const { data, error } = await ctx.admin.from("individual_professional_cpd")
    .update({ ...cols, ...doc, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).select("id, evidence_class").maybeSingle();
  if (error || !data) {
    await removeDocument(ctx.admin, (doc as { document_path?: string }).document_path);
    return writeFailed("CPD entry");
  }
  if (file) await removeDocument(ctx.admin, before.document_path);
  await audit(ctx, "individual_professional_cpd_update", "individual_professional_cpd", id, { evidence_class: data.evidence_class, document_replaced: !!file });
  return NextResponse.json({ ok: true, id, evidenceClass: data.evidence_class });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a CPD entry.");
  const { data, error } = await ctx.admin.from("individual_professional_cpd")
    .delete().eq("id", id).eq("user_id", ctx.userId).select("id, document_path").maybeSingle();
  if (error) return writeFailed("CPD entry");
  if (!data) return refuse("That CPD entry is not on your record.", 404);
  await removeDocument(ctx.admin, data.document_path);
  await audit(ctx, "individual_professional_cpd_delete", "individual_professional_cpd", id);
  return NextResponse.json({ ok: true });
}
