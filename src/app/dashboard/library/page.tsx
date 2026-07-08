import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LibrarySearch from "./LibrarySearch";

// Clinical Library — point-of-care access to the governed knowledge base:
// policies, procedure guides (CPUs), learning resources and quality standards.

export default async function ClinicalLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: policies }, { data: resources }, { data: qos }] = await Promise.all([
    admin.from("policies").select("id, title").order("title").limit(8),
    admin.from("learning_resources").select("id, title, resource_type").eq("is_active", true).order("title").limit(8),
    admin.from("quality_objects").select("id, title, description").eq("status", "active").order("title").limit(6),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Library</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Quick access to guidelines, SOPs, procedure references and quality standards — everything governed in one place.
        </p>
      </div>

      <LibrarySearch />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">📜 Policies &amp; SOPs</h2>
          {(policies ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">No policies published yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(policies ?? []).map(p => <li key={p.id} className="text-sm text-gray-700">{p.title}</li>)}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">📚 Learning Resources</h2>
          {(resources ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">No resources published yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(resources ?? []).map(r => (
                <li key={r.id} className="text-sm text-gray-700">
                  {r.title} <span className="text-[10px] text-gray-400 capitalize">({r.resource_type})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">🛡️ Quality Standards</h2>
          {(qos ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">No quality standards published yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(qos ?? []).map(q => (
                <li key={q.id} className="text-sm text-gray-700" title={q.description ?? undefined}>{q.title}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
