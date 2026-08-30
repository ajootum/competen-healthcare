/**
 * Which migrations is STAGING missing? Probed, not remembered.
 *
 * READ-ONLY. For each migration since 349, selects a marker column/table on STAGING and reports
 * present/absent. Constraint-only migrations carry no probeable marker and are reported as such --
 * they are applied in sequence with their neighbours.
 *
 * ⚠ STAGING ONLY, REFUSED TWICE OVER: requires STAGING_* variables, never falls back to the
 * NEXT_PUBLIC_* (production) pair, and refuses outright if the staging URL matches the production ref.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("STAGING_SUPABASE_URL / STAGING_SERVICE_ROLE_KEY not set -- no fallback exists on purpose."); process.exit(1); }
if (url.includes("rnnqhlrcgvsauigxwszl")) { console.error("that is PRODUCTION. refusing."); process.exit(1); }
const staging = createClient(url, key, { auth: { persistSession: false } });

type Probe = { mig: string; what: string; table: string; column?: string };
const PROBES: Probe[] = [
  { mig: "349", what: "payment path", table: "practice_plans", column: "amount_minor" },
  { mig: "350", what: "whatsapp channel", table: "practice_message", column: "provider_template_name" },
  { mig: "352", what: "referral destinations", table: "practice_referral_destination" },
  { mig: "353", what: "document facts", table: "practice_document_fact" },
  { mig: "356", what: "phrasing provenance", table: "practice_clinical_document", column: "phrasing" },
  { mig: "357", what: "document styles", table: "practice_document_style" },
  { mig: "358", what: "style overrides", table: "practice_clinical_document", column: "style_overrides" },
  { mig: "359", what: "treatment dose unit", table: "practice_treatment", column: "dose_unit" },
];
const UNPROBEABLE = [
  { mig: "351", what: "lifecycle cascade safety (constraint change)" },
  { mig: "354", what: "patient-instructions document type (check widening)" },
  { mig: "355", what: "phase-three document types (check widening)" },
  { mig: "360", what: "close anon read on two tables (grants)" },
];

async function main() {
  console.log(`\nStaging migration gap probe -- ${url!.replace(/^https:\/\//, "").split(".")[0]}\n`);
  const missing: string[] = [];
  for (const p of PROBES) {
    const sel = p.column ?? "*";
    const { error } = await staging.from(p.table).select(sel, { count: "exact", head: true }).limit(0);
    const absent = !!error && /column|relation|does not exist|schema cache/i.test(error.message);
    if (error && !absent) {
      console.log(`  ${p.mig}  ?  ${p.what} -- probe errored differently: ${error.message}`);
      continue;
    }
    console.log(`  ${p.mig}  ${absent ? "MISSING" : "applied"}  ${p.what}${p.column ? ` (${p.table}.${p.column})` : ` (${p.table})`}`);
    if (absent) missing.push(p.mig);
  }
  for (const u of UNPROBEABLE) {
    console.log(`  ${u.mig}  cannot-probe  ${u.what} -- apply in sequence with its neighbours`);
  }
  console.log(`\nprobeable missing: [${missing.join(", ")}]`);
}

main().catch(e => { console.error(e); process.exit(1); });
