import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Evidence engine (§E): upload files linked to logbook entries, credentials or
// competencies. Files live in the private "evidence" bucket — every download
// goes through a short-lived signed URL issued here, after a permission check
// (owner, or a verifier role in the same hospital). All actions audit-logged.

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // video/audio evidence (voice notes, recordings)
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MEDIA_MIME = new Set([
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/webm", "audio/wav", "audio/ogg",
]);
const VERIFIER_ROLES = ["assessor", "educator", "hospital_admin", "super_admin"];

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("id, full_name, role, roles, hospital_id").eq("id", user.id).single();
  return me ? { admin, me } : null;
}

function isVerifier(me: { role: string | null; roles: string[] | null }) {
  const roles = me.roles?.length ? me.roles : [me.role].filter(Boolean) as string[];
  return roles.some(r => VERIFIER_ROLES.includes(r));
}

function canAccess(row: { owner_id: string; hospital_id: string | null }, me: { id: string; role: string | null; roles: string[] | null; hospital_id: string | null }) {
  if (row.owner_id === me.id) return true;
  if (!isVerifier(me)) return false;
  const roles = me.roles?.length ? me.roles : [me.role].filter(Boolean) as string[];
  if (roles.includes("super_admin")) return true;
  return !!row.hospital_id && row.hospital_id === me.hospital_id;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, me } = auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "A file is required (multipart form field 'file')" }, { status: 400 });
  }
  const isMedia = MEDIA_MIME.has(file.type);
  if (!ALLOWED_MIME.has(file.type) && !isMedia) {
    return NextResponse.json({ error: "Accepted: PDF, PNG, JPEG, WebP, MP4/WebM video, or MP3/M4A/WAV/OGG/WebM audio" }, { status: 400 });
  }
  if (file.size === 0 || file.size > (isMedia ? MAX_MEDIA_BYTES : MAX_BYTES)) {
    return NextResponse.json({ error: isMedia ? "Media files must be between 1 byte and 50 MB" : "File must be between 1 byte and 10 MB" }, { status: 400 });
  }

  const entryId = (form.get("skill_log_entry_id") as string) || null;
  const credentialId = (form.get("credential_id") as string) || null;
  const competencyId = (form.get("competency_id") as string) || null;
  const note = ((form.get("note") as string) || "").trim() || null;

  // You may only attach evidence to your own records.
  if (entryId) {
    const { data: entry } = await admin.from("skill_log_entries").select("nurse_id").eq("id", entryId).single();
    if (!entry) return NextResponse.json({ error: "Logbook entry not found" }, { status: 404 });
    if (entry.nurse_id !== me.id) return NextResponse.json({ error: "Not your logbook entry" }, { status: 403 });
  }
  if (credentialId) {
    const { data: cred } = await admin.from("professional_credentials").select("nurse_id").eq("id", credentialId).single();
    if (!cred) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    if (cred.nurse_id !== me.id) return NextResponse.json({ error: "Not your credential" }, { status: 403 });
  }

  const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120) || "file";
  const path = `${me.id}/${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from("evidence").upload(path, buffer, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: row, error } = await admin.from("evidence").insert({
    owner_id: me.id, hospital_id: me.hospital_id ?? null,
    file_path: path, file_name: safeName, mime_type: file.type, size_bytes: file.size,
    kind: credentialId ? "credential_document" : "evidence",
    skill_log_entry_id: entryId, credential_id: credentialId, competency_id: competencyId, note,
  }).select("id, file_name, mime_type, size_bytes, created_at").single();
  if (error) {
    await admin.storage.from("evidence").remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: "upload_evidence", entity_type: "evidence", entity_id: row.id, entity_name: safeName,
  });

  return NextResponse.json({ ok: true, evidence: row }, { status: 201 });
}

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, me } = auth;
  const url = new URL(req.url);

  // ?id= → short-lived signed download URL (after permission check)
  const id = url.searchParams.get("id");
  if (id) {
    const { data: row } = await admin.from("evidence")
      .select("id, owner_id, hospital_id, file_path, file_name, mime_type").eq("id", id).single();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canAccess(row, me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: signed, error } = await admin.storage.from("evidence").createSignedUrl(row.file_path, 3600);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl, file_name: row.file_name, mime_type: row.mime_type });
  }

  // ?entry= / ?credential= → list evidence rows for that record
  const entryId = url.searchParams.get("entry");
  const credentialId = url.searchParams.get("credential");
  if (entryId || credentialId) {
    const q = admin.from("evidence").select("id, owner_id, hospital_id, file_name, mime_type, size_bytes, note, created_at");
    const { data: rows } = entryId
      ? await q.eq("skill_log_entry_id", entryId).order("created_at")
      : await q.eq("credential_id", credentialId!).order("created_at");
    const visible = (rows ?? []).filter(r => canAccess(r, me)).map(r => ({
      id: r.id, file_name: r.file_name, mime_type: r.mime_type,
      size_bytes: r.size_bytes, note: r.note, created_at: r.created_at,
    }));
    return NextResponse.json({ evidence: visible });
  }

  return NextResponse.json({ error: "Pass ?id=, ?entry= or ?credential=" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, me } = auth;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { data: row } = await admin.from("evidence").select("id, owner_id, file_path, file_name").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.owner_id !== me.id) return NextResponse.json({ error: "Only the owner can remove evidence" }, { status: 403 });

  await admin.storage.from("evidence").remove([row.file_path]);
  await admin.from("evidence").delete().eq("id", id);
  await admin.from("audit_log").insert({
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: "delete_evidence", entity_type: "evidence", entity_id: id, entity_name: row.file_name,
  });
  return NextResponse.json({ ok: true });
}
