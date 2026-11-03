// ASMT-SCORING-INTEGRATION-01 staging walk, governance step for the STAGING test copies only: submit (owner), governance decision +
// approve (reviewer fixture id), publish (publisher fixture id) through the SAME server writers the Studio routes call. The browser
// path for the reviewer is not available (stale fixture password; since migration 940 the publisher holds no review right), and
// governance itself was proven in #258 / #260 and is not under test here. The database still applies every independence check.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const ROOT = "C:/Users/elish/Documents/Competen/competen-asmt-import";
const SCRATCH = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/ad33b03e-559c-4ac6-82dd-2eccf47e3e7d/scratchpad";
const ACCOUNTS = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/asmt-demo-accounts.txt";
const req = createRequire(`${ROOT}/package.json`);
req("@next/env").loadEnvConfig(ROOT);
const url = process.env.STAGING_SUPABASE_URL!, key = process.env.STAGING_SERVICE_ROLE_KEY!;
if (!url || !key || url.includes("rnnqhlrcgvsauigxwszl")) { console.error("refusing: not staging"); process.exit(1); }
const admin = req("@supabase/supabase-js").createClient(url, key, { auth: { persistSession: false } });
const mod = async (p: string) => import(pathToFileURL(`${ROOT}/src/lib/assessment/${p}`).href);
const { submitForReview } = await mod("studio/service.ts");
const { recordDecision, approveVersion, publishVersion } = await mod("studio/write.ts");
const kv = (f: string) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const acc = kv(ACCOUNTS);
const reviewer = acc["reviewer.id"], publisher = acc["publisher.id"];
const A = JSON.parse(readFileSync(`${SCRATCH}/walk-si-A.json`, "utf8")) as { codes: string[]; instrumentIds: string[]; versionIds: string[] };
const results: { ok: boolean; what: string }[] = [];
const log = (ok: boolean, what: string) => { results.push({ ok, what }); console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };

async function govern(kind: string, versionId: string, what: string) {
  const table = kind === "scale" ? "asmt_response_scale_version" : "asmt_instrument_version";
  const v0 = await admin.from(table).select(kind === "scale" ? "state, submitted_by, authored_by" : "state, submitted_by, authored_by, requires_domain_review").eq("id", versionId).maybeSingle();
  if (!v0.data) { log(false, `${what}: version not found ${v0.error?.message ?? ""}`); return false; }
  let state = v0.data.state as string;
  const owner = (v0.data.submitted_by ?? v0.data.authored_by?.[0]) as string;
  if (state === "draft") {
    const s = await submitForReview(admin, kind, versionId, owner);
    if (!s.ok) { log(false, `${what}: submit refused: ${s.error} ${JSON.stringify(s.report?.errors ?? []).slice(0, 300)}`); return false; }
    state = "in_review";
  }
  if (state === "in_review") {
    const d = await recordDecision(admin, kind, versionId, reviewer, { reviewKind: "governance", decision: "approved", rationale: "ASMT-SCORING-INTEGRATION-01 staging walk" });
    if (!d.ok) { log(false, `${what}: governance decision refused: ${d.error}`); return false; }
    let a = await approveVersion(admin, kind, versionId);
    if (!a.ok && v0.data.requires_domain_review) {
      const dd = await recordDecision(admin, kind, versionId, reviewer, { reviewKind: "domain", decision: "approved", rationale: "ASMT-SCORING-INTEGRATION-01 staging walk" });
      if (!dd.ok) { log(false, `${what}: domain decision refused: ${dd.error}`); return false; }
      a = await approveVersion(admin, kind, versionId);
    }
    if (!a.ok) { log(false, `${what}: approve refused: ${a.error}`); return false; }
    state = "approved";
  }
  if (state === "approved") {
    const p = await publishVersion(admin, kind, versionId, publisher);
    if (!p.ok) { log(false, `${what}: publish refused: ${p.error}`); return false; }
    state = "published";
  }
  const v1 = await admin.from(table).select("state").eq("id", versionId).maybeSingle();
  log(v1.data?.state === "published", `${what}: ${v1.data?.state} (submitted by the author, approved by the reviewer fixture, published by the publisher fixture, through the server writers)`);
  return v1.data?.state === "published";
}

const it = await admin.from("asmt_item").select("scale_version_id").eq("version_id", A.versionIds[0]).not("scale_version_id", "is", null).limit(1).maybeSingle();
if (!it.data?.scale_version_id) console.log("scale lookup", it.error?.message ?? "no rating item");
await govern("scale", it.data?.scale_version_id, `${A.codes[0]}-SCALE`);
for (let i = 0; i < A.codes.length; i++) await govern("instrument", A.versionIds[i], A.codes[i]);
writeFileSync(`${SCRATCH}/walk-si-G.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
