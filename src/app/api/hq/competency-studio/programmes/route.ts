import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { setEntryOverlay } from "@/lib/competency/catalogue-entries";
import { setProgrammeQualification } from "@/lib/individual/programme-admin";
import { checkRequirements, listComponents, replaceEntryComponents, type Level } from "@/lib/competency/studio-components";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/competency-studio/programmes -- CFCA-STUDIO-P1 programme frameworks (migration 660).
//
// Body: { action: "overlay", catalogueId, entryId, requirement, expectedLevelId? }
//     | { action: "components", catalogueId, entryId, components: [{ code, passLevelId?, mandatory, safetyCritical, weight? }] }
//     | { action: "qualification", programmeCode, termId? }
//
// ⚠ GATED BY hqApiGate(["hq.individual.config.manage"]), the right that already curates catalogue entries and
// programmes (394, 387). It configures a DRAFT programme framework. It does not publish: publication stays the
// governed framework lifecycle with an independent publisher (580, 640), and the 394 and 660 triggers refuse
// every change to a catalogue that is in review or published.
//
// ⚠ EVERY CHANGE IS AUDITED (audit_log), with what it set.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.config.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));

  let result: { ok: true } | { ok: false; error: string };
  let entity: { type: string; name: string; value: Record<string, unknown> };
  if (body?.action === "qualification") {
    const code = typeof body.programmeCode === "string" ? body.programmeCode : "";
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(code)) return refuse(400, "Choose a programme.");
    const r = await setProgrammeQualification(ctx.admin, code, body.termId ?? null);
    result = r;
    entity = { type: "individual_scholar_programme", name: code, value: { qualification_term_id: body.termId ?? null, before: r.ok ? r.before : undefined } };
  } else if (body?.action === "overlay" || body?.action === "components") {
    if (!isId(body.catalogueId) || !isId(body.entryId)) return refuse(400, "Choose a catalogue entry.");
    const { data: entry, error } = await ctx.admin.from("competency_catalogue_entry").select("id, competency_id, catalogue_id")
      .eq("id", body.entryId).eq("catalogue_id", body.catalogueId).maybeSingle();
    if (error) return refuse(503, "The entry could not be read just now. Nothing has changed.");
    if (!entry) return refuse(404, "That entry is not in this catalogue.");
    if (body.action === "overlay") {
      result = await setEntryOverlay(ctx.admin, body.catalogueId, body.entryId, body.requirement, body.expectedLevelId ?? null);
      entity = { type: "competency_catalogue_entry", name: body.entryId, value: { requirement: body.requirement, expected_level_id: body.expectedLevelId ?? null } };
    } else {
      const [registry, lv] = await Promise.all([
        listComponents(ctx.admin),
        ctx.admin.from("scoring_levels").select("id, scale_id, score, label"),
      ]);
      if (registry === null || lv.error) return refuse(503, "The components could not be checked just now. Nothing has changed.");
      const levels: Level[] = (lv.data ?? []).map((l: { id: string; scale_id: string; score: number; label: string }) => ({ id: String(l.id).toLowerCase(), scaleId: l.scale_id, score: l.score, label: l.label }));
      const checked = checkRequirements(body.components, registry, levels);
      if (!checked.ok) return refuse(422, checked.error);
      result = await replaceEntryComponents(ctx.admin, body.entryId, checked.reqs);
      entity = { type: "competency_catalogue_entry_component", name: body.entryId, value: { components: checked.reqs } };
    }
  } else {
    return refuse(400, "Unknown action.");
  }
  if (!result.ok) return refuse(409, result.error);

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `competency_studio_${body.action}_set`, entity_type: entity.type, entity_id: null, entity_name: entity.name,
    old_value: null, new_value: entity.value,
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true });
}
