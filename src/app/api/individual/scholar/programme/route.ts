import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { learnerProgramme, listProgrammes, setLearnerProgramme } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { contextHistory, loadJoinOptions, setLearnerContext, validateContextChoice } from "@/lib/individual/scholar/context";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/programme -- COMPETEN-SCHOLAR-01 S2 (migration 387), and COMPETEN-SCHOLAR-JOIN-01 J2
// (migration 402): the learner's educational context, changeable later WITH HISTORY.
//
// GET lists the active programmes and the one the person chose, and -- where 402 is applied -- the join
// options (levels, institutions) and the person's context periods. PUT { code, level?, institution? } chooses,
// checked against the governed options. { code: null } clears the choice. Every change is copied into the
// history by the database (402's trigger), so earlier study keeps the context it was done in. Where 387 is
// absent the answer is { provisioned: false } and nothing is offered -- fail closed.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [list, mine] = await Promise.all([listProgrammes(ctx.admin), learnerProgramme(ctx.admin, ctx.userId)]);
  if (!list.ok || !mine.ok) {
    const notProvisioned = (!list.ok && list.notProvisioned) || (!mine.ok && mine.notProvisioned);
    if (notProvisioned) return NextResponse.json({ provisioned: false, programmes: [], current: null });
    return NextResponse.json({ error: "Programmes could not be read just now." }, { status: 503 });
  }
  const [opts, history] = await Promise.all([loadJoinOptions(ctx.admin, await loadIndividualPolicy(ctx.admin)), contextHistory(ctx.admin, ctx.userId)]);
  return NextResponse.json({
    provisioned: true, programmes: list.data, current: mine.data?.code ?? null,
    options: opts.ok ? opts.options : null,
    // Not measured, not empty, where 402 is absent: history: null with the reason.
    history: history.ok ? history.periods : null,
    ...(history.ok ? {} : { historyReason: history.notProvisioned ? "Context history is not set up on this environment." : "Context history could not be read just now." }),
  });
}

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const code = body?.code === null ? null : typeof body?.code === "string" && /^[a-z0-9][a-z0-9-]{1,62}$/.test(body.code) ? body.code : undefined;
  if (code === undefined) return NextResponse.json({ error: "Choose a programme." }, { status: 400 });

  if (code === null) {
    const r = await setLearnerProgramme(ctx.admin, ctx.userId, null);
    if (r === "failed") return NextResponse.json({ error: "Your programme could not be saved just now. Try again shortly." }, { status: 500 });
    await audit(ctx, "individual_scholar_programme_chosen", "individual_scholar_learner", null, { programme_code: null });
    return NextResponse.json({ ok: true, current: null });
  }

  const opts = await loadJoinOptions(ctx.admin, await loadIndividualPolicy(ctx.admin));
  if (!opts.ok) return NextResponse.json({ error: "Programmes could not be read just now." }, { status: 503 });
  const v = validateContextChoice(opts.options, { programme: code, level: body?.level ?? null, institution: body?.institution ?? null });
  if (!v.ok) return NextResponse.json({ error: v.error === "Choose your programme." ? "That programme is not available." : v.error }, { status: v.error === "Choose your programme." ? 404 : 422 });

  let r = await setLearnerContext(ctx.admin, ctx.userId, v.choice);
  // Where 402 is not applied the pointer has no level or institution columns. A programme alone is still
  // recorded the way 387 recorded it; a level or institution is refused rather than silently dropped.
  if (r === "failed" && !v.choice.level && !v.choice.institution) r = (await setLearnerProgramme(ctx.admin, ctx.userId, code)) === "ok" ? "ok" : "failed";
  if (r === "failed") return NextResponse.json({ error: "Your programme could not be saved just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_programme_chosen", "individual_scholar_learner", null, {
    programme_code: code, level_code: v.choice.level?.code ?? null, institution_code: v.choice.institution?.code ?? null,
  });
  return NextResponse.json({ ok: true, current: code, level: v.choice.level?.code ?? null, institution: v.choice.institution?.code ?? null });
}
