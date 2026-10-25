import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit } from "@/lib/individual/scholar/http";
import { CKRI_OFF, NOTICE_MISSING, PERMISSIONS, ckriEnabled, participationNotice, readMyChoices, setParticipation } from "@/lib/knowledge/governance";

// Request-time only: it reads the session and the gate, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/research -- COMPETEN-KNOWLEDGE-RESEARCH-01 s3 (K1), migration 440.
//
// GET   the person's FOUR choices, each from its own record, with the notice and whether CKRI is on here.
// POST  { permission: "collective_analytics" | "research_study", projectId?, grant: boolean }
//
// ⚠ ONE PERMISSION PER REQUEST. There is no "accept all" and no bundle: personal AI learning is the Scholar consent
// route, content contribution is the case-library candidacy, and neither can be changed here.
// ⚠ A GRANT needs the gate ON and a published participation notice. A WITHDRAWAL needs neither, ever.
// ⚠ NOTHING HERE TOUCHES SCHOLAR ACCESS. Declining or withdrawing removes no learning.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await readMyChoices(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ error: "Your choices could not be read just now." }, { status: 503 });
  const notice = participationNotice();
  return NextResponse.json({ permissions: PERMISSIONS, choices: r.data, notice, enabled: await ckriEnabled(ctx.admin) });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const permission = body?.permission;
  if (permission !== "collective_analytics" && permission !== "research_study")
    return NextResponse.json({ error: "Choose one research permission. Personal AI learning and content contribution are changed in their own places." }, { status: 400 });
  if (typeof body?.grant !== "boolean") return NextResponse.json({ error: "Say whether to take part or withdraw." }, { status: 400 });
  const projectId = permission === "research_study" && typeof body.projectId === "string" ? body.projectId.slice(0, 40) : null;
  let noticeVersion: string | null = null;
  if (body.grant) {
    if (!(await ckriEnabled(ctx.admin))) return NextResponse.json({ error: CKRI_OFF }, { status: 409 });
    const notice = participationNotice();
    if (!notice) return NextResponse.json({ error: NOTICE_MISSING }, { status: 409 });
    noticeVersion = notice.version;
  }
  const r = await setParticipation(ctx.admin, ctx.userId, permission, projectId, body.grant, noticeVersion);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  if (r.changed) await audit(ctx, body.grant ? "ckri_participation_granted" : "ckri_participation_withdrawn", "ckri_participation", projectId,
    { permission, notice_version: noticeVersion });
  return NextResponse.json({ ok: true, granted: body.grant, changed: r.changed });
}
