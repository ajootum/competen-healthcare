import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { countMaterials, createUploadSlot, recentUploads } from "@/lib/individual/scholar/store";
import { BUCKET, type MaterialMime, UPLOAD_ATTESTATION_REQUIRED, UPLOAD_SESSION_MINUTES, sessionRefusal, uploadRules } from "@/lib/individual/scholar/config";
import { loadIndividualPolicy } from "@/lib/individual/policy";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/uploads -- COMPETEN-IND-004 s1, step one of an upload.
//
// Issues a one-time signed upload URL for ONE object path the server chooses, under the person's own
// folder of the private bucket. The file goes from the browser to storage directly (see store.ts for why
// it cannot pass through a route), and is processed by POST /api/individual/scholar/materials.
// The declared type and size are checked here for a quick answer. The bucket enforces both, and
// processing checks the bytes themselves.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const mime = body?.mime as MaterialMime;
  const size = Number(body?.size);
  // Stage 2: the formats and the size limit are Individual policy (CONFIG-002), never above what 372/405 allow.
  const policy = await loadIndividualPolicy(ctx.admin);
  const rules = uploadRules(policy);
  if (!(rules.mimes as readonly string[]).includes(mime)) return NextResponse.json({ error: `Upload ${rules.describe}.` }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > rules.maxBytes)
    return NextResponse.json({ error: `Files must be between 1 byte and ${rules.maxMb} MB.` }, { status: 400 });
  if (body?.piiAttested !== true)
    return NextResponse.json({ error: UPLOAD_ATTESTATION_REQUIRED }, { status: 400 });

  const count = await countMaterials(ctx.admin, ctx.userId);
  if (count === null) return NextResponse.json({ error: "Your study space could not be read just now. Try again shortly." }, { status: 503 });
  // How many a person may keep is Individual policy (COMPETEN-CONFIG-002), never above MAX_MATERIALS_PER_PERSON.
  const maxMaterials = policy.scholarMaterialsPerPerson;
  if (count >= maxMaterials)
    return NextResponse.json({ error: `You can keep up to ${maxMaterials} materials. Delete one to upload another.` }, { status: 409 });
  // Upload limits (owner GO 2026-10-24): the session's files and combined size, an early answer. Processing re-checks.
  const recent = await recentUploads(ctx.admin, ctx.userId, new Date(Date.now() - UPLOAD_SESSION_MINUTES * 60_000).toISOString());
  if (!recent) return NextResponse.json({ error: "Your study space could not be read just now. Try again shortly." }, { status: 503 });
  const overSession = sessionRefusal(rules, recent, size);
  if (overSession) return NextResponse.json({ error: overSession }, { status: 429 });

  const slot = await createUploadSlot(ctx.admin, ctx.userId, mime);
  if (!slot) return NextResponse.json({ error: "The upload could not be started. Try again shortly." }, { status: 503 });
  return NextResponse.json({ bucket: BUCKET, uploadId: slot.uploadId, path: slot.path, token: slot.token });
}
