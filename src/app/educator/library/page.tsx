import { requireEducatorAccess } from "@/lib/educator-access";
import ResourceLibrary from "@/app/admin/resources/ResourceLibrary";
import { EduHeader } from "../ui";

// Learning Resources — the governed resource library with full management
// (add, activate, link to competencies) via the existing educator-permitted
// API. Resource ↔ competency links are what power auto-generated learning
// pathways and the coach engine. Replaces the old "coming soon" stub.

export const dynamic = "force-dynamic";

export default async function EducatorLibraryPage() {
  const { admin } = await requireEducatorAccess();

  const [{ data: resources }, { data: links }, { data: comps }] = await Promise.all([
    admin.from("learning_resources").select("id, title, resource_type, url, is_active").order("created_at", { ascending: false }),
    admin.from("resource_competencies").select("resource_id, competency_id, framework_competencies(name)"),
    admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").order("name").limit(500),
  ]);

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🗂️" title="Learning Resources" sub="Governed resources mapped to competencies — the source for learning pathways, coach plans and remediation." />
      <ResourceLibrary
        resources={(resources ?? []) as never}
        links={(links ?? []) as never}
        competencies={(comps ?? []).map(c => {
          const d = c.framework_domains as unknown as { name: string; frameworks: { name: string } | null } | null;
          return { id: c.id, name: c.name, framework: d?.frameworks?.name ?? "", domain: d?.name ?? "" };
        })}
      />
      <p className="text-[10px] text-gray-400 mt-4">
        Resources are links to governed material (documents, videos, references). Direct file hosting, access tracking and AI summarisation
        aren&apos;t built — pathways reference these links as-is.
      </p>
    </div>
  );
}
