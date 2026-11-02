import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { listLibrary, loadRegistries } from "@/lib/assessment/studio/read";
import { createInstrument } from "@/lib/assessment/studio/write";
import { mustHold, refuse, respond } from "@/lib/assessment/studio/api";
import { KIND_PATTERN, MODE_PATTERN } from "@/lib/assessment/studio/vocab";

export const dynamic = "force-dynamic";

// /api/hq/checklist-studio/instruments -- Checklist Studio (S2).
//   GET   the library: code, name, family, latest version and state. Needs hq.assessment.studio.view.
//   POST  { family, name, description?, kind?, purpose, methods?, deliveryModes?, respondentRoles? } creates the instrument with its
//         catalogue code and version 1 as a draft, in one transaction (asmt_studio_create_instrument). Needs the author capability.
// The actor is always the signed-in person. The database refuses a person who does not hold the capability.

export async function GET() {
  const ctx = await hqApiGate([CAP.view]);
  if (isHqRefusal(ctx)) return ctx;
  const [rows, registries] = await Promise.all([listLibrary(ctx.admin), loadRegistries(ctx.admin)]);
  return NextResponse.json({ rows, registries });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate([CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const b = await req.json().catch(() => ({}));
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (!name) return refuse(400, "Give the checklist a name.");
  if (typeof b?.family !== "string" || !/^[A-Z]{1,6}$/.test(b.family)) return refuse(400, "Choose a family.");
  if (typeof b?.purpose !== "string" || !b.purpose) return refuse(400, "Choose a purpose.");
  if (b.kind && !(typeof b.kind === "string" && KIND_PATTERN.test(b.kind))) return refuse(400, "The kind must be lower case letters, numbers and underscores.");
  const modes: string[] = Array.isArray(b.deliveryModes) ? b.deliveryModes.filter((m: unknown): m is string => typeof m === "string") : [];
  if (modes.some((m) => !MODE_PATTERN.test(m))) return refuse(400, "A delivery mode is lower case letters and underscores only.");
  const r = await createInstrument(ctx.admin, ctx.userId, {
    family: b.family, name, description: typeof b.description === "string" ? b.description : null, kind: typeof b.kind === "string" ? b.kind : null, purpose: b.purpose,
    methods: Array.isArray(b.methods) ? b.methods : [], deliveryModes: modes, respondentRoles: Array.isArray(b.respondentRoles) && b.respondentRoles.length ? b.respondentRoles : ["self"],
  });
  return respond(r);
}
