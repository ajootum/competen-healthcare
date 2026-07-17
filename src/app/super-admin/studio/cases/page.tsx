import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CaseLibrary from "./CaseLibrary";

// Clinical Case Studies — worked scenarios for case-based learning.
// Fails soft until migration 026 is applied.

export default async function CasesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  let cases: unknown[] = [];
  let installed = true;
  try {
    const { data, error } = await admin.from("clinical_cases")
      .select("id, code, title, scenario, findings, questions, discussion, learning_points, difficulty, status, source_ref, clinical_practice_units(name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    cases = (data ?? []).map(c => ({
      id: c.id, code: c.code, title: c.title,
      scenario: c.scenario, findings: c.findings, discussion: c.discussion,
      questions: c.questions ?? [], learningPoints: c.learning_points ?? [],
      difficulty: c.difficulty, status: c.status, source: c.source_ref,
      cpuName: (c.clinical_practice_units as unknown as { name: string } | null)?.name ?? null,
    }));
  } catch {
    installed = false;
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Case Studies</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Case Studies</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Worked scenarios — presentation, findings, questions and expert reasoning — for case-based learning.
        </p>
      </div>

      {!installed ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
          <p className="font-semibold">Migration 026 not applied yet</p>
          <p className="mt-1 text-amber-800">
            Run <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">supabase/migrations/026-clinical-cases.sql</code> in the Supabase SQL editor, then reload.
          </p>
        </div>
      ) : (
        <CaseLibrary cases={cases as never} />
      )}
    </div>
  );
}
