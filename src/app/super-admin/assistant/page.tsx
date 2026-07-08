import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { aiStatus } from "@/lib/ai/config";
import AssistantChat from "./AssistantChat";

export default async function AssistantPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!["super_admin", "hospital_admin", "educator"].includes(profile?.role ?? "")) redirect("/dashboard");

  const ai = aiStatus();

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Intelligence Assistant</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Ask questions about your competency frameworks, CPUs and policies. Answers are grounded in your governed CKCM content and cite their sources (Book IV Ch.10–11).
        </p>
      </div>

      {!ai.configured ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-6">
          <p className="text-sm font-semibold text-amber-800">🟡 AI not configured</p>
          <p className="text-xs text-gray-600 mt-2">
            Add an <code className="bg-white px-1 rounded">ANTHROPIC_API_KEY</code> to your <code className="bg-white px-1 rounded">.env.local</code> and Vercel environment variables to enable the assistant.
            The key is read from the environment — it is never stored in the database or shown in the UI.
          </p>
        </div>
      ) : (
        <AssistantChat />
      )}
    </div>
  );
}
