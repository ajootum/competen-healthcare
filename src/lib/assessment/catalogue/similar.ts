import { must, type Admin } from "./db";

/** A possible duplicate of a title being registered. A warning, never a block. */
export type SimilarInstrument = { id: string; code: string; name: string; familyCode: string | null; familyLabel: string | null; score: number; sameFamily: boolean };

export async function findSimilar(admin: Admin, title: string, family: string | null): Promise<SimilarInstrument[]> {
  const t = title.trim();
  if (t.length < 3) return [];
  const res = await admin.rpc("asmt_catalogue_similar", { p_title: t.slice(0, 200), p_family: family || null });
  const rows = (must(res as { data: Record<string, unknown>[] | null; error: { message: string } | null }, "duplicate check") ?? []) as Record<string, unknown>[];
  return rows.map(r => ({
    id: String(r.id), code: String(r.code), name: String(r.name),
    familyCode: (r.family_code as string | null) ?? null, familyLabel: (r.family_label as string | null) ?? null,
    score: Number(r.score) || 0, sameFamily: !!r.same_family,
  }));
}
