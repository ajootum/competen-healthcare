import { ogsGuard, Head, Card, Foot } from "../_ui";
import { loadOfficeAdmin } from "@/lib/ogs/office";
import OfficeAdmin from "./OfficeAdmin";

export const dynamic = "force-dynamic";

// OGS-001 Offices — the constitute & manage surface (write-workflows). Server page loads the real ogs_*
// office model (ogsGuard-scoped) + the in-scope people directory for appointments; the OfficeAdmin client
// island performs constitute / appoint / transition against the admin-gated API, then router.refresh()es.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";

export default async function OfficesPage() {
  const { admin, isSuper, hid, fullName } = await ogsGuard();
  const { provisioned, offices } = await loadOfficeAdmin(admin, hid, isSuper);

  const peopleQ = admin.from("profiles").select("id, full_name, role").order("full_name").limit(500);
  const { data: peopleRows } = await (isSuper ? peopleQ : peopleQ.eq("hospital_id", hid ?? NONE));
  const people = ((peopleRows ?? []) as any[]).map(p => ({ id: p.id, full_name: p.full_name, role: p.role }));

  return (
    <div className="space-y-4">
      <Head code="OGS-001 · Office Governance System" title="Offices — constitute & manage" sub={`Constitute offices, appoint members and move offices through their governance lifecycle · ${fullName}`} />
      {!provisioned
        ? <Card><p className="text-sm text-gray-400">The office model (<code>ogs_offices</code>) is not provisioned yet — run migrations 116/117 to enable constituting offices.</p></Card>
        : <OfficeAdmin offices={offices} people={people} scopeHid={hid} isSuper={isSuper} />}
      <Foot>OGS-001 — the constitute / appoint / transition write-workflows over the first-class <code>ogs_*</code> model. Constituting creates an office + founding charter (v1.0) + chair appointment + an immutable constituting transition; lifecycle moves are validated against the governance transition map and logged to <code>ogs_lifecycle_transitions</code>; appointments are membership (authority ≠ technical admin). Delegated-authority instruments, meetings &amp; votes and digital signatures are the next build.</Foot>
    </div>
  );
}
