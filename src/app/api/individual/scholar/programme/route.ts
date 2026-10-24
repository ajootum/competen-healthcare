import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { learnerProgramme, listProgrammes, setLearnerProgramme } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/programme -- COMPETEN-SCHOLAR-01 S2 (migration 387).
//
// GET lists the active programmes and the one the person chose. PUT { code } chooses one, and
// { code: null } clears the choice. Choosing is optional: without a programme Scholar still finds the
// concepts in their notes and proposes no competencies. Where 387 is absent the answer is
// { provisioned: false } and nothing is offered -- fail closed.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [list, mine] = await Promise.all([listProgrammes(ctx.admin), learnerProgramme(ctx.admin, ctx.userId)]);
  if (!list.ok || !mine.ok) {
    const notProvisioned = (!list.ok && list.notProvisioned) || (!mine.ok && mine.notProvisioned);
    if (notProvisioned) return NextResponse.json({ provisioned: false, programmes: [], current: null });
    return NextResponse.json({ error: "Programmes could not be read just now." }, { status: 503 });
  }
  return NextResponse.json({ provisioned: true, programmes: list.data, current: mine.data?.code ?? null });
}

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const code = body?.code === null ? null : typeof body?.code === "string" && /^[a-z0-9][a-z0-9-]{1,62}$/.test(body.code) ? body.code : undefined;
  if (code === undefined) return NextResponse.json({ error: "Choose a programme." }, { status: 400 });
  const r = await setLearnerProgramme(ctx.admin, ctx.userId, code);
  if (r === "unknown_programme") return NextResponse.json({ error: "That programme is not available." }, { status: 404 });
  if (r === "failed") return NextResponse.json({ error: "Your programme could not be saved just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_programme_chosen", "individual_scholar_learner", null, { programme_code: code });
  return NextResponse.json({ ok: true, current: code });
}
