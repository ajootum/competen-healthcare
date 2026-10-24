/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 -- STAGING SEED for the first CONTROLLED catalogue: Scholar respiratory and cardiovascular (needs 394).
 *
 *   npx tsx scripts/seed-staging-controlled-catalogue.ts            create (idempotent, by code SCH-RESPCARD)
 *   npx tsx scripts/seed-staging-controlled-catalogue.ts --verify   read only: what it names, by status
 *   npx tsx scripts/seed-staging-controlled-catalogue.ts --remove   delete the catalogue and its entries
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project.
 *
 * WHAT IT MAKES. One shared DRAFT framework, layer profession (Nursing), with no competencies of its own. Its
 * competency_catalogue_entry rows NAME existing competencies -- nothing is copied -- chosen by the clinical
 * structure that already exists:
 *   1. every competency linked (directly or through its clinical practice unit) to a respiratory or
 *      cardiovascular PRACTICE, by practice code (airway, breathing / respiratory, circulation /
 *      cardiovascular, oxygen, respiratory assessment), and
 *   2. where no practice is recorded for them, the competencies of the Airway, Breathing and Circulation
 *      domains of Core Nursing.
 *
 * ⚠ NOT CLINICALLY APPROVED. Every entry is written as "unreviewed" with a note saying it is a staging
 * seed chosen by code and domain name, not by a clinician. The framework description says the same. This
 * script never writes "approved", never publishes, and never touches an Individual allowlist: publication
 * is the governed framework lifecycle (submit, independent approval), and the allowlist is HQ's choice.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--verify") ? "verify" : "create";

export const CODE = "SCH-RESPCARD";
export const NAME = "Scholar: Respiratory and Cardiovascular";
export const SEED_NOTE = "Staging seed: not clinically reviewed. Chosen by practice code and domain name, not by a clinician.";
/** Respiratory and cardiovascular practices, by code. */
export const PRACTICE_CODE = /^PRA-(AIR|BRE|RESP|RESPASS|CIR|CARD|OXY)-/i;
/** Fallback: Core Nursing domains by name, when their competencies carry no practice. */
export const CORE_DOMAIN = /\b(airway|breathing|circulation)\b/i;

const one = async (p: PromiseLike<any>) => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; };

async function main() {
  console.log(`Controlled catalogue seed -- ${mode} -- target ${(verdict as any).ref}`);
  const probe = await admin.from("competency_catalogue_entry").select("id").limit(0);
  if (probe.error) { console.error(`Migration 394 is not applied here (${probe.error.message}). Nothing written.`); process.exit(1); }
  const existing = await one(admin.from("frameworks").select("id, pub_status").is("hospital_id", null).eq("code", CODE).maybeSingle());

  if (mode === "remove") {
    if (!existing) { console.log("  nothing to remove"); return; }
    await one(admin.from("frameworks").delete().eq("id", existing.id));
    console.log(`  removed ${CODE} and its entries (cascade)`);
    return;
  }

  let catalogue = existing;
  if (!catalogue && mode === "create") {
    const tax = await one(admin.from("taxonomies").select("id").eq("kind", "profession").maybeSingle());
    const nursing = tax ? await one(admin.from("taxonomy_terms").select("id").eq("taxonomy_id", tax.id).eq("value", "Nursing").maybeSingle()) : null;
    if (!nursing) throw new Error("taxonomy term profession/Nursing not found");
    catalogue = await one(admin.from("frameworks").insert({
      name: NAME, code: CODE, library: "core", is_active: true, sort_order: 90, pub_status: "draft",
      version_major: 1, version_minor: 0, version_revision: 0, competency_layer: "profession", profession_term_id: nursing.id,
      description: `A controlled catalogue for Competen Scholar. It names existing respiratory and cardiovascular competencies and copies none. ${SEED_NOTE}`,
    }).select("id, pub_status").single());
    console.log(`  created ${CODE} (draft)`);
  }
  if (!catalogue) { console.log(`  ${CODE} does not exist`); process.exit(mode === "verify" ? 1 : 0); }

  if (mode === "create") {
    if (catalogue.pub_status !== "draft") { console.log(`  ${CODE} is ${catalogue.pub_status}: entries are frozen, nothing added`); }
    else {
      // 1. By practice: shared frameworks only.
      const shared = await one(admin.from("frameworks").select("id, name").is("hospital_id", null));
      const sharedIds = new Set(shared.map((f: any) => f.id));
      const doms = await one(admin.from("framework_domains").select("id, name, framework_id").in("framework_id", [...sharedIds]));
      const sharedDom = new Set(doms.map((d: any) => d.id));
      const prs = (await one(admin.from("practices").select("id, code, domain_id"))).filter((p: any) => sharedDom.has(p.domain_id) && PRACTICE_CODE.test(p.code ?? ""));
      const prIds = prs.map((p: any) => p.id);
      const cps = prIds.length ? await one(admin.from("clinical_practice_units").select("id").in("practice_id", prIds)) : [];
      const byPractice = prIds.length ? await one(admin.from("framework_competencies").select("id, domain_id").in("practice_id", prIds)) : [];
      const byCpu = cps.length ? await one(admin.from("framework_competencies").select("id, domain_id").in("cpu_id", cps.map((u: any) => u.id))) : [];
      // 2. Core Nursing Airway / Breathing / Circulation.
      const core = shared.find((f: any) => f.name === "Core Nursing");
      const coreDoms = core ? doms.filter((d: any) => d.framework_id === core.id && CORE_DOMAIN.test(d.name)).map((d: any) => d.id) : [];
      const byDomain = coreDoms.length ? await one(admin.from("framework_competencies").select("id, domain_id").in("domain_id", coreDoms).order("sort_order")) : [];
      const ids = [...new Set([...byPractice, ...byCpu, ...byDomain].filter((c: any) => sharedDom.has(c.domain_id)).map((c: any) => c.id))];
      const have = new Set((await one(admin.from("competency_catalogue_entry").select("competency_id").eq("catalogue_id", catalogue.id))).map((e: any) => e.competency_id));
      const fresh = ids.filter(id => !have.has(id)).map((id, i) => ({ catalogue_id: catalogue.id, competency_id: id, content_status: "unreviewed", status_note: SEED_NOTE, sort_order: have.size + i + 1 }));
      if (fresh.length) await one(admin.from("competency_catalogue_entry").insert(fresh));
      console.log(`  practices matched ${prs.length} (${prs.map((p: any) => p.code).join(", ") || "none"}), Core Nursing domains ${coreDoms.length}; named ${fresh.length} new, ${have.size} already`);
    }
  }

  const entries = await one(admin.from("competency_catalogue_entry").select("content_status").eq("catalogue_id", catalogue.id));
  const by = entries.reduce((m: Record<string, number>, e: any) => ({ ...m, [e.content_status]: (m[e.content_status] ?? 0) + 1 }), {});
  console.log(`  ${CODE}: ${catalogue.pub_status}, names ${entries.length} competencies ${JSON.stringify(by)}`);
  if (by.approved) { console.error("  FAIL  a staging seed entry reads as approved"); process.exit(1); }
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
