// Probe: does staging Supabase Storage accept a TUS resumable upload authorised by a signed upload token (x-signature)?
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const url = env.NEXT_PUBLIC_SUPABASE_URL, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes("ezhvpgtcqcdsgylrxgdb")) throw new Error("not staging");
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = "individual-scholar-materials";
const path = `ce07-probe/${crypto.randomUUID()}.pdf`;
const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
if (error) throw error;
const size = Number(process.argv[2] ?? 7 * 1024 * 1024);
const chunk = Number(process.argv[3] ?? 6 * 1024 * 1024);
const body = new Uint8Array(size); body.set(Buffer.from("%PDF-1.4\n")); for (let i = 9; i < size; i++) body[i] = i % 251;
const b64 = s => Buffer.from(s).toString("base64");
const base = `${url}/storage/v1/upload/resumable/sign`;
const common = { apikey: anon, "x-signature": data.token, "Tus-Resumable": "1.0.0" };
let r = await fetch(base, { method: "POST", headers: { ...common, "Upload-Length": String(size), "Upload-Metadata": `bucketName ${b64(BUCKET)},objectName ${b64(path)},contentType ${b64("application/pdf")},cacheControl ${b64("3600")}` } });
console.log("create", r.status, await r.text().catch(() => ""));
const loc = r.headers.get("location"); console.log("location host ok:", !!loc);
if (!loc) process.exit(1);
let off = 0;
// first chunk then simulate a drop: HEAD
r = await fetch(loc, { method: "PATCH", headers: { ...common, "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" }, body: body.slice(0, Math.min(chunk, size)) });
console.log("patch1", r.status, r.headers.get("upload-offset"), r.status >= 400 ? await r.text() : "");
r = await fetch(loc, { method: "HEAD", headers: common });
console.log("head", r.status, r.headers.get("upload-offset"), r.headers.get("upload-length"));
off = Number(r.headers.get("upload-offset"));
// new token for the same path, continue with it
const t2 = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
console.log("second token issued:", !t2.error, t2.error?.message ?? "");
while (off < size) {
  r = await fetch(loc, { method: "PATCH", headers: { ...common, "x-signature": t2.data?.token ?? data.token, "Upload-Offset": String(off), "Content-Type": "application/offset+octet-stream" }, body: body.slice(off, Math.min(off + chunk, size)) });
  console.log("patch", r.status, r.headers.get("upload-offset"), r.status >= 400 ? await r.text() : "");
  if (r.status >= 400) break;
  off = Number(r.headers.get("upload-offset"));
}
const dl = await admin.storage.from(BUCKET).download(path);
const got = dl.data ? new Uint8Array(await dl.data.arrayBuffer()) : null;
console.log("downloaded", got?.byteLength, "equal", got && got.byteLength === size && got.every((b, i) => b === body[i]));
// wrong-path attempt with the same token must fail
r = await fetch(base, { method: "POST", headers: { ...common, "Upload-Length": "10", "Upload-Metadata": `bucketName ${b64(BUCKET)},objectName ${b64("ce07-probe/other.pdf")},contentType ${b64("application/pdf")}` } });
console.log("other path with token", r.status, (await r.text()).slice(0, 120));
await admin.storage.from(BUCKET).remove([path]);
console.log("cleaned");
