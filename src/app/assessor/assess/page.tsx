import Link from "next/link";

export default function AssessorAssessPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Conduct Assessment</h1>
        <p className="text-gray-400 text-sm mt-0.5">Choose an audit instrument to begin.</p>
      </div>

      <div className="grid gap-4">
        {[
          {
            tab: 0,
            title: "Nursing Assessment Audit",
            desc: "Assessor grades a nurse's patient assessment performance against 62 structured competency items across 8 clinical sections. Results in a 0–6 competency level.",
            icon: "📋",
            items: "62 items · 8 sections",
            color: "border-indigo-200 bg-indigo-50",
            badge: "bg-indigo-100 text-indigo-700",
          },
          {
            tab: 1,
            title: "Concurrent Audit",
            desc: "Nurse and assessor independently assess the same patient, then findings are compared for congruence. Identifies knowledge gaps and calibration issues.",
            icon: "🔄",
            items: "51 items · Match / No Match / Partial",
            color: "border-blue-200 bg-blue-50",
            badge: "bg-blue-100 text-blue-700",
          },
          {
            tab: 2,
            title: "Retrospective Chart Audit",
            desc: "Review a completed patient file to assess what was documented and how well — checks completeness and accuracy of clinical records.",
            icon: "📁",
            items: "48 items · Yes / No / Partial",
            color: "border-sky-200 bg-sky-50",
            badge: "bg-sky-100 text-sky-700",
          },
        ].map(tool => (
          <div key={tool.tab} className={`rounded-xl border p-5 ${tool.color}`}>
            <div className="flex items-start gap-4">
              <span className="text-3xl">{tool.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-semibold text-gray-900">{tool.title}</h2>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tool.badge}`}>{tool.items}</span>
                </div>
                <p className="text-sm text-gray-600 mb-4">{tool.desc}</p>
                <Link href={`/dashboard/audit?tab=${tool.tab}`}
                  className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-gray-800 shadow-sm">
                  Open Audit Tool →
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <strong>Note:</strong> Audit tools open in the shared dashboard. Assessment data is saved as a printable PDF report. Persistent audit history is coming in a future release.
      </div>
    </div>
  );
}
