import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CapaBoard, { type CapaRow } from "./CapaBoard";

// Improvement Actions (CAPA) tracker. Rows come straight from capa_actions —
// auto-created by the Quality Engine from failed critical audit criteria, or
// raised manually here. Status advances open → in progress → completed →
// verified → closed with evidence notes.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ new?: string }>;

export default async function CapaPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const myRoles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  const hospitalId = me?.hospital_id ?? null;
  const params = await searchParams;

  const [{ data: rowsRaw }, { data: staff }] = await Promise.all([
    hospitalId
      ? admin.from("capa_actions")
          .select("id, title, description, priority, status, due_date, owner_name, evidence_note, created_at, audits!audit_id(title, audit_type)")
          .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hospitalId).order("full_name").limit(400)
      : Promise.resolve({ data: [] }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const rows: CapaRow[] = ((rowsRaw ?? []) as unknown as {
    id: string; title: string; description: string | null; priority: string; status: string;
    due_date: string | null; owner_name: string | null; evidence_note: string | null; created_at: string;
    audits: { title: string; audit_type: string } | null;
  }[]).map(r => ({
    id: r.id, title: r.title, description: r.description, priority: r.priority, status: r.status,
    due: r.due_date, owner: r.owner_name, evidenceNote: r.evidence_note,
    source: r.audits ? `${r.audits.audit_type} audit — ${r.audits.title}` : null,
    overdue: !!r.due_date && r.due_date < today && ["open", "in_progress"].includes(r.status),
  }));

  const owners = (staff ?? [])
    .filter(p => (p.roles?.length ? p.roles : [p.role]).some((r: string) => ["assessor", "educator", "hospital_admin", "nurse"].includes(r)))
    .map(p => ({ id: p.id, name: p.full_name }));

  return (
    <div className="max-w-4xl">
      <Link href="/assessor/quality" className="text-xs text-gray-400 hover:text-gray-600">← Quality &amp; Governance</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">🛠️ Improvement Actions (CAPA)</h1>
        <p className="text-gray-400 text-sm mt-0.5">Corrective and preventive actions — auto-created from failed critical audit criteria, or raised manually.</p>
      </div>
      <CapaBoard rows={rows} owners={owners} startOpen={params.new === "1"} />
    </div>
  );
}
