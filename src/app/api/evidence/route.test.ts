/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileProblem, MAX_BYTES, MAX_MEDIA_BYTES } from "@/lib/evidence/upload";

// /api/evidence: the multipart path is unchanged, and the direct-upload path (signed URL, then PUT) applies
// the same limits, types, ownership rules, row and audit entry -- with a path the server builds itself.

const ME = { id: "11111111-1111-4111-8111-111111111111", full_name: "Test Nurse", role: "nurse", roles: null, hospital_id: "h1" };
let signedIn = true;
let entryOwner = ME.id;
let stored: { name: string; metadata: { mimetype: string; size: number } }[] = [];
let calls: { table: string; op: string; payload?: any }[] = [];
let storageCalls: { op: string; arg: any; opts?: any }[] = [];
let recordedPaths: string[] = [];

function admin() {
  return {
    from(table: string) {
      const b: any = {
        _eq: {} as Record<string, unknown>,
        select: () => b, order: () => b,
        eq: (k: string, v: unknown) => { b._eq[k] = v; return b; },
        maybeSingle: async () => (table === "evidence" && recordedPaths.includes(String(b._eq.file_path)) ? { data: { id: "e-rec" } } : { data: null }),
        single: async () => {
          if (table === "profiles") return { data: ME };
          if (table === "skill_log_entries") return { data: { nurse_id: entryOwner } };
          if (table === "professional_credentials") return { data: { nurse_id: ME.id } };
          if (table === "evidence") return { data: { id: "e1", file_name: calls.at(-1)?.payload?.file_name, mime_type: calls.at(-1)?.payload?.mime_type, size_bytes: calls.at(-1)?.payload?.size_bytes, created_at: "now" }, error: null };
          return { data: null };
        },
        insert: (payload: any) => { calls.push({ table, op: "insert", payload }); return table === "audit_log" ? Promise.resolve({ error: null }) : b; },
      };
      return b;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => { storageCalls.push({ op: "upload", arg: { bucket, path } }); return { error: null }; },
        remove: async (paths: string[]) => { storageCalls.push({ op: "remove", arg: paths }); return { error: null }; },
        createSignedUploadUrl: async (path: string, opts?: any) => { storageCalls.push({ op: "slot", arg: path, opts }); return { data: { token: "tok", path }, error: null }; },
        list: async (prefix: string, opts: any) => { storageCalls.push({ op: "list", arg: { prefix, opts } }); return { data: stored, error: null }; },
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: ME.id } : null } }) } }),
  createAdminClient: () => admin(),
}));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace" }));

const route = () => import("./route");
const json = (method: string, body: unknown) => new Request("http://x/api/evidence", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { signedIn = true; entryOwner = ME.id; stored = []; calls = []; storageCalls = []; recordedPaths = []; });

describe("the upload rules are the route's original ones", () => {
  it("keeps 10 MB documents, 50 MB audio/video and the same messages", () => {
    expect(fileProblem({ type: "application/pdf", size: MAX_BYTES })).toBeNull();
    expect(fileProblem({ type: "application/pdf", size: MAX_BYTES + 1 })).toBe("File must be between 1 byte and 10 MB");
    expect(fileProblem({ type: "audio/webm", size: MAX_MEDIA_BYTES })).toBeNull();
    expect(fileProblem({ type: "audio/webm", size: MAX_MEDIA_BYTES + 1 })).toBe("Media files must be between 1 byte and 50 MB");
    expect(fileProblem({ type: "application/pdf", size: 0 })).toBe("File must be between 1 byte and 10 MB");
    expect(fileProblem({ type: "text/html", size: 10 })).toMatch(/^Accepted: PDF/);
  });
});

describe("multipart POST, unchanged", () => {
  it("stores under the owner's folder and records the same row and audit entry", async () => {
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4"], "cert one.pdf", { type: "application/pdf" }));
    form.append("skill_log_entry_id", "entry-1");
    const res = await (await route()).POST(new Request("http://x/api/evidence", { method: "POST", body: form }));
    expect(res.status).toBe(201);
    const up = storageCalls.find(c => c.op === "upload")!;
    expect(up.arg.bucket).toBe("evidence");
    expect(up.arg.path).toMatch(new RegExp(`^${ME.id}/[0-9a-f-]{36}-cert one\\.pdf$`));
    const row = calls.find(c => c.table === "evidence")!.payload;
    expect(row).toMatchObject({ owner_id: ME.id, hospital_id: "h1", file_name: "cert one.pdf", mime_type: "application/pdf", kind: "evidence", skill_log_entry_id: "entry-1" });
    expect(calls.find(c => c.table === "audit_log")!.payload).toMatchObject({ action: "upload_evidence", entity_type: "evidence" });
  });

  it("still refuses a file that is not yours to attach to", async () => {
    entryOwner = "someone-else";
    const form = new FormData();
    form.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
    form.append("skill_log_entry_id", "entry-1");
    expect((await (await route()).POST(new Request("http://x/api/evidence", { method: "POST", body: form }))).status).toBe(403);
    expect(storageCalls.some(c => c.op === "upload")).toBe(false);
  });
});

describe("direct upload: signed URL, then PUT", () => {
  it("issues a slot for a 40 MB recording, at a path under the caller's own folder", async () => {
    const res = await (await route()).POST(json("POST", { file_name: "voice note.webm", mime_type: "audio/webm", size_bytes: 40 * 1024 * 1024 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ bucket: "evidence", token: "tok" });
    expect(body.path).toBe(`${ME.id}/${body.upload_id}-voice note.webm`);
    // One-time and non-overwriting: no upsert, so a slot cannot replace an existing object. Supabase signed
    // upload URLs expire after 2 hours (storage-js createSignedUploadUrl).
    expect(storageCalls.find(c => c.op === "slot")!.opts).toBeUndefined();
  });

  it("refuses a slot over the limit, of the wrong type, or for somebody else's record -- before any URL exists", async () => {
    const r = await route();
    expect((await r.POST(json("POST", { file_name: "big.webm", mime_type: "audio/webm", size_bytes: MAX_MEDIA_BYTES + 1 }))).status).toBe(400);
    expect((await r.POST(json("POST", { file_name: "x.html", mime_type: "text/html", size_bytes: 10 }))).status).toBe(400);
    entryOwner = "someone-else";
    expect((await r.POST(json("POST", { file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10, skill_log_entry_id: "entry-1" }))).status).toBe(403);
    expect(storageCalls.some(c => c.op === "slot")).toBe(false);
  });

  it("records the STORED object at a path it rebuilds, ignoring any path or size the body claims", async () => {
    const uploadId = "22222222-2222-4222-8222-222222222222";
    stored = [{ name: `${uploadId}-voice note.webm`, metadata: { mimetype: "audio/webm", size: 40 * 1024 * 1024 } }];
    const res = await (await route()).PUT(json("PUT", { upload_id: uploadId, file_name: "voice note.webm", path: "victim/x.webm", size_bytes: 1, competency_id: "c1", note: "  session  " }));
    expect(res.status).toBe(201);
    expect(storageCalls.find(c => c.op === "list")!.arg.prefix).toBe(ME.id);
    const row = calls.find(c => c.table === "evidence")!.payload;
    expect(row).toMatchObject({ owner_id: ME.id, file_path: `${ME.id}/${uploadId}-voice note.webm`, mime_type: "audio/webm", size_bytes: 40 * 1024 * 1024, competency_id: "c1", note: "session" });
    expect(calls.find(c => c.table === "audit_log")!.payload.action).toBe("upload_evidence");
  });

  it("deletes a stored object that breaks the rules, and records nothing", async () => {
    const uploadId = "33333333-3333-4333-8333-333333333333";
    stored = [{ name: `${uploadId}-page.pdf`, metadata: { mimetype: "text/html", size: 100 } }];
    const res = await (await route()).PUT(json("PUT", { upload_id: uploadId, file_name: "page.pdf" }));
    expect(res.status).toBe(400);
    expect(storageCalls.find(c => c.op === "remove")!.arg).toEqual([`${ME.id}/${uploadId}-page.pdf`]);
    expect(calls.some(c => c.table === "evidence")).toBe(false);
  });

  it("refuses a missing upload, a malformed upload id, and a signed-out caller", async () => {
    const r = await route();
    expect((await r.PUT(json("PUT", { upload_id: "33333333-3333-4333-8333-333333333333", file_name: "gone.pdf" }))).status).toBe(404);
    expect((await r.PUT(json("PUT", { upload_id: "../../etc", file_name: "x.pdf" }))).status).toBe(400);
    signedIn = false;
    expect((await r.PUT(json("PUT", { upload_id: "33333333-3333-4333-8333-333333333333", file_name: "x.pdf" }))).status).toBe(401);
    expect((await r.POST(json("POST", { file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10 }))).status).toBe(401);
  });
});

describe("cleanup of a failed direct upload", () => {
  const del = (q: string) => new Request(`http://x/api/evidence?${q}`, { method: "DELETE" });
  const uploadId = "44444444-4444-4444-8444-444444444444";

  it("discards the caller's own unrecorded upload at the rebuilt path", async () => {
    const res = await (await route()).DELETE(del(`upload_id=${uploadId}&file_name=${encodeURIComponent("my note.webm")}`));
    expect(res.status).toBe(200);
    expect(storageCalls.find(c => c.op === "remove")!.arg).toEqual([`${ME.id}/${uploadId}-my note.webm`]);
  });

  it("never discards a recorded file, on a malformed id, or for a signed-out caller", async () => {
    const r = await route();
    recordedPaths = [`${ME.id}/${uploadId}-kept.pdf`];
    expect((await r.DELETE(del(`upload_id=${uploadId}&file_name=kept.pdf`))).status).toBe(409);
    expect((await r.DELETE(del("upload_id=../x&file_name=a.pdf"))).status).toBe(400);
    signedIn = false;
    expect((await r.DELETE(del(`upload_id=${uploadId}&file_name=a.pdf`))).status).toBe(401);
    expect(storageCalls.some(c => c.op === "remove")).toBe(false);
  });
});
