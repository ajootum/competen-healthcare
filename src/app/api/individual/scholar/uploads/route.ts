import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { countMaterials, createUploadSlot } from "@/lib/individual/scholar/store";
import { ALLOWED_MIME, BUCKET, MAX_MATERIALS_PER_PERSON, MAX_UPLOAD_BYTES, type MaterialMime, UPLOAD_ATTESTATION_REQUIRED } from "@/lib/individual/scholar/config";

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
  if (!(ALLOWED_MIME as readonly string[]).includes(mime)) return NextResponse.json({ error: "Upload a PDF or a Word (.docx) file." }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: `Files must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 400 });
  if (body?.piiAttested !== true)
    return NextResponse.json({ error: UPLOAD_ATTESTATION_REQUIRED }, { status: 400 });

  const count = await countMaterials(ctx.admin, ctx.userId);
  if (count === null) return NextResponse.json({ error: "Your study space could not be read just now. Try again shortly." }, { status: 503 });
  if (count >= MAX_MATERIALS_PER_PERSON)
    return NextResponse.json({ error: `You can keep up to ${MAX_MATERIALS_PER_PERSON} materials. Delete one to upload another.` }, { status: 409 });

  const slot = await createUploadSlot(ctx.admin, ctx.userId, mime);
  if (!slot) return NextResponse.json({ error: "The upload could not be started. Try again shortly." }, { status: 503 });
  return NextResponse.json({ bucket: BUCKET, uploadId: slot.uploadId, path: slot.path, token: slot.token });
}
