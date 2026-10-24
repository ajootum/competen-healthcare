import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { addEntries, checkStatusChange, removeEntry, setEntryStatus } from "@/lib/competency/catalogue-entries";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/individual/catalogues -- P0 controlled competency catalogues (migration 394).
//
// Body: { catalogueId, action: "add", competencyIds: [] } | { catalogueId, action: "status", entryId,
// status, note? } | { catalogueId, action: "remove", entryId }.
//
// ⚠ GATED BY hqApiGate(["hq.individual.config.manage"]) -- the Individual Product Administrator. It curates
// what a catalogue NAMES. It does not publish: publication is the governed framework lifecycle (submit,
// then an independent approver), and only a published catalogue can be allowlisted. While the catalogue is
// anything but a draft, the 394 trigger refuses every change and this route says so in words.
//
// ⚠ SHARED ONLY. The catalogue must be a shared framework (checked here and by the trigger), and so must
// the home of every competency it names (the trigger).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.config.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isId(body?.catalogueId)) return refuse(400, "Choose a catalogue.");

  const { data: fw, error: fwErr } = await ctx.admin.from("frameworks").select("id, name, pub_status").eq("id", body.catalogueId).is("hospital_id", null).maybeSingle();
  if (fwErr) return refuse(503, "The catalogue could not be read just now. Nothing has changed.");
  if (!fw) return refuse(404, "That is not a shared framework.");

  let result: { ok: true; added?: number } | { ok: false; error: string };
  let detail: Record<string, unknown> = {};
  switch (body.action) {
    case "add": {
      const ids = Array.isArray(body.competencyIds) ? body.competencyIds.filter(isId) : [];
      result = await addEntries(ctx.admin, fw.id, ids);
      detail = { added: result.ok ? result.added : 0 };
      break;
    }
    case "status": {
      if (!isId(body.entryId)) return refuse(400, "Choose an entry.");
      const v = checkStatusChange(body.status, body.note);
      if (!v.ok) return refuse(422, v.error);
      result = await setEntryStatus(ctx.admin, fw.id, body.entryId, v.status, v.note);
      detail = { entry_id: body.entryId, content_status: v.status };
      break;
    }
    case "remove": {
      if (!isId(body.entryId)) return refuse(400, "Choose an entry.");
      result = await removeEntry(ctx.admin, fw.id, body.entryId);
      detail = { entry_id: body.entryId };
      break;
    }
    default:
      return refuse(400, "Unknown action");
  }
  if (!result.ok) return refuse(409, result.error);

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `catalogue_entry_${body.action}`, entity_type: "framework", entity_id: fw.id, entity_name: fw.name, new_value: detail,
  }).then((r: unknown) => r, () => {});
  return NextResponse.json({ ok: true, ...detail });
}
