import { validateTokens, type StyleTokens } from "@/lib/practice/document-style";

// CPR-DOC-CONFIG-001 -- READING A PRACTICE STYLE FROM THE DATABASE.
//
// ⚠ SEPARATE FROM document-style.ts ON PURPOSE, AND A TEST ENFORCES IT. The token contract is imported
// by document-compose.ts, which is pure by design and asserted to be -- it cannot reach a record, and
// nothing it imports may either. Putting this reader in that module made the composer transitively
// able to query, and assertion 6a-i went red the moment it did. The contract stays pure; anything that
// needs a client lives here.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The practice's currently published style, if it has one.
 *
 * Returns the row id as well as the tokens, because a document pins the ID it was rendered with --
 * section 11's "Issued document provenance should include the style/template version used".
 *
 * A style that no longer validates is treated as absent rather than returned. Tokens are validated on
 * the way IN, so this only fires if a schema tightened afterwards -- and in that case a document
 * rendered in the platform baseline is better than one rendered from values the renderer no longer
 * understands.
 */
export async function publishedStyleFor(admin: any, workspaceId: string):
  Promise<{ id: string; tokens: StyleTokens } | null> {
  const { data } = await admin.from("practice_document_style")
    .select("id, tokens").eq("workspace_id", workspaceId).eq("status", "published").maybeSingle();
  if (!data?.tokens || validateTokens(data.tokens).length > 0) return null;
  return { id: data.id as string, tokens: data.tokens as StyleTokens };
}
