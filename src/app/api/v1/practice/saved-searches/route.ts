import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  listSavedSearches, saveSearch, updateSavedSearch, deleteSavedSearch, runSavedSearch,
  recentSearches, clearHistory, quickSearches,
} from "@/lib/practice/saved-search";

// GET    /api/v1/practice/saved-searches            -- saved, recent and quick searches
// GET    /api/v1/practice/saved-searches?run=<id>   -- run one, against the CALLER's permissions
// POST   /api/v1/practice/saved-searches            -- save one
// PATCH  /api/v1/practice/saved-searches            -- favourite or share one
// DELETE /api/v1/practice/saved-searches?id=        -- remove one
// DELETE /api/v1/practice/saved-searches?history=1  -- clear the caller's own history
//
// search.use throughout. Saving a search is not a stronger act than running one, and a saved search
// grants nothing: running it re-applies the reader's own gate.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("search.use");
  if (isDenied(auth)) return auth;

  const run = new URL(req.url).searchParams.get("run");
  if (run) {
    const result = await runSavedSearch(auth.caller.admin, auth.ctx, run);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // `ranAsCaller` says in the payload what the header argues: the results are this reader's, not the
    // owner's. A client cannot present them as anybody else's view.
    return NextResponse.json({ ...result, ranAsCaller: true, correlationId: auth.caller.traceId });
  }

  const [saved, recent] = await Promise.all([
    listSavedSearches(auth.caller.admin, auth.ctx),
    recentSearches(auth.caller.admin, auth.ctx),
  ]);
  return NextResponse.json({
    saved, recent, quick: quickSearches(auth.ctx),
    // No counts travel with a saved search, and the field says why rather than leaving it to be noticed.
    countsOmitted: "a saved search stores no count; running it counts what you may see",
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("search.use");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await saveSearch(auth.caller.admin, auth.ctx, {
    name: String(body.name ?? ""), query: String(body.query ?? ""), filters: body.filters,
    favourite: body.favourite === true, shared: body.shared === true,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ savedSearch: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("search.use");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const result = await updateSavedSearch(auth.caller.admin, auth.ctx, {
    id: String(body.id),
    favourite: body.favourite === undefined ? undefined : body.favourite === true,
    shared: body.shared === undefined ? undefined : body.shared === true,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("search.use");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  if (url.searchParams.get("history") === "1") {
    const result = await clearHistory(auth.caller.admin, auth.ctx);
    return NextResponse.json({ ...(result.ok ? result.data : {}), correlationId: auth.caller.traceId });
  }

  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id or history=1 is required" }, { status: 400 });

  const result = await deleteSavedSearch(auth.caller.admin, auth.ctx, { id, correlationId: auth.caller.traceId });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
