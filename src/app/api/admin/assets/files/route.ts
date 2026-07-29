import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { ASSET_BUCKET, MAX_FILE_BYTES, ALLOWED_MIME, sanitizeFileName, ensureAssetBucket } from "@/lib/assets/files";

// CAP-001 Phase 4 — asset file storage API. Super-admin only. POST uploads a file to the private asset-files
// bucket and records metadata in cap_asset_files; GET lists an asset's files each with a short-lived signed
// URL; DELETE removes the object + row. Bytes are never public — every download is a fresh signed URL.

function migrationGuard(msg: string) {
  return /does not exist|schema cache|could not find the table/i.test(msg);
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Asset files are super-admin only");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const objectType = (form?.get("object_type") as string) || "";
  const objectId = (form?.get("object_id") as string) || "";
  if (!form || !(file instanceof File)) return NextResponse.json({ error: "A file is required (form field 'file')" }, { status: 400 });
  if (!objectType || !objectId) return NextResponse.json({ error: "object_type and object_id are required" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: `Unsupported file type${file.type ? ` (${file.type})` : ""}` }, { status: 400 });
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File must be between 1 byte and 50 MB" }, { status: 400 });

  const bucket = await ensureAssetBucket(c.admin);
  if (!bucket.ok) return NextResponse.json({ error: `Storage unavailable: ${bucket.error}` }, { status: 500 });

  const safeName = sanitizeFileName(file.name);
  const path = `${objectType}/${objectId}/${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await c.admin.storage.from(ASSET_BUCKET).upload(path, buffer, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Resolve the unified header (+ its tenant) if the asset is indexed; harmless if not.
  const { data: asset } = await c.admin.from("cap_assets").select("id, hospital_id").eq("object_type", objectType).eq("object_id", objectId).maybeSingle();
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();

  const { data: row, error } = await c.admin.from("cap_asset_files").insert({
    object_type: objectType, object_id: objectId,
    cap_asset_id: asset?.id ?? null, hospital_id: asset?.hospital_id ?? null,
    file_name: safeName, storage_path: path, mime_type: file.type, size_bytes: file.size,
    uploaded_by: c.userId, uploaded_by_name: me?.full_name ?? null,
  }).select("id, file_name, mime_type, size_bytes, created_at").single();
  if (error) {
    await c.admin.storage.from(ASSET_BUCKET).remove([path]);
    if (migrationGuard(error.message)) return NextResponse.json({ error: "cap_asset_files not migrated — run migration 141", migration: true }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "asset_file_upload", entity_type: "cap_asset_files", entity_id: row.id, entity_name: safeName });
  return NextResponse.json({ ok: true, file: row }, { status: 201 });
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Asset files are super-admin only");
  const p = new URL(req.url).searchParams;
  const objectType = p.get("type"), objectId = p.get("id");
  if (!objectType || !objectId) return NextResponse.json({ error: "type and id are required" }, { status: 400 });

  try {
    const { data: rows } = await c.admin.from("cap_asset_files")
      .select("id, file_name, mime_type, size_bytes, uploaded_by_name, created_at, storage_path")
      .eq("object_type", objectType).eq("object_id", objectId).order("created_at", { ascending: false });
    const files = await Promise.all((rows ?? []).map(async (r: { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; uploaded_by_name: string | null; created_at: string; storage_path: string }) => {
      const { data: signed } = await c.admin.storage.from(ASSET_BUCKET).createSignedUrl(r.storage_path, 3600);
      return { id: r.id, file_name: r.file_name, mime_type: r.mime_type, size_bytes: r.size_bytes, uploaded_by_name: r.uploaded_by_name, created_at: r.created_at, url: signed?.signedUrl ?? null };
    }));
    return NextResponse.json({ files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    if (migrationGuard(msg)) return NextResponse.json({ files: [], migration: true }, { status: 409 });
    return NextResponse.json({ files: [], error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Asset files are super-admin only");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: row } = await c.admin.from("cap_asset_files").select("id, storage_path, file_name").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await c.admin.storage.from(ASSET_BUCKET).remove([row.storage_path]);
  await c.admin.from("cap_asset_files").delete().eq("id", id);
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "asset_file_delete", entity_type: "cap_asset_files", entity_id: id, entity_name: row.file_name });
  return NextResponse.json({ ok: true });
}
