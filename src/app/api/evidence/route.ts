import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

import { currentTraceId } from "@/lib/trace";
import { estateRolesOf } from "@/lib/roles";
import { BUCKET, evidencePath, fileProblem, isUploadId, safeFileName } from "@/lib/evidence/upload";
// Evidence engine (§E): upload files linked to logbook entries, credentials or
// competencies. Files live in the private "evidence" bucket — every download
// goes through a short-lived signed URL issued here, after a permission check
// (owner, or a verifier role in the same hospital). All actions audit-logged.
//
// Two upload paths, one set of rules (src/lib/evidence/upload.ts):
//   multipart POST            the file passes through this handler (small files)
//   JSON POST, then PUT       a one-time signed upload URL for a server-chosen path, the browser uploads
//                             straight to storage, and PUT records it -- the only way the 10 MB / 50 MB
//                             limits hold on Vercel, which caps a function's request body at ~4.5 MB.

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
  const roles = estateRolesOf(me) as string[];
  return roles.some(r => VERIFIER_ROLES.includes(r));
}

function canAccess(row: { owner_id: string; hospital_id: string | null }, me: { id: string; role: string | null; roles: string[] | null; hospital_id: string | null }) {
  if (row.owner_id === me.id) return true;
  if (!isVerifier(me)) return false;
  const roles = estateRolesOf(me) as string[];
  if (roles.includes("super_admin")) return true;
  return !!row.hospital_id && row.hospital_id === me.hospital_id;
}

type Me = { id: string; full_name: string | null; role: string | null; roles: string[] | null; hospital_id: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;
type Links = { entryId: string | null; credentialId: string | null; competencyId: string | null; note: string | null };

const text = (v: unknown) => (typeof v === "string" && v ? v : null);
const linksFrom = (get: (k: string) => unknown): Links => ({
  entryId: text(get("skill_log_entry_id")),
  credentialId: text(get("credential_id")),
  competencyId: text(get("competency_id")),
  note: (typeof get("note") === "string" ? (get("note") as string).trim() : "") || null,
});

/** You may only attach evidence to your own records. A refusal, or null when the links are yours. */
async function refuseForeignLinks(admin: Admin, me: Me, l: Links): Promise<NextResponse | null> {
  if (l.entryId) {
    const { data: entry } = await admin.from("skill_log_entries").select("nurse_id").eq("id", l.entryId).single();
    if (!entry) return NextResponse.json({ error: "Logbook entry not found" }, { status: 404 });
    if (entry.nurse_id !== me.id) return NextResponse.json({ error: "Not your logbook entry" }, { status: 403 });
  }
  if (l.credentialId) {
    const { data: cred } = await admin.from("professional_credentials").select("nurse_id").eq("id", l.credentialId).single();
    if (!cred) return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    if (cred.nurse_id !== me.id) return NextResponse.json({ error: "Not your credential" }, { status: 403 });
  }
  return null;
}

/** The evidence row and its audit entry, for an object already in the bucket at `path`. Same on both paths. */
async function recordEvidence(admin: Admin, me: Me, l: Links, path: string, safeName: string, mime: string, size: number) {
  const { data: row, error } = await admin.from("evidence").insert({
    owner_id: me.id, hospital_id: me.hospital_id ?? null,
    file_path: path, file_name: safeName, mime_type: mime, size_bytes: size,
    kind: l.credentialId ? "credential_document" : "evidence",
    skill_log_entry_id: l.entryId, credential_id: l.credentialId, competency_id: l.competencyId, note: l.note,
  }).select("id, file_name, mime_type, size_bytes, created_at").single();
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: "upload_evidence", entity_type: "evidence", entity_id: row.id, entity_name: safeName,
  });

  return NextResponse.json({ ok: true, evidence: row }, { status: 201 });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, me } = auth;

  // ── Direct upload, step 1: a one-time signed upload URL for a path this server chooses. ──
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const b = await req.json().catch(() => ({}));
    const problem = fileProblem({ type: String(b?.mime_type ?? ""), size: Number(b?.size_bytes) });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const refusal = await refuseForeignLinks(admin, me, linksFrom(k => b?.[k]));
    if (refusal) return refusal;
    const uploadId = crypto.randomUUID();
    const path = evidencePath(me.id, uploadId, safeFileName(String(b?.file_name ?? "")));
    const { data: slot, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !slot?.token) return NextResponse.json({ error: error?.message ?? "Could not prepare the upload" }, { status: 500 });
    return NextResponse.json({ upload_id: uploadId, bucket: BUCKET, path, token: slot.token }, { status: 201 });
  }

  // ── Multipart: the file passes through this handler. ──
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "A file is required (multipart form field 'file')" }, { status: 400 });
  }
  const problem = fileProblem(file);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const links = linksFrom(k => form.get(k));
  const refusal = await refuseForeignLinks(admin, me, links);
  if (refusal) return refusal;

  const safeName = safeFileName(file.name);
  const path = evidencePath(me.id, crypto.randomUUID(), safeName);
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return recordEvidence(admin, me, links, path, safeName, file.type, file.size);
}

// ── Direct upload, step 2: record an object the browser uploaded with the step-1 URL. ──
// The path is rebuilt from the caller's id, the upload id and the file name -- never taken from the body --
// and the type and size are read from the STORED object, not from what the browser claims. Anything that
// fails the rules is deleted, so a refused upload leaves nothing behind.
export async function PUT(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { admin, me } = auth;

  const b = await req.json().catch(() => ({}));
  if (!isUploadId(b?.upload_id)) return NextResponse.json({ error: "upload_id is required" }, { status: 400 });
  const safeName = safeFileName(String(b?.file_name ?? ""));
  const path = evidencePath(me.id, b.upload_id, safeName);

  const { data: listed, error: listErr } = await admin.storage.from(BUCKET).list(me.id, { search: `${b.upload_id}-` });
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  const stored = (listed ?? []).find((o: { name: string }) => o.name === `${b.upload_id}-${safeName}`);
  if (!stored) return NextResponse.json({ error: "Upload not found -- upload the file first" }, { status: 404 });
  const mime = String(stored.metadata?.mimetype ?? "");
  const size = Number(stored.metadata?.size ?? 0);

  const discard = async (res: NextResponse) => { await admin.storage.from(BUCKET).remove([path]); return res; };
  const problem = fileProblem({ type: mime, size });
  if (problem) return discard(NextResponse.json({ error: problem }, { status: 400 }));
  const links = linksFrom(k => b?.[k]);
  const refusal = await refuseForeignLinks(admin, me, links);
  if (refusal) return discard(refusal);

  return recordEvidence(admin, me, links, path, safeName, mime, size);
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

  const params = new URL(req.url).searchParams;

  // ── Direct upload, cleanup: discard an object whose PUT never succeeded. ──
  // The path is rebuilt from the caller's id, so only the caller's own unrecorded upload can be removed. A
  // path an evidence row already points at is never removed here: that is a recorded file, deleted (or
  // refused, once verified) by the id branch below.
  const uploadId = params.get("upload_id");
  if (uploadId !== null) {
    if (!isUploadId(uploadId)) return NextResponse.json({ error: "upload_id is required" }, { status: 400 });
    const path = evidencePath(me.id, uploadId, safeFileName(params.get("file_name") ?? ""));
    const { data: recorded } = await admin.from("evidence").select("id").eq("file_path", path).maybeSingle();
    if (recorded) return NextResponse.json({ error: "That upload is recorded evidence -- remove it by its id" }, { status: 409 });
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ ok: true, discarded: true });
  }

  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { data: row } = await admin.from("evidence").select("id, owner_id, file_path, file_name, verified, verified_by, status").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.owner_id !== me.id) return NextResponse.json({ error: "Only the owner can remove evidence" }, { status: 403 });

  // XWI P2-11. VERIFIED EVIDENCE IS NO LONGER THE OWNER'S TO DELETE.
  // This was a hard delete -- the row removed and the storage object with it -- with no regard for whether
  // an assessor had already verified the file. Migration 149 added `verified`/`verified_by`/`status`
  // precisely so evidence integrity could be reasoned about, and this path ignored all three.
  //
  // Once verified, the file is not a personal upload any more: it is what a competency decision rests on.
  // Letting the subject of that decision erase it leaves the decision standing with nothing behind it, and
  // an audit_log line naming a file that no longer exists is not the same as the evidence. Withdrawal
  // after verification is an assessor action, not a delete button.
  if (row.verified === true || row.status === "verified") {
    return NextResponse.json({
      error: "This evidence has been verified and supports a competency decision — it can no longer be removed. Ask the assessor who verified it to withdraw it if it is wrong.",
      verified: true, verified_by: row.verified_by ?? null,
    }, { status: 409 });
  }

  await admin.storage.from("evidence").remove([row.file_path]);
  await admin.from("evidence").delete().eq("id", id);
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: me.id, actor_name: me.full_name ?? null,
    action: "delete_evidence", entity_type: "evidence", entity_id: id, entity_name: row.file_name,
  });
  return NextResponse.json({ ok: true });
}
