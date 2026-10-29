import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { loadFrameworkPack, renderPackDocx } from "@/lib/competency/review-pack";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/hq/competency/review-pack?frameworkId=... -- one framework's clinical review pack as an editable Word file,
// for its authors (owner, 29 Oct 2026). Every competency at its current content, with its review state, version and
// fingerprint. Read only.
//
// ⚠ GATED BY hqApiGate(["hq.quality.competency.author"]), the right that opens the framework in the Studio.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.quality.competency.author"]);
  if (isHqRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("frameworkId") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Choose a framework." }, { status: 400 });
  const pack = await loadFrameworkPack(ctx.admin, id, ctx.fullName ?? null);
  if (!pack) return NextResponse.json({ error: "That framework could not be read just now, or is not a shared framework." }, { status: 404 });
  const buf = await renderPackDocx(pack);
  return new NextResponse(new Uint8Array(buf), { status: 200, headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="review-pack-${new Date().toISOString().slice(0, 10)}.docx"`,
    "Cache-Control": "no-store",
  } });
}
