import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import KnowledgeLibrary from "./KnowledgeLibrary";

// Clinical Knowledge Objects — the governed home for authored clinical
// knowledge (anatomy, physiology, classification, reasoning). Fails soft
// until migration 025 is applied.

export default async function KnowledgePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  let objects: unknown[] = [];
  let cpus: { id: string; name: string }[] = [];
  let installed = true;
  try {
    const [{ data: kos, error }, { data: cpuRows }] = await Promise.all([
      admin.from("knowledge_objects")
        .select("id, code, title, summary, knowledge_type, status, source_ref, cpu_id, created_at, clinical_practice_units(name)")
        .order("created_at", { ascending: false }),
      admin.from("clinical_practice_units").select("id, name").order("name"),
    ]);
    if (error) throw error;
    objects = (kos ?? []).map(k => ({
      id: k.id, code: k.code, title: k.title, summary: k.summary,
      type: k.knowledge_type, status: k.status, source: k.source_ref,
      cpuName: (k.clinical_practice_units as unknown as { name: string } | null)?.name ?? null,
    }));
    cpus = cpuRows ?? [];
  } catch {
    installed = false;
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Knowledge Objects</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Knowledge Objects</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Governed clinical knowledge — anatomy, physiology, classification and reasoning — reusable across CPUs and citable by the AI assistant.
        </p>
      </div>

      {!installed ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
          <p className="font-semibold">Migration 025 not applied yet</p>
          <p className="mt-1 text-amber-800">
            Run <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">supabase/migrations/025-knowledge-objects.sql</code> in the Supabase SQL editor, then reload this page.
          </p>
        </div>
      ) : (
        <KnowledgeLibrary objects={objects as never} cpus={cpus as never} />
      )}
    </div>
  );
}
