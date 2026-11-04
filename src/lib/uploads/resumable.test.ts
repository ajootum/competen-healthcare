import { describe, expect, it } from "vitest";
import { AbortedError, NetworkError, UploadFailed, backoffMs, classify, resumableUpload, type Transport, type TransportRequest, type UploadPhase } from "./resumable";

// SCHOLAR-CE07C: the retry / resume decisions of the resumable upload, against a fake TUS server that behaves like
// Supabase Storage did on staging (201 + Location on create, 204 + Upload-Offset on PATCH, HEAD returns the offset,
// 403 for a bad token, 404 for an expired upload URL, 400 "already exists" when the object is already there).

type Fault = "drop" | "drop-mid" | "500" | "403" | "404" | "exists";

function fakeServer(opts: { faults?: Partial<Record<string, Fault[]>>; validTokens?: string[]; existing?: boolean } = {}) {
  const uploads = new Map<string, { length: number; bytes: Uint8Array; offset: number }>();
  let stored: Uint8Array | null = opts.existing ? new Uint8Array([1]) : null;
  const log: string[] = [];
  const valid = new Set(opts.validTokens ?? ["t1"]);
  let n = 0;
  const fault = (key: string): Fault | undefined => opts.faults?.[key]?.shift();
  const res = (status: number, headers: Record<string, string> = {}, body = "") =>
    ({ status, header: (k: string) => headers[k.toLowerCase()] ?? null, body });
  const transport: Transport = async (req: TransportRequest) => {
    const key = `${req.method}${req.method === "PATCH" ? `@${req.headers["Upload-Offset"]}` : ""}`;
    log.push(key);
    const f = fault(key) ?? fault(req.method);
    if (f === "drop") throw new NetworkError();
    if (f === "500") return res(500);
    if (f === "404") return res(404);
    if (f === "403") return res(403, {}, "Invalid signature");
    if (!valid.has(req.headers["x-signature"])) return res(403, {}, "Invalid signature");
    if (req.method === "POST") {
      if (stored || f === "exists") return res(400, {}, "The resource already exists");
      const id = `u${++n}`;
      uploads.set(id, { length: Number(req.headers["Upload-Length"]), bytes: new Uint8Array(Number(req.headers["Upload-Length"])), offset: 0 });
      return res(201, { location: `https://x.test/up/${id}` });
    }
    const id = req.url.split("/").pop()!;
    const u = uploads.get(id);
    if (!u) return res(404);
    if (req.method === "HEAD") return res(200, { "upload-offset": String(u.offset), "upload-length": String(u.length) });
    if (req.method === "PATCH") {
      const at = Number(req.headers["Upload-Offset"]);
      if (at !== u.offset) return res(409, {}, "offset mismatch");
      const chunk = new Uint8Array(await req.body!.arrayBuffer());
      // A drop mid-chunk: the server keeps what arrived (half), the client sees no answer.
      if (f === "drop-mid") {
        const half = chunk.slice(0, Math.floor(chunk.length / 2));
        u.bytes.set(half, u.offset); u.offset += half.length;
        req.onProgress?.(half.length);
        throw new NetworkError();
      }
      req.onProgress?.(chunk.length);
      u.bytes.set(chunk, u.offset); u.offset += chunk.length;
      if (u.offset === u.length) { stored = u.bytes; uploads.delete(id); }
      return res(204, { "upload-offset": String(u.offset) });
    }
    return res(204);
  };
  return { transport, log, stored: () => stored, uploads };
}

const file = (size: number) => new Blob([Uint8Array.from({ length: size }, (_, i) => i % 251)]);
const same = (a: Uint8Array | null, size: number) => !!a && a.length === size && a.every((b, i) => b === i % 251);
const base = { endpoint: "https://x.test/storage/v1/upload/resumable/sign", apiKey: "anon", bucket: "b", objectName: "u/id.pdf", contentType: "application/pdf", token: "t1", chunkSize: 300 * 1024, sleep: async () => {}, random: () => 0.5 };

describe("resumableUpload (SCHOLAR-CE07C)", () => {
  it("uploads in chunks, reports honest progress, ends complete", async () => {
    const s = fakeServer();
    const seen: number[] = [];
    const r = await resumableUpload({ ...base, file: file(1_000_000), transport: s.transport, onProgress: (sent) => seen.push(sent) });
    expect(r.alreadyStored).toBe(false);
    expect(same(s.stored(), 1_000_000)).toBe(true);
    expect(seen.at(-1)).toBe(1_000_000);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1] || v === seen[i - 1])).toBe(true);
  });

  it("a connection dropped mid-chunk resumes from the SERVER's offset (HEAD), no byte sent twice, no gap", async () => {
    const s = fakeServer({ faults: { [`PATCH@${300 * 1024}`]: ["drop-mid"] } });
    const phases: UploadPhase[] = [];
    await resumableUpload({ ...base, file: file(1_000_000), transport: s.transport, onPhase: p => phases.push(p) });
    expect(same(s.stored(), 1_000_000)).toBe(true);
    expect(s.log).toContain("HEAD");
    // after the drop the next PATCH starts at the half-chunk offset the server reported, not at the chunk start
    const afterHead = s.log.slice(s.log.indexOf("HEAD") + 1)[0];
    expect(afterHead).toBe(`PATCH@${300 * 1024 + 150 * 1024}`);
    expect(phases).toContain("retrying");
    expect(phases).toContain("resumed");
  });

  it("offline: pauses without counting retries, continues when the connection is back", async () => {
    const s = fakeServer({ faults: { PATCH: ["drop", "drop", "drop"] } });
    let online = true;
    let waits = 0;
    const phases: UploadPhase[] = [];
    let drops = 0;
    const t: Transport = async (req) => { if (req.method === "PATCH" && drops++ < 3) online = false; return s.transport(req); };
    await resumableUpload({
      ...base, file: file(700_000), transport: t, maxAttempts: 1, onPhase: p => phases.push(p),
      isOnline: () => online, waitForOnline: async () => { waits += 1; online = true; },
    });
    expect(waits).toBe(3); // three offline spells, none counted against maxAttempts = 1
    expect(phases).toContain("offline");
    expect(same(s.stored(), 700_000)).toBe(true);
  });

  it("server errors back off and retry; too many with no progress gives up RECOVERABLY", async () => {
    const s = fakeServer({ faults: { PATCH: ["500", "500", "500", "500", "500"] } });
    const waits: number[] = [];
    const err = await resumableUpload({ ...base, file: file(500_000), transport: s.transport, maxAttempts: 3, sleep: async (ms) => { waits.push(ms); } }).catch(e => e);
    expect(err).toBeInstanceOf(UploadFailed);
    expect((err as UploadFailed).code).toBe("stalled");
    expect((err as UploadFailed).recoverable).toBe(true);
    expect(waits).toEqual([750, 1500, 3000]); // 1 s, 2 s, 4 s times 0.75 at random 0.5
  });

  it("failures interleaved with progress never exhaust the attempts", async () => {
    const s = fakeServer({ faults: { [`PATCH@0`]: ["500", "500"], [`PATCH@${300 * 1024}`]: ["500", "500"], [`PATCH@${600 * 1024}`]: ["500", "500"] } });
    await resumableUpload({ ...base, file: file(1_000_000), transport: s.transport, maxAttempts: 2 });
    expect(same(s.stored(), 1_000_000)).toBe(true);
  });

  it("resumes an earlier upload URL (closed tab): HEAD first, then only the missing bytes", async () => {
    const s = fakeServer({ faults: { [`PATCH@${300 * 1024}`]: ["drop"] } });
    let url: string | null = null;
    const err = await resumableUpload({ ...base, file: file(1_000_000), transport: s.transport, maxAttempts: 0, onUploadUrl: u => { url = u; }, isOnline: () => true }).catch(e => e);
    expect(err).toBeInstanceOf(UploadFailed); // the "tab closed" here
    expect(url).toBeTruthy();
    s.log.length = 0;
    await resumableUpload({ ...base, file: file(1_000_000), transport: s.transport, uploadUrl: url });
    expect(s.log[0]).toBe("HEAD");
    expect(s.log).not.toContain("POST");
    expect(s.log[1]).toBe(`PATCH@${300 * 1024}`);
    expect(same(s.stored(), 1_000_000)).toBe(true);
  });

  it("an expired upload URL (404) starts a new upload of the same path", async () => {
    const s = fakeServer();
    await resumableUpload({ ...base, file: file(400_000), transport: s.transport, uploadUrl: "https://x.test/up/gone" });
    expect(s.log.slice(0, 2)).toEqual(["HEAD", "POST"]);
    expect(same(s.stored(), 400_000)).toBe(true);
  });

  it("an expired token is renewed for the same path and the upload continues", async () => {
    const s = fakeServer({ validTokens: ["t1", "t2"], faults: { [`PATCH@${300 * 1024}`]: ["403"] } });
    let renewed = 0;
    await resumableUpload({ ...base, file: file(700_000), transport: s.transport, renewToken: async () => { renewed += 1; return "t2"; } });
    expect(renewed).toBe(1);
    expect(same(s.stored(), 700_000)).toBe(true);
  });

  it("no renewal available: a token refusal stops recoverably, never silently", async () => {
    const s = fakeServer({ validTokens: ["t1"], faults: { POST: ["403"] } });
    const err = await resumableUpload({ ...base, file: file(1000), transport: s.transport }).catch(e => e);
    expect(err).toBeInstanceOf(UploadFailed);
    expect((err as UploadFailed).code).toBe("token");
  });

  it("the object already at the path (an earlier attempt finished): no bytes sent, reported as already stored", async () => {
    const s = fakeServer({ existing: true });
    const r = await resumableUpload({ ...base, file: file(400_000), transport: s.transport });
    expect(r.alreadyStored).toBe(true);
    expect(s.log.filter(l => l.startsWith("PATCH"))).toHaveLength(0);
  });

  it("cancel aborts at once and does not retry", async () => {
    const s = fakeServer();
    const ac = new AbortController();
    const t: Transport = async (req) => { if (req.method === "PATCH") ac.abort(); return s.transport(req); };
    const err = await resumableUpload({ ...base, file: file(1_000_000), transport: t, signal: ac.signal }).catch(e => e);
    expect(err).toBeInstanceOf(AbortedError);
    expect(s.log.filter(l => l === "HEAD")).toHaveLength(0);
  });

  it("classify and backoff", () => {
    expect(classify(204)).toBe("ok");
    expect(classify(403)).toBe("token");
    expect(classify(404)).toBe("gone");
    expect(classify(409)).toBe("retry");
    expect(classify(503)).toBe("retry");
    expect(classify(413)).toBe("too_large");
    expect(classify(400)).toBe("refused");
    expect(backoffMs(1, () => 0.999)).toBeLessThanOrEqual(1000);
    expect(backoffMs(1, () => 0)).toBe(500);
    expect(backoffMs(20, () => 0.999)).toBeLessThanOrEqual(30_000);
  });
});
