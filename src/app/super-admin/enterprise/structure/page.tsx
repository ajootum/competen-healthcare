import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadStructure } from "@/lib/enterprise/structure";
import StructureBuilder from "./StructureBuilder";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function StructureModule({ searchParams }: { searchParams: Promise<{ facility?: string }> }) {
  const { facility } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const s = await loadStructure(admin, facility ?? null);

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span><span className="text-gray-600">Departments, Units &amp; Services</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Structure Builder</h1>
        <p className="text-sm text-gray-500">Build and manage the internal organisational and clinical structure of each facility.</p>
      </div>
      <StructureBuilder data={s} />
    </div>
  );
}
