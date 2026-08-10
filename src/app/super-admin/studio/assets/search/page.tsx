import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AssetSearch from "./AssetSearch";
import { requireHqCapability } from "@/lib/hq/context";

// CAP-006 — Semantic / Vector Search. Hybrid keyword + vector asset search over the whole repository, with
// a super-admin indexing panel. Keyword works today; semantic recall activates once assets are embedded
// (set an embedding provider key, then Enqueue + Embed). Vector substrate: knowledge_embeddings (mig 017),
// match_assets RPC (mig 138).

export const dynamic = "force-dynamic";

export default async function AssetSearchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CAP-006 · Search & Discovery</p>
          <h1 className="text-xl font-bold text-gray-900">Asset Search</h1>
          <p className="text-gray-400 text-sm mt-0.5">Hybrid keyword + semantic search across every competency asset in the repository.</p>
        </div>
        <Link href="/super-admin/studio/assets" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Asset Repository</Link>
      </div>

      <AssetSearch />

      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
        <p className="text-[11px] text-teal-900">
          <span className="font-bold">Hybrid retrieval.</span> Keyword full-text and vector similarity are fused via reciprocal-rank fusion. The vector substrate (pgvector + the embeddings index) is live; semantic recall turns on once an embedding provider is configured and the index is populated — until then search returns keyword results with no regression. Cross-language retrieval, saved searches and RAG-grounded copilots are the next layers.
        </p>
      </div>
    </div>
  );
}
