/**
 * LIFEOS-PILOT-001: prints SQL that provisions one person and, optionally, one organisation they are accountable for.
 * It connects to nothing and writes nothing. A person reads the output and applies it in the SQL editor.
 *
 *   npx tsx scripts/lifeos-emit-provision.ts --subject <auth-user-id> --name "Their name" [--slug acme --org "Acme Group"]
 */
import { randomUUID } from "node:crypto";
import { ISSUER_COMPETEN_AUTH } from "../src/lib/lifeos/core/provision";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const subject = arg("subject");
const name = arg("name");
const slug = arg("slug");
const org = arg("org");
if (!subject || !/^[0-9a-f-]{36}$/i.test(subject) || !name || (!!slug !== !!org) || (slug && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))) {
  console.error('Usage: --subject <auth-user-id> --name "Their name" [--slug acme --org "Acme Group"]');
  process.exit(2);
}

const individual = randomUUID();
const personal = randomUUID();
const by = { created_by: individual, updated_by: individual };
const system = { provenance_source: "system" };
const ops: unknown[] = [
  { t: "lifeos_individual", op: "insert", values: { id: individual, display_name: name, access_source: "platform_grant", ...system, ...by } },
  { t: "lifeos_identity_link", op: "insert", values: { individual_id: individual, issuer: ISSUER_COMPETEN_AUTH, subject, ...system, ...by } },
  { t: "lifeos_workspace", op: "insert", values: { id: personal, owner_individual_id: individual, kind: "personal", name: "Personal", ...system, ...by } },
  { t: "lifeos_membership", op: "insert", values: { workspace_id: personal, individual_id: individual, role: "owner", ...system, ...by } },
  { t: "lifeos_entitlement", op: "insert", values: { individual_id: individual, source: "platform_grant", plan_code: "pilot", ...system, ...by } },
];
if (slug && org) {
  const tenant = randomUUID();
  const workspace = randomUUID();
  ops.push(
    { t: "lifeos_tenant", op: "insert", values: { id: tenant, owner_individual_id: individual, slug, name: org, kind: "organisation", status: "active", ...system, ...by } },
    { t: "lifeos_workspace", op: "insert", values: { id: workspace, owner_individual_id: individual, kind: "organisation", tenant_id: tenant, name: org, ...system, ...by } },
    { t: "lifeos_membership", op: "insert", values: { workspace_id: workspace, individual_id: individual, role: "owner", ...system, ...by } },
  );
}
const json = JSON.stringify(ops).replace(/'/g, "''");
console.log(`-- LIFEOS-PILOT-001: provisions one person${org ? ` and the organisation ${org.replace(/[\r\n-]/g, " ")}` : ""}. One transaction. Read it before running it.`);
console.log(`select lifeos_mutate(null, 'system', null, null, null, '${json}'::jsonb);`);
