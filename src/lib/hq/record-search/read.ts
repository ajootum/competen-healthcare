import { NextResponse } from "next/server";
import { matchesSearch } from "@/lib/individual/search/match";
import { hqRecordSearchEnabled } from "./flag";
import type { HqRecordSource } from "./registry";

// HQ-RECORD-SEARCH-01: gate (in the route) -> flag -> read -> match -> return. Matching is server side over a list already read.

export const HQ_SEARCH_MIN = 2;
export const HQ_SEARCH_MAX = 80;
export const HQ_SEARCH_LIMIT = 8;

export type HqSearchHit = { id: string; code: string | null; title: string; href: string };
export type HqSearchResult = { hits: HqSearchHit[]; more: boolean };

/** Pure: the matching, capping and destination for an already-read list. */
export function matchRecords(source: HqRecordSource, rows: { id: string; code: string | null; title: string }[], q: string): HqSearchResult {
  const matched = rows.filter(r => matchesSearch(source.fields.map(f => (f === "code" ? r.code ?? "" : r.title)), q));
  return {
    hits: matched.slice(0, HQ_SEARCH_LIMIT).map(r => ({ id: r.id, code: r.code, title: r.title, href: source.destination(r.id) })),
    more: matched.length > HQ_SEARCH_LIMIT,
  };
}

const NO_STORE = { "Cache-Control": "no-store" };

/** Called by each route AFTER its own hqApiGate has admitted the caller. */
export async function respondRecordSearch(source: HqRecordSource, admin: any, req: Request): Promise<NextResponse> {
  // The flag's state is only ever told to somebody the gate has already admitted.
  if (!(await hqRecordSearchEnabled(admin))) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < HQ_SEARCH_MIN || q.length > HQ_SEARCH_MAX)
    return NextResponse.json({ error: `Search needs ${HQ_SEARCH_MIN} to ${HQ_SEARCH_MAX} characters` }, { status: 400, headers: NO_STORE });
  let rows;
  try { rows = await source.read(admin); }
  catch { return NextResponse.json({ error: "The search source could not be read" }, { status: 502, headers: NO_STORE }); }
  return NextResponse.json(matchRecords(source, rows, q), { headers: NO_STORE });
}
