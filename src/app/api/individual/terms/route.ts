import { NextResponse } from "next/server";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal, contextTermsGate } from "@/lib/individual/guard";
import { isExperienceKey } from "@/lib/individual/experiences";
import { publishedVersions } from "@/lib/individual/legal";

// POST /api/individual/terms -- owner ruling D2: "Capture applicable terms acceptance before pilot use."
// Body: { experience, foundation: { terms, privacy }, experienceDocs: { terms, privacy } } -- the versions
// the person was SHOWN.
//
// ⚠ ACCEPTANCE IS OF WHAT WAS DISPLAYED. If the published versions changed between the page rendering and
// the click, the request is refused (409) and the page re-renders the new documents. Recording consent to
// a version the person never saw would make the record false.
//
// ⚠ IT WRITES ONLY THE CALLER'S OWN ROWS, AND ONLY THE ACCEPTANCE COLUMNS: the membership's three
// foundation columns and the three terms columns of the caller's LIVE rows for this experience. It cannot
// create, extend or end any entitlement. Keys come from the session, never from the body.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const experience = body?.experience;
  const known = isExperienceKey(experience);

  // Guard first (release gate, then gate 3), validation after -- see /api/individual/assistant.
  const ctx = await requireIndividualContext(known ? experience : undefined, { requireTerms: false });
  if (isGuardRefusal(ctx)) return ctx;
  if (!known) return NextResponse.json({ error: "Unknown experience" }, { status: 400 });

  const gate = contextTermsGate(ctx, experience);
  const fCurrent = publishedVersions(gate.foundation.legal);
  const xCurrent = publishedVersions(gate.experience.legal);
  if (!fCurrent || !xCurrent)
    return NextResponse.json({ error: "The terms for this experience have not been published yet." }, { status: 409 });

  const shown = (v: unknown) => (v && typeof v === "object" ? v as { terms?: unknown; privacy?: unknown } : {});
  const sf = shown(body?.foundation), sx = shown(body?.experienceDocs);
  if (sf.terms !== fCurrent.terms || sf.privacy !== fCurrent.privacy || sx.terms !== xCurrent.terms || sx.privacy !== xCurrent.privacy)
    return NextResponse.json({ error: "The terms have changed since this page loaded. Review the current versions." }, { status: 409 });

  const now = new Date().toISOString();
  if (gate.foundation.state !== "accepted") {
    const { error } = await ctx.admin.from("individual_membership")
      .update({ foundation_terms_version: fCurrent.terms, foundation_privacy_version: fCurrent.privacy, foundation_accepted_at: now, updated_at: now })
      .eq("user_id", ctx.userId).eq("status", "active");
    if (error) return NextResponse.json({ error: "Your acceptance could not be recorded. Try again shortly." }, { status: 503 });
  }

  // Recompute with the foundation now accepted: for an experience whose operator publishes the same
  // documents as the foundation, that acceptance already covers it and nothing more is written.
  const after = contextTermsGate({ ...ctx, membership: { ...ctx.membership, foundationAcceptance: { termsVersion: fCurrent.terms, privacyVersion: fCurrent.privacy } } }, experience);
  if (after.experience.state !== "accepted") {
    const { data: liveRows, error: lErr } = await ctx.admin.from("individual_live_entitlement")
      .select("id").eq("user_id", ctx.userId).eq("experience_code", experience).limit(20);
    const ids = ((liveRows ?? []) as { id: string }[]).map(r => r.id);
    if (lErr || !ids.length) return NextResponse.json({ error: "Your acceptance could not be recorded. Try again shortly." }, { status: 503 });
    const { error } = await ctx.admin.from("individual_entitlement")
      .update({ terms_version: xCurrent.terms, privacy_version: xCurrent.privacy, terms_accepted_at: now, updated_at: now })
      .in("id", ids).eq("user_id", ctx.userId);
    if (error) return NextResponse.json({ error: "Your acceptance could not be recorded. Try again shortly." }, { status: 503 });
  }

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action: "individual_terms_accepted", entity_type: "individual_membership", entity_id: ctx.membership.id,
    new_value: { experience, foundation: fCurrent, experience_docs: xCurrent, foundation_entity: gate.foundation.legal.entity, operator_entity: gate.experience.legal.entity },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ accepted: true });
}
