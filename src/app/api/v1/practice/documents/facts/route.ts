import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { selectableFacts, defaultSelection } from "@/lib/practice/document-facts";
import { assistantSettings } from "@/lib/practice/ai-assistant";
import { resolveStyle } from "@/lib/practice/document-style";
import { publishedStyleFor } from "@/lib/practice/document-style-store";

// CPR-DOC-AUTO-001 section 9 -- what this patient's record can offer a document, and what is
// pre-selected. Read-only: offering a fact discloses nothing, so this is document.view rather than
// document.author. The disclosure decision happens at generation.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const patientId = req.nextUrl.searchParams.get("patientId");
  const encounterId = req.nextUrl.searchParams.get("encounterId");
  // CPR-DOC-AUTO-001 s13's date range, for the clinical summary. Practice days, resolved through the
  // practice's timezone by selectableFacts -- not interpreted here.
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const offered = await selectableFacts(auth.caller.admin, auth.ctx, { patientId, encounterId, from, to });
  if (!offered) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  // CPR-DOC-AUTO-001 s10. Whether assisted phrasing may even be OFFERED here -- the practice has
  // turned the assistant on, has accepted the CURRENT disclosure, and a provider that can actually
  // generate is configured. All three, or the option is not shown.
  //
  // s18 forbids exposing prompts, model parameters and internal identifiers to practitioners, so this
  // reports one boolean. The provider and model name stay on the settings screen where an administrator
  // looks, and never travel with a document form.
  const assistant = await assistantSettings(auth.caller.admin, auth.ctx.workspaceId);

  // CPR-DOC-CONFIG-001 s12. The section order this document type would use, so the composer can offer
  // "customise this one" seeded with what it is customising FROM rather than with a guess -- and the
  // locked flag, so a type whose layout is prescribed does not offer a control that cannot apply.
  const docType = req.nextUrl.searchParams.get("docType");
  const practiceStyle = await publishedStyleFor(auth.caller.admin, auth.ctx.workspaceId);
  const style = resolveStyle({ practicePublished: practiceStyle?.tokens, docType });

  return NextResponse.json({
    groups: offered.groups,
    encounterId: offered.encounterId,
    defaultSelected: defaultSelection(offered.groups),
    assistedPhrasingAvailable: assistant.enabled && assistant.noticeCurrent && assistant.configured,
    structure: style.tokens.structure,
    layoutLocked: style.locked,
    layoutLockedReason: style.lockedReason,
    correlationId: auth.caller.traceId,
  });
}
