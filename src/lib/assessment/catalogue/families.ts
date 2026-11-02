import { must, mustOk, type Admin, type Row } from "./db";

/**
 * Catalogue families live in the 890 registry (asmt_instrument_family). The code is permanent: it is the prefix of every
 * instrument code of the family, so it can be created but not renamed. A family can be hidden (inactive), which stops
 * new registrations in it and removes it from the pickers, and never touches an instrument already registered.
 */
export type Family = { code: string; label: string; isActive: boolean; position: number; instruments: number };

export async function loadFamilies(admin: Admin, opts: { withCounts?: boolean } = {}): Promise<Family[]> {
  const rows = (must(await admin.from("asmt_instrument_family").select("code, label, is_active, position").order("position").order("code"), "families") ?? []) as Row[];
  const counts = new Map<string, number>();
  if (opts.withCounts) {
    await Promise.all(rows.map(async r => {
      const c = await admin.from("asmt_instrument").select("id", { count: "exact", head: true }).eq("family_code", r.code);
      counts.set(r.code, c.count ?? 0);
    }));
  }
  return rows.map(r => ({ code: r.code, label: r.label, isActive: !!r.is_active, position: r.position ?? 0, instruments: counts.get(r.code) ?? 0 }));
}

export const FAMILY_CODE = /^[A-Z]{1,6}$/;

export async function createFamily(admin: Admin, input: { code: string; label: string; position?: number }): Promise<void> {
  const code = input.code.trim().toUpperCase();
  if (!FAMILY_CODE.test(code)) throw new Error("A family code is one to six capital letters");
  if (!input.label.trim()) throw new Error("A family needs a name");
  mustOk(await admin.from("asmt_instrument_family").insert({ code, label: input.label.trim(), position: input.position ?? 100 }), "create family");
}

export async function updateFamily(admin: Admin, code: string, patch: { label?: string; isActive?: boolean; position?: number }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) { if (!patch.label.trim()) throw new Error("A family needs a name"); row.label = patch.label.trim(); }
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.position !== undefined) row.position = patch.position;
  if (!Object.keys(row).length) return;
  mustOk(await admin.from("asmt_instrument_family").update(row).eq("code", code), "update family");
}
