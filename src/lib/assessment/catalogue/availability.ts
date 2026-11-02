import { AVAILABILITY_MODES, isEnabledMode, type AvailabilityMode } from "./shape";
import { must, mustOk, type Admin, type Row } from "./db";

/**
 * Availability per product line. It makes an instrument DISCOVERABLE by a product. Whether the product OFFERS it to a
 * person is the product's own policy. A product line with no row is "not enabled". Every active product line is
 * shown, not a fixed list, so a new product line appears here the day it is created.
 */
export type ProductAvailability = { productLine: string; productName: string; mode: AvailabilityMode | null; enabled: boolean; note: string | null; grantedAt: string | null };

export async function loadProductLines(admin: Admin): Promise<{ code: string; name: string }[]> {
  const rows = (must(await admin.from("plat_product_line").select("code, name, is_active, sort").eq("is_active", true).order("sort"), "product lines") ?? []) as Row[];
  return rows.map(r => ({ code: r.code, name: r.name }));
}

export async function loadAvailability(admin: Admin, instrumentId: string, lines?: { code: string; name: string }[]): Promise<ProductAvailability[]> {
  const [pl, av] = await Promise.all([
    lines ? Promise.resolve(lines) : loadProductLines(admin),
    admin.from("asmt_instrument_availability").select("instrument_id, product_line, mode, granted_at, note").eq("instrument_id", instrumentId),
  ]);
  const rows = (must(av as { data: Row[] | null; error: { message: string } | null }, "availability") ?? []) as Row[];
  return pl.map(p => {
    const r = rows.find(x => x.product_line === p.code);
    const mode = (r && (AVAILABILITY_MODES as readonly string[]).includes(r.mode) ? r.mode : null) as AvailabilityMode | null;
    return { productLine: p.code, productName: p.name, mode, enabled: isEnabledMode(mode), note: r?.note ?? null, grantedAt: r?.granted_at ?? null };
  });
}

/** Set one product line. A null mode clears the row (not enabled). The write and its audit event are one transaction. */
export async function setAvailability(admin: Admin, actor: string, instrumentId: string, productLine: string, mode: AvailabilityMode | null, note?: string | null): Promise<void> {
  if (mode !== null && !(AVAILABILITY_MODES as readonly string[]).includes(mode)) throw new Error("Choose available, optional or not available");
  mustOk(await admin.rpc("asmt_catalogue_set_availability", {
    p_instrument: instrumentId, p_product_line: productLine, p_mode: mode, p_note: note ?? null, p_actor: actor,
  }) as { error: { message: string } | null }, "availability");
}
