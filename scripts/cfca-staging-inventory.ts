/**
 * CFCA STAGING INVENTORY -- read-only. What of the CKCM spine (migration 011: domains, practices, CPUs,
 * blueprints) exists on STAGING, and which framework competencies point at it. Writes nothing.
 *
 *   npx tsx scripts/cfca-staging-inventory.ts
 *
 * Refuses production before connecting (judgeDbTarget, the apply-migrations judge).
 */
import { createRequire } from "node:module";
import { Client } from "pg";
import { judgeDbTarget } from "./production-guard";

const require2 = createRequire(process.cwd() + "/");
require2("@next/env").loadEnvConfig(process.cwd());
const dbUrl = process.env.STAGING_DB_URL ?? "";
if (!/^postgres(ql)?:\/\/\S+@\S+\/\S+/.test(dbUrl)) { console.error("STAGING_DB_URL is not set to a Postgres URL."); process.exit(1); }
const verdict = judgeDbTarget(dbUrl);
if (!verdict.ok) { console.error(`REFUSING: STAGING_DB_URL is ${verdict.reason === "PRODUCTION" ? "PRODUCTION" : "not identifiable as a project"}.`); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("set session characteristics as transaction read only");
    const q = async (sql: string) => (await c.query(sql)).rows;
    const out = {
      target: (verdict as { ref?: string }).ref ?? "staging",
      practices: await q(`select p.code, p.name, d.name as domain, f.name as framework, f.code as framework_code, f.hospital_id is null as shared,
        (select count(*) from clinical_practice_units u where u.practice_id = p.id)::int as cpus,
        (select count(*) from framework_competencies fc where fc.practice_id = p.id)::int as competencies
        from practices p join framework_domains d on d.id = p.domain_id join frameworks f on f.id = d.framework_id order by p.code`),
      cpus: await q(`select u.code, u.name, u.pub_status, u.risk_category, p.code as practice,
        (select count(*) from assessment_blueprints b where b.cpu_id = u.id)::int as blueprints,
        (select count(*) from evidence_matrix e where e.cpu_id = u.id)::int as evidence_rows,
        (select count(*) from critical_failure_rules r where r.cpu_id = u.id)::int as critical_rules,
        (select count(*) from framework_competencies fc where fc.cpu_id = u.id)::int as competencies
        from clinical_practice_units u join practices p on p.id = u.practice_id order by u.code`),
      frameworks: await q(`select f.name, f.code, f.pub_status, f.is_active, f.hospital_id is null as shared, f.competency_layer,
        (select count(*) from framework_domains d where d.framework_id = f.id)::int as domains,
        (select count(*) from framework_competencies fc join framework_domains d on d.id = fc.domain_id where d.framework_id = f.id)::int as competencies
        from frameworks f where f.hospital_id is null order by f.name`),
      respCardioDomains: await q(`select f.name as framework, d.name as domain, count(fc.id)::int as competencies
        from framework_domains d join frameworks f on f.id = d.framework_id left join framework_competencies fc on fc.domain_id = d.id
        where f.hospital_id is null and d.name ~* '(airway|breath|respir|circulat|cardio|oxygen|haemo|hemo)'
        group by f.name, d.name order by f.name, d.name`),
    };
    console.log(JSON.stringify(out, null, 2));
  } finally { await c.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
