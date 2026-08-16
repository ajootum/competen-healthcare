import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPersonalisation } from "@/lib/personalisation/preferences";
import { loadConfigOverrides, resolveSettings } from "@/lib/config/workspace-config";
import { cardClass, Section, Badge, Alert, NotProvisioned, EmptyState, TableWrap, Th } from "@/components/ui/primitives";
import { KpiRibbon } from "@/components/ui/charts";
import PersonalisationForm from "./PersonalisationForm";
import { estateRolesOf } from "@/lib/roles";

// Personalisation, Preferences & Workspace Experience (UMW-TLS-005) — migration 164.
//
// Preferences resolve catalogue default -> policy -> personal value, and each one shows which layer it came
// from. Module visibility is NOT reimplemented here: it reads the Workspace Configuration Engine at user
// scope, so a personal view can never claim a module the tenant has disabled.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const ALLOWED = ["hospital_admin", "super_admin"];
const when = (t: string | null) => t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function PersonalisationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id, full_name").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");

  const ctx = { hospitalId: profile?.hospital_id ?? null, roles };
  const d = await loadPersonalisation(admin, user.id, ctx);

  // Module visibility comes from the SAME engine the sidebar obeys — read here so this page shows what is
  // actually in force, not a second opinion about it.
  const { provisioned: cfgProvisioned, rows: cfgRows } = await loadConfigOverrides(admin);
  const cfgCtx = { hospitalId: ctx.hospitalId, roles, userId: user.id };
  const SECTIONS = [
    "unit-manager.workforce-management", "unit-manager.patient-operations", "unit-manager.competency",
    "unit-manager.quality", "unit-manager.ops-command", "unit-manager.performance",
    "unit-manager.communications", "unit-manager.administration", "unit-manager.ai",
  ];
  const modules = SECTIONS.map(path => {
    const s = resolveSettings(cfgRows, cfgCtx, path);
    const userRow = cfgRows.find(r => r.scope_type === "user" && r.scope_ref === user.id && r.config_path === path);
    return { path, label: s.label ?? path.split(".").pop()!.replace(/-/g, " "), enabled: s.enabled, personal: !!userRow };
  });

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Personalisation &amp; Preferences</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Your settings for this workspace{d.updatedAt ? ` — last changed ${when(d.updatedAt)}` : ""}.
          </p>
        </div>
        <Link href="/dashboard/preferences" className="text-sm font-medium text-teal-700 hover:underline self-center">Personal workspace settings →</Link>
      </div>

      {!d.provisioned ? (
        <NotProvisioned what="Server-side preference storage" migration="164-personalisation.sql" />
      ) : (
        <KpiRibbon kpis={[
          { label: "Preferences", value: d.counts.total, sub: "in the catalogue" },
          { label: "Set by you", value: d.counts.personalised, tone: "default", sub: d.storedForUser ? "stored on the server" : "none saved yet" },
          { label: "Inherited", value: d.counts.governed, sub: "from an enterprise policy" },
          { label: "Locked", value: d.counts.locked, tone: d.counts.locked ? "warning" : "default", sub: "cannot be changed here" },
          { label: "Saved views", value: d.views.length, sub: d.defaultView ? `default: ${d.defaultView.name}` : "no default set" },
        ]} />
      )}

      <Alert tone="info" title="These settings follow you, not this browser">
        Preferences are stored against your account, so signing in on a ward terminal or a phone gives you the
        same workspace. The older <Link href="/dashboard/preferences" className="underline">personal settings page</Link> still
        keeps a per-browser copy for its own fields; the values below are the ones that roam.
      </Alert>

      <PersonalisationForm groups={d.byGroup} provisioned={d.provisioned} />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Saved views ── */}
        <Section title="Saved Workspace Views" sub={`${d.views.length}`}
          note="A view is a named route and its filters. One per workspace can be the default the workspace opens at.">
          {d.views.length === 0 ? (
            <EmptyState title="No saved views yet" icon="🔖"
              body="Views are created from a filtered page, so there is nothing to list until one is saved." />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100"><Th>Name</Th><Th>Route</Th><Th>Saved</Th></tr></thead>
                <tbody>
                  {d.views.map((v: any) => (
                    <tr key={v.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 text-gray-900 font-medium">
                        {v.name} {v.is_default && <Badge tone="primary">Default</Badge>}
                      </td>
                      <td className="py-2 text-[11px] text-gray-500"><Link href={v.route} className="hover:underline">{v.route}</Link></td>
                      <td className="py-2 text-[11px] text-gray-400">{when(v.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Section>

        {/* ── Module visibility (read from the configuration engine) ── */}
        <Section title="Workspace Sections" sub={`${modules.filter(m => m.enabled).length} of ${modules.length} enabled`}
          note="Resolved by the Workspace Configuration Engine along platform → tenant → hospital → unit → role → user. A section your organisation has disabled cannot be re-enabled from here.">
          {!cfgProvisioned ? (
            <p className="text-sm text-gray-500">The configuration engine is not provisioned on this database, so every section resolves to its default.</p>
          ) : (
            <ul className="space-y-1.5">
              {modules.map(m => (
                <li key={m.path} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-gray-800">{m.label}</span>
                  <span className="flex items-center gap-1.5">
                    {m.personal && <Badge tone="primary">Personal override</Badge>}
                    <Badge tone={m.enabled ? "success" : "neutral"}>{m.enabled ? "Enabled" : "Hidden"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Notification preferences (owned by the framework, not duplicated) ── */}
        <Section title="Notification Preferences" sub={d.notificationPrefs ? "configured" : "not set"}
          note="Owned by the notification framework so one set of rules governs every workspace. Critical and high-priority alerts ignore quiet hours and channel filters by design.">
          {!d.notificationPrefs ? (
            <p className="text-sm text-gray-500">
              No notification preferences saved — every channel is on and nothing is muted.{" "}
              <Link href="/unit-manager/communications" className="text-teal-700 hover:underline">Communications hub →</Link>
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-gray-500">Channels</dt>
              <dd className="text-gray-900">{["in_app", "email", "sms", "push"].filter(c => d.notificationPrefs[c]).join(", ") || "none"}</dd>
              <dt className="text-gray-500">Minimum priority</dt>
              <dd className="text-gray-900">{d.notificationPrefs.min_priority ?? "any"}</dd>
              <dt className="text-gray-500">Quiet hours</dt>
              <dd className="text-gray-900">{d.notificationPrefs.quiet_from ? `${d.notificationPrefs.quiet_from}–${d.notificationPrefs.quiet_to}` : "none"}</dd>
              <dt className="text-gray-500">Muted categories</dt>
              <dd className="text-gray-900">{(d.notificationPrefs.muted_categories ?? []).join(", ") || "none"}</dd>
            </dl>
          )}
        </Section>

        {/* ── Change trail ── */}
        <Section title="Recent Changes" sub={`${d.audit.length}`}
          note="Preference changes are recorded with their previous value. A change a policy forbids never reaches this trail — it is rejected with a reason instead.">
          {d.audit.length === 0 ? (
            <p className="text-sm text-gray-500">No preference changes recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.audit.map((a: any, i: number) => (
                <li key={i} className="flex items-center justify-between text-[12px] border-b border-gray-50 last:border-0 pb-1.5 last:pb-0">
                  <span className="text-gray-800">{a.pref_key.replace(/_/g, " ")}</span>
                  <span className="text-gray-500">
                    {a.old_value ?? "inherited"} → <span className="text-gray-900 font-medium">{a.new_value ?? "inherited"}</span>
                    <span className="text-gray-400 ml-2">{when(a.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ── Governing policies ── */}
      {d.policies.length > 0 && (
        <Section title="Enterprise Policies in Force" sub={`${d.policies.length}`}>
          <TableWrap>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100"><Th>Preference</Th><Th>Scope</Th><Th>Default</Th><Th>Changeable</Th></tr></thead>
              <tbody>
                {d.policies.map((p: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-900">{p.pref_key.replace(/_/g, " ")}</td>
                    <td className="py-2 text-[11px] text-gray-500 capitalize">{p.scope_type}</td>
                    <td className="py-2 text-gray-700">{p.default_value ?? "—"}</td>
                    <td className="py-2"><Badge tone={p.user_editable ? "success" : "warning"}>{p.user_editable ? "Yes" : "Locked"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      )}

      <div className={cardClass}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">What this page does not do</h2>
        <ul className="space-y-1.5 text-[11px] text-gray-600">
          <li><span className="font-medium text-gray-700">No AI layout learning or widget recommendation.</span> The spec asks for both. Learning a preferred layout needs a history of layouts that were kept and abandoned, and none is recorded — a recommendation without it would be a guess dressed as personalisation.</li>
          <li><span className="font-medium text-gray-700">No second module-visibility store.</span> Sections resolve through the Workspace Configuration Engine, so a personal preference cannot contradict what the organisation enabled.</li>
          <li><span className="font-medium text-gray-700">Theme and density are stored, not yet applied globally.</span> They roam with the account and are read by this workspace; a full themed render across all 17 workspaces is a separate change to the token layer.</li>
        </ul>
      </div>
    </div>
  );
}
