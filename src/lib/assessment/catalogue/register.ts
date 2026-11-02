import { must, type Admin } from "./db";

/**
 * Register an instrument identity. ONE database call: asmt_catalogue_register assigns the next code of the family
 * (asmt_assign_catalogue_code) and inserts the master record in the same transaction. There is no version and no
 * content: the author continues in Checklist Studio. The Studio create path calls the same function.
 */
export type RegisterInput = {
  family: string;
  name: string;
  description?: string | null;
  /** [{ term_id, is_primary }] as classify takes them. */
  terms?: { termId: string; isPrimary: boolean }[];
  kind?: string | null;
};

export async function registerInstrument(admin: Admin, actor: string, input: RegisterInput): Promise<{ id: string; code: string }> {
  const res = await admin.rpc("asmt_catalogue_register", {
    p_family: input.family,
    p_name: input.name,
    p_description: input.description ?? null,
    p_kind: input.kind ?? null,
    p_actor: actor,
    p_terms: (input.terms ?? []).map(t => ({ term_id: t.termId, is_primary: t.isPrimary })),
  });
  const id = must(res as { data: string | null; error: { message: string } | null }, "register");
  if (!id) throw new Error("register: no identity was created");
  const row = must(await admin.from("asmt_instrument").select("code").eq("id", id).maybeSingle(), "register readback") as { code: string } | null;
  return { id, code: row?.code ?? "" };
}
