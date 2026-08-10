import type { WorkspaceContext } from "@/lib/practice/access";
import { GUIDANCE_TABLE, GUIDANCE_SECTION_TABLE, GUIDANCE_MIGRATION } from "@/lib/practice/knowledge";
import { KNOWLEDGE_CAPABILITIES } from "@/lib/practice/knowledge-constants";
import { isMissingTable } from "@/lib/practice/investigations";
import {
  capOfflineGuidance, projectOfflineGuidanceDoc, projectOfflineGuidanceLibrary,
  OFFLINE_GUIDANCE_MAX_DOCUMENTS,
  type GuidanceDocSource, type GuidanceSectionSource,
  type OfflineGuidanceDoc, type OfflineGuidanceLibrary,
} from "@/lib/practice/offline-guidance";

// CP-OFFLINE-SURVEY-001 s9 item 4 — the SERVER half of the cached guidance library.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE `status = 'published'` FILTER IS THE SAFETY CONTROL AND IT IS FIXED HERE, NOT PASSED IN.
//
// `guidanceLibrary()` in knowledge.ts takes a `status` option because the Studio needs to list drafts. An
// offline caller must never be able to reach that: a draft protocol on a device with no connection is
// indistinguishable from an approved one to the person reading it, and the practice never agreed to it.
// So this module does not call guidanceLibrary() -- it runs its own narrow query with the filter welded
// in, and the harness asserts that no caller can widen it.
//
// ⚠ WHY NOT REUSE guidanceLibrary() ANYWAY, given CORE-001 s16 forbids a second implementation of a
// shared metric? Because this is not a metric. guidanceLibrary computes counts, facets, review-overdue
// lists and joins profile names -- all of which this must NOT carry (the names are exactly what s3.8.1's
// reasoning drops). Calling it would mean reading twenty fields and four joins in order to throw all of
// them away, and would put colleagues' names on the wire on the way. What is shared is the TABLE NAME and
// the capability, both imported rather than retyped.
//
// ⚠ TWO READS, NOT A JOIN, AND THE ORDER MATTERS. The document metadata is cheap and is read in full so
// the count of what is in force is TRUE. Sections carry the free-text bodies and are read only for the
// documents that will actually be stored. Reading sections for 400 documents to keep 60 would move
// megabytes to discard them.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

/** Matches guidanceLibrary()'s own ceiling, so the two surfaces agree on what "everything" means. */
const METADATA_LIMIT = 400;

const DOC_COLUMNS =
  "id, code, title, summary, doc_type, specialty, version, effective_from, review_on, updated_at";

export type OfflineGuidanceResult =
  | { ok: true; library: OfflineGuidanceLibrary }
  /** Nothing is cached and nothing is claimed. */
  | { ok: false; reason: string };

/**
 * Every guidance document in force at this practice, projected for a device.
 *
 * ⚠ IT REFUSES RATHER THAN CACHING AN EMPTY LIBRARY WHEN THE READ FAILED. "No guidance is stored" and
 * "this practice has no guidance" are different sentences and only one of them is safe to leave on a
 * device for a week. A practitioner who searches an empty offline library concludes the practice has no
 * protocol; a practitioner told the library could not be read knows to ask somebody.
 *
 * ⚠ AN EMPTY LIBRARY THAT IS GENUINELY EMPTY IS STILL CACHED. That is not the same case: a practice with
 * no published guidance has an accurate answer to give, and giving it is better than the device claiming
 * it knows nothing.
 */
export async function offlineGuidancePayload(
  admin: any, ctx: WorkspaceContext, opts: { at?: Date; timezone: string },
): Promise<OfflineGuidanceResult> {
  // The existing read capability, not a new code. s8: "For phase one: introduce no new capability code" --
  // and migration 210's reasoning is that a protocol is something everybody who reads documents should be
  // able to find. Offline is the same read by the same person.
  if (!ctx.capabilities.includes(KNOWLEDGE_CAPABILITIES.view))
    return { ok: false, reason: "This account cannot read practice guidance, so none is stored on this device." };

  const at = opts.at ?? new Date();

  const { data: docRows, error } = await admin.from(GUIDANCE_TABLE)
    .select(DOC_COLUMNS)
    .eq("workspace_id", ctx.workspaceId)
    // ⚠ WELDED IN. Not an option, not a parameter, not a variable.
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(METADATA_LIMIT);

  if (isMissingTable(error))
    return { ok: false, reason: `Practice guidance is not set up at this practice (migration "${GUIDANCE_MIGRATION}" has not been applied), so none is stored on this device.` };
  // ⚠ A FAILED READ IS NEVER A ZERO. `data == null` with no error is also a failure, not an empty shelf.
  if (error || docRows == null)
    return { ok: false, reason: "The practice guidance could not be read just now, so none was stored on this device." };

  const all = docRows as GuidanceDocSource[];
  if (all.length === 0)
    return {
      ok: true,
      library: projectOfflineGuidanceLibrary({
        workspaceId: ctx.workspaceId, timezone: opts.timezone, asOf: at.toISOString(),
        documents: [], documentsUnavailable: false, dropped: null,
      }),
    };

  // Only the documents that could be stored get their bodies read. See the header.
  const considered = all.slice(0, OFFLINE_GUIDANCE_MAX_DOCUMENTS);
  const ids = considered.map(d => d.id);

  const { data: sectionRows, error: sErr } = await admin.from(GUIDANCE_SECTION_TABLE)
    .select("guidance_id, section_key, heading, body, position")
    .eq("workspace_id", ctx.workspaceId)
    .in("guidance_id", ids)
    .order("position", { ascending: true });

  // ⚠ THE SECTIONS ARE THE DOCUMENT. A title with no body is not guidance -- it is a promise of guidance,
  // and on a device with no connection it is worse than nothing, because the practitioner stops looking.
  // So a failed section read refuses the whole payload rather than caching headings.
  if (sErr || sectionRows == null)
    return { ok: false, reason: "The text of the practice guidance could not be read just now, so none was stored on this device." };

  const byDoc = new Map<string, GuidanceSectionSource[]>();
  for (const s of (sectionRows as GuidanceSectionSource[])) {
    const list = byDoc.get(s.guidance_id);
    if (list) list.push(s); else byDoc.set(s.guidance_id, [s]);
  }

  const projected: OfflineGuidanceDoc[] = considered
    .map(d => projectOfflineGuidanceDoc(d, byDoc.get(d.id) ?? []))
    // ⚠ A DOCUMENT WHOSE SECTIONS ARE ALL EMPTY IS DROPPED, not cached as a shell. Same reason as above.
    // It counts toward `dropped`, because a practitioner who cannot find it deserves to know why.
    .filter(d => d.sections.length > 0);

  const { documents, dropped } = capOfflineGuidance(projected, { totalAvailable: all.length });

  return {
    ok: true,
    library: projectOfflineGuidanceLibrary({
      workspaceId: ctx.workspaceId,
      timezone: opts.timezone,
      asOf: at.toISOString(),
      documents,
      documentsUnavailable: false,
      dropped,
    }),
  };
}
