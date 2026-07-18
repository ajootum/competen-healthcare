import Link from "next/link";

// Shared header for the Educator Validation Centre modules — consistent look,
// back-link to the educator dashboard.
export function EduHeader({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <>
      <Link href="/educator" className="no-print text-xs text-gray-400 hover:text-gray-600">← Educator Dashboard</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">
          {icon} {title}
          <span className="ml-2 text-[9px] font-bold bg-purple-50 text-purple-600 px-2 py-0.5 rounded align-middle uppercase">Validation Centre</span>
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">{sub}</p>
      </div>
    </>
  );
}
