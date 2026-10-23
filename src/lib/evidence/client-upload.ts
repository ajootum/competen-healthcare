import { createClient } from "@/lib/supabase/client";
import { fileProblem } from "./upload";

// The browser side of an evidence upload (§E). The file goes STRAIGHT to the private bucket on a one-time
// signed URL the server issued for a path it chose (POST /api/evidence, JSON), then the server records it
// (PUT /api/evidence). Nothing large travels through a route handler, so the 10 MB / 50 MB limits hold on
// Vercel, whose functions accept a request body of about 4.5 MB. See src/lib/evidence/upload.ts.

export type EvidenceLinks = { skill_log_entry_id?: string; credential_id?: string; competency_id?: string; note?: string };
export type UploadedEvidence = { id: string; file_name: string; mime_type: string; size_bytes: number; created_at: string };

export async function uploadEvidence(file: File, links: EvidenceLinks): Promise<{ ok: true; evidence: UploadedEvidence } | { ok: false; error: string }> {
  // The same rules the server applies, checked first so a too-large file is refused at once.
  const problem = fileProblem(file);
  if (problem) return { ok: false, error: problem };

  const slotRes = await fetch("/api/evidence", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: file.name, mime_type: file.type, size_bytes: file.size, ...links }),
  });
  const slot = await slotRes.json().catch(() => ({}));
  if (!slotRes.ok || !slot?.token) return { ok: false, error: slot?.error ?? "Upload failed" };

  const { error: upErr } = await createClient().storage.from(slot.bucket).uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
  if (upErr) return { ok: false, error: upErr.message || "Upload failed" };

  const doneRes = await fetch("/api/evidence", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: slot.upload_id, file_name: file.name, ...links }),
  });
  const done = await doneRes.json().catch(() => ({}));
  if (!doneRes.ok || !done?.evidence) return { ok: false, error: done?.error ?? "Upload failed" };
  return { ok: true, evidence: done.evidence };
}
