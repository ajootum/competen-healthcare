import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { createFirstVersion, renameInstrument } from "@/lib/assessment/studio/write";
import { isUuid, mustHold, refuse, respond } from "@/lib/assessment/studio/api";

export const dynamic = "force-dynamic";

// /api/hq/checklist-studio/instruments/[instrumentId] -- Checklist Studio (S2). Author capability.
//   PATCH { name?, description? }   the code, kind, owner and family are permanent (890 definition guard)
//   POST  { action: "first_version", purpose, methods?, deliveryModes?, respondentRoles? }
//         the first draft for an instrument that was registered in the catalogue without a version

export async function PATCH(req: Request, { params }: { params: Promise<{ instrumentId: string }> }) {
  const ctx = await hqApiGate([CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { instrumentId } = await params;
  if (!isUuid(instrumentId)) return refuse(400, "Choose an instrument.");
  const b = await req.json().catch(() => ({}));
  const patch: { name?: string; description?: string | null } = {};
  if (typeof b?.name === "string") { if (!b.name.trim()) return refuse(400, "The name cannot be empty."); patch.name = b.name.trim(); }
  if ("description" in (b ?? {})) patch.description = typeof b.description === "string" && b.description.trim() ? b.description.trim() : null;
  return respond(await renameInstrument(ctx.admin, instrumentId, patch));
}

export async function POST(req: Request, { params }: { params: Promise<{ instrumentId: string }> }) {
  const ctx = await hqApiGate([CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { instrumentId } = await params;
  if (!isUuid(instrumentId)) return refuse(400, "Choose an instrument.");
  const b = await req.json().catch(() => ({}));
  if (b?.action !== "first_version") return refuse(400, "Unknown action.");
  if (typeof b.purpose !== "string" || !b.purpose) return refuse(400, "Choose a purpose.");
  return respond(await createFirstVersion(ctx.admin, ctx.userId, instrumentId, {
    purpose: b.purpose, methods: Array.isArray(b.methods) ? b.methods : [], deliveryModes: Array.isArray(b.deliveryModes) ? b.deliveryModes : [],
    respondentRoles: Array.isArray(b.respondentRoles) && b.respondentRoles.length ? b.respondentRoles : ["self"],
  }));
}
