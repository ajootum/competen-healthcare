import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { documentMetadataExport } from "@/lib/practice/documents-workspace-review";
import { parseDocFilter } from "@/lib/practice/documents-workspace-constants";
import { audit } from "@/lib/practice/audit";
import { logAccess } from "@/lib/practice/privacy";

// GET /api/v1/practice/documents/export?<the same querystring the register uses>
//
// CPR-DOC-002 s10 "export metadata", and the one half of s20's Phase 4 ("extended import/export") that
// can honestly be built. See the PHASE 4 block at the head of documents-workspace-constants.ts for the
// three halves that cannot.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE SAME PARSER THE PAGES USE. parseDocFilter turns the querystring into the filter, and
// documentRegister applies it. So the file contains exactly the rows of the screen the operator was
// looking at when they pressed export -- one predicate, not two. An export containing a different set of
// rows from the list that produced it cannot be checked by the person who made it.
//
// ⚠ data.export AND document.view, BOTH. The first is the capability to take data off this system --
// seeded to the practitioner and the practice owner, and NOT to the assistant. The second is the
// capability to see documents at all, which the practice OWNER does not hold: migration 195 withholds it
// deliberately because owning a practice is a business role. Either one alone would let somebody export
// a class of record they cannot open.
//
// ⚠ IT IS LOGGED AS A DISCLOSURE, NOT AS A VIEW. CPR-370's access log distinguishes them, and this is
// the one operation in this workspace that produces a file which leaves the machine it was made on. The
// subject kind is `search` rather than a patient's, because a cross-practice export discloses no single
// patient -- the same reading of migration 202's CHECK that the AI assistant made for its practice-level
// context.
//
// ⚠ AND IT REFUSES RATHER THAN SHIPPING A PARTIAL FILE. If any register source could not be read, or any
// returned its row cap, the engine returns 503 with the reason and nothing is written. A screen can show
// "the incoming register could not be read" beside an empty section; a CSV cannot, and it will be opened
// months later by somebody with no way to know a third of the practice is missing from it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("data.export");
  if (isDenied(auth)) return auth;

  const sp: Record<string, string | string[] | undefined> = {};
  req.nextUrl.searchParams.forEach((value, key) => { sp[key] = value; });

  // ⚠ `mine=1` MEANS THE CALLER, AND THE ID COMES FROM THE SERVER-RESOLVED CONTEXT. Never from the
  // querystring. parseDocFilter deliberately does not read `authorId` -- My Documents applies the
  // caller's own id on top of whatever the URL said, for the reason that page's header gives: a filter
  // read from the URL is one edited link away from being somebody else's drafts under your heading.
  // This route holds the same line, so `?authorId=<a colleague>` here is dropped and has no effect.
  const filter = sp.mine === "1"
    ? { ...parseDocFilter(sp), authorId: auth.ctx.userId }
    : parseDocFilter(sp);

  const result = await documentMetadataExport(auth.caller.admin, auth.ctx, filter);
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  await logAccess(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId,
    subjectKind: "search", subjectId: null, patientId: null, action: "export",
    route: "/api/v1/practice/documents/export",
    detail: `Document metadata export: ${result.data.rowCount} rows, filter ${JSON.stringify(filter)}`,
    correlationId: auth.caller.traceId,
  });
  await audit(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, actorId: auth.caller.userId,
    eventType: "practice.documents_exported",
    // The COUNT and the FILTER, never the rows. The trail records what left and on what basis; the file
    // itself is the thing that carries the content, and duplicating it into the audit log would put
    // patient names into a table read by anybody holding access.review.
    payload: { rowCount: result.data.rowCount, filter },
    correlationId: auth.caller.traceId,
  });

  return new NextResponse(result.data.csv, {
    status: 200,
    headers: {
      // text/csv with an explicit charset: the practice's own patient names are not ASCII.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.data.filename}"`,
      // A file of patient metadata must never sit in a shared cache.
      "cache-control": "no-store, private",
    },
  });
}
