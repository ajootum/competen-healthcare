import { must, mustOk, type Admin, type Row } from "./db";

/**
 * Collections: a named, owned list of instruments (a pack for a programme, a ward, an audit cycle). Membership is a
 * list, not a classification, and an instrument may sit in many collections. Phase 1 has list, add and remove.
 */
export type Collection = { id: string; code: string; name: string; description: string | null; isActive: boolean; owner: string; members: number };

export async function loadCollections(admin: Admin): Promise<Collection[]> {
  const rows = (must(await admin.from("asmt_collection").select("id, code, name, description, is_active, owner_scope").order("name"), "collections") ?? []) as Row[];
  const counts = new Map<string, number>();
  await Promise.all(rows.map(async r => {
    const c = await admin.from("asmt_collection_member").select("instrument_id", { count: "exact", head: true }).eq("collection_id", r.id);
    counts.set(r.id, c.count ?? 0);
  }));
  return rows.map(r => ({
    id: r.id, code: r.code, name: r.name, description: r.description ?? null, isActive: !!r.is_active,
    owner: r.owner_scope === "holdings" ? "Competen Holdings" : String(r.owner_scope), members: counts.get(r.id) ?? 0,
  }));
}

/** The collections one instrument sits in. */
export async function loadInstrumentCollections(admin: Admin, instrumentId: string): Promise<{ id: string; code: string; name: string }[]> {
  const m = (must(await admin.from("asmt_collection_member").select("collection_id, instrument_id, position").eq("instrument_id", instrumentId), "collection members") ?? []) as Row[];
  if (!m.length) return [];
  const rows = (must(await admin.from("asmt_collection").select("id, code, name").in("id", m.map(x => x.collection_id)).order("name"), "collections") ?? []) as Row[];
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name }));
}

export const COLLECTION_CODE = /^[A-Z0-9-]{3,40}$/;

export async function createCollection(admin: Admin, actor: string, input: { code: string; name: string; description?: string | null }): Promise<void> {
  const code = input.code.trim().toUpperCase();
  if (!COLLECTION_CODE.test(code)) throw new Error("A collection code is 3 to 40 capital letters, digits or hyphens");
  if (!input.name.trim()) throw new Error("A collection needs a name");
  mustOk(await admin.from("asmt_collection").insert({ code, name: input.name.trim(), description: input.description?.trim() || null, created_by: actor }), "create collection");
}

export async function updateCollection(admin: Admin, id: string, patch: { name?: string; description?: string | null; isActive?: boolean }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) { if (!patch.name.trim()) throw new Error("A collection needs a name"); row.name = patch.name.trim(); }
  if (patch.description !== undefined) row.description = patch.description?.trim() || null;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (!Object.keys(row).length) return;
  mustOk(await admin.from("asmt_collection").update(row).eq("id", id), "update collection");
}

/** Add or remove one instrument. The change and its audit event are one database transaction. */
export async function setCollectionMember(admin: Admin, actor: string, collectionId: string, instrumentId: string, add: boolean): Promise<void> {
  mustOk(await admin.rpc("asmt_catalogue_collection_member", { p_collection: collectionId, p_instrument: instrumentId, p_add: add, p_actor: actor }) as { error: { message: string } | null }, "collection");
}
