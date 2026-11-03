// Instrument import: the provenance of an imported instrument as the catalogue shows it. The one read of asmt_import that a
// page reaches (the instrument drawer). File name, digest, size, status and dates: no draft, no person.
import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

export type ImportProvenance = { importId: string; fileName: string; sha256: string; byteSize: number; status: string; extractedAt: string; registeredAt: string | null };

export async function loadImportProvenance(admin: Admin, importId: string): Promise<ImportProvenance | null> {
  const { data } = await admin.from("asmt_import").select("id, file_name, file_sha256, byte_size, status, extracted_at, registered_at").eq("id", importId).maybeSingle();
  if (!data) return null;
  const r = data as { id: string; file_name: string; file_sha256: string; byte_size: number; status: string; extracted_at: string; registered_at: string | null };
  return { importId: r.id, fileName: r.file_name, sha256: r.file_sha256, byteSize: r.byte_size, status: r.status, extractedAt: r.extracted_at, registeredAt: r.registered_at };
}
