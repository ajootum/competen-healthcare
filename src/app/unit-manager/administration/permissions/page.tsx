import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAccessGovernance, TENANT_ROLES } from "@/lib/access/permissions";
import { cardClass, Section, Badge, Alert, NotProvisioned, EmptyState, TableWrap, Th, Progress, type BadgeTone } from "@/components/ui/primitives";
import { KpiRibbon } from "@/components/ui/charts";
import { estateRolesOf } from "@/lib/roles";

// Roles, Permissions & Delegated Administration (UMW-TLS-002) — migration 166.
//
// The permission matrix is DERIVED FROM THE CODE, not from a table someone maintains. A hand-kept table
// drifts from the gates silently and would tell a manager a route is locked when it is open.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const ALLOWED = ["hospital_admin", "super_admin"];
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const when = (t: string | null) => t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
const SEV: Record<string, BadgeTone> = { critical: "critical", high: "error", medium: "warning", low: "info" };
const KIND: Record<string, { label: string; tone: BadgeTone }> = {
  "role-list": { label: "Role gate", tone: "success" },
  "single-role": { label: "Single role", tone: "success" },
  "auth-only": { label: "Signed in only", tone: "warning" },
  "service": { label: "Machine auth", tone: "info" },
  "platform-role": { label: "Platform operator", tone: "primary" },
  "none": { label: "No check found", tone: "critical" },
  "unknown": { label: "Not classified", tone: "neutral" },
};

export default async function PermissionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");

  const d: any = await loadAccessGovernance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const m = d.matrix;

  return (
    <div className="space-y-4 max-w-[1500px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roles, Permissions &amp; Delegated Administration</h1>
          <p className="text-sm text-gray-500 mt-0.5">What each role can actually reach, who holds delegated authority, and where duties overlap.</p>
        </div>
        <Link href="/unit-manager/administration/governance" className="text-sm font-medium text-teal-700 hover:underline self-center">Permissions &amp; Governance (ADM-007) →</Link>
      </div>

      {!d.provisioned && <NotProvisioned what="Access review campaigns and segregation-of-duty rules" migration="166-access-governance.sql" />}

      <KpiRibbon
        kpis={[
          { label: "Routes analysed", value: m.total, sub: `${m.workspaces.length} workspaces, ${m.apis} API routes` },
          { label: "Role-gated", value: m.total - m.authOnly - m.unknown - (m.ungated ?? 0) - (m.service ?? 0) - (m.platform ?? 0), sub: "restricted by role" },
          { label: "Signed in only", value: m.authOnly, tone: m.authOnly ? "warning" : "default", sub: "no role restriction" },
          { label: "Needs a look", value: m.attention.length, tone: m.attention.length ? "warning" : "default", sub: "no check, or unreadable" },
          { label: "SoD breaches", value: d.sod.live, tone: d.sod.live ? "critical" : "default", sub: `${d.sod.excepted} with an exception` },
          { label: "Open reviews", value: d.reviews.open, tone: d.reviews.overdue ? "critical" : "default", sub: d.reviews.overdue ? `${d.reviews.overdue} overdue` : `${d.reviews.recorded} recorded` },
          { label: "Active delegations", value: d.delegations.active, tone: d.delegations.lapsed ? "warning" : "default", sub: d.delegations.lapsed ? `${d.delegations.lapsed} lapsed` : "in force" },
        ]}
        note="The matrix is generated from the access gates in the application code, not from a stored permissions table — so it cannot disagree with what is actually enforced."
      />

      {d.signals.length > 0 && (
        <div className="space-y-2">
          {d.signals.map((s: any, i: number) => (
            <Alert key={i} tone={s.severity === "high" ? "critical" : "warning"}>{s.text}</Alert>
          ))}
        </div>
      )}

      {/* ── Permission matrix ── */}
      <Section title="Permission Matrix — Workspaces" sub={`${m.workspaces.length}`}
        note="Read from each workspace's own gate. A blank cell means the scanner could not classify that gate — never that access is open.">
        <TableWrap>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100">
              <Th>Workspace</Th>
              {TENANT_ROLES.map(r => <Th key={r} align="right">{titleCase(r)}</Th>)}
              <Th>Gate</Th>
            </tr></thead>
            <tbody>
              {m.workspaces.map((w: any) => (
                <tr key={w.path} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 font-mono text-[11px] text-gray-800">{w.path}</td>
                  {w.reach.map((c: any) => (
                    <td key={c.role} className="py-2 text-right">
                      {c.allowed === true ? <span style={{ color: "var(--cmp-text-success)" }} title="reaches">●</span>
                        : c.allowed === false ? <span className="text-gray-200" title="does not reach">○</span>
                        : <span className="text-gray-400" title="gate not classified">?</span>}
                    </td>
                  ))}
                  <td className="py-2">
                    <Badge tone={KIND[w.gate.kind]?.tone ?? "neutral"}>{KIND[w.gate.kind]?.label ?? w.gate.kind}</Badge>
                    {w.gate.appointment && <Badge tone="info">+ appointment</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="text-[10px] text-gray-400 mt-2">
          ● reaches · ○ does not reach · ? gate not classified. An office appointment (OGS) can additionally grant
          access where marked, which is why those workspaces are not role-only.
        </p>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Routes needing a human look ── */}
        <Section title="Routes That Need a Look" sub={`${m.attention.length}`}
          note="Split deliberately: no access check found at all is a different finding from a gate this scanner could not parse. Some are correct — the sign-in endpoints must be reachable before anyone is signed in.">
          {m.attention.length === 0 ? (
            <EmptyState title="Every route has a classified access check" icon="🔐" />
          ) : (
            <ul className="space-y-1.5">
              {m.attention.map((e: any) => (
                <li key={e.path} className="flex items-center justify-between gap-2 text-[12px] border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
                  <span className="font-mono text-gray-800 truncate">{e.path}</span>
                  <Badge tone={KIND[e.gate.kind]?.tone ?? "neutral"}>{KIND[e.gate.kind]?.label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Segregation of duties ── */}
        <Section title="Segregation of Duties" sub={`${d.sod.rules} rule${d.sod.rules === 1 ? "" : "s"}`}
          note="Breaches are computed live from the roles people hold, never stored — a stored breach goes stale the moment someone's roles change and would then accuse a person who is already clean.">
          {!d.provisioned ? (
            <p className="text-sm text-gray-500">Not provisioned.</p>
          ) : d.sod.rules === 0 ? (
            <EmptyState title="No segregation-of-duty rules defined" icon="⚖️"
              body="With no rules, no conflict can be detected — this is not the same as having none." />
          ) : d.sod.breaches.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--cmp-text-success)" }}>No person holds a conflicting pair of roles.</p>
          ) : (
            <ul className="space-y-2">
              {d.sod.breaches.slice(0, 12).map((b: any, i: number) => (
                <li key={i} className="flex items-start justify-between gap-3 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">{b.subjectName ?? "Unnamed"}</p>
                    <p className="text-[11px] text-gray-500">{b.rule.label} — {titleCase(b.rule.role_a)} + {titleCase(b.rule.role_b)}</p>
                    {b.excepted && <p className="text-[10px] text-gray-400">Exception: {b.exceptionReason}</p>}
                    {b.exceptionExpired && <p className="text-[10px]" style={{ color: "var(--cmp-text-warning)" }}>Its exception has EXPIRED and no longer authorises this.</p>}
                  </div>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {b.excepted ? <Badge tone="neutral">Accepted</Badge> : <Badge tone={SEV[b.rule.severity] ?? "warning"}>{titleCase(b.rule.severity)}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Access reviews ── */}
        <Section title="Access Review Campaigns" sub={`${d.reviews.recorded}`}
          note="An undecided item is never counted as approved. A campaign nobody completed must not read as a clean bill of health.">
          {!d.provisioned ? <p className="text-sm text-gray-500">Not provisioned.</p>
            : d.reviews.recorded === 0 ? (
            <EmptyState title="No access reviews recorded" icon="🔍"
              body="Periodically confirming that people still need their access is what makes it evidenceable at audit." />
          ) : (
            <ul className="space-y-2.5">
              {d.reviews.rows.slice(0, 6).map((r: any) => (
                <li key={r.id} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">{r.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {titleCase(r.scope)}{r.owner_name ? ` · ${r.owner_name}` : ""}{r.due_at ? ` · due ${when(r.due_at)}` : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {r.overdue && <Badge tone="critical">Overdue</Badge>}
                      <Badge tone={r.status === "open" ? "primary" : r.status === "closed" ? "success" : "neutral"}>{titleCase(r.status)}</Badge>
                    </span>
                  </div>
                  {r.items > 0 && (
                    <div className="mt-1">
                      <Progress label={`${r.decided} of ${r.items} decided`} value={r.progress}
                        tone={r.progress === 100 ? "success" : r.overdue ? "critical" : "primary"} />
                      <p className="text-[10px] text-gray-400">{r.retain} retained · {r.revoke} revoked · {r.modify} modified</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Delegated administration ── */}
        <Section title="Delegated Administration" sub={`${d.delegations.recorded}`}
          note="From the existing delegation register (ADM-007), not a second copy. A row marked active whose end date has passed is shown as lapsed rather than current.">
          {d.delegations.recorded === 0 ? (
            <EmptyState title="No delegations recorded" icon="🤝" />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100"><Th>Position</Th><Th>Delegate</Th><Th>Until</Th><Th>State</Th></tr></thead>
                <tbody>
                  {d.delegations.rows.slice(0, 10).map((r: any) => (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 text-gray-900">{r.position}</td>
                      <td className="py-2 text-[11px] text-gray-600">{r.delegateName ?? "—"}</td>
                      <td className="py-2 text-[11px] text-gray-400">{when(r.valid_to)}</td>
                      <td className="py-2">
                        {r.lapsed ? <Badge tone="warning">Lapsed</Badge>
                          : <Badge tone={r.status === "active" ? "success" : "neutral"}>{titleCase(r.status)}</Badge>}
                        {r.endingSoon && !r.lapsed && <Badge tone="info">Ends soon</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {d.breakGlass.recorded > 0 && (
            <p className="text-[11px] text-gray-500 mt-2">
              Emergency access: <span className="font-medium text-gray-700">{d.breakGlass.open} open</span> of {d.breakGlass.recorded} break-glass grant(s) recorded.
            </p>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Role distribution ── */}
        <Section title="Roles Held" sub={`${d.people.total} people`}>
          <ul className="space-y-1.5">
            {d.people.roles.map((r: any) => (
              <li key={r.role} className="flex items-center justify-between text-sm">
                <span className="text-gray-800">{titleCase(r.role)}</span>
                <span className="text-gray-500 tabular-nums">{r.n}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-500 mt-2">
            {d.people.multiRole} person(s) hold more than one role — the population any segregation-of-duty rule applies to.
          </p>
        </Section>

        {/* ── Access activity ── */}
        <Section title="Access Activity" sub={`${d.audit.length}`}
          note="Filtered from the existing audit trail to entries that touch roles, delegation, grants or access.">
          {d.audit.length === 0 ? (
            <p className="text-sm text-gray-500">No access-related audit entries recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.audit.map((a: any, i: number) => (
                <li key={i} className="flex items-center justify-between gap-2 text-[12px] border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
                  <span className="text-gray-800 truncate">{titleCase(a.action)} <span className="text-gray-400">{a.entity_name ?? a.entity_type}</span></span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{a.actor_name ?? "system"} · {when(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">What this module does not do</h2>
        <ul className="space-y-1.5 text-[11px] text-gray-600">
          <li><span className="font-medium text-gray-700">It does not grant or revoke access.</span> This is a read model over the gates and registers that already exist. Role assignment stays where it is written, so there is no second write path to keep in step.</li>
          <li><span className="font-medium text-gray-700">No session monitoring.</span> The spec asks for it. Sessions are held by the auth provider and nothing here records them, so a session list would be invented.</li>
          <li><span className="font-medium text-gray-700">The matrix covers workspace and API gates, not row-level rules.</span> Database RLS also restricts what a signed-in role can read; that is a second layer this scan does not model, so a green row means the route is reachable, not that every record behind it is.</li>
          <li><span className="font-medium text-gray-700">Attribute-based access is not modelled.</span> Only role gates and office appointments are read. Tenant and unit scoping is enforced per query rather than as a declared policy, so it cannot be tabulated here.</li>
        </ul>
      </div>
    </div>
  );
}
