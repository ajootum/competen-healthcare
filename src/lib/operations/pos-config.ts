// Patient Operations configuration loader (POS-112). Resolves the EFFECTIVE rule set: the active
// tenant override from op_config_rules (migration 086) if present, else the coded default from
// CONFIG_SCHEMA — so every rule shows an honest value. Also returns the recent change history.
// Fail-soft: pre-migration the store reports provisioned:false and defaults are shown as read-only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CONFIG_SCHEMA } from "@/lib/operations/pos-config-schema";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => !!e && /does not exist|schema cache/i.test(e.message ?? "");

export async function loadPosConfig(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  let provisioned = true;
  let rows: any[] = [];
  const cRes = await scope(admin.from("op_config_rules")
    .select("id, domain, rule_key, value, version, effective_from, reason, created_at, creator:profiles!created_by(full_name)")
    .eq("active", true).order("created_at", { ascending: false }));
  if ((cRes as any).error) { provisioned = !missing((cRes as any).error); rows = []; }
  else rows = (cRes.data ?? []) as any[];

  const override = new Map<string, any>();
  rows.forEach(r => { if (!override.has(`${r.domain}::${r.rule_key}`)) override.set(`${r.domain}::${r.rule_key}`, r); });

  const domains = CONFIG_SCHEMA.map(d => ({
    domain: d.domain, name: d.name, icon: d.icon, consumerNote: d.consumerNote,
    rules: d.rules.map(rule => {
      const ov = override.get(`${d.domain}::${rule.key}`);
      const value = ov?.value?.v ?? rule.default;
      return { ...rule, value, overridden: !!ov, version: ov?.version ?? 1 };
    }),
  }));

  const overridden = domains.reduce((n, d) => n + d.rules.filter(r => r.overridden).length, 0);
  const total = domains.reduce((n, d) => n + d.rules.length, 0);

  // Recent config changes (the version rows are the change log).
  let recentAll: any[] = [];
  if (provisioned) {
    const rRes = await scope(admin.from("op_config_rules")
      .select("id, domain, rule_key, value, version, reason, created_at, creator:profiles!created_by(full_name)")
      .order("created_at", { ascending: false }).limit(10));
    if (!(rRes as any).error) recentAll = (rRes.data ?? []) as any[];
  }

  return { provisioned, domains, recent: recentAll, overridden, total };
}
