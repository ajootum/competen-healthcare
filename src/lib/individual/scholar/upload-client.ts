// SCHOLAR-CE07C: one Scholar upload in the browser, start to finish, on a slow or intermittent network.
//
//   hash (sha256) -> slot (POST uploads: same identity for the same bytes) -> bytes (resumable, src/lib/uploads)
//   -> finish (POST materials: idempotent, verified, extracted once)
//
// The resume record (localStorage, 24 h, the TUS URL lifetime) lets a closed tab or a reloaded page continue the same
// file from the bytes the server holds: the learner chooses the same file again and only the rest is sent. It holds
// the upload id, the file's name, size and sha256, and the TUS URL. No content.
//
// Every JSON call here is retried on a lost connection: while offline it waits for the connection (the learner sees
// "paused"), otherwise it backs off. The finish is safe to repeat (the server answers a kept upload again).

import { AbortedError, UploadFailed, backoffMs, chunkForConnection, resumableUpload, terminateUpload, xhrTransport, type Transport, type UploadPhase } from "@/lib/uploads/resumable";

export const RESUME_KEY = "competen.scholar.uploads.v1";
export const RESUME_TTL_MS = 24 * 3600_000;

export type ResumeRecord = { uploadId: string; sha256: string; size: number; mime: string; name: string; uploadUrl: string | null; startedAt: number; sent: number };

export type Progress = {
  phase: "hashing" | "starting" | UploadPhase | "reading" | "waiting";
  sent: number;
  total: number;
  retryInMs?: number;
};

export type Outcome =
  | { state: "done"; id: string; partial: boolean; summary?: string }
  | { state: "duplicate"; id: string; message: string }
  | { state: "refused"; message: string }
  | { state: "cancelled" }
  /** Stopped, but the server keeps what was sent: the same file continues from there. */
  | { state: "interrupted"; message: string; sent: number; total: number };

// ── RESUME RECORDS (pure parts tested in upload-client.test.ts) ─────────────────────────────────────

export function liveRecords(records: unknown, nowMs: number): ResumeRecord[] {
  if (!Array.isArray(records)) return [];
  return records.filter((r): r is ResumeRecord => !!r && typeof r === "object"
    && typeof (r as ResumeRecord).uploadId === "string" && typeof (r as ResumeRecord).sha256 === "string"
    && typeof (r as ResumeRecord).startedAt === "number" && nowMs - (r as ResumeRecord).startedAt < RESUME_TTL_MS).slice(0, 20);
}

export const findRecord = (records: ResumeRecord[], f: { sha256: string; size: number; mime: string }) =>
  records.find(r => r.sha256 === f.sha256 && r.size === f.size && r.mime === f.mime) ?? null;

export const withRecord = (records: ResumeRecord[], r: ResumeRecord) => [r, ...records.filter(x => x.sha256 !== r.sha256)].slice(0, 20);

const storage = (): Storage | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };
export function readRecords(nowMs = Date.now()): ResumeRecord[] {
  try { return liveRecords(JSON.parse(storage()?.getItem(RESUME_KEY) ?? "[]"), nowMs); } catch { return []; }
}
function writeRecords(records: ResumeRecord[]) {
  try { storage()?.setItem(RESUME_KEY, JSON.stringify(records)); } catch { /* private mode or full: resume is a convenience */ }
  try { window.dispatchEvent(new Event(RESUME_EVENT)); } catch { /* not in a browser */ }
}

/** For useSyncExternalStore: the stored records as a string (a stable snapshot), and a subscription to changes. */
export const RESUME_EVENT = "competen:scholar-uploads";
export function recordsSnapshot(): string { try { return storage()?.getItem(RESUME_KEY) ?? "[]"; } catch { return "[]"; } }
export function subscribeRecords(onChange: () => void): () => void {
  window.addEventListener(RESUME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(RESUME_EVENT, onChange); window.removeEventListener("storage", onChange); };
}
/** The unfinished uploads in a snapshot, expired ones left out. */
export function recordsFrom(snapshot: string): ResumeRecord[] {
  try { return liveRecords(JSON.parse(snapshot), Date.now()); } catch { return []; }
}
export function saveRecord(r: ResumeRecord) { writeRecords(withRecord(readRecords(), r)); }
export function dropRecord(sha256: string) { writeRecords(readRecords().filter(r => r.sha256 !== sha256)); }

/** The hex sha256 of a file, in the browser (Web Crypto). */
export async function sha256OfFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// ── NETWORK HELPERS ─────────────────────────────────────────────────────────────────────────────────

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const waitOnline = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (online()) return resolve();
  const done = () => { window.removeEventListener("online", done); signal?.removeEventListener("abort", stop); resolve(); };
  const stop = () => { window.removeEventListener("online", done); reject(new AbortedError()); };
  window.addEventListener("online", done, { once: true });
  signal?.addEventListener("abort", stop, { once: true });
});
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new AbortedError());
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new AbortedError()); }, { once: true });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A JSON call that survives a lost connection: offline -> wait for it, network error or a retryable 5xx -> back off.
 * 202 (another finish is reading this upload) -> wait as the server asks and ask again. Returns the final answer.
 */
export async function callJson(url: string, init: { method: string; body?: unknown }, o: {
  signal?: AbortSignal; onWait?: (phase: "offline" | "retrying" | "waiting", retryInMs?: number) => void; maxAttempts?: number; fetchImpl?: typeof fetch;
  isOnline?: () => boolean; waitForOnline?: (s?: AbortSignal) => Promise<void>; sleep?: (ms: number, s?: AbortSignal) => Promise<void>;
} = {}): Promise<{ status: number; json: Json }> {
  const f = o.fetchImpl ?? fetch;
  const isOnline = o.isOnline ?? online;
  const wait = o.waitForOnline ?? waitOnline;
  const nap = o.sleep ?? sleep;
  let failures = 0;
  let waits = 0;
  for (;;) {
    if (o.signal?.aborted) throw new AbortedError();
    let status = 0;
    let json: Json = {};
    try {
      const res = await f(url, { method: init.method, headers: { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: o.signal });
      status = res.status;
      json = await res.json().catch(() => ({}));
    } catch (e) {
      if (o.signal?.aborted) throw new AbortedError();
      void e;
      status = 0;
    }
    if (status === 202 && json.processing && waits < 120) {
      waits += 1;
      o.onWait?.("waiting", Number(json.retryAfterMs) || 5000);
      await nap(Number(json.retryAfterMs) || 5000, o.signal);
      continue;
    }
    const retryable = status === 0 || (status >= 500 && json.retryable === true) || status === 502 || status === 504;
    if (!retryable) return { status, json };
    if (!isOnline()) { o.onWait?.("offline"); await wait(o.signal); continue; }
    failures += 1;
    if (failures > (o.maxAttempts ?? 6)) return { status, json: status ? json : { error: "Competen could not be reached.", network: true } };
    const ms = backoffMs(failures);
    o.onWait?.("retrying", ms);
    await nap(ms, o.signal);
  }
}

// ── ONE FILE ────────────────────────────────────────────────────────────────────────────────────────

export async function uploadScholarFile(file: File, mime: string, o: {
  examPaper?: boolean; examAttested?: boolean; signal?: AbortSignal; onProgress: (p: Progress) => void; transport?: Transport;
  /** Internal: one automatic fresh start after an integrity refusal or a lost object. */
  restarted?: boolean;
}): Promise<Outcome> {
  const total = file.size;
  let sent = 0;
  let phase: Progress["phase"] = "hashing";
  const report = (p: Partial<Progress> = {}) => o.onProgress({ phase, sent, total, ...p });
  const onWait = (w: "offline" | "retrying" | "waiting", retryInMs?: number) => { report({ phase: w, retryInMs }); };
  report();
  const sha256 = await sha256OfFile(file);
  if (o.signal?.aborted) return { state: "cancelled" };
  const record = findRecord(readRecords(), { sha256, size: total, mime });

  phase = "starting"; report();
  const slotReq = (resumeUploadId?: string) => callJson("/api/individual/scholar/uploads", { method: "POST", body: { mime, size: total, piiAttested: true, sha256, ...(resumeUploadId ? { resumeUploadId } : {}) } }, { signal: o.signal, onWait });
  let slot: { status: number; json: Json };
  try { slot = await slotReq(record?.uploadId); } catch (e) { if (e instanceof AbortedError) return { state: "cancelled" }; throw e; }
  if (slot.json.duplicateOf) { dropRecord(sha256); return { state: "duplicate", id: slot.json.duplicateOf.id, message: slot.json.error }; }
  if (slot.status === 0 || slot.json.network) return interrupted("Competen could not be reached. Your file is ready to continue when the connection is back.");
  if (slot.status < 200 || slot.status >= 300) { dropRecord(sha256); return { state: "refused", message: slot.json.error ?? "The upload could not be started." }; }
  const uploadId: string = slot.json.uploadId;
  const rec: ResumeRecord = { uploadId, sha256, size: total, mime, name: file.name, uploadUrl: record?.uploadId === uploadId ? record.uploadUrl : null, startedAt: record?.uploadId === uploadId ? record.startedAt : Date.now(), sent: 0 };
  saveRecord(rec);

  function interrupted(message: string): Outcome { return { state: "interrupted", message, sent, total }; }

  // The bytes. Skipped when the server already holds them (an earlier attempt finished sending).
  if (!slot.json.kept) {
    const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable/sign`;
    const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    let token: string = slot.json.token;
    let lastSave = 0;
    try {
      await resumableUpload({
        file, endpoint, apiKey, bucket: slot.json.bucket, objectName: slot.json.path, contentType: mime, token,
        uploadUrl: rec.uploadUrl, transport: o.transport ?? xhrTransport, chunkSize: chunkForConnection(), signal: o.signal,
        onUploadUrl: (url) => { rec.uploadUrl = url; saveRecord(rec); },
        renewToken: async () => {
          const again = await slotReq(uploadId).catch(() => null);
          if (!again || again.json.uploadId !== uploadId || !again.json.token) return null;
          token = again.json.token;
          return token;
        },
        onProgress: (n) => {
          sent = n; report();
          if (Date.now() - lastSave > 3000) { lastSave = Date.now(); rec.sent = n; saveRecord(rec); }
        },
        onPhase: (p, info) => { phase = p; report({ retryInMs: info?.retryInMs }); },
      });
    } catch (e) {
      if (e instanceof AbortedError || o.signal?.aborted) {
        if (rec.uploadUrl) await terminateUpload(o.transport ?? xhrTransport, rec.uploadUrl, apiKey, token);
        await cancelOnServer(uploadId);
        dropRecord(sha256);
        return { state: "cancelled" };
      }
      if (e instanceof UploadFailed && e.recoverable) { rec.sent = sent; saveRecord(rec); return interrupted(e.message); }
      if (e instanceof UploadFailed && e.code === "unsupported") {
        // The resumable endpoint is not available: the single signed upload the app used before CE-07C.
        const { createClient } = await import("@/lib/supabase/client");
        const { error } = await createClient().storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, token, file, { contentType: mime });
        if (error) return interrupted("It could not be uploaded. Check your connection and try again.");
      } else {
        await cancelOnServer(uploadId);
        dropRecord(sha256);
        return { state: "refused", message: e instanceof Error ? e.message : "It could not be uploaded." };
      }
    }
    rec.sent = total; saveRecord(rec);
  }

  // The finish: verified, read once, safe to repeat.
  sent = total; phase = "reading"; report();
  let done: { status: number; json: Json };
  try {
    done = await callJson("/api/individual/scholar/materials", {
      method: "POST",
      body: { uploadId, mime, fileName: file.name, piiAttested: true, sha256, size: total, ...(o.examPaper ? { examPaper: true, examAttested: o.examAttested } : {}) },
    }, { signal: o.signal, onWait: (w, ms) => { phase = w === "waiting" ? "reading" : w; report({ retryInMs: ms }); }, maxAttempts: 8 });
  } catch (e) {
    if (e instanceof AbortedError) return interrupted("Stopped while your file was being read. Choose it again to see the result: it will not be sent again.");
    throw e;
  }
  if (done.status === 0 || done.json.network) return interrupted("Your file was sent, but Competen could not be reached to read it. Choose it again when the connection is back: it will not be sent again.");
  if (done.json.duplicateOf) { dropRecord(sha256); return { state: "duplicate", id: done.json.duplicateOf.id, message: done.json.error }; }
  if (done.status >= 200 && done.status < 300 && done.json.id) {
    dropRecord(sha256);
    return { state: "done", id: done.json.id, partial: done.json.status === "partial", summary: done.json.quality?.summary };
  }
  // A torn upload (integrity) or an object that is not there: start once more, from the file itself.
  if (!o.restarted && (done.status === 422 && /did not arrive complete/.test(String(done.json.error)) || done.status === 404)) {
    dropRecord(sha256);
    return uploadScholarFile(file, mime, { ...o, restarted: true });
  }
  if (done.json.retryable) return interrupted(`${done.json.error ?? "Your file could not be read just now."} It is kept to continue: it will not be sent again.`);
  dropRecord(sha256);
  return { state: "refused", message: `${done.json.error ?? "It could not be read."}${/Nothing was kept/.test(String(done.json.error)) ? "" : " Nothing was kept."}` };
}

async function cancelOnServer(uploadId: string) {
  try { await fetch(`/api/individual/scholar/uploads?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" }); } catch { /* the hourly clean-up removes it */ }
}

/** Discard an interrupted upload the learner no longer wants (server object and local record). */
export async function discardInterrupted(r: ResumeRecord): Promise<void> {
  await cancelOnServer(r.uploadId);
  dropRecord(r.sha256);
}

