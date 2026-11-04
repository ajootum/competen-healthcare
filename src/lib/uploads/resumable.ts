// SCHOLAR-CE07C: a resumable upload to Supabase Storage over the TUS protocol, authorised by the SAME one-time signed
// upload token the server already issues for one server-chosen path (POST /storage/v1/upload/resumable/sign with
// `x-signature`). Proved on staging 4 Nov 2026: the token is bound to its path, a token re-issued for the same path
// continues the same upload, HEAD returns the stored offset (docs/evidence/SCHOLAR-CE07/).
//
// Why our own small client and not tus-js-client: no new dependency, and every decision a slow or intermittent
// network forces (pause while offline, back off, resync the offset, renew an expired token, start again when the
// upload URL is gone) is a pure function of the transport's answers, so it is unit-tested with a fake server
// (resumable.test.ts). The browser transport is XMLHttpRequest because fetch reports no upload progress.
//
// Honest progress: `sent` is what the server has confirmed plus what the current chunk has put on the wire. After a
// failure it falls back to the server's offset (HEAD), never "remembered" bytes.

export type TransportResponse = { status: number; header: (name: string) => string | null; body?: string };
export type TransportRequest = {
  method: "POST" | "HEAD" | "PATCH" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: Blob;
  /** Bytes of `body` on the wire so far. */
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
  /** Abort when no byte has moved for this long (a stalled mobile connection never errors on its own). */
  idleTimeoutMs?: number;
};
/** Resolves with the server's answer, or rejects with a NetworkError (no answer at all). */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export class NetworkError extends Error { constructor(m = "network") { super(m); this.name = "NetworkError"; } }
export class AbortedError extends Error { constructor() { super("aborted"); this.name = "AbortedError"; } }
/** The upload cannot go on by itself: `recoverable` means the same file can be continued later (resume record kept). */
export class UploadFailed extends Error {
  constructor(message: string, readonly code: "refused" | "stalled" | "token" | "too_large" | "unsupported", readonly recoverable: boolean) {
    super(message); this.name = "UploadFailed";
  }
}

export type UploadPhase =
  | "starting"
  | "uploading"
  /** No connection: waiting for it to come back. Nothing is counted against the retries. */
  | "offline"
  /** A request failed with the connection up: waiting `retryInMs` before trying again. */
  | "retrying"
  /** The first chunk after an offline spell or a failure has been accepted. */
  | "resumed"
  | "complete";

export type ResumableOptions = {
  file: Blob;
  /** e.g. https://<ref>.supabase.co/storage/v1/upload/resumable/sign */
  endpoint: string;
  apiKey: string;
  bucket: string;
  objectName: string;
  contentType: string;
  /** The current signed upload token. */
  token: string;
  /** A fresh token for the SAME path (the server re-issues it). Called when the server refuses the token. */
  renewToken?: () => Promise<string | null>;
  /** A TUS upload URL from an earlier attempt (resume after a closed tab). */
  uploadUrl?: string | null;
  /** Called once the upload URL is known, so the caller can keep it for a later resume. */
  onUploadUrl?: (url: string) => void;
  onProgress?: (sent: number, total: number) => void;
  onPhase?: (phase: UploadPhase, info?: { retryInMs?: number; attempt?: number }) => void;
  transport: Transport;
  /** Chunk size in bytes. Supabase accepts any size per PATCH (staging: 1 MB and 6 MB both proved). */
  chunkSize?: number;
  /** Consecutive failures with the connection up, with no byte accepted between them, before giving up (recoverable). */
  maxAttempts?: number;
  signal?: AbortSignal;
  isOnline?: () => boolean;
  /** Resolves when the connection is back (or on abort). */
  waitForOnline?: (signal?: AbortSignal) => Promise<void>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  idleTimeoutMs?: number;
};

export const MB = 1024 * 1024;
export const DEFAULT_CHUNK = 6 * MB;
/** A smaller chunk loses less when a weak connection drops mid-chunk. */
export const SLOW_CHUNK = 1 * MB;

/** Full-jitter exponential backoff: 1 s, 2 s, 4 s ... capped at 30 s, times a random factor in [0.5, 1). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + random() / 2));
}

/** What a status means for the loop. Pure, so the decisions are tested apart from any network. */
export function classify(status: number): "ok" | "retry" | "token" | "gone" | "exists" | "too_large" | "refused" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "token";
  if (status === 404 || status === 410) return "gone";
  if (status === 413) return "too_large";
  if (status === 409 || status === 423 || status === 429 || status === 408 || status >= 500 || status === 0) return "retry";
  return "refused";
}

/** Supabase answers an existing object with 400/409 and "already exists" (no upsert on the token). */
const alreadyExists = (r: TransportResponse) => /already exists|Duplicate/i.test(r.body ?? "");

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new AbortedError());
  const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new AbortedError()); };
  signal?.addEventListener("abort", onAbort, { once: true });
});

/**
 * Upload `file` to `bucket/objectName`, resuming `uploadUrl` when given. Resolves when the server holds every byte,
 * or when the object already exists at that path (the caller's finish then verifies size and sha256 on the server,
 * so "already there" can never stand in for a different file). Rejects with AbortedError on cancel, UploadFailed when
 * it cannot continue by itself.
 */
export async function resumableUpload(o: ResumableOptions): Promise<{ uploadUrl: string | null; alreadyStored: boolean }> {
  const total = o.file.size;
  const chunkSize = Math.max(256 * 1024, o.chunkSize ?? DEFAULT_CHUNK);
  const maxAttempts = o.maxAttempts ?? 8;
  const isOnline = o.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const sleep = o.sleep ?? defaultSleep;
  const random = o.random ?? Math.random;
  const waitForOnline = o.waitForOnline ?? ((signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined" || isOnline()) return resolve();
    const done = () => { window.removeEventListener("online", done); signal?.removeEventListener("abort", stop); resolve(); };
    const stop = () => { window.removeEventListener("online", done); reject(new AbortedError()); };
    window.addEventListener("online", done, { once: true });
    signal?.addEventListener("abort", stop, { once: true });
  }));
  let token = o.token;
  let uploadUrl = o.uploadUrl ?? null;
  let offset = 0;
  let failures = 0;
  let tokenRenewals = 0;
  let interrupted = false;
  const phase = (p: UploadPhase, info?: { retryInMs?: number; attempt?: number }) => o.onPhase?.(p, info);
  const progress = (n: number) => o.onProgress?.(Math.min(total, n), total);
  const headers = (extra: Record<string, string> = {}) => ({ apikey: o.apiKey, "x-signature": token, "Tus-Resumable": "1.0.0", ...extra });
  const checkAbort = () => { if (o.signal?.aborted) throw new AbortedError(); };

  /** One failed exchange: pause while offline, otherwise back off. Throws when the attempts are used up. */
  async function onFailure(): Promise<void> {
    checkAbort();
    interrupted = true;
    if (!isOnline()) {
      phase("offline");
      await waitForOnline(o.signal);
      checkAbort();
      phase("uploading"); // connected again: no longer paused ("resumed" once the server accepts a chunk)
      return; // an offline spell is not the server's fault: it does not count
    }
    failures += 1;
    if (failures > maxAttempts)
      throw new UploadFailed("The connection keeps dropping. What was sent is kept: continue when the connection is steadier.", "stalled", true);
    const wait = backoffMs(failures, random);
    phase("retrying", { retryInMs: wait, attempt: failures });
    await sleep(wait, o.signal);
    checkAbort();
    phase("uploading");
  }

  async function renew(): Promise<void> {
    tokenRenewals += 1;
    const next = tokenRenewals <= 2 && o.renewToken ? await o.renewToken().catch(() => null) : null;
    if (!next) throw new UploadFailed("This upload's permission has expired. Choose the file again to continue.", "token", true);
    token = next;
  }

  /** Any exchange: a NetworkError becomes a failure to retry (returns null), an abort propagates. */
  async function exchange(req: TransportRequest): Promise<TransportResponse | null> {
    checkAbort();
    try {
      return await o.transport({ ...req, signal: o.signal, idleTimeoutMs: o.idleTimeoutMs ?? 30_000 });
    } catch (e) {
      if (o.signal?.aborted || e instanceof AbortedError) throw new AbortedError();
      if (e instanceof NetworkError) { await onFailure(); return null; }
      throw e;
    }
  }

  phase("starting");
  progress(0);
  for (;;) {
    checkAbort();
    // 1. Know where the server is: create the upload, or ask an existing one for its offset.
    if (!uploadUrl) {
      const r = await exchange({
        method: "POST", url: o.endpoint,
        headers: headers({
          "Upload-Length": String(total),
          "Upload-Metadata": `bucketName ${b64(o.bucket)},objectName ${b64(o.objectName)},contentType ${b64(o.contentType)},cacheControl ${b64("3600")}`,
        }),
      });
      if (!r) continue;
      const c = classify(r.status);
      if (c === "ok") {
        const loc = r.header("location");
        if (!loc) throw new UploadFailed("The storage service did not accept the upload.", "unsupported", false);
        uploadUrl = new URL(loc, o.endpoint).toString();
        o.onUploadUrl?.(uploadUrl);
        offset = 0;
      } else if (alreadyExists(r)) {
        progress(total); phase("complete");
        return { uploadUrl: null, alreadyStored: true };
      } else if (c === "token") { await renew(); continue; }
      else if (c === "too_large") throw new UploadFailed("This file is larger than storage accepts.", "too_large", false);
      else if (c === "retry") { await onFailure(); continue; }
      else if (c === "gone") throw new UploadFailed("Resumable uploads are not available here.", "unsupported", false);
      else throw new UploadFailed("The storage service refused this upload.", "refused", false);
    } else {
      const r = await exchange({ method: "HEAD", url: uploadUrl, headers: headers() });
      if (!r) continue;
      const c = classify(r.status);
      if (c === "ok") {
        offset = Number(r.header("upload-offset") ?? "0");
        if (!Number.isFinite(offset) || offset < 0 || offset > total) { uploadUrl = null; continue; }
      } else if (c === "gone") { uploadUrl = null; continue; } // expired or already assembled: create again (exists -> done)
      else if (c === "token") { await renew(); continue; }
      else if (c === "retry") { await onFailure(); continue; }
      else { uploadUrl = null; continue; }
    }
    progress(offset);

    // 2. Send the rest, chunk by chunk, from the server's offset.
    let lost = false;
    while (offset < total) {
      checkAbort();
      const end = Math.min(total, offset + chunkSize);
      const start = offset;
      const r = await exchange({
        method: "PATCH", url: uploadUrl!,
        headers: headers({ "Upload-Offset": String(start), "Content-Type": "application/offset+octet-stream" }),
        body: o.file.slice(start, end),
        onProgress: n => progress(start + n),
      });
      if (!r) { lost = true; break; } // resync with HEAD
      const c = classify(r.status);
      if (c === "ok") {
        const next = Number(r.header("upload-offset") ?? String(end));
        offset = Number.isFinite(next) && next > start ? next : end;
        failures = 0; // a byte accepted: the connection works
        tokenRenewals = 0;
        progress(offset);
        if (interrupted) { interrupted = false; phase("resumed"); } else phase("uploading");
        continue;
      }
      if (c === "gone") {
        if (alreadyExists(r)) { progress(total); phase("complete"); return { uploadUrl, alreadyStored: true }; }
        uploadUrl = null; lost = true; break;
      }
      if (c === "token") { await renew(); lost = true; break; }
      if (c === "retry") {
        if (alreadyExists(r)) { progress(total); phase("complete"); return { uploadUrl, alreadyStored: true }; }
        await onFailure(); lost = true; break;
      }
      if (alreadyExists(r)) { progress(total); phase("complete"); return { uploadUrl, alreadyStored: true }; }
      if (c === "too_large") throw new UploadFailed("This file is larger than storage accepts.", "too_large", false);
      throw new UploadFailed("The storage service refused this upload.", "refused", false);
    }
    if (lost) continue;
    progress(total);
    phase("complete");
    return { uploadUrl, alreadyStored: false };
  }
}

/** Best effort: tell the server to drop a part-sent upload (TUS termination). Never throws. */
export async function terminateUpload(transport: Transport, uploadUrl: string, apiKey: string, token: string): Promise<void> {
  try { await transport({ method: "DELETE", url: uploadUrl, headers: { apikey: apiKey, "x-signature": token, "Tus-Resumable": "1.0.0" } }); } catch { /* best effort */ }
}

/** The chunk for this connection: smaller where the browser reports a slow network or data saver. */
export function chunkForConnection(): number {
  if (typeof navigator === "undefined") return DEFAULT_CHUNK;
  const c = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  if (c?.saveData || (c?.effectiveType && /(^|-)2g$|^3g$/.test(c.effectiveType))) return SLOW_CHUNK;
  return DEFAULT_CHUNK;
}

/** The browser transport. XHR, for upload progress events and an idle (no bytes moving) timeout. */
export const xhrTransport: Transport = (req) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open(req.method, req.url, true);
  for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
  let idle: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (!req.idleTimeoutMs) return;
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { xhr.abort(); finish(() => reject(new NetworkError("idle"))); }, req.idleTimeoutMs);
  };
  let settled = false;
  const finish = (f: () => void) => { if (settled) return; settled = true; if (idle) clearTimeout(idle); req.signal?.removeEventListener("abort", onAbort); f(); };
  const onAbort = () => { xhr.abort(); finish(() => reject(new AbortedError())); };
  if (req.signal?.aborted) return reject(new AbortedError());
  req.signal?.addEventListener("abort", onAbort, { once: true });
  xhr.upload.onprogress = (e) => { arm(); req.onProgress?.(e.loaded); };
  xhr.onprogress = arm;
  xhr.onload = () => finish(() => resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader(n), body: typeof xhr.responseText === "string" ? xhr.responseText : undefined }));
  xhr.onerror = () => finish(() => reject(new NetworkError("error")));
  xhr.ontimeout = () => finish(() => reject(new NetworkError("timeout")));
  arm();
  xhr.send(req.body ?? null);
});
