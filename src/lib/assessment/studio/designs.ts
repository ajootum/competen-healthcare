/* eslint-disable @typescript-eslint/no-explicit-any */
// Checklist Studio: checklist versions a template or a layout can be DESIGNED AGAINST (read only, nothing is written to them).
// Server only. Loads the few most recent versions with their engine definitions, so a builder has real sections, groups and items.
import type { createAdminClient } from "@/lib/supabase/server";
import type { InstrumentDef } from "../core";
import { loadInstrumentVersion } from "./read";

type Admin = ReturnType<typeof createAdminClient>;

export interface DesignChoice { id: string; label: string; def: InstrumentDef }

export async function recentDesigns(admin: Admin, limit = 8): Promise<DesignChoice[]> {
  const { data: vs } = await admin.from("asmt_instrument_version").select("id, version_no, instrument_id").order("created_at", { ascending: false }).limit(limit);
  const rows = (vs ?? []) as any[];
  if (!rows.length) return [];
  const loaded = await Promise.all(rows.map((r) => loadInstrumentVersion(admin, r.id)));
  return loaded.filter((l): l is NonNullable<typeof l> => !!l && l.def.items.length > 0)
    .map((l) => ({ id: l.version.id, label: `${l.instrument.code} ${l.instrument.name}, v${l.version.version_no} (${l.def.items.length} items)`, def: l.def }));
}
