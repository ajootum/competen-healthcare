import { createAdminClient } from "@/lib/supabase/server";
import { resolveEnterpriseShell } from "@/lib/enterprise-shell";

// Workforce, read-only -- the ONE working screen ENT-DEC-001 D5 asked the first slice to end in.
//
// ⚠ WHAT THIS LIST ACTUALLY IS, SAID ON SCREEN RATHER THAN IMPLIED: the people of this organisation who
// hold Competen accounts. ENT-WF-001 AC-02's workforce person WITHOUT an account arrives with D2's
// ent_workforce_person table, which does not exist yet -- and pretending this is that registry would be
// claiming coverage the data cannot give. The heading and the footer both say which list this is.
//
// ⚠ TENANT-SCOPED IN CODE, the 074 doctrine: the admin client bypasses RLS, so the .eq("tenant_id")
// below IS the isolation. It uses the shell's own resolved tenant, never anything a URL or a client
// supplied.
//
// ⚠ READ-ONLY MEANS NO CONTROLS AT ALL, not disabled ones, on this first slice: there is no write path
// behind this surface, so a disabled "Add person" would advertise a capability that does not exist
// anywhere yet -- the reverse of the disabled-with-a-reason rule, which is for things the product HAS.

export const dynamic = "force-dynamic";

export default async function EnterpriseWorkforcePage() {
  const shell = await resolveEnterpriseShell();
  // ⚠ NULL, NOT redirect() -- see /enterprise/page.tsx: a thrown redirect beats the layout's refusal
  // sentence, and redirecting under the same layout is a loop. The layout explains; this contributes
  // nothing.
  if (shell.state !== "READY") return null;

  const admin = createAdminClient();
  const [{ data: people, error: pErr }, { data: hospitals }] = await Promise.all([
    admin.from("profiles")
      .select("id, full_name, role, hospital_id, created_at")
      .eq("tenant_id", shell.tenantId)
      .order("full_name", { ascending: true })
      .limit(500),
    admin.from("hospitals").select("id, name").eq("tenant_id", shell.tenantId),
  ]);
  const hospitalName = new Map((hospitals ?? []).map(h => [h.id, h.name as string]));

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Workforce</h1>
      <p className="mt-1 text-[13px] text-gray-600">
        People of {shell.tenantName ?? "this organisation"} who hold Competen accounts. Read-only.
      </p>

      {/* ⚠ A FAILED READ IS NEVER AN EMPTY WORKFORCE. */}
      {pErr ? (
        <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          The people list could not be read just now. This is not a statement that the organisation has
          nobody — it is worth trying again in a moment.
        </p>
      ) : (people ?? []).length === 0 ? (
        <p className="mt-5 rounded-lg border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-700">
          No people with Competen accounts are recorded for this organisation yet.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Facility</th>
                <th className="px-4 py-2.5">Estate role</th>
              </tr>
            </thead>
            <tbody>
              {(people ?? []).map(p => (
                <tr key={p.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{p.full_name ?? "(no name recorded)"}</td>
                  <td className="px-4 py-2.5 text-gray-700">
                    {p.hospital_id ? (hospitalName.get(p.hospital_id) ?? "(facility not in this tenant)") : "—"}
                  </td>
                  {/* ⚠ Labelled ESTATE role, because that is what profiles.role is -- it is not a job
                      title and not a workforce position. Null renders as a dash, never invented. */}
                  <td className="px-4 py-2.5 text-gray-700">{p.role ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
        This list shows account-holders only. Workforce records for people without Competen accounts —
        ENT-WF-001&apos;s registry — are part of the Workforce build and do not exist yet, so nothing here
        claims to be the full workforce.
      </p>
    </div>
  );
}
