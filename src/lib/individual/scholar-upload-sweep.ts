/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR-CE07C: the hourly platform clean-up of Scholar uploads nobody finished within 24 hours (closed tab, lost
// connection, abandoned). Called by /api/cron/jobs. It LISTS unfinished upload records across learners (migration 960)
// and acts on each through the Scholar store, keyed on that upload's own person (store.ts abandonUpload): a kept
// material is recorded kept, anything else has its object removed and is recorded abandoned. It reads no study
// content (type, size, sha256, state and times only) and writes nothing itself.
//
// It lives outside src/lib/individual/scholar/ on purpose, like the HQ analytics readers: a cross-learner listing is a
// platform job, never a Scholar route, and the Scholar store keys every statement on the caller's own id.
// It is NOT a platform job in src/lib/platform/jobs.ts: that file is reachable from the HQ plane (plane-boundary).

import { isNotProvisioned } from "./access";
import { abandonUpload } from "./scholar/store";
import { ABANDON_AFTER_MS } from "./scholar/upload-record";

export async function sweepAllUploads(admin: any, nowMs: number): Promise<{ provisioned: boolean; abandoned: number; kept: number; skipped: number }> {
  const before = new Date(nowMs - ABANDON_AFTER_MS).toISOString();
  const { data, error } = await admin.from("individual_scholar_upload")
    .select("id, user_id, mime_type, state, processing_started_at, refusal_status, refusal_message")
    .in("state", ["issued", "processing"]).lt("issued_at", before).limit(500);
  if (error) {
    if (isNotProvisioned(error)) return { provisioned: false, abandoned: 0, kept: 0, skipped: 0 };
    throw new Error(error.message);
  }
  const out = { provisioned: true, abandoned: 0, kept: 0, skipped: 0 };
  for (const r of (data ?? []) as any[]) out[await abandonUpload(admin, r.user_id, r, nowMs)] += 1;
  return out;
}
