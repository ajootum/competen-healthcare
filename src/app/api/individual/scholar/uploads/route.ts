import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { cancelUpload, countMaterials, createUploadSlot, findDuplicate, findReusableUpload, getUpload, isUuid, issueUpload, recentUploads, sweepPersonUploads } from "@/lib/individual/scholar/store";
import { isSha256, reusable } from "@/lib/individual/scholar/upload-record";
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

  // SCHOLAR-CE07C. The browser hashes the file first (sha256) and may name an upload it began earlier (resumeUploadId).
  // One file keeps ONE upload identity until it is kept, refused or cancelled: the same path, so bytes already sent
  // are continued, never sent again under a second identity, and the finish can never create a second material.
  const now = Date.now();
  const sha256 = isSha256(body?.sha256) ? body.sha256 : null;
  const resumeId = isUuid(body?.resumeUploadId) ? body.resumeUploadId as string : null;
  // Opportunistic clean-up of this person's abandoned uploads (older than 24 h). Best effort, never blocks the upload.
  await sweepPersonUploads(ctx.admin, ctx.userId, now).catch(() => 0);

  if (sha256) {
    // The same bytes already kept: say so BEFORE the file is sent again over a slow network.
    const duplicate = await findDuplicate(ctx.admin, ctx.userId, sha256);
    if (duplicate) {
      // The learner's own interrupted upload that was in fact kept (its answer was lost): the finish answers it again.
      if (resumeId && duplicate.id === resumeId) return NextResponse.json({ bucket: BUCKET, uploadId: resumeId, kept: true });
      return NextResponse.json({ error: `This file is already in your library as "${duplicate.title}".`, duplicateOf: duplicate }, { status: 409 });
    }
  }

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

  let identity: string | undefined;
  let resumed = false;
  if (sha256) {
    const want = { mime, size, sha256 };
    if (resumeId) {
      const row = await getUpload(ctx.admin, ctx.userId, resumeId);
      // Without 960 there is no record to check: the id only ever names a path in the caller's own folder.
      if (row === "absent" || (row && reusable(row, want, now))) { identity = resumeId; resumed = true; }
    }
    if (!identity) {
      const open = await findReusableUpload(ctx.admin, ctx.userId, want, now);
      if (open) { identity = open.id; resumed = true; }
    }
  }

  const slot = await createUploadSlot(ctx.admin, ctx.userId, mime, identity);
  if (!slot) return NextResponse.json({ error: "The upload could not be started. Try again shortly." }, { status: 503 });
  if (!resumed && sha256) {
    const recorded = await issueUpload(ctx.admin, ctx.userId, { id: slot.uploadId, mime, size, sha256 }, now);
    if (recorded === "failed") return NextResponse.json({ error: "The upload could not be started. Try again shortly." }, { status: 503 });
  }
  return NextResponse.json({ bucket: BUCKET, uploadId: slot.uploadId, path: slot.path, token: slot.token, resumed });
}

// DELETE /api/individual/scholar/uploads?uploadId=... -- SCHOLAR-CE07C: the learner cancels an upload that is not kept
// (or discards an interrupted one). The object is removed if it got to storage. A kept material is deleted from the
// library instead, and an upload being read right now cannot be cancelled.
export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("uploadId");
  if (!isUuid(id)) return NextResponse.json({ error: "That upload could not be found." }, { status: 400 });
  const r = await cancelUpload(ctx.admin, ctx.userId, id, Date.now());
  if (r === "kept") return NextResponse.json({ error: "This file is already kept in your library. Delete it there if you no longer want it." }, { status: 409 });
  if (r === "busy") return NextResponse.json({ error: "This file is being read now and cannot be cancelled. It will finish in a moment." }, { status: 409 });
  if (r === "failed") return NextResponse.json({ error: "The upload could not be cancelled just now. Try again shortly." }, { status: 503 });
  return NextResponse.json({ ok: true, cancelled: id });
}
