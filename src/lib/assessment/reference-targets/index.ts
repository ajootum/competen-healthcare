/* eslint-disable @typescript-eslint/no-explicit-any */
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * Product adapter for the catalogue's REFERENCE picker: what an instrument can be referenced to.
 *
 * It lives beside the catalogue and not in it, because the catalogue code is universal and must not know any one
 * product's tables (the assessment core harness bans those words from src/lib/assessment/catalogue). A reference stores
 * the id of the authoritative row and a label, never a copy of the row. Adding a target is adding a case here and a kind
 * in the asmt_mapping_kind registry.
 */
type Admin = ReturnType<typeof createAdminClient>;

export const REFERENCE_TARGETS = [
  { key: "frameworks", kind: "framework", label: "Framework" },
  { key: "framework_competencies", kind: "framework_competency", label: "Framework competency" },
] as const;
export type ReferenceTargetKey = (typeof REFERENCE_TARGETS)[number]["key"];
export type ReferenceTarget = { id: string; code: string | null; label: string };

const clean = (q: string) => q.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export async function lookupReferenceTargets(admin: Admin, key: string, q: string): Promise<ReferenceTarget[]> {
  const term = clean(q);
  if (term.length < 2) return [];
  if (key === "frameworks") {
    const res = await admin.from("frameworks").select("id, name, code").is("hospital_id", null)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`).order("name").limit(20);
    if (res.error) throw new Error(`framework lookup: ${res.error.message}`);
    return ((res.data ?? []) as any[]).map(r => ({ id: r.id, code: r.code ?? null, label: r.name }));
  }
  if (key === "framework_competencies") {
    const res = await admin.from("framework_competencies").select("id, name, code").is("practice_id", null)
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`).order("name").limit(20);
    if (res.error) throw new Error(`competency lookup: ${res.error.message}`);
    return ((res.data ?? []) as any[]).map(r => ({ id: r.id, code: r.code ?? null, label: r.name }));
  }
  throw new Error("Unknown reference target");
}
