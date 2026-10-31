/* eslint-disable @typescript-eslint/no-explicit-any */
import { publishScope, rollbackVersion, setOverride, type WceActor, type WceResult } from "@/lib/config/workspace-config-write";
import {
  CONTENT_REVIEW_PRODUCTS, CONTENT_REVIEW_SCOPE, contentReviewPath, resolveContentReview, validateContentReview,
  type ContentReviewPolicy, type ContentReviewProduct,
} from "./content-review";

// ── CLINICAL EDUCATIONAL CONTENT REVIEW RULES: WHAT HQ DOES WITH THEM ── SCHOLAR-FLASHCARDS-QA-01 (c) ─────────────────
//
// Draft, publish, version history and roll back -- the CONFIG-002 engine (workspace-config-write.ts) exactly as the AI
// operating modes use it, in the rules' own scope (platform / ai_content_review). The door is /api/hq/ai-governance,
// gated by hq.platform.ai.manage. A draft is validated strictly before it is stored: an invalid rule is refused with
// its reason, never silently dropped. No independence (publisher-not-drafter) control exists for this scope -- the only
// database-enforced one in HQ configuration guards lowering clinical approval counts (migration 640) -- and none is
// invented here.

export type ContentReviewView = {
  product: ContentReviewProduct;
  /** What runs: the published document, else the built-in defaults. */
  published: ContentReviewPolicy; hasPublished: boolean; publishedAt: string | null;
  draft: ContentReviewPolicy | null; pending: boolean;
};
export type ContentReviewVersion = { id: string; createdAt: string; label: string | null; note: string | null; publishedBy: string | null };

const rows = async (q: any): Promise<any[] | null> => { try { const { data, error } = await q; return error ? null : (data ?? []); } catch { return null; } };

/** Every product's rules: published (or the defaults) and the draft. null: unreadable (or migration 076 absent). */
export async function loadContentReviewViews(admin: any): Promise<ContentReviewView[] | null> {
  const data = await rows(admin.from("workspace_config_overrides").select("config_path, draft, published, updated_at")
    .eq("scope_type", CONTENT_REVIEW_SCOPE.scopeType).eq("scope_ref", CONTENT_REVIEW_SCOPE.scopeRef));
  if (data === null) return null;
  return CONTENT_REVIEW_PRODUCTS.map(product => {
    const r = data.find((x: any) => x.config_path === contentReviewPath(product));
    return {
      product, published: resolveContentReview(r?.published ?? null), hasPublished: !!r?.published, publishedAt: r?.published ? r.updated_at : null,
      draft: r?.draft ? resolveContentReview(r.draft, "draft") : null,
      pending: !!r && JSON.stringify(r.draft ?? null) !== JSON.stringify(r.published ?? null),
    };
  });
}

/** The scope's published versions, newest first. */
export async function loadContentReviewVersions(admin: any, limit = 15): Promise<ContentReviewVersion[] | null> {
  const data = await rows(admin.from("workspace_config_versions").select("id, created_at, label, note, published_by_name, published_by")
    .eq("scope_type", CONTENT_REVIEW_SCOPE.scopeType).eq("scope_ref", CONTENT_REVIEW_SCOPE.scopeRef).order("created_at", { ascending: false }).limit(limit));
  if (data === null) return null;
  return data.map((v: any) => ({ id: v.id, createdAt: v.created_at, label: v.label ?? null, note: v.note ?? null, publishedBy: v.published_by_name ?? v.published_by ?? null }));
}

/** Save a draft. Refused (422) with the reason when a rule is invalid; nothing is stored then. */
export async function saveContentReviewDraft(admin: any, actor: WceActor, product: unknown, input: unknown): Promise<WceResult> {
  if (!(CONTENT_REVIEW_PRODUCTS as readonly unknown[]).includes(product)) return { ok: false, status: 400, error: "Choose a product." };
  const v = validateContentReview(input);
  if (!v.ok) return { ok: false, status: 422, error: v.error };
  return setOverride(admin, actor, CONTENT_REVIEW_SCOPE, contentReviewPath(product as ContentReviewProduct), v.doc);
}

export const publishContentReview = (admin: any, actor: WceActor, note: string | null) =>
  publishScope(admin, actor, CONTENT_REVIEW_SCOPE, { label: "Clinical educational content review rules", note });

/** Restore a published version of THIS scope only (draft and published), as a new version; anything it did not name is removed. */
export const rollbackContentReview = (admin: any, actor: WceActor, versionId: string) =>
  rollbackVersion(admin, actor, versionId, { scope: CONTENT_REVIEW_SCOPE, prune: true });
