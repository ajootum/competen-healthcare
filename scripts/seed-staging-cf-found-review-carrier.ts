/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * IND-007 owner decision D2 -- route CF-FOUND into the staging clinical-content review workflow (migration 395).
 *
 *   npx tsx scripts/seed-staging-cf-found-review-carrier.ts            create the review carrier (idempotent)
 *   npx tsx scripts/seed-staging-cf-found-review-carrier.ts --status   read only: the four states of every CF-FOUND competency
 *
 * STAGING ONLY. What it does, and what it does NOT do:
 *   - It creates ONE draft, shared catalogue, "CF-FOUND clinical review carrier (synthetic, staging)", that NAMES the
 *     eight CF-FOUND competencies (competency_catalogue_entry, through the governed addEntries library). The curator's
 *     review action (POST /api/hq/individual/catalogues {action:"review"}) puts forward only catalogue entries, and
 *     no catalogue named CF-FOUND's competencies. Approved by the owner 2026-10-24.
 *   - CF-FOUND itself is NOT changed: its domains, competencies, learning outcomes, CPUs (none) and relationships are
 *     exactly as they were. The carrier is never published, so it is never offered to anyone.
 *   - It puts NOTHING forward for review, appoints nobody and approves nothing. Putting forward is the curator's
 *     authority (hq.individual.config.manage): the owner does it in the HQ UI, so the real authority check runs and the
 *     owner is the recorded submitter. See docs/evidence/CLINICAL/cf-found-staging-review.md.
 *
 * --status reports four separate states, never merged into one (owner D2):
 *   content completeness   the competency carries what the CFCA record defines (description, outcomes, level)
 *   clinical approval      the 395 state of its CURRENT content: unreviewed, in review, approved, changes requested, stale
 *   catalogue publication  CF-FOUND's publication status, and the carrier's (draft, never published)
 *   Individual visibility  whether CF-FOUND is in a published Individual allowlist (scholar_catalogues, professional_catalogues)
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { addEntries } from "../src/lib/competency/catalogue-entries";
import { loadClinicalReviews, CLINICAL_STATE_LABEL } from "../src/lib/competency/clinical-review";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const CODE = "CF-FOUND-RC", NAME = "CF-FOUND clinical review carrier (synthetic, staging)";
const DESCRIPTION = "Synthetic staging catalogue (IND-007 owner decision D2). It only names the eight CF-FOUND competencies so the curator's review action can put them forward for clinical review. Never to be published. CF-FOUND itself is unchanged.";
const one = async (p: PromiseLike<any>) => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; };

async function cfFound() {
  const fw = await one(admin.from("frameworks").select("id, code, name, pub_status, competency_layer, profession_term_id").is("hospital_id", null).eq("code", "CF-FOUND").maybeSingle());
  if (!fw) throw new Error("CF-FOUND is not on this environment.");
  const doms = await one(admin.from("framework_domains").select("id, name").eq("framework_id", fw.id));
  const comps = await one(admin.from("framework_competencies").select("id, code, name, description, learning_outcomes, expected_level_id, cpu_id, risk_category, domain_id")
    .in("domain_id", doms.map((d: any) => d.id)).order("code"));
  return { fw, doms, comps };
}

async function create() {
  const { fw, comps } = await cfFound();
  let carrier = await one(admin.from("frameworks").select("id, pub_status").is("hospital_id", null).eq("code", CODE).maybeSingle());
  if (!carrier) {
    carrier = await one(admin.from("frameworks").insert({ name: NAME, code: CODE, description: DESCRIPTION, library: "core", is_active: true, sort_order: 99, pub_status: "draft",
      version_major: 1, version_minor: 0, version_revision: 0, competency_layer: fw.competency_layer, profession_term_id: null, hospital_id: null, scope: "master" }).select("id, pub_status").single());
    console.log(`  carrier created: ${carrier.id}`);
  } else console.log(`  carrier exists: ${carrier.id} (${carrier.pub_status})`);
  if (carrier.pub_status !== "draft") throw new Error("The carrier is not a draft. Nothing changed.");
  const r = await addEntries(admin, carrier.id, comps.map((c: any) => c.id));
  if (!r.ok) throw new Error(r.error);
  await admin.from("audit_log").insert({ actor_id: null, actor_name: "IND-007 agent session (CF-FOUND review carrier, synthetic, staging, owner D2)", action: "catalogue_entry_add",
    entity_type: "framework", entity_id: carrier.id, entity_name: NAME, new_value: { added: r.added, of: comps.length, source: "CF-FOUND", note: "names only; nothing put forward" } });
  console.log(`  entries added: ${r.added} (of ${comps.length}; any already present were kept)`);
}

async function status() {
  const { fw, comps } = await cfFound();
  const carrier = await one(admin.from("frameworks").select("id, pub_status").is("hospital_id", null).eq("code", CODE).maybeSingle());
  const entries = carrier ? await one(admin.from("competency_catalogue_entry").select("id, competency_id, content_status").eq("catalogue_id", carrier.id)) : [];
  const reviews = await loadClinicalReviews(admin, comps.map((c: any) => c.id));
  const allow = await one(admin.from("workspace_config_overrides").select("config_path, published").eq("scope_type", "platform").eq("scope_ref", "individual"));
  const listed = (k: string) => { const row = (allow ?? []).find((r: any) => r.config_path === `individual.policy.${k}`); const v = row?.published; const ids = Array.isArray(v) ? v : Array.isArray(v?.ids) ? v.ids : Array.isArray(v?.value) ? v.value : []; return ids.includes(fw.id); };
  console.log(`CF-FOUND four states -- target ${(verdict as any).ref}`);
  console.log(`  catalogue publication: CF-FOUND ${fw.pub_status}; carrier ${carrier ? `${carrier.pub_status} (never to be published), ${entries.length} entries` : "absent"}`);
  console.log(`  Individual visibility: scholar_catalogues ${listed("scholar_catalogues") ? "LISTS CF-FOUND" : "does not list CF-FOUND"}; professional_catalogues ${listed("professional_catalogues") ? "LISTS CF-FOUND" : "does not list CF-FOUND"}`);
  console.log("  | Competency | Content completeness | Clinical approval | Carrier entry |");
  for (const c of comps) {
    const outcomes = Array.isArray(c.learning_outcomes) ? c.learning_outcomes.length : 0;
    const complete = [c.description ? null : "no description", outcomes ? null : "no learning outcomes", c.expected_level_id ? null : "no expected level"].filter(Boolean);
    const rv = reviews?.get(c.id);
    const entry = entries.find((e: any) => e.competency_id === c.id);
    console.log(`  | ${c.code} | ${complete.length ? `incomplete: ${complete.join(", ")}` : `complete (${outcomes} outcomes, level set, no CPU)`} | ${rv ? CLINICAL_STATE_LABEL[rv.state] : reviews === null ? "could not be read" : "Not clinically reviewed"} | ${entry ? "named" : "not named"} |`);
  }
}

(process.argv.includes("--status") ? status() : create().then(status)).catch(e => { console.error(e.message ?? e); process.exit(1); });
