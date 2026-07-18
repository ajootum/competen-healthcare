import Link from "next/link";

// Shared header for the AI & Intelligence modules — consistent look, honest
// AI badge, back-link to the assessor dashboard.

export function AiHeader({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <>
      <Link href="/assessor" className="no-print text-xs text-gray-400 hover:text-gray-600">← Assessor Dashboard</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">
          {icon} {title}
          <span className="ml-2 text-[9px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded align-middle uppercase">AI &amp; Intelligence</span>
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">{sub}</p>
      </div>
    </>
  );
}
