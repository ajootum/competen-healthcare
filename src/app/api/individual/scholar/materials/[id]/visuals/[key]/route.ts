import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { VISUAL_HEADERS, materialVisualFile } from "@/lib/individual/scholar/material-visuals-io";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/materials/[id]/visuals/[key] -- SCHOLAR-LESSON-VISUALS-01.
//
// ONE picture exactly as it is in the caller's own file (its key carries a digest of its bytes, so the URL can be cached for
// good). A TIFF or BMP is made lossless PNG, nothing else is changed. A PDF page key answers that page as a one-page PDF.
// Read-only, no AI, nothing audited per picture. Another person's material id is a 404.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string; key: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id, key } = await ctx2.params;
  const r = await materialVisualFile(ctx, id, key);
  if (!r.bytes) return NextResponse.json({ error: r.error ?? "Not found" }, { status: r.status, headers: { "Cache-Control": "private, no-store" } });
  return new Response(Buffer.from(r.bytes), { status: 200, headers: VISUAL_HEADERS(r.maxAge, r.type ?? "application/octet-stream") });
}
