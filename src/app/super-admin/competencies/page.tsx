import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function CompetencyLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: competencies } = await supabase
    .from("competencies")
    .select("id, name, category, description, expiry_months, created_at")
    .order("category, name");

  const categories = [...new Set((competencies ?? []).map(c => c.category))].sort();

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Global Competency Library</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {competencies?.length ?? 0} competencies across {categories.length} categories
          </p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">
          Edit via Supabase dashboard
        </div>
      </div>

      {categories.map(cat => {
        const items = (competencies ?? []).filter(c => c.category === cat);
        return (
          <div key={cat} className="mb-6">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{cat}</h2>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                    <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Renewal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                        {c.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-600">{c.expiry_months}mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {!competencies?.length && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🪪</p>
          <p className="text-gray-500 text-sm">No competencies defined yet.</p>
          <p className="text-gray-400 text-xs mt-1">Add competencies in the Supabase dashboard or via the migrations.</p>
        </div>
      )}
    </div>
  );
}
