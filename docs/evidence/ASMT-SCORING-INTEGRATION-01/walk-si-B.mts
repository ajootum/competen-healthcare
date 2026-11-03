// ASMT-SCORING-INTEGRATION-01 staging walk, part B: one end-to-end assessment per published instrument through the SAME service
// functions the HQ routes call (createGrant, startInstance, patchResponse, submitInstance) against staging with the service role.
// The grant is accepted the way the learner's product does it (accepted_at / accepted_by on the grant). Ids only are printed.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const ROOT = "C:/Users/elish/Documents/Competen/competen-asmt-import";
const SCRATCH = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/ad33b03e-559c-4ac6-82dd-2eccf47e3e7d/scratchpad";
const req = createRequire(`${ROOT}/package.json`);
req("@next/env").loadEnvConfig(ROOT);
const url = process.env.STAGING_SUPABASE_URL!, key = process.env.STAGING_SERVICE_ROLE_KEY!;
if (!url || !key || url.includes("rnnqhlrcgvsauigxwszl")) { console.error("refusing: not staging"); process.exit(1); }
const admin = req("@supabase/supabase-js").createClient(url, key, { auth: { persistSession: false } });
const mod = async (p: string) => import(pathToFileURL(`${ROOT}/src/lib/assessment/${p}`).href);
const { createGrant } = await mod("assessor/grants.ts");
const { startInstance, patchResponse } = await mod("assessor/instances.ts");
const { submitInstance } = await mod("assessor/submit.ts");
const { loadInstrumentVersion } = await mod("studio/read.ts");
const { toDefinition } = await mod("studio/assemble.ts");
const { summarizeResult } = await mod("import/profiles.ts");
const { evaluate } = await mod("core/index.ts");
const { rkey } = await mod("core/types.ts");

const A = JSON.parse(readFileSync(`${SCRATCH}/walk-si-A.json`, "utf8")) as { codes: string[]; instrumentIds: string[]; versionIds: string[] };
const results: { ok: boolean; what: string }[] = [];
const log = (ok: boolean, what: string) => { results.push({ ok, what }); console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };
const prevFile = `${SCRATCH}/walk-si-B.json`;
const prev: { code: string; instanceId: string; outcome: unknown; summary: unknown }[] = existsSync(prevFile) ? (JSON.parse(readFileSync(prevFile, "utf8")).out ?? []) : [];
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const out: { code: string; instanceId: string; outcome: unknown; summary: unknown }[] = prev.filter((o) => only && !only.includes(o.code) && o.instanceId);

// the earlier accepted grant on staging names a coordinator (holds assign), an assessor with an appointment that holds assess, and a subject
const prior = await admin.from("asmt_respondent_grant").select("granted_by, respondent_id, appointment_id, subject_user_id").not("accepted_at", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
if (!prior.data) { console.error("no earlier accepted grant to take the coordinator / assessor / subject from"); process.exit(1); }
const { granted_by: coordinator, respondent_id: assessor, appointment_id: appointment, subject_user_id: subject } = prior.data as Record<string, string>;
console.log("coordinator", coordinator, "assessor", assessor, "appointment", appointment, "subject", subject);

for (let i = 0; i < A.codes.length; i++) {
  const code = A.codes[i];
  if (only && !only.includes(code)) continue;
  try {
    const pv = await admin.from("asmt_instrument_version").select("respondent_roles").eq("id", A.versionIds[i]).maybeSingle();
    const role = (pv.data?.respondent_roles ?? []).includes("assessor") ? "assessor" : "auditor";
    const g = await createGrant(admin, coordinator, { instrumentId: A.instrumentIds[i], subjectUserId: subject, respondentId: assessor, appointmentId: appointment, respondentRole: role, reason: `ASMT-SCORING-INTEGRATION-01 staging walk: one ${role}-recorded assessment with ${code}` });
    if (!g.ok) { log(false, `${code}: grant refused: ${g.error}`); continue; }
    const acc = await admin.from("asmt_respondent_grant").update({ accepted_at: new Date().toISOString(), accepted_by: subject }).eq("id", g.value.id).eq("subject_user_id", subject).is("accepted_at", null).select("id");
    if (acc.error || !(acc.data ?? []).length) { log(false, `${code}: the subject could not accept the grant: ${acc.error?.message ?? "no row"}`); continue; }
    // the grant's valid_from is the database clock: give the app clock a moment before comparing (grantState)
    await new Promise((r) => setTimeout(r, 4000));
    let st = await startInstance(admin, assessor, g.value.id);
    if (!st.ok) { await new Promise((r) => setTimeout(r, 6000)); st = await startInstance(admin, assessor, g.value.id); }
    if (!st.ok) { log(false, `${code}: start refused: ${st.error}`); continue; }
    const instanceId = st.value.instanceId as string;
    const loaded = await loadInstrumentVersion(admin, A.versionIds[i]);
    const def = toDefinition(loaded.content, { instrumentCode: code, versionNo: loaded.version.version_no, versionId: A.versionIds[i], purposeCode: loaded.version.purpose_code, methodCodes: loaded.version.method_codes });
    const items = def.items as { stable_key: string; code: string; critical: boolean; response_type: string; config: { options?: { code: string; label: string }[] }; scale?: { levels: { code: string; ordinal: number }[] }; fields?: { field_key: string }[] }[];
    const answers: { key: string; value: unknown }[] = [];
    const responses: Record<string, unknown> = {};
    items.forEach((it, k) => {
      const na = k === 2; // the third item is justified not applicable
      if (na) { const v = { state: "not_applicable", reason: "Not applicable to this patient: no device in situ during the audit period." }; answers.push({ key: it.stable_key, value: v }); responses[it.stable_key] = v; return; }
      if (it.response_type === "rating_scale") {
        const grade = String([4, 3, 5, 3, 6, 2, 4][k % 7]);
        const v = { level_code: grade }; answers.push({ key: it.stable_key, value: v }); responses[it.stable_key] = v;
        if (k === 0 && it.fields?.some((f) => f.field_key === "evidence_comments")) answers.push({ key: rkey(it.stable_key, "evidence_comments"), value: { value: "Observed: full respiratory assessment, findings documented at 08:10." } });
      } else {
        const opts = it.config.options ?? [];
        const by = (re: RegExp) => opts.find((o) => re.test(o.label))?.code ?? opts[0]?.code;
        const pick = it.critical ? by(/^yes/i) : [by(/^yes/i), by(/^yes/i), by(/^partial/i), by(/^no/i), by(/^yes/i), by(/^partial/i)][k % 6];
        const v = { value: pick }; answers.push({ key: it.stable_key, value: v }); responses[it.stable_key] = v;
        const field = (fk: string, text: string) => { if (it.fields?.some((f) => f.field_key === fk)) { answers.push({ key: rkey(it.stable_key, fk), value: { value: text } }); responses[rkey(it.stable_key, fk)] = { value: text }; } };
        if (/^no/i.test(opts.find((o) => o.code === pick)?.label ?? "")) { field("documented_finding", "Respiratory rate 16, documented 06:00."); field("observed_finding", "Respiratory rate 24 at 06:15, patient dyspnoeic."); field("discrepancy", "Documented rate does not match the observed rate."); field("action_needed", "Repeat observations and escalate per the deterioration pathway."); field("evidence_comments", "No entry for the 06:00 observation set in the chart."); field("record_reference", "Chart 2026-11-04 p.3"); }
      }
    });
    for (const a of answers) {
      const r = await patchResponse(admin, assessor, instanceId, a.key, a.value, 0);
      if (!r.ok) { log(false, `${code}: answer ${a.key} refused: ${r.error}`); }
    }
    const sub = await submitInstance(admin, assessor, instanceId);
    if (!sub.ok) { log(false, `${code}: submit refused: ${sub.error}`); out.push({ code, instanceId, outcome: null, summary: null }); continue; }
    const ev = evaluate(def, loaded.scoring ?? loaded.version.scoring, responses as any);
    const summary = summarizeResult(def, loaded.scoring ?? loaded.version.scoring, ev, responses as any);
    const o = sub.value.outcome;
    log(o?.outcome_code === "NOT_CONFIGURED" && o?.outcome_class === "incomplete" && !sub.value.backstopApplied, `${code} (${role}): submitted; outcome ${o?.outcome_code} (${o?.outcome_class}), backstop ${sub.value.backstopApplied}: the calculated result stands with the interpretation Not configured`);
    log(!!summary && summary.calculated.length >= 3 && !summary.interpretation.configured, `${code}: summary ${summary?.title}: ${summary?.calculated.map((l: any) => `${l.label} = ${l.value}`).join("; ")}`);
    out.push({ code, instanceId, outcome: o, summary });
  } catch (e) { log(false, `${code}: stopped: ${(e as Error).message.slice(0, 300)}`); }
}
out.sort((a, b) => A.codes.indexOf(a.code) - A.codes.indexOf(b.code));
writeFileSync(`${SCRATCH}/walk-si-B.json`, JSON.stringify({ out, results }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
