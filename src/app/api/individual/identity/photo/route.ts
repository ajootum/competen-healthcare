import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { identityOf, loadIdentity, photoUrl, removePhoto, storePhoto } from "@/lib/individual/identity";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/identity/photo -- COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 (590): the person's PRIVATE profile photo.
//   GET     the person's own photo: a redirect to a five-minute signed URL. Nobody else can ask for it here.
//   POST    multipart { file }: a JPEG, PNG or WebP under 5 MB, sniffed from its bytes, stripped of its location,
//           device and text metadata, stored privately. The previous photo is removed.
//   DELETE  remove it.
// ⚠ Never the estate's public avatars bucket, and never profiles.avatar_url.

export async function GET() {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  const url = await photoUrl(ctx.admin, identityOf(await loadIdentity(ctx.admin, ctx.userId)).photoPath);
  if (!url) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  const read = await loadIdentity(ctx.admin, ctx.userId);
  if (read === null) return refuse("Your profile could not be read just now. Nothing was changed.", 503);
  if (!read.provisioned) return refuse("Profile photos are not set up here yet.", 409);
  const { file } = await readBody(req);
  if (!file) return refuse("Choose a photo.");
  const out = await storePhoto(ctx.admin, ctx.userId, file, identityOf(read).photoPath);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_identity_photo_set", "individual_identity_profile", ctx.userId, { experience: null, mime: out.mime, bytes: file.size });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  const read = await loadIdentity(ctx.admin, ctx.userId);
  if (read === null || !read.provisioned) return refuse("Your profile could not be read just now.", 503);
  if (!(await removePhoto(ctx.admin, ctx.userId, identityOf(read).photoPath))) return refuse("Your photo could not be removed just now.", 503);
  await audit(ctx, "individual_identity_photo_removed", "individual_identity_profile", ctx.userId, { experience: null });
  return NextResponse.json({ ok: true });
}
