import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  savePractitionerPhoto, removePractitionerPhoto,
  PHOTO_MAX_BYTES, PHOTO_CONTENT_TYPE, PHOTO_REFUSALS,
} from "@/lib/practice/practitioner-photo";

// POST   /api/v1/practice/identity/photo -- upload (multipart/form-data, field "photo")
// DELETE /api/v1/practice/identity/photo -- remove
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 s15: "Public profile editing remains authenticated and capability-controlled
// inside CP. Photo and biography changes follow the same audit/governance rules as other public-profile
// changes."
//
// ⚠ THE SUBJECT IS ALWAYS THE CALLER. `ctx.userId` comes from the session; there is no body field, no
// query parameter and no header that names whose photograph this is. A route that accepted a target
// would be one capability check away from letting a practice administrator publish an image under
// another clinician's name.
//
// ⚠ AND THE BODY IS READ AS BYTES, NEVER AS TEXT. A base64 JSON payload would be a third of a megabyte
// larger and would have to be decoded before anything could be checked; multipart hands over the actual
// file, which is what the magic-byte and metadata checks need.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";
// A 2MB image plus multipart overhead. Left explicit so the limit is visible where the request arrives
// as well as where the bytes are judged.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "send the image as multipart/form-data in a field named photo" }, { status: 400 });
  }

  const file = form.get("photo");
  if (!file || typeof file === "string")
    return NextResponse.json({ error: PHOTO_REFUSALS.EMPTY }, { status: 400 });

  // ⚠ CHECKED BEFORE THE BYTES ARE PULLED INTO MEMORY. Reading a 400MB upload into a buffer to discover
  // it is too large is how a size limit becomes the thing it was meant to prevent.
  if (file.size > PHOTO_MAX_BYTES)
    return NextResponse.json({ error: PHOTO_REFUSALS.TOO_LARGE }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await savePractitionerPhoto(caller.admin, {
    userId: ctx.userId,
    bytes,
    // The browser's claim about the file. Checked against the magic bytes rather than trusted.
    declaredType: file.type || null,
    correlationId: caller.traceId,
  });

  if (!result.ok)
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });

  return NextResponse.json({
    ok: true, url: result.data.url, bytes: result.data.bytes, correlationId: caller.traceId,
  });
}

export async function DELETE() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  const result = await removePractitionerPhoto(caller.admin, {
    userId: ctx.userId, correlationId: caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });

  return NextResponse.json({ ok: true, removed: result.data.removed, correlationId: caller.traceId });
}

/** What the console needs to render its own limits without restating them. */
export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  return NextResponse.json({ maxBytes: PHOTO_MAX_BYTES, contentType: PHOTO_CONTENT_TYPE });
}
